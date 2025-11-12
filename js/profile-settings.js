// profile-settings.js - Profile management for staff portal
import {
    auth,
    onAuthStateChanged,
    signOutUser,
    getCurrentUserData,
    db
} from './firebase-auth-setup.js';

import {
    EmailAuthProvider,
    reauthenticateWithCredential,
    updatePassword
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';

import {
    doc,
    updateDoc,
    collection,
    getDocs
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

// DOM elements
const displayNameEl = document.getElementById('displayName');
const displayEmailEl = document.getElementById('displayEmail');
const rolePillEl = document.getElementById('rolePill');
const currentUsernameEl = document.getElementById('currentUsername');
const profileAvatarEl = document.getElementById('profileAvatar');
const profileAvatarInitialsEl = document.getElementById('profileAvatarInitials');
const profileAvatarImageEl = document.getElementById('profileAvatarImage');
const changePhotoButton = document.getElementById('changePhotoButton');
const removePhotoButton = document.getElementById('removePhotoButton');
const profilePhotoInput = document.getElementById('profilePhotoInput');

const signOutButton = document.getElementById('signOutButton');

// Username form elements
const usernameForm = document.getElementById('usernameForm');
const newUsernameInput = document.getElementById('newUsername');
const usernameCurrentPasswordInput = document.getElementById('usernameCurrentPassword');
const usernameMessage = document.getElementById('usernameMessage');
const usernameSubmitButton = document.getElementById('usernameSubmit');
const usernameSpinner = document.getElementById('usernameSpinner');

// Password form elements
const passwordForm = document.getElementById('passwordForm');
const currentPasswordInput = document.getElementById('currentPassword');
const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const passwordMessage = document.getElementById('passwordMessage');
const passwordSubmitButton = document.getElementById('passwordSubmit');
const passwordSpinner = document.getElementById('passwordSpinner');

// State
let currentUser = null;
let currentUserData = null;

function ensurePanelVisible(element) {
    if (!element) return;
    const section = element.closest('details');
    if (!section) return;
    section.open = true;
}

function showMessage(element, type, message) {
    if (!element) return;

    ensurePanelVisible(element);

    element.classList.remove('message-success', 'message-error');
    element.classList.add('message', type === 'success' ? 'message-success' : 'message-error');
    element.innerHTML = `
        <svg class="w-5 h-5 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="${type === 'success'
                    ? 'M5 13l4 4L19 7'
                    : 'M12 9v2m0 4h.01M12 5a7 7 0 110 14 7 7 0 010-14z'}">
            </path>
        </svg>
        <span>${message}</span>
    `;
    element.style.display = 'flex';
}

function hideMessage(element) {
    if (!element) return;
    element.style.display = 'none';
    element.textContent = '';
    element.classList.remove('message-success', 'message-error');
}

function setLoading(button, spinner, isLoading, defaultText, loadingText) {
    if (!button) return;

    button.disabled = isLoading;
    const span = button.querySelector('span');
    if (span) {
        span.textContent = isLoading ? loadingText : defaultText;
    }

    if (spinner) {
        spinner.classList.toggle('hidden', !isLoading);
    }
}

function getInitials(name) {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .map(part => part.charAt(0))
        .join('')
        .substring(0, 2)
        .toUpperCase() || 'SM';
}

function getPhotoStorageKey() {
    if (!currentUser) return null;
    return `profilePhoto:${currentUser.uid}`;
}

function applyAvatarPhoto(photoDataUrl) {
    if (!profileAvatarEl || !profileAvatarImageEl) return;

    if (photoDataUrl) {
        profileAvatarEl.classList.add('has-photo');
        profileAvatarImageEl.src = photoDataUrl;
        profileAvatarImageEl.alt = 'Profile photo';
        profileAvatarImageEl.style.display = 'block';
        if (removePhotoButton) {
            removePhotoButton.style.display = 'inline-flex';
        }
    } else {
        profileAvatarEl.classList.remove('has-photo');
        profileAvatarImageEl.src = '';
        profileAvatarImageEl.alt = '';
        profileAvatarImageEl.style.display = 'none';
        if (removePhotoButton) {
            removePhotoButton.style.display = 'none';
        }
    }
}

function normalizeUsername(value) {
    return value.trim();
}

function populateUserInfo() {
    if (!currentUserData) return;

    const name = currentUserData.name || 'Staff Member';
    const username = currentUserData.username || currentUserData.employeeCode || '—';
    const role = currentUserData.role || 'staff';

    if (displayNameEl) displayNameEl.textContent = name;
    if (currentUsernameEl) currentUsernameEl.textContent = username;
    if (displayEmailEl) displayEmailEl.style.display = 'none';

    if (rolePillEl) {
        rolePillEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);
        rolePillEl.style.backgroundColor = role === 'admin' || role === 'manager'
            ? 'rgba(59, 130, 246, 0.12)'
            : 'rgba(43, 147, 72, 0.1)';
        rolePillEl.style.color = role === 'admin' || role === 'manager'
            ? '#2563eb'
            : '#2b9348';
    }

    if (profileAvatarInitialsEl) {
        profileAvatarInitialsEl.textContent = getInitials(name);
        profileAvatarInitialsEl.setAttribute('aria-label', `Avatar for ${name}`);
    }

    if (profileAvatarEl) {
        if (role === 'admin' || role === 'manager') {
            profileAvatarEl.classList.add('admin');
        } else {
            profileAvatarEl.classList.remove('admin');
        }
    }

    const storageKey = getPhotoStorageKey();
    if (storageKey) {
        const savedPhoto = localStorage.getItem(storageKey);
        applyAvatarPhoto(savedPhoto);
    } else {
        applyAvatarPhoto(null);
    }
}

async function reauthenticate(password) {
    if (!currentUser || !password) {
        throw new Error('Missing authentication information.');
    }

    const email = currentUser.email;
    const credential = EmailAuthProvider.credential(email, password);
    await reauthenticateWithCredential(currentUser, credential);
}

async function handleUsernameUpdate(event) {
    event.preventDefault();
    hideMessage(usernameMessage);
    ensurePanelVisible(usernameMessage);

    const newUsernameRaw = newUsernameInput?.value || '';
    const password = usernameCurrentPasswordInput?.value || '';
    const newUsername = normalizeUsername(newUsernameRaw);

    if (!newUsername || !password) {
        showMessage(usernameMessage, 'error', 'Please provide a new username and your current password.');
        return;
    }

    if (currentUserData && newUsername.toLowerCase() === (currentUserData.username || '').toLowerCase()) {
        showMessage(usernameMessage, 'error', 'You are already using that username.');
        return;
    }

    if (!/^[A-Za-z0-9_-]+$/.test(newUsername)) {
        showMessage(usernameMessage, 'error', 'Usernames may only include letters, numbers, underscores, or dashes.');
        return;
    }

    // Check if username is already taken by another user
    try {
        const adminUsersRef = collection(db, 'adminUsers');
        const snapshot = await getDocs(adminUsersRef);
        
        for (const docSnap of snapshot.docs) {
            // Skip current user
            if (docSnap.id === currentUser.uid) continue;
            
            const userData = docSnap.data();
            if (userData.username && userData.username.toLowerCase() === newUsername.toLowerCase()) {
                showMessage(usernameMessage, 'error', 'That username is already taken. Please choose another.');
                return;
            }
        }
    } catch (checkError) {
        console.warn('Could not check username uniqueness:', checkError);
        // Continue anyway - we'll handle duplicates if they occur
    }

    setLoading(usernameSubmitButton, usernameSpinner, true, 'Save username', 'Saving...');

    try {
        await reauthenticate(password);

        // Update Firestore - only update username, NOT employeeCode
        // We don't update Firebase Auth email - it stays as employeeCode@matchanese.local
        // The login system will look up the username in Firestore and use employeeCode for Auth
        const userDocRef = doc(db, 'adminUsers', currentUser.uid);
        const updateData = {
            username: newUsername,
            updatedAt: new Date()
        };
        
        await updateDoc(userDocRef, updateData);

        currentUserData = await getCurrentUserData(currentUser);
        populateUserInfo();

        if (usernameForm) {
            usernameForm.reset();
        }

        showMessage(usernameMessage, 'success', 'Username updated successfully. You can now use your new username to sign in.');
    } catch (error) {
        console.error('Username update failed:', error);
        let message = 'Could not update username. Please try again.';

        if (error.code === 'auth/wrong-password') {
            message = 'Incorrect password. Please verify your current password.';
        } else if (error.code === 'auth/invalid-password') {
            message = 'Invalid password. Please try again.';
        } else if (error.code === 'auth/email-already-in-use') {
            message = 'That username is already taken. Please choose another.';
        } else if (error.code === 'auth/weak-password') {
            message = 'Your password is too weak. Please try again with a stronger password.';
        } else if (error.code === 'auth/requires-recent-login') {
            message = 'For security, please sign in again and retry.';
        }

        showMessage(usernameMessage, 'error', message);
    } finally {
        setLoading(usernameSubmitButton, usernameSpinner, false, 'Save username', 'Saving...');
    }
}

async function handlePasswordUpdate(event) {
    event.preventDefault();
    hideMessage(passwordMessage);
    ensurePanelVisible(passwordMessage);

    const currentPassword = currentPasswordInput?.value || '';
    const newPassword = newPasswordInput?.value || '';
    const confirmPassword = confirmPasswordInput?.value || '';

    if (!currentPassword || !newPassword || !confirmPassword) {
        showMessage(passwordMessage, 'error', 'Please fill out all password fields.');
        return;
    }

    if (newPassword !== confirmPassword) {
        showMessage(passwordMessage, 'error', 'New passwords do not match. Please try again.');
        return;
    }

    if (newPassword.length < 6) {
        showMessage(passwordMessage, 'error', 'New passwords must be at least 6 characters long.');
        return;
    }

    setLoading(passwordSubmitButton, passwordSpinner, true, 'Save password', 'Saving...');

    try {
        await reauthenticate(currentPassword);
        await updatePassword(currentUser, newPassword);

        if (passwordForm) {
            passwordForm.reset();
        }

        showMessage(passwordMessage, 'success', 'Password updated successfully. Use the new password next time you sign in.');
    } catch (error) {
        console.error('Password update failed:', error);
        let message = 'Could not update password. Please try again.';

        if (error.code === 'auth/wrong-password') {
            message = 'Incorrect current password. Please verify and try again.';
        } else if (error.code === 'auth/weak-password') {
            message = 'Password is too weak. Please choose at least 6 characters and avoid common words.';
        } else if (error.code === 'auth/requires-recent-login') {
            message = 'For security, please sign in again and retry.';
        }

        showMessage(passwordMessage, 'error', message);
    } finally {
        setLoading(passwordSubmitButton, passwordSpinner, false, 'Save password', 'Saving...');
    }
}

function redirectToLogin() {
    window.location.href = '../login.html';
}

// Event listeners
if (signOutButton) {
    signOutButton.addEventListener('click', async () => {
        const result = await signOutUser();
        if (result.success) {
            redirectToLogin();
        } else {
            alert('Unable to sign out. Please try again.');
        }
    });
}

if (usernameForm) {
    usernameForm.addEventListener('submit', handleUsernameUpdate);
    usernameForm.addEventListener('reset', () => {
        hideMessage(usernameMessage);
        if (newUsernameInput) newUsernameInput.value = '';
        if (usernameCurrentPasswordInput) usernameCurrentPasswordInput.value = '';
    });
}

if (passwordForm) {
    passwordForm.addEventListener('submit', handlePasswordUpdate);
    passwordForm.addEventListener('reset', () => {
        hideMessage(passwordMessage);
    });
}

if (changePhotoButton && profilePhotoInput) {
    changePhotoButton.addEventListener('click', () => {
        profilePhotoInput.click();
    });
}

if (profilePhotoInput) {
    profilePhotoInput.addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('Please choose an image file.');
            profilePhotoInput.value = '';
            return;
        }

        const maxBytes = 2 * 1024 * 1024; // 2MB
        if (file.size > maxBytes) {
            alert('Please choose an image smaller than 2MB.');
            profilePhotoInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            const result = loadEvent.target?.result;
            if (typeof result === 'string') {
                applyAvatarPhoto(result);
                const storageKey = getPhotoStorageKey();
                if (storageKey) {
                    localStorage.setItem(storageKey, result);
                }
            }
        };
        reader.readAsDataURL(file);
    });
}

if (removePhotoButton) {
    removePhotoButton.addEventListener('click', () => {
        applyAvatarPhoto(null);
        const storageKey = getPhotoStorageKey();
        if (storageKey) {
            localStorage.removeItem(storageKey);
        }
        if (profilePhotoInput) {
            profilePhotoInput.value = '';
        }
    });
}

// Authentication guard
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        redirectToLogin();
        return;
    }

    currentUser = user;

    try {
        currentUserData = await getCurrentUserData(user);
        if (!currentUserData) {
            showMessage(usernameMessage, 'error', 'Unable to load profile information.');
            return;
        }
        populateUserInfo();
    } catch (error) {
        console.error('Error loading profile data:', error);
        showMessage(usernameMessage, 'error', 'Unable to load profile information.');
    }
});

