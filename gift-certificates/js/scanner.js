// Gift Certificate Scanner Logic
import { db } from './firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs,
    doc,
    updateDoc,
    Timestamp,
    runTransaction
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Scanner state
let scanner = null;
let currentCertificate = null;
let isScanning = false;

// DOM Elements
let scannerContainer;
let resultContainer;
let scanAgainBtn;
let claimBtn;
let scanStatus;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    scannerContainer = document.getElementById('scannerContainer');
    resultContainer = document.getElementById('resultContainer');
    scanAgainBtn = document.getElementById('scanAgainBtn');
    claimBtn = document.getElementById('claimBtn');
    scanStatus = document.getElementById('scanStatus');

    // Event listeners
    if (scanAgainBtn) {
        scanAgainBtn.addEventListener('click', resetScanner);
    }
    if (claimBtn) {
        claimBtn.addEventListener('click', claimCertificate);
    }

    // Start scanner
    startScanner();
});

// Start QR scanner
function startScanner() {
    isScanning = true;
    scanStatus.textContent = 'Point camera at QR code';

    const config = { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
    };

    scanner = new Html5Qrcode("scannerContainer");

    scanner.start(
        { facingMode: "environment" }, // Use back camera
        config,
        onScanSuccess,
        onScanFailure
    ).catch(err => {
        console.error('Scanner start error:', err);
        scanStatus.textContent = 'Camera access denied or not available';
        scanStatus.style.color = '#9b1c1c';
    });
}

// On successful scan
async function onScanSuccess(decodedText, decodedResult) {
    if (!isScanning) return;
    
    isScanning = false;
    scanStatus.textContent = 'QR code detected! Loading certificate...';

    // Stop scanner
    if (scanner && scanner.isScanning) {
        scanner.stop().then(() => {
            scanner.clear();
        }).catch(err => {
            console.error('Error stopping scanner:', err);
        });
    }

    // Look up certificate
    await lookupCertificate(decodedText);
}

// On scan failure (continuous)
function onScanFailure(error) {
    // Don't log every frame failure
}

// Look up certificate by token
async function lookupCertificate(token) {
    try {
        const q = query(
            collection(db, 'giftCertificates'),
            where('qrToken', '==', token)
        );
        
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            showError('Certificate not found. Please try scanning again.');
            return;
        }

        const docSnap = querySnapshot.docs[0];
        currentCertificate = { 
            id: docSnap.id, 
            ...docSnap.data() 
        };

        displayCertificateResult(currentCertificate);
    } catch (error) {
        console.error('Error looking up certificate:', error);
        showError('Error loading certificate. Please try again.');
    }
}

// Display certificate result
function displayCertificateResult(cert) {
    // Hide scanner
    document.getElementById('scannerSection').classList.add('is-hidden');
    document.getElementById('scannerSection').setAttribute('hidden', '');

    // Check status and expiry
    const isExpired = cert.expiryDate && new Date(cert.expiryDate) < new Date();
    const status = isExpired ? 'expired' : cert.status;

    // Populate result
    document.getElementById('resultValue').textContent = `₱${cert.value.toLocaleString()}`;
    document.getElementById('resultId').textContent = cert.certificateId;

    // Optional fields
    const givenByEl = document.getElementById('resultGivenBy');
    const givenToEl = document.getElementById('resultGivenTo');
    const descriptionEl = document.getElementById('resultDescription');
    const expiryEl = document.getElementById('resultExpiry');

    if (cert.givenBy) {
        givenByEl.textContent = `From: ${cert.givenBy}`;
        givenByEl.classList.remove('is-hidden');
        givenByEl.removeAttribute('hidden');
    } else {
        givenByEl.classList.add('is-hidden');
        givenByEl.setAttribute('hidden', '');
    }

    if (cert.givenTo) {
        givenToEl.textContent = `To: ${cert.givenTo}`;
        givenToEl.classList.remove('is-hidden');
        givenToEl.removeAttribute('hidden');
    } else {
        givenToEl.classList.add('is-hidden');
        givenToEl.setAttribute('hidden', '');
    }

    if (cert.description) {
        descriptionEl.textContent = cert.description;
        descriptionEl.classList.remove('is-hidden');
        descriptionEl.removeAttribute('hidden');
    } else {
        descriptionEl.classList.add('is-hidden');
        descriptionEl.setAttribute('hidden', '');
    }

    if (cert.expiryDate) {
        const expiryDate = new Date(cert.expiryDate);
        expiryEl.textContent = `Valid until: ${expiryDate.toLocaleDateString('en-US', { 
            month: 'long', 
            day: 'numeric', 
            year: 'numeric' 
        })}`;
        expiryEl.classList.remove('is-hidden');
        expiryEl.removeAttribute('hidden');
    } else {
        expiryEl.classList.add('is-hidden');
        expiryEl.setAttribute('hidden', '');
    }

    // Status message
    const statusMessageEl = document.getElementById('statusMessage');
    if (status === 'claimed') {
        statusMessageEl.textContent = '⚠️ This certificate has already been claimed';
        statusMessageEl.className = 'result-status status-claimed';
        statusMessageEl.classList.remove('is-hidden');
        statusMessageEl.removeAttribute('hidden');
        claimBtn.disabled = true;
        claimBtn.textContent = 'Already Claimed';
    } else if (status === 'expired') {
        statusMessageEl.textContent = '⚠️ This certificate has expired';
        statusMessageEl.className = 'result-status status-expired';
        statusMessageEl.classList.remove('is-hidden');
        statusMessageEl.removeAttribute('hidden');
        claimBtn.disabled = true;
        claimBtn.textContent = 'Expired';
    } else {
        statusMessageEl.classList.add('is-hidden');
        statusMessageEl.setAttribute('hidden', '');
        claimBtn.disabled = false;
        claimBtn.textContent = 'Claim Certificate';
    }

    // Show result
    resultContainer.classList.remove('is-hidden');
    resultContainer.removeAttribute('hidden');
}

// Claim certificate
async function claimCertificate() {
    if (!currentCertificate) return;

    const originalText = claimBtn.textContent;
    claimBtn.textContent = 'Claiming...';
    claimBtn.disabled = true;

    try {
        const certRef = doc(db, 'giftCertificates', currentCertificate.id);

        // Use transaction to prevent double-claiming
        await runTransaction(db, async (transaction) => {
            const certDoc = await transaction.get(certRef);
            
            if (!certDoc.exists()) {
                throw new Error('Certificate not found');
            }

            const cert = certDoc.data();

            // Check if already claimed
            if (cert.status === 'claimed') {
                throw new Error('Certificate has already been claimed');
            }

            // Check expiry
            if (cert.expiryDate && new Date(cert.expiryDate) < new Date()) {
                throw new Error('Certificate has expired');
            }

            // Update to claimed
            transaction.update(certRef, {
                status: 'claimed',
                claimedAt: Timestamp.now(),
                claimedBy: 'scanner-app' // TODO: Add device/location info
            });
        });

        // Show success
        showSuccess();
    } catch (error) {
        console.error('Error claiming certificate:', error);
        claimBtn.textContent = originalText;
        claimBtn.disabled = false;
        
        const statusMessageEl = document.getElementById('statusMessage');
        statusMessageEl.textContent = `❌ ${error.message}`;
        statusMessageEl.className = 'result-status status-error';
        statusMessageEl.classList.remove('is-hidden');
        statusMessageEl.removeAttribute('hidden');
    }
}

// Show success
function showSuccess() {
    // Hide claim button
    claimBtn.style.display = 'none';

    // Show success message
    const statusMessageEl = document.getElementById('statusMessage');
    statusMessageEl.textContent = '✅ Certificate claimed successfully!';
    statusMessageEl.className = 'result-status status-success';
    statusMessageEl.classList.remove('is-hidden');
    statusMessageEl.removeAttribute('hidden');

    // Update scan again button text
    scanAgainBtn.textContent = 'Scan Another Certificate';

    // Add confetti effect
    createConfetti();
}

// Show error
function showError(message) {
    scanStatus.textContent = message;
    scanStatus.style.color = '#9b1c1c';
    
    setTimeout(() => {
        resetScanner();
    }, 2000);
}

// Reset scanner
function resetScanner() {
    // Reset state
    currentCertificate = null;
    isScanning = false;

    // Hide result
    resultContainer.classList.add('is-hidden');
    resultContainer.setAttribute('hidden', '');

    // Show scanner
    document.getElementById('scannerSection').classList.remove('is-hidden');
    document.getElementById('scannerSection').removeAttribute('hidden');

    // Restart scanner
    scanStatus.textContent = 'Point camera at QR code';
    scanStatus.style.color = 'var(--gc-muted)';
    startScanner();
}

// Simple confetti effect
function createConfetti() {
    const colors = ['#2b9348', '#1f7a38', '#d7efdb', '#b9dfc0'];
    const confettiCount = 30;

    for (let i = 0; i < confettiCount; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDelay = Math.random() * 0.3 + 's';
        confetti.style.animationDuration = Math.random() * 2 + 2 + 's';
        document.body.appendChild(confetti);

        setTimeout(() => confetti.remove(), 4000);
    }
}
