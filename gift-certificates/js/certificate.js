// Gift Certificate Display Logic
import { db } from './firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// DOM Elements
let certificateContainer;
let loadingScreen;
let errorScreen;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    certificateContainer = document.getElementById('certificateContainer');
    loadingScreen = document.getElementById('loadingScreen');
    errorScreen = document.getElementById('errorScreen');

    await loadCertificate();
});

// Load certificate from URL parameters
async function loadCertificate() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const id = urlParams.get('id');
        const token = urlParams.get('token');

        if (!id && !token) {
            showError('No certificate specified');
            return;
        }

        let certificate = null;

        if (id) {
            // Load by document ID
            const docRef = doc(db, 'giftCertificates', id);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                certificate = { id: docSnap.id, ...docSnap.data() };
            }
        } else if (token) {
            // Load by QR token
            const q = query(
                collection(db, 'giftCertificates'),
                where('qrToken', '==', token)
            );
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
                const docSnap = querySnapshot.docs[0];
                certificate = { id: docSnap.id, ...docSnap.data() };
            }
        }

        if (!certificate) {
            showError('Certificate not found');
            return;
        }

        displayCertificate(certificate);
    } catch (error) {
        console.error('Error loading certificate:', error);
        showError('Error loading certificate');
    }
}

// Display certificate
function displayCertificate(cert) {
    // Hide loading
    loadingScreen.classList.add('is-hidden');
    loadingScreen.setAttribute('hidden', '');
    
    // Check expiry
    const isExpired = cert.expiryDate && new Date(cert.expiryDate) < new Date();
    const status = isExpired ? 'expired' : cert.status;

    // Generate QR code
    const qrContainer = document.getElementById('qrCode');
    if (qrContainer && cert.qrToken) {
        new QRCode(qrContainer, {
            text: cert.qrToken,
            width: 256,
            height: 256,
            correctLevel: QRCode.CorrectLevel.H
        });
    }

    // Set certificate details
    document.getElementById('certificateId').textContent = cert.certificateId;
    document.getElementById('certificateValue').textContent = `₱${cert.value.toLocaleString()}`;

    // Optional fields
    const givenByEl = document.getElementById('givenBy');
    const givenToEl = document.getElementById('givenTo');
    const descriptionEl = document.getElementById('description');
    const expiryEl = document.getElementById('expiry');

    if (cert.givenBy) {
        givenByEl.textContent = `From: ${cert.givenBy}`;
        givenByEl.classList.remove('is-hidden');
        givenByEl.removeAttribute('hidden');
    }

    if (cert.givenTo) {
        givenToEl.textContent = `To: ${cert.givenTo}`;
        givenToEl.classList.remove('is-hidden');
        givenToEl.removeAttribute('hidden');
    }

    if (cert.description) {
        descriptionEl.textContent = cert.description;
        descriptionEl.classList.remove('is-hidden');
        descriptionEl.removeAttribute('hidden');
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
    }

    // Status banner
    const statusBanner = document.getElementById('statusBanner');
    const statusText = document.getElementById('statusText');

    if (status === 'claimed') {
        statusBanner.classList.remove('is-hidden');
        statusBanner.removeAttribute('hidden');
        statusBanner.classList.add('status-claimed');
        statusText.textContent = 'This certificate has been claimed';
        
        if (cert.claimedAt) {
            const claimedDate = cert.claimedAt.toDate?.() || new Date(cert.claimedAt);
            statusText.textContent += ` on ${claimedDate.toLocaleDateString('en-US', { 
                month: 'long', 
                day: 'numeric', 
                year: 'numeric' 
            })}`;
        }
    } else if (status === 'expired') {
        statusBanner.classList.remove('is-hidden');
        statusBanner.removeAttribute('hidden');
        statusBanner.classList.add('status-expired');
        statusText.textContent = 'This certificate has expired';
    }

    // Apply status class to certificate
    const certificateCard = document.querySelector('.certificate-card');
    certificateCard.classList.add(`certificate-${status}`);

    // Show certificate
    certificateContainer.classList.remove('is-hidden');
    certificateContainer.removeAttribute('hidden');

    // Update page title
    document.title = `Gift Certificate - ${cert.certificateId}`;
}

// Show error
function showError(message) {
    loadingScreen.classList.add('is-hidden');
    loadingScreen.setAttribute('hidden', '');
    
    document.getElementById('errorMessage').textContent = message;
    errorScreen.classList.remove('is-hidden');
    errorScreen.removeAttribute('hidden');
}
