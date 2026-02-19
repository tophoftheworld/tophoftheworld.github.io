import { db } from '../firebase-inventory.js';
import { collection, getDocs, query, where, doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

// Global state
let inventoryItems = [];
let availableBranches = ['sm-north', 'podium', 'moa'];

// Load inventory items for a specific branch
export async function loadInventoryItems(branch) {
  try {
    const querySnapshot = await getDocs(query(collection(db, 'inventory-items'), where('branch', '==', branch)));
    inventoryItems = querySnapshot.docs.map(d => {
      const data = d.data();
      return { 
        id: d.id, 
        ...data,
        displayOrder: data.displayOrder ?? 0,
        categoryOrder: data.categoryOrder ?? 0
      };
    });
    
    // Sort by category order, then display order
    inventoryItems.sort((a, b) => {
      if (a.categoryOrder !== b.categoryOrder) {
        return a.categoryOrder - b.categoryOrder;
      }
      return a.displayOrder - b.displayOrder;
    });
    
    return inventoryItems;
  } catch (error) {
    console.error('Error loading inventory items:', error);
    return [];
  }
}

// Load quantities for a specific date and mode (opening/closing)
export async function loadQuantitiesForDate(branch, date, mode = 'opening') {
  try {
    const dateKey = getDateKey(date);
    const docRef = doc(db, 'inventory-quantities', `${branch}_${dateKey}_${mode}`);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      return docSnap.data().quantities || {};
    }
    return {};
  } catch (error) {
    console.error('Error loading quantities:', error);
    return {};
  }
}

// Load branches from Firebase
export async function loadBranchesFromFirebase() {
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
    availableBranches = names.length > 0 ? names : ['sm-north', 'podium', 'moa'];
    return availableBranches;
  } catch (error) {
    console.error('Error loading branches:', error);
    return ['sm-north', 'podium', 'moa'];
  }
}

// Get branch display name
export function getBranchDisplayName(branch) {
  if (!branch) return '';
  const map = { 'sm-north': 'SM North', 'podium': 'Podium', 'moa': 'MOA' };
  return map[branch] || branch.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Get unique categories from inventory items
export function getUniqueCategories() {
  const categoryMap = new Map();
  inventoryItems.forEach(item => {
    if (item.category) {
      if (!categoryMap.has(item.category)) {
        categoryMap.set(item.category, {
          name: item.category,
          order: item.categoryOrder || 0,
          itemCount: 0
        });
      }
      categoryMap.get(item.category).itemCount++;
    }
  });
  
  return Array.from(categoryMap.values())
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name))
    .map(cat => cat.name);
}

// Get date key for Firebase
export function getDateKey(date = new Date()) {
  // Use local time instead of UTC to avoid timezone issues
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`; // Returns "YYYY-MM-DD" in local time
}

// Get current inventory items (from memory)
export function getCurrentInventoryItems() {
  return inventoryItems;
}

// Get available branches
export function getAvailableBranches() {
  return availableBranches;
}
