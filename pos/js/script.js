import { menuData } from './menu-data.js';
import { syncOrderToFirebase, syncAllPendingOrders, initializeMenuItems, loadEventsFromFirebase, saveEventToFirebase } from './firebase-sync.js';
import { db, collection, doc, getDocs, deleteDoc } from './firebase-setup.js';


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
    'pwd': -0.2      // 20% discount
  }
};

let customerName = '';

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
      availableEvents = ['pop-up', ...cachedEvents.filter(event => !event.archived).map(event => event.key)];
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
      availableEvents = ['pop-up', ...activeEvents.map(event => event.key)];
      localStorage.setItem('availableEvents', JSON.stringify(availableEvents));

      // Update UI with new data
      updateEventSelector();
    }

    // Load custom menu for current event
    await loadEventMenu(currentEvent);

    return availableEvents;
  } catch (error) {
    console.error('Error loading events:', error);
    return ['pop-up'];
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
  const currentValue = eventSelector.value;

  // Clear existing options
  eventSelector.innerHTML = '';

  // Add default pop-up option
  const defaultOption = document.createElement('option');
  defaultOption.value = 'pop-up';
  defaultOption.textContent = 'Legacy Data';
  eventSelector.appendChild(defaultOption);

  loadEventsFromFirebase().then(firebaseEvents => {
    // Filter out archived events for POS (only show active events)
    const activeEvents = firebaseEvents.filter(event => !event.archived);

    console.log('Active events loaded:', activeEvents);

    activeEvents.forEach(event => {
      console.log('Processing event in updateEventSelector:', event);
      const option = document.createElement('option');
      option.value = event.key;
      const serviceLabel = event.serviceType === 'package' ? 'Package' : 'Popup';
      option.textContent = `[${serviceLabel}] ${event.name}`;
      option.dataset.serviceType = event.serviceType || 'popup';
      eventSelector.appendChild(option);
    });

    // Restore selection if it's still valid (not archived)
    const isCurrentEventActive = activeEvents.some(event => event.key === currentEvent) || currentEvent === 'pop-up';

    if (isCurrentEventActive) {
      eventSelector.value = currentEvent;
    } else {
      // Current event was archived, default to Legacy Data
      eventSelector.value = 'pop-up';
      currentEvent = 'pop-up';
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

  // Update order total display
  updateOrderDisplay();
}

function getEventDisplayName(eventKey) {
  if (eventKey === 'pop-up') return 'Legacy Data';

  // Remove 'popup-' prefix and format nicely
  return eventKey.replace('popup-', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
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

function createMenuItemElement(item) {
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
  itemName.innerHTML = item.name;
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
    desc.textContent = item.description;
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

// In the part of your script.js that renders menu items, update or add this function

// Add this to your script.js file

// Order management
let currentOrder = [];
let orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');

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
      if (item.customizations.size) customDisplay.push(item.customizations.size);
      if (item.customizations.serving) customDisplay.push(item.customizations.serving);
      if (item.customizations.sweetness) {
        const sweetnessSpan = document.createElement('span');
        sweetnessSpan.style.fontFamily = 'Montserrat, sans-serif';
        sweetnessSpan.style.fontWeight = '700';
        sweetnessSpan.textContent = item.customizations.sweetness;
        customDisplay.push(sweetnessSpan.outerHTML);
      }
      if (item.customizations.milk) customDisplay.push(item.customizations.milk);

      if (item.customizations.discount && item.customizations.discount !== 'none') {
        const discountBadge = document.createElement('span');
        discountBadge.style.backgroundColor = '#1d8a00';
        discountBadge.style.color = 'white';
        discountBadge.style.fontSize = '10px';
        discountBadge.style.padding = '2px 5px';
        discountBadge.style.borderRadius = '4px';
        discountBadge.style.marginLeft = '5px';
        discountBadge.textContent = item.customizations.discount.toUpperCase();
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
}

// Toggle between menu and orders view
document.querySelector('.menu-header').addEventListener('click', () => {
  const menuContainer = document.getElementById('menu-container');
  const orderPanel = document.getElementById('order-panel');
  const ordersContainer = document.getElementById('orders-container');
  const menuHeader = document.querySelector('.menu-header');

  if (menuContainer.style.display === 'none') {
    // Switch to menu view
    menuContainer.style.display = 'flex';
    orderPanel.style.display = 'flex';
    ordersContainer.style.display = 'none';
    menuHeader.innerHTML = 'MATCHA BAR <span class="light">MENU</span>';
  } else {
    // Switch to orders view
    menuContainer.style.display = 'none';
    orderPanel.style.display = 'none';
    ordersContainer.style.display = 'flex';
    menuHeader.innerHTML = 'MATCHA BAR <span class="light">ORDERS</span>';
    displayOrderHistory();
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

  // Filter orders by selected date
  // Filter orders by selected date AND current event
  const selectedDateOrders = orderHistory.filter(order => {
    const orderEvent = order.event || 'pop-up'; // Default to 'pop-up' for existing orders
    return getLocalDateString(new Date(order.timestamp)) === getLocalDateString(selectedDate) &&
      orderEvent === currentEvent;
  });

  if (isToday) {
    // Sort by timestamp in descending order (newest first)
    const pendingOrders = selectedDateOrders
      .filter(order => order.status === 'pending')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const completedOrders = selectedDateOrders
      .filter(order => order.status === 'completed')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const voidedOrders = selectedDateOrders
      .filter(order => order.status === 'voided')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (selectedDateOrders.length === 0) {
      const emptyMessage = document.createElement('div');
      emptyMessage.className = 'empty-order-message';
      emptyMessage.textContent = 'No orders yet';
      emptyMessage.style.margin = '80px auto';
      orderGrid.appendChild(emptyMessage);
      return;
    }

    // Pending Orders Section
    if (pendingOrders.length > 0) {
      const pendingSection = document.createElement('div');
      pendingSection.className = 'orders-section';

      const pendingLabel = document.createElement('div');
      pendingLabel.className = 'orders-section-label';
      pendingLabel.textContent = 'PENDING ORDERS';
      pendingSection.appendChild(pendingLabel);

      const pendingCardsRow = document.createElement('div');
      pendingCardsRow.className = 'order-cards-row';

      pendingOrders.forEach(order => {
        const orderCard = createOrderCard(order, false);
        pendingCardsRow.appendChild(orderCard);
      });

      pendingSection.appendChild(pendingCardsRow);
      orderGrid.appendChild(pendingSection);
    }

    // Completed Orders Section
    if (completedOrders.length > 0) {
      const completedSection = document.createElement('div');
      completedSection.className = 'orders-section';

      const completedLabel = document.createElement('div');
      completedLabel.className = 'orders-section-label';
      completedLabel.textContent = 'COMPLETED ORDERS';
      completedSection.appendChild(completedLabel);

      const completedCardsRow = document.createElement('div');
      completedCardsRow.className = 'order-cards-row';

      completedOrders.forEach(order => {
        const orderCard = createOrderCard(order, true);
        completedCardsRow.appendChild(orderCard);
      });

      completedSection.appendChild(completedCardsRow);
      orderGrid.appendChild(completedSection);
    }

    // Voided Orders Section
    if (voidedOrders.length > 0) {
      const voidedSection = document.createElement('div');
      voidedSection.className = 'orders-section';

      const voidedLabel = document.createElement('div');
      voidedLabel.className = 'orders-section-label';
      voidedLabel.textContent = 'VOIDED ORDERS';
      voidedSection.appendChild(voidedLabel);

      const voidedCardsRow = document.createElement('div');
      voidedCardsRow.className = 'order-cards-row';

      voidedOrders.forEach(order => {
        const orderCard = createOrderCard(order, false, true); // Pass true for voided
        voidedCardsRow.appendChild(orderCard);
      });

      voidedSection.appendChild(voidedCardsRow);
      orderGrid.appendChild(voidedSection);
    }
  } else {
    const completedOrders = selectedDateOrders.filter(order => order.status === 'completed' || order.status === 'pending').reverse();
    const voidedOrders = selectedDateOrders.filter(order => order.status === 'voided').reverse();

    if (selectedDateOrders.length === 0) {
      const emptyMessage = document.createElement('div');
      emptyMessage.className = 'empty-order-message';
      emptyMessage.textContent = 'No orders for this date';
      emptyMessage.style.margin = '80px auto';
      orderGrid.appendChild(emptyMessage);
      return;
    }

    if (completedOrders.length > 0) {
      const completedSection = document.createElement('div');
      completedSection.className = 'orders-section';

      const completedLabel = document.createElement('div');
      completedLabel.className = 'orders-section-label';
      completedLabel.textContent = 'COMPLETED ORDERS';
      completedSection.appendChild(completedLabel);

      const completedCardsRow = document.createElement('div');
      completedCardsRow.className = 'order-cards-row';

      completedOrders.forEach(order => {
        const orderCard = createOrderCard(order, true);
        completedCardsRow.appendChild(orderCard);
      });

      completedSection.appendChild(completedCardsRow);
      orderGrid.appendChild(completedSection);
    }
    if (voidedOrders.length > 0) {
      const voidedSection = document.createElement('div');
      voidedSection.className = 'orders-section';

      const voidedLabel = document.createElement('div');
      voidedLabel.className = 'orders-section-label';
      voidedLabel.textContent = 'VOIDED ORDERS';
      voidedSection.appendChild(voidedLabel);

      const voidedCardsRow = document.createElement('div');
      voidedCardsRow.className = 'order-cards-row';

      voidedOrders.forEach(order => {
        const orderCard = createOrderCard(order, false, true); // Pass true for voided
        voidedCardsRow.appendChild(orderCard);
      });

      voidedSection.appendChild(voidedCardsRow);
      orderGrid.appendChild(voidedSection);
    }
  }


  updateTotalSalesDisplay();
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

function updateTotalSalesDisplay() {
  const totalSales = calculateTotalSales(selectedDate);
  const salesAmount = document.querySelector('.sales-amount');
  if (salesAmount) {
    salesAmount.textContent = `₱${totalSales.toFixed(2)}`;
  }
}

function createOrderCard(order, isCompleted, isVoided = false) {
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

  const orderDateTime = document.createElement('div');
  orderDateTime.className = 'order-datetime';
  const date = new Date(order.timestamp);
  orderDateTime.textContent = date.toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  orderHeader.appendChild(orderHeaderTop);
  orderHeader.appendChild(orderDateTime);
  orderCard.appendChild(orderHeader);

  const orderMetaBottom = document.createElement('div');
  orderMetaBottom.className = 'order-meta-bottom';

  const orderTotalRow = document.createElement('div');
  orderTotalRow.className = 'order-total-row';

  const orderTotal = document.createElement('div');
  orderTotal.className = 'order-card-total';
  orderTotal.textContent = `₱${order.total.toFixed(2)}`;

  const orderMethod = document.createElement('div');
  orderMethod.className = 'order-card-method';
  orderMethod.textContent = order.paymentMethod.toUpperCase();

  orderTotalRow.appendChild(orderMethod);
  orderTotalRow.appendChild(orderTotal);

  orderMetaBottom.appendChild(orderTotalRow);

  const orderItemsList = document.createElement('div');
  orderItemsList.className = 'order-items-list';

  order.items.forEach(item => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'order-card-item';

    const itemName = document.createElement('div');
    itemName.className = 'item-name';

    const quantitySpan = document.createElement('span');
    quantitySpan.style.fontFamily = 'Montserrat, sans-serif';
    quantitySpan.textContent = `${item.quantity}x `;

    const nameSpan = document.createElement('span');
    // Handle case where item.name might be undefined
    nameSpan.textContent = item.name
      ? item.name.replace(/<[^>]*>/g, '')
      : (item.menuItemId ? item.menuItemId.split('-').slice(1).join(' ') : 'Unknown Item');

    itemName.appendChild(quantitySpan);
    itemName.appendChild(nameSpan);
    itemDiv.appendChild(itemName);

    // Add customizations if available
    if (item.customizations) {
      const customizations = document.createElement('div');
      customizations.className = 'item-customizations';

      const customDisplay = [];

      if (item.customizations.variant) customDisplay.push(item.customizations.variant);
      if (item.customizations.size) customDisplay.push(item.customizations.size);
      if (item.customizations.serving) customDisplay.push(item.customizations.serving);
      if (item.customizations.sweetness) {
        const sweetnessSpan = document.createElement('span');
        sweetnessSpan.style.fontFamily = 'Montserrat, sans-serif';
        sweetnessSpan.style.fontWeight = '700';
        sweetnessSpan.textContent = item.customizations.sweetness;
        customDisplay.push(sweetnessSpan.outerHTML);
      }
      if (item.customizations.milk) customDisplay.push(item.customizations.milk);

      customizations.innerHTML = customDisplay.join(' | ');
      itemDiv.appendChild(customizations);
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
  const orderPanel = document.getElementById('order-panel');
  const ordersContainer = document.getElementById('orders-container');
  const menuHeader = document.querySelector('.menu-header');

  menuContainer.style.display = 'flex';
  orderPanel.style.display = 'flex';
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
  font-family: 'Montserrat', sans-serif;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
`;

  header.style.cssText = `
  border-bottom: 0px;
`;


  const messageText = document.createElement('p');
  messageText.style.cssText = `
    font-family: 'Montserrat', sans-serif;
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
  // Make modal wider
  modal.style.maxWidth = '400px';
  modal.style.width = '90%';

  // Modal header
  const header = document.createElement('h2');
  header.className = 'modal-header';
  header.innerHTML = item.name.replace(/<[^>]*>/g, ''); // Remove HTML tags
  modal.appendChild(header);

  // Create grid container for options
  const optionsGrid = document.createElement('div');
  optionsGrid.className = 'modal-options-grid';

  // Get current customizations if editing
  const currentCustomizations = editMode && item.customizations ? item.customizations : {};

  const allowedCustomizations = item.customizations || null;
  const showAll = !allowedCustomizations;

  if (!allowedCustomizations || allowedCustomizations.size) {
    const sizeSection = createOptionSection('Size', ['regular', 'large'], currentCustomizations.size || 'large');
    optionsGrid.appendChild(sizeSection);
  }

  if (!allowedCustomizations || allowedCustomizations.serving) {
    const servingSection = createOptionSection('Serving', ['iced', 'hot'], currentCustomizations.serving || 'iced');
    optionsGrid.appendChild(servingSection);
  }

  // Add the optionsGrid to modal before checking sweetness and milk
  if (optionsGrid.children.length > 0) {
    modal.appendChild(optionsGrid);
  }

  if (!allowedCustomizations || allowedCustomizations.sweetness) {
    const sweetnessSection = createOptionSection('Sweetness', ['0%', '50%', '100%', '150%', '200%'], currentCustomizations.sweetness || '100%');
    modal.appendChild(sweetnessSection);
  }

  // Create a row that will contain milk and discount side by side
  const milkDiscountRow = document.createElement('div');
  milkDiscountRow.style.display = 'flex';
  milkDiscountRow.style.justifyContent = 'space-between';
  milkDiscountRow.style.gap = '20px';
  milkDiscountRow.style.marginBottom = '30px';

  // Determine if milk options are available for this item
  const hasMilkOptions = !allowedCustomizations || allowedCustomizations.milk;

  if (hasMilkOptions) {
    // Create milk section
    const milkSection = document.createElement('div');
    milkSection.style.flex = '1';

    const milkLabel = document.createElement('div');
    milkLabel.className = 'modal-option-label';
    milkLabel.textContent = 'Milk';
    milkSection.appendChild(milkLabel);

    const milkButtons = document.createElement('div');
    milkButtons.className = 'modal-buttons';

    const dairyBtn = document.createElement('button');
    dairyBtn.className = 'option-button';
    dairyBtn.dataset.option = 'dairy';
    dairyBtn.dataset.group = 'milk';
    if (!currentCustomizations.milk || currentCustomizations.milk === 'dairy') {
      dairyBtn.classList.add('active');
    }
    dairyBtn.innerHTML = '<span class="option-text">dairy</span>';
    dairyBtn.addEventListener('click', () => selectOption(dairyBtn));

    const oatBtn = document.createElement('button');
    oatBtn.className = 'option-button';
    oatBtn.dataset.option = 'oat';
    oatBtn.dataset.group = 'milk';
    if (currentCustomizations.milk === 'oat') {
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
  discountSection.style.flex = '1';

  const discountLabel = document.createElement('div');
  discountLabel.className = 'modal-option-label';
  discountLabel.textContent = 'Discount';
  discountSection.appendChild(discountLabel);

  const discountButtons = document.createElement('div');
  discountButtons.className = 'modal-buttons';

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

  discountButtons.appendChild(seniorBtn);
  discountButtons.appendChild(pwdBtn);
  discountSection.appendChild(discountButtons);

  milkDiscountRow.appendChild(discountSection);

  // Add the combined row to the modal
  modal.appendChild(milkDiscountRow);

  if (item.variants && item.variants.length > 0) {
    const variantNames = item.variants.map(variant => variant.name);
    const defaultVariant = currentCustomizations.variant || variantNames[0];

    const variantSection = createOptionSection('Flavor', variantNames, defaultVariant);
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

  // Calculate initial price
  let basePrice = item.price;
  if (currentCustomizations.size && customizationOptions.size[currentCustomizations.size]) {
    basePrice += customizationOptions.size[currentCustomizations.size];
  }
  if (currentCustomizations.milk && customizationOptions.milk[currentCustomizations.milk]) {
    basePrice += customizationOptions.milk[currentCustomizations.milk];
  }
  if (currentCustomizations.discount && customizationOptions.discount[currentCustomizations.discount]) {
    basePrice = basePrice * (1 + customizationOptions.discount[currentCustomizations.discount]);
  }
  hiddenTotal.dataset.basePrice = basePrice;
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

  // Initialize the item total when the modal is first shown
  updateItemTotal();
}

// Updated function to handle discount toggling
function toggleDiscount(button) {
  // Get all discount toggle buttons
  const discountButtons = document.querySelectorAll('.discount-toggle');

  // If this button is already active, deactivate it
  if (button.classList.contains('active')) {
    button.classList.remove('active');
  } else {
    // Deactivate all buttons first
    discountButtons.forEach(btn => btn.classList.remove('active'));
    // Then activate the clicked button
    button.classList.add('active');
  }

  // Update item total to reflect discount change
  updateItemTotal();
}

function editOrderItem(index) {
  const item = currentOrder[index];
  showCustomizationModal(item, true, index);
}

function updateCustomizedItemInOrder(baseItem, editIndex, overlay) {
  const options = getSelectedOptions();

  // Calculate additional price and adjustments
  let additionalPrice = 0;
  let discountMultiplier = 1;

  // Size adjustment
  if (options.size && customizationOptions.size[options.size]) {
    additionalPrice += customizationOptions.size[options.size];
  }

  // Milk adjustment
  if (options.milk && customizationOptions.milk[options.milk]) {
    additionalPrice += customizationOptions.milk[options.milk];
  }

  // Apply discount if any
  if (options.discount && options.discount !== 'none' && customizationOptions.discount[options.discount]) {
    discountMultiplier = 1 + customizationOptions.discount[options.discount];
  }

  // Calculate final price
  const finalPrice = (baseItem.basePrice || baseItem.price + additionalPrice) * discountMultiplier;

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

  // Get base price from the menu item
  let basePrice = parseFloat(itemTotalDisplay.dataset.basePrice);

  // Apply size adjustment
  const sizeOption = document.querySelector('.option-button.active[data-group="size"]');
  if (sizeOption && customizationOptions.size[sizeOption.dataset.option]) {
    basePrice += customizationOptions.size[sizeOption.dataset.option];
  }

  // Apply milk adjustment
  const milkOption = document.querySelector('.option-button.active[data-group="milk"]');
  if (milkOption && customizationOptions.milk[milkOption.dataset.option]) {
    basePrice += customizationOptions.milk[milkOption.dataset.option];
  }

  // Apply discount if selected
  const discountOption = document.querySelector('.discount-toggle.active');
  if (discountOption && customizationOptions.discount[discountOption.dataset.discount]) {
    basePrice = basePrice * (1 + customizationOptions.discount[discountOption.dataset.discount]);
  }

  // Get quantity
  const quantityDisplay = document.querySelector('.modal-quantity .quantity-display');
  const quantity = quantityDisplay ? parseInt(quantityDisplay.textContent) : 1;

  // Calculate final price
  const finalPrice = basePrice * quantity;

  // Clear button and add properly formatted elements
  addButton.innerHTML = '';

  // Add button text with Cocogoose font
  const buttonTextSpan = document.createElement('span');
  buttonTextSpan.style.fontFamily = "'Cocogoose pro trial', sans-serif";
  buttonTextSpan.textContent = addButton.textContent.includes('UPDATE') ? 'UPDATE ORDER ' : 'ADD TO ORDER ';
  addButton.appendChild(buttonTextSpan);

  // Only show price for popup mode
  const serviceType = getCurrentEventServiceType();
  const isPackageMode = serviceType === 'package';

  if (!isPackageMode) {
    const priceSpan = document.createElement('span');
    priceSpan.style.fontFamily = 'Montserrat, sans-serif';
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

  // Get discount from toggle buttons
  const discountButton = document.querySelector('.discount-toggle.active');
  options.discount = discountButton ? discountButton.dataset.discount : 'none';

  const quantity = document.querySelector('.modal-quantity .quantity-display');
  if (quantity) options.quantity = parseInt(quantity.textContent);

  const variantButton = document.querySelector('.option-button.active[data-group="flavor"]');
  if (variantButton) options.variant = variantButton.dataset.option;

  return options;
}

function addCustomizedItemToOrder(baseItem, overlay) {
  const options = getSelectedOptions();

  // Calculate additional price and adjustments
  let additionalPrice = 0;
  let discountMultiplier = 1;

  // Add size adjustment
  if (options.size && customizationOptions.size[options.size]) {
    additionalPrice += customizationOptions.size[options.size];
  }

  // Add milk adjustment
  if (options.milk && customizationOptions.milk[options.milk]) {
    additionalPrice += customizationOptions.milk[options.milk];
  }

  // Apply variant price adjustment if any
  if (options.variant && baseItem.variants) {
    const selectedVariant = baseItem.variants.find(v => v.name === options.variant);
    if (selectedVariant && selectedVariant.price) {
      additionalPrice += selectedVariant.price;
    }
  }

  // Apply discount if any
  if (options.discount && options.discount !== 'none' && customizationOptions.discount[options.discount]) {
    discountMultiplier = 1 + customizationOptions.discount[options.discount];
  }

  // Calculate final price with all adjustments
  const finalPrice = (baseItem.price + additionalPrice) * discountMultiplier;

  // Check if this exact customization already exists in the order
  const existingItemIndex = currentOrder.findIndex(orderItem =>
    orderItem.name === baseItem.name &&
    orderItem.customizations &&
    orderItem.customizations.size === options.size &&
    orderItem.customizations.serving === options.serving &&
    orderItem.customizations.sweetness === options.sweetness &&
    orderItem.customizations.milk === options.milk &&
    orderItem.customizations.discount === options.discount &&
    orderItem.customizations.variant === options.variant
  );

  if (existingItemIndex > -1) {
    // Update existing item quantity
    currentOrder[existingItemIndex].quantity += options.quantity;
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
    showCashPaymentModal();
  });

  // GCash payment handler
  document.getElementById('gcash-payment').addEventListener('click', () => {
    if (currentOrder.length === 0) {
      alert('Please add items to your order first.');
      return;
    }
    showGCashPaymentModal();
  });

  // Maya payment handler
  document.getElementById('maya-payment').addEventListener('click', () => {
    if (currentOrder.length === 0) {
      alert('Please add items to your order first.');
      return;
    }
    showMayaPaymentModal();
  });
}

function calculateOrderTotal() {
  return currentOrder.reduce((total, item) => total + (item.price * item.quantity), 0);
}

function clearOrder() {
  currentOrder = [];
  customerName = '';  // Add this line
  updateOrderDisplay();
  updateOrderHeader();  // Add this line
}

document.addEventListener('DOMContentLoaded', function () {
  const endOfDayBtn = document.getElementById('endOfDayBtn');
  if (endOfDayBtn) {
    endOfDayBtn.addEventListener('click', showEndOfDayModal);
  }
});

function showEndOfDayModal() {
  // Get today's sales data
  const salesData = calculateSalesByPaymentMethod(selectedDate);

  // Get existing cash flow data for this specific date and event
  const dateStr = getLocalDateString(selectedDate);
  const cashFlowKey = `cashFlow_${currentEvent}_${dateStr}`;
  const existingCashData = JSON.parse(localStorage.getItem(cashFlowKey) || '{"startingCash": 0, "expenses": 0}');

  // Calculate expected cash
  const expectedCash = existingCashData.startingCash + salesData.cash - existingCashData.expenses;

  // Create modal HTML with minimal design
  const modalContent = `
    <h2 class="modal-header">End of Day Summary</h2>
    
    <div class="eod-simple-section">
      <h3 class="eod-simple-title">Sales Breakdown</h3>
      <div class="eod-summary-row">
        <div class="eod-label">Total Sales</div>
        <div class="eod-value">₱${formatWithCommas(salesData.total.toFixed(2))}</div>
      </div>
      
      <div class="eod-summary-row">
        <div class="eod-label">Cash Sales</div>
        <div class="eod-value">₱${formatWithCommas(salesData.cash.toFixed(2))}</div>
      </div>
      
      <div class="eod-summary-row">
        <div class="eod-label">GCash Sales</div>
        <div class="eod-value">₱${formatWithCommas(salesData.gcash.toFixed(2))}</div>
      </div>
      
      <div class="eod-summary-row">
        <div class="eod-label">Maya Sales</div>
        <div class="eod-value">₱${formatWithCommas(salesData.maya.toFixed(2))}</div>
      </div>
    </div>
    
    <div class="eod-simple-section">
      <h3 class="eod-simple-title">Cash Management</h3>
      <div class="eod-summary-row">
        <div class="eod-label">Starting Cash</div>
        <div class="eod-value">
          <div class="eod-input-wrapper">
            <span class="peso-symbol">₱</span>
            <input type="number" id="startingCash" class="eod-input" value="${existingCashData.startingCash}" step="0.01" placeholder="0.00">
          </div>
        </div>
      </div>
      
      <div class="eod-summary-row">
        <div class="eod-label">Expenses</div>
        <div class="eod-value">
          <div class="eod-input-wrapper">
            <span class="peso-symbol">₱</span>
            <input type="number" id="expenses" class="eod-input" value="${existingCashData.expenses}" step="0.01" placeholder="0.00">
          </div>
        </div>
      </div>
      
      <div class="eod-summary-row">
        <div class="eod-label">Expected Cash</div>
        <div class="eod-value" id="expectedCash">₱${formatWithCommas(expectedCash.toFixed(2))}</div>
      </div>

      <div class="eod-summary-row">
        <div class="eod-label">Actual Cash Count</div>
        <div class="eod-value">
          <div class="eod-input-wrapper">
            <span class="peso-symbol">₱</span>
            <input type="number" id="actualCash" class="eod-input" value="${existingCashData.actualCash || expectedCash}" step="0.01" placeholder="0.00">
          </div>
        </div>
      </div>
    </div>

    <div class="eod-summary-row">
      <div class="eod-label">Cash Variance</div>
      <div class="eod-value" id="cashVariance">₱0.00</div>
    </div>
  `;

  // Show the modal with save functionality
  showModal(modalContent, function () {
    saveCashFlowData();
  }, true);

  // Add event listeners with peso formatting
  const startingCashInput = document.getElementById('startingCash');
  const expensesInput = document.getElementById('expenses');
  const actualCashInput = document.getElementById('actualCash');

  function updateCalculations() {
    const startingCash = parseFloat(startingCashInput.value) || 0;
    const expenses = parseFloat(expensesInput.value) || 0;
    const actualCash = parseFloat(actualCashInput.value) || 0;

    const expectedCash = startingCash + salesData.cash - expenses;
    const variance = actualCash - expectedCash;

    document.getElementById('expectedCash').textContent = `₱${formatWithCommas(expectedCash.toFixed(2))}`;

    const varianceElement = document.getElementById('cashVariance');

    if (variance > 0) {
      varianceElement.style.color = '#1d8a00';
      varianceElement.textContent = `+₱${formatWithCommas(variance.toFixed(2))}`;
    } else if (variance < 0) {
      varianceElement.style.color = '#ff4444';
      varianceElement.textContent = `-₱${formatWithCommas(Math.abs(variance).toFixed(2))}`;
    } else {
      varianceElement.style.color = '#333';
      varianceElement.textContent = `₱${formatWithCommas(variance.toFixed(2))}`;
    }
  }

  startingCashInput.addEventListener('input', updateCalculations);
  expensesInput.addEventListener('input', updateCalculations);
  actualCashInput.addEventListener('input', updateCalculations);

  // Initial calculation
  updateCalculations();
}

function saveCashFlowData() {
  const dateStr = getLocalDateString(selectedDate);
  const cashFlowKey = `cashFlow_${currentEvent}_${dateStr}`;

  const startingCash = parseFloat(document.getElementById('startingCash').value) || 0;
  const expenses = parseFloat(document.getElementById('expenses').value) || 0;
  const actualCash = parseFloat(document.getElementById('actualCash').value) || 0;

  const salesData = calculateSalesByPaymentMethod(selectedDate);
  const expectedCash = startingCash + salesData.cash - expenses;
  const variance = actualCash - expectedCash;

  const cashFlowData = {
    date: dateStr,
    event: currentEvent,
    startingCash,
    expenses,
    actualCash,
    expectedCash,
    variance,
    salesData,
    savedAt: new Date().toISOString()
  };

  // Save to localStorage
  localStorage.setItem(cashFlowKey, JSON.stringify(cashFlowData));

  // Also save to a summary for dashboard access
  const summaryKey = 'eodSummaries';
  const existingSummaries = JSON.parse(localStorage.getItem(summaryKey) || '[]');

  // Remove existing entry for this date/event if exists
  const filteredSummaries = existingSummaries.filter(
    summary => !(summary.date === dateStr && summary.event === currentEvent)
  );

  // Add new entry
  filteredSummaries.push(cashFlowData);
  localStorage.setItem(summaryKey, JSON.stringify(filteredSummaries));

  alert('End of day summary saved successfully!');
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
  let mayaSales = 0;

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
      case 'maya':
        mayaSales += orderTotal;
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
    maya: mayaSales
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
  totalDisplay.textContent = 'Total: ₱' + formatWithCommas(total.toFixed(2));
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
  qrCode.src = 'images/qr.png';
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

function showMayaPaymentModal() {
  const existingModal = document.querySelector('.payment-modal-overlay');
  if (existingModal) {
    existingModal.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = 'payment-modal-overlay';

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  const modal = document.createElement('div');
  modal.className = 'payment-modal';

  const header = document.createElement('h2');
  header.className = 'payment-modal-header';
  header.textContent = 'Maya Payment';
  modal.appendChild(header);

  // QR Code image (changed from div to img)
  const qrCode = document.createElement('img');
  qrCode.className = 'qr-code';
  qrCode.src = 'images/qr.png';
  qrCode.alt = 'Maya QR Code';
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
    completeDigitalPayment('Maya');
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
    id: isEditing ? window.editingOrderData.originalId : now.getTime().toString().slice(-5),
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
    id: isEditing ? window.editingOrderData.originalId : now.getTime().toString().slice(-5),
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
        font-family: "Cocogoose pro trial", sans-serif;
        font-size: 20px;
        font-weight: 200px;
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

  initializeMenu(document.getElementById('menuContent'));
  updateOrderDisplay();
  initializePaymentHandlers();
  initializeDatePicker();
  updateEventDisplay();

  // Load events before initializing selector
  await initializeEventSelector();
  updateEventDisplay();

  // Initialize menu items in Firebase on first run
  await initializeMenuItems();

  // Make syncOrdersWithFirebase available globally
  window.syncOrdersWithFirebase = syncOrdersWithFirebase;

  // Load existing orders and sync with Firebase
  await syncOrdersWithFirebase();

  // Schedule periodic sync
  setInterval(syncOrdersWithFirebase, 60000);

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
    currentEvent = e.target.value;
    window.currentEvent = currentEvent;
    localStorage.setItem('currentEvent', currentEvent);

    // Load custom menu for the new event
    await loadEventMenu(currentEvent);

    // Update display mode for new service type
    updateDisplayMode();

    // Force update order display for payment buttons
    updateOrderDisplay();

    // Reload orders for the new event
    syncOrdersWithFirebase();
    displayOrderHistory();
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

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Enter name';
  input.value = customerName;
  input.maxLength = 30;
  
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
  cancelBtn.addEventListener('click', () => overlay.remove());

  const okBtn = document.createElement('button');
  okBtn.className = 'checkout-button modal-add';
  okBtn.innerHTML = '<img src="images/done-icon.png" class="btn-icon" alt="OK">OK';
  okBtn.addEventListener('click', () => updateCustomerName(input.value, overlay));

  footer.appendChild(cancelBtn);
  footer.appendChild(okBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  setTimeout(() => input.focus(), 100);
}

function updateCustomerName(name, overlay) {
  customerName = name.trim();
  updateOrderHeader();
  overlay.remove();
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

      // Sync the newly selected date with Firebase
      syncOrdersWithFirebase();
    },
    maxDate: "today",
    disableMobile: true
  });

  // Previous day button
  prevDayBtn.addEventListener('click', () => {
    selectedDate.setDate(selectedDate.getDate() - 1);
    updateDateDisplay();
    displayOrderHistory();

    // Sync the newly selected date with Firebase
    syncOrdersWithFirebase();
  });

  // Next day button
  nextDayBtn.addEventListener('click', () => {
    selectedDate.setDate(selectedDate.getDate() + 1);
    updateDateDisplay();
    displayOrderHistory();

    // Sync the newly selected date with Firebase
    syncOrdersWithFirebase();
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
    // Keep "TODAY" in Cocogoose
    dateDisplay.style.fontFamily = "'Cocogoose pro trial', sans-serif";
    dateDisplay.style.fontWeight = '300';
  } else {
    dateDisplay.textContent = selectedDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
    // Change to Montserrat for dates
    dateDisplay.style.fontFamily = "'Montserrat', sans-serif";
    dateDisplay.style.fontWeight = '600';
  }

  // Disable next button if today is selected
  nextDayBtn.disabled = isToday;

  updateTotalSalesDisplay();
}

// Add this to your script.js file
function initializeMobileLayout() {
  const mobileOrderButton = document.getElementById('mobileOrderButton');
  const mobileBackButton = document.getElementById('mobileBackButton');
  const orderPanel = document.getElementById('order-panel');
  const menuContainer = document.getElementById('menu-container');

  if (mobileOrderButton && mobileBackButton) {
    mobileOrderButton.addEventListener('click', () => {
      orderPanel.style.display = 'flex';
      mobileOrderButton.style.display = 'none';
    });

    mobileBackButton.addEventListener('click', () => {
      orderPanel.style.display = 'none';
      mobileOrderButton.style.display = 'flex';
    });
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
    id: isEditing ? window.editingOrderData.originalId : now.getTime().toString().slice(-5),
    items: [...currentOrder],
    total: currentOrder.reduce((total, item) => total + item.quantity, 0), // Total cups for package service
    paymentMethod: 'Package Service', // Fixed payment method for package orders
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
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = `
    width: 300px;
    padding: 40px;
    text-align: center;
    border-radius: 8px;
  `;

  const successMessage = document.createElement('div');
  successMessage.innerHTML = 'ORDER<br>SUBMITTED!';
  successMessage.style.cssText = `
    font-family: "Cocogoose pro trial", sans-serif;
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

async function loadEventMenu(eventKey) {
  if (eventKey === 'pop-up') {
    // Use default menu for legacy pop-up
    currentMenuData = (await import('./menu-data.js')).menuData;
    refreshMenuDisplay();
    return;
  }

  try {
    // Load event data from Firebase to get custom menu
    const events = await loadEventsFromFirebase();
    const event = events.find(e => e.key === eventKey);

    if (event && event.customMenu) {
      console.log('Loading custom menu for event:', eventKey);
      currentMenuData = event.customMenu;
    } else {
      console.log('No custom menu found, using default for event:', eventKey);
      currentMenuData = (await import('./menu-data.js')).menuData;
    }

    refreshMenuDisplay();
  } catch (error) {
    console.error('Error loading event menu:', error);
    // Fallback to default menu
    currentMenuData = (await import('./menu-data.js')).menuData;
    refreshMenuDisplay();
  }
}

function refreshMenuDisplay() {
  const menuContainer = document.getElementById('menuContent');
  menuContainer.innerHTML = ''; // Clear existing menu
  initializeMenu(menuContainer); // Rebuild menu with current data
}

// Update the initializeMenu function to use currentMenuData instead of importing menuData
function initializeMenu(container) {
  const menuDataToUse = currentMenuData || menuData;

  // Create menu categories
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