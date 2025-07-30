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

export async function syncOrderToFirebase(order) {
    try {
        if (!isOnline()) {
            console.log('Offline - sync will retry later');
            return false;
        }

        const orderDate = getLocalDateString(new Date(order.timestamp));
        console.log(`Syncing order ${order.id} to Firebase...`);

        // Prepare order data for Firebase
        const firebaseOrder = {
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
            customerName: order.customerName || '',
            lastModified: order.lastModified || order.timestamp,
            event: order.event || 'pop-up'
        };

        // Save to Firebase
        const orderRef = doc(db, `pos-orders/${order.event || 'pop-up'}`, orderDate, order.id);
        await setDoc(orderRef, firebaseOrder);

        console.log(`Successfully synced order ${order.id}`);
        return true;
    } catch (error) {
        console.error(`Failed to sync order ${order.id}:`, error);
        return false;
    }
}

export async function syncAllPendingOrders() {
    if (!isOnline()) {
        console.log('Offline - skipping sync');
        return;
    }

    console.log('Starting background sync of all pending orders...');

    const orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
    const pendingOrders = orderHistory.filter(order => order.needsSync === true && order.status !== 'deleted');

    if (pendingOrders.length === 0) {
        console.log('No orders need syncing');
        return;
    }

    console.log(`Found ${pendingOrders.length} orders that need syncing`);

    let syncedCount = 0;

    for (const order of pendingOrders) {
        const success = await syncOrderToFirebase(order);

        if (success) {
            // Mark as synced in local storage
            const orderIndex = orderHistory.findIndex(o => o.id === order.id);
            if (orderIndex > -1) {
                orderHistory[orderIndex].needsSync = false;
                syncedCount++;
            }
        }

        // Small delay to avoid overwhelming Firebase
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Save updated order history
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
    console.log(`Successfully synced ${syncedCount} of ${pendingOrders.length} orders`);
}

// Add these functions to firebase-sync.js

export async function loadEventsFromFirebase() {
    try {
        const branchesRef = collection(db, 'branches');
        const snapshot = await getDocs(branchesRef);
        const events = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.type === 'popup') {
                events.push({
                    key: data.key,
                    name: data.name,
                    type: data.type,
                    serviceType: data.serviceType || 'popup',
                    archived: data.archived || false,
                    customMenu: data.customMenu || null
                });
            }
        });
        return events;
    } catch (error) {
        console.error('Error loading events:', error);
        return [];
    }
}

export async function saveEventToFirebase(eventData) {
    try {
        const docRef = await addDoc(collection(db, 'branches'), eventData);
        return { id: docRef.id, ...eventData };
    } catch (error) {
        console.error('Error saving event:', error);
        throw error;
    }
}