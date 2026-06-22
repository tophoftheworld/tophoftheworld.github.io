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

async function getFirebaseDb() {
    if (_firebaseDb) return _firebaseDb;
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js');
    const { getFirestore, collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, orderBy } =
        await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');

    const apps = getApps();
    const app = apps.find(a => a.name === 'invoice-gen') ||
        initializeApp(FIREBASE_CONFIG, 'invoice-gen');
    _firebaseDb = getFirestore(app);
    _firebaseModules = { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, query, orderBy };
    return _firebaseDb;
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
    'Two rounds of hands-on matcha making\n(one cup + one bottled drink to take home)',
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
    if (!migrated.packageType && migrated.eventType === EVENT_TYPES.mobile_bar && migrated.description) {
        for (const [key, pkg] of Object.entries(packages)) {
            if (pkg.name === migrated.description) {
                migrated.packageType = key;
                break;
            }
        }
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

// Initialize dates
document.addEventListener('DOMContentLoaded', function() {
    const today = new Date();
    
    // Try to load from localStorage first
    const loaded = loadFromLocalStorage();
    
    if (!loaded) {
        // Set defaults if no saved data
        document.getElementById('invoiceDate').valueAsDate = today;

        // Generate default invoice number
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        document.getElementById('invoiceNumber').value = `INV-${year}-${month}${day}-001`;

        // Add default payment milestones
        addDefaultPaymentMilestones();
    }

    // Set up event listeners
    setupEventListeners();
    setupPackageListListeners();
    document.getElementById('addPackageBtn').addEventListener('click', addPackage);

    if (customLineItems.length > 0) {
        renderCustomLineItems();
    }
    
    renderInvoiceItems();
    
    // Calculate initial milestone dates based on event date
    const total = calculateTotal();
    updatePaymentMilestones(total);
    renderPaymentMilestones();
    
    // Initial preview update
    updatePreview();
});

// Package data structure
const packages = {
    starter: {
        name: 'Mobile Matcha Bar - STARTER PACKAGE',
        menuItems: ['Matchanese Tea', 'Signature Matchanese Latte', 'Strawberry Matchanese Latte', 'Hojicha Latte'],
        additionalOptions: ['Iced (12oz) or Hot (8oz) Drinks', 'Dairy or Oat Milk'],
        otherInclusions: ['Mobile Matcha Bar Setup', 'Transportation & Logistics Costs'],
        rates: {
            50: 13500,
            100: 22500,
            150: 31500
        }
    },
    signature: {
        name: 'Mobile Matcha Bar - SIGNATURE PACKAGE',
        menuItems: ['Matchanese Tea', 'Signature Matchanese Latte', 'Strawberry Matchanese Latte', 'Hojicha Latte', 'Matchanese Seasalt Latte', 'Spanish Matchanese Latte', 'Matchanese Sunrise', 'Matchanese Coconut', 'Drink of Choice'],
        additionalOptions: ['Iced (12oz) or Hot (8oz) Drinks', 'Dairy or Oat Milk'],
        otherInclusions: ['Mobile Matcha Bar Setup', 'Transportation & Logistics Costs'],
        rates: {
            50: 14750,
            100: 25750,
            150: 36750
        }
    },
    special: {
        name: 'Mobile Matcha Bar - SPECIAL PACKAGE',
        menuItems: ['Matchanese Tea', 'Signature Matchanese Latte', 'Strawberry Matchanese Latte', 'Hojicha Latte', 'Matchanese Seasalt Latte', 'Spanish Matchanese Latte', 'Matchanese Sunrise', 'Matchanese Coconut', 'Americano', 'Kyoto Latte', 'Spanish Latte', 'Matchanese Espresso', 'Drink of Choice'],
        additionalOptions: ['Iced (12oz) or Hot (8oz) Drinks', 'Dairy or Oat Milk'],
        otherInclusions: ['Mobile Matcha Bar Setup', 'Transportation & Logistics Costs'],
        rates: {
            50: 16500,
            100: 28500,
            150: 41500
        }
    }
};

// Invoice items array
let invoiceItems = [];
let paymentMilestones = [];
let customLineItems = [];

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
        additionalOptions: [],
        otherInclusions: [],
        duration: '',
        baristas: '',
        unitPrice: 0,
        packageType: '',
        numberOfPax: ''
    };
}

function syncWorkshopItem(item) {
    item.isWorkshop = true;
    item.countLabel = 'participants';
    item.description = WORKSHOP_TITLES[item.eventType] || '';
    item.workshopInclusions = getWorkshopInclusions(item.eventType);
    const pax = parseInt(item.cups, 10) || 0;
    item.quantity = pax;
    const unitCost = parseFloat(item.unitCost) || 0;
    item.unitPrice = pax > 0 && unitCost > 0 ? pax * unitCost : 0;
}

function syncMobileItem(item) {
    item.isWorkshop = false;
    item.countLabel = 'cups';
    if (!item.packageType || item.packageType === 'custom' || !item.numberOfPax) {
        item.description = '';
        item.unitPrice = 0;
        return;
    }
    const packageData = packages[item.packageType];
    if (!packageData) return;
    const price = packageData.rates[item.numberOfPax] || 0;
    item.description = packageData.name;
    item.cups = `${item.numberOfPax} Cups`;
    item.menuItems = [...packageData.menuItems];
    item.additionalOptions = [...packageData.additionalOptions];
    item.otherInclusions = [...packageData.otherInclusions];
    item.duration = 'Maximum 3 Hours Total Duration';
    item.baristas = '4 On-Site Baristas';
    item.unitPrice = price;
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

function isPackageVisibleInPreview(item) {
    if (isWorkshopItem(item)) {
        const pax = parseInt(item.cups, 10) || 0;
        const unitCost = parseFloat(item.unitCost) || 0;
        return pax > 0 && unitCost > 0;
    }
    return !!(item.packageType && item.packageType !== 'custom' && item.numberOfPax);
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

function renderPackageFormFields(item, index) {
    const isWorkshop = isWorkshopEventType(item.eventType);
    const cupsVal = item.numberOfPax || (String(item.cups || '').match(/\d+/) || [])[0] || '';
    const paxVal = isWorkshop ? (item.cups || '') : '';
    const perPaxVal = item.unitCost != null && item.unitCost !== '' ? item.unitCost : '';

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
                        <option value="50" ${cupsVal === '50' ? 'selected' : ''}>50 cups</option>
                        <option value="100" ${cupsVal === '100' ? 'selected' : ''}>100 cups</option>
                        <option value="150" ${cupsVal === '150' ? 'selected' : ''}>150 cups</option>
                    </select>
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
                    <label>Additional Details (optional, markdown)</label>
                    <textarea class="pkg-workshop-details" data-id="${item.id}" rows="3" placeholder="Extra notes only — matcha workshop inclusions are added automatically"></textarea>
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
            syncPackageItem(item);
        } else if (el.classList.contains('pkg-package-type')) {
            item.packageType = el.value;
            syncMobileItem(item);
        } else if (el.classList.contains('pkg-number-of-pax')) {
            item.numberOfPax = el.value;
            syncMobileItem(item);
        } else if (el.classList.contains('pkg-date')) {
            item.eventDate = el.value;
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

// Add default payment milestones
function addDefaultPaymentMilestones() {
    paymentMilestones = [];
    
    // Date Reservation - 25%
    paymentMilestones.push({
        id: Date.now(),
        milestone: 'Date Reservation',
        date: '',
        percentage: 25,
        amount: 0
    });
    
    // Pre-Event - 25%
    paymentMilestones.push({
        id: Date.now() + 1,
        milestone: 'Pre-Event',
        date: '',
        percentage: 25,
        amount: 0
    });
    
    // Event Completion - 50%
    paymentMilestones.push({
        id: Date.now() + 2,
        milestone: 'Event Completion',
        date: '',
        percentage: 50,
        amount: 0
    });

    renderPaymentMilestones();
    updatePreview();
}

// Add payment milestone
function addPaymentMilestone() {
    const milestoneId = Date.now();
    paymentMilestones.push({
        id: milestoneId,
        milestone: '',
        date: '',
        percentage: 0,
        amount: 0
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

// Render payment milestones in form
function renderPaymentMilestones() {
    const container = document.getElementById('paymentMilestones');
    container.innerHTML = '';

    paymentMilestones.forEach((milestone, index) => {
        const milestoneDiv = document.createElement('div');
        milestoneDiv.className = 'payment-milestone';
        milestoneDiv.innerHTML = `
            <div class="payment-milestone-header">
                <h3>Milestone ${index + 1}</h3>
            </div>
            <div class="item-row">
                <div>
                    <label>Milestone Name:</label>
                    <input type="text" class="milestone-name" data-id="${milestone.id}" 
                        placeholder="e.g., Date Reservation" value="${milestone.milestone}" readonly disabled>
                </div>
                <div>
                    <label>Date:</label>
                    <input type="date" class="milestone-date" data-id="${milestone.id}" value="${milestone.date}" readonly disabled>
                </div>
            </div>
            <div class="item-row">
                <div>
                    <label>Percentage (%):</label>
                    <input type="number" class="milestone-percentage" data-id="${milestone.id}" 
                        min="0" max="100" step="0.01" value="${milestone.percentage}" readonly disabled>
                </div>
                <div>
                    <label>Amount (₱):</label>
                    <input type="number" class="milestone-amount" data-id="${milestone.id}" 
                        min="0" step="0.01" value="${milestone.amount}" readonly disabled>
                </div>
            </div>
        `;
        container.appendChild(milestoneDiv);
    });

    // Event listeners removed - fields are now read-only and auto-calculated
}

// Calculate total
function calculateTotal() {
    const packageTotal = invoiceItems.reduce((sum, item) => sum + getInvoiceItemPricing(item).subtotal, 0);
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

    let html = '<div class="package-details-visual">';
    
    // Two-column layout
    html += '<div class="package-details-columns">';
    
    // Left column: Menu
    html += '<div class="package-column-left">';
    if (item.menuItems && item.menuItems.length > 0 && item.menuItems.some(m => m.trim())) {
        html += '<div class="package-section">';
        html += '<div class="package-section-label">Menu:</div>';
        html += '<div class="package-section-list">';
        item.menuItems.forEach(menuItem => {
            if (menuItem.trim()) {
                html += `<div class="package-list-item">${escapeHtml(menuItem)}</div>`;
            }
        });
        html += '</div></div>';
    }
    html += '</div>'; // end left column
    
    // Right column: Cups and Additional Details
    html += '<div class="package-column-right">';
    
    html += renderCountSection(item);
    
    // Additional Options - separate section
    if (item.additionalOptions && item.additionalOptions.length > 0 && item.additionalOptions.some(o => o.trim())) {
        html += '<div class="package-section">';
        html += '<div class="package-section-label">Additional Options:</div>';
        html += '<div class="package-section-list">';
        item.additionalOptions.forEach(option => {
            if (option.trim()) {
                html += `<div class="package-list-item">${escapeHtml(option)}</div>`;
            }
        });
        html += '</div></div>';
    }
    
    // Additional Details section (includes duration, baristas, and other inclusions)
    const allInclusions = [];
    
    if (item.duration) {
        allInclusions.push(item.duration);
    }
    if (item.baristas) {
        allInclusions.push(item.baristas);
    }
    
    if (item.otherInclusions && item.otherInclusions.length > 0) {
        item.otherInclusions.forEach(inclusion => {
            if (inclusion.trim()) {
                allInclusions.push(inclusion);
            }
        });
    }
    
    if (allInclusions.length > 0) {
        html += '<div class="package-section">';
        html += '<div class="package-section-label">Additional Details:</div>';
        html += '<div class="package-section-list">';
        allInclusions.forEach(inclusion => {
            html += `<div class="package-list-item">${escapeHtml(inclusion)}</div>`;
        });
        html += '</div></div>';
    }
    
    html += '</div>'; // end right column
    html += '</div>'; // end columns container
    html += '</div>'; // end package-details-visual
    return html;
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
            const venue = item.eventVenue || '';
            const eventDate = item.eventDate || '';
            const venueInfo = venue ? `<div class="event-details"><strong>Venue:</strong> ${escapeHtml(venue)}</div>` : '';
            const dateInfo = eventDate ? `<div class="event-details"><strong>Date:</strong> ${formatDate(eventDate)}</div>` : '';
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="col-description">
                    <div class="package-name">${escapeHtml(item.description)}</div>
                    ${packageDetails}
                    ${venueInfo}
                    ${dateInfo}
                </td>
                ${renderPricingCells(unitCost, qty, subtotal)}
            `;
            itemsContainer.appendChild(row);
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

// Update payment milestones
function updatePaymentMilestones(total) {
    const container = document.getElementById('displayPaymentMilestones');
    container.innerHTML = '';

    // Auto-calculate dates and amounts
    const eventDate = getInvoiceEventDate();
    const milestoneDates = calculateMilestoneDates(eventDate);
    
    // Find reservation and pre-event milestones
    const reservationMilestone = paymentMilestones.find(m => 
        m.milestone.toLowerCase().includes('reservation')
    );
    const preEventMilestone = paymentMilestones.find(m => 
        m.milestone.toLowerCase().includes('pre-event') || m.milestone.toLowerCase().includes('pre event')
    );
    
    // Store original percentages if not already stored (only on first run)
    if (preEventMilestone && preEventMilestone._originalPercentage === undefined) {
        preEventMilestone._originalPercentage = preEventMilestone.percentage || 25;
    }
    if (reservationMilestone && reservationMilestone._originalPercentage === undefined) {
        reservationMilestone._originalPercentage = reservationMilestone.percentage || 25;
    }
    
    // If event is less than 2 weeks away, merge pre-event into reservation
    if (!milestoneDates.hasPreEvent && preEventMilestone && reservationMilestone) {
        // Only merge if pre-event still has percentage (not already merged)
        if (preEventMilestone.percentage > 0) {
            reservationMilestone.percentage = (reservationMilestone.percentage || 0) + (preEventMilestone.percentage || 0);
            preEventMilestone.percentage = 0;
            preEventMilestone.amount = 0;
        }
    } else if (milestoneDates.hasPreEvent && preEventMilestone && reservationMilestone) {
        // Restore original percentages when event is 2+ weeks away
        if (preEventMilestone.percentage === 0 && preEventMilestone._originalPercentage !== undefined) {
            // Check if reservation has merged percentage (more than original)
            const expectedReservation = reservationMilestone._originalPercentage || 25;
            if (reservationMilestone.percentage > expectedReservation) {
                // Restore both to original values
                reservationMilestone.percentage = expectedReservation;
                preEventMilestone.percentage = preEventMilestone._originalPercentage || 25;
            }
        }
    }
    
    // Update all milestones
    paymentMilestones.forEach(milestone => {
        // Auto-calculate dates based on milestone name (always update if event date exists)
        if (eventDate) {
            const milestoneName = milestone.milestone.toLowerCase();
            if (milestoneName.includes('reservation')) {
                milestone.date = milestoneDates.reservation || '';
            } else if (milestoneName.includes('pre-event') || milestoneName.includes('pre event')) {
                milestone.date = milestoneDates.preEvent || '';
            } else if (milestoneName.includes('completion') || milestoneName.includes('event completion')) {
                milestone.date = milestoneDates.completion || '';
            }
        }
        
        // Auto-calculate amount based on percentage
        if (milestone.percentage > 0) {
            milestone.amount = (total * milestone.percentage / 100);
        } else {
            milestone.amount = 0;
        }
    });
    
    // Update form inputs with calculated values
    paymentMilestones.forEach(milestone => {
        const amountInput = document.querySelector(`.payment-milestone input.milestone-amount[data-id="${milestone.id}"]`);
        if (amountInput) {
            amountInput.value = milestone.amount > 0 ? milestone.amount.toFixed(2) : '';
        }
        
        const percentageInput = document.querySelector(`.payment-milestone input.milestone-percentage[data-id="${milestone.id}"]`);
        if (percentageInput) {
            percentageInput.value = milestone.percentage > 0 ? milestone.percentage : '';
        }
        
        const dateInput = document.querySelector(`.payment-milestone input.milestone-date[data-id="${milestone.id}"]`);
        if (dateInput && milestone.date) {
            dateInput.value = milestone.date;
        }
    });

    // Filter out milestones with 0 percentage (like pre-event when merged)
    const activeMilestones = paymentMilestones.filter(m => 
        m.milestone && m.percentage > 0
    );
    
    if (activeMilestones.length === 0) {
        container.innerHTML = '<tr><td colspan="4" class="empty-state">No payment milestones added</td></tr>';
    } else {
        activeMilestones.forEach(milestone => {
            const row = document.createElement('tr');
            const dateStr = milestone.date ? formatDate(milestone.date) : '-';
            const percentageStr = milestone.percentage > 0 ? `${milestone.percentage}%` : '-';
            const amountStr = milestone.amount > 0 ? `Php ${formatCurrency(milestone.amount)}` : '-';
            
            // Highlight Date Reservation milestone only (yellow background for immediate payment)
            const milestoneName = milestone.milestone.toLowerCase();
            const highlightClass = milestoneName.includes('reservation') ? 'highlight-amount' : '';
            
            row.innerHTML = `
                <td>${escapeHtml(milestone.milestone)}</td>
                <td>${dateStr}</td>
                <td>${percentageStr}</td>
                <td class="${highlightClass}">${amountStr}</td>
            `;
            container.appendChild(row);
        });
    }
}

// Setup event listeners
function setupEventListeners() {
    // Add milestone button
    document.getElementById('addMilestoneBtn').addEventListener('click', addPaymentMilestone);

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

    // Add custom line item button
    document.getElementById('addLineItemBtn').addEventListener('click', addCustomLineItem);

    // Download PDF
    document.getElementById('downloadPDF').addEventListener('click', downloadPDF);

    // New invoice (clear form + local storage)
    document.getElementById('clearForm').addEventListener('click', function() {
        clearForm();
        localStorage.removeItem('invoiceGeneratorData');
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
function prepareElementForPdfCapture(element) {
    element.classList.add('pdf-capture');
    return function restoreElementAfterPdfCapture() {
        element.classList.remove('pdf-capture');
    };
}

async function captureElementCanvas(element) {
    return html2canvas(element, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        scrollX: 0,
        scrollY: -window.scrollY,
        width: element.scrollWidth,
        height: element.scrollHeight,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight
    });
}

function appendCanvasToPdf(pdf, canvas, { startNewPage = false } = {}) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgData = canvas.toDataURL('image/jpeg', 0.85);
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;
    let sliceIndex = 0;

    while (heightLeft > 0.5) {
        if (startNewPage || sliceIndex > 0) {
            pdf.addPage();
        }
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
        position -= pageHeight;
        sliceIndex += 1;
        startNewPage = false;
    }
}

async function downloadPDF() {
    const invoiceElement = document.getElementById('invoice');
    const paymentTermsElement = document.getElementById('paymentTermsPage');
    
    // Show loading state
    const downloadBtn = document.getElementById('downloadPDF');
    const originalText = downloadBtn.textContent;
    downloadBtn.textContent = 'Generating PDF...';
    downloadBtn.disabled = true;

    const restoreInvoice = prepareElementForPdfCapture(invoiceElement);
    const restorePaymentTerms = paymentTermsElement
        ? prepareElementForPdfCapture(paymentTermsElement)
        : null;

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
        restoreInvoice();
        if (restorePaymentTerms) restorePaymentTerms();
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
        totalAmount: total,
        savedAt: new Date().toISOString()
    };
}

function restoreFromPayload(data, docId) {
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

    renderInvoiceItems();
    renderCustomLineItems();
    renderPaymentMilestones();
    updatePreview();
    updateSaveButtonLabel();
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