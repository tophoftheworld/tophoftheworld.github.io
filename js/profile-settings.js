// profile-settings.js - Profile management for staff portal
import {
    app,
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
    getDoc,
    setDoc,
    updateDoc,
    collection,
    getDocs
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js';

import {
    readProfileCache,
    writeProfileCache,
    clearProfileCache,
    resolveEmployeeCode,
    getInitials
} from './staff-profile-cache.js';

const storage = getStorage(app);

// DOM
const displayNameEl = document.getElementById('displayName');
const rolePillEl = document.getElementById('rolePill');
const currentUsernameEl = document.getElementById('currentUsername');
const profileAvatarEl = document.getElementById('profileAvatar');
const profileAvatarInitialsEl = document.getElementById('profileAvatarInitials');
const profileAvatarImageEl = document.getElementById('profileAvatarImage');

const photoModal = document.getElementById('photoModal');
const photoManageStage = document.getElementById('photoManageStage');
const photoCropStage = document.getElementById('photoCropStage');
const photoModalPreview = document.getElementById('photoModalPreview');
const photoModalPreviewImage = document.getElementById('photoModalPreviewImage');
const photoModalPreviewInitials = document.getElementById('photoModalPreviewInitials');
const photoMessage = document.getElementById('photoMessage');
const choosePhotoButton = document.getElementById('choosePhotoButton');
const removePhotoButton = document.getElementById('removePhotoButton');
const profilePhotoInput = document.getElementById('profilePhotoInput');
const cropViewport = document.getElementById('cropViewport');
const cropImage = document.getElementById('cropImage');
const cropZoom = document.getElementById('cropZoom');
const cropMessage = document.getElementById('cropMessage');
const cancelCropButton = document.getElementById('cancelCropButton');
const saveCropButton = document.getElementById('saveCropButton');
const saveCropSpinner = document.getElementById('saveCropSpinner');
const photoModalSubtitle = document.getElementById('photoModalSubtitle');

const personalInfoModal = document.getElementById('personalInfoModal');
const usernameModal = document.getElementById('usernameModal');
const passwordModal = document.getElementById('passwordModal');

const personalInfoForm = document.getElementById('personalInfoForm');
const profileEmailInput = document.getElementById('profileEmail');
const profilePhoneInput = document.getElementById('profilePhone');
const profileBirthdayInput = document.getElementById('profileBirthday');
const personalInfoMessage = document.getElementById('personalInfoMessage');
const personalInfoSubmitButton = document.getElementById('personalInfoSubmit');
const personalInfoSpinner = document.getElementById('personalInfoSpinner');

const usernameForm = document.getElementById('usernameForm');
const newUsernameInput = document.getElementById('newUsername');
const usernameCurrentPasswordInput = document.getElementById('usernameCurrentPassword');
const usernameMessage = document.getElementById('usernameMessage');
const usernameSubmitButton = document.getElementById('usernameSubmit');
const usernameSpinner = document.getElementById('usernameSpinner');

const passwordForm = document.getElementById('passwordForm');
const currentPasswordInput = document.getElementById('currentPassword');
const newPasswordInput = document.getElementById('newPassword');
const confirmPasswordInput = document.getElementById('confirmPassword');
const passwordMessage = document.getElementById('passwordMessage');
const passwordSubmitButton = document.getElementById('passwordSubmit');
const passwordSpinner = document.getElementById('passwordSpinner');

const paymentModal = document.getElementById('paymentModal');
const paymentForm = document.getElementById('paymentForm');
const paymentMessage = document.getElementById('paymentMessage');
const paymentSubmitButton = document.getElementById('paymentSubmit');
const paymentSpinner = document.getElementById('paymentSpinner');
const paymentSummaryText = document.getElementById('paymentSummaryText');
const paymentPreferredBankSelect = document.getElementById('paymentPreferredBank');

const BANK_QR_STORAGE = {
    gotyme: 'staff-gotyme-qr',
    bdo: 'staff-bdo-qr'
};
const BANK_QR_MAX_BYTES = 10 * 1024 * 1024;
const qrPickerState = {
    gotyme: { file: null, remove: false, objectUrl: null },
    bdo: { file: null, remove: false, objectUrl: null }
};

// Bank rules: which account-number lengths are valid per bank.
// GoTyme is the strongly recommended option for payroll.
const BANK_CONFIG = {
    gotyme: {
        label: 'GoTyme',
        digits: [12],
        hint: 'GoTyme account numbers are exactly 12 digits (found in the app under your profile).'
    },
    bdo: {
        label: 'BDO',
        digits: [10, 11, 12],
        hint: 'BDO account numbers are 10 to 12 digits and usually start with 00.'
    }
};

const signOutButton = document.getElementById('signOutButton');

let currentUser = null;
let currentUserData = null;
let employeeProfile = null;
let photoBusy = false;

const cropState = {
    naturalWidth: 0,
    naturalHeight: 0,
    scale: 1,
    minScale: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    pointers: new Map(),
    pinchStartDist: 0,
    pinchStartScale: 1
};

function showMessage(element, type, message) {
    if (!element) return;
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
    if (span) span.textContent = isLoading ? loadingText : defaultText;
    if (spinner) spinner.classList.toggle('hidden', !isLoading);
}

function getEmployeeCode() {
    return resolveEmployeeCode(currentUser, currentUserData);
}

function persistProfileCache(extra = {}) {
    if (!currentUser?.uid) return;
    writeProfileCache(currentUser.uid, {
        name: currentUserData?.name || employeeProfile?.name || null,
        username: currentUserData?.username || currentUserData?.employeeCode || null,
        role: currentUserData?.role || null,
        employeeCode: getEmployeeCode(),
        photoUrl: employeeProfile?.photoUrl || null,
        ...extra
    });
}

function applyCachedProfile(cache) {
    if (!cache) return;
    if (displayNameEl && cache.name) displayNameEl.textContent = cache.name;
    if (currentUsernameEl && cache.username) currentUsernameEl.textContent = cache.username;
    if (rolePillEl && cache.role) {
        const role = cache.role;
        rolePillEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);
        rolePillEl.style.backgroundColor = role === 'admin' || role === 'manager'
            ? 'rgba(59, 130, 246, 0.12)'
            : 'rgba(43, 147, 72, 0.1)';
        rolePillEl.style.color = role === 'admin' || role === 'manager' ? '#2563eb' : '#2b9348';
        if (profileAvatarEl) {
            profileAvatarEl.classList.toggle('admin', role === 'admin' || role === 'manager');
        }
    }
    applyAvatarToElements(cache.photoUrl || null, getInitials(cache.name || 'Staff Member'));
}

function openModal(modal) {
    if (!modal) return;
    modal.classList.add('is-open');
    document.body.classList.add('modal-open');
}

function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('is-open');
    if (!document.querySelector('.modal-overlay.is-open')) {
        document.body.classList.remove('modal-open');
    }
}

function closeAllModals() {
    document.querySelectorAll('.modal-overlay.is-open').forEach(closeModal);
}

function applyAvatarToElements(photoUrl, initials) {
    const targets = [
        { root: profileAvatarEl, img: profileAvatarImageEl, initialsEl: profileAvatarInitialsEl },
        { root: photoModalPreview, img: photoModalPreviewImage, initialsEl: photoModalPreviewInitials }
    ];

    targets.forEach(({ root, img, initialsEl }) => {
        if (initialsEl && initials) initialsEl.textContent = initials;
        if (!root || !img) return;
        if (photoUrl) {
            root.classList.add('has-photo');
            img.src = photoUrl;
            img.alt = 'Profile photo';
            img.style.display = 'block';
        } else {
            root.classList.remove('has-photo');
            img.removeAttribute('src');
            img.alt = '';
            img.style.display = 'none';
        }
    });

    if (removePhotoButton) {
        removePhotoButton.style.display = photoUrl ? 'block' : 'none';
    }
}

function normalizeBirthday(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 10);
    if (value && typeof value.toDate === 'function') {
        return value.toDate().toISOString().slice(0, 10);
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    return '';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function displayOrDash(value) {
    const text = String(value ?? '').trim();
    return text || '—';
}

function staffDisplayName() {
    return currentUserData?.name || employeeProfile?.name || getEmployeeCode() || 'Staff';
}

function formatAccountEmailLine(label, account) {
    const acc = account || emptyBankAccount();
    if (!acc.accountNumber && !acc.accountName && !acc.qrUrl) {
        return `<strong>${escapeHtml(label)}:</strong> not saved`;
    }
    const qr = acc.qrUrl
        ? `<a href="${escapeHtml(acc.qrUrl)}">QR attached</a>`
        : 'no QR';
    return `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(displayOrDash(acc.accountName))} · ${escapeHtml(displayOrDash(acc.accountNumber))} · ${qr}`;
}

async function notifyStaffProfileUpdate({ title, lines }) {
    const emailjs = typeof window !== 'undefined' ? window.emailjs : null;
    if (!emailjs) {
        console.warn('EmailJS not loaded — skipping profile notification');
        return;
    }
    const name = staffDisplayName();
    const employeeCode = getEmployeeCode() || '';
    const items = (lines || []).filter(Boolean);
    const bodyHtml = `
        <div style="font-family: Segoe UI, sans-serif; color: #333;">
            <p><strong>${escapeHtml(name)}</strong> (${escapeHtml(employeeCode)}) updated their ${escapeHtml(title)}.</p>
            ${items.map((line) => `<p style="margin:0 0 8px;">${line}</p>`).join('')}
            <p style="margin-top:16px;color:#6b7280;font-size:13px;">Review in Admin → Staff.</p>
        </div>`;
    try {
        emailjs.init('Jxzqofh9mPAsb9V0M');
        await emailjs.send('service_1085n74', 'template_6zh5mq8', {
            to_email: 'hi@matchanese.com',
            from_name: 'Matchanese Profile',
            subject: `[Staff profile] ${name} updated ${title}`,
            message: bodyHtml
        });
    } catch (error) {
        console.warn('Profile update email failed:', error);
    }
}

function populatePersonalInfoForm() {
    if (profileEmailInput) profileEmailInput.value = employeeProfile?.email || '';
    if (profilePhoneInput) profilePhoneInput.value = employeeProfile?.phone || '';
    if (profileBirthdayInput) profileBirthdayInput.value = normalizeBirthday(employeeProfile?.birthday);
    refreshSectionStatuses();
}

function populateUserInfo() {
    if (!currentUserData) return;

    const name = currentUserData.name || employeeProfile?.name || 'Staff Member';
    const username = currentUserData.username || currentUserData.employeeCode || '—';
    const role = currentUserData.role || 'staff';
    const initials = getInitials(name);

    if (displayNameEl) displayNameEl.textContent = name;
    if (currentUsernameEl) currentUsernameEl.textContent = username;

    if (rolePillEl) {
        rolePillEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);
        rolePillEl.style.backgroundColor = role === 'admin' || role === 'manager'
            ? 'rgba(59, 130, 246, 0.12)'
            : 'rgba(43, 147, 72, 0.1)';
        rolePillEl.style.color = role === 'admin' || role === 'manager' ? '#2563eb' : '#2b9348';
    }

    if (profileAvatarEl) {
        profileAvatarEl.classList.toggle('admin', role === 'admin' || role === 'manager');
    }
    if (photoModalPreview) {
        photoModalPreview.classList.toggle('admin', role === 'admin' || role === 'manager');
    }

    applyAvatarToElements(employeeProfile?.photoUrl || null, initials);
    populatePersonalInfoForm();
    updatePaymentSummary();
    persistProfileCache();
}

async function loadPhotoFromStorageFallback(employeeCode) {
    try {
        const url = await getDownloadURL(ref(storage, `staff-photos/${employeeCode}`));
        // Backfill Firestore so Staff Management / nav stay in sync
        await setDoc(doc(db, 'employees_v2', employeeCode), {
            photoUrl: url,
            photoUpdatedAt: new Date()
        }, { merge: true });
        return url;
    } catch {
        return null;
    }
}

async function loadEmployeeProfile() {
    const employeeCode = getEmployeeCode();
    if (!employeeCode) {
        employeeProfile = null;
        console.warn('No employeeCode on adminUsers / Auth email; cannot load staff photo.');
        return;
    }

    // Ensure adminUsers keeps employeeCode for future loads
    if (currentUser?.uid && !currentUserData?.employeeCode) {
        try {
            await updateDoc(doc(db, 'adminUsers', currentUser.uid), {
                employeeCode,
                updatedAt: new Date()
            });
            currentUserData = { ...currentUserData, employeeCode };
        } catch (err) {
            console.warn('Could not backfill employeeCode on adminUsers:', err);
        }
    }

    const snap = await getDoc(doc(db, 'employees_v2', employeeCode));
    employeeProfile = snap.exists()
        ? { id: employeeCode, ...snap.data() }
        : { id: employeeCode };

    if (!employeeProfile.photoUrl) {
        const fallbackUrl = await loadPhotoFromStorageFallback(employeeCode);
        if (fallbackUrl) {
            employeeProfile.photoUrl = fallbackUrl;
        }
    }
}

function showManageStage() {
    if (photoManageStage) photoManageStage.classList.remove('is-hidden');
    if (photoCropStage) photoCropStage.classList.remove('is-active');
    if (photoModalSubtitle) {
        photoModalSubtitle.textContent = 'Choose a new photo or remove the current one.';
    }
    hideMessage(cropMessage);
}

function showCropStage() {
    if (photoManageStage) photoManageStage.classList.add('is-hidden');
    if (photoCropStage) photoCropStage.classList.add('is-active');
    if (photoModalSubtitle) {
        photoModalSubtitle.textContent = 'Drag to frame your face, then save.';
    }
    hideMessage(photoMessage);
}

function updateCropTransform() {
    if (!cropImage || !cropViewport) return;
    const size = cropViewport.clientWidth || 280;
    const displayW = cropState.naturalWidth * cropState.scale;
    const displayH = cropState.naturalHeight * cropState.scale;
    const maxOffsetX = Math.max(0, (displayW - size) / 2);
    const maxOffsetY = Math.max(0, (displayH - size) / 2);
    cropState.offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, cropState.offsetX));
    cropState.offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, cropState.offsetY));
    cropImage.style.width = `${displayW}px`;
    cropImage.style.height = `${displayH}px`;
    cropImage.style.transform = `translate(calc(-50% + ${cropState.offsetX}px), calc(-50% + ${cropState.offsetY}px))`;
}

function initCropFromImage(objectUrl) {
    return new Promise((resolve, reject) => {
        if (!cropImage) {
            reject(new Error('Missing crop image'));
            return;
        }
        cropImage.onload = () => {
            cropState.naturalWidth = cropImage.naturalWidth;
            cropState.naturalHeight = cropImage.naturalHeight;
            const size = cropViewport?.clientWidth || 280;
            cropState.minScale = Math.max(size / cropState.naturalWidth, size / cropState.naturalHeight);
            cropState.scale = cropState.minScale;
            cropState.offsetX = 0;
            cropState.offsetY = 0;
            if (cropZoom) {
                cropZoom.min = String(cropState.minScale);
                cropZoom.max = String(cropState.minScale * 3);
                cropZoom.step = '0.01';
                cropZoom.value = String(cropState.scale);
            }
            updateCropTransform();
            resolve();
        };
        cropImage.onerror = () => reject(new Error('Failed to load image'));
        cropImage.src = objectUrl;
    });
}

function getCroppedBlob() {
    return new Promise((resolve, reject) => {
        if (!cropImage || !cropViewport) {
            reject(new Error('Crop UI not ready'));
            return;
        }
        // Compress: 600×600 JPEG @ 0.82 (same quality target as Staff Management)
        const outSize = 600;
        const jpegQuality = 0.82;
        const viewportSize = cropViewport.clientWidth || 280;
        const canvas = document.createElement('canvas');
        canvas.width = outSize;
        canvas.height = outSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            reject(new Error('Canvas unavailable'));
            return;
        }

        const displayW = cropState.naturalWidth * cropState.scale;
        const displayH = cropState.naturalHeight * cropState.scale;
        const imgLeft = (viewportSize / 2) + cropState.offsetX - (displayW / 2);
        const imgTop = (viewportSize / 2) + cropState.offsetY - (displayH / 2);
        const sx = (-imgLeft) / cropState.scale;
        const sy = (-imgTop) / cropState.scale;
        const sSize = viewportSize / cropState.scale;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outSize, outSize);
        ctx.drawImage(
            cropImage,
            sx, sy, sSize, sSize,
            0, 0, outSize, outSize
        );

        canvas.toBlob(
            (blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Could not create image'));
            },
            'image/jpeg',
            jpegQuality
        );
    });
}

function pointerDistance(a, b) {
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
}

function setupCropInteractions() {
    if (!cropViewport) return;

    cropViewport.addEventListener('pointerdown', (event) => {
        cropViewport.setPointerCapture(event.pointerId);
        cropState.pointers.set(event.pointerId, event);
        if (cropState.pointers.size === 1) {
            cropState.dragging = true;
            cropState.lastX = event.clientX;
            cropState.lastY = event.clientY;
            cropViewport.classList.add('is-dragging');
        } else if (cropState.pointers.size === 2) {
            const [p1, p2] = [...cropState.pointers.values()];
            cropState.pinchStartDist = pointerDistance(p1, p2);
            cropState.pinchStartScale = cropState.scale;
            cropState.dragging = false;
        }
    });

    cropViewport.addEventListener('pointermove', (event) => {
        if (!cropState.pointers.has(event.pointerId)) return;
        cropState.pointers.set(event.pointerId, event);

        if (cropState.pointers.size === 2) {
            const [p1, p2] = [...cropState.pointers.values()];
            const dist = pointerDistance(p1, p2);
            if (cropState.pinchStartDist > 0) {
                const next = cropState.pinchStartScale * (dist / cropState.pinchStartDist);
                const maxScale = cropState.minScale * 3;
                cropState.scale = Math.max(cropState.minScale, Math.min(maxScale, next));
                if (cropZoom) cropZoom.value = String(cropState.scale);
                updateCropTransform();
            }
            return;
        }

        if (!cropState.dragging) return;
        const dx = event.clientX - cropState.lastX;
        const dy = event.clientY - cropState.lastY;
        cropState.lastX = event.clientX;
        cropState.lastY = event.clientY;
        cropState.offsetX += dx;
        cropState.offsetY += dy;
        updateCropTransform();
    });

    const endPointer = (event) => {
        cropState.pointers.delete(event.pointerId);
        if (cropState.pointers.size < 2) {
            cropState.pinchStartDist = 0;
        }
        if (cropState.pointers.size === 0) {
            cropState.dragging = false;
            cropViewport.classList.remove('is-dragging');
        }
    };

    cropViewport.addEventListener('pointerup', endPointer);
    cropViewport.addEventListener('pointercancel', endPointer);

    if (cropZoom) {
        cropZoom.addEventListener('input', () => {
            cropState.scale = Number(cropZoom.value) || cropState.minScale;
            updateCropTransform();
        });
    }
}

async function handlePhotoFileSelected(file) {
    if (!file.type.startsWith('image/')) {
        showMessage(photoMessage, 'error', 'Please choose an image file.');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showMessage(photoMessage, 'error', 'Please choose an image smaller than 10MB.');
        return;
    }

    try {
        const objectUrl = URL.createObjectURL(file);
        await initCropFromImage(objectUrl);
        showCropStage();
    } catch (error) {
        console.error(error);
        showMessage(photoMessage, 'error', 'Could not open that image. Please try another.');
    }
}

async function uploadCroppedPhoto() {
    const employeeCode = getEmployeeCode();
    if (!employeeCode) {
        showMessage(cropMessage, 'error', 'Unable to find your staff profile. Please contact an admin.');
        return;
    }

    photoBusy = true;
    setLoading(saveCropButton, saveCropSpinner, true, 'Save photo', 'Saving...');
    hideMessage(cropMessage);

    try {
        const blob = await getCroppedBlob();
        const storageRef = ref(storage, `staff-photos/${employeeCode}`);
        const snapshot = await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
        const photoUrl = await getDownloadURL(snapshot.ref);

        await setDoc(doc(db, 'employees_v2', employeeCode), {
            photoUrl,
            photoUpdatedAt: new Date()
        }, { merge: true });

        employeeProfile = { ...(employeeProfile || { id: employeeCode }), photoUrl };
        const initials = getInitials(currentUserData?.name || 'Staff Member');
        applyAvatarToElements(photoUrl, initials);
        persistProfileCache({ photoUrl, employeeCode });
        showManageStage();
        showMessage(photoMessage, 'success', 'Profile photo updated.');
        notifyStaffProfileUpdate({
            title: 'profile photo',
            lines: ['Profile photo was replaced.']
        });
    } catch (error) {
        console.error('Photo upload failed:', error);
        showMessage(cropMessage, 'error', 'Could not save photo. Please try again.');
    } finally {
        photoBusy = false;
        setLoading(saveCropButton, saveCropSpinner, false, 'Save photo', 'Saving...');
        if (profilePhotoInput) profilePhotoInput.value = '';
    }
}

async function handlePhotoRemove() {
    const employeeCode = getEmployeeCode();
    if (!employeeCode) {
        showMessage(photoMessage, 'error', 'Unable to find your staff profile. Please contact an admin.');
        return;
    }
    if (!confirm('Remove your profile photo?')) return;

    photoBusy = true;
    if (removePhotoButton) removePhotoButton.disabled = true;
    hideMessage(photoMessage);

    try {
        try {
            await deleteObject(ref(storage, `staff-photos/${employeeCode}`));
        } catch (storageError) {
            console.warn('Storage delete skipped:', storageError);
        }

        await setDoc(doc(db, 'employees_v2', employeeCode), {
            photoUrl: null,
            photoUpdatedAt: new Date()
        }, { merge: true });

        if (employeeProfile) employeeProfile.photoUrl = null;
        const initials = getInitials(currentUserData?.name || 'Staff Member');
        applyAvatarToElements(null, initials);
        persistProfileCache({ photoUrl: null });
        showMessage(photoMessage, 'success', 'Profile photo removed.');
        notifyStaffProfileUpdate({
            title: 'profile photo',
            lines: ['Profile photo was removed.']
        });
    } catch (error) {
        console.error('Photo remove failed:', error);
        showMessage(photoMessage, 'error', 'Could not remove photo. Please try again.');
    } finally {
        photoBusy = false;
        if (removePhotoButton) removePhotoButton.disabled = false;
    }
}

async function reauthenticate(password) {
    if (!currentUser || !password) {
        throw new Error('Missing authentication information.');
    }
    const credential = EmailAuthProvider.credential(currentUser.email, password);
    await reauthenticateWithCredential(currentUser, credential);
}

async function handlePersonalInfoUpdate(event) {
    event.preventDefault();
    hideMessage(personalInfoMessage);

    const employeeCode = getEmployeeCode();
    if (!employeeCode) {
        showMessage(personalInfoMessage, 'error', 'Unable to find your staff profile. Please contact an admin.');
        return;
    }

    const email = (profileEmailInput?.value || '').trim();
    const phone = (profilePhoneInput?.value || '').trim();
    const birthday = (profileBirthdayInput?.value || '').trim();
    const previous = {
        email: String(employeeProfile?.email || '').trim(),
        phone: String(employeeProfile?.phone || '').trim(),
        birthday: normalizeBirthday(employeeProfile?.birthday)
    };

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showMessage(personalInfoMessage, 'error', 'Please enter a valid email address.');
        return;
    }

    setLoading(personalInfoSubmitButton, personalInfoSpinner, true, 'Save', 'Saving...');

    try {
        const patch = {
            email: email || null,
            phone: phone || null,
            birthday: birthday || null,
            updatedAt: new Date()
        };
        await setDoc(doc(db, 'employees_v2', employeeCode), patch, { merge: true });
        employeeProfile = { ...(employeeProfile || { id: employeeCode }), ...patch };
        populatePersonalInfoForm();
        showMessage(personalInfoMessage, 'success', 'Personal information saved.');
        const changes = [];
        if (previous.email !== email) {
            changes.push(`<strong>Email:</strong> ${escapeHtml(displayOrDash(previous.email))} → ${escapeHtml(displayOrDash(email))}`);
        }
        if (previous.phone !== phone) {
            changes.push(`<strong>Phone:</strong> ${escapeHtml(displayOrDash(previous.phone))} → ${escapeHtml(displayOrDash(phone))}`);
        }
        if (previous.birthday !== birthday) {
            changes.push(`<strong>Birthday:</strong> ${escapeHtml(displayOrDash(previous.birthday))} → ${escapeHtml(displayOrDash(birthday))}`);
        }
        if (changes.length) {
            notifyStaffProfileUpdate({ title: 'personal information', lines: changes });
        }
    } catch (error) {
        console.error('Personal info update failed:', error);
        showMessage(personalInfoMessage, 'error', 'Could not save personal information. Please try again.');
    } finally {
        setLoading(personalInfoSubmitButton, personalInfoSpinner, false, 'Save', 'Saving...');
    }
}

function getSelectedBank() {
    return paymentPreferredBankSelect?.value || 'gotyme';
}

function describeDigitRule(bankKey) {
    const config = BANK_CONFIG[bankKey];
    if (!config) return '';
    const digits = config.digits;
    if (digits.length === 1) return `${digits[0]} digits`;
    return `${digits[0]}–${digits[digits.length - 1]} digits`;
}

function maskAccountNumber(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length <= 4) return digits;
    return `${'•'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function emptyBankAccount() {
    return { accountName: '', accountNumber: '', qrUrl: '' };
}

function normalizeBankKey(employee) {
    const raw = String(employee?.preferredBank || employee?.bankName || '').trim().toLowerCase();
    if (BANK_CONFIG[raw]) return raw;
    const mode = String(employee?.transferMode || employee?.modeOfTransfer || '').trim().toLowerCase();
    if (mode.includes('gotyme')) return 'gotyme';
    if (mode.includes('bdo')) return 'bdo';
    return '';
}

function readBankAccounts(employee) {
    const result = { gotyme: emptyBankAccount(), bdo: emptyBankAccount() };
    const stored = employee?.bankAccounts || {};
    for (const key of ['gotyme', 'bdo']) {
        const slot = stored[key];
        if (slot && typeof slot === 'object') {
            result[key] = {
                accountName: String(slot.accountName || '').trim(),
                accountNumber: String(slot.accountNumber || '').replace(/\D/g, ''),
                qrUrl: String(slot.qrUrl || '').trim()
            };
        }
    }

    const legacyKey = String(employee?.bankName || '').trim().toLowerCase();
    if (BANK_CONFIG[legacyKey] && !result[legacyKey].accountNumber) {
        result[legacyKey].accountName = String(employee?.bankAccountName || '').trim();
        result[legacyKey].accountNumber = String(employee?.bankAccountNumber || '').replace(/\D/g, '');
    }
    if (!result.gotyme.qrUrl && employee?.gotymeQrUrl) {
        result.gotyme.qrUrl = String(employee.gotymeQrUrl).trim();
    }
    if (!result.bdo.qrUrl && employee?.bdoQrUrl) {
        result.bdo.qrUrl = String(employee.bdoQrUrl).trim();
    }
    return result;
}

function bankQrStoragePath(bankKey, employeeCode) {
    return `${BANK_QR_STORAGE[bankKey]}/${employeeCode}`;
}

function revokeBankQrObjectUrl(bankKey) {
    const state = qrPickerState[bankKey];
    if (state?.objectUrl) {
        URL.revokeObjectURL(state.objectUrl);
        state.objectUrl = null;
    }
}

function showBankQrPreview(bankKey, url) {
    const preview = document.getElementById(`${bankKey}QrPreview`);
    const wrap = document.getElementById(`${bankKey}QrPreviewWrap`);
    if (!preview || !wrap) return;
    if (url) {
        preview.src = url;
        wrap.style.display = 'flex';
    } else {
        preview.removeAttribute('src');
        wrap.style.display = 'none';
    }
}

function resetBankQrPicker(bankKey) {
    const state = qrPickerState[bankKey];
    if (!state) return;
    state.file = null;
    state.remove = false;
    revokeBankQrObjectUrl(bankKey);
    const input = document.getElementById(`${bankKey}QrInput`);
    if (input) input.value = '';
}

function resetAllBankQrPickers() {
    resetBankQrPicker('gotyme');
    resetBankQrPicker('bdo');
}

function setAccountHint(bankKey, state, message) {
    const hint = document.getElementById(`${bankKey}AccountHint`);
    if (!hint) return;
    hint.classList.remove('is-error', 'is-valid');
    if (state === 'error') hint.classList.add('is-error');
    if (state === 'valid') hint.classList.add('is-valid');
    hint.textContent = message || BANK_CONFIG[bankKey]?.hint || '';
}

function validateAccountNumberLive(bankKey) {
    const config = BANK_CONFIG[bankKey];
    if (!config) return;
    const input = document.getElementById(`${bankKey}AccountNumber`);
    const digits = (input?.value || '').replace(/\D/g, '');
    const required = describeDigitRule(bankKey);
    if (!digits) {
        setAccountHint(bankKey, '', config.hint);
        return;
    }
    if (config.digits.includes(digits.length)) {
        setAccountHint(bankKey, 'valid', 'Looks good.');
    } else {
        setAccountHint(bankKey, 'error', `${required} required (you have ${digits.length}).`);
    }
}

async function prepareBankQrFile(file) {
    if (!file || !file.type.startsWith('image/')) {
        throw new Error('Please choose an image of the QR code.');
    }
    if (file.size > BANK_QR_MAX_BYTES) {
        throw new Error('Please choose an image smaller than 10MB.');
    }
    if (file.size <= 1.5 * 1024 * 1024) return file;

    return new Promise((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const maxSize = 1800;
            let { width, height } = img;
            const scale = Math.min(maxSize / width, maxSize / height, 1);
            if (scale === 1 && file.size < 3 * 1024 * 1024) {
                resolve(file);
                return;
            }
            width = Math.round(width * scale);
            height = Math.round(height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(file);
                return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                resolve(blob && blob.size < file.size ? blob : file);
            }, 'image/jpeg', 0.92);
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(file);
        };
        img.src = objectUrl;
    });
}

async function uploadBankQr(bankKey, employeeCode, file) {
    const blob = await prepareBankQrFile(file);
    const snapshot = await uploadBytes(ref(storage, bankQrStoragePath(bankKey, employeeCode)), blob, {
        contentType: blob.type || 'image/jpeg'
    });
    return getDownloadURL(snapshot.ref);
}

async function deleteBankQr(bankKey, employeeCode) {
    try {
        await deleteObject(ref(storage, bankQrStoragePath(bankKey, employeeCode)));
    } catch (error) {
        console.warn(`${BANK_CONFIG[bankKey]?.label || bankKey} QR storage delete skipped:`, error);
    }
}

function bindBankQrControls(bankKey) {
    const input = document.getElementById(`${bankKey}QrInput`);
    const removeBtn = document.getElementById(`${bankKey}QrRemoveBtn`);
    const preview = document.getElementById(`${bankKey}QrPreview`);
    const numberInput = document.getElementById(`${bankKey}AccountNumber`);

    if (numberInput) {
        numberInput.addEventListener('input', () => {
            const cleaned = numberInput.value.replace(/\D/g, '');
            if (numberInput.value !== cleaned) numberInput.value = cleaned;
            validateAccountNumberLive(bankKey);
            refreshBankCardState(bankKey);
        });
    }
    const nameInput = document.getElementById(`${bankKey}AccountName`);
    if (nameInput) {
        nameInput.addEventListener('input', () => refreshBankCardState(bankKey));
    }

    if (input) {
        input.addEventListener('change', (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                showMessage(paymentMessage, 'error', `Please choose an image of your ${BANK_CONFIG[bankKey].label} QR code.`);
                input.value = '';
                return;
            }
            if (file.size > BANK_QR_MAX_BYTES) {
                showMessage(paymentMessage, 'error', 'Please choose an image smaller than 10MB.');
                input.value = '';
                return;
            }
            const state = qrPickerState[bankKey];
            state.file = file;
            state.remove = false;
            revokeBankQrObjectUrl(bankKey);
            state.objectUrl = URL.createObjectURL(file);
            showBankQrPreview(bankKey, state.objectUrl);
            hideMessage(paymentMessage);
            refreshBankCardState(bankKey);
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            const state = qrPickerState[bankKey];
            state.file = null;
            state.remove = true;
            revokeBankQrObjectUrl(bankKey);
            if (input) input.value = '';
            showBankQrPreview(bankKey, null);
            refreshBankCardState(bankKey);
        });
    }

    if (preview) {
        preview.addEventListener('click', () => {
            const url = preview.getAttribute('src');
            if (url) window.open(url, '_blank', 'noopener');
        });
    }
}

function readFilledBankAccount(bankKey) {
    const accountName = (document.getElementById(`${bankKey}AccountName`)?.value || '').trim();
    const accountNumber = (document.getElementById(`${bankKey}AccountNumber`)?.value || '').replace(/\D/g, '');
    const state = qrPickerState[bankKey];
    const existingQr = readBankAccounts(employeeProfile)[bankKey]?.qrUrl || '';
    const hasQrPending = Boolean(state.file);
    const hasQr = Boolean(state.file) || (!state.remove && existingQr);
    return { accountName, accountNumber, hasQrPending, hasQr };
}

function isBankDraftComplete(bankKey) {
    const drafted = readFilledBankAccount(bankKey);
    return Boolean(
        drafted.accountName &&
        BANK_CONFIG[bankKey].digits.includes(drafted.accountNumber.length) &&
        drafted.hasQr
    );
}

function setBankCardOpen(bankKey, isOpen) {
    const card = document.getElementById(`${bankKey}BankCard`);
    const toggle = document.querySelector(`[data-bank-toggle="${bankKey}"]`);
    if (!card) return;
    card.classList.toggle('is-open', isOpen);
    if (toggle) toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function refreshBankCardState(bankKey) {
    const card = document.getElementById(`${bankKey}BankCard`);
    if (card) card.classList.toggle('is-complete', isBankDraftComplete(bankKey));
    refreshPreferredBankVisibility();
}

function refreshPreferredBankVisibility() {
    const row = document.getElementById('paymentPreferredBankRow');
    if (!row) return;
    const bothComplete = isBankDraftComplete('gotyme') && isBankDraftComplete('bdo');
    row.hidden = !bothComplete;
}

function bindBankCardToggles() {
    document.querySelectorAll('[data-bank-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const bankKey = btn.getAttribute('data-bank-toggle');
            const card = document.getElementById(`${bankKey}BankCard`);
            setBankCardOpen(bankKey, !card?.classList.contains('is-open'));
        });
    });
}

function isSavedAccountComplete(account, bankKey) {
    const acc = account || emptyBankAccount();
    return Boolean(
        acc.accountName &&
        BANK_CONFIG[bankKey].digits.includes(acc.accountNumber.length) &&
        acc.qrUrl
    );
}

function isPaymentDetailsComplete() {
    const accounts = readBankAccounts(employeeProfile);
    return ['gotyme', 'bdo'].some((key) => isSavedAccountComplete(accounts[key], key));
}

function isPersonalInfoComplete() {
    const email = String(employeeProfile?.email || '').trim();
    const phone = String(employeeProfile?.phone || '').trim();
    const birthday = normalizeBirthday(employeeProfile?.birthday);
    return Boolean(email && phone && birthday && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function setSectionStatus(el, complete, completeLabel, incompleteLabel) {
    if (!el) return;
    el.classList.toggle('is-complete', complete);
    el.classList.toggle('is-incomplete', !complete);
    el.setAttribute('aria-label', complete ? completeLabel : incompleteLabel);
}

function refreshSectionStatuses() {
    setSectionStatus(
        document.getElementById('personalInfoStatus'),
        isPersonalInfoComplete(),
        'Personal information complete',
        'Personal information needs attention'
    );
    setSectionStatus(
        document.getElementById('paymentDetailsStatus'),
        isPaymentDetailsComplete(),
        'Payment details complete',
        'Payment details need attention'
    );
}

function updatePaymentSummary() {
    const accounts = readBankAccounts(employeeProfile);
    const parts = [];
    for (const key of ['gotyme', 'bdo']) {
        if (!accounts[key].accountNumber) continue;
        const qrNote = accounts[key].qrUrl ? ' • QR' : '';
        parts.push(`${BANK_CONFIG[key].label} • ${maskAccountNumber(accounts[key].accountNumber)}${qrNote}`);
    }
    if (paymentSummaryText) {
        paymentSummaryText.textContent = parts.length
            ? parts.join('  ·  ')
            : 'Add GoTyme and/or BDO for salary transfers.';
    }
    refreshSectionStatuses();
}

function populatePaymentForm() {
    resetAllBankQrPickers();
    const accounts = readBankAccounts(employeeProfile);
    const preferred = normalizeBankKey(employeeProfile) || 'gotyme';
    if (paymentPreferredBankSelect) paymentPreferredBankSelect.value = BANK_CONFIG[preferred] ? preferred : 'gotyme';

    for (const key of ['gotyme', 'bdo']) {
        const nameInput = document.getElementById(`${key}AccountName`);
        const numberInput = document.getElementById(`${key}AccountNumber`);
        if (nameInput) nameInput.value = accounts[key].accountName;
        if (numberInput) numberInput.value = accounts[key].accountNumber;
        showBankQrPreview(key, accounts[key].qrUrl || null);
        validateAccountNumberLive(key);
        refreshBankCardState(key);
    }

    const gotymeDone = isBankDraftComplete('gotyme');
    const bdoDone = isBankDraftComplete('bdo');
    if (!gotymeDone && !bdoDone) {
        setBankCardOpen('gotyme', true);
        setBankCardOpen('bdo', false);
    } else if (gotymeDone && bdoDone) {
        setBankCardOpen('gotyme', preferred === 'gotyme');
        setBankCardOpen('bdo', preferred === 'bdo');
    } else {
        setBankCardOpen('gotyme', !gotymeDone);
        setBankCardOpen('bdo', !bdoDone);
    }
    updatePaymentSummary();
}

async function resolveBankQrUrl(bankKey, employeeCode, existingUrl) {
    const state = qrPickerState[bankKey];
    if (state.remove && !state.file) {
        await deleteBankQr(bankKey, employeeCode);
        return null;
    }
    if (state.file) {
        return uploadBankQr(bankKey, employeeCode, state.file);
    }
    return existingUrl || null;
}

async function handlePaymentUpdate(event) {
    event.preventDefault();
    hideMessage(paymentMessage);

    const employeeCode = getEmployeeCode();
    if (!employeeCode) {
        showMessage(paymentMessage, 'error', 'Unable to find your staff profile. Please contact an admin.');
        return;
    }

    const existing = readBankAccounts(employeeProfile);
    const drafted = {};
    for (const key of ['gotyme', 'bdo']) {
        drafted[key] = readFilledBankAccount(key);
        const filled = Boolean(drafted[key].accountName || drafted[key].accountNumber || drafted[key].hasQrPending);
        if (!filled) {
            drafted[key].clear = true;
            continue;
        }
        if (!drafted[key].accountName) {
            showMessage(paymentMessage, 'error', `Please enter the ${BANK_CONFIG[key].label} account name.`);
            return;
        }
        if (!BANK_CONFIG[key].digits.includes(drafted[key].accountNumber.length)) {
            showMessage(paymentMessage, 'error', `${BANK_CONFIG[key].label} account numbers must be ${describeDigitRule(key)}.`);
            return;
        }
        if (!drafted[key].hasQr) {
            showMessage(paymentMessage, 'error', `Please add a ${BANK_CONFIG[key].label} QR code.`);
            return;
        }
    }

    const hasAny = ['gotyme', 'bdo'].some((key) => !drafted[key].clear);
    if (!hasAny) {
        showMessage(paymentMessage, 'error', 'Please add at least one account (GoTyme or BDO).');
        return;
    }

    let preferred = getSelectedBank();
    if (drafted[preferred]?.clear) {
        preferred = drafted.gotyme.clear ? 'bdo' : 'gotyme';
    }

    setLoading(paymentSubmitButton, paymentSpinner, true, 'Save', 'Saving...');

    try {
        const saved = { gotyme: emptyBankAccount(), bdo: emptyBankAccount() };
        for (const key of ['gotyme', 'bdo']) {
            if (drafted[key].clear) {
                if (existing[key].qrUrl) await deleteBankQr(key, employeeCode);
                saved[key] = emptyBankAccount();
                continue;
            }
            saved[key] = {
                accountName: drafted[key].accountName,
                accountNumber: drafted[key].accountNumber,
                qrUrl: await resolveBankQrUrl(key, employeeCode, existing[key].qrUrl)
            };
        }

        const primary = saved[preferred];
        const patch = {
            bankAccounts: {
                gotyme: saved.gotyme.accountNumber ? saved.gotyme : null,
                bdo: saved.bdo.accountNumber ? saved.bdo : null
            },
            preferredBank: preferred,
            bankName: preferred,
            bankAccountName: primary.accountName,
            bankAccountNumber: primary.accountNumber,
            transferMode: BANK_CONFIG[preferred].label,
            gotymeQrUrl: saved.gotyme.qrUrl || null,
            bdoQrUrl: saved.bdo.qrUrl || null,
            gotymeQrUpdatedAt: new Date(),
            paymentDetailsUpdatedAt: new Date(),
            updatedAt: new Date()
        };
        await setDoc(doc(db, 'employees_v2', employeeCode), patch, { merge: true });
        employeeProfile = { ...(employeeProfile || { id: employeeCode }), ...patch };
        resetAllBankQrPickers();
        populatePaymentForm();
        showMessage(paymentMessage, 'success', 'Payment details saved.');
        const preferredLabel = BANK_CONFIG[preferred]?.label || preferred;
        notifyStaffProfileUpdate({
            title: 'payment details',
            lines: [
                `<strong>Pay salary via:</strong> ${escapeHtml(preferredLabel)}`,
                formatAccountEmailLine('GoTyme', saved.gotyme),
                formatAccountEmailLine('BDO', saved.bdo)
            ]
        });
    } catch (error) {
        console.error('Payment details update failed:', error);
        showMessage(paymentMessage, 'error', 'Could not save payment details. Please try again.');
    } finally {
        setLoading(paymentSubmitButton, paymentSpinner, false, 'Save', 'Saving...');
    }
}


async function handleUsernameUpdate(event) {
    event.preventDefault();
    hideMessage(usernameMessage);

    const newUsername = (newUsernameInput?.value || '').trim();
    const password = usernameCurrentPasswordInput?.value || '';
    const previousUsername = currentUserData?.username || '';

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

    try {
        const snapshot = await getDocs(collection(db, 'adminUsers'));
        for (const docSnap of snapshot.docs) {
            if (docSnap.id === currentUser.uid) continue;
            const userData = docSnap.data();
            if (userData.username && userData.username.toLowerCase() === newUsername.toLowerCase()) {
                showMessage(usernameMessage, 'error', 'That username is already taken. Please choose another.');
                return;
            }
        }
    } catch (checkError) {
        console.warn('Could not check username uniqueness:', checkError);
    }

    setLoading(usernameSubmitButton, usernameSpinner, true, 'Save username', 'Saving...');

    try {
        await reauthenticate(password);
        await updateDoc(doc(db, 'adminUsers', currentUser.uid), {
            username: newUsername,
            updatedAt: new Date()
        });
        currentUserData = await getCurrentUserData(currentUser);
        populateUserInfo();
        if (usernameForm) usernameForm.reset();
        showMessage(usernameMessage, 'success', 'Username updated successfully.');
        notifyStaffProfileUpdate({
            title: 'username',
            lines: [`<strong>Username:</strong> ${escapeHtml(displayOrDash(previousUsername))} → ${escapeHtml(newUsername)}`]
        });
    } catch (error) {
        console.error('Username update failed:', error);
        let message = 'Could not update username. Please try again.';
        if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            message = 'Incorrect password. Please verify your current password.';
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
        if (passwordForm) passwordForm.reset();
        showMessage(passwordMessage, 'success', 'Password updated successfully.');
        notifyStaffProfileUpdate({
            title: 'password',
            lines: ['Password was changed. The new password is not included in this email.']
        });
    } catch (error) {
        console.error('Password update failed:', error);
        let message = 'Could not update password. Please try again.';
        if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            message = 'Incorrect current password. Please verify and try again.';
        } else if (error.code === 'auth/weak-password') {
            message = 'Password is too weak. Please choose at least 6 characters.';
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

// Modal openers
document.querySelectorAll('[data-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
        const modal = document.getElementById(btn.getAttribute('data-modal'));
        if (modal === personalInfoModal) {
            populatePersonalInfoForm();
            hideMessage(personalInfoMessage);
        }
        if (modal === paymentModal) {
            populatePaymentForm();
            hideMessage(paymentMessage);
        }
        if (modal === usernameModal) hideMessage(usernameMessage);
        if (modal === passwordModal) hideMessage(passwordMessage);
        openModal(modal);
    });
});

document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
        const overlay = btn.closest('.modal-overlay');
        if (overlay === photoModal) showManageStage();
        closeModal(overlay);
    });
});

document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            if (overlay === photoModal) showManageStage();
            closeModal(overlay);
        }
    });
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        if (photoModal?.classList.contains('is-open') && photoCropStage?.classList.contains('is-active')) {
            showManageStage();
            return;
        }
        closeAllModals();
    }
});

if (profileAvatarEl) {
    profileAvatarEl.addEventListener('click', () => {
        hideMessage(photoMessage);
        showManageStage();
        openModal(photoModal);
    });
}

if (choosePhotoButton && profilePhotoInput) {
    choosePhotoButton.addEventListener('click', () => {
        if (photoBusy) return;
        profilePhotoInput.click();
    });
}

if (profilePhotoInput) {
    profilePhotoInput.addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file || photoBusy) return;
        handlePhotoFileSelected(file);
    });
}

if (removePhotoButton) {
    removePhotoButton.addEventListener('click', () => {
        if (photoBusy) return;
        handlePhotoRemove();
    });
}

if (cancelCropButton) {
    cancelCropButton.addEventListener('click', () => {
        if (photoBusy) return;
        if (profilePhotoInput) profilePhotoInput.value = '';
        showManageStage();
    });
}

if (saveCropButton) {
    saveCropButton.addEventListener('click', () => {
        if (photoBusy) return;
        uploadCroppedPhoto();
    });
}

setupCropInteractions();

if (personalInfoForm) {
    personalInfoForm.addEventListener('submit', handlePersonalInfoUpdate);
}

if (usernameForm) {
    usernameForm.addEventListener('submit', handleUsernameUpdate);
}

if (passwordForm) {
    passwordForm.addEventListener('submit', handlePasswordUpdate);
}

if (paymentForm) {
    paymentForm.addEventListener('submit', handlePaymentUpdate);
}

bindBankQrControls('gotyme');
bindBankQrControls('bdo');
bindBankCardToggles();

if (signOutButton) {
    signOutButton.addEventListener('click', async () => {
        const uid = currentUser?.uid;
        const result = await signOutUser();
        if (result.success) {
            clearProfileCache(uid);
            redirectToLogin();
        } else {
            alert('Unable to sign out. Please try again.');
        }
    });
}

// Instant paint from most recent cached profile (avoids "Staff Member" flash)
try {
    let newest = null;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('staffProfileCache:')) continue;
        const cache = JSON.parse(localStorage.getItem(key));
        if (!cache) continue;
        if (!newest || (cache.updatedAt || 0) > (newest.updatedAt || 0)) {
            newest = cache;
        }
    }
    if (newest) applyCachedProfile(newest);
} catch {
    // ignore
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        redirectToLogin();
        return;
    }

    currentUser = user;

    // Paint cache for this uid immediately
    applyCachedProfile(readProfileCache(user.uid));

    try {
        currentUserData = await getCurrentUserData(user);
        if (!currentUserData) {
            showMessage(usernameMessage, 'error', 'Unable to load profile information.');
            return;
        }
        // Ensure employeeCode is resolvable even if missing on the doc
        const code = resolveEmployeeCode(user, currentUserData);
        if (code && !currentUserData.employeeCode) {
            currentUserData = { ...currentUserData, employeeCode: code };
        }
        await loadEmployeeProfile();
        populateUserInfo();
    } catch (error) {
        console.error('Error loading profile data:', error);
        showMessage(usernameMessage, 'error', 'Unable to load profile information.');
    }
});
