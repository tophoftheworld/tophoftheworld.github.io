// staff-auth.js - Authentication handling for staff portal
import { 
    auth, 
    onAuthStateChanged, 
    signOutUser, 
    getCurrentUserData
} from './firebase-auth-setup.js';

// DOM elements
const mobileUserInitials = document.getElementById('mobileUserInitials');
const mobileUserInitialsExtras = document.querySelectorAll('[data-mobile-user-initials]');
const mobileUserName = document.getElementById('mobileUserName');
const mobileProfileLink = document.getElementById('mobileProfileLink');
const mobileLogoutButton = document.getElementById('mobileLogoutButton');
const loadingState = document.getElementById('loadingState');
const dashboardContent = document.getElementById('dashboardContent');

// Authentication state
let currentUser = null;
let currentUserData = null;

// Initialize authentication
function initAuth() {
    // Ensure DOM elements exist before setting up auth listener
    const checkElements = () => {
        return mobileUserInitials !== null || 
               mobileUserName !== null || 
               mobileProfileLink !== null;
    };
    
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // User is signed in
            currentUser = user;
            currentUserData = await getCurrentUserData(user);
            
            if (currentUserData) {
                // Wait for DOM to be ready if needed
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                        showUserInfo(currentUserData);
                        showDashboard();
                    });
                } else {
                    // DOM is already ready, but wait a tick to ensure elements exist
                    setTimeout(() => {
                        showUserInfo(currentUserData);
                        showDashboard();
                    }, 0);
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

// Show user information
function showUserInfo(userData) {
    if (!userData) return;
    
    const name = userData.name || 'Staff';
    
    // Set user initials
    const initials = name.split(' ')
        .map(word => word.charAt(0))
        .join('')
        .toUpperCase()
        .substring(0, 2);
    
    // Get fresh references to DOM elements (in case they weren't available before)
    const initialsEl = document.getElementById('mobileUserInitials');
    const initialsExtras = document.querySelectorAll('[data-mobile-user-initials]');
    const nameEl = document.getElementById('mobileUserName');
    const profileLinkEl = document.getElementById('mobileProfileLink');
    
    if (initialsEl) {
        initialsEl.textContent = initials;
    }
    if (mobileUserInitials) {
        mobileUserInitials.textContent = initials;
    }
    
    if (initialsExtras && initialsExtras.length > 0) {
        initialsExtras.forEach(element => {
            element.textContent = initials;
        });
    }
    if (mobileUserInitialsExtras && mobileUserInitialsExtras.length > 0) {
        mobileUserInitialsExtras.forEach(element => {
            element.textContent = initials;
        });
    }
    
    if (nameEl) {
        nameEl.textContent = name;
        nameEl.title = `View profile for ${name}`;
    }
    if (mobileUserName) {
        mobileUserName.textContent = name;
        mobileUserName.title = `View profile for ${name}`;
    }
    
    if (profileLinkEl) {
        const defaultProfilePage = 'profile/index.html';
        const profileHref = userData.profileUrl 
            ? userData.profileUrl 
            : userData.employeeCode 
                ? `${defaultProfilePage}?code=${encodeURIComponent(userData.employeeCode)}`
                : defaultProfilePage;
        profileLinkEl.setAttribute('href', profileHref);
        profileLinkEl.setAttribute('title', `View profile for ${name}`);
        profileLinkEl.setAttribute('aria-label', `View profile for ${name}`);
    }
    if (mobileProfileLink) {
        const defaultProfilePage = 'profile/index.html';
        const profileHref = userData.profileUrl 
            ? userData.profileUrl 
            : userData.employeeCode 
                ? `${defaultProfilePage}?code=${encodeURIComponent(userData.employeeCode)}`
                : defaultProfilePage;
        mobileProfileLink.setAttribute('href', profileHref);
        mobileProfileLink.setAttribute('title', `View profile for ${name}`);
        mobileProfileLink.setAttribute('aria-label', `View profile for ${name}`);
    }
    
    // Update page title
    document.title = `Matchanese Staff - ${name}`;
}

// Show the main dashboard
function showDashboard() {
    // Hide loading state and show dashboard content
    if (loadingState) loadingState.style.display = 'none';
    if (dashboardContent) dashboardContent.style.display = 'block';
    
    // Initialize the dashboard functionality
    if (typeof initializeDashboard === 'function') {
        initializeDashboard();
    }
}

// Redirect to login page
function redirectToLogin() {
    window.location.href = 'login.html';
}

// Handle logout
async function handleLogout() {
    try {
        const result = await signOutUser();
        if (result.success) {
            // Clear any cached data
            localStorage.removeItem('activeStaffApp');
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

// Event listeners
if (mobileLogoutButton) {
    mobileLogoutButton.addEventListener('click', handleLogout);
}

// Make functions globally available
window.handleLogout = handleLogout;
window.getCurrentUser = () => currentUser;
window.getCurrentUserData = () => currentUserData;

// Initialize authentication - call immediately and also on DOM ready
// This ensures auth state is checked even if DOM isn't ready yet
initAuth();

// Also initialize when DOM is ready to ensure elements exist
document.addEventListener('DOMContentLoaded', () => {
    // Re-check auth state and update UI if user is already authenticated
    if (currentUser && currentUserData) {
        showUserInfo(currentUserData);
    }
});

// Export for use in other scripts
export { 
    currentUser, 
    currentUserData
};

