import { db } from './firebase-inventory.js';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

console.log('=== INVENTORY BUILDER LOADED - VERSION 24 ===');

// Global state - CACHE BUST: v24 (MOA branch, admin branch list fix)
let masterItems = [];
let availableBranches = ['sm-north', 'podium', 'moa'];
// Removed branchAssignments and branchOverrides - using new structure in master-items
let selectedBranch = 'sm-north';
let editingMasterItemId = null;

// Dashboard state
// Initialize from selector if available, otherwise from localStorage
let dashboardBranch = (() => {
  if (typeof document !== 'undefined') {
    const selector = document.getElementById('branchSelector');
    if (selector) return selector.value;
  }
  return localStorage.getItem('dashboard-selected-branch') || 'sm-north';
})();
let dashboardDate = new Date();
let dashboardItems = [];
let openingQuantities = {};
let closingQuantities = {};
let addedQuantities = {};
let deliveryQuantities = {};
let pullOutQuantities = {};
let wastageQuantities = {};
let dashboardCollapsedCategories = JSON.parse(localStorage.getItem('dashboard-collapsed-categories') || '[]');
let branchCollapsedCategories = JSON.parse(localStorage.getItem('branch-collapsed-categories') || '[]');
let isFilteringLowStocks = false;

// Weekly View state
let weeklyBranch = localStorage.getItem('weekly-selected-branch') || 'podium';
let weeklyDate = (() => {
  const saved = localStorage.getItem('weekly-selected-date');
  if (saved) {
    const date = new Date(saved);
    if (!isNaN(date.getTime())) return date;
  }
  return new Date(); // Default to today
})();
let weeklyData = {}; // Will store 7 days of usage data
let weeklyQuantityType = localStorage.getItem('weekly-quantity-type') || 'used'; // 'used' or 'closing'
let isWeeklyDatePickerActive = false; // Track if weekly date picker is active
let dashboardLoading = false; // Track if dashboard is currently loading data
let isMovingItems = false; // Track if we're currently moving items to prevent background sync override
let isTogglingBranch = false; // Track if we're currently toggling branch enabled status to prevent background sync override
let forceDashboardRefresh = false; // Force dashboard to load fresh data

console.log('Dashboard state initialized:', {
  dashboardBranch,
  dashboardDate: dashboardDate.toDateString(),
  dashboardItemsLength: dashboardItems.length,
  dashboardCollapsedCategories
});

// UI state
let branchEditMode = false;
let masterEditMode = false; // Changed from reorder mode to general edit mode
let masterSort = { key: 'displayOrder', dir: 'asc' }; // default to saved order
let branchSort = { key: 'displayOrder', dir: 'asc' };
let currentTask = 'master-items';

// Removed assignmentId and inventoryDocId - no longer needed with new structure

// Helpers for sorting
function compare(a, b, key, dir = 'asc') {
  const va = a[key] ?? '';
  const vb = b[key] ?? '';
  const res = (va > vb) - (va < vb);
  return dir === 'asc' ? res : -res;
}

function setSortableHeaders(containerId, onSort) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('th').forEach((th, idx) => {
    th.addEventListener('click', () => onSort(idx));
  });
}

// Get date key in local time (not UTC) to avoid timezone issues
function getDateKey(date = new Date()) {
  // Use local time instead of UTC to avoid timezone issues
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`; // Returns "YYYY-MM-DD" in local time
}

document.addEventListener('DOMContentLoaded', async function () {
  const initStart = performance.now();
  console.log('DOM Content Loaded - starting initialization');
  
  // Setup event listeners first so dashboard can load immediately
  setupEventListeners();
  console.log('Event listeners set up');
  
  // Initialize builder in background (non-blocking)
  initializeBuilder().then(() => {
    console.log('Builder initialized');
  });
  
  const switchStart = performance.now();
  switchToTask('dashboard');
  const switchEnd = performance.now();
  console.log(`Switched to dashboard task in: ${(switchEnd - switchStart).toFixed(2)}ms`);
  // Dashboard data will be loaded by switchToTask
  console.log('Dashboard initialization complete');
  
  const totalInitTime = performance.now() - initStart;
  console.log(`🚀 Total initialization time: ${totalInitTime.toFixed(2)}ms`);
});

async function initializeBuilder() {
  await loadBranches();
  await loadMasterItems();
  // No longer need to load branch assignments - using new structure
  // Don't render master items here - let the task switching handle it
  updateBranchEditControlsState();
  updateMasterEditControlsState();
  
  // No longer need to sync to separate collections - everything is in master-items now
}

async function loadBranches() {
  try {
    const snap = await getDocs(collection(db, 'branches'));
    const names = [];
    snap.forEach(d => {
      const data = d.data();
      const key = (data && (data.key || data.id)) ? (data.key || data.id) : (data && data.name ? String(data.name).toLowerCase().replace(/\s+/g, '-') : '');
      const isPopup = (data && (data.type === 'popup' || /popup/i.test(data.name || '') || /pop[- ]?up/i.test(key)));
      if (key && !isPopup && (key === 'sm-north' || key === 'podium' || key === 'moa')) {
        names.push(key);
      }
    });
    // Always include known branches so MOA shows in admin even if not yet in Firestore 'branches'
    const knownBranches = ['sm-north', 'podium', 'moa'];
    availableBranches = [...new Set([...knownBranches, ...names])];
  } catch (_) {
    availableBranches = ['sm-north', 'podium', 'moa'];
  }
  // No longer need to initialize old variables
  selectedBranch = availableBranches[0];
  
  // Populate dashboard branch selector
  const sel = document.getElementById('branchSelector');
  if (sel) {
    sel.innerHTML = availableBranches.map(b => `<option value="${b}">${getBranchDisplayName(b)}</option>`).join('');
    sel.value = dashboardBranch; // Use dashboardBranch instead of selectedBranch
  }

  // Populate weekly view branch selector
  const weeklySel = document.getElementById('weeklyBranchSelector');
  if (weeklySel) {
    weeklySel.innerHTML = availableBranches.map(b => `<option value="${b}">${getBranchDisplayName(b)}</option>`).join('');
    weeklySel.value = weeklyBranch;
  }

  // Initialize weekly quantity type segmented control
  const weeklyQuantityBtns = document.querySelectorAll('[data-quantity-type]');
  weeklyQuantityBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.quantityType === weeklyQuantityType);
  });
  
  // Populate branch list selector
  const branchListSel = document.getElementById('branchListSelector');
  if (branchListSel) {
    branchListSel.innerHTML = availableBranches.map(b => `<option value="${b}">${getBranchDisplayName(b)}</option>`).join('');
    branchListSel.value = selectedBranch;
  }
}

async function loadMasterItems(skipCategoryOrderInit = false, forceRefresh = false) {
  // Try to load from cache first for instant display (unless force refresh)
  if (!forceRefresh) {
    const cachedMasterItems = loadMasterItemsFromCache();
    if (cachedMasterItems) {
      console.log('Loading cached master items instantly');
      masterItems = cachedMasterItems;
      
      // Render master items immediately if we're on that tab
      if (currentTask === 'master-items') {
        renderMasterItems();
      }
      if (currentTask === 'branch-list') {
        renderBranchList();
      }
      
      // Then sync with Firebase in background
      syncMasterItemsFromFirebaseInBackground();
      return;
    }
  }
  
  // Load from Firebase (either no cache or force refresh)
  const querySnapshot = await getDocs(collection(db, 'inventory', '_config', 'items'));
  masterItems = querySnapshot.docs.map(d => {
    const data = d.data();
    if (data && data.subtitle && !data.description) data.description = data.subtitle;
    const item = { 
      id: d.id, 
      displayOrder: data.displayOrder ?? 0, 
      categoryOrder: data.categoryOrder ?? 0, 
      ...data,
      // Migrate defaultRestockLevel to restockAmount for consistency
      restockAmount: data.restockAmount || data.defaultRestockLevel || 0
    };
    return item;
  });
  
  // Cache the master items
  cacheMasterItems(masterItems);
  
  // Render immediately for force refresh
  if (forceRefresh) {
    if (currentTask === 'master-items') {
      renderMasterItems();
    }
    if (currentTask === 'branch-list') {
      renderBranchList();
    }
  }
  
  // Skip categoryOrder initialization if requested (for faster saves)
  if (skipCategoryOrderInit) return;
  
  // Initialize categoryOrder for items that don't have it
  const categories = new Set();
  masterItems.forEach(item => {
    if (item.category) categories.add(item.category);
  });
  
  const categoryArray = Array.from(categories).sort();
  const updates = [];
  
  masterItems.forEach(item => {
    if (item.category && item.categoryOrder === undefined) {
      const categoryIndex = categoryArray.indexOf(item.category);
      if (categoryIndex !== -1) {
        updates.push(updateDoc(doc(db, 'inventory', '_config', 'items', item.id), { categoryOrder: categoryIndex }));
      }
    }
  });
  
  if (updates.length > 0) {
    console.log('Initializing categoryOrder for', updates.length, 'items');
    await Promise.all(updates);
    // Reload after updates
    const updatedSnapshot = await getDocs(collection(db, 'inventory', '_config', 'items'));
    masterItems = updatedSnapshot.docs.map(d => {
      const data = d.data();
      if (data && data.subtitle && !data.description) data.description = data.subtitle;
      return { id: d.id, displayOrder: data.displayOrder ?? 0, categoryOrder: data.categoryOrder ?? 0, ...data };
    });
  }
}

// Removed loadBranchAssignments - using new enabledBranches structure in master-items

function setupEventListeners() {
  // Add global checkbox event listener for debugging
  document.addEventListener('change', function(e) {
    if (e.target.type === 'checkbox' && e.target.closest('#branchItemsList')) {
      console.log('🔍 GLOBAL DEBUG: Checkbox change detected');
      console.log('🔍 GLOBAL DEBUG: Checkbox element:', e.target);
      console.log('🔍 GLOBAL DEBUG: Checkbox checked:', e.target.checked);
      console.log('🔍 GLOBAL DEBUG: Checkbox onchange attribute:', e.target.getAttribute('onchange'));
      
      // Check if the onchange function exists
      const onchangeAttr = e.target.getAttribute('onchange');
      if (!onchangeAttr) {
        console.error('🔍 GLOBAL DEBUG: No onchange attribute found on checkbox!');
      }
    }
  });

  document.querySelectorAll('.task-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchToTask(btn.dataset.task));
  });

  const addBtn = document.getElementById('addMasterItemBtn');
  if (addBtn) addBtn.addEventListener('click', () => openMasterItemModal());
  const addMultipleBtn = document.getElementById('addMultipleItemsBtn');
  if (addMultipleBtn) addMultipleBtn.addEventListener('click', () => openAddMultipleItemsModal());
  const emptyAdd = document.getElementById('emptyStateAddBtn');
  if (emptyAdd) emptyAdd.addEventListener('click', () => openMasterItemModal());
  const importBtn = document.getElementById('importMasterBtn');
  if (importBtn) importBtn.addEventListener('click', () => document.getElementById('masterImportFile').click());
  const masterSearch = document.getElementById('masterSearch');
  if (masterSearch) masterSearch.addEventListener('input', renderMasterItems);
  
  // Master items edit mode
  const editBtn = document.getElementById('toggleMasterEditBtn');
  if (editBtn) editBtn.addEventListener('click', () => { 
    masterEditMode = !masterEditMode; 
    updateMasterEditControlsState(); 
    
    
    renderMasterItems(); 
  });
  
  // Add category button
  const addCategoryBtn = document.getElementById('addCategoryBtn');
  if (addCategoryBtn) addCategoryBtn.addEventListener('click', () => {
    const newCategory = prompt('Enter new category name:');
    if (newCategory && newCategory.trim()) {
      // Create a temporary item with the new category to establish it
      const tempItem = {
        name: 'TEMP_ITEM_TO_CREATE_CATEGORY',
        description: '',
        category: newCategory.trim(),
        unit: 'pcs',
        restockAmount: 0,
        displayOrder: 999 // High order to put it at the end
      };
      
      console.log('Creating temp item for category:', newCategory.trim());
      
      addDoc(collection(db, 'inventory', '_config', 'items'), tempItem).then(async (docRef) => {
        console.log('Temp item created, now deleting...');
        // Immediately delete the temp item
        await deleteDoc(docRef);
        console.log('Temp item deleted, reloading data...');
        
        await loadMasterItems();
        renderMasterItems();
        renderBranchList();
        
        // Update the modal dropdown
        const categorySelect = document.getElementById('masterItemCategory');
        if (categorySelect) {
          const categories = getUniqueCategories();
          categorySelect.innerHTML = categories.map(cat => `<option value="${cat}">${cat}</option>`).join('') + '<option value="Other">Other</option>';
        }
        
        console.log('Category added successfully:', newCategory.trim());
        console.log('Available categories:', getUniqueCategories());
      }).catch(error => {
        console.error('Error adding category:', error);
        alert('Error adding category. Please try again.');
      });
    }
  });

  // Branch list controls
  const branchListSelector = document.getElementById('branchListSelector');
  if (branchListSelector) branchListSelector.addEventListener('change', e => { selectedBranch = e.target.value; renderBranchList(); });
  const branchSearch = document.getElementById('branchSearch');
  if (branchSearch) branchSearch.addEventListener('input', renderBranchList);
  const selectAllBtn = document.getElementById('selectAllBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const toggleEditBtn = document.getElementById('toggleBranchEditBtn');
  if (toggleEditBtn) toggleEditBtn.addEventListener('click', () => { branchEditMode = !branchEditMode; toggleEditBtn.textContent = branchEditMode ? 'Done' : 'Edit'; updateBranchEditControlsState(); renderBranchList(); });
  // Removed bulk assign/clear buttons - using new branch management system

  // Modal (guarded)
  const modalClose = document.getElementById('masterItemModalClose');
  if (modalClose) modalClose.addEventListener('click', closeMasterItemModal); else console.warn('masterItemModalClose not found');
  const modalCancel = document.getElementById('masterItemCancelBtn');
  if (modalCancel) modalCancel.addEventListener('click', closeMasterItemModal); else console.warn('masterItemCancelBtn not found');
  const modalSave = document.getElementById('masterItemSaveBtn');
  if (modalSave) modalSave.addEventListener('click', handleMasterItemSubmit); else console.warn('masterItemSaveBtn not found');
  const photoInput = document.getElementById('masterItemPhoto');
  if (photoInput) photoInput.addEventListener('change', handleMasterPhotoSelect); else console.warn('masterItemPhoto not found');
  const removePhotoBtn = document.getElementById('removeMasterPhoto');
  if (removePhotoBtn) removePhotoBtn.addEventListener('click', handleMasterPhotoRemove); else console.warn('removeMasterPhoto not found');

  // File input
  const importFile = document.getElementById('masterImportFile');
  if (importFile) importFile.addEventListener('change', handleMasterImport);

  // Dashboard controls
  const dashboardBranchSelector = document.getElementById('branchSelector');
  if (dashboardBranchSelector) {
    // Set the initial value
    dashboardBranchSelector.value = dashboardBranch;
    dashboardBranchSelector.addEventListener('change', async (e) => {
      dashboardBranch = e.target.value;
      localStorage.setItem('dashboard-selected-branch', dashboardBranch);
      
      // Clear cache when changing branches to ensure fresh data for new branch
      clearInventoryItemsCache();
      clearQuantitiesCache();
      await loadDashboardData();
    });
  }
  
  const prevDateBtn = document.getElementById('prevDate');
  const nextDateBtn = document.getElementById('nextDate');
  const dateDisplay = document.getElementById('dateDisplay');
  
  if (prevDateBtn) prevDateBtn.addEventListener('click', () => changeDashboardDate(-1));
  if (nextDateBtn) nextDateBtn.addEventListener('click', () => changeDashboardDate(1));
  if (dateDisplay) dateDisplay.addEventListener('click', openDateModal);
  
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing...';
      
      // Clear cache to force fresh data load
      clearInventoryItemsCache();
      clearQuantitiesCache();
      
      await loadDashboardData();
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh Data';
    });
  }

  // Low Stocks filter segmented control
  const filterLowStocksBtn = document.getElementById('filterLowStocksBtn');
  const showLowStocksBtn = document.getElementById('showLowStocksBtn');
  
  if (filterLowStocksBtn && showLowStocksBtn) {
    filterLowStocksBtn.addEventListener('click', () => {
      isFilteringLowStocks = false;
      filterLowStocksBtn.classList.add('active');
      showLowStocksBtn.classList.remove('active');
      renderDashboard(); // Re-render to apply filter
    });
    
    showLowStocksBtn.addEventListener('click', () => {
      isFilteringLowStocks = true;
      showLowStocksBtn.classList.add('active');
      filterLowStocksBtn.classList.remove('active');
      renderDashboard(); // Re-render to apply filter
    });
  }

  // Weekly View controls
  const weeklyBranchSelector = document.getElementById('weeklyBranchSelector');
  if (weeklyBranchSelector) {
    weeklyBranchSelector.addEventListener('change', async (e) => {
      weeklyBranch = e.target.value;
      localStorage.setItem('weekly-selected-branch', weeklyBranch);
      await loadWeeklyViewData();
    });
  }

  // Weekly date picker controls
  const weeklyPrevDateBtn = document.getElementById('weeklyPrevDate');
  const weeklyNextDateBtn = document.getElementById('weeklyNextDate');
  const weeklyDateDisplay = document.getElementById('weeklyDateDisplay');
  
  if (weeklyPrevDateBtn) {
    weeklyPrevDateBtn.addEventListener('click', () => {
      changeWeeklyDate(-7); // Go back one week
    });
  }
  
  if (weeklyNextDateBtn) {
    weeklyNextDateBtn.addEventListener('click', () => {
      changeWeeklyDate(7); // Go forward one week
    });
  }
  
  if (weeklyDateDisplay) {
    weeklyDateDisplay.addEventListener('click', () => {
      isWeeklyDatePickerActive = true;
      openDateModal();
    });
    // Initialize the date display
    updateWeeklyDateDisplay();
  }

  const weeklyRefreshBtn = document.getElementById('weeklyRefreshBtn');
  if (weeklyRefreshBtn) {
    weeklyRefreshBtn.addEventListener('click', async () => {
      weeklyRefreshBtn.disabled = true;
      weeklyRefreshBtn.textContent = 'Refreshing...';
      
      await loadWeeklyViewData();
      
      weeklyRefreshBtn.disabled = false;
      weeklyRefreshBtn.textContent = 'Refresh Data';
    });
  }

  // Weekly quantity type segmented control
  const weeklyQuantityBtns = document.querySelectorAll('[data-quantity-type]');
  weeklyQuantityBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      weeklyQuantityType = e.target.dataset.quantityType;
      localStorage.setItem('weekly-quantity-type', weeklyQuantityType);
      
      // Update button states
      weeklyQuantityBtns.forEach(b => {
        b.classList.toggle('active', b.dataset.quantityType === weeklyQuantityType);
      });
      
      await loadWeeklyViewData();
    });
  });
  
  const dateModalClose = document.getElementById('dateModalClose');
  if (dateModalClose) dateModalClose.addEventListener('click', closeDateModal);

  // Bulk add modal event listeners
  const addMultipleModalClose = document.getElementById('addMultipleItemsModalClose');
  if (addMultipleModalClose) addMultipleModalClose.addEventListener('click', closeAddMultipleItemsModal);
  
  const bulkAddCancelBtn = document.getElementById('bulkAddCancelBtn');
  if (bulkAddCancelBtn) bulkAddCancelBtn.addEventListener('click', closeAddMultipleItemsModal);
  
  const bulkAddSaveBtn = document.getElementById('bulkAddSaveBtn');
  if (bulkAddSaveBtn) bulkAddSaveBtn.addEventListener('click', handleBulkAddSubmit);
  
  const addBulkRowBtn = document.getElementById('addBulkRowBtn');
  if (addBulkRowBtn) addBulkRowBtn.addEventListener('click', addBulkRow);
  
  const copyLastRowBtn = document.getElementById('copyLastRowBtn');
  if (copyLastRowBtn) copyLastRowBtn.addEventListener('click', copyLastBulkRow);
  
  const clearBulkTableBtn = document.getElementById('clearBulkTableBtn');
  if (clearBulkTableBtn) clearBulkTableBtn.addEventListener('click', clearBulkTable);
}

function updateBranchEditControlsState() {
  const disabled = !branchEditMode;
  const selectAllBtn = document.getElementById('selectAllBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const editControls = document.querySelector('.edit-controls');
  
  if (selectAllBtn) selectAllBtn.classList.toggle('btn-disabled', disabled);
  if (clearAllBtn) clearAllBtn.classList.toggle('btn-disabled', disabled);
  if (editControls) editControls.style.display = branchEditMode ? 'flex' : 'none';
}

function updateMasterEditControlsState() {
  const editBtn = document.getElementById('toggleMasterEditBtn');
  const addItemBtn = document.getElementById('addMasterItemBtn');
  const addCategoryBtn = document.getElementById('addCategoryBtn');
  
  if (editBtn) editBtn.textContent = masterEditMode ? 'Done' : 'Rearrange';
  if (addItemBtn) addItemBtn.disabled = masterEditMode;
  if (addCategoryBtn) addCategoryBtn.disabled = masterEditMode;
  
  // Toggle master-edit-mode class on body
  document.body.classList.toggle('master-edit-mode', masterEditMode);
  console.log('Master edit mode:', masterEditMode, 'Body class:', document.body.classList.contains('master-edit-mode'));
  
  renderMasterItems();
}

function switchToTask(task) {
  console.log('=== SWITCH TO TASK ===', task);
  // Check if we're in edit mode and warn user
  if ((masterEditMode || branchEditMode) && task !== currentTask) {
    showEditModeWarning(task);
    return;
  }
  
  currentTask = task;
  document.querySelectorAll('.task-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.task === task));
  document.querySelectorAll('.task-section').forEach(sec => sec.classList.remove('active'));
  const el = document.getElementById(`${task}-task`);
  if (el) el.classList.add('active');
  console.log('Task switched, about to render:', task);
  if (task === 'dashboard') {
    // Set loading flag immediately to prevent empty state
    dashboardLoading = true;
    console.log('Set dashboardLoading = true for dashboard task');
    
  
  // Load dashboard data (will use cache if available for instant loading)
  loadDashboardData();
  }
  if (task === 'weekly-view') {
    updateWeeklyDateDisplay(); // Ensure date display is up to date
    loadWeeklyViewData();
  }
  if (task === 'master-items') renderMasterItems();
  if (task === 'branch-list') renderBranchList();
}

function showEditModeWarning(newTask) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width: 400px;">
      <div class="modal-header">
        <h3>Unsaved Changes</h3>
      </div>
      <div class="modal-body">
        <p>You have unsaved changes in edit mode. Do you want to:</p>
        <div style="margin-top: 20px;">
          <button class="btn btn-secondary" onclick="finishEditingAndSwitch('${newTask}')">Finish Editing</button>
          <button class="btn btn-light" onclick="cancelEditingAndSwitch('${newTask}')">Cancel & Switch</button>
          <button class="btn btn-primary" onclick="closeEditWarning()">Continue Editing</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add('show'), 10);
}

function finishEditingAndSwitch(newTask) {
  // Exit edit mode
  if (masterEditMode) {
    masterEditMode = false;
    updateMasterEditControlsState();
    renderMasterItems();
  }
  if (branchEditMode) {
    branchEditMode = false;
    updateBranchEditControlsState();
    renderBranchList();
  }
  
  closeEditWarning();
  switchToTask(newTask);
}

function cancelEditingAndSwitch(newTask) {
  // Exit edit mode without saving
  if (masterEditMode) {
    masterEditMode = false;
    updateMasterEditControlsState();
    renderMasterItems();
  }
  if (branchEditMode) {
    branchEditMode = false;
    updateBranchEditControlsState();
    renderBranchList();
  }
  
  closeEditWarning();
  switchToTask(newTask);
}

function closeEditWarning() {
  const modal = document.querySelector('.modal-overlay');
  if (modal) {
    modal.classList.remove('show');
    setTimeout(() => modal.remove(), 300);
  }
}

function buildTable(headers, rowsHtml, tableId) {
  return `
    <table class="inv-table" id="${tableId}">
      <thead>
        <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rowsHtml || ''}
      </tbody>
    </table>`;
}

function renderMasterItems() {
  console.log('=== RENDER MASTER ITEMS CALLED ===');
  console.log('masterItems array length:', masterItems.length);
  console.log('masterItems array:', masterItems);
  const container = document.getElementById('masterItemsList');
  const term = (document.getElementById('masterSearch')?.value || '').toLowerCase();
  let items = masterItems.filter(i => `${i.name} ${i.description || ''} ${i.category || ''}`.toLowerCase().includes(term));
  console.log('filtered items length:', items.length);

  if (items.length === 0) {
    console.log('SHOWING EMPTY STATE - no items found');
    container.innerHTML = `
      <div class="empty-state">
        No master items ${term ? 'matching your search' : 'created yet'}
        <div style="margin-top:10px"><button class="btn btn-primary" id="emptyStateAddBtn">Create Item</button></div>
      </div>`;
    const emptyAdd = document.getElementById('emptyStateAddBtn');
    if (emptyAdd) emptyAdd.addEventListener('click', () => openMasterItemModal());
    return;
  }

  // Always group by category and sort by displayOrder within each category
  const byCat = items.reduce((acc, it) => { 
    const c = it.category || 'Other'; 
    (acc[c] ||= []).push(it); 
    return acc; 
  }, {});
  
  Object.keys(byCat).forEach(c => byCat[c].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)));

  // Get collapsed state from localStorage
  const collapsedCategories = JSON.parse(localStorage.getItem('collapsedCategories') || '[]');

  const rows = getUniqueCategories().map(cat => {
    const isCollapsed = collapsedCategories.includes(cat);
    const categoryControls = masterEditMode ? `
      <button class="btn btn-light btn-small move-btn" onclick="moveCategory('${cat}', 'up')" title="Move Category Up">
        <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 2L2 6h8L6 2z"/>
        </svg>
      </button>
      <button class="btn btn-light btn-small move-btn" onclick="moveCategory('${cat}', 'down')" title="Move Category Down">
        <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 10L2 6h8L6 10z"/>
        </svg>
      </button>
      <button class="btn btn-secondary btn-small" onclick="editCategory('${cat}')">Edit</button>
      ${isCategoryEmpty(cat) ? `<button class="btn btn-light btn-small" onclick="deleteCategory('${cat}')">Delete</button>` : ''}
    ` : '';
    
    const header = `<tr class="category-header" data-category="${cat}">
      <td colspan="6">
        <div class="category-header-left">
          <button class="category-collapse-btn ${isCollapsed ? 'collapsed' : ''}" data-category="${cat}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <span class="category-name">${cat}</span>
        </div>
      </td>
      <td style="text-align: center; vertical-align: middle;">
        <div class="category-edit-controls" onclick="event.stopPropagation()" style="display: flex; gap: 4px; align-items: center; justify-content: center;">
          ${categoryControls}
        </div>
      </td>
    </tr>`;
    
    const catRows = byCat[cat].map((item, idx) => `
      <tr class="category-item-row" data-category="${cat}" data-item-id="${item.id}" data-category="${cat}" data-index="${idx}" ${isCollapsed ? 'style="display:none;"' : ''}>
        <td>
          <div class="photo-container" onclick="${masterEditMode ? (item.photo ? `editMasterItem('${item.id}')` : `openPhotoUpload('${item.id}')`) : 'return false'}">
            ${item.photo ? 
              `<img src="${item.photo}" alt="" onerror="this.style.display='none'"/>` : 
              `<div class="photo-placeholder"></div>`
            }
          </div>
        </td>
        <td>${item.name}</td>
        <td>${item.description || ''}</td>
        <td>${item.category || 'Other'}</td>
        <td>${item.unit}</td>
        <td style="text-align: center;">
          ${masterEditMode ? 
            `<input type="number" min="0" value="${item.restockAmount || 0}" style="width:80px; text-align:center" onchange="onMasterRestockChange('${item.id}', this.value)">` : 
            (item.restockAmount || 0)
          }
        </td>
        <td style="white-space:nowrap; text-align: center;">
          <div style="display: flex; gap: 4px; align-items: center; justify-content: center;">
            ${masterEditMode ? `
              <button class="btn btn-light btn-small move-btn" onclick="moveMasterItem('${item.id}', 'up')" title="Move Up">
                <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 2L2 6h8L6 2z"/>
                </svg>
              </button>
              <button class="btn btn-light btn-small move-btn" onclick="moveMasterItem('${item.id}', 'down')" title="Move Down">
                <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 10L2 6h8L6 10z"/>
                </svg>
              </button>
            ` : `
              <button class="btn btn-secondary btn-small" onclick="editMasterItem('${item.id}')">Edit</button>
              <button class="btn btn-info btn-small" onclick="duplicateMasterItem('${item.id}')">Copy</button>
              <button class="btn btn-light btn-small" onclick="deleteMasterItem('${item.id}')">Delete</button>
            `}
          </div>
        </td>
      </tr>`).join('');
    return header + catRows;
  }).join('');

  container.innerHTML = `
    <table class="master-table">
      <thead>
        <tr>
          <th>Photo</th>
          <th>Item</th>
          <th>Description</th>
          <th>Category</th>
          <th>Unit</th>
          <th>Restock Value</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`;
  
  // Setup master category collapse functionality
  setupMasterCategoryCollapse();
  
}

function renderBranchList() {
  console.log('🔍 RENDER DEBUG: Starting renderBranchList');
  
  const container = document.getElementById('branchItemsList');
  if (!container) {
    console.log('🔍 RENDER DEBUG: No container found');
    return;
  }
  
  const term = (document.getElementById('branchSearch')?.value || '').toLowerCase();
  console.log('🔍 RENDER DEBUG: Search term:', term);
  console.log('🔍 RENDER DEBUG: Master items count:', masterItems.length);
  console.log('🔍 RENDER DEBUG: Branch edit mode:', branchEditMode);
  console.log('🔍 RENDER DEBUG: Selected branch:', selectedBranch);
  
  let items = masterItems.map(mi => ({
    id: mi.id,
    name: mi.name,
    description: mi.description || '',
    category: mi.category || 'Other',
    unit: mi.unit,
    displayOrder: mi.displayOrder ?? 0,
    enabledBranches: mi.enabledBranches,
    branchOverrides: mi.branchOverrides,
    restockAmount: mi.restockAmount
  })).filter(i => `${i.name} ${i.description} ${i.category}`.toLowerCase().includes(term));

  // Check for duplicate items
  const itemNames = items.map(item => item.name);
  const duplicates = itemNames.filter((name, index) => itemNames.indexOf(name) !== index);
  if (duplicates.length > 0) {
    console.log('🔍 RENDER DEBUG: Found duplicate item names:', duplicates);
    duplicates.forEach(dupName => {
      const duplicateItems = items.filter(item => item.name === dupName);
      console.log(`🔍 RENDER DEBUG: Duplicate items for "${dupName}":`, duplicateItems.map(item => ({ id: item.id, name: item.name })));
    });
  }

  // When not in edit mode, only show items enabled for this branch
  if (!branchEditMode) {
    items = items.filter(item => {
      // If item doesn't have enabledBranches field (legacy), assume it's enabled for all branches
      if (item.enabledBranches === undefined) return true;
      // If enabledBranches is empty array [], it means disabled for all branches
      if (item.enabledBranches.length === 0) return false;
      // Check if current branch is in the enabledBranches array
      return item.enabledBranches.includes(selectedBranch);
    });
  }

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">No items found</div>`;
    return;
  }

  // Group by category and sort by displayOrder within each category
  const byCat = items.reduce((acc, it) => { 
    const c = it.category || 'Other'; 
    (acc[c] ||= []).push(it); 
    return acc; 
  }, {});
  
  Object.keys(byCat).forEach(c => byCat[c].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)));

  const rows = getUniqueCategories().map(cat => {
    const isCollapsed = branchCollapsedCategories.includes(cat);
    const header = `<tr class="category-header" data-category="${cat}">
      <td colspan="${branchEditMode ? '7' : '6'}">
        <div class="category-header-container">
          <div class="category-header-left">
            <button class="category-collapse-btn ${isCollapsed ? 'collapsed' : ''}" data-category="${cat}">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <span class="category-name">${cat}</span>
          </div>
        </div>
      </td>
    </tr>`;
      const catRows = byCat[cat].map(item => {
    // Get the full master item to access all data
    const masterItem = masterItems.find(m => m.id === item.id);
    
    // Get restock level - either from branch override or default
    const branchRestockLevel = item.branchOverrides?.[selectedBranch]?.restockLevel;
    const currentRestockLevel = branchRestockLevel !== undefined ? branchRestockLevel : (item.restockAmount || 0);
    const valueAttr = `value="${currentRestockLevel}"`;
    
    // Check if item is enabled for this branch
    // If enabledBranches doesn't exist, assume it's enabled for all branches (legacy items)
    // If enabledBranches is empty array [], it means disabled for all branches
    // If enabledBranches has values, check if current branch is included
    const isEnabled = item.enabledBranches === undefined 
      ? true  // Legacy items without enabledBranches field
      : item.enabledBranches.includes(selectedBranch);  // Check if branch is in the array

    console.log(`🔍 RENDER DEBUG: Item ${item.name}: enabledBranches =`, item.enabledBranches, ', selectedBranch =', selectedBranch, ', isEnabled =', isEnabled);
    console.log(`🔍 RENDER DEBUG: Item ${item.name}: item.id =`, item.id);

    const checkbox = branchEditMode ? `<input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="onToggleBranchEnabled('${item.id}', '${selectedBranch}', this.checked)">` : '';
    
    if (branchEditMode && (item.name === 'Iced Cups' || item.name === 'Strawless Lids')) {
      console.log(`🔍 RENDER DEBUG: Special item ${item.name} checkbox HTML:`, checkbox);
      console.log(`🔍 RENDER DEBUG: Special item ${item.name} onchange attribute:`, `onchange="onToggleBranchEnabled('${item.id}', '${selectedBranch}', this.checked)"`);
    }
    const restockInput = `<input type="number" min="0" ${valueAttr} style="width:100px" ${branchEditMode ? '' : 'disabled'} onchange="onBranchRestockChange('${item.id}', '${selectedBranch}', this.value)">`;

    const checkboxCell = branchEditMode ? `<td style="width:40px;text-align:center">${checkbox}</td>` : '';
    
    return `
      <tr class="category-item-row" data-category="${cat}" ${isCollapsed ? 'style="display:none;"' : ''}>
        ${checkboxCell}
        <td>
          <div class="photo-container">
            ${masterItem?.photo ? 
              `<img src="${masterItem.photo}" alt="" onerror="this.style.display='none'"/>` : 
              `<div class="photo-placeholder"></div>`
            }
          </div>
        </td>
        <td>${item.name}</td>
        <td>${item.description}</td>
        <td>${item.category}</td>
        <td>${item.unit}</td>
        <td>${restockInput}</td>
      </tr>`;
  }).join('');
    return header + catRows;
  }).join('');

  const headers = branchEditMode ? ['Include', 'Photo', 'Item', 'Description', 'Category', 'Unit', 'Restock'] : ['Photo', 'Item', 'Description', 'Category', 'Unit', 'Restock'];
  const tableClass = branchEditMode ? 'branch-table edit-mode' : 'branch-table';
  container.innerHTML = `
    <table class="${tableClass}">
      <thead>
        <tr>
          ${headers.map(h => `<th>${h}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`;
  
  // Setup branch category collapse functionality
  setupBranchCategoryCollapse();
}

// Removed onToggleAssignment - using new onToggleBranchEnabled function

// Removed onRestockChange - using new onBranchRestockChange function

async function onMasterRestockChange(masterId, valueStr) {
  const value = Math.max(0, parseInt(valueStr, 10) || 0);
  await updateDoc(doc(db, 'inventory', '_config', 'items', masterId), { restockAmount: value });
  await loadMasterItems();
  renderMasterItems();
}

// Migration function to restructure collections
async function migrateToNewStructure() {
  console.log('🔄 Starting migration to new collection structure...');
  
  try {
    // 1. Create categories collection
    const categories = [
      { name: 'Base Ingredients', order: 0 },
      { name: 'Packaging & Consumables', order: 1 },
      { name: 'Liquid Ingredients', order: 2 },
      { name: 'Dry Ingredients', order: 3 },
      { name: 'Desserts', order: 4 }
    ];
    
    for (const category of categories) {
      const categoryId = category.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      await setDoc(doc(db, 'inventory', '_config', 'categories', categoryId), {
        name: category.name,
        order: category.order
      });
      console.log(`✅ Created category: ${category.name}`);
    }
    
    // 2. Migrate master-items to inventory/items
    const masterItemsSnapshot = await getDocs(collection(db, 'inventory', '_config', 'items'));
    console.log(`📦 Found ${masterItemsSnapshot.docs.length} items to migrate`);
    
    for (const docSnapshot of masterItemsSnapshot.docs) {
      const data = docSnapshot.data();
      
      // Fix categoryOrder - use the correct order based on category name
      const categoryOrder = categories.find(c => c.name === data.category)?.order || 0;
      
      const newData = {
        ...data,
        categoryOrder: categoryOrder, // Fix the inconsistent categoryOrder
        // Remove old fields if they exist
        restockAmount: undefined,
        enabledBranches: data.enabledBranches || ['podium', 'sm-north', 'moa'], // Default to all branches
        branchOverrides: data.branchOverrides || {}
      };
      
      // Remove undefined fields
      Object.keys(newData).forEach(key => {
        if (newData[key] === undefined) {
          delete newData[key];
        }
      });
      
      await setDoc(doc(db, 'inventory', '_config', 'items', docSnapshot.id), newData);
      console.log(`✅ Migrated item: ${data.name}`);
    }
    
    console.log('🎉 Migration completed successfully!');
    console.log('⚠️  You can now delete the old master-items collection');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

// New functions for branch-specific operations
async function onToggleBranchEnabled(masterId, branch, enabled) {
  console.log('🔍 TOGGLE DEBUG: Starting onToggleBranchEnabled');
  console.log('🔍 TOGGLE DEBUG: masterId =', masterId);
  console.log('🔍 TOGGLE DEBUG: branch =', branch);
  console.log('🔍 TOGGLE DEBUG: enabled =', enabled);
  console.log('🔍 TOGGLE DEBUG: isTogglingBranch before =', isTogglingBranch);
  
  const masterItem = masterItems.find(m => m.id === masterId);
  if (!masterItem) {
    console.error('🔍 TOGGLE DEBUG: masterItem not found for id:', masterId);
    return;
  }
  
  console.log('🔍 TOGGLE DEBUG: Found masterItem:', masterItem.name);
  console.log('🔍 TOGGLE DEBUG: Current enabledBranches =', masterItem.enabledBranches);
  console.log('🔍 TOGGLE DEBUG: availableBranches =', availableBranches);
  
  // Set flag to prevent background sync override
  isTogglingBranch = true;
  console.log('🔍 TOGGLE DEBUG: Set isTogglingBranch = true');
  
  // Handle different states of enabledBranches
  let enabledBranches;
  if (masterItem.enabledBranches === undefined) {
    // Legacy items without enabledBranches field - start with all branches
    enabledBranches = [...availableBranches];
    console.log('🔍 TOGGLE DEBUG: Legacy item (no enabledBranches field), starting with all branches =', enabledBranches);
  } else if (masterItem.enabledBranches.length === 0) {
    // Items with empty array [] - start with all branches (they were disabled for all)
    enabledBranches = [...availableBranches];
    console.log('🔍 TOGGLE DEBUG: Empty enabledBranches array, starting with all branches =', enabledBranches);
  } else {
    // Items with explicit array - use as is
    enabledBranches = [...masterItem.enabledBranches];
    console.log('🔍 TOGGLE DEBUG: Initial enabledBranches copy =', enabledBranches);
  }
  
  if (enabled) {
    if (!enabledBranches.includes(branch)) {
      enabledBranches.push(branch);
      console.log('🔍 TOGGLE DEBUG: Added branch to enabledBranches =', enabledBranches);
    } else {
      console.log('🔍 TOGGLE DEBUG: Branch already in enabledBranches');
    }
  } else {
    const index = enabledBranches.indexOf(branch);
    console.log('🔍 TOGGLE DEBUG: Index of branch to remove =', index);
    if (index > -1) {
      enabledBranches.splice(index, 1);
      console.log('🔍 TOGGLE DEBUG: Removed branch, new enabledBranches =', enabledBranches);
    } else {
      console.log('🔍 TOGGLE DEBUG: Branch not found in enabledBranches to remove');
    }
  }
  
  // Update local state immediately to prevent checkbox flickering
  const oldEnabledBranches = masterItem.enabledBranches;
  masterItem.enabledBranches = enabledBranches;
  console.log('🔍 TOGGLE DEBUG: Updated local state from', oldEnabledBranches, 'to', masterItem.enabledBranches);
  
  // Re-render immediately with the new state
  console.log('🔍 TOGGLE DEBUG: About to call renderBranchList()');
  renderBranchList();
  console.log('🔍 TOGGLE DEBUG: renderBranchList() completed');
  
  try {
    console.log('🔍 TOGGLE DEBUG: About to update Firebase with enabledBranches =', enabledBranches);
    // Update Firebase in background
    await updateDoc(doc(db, 'inventory', '_config', 'items', masterId), { enabledBranches });
    console.log('🔍 TOGGLE DEBUG: Firebase update successful');
    
    // Clear cache to ensure future loads get fresh data
    localStorage.removeItem('inventory-config-items-cache');
    console.log('🔍 TOGGLE DEBUG: Cache cleared');
  } catch (error) {
    console.error('🔍 TOGGLE DEBUG: Firebase update failed:', error);
    // Revert local state if Firebase update failed
    masterItem.enabledBranches = [...(masterItem.enabledBranches || availableBranches)];
    renderBranchList();
    console.log('🔍 TOGGLE DEBUG: Reverted local state due to Firebase error');
  } finally {
    // Clear the flag to allow background sync again
    isTogglingBranch = false;
    console.log('🔍 TOGGLE DEBUG: Set isTogglingBranch = false');
    console.log('🔍 TOGGLE DEBUG: onToggleBranchEnabled completed');
  }
}

async function onBranchRestockChange(masterId, branch, valueStr) {
  const value = Math.max(0, parseInt(valueStr, 10) || 0);
  const masterItem = masterItems.find(m => m.id === masterId);
  if (!masterItem) return;
  
  const branchOverrides = { ...(masterItem.branchOverrides || {}) };
  
  if (value === masterItem.defaultRestockLevel) {
    // If value matches default, remove the override
    delete branchOverrides[branch];
  } else {
    // Set the branch-specific override
    branchOverrides[branch] = { ...branchOverrides[branch], restockLevel: value };
  }
  
  // Update local state immediately to prevent input flickering
  masterItem.branchOverrides = branchOverrides;
  
  // Re-render immediately with the new state
  renderBranchList();
  
  try {
    // Update Firebase in background
    await updateDoc(doc(db, 'inventory', '_config', 'items', masterId), { branchOverrides });
    
    // Clear cache to ensure future loads get fresh data
    localStorage.removeItem('inventory-config-items-cache');
    
    // Don't reload from Firebase as it would cause re-rendering and revert the input state
    // The local state is already updated and displayed correctly
  } catch (error) {
    console.error('Error updating branch restock level:', error);
    // Revert local state if Firebase update failed
    masterItem.branchOverrides = { ...(masterItem.branchOverrides || {}) };
    renderBranchList();
  }
}

async function onDisplayOrderChange(masterId, valueStr) {
  const value = Math.max(0, parseInt(valueStr, 10) || 0);
  await updateDoc(doc(db, 'inventory', '_config', 'items', masterId), { displayOrder: value });
  await loadMasterItems();
  renderMasterItems();
}

// Setup master category collapse functionality
function setupMasterCategoryCollapse() {
  // Make entire category headers clickable
  const categoryHeaders = document.querySelectorAll('#masterTable .category-header');
  
  categoryHeaders.forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't trigger if clicking on edit controls
      if (e.target.closest('.category-edit-controls')) {
        return;
      }
      
      const category = header.dataset.category;
      toggleCategoryCollapse(category);
    });
  });
  
  // Also keep the collapse button clickable for visual feedback
  const buttons = document.querySelectorAll('#masterTable .category-collapse-btn');
  
  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const category = btn.dataset.category;
      toggleCategoryCollapse(category);
    });
  });
}

// Setup branch category collapse functionality
function setupBranchCategoryCollapse() {
  // Make entire category headers clickable
  const categoryHeaders = document.querySelectorAll('#branchTable .category-header');
  
  categoryHeaders.forEach(header => {
    header.addEventListener('click', (e) => {
      const category = header.dataset.category;
      toggleBranchCategoryCollapse(category);
    });
  });
  
  // Also keep the collapse button clickable for visual feedback
  const buttons = document.querySelectorAll('#branchTable .category-collapse-btn');
  
  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const category = btn.dataset.category;
      toggleBranchCategoryCollapse(category);
    });
  });
}

// Toggle branch category collapse
function toggleBranchCategoryCollapse(category) {
  const isCollapsed = branchCollapsedCategories.includes(category);
  
  if (isCollapsed) {
    // Expand
    branchCollapsedCategories = branchCollapsedCategories.filter(c => c !== category);
  } else {
    // Collapse
    branchCollapsedCategories.push(category);
  }
  
  // Save to localStorage
  localStorage.setItem('branch-collapsed-categories', JSON.stringify(branchCollapsedCategories));
  
  // Re-render branch list
  renderBranchList();
}

// expose handlers
window.onMasterRestockChange = onMasterRestockChange;
window.onDisplayOrderChange = onDisplayOrderChange;

function openMasterItemModal(itemId = null) {
  editingMasterItemId = itemId;
  const modal = document.getElementById('masterItemModalOverlay');
  const title = document.getElementById('masterItemModalTitle');
  const form = document.getElementById('masterItemForm');
  
  // Update category dropdown with current categories
  const categorySelect = document.getElementById('masterItemCategory');
  const categories = getUniqueCategories();
  categorySelect.innerHTML = categories.map(cat => `<option value="${cat}">${cat}</option>`).join('') + '<option value="Other">Other</option>';
  
  if (itemId) {
    const item = masterItems.find(i => i.id === itemId);
    if (item) {
      title.textContent = 'Edit Master Item';
      document.getElementById('masterItemName').value = item.name;
      document.getElementById('masterItemDescription').value = item.description || item.subtitle || '';
      document.getElementById('masterItemCategory').value = item.category || 'Other';
      document.getElementById('masterItemUnit').value = item.unit;
      document.getElementById('masterItemRestock').value = item.restockAmount;
      if (item.photo) {
        document.getElementById('masterPreviewImage').src = item.photo;
        document.getElementById('masterPhotoPreview').style.display = 'block';
      } else {
        document.getElementById('masterPreviewImage').src = '';
        document.getElementById('masterPhotoPreview').style.display = 'none';
      }
    }
  } else {
    title.textContent = 'Add Master Item';
    form.reset();
    document.getElementById('masterPreviewImage').src = '';
    document.getElementById('masterPhotoPreview').style.display = 'none';
  }
  modal.style.display = 'flex';
}

function openCategoryEditModal(category) {
  // Create modal HTML
  const modalHTML = `
    <div class="modal-overlay show" id="categoryEditModal">
      <div class="modal">
        <div class="modal-header">
          <h3>Edit Category</h3>
          <button class="modal-close" onclick="closeCategoryEditModal()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="categoryNameInput">Category Name</label>
            <input type="text" id="categoryNameInput" value="${category}" placeholder="Enter category name">
          </div>
          <div class="form-buttons">
            <button class="btn-cancel" onclick="closeCategoryEditModal()">Cancel</button>
            <button class="btn-add" onclick="saveCategoryEdit()">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Add modal to body
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  // Focus input and select text
  const input = document.getElementById('categoryNameInput');
  input.focus();
  input.select();
  
  // Store current category name for reference
  window.currentEditingCategory = category;
  
  // Add enter key handler
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveCategoryEdit();
    }
  });
}

function closeCategoryEditModal() {
  const modal = document.getElementById('categoryEditModal');
  if (modal) {
    modal.remove();
  }
  window.currentEditingCategory = null;
}

function saveCategoryEdit() {
  const input = document.getElementById('categoryNameInput');
  const newName = input.value.trim();
  const oldName = window.currentEditingCategory;
  
  if (newName && newName !== oldName) {
    updateCategoryName(oldName, newName);
  }
  
  closeCategoryEditModal();
}

function closeMasterItemModal() {
  console.log('=== CLOSE MODAL CALLED ===');
  document.getElementById('masterItemModalOverlay').style.display = 'none';
  editingMasterItemId = null;
  
  // Reset photo preview
  document.getElementById('masterPreviewImage').src = '';
  document.getElementById('masterPhotoPreview').style.display = 'none';
  document.getElementById('masterItemPhoto').value = '';
  
  console.log('Modal closed, editingMasterItemId set to null');
}

async function handleMasterItemSubmit(e) {
  console.log('=== SAVE BUTTON CLICKED ===');
  console.log('Event type:', e.type);
  
  console.log('editingMasterItemId:', editingMasterItemId);
  console.log('masterItems count before save:', masterItems.length);
  
  const previewImage = document.getElementById('masterPreviewImage');
  const photoPreview = document.getElementById('masterPhotoPreview');
  
  const formData = {
    name: document.getElementById('masterItemName').value,
    description: document.getElementById('masterItemDescription').value,
    category: document.getElementById('masterItemCategory').value,
    unit: document.getElementById('masterItemUnit').value,
    restockAmount: parseInt(document.getElementById('masterItemRestock').value) || 0,
    enabledBranches: availableBranches, // Default to all branches enabled
    branchOverrides: {}, // Start with empty overrides
    photo: photoPreview.style.display === 'none' ? null : (previewImage.src || null)
  };
  
  console.log('Form data:', formData);
  
  // Show loading indicator
  const loadingIndicator = document.createElement('div');
  loadingIndicator.id = 'savingIndicator';
  loadingIndicator.innerHTML = `
    <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                background: white; padding: 20px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); 
                z-index: 10000; display: flex; align-items: center; gap: 10px;">
      <div style="width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #2b9348; 
                  border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <span>Saving item...</span>
    </div>
    <style>
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
  `;
  document.body.appendChild(loadingIndicator);
  
  try {
    console.log('=== FIREBASE OPERATION ===');
    if (editingMasterItemId) {
      console.log('UPDATING existing item:', editingMasterItemId);
      await updateDoc(doc(db, 'inventory', '_config', 'items', editingMasterItemId), formData);
      console.log('Update completed');
    } else {
      console.log('CREATING new item');
      await addDoc(collection(db, 'inventory', '_config', 'items'), formData);
      console.log('Create completed');
    }
    
    console.log('=== CLOSING MODAL ===');
    console.log('Item saved successfully');
    console.log('masterItems count after save:', masterItems.length);
    
    // Reload data and re-render UI after successful save (skip categoryOrder init for faster response)
    await loadMasterItems(true);
    console.log('masterItems count after loadMasterItems:', masterItems.length);
    
    // Clear dashboard cache to ensure it reflects the changes
    clearInventoryItemsCache();
    
    renderMasterItems();
    console.log('renderMasterItems completed');
    renderBranchList();
    console.log('renderBranchList completed');
    
    // Close modal after successful save
    closeMasterItemModal();
  } catch (error) {
    console.error('Error saving master item:', error);
    alert('Error saving item. Please try again.');
  } finally {
    // Remove loading indicator
    const indicator = document.getElementById('savingIndicator');
    if (indicator) {
      indicator.remove();
    }
  }
}

async function duplicateMasterItem(itemId) {
  const originalItem = masterItems.find(item => item.id === itemId);
  if (!originalItem) return;
  
  // Create a copy with "Copy" appended to the name
  const duplicatedItem = {
    ...originalItem,
    name: `${originalItem.name} (Copy)`,
    displayOrder: (originalItem.displayOrder || 0) + 1
  };
  
  // Remove the id so it creates a new document
  delete duplicatedItem.id;
  
  try {
    // Add the duplicated item
    const docRef = await addDoc(collection(db, 'inventory', '_config', 'items'), duplicatedItem);
    console.log('Item duplicated successfully:', docRef.id);
    
    // Reload data and re-render
    await loadMasterItems();
    renderMasterItems();
    renderBranchList();
  } catch (error) {
    console.error('Error duplicating item:', error);
    alert('Error duplicating item. Please try again.');
  }
}

async function deleteMasterItem(itemId) {
  if (!confirm('Delete this item? It will be removed from all branches.')) return;
  await deleteDoc(doc(db, 'inventory', '_config', 'items', itemId));
  // No longer need to manage separate collections - everything is in master-items now
  await loadMasterItems();
  
  // Clear dashboard cache to ensure it reflects the changes
  clearInventoryItemsCache();
  
  renderMasterItems();
  renderBranchList();
}

async function moveMasterItem(itemId, direction) {
  console.log('🔄 MOVE ITEM: Starting moveMasterItem:', itemId, direction);
  
  // Set flag to prevent background sync override
  isMovingItems = true;
  console.log('🔄 MOVE ITEM: Set isMovingItems = true');
  
  const item = masterItems.find(i => i.id === itemId);
  console.log('Found item:', item);
  if (!item) {
    console.error('Item not found:', itemId);
    isMovingItems = false; // Clear flag on error
    return;
  }
  
  const category = item.category || 'Other';
  const categoryItems = masterItems
    .filter(i => (i.category || 'Other') === category)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  
  console.log('Category items:', categoryItems.map(i => ({ id: i.id, name: i.name, displayOrder: i.displayOrder })));
  
  const currentIndex = categoryItems.findIndex(i => i.id === itemId);
  console.log('Current index:', currentIndex);
  if (currentIndex === -1) {
    console.error('Item not found in category items');
    return;
  }
  
  let newIndex;
  if (direction === 'up') {
    newIndex = currentIndex - 1;
    if (newIndex < 0) {
      console.log('Already at top');
      isMovingItems = false; // Clear flag before early return
      return; // Already at top
    }
  } else if (direction === 'down') {
    newIndex = currentIndex + 1;
    if (newIndex >= categoryItems.length) {
      console.log('Already at bottom');
      isMovingItems = false; // Clear flag before early return
      return; // Already at bottom
    }
  } else {
    isMovingItems = false; // Clear flag before early return
    return;
  }
  
  console.log('Moving from index', currentIndex, 'to index', newIndex);
  
  // INSTANT UI UPDATE: Update local data immediately
  const temp = categoryItems[currentIndex];
  categoryItems[currentIndex] = categoryItems[newIndex];
  categoryItems[newIndex] = temp;
  
  // Update displayOrder in local masterItems array immediately
  for (let i = 0; i < categoryItems.length; i++) {
    const item = categoryItems[i];
    const masterItemIndex = masterItems.findIndex(mi => mi.id === item.id);
    if (masterItemIndex !== -1) {
      masterItems[masterItemIndex].displayOrder = i;
    }
  }
  
  // Update cache immediately
  cacheMasterItems(masterItems);
  
  // INSTANT UI RENDER: Update the display immediately
  renderMasterItems();
  renderBranchList();
  
  // BACKGROUND SYNC: Update Firebase in the background
  console.log('🔄 MOVE ITEM: Starting background sync to Firebase');
  syncMoveToFirebase(categoryItems, 'item');
}

// Background sync function for Firebase updates
async function syncMoveToFirebase(items, type) {
  try {
    console.log(`🔄 SYNC: Updating ${type} order in Firebase...`);
    
    const updates = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Always update displayOrder to match the current array position
      console.log(`🔄 SYNC: Updating ${item.name} displayOrder from ${item.displayOrder} to ${i}`);
      updates.push(updateDoc(doc(db, 'inventory', '_config', 'items', item.id), { displayOrder: i }));
    }
    
    console.log(`🔄 SYNC: Saving ${updates.length} updates to Firebase...`);
    await Promise.all(updates);
    console.log(`🔄 SYNC: ${type} order updated successfully in Firebase`);
    
    // No longer need to sync to separate collections - everything is in master-items now
    console.log('🔄 SYNC: Master items updated successfully');
    
    // Clear dashboard cache to ensure fresh data
    clearInventoryItemsCache();
    console.log('🔄 SYNC: Dashboard cache cleared');
  } catch (error) {
    console.error('🔄 SYNC: Background sync error:', error);
    // Could show a subtle notification here if needed
  } finally {
    // Clear the flag to allow background sync again
    isMovingItems = false;
    // Force dashboard refresh on next load
    forceDashboardRefresh = true;
    console.log('🔄 SYNC: Move operation completed, flag cleared, dashboard refresh forced');
  }
}

async function moveCategory(categoryName, direction) {
  console.log('🔄 MOVE CATEGORY: Starting moveCategory:', categoryName, direction);
  
  // Set flag to prevent background sync override
  isMovingItems = true;
  console.log('🔄 MOVE CATEGORY: Set isMovingItems = true');
  
  const categories = getUniqueCategories();
  const currentIndex = categories.indexOf(categoryName);
  if (currentIndex === -1) {
    console.error('Category not found:', categoryName);
    isMovingItems = false; // Clear flag on error
    return;
  }
  
  let newIndex;
  if (direction === 'up') {
    newIndex = currentIndex - 1;
    if (newIndex < 0) {
      isMovingItems = false; // Clear flag
      return; // Already at top
    }
  } else if (direction === 'down') {
    newIndex = currentIndex + 1;
    if (newIndex >= categories.length) {
      isMovingItems = false; // Clear flag
      return; // Already at bottom
    }
  } else {
    isMovingItems = false; // Clear flag
    return;
  }
  
  // INSTANT UI UPDATE: Swap the categories immediately
  const temp = categories[currentIndex];
  categories[currentIndex] = categories[newIndex];
  categories[newIndex] = temp;
  
  // Update categoryOrder in local masterItems array immediately
  for (let i = 0; i < categories.length; i++) {
    const categoryName = categories[i];
    const categoryItems = masterItems.filter(item => item.category === categoryName);
    for (const item of categoryItems) {
      const masterItemIndex = masterItems.findIndex(mi => mi.id === item.id);
      if (masterItemIndex !== -1) {
        masterItems[masterItemIndex].categoryOrder = i;
      }
    }
  }
  
  // Update cache immediately
  cacheMasterItems(masterItems);
  
  // INSTANT UI RENDER: Update the display immediately
  renderMasterItems();
  renderBranchList();
  
  // BACKGROUND SYNC: Update Firebase in the background
  console.log('🔄 MOVE CATEGORY: Starting background sync to Firebase');
  syncCategoryMoveToFirebase(categories);
}

// Background sync function for category moves
async function syncCategoryMoveToFirebase(categories) {
  try {
    console.log('🔄 SYNC: Updating category order in Firebase...');
    
    const updates = [];
    for (let i = 0; i < categories.length; i++) {
      const categoryName = categories[i];
      const categoryItems = masterItems.filter(item => item.category === categoryName);
      
      for (const item of categoryItems) {
        // Always update categoryOrder to match the current category position
        console.log(`🔄 SYNC: Updating ${item.name} categoryOrder from ${item.categoryOrder} to ${i}`);
        updates.push(updateDoc(doc(db, 'inventory', '_config', 'items', item.id), { categoryOrder: i }));
      }
    }
    
    console.log(`🔄 SYNC: Saving ${updates.length} category updates to Firebase...`);
    await Promise.all(updates);
    console.log('🔄 SYNC: Category order updated successfully in Firebase');
    
    // No longer need to sync to separate collections - everything is in master-items now
    console.log('🔄 SYNC: Master items updated successfully');
    
    // Clear dashboard cache to ensure fresh data
    clearInventoryItemsCache();
    console.log('🔄 SYNC: Dashboard cache cleared');
  } catch (error) {
    console.error('🔄 SYNC: Background sync error:', error);
    // Could show a subtle notification here if needed
  } finally {
    // Clear the flag to allow background sync again
    isMovingItems = false;
    // Force dashboard refresh on next load
    forceDashboardRefresh = true;
    console.log('🔄 SYNC: Category move operation completed, flag cleared, dashboard refresh forced');
  }
}

// Removed toggleBranchAssignment - using new enabledBranches structure

// Removed syncInventoryItemForToggle - no longer needed with new structure

// Removed bulkAssign - using new branch management system

// Removed syncBranchInventory, upsertInventoryItem, and deleteInventoryItemByMasterId functions
// These are no longer needed with the simplified single-collection approach

// Import Master JSON
async function handleMasterImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const raw = JSON.parse(text);
    const data = Array.isArray(raw) ? raw.map((it, index) => ({
      name: it.name,
      description: it.description ?? it.subtitle ?? '',
      category: it.category || 'Other',
      unit: it.unit,
      restockAmount: it.restockAmount ?? 0,
      photo: it.photo || null,
      displayOrder: it.displayOrder ?? it.order ?? index
    })) : [];
    // Replace all
    const existing = await getDocs(collection(db, 'inventory', '_config', 'items'));
    for (const d of existing.docs) await deleteDoc(d.ref);
    for (const it of data) await addDoc(collection(db, 'inventory', '_config', 'items'), it);
    
    await loadMasterItems();
    renderMasterItems();
    renderBranchList();
  } catch (e) {
    console.error(e);
  }
  event.target.value = '';
}

async function normalizeCategoryOrder(category) {
  const catItems = masterItems
    .filter(i => (i.category || 'Other') === category)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || (a.name || '').localeCompare(b.name || ''));
  let needs = false;
  for (let i = 0; i < catItems.length; i++) {
    if ((catItems[i].displayOrder ?? -1) !== i) { needs = true; break; }
  }
  if (!needs) return;
  for (let i = 0; i < catItems.length; i++) {
    await updateDoc(doc(db, 'inventory', '_config', 'items', catItems[i].id), { displayOrder: i });
  }
  await loadMasterItems();
}



// Utilities
function getBranchDisplayName(branch) {
  if (!branch) return '';
  const map = { 'sm-north': 'SM North', 'podium': 'Podium', 'moa': 'MOA' };
  return map[branch] || branch.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Get unique categories from master items with their order
function getUniqueCategories() {
  const categoryMap = new Map();
  masterItems.forEach(item => {
    if (item.category) {
      if (!categoryMap.has(item.category)) {
        categoryMap.set(item.category, {
          name: item.category,
          order: item.categoryOrder || 0,
          itemCount: 0
        });
      }
      categoryMap.get(item.category).itemCount++;
    }
  });
  
  // Sort by category order, then by name
  return Array.from(categoryMap.values())
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name))
    .map(cat => cat.name);
}

// Get category order for a specific category
function getCategoryOrder(categoryName) {
  const categoryItem = masterItems.find(item => item.category === categoryName);
  return categoryItem?.categoryOrder || 0;
}

// Check if category is empty (no items)
function isCategoryEmpty(category) {
  return !masterItems.some(item => item.category === category);
}

// Update category for all items in a category
async function updateCategoryName(oldName, newName) {
  const itemsToUpdate = masterItems.filter(item => item.category === oldName);
  for (const item of itemsToUpdate) {
    await updateDoc(doc(db, 'inventory', '_config', 'items', item.id), { category: newName });
  }
  await loadMasterItems();
  renderMasterItems();
}

// Delete empty category (just for UI, since categories are just strings)
async function deleteEmptyCategory(category) {
  // Categories are just strings, so we don't need to delete anything from DB
  // Just re-render to update the UI
  renderMasterItems();
}

async function convertImageToBase64(file) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      // Calculate new dimensions (max 400x400, maintain aspect ratio)
      const maxSize = 400;
      let { width, height } = img;
      
      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // Draw and compress
      ctx.drawImage(img, 0, 0, width, height);
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8); // 80% quality
      resolve(compressedDataUrl);
    };
    
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function handleMasterPhotoSelect(event) {
  const file = event.target.files[0];
  if (file) {
    convertImageToBase64(file).then(base64 => {
      document.getElementById('masterPreviewImage').src = base64;
      document.getElementById('masterPhotoPreview').style.display = 'block';
    });
  }
}

function handleMasterPhotoRemove() {
  document.getElementById('masterItemPhoto').value = '';
  document.getElementById('masterPhotoPreview').style.display = 'none';
  document.getElementById('masterPreviewImage').src = '';
}


// Debug function to check master items state
window.debugMasterItems = function() {
  console.log('🔍 MASTER ITEMS DEBUG:');
  console.log('- isMovingItems:', isMovingItems);
  console.log('- masterItems count:', masterItems.length);
  console.log('- Current items order:', masterItems.map(item => ({ 
    name: item.name, 
    displayOrder: item.displayOrder, 
    categoryOrder: item.categoryOrder 
  })));
  
  // Check cache
  const cached = localStorage.getItem('inventory-config-items-cache');
  if (cached) {
    const cacheData = JSON.parse(cached);
    console.log('- Cached items order:', cacheData.items.map(item => ({ 
      name: item.name, 
      displayOrder: item.displayOrder, 
      categoryOrder: item.categoryOrder 
    })));
  } else {
    console.log('- No cache found');
  }
};

// Global for inline handlers
window.editMasterItem = (id) => openMasterItemModal(id);
window.deleteMasterItem = (id) => deleteMasterItem(id);
window.moveMasterItem = (id, direction) => moveMasterItem(id, direction);
window.moveCategory = (category, direction) => moveCategory(category, direction);
window.switchToTask = (task) => switchToTask(task);
window.onToggleBranchEnabled = (id, branch, checked) => onToggleBranchEnabled(id, branch, checked);
window.onBranchRestockChange = (id, branch, value) => onBranchRestockChange(id, branch, value);
window.closeCategoryEditModal = closeCategoryEditModal;
window.saveCategoryEdit = saveCategoryEdit;
window.toggleCategoryCollapse = (category) => {
  const collapsedCategories = JSON.parse(localStorage.getItem('collapsedCategories') || '[]');
  const isCollapsed = collapsedCategories.includes(category);
  
  if (isCollapsed) {
    // Expand
    const newCollapsed = collapsedCategories.filter(c => c !== category);
    localStorage.setItem('collapsedCategories', JSON.stringify(newCollapsed));
  } else {
    // Collapse
    collapsedCategories.push(category);
    localStorage.setItem('collapsedCategories', JSON.stringify(collapsedCategories));
  }
  
  // Re-render to show changes
  renderMasterItems();
};
window.editCategory = (category) => {
  // Make this immediate and non-blocking
  setTimeout(() => openCategoryEditModal(category), 0);
};
window.deleteCategory = (category) => deleteEmptyCategory(category);
window.duplicateMasterItem = (itemId) => duplicateMasterItem(itemId);
window.startCategoryDrag = (event, category) => {
  console.log('Category drag started:', category);
  if (!masterEditMode) return;
  
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/html', event.target.outerHTML);
  
  draggedCategory = category;
  draggedElement = event.target.closest('tr');
  if (draggedElement) {
    draggedElement.classList.add('dragging');
  }
  console.log('Category drag state set:', { draggedCategory, draggedElement: !!draggedElement });
};
window.finishEditingAndSwitch = finishEditingAndSwitch;
window.cancelEditingAndSwitch = cancelEditingAndSwitch;
window.closeEditWarning = closeEditWarning;

// Debug function for dashboard loading
window.testDashboardLoading = function() {
  console.log('🧪 Testing dashboard loading...');
  console.log('Dashboard branch:', dashboardBranch);
  console.log('Dashboard date:', dashboardDate.toDateString());
  console.log('Current dashboard items count:', dashboardItems.length);
  
  // Test unified cache system
  const cacheKey = `inventory-items-${dashboardBranch}`;
  const cachedData = localStorage.getItem(cacheKey);
  console.log('Unified cache test:', cachedData ? 'Data exists' : 'No data');
  
  if (cachedData) {
    try {
      const parsed = JSON.parse(cachedData);
      if (Array.isArray(parsed)) {
        console.log('Cache format: Main inventory (direct array)');
        console.log('Cache items count:', parsed.length);
      } else if (parsed.items) {
        console.log('Cache format: Dashboard (wrapped object)');
        console.log('Cache items count:', parsed.items.length);
      }
    } catch (e) {
      console.log('Cache format: Invalid JSON');
    }
  }
  
  // Test quantities cache
  const quantitiesCache = loadQuantitiesFromCache();
  console.log('Quantities cache test:', quantitiesCache ? 'Data exists' : 'No data');
  
  return {
    branch: dashboardBranch,
    date: dashboardDate.toDateString(),
    itemsCount: dashboardItems.length,
    hasUnifiedCache: !!cachedData,
    hasQuantitiesCache: !!quantitiesCache
  };
};

// Debug function for bold styling
window.testBoldStyling = function() {
  console.log('🧪 Testing bold styling logic...');
  console.log('Raw quantities:', window.dashboardRawQuantities);
  console.log('Opening quantities:', openingQuantities);
  console.log('Closing quantities:', closingQuantities);
  
  // Test with first item if available
  if (dashboardItems.length > 0) {
    const item = dashboardItems[0];
    const rawQuantities = window.dashboardRawQuantities || {};
    const itemRawData = rawQuantities[item.id];
    
    console.log(`Testing item: ${item.name}`);
    console.log('Item raw data:', itemRawData);
    
    if (itemRawData) {
      const hasClosingData = itemRawData.closing && (itemRawData.closing.checked || itemRawData.closing.value > 0);
      const hasOpeningData = itemRawData.opening && (itemRawData.opening.checked || itemRawData.opening.value > 0);
      
      console.log(`hasClosingData: ${hasClosingData}, hasOpeningData: ${hasOpeningData}`);
      console.log(`Should bold closing: ${hasClosingData}, Should bold opening: ${!hasClosingData}`);
    } else {
      console.log('No raw data found for this item');
    }
  }
  
  return {
    rawQuantities: window.dashboardRawQuantities,
    openingQuantities,
    closingQuantities,
    itemsCount: dashboardItems.length
  };
};

// Debug function to test cache invalidation
window.testCacheInvalidation = function() {
  console.log('🧪 Testing cache invalidation...');
  invalidateInventoryCache();
  console.log('✅ Cache invalidation completed');
  
  // Test if cache is cleared
  const branches = ['sm-north', 'podium', 'moa'];
  branches.forEach(branch => {
    const cacheKey = `inventory-items-${branch}`;
    const cached = localStorage.getItem(cacheKey);
    console.log(`Branch ${branch} cache:`, cached ? 'Still exists' : 'Cleared');
  });
};
window.openPhotoUpload = (itemId) => {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.onchange = async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        const base64 = await convertImageToBase64(file);
        await updateDoc(doc(db, 'inventory', '_config', 'items', itemId), { photo: base64 });
        await loadMasterItems();
        renderMasterItems();
        renderBranchList();
      } catch (error) {
        console.error('Error uploading photo:', error);
        alert('Error uploading photo. Please try again.');
      }
    }
  };
  fileInput.click();
};

// Dashboard functions
async function loadDashboardData() {
  const startTime = performance.now();
  console.log('=== LOAD DASHBOARD DATA START ===');
  console.log('Loading dashboard data for branch:', dashboardBranch, 'date:', dashboardDate.toDateString());
  
  const container = document.getElementById('inventoryTable');
  if (!container) {
    console.error('inventoryTable container not found!');
    return;
  }
  
  // Loading flag already set in switchToTask
  
  // Clear old cache and always load from Firebase for now (until we migrate fully)
  const cacheStartTime = performance.now();
  // Clear all inventory-related cache to fix quota exceeded error
  Object.keys(localStorage).forEach(key => {
    if (key.includes('inventory') || key.includes('master-items')) {
      localStorage.removeItem(key);
    }
  });
  const cachedItems = null; // Always load from Firebase
  const cacheLoadTime = performance.now() - cacheStartTime;
  console.log(`Cache lookup took: ${cacheLoadTime.toFixed(2)}ms`);
  
  if (false) { // Disable cache loading for now
    console.log('✅ Loading cached inventory items instantly');
    console.log('Cached items count:', cachedItems.length);
    
    const itemsLoadStart = performance.now();
    dashboardItems = cachedItems;
    
    // Sort cached items using the same logic as Firebase data
    dashboardItems.sort((a, b) => {
      const categoryOrderA = a.categoryOrder || 0;
      const categoryOrderB = b.categoryOrder || 0;
      
      if (categoryOrderA !== categoryOrderB) {
        return categoryOrderA - categoryOrderB;
      }
      
      // Use displayOrder if available, otherwise fall back to order
      const orderA = a.displayOrder || a.order || 0;
      const orderB = b.displayOrder || b.order || 0;
      return orderA - orderB;
    });
    
    const itemsLoadTime = performance.now() - itemsLoadStart;
    console.log(`Items assignment and sorting took: ${itemsLoadTime.toFixed(2)}ms`);
    
    // Try to load quantities from cache for this date
    const quantitiesCacheStart = performance.now();
    const cachedQuantities = loadQuantitiesFromCache();
    const quantitiesCacheTime = performance.now() - quantitiesCacheStart;
    console.log(`Quantities cache lookup took: ${quantitiesCacheTime.toFixed(2)}ms`);
    
    if (cachedQuantities) {
      openingQuantities = cachedQuantities.openingQuantities || {};
      closingQuantities = cachedQuantities.closingQuantities || {};
      addedQuantities = cachedQuantities.addedQuantities || {};
      console.log('✅ Loading cached quantities for date:', getDateKey(dashboardDate));
    } else {
      // No cached quantities for this date, load from Firebase
      openingQuantities = {};
      closingQuantities = {};
      addedQuantities = {};
      console.log('⚠️ No cached quantities for this date, will load from Firebase');
    }
    
    const renderStart = performance.now();
    renderDashboard();
    const renderTime = performance.now() - renderStart;
    console.log(`Dashboard render took: ${renderTime.toFixed(2)}ms`);
    
    updateDashboardDateDisplay();
    dashboardLoading = false;
    
    const totalTime = performance.now() - startTime;
    console.log(`🎉 TOTAL CACHED LOAD TIME: ${totalTime.toFixed(2)}ms`);
    
    // Show cached data indicator
    showSyncIndicator('Showing cached inventory items', 'info');
    
    // Sync quantities from Firebase in background (non-blocking)
    syncQuantitiesFromFirebaseInBackground();
    
    // Also check if inventory items have changed (less frequent)
    checkInventoryItemsForUpdates();
    return; // Exit early - don't wait for Firebase
  }
  
  // Only load from Firebase if no cached data exists
  try {
    console.log('About to query master-items collection for branch:', dashboardBranch);
    // Load master items and filter by enabled branches
    const querySnapshot = await getDocs(collection(db, 'inventory', '_config', 'items'));
    console.log('Query completed, found', querySnapshot.docs.length, 'documents');
    
    dashboardItems = querySnapshot.docs
      .map(d => {
        const data = d.data();
        return { 
          id: d.id, 
          ...data,
          displayOrder: data.displayOrder ?? 0,
          categoryOrder: data.categoryOrder ?? 0,
          enabledBranches: data.enabledBranches,
          branchOverrides: data.branchOverrides
        };
      })
      .filter(item => {
        // If item doesn't have enabledBranches field (legacy), assume it's enabled for all branches
        if (item.enabledBranches === undefined) return true;
        // If enabledBranches is empty array [], it means disabled for all branches
        if (item.enabledBranches.length === 0) return false;
        // Check if current branch is in the enabledBranches array
        return item.enabledBranches.includes(dashboardBranch);
      });
    
    console.log('Found', dashboardItems.length, 'inventory items for branch:', dashboardBranch);
    
    // If no inventory items found, show empty state
    if (dashboardItems.length === 0) {
      console.log('No inventory items found, showing empty state');
      showDashboardErrorState(`No inventory items found for ${getBranchDisplayName(dashboardBranch)}. Please add items in the Master Items tab first.`);
      return;
    }
    
    // Sort by category order (from categories collection), then display order
    // For now, use a simple category order mapping until we load categories
    const categoryOrderMap = {
      'Base Ingredients': 0,
      'Packaging & Consumables': 1,
      'Liquid Ingredients': 2,
      'Dry Ingredients': 3,
      'Desserts': 4
    };
    
    dashboardItems.sort((a, b) => {
      const categoryOrderA = categoryOrderMap[a.category] || 999;
      const categoryOrderB = categoryOrderMap[b.category] || 999;
      
      if (categoryOrderA !== categoryOrderB) {
        return categoryOrderA - categoryOrderB;
      }
      
      // Use displayOrder if available, otherwise fall back to order
      const orderA = a.displayOrder || a.order || 0;
      const orderB = b.displayOrder || b.order || 0;
      return orderA - orderB;
    });
    
    
    // Load quantities for both opening and closing
    const dateKey = getDateKey(dashboardDate);
    
    // Get daily document from branch subcollection
    const docRef = doc(db, 'inventory-quantities', dashboardBranch, 'daily-quantities', dateKey);
    const docSnap = await getDoc(docRef);
    
    // Initialize quantities objects
    openingQuantities = {};
    closingQuantities = {};
    addedQuantities = {};
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      const quantities = data.quantities || {};
      
      console.log('Found quantities for', Object.keys(quantities).length, 'items on date:', dateKey);
      
      // Store the raw quantities data for bold styling logic
      window.dashboardRawQuantities = quantities;
      
      // Process quantities from single document
      Object.keys(quantities).forEach(itemId => {
        const itemQuantities = quantities[itemId];
        
        if (itemQuantities.opening && itemQuantities.opening.checked) {
          openingQuantities[itemId] = itemQuantities.opening.value;
        }
        if (itemQuantities.closing && itemQuantities.closing.checked) {
          closingQuantities[itemId] = itemQuantities.closing.value;
        }
        if (itemQuantities.added && itemQuantities.added.checked) {
          addedQuantities[itemId] = itemQuantities.added.value;
        }
        
        // Calculate breakdown from adjustments array
        let delivery = 0;
        let pullOut = 0;
        let wastage = 0;
        
        if (itemQuantities.adjustments && Array.isArray(itemQuantities.adjustments)) {
          itemQuantities.adjustments.forEach(adj => {
            const value = Math.abs(adj.value || 0);
            if (adj.reason === 'delivery') {
              delivery += value;
            } else if (adj.reason === 'pulled-out') {
              pullOut += value;
            } else if (adj.reason === 'wastage') {
              wastage += value;
            }
          });
        }
        
        deliveryQuantities[itemId] = delivery;
        pullOutQuantities[itemId] = pullOut;
        wastageQuantities[itemId] = wastage;
      });
    } else {
      console.log('No quantities found for date:', dateKey);
      window.dashboardRawQuantities = {};
    }
    
    console.log('Opening quantities:', openingQuantities);
    console.log('Closing quantities:', closingQuantities);
    
    // Cache the inventory items (these rarely change)
    cacheInventoryItems(dashboardItems);
    
    // Cache the quantities for this date
    cacheQuantities(openingQuantities, closingQuantities, addedQuantities);
    
    // Re-render with fresh data
    renderDashboard();
    updateDashboardDateDisplay();
    
    // Clear loading flag
    dashboardLoading = false;
    
    // Show sync success indicator
    showSyncIndicator('Data synced from Firebase', 'success');
    
    console.log('Dashboard data loaded successfully');
  } catch (error) {
    console.error('Error loading dashboard data:', error);
    dashboardLoading = false; // Clear loading flag on error
    
    // If we have cached data, show it; otherwise show error
    const cacheKey = `inventory-items-${dashboardBranch}`;
    const cachedData = localStorage.getItem(cacheKey);
    if (cachedData) {
      showSyncIndicator('Using cached data (offline)', 'info');
    } else {
      showDashboardErrorState('Failed to load data. Please try again.');
    }
  }
  
}

async function loadWeeklyViewData() {
  console.log('=== LOAD WEEKLY VIEW DATA START ===');
  console.log('Loading weekly data for branch:', weeklyBranch);
  
  const container = document.getElementById('weeklyTable');
  if (!container) {
    console.error('weeklyTable container not found!');
    return;
  }

  try {
    // Ensure we have dashboard items loaded
    if (dashboardItems.length === 0) {
      console.log('No dashboard items loaded, loading them first...');
      // Load master items and filter by enabled branches (same as dashboard)
      const querySnapshot = await getDocs(collection(db, 'inventory', '_config', 'items'));
      console.log('Query completed, found', querySnapshot.docs.length, 'documents');
      
      dashboardItems = querySnapshot.docs
        .map(d => {
          const data = d.data();
          return { 
            id: d.id, 
            ...data,
            // Ensure we have the required fields
            name: data.name || 'Unnamed Item',
            category: data.category || 'Other',
            description: data.description || '',
            photo: data.photo || null
          };
        })
        .filter(item => {
          // Filter by enabled branches (same logic as dashboard)
          const branchData = item.branches?.[weeklyBranch];
          return branchData && branchData.enabled;
        });
      
      console.log('Found', dashboardItems.length, 'inventory items for weekly view branch:', weeklyBranch);
    }
    // Get the 7 days starting from weeklyDate
    const startDate = new Date(weeklyDate);
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      dates.push(date);
    }

    console.log('Loading data for dates:', dates.map(d => getDateKey(d)));
    console.log('Start date:', getDateKey(weeklyDate));
    console.log('Weekly branch:', weeklyBranch);

    // Load usage data for each day
    weeklyData = {};
    const promises = dates.map(async (date) => {
      const dateStr = getDateKey(date);
      const docRef = doc(db, 'inventory-quantities', weeklyBranch, 'daily-quantities', dateStr);
      console.log(`Loading data for ${dateStr} from document: inventory-quantities/${weeklyBranch}/daily-quantities/${dateStr}`);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        const quantities = data.quantities || {};
        console.log(`Found quantities for ${dateStr}:`, quantities);
        
        // Calculate usage for each item
        Object.keys(quantities).forEach(itemId => {
          const itemQuantities = quantities[itemId];
          const opening = itemQuantities.opening?.value || 0;
          const closing = itemQuantities.closing?.value || 0;
          const added = itemQuantities.added?.value || 0;
          
          // Only calculate usage if closing data has been entered
          const hasClosingData = itemQuantities.closing && itemQuantities.closing.checked;
          const used = hasClosingData ? opening + added - closing : 0;
          
          console.log(`Item ${itemId} on ${dateStr}: opening=${opening}, added=${added}, closing=${closing}, hasClosingData=${hasClosingData}, used=${used}`);
          
          if (!weeklyData[itemId]) {
            weeklyData[itemId] = {};
          }
          weeklyData[itemId][dateStr] = {
            used: used,
            closing: closing,
            hasClosingData: hasClosingData
          };
        });
      } else {
        console.log(`No data found for ${dateStr} in document: ${weeklyBranch}_${dateStr}`);
      }
    });

    await Promise.all(promises);
    console.log('Weekly data loaded:', weeklyData);
    console.log('Dashboard items count:', dashboardItems.length);

    // Render the weekly view
    renderWeeklyView();

  } catch (error) {
    console.error('Error loading weekly view data:', error);
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #d32f2f;">Error loading weekly data</div>';
  }
}

function renderWeeklyView() {
  console.log('=== RENDER WEEKLY VIEW START ===');
  const container = document.getElementById('weeklyTable');
  
  if (!container) {
    console.error('weeklyTable container not found in renderWeeklyView!');
    return;
  }

  // Get the 7 days starting from weeklyDate
  const startDate = new Date(weeklyDate);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    dates.push(date);
  }

  // Build table headers with dates
  const headers = ['Photo', 'Item', 'Description'];
  dates.forEach(date => {
    const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'short' });
    const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dateStr = `<strong>${dayOfWeek}</strong><br>${monthDay}`;
    headers.push(dateStr);
  });
  
  // Add Total column only for usage mode
  if (weeklyQuantityType === 'used') {
    headers.push('<strong>Total</strong>');
  }

  // Group items by category
  const categoryMap = new Map();
  dashboardItems.forEach(item => {
    const category = item.category || 'Other';
    if (!categoryMap.has(category)) {
      categoryMap.set(category, []);
    }
    categoryMap.get(category).push(item);
  });

  // Sort categories
  const sortedCategories = Array.from(categoryMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Build table rows
  const rows = [];
  sortedCategories.forEach(([category, categoryItems]) => {
    // Category header row
    rows.push({
      type: 'category-header',
      category: category,
      colspan: headers.length
    });

    // Item rows for this category
    categoryItems.forEach(item => {
      const row = {
        type: 'item',
        item: item,
        category: category,
        cells: [
          // Photo
          item.photo ? `<img src="${item.photo}" alt="${item.name}" style="width: 40px; height: 40px; border-radius: 8px; object-fit: cover; border: 1px solid #eee;">` : '<div class="photo-placeholder"></div>',
          // Item name
          item.name,
          // Description
          item.description || '',
        ]
      };

      // Add usage data for each day
      let weekTotal = 0; // Track total for usage mode
      dates.forEach(date => {
        const dateStr = getDateKey(date);
        const dayData = weeklyData[item.id]?.[dateStr];
        const value = dayData ? dayData[weeklyQuantityType] : 0;
        const hasClosingData = dayData ? dayData.hasClosingData : false;
        console.log(`Rendering item ${item.id} (${item.name}) for ${dateStr}: ${weeklyQuantityType}=${value}, hasClosingData=${hasClosingData}`);
        
        // Show the actual value only if there's data
        if (weeklyData[item.id] && weeklyData[item.id].hasOwnProperty(dateStr)) {
          if (weeklyQuantityType === 'used' && !hasClosingData) {
            // Don't show usage if no closing data
            row.cells.push('-');
          } else if (weeklyQuantityType === 'closing' && !hasClosingData) {
            // Don't show closing if no closing data was entered
            row.cells.push('-');
          } else {
            const unit = item.unit || '';
            row.cells.push(value.toString() + (unit ? ` ${unit}` : ''));
            // Add to total only if we have a valid value (for usage mode)
            if (weeklyQuantityType === 'used' && hasClosingData) {
              weekTotal += value;
            }
          }
        } else {
          row.cells.push('-');
        }
      });
      
      // Add total column for usage mode
      if (weeklyQuantityType === 'used') {
        const unit = item.unit || '';
        row.cells.push(weekTotal > 0 ? formatNumberWithCommas(weekTotal) + (unit ? ` ${unit}` : '') : '-');
      }

      rows.push(row);
    });
  });

  // Build the table HTML
  const tableHtml = buildWeeklyTable(headers, rows);
  container.innerHTML = tableHtml;

  // Setup category collapse functionality
  setupWeeklyCategoryCollapse();

  console.log('🎨 Weekly view render completed');
}

function buildWeeklyTable(headers, rows) {
  let html = '<table class="inv-table weekly-table">';
  
  // Header row
  html += '<thead><tr>';
  headers.forEach((header, index) => {
    const isDateColumn = index >= 3 && index < headers.length - (headers[headers.length - 1].includes('Total') ? 1 : 0);
    const isTotalColumn = header.includes('Total');
    let align = 'left';
    if (isDateColumn || isTotalColumn) {
      align = 'center';
    }
    const headerClass = isTotalColumn ? 'total-column-header' : '';
    html += `<th style="text-align: ${align};" class="${headerClass}">${header}</th>`;
  });
  html += '</tr></thead>';

  // Body
  html += '<tbody>';
  rows.forEach(row => {
    if (row.type === 'category-header') {
      html += `<tr class="category-header" data-category="${row.category}">`;
      html += `<td colspan="${row.colspan}" style="padding: 8px 12px;">`;
      html += '<div class="category-header-container">';
      html += '<div class="category-header-left">';
      html += `<button class="category-collapse-btn" data-category="${row.category}">`;
      html += '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">';
      html += '<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
      html += '</svg></button>';
      html += `<span class="category-name">${row.category}</span>`;
      html += '</div></div></td></tr>';
    } else if (row.type === 'item') {
      html += `<tr class="inventory-row category-item-row" data-category="${row.category}">`;
      row.cells.forEach((cell, index) => {
        const isDateColumn = index >= 3 && index < row.cells.length - (weeklyQuantityType === 'used' ? 1 : 0);
        const isTotalColumn = index === row.cells.length - 1 && weeklyQuantityType === 'used';
        let align = 'left';
        if (isDateColumn || isTotalColumn) {
          align = 'center';
        }
        let cellClass = '';
        if (isDateColumn || isTotalColumn) {
          cellClass = 'quantity-cell used';
        }
        if (isTotalColumn) {
          cellClass += ' total-column';
        }
        html += `<td style="text-align: ${align};" class="${cellClass}">${cell}</td>`;
      });
      html += '</tr>';
    }
  });
  html += '</tbody></table>';

  return html;
}

function setupWeeklyCategoryCollapse() {
  const categoryHeaders = document.querySelectorAll('#weeklyTable .category-header');
  
  categoryHeaders.forEach(header => {
    const category = header.dataset.category;
    const collapseBtn = header.querySelector('.category-collapse-btn');
    
    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWeeklyCategoryCollapse(category);
      });
    }
  });
}

function toggleWeeklyCategoryCollapse(category) {
  const isCollapsed = dashboardCollapsedCategories.includes(category);
  
  if (isCollapsed) {
    // Expand
    dashboardCollapsedCategories = dashboardCollapsedCategories.filter(c => c !== category);
  } else {
    // Collapse
    dashboardCollapsedCategories.push(category);
  }
  
  // Save to localStorage
  localStorage.setItem('dashboard-collapsed-categories', JSON.stringify(dashboardCollapsedCategories));
  
  // Re-render table
  renderWeeklyView();
}

function renderDashboard() {
  const renderStart = performance.now();
  console.log('=== RENDER DASHBOARD START ===');
  const container = document.getElementById('inventoryTable');
  
  if (!container) {
    console.error('inventoryTable container not found in renderDashboard!');
    return;
  }
  
  console.log('Rendering dashboard with', dashboardItems.length, 'items');
  
  if (!dashboardItems || dashboardItems.length === 0) {
    console.log('No items found, showing placeholder table (dashboardLoading =', dashboardLoading, ')');
    showDashboardPlaceholder();
    return; // Always show placeholder when no items
  }
  
  // Group items by category
  const itemsByCategory = {};
  dashboardItems.forEach(item => {
    const category = item.category || 'Other';
    if (!itemsByCategory[category]) {
      itemsByCategory[category] = [];
    }
    itemsByCategory[category].push(item);
  });
  
  // Get unique categories
  const categories = getUniqueCategoriesFromItems(dashboardItems);
  
  // Build table rows
  const rows = categories.map(category => {
    const isCollapsed = dashboardCollapsedCategories.includes(category);
    const categoryItems = itemsByCategory[category] || [];
    
    // Category header
    const header = `
      <tr class="category-header" data-category="${category}">
        <td colspan="9" style="padding: 8px 12px;">
          <div class="category-header-container">
            <div class="category-header-left">
              <button class="category-collapse-btn ${isCollapsed ? 'collapsed' : ''}" data-category="${category}">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <span class="category-name">${category}</span>
            </div>
          </div>
        </td>
      </tr>`;
    
    // Category items
    const itemRows = categoryItems.map(item => {
      const openingQty = openingQuantities[item.id] || 0;
      const closingQty = closingQuantities[item.id] || 0;
      const addedQty = addedQuantities[item.id] || 0;
      const deliveryQty = deliveryQuantities[item.id] || 0;
      const pullOutQty = pullOutQuantities[item.id] || 0;
      const wastageQty = wastageQuantities[item.id] || 0;
      
      // Determine which column should be bold based on data availability
      // If closing data exists, mark closing as bold; otherwise mark opening as bold
      const rawQuantities = window.dashboardRawQuantities || {};
      const itemRawData = rawQuantities[item.id];
      
      // Check if data exists (has been logged)
      const hasClosingData = itemRawData && itemRawData.closing && itemRawData.closing.checked;
      const hasOpeningData = itemRawData && itemRawData.opening && itemRawData.opening.checked;
      const hasAddedData = itemRawData && itemRawData.added && itemRawData.added.checked;
      
      // Only calculate usage if closing data has been entered
      const usedQty = hasClosingData ? openingQty + addedQty - closingQty : 0;
      
      // If closing is logged, bold closing; otherwise if opening is logged, bold opening
      const openingClass = hasClosingData ? '' : (hasOpeningData ? 'most-recent' : '');
      const closingClass = hasClosingData ? 'most-recent' : '';
      
      // Check if item is low stock or out of stock
      // Use the selector value, same as the modal
      const currentBranch = document.getElementById('branchSelector')?.value || 'sm-north';
      // Use masterItems to get the correct restock level data
      const masterItem = masterItems.find(mi => mi.id === item.id);
      const restockLevel = masterItem ? getRestockLevelForBranch(masterItem, currentBranch) : 0;
      
      // Use most recent data available, accounting for added stock
      const mostRecentQty = hasClosingData ? closingQty : (openingQty + addedQty);
      const isOutOfStock = mostRecentQty === 0;
      const isLowStock = mostRecentQty > 0 && mostRecentQty <= restockLevel;
      
      // Apply filter if active
      if (isFilteringLowStocks && !isOutOfStock && !isLowStock) {
        return ''; // Skip this item if filtering and it's not low/out of stock
      }
      
      // Add icon and color coding
      let stockIcon = '';
      let stockColorClass = '';
      if (isOutOfStock) {
        // Red filled circle with white dash for out of stock
        stockIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-left: 4px;">
          <circle cx="8" cy="8" r="7" fill="#d32f2f"/>
          <path d="M4 8 L12 8" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>`;
        stockColorClass = 'out-of-stock';
      } else if (isLowStock) {
        // Orange triangle with exclamation for low stock (bigger)
        stockIcon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-left: 4px;">
          <path d="M9 2 L16 15 L2 15 Z" fill="#f57c00"/>
          <path d="M9 6 L9 10" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="9" cy="13" r="0.8" fill="white"/>
        </svg>`;
        stockColorClass = 'low-stock';
      }
      
      // Debug logging for matcha items
      if (item.name.toLowerCase().includes('matcha') || item.name.toLowerCase().includes('biscoff') || item.name.toLowerCase().includes('bomb') || item.name.toLowerCase().includes('ube')) {
        console.log(`Dashboard - ${item.name}: closingQty=${closingQty}, restockLevel=${restockLevel}, isOutOfStock=${isOutOfStock}, isLowStock=${isLowStock}, stockColorClass=${stockColorClass}`);
      }
      
      // Debug logging
      // console.log(`Item ${item.name}: hasOpening=${hasOpeningData}, hasClosing=${hasClosingData}, openingClass="${openingClass}", closingClass="${closingClass}"`);
      
      return `
        <tr class="inventory-row category-item-row ${stockColorClass}" data-category="${item.category}" data-item-id="${item.id}" ${isCollapsed ? 'style="display:none;"' : ''}>
        <td>
          <div class="photo-container">
            ${item.photo ? 
              `<img src="${item.photo}" alt="" onerror="this.style.display='none'"/>` : 
              `<div class="photo-placeholder"></div>`
            }
          </div>
        </td>
          <td style="width:200px;">${item.name}${stockIcon}</td>
          <td style="width:150px;">${item.description || ''}</td>
          <td class="quantity-cell opening ${openingClass} ${stockColorClass}">${formatNumberWithCommas(openingQty)} ${item.unit}</td>
          <td class="quantity-cell added ${stockColorClass}">${deliveryQty > 0 ? formatNumberWithCommas(deliveryQty) + ' ' + item.unit : '-'}</td>
          <td class="quantity-cell pull-out ${stockColorClass}" style="color: #dc3545;">${pullOutQty > 0 ? formatNumberWithCommas(pullOutQty) + ' ' + item.unit : '-'}</td>
          <td class="quantity-cell closing ${closingClass} ${stockColorClass}">${hasClosingData ? formatNumberWithCommas(closingQty) + ' ' + item.unit : '-'}</td>
          <td class="quantity-cell used ${stockColorClass}">${hasClosingData ? formatNumberWithCommas(usedQty) + ' ' + item.unit : '-'}</td>
          <td class="quantity-cell wastage ${stockColorClass}" style="color: #dc3545;">${wastageQty > 0 ? formatNumberWithCommas(wastageQty) + ' ' + item.unit : '-'}</td>
        </tr>`;
    }).join('');
    
    return header + itemRows;
  }).join('');
  
  // Build table
  const headers = ['Photo', 'Item', 'Description', 'Opening', 'Added', 'Pull Out', 'Closing', 'Used', 'Wastage'];
  const tableHtml = buildTable(headers, rows, 'dashboardTable');
  
  container.innerHTML = tableHtml;
  
  // Setup dashboard category collapse functionality
  setupDashboardCategoryCollapse();
  
  const renderTime = performance.now() - renderStart;
  console.log(`🎨 Dashboard render completed in: ${renderTime.toFixed(2)}ms`);
}

function getUniqueCategoriesFromItems(items) {
  const categoryMap = new Map();
  items.forEach(item => {
    if (item.category) {
      if (!categoryMap.has(item.category)) {
        categoryMap.set(item.category, {
          name: item.category,
          order: item.categoryOrder || 0,
          itemCount: 0
        });
      }
      categoryMap.get(item.category).itemCount++;
    }
  });
  
  return Array.from(categoryMap.values())
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name))
    .map(cat => cat.name);
}

// Setup dashboard category collapse functionality
function setupDashboardCategoryCollapse() {
  // Make entire category headers clickable
  const categoryHeaders = document.querySelectorAll('#dashboardTable .category-header');
  
  categoryHeaders.forEach(header => {
    header.addEventListener('click', (e) => {
      const category = header.dataset.category;
      toggleDashboardCategoryCollapse(category);
    });
  });
  
  // Also keep the collapse button clickable for visual feedback
  const buttons = document.querySelectorAll('#dashboardTable .category-collapse-btn');
  
  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const category = btn.dataset.category;
      toggleDashboardCategoryCollapse(category);
    });
  });
}

function toggleDashboardCategoryCollapse(category) {
  const isCollapsed = dashboardCollapsedCategories.includes(category);
  
  if (isCollapsed) {
    // Expand
    dashboardCollapsedCategories = dashboardCollapsedCategories.filter(c => c !== category);
  } else {
    // Collapse
    dashboardCollapsedCategories.push(category);
  }
  
  // Save to localStorage
  localStorage.setItem('dashboard-collapsed-categories', JSON.stringify(dashboardCollapsedCategories));
  
  // Re-render table
  renderDashboard();
}

function changeDashboardDate(delta) {
  dashboardDate.setDate(dashboardDate.getDate() + delta);
  updateDashboardDateDisplay();
  
  // Clear quantities cache when changing dates (items stay cached)
  clearQuantitiesCache();
  loadDashboardData();
}

function updateDashboardDateDisplay() {
  const dateDisplay = document.getElementById('dateDisplay');
  if (dateDisplay) {
    const dateStr = dashboardDate.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
    dateDisplay.textContent = dateStr;
  }
}

function openDateModal() {
  const modal = document.getElementById('dateModalOverlay');
  if (modal) {
    modal.style.display = 'flex';
    renderCalendar();
  }
}

function changeWeeklyDate(delta) {
  weeklyDate.setDate(weeklyDate.getDate() + delta);
  localStorage.setItem('weekly-selected-date', weeklyDate.toISOString());
  updateWeeklyDateDisplay();
  loadWeeklyViewData();
}

function updateWeeklyDateDisplay() {
  const dateDisplay = document.getElementById('weeklyDateDisplay');
  if (dateDisplay) {
    // Show the date range (first day to last day)
    const startDate = new Date(weeklyDate);
    const endDate = new Date(weeklyDate);
    endDate.setDate(startDate.getDate() + 6);
    
    const startStr = startDate.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
    const endStr = endDate.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
    
    dateDisplay.textContent = `${startStr} - ${endStr}`;
  }
}

function closeDateModal() {
  const modal = document.getElementById('dateModalOverlay');
  if (modal) {
    modal.style.display = 'none';
  }
  isWeeklyDatePickerActive = false;
}

function renderCalendar() {
  const container = document.getElementById('calendarContainer');
  if (!container) return;
  
  // Use the appropriate date based on which view is active
  const activeDate = isWeeklyDatePickerActive ? weeklyDate : dashboardDate;
  const year = activeDate.getFullYear();
  const month = activeDate.getMonth();
  const today = new Date();
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstDay.getDay());
  
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  
  let calendarHtml = `
    <div class="calendar-header">
      <h4>${monthNames[month]} ${year}</h4>
    </div>
    <div class="calendar-weekdays">
      ${weekdays.map(day => `<div class="weekday">${day}</div>`).join('')}
    </div>
    <div class="calendar-grid">
  `;
  
  // Normalize activeDate to date-only for comparison
  const normalizedActiveDate = new Date(activeDate.getFullYear(), activeDate.getMonth(), activeDate.getDate());
  const currentDateKey = getDateKey(normalizedActiveDate);
  
  for (let i = 0; i < 42; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    
    const dateKey = getDateKey(date);
    const isCurrentMonth = date.getMonth() === month;
    const isToday = dateKey === getDateKey(today);
    const isSelected = dateKey === currentDateKey;
    
    let className = 'calendar-day';
    if (!isCurrentMonth) className += ' other-month';
    if (isToday) className += ' today';
    if (isSelected) className += ' selected';
    
    const selectFunction = isWeeklyDatePickerActive ? 'selectWeeklyDate' : 'selectDashboardDate';
    calendarHtml += `
      <div class="${className}" onclick="${selectFunction}('${dateKey}')">
        ${date.getDate()}
      </div>
    `;
  }
  
  calendarHtml += '</div>';
  
  container.innerHTML = calendarHtml;
}

function selectDashboardDate(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  dashboardDate = new Date(year, month - 1, day);
  updateDashboardDateDisplay();
  closeDateModal();
  
  // Clear quantities cache when changing dates (items stay cached)
  clearQuantitiesCache();
  loadDashboardData();
}

function selectWeeklyDate(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  weeklyDate = new Date(year, month - 1, day);
  localStorage.setItem('weekly-selected-date', weeklyDate.toISOString());
  updateWeeklyDateDisplay();
  closeDateModal();
  isWeeklyDatePickerActive = false;
  loadWeeklyViewData();
}

// Placeholder table is now in HTML - no need for this function

function showDashboardLoadingState() {
  const container = document.getElementById('inventoryTable');
  container.innerHTML = `
    <div class="loading-indicator">
      <div class="spinner"></div>
      <span>Loading inventory data...</span>
    </div>`;
}

function showDashboardErrorState(message) {
  const container = document.getElementById('inventoryTable');
  container.innerHTML = `
    <div class="empty-state">
      ${message}
    </div>`;
}

// Format number with commas
function formatNumberWithCommas(num) {
  if (num === null || num === undefined) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Sync indicator function
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

// Check if inventory items have changed (less frequent check)
async function checkInventoryItemsForUpdates() {
  try {
    console.log('Background check: Checking if inventory items have changed');
    
    // Load inventory items for dashboard branch
    const querySnapshot = await getDocs(query(collection(db, 'inventory', '_config', 'items'), where('branch', '==', dashboardBranch)));
    
    const freshItems = querySnapshot.docs.map(d => {
      const data = d.data();
      return { 
        id: d.id, 
        ...data,
        displayOrder: data.displayOrder ?? 0,
        categoryOrder: data.categoryOrder ?? 0
      };
    });
    
    // Sort by category order, then display order
    freshItems.sort((a, b) => {
      if (a.categoryOrder !== b.categoryOrder) {
        return a.categoryOrder - b.categoryOrder;
      }
      return a.displayOrder - b.displayOrder;
    });
    
    // Check if items have changed
    const itemsChanged = JSON.stringify(freshItems) !== JSON.stringify(dashboardItems);
    
    if (itemsChanged) {
      console.log('🔄 Background check: Inventory items have changed, updating');
      dashboardItems = freshItems;
      
      // Cache the fresh items
      cacheInventoryItems(dashboardItems);
      
      // Re-render with fresh items
      renderDashboard();
      showSyncIndicator('Inventory items updated from Firebase', 'success');
    } else {
      console.log('✅ Background check: Inventory items are up to date');
    }
    
  } catch (error) {
    console.error('Background inventory check error:', error);
  }
}

// Background sync function for quantities only (non-blocking)
async function syncQuantitiesFromFirebaseInBackground() {
  try {
    console.log('Background sync: Loading quantities from Firebase');
    
    // Load quantities for both opening and closing
    const dateKey = getDateKey(dashboardDate);
    const docRef = doc(db, 'inventory-quantities', dashboardBranch, 'daily-quantities', dateKey);
    const docSnap = await getDoc(docRef);
    
    const freshOpeningQuantities = {};
    const freshClosingQuantities = {};
    const freshAddedQuantities = {};
    const freshDeliveryQuantities = {};
    const freshPullOutQuantities = {};
    const freshWastageQuantities = {};
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      const quantities = data.quantities || {};
      
      Object.keys(quantities).forEach(itemId => {
        const itemQuantities = quantities[itemId];
        
        if (itemQuantities.opening && itemQuantities.opening.checked) {
          freshOpeningQuantities[itemId] = itemQuantities.opening.value;
        }
        if (itemQuantities.closing && itemQuantities.closing.checked) {
          freshClosingQuantities[itemId] = itemQuantities.closing.value;
        }
        if (itemQuantities.added && itemQuantities.added.checked) {
          freshAddedQuantities[itemId] = itemQuantities.added.value;
        }
        
        // Calculate breakdown from adjustments array
        let delivery = 0;
        let pullOut = 0;
        let wastage = 0;
        
        if (itemQuantities.adjustments && Array.isArray(itemQuantities.adjustments)) {
          itemQuantities.adjustments.forEach(adj => {
            const value = Math.abs(adj.value || 0);
            if (adj.reason === 'delivery') {
              delivery += value;
            } else if (adj.reason === 'pulled-out') {
              pullOut += value;
            } else if (adj.reason === 'wastage') {
              wastage += value;
            }
          });
        }
        
        freshDeliveryQuantities[itemId] = delivery;
        freshPullOutQuantities[itemId] = pullOut;
        freshWastageQuantities[itemId] = wastage;
      });
    }
    
    // Check if quantities have changed
    const quantitiesChanged = JSON.stringify(freshOpeningQuantities) !== JSON.stringify(openingQuantities) ||
                             JSON.stringify(freshClosingQuantities) !== JSON.stringify(closingQuantities) ||
                             JSON.stringify(freshAddedQuantities) !== JSON.stringify(addedQuantities);
    
    if (quantitiesChanged) {
      console.log('Background sync: Quantities have changed, updating display');
      openingQuantities = freshOpeningQuantities;
      closingQuantities = freshClosingQuantities;
      addedQuantities = freshAddedQuantities;
      deliveryQuantities = freshDeliveryQuantities;
      pullOutQuantities = freshPullOutQuantities;
      wastageQuantities = freshWastageQuantities;
      
      // Cache the fresh quantities
      cacheQuantities(openingQuantities, closingQuantities, addedQuantities);
      
      // Re-render with fresh quantities
      renderDashboard();
      showSyncIndicator('Quantities updated from Firebase', 'success');
    } else {
      console.log('Background sync: Quantities are up to date');
      // Still cache to update timestamp
      cacheQuantities(openingQuantities, closingQuantities, addedQuantities);
      showSyncIndicator('Quantities are up to date', 'info');
    }
    
  } catch (error) {
    console.error('Background sync error:', error);
    showSyncIndicator('Background sync failed', 'error');
  }
}

// Background sync function (non-blocking) - for when no cached items exist
async function syncWithFirebaseInBackground() {
  try {
    console.log('Background sync: Loading fresh data from Firebase');
    
    // Load inventory items for dashboard branch
    const querySnapshot = await getDocs(query(collection(db, 'inventory', '_config', 'items'), where('branch', '==', dashboardBranch)));
    
    const freshItems = querySnapshot.docs.map(d => {
      const data = d.data();
      return { 
        id: d.id, 
        ...data,
        displayOrder: data.displayOrder ?? 0,
        categoryOrder: data.categoryOrder ?? 0
      };
    });
    
    // Sort by category order, then display order
    freshItems.sort((a, b) => {
      if (a.categoryOrder !== b.categoryOrder) {
        return a.categoryOrder - b.categoryOrder;
      }
      return a.displayOrder - b.displayOrder;
    });
    
    // Load quantities for both opening and closing
    const dateKey = getDateKey(dashboardDate);
    const docRef = doc(db, 'inventory-quantities', dashboardBranch, 'daily-quantities', dateKey);
    const docSnap = await getDoc(docRef);
    
    const freshOpeningQuantities = {};
    const freshClosingQuantities = {};
    const freshAddedQuantities = {};
    const freshDeliveryQuantities = {};
    const freshPullOutQuantities = {};
    const freshWastageQuantities = {};
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      const quantities = data.quantities || {};
      
      Object.keys(quantities).forEach(itemId => {
        const itemQuantities = quantities[itemId];
        
        if (itemQuantities.opening && itemQuantities.opening.checked) {
          freshOpeningQuantities[itemId] = itemQuantities.opening.value;
        }
        if (itemQuantities.closing && itemQuantities.closing.checked) {
          freshClosingQuantities[itemId] = itemQuantities.closing.value;
        }
        if (itemQuantities.added && itemQuantities.added.checked) {
          freshAddedQuantities[itemId] = itemQuantities.added.value;
        }
        
        // Calculate breakdown from adjustments array
        let delivery = 0;
        let pullOut = 0;
        let wastage = 0;
        
        if (itemQuantities.adjustments && Array.isArray(itemQuantities.adjustments)) {
          itemQuantities.adjustments.forEach(adj => {
            const value = Math.abs(adj.value || 0);
            if (adj.reason === 'delivery') {
              delivery += value;
            } else if (adj.reason === 'pulled-out') {
              pullOut += value;
            } else if (adj.reason === 'wastage') {
              wastage += value;
            }
          });
        }
        
        freshDeliveryQuantities[itemId] = delivery;
        freshPullOutQuantities[itemId] = pullOut;
        freshWastageQuantities[itemId] = wastage;
      });
    }
    
    // Check if data has changed
    const dataChanged = JSON.stringify(freshItems) !== JSON.stringify(dashboardItems) ||
                       JSON.stringify(freshOpeningQuantities) !== JSON.stringify(openingQuantities) ||
                       JSON.stringify(freshClosingQuantities) !== JSON.stringify(closingQuantities) ||
                       JSON.stringify(freshAddedQuantities) !== JSON.stringify(addedQuantities);
    
    if (dataChanged) {
      console.log('Background sync: Data has changed, updating display');
      dashboardItems = freshItems;
      openingQuantities = freshOpeningQuantities;
      closingQuantities = freshClosingQuantities;
      addedQuantities = freshAddedQuantities;
      deliveryQuantities = freshDeliveryQuantities;
      pullOutQuantities = freshPullOutQuantities;
      wastageQuantities = freshWastageQuantities;
      
      // Cache the fresh data
      cacheDashboardData();
      
      // Re-render with fresh data
      renderDashboard();
      showSyncIndicator('Data updated from Firebase', 'success');
    } else {
      console.log('Background sync: Data is up to date');
      // Still cache to update timestamp
      cacheDashboardData();
      showSyncIndicator('Data is up to date', 'info');
    }
    
  } catch (error) {
    console.error('Background sync error:', error);
    showSyncIndicator('Background sync failed', 'error');
  }
}

// Cache management functions - separate items from quantities
function loadInventoryItemsFromCache() {
  try {
    // Use the EXACT same cache key as the main inventory system
    const cacheKey = `inventory-items-${dashboardBranch}`;
    console.log('🔍 Dashboard looking for cache with key:', cacheKey);
    const cached = localStorage.getItem(cacheKey);
    if (!cached) {
      console.log('❌ No cached inventory items found for branch:', dashboardBranch);
      console.log('🔍 Available localStorage keys:', Object.keys(localStorage).filter(k => k.includes('inventory')));
      return null;
    }
    
    const parseStart = performance.now();
    const cacheData = JSON.parse(cached);
    const parseTime = performance.now() - parseStart;
    
    // Main inventory uses direct array format - use that
    if (Array.isArray(cacheData)) {
      console.log(`📦 Loading inventory items from main inventory cache (parse: ${parseTime.toFixed(2)}ms)`);
      console.log('📦 Cached items count:', cacheData.length);
      
      // Ensure items have proper ordering fields
      return cacheData.map(item => ({
        ...item,
        displayOrder: item.displayOrder || item.order || 0,
        categoryOrder: item.categoryOrder || 0
      }));
    } else {
      console.log('❌ Cache format is not array - main inventory cache not found');
      return null;
    }
  } catch (error) {
    console.error('Error loading cached inventory items:', error);
    return null;
  }
}

function cacheInventoryItems(items) {
  try {
    const cacheKey = `inventory-items-${dashboardBranch}`;
    // Use the SAME format as main inventory - direct array, not wrapped object
    localStorage.setItem(cacheKey, JSON.stringify(items));
    console.log('Inventory items cached for branch:', dashboardBranch, 'items:', items.length);
  } catch (error) {
    console.error('Error caching inventory items:', error);
  }
}

// Unified cache invalidation - clears cache for all branches
function invalidateInventoryCache() {
  try {
    const branches = ['sm-north', 'podium', 'moa'];
    branches.forEach(branch => {
      const cacheKey = `inventory-items-${branch}`;
      localStorage.removeItem(cacheKey);
      console.log(`🗑️ Invalidated inventory cache for branch: ${branch}`);
    });
  } catch (error) {
    console.error('Error invalidating inventory cache:', error);
  }
}

function loadQuantitiesFromCache() {
  try {
    const cacheKey = `quantities-${dashboardBranch}-${getDateKey(dashboardDate)}`;
    const cached = localStorage.getItem(cacheKey);
    if (!cached) {
      console.log('❌ No cached quantities found for date:', getDateKey(dashboardDate));
      return null;
    }
    
    const parseStart = performance.now();
    const cacheData = JSON.parse(cached);
    const parseTime = performance.now() - parseStart;
    console.log(`📊 Loading quantities from cache for date: ${getDateKey(dashboardDate)} (parse: ${parseTime.toFixed(2)}ms)`);
    return cacheData.data;
  } catch (error) {
    console.error('Error loading cached quantities:', error);
    return null;
  }
}

function cacheQuantities(opening, closing, added) {
  try {
    const cacheKey = `quantities-${dashboardBranch}-${getDateKey(dashboardDate)}`;
    const cacheData = {
      timestamp: Date.now(),
      data: {
        openingQuantities: opening,
        closingQuantities: closing,
        addedQuantities: added || {}
      }
    };
    
    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    console.log('Quantities cached for branch:', dashboardBranch, 'date:', getDateKey(dashboardDate));
  } catch (error) {
    console.error('Error caching quantities:', error);
  }
}

function clearInventoryItemsCache() {
  try {
    const cacheKey = `inventory-items-${dashboardBranch}`;
    localStorage.removeItem(cacheKey);
    console.log('Inventory items cache cleared for branch:', dashboardBranch);
  } catch (error) {
    console.error('Error clearing inventory items cache:', error);
  }
}

function clearQuantitiesCache() {
  try {
    const cacheKey = `quantities-${dashboardBranch}-${getDateKey(dashboardDate)}`;
    localStorage.removeItem(cacheKey);
    console.log('Quantities cache cleared for branch:', dashboardBranch, 'date:', getDateKey(dashboardDate));
  } catch (error) {
    console.error('Error clearing quantities cache:', error);
  }
}

// Debug function to clear all inventory caches
window.clearAllInventoryCaches = function() {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('inventory-items-') || key.startsWith('quantities-')) {
        localStorage.removeItem(key);
        console.log('Cleared cache:', key);
      }
    });
    showSyncIndicator('All inventory caches cleared', 'info');
  } catch (error) {
    console.error('Error clearing caches:', error);
  }
};

// Debug function to test cache loading speed
window.testCacheSpeed = function() {
  console.log('🧪 Testing cache loading speed...');
  const start = performance.now();
  
  const cachedItems = loadInventoryItemsFromCache();
  const cachedQuantities = loadQuantitiesFromCache();
  
  const end = performance.now();
  const time = end - start;
  
  console.log(`⚡ Cache loading took: ${time.toFixed(2)}ms`);
  console.log(`📦 Items found: ${cachedItems ? cachedItems.length : 'none'}`);
  console.log(`📊 Quantities found: ${cachedQuantities ? 'yes' : 'no'}`);
  
  return { time, itemsCount: cachedItems ? cachedItems.length : 0, hasQuantities: !!cachedQuantities };
};

// Master items cache functions
function loadMasterItemsFromCache() {
  try {
    const cached = localStorage.getItem('inventory-config-items-cache');
    if (!cached) {
      console.log('❌ No cached master items found');
      return null;
    }
    
    const parseStart = performance.now();
    const cacheData = JSON.parse(cached);
    const parseTime = performance.now() - parseStart;
    
    console.log('📦 Loading master items from cache (parse:', parseTime.toFixed(2), 'ms)');
    console.log('📦 Cached master items count:', cacheData.items.length);
    return cacheData.items;
  } catch (error) {
    console.error('Error loading cached master items:', error);
    return null;
  }
}

function cacheMasterItems(items) {
  try {
    const cacheData = {
      timestamp: Date.now(),
      items: items
    };
    localStorage.setItem('inventory-config-items-cache', JSON.stringify(cacheData));
    console.log('📦 Master items cached:', items.length, 'items');
  } catch (error) {
    console.error('Error caching master items:', error);
  }
}

// Background sync for master items
async function syncMasterItemsFromFirebaseInBackground() {
  try {
    console.log('🔄 Background sync: Loading master items from Firebase (isMovingItems =', isMovingItems, ', isTogglingBranch =', isTogglingBranch, ')');
    
    const querySnapshot = await getDocs(collection(db, 'inventory', '_config', 'items'));
    const freshItems = querySnapshot.docs.map(d => {
      const data = d.data();
      if (data && data.subtitle && !data.description) data.description = data.subtitle;
      return { id: d.id, displayOrder: data.displayOrder ?? 0, categoryOrder: data.categoryOrder ?? 0, ...data };
    });
    
    console.log('🔄 Background sync: Fresh items loaded from Firebase:', freshItems.length, 'items');
    console.log('🔄 Background sync: Sample fresh item enabledBranches:', freshItems.slice(0, 3).map(item => ({ name: item.name, enabledBranches: item.enabledBranches })));
    
    // Check if data has changed (including displayOrder, categoryOrder, and enabledBranches)
    const currentItemsJson = JSON.stringify(masterItems.map(item => ({ 
      id: item.id, 
      name: item.name, 
      category: item.category, 
      displayOrder: item.displayOrder, 
      categoryOrder: item.categoryOrder,
      enabledBranches: item.enabledBranches
    })));
    const freshItemsJson = JSON.stringify(freshItems.map(item => ({ 
      id: item.id, 
      name: item.name, 
      category: item.category, 
      displayOrder: item.displayOrder, 
      categoryOrder: item.categoryOrder,
      enabledBranches: item.enabledBranches
    })));
    
    console.log('🔄 Background sync: Current items enabledBranches:', masterItems.slice(0, 3).map(item => ({ name: item.name, enabledBranches: item.enabledBranches })));
    console.log('🔄 Background sync: Fresh items enabledBranches:', freshItems.slice(0, 3).map(item => ({ name: item.name, enabledBranches: item.enabledBranches })));
    console.log('🔄 Background sync: Data changed?', currentItemsJson !== freshItemsJson);
    
    if (currentItemsJson !== freshItemsJson) {
      // Don't override local changes if we're currently moving items or toggling branches
      if (isMovingItems) {
        console.log('🔄 Background sync: Skipping update - items are being moved (isMovingItems = true)');
        return;
      }
      if (isTogglingBranch) {
        console.log('🔄 Background sync: Skipping update - branches are being toggled (isTogglingBranch = true)');
        return;
      }
      
      console.log('🔄 Background sync: Master items have changed, updating');
      console.log('🔄 Background sync: Current items enabledBranches:', masterItems.map(item => ({ name: item.name, enabledBranches: item.enabledBranches })));
      console.log('🔄 Background sync: Fresh items enabledBranches:', freshItems.map(item => ({ name: item.name, enabledBranches: item.enabledBranches })));
      masterItems = freshItems;
      console.log('🔄 Background sync: masterItems updated to fresh data');
      
      // Cache the fresh data
      cacheMasterItems(masterItems);
      
      // Re-render if we're on master items or branch list tab
      if (currentTask === 'master-items') {
        console.log('🔄 Background sync: Re-rendering master items');
        renderMasterItems();
      }
      if (currentTask === 'branch-list') {
        console.log('🔄 Background sync: Re-rendering branch list');
        renderBranchList();
      }
      
      showSyncIndicator('Master items updated', 'success');
    } else {
      console.log('Background sync: Master items are up to date');
    }
  } catch (error) {
    console.error('Error syncing master items:', error);
  }
}

// Debug function to force instant dashboard load (bypass all Firebase)
window.forceInstantLoad = function() {
  console.log('🚀 Force instant dashboard load...');
  const start = performance.now();
  
  // Load cached data directly
  const cachedItems = loadInventoryItemsFromCache();
  const cachedQuantities = loadQuantitiesFromCache();
  
  if (cachedItems) {
    dashboardItems = cachedItems;
    openingQuantities = cachedQuantities?.openingQuantities || {};
    closingQuantities = cachedQuantities?.closingQuantities || {};
    addedQuantities = cachedQuantities?.addedQuantities || {};
    
    // Render immediately
    renderDashboard();
    updateDashboardDateDisplay();
    dashboardLoading = false;
    
    const end = performance.now();
    console.log(`⚡ Force load completed in: ${(end - start).toFixed(2)}ms`);
    showSyncIndicator('Force loaded from cache', 'success');
  } else {
    console.log('❌ No cached data available');
  }
};

// Bulk Add Functions
let bulkAddRowCount = 0;

function openAddMultipleItemsModal() {
  const modal = document.getElementById('addMultipleItemsModalOverlay');
  if (modal) {
    modal.style.display = 'flex';
    clearBulkTable();
    addBulkRow(); // Add initial row
  }
}

function closeAddMultipleItemsModal() {
  const modal = document.getElementById('addMultipleItemsModalOverlay');
  if (modal) {
    modal.style.display = 'none';
  }
}

function addBulkRow() {
  const tbody = document.getElementById('bulkAddTableBody');
  if (!tbody) return;
  
  bulkAddRowCount++;
  const rowIndex = bulkAddRowCount;
  
  // Get available categories
  const categories = getUniqueCategories();
  const categoryOptions = categories.map(cat => `<option value="${cat}">${cat}</option>`).join('') + '<option value="Other">Other</option>';
  
  const row = document.createElement('tr');
  row.innerHTML = `
    <td class="row-number">${rowIndex}</td>
    <td><input type="text" class="bulk-item-name" placeholder="Enter item name" data-row="${rowIndex}"></td>
    <td><input type="text" class="bulk-item-description" placeholder="Description (optional)" data-row="${rowIndex}"></td>
    <td>
      <select class="bulk-item-category" data-row="${rowIndex}">
        ${categoryOptions}
      </select>
    </td>
    <td>
      <select class="bulk-item-unit" data-row="${rowIndex}">
        <option value="pcs">pcs</option>
        <option value="g">g</option>
        <option value="kg">kg</option>
        <option value="L">L</option>
        <option value="ml">ml</option>
        <option value="pans">Pans</option>
      </select>
    </td>
    <td><input type="number" class="bulk-item-restock" min="0" value="0" data-row="${rowIndex}"></td>
    <td>
      <button class="delete-row-btn" onclick="deleteBulkRow(${rowIndex})" ${rowIndex === 1 ? 'disabled' : ''}>×</button>
    </td>
  `;
  
  tbody.appendChild(row);
  
  // Add event listeners to the new row
  setupBulkRowEventListeners(row);
  
  // Focus on the first input of the new row
  const nameInput = row.querySelector('.bulk-item-name');
  if (nameInput) nameInput.focus();
  
  updateBulkItemCount();
  updateBulkSaveButton();
}

function copyLastBulkRow() {
  const tbody = document.getElementById('bulkAddTableBody');
  if (!tbody) return;
  
  // Get the last row
  const rows = tbody.querySelectorAll('tr');
  if (rows.length === 0) {
    // If no rows exist, just add a new row
    addBulkRow();
    return;
  }
  
  const lastRow = rows[rows.length - 1];
  
  // Get values from the last row
  const nameInput = lastRow.querySelector('.bulk-item-name');
  const descriptionInput = lastRow.querySelector('.bulk-item-description');
  const categorySelect = lastRow.querySelector('.bulk-item-category');
  const unitSelect = lastRow.querySelector('.bulk-item-unit');
  const restockInput = lastRow.querySelector('.bulk-item-restock');
  
  // Create new row with copied values
  bulkAddRowCount++;
  const rowIndex = bulkAddRowCount;
  
  // Get available categories
  const categories = getUniqueCategories();
  const categoryOptions = categories.map(cat => `<option value="${cat}">${cat}</option>`).join('') + '<option value="Other">Other</option>';
  
  const row = document.createElement('tr');
  row.innerHTML = `
    <td class="row-number">${rowIndex}</td>
    <td><input type="text" class="bulk-item-name" placeholder="Enter item name" data-row="${rowIndex}" value="${nameInput ? nameInput.value : ''}"></td>
    <td><input type="text" class="bulk-item-description" placeholder="Description (optional)" data-row="${rowIndex}" value="${descriptionInput ? descriptionInput.value : ''}"></td>
    <td>
      <select class="bulk-item-category" data-row="${rowIndex}">
        ${categoryOptions}
      </select>
    </td>
    <td>
      <select class="bulk-item-unit" data-row="${rowIndex}">
        <option value="pcs" ${unitSelect && unitSelect.value === 'pcs' ? 'selected' : ''}>pcs</option>
        <option value="g" ${unitSelect && unitSelect.value === 'g' ? 'selected' : ''}>g</option>
        <option value="kg" ${unitSelect && unitSelect.value === 'kg' ? 'selected' : ''}>kg</option>
        <option value="L" ${unitSelect && unitSelect.value === 'L' ? 'selected' : ''}>L</option>
        <option value="ml" ${unitSelect && unitSelect.value === 'ml' ? 'selected' : ''}>ml</option>
        <option value="pans" ${unitSelect && unitSelect.value === 'pans' ? 'selected' : ''}>Pans</option>
      </select>
    </td>
    <td><input type="number" class="bulk-item-restock" min="0" value="${restockInput ? restockInput.value : '0'}" data-row="${rowIndex}"></td>
    <td>
      <button class="delete-row-btn" onclick="deleteBulkRow(${rowIndex})">×</button>
    </td>
  `;
  
  tbody.appendChild(row);
  
  // Set the category selection
  const newCategorySelect = row.querySelector('.bulk-item-category');
  if (newCategorySelect && categorySelect) {
    newCategorySelect.value = categorySelect.value;
  }
  
  // Add event listeners to the new row
  setupBulkRowEventListeners(row);
  
  // Focus on the first input of the new row and select all text
  const newNameInput = row.querySelector('.bulk-item-name');
  if (newNameInput) {
    newNameInput.focus();
    newNameInput.select(); // Select all text so user can easily type over it
  }
  
  updateBulkItemCount();
  updateBulkSaveButton();
}

function deleteBulkRow(rowIndex) {
  const tbody = document.getElementById('bulkAddTableBody');
  if (!tbody) return;
  
  const row = tbody.querySelector(`tr td input[data-row="${rowIndex}"]`)?.closest('tr');
  if (row) {
    row.remove();
    updateBulkItemCount();
    updateBulkSaveButton();
    renumberBulkRows();
  }
}

function clearBulkTable() {
  const tbody = document.getElementById('bulkAddTableBody');
  if (tbody) {
    tbody.innerHTML = '';
    bulkAddRowCount = 0;
    updateBulkItemCount();
    updateBulkSaveButton();
  }
}

function renumberBulkRows() {
  const tbody = document.getElementById('bulkAddTableBody');
  if (!tbody) return;
  
  const rows = tbody.querySelectorAll('tr');
  rows.forEach((row, index) => {
    const rowNumber = row.querySelector('.row-number');
    if (rowNumber) {
      rowNumber.textContent = index + 1;
    }
    
    // Update data-row attributes
    const inputs = row.querySelectorAll('input, select');
    inputs.forEach(input => {
      input.setAttribute('data-row', index + 1);
    });
    
    // Update delete button
    const deleteBtn = row.querySelector('.delete-row-btn');
    if (deleteBtn) {
      deleteBtn.disabled = index === 0; // Disable delete for first row
      deleteBtn.setAttribute('onclick', `deleteBulkRow(${index + 1})`);
    }
  });
}

function setupBulkRowEventListeners(row) {
  const inputs = row.querySelectorAll('input, select');
  
  inputs.forEach(input => {
    // Handle Enter key to add new row and Shift+Enter to copy last row
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        
        if (e.shiftKey) {
          // Shift+Enter: Copy last row
          copyLastBulkRow();
        } else {
          // Regular Enter: Add new row or move to next field
          if (input.closest('tr') === row && input.value.trim()) {
            addBulkRow();
          } else {
            // Move to next field or next row
            const nextInput = getNextBulkInput(input);
            if (nextInput) {
              nextInput.focus();
            }
          }
        }
      }
    });
    
    // Handle input changes to update save button state
    input.addEventListener('input', () => {
      updateBulkSaveButton();
    });
  });
}

function getNextBulkInput(currentInput) {
  const tbody = document.getElementById('bulkAddTableBody');
  if (!tbody) return null;
  
  const allInputs = Array.from(tbody.querySelectorAll('input, select'));
  const currentIndex = allInputs.indexOf(currentInput);
  
  if (currentIndex < allInputs.length - 1) {
    return allInputs[currentIndex + 1];
  }
  
  return null;
}

function updateBulkItemCount() {
  const countElement = document.getElementById('bulkItemCount');
  if (!countElement) return;
  
  const tbody = document.getElementById('bulkAddTableBody');
  const validRows = tbody ? tbody.querySelectorAll('tr').length : 0;
  
  countElement.textContent = `${validRows} item${validRows !== 1 ? 's' : ''}`;
  
  // Update Copy Last Row button state
  const copyLastRowBtn = document.getElementById('copyLastRowBtn');
  if (copyLastRowBtn) {
    copyLastRowBtn.disabled = validRows === 0;
  }
}

function updateBulkSaveButton() {
  const saveBtn = document.getElementById('bulkAddSaveBtn');
  if (!saveBtn) return;
  
  const tbody = document.getElementById('bulkAddTableBody');
  if (!tbody) {
    saveBtn.disabled = true;
    return;
  }
  
  const rows = tbody.querySelectorAll('tr');
  let hasValidItems = false;
  
  rows.forEach(row => {
    const nameInput = row.querySelector('.bulk-item-name');
    if (nameInput && nameInput.value.trim()) {
      hasValidItems = true;
    }
  });
  
  saveBtn.disabled = !hasValidItems;
}

async function handleBulkAddSubmit() {
  const saveBtn = document.getElementById('bulkAddSaveBtn');
  if (!saveBtn || saveBtn.disabled) return;
  
  const tbody = document.getElementById('bulkAddTableBody');
  if (!tbody) return;
  
  const rows = tbody.querySelectorAll('tr');
  const itemsToAdd = [];
  
  // Collect valid items
  rows.forEach(row => {
    const nameInput = row.querySelector('.bulk-item-name');
    const descriptionInput = row.querySelector('.bulk-item-description');
    const categorySelect = row.querySelector('.bulk-item-category');
    const unitSelect = row.querySelector('.bulk-item-unit');
    const restockInput = row.querySelector('.bulk-item-restock');
    
    if (nameInput && nameInput.value.trim()) {
      itemsToAdd.push({
        name: nameInput.value.trim(),
        description: descriptionInput ? descriptionInput.value.trim() : '',
        category: categorySelect ? categorySelect.value : 'Other',
        unit: unitSelect ? unitSelect.value : 'pcs',
        restockAmount: restockInput ? parseInt(restockInput.value) || 0 : 0,
        enabledBranches: availableBranches, // Default to all branches enabled
        branchOverrides: {} // Start with empty overrides
      });
    }
  });
  
  if (itemsToAdd.length === 0) {
    alert('Please enter at least one item name.');
    return;
  }
  
  // Show loading state
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  
  try {
    // Group items by category to maintain order within categories
    const itemsByCategory = {};
    itemsToAdd.forEach((item, index) => {
      if (!itemsByCategory[item.category]) {
        itemsByCategory[item.category] = [];
      }
      itemsByCategory[item.category].push({ ...item, inputOrder: index });
    });
    
    // Get current category orders
    const currentCategories = getUniqueCategories();
    const categoryOrderMap = {};
    currentCategories.forEach((cat, index) => {
      categoryOrderMap[cat] = index;
    });
    
    // Add new categories to the end
    Object.keys(itemsByCategory).forEach(category => {
      if (!categoryOrderMap.hasOwnProperty(category)) {
        categoryOrderMap[category] = Math.max(...Object.values(categoryOrderMap), -1) + 1;
      }
    });
    
    // Prepare items with proper ordering
    const itemsWithOrder = [];
    Object.keys(itemsByCategory).forEach(category => {
      const categoryItems = itemsByCategory[category];
      
      // Get the highest displayOrder in this category
      const existingItemsInCategory = masterItems.filter(item => item.category === category);
      const maxDisplayOrder = existingItemsInCategory.length > 0 
        ? Math.max(...existingItemsInCategory.map(item => item.displayOrder || 0))
        : -1;
      
      // Add items to the bottom of the category in input order
      categoryItems.forEach((item, index) => {
        itemsWithOrder.push({
          ...item,
          displayOrder: maxDisplayOrder + 1 + index,
          categoryOrder: categoryOrderMap[category]
        });
      });
    });
    
    // Sort by input order to maintain the order they were entered
    itemsWithOrder.sort((a, b) => a.inputOrder - b.inputOrder);
    
    // Add all items to Firebase with proper ordering
    const addPromises = itemsWithOrder.map(item => {
      const { inputOrder, ...itemData } = item; // Remove inputOrder before saving
      return addDoc(collection(db, 'inventory', '_config', 'items'), itemData);
    });
    await Promise.all(addPromises);
    
    console.log(`Successfully added ${itemsToAdd.length} items with proper ordering`);
    
    // Reload data and re-render
    await loadMasterItems();
    
    // Clear dashboard cache to ensure it reflects the changes
    clearInventoryItemsCache();
    
    renderMasterItems();
    renderBranchList();
    
    // Close modal
    closeAddMultipleItemsModal();
    
    // Show success message
    showSyncIndicator(`Successfully added ${itemsToAdd.length} items`, 'success');
    
  } catch (error) {
    console.error('Error adding bulk items:', error);
    alert('Error adding items. Please try again.');
  } finally {
    // Reset button state
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save All Items';
  }
}


async function loadQuantitiesForBranch(branch, date) {
  try {
    const dateStr = getDateKey(date);
    const docRef = doc(db, 'inventory-quantities', branch, 'daily-quantities', dateStr);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      const quantities = data.quantities || {};
      
      // Convert to the format expected by the dashboard
      const result = {};
      Object.keys(quantities).forEach(itemId => {
        const itemQuantities = quantities[itemId];
        if (itemQuantities.closing && itemQuantities.closing.checked) {
          result[itemId] = {
            closing: itemQuantities.closing.value
          };
        }
      });
      
      return result;
    }
    return {};
  } catch (error) {
    console.error('Error loading quantities:', error);
    return {};
  }
}

function getRestockLevelForBranch(masterItem, branch) {
  // Check for branch-specific override first
  if (masterItem.branchOverrides && masterItem.branchOverrides[branch]) {
    return masterItem.branchOverrides[branch].restockLevel || 0;
  }
  
  // Fall back to default restock level
  return masterItem.restockAmount || 0;
}


// Global functions for inline handlers
window.toggleDashboardCategoryCollapse = toggleDashboardCategoryCollapse;
window.selectDashboardDate = selectDashboardDate;
window.deleteBulkRow = deleteBulkRow;
