import { db } from './firebase-inventory.js';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

// Local storage keys
const STORAGE_KEYS = {
    INVENTORY: 'inventory-items',
    QUANTITIES: 'inventory-quantities',
    LAST_SYNC: 'inventory-last_sync'
};

// Global state
let inventoryItems = [];
let quantities = {};
let currentMode = 'opening';
let isOnline = navigator.onLine;
let currentDate = new Date();
let isReorderMode = false; // Add this
let customCategories = []; // Add this
let editingItemId = null; // Add this

// Initialize the app
document.addEventListener('DOMContentLoaded', function () {
    initializeApp();
    setupEventListeners();
    loadLocalData();
    syncWithFirebase();
});

function initializeApp() {
    // Check online status
    window.addEventListener('online', () => {
        isOnline = true;
        syncWithFirebase();
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        showSyncIndicator('Offline', 'error');
    });

    // Uncomment the line below to add sample data (only run once)
    // addSampleData();
}

function setupEventListeners() {
    // Toggle buttons
    document.querySelectorAll('.toggle-btn').forEach(button => {
        button.addEventListener('click', function () {
            const newMode = this.getAttribute('data-mode');

            // Don't animate if same mode
            if (newMode === currentMode) return;

            showModeSwitchConfirmation(newMode);

            // // Remove active from all buttons
            // document.querySelectorAll('.toggle-btn').forEach(btn => {
            //     btn.classList.remove('active');
            // });

            // // Add active to clicked button
            // this.classList.add('active');

            // // Animate the switch
            // animateInventorySwitch(newMode);
        });
    });
    

    // Add item button and modal
    const addItemBtn = document.getElementById('addItemBtn');
    const modalOverlay = document.getElementById('modalOverlay');
    const modalClose = document.getElementById('modalClose');
    const cancelBtn = document.getElementById('cancelBtn');
    const addItemForm = document.getElementById('addItemForm');

    // Add category button
    const addCategoryBtn = document.getElementById('addCategoryBtn');
    if (addCategoryBtn) {
        addCategoryBtn.addEventListener('click', () => openAddCategoryModal());
    }

    // Add category modal
    const addCategoryModalOverlay = document.getElementById('addCategoryModalOverlay');
    const addCategoryModalClose = document.getElementById('addCategoryModalClose');
    const addCategoryCancelBtn = document.getElementById('addCategoryCancelBtn');
    const addCategoryConfirmBtn = document.getElementById('addCategoryConfirmBtn');

    addCategoryModalClose.addEventListener('click', () => closeAddCategoryModal());
    addCategoryCancelBtn.addEventListener('click', () => closeAddCategoryModal());
    addCategoryConfirmBtn.addEventListener('click', handleAddCategory);
    addCategoryModalOverlay.addEventListener('click', (e) => {
        if (e.target === addCategoryModalOverlay) closeAddCategoryModal();
    });

    function closeAddCategoryModal() {
        document.getElementById('addCategoryModalOverlay').classList.remove('show');
        document.getElementById('newCategoryName').value = '';
    }

    function handleAddCategory() {
        const categoryName = document.getElementById('newCategoryName').value.trim();
        if (categoryName) {
            addNewCategory(categoryName);
            closeAddCategoryModal();
        }
    }

    addItemBtn.addEventListener('click', () => openModal());
    modalClose.addEventListener('click', () => closeModal());
    cancelBtn.addEventListener('click', () => closeModal());
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    addItemForm.addEventListener('submit', handleAddItem);

    // Quantity controls (delegated events)
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', stopHold);
    document.addEventListener('mouseleave', stopHold);
    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchend', stopHold);
    document.addEventListener('touchcancel', stopHold);

    // Tap to edit quantity
    document.addEventListener('click', handleQuantityEdit);

    // Mode switch confirmation modal
    const modeSwitchModalOverlay = document.getElementById('modeSwitchModalOverlay');
    const modeSwitchModalClose = document.getElementById('modeSwitchModalClose');
    const modeSwitchCancelBtn = document.getElementById('modeSwitchCancelBtn');
    const modeSwitchConfirmBtn = document.getElementById('modeSwitchConfirmBtn');

    modeSwitchModalClose.addEventListener('click', cancelModeSwitch);
    modeSwitchCancelBtn.addEventListener('click', cancelModeSwitch);
    modeSwitchConfirmBtn.addEventListener('click', confirmModeSwitch);
    modeSwitchModalOverlay.addEventListener('click', (e) => {
        if (e.target === modeSwitchModalOverlay) cancelModeSwitch();
    });
    
    preventHeaderScroll();
    initializeDatePicker();

    // Initialize admin features
    initializeAdminFeatures();
}

let pendingModeSwitch = null;

function showModeSwitchConfirmation(newMode) {
    pendingModeSwitch = newMode;

    const modal = document.getElementById('modeSwitchModalOverlay');
    const title = document.getElementById('modeSwitchTitle');
    const message = document.getElementById('modeSwitchMessage');

    if (newMode === 'closing') {
        title.textContent = 'Submit Opening Inventory?';
        message.innerHTML = `<p>This will submit your opening inventory.</p>`;
    } else {
        title.textContent = 'Edit Opening Inventory?';
        message.innerHTML = `<p>You can edit your opening inventory.</p>`;
    }

    modal.classList.add('show');
}

function confirmModeSwitch() {
    if (!pendingModeSwitch) return;

    const newMode = pendingModeSwitch;
    pendingModeSwitch = null;

    // Remove active from all buttons
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Add active to new mode button
    document.querySelector(`[data-mode="${newMode}"]`).classList.add('active');

    // Animate the switch
    animateInventorySwitch(newMode);

    // Close modal
    document.getElementById('modeSwitchModalOverlay').classList.remove('show');

    // Show appropriate message
    const modeMessage = newMode === 'closing' ? 'Opening inventory submitted' : 'Switched to Opening mode';
    showSyncIndicator(modeMessage, 'success');
}

function cancelModeSwitch() {
    pendingModeSwitch = null;
    document.getElementById('modeSwitchModalOverlay').classList.remove('show');
}

function loadLocalData() {
    // Load inventory items
    const savedItems = localStorage.getItem(STORAGE_KEYS.INVENTORY);
    if (savedItems) {
        inventoryItems = JSON.parse(savedItems);
    }

    // Load quantities
    const savedQuantities = localStorage.getItem(STORAGE_KEYS.QUANTITIES);
    if (savedQuantities) {
        quantities = JSON.parse(savedQuantities);
        migrateQuantityData(); // Add this line
    }

    // Render with local data first
    renderInventory();
}

async function syncWithFirebase() {
    if (!isOnline) return;

    try {
        showSyncIndicator('Syncing...', 'info');

        // ALWAYS fetch from Firebase on startup - Firebase is source of truth
        const snapshot = await getDocs(collection(db, "inventory-items"));
        const firebaseItems = [];
        snapshot.forEach(doc => {
            firebaseItems.push({ id: doc.id, ...doc.data() });
        });

        // Always overwrite local data with Firebase data
        inventoryItems = firebaseItems;
        localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(inventoryItems));

        // Initialize quantities for all items
        firebaseItems.forEach(item => {
            const dateQuantities = getCurrentDateQuantities();
            if (!dateQuantities[item.id]) {
                dateQuantities[item.id] = {
                    opening: { value: 0, checked: false },
                    closing: { value: 0, checked: false }
                };
            }
        });

        saveQuantitiesToLocal();
        renderInventory();

        showSyncIndicator('Synced', 'success');

    } catch (error) {
        console.error('Sync error:', error);
        showSyncIndicator('Sync failed', 'error');
    }
}

async function syncQuantitiesWithFirebase() {
    // This will sync quantity changes back to Firebase
    // For now, we'll keep quantities local only as they change frequently
    // You can implement periodic syncing or manual sync triggers here
}

function arraysEqual(a, b) {
    if (a.length !== b.length) return false;

    const aStr = JSON.stringify(a.sort((x, y) => x.id > y.id ? 1 : -1));
    const bStr = JSON.stringify(b.sort((x, y) => x.id > y.id ? 1 : -1));

    return aStr === bStr;
}

function renderInventory() {
    const inventoryList = document.querySelector('.inventory-list');

    if (inventoryItems.length === 0) {
        inventoryList.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #888;">
                <p>No items in inventory</p>
                <p style="font-size: 14px;">Click "Add Item" to get started</p>
            </div>
        `;
        return;
    }

    // Group items by category
    const itemsByCategory = inventoryItems.reduce((groups, item) => {
        const category = item.category || 'Other';
        if (!groups[category]) {
            groups[category] = [];
        }
        groups[category].push(item);
        return groups;
    }, {});

    // Sort categories alphabetically, but put common ones first and 'Other' last
    const categoryOrder = [
    ];

    const sortedCategories = Object.keys(itemsByCategory).sort((a, b) => {
        // Get the minimum categoryOrder for items in each category
        const aOrder = Math.min(...itemsByCategory[a].map(item => item.categoryOrder || 0));
        const bOrder = Math.min(...itemsByCategory[b].map(item => item.categoryOrder || 0));

        return aOrder - bOrder;
    });

    inventoryList.innerHTML = sortedCategories.map(category => {
        const categoryItems = itemsByCategory[category];

        // Sort items within category by order field
        categoryItems.sort((a, b) => (a.order || 0) - (b.order || 0));

        const itemsHtml = categoryItems.map(item => {
            const dateQuantities = getCurrentDateQuantities();
            const itemQuantities = dateQuantities[item.id] || {
                opening: { value: 0, checked: false },
                closing: { value: 0, checked: false }
            };

            let displayValue, isGreyedOut;
            if (currentMode === 'opening') {
                if (itemQuantities.opening.checked) {
                    displayValue = itemQuantities.opening.value;
                    isGreyedOut = false;
                } else {
                    // Show previous day's closing value
                    const prevDay = getPreviousDayQuantities();
                    displayValue = prevDay[item.id]?.closing?.value || 0;
                    isGreyedOut = true;
                }
            } else {
                if (itemQuantities.closing.checked) {
                    displayValue = itemQuantities.closing.value;
                    isGreyedOut = false;
                } else {
                    // Show current day's opening value
                    displayValue = itemQuantities.opening?.value || 0;
                    isGreyedOut = true;
                }
            }

            return `
            <div class="item-card">
                <div class="item-image"></div>
                <div class="item-info">
                    <div class="item-name">${item.name}</div>
                    <div class="item-subtitle">${item.subtitle || ''}</div>
                </div>
                <div class="item-controls">
                    <div class="quantity-display">
                        <span class="quantity-number ${isGreyedOut ? 'greyed-out' : ''}" data-item="${item.id}">${displayValue}</span>
                        <span class="quantity-unit">${item.unit}</span>
                    </div>
                    <div class="control-buttons">
                        <button class="control-btn" type="button" data-item="${item.id}" data-action="increase">+</button>
                        <button class="control-btn" type="button" data-item="${item.id}" data-action="decrease">−</button>
                    </div>
                </div>
            </div>
        `;
        }).join('');

        const categoryDisplayName = category === 'Other' ? 'Uncategorized' : category;
        const editControls = isReorderMode ? `
            <div class="category-edit-controls">
                <button class="category-edit-btn" data-category="${category}" title="Edit category">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="category-up-btn" data-category="${category}" title="Move up">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="18,15 12,9 6,15"></polyline>
                    </svg>
                </button>
                <button class="category-down-btn" data-category="${category}" title="Move down">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6,9 12,15 18,9"></polyline>
                    </svg>
                </button>
                ${category !== 'Other' ? `<button class="category-delete-btn" data-category="${category}" title="Delete category">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3,6 5,6 21,6"></polyline>
                        <path d="m19,6v14a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6m3,0V4a2,2 0 0,1,2-2h4a2,2 0 0,1,2,2v2"></path>
                    </svg>
                </button>` : ''}
            </div>
        ` : '';

        return `
        <div class="category-section" data-category="${category}">
            <div class="category-header-container">
                <div class="category-header" data-category="${category}">${categoryDisplayName}</div>
                ${editControls}
            </div>
            ${itemsHtml}
        </div>
    `;
    }).join('');

    // Add event listeners after rendering
    if (isReorderMode) {
        // Category edit and delete buttons
        document.querySelectorAll('.category-edit-btn').forEach(btn => {
            btn.addEventListener('click', handleCategoryEdit);
        });

        document.querySelectorAll('.category-delete-btn').forEach(btn => {
            btn.addEventListener('click', handleCategoryDelete);
        });

        // Category up/down buttons
        document.querySelectorAll('.category-up-btn').forEach(btn => {
            btn.addEventListener('click', handleCategoryMoveUp);
        });

        document.querySelectorAll('.category-down-btn').forEach(btn => {
            btn.addEventListener('click', handleCategoryMoveDown);
        });
    }
}

function animateInventorySwitch(newMode) {
    const inventoryList = document.querySelector('.inventory-list');
    const scrollableContent = document.querySelector('.scrollable-content');
    const isGoingRight = (currentMode === 'opening' && newMode === 'closing');
    const swipeOutClass = isGoingRight ? 'swipe-out-left' : 'swipe-out-right';
    const swipeInClass = isGoingRight ? 'swipe-in-from-right' : 'swipe-in-from-left';
    scrollableContent.classList.add('animating');

    // Step 1: Swipe current content out
    inventoryList.classList.add(swipeOutClass);

    setTimeout(() => {
        // Step 2: Update content and INSTANTLY jump to opposite side
        currentMode = newMode;
        saveQuantitiesToLocal();

        // Remove transitions temporarily and jump to opposite side
        inventoryList.style.transition = 'none';
        inventoryList.classList.remove(swipeOutClass);
        inventoryList.classList.add(swipeInClass);

        // Render new content while positioned off-screen
        renderInventory();

        // Force reflow
        inventoryList.offsetHeight;

        // Step 3: Re-enable transitions and animate in
        inventoryList.style.transition = 'transform 0.4s cubic-bezier(0.4, 0.0, 0.2, 1), opacity 0.3s ease';

        requestAnimationFrame(() => {
            inventoryList.classList.remove(swipeInClass);

            setTimeout(() => {
                scrollableContent.classList.remove('animating');
                // Reset transition to default
                inventoryList.style.transition = '';
            }, 200);
        });
    }, 100);
}

function saveQuantitiesToLocal() {
    localStorage.setItem(STORAGE_KEYS.QUANTITIES, JSON.stringify(quantities));
}

// Keep the old function name for compatibility
function saveCurrentDateQuantities() {
    saveQuantitiesToLocal();
}

async function handleAddItem(e) {
    e.preventDefault();

    const initialQty = parseInt(document.getElementById('initialQuantity').value) || 0;
    const selectedCategory = document.getElementById('itemCategory').value;

    // Find the highest order number in this category
    const itemsInCategory = inventoryItems.filter(item => item.category === selectedCategory);
    const maxOrder = itemsInCategory.length > 0 ? Math.max(...itemsInCategory.map(item => item.order || 0)) : -1;

    const itemData = {
        name: document.getElementById('itemName').value.trim(),
        subtitle: document.getElementById('itemSubtitle').value.trim(),
        unit: document.getElementById('itemUnit').value,
        category: selectedCategory,
        order: maxOrder + 1 // Put it at the end of the category
    };

    // Only add createdAt for new items
    if (!editingItemId) {
        itemData.createdAt = new Date().toISOString();
    }

    try {
        if (editingItemId) {
            // Editing existing item
            showSyncIndicator('Updating item...', 'info');

            try {
                // Update in Firebase first
                const itemDoc = doc(db, "inventory-items", editingItemId);
                await updateDoc(itemDoc, itemData);

                // Update local array
                const itemIndex = inventoryItems.findIndex(item => item.id === editingItemId);
                if (itemIndex !== -1) {
                    inventoryItems[itemIndex] = { ...inventoryItems[itemIndex], ...itemData };
                    localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(inventoryItems));
                }

                renderInventory();
                showSyncIndicator('Item updated', 'success');
            } catch (error) {
                console.error('Error updating item:', error);
                showSyncIndicator('Failed to update item', 'error');
            }

            editingItemId = null;
        } else {
            // Adding new item
            showSyncIndicator('Adding item...', 'info');

            const docRef = await addDoc(collection(db, "inventory-items"), itemData);
            const newItem = { id: docRef.id, ...itemData };
            inventoryItems.push(newItem);

            const dateQuantities = getCurrentDateQuantities();
            dateQuantities[docRef.id] = {
                opening: { value: initialQty, checked: true },
                closing: { value: initialQty, checked: true }
            };

            localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(inventoryItems));
            saveCurrentDateQuantities();

            renderInventory();
            showSyncIndicator('Item added', 'success');
        }

        closeModal();

    } catch (error) {
        console.error('Error saving item:', error);
        showSyncIndicator('Failed to save item', 'error');
    }
}

// Quantity control functions
let holdTimer = null;
let holdInterval = null;
let isHolding = false;

function adjustQuantity(itemId, delta) {
    const dateQuantities = getCurrentDateQuantities();

    if (!dateQuantities[itemId]) {
        dateQuantities[itemId] = {
            opening: { value: 0, checked: false },
            closing: { value: 0, checked: false }
        };
    }

    const currentData = dateQuantities[itemId][currentMode];

    // If not checked yet, copy the greyed out value first
    if (!currentData.checked) {
        if (currentMode === 'opening') {
            const prevDay = getPreviousDayQuantities();
            currentData.value = prevDay[itemId]?.closing?.value || 0;
        } else {
            currentData.value = dateQuantities[itemId].opening?.value || 0;
        }
        currentData.checked = true;
    }

    // Apply the delta
    currentData.value = Math.max(0, currentData.value + delta);

    const quantityElement = document.querySelector(`[data-item="${itemId}"].quantity-number`);
    if (quantityElement) {
        quantityElement.textContent = currentData.value;
        quantityElement.classList.remove('greyed-out');
        animateQuantityChange(quantityElement);
    }

    saveQuantitiesToLocal();
}

function animateQuantityChange(element) {
    if (!element) return;
    element.style.transform = 'scale(1.1)';
    element.style.transition = 'transform 0.1s ease';
    setTimeout(() => {
        element.style.transform = 'scale(1)';
    }, 100);
}

function getHoldIncrementAmount(currentValue) {
    if (currentValue < 10) return 1;
    if (currentValue < 100) return 5;
    if (currentValue < 1000) return 10;
    return 25;
}

function startHold(itemId, action) {
    isHolding = true;

    holdTimer = setTimeout(() => {
        if (isHolding) {
            holdInterval = setInterval(() => {
                const currentQty = quantities[itemId] ? quantities[itemId][currentMode] : 0;
                const incrementAmount = getHoldIncrementAmount(currentQty);
                const delta = action === 'increase' ? incrementAmount : -incrementAmount;
                adjustQuantity(itemId, delta);
            }, 100);
        }
    }, 500);
}

function stopHold() {
    isHolding = false;
    clearTimeout(holdTimer);
    clearInterval(holdInterval);
}

function handleMouseDown(event) {
    if (event.target.classList.contains('control-btn')) {
        const itemId = event.target.getAttribute('data-item');
        const action = event.target.getAttribute('data-action');

        if (itemId && action) {
            const delta = action === 'increase' ? 1 : -1;
            adjustQuantity(itemId, delta);
            startHold(itemId, action);
        }
    }
}

function handleTouchStart(event) {
    if (event.target.classList.contains('control-btn')) {
        event.preventDefault();
        const itemId = event.target.getAttribute('data-item');
        const action = event.target.getAttribute('data-action');

        if (itemId && action) {
            const delta = action === 'increase' ? 1 : -1;
            adjustQuantity(itemId, delta);
            startHold(itemId, action);
        }
    }
}

function handleQuantityEdit(event) {
    if (event.target.classList.contains('quantity-number')) {
        const span = event.target;
        const input = document.createElement('input');
        input.type = 'tel';
        input.inputMode = 'numeric';
        input.pattern = '[0-9]*';
        input.value = span.textContent;
        input.className = 'quantity-input-edit';

        span.replaceWith(input);
        input.focus();
        input.select();

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                input.blur();
            }
        });

        input.addEventListener('blur', function () {
            const newSpan = document.createElement('span');
            newSpan.className = 'quantity-number';
            newSpan.setAttribute('data-item', span.getAttribute('data-item'));
            newSpan.textContent = input.value;
            input.replaceWith(newSpan);

            const itemId = newSpan.getAttribute('data-item');
            const newValue = parseInt(input.value) || 0;

            const dateQuantities = getCurrentDateQuantities();
            if (!dateQuantities[itemId]) {
                dateQuantities[itemId] = {
                    opening: { value: 0, checked: false },
                    closing: { value: 0, checked: false }
                };
            }

            // Mark as checked and set the new value
            dateQuantities[itemId][currentMode].value = newValue;
            dateQuantities[itemId][currentMode].checked = true;

            saveQuantitiesToLocal();
        });
    }
}

// Modal functions
function openModal() {
    // Update category dropdown with current categories
    updateCategoryDropdown();

    document.getElementById('modalOverlay').classList.add('show');
    document.getElementById('itemName').focus();
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('show');
    document.getElementById('addItemForm').reset();

    // Reset edit state
    editingItemId = null;
    document.querySelector('#modalOverlay .modal-header h3').textContent = 'Add New Item';
    document.querySelector('#modalOverlay .btn-add').textContent = 'Add Item';
}

// Sync indicator
function showSyncIndicator(message, type) {
    const indicator = document.querySelector('.sync-indicator') || createSyncIndicator();

    indicator.textContent = message;
    indicator.className = `sync-indicator show ${type}`;

    setTimeout(() => {
        indicator.classList.remove('show');
    }, 3000);
}

function createSyncIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'sync-indicator';
    document.body.appendChild(indicator);
    return indicator;
}

async function addSampleData() {
    const sampleItems = [
        // Cups, Bottles & Packaging
        { name: 'Cups', subtitle: 'Iced (16oz)', unit: 'pcs', category: 'Cups, Bottles & Packaging' },
        { name: 'Cups', subtitle: 'Iced (12oz)', unit: 'pcs', category: 'Cups, Bottles & Packaging' },

        // Ingredients
        { name: 'Matcha Powder', subtitle: 'Aki', unit: 'g', category: 'Ingredients' },

        // Milk & Alternatives
        { name: 'Oat Milk', subtitle: 'Oatside', unit: 'L', category: 'Milk & Alternatives' },
        { name: 'Dairy Milk', subtitle: 'Lasciate', unit: 'L', category: 'Milk & Alternatives' },
        { name: 'Coconut Milk', subtitle: 'Nobo', unit: 'L', category: 'Milk & Alternatives' },

        // Food Items
        { name: 'Matcha White Chocolate', subtitle: 'Cookie', unit: 'pcs', category: 'Food Items' },
        { name: 'Matcha Dark Chocolate', subtitle: 'Cookie', unit: 'pcs', category: 'Food Items' },
        { name: 'Matcha Bomb', subtitle: 'Cookie', unit: 'pcs', category: 'Food Items' },
        { name: 'Matcha Oreo', subtitle: 'Cookie', unit: 'pcs', category: 'Food Items' }
    ];

    for (const item of sampleItems) {
        try {
            await addDoc(collection(db, "inventory-items"), {
                ...item,
                createdAt: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error adding sample item:', error);
        }
    }
}

// Prevent scroll propagation from header areas
function preventHeaderScroll() {
    const headerElements = document.querySelectorAll('.header-container, .add-item-container, .toggle-container, .date-picker-container');

    headerElements.forEach(element => {
        element.addEventListener('touchstart', (e) => {
            e.stopPropagation();
        }, { passive: true });

        element.addEventListener('touchmove', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });

        element.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });
    });
}

// Date picker functionality
function initializeDatePicker() {
    const prevBtn = document.getElementById('prevDate');
    const nextBtn = document.getElementById('nextDate');
    const dateDisplay = document.getElementById('dateDisplay');

    // Initialize with today's date
    updateDateDisplay();

    // Previous date button
    prevBtn.addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() - 1);
        updateDateDisplay();
        
        loadQuantitiesForDate(currentDate);
        animateDateChange();
    });

    // Next date button
    nextBtn.addEventListener('click', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Don't allow going beyond today
        if (currentDate < today) {
            currentDate.setDate(currentDate.getDate() + 1);
            updateDateDisplay();
            
            loadQuantitiesForDate(currentDate);
            animateDateChange();
        }
    });

    // Click on date to open calendar picker
    dateDisplay.addEventListener('click', () => {
        openDateModal();
    });
}

function updateDateDisplay() {
    const dateDisplay = document.getElementById('dateDisplay');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const currentDateCopy = new Date(currentDate);
    currentDateCopy.setHours(0, 0, 0, 0);

    let displayText;

    if (currentDateCopy.getTime() === today.getTime()) {
        displayText = 'Today, ' + currentDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
    } else {
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        if (currentDateCopy.getTime() === yesterday.getTime()) {
            displayText = 'Yesterday, ' + currentDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });
        } else {
            displayText = currentDate.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric'
            });
        }
    }

    dateDisplay.textContent = displayText;

    // Update next button state
    const nextBtn = document.getElementById('nextDate');
    if (currentDateCopy.getTime() >= today.getTime()) {
        nextBtn.style.opacity = '0.3';
        nextBtn.style.cursor = 'not-allowed';
    } else {
        nextBtn.style.opacity = '1';
        nextBtn.style.cursor = 'pointer';
    }
}

function openDateModal() {
    const modal = document.getElementById('dateModalOverlay');
    const modalMonthYear = document.getElementById('modalMonthYear');
    const dateGrid = document.getElementById('dateGrid');

    let viewDate = new Date(currentDate);

    function renderCalendar() {
        const year = viewDate.getFullYear();
        const month = viewDate.getMonth();

        // Update header
        modalMonthYear.textContent = viewDate.toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
        });

        // Clear grid
        dateGrid.innerHTML = '';

        // Get first day of month and number of days
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();

        // Add empty cells for days before month starts
        for (let i = 0; i < startingDayOfWeek; i++) {
            const cell = document.createElement('div');
            cell.className = 'date-cell other-month';
            const prevMonthDay = new Date(year, month, 0 - (startingDayOfWeek - 1 - i));
            cell.textContent = prevMonthDay.getDate();
            dateGrid.appendChild(cell);
        }

        // Add days of current month
        const today = new Date();
        const todayStr = today.toDateString();
        const currentDateStr = currentDate.toDateString();

        for (let day = 1; day <= daysInMonth; day++) {
            const cell = document.createElement('div');
            const cellDate = new Date(year, month, day);
            const cellDateStr = cellDate.toDateString();

            cell.className = 'date-cell';
            cell.textContent = day;

            // Add classes
            if (cellDateStr === todayStr) {
                cell.classList.add('today');
            }
            if (cellDateStr === currentDateStr) {
                cell.classList.add('selected');
            }
            if (cellDate > today) {
                cell.classList.add('disabled');
            }

            // Add click handler
            if (cellDate <= today) {
                cell.addEventListener('click', () => {
                    currentDate = new Date(cellDate);
                    updateDateDisplay();
                    closeModal();
                });
            }

            dateGrid.appendChild(cell);
        }
    }

    function closeModal() {
        modal.classList.remove('show');
    }

    // Modal controls
    document.getElementById('modalPrevMonth').onclick = () => {
        viewDate.setMonth(viewDate.getMonth() - 1);
        renderCalendar();
    };

    document.getElementById('modalNextMonth').onclick = () => {
        viewDate.setMonth(viewDate.getMonth() + 1);
        renderCalendar();
    };

    document.getElementById('dateCancelBtn').onclick = closeModal;
    document.getElementById('todayBtn').onclick = () => {
        currentDate = new Date();
        updateDateDisplay();
        closeModal();
    };

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Show modal and render calendar
    modal.classList.add('show');
    renderCalendar();
}

// Date-based inventory management
function getDateKey(date = currentDate) {
    return date.toISOString().split('T')[0]; // Returns "YYYY-MM-DD"
}

function getCurrentDateQuantities() {
    const dateKey = getDateKey();
    if (!quantities[dateKey]) {
        quantities[dateKey] = {};
        // Initialize with zeros for all items
        inventoryItems.forEach(item => {
            quantities[dateKey][item.id] = {
                opening: { value: 0, checked: false },
                closing: { value: 0, checked: false }
            };
        });
    } else {
        // Ensure all items exist in current date with proper format
        inventoryItems.forEach(item => {
            if (!quantities[dateKey][item.id]) {
                quantities[dateKey][item.id] = {
                    opening: { value: 0, checked: false },
                    closing: { value: 0, checked: false }
                };
            } else {
                // Migrate old format if needed
                const itemData = quantities[dateKey][item.id];
                if (typeof itemData.opening === 'number') {
                    quantities[dateKey][item.id] = {
                        opening: { value: itemData.opening, checked: true },
                        closing: { value: itemData.closing, checked: true }
                    };
                }
            }
        });
    }
    return quantities[dateKey];
}

function loadQuantitiesForDate(date) {
    const dateKey = getDateKey(date);
    if (!quantities[dateKey]) {
        quantities[dateKey] = {};
        // Initialize with zeros for all items
        inventoryItems.forEach(item => {
            quantities[dateKey][item.id] = {
                opening: { value: 0, checked: false },
                closing: { value: 0, checked: false }
            };
        });
    }
}

function migrateQuantityData() {
    // Convert old format to new format
    Object.keys(quantities).forEach(dateKey => {
        Object.keys(quantities[dateKey]).forEach(itemId => {
            const itemData = quantities[dateKey][itemId];

            // Check if it's old format (numbers instead of objects)
            if (typeof itemData.opening === 'number') {
                quantities[dateKey][itemId] = {
                    opening: { value: itemData.opening, checked: true },
                    closing: { value: itemData.closing, checked: true }
                };
            }
        });
    });

    // Save migrated data
    saveQuantitiesToLocal();
}

function getPreviousDayQuantities() {
    const prevDate = new Date(currentDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateKey = getDateKey(prevDate);
    return quantities[prevDateKey] || {};
}

function animateDateChange() {
    const inventoryList = document.querySelector('.inventory-list');
    const scrollableContent = document.querySelector('.scrollable-content');

    scrollableContent.classList.add('animating');

    // Fade out
    inventoryList.style.opacity = '0';

    setTimeout(() => {
        // Update content while invisible
        renderInventory();

        // Fade in
        inventoryList.style.opacity = '1';

        setTimeout(() => {
            scrollableContent.classList.remove('animating');
        }, 200);
    }, 150);
}

// Admin functionality
function initializeAdminFeatures() {
    const reorderBtn = document.getElementById('reorderBtn');

    if (window.innerWidth < 768) return;

    reorderBtn.addEventListener('click', toggleReorderMode);

    document.addEventListener('click', handleItemEdit);
}

function toggleReorderMode() {
    const reorderBtn = document.getElementById('reorderBtn');
    const inventoryList = document.querySelector('.inventory-list');

    isReorderMode = !isReorderMode;

    if (isReorderMode) {
        reorderBtn.textContent = 'Done';
        reorderBtn.classList.add('active');
        inventoryList.classList.add('reorder-mode');
        renderInventory();
        enableDragAndDrop();
    } else {
        reorderBtn.textContent = 'Edit';
        reorderBtn.classList.remove('active');
        inventoryList.classList.remove('reorder-mode');
        saveItemOrder();
        disableDragAndDrop();
        renderInventory();
    }
}

function enableDragAndDrop() {
    const itemCards = document.querySelectorAll('.item-card');

    itemCards.forEach(card => {
        card.draggable = true;
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
        card.addEventListener('dragover', handleDragOver);
        card.addEventListener('drop', handleDrop);
    });

    // Category event listeners are set up in setupCategoryEventListeners() called from renderInventory()
}

function handleCategoryMoveUp(e) {
    e.stopPropagation();
    const categoryName = e.target.closest('button').getAttribute('data-category');
    moveCategoryOrder(categoryName, -1);
}

function handleCategoryMoveDown(e) {
    e.stopPropagation();
    const categoryName = e.target.closest('button').getAttribute('data-category');
    moveCategoryOrder(categoryName, 1);
}

async function moveCategoryOrder(categoryName, direction) {
    try {
        showSyncIndicator('Reordering categories...', 'info');

        // Get all current categories sorted by their current categoryOrder
        const currentCategories = [...new Set(inventoryItems.map(item => item.category))];

        // Sort categories by their current order (using the minimum categoryOrder of items in each category)
        const categoriesWithOrder = currentCategories.map(category => {
            const itemsInCategory = inventoryItems.filter(item => item.category === category);
            const minOrder = Math.min(...itemsInCategory.map(item => item.categoryOrder || 0));
            return { category, order: minOrder };
        });

        categoriesWithOrder.sort((a, b) => a.order - b.order);
        const orderedCategories = categoriesWithOrder.map(item => item.category);

        const currentIndex = orderedCategories.indexOf(categoryName);
        if (currentIndex === -1) return;

        const newIndex = currentIndex + direction;

        // Check bounds
        if (newIndex < 0 || newIndex >= orderedCategories.length) {
            showSyncIndicator('Cannot move further', 'info');
            return;
        }

        // Swap positions in array
        [orderedCategories[currentIndex], orderedCategories[newIndex]] =
            [orderedCategories[newIndex], orderedCategories[currentIndex]];

        // Update categoryOrder for all items based on new positions
        orderedCategories.forEach((category, index) => {
            const itemsInCategory = inventoryItems.filter(item => item.category === category);
            itemsInCategory.forEach(item => {
                item.categoryOrder = index * 100; // Use gaps for future insertions
            });
        });

        // Save locally
        saveItemsToLocal();

        // Update Firebase
        const updatePromises = inventoryItems.map(async (item) => {
            const itemRef = doc(db, "inventory-items", item.id);
            return updateDoc(itemRef, {
                categoryOrder: item.categoryOrder || 0
            });
        });

        await Promise.all(updatePromises);

        // Re-render to show new order
        renderInventory();
        showSyncIndicator('Categories reordered', 'success');

    } catch (error) {
        console.error('Error reordering categories:', error);
        showSyncIndicator('Failed to reorder categories', 'error');
    }
}

function disableDragAndDrop() {
    const itemCards = document.querySelectorAll('.item-card');
    const categoryHeaders = document.querySelectorAll('.category-header');

    itemCards.forEach(card => {
        card.draggable = false;
        card.removeEventListener('dragstart', handleDragStart);
        card.removeEventListener('dragend', handleDragEnd);
        card.removeEventListener('dragover', handleDragOver);
        card.removeEventListener('drop', handleDrop);
        card.classList.remove('dragging');
    });

    document.querySelectorAll('.drop-indicator').forEach(ind => ind.remove());
}

let draggedElement = null;

function handleDragStart(e) {
    draggedElement = e.target.closest('.item-card');
    draggedElement.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();

    const targetCard = e.target.closest('.item-card');
    if (!targetCard || targetCard === draggedElement) return;

    // Remove existing indicators
    document.querySelectorAll('.drop-indicator').forEach(ind => ind.remove());

    // Create indicator
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';

    const rect = targetCard.getBoundingClientRect();
    const mouseY = e.clientY;

    if (mouseY < rect.top + rect.height / 2) {
        targetCard.parentNode.insertBefore(indicator, targetCard);
    } else {
        targetCard.parentNode.insertBefore(indicator, targetCard.nextSibling);
    }
}

function handleDrop(e) {
    e.preventDefault();

    const indicator = document.querySelector('.drop-indicator');
    if (indicator && draggedElement) {
        indicator.parentNode.insertBefore(draggedElement, indicator);
        indicator.remove();
    }
}

function handleDragEnd(e) {
    if (draggedElement) {
        draggedElement.classList.remove('dragging');
    }
    draggedElement = null;
    document.querySelectorAll('.drop-indicator').forEach(ind => ind.remove());
}

async function saveItemOrder() {
    // Update the order in inventoryItems array based on DOM order
    const reorderedItems = [];
    let globalOrder = 0;

    document.querySelectorAll('.category-section').forEach(section => {
        const itemCards = section.querySelectorAll('.item-card');

        itemCards.forEach(card => {
            const itemId = card.querySelector('.quantity-number').getAttribute('data-item');
            const item = inventoryItems.find(i => i.id === itemId);
            if (item) {
                item.order = globalOrder++;
                reorderedItems.push(item);
            }
        });
    });

    inventoryItems = reorderedItems;
    localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(inventoryItems));

    // Save order to Firebase
    try {
        showSyncIndicator('Saving order...', 'info');

        // Update each item's order in Firebase
        const updatePromises = inventoryItems.map(async (item) => {
            const itemRef = doc(db, "inventory-items", item.id);
            return updateDoc(itemRef, {
                order: item.order
            });
        });

        await Promise.all(updatePromises);

        showSyncIndicator('Order saved', 'success');
    } catch (error) {
        console.error('Error saving order:', error);
        showSyncIndicator('Failed to save order', 'error');
    }
}

function handleItemEdit(e) {
    if (!isReorderMode && window.innerWidth >= 768 && e.target.closest('.item-card')) {
        const card = e.target.closest('.item-card');
        const itemId = card.querySelector('.quantity-number').getAttribute('data-item');
        const item = inventoryItems.find(i => i.id === itemId);

        if (item) {
            openEditModal(item);
        }
    }
}

function openEditModal(item) {
    editingItemId = item.id;

    // Populate form with existing data
    document.getElementById('itemName').value = item.name;
    document.getElementById('itemSubtitle').value = item.subtitle || '';
    document.getElementById('itemUnit').value = item.unit;
    document.getElementById('initialQuantity').value = 0;

    // Update category dropdown with current categories
    updateCategoryDropdown();

    // Set the selected value
    document.getElementById('itemCategory').value = item.category;

    // Change modal title
    document.querySelector('#modalOverlay .modal-header h3').textContent = 'Edit Item';
    document.querySelector('#modalOverlay .btn-add').textContent = 'Save Changes';

    document.getElementById('modalOverlay').classList.add('show');
    document.getElementById('itemName').focus();
}

function handleCategoryEdit(e) {
    e.stopPropagation();
    const categoryName = e.target.closest('button').getAttribute('data-category');
    const categorySection = e.target.closest('.category-section');
    const headerElement = categorySection.querySelector('.category-header');

    // Store original content
    const originalText = headerElement.textContent;

    // Make it editable with CSS class
    headerElement.contentEditable = true;
    headerElement.classList.add('editing');

    // Focus and select text
    headerElement.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(headerElement);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    function finishEdit() {
        const newText = headerElement.textContent.trim();
        headerElement.contentEditable = false;
        headerElement.classList.remove('editing');

        if (newText && newText !== originalText) {
            const newCategoryName = newText === 'Uncategorized' ? 'Other' : newText;

            if (newCategoryName !== categoryName) {
                updateCategoryName(categoryName, newCategoryName);
            }
        } else {
            headerElement.textContent = originalText;
        }
    }

    headerElement.addEventListener('blur', finishEdit, { once: true });
    headerElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            headerElement.blur();
        }
        if (e.key === 'Escape') {
            headerElement.textContent = originalText;
            headerElement.blur();
        }
    }, { once: true });
}

function handleCategoryDelete(e) {
    const categoryName = e.target.getAttribute('data-category');
    const itemsInCategory = inventoryItems.filter(item => item.category === categoryName);

    if (itemsInCategory.length > 0) {
        if (confirm(`Move ${itemsInCategory.length} items from "${categoryName}" to "Uncategorized"?`)) {
            // Move items to 'Other' category
            itemsInCategory.forEach(item => {
                item.category = 'Other';
            });
            saveItemsToLocal();
            syncItemsWithFirebase();
            renderInventory();
            showSyncIndicator('Category deleted, items moved to Uncategorized', 'success');
        }
    } else {
        renderInventory();
        showSyncIndicator('Category deleted', 'success');
    }
}

async function updateCategoryName(oldName, newName) {
    try {
        showSyncIndicator('Updating category...', 'info');

        // Update all items with this category
        const itemsToUpdate = inventoryItems.filter(item => item.category === oldName);

        for (const item of itemsToUpdate) {
            item.category = newName;

            // Update in Firebase
            const itemRef = doc(db, "inventory-items", item.id);
            await updateDoc(itemRef, { category: newName });
        }

        saveItemsToLocal();
        showSyncIndicator('Category updated', 'success');

    } catch (error) {
        console.error('Error updating category:', error);
        showSyncIndicator('Failed to update category', 'error');
    }
}

async function saveCategoryOrder() {
    // Update category order based on DOM order
    const categoryElements = document.querySelectorAll('.category-section');
    let categoryOrder = 0;

    for (const categoryElement of categoryElements) {
        const categoryName = categoryElement.getAttribute('data-category');
        const itemsInCategory = inventoryItems.filter(item => item.category === categoryName);

        // Update order for all items in this category
        itemsInCategory.forEach(item => {
            item.categoryOrder = categoryOrder;
        });

        categoryOrder++;
    }

    saveItemsToLocal();

    try {
        showSyncIndicator('Saving category order...', 'info');

        // Update Firebase
        const updatePromises = inventoryItems.map(async (item) => {
            const itemRef = doc(db, "inventory-items", item.id);
            return updateDoc(itemRef, {
                categoryOrder: item.categoryOrder || 0
            });
        });

        await Promise.all(updatePromises);
        showSyncIndicator('Category order saved', 'success');

    } catch (error) {
        console.error('Error saving category order:', error);
        showSyncIndicator('Failed to save category order', 'error');
    }
}

function saveItemsToLocal() {
    localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(inventoryItems));
}

async function syncItemsWithFirebase() {
    // Sync updated items back to Firebase
    try {
        const updatePromises = inventoryItems.map(async (item) => {
            const itemRef = doc(db, "inventory-items", item.id);
            return updateDoc(itemRef, {
                category: item.category,
                categoryOrder: item.categoryOrder || 0
            });
        });

        await Promise.all(updatePromises);
    } catch (error) {
        console.error('Error syncing items:', error);
    }
}

function openAddCategoryModal() {
    document.getElementById('addCategoryModalOverlay').classList.add('show');
    document.getElementById('newCategoryName').focus();
}

async function addNewCategory(categoryName) {
    try {
        showSyncIndicator('Adding category...', 'info');

        // Find the highest categoryOrder to put this category at the end
        const maxCategoryOrder = inventoryItems.length > 0 ?
            Math.max(...inventoryItems.map(item => item.categoryOrder || 0)) : -1;

        const newItem = {
            name: 'New Item',
            subtitle: 'Edit this item',
            unit: 'pcs',
            category: categoryName,
            order: 0, // First item in the new category
            categoryOrder: maxCategoryOrder + 100, // Put new category at the end
            createdAt: new Date().toISOString()
        };

        const docRef = await addDoc(collection(db, "inventory-items"), newItem);
        const itemWithId = { id: docRef.id, ...newItem };
        inventoryItems.push(itemWithId);

        // Initialize quantities
        const dateQuantities = getCurrentDateQuantities();
        dateQuantities[docRef.id] = { opening: 0, closing: 0 };

        localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(inventoryItems));
        saveCurrentDateQuantities();

        renderInventory();
        showSyncIndicator('Category added', 'success');

    } catch (error) {
        console.error('Error adding category:', error);
        showSyncIndicator('Failed to add category', 'error');
    }
}

function updateCategoryDropdown() {
    const categorySelect = document.getElementById('itemCategory');

    // Get categories from existing items
    const categoriesFromItems = [...new Set(inventoryItems.map(item => item.category))];

    // Get custom categories from localStorage
    const customCategories = JSON.parse(localStorage.getItem('custom-categories') || '[]');

    // Combine and deduplicate
    const allCategories = [...new Set([...categoriesFromItems, ...customCategories])];

    // Sort them
    allCategories.sort();

    // Clear and rebuild dropdown
    categorySelect.innerHTML = '';

    allCategories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category === 'Other' ? 'Uncategorized' : category;
        categorySelect.appendChild(option);
    });
}

function eraseDataForToday() {
    const dateKey = getDateKey();
    delete quantities[dateKey];
    saveQuantitiesToLocal();
    renderInventory();
    showSyncIndicator('Today\'s data erased', 'info');
}

// For console access - remove this in production
window.eraseToday = eraseDataForToday;

