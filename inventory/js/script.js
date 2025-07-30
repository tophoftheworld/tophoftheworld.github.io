import { db } from './firebase-inventory.js';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where, setDoc } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

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

// Quantity control functions
let holdTimer = null;
let holdInterval = null;
let isHolding = false;

let currentBranch = localStorage.getItem('selected-branch') || 'sm-north';
let availableBranches = ['sm-north', 'podium'];
let allBranches = []; // Will be loaded from Firebase

let syncTimeouts = new Map(); // Store timeout IDs per item
const SYNC_DELAY = 2000; // 2 seconds delay

document.addEventListener('DOMContentLoaded', async function () {
    console.log('DOM loaded, checking branchSelect...');
    const branchSelect = document.getElementById('branchSelect');
    console.log('branchSelect found:', !!branchSelect);

    await initializeApp();
    setupEventListeners();
    loadLocalData();
    syncWithFirebase();

    // Force update dropdown after everything loads
    setTimeout(() => {
        console.log('Forcing dropdown update...');
        updateBranchDropdown();
    }, 500);
});

async function initializeApp() {
    // Check online status
    window.addEventListener('online', () => {
        isOnline = true;
        syncWithFirebase();
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        showSyncIndicator('Offline', 'error');
    });

    try {
        // Test Firebase connection first on iPhone
        if (isOnline) {
            const connectionOK = await testFirebaseConnection();
            if (!connectionOK) {
                showSyncIndicator('Using offline mode', 'info');
                loadLocalData();
                return;
            }
        }

        // Load branches from Firebase first
        await loadBranchesFromFirebase();

        // Initialize branch dropdown
        updateBranchDropdown();
        console.log('Called updateBranchDropdown from initializeApp');

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

        // Load local data first for immediate display
        loadLocalData();

        // Then sync with Firebase
        if (isOnline) {
            await syncWithFirebase();
        }

    } catch (error) {
        showSyncIndicator(`Init failed: ${error.message}`, 'error');
        loadLocalData();
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
    // const addItemBtn = document.getElementById('addItemBtn');
    const modalOverlay = document.getElementById('modalOverlay');
    const modalClose = document.getElementById('modalClose');
    const cancelBtn = document.getElementById('cancelBtn');
    const addItemForm = document.getElementById('addItemForm');

    // Add category button
    // const addCategoryBtn = document.getElementById('addCategoryBtn');
    // if (addCategoryBtn) {
    //     addCategoryBtn.addEventListener('click', () => openAddCategoryModal());
    // }

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

    // addItemBtn.addEventListener('click', () => openModal());
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

    // Scroll-based compact header
    let lastScrollTop = 0;
    const scrollableContent = document.querySelector('.scrollable-content');
    const datePickerContainer = document.querySelector('.date-picker-container');

    // Create compact info row element
    compactInfoRow = document.createElement('div');
    compactInfoRow.className = 'compact-info-row';
    datePickerContainer.appendChild(compactInfoRow);

    // Initial update
    updateCompactInfo();

    scrollableContent.addEventListener('scroll', () => {
        const scrollTop = scrollableContent.scrollTop;
        const isScrollingDown = scrollTop > lastScrollTop;

        if (scrollTop > 40 && isScrollingDown) {
            // Make compact when scrolled down
            if (!datePickerContainer.classList.contains('compact')) {
                datePickerContainer.classList.add('compact');
                document.querySelector('.header-container').classList.add('compact');
                document.querySelector('.toggle-container').classList.add('compact');
                updateCompactInfo();
            }
        } else if (scrollTop <= 15) {
            // Return to normal when at top
            if (datePickerContainer.classList.contains('compact')) {
                datePickerContainer.classList.remove('compact');
                document.querySelector('.header-container').classList.remove('compact');
                document.querySelector('.toggle-container').classList.remove('compact');
            }
        }

        lastScrollTop = scrollTop;
    });

    console.log('branchSelect element:', branchSelect);
    console.log('All select elements:', document.querySelectorAll('select'));

    if (branchSelect) {
        branchSelect.addEventListener('change', handleBranchChange);
        console.log('Added event listener to branchSelect');
    } else {
        console.log('branchSelect not found!');
    }

    // Add popup modal
    const addPopupModalOverlay = document.getElementById('addPopupModalOverlay');
    const addPopupModalClose = document.getElementById('addPopupModalClose');
    const addPopupCancelBtn = document.getElementById('addPopupCancelBtn');
    const addPopupConfirmBtn = document.getElementById('addPopupConfirmBtn');

    addPopupModalClose.addEventListener('click', () => closeAddPopupModal());
    addPopupCancelBtn.addEventListener('click', () => closeAddPopupModal());
    addPopupConfirmBtn.addEventListener('click', handleAddPopup);
    addPopupModalOverlay.addEventListener('click', (e) => {
        if (e.target === addPopupModalOverlay) closeAddPopupModal();
    });

    // Photo upload handling
    const itemPhoto = document.getElementById('itemPhoto');
    const photoPreview = document.getElementById('photoPreview');
    const previewImage = document.getElementById('previewImage');
    const removePhoto = document.getElementById('removePhoto');

    itemPhoto.addEventListener('change', handlePhotoSelect);
    removePhoto.addEventListener('click', handlePhotoRemove);

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

    if (selectedValue === 'new-popup') {
        // Reset to current branch and open popup modal
        event.target.value = currentBranch;
        openAddPopupModal();
        return;
    }

    if (selectedValue !== currentBranch) {
        currentBranch = selectedValue;
        // Save selected branch to localStorage
        localStorage.setItem('selected-branch', currentBranch);
        console.log('Selected branch:', currentBranch);

        // Load inventory for this branch
        loadBranchInventory();

        const branchName = getBranchDisplayName(currentBranch);
        showSyncIndicator(`Switched to ${branchName}`, 'info');
    }
}

async function loadBranchesFromFirebase() {
    try {
        console.log('Loading branches from Firebase...');
        const snapshot = await getDocs(collection(db, "branches"));
        const firebaseBranches = [];
        snapshot.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
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

    // Update dropdown immediately after loading
    updateBranchDropdown();
    
    // Force the dropdown to show the current branch
    setTimeout(() => {
        const branchSelect = document.getElementById('branchSelect');
        if (branchSelect) {
            branchSelect.value = currentBranch;
            console.log('Forced dropdown value to:', currentBranch);
        }
        updateBranchDropdown(); // Call again to be sure
    }, 100);
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
    // Check default branches first
    if (branchKey === 'sm-north') return 'SM North';
    if (branchKey === 'podium') return 'Podium';

    // Check Firebase branches
    const branch = allBranches.find(b => b.key === branchKey);
    if (branch) {
        return `[Pop-up] ${branch.name}`;
    }

    // Fallback: if branch not found, try to extract name from key
    if (branchKey.startsWith('popup-')) {
        const name = branchKey.replace('popup-', '').replace(/-/g, ' ');
        return `[Pop-up] ${name.charAt(0).toUpperCase() + name.slice(1)}`;
    }

    return branchKey;
}

function updateBranchDropdown() {
    const branchSelect = document.getElementById('branchSelect');
    if (!branchSelect) return;

    const currentValue = branchSelect.value;

    // DEBUG: Log what we have
    console.log('Current branch:', currentBranch);
    console.log('All branches:', allBranches);
    console.log('Current value:', currentValue);

    // Clear existing options
    branchSelect.innerHTML = '';

    // Add default branches
    const smOption = document.createElement('option');
    smOption.value = 'sm-north';
    smOption.textContent = 'SM North';
    branchSelect.appendChild(smOption);

    const podiumOption = document.createElement('option');
    podiumOption.value = 'podium';
    podiumOption.textContent = 'Podium';
    branchSelect.appendChild(podiumOption);

    // Add branches from Firebase
    console.log('Adding all branches:', allBranches);
    if (allBranches && allBranches.length > 0) {
        allBranches
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
            .forEach(branch => {
                const option = document.createElement('option');
                option.value = branch.key;
                option.textContent = branch.key.startsWith('popup-') ? `[Pop-up] ${branch.name}` : branch.name;
                branchSelect.appendChild(option);
                console.log('Added branch option:', branch.key, branch.name);
            });
    }

    // Add "New Pop-Up" option
    const newOption = document.createElement('option');
    newOption.value = 'new-popup';
    newOption.textContent = '+ New Pop-Up';
    branchSelect.appendChild(newOption);

    // Set the current branch value
    branchSelect.value = currentBranch;

    // If the current branch isn't found in the dropdown, add it manually
    if (branchSelect.value !== currentBranch) {
        console.log('Current branch not found in dropdown:', currentBranch);
        console.log('Available options:', Array.from(branchSelect.options).map(o => o.value));

        // Force add the current branch if it's missing
        const option = document.createElement('option');
        option.value = currentBranch;
        option.textContent = getBranchDisplayName(currentBranch);
        branchSelect.insertBefore(option, newOption);
        branchSelect.value = currentBranch;
        console.log('Force added missing branch:', currentBranch);
    }
}

function openAddPopupModal() {
    document.getElementById('addPopupModalOverlay').classList.add('show');
    document.getElementById('newPopupName').focus();
}

function closeAddPopupModal() {
    document.getElementById('addPopupModalOverlay').classList.remove('show');
    document.getElementById('newPopupName').value = '';
}

async function handleAddPopup() {
    const popupName = document.getElementById('newPopupName').value.trim();
    if (!popupName) return;

    // Create unique key
    const popupKey = 'popup-' + popupName.toLowerCase().replace(/[^a-z0-9]/g, '-');

    // Check if already exists
    if (allBranches.find(b => b.key === popupKey)) {
        showSyncIndicator('Pop-up already exists', 'error');
        return;
    }

    try {
        showSyncIndicator('Creating pop-up...', 'info');

        // Save to Firebase
        const branchData = {
            key: popupKey,
            name: popupName,
            type: 'popup',
            createdAt: new Date().toISOString(),
            createdBy: 'inventory-app', // You can change this to user ID if you have auth
            status: 'active'
        };

        const newBranch = await saveBranchToFirebase(branchData);
        allBranches.push(newBranch);
        localStorage.setItem('branches-cache', JSON.stringify(allBranches));

        // Update dropdown
        updateBranchDropdown();

        // Switch to new popup
        document.getElementById('branchSelect').value = popupKey;
        currentBranch = popupKey;
        localStorage.setItem('selected-branch', currentBranch);

        // Load empty inventory for new branch
        loadBranchInventory();

        closeAddPopupModal();
        showSyncIndicator(`${popupName} pop-up created`, 'success');

    } catch (error) {
        console.error('Error creating popup:', error);
        showSyncIndicator('Failed to create pop-up', 'error');
    }
}

function loadBranchInventory() {
    // Load inventory items for current branch from Firebase
    syncWithFirebase();
}

async function syncWithFirebase() {
    if (!isOnline) return;

    try {
        showSyncIndicator('Loading inventory...', 'info');

        // Query items for current branch only
        const q = query(
            collection(db, 'inventory-items'),
            where('branch', '==', currentBranch)
        );

        const snapshot = await getDocs(q);
        const firebaseItems = [];
        snapshot.forEach(doc => {
            firebaseItems.push({ id: doc.id, ...doc.data() });
        });

        inventoryItems = firebaseItems;
        localStorage.setItem(`${STORAGE_KEYS.INVENTORY}-${currentBranch}`, JSON.stringify(inventoryItems));

        renderInventory();
        await loadQuantitiesFromFirebase();
        showSyncIndicator(`Loaded ${firebaseItems.length} items`, 'success');

    } catch (error) {
        console.error('Sync error:', error);
        showSyncIndicator(`Failed to load: ${error.message}`, 'error');

        // Try to load from local storage as fallback
        loadLocalData();
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
        const q = query(
            collection(db, 'inventory-quantities'),
            where('branch', '==', currentBranch),
            where('date', '==', dateKey)
        );

        const snapshot = await getDocs(q);

        // Get current quantities to merge with
        const currentQuantities = getCurrentDateQuantities();

        snapshot.forEach(docSnapshot => {
            const data = docSnapshot.data();

            // Initialize item if it doesn't exist
            if (!currentQuantities[data.itemId]) {
                currentQuantities[data.itemId] = {
                    opening: { value: 0, checked: false },
                    closing: { value: 0, checked: false }
                };
            }

            // Update the specific mode
            currentQuantities[data.itemId][data.mode] = {
                value: data.value,
                checked: true,
                timestamp: data.timestamp
            };
        });

        saveQuantitiesToLocal();
        renderInventory();

        if (snapshot.size > 0) {
            showSyncIndicator(`Synced ${snapshot.size} quantities`, 'info');
        }

    } catch (error) {
        console.error('Error loading quantities from Firebase:', error);
        showSyncIndicator(`Quantity sync failed: ${error.message}`, 'error');
    }
}

async function debugBranchAccess() {
    console.log('Current branch:', currentBranch);
    console.log('All branches:', allBranches);
    console.log('Collection name:', 'inventory-items');

    try {
        const testCollection = collection(db, 'inventory-items');
        const testSnapshot = await getDocs(testCollection);
        console.log('Collection access test successful, docs:', testSnapshot.size);
    } catch (error) {
        console.error('Collection access test failed:', error);
    }
}

// Make it available in console for debugging
window.debugBranchAccess = debugBranchAccess;

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

async function confirmModeSwitch() {
    if (!pendingModeSwitch) return;

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
    document.getElementById('modeSwitchModalOverlay').classList.remove('show');
}

function loadLocalData() {
    // Load inventory items for current branch
    const savedItems = localStorage.getItem(`${STORAGE_KEYS.INVENTORY}-${currentBranch}`);
    if (savedItems) {
        inventoryItems = JSON.parse(savedItems);
    }

    // Load quantities for current branch
    const savedQuantities = localStorage.getItem(`${STORAGE_KEYS.QUANTITIES}-${currentBranch}`);
    if (savedQuantities) {
        quantities = JSON.parse(savedQuantities);
        migrateQuantityData();
    }

    // Render with local data first
    renderInventory();
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

    // Sort categories by the minimum order of items within each category
    const sortedCategories = Object.keys(itemsByCategory).sort((a, b) => {
        const minOrderA = Math.min(...itemsByCategory[a].map(item => item.order || 0));
        const minOrderB = Math.min(...itemsByCategory[b].map(item => item.order || 0));
        return minOrderA - minOrderB;
    });

    inventoryList.innerHTML = sortedCategories.map(category => {
        const categoryItems = itemsByCategory[category];

        // Sort items by their order field to preserve JSON order
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

            const imageHtml = item.photo ?
                `<img src="${item.photo}" alt="${item.name}">` :
                '<span>No Image</span>';

            return `
            <div class="item-card">
                <div class="item-image">${imageHtml}</div>
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

        const docId = `${currentBranch}-${dateKey}-${itemId}`;
        const quantityDoc = {
            branch: currentBranch,
            date: dateKey,
            itemId: itemId,
            mode: mode,
            value: quantityData.value,
            timestamp: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };

        // Use set with merge to update or create
        await setDoc(doc(db, 'inventory-quantities', docId), quantityDoc, { merge: true });

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
        restock_amount: parseInt(document.getElementById('restockAmount').value) || 0,
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

    const collectionName = 'inventory-items';

    try {
        if (editingItemId) {
            // Editing existing item
            showSyncIndicator('Updating item...', 'info');

            try {
                // Update in Firebase
                const itemDoc = doc(db, 'inventory-items', editingItemId);
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

            const docRef = await addDoc(collection(db, 'inventory-items'), itemData);
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
            await addDoc(collection(db, "inventory-items"), {
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

        // Get all items that have been checked for this mode
        const quantities = getCurrentDateQuantities();
        const syncPromises = [];

        Object.keys(quantities).forEach(itemId => {
            const quantityData = quantities[itemId][mode];
            if (quantityData.checked) {
                const docId = `${currentBranch}-${dateKey}-${itemId}`;
                const quantityDoc = {
                    branch: currentBranch,
                    date: dateKey,
                    itemId: itemId,
                    mode: mode,
                    value: quantityData.value,
                    timestamp: timestamp,
                    lastUpdated: timestamp,
                    submittedAt: timestamp
                };

                syncPromises.push(
                    setDoc(doc(db, 'inventory-quantities', docId), quantityDoc, { merge: true })
                );
            }
        });

        await Promise.all(syncPromises);
        showSyncIndicator(`${mode} inventory submitted`, 'success');

    } catch (error) {
        console.error('Error syncing mode completion:', error);
        showSyncIndicator('Failed to submit inventory', 'error');
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

    document.addEventListener('click', handleItemEdit);

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
        // Create export data with restock_amount instead of order fields
        const exportData = inventoryItems.map(item => ({
            name: item.name,
            subtitle: item.subtitle || '',
            unit: item.unit,
            category: item.category || 'Other',
            restock_amount: item.restock_amount || 0
        }));

        // Create and download file
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const branchName = getBranchDisplayName(currentBranch);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `inventory-${currentBranch}-${new Date().toISOString().split('T')[0]}.json`;
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

        const collectionName = 'inventory-items';

        // Delete all existing items from Firebase for this branch
        const deleteQuery = query(
            collection(db, 'inventory-items'),
            where('branch', '==', currentBranch)
        );
        const deleteSnapshot = await getDocs(deleteQuery);
        const deletePromises = deleteSnapshot.docs.map(async (docSnapshot) => {
            return deleteDoc(doc(db, 'inventory-items', docSnapshot.id));
        });
        await Promise.all(deletePromises);

        // Add imported items to Firebase with order preserved
        const addPromises = importData.map(async (item, index) => {
            const itemData = {
                name: item.name.trim(),
                subtitle: (item.subtitle || '').trim(),
                unit: item.unit,
                category: item.category || 'Other',
                restock_amount: item.restock_amount || 0,
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
    document.getElementById('restockAmount').value = item.restock_amount || 0;

    // Handle existing photo
    if (item.photo) {
        document.getElementById('previewImage').src = item.photo;
        document.getElementById('photoPreview').style.display = 'block';
    } else {
        document.getElementById('photoPreview').style.display = 'none';
        document.getElementById('previewImage').src = '';
    }
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
            branch: currentBranch,  // Add this line
            order: 0,
            categoryOrder: maxCategoryOrder + 100,
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

