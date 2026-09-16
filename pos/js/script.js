import { menuData } from './menu-data.js?v=6';
import { syncOrderToFirebase, syncAllPendingOrders, initializeMenuItems, loadEventsFromFirebase, saveEventToFirebase, subscribeToOrders, publishLiveSession, clearLiveSession } from './firebase-sync.js?v=10';
import { app, db, collection, doc, getDocs, deleteDoc, setDoc, getDoc, serverTimestamp } from './firebase-setup.js?v=7';

console.log('[GREETING_DEBUG][POS] MODULE LOADED', { build: 'greeting-fix-2', hasPublishLiveSession: typeof publishLiveSession });


// Customization options
const customizationOptions = {
  size: {
    'regular': -20,
    'large': 0
  },
  serving: {
    'iced': 0,
    'hot': 0
  },
  sweetness: {
    '0%': 0,
    '50%': 0,
    '100%': 0,
    '150%': 0,
    '200%': 0
  },
  milk: {
    'dairy': 0,
    'oat': 50  // Additional charge for oat milk
  },
  discount: {
    'none': 0,
    'senior': -0.2,  // 20% discount
    'pwd': -0.2,     // 20% discount
    'free': -1,      // 100% off (free)
    'custom': 0      // Custom discount (will be set dynamically)
  },
  strengthLevel: {
    '1': 0,
    '2': 40,
    '3': 80
  },
  matchaOption: {
    'aki': 0,
    'natsu': 30
  }
};

// Effective options: merge menu-level overrides when present (backwards compatible)
function getCustomizationOptions() {
  const menu = currentMenuData || null;
  const opts = { ...customizationOptions };
  opts.milk = { ...customizationOptions.milk };
  opts.strengthLevel = { ...customizationOptions.strengthLevel };
  opts.matchaOption = { ...customizationOptions.matchaOption };
  if (menu) {
    if (typeof menu.oatUpgradePrice === 'number') {
      opts.milk.oat = menu.oatUpgradePrice;
    }
    if (menu.strengthLevelPrices && typeof menu.strengthLevelPrices === 'object') {
      Object.assign(opts.strengthLevel, menu.strengthLevelPrices);
    }
    if (menu.matchaOptionPrices && typeof menu.matchaOptionPrices === 'object') {
      Object.assign(opts.matchaOption, menu.matchaOptionPrices);
    }
  }
  return opts;
}

function matchaOptionSurcharge(option, opts = getCustomizationOptions()) {
  if (!option || !opts.matchaOption) return 0;
  const n = Number(opts.matchaOption[option]);
  return Number.isFinite(n) ? n : 0;
}

function formatMatchaOptionLabel(option) {
  if (option === 'natsu') return 'Natsu';
  if (option === 'aki') return 'Aki';
  return option ? String(option) : '';
}

function applyDiscountToUnitPrice(unitPrice, discountOptions) {
  const discount = discountOptions?.discount;
  if (!discount || discount === 'none') return unitPrice;

  if (discount === 'custom') {
    if (discountOptions.customDiscountMode === 'amount') {
      const amount = Number(discountOptions.customDiscountAmount);
      if (!isNaN(amount) && amount > 0) {
        return Math.max(0, unitPrice - amount);
      }
      return unitPrice;
    }
    const percent = Number(discountOptions.customDiscountPercent);
    if (!isNaN(percent) && percent >= 0 && percent <= 100) {
      return unitPrice * (1 - percent / 100);
    }
    return unitPrice;
  }

  const preset = getCustomizationOptions().discount[discount];
  if (preset) return unitPrice * (1 + preset);
  return unitPrice;
}

function getCustomDiscountLabel(customizations) {
  if (!customizations?.discount || customizations.discount === 'none') return '';
  if (customizations.discount !== 'custom') {
    return String(customizations.discount).toUpperCase();
  }
  if (customizations.customDiscountMode === 'amount' && customizations.customDiscountAmount) {
    return `₱${Number(customizations.customDiscountAmount)} OFF`;
  }
  if (customizations.customDiscountPercent) {
    return `${customizations.customDiscountPercent}% OFF`;
  }
  return 'CUSTOM';
}

function readCustomDiscountFromModal() {
  const wrap = document.querySelector('.custom-discount-input');
  const input = document.querySelector('#customDiscountValue');
  const mode = wrap?.dataset.mode === 'amount' ? 'amount' : 'percent';
  const value = parseFloat(input?.value);
  if (isNaN(value) || value < 0) return { mode, percent: null, amount: null };
  if (mode === 'amount') return { mode, amount: value, percent: null };
  return { mode, percent: Math.min(100, value), amount: null };
}

function setCustomDiscountMode(wrap, mode) {
  if (!wrap) return;
  wrap.dataset.mode = mode;
  const input = wrap.querySelector('#customDiscountValue');
  if (!input) return;
  if (mode === 'amount') {
    input.removeAttribute('max');
    input.setAttribute('aria-label', 'Custom discount amount in pesos');
  } else {
    input.max = '100';
    const n = parseFloat(input.value);
    if (!isNaN(n) && n > 100) input.value = '100';
    input.setAttribute('aria-label', 'Custom discount percent');
  }
  updateItemTotal();
}

/** Menu default milk: explicit defaultMilk, else oat when oatUpgradePrice is 0, else dairy. */
function getDefaultMilk() {
  const menu = currentMenuData || null;
  if (menu && (menu.defaultMilk === 'oat' || menu.defaultMilk === 'dairy')) {
    return menu.defaultMilk;
  }
  if (menu && typeof menu.oatUpgradePrice === 'number' && menu.oatUpgradePrice === 0) {
    return 'oat';
  }
  return 'dairy';
}

// Hide size in customization modal (data/logic kept for possible future use)
const HIDE_SIZE_CUSTOMIZATION = true;

let customerName = '';
let pendingDiscountIdPhoto = null;
let pendingDiscountIdDetails = null;
let liveSessionState = {
  paymentMethod: null,
  showQr: false,
  status: 'idle'
};
let liveSessionPublishTimer = null;

let selectedDate = new Date();
let currentDate = new Date();

let currentEvent = localStorage.getItem('currentEvent') || 'pop-up';
let availableEvents = JSON.parse(localStorage.getItem('availableEvents') || '["pop-up"]');

window.currentEvent = currentEvent;
window.syncOrdersWithFirebase = syncOrdersWithFirebase;

async function loadAvailableEvents() {
  try {
    // Load from localStorage immediately for fast display
    const cachedEvents = JSON.parse(localStorage.getItem('cachedEvents') || '[]');

    if (cachedEvents.length > 0) {
      console.log('Loading cached events for immediate display');
      availableEvents = cachedEvents.filter(event => !event.archived).map(event => event.key);
      localStorage.setItem('availableEvents', JSON.stringify(availableEvents));

      // Update UI immediately with cached data
      updateEventSelector();
    }

    // Load from Firebase in background
    console.log('Fetching latest events from Firebase...');
    const firebaseEvents = await loadEventsFromFirebase();

    // Check if there are differences
    const hasChanges = !eventsAreEqual(cachedEvents, firebaseEvents);

    if (hasChanges) {
      console.log('Events have changed, updating cache and UI');

      // Update cache
      localStorage.setItem('cachedEvents', JSON.stringify(firebaseEvents));

      // Filter out archived events for POS - only keep active events
      const activeEvents = firebaseEvents.filter(event => !event.archived);
      availableEvents = activeEvents.map(event => event.key);
      localStorage.setItem('availableEvents', JSON.stringify(availableEvents));

      // Update UI with new data
      updateEventSelector();
    }

    // Load custom menu for current event
    await loadEventMenu(currentEvent);

    return availableEvents;
  } catch (error) {
    console.error('Error loading events:', error);
    return [];
  }
}

function eventsAreEqual(cachedEvents, firebaseEvents) {
  if (cachedEvents.length !== firebaseEvents.length) {
    return false;
  }

  // Compare each event
  for (let i = 0; i < cachedEvents.length; i++) {
    const cached = cachedEvents[i];
    const firebase = firebaseEvents[i];

    if (cached.key !== firebase.key ||
      cached.name !== firebase.name ||
      cached.serviceType !== firebase.serviceType ||
      cached.archived !== firebase.archived) {
      return false;
    }
  }

  return true;
}

let isUpdatingEventSelector = false;

function updateEventSelector() {
  if (isUpdatingEventSelector) {
    console.log('updateEventSelector already running, skipping...');
    return;
  }

  isUpdatingEventSelector = true;

  const eventSelector = document.getElementById('eventSelector');
  const currentValue = currentEvent; // Use the localStorage-saved value, not the selector's current value

  // Clear existing options
  eventSelector.innerHTML = '';

  loadEventsFromFirebase().then(firebaseEvents => {
    // Filter out archived events for POS (only show active events)
    const activeEvents = firebaseEvents.filter(event => !event.archived);

    console.log('Active events loaded:', activeEvents);

    // Add active events only (Legacy Data is dashboard-only, not shown in POS)
    activeEvents.forEach(event => {
      console.log('Processing event in updateEventSelector:', event);
      const option = document.createElement('option');
      option.value = event.key;
      const serviceLabel = event.serviceType === 'package' ? 'Package' : 'Popup';
      option.textContent = `[${serviceLabel}] ${event.name}`;
      option.dataset.serviceType = event.serviceType || 'popup';
      eventSelector.appendChild(option);
    });

    const hasActiveEvents = activeEvents.length > 0;
    const isCurrentEventActive = activeEvents.some(event => event.key === currentValue);

    if (hasActiveEvents) {
      if (isCurrentEventActive) {
        eventSelector.value = currentValue;
      } else {
        // Switch to first active (e.g. when previously on Legacy Data or archived event)
        currentEvent = activeEvents[0].key;
        eventSelector.value = currentEvent;
        window.currentEvent = currentEvent;
        localStorage.setItem('currentEvent', currentEvent);
      }
    } else {
      const noEventsOption = document.createElement('option');
      noEventsOption.value = '';
      noEventsOption.textContent = 'No events available';
      noEventsOption.disabled = true;
      eventSelector.appendChild(noEventsOption);
      currentEvent = '';
      window.currentEvent = currentEvent;
      localStorage.setItem('currentEvent', currentEvent);
    }

    // Update display mode based on selected event
    setTimeout(() => {
      updateDisplayMode();
    }, 100);

    isUpdatingEventSelector = false;
  }).catch(() => {
    isUpdatingEventSelector = false;
  });
}

function clearEventsCache() {
  localStorage.removeItem('cachedEvents');
  console.log('Events cache cleared');
}


// Get current event's service type
function getCurrentEventServiceType() {
  const eventSelector = document.getElementById('eventSelector');
  const selectedOption = eventSelector.selectedOptions[0];

  console.log('getCurrentEventServiceType debug:', {
    currentValue: eventSelector.value,
    selectedOption: selectedOption,
    datasetServiceType: selectedOption ? selectedOption.dataset.serviceType : 'none'
  });

  if (eventSelector.value === 'pop-up') {
    return 'popup'; // Legacy data is popup type
  }

  return selectedOption ? selectedOption.dataset.serviceType || 'popup' : 'popup';
}

// Update display mode based on service type
function updateDisplayMode() {
  const serviceType = getCurrentEventServiceType();
  const isPackageMode = serviceType === 'package';

  console.log('updateDisplayMode called:', {
    serviceType,
    isPackageMode,
    currentEvent,
    eventSelectorValue: document.getElementById('eventSelector').value
  });

  // Hide/show prices in menu
  document.querySelectorAll('.menu-item-price').forEach(priceElement => {
    priceElement.style.display = isPackageMode ? 'none' : 'block';
  });

  // Toggle package-mode class on body for CSS targeting
  if (isPackageMode) {
    document.body.classList.add('package-mode');
  } else {
    document.body.classList.remove('package-mode');
  }

  // Update order total display
  updateOrderDisplay();
  
  // Update sales/cups display based on service type
  updateTotalSalesDisplay();
}

function getEventDisplayName(eventKey) {
  const key = eventKey !== undefined ? eventKey : currentEvent;
  const cached = JSON.parse(localStorage.getItem('cachedEvents') || '[]');
  const found = cached.find(e => e.key === key && !e.archived)
    || cached.find(e => e.key === key);
  if (found && found.name) return found.name;
  if (key === 'pop-up') return 'Legacy Data';
  // Remove 'popup-' prefix and format nicely
  return key.replace('popup-', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function createCategoryElement(category) {
  // Create category div
  const categoryDiv = document.createElement('div');
  categoryDiv.className = 'menu-category';

  // Create category label
  const categoryLabel = document.createElement('div');
  categoryLabel.className = 'menu-category-label';

  // Create category name
  const categoryName = document.createElement('h1');
  categoryName.className = 'menu-category-name';
  categoryName.textContent = category.name;

  // Create spacer
  const spacer = document.createElement('div');
  spacer.className = 'spacer';

  // Assemble category element
  categoryLabel.appendChild(categoryName);
  categoryLabel.appendChild(spacer);
  categoryDiv.appendChild(categoryLabel);

  return categoryDiv;
}

// Function to generate acronym from item name
function generateAcronym(name) {
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase())
    .join('')
    .substring(0, 4); // Limit to 4 characters
}

// Function to get shorthand for an item
function getItemShorthand(item) {
  if (item.shorthand) {
    return item.shorthand;
  }
  return generateAcronym(item.name);
}

// Format digits in text with styled spans, but ONLY in plain text (not inside HTML tags).
// This prevents corrupting names like 'signature <span class="text-span-2">matchanese</span> latte'
// where the "2" in the class name would otherwise break the HTML.
function formatDigitsInText(str, spanStyle = 'font-family: Poppins, sans-serif; font-weight: 600;') {
  if (!str || typeof str !== 'string') return str;
  const tagRegex = /(<[^>]+>)/g;
  return str.split(tagRegex).map(part =>
    part.startsWith('<') ? part : part.replace(/(\d+)/g, `<span style="${spanStyle}">$1</span>`)
  ).join('');
}

// Add matchanese class to spans containing "matchanese" for extra weight (works with any menu source)
function ensureMatchaneseClass(element) {
  if (!element) return;
  element.querySelectorAll('.text-span-2').forEach(span => {
    if (span.textContent.toLowerCase().trim() === 'matchanese') {
      span.classList.add('matchanese');
    }
  });
}

function createMenuItemElement(item) {
  // Create menu item div
  const menuItemDiv = document.createElement('div');
  menuItemDiv.className = 'menu-item';

  // Make the entire item clickable
  menuItemDiv.addEventListener('click', () => showCustomizationModal(item));
  menuItemDiv.style.cursor = 'pointer';

  if (isGridView) {
    return createGridMenuItemElement(item);
  } else {
    return createListMenuItemElement(item);
  }
}

function createListMenuItemElement(item) {
  // Create menu item div
  const menuItemDiv = document.createElement('div');
  menuItemDiv.className = 'menu-item';

  // Make the entire item clickable
  menuItemDiv.addEventListener('click', () => showCustomizationModal(item));
  menuItemDiv.style.cursor = 'pointer';

  // Create first line (name, tags, price)
  const firstLine = document.createElement('div');
  firstLine.className = 'menu-item-line';

  // Create name (remove individual click event)
  const itemName = document.createElement('h1');
  itemName.className = 'menu-item-name';
  
  const formattedName = formatDigitsInText(item.name);
  itemName.innerHTML = formattedName;
  ensureMatchaneseClass(itemName);
  firstLine.appendChild(itemName);

  // Add tags if any
  if (item.tags && item.tags.length > 0) {
    item.tags.forEach(tag => {
      const tagElement = document.createElement('h1');
      tagElement.className = 'menu-item-tag';
      tagElement.textContent = tag;
      firstLine.appendChild(tagElement);
    });
  }

  // Create price
  const price = document.createElement('h1');
  price.className = 'menu-item-price';
  price.innerHTML = `<span class="text-span-2-copy">Php </span>${item.price}`;
  firstLine.appendChild(price);

  // Create second line (description, type)
  const secondLine = document.createElement('div');
  secondLine.className = 'menu-item-line';

  // Add description if any
  if (item.description) {
    const desc = document.createElement('h1');
    desc.className = 'menu-item-desc';
    
    const formattedDescription = formatDigitsInText(item.description);
    desc.innerHTML = formattedDescription;
    secondLine.appendChild(desc);
  }

  // Add type if any
  if (item.type) {
    const type = document.createElement('h1');
    type.className = 'menu-item-type';
    type.textContent = item.type;
    secondLine.appendChild(type);
  }

  // Assemble menu item
  menuItemDiv.appendChild(firstLine);
  menuItemDiv.appendChild(secondLine);

  return menuItemDiv;
}

function createGridMenuItemElement(item) {
  // Create menu item div
  const menuItemDiv = document.createElement('div');
  menuItemDiv.className = 'menu-item';

  // Make the entire item clickable
  menuItemDiv.addEventListener('click', () => showCustomizationModal(item));
  menuItemDiv.style.cursor = 'pointer';

  const shorthand = document.createElement('h1');
  shorthand.className = 'menu-item-shorthand';
  const shorthandText = getItemShorthand(item);
  shorthand.innerHTML = formatDigitsInText(shorthandText);
  menuItemDiv.appendChild(shorthand);

  const itemName = document.createElement('h1');
  itemName.className = 'menu-item-name';
  itemName.innerHTML = formatDigitsInText(item.name);
  ensureMatchaneseClass(itemName);
  menuItemDiv.appendChild(itemName);

  return menuItemDiv;
}

// In the part of your script.js that renders menu items, update or add this function

// Add this to your script.js file

// Order management
let currentOrder = [];
let orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');

// Freeze a copy of whatever is on this device before any Firebase merge/event-switch
// can hide or overwrite it. Never replace a larger backup with a smaller/empty one.
(function snapshotOrderHistoryBackup() {
  try {
    const raw = localStorage.getItem('orderHistory') || '[]';
    const current = JSON.parse(raw);
    if (!Array.isArray(current) || current.length === 0) return;

    const existingRaw = localStorage.getItem('orderHistoryBackup');
    const existing = existingRaw ? JSON.parse(existingRaw) : [];
    if (Array.isArray(existing) && existing.length > current.length) return;

    localStorage.setItem('orderHistoryBackup', raw);
    localStorage.setItem('orderHistoryBackupAt', new Date().toISOString());
  } catch (error) {
    console.error('Failed to snapshot orderHistory backup:', error);
  }
})();

function sanitizeOrderItemName(name) {
  return (name || '').replace(/<[^>]*>/g, '');
}

function buildLiveSessionPayload(extras = {}) {
  const items = currentOrder.map(item => {
    const quantity = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    return {
      name: sanitizeOrderItemName(item.name),
      quantity,
      unitPrice: price,
      lineTotal: quantity * price,
      customizations: item.customizations || null
    };
  });

  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const hasItems = currentOrder.length > 0;
  const hasName = Boolean((customerName || '').trim());
  const computedStatus = hasItems
    ? (liveSessionState.status === 'idle' ? 'editing' : liveSessionState.status)
    : (hasName ? 'editing' : 'idle');

  return {
    customerName,
    items,
    total,
    paymentMethod: liveSessionState.paymentMethod,
    showQr: liveSessionState.showQr,
    status: computedStatus,
    ...extras
  };
}

function scheduleLiveSessionPublish(forceImmediate = false, extras = {}) {
  if (liveSessionPublishTimer) {
    clearTimeout(liveSessionPublishTimer);
    liveSessionPublishTimer = null;
  }

  const publish = () => {
    publishLiveSession(currentEvent, buildLiveSessionPayload(extras));
  };

  if (forceImmediate) {
    publish();
    return;
  }

  liveSessionPublishTimer = setTimeout(publish, 150);
}

function generateOrderId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 5).toUpperCase();
}

function addToOrder(item) {
  // Check if item is already in order
  const existingItemIndex = currentOrder.findIndex(orderItem =>
    orderItem.name === item.name && orderItem.type === item.type);

  if (existingItemIndex > -1) {
    // Increment quantity if item already exists
    currentOrder[existingItemIndex].quantity += 1;
  } else {
    // Add new item with quantity 1
    currentOrder.push({
      ...item,
      quantity: 1
    });
  }

  updateOrderDisplay();
}

function removeFromOrder(index) {
  currentOrder.splice(index, 1);
  updateOrderDisplay();
}

function updateQuantity(index, newQuantity) {
  if (newQuantity < 1) {
    removeFromOrder(index);
  } else {
    currentOrder[index].quantity = newQuantity;
    updateOrderDisplay();
  }
}

function updateOrderDisplay() {
  const serviceType = getCurrentEventServiceType();
  const isPackageMode = serviceType === 'package';
  const orderItemsContainer = document.querySelector('.order-items');

  // Clear current display
  orderItemsContainer.innerHTML = '';

  if (currentOrder.length === 0) {
    // Show empty message
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'empty-order-message';
    emptyMessage.textContent = 'Your order is empty';
    orderItemsContainer.appendChild(emptyMessage);

    // Update totals based on mode
    if (isPackageMode) {
      document.querySelector('.order-total .price').textContent = '0 drinks';
    } else {
      document.querySelector('.order-total .price').textContent = '₱ 0.00';
    }
    // DON'T return here - let it continue to payment method switching
  } else {
    // All the existing item rendering code goes here
    // (move all the forEach code and item creation here)
  }

  // Payment method switching logic (always runs regardless of items)
  const popupPaymentMethods = document.querySelector('.popup-payment-methods');
  const packagePaymentMethods = document.querySelector('.package-payment-methods');

  if (isPackageMode) {
    popupPaymentMethods.style.display = 'none';
    packagePaymentMethods.style.display = 'flex';
  } else {
    popupPaymentMethods.style.display = 'flex';
    packagePaymentMethods.style.display = 'none';
  }

  // Calculate totals
  let subtotal = 0;
  let totalCups = 0;

  // Create order item elements
  currentOrder.forEach((item, index) => {
    const itemTotal = item.price * item.quantity;
    subtotal += itemTotal;
    totalCups += item.quantity;

    const orderItemElement = document.createElement('div');
    orderItemElement.className = 'order-item';

    const orderItemHeader = document.createElement('div');
    orderItemHeader.className = 'order-item-header';

    const orderItemName = document.createElement('div');
    orderItemName.className = 'order-item-name';
    orderItemName.textContent = item.name.replace(/<[^>]*>/g, '');
    orderItemName.style.cursor = 'pointer';
    orderItemName.addEventListener('click', () => editOrderItem(index));

    // Add customization text (same as before)
    if (item.customizations) {
      const customText = document.createElement('div');
      customText.className = 'edit-custm-text';
      customText.style.fontSize = '12px';
      customText.style.fontWeight = '300';
      customText.style.color = '#666';
      customText.style.cursor = 'pointer';

      const customDisplay = [];
      if (item.customizations.variant) customDisplay.push(item.customizations.variant);
      if (!HIDE_SIZE_CUSTOMIZATION && item.customizations.size) customDisplay.push(item.customizations.size);
      if (item.customizations.serving) customDisplay.push(item.customizations.serving);
      if (item.customizations.sweetness) {
        const sweetnessSpan = document.createElement('span');
        sweetnessSpan.style.fontFamily = 'Poppins, sans-serif';
        sweetnessSpan.style.fontWeight = '700';
        sweetnessSpan.textContent = item.customizations.sweetness;
        customDisplay.push(sweetnessSpan.outerHTML);
      }
      if (item.customizations.milk) customDisplay.push(item.customizations.milk);
      if (item.customizations.strengthLevel) customDisplay.push(`Strength ${item.customizations.strengthLevel}`);
      if (item.customizations.matchaStrength) customDisplay.push(`Strength ${String(item.customizations.matchaStrength).replace('Level ', '')}`);
      if (item.customizations.matchaOption) customDisplay.push(formatMatchaOptionLabel(item.customizations.matchaOption));

      if (item.customizations.discount && item.customizations.discount !== 'none') {
        const discountBadge = document.createElement('span');
        discountBadge.style.backgroundColor = '#1d8a00';
        discountBadge.style.color = 'white';
        discountBadge.style.fontSize = '10px';
        discountBadge.style.padding = '2px 5px';
        discountBadge.style.borderRadius = '4px';
        discountBadge.style.marginLeft = '5px';
        
        discountBadge.textContent = getCustomDiscountLabel(item.customizations);
        
        orderItemName.appendChild(discountBadge);
      }

      customText.innerHTML = customDisplay.join(' | ');
      customText.addEventListener('click', (e) => {
        e.stopPropagation();
        editOrderItem(index);
      });
      orderItemName.appendChild(customText);
    }

    orderItemHeader.appendChild(orderItemName);

    // Show/hide price based on mode
    if (!isPackageMode) {
              const orderItemPrice = document.createElement('div');
        orderItemPrice.className = 'order-item-price';
        orderItemPrice.textContent = '₱ ' + itemTotal.toFixed(2);
        orderItemHeader.appendChild(orderItemPrice);
    }

    orderItemElement.appendChild(orderItemHeader);

    // Add controls (same for both modes)
    const orderItemControls = document.createElement('div');
    orderItemControls.className = 'order-item-controls';

    const quantityControl = document.createElement('div');
    quantityControl.className = 'quantity-control';

    const minusBtn = document.createElement('button');
    minusBtn.className = 'quantity-btn';
    minusBtn.textContent = '-';
    minusBtn.addEventListener('click', () => updateQuantity(index, item.quantity - 1));
    quantityControl.appendChild(minusBtn);

    const quantityDisplay = document.createElement('span');
    quantityDisplay.className = 'quantity-display';
    quantityDisplay.textContent = item.quantity;
    quantityControl.appendChild(quantityDisplay);

    const plusBtn = document.createElement('button');
    plusBtn.className = 'quantity-btn';
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', () => updateQuantity(index, item.quantity + 1));
    quantityControl.appendChild(plusBtn);

    orderItemControls.appendChild(quantityControl);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeFromOrder(index));
    orderItemControls.appendChild(removeBtn);

    orderItemElement.appendChild(orderItemControls);
    orderItemsContainer.appendChild(orderItemElement);
  });

  if (isPackageMode) {
    document.querySelector('.order-total .price').textContent = `${totalCups} drinks`;
    popupPaymentMethods.style.display = 'none';
    packagePaymentMethods.style.display = 'flex';
  } else {
            document.querySelector('.order-total .price').textContent = '₱ ' + subtotal.toFixed(2);
    popupPaymentMethods.style.display = 'flex';
    packagePaymentMethods.style.display = 'none';
  }

  // Sync mobile order button total and item count
  const mobileTotal = document.querySelector('.mobile-order-total');
  if (mobileTotal) {
    if (isPackageMode) {
      mobileTotal.textContent = `${totalCups} item${totalCups !== 1 ? 's' : ''}`;
    } else {
      mobileTotal.textContent = '₱ ' + subtotal.toFixed(2);
    }
  }
  const mobileViewText = document.querySelector('#mobileOrderButton > span:first-child');
  if (mobileViewText) {
    const itemsCount = currentOrder.reduce((sum, item) => sum + item.quantity, 0);
    mobileViewText.textContent = itemsCount > 0
      ? `VIEW ORDER (${itemsCount} ${itemsCount === 1 ? 'item' : 'items'})`
      : 'VIEW ORDER';
  }

  scheduleLiveSessionPublish();
}

// Toggle between menu and orders view
document.querySelector('.menu-header').addEventListener('click', () => {
  const menuContainer = document.getElementById('menu-container');
  const ordersContainer = document.getElementById('orders-container');
  const menuHeader = document.querySelector('.menu-header');
  const viewToggleContainer = document.querySelector('.view-toggle-container');

  if (menuContainer.style.display === 'none') {
    // Switch to menu view
    menuContainer.style.display = 'flex';
    if (window.innerWidth > 767) {
      openOrderPanel();
    } else {
      document.getElementById('mobileOrderButton').style.display = 'flex';
    }
    ordersContainer.style.display = 'none';
    menuHeader.innerHTML = 'MATCHA BAR <span class="light">MENU</span>';
    viewToggleContainer.style.display = 'block';
  } else {
    // Switch to orders view
    menuContainer.style.display = 'none';
    closeOrderPanel();
    document.getElementById('mobileOrderButton').style.display = 'none';
    ordersContainer.style.display = 'flex';
    menuHeader.innerHTML = 'MATCHA BAR <span class="light">ORDERS</span>';
    viewToggleContainer.style.display = 'none';
    displayOrderHistory();
    // After rendering, fix padding so cards aren't hidden under the fixed orders-header
    setTimeout(adjustOrdersContentPadding, 50);
  }
});

function displayOrderHistory() {
  const ordersContent = document.getElementById('ordersContent');
  const orderGrid = ordersContent.querySelector('.orders-grid') || document.createElement('div');

  if (!orderGrid.parentNode) {
    orderGrid.className = 'orders-grid';
    ordersContent.appendChild(orderGrid);
  }

  orderGrid.innerHTML = '';  // Clear only the grid

  const today = new Date();
  const isToday = getLocalDateString(selectedDate) === getLocalDateString(today);

  // Filter orders by selected date AND current event
  const selectedDateOrders = orderHistory.filter(order => {
    const orderEvent = order.event || 'pop-up';
    return getLocalDateString(new Date(order.timestamp)) === getLocalDateString(selectedDate) &&
      orderEvent === currentEvent;
  });

  if (selectedDateOrders.length === 0) {
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'empty-order-message';
    emptyMessage.textContent = isToday ? 'No orders yet' : 'No orders for this date';
    emptyMessage.style.margin = '80px auto';
    orderGrid.appendChild(emptyMessage);
    updateTotalSalesDisplay();
    return;
  }

  // Single continuous flat row for all screen sizes
  const flatRow = document.createElement('div');
  flatRow.className = 'order-cards-row';

  function makeSection(label, orders, isCompleted, isVoided) {
    if (orders.length === 0) return null;
    const group = document.createElement('div');
    group.className = 'order-section-group';

    const header = document.createElement('div');
    header.className = 'order-section-divider';
    header.textContent = label;
    group.appendChild(header);

    const cardsRow = document.createElement('div');
    cardsRow.className = 'order-section-cards';

    // For pending orders, compute queue positions by oldest-first ordering
    let queueMap = null;
    if (!isCompleted && !isVoided) {
      const sorted = [...orders].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      queueMap = {};
      sorted.forEach((o, i) => { queueMap[o.id] = i + 1; });
    }

    orders.forEach(order => {
      const pos = queueMap ? queueMap[order.id] : null;
      cardsRow.appendChild(createOrderCard(order, isCompleted, isVoided, pos));
    });
    group.appendChild(cardsRow);

    return group;
  }

  if (isToday) {
    const pendingOrders = selectedDateOrders
      .filter(order => order.status === 'pending')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const completedOrders = selectedDateOrders
      .filter(order => order.status === 'completed')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const voidedOrders = selectedDateOrders
      .filter(order => order.status === 'voided')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    [makeSection('PENDING ORDERS', pendingOrders, false, false),
     makeSection('COMPLETED ORDERS', completedOrders, true, false),
     makeSection('VOIDED ORDERS', voidedOrders, false, true)]
      .forEach(g => { if (g) flatRow.appendChild(g); });
  } else {
    const completedOrders = selectedDateOrders
      .filter(order => order.status === 'completed' || order.status === 'pending')
      .reverse();
    const voidedOrders = selectedDateOrders
      .filter(order => order.status === 'voided')
      .reverse();

    [makeSection('COMPLETED ORDERS', completedOrders, true, false),
     makeSection('VOIDED ORDERS', voidedOrders, false, true)]
      .forEach(g => { if (g) flatRow.appendChild(g); });
  }

  orderGrid.appendChild(flatRow);

  updateTotalSalesDisplay();
  if (window.innerWidth <= 767) {
    setTimeout(adjustOrdersContentPadding, 50);
  }
}

function calculateTotalSales(date) {
  const selectedDateOrders = orderHistory.filter(order => {
    const orderEvent = order.event || 'pop-up'; // Default to 'pop-up' for existing orders
    return getLocalDateString(new Date(order.timestamp)) === getLocalDateString(date) &&
      (order.status === 'pending' || order.status === 'completed') &&
      orderEvent === currentEvent;
  });

  return selectedDateOrders.reduce((total, order) => total + order.total, 0);
}

function calculateTotalCups(date) {
  const selectedDateOrders = orderHistory.filter(order => {
    const orderEvent = order.event || 'pop-up'; // Default to 'pop-up' for existing orders
    return getLocalDateString(new Date(order.timestamp)) === getLocalDateString(date) &&
      (order.status === 'pending' || order.status === 'completed') &&
      orderEvent === currentEvent;
  });

  // For package orders, total represents cup count
  // For regular orders, sum up all item quantities
  return selectedDateOrders.reduce((total, order) => {
    if (order.serviceType === 'package') {
      return total + (order.total || 0); // total field contains cup count for package orders
    } else {
      // For regular orders, sum up quantities of all items
      return total + order.items.reduce((itemTotal, item) => itemTotal + item.quantity, 0);
    }
  }, 0);
}

function getPendingOrdersCount(date) {
  const selectedDateOrders = orderHistory.filter(order => {
    const orderEvent = order.event || 'pop-up'; // Default to 'pop-up' for existing orders
    return getLocalDateString(new Date(order.timestamp)) === getLocalDateString(date) &&
      order.status === 'pending' &&
      orderEvent === currentEvent;
  });
  
  return selectedDateOrders.length;
}

function getPendingItemsCount(date) {
  const selectedDateOrders = orderHistory.filter(order => {
    const orderEvent = order.event || 'pop-up'; // Default to 'pop-up' for existing orders
    return getLocalDateString(new Date(order.timestamp)) === getLocalDateString(date) &&
      order.status === 'pending' &&
      orderEvent === currentEvent;
  });
  
  return selectedDateOrders.reduce((total, order) => {
    return total + order.items.reduce((itemTotal, item) => itemTotal + item.quantity, 0);
  }, 0);
}

function adjustOrdersContentPadding() {
  const ordersHeader = document.querySelector('.orders-header');
  const ordersContent = document.getElementById('ordersContent');
  const ordersGrid = ordersContent ? ordersContent.querySelector('.orders-grid') : null;
  if (!ordersHeader || !ordersContent) return;

  const headerHeight = ordersHeader.getBoundingClientRect().height;
  // Content padding: push cards below the fixed orders-header
  ordersContent.style.paddingTop = (headerHeight + 10) + 'px';

  // Grid height: use actual window.innerHeight (Safari-safe) minus the real header heights
  if (ordersGrid && window.innerWidth <= 767) {
    const mainHeaderHeight = 60; // Fixed main header
    const safeAreaBottom = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--sab') || '0'
    ) || 0;
    const totalOffset = mainHeaderHeight + headerHeight + 10 + safeAreaBottom;
    ordersGrid.style.height = (window.innerHeight - totalOffset) + 'px';
  }
}

function showItemSummaryModal() {
  const serviceType = getCurrentEventServiceType();
  const isPackageMode = serviceType === 'package';

  const ordersForDate = orderHistory.filter(order => {
    const orderEvent = order.event || 'pop-up';
    return getLocalDateString(new Date(order.timestamp)) === getLocalDateString(selectedDate) &&
      (order.status === 'pending' || order.status === 'completed') &&
      orderEvent === currentEvent;
  });

  // Tally items
  const itemMap = {};
  ordersForDate.forEach(order => {
    order.items.forEach(item => {
      const key = item.name ? item.name.replace(/<[^>]*>/g, '') : 'Unknown';
      if (!itemMap[key]) itemMap[key] = 0;
      itemMap[key] += item.quantity;
    });
  });

  // Build modal
  const overlay = document.createElement('div');
  overlay.className = 'item-summary-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:12px;padding:24px;max-width:400px;width:100%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2);';

  const title = document.createElement('h3');
  title.textContent = isPackageMode ? 'ITEM BREAKDOWN (CUPS)' : 'ITEM BREAKDOWN (SALES)';
  title.style.cssText = 'font-family:Poppins,sans-serif;font-size:14px;font-weight:700;letter-spacing:1px;color:#333;margin:0 0 16px;text-align:center;';
  modal.appendChild(title);

  const entries = Object.entries(itemMap).sort((a, b) => b[1] - a[1]);
  entries.forEach(([name, qty]) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;font-family:Poppins,sans-serif;font-size:13px;color:#444;';
    row.innerHTML = `<span>${name}</span><span style="font-weight:700;color:#1d8a00;">${qty}</span>`;
    modal.appendChild(row);
  });

  // Tally milk types and matcha option
  let dairyCount = 0;
  let oatCount = 0;
  let akiCount = 0;
  let natsuCount = 0;
  ordersForDate.forEach(order => {
    order.items.forEach(item => {
      const qty = item.quantity || 1;
      if (item.customizations && item.customizations.milk) {
        if (item.customizations.milk === 'dairy') dairyCount += qty;
        else if (item.customizations.milk === 'oat') oatCount += qty;
      }
      if (item.customizations && item.customizations.matchaOption) {
        if (item.customizations.matchaOption === 'aki') akiCount += qty;
        else if (item.customizations.matchaOption === 'natsu') natsuCount += qty;
      }
    });
  });

  if (dairyCount > 0 || oatCount > 0) {
    const milkTitle = document.createElement('h4');
    milkTitle.textContent = 'MILK TYPE';
    milkTitle.style.cssText = 'font-family:Poppins,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;color:#aaa;margin:16px 0 4px;text-align:center;';
    modal.appendChild(milkTitle);

    [['dairy', dairyCount], ['oat', oatCount]].forEach(([label, count]) => {
      if (count === 0) return;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f0f0f0;font-family:Poppins,sans-serif;font-size:13px;color:#444;';
      row.innerHTML = `<span style="text-transform:capitalize;">${label} milk</span><span style="font-weight:700;color:#1d8a00;">${count}</span>`;
      modal.appendChild(row);
    });
  }

  if (akiCount > 0 || natsuCount > 0) {
    const matchaTitle = document.createElement('h4');
    matchaTitle.textContent = 'MATCHA OPTION';
    matchaTitle.style.cssText = 'font-family:Poppins,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;color:#aaa;margin:16px 0 4px;text-align:center;';
    modal.appendChild(matchaTitle);

    [['Aki', akiCount], ['Natsu', natsuCount]].forEach(([label, count]) => {
      if (count === 0) return;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f0f0f0;font-family:Poppins,sans-serif;font-size:13px;color:#444;';
      row.innerHTML = `<span>${label}</span><span style="font-weight:700;color:#1d8a00;">${count}</span>`;
      modal.appendChild(row);
    });
  }

  if (!isPackageMode) {
    const salesSummaryBtn = document.createElement('button');
    salesSummaryBtn.textContent = 'SALES SUMMARY';
    salesSummaryBtn.style.cssText = 'margin-top:16px;width:100%;padding:12px;background:transparent;color:#1d8a00;border:2px solid #1d8a00;border-radius:8px;font-family:Poppins,sans-serif;font-size:13px;font-weight:700;letter-spacing:1px;cursor:pointer;';
    salesSummaryBtn.addEventListener('click', () => { overlay.remove(); showEndOfDayModal(); });
    modal.appendChild(salesSummaryBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'CLOSE';
  closeBtn.style.cssText = 'margin-top:8px;width:100%;padding:12px;background:#1d8a00;color:#fff;border:none;border-radius:8px;font-family:Poppins,sans-serif;font-size:13px;font-weight:700;letter-spacing:1px;cursor:pointer;';
  closeBtn.addEventListener('click', () => overlay.remove());
  modal.appendChild(closeBtn);

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function updateTotalSalesDisplay() {
  const serviceType = getCurrentEventServiceType();
  const isPackageMode = serviceType === 'package';
  
  const salesAmount = document.getElementById('salesAmount');
  const salesLabel = document.getElementById('salesLabel');
  const salesSubLabel = document.getElementById('salesSubLabel');
  
  if (isPackageMode) {
    const totalCups = calculateTotalCups(selectedDate);
    if (salesAmount) salesAmount.textContent = totalCups.toString();
    if (salesLabel) salesLabel.textContent = 'TOTAL CUPS';
    if (salesSubLabel) {
      const pendingOrders = getPendingOrdersCount(selectedDate);
      const pendingItems = getPendingItemsCount(selectedDate);
      salesSubLabel.innerHTML = `${pendingOrders} PENDING ORDERS<br>${pendingItems} PENDING ITEMS`;
    }
  } else {
    const totalSales = calculateTotalSales(selectedDate);
    if (salesAmount) salesAmount.textContent = `₱${totalSales.toFixed(2)}`;
    if (salesLabel) salesLabel.textContent = 'TOTAL SALES';
    if (salesSubLabel) {
      const pendingOrders = getPendingOrdersCount(selectedDate);
      salesSubLabel.innerHTML = `${pendingOrders} PENDING`;
    }
  }

  if (window.innerWidth <= 767) {
    setTimeout(adjustOrdersContentPadding, 30);
  }
}

function getQueueLabel(pos) {
  if (pos === 1) return 'NEXT';
  const suffix = pos === 2 ? 'ND' : pos === 3 ? 'RD' : 'TH';
  return `${pos}${suffix}`;
}

function isOrderFullyPrepared(order) {
  return Array.isArray(order?.items) &&
    order.items.length > 0 &&
    order.items.every(item => Boolean(item.prepared));
}

function setItemPrepared(orderId, itemIndex, prepared) {
  const orderIndex = orderHistory.findIndex(order => order.id === orderId);
  if (orderIndex === -1) return;

  const order = orderHistory[orderIndex];
  if (!Array.isArray(order.items) || !order.items[itemIndex]) return;

  order.items[itemIndex].prepared = Boolean(prepared);

  const wasReady = Boolean(order.readyAt);
  const nowReady = isOrderFullyPrepared(order);
  if (nowReady && !wasReady) {
    order.readyAt = new Date().toISOString();
  } else if (!nowReady) {
    order.readyAt = null;
  }

  order.lastModified = new Date().toISOString();
  order.needsSync = true;
  localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

  syncOrderToFirebase(order).then(success => {
    if (success) {
      const latestIndex = orderHistory.findIndex(o => o.id === orderId);
      if (latestIndex > -1) {
        orderHistory[latestIndex].needsSync = false;
        localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
      }
    }
  });
}

function createOrderCard(order, isCompleted, isVoided = false, queuePosition = null) {
  const orderCard = document.createElement('div');
  orderCard.className = 'order-card' + (isCompleted ? ' completed' : '') + (isVoided ? ' voided' : '');

  const orderHeader = document.createElement('div');
  orderHeader.className = 'order-card-header';

  const orderHeaderTop = document.createElement('div');
  orderHeaderTop.className = 'order-header-top';

  const orderId = document.createElement('div');
  orderId.className = 'order-id';
  orderId.textContent = `ORDER-${order.id}`;
  orderId.style.color = isVoided ? '#ff4444' : '#1d8a00';

  const customerName = document.createElement('div');
  customerName.className = 'customer-name';
  customerName.textContent = order.customerName || '';

  orderHeaderTop.appendChild(orderId);
  orderHeaderTop.appendChild(customerName);

  const orderDateTimeRow = document.createElement('div');
  orderDateTimeRow.className = 'order-datetime-row';

  const orderDateTime = document.createElement('div');
  orderDateTime.className = 'order-datetime';
  const date = new Date(order.timestamp);
  orderDateTime.textContent = date.toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  orderDateTimeRow.appendChild(orderDateTime);

  if (queuePosition !== null) {
    const queueBadge = document.createElement('div');
    queueBadge.className = 'order-queue-badge' + (queuePosition === 1 ? ' queue-next' : '');
    queueBadge.textContent = getQueueLabel(queuePosition);
    orderDateTimeRow.appendChild(queueBadge);
  }

  orderHeader.appendChild(orderHeaderTop);
  orderHeader.appendChild(orderDateTimeRow);
  orderCard.appendChild(orderHeader);

  const orderMetaBottom = document.createElement('div');
  orderMetaBottom.className = 'order-meta-bottom';

  const orderTotalRow = document.createElement('div');
  orderTotalRow.className = 'order-total-row';

          const orderTotal = document.createElement('div');
        orderTotal.className = 'order-card-total';
        if (getCurrentEventServiceType() === 'package') {
          const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
          orderTotal.textContent = `${itemCount} item${itemCount !== 1 ? 's' : ''}`;
        } else {
          orderTotal.textContent = `₱${order.total.toFixed(2)}`;
        }

  // Only show payment method for orders that have one
  if (order.paymentMethod && order.paymentMethod.trim() !== '') {
    const orderMethod = document.createElement('div');
    orderMethod.className = 'order-card-method';
    orderMethod.textContent = order.paymentMethod.toUpperCase();
    orderTotalRow.appendChild(orderMethod);
  }
  orderTotalRow.appendChild(orderTotal);

  orderMetaBottom.appendChild(orderTotalRow);

  const orderItemsList = document.createElement('div');
  orderItemsList.className = 'order-items-list';

  order.items.forEach((item, itemIndex) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'order-card-item';

    // Create item content container
    const itemContent = document.createElement('div');
    itemContent.className = 'item-content';

    const itemName = document.createElement('div');
    itemName.className = 'item-name';

    const quantitySpan = document.createElement('span');
    quantitySpan.style.fontFamily = 'Poppins, sans-serif';
    quantitySpan.textContent = `${item.quantity}x `;

    const nameSpan = document.createElement('span');
    // Handle case where item.name might be undefined
    nameSpan.textContent = item.name
      ? item.name.replace(/<[^>]*>/g, '')
      : (item.menuItemId ? item.menuItemId.split('-').slice(1).join(' ') : 'Unknown Item');

    itemName.appendChild(quantitySpan);
    itemName.appendChild(nameSpan);
    itemContent.appendChild(itemName);

    // Add customizations if available
    if (item.customizations) {
      const customizations = document.createElement('div');
      customizations.className = 'item-customizations';

      const customDisplay = [];

      if (item.customizations.variant) customDisplay.push(item.customizations.variant);
      if (!HIDE_SIZE_CUSTOMIZATION && item.customizations.size) customDisplay.push(item.customizations.size);
      if (item.customizations.serving) customDisplay.push(item.customizations.serving);
      if (item.customizations.sweetness) {
        const sweetnessSpan = document.createElement('span');
        sweetnessSpan.style.fontFamily = 'Poppins, sans-serif';
        sweetnessSpan.style.fontWeight = '700';
        sweetnessSpan.textContent = item.customizations.sweetness;
        customDisplay.push(sweetnessSpan.outerHTML);
      }
      if (item.customizations.milk) customDisplay.push(item.customizations.milk);
      if (item.customizations.strengthLevel) customDisplay.push(`Strength ${item.customizations.strengthLevel}`);
      if (item.customizations.matchaStrength) customDisplay.push(`Strength ${String(item.customizations.matchaStrength).replace('Level ', '')}`);
      if (item.customizations.matchaOption) customDisplay.push(formatMatchaOptionLabel(item.customizations.matchaOption));
      if (item.customizations.discount && item.customizations.discount !== 'none') {
        customDisplay.push(getCustomDiscountLabel(item.customizations));
      }

      customizations.innerHTML = customDisplay.join(' | ');
      itemContent.appendChild(customizations);

      if (itemHasSavedDiscountId(item)) {
        const idLink = document.createElement('button');
        idLink.type = 'button';
        idLink.className = 'order-id-review-link';
        idLink.textContent = 'ID';
        idLink.title = 'View saved ID';
        idLink.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showSavedDiscountIdModal(item);
        });
        itemContent.appendChild(idLink);
      }
    }

    // Add checkbox for pending orders only
    if (!isCompleted && !isVoided) {
      const itemCheckbox = document.createElement('input');
      itemCheckbox.type = 'checkbox';
      itemCheckbox.className = 'item-checkbox';
      itemCheckbox.setAttribute('data-order-id', order.id);
      itemCheckbox.setAttribute('data-item-index', String(itemIndex));
      itemCheckbox.checked = Boolean(item.prepared);

      if (item.prepared) {
        itemDiv.style.opacity = '0.6';
        itemDiv.style.textDecoration = 'line-through';
      }

      itemCheckbox.addEventListener('change', function() {
        const isChecked = this.checked;
        if (isChecked) {
          itemDiv.style.opacity = '0.6';
          itemDiv.style.textDecoration = 'line-through';
        } else {
          itemDiv.style.opacity = '1';
          itemDiv.style.textDecoration = 'none';
        }
        setItemPrepared(order.id, itemIndex, isChecked);
      });

      itemDiv.appendChild(itemContent);
      itemDiv.appendChild(itemCheckbox);
    } else {
      itemDiv.appendChild(itemContent);
    }

    orderItemsList.appendChild(itemDiv);
  });

  orderCard.appendChild(orderItemsList);
  orderCard.appendChild(orderMetaBottom);

  // Replace the button logic section (starting after orderCard.appendChild(orderMetaBottom);)
  // Action buttons for pending orders
  if (!isCompleted && !isVoided) {
    const orderButtons = document.createElement('div');
    orderButtons.className = 'order-buttons';

    const editBtn = document.createElement('button');
    editBtn.className = 'order-action-btn order-edit-btn';
    editBtn.innerHTML = '<img src="images/edit-icon.png" class="btn-icon" alt="Edit">EDIT';
    editBtn.addEventListener('click', () => editOrder(order.id));

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'order-action-btn order-cancel-btn';
    cancelBtn.innerHTML = '<img src="images/cancel-icon.png" class="btn-icon" alt="Cancel">CANCEL';
    cancelBtn.addEventListener('click', () => cancelOrder(order.id));

    const doneBtn = document.createElement('button');
    doneBtn.className = 'order-action-btn order-done-btn';
    doneBtn.innerHTML = '<img src="images/done-icon.png" class="btn-icon" alt="Done">DONE';
    doneBtn.addEventListener('click', () => completeOrder(order.id));

    orderButtons.appendChild(cancelBtn);
    orderButtons.appendChild(editBtn);
    orderButtons.appendChild(doneBtn);
    orderCard.appendChild(orderButtons);
  }

  // Action buttons for completed orders (not voided)
  if (isCompleted && !isVoided) {
    const today = new Date();
    const isToday = selectedDate.toDateString() === today.toDateString();

    const orderButtons = document.createElement('div');
    orderButtons.className = 'order-buttons';

    // Only show RETURN button if viewing today's date
    if (isToday) {
      const returnBtn = document.createElement('button');
      returnBtn.className = 'order-action-btn order-return-btn';
      returnBtn.innerHTML = '<img src="images/return-icon.png" class="btn-icon" alt="Return">RETURN';
      returnBtn.addEventListener('click', () => returnToPending(order.id));
      orderButtons.appendChild(returnBtn);
    }

    const voidBtn = document.createElement('button');
    voidBtn.className = 'order-action-btn order-void-btn';
    voidBtn.innerHTML = '<img src="images/cancel-icon.png" class="btn-icon" alt="Void">VOID';
    voidBtn.addEventListener('click', () => voidOrder(order.id));
    orderButtons.appendChild(voidBtn);

    orderCard.appendChild(orderButtons);
  }

  // If voided, show "VOIDED" text instead of buttons
  if (isVoided) {
    const voidedText = document.createElement('div');
    voidedText.className = 'voided-text';
    voidedText.textContent = 'VOIDED';
    orderCard.appendChild(voidedText);

    // Add delete button for voided orders
    const orderButtons = document.createElement('div');
    orderButtons.className = 'order-buttons';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'order-action-btn order-delete-btn';
    deleteBtn.innerHTML = '<img src="images/delete-icon.png" class="btn-icon" alt="Delete">DELETE';
    deleteBtn.addEventListener('click', () => deleteOrder(order.id));

    orderButtons.appendChild(deleteBtn);
    orderCard.appendChild(orderButtons);
  }

  return orderCard;
}

// Add this new function to delete an order
function deleteOrder(orderId) {
  showConfirmationModal(
    'delete',
    orderId,
    'DELETE ORDER',
    'Are you sure you want to permanently delete this order? This cannot be undone.'
  );
}

function deleteOrderConfirmed(orderId) {
  const orderIndex = orderHistory.findIndex(order => order.id === orderId);
  if (orderIndex > -1) {
    // Mark as deleted but DON'T remove from local storage
    orderHistory[orderIndex].status = 'deleted';
    orderHistory[orderIndex].lastModified = new Date().toISOString();
    orderHistory[orderIndex].needsSync = true;
    
    // Update local storage with the 'deleted' status
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
    
    // Update Firebase with deleted status
    const orderDate = getLocalDateString(new Date(orderHistory[orderIndex].timestamp));

    syncOrderToFirebase(orderHistory[orderIndex]).then(success => {
      if (success) {
        orderHistory[orderIndex].needsSync = false;
        localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
      }
    });
    
    // Update display (which will filter out deleted items)
    displayOrderHistory();
  }
}

function editOrder(orderId) {
  const order = orderHistory.find(o => o.id === orderId);
  if (!order) return;

  // Store the original order ID and Firebase ID for later use
  const originalOrderId = order.id;
  const firebaseId = order.firebaseId;

  // Load items into current order
  currentOrder = order.items.map(item => ({ ...item }));
  customerName = order.customerName || '';

  // Remove from order history temporarily (we'll add it back when completing)
  const orderIndex = orderHistory.findIndex(o => o.id === orderId);
  if (orderIndex > -1) {
    orderHistory.splice(orderIndex, 1);
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
  }

  // Store original order info in a temporary variable for later use
  window.editingOrderData = {
    originalId: originalOrderId,
    firebaseId: firebaseId,
    timestamp: order.timestamp,
    status: order.status,
    paymentMethod: order.paymentMethod
  };

  // Switch to menu view
  const menuContainer = document.getElementById('menu-container');
  const ordersContainer = document.getElementById('orders-container');
  const menuHeader = document.querySelector('.menu-header');

  menuContainer.style.display = 'flex';
  openOrderPanel();
  ordersContainer.style.display = 'none';
  menuHeader.innerHTML = 'MATCHA BAR <span class="light">MENU</span>';

  updateOrderDisplay();
  updateOrderHeader();
}

function returnToPending(orderId) {
  const orderIndex = orderHistory.findIndex(order => order.id === orderId);
  if (orderIndex > -1) {
    orderHistory[orderIndex].status = 'pending';
    orderHistory[orderIndex].lastModified = new Date().toISOString(); // Add timestamp
    orderHistory[orderIndex].needsSync = true;
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

    // Pass order date to sync queue
    const orderDate = getLocalDateString(new Date(orderHistory[orderIndex].timestamp));

    syncOrderToFirebase(orderHistory[orderIndex]).then(success => {
      if (success) {
        orderHistory[orderIndex].needsSync = false;
        localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
      }
    });

    displayOrderHistory();
  }
}

// Replace existing cancelOrder function:
function cancelOrder(orderId) {
  showConfirmationModal(
    'cancel',
    orderId,
    'CANCEL ORDER',
    'Are you sure you want to cancel this order?'
  );
}

function cancelOrderConfirmed(orderId) {
  const orderIndex = orderHistory.findIndex(order => order.id === orderId);
  if (orderIndex > -1) {
    // Mark as deleted but DON'T remove from local storage
    orderHistory[orderIndex].status = 'deleted';
    orderHistory[orderIndex].lastModified = new Date().toISOString();
    orderHistory[orderIndex].needsSync = true;

    // Update local storage with the 'deleted' status
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

    // Update Firebase with 'deleted' status
    const orderDate = getLocalDateString(new Date(orderHistory[orderIndex].timestamp));

    syncOrderToFirebase(orderHistory[orderIndex]).then(success => {
      if (success) {
        orderHistory[orderIndex].needsSync = false;
        localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
      }
    });

    // Update display (which will filter out deleted items)
    displayOrderHistory();
  }
}

// Replace existing voidOrder function:
function voidOrder(orderId) {
  showConfirmationModal(
    'void',
    orderId,
    'VOID ORDER',
    'Are you sure you want to void this order?'
  );
}

function voidOrderConfirmed(orderId) {
  const orderIndex = orderHistory.findIndex(order => order.id === orderId);
  if (orderIndex > -1) {
    orderHistory[orderIndex].status = 'voided';
    orderHistory[orderIndex].lastModified = new Date().toISOString();
    orderHistory[orderIndex].needsSync = true;
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

    // Pass order date to sync queue
    const orderDate = getLocalDateString(new Date(orderHistory[orderIndex].timestamp));

    syncOrderToFirebase(orderHistory[orderIndex]).then(success => {
      if (success) {
        orderHistory[orderIndex].needsSync = false;
        localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
      }
    });

    displayOrderHistory();
  }
}

function getLocalDateString(date = new Date()) {
  // Get local date components
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Push this event's orders for a date to Firebase. EOD totals live locally; admin dashboard reads Firebase. */
async function flushCurrentEventOrdersToFirebase(dateStr) {
  const orders = orderHistory.filter((order) => {
    const orderEvent = order.event || 'pop-up';
    return getLocalDateString(new Date(order.timestamp)) === dateStr
      && orderEvent === currentEvent
      && order.status !== 'deleted';
  });

  let synced = 0;
  let failed = 0;
  for (const order of orders) {
    const success = await syncOrderToFirebase(order);
    if (success) {
      const idx = orderHistory.findIndex((o) => o.id === order.id);
      if (idx > -1) orderHistory[idx].needsSync = false;
      synced += 1;
    } else {
      failed += 1;
    }
  }
  localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
  return { synced, failed, total: orders.length };
}

async function finalizeEventSalesSubmission({
  overlay,
  confirmBtn,
  record,
  salesRef,
  cashFlowKey,
  cashFlowData,
  eventName,
  dateStr,
  summaryHTML
}) {
  const originalText = confirmBtn?.textContent;
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'SYNCING ORDERS...';
  }

  try {
    const flush = await flushCurrentEventOrdersToFirebase(dateStr);
    await setDoc(salesRef, { ...record, timestamp: serverTimestamp() });
    sendEventSalesEmail(record, eventName, dateStr).catch((e) => console.error(e));
    localStorage.setItem(cashFlowKey, JSON.stringify(cashFlowData));
    const summaries = JSON.parse(localStorage.getItem('eodSummaries') || '[]');
    const filtered = summaries.filter((s) => !(s.date === dateStr && s.event === currentEvent));
    filtered.push(cashFlowData);
    localStorage.setItem('eodSummaries', JSON.stringify(filtered));
    overlay.remove();
    showPosSuccessModal(record, eventName, dateStr, summaryHTML);
    if (flush.failed > 0) {
      alert(`Sales report saved, but ${flush.failed} of ${flush.total} orders did not reach the admin dashboard. Tap Force Sync on this iPad, then refresh the dashboard.`);
    }
  } catch (e) {
    console.error('Failed to save event sales:', e);
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = originalText || 'Confirm';
    }
    alert('Failed to submit. Please try again.');
  }
}


function completeOrder(orderId) {
  const orderIndex = orderHistory.findIndex(order => order.id === orderId);
  if (orderIndex > -1) {
    orderHistory[orderIndex].status = 'completed';
    orderHistory[orderIndex].lastModified = new Date().toISOString();
    orderHistory[orderIndex].needsSync = true;
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

    // Pass order date to sync queue
    const orderDate = getLocalDateString(new Date(orderHistory[orderIndex].timestamp));

    syncOrderToFirebase(orderHistory[orderIndex]).then(success => {
      if (success) {
        orderHistory[orderIndex].needsSync = false;
        localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
      }
    });

    displayOrderHistory();
  }
}

function showConfirmationModal(action, orderId, title, message) {
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) {
    existingModal.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const header = document.createElement('h2');
  header.className = 'modal-header';
  header.textContent = title;
  modal.appendChild(header);

  modal.style.cssText = `
  width: 300px;
  padding: 20px;
  border-radius: 8px;
  background: #fff;
  font-family: 'Poppins', sans-serif;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
`;

  header.style.cssText = `
  border-bottom: 0px;
`;


  const messageText = document.createElement('p');
  messageText.style.cssText = `
    font-family: 'Poppins', sans-serif;
    font-size: 14px;
    text-align: center;
    margin: 20px 0;
    color: #333;
  `;
  messageText.textContent = message;
  modal.appendChild(messageText);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'checkout-button modal-cancel';
  cancelBtn.textContent = 'NO';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'checkout-button modal-add';
  confirmBtn.textContent = 'YES';
  confirmBtn.addEventListener('click', () => {
    if (action === 'cancel') {
      cancelOrderConfirmed(orderId);
    } else if (action === 'void') {
      voidOrderConfirmed(orderId);
    } else if (action === 'delete') {
      deleteOrderConfirmed(orderId);
    }
    overlay.remove();
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(confirmBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// // Initialize checkout button
// document.querySelector('.checkout-button').addEventListener('click', () => {
//   if (currentOrder.length === 0) {
//     alert('Please add items to your order first.');
//     return;
//   }

//   alert('Proceeding to checkout with ' + currentOrder.length + ' items.');
//   // Implement actual checkout functionality here
// });

// Add these functions to your JavaScript file
function showCustomizationModal(item, editMode = false, editIndex = -1) {
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) {
    existingModal.remove();
  }

  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'modal';
  // On desktop only — mobile uses full-width bottom-sheet CSS
  if (window.innerWidth > 767) {
    modal.style.maxWidth = '400px';
    modal.style.width = '90%';
  }
  
  // Store item data in modal for price calculations
  const itemData = { ...item };
  if (itemData.customizations?.idPhoto) {
    itemData.customizations = { ...itemData.customizations };
    delete itemData.customizations.idPhoto;
    delete itemData.customizations.idDetails;
  }
  modal.dataset.item = JSON.stringify(itemData);

  // Modal header
  const header = document.createElement('h2');
  header.className = 'modal-header';
  header.innerHTML = item.name.replace(/<[^>]*>/g, ''); // Remove HTML tags
  modal.appendChild(header);

  // Create grid container for options
  const optionsGrid = document.createElement('div');
  optionsGrid.className = 'modal-options-grid';

  // Get current customizations if editing; otherwise seed milk from menu default
  const currentCustomizations = editMode && item.customizations
    ? { ...item.customizations }
    : {};
  if (!editMode && !currentCustomizations.milk) {
    currentCustomizations.milk = getDefaultMilk();
  }
  pendingDiscountIdPhoto = isIdDiscountType(currentCustomizations.discount)
    ? (currentCustomizations.idPhoto || null)
    : null;
  pendingDiscountIdDetails = isIdDiscountType(currentCustomizations.discount)
    ? (currentCustomizations.idDetails || null)
    : null;

  const allowedCustomizations = item.customizations || null;
  const showAll = !allowedCustomizations;

  // Size customization (hidden from UI; data/logic preserved)
  if (!HIDE_SIZE_CUSTOMIZATION && (!allowedCustomizations || allowedCustomizations.size)) {
    const sizeSection = createOptionSection('Size', ['regular', 'large'], currentCustomizations.size || 'large');
    optionsGrid.appendChild(sizeSection);
  }

  // Strength Level (1–3) — only when item enables it (drinks, etc.)
  if (showAll || allowedCustomizations.strengthLevel) {
    const strengthLevelSection = createOptionSection(
      'Strength Level',
      ['1', '2', '3'],
      currentCustomizations.strengthLevel || (currentCustomizations.matchaStrength ? String(currentCustomizations.matchaStrength).replace('Level ', '') : '1')
    );
    // Keep strength buttons on one row for clarity
    const strengthButtons = strengthLevelSection.querySelector('.modal-buttons');
    if (strengthButtons) {
      strengthButtons.style.flexWrap = 'nowrap';
      strengthButtons.style.justifyContent = 'flex-start';
    }
    const strengthBtns = strengthLevelSection.querySelectorAll('.option-button');
    strengthBtns.forEach(btn => {
      btn.style.minWidth = '60px';
    });
    optionsGrid.appendChild(strengthLevelSection);
  }

  if (showAll || allowedCustomizations.matchaOption) {
    if (!editMode && !currentCustomizations.matchaOption) {
      currentCustomizations.matchaOption = 'aki';
    }
    const matchaOptionSection = document.createElement('div');
    matchaOptionSection.className = 'modal-option';
    const matchaLabel = document.createElement('div');
    matchaLabel.className = 'modal-option-label';
    matchaLabel.textContent = 'Matcha Option';
    matchaOptionSection.appendChild(matchaLabel);

    const matchaButtons = document.createElement('div');
    matchaButtons.className = 'modal-buttons';
    const selectedMatcha = currentCustomizations.matchaOption || 'aki';
    [
      { id: 'aki', text: 'Aki' },
      { id: 'natsu', text: 'Natsu' }
    ].forEach(({ id, text }) => {
      const btn = document.createElement('button');
      btn.className = 'option-button';
      btn.dataset.option = id;
      btn.dataset.group = 'matcha option';
      if (selectedMatcha === id) btn.classList.add('active');
      btn.innerHTML = `<span class="option-text">${text}</span>`;
      btn.addEventListener('click', () => selectOption(btn));
      matchaButtons.appendChild(btn);
    });
    matchaOptionSection.appendChild(matchaButtons);
    optionsGrid.appendChild(matchaOptionSection);
  }

  // Don't show serving option for brew bar items since preparation includes hot/iced
  if ((!allowedCustomizations || allowedCustomizations.serving) && !item.customizations?.preparation) {
    const servingSection = createOptionSection('Serving', ['iced', 'hot'], currentCustomizations.serving || 'iced');
    optionsGrid.appendChild(servingSection);
  }

  // Add preparation method customization for brew bar items
  if (item.customizations && item.customizations.preparation) {
    const preparationOptions = Object.keys(item.customizations.preparation);
    const preparationLabels = {
      'usucha-hot': 'Usucha (Hot)',
      'usucha-iced': 'Usucha (Iced)',
      'classic-latte': 'Classic Latte (Iced)',
      'cold-whisked-latte': 'Cold-Whisked Latte (Iced)'
    };
    
    const preparationSection = createOptionSection(
      'Preparation', 
      preparationOptions.map(opt => preparationLabels[opt] || opt), 
      currentCustomizations.preparation || 'usucha-hot'
    );
    optionsGrid.appendChild(preparationSection);
  }

  // Add the optionsGrid to modal before checking sweetness and milk
  if (optionsGrid.children.length > 0) {
    modal.appendChild(optionsGrid);
  }

  // Don't show sweetness option for brew bar items since they're traditional preparations
  if ((!allowedCustomizations || allowedCustomizations.sweetness) && !item.customizations?.preparation) {
    const sweetnessSection = createOptionSection('Sweetness', ['0%', '50%', '100%', '150%', '200%'], currentCustomizations.sweetness || '100%');
    modal.appendChild(sweetnessSection);
  }

  // Create a row that will contain milk and discount side by side
  const milkDiscountRow = document.createElement('div');
  milkDiscountRow.className = 'milk-discount-row';
  milkDiscountRow.style.display = 'flex';
  milkDiscountRow.style.justifyContent = 'space-between';
  milkDiscountRow.style.gap = '20px';
  milkDiscountRow.style.marginBottom = '30px';

  // Determine if milk options are available for this item.
  // If the item defines a customizations object, milk only shows if milk is explicitly included.
  const hasMilkOptions = !allowedCustomizations || allowedCustomizations.milk;

  if (hasMilkOptions) {
    // Create milk section
    const milkSection = document.createElement('div');
    milkSection.style.flex = '1';
    milkSection.style.minWidth = '0';

    const milkLabel = document.createElement('div');
    milkLabel.className = 'modal-option-label';
    milkLabel.textContent = 'Milk';
    milkSection.appendChild(milkLabel);

    const milkButtons = document.createElement('div');
    milkButtons.className = 'modal-buttons';

    const defaultMilk = currentCustomizations.milk || getDefaultMilk();

    const dairyBtn = document.createElement('button');
    dairyBtn.className = 'option-button';
    dairyBtn.dataset.option = 'dairy';
    dairyBtn.dataset.group = 'milk';
    if (defaultMilk === 'dairy') {
      dairyBtn.classList.add('active');
    }
    dairyBtn.innerHTML = '<span class="option-text">dairy</span>';
    dairyBtn.addEventListener('click', () => selectOption(dairyBtn));

    const oatBtn = document.createElement('button');
    oatBtn.className = 'option-button';
    oatBtn.dataset.option = 'oat';
    oatBtn.dataset.group = 'milk';
    if (defaultMilk === 'oat') {
      oatBtn.classList.add('active');
    }
    oatBtn.innerHTML = '<span class="option-text">oat</span>';
    oatBtn.addEventListener('click', () => selectOption(oatBtn));

    milkButtons.appendChild(dairyBtn);
    milkButtons.appendChild(oatBtn);
    milkSection.appendChild(milkButtons);

    milkDiscountRow.appendChild(milkSection);
  }

  // Create discount section
  const discountSection = document.createElement('div');
  discountSection.className = 'discount-section';
  discountSection.style.flex = '1';

  const discountLabel = document.createElement('div');
  discountLabel.className = 'modal-option-label';
  discountLabel.textContent = 'Discount';
  discountSection.appendChild(discountLabel);

  const discountButtons = document.createElement('div');
  discountButtons.className = 'modal-buttons discount-button-grid';

  // Create toggle buttons for Senior and PWD discounts
  const seniorBtn = document.createElement('button');
  seniorBtn.className = 'option-button discount-toggle';
  seniorBtn.dataset.discount = 'senior';

  // Check if senior discount is active
  if (currentCustomizations.discount === 'senior') {
    seniorBtn.classList.add('active');
  }

  seniorBtn.innerHTML = '<span class="option-text">SENIOR</span>';
  seniorBtn.addEventListener('click', () => toggleDiscount(seniorBtn));

  const pwdBtn = document.createElement('button');
  pwdBtn.className = 'option-button discount-toggle';
  pwdBtn.dataset.discount = 'pwd';

  // Check if PWD discount is active
  if (currentCustomizations.discount === 'pwd') {
    pwdBtn.classList.add('active');
  }

  pwdBtn.innerHTML = '<span class="option-text">PWD</span>';
  pwdBtn.addEventListener('click', () => toggleDiscount(pwdBtn));

  const freeBtn = document.createElement('button');
  freeBtn.className = 'option-button discount-toggle';
  freeBtn.dataset.discount = 'free';

  if (currentCustomizations.discount === 'free') {
    freeBtn.classList.add('active');
  }

  freeBtn.innerHTML = '<span class="option-text">FREE</span>';
  freeBtn.addEventListener('click', () => toggleDiscount(freeBtn));

  discountButtons.appendChild(seniorBtn);
  discountButtons.appendChild(pwdBtn);
  discountButtons.appendChild(freeBtn);

  // CUSTOM is a div so the percent input can live inside the control (invalid inside <button>)
  const customBtn = document.createElement('div');
  customBtn.className = 'option-button discount-toggle custom-discount-toggle';
  customBtn.dataset.discount = 'custom';
  customBtn.setAttribute('role', 'button');
  customBtn.tabIndex = 0;

  if (currentCustomizations.discount === 'custom') {
    customBtn.classList.add('active');
  }

  customBtn.innerHTML = `
    <span class="option-text">CUSTOM</span>
    <span class="custom-discount-input" data-mode="percent">
      <span class="custom-discount-prefix" title="Tap to switch to percent">₱</span>
      <input type="number" id="customDiscountValue" inputmode="numeric" min="0" max="100" step="1" aria-label="Custom discount percent">
      <span class="custom-discount-suffix" title="Tap to switch to pesos">%</span>
    </span>
  `;

  const customDiscountInput = customBtn.querySelector('.custom-discount-input');
  const customValueInput = customBtn.querySelector('#customDiscountValue');
  const initialMode = currentCustomizations.customDiscountMode === 'amount' ? 'amount' : 'percent';
  if (currentCustomizations.discount === 'custom') {
    if (initialMode === 'amount' && currentCustomizations.customDiscountAmount) {
      customValueInput.value = currentCustomizations.customDiscountAmount.toString();
    } else if (currentCustomizations.customDiscountPercent) {
      customValueInput.value = currentCustomizations.customDiscountPercent.toString();
    }
  }
  setCustomDiscountMode(customDiscountInput, initialMode);
  customValueInput.addEventListener('click', (e) => e.stopPropagation());
  customValueInput.addEventListener('mousedown', (e) => e.stopPropagation());
  customDiscountInput.addEventListener('click', (e) => e.stopPropagation());
  customDiscountInput.querySelector('.custom-discount-prefix').addEventListener('click', (e) => {
    e.stopPropagation();
    setCustomDiscountMode(customDiscountInput, 'percent');
    customValueInput.focus();
  });
  customDiscountInput.querySelector('.custom-discount-suffix').addEventListener('click', (e) => {
    e.stopPropagation();
    setCustomDiscountMode(customDiscountInput, 'amount');
    customValueInput.focus();
  });
  customValueInput.addEventListener('input', () => {
    if (customDiscountInput.dataset.mode !== 'amount') {
      const n = parseFloat(customValueInput.value);
      if (!isNaN(n) && n > 100) customValueInput.value = '100';
    }
    updateItemTotal();
  });
  customValueInput.addEventListener('change', updateItemTotal);

  customBtn.addEventListener('click', (e) => {
    if (e.target.closest('.custom-discount-input')) return;
    toggleCustomDiscount(customBtn);
  });
  customBtn.addEventListener('keydown', (e) => {
    if (e.target.closest('input')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleCustomDiscount(customBtn);
    }
  });

  discountButtons.appendChild(customBtn);

  const idSavedRow = document.createElement('button');
  idSavedRow.type = 'button';
  idSavedRow.className = 'discount-id-saved';
  idSavedRow.hidden = true;
  idSavedRow.innerHTML = '<span class="discount-id-saved-check" aria-hidden="true">✓</span><span class="discount-id-saved-text">ID saved</span>';
  idSavedRow.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pendingDiscountIdPhoto && !pendingDiscountIdDetails) return;
    const active = document.querySelector('.discount-toggle.active[data-discount="senior"], .discount-toggle.active[data-discount="pwd"]');
    const discount = active?.dataset?.discount || 'senior';
    showSavedDiscountIdModal({
      idPhoto: pendingDiscountIdPhoto,
      idDetails: pendingDiscountIdDetails,
      customizations: {
        discount,
        idPhoto: pendingDiscountIdPhoto,
        idDetails: pendingDiscountIdDetails
      }
    });
  });

  discountSection.appendChild(idSavedRow);
  discountSection.appendChild(discountButtons);

  if (showAll || allowedCustomizations.discount) {
    milkDiscountRow.appendChild(discountSection);
  }

  // Add the combined row only when milk and/or discount are shown
  if (milkDiscountRow.childElementCount > 0) {
    modal.appendChild(milkDiscountRow);
  }

  if (item.variants && item.variants.length > 0) {
    const variantNames = item.variants.map(variant => variant.name);
    const defaultVariant = currentCustomizations.variant || variantNames[0];
    const variantLabel = item.variantLabel || 'Variant';

    const variantSection = createOptionSection(variantLabel, variantNames, defaultVariant);
    modal.appendChild(variantSection);

    // Optional: Store price adjustments for variants to use later
    variantSection.dataset.priceData = JSON.stringify(item.variants);
  }

  // Quantity section
  const quantitySection = document.createElement('div');
  quantitySection.className = 'modal-option';
  quantitySection.style.marginTop = '10px';
  const quantityLabel = document.createElement('div');
  quantityLabel.className = 'modal-option-label';
  quantityLabel.textContent = 'Quantity';
  quantitySection.appendChild(quantityLabel);

  const quantityControl = document.createElement('div');
  quantityControl.className = 'modal-quantity';
  quantityControl.style.marginTop = '10px';
  quantityControl.style.marginBottom = '10px';

  const minusBtn = document.createElement('button');
  minusBtn.className = 'quantity-btn';
  minusBtn.textContent = '-';
  minusBtn.addEventListener('click', () => updateModalQuantity(-1));

  const quantityDisplay = document.createElement('span');
  quantityDisplay.className = 'quantity-display';
  quantityDisplay.textContent = editMode ? item.quantity : '1';
  quantityDisplay.style.margin = '0 20px';

  const plusBtn = document.createElement('button');
  plusBtn.className = 'quantity-btn';
  plusBtn.textContent = '+';
  plusBtn.addEventListener('click', () => updateModalQuantity(1));

  quantityControl.appendChild(minusBtn);
  quantityControl.appendChild(quantityDisplay);
  quantityControl.appendChild(plusBtn);
  quantitySection.appendChild(quantityControl);
  modal.appendChild(quantitySection);

  // Hidden total price element (for calculations, not displayed)
  const hiddenTotal = document.createElement('div');
  hiddenTotal.className = 'item-total-display';
  hiddenTotal.style.display = 'none';

  // Calculate initial price (use menu-level oat/strength prices when set)
  const opts = getCustomizationOptions();
  let basePrice = editMode ? (item.basePrice || item.price) : item.price;
  if (currentCustomizations.size && opts.size[currentCustomizations.size]) {
    basePrice += opts.size[currentCustomizations.size];
  }
  if (currentCustomizations.milk && opts.milk[currentCustomizations.milk]) {
    basePrice += opts.milk[currentCustomizations.milk];
  }
  if (currentCustomizations.strengthLevel && opts.strengthLevel[currentCustomizations.strengthLevel] !== undefined) {
    basePrice += opts.strengthLevel[currentCustomizations.strengthLevel];
  }
  basePrice += matchaOptionSurcharge(currentCustomizations.matchaOption, opts);
  if (currentCustomizations.discount && opts.discount[currentCustomizations.discount]) {
    basePrice = basePrice * (1 + opts.discount[currentCustomizations.discount]);
  }
  hiddenTotal.dataset.basePrice = editMode ? (item.basePrice || item.price) : item.price;
  modal.appendChild(hiddenTotal);

  // Modal footer
  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'checkout-button modal-cancel';
  cancelBtn.textContent = 'CANCEL';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const addBtn = document.createElement('button');
  addBtn.className = 'checkout-button modal-add';
  addBtn.id = 'add-to-order-btn';
  // We'll update this text in updateItemTotal()
  addBtn.textContent = editMode ? 'UPDATE ORDER' : 'ADD TO ORDER';
  addBtn.addEventListener('click', () => {
    if (editMode) {
      updateCustomizedItemInOrder(item, editIndex, overlay);
    } else {
      addCustomizedItemToOrder(item, overlay);
    }
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(addBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Close on outside tap
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Initialize the item total when the modal is first shown
  updateItemTotal();
  updateDiscountIdPhotoIndicator();
}

function isIdDiscountType(type) {
  return type === 'senior' || type === 'pwd';
}

function updateDiscountIdPhotoIndicator() {
  const row = document.querySelector('.discount-id-saved');
  if (!row) return;
  const hasSavedId = Boolean(pendingDiscountIdPhoto) && Boolean(
    document.querySelector('.discount-toggle.active[data-discount="senior"], .discount-toggle.active[data-discount="pwd"]')
  );
  row.hidden = !hasSavedId;
}

const SENIOR_ID_FIELDS = [
  { key: 'fullName', label: 'Name' },
  { key: 'idNumber', label: 'ID number' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'sex', label: 'Sex' },
  { key: 'address', label: 'Address' },
  { key: 'issuingLgu', label: 'City / LGU' },
  { key: 'dateIssued', label: 'Date issued' }
];

const PWD_ID_FIELDS = [
  { key: 'fullName', label: 'Name' },
  { key: 'idNumber', label: 'ID number' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'sex', label: 'Sex' },
  { key: 'disabilityType', label: 'Disability' },
  { key: 'address', label: 'Address' },
  { key: 'issuingLgu', label: 'City / LGU' },
  { key: 'dateIssued', label: 'Date issued' }
];

function idDetailFieldsFor(idType) {
  return idType === 'pwd' ? PWD_ID_FIELDS : SENIOR_ID_FIELDS;
}

function renderIdDetailRows(container, details, idType, statusText) {
  container.hidden = false;
  container.replaceChildren();
  if (statusText) {
    const status = document.createElement('p');
    status.className = 'id-capture-details-status';
    status.textContent = statusText;
    container.appendChild(status);
  }
  if (!details && statusText === 'Reading ID…') return;
  const list = document.createElement('dl');
  list.className = 'id-capture-details-list';
  idDetailFieldsFor(idType).forEach(({ key, label }) => {
    const row = document.createElement('div');
    row.className = 'id-capture-details-row';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = (details && details[key]) ? details[key] : '—';
    row.appendChild(dt);
    row.appendChild(dd);
    list.appendChild(row);
  });
  container.appendChild(list);
}

function itemHasSavedDiscountId(item) {
  const c = item?.customizations;
  if (!c) return false;
  return Boolean(c.idPhoto || c.idDetails);
}

function resolveDiscountIdType(itemOrDetails) {
  const details = itemOrDetails?.customizations?.idDetails || itemOrDetails?.idDetails || itemOrDetails;
  const discount = itemOrDetails?.customizations?.discount || details?.idType;
  if (discount === 'pwd' || details?.idType === 'pwd') return 'pwd';
  return 'senior';
}

/** Read-only review of a saved Senior/PWD ID photo + OCR fields. */
function showSavedDiscountIdModal(itemOrPayload) {
  const existing = document.querySelector('.id-review-overlay');
  if (existing) existing.remove();

  const customizations = itemOrPayload?.customizations || {};
  const photo = itemOrPayload?.idPhoto || customizations.idPhoto || null;
  const details = itemOrPayload?.idDetails || customizations.idDetails || null;
  const idType = resolveDiscountIdType(itemOrPayload);

  const overlay = document.createElement('div');
  overlay.className = 'id-capture-overlay id-review-overlay';

  const card = document.createElement('div');
  card.className = 'id-capture-card';

  const title = document.createElement('h2');
  title.className = 'id-capture-title';
  title.textContent = idType === 'pwd' ? 'PWD ID' : 'Senior ID';

  const hint = document.createElement('p');
  hint.className = 'id-capture-hint';
  hint.textContent = 'Saved for this discount.';

  if (photo) {
    const stage = document.createElement('div');
    stage.className = 'id-capture-stage is-review';
    const img = document.createElement('img');
    img.src = photo;
    img.alt = 'Saved ID photo';
    stage.appendChild(img);
    card.appendChild(title);
    card.appendChild(hint);
    card.appendChild(stage);
  } else {
    card.appendChild(title);
    card.appendChild(hint);
  }

  const detailsPanel = document.createElement('div');
  detailsPanel.className = 'id-capture-details';
  if (details) {
    renderIdDetailRows(detailsPanel, details, idType);
  } else {
    renderIdDetailRows(detailsPanel, null, idType, 'No extracted details saved.');
  }
  card.appendChild(detailsPanel);

  const actions = document.createElement('div');
  actions.className = 'id-capture-actions';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'checkout-button id-capture-skip';
  closeBtn.style.flex = '1';
  closeBtn.textContent = 'CLOSE';
  closeBtn.addEventListener('click', () => overlay.remove());
  actions.appendChild(closeBtn);
  card.appendChild(actions);

  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  card.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(overlay);
}

window.showSavedDiscountIdModal = showSavedDiscountIdModal;

async function extractDiscountIdFromImage(imageDataUrl, idType) {
  if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) {
    throw new Error('ID image is required');
  }
  const mimeMatch = imageDataUrl.match(/^data:([^;]+);base64,/);
  const payload = {
    imageBase64: imageDataUrl,
    mimeType: mimeMatch?.[1] || 'image/jpeg',
    idType: idType === 'pwd' ? 'pwd' : 'senior'
  };

  const [{ getFunctions, httpsCallable }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js')
  ]);
  const functions = getFunctions(app, 'us-central1');
  const extract = httpsCallable(functions, 'extractDiscountId', { timeout: 60000 });
  const response = await extract(payload);
  const parsed = response?.data?.parsed;
  if (!parsed) throw new Error('Extraction returned no data');
  return parsed;
}

function getIdCardLayout(width, height) {
  const cardW = width * 0.86;
  const cardH = Math.min(cardW / 1.586, height * 0.72);
  const x = (width - cardW) / 2;
  const y = (height - cardH) / 2;
  return {
    card: { x, y, w: cardW, h: cardH, r: Math.min(14, cardH * 0.07) }
  };
}

function drawRoundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawIdGuide(canvas) {
  const dpr = canvas._dpr || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const { card } = getIdCardLayout(width, height);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-out';
  drawRoundedRectPath(ctx, card.x, card.y, card.w, card.h, card.r);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  drawRoundedRectPath(ctx, card.x, card.y, card.w, card.h, card.r);
  ctx.stroke();
}

function sizeIdGuideCanvas(canvas, stage) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  canvas._dpr = dpr;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  drawIdGuide(canvas);
}

function coverSourceRect(srcW, srcH, destW, destH) {
  const srcRatio = srcW / srcH;
  const destRatio = destW / destH;
  if (srcRatio > destRatio) {
    const sw = srcH * destRatio;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  const sh = srcW / destRatio;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}

function captureIdCardFromSource(source, stage, canvas) {
  const srcW = source.videoWidth || source.naturalWidth;
  const srcH = source.videoHeight || source.naturalHeight;
  if (!srcW || !srcH) return null;

  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;
  const dpr = canvas._dpr || 1;
  const layout = getIdCardLayout(canvas.width / dpr, canvas.height / dpr);
  const mapped = coverSourceRect(srcW, srcH, stageW, stageH);
  const scaleX = mapped.sw / stageW;
  const scaleY = mapped.sh / stageH;

  const sx = mapped.sx + layout.card.x * scaleX;
  const sy = mapped.sy + layout.card.y * scaleY;
  const sw = layout.card.w * scaleX;
  const sh = layout.card.h * scaleY;

  const out = document.createElement('canvas');
  out.width = 720;
  out.height = Math.round(720 / 1.586);
  const ctx = out.getContext('2d');
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.72);
}

/** Full visible stage (object-fit: cover) for OCR — not cropped to the ID frame. */
function captureVisibleStageFromSource(source, stage) {
  const srcW = source.videoWidth || source.naturalWidth;
  const srcH = source.videoHeight || source.naturalHeight;
  if (!srcW || !srcH) return null;

  const stageW = Math.max(1, stage.clientWidth);
  const stageH = Math.max(1, stage.clientHeight);
  const mapped = coverSourceRect(srcW, srcH, stageW, stageH);

  const out = document.createElement('canvas');
  out.width = 960;
  out.height = Math.round(960 * (stageH / stageW));
  const ctx = out.getContext('2d');
  ctx.drawImage(source, mapped.sx, mapped.sy, mapped.sw, mapped.sh, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.78);
}

function stopMediaStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach(track => track.stop());
}

async function startIdCamera(video, facingMode = 'user') {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera not supported');
  }
  const preferred = facingMode === 'environment' ? 'environment' : 'user';
  const fallback = preferred === 'user' ? 'environment' : 'user';
  const attempts = [
    { audio: false, video: { facingMode: { ideal: preferred }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    { audio: false, video: { facingMode: preferred } },
    { audio: false, video: { facingMode: fallback } },
    { audio: false, video: true }
  ];
  let lastError = null;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play();
      return stream;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Camera unavailable');
}

function showDiscountIdCaptureModal(discountType) {
  return new Promise((resolve) => {
    const existing = document.querySelector('.id-capture-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'id-capture-overlay';

    const card = document.createElement('div');
    card.className = 'id-capture-card';

    const title = document.createElement('h2');
    title.className = 'id-capture-title';
    title.textContent = discountType === 'pwd' ? 'Scan PWD ID' : 'Scan Senior ID';

    const hint = document.createElement('p');
    hint.className = 'id-capture-hint';
    hint.textContent = 'Fit the ID in the frame.';

    const stage = document.createElement('div');
    stage.className = 'id-capture-stage';

    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('autoplay', '');
    video.muted = true;
    video.playsInline = true;

    const still = document.createElement('img');
    still.alt = 'ID preview';
    still.style.display = 'none';

    const canvas = document.createElement('canvas');
    const status = document.createElement('div');
    status.className = 'id-capture-status';
    status.hidden = true;

    const flipBtn = document.createElement('button');
    flipBtn.type = 'button';
    flipBtn.className = 'id-capture-flip';
    flipBtn.title = 'Switch camera';
    flipBtn.setAttribute('aria-label', 'Switch camera');
    flipBtn.textContent = '↻';

    stage.appendChild(video);
    stage.appendChild(still);
    stage.appendChild(canvas);
    stage.appendChild(flipBtn);
    stage.appendChild(status);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.capture = 'user';
    fileInput.className = 'id-capture-file';

    const actions = document.createElement('div');
    actions.className = 'id-capture-actions';

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'checkout-button id-capture-skip';
    skipBtn.textContent = 'SKIP';

    const captureBtn = document.createElement('button');
    captureBtn.type = 'button';
    captureBtn.className = 'checkout-button id-capture-save';
    captureBtn.textContent = 'CAPTURE';

    actions.appendChild(skipBtn);
    actions.appendChild(captureBtn);

    card.appendChild(title);
    card.appendChild(hint);
    card.appendChild(stage);
    const detailsPanel = document.createElement('div');
    detailsPanel.className = 'id-capture-details';
    detailsPanel.hidden = true;
    card.appendChild(detailsPanel);
    card.appendChild(fileInput);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    card.addEventListener('click', (e) => e.stopPropagation());

    let stream = null;
    let closed = false;
    let cameraReady = false;
    let currentFacing = 'user';
    let previewSource = video;
    let capturedPhoto = null;
    let extractedDetails = null;
    let extractPromise = null;
    let extractToken = 0;

    const onResize = () => {
      if (!closed && !stage.classList.contains('is-review')) sizeIdGuideCanvas(canvas, stage);
    };
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(onResize)
      : null;

    const setStatus = (text) => {
      if (text) {
        status.hidden = false;
        status.textContent = text;
      } else {
        status.hidden = true;
        status.textContent = '';
      }
    };

    const setReviewMode = (isReview) => {
      canvas.style.display = isReview ? 'none' : 'block';
      stage.classList.toggle('is-review', isReview);
      flipBtn.hidden = isReview || !cameraReady;
      skipBtn.textContent = isReview ? 'RETAKE' : 'SKIP';
      captureBtn.textContent = isReview ? 'SAVE' : (cameraReady ? 'CAPTURE' : 'CHOOSE PHOTO');
      if (isReview) setStatus('');
    };

    const switchIdCamera = async () => {
      if (closed || capturedPhoto) return;
      flipBtn.disabled = true;
      const nextFacing = currentFacing === 'user' ? 'environment' : 'user';
      stopMediaStream(stream);
      stream = null;
      try {
        stream = await startIdCamera(video, nextFacing);
        if (closed) {
          stopMediaStream(stream);
          return;
        }
        currentFacing = nextFacing;
        fileInput.capture = currentFacing;
        cameraReady = true;
        video.style.display = 'block';
        previewSource = video;
        setStatus('');
        sizeIdGuideCanvas(canvas, stage);
      } catch {
        cameraReady = false;
        video.style.display = 'none';
        flipBtn.hidden = true;
        captureBtn.textContent = 'CHOOSE PHOTO';
        setStatus('Camera unavailable');
      }
      flipBtn.disabled = false;
    };

    flipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchIdCamera();
    });

    const startIdRead = (ocrPhoto) => {
      extractToken += 1;
      const token = extractToken;
      extractedDetails = null;
      renderIdDetailRows(detailsPanel, null, discountType, 'Reading ID…');
      extractPromise = extractDiscountIdFromImage(ocrPhoto, discountType)
        .then((parsed) => {
          if (closed || token !== extractToken) return parsed;
          extractedDetails = parsed;
          renderIdDetailRows(detailsPanel, parsed, discountType);
          return parsed;
        })
        .catch((error) => {
          if (closed || token !== extractToken) return null;
          extractedDetails = null;
          renderIdDetailRows(detailsPanel, null, discountType, error?.message || 'Couldn’t read the ID.');
          return null;
        });
      return extractPromise;
    };

    const finish = async (photo) => {
      if (closed) return;
      if (photo && extractPromise) {
        captureBtn.disabled = true;
        try {
          const parsed = await extractPromise;
          if (parsed) extractedDetails = parsed;
        } catch {
          // keep photo even if OCR fails
        }
        captureBtn.disabled = false;
      }
      if (closed) return;
      closed = true;
      window.removeEventListener('resize', onResize);
      if (resizeObserver) resizeObserver.disconnect();
      stopMediaStream(stream);
      overlay.remove();
      resolve(photo ? { photo, details: extractedDetails } : null);
    };

    const showStill = (src) => {
      still.src = src;
      still.style.display = 'block';
      video.style.display = 'none';
      previewSource = still;
    };

    const showLive = () => {
      still.style.display = 'none';
      still.removeAttribute('src');
      video.style.display = 'block';
      previewSource = video;
      capturedPhoto = null;
      extractedDetails = null;
      extractPromise = null;
      extractToken += 1;
      detailsPanel.hidden = true;
      detailsPanel.replaceChildren();
      flipBtn.hidden = !cameraReady;
      setReviewMode(false);
    };

    skipBtn.addEventListener('click', () => {
      if (capturedPhoto) {
        capturedPhoto = null;
        if (stream && cameraReady) {
          showLive();
          setStatus('');
        } else {
          setReviewMode(false);
          showLive();
          still.style.display = 'none';
          video.style.display = 'none';
          setStatus('Camera unavailable');
          fileInput.value = '';
        }
        return;
      }
      finish(null);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });

    captureBtn.addEventListener('click', () => {
      if (capturedPhoto) {
        finish(capturedPhoto);
        return;
      }
      if (!cameraReady && previewSource === video) {
        fileInput.click();
        return;
      }
      const croppedPhoto = captureIdCardFromSource(previewSource, stage, canvas);
      const ocrPhoto = captureVisibleStageFromSource(previewSource, stage) || croppedPhoto;
      if (!croppedPhoto) {
        setStatus('Could not capture. Try again.');
        return;
      }
      capturedPhoto = croppedPhoto;
      showStill(croppedPhoto);
      setReviewMode(true);
      startIdRead(ocrPhoto);
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        showStill(reader.result);
        capturedPhoto = null;
        setReviewMode(false);
        captureBtn.textContent = 'CAPTURE';
        setStatus('');
        still.onload = () => sizeIdGuideCanvas(canvas, stage);
      };
      reader.readAsDataURL(file);
    });

    requestAnimationFrame(() => sizeIdGuideCanvas(canvas, stage));
    window.addEventListener('resize', onResize, { passive: true });
    if (resizeObserver) resizeObserver.observe(stage);

    startIdCamera(video, currentFacing).then((mediaStream) => {
      if (closed) {
        stopMediaStream(mediaStream);
        return;
      }
      stream = mediaStream;
      cameraReady = true;
      flipBtn.hidden = false;
      captureBtn.textContent = 'CAPTURE';
      setStatus('');
      video.addEventListener('loadedmetadata', onResize, { once: true });
      sizeIdGuideCanvas(canvas, stage);
    }).catch(() => {
      if (closed) return;
      cameraReady = false;
      video.style.display = 'none';
      flipBtn.hidden = true;
      captureBtn.textContent = 'CHOOSE PHOTO';
      setStatus('Camera unavailable');
    });
  });
}

async function toggleDiscount(button) {
  const discountButtons = document.querySelectorAll('.discount-toggle');
  const type = button.dataset.discount;

  if (button.classList.contains('active')) {
    button.classList.remove('active');
    if (isIdDiscountType(type)) pendingDiscountIdPhoto = null;
    if (isIdDiscountType(type)) pendingDiscountIdDetails = null;
  } else {
    discountButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    if (isIdDiscountType(type)) {
      const result = await showDiscountIdCaptureModal(type);
      if (result?.photo) {
        pendingDiscountIdPhoto = result.photo;
        pendingDiscountIdDetails = result.details || null;
      }
    } else {
      pendingDiscountIdPhoto = null;
      pendingDiscountIdDetails = null;
    }
  }

  updateItemTotal();
  updateDiscountIdPhotoIndicator();
}

function toggleCustomDiscount(button) {
  const discountButtons = document.querySelectorAll('.discount-toggle');
  const input = button.querySelector('#customDiscountValue');

  if (button.classList.contains('active')) {
    button.classList.remove('active');
  } else {
    discountButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    pendingDiscountIdPhoto = null;
    pendingDiscountIdDetails = null;
    if (input) {
      if (!input.value) {
        input.value = '10';
      }
      input.focus();
      input.select();
    }
  }

  updateItemTotal();
  updateDiscountIdPhotoIndicator();
}

function editOrderItem(index) {
  const item = currentOrder[index];
  showCustomizationModal(item, true, index);
}

function updateCustomizedItemInOrder(baseItem, editIndex, overlay) {
  const options = getSelectedOptions();
  const isPackageMode = getCurrentEventServiceType() === 'package';

  // Calculate additional price and adjustments
  let additionalPrice = 0;

  if (!isPackageMode) {
    const opts = getCustomizationOptions();
    // Size adjustment
    if (options.size && opts.size[options.size]) {
      additionalPrice += opts.size[options.size];
    }

    // Milk adjustment
    if (options.milk && opts.milk[options.milk]) {
      additionalPrice += opts.milk[options.milk];
    }

    // Strength level adjustment
    if (options.strengthLevel && opts.strengthLevel[options.strengthLevel] !== undefined) {
      additionalPrice += opts.strengthLevel[options.strengthLevel];
    }

    additionalPrice += matchaOptionSurcharge(options.matchaOption, opts);

    // Add preparation adjustment for brew bar items
    if (options.preparation && baseItem.customizations && baseItem.customizations.preparation) {
      const preparationPrice = baseItem.customizations.preparation[options.preparation];
      if (preparationPrice !== undefined) {
        baseItem.price = preparationPrice;
        additionalPrice = 0;
      }
    }

    // Apply variant price adjustment if any
    if (options.variant && baseItem.variants) {
      const selectedVariant = baseItem.variants.find(v => v.name === options.variant);
      if (selectedVariant && selectedVariant.price) {
        additionalPrice += selectedVariant.price;
      }
    }
  }

  const unitPrice = (baseItem.basePrice || baseItem.price) + additionalPrice;
  const finalPrice = isPackageMode ? 0 : applyDiscountToUnitPrice(unitPrice, options);

  // Update item with new customizations
  currentOrder[editIndex] = {
    ...baseItem,
    customizations: options,
    basePrice: baseItem.basePrice || baseItem.price,
    price: finalPrice,
    quantity: options.quantity,
    id: baseItem.id || Date.now()
  };

  updateOrderDisplay();
  overlay.remove();
}

function createOptionSection(title, options, defaultOption) {
  const section = document.createElement('div');
  section.className = 'modal-option';

  const label = document.createElement('div');
  label.className = 'modal-option-label';
  label.textContent = title;
  section.appendChild(label);

  const buttons = document.createElement('div');
  buttons.className = 'modal-buttons';

  options.forEach(option => {
    const button = document.createElement('button');
    button.className = 'option-button';

    // Create wrapper for the button content
    const buttonContent = document.createElement('span');
    buttonContent.className = 'option-text';
    buttonContent.textContent = option;
    button.appendChild(buttonContent);

    button.dataset.option = option;
    button.dataset.group = title.toLowerCase();

    if (option === defaultOption) {
      button.classList.add('active');
    }

    button.addEventListener('click', () => selectOption(button));
    buttons.appendChild(button);
  });

  section.appendChild(buttons);
  return section;
}

function selectOption(selectedButton) {
  const group = selectedButton.dataset.group;
  const buttons = document.querySelectorAll(`[data-group="${group}"]`);

  buttons.forEach(button => button.classList.remove('active'));
  selectedButton.classList.add('active');

  // Update the price if the total display exists
  updateItemTotal();
}

function updateItemTotal() {
  const itemTotalDisplay = document.querySelector('.item-total-display');
  if (!itemTotalDisplay) return;

  const addButton = document.getElementById('add-to-order-btn');
  if (!addButton) return;

  // Get base price from the menu item (use menu-level oat/strength prices when set)
  const opts = getCustomizationOptions();
  let basePrice = parseFloat(itemTotalDisplay.dataset.basePrice);

  // Apply size adjustment
  const sizeOption = document.querySelector('.option-button.active[data-group="size"]');
  if (sizeOption && opts.size[sizeOption.dataset.option]) {
    basePrice += opts.size[sizeOption.dataset.option];
  }

  // Apply milk adjustment
  const milkOption = document.querySelector('.option-button.active[data-group="milk"]');
  if (milkOption && opts.milk[milkOption.dataset.option]) {
    basePrice += opts.milk[milkOption.dataset.option];
  }

  // Apply strength level adjustment
  const strengthLevelOption = document.querySelector('.option-button.active[data-group="strength level"]');
  if (strengthLevelOption && opts.strengthLevel[strengthLevelOption.dataset.option] !== undefined) {
    basePrice += opts.strengthLevel[strengthLevelOption.dataset.option];
  }

  const matchaOptionEl = document.querySelector('.option-button.active[data-group="matcha option"]');
  if (matchaOptionEl) {
    basePrice += matchaOptionSurcharge(matchaOptionEl.dataset.option, opts);
  }

  // Apply preparation adjustment for brew bar items
  const preparationOption = document.querySelector('.option-button.active[data-group="preparation"]');
  if (preparationOption) {
    const modal = document.querySelector('.modal');
    const item = modal ? modal.dataset.item : null;
    if (item) {
      const itemData = JSON.parse(item);
      if (itemData.customizations && itemData.customizations.preparation) {
        const preparationKey = preparationOption.dataset.option;
        const preparationLabels = {
          'Usucha (Hot)': 'usucha-hot',
          'Usucha (Iced)': 'usucha-iced', 
          'Classic Latte (Iced)': 'classic-latte',
          'Cold-Whisked Latte (Iced)': 'cold-whisked-latte'
        };
        const key = preparationLabels[preparationKey] || preparationKey;
        if (itemData.customizations.preparation[key]) {
          basePrice = itemData.customizations.preparation[key];
        }
      }
    }
  }

  // Apply discount if selected
  const discountOption = document.querySelector('.discount-toggle.active');
  if (discountOption) {
    const discountType = discountOption.dataset.discount;
    
    if (discountType === 'custom') {
      const custom = readCustomDiscountFromModal();
      basePrice = applyDiscountToUnitPrice(basePrice, {
        discount: 'custom',
        customDiscountMode: custom.mode,
        customDiscountPercent: custom.percent,
        customDiscountAmount: custom.amount
      });
    } else if (opts.discount[discountType]) {
      // Handle predefined discounts (senior, pwd)
      basePrice = basePrice * (1 + opts.discount[discountType]);
    }
  }

  // Get quantity
  const quantityDisplay = document.querySelector('.modal-quantity .quantity-display');
  const quantity = quantityDisplay ? parseInt(quantityDisplay.textContent) : 1;

  // Calculate final price
  const finalPrice = basePrice * quantity;

  // Clear button and add properly formatted elements
  addButton.innerHTML = '';

  // Add button text with Poppins font
  const buttonTextSpan = document.createElement('span');
  buttonTextSpan.style.fontFamily = "'Poppins', sans-serif";
  buttonTextSpan.textContent = addButton.textContent.includes('UPDATE') ? 'UPDATE ORDER ' : 'ADD TO ORDER ';
  addButton.appendChild(buttonTextSpan);

  // Only show price for popup mode
  const serviceType = getCurrentEventServiceType();
  const isPackageMode = serviceType === 'package';

          if (!isPackageMode) {
          const priceSpan = document.createElement('span');
          priceSpan.style.fontFamily = 'Poppins, sans-serif';
          priceSpan.style.fontWeight = '600';
          priceSpan.textContent = `(₱${finalPrice.toFixed(2)})`;
          addButton.appendChild(priceSpan);
        }
}


function updateModalQuantity(change) {
  const quantityDisplay = document.querySelector('.modal-quantity .quantity-display');
  let currentQuantity = parseInt(quantityDisplay.textContent);
  currentQuantity += change;

  if (currentQuantity < 1) {
    currentQuantity = 1;
  }

  quantityDisplay.textContent = currentQuantity;

  // Update the total price
  updateItemTotal();
}

function getSelectedOptions() {
  const options = {};

  // Only get options that exist in the DOM
  const sizeButton = document.querySelector('.option-button.active[data-group="size"]');
  if (sizeButton) options.size = sizeButton.dataset.option;

  const servingButton = document.querySelector('.option-button.active[data-group="serving"]');
  if (servingButton) options.serving = servingButton.dataset.option;

  const sweetnessButton = document.querySelector('.option-button.active[data-group="sweetness"]');
  if (sweetnessButton) options.sweetness = sweetnessButton.dataset.option;

  const milkButton = document.querySelector('.option-button.active[data-group="milk"]');
  if (milkButton) options.milk = milkButton.dataset.option;

  const preparationButton = document.querySelector('.option-button.active[data-group="preparation"]');
  if (preparationButton) {
    const preparationLabels = {
      'Usucha (Hot)': 'usucha-hot',
      'Usucha (Iced)': 'usucha-iced', 
      'Classic Latte (Iced)': 'classic-latte',
      'Cold-Whisked Latte (Iced)': 'cold-whisked-latte'
    };
    options.preparation = preparationLabels[preparationButton.dataset.option] || preparationButton.dataset.option;
  }

  // Get discount from toggle buttons
  const discountButton = document.querySelector('.discount-toggle.active');
  options.discount = discountButton ? discountButton.dataset.discount : 'none';
  
  if (options.discount === 'custom') {
    const custom = readCustomDiscountFromModal();
    options.customDiscountMode = custom.mode;
    if (custom.mode === 'amount' && custom.amount != null) {
      options.customDiscountAmount = custom.amount;
    } else if (custom.percent != null) {
      options.customDiscountPercent = custom.percent;
    }
  } else if (isIdDiscountType(options.discount) && pendingDiscountIdPhoto) {
    options.idPhoto = pendingDiscountIdPhoto;
    if (pendingDiscountIdDetails) options.idDetails = pendingDiscountIdDetails;
  }

  const quantity = document.querySelector('.modal-quantity .quantity-display');
  if (quantity) options.quantity = parseInt(quantity.textContent);

  const variantButton = document.querySelector('.option-button.active[data-group="flavor"]');
  if (variantButton) options.variant = variantButton.dataset.option;

  const strengthLevelButton = document.querySelector('.option-button.active[data-group="strength level"]');
  if (strengthLevelButton) options.strengthLevel = strengthLevelButton.dataset.option;

  const matchaOptionButton = document.querySelector('.option-button.active[data-group="matcha option"]');
  if (matchaOptionButton) options.matchaOption = matchaOptionButton.dataset.option;

  // When size is hidden, default to 'large' so price and order logic still work
  if (HIDE_SIZE_CUSTOMIZATION && !options.size) options.size = 'large';

  return options;
}

function addCustomizedItemToOrder(baseItem, overlay) {
  const options = getSelectedOptions();
  const isPackageMode = getCurrentEventServiceType() === 'package';

  // Calculate additional price and adjustments
  let additionalPrice = 0;

  if (!isPackageMode) {
    const opts = getCustomizationOptions();
    // Add size adjustment
    if (options.size && opts.size[options.size]) {
      additionalPrice += opts.size[options.size];
    }

    // Add milk adjustment
    if (options.milk && opts.milk[options.milk]) {
      additionalPrice += opts.milk[options.milk];
    }

    // Add strength level adjustment
    if (options.strengthLevel && opts.strengthLevel[options.strengthLevel] !== undefined) {
      additionalPrice += opts.strengthLevel[options.strengthLevel];
    }

    additionalPrice += matchaOptionSurcharge(options.matchaOption, opts);

    // Add preparation adjustment for brew bar items
    if (options.preparation && baseItem.customizations && baseItem.customizations.preparation) {
      const preparationPrice = baseItem.customizations.preparation[options.preparation];
      if (preparationPrice !== undefined) {
        baseItem.price = preparationPrice;
        additionalPrice = 0;
      }
    }

    // Apply variant price adjustment if any
    if (options.variant && baseItem.variants) {
      const selectedVariant = baseItem.variants.find(v => v.name === options.variant);
      if (selectedVariant && selectedVariant.price) {
        additionalPrice += selectedVariant.price;
      }
    }
  }

  const unitPrice = baseItem.price + additionalPrice;
  const finalPrice = isPackageMode ? 0 : applyDiscountToUnitPrice(unitPrice, options);

  // Check if this exact customization already exists in the order
  const existingItemIndex = currentOrder.findIndex(orderItem =>
    orderItem.name === baseItem.name &&
    orderItem.customizations &&
    (HIDE_SIZE_CUSTOMIZATION || orderItem.customizations.size === options.size) &&
    orderItem.customizations.serving === options.serving &&
    orderItem.customizations.sweetness === options.sweetness &&
    orderItem.customizations.milk === options.milk &&
    orderItem.customizations.discount === options.discount &&
    (orderItem.customizations.customDiscountMode || 'percent') === (options.customDiscountMode || 'percent') &&
    (orderItem.customizations.customDiscountPercent || 0) === (options.customDiscountPercent || 0) &&
    (orderItem.customizations.customDiscountAmount || 0) === (options.customDiscountAmount || 0) &&
    orderItem.customizations.variant === options.variant &&
    orderItem.customizations.strengthLevel === options.strengthLevel &&
    orderItem.customizations.matchaOption === options.matchaOption
  );

  if (existingItemIndex > -1) {
    currentOrder[existingItemIndex].quantity += options.quantity;
    if (options.idPhoto && !currentOrder[existingItemIndex].customizations.idPhoto) {
      currentOrder[existingItemIndex].customizations.idPhoto = options.idPhoto;
    }
    if (options.idDetails && !currentOrder[existingItemIndex].customizations.idDetails) {
      currentOrder[existingItemIndex].customizations.idDetails = options.idDetails;
    }
  } else {
    // Create customized item
    const customizedItem = {
      ...baseItem,
      customizations: options,
      basePrice: baseItem.price,
      price: finalPrice,
      id: Date.now() // Unique identifier for customized items
    };
    customizedItem.quantity = options.quantity;
    currentOrder.push(customizedItem);
  }

  updateOrderDisplay();
  overlay.remove();
}

// Add at the end of script.js

function initializePaymentHandlers() {
  // Cash payment handler
  document.getElementById('cash-payment').addEventListener('click', () => {
    if (currentOrder.length === 0) {
      alert('Please add items to your order first.');
      return;
    }
    liveSessionState = { paymentMethod: 'cash', showQr: false, status: 'awaiting_payment' };
    scheduleLiveSessionPublish(true);
    showCashPaymentModal();
  });

  // GCash payment handler
  document.getElementById('gcash-payment').addEventListener('click', () => {
    if (currentOrder.length === 0) {
      alert('Please add items to your order first.');
      return;
    }
    liveSessionState = { paymentMethod: 'gcash', showQr: true, status: 'awaiting_payment' };
    scheduleLiveSessionPublish(true);
    showGCashPaymentModal();
  });

  // Card payment handler
  document.getElementById('card-payment').addEventListener('click', () => {
    if (currentOrder.length === 0) {
      alert('Please add items to your order first.');
      return;
    }
    liveSessionState = { paymentMethod: 'card', showQr: true, status: 'awaiting_payment' };
    scheduleLiveSessionPublish(true);
    showCardPaymentModal();
  });
}

function calculateOrderTotal() {
  return currentOrder.reduce((total, item) => total + (item.price * item.quantity), 0);
}

function clearOrder() {
  currentOrder = [];
  customerName = '';  // Add this line
  liveSessionState = {
    paymentMethod: null,
    showQr: false,
    status: 'idle'
  };
  updateOrderDisplay();
  updateOrderHeader();  // Add this line
  scheduleLiveSessionPublish(true);
}

document.addEventListener('DOMContentLoaded', function () {
  const endOfDayBtn = document.getElementById('endOfDayBtn');
  if (endOfDayBtn) {
    endOfDayBtn.addEventListener('click', showEndOfDayModal);
  }

  const totalSalesBlock = document.getElementById('totalSalesBlock');
  if (totalSalesBlock) {
    totalSalesBlock.style.cursor = 'pointer';
    totalSalesBlock.addEventListener('click', showItemSummaryModal);
  }
});

function formatEventSalesCurrency(val) {
  const num = val ?? 0;
  const absVal = Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num < 0 ? `-₱${absVal}` : `₱${absVal}`;
}

function formatEventSalesDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function buildEventSalesSummaryHTML(record, eventName, dateStr) {
  const fmt = formatEventSalesCurrency;
  const variance = record.cashVariance ?? 0;
  const varianceColor = variance < 0 ? '#d9534f' : variance > 0 ? '#2b9348' : '#333';
  const formatVariance = (v) => {
    const n = typeof v === 'number' ? v : 0;
    if (Math.abs(n) < 0.0005) return '₱0.00';
    const absVal = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? `-₱${absVal}` : `₱${absVal}`;
  };
  const formattedDate = formatEventSalesDate(dateStr);
  let html = `<div style="font-size: 0.95rem;">`;
  html += `<div style="margin-bottom: 0.4rem; padding-bottom: 0.2rem; border-bottom: 1px solid #eee;">`;
  html += `<strong>Date:</strong> ${formattedDate}<br>`;
  html += `<strong>Event:</strong> ${eventName}`;
  html += `</div>`;
  html += `<div style="margin-bottom: 0.48rem;">`;
  html += `<strong style="display: block; margin: 0 0 0.06rem 0;">Sales Breakdown</strong>`;
  html += `<table style="width: 100%; border-collapse: collapse;">`;
  html += `<tr><td style="padding: 0.06rem 0.5rem;">Cash:</td><td style="text-align: right;">${fmt(record.cash)}</td></tr>`;
  html += `<tr><td style="padding: 0.06rem 0.5rem;">GCash:</td><td style="text-align: right;">${fmt(record.gcash)}</td></tr>`;
  html += `<tr><td style="padding: 0.06rem 0.5rem;">Card:</td><td style="text-align: right;">${fmt(record.card)}</td></tr>`;
  html += `<tr><td style="padding: 0.06rem 0.5rem;"><strong>Total Sales:</strong></td><td style="text-align: right;"><strong>${fmt(record.totalSales)}</strong></td></tr>`;
  html += `</table></div>`;
  html += `<div style="margin-bottom: 0.48rem;">`;
  html += `<strong style="display: block; margin: 0 0 0.06rem 0;">Expenses</strong>`;
  html += `<table style="width: 100%; border-collapse: collapse;">`;
  html += `<tr><td style="padding: 0.06rem 0.5rem;">Cash Expenses:</td><td style="text-align: right;">${fmt(record.expenses)}</td></tr>`;
  html += `</table></div>`;
  html += `<div style="margin-bottom: 0.48rem;">`;
  html += `<strong style="display: block; margin: 0 0 0.06rem 0;">Cash Left</strong>`;
  html += `<table style="width: 100%; border-collapse: collapse;">`;
  html += `<tr><td style="padding: 0.06rem 0.5rem;">Calculated:</td><td style="text-align: right;">${fmt(record.calculatedCashLeft)}</td></tr>`;
  html += `<tr><td style="padding: 0.06rem 0.5rem;">Actual:</td><td style="text-align: right;">${fmt(record.actualCashLeft)}</td></tr>`;
  html += `<tr><td style="padding: 0.06rem 0.5rem;">Variance:</td><td style="text-align: right; color: ${varianceColor};">${formatVariance(variance)}</td></tr>`;
  html += `</table></div>`;
  html += `</div>`;
  return html;
}

async function sendEventSalesEmail(record, eventName, dateStr) {
  if (typeof emailjs === 'undefined') return;
  const EMAILJS_SERVICE_ID = 'service_1085n74';
  const EMAILJS_TEMPLATE_ID = 'template_6zh5mq8';
  const EMAILJS_PUBLIC_KEY = 'Jxzqofh9mPAsb9V0M';
  const RECIPIENT_EMAIL = 'hi@matchanese.com';
  emailjs.init(EMAILJS_PUBLIC_KEY);
  const formattedDate = formatEventSalesDate(dateStr);
  const d = new Date(dateStr + 'T00:00:00');
  const subjectDate = `${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} (${d.toLocaleDateString('en-US', { weekday: 'long' })})`;
  const fmt = formatEventSalesCurrency;
  const variance = record.cashVariance ?? 0;
  const varianceColor = variance < 0 ? '#d9534f' : variance > 0 ? '#2b9348' : '#333';
  const formatVariance = (v) => {
    const n = typeof v === 'number' ? v : 0;
    if (Math.abs(n) < 0.0005) return '₱0.00';
    const absVal = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? `-₱${absVal}` : `₱${absVal}`;
  };
  const emailContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; background-color: #f5f5f5;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #fff; padding: 20px; border-radius: 8px;">
    <div style="background: linear-gradient(135deg, #2b9348 0%, #238636 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
      <div style="font-size: 14px; opacity: 0.9;">Matchanese – Event: ${eventName}</div>
      <div style="font-size: 32px; font-weight: bold;">${fmt(record.totalSales)}</div>
      <div style="font-size: 12px; opacity: 0.8;">Total Sales for ${formattedDate}</div>
    </div>
    <div style="font-size: 0.95rem;">
    <div style="margin-bottom: 0.4rem; padding-bottom: 0.2rem; border-bottom: 1px solid #eee;"><strong>Date:</strong> ${formattedDate}<br><strong>Event:</strong> ${eventName}</div>
    <div style="margin-bottom: 0.48rem;"><strong>Sales Breakdown</strong><table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 0.06rem 0.5rem;">Cash:</td><td style="text-align: right;">${fmt(record.cash)}</td></tr>
    <tr><td style="padding: 0.06rem 0.5rem;">GCash:</td><td style="text-align: right;">${fmt(record.gcash)}</td></tr>
    <tr><td style="padding: 0.06rem 0.5rem;">Card:</td><td style="text-align: right;">${fmt(record.card)}</td></tr>
    <tr><td style="padding: 0.06rem 0.5rem;"><strong>Total Sales:</strong></td><td style="text-align: right;"><strong>${fmt(record.totalSales)}</strong></td></tr></table></div>
    <div style="margin-bottom: 0.48rem;"><strong>Expenses</strong><table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 0.06rem 0.5rem;">Cash Expenses:</td><td style="text-align: right;">${fmt(record.expenses)}</td></tr></table></div>
    <div style="margin-bottom: 0.48rem;"><strong>Cash Left</strong><table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 0.06rem 0.5rem;">Calculated:</td><td style="text-align: right;">${fmt(record.calculatedCashLeft)}</td></tr>
    <tr><td style="padding: 0.06rem 0.5rem;">Actual:</td><td style="text-align: right;">${fmt(record.actualCashLeft)}</td></tr>
    <tr><td style="padding: 0.06rem 0.5rem;">Variance:</td><td style="text-align: right; color: ${varianceColor};">${formatVariance(variance)}</td></tr></table></div>
    </div></div></body></html>`;
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: RECIPIENT_EMAIL,
      from_name: `Matchanese - ${eventName}`,
      subject: `Event Sales Report - ${subjectDate} - ${eventName}`,
      message: emailContent,
      branch: eventName,
      date: formattedDate
    });
    console.log('✅ Event sales email sent');
  } catch (err) {
    console.error('❌ Event sales email failed:', err);
  }
}

function showEndOfDayModal() {
  const salesData = calculateSalesByPaymentMethod(selectedDate);
  const dateStr = getLocalDateString(selectedDate);
  const eventName = getEventDisplayName();
  const cashFlowKey = `cashFlow_${currentEvent}_${dateStr}`;
  const existingCashData = JSON.parse(localStorage.getItem(cashFlowKey) || '{"expenses": 0}');
  const expectedCash = salesData.cash - (existingCashData.expenses || 0);
  const formattedDate = formatEventSalesDate(dateStr);

  const reportModalStyles = `
    .eod-daily-container { font-family: 'Inter', sans-serif; max-width: 520px; width: 100%; background: #fff; padding: 1.25rem 1.5rem; border-radius: 16px; box-shadow: 0 8px 20px rgba(0,0,0,0.08); box-sizing: border-box; }
    .eod-daily-container label { font-weight: 600; font-size: 0.9rem; display: block; margin: 0.2rem 0 0.35rem; color: #333; }
    .eod-daily-container .eod-total-display { background-color: #dbffe6; font-size: 1.35rem; font-weight: 800; text-align: center; color: #137a2f; border: 2px solid #b6e8c1; border-radius: 10px; padding: 0.5rem 0.75rem; margin-bottom: 0; }
    .eod-daily-container .eod-split-row { display: flex; gap: 10px; margin-bottom: 0.5rem; }
    .eod-daily-container .eod-split-column { flex: 1; min-width: 0; }
    .eod-daily-container .eod-readonly-box { background-color: #eaffea; font-size: 1.05rem; font-weight: 800; text-align: center; color: #208f34; border: 2px solid #b6e8c1; border-radius: 10px; padding: 0.5rem 0.75rem; }
    .eod-daily-container .eod-group-card { background: #f9f9f9; padding: 0.5rem 1rem; border-radius: 10px; margin-bottom: 0.5rem; margin-top: 0.4rem; }
    .eod-daily-container .eod-subheader { font-weight: 600; font-size: 0.95rem; margin-bottom: 0.4rem; margin-top: 0.25rem; color: #444; }
    .eod-daily-container .eod-input-inline { display: flex; align-items: center; gap: 0.5rem; }
    .eod-daily-container .eod-input-inline .peso { color: #555; font-size: 0.95rem; }
    .eod-daily-container .eod-input-inline input { flex: 1; min-width: 0; padding: 0.45rem 0.6rem; font-size: 0.95rem; border: 1px solid #ccc; border-radius: 8px; background: #fff; box-sizing: border-box; }
    .eod-daily-container .eod-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem; gap: 0.75rem; }
    .eod-daily-container .eod-row label { margin: 0; min-width: 0; }
    .eod-daily-container .eod-row .eod-val { font-weight: 700; text-align: right; }
    .eod-daily-container .eod-btn-row { display: flex; gap: 0.75rem; margin-top: 1rem; }
    .eod-daily-container .eod-btn-cancel { flex: 1; padding: 0.7rem; font-size: 1rem; background: #e0e0e0; color: #333; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; }
    .eod-daily-container .eod-btn-submit { flex: 1; padding: 0.7rem; font-size: 1rem; background: #2b9348; color: #fff; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; }
    .eod-report-overwrite { background: #fff3cd; border: 1px solid #ffc107; padding: 0.6rem; border-radius: 8px; margin: 0.75rem 0; font-size: 0.85rem; color: #856404; }
  `;

  const formContent = `
    <style>${reportModalStyles}</style>
    <div class="eod-daily-container" id="eodReportModal">
      <div class="eod-split-row">
        <div class="eod-split-column">
          <label>Date</label>
          <div class="eod-readonly-box" style="font-size: 1rem; font-weight: 600;">${formattedDate}</div>
        </div>
        <div class="eod-split-column">
          <label>Event</label>
          <div class="eod-readonly-box" style="font-size: 0.95rem; font-weight: 600;">${eventName}</div>
        </div>
      </div>
      <label>Total Sales</label>
      <div class="eod-total-display" id="eodTotalDisplay">₱${formatWithCommas(salesData.total.toFixed(2))}</div>
      <div class="eod-split-row">
        <div class="eod-split-column">
          <label>Walk-In Sales</label>
          <div class="eod-readonly-box">₱${formatWithCommas(salesData.total.toFixed(2))}</div>
        </div>
        <div class="eod-split-column">
          <label>Cash Left</label>
          <div class="eod-readonly-box" id="eodCashLeft">₱${formatWithCommas(expectedCash.toFixed(2))}</div>
        </div>
      </div>
      <div class="eod-group-card">
        <div class="eod-subheader">Sales Breakdown (from POS)</div>
        <div class="eod-row"><label>Cash</label><span class="eod-val">₱${formatWithCommas(salesData.cash.toFixed(2))}</span></div>
        <div class="eod-row"><label>GCash</label><span class="eod-val">₱${formatWithCommas(salesData.gcash.toFixed(2))}</span></div>
        <div class="eod-row"><label>Card</label><span class="eod-val">₱${formatWithCommas(salesData.card.toFixed(2))}</span></div>
      </div>
      <div class="eod-group-card">
        <div class="eod-subheader">Cash Expenses</div>
        <div class="eod-row">
          <label>Cash Expenses</label>
          <div class="eod-input-inline" style="flex: 1; max-width: 140px;">
            <span class="peso">₱</span>
            <input type="number" id="eodExpenses" value="${existingCashData.expenses}" step="0.01" placeholder="0">
          </div>
        </div>
      </div>
      <div class="eod-group-card">
        <div class="eod-subheader">Cash Reconciliation</div>
        <div class="eod-row"><label>Expected Cash</label><span class="eod-val" id="eodExpectedCash">₱${formatWithCommas(expectedCash.toFixed(2))}</span></div>
        <div class="eod-row">
          <label>Actual Cash Count</label>
          <div class="eod-input-inline" style="flex: 1; max-width: 140px;">
            <span class="peso">₱</span>
            <input type="number" id="eodActualCash" value="${existingCashData.actualCash || expectedCash}" step="0.01" placeholder="0">
          </div>
        </div>
        <div class="eod-row"><label>Variance</label><span class="eod-val" id="eodVariance">₱0.00</span></div>
      </div>
      <div class="eod-btn-row">
        <button type="button" class="eod-btn-cancel" id="eodCancelBtn">Cancel</button>
        <button type="button" class="eod-btn-submit" id="eodNextBtn">Next</button>
      </div>
    </div>
  `;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay eod-sales-overlay';
  overlay.id = 'eodReportOverlay';
  const modal = document.createElement('div');
  modal.style.maxWidth = '560px';
  modal.style.width = '100%';
  modal.style.maxHeight = '90vh';
  modal.style.overflowY = 'auto';
  modal.style.overflowX = 'hidden';
  modal.style.boxSizing = 'border-box';
  modal.innerHTML = formContent;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const expensesInput = document.getElementById('eodExpenses');
  const actualInput = document.getElementById('eodActualCash');

  function updateEodCalculations() {
    const exp = parseFloat(expensesInput.value) || 0;
    const actual = parseFloat(actualInput.value) || 0;
    const expected = salesData.cash - exp;
    const variance = actual - expected;
    const cashLeftEl = document.getElementById('eodCashLeft');
    if (cashLeftEl) cashLeftEl.textContent = `₱${formatWithCommas(expected.toFixed(2))}`;
    document.getElementById('eodExpectedCash').textContent = `₱${formatWithCommas(expected.toFixed(2))}`;
    const el = document.getElementById('eodVariance');
    if (variance > 0) { el.style.color = '#1d8a00'; el.textContent = `+₱${formatWithCommas(variance.toFixed(2))}`; }
    else if (variance < 0) { el.style.color = '#ff4444'; el.textContent = `-₱${formatWithCommas(Math.abs(variance).toFixed(2))}`; }
    else { el.style.color = '#333'; el.textContent = `₱${formatWithCommas(variance.toFixed(2))}`; }
  }
  expensesInput.addEventListener('input', updateEodCalculations);
  actualInput.addEventListener('input', updateEodCalculations);
  updateEodCalculations();

  document.getElementById('eodCancelBtn').addEventListener('click', () => overlay.remove());

  document.getElementById('eodNextBtn').addEventListener('click', async () => {
    const expenses = parseFloat(expensesInput.value) || 0;
    const actualCash = parseFloat(actualInput.value) || 0;
    const calculatedCashLeft = salesData.cash - expenses;
    const variance = actualCash - calculatedCashLeft;
    const record = {
      eventKey: currentEvent,
      eventName,
      date: dateStr,
      cash: salesData.cash,
      gcash: salesData.gcash,
      card: salesData.card,
      totalSales: salesData.total,
      walkInSales: salesData.total,
      grab: 0,
      expenses,
      startingCash: 0,
      actualCashLeft: actualCash,
      calculatedCashLeft,
      cashVariance: variance,
      source: 'pos'
    };

    const salesRef = doc(db, 'event-sales', currentEvent, 'daily', dateStr);
    const existingSnap = await getDoc(salesRef);
    const hasExisting = existingSnap.exists();

    const summaryHTML = buildEventSalesSummaryHTML(record, eventName, dateStr);
    const confirmContent = `
      <style>${reportModalStyles}</style>
      <div class="eod-daily-container">
        <h2 style="font-size: 1.25rem; margin: 0 0 0.75rem; color: #2b9348; font-weight: 600;">Confirm Submission</h2>
        <div id="eodConfirmSummary" style="line-height: 1.56;"></div>
        <div id="eodOverwriteWarning" class="eod-report-overwrite" style="display: ${hasExisting ? 'block' : 'none'};">
          <strong>⚠️ Warning:</strong> A record already exists for this date and event. Submitting will overwrite it.
        </div>
        <div class="eod-btn-row">
          <button type="button" class="eod-btn-cancel" id="eodBackBtn">Back</button>
          <button type="button" class="eod-btn-submit" id="eodConfirmBtn">Confirm</button>
        </div>
      </div>
    `;
    modal.innerHTML = confirmContent;
    document.getElementById('eodConfirmSummary').innerHTML = summaryHTML;

    document.getElementById('eodBackBtn').addEventListener('click', () => {
      modal.innerHTML = formContent;
      const expInp = document.getElementById('eodExpenses');
      const actInp = document.getElementById('eodActualCash');
      expInp.value = expenses;
      actInp.value = actualCash;
      function up() {
        const e = parseFloat(expInp.value) || 0, a = parseFloat(actInp.value) || 0;
        const expected = salesData.cash - e, variance = a - expected;
        document.getElementById('eodExpectedCash').textContent = `₱${formatWithCommas(expected.toFixed(2))}`;
        const el = document.getElementById('eodVariance');
        if (variance > 0) { el.style.color = '#1d8a00'; el.textContent = `+₱${formatWithCommas(variance.toFixed(2))}`; }
        else if (variance < 0) { el.style.color = '#ff4444'; el.textContent = `-₱${formatWithCommas(Math.abs(variance).toFixed(2))}`; }
        else { el.style.color = '#333'; el.textContent = `₱${formatWithCommas(variance.toFixed(2))}`; }
      }
      expInp.addEventListener('input', up);
      actInp.addEventListener('input', up);
      up();
      document.getElementById('eodCancelBtn').addEventListener('click', () => overlay.remove());
      document.getElementById('eodNextBtn').addEventListener('click', function goConfirm() {
        const ex = parseFloat(document.getElementById('eodExpenses').value) || 0;
        const ac = parseFloat(document.getElementById('eodActualCash').value) || 0;
        const calcLeft = salesData.cash - ex;
        const rec = {
          eventKey: currentEvent, eventName, date: dateStr,
          cash: salesData.cash, gcash: salesData.gcash, card: salesData.card,
          totalSales: salesData.total, walkInSales: salesData.total, grab: 0,
          expenses: ex, startingCash: 0, actualCashLeft: ac, calculatedCashLeft: calcLeft,
          cashVariance: ac - calcLeft, source: 'pos'
        };
        getDoc(salesRef).then(existingSnap2 => {
          const summaryHTML2 = buildEventSalesSummaryHTML(rec, eventName, dateStr);
          const confirmContent2 = `
            <style>${reportModalStyles}</style>
            <div class="eod-daily-container">
              <h2 style="font-size: 1.25rem; margin: 0 0 0.75rem; color: #2b9348; font-weight: 600;">Confirm Submission</h2>
              <div id="eodConfirmSummary" style="line-height: 1.56;"></div>
              <div id="eodOverwriteWarning" class="eod-report-overwrite" style="display: ${existingSnap2.exists() ? 'block' : 'none'};">
                <strong>⚠️ Warning:</strong> A record already exists for this date and event. Submitting will overwrite it.
              </div>
              <div class="eod-btn-row">
                <button type="button" class="eod-btn-cancel" id="eodBackBtn">Back</button>
                <button type="button" class="eod-btn-submit" id="eodConfirmBtn">Confirm</button>
              </div>
            </div>
          `;
          modal.innerHTML = confirmContent2;
          document.getElementById('eodConfirmSummary').innerHTML = summaryHTML2;
          document.getElementById('eodBackBtn').addEventListener('click', () => {
            modal.innerHTML = formContent;
            const e2 = document.getElementById('eodExpenses');
            const a2 = document.getElementById('eodActualCash');
            e2.value = ex;
            a2.value = ac;
            function up2() {
              const e = parseFloat(e2.value) || 0, a = parseFloat(a2.value) || 0;
              const expected = salesData.cash - e, variance = a - expected;
              document.getElementById('eodExpectedCash').textContent = `₱${formatWithCommas(expected.toFixed(2))}`;
              const el = document.getElementById('eodVariance');
              if (variance > 0) { el.style.color = '#1d8a00'; el.textContent = `+₱${formatWithCommas(variance.toFixed(2))}`; }
              else if (variance < 0) { el.style.color = '#ff4444'; el.textContent = `-₱${formatWithCommas(Math.abs(variance).toFixed(2))}`; }
              else { el.style.color = '#333'; el.textContent = `₱${formatWithCommas(variance.toFixed(2))}`; }
            }
            e2.addEventListener('input', up2);
            a2.addEventListener('input', up2);
            up2();
            document.getElementById('eodCancelBtn').addEventListener('click', () => overlay.remove());
            document.getElementById('eodNextBtn').addEventListener('click', goConfirm);
          });
          document.getElementById('eodConfirmBtn').addEventListener('click', async (e) => {
            const cashFlowData = { date: dateStr, event: currentEvent, expenses: ex, actualCash: ac, expectedCash: calcLeft, variance: ac - calcLeft, salesData, savedAt: new Date().toISOString() };
            await finalizeEventSalesSubmission({
              overlay,
              confirmBtn: e.currentTarget,
              record: rec,
              salesRef,
              cashFlowKey,
              cashFlowData,
              eventName,
              dateStr,
              summaryHTML: summaryHTML2
            });
          });
        });
      });
    });

    document.getElementById('eodConfirmBtn').addEventListener('click', async (e) => {
      const cashFlowData = { date: dateStr, event: currentEvent, expenses, actualCash, expectedCash: calculatedCashLeft, variance, salesData, savedAt: new Date().toISOString() };
      await finalizeEventSalesSubmission({
        overlay,
        confirmBtn: e.currentTarget,
        record,
        salesRef,
        cashFlowKey,
        cashFlowData,
        eventName,
        dateStr,
        summaryHTML
      });
    });
  });
}

function showPosSuccessModal(record, eventName, dateStr, summaryHTML) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay eod-sales-overlay';
  overlay.id = 'posSuccessOverlay';
  const modal = document.createElement('div');
  modal.id = 'posSuccessModal';
  modal.style.width = '100%';
  modal.style.maxWidth = '560px';
  modal.style.background = '#fff';
  modal.style.borderRadius = '16px';
  modal.style.padding = '1.25rem 1.5rem';
  modal.style.boxShadow = '0 8px 20px rgba(0,0,0,0.08)';
  modal.style.boxSizing = 'border-box';
  modal.innerHTML = `
    <h2 style="margin:0 0 0.5rem; color: #2b9348; font-size: 1rem; text-align: center;">✅ Sales Submitted Successfully!</h2>
    <div id="posSuccessSummary" style="line-height: 1.56; margin: 0;"></div>
    <div style="text-align: center; margin-top: 1rem; display: flex; gap: 0.75rem; justify-content: center;">
      <button type="button" id="posDownloadBtn" style="padding: 0.75rem 1.5rem; background: #4a90e2; color: #fff; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">Download</button>
      <button type="button" id="posCloseSuccessBtn" style="padding: 0.75rem 1.5rem; background: #e0e0e0; color: #333; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">Close</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.getElementById('posSuccessSummary').innerHTML = summaryHTML;

  window._posSuccessDownloadContext = { record, eventName, dateStr, summaryHTML, modal };

  document.getElementById('posDownloadBtn').addEventListener('click', async () => {
    const ctx = window._posSuccessDownloadContext;
    if (!ctx || typeof html2canvas === 'undefined') return;
    const btn = document.getElementById('posDownloadBtn');
    const origText = btn.textContent;
    btn.textContent = 'Generating...';
    btn.disabled = true;
    try {
      const clone = ctx.modal.cloneNode(true);
      const summaryEl = clone.querySelector('#posSuccessSummary');
      if (summaryEl) summaryEl.innerHTML = ctx.summaryHTML;
      clone.querySelector('#posDownloadBtn')?.remove();
      clone.querySelector('#posCloseSuccessBtn')?.remove();
      clone.querySelector('h2')?.remove();
      clone.style.position = 'absolute';
      clone.style.left = '-9999px';
      document.body.appendChild(clone);
      const canvas = await html2canvas(clone, { backgroundColor: '#ffffff', scale: 2, logging: false, useCORS: true });
      document.body.removeChild(clone);
      const link = document.createElement('a');
      link.download = `event-sales-${(ctx.eventName || 'event').replace(/\s+/g, '-')}-${ctx.dateStr}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      btn.textContent = origText;
    } catch (err) {
      console.error(err);
      btn.textContent = origText;
    }
    btn.disabled = false;
  });

  document.getElementById('posCloseSuccessBtn').addEventListener('click', () => overlay.remove());
}

function showModal(content, onClose, showSaveButton = false) {
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) {
    existingModal.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.width = '400px';
  modal.style.maxWidth = '90%';

  modal.innerHTML = content;

  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  if (showSaveButton) {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'checkout-button modal-add';
    saveBtn.textContent = 'SAVE';
    saveBtn.addEventListener('click', () => {
      if (onClose) onClose();
      overlay.remove();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'checkout-button modal-cancel';
    cancelBtn.textContent = 'CANCEL';
    cancelBtn.addEventListener('click', () => overlay.remove());

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
  } else {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'checkout-button';
    closeBtn.textContent = 'CLOSE';
    closeBtn.addEventListener('click', () => {
      if (onClose) onClose();
      overlay.remove();
    });
    footer.appendChild(closeBtn);
  }

  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function updateEventDisplay() {
  const eventSelector = document.getElementById('eventSelector');
  if (eventSelector) {
    eventSelector.value = currentEvent;
  }
}

// Function to calculate sales by payment method
function calculateSalesByPaymentMethod(date) {
  const dateString = getLocalDateString(date);

  // Filter orders by date and status (only completed and pending orders)
  const relevantOrders = orderHistory.filter(order => {
    const orderEvent = order.event || 'pop-up'; // Default to 'pop-up' for existing orders
    return getLocalDateString(new Date(order.timestamp)) === dateString &&
      (order.status === 'completed' || order.status === 'pending') &&
      orderEvent === currentEvent;
  });

  // Initialize sales counters
  let totalSales = 0;
  let cashSales = 0;
  let gcashSales = 0;
  let cardSales = 0;

  // Calculate sales by payment method
  relevantOrders.forEach(order => {
    const orderTotal = order.total || 0;
    totalSales += orderTotal;

    switch (order.paymentMethod?.toLowerCase()) {
      case 'cash':
        cashSales += orderTotal;
        break;
      case 'gcash':
        gcashSales += orderTotal;
        break;
      case 'card':
        cardSales += orderTotal;
        break;
      default:
        // If payment method not specified, assume cash
        cashSales += orderTotal;
    }
  });

  return {
    total: totalSales,
    cash: cashSales,
    gcash: gcashSales,
    card: cardSales
  };
}

function showCashPaymentModal() {
  const existingModal = document.querySelector('.payment-modal-overlay');
  if (existingModal) {
    existingModal.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = 'payment-modal-overlay';

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      handlePaymentModalDismiss();
    }
  });

  const modal = document.createElement('div');
  modal.className = 'payment-modal';

  const header = document.createElement('h2');
  header.className = 'payment-modal-header';
  header.textContent = 'CASH PAYMENT';
  modal.appendChild(header);

  const tenderGrid = document.createElement('div');
  tenderGrid.className = 'tender-grid';

  const total = calculateOrderTotal();
  // Limit to 4 suggestions as requested
  const amounts = generateLogicalTenderAmounts(total).slice(0, 4);

  // Create the tender amount buttons
  amounts.forEach(amount => {
    const button = document.createElement('button');
    button.className = 'tender-button-modal';
    button.dataset.amount = amount;
    button.innerHTML = '₱' + formatWithCommas(amount);

    // Disable buttons less than total
    if (amount < total) {
      button.disabled = true;
    }

    button.addEventListener('click', () => selectCashAmount(amount, modal));
    tenderGrid.appendChild(button);
  });

  // Create a custom input to match the existing buttons
  const customInputWrapper = document.createElement('div');
  customInputWrapper.className = 'custom-input-wrapper';

  const customInput = document.createElement('input');
  customInput.type = 'number';
  customInput.min = total;
  customInput.className = 'custom-amount-input';
  customInput.placeholder = 'CUSTOM AMOUNT';

  // Apply entered amount when input changes
  customInput.addEventListener('input', () => {
    const customAmount = parseFloat(customInput.value);
    if (!isNaN(customAmount) && customAmount >= total) {
      selectCashAmount(customAmount, modal);
    }
  });

  customInputWrapper.appendChild(customInput);
  tenderGrid.appendChild(customInputWrapper);

  modal.appendChild(tenderGrid);

  const totalDisplay = document.createElement('div');
  totalDisplay.className = 'payment-total';
      totalDisplay.innerHTML = '';
    
    // Format total with Poppins font for numerical digits
    const totalLabelSpan = document.createElement('span');
    totalLabelSpan.textContent = 'Total: ₱';
    
    const priceSpan = document.createElement('span');
    priceSpan.style.fontFamily = 'Poppins, sans-serif';
    priceSpan.style.fontWeight = '600';
    priceSpan.textContent = formatWithCommas(total.toFixed(2));
    
    totalDisplay.appendChild(totalLabelSpan);
    totalDisplay.appendChild(priceSpan);
  modal.appendChild(totalDisplay);

  const changeText = document.createElement('div');
  changeText.className = 'change-text';
  changeText.textContent = 'Change: ₱0.00';
  modal.appendChild(changeText);

  const chargeButton = document.createElement('button');
  chargeButton.className = 'charge-button';
  chargeButton.textContent = 'CHARGE';
  chargeButton.addEventListener('click', () => {
    completeCashPayment();
  });
  modal.appendChild(chargeButton);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Focus on the custom input after rendering
  setTimeout(() => customInput.focus(), 100);
}

function generateLogicalTenderAmounts(total) {
  const options = new Set();
  const bills = [20, 50, 100, 200, 500, 1000];

  // Round up to the nearest whole peso
  total = Math.ceil(total);

  // Add basic amounts that are larger than total
  for (const bill of bills) {
    if (bill >= total) {
      options.add(bill);
    }
  }

  // Add common combinations
  // If total is near 100s (like 190), suggest exact hundreds
  const nextHundred = Math.ceil(total / 100) * 100;
  options.add(nextHundred);

  // Add common combinations for larger amounts
  if (total > 200) {
    // Add 200+200, 200+500, etc.
    const ceil200 = Math.ceil(total / 200) * 200;
    options.add(ceil200);

    if (total % 200 >= 100 && total % 200 < 200) {
      options.add(Math.floor(total / 200) * 200 + 300);
    }
  }

  // For amounts over 1000
  if (total > 1000) {
    const nearestThousand = Math.ceil(total / 1000) * 1000;
    options.add(nearestThousand);

    // Add logical combinations like 1500, 2000, etc.
    if (total % 1000 >= 500 && total % 1000 < 700) {
      options.add(Math.floor(total / 1000) * 1000 + 600);
    }
  }

  // Convert Set to Array and sort
  const amounts = Array.from(options);
  amounts.sort((a, b) => a - b);

  // Take only the 6 most logical options
  const filteredAmounts = amounts.filter(amount => amount >= total);

  // Always include exact change if it's a round number
  if (Number.isInteger(total) && !filteredAmounts.includes(total)) {
    filteredAmounts.unshift(total);
  }

  // Return up to 6 most logical amounts
  return filteredAmounts.slice(0, 6);
}

function formatWithCommas(number) {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function handlePaymentModalDismiss() {
  liveSessionState = currentOrder.length > 0
    ? { paymentMethod: null, showQr: false, status: 'editing' }
    : { paymentMethod: null, showQr: false, status: 'idle' };
  scheduleLiveSessionPublish(true);
}


function showGCashPaymentModal() {
  const existingModal = document.querySelector('.payment-modal-overlay');
  if (existingModal) {
    existingModal.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = 'payment-modal-overlay';

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      handlePaymentModalDismiss();
    }
  });

  const modal = document.createElement('div');
  modal.className = 'payment-modal';

  const header = document.createElement('h2');
  header.className = 'payment-modal-header';
  header.textContent = 'GCash Payment';
  modal.appendChild(header);

  // QR Code image (changed from div to img)
  const qrCode = document.createElement('img');
  qrCode.className = 'qr-code';
  qrCode.src = 'images/qr-bea.png';
  qrCode.alt = 'GCash QR Code';
  modal.appendChild(qrCode);

  // Total display
  const totalDisplay = document.createElement('div');
  totalDisplay.className = 'payment-total';
  totalDisplay.textContent = 'Total: ₱' + calculateOrderTotal().toFixed(2);
  modal.appendChild(totalDisplay);

  // Payment sent button
  const sentButton = document.createElement('button');
  sentButton.className = 'charge-button';
  sentButton.textContent = 'PAYMENT SENT';
  sentButton.addEventListener('click', () => {
    completeDigitalPayment('GCash');
    // overlay.remove();
  });
  modal.appendChild(sentButton);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function showCardPaymentModal() {
  const existingModal = document.querySelector('.payment-modal-overlay');
  if (existingModal) {
    existingModal.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = 'payment-modal-overlay';

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      handlePaymentModalDismiss();
    }
  });

  const modal = document.createElement('div');
  modal.className = 'payment-modal';

  const header = document.createElement('h2');
  header.className = 'payment-modal-header';
  header.textContent = 'Card Payment';
  modal.appendChild(header);

  // QR Code image (changed from div to img)
  const qrCode = document.createElement('img');
  qrCode.className = 'qr-code';
  qrCode.src = 'images/qr.png';
  qrCode.alt = 'Card';
  modal.appendChild(qrCode);

  // Total display
  const totalDisplay = document.createElement('div');
  totalDisplay.className = 'payment-total';
  totalDisplay.textContent = 'Total: ₱' + calculateOrderTotal().toFixed(2);
  modal.appendChild(totalDisplay);

  // Payment sent button
  const sentButton = document.createElement('button');
  sentButton.className = 'charge-button';
  sentButton.textContent = 'PAYMENT SENT';
  sentButton.addEventListener('click', () => {
    completeDigitalPayment('Card');
    // overlay.remove();
  });
  modal.appendChild(sentButton);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function selectCashAmount(amount, modal) {
  const total = calculateOrderTotal();
  const change = amount - total;

  const changeText = modal.querySelector('.change-text');

          // Remove cash display element as it's no longer needed
        changeText.textContent = 'Change: ₱' + change.toFixed(2);
  changeText.style.color = change >= 0 ? 'black' : 'red';
}

function completeCashPayment() {
  const now = new Date();

  // Determine if we're editing or creating a new order
  const isEditing = window.editingOrderData !== undefined;

  const order = {
    id: isEditing ? window.editingOrderData.originalId : generateOrderId(),
    items: [...currentOrder],
    total: calculateOrderTotal(),
    paymentMethod: 'Cash', // or method
    timestamp: isEditing ? window.editingOrderData.timestamp : now.toISOString(),
    status: 'pending',
    customerName: customerName,
    event: currentEvent,
    needsSync: true,
    lastModified: now.toISOString()
  };

  liveSessionState = { paymentMethod: 'cash', showQr: false, status: 'paid' };
  scheduleLiveSessionPublish(true);

  // Add Firebase ID if we're editing
  if (isEditing && window.editingOrderData.firebaseId) {
    order.firebaseId = window.editingOrderData.firebaseId;
  }

  // Save to order history
  orderHistory.push(order);
  localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

  // Determine order date and sync action
  const orderDate = getLocalDateString(new Date(order.timestamp));
  console.log(`Creating/updating order with date: ${orderDate}`);

  // Sync immediately to Firebase
  syncOrderToFirebase(order).then(success => {
    if (success) {
      const orderIndex = orderHistory.findIndex(o => o.id === order.id);
      if (orderIndex > -1) {
        orderHistory[orderIndex].needsSync = false;
        localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
      }
    }
  });

  // Clear editing state if needed
  if (isEditing) {
    window.editingOrderData = undefined;
  }

  showOrderConfirmation();
}

function completeDigitalPayment(method) {
  const now = new Date();

  // Determine if we're editing or creating a new order
  const isEditing = window.editingOrderData !== undefined;

  const order = {
    id: isEditing ? window.editingOrderData.originalId : generateOrderId(),
    items: [...currentOrder],
    total: calculateOrderTotal(),
    paymentMethod: method, // or method
    timestamp: isEditing ? window.editingOrderData.timestamp : now.toISOString(),
    status: 'pending',
    customerName: customerName,
    event: currentEvent,
    needsSync: true,
    lastModified: now.toISOString()
  };
  
  const normalizedMethod = (method || '').toLowerCase();
  liveSessionState = {
    paymentMethod: normalizedMethod || null,
    showQr: normalizedMethod === 'gcash' || normalizedMethod === 'card',
    status: 'paid'
  };
  scheduleLiveSessionPublish(true);
  
  // Add Firebase ID if we're editing
  if (isEditing && window.editingOrderData.firebaseId) {
    order.firebaseId = window.editingOrderData.firebaseId;
  }

  // Save to order history
  orderHistory.push(order);
  localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

  // Determine order date and sync action
  const orderDate = getLocalDateString(new Date(order.timestamp));
  console.log(`Creating/updating order with date: ${orderDate}`);

  // Sync immediately to Firebase
  syncOrderToFirebase(order).then(success => {
    if (success) {
      const orderIndex = orderHistory.findIndex(o => o.id === order.id);
      if (orderIndex > -1) {
        orderHistory[orderIndex].needsSync = false;
        localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
      }
    }
  });

  // Clear editing state if needed
  if (isEditing) {
    window.editingOrderData = undefined;
  }

  showOrderConfirmation();
}

function showOrderConfirmation() {
  const modal = document.querySelector('.payment-modal');
  const overlay = document.querySelector('.payment-modal-overlay');
  const modalContent = modal.querySelectorAll(':not(.modal-header)');

  // Fade out content
  modalContent.forEach(element => {
    element.style.transition = 'opacity 0.3s ease';
    element.style.opacity = '0';
  });

  // Remove header and animate modal to square
  setTimeout(() => {
    modalContent.forEach(element => element.remove());

    // Remove header and animate to square
    const header = modal.querySelector('.modal-header');
    if (header) header.remove();

    // Animate modal to square shape
    modal.style.cssText = `
      transition: all 0.3s ease;
      padding: 40px;
      width: 125px;
      height: 125px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
    `;

    // Add loading icon
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'loading-container';
    loadingContainer.style.cssText = `
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const loadingIcon = document.createElement('div');
    loadingIcon.className = 'loading-icon';
    loadingIcon.innerHTML = '<img src="images/loading-icon.png" alt="Loading" style="width: 50px; height: 50px; animation: spin 1s linear infinite;">';

    loadingContainer.appendChild(loadingIcon);
    modal.appendChild(loadingContainer);

    // Show success message after 1 second
    setTimeout(() => {
      loadingContainer.remove();

      const successMessage = document.createElement('div');
      successMessage.className = 'order-success';
      successMessage.innerHTML = 'ORDER<br>SENT!';
      successMessage.style.cssText = `
        width: 100%;
        text-align: center;
        font-family: "Poppins", sans-serif;
        font-size: 20px;
        font-weight: 200;
        color: #1d8a00;
        opacity: 0;
        transition: opacity 0.3s ease;
      `;
      modal.appendChild(successMessage);

      // Fade in success message
      setTimeout(() => {
        successMessage.style.opacity = '1';
      }, 50);

      // Fade out and close after 1.5 seconds
      setTimeout(() => {
        successMessage.style.opacity = '0';
        modal.style.opacity = '0';
        overlay.style.opacity = '0';

        setTimeout(() => {
          if (overlay) overlay.remove();
          clearOrder();
        }, 300);
      }, 1500);
    }, 1000);
  }, 300);
}

document.addEventListener('DOMContentLoaded', async () => {
  // Migrate existing orders to new sync format
  function migrateExistingOrders() {
    const orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
    let needsMigration = false;

    orderHistory.forEach(order => {
      if (order.needsSync === undefined) {
        order.needsSync = false; // Assume existing orders are already synced
        order.lastModified = order.lastModified || order.timestamp;
        needsMigration = true;
      }
    });

    if (needsMigration) {
      localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
      console.log('Migrated existing orders to new sync format');
    }
  }

  // Call migration before other initialization
  migrateExistingOrders();

  // Load events and event menu BEFORE first render so we show the correct menu from the start
  // (initializeEventSelector -> loadAvailableEvents -> loadEventMenu -> refreshMenuDisplay already renders the menu once)
  await initializeEventSelector();

  updateOrderDisplay();
  initializePaymentHandlers();
  initializeDatePicker();
  updateEventDisplay();

  // Initialize menu items in Firebase on first run
  await initializeMenuItems();

  // Make syncOrdersWithFirebase available globally
  window.syncOrdersWithFirebase = syncOrdersWithFirebase;

  // Push any locally queued orders and start real-time listener for today
  await syncOrdersWithFirebase();
  subscribeToOrders(currentEvent, selectedDate, mergeFirebaseOrder);

  // Periodic sync keeps offline-queued orders flushed to Firebase
  setInterval(syncOrdersWithFirebase, 60000);

  // Add window resize listener to recalculate grid columns
  let resizeTimeout;
  // Safari-safe viewport height: 100vh is unreliable on Safari because it
  // doesn't shrink when the browser chrome (address bar) is visible.
  // We measure window.innerHeight and expose it as --vh for use in CSS.
  function setVhVariable() {
    document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
  }
  setVhVariable();
  window.addEventListener('resize', setVhVariable);
  // Safari fires a scroll event on the window when its chrome appears/disappears
  window.addEventListener('scroll', setVhVariable, { passive: true });

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (isGridView) {
        const menuContainer = document.getElementById('menuContent');
        const menuDataToUse = currentMenuData || menuData;
        if (menuContainer && menuDataToUse) {
          calculateOptimalGridColumns(menuContainer, menuDataToUse.items.length);
        }
      }
    }, 150);
  });

  // Order header event listener
  const orderHeader = document.getElementById('orderHeader');
  if (orderHeader) {
    orderHeader.addEventListener('click', showNameInputModal);
  }

  const deleteDayBtn = document.getElementById('deleteDay');
  if (deleteDayBtn) {
    deleteDayBtn.addEventListener('click', clearDateData);
  }

  const forceSyncBtn = document.getElementById('forceSyncBtn');
  if (forceSyncBtn) {
    forceSyncBtn.addEventListener('click', forceFullSync);
  }

  window.showOrderBackupModal = showOrderBackupModal;

  // Package submit handler
  const packageSubmitBtn = document.getElementById('package-submit');
  if (packageSubmitBtn) {
    packageSubmitBtn.addEventListener('click', () => {
      if (currentOrder.length === 0) {
        alert('Please add items to your order first.');
        return;
      }
      submitPackageOrder();
    });
  }
});

async function initializeEventSelector() {
  console.log('=== initializeEventSelector called ===');
  const eventSelector = document.getElementById('eventSelector');

  // Load events from Firebase first
  await loadAvailableEvents();
  console.log('availableEvents after loading:', availableEvents);

  // Populate event selector (this will handle filtering)
  updateEventSelector();
  // Set current event
  eventSelector.value = currentEvent;

  // Event selector change handler
  eventSelector.addEventListener('change', async (e) => {
    const previousEvent = currentEvent;
    currentEvent = e.target.value;
    window.currentEvent = currentEvent;
    localStorage.setItem('currentEvent', currentEvent);

    if (previousEvent && previousEvent !== currentEvent) {
      clearLiveSession(previousEvent);
    }

    // Load custom menu for the new event
    await loadEventMenu(currentEvent);

    // Update display mode for new service type
    updateDisplayMode();

    // Force update order display for payment buttons
    updateOrderDisplay();

    // Reload orders for the new event with a fresh real-time listener
    syncOrdersWithFirebase();
    subscribeToOrders(currentEvent, selectedDate, mergeFirebaseOrder);
    displayOrderHistory();
    scheduleLiveSessionPublish(true);
  });
}

function getOrdersForBackup() {
  const live = Array.isArray(orderHistory) ? orderHistory : [];
  let backup = [];
  try {
    backup = JSON.parse(localStorage.getItem('orderHistoryBackup') || '[]');
  } catch (error) {
    console.error('Failed to read orderHistoryBackup:', error);
  }
  if (!Array.isArray(backup)) backup = [];
  return backup.length > live.length ? backup : live;
}

function summarizeOrdersForBackup(orders) {
  const byEvent = {};
  let salesTotal = 0;
  let counted = 0;

  orders.forEach(order => {
    if (!order || order.status === 'deleted') return;
    counted += 1;
    const eventKey = order.event || 'pop-up';
    const dateStr = getLocalDateString(new Date(order.timestamp));
    const isSales = order.status === 'pending' || order.status === 'completed';
    const amount = Number(order.total) || 0;

    if (!byEvent[eventKey]) {
      byEvent[eventKey] = { count: 0, total: 0, byDate: {} };
    }
    byEvent[eventKey].count += 1;
    if (isSales) {
      byEvent[eventKey].total += amount;
      salesTotal += amount;
    }
    if (!byEvent[eventKey].byDate[dateStr]) {
      byEvent[eventKey].byDate[dateStr] = { count: 0, total: 0 };
    }
    byEvent[eventKey].byDate[dateStr].count += 1;
    if (isSales) {
      byEvent[eventKey].byDate[dateStr].total += amount;
    }
  });

  return { counted, salesTotal, byEvent };
}

function buildOrderBackupPayload() {
  const orders = getOrdersForBackup();
  const summary = summarizeOrdersForBackup(orders);
  return {
    exportedAt: new Date().toISOString(),
    deviceEvent: currentEvent,
    orderCount: orders.length,
    summary,
    orders
  };
}

async function copyBackupJson(jsonText) {
  try {
    await navigator.clipboard.writeText(jsonText);
    return true;
  } catch (error) {
    const textarea = document.createElement('textarea');
    textarea.value = jsonText;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  }
}

async function shareOrDownloadBackup(payload, jsonText) {
  const filename = `pos-order-backup-${getLocalDateString()}.json`;
  const file = new File([jsonText], filename, { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: 'POS order backup',
      text: `${payload.orderCount} orders, ${formatEventSalesCurrency(payload.summary.salesTotal)}`
    });
    return;
  }

  const blobUrl = URL.createObjectURL(new Blob([jsonText], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

function showOrderBackupModal() {
  const existing = document.querySelector('.order-backup-modal');
  if (existing) existing.remove();

  const payload = buildOrderBackupPayload();
  const jsonText = JSON.stringify(payload, null, 2);
  const { counted, salesTotal, byEvent } = payload.summary;

  let eventHtml = '';
  const eventKeys = Object.keys(byEvent);
  if (eventKeys.length === 0) {
    eventHtml = '<p>No orders found in this app\'s local storage.</p>';
  } else {
    eventHtml = eventKeys.map(eventKey => {
      const group = byEvent[eventKey];
      const dates = Object.keys(group.byDate).sort().reverse().map(dateStr => {
        const day = group.byDate[dateStr];
        return `<li>${dateStr}: ${day.count} orders, ${formatEventSalesCurrency(day.total)}</li>`;
      }).join('');
      return `
        <div class="backup-event-block">
          <strong>${getEventDisplayName(eventKey)}</strong>
          <div class="backup-event-meta">${eventKey} · ${group.count} orders · ${formatEventSalesCurrency(group.total)}</div>
          <ul>${dates}</ul>
        </div>`;
    }).join('');
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay order-backup-modal';

  const modal = document.createElement('div');
  modal.className = 'modal backup-modal';
  modal.innerHTML = `
    <h2 class="modal-header">LOCAL ORDER BACKUP</h2>
    <p class="backup-summary">This iPad has <strong>${counted}</strong> local orders totaling <strong>${formatEventSalesCurrency(salesTotal)}</strong> (pending + completed). Copy this JSON off the device before Force Sync or any storage reset.</p>
    <div class="backup-event-list">${eventHtml}</div>
    <textarea class="backup-json" readonly></textarea>
    <div class="modal-footer backup-modal-footer">
      <button type="button" class="checkout-button modal-cancel" id="backupCloseBtn">CLOSE</button>
      <button type="button" class="checkout-button" id="backupCopyBtn">COPY JSON</button>
      <button type="button" class="checkout-button modal-add" id="backupShareBtn">SHARE / SAVE</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const textarea = modal.querySelector('.backup-json');
  textarea.value = jsonText;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  modal.querySelector('#backupCloseBtn').addEventListener('click', () => overlay.remove());
  modal.querySelector('#backupCopyBtn').addEventListener('click', async () => {
    const copied = await copyBackupJson(jsonText);
    alert(copied
      ? 'Copied. Paste it into Notes, Files, or an email and save it off this iPad.'
      : 'Copy failed. Long-press the text box, Select All, then Copy.');
  });
  modal.querySelector('#backupShareBtn').addEventListener('click', async () => {
    try {
      await shareOrDownloadBackup(payload, jsonText);
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      textarea.focus();
      textarea.select();
      alert('Share failed. Long-press the text box, Select All, then Copy.');
    }
  });
}

async function forceFullSync() {
  const forceSyncBtn = document.getElementById('forceSyncBtn');
  forceSyncBtn.disabled = true;
  forceSyncBtn.textContent = 'SYNCING...';

  try {
    console.log("Starting force sync of all local data...");

    // Get all local orders
    const localOrders = JSON.parse(localStorage.getItem('orderHistory') || '[]');
    console.log(`Found ${localOrders.length} total orders to sync`);

    // Group orders by date
    const ordersByDate = {};
    localOrders.forEach(order => {
      const dateStr = getLocalDateString(new Date(order.timestamp));
      if (!ordersByDate[dateStr]) {
        ordersByDate[dateStr] = [];
      }
      ordersByDate[dateStr].push(order);
    });

    // Sync each date's orders
    for (const [dateStr, orders] of Object.entries(ordersByDate)) {
      console.log(`Syncing ${orders.length} orders for ${dateStr}`);

      for (const order of orders) {
        // Skip deleted orders
        if (order.status === 'deleted') continue;

        // Force sync to Firebase
        await syncOrderToFirebase(order);
      }
    }

    // Wait for queue to process
    await new Promise(resolve => setTimeout(resolve, 5000));

    alert(`Force sync completed. Synced orders from ${Object.keys(ordersByDate).length} days.`);
  } catch (error) {
    console.error('Force sync failed:', error);
    alert('Force sync failed. Check console for details.');
  } finally {
    forceSyncBtn.disabled = false;
    forceSyncBtn.textContent = 'FORCE SYNC';
  }
}

async function loadOrdersFromLocalStorage() {
  orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
}

async function syncOrdersWithFirebase() {
  console.log('Running periodic sync...');
  await syncAllPendingOrders();

  // Update display if on orders page
  if (document.getElementById('orders-container').style.display !== 'none') {
    displayOrderHistory();
  }
}

function mergeFirebaseOrder(docSnapshot) {
  const remote = { firebaseId: docSnapshot.id, ...docSnapshot.data() };

  // Never overwrite an order that this device is currently mid-edit
  if (window.editingOrderData?.originalId === remote.id) return;

  const localIndex = orderHistory.findIndex(o => o.id === remote.id);

  if (localIndex === -1) {
    // Order created on another device — add it
    orderHistory.push(remote);
  } else {
    const local = orderHistory[localIndex];
    // Local wins only if it has unsynced changes that are newer than Firebase
    const localNewer = local.needsSync &&
      new Date(local.lastModified) > new Date(remote.lastModified);

    if (!localNewer) {
      // Firebase version is newer or equal — accept it
      orderHistory[localIndex] = { ...remote, needsSync: false };
    }
    // Otherwise: local pending change is newer, leave it alone until it pushes
  }

  localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

  if (document.getElementById('orders-container').style.display !== 'none') {
    displayOrderHistory();
  }
}

// Replace the existing showNameInputModal function:
function showNameInputModal() {
  const existingModal = document.querySelector('.name-input-modal');
  if (existingModal) {
    existingModal.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay name-input-modal';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const header = document.createElement('h2');
  header.className = 'modal-header';
  header.textContent = "Who's this order for?";
  modal.appendChild(header);

  const previousName = customerName;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Enter name';
  input.value = customerName;
  input.maxLength = 30;
  
  const applyTypedName = (name, persist) => {
    customerName = String(name || '').trim();
    updateOrderHeader();
    scheduleLiveSessionPublish(persist);
  };

  input.addEventListener('input', () => {
    applyTypedName(input.value, false);
  });

  // Add Enter key handler
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      updateCustomerName(input.value, overlay);
    }
  });
  
  modal.appendChild(input);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'checkout-button modal-cancel';
  cancelBtn.innerHTML = '<img src="images/cancel-icon.png" class="btn-icon" alt="Cancel">CANCEL';
  cancelBtn.addEventListener('click', () => {
    applyTypedName(previousName, true);
    overlay.remove();
  });

  const okBtn = document.createElement('button');
  okBtn.className = 'checkout-button modal-add';
  okBtn.innerHTML = '<img src="images/done-icon.png" class="btn-icon" alt="OK">OK';
  okBtn.addEventListener('click', () => {
    console.log('[GREETING_DEBUG][POS] OK button click handler');
    updateCustomerName(input.value, overlay);
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(okBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      applyTypedName(previousName, true);
      overlay.remove();
    }
  });

  setTimeout(() => input.focus(), 100);
}

function updateCustomerName(name, overlay) {
  customerName = name.trim();
  updateOrderHeader();
  overlay.remove();

  console.log('[GREETING_DEBUG][POS] updateCustomerName called', {
    name: customerName,
    event: currentEvent,
    scriptHint: 'expect script.js?v=greeting-fix-2+'
  });

  // Cancel any debounced typing publish so it cannot race the greeting write.
  if (liveSessionPublishTimer) {
    clearTimeout(liveSessionPublishTimer);
    liveSessionPublishTimer = null;
  }

  if (customerName) {
    const greetingId = Date.now();
    const payload = {
      ...buildLiveSessionPayload(),
      nameGreetingId: greetingId
    };
    console.log('[GREETING_DEBUG][POS] OK pressed — publishing', {
      name: customerName,
      event: currentEvent,
      greetingId
    });
    publishLiveSession(currentEvent, payload).then((ok) => {
      console.log('[GREETING_DEBUG][POS] publishLiveSession result', { ok, greetingId, customerName, event: currentEvent, payload });
    });
    try {
      localStorage.setItem('posNameGreeting', JSON.stringify({
        id: greetingId,
        name: customerName,
        event: currentEvent,
        at: greetingId
      }));
      console.log('[GREETING_DEBUG][POS] localStorage posNameGreeting written');
    } catch (err) {
      console.warn('[GREETING_DEBUG][POS] localStorage write failed', err);
    }
    return;
  }

  console.log('[GREETING_DEBUG][POS] empty name — no greeting publish');
  scheduleLiveSessionPublish(true);
}

// Replace the existing updateOrderHeader function:
function updateOrderHeader() {
  const headerText = document.querySelector('.order-header-text');
  if (customerName) {
    headerText.innerHTML = `<span style="font-weight: 700;">${customerName.toUpperCase()}</span><span style="font-weight: 300;">'S ORDER</span>`;
  } else {
    headerText.innerHTML = 'YOUR <span class="light">ORDER</span>';
  }
}

function initializeDatePicker() {
  const dateDisplay = document.getElementById('dateDisplay');
  const prevDayBtn = document.getElementById('prevDay');
  const nextDayBtn = document.getElementById('nextDay');
  
  const refreshBtn = document.getElementById('refreshBtn');

  refreshBtn.addEventListener('click', async () => {
    const refreshIcon = refreshBtn.querySelector('.refresh-icon');
    refreshIcon.classList.add('rotating');
    refreshBtn.disabled = true;

    try {
      await syncOrdersWithFirebase();
      displayOrderHistory();
    } catch (error) {
      console.error('Error during refresh:', error);
    } finally {
      // Remove rotation animation after 1 second
      setTimeout(() => {
        refreshIcon.classList.remove('rotating');
        refreshBtn.disabled = false;
      }, 1000);
    }
  });

  // Initialize Flatpickr
  flatpickr(dateDisplay, {
    defaultDate: new Date(),
    onChange: function (selectedDates, dateStr, instance) {
      selectedDate = selectedDates[0];
      updateDateDisplay();
      displayOrderHistory();
      subscribeToOrders(currentEvent, selectedDate, mergeFirebaseOrder);
    },
    maxDate: "today",
    disableMobile: true
  });

  // Previous day button
  prevDayBtn.addEventListener('click', () => {
    selectedDate.setDate(selectedDate.getDate() - 1);
    updateDateDisplay();
    displayOrderHistory();
    subscribeToOrders(currentEvent, selectedDate, mergeFirebaseOrder);
  });

  // Next day button
  nextDayBtn.addEventListener('click', () => {
    selectedDate.setDate(selectedDate.getDate() + 1);
    updateDateDisplay();
    displayOrderHistory();
    subscribeToOrders(currentEvent, selectedDate, mergeFirebaseOrder);
  });

  updateDateDisplay();
}

function updateDateDisplay() {
  const dateDisplay = document.getElementById('dateDisplay');
  const nextDayBtn = document.getElementById('nextDay');
  const today = new Date();

  // Check if selected date is today
  const isToday = selectedDate.toDateString() === today.toDateString();

  // Update display
  if (isToday) {
    dateDisplay.textContent = 'TODAY';
    // Keep "TODAY" in Poppins
    dateDisplay.style.fontFamily = "'Poppins', sans-serif";
    dateDisplay.style.fontWeight = '300';
  } else {
    dateDisplay.textContent = selectedDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
    // Change to Poppins for dates
    dateDisplay.style.fontFamily = "'Poppins', sans-serif";
    dateDisplay.style.fontWeight = '600';
  }

  // Disable next button if today is selected
  nextDayBtn.disabled = isToday;

  updateTotalSalesDisplay();
}

function openOrderPanel() {
  const panel = document.getElementById('order-panel');
  if (window.innerWidth <= 767) {
    panel.classList.add('open');
    const backdrop = document.getElementById('sheet-backdrop');
    if (backdrop) backdrop.style.display = 'block';
  } else {
    panel.style.display = 'flex';
  }
}

function closeOrderPanel() {
  const panel = document.getElementById('order-panel');
  panel.classList.remove('open');
  const backdrop = document.getElementById('sheet-backdrop');
  if (backdrop) backdrop.style.display = 'none';
  if (window.innerWidth > 767) {
    panel.style.display = 'none';
  }
}

function initializeMobileLayout() {
  const mobileOrderButton = document.getElementById('mobileOrderButton');
  const mobileBackButton = document.getElementById('mobileBackButton');
  const menuContainer = document.getElementById('menu-container');

  if (mobileOrderButton && mobileBackButton) {
    mobileOrderButton.addEventListener('click', () => {
      openOrderPanel();
      mobileOrderButton.style.display = 'none';
    });

    mobileBackButton.addEventListener('click', () => {
      closeOrderPanel();
      mobileOrderButton.style.display = 'flex';
    });

    const backdrop = document.getElementById('sheet-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => {
        closeOrderPanel();
        mobileOrderButton.style.display = 'flex';
      });
    }
  }

  // Update the mobile order button total when the order changes
  function updateMobileOrderButton() {
    const mobileTotal = document.querySelector('.mobile-order-total');
            if (mobileTotal) {
          const total = calculateOrderTotal();
          mobileTotal.textContent = '₱ ' + total.toFixed(2);

      // Update items count
      const itemsCount = currentOrder.reduce((sum, item) => sum + item.quantity, 0);
      const viewOrderText = document.querySelector('#mobileOrderButton > span:first-child');
      if (viewOrderText) {
        viewOrderText.textContent = itemsCount > 0 ?
          `VIEW ORDER (${itemsCount} ${itemsCount === 1 ? 'item' : 'items'})` :
          'VIEW ORDER';
      }
    }
  }
}

// Call this in your DOMContentLoaded event
document.addEventListener('DOMContentLoaded', async () => {
  // ... existing code ...
  initializeMobileLayout();
  
  // Add toggle button event listener
  const toggleBtn = document.getElementById('viewToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleView);
  }
});

function clearDateData() {
  const dateString = getLocalDateString(selectedDate);
  
  // Show confirmation dialog
  const confirmMsg = `Are you sure you want to delete ALL orders for ${selectedDate.toLocaleDateString()}?`;
  if (!confirm(confirmMsg)) {
    return; // User cancelled
  }

  try {
    // 1. Filter out orders for the specified date from local storage
    const orders = JSON.parse(localStorage.getItem('orderHistory') || '[]');
    console.log(`Before filtering: ${orders.length} total orders`);
    
    const filteredOrders = orders.filter(order => {
      const orderDateStr = getLocalDateString(new Date(order.timestamp));
      const shouldKeep = orderDateStr !== dateString;
      if (!shouldKeep) {
        console.log(`Filtering out order ${order.id} with date ${orderDateStr}`);
      }
      return shouldKeep;
    });
    
    console.log(`After filtering: ${filteredOrders.length} orders remain`);

    // 2. Save filtered orders back to local storage
    localStorage.setItem('orderHistory', JSON.stringify(filteredOrders));
    orderHistory = filteredOrders;

    // 3. Clear current order if we're clearing today's data
    const today = getLocalDateString(new Date());
    if (dateString === today) {
      currentOrder = [];
      customerName = '';
      updateOrderDisplay();
      updateOrderHeader();
    }

    // 4. Refresh the order history display
    displayOrderHistory();

    // 5. Delete the same day's data from Firebase
    console.log(`Clearing Firebase data for date: ${dateString}`);

    // Create a reference to the date collection in Firebase
    // Create a reference to the date collection in Firebase
    const dayRef = doc(db, `pos-orders/${window.currentEvent || 'pop-up'}`);
    const ordersRef = collection(dayRef, dateString);

    // Get all orders for that date and delete them
    getDocs(ordersRef).then(snapshot => {
      console.log(`Found ${snapshot.size} documents to delete from Firebase`);
      
      if (snapshot.empty) {
        console.log(`No orders found for ${dateString} in Firebase`);
        alert(`Successfully deleted local data for ${selectedDate.toLocaleDateString()}. No Firebase data found.`);
        return;
      }

      let deleteCount = 0;
      const totalDocs = snapshot.size;

      snapshot.forEach(document => {
        console.log(`Deleting document ID: ${document.id}`);
        deleteDoc(doc(db, `pos-orders/${window.currentEvent || 'pop-up'}`, dateString, document.id))
          .then(() => {
            console.log(`Deleted order ${document.id}`);
            deleteCount++;
            if (deleteCount === totalDocs) {
              alert(`Successfully deleted ${deleteCount} orders for ${selectedDate.toLocaleDateString()}`);
            }
          })
          .catch(error => console.error(`Error deleting order ${document.id}:`, error));
      });
    }).catch(error => {
      console.error(`Error getting orders for ${dateString}:`, error);
      alert(`Error deleting Firebase data: ${error.message}`);
    });

  } catch (error) {
    console.error(`Error in clearDateData:`, error);
    alert(`Error clearing data: ${error.message}`);
  }
}

// Add this function to help debug date-related issues
function debugDates() {
  const now = new Date();
  console.log("===== DATE DEBUG INFO =====");
  console.log(`Current time: ${now.toString()}`);
  console.log(`Local date string: ${getLocalDateString(now)}`);
  console.log(`ISO date: ${now.toISOString()}`);
  console.log(`ISO date split: ${now.toISOString().split('T')[0]}`);
  console.log(`Date string: ${now.toDateString()}`);

  const orders = JSON.parse(localStorage.getItem('orderHistory') || '[]');
  console.log(`Total orders in local storage: ${orders.length}`);

  // Count orders by date
  const ordersByDate = {};
  orders.forEach(order => {
    const dateStr = getLocalDateString(new Date(order.timestamp));
    ordersByDate[dateStr] = (ordersByDate[dateStr] || 0) + 1;
  });

  console.log("Orders by date:");
  Object.keys(ordersByDate).sort().forEach(date => {
    console.log(`${date}: ${ordersByDate[date]} orders`);
  });

  console.log("===========================");
}

// Call this from your browser console when needed
window.debugDates = debugDates;

// Add online/offline detection
window.addEventListener('online', () => {
  console.log('Connection restored, triggering sync...');
  setTimeout(() => {
    syncOrdersWithFirebase();
  }, 2000);
});

window.addEventListener('offline', () => {
  console.log('Connection lost - orders will be queued for sync');
});

function submitPackageOrder() {
  const now = new Date();

  // Determine if we're editing or creating a new order
  const isEditing = window.editingOrderData !== undefined;

  const order = {
    id: isEditing ? window.editingOrderData.originalId : generateOrderId(),
    items: [...currentOrder],
    total: currentOrder.reduce((total, item) => total + item.quantity, 0), // Total cups for package service
    paymentMethod: '', // No payment method for package orders
    timestamp: isEditing ? window.editingOrderData.timestamp : now.toISOString(),
    status: 'pending',
    customerName: customerName,
    event: currentEvent,
    serviceType: 'package',
    needsSync: true,
    lastModified: now.toISOString()
  };

  // Add Firebase ID if we're editing
  if (isEditing && window.editingOrderData.firebaseId) {
    order.firebaseId = window.editingOrderData.firebaseId;
  }

  // Save to order history
  orderHistory.push(order);
  localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

  // Sync immediately to Firebase
  syncOrderToFirebase(order).then(success => {
    if (success) {
      const orderIndex = orderHistory.findIndex(o => o.id === order.id);
      if (orderIndex > -1) {
        orderHistory[orderIndex].needsSync = false;
        localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
      }
    }
  });

  // Clear editing state if needed
  if (isEditing) {
    window.editingOrderData = undefined;
  }

  showPackageOrderConfirmation();
}

function showPackageOrderConfirmation() {
  // Create a simple success message without payment modal styling
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay order-confirmed-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal order-confirmed-modal';
  modal.style.cssText = `
    width: 300px;
    padding: 40px;
    text-align: center;
    border-radius: 8px;
  `;

  const successMessage = document.createElement('div');
  successMessage.innerHTML = 'ORDER<br>SUBMITTED!';
  successMessage.style.cssText = `
    font-family: "Poppins", sans-serif;
    font-size: 24px;
    color: #1d8a00;
    line-height: 1.2;
    letter-spacing: 1px;
  `;

  modal.appendChild(successMessage);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Auto-close after 2 seconds
  setTimeout(() => {
    overlay.remove();
    clearOrder();
  }, 2000);
}

window.debugEventData = async function () {
  console.log('=== DEBUG EVENT DATA ===');
  const events = await loadEventsFromFirebase();
  console.log('All events loaded:', events);

  const targetEvent = events.find(e => e.key === 'package-wedding-service--7-15-');
  console.log('Target event data:', targetEvent);

  if (targetEvent) {
    console.log('Service Type:', targetEvent.serviceType);
    console.log('All properties:', Object.keys(targetEvent));
  } else {
    console.log('Event not found!');
  }
};

let currentMenuData = null;

function setCurrentMenuData(menu) {
  currentMenuData = menu;
  window.__posMenu = menu;
}
let isGridView = false;

async function loadEventMenu(eventKey) {
  if (eventKey === 'pop-up') {
    // Use default menu for legacy pop-up
    setCurrentMenuData((await import('./menu-data.js')).menuData);
    refreshMenuDisplay();
    return;
  }

  try {
    // Load event data from Firebase to get custom menu.
    // Prefer the active (non-archived) doc when duplicate keys exist
    // (e.g. legacy archived "SM Southmall" sharing popup-sm-southmall).
    const events = await loadEventsFromFirebase();
    const event = events.find(e => e.key === eventKey && !e.archived)
      || events.find(e => e.key === eventKey);

    if (event && event.customMenu) {
      console.log('Loading custom menu for event:', eventKey, event.archived ? '(archived fallback)' : '(active)');
      setCurrentMenuData(event.customMenu);
    } else {
      console.log('No custom menu found, using default for event:', eventKey);
      setCurrentMenuData((await import('./menu-data.js')).menuData);
    }

    refreshMenuDisplay();
  } catch (error) {
    console.error('Error loading event menu:', error);
    // Fallback to default menu
    setCurrentMenuData((await import('./menu-data.js')).menuData);
    refreshMenuDisplay();
  }
}

function refreshMenuDisplay() {
  const menuContainer = document.getElementById('menuContent');
  menuContainer.innerHTML = ''; // Clear existing menu
  initializeMenu(menuContainer); // Rebuild menu with current data
  updateDisplayMode(); // Re-apply package mode price hiding after every rebuild

  // Recalculate grid columns after refresh if in grid view
  if (isGridView) {
    setTimeout(() => {
      const menuDataToUse = currentMenuData || menuData;
      calculateOptimalGridColumns(menuContainer, menuDataToUse.items.length);
    }, 100);
  }
}

// Function to toggle between list and grid view
function toggleView() {
  isGridView = !isGridView;
  const menuContainer = document.getElementById('menuContent');
  const toggleBtn = document.getElementById('viewToggleBtn');
  
      if (isGridView) {
      menuContainer.classList.add('grid-view');
      toggleBtn.classList.add('active');
      // Show list icon when in grid view (to switch back to list)
      toggleBtn.querySelector('.grid-icon').style.display = 'none';
      toggleBtn.querySelector('.list-icon').style.display = 'block';
    } else {
      menuContainer.classList.remove('grid-view');
      toggleBtn.classList.remove('active');
      // Show grid icon when in list view (to switch to grid)
      toggleBtn.querySelector('.grid-icon').style.display = 'block';
      toggleBtn.querySelector('.list-icon').style.display = 'none';
    }
  
  refreshMenuDisplay();
  
  // Recalculate grid columns after switching to grid view
  if (isGridView) {
    setTimeout(() => {
      const menuDataToUse = currentMenuData || menuData;
      calculateOptimalGridColumns(menuContainer, menuDataToUse.items.length);
    }, 100);
  }
}

// Calculate optimal number of grid columns based on available space and item count
function calculateOptimalGridColumns(container, itemCount) {
  if (!container || !isGridView) return;
  
  // Get container dimensions
  const containerRect = container.getBoundingClientRect();
  const containerWidth = containerRect.width - 16; // Account for padding (8px * 2)
  
  // Minimum and maximum tile widths
  const minTileWidth = 140; // Minimum width for readability
  const maxTileWidth = 250; // Maximum width before tiles get too large
  const gap = 8; // Gap between items
  
  // Calculate maximum possible columns based on minimum tile width
  const maxColumnsByMinWidth = Math.floor((containerWidth + gap) / (minTileWidth + gap));
  
  // Calculate optimal columns based on item count and available space
  // Try to balance: not too many columns (small tiles) and not too few (large tiles)
  let optimalColumns = maxColumnsByMinWidth;
  
  // If we have fewer items than max columns, use item count (but at least 2 columns)
  if (itemCount < maxColumnsByMinWidth) {
    optimalColumns = Math.max(2, itemCount);
  }
  
  // Check if tiles would be too large with this column count
  const tileWidth = (containerWidth - (optimalColumns - 1) * gap) / optimalColumns;
  if (tileWidth > maxTileWidth && optimalColumns < itemCount) {
    // Increase columns to reduce tile size
    optimalColumns = Math.min(itemCount, Math.ceil((containerWidth + gap) / (maxTileWidth + gap)));
  }
  
  // Ensure we have at least 2 columns and at most 8 columns for very large screens
  optimalColumns = Math.max(3, Math.min(8, optimalColumns));
  
  // Set CSS custom property
  container.style.setProperty('--grid-columns', optimalColumns);
  
  return optimalColumns;
}

// Update the initializeMenu function to use currentMenuData instead of importing menuData
function initializeMenu(container) {
  const menuDataToUse = currentMenuData || menuData;

  if (isGridView) {
    // In grid view, show all items in a single grid without categories
    menuDataToUse.items.forEach(item => {
      const menuItemElement = createMenuItemElement(item);
      container.appendChild(menuItemElement);
    });
    
    // Calculate and set optimal grid columns after items are added
    // Use setTimeout to ensure DOM is updated
    setTimeout(() => {
      const itemCount = menuDataToUse.items.length;
      calculateOptimalGridColumns(container, itemCount);
    }, 0);
  } else {
    // In list view, show items organized by categories
    menuDataToUse.categories.forEach(category => {
      const categoryElement = createCategoryElement(category);
      const categoryItems = menuDataToUse.items.filter(item => item.categoryId === category.id);

      categoryItems.forEach(item => {
        const menuItemElement = createMenuItemElement(item);
        categoryElement.appendChild(menuItemElement);
      });

      container.appendChild(categoryElement);
    });
  }
}