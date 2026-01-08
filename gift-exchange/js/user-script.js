// user-script.js
import { db, auth } from './firebase-setup.js';
import { 
    doc, 
    getDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { 
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

// DOM elements
const loading = document.getElementById('loading');
const giftInfo = document.getElementById('giftInfo');
const recipientName = document.getElementById('recipientName');
const recipientNickname = document.getElementById('recipientNickname');
const recipientCard = document.getElementById('recipientCard');
const revealBtn = document.getElementById('revealBtn');
const errorMessage = document.getElementById('errorMessage');
const noAssignment = document.getElementById('noAssignment');

// Store recipient data
let recipientData = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check if we're in an iframe (from main portal)
    if (window.parent && window.parent !== window) {
        // Try to get user data from parent
        try {
            if (window.parent.getCurrentUserData) {
                const userData = window.parent.getCurrentUserData();
                if (userData && userData.employeeCode) {
                    loadAssignment(userData.employeeCode);
                    return;
                }
            }
        } catch (e) {
            console.log("Could not access parent:", e.message);
        }
    }
    
    // Fallback: use Firebase Auth
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            await loadUserData(user.uid);
        } else {
            showError("Please log in to view your gift exchange assignment.");
        }
    });
});

// Load user data from Firebase
async function loadUserData(uid) {
    try {
        const userDoc = await getDoc(doc(db, "adminUsers", uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.employeeCode) {
                loadAssignment(userData.employeeCode);
            } else {
                showError("Employee code not found. Please contact admin.");
            }
        } else {
            showError("User data not found. Please contact admin.");
        }
    } catch (error) {
        console.error("Error loading user data:", error);
        showError("Failed to load user data. Please try again.");
    }
}

// Load assignment for employee
async function loadAssignment(employeeCode) {
    try {
        loading.style.display = 'block';
        giftInfo.style.display = 'none';
        noAssignment.style.display = 'none';
        hideError();
        
        // Load assignments
        const assignmentsRef = doc(db, "giftExchange", "assignments");
        const assignmentsSnap = await getDoc(assignmentsRef);
        
        if (!assignmentsSnap.exists()) {
            loading.style.display = 'none';
            noAssignment.style.display = 'block';
            return;
        }
        
        const data = assignmentsSnap.data();
        const assignments = data.assignments || data; // Support both old and new format
        
        // Find recipient for this employee
        const recipientId = assignments[employeeCode];
        
        if (!recipientId) {
            loading.style.display = 'none';
            noAssignment.style.display = 'block';
            return;
        }
        
        // Load recipient name
        const employeeRef = doc(db, "employees", recipientId);
        const employeeSnap = await getDoc(employeeRef);
        
        if (employeeSnap.exists()) {
            const employeeData = employeeSnap.data();
            const recipientNameText = employeeData.name || employeeData.fullName || "Unknown";
            const recipientNicknameText = employeeData.nickname || "";
            
            // Store recipient data
            recipientData = {
                name: recipientNameText,
                nickname: recipientNicknameText
            };
            
            loading.style.display = 'none';
            giftInfo.style.display = 'block';
            
            // Hide recipient info initially
            const infoEl = document.getElementById('recipientInfo');
            if (infoEl) {
                infoEl.style.display = 'none';
            }
            
            const btn = document.getElementById('revealBtn');
            if (btn) {
                btn.classList.remove('revealed');
                btn.style.display = 'block';
                const textEl = btn.querySelector('.reveal-btn-text');
                if (textEl) {
                    textEl.textContent = 'Reveal Giftee';
                }
            }
            
        } else {
            loading.style.display = 'none';
            showError("Recipient information not found.");
        }
        
    } catch (error) {
        console.error("Error loading assignment:", error);
        loading.style.display = 'none';
        showError("Failed to load assignment. Please try again.");
    }
}

// Setup reveal button handler
function setupRevealButton() {
    const btn = document.getElementById('revealBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            if (recipientData && !btn.classList.contains('revealed')) {
                // Reveal the recipient
                const nameEl = document.getElementById('recipientName');
                const nicknameEl = document.getElementById('recipientNickname');
                const infoEl = document.getElementById('recipientInfo');
                
                if (nameEl) {
                    nameEl.textContent = recipientData.name;
                }
                
                if (nicknameEl) {
                    if (recipientData.nickname) {
                        nicknameEl.textContent = recipientData.nickname;
                    } else {
                        // If no nickname, show name as nickname
                        nicknameEl.textContent = recipientData.name;
                        if (nameEl) {
                            nameEl.style.display = 'none';
                        }
                    }
                }
                
                if (infoEl) {
                    infoEl.style.display = 'block';
                }
                
                // Hide the button
                btn.style.display = 'none';
                btn.classList.add('revealed');
            }
        });
    }
}

// Setup reveal button when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupRevealButton);
} else {
    setupRevealButton();
}

// Error handling
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}

function hideError() {
    errorMessage.style.display = 'none';
}

