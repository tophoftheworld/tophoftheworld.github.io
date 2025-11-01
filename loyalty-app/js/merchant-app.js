// Merchant App JavaScript
import { db, collection, addDoc, updateDoc, doc, getDocs, query, where, orderBy, limit, setDoc, getDoc, deleteDoc } from '../firebase-config.js';
import { 
    isValidCustomerId, 
    normalizePhoneNumber, 
    isValidPhoneNumber,
    createCustomerData
} from './customer-id-utils.js';

// App state
let selectedQuantity = 0;
let currentCustomer = null;
let scannerInstance = null;
let scannerRunning = false;

// DOM elements
const quantityBtns = document.querySelectorAll('.quantity-btn');
const modalQuantityBtns = document.querySelectorAll('.modal-quantity-btn');
const pageQuantityBtns = document.querySelectorAll('.page-quantity-btn');
const lookupBtn = document.getElementById('lookupBtn');
let phoneInputComponent = null;
const scanQRBtn = document.getElementById('scanQRBtn');
const enterPhoneBtn = document.getElementById('enterPhoneBtn');
const backFromPhoneBtn = document.getElementById('backFromPhoneBtn');
const cancelPhoneBtn = document.getElementById('cancelPhoneBtn');
const addStampsBtn = document.getElementById('addStampsBtn');
const modalAddStampsBtn = document.getElementById('modalAddStampsBtn');
const pageAddStampsBtn = document.getElementById('pageAddStampsBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const pageCancelBtn = document.getElementById('pageCancelBtn');
const backToHomeBtn = document.getElementById('backToHomeBtn');
const closeTransactionModalBtn = document.getElementById('closeTransactionModalBtn');
const transactionModal = document.getElementById('transactionModal');
const transactionPage = document.getElementById('transactionPage');
const phoneInputScreen = document.getElementById('phoneInputScreen');
const modalCustomerPhone = document.getElementById('modalCustomerPhone');
const modalCurrentStamps = document.getElementById('modalCurrentStamps');
const pageCustomerPhone = document.getElementById('pageCustomerPhone');
const pageCurrentStamps = document.getElementById('pageCurrentStamps');
const modalSelectedQuantity = document.getElementById('modalSelectedQuantity');
const modalSelectedQuantityDisplay = document.getElementById('modalSelectedQuantityDisplay');
const pageSelectedQuantity = document.getElementById('pageSelectedQuantity');
const pageSelectedQuantityDisplay = document.getElementById('pageSelectedQuantityDisplay');
const newTransactionBtn = document.getElementById('newTransactionBtn');
const scannerModal = document.getElementById('scannerModal');
const closeScannerBtn = document.getElementById('closeScannerBtn');
const successOverlay = document.getElementById('successOverlay');
const qrReader = document.getElementById('qr-reader');
const transactionsList = document.getElementById('transactionsList');

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    loadRecentTransactions();
});

// Setup event listeners
function setupEventListeners() {
    // Page quantity buttons
    pageQuantityBtns.forEach(btn => {
        btn.addEventListener('click', () => selectQuantity(parseInt(btn.dataset.quantity)));
    });

    // Lookup button
    lookupBtn.addEventListener('click', lookupCustomer);

    // Main action buttons
    scanQRBtn.addEventListener('click', openScanner);
    enterPhoneBtn.addEventListener('click', openPhoneInput);

    // Phone input screen buttons
    backFromPhoneBtn.addEventListener('click', closePhoneInput);
    cancelPhoneBtn.addEventListener('click', closePhoneInput);

    // Page buttons
    pageAddStampsBtn.addEventListener('click', addStamps);
    pageCancelBtn.addEventListener('click', closeTransactionPage);
    backToHomeBtn.addEventListener('click', closeTransactionPage);

    // Scanner controls
    closeScannerBtn.addEventListener('click', closeScanner);
}

// Select quantity
function selectQuantity(quantity) {
    selectedQuantity = quantity;
    
    // Update page button states
    pageQuantityBtns.forEach(btn => {
        btn.classList.remove('selected');
        if (parseInt(btn.dataset.quantity) === quantity) {
            btn.classList.add('selected');
        }
    });

    // Show selected quantity display
    pageSelectedQuantity.textContent = selectedQuantity;
    pageSelectedQuantityDisplay.classList.remove('hidden');

    updateAddStampsButton();
}

// Enhanced customer lookup function
async function findCustomerByIdentifier(identifier) {
    try {
        // First try to find by customerId if it looks like one
        if (isValidCustomerId(identifier)) {
            const customerQuery = query(collection(db, 'customers'), where('customerId', '==', identifier));
            const customerSnapshot = await getDocs(customerQuery);
            
            if (!customerSnapshot.empty) {
                return customerSnapshot.docs[0];
            }
        }
        
        // Fallback: try to find by phone number
        const normalizedPhone = normalizePhoneNumber(identifier);
        if (normalizedPhone && isValidPhoneNumber(normalizedPhone)) {
            const phoneQuery = query(collection(db, 'customers'), where('phone', '==', normalizedPhone));
            const phoneSnapshot = await getDocs(phoneQuery);
            
            if (!phoneSnapshot.empty) {
                return phoneSnapshot.docs[0];
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error finding customer:', error);
        return null;
    }
}

// Lookup customer by phone
async function lookupCustomer() {
    if (!phoneInputComponent || !phoneInputComponent.isComplete()) {
        showToast('Please enter a complete phone number');
        return;
    }
    
    const phone = phoneInputComponent.getValue();

    console.log('Looking up customer with phone:', phone);

    try {
        const customerDoc = await findCustomerByIdentifier(phone);

        if (customerDoc) {
            const customerData = customerDoc.data();
            currentCustomer = {
                id: customerDoc.id,
                ...customerData
            };
            closePhoneInput();
            displayCustomerInfo();
            showToast('Customer found!');
        } else {
            // Create new customer
            await createNewCustomer(phone);
        }
    } catch (error) {
        console.error('Error looking up customer:', error);
        showToast('Error looking up customer. Please try again.');
    }
}

// Create new customer
async function createNewCustomer(phone) {
    try {
        const customerData = await createCustomerData(phone, 'Customer');

        const docRef = await addDoc(collection(db, 'customers'), customerData);
        currentCustomer = {
            id: docRef.id,
            ...customerData
        };
        closeScanner();
        displayCustomerInfo();
        showToast('New customer created!');
    } catch (error) {
        console.error('Error creating customer:', error);
        showToast('Error creating customer. Please try again.');
    }
}

// Display customer info in page
function displayCustomerInfo() {
    if (!currentCustomer) return;

    const stampCount = Object.keys(currentCustomer.stamps || {}).length;
    
    // Update customer name display if available
    const customerNameElement = document.getElementById('pageCustomerName');
    if (customerNameElement) {
        customerNameElement.textContent = currentCustomer.name || 'Unknown';
    }
    
    pageCustomerPhone.textContent = currentCustomer.phone;
    pageCurrentStamps.textContent = `${stampCount} stamps`;
    
    // Reset quantity selection
    selectedQuantity = 0;
    pageQuantityBtns.forEach(btn => btn.classList.remove('selected'));
    pageSelectedQuantityDisplay.classList.add('hidden');
    
    // Show page
    transactionPage.classList.remove('hidden');
    
    updateAddStampsButton();
}

// Update add stamps button
function updateAddStampsButton() {
    if (!currentCustomer || selectedQuantity === 0) {
        pageAddStampsBtn.disabled = true;
        pageAddStampsBtn.textContent = 'Add Stamps';
        return;
    }

    pageAddStampsBtn.disabled = false;
    pageAddStampsBtn.textContent = `Add ${selectedQuantity} Stamp${selectedQuantity > 1 ? 's' : ''}`;
}

// Add stamps to customer
async function addStamps() {
    if (!currentCustomer || selectedQuantity === 0) return;

    try {
        const currentStampCount = Object.keys(currentCustomer.stamps || {}).length;
        const newStamps = { ...currentCustomer.stamps };

        // Add new stamps
        for (let i = 1; i <= selectedQuantity; i++) {
            const stampNumber = currentStampCount + i;
            newStamps[stampNumber] = true;
        }

        // Update customer in Firebase
        await updateDoc(doc(db, 'customers', currentCustomer.id), {
            stamps: newStamps
        });

        // Record transaction
        await addDoc(collection(db, 'transactions'), {
            customerId: currentCustomer.customerId || currentCustomer.id,
            customerPhone: currentCustomer.phone,
            customerName: currentCustomer.name || 'Unknown',
            quantity: selectedQuantity,
            timestamp: new Date(),
            staffDevice: navigator.userAgent
        });

        // Update local state
        currentCustomer.stamps = newStamps;

        // Close page and reset
        closeTransactionPage();

        showToast(`Added ${selectedQuantity} stamp${selectedQuantity > 1 ? 's' : ''} successfully!`);
        
        // Check if reward unlocked (every 5 stamps = 1 level)
        const newStampCount = Object.keys(newStamps).length;
        if (newStampCount % 5 === 0) {
            const level = newStampCount / 5;
            showToast(`🎉 Customer reached Level ${level}! 🎉`);
        }

        // Reload transactions
        loadRecentTransactions();

        // Reset UI after successful transaction
        setTimeout(() => {
            resetTransactionUI();
        }, 3000);

    } catch (error) {
        console.error('Error adding stamps:', error);
        showToast('Error adding stamps. Please try again.');
    }
}

// Close transaction page
function closeTransactionPage() {
    transactionPage.classList.add('hidden');
    resetTransactionUI();
}

// Reset transaction UI
function resetTransactionUI() {
    currentCustomer = null;
    selectedQuantity = 0;
    
    // Reset quantity selection
    pageQuantityBtns.forEach(btn => btn.classList.remove('selected'));
    pageSelectedQuantityDisplay.classList.add('hidden');
    
    // Clear phone inputs
    clearPhoneInputs();
    
    updateAddStampsButton();
}

// Open QR scanner
async function openScanner() {
    scannerModal.classList.remove('hidden');
    
    // Reset scanner status
    const scannerStatus = document.getElementById('scannerStatus');
    scannerStatus.textContent = 'Position QR code within the frame';
    
    if (!scannerInstance) {
        scannerInstance = new Html5Qrcode('qr-reader');
    }

    try {
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            rememberLastUsedCamera: true
        };

        await scannerInstance.start(
            { facingMode: "environment" },
            config,
            onQRScanSuccess,
            onQRScanError
        );
        scannerRunning = true;
    } catch (error) {
        console.error('Scanner start error:', error);
        showToast('Error starting scanner. Please try again.');
    }
}

// Open phone input screen
function openPhoneInput() {
    phoneInputScreen.classList.remove('hidden');
    
    // Initialize phone input component if not already done
    if (!phoneInputComponent) {
        phoneInputComponent = new PhoneInputComponent('phoneInputContainer', {
            placeholder: 'Enter customer phone number',
            onComplete: () => {
                lookupBtn.disabled = false;
            },
            onChange: (value) => {
                lookupBtn.disabled = !phoneInputComponent.isComplete();
            }
        });
    } else {
        phoneInputComponent.clear();
    }
}

// Close phone input screen
function closePhoneInput() {
    phoneInputScreen.classList.add('hidden');
    if (phoneInputComponent) {
        phoneInputComponent.clear();
    }
}

// Close QR scanner
async function closeScanner() {
    scannerModal.classList.add('hidden');
    successOverlay.classList.add('hidden');

    if (scannerInstance && scannerRunning) {
        try {
            await scannerInstance.stop();
            scannerRunning = false;
        } catch (error) {
            console.error('Scanner stop error:', error);
        }
    }
}

// QR scan success
async function onQRScanSuccess(decodedText) {
    try {
        const qrData = JSON.parse(decodedText);
        
        if (qrData.type === 'customer') {
            // Update scanner status
            const scannerStatus = document.getElementById('scannerStatus');
            scannerStatus.textContent = 'Customer found! Processing...';
            
            // Show success overlay
            successOverlay.classList.remove('hidden');
            
            let customerDoc = null;
            
            // Try to find customer by customerId first (new system)
            if (qrData.customerId) {
                customerDoc = await findCustomerByIdentifier(qrData.customerId);
            }
            
            // Fallback: try phone number (backward compatibility)
            if (!customerDoc && qrData.phone) {
                const normalizedPhone = normalizePhoneNumber(qrData.phone);
                customerDoc = await findCustomerByIdentifier(normalizedPhone);
            }

            if (customerDoc) {
                const customerData = customerDoc.data();
                currentCustomer = {
                    id: customerDoc.id,
                    ...customerData
                };
                
                // Close scanner after 2 seconds
                setTimeout(() => {
                    closeScanner();
                    displayCustomerInfo();
                    showToast('Customer found!');
                }, 2000);
            } else {
                showToast('Customer not found. Please try again.');
                closeScanner();
            }
        } else {
            showToast('Invalid QR code. Please try again.');
            closeScanner();
        }
    } catch (error) {
        console.error('Error processing QR code:', error);
        showToast('Error processing QR code. Please try again.');
        closeScanner();
    }
}

// QR scan error
function onQRScanError(error) {
    // Ignore errors during scanning
}

// Load recent transactions
async function loadRecentTransactions() {
    try {
        const transactionsQuery = query(
            collection(db, 'transactions'),
            orderBy('timestamp', 'desc'),
            limit(5)
        );
        const transactionsSnapshot = await getDocs(transactionsQuery);

        if (transactionsSnapshot.empty) {
            transactionsList.innerHTML = '<div class="text-center text-gray-500 text-sm py-4">No recent transactions</div>';
            return;
        }

        let transactionsHTML = '';
        transactionsSnapshot.forEach(doc => {
            const data = doc.data();
            // Handle both Firestore Timestamp and regular Date objects
            const timestamp = data.timestamp?.toDate ? data.timestamp.toDate() : data.timestamp;
            const time = new Date(timestamp).toLocaleTimeString();
            const customerName = data.customerName || 'Unknown';
            const customerPhone = data.customerPhone || 'N/A';
            
            transactionsHTML += `
                <div class="customer-card p-3">
                    <div class="flex justify-between items-center">
                        <div>
                            <div class="font-medium text-gray-900">${customerName}</div>
                            <div class="text-sm text-gray-500">${customerPhone} • ${time}</div>
                        </div>
                        <div class="text-green-600 font-semibold">+${data.quantity}</div>
                    </div>
                </div>
            `;
        });

        transactionsList.innerHTML = transactionsHTML;
    } catch (error) {
        console.error('Error loading transactions:', error);
    }
}

// Show toast
function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, duration);
}

// Clear phone inputs
function clearPhoneInputs() {
    if (phoneInputComponent) {
        phoneInputComponent.clear();
    }
}
