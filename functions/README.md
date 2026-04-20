# Payroll v2 Cloud Functions

- **`calculatePayrollPeriodV2`** (callable HTTPS): inputs `startDate`, `endDate` (`YYYY-MM-DD`), optional `periodId`, `branchFilter`, `employeeIds`. Reads `employees_v2` (including `rateHistory` via `PayCalculator.mergeEmployeeRatesForPeriod`), `attendance_v2`, `config/holidays_2025`, `sales-data/sm-north/daily`, `payroll_period_earnings_v2`, and `payroll_periods_v2/{periodId}/payments` (exposed on each employee as `paymentConfirmation`).

## Setup

```bash
cd functions
npm install
```

Deploy from repository root:

```bash
firebase deploy --only functions
```

Ensure the Firebase project matches `matchanese-attendance` (or update `firebase use`).

## Security

- The callable validates inputs (required dates, max `employeeIds` length) but is still **publicly invokable** like any default HTTPS callable. Before production hardening, enable **Firebase App Check** for your web app and enforce it on Functions, and/or restrict invocation via **IAM** (private service accounts only) if you move to a backend proxy.
- Firestore rules in this repo are permissive for development; tighten `employees_v2`, `attendance_v2`, and `payroll_periods_v2` before wide exposure.

## Client usage (admin-payroll v2)

Initialize Functions SDK and call:

```javascript
import { getFunctions, httpsCallable } from 'firebase/functions';
const fn = httpsCallable(getFunctions(app), 'calculatePayrollPeriodV2');
const { data } = await fn({
  startDate: '2025-04-01',
  endDate: '2025-04-15',
  periodId: '2025-04-01_2025-04-15',
  branchFilter: 'all',
  employeeIds: ['optional', 'subset']
});
```

Response `employees[]` includes roster fields (`dates` without photo URLs, `daysWorked`, `lateHours`, `lastClockIn`, pay totals, `paymentConfirmation`, etc.) for building the admin table without per-employee client `getDocs` on `attendance_v2/.../dates`. Omit `employeeIds` to include all staff from `employees_v2`.
