// admin-script.js
import { db } from './firebase-setup.js';
import { 
    collection, 
    getDocs, 
    doc, 
    getDoc, 
    setDoc,
    query,
    where
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Global variables
let employees = {};
let assignments = {};
let excludedIds = new Set();
let currentSort = { column: null, direction: 'asc' };

// DOM elements
const randomizeBtn = document.getElementById('randomizeBtn');
const clearBtn = document.getElementById('clearBtn');
const exclusionsGrid = document.getElementById('exclusionsGrid');
const assignmentsTableBody = document.getElementById('assignmentsTableBody');
const errorMessage = document.getElementById('errorMessage');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadEmployees();
    await loadAssignments();
    setupEventListeners();
    renderExclusions();
    renderTable();
});

// Load employees from Firebase
async function loadEmployees() {
    try {
        const employeesRef = collection(db, "employees");
        const snapshot = await getDocs(employeesRef);
        
        employees = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            employees[doc.id] = {
                id: doc.id,
                name: data.name || data.fullName || "Unknown",
                nickname: data.nickname || "",
                active: data.active !== false
            };
        });
        
        console.log(`Loaded ${Object.keys(employees).length} employees`);
    } catch (error) {
        console.error("Error loading employees:", error);
        showError("Failed to load employees. Please refresh the page.");
    }
}

// Load existing assignments and exclusions from Firebase
async function loadAssignments() {
    try {
        const assignmentsRef = doc(db, "giftExchange", "assignments");
        const assignmentsSnap = await getDoc(assignmentsRef);
        
        if (assignmentsSnap.exists()) {
            const data = assignmentsSnap.data();
            
            // Handle both old format (direct assignments object) and new format (nested)
            if (data.assignments) {
                // New format with nested structure
                assignments = data.assignments;
            } else {
                // Old format - assignments are the root object
                // Check if it's actually assignments (has employee IDs as keys)
                const keys = Object.keys(data);
                const hasEmployeeIdFormat = keys.length > 0 && keys.some(key => /^\d+$/.test(key));
                
                if (hasEmployeeIdFormat) {
                    assignments = data;
                } else {
                    assignments = {};
                }
            }
            
            // Load excluded IDs if they exist
            if (data.excludedIds && Array.isArray(data.excludedIds)) {
                excludedIds = new Set(data.excludedIds);
                console.log("Loaded excluded IDs:", Array.from(excludedIds));
            }
            
            console.log("Loaded existing assignments:", assignments);
        } else {
            assignments = {};
        }
    } catch (error) {
        console.error("Error loading assignments:", error);
        // Don't show error for first-time setup
    }
}

// Save assignments and exclusions to Firebase
async function saveAssignments() {
    try {
        const assignmentsRef = doc(db, "giftExchange", "assignments");
        await setDoc(assignmentsRef, {
            assignments: assignments,
            excludedIds: Array.from(excludedIds),
            lastUpdated: new Date()
        });
        console.log("Assignments and exclusions saved successfully");
    } catch (error) {
        console.error("Error saving assignments:", error);
        showError("Failed to save assignments. Please try again.");
        throw error;
    }
}

// Setup event listeners
function setupEventListeners() {
    randomizeBtn.addEventListener('click', handleRandomize);
    clearBtn.addEventListener('click', handleClear);
    
    // Add sort functionality to table headers
    const sortableHeaders = document.querySelectorAll('.sortable');
    sortableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.sort;
            if (currentSort.column === column) {
                // Toggle direction
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }
            renderTable();
        });
    });
}

// Handle randomization
async function handleRandomize() {
    try {
        // Get list of active employees (not excluded)
        const activeEmployees = Object.values(employees)
            .filter(emp => emp.active && !excludedIds.has(emp.id))
            .map(emp => emp.id);
        
        if (activeEmployees.length < 2) {
            showError("Need at least 2 active employees (excluding selected) to create assignments.");
            return;
        }
        
        // Create assignments ensuring no one gifts to themselves
        const newAssignments = {};
        let attempts = 0;
        const maxAttempts = 100;
        
        while (attempts < maxAttempts) {
            const shuffledCopy = [...activeEmployees].sort(() => Math.random() - 0.5);
            let valid = true;
            
            for (let i = 0; i < activeEmployees.length; i++) {
                const giver = activeEmployees[i];
                const recipient = shuffledCopy[i];
                
                // Check if someone would gift to themselves
                if (giver === recipient) {
                    valid = false;
                    break;
                }
            }
            
            if (valid) {
                for (let i = 0; i < activeEmployees.length; i++) {
                    const giver = activeEmployees[i];
                    const recipient = shuffledCopy[i];
                    newAssignments[giver] = recipient;
                }
                break;
            }
            
            attempts++;
        }
        
        if (attempts >= maxAttempts) {
            showError("Could not create valid assignments. Please try again or adjust exclusions.");
            return;
        }
        
        // Update assignments
        assignments = newAssignments;
        
        // Save to Firebase (includes exclusions)
        await saveAssignments();
        
        // Update UI
        renderTable();
        
        // Show success message
        hideError();
        alert("Assignments randomized successfully!");
        
    } catch (error) {
        console.error("Error randomizing:", error);
        showError("Failed to randomize assignments. Please try again.");
    }
}

// Handle clear
async function handleClear() {
    if (!confirm("Are you sure you want to clear all assignments?")) {
        return;
    }
    
    try {
        assignments = {};
        // Note: We keep exclusions even when clearing assignments
        await saveAssignments();
        renderTable();
        hideError();
        alert("Assignments cleared successfully!");
    } catch (error) {
        console.error("Error clearing assignments:", error);
        showError("Failed to clear assignments. Please try again.");
    }
}

// Render exclusions checkboxes
function renderExclusions() {
    exclusionsGrid.innerHTML = '';
    
    const sortedEmployees = Object.values(employees)
        .filter(emp => emp.active)
        .sort((a, b) => a.name.localeCompare(b.name));
    
    sortedEmployees.forEach(employee => {
        const item = document.createElement('div');
        item.className = 'exclusion-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `exclude-${employee.id}`;
        checkbox.checked = excludedIds.has(employee.id);
        checkbox.addEventListener('change', async (e) => {
            if (e.target.checked) {
                excludedIds.add(employee.id);
            } else {
                excludedIds.delete(employee.id);
            }
            // Save exclusions when changed
            await saveAssignments();
        });
        
        const label = document.createElement('label');
        label.htmlFor = `exclude-${employee.id}`;
        const displayName = employee.nickname 
            ? `${employee.name} (${employee.nickname})`
            : employee.name;
        label.textContent = displayName;
        
        item.appendChild(checkbox);
        item.appendChild(label);
        exclusionsGrid.appendChild(item);
    });
}

// Render table
function renderTable() {
    // Clear table
    assignmentsTableBody.innerHTML = '';
    
    if (Object.keys(assignments).length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="3" style="text-align: center; color: #999; padding: 2rem;">No assignments yet. Click "Randomize Assignments" to create them.</td>';
        assignmentsTableBody.appendChild(row);
        return;
    }
    
    // Create array of assignment entries
    const assignmentEntries = Object.entries(assignments).map(([giverId, recipientId]) => {
        const giver = employees[giverId];
        const recipient = employees[recipientId];
        return {
            giverId,
            recipientId,
            giverName: giver?.name || 'Unknown',
            giverNickname: giver?.nickname || '',
            recipientName: recipient?.name || 'Unknown',
            recipientNickname: recipient?.nickname || ''
        };
    });
    
    // Sort based on current sort settings
    if (currentSort.column) {
        assignmentEntries.sort((a, b) => {
            let aValue, bValue;
            
            if (currentSort.column === 'giver') {
                aValue = a.giverName.toLowerCase();
                bValue = b.giverName.toLowerCase();
            } else {
                aValue = a.recipientName.toLowerCase();
                bValue = b.recipientName.toLowerCase();
            }
            
            const comparison = aValue.localeCompare(bValue);
            return currentSort.direction === 'asc' ? comparison : -comparison;
        });
    }
    
    // Update sort indicators
    document.querySelectorAll('.sortable').forEach(header => {
        header.classList.remove('sort-asc', 'sort-desc');
        if (header.dataset.sort === currentSort.column) {
            header.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });
    
    // Render rows
    assignmentEntries.forEach(({ giverId, recipientId, giverName, giverNickname, recipientName, recipientNickname }) => {
        const row = document.createElement('tr');
        
        const giverDisplay = giverNickname 
            ? `${giverName} <span class="employee-nickname">(${giverNickname})</span>`
            : giverName;
        
        const recipientDisplay = recipientNickname
            ? `${recipientName} <span class="employee-nickname">(${recipientNickname})</span>`
            : recipientName;
        
        row.innerHTML = `
            <td>
                <span class="employee-name">${giverDisplay}</span>
            </td>
            <td style="text-align: center; color: #2b9348; font-size: 1.2rem; font-weight: bold;">
                →
            </td>
            <td>
                <span class="employee-name">${recipientDisplay}</span>
            </td>
        `;
        assignmentsTableBody.appendChild(row);
    });
}

// Alias for backwards compatibility
function renderTables() {
    renderTable();
}

// Error handling
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}

function hideError() {
    errorMessage.style.display = 'none';
}

