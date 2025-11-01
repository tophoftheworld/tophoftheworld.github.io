// Customer App JavaScript
import { db, collection, addDoc, updateDoc, doc, getDocs, query, where, orderBy, limit, setDoc, getDoc, deleteDoc } from '../firebase-config.js';
import { 
    generateCustomerId, 
    isValidCustomerId, 
    normalizePhoneNumber, 
    isValidPhoneNumber,
    createCustomerData,
    getOrCreateCustomerId,
    clearCustomerData,
    saveCustomerData
} from './customer-id-utils.js';
import { 
    sendVerificationCode, 
    verifyPhoneCode, 
    isPhoneVerified 
} from './phone-verification.js';

// DOM elements
const stampGrid = document.getElementById('stampGrid');
const rewardMessage = document.getElementById('rewardMessage');
const qrModal = document.getElementById('qrModal');
const qrCode = document.getElementById('qrCode');
const showQRBtn = document.getElementById('showQRBtn');

// Customer data
let customerId = null; // Will be set async
let customerPhoneNumber = localStorage.getItem('customerPhone') || '+63 912 345 6789';
let stamps = {};
let currentMaxStamps = 25; // Start with 25 stamps (5 levels)
let currentCustomer = null;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    loadCustomerData();
    generateStampGrid();
    updateProgress();
    setupEventListeners();
    loadUserProfile();
});

// Setup event listeners
function setupEventListeners() {
    showQRBtn.addEventListener('click', showQRModal);
    
    // Profile screen buttons
    document.getElementById('homeTabBtn').addEventListener('click', showHomeScreen);
    document.getElementById('profileTabBtn').addEventListener('click', showProfileScreen);
    document.getElementById('backFromProfileBtn').addEventListener('click', showHomeScreen);
    document.getElementById('editProfileBtn').addEventListener('click', showEditProfile);
    document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
    document.getElementById('cancelEditBtn').addEventListener('click', hideEditProfile);
    
    // Phone verification buttons
    document.getElementById('verifyCodeBtn').addEventListener('click', verifyPhoneCodeHandler);
    document.getElementById('resendCodeBtn').addEventListener('click', resendVerificationCode);
    
    // Add scroll listener for infinite generation
    const stampsContainer = document.querySelector('.overflow-y-auto');
    stampsContainer.addEventListener('scroll', handleScroll);
}

// Load customer data
async function loadCustomerData() {
    try {
        // Get or create customer ID
        customerId = await getOrCreateCustomerId();
        
        // Try to load by customerId
        const customerQuery = query(collection(db, 'customers'), where('customerId', '==', customerId));
        const customerSnapshot = await getDocs(customerQuery);
        
        if (!customerSnapshot.empty) {
            const customerData = customerSnapshot.docs[0].data();
            currentCustomer = {
                id: customerSnapshot.docs[0].id,
                ...customerData
            };
            stamps = customerData.stamps || {};
            customerPhoneNumber = customerData.phone;
            
            // Update localStorage with current phone
            localStorage.setItem('customerPhone', customerPhoneNumber);
        } else {
            // Create new customer if not found
            await createNewCustomer();
            stamps = {};
        }
        
        updateProgress();
        generateStampGrid();
    } catch (error) {
        console.error('Error loading customer data:', error);
        showToast('Error loading data. Please try again.');
        // Fallback to empty stamps
        stamps = {};
        updateProgress();
        generateStampGrid();
    }
}


// Create new customer
async function createNewCustomer() {
    try {
        const customerData = await createCustomerData(customerPhoneNumber, 'Customer');
        
        const docRef = await addDoc(collection(db, 'customers'), customerData);
        currentCustomer = {
            id: docRef.id,
            ...customerData
        };
        stamps = {};
        saveCustomerData(customerData);
        showToast('Welcome! Your account has been created.');
    } catch (error) {
        console.error('Error creating customer:', error);
        showToast('Error creating account. Please try again.');
    }
}

// Generate stamp grid
function generateStampGrid() {
    stampGrid.innerHTML = '';
    generateStampsUpTo(currentMaxStamps);
}

// Generate stamps up to a certain number
function generateStampsUpTo(maxStamps) {
    const currentStamps = stampGrid.children.length;
    
    for (let i = currentStamps + 1; i <= maxStamps; i++) {
        const collected = !!stamps[i];
        const isMilestone = i % 5 === 0;
        
        const stampRow = document.createElement('div');
        stampRow.className = 'stamp-row';
        
        // Create stamp container to keep stamp centered
        const stampContainer = document.createElement('div');
        stampContainer.className = 'stamp-container';
        
        // Create stamp circle
        const stampCircle = document.createElement('div');
        const isLatestCollected = collected && i === Math.max(...Object.keys(stamps).map(Number));
        stampCircle.className = `stamp-circle ${collected ? 'completed' : ''} ${isLatestCollected ? 'current' : ''}`;
        
        stampCircle.innerHTML = `
            <img src="images/matchanese.png" alt="Matchanese" class="${collected ? 'opacity-100' : 'opacity-40'}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
            <span class="px-3 leading-tight" style="display: none;">Matchanese</span>
        `;
        
        stampContainer.appendChild(stampCircle);
        
        // Add connection line to next stamp
        if (i < maxStamps) {
            const connectionLine = document.createElement('div');
            const isLatestCollected = collected && i === Math.max(...Object.keys(stamps).map(Number));
            // Only make line green if this stamp is collected AND it's not the latest collected
            const shouldBeGreen = collected && !isLatestCollected;
            connectionLine.className = `connection-line ${shouldBeGreen ? 'completed' : ''}`;
            connectionLine.style.height = '20px';
            connectionLine.style.top = '100%';
            stampContainer.appendChild(connectionLine);
        }
        
        stampRow.appendChild(stampContainer);
        
        // Add level marker on the right for every 5th stamp
        if (isMilestone) {
            const levelMarker = document.createElement('div');
            levelMarker.className = 'level-marker';
            levelMarker.textContent = `Level ${i / 5}`;
            levelMarker.style.position = 'absolute';
            levelMarker.style.right = '20px';
            stampRow.appendChild(levelMarker);
        }
        
        stampGrid.appendChild(stampRow);
    }
}

// Update progress
function updateProgress() {
    const collected = Object.keys(stamps).length;
    const currentLevel = Math.ceil(collected / 5);
    
    // Update header
    document.getElementById('currentLevel').textContent = currentLevel;
    document.getElementById('totalStamps').textContent = collected;
    
    // Show reward if all stamps collected
    if (collected === currentMaxStamps) {
        showReward();
    }
}

// Show reward
function showReward() {
    rewardMessage.classList.remove('hidden');
    showToast('🎉 Congratulations! You earned a free drink! 🎉');
}

// Show QR modal
function showQRModal() {
    qrCode.innerHTML = '';
    const qr = new QRCode(qrCode, {
        text: JSON.stringify({
            type: 'customer',
            customerId: customerId,
            phone: customerPhoneNumber, // Keep phone for backward compatibility
            timestamp: Date.now()
        }),
        width: 200,
        height: 200,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
    });
    
    qrModal.classList.remove('hidden');
}

// Close QR modal
function closeQRModal() {
    qrModal.classList.add('hidden');
}

// Close QR modal when clicking outside
qrModal.addEventListener('click', function(e) {
    if (e.target === qrModal) {
        closeQRModal();
    }
});

// Make closeQRModal available globally
window.closeQRModal = closeQRModal;

// Close reward
function closeReward() {
    rewardMessage.classList.add('hidden');
}

// User profile functionality
let userProfile = {
    name: 'Customer',
    phone: '+63 000 000 0000'
};
let editPhoneInput = null;
let pendingPhoneVerification = null;

function loadUserProfile() {
    // Load from localStorage or set defaults
    const savedProfile = localStorage.getItem('userProfile');
    if (savedProfile) {
        userProfile = JSON.parse(savedProfile);
    }
    updateUserProfileDisplay();
}

function updateUserProfileDisplay() {
    document.getElementById('userProfileName').textContent = userProfile.name;
    document.getElementById('userProfilePhone').textContent = userProfile.phone;
}

function showHomeScreen() {
    document.getElementById('profileScreen').classList.add('hidden');
}

function showProfileScreen() {
    document.getElementById('profileScreen').classList.remove('hidden');
    updateUserProfileDisplay();
}

function showEditProfile() {
    document.getElementById('editProfileForm').classList.remove('hidden');
    document.getElementById('editNameInput').value = userProfile.name;
    
    // Initialize phone input component
    if (!editPhoneInput) {
        editPhoneInput = new PhoneInputComponent('editPhoneContainer', {
            placeholder: 'Enter your phone number',
            onComplete: () => {},
            onChange: () => {}
        });
    }
    editPhoneInput.setValue(userProfile.phone);
}

function hideEditProfile() {
    document.getElementById('editProfileForm').classList.add('hidden');
    document.getElementById('phoneVerificationSection').classList.add('hidden');
    pendingPhoneVerification = null;
}

async function saveProfile() {
    const newName = document.getElementById('editNameInput').value.trim();
    const newPhone = editPhoneInput ? editPhoneInput.getValue() : userProfile.phone;

    if (!newName) {
        showToast('Please enter a name');
        return;
    }

    if (!editPhoneInput || !editPhoneInput.isComplete()) {
        showToast('Please enter a complete phone number');
        return;
    }

    // Validate phone number format
    const normalizedPhone = normalizePhoneNumber(newPhone);
    if (!isValidPhoneNumber(normalizedPhone)) {
        showToast('Please enter a valid phone number');
        return;
    }

    try {
        // Check if phone number is being changed
        const isPhoneChanging = normalizedPhone !== customerPhoneNumber;
        
        if (isPhoneChanging) {
            // Check if new phone number already exists
            const existingPhoneQuery = query(collection(db, 'customers'), where('phone', '==', normalizedPhone));
            const existingPhoneSnapshot = await getDocs(existingPhoneQuery);
            
            if (!existingPhoneSnapshot.empty) {
                showToast('This phone number is already registered to another account');
                return;
            }
            
            // Start phone verification process
            const verificationResult = await sendVerificationCode(normalizedPhone, customerId);
            
            if (!verificationResult.success) {
                showToast(verificationResult.message);
                return;
            }
            
            // Show verification section
            pendingPhoneVerification = {
                phone: normalizedPhone,
                name: newName
            };
            
            document.getElementById('phoneVerificationSection').classList.remove('hidden');
            showToast('Verification code sent to your phone');
            
            // For demo purposes, show the code
            if (verificationResult.demoCode) {
                showToast(`Demo code: ${verificationResult.demoCode}`, 10000);
            }
            
            return; // Don't save yet, wait for verification
        }

        // Update Firebase customer record using customerId
        if (currentCustomer && currentCustomer.id) {
            await updateDoc(doc(db, 'customers', currentCustomer.id), {
                name: newName,
                phone: normalizedPhone,
                isPhoneVerified: !isPhoneChanging, // Reset verification if phone changed
                updatedAt: new Date()
            });
        } else {
            // Fallback: find by customerId
            const customerQuery = query(collection(db, 'customers'), where('customerId', '==', customerId));
            const customerSnapshot = await getDocs(customerQuery);
            
            if (!customerSnapshot.empty) {
                const customerDoc = customerSnapshot.docs[0];
                await updateDoc(doc(db, 'customers', customerDoc.id), {
                    name: newName,
                    phone: normalizedPhone,
                    isPhoneVerified: !isPhoneChanging,
                    updatedAt: new Date()
                });
            }
        }

        // Update local variables
        customerPhoneNumber = normalizedPhone;
        userProfile.name = newName;
        userProfile.phone = normalizedPhone;

        // Save to localStorage
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        localStorage.setItem('customerPhone', normalizedPhone);

        // Update display
        updateUserProfileDisplay();
        hideEditProfile();

        if (isPhoneChanging) {
            showToast('Profile updated! Please verify your new phone number when making your next purchase.');
        } else {
            showToast('Profile updated successfully!');
        }
    } catch (error) {
        console.error('Error updating profile:', error);
        showToast('Error updating profile. Please try again.');
    }
}

function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, duration);
}

// Handle scroll for infinite generation
function handleScroll() {
    const stampsContainer = document.querySelector('.overflow-y-auto');
    const scrollTop = stampsContainer.scrollTop;
    const scrollHeight = stampsContainer.scrollHeight;
    const clientHeight = stampsContainer.clientHeight;
    
    // If scrolled near bottom, generate more stamps
    if (scrollTop + clientHeight >= scrollHeight - 200) {
        const newMaxStamps = currentMaxStamps + 25; // Add 25 more stamps (5 more levels)
        generateStampsUpTo(newMaxStamps);
        currentMaxStamps = newMaxStamps;
    }
}

// Listen for stamp updates from staff
async function listenForStampUpdates() {
    try {
        // Use customerId as primary lookup method
        const customerQuery = query(collection(db, 'customers'), where('customerId', '==', customerId));
        const customerSnapshot = await getDocs(customerQuery);
        
        if (!customerSnapshot.empty) {
            const customerData = customerSnapshot.docs[0].data();
            if (JSON.stringify(customerData.stamps) !== JSON.stringify(stamps)) {
                stamps = customerData.stamps || {};
                updateProgress();
                generateStampGrid();
                showToast('Stamps updated! 🎉');
            }
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
    }
}

// Check for updates every 5 seconds
setInterval(listenForStampUpdates, 5000);

// Phone verification functions
async function verifyPhoneCodeHandler() {
    const code = document.getElementById('verificationCodeInput').value.trim();
    
    if (!code || code.length !== 6) {
        showToast('Please enter a valid 6-digit code');
        return;
    }
    
    if (!pendingPhoneVerification) {
        showToast('No pending verification');
        return;
    }
    
    try {
        const result = await verifyPhoneCode(pendingPhoneVerification.phone, code, customerId);
        
        if (result.success) {
            // Verification successful, now save the profile
            await completeProfileUpdate(pendingPhoneVerification.name, pendingPhoneVerification.phone);
            
            // Hide verification section
            document.getElementById('phoneVerificationSection').classList.add('hidden');
            pendingPhoneVerification = null;
            
            showToast('Phone verified and profile updated successfully!');
        } else {
            showToast(result.message);
        }
    } catch (error) {
        console.error('Error verifying phone code:', error);
        showToast('Error verifying phone code. Please try again.');
    }
}

async function resendVerificationCode() {
    if (!pendingPhoneVerification) {
        showToast('No pending verification');
        return;
    }
    
    try {
        const result = await sendVerificationCode(pendingPhoneVerification.phone, customerId);
        
        if (result.success) {
            showToast('Verification code resent to your phone');
            
            // For demo purposes, show the code
            if (result.demoCode) {
                showToast(`Demo code: ${result.demoCode}`, 10000);
            }
        } else {
            showToast(result.message);
        }
    } catch (error) {
        console.error('Error resending verification code:', error);
        showToast('Error resending verification code. Please try again.');
    }
}

async function completeProfileUpdate(newName, newPhone) {
    try {
        // Update Firebase customer record using customerId
        if (currentCustomer && currentCustomer.id) {
            await updateDoc(doc(db, 'customers', currentCustomer.id), {
                name: newName,
                phone: newPhone,
                isPhoneVerified: true,
                phoneVerifiedAt: new Date(),
                updatedAt: new Date()
            });
        } else {
            // Fallback: find by customerId
            const customerQuery = query(collection(db, 'customers'), where('customerId', '==', customerId));
            const customerSnapshot = await getDocs(customerQuery);
            
            if (!customerSnapshot.empty) {
                const customerDoc = customerSnapshot.docs[0];
                await updateDoc(doc(db, 'customers', customerDoc.id), {
                    name: newName,
                    phone: newPhone,
                    isPhoneVerified: true,
                    phoneVerifiedAt: new Date(),
                    updatedAt: new Date()
                });
            }
        }

        // Update local variables
        customerPhoneNumber = newPhone;
        userProfile.name = newName;
        userProfile.phone = newPhone;

        // Save to localStorage
        localStorage.setItem('userProfile', JSON.stringify(userProfile));
        localStorage.setItem('customerPhone', newPhone);

        // Update display
        updateUserProfileDisplay();
        hideEditProfile();
        
    } catch (error) {
        console.error('Error updating profile:', error);
        showToast('Error updating profile. Please try again.');
    }
}
