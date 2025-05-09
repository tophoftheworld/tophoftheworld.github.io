import { menuData } from './menu-data.js';
import { queueSync, initializeMenuItems, loadOrdersFromFirebase } from './firebase-sync.js';
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
  }
};

let customerName = '';

let selectedDate = new Date();
let currentDate = new Date();

window.syncOrdersWithFirebase = syncOrdersWithFirebase;

function initializeMenu(container) {
  // Create menu categories
  menuData.categories.forEach(category => {
    // Create category element
    const categoryElement = createCategoryElement(category);

    // Add menu items for this category
    const categoryItems = menuData.items.filter(item => item.categoryId === category.id);

    // Add each menu item to the category
    categoryItems.forEach(item => {
      const menuItemElement = createMenuItemElement(item);
      categoryElement.appendChild(menuItemElement);
    });

    // Add the complete category to the container
    container.appendChild(categoryElement);
  });
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
  const orderItemsContainer = document.querySelector('.order-items');

  // Clear current display
  orderItemsContainer.innerHTML = '';

  if (currentOrder.length === 0) {
    // Show empty message
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'empty-order-message';
    emptyMessage.textContent = 'Your order is empty';
    orderItemsContainer.appendChild(emptyMessage);

    // Update totals
    // document.querySelector('.order-subtotal .price').textContent = '₱ 0.00';
    document.querySelector('.order-total .price').textContent = '₱ 0.00';

    return;
  }

  // Calculate subtotal
  let subtotal = 0;

  // Create order item elements
  currentOrder.forEach((item, index) => {
    const itemTotal = item.price * item.quantity;
    subtotal += itemTotal;

    const orderItemElement = document.createElement('div');
    orderItemElement.className = 'order-item';

    const orderItemHeader = document.createElement('div');
    orderItemHeader.className = 'order-item-header';

    const orderItemName = document.createElement('div');
    orderItemName.className = 'order-item-name';
    orderItemName.textContent = item.name.replace(/<[^>]*>/g, ''); // Remove HTML tags

    orderItemName.style.cursor = 'pointer';
    orderItemName.addEventListener('click', () => editOrderItem(index));

    // Add customization text
    if (item.customizations) {
      const customText = document.createElement('div');
      customText.className = 'edit-custm-text';
      customText.style.fontSize = '12px';
      customText.style.fontWeight = '300';
      customText.style.color = '#666';
      customText.style.cursor = 'pointer';

      // Only add customizations that exist
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

      customText.innerHTML = customDisplay.join(' | ');

      // Add click handler for editing customization
      customText.addEventListener('click', (e) => {
        e.stopPropagation();
        editOrderItem(index);
      });

      orderItemName.appendChild(customText);
    }


    orderItemHeader.appendChild(orderItemName);

    const orderItemPrice = document.createElement('div');
    orderItemPrice.className = 'order-item-price';
    orderItemPrice.textContent = '₱ ' + itemTotal.toFixed(2);
    orderItemHeader.appendChild(orderItemPrice);

    orderItemElement.appendChild(orderItemHeader);

    const orderItemControls = document.createElement('div');
    orderItemControls.className = 'order-item-controls';

    // Quantity controls
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

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeFromOrder(index));
    orderItemControls.appendChild(removeBtn);

    orderItemElement.appendChild(orderItemControls);

    orderItemsContainer.appendChild(orderItemElement);
  });

  // Update totals
  const total = subtotal; // Add tax calculation here if needed
  // document.querySelector('.order-subtotal .price').textContent = '₱ ' + subtotal.toFixed(2);
  document.querySelector('.order-total .price').textContent = '₱ ' + total.toFixed(2);
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
  const selectedDateOrders = orderHistory.filter(order => {
    return getLocalDateString(new Date(order.timestamp)) === getLocalDateString(selectedDate);
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
    const completedOrders = selectedDateOrders.filter(order => order.status === 'completed').reverse();
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
      return getLocalDateString(new Date(order.timestamp)) === getLocalDateString(date) &&
        (order.status === 'pending' || order.status === 'completed');
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
  }

  return orderCard;
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
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

    // Add this part to sync with Firebase
    const orderDate = getLocalDateString(new Date(orderHistory[orderIndex].timestamp));
    queueSync('update', orderId, orderHistory[orderIndex], orderDate);

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

// Add new confirmed cancel function:
function cancelOrderConfirmed(orderId) {
  const orderIndex = orderHistory.findIndex(order => order.id === orderId);
  if (orderIndex > -1) {
    orderHistory.splice(orderIndex, 1);
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
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

// Add new confirmed void function:
function voidOrderConfirmed(orderId) {
  const orderIndex = orderHistory.findIndex(order => order.id === orderId);
  if (orderIndex > -1) {
    orderHistory[orderIndex].status = 'voided';
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

    // Pass order date to sync queue
    const orderDate = getLocalDateString(new Date(orderHistory[orderIndex].timestamp));
    queueSync('update', orderId, orderHistory[orderIndex], orderDate);

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
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

    // Pass order date to sync queue
    const orderDate = getLocalDateString(new Date(orderHistory[orderIndex].timestamp));
    queueSync('update', orderId, orderHistory[orderIndex], orderDate);

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


// Replace the existing showCustomizationModal function:
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

  if (!allowedCustomizations || allowedCustomizations.milk) {
    const milkSection = createOptionSection('Milk', ['dairy', 'oat'], currentCustomizations.milk || 'dairy');
    modal.appendChild(milkSection);
  }

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
  const quantityLabel = document.createElement('div');
  quantityLabel.className = 'modal-option-label';
  quantityLabel.textContent = 'Quantity';
  quantitySection.appendChild(quantityLabel);

  const quantityControl = document.createElement('div');
  quantityControl.className = 'modal-quantity';

  const minusBtn = document.createElement('button');
  minusBtn.className = 'quantity-btn';
  minusBtn.textContent = '-';
  minusBtn.addEventListener('click', () => updateModalQuantity(-1));

  const quantityDisplay = document.createElement('span');
  quantityDisplay.className = 'quantity-display';
  quantityDisplay.textContent = editMode ? item.quantity : '1';

  const plusBtn = document.createElement('button');
  plusBtn.className = 'quantity-btn';
  plusBtn.textContent = '+';
  plusBtn.addEventListener('click', () => updateModalQuantity(1));

  quantityControl.appendChild(minusBtn);
  quantityControl.appendChild(quantityDisplay);
  quantityControl.appendChild(plusBtn);
  quantitySection.appendChild(quantityControl);
  modal.appendChild(quantitySection);

  // Modal footer
  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'checkout-button modal-cancel';
  cancelBtn.textContent = 'CANCEL';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const addBtn = document.createElement('button');
  addBtn.className = 'checkout-button modal-add';
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
}

function editOrderItem(index) {
  const item = currentOrder[index];
  showCustomizationModal(item, true, index);
}

function updateCustomizedItemInOrder(baseItem, editIndex, overlay) {
  const options = getSelectedOptions();

  // Calculate additional price - only add if options exist
  let additionalPrice = 0;
  if (options.size && customizationOptions.size[options.size]) {
    additionalPrice += customizationOptions.size[options.size];
  }
  if (options.milk && customizationOptions.milk[options.milk]) {
    additionalPrice += customizationOptions.milk[options.milk];
  }

  // Update item with new customizations
  currentOrder[editIndex] = {
    ...baseItem,
    customizations: options,
    basePrice: baseItem.basePrice || baseItem.price,
    price: (baseItem.basePrice || baseItem.price) + additionalPrice,
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
}

function updateModalQuantity(change) {
  const quantityDisplay = document.querySelector('.modal-quantity .quantity-display');
  let currentQuantity = parseInt(quantityDisplay.textContent);
  currentQuantity += change;
  
  if (currentQuantity < 1) {
    currentQuantity = 1;
  }
  
  quantityDisplay.textContent = currentQuantity;
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

  const quantity = document.querySelector('.modal-quantity .quantity-display');
  if (quantity) options.quantity = parseInt(quantity.textContent);

  const variantButton = document.querySelector('.option-button.active[data-group="flavor"]');
  if (variantButton) options.variant = variantButton.dataset.option;

  return options;
}

function addCustomizedItemToOrder(baseItem, overlay) {
  const options = getSelectedOptions();

  // Calculate additional price - only add if options exist
  let additionalPrice = 0;
  if (options.size && customizationOptions.size[options.size]) {
    additionalPrice += customizationOptions.size[options.size];
  }
  if (options.milk && customizationOptions.milk[options.milk]) {
    additionalPrice += customizationOptions.milk[options.milk];
  }
  
  if (options.variant && baseItem.variants) {
    const selectedVariant = baseItem.variants.find(v => v.name === options.variant);
    if (selectedVariant && selectedVariant.price) {
      additionalPrice += selectedVariant.price;
    }
  }

  // Check if this exact customization already exists in the order
  const existingItemIndex = currentOrder.findIndex(orderItem =>
    orderItem.name === baseItem.name &&
    orderItem.customizations &&
    orderItem.customizations.size === options.size &&
    orderItem.customizations.serving === options.serving &&
    orderItem.customizations.sweetness === options.sweetness &&
    orderItem.customizations.milk === options.milk &&
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
      price: baseItem.price + additionalPrice,
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
  header.textContent = 'Cash Payment';
  modal.appendChild(header);

  const tenderGrid = document.createElement('div');
  tenderGrid.className = 'tender-grid';

  const total = calculateOrderTotal();
  const amounts = generateLogicalTenderAmounts(total);

  amounts.forEach(amount => {
    const button = document.createElement('button');
    button.className = 'tender-button-modal';
    button.dataset.amount = amount;
    button.innerHTML = '₱' + amount;

    // Disable buttons less than total
    if (amount < total) {
      button.disabled = true;
    }

    button.addEventListener('click', () => selectCashAmount(amount, modal));
    tenderGrid.appendChild(button);
  });
  modal.appendChild(tenderGrid);

  const totalDisplay = document.createElement('div');
  totalDisplay.className = 'payment-total';
  totalDisplay.textContent = 'Total: ₱' + total.toFixed(2);
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
    // overlay.remove();  // Close modal after charge
  });
  modal.appendChild(chargeButton);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
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

  // Create the order object with shared properties
  const order = {
    id: isEditing ? window.editingOrderData.originalId : now.getTime().toString().slice(-5),
    items: [...currentOrder],
    total: calculateOrderTotal(),
    paymentMethod: 'Cash',
    timestamp: isEditing ? window.editingOrderData.timestamp : now.toISOString(),
    status: 'pending',
    customerName: customerName
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

  const syncAction = isEditing ? 'update' : 'create';
  queueSync(syncAction, order.id, order, orderDate);

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

  // Create the order object with shared properties
  const order = {
    id: isEditing ? window.editingOrderData.originalId : now.getTime().toString().slice(-5),
    items: [...currentOrder],
    total: calculateOrderTotal(),
    paymentMethod: method,
    timestamp: isEditing ? window.editingOrderData.timestamp : now.toISOString(),
    status: 'pending',
    customerName: customerName
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

  const syncAction = isEditing ? 'update' : 'create';
  queueSync(syncAction, order.id, order, orderDate);

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
  initializeMenu(document.getElementById('menuContent'));
  updateOrderDisplay();
  initializePaymentHandlers();
  initializeDatePicker();

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
});

async function loadOrdersFromLocalStorage() {
  orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
}

async function syncOrdersWithFirebase() {
  try {
    console.log("Starting sync with Firebase...");

    // Only sync the currently selected date
    const syncDate = selectedDate;
    const dateStr = getLocalDateString(syncDate);

    console.log(`Syncing orders for ${dateStr}...`);

    // Only fetch orders for the selected date
    let firebaseOrders = [];
    try {
      const fbOrders = await loadOrdersFromFirebase(syncDate);
      if (fbOrders && fbOrders.length > 0) {
        console.log(`Found ${fbOrders.length} orders in Firebase for ${dateStr}.`);
        firebaseOrders = fbOrders;
      }
    } catch (error) {
      console.log(`No orders found in Firebase for ${dateStr}: ${error.message}`);
    }

    // Create a map of firebase orders by ID for efficient lookup
    const firebaseOrderMap = new Map();
    firebaseOrders.forEach(order => {
      firebaseOrderMap.set(order.id, order);
    });

    // Get local orders
    const localOrders = JSON.parse(localStorage.getItem('orderHistory') || '[]');

    // Filter local orders to only include those from the selected date
    const selectedDateLocalOrders = localOrders.filter(order => {
      const orderDate = new Date(order.timestamp);
      return orderDate.toDateString() === syncDate.toDateString();
    });

    console.log(`Found ${selectedDateLocalOrders.length} local orders for ${dateStr}`);

    // Process each local order for sync
    for (const localOrder of selectedDateLocalOrders) {
      const orderDate = new Date(localOrder.timestamp).toISOString().split('T')[0];
      const fbOrder = firebaseOrderMap.get(localOrder.id);

      // If order doesn't exist in Firebase yet, queue it for creation
      if (!fbOrder && !localOrder.syncedWithFirebase) {
        console.log(`Uploading local order ${localOrder.id} to Firebase...`);
        queueSync('create', localOrder.id, localOrder, orderDate);
        localOrder.syncedWithFirebase = true;
      }
      // If order exists in Firebase but has a different status, sync the change
      else if (fbOrder && localOrder.status !== fbOrder.status) {
        console.log(`Updating order ${localOrder.id} status in Firebase...`);
        queueSync('update', localOrder.id, localOrder, orderDate);
        localOrder.syncedWithFirebase = true;
        localOrder.firebaseId = fbOrder.id;
      }
    }

    // Save updated local orders with sync flags
    localStorage.setItem('orderHistory', JSON.stringify(localOrders));

    // Merge Firebase orders into local storage
    const mergedOrders = mergeOrders(localOrders, firebaseOrders);

    // Update local storage
    orderHistory = mergedOrders;
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

    console.log(`Successfully synced with Firebase. Total orders: ${orderHistory.length}`);

    // Update display if on orders page
    if (document.getElementById('orders-container').style.display !== 'none') {
      displayOrderHistory();
    }

  } catch (error) {
    console.error('Error syncing with Firebase:', error);
  }
}

function mergeOrders(localOrders, firebaseOrders) {
  // Create a map of local orders by ID
  const orderMap = new Map();
  localOrders.forEach(order => {
    // Preserve sync flag if it exists
    const syncedWithFirebase = order.syncedWithFirebase || false;
    orderMap.set(order.id, { ...order, syncedWithFirebase });
  });

  // Track which Firebase orders have been processed
  const processedFirebaseOrderIds = new Set();

  // Merge in Firebase orders
  firebaseOrders.forEach(fbOrder => {
    processedFirebaseOrderIds.add(fbOrder.id);
    const existingLocalOrder = orderMap.get(fbOrder.id);

    // If Firebase order doesn't exist locally, add it
    if (!existingLocalOrder) {
      fbOrder.firebaseId = fbOrder.firebaseId || fbOrder.id;
      fbOrder.syncedWithFirebase = true;
      orderMap.set(fbOrder.id, fbOrder);
    }
    // If both exist, determine which to keep
    else {
      // Update Firebase ID reference
      existingLocalOrder.firebaseId = fbOrder.firebaseId || fbOrder.id;
      existingLocalOrder.syncedWithFirebase = true; // Always mark as synced

      // Compare timestamps to determine which is newer
      const localTimestamp = new Date(existingLocalOrder.timestamp).getTime();
      const fbTimestamp = new Date(fbOrder.timestamp).getTime();

      // Status priority (higher number = higher priority)
      const statusPriority = {
        'voided': 3,
        'completed': 2,
        'pending': 1,
        'deleted': 0
      };

      // Use Firebase data if:
      // 1. Firebase data is newer, OR
      // 2. Firebase status has higher priority
      if (fbTimestamp > localTimestamp ||
        (statusPriority[fbOrder.status] || 0) > (statusPriority[existingLocalOrder.status] || 0)) {

        // Keep important local data
        const mergedOrder = {
          ...fbOrder,
          syncedWithFirebase: true,
          firebaseId: fbOrder.firebaseId || fbOrder.id
        };

        orderMap.set(fbOrder.id, mergedOrder);
      }
    }
  });

  // Convert map back to array and sort by timestamp (newest first)
  return Array.from(orderMap.values())
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
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

  // Extend the existing updateOrderDisplay function
  const originalUpdateOrderDisplay = updateOrderDisplay;
  window.updateOrderDisplay = function () {
    originalUpdateOrderDisplay();
    updateMobileOrderButton();
  };
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
    const dayRef = doc(db, 'pos-orders/pop-up');
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
        deleteDoc(doc(dayRef, dateString, document.id))
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