// Staff Management Script
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    getDocs, 
    doc, 
    getDoc, 
    updateDoc, 
    setDoc, 
    addDoc,
    deleteDoc,
    query, 
    where,
    orderBy
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { 
    getStorage, 
    ref, 
    uploadBytes, 
    getDownloadURL,
    deleteObject
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.firebasestorage.app",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266",
    measurementId: "G-YEK4GML6SJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Global variables
let employees = {};
let filteredEmployees = {};

// DOM elements
const employeeTableBody = document.getElementById('employeeTableBody');
const addEmployeeBtn = document.getElementById('addEmployeeBtn');
const refreshBtn = document.getElementById('refreshBtn');
const loadingOverlay = document.getElementById('loadingOverlay');

// Modals
const employeeEditModal = document.getElementById('employeeEditModal');
const roleManagementModal = document.getElementById('roleManagementModal');
const addEmployeeModal = document.getElementById('addEmployeeModal');

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    // Ensure all modals are hidden on page load
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.style.display = 'none';
    });
    
    await loadEmployees();
    setupEventListeners();
    renderEmployeeTable();
});

// Load employees from Firebase
async function loadEmployees() {
    try {
        showLoading(true);
        
        // Load employees from Firebase
        const employeesRef = collection(db, "employees");
        const snapshot = await getDocs(employeesRef);
        
        employees = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            employees[doc.id] = {
                id: doc.id,
                name: data.name || data.fullName || "Unknown",
                nickname: data.nickname || "",
                active: data.active !== false, // Default to true if not specified
                role: data.role || "staff",
                photoUrl: data.photoUrl || null
            };
        });
        
        // Load admin user roles from Firebase Auth collection
        const adminUsersRef = collection(db, "adminUsers");
        const adminSnapshot = await getDocs(adminUsersRef);
        
        console.log('Loading admin users from Firebase...');
        adminSnapshot.forEach(doc => {
            const data = doc.data();
            const employeeId = doc.id; // Document ID should match employee ID
            console.log('Found admin user:', employeeId, 'Role:', data.role, 'Permissions:', data.permissions);
            
            if (employees[employeeId]) {
                employees[employeeId].role = data.role || "staff";
                employees[employeeId].permissions = data.permissions || {};
                console.log('Updated role for', employeeId, 'to', data.role, 'with permissions:', data.permissions);
            }
        });
        
        filteredEmployees = { ...employees };
        console.log(`Loaded ${Object.keys(employees).length} employees`);
        
    } catch (error) {
        console.error("Error loading employees:", error);
        alert("Failed to load employees. Please try again.");
    } finally {
        showLoading(false);
    }
}

// Setup event listeners
function setupEventListeners() {
    // Buttons
    addEmployeeBtn.addEventListener('click', () => openModal(addEmployeeModal));
    refreshBtn.addEventListener('click', loadEmployees);
    
    // Modal close buttons
    document.getElementById('closeEditModal').addEventListener('click', () => closeModal(employeeEditModal));
    document.getElementById('closeRoleModal').addEventListener('click', () => closeModal(roleManagementModal));
    document.getElementById('closeAddEmployeeModal').addEventListener('click', () => closeModal(addEmployeeModal));
    
    // Cancel buttons
    document.getElementById('cancelEditBtn').addEventListener('click', () => closeModal(employeeEditModal));
    document.getElementById('cancelRoleBtn').addEventListener('click', () => closeModal(roleManagementModal));
    document.getElementById('cancelAddEmployeeBtn').addEventListener('click', () => closeModal(addEmployeeModal));
    
    // Form submissions
    document.getElementById('employeeEditForm').addEventListener('submit', handleEditEmployee);
    document.getElementById('roleManagementForm').addEventListener('submit', handleRoleManagement);
    document.getElementById('addEmployeeForm').addEventListener('submit', handleAddEmployee);
    
    // Role selection change
    document.getElementById('roleSelect').addEventListener('change', handleRoleChange);
    
    // Photo input change handlers
    document.getElementById('addPhoto').addEventListener('change', (e) => handlePhotoInputChange(e, 'add'));
    document.getElementById('editPhoto').addEventListener('change', (e) => handlePhotoInputChange(e, 'edit'));
}


// Render employee table
function renderEmployeeTable() {
    const employeeList = Object.values(filteredEmployees);
    
    employeeTableBody.innerHTML = '';
    
    employeeList.forEach(employee => {
        const row = createEmployeeRow(employee);
        employeeTableBody.appendChild(row);
    });
    
    updatePagination(employeeList.length);
}

// Create employee row
function createEmployeeRow(employee) {
    const row = document.createElement('tr');
    
    const roleBadge = getRoleBadge(employee.role);
    const statusBadge = employee.active ? 
        '<span class="status-badge active">Active</span>' : 
        '<span class="status-badge inactive">Inactive</span>';
    
    // Create photo cell with upload functionality
    const photoCell = createPhotoCellElement(employee);
    
    // Create other cells
    const employeeCodeCell = document.createElement('td');
    employeeCodeCell.textContent = employee.id;
    
    const nameCell = document.createElement('td');
    nameCell.textContent = employee.name;
    
    const roleCell = document.createElement('td');
    roleCell.innerHTML = roleBadge;
    
    const statusCell = document.createElement('td');
    statusCell.innerHTML = statusBadge;
    
    const actionsCell = document.createElement('td');
    actionsCell.innerHTML = `
        <div class="action-buttons">
            <button class="action-btn edit-btn" onclick="editEmployee('${employee.id}')">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="action-btn role-btn" onclick="manageRole('${employee.id}')">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
            </button>
        </div>
    `;
    
    // Append all cells to row
    row.appendChild(photoCell);
    row.appendChild(employeeCodeCell);
    row.appendChild(nameCell);
    row.appendChild(roleCell);
    row.appendChild(statusCell);
    row.appendChild(actionsCell);
    
    return row;
}

// Create photo cell element with upload functionality
function createPhotoCellElement(employee) {
    const cell = document.createElement('td');
    cell.style.textAlign = 'center';
    cell.style.padding = '8px';
    
    if (employee.photoUrl) {
        cell.innerHTML = `
            <div class="photo-container">
                <img src="${employee.photoUrl}" alt="${employee.name}" class="employee-photo" onclick="viewPhoto('${employee.photoUrl}', '${employee.name}')">
                <div class="photo-actions">
                    <button class="photo-action-btn" onclick="uploadPhoto('${employee.id}')" title="Change Photo">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="photo-action-btn delete" onclick="deletePhoto('${employee.id}')" title="Delete Photo">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3,6 5,6 21,6"></polyline>
                            <path d="M19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    } else {
        cell.innerHTML = `
            <div class="photo-container">
                <div class="no-photo" onclick="uploadPhoto('${employee.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <line x1="19" x2="19" y1="8" y2="14"></line>
                        <line x1="22" x2="16" y1="11" y2="11"></line>
                    </svg>
                    <span>Add Photo</span>
                </div>
            </div>
        `;
    }
    
    return cell;
}

// Get role badge HTML
function getRoleBadge(role) {
    const badges = {
        'admin': '<span class="role-badge admin">Admin</span>',
        'manager': '<span class="role-badge manager">Manager</span>',
        'staff': '<span class="role-badge staff">Staff</span>'
    };
    return badges[role] || '<span class="role-badge staff">Staff</span>';
}


// Update pagination
function updatePagination(totalItems) {
    const paginationInfo = document.querySelector('.pagination-info');
    if (paginationInfo) {
        paginationInfo.textContent = `Showing all ${totalItems} employees`;
    }
}

// Edit employee
window.editEmployee = function(employeeId) {
    const employee = employees[employeeId];
    if (!employee) return;
    
    document.getElementById('editEmployeeId').value = employeeId;
    document.getElementById('editEmployeeName').value = employee.name;
    document.getElementById('editNickname').value = employee.nickname || '';
    document.getElementById('editBaseRate').value = employee.baseRate || '';
    document.getElementById('editActive').checked = employee.active;
    
    // Handle current photo display
    const currentPhotoDiv = document.getElementById('editCurrentPhoto');
    const currentPhotoImg = document.getElementById('editCurrentPhotoImg');
    const editPhotoInput = document.getElementById('editPhoto');
    
    if (employee.photoUrl) {
        currentPhotoImg.src = employee.photoUrl;
        currentPhotoDiv.style.display = 'block';
    } else {
        currentPhotoDiv.style.display = 'none';
    }
    
    // Reset photo input and preview
    editPhotoInput.value = '';
    document.getElementById('editPhotoPreview').style.display = 'none';
    
    openModal(employeeEditModal);
};

// Manage role
window.manageRole = function(employeeId) {
    const employee = employees[employeeId];
    if (!employee) return;
    
    console.log('Managing role for employee:', employeeId, 'Current role:', employee.role);
    
    document.getElementById('roleEmployeeId').value = employeeId;
    document.getElementById('roleEmployeeName').value = employee.name;
    document.getElementById('roleSelect').value = employee.role;
    
    // Load existing permissions if available
    if (employee.permissions) {
        console.log('Loading existing permissions:', employee.permissions);
        document.getElementById('permPayroll').checked = employee.permissions.payroll || false;
        document.getElementById('permSchedule').checked = employee.permissions.schedule || false;
        document.getElementById('permSales').checked = employee.permissions.sales || false;
        document.getElementById('permExpenses').checked = employee.permissions.expenses || false;
        document.getElementById('permInventory').checked = employee.permissions.inventory || false;
        document.getElementById('permPopups').checked = employee.permissions.popups || false;
        document.getElementById('permStaff').checked = employee.permissions.staff || false;
    } else {
        // Reset all permissions if none exist
        document.getElementById('permPayroll').checked = false;
        document.getElementById('permSchedule').checked = false;
        document.getElementById('permSales').checked = false;
        document.getElementById('permExpenses').checked = false;
        document.getElementById('permInventory').checked = false;
        document.getElementById('permPopups').checked = false;
        document.getElementById('permStaff').checked = false;
    }
    
    // Show/hide manager permissions based on role
    handleRoleChange();
    
    openModal(roleManagementModal);
};

// Handle role change
function handleRoleChange() {
    const roleSelect = document.getElementById('roleSelect');
    const managerPermissionsSection = document.getElementById('managerPermissionsSection');
    
    if (roleSelect.value === 'manager') {
        managerPermissionsSection.style.display = 'block';
    } else {
        managerPermissionsSection.style.display = 'none';
    }
}

// Handle edit employee
async function handleEditEmployee(e) {
    e.preventDefault();
    
    const employeeId = document.getElementById('editEmployeeId').value;
    const name = document.getElementById('editEmployeeName').value;
    const nickname = document.getElementById('editNickname').value;
    const baseRate = parseFloat(document.getElementById('editBaseRate').value) || 0;
    const active = document.getElementById('editActive').checked;
    const photoFile = document.getElementById('editPhoto').files[0];
    
    try {
        showLoading(true);
        
        let photoUrl = employees[employeeId].photoUrl; // Keep existing photo by default
        
        // Upload new photo if provided
        if (photoFile) {
            photoUrl = await uploadEmployeePhoto(employeeId, photoFile);
        }
        
        // Update in Firebase
        const employeeRef = doc(db, "employees", employeeId);
        await updateDoc(employeeRef, {
            name: name,
            nickname: nickname,
            baseRate: baseRate,
            active: active,
            photoUrl: photoUrl
        });
        
        // Update local data
        employees[employeeId] = {
            ...employees[employeeId],
            name: name,
            nickname: nickname,
            baseRate: baseRate,
            active: active,
            photoUrl: photoUrl
        };
        
        renderEmployeeTable();
        closeModal(employeeEditModal);
        alert('Employee updated successfully!');
        
    } catch (error) {
        console.error("Error updating employee:", error);
        alert("Failed to update employee. Please try again.");
    } finally {
        showLoading(false);
    }
}

// Handle role management
async function handleRoleManagement(e) {
    e.preventDefault();
    
    const employeeId = document.getElementById('roleEmployeeId').value;
    const role = document.getElementById('roleSelect').value;
    
    console.log('Saving role for employee:', employeeId, 'Role:', role);
    
    // Get manager permissions if role is manager
    let permissions = {};
    if (role === 'manager') {
        permissions = {
            payroll: document.getElementById('permPayroll').checked,
            schedule: document.getElementById('permSchedule').checked,
            sales: document.getElementById('permSales').checked,
            expenses: document.getElementById('permExpenses').checked,
            inventory: document.getElementById('permInventory').checked,
            popups: document.getElementById('permPopups').checked,
            staff: document.getElementById('permStaff').checked
        };
        console.log('Manager permissions:', permissions);
    }
    
    try {
        showLoading(true);
        
        // Update in Firebase Auth collection - use employeeId as document ID to prevent duplicates
        const adminUserRef = doc(db, "adminUsers", employeeId);
        const roleData = {
            employeeCode: employeeId,
            name: employees[employeeId].name,
            role: role,
            permissions: permissions,
            updatedAt: new Date()
        };
        
        console.log('Saving to Firebase:', roleData);
        // Use setDoc without merge to ensure single source of truth
        await setDoc(adminUserRef, roleData);
        
        // Update local data
        employees[employeeId].role = role;
        
        console.log('Role updated successfully for:', employeeId);
        renderEmployeeTable();
        closeModal(roleManagementModal);
        alert('Employee role updated successfully!');
        
    } catch (error) {
        console.error("Error updating role:", error);
        alert("Failed to update role. Please try again.");
    } finally {
        showLoading(false);
    }
}

// Handle add employee
async function handleAddEmployee(e) {
    e.preventDefault();
    
    const employeeId = document.getElementById('addEmployeeId').value;
    const name = document.getElementById('addEmployeeName').value;
    const nickname = document.getElementById('addNickname').value;
    const baseRate = parseFloat(document.getElementById('addBaseRate').value) || 0;
    const photoFile = document.getElementById('addPhoto').files[0];
    
    // Check if employee ID already exists
    if (employees[employeeId]) {
        alert('Employee ID already exists. Please use a different ID.');
        return;
    }
    
    try {
        showLoading(true);
        
        let photoUrl = null;
        
        // Upload photo if provided
        if (photoFile) {
            photoUrl = await uploadEmployeePhoto(employeeId, photoFile);
        }
        
        // Add to Firebase
        const employeeRef = doc(db, "employees", employeeId);
        await setDoc(employeeRef, {
            name: name,
            nickname: nickname,
            baseRate: baseRate,
            active: true,
            role: 'staff',
            photoUrl: photoUrl,
            createdAt: new Date()
        });
        
        // Add to local data
        employees[employeeId] = {
            id: employeeId,
            name: name,
            nickname: nickname,
            baseRate: baseRate,
            active: true,
            role: 'staff',
            photoUrl: photoUrl
        };
        
        renderEmployeeTable();
        closeModal(addEmployeeModal);
        
        // Clear form
        document.getElementById('addEmployeeForm').reset();
        document.getElementById('addPhotoPreview').style.display = 'none';
        
        alert('Employee added successfully!');
        
    } catch (error) {
        console.error("Error adding employee:", error);
        alert("Failed to add employee. Please try again.");
    } finally {
        showLoading(false);
    }
}

// Modal functions
function openModal(modal) {
    console.log('Opening modal:', modal.id);
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
    console.log('Closing modal:', modal.id);
    modal.classList.remove('show');
    document.body.style.overflow = 'auto';
}

// Loading functions
function showLoading(show) {
    if (loadingOverlay) {
        loadingOverlay.style.display = show ? 'flex' : 'none';
    }
}

// Close modals when clicking outside
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        closeModal(e.target);
    }
});

// Function to clean up duplicate admin user entries
async function cleanupDuplicateAdminUsers() {
    try {
        console.log('Starting cleanup of duplicate admin users...');
        const adminUsersRef = collection(db, "adminUsers");
        const adminSnapshot = await getDocs(adminUsersRef);
        
        const employeeMap = new Map();
        const duplicatesToDelete = [];
        
        adminSnapshot.forEach(doc => {
            const data = doc.data();
            const employeeId = data.employeeCode;
            
            if (employeeMap.has(employeeId)) {
                // This is a duplicate - mark for deletion
                console.log('Found duplicate for employee:', employeeId, 'Doc ID:', doc.id);
                duplicatesToDelete.push(doc.id);
            } else {
                // First occurrence - keep it
                employeeMap.set(employeeId, {
                    docId: doc.id,
                    data: data
                });
            }
        });
        
        console.log(`Found ${duplicatesToDelete.length} duplicate entries to delete`);
        
        // Delete duplicates
        for (const docId of duplicatesToDelete) {
            const docRef = doc(db, "adminUsers", docId);
            await deleteDoc(docRef);
            console.log('Deleted duplicate document:', docId);
        }
        
        console.log('Cleanup completed successfully!');
        alert(`Cleanup completed! Deleted ${duplicatesToDelete.length} duplicate entries.`);
        
    } catch (error) {
        console.error('Error during cleanup:', error);
        alert('Error during cleanup. Please try again.');
    }
}

// Make cleanup function available globally for testing
window.cleanupDuplicateAdminUsers = cleanupDuplicateAdminUsers;

// Photo upload and management functions
window.uploadPhoto = function(employeeId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            await handlePhotoUpload(employeeId, file);
        }
    };
    input.click();
};

window.viewPhoto = function(photoUrl, employeeName) {
    const modal = document.createElement('div');
    modal.className = 'photo-modal';
    modal.innerHTML = `
        <div class="photo-modal-content">
            <span class="close-modal" onclick="this.parentElement.parentElement.remove()">&times;</span>
            <h3>${employeeName}</h3>
            <img src="${photoUrl}" alt="${employeeName}" class="modal-image">
        </div>
    `;
    document.body.appendChild(modal);
    modal.style.display = 'flex';
};

window.deletePhoto = async function(employeeId) {
    if (!confirm('Are you sure you want to delete this photo?')) {
        return;
    }
    
    try {
        showLoading(true);
        
        const employee = employees[employeeId];
        if (employee.photoUrl) {
            // Delete from Firebase Storage
            const photoRef = ref(storage, `staff-photos/${employeeId}`);
            try {
                await deleteObject(photoRef);
            } catch (error) {
                console.warn('Photo not found in storage:', error);
            }
        }
        
        // Update employee record
        const employeeRef = doc(db, "employees", employeeId);
        await updateDoc(employeeRef, {
            photoUrl: null
        });
        
        // Update local data
        employees[employeeId].photoUrl = null;
        
        renderEmployeeTable();
        alert('Photo deleted successfully!');
        
    } catch (error) {
        console.error("Error deleting photo:", error);
        alert("Failed to delete photo. Please try again.");
    } finally {
        showLoading(false);
    }
};

async function handlePhotoUpload(employeeId, file) {
    try {
        showLoading(true);
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select a valid image file.');
            return;
        }
        
        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('File size must be less than 5MB.');
            return;
        }
        
        // Create storage reference
        const storageRef = ref(storage, `staff-photos/${employeeId}`);
        
        // Upload file
        const snapshot = await uploadBytes(storageRef, file);
        
        // Get download URL
        const photoUrl = await getDownloadURL(snapshot.ref);
        
        // Update employee record in Firestore
        const employeeRef = doc(db, "employees", employeeId);
        await updateDoc(employeeRef, {
            photoUrl: photoUrl,
            photoUpdatedAt: new Date()
        });
        
        // Update local data
        employees[employeeId].photoUrl = photoUrl;
        
        renderEmployeeTable();
        alert('Photo uploaded successfully!');
        
    } catch (error) {
        console.error("Error uploading photo:", error);
        alert("Failed to upload photo. Please try again.");
    } finally {
        showLoading(false);
    }
}

// Upload employee photo (for modal forms)
async function uploadEmployeePhoto(employeeId, file) {
    // Validate file type
    if (!file.type.startsWith('image/')) {
        throw new Error('Please select a valid image file.');
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        throw new Error('File size must be less than 5MB.');
    }
    
    // Create storage reference
    const storageRef = ref(storage, `staff-photos/${employeeId}`);
    
    // Upload file
    const snapshot = await uploadBytes(storageRef, file);
    
    // Get download URL
    const photoUrl = await getDownloadURL(snapshot.ref);
    
    return photoUrl;
}

// Handle photo input change for previews
function handlePhotoInputChange(event, type) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const previewId = type === 'add' ? 'addPhotoPreview' : 'editPhotoPreview';
            const previewImgId = type === 'add' ? 'addPhotoPreviewImg' : 'editPhotoPreviewImg';
            
            document.getElementById(previewImgId).src = e.target.result;
            document.getElementById(previewId).style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

// Remove photo preview
window.removePhotoPreview = function(type) {
    const previewId = type === 'add' ? 'addPhotoPreview' : 'editPhotoPreview';
    const inputId = type === 'add' ? 'addPhoto' : 'editPhoto';
    
    document.getElementById(previewId).style.display = 'none';
    document.getElementById(inputId).value = '';
}
