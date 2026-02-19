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

// ─── LocalStorage Functions ───────────────────────────────────────────────────
function saveToLocalStorage() {
    const data = {
        invoiceNumber: document.getElementById('invoiceNumber').value,
        invoiceDate: document.getElementById('invoiceDate').value,
        clientName: document.getElementById('clientName').value,
        clientAddress: document.getElementById('clientAddress').value,
        clientTIN: document.getElementById('clientTIN').value,
        eventVenue: document.getElementById('eventVenue').value,
        eventDate: document.getElementById('eventDate').value,
        packageType: document.getElementById('packageType').value,
        numberOfPax: document.getElementById('numberOfPax').value,
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
        if (data.eventVenue) document.getElementById('eventVenue').value = data.eventVenue;
        if (data.eventDate) document.getElementById('eventDate').value = data.eventDate;
        if (data.packageType) document.getElementById('packageType').value = data.packageType;
        if (data.numberOfPax) document.getElementById('numberOfPax').value = data.numberOfPax;
        if (data.notes) document.getElementById('notes').value = data.notes;
        
        if (data.invoiceItems) invoiceItems = data.invoiceItems;
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
        document.getElementById('eventDate').valueAsDate = today;

        // Generate default invoice number
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        document.getElementById('invoiceNumber').value = `INV-${year}-${month}${day}-001`;

        // Set default package and pax
        document.getElementById('packageType').value = 'signature';
        document.getElementById('numberOfPax').value = '100';

        // Add default payment milestones
        addDefaultPaymentMilestones();
    }
    
    // Render custom line items if loaded
    if (customLineItems.length > 0) {
        renderCustomLineItems();
    }

    // Set up event listeners
    setupEventListeners();
    
    // Set up package dropdown listeners
    document.getElementById('packageType').addEventListener('change', function() {
        updatePackageFromDropdowns();
        saveToLocalStorage();
    });
    document.getElementById('numberOfPax').addEventListener('change', function() {
        updatePackageFromDropdowns();
        saveToLocalStorage();
    });
    
    // Initialize package details
    updatePackageFromDropdowns();
    
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

// Update package when dropdowns change
function updatePackageFromDropdowns() {
    const packageType = document.getElementById('packageType').value;
    const numberOfPax = document.getElementById('numberOfPax').value;
    
    if (!packageType || !numberOfPax) {
        invoiceItems = [];
        renderInvoiceItems();
        updatePreview();
        return;
    }
    
    const packageData = packages[packageType];
    const price = packageData.rates[numberOfPax] || 0;
    
    // Clear existing items and add new one
    invoiceItems = [{
        id: Date.now(),
        description: packageData.name,
        cups: `${numberOfPax} Cups`,
        menuItems: [...packageData.menuItems],
        additionalOptions: [...packageData.additionalOptions],
        otherInclusions: [...packageData.otherInclusions],
        duration: 'Maximum 3 Hours Total Duration',
        baristas: '4 On-Site Baristas',
        unitPrice: price
    }];
    
    renderInvoiceItems();
    updatePreview();
    saveToLocalStorage();
}

// Remove invoice item
function removeInvoiceItem(itemId) {
    invoiceItems = invoiceItems.filter(item => item.id !== itemId);
    renderInvoiceItems();
    updatePreview();
    saveToLocalStorage();
}

// Render invoice items in form (for manual editing if needed)
function renderInvoiceItems() {
    const container = document.getElementById('invoiceItems');
    container.innerHTML = '';

    if (invoiceItems.length === 0) {
        container.innerHTML = '<p style="color: #666; font-size: 0.875rem; margin-top: 1rem;">Select a package and number of cups above</p>';
        return;
    }

    invoiceItems.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'invoice-item';
        
        // Build menu items HTML
        const menuItemsHtml = (item.menuItems || []).map((menuItem, idx) => `
            <div class="menu-item-row" style="display: flex; gap: 0.5rem; margin-bottom: 0.25rem;">
                <input type="text" class="menu-item-input" data-id="${item.id}" data-index="${idx}" 
                    placeholder="Menu item" value="${menuItem}" style="flex: 1;">
                <button type="button" class="remove-menu-item-btn" onclick="removeMenuItem(${item.id}, ${idx})" 
                    style="background: #e63946; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer;">×</button>
            </div>
        `).join('');
        
        // Build additional options HTML
        const optionsHtml = (item.additionalOptions || []).map((option, idx) => `
            <div class="option-item-row" style="display: flex; gap: 0.5rem; margin-bottom: 0.25rem;">
                <input type="text" class="option-item-input" data-id="${item.id}" data-index="${idx}" 
                    placeholder="Option" value="${option}" style="flex: 1;">
                <button type="button" class="remove-option-btn" onclick="removeOption(${item.id}, ${idx})" 
                    style="background: #e63946; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer;">×</button>
            </div>
        `).join('');
        
        // Build other inclusions HTML
        const inclusionsHtml = (item.otherInclusions || []).map((inclusion, idx) => `
            <div class="inclusion-item-row" style="display: flex; gap: 0.5rem; margin-bottom: 0.25rem;">
                <input type="text" class="inclusion-item-input" data-id="${item.id}" data-index="${idx}" 
                    placeholder="Inclusion" value="${inclusion}" style="flex: 1;">
                <button type="button" class="remove-inclusion-btn" onclick="removeInclusion(${item.id}, ${idx})" 
                    style="background: #e63946; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer;">×</button>
            </div>
        `).join('');
        
        itemDiv.innerHTML = `
            <div class="invoice-item-header">
                <h3>Item ${index + 1}</h3>
                <button type="button" class="remove-item-btn" onclick="removeInvoiceItem(${item.id})">Remove</button>
            </div>
            <div class="item-row full-width">
                <label>Package Name / Description:</label>
                <input type="text" class="item-description" data-id="${item.id}" 
                    placeholder="e.g., Mobile Matcha Bar - STARTER PACKAGE" value="${item.description}">
            </div>
            <div class="item-row">
                <div>
                    <label>Number of Cups:</label>
                    <input type="text" class="item-cups" data-id="${item.id}" 
                        placeholder="e.g., 150 Cups" value="${item.cups || ''}">
                </div>
                <div>
                    <label>Duration:</label>
                    <input type="text" class="item-duration" data-id="${item.id}" 
                        placeholder="e.g., Maximum 3 Hours" value="${item.duration || ''}">
                </div>
            </div>
            <div class="item-row">
                <div>
                    <label>Number of Baristas:</label>
                    <input type="text" class="item-baristas" data-id="${item.id}" 
                        placeholder="e.g., 4 On-Site Baristas" value="${item.baristas || ''}">
                </div>
                <div>
                    <label>Total Price (₱):</label>
                    <input type="number" class="item-price" data-id="${item.id}" 
                        min="0" step="0.01" value="${item.unitPrice}">
                </div>
            </div>
            <div class="item-row full-width">
                <label>Menu Items:</label>
                <div class="menu-items-container" data-id="${item.id}">
                    ${menuItemsHtml}
                    <button type="button" class="add-menu-item-btn" onclick="addMenuItem(${item.id})" 
                        style="background: #2b9348; color: white; border: none; padding: 0.5rem; border-radius: 4px; cursor: pointer; margin-top: 0.5rem;">+ Add Menu Item</button>
                </div>
            </div>
            <div class="item-row full-width">
                <label>Additional Options:</label>
                <div class="options-container" data-id="${item.id}">
                    ${optionsHtml}
                    <button type="button" class="add-option-btn" onclick="addOption(${item.id})" 
                        style="background: #2b9348; color: white; border: none; padding: 0.5rem; border-radius: 4px; cursor: pointer; margin-top: 0.5rem;">+ Add Option</button>
                </div>
            </div>
            <div class="item-row full-width">
                <label>Other Inclusions:</label>
                <div class="inclusions-container" data-id="${item.id}">
                    ${inclusionsHtml}
                    <button type="button" class="add-inclusion-btn" onclick="addInclusion(${item.id})" 
                        style="background: #2b9348; color: white; border: none; padding: 0.5rem; border-radius: 4px; cursor: pointer; margin-top: 0.5rem;">+ Add Inclusion</button>
                </div>
            </div>
        `;
        container.appendChild(itemDiv);
    });

    // Add event listeners
    setupItemEventListeners();
}

// Setup event listeners for all item inputs
function setupItemEventListeners() {
    const container = document.getElementById('invoiceItems');
    
    container.querySelectorAll('.item-description, .item-price, .item-cups, .item-duration, .item-baristas').forEach(input => {
        input.addEventListener('input', function() {
            const id = parseInt(this.dataset.id);
            const item = invoiceItems.find(i => i.id === id);
            if (item) {
                if (this.classList.contains('item-description')) {
                    item.description = this.value;
                } else if (this.classList.contains('item-price')) {
                    item.unitPrice = parseFloat(this.value) || 0;
                } else if (this.classList.contains('item-cups')) {
                    item.cups = this.value;
                } else if (this.classList.contains('item-duration')) {
                    item.duration = this.value;
                } else if (this.classList.contains('item-baristas')) {
                    item.baristas = this.value;
                }
                updatePreview();
            }
        });
    });
    
    // Menu items
    container.querySelectorAll('.menu-item-input').forEach(input => {
        input.addEventListener('input', function() {
            const id = parseInt(this.dataset.id);
            const index = parseInt(this.dataset.index);
            const item = invoiceItems.find(i => i.id === id);
            if (item) {
                if (!item.menuItems) item.menuItems = [];
                item.menuItems[index] = this.value;
                updatePreview();
            }
        });
    });
    
    // Options
    container.querySelectorAll('.option-item-input').forEach(input => {
        input.addEventListener('input', function() {
            const id = parseInt(this.dataset.id);
            const index = parseInt(this.dataset.index);
            const item = invoiceItems.find(i => i.id === id);
            if (item) {
                if (!item.additionalOptions) item.additionalOptions = [];
                item.additionalOptions[index] = this.value;
                updatePreview();
            }
        });
    });
    
    // Inclusions
    container.querySelectorAll('.inclusion-item-input').forEach(input => {
        input.addEventListener('input', function() {
            const id = parseInt(this.dataset.id);
            const index = parseInt(this.dataset.index);
            const item = invoiceItems.find(i => i.id === id);
            if (item) {
                if (!item.otherInclusions) item.otherInclusions = [];
                item.otherInclusions[index] = this.value;
                updatePreview();
            }
        });
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
    const packageTotal = invoiceItems.reduce((sum, item) => sum + (item.unitPrice || 0), 0);
    const customTotal = customLineItems.reduce((sum, item) => sum + ((item.quantity || 0) * (item.price || 0)), 0);
    return packageTotal + customTotal;
}

// Custom Line Items Functions
function addCustomLineItem() {
    const newItem = {
        id: Date.now(),
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
                <label style="display: block; font-size: 0.8125rem; font-weight: 500; color: #666; margin-bottom: 0.25rem;">Description:</label>
                <input type="text" class="line-item-description" data-id="${item.id}" 
                    placeholder="e.g., Additional Equipment" value="${escapeHtml(item.description)}"
                    style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.875rem;">
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
        container.appendChild(itemDiv);
    });
    
    // Add event listeners
    container.querySelectorAll('.line-item-description, .line-item-quantity, .line-item-price').forEach(input => {
        input.addEventListener('input', function() {
            const id = parseInt(this.dataset.id);
            const item = customLineItems.find(i => i.id === id);
            if (item) {
                if (this.classList.contains('line-item-description')) {
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

// Format package details in organized, easy-to-read format
function formatPackageDetails(item) {
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
    
    // Cups
    if (item.cups) {
        html += `<div class="package-section">
            <span class="package-section-label">Cups:</span>
            <span class="package-section-value">${escapeHtml(item.cups)}</span>
        </div>`;
    }
    
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
    
    // Add duration and baristas to inclusions
    if (item.duration) {
        allInclusions.push(item.duration);
    }
    if (item.baristas) {
        allInclusions.push(item.baristas);
    }
    
    // Add other inclusions
    if (item.otherInclusions && item.otherInclusions.length > 0) {
        item.otherInclusions.forEach(inclusion => {
            if (inclusion.trim()) {
                allInclusions.push(inclusion);
            }
        });
    }
    
    // Additional Details section
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
    const venue = document.getElementById('eventVenue').value;
    const eventDate = document.getElementById('eventDate').value;

    // Add package items
    if (invoiceItems.length > 0 && !invoiceItems.every(item => !item.description)) {
        invoiceItems.forEach(item => {
            if (!item.description) return;

            const unitPrice = item.unitPrice || 0;
            total += unitPrice;

            const packageDetails = formatPackageDetails(item);
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
                <td class="col-subtotal text-right">Php ${formatCurrency(unitPrice)}</td>
            `;
            itemsContainer.appendChild(row);
        });
    }

    // Add custom line items
    customLineItems.forEach(item => {
        if (!item.description) return;
        
        const quantity = item.quantity || 0;
        const price = item.price || 0;
        const subtotal = quantity * price;
        total += subtotal;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="col-description">
                <div class="package-name">${escapeHtml(item.description)}</div>
                ${quantity > 1 ? `<div class="event-details"><strong>Quantity:</strong> ${quantity}</div>` : ''}
            </td>
            <td class="col-subtotal text-right">Php ${formatCurrency(subtotal)}</td>
        `;
        itemsContainer.appendChild(row);
    });

    if (itemsContainer.children.length === 0) {
        itemsContainer.innerHTML = '<tr><td colspan="2" class="empty-state">No items added yet</td></tr>';
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
    const eventDate = document.getElementById('eventDate').value;
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
        'eventVenue', 'eventDate', 'notes'
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
        // Recalculate all milestone dates based on new invoice date
        const total = calculateTotal();
        updatePaymentMilestones(total);
        // Re-render the form to show updated dates
        renderPaymentMilestones();
        updatePreview();
        saveToLocalStorage();
    });
    
    // Event date change should recalculate payment milestone dates
    document.getElementById('eventDate').addEventListener('change', function() {
        // Recalculate all milestone dates based on new event date
        const total = calculateTotal();
        updatePaymentMilestones(total);
        // Re-render the form to show updated dates
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

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        // Generate first page (Invoice) - reduced scale and JPEG compression
        const canvas1 = await html2canvas(invoiceElement, {
            scale: 1.5, // Reduced from 2 for smaller file size
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
            width: 210 * 3.779527559, // Convert mm to pixels (210mm * 3.779527559 px/mm)
            height: 297 * 3.779527559  // Convert mm to pixels
        });

        // Use JPEG with compression instead of PNG
        const imgData1 = canvas1.toDataURL('image/jpeg', 0.85); // 85% quality for good balance
        const imgWidth1 = pageWidth;
        const imgHeight1 = (canvas1.height * imgWidth1) / canvas1.width;

        // Add first page - fit to page
        if (imgHeight1 > pageHeight) {
            // If content is taller than page, scale it down
            const scale = pageHeight / imgHeight1;
            pdf.addImage(imgData1, 'JPEG', 0, 0, imgWidth1 * scale, imgHeight1 * scale);
        } else {
            pdf.addImage(imgData1, 'JPEG', 0, 0, imgWidth1, imgHeight1);
        }

        // Generate second page (Payment Terms) - always on new page
        if (paymentTermsElement) {
            const canvas2 = await html2canvas(paymentTermsElement, {
                scale: 1.5, // Reduced from 2 for smaller file size
                useCORS: true,
                backgroundColor: '#ffffff',
                logging: false,
                width: 210 * 3.779527559,
                height: 297 * 3.779527559
            });

            // Use JPEG with compression instead of PNG
            const imgData2 = canvas2.toDataURL('image/jpeg', 0.85); // 85% quality for good balance
            const imgWidth2 = pageWidth;
            const imgHeight2 = (canvas2.height * imgWidth2) / canvas2.width;

            // Add new page for payment terms
            pdf.addPage();
            
            // Fit to page
            if (imgHeight2 > pageHeight) {
                const scale = pageHeight / imgHeight2;
                pdf.addImage(imgData2, 'JPEG', 0, 0, imgWidth2 * scale, imgHeight2 * scale);
            } else {
                pdf.addImage(imgData2, 'JPEG', 0, 0, imgWidth2, imgHeight2);
            }
        }

        // Generate filename
        const invoiceNumber = document.getElementById('invoiceNumber').value || 'invoice';
        const clientName = document.getElementById('clientName').value || 'client';
        const filename = `${invoiceNumber}_${clientName.replace(/\s+/g, '_')}.pdf`;

        // Save PDF
        pdf.save(filename);
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Error generating PDF. Please try again.');
    } finally {
        // Restore button state
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
    document.getElementById('eventDate').valueAsDate = today;

    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    document.getElementById('invoiceNumber').value = `INV-${year}-${month}${day}-001`;

    // Clear client details
    document.getElementById('clientName').value = '';
    document.getElementById('clientAddress').value = '';
    document.getElementById('clientTIN').value = '';

    // Clear event details
    document.getElementById('eventVenue').value = '';

    // Reset package selection
    document.getElementById('packageType').value = '';
    document.getElementById('numberOfPax').value = '';
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
        eventVenue: document.getElementById('eventVenue').value,
        eventDate: document.getElementById('eventDate').value,
        packageType: document.getElementById('packageType').value,
        numberOfPax: document.getElementById('numberOfPax').value,
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
    document.getElementById('eventVenue').value = data.eventVenue || '';
    if (data.eventDate) document.getElementById('eventDate').value = data.eventDate;
    if (data.packageType) document.getElementById('packageType').value = data.packageType;
    if (data.numberOfPax) document.getElementById('numberOfPax').value = data.numberOfPax;
    document.getElementById('notes').value = data.notes || '';

    if (data.invoiceItems) invoiceItems = data.invoiceItems;
    if (data.customLineItems) customLineItems = data.customLineItems;
    if (data.paymentMilestones) paymentMilestones = data.paymentMilestones;

    renderInvoiceItems();
    renderCustomLineItems();
    renderPaymentMilestones();
    updatePreview();
    saveToLocalStorage();
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

function formatPackageName(packageType, numberOfPax) {
    const names = { starter: 'Starter', signature: 'Signature', special: 'Special' };
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
        const eventDate = inv.eventDate ? formatDate(inv.eventDate) : '';
        const pkg = formatPackageName(inv.packageType, inv.numberOfPax);
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
        (inv.packageType || '').toLowerCase().includes(q)
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