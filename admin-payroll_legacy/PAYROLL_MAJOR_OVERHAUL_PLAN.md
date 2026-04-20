# Payroll Major Overhaul — Implementation Plan (v2)

**Decisions locked in:**

- **Firestore:** Greenfield namespaces with **`_v2` suffix** (`employees_v2`, `attendance_v2`, …). Legacy collections (`employees`, `attendance`, …) are **unchanged**; only the migration tool reads legacy and writes `_v2`.
- **Local folders:** **Legacy** apps live under **`_legacy`** (`admin-payroll_legacy`, `employee-attendance_legacy`, `payroll_legacy`). **New** apps use **canonical** names (`admin-payroll`, `employee-attendance`, `payroll`) and talk to Firestore `_v2` only.
- **Monthly pay (v1):** Fixed gross per **pay period** on the **existing twice-monthly schedule** — no calendar proration. See **ADR: Monthly pay** below.

This document is the **engineering plan**: what we will build, what gets fixed/added/improved, milestones, and risks.

---

## ADR: Local folder naming

| Role | Legacy (frozen snapshot) | Canonical (v2 / active) |
|------|--------------------------|-------------------------|
| Admin payroll | `admin-payroll_legacy/` | `admin-payroll/` |
| Employee time-in | `employee-attendance_legacy/` | `employee-attendance/` |
| Payroll dashboard | `payroll_legacy/` | `payroll/` |

- Deployed URLs mirror folders: `…/admin-payroll/` serves the **new** stack; `…/admin-payroll_legacy/` keeps the old UI for rollback.
- Repo workflow: copy current trees to `*_legacy`, then implement or repoint **canonical** folders to `_v2` Firestore paths.

---

## ADR: Firestore `_v2` suffix

Keep **`employees_v2`**, **`attendance_v2/{id}/dates/{dateStr}`**, **`payroll_period_earnings_v2`**, **`payment_confirmations_v2`** until legacy is retired. Optional future rename is out of scope.

---

## ADR: Monthly pay (fixed, twice-monthly)

- For `payType === "monthly"`, pay is a **fixed amount per payroll period** (same period definitions as today’s bi-weekly / twice-monthly calendar).
- **v1 rule:** use **`monthlySalary`** on the employee snapshot for the period; **`periodGross = monthlySalary / 2`** per period, **or** store **`periodGross`** explicitly on `rateHistory[]` to override one period without changing `monthlySalary`.
- **No** daily/30-day proration in v1; attendance may still be tracked for compliance; earned salary line item is the fixed period amount (plus separate allowances/bonuses per product rules).

---

## 1. Goals

| Goal | How v2 addresses it |
|------|---------------------|
| Fast period summary and per-employee totals | Server-side period calculation + smaller client payloads (no full-photo URL blast for list views) |
| Correct pay when base rate changes | `rateHistory` on `employees_v2`, keyed by payroll period |
| Period-scoped pay not tied to a calendar day | `payroll_period_earnings_v2` |
| Daily / monthly / fixed salary paths | `payType` + schema + time-in UX |
| Legacy safety | Legacy apps only use legacy collections; canonical apps only use `_v2` |

---

## 2. Target architecture

### 2.1 New Firestore layout (greenfield)

- **`employees_v2/{employeeId}`** — `name`, `nickname`, `salesBonusEligible`, `baseRate`, **`rateHistory`**: `[{ periodId, baseRate, payType, monthlySalary?, periodGross? }]`.
- **`attendance_v2/{employeeId}/dates/{dateStr}`** — same shift model as legacy attendance docs.
- **`payroll_period_earnings_v2/{docId}`** — `periodId`, `employeeId`, `kind`, `amount`, `description`, timestamps.
- **`payment_confirmations_v2/{employeeId}_{periodId}`** — payment tracking for v2.

**Shared:** `config/holidays_*`, `sales-data/...`

### 2.2 Backend: Cloud Functions

- **`calculatePayrollPeriodV2`** (callable) — period totals using Node `PayCalculator` port + `_v2` data.
- Optional: **`getEmployeePeriodDetailV2`** for detail + photos.

### 2.3 Front-end surfaces

| Surface | Legacy folder | Canonical folder |
|--------|---------------|------------------|
| Admin | `admin-payroll_legacy/` | `admin-payroll/` |
| Time-in | `employee-attendance_legacy/` | `employee-attendance/` |
| Payroll dashboard | `payroll_legacy/` | `payroll/` |

---

## 3. Migration tool (~one-way promotion)

Read legacy → write `_v2`: employees (with `rateHistory` seed), attendance, optional `payment_confirmations_v2`. Verify sample totals vs legacy calculator.

---

## 4. Feature breakdown

### 4.1 Fixed

Slow totals, photo payload, wrong pay after raise, sales staffing scan, full-scan payment queries — addressed by server callable, slimmer payloads, `rateHistory`, and v2 payment collection patterns.

### 4.2 Added

Period earnings, pay types (hourly / daily / monthly v1 fixed per period), migration tool, isolated `_v2` trees.

### 4.3 Improved

Rules/indexes for `_v2`, caching keyed by schema version, exports aligned with server math.

### 4.4 Legacy

**`admin-payroll_legacy`**, **`employee-attendance_legacy`**, **`payroll_legacy`** use **`employees`**, **`attendance`**, **`payment_confirmations`** only.

---

## 5. Implementation phases

1. Firestore rules + indexes for `_v2` collections.  
2. Node `PayCalculator` (in `functions/`) with **monthly fixed per period**.  
3. `calculatePayrollPeriodV2` callable.  
4. Canonical admin / time-in / payroll wired to `_v2`.  
5. Migration tool + pilot.  
6. Cutover comms; retire legacy time-in writes when ready.

---

## 6. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Dual writers drift | Time-box cutover; single writer to `attendance_v2` after go-live |
| Rate migration wrong | Backfill from current `baseRate`; manual `rateHistory` fixes |
| Calculator parity | Golden tests; spot-check CSV |

---

## 7. Open items (later)

- Sales bonus denormalization vs server-only.  
- Auth on callables (match current site).  
- Daily-rate UX without full clock pairs.

---

## 8. Summary

Parallel stacks: **`*_legacy` folders + legacy Firestore** vs **canonical folders + `_v2` Firestore** + **Cloud Functions** + **migration**. Monthly v1 = **fixed period gross**, twice-monthly schedule.

---

*Document version: 1.1 — ADRs for folders, Firestore suffix, and monthly pay.*
