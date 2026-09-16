/**
 * Cloud Functions for payroll Firestore v2 collections.
 * Deploy: from repo root, `firebase deploy --only functions`
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const PayCalculator = require('./payCalculator');
const { extractExpenseFieldsFromImage } = require('./extractExpenseReceipt');
const { extractDiscountIdFromImage } = require('./extractDiscountId');
const { generateInvoiceFromChat } = require('./generateInvoiceFromChat');

const geminiApiKey = defineSecret('GEMINI_API_KEY');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const SHIFT_SCHEDULES = {
  Opening: { timeIn: '9:30 AM', timeOut: '6:30 PM' },
  'Adjusted Opening': { timeIn: '10:30 AM', timeOut: '7:30 PM' },
  'Opening Half-Day': { timeIn: '9:30 AM', timeOut: '1:30 PM' },
  Midshift: { timeIn: '11:00 AM', timeOut: '8:00 PM' },
  Closing: { timeIn: '1:00 PM', timeOut: '10:00 PM' },
  'Closing Half-Day': { timeIn: '6:00 PM', timeOut: '10:00 PM' },
  Custom: { timeIn: null, timeOut: null }
};

/**
 * Map one attendance_v2 date doc to PayCalculator row (same shape as admin app).
 */
function docToDateEntry(dateStr, dateData, branchFilter) {
  const isPaidLeave = dateData.isPaidLeave === true;
  const shiftType = dateData.clockIn?.shift || 'Custom';
  let scheduledIn;
  let scheduledOut;
  if (dateData.scheduledIn !== undefined && dateData.scheduledOut !== undefined) {
    scheduledIn = dateData.scheduledIn;
    scheduledOut = dateData.scheduledOut;
  } else {
    const shiftSchedule = SHIFT_SCHEDULES[shiftType] || SHIFT_SCHEDULES.Custom;
    scheduledIn = shiftSchedule.timeIn;
    scheduledOut = shiftSchedule.timeOut;
  }
  const branchName = dateData.clockIn?.branch || 'N/A';
  if (!isPaidLeave && branchFilter && branchFilter !== 'all') {
    const want =
      branchFilter === 'sm-north'
        ? 'SM North'
        : branchFilter === 'podium'
          ? 'Podium'
          : branchFilter;
    if (branchName !== want) {
      return null;
    }
  }
  return {
    date: dateStr,
    branch: branchName,
    shift: shiftType,
    scheduledIn,
    scheduledOut,
    timeIn: dateData.clockIn?.time || null,
    timeOut: dateData.clockOut?.time || null,
    timeInPhoto: dateData.clockIn?.selfie || null,
    timeOutPhoto: dateData.clockOut?.selfie || null,
    hasOTPay: dateData.hasOTPay || false,
    transpoAllowance: dateData.transpoAllowance || 0,
    hasFixedPay: dateData.hasFixedPay || false,
    fixedPayAmount: dateData.fixedPayAmount || 0,
    hasDoublePay: dateData.hasDoublePay || false,
    hasMealAllowance: dateData.hasMealAllowance !== false,
    salesBonus: dateData.salesBonus || 0,
    isPaidLeave: isPaidLeave
  };
}

/** Roster payload: same rows without photo URLs (smaller JSON; detail view loads full docs). */
function rosterDatesWithoutPhotos(dates) {
  return dates.map((row) => ({
    ...row,
    timeInPhoto: null,
    timeOutPhoto: null
  }));
}

/**
 * Match admin client: days worked, late hours vs shift default timeIn, latest clock-in date.
 * @param {object[]} dates — rows from docToDateEntry (branch-filtered)
 * @param {import('./payCalculator')} calculator
 */
function computeRosterStatsFromDates(dates, calculator) {
  let daysWorked = 0;
  let totalLateHours = 0;
  let lastClockInDate = null;
  let lastClockInPhoto = null;

  for (const d of dates) {
    if (d.timeIn && d.timeOut) daysWorked++;

    if (d.shift && d.timeIn) {
      const scheduled = SHIFT_SCHEDULES[d.shift]?.timeIn || '9:30 AM';
      const lateMinutes = calculator.compareTimes(d.timeIn, scheduled);
      if (lateMinutes > 0) totalLateHours += lateMinutes / 60;
    }

    if (d.timeIn) {
      const dateObj = new Date(d.date);
      if (!lastClockInDate || dateObj > lastClockInDate) {
        lastClockInDate = dateObj;
        lastClockInPhoto = d.timeInPhoto || null;
      }
    }
  }

  return {
    daysWorked,
    lateHours: totalLateHours,
    lastClockIn: lastClockInDate,
    lastClockInPhoto
  };
}

async function loadHolidays() {
  const snap = await db.doc('config/holidays_2025').get();
  return snap.exists ? snap.data() || {} : {};
}

async function loadSalesSmNorthMap(startYmd, endYmd) {
  const col = db.collection('sales-data').doc('sm-north').collection('daily');
  const snap = await col
    .where(admin.firestore.FieldPath.documentId(), '>=', startYmd)
    .where(admin.firestore.FieldPath.documentId(), '<=', endYmd)
    .get();
  const salesData = {};
  snap.forEach((d) => {
    salesData[d.id] = d.data();
  });
  return salesData;
}

async function loadPeriodEarnings(periodId) {
  const snap = await db
    .collection('payroll_period_earnings_v2')
    .where('periodId', '==', periodId)
    .get();
  const byEmployee = {};
  snap.forEach((doc) => {
    const row = doc.data();
    const eid = row.employeeId;
    if (!eid) return;
    const amt = Number(row.amount) || 0;
    byEmployee[eid] = (byEmployee[eid] || 0) + amt;
  });
  return byEmployee;
}

/** @param {string} periodId */
async function loadPeriodPayments(periodId) {
  if (!periodId) return {};
  const snap = await db
    .collection('payroll_periods_v2')
    .doc(periodId)
    .collection('payments')
    .get();
  const byEmployee = {};
  snap.forEach((d) => {
    byEmployee[d.id] = d.data();
  });
  return byEmployee;
}

/**
 * Callable: compute payroll totals for employees_v2 / attendance_v2.
 * @param {object} data
 * @param {string} data.periodId - Logical period id (stored on earnings); used for extras only
 * @param {string} data.startDate - YYYY-MM-DD
 * @param {string} data.endDate - YYYY-MM-DD
 * @param {string} [data.branchFilter] - all | SM North | Podium | ...
 * @param {string[]} [data.employeeIds] - optional subset; default all from employees_v2
 */
exports.calculatePayrollPeriodV2 = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120
  },
  async (request) => {
    const data = request.data || {};
    const { startDate, endDate, branchFilter = 'all', employeeIds: requestedIds, periodId = '' } = data;

    if (!startDate || !endDate) {
      throw new HttpsError('invalid-argument', 'startDate and endDate are required (YYYY-MM-DD).');
    }

    const holidays = await loadHolidays();
    const salesData = await loadSalesSmNorthMap(startDate, endDate);
    const extrasByEmployee = periodId ? await loadPeriodEarnings(periodId) : {};
    const paymentsByEmployee = periodId ? await loadPeriodPayments(periodId) : {};

    let ids = Array.isArray(requestedIds) ? requestedIds.filter(Boolean) : null;
    if (!ids || ids.length === 0) {
      const empSnap = await db.collection('employees_v2').get();
      ids = empSnap.docs.map((d) => d.id);
    }

    const MAX_EMPLOYEE_IDS = 2000;
    if (ids.length > MAX_EMPLOYEE_IDS) {
      throw new HttpsError(
        'invalid-argument',
        `At most ${MAX_EMPLOYEE_IDS} employee ids per request.`
      );
    }

    const calculator = new PayCalculator(holidays, salesData);

    /** @type {Record<string, object>} */
    const attendanceMap = {};

    await Promise.all(
      ids.map(async (employeeId) => {
        const empSnap = await db.doc(`employees_v2/${employeeId}`).get();
        const name =
          empSnap.exists && empSnap.data().name ? empSnap.data().name : employeeId;

        const datesCol = db.collection('attendance_v2').doc(employeeId).collection('dates');
        const snap = await datesCol
          .where(admin.firestore.FieldPath.documentId(), '>=', startDate)
          .where(admin.firestore.FieldPath.documentId(), '<=', endDate)
          .get();

        const dates = [];
        snap.forEach((docSnap) => {
          const row = docToDateEntry(docSnap.id, docSnap.data(), branchFilter);
          if (row) dates.push(row);
        });

        const rawEmp = empSnap.exists ? empSnap.data() : {};
        const rateRow = PayCalculator.mergeEmployeeRatesForPeriod(
          { ...rawEmp, id: employeeId },
          periodId || ''
        );
        const stats = computeRosterStatsFromDates(dates, calculator);

        attendanceMap[employeeId] = {
          id: employeeId,
          name,
          dates,
          lastClockIn: stats.lastClockIn,
          lastClockInPhoto: stats.lastClockInPhoto,
          daysWorked: stats.daysWorked,
          lateHours: stats.lateHours,
          baseRate: rateRow.baseRate || 0,
          salesBonusEligible: empSnap.exists ? !!empSnap.data().salesBonusEligible : false,
          nickname: empSnap.exists ? empSnap.data().nickname || '' : '',
          payType: rateRow.payType || 'hourly',
          monthlySalary: rateRow.monthlySalary || 0,
          periodGross: rateRow.periodGross,
          periodFixedAmount: rateRow.periodFixedAmount || 0,
          payScheme: rateRow.payScheme || 'standard',
          rateHistory: rawEmp.rateHistory,
          _rawEmp: rawEmp
        };
      })
    );

    calculator.staffingAttendanceData = attendanceMap;

    const employeesOut = [];
    let periodTotal = 0;

    for (const employeeId of ids) {
      const bucket = attendanceMap[employeeId];
      if (!bucket) continue;

      const empData = bucket._rawEmp || {};
      const merged = PayCalculator.mergeEmployeeRatesForPeriod(
        { ...empData, id: employeeId },
        periodId || ''
      );

      const employeeForCalc = {
        id: employeeId,
        name: bucket.name,
        baseRate: merged.baseRate || 0,
        salesBonusEligible: !!empData.salesBonusEligible,
        nickname: empData.nickname || '',
        payType: merged.payType || 'hourly',
        monthlySalary: merged.monthlySalary || 0,
        periodGross: merged.periodGross != null ? merged.periodGross : null,
        periodFixedAmount: merged.periodFixedAmount || 0,
        payScheme: merged.payScheme || 'standard'
      };

      const pay = calculator.calculateTotalPay(bucket.dates, employeeForCalc, 'simple');
      const extras = extrasByEmployee[employeeId] || 0;
      const total = Number(pay) + extras;
      periodTotal += total;

      const paymentRow = paymentsByEmployee[employeeId] || null;
      const rosterDates = rosterDatesWithoutPhotos(bucket.dates);
      const lastIn = bucket.lastClockIn;
      employeesOut.push({
        employeeId,
        name: bucket.name,
        totalPay: total,
        attendancePay: Number(pay),
        periodEarningsExtras: extras,
        daysInRange: bucket.dates.length,
        daysWorked: bucket.daysWorked,
        lateHours: bucket.lateHours,
        lastClockIn: lastIn ? lastIn.toISOString() : null,
        lastClockInPhoto: null,
        dates: rosterDates,
        nickname: bucket.nickname || '',
        baseRate: merged.baseRate || 0,
        payType: merged.payType || 'hourly',
        monthlySalary: merged.monthlySalary || 0,
        periodGross: merged.periodGross != null ? merged.periodGross : null,
        periodFixedAmount: merged.periodFixedAmount || 0,
        payScheme: merged.payScheme || 'standard',
        rateHistory: Array.isArray(empData.rateHistory) ? empData.rateHistory : [],
        salesBonusEligible: !!empData.salesBonusEligible,
        paymentConfirmation: paymentRow
      });
    }

    return {
      periodId,
      startDate,
      endDate,
      branchFilter,
      periodTotal,
      employeeCount: employeesOut.length,
      employees: employeesOut
    };
  }
);

/**
 * Callable: extract expense form fields from a receipt photo via Gemini 3.5 Flash.
 * Requires Firebase Auth in the handler. Cloud Run must still allow unauthenticated
 * invoke so browser CORS preflight (OPTIONS) can reach the function.
 * Set secret: `firebase functions:secrets:set GEMINI_API_KEY`
 * @param {object} data
 * @param {string} data.imageBase64 - data URL or raw base64
 * @param {string} [data.mimeType] - e.g. image/jpeg
 */
exports.extractExpenseReceipt = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
    invoker: 'public',
    secrets: [geminiApiKey]
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required to extract receipt details.');
    }

    const data = request.data || {};
    const imageBase64 = data.imageBase64;
    const mimeType = data.mimeType;

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new HttpsError('invalid-argument', 'imageBase64 is required.');
    }

    try {
      const parsed = await extractExpenseFieldsFromImage({
        apiKey: geminiApiKey.value(),
        imageBase64,
        mimeType
      });
      return { ok: true, parsed };
    } catch (error) {
      const code = error?.code || 'internal';
      const message = error?.message || 'Receipt extraction failed';
      if (code === 'invalid-argument' || code === 'failed-precondition' || code === 'resource-exhausted') {
        throw new HttpsError(code, message);
      }
      console.error('extractExpenseReceipt failed:', message);
      throw new HttpsError('internal', message);
    }
  }
);

/**
 * Callable: extract Senior / PWD ID fields from a card photo via Gemini.
 * POS kiosks are unauthenticated (same as order writes). Set secret: GEMINI_API_KEY
 * @param {object} data
 * @param {string} data.imageBase64
 * @param {string} [data.mimeType]
 * @param {string} [data.idType] - 'senior' | 'pwd'
 */
exports.extractDiscountId = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
    invoker: 'public',
    secrets: [geminiApiKey]
  },
  async (request) => {
    const data = request.data || {};
    const imageBase64 = data.imageBase64;
    const mimeType = data.mimeType;
    const idType = data.idType === 'pwd' ? 'pwd' : 'senior';

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new HttpsError('invalid-argument', 'imageBase64 is required.');
    }

    try {
      const parsed = await extractDiscountIdFromImage({
        apiKey: geminiApiKey.value(),
        imageBase64,
        mimeType,
        idType
      });
      return { ok: true, parsed };
    } catch (error) {
      const code = error?.code || 'internal';
      const message = error?.message || 'ID extraction failed';
      if (code === 'invalid-argument' || code === 'failed-precondition' || code === 'resource-exhausted') {
        throw new HttpsError(code, message);
      }
      console.error('extractDiscountId failed:', message);
      throw new HttpsError('internal', message);
    }
  }
);

/**
 * Callable: chat turn → structured invoice draft via Gemini.
 * Public (invoice-generator has no Firebase Auth). Set secret: GEMINI_API_KEY
 * @param {object} data
 * @param {Array<{role:string, content:string}>} data.messages
 * @param {object} [data.currentInvoice]
 */
exports.generateInvoiceFromChat = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
    invoker: 'public',
    secrets: [geminiApiKey]
  },
  async (request) => {
    const data = request.data || {};
    const messages = data.messages;
    const currentInvoice = data.currentInvoice || {};
    const documentPreview = data.documentPreview || '';

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new HttpsError('invalid-argument', 'messages array is required.');
    }

    try {
      const result = await generateInvoiceFromChat({
        apiKey: geminiApiKey.value(),
        messages,
        currentInvoice,
        documentPreview
      });
      return { ok: true, ...result };
    } catch (error) {
      const code = error?.code || 'internal';
      const message = error?.message || 'Invoice chat failed';
      if (code === 'invalid-argument' || code === 'failed-precondition' || code === 'resource-exhausted') {
        throw new HttpsError(code, message);
      }
      console.error('generateInvoiceFromChat failed:', message);
      throw new HttpsError('internal', message);
    }
  }
);
