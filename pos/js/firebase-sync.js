import { db, collection, addDoc, updateDoc, doc, getDocs, query, orderBy, limit, setDoc } from './firebase-setup.js';
import { menuData } from './menu-data.js';

let syncQueue = [];
let isSyncing = false;
let menuItemsMap = new Map();

// Initialize menu items in Firebase (run once when app starts)
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
                basePrice: item.basePrice
            })),
            total: order.total,
            paymentMethod: order.paymentMethod,
            timestamp: order.timestamp,
            status: order.status,
            customerName: order.customerName || ''
        };

        // Save to Firebase using order ID as document ID (removes extra nesting)
        const docRef = doc(db, 'matchanese-pos', orderDate, 'orders', order.id);
        await setDoc(docRef, optimizedOrder);

        return order.id; // Return the ID used
    } catch (error) {
        console.error('Error saving to Firebase:', error);
        throw error;
    }
}

export async function updateOrderInFirebase(orderId, orderDate, updates) {
    try {
        const orderRef = doc(db, 'matchanese-pos', orderDate, 'orders', orderId);
        await updateDoc(orderRef, updates);
    } catch (error) {
        console.error('Error updating Firebase:', error);
        throw error;
    }
}

function getMenuItemId(item) {
    // Extract clean name from the item
    const cleanName = item.name.replace(/<[^>]*>/g, '');
    const categoryId = menuData.items.find(m => m.name.includes(cleanName))?.categoryId || 'unknown';
    return categoryId + '-' + cleanName.toLowerCase().replace(/\s+/g, '-');
}

export function queueSync(action, orderId, data, orderDate) {
    syncQueue.push({ action, orderId, data, orderDate });
    if (!isSyncing) {
        processQueue();
    }

    // Force Firebase sync after a short delay
    setTimeout(() => {
        if (window.syncOrdersWithFirebase) {
            window.syncOrdersWithFirebase();
        }
    }, 2000);
}

async function processQueue() {
    if (syncQueue.length === 0) {
        isSyncing = false;
        return;
    }

    isSyncing = true;
    const { action, orderId, data, orderDate } = syncQueue.shift();

    try {
        if (action === 'create') {
            const firebaseId = await saveOrderToFirebase(data);
            // Update local storage with Firebase ID
            const orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
            const index = orderHistory.findIndex(o => o.id === orderId);
            if (index > -1) {
                orderHistory[index].firebaseId = firebaseId;
                localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
            }
        } else if (action === 'update' && data.firebaseId) {
            await updateOrderInFirebase(data.firebaseId, orderDate, {
                status: data.status,
                customerName: data.customerName,
                timestamp: data.timestamp
            });
        }
    } catch (error) {
        console.error('Sync error:', error);
        syncQueue.push({ action, orderId, data, orderDate });
    }

    setTimeout(processQueue, 100);
}

export async function loadOrdersFromFirebase(date) {
    try {
        const orderDate = date.toISOString().split('T')[0];
        const q = query(collection(db, 'matchanese-pos', orderDate, 'orders'), orderBy('timestamp', 'desc'));
        const querySnapshot = await getDocs(q);
        const firebaseOrders = [];

        querySnapshot.forEach((doc) => {
            const orderData = doc.data();

            // Reconstruct full order data by merging with menu items
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
                firebaseId: doc.id,
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