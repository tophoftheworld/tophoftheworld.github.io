import { db } from './firebase-inventory.js';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

// Local storage keys
const STORAGE_KEYS = {
    INVENTORY: 'inventory/_config/items',
    QUANTITIES: 'inventory-quantities',
    LAST_SYNC: 'inventory-last_sync',
    CATEGORY_ORDERS: 'inventory-category-orders'
};

// Global state
let inventoryItems = [];
let quantities = {};
let currentMode = 'opening';
let isOnline = navigator.onLine;
let currentDate = new Date(); // Initialize with current date
let isReorderMode = false; // Add this
let customCategories = []; // Add this
let editingItemId = null; // Add this
let categoryOrderMap = {}; // Loaded from categories collection
let isDesktop = false; // Track if we're on desktop/tablet

// Helper function to format numbers with commas
function formatNumberWithCommas(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Function to detect screen size and apply appropriate class
function updateScreenSize() {
    const width = window.innerWidth;
    isDesktop = width >= 600;
    
    // Remove all layout classes first
    document.body.classList.remove('desktop-layout', 'mobile-layout');
    
    // Apply the correct class
    if (isDesktop) {
        document.body.classList.add('desktop-layout');
        console.log(`✅ Applied desktop-layout class. Width: ${width}px`);
    } else {
        document.body.classList.add('mobile-layout');
        console.log(`✅ Applied mobile-layout class. Width: ${width}px`);
    }
    
    // Debug: Show current body classes
    console.log('Body classes:', document.body.className);
    
    // Debug: Check if control buttons exist and their flex direction
    const controlButtons = document.querySelectorAll('.control-buttons');
    if (controlButtons.length > 0) {
        const firstButton = controlButtons[0];
        const computedStyle = window.getComputedStyle(firstButton);
        console.log('First control-buttons flex-direction:', computedStyle.flexDirection);
    }
}

// Quantity control functions
let holdTimer = null;
let holdInterval = null;
let isHolding = false;

let currentBranch = localStorage.getItem('selected-branch') || 'sm-north';
let availableBranches = ['sm-north', 'podium', 'moa'];
let allBranches = []; // Will be loaded from Firebase

let syncTimeouts = new Map(); // Store timeout IDs per item
const SYNC_DELAY = 2000; // 2 seconds delay

// Cache functions for instant loading
function loadInventoryItemsFromCache() {
  try {
    const cached = localStorage.getItem(`${STORAGE_KEYS.INVENTORY}-${currentBranch}`);
    if (!cached) {
      console.log('❌ No cached inventory items found');
      return null;
    }
    
    const parseStart = performance.now();
    const cacheData = JSON.parse(cached);
    const parseTime = performance.now() - parseStart;
    
    // Ensure cacheData is an array
    if (!Array.isArray(cacheData)) {
      console.warn('Cached data is not an array, returning null');
      return null;
    }
    
    console.log('📦 Loading inventory items from cache (parse:', parseTime.toFixed(2), 'ms)');
    console.log('📦 Cached inventory items count:', cacheData.length);
    return cacheData;
  } catch (error) {
    console.error('Error loading cached inventory items:', error);
    return null;
  }
}

function cacheInventoryItems(items) {
  try {
    localStorage.setItem(`${STORAGE_KEYS.INVENTORY}-${currentBranch}`, JSON.stringify(items));
    console.log('📦 Inventory items cached:', items.length, 'items');
  } catch (error) {
    console.error('Error caching inventory items:', error);
  }
}

// Cache functions for category orders
function loadCategoryOrdersFromCache() {
  try {
    const cached = localStorage.getItem(STORAGE_KEYS.CATEGORY_ORDERS);
    if (!cached) {
      console.log('❌ No cached category orders found');
      return null;
    }
    
    const parseStart = performance.now();
    const cacheData = JSON.parse(cached);
    const parseTime = performance.now() - parseStart;
    
    console.log('📦 Loading category orders from cache (parse:', parseTime.toFixed(2), 'ms)');
    console.log('📦 Cached category orders:', Object.keys(cacheData).length, 'categories');
    return cacheData;
  } catch (error) {
    console.error('Error loading cached category orders:', error);
    return null;
  }
}

function cacheCategoryOrders(orders) {
  try {
    localStorage.setItem(STORAGE_KEYS.CATEGORY_ORDERS, JSON.stringify(orders));
    console.log('📦 Category orders cached:', Object.keys(orders).length, 'categories');
  } catch (error) {
    console.error('Error caching category orders:', error);
  }
}


// Background sync for inventory items
async function syncInventoryItemsFromFirebaseInBackground() {
  try {
    console.log('Background sync: Loading inventory items from Firebase');
    
    const snapshot = await getDocs(collection(db, 'inventory', '_config', 'items'));
    const freshItems = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      // Filter by enabledBranches
      // If enabledBranches field doesn't exist (legacy), include the item
      // If enabledBranches is empty array [], exclude the item (disabled for all)
      // If enabledBranches has values, check if current branch is included
      const enabled = data.enabledBranches === undefined
        ? true  // Legacy items without enabledBranches field
        : data.enabledBranches.includes(currentBranch);  // Check if branch is in array
      if (!enabled) return;

      freshItems.push({ 
        id: doc.id, 
        ...data,
        // Preserve both description and subtitle fields as-is from Firebase
        // Don't copy description to subtitle - use description directly in UI
        order: data.order || data.displayOrder || 0
      });
    });
    
    // Always update inventoryItems from Firebase to capture any field changes
    // (restockAmount, description, unit, enabledBranches, etc.) not just structural ones
    const currentItemsJson = JSON.stringify(inventoryItems.map(item => ({
      id: item.id, name: item.name, category: item.category,
      restockAmount: item.restockAmount, description: item.description,
      subtitle: item.subtitle, unit: item.unit, order: item.order
    })));
    const freshItemsJson = JSON.stringify(freshItems.map(item => ({
      id: item.id, name: item.name, category: item.category,
      restockAmount: item.restockAmount, description: item.description,
      subtitle: item.subtitle, unit: item.unit, order: item.order
    })));

    if (currentItemsJson !== freshItemsJson) {
      console.log('🔄 Background sync: Inventory items have changed, updating');
      inventoryItems = freshItems;
      
      // Cache the fresh data
      cacheInventoryItems(inventoryItems);
      
      // Re-render inventory
      renderInventory();
      
      showSyncIndicator('Inventory updated', 'success');
    } else {
      console.log('Background sync: Inventory items are up to date');
    }
  } catch (error) {
    console.error('Error syncing inventory items:', error);
  }
}

// Simple connectivity check
async function testFirebaseConnection() {
    try {
        // Small, read-only query
        await getDocs(collection(db, 'inventory', '_config', 'items'));
        return true;
    } catch (e) {
        console.warn('Firebase connectivity test failed:', e);
        return false;
    }
}

document.addEventListener('DOMContentLoaded', async function () {
    console.log('DOM loaded, checking branchSelect...');
    const branchSelect = document.getElementById('branchSelect');
    console.log('branchSelect found:', !!branchSelect);

    // Initialize screen size detection
    updateScreenSize();
    window.addEventListener('resize', updateScreenSize);

    // Initialize date display immediately
    updateDateDisplay();

    // Setup event listeners immediately for responsive UI
    setupEventListeners();
    
    // Load cached data instantly for immediate display
    loadLocalData();
    
    // Initialize app in background (non-blocking)
    initializeApp();

    // Force update dropdown after everything loads
    setTimeout(() => {
        console.log('Forcing dropdown update...');
        updateBranchDropdown();
    }, 500);
});

async function initializeApp() {
    console.log('🔧 Initializing app in background...');
    
    // Check online status
    window.addEventListener('online', () => {
        isOnline = true;
        console.log('🌐 Back online - syncing with Firebase');
        syncWithFirebase();
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        console.log('📴 Gone offline');
        showSyncIndicator('Offline', 'error');
    });

    try {
        // Test Firebase connection first (but don't block if it fails)
        if (isOnline) {
            const connectionOK = await testFirebaseConnection();
            if (!connectionOK) {
                console.log('⚠️ Firebase connection failed, using offline mode');
                showSyncIndicator('Using offline mode', 'info');
                return; // Don't call loadLocalData() here - it's already been called
            }
        }

        // Load branches from Firebase (non-blocking)
        await loadBranchesFromFirebase();

        // Load category order mapping
        await loadCategoryOrders();

        // Initialize branch dropdown
        updateBranchDropdown();
        console.log('✅ Branch dropdown updated');

        // Set the dropdown to the saved branch
        const branchSelect = document.getElementById('branchSelect');
        if (branchSelect) {
            branchSelect.value = currentBranch;
            console.log('Set dropdown to currentBranch:', currentBranch, 'Actual value:', branchSelect.value);

            // If the saved branch doesn't exist in dropdown, force add it
            if (branchSelect.value !== currentBranch) {
                console.log('Branch not found, force adding:', currentBranch);
                const option = document.createElement('option');
                option.value = currentBranch;
                option.textContent = getBranchDisplayName(currentBranch);
                branchSelect.appendChild(option);
                branchSelect.value = currentBranch;
            }
        }

        // Sync with Firebase in background (non-blocking)
        if (isOnline) {
            console.log('🔄 Starting background Firebase sync from initializeApp');
            syncWithFirebase();
        }

    } catch (error) {
        console.error('❌ App initialization error:', error);
        showSyncIndicator(`Init failed: ${error.message}`, 'error');
        // Don't call loadLocalData() here - it's already been called in DOMContentLoaded
    }
    
    console.log('✅ App initialization complete');
}
// Load categories order mapping from Firebase
async function loadCategoryOrders() {
    try {
        const snapshot = await getDocs(collection(db, 'inventory', '_config', 'categories'));
        const mapping = {};
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data && typeof data.order === 'number') {
                mapping[data.name] = data.order;
            }
        });
        categoryOrderMap = mapping;
        
        // Cache the category orders for instant loading next time
        cacheCategoryOrders(categoryOrderMap);
        
        // console.log('Loaded categoryOrderMap:', categoryOrderMap);
    } catch (err) {
        console.warn('Failed to load categories; using default order', err);
        // Fallback default ordering if categories collection is missing
        categoryOrderMap = {
            'Base Ingredients': 0,
            'Packaging & Consumables': 1,
            'Liquid Ingredients': 2,
            'Dry Ingredients': 3,
            'Desserts': 4
        };
        
        // Cache the fallback order as well
        cacheCategoryOrders(categoryOrderMap);
    }
}


// Global variables for compact header
let compactInfoRow = null;

function updateCompactInfo() {
    if (!compactInfoRow) return;

    const dateText = currentDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    });

    // Get a shorter branch name for compact view
    let branchText = getBranchDisplayName(currentBranch);

    // Truncate long popup names
    if (branchText.length > 25) {
        branchText = branchText.substring(0, 22) + '...';
    }

    const modeText = currentMode === 'opening' ? 'Opening' : 'Closing';

    compactInfoRow.innerHTML = `
        <span>${dateText}</span>
        <span class="compact-mode ${currentMode}">${modeText}</span>
        <span class="compact-branch">${branchText}</span>
    `;
}

function setupEventListeners() {
    // Toggle buttons
    document.querySelectorAll('.toggle-btn').forEach(button => {
        button.addEventListener('click', function () {
            const newMode = this.getAttribute('data-mode');

            // Don't animate if same mode
            if (newMode === currentMode) return;

            showModeSwitchConfirmation(newMode);
        });
    });

    // Add item button and modal
    const modalOverlay = document.getElementById('modalOverlay');
    const modalClose = document.getElementById('modalClose');
    const cancelBtn = document.getElementById('cancelBtn');
    const addItemForm = document.getElementById('addItemForm');

    // Add category modal
    const addCategoryModalOverlay = document.getElementById('addCategoryModalOverlay');
    const addCategoryModalClose = document.getElementById('addCategoryModalClose');
    const addCategoryCancelBtn = document.getElementById('addCategoryCancelBtn');
    const addCategoryConfirmBtn = document.getElementById('addCategoryConfirmBtn');

    if (addCategoryModalClose) addCategoryModalClose.addEventListener('click', () => closeAddCategoryModal());
    if (addCategoryCancelBtn) addCategoryCancelBtn.addEventListener('click', () => closeAddCategoryModal());
    if (addCategoryConfirmBtn) addCategoryConfirmBtn.addEventListener('click', handleAddCategory);
    if (addCategoryModalOverlay) {
        addCategoryModalOverlay.addEventListener('click', (e) => {
            if (e.target === addCategoryModalOverlay) closeAddCategoryModal();
        });
    }

    function closeAddCategoryModal() {
        const overlay = document.getElementById('addCategoryModalOverlay');
        if (overlay) overlay.classList.remove('show');
        const input = document.getElementById('newCategoryName');
        if (input) input.value = '';
    }

    function handleAddCategory() {
        const input = document.getElementById('newCategoryName');
        const categoryName = input ? input.value.trim() : '';
        if (categoryName) {
            addNewCategory(categoryName);
            closeAddCategoryModal();
        }
    }

    if (modalClose) modalClose.addEventListener('click', () => closeModal());
    if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal());
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });
    }

    if (addItemForm) addItemForm.addEventListener('submit', handleAddItem);

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

    if (modeSwitchModalClose) modeSwitchModalClose.addEventListener('click', cancelModeSwitch);
    if (modeSwitchCancelBtn) modeSwitchCancelBtn.addEventListener('click', cancelModeSwitch);
    if (modeSwitchConfirmBtn) modeSwitchConfirmBtn.addEventListener('click', confirmModeSwitch);
    if (modeSwitchModalOverlay) {
        modeSwitchModalOverlay.addEventListener('click', (e) => {
            if (e.target === modeSwitchModalOverlay) cancelModeSwitch();
        });
    }

    // Add Stocks functionality
    setupAddStocksEventListeners();

    preventHeaderScroll();
    initializeDatePicker();

    // Scroll-based compact header
    let lastScrollTop = 0;
    const scrollableContent = document.querySelector('.scrollable-content');
    const datePickerContainer = document.querySelector('.date-picker-container');

    // Create compact info row element
    compactInfoRow = document.createElement('div');
    compactInfoRow.className = 'compact-info-row';
    if (datePickerContainer) datePickerContainer.appendChild(compactInfoRow);

    // Initial update
    updateCompactInfo();

    if (scrollableContent) {
        scrollableContent.addEventListener('scroll', () => {
            const scrollTop = scrollableContent.scrollTop;
            const isScrollingDown = scrollTop > lastScrollTop;

            if (scrollTop > 40 && isScrollingDown) {
                // Make compact when scrolled down
                if (datePickerContainer && !datePickerContainer.classList.contains('compact')) {
                    datePickerContainer.classList.add('compact');
                    const header = document.querySelector('.header-container');
                    const toggle = document.querySelector('.toggle-container');
                    if (header) header.classList.add('compact');
                    if (toggle) toggle.classList.add('compact');
                    updateCompactInfo();
                }
            } else if (scrollTop <= 15) {
                // Return to normal when at top
                if (datePickerContainer && datePickerContainer.classList.contains('compact')) {
                    datePickerContainer.classList.remove('compact');
                    const header = document.querySelector('.header-container');
                    const toggle = document.querySelector('.toggle-container');
                    if (header) header.classList.remove('compact');
                    if (toggle) toggle.classList.remove('compact');
                }
            }

            lastScrollTop = scrollTop;
        });
    }

    console.log('branchSelect element:', branchSelect);
    console.log('All select elements:', document.querySelectorAll('select'));

    const branchSelectEl = document.getElementById('branchSelect');
    if (branchSelectEl) {
        branchSelectEl.addEventListener('change', handleBranchChange);
        console.log('Added event listener to branchSelect');
    } else {
        console.log('branchSelect not found!');
    }

    // Pop-up modal (guarded; currently hidden feature)
    const addPopupModalOverlay = document.getElementById('addPopupModalOverlay');
    const addPopupModalClose = document.getElementById('addPopupModalClose');
    const addPopupCancelBtn = document.getElementById('addPopupCancelBtn');
    const addPopupConfirmBtn = document.getElementById('addPopupConfirmBtn');

    if (addPopupModalClose) addPopupModalClose.addEventListener('click', () => closeAddPopupModal());
    if (addPopupCancelBtn) addPopupCancelBtn.addEventListener('click', () => closeAddPopupModal());
    if (addPopupConfirmBtn) addPopupConfirmBtn.addEventListener('click', handleAddPopup);
    if (addPopupModalOverlay) {
        addPopupModalOverlay.addEventListener('click', (e) => {
            if (e.target === addPopupModalOverlay) closeAddPopupModal();
        });
    }

    // Photo upload handling
    const itemPhoto = document.getElementById('itemPhoto');
    const photoPreview = document.getElementById('photoPreview');
    const previewImage = document.getElementById('previewImage');
    const removePhoto = document.getElementById('removePhoto');

    if (itemPhoto) itemPhoto.addEventListener('change', handlePhotoSelect);
    if (removePhoto) removePhoto.addEventListener('click', handlePhotoRemove);

    // Initialize admin features
    initializeAdminFeatures();
}

function handlePhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file size (max 2MB since we'll resize it anyway)
    if (file.size > 2 * 1024 * 1024) {
        showSyncIndicator('Photo too large (max 2MB)', 'error');
        event.target.value = '';
        return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
        showSyncIndicator('Please select an image file', 'error');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        previewImage.src = e.target.result;
        photoPreview.style.display = 'block';
    };
    reader.readAsDataURL(file);
}

function handlePhotoRemove() {
    document.getElementById('itemPhoto').value = '';
    document.getElementById('photoPreview').style.display = 'none';
    document.getElementById('previewImage').src = '';
}

function convertImageToBase64(file, maxWidth = 200, maxHeight = 200) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = function () {
            // Set canvas size to exactly 50x50
            canvas.width = maxWidth;
            canvas.height = maxHeight;

            // Calculate scaling to fit image in 50x50 while maintaining aspect ratio
            const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;

            // Center the image in the 50x50 canvas
            const x = (maxWidth - scaledWidth) / 2;
            const y = (maxHeight - scaledHeight) / 2;

            // Fill background with white (optional)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, maxWidth, maxHeight);

            // Draw the resized image
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

            // Convert to base64 with high compression
            const base64 = canvas.toDataURL('image/jpeg', 0.7); // 70% quality
            resolve(base64);
        };

        img.onerror = reject;

        // Create object URL to load the image
        img.src = URL.createObjectURL(file);
    });
}

function handleBranchChange(event) {
    const selectedValue = event.target.value;

    // Pop-ups disabled: ignore any new-popup path
    if (selectedValue !== currentBranch) {
        currentBranch = selectedValue;
        // Save selected branch to localStorage
        localStorage.setItem('selected-branch', currentBranch);
        console.log('Selected branch:', currentBranch);

        // Immediately load this branch's local data so UI doesn't show previous branch's values
        loadCurrentBranchLocalData();
        renderInventory();

        // Then sync with Firebase (items + quantities) for this branch
        loadBranchInventory();

        const branchName = getBranchDisplayName(currentBranch);
        showSyncIndicator(`Switched to ${branchName}`, 'info');
    }
}

/** Load inventory items and quantities from localStorage for currentBranch. Call after switching branch so UI shows the right data. */
function loadCurrentBranchLocalData() {
    // Load items from cache for this branch (same key as cacheInventoryItems uses)
    const cachedItems = loadInventoryItemsFromCache();
    if (cachedItems && Array.isArray(cachedItems)) {
        inventoryItems = cachedItems;
    } else {
        const savedItems = localStorage.getItem(`${STORAGE_KEYS.INVENTORY}-${currentBranch}`);
        if (savedItems) {
            try {
                const parsed = JSON.parse(savedItems);
                inventoryItems = Array.isArray(parsed) ? parsed : [];
            } catch (_) {
                inventoryItems = [];
            }
        } else {
            inventoryItems = [];
        }
    }

    // Load quantities from localStorage for this branch so we don't show the previous branch's values
    const savedQuantities = localStorage.getItem(`${STORAGE_KEYS.QUANTITIES}-${currentBranch}`);
    if (savedQuantities) {
        try {
            quantities = JSON.parse(savedQuantities);
            migrateQuantityData();
        } catch (_) {
            quantities = {};
        }
    } else {
        quantities = {};
    }
}

async function loadBranchesFromFirebase() {
    try {
        console.log('Loading branches from Firebase...');
        const snapshot = await getDocs(collection(db, "branches"));
        const firebaseBranches = [];
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            // Skip pop-ups for now
            if (data.type === 'popup' || /^popup-/.test(data.key || '')) return;
            console.log('Found branch:', data);
            firebaseBranches.push(data);
        });

        allBranches = firebaseBranches;
        localStorage.setItem('branches-cache', JSON.stringify(allBranches));
        console.log('Total branches loaded:', allBranches.length);

        // Update dropdown immediately after loading
        updateBranchDropdown();

        return allBranches;
    } catch (error) {
        console.error('Error loading branches:', error);
        // Fallback to local cache
        const cached = localStorage.getItem('branches-cache');
        allBranches = cached ? JSON.parse(cached) : [];
        console.log('Using cached branches:', allBranches.length);
        updateBranchDropdown();
        return allBranches;
    }
}

async function saveBranchToFirebase(branchData) {
    try {
        const docRef = await addDoc(collection(db, "branches"), branchData);
        return { id: docRef.id, ...branchData };
    } catch (error) {
        console.error('Error saving branch:', error);
        throw error;
    }
}

function getBranchDisplayName(branchKey) {
    if (branchKey === 'sm-north') return 'SM North';
    if (branchKey === 'podium') return 'Podium';
    if (branchKey === 'moa') return 'MOA';
    return branchKey;
}

function updateBranchDropdown() {
    const branchSelect = document.getElementById('branchSelect');
    if (!branchSelect) return;

    // Clear existing options
    branchSelect.innerHTML = '';

    // Add fixed branches only
    const smOption = document.createElement('option');
    smOption.value = 'sm-north';
    smOption.textContent = 'SM North';
    branchSelect.appendChild(smOption);

    const podiumOption = document.createElement('option');
    podiumOption.value = 'podium';
    podiumOption.textContent = 'Podium';
    branchSelect.appendChild(podiumOption);

    const moaOption = document.createElement('option');
    moaOption.value = 'moa';
    moaOption.textContent = 'MOA';
    branchSelect.appendChild(moaOption);

    // Set the current branch value
    branchSelect.value = currentBranch;

    // If the current branch isn't found in the dropdown, add it manually (edge case)
    if (branchSelect.value !== currentBranch) {
        const option = document.createElement('option');
        option.value = currentBranch;
        option.textContent = getBranchDisplayName(currentBranch);
        branchSelect.appendChild(option);
        branchSelect.value = currentBranch;
    }
}

function openAddPopupModal() {
    const overlay = document.getElementById('addPopupModalOverlay');
    if (overlay) {
        overlay.classList.add('show');
        const input = document.getElementById('newPopupName');
        if (input) input.focus();
    }
}

function closeAddPopupModal() {
    const overlay = document.getElementById('addPopupModalOverlay');
    if (overlay) overlay.classList.remove('show');
    const input = document.getElementById('newPopupName');
    if (input) input.value = '';
}

async function handleAddPopup() {
    // Disabled path for now
    showSyncIndicator('Pop-ups are disabled in this version', 'info');
}

function loadBranchInventory() {
    // Load inventory items for current branch from Firebase
    syncWithFirebase();
}

async function syncWithFirebase() {
    if (!isOnline) {
        console.log('📴 Offline - skipping Firebase sync');
        return;
    }

    try {
        console.log('🔄 Starting Firebase sync (background operation)...');
        showSyncIndicator('Syncing with server...', 'info');

        // Query items for current branch only
        const snapshot = await getDocs(collection(db, 'inventory', '_config', 'items'));
        const firebaseItems = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Filter by enabledBranches
            // If enabledBranches field doesn't exist (legacy), include the item
            // If enabledBranches is empty array [], exclude the item (disabled for all)
            // If enabledBranches has values, check if current branch is included
            const enabled = data.enabledBranches === undefined
              ? true  // Legacy items without enabledBranches field
              : data.enabledBranches.includes(currentBranch);  // Check if branch is in array
            if (!enabled) return;

            firebaseItems.push({ 
                id: doc.id, 
                ...data,
                // Preserve both description and subtitle fields as-is from Firebase
                // Don't copy description to subtitle - use description directly in UI
                // categoryOrder removed; use categories mapping during render
                order: data.order || data.displayOrder || 0,
                // Migrate defaultRestockLevel to restockAmount for consistency
                restockAmount: data.restockAmount || data.defaultRestockLevel || 0
            });
            
        });

        // Check if data has actually changed before updating
        const currentItemsJson = JSON.stringify(inventoryItems.map(item => ({ id: item.id, name: item.name, category: item.category })));
        const freshItemsJson = JSON.stringify(firebaseItems.map(item => ({ id: item.id, name: item.name, category: item.category })));
        
        if (currentItemsJson !== freshItemsJson) {
            console.log('🔄 Firebase data has changed, updating inventory');
            inventoryItems = firebaseItems;
            
            // Cache the fresh data
            cacheInventoryItems(inventoryItems);
            
            console.log('✅ Updated inventory items:', inventoryItems.map(item => ({ 
              name: item.name, 
              category: item.category, 
              categoryOrder: item.categoryOrder, 
              order: item.order 
            })));
            

            renderInventory();
            showSyncIndicator(`Updated ${firebaseItems.length} items`, 'success');
        } else {
            console.log('✅ Firebase data is up to date');
            showSyncIndicator('Data is up to date', 'success');
        }
        
        await loadQuantitiesFromFirebase();

    } catch (error) {
        console.error('❌ Firebase sync error:', error);
        showSyncIndicator(`Sync failed: ${error.message}`, 'error');

        // Don't call loadLocalData() here as it would interfere with the current display
        // The local data should already be loaded and displayed
    }
}

async function loadQuantitiesFromFirebase() {
    if (!isOnline) return;

    try {
        // Don't load quantities if no items are loaded yet
        if (inventoryItems.length === 0) {
            return;
        }

        const dateKey = getDateKey();

        // Start with a clean slate for this branch/date so we never show another branch's data
        quantities[dateKey] = {};
        inventoryItems.forEach(item => {
            quantities[dateKey][item.id] = {
                opening: { value: 0, checked: false },
                closing: { value: 0, checked: false },
                added: { value: 0, checked: false },
                adjustments: []
            };
        });

        // Get daily document from branch subcollection
        const docRef = doc(db, 'inventory-quantities', currentBranch, 'daily-quantities', dateKey);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const firebaseQuantities = data.quantities || {};

            // Merge Firebase quantities with current quantities
            Object.keys(firebaseQuantities).forEach(itemId => {
                // Initialize item if it doesn't exist
                if (!quantities[dateKey][itemId]) {
                    quantities[dateKey][itemId] = {
                        opening: { value: 0, checked: false },
                        closing: { value: 0, checked: false },
                        added: { value: 0, checked: false }
                    };
                }

                // Ensure added field exists
                if (!quantities[dateKey][itemId].added) {
                    quantities[dateKey][itemId].added = { value: 0, checked: false };
                }
                // Ensure adjustments array exists
                if (!quantities[dateKey][itemId].adjustments) {
                    quantities[dateKey][itemId].adjustments = [];
                }

                // Update from Firebase data
                if (firebaseQuantities[itemId].opening) {
                    quantities[dateKey][itemId].opening = firebaseQuantities[itemId].opening;
                }
                if (firebaseQuantities[itemId].closing) {
                    quantities[dateKey][itemId].closing = firebaseQuantities[itemId].closing;
                }
                if (firebaseQuantities[itemId].added) {
                    quantities[dateKey][itemId].added = firebaseQuantities[itemId].added;
                }
                // Load adjustments array if it exists
                if (firebaseQuantities[itemId].adjustments && Array.isArray(firebaseQuantities[itemId].adjustments)) {
                    quantities[dateKey][itemId].adjustments = firebaseQuantities[itemId].adjustments;
                }
            });

            showSyncIndicator(`Synced quantities for ${dateKey}`, 'info');
        }

        saveQuantitiesToLocal();
        renderInventory();

    } catch (error) {
        console.error('Error loading quantities from Firebase:', error);
        showSyncIndicator(`Quantity sync failed: ${error.message}`, 'error');
    }
}

async function debugBranchAccess() {
    console.log('Current branch:', currentBranch);
    console.log('All branches:', allBranches);
    console.log('Collection name:', 'inventory/_config/items');

    try {
        const testCollection = collection(db, 'inventory', '_config', 'items');
        const testSnapshot = await getDocs(testCollection);
        console.log('Collection access test successful, docs:', testSnapshot.size);
    } catch (error) {
        console.error('Collection access test failed:', error);
    }
}

// Make it available in console for debugging
window.debugBranchAccess = debugBranchAccess;

let pendingModeSwitch = null;

// Check if there are unchecked items in opening mode
function getUncheckedOpeningItems() {
    if (currentMode !== 'opening') return [];
    
    const dateQuantities = getCurrentDateQuantities();
    const uncheckedItems = [];
    
    inventoryItems.forEach(item => {
        const itemQuantities = dateQuantities[item.id];
        if (itemQuantities && !itemQuantities.opening?.checked) {
            uncheckedItems.push(item);
        }
    });
    
    return uncheckedItems;
}

// Check if there are unchecked items in closing mode
function getUncheckedClosingItems() {
    const dateQuantities = getCurrentDateQuantities();
    const uncheckedItems = [];
    
    inventoryItems.forEach(item => {
        const itemQuantities = dateQuantities[item.id];
        if (itemQuantities && !itemQuantities.closing?.checked) {
            uncheckedItems.push(item);
        }
    });
    
    return uncheckedItems;
}

// Scroll to first unchecked closing item
function scrollToFirstUncheckedClosingItem() {
    const uncheckedItems = getUncheckedClosingItems();
    if (uncheckedItems.length === 0) return;
    
    const firstUncheckedItem = uncheckedItems[0];
    // Find the item card element - items are rendered with data-item attribute
    const quantityElement = document.querySelector(`[data-item="${firstUncheckedItem.id}"].quantity-number`);
    if (quantityElement) {
        const itemCard = quantityElement.closest('.item-card');
        if (itemCard) {
            // Use scrollIntoView for better compatibility
            itemCard.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
            
            // Highlight the item briefly
            itemCard.style.transition = 'background-color 0.3s';
            itemCard.style.backgroundColor = '#fff3cd';
            setTimeout(() => {
                itemCard.style.backgroundColor = '';
            }, 2000);
        }
    }
}

// Scroll to first unchecked item
function scrollToFirstUncheckedItem() {
    const uncheckedItems = getUncheckedOpeningItems();
    if (uncheckedItems.length === 0) return;
    
    const firstUncheckedItem = uncheckedItems[0];
    // Find the item card element - items are rendered with data-item attribute
    const quantityElement = document.querySelector(`[data-item="${firstUncheckedItem.id}"].quantity-number`);
    if (quantityElement) {
        const itemCard = quantityElement.closest('.item-card');
        if (itemCard) {
            // Use scrollIntoView for better compatibility
            itemCard.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
            
            // Highlight the item briefly
            itemCard.style.transition = 'background-color 0.3s';
            itemCard.style.backgroundColor = '#fff3cd';
            setTimeout(() => {
                itemCard.style.backgroundColor = '';
            }, 2000);
        }
    }
}

// Flag to track if we're showing unchecked items dialog
let showingUncheckedItemsDialog = false;

function showModeSwitchConfirmation(newMode) {
    pendingModeSwitch = newMode;
    showingUncheckedItemsDialog = false;

    const modal = document.getElementById('modeSwitchModalOverlay');
    const title = document.getElementById('modeSwitchTitle');
    const message = document.getElementById('modeSwitchMessage');
    const cancelBtn = document.getElementById('modeSwitchCancelBtn');
    const confirmBtn = document.getElementById('modeSwitchConfirmBtn');

    // Check for unchecked items when switching from opening to closing
    if (newMode === 'closing' && currentMode === 'opening') {
        const uncheckedItems = getUncheckedOpeningItems();
        
        if (uncheckedItems.length > 0) {
            // Show unchecked items warning
            showingUncheckedItemsDialog = true;
            title.textContent = 'Incomplete Inventory';
            const itemCount = uncheckedItems.length;
            const itemText = itemCount === 1 ? 'item' : 'items';
            message.innerHTML = `<p>${itemCount} ${itemText} still need to be checked.</p>`;
            
            // Hide cancel button, show only one button
            if (cancelBtn) cancelBtn.style.display = 'none';
            if (confirmBtn) {
                confirmBtn.textContent = 'Show items';
            }
            
            modal.classList.add('show');
            return;
        }
    }

    // Normal confirmation flow
    showingUncheckedItemsDialog = false;
    if (newMode === 'closing') {
        title.textContent = 'Submit Opening Inventory?';
        message.innerHTML = `<p>This will submit your opening inventory.</p>`;
    } else {
        title.textContent = 'Edit Opening Inventory?';
        message.innerHTML = `<p>You can edit your opening inventory.</p>`;
    }
    
    // Show both buttons for normal flow
    if (cancelBtn) cancelBtn.style.display = '';
    if (confirmBtn) {
        confirmBtn.textContent = 'Continue';
    }

    modal.classList.add('show');
}

async function confirmModeSwitch() {
    // Handle incomplete closing dialog for download
    if (showingIncompleteClosingDialog) {
        const modal = document.getElementById('modeSwitchModalOverlay');
        modal.classList.remove('show');
        showingIncompleteClosingDialog = false;
        
        // Running Low page should already be closed, but ensure it's closed
        closeRunningLowPage();
        
        // Switch to closing mode first if not already there
        if (currentMode !== 'closing') {
            // Switch mode
            document.querySelectorAll('.toggle-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            const closingBtn = document.querySelector(`[data-mode="closing"]`);
            if (closingBtn) {
                closingBtn.classList.add('active');
                currentMode = 'closing';
                animateInventorySwitch('closing');
                renderInventory();
            }
        }
        
        // Wait a bit for render, then scroll
        setTimeout(() => {
            scrollToFirstUncheckedClosingItem();
        }, 300);
        return;
    }
    
    if (!pendingModeSwitch) return;
    
    // Handle unchecked items dialog for mode switch
    if (showingUncheckedItemsDialog) {
        const modal = document.getElementById('modeSwitchModalOverlay');
        modal.classList.remove('show');
        scrollToFirstUncheckedItem();
        pendingModeSwitch = null;
        showingUncheckedItemsDialog = false;
        return;
    }

    const newMode = pendingModeSwitch;
    pendingModeSwitch = null;

    // Remove active from all buttons
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Add active to new mode button
    document.querySelector(`[data-mode="${newMode}"]`).classList.add('active');

    animateInventorySwitch(newMode);

    // Sync the completed mode if switching from opening to closing
    if (currentMode === 'opening' && newMode === 'closing') {
        await syncModeCompletion('opening');
    }

    // Close modal
    document.getElementById('modeSwitchModalOverlay').classList.remove('show');

    // Show appropriate message
    const modeMessage = newMode === 'closing' ? 'Opening inventory submitted' : 'Switched to Opening mode';
    showSyncIndicator(modeMessage, 'success');
}

function cancelModeSwitch() {
    pendingModeSwitch = null;
    showingUncheckedItemsDialog = false;
    showingIncompleteClosingDialog = false;
    document.getElementById('modeSwitchModalOverlay').classList.remove('show');
}

function loadLocalData() {
    // Load category orders from cache first for proper ordering
    const cachedCategoryOrders = loadCategoryOrdersFromCache();
    if (cachedCategoryOrders) {
        categoryOrderMap = cachedCategoryOrders;
        console.log('Loading cached category orders instantly');
    } else {
        // Use fallback default ordering if no cache
        categoryOrderMap = {
            'Base Ingredients': 0,
            'Packaging & Consumables': 1,
            'Liquid Ingredients': 2,
            'Dry Ingredients': 3,
            'Desserts': 4
        };
        console.log('Using fallback category order');
    }

    // Try to load from cache first for instant display
    const cachedItems = loadInventoryItemsFromCache();
    if (cachedItems && Array.isArray(cachedItems)) {
        console.log('Loading cached inventory items instantly');
        inventoryItems = cachedItems;
        
        // Render inventory immediately with proper category ordering
        renderInventory();
        
        // Then sync with Firebase in background
        syncInventoryItemsFromFirebaseInBackground();
    } else {
        // No cache available, load from localStorage as fallback
        const savedItems = localStorage.getItem(`${STORAGE_KEYS.INVENTORY}-${currentBranch}`);
        if (savedItems) {
            try {
                const parsedItems = JSON.parse(savedItems);
                // Ensure parsedItems is an array
                if (Array.isArray(parsedItems)) {
                    // Ensure categoryOrder is preserved
                    inventoryItems = parsedItems.map(item => ({
                        ...item,
                        categoryOrder: item.categoryOrder || 0,
                        order: item.order || item.displayOrder || 0
                    }));
                } else {
                    console.warn('Invalid inventory items format in localStorage, initializing empty array');
                    inventoryItems = [];
                }
            } catch (error) {
                console.error('Error parsing inventory items from localStorage:', error);
                inventoryItems = [];
            }
        } else {
            // No data at all, initialize empty array
            inventoryItems = [];
        }

        // Render with local data first
        renderInventory();
    }

    // Load quantities for current branch (never use another branch's data)
    const savedQuantities = localStorage.getItem(`${STORAGE_KEYS.QUANTITIES}-${currentBranch}`);
    if (savedQuantities) {
        try {
            quantities = JSON.parse(savedQuantities);
            migrateQuantityData();
        } catch (error) {
            console.error('Error parsing quantities from localStorage:', error);
            quantities = {};
        }
    } else {
        quantities = {};
    }
}

async function syncWithFirebaseBranch(collectionName) {
    // This function is no longer needed, redirect to main sync
    await syncWithFirebase();
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

    // Ensure inventoryItems is always an array
    if (!Array.isArray(inventoryItems)) {
        console.warn('inventoryItems is not an array, initializing empty array');
        inventoryItems = [];
    }

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

    // Sort categories using categoryOrderMap (from categories collection)
    const sortedCategories = Object.keys(itemsByCategory).sort((a, b) => {
        const orderA = (categoryOrderMap && typeof categoryOrderMap[a] === 'number') ? categoryOrderMap[a] : 999;
        const orderB = (categoryOrderMap && typeof categoryOrderMap[b] === 'number') ? categoryOrderMap[b] : 999;
        return orderA - orderB;
    });

    inventoryList.innerHTML = sortedCategories.map(category => {
        const categoryItems = itemsByCategory[category];

        // Sort items by their order field to preserve JSON order
        categoryItems.sort((a, b) => (a.order || 0) - (b.order || 0));

        const itemsHtml = categoryItems.map(item => {
            const dateQuantities = getCurrentDateQuantities();
            const itemQuantities = dateQuantities[item.id] || {
                opening: { value: 0, checked: false },
                closing: { value: 0, checked: false },
                added: { value: 0, checked: false }
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
                    // Show current day's opening + added value as suggestion
                    const openingValue = itemQuantities.opening?.value || 0;
                    const addedValue = itemQuantities.added?.value || 0;
                    displayValue = openingValue + addedValue;
                    isGreyedOut = true;
                }
            }

            const imageHtml = item.photo ?
                `<img src="${item.photo}" alt="${item.name}">` :
                '<span>No Image</span>';

            return `
            <div class="item-card">
                <div class="item-image">${imageHtml}</div>
                <div class="item-info">
                    <div class="item-name">${item.name}</div>
                    <div class="item-subtitle">${item.description || ''}</div>
                </div>
                <div class="item-controls">
                    <div class="quantity-display">
                        <span class="quantity-number ${isGreyedOut ? 'greyed-out' : ''}" data-item="${item.id}">${formatNumberWithCommas(displayValue)}</span>
                        <span class="quantity-unit">${item.unit}</span>
                    </div>
                    <div class="control-buttons">
                        <button class="control-btn" type="button" data-item="${item.id}" data-action="decrease">−</button>
                        <button class="control-btn" type="button" data-item="${item.id}" data-action="increase">+</button>
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
    localStorage.setItem(`${STORAGE_KEYS.QUANTITIES}-${currentBranch}`, JSON.stringify(quantities));
}

function debouncedSyncQuantity(itemId, mode) {
    // Clear existing timeout for this item
    if (syncTimeouts.has(itemId)) {
        clearTimeout(syncTimeouts.get(itemId));
    }

    // Set new timeout
    const timeoutId = setTimeout(() => {
        syncQuantityToFirebase(itemId, mode);
        syncTimeouts.delete(itemId);
    }, SYNC_DELAY);

    syncTimeouts.set(itemId, timeoutId);
}

async function syncQuantityToFirebase(itemId, mode) {
    if (!isOnline) return;

    try {
        const dateKey = getDateKey();
        const quantityData = quantities[dateKey][itemId][mode];

        // Only sync if it's been checked (user has set a value)
        if (!quantityData.checked) return;

        // Get daily document from branch subcollection
        const docRef = doc(db, 'inventory-quantities', currentBranch, 'daily-quantities', dateKey);
        
        // Get current document or create new structure
        const docSnap = await getDoc(docRef);
        const currentData = docSnap.exists() ? docSnap.data() : {
            branch: currentBranch,
            date: dateKey,
            quantities: {},
            lastUpdated: new Date().toISOString()
        };

        // Update the specific item/mode
        if (!currentData.quantities[itemId]) {
        currentData.quantities[itemId] = {
            opening: { value: 0, checked: false },
            closing: { value: 0, checked: false },
            added: { value: 0, checked: false }
        };
        }

        currentData.quantities[itemId][mode] = {
            value: quantityData.value,
            checked: quantityData.checked,
            timestamp: new Date().toISOString()
        };
        
        // If mode is 'added' and adjustments array exists, save it too
        if (mode === 'added' && quantities[dateKey][itemId].adjustments) {
            currentData.quantities[itemId].adjustments = quantities[dateKey][itemId].adjustments;
        }

        currentData.lastUpdated = new Date().toISOString();

        // Save the updated daily document
        await setDoc(docRef, currentData);

    } catch (error) {
        console.error('Error syncing quantity:', error);
        // Fail silently to not interrupt user experience
    }
}

// Keep the old function name for compatibility
function saveCurrentDateQuantities() {
    saveQuantitiesToLocal();
}

async function handleAddItem(e) {
    e.preventDefault();

    const initialQty = parseInt(document.getElementById('initialQuantity').value) || 0;
    const selectedCategory = document.getElementById('itemCategory').value;

    const itemData = {
        name: document.getElementById('itemName').value.trim(),
        subtitle: document.getElementById('itemSubtitle').value.trim(),
        unit: document.getElementById('itemUnit').value,
        category: selectedCategory,
        restockAmount: parseInt(document.getElementById('restockAmount').value) || 0,
        branch: currentBranch  // Add this line
    };

    // Handle photo upload
    const photoFile = document.getElementById('itemPhoto').files[0];
    if (photoFile) {
        try {
            itemData.photo = await convertImageToBase64(photoFile);
        } catch (error) {
            console.error('Error processing photo:', error);
            showSyncIndicator('Failed to process photo', 'error');
            return;
        }
    } else if (editingItemId) {
        // Keep existing photo when editing without changing photo
        const existingItem = inventoryItems.find(item => item.id === editingItemId);
        if (existingItem && existingItem.photo) {
            itemData.photo = existingItem.photo;
        }
    }

    // Only add createdAt for new items
    if (!editingItemId) {
        itemData.createdAt = new Date().toISOString();
    }

    const collectionName = 'inventory/_config/items';

    try {
        if (editingItemId) {
            // Editing existing item
            showSyncIndicator('Updating item...', 'info');

            try {
                // Update in Firebase
                const itemDoc = doc(db, 'inventory', '_config', 'items', editingItemId);
                await updateDoc(itemDoc, itemData);

                // Update local array
                const itemIndex = inventoryItems.findIndex(item => item.id === editingItemId);
                if (itemIndex !== -1) {
                    inventoryItems[itemIndex] = { ...inventoryItems[itemIndex], ...itemData };
                    localStorage.setItem(`${STORAGE_KEYS.INVENTORY}-${currentBranch}`, JSON.stringify(inventoryItems));
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

            const docRef = await addDoc(collection(db, 'inventory', '_config', 'items'), itemData);
            const newItem = { id: docRef.id, ...itemData };
            inventoryItems.push(newItem);

            const dateQuantities = getCurrentDateQuantities();
            dateQuantities[docRef.id] = {
                opening: { value: initialQty, checked: true },
                closing: { value: initialQty, checked: true }
            };

            localStorage.setItem(`${STORAGE_KEYS.INVENTORY}-${currentBranch}`, JSON.stringify(inventoryItems));
            saveQuantitiesToLocal();

            renderInventory();
            showSyncIndicator('Item added', 'success');
        }

        closeModal();

    } catch (error) {
        console.error('Error saving item:', error);
        showSyncIndicator('Failed to save item', 'error');
    }
}
function adjustQuantity(itemId, delta) {
    const dateQuantities = getCurrentDateQuantities();

    if (!dateQuantities[itemId]) {
        dateQuantities[itemId] = {
            opening: { value: 0, checked: false },
            closing: { value: 0, checked: false },
            added: { value: 0, checked: false }
        };
    }

    const currentData = dateQuantities[itemId][currentMode];

    // If not checked yet, copy the greyed out value first
    if (!currentData.checked) {
        if (currentMode === 'opening') {
            const prevDay = getPreviousDayQuantities();
            currentData.value = prevDay[itemId]?.closing?.value || 0;
        } else {
            // For closing mode, suggest opening + added amounts
            const openingValue = dateQuantities[itemId].opening?.value || 0;
            const addedValue = dateQuantities[itemId].added?.value || 0;
            currentData.value = openingValue + addedValue;
        }
        currentData.checked = true;
    }

    // Apply the delta
    currentData.value = Math.max(0, currentData.value + delta);

    const quantityElement = document.querySelector(`[data-item="${itemId}"].quantity-number`);
    if (quantityElement) {
        quantityElement.textContent = formatNumberWithCommas(currentData.value);
        quantityElement.classList.remove('greyed-out');
        animateQuantityChange(quantityElement);
    }

    saveQuantitiesToLocal();
    debouncedSyncQuantity(itemId, currentMode);
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
    if (event.target.classList.contains('quantity-number') && !event.target.closest('.stock-item-card')) {
        const span = event.target;
        const input = document.createElement('input');
        input.type = 'tel';
        input.inputMode = 'decimal';
        input.pattern = '-?[0-9]*\\.?[0-9]*';
        // Remove commas for editing (show raw number)
        input.value = span.textContent.replace(/,/g, '');
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
            newSpan.textContent = formatNumberWithCommas(parseInt(input.value) || 0);
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
            // Sync immediately for manual edits since user is done typing
            syncQuantityToFirebase(itemId, currentMode);
        });
    }
}

async function syncAllPendingQuantities() {
    // Clear all pending timeouts and sync immediately
    for (const [itemId, timeoutId] of syncTimeouts) {
        clearTimeout(timeoutId);
        // Extract mode from current state - sync both if needed
        const dateQuantities = getCurrentDateQuantities();
        if (dateQuantities[itemId]) {
            if (dateQuantities[itemId].opening.checked) {
                await syncQuantityToFirebase(itemId, 'opening');
            }
            if (dateQuantities[itemId].closing.checked) {
                await syncQuantityToFirebase(itemId, 'closing');
            }
        }
    }
    syncTimeouts.clear();
}

// Modal functions
function openModal() {
    // Update category dropdown with current categories
    updateCategoryDropdown();

    const modalOverlay = document.getElementById('modalOverlay');
    if (modalOverlay) modalOverlay.classList.add('show');
    const itemNameInput = document.getElementById('itemName');
    if (itemNameInput) itemNameInput.focus();
}

function closeModal() {
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalOverlay) modalOverlay.classList.remove('show');
    const addItemForm = document.getElementById('addItemForm');
    if (addItemForm) addItemForm.reset();

    // Reset edit state
    editingItemId = null;
    const modalHeader = document.querySelector('#modalOverlay .modal-header h3');
    if (modalHeader) modalHeader.textContent = 'Add New Item';
    const addItemBtn = document.querySelector('#modalOverlay .btn-add');
    if (addItemBtn) addItemBtn.textContent = 'Add Item';

    // Reset photo preview
    handlePhotoRemove();
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
            await addDoc(collection(db, "inventory", "_config", "items"), {
                ...item,
                branch: currentBranch,  // Add this line
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
    if (prevBtn) prevBtn.addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() - 1);
        updateDateDisplay();
        
        loadQuantitiesForDate(currentDate);
        animateDateChange();
    });

    // Next date button
    if (nextBtn) nextBtn.addEventListener('click', () => {
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
    if (dateDisplay) dateDisplay.addEventListener('click', () => {
        openDateModal();
    });
}

function updateDateDisplay() {
    const dateDisplay = document.getElementById('dateDisplay');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const currentDateCopy = new Date(currentDate);
    currentDateCopy.setHours(0, 0, 0, 0);

    // Format as "Jun 18" instead of "Jun 18" to save space
    const displayText = currentDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    });

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
        if (modalMonthYear) modalMonthYear.textContent = viewDate.toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
        });

        // Clear grid
        if (dateGrid) dateGrid.innerHTML = '';

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
            if (dateGrid) dateGrid.appendChild(cell);
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

            if (dateGrid) dateGrid.appendChild(cell);
        }
    }

    function closeModal() {
        const modal = document.getElementById('dateModalOverlay');
        if (modal) modal.classList.remove('show');
    }

    // Modal controls
    const modalPrevMonth = document.getElementById('modalPrevMonth');
    const modalNextMonth = document.getElementById('modalNextMonth');
    const dateCancelBtn = document.getElementById('dateCancelBtn');
    const todayBtn = document.getElementById('todayBtn');

    if (modalPrevMonth) modalPrevMonth.onclick = () => {
        viewDate.setMonth(viewDate.getMonth() - 1);
        renderCalendar();
    };

    if (modalNextMonth) modalNextMonth.onclick = () => {
        viewDate.setMonth(viewDate.getMonth() + 1);
        renderCalendar();
    };

    if (dateCancelBtn) dateCancelBtn.onclick = closeModal;
    if (todayBtn) todayBtn.onclick = () => {
        currentDate = new Date();
        updateDateDisplay();
        closeModal();
    };

    const modalOverlay = document.getElementById('dateModalOverlay');
    if (modalOverlay) modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    // Show modal and render calendar
    if (modal) modal.classList.add('show');
    renderCalendar();
}

// Date-based inventory management
function getDateKey(date = currentDate) {
    // Use local time instead of UTC to avoid timezone issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`; // Returns "YYYY-MM-DD" in local time
}

function getCurrentDateQuantities() {
    const dateKey = getDateKey();
    if (!quantities[dateKey]) {
        quantities[dateKey] = {};
        // Initialize with zeros for all items
        inventoryItems.forEach(item => {
            quantities[dateKey][item.id] = {
                opening: { value: 0, checked: false },
                closing: { value: 0, checked: false },
                added: { value: 0, checked: false },
                adjustments: []
            };
        });
    } else {
        // Ensure all items exist in current date with proper format
        inventoryItems.forEach(item => {
            if (!quantities[dateKey][item.id]) {
                quantities[dateKey][item.id] = {
                    opening: { value: 0, checked: false },
                    closing: { value: 0, checked: false },
                    added: { value: 0, checked: false },
                    adjustments: []
                };
            } else {
                // Migrate old format if needed
                const itemData = quantities[dateKey][item.id];
                if (typeof itemData.opening === 'number') {
                    quantities[dateKey][item.id] = {
                        opening: { value: itemData.opening, checked: true },
                        closing: { value: itemData.closing, checked: true },
                        added: { value: itemData.added || 0, checked: false },
                        adjustments: []
                    };
                }
                // Ensure adjustments array exists
                if (!quantities[dateKey][item.id].adjustments) {
                    quantities[dateKey][item.id].adjustments = [];
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
                closing: { value: 0, checked: false },
                added: { value: 0, checked: false },
                adjustments: []
            };
        });
    }

    loadQuantitiesFromFirebase();
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

async function syncModeCompletion(mode) {
    if (!isOnline) return;

    try {
        // First sync any pending individual changes
        await syncAllPendingQuantities();

        const dateKey = getDateKey();
        const timestamp = new Date().toISOString();

        // Get daily document from branch subcollection
        const docRef = doc(db, 'inventory-quantities', currentBranch, 'daily-quantities', dateKey);
        
        // Get current document or create new structure
        const docSnap = await getDoc(docRef);
        const currentData = docSnap.exists() ? docSnap.data() : {
            branch: currentBranch,
            date: dateKey,
            quantities: {},
            lastUpdated: timestamp
        };

        // Update all quantities for this mode
        const dateQuantities = getCurrentDateQuantities();
        Object.keys(dateQuantities).forEach(itemId => {
            const quantityData = dateQuantities[itemId][mode];
            if (quantityData.checked) {
                if (!currentData.quantities[itemId]) {
        currentData.quantities[itemId] = {
            opening: { value: 0, checked: false },
            closing: { value: 0, checked: false },
            added: { value: 0, checked: false }
        };
                }

                currentData.quantities[itemId][mode] = {
                    value: quantityData.value,
                    checked: true,
                    timestamp: timestamp
                };
            }
        });

        currentData.lastUpdated = timestamp;
        await setDoc(docRef, currentData);

        // Send email notification for closing inventory (non-blocking)
        if (mode === 'closing') {
            sendInventoryReportEmail(currentBranch, dateKey, currentData).catch(err => {
                console.error('Email sending failed (non-critical):', err);
            });
        }

        showSyncIndicator(`${mode} inventory submitted`, 'success');

    } catch (error) {
        console.error('Error syncing mode completion:', error);
        showSyncIndicator('Failed to submit inventory', 'error');
    }
}

// Email sending function using EmailJS
async function sendInventoryReportEmail(branch, date, data) {
    // Configure EmailJS - REPLACE THESE WITH YOUR VALUES
    const EMAILJS_SERVICE_ID = 'YOUR_SERVICE_ID';
    const EMAILJS_TEMPLATE_ID = 'YOUR_TEMPLATE_ID';
    const EMAILJS_PUBLIC_KEY = 'YOUR_PUBLIC_KEY';
    const RECIPIENT_EMAIL = 'manager@matchanese.com'; // Change to your email

    // Initialize EmailJS
    if (typeof emailjs === 'undefined') {
        console.error('EmailJS not loaded');
        return;
    }

    emailjs.init(EMAILJS_PUBLIC_KEY);

    const branchLabel = branch === 'sm-north' ? 'SM North' : branch === 'podium' ? 'Podium' : 'MOA';
    
    // Count items with closing quantities
    const closingItems = Object.keys(data.quantities || {}).filter(itemId => {
        return data.quantities[itemId].closing?.checked === true;
    }).length;

    const emailContent = `
        <h2>Inventory Closing Report - ${branchLabel}</h2>
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Branch:</strong> ${branchLabel}</p>
        <hr>
        <p><strong>Items Counted:</strong> ${closingItems}</p>
        <p><strong>Total Items:</strong> ${Object.keys(data.quantities || {}).length}</p>
        <hr>
        <p>Closing inventory has been submitted successfully.</p>
        <p>Last Updated: ${new Date(data.lastUpdated || Date.now()).toLocaleString('en-PH')}</p>
    `;

    try {
        await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            to_email: RECIPIENT_EMAIL,
            subject: `Inventory Closing Report - ${branchLabel} - ${date}`,
            message: emailContent,
            branch: branchLabel,
            date: date,
            items_count: closingItems
        });
        console.log('✅ Inventory report email sent');
    } catch (error) {
        console.error('❌ Failed to send email:', error);
    }
}

function getPreviousDayQuantities() {
    const prevDate = new Date(currentDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateKey = getDateKey(prevDate);
    return quantities[prevDateKey] || {};
}

async function animateDateChange() {
    const inventoryList = document.querySelector('.inventory-list');
    const scrollableContent = document.querySelector('.scrollable-content');

    scrollableContent.classList.add('animating');

    // Fade out
    inventoryList.style.opacity = '0';

    setTimeout(async () => {
        // Update content while invisible
        renderInventory();
        await loadQuantitiesFromFirebase();

        // Fade in
        inventoryList.style.opacity = '1';

        setTimeout(() => {
            scrollableContent.classList.remove('animating');
        }, 200);
    }, 150);
}

// Admin functionality
function initializeAdminFeatures() {

    if (window.innerWidth < 768) return;

    // Disabled for user app - item editing should only be in admin.html
    // document.addEventListener('click', handleItemEdit);

    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const jsonFileInput = document.getElementById('jsonFileInput');

    if (exportBtn) {
        exportBtn.addEventListener('click', exportInventoryToJSON);
    }

    if (importBtn) {
        importBtn.addEventListener('click', () => {
            jsonFileInput.click();
        });
    }

    if (jsonFileInput) {
        jsonFileInput.addEventListener('change', handleJSONImport);
    }


}

function exportInventoryToJSON() {
    try {
        // Create export data with restockAmount instead of order fields
        const exportData = inventoryItems.map(item => ({
            name: item.name,
            subtitle: item.description || '',
            unit: item.unit,
            category: item.category || 'Other',
            restockAmount: item.restockAmount || 0
        }));

        // Create and download file
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const branchName = getBranchDisplayName(currentBranch);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `inventory-${currentBranch}-${getDateKey()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showSyncIndicator(`${branchName} inventory exported`, 'success');
    } catch (error) {
        console.error('Export error:', error);
        showSyncIndicator('Export failed', 'error');
    }
}

async function handleJSONImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        showSyncIndicator('Importing...', 'info');

        const text = await file.text();
        const importData = JSON.parse(text);

        if (!Array.isArray(importData)) {
            throw new Error('Invalid JSON format - expected array');
        }

        // Validate required fields
        for (const item of importData) {
            if (!item.name || !item.unit) {
                throw new Error('Invalid item - name and unit are required');
            }
        }

        const branchName = getBranchDisplayName(currentBranch);
        // Confirm replacement
        if (!confirm(`This will replace all ${inventoryItems.length} current items in ${branchName} with ${importData.length} imported items. Continue?`)) {
            return;
        }

        const collectionName = 'inventory/_config/items';

        // Delete all existing items from Firebase for this branch
        const deleteQuery = query(
            collection(db, 'inventory', '_config', 'items'),
            where('branch', '==', currentBranch)
        );
        const deleteSnapshot = await getDocs(deleteQuery);
        const deletePromises = deleteSnapshot.docs.map(async (docSnapshot) => {
            return deleteDoc(doc(db, 'inventory', '_config', 'items', docSnapshot.id));
        });
        await Promise.all(deletePromises);

        // Add imported items to Firebase with order preserved
        const addPromises = importData.map(async (item, index) => {
            const itemData = {
                name: item.name.trim(),
                subtitle: (item.subtitle || '').trim(),
                unit: item.unit,
                category: item.category || 'Other',
                restockAmount: item.restockAmount || 0,
                order: index,
                branch: currentBranch,  // Add this line
                createdAt: new Date().toISOString()
            };
            return addDoc(collection(db, collectionName), itemData);
        });

        await Promise.all(addPromises);

        // Refresh from Firebase
        await syncWithFirebase();

        showSyncIndicator(`${importData.length} items imported to ${branchName}`, 'success');

    } catch (error) {
        console.error('Import error:', error);
        showSyncIndicator(`Import failed: ${error.message}`, 'error');
    }

    // Reset file input
    event.target.value = '';
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
    const itemNameInput = document.getElementById('itemName');
    const itemSubtitleInput = document.getElementById('itemSubtitle');
    const itemUnitInput = document.getElementById('itemUnit');
    const initialQuantityInput = document.getElementById('initialQuantity');

    if (itemNameInput) itemNameInput.value = item.name;
    if (itemSubtitleInput) itemSubtitleInput.value = item.subtitle || '';
    if (itemUnitInput) itemUnitInput.value = item.unit;
    if (initialQuantityInput) initialQuantityInput.value = 0;

    // Update category dropdown with current categories
    updateCategoryDropdown();

    // Set the selected value
    const itemCategorySelect = document.getElementById('itemCategory');
    if (itemCategorySelect) itemCategorySelect.value = item.category;

    // Change modal title
    const modalHeader = document.querySelector('#modalOverlay .modal-header h3');
    if (modalHeader) modalHeader.textContent = 'Edit Item';
    const addItemBtn = document.querySelector('#modalOverlay .btn-add');
    if (addItemBtn) addItemBtn.textContent = 'Save Changes';

    const modalOverlay = document.getElementById('modalOverlay');
    if (modalOverlay) modalOverlay.classList.add('show');
    const itemNameInputEdit = document.getElementById('itemName');
    if (itemNameInputEdit) itemNameInputEdit.focus();
    const restockAmountInput = document.getElementById('restockAmount');
    if (restockAmountInput) restockAmountInput.value = item.restockAmount || 0;

    // Handle existing photo
    const previewImage = document.getElementById('previewImage');
    const photoPreview = document.getElementById('photoPreview');
    if (previewImage) previewImage.src = item.photo || '';
    if (photoPreview) photoPreview.style.display = item.photo ? 'block' : 'none';
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
            const itemRef = doc(db, "inventory", "_config", "items", item.id);
            await updateDoc(itemRef, { category: newName });
        }

        // Also rename category doc and preserve order
        const oldId = oldName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const newId = newName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const existing = categoryOrderMap[oldName];
        await setDoc(doc(db, 'inventory', '_config', 'categories', newId), { name: newName, order: (typeof existing === 'number' ? existing : 999) });
        // Optionally delete old doc
        try { await deleteDoc(doc(db, 'inventory', '_config', 'categories', oldId)); } catch {}
        delete categoryOrderMap[oldName];
        categoryOrderMap[newName] = (typeof existing === 'number' ? existing : 999);

        // Cache the updated category order mapping
        cacheCategoryOrders(categoryOrderMap);

        saveItemsToLocal();
        showSyncIndicator('Category updated', 'success');

    } catch (error) {
        console.error('Error updating category:', error);
        showSyncIndicator('Failed to update category', 'error');
    }
}

async function saveCategoryOrder() {
        // Update category order based on DOM order (store locally only; items no longer store categoryOrder)
    const categoryElements = document.querySelectorAll('.category-section');
    let categoryOrder = 0;

    for (const categoryElement of categoryElements) {
        const categoryName = categoryElement.getAttribute('data-category');
            // Update mapping instead of per-item field
            categoryOrderMap[categoryName] = categoryOrder;

        categoryOrder++;
    }

    // Cache the updated category order mapping immediately
    cacheCategoryOrders(categoryOrderMap);

    saveItemsToLocal();

    try {
        showSyncIndicator('Saving category order...', 'info');

        // Persist category order mapping to categories collection
        const promises = Object.entries(categoryOrderMap).map(async ([name, order]) => {
            const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
            return setDoc(doc(db, 'inventory', '_config', 'categories', id), { name, order });
        });
        await Promise.all(promises);
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
            const itemRef = doc(db, "inventory", "_config", "items", item.id);
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
    const overlay = document.getElementById('addCategoryModalOverlay');
    if (overlay) overlay.classList.add('show');
    const input = document.getElementById('newCategoryName');
    if (input) input.focus();
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
            branch: currentBranch,  // Add this line
            order: 0,
            categoryOrder: maxCategoryOrder + 100,
            createdAt: new Date().toISOString()
        };

        const docRef = await addDoc(collection(db, "inventory", "_config", "items"), newItem);
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

// Debug functions for testing cache performance
window.testCacheSpeed = function() {
  const start = performance.now();
  const cachedItems = loadInventoryItemsFromCache();
  const end = performance.now();
  
  console.log(`⚡ Cache load time: ${(end - start).toFixed(2)}ms`);
  console.log(`📦 Items loaded: ${cachedItems ? cachedItems.length : 0}`);
  
  return { time: end - start, itemsCount: cachedItems ? cachedItems.length : 0 };
};

window.clearInventoryCache = function() {
  localStorage.removeItem(`${STORAGE_KEYS.INVENTORY}-${currentBranch}`);
  console.log('🗑️ Inventory cache cleared');
};

window.forceInstantLoad = function() {
  console.log('🚀 Force instant load...');
  const start = performance.now();
  
  // Load cached data directly
  const cachedItems = loadInventoryItemsFromCache();
  
  if (cachedItems) {
    inventoryItems = cachedItems;
    renderInventory();
    
    const end = performance.now();
    console.log(`⚡ Force load completed in: ${(end - start).toFixed(2)}ms`);
    showSyncIndicator('Force loaded from cache', 'success');
  } else {
    console.log('❌ No cached data available');
  }
};

// New debug function to test the loading flow
window.testLoadingFlow = function() {
  console.log('🧪 Testing loading flow...');
  console.log('Current branch:', currentBranch);
  console.log('Is online:', isOnline);
  console.log('Current inventory items count:', inventoryItems.length);
  
  // Test localStorage (this is the "cache")
  const savedItems = localStorage.getItem(`${STORAGE_KEYS.INVENTORY}-${currentBranch}`);
  console.log('localStorage test:', savedItems ? 'Data exists' : 'No data');
  
  // Test quantities
  const savedQuantities = localStorage.getItem(`${STORAGE_KEYS.QUANTITIES}-${currentBranch}`);
  console.log('Quantities test:', savedQuantities ? 'Data exists' : 'No data');
  
  // Test the cache function (which is just a wrapper around localStorage)
  const cachedItems = loadInventoryItemsFromCache();
  console.log('Cache function test:', cachedItems ? `${cachedItems.length} items` : 'No cache');
  
  return {
    branch: currentBranch,
    online: isOnline,
    itemsCount: inventoryItems.length,
    hasLocalStorage: !!savedItems,
    hasQuantities: !!savedQuantities,
    cacheFunctionWorks: !!cachedItems
  };
};

// Add Stocks functionality
let stockItems = [];
let currentAdjustmentMode = 'add'; // 'add', 'pull-out', or 'wastage'

function setupAddStocksEventListeners() {
    // Plus button to open Add Stocks page
    const addItemPlusBtn = document.getElementById('addItemPlusBtn');
    if (addItemPlusBtn) {
        addItemPlusBtn.addEventListener('click', openAddStocksPage);
    }

    // Hamburger button to open Running Low page
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', openRunningLowPage);
    }

    // Back button to close Add Stocks page
    const addStocksBackBtn = document.getElementById('addStocksBackBtn');
    if (addStocksBackBtn) {
        addStocksBackBtn.addEventListener('click', closeAddStocksPage);
    }

    // Back button to close Running Low page
    const runningLowBackBtn = document.getElementById('runningLowBackBtn');
    if (runningLowBackBtn) {
        runningLowBackBtn.addEventListener('click', closeRunningLowPage);
    }

    // Running Low Download Button - Using inline onclick handler in HTML
    // Function is attached to window object for global access
    console.log('Download button setup complete');

    // Add stock item button
    const addStockItemBtn = document.getElementById('addStockItemBtn');
    if (addStockItemBtn) {
        addStockItemBtn.addEventListener('click', () => {
            currentAdjustmentMode = 'add';
            openItemSelectionModal();
        });
    }

    // Pull out item button
    const pullOutItemBtn = document.getElementById('pullOutItemBtn');
    if (pullOutItemBtn) {
        pullOutItemBtn.addEventListener('click', () => {
            currentAdjustmentMode = 'pull-out';
            openItemSelectionModal();
        });
    }

    // Wastage item button
    const wastageItemBtn = document.getElementById('wastageItemBtn');
    if (wastageItemBtn) {
        wastageItemBtn.addEventListener('click', () => {
            currentAdjustmentMode = 'wastage';
            openItemSelectionModal();
        });
    }

    // Save stocks button
    const saveStocksBtn = document.getElementById('saveStocksBtn');
    if (saveStocksBtn) {
        saveStocksBtn.addEventListener('click', async () => {
            await saveStockAdditions();
            closeAddStocksPage();
        });
    }

    // Item selection modal
    const itemSelectionModalOverlay = document.getElementById('itemSelectionModalOverlay');
    const itemSelectionModalClose = document.getElementById('itemSelectionModalClose');
    
    if (itemSelectionModalClose) {
        itemSelectionModalClose.addEventListener('click', closeItemSelectionModal);
    }
    
    if (itemSelectionModalOverlay) {
        itemSelectionModalOverlay.addEventListener('click', (e) => {
            if (e.target === itemSelectionModalOverlay) closeItemSelectionModal();
        });
    }

    // Handle item selection
    document.addEventListener('click', (e) => {
        if (e.target.closest('.selection-item-card')) {
            const card = e.target.closest('.selection-item-card');
            const itemId = card.dataset.itemId;
            if (itemId) {
                addItemToStock(itemId);
                closeItemSelectionModal();
            }
        }
    });

    // Handle stock quantity input changes
    document.addEventListener('input', (e) => {
        if (e.target.classList.contains('quantity-number') && e.target.dataset.itemId && e.target.closest('.stock-item-card')) {
            const itemId = e.target.dataset.itemId;
            const quantity = parseFloat(e.target.value) || 0;
            updateStockQuantity(itemId, quantity);
        }
    });
}

async function openAddStocksPage() {
    const addStocksPage = document.getElementById('addStocksPage');
    if (addStocksPage) {
        addStocksPage.classList.add('show');
        
        // Load latest data from Firebase before displaying
        if (isOnline) {
            showSyncIndicator('Loading latest data...', 'info');
            await loadQuantitiesFromFirebase();
        }
        
        loadExistingStockItems();
    }
}

function loadExistingStockItems() {
    const dateQuantities = getCurrentDateQuantities();
    stockItems = [];
    
    // Load existing adjustments into stockItems
    Object.keys(dateQuantities).forEach(itemId => {
        const itemData = dateQuantities[itemId];
            const inventoryItem = inventoryItems.find(item => item.id === itemId);
        if (!inventoryItem) return;
        
        // Check if adjustments array exists and has entries (new format)
        if (itemData.adjustments && Array.isArray(itemData.adjustments) && itemData.adjustments.length > 0) {
            // Load each adjustment as a separate record
            itemData.adjustments.forEach(adjustment => {
                const value = Math.abs(adjustment.value || 0);
                if (value === 0) return; // skip zero entries
                stockItems.push({
                    id: inventoryItem.id,
                    name: inventoryItem.name,
                    subtitle: inventoryItem.subtitle,
                    description: inventoryItem.description,
                    photo: inventoryItem.photo,
                    unit: inventoryItem.unit,
                    quantity: value, // always positive for display
                    reason: adjustment.reason || (adjustment.value < 0 ? 'pulled-out' : 'delivery')
                });
            });
        } else if (itemData.added && itemData.added.value !== 0 && itemData.added.checked) {
            // Backward compatibility: load old single added value
            stockItems.push({
                id: inventoryItem.id,
                name: inventoryItem.name,
                subtitle: inventoryItem.subtitle,
                description: inventoryItem.description,
                photo: inventoryItem.photo,
                unit: inventoryItem.unit,
                quantity: Math.abs(itemData.added.value),
                reason: itemData.added.value >= 0 ? 'delivery' : 'pulled-out'
                });
        }
    });
    
    renderStockItems();
}

function closeAddStocksPage() {
    const addStocksPage = document.getElementById('addStocksPage');
    if (addStocksPage) {
        addStocksPage.classList.remove('show');
        // Reset mode when closing
        currentAdjustmentMode = 'add';
    }
}

async function openRunningLowPage() {
    const runningLowPage = document.getElementById('runningLowPage');
    
    if (runningLowPage) {
        runningLowPage.classList.add('show');
        
        // Load latest data from Firebase before displaying
        if (isOnline) {
            showSyncIndicator('Loading latest data...', 'info');
            await loadQuantitiesFromFirebase();
        }
        
        loadRunningLowItems();
    } else {
        console.error('❌ Running low page element not found!');
    }
}

function closeRunningLowPage() {
    const runningLowPage = document.getElementById('runningLowPage');
    if (runningLowPage) {
        runningLowPage.classList.remove('show');
    }
}

// Helper function to sort items by inventory order (category order, then item order)
function sortByInventoryOrder(items) {
    return items.sort((a, b) => {
        // Get category order for both items
        const categoryA = a.category || 'Other';
        const categoryB = b.category || 'Other';
        const orderA = (categoryOrderMap && typeof categoryOrderMap[categoryA] === 'number') ? categoryOrderMap[categoryA] : 999;
        const orderB = (categoryOrderMap && typeof categoryOrderMap[categoryB] === 'number') ? categoryOrderMap[categoryB] : 999;
        
        // First sort by category order
        if (orderA !== orderB) {
            return orderA - orderB;
        }
        
        // If same category, sort by item order
        const itemOrderA = a.order || a.displayOrder || 0;
        const itemOrderB = b.order || b.displayOrder || 0;
        return itemOrderA - itemOrderB;
    });
}

function loadRunningLowItems() {
    const runningLowList = document.getElementById('runningLowList');
    const noRunningLowMessage = document.getElementById('noRunningLowMessage');
    
    if (!runningLowList || !noRunningLowMessage) return;
    
    // Clear existing content
    runningLowList.innerHTML = '';
    
    const runningLowItems = [];
    const dateKey = getDateKey(currentDate);
    
    // Get current date quantities
    const dateQuantities = getCurrentDateQuantities();
    
    console.log('=== RUNNING LOW DEBUG ===');
    console.log('Current date:', currentDate.toDateString());
    console.log('Current branch:', currentBranch);
    console.log('Total inventory items:', inventoryItems.length);
    console.log('Date quantities keys:', Object.keys(dateQuantities));
    
    // Calculate current quantities and find running low items
    inventoryItems.forEach(item => {
        const itemData = dateQuantities[item.id];
        if (!itemData) {
            console.log(`❌ ${item.name}: No quantity data`);
            return;
        }
        
        const openingQty = itemData.opening?.checked ? itemData.opening.value : null;
        const closingQty = itemData.closing?.checked ? itemData.closing.value : null;
        const addedStocks = itemData.added?.checked ? itemData.added.value : 0;
        
        // Determine current quantity based on available data
        let currentQty = 0;
        if (closingQty !== null) {
            // If closing is recorded (including 0), use closing quantity
            currentQty = closingQty;
        } else if (openingQty !== null) {
            // If there's opening data (including 0), use opening + added stocks
            currentQty = openingQty + addedStocks;
        } else {
            // No data available, skip this item
            return;
        }
        
        const restockAmount = item.restockAmount || 0;
        const isRunningLow = currentQty <= restockAmount;
        const isDepleted = currentQty <= 0;
        
        // Check if item is running low (current quantity <= restock amount) OR depleted (current quantity <= 0)
        if (isRunningLow) {
            runningLowItems.push({
                ...item,
                currentQty: currentQty,
                restockAmount: restockAmount,
                isDepleted: isDepleted
            });
        }
    });
    
    
    // Sort by inventory order (category order, then item order)
    sortByInventoryOrder(runningLowItems);
    
    if (runningLowItems.length === 0) {
        runningLowList.style.display = 'none';
        noRunningLowMessage.style.display = 'flex';
    } else {
        runningLowList.style.display = 'flex';
        noRunningLowMessage.style.display = 'none';
        
        runningLowItems.forEach(item => {
            const itemCard = createRunningLowItemCard(item);
            runningLowList.appendChild(itemCard);
        });
    }
}

function createRunningLowItemCard(item) {
    const card = document.createElement('div');
    card.className = `running-low-item-card ${item.isDepleted ? 'depleted' : 'low'}`;
    
    const imageHtml = item.photo ? 
        `<img src="${item.photo}" alt="${item.name}">` : 
        `<span>No Image</span>`;
    
    card.innerHTML = `
        <div class="running-low-item-image">
            ${imageHtml}
        </div>
        <div class="running-low-item-info">
            <div class="running-low-item-name">${item.name}</div>
            ${item.description ? `<div class="running-low-item-subtitle">${item.description}</div>` : ''}
        </div>
        <div class="running-low-item-quantity">
            <div class="running-low-quantity-number">${formatNumberWithCommas(item.currentQty)}</div>
            <div class="running-low-quantity-unit">${item.unit}</div>
        </div>
    `;
    
    return card;
}

// Get running low items data (similar to loadRunningLowItems but returns data instead of rendering)
function getRunningLowItemsData() {
    const runningLowItems = [];
    const dateKey = getDateKey(currentDate);
    const dateQuantities = getCurrentDateQuantities();
    
    inventoryItems.forEach(item => {
        const itemData = dateQuantities[item.id];
        if (!itemData) {
            return;
        }
        
        const openingQty = itemData.opening?.checked ? itemData.opening.value : null;
        const closingQty = itemData.closing?.checked ? itemData.closing.value : null;
        const addedStocks = itemData.added?.checked ? itemData.added.value : 0;
        
        let currentQty = 0;
        if (closingQty !== null) {
            currentQty = closingQty;
        } else if (openingQty !== null) {
            currentQty = openingQty + addedStocks;
        } else {
            return;
        }
        
        const restockAmount = item.restockAmount || 0;
        const isRunningLow = currentQty <= restockAmount;
        const isDepleted = currentQty <= 0;
        
        if (isRunningLow) {
            runningLowItems.push({
                ...item,
                currentQty: currentQty,
                restockAmount: restockAmount,
                isDepleted: isDepleted
            });
        }
    });
    
    // Sort by inventory order (category order, then item order)
    sortByInventoryOrder(runningLowItems);
    
    return runningLowItems;
}

// Flag to track if we're showing incomplete closing dialog for download
let showingIncompleteClosingDialog = false;

// Show incomplete closing inventory dialog for report download
function showIncompleteClosingDialog() {
    const uncheckedItems = getUncheckedClosingItems();
    if (uncheckedItems.length === 0) return false; // All items checked, no dialog needed
    
    showingIncompleteClosingDialog = true;
    
    const modal = document.getElementById('modeSwitchModalOverlay');
    const title = document.getElementById('modeSwitchTitle');
    const message = document.getElementById('modeSwitchMessage');
    const cancelBtn = document.getElementById('modeSwitchCancelBtn');
    const confirmBtn = document.getElementById('modeSwitchConfirmBtn');
    
    // Show unchecked items warning
    title.textContent = 'Incomplete Inventory';
    const itemCount = uncheckedItems.length;
    const itemText = itemCount === 1 ? 'item' : 'items';
    message.innerHTML = `<p>${itemCount} ${itemText} still need to be checked.</p>`;
    
    // Hide cancel button, show only one button
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (confirmBtn) {
        confirmBtn.textContent = 'Show items';
    }
    
    modal.classList.add('show');
    return true; // Dialog shown
}

// Download Running Low Report - Make it globally accessible
window.downloadRunningLowReport = async function downloadRunningLowReport() {
    console.log('downloadRunningLowReport called');
    try {
        // Check if html2canvas is available
        if (typeof html2canvas === 'undefined') {
            console.error('html2canvas is not defined');
            alert('Download feature is loading. Please wait a moment and try again.');
            return;
        }
        
        // First check if closing inventory is complete
        const uncheckedClosingItems = getUncheckedClosingItems();
        if (uncheckedClosingItems.length > 0) {
            console.log('Closing inventory incomplete, showing dialog');
            // Close Running Low page first so dialog is visible
            closeRunningLowPage();
            // Delay to allow page closing animation to complete (0.3s transition)
            setTimeout(() => {
                showIncompleteClosingDialog();
            }, 350);
            return; // Stop download, dialog will handle navigation
        }

        console.log('html2canvas is available');
        const downloadBtn = document.getElementById('runningLowDownloadBtn');
        let originalHTML = '';
        if (downloadBtn) {
            originalHTML = downloadBtn.innerHTML;
            if (!downloadBtn.dataset.originalHtml) {
                downloadBtn.dataset.originalHtml = originalHTML;
            }
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        }

        // Fetch fresh inventory items from Firebase before generating the report
        // to avoid using a stale localStorage cache (race condition on page load)
        try {
            console.log('Fetching fresh inventory items from Firebase...');
            const snapshot = await getDocs(collection(db, 'inventory', '_config', 'items'));
            const freshItems = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                const enabled = data.enabledBranches === undefined
                    ? true
                    : data.enabledBranches.includes(currentBranch);
                if (!enabled) return;
                freshItems.push({
                    id: doc.id,
                    ...data,
                    order: data.order || data.displayOrder || 0,
                    restockAmount: data.restockAmount || data.defaultRestockLevel || 0
                });
            });
            inventoryItems = freshItems;
            cacheInventoryItems(inventoryItems);
            console.log('Fresh inventory items loaded:', inventoryItems.length);
        } catch (fetchError) {
            console.warn('Could not fetch fresh inventory items, using cached data:', fetchError);
        }

        // Get running low items
        console.log('Getting running low items data...');
        const runningLowItems = getRunningLowItemsData();
        console.log('Running low items found:', runningLowItems.length);
        
        if (runningLowItems.length === 0) {
            alert('No items running low to download.');
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = downloadBtn.dataset.originalHtml || originalHTML;
            }
            return;
        }

        // Format date
        const dateStr = currentDate.toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric' 
        });
        
        // Get branch name
        const branchName = getBranchDisplayName(currentBranch);
        
        // Separate out of stock and running low items
        const outOfStockItems = runningLowItems.filter(item => item.isDepleted);
        const runningLowOnlyItems = runningLowItems.filter(item => !item.isDepleted);
        
        // Generate report HTML (similar to financial report format)
        const reportHTML = `
            <div style="
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                padding: 2rem;
                background: white;
                color: #333;
                width: 600px;
                line-height: 1.6;
            ">
                <div style="margin-bottom: 1.5rem;">
                    <div style="font-weight: 600; margin-bottom: 0.5rem;">
                        <strong>Date:</strong> ${dateStr}
                    </div>
                    <div style="font-weight: 600;">
                        <strong>Branch:</strong> ${branchName}
                    </div>
                </div>
                
                ${outOfStockItems.length > 0 ? `
                    <div style="margin-bottom: 1.5rem;">
                        <div style="font-weight: 700; font-size: 1.3rem; margin-bottom: 0.75rem;">
                            Out of Stock
                        </div>
                        ${outOfStockItems.map(item => {
                            const itemName = item.name + (item.description ? ` (${item.description})` : '');
                            const quantity = formatNumberWithCommas(item.currentQty) + ' ' + item.unit;
                            return `
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span style="flex: 1;">${itemName}</span>
                                <span style="text-align: right; font-weight: 500; margin-left: 1rem;">${quantity}</span>
                            </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
                
                ${runningLowOnlyItems.length > 0 ? `
                    <div style="margin-bottom: 1.5rem;">
                        <div style="font-weight: 700; font-size: 1.3rem; margin-bottom: 0.75rem;">
                            Running Low
                        </div>
                        ${runningLowOnlyItems.map(item => {
                            const itemName = item.name + (item.description ? ` (${item.description})` : '');
                            const quantity = formatNumberWithCommas(item.currentQty) + ' ' + item.unit;
                            return `
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span style="flex: 1;">${itemName}</span>
                                <span style="text-align: right; font-weight: 500; margin-left: 1rem;">${quantity}</span>
                            </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
            </div>
        `;
        
        // Create a temporary container for the report
        const reportContainer = document.createElement('div');
        reportContainer.innerHTML = reportHTML;
        reportContainer.style.position = 'absolute';
        reportContainer.style.left = '-9999px';
        reportContainer.style.top = '0';
        reportContainer.style.width = '600px';
        document.body.appendChild(reportContainer);
        
        // Wait a bit for rendering
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Use html2canvas to capture the report
        const canvas = await html2canvas(reportContainer, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true
        });
        
        // Remove the temporary container
        document.body.removeChild(reportContainer);
        
        // Convert to image and download
        const imageData = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        
        // Generate filename with date and branch
        const dateKey = getDateKey(currentDate);
        const branchKey = currentBranch === 'sm-north' ? 'SM-North' : currentBranch === 'podium' ? 'Podium' : 'MOA';
        link.download = `running-low-report-${branchKey}-${dateKey}.png`;
        
        link.href = imageData;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = downloadBtn.dataset.originalHtml || originalHTML;
        }
        
        console.log('Download completed successfully');
    } catch (error) {
        console.error('Error downloading running low report:', error);
        console.error('Error details:', error.message, error.stack);
        alert('Failed to download report: ' + (error.message || 'Unknown error'));
        const downloadBtn = document.getElementById('runningLowDownloadBtn');
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = downloadBtn.dataset.originalHtml || '';
        }
    }
}

// Get stock adjustments data grouped by reason
function getStockAdjustmentsData() {
    const dateQuantities = getCurrentDateQuantities();
    const adjustments = {
        delivery: [],
        'pulled-out': [],
        wastage: []
    };
    
    Object.keys(dateQuantities).forEach(itemId => {
        const itemData = dateQuantities[itemId];
        const inventoryItem = inventoryItems.find(item => item.id === itemId);
        if (!inventoryItem) return;
        
        // Check if adjustments array exists and has entries
        if (itemData.adjustments && Array.isArray(itemData.adjustments) && itemData.adjustments.length > 0) {
            itemData.adjustments.forEach(adjustment => {
                const value = Math.abs(adjustment.value || 0);
                if (value === 0) return; // skip zero entries
                
                const reason = adjustment.reason || (adjustment.value < 0 ? 'pulled-out' : 'delivery');
                const adjustmentData = {
                    name: inventoryItem.name,
                    subtitle: inventoryItem.subtitle,
                    quantity: value,
                    unit: inventoryItem.unit
                };
                
                if (reason === 'delivery') {
                    adjustments.delivery.push(adjustmentData);
                } else if (reason === 'pulled-out') {
                    adjustments['pulled-out'].push(adjustmentData);
                } else if (reason === 'wastage') {
                    adjustments.wastage.push(adjustmentData);
                }
            });
        } else if (itemData.added && itemData.added.value !== 0 && itemData.added.checked) {
            // Backward compatibility: load old single added value
            const value = Math.abs(itemData.added.value);
            const reason = itemData.added.value >= 0 ? 'delivery' : 'pulled-out';
            const adjustmentData = {
                name: inventoryItem.name,
                subtitle: inventoryItem.subtitle,
                quantity: value,
                unit: inventoryItem.unit
            };
            
            if (reason === 'delivery') {
                adjustments.delivery.push(adjustmentData);
            } else {
                adjustments['pulled-out'].push(adjustmentData);
            }
        }
    });
    
    // Sort each group by quantity (highest first)
    adjustments.delivery.sort((a, b) => b.quantity - a.quantity);
    adjustments['pulled-out'].sort((a, b) => b.quantity - a.quantity);
    adjustments.wastage.sort((a, b) => b.quantity - a.quantity);
    
    return adjustments;
}

// Download Stock Adjustment Report - Make it globally accessible
window.downloadStockAdjustmentReport = async function downloadStockAdjustmentReport() {
    console.log('downloadStockAdjustmentReport called');
    try {
        // Check if html2canvas is available
        if (typeof html2canvas === 'undefined') {
            console.error('html2canvas is not defined');
            alert('Download feature is loading. Please wait a moment and try again.');
            return;
        }

        console.log('html2canvas is available');
        const downloadBtn = document.getElementById('stockAdjustmentDownloadBtn');
        let originalHTML = '';
        if (downloadBtn) {
            originalHTML = downloadBtn.innerHTML;
            if (!downloadBtn.dataset.originalHtml) {
                downloadBtn.dataset.originalHtml = originalHTML;
            }
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        }

        // Get stock adjustments data
        console.log('Getting stock adjustments data...');
        const adjustments = getStockAdjustmentsData();
        console.log('Adjustments found:', {
            delivery: adjustments.delivery.length,
            'pulled-out': adjustments['pulled-out'].length,
            wastage: adjustments.wastage.length
        });
        
        const totalItems = adjustments.delivery.length + adjustments['pulled-out'].length + adjustments.wastage.length;
        if (totalItems === 0) {
            alert('No stock adjustments to download.');
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = downloadBtn.dataset.originalHtml || originalHTML;
            }
            return;
        }

        // Format date
        const dateStr = currentDate.toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric' 
        });
        
        // Get branch name
        const branchName = getBranchDisplayName(currentBranch);
        
        // Generate report HTML
        const reportHTML = `
            <div style="
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                padding: 2rem;
                background: white;
                color: #333;
                width: 600px;
                line-height: 1.6;
            ">
                <div style="margin-bottom: 1.5rem;">
                    <div style="font-weight: 600; margin-bottom: 0.5rem;">
                        <strong>Date:</strong> ${dateStr}
                    </div>
                    <div style="font-weight: 600;">
                        <strong>Branch:</strong> ${branchName}
                    </div>
                </div>
                
                ${adjustments.delivery.length > 0 ? `
                    <div style="margin-bottom: 1.5rem;">
                        <div style="font-weight: 700; font-size: 1.3rem; margin-bottom: 0.75rem;">
                            Added Stocks
                        </div>
                        ${adjustments.delivery.map(item => {
                            const itemName = item.name + (item.subtitle ? ` (${item.subtitle})` : '');
                            const quantity = formatNumberWithCommas(item.quantity) + ' ' + item.unit;
                            return `
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span style="flex: 1;">${itemName}</span>
                                <span style="text-align: right; font-weight: 500; margin-left: 1rem;">${quantity}</span>
                            </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
                
                ${adjustments['pulled-out'].length > 0 ? `
                    <div style="margin-bottom: 1.5rem;">
                        <div style="font-weight: 700; font-size: 1.3rem; margin-bottom: 0.75rem;">
                            Pulled Out Stocks
                        </div>
                        ${adjustments['pulled-out'].map(item => {
                            const itemName = item.name + (item.subtitle ? ` (${item.subtitle})` : '');
                            const quantity = formatNumberWithCommas(item.quantity) + ' ' + item.unit;
                            return `
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span style="flex: 1;">${itemName}</span>
                                <span style="text-align: right; font-weight: 500; margin-left: 1rem;">${quantity}</span>
                            </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
                
                ${adjustments.wastage.length > 0 ? `
                    <div style="margin-bottom: 1.5rem;">
                        <div style="font-weight: 700; font-size: 1.3rem; margin-bottom: 0.75rem;">
                            Wastage
                        </div>
                        ${adjustments.wastage.map(item => {
                            const itemName = item.name + (item.subtitle ? ` (${item.subtitle})` : '');
                            const quantity = formatNumberWithCommas(item.quantity) + ' ' + item.unit;
                            return `
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span style="flex: 1;">${itemName}</span>
                                <span style="text-align: right; font-weight: 500; margin-left: 1rem;">${quantity}</span>
                            </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
            </div>
        `;
        
        // Create a temporary container for the report
        const reportContainer = document.createElement('div');
        reportContainer.innerHTML = reportHTML;
        reportContainer.style.position = 'absolute';
        reportContainer.style.left = '-9999px';
        reportContainer.style.top = '0';
        reportContainer.style.width = '600px';
        document.body.appendChild(reportContainer);
        
        // Wait a bit for rendering
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Use html2canvas to capture the report
        const canvas = await html2canvas(reportContainer, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true
        });
        
        // Remove the temporary container
        document.body.removeChild(reportContainer);
        
        // Convert to image and download
        const imageData = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        
        // Generate filename with date and branch
        const dateKey = getDateKey(currentDate);
        const branchKey = currentBranch === 'sm-north' ? 'SM-North' : currentBranch === 'podium' ? 'Podium' : 'MOA';
        link.download = `stock-adjustment-report-${branchKey}-${dateKey}.png`;
        
        link.href = imageData;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = downloadBtn.dataset.originalHtml || originalHTML;
        }
        
        console.log('Download completed successfully');
    } catch (error) {
        console.error('Error downloading stock adjustment report:', error);
        console.error('Error details:', error.message, error.stack);
        alert('Failed to download report: ' + (error.message || 'Unknown error'));
        const downloadBtn = document.getElementById('stockAdjustmentDownloadBtn');
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = downloadBtn.dataset.originalHtml || '';
        }
    }
}

function openItemSelectionModal() {
    const modal = document.getElementById('itemSelectionModalOverlay');
    if (modal) {
        populateItemSelectionList();
        modal.classList.add('show');
    }
}

function closeItemSelectionModal() {
    const modal = document.getElementById('itemSelectionModalOverlay');
    if (modal) {
        modal.classList.remove('show');
    }
}

function populateItemSelectionList() {
    const list = document.getElementById('itemSelectionList');
    if (!list) return;

    list.innerHTML = '';

    // Group items by category
    const categories = {};
    inventoryItems.forEach(item => {
        if (!categories[item.category]) {
            categories[item.category] = [];
        }
        categories[item.category].push(item);
    });

    // Sort categories using categoryOrderMap (same as main inventory)
    const sortedCategories = Object.keys(categories).sort((a, b) => {
        const orderA = (categoryOrderMap && typeof categoryOrderMap[a] === 'number') ? categoryOrderMap[a] : 999;
        const orderB = (categoryOrderMap && typeof categoryOrderMap[b] === 'number') ? categoryOrderMap[b] : 999;
        return orderA - orderB;
    });

    // Render categories and items
    sortedCategories.forEach(categoryName => {
        const categoryItems = categories[categoryName];
        
        // Sort items by their order field (same as main inventory)
        categoryItems.sort((a, b) => (a.order || 0) - (b.order || 0));
        
        // Category header
        const categoryHeader = document.createElement('div');
        categoryHeader.className = 'category-header';
        categoryHeader.textContent = categoryName;
        list.appendChild(categoryHeader);

        // Category items
        categoryItems.forEach(item => {
            const itemCard = document.createElement('div');
            itemCard.className = 'selection-item-card';
            itemCard.dataset.itemId = item.id;
            
            itemCard.innerHTML = `
                <div class="selection-item-image">
                    ${item.photo ? `<img src="${item.photo}" alt="${item.name}">` : 'No Image'}
                </div>
                <div class="selection-item-info">
                    <div class="selection-item-name">${item.name}</div>
                    ${item.description ? `<div class="selection-item-subtitle">${item.description}</div>` : ''}
                </div>
            `;
            
            list.appendChild(itemCard);
        });
    });
}

function addItemToStock(itemId) {
    const item = inventoryItems.find(i => i.id === itemId);
    if (!item) return;

    // Determine reason based on mode
    const reason = currentAdjustmentMode === 'pull-out' ? 'pulled-out' : 
                   currentAdjustmentMode === 'wastage' ? 'wastage' : 'delivery';
    const defaultQuantity = 1; // Always positive for UI; reason determines subtraction

    // Always add as a new record (no merging)
        stockItems.push({
            id: item.id,
            name: item.name,
            subtitle: item.subtitle,
        description: item.description,
            photo: item.photo,
            unit: item.unit,
        quantity: defaultQuantity,
        reason: reason
        });

    renderStockItems();
}

function updateStockQuantity(itemId, quantity) {
    const stockItem = stockItems.find(s => s.id === itemId);
    if (stockItem) {
        stockItem.quantity = Math.abs(quantity);
        // Don't re-render on every keystroke - just update the value
        // renderStockItems(); // This was causing focus loss
    }
}

function updateStockQuantityByIndex(index, quantity) {
    if (stockItems[index]) {
        stockItems[index].quantity = Math.abs(quantity);
        // Reason stays as-is; subtraction is implied by reason, not by sign
    }
}

async function saveStockAdditions() {
    const dateQuantities = getCurrentDateQuantities();
    const itemsToSync = new Set(); // Track all items that need Firebase sync
    
    // Group current edits by itemId
    const itemsMap = new Map();
    stockItems.forEach(si => {
        if (!itemsMap.has(si.id)) itemsMap.set(si.id, []);
        itemsMap.get(si.id).push(si);
    });

    itemsMap.forEach((entries, itemId) => {
        if (!dateQuantities[itemId]) {
            dateQuantities[itemId] = {
                opening: { value: 0, checked: false },
                closing: { value: 0, checked: false },
                added: { value: 0, checked: false },
                adjustments: []
            };
        }
        
        // Ensure adjustments array exists (backward compatibility)
        if (!dateQuantities[itemId].adjustments) {
            const oldAdded = dateQuantities[itemId].added;
            dateQuantities[itemId].adjustments = [];
            if (oldAdded && oldAdded.value !== 0 && oldAdded.checked) {
                dateQuantities[itemId].adjustments.push({
                    value: Math.abs(oldAdded.value),
                    reason: oldAdded.value >= 0 ? 'delivery' : 'pulled-out',
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        // Replace adjustments for this item with the current (non-zero) entries
        const filtered = entries
            .filter(e => (Math.abs(e.quantity) || 0) > 0)
            .map(e => ({
                    // Store value as positive magnitude; sign determined by reason
                    value: Math.abs(e.quantity),
                    reason: e.reason || 'delivery',
                    timestamp: new Date().toISOString()
                }));

        if (filtered.length === 0) {
            // No adjustments: clear and reset added
            dateQuantities[itemId].adjustments = [];
            dateQuantities[itemId].added.value = 0;
            dateQuantities[itemId].added.checked = false;
        } else {
            dateQuantities[itemId].adjustments = filtered;
            // Sum with sign based on reason (both pulled-out and wastage are negative)
            const totalAdjustment = filtered.reduce((sum, adj) => {
                const signed = (adj.reason === 'pulled-out' || adj.reason === 'wastage') ? -adj.value : adj.value;
                return sum + signed;
            }, 0);
            dateQuantities[itemId].added.value = totalAdjustment;
            dateQuantities[itemId].added.checked = true;
        }

        itemsToSync.add(itemId); // Mark for Firebase sync
    });

    // Save to local storage
    saveQuantitiesToLocal();
    
    // Sync ALL items to Firebase
    console.log('Items to sync to Firebase:', Array.from(itemsToSync));
    for (const itemId of itemsToSync) {
        const itemData = dateQuantities[itemId];
        console.log(`Syncing item ${itemId} with adjustments:`, itemData?.adjustments);
        await syncQuantityToFirebase(itemId, 'added');
    }
    
    // Clear stockItems after saving
    stockItems = [];
    
    // Refresh the main inventory display to update closing suggestions
    renderInventory();
    
    showSyncIndicator('Stock adjustments saved', 'success');
}

function renderStockItems() {
    const stocksList = document.getElementById('stocksList');
    const saveStocksBtn = document.getElementById('saveStocksBtn');
    if (!stocksList) return;

    if (stockItems.length === 0) {
        stocksList.innerHTML = '<div style="text-align: center; color: #999; padding: 40px 20px;">No adjustments yet</div>';
        if (saveStocksBtn) saveStocksBtn.style.display = 'none';
        return;
    }

    stocksList.innerHTML = stockItems.map((stockItem, index) => {
        const reason = stockItem.reason || 'delivery';
        const isNegative = reason === 'pulled-out' || reason === 'wastage';
        const reasonDisplay = reason === 'pulled-out' ? 'Pulled Out' : 
                             reason === 'wastage' ? 'Wastage' :
                             reason === 'transfer' ? 'Transfer' : 'Delivery';
        const quantityClass = isNegative ? 'pulled-out' : '';
        const displayQty = Math.abs(stockItem.quantity || 0);
        
        return `
        <div class="stock-item-card" data-index="${index}">
            <div class="stock-item-image">
                ${stockItem.photo ? `<img src="${stockItem.photo}" alt="${stockItem.name}">` : 'No Image'}
            </div>
            <div class="stock-item-info">
                <div class="stock-item-adjustment-type">${reasonDisplay}</div>
                <div class="stock-item-name">${stockItem.name}</div>
                ${stockItem.description ? `<div class="stock-item-subtitle">${stockItem.description}</div>` : ''}
            </div>
            <div class="stock-item-quantity ${quantityClass}">
                <input type="text" 
                       class="quantity-number" 
                       data-item-id="${stockItem.id}"
                       data-index="${index}"
                       value="${displayQty}" 
                       inputmode="decimal"
                       pattern="-?[0-9]*\\.?[0-9]*">
                <div class="stock-quantity-unit">${stockItem.unit}</div>
            </div>
        </div>
    `;
    }).join('');

    // Add event listeners to the newly created inputs
    stocksList.querySelectorAll('.quantity-number[data-item-id]').forEach(input => {
        input.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            const quantity = parseFloat(e.target.value) || 0;
            console.log('Stock quantity changed:', index, quantity);
            updateStockQuantityByIndex(index, quantity);
        });
    });

    // Show save button when items are added
    if (saveStocksBtn) saveStocksBtn.style.display = 'flex';
}

// For console access - remove this in production
window.eraseToday = eraseDataForToday;
window.debugStock = {
    getStockItems: () => stockItems,
    getCurrentQuantities: () => getCurrentDateQuantities(),
    getConsumption: (itemId) => {
        const quantities = getCurrentDateQuantities();
        const item = quantities[itemId];
        if (!item) return 0;
        const opening = item.opening?.value || 0;
        const added = item.added?.value || 0;
        const closing = item.closing?.value || 0;
        return opening + added - closing;
    }
};

// Branch data debugging functions
window.debugBranches = {
    // Test branch data isolation
    testBranchIsolation: async function() {
        console.log('🔍 Testing Branch Data Isolation...');
        console.log('Current branch:', currentBranch);
        
        // Test 1: Check localStorage data
        console.log('\n📱 LocalStorage Data:');
        const smNorthItems = localStorage.getItem(`${STORAGE_KEYS.INVENTORY}-sm-north`);
        const podiumItems = localStorage.getItem(`${STORAGE_KEYS.INVENTORY}-podium`);
        const smNorthQuantities = localStorage.getItem(`${STORAGE_KEYS.QUANTITIES}-sm-north`);
        const podiumQuantities = localStorage.getItem(`${STORAGE_KEYS.QUANTITIES}-podium`);
        
        console.log('SM North items:', smNorthItems ? JSON.parse(smNorthItems).length : 0, 'items');
        console.log('Podium items:', podiumItems ? JSON.parse(podiumItems).length : 0, 'items');
        console.log('SM North quantities:', smNorthQuantities ? Object.keys(JSON.parse(smNorthQuantities)).length : 0, 'dates');
        console.log('Podium quantities:', podiumQuantities ? Object.keys(JSON.parse(podiumQuantities)).length : 0, 'dates');
        
        // Test 2: Check Firebase data
        console.log('\n🔥 Firebase Data:');
        try {
            const smNorthQuery = query(collection(db, 'inventory', '_config', 'items'), where('branch', '==', 'sm-north'));
            const podiumQuery = query(collection(db, 'inventory', '_config', 'items'), where('branch', '==', 'podium'));
            
            const [smNorthSnapshot, podiumSnapshot] = await Promise.all([
                getDocs(smNorthQuery),
                getDocs(podiumQuery)
            ]);
            
            console.log('SM North Firebase items:', smNorthSnapshot.docs.length);
            console.log('Podium Firebase items:', podiumSnapshot.docs.length);
            
            // Test 3: Check quantities data
            const today = getDateKey();
            const smNorthQuantitiesRef = doc(db, 'inventory-quantities', 'sm-north', 'daily-quantities', today);
            const podiumQuantitiesRef = doc(db, 'inventory-quantities', 'podium', 'daily-quantities', today);
            
            const [smNorthQuantitiesSnap, podiumQuantitiesSnap] = await Promise.all([
                getDoc(smNorthQuantitiesRef),
                getDoc(podiumQuantitiesRef)
            ]);
            
            console.log('SM North quantities today:', smNorthQuantitiesSnap.exists() ? Object.keys(smNorthQuantitiesSnap.data().quantities || {}).length : 0, 'items');
            console.log('Podium quantities today:', podiumQuantitiesSnap.exists() ? Object.keys(podiumQuantitiesSnap.data().quantities || {}).length : 0, 'items');
            
        } catch (error) {
            console.error('Error checking Firebase data:', error);
        }
        
        // Test 4: Check current app state
        console.log('\n📊 Current App State:');
        console.log('Current branch:', currentBranch);
        console.log('Loaded inventory items:', inventoryItems.length);
        console.log('Current quantities keys:', Object.keys(quantities).length);
        
        return {
            currentBranch,
            inventoryItemsCount: inventoryItems.length,
            quantitiesCount: Object.keys(quantities).length
        };
    },
    
    // Switch branch and test
    testBranchSwitch: async function(branchName) {
        console.log(`🔄 Testing branch switch to: ${branchName}`);
        const oldBranch = currentBranch;
        
        // Switch branch
        currentBranch = branchName;
        localStorage.setItem('selected-branch', currentBranch);
        
        // Update dropdown
        const branchSelect = document.getElementById('branchSelect');
        if (branchSelect) {
            branchSelect.value = currentBranch;
        }
        
        // Reload data
        await loadBranchInventory();
        
        console.log(`✅ Switched from ${oldBranch} to ${currentBranch}`);
        console.log('New inventory items:', inventoryItems.length);
        console.log('New quantities keys:', Object.keys(quantities).length);
        
        return {
            oldBranch,
            newBranch: currentBranch,
            inventoryItemsCount: inventoryItems.length,
            quantitiesCount: Object.keys(quantities).length
        };
    },
    
    // Clear all data for a branch
    clearBranchData: async function(branchName) {
        console.log(`🗑️ Clearing all data for branch: ${branchName}`);
        
        // Clear localStorage
        localStorage.removeItem(`${STORAGE_KEYS.INVENTORY}-${branchName}`);
        localStorage.removeItem(`${STORAGE_KEYS.QUANTITIES}-${branchName}`);
        
        // Clear Firebase items
        try {
            const itemsQuery = query(collection(db, 'inventory', '_config', 'items'), where('branch', '==', branchName));
            const itemsSnapshot = await getDocs(itemsQuery);
            const deletePromises = itemsSnapshot.docs.map(doc => deleteDoc(doc.ref));
            await Promise.all(deletePromises);
            console.log(`✅ Deleted ${itemsSnapshot.docs.length} items from Firebase`);
        } catch (error) {
            console.error('Error deleting Firebase items:', error);
        }
        
        // Clear Firebase quantities (all dates)
        try {
            const quantitiesCollection = collection(db, 'inventory-quantities', branchName, 'daily-quantities');
            const quantitiesSnapshot = await getDocs(quantitiesCollection);
            const deletePromises = quantitiesSnapshot.docs.map(doc => deleteDoc(doc.ref));
            await Promise.all(deletePromises);
            console.log(`✅ Deleted ${quantitiesSnapshot.docs.length} quantity documents from Firebase`);
        } catch (error) {
            console.error('Error deleting Firebase quantities:', error);
        }
        
        console.log(`✅ All data cleared for branch: ${branchName}`);
    }
};

