/**
 * Constants for MMF Merchant Hub.
 */

export const ADMIN_PASSWORD = 'mmf2026';

export const SESSION_KEY = 'mmf_hub_session';
export const ADMIN_SESSION_KEY = 'mmf_hub_admin';

export const MERCHANTS_COLLECTION = 'mmf_hub_merchants';
export const SALES_COLLECTION = 'mmf_hub_sales_reports';
export const KOL_COLLECTION = 'mmf_hub_kol_claims';
export const REGISTRATIONS_COLLECTION = 'mmf_merchant_registrations';

export const EVENT = {
    name: 'Manila Matcha Fest 2026',
    dates: 'August 7–16, 2026',
    venue: 'SM Mall of Asia, Main Atrium',
    tagline: 'Your one-stop merchant dashboard',
    finalPaymentDue: 'August 6, 2026',
};

export const FEES = {
    totalDue: 56000,
    downpaymentAmount: 28000,
    balanceAmount: 28000,
};

/** Payment destinations for outstanding balances (QR hosted on mmf-info). */
const QR_BASE = 'https://mmf-info.web.app';

export const PAYMENT_DETAILS = {
    notifyEmail: 'hi@matchanese.com',
    hints: {
        bank: 'Bank transfer / cash deposit',
        ewallet: 'E-wallet',
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
            qrImage: `${QR_BASE}/images/qr/gcash.png`,
        },
        {
            type: 'ewallet',
            label: 'Maya',
            accountName: 'Cristopher David',
            accountNumber: '09496471857',
            qrImage: `${QR_BASE}/images/qr/maya.png`,
        },
        {
            type: 'ewallet',
            label: 'GoTyme',
            accountName: 'Cristopher David',
            accountNumber: '016694689311',
            qrImage: `${QR_BASE}/images/qr/gotyme.png`,
        },
    ],
};

/** Event days Aug 7–16, 2026 (local dates as YYYY-MM-DD). */
export const EVENT_DAYS = [
    { date: '2026-08-07', day: 1, weekday: 'Fri', shortDate: 'Aug 7', label: 'Day 1 · Aug 7 Fri' },
    { date: '2026-08-08', day: 2, weekday: 'Sat', shortDate: 'Aug 8', label: 'Day 2 · Aug 8 Sat' },
    { date: '2026-08-09', day: 3, weekday: 'Sun', shortDate: 'Aug 9', label: 'Day 3 · Aug 9 Sun' },
    { date: '2026-08-10', day: 4, weekday: 'Mon', shortDate: 'Aug 10', label: 'Day 4 · Aug 10 Mon' },
    { date: '2026-08-11', day: 5, weekday: 'Tue', shortDate: 'Aug 11', label: 'Day 5 · Aug 11 Tue' },
    { date: '2026-08-12', day: 6, weekday: 'Wed', shortDate: 'Aug 12', label: 'Day 6 · Aug 12 Wed' },
    { date: '2026-08-13', day: 7, weekday: 'Thu', shortDate: 'Aug 13', label: 'Day 7 · Aug 13 Thu' },
    { date: '2026-08-14', day: 8, weekday: 'Fri', shortDate: 'Aug 14', label: 'Day 8 · Aug 14 Fri' },
    { date: '2026-08-15', day: 9, weekday: 'Sat', shortDate: 'Aug 15', label: 'Day 9 · Aug 15 Sat' },
    { date: '2026-08-16', day: 10, weekday: 'Sun', shortDate: 'Aug 16', label: 'Day 10 · Aug 16 Sun' },
];

/** Event contacts — name + mobile (+ email when available). */
export const CONTACT_GROUPS = [
    {
        title: 'SM Mall of Asia Admin',
        people: [
            {
                name: 'Bianca Quintana',
                mobile: '+63 917 153 3913',
                mobileHref: 'tel:+639171533913',
                email: 'bianca.quintana@smsupermalls.com',
                emailHref: 'mailto:bianca.quintana@smsupermalls.com',
            },
            {
                name: 'Carla Corrales',
                mobile: '+63 947 517 7349',
                mobileHref: 'tel:+639475177349',
                email: 'carla.corrales@smsupermalls.com',
                emailHref: 'mailto:carla.corrales@smsupermalls.com',
            },
            {
                name: 'Ryan Felias',
                mobile: '+63 908 923 5906',
                mobileHref: 'tel:+639089235906',
                email: 'ry.felias@smsupermalls.com',
                emailHref: 'mailto:ry.felias@smsupermalls.com',
            },
        ],
    },
    {
        title: 'Matchanese (Organizer)',
        people: [
            {
                name: 'Cristopher David',
                mobile: '+63 949 647 1857',
                mobileHref: 'tel:+639496471857',
                email: 'toph@matchanese.com',
                emailHref: 'mailto:toph@matchanese.com',
            },
            {
                name: 'Bea Boldo',
                mobile: '+63 995 311 8439',
                mobileHref: 'tel:+639953118439',
                email: 'bea@matchanese.com',
                emailHref: 'mailto:bea@matchanese.com',
            },
            {
                name: 'Gabrielle Catalan',
                mobile: '+63 950 617 2475',
                mobileHref: 'tel:+639506172475',
                email: null,
                emailHref: null,
            },
        ],
    },
];

/** @deprecated use CONTACT_GROUPS */
export const CONTACTS = CONTACT_GROUPS;

/** Ice & water supplier references for merchants. */
export const SUPPLIERS = [
    {
        id: 'ice-desi-ray',
        category: 'Ice',
        name: "Desi Ray's Purified Ice Cube",
        mobile: '0991 352 4973',
        mobileHref: 'tel:+639913524973',
        address: '1036 Brgy. 169 Zone 17, Malibay, Pasay City',
        pricing: ['₱60 / 5 kg', '₱15 / 1 kg'],
        facebook: null,
        facebookHref: null,
        instagram: null,
        instagramHref: null,
        howToOrder: null,
        link: null,
        linkLabel: null,
    },
    {
        id: 'ice-yelo-muna',
        category: 'Ice',
        name: 'Yelo Muna Ice Store',
        mobile: '0969 367 5402',
        mobileHref: 'tel:+639693675402',
        address: null,
        pricing: ['₱180 / 30 kg + delivery fee'],
        facebook: null,
        facebookHref: null,
        instagram: '@yelo.muna.icestore',
        instagramHref: 'https://www.instagram.com/yelo.muna.icestore',
        howToOrder: null,
        link: null,
        linkLabel: null,
    },
    {
        id: 'water-aquafront',
        category: 'Water',
        name: 'Aquafront',
        mobile: '0956 269 6281',
        mobileHref: 'tel:+639562696281',
        address: null,
        pricing: ['₱40 / 5.5 gal', '₱7 / liter'],
        facebook: 'facebook.com/aqfrnt',
        facebookHref: 'https://www.facebook.com/aqfrnt/',
        instagram: null,
        instagramHref: null,
        howToOrder: null,
        link: null,
        linkLabel: null,
    },
];

/**
 * Ingress reminders — ordered by when merchants need them (early day → on-site → ongoing).
 */
export const INGRESS_REMINDERS = [
    {
        id: 'schedule',
        title: 'Schedule',
        items: [
            'Ingress starts at 6:00 AM only.',
            'Ex-deal items must be ready for turnover by August 7, 8:00 AM.',
            'Booths must be ready to open at 10:00 AM.',
            'Keep manpower at the booth from 10:00 AM–10:00 PM, even if sold out early.',
        ],
    },
    {
        id: 'where',
        title: 'Where to go',
        items: [
            'RDU 2 is along Ocean Drive, near Ramen Nagi.',
            'OP1 (special approval) — Main Mall Drop Off Entrance (Shake Shack) for big fixtures and displays.',
            'OP2 (special approval) — West Entrance (Salad Stop) for car entrances.',
        ],
    },
    {
        id: 'bring',
        title: 'What to bring',
        items: [
            'All personnel: 1 government-issued laminated valid ID.',
            'Proper attire — no shorts, sando, muscle-cut shirts, flip-flops, or slippers.',
            'Required: bring your own submeter, breakers, royal cords, and extension wires. EMB/EDD will help with tapping.',
            'Bring push carts for loading animation modules.',
        ],
    },
    {
        id: 'power',
        title: 'Power & electrical',
        items: [
            'Required: bring your own submeter, breakers, royal cords, and extension wires. EMB/EDD will help with tapping.',
            'Max 7A per brand only.',
            'Wires / cords / cables must be concealed or secured with a rubber ramp, or run under carpet / flooring. No duct tape.',
            'Only microwave or oven heating is allowed. No LPG.',
        ],
    },
    {
        id: 'rules',
        title: 'On-site rules',
        items: [
            'Proper attire — no shorts, sando, muscle-cut shirts, flip-flops, or slippers.',
            'Proper decorum: no sleeping or eating in the selling area, no loitering, no smoking.',
            'Handle heavy equipment, modules, and fixtures with care during install.',
            'Keep the animation set-up clean and well-arranged at all times.',
            'Office supplies and records must be kept out of sight (logbooks, notebooks, calculators, etc.).',
            'Restocking without a push-cart cover is not allowed.',
            'Any damage or loss to the mall is the responsibility of the supplier and its contractors / agency.',
            'Do not make permanent physical changes (boring holes, repainting walls / floors, etc.).',
        ],
    },
    {
        id: 'not-allowed',
        title: 'Not allowed',
        items: [
            'No monoblock chairs or any chairs without cover.',
            'No busted lights.',
            'No unpainted, chipped, or unfinished wood structures.',
            'No spray painting. Minimal brush / roller touch-ups only if paint is water-based and low-odor — floors must not be stained.',
            'No tarpaulin banners, roll-up banners, signage posters, or streamers.',
            'No spider, L-type, X-type, or T-type standees.',
            'No exposed boxes, stocks, GWP / freebies, glasses, trash, or unnecessary materials.',
            'No flyering, brand ambassadors, or selling outside the exhibit area without permit / clearance.',
        ],
    },
];

export const BOOTH_LAYOUT = {
    imageSrc: 'images/booth-layout.png',
    imageAlt: 'Manila Matcha Fest MOA floor plan with booth numbers 1–24',
    notes: '',
};

export function formatPeso(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '₱0.00';
    return `₱${n.toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

export function formatNumber(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('en-PH');
}

/** Parse a peso/number string (strips ₱, commas, spaces). */
export function parseMoney(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const cleaned = String(value || '').replace(/[₱,\s]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
}

export function salesDocId(merchantId, date) {
    return `${merchantId}_${date}`;
}

export function kolDocId(merchantId, date) {
    return `${merchantId}_${date}`;
}

export async function sha256(text) {
    const data = new TextEncoder().encode(String(text || ''));
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export function todayEventDate() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${d}`;
    if (EVENT_DAYS.some((day) => day.date === iso)) return iso;
    return EVENT_DAYS[0].date;
}

export function formatUpdatedAt(value) {
    if (!value) return '';
    let date;
    if (typeof value?.toDate === 'function') date = value.toDate();
    else if (value instanceof Date) date = value;
    else date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-PH', {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}
