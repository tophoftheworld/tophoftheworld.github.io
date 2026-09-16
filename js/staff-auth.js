// staff-auth.js - Authentication handling for staff portal
import { 
    auth, 
    onAuthStateChanged, 
    signOutUser, 
    getCurrentUserData,
    db,
    app
} from './firebase-auth-setup.js';

import { doc, getDoc, setDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { getStorage, ref, getDownloadURL } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js';
import {
    readProfileCache,
    writeProfileCache,
    clearProfileCache,
    resolveEmployeeCode,
    getInitials
} from './staff-profile-cache.js';

const storage = getStorage(app);

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

function applyNavPhoto(photoUrl) {
    const photos = [
        document.getElementById('mobileUserPhoto'),
        ...document.querySelectorAll('[data-mobile-user-photo]')
    ].filter(Boolean);

    photos.forEach((img) => {
        if (photoUrl) {
            img.src = photoUrl;
            img.alt = 'Profile photo';
            img.style.display = 'block';
        } else {
            img.removeAttribute('src');
            img.alt = '';
            img.style.display = 'none';
        }
    });
}

function applyNavText(name, initials) {
    const initialsEl = document.getElementById('mobileUserInitials');
    const initialsExtras = document.querySelectorAll('[data-mobile-user-initials]');
    const nameEl = document.getElementById('mobileUserName');

    if (initialsEl) initialsEl.textContent = initials;
    if (mobileUserInitials) mobileUserInitials.textContent = initials;
    initialsExtras.forEach((el) => { el.textContent = initials; });
    if (mobileUserInitialsExtras) {
        mobileUserInitialsExtras.forEach((el) => { el.textContent = initials; });
    }

    if (nameEl) {
        nameEl.textContent = name;
        nameEl.title = `View profile for ${name}`;
    }
    if (mobileUserName) {
        mobileUserName.textContent = name;
        mobileUserName.title = `View profile for ${name}`;
    }
}

function applyCachedNav(cache) {
    if (!cache) return;
    const name = cache.name || 'Staff';
    applyNavText(name, getInitials(name));
    if (cache.photoUrl) applyNavPhoto(cache.photoUrl);
}

async function loadStaffPhoto(user, userData) {
    const employeeCode = resolveEmployeeCode(user, userData);
    if (!employeeCode) {
        applyNavPhoto(null);
        return null;
    }

    // Backfill missing employeeCode on adminUsers
    if (user?.uid && !userData?.employeeCode) {
        try {
            await updateDoc(doc(db, 'adminUsers', user.uid), {
                employeeCode,
                updatedAt: new Date()
            });
        } catch (err) {
            console.warn('Could not backfill employeeCode:', err);
        }
    }

    try {
        const snap = await getDoc(doc(db, 'employees_v2', employeeCode));
        let photoUrl = snap.exists() ? (snap.data().photoUrl || null) : null;

        if (!photoUrl) {
            try {
                photoUrl = await getDownloadURL(ref(storage, `staff-photos/${employeeCode}`));
                await setDoc(doc(db, 'employees_v2', employeeCode), {
                    photoUrl,
                    photoUpdatedAt: new Date()
                }, { merge: true });
            } catch {
                photoUrl = null;
            }
        }

        applyNavPhoto(photoUrl);
        return photoUrl;
    } catch (error) {
        console.warn('Could not load staff photo for nav:', error);
        applyNavPhoto(null);
        return null;
    }
}

// Initialize authentication
function initAuth() {
    // Instant paint from cache before auth resolves
    try {
        let newest = null;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith('staffProfileCache:')) continue;
            const cache = JSON.parse(localStorage.getItem(key));
            if (!cache) continue;
            if (!newest || (cache.updatedAt || 0) > (newest.updatedAt || 0)) newest = cache;
        }
        if (newest) applyCachedNav(newest);
    } catch {
        // ignore
    }

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            applyCachedNav(readProfileCache(user.uid));

            currentUserData = await getCurrentUserData(user);
            
            if (currentUserData) {
                const code = resolveEmployeeCode(user, currentUserData);
                if (code && !currentUserData.employeeCode) {
                    currentUserData = { ...currentUserData, employeeCode: code };
                }

                const paint = async () => {
                    await showUserInfo(currentUserData);
                    showDashboard();
                };

                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', paint);
                } else {
                    setTimeout(paint, 0);
                }
            } else {
                console.error('Could not load user data');
                redirectToLogin();
            }
        } else {
            currentUser = null;
            currentUserData = null;
            redirectToLogin();
        }
    });
}

// Show user information
async function showUserInfo(userData) {
    if (!userData) return;
    
    const name = userData.name || 'Staff';
    const initials = getInitials(name);
    applyNavText(name, initials);

    const defaultProfilePage = 'profile/index.html';
    const employeeCode = resolveEmployeeCode(currentUser, userData);
    const profileHref = userData.profileUrl 
        ? userData.profileUrl 
        : employeeCode 
            ? `${defaultProfilePage}?code=${encodeURIComponent(employeeCode)}`
            : defaultProfilePage;

    const profileLinkEl = document.getElementById('mobileProfileLink');
    if (profileLinkEl) {
        profileLinkEl.setAttribute('href', profileHref);
        profileLinkEl.setAttribute('title', `View profile for ${name}`);
        profileLinkEl.setAttribute('aria-label', `View profile for ${name}`);
    }
    if (mobileProfileLink) {
        mobileProfileLink.setAttribute('href', profileHref);
        mobileProfileLink.setAttribute('title', `View profile for ${name}`);
        mobileProfileLink.setAttribute('aria-label', `View profile for ${name}`);
    }

    const headerAvatar = document.getElementById('mobileProfileAvatar');
    if (headerAvatar) {
        headerAvatar.onclick = () => {
            window.location.href = profileHref;
        };
    }

    const photoUrl = await loadStaffPhoto(currentUser, userData);

    if (currentUser?.uid) {
        writeProfileCache(currentUser.uid, {
            name,
            username: userData.username || employeeCode || null,
            role: userData.role || null,
            employeeCode,
            photoUrl: photoUrl || null
        });
    }
    
    document.title = `Matchanese Staff - ${name}`;
}

function showDashboard() {
    if (loadingState) loadingState.style.display = 'none';
    if (dashboardContent) dashboardContent.style.display = 'block';
    
    if (typeof initializeDashboard === 'function') {
        initializeDashboard();
    }
}

function redirectToLogin() {
    window.location.href = 'login.html';
}

async function handleLogout() {
    try {
        const uid = currentUser?.uid;
        const result = await signOutUser();
        if (result.success) {
            clearProfileCache(uid);
            localStorage.removeItem('activeStaffApp');
            sessionStorage.clear();
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

if (mobileLogoutButton) {
    mobileLogoutButton.addEventListener('click', handleLogout);
}

window.handleLogout = handleLogout;
window.getCurrentUser = () => currentUser;
window.getCurrentUserData = () => currentUserData;

initAuth();

document.addEventListener('DOMContentLoaded', () => {
    if (currentUser && currentUserData) {
        showUserInfo(currentUserData);
    }
});

export { 
    currentUser, 
    currentUserData
};
