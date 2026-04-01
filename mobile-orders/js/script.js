import { db, initializeFirebase } from './firebase-config.js';
import { 
    collection, 
    doc, 
    setDoc, 
    getDocs, 
    updateDoc, 
    deleteDoc, 
    query, 
    orderBy,
    addDoc,
    serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

// Global variables
let currentOrders = [];
let currentGroupId = null;
let orderGroups = [];
let expandedCards = new Set(); // Track which cards are expanded
let showingArchivedGroups = false;

// DOM elements
const ordersEl = document.getElementById('ordersList');
const orderGroupsEl = document.getElementById('orderGroups');
const shipmentFilterEl = document.getElementById('shipmentFilter');
const quantityFilterEl = document.getElementById('quantityFilter');
const sortEl = document.getElementById('sort');
const toastEl = document.getElementById('toast');
const importModalEl = document.getElementById('importModalOverlay');
const importFormEl = document.getElementById('importForm');
const archivedToggleBtnEl = document.getElementById('archivedToggleBtn');

// Initialize the app
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initializeFirebase();
        await initializeApp();
        setupEventListeners();
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showToast('Failed to initialize app');
    }
});

async function initializeApp() {
    try {
        await loadOrderGroups();
        showOrderGroups();
    } catch (error) {
        console.error('Error initializing app:', error);
        showToast('Error loading data');
    }
}

function setupEventListeners() {
    // Filter and sort
    shipmentFilterEl.addEventListener('change', renderOrders);
    quantityFilterEl.addEventListener('change', renderOrders);
    sortEl.addEventListener('change', renderOrders);
    
    // Import modal
    importFormEl.addEventListener('submit', handleImportFormSubmission);
    
    // Modal close
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('import-modal-overlay')) {
            closeImportModal();
        }
    });
}

// Firebase Functions
async function loadOrderGroups() {
    try {
        const groupsSnapshot = await getDocs(collection(db, 'orderGroups'));
        orderGroups = [];
        groupsSnapshot.forEach(doc => {
            orderGroups.push({
                id: doc.id,
                ...doc.data()
            });
        });
        orderGroups.sort((a, b) => b.createdAt?.toDate() - a.createdAt?.toDate());
    } catch (error) {
        console.error('Error loading order groups:', error);
        throw error;
    }
}

async function loadOrders(groupId) {
    try {
        const ordersSnapshot = await getDocs(collection(db, `orderGroups/${groupId}/orders`));
        currentOrders = [];
        ordersSnapshot.forEach(doc => {
            currentOrders.push({
                id: doc.id,
                ...doc.data()
            });
        });
        currentGroupId = groupId;
    } catch (error) {
        console.error('Error loading orders:', error);
        throw error;
    }
}

async function saveOrderGroup(groupData) {
    try {
        const docRef = await addDoc(collection(db, 'orderGroups'), {
            ...groupData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return docRef.id;
    } catch (error) {
        console.error('Error saving order group:', error);
        throw error;
    }
}

async function saveOrders(groupId, orders) {
    try {
        const batch = [];
        for (const order of orders) {
            const orderRef = doc(collection(db, `orderGroups/${groupId}/orders`));
            batch.push(setDoc(orderRef, {
                ...order,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }));
        }
        await Promise.all(batch);
    } catch (error) {
        console.error('Error saving orders:', error);
        throw error;
    }
}

async function updateOrderStatus(groupId, orderId, status) {
    try {
        const orderRef = doc(db, `orderGroups/${groupId}/orders`, orderId);
        await updateDoc(orderRef, {
            status: status,
            updatedAt: serverTimestamp()
        });
        
        // Update local data
        const orderIndex = currentOrders.findIndex(o => o.id === orderId);
        if (orderIndex !== -1) {
            currentOrders[orderIndex].status = status;
        }
    } catch (error) {
        console.error('Error updating order status:', error);
        throw error;
    }
}

async function deleteOrderGroup(groupId) {
    try {
        // Delete all orders in the group
        const ordersSnapshot = await getDocs(collection(db, `orderGroups/${groupId}/orders`));
        const deletePromises = ordersSnapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        
        // Delete the group
        await deleteDoc(doc(db, 'orderGroups', groupId));
        
        // Reload groups
        await loadOrderGroups();
        showOrderGroups();
    } catch (error) {
        console.error('Error deleting order group:', error);
        throw error;
    }
}

async function archiveOrderGroup(groupId, event) {
    if (event) {
        event.stopPropagation(); // Prevent card click navigation
    }

    try {
        await updateDoc(doc(db, 'orderGroups', groupId), {
            archived: true,
            updatedAt: serverTimestamp()
        });

        // Update local list and re-render groups (archived ones are hidden)
        const idx = orderGroups.findIndex((g) => g.id === groupId);
        if (idx !== -1) {
            orderGroups[idx].archived = true;
        }
        showOrderGroups();
        showToast('Order batch archived');
    } catch (error) {
        console.error('Error archiving order group:', error);
        showToast('Error archiving order batch');
    }
}

async function unarchiveOrderGroup(groupId, event) {
    if (event) {
        event.stopPropagation(); // Prevent card click navigation
    }

    try {
        await updateDoc(doc(db, 'orderGroups', groupId), {
            archived: false,
            updatedAt: serverTimestamp()
        });

        const idx = orderGroups.findIndex((g) => g.id === groupId);
        if (idx !== -1) {
            orderGroups[idx].archived = false;
        }
        showOrderGroups();
        showToast('Order batch unarchived');
    } catch (error) {
        console.error('Error unarchiving order group:', error);
        showToast('Error unarchiving order batch');
    }
}

function toggleArchivedView(event) {
    if (event) event.stopPropagation();
    showingArchivedGroups = !showingArchivedGroups;
    updateArchivedToggleButton();
    showOrderGroups();
}

function updateArchivedToggleButton() {
    if (!archivedToggleBtnEl) return;
    archivedToggleBtnEl.textContent = showingArchivedGroups ? 'View Active' : 'View Archived';
}

// UI Functions
function showOrderGroups() {
    orderGroupsEl.style.display = 'block';
    ordersEl.style.display = 'none';
    document.getElementById('backBtn').style.display = 'none';
    if (archivedToggleBtnEl) archivedToggleBtnEl.style.display = '';
    updateArchivedToggleButton();
    
    const visibleGroups = showingArchivedGroups
        ? orderGroups.filter((g) => !!g.archived)
        : orderGroups.filter((g) => !g.archived);

    if (visibleGroups.length === 0) {
        orderGroupsEl.innerHTML = `
            <div class="empty-state">
                <p>${showingArchivedGroups ? 'No archived order batches found' : 'No active order batches found'}</p>
                <p>${showingArchivedGroups ? 'Archive batches to see them here' : 'Import your first CSV file to get started'}</p>
            </div>
        `;
        return;
    }
    
    orderGroupsEl.innerHTML = visibleGroups.map(group => `
        <div class="group-card" onclick="openOrderGroup('${group.id}')">
            <div class="group-header">
                <div class="group-left">
                    <div class="group-name">${group.name}</div>
                    <div class="group-description">${group.description || 'No description'}</div>
                </div>
                <div class="group-right">
                    <div class="group-stats">${group.orderCount || 0} orders</div>
                    ${showingArchivedGroups
                        ? `<button
                            type="button"
                            class="archive-group-btn unarchive-group-btn"
                            onclick="unarchiveOrderGroup('${group.id}', event)"
                        >
                            Unarchive
                        </button>`
                        : `<button
                            type="button"
                            class="archive-group-btn"
                            onclick="archiveOrderGroup('${group.id}', event)"
                        >
                            Archive
                        </button>`}
                </div>
            </div>
            <div class="group-footer">
                <div class="group-date">${formatDate(group.createdAt?.toDate())}</div>
                <div class="group-count">Click to view</div>
            </div>
        </div>
    `).join('');
}

async function openOrderGroup(groupId) {
    try {
        expandedCards.clear(); // Clear expanded state when switching groups
        await loadOrders(groupId);
        showOrders();
        renderOrders();
    } catch (error) {
        console.error('Error opening order group:', error);
        showToast('Error loading orders');
    }
}

function showOrders() {
    orderGroupsEl.style.display = 'none';
    ordersEl.style.display = 'block';
    document.getElementById('backBtn').style.display = 'flex';
    if (archivedToggleBtnEl) archivedToggleBtnEl.style.display = 'none';
}

function renderOrders() {
    if (!currentOrders.length) {
        ordersEl.innerHTML = `
            <div class="empty-state">
                <p>No orders found</p>
                <p>Import a CSV file to get started</p>
            </div>
        `;
        return;
    }

    const shipmentFilter = shipmentFilterEl.value;
    const quantityFilter = quantityFilterEl.value;
    const sort = sortEl.value;

    let filteredOrders = currentOrders.filter(order => {
        // Apply shipment filter
        if (shipmentFilter === 'pickup') {
            if (!isPickup(order)) return false;
        } else if (shipmentFilter === 'metro') {
            if (isPickup(order) || !metroManila(order)) return false;
        } else if (shipmentFilter === 'nationwide') {
            if (isPickup(order) || metroManila(order)) return false;
        }
        
        // Apply quantity filter
        if (quantityFilter === '1x') {
            if (getOrderQuantity(order) !== 1) return false;
        } else if (quantityFilter === '2x') {
            if (getOrderQuantity(order) !== 2) return false;
        } else if (quantityFilter === '3x') {
            if (getOrderQuantity(order) !== 3) return false;
        }
        
        return true;
    });

    // Sorting
    if (sort === 'order') {
        filteredOrders.sort((a, b) => (a.orderNumber || '').localeCompare(b.orderNumber || '', undefined, { numeric: true }));
    } else if (sort === 'name') {
        filteredOrders.sort((a, b) => (a.customerName || '').localeCompare(b.customerName || ''));
    } else if (sort === 'location') {
        filteredOrders.sort((a, b) => computeLocation(a).toLowerCase().localeCompare(computeLocation(b).toLowerCase()));
    } else if (sort === 'status') {
        filteredOrders.sort((a, b) => (a.status || 'unfulfilled').localeCompare(b.status || 'unfulfilled'));
    } else if (sort === 'quantity') {
        filteredOrders.sort((a, b) => getOrderQuantity(a) - getOrderQuantity(b));
    }

    // Calculate total items for filtered orders
    const totalItems = filteredOrders.reduce((sum, order) => sum + getOrderQuantity(order), 0);
    const totalOrders = filteredOrders.length;

    // Add summary header if there are filtered results
    let summaryHTML = '';
    if (filteredOrders.length > 0) {
        summaryHTML = `
            <div class="orders-summary">
                <div class="summary-stats">
                    <span class="summary-item">${totalOrders} order${totalOrders !== 1 ? 's' : ''}</span>
                    <span class="summary-item">${totalItems} total item${totalItems !== 1 ? 's' : ''}</span>
                </div>
            </div>
        `;
    }

    ordersEl.innerHTML = summaryHTML + filteredOrders.map(order => createOrderCard(order)).join('');
}

function createOrderCard(order) {
    const status = order.status || 'unfulfilled';
    const method = order.shippingMethod || (isPickup(order) ? 'Pickup' : 'Shipping');
    const location = computeLocation(order);
    const orderNumber = order.orderNumber || '';
    const items = getOrderItems(order);
    const totalQuantity = getOrderQuantity(order);
    const firstItem = items[0] || { name: '' };
    const extraItemCount = Math.max(0, items.length - 1);
    const total = parseFloat(order.total || '0');
    const notes = order.notes || '';

    return `
        <div class="order-card" onclick="toggleOrderDetails(this)" data-order-id="${order.id}">
            <div class="order-summary">
                <div class="order-left">
                    <div class="order-number">${orderNumber}</div>
                    <div class="customer-name">${order.customerName || 'No Name'}</div>
                    <div class="order-items">
                        <span style="font-weight: 600; color: #439407;">${totalQuantity}</span> × ${firstItem.name || 'Item'}
                        ${extraItemCount > 0 ? `<span class="items-more">+${extraItemCount} more</span>` : ''}
                    </div>
                </div>
                <div class="order-right">
                    <div class="status-chip ${getStatusClass(status)}">${getStatusDisplayText(status)}</div>
                    <div class="order-total">₱${isNaN(total) ? '—' : total.toFixed(2)}</div>
                </div>
            </div>
            <div class="order-footer">
                <div class="order-method">${method}</div>
                <div class="order-location">${location}</div>
            </div>
            
            <div class="order-details ${expandedCards.has(order.id) ? 'show' : ''}">
                <div class="detail-field">
                    <span class="detail-label">Name</span>
                    <span class="detail-value">
                        ${order.customerName || '—'}
                        <span class="copy-btn" onclick="copyText('${(order.customerName || '').replace(/'/g, "\\'")}', event)">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </span>
                    </span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Phone</span>
                    <span class="detail-value">
                        ${order.customerPhone || '—'}
                        <span class="copy-btn" onclick="copyText('${(order.customerPhone || '').replace(/'/g, "\\'")}', event)">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </span>
                    </span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Address</span>
                    <span class="detail-value">
                        ${formatAddress(order) || '—'}
                        <span class="copy-btn" onclick="copyText('${formatAddress(order).replace(/'/g, "\\'")}', event)">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </span>
                    </span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Email</span>
                    <span class="detail-value">${order.customerEmail || '—'}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Order Items</span>
                    <span class="detail-value">
                        ${items.length > 0
                            ? `<div class="order-items-inline">
                                ${items
                                    .map(
                                        (i) => `
                                            <div class="order-item-line">
                                                <span class="order-item-qty">${i.quantity}</span>
                                                <span class="order-item-dot">×</span>
                                                <span class="order-item-name">${i.name}</span>
                                            </div>
                                        `
                                    )
                                    .join('')}
                               </div>`
                            : '—'}
                    </span>
                </div>

                <div class="detail-field">
                    <span class="detail-label">Notes</span>
                    <span class="detail-value">
                        <div class="notes-inline">
                            <textarea
                                class="order-notes-textarea"
                                id="order-notes-${order.id}"
                                rows="3"
                                onclick="event.stopPropagation()"
                                onmousedown="event.stopPropagation()"
                            >${(notes ?? '').toString()}</textarea>
                            <button
                                type="button"
                                class="notes-save-btn"
                                onclick="saveOrderNotes('${order.id}', event)"
                            >
                                Save Notes
                            </button>
                        </div>
                    </span>
                </div>
                <div class="delete-section">
                    <button
                        type="button"
                        class="delete-order-btn"
                        onclick="deleteOrder('${order.id}', event)"
                    >
                        Delete Order
                    </button>
                </div>
                <div class="action-buttons">
                    ${getActionButtons(order)}
                </div>
            </div>
        </div>
    `;
}

function getOrderItems(order) {
    if (Array.isArray(order.items) && order.items.length > 0) {
        return order.items
            .map((i) => ({
                name: (i?.name ?? '').toString().trim(),
                quantity: parseInt((i?.quantity ?? '0').toString().trim(), 10) || 0
            }))
            .filter((i) => i.name && i.quantity > 0);
    }

    // Legacy shape: itemName + quantity
    const itemName = (order.itemName ?? '').toString().trim();
    if (!itemName) return [];
    const qty = parseInt((order.quantity ?? '1').toString().trim(), 10) || 1;
    return [{ name: itemName, quantity: qty }];
}

function getActionButtons(order) {
    const orderId = order.id;
    const currentStatus = order.status || 'unfulfilled';
    const isPickupOrder = isPickup(order);
    
    let buttons = '';
    
    // Packed status button (for all orders)
    if (currentStatus === 'packed') {
        buttons += `<button class="action-btn pack" onclick="updateStatus('${orderId}', 'unfulfilled', event)">Mark Unpacked</button>`;
    } else {
        buttons += `<button class="action-btn pack" onclick="updateStatus('${orderId}', 'packed', event)">Mark Packed</button>`;
    }
    
    // Ship/Pickup status button
    if (isPickupOrder) {
        if (currentStatus === 'ready for pickup') {
            buttons += `<button class="action-btn pickup" onclick="updateStatus('${orderId}', 'unfulfilled', event)">Mark Unfulfilled</button>`;
        } else {
            buttons += `<button class="action-btn pickup" onclick="updateStatus('${orderId}', 'ready for pickup', event)">Ready for Pickup</button>`;
        }
    } else {
        if (currentStatus === 'shipped') {
            buttons += `<button class="action-btn ship" onclick="updateStatus('${orderId}', 'unfulfilled', event)">Mark Unshipped</button>`;
        } else {
            buttons += `<button class="action-btn ship" onclick="updateStatus('${orderId}', 'shipped', event)">Mark Shipped</button>`;
        }
    }
    
    return buttons;
}

// Utility Functions
function isPickup(order) {
    const method = (order.shippingMethod || '').toLowerCase();
    const hasShipName = !!order.shippingName;
    return method.includes('pickup') || !hasShipName;
}

function metroManila(order) {
    const prov = (order.shippingProvince || '').toLowerCase();
    return prov.includes('metro manila');
}

function getOrderQuantity(order) {
    if (Array.isArray(order.items) && order.items.length > 0) {
        return order.items.reduce((sum, item) => {
            const q = parseInt((item.quantity ?? '0').toString().trim(), 10);
            return sum + (Number.isNaN(q) ? 0 : q);
        }, 0) || 1;
    }

    const quantity = order.quantity || '1';
    return parseInt(quantity, 10) || 1;
}

function computeLocation(order) {
    if (isPickup(order)) {
        return order.pickupLocation || 'Pickup Location';
    }
    if (metroManila(order)) {
        return order.shippingCity || order.billingCity || '';
    }
    return order.shippingProvince || '';
}

function getStatusClass(status) {
    const s = (status || 'unfulfilled').toLowerCase();
    if (s === 'shipped') return 'shipped';
    if (s === 'ready for pickup') return 'ready';
    if (s === 'packed') return 'packed';
    return '';
}

function getStatusDisplayText(status) {
    const s = (status || 'unfulfilled').toLowerCase();
    if (s === 'shipped') return 'Shipped';
    if (s === 'ready for pickup') return 'Ready for Pickup';
    if (s === 'packed') return 'Packed';
    return 'Unfulfilled';
}

function formatAddress(order) {
    const parts = [
        order.billingStreet,
        order.billingCity,
        order.billingProvince
    ].filter(Boolean);
    return parts.join(', ');
}

function formatDate(date) {
    if (!date) return 'Unknown date';
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Event Handlers
function showImportModal() {
    importModalEl.classList.add('show');
}

function closeImportModal() {
    importModalEl.classList.remove('show');
    importFormEl.reset();
}

async function handleImportFormSubmission(e) {
    e.preventDefault();
    
    const groupName = document.getElementById('groupName').value;
    const groupDescription = document.getElementById('groupDescription').value;
    const file = document.getElementById('csvFileInput').files[0];
    
    if (!file) {
        showToast('Please select a CSV file');
        return;
    }
    
    try {
        showToast('Importing orders...');
        console.log('Starting import process...');
        
        // Parse CSV
        const csvText = await file.text();
        console.log('CSV text length:', csvText.length);
        
        const orders = await parseCSV(csvText);
        console.log('Parsed orders:', orders.length);
        
        if (orders.length === 0) {
            showToast('No valid orders found in CSV');
            return;
        }
        
        // Save to Firebase
        console.log('Saving order group...');
        const groupId = await saveOrderGroup({
            name: groupName,
            description: groupDescription,
            orderCount: orders.length
        });
        console.log('Group saved with ID:', groupId);
        
        console.log('Saving orders...');
        await saveOrders(groupId, orders);
        console.log('Orders saved successfully');
        
        // Reload and show groups
        await loadOrderGroups();
        showOrderGroups();
        closeImportModal();
        
        showToast(`Successfully imported ${orders.length} orders`);
    } catch (error) {
        console.error('Error importing orders:', error);
        showToast(`Error importing orders: ${error.message}`);
    }
}

function parseCSV(csvText) {
    return new Promise((resolve) => {
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: 'greedy',
            complete: ({ data: rows }) => {
                const orderMap = new Map();

                const getOrderNumber = (row) => (row.Name ?? row['Order Number'] ?? '').toString().trim();
                const getRowId = (row) => (row['Id'] ?? row['ID'] ?? '').toString().trim();

                const getQuantity = (raw) => {
                    const n = parseInt((raw ?? '').toString().trim(), 10);
                    return Number.isNaN(n) ? 1 : n;
                };

                const fillIfEmpty = (target, key, value) => {
                    const v = (value ?? '').toString().trim();
                    if (!target[key] && v) target[key] = v;
                };

                for (const row of rows) {
                    if (!row) continue;

                    // Shopify exports typically repeat Name/Order Number on each line item row,
                    // while other fields may be blank on subsequent rows.
                    const orderNumber = getOrderNumber(row);
                    const rowId = getRowId(row);
                    const orderKey = orderNumber || rowId;
                    if (!orderKey) continue;

                    if (!orderMap.has(orderKey)) {
                        orderMap.set(orderKey, {
                            orderNumber: orderNumber || orderKey,
                            customerName: row['Billing Name'] || '',
                            customerPhone: row['Billing Phone'] || '',
                            customerEmail: row['Email'] || '',
                            billingStreet: row['Billing Street'] || '',
                            billingCity: row['Billing City'] || '',
                            billingProvince: row['Billing Province'] || '',
                            shippingName: row['Shipping Name'] || '',
                            shippingStreet: row['Shipping Street'] || '',
                            shippingCity: row['Shipping City'] || '',
                            shippingProvince: row['Shipping Province Name'] || row['Shipping Province'] || '',
                            shippingMethod: row['Shipping Method'] || '',
                            pickupLocation: row['Pickup Location'] || '',
                            // Multi-item support: items[] aggregated by Lineitem name
                            items: [],
                            // Backward compatibility for existing UI:
                            itemName: '',
                            quantity: '1',
                            total: row['Total'] || '0',
                            notes: row['Notes'] || row['Note'] || '',
                            status: 'unfulfilled'
                        });
                    }

                    const order = orderMap.get(orderKey);

                    // Fill order-level fields from any later line item row that has them.
                    // This is important because in Shopify exports, only the first row may carry full details.
                    fillIfEmpty(order, 'customerName', row['Billing Name']);
                    fillIfEmpty(order, 'customerPhone', row['Billing Phone']);
                    fillIfEmpty(order, 'customerEmail', row['Email']);
                    fillIfEmpty(order, 'billingStreet', row['Billing Street']);
                    fillIfEmpty(order, 'billingCity', row['Billing City']);
                    fillIfEmpty(order, 'billingProvince', row['Billing Province']);
                    fillIfEmpty(order, 'shippingName', row['Shipping Name']);
                    fillIfEmpty(order, 'shippingStreet', row['Shipping Street']);
                    fillIfEmpty(order, 'shippingCity', row['Shipping City']);
                    fillIfEmpty(order, 'shippingProvince', row['Shipping Province Name'] || row['Shipping Province']);
                    fillIfEmpty(order, 'shippingMethod', row['Shipping Method']);
                    fillIfEmpty(order, 'pickupLocation', row['Pickup Location']);
                    fillIfEmpty(order, 'notes', row['Notes'] || row['Note']);
                    fillIfEmpty(order, 'total', row['Total'] || '0');

                    const lineItemName = (row['Lineitem name'] ?? '').toString().trim();
                    const lineQty = getQuantity(row['Lineitem quantity']);

                    if (lineItemName) {
                        const existing = order.items.find((i) => i.name === lineItemName);
                        if (existing) {
                            existing.quantity += lineQty;
                        } else {
                            order.items.push({ name: lineItemName, quantity: lineQty });
                        }
                    }
                }

                // Finalize aggregated quantities + legacy fallback fields.
                const orders = [];
                for (const order of orderMap.values()) {
                    if (order.items && order.items.length > 0) {
                        const totalQty = order.items.reduce((sum, i) => sum + (parseInt(i.quantity, 10) || 0), 0);
                        order.quantity = String(totalQty);
                        order.itemName = order.items[0].name;
                    } else {
                        // No line items parsed; keep any pre-existing fallback.
                        order.itemName = order.itemName || '';
                        order.quantity = String(parseInt(order.quantity, 10) || 1);
                        order.items = [];
                    }
                    orders.push(order);
                }

                resolve(orders);
            }
        });
    });
}

function toggleOrderDetails(card) {
    const details = card.querySelector('.order-details');
    const orderId = card.getAttribute('data-order-id');
    
    if (details.classList.contains('show')) {
        details.classList.remove('show');
        expandedCards.delete(orderId);
    } else {
        details.classList.add('show');
        expandedCards.add(orderId);
    }
}

async function updateStatus(orderId, status, event) {
    if (event) {
        event.stopPropagation(); // Prevent card collapse
    }
    try {
        await updateOrderStatus(currentGroupId, orderId, status);
        renderOrders();
        showToast(`Order marked as ${status}`);
    } catch (error) {
        console.error('Error updating status:', error);
        showToast('Error updating order status');
    }
}

async function saveOrderNotes(orderId, event) {
    if (event) {
        event.stopPropagation();
    }

    const textarea = document.getElementById(`order-notes-${orderId}`);
    if (!textarea) return;

    const notes = textarea.value ?? '';

    try {
        await updateDoc(doc(db, `orderGroups/${currentGroupId}/orders`, orderId), {
            notes: notes,
            updatedAt: serverTimestamp()
        });

        // Update local state so other UI pieces (like re-render) stay in sync.
        const idx = currentOrders.findIndex((o) => o.id === orderId);
        if (idx !== -1) {
            currentOrders[idx].notes = notes;
        }

        showToast('Notes saved');
    } catch (error) {
        console.error('Error saving notes:', error);
        showToast('Error saving notes');
    }
}

async function deleteOrder(orderId, event) {
    if (event) {
        event.stopPropagation(); // Prevent card collapse
    }

    const ok = window.confirm('Delete this order? This cannot be undone.');
    if (!ok) return;

    try {
        await deleteDoc(doc(db, `orderGroups/${currentGroupId}/orders`, orderId));

        expandedCards.delete(orderId);
        currentOrders = currentOrders.filter((o) => o.id !== orderId);

        renderOrders();
        showToast('Order deleted');
    } catch (error) {
        console.error('Error deleting order:', error);
        showToast('Error deleting order');
    }
}

function copyText(text, event) {
    if (!text) return;
    event.stopPropagation(); // Prevent card collapse
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard');
    }).catch(() => {
        showToast('Failed to copy');
    });
}

function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2000);
}

// Global functions for onclick handlers
window.openOrderGroup = openOrderGroup;
window.toggleOrderDetails = toggleOrderDetails;
window.updateStatus = updateStatus;
window.saveOrderNotes = saveOrderNotes;
window.deleteOrder = deleteOrder;
window.copyText = copyText;
window.closeImportModal = closeImportModal;
window.showImportModal = showImportModal;
window.goBack = goBack;
window.exportToExcel = exportToExcel;
window.archiveOrderGroup = archiveOrderGroup;
window.unarchiveOrderGroup = unarchiveOrderGroup;
window.toggleArchivedView = toggleArchivedView;

function goBack() {
    if (currentGroupId) {
        // Go back to groups view
        currentGroupId = null;
        currentOrders = [];
        showOrderGroups();
        document.getElementById('backBtn').style.display = 'none';
        if (archivedToggleBtnEl) archivedToggleBtnEl.style.display = '';
    }
}

function exportToExcel() {
    if (!currentOrders.length) {
        showToast('No orders to export');
        return;
    }

    // Get current filtered orders
    const shipmentFilter = shipmentFilterEl.value;
    const quantityFilter = quantityFilterEl.value;
    
    let filteredOrders = currentOrders.filter(order => {
        // Apply shipment filter
        if (shipmentFilter === 'pickup') {
            if (!isPickup(order)) return false;
        } else if (shipmentFilter === 'metro') {
            if (isPickup(order) || !metroManila(order)) return false;
        } else if (shipmentFilter === 'nationwide') {
            if (isPickup(order) || metroManila(order)) return false;
        }
        
        // Apply quantity filter
        if (quantityFilter === '1x') {
            if (getOrderQuantity(order) !== 1) return false;
        } else if (quantityFilter === '2x') {
            if (getOrderQuantity(order) !== 2) return false;
        } else if (quantityFilter === '3x') {
            if (getOrderQuantity(order) !== 3) return false;
        }
        
        return true;
    });

    if (filteredOrders.length === 0) {
        showToast('No orders match current filters');
        return;
    }

    if (typeof XLSX === 'undefined') {
        showToast('Excel export library not loaded');
        return;
    }

    // Prepare worksheet rows
    const rows = filteredOrders.map(order => {
        const orderNumber = order.orderNumber || 'No Order #';
        const customerName = order.customerName || 'No Name';
        const shipmentMethod = isPickup(order) ? 'Pickup' : (metroManila(order) ? 'Metro Manila' : 'Nationwide');
        const quantity = getOrderQuantity(order);
        const quantityText = quantity === 1 ? '1 Item' : `${quantity} Items`;
        
        return {
            'Order Number': orderNumber,
            'Name': customerName,
            'Shipment Method': shipmentMethod,
            'x Item/s': quantityText
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders');
    XLSX.writeFile(workbook, `orders_export_${new Date().toISOString().split('T')[0]}.xlsx`);

    showToast(`Exported ${filteredOrders.length} orders to XLSX`);
}
