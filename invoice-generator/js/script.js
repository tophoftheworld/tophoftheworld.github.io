// ─── Firebase ────────────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.firebasestorage.app",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266"
};

let _firebaseDb = null;
let _firebaseModules = null;
let _firebaseApp = null;
let _functionsModules = null;

async function getFirebaseApp() {
    if (_firebaseApp) return _firebaseApp;
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js');
    const apps = getApps();
    _firebaseApp = apps.find(a => a.name === 'invoice-gen') ||
        initializeApp(FIREBASE_CONFIG, 'invoice-gen');
    return _firebaseApp;
}

async function getFirebaseDb() {
    if (_firebaseDb) return _firebaseDb;
    const app = await getFirebaseApp();
    const { getFirestore, collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, orderBy } =
        await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');

    _firebaseDb = getFirestore(app);
    _firebaseModules = { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, orderBy };
    return _firebaseDb;
}

async function getFirebaseFunctions() {
    if (_functionsModules) return _functionsModules;
    const app = await getFirebaseApp();
    const { getFunctions, httpsCallable } =
        await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js');
    const functions = getFunctions(app, 'us-central1');
    _functionsModules = { functions, httpsCallable };
    return _functionsModules;
}

// Event type constants
const EVENT_TYPES = {
    mobile_bar: 'mobile_bar',
    matcha_workshop: 'matcha_workshop',
    mochi_workshop: 'mochi_workshop'
};

const WORKSHOP_TITLES = {
    matcha_workshop: 'Private Matcha Workshop',
    mochi_workshop: 'Private Mochi Making Workshop'
};

const MATCHA_WORKSHOP_INCLUSIONS = [
    'Guided matcha workshop',
    'Use of all matcha tools during the session',
    'Two rounds of hands-on matcha making (one cup + one bottled drink to take home)',
    'Printed reference guides',
    'Sticker pack',
    'Mini tote bag',
    'Transportation within Metro Manila'
];

function getWorkshopInclusions(eventType) {
    if (eventType === EVENT_TYPES.matcha_workshop) {
        return [...MATCHA_WORKSHOP_INCLUSIONS];
    }
    return [];
}

function isWorkshopEventType(eventType) {
    return eventType === EVENT_TYPES.matcha_workshop || eventType === EVENT_TYPES.mochi_workshop;
}

function getEventType() {
    if (invoiceItems.length > 0) {
        return invoiceItems[0].eventType || EVENT_TYPES.mobile_bar;
    }
    return EVENT_TYPES.mobile_bar;
}

function migrateLoadedPackageItem(item, data) {
    const migrated = {
        ...item,
        eventVenue: item.eventVenue || data.eventVenue || '',
        eventDate: item.eventDate || data.eventDate || ''
    };
    if (!migrated.numberOfPax && migrated.cups) {
        const cupsMatch = String(migrated.cups).match(/\d+/);
        if (cupsMatch) migrated.numberOfPax = cupsMatch[0];
    }
    if (migrated.numberOfPax && !isStandardCupTier(migrated.numberOfPax) && migrated.numberOfPax !== 'custom') {
        const customN = parseInt(migrated.numberOfPax, 10);
        if (customN > 0) {
            migrated.customCups = String(customN);
            migrated.numberOfPax = 'custom';
        }
    }
    if (!migrated.packageType && migrated.eventType === EVENT_TYPES.mobile_bar && migrated.description) {
        for (const [key, pkg] of Object.entries(packages)) {
            if (pkg.name === migrated.description) {
                migrated.packageType = key;
                break;
            }
        }
    }
    if (migrated.coffeeAddOn == null) migrated.coffeeAddOn = false;
    if (!migrated.transportAddOn) migrated.transportAddOn = 'none';
    if (!Array.isArray(migrated.choiceDrinks)) migrated.choiceDrinks = [];
    if (migrated.durationHours == null || migrated.durationHours === '') {
        migrated.durationHours = 3;
    } else {
        migrated.durationHours = Number(migrated.durationHours) || 3;
    }
    syncPackageItem(migrated);
    return migrated;
}

// ─── LocalStorage Functions ───────────────────────────────────────────────────
function saveToLocalStorage() {
    const data = {
        invoiceNumber: document.getElementById('invoiceNumber').value,
        invoiceDate: document.getElementById('invoiceDate').value,
        clientName: document.getElementById('clientName').value,
        clientAddress: document.getElementById('clientAddress').value,
        clientTIN: document.getElementById('clientTIN').value,
        notes: document.getElementById('notes').value,
        invoiceItems: invoiceItems,
        customLineItems: customLineItems,
        paymentMilestones: paymentMilestones,
        paymentStructure: paymentStructure,
        paymentTermsCustomized: paymentTermsCustomized,
        _cloudDocId: _currentCloudDocId || null
    };
    localStorage.setItem('invoiceGeneratorData', JSON.stringify(data));
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem('invoiceGeneratorData');
    if (!saved) return false;
    
    try {
        const data = JSON.parse(saved);
        
        if (data.invoiceNumber) document.getElementById('invoiceNumber').value = data.invoiceNumber;
        if (data.invoiceDate) document.getElementById('invoiceDate').value = data.invoiceDate;
        if (data.clientName) document.getElementById('clientName').value = data.clientName;
        if (data.clientAddress) document.getElementById('clientAddress').value = data.clientAddress;
        if (data.clientTIN) document.getElementById('clientTIN').value = data.clientTIN;
        if (data.notes) document.getElementById('notes').value = data.notes;
        
        if (data.invoiceItems) {
            invoiceItems = data.invoiceItems.map(item => migrateLoadedPackageItem(item, data));
        }
        if (data.customLineItems) customLineItems = data.customLineItems;
        if (data.paymentMilestones) paymentMilestones = data.paymentMilestones;
        if (data.paymentStructure) paymentStructure = data.paymentStructure;
        if (data.paymentTermsCustomized !== undefined) paymentTermsCustomized = !!data.paymentTermsCustomized;
        normalizePaymentMilestones();
        if (data._cloudDocId) _currentCloudDocId = data._cloudDocId;
        
        return true;
    } catch (e) {
        console.error('Error loading from localStorage:', e);
        return false;
    }
}

function clearLocalStorage() {
    if (confirm('Are you sure you want to clear all saved data? This cannot be undone.')) {
        localStorage.removeItem('invoiceGeneratorData');
        location.reload();
    }
}

// Pending draft applied on every load until cleared (set to null after download).
const PENDING_INVOICE_DRAFT = null;

function applyInvoicePreset(data) {
    document.getElementById('invoiceNumber').value = data.invoiceNumber || '';
    document.getElementById('invoiceDate').value = data.invoiceDate || '';
    document.getElementById('clientName').value = data.clientName || '';
    document.getElementById('clientAddress').value = data.clientAddress || '';
    document.getElementById('clientTIN').value = data.clientTIN || '';
    document.getElementById('notes').value = data.notes || '';

    invoiceItems = (data.invoiceItems || []).map(item => migrateLoadedPackageItem({ ...item }, data));
    customLineItems = data.customLineItems || [];
    paymentMilestones = data.paymentMilestones || [];
    paymentStructure = data.paymentStructure || 'three';
    paymentTermsCustomized = !!data.paymentTermsCustomized;
    normalizePaymentMilestones();
}

// Initialize runs at end of file (initInvoicePage).

// Package data structure
const MOBILE_BAR_COFFEE_ADDON_FEE = 3500;

const MOBILE_BAR_TRANSPORT_ADDONS = {
    none: { label: 'Metro Manila (included)', fee: 0 },
    laguna: { label: 'Laguna', fee: 3000 },
    bulacan: { label: 'Bulacan', fee: 3000 },
    tagaytay: { label: 'Tagaytay', fee: 5000 },
    pampanga: { label: 'Pampanga', fee: 5000 }
};

/** Legacy combined-tier keys → specific destination (older drafts). */
const MOBILE_BAR_TRANSPORT_ALIASES = {
    laguna_bulacan: 'laguna',
    tagaytay_pampanga: 'tagaytay'
};

const MOBILE_BAR_MM_TRANSPORT_LABEL = 'Transportation within Metro Manila';

const MOBILE_BAR_STANDARD_INCLUSIONS = [
    'Mobile Matcha Bar Setup',
    'Ingredients, cups, ice, and standard supplies',
    MOBILE_BAR_MM_TRANSPORT_LABEL
];

const MOBILE_BAR_ADDITIONAL_OPTIONS = [
    'Iced (12oz) Drinks',
    'Dairy or Oat Milk (choose one)'
];

/** Two fixed signature drinks included in every Mobile Matcha Bar package. */
const MOBILE_BAR_SIGNATURE_DRINKS = ['Signature Matchanese Latte', 'Hojicha Latte'];

const MOBILE_BAR_CHOICE_CATALOG = [
    'Strawberry Matchanese Latte',
    'Matchanese Seasalt Latte',
    'Spanish Matchanese Latte',
    'Matchanese Sunrise',
    'Matchanese Coconut',
    'Earl Grey Matchanese Latte',
    'Salted Caramel Matchanese Latte',
    'White Chocolate Matchanese Latte',
    'Blueberry Matchanese Latte',
    'Peach Mango Matchanese Latte',
    'Americano',
    'Kyoto Latte',
    'Spanish Latte',
    'Matchanese Espresso',
    'Seasalt Latte'
];

const CHOICE_DRINK_ALIASES = {
    'strawberry matchanese latte': 'Strawberry Matchanese Latte',
    'strawberry matcha latte': 'Strawberry Matchanese Latte',
    'strawberry matcha': 'Strawberry Matchanese Latte',
    'matchanese seasalt latte': 'Matchanese Seasalt Latte',
    'matcha seasalt latte': 'Matchanese Seasalt Latte',
    'matcha seasalt': 'Matchanese Seasalt Latte',
    'seasalt matcha': 'Matchanese Seasalt Latte',
    'seasalt latte': 'Matchanese Seasalt Latte',
    'sea salt latte': 'Matchanese Seasalt Latte',
    'spanish matchanese latte': 'Spanish Matchanese Latte',
    'matchanese sunrise': 'Matchanese Sunrise',
    'matchanese coconut': 'Matchanese Coconut',
    'earl grey matchanese latte': 'Earl Grey Matchanese Latte',
    'earl grey matcha': 'Earl Grey Matchanese Latte',
    'salted caramel matchanese latte': 'Salted Caramel Matchanese Latte',
    'salted caramel': 'Salted Caramel Matchanese Latte',
    'white chocolate matchanese latte': 'White Chocolate Matchanese Latte',
    'white chocolate': 'White Chocolate Matchanese Latte',
    'blueberry matchanese latte': 'Blueberry Matchanese Latte',
    'blueberry': 'Blueberry Matchanese Latte',
    'peach mango matchanese latte': 'Peach Mango Matchanese Latte',
    'peach mango': 'Peach Mango Matchanese Latte',
    'cafe americano': 'Americano',
    'americano': 'Americano',
    'kyoto latte': 'Kyoto Latte',
    'spanish latte': 'Spanish Matchanese Latte',
    'coffee spanish latte': 'Spanish Latte',
    'matchanese espresso': 'Matchanese Espresso',
    'espresso': 'Matchanese Espresso',
    'coffee seasalt latte': 'Seasalt Latte',
    'coffee seasalt': 'Seasalt Latte'
};

const COFFEE_DRINKS = [
    'Americano',
    'Kyoto Latte',
    'Spanish Latte',
    'Matchanese Espresso',
    'Seasalt Latte'
];
const MILK_OAT_OPTIONS = ['Iced (12oz) Drinks', 'Oat Milk'];
const MILK_DAIRY_OPTIONS = ['Iced (12oz) Drinks', 'Dairy Milk'];
const MILK_DUAL_OPTIONS = ['Iced (12oz) Drinks', 'Dairy and Oat Milk'];

/** Bare "Matcha Latte" etc. = Signature Matchanese Latte base — never a Choice slot. */
function isBaseDrinkSynonym(key) {
    const k = String(key || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    if (!k) return false;
    if (MOBILE_BAR_SIGNATURE_DRINKS.some((d) => d.toLowerCase() === k)) return true;
    return (
        k === 'matcha latte' ||
        k === 'matcha' ||
        k === 'signature matcha' ||
        k === 'signature matcha latte' ||
        k === 'signature matchanese' ||
        k === 'matchanese latte' ||
        k === 'hojicha' ||
        k === 'hojicha matcha'
    );
}

function normalizeChoiceDrinkName(name, coffeeAddOn = false) {
    const t = String(name || '').trim();
    if (!t) return '';
    const key = t.toLowerCase().replace(/\s+/g, ' ');
    if (isBaseDrinkSynonym(key)) return '';
    if (coffeeAddOn && (key === 'coffee seasalt latte' || key === 'coffee seasalt')) {
        return 'Seasalt Latte';
    }
    if (coffeeAddOn && (key === 'coffee spanish latte' || key === 'spanish latte coffee')) {
        return 'Spanish Latte';
    }
    if (CHOICE_DRINK_ALIASES[key]) {
        const mapped = CHOICE_DRINK_ALIASES[key];
        if (mapped === 'Seasalt Latte' && !coffeeAddOn) return 'Matchanese Seasalt Latte';
        if (mapped === 'Spanish Latte' && key === 'spanish latte' && !coffeeAddOn) {
            return 'Spanish Matchanese Latte';
        }
        return mapped;
    }
    if (key === 'seasalt latte' || key === 'sea salt latte') return 'Matchanese Seasalt Latte';
    const exact = MOBILE_BAR_CHOICE_CATALOG.find((d) => d.toLowerCase() === key);
    if (exact) {
        if (exact === 'Seasalt Latte' && !coffeeAddOn) return 'Matchanese Seasalt Latte';
        return exact;
    }
    const withoutLatte = key.replace(/\s+latte$/, '');
    const soft = MOBILE_BAR_CHOICE_CATALOG.find((d) => d.toLowerCase() === withoutLatte);
    if (soft) return soft;
    return t;
}

function findChoiceDrinkIndex(list, query, coffeeAddOn = false) {
    const q = String(query || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    if (!q) return -1;
    const arr = Array.isArray(list) ? list : [];
    const normalizedQ = normalizeChoiceDrinkName(query, coffeeAddOn);
    for (let i = 0; i < arr.length; i++) {
        const raw = String(arr[i] || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
        if (!raw) continue;
        if (raw === q) return i;
        if (isBaseDrinkSynonym(q) && isBaseDrinkSynonym(raw)) return i;
        if (normalizedQ) {
            const n = normalizeChoiceDrinkName(arr[i], coffeeAddOn);
            if (n && n.toLowerCase() === normalizedQ.toLowerCase()) return i;
        }
        if (q.length >= 4 && (raw.includes(q) || q.includes(raw))) return i;
    }
    return -1;
}

function applyChoiceDrinkEditsFromText(existing, userText, maxSlots, coffeeAddOn = false) {
    const raw = String(userText || '');
    let list = Array.isArray(existing) ? existing.slice() : [];

    const removeQueries = [];
    const replaceRe =
        /\b(?:replace|swap)\s+(?:the\s+)?(?:duplicate\s+)?(.+?)\s+(?:with|for|to|wiht)\s+/gi;
    let m;
    while ((m = replaceRe.exec(raw)) !== null) {
        removeQueries.push(m[1].trim());
    }
    if (/\b(?:replace|swap)\s+(?:it|that|this|the\s+duplicate)\s+(?:with|for|to|wiht)\b/i.test(raw)) {
        if (list.some((d) => isBaseDrinkSynonym(String(d || '').toLowerCase().replace(/\s+/g, ' ')))) {
            removeQueries.push('Matcha Latte');
        }
    }
    const removeRe =
        /\b(?:remove|drop|delete|take\s+out)\s+(?:the\s+)?(?:duplicate\s+)?([A-Za-z][A-Za-z0-9 &'()-]*?)(?=\s+(?:and|from|please|on|in)|[.!?,]|$)/gi;
    while ((m = removeRe.exec(raw)) !== null) {
        removeQueries.push(m[1].trim());
    }
    if (/\b(?:remove|drop|delete)\s+(?:the\s+)?duplicate\b/i.test(raw)) {
        removeQueries.push('Matcha Latte');
    }

    for (const q of removeQueries) {
        let idx = findChoiceDrinkIndex(list, q, coffeeAddOn);
        while (idx >= 0) {
            list.splice(idx, 1);
            idx = findChoiceDrinkIndex(list, q, coffeeAddOn);
        }
        if (isBaseDrinkSynonym(q) || /matcha\s+latte/i.test(q)) {
            list = list.filter(
                (d) => !isBaseDrinkSynonym(String(d || '').toLowerCase().replace(/\s+/g, ' '))
            );
        }
    }

    const mentioned = extractChoiceDrinksFromUserText(raw, coffeeAddOn);
    return normalizeChoiceDrinksList([...list, ...mentioned], maxSlots, coffeeAddOn);
}

function normalizeChoiceDrinksList(list, maxSlots, coffeeAddOn = false) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
        const name = normalizeChoiceDrinkName(raw, coffeeAddOn);
        if (!name) continue;
        const k = name.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(name);
    }
    if (maxSlots != null && maxSlots >= 0) return out.slice(0, maxSlots);
    return out;
}

function choiceSlotsForPackageType(packageType) {
    if (packageType === 'signature') return 3;
    if (packageType === 'special') return 5;
    if (packageType === 'starter') return 1;
    return 1;
}

function extractChoiceDrinksFromUserText(text, includeCoffee = true) {
    const raw = String(text || '');
    if (!raw.trim()) return [];
    const coffeeAddOn = !!includeCoffee;
    const catalog = (includeCoffee
        ? MOBILE_BAR_CHOICE_CATALOG
        : MOBILE_BAR_CHOICE_CATALOG.filter((d) => !COFFEE_DRINKS.includes(d))
    )
        .slice()
        .sort((a, b) => b.length - a.length);
    const found = [];
    const lower = raw.toLowerCase();
    const usedRanges = [];
    for (const drink of catalog) {
        const idx = lower.indexOf(drink.toLowerCase());
        if (idx < 0) continue;
        const end = idx + drink.length;
        if (usedRanges.some(([s, e]) => idx < e && end > s)) continue;
        if (drink === 'Seasalt Latte' && lower.includes('matcha seasalt')) continue;
        usedRanges.push([idx, end]);
        found.push(normalizeChoiceDrinkName(drink, coffeeAddOn));
    }
    for (const [alias, canonical] of Object.entries(CHOICE_DRINK_ALIASES)) {
        if (!includeCoffee && COFFEE_DRINKS.includes(canonical)) continue;
        const idx = lower.indexOf(alias);
        if (idx < 0) continue;
        const end = idx + alias.length;
        if (usedRanges.some(([s, e]) => idx < e && end > s)) continue;
        usedRanges.push([idx, end]);
        const name = normalizeChoiceDrinkName(canonical, coffeeAddOn);
        if (name && !found.includes(name)) found.push(name);
    }
    return found.filter(Boolean);
}

function parseMilkOptionsFromUserText(text) {
    const raw = String(text || '');
    if (!raw.trim()) return null;
    if (
        /\bdual\s+milk\b/i.test(raw) ||
        /\bboth\s+(dairy|oat)\b/i.test(raw) ||
        /\bdairy\s+and\s+oat\b/i.test(raw) ||
        /\boat\s+and\s+dairy\b/i.test(raw)
    ) {
        return [...MILK_DUAL_OPTIONS];
    }
    if (/\bdairy\s+or\s+oat\b/i.test(raw)) return [...MOBILE_BAR_ADDITIONAL_OPTIONS];
    if (/\boat\s*milk\b/i.test(raw) || (/\boat\b/i.test(raw) && /\b(milk|please)\b/i.test(raw))) {
        return [...MILK_OAT_OPTIONS];
    }
    if (/\bdairy\s*milk\b/i.test(raw) || (/\bdairy\b/i.test(raw) && /\bmilk\b/i.test(raw))) {
        return [...MILK_DAIRY_OPTIONS];
    }
    return null;
}

function isAddressSearchRequest(text) {
    const raw = String(text || '');
    return /\b(search|look\s*up|find|google)\b/i.test(raw) && /\baddress\b/i.test(raw);
}

function isContaminatedAddress(value) {
    const s = String(value || '');
    if (!s.trim()) return false;
    return (
        /\b(search|look\s*up|find|google|add\s+it\s+here|and\s+add\s+it)\b/i.test(s) ||
        /^of\s+/i.test(s.trim()) ||
        s.length > 80
    );
}

function wantsThreeMilestones(text) {
    const raw = String(text || '');
    return (
        /\b(?:3|three)\s*[- ]?(?:payment\s+)?milestones?\b/i.test(raw) ||
        /\b(?:3|three)\s*payments?\b/i.test(raw) ||
        /\bpayment\s+(?:in\s+)?(?:3|three)\b/i.test(raw) ||
        /\bmake\s+the\s+payment\s+(?:3|three)\b/i.test(raw)
    );
}

function wantsTwoMilestones(text) {
    const raw = String(text || '');
    return (
        /\b(?:2|two)\s*[- ]?(?:payment\s+)?milestones?\b/i.test(raw) ||
        /\b(?:2|two)\s*payments?\b/i.test(raw)
    );
}

/**
 * Resolve packageType from user text.
 * Change/upgrade phrases win; complaint "still shows starter" does not select starter.
 */
function resolvePackageTypeFromText(text) {
    const raw = String(text || '');
    if (!raw.trim()) return null;

    const changeRe =
        /\b(?:change|switch|upgrade|make(?:\s+it)?|use|set)(?:\s+(?:it|the\s+package|package|this))?\s+(?:from\s+\w+\s+)?(?:to\s+)?(starter|signature|special)\b/gi;
    let lastChange = null;
    let m;
    while ((m = changeRe.exec(raw)) !== null) {
        lastChange = m[1].toLowerCase();
    }
    if (lastChange) return lastChange;

    const toPkg = [...raw.matchAll(/\bto\s+(?:the\s+)?(starter|signature|special)(?:\s+package)?\b/gi)];
    if (toPkg.length) return toPkg[toPkg.length - 1][1].toLowerCase();

    if (
        /\b(still\s+shows?|still\s+say(?:s|ing)?|showing|displays?|on\s+the\s+(?:doc|invoice|preview))\b/i.test(raw) &&
        /\b(starter|signature|special)\b/i.test(raw)
    ) {
        return null;
    }

    const found = [];
    if (/\bstarter\b/i.test(raw)) found.push('starter');
    if (/\bsignature\b/i.test(raw)) found.push('signature');
    if (/\bspecial\b/i.test(raw)) found.push('special');
    const unique = [...new Set(found)];
    if (unique.length === 1) return unique[0];
    return null;
}

/** Invoice Menu lines: 2 fixed signatures + named choice drinks OR slot placeholder. */
function buildMobileBarMenuLines(choiceSlots, coffeeAddOn, choiceDrinks) {
    const n = parseInt(choiceSlots, 10) || 0;
    const named = normalizeChoiceDrinksList(choiceDrinks, Math.max(n, 0));

    const lines = [...MOBILE_BAR_SIGNATURE_DRINKS];
    if (named.length) {
        named.slice(0, Math.max(n, named.length)).forEach((drink) => {
            lines.push(drink);
        });
        const remaining = n - named.length;
        if (remaining > 0) {
            const choiceLabel =
                remaining === 1
                    ? '1 additional drink of choice'
                    : `${remaining} additional drinks of choice`;
            lines.push(choiceLabel);
        }
    } else if (n > 0) {
        const choiceLabel =
            n === 1 ? '1 additional drink of choice' : `${n} additional drinks of choice`;
        lines.push(choiceLabel);
    }
    return lines;
}

function getMobileBarTransportKey(item) {
    let key = item.transportAddOn || 'none';
    if (MOBILE_BAR_TRANSPORT_ALIASES[key]) key = MOBILE_BAR_TRANSPORT_ALIASES[key];
    return MOBILE_BAR_TRANSPORT_ADDONS[key] ? key : 'none';
}

/** Transport dropdown: individual destinations grouped by fee tier. */
function renderTransportOptions(item) {
    const selected = getMobileBarTransportKey(item);
    const opt = (val, label) => `<option value="${val}" ${selected === val ? 'selected' : ''}>${label}</option>`;
    return `
        ${opt('none', 'None — Metro Manila included')}
        <optgroup label="Outside Metro Manila (+₱3,000)">
            ${opt('laguna', 'Laguna')}
            ${opt('bulacan', 'Bulacan')}
        </optgroup>
        <optgroup label="Outside Metro Manila (+₱5,000)">
            ${opt('tagaytay', 'Tagaytay')}
            ${opt('pampanga', 'Pampanga')}
        </optgroup>`;
}

/** Add-ons billed as their own invoice rows (not folded into package price). */
function getPackageAddonLineItems(item) {
    if (isWorkshopItem(item) || !item.packageType || item.packageType === 'custom') return [];
    if (!resolveMobileBarCups(item)) return [];

    const addons = [];
    if (item.coffeeAddOn) {
        addons.push({
            name: 'Coffee Add-On',
            quantity: 1,
            price: MOBILE_BAR_COFFEE_ADDON_FEE
        });
    }
    const transportKey = getMobileBarTransportKey(item);
    const transport = MOBILE_BAR_TRANSPORT_ADDONS[transportKey];
    if (transportKey !== 'none' && transport.fee > 0) {
        addons.push({
            name: `Transportation — ${transport.label}`,
            quantity: 1,
            price: transport.fee
        });
    }
    return addons;
}

function getMobileBarBaristaLabel(cups) {
    const n = parseInt(cups, 10) || 0;
    if (n <= 0) return 'Minimum 3 On-Site Baristas';
    if (n <= 100) return 'Minimum 3 On-Site Baristas';
    const blocks = Math.ceil((n - 100) / 50);
    const min = 3 + blocks;
    const max = 3 + blocks * 2;
    return min === max ? `${min} On-Site Baristas` : `${min}–${max} On-Site Baristas`;
}

const packages = {
    starter: {
        name: 'Mobile Matcha Bar - STARTER PACKAGE',
        choiceSlots: 1,
        totalSlots: 3,
        additionalOptions: [...MOBILE_BAR_ADDITIONAL_OPTIONS],
        otherInclusions: [...MOBILE_BAR_STANDARD_INCLUSIONS],
        rates: {
            100: 29500,
            150: 43500
        }
    },
    signature: {
        name: 'Mobile Matcha Bar - SIGNATURE PACKAGE',
        choiceSlots: 3,
        totalSlots: 5,
        additionalOptions: [...MOBILE_BAR_ADDITIONAL_OPTIONS],
        otherInclusions: [...MOBILE_BAR_STANDARD_INCLUSIONS],
        rates: {
            100: 32500,
            150: 46750
        }
    },
    special: {
        name: 'Mobile Matcha Bar - SPECIAL PACKAGE',
        choiceSlots: 5,
        totalSlots: 7,
        additionalOptions: [...MOBILE_BAR_ADDITIONAL_OPTIONS],
        otherInclusions: [...MOBILE_BAR_STANDARD_INCLUSIONS],
        rates: {
            100: 36000,
            150: 52000
        }
    }
};

const MOBILE_BAR_CUP_TIERS = [100, 150];
const STANDARD_CUP_TIER_VALUES = new Set(MOBILE_BAR_CUP_TIERS.map(String));

function isStandardCupTier(value) {
    return STANDARD_CUP_TIER_VALUES.has(String(value));
}

function computeMobileBarPackagePrice(packageData, cups) {
    const n = parseInt(cups, 10);
    if (!packageData?.rates || !n || n <= 0) return 0;
    if (packageData.rates[n] != null) return packageData.rates[n];

    const rates = packageData.rates;
    const tiers = MOBILE_BAR_CUP_TIERS;
    let lower;
    let upper;

    if (n < tiers[0]) {
        lower = tiers[0];
        upper = tiers[1];
    } else if (n > tiers[tiers.length - 1]) {
        lower = tiers[tiers.length - 2];
        upper = tiers[tiers.length - 1];
    } else {
        for (let i = 0; i < tiers.length - 1; i++) {
            if (n > tiers[i] && n < tiers[i + 1]) {
                lower = tiers[i];
                upper = tiers[i + 1];
                break;
            }
        }
    }

    const slope = (rates[upper] - rates[lower]) / (upper - lower);
    const anchor = n > tiers[tiers.length - 1] ? upper : lower;
    return Math.round(rates[anchor] + (n - anchor) * slope);
}

function resolveMobileBarCups(item) {
    if (item.numberOfPax === 'custom') {
        return parseInt(item.customCups, 10) || 0;
    }
    if (isStandardCupTier(item.numberOfPax)) {
        return parseInt(item.numberOfPax, 10);
    }
    const legacy = parseInt(item.numberOfPax, 10);
    return legacy > 0 ? legacy : 0;
}

function parsePriceOverride(value) {
    if (value == null || value === '') return null;
    const n = parseFloat(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

function getMobileBarAutoPrice(item) {
    const packageData = packages[item?.packageType];
    const cups = resolveMobileBarCups(item);
    if (!packageData || !cups) return 0;
    return computeMobileBarPackagePrice(packageData, cups);
}

function resolveMobileBarUnitPrice(item) {
    const override = parsePriceOverride(item.priceOverride);
    return override != null ? override : getMobileBarAutoPrice(item);
}

function refreshPriceOverrideField(item) {
    const input = document.querySelector(`.pkg-price-override[data-id="${item.id}"]`);
    if (!input) return;
    const auto = getMobileBarAutoPrice(item);
    input.placeholder = auto > 0 ? String(auto) : 'Standard package rate';
    const hint = input.parentElement && input.parentElement.querySelector('.pkg-price-override-hint');
    if (hint) {
        hint.textContent = auto > 0
            ? `Leave blank to use the standard rate (₱${formatCurrency(auto)})`
            : 'Leave blank to use the standard package rate';
    }
}

// Invoice items array
let invoiceItems = [];
let paymentMilestones = [];
let customLineItems = [];

// Payment terms configuration
// paymentStructure: 'three' (Reservation / Pre-Event / Completion) or 'two' (Down / Final)
// paymentTermsCustomized: when true, auto date/percentage logic is suspended so the
// user's manual edits stick. When false, milestones follow the default logic rules.
let paymentStructure = 'three';
let paymentTermsCustomized = false;

function isWorkshopItem(item) {
    return item.isWorkshop || isWorkshopEventType(item.eventType);
}

function getDefaultPackageDate() {
    const invoiceDate = document.getElementById('invoiceDate').value;
    if (invoiceDate) return invoiceDate;
    return formatDateToLocal(new Date());
}

function createEmptyPackageItem() {
    const eventType = EVENT_TYPES.matcha_workshop;
    return {
        id: Date.now() + invoiceItems.length,
        eventType: eventType,
        eventVenue: '',
        eventDate: getDefaultPackageDate(),
        description: WORKSHOP_TITLES[eventType],
        cups: '',
        countLabel: 'participants',
        isWorkshop: true,
        workshopInclusions: getWorkshopInclusions(eventType),
        workshopDetails: '',
        quantity: 0,
        unitCost: '',
        menuItems: [],
        choiceDrinks: [],
        additionalOptions: [],
        otherInclusions: [],
        duration: '',
        durationHours: 3,
        serviceWindow: [],
        baristas: '',
        unitPrice: 0,
        packageType: '',
        numberOfPax: '',
        customCups: '',
        coffeeAddOn: false,
        transportAddOn: 'none',
        priceOverride: ''
    };
}

function syncWorkshopItem(item, { resetInclusions = false } = {}) {
    item.isWorkshop = true;
    item.countLabel = 'participants';
    item.description = WORKSHOP_TITLES[item.eventType] || '';
    if (resetInclusions || item.workshopInclusions == null) {
        item.workshopInclusions = getWorkshopInclusions(item.eventType);
    }
    const pax = parseInt(item.cups, 10) || 0;
    item.quantity = pax;
    const unitCost = parseFloat(item.unitCost) || 0;
    item.unitPrice = pax > 0 && unitCost > 0 ? pax * unitCost : 0;
}

function inclusionsToTextarea(list) {
    return (list || [])
        .map((entry) => String(entry).replace(/\n+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
}

function textareaToInclusions(text) {
    return String(text || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

function syncMobileItem(item) {
    item.isWorkshop = false;
    item.countLabel = 'cups';
    if (!item.packageType || item.packageType === 'custom') {
        item.description = '';
        item.unitPrice = 0;
        item.menuItems = [];
        refreshPriceOverrideField(item);
        return;
    }
    const cups = resolveMobileBarCups(item);
    if (!cups) {
        item.description = '';
        item.unitPrice = 0;
        item.menuItems = [];
        refreshPriceOverrideField(item);
        return;
    }
    const packageData = packages[item.packageType];
    if (!packageData) {
        refreshPriceOverrideField(item);
        return;
    }
    const coffeeAddOn = !!item.coffeeAddOn;
    const transportKey = getMobileBarTransportKey(item);
    item.transportAddOn = transportKey;

    if (item.durationHours == null || item.durationHours === '' || Number(item.durationHours) <= 0) {
        item.durationHours = 3;
    } else {
        item.durationHours = Number(item.durationHours);
    }
    if (!Array.isArray(item.choiceDrinks)) item.choiceDrinks = [];
    item.choiceDrinks = normalizeChoiceDrinksList(
        item.choiceDrinks,
        packageData.choiceSlots,
        coffeeAddOn
    );

    // Package line is base price only — add-ons are separate invoice rows
    item.description = packageData.name;
    item.cups = `${cups} Cups`;
    item.menuItems = buildMobileBarMenuLines(
        packageData.choiceSlots,
        coffeeAddOn,
        item.choiceDrinks
    );
    const defaultOpts = [...(packageData.additionalOptions || MOBILE_BAR_ADDITIONAL_OPTIONS)];
    const currentOpts = Array.isArray(item.additionalOptions)
        ? item.additionalOptions.map((o) => String(o).trim()).filter(Boolean)
        : [];
    if (!currentOpts.length) {
        item.additionalOptions = defaultOpts;
    }
    // else keep custom serving/milk wording from AI or manual edit
    const baseInclusions = packageData.otherInclusions.filter((inc) => {
        if (transportKey !== 'none' && inc === MOBILE_BAR_MM_TRANSPORT_LABEL) return false;
        return true;
    });
    const extra = (item.otherInclusions || [])
        .map((x) => String(x).trim())
        .filter(Boolean)
        .filter((inc) => !baseInclusions.includes(inc));
    item.otherInclusions = [...baseInclusions, ...extra];
    item.duration = `${item.durationHours} Hours of Service`;
    item.serviceWindow = ['1 Hour Ingress (Setup)', '1 Hour Egress (Teardown)'];
    item.baristas = getMobileBarBaristaLabel(cups);
    item.unitPrice = resolveMobileBarUnitPrice(item);
    refreshPriceOverrideField(item);
}

function syncPackageItem(item) {
    if (isWorkshopItem(item)) {
        syncWorkshopItem(item);
    } else {
        syncMobileItem(item);
    }
}

function getInvoiceEventDate() {
    const dates = invoiceItems.map(item => item.eventDate).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1] : '';
}

/** Show draft packages even when cups/rate are still incomplete. */
function isPackageVisibleInPreview(item) {
    if (!item) return false;
    if (isWorkshopItem(item) || isWorkshopEventType(item.eventType)) {
        return true;
    }
    return !!(item.packageType && item.packageType !== 'custom');
}

function addPackage() {
    invoiceItems.push(createEmptyPackageItem());
    renderInvoiceItems();
    updatePreview();
    saveToLocalStorage();
    const forms = document.querySelectorAll('.package-form');
    if (forms.length) {
        forms[forms.length - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function removeInvoiceItem(itemId) {
    invoiceItems = invoiceItems.filter(item => item.id !== itemId);
    renderInvoiceItems();
    updatePreview();
    saveToLocalStorage();
}

function getPackageChoiceSlotCount(item) {
    const pkg = packages[item?.packageType];
    return pkg ? (parseInt(pkg.choiceSlots, 10) || 0) : 0;
}

function renderChoiceDrinkInputs(item) {
    const slots = getPackageChoiceSlotCount(item);
    if (slots <= 0) {
        return '<p class="pkg-choice-drinks-hint">Select a package to name drinks of choice.</p>';
    }
    const drinks = Array.isArray(item.choiceDrinks) ? item.choiceDrinks : [];
    const inputs = [];
    for (let i = 0; i < slots; i++) {
        inputs.push(`
            <input type="text" class="pkg-choice-drink" data-id="${item.id}" data-slot="${i}"
                placeholder="Choice drink ${i + 1}" value="${escapeHtml(String(drinks[i] || ''))}">
        `);
    }
    return `<div class="pkg-choice-drinks-list">${inputs.join('')}</div>`;
}

function renderPackageFormFields(item, index) {
    const isWorkshop = isWorkshopEventType(item.eventType);
    const legacyCups = (String(item.cups || '').match(/\d+/) || [])[0] || '';
    const isCustomCups = item.numberOfPax === 'custom' ||
        (item.numberOfPax && !isStandardCupTier(item.numberOfPax));
    const selectCupsVal = item.numberOfPax === 'custom' ? 'custom'
        : isStandardCupTier(item.numberOfPax) ? item.numberOfPax : '';
    const customCupsVal = item.customCups ||
        (isCustomCups && !isStandardCupTier(item.numberOfPax) ? item.numberOfPax : '') ||
        (isCustomCups ? legacyCups : '');
    const paxVal = isWorkshop ? (item.cups || '') : '';
    const perPaxVal = item.unitCost != null && item.unitCost !== '' ? item.unitCost : '';
    const autoPrice = isWorkshop ? 0 : getMobileBarAutoPrice(item);
    const priceOverrideVal = item.priceOverride != null && item.priceOverride !== '' ? item.priceOverride : '';
    const autoPricePlaceholder = autoPrice > 0 ? String(autoPrice) : 'Standard package rate';
    const autoPriceHint = autoPrice > 0
        ? `Leave blank to use the standard rate (₱${formatCurrency(autoPrice)})`
        : 'Leave blank to use the standard package rate';

    return `
        <div class="package-form" data-id="${item.id}">
            <div class="package-form-header">
                <h3>Package ${index + 1}</h3>
                <button type="button" class="package-form-remove" onclick="removeInvoiceItem(${item.id})">Remove</button>
            </div>
            <div class="form-group">
                <label>Type of Event</label>
                <select class="pkg-event-type" data-id="${item.id}">
                    <option value="mobile_bar" ${item.eventType === EVENT_TYPES.mobile_bar ? 'selected' : ''}>Mobile Matcha Bar</option>
                    <option value="matcha_workshop" ${item.eventType === EVENT_TYPES.matcha_workshop ? 'selected' : ''}>Private Matcha Workshop</option>
                    <option value="mochi_workshop" ${item.eventType === EVENT_TYPES.mochi_workshop ? 'selected' : ''}>Private Mochi Making Workshop</option>
                </select>
            </div>
            <div class="form-group">
                <label>Venue</label>
                <input type="text" class="pkg-venue" data-id="${item.id}" placeholder="e.g., Sunken Garden, Greenbelt 5" value="${escapeHtml(item.eventVenue || '')}">
            </div>
            <div class="form-group">
                <label>Event Date</label>
                <input type="date" class="pkg-date" data-id="${item.id}" value="${item.eventDate || ''}">
            </div>
            <div class="pkg-mobile-fields ${isWorkshop ? 'is-hidden' : ''}">
                <div class="form-group">
                    <label>Package</label>
                    <select class="pkg-package-type" data-id="${item.id}">
                        <option value="">Select Package</option>
                        <option value="starter" ${item.packageType === 'starter' ? 'selected' : ''}>Starter Package</option>
                        <option value="signature" ${item.packageType === 'signature' ? 'selected' : ''}>Signature Package</option>
                        <option value="special" ${item.packageType === 'special' ? 'selected' : ''}>Special Package</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Number of Cups</label>
                    <select class="pkg-number-of-pax" data-id="${item.id}">
                        <option value="">Select Number of Cups</option>
                        <option value="100" ${selectCupsVal === '100' ? 'selected' : ''}>100 cups</option>
                        <option value="150" ${selectCupsVal === '150' ? 'selected' : ''}>150 cups</option>
                        <option value="custom" ${selectCupsVal === 'custom' ? 'selected' : ''}>Custom</option>
                    </select>
                </div>
                <div class="form-group pkg-custom-cups-wrap ${selectCupsVal === 'custom' ? '' : 'is-hidden'}">
                    <label>Custom Number of Cups</label>
                    <input type="number" class="pkg-custom-cups" data-id="${item.id}" min="100" step="1" placeholder="e.g., 200 (min 100)" value="${escapeHtml(String(customCupsVal))}">
                </div>
                <div class="form-group">
                    <label>Hours of Service</label>
                    <input type="number" class="pkg-duration-hours" data-id="${item.id}" min="1" max="24" step="1" value="${escapeHtml(String(item.durationHours != null && item.durationHours !== '' ? item.durationHours : 3))}">
                </div>
                <div class="form-group">
                    <label>Package Amount (₱)</label>
                    <input type="number" class="pkg-price-override" data-id="${item.id}" min="0" step="0.01"
                        placeholder="${escapeHtml(autoPricePlaceholder)}" value="${escapeHtml(String(priceOverrideVal))}">
                    <p class="form-hint pkg-price-override-hint">${autoPriceHint}</p>
                </div>
                <div class="form-group pkg-choice-drinks-wrap">
                    <label>Drinks of Choice</label>
                    ${renderChoiceDrinkInputs(item)}
                </div>
                <div class="pkg-addons-block">
                    <h4 class="pkg-addons-heading">Add-ons</h4>
                    <div class="form-group">
                        <label class="pkg-checkbox-label">
                            <input type="checkbox" class="pkg-coffee-addon" data-id="${item.id}" ${item.coffeeAddOn ? 'checked' : ''}>
                            Coffee Add-On (+₱${MOBILE_BAR_COFFEE_ADDON_FEE.toLocaleString('en-US')})
                        </label>
                    </div>
                    <div class="form-group">
                        <label>Outside Metro Manila Transport</label>
                        <select class="pkg-transport-addon" data-id="${item.id}">
                            ${renderTransportOptions(item)}
                        </select>
                    </div>
                </div>
            </div>
            <div class="pkg-workshop-fields ${isWorkshop ? '' : 'is-hidden'}">
                <div class="form-group">
                    <label>Number of Participants</label>
                    <input type="number" class="pkg-workshop-pax" data-id="${item.id}" min="1" step="1" placeholder="e.g., 10" value="${escapeHtml(String(paxVal))}">
                </div>
                <div class="form-group">
                    <label>Per Pax Cost (₱)</label>
                    <input type="number" class="pkg-per-pax-cost" data-id="${item.id}" min="0" step="0.01" placeholder="e.g., 2150" value="${escapeHtml(String(perPaxVal))}">
                </div>
                <div class="form-group">
                    <label>Inclusions (one per line)</label>
                    <textarea class="pkg-workshop-inclusions" data-id="${item.id}" rows="8" placeholder="One inclusion per line"></textarea>
                </div>
                <div class="form-group">
                    <label>Additional Details (optional, markdown)</label>
                    <textarea class="pkg-workshop-details" data-id="${item.id}" rows="3" placeholder="e.g., Full Workshop (2.5 Hours), time window"></textarea>
                </div>
            </div>
        </div>
    `;
}

function renderInvoiceItems() {
    const container = document.getElementById('invoiceItems');
    container.innerHTML = '';

    if (invoiceItems.length === 0) {
        container.innerHTML = '<p class="invoice-items-empty">No packages yet. Click <strong>+ Add Package</strong> below.</p>';
        return;
    }

    container.innerHTML = invoiceItems.map((item, index) => renderPackageFormFields(item, index)).join('');

    invoiceItems.forEach((item) => {
        if (!isWorkshopItem(item)) return;
        if (item.workshopInclusions == null) {
            item.workshopInclusions = getWorkshopInclusions(item.eventType);
        }
        const inclusionsEl = container.querySelector(`.pkg-workshop-inclusions[data-id="${item.id}"]`);
        if (inclusionsEl) inclusionsEl.value = inclusionsToTextarea(item.workshopInclusions);
        const textarea = container.querySelector(`.pkg-workshop-details[data-id="${item.id}"]`);
        if (textarea) textarea.value = item.workshopDetails || '';
    });
}

function setupPackageListListeners() {
    const container = document.getElementById('invoiceItems');
    if (container._packageListenersReady) return;
    container._packageListenersReady = true;

    container.addEventListener('change', function(e) {
        const el = e.target;
        const id = parseInt(el.dataset.id, 10);
        if (!id) return;
        const item = invoiceItems.find(i => i.id === id);
        if (!item) return;

        if (el.classList.contains('pkg-event-type')) {
            item.eventType = el.value;
            const form = el.closest('.package-form');
            const isWorkshop = isWorkshopEventType(el.value);
            form.querySelector('.pkg-mobile-fields').classList.toggle('is-hidden', isWorkshop);
            form.querySelector('.pkg-workshop-fields').classList.toggle('is-hidden', !isWorkshop);
            if (isWorkshop) {
                syncWorkshopItem(item, { resetInclusions: true });
                renderInvoiceItems();
            } else {
                syncMobileItem(item);
            }
        } else if (el.classList.contains('pkg-package-type')) {
            item.packageType = el.value;
            const slots = getPackageChoiceSlotCount(item);
            if (!Array.isArray(item.choiceDrinks)) item.choiceDrinks = [];
            item.choiceDrinks = item.choiceDrinks.slice(0, slots);
            syncMobileItem(item);
            renderInvoiceItems();
            updatePreview();
            saveToLocalStorage();
            return;
        } else if (el.classList.contains('pkg-coffee-addon')) {
            item.coffeeAddOn = el.checked;
            syncMobileItem(item);
        } else if (el.classList.contains('pkg-transport-addon')) {
            item.transportAddOn = el.value;
            syncMobileItem(item);
        } else if (el.classList.contains('pkg-number-of-pax')) {
            item.numberOfPax = el.value;
            const form = el.closest('.package-form');
            const customWrap = form.querySelector('.pkg-custom-cups-wrap');
            if (customWrap) {
                customWrap.classList.toggle('is-hidden', el.value !== 'custom');
            }
            if (el.value !== 'custom') {
                item.customCups = '';
            }
            syncMobileItem(item);
        } else if (el.classList.contains('pkg-date')) {
            item.eventDate = el.value;
        } else if (el.classList.contains('pkg-duration-hours')) {
            const hours = parseInt(el.value, 10);
            item.durationHours = hours > 0 ? hours : 3;
            syncMobileItem(item);
        }

        updatePreview();
        saveToLocalStorage();
    });

    container.addEventListener('input', function(e) {
        const el = e.target;
        const id = parseInt(el.dataset.id, 10);
        if (!id) return;
        const item = invoiceItems.find(i => i.id === id);
        if (!item) return;

        if (el.classList.contains('pkg-venue')) {
            item.eventVenue = el.value;
        } else if (el.classList.contains('pkg-workshop-pax')) {
            item.cups = el.value;
            syncWorkshopItem(item);
        } else if (el.classList.contains('pkg-per-pax-cost')) {
            item.unitCost = el.value;
            syncWorkshopItem(item);
        } else if (el.classList.contains('pkg-workshop-details')) {
            item.workshopDetails = el.value;
        } else if (el.classList.contains('pkg-workshop-inclusions')) {
            item.workshopInclusions = textareaToInclusions(el.value);
        } else if (el.classList.contains('pkg-custom-cups')) {
            item.numberOfPax = 'custom';
            item.customCups = el.value;
            syncMobileItem(item);
        } else if (el.classList.contains('pkg-price-override')) {
            item.priceOverride = el.value;
            syncMobileItem(item);
        } else if (el.classList.contains('pkg-duration-hours')) {
            const hours = parseInt(el.value, 10);
            item.durationHours = hours > 0 ? hours : 3;
            syncMobileItem(item);
        } else if (el.classList.contains('pkg-choice-drink')) {
            const slot = parseInt(el.dataset.slot, 10);
            if (!Array.isArray(item.choiceDrinks)) item.choiceDrinks = [];
            if (!Number.isNaN(slot) && slot >= 0) {
                item.choiceDrinks[slot] = el.value;
                syncMobileItem(item);
            }
        }

        updatePreview();
        saveToLocalStorage();
    });
}

// Add menu item
function addMenuItem(itemId) {
    const item = invoiceItems.find(i => i.id === itemId);
    if (item) {
        if (!item.menuItems) item.menuItems = [];
        item.menuItems.push('');
        renderInvoiceItems();
        updatePreview();
    }
}

// Remove menu item
function removeMenuItem(itemId, index) {
    const item = invoiceItems.find(i => i.id === itemId);
    if (item && item.menuItems) {
        item.menuItems.splice(index, 1);
        renderInvoiceItems();
        updatePreview();
    }
}

// Add option
function addOption(itemId) {
    const item = invoiceItems.find(i => i.id === itemId);
    if (item) {
        if (!item.additionalOptions) item.additionalOptions = [];
        item.additionalOptions.push('');
        renderInvoiceItems();
        updatePreview();
    }
}

// Remove option
function removeOption(itemId, index) {
    const item = invoiceItems.find(i => i.id === itemId);
    if (item && item.additionalOptions) {
        item.additionalOptions.splice(index, 1);
        renderInvoiceItems();
        updatePreview();
    }
}

// Add inclusion
function addInclusion(itemId) {
    const item = invoiceItems.find(i => i.id === itemId);
    if (item) {
        if (!item.otherInclusions) item.otherInclusions = [];
        item.otherInclusions.push('');
        renderInvoiceItems();
        updatePreview();
    }
}

// Remove inclusion
function removeInclusion(itemId, index) {
    const item = invoiceItems.find(i => i.id === itemId);
    if (item && item.otherInclusions) {
        item.otherInclusions.splice(index, 1);
        renderInvoiceItems();
        updatePreview();
    }
}

// Default milestone percentages per role and structure
function defaultPercentageFor(role, structure) {
    if (structure === 'two') {
        return role === 'first' ? 50 : role === 'final' ? 50 : 0;
    }
    // three
    if (role === 'first') return 25;
    if (role === 'preEvent') return 25;
    if (role === 'final') return 50;
    return 0;
}

// Build the default milestone list for a given structure (fresh, unpaid)
function buildDefaultMilestones(structure) {
    const now = Date.now();
    if (structure === 'two') {
        return [
            { id: now, role: 'first', milestone: 'Down Payment', date: '', percentage: 50, amount: 0, paid: false },
            { id: now + 1, role: 'final', milestone: 'Final Payment', date: '', percentage: 50, amount: 0, paid: false }
        ];
    }
    return [
        { id: now, role: 'first', milestone: 'Date Reservation', date: '', percentage: 25, amount: 0, paid: false },
        { id: now + 1, role: 'preEvent', milestone: 'Pre-Event', date: '', percentage: 25, amount: 0, paid: false },
        { id: now + 2, role: 'final', milestone: 'Event Completion', date: '', percentage: 50, amount: 0, paid: false }
    ];
}

// Infer a milestone's role from its name (for legacy/loaded data without a role)
function inferMilestoneRole(name) {
    const n = String(name || '').toLowerCase();
    if (n.includes('reservation') || n.includes('down')) return 'first';
    if (n.includes('pre-event') || n.includes('pre event')) return 'preEvent';
    if (n.includes('completion') || n.includes('final')) return 'final';
    return null;
}

// Ensure loaded milestones have the newer fields (role/paid)
function normalizePaymentMilestones() {
    paymentMilestones.forEach(m => {
        if (m.role === undefined || m.role === null) m.role = inferMilestoneRole(m.milestone);
        if (m.paid === undefined) m.paid = false;
    });
}

// Add default payment milestones
function addDefaultPaymentMilestones() {
    paymentMilestones = buildDefaultMilestones(paymentStructure);
    renderPaymentMilestones();
    updatePreview();
}

// Rebuild defaults for the current structure, carrying paid status over by role
function rebuildDefaultMilestonesPreservingPaid() {
    const prevByRole = {};
    paymentMilestones.forEach(m => {
        if (m.role) prevByRole[m.role] = m;
    });
    const fresh = buildDefaultMilestones(paymentStructure);
    fresh.forEach(m => {
        const prev = prevByRole[m.role];
        if (prev) {
            m.paid = !!prev.paid;
            if (prev.paid && prev.amount > 0) m.amount = prev.amount;
        }
    });
    paymentMilestones = fresh;
}

// Add payment milestone
function addPaymentMilestone() {
    const milestoneId = Date.now();
    paymentMilestones.push({
        id: milestoneId,
        role: null,
        milestone: '',
        date: '',
        percentage: 0,
        amount: 0,
        paid: false
    });

    renderPaymentMilestones();
    updatePreview();
}

// Remove payment milestone
function removePaymentMilestone(milestoneId) {
    paymentMilestones = paymentMilestones.filter(m => m.id !== milestoneId);
    renderPaymentMilestones();
    updatePreview();
}

// Switch payment structure (rebuilds defaults for the new structure)
function setPaymentStructure(structure) {
    if (structure !== 'two' && structure !== 'three') return;
    paymentStructure = structure;
    // Structure change resets to that structure's default milestones.
    // Keep paid progress where the roles still line up.
    rebuildDefaultMilestonesPreservingPaid();
    renderPaymentMilestones();
    updatePreview();
    saveToLocalStorage();
}

// Toggle customization lock. Turning it off restores the default logic rules.
function setPaymentCustomized(on) {
    paymentTermsCustomized = !!on;
    if (!paymentTermsCustomized) {
        rebuildDefaultMilestonesPreservingPaid();
    }
    renderPaymentMilestones();
    updatePreview();
    saveToLocalStorage();
}

// Render payment milestones in form
function renderPaymentMilestones() {
    const container = document.getElementById('paymentMilestones');
    container.innerHTML = '';

    // Sync top-level controls with current state
    const structureSelect = document.getElementById('paymentStructure');
    if (structureSelect) structureSelect.value = paymentStructure;
    const customizeCheckbox = document.getElementById('customizeMilestones');
    if (customizeCheckbox) customizeCheckbox.checked = paymentTermsCustomized;

    const editable = paymentTermsCustomized;
    const lockAttr = editable ? '' : 'readonly disabled';

    paymentMilestones.forEach((milestone, index) => {
        const milestoneDiv = document.createElement('div');
        milestoneDiv.className = 'payment-milestone' + (milestone.paid ? ' is-paid' : '');
        // When paid, the amount + date become editable so you can record the
        // actual payment (a different/higher amount and the date it was paid).
        const paid = !!milestone.paid;
        const dateLock = (editable || paid) ? '' : 'readonly disabled';
        const amountLock = paid ? '' : 'readonly disabled';
        const amountVal = milestone.amount > 0 ? milestone.amount.toFixed(2) : '';
        milestoneDiv.innerHTML = `
            <div class="payment-milestone-header">
                <h3>Milestone ${index + 1}</h3>
                ${editable ? `<button type="button" class="remove-milestone-btn" data-id="${milestone.id}">Remove</button>` : ''}
            </div>
            <div class="item-row">
                <div>
                    <label>Milestone Name:</label>
                    <input type="text" class="milestone-name" data-id="${milestone.id}" 
                        placeholder="e.g., Date Reservation" value="${escapeHtml(milestone.milestone)}" ${lockAttr}>
                </div>
                <div>
                    <label>${paid ? 'Date Paid:' : 'Date:'}</label>
                    <input type="date" class="milestone-date" data-id="${milestone.id}" value="${milestone.date}" ${dateLock}>
                </div>
            </div>
            <div class="item-row">
                <div>
                    <label>Percentage (%):</label>
                    <input type="number" class="milestone-percentage" data-id="${milestone.id}" 
                        min="0" max="100" step="0.01" value="${milestone.percentage}" ${lockAttr}>
                </div>
                <div>
                    <label>${paid ? 'Amount Paid (₱):' : 'Amount (₱):'}</label>
                    <input type="number" class="milestone-amount" data-id="${milestone.id}" 
                        min="0" step="0.01" value="${amountVal}" ${amountLock}>
                </div>
            </div>
            <div class="milestone-paid-row">
                <label class="milestone-paid-toggle">
                    <input type="checkbox" class="milestone-paid" data-id="${milestone.id}" ${paid ? 'checked' : ''}>
                    Mark as paid
                </label>
            </div>
        `;
        container.appendChild(milestoneDiv);
    });

    // Show the "Add Payment Milestone" button only while customizing
    const addBtn = document.getElementById('addMilestoneBtn');
    if (addBtn) addBtn.style.display = editable ? '' : 'none';

    setupPaymentMilestoneListeners();
}

// Delegated listeners for the milestone form (attached once)
function setupPaymentMilestoneListeners() {
    const container = document.getElementById('paymentMilestones');
    if (!container || container._milestoneListenersReady) return;
    container._milestoneListenersReady = true;

    const handleFieldChange = (el) => {
        const id = parseInt(el.dataset.id, 10);
        if (!id) return;
        const milestone = paymentMilestones.find(m => m.id === id);
        if (!milestone) return;

        if (el.classList.contains('milestone-name')) {
            milestone.milestone = el.value;
        } else if (el.classList.contains('milestone-date')) {
            milestone.date = el.value;
        } else if (el.classList.contains('milestone-percentage')) {
            milestone.percentage = parseFloat(el.value) || 0;
        } else if (el.classList.contains('milestone-amount')) {
            // Amount is only editable while a milestone is marked paid
            if (milestone.paid) milestone.amount = parseFloat(el.value) || 0;
        } else {
            return;
        }
        updatePreview();
        saveToLocalStorage();
    };

    container.addEventListener('input', (e) => handleFieldChange(e.target));

    container.addEventListener('change', (e) => {
        const el = e.target;
        if (el.classList.contains('milestone-paid')) {
            const id = parseInt(el.dataset.id, 10);
            const milestone = paymentMilestones.find(m => m.id === id);
            if (!milestone) return;
            milestone.paid = el.checked;
            if (el.checked) {
                // Freeze the currently computed amount as the amount paid (editable),
                // and default the payment date to today when none is set.
                if (!(milestone.amount > 0)) milestone.amount = 0;
                if (!milestone.date) milestone.date = formatDateToLocal(new Date());
            }
            renderPaymentMilestones();
            updatePreview();
            saveToLocalStorage();
        } else {
            handleFieldChange(el);
        }
    });

    container.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-milestone-btn');
        if (removeBtn) {
            removePaymentMilestone(parseInt(removeBtn.dataset.id, 10));
        }
    });
}

// Calculate total
function calculateTotal() {
    const packageTotal = invoiceItems.reduce((sum, item) => {
        const packageSub = getInvoiceItemPricing(item).subtotal;
        const addonsSub = getPackageAddonLineItems(item).reduce((s, a) => s + (a.quantity || 0) * (a.price || 0), 0);
        return sum + packageSub + addonsSub;
    }, 0);
    const customTotal = customLineItems.reduce((sum, item) => sum + ((item.quantity || 0) * (item.price || 0)), 0);
    return packageTotal + customTotal;
}

// Basic markdown to HTML for description (bold, italic, lists, \n = line break)
function renderBasicMarkdown(text) {
    if (!text || !text.trim()) return '';
    // 1) Literal backslash-n -> real newline (so \n is hidden and acts as line break)
    const backslashN = String.fromCharCode(92) + 'n';
    let normalized = text.split(backslashN).join('\n');
    // 2) Normalize line endings
    normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const out = [];
    let inList = false;
    let paraLines = [];
    function flushParagraph() {
        if (paraLines.length === 0) return;
        const html = paraLines.map(l => inlineMarkdown(l.trim())).join('<br>');
        out.push('<p>' + html + '</p>');
        paraLines = [];
    }
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
        if (bulletMatch) {
            flushParagraph();
            if (!inList) { out.push('<ul class="custom-line-item-bullets">'); inList = true; }
            out.push('<li>' + inlineMarkdown(bulletMatch[1].trim()) + '</li>');
        } else {
            if (inList) { out.push('</ul>'); inList = false; }
            if (line.trim()) paraLines.push(line.trim());
            else flushParagraph();
        }
    }
    flushParagraph();
    if (inList) out.push('</ul>');
    return out.length ? out.join('') : escapeHtml(text).replace(/\n/g, '<br>');
}
function inlineMarkdown(s) {
    let h = escapeHtml(s);
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
    h = h.replace(/__(.+?)__/g, '<strong>$1</strong>');
    h = h.replace(/_(.+?)_/g, '<em>$1</em>');
    return h;
}

// Custom Line Items Functions
function addCustomLineItem() {
    const newItem = {
        id: Date.now(),
        name: '',
        description: '',
        quantity: 1,
        price: 0
    };
    customLineItems.push(newItem);
    renderCustomLineItems();
    saveToLocalStorage();
    updatePreview();
}

function removeCustomLineItem(itemId) {
    customLineItems = customLineItems.filter(item => item.id !== itemId);
    renderCustomLineItems();
    saveToLocalStorage();
    updatePreview();
}

function renderCustomLineItems() {
    const container = document.getElementById('customLineItems');
    container.innerHTML = '';
    
    if (customLineItems.length === 0) {
        container.innerHTML = '<p style="color: #666; font-size: 0.875rem; margin-bottom: 1rem;">No additional line items added</p>';
        return;
    }
    
    customLineItems.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'custom-line-item';
        itemDiv.style.cssText = 'background: #f9f9f9; padding: 1rem; border-radius: 6px; margin-bottom: 0.75rem; border: 1px solid #e0e0e0;';
        
        itemDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <h3 style="font-size: 0.9375rem; font-weight: 600; color: #333;">Line Item ${index + 1}</h3>
                <button type="button" onclick="removeCustomLineItem(${item.id})" 
                    style="background: #e63946; color: white; border: none; padding: 0.375rem 0.75rem; border-radius: 4px; cursor: pointer; font-size: 0.8125rem;">Remove</button>
            </div>
            <div style="margin-bottom: 0.5rem;">
                <label style="display: block; font-size: 0.8125rem; font-weight: 500; color: #666; margin-bottom: 0.25rem;">Name:</label>
                <input type="text" class="line-item-name" data-id="${item.id}"
                    placeholder="e.g., Additional Equipment" value="${escapeHtml(item.name || '')}"
                    style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem;">
            </div>
            <div style="margin-bottom: 0.5rem;">
                <label style="display: block; font-size: 0.8125rem; font-weight: 500; color: #666; margin-bottom: 0.25rem;">Description (optional, markdown):</label>
                <textarea class="line-item-description" data-id="${item.id}" rows="3"
                    placeholder="**bold** *italic*; new line = line break; blank line = new paragraph; - for bullets"
                    style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem; resize: vertical;"></textarea>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                <div>
                    <label style="display: block; font-size: 0.8125rem; font-weight: 500; color: #666; margin-bottom: 0.25rem;">Quantity:</label>
                    <input type="number" class="line-item-quantity" data-id="${item.id}" 
                        min="0" step="1" value="${item.quantity || 1}"
                        style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem;">
                </div>
                <div>
                    <label style="display: block; font-size: 0.8125rem; font-weight: 500; color: #666; margin-bottom: 0.25rem;">Price (₱):</label>
                    <input type="number" class="line-item-price" data-id="${item.id}" 
                        min="0" step="0.01" value="${item.price || 0}"
                        style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem;">
                </div>
            </div>
        `;
        const descTextarea = itemDiv.querySelector('.line-item-description');
        if (descTextarea) descTextarea.value = item.description || ''; // set via .value so \n is preserved
        container.appendChild(itemDiv);
    });
    
    // Add event listeners
    container.querySelectorAll('.line-item-name, .line-item-description, .line-item-quantity, .line-item-price').forEach(input => {
        input.addEventListener('input', function() {
            const id = parseInt(this.dataset.id);
            const item = customLineItems.find(i => i.id === id);
            if (item) {
                if (this.classList.contains('line-item-name')) {
                    item.name = this.value;
                } else if (this.classList.contains('line-item-description')) {
                    item.description = this.value;
                } else if (this.classList.contains('line-item-quantity')) {
                    item.quantity = parseFloat(this.value) || 0;
                } else if (this.classList.contains('line-item-price')) {
                    item.price = parseFloat(this.value) || 0;
                }
                saveToLocalStorage();
                updatePreview();
            }
        });
    });
}

function formatParticipantCountText(count) {
    const num = parseInt(count, 10);
    if (!num || num < 0) return '';
    return `${num} pax`;
}

function resolveWorkshopEventType(item) {
    if (item.eventType && isWorkshopEventType(item.eventType)) return item.eventType;
    if (item.description === WORKSHOP_TITLES.mochi_workshop) return EVENT_TYPES.mochi_workshop;
    if (item.description === WORKSHOP_TITLES.matcha_workshop) return EVENT_TYPES.matcha_workshop;
    return EVENT_TYPES.matcha_workshop;
}

function renderWorkshopInclusionsSection(item) {
    const inclusions = item.workshopInclusions && item.workshopInclusions.length
        ? item.workshopInclusions
        : getWorkshopInclusions(resolveWorkshopEventType(item));
    if (!inclusions.length) return '';

    let html = '<div class="package-section">';
    html += '<div class="package-section-label">Inclusions:</div>';
    html += '<div class="package-section-list">';
    inclusions.forEach((entry) => {
        const lines = String(entry).split('\n').map((line) => line.trim()).filter(Boolean);
        if (!lines.length) return;
        const body = lines.map((line) => escapeHtml(line)).join('<br>');
        html += `<div class="package-list-item">${body}</div>`;
    });
    html += '</div></div>';
    return html;
}

function renderCountSection(item) {
    if (!item.cups && item.cups !== '0') return '';
    const isParticipants =
        item.countLabel === 'participants' || item.countLabel === 'pax';

    if (isParticipants) {
        const numMatch = String(item.cups).match(/\d+/);
        const displayValue = numMatch ? formatParticipantCountText(numMatch[0]) : item.cups;
        if (!displayValue) return '';
        return `<div class="package-section package-section-count package-section-participants">
            <div class="package-section-label">Number of Participants:</div>
            <div class="package-participant-count">${escapeHtml(displayValue)}</div>
        </div>`;
    }

    return `<div class="package-section package-section-count">
        <span class="package-section-label">Cups:</span>
        <span class="package-section-value">${escapeHtml(item.cups)}</span>
    </div>`;
}

// Format package details in organized, easy-to-read format
function formatPackageDetails(item) {
    const isWorkshopItem = item.isWorkshop ||
        ((item.countLabel === 'participants' || item.countLabel === 'pax') &&
            !(item.menuItems && item.menuItems.some(m => String(m).trim())));

    if (isWorkshopItem) {
        let html = '<div class="package-details-visual package-details-stacked">';
        html += renderCountSection(item);
        html += renderWorkshopInclusionsSection(item);
        if (item.workshopDetails && item.workshopDetails.trim()) {
            html += '<div class="package-section">';
            html += '<div class="package-section-label">Additional Details:</div>';
            html += `<div class="custom-line-item-description">${renderBasicMarkdown(item.workshopDetails)}</div>`;
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    // Mobile bar: compact stack — cups live under the title (not a "Cups: 150 Cups" block)
    let html = '<div class="package-details-visual package-details-stacked package-details-mobile">';

    const menuItems = (item.menuItems || []).map((m) => String(m).trim()).filter(Boolean);
    if (menuItems.length) {
        html += '<div class="package-section">';
        html += '<div class="package-section-label">Menu:</div>';
        html += '<div class="package-section-list">';
        menuItems.forEach((m) => {
            html += `<div class="package-list-item">${escapeHtml(m)}</div>`;
        });
        html += '</div></div>';
    }

    const servingBits = (item.additionalOptions || []).map((o) => String(o).trim()).filter(Boolean);
    if (servingBits.length) {
        html += `<div class="package-serving-line">${escapeHtml(servingBits.join(' · '))}</div>`;
    }

    const allInclusions = [];
    if (item.duration) allInclusions.push(item.duration);
    if (item.serviceWindow && item.serviceWindow.length > 0) {
        item.serviceWindow.forEach((s) => {
            if (String(s).trim()) allInclusions.push(s);
        });
    }
    if (item.baristas) allInclusions.push(item.baristas);
    if (item.otherInclusions && item.otherInclusions.length > 0) {
        item.otherInclusions.forEach((inclusion) => {
            if (inclusion.trim()) allInclusions.push(inclusion);
        });
    }

    if (allInclusions.length > 0) {
        html += '<div class="package-section">';
        html += '<div class="package-section-label">Inclusions:</div>';
        html += '<div class="package-section-list">';
        allInclusions.forEach((inclusion) => {
            html += `<div class="package-list-item">${escapeHtml(inclusion)}</div>`;
        });
        html += '</div></div>';
    }

    html += '</div>';
    return html;
}

function formatMobileBarCupsSubtitle(item) {
    const cupsMatch = String(item.cups || '').match(/\d+/);
    if (!cupsMatch) return '';
    return `<div class="package-cups-subtitle">${escapeHtml(cupsMatch[0])} cups</div>`;
}

function formatEventMetaFooter(venue, eventDate) {
    const parts = [];
    if (venue) parts.push(`<strong>Venue:</strong> ${escapeHtml(venue)}`);
    if (eventDate) parts.push(`<strong>Date:</strong> ${formatDate(eventDate)}`);
    if (!parts.length) return '';
    return `<div class="event-meta">${parts.join('<span class="event-meta-sep"> · </span>')}</div>`;
}

function getInvoiceItemPricing(item) {
    const isWorkshopItem = item.isWorkshop ||
        ((item.countLabel === 'participants' || item.countLabel === 'pax') &&
            !(item.menuItems && item.menuItems.some(m => String(m).trim())));

    if (isWorkshopItem) {
        const paxMatch = String(item.cups || '').match(/\d+/);
        const qty = item.quantity || (paxMatch ? parseInt(paxMatch[0], 10) : 0);
        const unitCost = item.unitCost != null
            ? parseFloat(item.unitCost)
            : (qty > 0 ? (item.unitPrice || 0) / qty : 0);
        const subtotal = item.unitPrice != null ? item.unitPrice : unitCost * qty;
        return { unitCost, qty, subtotal };
    }

    return {
        unitCost: item.unitPrice || 0,
        qty: 1,
        subtotal: item.unitPrice || 0
    };
}

function renderPricingCells(unitCost, qty, subtotal) {
    return `
        <td class="col-unit-cost text-right">Php ${formatCurrency(unitCost)}</td>
        <td class="col-qty text-right">${escapeHtml(String(qty))}</td>
        <td class="col-line-subtotal text-right">Php ${formatCurrency(subtotal)}</td>
    `;
}

// Update preview
function updatePreview() {
    // Invoice details
    const invoiceDate = document.getElementById('invoiceDate').value;
    document.getElementById('displayInvoiceDate').textContent = 
        invoiceDate ? formatDate(invoiceDate) : '';

    // Client info
    const clientName = document.getElementById('clientName').value;
    document.getElementById('displayClientName').textContent = clientName || '';
    
    const clientAddress = document.getElementById('clientAddress').value;
    document.getElementById('displayClientAddress').textContent = clientAddress || '';

    const clientTIN = document.getElementById('clientTIN').value;
    document.getElementById('displayClientTIN').textContent = clientTIN || '';

    // Invoice items
    const itemsContainer = document.getElementById('displayItems');
    itemsContainer.innerHTML = '';

    let total = 0;

    // Add package items
    invoiceItems.forEach(item => {
        if (!isPackageVisibleInPreview(item)) return;

            const { unitCost, qty, subtotal } = getInvoiceItemPricing(item);
            total += subtotal;

            const packageDetails = formatPackageDetails(item);
            const isMobileBar = !isWorkshopItem(item);
            const cupsSubtitle = isMobileBar ? formatMobileBarCupsSubtitle(item) : '';
            const eventMeta = formatEventMetaFooter(item.eventVenue || '', item.eventDate || '');
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="col-description">
                    <div class="package-name">${escapeHtml(item.description)}</div>
                    ${cupsSubtitle}
                    ${packageDetails}
                    ${eventMeta}
                </td>
                ${renderPricingCells(unitCost, qty, subtotal)}
            `;
            itemsContainer.appendChild(row);

            getPackageAddonLineItems(item).forEach((addon) => {
                const addonQty = addon.quantity || 1;
                const addonPrice = addon.price || 0;
                const addonSub = addonQty * addonPrice;
                total += addonSub;
                const addonRow = document.createElement('tr');
                const descHtml = addon.description
                    ? `<div class="custom-line-item-description">${escapeHtml(addon.description)}</div>`
                    : '';
                addonRow.innerHTML = `
                    <td class="col-description">
                        <div class="package-name">${escapeHtml(addon.name)}</div>
                        ${descHtml}
                    </td>
                    ${renderPricingCells(addonPrice, addonQty, addonSub)}
                `;
                itemsContainer.appendChild(addonRow);
            });
    });

    // Add custom line items (name = title; description = optional detail below, with bullet/plain format)
    customLineItems.forEach(item => {
        const name = (item.name || item.description || '').trim(); // backward compat: old items had only description
        if (!name) return;
        
        const quantity = item.quantity || 0;
        const price = item.price || 0;
        const subtotal = quantity * price;
        total += subtotal;
        
        const hasSeparateDescription = item.name && item.description && item.description.trim();
        const descHtml = hasSeparateDescription ? renderBasicMarkdown(item.description) : '';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="col-description">
                <div class="package-name">${escapeHtml(name)}</div>
                ${descHtml ? `<div class="custom-line-item-description">${descHtml}</div>` : ''}
            </td>
            ${renderPricingCells(price, quantity, subtotal)}
        `;
        itemsContainer.appendChild(row);
    });

    if (itemsContainer.children.length === 0) {
        itemsContainer.innerHTML = '<tr><td colspan="4" class="empty-state">No items added yet</td></tr>';
    }

    document.getElementById('displayTotal').textContent = `Php ${formatCurrency(total)}`;

    // Update payment milestones
    updatePaymentMilestones(total);
    
    // Auto-save to localStorage
    saveToLocalStorage();
}

// Calculate payment milestone dates based on invoice date and event date
function calculateMilestoneDates(eventDateStr) {
    if (!eventDateStr) return { hasPreEvent: false };
    
    const eventDate = new Date(eventDateStr);
    const invoiceDateInput = document.getElementById('invoiceDate').value;
    const invoiceDate = invoiceDateInput ? new Date(invoiceDateInput) : new Date();
    const today = new Date();
    
    invoiceDate.setHours(0, 0, 0, 0);
    eventDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    
    const daysUntilEvent = Math.ceil((eventDate - invoiceDate) / (1000 * 60 * 60 * 24));
    const dates = {};
    
    // Pre-Event: Only if event is 2+ weeks (14 days) away
    if (daysUntilEvent >= 14) {
        // Pre-Event: 1 week (7 days) before event
        const preEventDate = new Date(eventDate);
        preEventDate.setDate(preEventDate.getDate() - 7);
        dates.preEvent = formatDateToLocal(preEventDate);
        dates.hasPreEvent = true;
        
        // Date Reservation: Up to 5 days after invoice date, but must be at least 1 week before Pre-Event
        const reservationDateWithGrace = new Date(invoiceDate);
        reservationDateWithGrace.setDate(reservationDateWithGrace.getDate() + 5);
        
        const reservationDateMinGap = new Date(preEventDate);
        reservationDateMinGap.setDate(reservationDateMinGap.getDate() - 7);
        
        // Use the earlier of: (invoice + 5 days) or (pre-event - 7 days)
        const reservationDate = reservationDateWithGrace < reservationDateMinGap ? reservationDateWithGrace : reservationDateMinGap;
        
        // Ensure reservation date is never before invoice date
        if (reservationDate < invoiceDate) {
            reservationDate.setTime(invoiceDate.getTime());
        }
        
        dates.reservation = formatDateToLocal(reservationDate);
    } else {
        // Event is less than 14 days away: Date Reservation = Invoice date (immediate payment)
        dates.reservation = formatDateToLocal(invoiceDate);
        dates.hasPreEvent = false;
    }
    
    // Event Completion: Same day as event
    dates.completion = formatDateToLocal(eventDate);
    
    return dates;
}

// Apply the default payment logic rules (percentages, merge, auto dates).
// Runs only when the terms are NOT customized by the user.
function applyDefaultPaymentLogic(milestoneDates) {
    // Reset percentages to structure defaults based on each milestone's role
    paymentMilestones.forEach(m => {
        const role = m.role || inferMilestoneRole(m.milestone);
        m.role = role;
        m.percentage = defaultPercentageFor(role, paymentStructure);
    });

    // 3-payment rule: if the event is less than 2 weeks away, fold the
    // Pre-Event payment into the first (reservation) payment.
    if (paymentStructure === 'three' && !milestoneDates.hasPreEvent) {
        const first = paymentMilestones.find(m => m.role === 'first');
        const pre = paymentMilestones.find(m => m.role === 'preEvent');
        if (first && pre && pre.percentage > 0) {
            first.percentage += pre.percentage;
            pre.percentage = 0;
        }
    }

    // Auto-calculate dates by role (only when an event date is known).
    // Paid milestones keep their recorded payment date.
    const eventDate = getInvoiceEventDate();
    if (eventDate) {
        paymentMilestones.forEach(m => {
            if (m.paid) return;
            if (m.role === 'first') m.date = milestoneDates.reservation || '';
            else if (m.role === 'preEvent') m.date = milestoneDates.preEvent || '';
            else if (m.role === 'final') m.date = milestoneDates.completion || '';
        });
    }
}

// Recalculate each milestone's amount. Paid milestones lock to the actual
// amount received; the remaining balance is auto-distributed across the
// unpaid milestones according to their percentages.
function recalcMilestoneAmounts(total) {
    const isActive = (m) => (m.percentage > 0) || m.paid;

    // Paid milestones keep their own recorded amount (the actual amount received).
    let paidSum = 0;
    paymentMilestones.forEach(m => {
        if (m.paid && isActive(m)) paidSum += (m.amount || 0);
    });

    let remaining = total - paidSum;
    if (remaining < 0) remaining = 0;

    const unpaidPctSum = paymentMilestones.reduce((s, m) => {
        return (!m.paid && isActive(m)) ? s + (m.percentage || 0) : s;
    }, 0);

    paymentMilestones.forEach(m => {
        if (m.paid) return; // keep the recorded amount as-is
        if (!isActive(m)) {
            m.amount = 0;
        } else {
            m.amount = unpaidPctSum > 0 ? remaining * ((m.percentage || 0) / unpaidPctSum) : 0;
        }
    });
}

// Push computed values back into the (possibly editable) form inputs
function syncMilestoneFormInputs() {
    paymentMilestones.forEach(milestone => {
        const amountInput = document.querySelector(`#paymentMilestones input.milestone-amount[data-id="${milestone.id}"]`);
        if (amountInput && document.activeElement !== amountInput) {
            amountInput.value = milestone.amount > 0 ? milestone.amount.toFixed(2) : '';
        }

        const percentageInput = document.querySelector(`#paymentMilestones input.milestone-percentage[data-id="${milestone.id}"]`);
        if (percentageInput && document.activeElement !== percentageInput) {
            percentageInput.value = milestone.percentage > 0 ? milestone.percentage : '';
        }

        const dateInput = document.querySelector(`#paymentMilestones input.milestone-date[data-id="${milestone.id}"]`);
        if (dateInput && document.activeElement !== dateInput && milestone.date) {
            dateInput.value = milestone.date;
        }
    });
}

// Render the preview payment table, highlighting the next payment still due.
function renderPreviewMilestones(container, total) {
    const activeMilestones = paymentMilestones.filter(m => m.milestone && (m.percentage > 0 || m.paid));

    // Once any milestone is paid, the whole column becomes a payment STATUS
    // column (Paid / Unpaid) instead of showing percentages.
    const anyPaid = activeMilestones.some(m => m.paid);
    const colHeader = document.getElementById('paymentColHeader');
    if (colHeader) colHeader.textContent = anyPaid ? 'STATUS' : 'PERCENTAGE';

    if (activeMilestones.length === 0) {
        container.innerHTML = '<tr><td colspan="4" class="empty-state">No payment milestones added</td></tr>';
        return;
    }

    // The remaining balance to highlight = the first unpaid active milestone
    const nextUnpaid = activeMilestones.find(m => !m.paid);

    activeMilestones.forEach(milestone => {
        const row = document.createElement('tr');
        const dateStr = milestone.date ? formatDate(milestone.date) : '-';
        const amountStr = milestone.amount > 0 ? `Php ${formatCurrency(milestone.amount)}` : '-';

        let statusCell;
        if (anyPaid) {
            // Status mode: show Paid / Unpaid pills for every row
            if (milestone.paid) {
                row.classList.add('milestone-row-paid');
                statusCell = '<span class="paid-status">Paid</span>';
            } else {
                statusCell = '<span class="unpaid-status">Unpaid</span>';
            }
        } else {
            // Percentage mode: no payments recorded yet
            const effectivePct = total > 0 && milestone.amount > 0
                ? Math.round((milestone.amount / total) * 100)
                : (milestone.percentage || 0);
            statusCell = effectivePct > 0 ? `${effectivePct}%` : '-';
        }

        const isNextDue = milestone === nextUnpaid;
        const highlightClass = isNextDue ? 'highlight-amount' : '';

        row.innerHTML = `
            <td>${escapeHtml(milestone.milestone)}</td>
            <td>${dateStr}</td>
            <td>${statusCell}</td>
            <td class="${highlightClass}">${amountStr}</td>
        `;
        container.appendChild(row);
    });
}

// Update payment milestones
function updatePaymentMilestones(total) {
    const container = document.getElementById('displayPaymentMilestones');
    container.innerHTML = '';

    const eventDate = getInvoiceEventDate();
    const milestoneDates = calculateMilestoneDates(eventDate);

    // Only run the automatic date/percentage logic when not customized
    if (!paymentTermsCustomized) {
        applyDefaultPaymentLogic(milestoneDates);
    }

    recalcMilestoneAmounts(total);
    syncMilestoneFormInputs();
    renderPreviewMilestones(container, total);
}

// Setup event listeners
function setupEventListeners() {
    // Add milestone button
    document.getElementById('addMilestoneBtn').addEventListener('click', addPaymentMilestone);

    // Payment structure selector
    const structureSelect = document.getElementById('paymentStructure');
    if (structureSelect) {
        structureSelect.addEventListener('change', function() {
            setPaymentStructure(this.value);
        });
    }

    // Customize milestones toggle
    const customizeCheckbox = document.getElementById('customizeMilestones');
    if (customizeCheckbox) {
        customizeCheckbox.addEventListener('change', function() {
            setPaymentCustomized(this.checked);
        });
    }

    // Form inputs with auto-save
    const formInputs = [
        'invoiceNumber', 'invoiceDate',
        'clientName', 'clientAddress', 'clientTIN',
        'notes'
    ];

    formInputs.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('input', function() {
                updatePreview();
                saveToLocalStorage();
            });
            element.addEventListener('change', function() {
                updatePreview();
                saveToLocalStorage();
            });
        }
    });
    
    // Invoice date change should recalculate payment milestone dates
    document.getElementById('invoiceDate').addEventListener('change', function() {
        const total = calculateTotal();
        updatePaymentMilestones(total);
        renderPaymentMilestones();
        updatePreview();
        saveToLocalStorage();
    });

    // Open the native date picker when clicking anywhere on a date field (not just the icon)
    document.addEventListener('click', function(e) {
        const el = e.target;
        if (el && el.matches && el.matches('input[type="date"]') && typeof el.showPicker === 'function') {
            try {
                el.showPicker();
            } catch (_) {
                // showPicker can throw if already open or not user-activated; ignore
            }
        }
    });

    // Add custom line item button
    document.getElementById('addLineItemBtn').addEventListener('click', addCustomLineItem);

    // Download PDF
    document.getElementById('downloadPDF').addEventListener('click', downloadPDF);

    // New invoice (clear form + local storage)
    document.getElementById('clearForm').addEventListener('click', function() {
        clearForm();
    });
}

// Format date to local YYYY-MM-DD string (avoid timezone issues)
function formatDateToLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// Format currency
function formatCurrency(amount) {
    return parseFloat(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Download PDF
async function captureElementCanvas(element) {
    const mm = 96 / 25.4;
    const pageW = Math.round(210 * mm);
    const pageH = Math.round(297 * mm);

    // Keep the clone at (0,0). Off-screen negative left makes html2canvas
    // include extra width, which jsPDF then pins to the left of the page.
    const host = document.createElement('div');
    host.style.cssText = [
        'position:fixed',
        'left:0',
        'top:0',
        `width:${pageW}px`,
        `height:${pageH}px`,
        'overflow:hidden',
        'background:#ffffff',
        'z-index:2147483646',
        'pointer-events:none'
    ].join(';');

    const clone = element.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.add('pdf-capture');
    clone.style.cssText = [
        `width:${pageW}px`,
        `max-width:${pageW}px`,
        `height:${pageH}px`,
        `min-height:${pageH}px`,
        'margin:0',
        'box-shadow:none',
        'overflow:hidden',
        'position:relative',
        'left:0',
        'top:0'
    ].join(';');
    host.appendChild(clone);
    document.body.appendChild(host);

    try {
        await Promise.all([...clone.querySelectorAll('img')].map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve) => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
            });
        }));
        const width = clone.offsetWidth || pageW;
        const height = clone.offsetHeight || pageH;
        return await html2canvas(clone, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
            scrollX: 0,
            scrollY: 0,
            x: 0,
            y: 0,
            width,
            height,
            windowWidth: width,
            windowHeight: height
        });
    } finally {
        host.remove();
    }
}

function appendCanvasToPdf(pdf, canvas, { startNewPage = false } = {}) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    if (startNewPage) {
        pdf.addPage();
    }
    // Fill the A4 page. Scaling a taller canvas to fit height (and placing
    // it at x=0) is what shoved invoice content to the left.
    pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight);
}

async function downloadPDF() {
    const invoiceElement = document.getElementById('invoice');
    const paymentTermsElement = document.getElementById('paymentTermsPage');
    
    // Show loading state
    const downloadBtn = document.getElementById('downloadPDF');
    const originalText = downloadBtn.textContent;
    downloadBtn.textContent = 'Generating PDF...';
    downloadBtn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const canvas1 = await captureElementCanvas(invoiceElement);
        appendCanvasToPdf(pdf, canvas1, { startNewPage: false });

        if (paymentTermsElement) {
            const canvas2 = await captureElementCanvas(paymentTermsElement);
            appendCanvasToPdf(pdf, canvas2, { startNewPage: true });
        }

        // Generate filename
        const invoiceNumber = document.getElementById('invoiceNumber').value || 'invoice';
        const clientName = document.getElementById('clientName').value || 'client';
        const filename = `${invoiceNumber}_${clientName.replace(/\s+/g, '_')}.pdf`;

        pdf.save(filename);
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Error generating PDF. Please try again.');
    } finally {
        downloadBtn.textContent = originalText;
        downloadBtn.disabled = false;
    }
}

// Clear form
function clearForm() {
    if (!confirm('Are you sure you want to clear all form data? This cannot be undone.')) {
        return;
    }

    // Reset invoice details
    const today = new Date();
    document.getElementById('invoiceDate').valueAsDate = today;

    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    document.getElementById('invoiceNumber').value = `INV-${year}-${month}${day}-001`;

    // Clear client details
    document.getElementById('clientName').value = '';
    document.getElementById('clientAddress').value = '';
    document.getElementById('clientTIN').value = '';

    invoiceItems = [];
    customLineItems = [];

    // Reset payment milestones
    paymentMilestones = [];
    addDefaultPaymentMilestones();

    // Update preview
    renderInvoiceItems();
    renderCustomLineItems();
    updatePreview();
    saveToLocalStorage();

    // Starting fresh — no longer linked to a saved cloud record
    _currentCloudDocId = null;

    clearAiChatHistory();
}

// Make functions available globally
window.removeInvoiceItem = removeInvoiceItem;
window.addPaymentMilestone = addPaymentMilestone;
window.removePaymentMilestone = removePaymentMilestone;
window.addMenuItem = addMenuItem;
window.removeMenuItem = removeMenuItem;
window.addOption = addOption;
window.removeOption = removeOption;
window.addInclusion = addInclusion;
window.removeInclusion = removeInclusion;
window.addCustomLineItem = addCustomLineItem;
window.removeCustomLineItem = removeCustomLineItem;

// ─── Firebase Cloud Save / Load ───────────────────────────────────────────────

// Tracks the Firestore doc ID of the currently loaded invoice, if any.
// If set, Save will update that doc. If null, Save creates a new one.
let _currentCloudDocId = null;

function buildSavePayload() {
    const total = calculateTotal();
    return {
        invoiceNumber: document.getElementById('invoiceNumber').value,
        invoiceDate: document.getElementById('invoiceDate').value,
        clientName: document.getElementById('clientName').value,
        clientAddress: document.getElementById('clientAddress').value,
        clientTIN: document.getElementById('clientTIN').value,
        eventDate: getInvoiceEventDate(),
        notes: document.getElementById('notes').value,
        invoiceItems: invoiceItems,
        customLineItems: customLineItems,
        paymentMilestones: paymentMilestones,
        paymentStructure: paymentStructure,
        paymentTermsCustomized: paymentTermsCustomized,
        totalAmount: total,
        savedAt: new Date().toISOString()
    };
}

function restoreFromPayload(data, docId) {
    aiDebug('restoreFromPayload in', {
        docId: docId || null,
        clientName: data?.clientName,
        invoiceItems: data?.invoiceItems?.length,
        customLineItems: data?.customLineItems?.length,
        paymentStructure: data?.paymentStructure
    });

    _currentCloudDocId = docId || null;

    if (data.invoiceNumber) document.getElementById('invoiceNumber').value = data.invoiceNumber;
    if (data.invoiceDate) document.getElementById('invoiceDate').value = data.invoiceDate;
    document.getElementById('clientName').value = data.clientName || '';
    document.getElementById('clientAddress').value = data.clientAddress || '';
    document.getElementById('clientTIN').value = data.clientTIN || '';
    document.getElementById('notes').value = data.notes || '';

    if (data.invoiceItems) {
        invoiceItems = data.invoiceItems.map(item => migrateLoadedPackageItem(item, data));
    }
    if (data.customLineItems) customLineItems = data.customLineItems;
    if (data.paymentMilestones) paymentMilestones = data.paymentMilestones;
    paymentStructure = data.paymentStructure || 'three';
    paymentTermsCustomized = !!data.paymentTermsCustomized;
    normalizePaymentMilestones();
    if (!paymentTermsCustomized && (!paymentMilestones || paymentMilestones.length === 0)) {
        paymentMilestones = buildDefaultMilestones(paymentStructure);
    }

    renderInvoiceItems();
    renderCustomLineItems();
    renderPaymentMilestones();
    updatePreview();
    updateSaveButtonLabel();

    aiDebug('restoreFromPayload DOM after', {
        clientNameInput: document.getElementById('clientName')?.value,
        displayClientName: document.getElementById('displayClientName')?.textContent,
        invoiceItemsLen: invoiceItems.length,
        displayTotal: document.getElementById('displayTotal')?.textContent
    });
}

function updateSaveButtonLabel() {
    const btn = document.getElementById('saveToCloud');
    if (!btn) return;
    btn.textContent = _currentCloudDocId ? 'Save' : 'Save';
}

async function persistToCloud() {
    const db = await getFirebaseDb();
    const payload = buildSavePayload();

    if (_currentCloudDocId) {
        const { doc, updateDoc } = _firebaseModules;
        await updateDoc(doc(db, 'invoice-generator', _currentCloudDocId), payload);
        return _currentCloudDocId;
    } else {
        const { collection, addDoc } = _firebaseModules;
        const docRef = await addDoc(collection(db, 'invoice-generator'), payload);
        _currentCloudDocId = docRef.id;
        saveToLocalStorage(); // persist the new doc ID so refresh doesn't lose it
        return _currentCloudDocId;
    }
}

async function fetchCloudInvoices() {
    const db = await getFirebaseDb();
    const { collection, getDocs, query, orderBy } = _firebaseModules;
    const q = query(collection(db, 'invoice-generator'), orderBy('savedAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function deleteCloudInvoice(docId) {
    const db = await getFirebaseDb();
    const { doc, deleteDoc } = _firebaseModules;
    await deleteDoc(doc(db, 'invoice-generator', docId));
}

// ─── Save (inline, no modal) ──────────────────────────────────────────────────

async function handleSave() {
    const btn = document.getElementById('saveToCloud');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        await persistToCloud();
        btn.textContent = 'Saved ✓';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 1800);
    } catch (err) {
        console.error('Save error:', err);
        btn.textContent = 'Error';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 2000);
    }
}

// ─── Load Modal ───────────────────────────────────────────────────────────────

let _allCloudInvoices = [];

function formatPackageName(data) {
    if (data.invoiceItems && data.invoiceItems.length > 1) {
        const labels = data.invoiceItems
            .map(item => item.description)
            .filter(Boolean)
            .slice(0, 2);
        const suffix = data.invoiceItems.length > 2 ? ` +${data.invoiceItems.length - 2} more` : '';
        return labels.join(' + ') + suffix;
    }

    if (data.invoiceItems && data.invoiceItems.length === 1) {
        const item = data.invoiceItems[0];
        if (item.isWorkshop || isWorkshopEventType(item.eventType)) {
            const title = item.description || WORKSHOP_TITLES[item.eventType] || 'Workshop';
            const pax = item.cups;
            if (pax) {
                const paxNum = String(pax).match(/\d+/) ? String(pax).match(/\d+/)[0] : pax;
                return `${title} · ${paxNum} pax`;
            }
            return title;
        }
        if (item.cups) {
            const cupsNum = String(item.cups).match(/\d+/) ? String(item.cups).match(/\d+/)[0] : item.cups;
            return `${item.description || 'Package'} · ${cupsNum} cups`;
        }
        return item.description || null;
    }

    const eventType = data.eventType || EVENT_TYPES.mobile_bar;

    if (isWorkshopEventType(eventType)) {
        const title = WORKSHOP_TITLES[eventType] || eventType;
        const pax = data.workshopPax || (data.invoiceItems && data.invoiceItems[0] && data.invoiceItems[0].cups);
        if (pax) {
            const paxNum = String(pax).match(/\d+/) ? String(pax).match(/\d+/)[0] : pax;
            return `${title} · ${paxNum} pax`;
        }
        return title;
    }

    const packageType = data.packageType;
    const numberOfPax = data.numberOfPax;
    const names = { starter: 'Starter', signature: 'Signature', special: 'Special', custom: 'Custom' };
    if (!packageType) return null;
    const name = names[packageType] || packageType;
    return numberOfPax ? `${name} · ${numberOfPax} cups` : name;
}

function formatSavedDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderInvoiceCards(invoices) {
    const list = document.getElementById('cloudInvoiceList');
    if (!invoices.length) {
        list.innerHTML = '<div class="cloud-modal-empty">No saved invoices found.</div>';
        return;
    }

    list.innerHTML = invoices.map(inv => {
        const client = escapeHtml(inv.clientName || 'No client name');
        const invNum = escapeHtml(inv.invoiceNumber || '');
        const eventDateStr = (inv.invoiceItems || []).map(i => i.eventDate).filter(Boolean).sort().pop()
            || inv.eventDate || '';
        const eventDate = eventDateStr ? formatDate(eventDateStr) : '';
        const pkg = formatPackageName(inv);
        const total = inv.totalAmount != null ? `Php ${formatCurrency(inv.totalAmount)}` : '';

        return `
        <div class="invoice-card" data-id="${inv.id}">
            <div class="invoice-card-main">
                <div class="invoice-card-client">${client}</div>
                <div class="invoice-card-meta">
                    ${invNum ? `<span>${invNum}</span>` : ''}
                    ${eventDate ? `<span>📅 ${eventDate}</span>` : ''}
                </div>
                ${pkg ? `<div style="margin-top:0.35rem;"><span class="invoice-card-badge">${escapeHtml(pkg)}</span></div>` : ''}
            </div>
            <div class="invoice-card-total">
                ${total}
                <small>Total</small>
            </div>
            <button class="invoice-card-delete" data-id="${inv.id}" title="Delete">🗑</button>
        </div>`;
    }).join('');

    list.querySelectorAll('.invoice-card').forEach(card => {
        card.addEventListener('click', function(e) {
            if (e.target.closest('.invoice-card-delete')) return;
            const id = this.dataset.id;
            const inv = _allCloudInvoices.find(i => i.id === id);
            if (inv) {
                restoreFromPayload(inv, id);
                clearAiChatHistory();
                closeLoadModal();
            }
        });
    });

    list.querySelectorAll('.invoice-card-delete').forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            const id = this.dataset.id;
            const inv = _allCloudInvoices.find(i => i.id === id);
            const name = inv ? (inv.clientName || inv.invoiceNumber || 'this invoice') : 'this invoice';
            if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
            try {
                await deleteCloudInvoice(id);
                if (_currentCloudDocId === id) _currentCloudDocId = null;
                _allCloudInvoices = _allCloudInvoices.filter(i => i.id !== id);
                renderInvoiceCards(_allCloudInvoices);
            } catch (err) {
                alert('Error deleting. Please try again.');
            }
        });
    });
}

function filterInvoices(searchQuery) {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return _allCloudInvoices;
    return _allCloudInvoices.filter(inv =>
        (inv.clientName || '').toLowerCase().includes(q) ||
        (inv.invoiceNumber || '').toLowerCase().includes(q) ||
        (inv.packageType || '').toLowerCase().includes(q) ||
        (inv.eventType || '').toLowerCase().includes(q) ||
        (WORKSHOP_TITLES[inv.eventType] || '').toLowerCase().includes(q) ||
        (inv.invoiceItems || []).some(item => (item.description || '').toLowerCase().includes(q))
    );
}

async function openLoadModal() {
    document.getElementById('cloudModal').style.display = 'flex';
    document.getElementById('invoiceSearchInput').value = '';
    const list = document.getElementById('cloudInvoiceList');
    list.innerHTML = '<div class="cloud-modal-loading">Loading…</div>';

    try {
        _allCloudInvoices = await fetchCloudInvoices();
        renderInvoiceCards(_allCloudInvoices);
    } catch (err) {
        list.innerHTML = '<div class="cloud-modal-empty">Error loading. Check your connection.</div>';
        console.error(err);
    }
}

function closeLoadModal() {
    document.getElementById('cloudModal').style.display = 'none';
}

// ─── AI chat mode ─────────────────────────────────────────────────────────────

const AI_CHAT_STORAGE_KEY = 'invoiceGeneratorAiChat';
const AI_MODE_STORAGE_KEY = 'invoiceGeneratorEditorMode';
/** Flip to false once debugging is done. */
const INVOICE_AI_DEBUG = true;
const INVOICE_AI_DEBUG_BUILD = '2026-08-28-matcha-latte-fix-1';

function aiDebug(...args) {
    if (!INVOICE_AI_DEBUG) return;
    console.log('[invoice-ai]', ...args);
}

function aiDebugWarn(...args) {
    if (!INVOICE_AI_DEBUG) return;
    console.warn('[invoice-ai]', ...args);
}

let aiChatMessages = [];
let aiChatBusy = false;
let editorMode = 'manual';

function loadAiChatFromStorage() {
    try {
        const raw = localStorage.getItem(AI_CHAT_STORAGE_KEY);
        if (!raw) {
            aiChatMessages = [];
            return;
        }
        const parsed = JSON.parse(raw);
        aiChatMessages = Array.isArray(parsed) ? parsed.filter(m => m && m.content) : [];
    } catch {
        aiChatMessages = [];
    }
}

function saveAiChatToStorage() {
    try {
        localStorage.setItem(AI_CHAT_STORAGE_KEY, JSON.stringify(aiChatMessages));
    } catch {
        /* ignore quota */
    }
}

function clearAiChatHistory() {
    aiChatMessages = [];
    localStorage.removeItem(AI_CHAT_STORAGE_KEY);
    renderAiChatMessages();
}

function setEditorMode(mode) {
    editorMode = mode === 'ai' ? 'ai' : 'manual';
    try {
        localStorage.setItem(AI_MODE_STORAGE_KEY, editorMode);
    } catch {
        /* ignore */
    }

    const manualPane = document.getElementById('manualPane');
    const aiPane = document.getElementById('aiPane');
    const manualBtn = document.getElementById('modeManualBtn');
    const aiBtn = document.getElementById('modeAiBtn');

    const isAi = editorMode === 'ai';
    if (manualPane) manualPane.classList.toggle('is-hidden', isAi);
    if (aiPane) {
        aiPane.classList.toggle('is-hidden', !isAi);
        if (isAi) aiPane.removeAttribute('hidden');
        else aiPane.setAttribute('hidden', '');
    }
    if (manualBtn) {
        manualBtn.classList.toggle('is-active', !isAi);
        manualBtn.setAttribute('aria-selected', String(!isAi));
    }
    if (aiBtn) {
        aiBtn.classList.toggle('is-active', isAi);
        aiBtn.setAttribute('aria-selected', String(isAi));
    }

    if (isAi) {
        renderAiChatMessages();
        const input = document.getElementById('aiChatInput');
        if (input) setTimeout(() => input.focus(), 0);
    }
}

function renderAiChatMessages() {
    const container = document.getElementById('aiChatMessages');
    if (!container) return;

    const empty = document.getElementById('aiChatEmpty');
    if (!aiChatMessages.length && !aiChatBusy) {
        container.innerHTML = '';
        const emptyEl = document.createElement('div');
        emptyEl.className = 'ai-chat-empty';
        emptyEl.id = 'aiChatEmpty';
        emptyEl.textContent =
            'Paste a quote, email, or notes — I’ll fill the invoice. You can keep chatting to adjust it.';
        container.appendChild(emptyEl);
        return;
    }

    if (empty) empty.remove();

    container.innerHTML = aiChatMessages
        .map((m) => {
            const role = m.role === 'assistant' ? 'assistant' : m.role === 'error' ? 'error' : 'user';
            const cls = role === 'error' ? 'ai-chat-bubble error' : `ai-chat-bubble ${role}`;
            return `<div class="${cls}">${escapeHtml(m.content)}</div>`;
        })
        .join('');

    if (aiChatBusy) {
        container.insertAdjacentHTML(
            'beforeend',
            '<div class="ai-chat-bubble busy" id="aiChatBusy" aria-label="Updating invoice">' +
                '<span class="ai-typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>' +
                '</div>'
        );
    }

    container.scrollTop = container.scrollHeight;
}

function buildCurrentInvoiceForAi() {
    const slimItem = (item) => ({
        id: item.id,
        eventType: item.eventType,
        eventVenue: item.eventVenue || '',
        eventDate: item.eventDate || '',
        packageType: item.packageType || '',
        numberOfPax: item.numberOfPax || '',
        customCups: item.customCups || '',
        cups: item.cups || '',
        coffeeAddOn: !!item.coffeeAddOn,
        transportAddOn: item.transportAddOn || 'none',
        unitCost: item.unitCost != null && item.unitCost !== '' ? item.unitCost : '',
        priceOverride: item.priceOverride != null && item.priceOverride !== '' ? item.priceOverride : '',
        workshopInclusions: Array.isArray(item.workshopInclusions) ? item.workshopInclusions : [],
        workshopDetails: item.workshopDetails || '',
        durationHours: item.durationHours != null && item.durationHours !== ''
            ? Number(item.durationHours)
            : 3,
        choiceDrinks: normalizeChoiceDrinksList(
            Array.isArray(item.choiceDrinks) ? item.choiceDrinks : [],
            choiceSlotsForPackageType(item.packageType),
            !!item.coffeeAddOn
        ),
        additionalOptions: Array.isArray(item.additionalOptions)
            ? item.additionalOptions.map((o) => String(o || '').trim()).filter(Boolean)
            : [],
        otherInclusions: Array.isArray(item.otherInclusions) ? item.otherInclusions : []
    });

    return {
        invoiceNumber: document.getElementById('invoiceNumber').value,
        invoiceDate: document.getElementById('invoiceDate').value,
        clientName: document.getElementById('clientName').value,
        clientAddress: document.getElementById('clientAddress').value,
        clientTIN: document.getElementById('clientTIN').value,
        notes: document.getElementById('notes').value,
        invoiceItems: invoiceItems.map(slimItem),
        customLineItems: customLineItems,
        paymentMilestones: paymentMilestones,
        paymentStructure: paymentStructure,
        paymentTermsCustomized: paymentTermsCustomized
    };
}

/** Plain-text snapshot of what the A4 preview shows — so Gemini can quote the doc. */
function buildInvoiceDocumentPreview() {
    const lines = [];
    const invNo = document.getElementById('invoiceNumber')?.value || '';
    const invDate = document.getElementById('invoiceDate')?.value || '';
    const clientName = document.getElementById('clientName')?.value || '';
    const clientAddress = document.getElementById('clientAddress')?.value || '';
    const clientTIN = document.getElementById('clientTIN')?.value || '';
    const notes = document.getElementById('notes')?.value || '';

    lines.push('BILLING INVOICE');
    if (invNo) lines.push(`Invoice #: ${invNo}`);
    if (invDate) lines.push(`Date: ${formatDate(invDate)}`);
    lines.push(`Billed to: ${clientName || '(none)'}`);
    if (clientAddress) lines.push(`Address: ${clientAddress}`);
    if (clientTIN) lines.push(`TIN: ${clientTIN}`);
    lines.push('');

    invoiceItems.forEach((item, idx) => {
        if (!isPackageVisibleInPreview(item)) return;
        lines.push(`--- Package ${idx + 1} ---`);
        if (item.description) lines.push(item.description);
        const cupsMatch = String(item.cups || '').match(/\d+/);
        if (cupsMatch) lines.push(`${cupsMatch[0]} cups`);

        const menuItems = (item.menuItems || []).map((m) => String(m).trim()).filter(Boolean);
        if (menuItems.length) {
            lines.push('Menu:');
            menuItems.forEach((m) => lines.push(`  - ${m}`));
        }

        const servingBits = (item.additionalOptions || []).map((o) => String(o).trim()).filter(Boolean);
        if (servingBits.length) {
            lines.push(servingBits.join(' · '));
        }

        const inclusions = [];
        if (item.duration) inclusions.push(item.duration);
        (item.serviceWindow || []).forEach((s) => {
            if (String(s).trim()) inclusions.push(String(s).trim());
        });
        if (item.baristas) inclusions.push(item.baristas);
        (item.otherInclusions || []).forEach((inc) => {
            if (String(inc).trim()) inclusions.push(String(inc).trim());
        });
        if (isWorkshopItem(item) && Array.isArray(item.workshopInclusions)) {
            item.workshopInclusions.forEach((inc) => {
                if (String(inc).trim()) inclusions.push(String(inc).trim());
            });
        }
        if (inclusions.length) {
            lines.push('Inclusions:');
            inclusions.forEach((inc) => lines.push(`  - ${inc}`));
        }

        if (item.workshopDetails && String(item.workshopDetails).trim()) {
            lines.push(`Additional Details: ${String(item.workshopDetails).trim()}`);
        }

        const venue = item.eventVenue || '';
        const eventDate = item.eventDate || '';
        if (venue || eventDate) {
            const parts = [];
            if (venue) parts.push(`Venue: ${venue}`);
            if (eventDate) parts.push(`Date: ${formatDate(eventDate)}`);
            lines.push(parts.join(' · '));
        }

        const pricing = getInvoiceItemPricing(item);
        if (pricing.subtotal) {
            lines.push(`Unit / Subtotal: Php ${formatCurrency(pricing.subtotal)}`);
        }

        getPackageAddonLineItems(item).forEach((addon) => {
            lines.push(`${addon.name}: Php ${formatCurrency(addon.price)}`);
        });

        lines.push('');
    });

    (customLineItems || []).forEach((line) => {
        if (!line?.name) return;
        const qty = line.quantity || 1;
        const price = line.price || 0;
        lines.push(`Custom: ${line.name} × ${qty} = Php ${formatCurrency(price * qty)}`);
        if (line.description) lines.push(`  ${line.description}`);
    });

    const activeMilestones = (paymentMilestones || []).filter(
        (m) => m.milestone && (m.percentage > 0 || m.paid)
    );
    if (activeMilestones.length) {
        lines.push('Payment schedule:');
        activeMilestones.forEach((m) => {
            const dateStr = m.date ? formatDate(m.date) : '-';
            const amt = m.amount > 0 ? `Php ${formatCurrency(m.amount)}` : '-';
            const pct = m.percentage != null ? `${m.percentage}%` : '';
            const paid = m.paid ? ' (paid)' : '';
            lines.push(`  - ${m.milestone}: ${dateStr} ${pct} ${amt}${paid}`.replace(/\s+/g, ' ').trim());
        });
    }

    if (notes) {
        lines.push('');
        lines.push(`Notes: ${notes}`);
    }

    return lines.join('\n').trim();
}

/** True when the latest user turn clearly asks to wipe the invoice. */
function userAskedToClearInvoice(text) {
    const t = String(text || '').toLowerCase().trim();
    if (!t) return false;
    if (/\b(start over|start fresh|blank invoice|new blank)\b/.test(t)) return true;
    if (/\b(clear|reset|wipe|empty)\b/.test(t) &&
        /\b(invoice|template|form|everything|all|it)\b/.test(t)) {
        return true;
    }
    return /^(clear|reset)(\s+(the\s+)?(invoice|template|form))?[!?.]*$/.test(t);
}

function pickMergedString(currentVal, incomingVal, allowClear) {
    if (typeof incomingVal === 'string' && incomingVal.trim()) return incomingVal.trim();
    if (allowClear && typeof incomingVal === 'string' && !incomingVal.trim()) return '';
    if (currentVal == null) return '';
    return String(currentVal);
}

function pickMergedArray(currentArr, incomingArr, allowClear) {
    if (Array.isArray(incomingArr) && incomingArr.length > 0) return incomingArr;
    if (allowClear && Array.isArray(incomingArr) && incomingArr.length === 0) return [];
    return Array.isArray(currentArr) ? currentArr : [];
}

function pickMergedField(currentVal, incomingVal) {
    if (incomingVal == null) return currentVal;
    if (typeof incomingVal === 'string') {
        return incomingVal.trim() ? incomingVal.trim() : (currentVal ?? '');
    }
    if (typeof incomingVal === 'number') {
        if (Number.isNaN(incomingVal)) return currentVal;
        return incomingVal;
    }
    if (typeof incomingVal === 'boolean') return incomingVal;
    if (Array.isArray(incomingVal)) {
        return incomingVal.length > 0 ? incomingVal : (Array.isArray(currentVal) ? currentVal : []);
    }
    return incomingVal || currentVal;
}

/** Merge package rows field-by-field so sparse Gemini items cannot wipe filled values. */
function mergePackageItems(currentItems, incomingItems, allowClear) {
    const cur = Array.isArray(currentItems) ? currentItems : [];
    const inc = Array.isArray(incomingItems) ? incomingItems : [];
    if (allowClear && inc.length === 0) return [];
    if (!inc.length) return cur.slice();
    if (!cur.length) return inc.map((item) => ({ ...item }));

    const usedCur = new Set();
    const merged = inc.map((incoming, i) => {
        let base = null;
        if (incoming?.id != null) {
            const byId = cur.findIndex((c) => c && c.id === incoming.id);
            if (byId >= 0) {
                base = cur[byId];
                usedCur.add(byId);
            }
        }
        if (!base && i < cur.length && !usedCur.has(i)) {
            base = cur[i];
            usedCur.add(i);
        }
        if (!base) return { ...incoming };

        const out = { ...base };
        const keys = new Set([...Object.keys(base), ...Object.keys(incoming || {})]);
        keys.forEach((key) => {
            if (key === 'id') {
                out.id = incoming.id != null ? incoming.id : base.id;
                return;
            }
            out[key] = pickMergedField(base[key], incoming[key]);
        });
        return out;
    });

    // Keep any current rows Gemini omitted (don't silently drop packages)
    cur.forEach((item, i) => {
        if (!usedCur.has(i) && merged.length < cur.length) {
            // only append unused if incoming was shorter — already handled by map length
        }
    });
    if (inc.length < cur.length) {
        for (let i = 0; i < cur.length; i++) {
            if (!usedCur.has(i)) merged.push({ ...cur[i] });
        }
    }
    return merged;
}

function titleCaseName(name) {
    return String(name || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => {
            if (/^[A-Z0-9.&'-]+$/.test(w) && w.length <= 4) return w;
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        })
        .join(' ');
}

function clipNameCandidate(name) {
    let t = String(name || '').trim();
    if (!t) return '';
    t = t.split(/[,|\n]/)[0].trim();
    t = t.replace(/'s\b.*$/i, '').trim();
    // Clause split: "Bea Boldo and set the event…" → "Bea Boldo"
    t = sanitizeCompoundClientName(t);
    // Strip trailing headcount before generic stop-words (avoids "Catherine Dee 20")
    t = t.replace(/\s+\d{1,4}\s*[- ]?(?:cups?|pax|guests?|participants?).*$/i, '');
    t = t.replace(
        /\s+\b(?:for|with|at|in|on|address|venue|package|starter|signature|special|mobile|matcha|workshop|cups?|pax|guests?|participants?)\b[\s\S]*$/i,
        ''
    );
    t = t.replace(/\s+\d{1,4}\s*$/g, '').trim();
    return t.trim();
}

/**
 * Drop instruction clauses glued with "and" (not a venue dictionary).
 * "Bea Boldo And Set The Event" → "Bea Boldo"
 */
function sanitizeCompoundClientName(name) {
    let t = String(name || '').trim();
    if (!t) return '';
    const m = t.match(
        /^(.+?)\s+and\s+(set|make|change|update|book|add|put|create|schedule)\b[\s\S]*$/i
    );
    if (m) return m[1].trim();
    return t;
}

function cleanExtractedClientName(name) {
    let cleaned = clipNameCandidate(name).replace(/[.!?]+$/g, '').trim();
    cleaned = cleaned.replace(/^(?:the\s+)?(?:client(?:\s+name)?|name|company)\s+(?:is\s+|:?\s*)/i, '').trim();
    cleaned = cleaned.replace(/\s+(please|thanks|thank you)$/i, '').trim();
    if (!cleaned) return '';
    if (/^(the|a|an|me|us|this|that|my|our|them|it|its|it's|how|about|starter|signature|special)$/i.test(cleaned)) return '';
    if (/^\d+$/.test(cleaned)) return '';
    if (cleaned.length < 2) return '';
    if (cleaned.length > 60) cleaned = cleaned.slice(0, 60).trim();
    // Reject if it still looks like instructions, not a person/company name
    if (/\b(pax|cups?|address|package|starter|signature|special|invoice|update|please|hours?|service|workshop|how about)\b/i.test(cleaned)) {
        return '';
    }
    if (isCompoundClauseClientName(cleaned)) return '';
    return titleCaseName(cleaned);
}

function isCompoundClauseClientName(name) {
    return /\band\s+(set|make|change|update|book|add|put|create|schedule)\b/i.test(String(name || ''));
}

function isContaminatedClientName(name) {
    const s = String(name || '');
    if (!s) return false;
    if (s.length > 48) return true;
    if (isCompoundClauseClientName(s)) return true;
    return /\b(pax|cups?|address|package|starter|signature|special|for\s+\d|invoice|update|hours?|service|workshop|how about)\b/i.test(s);
}

/** True when the user clearly renames the billed-to party (must overwrite form/Gemini). */
function isExplicitRenameIntent(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    return (
        /\b(?:just\s+)?(?:make|set)\s+it\s+(?:to\s+)?/i.test(raw) ||
        /\b(?:rename(?:\s+client)?(?:\s+to)?|change\s+(?:the\s+)?(?:client\s+)?name\s+to|set\s+(?:the\s+)?(?:client\s+)?name\s+to)\b/i.test(
            raw
        ) ||
        /\bchange\s+(?:it|this|that|the\s+name)\s+to\b/i.test(raw)
    );
}

function extractClientNameFromUserText(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    // Stop capture at " and …" so compound instructions are not part of the name
    const patterns = [
        /\b(?:write\s+(?:the\s+)?invoice\s+to|make\s+(?:me\s+)?(?:an?\s+)?invoice\s+for|invoice\s+(?:for|to)|billed\s+to)\s+(.+?)(?=\s+and\s+|[.!?]|$)/i,
        /\bbill(?:\s+\w+){0,3}\s+to\s+(.+?)(?=\s+and\s+|[.!?]|$)/i,
        /\b(?:client(?:\s+name)?|name|company)\s*(?:is|:|=)\s*(.+?)(?=\s+and\s+|[.!?]|$)/i,
        /\bit'?s\s+([A-Za-z][A-Za-z0-9 .,'&-]{1,60})$/i,
        /\b(?:rename(?:\s+client)?(?:\s+to)?|change\s+(?:the\s+)?(?:client\s+)?name\s+to|set\s+(?:the\s+)?(?:client\s+)?name\s+to)\s+(.+?)(?=\s+and\s+|[.!?]|$)/i,
        /\bchange\s+(?:it|this|that|the\s+name)\s+to\s+(.+?)(?=\s+and\s+|[.!?]|$)/i,
        /\b(?:just\s+)?(?:make|set)\s+it\s+(?:to\s+)?(.+?)(?=\s+and\s+|[.!?]|$)/i
    ];
    for (const re of patterns) {
        const m = raw.match(re);
        if (!m) continue;
        const name = cleanExtractedClientName(m[1]);
        if (name) return name;
    }
    return '';
}

function extractClientNameFromAssistantText(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const patterns = [
        /\b(?:client(?:\s+name)?|billed\s+to|name)\s+(?:to|as|:)\s+([A-Za-z][A-Za-z0-9 .,'&-]{1,60})/i,
        /\bupdated\s+(?:the\s+)?(?:client(?:\s+name)?|name)\s+to\s+([A-Za-z][A-Za-z0-9 .,'&-]{1,60})/i,
        /\bset\s+(?:the\s+)?(?:client(?:\s+name)?|name)\s+to\s+([A-Za-z][A-Za-z0-9 .,'&-]{1,60})/i,
        /\binvoice\s+for\s+([A-Za-z][A-Za-z0-9 .,'&-]{1,60})/i
    ];
    for (const re of patterns) {
        const m = raw.match(re);
        if (!m) continue;
        const name = cleanExtractedClientName(m[1]);
        if (name) return name;
    }
    return '';
}

function cleanPlaceName(value) {
    let t = String(value || '').trim().replace(/[.!?]+$/g, '').trim();
    t = t.replace(/^(?:the\s+)/i, '').trim();
    if (!t || t.length < 2) return '';
    if (t.length > 80) t = t.slice(0, 80).trim();
    return titleCaseName(t);
}

const MONTH_NAME_TO_NUM = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
};

function parseLooseEventDate(text, fallbackYear) {
    const raw = String(text || '');
    const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];

    const slash = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
    if (slash) {
        const a = parseInt(slash[1], 10);
        const b = parseInt(slash[2], 10);
        const y = parseInt(slash[3], 10);
        // Prefer D/M/YYYY when day > 12; else assume M/D if first <= 12
        let month;
        let day;
        if (a > 12) {
            day = a;
            month = b;
        } else if (b > 12) {
            month = a;
            day = b;
        } else {
            day = a;
            month = b;
        }
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }

    const named = raw.match(
        /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i
    );
    if (named) {
        const month = MONTH_NAME_TO_NUM[named[1].toLowerCase().replace(/\.$/, '')];
        const day = parseInt(named[2], 10);
        const year = named[3] ? parseInt(named[3], 10) : (fallbackYear || new Date().getFullYear());
        if (month && day >= 1 && day <= 31) {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }
    return '';
}

function parseUnitCostHint(text) {
    const raw = String(text || '');
    const patterns = [
        /@\s*₱?\s*([\d,]+(?:\.\d+)?)\b/i,
        /\b(?:at|of)\s*₱?\s*([\d,]+(?:\.\d+)?)\s*(?:per\s*(?:pax|person|participant|head))?/i,
        /₱\s*([\d,]+(?:\.\d+)?)\s*(?:per\s*(?:pax|person|participant|head))?/i,
        /\b([\d,]+(?:\.\d+)?)\s*(?:php|pesos?)?\s*per\s*(?:pax|person|participant|head)\b/i
    ];
    for (const re of patterns) {
        const m = raw.match(re);
        if (!m) continue;
        const n = parseFloat(String(m[1]).replace(/,/g, ''));
        if (n > 0 && n < 1000000) return String(n);
    }
    return '';
}

/** Pull package / address / cups hints from free text when Gemini leaves fields blank. */
function parseInvoiceHintsFromText(...texts) {
    const raw = texts.filter(Boolean).join('\n');
    if (!raw.trim()) return {};

    const hints = {};

    if (/\bmochi\b/i.test(raw) && /\bworkshop\b/i.test(raw)) {
        hints.eventType = EVENT_TYPES.mochi_workshop;
    } else if (/\bmatcha\b/i.test(raw) && /\bworkshop\b/i.test(raw)) {
        hints.eventType = EVENT_TYPES.matcha_workshop;
    } else if (/\b(mobile\s+(?:matcha\s+)?bar|matcha\s+bar)\b/i.test(raw)) {
        hints.eventType = EVENT_TYPES.mobile_bar;
    } else if (/\b(starter|signature|special)\b/i.test(raw) && /\b(cups?|bar)\b/i.test(raw)) {
        hints.eventType = EVENT_TYPES.mobile_bar;
    }

    // "Address is in Sulu mochi making workshop" → city for billed-to + venue
    const addrIn = raw.match(
        /\baddress\s*(?:is\s*)?(?:in|at|:)?\s*([A-Za-z][A-Za-z0-9 .'-]*?)(?=\s+(?:mochi|matcha|mobile|workshop|package|starter|for\s+\d)|[,.]|$)/i
    );
    if (addrIn && !isAddressSearchRequest(raw)) {
        const place = cleanPlaceName(addrIn[1]);
        if (place && place.length <= 40 && !isContaminatedAddress(place)) {
            hints.clientAddress = place;
            hints.eventVenue = place;
        }
    }

    const venueOnly = raw.match(/\b(?:venue|location)\s*(?:is\s*)?(?:in|at|:)?\s*([^,.\n@]+)/i);
    if (venueOnly && !hints.eventVenue && !isAddressSearchRequest(raw)) {
        const place = cleanPlaceName(venueOnly[1]);
        if (!isContaminatedAddress(place)) hints.eventVenue = place;
    }

    // "sept 30, taguig @ 1950" — city between comma and @/price
    if (!hints.eventVenue && !isAddressSearchRequest(raw)) {
        const cityAt = raw.match(
            /,\s*([A-Za-z][A-Za-z .'-]{1,40}?)\s*(?:@|at\s*₱|at\s*\d)/i
        );
        if (cityAt) hints.eventVenue = cleanPlaceName(cityAt[1]);
    }
    if (!hints.eventVenue && !isAddressSearchRequest(raw)) {
        const inCity = raw.match(/\bin\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?=\s+(?:on|at|@|,|\d)|$)/i);
        if (inCity && !/\b(the|a|an|our|my)\b/i.test(inCity[1])) {
            hints.eventVenue = cleanPlaceName(inCity[1]);
        }
    }

    const resolvedPkg = resolvePackageTypeFromText(raw);
    if (resolvedPkg) hints.packageType = resolvedPkg;

    const cupsMatch =
        raw.match(/\b(\d{2,4})\s*[- ]?(?:cup|cups)\b/i) ||
        raw.match(/\b(\d{2,4})-cup\b/i) ||
        raw.match(/\b(?:cup|cups)\s*[:=]?\s*(\d{2,4})\b/i);
    if (cupsMatch) {
        const n = parseInt(cupsMatch[1], 10);
        if (n >= 50 && n <= 500) {
            hints.cups = n;
        }
    }

    const paxMatch =
        raw.match(/\b(\d{1,4})\s*[- ]?(?:pax|guests|participants?)\b/i) ||
        raw.match(/\b(?:pax|guests|participants?)\s*[:=]?\s*(\d{1,4})\b/i);
    if (paxMatch) {
        const n = parseInt(paxMatch[1], 10);
        if (n >= 1 && n <= 500) hints.pax = n;
    }

    const hoursMatch = raw.match(/\b(\d{1,2})\s*hours?\s+(?:of\s+)?service\b/i);
    if (hoursMatch) {
        const h = parseInt(hoursMatch[1], 10);
        if (h >= 1 && h <= 24) hints.durationHours = h;
    }

    const unitCost = parseUnitCostHint(raw);
    if (unitCost) hints.unitCost = unitCost;

    const looseDate = parseLooseEventDate(raw);
    if (looseDate) {
        if (/\binvoice\s+date\b/i.test(raw) || /\bdate\s+of\s+(?:the\s+)?invoice\b/i.test(raw)) {
            hints.invoiceDate = looseDate;
        } else {
            hints.eventDate = looseDate;
        }
    }

    const milkOpts = parseMilkOptionsFromUserText(raw);
    if (milkOpts) hints.additionalOptions = milkOpts;

    if (wantsThreeMilestones(raw)) {
        hints.paymentStructure = 'three';
        hints.forceDefaultMilestones = true;
    } else if (wantsTwoMilestones(raw)) {
        hints.paymentStructure = 'two';
        hints.forceDefaultMilestones = true;
    }

    if (/\bcoffee\s+add[- ]?on\b/i.test(raw) || /\bwith\s+coffee\b/i.test(raw)) {
        hints.coffeeAddOn = true;
    }

    if (/\blaguna\b/i.test(raw)) hints.transportAddOn = 'laguna';
    else if (/\bbulacan\b/i.test(raw)) hints.transportAddOn = 'bulacan';
    else if (/\btagaytay\b/i.test(raw)) hints.transportAddOn = 'tagaytay';
    else if (/\bpampanga\b/i.test(raw)) hints.transportAddOn = 'pampanga';

    return hints;
}

function applyCupsToMobileItem(item, cups) {
    const n = parseInt(cups, 10);
    if (!n || n < 1) return;
    if (n === 100 || n === 150) {
        item.numberOfPax = String(n);
        item.customCups = '';
    } else {
        item.numberOfPax = 'custom';
        item.customCups = String(n);
    }
    item.cups = String(n);
}

/** Domain rule: on a matcha/mobile bar, "N pax" means cups (not workshop participants). */
function normalizeBarPaxToCups(hints) {
    if (!hints || typeof hints !== 'object') return hints;
    const isBar =
        hints.eventType === EVENT_TYPES.mobile_bar ||
        !!hints.packageType ||
        (hints.eventType !== EVENT_TYPES.matcha_workshop &&
            hints.eventType !== EVENT_TYPES.mochi_workshop &&
            !!hints.cups);
    if (isBar && hints.pax && !hints.cups) {
        hints.cups = hints.pax;
    }
    return hints;
}

function buildMobileBarItemFromHints(hints, baseItem) {
    const existingCups =
        (baseItem && resolveMobileBarCups(baseItem)) ||
        parseInt(String(baseItem?.cups || '').replace(/\D/g, ''), 10) ||
        0;
    const hintedCups = parseInt(hints.cups, 10) || 0;
    // Never default to 100 when patching an existing bar (e.g. user said only "starter")
    const cups = hintedCups || existingCups || (baseItem ? 0 : 100);
    const packageType = hints.packageType || baseItem?.packageType || 'starter';
    const item = baseItem && typeof baseItem === 'object' ? { ...baseItem } : createEmptyPackageItem();
    item.id = item.id || Date.now();
    item.eventType = EVENT_TYPES.mobile_bar;
    item.isWorkshop = false;
    item.packageType = packageType;
    item.coffeeAddOn =
        hints.coffeeAddOn != null ? !!hints.coffeeAddOn : !!item.coffeeAddOn;
    item.transportAddOn = hints.transportAddOn || item.transportAddOn || 'none';
    if (cups > 0) {
        applyCupsToMobileItem(item, cups);
    } else if (!baseItem) {
        applyCupsToMobileItem(item, 100);
    }
    if (hints.durationHours) item.durationHours = hints.durationHours;
    else if (item.durationHours == null) item.durationHours = 3;
    if (!Array.isArray(item.choiceDrinks)) item.choiceDrinks = [];
    if (hints.eventVenue) item.eventVenue = hints.eventVenue;
    else if (!item.eventVenue && hints.clientAddress) item.eventVenue = hints.clientAddress;
    if (hints.eventDate) item.eventDate = hints.eventDate;
    else if (!item.eventDate) item.eventDate = getDefaultPackageDate();
    syncPackageItem(item);
    return item;
}

function buildWorkshopItemFromHints(hints, baseItem) {
    const eventType =
        hints.eventType ||
        (baseItem && isWorkshopEventType(baseItem.eventType) ? baseItem.eventType : null) ||
        EVENT_TYPES.matcha_workshop;
    const item = baseItem && typeof baseItem === 'object' ? { ...baseItem } : createEmptyPackageItem();
    item.id = item.id || Date.now();
    item.eventType = eventType;
    item.isWorkshop = true;
    item.packageType = '';
    item.countLabel = 'participants';
    item.coffeeAddOn = false;
    item.transportAddOn = 'none';
    item.choiceDrinks = [];
    const pax = hints.pax || hints.cups;
    if (pax) item.cups = String(pax);
    if (hints.unitCost) item.unitCost = hints.unitCost;
    if (hints.eventVenue) item.eventVenue = hints.eventVenue;
    else if (hints.clientAddress && !item.eventVenue) item.eventVenue = hints.clientAddress;
    if (hints.eventDate) item.eventDate = hints.eventDate;
    else if (!item.eventDate) item.eventDate = getDefaultPackageDate();
    syncPackageItem(item);
    return item;
}

/** Patch an existing package from hints without wiping filled fields. */
function patchPackageItemFromHints(item, hints) {
    if (!item || !hints) return item;
    const next = { ...item };
    if (hints.eventType) {
        next.eventType = hints.eventType;
        next.isWorkshop = isWorkshopEventType(hints.eventType);
        if (next.isWorkshop) {
            next.packageType = '';
            next.countLabel = 'participants';
        }
    }
    const pax = hints.pax || (hints.eventType && isWorkshopEventType(hints.eventType) ? hints.cups : null);
    if (pax) next.cups = String(pax);
    if (hints.unitCost) next.unitCost = hints.unitCost;
    if (hints.eventVenue) next.eventVenue = hints.eventVenue;
    if (hints.eventDate) next.eventDate = hints.eventDate;
    if (hints.durationHours && !isWorkshopEventType(next.eventType)) {
        next.durationHours = hints.durationHours;
    }
    if (hints.packageType && !isWorkshopEventType(next.eventType)) {
        next.packageType = hints.packageType;
    }
    if (hints.cups && !isWorkshopEventType(next.eventType)) {
        applyCupsToMobileItem(next, hints.cups);
    }
    if (hints.coffeeAddOn != null && !isWorkshopEventType(next.eventType)) {
        next.coffeeAddOn = !!hints.coffeeAddOn;
    }
    if (hints.transportAddOn && !isWorkshopEventType(next.eventType)) {
        next.transportAddOn = hints.transportAddOn;
    }
    syncPackageItem(next);
    return next;
}

function shouldReplaceClientName(current, guessed, userText) {
    if (!guessed) return false;
    if (isContaminatedClientName(guessed)) return false;
    // Explicit rename always wins ("Just make it Bea Boldo (AXS Limited)")
    if (isExplicitRenameIntent(userText)) return true;
    // Only fill blanks or replace already-contaminated form values.
    // Never overwrite a clean Gemini/form name with user-text regex
    // (that produced "Bea Boldo And Set The Event" from "invoice to X and set…").
    if (!current) return true;
    if (isContaminatedClientName(current)) return true;
    return false;
}

function coerceIncomingInvoice(incoming) {
    if (!incoming) return {};
    if (typeof incoming === 'string') {
        try {
            return JSON.parse(incoming);
        } catch {
            return {};
        }
    }
    if (typeof incoming === 'object') return incoming;
    return {};
}

/**
 * Merge AI invoice onto current so empty Gemini fields cannot wipe a filled form.
 * Also applies text heuristics when Gemini leaves name/package/address blank.
 */
function mergeAiInvoice(current, incoming, { allowClear = false, userText = '', assistantMessage = '' } = {}) {
    const cur = current && typeof current === 'object' ? current : {};
    const inc = coerceIncomingInvoice(incoming);

    let paymentStructure = String(inc.paymentStructure || cur.paymentStructure || 'three').toLowerCase();
    if (paymentStructure !== 'two' && paymentStructure !== 'three') paymentStructure = 'three';

    const paymentTermsCustomized =
        typeof inc.paymentTermsCustomized === 'boolean'
            ? inc.paymentTermsCustomized
            : !!cur.paymentTermsCustomized;

    const merged = {
        invoiceNumber: pickMergedString(cur.invoiceNumber, inc.invoiceNumber, allowClear),
        invoiceDate: pickMergedString(cur.invoiceDate, inc.invoiceDate, allowClear),
        clientName: pickMergedString(cur.clientName, inc.clientName, allowClear),
        clientAddress: pickMergedString(cur.clientAddress, inc.clientAddress, allowClear),
        clientTIN: pickMergedString(cur.clientTIN, inc.clientTIN, allowClear),
        notes: pickMergedString(cur.notes, inc.notes, allowClear),
        invoiceItems: mergePackageItems(cur.invoiceItems, inc.invoiceItems, allowClear),
        customLineItems: pickMergedArray(cur.customLineItems, inc.customLineItems, allowClear),
        paymentMilestones: pickMergedArray(cur.paymentMilestones, inc.paymentMilestones, allowClear),
        paymentStructure,
        paymentTermsCustomized
    };

    // Sanitize compound-clause names from Gemini or prior form state
    merged.clientName = sanitizeCompoundClientName(merged.clientName);
    if (isContaminatedClientName(merged.clientName)) {
        const salvaged = cleanExtractedClientName(merged.clientName);
        if (salvaged) {
            merged.clientName = salvaged;
        } else if (cur.clientName && !isContaminatedClientName(sanitizeCompoundClientName(cur.clientName))) {
            merged.clientName = sanitizeCompoundClientName(cur.clientName);
        } else {
            merged.clientName = '';
        }
    }

    // User-text extract fills empty / contaminated names; renames always overwrite
    const guessedName = extractClientNameFromUserText(userText);
    if (shouldReplaceClientName(merged.clientName, guessedName, userText)) {
        aiDebug('replaced clientName from user text', {
            from: merged.clientName,
            to: guessedName,
            userText,
            rename: isExplicitRenameIntent(userText)
        });
        merged.clientName = guessedName;
    }

    // Scrub search-instruction addresses
    if (isContaminatedAddress(merged.clientAddress) || isAddressSearchRequest(userText)) {
        if (isContaminatedAddress(merged.clientAddress)) merged.clientAddress = '';
    }

    // Structural hints from user text only — assistant prose must not force rebuilds
    const hints = parseInvoiceHintsFromText(userText);
    normalizeBarPaxToCups(hints);
    aiDebug('text hints', hints);

    if (hints.invoiceDate) {
        merged.invoiceDate = hints.invoiceDate;
    }

    if (hints.forceDefaultMilestones && (hints.paymentStructure === 'three' || hints.paymentStructure === 'two')) {
        merged.paymentStructure = hints.paymentStructure;
        merged.paymentTermsCustomized = false;
        merged.paymentMilestones = buildDefaultMilestones(hints.paymentStructure);
    }

    if (hints.clientAddress && !isContaminatedAddress(hints.clientAddress)) {
        if (
            !merged.clientAddress ||
            isContaminatedClientName(merged.clientAddress) ||
            isContaminatedAddress(merged.clientAddress) ||
            /\baddress\b/i.test(userText || '')
        ) {
            merged.clientAddress = hints.clientAddress;
        }
    }

    // Drop bogus "hours of service" custom lines — those belong in durationHours
    if (Array.isArray(merged.customLineItems)) {
        merged.customLineItems = merged.customLineItems.filter(
            (line) => !/\bhours?\s+of\s+service\b/i.test(line?.name || '')
        );
    }

    const itemsLookBlank = (items) => {
        if (!Array.isArray(items) || items.length === 0) return true;
        return items.every(
            (it) =>
                !it?.packageType &&
                !it?.unitPrice &&
                !String(it?.cups || '').trim() &&
                !String(it?.description || '').trim() &&
                !isWorkshopEventType(it?.eventType)
        );
    };

    const wantWorkshop =
        hints.eventType === EVENT_TYPES.mochi_workshop ||
        hints.eventType === EVENT_TYPES.matcha_workshop;
    const wantBar =
        hints.eventType === EVENT_TYPES.mobile_bar ||
        !!hints.packageType ||
        (!!hints.cups && !wantWorkshop);
    const hasFollowUpFields = !!(
        hints.unitCost ||
        hints.eventVenue ||
        hints.eventDate ||
        hints.pax ||
        hints.durationHours
    );

    const items = Array.isArray(merged.invoiceItems) ? merged.invoiceItems.slice() : [];
    let idx = items.findIndex(
        (it) =>
            it?.eventType === EVENT_TYPES.mobile_bar ||
            !!it?.packageType ||
            isWorkshopEventType(it?.eventType) ||
            !!it?.isWorkshop
    );
    if (idx < 0 && items.length) idx = 0;

    if (!allowClear && wantWorkshop) {
        if (itemsLookBlank(items) || idx < 0) {
            merged.invoiceItems = [buildWorkshopItemFromHints(hints)];
            aiDebug('built workshop from hints', merged.invoiceItems[0]);
        } else {
            items[idx] = patchPackageItemFromHints(
                buildWorkshopItemFromHints(hints, items[idx]),
                hints
            );
            merged.invoiceItems = items;
            aiDebug('updated existing package to workshop from hints', merged.invoiceItems[idx]);
        }
    } else if (!allowClear && wantBar && (hints.cups || hints.packageType || hints.durationHours)) {
        const existingIsWorkshop =
            idx >= 0 &&
            (isWorkshopEventType(items[idx]?.eventType) || items[idx]?.isWorkshop);
        const forceBar =
            hints.eventType === EVENT_TYPES.mobile_bar ||
            !!hints.packageType ||
            /\b(mobile\s+(?:matcha\s+)?bar|matcha\s+bar|starter|signature|special)\b/i.test(
                userText || ''
            );

        if (existingIsWorkshop && !forceBar && hints.durationHours && !hints.cups && !hints.packageType) {
            // duration alone on a workshop — ignore for mobile duration
        } else if (existingIsWorkshop && !forceBar && hints.cups) {
            aiDebug('skipped cups→bar conversion while workshop active');
        } else if (itemsLookBlank(items) || idx < 0) {
            merged.invoiceItems = [buildMobileBarItemFromHints(hints)];
            aiDebug('built package from hints', merged.invoiceItems[0]);
        } else if (existingIsWorkshop && !forceBar) {
            // no-op
        } else {
            items[idx] = buildMobileBarItemFromHints(hints, items[idx]);
            merged.invoiceItems = items;
            aiDebug('updated existing package from hints', merged.invoiceItems[idx]);
        }
    } else if (!allowClear && hasFollowUpFields && idx >= 0) {
        items[idx] = patchPackageItemFromHints(items[idx], hints);
        merged.invoiceItems = items;
        aiDebug('patched existing package from follow-up hints', merged.invoiceItems[idx]);
    } else if (
        Array.isArray(merged.invoiceItems) &&
        merged.invoiceItems.length > 0 &&
        (hints.eventVenue || hints.durationHours)
    ) {
        merged.invoiceItems = merged.invoiceItems.map((it) => {
            const next = { ...it };
            if (hints.eventVenue && (!it.eventVenue || /\b(venue|location|address)\b/i.test(userText || ''))) {
                next.eventVenue = hints.eventVenue;
            }
            if (hints.durationHours && !isWorkshopEventType(it.eventType) && !it.isWorkshop) {
                next.durationHours = hints.durationHours;
            }
            return next;
        });
    }

    // Normalize + merge named choice drinks from user text onto mobile bar items
    if (Array.isArray(merged.invoiceItems) && merged.invoiceItems.length) {
        merged.invoiceItems = merged.invoiceItems.map((it) => {
            if (!it || isWorkshopEventType(it.eventType) || it.isWorkshop) return it;
            if (!it.packageType && it.eventType !== EVENT_TYPES.mobile_bar) return it;
            const next = { ...it };
            if (isContaminatedAddress(next.eventVenue)) next.eventVenue = '';
            const slots = choiceSlotsForPackageType(next.packageType);
            const coffeeOn = !!next.coffeeAddOn;
            next.choiceDrinks = applyChoiceDrinkEditsFromText(
                next.choiceDrinks,
                userText,
                slots,
                coffeeOn
            );
            const milkOpts = hints.additionalOptions || parseMilkOptionsFromUserText(userText);
            if (milkOpts) {
                next.additionalOptions = [...milkOpts];
            } else if (Array.isArray(next.additionalOptions)) {
                next.additionalOptions = next.additionalOptions
                    .map((o) => String(o || '').trim())
                    .filter(Boolean);
            }
            return next;
        });
    }

    const hasDual = (merged.invoiceItems || []).some(
        (it) =>
            it &&
            !it.isWorkshop &&
            Array.isArray(it.additionalOptions) &&
            it.additionalOptions.some((o) => /dairy\s+and\s+oat/i.test(String(o || '')))
    );
    if (hasDual) {
        const lines = Array.isArray(merged.customLineItems) ? [...merged.customLineItems] : [];
        const idx = lines.findIndex((l) => /dual\s+milk/i.test(String(l?.name || '')));
        if (idx < 0) {
            lines.push({
                id: Date.now() + 500,
                name: 'Dual Milk Add-On',
                description: 'Dairy and Oat Milk',
                quantity: 1,
                price: 500
            });
        } else if (!(Number(lines[idx].price) > 0)) {
            lines[idx] = { ...lines[idx], price: 500 };
        }
        merged.customLineItems = lines;
    }

    return merged;
}

function friendlyAiChatError(err) {
    const code = String(err?.code || err?.details?.code || '').toLowerCase();
    const message = String(
        err?.message || err?.details?.message || err?.customData?.message || ''
    );
    const m = message.toLowerCase();

    if (
        code.includes('not-found') ||
        m.includes('not-found') ||
        m.includes('404') ||
        m.includes('not found')
    ) {
        return 'AI chat isn’t deployed yet. Deploy generateInvoiceFromChat, then try again.';
    }
    if (
        code.includes('resource-exhausted') ||
        m.includes('high demand') ||
        m.includes('try again later') ||
        m.includes('resource exhausted') ||
        m.includes('overloaded') ||
        m.includes('unavailable') ||
        m.includes('couldn’t update the invoice right now') ||
        m.includes("couldn't update the invoice right now")
    ) {
        return 'Couldn’t update the invoice right now. Try again in a moment.';
    }
    if (
        code.includes('failed-precondition') ||
        m.includes('gemini_api_key') ||
        m.includes('not configured')
    ) {
        return 'Gemini isn’t configured on the server (GEMINI_API_KEY).';
    }
    if (code.includes('invalid-argument')) {
        return message || 'That message couldn’t be processed. Try again.';
    }
    // Surface real Firebase/Gemini text when we have it; keep it short.
    if (message && !m.includes('internal') && message.length < 180) {
        return message;
    }
    return 'Couldn’t update the invoice from that message. Try rephrasing or edit manually.';
}

async function callGenerateInvoiceFromChat(messages, currentInvoice, documentPreview) {
    aiDebug('callable request', {
        messageCount: messages.length,
        lastUser: messages.filter((m) => m.role === 'user').slice(-1)[0]?.content?.slice(0, 200),
        currentClientName: currentInvoice?.clientName,
        currentItems: currentInvoice?.invoiceItems?.length,
        previewChars: String(documentPreview || '').length
    });

    const { functions, httpsCallable } = await getFirebaseFunctions();
    const fn = httpsCallable(functions, 'generateInvoiceFromChat', { timeout: 60000 });
    const response = await fn({
        messages,
        currentInvoice,
        documentPreview: documentPreview || ''
    });
    aiDebug('callable raw response.data', response?.data);

    const result = response?.data;
    const invoice = result?.invoice ?? result?.parsed?.invoice ?? null;
    if (!invoice) {
        aiDebugWarn('no invoice in response', result);
        throw new Error('Chat returned no invoice data');
    }
    return {
        assistantMessage: result.assistantMessage || result?.parsed?.assistantMessage || '',
        invoice
    };
}

function flashBilledToHighlight() {
    const el = document.getElementById('displayClientName');
    if (!el) return;
    el.classList.remove('ai-field-flash');
    // reflow so animation can retrigger
    void el.offsetWidth;
    el.classList.add('ai-field-flash');
    window.setTimeout(() => el.classList.remove('ai-field-flash'), 1400);
}

function sleepMs(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Reveal assistant reply with a short typewriter effect. */
async function appendAssistantWithTypewriter(fullText) {
    const text = String(fullText || '').trim() || 'Updated the invoice.';
    const msg = { role: 'assistant', content: '' };
    aiChatMessages.push(msg);
    renderAiChatMessages();

    const container = document.getElementById('aiChatMessages');
    const bubble = container?.querySelector('.ai-chat-bubble.assistant:last-of-type');

    const step = Math.max(1, Math.ceil(text.length / 48));
    for (let i = 0; i < text.length; i += step) {
        msg.content = text.slice(0, Math.min(text.length, i + step));
        if (bubble) {
            bubble.textContent = msg.content;
            if (container) container.scrollTop = container.scrollHeight;
        } else {
            renderAiChatMessages();
        }
        await sleepMs(18);
    }
    msg.content = text;
    if (bubble) bubble.textContent = text;
    else renderAiChatMessages();
    saveAiChatToStorage();
}

async function sendAiChatMessage() {
    if (aiChatBusy) return;
    const input = document.getElementById('aiChatInput');
    const sendBtn = document.getElementById('aiChatSend');
    const text = (input?.value || '').trim();
    if (!text) return;

    aiDebug('send', { build: INVOICE_AI_DEBUG_BUILD, text });

    aiChatMessages.push({ role: 'user', content: text });
    if (input) {
        input.value = '';
        input.style.height = '';
    }
    saveAiChatToStorage();

    aiChatBusy = true;
    if (sendBtn) sendBtn.disabled = true;
    renderAiChatMessages();

    try {
        const history = aiChatMessages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role, content: m.content }));

        const current = buildCurrentInvoiceForAi();
        const documentPreview = buildInvoiceDocumentPreview();
        const nameBefore = String(current.clientName || '').trim();
        aiDebug('current before call', {
            clientName: current.clientName,
            invoiceDate: current.invoiceDate,
            items: current.invoiceItems?.length,
            custom: current.customLineItems?.length,
            previewPreview: documentPreview.slice(0, 240)
        });

        const result = await callGenerateInvoiceFromChat(history, current, documentPreview);
        aiDebug('model invoice', result.invoice);
        aiDebug('assistantMessage', result.assistantMessage);
        aiDebug('name guesses', {
            fromUser: extractClientNameFromUserText(text),
            rename: isExplicitRenameIntent(text)
        });

        const allowClear = userAskedToClearInvoice(text);
        const merged = mergeAiInvoice(current, result.invoice, {
            allowClear,
            userText: text,
            assistantMessage: result.assistantMessage
        });
        aiDebug('merged invoice to apply', merged);
        aiDebug('allowClear', allowClear);

        restoreFromPayload(merged, _currentCloudDocId);
        saveToLocalStorage();
        updatePreview();

        const nameAfter = String(merged.clientName || '').trim();
        if (nameAfter && nameAfter !== nameBefore) {
            flashBilledToHighlight();
        }

        aiDebug('DOM after apply', {
            clientName: document.getElementById('clientName')?.value,
            displayClientName: document.getElementById('displayClientName')?.textContent,
            invoiceItems: invoiceItems.length,
            displayTotal: document.getElementById('displayTotal')?.textContent
        });

        let reply = (result.assistantMessage || 'Updated the invoice.').trim();
        if (!merged.clientName && !merged.invoiceItems?.length && !allowClear) {
            reply = reply || 'No invoice fields were updated. Try naming the client or pasting package details.';
        }

        aiChatBusy = false;
        if (sendBtn) sendBtn.disabled = false;
        renderAiChatMessages();
        await appendAssistantWithTypewriter(reply);
    } catch (err) {
        console.error('[invoice-ai] AI chat error:', err);
        aiDebugWarn('error detail', {
            code: err?.code,
            message: err?.message,
            details: err?.details,
            customData: err?.customData,
            stack: err?.stack
        });
        const msg = friendlyAiChatError(err);
        aiChatMessages.push({ role: 'error', content: msg });
        saveAiChatToStorage();
        aiChatBusy = false;
        if (sendBtn) sendBtn.disabled = false;
        renderAiChatMessages();
    }
}

function setupAiChatUi() {
    const manualBtn = document.getElementById('modeManualBtn');
    const aiBtn = document.getElementById('modeAiBtn');
    const sendBtn = document.getElementById('aiChatSend');
    const clearBtn = document.getElementById('aiChatClear');
    const input = document.getElementById('aiChatInput');

    if (manualBtn) {
        manualBtn.addEventListener('click', () => setEditorMode('manual'));
    }
    if (aiBtn) {
        aiBtn.addEventListener('click', () => setEditorMode('ai'));
    }
    if (sendBtn) {
        sendBtn.addEventListener('click', () => sendAiChatMessage());
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (aiChatBusy) return;
            if (!aiChatMessages.length) {
                clearAiChatHistory();
                return;
            }
            if (!confirm('Clear the chat history? The invoice draft is kept.')) return;
            clearAiChatHistory();
        });
    }
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAiChatMessage();
            }
        });
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
        });
    }

    loadAiChatFromStorage();
    let savedMode = 'manual';
    try {
        savedMode = localStorage.getItem(AI_MODE_STORAGE_KEY) || 'manual';
    } catch {
        savedMode = 'manual';
    }
    setEditorMode(savedMode);
    aiDebug('setup complete', {
        build: INVOICE_AI_DEBUG_BUILD,
        mode: editorMode,
        chatMessages: aiChatMessages.length,
        href: window.location.href
    });
}

// ─── Wire up cloud buttons ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('saveToCloud').addEventListener('click', handleSave);
    document.getElementById('loadFromCloud').addEventListener('click', openLoadModal);
    document.getElementById('closeCloudModal').addEventListener('click', closeLoadModal);

    document.getElementById('invoiceSearchInput').addEventListener('input', function() {
        renderInvoiceCards(filterInvoices(this.value));
    });

    document.getElementById('cloudModal').addEventListener('click', function(e) {
        if (e.target === this) closeLoadModal();
    });
});

function initInvoicePage() {
    const today = new Date();
    const usedDraft = !!PENDING_INVOICE_DRAFT;

    if (PENDING_INVOICE_DRAFT) {
        applyInvoicePreset(PENDING_INVOICE_DRAFT);
    } else {
        const loaded = loadFromLocalStorage();

        if (!loaded) {
            document.getElementById('invoiceDate').valueAsDate = today;

            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            document.getElementById('invoiceNumber').value = 'INV-' + year + '-' + month + day + '-001';

            addDefaultPaymentMilestones();
        }
    }

    setupEventListeners();
    setupPackageListListeners();
    document.getElementById('addPackageBtn').addEventListener('click', addPackage);
    setupAiChatUi();

    if (customLineItems.length > 0) {
        renderCustomLineItems();
    }

    renderInvoiceItems();

    const total = calculateTotal();
    updatePaymentMilestones(total);
    renderPaymentMilestones();
    updatePreview();
    if (usedDraft) saveToLocalStorage();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initInvoicePage);
} else {
    initInvoicePage();
}
