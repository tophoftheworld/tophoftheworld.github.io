// admin-auth.js - Authentication handling for admin dashboard
import { 
    auth, 
    onAuthStateChanged, 
    signOutUser, 
    getCurrentUserData, 
    isAdmin 
} from './firebase-auth-setup.js';

// DOM elements
const userInfo = document.getElementById('userInfo');
const userName = document.getElementById('userName');
const userRole = document.getElementById('userRole');
const userInitials = document.getElementById('userInitials');
const logoutButton = document.getElementById('logoutButton');
const loadingState = document.getElementById('loadingState');
const dashboardContent = document.getElementById('dashboardContent');

// Authentication state
let currentUser = null;
let currentUserData = null;

// Initialize authentication
function initAuth() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // User is signed in
            currentUser = user;
            currentUserData = await getCurrentUserData(user);
            
            if (currentUserData) {
                showUserInfo(currentUserData);
                
                // Check if user has admin access
                if (checkAdminPermission()) {
                    showDashboard();
                } else {
                    showAccessDenied();
                }
            } else {
                console.error('Could not load user data');
                redirectToLogin();
            }
        } else {
            // User is signed out
            currentUser = null;
            currentUserData = null;
            redirectToLogin();
        }
    });
}

// Show user information in sidebar
function showUserInfo(userData) {
    const name = userData.name || 'Unknown User';
    const role = userData.role || 'User';
    
    // Set user name and role
    userName.textContent = name;
    userRole.textContent = role.charAt(0).toUpperCase() + role.slice(1);
    
    // Set user initials
    const initials = name.split(' ')
        .map(word => word.charAt(0))
        .join('')
        .toUpperCase()
        .substring(0, 2);
    userInitials.textContent = initials;
    
    // Show user info section
    userInfo.style.display = 'block';
    
    // Update page title
    document.title = `Matchanese Admin - ${name}`;
}

// Show the main dashboard
function showDashboard() {
    // Hide loading state and show dashboard content
    if (loadingState) loadingState.style.display = 'none';
    if (dashboardContent) dashboardContent.style.display = 'flex';
    
    // Initialize the dashboard functionality
    if (typeof initializeDashboard === 'function') {
        initializeDashboard();
    }
}

// Redirect to login page
function redirectToLogin() {
    window.location.href = 'admin-login.html';
}

// Handle logout
async function handleLogout() {
    try {
        const result = await signOutUser();
        if (result.success) {
            // Clear any cached data
            localStorage.removeItem('activeApp');
            sessionStorage.clear();
            
            // Redirect to login
            redirectToLogin();
        } else {
            console.error('Logout failed:', result.error);
            alert('Logout failed. Please try again.');
        }
    } catch (error) {
        console.error('Logout error:', error);
        alert('An error occurred during logout. Please try again.');
    }
}

// Check if user has permission to access admin features
function checkAdminPermission() {
    if (!currentUserData) {
        return false;
    }
    
    // Allow admin and manager roles
    return isAdmin(currentUserData);
}

// Check if user has permission to access a specific tab
function checkTabPermission(tabName) {
    if (!currentUserData) {
        return false;
    }
    
    // Admins have access to all tabs
    if (currentUserData.role === 'admin') {
        return true;
    }
    
    // Staff users have no access
    if (currentUserData.role === 'staff') {
        return false;
    }
    
    // Managers have selective access based on permissions
    if (currentUserData.role === 'manager') {
        const permissions = currentUserData.permissions || {};
        
        // Map tab names to permission keys
        const tabPermissions = {
            'Payroll': 'payroll',
            'Staff': 'staff',
            'Schedule': 'schedule',
            'Shopify': 'shopify',
            'Workshops': 'workshops',
            'Inbox': 'inbox',
            'Sales': 'sales',
            'Expenses': 'expenses',
            'Inventory': 'inventory',
            'Pop-ups': 'popups'
        };
        
        const permissionKey = tabPermissions[tabName];
        return permissionKey ? permissions[permissionKey] === true : false;
    }
    
    return false;
}

// Show access denied message for staff users
function showAccessDenied() {
    if (loadingState) loadingState.style.display = 'none';
    if (dashboardContent) dashboardContent.style.display = 'none';
    
    const mainContent = document.querySelector('main');
    mainContent.innerHTML = `
        <div class="flex items-center justify-center h-full">
            <div class="text-center max-w-md">
                <div class="text-6xl mb-4">🔒</div>
                <h2 class="text-2xl font-bold text-gray-800 mb-4">Access Denied</h2>
                <p class="text-gray-600">You don't have admin privileges.</p>
            </div>
        </div>
    `;
}

// Show permission denied message (legacy function)
function showPermissionDenied() {
    showAccessDenied();
}

// Event listeners
if (logoutButton) {
    logoutButton.addEventListener('click', handleLogout);
}

// Make functions globally available
window.handleLogout = handleLogout;
window.checkAdminPermission = checkAdminPermission;
window.checkTabPermission = checkTabPermission;
window.getCurrentUser = () => currentUser;
window.getCurrentUserData = () => currentUserData;

// Initialize authentication when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
});

// Export for use in other scripts
export { 
    currentUser, 
    currentUserData, 
    checkAdminPermission, 
    showPermissionDenied 
};
