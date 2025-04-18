const APP_VERSION = "0.73"; 

const ALLOW_PAST_CLOCKING = false;

const employees = {
    "130129": "Beatrice Grace Boldo",
    "130229": "Cristopher David",
    "130329": "Gabrielle Hannah Catalan",
    "130429": "Acerr Franco",
    "130529": "Raschel Joy Cruz",
    "130629": "Raniel Buenaventura",
    "130729": "Denzel Genesis Fernandez",
    "130829": "Sheila Mae Salvajan",
    "130929": "Paul John Garin",
    "131029": "John Lester Cal",
    "131129": "Liezel Acebedo",
    "131229": "Laville Laborte",
    "131329": "Jasmine Ferrer",
    "131429": "Gerilou Gonzales",
    "131529": "Sarah Perpinan",
    "131629": "Rhobbie Ryza Saligumba",
    "131729": "Charles Francis Tan",
    "131829": "Japhet Dizon"
};

const podiumPOSAccess = [
    "130729", // Denzel
    "130829", // Sheila
    "130929", // Paul John
    "131029", // John Lester
    "131129",
    "131229",
    "131529",
    "131629",
    "131729"
];


let dutyStatus = "in";
let selfieData = "";
let currentUser = localStorage.getItem("loggedInUser") || "";
let today = new Date();
today.setHours(0, 0, 0, 0);
let viewDate = new Date();
let stream = null;

const timestamp = document.getElementById("timestamp");
const datePicker = document.getElementById("datePicker");
const mainInterface = document.getElementById("mainInterface");
const loginForm = document.getElementById("loginForm");
// const summaryContainer = document.getElementById("summaryContainer");
// const startBtn = document.getElementById("startBtn");
const video = document.getElementById("video");
const previewImg = document.getElementById("previewImg");
const canvas = document.getElementById("snapshot");
const videoContainer = document.getElementById("videoContainer");
const nextBtn = document.getElementById("nextBtn");
const captureCircle = document.getElementById("captureCircle");
const cameraControls = document.getElementById("cameraControls");

const lateGraceLimitMinutes = 30;

const SHIFT_SCHEDULES = {
    Opening: { timeIn: "9:30 AM", timeOut: "6:30 PM" },
    Midshift: { timeIn: "11:00 AM", timeOut: "8:00 PM" },
    Closing: { timeIn: "1:00 PM", timeOut: "10:00 PM" },
    Custom: { timeIn: null, timeOut: null }
};

// At top of your script.js
import { db } from './firebase-setup.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getDocs, collection } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { storage, ref as storageRef, uploadBytes, getDownloadURL } from './firebase-setup.js';

if (timestamp) {
    setInterval(() => {
        const now = new Date();
        timestamp.textContent = `Current Time: ${now.toLocaleTimeString()}`;
    }, 1000);
}

// setInterval(async () => {
//     if (formatDate(viewDate) !== formatDate(today)) return;
//     await updateSummaryUI();
// }, 10000);

if (currentUser && localStorage.getItem("userName")) {
    showMainInterface(currentUser);
    updateGreetingUI();
    // updateSummaryUI();
}

function getScheduledTimes(data = null) {
    const shift =
        data?.clockIn?.shift ||
        document.getElementById("shiftSelect")?.value ||
        localStorage.getItem("lastSelectedShift") ||
        "Opening";

    return SHIFT_SCHEDULES[shift] || SHIFT_SCHEDULES["Opening"];
}

function getAttendanceDates() {
    const keys = Object.keys(localStorage);
    const prefix = `attendance_${currentUser}_`;
    return keys
        .filter(key => key.startsWith(prefix))
        .map(key => key.replace(prefix, ""));
}

async function getAttendanceDatesFromFirestore() {
    const subCollectionSnap = await getDocs(collection(db, "attendance", currentUser, "dates"));
    return subCollectionSnap.docs.map(doc => doc.id);
}

function highlightAttendanceDates(fp) {
    const dates = getAttendanceDates();
    const cells = fp.calendarContainer.querySelectorAll(".flatpickr-day");

    cells.forEach(cell => {
        const dateStr = cell.dateObj && formatDate(cell.dateObj);
        if (dateStr && dates.includes(dateStr)) {
            cell.style.border = "2px solid #2b9348";
            cell.style.borderRadius = "50%";
        } else {
            cell.style.border = "";
            cell.style.borderRadius = "";
        }
    });
}

function formatDate(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function loginUser() {
    const code = document.getElementById("codeInput").value.trim();
    if (!code) return alert("Please enter a code");

    // Show loading indicator
    document.getElementById("loginButton").disabled = true;
    document.getElementById("loginButton").textContent = "Logging in...";

    // Check if we've previously cached this user's data
    const cachedUserData = localStorage.getItem(`userCache_${code}`);

    if (!navigator.onLine) {
        // Offline login logic
        if (cachedUserData) {
            const userData = JSON.parse(cachedUserData);
            currentUser = code;
            localStorage.setItem("loggedInUser", code);
            localStorage.setItem("userName", userData.name || "Employee");

            // Update UI to indicate offline mode
            document.getElementById("networkStatus").textContent = "📴 OFFLINE MODE - Some features limited";
            document.getElementById("networkStatus").style.color = "#e63946";

            showMainInterface(code);
            updateGreetingUI();
            updateSummaryUI();
            return;
        } else {
            document.getElementById("loginButton").disabled = false;
            document.getElementById("loginButton").textContent = "Log In";
            return alert("⚠️ Cannot login offline - You must login online at least once first");
        }
    }

    // Online login logic - attempt to fetch from Firestore
    try {
        const docRef = doc(db, "staff", code);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            currentUser = code;
            localStorage.setItem("loggedInUser", code);

            const userData = docSnap.data();
            localStorage.setItem("userName", userData.name);

            // Cache user data for offline login
            localStorage.setItem(`userCache_${code}`, JSON.stringify(userData));

            // Show interface immediately - don't wait for cache
            showMainInterface(code);
            updateGreetingUI();
            await updateSummaryUI();

            // IMPORTANT: Run data caching in background after login
            setTimeout(() => {
                cacheMostRecentAttendance(code)
                    .then(() => console.log("✅ Background caching completed"))
                    .catch(err => console.warn("⚠️ Background caching error:", err));
            }, 100);
        } else {
            document.getElementById("loginButton").disabled = false;
            document.getElementById("loginButton").textContent = "Log In";
            alert("❌ Invalid employee code");
        }
    } catch (error) {
        console.error("Login error:", error);
        document.getElementById("loginButton").disabled = false;
        document.getElementById("loginButton").textContent = "Log In";

        // Fall back to cached data if network request fails
        if (cachedUserData) {
            currentUser = code;
            const userData = JSON.parse(cachedUserData);
            localStorage.setItem("loggedInUser", code);
            localStorage.setItem("userName", userData.name || "Employee");

            alert("⚠️ Connected in offline mode - Some features limited");

            showMainInterface(code);
            updateGreetingUI();
            updateSummaryUI();
        } else {
            alert("❌ Network error and no cached data available");
        }
    }
}

// Modify the cacheMostRecentAttendance function to handle missing networkStatus element
async function cacheMostRecentAttendance(userCode) {
    try {
        // Only cache the most recent 7 days instead of 30
        const last7Days = [];
        let date = new Date();

        // Get last 7 days of dates
        for (let i = 0; i < 7; i++) {
            last7Days.push(formatDate(date));
            date.setDate(date.getDate() - 1);
        }

        // Update UI to show background sync is happening - safely check if element exists
        const networkStatus = document.getElementById("networkStatus");
        let originalText = "";

        if (networkStatus) {
            originalText = networkStatus.textContent;
            networkStatus.textContent = "🔄 Caching recent data...";
        }

        // Fetch recent attendance data
        for (const dateKey of last7Days) {
            const subDocRef = doc(db, "attendance", userCode, "dates", dateKey);
            const docSnap = await getDoc(subDocRef);

            if (docSnap.exists()) {
                const key = `attendance_${userCode}_${dateKey}`;
                const data = docSnap.data();
                data.synced = true; // Mark as synced
                localStorage.setItem(key, JSON.stringify(data));
            }

            // Small delay to prevent overwhelming Firestore
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Restore network status if the element exists
        if (networkStatus) {
            networkStatus.textContent = originalText;
        }

        console.log("✅ Cached recent attendance for offline use");

        // Cache older data in chunks if needed
        if (navigator.onLine) {
            cacheOlderDataInBackground(userCode, 7, 30);
        }
    } catch (error) {
        console.error("Failed to cache recent attendance:", error);
    }
}

// New function to cache older data in small batches in the background
async function cacheOlderDataInBackground(userCode, startDay, endDay) {
    try {
        for (let i = startDay; i < endDay; i++) {
            // Check if we're still online before proceeding
            if (!navigator.onLine) break;

            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateKey = formatDate(date);

            const subDocRef = doc(db, "attendance", userCode, "dates", dateKey);
            const docSnap = await getDoc(subDocRef);

            if (docSnap.exists()) {
                const key = `attendance_${userCode}_${dateKey}`;
                const data = docSnap.data();
                data.synced = true;
                localStorage.setItem(key, JSON.stringify(data));
            }

            // Larger delay for background caching
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        console.log(`✅ Background caching complete (days ${startDay}-${endDay})`);
    } catch (error) {
        console.warn("Background caching stopped:", error);
    }
}


document.getElementById("loginButton").addEventListener("click", loginUser);

function logoutUser() {
    localStorage.removeItem("loggedInUser");
    localStorage.removeItem("userName"); // ✅ Clear cached name
    location.reload();
}


async function showMainInterface(code) {
    loginForm.style.display = "none";
    mainInterface.style.display = "block";
    viewDate = new Date();

    const dateKey = formatDate(viewDate);
    const localData = localStorage.getItem(`attendance_${code}_${dateKey}`);

    if (localData) {
        const data = JSON.parse(localData);
        updateBranchAndShiftSelectors(data);
        updateCardTimes(data);
    } else {
        updateBranchAndShiftSelectors({}); 
        updateCardTimes({});
    }

    updateGreetingUI(); // always show greeting immediately

    if (!navigator.onLine) {
        console.warn("Offline mode - using local data only.");
        updateSummaryUI(); // local fallback only
    } else {
        await updateSummaryUI(); // ❗only run Firestore fetch online
    }
}

async function updateSummaryUI() {
    const isToday = formatDate(viewDate) === formatDate(today);
    const dateKey = formatDate(viewDate);
    const key = `attendance_${currentUser}_${dateKey}`;
    const localData = localStorage.getItem(key);

    // STEP 1: Instant load from local
    if (localData) {
        const data = JSON.parse(localData);
        updateBranchAndShiftSelectors(data);
        updateCardTimes(data);
    } else {
        updateBranchAndShiftSelectors(); // fallback to default
        updateCardTimes({}); // blank
    }

    // STEP 2: Fetch fresh data in the background
    try {
        if (!navigator.onLine) return; // ⛔ Skip Firestore fetch when offline

        const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);
        const docSnap = await getDoc(subDocRef);
        if (docSnap.exists()) {
            const remoteData = docSnap.data();

            // Update if different
            if (JSON.stringify(remoteData) !== localData) {
                localStorage.setItem(key, JSON.stringify(remoteData));
                updateBranchAndShiftSelectors(remoteData);
                updateCardTimes(remoteData);
            }
        }
    } catch (err) {
        console.warn("⚠️ Firestore failed, used local only", err);
    }

    // Always update date UI & greeting immediately
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = viewDate.toLocaleDateString('en-US', options);
    const [weekday, ...rest] = formattedDate.split(', ');
    document.getElementById("dayOfWeek").textContent = weekday;
    document.getElementById("fullDate").textContent = rest.join(', ');
    document.getElementById("greetingText").textContent = getTimeBasedGreeting();

    datePicker.value = dateKey;
    if (datePicker._flatpickr) datePicker._flatpickr.jumpToDate(viewDate);

    dutyStatus = localData && JSON.parse(localData).clockIn && !JSON.parse(localData).clockOut ? 'out' : 'in';

    updateOfflineBadges();
}



// function changeDay(delta) {
//     viewDate.setDate(viewDate.getDate() + delta);

//     const formatted = formatDate(viewDate);
//     datePicker.value = formatted;

//     if (datePicker._flatpickr) {
//         datePicker._flatpickr.jumpToDate(viewDate);
//     }

//     updateSummaryUI();
// }

function startPhotoSequence() {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
        .then(s => {
            stream = s;
            video.srcObject = stream;
            video.style.display = "block";
            previewImg.style.display = "none";
            videoContainer.style.display = "flex";
            captureCircle.style.display = "block";
            cameraControls.style.display = "none";
        })
        .catch(() => alert("Camera access failed"));
}

async function takePhoto() {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.translate(video.videoWidth, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);

    // Get full quality for preview
    const fullQualityImage = canvas.toDataURL("image/jpeg", 0.8);

    // Resize and compress for storage
    selfieData = await resizeAndCompressImage(fullQualityImage, 320, 240, 0.6);

    video.style.display = "none";
    previewImg.src = fullQualityImage; // Show full quality in preview
    previewImg.style.display = "block";

    captureCircle.style.display = "none";
    cameraControls.style.display = "flex";
}

function resizeAndCompressImage(dataUrl, maxWidth = 320, maxHeight = 240, quality = 0.6) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function () {
            // Calculate new dimensions maintaining aspect ratio
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxWidth) {
                    height = Math.round(height * (maxWidth / width));
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = Math.round(width * (maxHeight / height));
                    height = maxHeight;
                }
            }

            // Create canvas and resize image
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Get compressed data URL
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = dataUrl;
    });
}

function retakePhoto() {
    previewImg.style.display = "none";
    video.style.display = "block";
    captureCircle.style.display = "block";
    cameraControls.style.display = "none";
}

function submitPhoto() {
    console.log("📸 Submitting photo... dutyStatus=" + dutyStatus);
    videoContainer.style.display = "none";
    if (stream) stream.getTracks().forEach(t => t.stop());

    if (!selfieData) {
        alert("⚠️ No photo captured. Please retake.");
        return;
    }

    saveAttendance();
}

async function uploadSelfieToStorage(imageDataUrl, userId, dateKey, actionType) {
    try {
        // Convert base64 data to blob for storage
        const response = await fetch(imageDataUrl);
        const blob = await response.blob();

        // Create a unique filename
        const filename = `${userId}_${dateKey}_${actionType}_${Date.now()}.jpg`;
        const fileRef = storageRef(storage, `selfies/${filename}`);

        // Upload to Firebase Storage
        await uploadBytes(fileRef, blob);

        // Get the download URL
        const downloadURL = await getDownloadURL(fileRef);
        return downloadURL;
    } catch (error) {
        console.error("Error uploading selfie:", error);
        // If upload fails, return the original data URL as fallback
        return imageDataUrl;
    }
}

function updateSyncStatusVisual(status, count = 0) {
    const cards = document.querySelectorAll('.panel-card .offline-badge');

    switch (status) {
        case 'syncing':
            cards.forEach(badge => {
                badge.textContent = "Syncing...";
                badge.style.backgroundColor = "rgba(255, 149, 0, 0.9)";
            });
            break;

        case 'progress':
            cards.forEach(badge => {
                badge.textContent = `Syncing ${count}%`;
                badge.style.backgroundColor = "rgba(255, 149, 0, 0.9)";
            });
            break;

        case 'success':
            cards.forEach(badge => {
                badge.textContent = "Synced!";
                badge.style.backgroundColor = "rgba(43, 147, 72, 0.9)";
            });
            break;

        case 'hide':
            // FORCE remove all badges
            cards.forEach(badge => {
                badge.remove();
            });
            break;
    }
}

document.getElementById("closeCameraBtn").addEventListener("click", () => {
    videoContainer.style.display = "none";
    if (stream) stream.getTracks().forEach(t => t.stop());
});

async function saveAttendance() {
    console.log("💾 Running saveAttendance...");
    const dateKey = formatDate(viewDate);
    const key = `attendance_${currentUser}_${formatDate(viewDate)}`;
    const now = new Date();
    const time = now.toLocaleTimeString();

    // IMPORTANT: Create a fresh copy of the existing data to avoid reference issues
    const existing = JSON.parse(localStorage.getItem(key) || "{}");

    // Track offline changes
    let syncQueue = JSON.parse(localStorage.getItem("syncQueue") || "[]");

    // Store current action (in or out) for clarity
    const action = dutyStatus === 'in' ? 'clockIn' : 'clockOut';
    console.log(`Current action: ${action}`);

    if (action === 'clockIn') {
        // CLOCK IN LOGIC
        const branch = document.getElementById("branchSelect")?.value || "Podium";
        const shift = document.getElementById("shiftSelect")?.value || "Opening";

        // Create new clock in data - don't modify existing.clockOut if it exists
        existing.clockIn = {
            time,
            selfie: selfieData,
            branch,
            shift,
            timestamp: Date.now(),
            synced: false // Track sync status for this event specifically
        };

        if (navigator.onLine) {
            try {
                const selfieUrl = await uploadSelfieToStorage(selfieData, currentUser, dateKey, 'clockIn');
                existing.clockIn.selfie = selfieUrl;

                const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);

                // Get existing data first to avoid overwriting clockOut
                const docSnap = await getDoc(subDocRef);
                let dataToSave = { clockIn: { ...existing.clockIn } };

                // Remove synced flag from what we save to Firestore
                delete dataToSave.clockIn.synced;

                // If there's existing data with clockOut, preserve it
                if (docSnap.exists()) {
                    const existingData = docSnap.data();
                    if (existingData.clockOut) {
                        console.log("Preserving existing clockOut data");
                        existing.clockOut = existingData.clockOut;
                        existing.clockOut.synced = true; // Mark existing clockOut as synced
                    }
                }

                await setDoc(subDocRef, dataToSave, { merge: true });
                existing.clockIn.synced = true; // Mark just the clockIn as synced
                console.log("✅ Clock-in saved to Firestore");
            } catch (err) {
                console.warn('🔌 Failed to save to Firestore - will sync later', err);
                existing.clockIn.synced = false;

                // Add to sync queue with action information
                const queueItem = `${key}:clockIn`;
                if (!syncQueue.includes(queueItem)) {
                    syncQueue.push(queueItem);
                    localStorage.setItem("syncQueue", JSON.stringify(syncQueue));
                }

                // Register background sync
                if ('serviceWorker' in navigator && 'SyncManager' in window) {
                    const registration = await navigator.serviceWorker.ready;
                    try {
                        await registration.sync.register('sync-attendance');
                    } catch (error) {
                        console.error("Background sync registration failed:", error);
                    }
                }
            }
        } else {
            // Offline - mark for later sync
            existing.clockIn.synced = false;

            // Add to sync queue with action information
            const queueItem = `${key}:clockIn`;
            if (!syncQueue.includes(queueItem)) {
                syncQueue.push(queueItem);
                localStorage.setItem("syncQueue", JSON.stringify(syncQueue));
            }
            alert("📴 You're offline. Your time will be saved locally and synced when back online.");
        }

        dutyStatus = 'out';
    } else {
        // CLOCK OUT LOGIC - Make sure we don't overwrite clockIn

        // First check if there's clockIn data in existing
        if (!existing.clockIn) {
            // If no clockIn exists locally, try to get it from Firestore
            if (navigator.onLine) {
                try {
                    const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);
                    const docSnap = await getDoc(subDocRef);

                    if (docSnap.exists() && docSnap.data().clockIn) {
                        // Use the Firestore clockIn data
                        existing.clockIn = docSnap.data().clockIn;
                        existing.clockIn.synced = true; // Mark as synced
                    } else {
                        // No clockIn found - can't clockOut
                        alert("⚠️ Unable to clock out: No clock-in record found");
                        return;
                    }
                } catch (err) {
                    console.error("Failed to check for clock-in data:", err);
                    alert("⚠️ Unable to clock out: Could not verify clock-in status");
                    return;
                }
            } else {
                // Offline with no clockIn - can't proceed
                alert("⚠️ Cannot clock out: No clock-in record found in offline storage");
                return;
            }
        }

        // Now we can safely add clockOut data
        existing.clockOut = {
            time,
            selfie: selfieData,
            timestamp: Date.now(),
            synced: false // Track sync status for clockOut specifically
        };

        if (navigator.onLine) {
            try {
                const selfieUrl = await uploadSelfieToStorage(selfieData, currentUser, dateKey, 'clockOut');
                existing.clockOut.selfie = selfieUrl;

                const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);

                // We're specifically only updating the clockOut field
                // Remove synced flag from what we save to Firestore
                const clockOutData = { ...existing.clockOut };
                delete clockOutData.synced;

                await setDoc(subDocRef, { clockOut: clockOutData }, { merge: true });
                existing.clockOut.synced = true; // Mark just the clockOut as synced
                console.log("✅ Clock-out saved to Firestore");
            } catch (err) {
                console.warn('🔌 Failed to save to Firestore - will sync later', err);
                existing.clockOut.synced = false;

                // Add to sync queue with action information
                const queueItem = `${key}:clockOut`;
                if (!syncQueue.includes(queueItem)) {
                    syncQueue.push(queueItem);
                    localStorage.setItem("syncQueue", JSON.stringify(syncQueue));
                }

                // Register background sync
                if ('serviceWorker' in navigator && 'SyncManager' in window) {
                    const registration = await navigator.serviceWorker.ready;
                    try {
                        await registration.sync.register('sync-attendance');
                    } catch (error) {
                        console.error("Background sync registration failed:", error);
                    }
                }
            }
        } else {
            // Offline - mark for later sync
            existing.clockOut.synced = false;

            // Add to sync queue with action information
            const queueItem = `${key}:clockOut`;
            if (!syncQueue.includes(queueItem)) {
                syncQueue.push(queueItem);
                localStorage.setItem("syncQueue", JSON.stringify(syncQueue));
            }
            alert("📴 You're offline. Your time will be saved locally and synced when back online.");
        }

        dutyStatus = 'in';
    }

    // Calculate the overall sync status of the record
    existing.synced = (!existing.clockIn || existing.clockIn.synced) &&
        (!existing.clockOut || existing.clockOut.synced);

    // Store locally
    localStorage.setItem(key, JSON.stringify(existing));
    updateCardTimes(existing);
    updateDateUI();
    updateOfflineBadges(); // Make sure badges are updated

    console.log("🎉 UI updated with time " + action);
}




function clearData() {
    if (confirm("Are you sure you want to clear all local data?")) {
        localStorage.clear();
        location.reload();
    }
}

async function updateGreetingUI() {
    let name = localStorage.getItem("userName");

    // If no name is saved yet, fetch and save
    if (!name && currentUser) {
        // Fallback: re-fetch name if missing
        try {
            const docSnap = await getDoc(doc(db, "staff", currentUser));
            if (docSnap.exists()) {
                name = docSnap.data().name;
                localStorage.setItem("userName", name); // Save it again
            } else {
                name = "Employee";
            }
        } catch (err) {
            console.error("Failed to fetch name:", err);
            name = "Employee";
        }
    }

    document.getElementById("userName").textContent = name;

    const now = viewDate;
    const formatted = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const [weekday, ...rest] = formatted.split(', ');
    document.getElementById("dayOfWeek").textContent = weekday;
    document.getElementById("fullDate").textContent = rest.join(', ');
    document.getElementById("greetingText").textContent = getTimeBasedGreeting();
}


document.getElementById("branchSelect").addEventListener("change", async () => {
    const dateKey = formatDate(viewDate);
    const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);
    const docSnap = await getDoc(subDocRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.clockIn) {
            data.clockIn.branch = document.getElementById("branchSelect").value;
            await setDoc(subDocRef, { clockIn: data.clockIn }, { merge: true });
        }
    }
});

async function handleClock(type) {
    const isToday = formatDate(viewDate) === formatDate(today);
    if (!ALLOW_PAST_CLOCKING && !isToday) {
        return;
    }

    const dateKey = formatDate(viewDate);

    // First get data from local storage (works offline)
    let data = {};
    const localStorageKey = `attendance_${currentUser}_${dateKey}`;
    const localData = localStorage.getItem(localStorageKey);

    if (localData) {
        data = JSON.parse(localData);
    }

    // Try to get Firestore data only if online
    if (navigator.onLine) {
        try {
            const docSnap = await getDoc(doc(db, "attendance", currentUser, "dates", dateKey));
            if (docSnap.exists()) {
                const firestoreData = docSnap.data();
                // Merge with local data giving priority to Firestore
                data = { ...data, ...firestoreData };
            }
        } catch (err) {
            console.warn("⚠️ Offline - using local fallback in handleClock()");
            // We already have local data loaded above
        }
    } else {
        console.log("📴 Offline mode - using local data only");
    }

    // TIME IN: Only proceed if no clockIn exists
    if (type === 'in' && !data.clockIn) {
        dutyStatus = 'in'; // Set correct status before photo sequence
        startPhotoSequence();
        return;
    }

    // TIME OUT: Only proceed if clockIn exists and clockOut doesn't
    if (type === 'out' && data.clockIn && !data.clockOut) {
        dutyStatus = 'out'; // Set correct status before photo sequence

        const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const { timeOut } = getScheduledTimes(data);
        const lateBy = compareTimes(data.clockIn.time, getScheduledTimes(data).timeIn);

        let displayOutTime = timeOut;

        // Adjusted time if late within grace
        if (lateBy > 0 && lateBy <= lateGraceLimitMinutes) {
            const [h, m] = timeOut.split(/:|\s/);
            let hour = parseInt(h);
            let min = parseInt(m);
            min += lateBy;
            hour += Math.floor(min / 60);
            min %= 60;
            if (hour > 12) hour -= 12;
            displayOutTime = `${hour}:${min.toString().padStart(2, '0')} ${timeOut.includes("PM") ? "PM" : "AM"}`;
        }

        if (compareTimes(now, displayOutTime) < 0) {
            // Show modal instead of confirm()
            const modal = document.getElementById("earlyOutModal");
            modal.style.display = "flex";

            document.getElementById("confirmEarlyOut").onclick = () => {
                modal.style.display = "none";
                startPhotoSequence(); // proceed
            };
            document.getElementById("cancelEarlyOut").onclick = () => {
                modal.style.display = "none";
            };
            return;
        }

        startPhotoSequence();
        return;
    }
}

function compareTimes(t1, t2) {
    const [time1, meridian1] = t1.split(' ');
    const [hour1, min1] = time1.split(':').map(Number);
    const minutes1 = (meridian1 === "PM" && hour1 !== 12 ? hour1 + 12 : hour1 % 12) * 60 + min1;

    const [time2, meridian2] = t2.split(' ');
    const [hour2, min2] = time2.split(':').map(Number);
    const minutes2 = (meridian2 === "PM" && hour2 !== 12 ? hour2 + 12 : hour2 % 12) * 60 + min2;

    return minutes1 - minutes2; // > 0 means late
}

function markOfflineData() {
    // Check if we have any unsynced data
    const syncQueue = JSON.parse(localStorage.getItem("syncQueue") || "[]");

    if (syncQueue.length === 0) return;

    // Get today's data
    const todayKey = `attendance_${currentUser}_${formatDate(new Date())}`;
    const todayData = JSON.parse(localStorage.getItem(todayKey) || "{}");

    // If today's data isn't synced, add badges
    if (!todayData.synced) {
        const clockInCard = document.getElementById("clockInCard");
        const clockOutCard = document.getElementById("clockOutCard");

        // Add offline indicator to clock in card if needed
        if (todayData.clockIn && !document.querySelector("#clockInCard .offline-badge")) {
            const badge = document.createElement("div");
            badge.className = "offline-badge";
            badge.textContent = "Not synced";
            clockInCard.appendChild(badge);
        }

        // Add offline indicator to clock out card if needed
        if (todayData.clockOut && !document.querySelector("#clockOutCard .offline-badge")) {
            const badge = document.createElement("div");
            badge.className = "offline-badge";
            badge.textContent = "Not synced";
            clockOutCard.appendChild(badge);
        }
    }
}

function updateCardTimes(data) {
    const isToday = formatDate(viewDate) === formatDate(today);
    const hasNoData = !data.clockIn && !data.clockOut;
    const clockInPhoto = document.getElementById("clockInPhoto");
    const clockInOverlay = document.getElementById("clockInOverlay");
    const statusLabel = document.getElementById("clockInStatusLabel");
    const label = clockInOverlay.querySelector(".panel-label");
    const timeSpan = document.getElementById("clockInTime");

    const clockOutOverlay = document.getElementById("clockOutOverlay");
    const clockOutPhoto = document.getElementById("clockOutPhoto");
    const clockOutTimeSpan = document.getElementById("clockOutTime");
    const clockOutStatus = document.getElementById("clockOutStatusLabel");

    const { timeIn: scheduledTimeIn, timeOut: scheduledTimeOut } = getScheduledTimes();

    if (hasNoData && isToday) {
        const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const { timeIn: scheduledTimeIn, timeOut: scheduledTimeOut } = getScheduledTimes(data);
        const late = compareTimes(now, scheduledTimeIn) > 0;
        const [inTime, inMeridiem] = splitTime(scheduledTimeIn || "--:--");
        const [outTime, outMeridiem] = splitTime(scheduledTimeOut || "--:--");

        // ✅ Clock In
        clockInPhoto.src = "";
        clockInPhoto.style.display = "none";
        clockInPhoto.onclick = null;
        clockInOverlay.className = "panel-overlay";
        clockInOverlay.classList.add(late ? "red" : "green");
        statusLabel.textContent = late ? "Running late" : "On time";
        label.textContent = "Time In";
        timeSpan.innerHTML = `${inTime}<span class="ampm">${inMeridiem}</span>`;

        // ✅ Clock Out (show default schedule)
        clockOutPhoto.src = "";
        clockOutPhoto.style.display = "none";
        clockOutPhoto.onclick = null;
        clockOutOverlay.className = "panel-overlay";
        clockOutOverlay.classList.add("default-green");
        clockOutStatus.textContent = "";
        clockOutOverlay.querySelector(".panel-label").textContent = "Time Out";
        clockOutTimeSpan.innerHTML = `${outTime}<span class="ampm">${outMeridiem}</span>`;

        return;
    }
    else if (hasNoData && !isToday) {
        // Fully blank for past days with no record
        clockInPhoto.src = "";
        clockInPhoto.style.display = "none";
        clockInPhoto.onclick = null;
        clockInOverlay.className = "panel-overlay";
        statusLabel.textContent = "";
        label.textContent = "Time In";
        timeSpan.innerHTML = `--:--<span class="ampm"></span>`;

        clockOutPhoto.src = "";
        clockOutPhoto.style.display = "none";
        clockOutPhoto.onclick = null;
        clockOutOverlay.className = "panel-overlay";
        clockOutStatus.textContent = "";
        clockOutOverlay.querySelector(".panel-label").textContent = "Time Out";
        clockOutTimeSpan.innerHTML = `--:--<span class="ampm"></span>`;

        return;
    }

    // Set default
    let timeInToShow;

    if (compareTimes(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), scheduledTimeIn) > 0) {
        // After scheduled time — show real time slipping
        const now = new Date();
        const hour = now.getHours() % 12 || 12;
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
        timeInToShow = `${hour}:${minutes} ${ampm}`;
    } else {
        // Still before scheduled — show scheduled
        timeInToShow = scheduledTimeIn;
    }

    let statusText = "";
    let overlayColor = "";

    if (!data.clockIn) {
        // No clock-in yet
        const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const late = compareTimes(now, scheduledTimeIn) > 0;

        statusText = late ? "Running late" : "On time";
        overlayColor = late ? "red" : "green";

        label.textContent = "Time In";
        clockInOverlay.classList.remove("overlayed");
    } else {
        // Already clocked in
        const actualTime = data.clockIn.time;
        const lateBy = compareTimes(actualTime, scheduledTimeIn);
        timeInToShow = actualTime;
        overlayColor = lateBy > 0 ? "red" : "green";
        if (lateBy > 0) {
            const hrs = Math.floor(lateBy / 60);
            const mins = lateBy % 60;
            statusText = hrs > 0
                ? `${hrs} hr${hrs > 1 ? 's' : ''}${mins > 0 ? ` ${mins} min${mins > 1 ? 's' : ''}` : ''} late`
                : `${mins} min${mins > 1 ? 's' : ''} late`;
        } else {
            statusText = "On time";
        }


        label.textContent = "Timed In";
        
        if (clockInPhoto.src !== data.clockIn.selfie) {
            clockInPhoto.src = data.clockIn.selfie;
        }
        clockInPhoto.style.display = "block";
        clockInPhoto.onclick = () => openImageModal(data.clockIn.selfie);
        clockInOverlay.classList.add("overlayed");

    }

    // Update panel UI
    const [inTime, inMeridiem] = splitTime(timeInToShow);
    timeSpan.innerHTML = `${inTime}<span class="ampm">${inMeridiem}</span>`;
    statusLabel.textContent = data.clockIn ? statusText : "";

    // Apply color classes
    clockInOverlay.classList.remove("red", "green");
    if (data.clockIn) clockInOverlay.classList.add(overlayColor);

    if (!data.clockIn) {
        clockInPhoto.src = "";
        clockInPhoto.style.display = "none";
        clockInPhoto.onclick = null;
    }

    // Clock Out (left untouched for now)
    // const clockOutTime = data.clockOut?.time || scheduledTimeOut;
    // const [outTime, outMeridiem] = splitTime(clockOutTime);

    let displayOutTime = scheduledTimeOut;
    let outStatus = "";
    let outOverlayColor = "";

    if (data.clockIn && !data.clockOut) {
        const lateBy = compareTimes(data.clockIn.time, scheduledTimeIn);

        if (lateBy > 0 && lateBy <= lateGraceLimitMinutes) {
            // Adjust timeout
            
            const { timeIn: scheduledTimeIn, timeOut: scheduledTimeOut } = getScheduledTimes(data);
            
            if (scheduledTimeOut) {
                const [hourStr, minStr] = scheduledTimeOut.split(/:|\s/);
                const hour = parseInt(hourStr);
                const min = parseInt(minStr);
                const ampm = scheduledTimeOut.includes("PM") ? "PM" : "AM";

                let adjustedMinutes = min + lateBy;
                let adjustedHour = hour + Math.floor(adjustedMinutes / 60);
                adjustedMinutes %= 60;
                if (adjustedHour > 12) adjustedHour -= 12;

                displayOutTime = `${adjustedHour}:${adjustedMinutes.toString().padStart(2, '0')} ${ampm}`;
            }

            const hour = parseInt(hourStr);
            const min = parseInt(minStr);
            const ampm = scheduledTimeOut.includes("PM") ? "PM" : "AM";

            let adjustedMinutes = min + lateBy;
            let adjustedHour = hour + Math.floor(adjustedMinutes / 60);
            adjustedMinutes %= 60;
            if (adjustedHour > 12) adjustedHour -= 12;

            displayOutTime = `${adjustedHour}:${adjustedMinutes.toString().padStart(2, '0')} ${ampm}`;
        }

        // Determine if it's time yet
        const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const notYetTime = compareTimes(now, displayOutTime) < 0;

        outStatus = notYetTime ? "Hang in there!" : "You're good to go!";
        outOverlayColor = notYetTime ? "" : "green";

        clockOutOverlay.classList.remove("default-green", "red", "green", "overlayed");
        clockOutOverlay.classList.add("overlayed");
        clockOutOverlay.classList.add(notYetTime ? "default-green" : "green");

    } else if (data.clockOut) {
        displayOutTime = data.clockOut.time;

        if (compareTimes(displayOutTime, scheduledTimeOut) < 0) {
            // Left early
            outStatus = "Clocked out early";
        } else {
            // On time or overtime
            outStatus = "Great job today!";
        }

        outOverlayColor = compareTimes(displayOutTime, scheduledTimeOut) >= 0 ? "green" : "red";

        if (clockOutPhoto.src !== data.clockOut.selfie) {
            clockOutPhoto.src = data.clockOut.selfie;
        }

        clockOutPhoto.style.display = "block";
        clockOutPhoto.onclick = () => openImageModal(data.clockOut.selfie);
        
        clockOutOverlay.classList.remove("default-green", "red", "green");
        clockOutOverlay.classList.add("overlayed");

    }

    const [outTime, outMeridiem] = splitTime(displayOutTime);
    clockOutTimeSpan.innerHTML = `${outTime}<span class="ampm">${outMeridiem}</span>`;
    clockOutStatus.textContent = outStatus;

    // Visuals
    clockOutOverlay.classList.remove("red", "green");
    if (data.clockOut && outOverlayColor) {
        clockOutOverlay.classList.add(outOverlayColor);
    }


    if (!data.clockOut) {
        clockOutPhoto.src = "";
        clockOutPhoto.style.display = "none";
        clockOutPhoto.onclick = null;

        clockOutOverlay.classList.remove("red", "green", "overlayed");
        clockOutOverlay.classList.add("default-green");
    }

    markOfflineData();
}


function splitTime(fullTimeStr) {
    if (!fullTimeStr) return ["--:--", ""];

    // Match both "9:30 AM" and "9:30:01 AM"
    const match = fullTimeStr.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
    if (!match) return ["--:--", ""];

    const [, hour, minute, ampm] = match;
    return [`${hour}:${minute}`, ampm.toUpperCase()];
}



const floatingPicker = flatpickr("#datePicker", {
    dateFormat: "Y-m-d",
    defaultDate: today,
    maxDate: today,
    disableMobile: true,
    onChange: function (selectedDates) {
        viewDate = selectedDates[0];

        updateDateUI();    
        updateSummaryUI();
        updateGreetingUI();
    },
    onReady: function (_, __, fp) {
        highlightAttendanceDates(fp);
    },
    onMonthChange: function (_, __, fp) {
        highlightAttendanceDates(fp);
    },
    onYearChange: function (_, __, fp) {
        highlightAttendanceDates(fp);
    },
    onValueUpdate: function (_, __, fp) {
        highlightAttendanceDates(fp);
    },
    onOpen: function (_, __, fp) {
        highlightAttendanceDates(fp);
    }
});

function updateDateUI() {
    const now = viewDate;
    const formatted = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const [weekday, ...rest] = formatted.split(', ');
    document.getElementById("dayOfWeek").textContent = weekday;
    document.getElementById("fullDate").textContent = rest.join(', ');

    const formattedStr = formatDate(viewDate);
    datePicker.value = formattedStr;
    if (datePicker._flatpickr) {
        datePicker._flatpickr.jumpToDate(viewDate);
    }
}

document.getElementById("dateDisplay").addEventListener("click", () => {
    floatingPicker.open();
    highlightAttendanceDates(floatingPicker);
});

function openImageModal(src) {
    const modal = document.getElementById("imageModal");
    const image = document.getElementById("modalImage");

    image.src = src;
    modal.style.display = "flex";

    // Close modal on any click, including the image
    modal.onclick = closeImageModal;
}


function closeImageModal() {
    const modal = document.getElementById("imageModal");
    const image = document.getElementById("modalImage");

    modal.style.display = "none";
    image.src = "";
    modal.onclick = null;
}

// document.getElementById("toggleHistoryBtn").addEventListener("click", async () => {
//     const historyDiv = document.getElementById("historyLog");
//     const contentDiv = document.getElementById("historyContent");

//     if (historyDiv.style.display === "none") {
//         historyDiv.style.display = "block";
//         await loadHistoryLogs();
//     } else {
//         historyDiv.style.display = "none";
//     }
// });

async function loadHistoryLogs() {
    const contentDiv = document.getElementById("historyContent");
    const allDates = new Set(await getAttendanceDatesFromFirestore());
    const todayStr = formatDate(today);
    allDates.add(todayStr); // Always include today

    const dates = Array.from(allDates)
        .sort((a, b) => new Date(b) - new Date(a))
        .slice(0, 15);


    let table = `
        <table>
        <colgroup>
            <col style="width: 20%;">
            <col style="width: 20%;">
            <col style="width: 20%;">
            <col style="width: 40%;">
        </colgroup>
        <thead>
            <tr>
            <th>Date</th>
            <th>Clock In</th>
            <th>Clock Out</th>
            <th>Branch</th>
            </tr>
        </thead>
        <tbody>
        `;




    for (const dateKey of dates) {
        const docSnap = await getDoc(doc(db, "attendance", currentUser, "dates", dateKey));
        const data = docSnap.exists() ? docSnap.data() : {};

        table += `
            <tr class="history-row">
            <td>${new Date(dateKey).toLocaleDateString()}</td>
            <td style="vertical-align: top; text-align: center;">
            ${data.clockIn?.selfie
                            ? `<img src="${data.clockIn.selfie}" class="thumb" onclick="openImageModal('${data.clockIn.selfie}')" />`
                            : ''}
            <div style="margin-top: 4px; font-size: 12px;">${data.clockIn?.time || '--'}</div>
            </td>
           <td style="vertical-align: top; text-align: center;">
            ${data.clockOut?.selfie
            ? `<img src="${data.clockOut.selfie}" class="thumb" onclick="openImageModal('${data.clockOut.selfie}')" />`
                : ''}
            <div style="margin-top: 4px; font-size: 12px;">${data.clockOut?.time || '--'}</div>
            </td>
            <td>${data.clockIn?.branch || '--'}</td>
            </tr>
            `;
    }

    table += `</tbody></table>`;
    contentDiv.innerHTML = table;
}


document.getElementById("loginButton").addEventListener("click", loginUser);
document.getElementById("codeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginUser();
});
document.getElementById("clockInCard").addEventListener("click", () => handleClock("in"));
document.getElementById("clockOutCard").addEventListener("click", () => handleClock("out"));


function getTimeBasedGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning,";
    if (hour < 18) return "Good Afternoon,";
    return "Good Evening,";
}

function updateBranchAndShiftSelectors(data = {}) {
    const branchSelect = document.getElementById("branchSelect");
    const savedBranch = data.clockIn?.branch;
    if (savedBranch && [...branchSelect.options].some(o => o.value === savedBranch)) {
        branchSelect.value = savedBranch;
    } else {
        branchSelect.value = "Podium";
    }

    const shiftSelect = document.getElementById("shiftSelect");
    const savedShift = data.clockIn?.shift;
    if (savedShift && [...shiftSelect.options].some(o => o.value === savedShift)) {
        // When shift changes
        shiftSelect.value = savedShift || localStorage.getItem("lastSelectedShift") || "Opening";
    } else {
        shiftSelect.value = "Opening";
    }
}

document.getElementById("shiftSelect").addEventListener("change", async () => {
    const shift = document.getElementById("shiftSelect").value;
    localStorage.setItem("lastSelectedShift", shift); // Save for persistence

    // Immediately update visuals
    const dateKey = formatDate(viewDate);
    const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);
    const docSnap = await getDoc(subDocRef);
    const data = docSnap.exists() ? docSnap.data() : {};
    updateCardTimes(data); // ⬅️ Immediately reflects shift's new time

    // Save if already clocked in
    if (data.clockIn) {
        data.clockIn.shift = shift;
        await setDoc(subDocRef, { clockIn: data.clockIn }, { merge: true });
    }
});

async function syncPendingData() {
    const syncQueue = JSON.parse(localStorage.getItem("syncQueue") || "[]");

    if (syncQueue.length === 0) {
        return;
    }

    console.log(`🔄 Syncing ${syncQueue.length} records...`);

    let successCount = 0;
    let failCount = 0;

    updateSyncStatusVisual('syncing');

    for (const queueItem of syncQueue) {
        // Parse the queue item to get key and action
        const [key, action] = queueItem.split(':');

        if (!key) continue; // Skip invalid entries

        const localData = JSON.parse(localStorage.getItem(key) || "{}");

        // Extract user and date from key
        const [, user, date] = key.split('_');
        if (!user || !date) continue;

        const ref = doc(db, "attendance", user, "dates", date);

        try {
            // First, get current server data to avoid overwriting
            const docSnap = await getDoc(ref);
            let serverData = docSnap.exists() ? docSnap.data() : {};

            // Prepare sync data with careful merging
            const syncData = {};

            // Only sync the specific action (clockIn or clockOut)
            if (action === 'clockIn' || !action) {
                if (localData.clockIn &&
                    (!serverData.clockIn ||
                        !serverData.clockIn.timestamp ||
                        localData.clockIn.timestamp > serverData.clockIn.timestamp)) {
                    const clockInData = { ...localData.clockIn };
                    delete clockInData.synced; // Remove sync flag before saving to Firestore

                    if (clockInData.selfie && clockInData.selfie.startsWith('data:image')) {
                        try {
                            // Upload image to Firebase Storage and get URL
                            clockInData.selfie = await uploadSelfieToStorage(
                                clockInData.selfie, user, date, 'clockIn'
                            );
                        } catch (err) {
                            console.error("Failed to upload clockIn image during sync:", err);
                            // Continue with sync even if image upload fails
                        }
                    }

                    syncData.clockIn = clockInData;
                }
            }

            if (action === 'clockOut' || !action) {
                if (localData.clockOut &&
                    (!serverData.clockOut ||
                        !serverData.clockOut.timestamp ||
                        localData.clockOut.timestamp > serverData.clockOut.timestamp)) {
                    const clockOutData = { ...localData.clockOut };
                    delete clockOutData.synced; // Remove sync flag before saving to Firestore

                    if (clockOutData.selfie && clockOutData.selfie.startsWith('data:image')) {
                        try {
                            // Upload image to Firebase Storage and get URL
                            clockOutData.selfie = await uploadSelfieToStorage(
                                clockOutData.selfie, user, date, 'clockOut'
                            );
                        } catch (err) {
                            console.error("Failed to upload clockOut image during sync:", err);
                            // Continue with sync even if image upload fails
                        }
                    }

                    syncData.clockOut = clockOutData;
                }
            }

            // Only update if we have something to sync
            if (Object.keys(syncData).length > 0) {
                await setDoc(ref, syncData, { merge: true });
                console.log(`Synced fields: ${Object.keys(syncData).join(', ')}`);

                // Update local storage with synced status
                if (syncData.clockIn) {
                    localData.clockIn.synced = true;
                }
                if (syncData.clockOut) {
                    localData.clockOut.synced = true;
                }

                // Recalculate overall sync status
                localData.synced = (!localData.clockIn || localData.clockIn.synced) &&
                    (!localData.clockOut || localData.clockOut.synced);

                localStorage.setItem(key, JSON.stringify(localData));
            } else {
                console.log("No newer data to sync");
            }

            successCount++;
            console.log(`✅ Synced: ${queueItem}`);

            if (syncQueue.length > 2 && (successCount + failCount) % 2 === 0) {
                const progress = Math.round(((successCount + failCount) / syncQueue.length) * 100);
                updateSyncStatusVisual('progress', progress);
            }
        } catch (err) {
            failCount++;
            console.warn(`❌ Failed to sync ${queueItem}:`, err);
        }

        if (syncQueue.length > 2 && (successCount + failCount) % 2 === 0) {
            const progress = Math.round(((successCount + failCount) / syncQueue.length) * 100);
            showToast(`Syncing: ${progress}% complete`, 'syncing', 1500);
        }
    }

    // Show completion toast
    if (successCount > 0) {
        showToast(`Synced ${successCount} records successfully`, 'online', 3000);
    }

    if (failCount > 0) {
        showToast(`${failCount} records failed to sync`, 'offline', 3000);
    }

    // Remove successful items from sync queue
    const updatedQueue = [];
    for (const queueItem of syncQueue) {
        const [key, action] = queueItem.split(':');
        if (!key) continue;

        const data = JSON.parse(localStorage.getItem(key) || "{}");

        // Check if the specific action still needs syncing
        if (action === 'clockIn' && data.clockIn && !data.clockIn.synced) {
            updatedQueue.push(queueItem);
        } else if (action === 'clockOut' && data.clockOut && !data.clockOut.synced) {
            updatedQueue.push(queueItem);
        } else if (!action && !data.synced) {
            updatedQueue.push(queueItem);
        }
    }

    localStorage.setItem("syncQueue", JSON.stringify(updatedQueue));

    if (successCount > 0) {
        updateSyncStatusVisual('success', successCount);

        // Hide the success message after 3 seconds
        setTimeout(() => {
            updateSyncStatusVisual('hide');
        }, 3000);
    }

    // Update status message
    if (updatedQueue.length === 0) {
        document.getElementById("networkStatus").textContent = "✅ Online - All data synced";
    } else {
        document.getElementById("networkStatus").textContent =
            `⚠️ Online - ${successCount} synced, ${updatedQueue.length} pending`;
    }

    console.log(`🔄 Sync complete: ${successCount} successful, ${failCount} failed`);

    // Refresh current view after sync
    updateSummaryUI();
    updateOfflineBadges();
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Setting up network UI and version controls');
    setupNetworkUI();
    setupVersionControls();
    updateNetworkStatusUI();
    checkForUpdates();

    // Set up event listeners
    window.addEventListener('online', () => {
        console.log('Network is online');
        showToast('You are back online', 'online');
        updateNetworkStatusUI();
    });

    window.addEventListener('offline', () => {
        console.log('Network is offline');
        updateNetworkStatusUI();
    });
});

function updateNetworkStatusUI() {
    setupNetworkUI();

    const offlineIndicator = document.querySelector('.mini-offline-indicator');
    if (!offlineIndicator) {
        console.error('Offline indicator not found');
        return;
    }

    if (navigator.onLine) {
        // We're online
        offlineIndicator.classList.remove('show');

        // Check for pending syncs
        const syncQueue = JSON.parse(localStorage.getItem('syncQueue') || '[]');
        if (syncQueue.length > 0 && window._wasOffline) {
            // Only trigger sync without showing a toast
            syncPendingData();
        }
        window._wasOffline = false;
    } else {
        // We're offline
        offlineIndicator.classList.add('show');
        window._wasOffline = true;
    }

    // Update offline badges on cards
    updateOfflineBadges();
}

function addOfflineBadge(cardId) {
    const card = document.getElementById(cardId);
    if (card && !card.querySelector('.offline-badge')) {
        const badge = document.createElement('div');
        badge.className = 'offline-badge';
        badge.textContent = 'Not synced';
        card.appendChild(badge);
    }
}

function updateOfflineBadges() {
    // First remove any existing badges
    document.querySelectorAll('.offline-badge').forEach(badge => {
        badge.remove();
    });

    // Get the current syncQueue
    const syncQueue = JSON.parse(localStorage.getItem('syncQueue') || '[]');
    if (syncQueue.length === 0 && navigator.onLine) {
        return; // No unsynced data and we're online
    }

    // Get today's data
    const todayKey = `attendance_${currentUser}_${formatDate(new Date())}`;
    const todayData = JSON.parse(localStorage.getItem(todayKey) || '{}');

    // Check if specific actions are in the sync queue
    const clockInNeedsSync = syncQueue.includes(`${todayKey}:clockIn`) ||
        (todayData.clockIn && !todayData.clockIn.synced);

    const clockOutNeedsSync = syncQueue.includes(`${todayKey}:clockOut`) ||
        (todayData.clockOut && !todayData.clockOut.synced);

    // Add badges based on individual sync status
    if (clockInNeedsSync && todayData.clockIn) {
        addOfflineBadge('clockInCard');
    }

    if (clockOutNeedsSync && todayData.clockOut) {
        addOfflineBadge('clockOutCard');
    }
}


function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'SYNC_STARTED') {
                const el = document.getElementById("networkStatus");
                const syncProgress = document.getElementById("syncProgress");
                const syncBar = document.querySelector(".sync-bar");

                el.textContent = `🔄 Background sync started`;
                el.classList.add("syncing");
                syncProgress.style.display = "block";
                syncBar.style.width = "10%";
            } else if (event.data && event.data.type === 'SYNC_COMPLETED') {
                updateNetworkStatusUI();
            }
        });
    }
}

// Call this function on page load
registerServiceWorker();

// ✅ Run network status check after definition
updateNetworkStatusUI();

// document.getElementById("greeting").textContent = getTimeBasedGreeting();


// ✅ Expose functions to window for HTML inline events
window.takePhoto = takePhoto;
window.retakePhoto = retakePhoto;
window.submitPhoto = submitPhoto;
window.logoutUser = logoutUser;
window.clearData = clearData;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.handleClock = handleClock;

function checkForUpdates() {
    // First, get the last version the user has seen
    const lastVersion = localStorage.getItem('appVersion') || '0.0';

    // If there's a new version, show update notification
    if (lastVersion !== APP_VERSION) {
        console.log(`New version detected: ${lastVersion} → ${APP_VERSION}`);

        document.getElementById('appUpdateStatus').style.display = 'block';
        document.getElementById('updateMessage').textContent =
            `New version available: ${lastVersion} → ${APP_VERSION}`;
        // Show update modal and offer refresh
        // showUpdateNotification(lastVersion, APP_VERSION);

        // Update stored version
        localStorage.setItem('appVersion', APP_VERSION);
    }
}

function setupVersionControls() {
    // Add version badge to UI
    const versionBadge = document.createElement('div');
    versionBadge.className = 'version-badge';
    versionBadge.textContent = `v${APP_VERSION}`;
    document.body.appendChild(versionBadge);

    // Setup refresh button if it exists
    const refreshBtn = document.getElementById('forceRefresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', forceRefresh);
    }

    // Listen for service worker messages about updates
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data && event.data.type === 'NEW_VERSION') {
                document.getElementById('appUpdateStatus').style.display = 'block';
                document.getElementById('updateMessage').textContent =
                    `New version available: v${event.data.version}`;
            }
        });
    }
}

// Show update notification to users
function showUpdateNotification(oldVersion, newVersion) {
    const updateStatus = document.getElementById('appUpdateStatus');
    if (updateStatus) {
        updateStatus.style.display = 'block';
        const updateMsg = document.getElementById('updateMessage');
        if (updateMsg) {
            updateMsg.textContent = `New version available: ${oldVersion} → ${newVersion}`;
        }
    }
}


// Function to add cache busting query param to all resources
function addCacheBustingParams() {
    // For styles
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    links.forEach(link => {
        if (!link.href.includes('?v=')) {
            link.href = appendVersionToURL(link.href);
        }
    });

    // For scripts
    const scripts = document.querySelectorAll('script[src]');
    scripts.forEach(script => {
        if (!script.src.includes('?v=')) {
            script.src = appendVersionToURL(script.src);
        }
    });
}

// Helper to append version to URLs
function appendVersionToURL(url) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}v=${APP_VERSION}`;
}


// function setupPullToRefresh() {
//     // Create indicator element if it doesn't exist
//     if (!document.querySelector('.pull-indicator')) {
//         const indicator = document.createElement('div');
//         indicator.className = 'pull-indicator';
//         indicator.textContent = 'Pull down to refresh';
//         document.body.prepend(indicator);
//     }

//     // Variables to track touch
//     let startY = 0;
//     let currentY = 0;
//     let refreshing = false;
//     const indicator = document.querySelector('.pull-indicator');

//     // Add touch event listeners
//     document.addEventListener('touchstart', e => {
//         // Only enable pull-to-refresh at the top of the page
//         if (window.scrollY === 0) {
//             startY = e.touches[0].clientY;
//         }
//     }, { passive: true });

//     document.addEventListener('touchmove', e => {
//         if (startY > 0 && !refreshing) {
//             currentY = e.touches[0].clientY;
//             const pullDistance = currentY - startY;

//             // Only show indicator if pulling down
//             if (pullDistance > 0) {
//                 indicator.classList.add('visible');

//                 if (pullDistance > 100) {
//                     indicator.textContent = 'Release to refresh';
//                 } else {
//                     indicator.textContent = 'Pull down to refresh';
//                 }
//             }
//         }
//     }, { passive: true });

//     document.addEventListener('touchend', e => {
//         if (startY > 0 && currentY > 0 && !refreshing) {
//             const pullDistance = currentY - startY;

//             if (pullDistance > 100) {
//                 // Trigger refresh
//                 refreshing = true;
//                 indicator.textContent = 'Refreshing...';
//                 indicator.classList.add('refreshing');

//                 // Force page reload
//                 forceRefresh();
//             } else {
//                 // Hide indicator if not refreshing
//                 indicator.classList.remove('visible');
//             }
//         }

//         // Reset values
//         startY = 0;
//         currentY = 0;
//     }, { passive: true });
// }

// Force refresh function
function forceRefresh() {
    console.log('Force refreshing page...');

    // Clear caches first if possible
    if ('caches' in window) {
        caches.keys().then(function (names) {
            for (let name of names) {
                if (!name.includes(APP_VERSION)) {
                    caches.delete(name);
                }
            }
        });
    }

    // Add timestamp to force reload and bypass cache
    window.location.href = window.location.pathname + '?t=' + Date.now();
}

// Setup Refresh Control
function setupRefreshControl() {
    // Add version badge to UI
    const versionBadge = document.createElement('div');
    versionBadge.className = 'version-badge';
    versionBadge.textContent = `v${APP_VERSION}`;
    document.body.appendChild(versionBadge);

    // Setup pull-to-refresh
    // setupPullToRefresh();

    // Setup refresh button
    document.getElementById('forceRefresh')?.addEventListener('click', forceRefresh);

    // Listen for service worker messages about updates
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data && event.data.type === 'NEW_VERSION') {
                document.getElementById('appUpdateStatus').style.display = 'block';
                document.getElementById('updateMessage').textContent =
                    `New version available: v${event.data.version}`;
            }
        });
    }

    // Periodically check for new versions (every 15 minutes)
    setInterval(checkForNewVersion, 15 * 60 * 1000);
}

// Check if there's a new version available
function checkForNewVersion() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        // Create a message channel
        const messageChannel = new MessageChannel();

        // Handler for receiving message from service worker
        messageChannel.port1.onmessage = event => {
            if (event.data && event.data.type === 'VERSION_INFO') {
                const swVersion = event.data.version;

                // If service worker has a newer version than we do
                if (swVersion !== APP_VERSION) {
                    document.getElementById('appUpdateStatus').style.display = 'block';
                    document.getElementById('updateMessage').textContent =
                        `New version available: v${swVersion}`;
                }
            }
        };

        // Send message to service worker
        navigator.serviceWorker.controller.postMessage({
            type: 'CHECK_VERSION'
        }, [messageChannel.port2]);
    }
}

// Call this during initialization
document.addEventListener('DOMContentLoaded', setupRefreshControl);

setupNetworkListeners();

function setupNetworkListeners() {
    window.addEventListener('online', async () => {
        console.log('🌐 Network is online');
        showToast('You are back online', 'online');
        updateNetworkStatusUI();

        // Wait a bit to ensure connection is stable before trying to sync
        setTimeout(() => {
            syncPendingData();
        }, 2000);
    });

    window.addEventListener('offline', () => {
        console.log('📴 Network is offline');
        showToast('You are offline - changes will sync later', 'offline');
        updateNetworkStatusUI();
    });
}

// 5. Add this function to manually refresh sync status
function refreshSyncStatus() {
    const syncQueue = JSON.parse(localStorage.getItem('syncQueue') || '[]');
    if (syncQueue.length > 0 && navigator.onLine) {
        syncPendingData();
    } else {
        updateOfflineBadges();
    }
}

// Call this function when appropriate to manually refresh statuses
// For example after login or periodically
setInterval(refreshSyncStatus, 60000);

function setupNetworkUI() {
    // Create toast container with proper positioning
    if (!document.querySelector('.toast-container')) {
        createToastContainer();
        console.log('Toast container created with proper positioning');
    }

    // Create mini offline indicator if needed
    if (!document.querySelector('.mini-offline-indicator')) {
        const indicator = document.createElement('div');
        indicator.className = 'mini-offline-indicator';
        indicator.innerHTML = '<div class="offline-dot"></div> <span>Offline</span>';
        document.body.appendChild(indicator);
    }
}

function createToastContainer() {
    // Remove any existing container first to prevent duplicates
    const existing = document.querySelector('.toast-container');
    if (existing) {
        existing.remove();
    }

    // Create new container
    const container = document.createElement('div');
    container.className = 'toast-container';

    // Add to document
    document.body.appendChild(container);

    return container;
}


function showToast(message, type = '', duration = 3000) {
    // Skip showing toast if it's about updates and the update notification is visible
    if (message.includes('version') || message.includes('update')) {
        // Check if update notification is already visible
        const updateStatus = document.getElementById('appUpdateStatus');
        if (updateStatus && updateStatus.style.display === 'block') {
            return; // Skip showing redundant toast
        }
    }

    // Create toast container if it doesn't exist yet
    if (!document.querySelector('.toast-container')) {
        setupNetworkUI();
    }

    const container = document.querySelector('.toast-container');
    if (!container) {
        console.error('Toast container not found');
        return;
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast-message ${type || ''}`;

    // Set the message content
    toast.textContent = message;

    // Add to container
    container.appendChild(toast);

    // Trigger animation (slightly longer delay to ensure DOM update)
    setTimeout(() => {
        toast.classList.add('show');
    }, 20);

    // Remove after duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, duration);

    return toast;
}

document.addEventListener('DOMContentLoaded', function () {
    // Get username element
    const userNameElement = document.getElementById('userName');
    const switchUserModal = document.getElementById('switchUserModal');
    const cancelSwitchUserBtn = document.getElementById('cancelSwitchUser');
    const confirmSwitchUserBtn = document.getElementById('confirmSwitchUser');

    // Add click event to username
    if (userNameElement) {
        userNameElement.addEventListener('click', function () {
            // Show the switch user modal
            switchUserModal.style.display = 'flex';
        });
    }

    // Cancel button event
    if (cancelSwitchUserBtn) {
        cancelSwitchUserBtn.addEventListener('click', function () {
            switchUserModal.style.display = 'none';
        });
    }

    // Confirm button event - call the existing logoutUser function
    if (confirmSwitchUserBtn) {
        confirmSwitchUserBtn.addEventListener('click', function () {
            logoutUser(); // This uses the existing logout function
        });
    }

    // Close modal when clicking outside the content area
    switchUserModal.addEventListener('click', function (event) {
        if (event.target === switchUserModal) {
            switchUserModal.style.display = 'none';
        }
    });
});

document.addEventListener('DOMContentLoaded', function () {
    // Initialize bottom tabs
    const dailyViewTab = document.getElementById('dailyViewTab');
    const payrollViewTab = document.getElementById('payrollViewTab');
    const summaryCardUI = document.getElementById('summaryCardUI');
    const payrollView = document.getElementById('payrollView');

    if (dailyViewTab && payrollViewTab && summaryCardUI && payrollView) {
        // Switch to daily view
        dailyViewTab.addEventListener('click', function () {
            // Update active tab
            dailyViewTab.classList.add('active');
            payrollViewTab.classList.remove('active');

            // Show daily view, hide payroll view
            summaryCardUI.style.display = 'block';
            payrollView.style.display = 'none';

            // Hide history log if it's open
            const historyLog = document.getElementById('historyLog');
            if (historyLog) historyLog.style.display = 'none';

            // Show timestamp
            if (timestamp) timestamp.style.display = 'block';
        });

        // Switch to payroll view
        payrollViewTab.addEventListener('click', function () {
            // Update active tab
            payrollViewTab.classList.add('active');
            dailyViewTab.classList.remove('active');

            // Hide daily view, show payroll view
            summaryCardUI.style.display = 'none';
            payrollView.style.display = 'block';

            // Hide history log if it's open
            const historyLog = document.getElementById('historyLog');
            if (historyLog) historyLog.style.display = 'none';

            // Hide timestamp
            if (timestamp) timestamp.style.display = 'none';

            // Load payroll data when switching to this view
            if (typeof loadPayrollData === 'function') {
                loadPayrollData();
            }
        });
    }

    // Add a change listener to the payroll period selector
    const payrollPeriod = document.getElementById('payrollPeriod');
    if (payrollPeriod) {
        payrollPeriod.addEventListener('change', function () {
            if (typeof loadPayrollData === 'function') {
                loadPayrollData();
            }
        });
    }

    // Initialize username click for switch user modal
    const userNameElement = document.getElementById('userName');
    const switchUserModal = document.getElementById('switchUserModal');
    const cancelSwitchUserBtn = document.getElementById('cancelSwitchUser');
    const confirmSwitchUserBtn = document.getElementById('confirmSwitchUser');

    if (userNameElement && switchUserModal) {
        // Add click event to username
        userNameElement.addEventListener('click', function () {
            // Show the switch user modal
            switchUserModal.style.display = 'flex';
        });

        // Cancel button event
        if (cancelSwitchUserBtn) {
            cancelSwitchUserBtn.addEventListener('click', function () {
                switchUserModal.style.display = 'none';
            });
        }

        // Confirm button event - call the existing logoutUser function
        if (confirmSwitchUserBtn) {
            confirmSwitchUserBtn.addEventListener('click', function () {
                if (typeof logoutUser === 'function') {
                    logoutUser(); // This uses the existing logout function
                }
            });
        }

        // Close modal when clicking outside the content area
        switchUserModal.addEventListener('click', function (event) {
            if (event.target === switchUserModal) {
                switchUserModal.style.display = 'none';
            }
        });
    }
});

// Helper function to generate mock data for the payroll view
async function generateMockPayrollData(dates) {
    // If we're online, try to fetch real data first
    if (navigator.onLine && currentUser) {
        try {
            const realData = [];

            for (const dateStr of dates) {
                try {
                    const docRef = doc(db, "attendance", currentUser, "dates", dateStr);
                    const docSnap = await getDoc(docRef);

                    if (docSnap.exists()) {
                        const data = docSnap.data();

                        // If we have clock in and out times, calculate hours
                        let hours = null;
                        if (data.clockIn && data.clockOut) {
                            hours = calculateHours(data.clockIn.time, data.clockOut.time);
                        }

                        realData.push({
                            date: dateStr,
                            timeIn: data.clockIn?.time || null,
                            timeOut: data.clockOut?.time || null,
                            hours: hours
                        });
                    } else {
                        // No data for this date
                        realData.push({
                            date: dateStr,
                            timeIn: null,
                            timeOut: null,
                            hours: null
                        });
                    }
                } catch (error) {
                    console.error(`Error fetching data for ${dateStr}:`, error);
                }
            }

            return realData;
        } catch (error) {
            console.error("Failed to fetch real attendance data:", error);
            // Fall back to mock data
        }
    }

    // Generate mock data if we couldn't get real data
    return dates.map(date => {
        const mockDate = new Date(date);
        const dayOfWeek = mockDate.getDay();

        // No work on weekends in our mock data
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            return {
                date: date,
                timeIn: null,
                timeOut: null,
                hours: null
            };
        }

        // Generate random attendance
        const hasAttendance = Math.random() > 0.2; // 80% chance of attendance

        if (!hasAttendance) {
            return {
                date: date,
                timeIn: null,
                timeOut: null,
                hours: null
            };
        }

        // Generate time in (around 9:30 AM)
        const hourIn = 9;
        const minuteIn = Math.floor(Math.random() * 60);
        const timeIn = `${hourIn}:${minuteIn.toString().padStart(2, '0')} AM`;

        // Generate time out (around 6:30 PM)
        const hourOut = 6;
        const minuteOut = Math.floor(Math.random() * 60);
        const timeOut = `${hourOut}:${minuteOut.toString().padStart(2, '0')} PM`;

        // Calculate hours (roughly)
        const hours = 9 + (minuteOut - minuteIn) / 60;

        return {
            date: date,
            timeIn: timeIn,
            timeOut: timeOut,
            hours: hours
        };
    });
}

function parsePeriod(periodStr) {
    // For "March 29 - April 12, 2025" format (cross month)
    const multiMonthParts = periodStr.match(/([A-Za-z]+)\s+(\d+)\s+-\s+([A-Za-z]+)\s+(\d+),\s+(\d+)/);
    if (multiMonthParts) {
        return [multiMonthParts[1], multiMonthParts[2], multiMonthParts[3], multiMonthParts[4], multiMonthParts[5]];
    }

    // For "March 13 - March 28, 2025" format (same month)
    const sameMonthParts = periodStr.match(/([A-Za-z]+)\s+(\d+)\s+-\s+\1\s+(\d+),\s+(\d+)/);
    if (sameMonthParts) {
        return [sameMonthParts[1], sameMonthParts[2], sameMonthParts[1], sameMonthParts[3], sameMonthParts[4]];
    }

    return ['March', '29', 'April', '12', '2025']; // Default fallback
}

// Helper function to get month index from name
function getMonthIndex(monthName) {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months.findIndex(m => m.toLowerCase().startsWith(monthName.toLowerCase()));
}

// Helper function to get all dates in a range
function getDatesInRange(startDate, endDate) {
    const dates = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
        dates.push(formatDate(new Date(currentDate)));
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
}

// Helper function to calculate hours between two time strings
function calculateHours(timeInStr, timeOutStr) {
    try {
        // Parse time strings
        const [timeIn, meridianIn] = timeInStr.split(' ');
        const [hoursIn, minutesIn] = timeIn.split(':').map(Number);

        const [timeOut, meridianOut] = timeOutStr.split(' ');
        const [hoursOut, minutesOut] = timeOut.split(':').map(Number);

        // Convert to 24-hour format
        let hours24In = hoursIn;
        if (meridianIn === 'PM' && hoursIn !== 12) hours24In += 12;
        if (meridianIn === 'AM' && hoursIn === 12) hours24In = 0;

        let hours24Out = hoursOut;
        if (meridianOut === 'PM' && hoursOut !== 12) hours24Out += 12;
        if (meridianOut === 'AM' && hoursOut === 12) hours24Out = 0;

        // Calculate difference in hours
        const totalMinutesIn = hours24In * 60 + minutesIn;
        const totalMinutesOut = hours24Out * 60 + minutesOut;

        // If clock out is earlier than clock in, assume next day
        let minutesDiff = totalMinutesOut - totalMinutesIn;
        if (minutesDiff < 0) minutesDiff += 24 * 60;

        return minutesDiff / 60;
    } catch (error) {
        console.error("Error calculating hours:", error);
        return null;
    }
}

// Function to load payroll data
async function loadPayrollData() {
    const tableBody = document.getElementById('payrollTableBody');
    
    if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">Loading...</td></tr>';
    }

    // Update payroll period immediately
    const periodLabel = document.getElementById('currentPeriodLabel');
    if (periodLabel) {
        periodLabel.textContent = selectedPeriod;
    }

    // Get the selected payroll period
    const periodSelect = document.getElementById('payrollPeriod');
    if (!periodSelect) return;

    const selectedPeriod = periodSelect.value;
    const cacheKey = `payroll_cache_${currentUser}_${selectedPeriod}`;
    const cachedData = localStorage.getItem(cacheKey);

    if (cachedData) {
    // Use cached data immediately
        updatePayrollUI(JSON.parse(cachedData));

        // Then refresh in background if online
        if (navigator.onLine) {
            fetchFreshPayrollData(selectedPeriod, cacheKey);
        }
    } else {
        // No cache, fetch new data
        fetchFreshPayrollData(selectedPeriod, cacheKey);
    }
    

    // Parse the period to get start and end dates
    const [startMonth, startDay, endMonth, endDay, year] = parsePeriod(selectedPeriod);

    // Create date objects for the period
    const startDate = new Date(year, getMonthIndex(startMonth), parseInt(startDay));
    const endDate = new Date(year, getMonthIndex(endMonth), parseInt(endDay));

    // Get all dates in the period
    const dates = getDatesInRange(startDate, endDate);

    // Try to get real data
    const payrollData = await fetchPayrollData(dates);

    // Update the UI with the data
    updatePayrollUI(payrollData);
}

async function fetchFreshPayrollData(selectedPeriod, cacheKey) {
    // Parse period and get data as you currently do
    const [startMonth, startDay, endMonth, endDay, year] = parsePeriod(selectedPeriod);
    const startDate = new Date(year, getMonthIndex(startMonth), parseInt(startDay));
    const endDate = new Date(year, getMonthIndex(endMonth), parseInt(endDay));
    const dates = getDatesInRange(startDate, endDate);

    const payrollData = await fetchPayrollData(dates);

    // Cache the result
    localStorage.setItem(cacheKey, JSON.stringify(payrollData));

    // Update UI
    updatePayrollUI(payrollData);
}

async function fetchPayrollData(dates) {
    if (navigator.onLine && currentUser) {
        try {
            const realData = [];

            for (const dateStr of dates) {
                try {
                    const docRef = doc(db, "attendance", currentUser, "dates", dateStr);
                    const docSnap = await getDoc(docRef);

                    if (docSnap.exists()) {
                        const data = docSnap.data();

                        // Get scheduled times based on shift
                        let scheduledIn = null;
                        let scheduledOut = null;

                        if (data.clockIn?.shift) {
                            const shift = data.clockIn.shift;
                            const schedule = SHIFT_SCHEDULES[shift] || SHIFT_SCHEDULES["Opening"];
                            scheduledIn = schedule.timeIn;
                            scheduledOut = schedule.timeOut;
                        }

                        // If we have clock in and out times, calculate hours
                        let hours = null;
                        if (data.clockIn && data.clockOut) {
                            hours = calculateHours(data.clockIn.time, data.clockOut.time);
                        }

                        // Format time without seconds
                        let timeIn = null;
                        if (data.clockIn?.time) {
                            timeIn = data.clockIn.time.replace(/(\d+:\d+)(:\d+)?\s+(AM|PM)/i, '$1 $3');
                        }

                        let timeOut = null;
                        if (data.clockOut?.time) {
                            timeOut = data.clockOut.time.replace(/(\d+:\d+)(:\d+)?\s+(AM|PM)/i, '$1 $3');
                        }

                        realData.push({
                            date: dateStr,
                            timeIn: data.clockIn?.time || null,
                            timeOut: data.clockOut?.time || null,
                            branch: data.clockIn?.branch || null,
                            shift: data.clockIn?.shift || null,
                            scheduledIn: scheduledIn,
                            scheduledOut: scheduledOut,
                            hours: hours
                        });
                    } else {
                        // No data for this date
                        realData.push({
                            date: dateStr,
                            timeIn: null,
                            timeOut: null,
                            branch: null,
                            shift: null,
                            scheduledIn: null,
                            scheduledOut: null,
                            hours: null
                        });
                    }
                } catch (error) {
                    console.error(`Error fetching data for ${dateStr}:`, error);
                    // Add empty data for this date in case of error
                    realData.push({
                        date: dateStr,
                        timeIn: null,
                        timeOut: null,
                        branch: null,
                        shift: null,
                        scheduledIn: null,
                        scheduledOut: null,
                        hours: null
                    });
                }
            }

            return realData;
        } catch (error) {
            console.error("Failed to fetch real attendance data:", error);
            // Fall back to mock data if there's an error
        }
    }

    // Generate mock data if we couldn't get real data
    return generateMockData(dates);
}


// Function to generate mock data
function generateMockData(dates) {
    const branches = ["Podium", "SM North", "Pop-up", "Workshop"];
    const shifts = ["Opening", "Midshift", "Closing"];

    return dates.map(date => {
        const mockDate = new Date(date);
        const dayOfWeek = mockDate.getDay();

        // No work on weekends in our mock data
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            return {
                date: date,
                timeIn: null,
                timeOut: null,
                branch: null,
                shift: null,
                scheduledIn: null,
                scheduledOut: null,
                hours: null
            };
        }

        // Generate random attendance
        const hasAttendance = Math.random() > 0.2; // 80% chance of attendance

        if (!hasAttendance) {
            return {
                date: date,
                timeIn: null,
                timeOut: null,
                branch: null,
                shift: null,
                scheduledIn: null,
                scheduledOut: null,
                hours: null
            };
        }

        // Random branch and shift
        const branch = branches[Math.floor(Math.random() * branches.length)];
        const shift = shifts[Math.floor(Math.random() * shifts.length)];

        // Get scheduled times based on shift
        const schedule = SHIFT_SCHEDULES[shift] || SHIFT_SCHEDULES["Opening"];
        const scheduledIn = schedule.timeIn;
        const scheduledOut = schedule.timeOut;

        // Generate time in (based on scheduled with possible lateness)
        const isLate = Math.random() > 0.7; // 30% chance of being late
        const [scheduledHour, scheduledMin] = scheduledIn.split(':')[0].trim();
        const lateBy = isLate ? Math.floor(Math.random() * 30) : -Math.floor(Math.random() * 10);
        const hourIn = scheduledHour;
        const minuteIn = (parseInt(scheduledMin) + lateBy).toString().padStart(2, '0');
        const timeIn = `${hourIn}:${minuteIn} AM`;

        // Generate time out
        const [scheduledOutHour, scheduledOutMin] = scheduledOut.split(':')[0].trim();
        const earlyBy = Math.random() > 0.8 ? Math.floor(Math.random() * 20) : -Math.floor(Math.random() * 30);
        const hourOut = scheduledOutHour;
        const minuteOut = (parseInt(scheduledOutMin) - earlyBy).toString().padStart(2, '0');
        const timeOut = `${hourOut}:${minuteOut} PM`;

        // Calculate hours (roughly)
        const hours = 9 + (parseInt(minuteOut) + earlyBy - parseInt(minuteIn) - lateBy) / 60;

        return {
            date: date,
            timeIn: timeIn,
            timeOut: timeOut,
            branch: branch,
            shift: shift,
            scheduledIn: scheduledIn,
            scheduledOut: scheduledOut,
            hours: hours
        };
    });
}

function updatePayrollUI(payrollData) {
    // Calculate summary values
    const daysWorked = payrollData.filter(day => day.timeIn && day.timeOut).length;

    // Calculate total late hours
    const totalLateHours = payrollData.reduce((sum, day) => {
        // If there's clock in data and scheduled data
        if (day.timeIn && day.scheduledIn) {
            const lateMinutes = compareTimes(day.timeIn, day.scheduledIn);
            // Only count if actually late
            return sum + (lateMinutes > 0 ? lateMinutes / 60 : 0);
        }
        return sum;
    }, 0);

    // Update summary cards
    const summaryValues = document.querySelectorAll('.summary-value');
    if (summaryValues.length >= 2) {
        summaryValues[0].textContent = totalLateHours.toFixed(1); // Late hours
        summaryValues[1].textContent = daysWorked; // Days worked
    }

    // Populate the table
    const tableBody = document.getElementById('payrollTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '';

    payrollData.forEach(day => {
        const row = document.createElement('tr');

        // Highlight row if it's today
        const isToday = formatDate(new Date()) === day.date;
        if (isToday) {
            row.style.backgroundColor = 'rgba(43, 147, 72, 0.1)';
            row.style.fontWeight = '600';
        }

        // Create a clickable date cell with mobile-optimized layout
        const dateCell = document.createElement('td');
        dateCell.className = 'date-cell';

        const dateParts = new Date(day.date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            weekday: 'short'
        }).split(', ');

        // Create two spans for date and day of week
        const dateSpan = document.createElement('span');
        dateSpan.className = 'date-day';
        dateSpan.textContent = dateParts[1]; // Apr 12

        const dowSpan = document.createElement('span');
        dowSpan.className = 'date-dow';
        dowSpan.textContent = dateParts[0]; // Mon

        dateCell.appendChild(dateSpan);
        dateCell.appendChild(dowSpan);

        dateCell.style.cursor = 'pointer';
        dateCell.style.color = '#2b9348';

        // Add click handler to go to the daily view of this date
        dateCell.addEventListener('click', () => {
            const dateParts = day.date.split('-');
            const selectedDate = new Date(
                parseInt(dateParts[0]),
                parseInt(dateParts[1]) - 1,
                parseInt(dateParts[2])
            );

            // Update the view date and switch to daily view
            viewDate = selectedDate;
            updateDateUI();
            updateSummaryUI();

            // Switch tabs
            document.getElementById('dailyViewTab').click();
        });

        row.appendChild(dateCell);

        // Time in cell
        const timeInCell = document.createElement('td');
        timeInCell.textContent = day.timeIn || '--';
        row.appendChild(timeInCell);

        // Time out cell
        const timeOutCell = document.createElement('td');
        timeOutCell.textContent = day.timeOut || '--';
        row.appendChild(timeOutCell);

        // Branch cell
        const branchCell = document.createElement('td');
        branchCell.textContent = day.branch || '--';
        row.appendChild(branchCell);

        // Shift cell
        const shiftCell = document.createElement('td');
        shiftCell.textContent = day.shift || '--';
        row.appendChild(shiftCell);

        // Hours cell
        const hoursCell = document.createElement('td');
        hoursCell.textContent = day.hours ? day.hours.toFixed(1) : '--';

        // Add visual indicator for overtime or short hours
        if (day.hours > 9) {
            hoursCell.style.color = '#ff6b6b';
            hoursCell.style.fontWeight = '600';
        } else if (day.hours && day.hours < 8) {
            hoursCell.style.color = '#ff9500';
        }

        row.appendChild(hoursCell);

        tableBody.appendChild(row);
    });
}

async function populatePayrollPeriods() {
    const periodSelect = document.getElementById('payrollPeriod');
    if (!periodSelect) return;

    // Clear existing options
    periodSelect.innerHTML = '';

    if (!navigator.onLine || !currentUser) {
        // Fallback periods if offline
        addPeriodOption(periodSelect, "May 29 - Jun 12, 2025");
        addPeriodOption(periodSelect, "May 13 - May 28, 2025");
        addPeriodOption(periodSelect, "Apr 29 - May 12, 2025");
        addPeriodOption(periodSelect, "Apr 13 - Apr 27, 2025");
        return;
    }

    // Define the current date and a range of 6 months back
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);

    // Generate base periods
    const periods = generatePayrollPeriods(sixMonthsAgo, now);

    try {
        // Get all dates with attendance data
        const attendanceDates = await getAttendanceDatesFromFirestore();

        if (attendanceDates && attendanceDates.length > 0) {
            // Filter periods that have attendance data
            const sortedDates = attendanceDates.sort((a, b) => new Date(b) - new Date(a));

            const periodsWithData = periods.filter(period => {
                return sortedDates.some(dateStr => {
                    const date = new Date(dateStr);
                    return date >= period.start && date <= period.end;
                });
            });

            // Add periods to select
            if (periodsWithData.length > 0) {
                periodsWithData.forEach(period => {
                    addPeriodOption(periodSelect, period.label);
                });
            } else {
                // No periods with data, add default periods
                periods.slice(0, 4).forEach(period => {
                    addPeriodOption(periodSelect, period.label);
                });
            }
        } else {
            // No attendance data, add default periods
            periods.slice(0, 4).forEach(period => {
                addPeriodOption(periodSelect, period.label);
            });
        }
    } catch (error) {
        console.error("Error fetching attendance dates:", error);
        // Fallback to default periods on error
        periods.slice(0, 4).forEach(period => {
            addPeriodOption(periodSelect, period.label);
        });
    }
}

function generatePayrollPeriods(startDate, endDate) {
    const periods = [];
    const normalize = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
    startDate = normalize(startDate);
    endDate = normalize(endDate);

    let current = new Date(startDate);
    while (current <= endDate) {
        const year = current.getFullYear();
        const month = current.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // First cutoff: always the 12th of the month (3 days before 15th)
        const firstCutoffDay = 12;

        // Second cutoff: 3 days before end of month
        const secondCutoffDay = daysInMonth - 3;

        // Late month period: (13th to 3 days before end of month)
        const lateStart = new Date(year, month, 13);
        const lateEnd = new Date(year, month, secondCutoffDay);

        // Early month period: (3 days before end of prev month + 1) to 12th
        const earlyStart = new Date(year, month, secondCutoffDay + 1);
        const earlyEnd = new Date(year, month + 1, firstCutoffDay);

        if (lateStart <= endDate) {
            const lateLabel = formatPeriod(lateStart, lateEnd);
            periods.push({
                start: lateStart,
                end: lateEnd,
                label: lateLabel
            });
        }

        if (earlyStart <= endDate) {
            const earlyLabel = formatPeriod(earlyStart, earlyEnd);
            periods.push({
                start: earlyStart,
                end: earlyEnd,
                label: earlyLabel
            });
        }

        // Move to next month
        current = new Date(year, month + 1, 1);
    }

    // Sort periods with most recent first
    return periods.sort((a, b) => b.end - a.end);
}

function formatPeriod(startDate, endDate) {
    const startMonth = startDate.toLocaleString('default', { month: 'long' });
    const startDay = startDate.getDate();
    const endMonth = endDate.toLocaleString('default', { month: 'long' });
    const endDay = endDate.getDate();
    const periodYear = endDate.getFullYear();

    return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${periodYear}`;
}

function addPeriodOption(selectElement, periodText) {
    const option = document.createElement('option');
    option.textContent = periodText;
    selectElement.appendChild(option);
}

// Call this when loading the payroll view
document.getElementById('payrollViewTab').addEventListener('click', function () {
    // First populate the periods, then load data
    populatePayrollPeriods().then(() => {
        if (typeof loadPayrollData === 'function') {
            loadPayrollData();
        }
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const codeInput = document.getElementById('codeInput');

    // Only modify if we're on desktop and the login form exists
    if (isDesktop() && loginForm && codeInput) {
        const loginButton = document.getElementById('loginButton');
        if (loginButton) {
            loginButton.addEventListener('click', desktopLogin);
        }

        // Add a device indicator for POS mode
        const deviceIndicator = document.createElement('div');
        deviceIndicator.className = 'device-indicator';
        deviceIndicator.textContent = '💻 POS Mode';
        loginForm.appendChild(deviceIndicator);
    }
});

function isDesktop() {
    // Check if screen width is larger than typical mobile breakpoint
    return window.innerWidth >= 768;
}

function desktopLogin() {
    const nameDropdown = document.getElementById('nameDropdown');
    if (!nameDropdown || !nameDropdown.value) {
        alert("Please select an employee");
        return;
    }


    // Set the selected code to the code input
    const codeInput = document.getElementById('codeInput');
    codeInput.value = nameDropdown.value;

    // Call the original login function
    loginUser();
}

// 4. Update the original codeInput event listener to ensure it doesn't interfere
document.removeEventListener('DOMContentLoaded', () => {
    const codeInput = document.getElementById('codeInput');
    if (codeInput) {
        codeInput.removeEventListener('keydown', (e) => {
            if (e.key === "Enter") loginUser();
        });

        // Add it back conditionally
        if (!isDesktop()) {
            codeInput.addEventListener('keydown', (e) => {
                if (e.key === "Enter") loginUser();
            });
        }
    }
});

function formatEmployeeName(fullName) {
    const nameParts = fullName.split(' ');
    
    // If name has only one or two parts, show the full name
    if (nameParts.length > 1) {
        return nameParts.slice(0, -1).join(' ');
    }
}

function createEmployeeSquaresUI() {
    const loginForm = document.getElementById('loginForm');
    const codeInput = document.getElementById('codeInput');

    if (!loginForm || !codeInput || !isDesktop()) return;

    const existingGrid = loginForm.querySelector('.employee-grid');
    if (existingGrid) existingGrid.remove();

    const existingGridTitle = loginForm.querySelector('.grid-title');
    if (existingGridTitle) existingGridTitle.remove();

    // Remove any existing device indicators to avoid duplicates
    const existingIndicators = loginForm.querySelectorAll('.device-indicator');
    existingIndicators.forEach(el => el.remove());

    // Hide the code input field and login button on desktop
    codeInput.style.display = 'none';

    // Create a container for the employee squares
    const gridContainer = document.createElement('div');
    gridContainer.className = 'employee-grid';

    gridContainer.style.margin = '4rem auto';
    gridContainer.style.justifyContent = 'center';

    // Add all employees as squares with consistent formatting
    for (const [code, name] of Object.entries(employees)) {
        if (!podiumPOSAccess.includes(code)) continue;

        const employeeSquare = document.createElement('div');
        employeeSquare.className = 'employee-square';
        employeeSquare.setAttribute('data-code', code);

        // Format the name - simplify to first name(s) without last name
        const displayName = formatEmployeeName(name);
        employeeSquare.textContent = displayName;

        // Add click event
        employeeSquare.addEventListener('click', function () {
            // Show immediate visual feedback
            document.querySelectorAll('.employee-square').forEach(square => {
                square.classList.remove('selected');
            });
            this.classList.add('selected');

            // Show loading toast immediately
            showToast('Logging in...', 'syncing');

            // Set the code and login
            codeInput.value = this.getAttribute('data-code');
            setTimeout(() => loginUser(), 50);
        });

        gridContainer.appendChild(employeeSquare);
    }

    // Add the grid to the form AFTER the title
    loginForm.appendChild(gridContainer);

    // Add POS mode indicator (only once) AFTER the grid
    const deviceIndicator = document.createElement('div');
    deviceIndicator.className = 'device-indicator';
    deviceIndicator.textContent = '💻 POS Mode';
    loginForm.appendChild(deviceIndicator);

    // Hide the login button on desktop since we auto-login on selection
    const loginButton = document.getElementById('loginButton');
    if (loginButton) {
        loginButton.style.display = 'none';
    }

    // Add a logo above everything else
    const existingLogo = loginForm.querySelector('.logo');
    if (!existingLogo) {
        const logo = document.createElement('img');
        logo.className = 'logo';
        logo.src = 'logo.png'; // Update this with your actual logo path
        logo.alt = 'Logo';
        loginForm.insertBefore(logo, loginForm.firstChild);
    }
}

const originalLoginUser = window.loginUser;

// Override the loginUser function to handle employee square selection
window.loginUser = function () {
    const code = document.getElementById("codeInput").value.trim();

    // Skip the empty code check if we're on desktop and have a selected employee
    if (isDesktop() && document.querySelector('.employee-square.selected')) {
        // Continue with login process without empty code alert
    } else if (!code) {
        return alert("Please enter a code");
    }

    // Continue with the original function
    return originalLoginUser.apply(this, arguments);
};

// Call this function when DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
    if (isDesktop()) {
        createEmployeeSquaresUI();

        // Also resize the login form container for better display
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.style.height = 'auto'; // Override the 90vh height
        }
    }

    // Add window resize handler to switch between mobile and desktop
    window.addEventListener('resize', function () {
        const wasDesktop = document.querySelector('.employee-grid') !== null;
        const isDesktopNow = isDesktop();

        if (wasDesktop !== isDesktopNow) {
            // Refresh the page when switching between mobile and desktop modes
            location.reload();
        }
    });
});