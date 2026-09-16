/**
 * Crew meal menus & helpers for MMF Merchant Hub ordering.
 */

export const CREW_MEAL_ORDERS_COLLECTION = 'mmf_hub_crew_meal_orders';

export const OLIVIA_INCLUDES = 'Includes rice and a banana';

export function crewMealOrderDocId(merchantId, date) {
    return `${merchantId}_${date}`;
}

/** Olivia’s — ₱150 meals. Daily ulam rotation (Tortang Talong paused). */
const OLIVIA_BY_DATE = {
    '2026-08-07': [
        { id: 'pork-adobo', name: 'Pork Adobo', price: 150 },
        { id: 'beef-broccoli', name: 'Beef Broccoli', price: 150 },
    ],
    '2026-08-08': [
        { id: 'bicol-express', name: 'Bicol Express', price: 150 },
        { id: 'chicken-adobo', name: 'Chicken Adobo', price: 150 },
    ],
    '2026-08-09': [
        { id: 'menudo', name: 'Menudo', price: 150 },
        { id: 'pochero-chicken', name: 'Pochero (Chicken)', price: 150 },
    ],
    '2026-08-10': [
        { id: 'pochero-pork', name: 'Pochero (Pork)', price: 150 },
        { id: 'kaldereta', name: 'Kaldereta', price: 150 },
    ],
    '2026-08-11': [
        { id: 'bicol-express', name: 'Bicol Express', price: 150 },
        { id: 'beef-broccoli', name: 'Beef Broccoli', price: 150 },
    ],
    '2026-08-12': [
        { id: 'menudo', name: 'Menudo', price: 150 },
        { id: 'chicken-adobo', name: 'Chicken Adobo', price: 150 },
    ],
    '2026-08-13': [
        { id: 'pork-adobo', name: 'Pork Adobo', price: 150 },
        { id: 'kaldereta', name: 'Kaldereta', price: 150 },
    ],
    '2026-08-14': [
        { id: 'pochero-pork', name: 'Pochero (Pork)', price: 150 },
        { id: 'chicken-adobo', name: 'Chicken Adobo', price: 150 },
    ],
    '2026-08-15': [
        { id: 'pork-adobo', name: 'Pork Adobo', price: 150 },
        { id: 'pochero-chicken', name: 'Pochero (Chicken)', price: 150 },
    ],
    '2026-08-16': [
        { id: 'menudo', name: 'Menudo', price: 150 },
        { id: 'beef-broccoli', name: 'Beef Broccoli', price: 150 },
    ],
};

/** Big Batch Club — lunch / dinner (Aug 7–12). */
const BIG_BATCH_BY_DATE = {
    '2026-08-07': {
        lunch: [
            {
                id: 'med-chicken',
                name: 'Mediterranean Chicken with Yogurt Sauce',
                description: 'Rice',
                price: 125,
            },
            {
                id: 'med-chicken-full',
                name: 'Mediterranean Chicken with Yogurt Sauce',
                description: 'Rice, Greek Salad',
                price: 165,
            },
        ],
        dinner: [
            { id: 'tonkatsu', name: 'Tonkatsu', description: 'Rice', price: 140 },
            {
                id: 'tonkatsu-full',
                name: 'Tonkatsu',
                description: 'Rice, Cabbage Coleslaw',
                price: 180,
            },
        ],
    },
    '2026-08-08': {
        lunch: [
            { id: 'beef-mushroom', name: 'Beef and Mushroom', description: 'Rice', price: 140 },
            {
                id: 'beef-mushroom-full',
                name: 'Beef and Mushroom',
                description: 'Rice, Buttered Veggies',
                price: 180,
            },
        ],
        dinner: [
            { id: 'orange-chicken', name: 'Orange Chicken', description: 'Rice', price: 120 },
            {
                id: 'orange-chicken-full',
                name: 'Orange Chicken',
                description: 'Rice, Chopseuy',
                price: 160,
            },
        ],
    },
    '2026-08-09': {
        lunch: [
            {
                id: 'meatballs',
                name: 'Meatballs with cheesy sauce',
                description: 'Rice',
                price: 140,
            },
            {
                id: 'meatballs-full',
                name: 'Meatballs with cheesy sauce',
                description: 'Rice, Garlic Potatoes',
                price: 180,
            },
        ],
        dinner: [
            { id: 'chicken-teriyaki', name: 'Chicken Teriyaki', description: 'Rice', price: 120 },
            {
                id: 'chicken-teriyaki-full',
                name: 'Chicken Teriyaki',
                description: 'Rice, Cabbage Stir Fry',
                price: 160,
            },
        ],
    },
    '2026-08-10': {
        lunch: [
            {
                id: 'roasted-chicken',
                name: 'Roasted Chicken with Gravy',
                description: 'Rice',
                price: 120,
            },
            {
                id: 'roasted-chicken-full',
                name: 'Roasted Chicken with Gravy',
                description: 'Rice, Buttered Veggies',
                price: 160,
            },
        ],
        dinner: [
            { id: 'pork-asado', name: 'Pork Asado', description: 'Rice', price: 140 },
            {
                id: 'pork-asado-full',
                name: 'Pork Asado',
                description: 'Rice, Bok Choy',
                price: 180,
            },
        ],
    },
    '2026-08-11': {
        lunch: [
            {
                id: 'hainanese',
                name: 'Hainanese Chicken with Ginger Sauce',
                description: 'Rice',
                price: 125,
            },
            {
                id: 'hainanese-full',
                name: 'Hainanese Chicken with Crispy Skin',
                description: 'Rice, Ginger Sauce, Sweet Soy, Cucumber',
                price: 160,
            },
        ],
        dinner: [
            { id: 'pork-salpicao', name: 'Pork Salpicao', description: 'Rice', price: 140 },
            {
                id: 'pork-salpicao-full',
                name: 'Pork Salpicao',
                description: 'Rice, Caesar Salad',
                price: 180,
            },
        ],
    },
    '2026-08-12': {
        lunch: [
            { id: 'buffalo-wings', name: 'Buffalo Wings', description: 'Rice', price: 120 },
            {
                id: 'buffalo-wings-full',
                name: 'Buffalo Wings',
                description: 'Rice, Ranch Salad',
                price: 160,
            },
        ],
        dinner: [{ id: 'beef-pares', name: 'Beef Pares', description: 'Rice', price: 140 }],
    },
};

export const CREW_MEAL_SUPPLIERS = [
    {
        id: 'olivia',
        name: "Olivia's Guilt-free Homemade Food",
        blurb: 'No hydrogenated oils · No preservatives · Refined sugar-free',
        layout: 'flat',
        // Temporarily hidden from merchant ordering UI — keep data for later.
        hidden: true,
    },
    {
        id: 'big-batch',
        name: 'Big Batch Club',
        blurb: 'Packed crew meals',
        layout: 'lunch-dinner',
    },
];

export function visibleCrewMealSuppliers() {
    return CREW_MEAL_SUPPLIERS.filter((s) => !s.hidden);
}

/**
 * @returns {{ periods: Array<{ key: string, label: string, items: Array }> } | null}
 */
export function menuForSupplierDate(supplierId, date) {
    if (supplierId === 'olivia') {
        const rotation = OLIVIA_BY_DATE[date];
        if (!rotation) return null;
        return {
            periods: [
                {
                    key: 'meal',
                    label: 'Meals',
                    items: rotation.map((item) => ({
                        ...item,
                        description: item.description || OLIVIA_INCLUDES,
                    })),
                },
            ],
        };
    }
    if (supplierId === 'big-batch') {
        const day = BIG_BATCH_BY_DATE[date];
        if (!day) return null;
        const periods = [];
        if (day.lunch?.length) periods.push({ key: 'lunch', label: 'Lunch', items: day.lunch });
        if (day.dinner?.length) periods.push({ key: 'dinner', label: 'Dinner', items: day.dinner });
        return periods.length ? { periods } : null;
    }
    return null;
}

export function lineKey(supplierId, periodKey, itemId) {
    return `${supplierId}::${periodKey}::${itemId}`;
}

export function parseLineKey(key) {
    const [supplierId, periodKey, itemId] = String(key || '').split('::');
    return { supplierId, periodKey, itemId };
}

export function formatCrewDateLabel(date) {
    const [y, m, d] = String(date || '')
        .split('-')
        .map(Number);
    if (!y || !m || !d) return date || '';
    return new Date(y, m - 1, d).toLocaleDateString('en-PH', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
}

/** Add calendar days to a YYYY-MM-DD string (date-only, no TZ shift). */
export function addCalendarDays(ymd, delta) {
    const [y, m, d] = String(ymd || '')
        .split('-')
        .map(Number);
    if (!y || !m || !d) return '';
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + Number(delta || 0));
    return dt.toISOString().slice(0, 10);
}

/** Hard cutoff: 6:00 PM Asia/Manila on the calendar day before delivery. */
export function crewOrderDeadlineMs(deliveryDate) {
    const dayBefore = addCalendarDays(deliveryDate, -1);
    if (!dayBefore) return 0;
    return Date.parse(`${dayBefore}T18:00:00+08:00`);
}

export function isCrewOrderOpen(deliveryDate, now = Date.now()) {
    const deadline = crewOrderDeadlineMs(deliveryDate);
    return Boolean(deadline) && now < deadline;
}

export function formatCrewOrderDeadlineLabel(deliveryDate) {
    const dayBefore = addCalendarDays(deliveryDate, -1);
    if (!dayBefore) return '6:00 PM the day before';
    const label = formatCrewDateLabel(dayBefore);
    return `6:00 PM on ${label}`;
}
