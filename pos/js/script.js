
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

    // Add customization text
    if (item.customizations) {
      const customText = document.createElement('div');
      customText.style.fontSize = '12px';
      customText.style.fontWeight = '300';
      customText.style.color = '#666';
      // Create individual elements for customizations
      const customSpan = document.createElement('span');
      customSpan.textContent = `${item.customizations.size} | ${item.customizations.serving} | `;

      // Create special span for sweetness percentage
      const sweetnessSpan = document.createElement('span');
      sweetnessSpan.style.fontFamily = 'Montserrat, sans-serif';
      sweetnessSpan.style.fontWeight = '700';
      sweetnessSpan.textContent = item.customizations.sweetness;

      const milkSpan = document.createElement('span');
      milkSpan.textContent = ` | ${item.customizations.milk}`;

      customText.appendChild(customSpan);
      customText.appendChild(sweetnessSpan);
      customText.appendChild(milkSpan);

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


function showCustomizationModal(item) {
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

  // Size options
  const sizeSection = createOptionSection('Size', ['regular', 'large'], 'large');
  optionsGrid.appendChild(sizeSection);

  // Serving options
  const servingSection = createOptionSection('Serving', ['iced', 'hot'], 'iced');
  optionsGrid.appendChild(servingSection);

  modal.appendChild(optionsGrid);

  // Sweetness options (full width)
  const sweetnessSection = createOptionSection('Sweetness', ['0%', '50%', '100%', '150%', '200%'], '100%');
  modal.appendChild(sweetnessSection);

  // Milk options (full width)
  const milkSection = createOptionSection('Milk', ['dairy', 'oat'], 'dairy');
  modal.appendChild(milkSection);

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
  quantityDisplay.textContent = '1';

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
  addBtn.textContent = 'ADD TO ORDER';
  addBtn.addEventListener('click', () => addCustomizedItemToOrder(item, overlay));

  footer.appendChild(cancelBtn);
  footer.appendChild(addBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
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
  const options = {
    size: document.querySelector('.option-button.active[data-group="size"]').dataset.option,
    serving: document.querySelector('.option-button.active[data-group="serving"]').dataset.option,
    sweetness: document.querySelector('.option-button.active[data-group="sweetness"]').dataset.option,
    milk: document.querySelector('.option-button.active[data-group="milk"]').dataset.option,
    quantity: parseInt(document.querySelector('.modal-quantity .quantity-display').textContent)
  };
  
  return options;
}

function addCustomizedItemToOrder(baseItem, overlay) {
  const options = getSelectedOptions();

  // Calculate additional price
  let additionalPrice = 0;
  additionalPrice += customizationOptions.size[options.size];
  additionalPrice += customizationOptions.milk[options.milk];

  // Check if this exact customization already exists in the order
  const existingItemIndex = currentOrder.findIndex(orderItem =>
    orderItem.name === baseItem.name &&
    orderItem.customizations &&
    orderItem.customizations.size === options.size &&
    orderItem.customizations.serving === options.serving &&
    orderItem.customizations.sweetness === options.sweetness &&
    orderItem.customizations.milk === options.milk
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
  updateOrderDisplay();
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
    overlay.remove();  // Close modal after charge
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
    overlay.remove();
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
    overlay.remove();
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
  alert('Cash payment successful!');
  clearOrder();
}

function completeDigitalPayment(method) {
  alert(`${method} payment successful!`);
  clearOrder();
}

// Update the DOMContentLoaded event listener to include payment handlers:
document.addEventListener('DOMContentLoaded', () => {
  initializeMenu(document.getElementById('menuContent')); // Use the existing function
  updateOrderDisplay();
  initializePaymentHandlers(); // Add this line
});