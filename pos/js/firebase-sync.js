import { db, collection, addDoc, updateDoc, doc, getDocs, query, orderBy, limit, setDoc, getDoc } from './firebase-setup.js';
import { menuData } from './menu-data.js';

let syncQueue = [];
let isSyncing = false;
let menuItemsMap = new Map();

function isOnline() {
    return navigator.onLine;
}

export async function initializeMenuItems() {
    try {
        // Clean menu data without HTML
        const menuItems = menuData.items.map(item => ({
            id: item.categoryId + '-' + item.name.replace(/<[^>]*>/g, '').toLowerCase().replace(/\s+/g, '-'),
            name: item.name.replace(/<[^>]*>/g, ''), // Remove HTML tags
            displayName: item.name, // Keep display version with HTML
            description: item.description,
            basePrice: item.price,
            categoryId: item.categoryId,
            type: item.type
        }));

        // Save to Firebase menu-items collection
        for (const item of menuItems) {
            const docRef = doc(db, 'menu-items', item.id);
            await setDoc(docRef, item);
            menuItemsMap.set(item.id, item);
        }
    } catch (error) {
        console.error('Error initializing menu items:', error);
    }
}

export async function saveOrderToFirebase(order) {
    try {
        const orderDate = new Date(order.timestamp).toISOString().split('T')[0]; // YYYY-MM-DD

        // Optimize order data
        const optimizedOrder = {
            id: order.id,
            items: order.items.map(item => ({
                menuItemId: getMenuItemId(item),
                quantity: item.quantity,
                customizations: item.customizations,
                price: item.price,
                basePrice: item.basePrice,
                name: item.name ? item.name.replace(/<[^>]*>/g, '') : null
            })),
            total: order.total,
            paymentMethod: order.paymentMethod,
            timestamp: order.timestamp,
            status: order.status,
            customerName: order.customerName || ''
        };

        // Use the new structure: pos-orders > pop-up > date > order-id
        const orderRef = doc(db, `pos-orders/${window.currentEvent || 'pop-up'}`, orderDate, order.id);
        await setDoc(orderRef, optimizedOrder);

        return order.id;
    } catch (error) {
        console.error('Error saving to Firebase:', error);
        throw error;
    }
}

export async function updateOrderInFirebase(orderId, orderDate, updates) {
    try {
        // If we have a firebaseId, use that instead of the local orderId
        const documentId = updates.firebaseId || orderId;

        // Use the new structure
        const orderRef = doc(db, `pos-orders/${window.currentEvent || 'pop-up'}`, orderDate, documentId);
        await updateDoc(orderRef, updates);
        console.log('Order updated in Firebase:', documentId);
    } catch (error) {
        console.error('Error updating Firebase:', error);
        // Don't re-throw the error - just log it and continue
    }
}

function getLocalDateString(date = new Date()) {
    // Get local date components 
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export async function loadOrdersFromFirebase(date) {
    try {
        const orderDate = getLocalDateString(date);

        // Use the new structure to get orders for a specific date
        const q = query(
            collection(db, `pos-orders/${window.currentEvent || 'pop-up'}`, orderDate),
            orderBy('timestamp', 'desc')
        );

        const querySnapshot = await getDocs(q);
        const firebaseOrders = [];

        querySnapshot.forEach((document) => {
            const orderData = document.data();

            // Reconstruct full order data
            const fullItems = orderData.items.map(item => {
                // Try to get full menu item details
                const menuItem = item.menuItemId ? menuItemsMap.get(item.menuItemId) : null;

                if (menuItem) {
                    return {
                        ...menuItem,
                        ...item,
                        name: menuItem.name || item.name || `Item ${item.menuItemId}`,
                        price: item.price || menuItem.basePrice,
                        basePrice: item.basePrice || menuItem.basePrice
                    };
                } else {
                    // If menu item not found, ensure item has minimum required properties
                    return {
                        ...item,
                        name: item.name || (item.menuItemId ? item.menuItemId.split('-').slice(1).join(' ') : 'Unknown Item'),
                        price: item.price || 0,
                        basePrice: item.basePrice || 0
                    };
                }
            });

            firebaseOrders.push({
                firebaseId: document.id,
                ...orderData,
                items: fullItems
            });
        });

        return firebaseOrders;
    } catch (error) {
        console.error('Error loading from Firebase:', error);
        return [];
    }
}

function getMenuItemId(item) {
    // Check if item.name exists first
    if (!item.name) {
        console.warn('Item with missing name detected:', item);
        return 'unknown-item-' + (item.id || Date.now());
    }

    // Extract clean name from the item
    const cleanName = item.name.replace(/<[^>]*>/g, '');
    const categoryId = menuData.items.find(m => m.name.includes(cleanName))?.categoryId || 'unknown';
    return categoryId + '-' + cleanName.toLowerCase().replace(/\s+/g, '-');
}

export function queueSync(action, orderId, data, orderDate) {
    if (!orderDate && data.timestamp) {
        orderDate = getLocalDateString(new Date(data.timestamp));
    }

    // Always add to queue
    syncQueue.push({ action, orderId, data, orderDate });

    // Only process if online and not already syncing
    if (isOnline() && !isSyncing) {
        processQueue();
    } else if (!isOnline()) {
        console.log('Offline - sync queued for when connection returns');
    }

    // Force Firebase sync after a short delay if online
    if (isOnline()) {
        setTimeout(() => {
            if (window.syncOrdersWithFirebase) {
                window.syncOrdersWithFirebase();
            }
        }, 2000);
    }
}

async function processQueue() {
    if (syncQueue.length === 0) {
        isSyncing = false;
        return;
    }

    isSyncing = true;

    // Process up to 5 items in one batch
    const batchSize = 5;
    const batch = syncQueue.length > batchSize ? syncQueue.splice(0, batchSize) : syncQueue.splice(0);
    const failedItems = [];

    console.log(`Processing batch of ${batch.length} operations...`);

    for (const item of batch) {
        const { action, orderId, data, orderDate } = item;

        try {
            if (action === 'create') {
                const orderRef = doc(db, `pos-orders/${window.currentEvent || 'pop-up'}`, orderDate, orderId);
                const orderDoc = await getDoc(orderRef);

                if (!orderDoc.exists()) {
                    await saveOrderToFirebase(data);
                    console.log(`Successfully created order ${orderId}`);
                } else {
                    console.log(`Order ${orderId} already exists, marking as synced`);
                }

                // Mark as synced in local storage
                const orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
                const index = orderHistory.findIndex(o => o.id === orderId);
                if (index > -1) {
                    orderHistory[index].syncedWithFirebase = true;
                    orderHistory[index].firebaseId = orderId;
                    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
                }
            } else if (action === 'update') {
                await updateOrderInFirebase(orderId, orderDate, data);
                console.log(`Successfully updated order ${orderId}`);
            }
        } catch (error) {
            console.error(`Failed to ${action} order ${orderId}:`, error);
            // Add back to queue for retry
            failedItems.push(item);
        }
    }

    // Re-add failed items to the front of the queue
    if (failedItems.length > 0) {
        console.log(`${failedItems.length} items failed, will retry...`);
        syncQueue.unshift(...failedItems);
    }

    // Continue processing with exponential backoff for retries
    if (syncQueue.length > 0) {
        const delay = failedItems.length > 0 ? 5000 : 1000; // 5s for retries, 1s for normal
        setTimeout(processQueue, delay);
    } else {
        isSyncing = false;
        console.log('Queue processing completed.');
    }
}

