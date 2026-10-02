// Gift Certificate Dashboard Logic
import { db } from './firebase-config.js';
import { 
    collection, 
    addDoc, 
    getDocs, 
    query, 
    orderBy, 
    where,
    onSnapshot,
    Timestamp 
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Base58 encoding for token generation
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function bytesToBase58(bytes) {
    let x = 0n;
    for (const b of bytes) x = (x << 8n) + BigInt(b);
    let s = "";
    while (x > 0n) { 
        s = B58[Number(x % 58n)] + s; 
        x /= 58n; 
    }
    let zeros = 0; 
    for (const b of bytes) { 
        if (b === 0) zeros++; 
        else break; 
    }
    return "1".repeat(zeros) + s || "1";
}

function randomBase58_16() {
    const u = crypto.getRandomValues(new Uint8Array(16));
    return bytesToBase58(u);
}

// Generate unique certificate ID
function generateCertificateId() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `GC-${year}-${month}${day}-${random}`;
}

// State
let certificates = [];
let unsubscribe = null;

// DOM Elements
let certificateList;
let searchInput;
let newCertificateBtn;
let certificateModal;
let closeModalBtn;
let certificateForm;
let statusFilter;
let refreshBtn;
let listStatus;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    certificateList = document.getElementById('certificateList');
    searchInput = document.getElementById('searchInput');
    newCertificateBtn = document.getElementById('newCertificateBtn');
    certificateModal = document.getElementById('certificateModal');
    closeModalBtn = document.getElementById('closeModalBtn');
    certificateForm = document.getElementById('certificateForm');
    statusFilter = document.getElementById('statusFilter');
    refreshBtn = document.getElementById('refreshBtn');
    listStatus = document.getElementById('listStatus');

    // Event listeners
    newCertificateBtn.addEventListener('click', openModal);
    closeModalBtn.addEventListener('click', closeModal);
    certificateModal.addEventListener('click', (e) => {
        if (e.target === certificateModal) closeModal();
    });
    certificateForm.addEventListener('submit', handleCreateCertificate);
    searchInput.addEventListener('input', filterCertificates);
    statusFilter.addEventListener('change', filterCertificates);
    refreshBtn.addEventListener('click', loadCertificates);

    // Load certificates
    loadCertificates();
});

// Modal functions
function openModal() {
    certificateModal.classList.remove('is-hidden');
    certificateModal.removeAttribute('hidden');
    certificateForm.reset();
}

function closeModal() {
    certificateModal.classList.add('is-hidden');
    certificateModal.setAttribute('hidden', '');
}

// Load certificates with real-time updates
async function loadCertificates() {
    try {
        listStatus.textContent = 'Loading certificates…';
        
        if (unsubscribe) {
            unsubscribe();
        }

        const q = query(
            collection(db, 'giftCertificates'),
            orderBy('createdAt', 'desc')
        );

        unsubscribe = onSnapshot(q, (snapshot) => {
            certificates = [];
            snapshot.forEach((doc) => {
                certificates.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            filterCertificates();
            listStatus.textContent = `${certificates.length} certificate${certificates.length !== 1 ? 's' : ''}`;
        }, (error) => {
            console.error('Error loading certificates:', error);
            listStatus.textContent = 'Error loading certificates';
        });
    } catch (error) {
        console.error('Error setting up listener:', error);
        listStatus.textContent = 'Error loading certificates';
    }
}

// Filter and display certificates
function filterCertificates() {
    const searchTerm = searchInput.value.toLowerCase();
    const statusValue = statusFilter.value;

    let filtered = certificates.filter(cert => {
        const matchesSearch = 
            cert.certificateId.toLowerCase().includes(searchTerm) ||
            (cert.givenBy && cert.givenBy.toLowerCase().includes(searchTerm)) ||
            (cert.givenTo && cert.givenTo.toLowerCase().includes(searchTerm));
        
        const matchesStatus = !statusValue || cert.status === statusValue;

        return matchesSearch && matchesStatus;
    });

    displayCertificates(filtered);
}

// Display certificates
function displayCertificates(certs) {
    if (certs.length === 0) {
        certificateList.innerHTML = `
            <div class="certificates-list-empty">
                No certificates found. Create your first gift certificate!
            </div>
        `;
        return;
    }

    certificateList.innerHTML = certs.map(cert => {
        const createdDate = cert.createdAt?.toDate?.() || new Date(cert.createdAt);
        const formattedDate = createdDate.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });

        const statusClass = `certificate-status-${cert.status}`;
        const statusText = cert.status.charAt(0).toUpperCase() + cert.status.slice(1);

        return `
            <div class="certificate-card" data-id="${cert.id}">
                <div class="certificate-card-main">
                    <div class="certificate-card-header">
                        <span class="certificate-id">${cert.certificateId}</span>
                        <span class="certificate-status-pill ${statusClass}">${statusText}</span>
                    </div>
                    <div class="certificate-value">₱${cert.value.toLocaleString()}</div>
                    ${cert.givenBy ? `<div class="certificate-giver">From: ${cert.givenBy}</div>` : ''}
                    ${cert.givenTo ? `<div class="certificate-recipient">To: ${cert.givenTo}</div>` : ''}
                    <div class="certificate-date">${formattedDate}</div>
                </div>
                <div class="certificate-card-actions">
                    <button class="certificate-action-btn" onclick="viewCertificate('${cert.id}')" title="View Certificate">
                        <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                    </button>
                    <button class="certificate-action-btn" onclick="copyCertificateLink('${cert.id}')" title="Copy Link">
                        <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Create certificate
async function handleCreateCertificate(e) {
    e.preventDefault();
    
    const submitBtn = certificateForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Creating...';
    submitBtn.disabled = true;

    try {
        const formData = new FormData(certificateForm);
        const value = parseFloat(formData.get('value'));
        const givenBy = formData.get('givenBy');
        const givenTo = formData.get('givenTo');
        const description = formData.get('description');
        const expiryDate = formData.get('expiryDate');

        const certificateData = {
            certificateId: generateCertificateId(),
            qrToken: randomBase58_16(),
            value: value,
            status: 'active',
            createdAt: Timestamp.now(),
            createdBy: 'staff', // TODO: Add actual user auth
            givenBy: givenBy || null,
            givenTo: givenTo || null,
            description: description || null,
            expiryDate: expiryDate || null,
            claimedAt: null,
            claimedBy: null
        };

        const docRef = await addDoc(collection(db, 'giftCertificates'), certificateData);
        console.log('Certificate created:', docRef.id);

        closeModal();
        
        // Show success message
        showNotification('Certificate created successfully!', 'success');
    } catch (error) {
        console.error('Error creating certificate:', error);
        showNotification('Error creating certificate. Please try again.', 'error');
    } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
}

// View certificate
window.viewCertificate = function(id) {
    window.open(`certificate.html?id=${id}`, '_blank');
};

// Copy certificate link
window.copyCertificateLink = function(id) {
    const url = `${window.location.origin}/gift-certificates/certificate.html?id=${id}`;
    navigator.clipboard.writeText(url).then(() => {
        showNotification('Link copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Error copying link:', err);
        showNotification('Failed to copy link', 'error');
    });
};

// Notification helper
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}
