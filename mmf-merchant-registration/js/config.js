/**
 * Editable constants for MMF 2026 Merchant Registration.
 * Fill in bank / e-wallet / QR / card link details here — form UI reads from this file.
 */

export const ADMIN_PASSWORD = 'mmf2026';

/** Set true to block Next/Submit until required fields are filled. Asterisks stay either way. */
export const ENFORCE_VALIDATION = false;

export const EVENT = {
    name: 'Manila Matcha Fest 2026',
    dates: 'August 7–16, 2026',
    venue: 'SM Mall of Asia, Main Atrium',
    tagline: '10 days. 24 matcha brands. One atrium.',
    unpaidReleaseDate: '[DATE]', // e.g. 'July 31, 2026'
    finalPaymentDue: 'August 6, 2026',
    instagramHandle: '@manilamatchafest',
};

export const FEES = {
    participationExVat: 50000,
    vatAmount: 6000,
    totalDue: 56000,
    downpaymentAmount: 28000,
    balanceAmount: 28000,
    currency: 'PHP',
};

export function formatPeso(amount) {
    return `₱${Number(amount).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

/** Payment destination details — edit these before going live */
export const PAYMENT_DETAILS = {
    sectionTitle: 'Payment Details',
    hints: {
        bank: 'For Bank Transfer / Cash Deposit:',
        ewallet: 'For E-wallet:',
    },
    accounts: [
        {
            type: 'bank',
            label: 'BDO',
            accountName: 'MATCHANESE INC',
            accountNumber: '000251640035',
        },
        {
            type: 'bank',
            label: 'Unionbank',
            accountName: 'Cristopher David',
            accountNumber: '109420972821',
        },
        {
            type: 'bank',
            label: 'BPI',
            accountName: 'Cristopher David',
            accountNumber: '0829677495',
        },
        {
            type: 'ewallet',
            label: 'GCash',
            accountName: 'Cristopher David',
            accountNumber: '09496471857',
            qrImage: 'images/qr/gcash.png',
        },
        {
            type: 'ewallet',
            label: 'Maya',
            accountName: 'Cristopher David',
            accountNumber: '09496471857',
            qrImage: 'images/qr/maya.png',
        },
        {
            type: 'ewallet',
            label: 'GoTyme',
            accountName: 'Cristopher David',
            accountNumber: '016694689311',
            qrImage: 'images/qr/gotyme.png',
        },
    ],
    card: {
        enabled: false,
        url: '',
        note: 'After you submit, you’ll be taken to PayPal to complete payment by card.',
        linkLabel: 'Open card payment link',
        radioLabel: 'Card (PayPal)',
        radioHint: 'You’ll be redirected to PayPal after you submit this form.',
    },
};

export const COLLECTION_NAME = 'mmf_merchant_registrations';
export const REQUIREMENTS_COLLECTION = 'mmf_merchant_requirements';
export const VISITORS_COLLECTION = 'mmf_merchant_visitors';
export const MERCHANTS_COLLECTION = 'mmf_hub_merchants';
export const SALES_COLLECTION = 'mmf_hub_sales_reports';
export const KOL_COLLECTION = 'mmf_hub_kol_claims';
export const STORAGE_PREFIX = 'mmf-merchant-proofs';
export const STORAGE_DOCS_PREFIX = 'mmf-merchant-docs';
export const STORAGE_REQUIREMENTS_PREFIX = 'mmf-merchant-requirements';

export const BRAND_DESCRIPTION_MAX = 400;

/** Event days Aug 7–16, 2026 — used by hub reports tab in admin. */
export const EVENT_DAYS = [
    { date: '2026-08-07', day: 1, label: 'Day 1 · Aug 7' },
    { date: '2026-08-08', day: 2, label: 'Day 2 · Aug 8' },
    { date: '2026-08-09', day: 3, label: 'Day 3 · Aug 9' },
    { date: '2026-08-10', day: 4, label: 'Day 4 · Aug 10' },
    { date: '2026-08-11', day: 5, label: 'Day 5 · Aug 11' },
    { date: '2026-08-12', day: 6, label: 'Day 6 · Aug 12' },
    { date: '2026-08-13', day: 7, label: 'Day 7 · Aug 13' },
    { date: '2026-08-14', day: 8, label: 'Day 8 · Aug 14' },
    { date: '2026-08-15', day: 9, label: 'Day 9 · Aug 15' },
    { date: '2026-08-16', day: 10, label: 'Day 10 · Aug 16' },
];

export async function sha256(text) {
    const data = new TextEncoder().encode(String(text || ''));
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
