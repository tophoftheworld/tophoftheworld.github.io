/**
 * Shared helpers for payroll_periods_v2/{periodId}/payments/{employeeId}.
 * Used by admin-requests (reimbursement prepaid) and admin-payroll.
 */
import {
    doc,
    getDoc,
    getDocFromServer,
    setDoc,
    updateDoc,
    waitForPendingWrites,
    arrayUnion
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const PAYMENTS_SUBCOL = 'payments';

function paymentDocRef(db, periodId, employeeId) {
    return doc(db, 'payroll_periods_v2', periodId, PAYMENTS_SUBCOL, employeeId);
}

function earningsDocRef(db, earningsDocId) {
    return doc(db, 'payroll_period_earnings_v2', earningsDocId);
}

function roundMoney(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Add delta to the period's accumulated paymentAmount (does not send money).
 * Returns the updated payment record.
 */
export async function incrementPeriodPaymentAmount(db, {
    employeeId,
    periodId,
    deltaAmount,
    transferMethod = 'reimbursement_prepaid',
    note = '',
    earningsDocId = null,
    sourceRequestId = null
} = {}) {
    if (!db || !employeeId || !periodId) {
        throw new Error('Missing employee or period for payment increment');
    }
    const delta = roundMoney(deltaAmount);
    if (delta <= 0) {
        throw new Error('Payment increment must be greater than zero');
    }

    const paymentRef = paymentDocRef(db, periodId, employeeId);
    let existing = {};
    try {
        const snap = await getDocFromServer(paymentRef);
        if (snap.exists()) existing = snap.data() || {};
    } catch (_) {
        const snap = await getDoc(paymentRef);
        if (snap.exists()) existing = snap.data() || {};
    }

    // Idempotent: already counted this earnings line
    const prepaidIds = Array.isArray(existing.prepaidEarningsIds) ? existing.prepaidEarningsIds : [];
    if (earningsDocId && prepaidIds.includes(earningsDocId)) {
        return {
            alreadyCounted: true,
            paymentData: existing,
            paymentAmount: roundMoney(existing.paymentAmount)
        };
    }

    const previousPaid = roundMoney(existing.paymentAmount);
    const paymentAmount = roundMoney(previousPaid + delta);
    const totalPay = roundMoney(existing.totalPay);
    const remainingAmount = totalPay > 0 ? roundMoney(totalPay - paymentAmount) : roundMoney(existing.remainingAmount);
    const surplusAmount = paymentAmount > totalPay && totalPay > 0
        ? roundMoney(paymentAmount - totalPay)
        : 0;
    const paymentType = surplusAmount > 0
        ? 'surplus'
        : (totalPay > 0 && paymentAmount >= totalPay - 0.009 ? 'full' : 'partial');

    const noteParts = [existing.note, note].map((s) => String(s || '').trim()).filter(Boolean);
    const paymentData = {
        ...existing,
        employeeId: String(employeeId),
        periodId: String(periodId),
        paymentAmount,
        totalPay,
        remainingAmount,
        surplusAmount,
        paymentType,
        transferMethod: existing.transferMethod || transferMethod,
        note: noteParts.join(' · ').slice(0, 400),
        uploadedAt: existing.uploadedAt || new Date().toISOString(),
        uploadedBy: existing.uploadedBy || 'admin',
        lastPrepaidAt: new Date().toISOString()
    };
    if (earningsDocId) {
        paymentData.prepaidEarningsIds = arrayUnion(earningsDocId);
    }
    if (sourceRequestId) {
        paymentData.lastPrepaidSourceRequestId = String(sourceRequestId);
    }

    await setDoc(paymentRef, paymentData, { merge: true });
    try {
        await waitForPendingWrites(db);
    } catch (_) { /* optional */ }

    return {
        alreadyCounted: false,
        paymentData: {
            ...paymentData,
            prepaidEarningsIds: earningsDocId
                ? [...new Set([...prepaidIds, earningsDocId])]
                : prepaidIds
        },
        paymentAmount
    };
}

/**
 * Stamp an earnings line as prepaid and bump period paymentAmount.
 */
export async function markPeriodEarningPrepaid(db, {
    earningsDocId,
    employeeId,
    periodId,
    amount,
    sourceRequestId = null,
    note = 'Already paid out (separate transfer)'
} = {}) {
    if (!earningsDocId) throw new Error('Missing earnings document id');
    const amt = roundMoney(Math.abs(Number(amount) || 0));
    if (amt <= 0) throw new Error('Invalid prepaid amount');

    const earningsRef = earningsDocRef(db, earningsDocId);
    let earningsSnap;
    try {
        earningsSnap = await getDocFromServer(earningsRef);
    } catch (_) {
        earningsSnap = await getDoc(earningsRef);
    }
    if (!earningsSnap.exists()) {
        throw new Error('Earnings line not found');
    }
    const line = earningsSnap.data() || {};
    if (line.prePaid || line.prePaidAmount > 0) {
        return { alreadyPrepaid: true, line, paymentResult: null };
    }

    const empId = employeeId || line.employeeId;
    const pid = periodId || line.periodId;
    if (!empId || !pid) {
        throw new Error('Earnings line missing employee or period');
    }

    const paymentResult = await incrementPeriodPaymentAmount(db, {
        employeeId: empId,
        periodId: pid,
        deltaAmount: amt,
        transferMethod: 'reimbursement_prepaid',
        note,
        earningsDocId,
        sourceRequestId: sourceRequestId || line.sourceRequestId || null
    });

    await updateDoc(earningsRef, {
        prePaid: true,
        prePaidAmount: amt,
        prePaidAt: new Date().toISOString(),
        prePaidNote: note
    });

    return { alreadyPrepaid: false, line, paymentResult };
}
