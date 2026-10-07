# Payroll v2 Cloud Functions

- **`calculatePayrollPeriodV2`** (callable HTTPS): inputs `startDate`, `endDate` (`YYYY-MM-DD`), optional `periodId`, `branchFilter`, `employeeIds`. Reads `employees_v2` (including `rateHistory` via `PayCalculator.mergeEmployeeRatesForPeriod`), `attendance_v2`, `config/holidays_2025`, `sales-data/sm-north/daily`, `payroll_period_earnings_v2`, and `payroll_periods_v2/{periodId}/payments` (exposed on each employee as `paymentConfirmation`).

## Discord → expenses (scheduled receipt jobs)

`discordExpensePoll` runs every minute in `us-central1`. It reads new messages in
allowlisted channels using the bot REST API, persists one job for every image,
and awaits OCR, storage and Firestore writes inside the scheduled request.
There is no background Gateway connection or manual startup ping.

- `discordExpenseBot` is now a read-only health URL. HTTP 200 means a poll completed
  in the last ten minutes without a scan-level failure. It exposes timestamps,
  including the last successful save; job-level review cases are reported in Discord.
- Firestore `discord_receipt_state` holds the poll lease, channel cursor and scan
  checkpoints. `discord_receipt_jobs` holds attempts and pending notifications.
  `discord_receipt_hashes` prevents exact processed-image reuploads from duplicating
  expenses. These three collections must remain Admin SDK only.
- A stable expense ID contains channel, message and attachment IDs. Writes are
  create-only; ambiguous write failures are reconciled before retry. Expense/hash
  creation is atomic. Notification failure never changes a saved expense to failed.
- Three processing attempts, then a needs-review reply. Job and notification
  retries survive restarts. A ten-minute lease prevents overlapping poll runs;
  the function hard timeout is nine minutes.
- Channel history is paginated with durable checkpoints after jobs are saved.
  On first activation a channel starts at the current time. Pre-existing receipts
  are deliberately NOT replayed: the legacy bot used random IDs and some failures
  saved late. Reconcile that history before any manual backfill.
- Every image attachment is handled separately. PDFs are not receipt images.
  HEIC is converted and large images compressed. Downloads are limited to 20 MB
  and 30 seconds; refreshed attachment URLs are fetched for retries.
- Discord dates retain the extracted year and use Manila upload context. Missing
  supplier/date, nonpositive amount, invalid/future dates or invalid VAT amounts
  require manual review rather than silently becoming expense entries.
- Receipt images use revocable Firebase download tokens, not public-object ACLs
  or 2099 signed URLs. The download URL is checked before saving the expense.
  Existing project-wide expense/Storage access rules are a separate migration.

### Channel defaults and configuration

Enable Message Content Intent and grant View Channel, Read Message History and
Send Messages. Set `GEMINI_API_KEY` and `DISCORD_BOT_TOKEN` in Secret Manager.
Channel IDs belong in the ignored `functions/.env.matchanese-attendance` file:

- `DISCORD_EXPENSE_CHANNEL_GENERAL` → General / Company
- `DISCORD_EXPENSE_CHANNEL_SM_NORTH` → Store / SM North / Store Cash
- `DISCORD_EXPENSE_CHANNEL_PODIUM` → Store / Podium / Store Cash
- `DISCORD_EXPENSE_CHANNEL_MOA` → Store / Mall of Asia / Store Cash
- `DISCORD_EXPENSE_CHANNEL_EVENTS` → Popup / Store Cash (event name still manual)

Only General is currently configured. Message captions do not override these
values. Different photographs/crops of the same receipt and legacy expenses are
not covered by the exact-image hash; the Expenses app still provides review tools.
Purchasing links remain a reconciliation step, not automatic purchase matching.

### Deploy and verify

Deploy only the two receipt functions (not all unrelated functions):

```bash
firebase deploy --only functions:discordExpenseBot,functions:discordExpensePoll --project matchanese-attendance
```

Verify the Scheduler job exists and is enabled, inspect poll logs, and verify the
health response after a scheduled run. Ensure the three internal Firestore
collections are denied to clients, preserving other deployed rules. To retry a
reviewed job, an operator can set status to `retry`, attempts to `0`, and
nextAttemptAt to the current Unix time in milliseconds; check the expense first.

Tests (no network or production writes):

```bash
node functions/tests/discordExpenseIngest.test.js
node functions/tests/discordExpensePoll.test.js
node functions/tests/createExpenseFromReceipt.test.js
node functions/tests/extractExpenseReceipt.test.js
```

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

- Callables are publicly invokable by default; harden with App Check / IAM before wide exposure.
- Firestore rules in this repo are permissive for development.
- `discordExpenseBot` is a public read-only health endpoint. The scheduled worker is IAM-invoked by Cloud Scheduler and only reads allowlisted Discord channels.

## Client usage (admin-payroll v2)

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
