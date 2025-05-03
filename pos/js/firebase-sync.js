// firebase-sync.js
import { db, collection, addDoc, updateDoc, doc, getDocs, query, orderBy, limit } from './firebase-setup.js';

let syncQueue = [];
let isSyncing = false;

export async function saveOrderToFirebase(order) {
    try {
        const docRef = await addDoc(collection(db, 'orders'), order);
        return docRef.id;
    } catch (error) {
        console.error('Error saving to Firebase:', error);
        throw error;
    }
}

export async function updateOrderInFirebase(orderId, updates) {
    try {
        const orderRef = doc(db, 'orders', orderId);
        await updateDoc(orderRef, updates);
    } catch (error) {
        console.error('Error updating Firebase:', error);
        throw error;
    }
}

export function queueSync(action, orderId, data) {
    syncQueue.push({ action, orderId, data });
    if (!isSyncing) {
        processQueue();
    }
}

async function processQueue() {
    if (syncQueue.length === 0) {
        isSyncing = false;
        return;
    }
    
    isSyncing = true;
    const { action, orderId, data } = syncQueue.shift();
    
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
            await updateOrderInFirebase(data.firebaseId, {
                status: data.status,
                customerName: data.customerName,
                timestamp: data.timestamp
            });
        }
    } catch (error) {
        console.error('Sync error:', error);
        // Re-queue failed operations
        syncQueue.push({ action, orderId, data });
    }
    
    // Process next item after a short delay
    setTimeout(processQueue, 100);
}

export async function syncWithFirebase() {
    try {
        const orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
        const ordersWithoutFirebaseId = orderHistory.filter(order => !order.firebaseId);
        
        for (const order of ordersWithoutFirebaseId) {
            queueSync('create', order.id, order);
        }
    } catch (error) {
        console.error('Sync error:', error);
    }
}

export async function loadFromFirebase() {
    try {
        const q = query(collection(db, 'orders'), orderBy('timestamp', 'desc'), limit(100));
        const querySnapshot = await getDocs(q);
        const firebaseOrders = [];
        
        querySnapshot.forEach((doc) => {
            firebaseOrders.push({
                firebaseId: doc.id,
                ...doc.data()
            });
        });
        
        return firebaseOrders;
    } catch (error) {
        console.error('Error loading from Firebase:', error);
        return [];
    }
}