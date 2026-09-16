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
    const { getFirestore, collection, addDoc, getDocs, getDoc, doc, deleteDoc, updateDoc, setDoc, query, orderBy, where } =
        await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');

    _firebaseDb = getFirestore(app);
    _firebaseModules = { collection, addDoc, getDocs, getDoc, doc, deleteDoc, updateDoc, setDoc, query, orderBy, where };
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
    // Collapse legacy cups/numberOfPax/customCups into a single numeric count.
    migrated.count = resolvePackageCount(migrated);
    delete migrated.cups;
    delete migrated.numberOfPax;
    delete migrated.customCups;
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
        clientCompany: document.getElementById('clientCompany')?.value || '',
        clientAddress: document.getElementById('clientAddress').value,
        clientTIN: document.getElementById('clientTIN').value,
        clientEmail: _clientEmail || '',
        notes: document.getElementById('notes').value,
        invoiceDiscount: getInvoiceExtraDiscount(),
        invoiceItems: invoiceItems,
        customLineItems: customLineItems,
        paymentMilestones: paymentMilestones,
        paymentStructure: paymentStructure,
        paymentTermsCustomized: paymentTermsCustomized,
        _cloudDocId: _currentCloudDocId || null,
        _publicToken: _publicToken || null,
        _shareStatus: _shareStatus || 'draft',
        _publishedAt: _publishedAt || null,
        _leadId: _leadId || null
    };
    const payload = JSON.stringify(data);
    try {
        localStorage.setItem('invoiceAppData', payload);
    } catch (err) {
        // Origin quota is shared — huge AI prompt dumps can block invoice saves.
        console.warn('[invoice] localStorage quota; clearing AI chat cache and retrying', err);
        try {
            localStorage.removeItem('invoiceAppAiChat');
            if (Array.isArray(typeof aiChatMessages !== 'undefined' ? aiChatMessages : null)) {
                aiChatMessages.forEach((m) => {
                    if (m && m.promptPreview) delete m.promptPreview;
                });
            }
            localStorage.setItem('invoiceAppData', payload);
        } catch (err2) {
            console.warn('[invoice] localStorage save failed', err2);
        }
    }
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem('invoiceAppData');
    if (!saved) return false;
    
    try {
        const data = JSON.parse(saved);
        
        if (data.invoiceNumber) document.getElementById('invoiceNumber').value = data.invoiceNumber;
        if (data.invoiceDate) document.getElementById('invoiceDate').value = data.invoiceDate;
        if (data.clientName) document.getElementById('clientName').value = data.clientName;
        if (document.getElementById('clientCompany')) {
            document.getElementById('clientCompany').value = data.clientCompany || '';
        }
        if (data.clientAddress) document.getElementById('clientAddress').value = data.clientAddress;
        if (data.clientTIN) document.getElementById('clientTIN').value = data.clientTIN;
        if (data.notes) document.getElementById('notes').value = data.notes;
        if (document.getElementById('invoiceDiscount')) {
            document.getElementById('invoiceDiscount').value =
                data.invoiceDiscount != null && data.invoiceDiscount !== ''
                    ? data.invoiceDiscount
                    : '';
        }
        
        if (data.invoiceItems) {
            invoiceItems = data.invoiceItems.map(item => migrateLoadedPackageItem(item, data));
        }
        if (data.customLineItems) customLineItems = data.customLineItems;
        if (data.paymentMilestones) paymentMilestones = data.paymentMilestones;
        if (data.paymentStructure) paymentStructure = data.paymentStructure;
        if (data.paymentTermsCustomized !== undefined) paymentTermsCustomized = !!data.paymentTermsCustomized;
        normalizePaymentMilestones();
        if (data._cloudDocId) _currentCloudDocId = data._cloudDocId;
        if (data._publicToken) _publicToken = data._publicToken;
        if (data._shareStatus) _shareStatus = data._shareStatus;
        if (data._publishedAt) _publishedAt = data._publishedAt;
        if (data._leadId) _leadId = data._leadId;
        if (data.clientEmail) _clientEmail = String(data.clientEmail).trim();
        
        return true;
    } catch (e) {
        console.error('Error loading from localStorage:', e);
        return false;
    }
}

function clearLocalStorage() {
    if (confirm('Are you sure you want to clear all saved data? This cannot be undone.')) {
        localStorage.removeItem('invoiceAppData');
        location.reload();
    }
}

// Pending draft applied on every load until cleared (set to null after download).
const PENDING_INVOICE_DRAFT = null;

function applyInvoicePreset(data) {
    document.getElementById('invoiceNumber').value = data.invoiceNumber || '';
    document.getElementById('invoiceDate').value = data.invoiceDate || '';
    document.getElementById('clientName').value = data.clientName || '';
    if (document.getElementById('clientCompany')) {
        document.getElementById('clientCompany').value = data.clientCompany || '';
    }
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

function isContaminatedAddress(value) {
    const s = String(value || '');
    if (!s.trim()) return false;
    const trimmed = s.trim();
    return (
        /\b(search|look\s*up|find|google|add\s+it\s+here|and\s+add\s+it)\b/i.test(s) ||
        /^of\s+/i.test(trimmed) ||
        s.length > 80 ||
        /\b(while|whereas|workshop|matcha\s+bar|mobile\s+bar|for\s+the)\b/i.test(s) ||
        /\b(is|are)\s+(?:in|at|on)\b/i.test(s) ||
        /\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
            s
        ) ||
        (trimmed.split(/\s+/).length > 6 && /\b(is|while|for|the)\b/i.test(s))
    );
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
    if (!resolvePackageCount(item)) return [];

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

/** Manual baristas text wins; otherwise suggested staffing from cup count. */
function resolveMobileBarBaristas(item) {
    const manual = String(item?.baristas || '').trim();
    if (manual) return manual;
    return getMobileBarBaristaLabel(resolvePackageCount(item));
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

/**
 * Single source of truth for package headcount (cups or workshop guests).
 * Prefers `count`; falls back to legacy triad then digits in `cups`.
 */
function resolvePackageCount(item) {
    const n = parseInt(item?.count, 10);
    if (n > 0) return n;
    // Legacy: triad was authoritative for pricing in old docs
    if (item?.numberOfPax === 'custom') return parseInt(item.customCups, 10) || 0;
    const nop = parseInt(item?.numberOfPax, 10);
    if (nop > 0) return nop;
    const m = String(item?.cups || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
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

function parsePriceOverride(value) {
    if (value == null || value === '') return null;
    const n = parseFloat(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

function getMobileBarAutoPrice(item) {
    const packageData = packages[item?.packageType];
    const cups = resolvePackageCount(item);
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
            ? `Leave blank for ₱${formatCurrency(auto)}. Enter a lower amount to apply a discount.`
            : 'Leave blank for the standard package rate. Enter a lower amount to apply a discount.';
    }
}

// Invoice items array
let invoiceItems = [];
let paymentMilestones = [];
let invoicePayments = []; // ledger from invoicePaymentProofs (non-authoritative until loaded)
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
        count: 0,
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
    const pax = resolvePackageCount(item);
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
    const cups = resolvePackageCount(item);
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
    item.count = cups;
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
    // Seed suggested staffing only when empty — never overwrite a manual edit.
    if (!String(item.baristas || '').trim()) {
        item.baristas = getMobileBarBaristaLabel(cups);
    }
    const listPrice = getMobileBarAutoPrice(item);
    const charged = resolveMobileBarUnitPrice(item);
    item.listPrice = listPrice;
    item.unitPrice = charged;
    item.packageDiscount =
        parsePriceOverride(item.priceOverride) != null && listPrice > charged
            ? listPrice - charged
            : 0;
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
    const countVal = resolvePackageCount(item) || '';
    const perPaxVal = item.unitCost != null && item.unitCost !== '' ? item.unitCost : '';
    const autoPrice = isWorkshop ? 0 : getMobileBarAutoPrice(item);
    const priceOverrideVal = item.priceOverride != null && item.priceOverride !== '' ? item.priceOverride : '';
    const autoPricePlaceholder = autoPrice > 0 ? String(autoPrice) : 'Standard package rate';
    const autoPriceHint = autoPrice > 0
        ? `Leave blank for ₱${formatCurrency(autoPrice)}. Enter a lower amount to apply a discount.`
        : 'Leave blank for the standard package rate. Enter a lower amount to apply a discount.';
    const baristaSuggested = getMobileBarBaristaLabel(resolvePackageCount(item) || 0);
    const baristaVal = String(item.baristas || '').trim() || baristaSuggested;

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
                    <input type="number" class="pkg-count" data-id="${item.id}" min="100" step="1" placeholder="e.g., 100" value="${escapeHtml(String(countVal))}">
                </div>
                <div class="form-group">
                    <label>Hours of Service</label>
                    <input type="number" class="pkg-duration-hours" data-id="${item.id}" min="1" max="24" step="1" value="${escapeHtml(String(item.durationHours != null && item.durationHours !== '' ? item.durationHours : 3))}">
                </div>
                <div class="form-group">
                    <label>On-Site Baristas</label>
                    <input type="text" class="pkg-baristas" data-id="${item.id}"
                        placeholder="${escapeHtml(baristaSuggested)}"
                        value="${escapeHtml(baristaVal)}">
                    <p class="form-hint">Edit freely. Clear the field to re-apply the suggested staffing for the current cup count.</p>
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
                    <input type="number" class="pkg-count" data-id="${item.id}" min="1" step="1" placeholder="e.g., 10" value="${escapeHtml(String(countVal))}">
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
        } else if (el.classList.contains('pkg-count')) {
            const prevAuto = getMobileBarBaristaLabel(resolvePackageCount(item));
            const curBaristas = String(item.baristas || '').trim();
            const wasAutoBaristas = !curBaristas || curBaristas === prevAuto;
            item.count = parseInt(el.value, 10) || 0;
            syncPackageItem(item);
            if (wasAutoBaristas && !isWorkshopItem(item)) {
                item.baristas = getMobileBarBaristaLabel(resolvePackageCount(item));
                const baristaInput = document.querySelector(`.pkg-baristas[data-id="${item.id}"]`);
                if (baristaInput) {
                    baristaInput.value = item.baristas || '';
                    baristaInput.placeholder = item.baristas || '';
                }
            }
        } else if (el.classList.contains('pkg-per-pax-cost')) {
            item.unitCost = el.value;
            syncWorkshopItem(item);
        } else if (el.classList.contains('pkg-workshop-details')) {
            item.workshopDetails = el.value;
        } else if (el.classList.contains('pkg-workshop-inclusions')) {
            item.workshopInclusions = textareaToInclusions(el.value);
        } else if (el.classList.contains('pkg-price-override')) {
            item.priceOverride = el.value;
            syncMobileItem(item);
        } else if (el.classList.contains('pkg-baristas')) {
            item.baristas = el.value;
            // Empty → next sync seeds the suggested label for current cups
            if (!String(el.value || '').trim() && !isWorkshopItem(item)) {
                syncMobileItem(item);
                el.value = item.baristas || '';
            }
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

// Rebuild defaults for the current structure; payments stay in the ledger.
function rebuildDefaultMilestonesPreservingPaid() {
    const prevByRole = {};
    paymentMilestones.forEach(m => {
        if (m.role) prevByRole[m.role] = m;
    });
    const fresh = buildDefaultMilestones(paymentStructure);
    fresh.forEach(m => {
        const prev = prevByRole[m.role];
        if (prev) {
            m.id = prev.id;
            m.date = prev.date || '';
        }
    });
    paymentMilestones = fresh;
    reallocateInvoicePaymentsOntoSchedule();
}

function allocApi() {
    return window.InvoicePaymentAlloc || {};
}

function reallocateInvoicePaymentsOntoSchedule() {
    const api = allocApi();
    if (!api.reallocateAllPayments) return;
    invoicePayments = api.reallocateAllPayments(paymentMilestones, invoicePayments);
    softSyncMilestonesFromLedger();
    persistPaymentAllocations().catch((err) => {
        console.warn('Could not persist payment allocations', err);
    });
}

function softSyncMilestonesFromLedger() {
    const api = allocApi();
    if (!api.scheduleMilestones || !api.enrichMilestonesWithPayments) return;
    // Drop legacy split remainder rows
    paymentMilestones = paymentMilestones.filter((m) => m && !m.splitFromId);
    const enriched = api.enrichMilestonesWithPayments(paymentMilestones, invoicePayments);
    const byId = new Map(enriched.map((m) => [String(m.id), m]));
    paymentMilestones = paymentMilestones
        .filter((m) => String(m.milestone || '').trim() && (Number(m.percentage) > 0 || Number(m.amount) > 0))
        .map((m) => {
            const d = byId.get(String(m.id));
            return {
                ...m,
                paid: d ? !!d.paid : !!m.paid,
                paymentStatus: null,
                proofId: null,
                screenshotUrl: null,
                paymentReference: null,
                paymentMethod: null,
                splitFromId: null,
                originalAmount: null,
                received: d ? d.received : 0,
                remaining: d ? d.remaining : Number(m.amount) || 0
            };
        });
}

function milestoneCoverageNote(milestone) {
    const api = allocApi();
    const d = api.deriveMilestonePaymentFields
        ? api.deriveMilestonePaymentFields(milestone, invoicePayments)
        : null;
    if (!d || !(d.received > 0 || d.remaining >= 0)) return '';
    if (!(d.received > 0) && !(Number(milestone.amount) > 0)) return '';
    const received = Number(d.received) || 0;
    const remaining = Number(d.remaining) || 0;
    const paid = remaining <= 0.009 && received > 0;
    const stateClass = paid
        ? ' is-settled'
        : received > 0
            ? ' is-partial'
            : ' is-unpaid';
    return `
        <div class="milestone-coverage${stateClass}">
            <div class="milestone-coverage-stat is-received">
                <span class="milestone-coverage-label">Received</span>
                <span class="milestone-coverage-value">₱${formatCurrency(received)}</span>
            </div>
            <div class="milestone-coverage-stat is-remaining">
                <span class="milestone-coverage-label">${paid ? 'Remaining' : 'Still due'}</span>
                <span class="milestone-coverage-value">₱${formatCurrency(remaining)}</span>
            </div>
        </div>
    `;
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
    const sid = String(milestoneId ?? '');
    paymentMilestones = paymentMilestones.filter((m) => String(m.id) !== sid);
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
    const api = allocApi();

    paymentMilestones.forEach((milestone, index) => {
        const derived = api.deriveMilestonePaymentFields
            ? api.deriveMilestonePaymentFields(milestone, invoicePayments)
            : null;
        const paid = derived ? !!derived.paid : !!milestone.paid;
        const milestoneDiv = document.createElement('div');
        milestoneDiv.className = 'payment-milestone' + (paid ? ' is-paid' : '') + (editable ? '' : ' is-compact');

        if (!editable) {
            const amountVal = milestone.amount > 0
                ? `Php ${formatCurrency(milestone.amount)}`
                : '—';
            const dateVal = milestone.date ? formatDate(milestone.date) : '';
            const pctVal = milestone.percentage > 0 ? `${milestone.percentage}%` : '';
            const metaParts = [];
            if (dateVal) {
                metaParts.push(`<span class="milestone-compact-date">${escapeHtml(dateVal)}</span>`);
            }
            if (pctVal) {
                metaParts.push(`<span class="milestone-compact-pct">${escapeHtml(pctVal)}</span>`);
            }
            milestoneDiv.innerHTML = `
                <div class="milestone-compact-top">
                    <div class="milestone-compact-title">
                        <div class="milestone-compact-name">${escapeHtml(milestone.milestone || `Milestone ${index + 1}`)}</div>
                        ${metaParts.length ? `<div class="milestone-compact-meta">${metaParts.join('')}</div>` : ''}
                    </div>
                    <div class="milestone-compact-amount">${amountVal}</div>
                </div>
                ${milestoneCoverageNote(milestone)}
            `;
        } else {
            const amountLock = 'readonly disabled';
            const amountVal = milestone.amount > 0 ? milestone.amount.toFixed(2) : '';
            milestoneDiv.innerHTML = `
                <div class="payment-milestone-header">
                    <h3>Milestone ${index + 1}</h3>
                    <button type="button" class="remove-milestone-btn" data-id="${milestone.id}">Remove</button>
                </div>
                <div class="item-row">
                    <div>
                        <label>Milestone Name:</label>
                        <input type="text" class="milestone-name" data-id="${milestone.id}"
                            placeholder="e.g., Date Reservation" value="${escapeHtml(milestone.milestone)}">
                    </div>
                    <div>
                        <label>Date:</label>
                        <input type="date" class="milestone-date" data-id="${milestone.id}" value="${milestone.date}">
                    </div>
                </div>
                <div class="item-row">
                    <div>
                        <label>Percentage (%):</label>
                        <input type="number" class="milestone-percentage" data-id="${milestone.id}"
                            min="0" max="100" step="0.01" value="${milestone.percentage}">
                    </div>
                    <div>
                        <label>Amount (₱):</label>
                        <input type="number" class="milestone-amount" data-id="${milestone.id}"
                            min="0" step="0.01" value="${amountVal}" ${amountLock}>
                    </div>
                </div>
                ${milestoneCoverageNote(milestone)}
            `;
        }
        container.appendChild(milestoneDiv);
    });

    // Show the "Add Payment Milestone" button only while customizing
    const addBtn = document.getElementById('addMilestoneBtn');
    if (addBtn) addBtn.style.display = editable ? '' : 'none';

    setupPaymentMilestoneListeners();
    renderInvoicePaymentsList();
}

async function loadInvoicePaymentsForDoc(invoiceId) {
    const id = String(invoiceId || '').trim();
    if (!id) {
        invoicePayments = [];
        return [];
    }
    const db = await getFirebaseDb();
    const { collection, getDocs, query, where } = _firebaseModules;
    const q = query(collection(db, 'invoicePaymentProofs'), where('invoiceId', '==', id));
    const snap = await getDocs(q);
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    invoicePayments = rows;
    return rows;
}

async function persistPaymentAllocations() {
    if (!_currentCloudDocId) return;
    const db = await getFirebaseDb();
    const { doc, updateDoc, setDoc, collection } = _firebaseModules;
    for (const p of invoicePayments) {
        if (!p?.id) continue;
        if (p._needsPersist || String(p.id).startsWith('promoted_')) {
            const payload = { ...p };
            delete payload._needsPersist;
            delete payload.id;
            payload.invoiceId = String(_currentCloudDocId);
            payload.source = payload.source || 'repair_promote';
            const newDoc = doc(collection(db, 'invoicePaymentProofs'));
            await setDoc(newDoc, {
                ...payload,
                createdAt: payload.createdAt || new Date().toISOString()
            });
            p.id = newDoc.id;
            p._needsPersist = false;
            continue;
        }
        await updateDoc(doc(db, 'invoicePaymentProofs', String(p.id)), {
            allocations: Array.isArray(p.allocations) ? p.allocations : []
        });
    }
}

async function voidProofRecord(proofId) {
    const id = String(proofId || '').trim();
    if (!id) return;
    const db = await getFirebaseDb();
    const { doc, updateDoc } = _firebaseModules;
    await updateDoc(doc(db, 'invoicePaymentProofs', id), {
        status: 'voided',
        voidedAt: new Date().toISOString(),
        voidedSource: 'staff_editor'
    });
    const row = invoicePayments.find((p) => String(p.id) === id);
    if (row) row.status = 'voided';
    softSyncMilestonesFromLedger();
}

async function addStaffManualPayment({ amount, paymentMethod, referenceNumber, paidAt } = {}) {
    if (!_currentCloudDocId) {
        throw new Error('Save the invoice before adding a payment');
    }
    const api = allocApi();
    const confirmedAmount = roundMoneyLocal(amount);
    if (!(confirmedAmount > 0)) {
        throw new Error('Enter a payment amount greater than 0');
    }
    const remainingOnSchedule = api.totalRemainingOnSchedule
        ? api.totalRemainingOnSchedule(paymentMilestones, invoicePayments)
        : 0;
    if (!(remainingOnSchedule > 0.5)) {
        throw new Error('This invoice has no remaining balance on the schedule');
    }
    if (confirmedAmount > remainingOnSchedule + 0.5) {
        throw new Error(
            `Amount exceeds remaining schedule balance (₱${formatCurrency(remainingOnSchedule)})`
        );
    }

    const method = String(paymentMethod || 'other').trim().toLowerCase() || 'other';
    const reference = String(referenceNumber || '').trim();
    const paidDate = paidAt || formatDateToLocal(new Date());
    const allocations = api.allocatePaymentWaterfall
        ? api.allocatePaymentWaterfall(paymentMilestones, confirmedAmount, invoicePayments)
        : [];
    if (!allocations.length) {
        throw new Error('No unpaid milestone to allocate this payment to');
    }

    const payload = {
        invoiceId: String(_currentCloudDocId),
        publicToken: _publicToken || null,
        milestoneId: allocations[0]?.milestoneId ?? null,
        milestoneName: allocations[0]?.milestoneName || '',
        amount: confirmedAmount,
        paymentMethod: method,
        referenceNumber: reference,
        paidAt: paidDate,
        senderName: '',
        screenshotUrl: null,
        storagePath: null,
        status: 'confirmed',
        source: 'staff_manual',
        allocations,
        createdAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        confirmedSource: 'staff_editor'
    };

    const db = await getFirebaseDb();
    const { collection, addDoc } = _firebaseModules;
    const ref = await addDoc(collection(db, 'invoicePaymentProofs'), payload);
    const payment = { id: ref.id, ...payload };
    invoicePayments = [...invoicePayments, payment];
    softSyncMilestonesFromLedger();
    return payment;
}

async function confirmProofRecord(proofId) {
    const id = String(proofId || '').trim();
    if (!id) return;
    const db = await getFirebaseDb();
    const { doc, updateDoc } = _firebaseModules;
    await updateDoc(doc(db, 'invoicePaymentProofs', id), {
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        confirmedSource: 'staff_editor'
    });
    const row = invoicePayments.find((p) => String(p.id) === id);
    if (row) row.status = 'confirmed';
    softSyncMilestonesFromLedger();
}

function findMilestoneById(id) {
    return paymentMilestones.find((m) => String(m.id) === String(id));
}

function findPaymentById(id) {
    return invoicePayments.find((p) => String(p.id) === String(id));
}

function openPaymentScreenshot(url) {
    if (!url) return;
    const overlay = document.getElementById('proofImageModal') || document.getElementById('qrModal');
    const img = document.getElementById('proofImageModalImg') || document.getElementById('qrModalImage');
    const title = document.getElementById('proofImageModalTitle') || document.getElementById('qrModalTitle');
    if (img) {
        img.src = url;
        img.alt = 'Payment screenshot';
    }
    if (title) title.textContent = 'Payment screenshot';
    if (overlay) {
        overlay.hidden = false;
        overlay.classList.add('is-open');
    } else {
        window.open(url, '_blank', 'noopener');
    }
}

function renderInvoicePaymentsList() {
    const container = document.getElementById('invoicePaymentsList');
    if (!container) return;
    const api = allocApi();
    const active = api.activePayments
        ? api.activePayments(invoicePayments)
        : invoicePayments.filter((p) => p && p.status !== 'voided');

    if (!active.length) {
        container.innerHTML = '<p class="invoice-payments-empty">No payments recorded yet.</p>';
        return;
    }

    container.innerHTML = active
        .map((p) => {
            const statusLabel = p.status === 'confirmed' ? 'Payment confirmed' : 'Payment sent';
            const statusClass = p.status === 'confirmed' ? '' : 'is-sent';
            const allocs = (Array.isArray(p.allocations) ? p.allocations : [])
                .map((a) => `${escapeHtml(a.milestoneName || 'Milestone')} ₱${formatCurrency(a.amount)}`)
                .join(' · ');
            const method = String(p.paymentMethod || '').toUpperCase();
            const ref = p.referenceNumber ? `Ref: ${escapeHtml(p.referenceNumber)}` : '';
            const paidAt = p.paidAt ? escapeHtml(p.paidAt) : '';
            return `<div class="invoice-payment-row" data-payment-id="${escapeHtml(String(p.id))}">
        ${
          p.screenshotUrl
            ? `<button type="button" class="invoice-payment-thumb invoice-payment-view-btn" data-url="${escapeHtml(p.screenshotUrl)}" title="View payment screenshot">
                <img src="${escapeHtml(p.screenshotUrl)}" alt="Payment screenshot">
              </button>`
            : `<div class="invoice-payment-thumb-empty">No image</div>`
        }
        <div class="invoice-payment-meta">
          <div class="invoice-payment-amount">₱${formatCurrency(p.amount)}</div>
          <div class="invoice-payment-status ${statusClass}">${escapeHtml(statusLabel)}</div>
          <div>${[method, ref, paidAt].filter(Boolean).join(' · ')}</div>
          ${allocs ? `<div class="invoice-payment-allocs">${allocs}</div>` : ''}
        </div>
        <div class="invoice-payment-actions">
          ${
            p.screenshotUrl
              ? `<button type="button" class="inv-btn inv-btn-secondary invoice-payment-view-btn" data-url="${escapeHtml(p.screenshotUrl)}">View</button>`
              : ''
          }
          ${
            p.status === 'sent'
              ? `<button type="button" class="inv-btn inv-btn-secondary invoice-payment-confirm-btn" data-id="${escapeHtml(String(p.id))}">Confirm</button>`
              : ''
          }
          <button type="button" class="inv-btn inv-btn-secondary invoice-payment-remove-btn" data-id="${escapeHtml(String(p.id))}">Remove</button>
        </div>
      </div>`;
        })
        .join('');

    if (!container._paymentsListenersReady) {
        container._paymentsListenersReady = true;
        container.addEventListener('click', (e) => {
            const viewBtn = e.target.closest('.invoice-payment-view-btn');
            if (viewBtn) {
                e.preventDefault();
                openPaymentScreenshot(viewBtn.dataset.url);
                return;
            }
            const confirmBtn = e.target.closest('.invoice-payment-confirm-btn');
            if (confirmBtn) {
                e.preventDefault();
                confirmProofRecord(confirmBtn.dataset.id)
                    .then(() => {
                        renderPaymentMilestones();
                        updatePreview();
                        scheduleCloudAutosave();
                    })
                    .catch((err) => console.warn('Could not confirm payment', err));
                return;
            }
            const removeBtn = e.target.closest('.invoice-payment-remove-btn');
            if (removeBtn) {
                e.preventDefault();
                voidProofRecord(removeBtn.dataset.id)
                    .then(() => {
                        reallocateInvoicePaymentsOntoSchedule();
                        renderPaymentMilestones();
                        updatePreview();
                        scheduleCloudAutosave();
                    })
                    .catch((err) => console.warn('Could not void payment', err));
            }
        });
    }
}

function setManualPaymentError(message) {
    const el = document.getElementById('manualPaymentError');
    if (!el) return;
    if (!message) {
        el.textContent = '';
        el.hidden = true;
        el.classList.add('is-hidden');
        return;
    }
    el.textContent = message;
    el.hidden = false;
    el.classList.remove('is-hidden');
}

function getCurrentDueAmount() {
    const api = allocApi();
    if (api.enrichMilestonesWithPayments) {
        const enriched = api.enrichMilestonesWithPayments(paymentMilestones, invoicePayments);
        const nextDue = enriched.find((m) => roundMoneyLocal(m.remaining) > 0.5);
        if (nextDue) return roundMoneyLocal(nextDue.remaining);
    }
    if (api.totalRemainingOnSchedule) {
        return roundMoneyLocal(api.totalRemainingOnSchedule(paymentMilestones, invoicePayments));
    }
    return 0;
}

function openManualPaymentModal() {
    const overlay = document.getElementById('manualPaymentModal');
    if (!overlay) return;
    setManualPaymentError('');
    const dateInput = document.getElementById('manualPaymentDate');
    if (dateInput) dateInput.value = formatDateToLocal(new Date());
    const amountEl = document.getElementById('manualPaymentAmount');
    if (amountEl) {
        const due = getCurrentDueAmount();
        amountEl.value = due > 0 ? due.toFixed(2) : '';
    }
    const refEl = document.getElementById('manualPaymentReference');
    if (refEl) refEl.value = '';
    const methodEl = document.getElementById('manualPaymentMethod');
    if (methodEl) methodEl.value = 'bank';
    overlay.hidden = false;
    overlay.classList.remove('is-hidden');
    amountEl?.focus();
    amountEl?.select();
}

function closeManualPaymentModal() {
    const overlay = document.getElementById('manualPaymentModal');
    if (!overlay) return;
    overlay.hidden = true;
    overlay.classList.add('is-hidden');
    setManualPaymentError('');
}

function setupStaffManualPaymentForm() {
    const form = document.getElementById('staffManualPaymentForm');
    const openBtn = document.getElementById('openManualPaymentBtn');
    if (!form || form._manualPaymentReady) return;
    form._manualPaymentReady = true;

    openBtn?.addEventListener('click', () => {
        if (!_currentCloudDocId) {
            alert('Save the invoice before adding a payment');
            return;
        }
        openManualPaymentModal();
    });

    document.getElementById('manualPaymentModalClose')?.addEventListener('click', closeManualPaymentModal);
    document.getElementById('manualPaymentCancel')?.addEventListener('click', closeManualPaymentModal);
    document.getElementById('manualPaymentModal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeManualPaymentModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const overlay = document.getElementById('manualPaymentModal');
        if (overlay && !overlay.hidden) closeManualPaymentModal();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setManualPaymentError('');
        const amountEl = document.getElementById('manualPaymentAmount');
        const methodEl = document.getElementById('manualPaymentMethod');
        const refEl = document.getElementById('manualPaymentReference');
        const paidAtEl = document.getElementById('manualPaymentDate');
        const submitBtn = document.getElementById('manualPaymentSubmit');
        const amount = parseFloat(amountEl?.value);
        if (submitBtn) submitBtn.disabled = true;
        try {
            await addStaffManualPayment({
                amount,
                paymentMethod: methodEl?.value || 'other',
                referenceNumber: refEl?.value || '',
                paidAt: paidAtEl?.value || formatDateToLocal(new Date())
            });
            closeManualPaymentModal();
            renderPaymentMilestones();
            updatePreview();
            saveToLocalStorage();
            scheduleCloudAutosave();
        } catch (err) {
            console.warn('Could not add manual payment', err);
            setManualPaymentError(err.message || 'Could not add payment');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}

/**
 * Repair lumped Final + embedded screenshots into ledger + true % schedule.
 */
async function repairBrokenPaymentLedgerIfNeeded() {
    const hasSplit = paymentMilestones.some((m) => m && m.splitFromId);
    const hasEmbedded = paymentMilestones.some(
        (m) => m && (m.screenshotUrl || m.proofId) && !m.splitFromId
    );
    const total = calculateTotal();
    let looksLumped = false;
    if (paymentStructure === 'two' && paymentMilestones.length >= 2 && total > 0) {
        const final = paymentMilestones.find((m) => m.role === 'final') || paymentMilestones[paymentMilestones.length - 1];
        const expected = total * 0.5;
        if (final && Number(final.amount) > expected * 1.15) looksLumped = true;
    }
    if (!hasSplit && !hasEmbedded && !looksLumped) {
        const needsAlloc = invoicePayments.some(
            (p) =>
                p &&
                p.status !== 'voided' &&
                (!(Number(p.amount) > 0) ||
                    !Array.isArray(p.allocations) ||
                    !p.allocations.length)
        );
        if (needsAlloc && invoicePayments.some((p) => p && p.status !== 'voided' && Number(p.amount) > 0)) {
            reallocateInvoicePaymentsOntoSchedule();
            await persistPaymentAllocations();
            return true;
        }
        softSyncMilestonesFromLedger();
        return false;
    }

    // Promote embedded screenshots missing from ledger
    for (const m of paymentMilestones) {
        if (!m?.screenshotUrl) continue;
        const already = invoicePayments.some(
            (p) =>
                (m.proofId && String(p.id) === String(m.proofId)) ||
                p.screenshotUrl === m.screenshotUrl
        );
        if (already) continue;
        invoicePayments.push({
            id: `promoted_${m.id || Date.now()}`,
            amount: Number(m.amount) || 0,
            paymentMethod: m.paymentMethod || 'other',
            referenceNumber: m.paymentReference || '',
            paidAt: m.date || '',
            senderName: '',
            screenshotUrl: m.screenshotUrl,
            status: m.paymentStatus === 'confirmed' ? 'confirmed' : 'sent',
            allocations: [],
            createdAt: new Date().toISOString(),
            source: 'repair_promote',
            _needsPersist: true
        });
    }

    // Restore schedule amounts from structure percentages
    const prevByRole = {};
    paymentMilestones.forEach((m) => {
        if (m?.role) prevByRole[m.role] = m;
    });
    const fresh = buildDefaultMilestones(paymentStructure);
    fresh.forEach((m) => {
        const prev = prevByRole[m.role];
        if (prev) {
            m.id = prev.id;
            m.date = prev.date || '';
        }
        m.amount = total * ((Number(m.percentage) || 0) / 100);
    });
    paymentMilestones = fresh;
    reallocateInvoicePaymentsOntoSchedule();
    await persistPaymentAllocations();
    return true;
}

function findPaymentMilestoneByDomId(rawId) {
    const sid = String(rawId ?? '').trim();
    if (!sid) return null;
    return paymentMilestones.find((m) => String(m.id) === sid) || null;
}

// Delegated listeners for the milestone form (attached once)
function setupPaymentMilestoneListeners() {
    const container = document.getElementById('paymentMilestones');
    if (!container || container._milestoneListenersReady) return;
    container._milestoneListenersReady = true;

    const handleFieldChange = (el) => {
        if (!el || !el.classList) return;
        const milestone = findPaymentMilestoneByDomId(el.dataset.id);
        if (!milestone) return;

        let needsAmountRecalc = false;
        if (el.classList.contains('milestone-name')) {
            milestone.milestone = el.value;
        } else if (el.classList.contains('milestone-date')) {
            milestone.date = el.value;
        } else if (el.classList.contains('milestone-percentage')) {
            milestone.percentage = parseFloat(el.value) || 0;
            needsAmountRecalc = true;
        } else if (el.classList.contains('milestone-amount')) {
            milestone.amount = parseFloat(el.value) || 0;
            const total = calculateTotal();
            if (total > 0) {
                milestone.percentage = Math.round(((Number(milestone.amount) || 0) / total) * 10000) / 100;
            }
            needsAmountRecalc = false;
        } else {
            return;
        }

        if (needsAmountRecalc) {
            recalcMilestoneAmounts(calculateTotal());
        }

        // Percentage/amount changes must refresh Amount + Still due (not only the live preview).
        if (
            el.classList.contains('milestone-percentage') ||
            el.classList.contains('milestone-amount')
        ) {
            const focusId = String(el.dataset.id || '');
            const focusClass = el.classList.contains('milestone-percentage')
                ? 'milestone-percentage'
                : 'milestone-amount';
            const selStart = el.selectionStart;
            const selEnd = el.selectionEnd;
            renderPaymentMilestones();
            const again = document.querySelector(
                `#paymentMilestones input.${focusClass}[data-id="${CSS.escape(focusId)}"]`
            );
            if (again) {
                again.focus();
                if (typeof selStart === 'number' && typeof again.setSelectionRange === 'function') {
                    try {
                        again.setSelectionRange(selStart, selEnd);
                    } catch (_) {
                        /* ignore */
                    }
                }
            }
        }

        updatePreview();
        saveToLocalStorage();
    };

    container.addEventListener('input', (e) => handleFieldChange(e.target));

    container.addEventListener('change', (e) => {
        handleFieldChange(e.target);
    });

    container.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-milestone-btn');
        if (removeBtn) {
            removePaymentMilestone(removeBtn.dataset.id);
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
    return Math.max(0, packageTotal + customTotal - getInvoiceExtraDiscount());
}

function getInvoiceExtraDiscount() {
    const el = document.getElementById('invoiceDiscount');
    if (!el) return 0;
    const n = parseFloat(el.value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function getPackageDiscountTotal() {
    return invoiceItems.reduce((sum, item) => {
        if (isWorkshopItem(item)) return sum;
        const list =
            item.listPrice != null && item.listPrice !== ''
                ? parseFloat(item.listPrice)
                : getMobileBarAutoPrice(item);
        const charged = getInvoiceItemPricing(item).subtotal;
        if (!Number.isFinite(list) || list <= 0) return sum;
        return sum + Math.max(0, list - charged);
    }, 0);
}

/** Subtotal / discount / total for customer page + save payload. */
function calculatePricingBreakdown() {
    const packageDiscount = getPackageDiscountTotal();
    const extraDiscount = getInvoiceExtraDiscount();
    const amountDiscount = packageDiscount + extraDiscount;
    const amountTotal = calculateTotal();
    const amountSubtotal = amountTotal + amountDiscount;
    return {
        amountSubtotal,
        amountDiscount,
        packageDiscount,
        extraDiscount,
        amountTotal
    };
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
    {
        const baristaLine = resolveMobileBarBaristas(item);
        if (baristaLine) allInclusions.push(baristaLine);
    }
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

// Update live customer-page preview (not an A4 document)
function buildEditorInvoiceDoc() {
    const pricing = calculatePricingBreakdown();
    const total = pricing.amountTotal;
    const eventDate = getInvoiceEventDate();
    const milestoneDates = calculateMilestoneDates(eventDate);
    if (!paymentTermsCustomized) {
        applyDefaultPaymentLogic(milestoneDates);
    }
    recalcMilestoneAmounts(total);
    syncMilestoneFormInputs();

    const summary = window.InvoicePageRender
        ? window.InvoicePageRender.computeSummary({
            totalAmount: total,
            amountTotal: total,
            amountSubtotal: pricing.amountSubtotal,
            amountDiscount: pricing.amountDiscount,
            paymentMilestones: paymentMilestones,
            amountPaid: allocApi().totalReceivedFromPayments
                ? allocApi().totalReceivedFromPayments(invoicePayments)
                : undefined,
            payments: invoicePayments
        })
        : null;

    const api = allocApi();
    const scheduleRows = api.buildScheduleDisplayRows
        ? api.buildScheduleDisplayRows(paymentMilestones, invoicePayments)
        : [];
    const amountPaid = api.totalReceivedFromPayments
        ? api.totalReceivedFromPayments(invoicePayments)
        : summary?.amountPaid;

    return {
        invoiceNumber: document.getElementById('invoiceNumber')?.value || '',
        invoiceDate: document.getElementById('invoiceDate')?.value || '',
        eventDate,
        clientName: document.getElementById('clientName')?.value || '',
        clientCompany: document.getElementById('clientCompany')?.value || '',
        clientAddress: document.getElementById('clientAddress')?.value || '',
        clientTIN: document.getElementById('clientTIN')?.value || '',
        notes: document.getElementById('notes')?.value || '',
        invoiceItems: invoiceItems,
        customLineItems: customLineItems,
        paymentMilestones: paymentMilestones,
        paymentScheduleRows: scheduleRows,
        payments: (api.activePayments ? api.activePayments(invoicePayments) : invoicePayments).filter(
            (p) => p && p.status !== 'voided'
        ),
        paymentStructure,
        invoiceDiscount: getInvoiceExtraDiscount(),
        totalAmount: total,
        amountTotal: total,
        amountSubtotal: pricing.amountSubtotal,
        amountDiscount: pricing.amountDiscount,
        amountPaid: amountPaid != null ? amountPaid : summary?.amountPaid,
        amountRemaining:
            amountPaid != null
                ? Math.max(0, total - amountPaid)
                : summary?.amountRemaining,
        amountDueNow: summary?.amountDueNow,
        dueLabel: summary?.dueLabel,
        paymentStatus: summary?.paymentStatus
    };
}

function refreshLivePreview() {
    const root = document.getElementById('livePreview');
    if (!root || !window.InvoicePageRender) return;
    window.InvoicePageRender.renderInvoicePage(root, buildEditorInvoiceDoc(), { compact: true });
}

function updatePreview() {
    refreshLivePreview();
    saveToLocalStorage();
    scheduleCloudAutosave();
}

function renderPreviewMilestones() {
    // Preview milestones are rendered by InvoicePageRender in refreshLivePreview.
}

function updatePaymentMilestones(total) {
    const eventDate = getInvoiceEventDate();
    const milestoneDates = calculateMilestoneDates(eventDate);
    if (!paymentTermsCustomized) {
        applyDefaultPaymentLogic(milestoneDates);
    }
    recalcMilestoneAmounts(total);
    syncMilestoneFormInputs();
    refreshLivePreview();
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

// Recalculate each milestone's scheduled amount from % of invoice total.
// Payments stay in the ledger and are re-allocated after recalc.
function recalcMilestoneAmounts(total) {
    const pctSum = paymentMilestones.reduce((s, m) => {
        if (m.splitFromId) return s;
        return s + (Number(m.percentage) || 0);
    }, 0);

    paymentMilestones.forEach((m) => {
        if (m.splitFromId) return;
        if (!(Number(m.percentage) > 0)) {
            if (!(Number(m.amount) > 0)) m.amount = 0;
            return;
        }
        m.amount = pctSum > 0 ? total * ((Number(m.percentage) || 0) / pctSum) : 0;
    });
    // Drop legacy split rows after restoring schedule
    paymentMilestones = paymentMilestones.filter((m) => !m.splitFromId);
    if (invoicePayments.length) {
        reallocateInvoicePaymentsOntoSchedule();
    } else {
        softSyncMilestonesFromLedger();
    }
}

function roundMoneyLocal(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * 100) / 100;
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

// Setup event listeners
function setupPreviewPayUi() {
    const preview = document.getElementById('livePreview');
    const qrOverlay = document.getElementById('qrModal');
    const qrClose = document.getElementById('qrModalClose');
    const qrImg = document.getElementById('qrModalImage');
    const qrTitle = document.getElementById('qrModalTitle');
    if (!preview || preview.dataset.payBound === '1') return;
    preview.dataset.payBound = '1';

    const openQr = (label, src) => {
        if (!qrOverlay || !qrImg || !src) return;
        qrImg.src = src;
        qrImg.alt = `${label} payment QR code`;
        if (qrTitle) qrTitle.textContent = `${label} QR`;
        qrOverlay.classList.remove('is-hidden');
        qrOverlay.hidden = false;
        document.body.classList.add('inv-modal-open');
    };
    const closeQr = () => {
        if (!qrOverlay) return;
        qrOverlay.classList.add('is-hidden');
        qrOverlay.hidden = true;
        if (qrImg) qrImg.removeAttribute('src');
        document.body.classList.remove('inv-modal-open');
    };

    preview.addEventListener('click', async (e) => {
        const copyBtn = e.target.closest('[data-copy]');
        if (copyBtn) {
            e.preventDefault();
            const text = copyBtn.getAttribute('data-copy') || '';
            try {
                await navigator.clipboard.writeText(text);
            } catch (_) { /* ignore */ }
            copyBtn.classList.add('is-copied');
            setTimeout(() => copyBtn.classList.remove('is-copied'), 1200);
            return;
        }
        const qrBtn = e.target.closest('[data-qr-src]');
        if (qrBtn) {
            e.preventDefault();
            openQr(qrBtn.getAttribute('data-qr-label') || 'QR', qrBtn.getAttribute('data-qr-src') || '');
        }
    });
    qrClose?.addEventListener('click', closeQr);
    qrOverlay?.addEventListener('click', (e) => {
        if (e.target === qrOverlay) closeQr();
    });
}

function setupEventListeners() {
    setupPreviewPayUi();
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
        'clientName', 'clientCompany', 'clientAddress', 'clientTIN',
        'notes', 'invoiceDiscount'
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
    
    // Invoice date change should recalculate payment milestone dates.
    // Invoice number is fixed once assigned — do not retie it to the date.
    document.getElementById('invoiceDate').addEventListener('change', async function() {
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
    document.getElementById('clearForm')?.addEventListener('click', function() {
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
    const downloadBtn = document.getElementById('downloadPDF');
    if (!downloadBtn || !window.InvoicePdfLegacy) return;

    const originalText = downloadBtn.textContent;
    downloadBtn.textContent = 'Generating…';
    downloadBtn.disabled = true;

    try {
        const doc = buildEditorInvoiceDoc();
        await window.InvoicePdfLegacy.downloadLegacyInvoicePdf(doc, {
            captureRoot: document.getElementById('pdfCaptureRoot')
        });
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Error generating PDF. Please try again.');
    } finally {
        downloadBtn.textContent = originalText;
        downloadBtn.disabled = false;
    }
}

// Clear form
async function clearForm() {
    if (!confirm('Are you sure you want to clear all form data? This cannot be undone.')) {
        return;
    }

    await withCloudAutosaveSuppressedAsync(async () => {
    // Reset invoice details
    const today = new Date();
    document.getElementById('invoiceDate').valueAsDate = today;
    await ensureCloudInvoiceListLoaded({ force: true });
    document.getElementById('invoiceNumber').value = nextInvoiceNumberForDate(today);

    // Clear client details
    document.getElementById('clientName').value = '';
    if (document.getElementById('clientCompany')) document.getElementById('clientCompany').value = '';
    document.getElementById('clientAddress').value = '';
    document.getElementById('clientTIN').value = '';
    if (document.getElementById('invoiceDiscount')) document.getElementById('invoiceDiscount').value = '';

    invoiceItems = [];
    customLineItems = [];

    // Reset payment milestones
    paymentMilestones = [];
    invoicePayments = [];
    addDefaultPaymentMilestones();

    // Update preview
    renderInvoiceItems();
    renderCustomLineItems();
    updatePreview();
    saveToLocalStorage();

    // Starting fresh — no longer linked to a saved cloud record
    _currentCloudDocId = null;
    _publicToken = null;
    _shareStatus = 'draft';
    _publishedAt = null;
    _leadId = null;
    _opsEventId = null;
    _clientEmail = '';
    _cloudAutosaveState = 'idle';
    updateSaveButtonLabel();
    updateShareBar();
    updateCalendarButton();
    clearAiChatHistory();
    });
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
let _publicToken = null;
let _shareStatus = 'draft';
let _publishedAt = null;
let _leadId = null;
let _opsEventId = null;
let _clientEmail = '';
let _allCloudInvoices = [];
let _editorReady = false;
let _suppressCloudAutosave = false;
let _cloudAutosaveTimer = null;
let _cloudAutosaveBusy = false;
let _cloudAutosaveState = 'idle'; // idle | pending | saving | saved | error

const PUBLIC_INVOICE_ORIGIN = 'https://matchanese-invoice.web.app';

/** Prefix for a calendar day: INV-YYYY-MMDD- */
function invoiceNumberDayPrefix(dateInput) {
    let date;
    if (dateInput instanceof Date && !Number.isNaN(dateInput.getTime())) {
        date = dateInput;
    } else if (typeof dateInput === 'string' && dateInput.trim()) {
        const parts = String(dateInput).slice(0, 10).split('-');
        if (parts.length === 3) {
            date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        }
    }
    if (!date || Number.isNaN(date.getTime())) date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `INV-${year}-${month}${day}-`;
}

function parseInvoiceDaySeq(invoiceNumber, dayPrefix) {
    const value = String(invoiceNumber || '').trim();
    if (!value.startsWith(dayPrefix)) return 0;
    const m = value.slice(dayPrefix.length).match(/^(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
}

/**
 * Next unused INV-YYYY-MMDD-NNN for the given invoice date,
 * based on numbers already in the loaded cloud list.
 */
function nextInvoiceNumberForDate(dateInput, { excludeDocId } = {}) {
    const prefix = invoiceNumberDayPrefix(dateInput);
    let max = 0;
    (_allCloudInvoices || []).forEach((inv) => {
        if (excludeDocId && inv.id === excludeDocId) return;
        const seq = parseInvoiceDaySeq(inv.invoiceNumber, prefix);
        if (seq > max) max = seq;
    });
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

async function ensureCloudInvoiceListLoaded({ force = false } = {}) {
    if (!force && _allCloudInvoices && _allCloudInvoices.length) return;
    try {
        _allCloudInvoices = await fetchCloudInvoices();
    } catch (err) {
        console.warn('Could not refresh invoices for numbering:', err);
    }
}

function generatePublicToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function publicInvoiceUrl(token) {
    return `${PUBLIC_INVOICE_ORIGIN}/i/${token}`;
}

function computeClientPaymentSummary(doc) {
    const total = Math.round((Number(doc?.totalAmount) || 0) * 100) / 100;
    const milestones = Array.isArray(doc?.paymentMilestones)
        ? doc.paymentMilestones.filter((m) => m && String(m.milestone || '').trim() && (m.paid || Number(m.percentage) > 0))
        : [];
    const amountPaid = Math.round(
        milestones.filter((m) => m.paid).reduce((sum, m) => sum + (Number(m.amount) || 0), 0) * 100
    ) / 100;
    const amountRemaining = Math.round(Math.max(0, total - amountPaid) * 100) / 100;
    const allPaid = milestones.length > 0 && milestones.every((m) => m.paid);
    let paymentStatus = 'unpaid';
    if (allPaid || (total > 0 && amountRemaining <= 0 && amountPaid > 0)) paymentStatus = 'paid';
    else if (amountPaid > 0) paymentStatus = 'partial';
    if (doc?.shareStatus !== 'published') paymentStatus = paymentStatus; // keep math; draft shown separately
    return { amountTotal: total, amountPaid, amountRemaining, paymentStatus };
}

function updateShareBar() {
    const statusEl = document.getElementById('invoiceShareStatus');
    const openBtn = document.getElementById('openInvoiceLink');
    if (!statusEl) return;

    let autosaveNote = '';
    if (_cloudAutosaveState === 'saving' || _cloudAutosaveBusy) {
        autosaveNote = 'Saving…';
    } else if (_cloudAutosaveState === 'pending') {
        autosaveNote = 'Saving soon…';
    } else if (_cloudAutosaveState === 'error') {
        autosaveNote = 'Autosave failed — retry by editing again.';
    } else if (_cloudAutosaveState === 'saved' || _currentCloudDocId) {
        autosaveNote = 'Saved';
    }

    if (_shareStatus === 'published' && _publicToken) {
        const url = publicInvoiceUrl(_publicToken);
        statusEl.textContent = autosaveNote ? `${url} · ${autosaveNote}` : url;
        statusEl.classList.add('is-published');
        if (openBtn) {
            openBtn.disabled = false;
            openBtn.dataset.url = url;
        }
    } else {
        statusEl.textContent = autosaveNote
            ? `${autosaveNote}. Copy link to publish the customer page.`
            : 'Autosaves as you edit. Copy link to publish the customer page.';
        statusEl.classList.remove('is-published');
        if (openBtn) {
            openBtn.disabled = true;
            delete openBtn.dataset.url;
        }
    }
    updateCalendarButton();
}

function updateCalendarButton() {
    const btn = document.getElementById('addToCalendarBtn');
    if (!btn) return;
    if (_opsEventId) {
        btn.textContent = 'View on calendar';
        btn.dataset.mode = 'view';
        btn.disabled = false;
        return;
    }
    btn.textContent = 'Add to calendar';
    btn.dataset.mode = 'promote';
    btn.disabled = !_currentCloudDocId;
}

async function getOpsPromoteContext() {
    const db = await getFirebaseDb();
    const m = _firebaseModules;
    return {
        db,
        firestoreFns: {
            getDocs: m.getDocs,
            getDoc: m.getDoc,
            collection: m.collection,
            doc: m.doc,
            addDoc: m.addDoc,
            updateDoc: m.updateDoc,
            setDoc: m.setDoc,
            deleteDoc: m.deleteDoc,
            query: m.query,
            where: m.where
        }
    };
}

async function promoteCurrentInvoiceToCalendar() {
    const btn = document.getElementById('addToCalendarBtn');
    if (!_currentCloudDocId) {
        alert('Save the invoice first (it autosaves once you edit).');
        return;
    }
    if (_opsEventId) {
        const snap = await fetchCloudInvoiceById(_currentCloudDocId);
        const { invoicePackageDays, promoteInvoiceToOpsEvent } = await import(
            '../shared/js/ops-events.js?v=18'
        );
        const days = snap ? invoicePackageDays(snap) : [];
        const linked = [
            ...(Array.isArray(snap?.opsEventIds) ? snap.opsEventIds : []),
            snap?.opsEventId || _opsEventId
        ].filter(Boolean);
        const unique = [...new Set(linked)];
        if (snap && days.length > unique.length) {
            if (
                confirm(
                    'This invoice has multiple package days but only one calendar event. Re-create as separate days with correct cups?'
                )
            ) {
                const { db, firestoreFns } = await getOpsPromoteContext();
                const created = await promoteInvoiceToOpsEvent(db, firestoreFns, snap, {
                    createdBy: 'invoice-generator',
                    forceResplit: true
                });
                _opsEventId = created.id;
                updateCalendarButton();
                window.open(
                    `../admin.html?app=Events&event=${encodeURIComponent(created.id)}`,
                    '_blank',
                    'noopener'
                );
                return;
            }
        }
        const url = `../admin.html?app=Events&event=${encodeURIComponent(_opsEventId)}`;
        window.open(url, '_blank', 'noopener');
        return;
    }

    const eventDate = getInvoiceEventDate();
    if (!eventDate) {
        alert('Set a package event date before adding this invoice to the calendar.');
        return;
    }

    const mode = confirm(
        'Create a NEW calendar event from this invoice?\n\nOK = Create new\nCancel = Open Events to merge into an existing event'
    );
    if (!mode) {
        window.open(
            `../admin.html?app=Events&invoice=${encodeURIComponent(_currentCloudDocId)}`,
            '_blank',
            'noopener'
        );
        return;
    }

    const original = btn?.textContent || 'Add to calendar';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Adding…';
    }

    try {
        await persistToCloud();
        const snap = await fetchCloudInvoiceById(_currentCloudDocId);
        if (!snap) throw new Error('Could not load the saved invoice.');

        const { promoteInvoiceToOpsEvent } = await import('../shared/js/ops-events.js?v=18');
        const { db, firestoreFns } = await getOpsPromoteContext();
        const created = await promoteInvoiceToOpsEvent(db, firestoreFns, snap, {
            createdBy: 'invoice-generator'
        });
        _opsEventId = created.id;
        const idx = (_allCloudInvoices || []).findIndex((row) => row.id === _currentCloudDocId);
        if (idx >= 0) _allCloudInvoices[idx] = { ..._allCloudInvoices[idx], opsEventId: created.id };
        updateCalendarButton();
        if (btn) btn.textContent = 'Added ✓';
        setTimeout(() => updateCalendarButton(), 1200);
        const open = confirm(
            'Invoice added to Events as a draft hold. Open Events now to confirm / schedule it?'
        );
        if (open) {
            window.open(
                `../admin.html?app=Events&event=${encodeURIComponent(created.id)}`,
                '_blank',
                'noopener'
            );
        }
    } catch (err) {
        console.error('Add to calendar failed', err);
        alert(err.message || 'Could not add invoice to the calendar.');
        if (btn) {
            btn.textContent = original;
            btn.disabled = false;
        }
        updateCalendarButton();
    }
}

async function archiveCurrentInvoice() {
    if (!_currentCloudDocId) {
        alert('Save the invoice first.');
        return;
    }
    const label =
        document.getElementById('clientName')?.value ||
        document.getElementById('invoiceNumber')?.value ||
        'this invoice';
    if (!confirm(`Archive ${label}? It will leave Events overlays and the invoice list.`)) return;

    const btn = document.getElementById('archiveInvoiceBtn');
    const original = btn?.textContent || 'Archive';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Archiving…';
    }
    try {
        await persistToCloud();
        const { archiveInvoice } = await import('../shared/js/ops-events.js?v=18');
        const { db, firestoreFns } = await getOpsPromoteContext();
        await archiveInvoice(db, firestoreFns, _currentCloudDocId, {
            updatedBy: 'invoice-generator'
        });
        _allCloudInvoices = (_allCloudInvoices || []).filter((row) => row.id !== _currentCloudDocId);
        showScreen('list');
        await refreshInvoiceList();
    } catch (err) {
        console.error('Archive invoice failed', err);
        alert(err.message || 'Could not archive invoice.');
        if (btn) {
            btn.textContent = original;
            btn.disabled = false;
        }
    }
}

function updateSaveButtonLabel() {
    // Save button removed — surface autosave state in the share status line.
    updateShareBar();
}

function showScreen(name) {
    const list = document.getElementById('listScreen');
    const editor = document.getElementById('editorScreen');
    const showList = name === 'list';
    if (showList && (_cloudAutosaveState === 'pending' || _cloudAutosaveTimer)) {
        clearTimeout(_cloudAutosaveTimer);
        _cloudAutosaveTimer = null;
        void runCloudAutosave();
    }
    if (list) {
        list.classList.toggle('is-hidden', !showList);
        list.hidden = !showList;
    }
    if (editor) {
        editor.classList.toggle('is-hidden', showList);
        editor.hidden = showList;
    }
    document.body.classList.toggle('is-editing', !showList);
    if (showList) {
        document.title = 'Invoices - Matchanese';
        syncInvoiceEditorUrl({});
    }
}

function getInvoiceIdFromUrl() {
    try {
        return String(new URLSearchParams(window.location.search).get('id') || '').trim();
    } catch {
        return '';
    }
}

function syncInvoiceEditorUrl({ docId = null, isNew = false } = {}) {
    try {
        const url = new URL(window.location.href);
        if (docId) {
            url.searchParams.set('id', docId);
            url.searchParams.delete('new');
        } else if (isNew) {
            url.searchParams.delete('id');
            url.searchParams.set('new', '1');
        } else {
            url.searchParams.delete('id');
            url.searchParams.delete('new');
        }
        const next = `${url.pathname}${url.search}${url.hash}`;
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (next !== current) history.replaceState({}, '', next);
    } catch (err) {
        console.warn('Could not sync invoice URL', err);
    }
}

async function fetchCloudInvoiceById(docId) {
    if (!docId) return null;
    const db = await getFirebaseDb();
    const { doc, getDoc } = _firebaseModules;
    const snap = await getDoc(doc(db, 'invoice-generator', docId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

function buildSavePayload() {
    const pricing = calculatePricingBreakdown();
    return {
        invoiceNumber: document.getElementById('invoiceNumber').value,
        invoiceDate: document.getElementById('invoiceDate').value,
        clientName: document.getElementById('clientName').value,
        clientCompany: document.getElementById('clientCompany')?.value || '',
        clientAddress: document.getElementById('clientAddress').value,
        clientTIN: document.getElementById('clientTIN').value,
        clientEmail: _clientEmail || '',
        eventDate: getInvoiceEventDate(),
        notes: document.getElementById('notes').value,
        invoiceItems: invoiceItems,
        customLineItems: customLineItems,
        paymentMilestones: paymentMilestones,
        paymentStructure: paymentStructure,
        paymentTermsCustomized: paymentTermsCustomized,
        invoiceDiscount: getInvoiceExtraDiscount(),
        totalAmount: pricing.amountTotal,
        amountTotal: pricing.amountTotal,
        amountSubtotal: pricing.amountSubtotal,
        amountDiscount: pricing.amountDiscount,
        publicToken: _publicToken || null,
        shareStatus: _shareStatus || 'draft',
        publishedAt: _publishedAt || null,
        leadId: _leadId || null,
        savedAt: new Date().toISOString()
    };
}

function restoreFromPayload(data, docId) {
    withCloudAutosaveSuppressed(() => {
    aiDebug('restoreFromPayload in', {
        docId: docId || null,
        clientName: data?.clientName,
        invoiceItems: data?.invoiceItems?.length,
        customLineItems: data?.customLineItems?.length,
        paymentStructure: data?.paymentStructure
    });

    _currentCloudDocId = docId || null;
    _publicToken = data.publicToken || null;
    _shareStatus = data.shareStatus || 'draft';
    _publishedAt = data.publishedAt || null;
    _leadId = data.leadId || null;
    _opsEventId = data.opsEventId || null;
    _clientEmail = String(data.clientEmail || '').trim();

    if (data.invoiceNumber) document.getElementById('invoiceNumber').value = data.invoiceNumber;
    if (data.invoiceDate) document.getElementById('invoiceDate').value = data.invoiceDate;
    document.getElementById('clientName').value = data.clientName || '';
    if (document.getElementById('clientCompany')) {
        document.getElementById('clientCompany').value = data.clientCompany || '';
    }
    document.getElementById('clientAddress').value = data.clientAddress || '';
    document.getElementById('clientTIN').value = data.clientTIN || '';
    document.getElementById('notes').value = data.notes || '';
    if (document.getElementById('invoiceDiscount')) {
        document.getElementById('invoiceDiscount').value =
            data.invoiceDiscount != null && data.invoiceDiscount !== ''
                ? data.invoiceDiscount
                : '';
    }

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

    const structureSelect = document.getElementById('paymentStructure');
    if (structureSelect) structureSelect.value = paymentStructure;
    const customizeCheckbox = document.getElementById('customizeMilestones');
    if (customizeCheckbox) customizeCheckbox.checked = paymentTermsCustomized;

    renderInvoiceItems();
    renderCustomLineItems();
    renderPaymentMilestones();
    updatePreview();
    _cloudAutosaveState = _currentCloudDocId ? 'saved' : 'idle';
    updateSaveButtonLabel();
    updateShareBar();
    updateCalendarButton();

    aiDebug('restoreFromPayload DOM after', {
        clientNameInput: document.getElementById('clientName')?.value,
        displayClientName: document.getElementById('displayClientName')?.textContent,
        invoiceItemsLen: invoiceItems.length,
        displayTotal: document.getElementById('displayTotal')?.textContent
    });
    });
}

function isEditorScreenVisible() {
    const editor = document.getElementById('editorScreen');
    if (!editor) return false;
    if (editor.hidden) return false;
    return !editor.classList.contains('is-hidden');
}

function scheduleCloudAutosave() {
    if (_suppressCloudAutosave || !_editorReady) return;
    if (!isEditorScreenVisible()) return;

    _cloudAutosaveState = 'pending';
    updateSaveButtonLabel();
    clearTimeout(_cloudAutosaveTimer);
    _cloudAutosaveTimer = setTimeout(() => {
        void runCloudAutosave();
    }, 1200);
}

async function runCloudAutosave() {
    if (_suppressCloudAutosave || !_editorReady || !isEditorScreenVisible()) return;
    if (_cloudAutosaveBusy) {
        scheduleCloudAutosave();
        return;
    }
    _cloudAutosaveBusy = true;
    _cloudAutosaveState = 'saving';
    updateSaveButtonLabel();
    try {
        await persistToCloud();
        updateShareBar();
        _cloudAutosaveState = 'saved';
        updateSaveButtonLabel();
    } catch (err) {
        console.error('Cloud autosave error:', err);
        _cloudAutosaveState = 'error';
        updateSaveButtonLabel();
    } finally {
        _cloudAutosaveBusy = false;
        updateSaveButtonLabel();
    }
}

function withCloudAutosaveSuppressed(fn) {
    _suppressCloudAutosave = true;
    clearTimeout(_cloudAutosaveTimer);
    try {
        return fn();
    } finally {
        _suppressCloudAutosave = false;
    }
}

async function withCloudAutosaveSuppressedAsync(fn) {
    _suppressCloudAutosave = true;
    clearTimeout(_cloudAutosaveTimer);
    try {
        return await fn();
    } finally {
        _suppressCloudAutosave = false;
    }
}

async function persistToCloud() {
    const db = await getFirebaseDb();

    // New docs: never save a duplicate INV-YYYY-MMDD-NNN.
    if (!_currentCloudDocId) {
        try {
            _allCloudInvoices = await fetchCloudInvoices();
        } catch (err) {
            console.warn('Could not refresh invoices before save:', err);
        }
        const dateVal = document.getElementById('invoiceDate').value;
        const currentNum = String(document.getElementById('invoiceNumber').value || '').trim();
        const taken = (_allCloudInvoices || []).some(
            (inv) => String(inv.invoiceNumber || '').trim() === currentNum
        );
        if (!currentNum || taken) {
            document.getElementById('invoiceNumber').value = nextInvoiceNumberForDate(dateVal);
        }
    }

    const payload = buildSavePayload();

    if (_currentCloudDocId) {
        const { doc, updateDoc } = _firebaseModules;
        await updateDoc(doc(db, 'invoice-generator', _currentCloudDocId), payload);
        syncInvoiceEditorUrl({ docId: _currentCloudDocId });
        return _currentCloudDocId;
    } else {
        const { collection, addDoc } = _firebaseModules;
        const docRef = await addDoc(collection(db, 'invoice-generator'), payload);
        _currentCloudDocId = docRef.id;
        saveToLocalStorage(); // persist the new doc ID so refresh doesn't lose it
        syncInvoiceEditorUrl({ docId: _currentCloudDocId });
        return _currentCloudDocId;
    }
}

async function fetchCloudInvoices() {
    const db = await getFirebaseDb();
    const { collection, getDocs, query, orderBy } = _firebaseModules;
    const q = query(collection(db, 'invoice-generator'), orderBy('savedAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => !row.archived);
}

async function deleteCloudInvoice(docId) {
    const db = await getFirebaseDb();
    const { doc, deleteDoc } = _firebaseModules;
    await deleteDoc(doc(db, 'invoice-generator', docId));
}

// ─── Save (inline, no modal) ──────────────────────────────────────────────────

async function handleSave() {
    const btn = document.getElementById('saveToCloud');
    clearTimeout(_cloudAutosaveTimer);
    btn.dataset.manualSave = '1';
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        await persistToCloud();
        updateShareBar();
        _cloudAutosaveState = 'saved';
        btn.textContent = 'Saved ✓';
        setTimeout(() => {
            btn.dataset.manualSave = '';
            btn.disabled = false;
            updateSaveButtonLabel();
        }, 1200);
    } catch (err) {
        console.error('Save error:', err);
        _cloudAutosaveState = 'error';
        btn.textContent = 'Error';
        setTimeout(() => {
            btn.dataset.manualSave = '';
            btn.disabled = false;
            updateSaveButtonLabel();
        }, 2000);
    }
}

async function handleCopyInvoiceLink() {
    const btn = document.getElementById('copyInvoiceLink');
    if (!btn) return;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Publishing…';
    try {
        if (!_publicToken) _publicToken = generatePublicToken();
        _shareStatus = 'published';
        if (!_publishedAt) _publishedAt = new Date().toISOString();
        await persistToCloud();
        saveToLocalStorage();
        const url = publicInvoiceUrl(_publicToken);
        updateShareBar();
        await navigator.clipboard.writeText(url);
        btn.textContent = 'Copied ✓';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 1800);
    } catch (err) {
        console.error('Copy invoice link error:', err);
        btn.textContent = 'Error';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 2000);
    }
}

function handleOpenInvoiceLink() {
    const btn = document.getElementById('openInvoiceLink');
    const url = btn?.dataset.url;
    if (url) window.open(url, '_blank', 'noopener');
}

function invoiceGreetingName() {
    const name = String(document.getElementById('clientName')?.value || '').trim();
    if (name) {
        const first = name.split(/\s+/)[0];
        if (first) return first;
    }
    const company = String(document.getElementById('clientCompany')?.value || '').trim();
    if (company) return company;
    return 'there';
}

function invoiceEmailEventContext() {
    const items = Array.isArray(invoiceItems) ? invoiceItems.filter(Boolean) : [];
    const primary =
        items.find((item) => isWorkshopItem(item) || isWorkshopEventType(item.eventType)) ||
        items.find((item) => item.packageType && item.packageType !== 'custom') ||
        items[0] ||
        null;

    let bookingLabel = 'Matchanese Mobile Bar';
    if (primary && (isWorkshopItem(primary) || isWorkshopEventType(primary.eventType))) {
        const workshopType = primary.eventType || getEventType();
        bookingLabel = WORKSHOP_TITLES[workshopType] || 'Matchanese workshop';
    } else if (!items.length && isWorkshopEventType(getEventType())) {
        bookingLabel = WORKSHOP_TITLES[getEventType()] || 'Matchanese workshop';
    }

    const dates = items.map((item) => item.eventDate).filter(Boolean).sort();
    const eventDateRaw = dates[dates.length - 1] || getInvoiceEventDate() || '';
    const eventDate = eventDateRaw ? formatDate(eventDateRaw) : '';
    const venues = [...new Set(
        items.map((item) => String(item.eventVenue || '').trim()).filter(Boolean)
    )];
    const venue = venues.length === 1 ? venues[0] : '';

    return { bookingLabel, eventDate, venue };
}

function composeInvoiceEmailSubject() {
    const { bookingLabel } = invoiceEmailEventContext();
    return `${bookingLabel} invoice`;
}

function composeInvoiceEmailBody(_url) {
    const greeting = invoiceGreetingName();
    const { bookingLabel, eventDate, venue } = invoiceEmailEventContext();
    const eventBits = [eventDate && `Date: ${eventDate}`, venue && `Venue: ${venue}`].filter(Boolean);

    const lines = [
        `Hi ${greeting},`,
        '',
        `Please see our invoice for your ${bookingLabel} — pricing, inclusions, payment schedule, and how to pay are all here:`,
        '',
        'View your invoice'
    ];
    if (eventBits.length) {
        lines.push('', ...eventBits);
    }
    lines.push(
        '',
        'If anything looks off or you\'d like to adjust the proposal, just reply to this email.',
        '',
        'Matchanese Team'
    );
    return lines.join('\n');
}

function getInvoiceEmailApiUrl(token) {
    const encoded = encodeURIComponent(token);
    const { hostname, origin, port } = window.location;
    // Only hit same-origin /api on Firebase hosting or the Functions emulator — not static local servers.
    if (
        hostname === 'matchanese-attendance.web.app' ||
        hostname === 'matchanese-attendance.firebaseapp.com' ||
        hostname === 'matchanese-invoice.web.app' ||
        hostname === 'matchanese-invoice.firebaseapp.com'
    ) {
        return `${origin}/api/invoices/${encoded}/email`;
    }
    if (
        (hostname === 'localhost' || hostname === '127.0.0.1') &&
        (port === '5000' || port === '5001' || port === '5002')
    ) {
        return `${origin}/api/invoices/${encoded}/email`;
    }
    return `https://matchanese-attendance.web.app/api/invoices/${encoded}/email`;
}

function setEmailComposeEditable(editable) {
    const subjectEl = document.getElementById('emailInvoiceSubject');
    const messageEl = document.getElementById('emailInvoiceMessage');
    const editBtn = document.getElementById('emailInvoiceEditToggle');
    if (subjectEl) {
        subjectEl.readOnly = !editable;
        subjectEl.classList.toggle('is-locked', !editable);
    }
    if (messageEl) {
        messageEl.readOnly = !editable;
        messageEl.classList.toggle('is-locked', !editable);
    }
    if (editBtn) {
        editBtn.setAttribute('aria-pressed', editable ? 'true' : 'false');
        editBtn.title = editable ? 'Lock subject & message' : 'Edit subject & message';
        editBtn.classList.toggle('is-active', editable);
    }
}

function setEmailInvoiceError(message) {
    const el = document.getElementById('emailInvoiceError');
    if (!el) return;
    if (message) {
        el.textContent = message;
        el.hidden = false;
        el.classList.remove('is-hidden');
    } else {
        el.textContent = '';
        el.hidden = true;
        el.classList.add('is-hidden');
    }
}

function closeEmailInvoiceModal() {
    const modal = document.getElementById('emailInvoiceModal');
    if (!modal) return;
    modal.hidden = true;
    modal.classList.add('is-hidden');
    setEmailInvoiceError('');
}

async function ensureInvoicePublishedForShare() {
    if (!_publicToken) _publicToken = generatePublicToken();
    _shareStatus = 'published';
    if (!_publishedAt) _publishedAt = new Date().toISOString();
    await persistToCloud();
    saveToLocalStorage();
    updateShareBar();
    return publicInvoiceUrl(_publicToken);
}

async function openEmailInvoiceModal() {
    const modal = document.getElementById('emailInvoiceModal');
    const btn = document.getElementById('emailInvoiceBtn');
    if (!modal || !btn) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Publishing…';
    setEmailInvoiceError('');

    try {
        const url = await ensureInvoicePublishedForShare();
        const toEl = document.getElementById('emailInvoiceTo');
        const subjectEl = document.getElementById('emailInvoiceSubject');
        const messageEl = document.getElementById('emailInvoiceMessage');

        if (toEl) toEl.value = _clientEmail || '';
        if (subjectEl) subjectEl.value = composeInvoiceEmailSubject();
        if (messageEl) messageEl.value = composeInvoiceEmailBody(url);
        setEmailComposeEditable(false);

        modal.hidden = false;
        modal.classList.remove('is-hidden');
        toEl?.focus();
    } catch (err) {
        console.error('Email invoice publish error:', err);
        setEmailInvoiceError('Could not publish the invoice link. Please try again.');
        modal.hidden = false;
        modal.classList.remove('is-hidden');
        setEmailComposeEditable(false);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function readEmailInvoiceFields() {
    return {
        to: String(document.getElementById('emailInvoiceTo')?.value || '').trim(),
        subject: String(document.getElementById('emailInvoiceSubject')?.value || '').trim(),
        message: String(document.getElementById('emailInvoiceMessage')?.value || '').trim()
    };
}

function isValidEmailAddress(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

async function persistClientEmailFromModal() {
    const { to } = readEmailInvoiceFields();
    _clientEmail = to;
    saveToLocalStorage();
    scheduleCloudAutosave();
}

async function handleEmailInvoiceSend() {
    const { to, subject, message } = readEmailInvoiceFields();
    setEmailInvoiceError('');
    if (!to || !isValidEmailAddress(to)) {
        setEmailInvoiceError('Enter a valid client email address.');
        document.getElementById('emailInvoiceTo')?.focus();
        return;
    }
    if (!subject) {
        setEmailInvoiceError('Subject cannot be empty.');
        document.getElementById('emailInvoiceSubject')?.focus();
        return;
    }
    if (!message) {
        setEmailInvoiceError('Message cannot be empty.');
        document.getElementById('emailInvoiceMessage')?.focus();
        return;
    }
    if (!_publicToken) {
        setEmailInvoiceError('Publish the invoice first, then try again.');
        return;
    }

    const btn = document.getElementById('emailInvoiceSend');
    const original = btn?.textContent || 'Send email';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
    }

    try {
        await persistClientEmailFromModal();
        const response = await fetch(getInvoiceEmailApiUrl(_publicToken), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, subject, message })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
            const detail = payload.message || payload.code || `Send failed (${response.status})`;
            throw new Error(detail);
        }
        if (btn) btn.textContent = 'Sent ✓';
        setTimeout(() => {
            if (btn) {
                btn.textContent = original;
                btn.disabled = false;
            }
            closeEmailInvoiceModal();
        }, 1200);
    } catch (err) {
        console.error('Send invoice email error:', err);
        setEmailInvoiceError(err.message || 'Could not send the email.');
        if (btn) {
            btn.textContent = original;
            btn.disabled = false;
        }
    }
}

async function handleEmailInvoiceCopyMessage() {
    const { message } = readEmailInvoiceFields();
    const btn = document.getElementById('emailInvoiceCopy');
    if (!message || !btn) return;
    const original = btn.textContent;
    try {
        await persistClientEmailFromModal();
        await navigator.clipboard.writeText(message);
        btn.textContent = 'Copied ✓';
        setTimeout(() => { btn.textContent = original; }, 1600);
    } catch (err) {
        console.error('Copy email message error:', err);
        setEmailInvoiceError('Could not copy the message.');
    }
}

function filterListInvoices(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return _allCloudInvoices;
    return _allCloudInvoices.filter((inv) => {
        const hay = [
            inv.clientName,
            inv.clientCompany,
            inv.invoiceNumber,
            inv.eventDate,
            ...(inv.invoiceItems || []).map((i) => [i.description, i.eventVenue, i.eventDate].join(' '))
        ].join(' ').toLowerCase();
        return hay.includes(q);
    });
}

function clientListLabel(inv) {
    const name = String(inv?.clientName || '').trim();
    const company = String(inv?.clientCompany || '').trim();
    return name || company || 'Untitled client';
}

function clientListSubtitle(inv) {
    const name = String(inv?.clientName || '').trim();
    const company = String(inv?.clientCompany || '').trim();
    if (name && company) return company;
    return '';
}

function invoiceListEventSummary(inv) {
    const items = Array.isArray(inv.invoiceItems) ? inv.invoiceItems : [];
    const packages = items.filter((item) => {
        if (!item) return false;
        if (item.isWorkshop) return true;
        return !!(item.packageType && item.packageType !== 'custom');
    });
    const primary = packages[0] || items[0] || null;
    const eventDates = packages
        .map((item) => item.eventDate)
        .filter(Boolean)
        .sort();
    const eventDateStr = eventDates[eventDates.length - 1] || inv.eventDate || '';
    const venues = [...new Set(
        packages.map((item) => String(item.eventVenue || '').trim()).filter(Boolean)
    )];
    const packageTitle = primary ? String(primary.description || '').trim() : '';
    let sizeLabel = '';
    if (primary) {
        const cupsMatch = String(primary.cups || '').match(/\d+/);
        if (cupsMatch) {
            const isWorkshop = !!(
                primary.isWorkshop ||
                primary.countLabel === 'participants' ||
                primary.countLabel === 'guests'
            );
            sizeLabel = isWorkshop ? `${cupsMatch[0]} guests` : `${cupsMatch[0]} cups`;
        }
    }
    return {
        eventDate: eventDateStr ? formatDate(eventDateStr) : '',
        venue: venues.length === 1 ? venues[0] : venues.length > 1 ? `${venues.length} venues` : '',
        packageTitle,
        sizeLabel,
        packageCount: packages.length
    };
}

function renderInvoiceList(invoices) {
    const list = document.getElementById('invoiceList');
    const status = document.getElementById('listStatus');
    if (!list) return;
    if (!invoices.length) {
        list.innerHTML = '<div class="invoice-list-empty">No invoices yet. Create one to get a customer link.</div>';
        if (status) status.textContent = '0 invoices';
        return;
    }
    if (status) status.textContent = `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`;

    const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3V7zm-4 4a3 3 0 0 1 3-3v9a5 5 0 0 0 5 5h5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-11z"/></svg>';
    const openIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5h-2V8.41l-6.3 6.3-1.4-1.42 6.29-6.29H14V5zM5 7a2 2 0 0 1 2-2h5v2H7v12h12v-5h2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7z"/></svg>';

    list.innerHTML = invoices.map((inv) => {
        const summary = computeClientPaymentSummary(inv);
        const published = inv.shareStatus === 'published' && inv.publicToken;
        const statusKey = published ? summary.paymentStatus : 'draft';
        const statusLabel = published
            ? (summary.paymentStatus === 'paid' ? 'Paid' : summary.paymentStatus === 'partial' ? 'Partial' : 'Unpaid')
            : 'Draft';
        const event = invoiceListEventSummary(inv);
        const subtitle = clientListSubtitle(inv);
        const total = summary.amountTotal != null ? formatCurrency(summary.amountTotal) : '';
        const remainingVal = summary.amountRemaining != null ? formatCurrency(summary.amountRemaining) : '';
        const url = published ? publicInvoiceUrl(inv.publicToken) : '';
        const extraPackages = event.packageCount > 1 ? ` · +${event.packageCount - 1} more` : '';
        const packageLine = event.packageTitle
            ? `${escapeHtml(event.packageTitle)}${event.sizeLabel ? ` · ${escapeHtml(event.sizeLabel)}` : ''}${extraPackages}`
            : '';

        const moneyHtml = total
            ? `<div class="invoice-list-money">
                <div class="invoice-list-money-total">Php ${escapeHtml(total)}</div>
                ${
                    published && summary.paymentStatus === 'paid'
                        ? `<div class="invoice-list-money-remaining is-paid">Paid</div>`
                        : published
                            ? `<div class="invoice-list-money-remaining">Remaining Php ${escapeHtml(remainingVal)}</div>`
                            : ''
                }
               </div>`
            : '';

        const metaParts = [];
        if (packageLine) metaParts.push(`<span class="invoice-list-meta-item">${packageLine}</span>`);
        if (event.eventDate) metaParts.push(`<span class="invoice-list-meta-item">${escapeHtml(event.eventDate)}</span>`);
        if (event.venue) metaParts.push(`<span class="invoice-list-meta-item">${escapeHtml(event.venue)}</span>`);
        const metaHtml = metaParts.length
            ? `<div class="invoice-list-meta">${metaParts.join('<span class="invoice-list-meta-sep" aria-hidden="true">·</span>')}</div>`
            : '';

        return `
        <article class="invoice-list-card" data-id="${escapeHtml(inv.id)}" data-action="edit" tabindex="0" role="button" aria-label="Open invoice ${escapeHtml(inv.invoiceNumber || '')}">
            <div class="invoice-list-main">
                <div class="invoice-list-client">${escapeHtml(clientListLabel(inv))}</div>
                ${subtitle ? `<div class="invoice-list-company">${escapeHtml(subtitle)}</div>` : ''}
                <div class="invoice-list-id-row">
                    ${inv.invoiceNumber ? `<span class="invoice-list-number">${escapeHtml(inv.invoiceNumber)}</span>` : ''}
                    <span class="invoice-status-pill is-${statusKey}">${statusLabel}</span>
                    ${
                        inv.opsEventId
                            ? `<span class="invoice-status-pill is-calendar">On calendar</span>`
                            : ''
                    }
                </div>
            </div>
            <div class="invoice-list-side">
                ${moneyHtml}
                <div class="invoice-list-actions">
                    <button type="button" class="invoice-list-icon-btn" data-action="copy" title="Copy customer link" aria-label="Copy customer link">${copyIcon}</button>
                    <button type="button" class="invoice-list-icon-btn" data-action="open" title="Open customer page" aria-label="Open customer page" ${published ? '' : 'disabled'} data-url="${escapeHtml(url)}">${openIcon}</button>
                    <button type="button" class="invoice-list-icon-btn" data-action="archive" title="Archive invoice" aria-label="Archive invoice">Archive</button>
                </div>
            </div>
            ${metaHtml}
        </article>`;
    }).join('');
}

async function refreshInvoiceList() {
    const status = document.getElementById('listStatus');
    if (status) status.textContent = 'Loading invoices…';
    try {
        _allCloudInvoices = await fetchCloudInvoices();
        const query = document.getElementById('listSearchInput')?.value || '';
        renderInvoiceList(filterListInvoices(query));
    } catch (err) {
        console.error(err);
        if (status) status.textContent = 'Failed to load invoices.';
        const list = document.getElementById('invoiceList');
        if (list) list.innerHTML = '<div class="invoice-list-empty">Could not load invoices. Check your connection and try Refresh.</div>';
    }
}

async function startNewInvoice() {
    await withCloudAutosaveSuppressedAsync(async () => {
    // Soft reset without confirm when coming from list "New"
    const today = new Date();
    document.getElementById('invoiceDate').valueAsDate = today;
    await ensureCloudInvoiceListLoaded({ force: true });
    document.getElementById('invoiceNumber').value = nextInvoiceNumberForDate(today);
    document.getElementById('clientName').value = '';
    if (document.getElementById('clientCompany')) document.getElementById('clientCompany').value = '';
    document.getElementById('clientAddress').value = '';
    document.getElementById('clientTIN').value = '';
    document.getElementById('notes').value = '';
    if (document.getElementById('invoiceDiscount')) document.getElementById('invoiceDiscount').value = '';
    invoiceItems = [];
    customLineItems = [];
    paymentMilestones = [];
    invoicePayments = [];
    paymentStructure = 'three';
    paymentTermsCustomized = false;
    const structureSelect = document.getElementById('paymentStructure');
    if (structureSelect) structureSelect.value = 'three';
    const customizeCheckbox = document.getElementById('customizeMilestones');
    if (customizeCheckbox) customizeCheckbox.checked = false;
    addDefaultPaymentMilestones();
    _currentCloudDocId = null;
    _publicToken = null;
    _shareStatus = 'draft';
    _publishedAt = null;
    _leadId = null;
    _opsEventId = null;
    _clientEmail = '';
    clearAiChatHistory();
    renderInvoiceItems();
    renderCustomLineItems();
    renderPaymentMilestones();
    updatePreview();
    _cloudAutosaveState = 'idle';
    updateSaveButtonLabel();
    updateShareBar();
    updateCalendarButton();
    saveToLocalStorage();
    showScreen('editor');
    syncInvoiceEditorUrl({ isNew: true });
    document.title = 'New invoice - Matchanese';
    });
}

function openInvoiceInEditor(inv) {
    restoreFromPayload(inv, inv.id);
    saveToLocalStorage();
    showScreen('editor');
    syncInvoiceEditorUrl({ docId: inv.id });
    document.title = `${inv.invoiceNumber || 'Invoice'} - Matchanese`;
    loadInvoicePaymentsForDoc(inv.id)
        .then(() => repairBrokenPaymentLedgerIfNeeded())
        .then(() => {
            renderPaymentMilestones();
            updatePreview();
            scheduleCloudAutosave();
        })
        .catch((err) => console.warn('Could not load invoice payments', err));
}

// ─── Load Modal (unused in list app; kept for shared helpers) ─────────────────

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
            const pax = resolvePackageCount(item) || '';
            if (pax) {
                const paxNum = String(pax).match(/\d+/) ? String(pax).match(/\d+/)[0] : pax;
                return `${title} · ${paxNum} pax`;
            }
            return title;
        }
        const __count = resolvePackageCount(item);
            if (__count) {
            const cupsNum = String(__count);
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
        const client = escapeHtml(clientListLabel(inv) === 'Untitled client' ? 'No client name' : clientListLabel(inv));
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
            const name = inv
                ? (clientListLabel(inv) !== 'Untitled client'
                    ? clientListLabel(inv)
                    : (inv.invoiceNumber || 'this invoice'))
                : 'this invoice';
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
        (inv.clientCompany || '').toLowerCase().includes(q) ||
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

const AI_CHAT_STORAGE_KEY = 'invoiceAppAiChat';
const AI_MODE_STORAGE_KEY = 'invoiceAppEditorMode';
/** Flip to false once debugging is done. */
const INVOICE_AI_DEBUG = true;
const INVOICE_AI_DEBUG_BUILD = '20260914-baristas';

function aiDebug(...args) {
    if (!INVOICE_AI_DEBUG) return;
    console.log('[invoice-ai]', ...args);
}

function aiDebugWarn(...args) {
    if (!INVOICE_AI_DEBUG) return;
    console.warn('[invoice-ai]', ...args);
}

/** Debug card = literal model output for this turn (not post-merge form state). */
function buildAiDebugCardText({ assistantMessage, geminiPatch }) {
    const message = String(assistantMessage || '');
    let invoiceJson = '{}';
    try {
        invoiceJson = JSON.stringify(geminiPatch && typeof geminiPatch === 'object' ? geminiPatch : {}, null, 2);
    } catch {
        invoiceJson = String(geminiPatch);
    }
    return [
        `[AI DEBUG build=${INVOICE_AI_DEBUG_BUILD}]`,
        `assistantMessage: ${JSON.stringify(message)}`,
        `invoice: ${invoiceJson}`
    ].join('\n');
}

function patchHasFields(patch) {
    const p = patch && typeof patch === 'object' ? patch : {};
    const keys = Object.keys(p).filter((k) => k !== 'invoiceItems');
    if (keys.length) return true;
    return Array.isArray(p.invoiceItems) && p.invoiceItems.length > 0;
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
        // Never persist full Gemini prompt dumps — they blow the origin quota
        // and then invoiceAppData saves fail with QuotaExceededError.
        const slim = aiChatMessages.map((m) => {
            if (!m || typeof m !== 'object') return m;
            if (m.role === 'user') {
                return { role: 'user', content: m.content || '' };
            }
            if (m.role === 'debug') {
                const content = String(m.content || '');
                return {
                    role: 'debug',
                    content: content.length > 4000 ? `${content.slice(0, 4000)}…` : content
                };
            }
            return { role: m.role, content: m.content || '' };
        });
        localStorage.setItem(AI_CHAT_STORAGE_KEY, JSON.stringify(slim));
    } catch {
        try {
            localStorage.removeItem(AI_CHAT_STORAGE_KEY);
        } catch {
            /* ignore */
        }
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
    const formPane = document.querySelector('.invoices-form-pane');
    if (formPane) formPane.classList.toggle('is-ai-mode', isAi);
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
            if (m.role === 'debug') {
                return (
                    `<div class="ai-chat-row debug">` +
                    `<pre class="ai-chat-msg debug">${escapeHtml(m.content)}</pre>` +
                    `</div>`
                );
            }
            const role = m.role === 'assistant' ? 'assistant' : m.role === 'error' ? 'error' : 'user';
            if (role === 'user') {
                const promptHtml = m.promptPreview
                    ? `<pre class="ai-chat-prompt-preview">${escapeHtml(m.promptPreview)}</pre>`
                    : '';
                return (
                    `<div class="ai-chat-row user">` +
                    `<div class="ai-chat-bubble user">${escapeHtml(m.content)}</div>` +
                    promptHtml +
                    `</div>`
                );
            }
            const inner =
                role === 'error'
                    ? `<div class="ai-chat-msg error">${escapeHtml(m.content)}</div>`
                    : `<div class="ai-chat-msg assistant">${escapeHtml(m.content)}</div>`;
            return `<div class="ai-chat-row ${role}">${inner}</div>`;
        })
        .join('');

    if (aiChatBusy) {
        container.insertAdjacentHTML(
            'beforeend',
            '<div class="ai-chat-row busy" id="aiChatBusy" aria-label="Updating invoice">' +
                '<div class="ai-chat-busy">' +
                '<span class="ai-typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>' +
                '</div></div>'
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
        count: resolvePackageCount(item) || 0,
        baristas: String(item.baristas || '').trim(),
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
        clientCompany: document.getElementById('clientCompany')?.value || '',
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
    const clientCompany = document.getElementById('clientCompany')?.value || '';
    const clientAddress = document.getElementById('clientAddress')?.value || '';
    const clientTIN = document.getElementById('clientTIN')?.value || '';
    const notes = document.getElementById('notes')?.value || '';

    lines.push('BILLING INVOICE');
    if (invNo) lines.push(`Invoice #: ${invNo}`);
    if (invDate) lines.push(`Date: ${formatDate(invDate)}`);
    lines.push(`Name: ${clientName || '(none)'}`);
    lines.push(`Company: ${clientCompany || '(none)'}`);
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
        {
            const baristaLine = resolveMobileBarBaristas(item);
            if (baristaLine) inclusions.push(baristaLine);
        }
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
        if (!base) {
            const next = { ...incoming };
            next.count = resolvePackageCount(next);
            delete next.cups;
            delete next.numberOfPax;
            delete next.customCups;
            return next;
        }

        const out = { ...base };
        const keys = new Set([...Object.keys(base), ...Object.keys(incoming || {})]);
        keys.forEach((key) => {
            if (key === 'id') {
                out.id = incoming.id != null ? incoming.id : base.id;
                return;
            }
            if (key === 'count' || key === 'cups' || key === 'numberOfPax' || key === 'customCups') return;
            out[key] = pickMergedField(base[key], incoming[key]);
        });
        // count: take patch only when > 0 so a zero cannot wipe a good count
        const patchCount = parseInt(incoming?.count, 10);
        if (patchCount > 0) {
            out.count = patchCount;
        } else {
            const legacyPatch = resolvePackageCount({
                count: 0,
                numberOfPax: incoming?.numberOfPax,
                customCups: incoming?.customCups,
                cups: incoming?.cups
            });
            out.count = legacyPatch > 0 ? legacyPatch : resolvePackageCount(base);
        }
        delete out.cups;
        delete out.numberOfPax;
        delete out.customCups;
        return out;
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
 * Trusts structured JSON only — does not re-parse user text for venues/cups/drinks.
 */
function mergeAiInvoice(current, incoming, { allowClear = false } = {}) {
    const cur = current && typeof current === 'object' ? current : {};
    const inc = coerceIncomingInvoice(incoming);

    let paymentStructure = String(inc.paymentStructure || cur.paymentStructure || 'three').toLowerCase();
    if (paymentStructure !== 'two' && paymentStructure !== 'three') paymentStructure = 'three';

    const paymentTermsCustomized =
        typeof inc.paymentTermsCustomized === 'boolean'
            ? inc.paymentTermsCustomized
            : !!cur.paymentTermsCustomized;

    const merged = {
        invoiceNumber: String(cur.invoiceNumber || '').trim()
            ? String(cur.invoiceNumber).trim()
            : String(inc.invoiceNumber || '').trim(),
        invoiceDate: pickMergedString(cur.invoiceDate, inc.invoiceDate, allowClear),
        clientName: pickMergedString(cur.clientName, inc.clientName, allowClear),
        clientCompany: pickMergedString(cur.clientCompany, inc.clientCompany, allowClear),
        clientAddress: pickMergedString(cur.clientAddress, inc.clientAddress, allowClear),
        clientTIN: pickMergedString(cur.clientTIN, inc.clientTIN, allowClear),
        notes: pickMergedString(cur.notes, inc.notes, allowClear),
        invoiceItems: mergePackageItems(cur.invoiceItems, inc.invoiceItems, allowClear),
        customLineItems: pickMergedArray(cur.customLineItems, inc.customLineItems, allowClear),
        paymentMilestones: pickMergedArray(cur.paymentMilestones, inc.paymentMilestones, allowClear),
        paymentStructure,
        paymentTermsCustomized
    };

    // Sanitize compound-clause / contaminated names from Gemini or prior form state
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

    if (isContaminatedAddress(merged.clientAddress)) merged.clientAddress = '';

    if (Array.isArray(merged.customLineItems)) {
        merged.customLineItems = merged.customLineItems.filter(
            (line) => !/\bhours?\s+of\s+service\b/i.test(line?.name || '')
        );
    }

    if (Array.isArray(merged.invoiceItems) && merged.invoiceItems.length) {
        merged.invoiceItems = merged.invoiceItems.map((it) => {
            if (!it) return it;
            const next = { ...it };
            if (isContaminatedAddress(next.eventVenue)) next.eventVenue = '';
            if (!isWorkshopEventType(next.eventType) && !next.isWorkshop) {
                const slots = choiceSlotsForPackageType(next.packageType);
                next.choiceDrinks = normalizeChoiceDrinksList(
                    next.choiceDrinks,
                    slots,
                    !!next.coffeeAddOn
                );
                if (Array.isArray(next.additionalOptions)) {
                    next.additionalOptions = next.additionalOptions
                        .map((o) => String(o || '').trim())
                        .filter(Boolean);
                }
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
        invoice,
        geminiPatch: result.geminiPatch ?? result?.parsed?.geminiPatch ?? {},
        promptPreview: result.promptPreview || ''
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
    const bubble = container?.querySelector('.ai-chat-row.assistant:last-of-type .ai-chat-msg.assistant');

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
        aiDebug('geminiPatch (raw model output)', result.geminiPatch);
        aiDebug('invoice after server patch apply', result.invoice);
        aiDebug('assistantMessage', result.assistantMessage);

        const allowClear = userAskedToClearInvoice(text);
        const lastUser = [...aiChatMessages].reverse().find((m) => m.role === 'user');
        if (lastUser && result.promptPreview) {
            lastUser.promptPreview = String(result.promptPreview);
            // Keep only the latest prompt preview in memory (UI); older ones drop.
            aiChatMessages.forEach((m) => {
                if (m !== lastUser && m.promptPreview) delete m.promptPreview;
            });
        }
        const merged = mergeAiInvoice(current, result.invoice, { allowClear });
        aiDebug('merged invoice to apply', merged);
        aiDebug('allowClear', allowClear);

        restoreFromPayload(merged, _currentCloudDocId);
        saveToLocalStorage();
        updatePreview();

        const debugText = INVOICE_AI_DEBUG
            ? buildAiDebugCardText({
                assistantMessage: result.assistantMessage,
                geminiPatch: result.geminiPatch
            })
            : '';
        if (debugText) {
            aiDebug(debugText.replace(/\n/g, ' | '));
        }

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

        // Always show the model's reply — never rewrite it into third-person blame.
        const claim = String(result.assistantMessage || '').trim();
        let reply = claim;
        if (!reply) {
            reply = patchHasFields(result.geminiPatch) ? 'Updated.' : 'Nothing to change.';
        }

        aiChatBusy = false;
        if (sendBtn) sendBtn.disabled = false;
        renderAiChatMessages();
        await appendAssistantWithTypewriter(reply);
        if (debugText) {
            aiChatMessages.push({ role: 'debug', content: debugText });
            saveAiChatToStorage();
            renderAiChatMessages();
        }
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

// ─── Wire up app chrome ───────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
    setupStaffManualPaymentForm();
    document.getElementById('copyInvoiceLink')?.addEventListener('click', handleCopyInvoiceLink);
    document.getElementById('openInvoiceLink')?.addEventListener('click', handleOpenInvoiceLink);
    document.getElementById('addToCalendarBtn')?.addEventListener('click', () => {
        void promoteCurrentInvoiceToCalendar();
    });
    document.getElementById('archiveInvoiceBtn')?.addEventListener('click', () => {
        void archiveCurrentInvoice();
    });
    document.getElementById('emailInvoiceBtn')?.addEventListener('click', openEmailInvoiceModal);
    document.getElementById('emailInvoiceClose')?.addEventListener('click', closeEmailInvoiceModal);
    document.getElementById('emailInvoiceSend')?.addEventListener('click', handleEmailInvoiceSend);
    document.getElementById('emailInvoiceCopy')?.addEventListener('click', handleEmailInvoiceCopyMessage);
    document.getElementById('emailInvoiceEditToggle')?.addEventListener('click', () => {
        const subjectEl = document.getElementById('emailInvoiceSubject');
        const currentlyLocked = subjectEl?.readOnly !== false;
        setEmailComposeEditable(currentlyLocked);
        if (currentlyLocked) document.getElementById('emailInvoiceSubject')?.focus();
    });
    document.getElementById('emailInvoiceModal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeEmailInvoiceModal();
    });
    document.getElementById('emailInvoiceTo')?.addEventListener('change', () => {
        _clientEmail = String(document.getElementById('emailInvoiceTo')?.value || '').trim();
        saveToLocalStorage();
        scheduleCloudAutosave();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const modal = document.getElementById('emailInvoiceModal');
        if (modal && !modal.hidden) closeEmailInvoiceModal();
    });
    document.getElementById('backToListBtn')?.addEventListener('click', async () => {
        showScreen('list');
        await refreshInvoiceList();
    });
    document.getElementById('newInvoiceBtn')?.addEventListener('click', () => startNewInvoice());
    document.getElementById('refreshListBtn')?.addEventListener('click', () => refreshInvoiceList());
    document.getElementById('listSearchInput')?.addEventListener('input', function() {
        renderInvoiceList(filterListInvoices(this.value));
    });
    document.getElementById('invoiceList')?.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('[data-action="copy"], [data-action="open"], [data-action="archive"]');
        const card = e.target.closest('.invoice-list-card[data-id]');
        if (!card) return;
        const id = card.dataset.id;
        const inv = _allCloudInvoices.find((row) => row.id === id);

        if (actionBtn) {
            e.preventDefault();
            e.stopPropagation();
            const action = actionBtn.dataset.action;
            if (action === 'open') {
                const url = actionBtn.dataset.url;
                if (url) window.open(url, '_blank', 'noopener');
                return;
            }
            if (action === 'archive' && inv) {
                const label = clientListLabel(inv) || inv.invoiceNumber || 'this invoice';
                if (!confirm(`Archive ${label}?`)) return;
                try {
                    const { archiveInvoice } = await import('../shared/js/ops-events.js?v=18');
                    const { db, firestoreFns } = await getOpsPromoteContext();
                    await archiveInvoice(db, firestoreFns, inv.id, { updatedBy: 'invoice-generator' });
                    _allCloudInvoices = (_allCloudInvoices || []).filter((row) => row.id !== inv.id);
                    renderInvoiceList(filterListInvoices(document.getElementById('listSearchInput')?.value || ''));
                } catch (err) {
                    console.error(err);
                    alert(err.message || 'Could not archive invoice.');
                }
                return;
            }
            if (action === 'copy' && inv) {
                try {
                    actionBtn.disabled = true;
                    actionBtn.classList.add('is-busy');
                    if (!inv.publicToken) inv.publicToken = generatePublicToken();
                    inv.shareStatus = 'published';
                    if (!inv.publishedAt) inv.publishedAt = new Date().toISOString();
                    const db = await getFirebaseDb();
                    const { doc, updateDoc } = _firebaseModules;
                    await updateDoc(doc(db, 'invoice-generator', inv.id), {
                        publicToken: inv.publicToken,
                        shareStatus: 'published',
                        publishedAt: inv.publishedAt,
                        savedAt: new Date().toISOString()
                    });
                    const url = publicInvoiceUrl(inv.publicToken);
                    await navigator.clipboard.writeText(url);
                    actionBtn.classList.remove('is-busy');
                    actionBtn.classList.add('is-copied');
                    actionBtn.title = 'Copied';
                    setTimeout(() => {
                        actionBtn.classList.remove('is-copied');
                        actionBtn.title = 'Copy customer link';
                        actionBtn.disabled = false;
                    }, 1400);
                    renderInvoiceList(filterListInvoices(document.getElementById('listSearchInput')?.value || ''));
                } catch (err) {
                    console.error(err);
                    actionBtn.classList.remove('is-busy');
                    actionBtn.disabled = false;
                    alert('Could not copy link');
                }
            }
            return;
        }

        if (inv) openInvoiceInEditor(inv);
    });

    document.getElementById('invoiceList')?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.invoice-list-card[data-id]');
        if (!card || e.target.closest('button')) return;
        e.preventDefault();
        const inv = _allCloudInvoices.find((row) => row.id === card.dataset.id);
        if (inv) openInvoiceInEditor(inv);
    });

    // Legacy modal stubs (page keeps hidden nodes so shared helpers stay safe)
    document.getElementById('loadFromCloud')?.addEventListener('click', openLoadModal);
    document.getElementById('closeCloudModal')?.addEventListener('click', closeLoadModal);
    document.getElementById('invoiceSearchInput')?.addEventListener('input', function() {
        renderInvoiceCards(filterInvoices(this.value));
    });
    document.getElementById('cloudModal')?.addEventListener('click', function(e) {
        if (e.target === this) closeLoadModal();
    });
});

function initInvoicePage() {
    const today = new Date();

    // Prepare a blank editor form; list is the default screen.
    document.getElementById('invoiceDate').valueAsDate = today;
    document.getElementById('invoiceNumber').value = nextInvoiceNumberForDate(today);
    addDefaultPaymentMilestones();

    setupEventListeners();
    setupPackageListListeners();
    document.getElementById('addPackageBtn').addEventListener('click', addPackage);
    setupAiChatUi();

    renderInvoiceItems();
    renderCustomLineItems();
    const total = calculateTotal();
    updatePaymentMilestones(total);
    renderPaymentMilestones();
    updatePreview();
    updateShareBar();
    _editorReady = true;

    const resumeId = getInvoiceIdFromUrl();
    const resumeNew = new URLSearchParams(window.location.search).get('new') === '1';

    if (resumeId || resumeNew) {
        refreshInvoiceList().then(async () => {
            if (resumeId) {
                let inv = _allCloudInvoices.find((row) => row.id === resumeId) || null;
                if (!inv) {
                    try {
                        inv = await fetchCloudInvoiceById(resumeId);
                    } catch (err) {
                        console.warn('Could not load invoice from URL', err);
                    }
                }
                if (inv) {
                    openInvoiceInEditor(inv);
                    return;
                }
                showScreen('list');
                return;
            }
            await startNewInvoice();
        });
        return;
    }

    showScreen('list');
    refreshInvoiceList().then(() => {
        if (!_currentCloudDocId) {
            const dateVal = document.getElementById('invoiceDate').value || today;
            document.getElementById('invoiceNumber').value = nextInvoiceNumberForDate(dateVal);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initInvoicePage);
} else {
    initInvoicePage();
}
