import { db } from './firebase-inventory.js';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {
  startOfWeekMonday,
  getDateKey,
  lastCompleteWeekStart,
  lastCompleteWeekStarts,
  weekDates,
  planWeekStart,
  planWeekDates,
  sliceOfPlanWeek,
  coverageDatesForHorizon,
  defaultHorizonForToday,
  computeProjectedNeed,
  computeSuggestedOrder,
  upliftCensoredPattern,
  isCensoredDay,
  pickLatestStock,
  rollForwardStock,
  countAgeDays,
  computeRunOutDate,
  formatDateRange,
  horizonLabel,
  migrateStoredHorizon,
  averageWeekdayPatterns,
  restockLookbackDates,
  suggestRestockFromUsage,
  DEFAULT_LEAD_TIME_DAYS,
  DEFAULT_BUFFER_PCT,
  STOCK_LOOKBACK_DAYS,
  addDays
} from './shared/forecast.js?v=105';
import {
  buildOrderViewSnapshot as buildOrderViewSnapshotCore,
  fetchOrderViewQuantities as fetchOrderViewQuantitiesCore,
  setCategoryOrderMap,
} from './shared/order-view-feed.js?v=105';
import {
  buildCategoryOrderMap,
  compareCategoryNames,
  compareItemsByCategoryOrder,
  uniqueSortedCategoryNames,
} from './shared/category-order.js?v=105';

console.log('=== INVENTORY BUILDER LOADED - VERSION 99 (branch restock edit/suggest) ===');

// Global state - CACHE BUST: v98
let masterItems = [];
let categories = [];
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
let orderViewCollapsedCategories = JSON.parse(localStorage.getItem('order-view-collapsed-categories') || '[]');
let orderViewNeedsOrderOnly = localStorage.getItem('order-view-needs-order-only') !== '0';
let orderViewExpandedItems = new Set();
/** Last successful Order View payload so toggles can re-render without refetching */
let lastOrderViewSnapshot = null;
/** branch â†’ dateStr â†’ daily quantities (avoids refetching unchanged weeks) */
let orderViewQuantityCache = {};
let orderViewLoadGen = 0;
let isFilteringLowStocks = false;

// Weekly View state
let weeklyBranch = localStorage.getItem('weekly-selected-branch') || 'podium';
let weeklyDate = (() => {
  const saved = localStorage.getItem('weekly-selected-date');
  if (saved) {
    const date = new Date(saved);
    if (!isNaN(date.getTime())) return startOfWeekMonday(date);
  }
  return startOfWeekMonday(new Date()); // Default to current week
})();
let weeklyData = {}; // Will store 7 days of usage data
let weeklySalesByDate = {}; // dateKey -> total sales number, or null if none
let weeklyQuantityType = localStorage.getItem('weekly-quantity-type') || 'used'; // 'used', 'closing', or 'movement'
const validWeeklyQuantityTypes = new Set(['used', 'closing', 'movement']);
if (!validWeeklyQuantityTypes.has(weeklyQuantityType)) {
  weeklyQuantityType = 'used';
  localStorage.setItem('weekly-quantity-type', weeklyQuantityType);
}
let isWeeklyDatePickerActive = false; // Track if weekly date picker is active
let dashboardLoading = false; // Track if dashboard is currently loading data
let isMovingItems = false; // Track if we're currently moving items to prevent background sync override
let isTogglingBranch = false; // Track if we're currently toggling branch enabled status to prevent background sync override
let forceDashboardRefresh = false; // Force dashboard to load fresh data

// Replenishment - coverage windows + latest counts (not Weekly View picker)
const ORDER_VIEW_STORAGE_BRANCH_SELECTION = 'order-view-branch-selection';
const ORDER_VIEW_STORAGE_SCOPE_LEGACY = 'order-view-stock-scope';
const ORDER_VIEW_STORAGE_BASELINE = 'order-view-usage-baseline';
const ORDER_VIEW_STORAGE_HORIZON = 'order-view-horizon';
const ORDER_VIEW_STORAGE_BUFFER = 'order-view-demand-buffer';
const ORDER_VIEW_STORAGE_NEEDS_ORDER_ONLY = 'order-view-needs-order-only';
const ORDER_VIEW_HUGE_VALUE_THRESHOLD = 1_000_000;
const validOrderBaselines = new Set(['prev-week', 'two-weeks-ago', 'rolling-avg']);
const validOrderHorizons = new Set(['week', 'wave1', 'wave2']);

/** Branch keys selected in Order View (multi-select); persisted as JSON */
let orderViewBranchSelection = [];
let orderUsageBaseline = localStorage.getItem(ORDER_VIEW_STORAGE_BASELINE) || 'prev-week';
const storedOrderHorizon = localStorage.getItem(ORDER_VIEW_STORAGE_HORIZON);
let orderHorizon = migrateStoredHorizon(storedOrderHorizon, new Date());
if (!storedOrderHorizon || !validOrderHorizons.has(orderHorizon)) {
  orderHorizon = defaultHorizonForToday(new Date());
}
let orderDemandBuffer = localStorage.getItem(ORDER_VIEW_STORAGE_BUFFER) !== '0';
if (!validOrderBaselines.has(orderUsageBaseline)) orderUsageBaseline = 'prev-week';
if (!validOrderHorizons.has(orderHorizon)) orderHorizon = defaultHorizonForToday(new Date());

function currentCategoryOrderMap() {
  return buildCategoryOrderMap(categories, masterItems.length ? masterItems : dashboardItems);
}

function syncSharedCategoryOrderMap() {
  setCategoryOrderMap(currentCategoryOrderMap());
}

/** Same category + display order as Master Items (`categories` collection). */
function compareMasterItemsDashboardOrder(a, b) {
  return compareItemsByCategoryOrder(a, b, currentCategoryOrderMap());
}

function compareOrderViewMasterItems(a, b) {
  return compareItemsByCategoryOrder(a, b, currentCategoryOrderMap());
}

function compareCategoryNamesDashboardOrder(nameA, nameB) {
  return compareCategoryNames(nameA, nameB, currentCategoryOrderMap());
}

function syncOrderViewBranchSelectionFromStorage() {
  let fromJson = false;
  const raw = localStorage.getItem(ORDER_VIEW_STORAGE_BRANCH_SELECTION);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        orderViewBranchSelection = [...new Set(arr.filter(b => typeof b === 'string' && availableBranches.includes(b)))];
        fromJson = true;
      }
    } catch (_) {}
  }
  if (!fromJson || orderViewBranchSelection.length === 0) {
    const legacy = localStorage.getItem(ORDER_VIEW_STORAGE_SCOPE_LEGACY);
    if (legacy && legacy !== 'all' && availableBranches.includes(legacy)) {
      orderViewBranchSelection = [legacy];
    } else {
      orderViewBranchSelection = [...availableBranches];
    }
    localStorage.setItem(ORDER_VIEW_STORAGE_BRANCH_SELECTION, JSON.stringify(orderViewBranchSelection));
  }
}

function saveOrderViewBranchSelection() {
  orderViewBranchSelection = [...new Set(orderViewBranchSelection.filter(b => availableBranches.includes(b)))];
  localStorage.setItem(ORDER_VIEW_STORAGE_BRANCH_SELECTION, JSON.stringify(orderViewBranchSelection));
}

function updateOrderViewLocationsSummary() {
  const sum = document.getElementById('orderViewLocationsSummary');
  if (!sum) return;
  syncOrderViewBranchSelectionFromStorage();
  const n = orderViewBranchSelection.length;
  const total = availableBranches.length;
  if (n === 0) {
    sum.textContent = 'Choose locations...';
  } else if (n === total) {
    sum.textContent = 'All locations';
  } else if (n <= 2) {
    sum.textContent = orderViewBranchSelection.map(b => getBranchDisplayName(b)).join(' + ');
  } else {
    sum.textContent = `${n} locations selected`;
  }
}

function renderOrderViewBranchCheckboxes() {
  const wrap = document.getElementById('orderViewBranchFilters');
  if (!wrap) return;
  syncOrderViewBranchSelectionFromStorage();
  const boxes = availableBranches.map(b => {
    const checked = orderViewBranchSelection.includes(b) ? 'checked' : '';
    const safeName = String(getBranchDisplayName(b)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return `<label class="order-view-branch-label"><input type="checkbox" class="order-view-branch-cb" value="${b}" ${checked}/> ${safeName}</label>`;
  }).join('');
  const actions = '<div class="order-view-branch-actions"><button type="button" class="btn btn-light btn-small" id="orderViewBranchesAll">All</button><button type="button" class="btn btn-light btn-small" id="orderViewBranchesClear">None</button></div>';
  wrap.innerHTML = boxes + actions;
  updateOrderViewLocationsSummary();
}

function baselineWeekStartsFor(today) {
  if (orderUsageBaseline === 'rolling-avg') return lastCompleteWeekStarts(today, 4);
  if (orderUsageBaseline === 'two-weeks-ago') return [lastCompleteWeekStart(today, 2)];
  return [lastCompleteWeekStart(today, 1)];
}

function refreshOrderViewControls(today = new Date()) {
  const weekDatesList = planWeekDates(today);
  const weekTitle = document.getElementById('orderViewWeekTitle');
  if (weekTitle) {
    weekTitle.textContent = `Week of ${formatDateRange(weekDatesList[0], weekDatesList[6])}`;
  }

  const baselineEl = document.getElementById('orderUsageBaseline');
  if (baselineEl) {
    const lastWeekStart = lastCompleteWeekStart(today, 1);
    const twoAgoStart = lastCompleteWeekStart(today, 2);
    const fourStarts = lastCompleteWeekStarts(today, 4);
    const fourOldest = fourStarts[fourStarts.length - 1];
    const fourNewestEnd = addDays(fourStarts[0], 6);
    for (const opt of baselineEl.options) {
      if (opt.value === 'prev-week') {
        opt.textContent = `Last week (${formatDateRange(lastWeekStart, addDays(lastWeekStart, 6))})`;
      } else if (opt.value === 'two-weeks-ago') {
        opt.textContent = `2 weeks ago (${formatDateRange(twoAgoStart, addDays(twoAgoStart, 6))})`;
      } else if (opt.value === 'rolling-avg') {
        opt.textContent = `4-week average (${formatDateRange(fourOldest, fourNewestEnd)})`;
      }
    }
    if (validOrderBaselines.has(orderUsageBaseline)) baselineEl.value = orderUsageBaseline;
  }

  const horizonEl = document.getElementById('orderHorizon');
  if (horizonEl) {
    const weekStart = planWeekStart(today);
    for (const opt of horizonEl.options) {
      if (!validOrderHorizons.has(opt.value)) continue;
      const slice = sliceOfPlanWeek(weekStart, opt.value);
      const range = slice.length ? formatDateRange(slice[0], slice[slice.length - 1]) : '-';
      opt.textContent = `${horizonLabel(opt.value)} (${range})`;
    }
    if (validOrderHorizons.has(orderHorizon)) horizonEl.value = orderHorizon;
  }

  document.querySelectorAll('[data-order-filter]').forEach(btn => {
    const on = btn.dataset.orderFilter === 'to-order' ? orderViewNeedsOrderOnly : !orderViewNeedsOrderOnly;
    btn.classList.toggle('active', on);
  });
  const bufferBtn = document.getElementById('orderDemandBufferBtn');
  if (bufferBtn) bufferBtn.classList.toggle('active', orderDemandBuffer);
}

console.log('Dashboard state initialized:', {
  dashboardBranch,
  dashboardDate: dashboardDate.toDateString(),
  dashboardItemsLength: dashboardItems.length,
  dashboardCollapsedCategories
});

// UI state
let branchEditMode = false;
let pendingBranchRestocks = {};
let suggestedBranchRestockIds = new Set();
let branchRestockSaving = false;
let branchRestockUsageCache = null;
let masterEditMode = false; // Changed from reorder mode to general edit mode
let masterSort = { key: 'displayOrder', dir: 'asc' }; // default to saved order
let branchSort = { key: 'displayOrder', dir: 'asc' };
let currentTask = 'dashboard';
const INVENTORY_TASKS = new Set(['dashboard', 'weekly-view', 'order-view']);
const SETUP_TASKS = new Set(['master-items', 'branch-list']);
const STORAGE_ADMIN_MODE = 'inventory-admin-mode';
const STORAGE_TASK_INVENTORY = 'inventory-admin-task-inventory';
const STORAGE_TASK_SETUP = 'inventory-admin-task-setup';
let currentMode = 'inventory';

function taskModeFor(task) {
  return SETUP_TASKS.has(task) ? 'setup' : 'inventory';
}

const SETTINGS_NAV_HTML = `<div class="admin-nav-menu" id="adminNavMenu">
  <button type="button" class="admin-nav-menu-btn" id="settingsNavBtn" aria-haspopup="menu" aria-expanded="false">
    Settings
    <span class="admin-nav-menu-caret" aria-hidden="true">&#9662;</span>
  </button>
  <div class="admin-nav-menu-panel" id="adminNavMenuPanel" role="menu" hidden>
    <button type="button" class="admin-nav-menu-item task-nav-btn" data-task="master-items" role="menuitem">Master Items</button>
    <button type="button" class="admin-nav-menu-item task-nav-btn" data-task="branch-list" role="menuitem">Branch List</button>
  </div>
</div>`;

function ensureSettingsNav() {
  const bar = document.querySelector('.admin-nav-bar');
  if (!bar) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = SETTINGS_NAV_HTML.trim();
  const next = wrap.firstElementChild;
  const existing = document.getElementById('adminNavMenu');
  if (existing) existing.replaceWith(next);
  else bar.appendChild(next);
  document.querySelectorAll('.mode-nav-btn').forEach(el => el.remove());
}

function setSettingsMenuOpen(open) {
  const menu = document.getElementById('adminNavMenu');
  const btn = document.getElementById('settingsNavBtn');
  const panel = document.getElementById('adminNavMenuPanel');
  if (!menu || !btn || !panel) return;
  menu.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  panel.hidden = !open;
}

function updateAdminNavUI(task, mode) {
  document.querySelectorAll('.task-navigation').forEach(nav => {
    nav.hidden = false;
  });
  document.querySelectorAll('.task-nav-btn, .admin-nav-menu-item').forEach(b => {
    b.classList.toggle('active', b.dataset.task === task);
  });
  const settingsBtn = document.getElementById('settingsNavBtn');
  if (settingsBtn) settingsBtn.classList.toggle('active', mode === 'setup');
  setSettingsMenuOpen(false);
}

function switchMode(mode, preferredTask = null) {
  currentMode = mode;
  localStorage.setItem(STORAGE_ADMIN_MODE, mode);
  const task =
    preferredTask ||
    (mode === 'setup'
      ? localStorage.getItem(STORAGE_TASK_SETUP) || 'master-items'
      : localStorage.getItem(STORAGE_TASK_INVENTORY) || 'dashboard');
  switchToTask(task, { skipModeCheck: true });
}

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

/**
 * Same usage math as Weekly View / dashboard (opening + added âˆ’ closing when closing checked).
 */
function computeDayUsageFromItemQuantities(itemQuantities) {
  if (!itemQuantities || typeof itemQuantities !== 'object') {
    return { used: 0, closing: 0, hasClosingData: false, added: 0, removed: 0 };
  }
  const opening = itemQuantities.opening?.value || 0;
  const closing = itemQuantities.closing?.value || 0;
  const added = itemQuantities.added?.value || 0;
  let removed = 0;
  if (Array.isArray(itemQuantities.adjustments)) {
    itemQuantities.adjustments.forEach(adj => {
      const value = Number(adj?.value) || 0;
      if (adj?.reason === 'pulled-out' || adj?.reason === 'wastage') {
        removed += value;
      }
    });
  }
  const hasClosingData = itemQuantities.closing && itemQuantities.closing.checked;
  const used = hasClosingData ? opening + added - closing : 0;
  return { used, closing, hasClosingData, added, removed };
}

async function fetchDailyQuantitiesForBranchDate(branch, dateStr) {
  const docRef = doc(db, 'inventory-quantities', branch, 'daily-quantities', dateStr);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return {};
  return docSnap.data().quantities || {};
}

function isDashboardToday(date) {
  return getDateKey(date) === getDateKey(new Date());
}

function dashboardHasOpeningLogged(quantities, items) {
  if (!items?.length) return false;
  return items.some(item => quantities[item.id]?.opening?.checked);
}

function dashboardHasAnyLoggedQuantities(quantities, items) {
  if (!items?.length) return false;
  return items.some(item => {
    const q = quantities[item.id];
    if (!q) return false;
    return q.opening?.checked || q.closing?.checked;
  });
}

function applyDashboardQuantitiesFromRaw(quantities) {
  window.dashboardRawQuantities = quantities || {};
  openingQuantities = {};
  closingQuantities = {};
  addedQuantities = {};
  deliveryQuantities = {};
  pullOutQuantities = {};
  wastageQuantities = {};

  Object.keys(quantities || {}).forEach(itemId => {
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
}

/** If today has no opening logged yet, use the previous day that has data. */
async function resolveDashboardQuantitiesDate(items) {
  let date = new Date(dashboardDate);
  let quantities = await fetchDailyQuantitiesForBranchDate(dashboardBranch, getDateKey(date));
  let usedFallback = false;

  if (isDashboardToday(date) && !dashboardHasOpeningLogged(quantities, items)) {
    const prevDate = addDays(date, -1);
    const prevQuantities = await fetchDailyQuantitiesForBranchDate(dashboardBranch, getDateKey(prevDate));
    if (dashboardHasAnyLoggedQuantities(prevQuantities, items)) {
      date = prevDate;
      quantities = prevQuantities;
      usedFallback = true;
    }
  }

  return { date, quantities, usedFallback };
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
  const savedMode = localStorage.getItem(STORAGE_ADMIN_MODE) || 'inventory';
  const savedTask =
    savedMode === 'setup'
      ? localStorage.getItem(STORAGE_TASK_SETUP) || 'master-items'
      : localStorage.getItem(STORAGE_TASK_INVENTORY) || 'dashboard';
  currentMode = savedMode;
  switchToTask(savedTask, { skipModeCheck: true });
  const switchEnd = performance.now();
  console.log(`Switched to ${savedTask} task in: ${(switchEnd - switchStart).toFixed(2)}ms`);
  // Dashboard data will be loaded by switchToTask
  console.log('Dashboard initialization complete');
  
  const totalInitTime = performance.now() - initStart;
  console.log(`ðŸš€ Total initialization time: ${totalInitTime.toFixed(2)}ms`);
});

async function initializeBuilder() {
  await loadBranches();
  await loadMasterItems();
  await loadCategories();
  // No longer need to load branch assignments - using new structure
  // Don't render master items here - let the task switching handle it
  updateBranchEditControlsState();
  updateMasterEditControlsState();
  refreshCurrentInventoryView();
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

  renderOrderViewBranchCheckboxes();
  refreshOrderViewControls();
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
      console.log('ðŸ” GLOBAL DEBUG: Checkbox change detected');
      console.log('ðŸ” GLOBAL DEBUG: Checkbox element:', e.target);
      console.log('ðŸ” GLOBAL DEBUG: Checkbox checked:', e.target.checked);
      console.log('ðŸ” GLOBAL DEBUG: Checkbox onchange attribute:', e.target.getAttribute('onchange'));
      
      // Check if the onchange function exists
      const onchangeAttr = e.target.getAttribute('onchange');
      if (!onchangeAttr) {
        console.error('ðŸ” GLOBAL DEBUG: No onchange attribute found on checkbox!');
      }
    }
  });

  ensureSettingsNav();
  document.querySelectorAll('.task-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchToTask(btn.dataset.task));
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#settingsNavBtn')) {
      e.preventDefault();
      const menu = document.getElementById('adminNavMenu');
      setSettingsMenuOpen(!menu?.classList.contains('open'));
      return;
    }
    if (!e.target.closest('#adminNavMenu')) setSettingsMenuOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setSettingsMenuOpen(false);
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
  if (addCategoryBtn) addCategoryBtn.addEventListener('click', () => openCategoryManageModal());
  setupCategoryManageModal();

  // Branch list controls
  const branchListSelector = document.getElementById('branchListSelector');
  if (branchListSelector) branchListSelector.addEventListener('change', e => {
    if (!confirmDiscardUnsavedBranchRestocks()) {
      e.target.value = selectedBranch;
      return;
    }
    clearPendingBranchRestocks();
    branchRestockUsageCache = null;
    selectedBranch = e.target.value;
    renderBranchList();
  });
  const branchSearch = document.getElementById('branchSearch');
  if (branchSearch) branchSearch.addEventListener('input', renderBranchList);
  const selectAllBtn = document.getElementById('selectAllBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const toggleEditBtn = document.getElementById('toggleBranchEditBtn');
  if (toggleEditBtn) toggleEditBtn.addEventListener('click', () => {
    if (branchEditMode) {
      if (!confirmDiscardUnsavedBranchRestocks()) return;
      branchEditMode = false;
      clearPendingBranchRestocks();
    } else {
      branchEditMode = true;
      clearPendingBranchRestocks();
    }
    updateBranchEditControlsState();
    renderBranchList();
  });
  const saveRestockBtn = document.getElementById('saveBranchRestockBtn');
  if (saveRestockBtn) saveRestockBtn.addEventListener('click', () => {
    savePendingBranchRestocks().catch((err) => {
      console.error('Error saving restock values:', err);
      showSyncIndicator('Could not save restock values', 'error');
    });
  });
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

  // Weekly quantity type segmented control
  const weeklyQuantityBtns = document.querySelectorAll('[data-quantity-type]');
  weeklyQuantityBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      weeklyQuantityType = e.currentTarget.dataset.quantityType;
      if (!validWeeklyQuantityTypes.has(weeklyQuantityType)) {
        weeklyQuantityType = 'used';
      }
      localStorage.setItem('weekly-quantity-type', weeklyQuantityType);
      
      // Update button states
      weeklyQuantityBtns.forEach(b => {
        b.classList.toggle('active', b.dataset.quantityType === weeklyQuantityType);
      });
      
      await loadWeeklyViewData();
    });
  });

  const orderViewTask = document.getElementById('order-view-task');
  if (orderViewTask) {
    orderViewTask.addEventListener('change', e => {
      if (!e.target.classList.contains('order-view-branch-cb')) return;
      const wrap = document.getElementById('orderViewBranchFilters');
      if (!wrap) return;
      orderViewBranchSelection = Array.from(wrap.querySelectorAll('.order-view-branch-cb:checked')).map(cb => cb.value);
      saveOrderViewBranchSelection();
      updateOrderViewLocationsSummary();
      if (currentTask === 'order-view') loadOrderViewData();
    });
    orderViewTask.addEventListener('click', e => {
      if (e.target.id === 'orderViewBranchesAll') {
        orderViewBranchSelection = [...availableBranches];
        saveOrderViewBranchSelection();
        renderOrderViewBranchCheckboxes();
        if (currentTask === 'order-view') loadOrderViewData();
      }
      if (e.target.id === 'orderViewBranchesClear') {
        orderViewBranchSelection = [];
        saveOrderViewBranchSelection();
        renderOrderViewBranchCheckboxes();
        if (currentTask === 'order-view') loadOrderViewData();
      }
    });
  }
  const orderUsageBaselineEl = document.getElementById('orderUsageBaseline');
  if (orderUsageBaselineEl) {
    orderUsageBaselineEl.addEventListener('change', (e) => {
      const v = e.target.value;
      if (!validOrderBaselines.has(v)) return;
      orderUsageBaseline = v;
      localStorage.setItem(ORDER_VIEW_STORAGE_BASELINE, orderUsageBaseline);
      if (currentTask === 'order-view') loadOrderViewData();
    });
  }
  const orderHorizonEl = document.getElementById('orderHorizon');
  if (orderHorizonEl) {
    orderHorizonEl.addEventListener('change', (e) => {
      const v = e.target.value;
      if (!validOrderHorizons.has(v)) return;
      orderHorizon = v;
      localStorage.setItem(ORDER_VIEW_STORAGE_HORIZON, orderHorizon);
      if (currentTask === 'order-view') reapplyOrderViewHorizon();
    });
  }
  document.querySelectorAll('[data-order-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      orderViewNeedsOrderOnly = btn.dataset.orderFilter === 'to-order';
      localStorage.setItem(ORDER_VIEW_STORAGE_NEEDS_ORDER_ONLY, orderViewNeedsOrderOnly ? '1' : '0');
      refreshOrderViewControls();
      if (lastOrderViewSnapshot) renderOrderView(lastOrderViewSnapshot);
      else if (currentTask === 'order-view') loadOrderViewData();
    });
  });
  const orderDemandBufferBtn = document.getElementById('orderDemandBufferBtn');
  if (orderDemandBufferBtn) {
    orderDemandBufferBtn.addEventListener('click', () => {
      orderDemandBuffer = !orderDemandBuffer;
      localStorage.setItem(ORDER_VIEW_STORAGE_BUFFER, orderDemandBuffer ? '1' : '0');
      reapplyOrderViewBuffer();
    });
  }
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

function hasUnsavedBranchRestocks() {
  return Object.keys(pendingBranchRestocks).length > 0;
}

function clearPendingBranchRestocks() {
  pendingBranchRestocks = {};
  suggestedBranchRestockIds = new Set();
}

function confirmDiscardUnsavedBranchRestocks() {
  if (!hasUnsavedBranchRestocks()) return true;
  return window.confirm('Discard unsaved restock changes?');
}

function displayedBranchRestock(item, branch = selectedBranch) {
  if (pendingBranchRestocks[item.id] !== undefined) return pendingBranchRestocks[item.id];
  const override = item.branchOverrides?.[branch]?.restockLevel;
  if (override !== undefined) return override;
  return item.restockAmount || 0;
}

function updateBranchEditControlsState() {
  const disabled = !branchEditMode;
  const selectAllBtn = document.getElementById('selectAllBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const editControls = document.querySelector('.edit-controls');
  const toggleEditBtn = document.getElementById('toggleBranchEditBtn');
  const saveBtn = document.getElementById('saveBranchRestockBtn');
  
  if (selectAllBtn) selectAllBtn.classList.toggle('btn-disabled', disabled);
  if (clearAllBtn) clearAllBtn.classList.toggle('btn-disabled', disabled);
  if (editControls) editControls.style.display = branchEditMode ? 'flex' : 'none';
  if (toggleEditBtn) {
    toggleEditBtn.textContent = branchEditMode ? 'Done' : 'Edit';
    toggleEditBtn.classList.toggle('btn-primary', !branchEditMode);
    toggleEditBtn.classList.toggle('btn-secondary', branchEditMode);
  }
  if (saveBtn) {
    saveBtn.hidden = !branchEditMode;
    saveBtn.disabled = branchRestockSaving || !hasUnsavedBranchRestocks();
    saveBtn.textContent = branchRestockSaving ? 'Saving…' : 'Save';
  }
}

function updateMasterEditControlsState() {
  const editBtn = document.getElementById('toggleMasterEditBtn');
  const addItemBtn = document.getElementById('addMasterItemBtn');
  const addCategoryBtn = document.getElementById('addCategoryBtn');
  
  if (editBtn) editBtn.textContent = masterEditMode ? 'Done' : 'Rearrange';
  if (addItemBtn) addItemBtn.disabled = masterEditMode;
  if (addCategoryBtn) addCategoryBtn.disabled = false;
  
  // Toggle master-edit-mode class on body
  document.body.classList.toggle('master-edit-mode', masterEditMode);
  console.log('Master edit mode:', masterEditMode, 'Body class:', document.body.classList.contains('master-edit-mode'));
  
  renderMasterItems();
}

function switchToTask(task, { skipModeCheck = false } = {}) {
  console.log('=== SWITCH TO TASK ===', task);
  // Check if we're in edit mode and warn user
  if ((masterEditMode || branchEditMode) && task !== currentTask) {
    showEditModeWarning(task);
    return;
  }

  const mode = taskModeFor(task);
  if (!skipModeCheck && mode !== currentMode) {
    switchMode(mode, task);
    return;
  }

  currentTask = task;
  currentMode = mode;
  localStorage.setItem(STORAGE_ADMIN_MODE, mode);
  if (mode === 'setup') localStorage.setItem(STORAGE_TASK_SETUP, task);
  else localStorage.setItem(STORAGE_TASK_INVENTORY, task);
  updateAdminNavUI(task, mode);
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
  if (task === 'order-view') {
    loadOrderViewData();
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

async function finishEditingAndSwitch(newTask) {
  if (masterEditMode) {
    masterEditMode = false;
    updateMasterEditControlsState();
    renderMasterItems();
  }
  if (branchEditMode) {
    try {
      await savePendingBranchRestocks();
    } catch (err) {
      console.error('Error saving restock values before switch:', err);
      showSyncIndicator('Could not save restock values', 'error');
      return;
    }
    branchEditMode = false;
    clearPendingBranchRestocks();
    updateBranchEditControlsState();
    renderBranchList();
  }
  
  closeEditWarning();
  switchToTask(newTask);
}

function cancelEditingAndSwitch(newTask) {
  if (masterEditMode) {
    masterEditMode = false;
    updateMasterEditControlsState();
    renderMasterItems();
  }
  if (branchEditMode) {
    branchEditMode = false;
    clearPendingBranchRestocks();
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
      <td colspan="5">
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
    
    const catRows = (byCat[cat] || []).map((item, idx) => `
      <tr class="category-item-row" data-category="${cat}" data-item-id="${item.id}" data-category="${cat}" data-index="${idx}" ${isCollapsed ? 'style="display:none;"' : ''}>
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
    <table class="master-table" id="masterTable">
      <thead>
        <tr>
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
  console.log('ðŸ” RENDER DEBUG: Starting renderBranchList');
  
  const container = document.getElementById('branchItemsList');
  if (!container) {
    console.log('ðŸ” RENDER DEBUG: No container found');
    return;
  }
  
  const term = (document.getElementById('branchSearch')?.value || '').toLowerCase();
  console.log('ðŸ” RENDER DEBUG: Search term:', term);
  console.log('ðŸ” RENDER DEBUG: Master items count:', masterItems.length);
  console.log('ðŸ” RENDER DEBUG: Branch edit mode:', branchEditMode);
  console.log('ðŸ” RENDER DEBUG: Selected branch:', selectedBranch);
  
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
    console.log('ðŸ” RENDER DEBUG: Found duplicate item names:', duplicates);
    duplicates.forEach(dupName => {
      const duplicateItems = items.filter(item => item.name === dupName);
      console.log(`ðŸ” RENDER DEBUG: Duplicate items for "${dupName}":`, duplicateItems.map(item => ({ id: item.id, name: item.name })));
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
      <td colspan="${branchEditMode ? '6' : '5'}">
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
      const catRows = (byCat[cat] || []).map(item => {
    // Get the full master item to access all data
    const masterItem = masterItems.find(m => m.id === item.id);
    
    const currentRestockLevel = displayedBranchRestock(item, selectedBranch);
    const valueAttr = `value="${currentRestockLevel}"`;
    
    // Check if item is enabled for this branch
    // If enabledBranches doesn't exist, assume it's enabled for all branches (legacy items)
    // If enabledBranches is empty array [], it means disabled for all branches
    // If enabledBranches has values, check if current branch is included
    const isEnabled = item.enabledBranches === undefined 
      ? true  // Legacy items without enabledBranches field
      : item.enabledBranches.includes(selectedBranch);  // Check if branch is in the array

    console.log(`ðŸ” RENDER DEBUG: Item ${item.name}: enabledBranches =`, item.enabledBranches, ', selectedBranch =', selectedBranch, ', isEnabled =', isEnabled);
    console.log(`ðŸ” RENDER DEBUG: Item ${item.name}: item.id =`, item.id);

    const checkbox = branchEditMode ? `<input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="onToggleBranchEnabled('${item.id}', '${selectedBranch}', this.checked)">` : '';
    
    if (branchEditMode && (item.name === 'Iced Cups' || item.name === 'Strawless Lids')) {
      console.log(`ðŸ” RENDER DEBUG: Special item ${item.name} checkbox HTML:`, checkbox);
      console.log(`ðŸ” RENDER DEBUG: Special item ${item.name} onchange attribute:`, `onchange="onToggleBranchEnabled('${item.id}', '${selectedBranch}', this.checked)"`);
    }
    const suggestedClass = suggestedBranchRestockIds.has(item.id) ? ' suggested' : '';
    const restockCell = branchEditMode
      ? `<div class="restock-edit">
          <input type="number" class="restock-input${suggestedClass}" min="0" step="1" inputmode="numeric" ${valueAttr} data-item-id="${item.id}" oninput="onBranchRestockInput('${item.id}', this.value)">
          <button type="button" class="btn btn-secondary btn-small restock-suggest-btn" data-item-id="${item.id}" onclick="suggestBranchRestockForItem('${item.id}')">Suggest</button>
        </div>`
      : `<span class="restock-value">${formatNumberWithCommas(currentRestockLevel)}</span>`;

    const checkboxCell = branchEditMode ? `<td style="width:40px;text-align:center">${checkbox}</td>` : '';
    
    return `
      <tr class="category-item-row" data-category="${cat}" ${isCollapsed ? 'style="display:none;"' : ''}>
        ${checkboxCell}
        <td>${item.name}</td>
        <td>${item.description}</td>
        <td>${item.category}</td>
        <td>${item.unit}</td>
        <td>${restockCell}</td>
      </tr>`;
  }).join('');
    return header + catRows;
  }).join('');

  const headers = branchEditMode ? ['Include', 'Item', 'Description', 'Category', 'Unit', 'Restock'] : ['Item', 'Description', 'Category', 'Unit', 'Restock'];
  const tableClass = branchEditMode ? 'branch-table edit-mode' : 'branch-table';
  container.innerHTML = `
    <table class="${tableClass}" id="branchTable">
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

// Branch restock edits stay local until Save.

async function onMasterRestockChange(masterId, valueStr) {
  const value = Math.max(0, parseInt(valueStr, 10) || 0);
  await updateDoc(doc(db, 'inventory', '_config', 'items', masterId), { restockAmount: value });
  await loadMasterItems();
  renderMasterItems();
}

// Migration function to restructure collections
async function migrateToNewStructure() {
  console.log('ðŸ”„ Starting migration to new collection structure...');
  
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
      console.log(`âœ… Created category: ${category.name}`);
    }
    
    // 2. Migrate master-items to inventory/items
    const masterItemsSnapshot = await getDocs(collection(db, 'inventory', '_config', 'items'));
    console.log(`ðŸ“¦ Found ${masterItemsSnapshot.docs.length} items to migrate`);
    
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
      console.log(`âœ… Migrated item: ${data.name}`);
    }
    
    console.log('ðŸŽ‰ Migration completed successfully!');
    console.log('âš ï¸  You can now delete the old master-items collection');
    
  } catch (error) {
    console.error('âŒ Migration failed:', error);
  }
}

// New functions for branch-specific operations
async function onToggleBranchEnabled(masterId, branch, enabled) {
  console.log('ðŸ” TOGGLE DEBUG: Starting onToggleBranchEnabled');
  console.log('ðŸ” TOGGLE DEBUG: masterId =', masterId);
  console.log('ðŸ” TOGGLE DEBUG: branch =', branch);
  console.log('ðŸ” TOGGLE DEBUG: enabled =', enabled);
  console.log('ðŸ” TOGGLE DEBUG: isTogglingBranch before =', isTogglingBranch);
  
  const masterItem = masterItems.find(m => m.id === masterId);
  if (!masterItem) {
    console.error('ðŸ” TOGGLE DEBUG: masterItem not found for id:', masterId);
    return;
  }
  
  console.log('ðŸ” TOGGLE DEBUG: Found masterItem:', masterItem.name);
  console.log('ðŸ” TOGGLE DEBUG: Current enabledBranches =', masterItem.enabledBranches);
  console.log('ðŸ” TOGGLE DEBUG: availableBranches =', availableBranches);
  
  // Set flag to prevent background sync override
  isTogglingBranch = true;
  console.log('ðŸ” TOGGLE DEBUG: Set isTogglingBranch = true');
  
  // Handle different states of enabledBranches
  let enabledBranches;
  if (masterItem.enabledBranches === undefined) {
    // Legacy items without enabledBranches field - start with all branches
    enabledBranches = [...availableBranches];
    console.log('ðŸ” TOGGLE DEBUG: Legacy item (no enabledBranches field), starting with all branches =', enabledBranches);
  } else if (masterItem.enabledBranches.length === 0) {
    // Items with empty array [] - start with all branches (they were disabled for all)
    enabledBranches = [...availableBranches];
    console.log('ðŸ” TOGGLE DEBUG: Empty enabledBranches array, starting with all branches =', enabledBranches);
  } else {
    // Items with explicit array - use as is
    enabledBranches = [...masterItem.enabledBranches];
    console.log('ðŸ” TOGGLE DEBUG: Initial enabledBranches copy =', enabledBranches);
  }
  
  if (enabled) {
    if (!enabledBranches.includes(branch)) {
      enabledBranches.push(branch);
      console.log('ðŸ” TOGGLE DEBUG: Added branch to enabledBranches =', enabledBranches);
    } else {
      console.log('ðŸ” TOGGLE DEBUG: Branch already in enabledBranches');
    }
  } else {
    const index = enabledBranches.indexOf(branch);
    console.log('ðŸ” TOGGLE DEBUG: Index of branch to remove =', index);
    if (index > -1) {
      enabledBranches.splice(index, 1);
      console.log('ðŸ” TOGGLE DEBUG: Removed branch, new enabledBranches =', enabledBranches);
    } else {
      console.log('ðŸ” TOGGLE DEBUG: Branch not found in enabledBranches to remove');
    }
  }
  
  // Update local state immediately to prevent checkbox flickering
  const oldEnabledBranches = masterItem.enabledBranches;
  masterItem.enabledBranches = enabledBranches;
  console.log('ðŸ” TOGGLE DEBUG: Updated local state from', oldEnabledBranches, 'to', masterItem.enabledBranches);
  
  // Re-render immediately with the new state
  console.log('ðŸ” TOGGLE DEBUG: About to call renderBranchList()');
  renderBranchList();
  console.log('ðŸ” TOGGLE DEBUG: renderBranchList() completed');
  
  try {
    console.log('ðŸ” TOGGLE DEBUG: About to update Firebase with enabledBranches =', enabledBranches);
    // Update Firebase in background
    await updateDoc(doc(db, 'inventory', '_config', 'items', masterId), { enabledBranches });
    console.log('ðŸ” TOGGLE DEBUG: Firebase update successful');
    
    // Clear cache to ensure future loads get fresh data
    localStorage.removeItem('inventory-config-items-cache');
    console.log('ðŸ” TOGGLE DEBUG: Cache cleared');
  } catch (error) {
    console.error('ðŸ” TOGGLE DEBUG: Firebase update failed:', error);
    // Revert local state if Firebase update failed
    masterItem.enabledBranches = [...(masterItem.enabledBranches || availableBranches)];
    renderBranchList();
    console.log('ðŸ” TOGGLE DEBUG: Reverted local state due to Firebase error');
  } finally {
    // Clear the flag to allow background sync again
    isTogglingBranch = false;
    console.log('ðŸ” TOGGLE DEBUG: Set isTogglingBranch = false');
    console.log('ðŸ” TOGGLE DEBUG: onToggleBranchEnabled completed');
  }
}

function onBranchRestockInput(masterId, valueStr) {
  const value = Math.max(0, parseInt(valueStr, 10) || 0);
  pendingBranchRestocks[masterId] = value;
  suggestedBranchRestockIds.delete(masterId);
  const input = document.querySelector(`.restock-input[data-item-id="${masterId}"]`);
  if (input) input.classList.remove('suggested');
  updateBranchEditControlsState();
}

function nextBranchOverridesForRestock(masterItem, branch, value) {
  const branchOverrides = { ...(masterItem.branchOverrides || {}) };
  const defaultRestock = masterItem.restockAmount || 0;
  if (value === defaultRestock) {
    if (branchOverrides[branch]) {
      const next = { ...branchOverrides[branch] };
      delete next.restockLevel;
      if (Object.keys(next).length === 0) delete branchOverrides[branch];
      else branchOverrides[branch] = next;
    }
  } else {
    branchOverrides[branch] = { ...branchOverrides[branch], restockLevel: value };
  }
  return branchOverrides;
}

async function savePendingBranchRestocks() {
  if (branchRestockSaving) return;
  const entries = Object.entries(pendingBranchRestocks);
  if (entries.length === 0) return;

  branchRestockSaving = true;
  updateBranchEditControlsState();

  const previousOverrides = {};
  try {
    const writes = [];
    for (const [masterId, value] of entries) {
      const masterItem = masterItems.find((m) => m.id === masterId);
      if (!masterItem) continue;
      const savedOverride = masterItem.branchOverrides?.[selectedBranch]?.restockLevel;
      const saved = savedOverride !== undefined ? savedOverride : (masterItem.restockAmount || 0);
      if (saved === value) continue;
      previousOverrides[masterId] = masterItem.branchOverrides;
      const branchOverrides = nextBranchOverridesForRestock(masterItem, selectedBranch, value);
      masterItem.branchOverrides = branchOverrides;
      writes.push(updateDoc(doc(db, 'inventory', '_config', 'items', masterId), { branchOverrides }));
    }

    await Promise.all(writes);
    localStorage.removeItem('inventory-config-items-cache');
    clearPendingBranchRestocks();
    showSyncIndicator(writes.length ? `Saved ${writes.length} restock value${writes.length === 1 ? '' : 's'}` : 'No restock changes', 'success');
    renderBranchList();
  } catch (error) {
    console.error('Error updating branch restock levels:', error);
    Object.entries(previousOverrides).forEach(([id, overrides]) => {
      const masterItem = masterItems.find((m) => m.id === id);
      if (masterItem) masterItem.branchOverrides = overrides;
    });
    showSyncIndicator('Could not save restock values', 'error');
    throw error;
  } finally {
    branchRestockSaving = false;
    updateBranchEditControlsState();
  }
}

async function loadBranchRestockUsageDays() {
  const dateKeys = restockLookbackDates(new Date()).map((d) => getDateKey(d));
  if (
    branchRestockUsageCache
    && branchRestockUsageCache.branch === selectedBranch
    && branchRestockUsageCache.dateKeys.join() === dateKeys.join()
  ) {
    return branchRestockUsageCache.days;
  }
  const days = await Promise.all(
    dateKeys.map((dateStr) => fetchDailyQuantitiesForBranchDate(selectedBranch, dateStr))
  );
  branchRestockUsageCache = { branch: selectedBranch, dateKeys, days };
  return days;
}

async function suggestBranchRestockForItem(itemId) {
  if (!branchEditMode) return;
  const item = masterItems.find((m) => m.id === itemId);
  if (!item) return;

  const btn = document.querySelector(`.restock-suggest-btn[data-item-id="${itemId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '…';
  }

  try {
    const fetchedDays = await loadBranchRestockUsageDays();
    const dailyUsages = fetchedDays.map((quantities) => {
      const itemQuantities = quantities?.[item.id];
      if (!itemQuantities) return { used: 0, hasClosingData: false };
      const { used, hasClosingData } = computeDayUsageFromItemQuantities(itemQuantities);
      return { used, hasClosingData };
    });

    const suggested = suggestRestockFromUsage(dailyUsages);
    if (suggested == null) {
      showSyncIndicator(`No usage in the last 2 weeks for ${item.name}`, 'info');
      return;
    }

    pendingBranchRestocks[item.id] = suggested;
    suggestedBranchRestockIds.add(item.id);
    const input = document.querySelector(`.restock-input[data-item-id="${item.id}"]`);
    if (input) {
      input.value = suggested;
      input.classList.add('suggested');
    }
    updateBranchEditControlsState();
    const unit = item.unit ? ` ${item.unit}` : '';
    showSyncIndicator(`Suggested ${formatNumberWithCommas(suggested)}${unit} (2-day supply)`, 'success');
  } catch (err) {
    console.error('Error suggesting restock value:', err);
    showSyncIndicator('Could not suggest a restock value', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Suggest';
    }
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
  const root = document.getElementById('masterTable') || document.getElementById('masterItemsList');
  if (!root) return;
  root.querySelectorAll('.category-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.category-edit-controls, .category-edit-controls')) return;
      const category = header.dataset.category;
      if (category) toggleCategoryCollapse(category);
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
    
    await loadMasterItems(true, true);
    console.log('masterItems count after loadMasterItems:', masterItems.length);

    clearInventoryItemsCache();

    try {
      renderMasterItems();
      renderBranchList();
    } catch (renderErr) {
      console.error('Saved, but the list failed to refresh:', renderErr);
    }

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
  console.log('ðŸ”„ MOVE ITEM: Starting moveMasterItem:', itemId, direction);
  
  // Set flag to prevent background sync override
  isMovingItems = true;
  console.log('ðŸ”„ MOVE ITEM: Set isMovingItems = true');
  
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
  console.log('ðŸ”„ MOVE ITEM: Starting background sync to Firebase');
  syncMoveToFirebase(categoryItems, 'item');
}

// Background sync function for Firebase updates
async function syncMoveToFirebase(items, type) {
  try {
    console.log(`ðŸ”„ SYNC: Updating ${type} order in Firebase...`);
    
    const updates = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Always update displayOrder to match the current array position
      console.log(`ðŸ”„ SYNC: Updating ${item.name} displayOrder from ${item.displayOrder} to ${i}`);
      updates.push(updateDoc(doc(db, 'inventory', '_config', 'items', item.id), { displayOrder: i }));
    }
    
    console.log(`ðŸ”„ SYNC: Saving ${updates.length} updates to Firebase...`);
    await Promise.all(updates);
    console.log(`ðŸ”„ SYNC: ${type} order updated successfully in Firebase`);
    
    // No longer need to sync to separate collections - everything is in master-items now
    console.log('ðŸ”„ SYNC: Master items updated successfully');
    
    // Clear dashboard cache to ensure fresh data
    clearInventoryItemsCache();
    console.log('ðŸ”„ SYNC: Dashboard cache cleared');
  } catch (error) {
    console.error('ðŸ”„ SYNC: Background sync error:', error);
    // Could show a subtle notification here if needed
  } finally {
    // Clear the flag to allow background sync again
    isMovingItems = false;
    // Force dashboard refresh on next load
    forceDashboardRefresh = true;
    console.log('ðŸ”„ SYNC: Move operation completed, flag cleared, dashboard refresh forced');
  }
}

async function moveCategory(categoryName, direction) {
  console.log('ðŸ”„ MOVE CATEGORY: Starting moveCategory:', categoryName, direction);
  
  // Set flag to prevent background sync override
  isMovingItems = true;
  console.log('ðŸ”„ MOVE CATEGORY: Set isMovingItems = true');
  
  const orderedNames = getUniqueCategories();
  const currentIndex = orderedNames.indexOf(categoryName);
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
    if (newIndex >= orderedNames.length) {
      isMovingItems = false; // Clear flag
      return; // Already at bottom
    }
  } else {
    isMovingItems = false; // Clear flag
    return;
  }
  
  // INSTANT UI UPDATE: Swap the categories immediately
  const temp = orderedNames[currentIndex];
  orderedNames[currentIndex] = orderedNames[newIndex];
  orderedNames[newIndex] = temp;
  
  // Update categoryOrder in local masterItems array immediately
  for (let i = 0; i < orderedNames.length; i++) {
    const name = orderedNames[i];
    const categoryItems = masterItems.filter(item => item.category === name);
    for (const item of categoryItems) {
      const masterItemIndex = masterItems.findIndex(mi => mi.id === item.id);
      if (masterItemIndex !== -1) {
        masterItems[masterItemIndex].categoryOrder = i;
      }
    }
    let cat = categories.find(c => c.name === name);
    if (!cat) {
      const id = uniqueCategoryDocId(name);
      cat = { id, name, order: i };
      categories.push(cat);
    } else {
      cat.order = i;
    }
  }
  categories.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  syncSharedCategoryOrderMap();
  
  // Update cache immediately
  cacheMasterItems(masterItems);
  
  // INSTANT UI RENDER: Update the display immediately
  renderMasterItems();
  renderBranchList();
  
  // BACKGROUND SYNC: Update Firebase in the background
  console.log('ðŸ”„ MOVE CATEGORY: Starting background sync to Firebase');
  syncCategoryMoveToFirebase(orderedNames);
}

// Background sync function for category moves
async function syncCategoryMoveToFirebase(orderedNames) {
  try {
    console.log('ðŸ”„ SYNC: Updating category order in Firebase...');
    
    const updates = [];
    for (let i = 0; i < orderedNames.length; i++) {
      const categoryName = orderedNames[i];
      const categoryItems = masterItems.filter(item => item.category === categoryName);
      
      for (const item of categoryItems) {
        // Always update categoryOrder to match the current category position
        console.log(`ðŸ”„ SYNC: Updating ${item.name} categoryOrder from ${item.categoryOrder} to ${i}`);
        updates.push(updateDoc(doc(db, 'inventory', '_config', 'items', item.id), { categoryOrder: i }));
      }
      let cat = categories.find(c => c.name === categoryName);
      if (!cat) {
        const id = uniqueCategoryDocId(categoryName);
        cat = { id, name: categoryName, order: i };
        categories.push(cat);
      } else {
        cat.order = i;
      }
      updates.push(setDoc(doc(db, 'inventory', '_config', 'categories', cat.id), { name: cat.name, order: i }, { merge: true }));
    }
    
    console.log(`ðŸ”„ SYNC: Saving ${updates.length} category updates to Firebase...`);
    await Promise.all(updates);
    console.log('ðŸ”„ SYNC: Category order updated successfully in Firebase');
    
    // No longer need to sync to separate collections - everything is in master-items now
    console.log('ðŸ”„ SYNC: Master items updated successfully');
    
    // Clear dashboard cache to ensure fresh data
    clearInventoryItemsCache();
    console.log('ðŸ”„ SYNC: Dashboard cache cleared');
  } catch (error) {
    console.error('ðŸ”„ SYNC: Background sync error:', error);
    // Could show a subtle notification here if needed
  } finally {
    // Clear the flag to allow background sync again
    isMovingItems = false;
    // Force dashboard refresh on next load
    forceDashboardRefresh = true;
    console.log('ðŸ”„ SYNC: Category move operation completed, flag cleared, dashboard refresh forced');
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
function categoryDocId(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
}

function uniqueCategoryDocId(name, excludeId = null) {
  let id = categoryDocId(name);
  const taken = new Set(categories.filter(c => c.id !== excludeId).map(c => c.id));
  if (!taken.has(id)) return id;
  let n = 2;
  while (taken.has(`${id}-${n}`)) n++;
  return `${id}-${n}`;
}

function countItemsInCategory(name) {
  return masterItems.filter(i => i.category === name).length;
}

async function loadCategories() {
  try {
    const snap = await getDocs(collection(db, 'inventory', '_config', 'categories'));
    categories = snap.docs.map(d => {
      const data = d.data() || {};
      return { id: d.id, name: data.name || d.id, order: typeof data.order === 'number' ? data.order : 0 };
    });
    if (!categories.length) await seedCategoriesFromItems();
    categories.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    syncSharedCategoryOrderMap();
  } catch (err) {
    console.error('Failed to load categories', err);
    categories = [];
    syncSharedCategoryOrderMap();
  }
}

async function ensureCategoriesLoaded() {
  if (categories.length) {
    syncSharedCategoryOrderMap();
    return;
  }
  await loadCategories();
}

function refreshCurrentInventoryView() {
  if (currentTask === 'dashboard' && dashboardItems.length) renderDashboard();
  if (currentTask === 'weekly-view' && dashboardItems.length) renderWeeklyView();
  if (currentTask === 'order-view' && lastOrderViewSnapshot) renderOrderView(lastOrderViewSnapshot);
}

async function seedCategoriesFromItems() {
  const seen = new Set();
  const names = [];
  masterItems
    .slice()
    .sort((a, b) => (a.categoryOrder ?? 999) - (b.categoryOrder ?? 999) || String(a.name || '').localeCompare(String(b.name || '')))
    .forEach(item => {
      if (item.category && !seen.has(item.category)) {
        seen.add(item.category);
        names.push(item.category);
      }
    });
  categories = [];
  await Promise.all(names.map((name, order) => {
    const id = uniqueCategoryDocId(name);
    categories.push({ id, name, order });
    return setDoc(doc(db, 'inventory', '_config', 'categories', id), { name, order });
  }));
}

function getUniqueCategories() {
  const byName = new Map();
  categories.forEach(c => {
    if (c.name) byName.set(c.name, c.order);
  });
  masterItems.forEach(item => {
    if (item.category && !byName.has(item.category)) {
      byName.set(item.category, item.categoryOrder ?? 999);
    }
  });
  return Array.from(byName.entries())
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

function setCategoryManageError(msg) {
  const el = document.getElementById('categoryManageError');
  if (el) el.textContent = msg || '';
}

function openCategoryManageModal() {
  const overlay = document.getElementById('categoryManageModalOverlay');
  if (!overlay) return;
  setCategoryManageError('');
  const input = document.getElementById('newCategoryName');
  if (input) input.value = '';
  renderCategoryManageList();
  overlay.style.display = 'flex';
  input?.focus();
}

function closeCategoryManageModal() {
  const overlay = document.getElementById('categoryManageModalOverlay');
  if (overlay) overlay.style.display = 'none';
  setCategoryManageError('');
}

function renderCategoryManageList() {
  const list = document.getElementById('categoryManageList');
  if (!list) return;
  const names = getUniqueCategories();
  if (!names.length) {
    list.innerHTML = '<div style="padding:12px 0;color:#888;">No categories yet.</div>';
    return;
  }
  list.innerHTML = names.map((name, idx) => {
    const count = countItemsInCategory(name);
    const empty = count === 0;
    return `<div class="category-manage-row" data-category="${escapeHtml(name)}">
      <button type="button" class="btn btn-light btn-small" data-cat-move="up" ${idx === 0 ? 'disabled' : ''}>&#8593;</button>
      <button type="button" class="btn btn-light btn-small" data-cat-move="down" ${idx === names.length - 1 ? 'disabled' : ''}>&#8595;</button>
      <input type="text" class="category-manage-name" value="${escapeHtml(name)}">
      <span class="category-manage-count">${count} item${count === 1 ? '' : 's'}</span>
      <button type="button" class="btn btn-secondary btn-small" data-cat-save>Save</button>
      <button type="button" class="btn btn-light btn-small" data-cat-delete ${empty ? '' : 'disabled'} title="${empty ? 'Delete category' : 'Only empty categories can be deleted'}">Delete</button>
    </div>`;
  }).join('');
}

function refreshCategorySelect() {
  const categorySelect = document.getElementById('masterItemCategory');
  if (!categorySelect) return;
  const current = categorySelect.value;
  const names = getUniqueCategories();
  categorySelect.innerHTML = names.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('') + '<option value="Other">Other</option>';
  if ([...names, 'Other'].includes(current)) categorySelect.value = current;
}

function refreshCategoryUI() {
  renderCategoryManageList();
  refreshCategorySelect();
  if (currentTask === 'master-items') renderMasterItems();
  if (currentTask === 'branch-list') renderBranchList();
}

async function handleAddCategoryFromModal() {
  const input = document.getElementById('newCategoryName');
  const name = (input?.value || '').trim();
  if (!name) {
    setCategoryManageError('Enter a category name.');
    return;
  }
  if (getUniqueCategories().some(c => c.toLowerCase() === name.toLowerCase())) {
    setCategoryManageError('That category already exists.');
    return;
  }
  const order = categories.reduce((max, c) => Math.max(max, c.order), -1) + 1;
  const id = uniqueCategoryDocId(name);
  try {
    await setDoc(doc(db, 'inventory', '_config', 'categories', id), { name, order });
    categories.push({ id, name, order });
    categories.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    syncSharedCategoryOrderMap();
    if (input) input.value = '';
    setCategoryManageError('');
  } catch (err) {
    console.error(err);
    setCategoryManageError('Could not add category.');
    return;
  }
  try {
    refreshCategoryUI();
  } catch (err) {
    console.error(err);
  }
}

async function handleSaveCategoryRow(row) {
  const oldName = row.dataset.category;
  const newName = (row.querySelector('.category-manage-name')?.value || '').trim();
  if (!newName) {
    setCategoryManageError('Category name cannot be empty.');
    return;
  }
  if (newName === oldName) return;
  if (getUniqueCategories().some(c => c !== oldName && c.toLowerCase() === newName.toLowerCase())) {
    setCategoryManageError('That category already exists.');
    return;
  }
  try {
    const existing = categories.find(c => c.name === oldName);
    const order = existing?.order ?? getCategoryOrder(oldName);
    const newId = uniqueCategoryDocId(newName, existing?.id);
    await setDoc(doc(db, 'inventory', '_config', 'categories', newId), { name: newName, order });
    if (existing && existing.id !== newId) {
      try { await deleteDoc(doc(db, 'inventory', '_config', 'categories', existing.id)); } catch (_) {}
    }
    if (existing) {
      existing.id = newId;
      existing.name = newName;
    } else {
      categories.push({ id: newId, name: newName, order });
    }
    await updateCategoryName(oldName, newName);
    setCategoryManageError('');
    refreshCategoryUI();
  } catch (err) {
    console.error(err);
    setCategoryManageError('Could not rename category.');
  }
}

async function handleMoveCategory(name, direction) {
  const names = getUniqueCategories();
  const idx = names.indexOf(name);
  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= names.length) return;
  const swapped = names.slice();
  [swapped[idx], swapped[swapWith]] = [swapped[swapWith], swapped[idx]];
  try {
    await Promise.all(swapped.map(async (catName, order) => {
      let cat = categories.find(c => c.name === catName);
      if (!cat) {
        const id = uniqueCategoryDocId(catName);
        cat = { id, name: catName, order };
        categories.push(cat);
      } else {
        cat.order = order;
      }
      await setDoc(doc(db, 'inventory', '_config', 'categories', cat.id), { name: cat.name, order }, { merge: true });
    }));
    const itemsToSync = masterItems.filter(i => swapped.includes(i.category));
    await Promise.all(itemsToSync.map(item => {
      const order = swapped.indexOf(item.category);
      item.categoryOrder = order;
      return updateDoc(doc(db, 'inventory', '_config', 'items', item.id), { categoryOrder: order });
    }));
    categories.sort((x, y) => x.order - y.order || x.name.localeCompare(y.name));
    syncSharedCategoryOrderMap();
    setCategoryManageError('');
    refreshCategoryUI();
  } catch (err) {
    console.error(err);
    setCategoryManageError('Could not reorder categories.');
  }
}

async function handleDeleteCategory(name) {
  if (countItemsInCategory(name) > 0) {
    setCategoryManageError('Move or reassign items before deleting this category.');
    return;
  }
  try {
    const existing = categories.find(c => c.name === name);
    if (existing) {
      await deleteDoc(doc(db, 'inventory', '_config', 'categories', existing.id));
      categories = categories.filter(c => c.id !== existing.id);
    }
    setCategoryManageError('');
    refreshCategoryUI();
  } catch (err) {
    console.error(err);
    setCategoryManageError('Could not delete category.');
  }
}

function setupCategoryManageModal() {
  const overlay = document.getElementById('categoryManageModalOverlay');
  const closeBtn = document.getElementById('categoryManageModalClose');
  const addBtn = document.getElementById('addCategoryConfirmBtn');
  const input = document.getElementById('newCategoryName');
  const list = document.getElementById('categoryManageList');
  closeBtn?.addEventListener('click', closeCategoryManageModal);
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeCategoryManageModal();
  });
  addBtn?.addEventListener('click', handleAddCategoryFromModal);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCategoryFromModal();
    }
  });
  list?.addEventListener('click', (e) => {
    const row = e.target.closest('.category-manage-row');
    if (!row) return;
    const name = row.dataset.category;
    if (e.target.closest('[data-cat-save]')) handleSaveCategoryRow(row);
    else if (e.target.closest('[data-cat-delete]')) handleDeleteCategory(name);
    else if (e.target.closest('[data-cat-move="up"]')) handleMoveCategory(name, 'up');
    else if (e.target.closest('[data-cat-move="down"]')) handleMoveCategory(name, 'down');
  });
}


// Get category order for a specific category
function getCategoryOrder(categoryName) {
  const fromList = categories.find(c => c.name === categoryName);
  if (fromList) return fromList.order;
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
  console.log('ðŸ” MASTER ITEMS DEBUG:');
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
window.switchMode = mode => switchMode(mode);
window.switchToTask = task => switchToTask(task);
window.onToggleBranchEnabled = (id, branch, checked) => onToggleBranchEnabled(id, branch, checked);
window.onBranchRestockInput = onBranchRestockInput;
window.suggestBranchRestockForItem = suggestBranchRestockForItem;
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
window.editCategory = () => openCategoryManageModal();
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
  console.log('ðŸ§ª Testing dashboard loading...');
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
  console.log('ðŸ§ª Testing bold styling logic...');
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
  console.log('ðŸ§ª Testing cache invalidation...');
  invalidateInventoryCache();
  console.log('âœ… Cache invalidation completed');
  
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

  await ensureCategoriesLoaded();
  
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
    console.log('âœ… Loading cached inventory items instantly');
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
      console.log('âœ… Loading cached quantities for date:', getDateKey(dashboardDate));
    } else {
      // No cached quantities for this date, load from Firebase
      openingQuantities = {};
      closingQuantities = {};
      addedQuantities = {};
      console.log('âš ï¸ No cached quantities for this date, will load from Firebase');
    }
    
    const renderStart = performance.now();
    renderDashboard();
    const renderTime = performance.now() - renderStart;
    console.log(`Dashboard render took: ${renderTime.toFixed(2)}ms`);
    
    updateDashboardDateDisplay();
    dashboardLoading = false;
    
    const totalTime = performance.now() - startTime;
    console.log(`ðŸŽ‰ TOTAL CACHED LOAD TIME: ${totalTime.toFixed(2)}ms`);
    
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
    
    // Sort by category order, then display order (shared with Order View)
    dashboardItems.sort(compareMasterItemsDashboardOrder);
    
    
    const { date: resolvedDate, quantities, usedFallback } = await resolveDashboardQuantitiesDate(dashboardItems);
    if (usedFallback) {
      dashboardDate = resolvedDate;
      showSyncIndicator('Opening not logged yet - showing previous day', 'info');
    }

    applyDashboardQuantitiesFromRaw(quantities);
    
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
    if (!usedFallback) {
      showSyncIndicator('Data synced from Firebase', 'success');
    }
    
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
    await ensureCategoriesLoaded();
    if (masterItems.length === 0) {
      console.log('No master items loaded, loading them first...');
      await loadMasterItems(true);
    }
    if (dashboardItems.length === 0) {
      dashboardItems = masterItems.filter(item => isMasterItemEnabledForBranch(item, weeklyBranch));
    }
    console.log('Found', getWeeklyViewItems().length, 'inventory items for weekly view branch:', weeklyBranch);
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
    weeklySalesByDate = {};
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
          if (!itemQuantities || typeof itemQuantities !== 'object') {
            return;
          }
          const { used, closing, hasClosingData, added, removed } = computeDayUsageFromItemQuantities(itemQuantities);
          
          console.log(`Item ${itemId} on ${dateStr}: opening=${itemQuantities.opening?.value || 0}, added=${added}, removed=${removed}, closing=${closing}, hasClosingData=${hasClosingData}, used=${used}`);
          
          if (!weeklyData[itemId]) {
            weeklyData[itemId] = {};
          }
          weeklyData[itemId][dateStr] = {
            used: used,
            closing: closing,
            hasClosingData: hasClosingData,
            added: added,
            removed: removed
          };
        });
      } else {
        console.log(`No data found for ${dateStr} in document: ${weeklyBranch}_${dateStr}`);
      }
    });

    await Promise.all([...promises, fetchWeeklySalesForDates(weeklyBranch, dates)]);
    console.log('Weekly data loaded:', weeklyData);
    console.log('Weekly sales loaded:', weeklySalesByDate);
    console.log('Weekly items count:', getWeeklyViewItems().length);

    // Render the weekly view
    renderWeeklyView();

  } catch (error) {
    console.error('Error loading weekly view data:', error);
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #d32f2f;">Error loading weekly data</div>';
  }
}

/** Same rules as Dashboard item filter (enabledBranches array). */
function isMasterItemEnabledForBranch(item, branchKey) {
  if (!item) return false;
  if (item.enabledBranches === undefined) return true;
  if (item.enabledBranches.length === 0) return false;
  return item.enabledBranches.includes(branchKey);
}

function getWeeklyViewItems() {
  const source = masterItems.length ? masterItems : dashboardItems;
  return source.filter(item => isMasterItemEnabledForBranch(item, weeklyBranch));
}

function branchUsesPodiumSalesLayout(branch) {
  return branch === 'podium' || branch === 'moa';
}

/** Same total as the sales dashboard for this branch. */
function calculateBranchDailySales(data, branch) {
  if (!data) return null;
  if (branchUsesPodiumSalesLayout(branch)) {
    const walkIn = (data.cash || 0) + (data.card || 0) + (data.qr || 0) + (data.giftCard || 0);
    return walkIn + (data.grab || 0);
  }
  const hasGrabData = Object.prototype.hasOwnProperty.call(data, 'grab') && data.grab !== undefined;
  if (hasGrabData) {
    const walkIn = (data.cash || 0) + (data.gcash || 0) + (data.maya || 0) + (data.card || 0);
    return walkIn + (data.grab || 0);
  }
  const total = Number(data.totalSales);
  return Number.isFinite(total) ? total : 0;
}

function formatPeso(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '-';
  return '₱' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

async function fetchWeeklySalesForDates(branch, dates) {
  const byDate = {};
  await Promise.all(dates.map(async (date) => {
    const dateStr = getDateKey(date);
    try {
      const snap = await getDoc(doc(db, 'sales-data', branch, 'daily', dateStr));
      byDate[dateStr] = snap.exists() ? calculateBranchDailySales(snap.data(), branch) : null;
    } catch (err) {
      console.error('Failed to load daily sales for', dateStr, err);
      byDate[dateStr] = null;
    }
  }));
  weeklySalesByDate = byDate;
}

function buildWeeklySalesRow(dates, includeTotal) {
  const cells = ['Total Daily Sales', ''];
  let weekTotal = 0;
  let hasAny = false;
  dates.forEach((date) => {
    const amount = weeklySalesByDate[getDateKey(date)];
    if (amount == null) {
      cells.push('-');
    } else {
      hasAny = true;
      weekTotal += amount;
      cells.push(formatPeso(amount));
    }
  });
  if (includeTotal) cells.push(hasAny ? formatPeso(weekTotal) : '-');
  return { type: 'sales-total', cells };
}

function usagePatternForWeeks(fetched, branch, itemId, weekStarts) {
  const weekResults = weekStarts.map(weekStart => {
    const dates = weekDates(weekStart);
    const used = [];
    const censored = [];
    const hasClosing = [];
    for (let i = 0; i < 7; i++) {
      const iq = fetched[branch]?.[getDateKey(dates[i])]?.[itemId];
      const day = computeDayUsageFromItemQuantities(iq);
      used.push(day.used);
      censored.push(isCensoredDay(day));
      hasClosing.push(day.hasClosingData);
    }
    const uplifted = upliftCensoredPattern(used, censored);
    return {
      used,
      censored,
      hasClosing,
      recordedTotal: used.reduce((a, b) => a + (Number(b) || 0), 0),
      ...uplifted
    };
  });
  if (weekResults.length === 1) return weekResults[0];
  const pattern = averageWeekdayPatterns(weekResults.map(w => w.pattern));
  return {
    used: pattern,
    censored: weekResults.reduce((acc, w) => acc.map((c, i) => c || w.censored[i]), [false, false, false, false, false, false, false]),
    hasClosing: weekResults.reduce((acc, w) => acc.map((c, i) => c || w.hasClosing[i]), [false, false, false, false, false, false, false]),
    recordedTotal: pattern.reduce((a, b) => a + (Number(b) || 0), 0),
    pattern,
    zeroDays: Math.max(0, ...weekResults.map(w => w.zeroDays || 0)),
    uplifted: weekResults.some(w => w.uplifted)
  };
}

function filterOrderViewItems(items, selectedBranches) {
  if (!selectedBranches || selectedBranches.length === 0) return [];
  return items.filter(item => selectedBranches.some(b => isMasterItemEnabledForBranch(item, b)));
}

function orderViewFormatQty(n, item) {
  const u = item.unit ? ` ${item.unit}` : '';
  const num = Number(n);
  if (!Number.isFinite(num)) return `0${u}`;
  // Averages / buffers produce float junk (168.0208); display cleanly.
  const unit = String(item?.unit || '').toLowerCase().trim();
  const wholeUnit = /^(pcs|pc|ea|each|ct|count|bag|bags|box|boxes|pack|packs|bottle|bottles|cup|cups)$/.test(unit);
  const rounded = wholeUnit ? Math.round(num) : Math.round(num * 10) / 10;
  return formatNumberWithCommas(rounded) + u;
}

function itemLeadTimeDays(item) {
  const n = Number(item?.leadTimeDays);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LEAD_TIME_DAYS;
}

function formatOrderViewRunOutCell(runResult, daysOut = null, today = new Date()) {
  const baseTitle =
    'Stock is the latest completed count (rolled forward with typical usage if the count is older). Daily use follows the selected baseline week (Mon-Sun), repeating every week.';
  if (runResult === null) {
    return {
      runOutPrimary: '-',
      runOutSecondary: '',
      title: `${baseTitle} No usage in baseline week and stock on hand - cannot project run-out.`
    };
  }
  if (runResult.beyondHorizon) {
    return {
      runOutPrimary: '-',
      runOutSecondary: '',
      title: `${baseTitle} Not depleted within 730-day projection (very low daily usage vs stock).`
    };
  }
  if (runResult.outNow) {
    if (daysOut != null && daysOut > 0) {
      const outSince = addDays(today, -(daysOut - 1));
      const short = outSince.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const long = outSince.toLocaleDateString(undefined, { dateStyle: 'long' });
      const daysOutLabel = daysOut === 1 ? '1 Day Out' : `${daysOut} Days Out`;
      return {
        runOutPrimary: short,
        runOutSecondary: daysOutLabel,
        title: `Out of stock for ${daysOutLabel} (since ${long}). ${baseTitle}`
      };
    }
    const title = runResult.noBaselineUsage
      ? `${baseTitle} Stock at or below zero. No usage in baseline week - often because the item was already out.`
      : `${baseTitle} Stock at or below zero.`;
    return {
      runOutPrimary: '-',
      runOutSecondary: '',
      title
    };
  }
  const { date, daysUntil } = runResult;
  const short = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const long = date.toLocaleDateString(undefined, { dateStyle: 'long' });
  const inDaysLabel = daysUntil === 1 ? 'In 1 Day' : `In ${daysUntil} Days`;
  return {
    runOutPrimary: short,
    runOutSecondary: inDaysLabel,
    title: `Projected run-out ${long} (${daysUntil === 1 ? '1 day' : `${daysUntil} days`} from today). ${baseTitle}`
  };
}

function computeDaysOutOfStock(stockByDate, today, effectiveStock) {
  if (effectiveStock > 0) return null;
  let daysOut = 0;
  for (let i = 0; i <= STOCK_LOOKBACK_DAYS; i++) {
    const date = addDays(today, -i);
    const key = getDateKey(date);
    const q = stockByDate[key];
    if (!q) break;
    const closingChecked = !!(q.closing && q.closing.checked);
    const openingChecked = !!(q.opening && q.opening.checked);
    if (closingChecked) {
      if ((Number(q.closing.value) || 0) > 0) break;
      daysOut++;
      continue;
    }
    if (openingChecked) {
      if ((Number(q.opening.value) || 0) + (Number(q.added?.value) || 0) > 0) break;
      daysOut++;
      continue;
    }
    break;
  }
  if (daysOut === 0) return 1;
  return daysOut;
}

function buildOrderViewMetrics({
  item,
  today,
  used,
  censored,
  hasClosing,
  stockPick,
  stockByDate = {},
  coverageDates,
  applyLeadTime,
  applyBuffer,
  skipUplift = false,
  zeroDaysHint = 0,
  upliftedHint = false
}) {
  const recordedTotal = used.reduce((a, b) => a + (Number(b) || 0), 0);
  const { pattern, zeroDays, uplifted } = skipUplift
    ? { pattern: used.map(n => Number(n) || 0), zeroDays: zeroDaysHint, uplifted: upliftedHint }
    : upliftCensoredPattern(used, censored);
  const needsCount = !stockPick?.date;
  const ageDays = countAgeDays(stockPick?.date, today);
  const stale = ageDays != null && ageDays >= 3;
  const countedQty = needsCount ? 0 : stockPick.qty;
  const effectiveStock = needsCount
    ? 0
    : rollForwardStock(countedQty, pattern, stockPick.date, stockPick.kind, today);

  let projected = null;
  let rawNeed = null;
  if (!needsCount) {
    const parts = computeProjectedNeed({
      pattern,
      coverageDates,
      leadTimeDays: itemLeadTimeDays(item),
      bufferPct: DEFAULT_BUFFER_PCT,
      applyLeadTime,
      applyBuffer
    });
    rawNeed = parts.rawNeed;
    projected = parts.projected;
  }

  let suggested = null;
  if (projected == null) {
    suggested = null;
  } else {
    suggested = computeSuggestedOrder(projected, effectiveStock, 0);
  }

  const runRaw = computeRunOutDate(effectiveStock, pattern, today);
  const daysOut = computeDaysOutOfStock(stockByDate, today, effectiveStock);
  const runOut = formatOrderViewRunOutCell(runRaw, daysOut, today);
  const runOutUrgent = effectiveStock <= 0;
  const runOutBeforeDelivery =
    !!runRaw &&
    (runRaw.outNow === true ||
      (typeof runRaw.daysUntil === 'number' && runRaw.daysUntil <= itemLeadTimeDays(item)));

  const warnReasons = [];
  if (needsCount) warnReasons.push('No count this period - cannot forecast from stock.');
  else if (stale) warnReasons.push(`Count is ${ageDays} days old.`);
  if (zeroDays > 0) {
    warnReasons.push(
      uplifted
        ? `Usage may be understated - at zero ${zeroDays} of 7 days; those days were filled with the rest of the week's average.`
        : `At zero ${zeroDays} of 7 days in the usage week.`
    );
  }
  if (runOutBeforeDelivery) warnReasons.push('Likely to run out before the next delivery lands.');

  const hugeValue = [recordedTotal, effectiveStock, projected, suggested].some(
    x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) >= ORDER_VIEW_HUGE_VALUE_THRESHOLD
  );

  return {
    recordedTotal,
    pattern,
    zeroDays,
    uplifted,
    needsCount,
    ageDays,
    stale,
    stockPick,
    countedQty,
    effectiveStock,
    rawNeed,
    projected,
    suggested,
    daysOut,
    missingBaseline: false,
    hugeValue,
    runOutPrimary: runOut.runOutPrimary,
    runOutSecondary: runOut.runOutSecondary,
    runOutTitle: runOut.title,
    runOutUrgent,
    warnReasons
  };
}

function reapplyOrderViewBuffer() {
  if (!lastOrderViewSnapshot?.rows?.length) {
    if (currentTask === 'order-view') loadOrderViewData();
    return;
  }

  const today = new Date();
  const applyBuffer = orderDemandBuffer;

  for (const row of lastOrderViewSnapshot.rows) {
    for (const slice of row.branches) {
      if (slice.needsCount || slice.rawNeed == null) continue;
      const projected = applyBuffer ? slice.rawNeed * (1 + DEFAULT_BUFFER_PCT) : slice.rawNeed;
      const suggested = computeSuggestedOrder(projected, slice.effectiveStock, 0);
      Object.assign(
        slice,
        decorateOrderViewQty({ ...slice, projected, suggested }, row.item, today)
      );
    }

    const branchSlices = row.branches;
    const projected = branchSlices.every(b => b.projected == null)
      ? null
      : branchSlices.reduce((s, b) => s + (Number(b.projected) || 0), 0);
    const suggested = branchSlices.every(b => b.suggested == null)
      ? null
      : branchSlices.reduce((s, b) => s + (Number(b.suggested) || 0), 0);
    const aggregate = decorateOrderViewQty(
      {
        ...row,
        projected,
        suggested,
        hugeValue: [row.recordedTotal, row.effectiveStock, projected, suggested].some(
          x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) >= ORDER_VIEW_HUGE_VALUE_THRESHOLD
        )
      },
      row.item,
      today
    );
    row.projected = aggregate.projected;
    row.suggested = aggregate.suggested;
    row.projectedDisplay = aggregate.projectedDisplay;
    row.suggestedDisplay = aggregate.suggestedDisplay;
    row.hugeValue = aggregate.hugeValue;
  }

  lastOrderViewSnapshot.meta.orderDemandBuffer = orderDemandBuffer;
  refreshOrderViewControls(today);
  renderOrderView(lastOrderViewSnapshot);
}

function pickNewestStockPick(branchSlices) {
  let best = null;
  for (const slice of branchSlices) {
    const pick = slice.stockPick;
    if (!pick?.date) continue;
    if (!best || pick.date > best.date) {
      best = pick;
      continue;
    }
    if (pick.date.getTime() === best.date.getTime() && pick.kind === 'closing' && best.kind === 'opening') {
      best = pick;
    }
  }
  return best;
}

function formatStockAsOfLabel(stockPick, ageDays) {
  if (!stockPick?.date) return null;
  const short = stockPick.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const kind = stockPick.kind === 'opening' ? 'Opening' : 'Closing';
  let label = `${short} ${kind}`;
  if (ageDays >= 2) label += ` \u00b7 ${ageDays}d ago`;
  return label;
}

function computeCommonStockAsOf(rows) {
  const labels = [];
  for (const row of rows) {
    if (row.needsCount || !row.stockPick?.date) return null;
    labels.push(formatStockAsOfLabel(row.stockPick, row.ageDays));
  }
  if (!labels.length) return null;
  return labels.every(l => l === labels[0]) ? labels[0] : null;
}

function formatOrderViewStockSub({
  needsCount,
  stockPick,
  ageDays,
  extras = [],
  commonAsOf = null
}) {
  if (needsCount || !stockPick?.date) {
    return extras.length ? extras.join(' \u00b7 ') : 'No count';
  }
  const parts = [];
  const asOf = formatStockAsOfLabel(stockPick, ageDays);
  if (asOf && asOf !== commonAsOf) parts.push(asOf);
  if (extras.length) parts.push(...extras);
  return parts.join(' \u00b7 ');
}

function applyOrderViewStockSubs(rows, commonAsOf) {
  for (const row of rows) {
    const extras = [];
    if (row.needsCount && row.branches?.some(b => !b.needsCount)) extras.push('missing a location');
    row.stockSub = formatOrderViewStockSub({
      needsCount: row.needsCount && row.branches?.every(b => b.needsCount),
      stockPick: row.stockPick,
      ageDays: row.ageDays,
      extras,
      commonAsOf
    });
    if (row.branches) {
      for (const slice of row.branches) {
        slice.stockSub = formatOrderViewStockSub({
          needsCount: slice.needsCount,
          stockPick: slice.stockPick,
          ageDays: slice.ageDays,
          commonAsOf
        });
      }
    }
  }
}

function decorateOrderViewQty(metrics, item, today, commonAsOf = null) {
  const stockDisplay = metrics.needsCount ? '-' : orderViewFormatQty(metrics.effectiveStock, item);
  const stockSub = formatOrderViewStockSub({ ...metrics, commonAsOf });

  const projectedDisplay =
    metrics.projected == null ? '-' : orderViewFormatQty(metrics.projected, item);
  const suggestedDisplay =
    metrics.suggested == null ? '-' : orderViewFormatQty(metrics.suggested, item);
  const baselineTotalDisplay = orderViewFormatQty(metrics.recordedTotal, item);

  return {
    ...metrics,
    stockDisplay,
    stockSub,
    projectedDisplay,
    suggestedDisplay,
    baselineTotalDisplay
  };
}

function orderViewDateKeysFor(today) {
  const baselineWeekStarts = baselineWeekStartsFor(today);
  const dateKeys = new Set();
  for (const weekStart of baselineWeekStarts) {
    for (const date of weekDates(weekStart)) dateKeys.add(getDateKey(date));
  }
  for (let i = 0; i <= STOCK_LOOKBACK_DAYS; i++) {
    dateKeys.add(getDateKey(addDays(today, -i)));
  }
  return dateKeys;
}

function sliceFetchedFromCache(branchesInScope, dateKeys) {
  const fetched = {};
  for (const branch of branchesInScope) {
    fetched[branch] = {};
    for (const dateStr of dateKeys) {
      const cached = orderViewQuantityCache[branch]?.[dateStr];
      if (cached === undefined) return null;
      fetched[branch][dateStr] = cached;
    }
  }
  return fetched;
}

async function fetchOrderViewQuantities(branchesInScope, dateKeys) {
  return fetchOrderViewQuantitiesCore(branchesInScope, dateKeys, orderViewQuantityCache, db);
}

function patchOrderViewColumnHeaderSubs(today = new Date()) {
  const container = document.getElementById('orderTable');
  if (!container) return;
  const baselineWeekStarts = baselineWeekStartsFor(today);
  const coverageDates = coverageDatesForHorizon(today, orderHorizon);
  const oldestBaseline = baselineWeekStarts[baselineWeekStarts.length - 1];
  const newestBaselineEnd = addDays(baselineWeekStarts[0], 6);
  const needRange = formatDateRange(
    dateFromKey(coverageDates[0] ? getDateKey(coverageDates[0]) : ''),
    dateFromKey(coverageDates.length ? getDateKey(coverageDates[coverageDates.length - 1]) : '')
  );
  const usageRange = formatDateRange(oldestBaseline, newestBaselineEnd);
  const needSub = container.querySelector('[data-order-col="need"] .order-view-th-sub');
  const usageSub = container.querySelector('[data-order-col="usage"] .order-view-th-sub');
  if (needSub) needSub.textContent = needRange || '-';
  if (usageSub) usageSub.textContent = usageRange;
}

function beginOrderViewRefresh(today = new Date()) {
  const container = document.getElementById('orderTable');
  if (!container) return false;
  refreshOrderViewControls(today);
  if (container.querySelector('.inv-table')) {
    container.classList.add('order-view-refreshing');
    patchOrderViewColumnHeaderSubs(today);
    return true;
  }
  container.innerHTML =
    '<div style="text-align:center;padding:20px;color:#666;font-style:italic;">Loading order suggestions...</div>';
  return false;
}

function endOrderViewRefresh() {
  document.getElementById('orderTable')?.classList.remove('order-view-refreshing');
}

function buildOrderViewSnapshot(fetched, today, branchesInScope, orderItems) {
  const snapshot = buildOrderViewSnapshotCore(fetched, today, branchesInScope, orderItems, {
    orderHorizon,
    orderDemandBuffer,
    orderUsageBaseline,
  });
  // Preserve builder-specific rowTitle used by Order View tooltips.
  for (const row of snapshot.rows) {
    const parts = [];
    if ((row.warnReasons || []).join(' ')) parts.push(row.warnReasons.join(' '));
    if (row.hugeValue) parts.push('Unusually large values - check usage/stock data for this item.');
    row.rowTitle = parts.join(' ');
  }
  return snapshot;
}


function reapplyOrderViewHorizon() {
  const today = new Date();
  syncOrderViewBranchSelectionFromStorage();
  const branchesInScope = orderViewBranchSelection.filter(b => availableBranches.includes(b));
  if (branchesInScope.length === 0) {
    loadOrderViewData();
    return;
  }
  const dateKeys = orderViewDateKeysFor(today);
  const fetched = sliceFetchedFromCache(branchesInScope, dateKeys);
  if (!fetched || masterItems.length === 0) {
    loadOrderViewData();
    return;
  }
  refreshOrderViewControls(today);
  const orderItems = filterOrderViewItems(masterItems, branchesInScope);
  orderItems.sort(compareOrderViewMasterItems);
  lastOrderViewSnapshot = buildOrderViewSnapshot(fetched, today, branchesInScope, orderItems);
  renderOrderView(lastOrderViewSnapshot);
}

async function loadOrderViewData() {
  const container = document.getElementById('orderTable');
  if (!container) return;

  const loadGen = ++orderViewLoadGen;
  const today = new Date();
  const keepingTable = beginOrderViewRefresh(today);

  try {
    await ensureCategoriesLoaded();
    if (masterItems.length === 0) {
      await loadMasterItems(false, true);
    }
    if (loadGen !== orderViewLoadGen) return;

    syncOrderViewBranchSelectionFromStorage();
    const branchesInScope = orderViewBranchSelection.filter(b => availableBranches.includes(b));

    if (branchesInScope.length === 0) {
      lastOrderViewSnapshot = null;
      container.innerHTML = '<div style="text-align:center;padding:24px;color:#666;">Choose at least one location.</div>';
      return;
    }

    const orderItems = filterOrderViewItems(masterItems, branchesInScope);
    orderItems.sort(compareOrderViewMasterItems);

    if (orderItems.length === 0) {
      const baselineWeekStarts = baselineWeekStartsFor(today);
      const coverageDates = coverageDatesForHorizon(today, orderHorizon);
      const oldestBaseline = baselineWeekStarts[baselineWeekStarts.length - 1];
      const newestBaselineEnd = addDays(baselineWeekStarts[0], 6);
      lastOrderViewSnapshot = {
        rows: [],
        meta: {
          todayKey: getDateKey(today),
          baselineLabelStart: getDateKey(oldestBaseline),
          baselineLabelEnd: getDateKey(newestBaselineEnd),
          coverageLabelStart: coverageDates[0] ? getDateKey(coverageDates[0]) : '',
          coverageLabelEnd: coverageDates.length ? getDateKey(coverageDates[coverageDates.length - 1]) : '',
          planWeekStart: getDateKey(planWeekStart(today)),
          planWeekEnd: getDateKey(addDays(planWeekStart(today), 6)),
          orderHorizon,
          orderDemandBuffer,
          rollingAvg: orderUsageBaseline === 'rolling-avg'
        }
      };
      if (loadGen !== orderViewLoadGen) return;
      renderOrderView(lastOrderViewSnapshot);
      return;
    }

    const dateKeys = orderViewDateKeysFor(today);
    const fetched = await fetchOrderViewQuantities(branchesInScope, dateKeys);
    if (loadGen !== orderViewLoadGen) return;
    if (!fetched) throw new Error('Failed to load order view quantities');

    lastOrderViewSnapshot = buildOrderViewSnapshot(fetched, today, branchesInScope, orderItems);
    renderOrderView(lastOrderViewSnapshot);
  } catch (err) {
    console.error('loadOrderViewData', err);
    if (!keepingTable) {
      lastOrderViewSnapshot = null;
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: #d32f2f;">Error loading order view</div>';
    }
  } finally {
    if (loadGen === orderViewLoadGen) endOrderViewRefresh();
  }
}

function dateFromKey(key) {
  if (!key) return null;
  const [y, m, day] = String(key).split('-').map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day);
}

function orderViewQtyCell(display, sub, extraClass = '') {
  const subHtml = sub ? `<div class="order-view-cell-sub">${escapeHtml(sub)}</div>` : '';
  const classes = ['quantity-cell', extraClass].filter(Boolean).join(' ');
  return `<td class="${classes}" style="text-align:right;">${display}${subHtml}</td>`;
}

function renderOrderViewItemCells(row, itemLabel, { indent = false, expandHtml = '' } = {}) {
  const needsOrder = typeof row.suggested === 'number' && row.suggested > 0;
  const runOutDays = row.runOutSecondary
    ? `<div class="order-view-runout-days">${escapeHtml(row.runOutSecondary)}</div>`
    : '';
  const runOutUrgentClass = row.runOutUrgent ? ' order-view-runout-urgent' : '';
  const runTitle = [row.runOutTitle, ...(row.warnReasons || [])].filter(Boolean).join(' ');
  let html = '';
  html += `<td class="order-view-expand-col">${expandHtml}</td>`;
  html += `<td class="order-view-col-item${indent ? ' order-view-branch-name' : ''}">${itemLabel}</td>`;
  html += `<td class="order-view-col-desc">${indent ? '' : escapeHtml(row.item.description || '')}</td>`;
  html += orderViewQtyCell(row.stockDisplay, row.stockSub, 'order-view-col-stock');
  html += orderViewQtyCell(row.baselineTotalDisplay, '', 'order-view-col-usage');
  html += orderViewQtyCell(row.projectedDisplay, '', 'order-view-col-need');
  html += orderViewQtyCell(
    row.suggestedDisplay,
    '',
    `order-view-col-suggested${needsOrder ? ' order-view-suggested-cell' : ' order-view-suggested-empty'}`
  );
  html += `<td class="quantity-cell order-view-runout-cell${runOutUrgentClass}" style="text-align:right;" title="${escapeHtml(runTitle)}"><div class="order-view-runout-date">${escapeHtml(row.runOutPrimary)}</div>${runOutDays}</td>`;
  return html;
}

function renderOrderView({ rows, meta }) {
  const container = document.getElementById('orderTable');
  if (!container) return;

  if (!rows.length) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:#666;">No items match the selected locations (enable items for those branches).</div>';
    return;
  }

  const categoryMap = new Map();
  rows.forEach(row => {
    const category = row.item.category || 'Other';
    if (!categoryMap.has(category)) {
      categoryMap.set(category, []);
    }
    categoryMap.get(category).push(row);
  });

  const sortedCategories = Array.from(categoryMap.entries()).sort((a, b) =>
    compareCategoryNamesDashboardOrder(a[0], b[0])
  );

  const categoriesToRender = orderViewNeedsOrderOnly
    ? sortedCategories
        .map(([category, catRows]) => [
          category,
          catRows.filter(
            r => (typeof r.suggested === 'number' && r.suggested > 0) || r.needsCount
          )
        ])
        .filter(([, catRows]) => catRows.length > 0)
    : sortedCategories;

  if (orderViewNeedsOrderOnly && categoriesToRender.length === 0) {
    container.innerHTML =
      '<div style="text-align:center;padding:24px;color:#666;">No items need ordering.</div>';
    return;
  }

  const needRange = formatDateRange(dateFromKey(meta.coverageLabelStart), dateFromKey(meta.coverageLabelEnd));
  const usageRange = formatDateRange(dateFromKey(meta.baselineLabelStart), dateFromKey(meta.baselineLabelEnd));

  const stockHeaderSub = meta.commonStockAsOf || 'Latest count';
  let html = '<table class="inv-table">';
  html += '<colgroup>';
  html += '<col class="order-view-col-expand">';
  html += '<col class="order-view-col-item">';
  html += '<col class="order-view-col-desc">';
  html += '<col class="order-view-col-num">';
  html += '<col class="order-view-col-num">';
  html += '<col class="order-view-col-num">';
  html += '<col class="order-view-col-num">';
  html += '<col class="order-view-col-runout">';
  html += '</colgroup>';
  html += '<thead><tr>';
  html += '<th class="order-view-expand-col order-view-col-expand"></th>';
  html += '<th class="order-view-th-item order-view-col-item">Item</th>';
  html += '<th class="order-view-th-desc order-view-col-desc">Description</th>';
  html += `<th class="order-view-th-num order-view-th-stock order-view-col-num">Stock<span class="order-view-th-sub">${escapeHtml(stockHeaderSub)}</span></th>`;
  html += `<th class="order-view-th-num order-view-th-usage order-view-col-num" data-order-col="usage">Usage<span class="order-view-th-sub">${escapeHtml(usageRange)}</span></th>`;
  html += `<th class="order-view-th-num order-view-th-need order-view-col-num" data-order-col="need">Need<span class="order-view-th-sub">${escapeHtml(needRange || '-')}</span></th>`;
  html += '<th class="order-view-th-num order-view-th-suggested order-view-col-num">Suggested<br>order</th>';
  html += '<th class="order-view-th-num order-view-th-runout order-view-col-runout">Run out</th>';
  html += '</tr></thead><tbody>';

  categoriesToRender.forEach(([category, catRows]) => {
    const isCollapsed = orderViewCollapsedCategories.includes(category);
    html += `<tr class="category-header" data-category="${escapeHtml(category)}"><td colspan="8" style="padding: 8px 12px;">
      <div class="category-header-container">
        <div class="category-header-left">
          <button type="button" class="category-collapse-btn ${isCollapsed ? 'collapsed' : ''}" data-category="${escapeHtml(category)}" aria-expanded="${isCollapsed ? 'false' : 'true'}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'} ${escapeHtml(category)}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <span class="category-name">${escapeHtml(category)}</span>
        </div>
      </div>
    </td></tr>`;
    catRows.forEach(row => {
      const trTitle = row.rowTitle ? ` title="${escapeHtml(row.rowTitle)}"` : '';
      const rowHidden = isCollapsed ? ' style="display:none;"' : '';
      const needsOrder = typeof row.suggested === 'number' && row.suggested > 0;
      const needsOrderClass = needsOrder ? ' order-view-row-needs-order' : '';
      const canExpand = Array.isArray(row.branches) && row.branches.length > 1;
      const expanded = canExpand && orderViewExpandedItems.has(row.item.id);
      const expandHtml = canExpand
        ? `<button type="button" class="order-view-expand-btn" data-item-id="${escapeHtml(row.item.id)}" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="${expanded ? 'Hide' : 'Show'} locations">${expanded ? '\u25BC' : '\u25B6'}</button>`
        : '';
      html += `<tr class="inventory-row category-item-row${needsOrderClass}" data-category="${escapeHtml(category)}" data-item-id="${escapeHtml(row.item.id)}"${rowHidden}${trTitle}>`;
      html += renderOrderViewItemCells(row, escapeHtml(row.item.name), { expandHtml });
      html += '</tr>';
      if (canExpand) {
        row.branches.forEach(slice => {
          const childHidden = isCollapsed || !expanded ? ' style="display:none;"' : '';
          const childNeeds = typeof slice.suggested === 'number' && slice.suggested > 0;
          const childClass = childNeeds ? ' order-view-row-needs-order' : '';
          const childTitle = slice.warnReasons?.length ? ` title="${escapeHtml(slice.warnReasons.join(' '))}"` : '';
          html += `<tr class="inventory-row order-view-branch-row${childClass}" data-category="${escapeHtml(category)}" data-parent-item="${escapeHtml(row.item.id)}"${childHidden}${childTitle}>`;
          html += renderOrderViewItemCells(
            { ...slice, item: row.item },
            escapeHtml(slice.branchLabel),
            { indent: true }
          );
          html += '</tr>';
        });
      }
    });
  });

  html += '</tbody></table>';
  container.innerHTML = html;
  setupOrderViewCategoryCollapse();
}

function setupOrderViewCategoryCollapse() {
  const table = document.querySelector('#orderTable .inv-table');
  if (!table) return;

  table.querySelectorAll('.category-header').forEach(header => {
    header.addEventListener('click', e => {
      if (e.target.closest('.category-collapse-btn')) return;
      const cat = header.dataset.category;
      if (cat) toggleOrderViewCategoryCollapse(cat);
    });
  });

  table.querySelectorAll('.category-collapse-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const cat = btn.dataset.category;
      if (cat) toggleOrderViewCategoryCollapse(cat);
    });
  });

  table.querySelectorAll('.order-view-expand-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.itemId;
      if (id) toggleOrderViewItemExpand(id);
    });
  });
}

function syncOrderViewRowVisibility() {
  document.querySelectorAll('#orderTable tr.category-item-row').forEach(tr => {
    const collapsed = orderViewCollapsedCategories.includes(tr.dataset.category);
    tr.style.display = collapsed ? 'none' : '';
  });
  document.querySelectorAll('#orderTable tr.order-view-branch-row').forEach(tr => {
    const collapsed = orderViewCollapsedCategories.includes(tr.dataset.category);
    const expanded = orderViewExpandedItems.has(tr.dataset.parentItem);
    tr.style.display = collapsed || !expanded ? 'none' : '';
  });
}

function toggleOrderViewItemExpand(itemId) {
  if (orderViewExpandedItems.has(itemId)) orderViewExpandedItems.delete(itemId);
  else orderViewExpandedItems.add(itemId);
  const btn = document.querySelector(`#orderTable .order-view-expand-btn[data-item-id="${CSS.escape(itemId)}"]`);
  if (btn) {
    const expanded = orderViewExpandedItems.has(itemId);
    btn.textContent = expanded ? '\u25BC' : '\u25B6';
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }
  syncOrderViewRowVisibility();
}

function toggleOrderViewCategoryCollapse(category) {
  const idx = orderViewCollapsedCategories.indexOf(category);
  if (idx >= 0) {
    orderViewCollapsedCategories.splice(idx, 1);
  } else {
    orderViewCollapsedCategories.push(category);
  }
  localStorage.setItem('order-view-collapsed-categories', JSON.stringify(orderViewCollapsedCategories));

  const collapsed = orderViewCollapsedCategories.includes(category);
  syncOrderViewRowVisibility();

  document.querySelectorAll('#orderTable tr.category-header').forEach(h => {
    if (h.dataset.category !== category) return;
    const btn = h.querySelector('.category-collapse-btn');
    if (btn) {
      btn.classList.toggle('collapsed', collapsed);
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      const label = collapsed ? 'Expand' : 'Collapse';
      btn.setAttribute('aria-label', `${label} ${category}`);
    }
  });
}


function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderWeeklyView() {
  console.log('=== RENDER WEEKLY VIEW START ===');
  const container = document.getElementById('weeklyTable');
  if (!validWeeklyQuantityTypes.has(weeklyQuantityType)) {
    weeklyQuantityType = 'used';
    localStorage.setItem('weekly-quantity-type', weeklyQuantityType);
  }
  
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
  const headers = ['Item', 'Description'];
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
  getWeeklyViewItems().forEach(item => {
    const category = item.category || 'Other';
    if (!categoryMap.has(category)) {
      categoryMap.set(category, []);
    }
    categoryMap.get(category).push(item);
  });

  // Sort categories using the same Master Items order
  const sortedCategories = Array.from(categoryMap.entries())
    .sort((a, b) => compareCategoryNamesDashboardOrder(a[0], b[0]));

  // Build table rows
  const rows = [];
  if (weeklyQuantityType === 'used') {
    rows.push(buildWeeklySalesRow(dates, true));
  }
  sortedCategories.forEach(([category, categoryItems]) => {
    categoryItems.sort((a, b) => (a.displayOrder ?? a.order ?? 0) - (b.displayOrder ?? b.order ?? 0));
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
          item.name,
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
          if (weeklyQuantityType === 'movement') {
            const addedValue = dayData ? dayData.added || 0 : 0;
            const removedValue = dayData ? dayData.removed || 0 : 0;
            const unit = item.unit || '';
            const addedText = addedValue > 0 ? `+${formatNumberWithCommas(addedValue)}${unit ? ` ${unit}` : ''}` : '';
            const removedText = removedValue > 0 ? `-${formatNumberWithCommas(removedValue)}${unit ? ` ${unit}` : ''}` : '';
            if (!addedText && !removedText) {
              row.cells.push('-');
            } else {
              row.cells.push(
                `<div class="movement-cell">` +
                `${addedText ? `<span class="movement-added">${addedText}</span>` : ''}` +
                `${removedText ? `<span class="movement-removed">${removedText}</span>` : ''}` +
                `</div>`
              );
            }
          } else if (weeklyQuantityType === 'used' && !hasClosingData) {
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

  console.log('ðŸŽ¨ Weekly view render completed');
}

function buildWeeklyTable(headers, rows) {
  const hasTotal = weeklyQuantityType === 'used';
  const dayCount = hasTotal ? headers.length - 3 : headers.length - 2;
  let html = '<table class="inv-table weekly-table" id="weeklyViewTable">';
  html += '<colgroup>';
  html += '<col class="weekly-col-item">';
  html += '<col class="weekly-col-desc">';
  for (let i = 0; i < dayCount; i++) html += '<col class="weekly-col-day">';
  if (hasTotal) html += '<col class="weekly-col-total">';
  html += '</colgroup>';
  
  // Header row
  html += '<thead><tr>';
  headers.forEach((header, index) => {
    const isTotalColumn = header.includes('Total');
    const isDateColumn = index >= 2 && !isTotalColumn;
    const headerClass = [
      isTotalColumn ? 'total-column-header' : '',
      isDateColumn ? 'weekly-day-col' : ''
    ].filter(Boolean).join(' ');
    html += `<th class="${headerClass}">${header}</th>`;
  });
  html += '</tr></thead>';

  // Body
  html += '<tbody>';
  rows.forEach(row => {
    if (row.type === 'category-header') {
      const isCollapsed = dashboardCollapsedCategories.includes(row.category);
      html += `<tr class="category-header" data-category="${row.category}">`;
      html += `<td colspan="${row.colspan}" style="padding: 8px 12px;">`;
      html += '<div class="category-header-container">';
      html += '<div class="category-header-left">';
      html += `<button type="button" class="category-collapse-btn ${isCollapsed ? 'collapsed' : ''}" data-category="${row.category}">`;
      html += '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">';
      html += '<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
      html += '</svg></button>';
      html += `<span class="category-name">${row.category}</span>`;
      html += '</div></div></td></tr>';
    } else if (row.type === 'sales-total') {
      html += '<tr class="weekly-sales-row">';
      row.cells.forEach((cell, index) => {
        const isTotalColumn = weeklyQuantityType === 'used' && index === row.cells.length - 1;
        const isDateColumn = index >= 2 && !isTotalColumn;
        let cellClass = '';
        if (isDateColumn) cellClass = 'weekly-day-col';
        if (isTotalColumn) cellClass += ' total-column';
        html += `<td class="${cellClass}">${cell}</td>`;
      });
      html += '</tr>';
    } else if (row.type === 'item') {
      const isCollapsed = dashboardCollapsedCategories.includes(row.category);
      html += `<tr class="inventory-row category-item-row" data-category="${row.category}"${isCollapsed ? ' style="display:none;"' : ''}>`;
      row.cells.forEach((cell, index) => {
        const isTotalColumn = weeklyQuantityType === 'used' && index === row.cells.length - 1;
        const isDateColumn = index >= 2 && !isTotalColumn;
        let cellClass = '';
        if (isDateColumn) {
          cellClass = weeklyQuantityType === 'movement' ? 'movement-cell-wrapper weekly-day-col' : 'quantity-cell used weekly-day-col';
        }
        if (isTotalColumn) {
          cellClass = (weeklyQuantityType === 'movement' ? 'movement-cell-wrapper' : 'quantity-cell used') + ' total-column';
        }
        html += `<td class="${cellClass}">${cell}</td>`;
      });
      html += '</tr>';
    }
  });
  html += '</tbody></table>';

  return html;
}

function setupWeeklyCategoryCollapse() {
  document.querySelectorAll('#weeklyTable .category-header').forEach(header => {
    header.addEventListener('click', () => {
      const category = header.dataset.category;
      if (category) toggleWeeklyCategoryCollapse(category);
    });
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

  const collapsed = dashboardCollapsedCategories.includes(category);
  document.querySelectorAll(`#weeklyTable tr.category-item-row[data-category="${CSS.escape(category)}"]`).forEach(tr => {
    tr.style.display = collapsed ? 'none' : '';
  });
  document.querySelectorAll(`#weeklyTable tr.category-header[data-category="${CSS.escape(category)}"] .category-collapse-btn`).forEach(btn => {
    btn.classList.toggle('collapsed', collapsed);
  });
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
        <td colspan="8" style="padding: 8px 12px;">
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
      const hasAnyStockData = hasClosingData || hasOpeningData;
      const mostRecentQty = hasClosingData
        ? closingQty
        : (hasOpeningData ? openingQty + addedQty : null);
      const isOutOfStock = hasAnyStockData && mostRecentQty === 0;
      const isLowStock = hasAnyStockData && mostRecentQty > 0 && mostRecentQty <= restockLevel;
      
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
          <td style="width:200px;">${item.name}${stockIcon}</td>
          <td style="width:150px;">${item.description || ''}</td>
          <td class="quantity-cell opening ${openingClass} ${stockColorClass}">${hasOpeningData ? `${formatNumberWithCommas(openingQty)} ${item.unit}` : '-'}</td>
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
  const headers = ['Item', 'Description', 'Opening', 'Added', 'Pull Out', 'Closing', 'Used', 'Wastage'];
  const tableHtml = buildTable(headers, rows, 'dashboardTable');
  
  container.innerHTML = tableHtml;
  
  // Setup dashboard category collapse functionality
  setupDashboardCategoryCollapse();
  
  const renderTime = performance.now() - renderStart;
  console.log(`ðŸŽ¨ Dashboard render completed in: ${renderTime.toFixed(2)}ms`);
}

function getUniqueCategoriesFromItems(items) {
  return uniqueSortedCategoryNames(items, currentCategoryOrderMap());
}

// Setup dashboard category collapse functionality
function setupDashboardCategoryCollapse() {
  const root = document.getElementById('dashboardTable') || document.getElementById('inventoryTable');
  if (!root) return;

  root.querySelectorAll('.category-header').forEach(header => {
    header.addEventListener('click', () => {
      const category = header.dataset.category;
      if (category) toggleDashboardCategoryCollapse(category);
    });
  });

  const buttons = root.querySelectorAll('.category-collapse-btn');
  
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
  weeklyDate = startOfWeekMonday(new Date(year, month - 1, day));
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

// Format number with grouping (safe for decimals; avoids commas inside fractional junk from floats)
function formatNumberWithCommas(num) {
  if (num === null || num === undefined) return '0';
  const n = Number(num);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4, minimumFractionDigits: 0 });
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
      console.log('ðŸ”„ Background check: Inventory items have changed, updating');
      dashboardItems = freshItems;
      
      // Cache the fresh items
      cacheInventoryItems(dashboardItems);
      
      // Re-render with fresh items
      renderDashboard();
      showSyncIndicator('Inventory items updated from Firebase', 'success');
    } else {
      console.log('âœ… Background check: Inventory items are up to date');
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
    console.log('ðŸ” Dashboard looking for cache with key:', cacheKey);
    const cached = localStorage.getItem(cacheKey);
    if (!cached) {
      console.log('âŒ No cached inventory items found for branch:', dashboardBranch);
      console.log('ðŸ” Available localStorage keys:', Object.keys(localStorage).filter(k => k.includes('inventory')));
      return null;
    }
    
    const parseStart = performance.now();
    const cacheData = JSON.parse(cached);
    const parseTime = performance.now() - parseStart;
    
    // Main inventory uses direct array format - use that
    if (Array.isArray(cacheData)) {
      console.log(`ðŸ“¦ Loading inventory items from main inventory cache (parse: ${parseTime.toFixed(2)}ms)`);
      console.log('ðŸ“¦ Cached items count:', cacheData.length);
      
      // Ensure items have proper ordering fields
      return cacheData.map(item => ({
        ...item,
        displayOrder: item.displayOrder || item.order || 0,
        categoryOrder: item.categoryOrder || 0
      }));
    } else {
      console.log('âŒ Cache format is not array - main inventory cache not found');
      return null;
    }
  } catch (error) {
    console.error('Error loading cached inventory items:', error);
    return null;
  }
}

function itemsWithoutPhotos(items) {
  return (items || []).map((item) => {
    if (!item || item.photo == null) return item;
    const { photo, ...rest } = item;
    return rest;
  });
}

function cacheInventoryItems(items) {
  try {
    const cacheKey = `inventory-items-${dashboardBranch}`;
    // Use the SAME format as main inventory - direct array, not wrapped object
    localStorage.setItem(cacheKey, JSON.stringify(itemsWithoutPhotos(items)));
    console.log('Inventory items cached for branch:', dashboardBranch, 'items:', items.length);
  } catch (error) {
    console.error('Error caching inventory items:', error);
    try { localStorage.removeItem(`inventory-items-${dashboardBranch}`); } catch (_) {}
  }
}

// Unified cache invalidation - clears cache for all branches
function invalidateInventoryCache() {
  try {
    const branches = ['sm-north', 'podium', 'moa'];
    branches.forEach(branch => {
      const cacheKey = `inventory-items-${branch}`;
      localStorage.removeItem(cacheKey);
      console.log(`ðŸ-‘ï¸ Invalidated inventory cache for branch: ${branch}`);
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
      console.log('âŒ No cached quantities found for date:', getDateKey(dashboardDate));
      return null;
    }
    
    const parseStart = performance.now();
    const cacheData = JSON.parse(cached);
    const parseTime = performance.now() - parseStart;
    console.log(`ðŸ“Š Loading quantities from cache for date: ${getDateKey(dashboardDate)} (parse: ${parseTime.toFixed(2)}ms)`);
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
  console.log('ðŸ§ª Testing cache loading speed...');
  const start = performance.now();
  
  const cachedItems = loadInventoryItemsFromCache();
  const cachedQuantities = loadQuantitiesFromCache();
  
  const end = performance.now();
  const time = end - start;
  
  console.log(`âš¡ Cache loading took: ${time.toFixed(2)}ms`);
  console.log(`ðŸ“¦ Items found: ${cachedItems ? cachedItems.length : 'none'}`);
  console.log(`ðŸ“Š Quantities found: ${cachedQuantities ? 'yes' : 'no'}`);
  
  return { time, itemsCount: cachedItems ? cachedItems.length : 0, hasQuantities: !!cachedQuantities };
};

// Master items cache functions
function loadMasterItemsFromCache() {
  try {
    const cached = localStorage.getItem('inventory-config-items-cache');
    if (!cached) {
      console.log('âŒ No cached master items found');
      return null;
    }
    
    const parseStart = performance.now();
    const cacheData = JSON.parse(cached);
    const parseTime = performance.now() - parseStart;
    
    console.log('ðŸ“¦ Loading master items from cache (parse:', parseTime.toFixed(2), 'ms)');
    console.log('ðŸ“¦ Cached master items count:', cacheData.items.length);
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
      items: itemsWithoutPhotos(items)
    };
    localStorage.setItem('inventory-config-items-cache', JSON.stringify(cacheData));
    console.log('ðŸ“¦ Master items cached:', items.length, 'items');
  } catch (error) {
    console.error('Error caching master items:', error);
    try { localStorage.removeItem('inventory-config-items-cache'); } catch (_) {}
  }
}

// Background sync for master items
async function syncMasterItemsFromFirebaseInBackground() {
  try {
    console.log('ðŸ”„ Background sync: Loading master items from Firebase (isMovingItems =', isMovingItems, ', isTogglingBranch =', isTogglingBranch, ')');
    
    const querySnapshot = await getDocs(collection(db, 'inventory', '_config', 'items'));
    const freshItems = querySnapshot.docs.map(d => {
      const data = d.data();
      if (data && data.subtitle && !data.description) data.description = data.subtitle;
      return { id: d.id, displayOrder: data.displayOrder ?? 0, categoryOrder: data.categoryOrder ?? 0, ...data };
    });
    
    console.log('ðŸ”„ Background sync: Fresh items loaded from Firebase:', freshItems.length, 'items');
    console.log('ðŸ”„ Background sync: Sample fresh item enabledBranches:', freshItems.slice(0, 3).map(item => ({ name: item.name, enabledBranches: item.enabledBranches })));
    
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
    
    console.log('ðŸ”„ Background sync: Current items enabledBranches:', masterItems.slice(0, 3).map(item => ({ name: item.name, enabledBranches: item.enabledBranches })));
    console.log('ðŸ”„ Background sync: Fresh items enabledBranches:', freshItems.slice(0, 3).map(item => ({ name: item.name, enabledBranches: item.enabledBranches })));
    console.log('ðŸ”„ Background sync: Data changed?', currentItemsJson !== freshItemsJson);
    
    if (currentItemsJson !== freshItemsJson) {
      // Don't override local changes if we're currently moving items or toggling branches
      if (isMovingItems) {
        console.log('ðŸ”„ Background sync: Skipping update - items are being moved (isMovingItems = true)');
        return;
      }
      if (isTogglingBranch) {
        console.log('ðŸ”„ Background sync: Skipping update - branches are being toggled (isTogglingBranch = true)');
        return;
      }
      
      console.log('ðŸ”„ Background sync: Master items have changed, updating');
      console.log('ðŸ”„ Background sync: Current items enabledBranches:', masterItems.map(item => ({ name: item.name, enabledBranches: item.enabledBranches })));
      console.log('ðŸ”„ Background sync: Fresh items enabledBranches:', freshItems.map(item => ({ name: item.name, enabledBranches: item.enabledBranches })));
      masterItems = freshItems;
      console.log('ðŸ”„ Background sync: masterItems updated to fresh data');
      
      // Cache the fresh data
      cacheMasterItems(masterItems);
      
      // Re-render if we're on master items or branch list tab
      if (currentTask === 'master-items') {
        console.log('ðŸ”„ Background sync: Re-rendering master items');
        renderMasterItems();
      }
      if (currentTask === 'branch-list') {
        console.log('ðŸ”„ Background sync: Re-rendering branch list');
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
  console.log('ðŸš€ Force instant dashboard load...');
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
    console.log(`âš¡ Force load completed in: ${(end - start).toFixed(2)}ms`);
    showSyncIndicator('Force loaded from cache', 'success');
  } else {
    console.log('âŒ No cached data available');
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
      <button class="delete-row-btn" onclick="deleteBulkRow(${rowIndex})" ${rowIndex === 1 ? 'disabled' : ''}>\u00D7</button>
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
      <button class="delete-row-btn" onclick="deleteBulkRow(${rowIndex})">\u00D7</button>
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
  const override = masterItem.branchOverrides?.[branch]?.restockLevel;
  if (override !== undefined) return override;
  return masterItem.restockAmount || 0;
}


// Global functions for inline handlers
window.toggleDashboardCategoryCollapse = toggleDashboardCategoryCollapse;
window.selectDashboardDate = selectDashboardDate;
window.deleteBulkRow = deleteBulkRow;
