const APP_VERSION = "0.81"; 

function isDebugMode() {
    return currentUser === "130229";
}

function ALLOW_PAST_CLOCKING() {
    return isDebugMode();
}

let dutyStatus = "in";
let selfieData = "";
let currentUser = localStorage.getItem("loggedInUser") || "";
let today = new Date();
today.setHours(0, 0, 0, 0);
let viewDate = new Date();
let stream = null;

// Holiday data - will be loaded from Firebase
let HOLIDAYS_2025 = {};
let holidaysLoaded = false;

let showMyScheduleOnly = true;
let selectedBranch = 'all';

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
    "Opening": { timeIn: "9:30 AM", timeOut: "6:30 PM" },
    "Opening Half-Day": { timeIn: "9:30 AM", timeOut: "1:30 PM" },
    "Midshift": { timeIn: "11:00 AM", timeOut: "8:00 PM" },
    "Closing": { timeIn: "1:00 PM", timeOut: "10:00 PM" },
    "Closing Half-Day": { timeIn: "6:00 PM", timeOut: "10:00 PM" },
    "Custom": { timeIn: null, timeOut: null }
};

// At top of your script.js
import { db } from './firebase-setup.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { storage, ref as storageRef, uploadBytes, getDownloadURL } from './firebase-setup.js';

let employees = {}; // Will be populated from Firebase
let employeesLoaded = false;
let employeeNicknames = {};

async function loadEmployees() {
    if (employeesLoaded) return employees;

    try {
        const employeesRef = collection(db, "employees");
        const snapshot = await getDocs(employeesRef);

        employees = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            employees[doc.id] = data.name;
        });

        employeesLoaded = true;
        console.log(`Loaded ${Object.keys(employees).length} employees from Firebase`);
        return employees;
    } catch (error) {
        console.error("Failed to load employees:", error);
        return {};
    }
}

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

    // Load employees if not already loaded
    await loadEmployees();

    // Check if we've previously cached this user's data
    const cachedUserData = localStorage.getItem(`userCache_${code}`);

    if (!navigator.onLine) {
        // Offline login logic
        if (cachedUserData) {
            const userData = JSON.parse(cachedUserData);
            currentUser = code;
            localStorage.setItem("loggedInUser", code);
            localStorage.setItem("userName", userData.name || "Employee");

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
        const docRef = doc(db, "employees", code); // Changed from "staff" to "employees"
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            currentUser = code;
            localStorage.setItem("loggedInUser", code);

            const userData = docSnap.data();
            localStorage.setItem("userName", userData.name);

            // Cache user data for offline login
            localStorage.setItem(`userCache_${code}`, JSON.stringify(userData));

            showMainInterface(code);
            updateGreetingUI();
            await updateSummaryUI();
            await loadHolidays();

            // Background caching
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


    if (!holidaysLoaded) {
        await loadHolidays();
    }
    
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
    const time = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });

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
            const docSnap = await getDoc(doc(db, "employees", currentUser));
            if (docSnap.exists()) {
                name = docSnap.data().nick;
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


// Update the branch select listener
document.getElementById("branchSelect").addEventListener("change", function () {
    const selectedBranch = this.value;
    const dateStr = formatDate(viewDate);
    const manualChangeKey = `lastManualChange_${currentUser}_${dateStr}`;

    console.log(`Branch manually changed to: ${selectedBranch} for date: ${dateStr}`);

    // Save as manual change for this specific date
    const existingManualData = JSON.parse(localStorage.getItem(manualChangeKey) || '{}');
    existingManualData.branch = selectedBranch;
    existingManualData.timestamp = Date.now();
    localStorage.setItem(manualChangeKey, JSON.stringify(existingManualData));

    // Save globally for persistence
    if (currentUser) {
        localStorage.setItem(`lastBranch_${currentUser}`, selectedBranch);
    }

    // Update Firestore if already clocked in
    const dateKey = formatDate(viewDate);
    updateBranchInFirestore(dateKey, selectedBranch);
});

document.getElementById("shiftSelect").addEventListener("change", async function () {
    const selectedShift = this.value;
    const dateStr = formatDate(viewDate);
    const manualChangeKey = `lastManualChange_${currentUser}_${dateStr}`;

    console.log(`Shift manually changed to: ${selectedShift} for date: ${dateStr}`);

    // Save as manual change for this specific date
    const existingManualData = JSON.parse(localStorage.getItem(manualChangeKey) || '{}');
    existingManualData.shift = selectedShift;
    existingManualData.timestamp = Date.now();
    localStorage.setItem(manualChangeKey, JSON.stringify(existingManualData));

    // Save globally for persistence
    localStorage.setItem("lastSelectedShift", selectedShift);

    // Get current attendance data and update the card times immediately
    const dateKey = formatDate(viewDate);
    let data = {};
    const localStorageKey = `attendance_${currentUser}_${dateKey}`;
    const localData = localStorage.getItem(localStorageKey);

    if (localData) {
        data = JSON.parse(localData);
    }

    // If there's existing clockIn data, update its shift
    if (data.clockIn) {
        data.clockIn.shift = selectedShift;
        localStorage.setItem(localStorageKey, JSON.stringify(data));

        // Update Firestore
        const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);
        await setDoc(subDocRef, { clockIn: data.clockIn }, { merge: true });
    }

    // Refresh the card times with new shift schedule
    updateCardTimes(data);
});

async function updateBranchInFirestore(dateKey, branch) {
    try {
        const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);
        const docSnap = await getDoc(subDocRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.clockIn) {
                data.clockIn.branch = branch;
                await setDoc(subDocRef, { clockIn: data.clockIn }, { merge: true });
            }
        }
    } catch (error) {
        console.warn("Could not update branch in Firestore:", error);
    }
}

async function handleClock(type) {
    const isToday = formatDate(viewDate) === formatDate(today);
    if (!ALLOW_PAST_CLOCKING() && !isToday) {
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
        // if (lateBy > 0 && lateBy <= lateGraceLimitMinutes) {
        //     const [h, m] = timeOut.split(/:|\s/);
        //     let hour = parseInt(h);
        //     let min = parseInt(m);
        //     min += lateBy;
        //     hour += Math.floor(min / 60);
        //     min %= 60;
        //     if (hour > 12) hour -= 12;
        //     displayOutTime = `${hour}:${min.toString().padStart(2, '0')} ${timeOut.includes("PM") ? "PM" : "AM"}`;
        // }

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
    // Handle null or undefined times
    if (!t1 || !t2) return 0;

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

        // Updated color logic for grace period
        if (lateBy > 0) {
            if (lateBy <= lateGraceLimitMinutes) {
                // Within grace period - show orange as warning
                overlayColor = "orange";
                const hrs = Math.floor(lateBy / 60);
                const mins = lateBy % 60;
                statusText = hrs > 0
                    ? `${hrs} hr${hrs > 1 ? 's' : ''}${mins > 0 ? ` ${mins} min${mins > 1 ? 's' : ''}` : ''} late`
                    : `${mins} min${mins > 1 ? 's' : ''} late`;
            } else {
                // Beyond grace period - show red
                overlayColor = "red";
                const hrs = Math.floor(lateBy / 60);
                const mins = lateBy % 60;
                statusText = hrs > 0
                    ? `${hrs} hr${hrs > 1 ? 's' : ''}${mins > 0 ? ` ${mins} min${mins > 1 ? 's' : ''}` : ''} late`
                    : `${mins} min${mins > 1 ? 's' : ''} late`;
            }
        } else {
            // On time or early
            overlayColor = "green";
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
        
        // Use the original scheduled time out - no offset
        displayOutTime = scheduledTimeOut;

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

async function updateBranchAndShiftSelectors(data = {}) {
    const branchSelect = document.getElementById("branchSelect");
    const shiftSelect = document.getElementById("shiftSelect");
    const dateStr = formatDate(viewDate);
    const today = new Date();
    const isToday = formatDate(viewDate) === formatDate(today);
    const isFuture = viewDate > today;
    const isPast = viewDate < today;

    // Check for manual changes for this specific date
    const manualChangeKey = `lastManualChange_${currentUser}_${dateStr}`;
    const hasManualChanges = localStorage.getItem(manualChangeKey);

    let selectedBranch, selectedShift;

    // Priority 1: Existing attendance data
    if (data.clockIn?.branch && data.clockIn?.shift) {
        selectedBranch = data.clockIn.branch;
        selectedShift = data.clockIn.shift;
    }
    // Priority 2: Manual changes for this date
    else if (hasManualChanges) {
        const manualData = JSON.parse(hasManualChanges);
        selectedBranch = manualData.branch || localStorage.getItem(`lastBranch_${currentUser}`) || "Podium";
        selectedShift = manualData.shift || localStorage.getItem("lastSelectedShift") || "Opening";
    }
    // Priority 3: Schedule data (for today and future dates only)
    else if ((isToday || isFuture) && navigator.onLine) {
        try {
            const scheduleData = await fetchScheduleForDate(currentUser, dateStr);
            if (scheduleData) {
                // Map schedule branch to dropdown values
                const branchMapping = {
                    'podium': 'Podium',
                    'smnorth': 'SM North',
                    'popup': 'Pop-up',
                    'workshop': 'Workshop',
                    'other': 'Other Events'
                };

                // Map schedule shift type to dropdown values
                const shiftMapping = {
                    'opening': 'Opening',
                    'openingHalf': 'Opening Half-Day',
                    'midshift': 'Midshift',
                    'closing': 'Closing',
                    'closingHalf': 'Closing Half-Day',
                    'custom': 'Custom'
                };

                selectedBranch = branchMapping[scheduleData.branch] || scheduleData.branch || "Podium";
                selectedShift = shiftMapping[scheduleData.type] || scheduleData.type || "Opening";

                console.log(`Auto-populated from schedule: ${selectedBranch}, ${selectedShift}`);
            } else {
                // Priority 4: Default values
                selectedBranch = localStorage.getItem(`lastBranch_${currentUser}`) || "Podium";
                selectedShift = localStorage.getItem("lastSelectedShift") || "Opening";
            }
        } catch (error) {
            console.error("Error fetching schedule:", error);
            selectedBranch = localStorage.getItem(`lastBranch_${currentUser}`) || "Podium";
            selectedShift = localStorage.getItem("lastSelectedShift") || "Opening";
        }
    }
    // Priority 4: Default values (for past dates or when offline)
    else {
        selectedBranch = localStorage.getItem(`lastBranch_${currentUser}`) || "Podium";
        selectedShift = localStorage.getItem("lastSelectedShift") || "Opening";
    }

    // Set the dropdown values
    if ([...branchSelect.options].some(o => o.value === selectedBranch)) {
        branchSelect.value = selectedBranch;
    } else {
        branchSelect.value = "Podium";
    }

    if ([...shiftSelect.options].some(o => o.value === selectedShift)) {
        shiftSelect.value = selectedShift;
    } else {
        shiftSelect.value = "Opening";
    }
}

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

document.addEventListener('DOMContentLoaded', async () => {
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
    
    if (isDesktop()) {
        await loadEmployees();
    }
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

async function fetchScheduleForDate(userId, dateStr) {
    if (!navigator.onLine) return null;

    try {
        // Get the week key for this date
        const date = new Date(dateStr);
        const weekKey = getWeekStartKey(date);

        const schedulesRef = collection(db, "schedules", weekKey, "shifts");
        const q = query(schedulesRef, where("employeeId", "==", userId), where("date", "==", dateStr));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            return snapshot.docs[0].data();
        }

        // Also check for recurring shifts from previous weeks
        for (let i = 1; i <= 8; i++) {
            const pastWeek = new Date(date);
            pastWeek.setDate(pastWeek.getDate() - (i * 7));
            const pastWeekKey = formatDate(pastWeek);

            const pastSchedulesRef = collection(db, "schedules", pastWeekKey, "shifts");
            const pastQ = query(pastSchedulesRef, where("employeeId", "==", userId));
            const pastSnapshot = await getDocs(pastQ);

            for (const doc of pastSnapshot.docs) {
                const shift = doc.data();
                if (shift.recurringSeriesId || shift.isRecurringInstance || shift.recurring) {
                    const shiftDate = new Date(shift.date + 'T00:00:00');
                    const shiftDayOfWeek = shiftDate.getDay();
                    const targetDayOfWeek = date.getDay();

                    if (shiftDayOfWeek === targetDayOfWeek && date >= shiftDate) {
                        return {
                            ...shift,
                            date: dateStr,
                            id: `recurring_${shift.id}_${dateStr}`
                        };
                    }
                }
            }
        }

        return null;
    } catch (error) {
        console.error("Error fetching schedule for date:", error);
        return null;
    }
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
function openPayrollDetailModal(dayData, clickedCard) {
    console.log(`MODAL - ${dayData.date}: timeIn="${dayData.timeIn}" timeOut="${dayData.timeOut}" hasOTPay=${dayData.hasOTPay}`);

    const modal = document.getElementById('payrollDetailModal');
    const dateObj = new Date(dayData.date);
    const month = dateObj.toLocaleDateString('en-US', { month: 'short' });
    const dayNum = dateObj.getDate();
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

    // Add expanding class to clicked card
    if (clickedCard) {
        clickedCard.classList.add('expanding');
    }

    // Set the card data immediately
    document.getElementById('modalPayrollDate').textContent = `${month} ${dayNum}`;
    document.getElementById('modalPayrollDay').textContent = dayOfWeek;
    document.getElementById('modalPayrollBranch').textContent = dayData.branch || '--';
    document.getElementById('modalPayrollShift').textContent = dayData.shift || '--';

    // Set times immediately
    document.getElementById('modalTimeIn').textContent = formatTime(dayData.timeIn);
    document.getElementById('modalTimeOut').textContent = formatTime(dayData.timeOut);

    // Show modal with animation
    modal.style.display = 'flex';

    // Trigger animation after a frame
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });

    // Hide thumbnails initially and load photos in background
    const timeInThumb = document.getElementById('modalTimeInThumb');
    const timeOutThumb = document.getElementById('modalTimeOutThumb');
    timeInThumb.style.display = 'none';
    timeOutThumb.style.display = 'none';

    // Calculate late time using the same logic as updatePayrollUI
    const formatLateTime = (timeIn, scheduledIn) => {
        if (!timeIn || !scheduledIn) return { text: '0 mins', minutes: 0 };
        const lateMinutes = compareTimes(timeIn, scheduledIn);
        const actualLateMinutes = Math.max(0, lateMinutes);

        const hours = Math.floor(actualLateMinutes / 60);
        const minutes = actualLateMinutes % 60;

        let text;
        if (hours >= 1) {
            text = hours === 1 && minutes === 0 ? '1 hr' :
                minutes === 0 ? `${hours} hrs` :
                    `${hours} hr ${minutes} mins`;
        } else {
            text = `${minutes} mins`;
        }

        return { text, minutes: actualLateMinutes };
    };

    // Calculate pay breakdown
    const baseRate = dayData.baseRate || 750;
    const isHalfDay = dayData.shift === "Closing Half-Day";
    const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
    const mealAllowance = isHalfDay ? 75 : 150;

    document.getElementById('modalBaseRate').textContent = `₱${dailyRate.toFixed(2)}`;
    document.getElementById('modalMealAllow').textContent = `₱${mealAllowance.toFixed(2)}`;

    // Calculate deductions and show/hide rows
    const lateDeduction = calculateLateDeduction(dayData);
    const undertimeDeduction = calculateUndertimeDeduction(dayData);
    const holidayBonus = calculateHolidayBonus(dayData, dailyRate);

    const lateDeductionRow = document.getElementById('modalLateDeductionRow');
    const undertimeDeductionRow = document.getElementById('modalUndertimeDeductionRow');
    const holidayBonusRow = document.getElementById('modalHolidayBonusRow');

    if (lateDeduction > 0) {
        const lateInfo = formatLateTime(dayData.timeIn, dayData.scheduledIn);
        document.getElementById('modalLateHours').textContent = lateInfo.text;
        document.getElementById('modalLateDeduction').textContent = `-₱${lateDeduction.toFixed(2)}`;
        lateDeductionRow.style.display = 'grid';
    } else {
        lateDeductionRow.style.display = 'none';
    }

    // Check for undertime regardless of late hours
    const undertimeMinutes = dayData.timeOut && dayData.scheduledOut ?
        compareTimes(dayData.scheduledOut, dayData.timeOut) : 0;

    if (undertimeDeduction > 0 && undertimeMinutes > 30) {
        const undertimeHours = Math.floor(undertimeMinutes / 60);
        const undertimeRemainingMins = undertimeMinutes % 60;
        const undertimeText = undertimeHours > 0 ?
            `${undertimeHours}h ${undertimeRemainingMins}m` :
            `${undertimeMinutes} mins`;

        document.getElementById('modalUndertimeHours').textContent = undertimeText;
        document.getElementById('modalUndertimeDeduction').textContent = `-₱${undertimeDeduction.toFixed(2)}`;
        undertimeDeductionRow.style.display = 'grid';
    } else {
        undertimeDeductionRow.style.display = 'none';
    }

    if (holidayBonus > 0) {
        const multiplier = getHolidayPayMultiplier(dayData.date);
        const holidayType = multiplier === 2.0 ? 'Regular' : 'Special';
        document.getElementById('modalHolidayType').textContent = holidayType;
        document.getElementById('modalHolidayBonus').textContent = `+₱${holidayBonus.toFixed(2)}`;
        holidayBonusRow.style.display = 'grid';
    } else {
        holidayBonusRow.style.display = 'none';
    }

    // DEBUG LOGS - Add these
    console.log(`🔍 Modal Debug for ${dayData.date}:`);
    console.log(`hasOTPay: ${dayData.hasOTPay}`);
    console.log(`timeIn: ${dayData.timeIn}, timeOut: ${dayData.timeOut}`);
    console.log(`calculated hours: ${calculateHours(dayData.timeIn, dayData.timeOut)}`);
    console.log(`baseRate: ${dayData.baseRate}`);

    // Add OT calculation and display
    const otCalculation = calculateOTPay(dayData, dayData.baseRate || 750);
    console.log(`OT Calculation result:`, otCalculation);

    const otBonusRow = document.getElementById('modalOTBonusRow');

    if (otCalculation.otPay > 0) {
        document.getElementById('modalOTHours').textContent = `${otCalculation.otHours.toFixed(1)}h`;
        document.getElementById('modalOTBonus').textContent = `+₱${otCalculation.otPay.toFixed(2)}`;
        otBonusRow.style.display = 'grid';
    } else {
        otBonusRow.style.display = 'none';
    }

    // Add this after the holiday bonus logic:
    const salesBonus = dayData.salesBonus || 0;
    const salesBonusRow = document.getElementById('modalSalesBonusRow');

    if (salesBonus > 0) {
        document.getElementById('modalSalesBonus').textContent = `+₱${salesBonus.toFixed(2)}`;
        salesBonusRow.style.display = 'grid';
    } else {
        salesBonusRow.style.display = 'none';
    }

    // Set total pay
    const totalPay = calculateDailyPay(dayData, baseRate);
    document.getElementById('modalTotalPay').textContent = `₱${totalPay.toFixed(2)}`;

    // Load photos in background
    setTimeout(() => {
        if (dayData.timeInPhoto) {
            timeInThumb.src = dayData.timeInPhoto;
            timeInThumb.style.display = 'block';
        }

        if (dayData.timeOutPhoto) {
            timeOutThumb.src = dayData.timeOutPhoto;
            timeOutThumb.style.display = 'block';
        }
    }, 100);

    // Remove expanding class after animation
    setTimeout(() => {
        if (clickedCard) {
            clickedCard.classList.remove('expanding');
        }
    }, 300);
}

function closePayrollDetailModal() {
    const modal = document.getElementById('payrollDetailModal');

    // Remove show class to trigger close animation
    modal.classList.remove('show');

    // Hide modal after animation completes
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

function calculateLateDeduction(dayData) {
    if (!dayData.timeIn || !dayData.scheduledIn) return 0;

    const lateMinutes = compareTimes(dayData.timeIn, dayData.scheduledIn);
    if (lateMinutes <= 30) return 0; // Grace period - no deduction

    // Only deduct if late > 30 minutes
    const baseRate = dayData.baseRate || 750;
    const isHalfDay = dayData.shift === "Closing Half-Day";
    const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
    const hourlyRate = dailyRate / (isHalfDay ? 4 : 8);

    return (lateMinutes / 60) * hourlyRate;
}
function calculateUndertimeDeduction(dayData) {
    if (!dayData.timeOut || !dayData.scheduledOut) return 0;

    const undertimeMinutes = compareTimes(dayData.scheduledOut, dayData.timeOut);
    if (undertimeMinutes <= 30) return 0; // Grace period

    const baseRate = dayData.baseRate || 750;
    const isHalfDay = dayData.shift === "Closing Half-Day";
    const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
    const hourlyRate = dailyRate / (isHalfDay ? 4 : 8);

    return (undertimeMinutes / 60) * hourlyRate;
}

function calculateHolidayBonus(dayData, dailyRate) {
    const multiplier = getHolidayPayMultiplier(dayData.date);
    if (multiplier <= 1.0) return 0;

    return dailyRate * (multiplier - 1.0);
}

async function fetchAttendancePhotos(userId, dateStr) {
    try {
        const docRef = doc(db, "attendance", userId, "dates", dateStr);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                timeInPhoto: data.clockIn?.selfie || null,
                timeOutPhoto: data.clockOut?.selfie || null
            };
        }
    } catch (error) {
        console.error("Failed to fetch attendance photos:", error);
    }

    return { timeInPhoto: null, timeOutPhoto: null };
}

// ✅ Expose functions to window for HTML inline events
window.takePhoto = takePhoto;
window.retakePhoto = retakePhoto;
window.submitPhoto = submitPhoto;
window.logoutUser = logoutUser;
window.clearData = clearData;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.handleClock = handleClock;


window.openPayrollDetailModal = openPayrollDetailModal;
window.closePayrollDetailModal = closePayrollDetailModal;

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
    const scheduleViewTab = document.getElementById('scheduleViewTab');
    const payrollViewTab = document.getElementById('payrollViewTab');
    const summaryCardUI = document.getElementById('summaryCardUI');
    const scheduleView = document.getElementById('scheduleView');
    const payrollView = document.getElementById('payrollView');

    if (dailyViewTab && scheduleViewTab && payrollViewTab && summaryCardUI && scheduleView && payrollView) {
        // Switch to daily view
        dailyViewTab.addEventListener('click', function () {
            // Update active tab
            dailyViewTab.classList.add('active');
            scheduleViewTab.classList.remove('active');
            payrollViewTab.classList.remove('active');

            // Show daily view, hide others
            summaryCardUI.style.display = 'block';
            scheduleView.style.display = 'none';
            payrollView.style.display = 'none';

            // Show header block
            document.querySelector('.header-block').style.display = 'flex';

            // Hide history log if it's open
            const historyLog = document.getElementById('historyLog');
            if (historyLog) historyLog.style.display = 'none';

            // Show timestamp
            if (timestamp) timestamp.style.display = 'block';
        });

        // Switch to schedule view
        // Switch to schedule view
        scheduleViewTab.addEventListener('click', function () {
            // Update active tab
            dailyViewTab.classList.remove('active');
            scheduleViewTab.classList.add('active');
            payrollViewTab.classList.remove('active');

            // Show schedule view, hide others
            summaryCardUI.style.display = 'none';
            scheduleView.style.display = 'block';
            payrollView.style.display = 'none';

            // Hide header block
            document.querySelector('.header-block').style.display = 'none';

            // Hide history log if it's open
            const historyLog = document.getElementById('historyLog');
            if (historyLog) historyLog.style.display = 'none';

            // Hide timestamp
            if (timestamp) timestamp.style.display = 'none';

            // Initialize employee data if not already loaded
            if (!employeesLoaded) {
                loadEmployees();
            }

            // Load employee nicknames if empty
            if (Object.keys(employeeNicknames).length === 0) {
                loadEmployeeNicknames();
            }

            // Reset branch filter to 'all' for "My Schedule"
            if (showMyScheduleOnly) {
                selectedBranch = 'all';
            }

            // Initialize and load schedule data
            initializeScheduleWeek();
            loadScheduleData();
        });

        // Switch to payroll view
        payrollViewTab.addEventListener('click', function () {
            // Update active tab
            payrollViewTab.classList.add('active');
            dailyViewTab.classList.remove('active');
            scheduleViewTab.classList.remove('active');

            // Hide other views, show payroll view
            summaryCardUI.style.display = 'none';
            scheduleView.style.display = 'none';
            payrollView.style.display = 'block';

            // Hide header block
            document.querySelector('.header-block').style.display = 'none';

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

    // Add navigation event listeners for schedule view
    const scheduleNavPrev = document.getElementById('scheduleNavPrev');
    const scheduleNavNext = document.getElementById('scheduleNavNext');

    if (scheduleNavPrev) {
        scheduleNavPrev.addEventListener('click', () => changeScheduleWeek(-1));
    }

    if (scheduleNavNext) {
        scheduleNavNext.addEventListener('click', () => changeScheduleWeek(1));
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

    const myScheduleBtn = document.getElementById('myScheduleBtn');
    const allScheduleBtn = document.getElementById('allScheduleBtn');
    const branchToggle = document.getElementById('branchToggle');

    if (myScheduleBtn && allScheduleBtn) {
        myScheduleBtn.addEventListener('click', () => {
            showMyScheduleOnly = true;
            myScheduleBtn.classList.add('active');
            allScheduleBtn.classList.remove('active');
            branchToggle.style.display = 'none'; // Hide branch toggle
            loadScheduleData();
        });

        allScheduleBtn.addEventListener('click', () => {
            showMyScheduleOnly = false;
            allScheduleBtn.classList.add('active');
            myScheduleBtn.classList.remove('active');
            branchToggle.style.display = 'flex'; // Show branch toggle

            // Set default branch if not set
            if (!selectedBranch || selectedBranch === 'all') {
                selectedBranch = 'smnorth';
                // Update the button visual state
                const defaultBtn = document.querySelector('.branch-btn[data-branch="smnorth"]');
                if (defaultBtn) {
                    document.querySelectorAll('.branch-btn').forEach(b => b.classList.remove('active'));
                    defaultBtn.classList.add('active');
                }
            }

            loadScheduleData();
        });
    }

    // In the DOMContentLoaded event listener, update the branch toggle listeners:
    // Add branch toggle event listeners
    const branchBtns = document.querySelectorAll('.branch-btn');
    branchBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active from all buttons
            branchBtns.forEach(b => b.classList.remove('active'));
            // Add active to clicked button
            btn.classList.add('active');

            selectedBranch = btn.dataset.branch;
            console.log('Branch changed to:', selectedBranch); // Debug log
            loadScheduleData();
        });
    });

});

async function loadEmployeeNicknames() {
    // First try to load from localStorage
    const cachedNicknames = localStorage.getItem('employee_nicknames');
    if (cachedNicknames) {
        employeeNicknames = JSON.parse(cachedNicknames);
        console.log('Employee nicknames loaded from cache:', employeeNicknames);
    }

    if (!navigator.onLine) return;

    try {
        let hasChanges = false;
        for (const employeeId of Object.keys(employees)) {
            const employeeDoc = await getDoc(doc(db, "employees", employeeId));
            if (employeeDoc.exists() && employeeDoc.data().nickname) {
                const newNickname = employeeDoc.data().nickname;
                if (employeeNicknames[employeeId] !== newNickname) {
                    employeeNicknames[employeeId] = newNickname;
                    hasChanges = true;
                }
            }
        }

        if (hasChanges) {
            // Save updated nicknames to localStorage
            localStorage.setItem('employee_nicknames', JSON.stringify(employeeNicknames));
            console.log('Employee nicknames updated and cached:', employeeNicknames);

            // Re-render schedule if we're currently showing it
            if (document.getElementById('scheduleView').style.display === 'block') {
                renderScheduleCards(JSON.parse(localStorage.getItem(`schedule_cache_${showMyScheduleOnly ? currentUser : 'all'}_${selectedBranch}_${formatDate(currentScheduleWeek)}`) || '{}'));
            }
        }
    } catch (error) {
        console.error('Error loading employee nicknames:', error);
    }
}

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

function calculateHours(timeInStr, timeOutStr) {
    try {
        const [timeIn, meridianIn] = timeInStr.split(' ');
        const [hoursIn, minutesIn] = timeIn.split(':').map(Number);

        const [timeOut, meridianOut] = timeOutStr.split(' ');
        const [hoursOut, minutesOut] = timeOut.split(':').map(Number);

        let hours24In = hoursIn;
        if (meridianIn === 'PM' && hoursIn !== 12) hours24In += 12;
        if (meridianIn === 'AM' && hoursIn === 12) hours24In = 0;

        let hours24Out = hoursOut;
        if (meridianOut === 'PM' && hoursOut !== 12) hours24Out += 12;
        if (meridianOut === 'AM' && hoursOut === 12) hours24Out = 0;

        const totalMinutesIn = hours24In * 60 + minutesIn;
        const totalMinutesOut = hours24Out * 60 + minutesOut;

        let minutesDiff = totalMinutesOut - totalMinutesIn;

        if (minutesDiff < 0) {
            // Always add 24 hours for negative differences (next day scenario)
            minutesDiff += 24 * 60;
        }

        const maxShiftHours = 18;
        const calculatedHours = minutesDiff / 60;

        if (calculatedHours > maxShiftHours) {
            console.warn("Shift duration exceeds maximum:", calculatedHours, "hours");
            return maxShiftHours;
        }

        return calculatedHours;
    } catch (error) {
        console.error("Error calculating hours:", error);
        return null;
    }
}

async function loadPayrollData() {
    const tableBody = document.getElementById('payrollTableBody');

    if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">Loading...</td></tr>';
    }

    const periodSelect = document.getElementById('payrollPeriod');
    if (!periodSelect) return;

    const selectedPeriod = periodSelect.value;

    // Clear payment indicator when switching periods
    clearPaymentIndicator();

    // Add caching for payroll data
    const cacheKey = `payroll_cache_${currentUser}_${selectedPeriod}`;
    const cachedData = localStorage.getItem(cacheKey);

    if (cachedData) {
        // Use cached data immediately
        updatePayrollUI(JSON.parse(cachedData));

        // Check for payment confirmation after loading cached data
        await checkAndShowPaymentConfirmation(selectedPeriod);

        // Then refresh in background if online
        if (navigator.onLine) {
            await fetchFreshPayrollData(selectedPeriod, cacheKey);
            // Check again after fresh data (in case payment status changed)
            await checkAndShowPaymentConfirmation(selectedPeriod);
        }
        return;
    }

    // No cache, fetch new data
    await fetchFreshPayrollData(selectedPeriod, cacheKey);

    // Check for payment confirmation after loading fresh data
    await checkAndShowPaymentConfirmation(selectedPeriod);
}

// Helper function to check and show payment confirmation
async function checkAndShowPaymentConfirmation(selectedPeriod) {
    if (!selectedPeriod) return;

    try {
        // Convert period text to ID format
        const [startMonth, startDay, endMonth, endDay, year] = parsePeriod(selectedPeriod);
        const startDate = new Date(year, getMonthIndex(startMonth), parseInt(startDay));
        const endDate = new Date(year, getMonthIndex(endMonth), parseInt(endDay));
        const periodId = `${formatDate(startDate)}_${formatDate(endDate)}`;

        const screenshotUrl = await checkPaymentConfirmation(periodId);
        if (screenshotUrl) {
            showPaymentConfirmationIndicator(screenshotUrl);
        }
    } catch (error) {
        console.error("Error checking payment confirmation:", error);
    }
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
    if (!navigator.onLine || !currentUser) {
        return generateMockData(dates);
    }

    try {
        const payrollData = [];

        // Get all attendance data for the user
        const attendanceRef = collection(db, "attendance", currentUser, "dates");
        const snapshot = await getDocs(attendanceRef);

        const attendanceMap = {};
        snapshot.forEach(doc => {
            attendanceMap[doc.id] = doc.data();
        });

        // Get employee base rate
        let baseRate = 750; // default
        try {
            const employeeDoc = await getDoc(doc(db, "employees", currentUser));
            if (employeeDoc.exists()) {
                baseRate = employeeDoc.data().baseRate || 750;
            }
        } catch (error) {
            console.error("Failed to get employee base rate:", error);
        }

        // Filter for only the dates we need
        dates.forEach(dateStr => {
            const data = attendanceMap[dateStr];

            payrollData.push({
                date: dateStr,
                timeIn: data?.clockIn?.time || null,
                timeOut: data?.clockOut?.time || null,
                branch: data?.clockIn?.branch || null,
                shift: data?.clockIn?.shift || null,
                scheduledIn: SHIFT_SCHEDULES[data?.clockIn?.shift || "Opening"].timeIn,
                scheduledOut: SHIFT_SCHEDULES[data?.clockIn?.shift || "Opening"].timeOut,
                hours: data?.clockIn && data?.clockOut ? calculateHours(data.clockIn.time, data.clockOut.time) : null,
                baseRate: baseRate,
                hasOTPay: data?.hasOTPay || false,
                salesBonus: data?.salesBonus || 0  // Add this line
            });
        });

        return payrollData;
    } catch (error) {
        console.error("Failed to fetch payroll data:", error);
        return generateMockData(dates);
    }
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
        if (day.timeIn && day.scheduledIn) {
            const lateMinutes = compareTimes(day.timeIn, day.scheduledIn);
            return sum + (lateMinutes > 0 ? lateMinutes / 60 : 0);
        }
        return sum;
    }, 0);

    // Calculate total pay for all days
    const totalPay = payrollData.reduce((sum, day) => {
        if (day.timeIn && day.timeOut) {
            return sum + calculateDailyPay(day, day.baseRate);
        }
        return sum;
    }, 0);

    // Update summary cards
    const summaryValues = document.querySelectorAll('.summary-value');
    if (summaryValues.length >= 2) {
        summaryValues[0].textContent = daysWorked;
        summaryValues[1].textContent = `₱${totalPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    // Update header text
    const attendanceHeader = document.querySelector('.attendance-header');
    if (attendanceHeader) {
        attendanceHeader.textContent = 'Attendance Record';
    }

    // Populate the cards
    const cardsContainer = document.getElementById('payrollCardsContainer');
    if (!cardsContainer) return;

    cardsContainer.innerHTML = '';

    const sortedPayrollData = payrollData.sort((a, b) => new Date(b.date) - new Date(a.date));

    sortedPayrollData.forEach(day => {
        // Skip days with no attendance data
        if (!day.timeIn && !day.timeOut) return;

        console.log(`BEFORE card creation - ${day.date}: timeIn="${day.timeIn}" timeOut="${day.timeOut}" hasOTPay=${day.hasOTPay}`);

        // NEW LOGS - Add these to trace the time values
        console.log(`RAW timeIn before any processing: "${day.timeIn}"`);
        console.log(`RAW timeOut before any processing: "${day.timeOut}"`);

        const card = document.createElement('div');
        card.className = 'payroll-card';

        // Highlight if it's today
        const isToday = formatDate(new Date()) === day.date;
        if (isToday) {
            card.classList.add('today');
        }

        const dateObj = new Date(day.date);
        const month = dateObj.toLocaleDateString('en-US', { month: 'short' });
        const dayNum = dateObj.getDate();
        const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

        // Calculate late minutes
        const formatLateTime = (timeIn, scheduledIn) => {
            if (!timeIn || !scheduledIn) return { text: '0 mins', minutes: 0 };
            const lateMinutes = compareTimes(timeIn, scheduledIn);
            const actualLateMinutes = Math.max(0, lateMinutes); // Don't show negative values

            const hours = Math.floor(actualLateMinutes / 60);
            const minutes = actualLateMinutes % 60;

            let text;
            if (hours >= 1) {
                text = hours === 1 && minutes === 0 ? '1 hr' :
                    minutes === 0 ? `${hours} hrs` :
                        `${hours} hr ${minutes} mins`;
            } else {
                text = `${minutes} mins`;
            }

            return { text, minutes: actualLateMinutes };
        };

        const lateInfo = formatLateTime(day.timeIn, day.scheduledIn);
        const isOngoing = isToday && day.timeIn && !day.timeOut;

        card.innerHTML = `
            <div class="payroll-card-main">
                <div class="payroll-date-section">
                    <div class="payroll-date">${month} ${dayNum}</div>
                    <div class="payroll-day">${dayOfWeek}</div>
                </div>
                ${getHolidayPayMultiplier(day.date) > 1.0 ? `
                <div class="payroll-holiday-section">
                    <div class="payroll-holiday">${HOLIDAYS_2025[day.date]?.name || 'Holiday'}</div>
                </div>
                ` : ''}
                <div class="payroll-branch-shift">
                    <div class="payroll-branch">${day.branch || '--'}</div>
                    <div class="payroll-shift">${day.shift || '--'}</div>
                </div>
            </div>
            <div class="payroll-times">
                <div class="payroll-time-group">
                    <div class="payroll-time-label">Time In</div>
                    <div class="payroll-time">${(() => {
                        console.log(`INSIDE IIFE - day.timeIn value: "${day.timeIn}"`);
                        console.log(`INSIDE IIFE - typeof day.timeIn: ${typeof day.timeIn}`);
                        const formatted = formatTime(day.timeIn);
                        console.log(`Card HTML timeIn: "${day.timeIn}" -> "${formatted}"`);
                        return formatted;
                    })()}</div>
                </div>
                <div class="payroll-time-group">
                    <div class="payroll-time-label">Time Out</div>
                    <div class="payroll-time">${(() => {
                        console.log(`INSIDE IIFE - day.timeOut value: "${day.timeOut}"`);
                        console.log(`INSIDE IIFE - typeof day.timeOut: ${typeof day.timeOut}`);
                        const formatted = formatTime(day.timeOut);
                        console.log(`Card HTML timeOut: "${day.timeOut}" -> "${formatted}"`);
                        return formatted;
                    })()}</div>
                </div>
            </div>
            ${!isOngoing ? `
            <div class="payroll-bottom-section">
                <div class="payroll-late-info">
                    <div class="payroll-late-label">Late Hours</div>
                    <div class="payroll-late-value ${lateInfo.minutes > 30 ? 'late-red' : 'late-green'}">${lateInfo.minutes === 0 ? '-' : lateInfo.text}</div>
                </div>
                <div class="payroll-pay-info">
                    <div class="payroll-pay-label">Total Pay</div>
                    <div class="payroll-pay">₱${calculateDailyPay(day, day.baseRate).toFixed(2)}</div>
                </div>
            </div>
            ` : ''}
        `;

        // // Add click handler to go to daily view
        // const dateElement = card.querySelector('.payroll-date');
        // dateElement.addEventListener('click', () => {
        //     const dateParts = day.date.split('-');
        //     const selectedDate = new Date(
        //         parseInt(dateParts[0]),
        //         parseInt(dateParts[1]) - 1,
        //         parseInt(dateParts[2])
        //     );

        //     viewDate = selectedDate;
        //     updateDateUI();
        //     updateSummaryUI();
        //     document.getElementById('dailyViewTab').click();
        // });

        // Add click handler to show detail modal
        card.addEventListener('click', async (event) => {
            // Fetch photos for this attendance record
            const photos = await fetchAttendancePhotos(currentUser, day.date);

            // Combine day data with photos
            const dayDataWithPhotos = {
                ...day,
                timeInPhoto: photos.timeInPhoto,
                timeOutPhoto: photos.timeOutPhoto
            };

            openPayrollDetailModal(dayDataWithPhotos, event.currentTarget);
        });

        cardsContainer.appendChild(card);
    });
}

function formatTime(timeStr) {
    if (!timeStr || timeStr === '--' || timeStr === 'null') {
        return '--';
    }

    // Only remove seconds if they actually exist (3 colon-separated parts)
    const parts = timeStr.split(':');
    if (parts.length === 3) {
        // Has seconds: "1:15:30 PM" -> "1:15 PM"
        return timeStr.replace(/:\d{2}(\s[AP]M)/, '$1');
    }
    // No seconds: "1:15 PM" -> "1:15 PM" (no change)
    return timeStr;
}

// Replace this entire function:
async function populatePayrollPeriods() {
    const periodSelect = document.getElementById('payrollPeriod');
    if (!periodSelect) return;

    // Clear existing options
    periodSelect.innerHTML = '';

    // Define the current date and a range of 6 months back
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);

    // Generate base periods - this should include future periods
    const periods = generatePayrollPeriods(sixMonthsAgo, now);

    // Always show ALL periods regardless of attendance data
    // Sort by newest first
    periods.sort((a, b) => b.end - a.end);

    // Find the most recent period that has ended but not yet been paid
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day
    let defaultPeriodIndex = 0;

    for (let i = 0; i < periods.length; i++) {
        const period = periods[i];
        const payDay = getPayDay(period.end);

        // Period has ended but pay day hasn't arrived yet
        if (today > period.end && today < payDay) {
            defaultPeriodIndex = i;
            break;
        }
        // If no period meets criteria, default to most recent ended period
        else if (today > period.end) {
            defaultPeriodIndex = i;
        }
    }

    // Add all periods to the dropdown
    periods.forEach((period, index) => {
        addPeriodOption(periodSelect, period.label);
    });

    // Set the default selection
    if (periods.length > 0) {
        periodSelect.selectedIndex = defaultPeriodIndex;
    }
}

function getPayDay(cutoffDate) {
    const payDay = new Date(cutoffDate);

    // Pay day is always 3 days after cutoff
    payDay.setDate(cutoffDate.getDate() + 3);

    // Handle month overflow - if adding 3 days goes to next month
    if (payDay.getMonth() !== cutoffDate.getMonth()) {
        const cutoffDay = cutoffDate.getDate();
        const month = cutoffDate.getMonth();
        const year = cutoffDate.getFullYear();

        // If cutoff was 12th, pay day should be 15th of same month
        if (cutoffDay === 12) {
            return new Date(year, month, 15);
        } else {
            // If cutoff was near end of month, pay day is last day of month
            const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
            return new Date(year, month, lastDayOfMonth);
        }
    }

    return payDay;
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

async function loadHolidays() {
    // First try to load from localStorage
    const cachedHolidays = localStorage.getItem('holidays_2025');
    if (cachedHolidays) {
        try {
            HOLIDAYS_2025 = JSON.parse(cachedHolidays);
            holidaysLoaded = true;
            console.log("Loaded holidays from cache:", HOLIDAYS_2025);

            // Check cache age (refresh if older than 24 hours)
            const cacheTime = localStorage.getItem('holidays_2025_cache_time');
            const now = Date.now();
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours

            if (!cacheTime || (now - parseInt(cacheTime)) < maxAge) {
                return HOLIDAYS_2025; // Use cache if fresh
            }
        } catch (error) {
            console.error("Error parsing cached holidays:", error);
        }
    }

    // Load fresh data from Firebase
    if (!navigator.onLine) {
        console.warn("Offline - using cached holidays only");
        return HOLIDAYS_2025;
    }

    try {
        const holidayDoc = await getDoc(doc(db, "config", "holidays_2025"));
        if (holidayDoc.exists()) {
            HOLIDAYS_2025 = holidayDoc.data();
            holidaysLoaded = true;

            // Cache the data
            localStorage.setItem('holidays_2025', JSON.stringify(HOLIDAYS_2025));
            localStorage.setItem('holidays_2025_cache_time', Date.now().toString());

            console.log("Loaded fresh holidays from Firebase:", HOLIDAYS_2025);
        }
        return HOLIDAYS_2025;
    } catch (error) {
        console.error("Failed to load holidays:", error);
        return HOLIDAYS_2025; // Return cached version if available
    }
}

function getHolidayPayMultiplier(dateStr) {
    if (HOLIDAYS_2025[dateStr]) {
        if (HOLIDAYS_2025[dateStr].type === "regular") {
            return 2.0;
        } else if (HOLIDAYS_2025[dateStr].type === "special") {
            return 1.3;
        }
    }
    return 1.0;
}

function calculateDeductions(timeIn, timeOut, scheduledIn, scheduledOut) {
    const LATE_THRESHOLD_MINUTES = 30;
    const UNDERTIME_THRESHOLD_MINUTES = 30;
    let deductions = 0;

    if (timeIn && scheduledIn) {
        const lateMinutes = compareTimes(timeIn, scheduledIn);
        if (lateMinutes > LATE_THRESHOLD_MINUTES) {
            const lateHours = lateMinutes / 60;
            deductions += lateHours;
        }
    }

    if (timeOut && scheduledOut) {
        const undertimeMinutes = compareTimes(scheduledOut, timeOut);
        if (undertimeMinutes > UNDERTIME_THRESHOLD_MINUTES) {
            const undertimeHours = undertimeMinutes / 60;
            deductions += undertimeHours;
        }
    }

    return deductions;
}

function calculateDailyPay(dateObj, baseRate, employee = null) {
    const dailyMealAllowance = 150;

    if (!dateObj.timeIn || !dateObj.timeOut) {
        return 0;
    }

    const dateStr = dateObj.date;
    const multiplier = getHolidayPayMultiplier(dateStr);
    let dailyTotalPay = 0;

    if (dateObj.shift === "Custom") {
        const actualHours = calculateHours(dateObj.timeIn, dateObj.timeOut);
        if (!actualHours) return 0;

        const hourlyRate = baseRate / 8;
        const workHours = actualHours > 4 ? actualHours - 1 : actualHours;
        const mealAllowance = actualHours <= 4 ? dailyMealAllowance / 2 : dailyMealAllowance;

        // Calculate base pay (up to 8 hours)
        const regularHours = Math.min(workHours, 8);
        const basePay = hourlyRate * regularHours * multiplier;

        dailyTotalPay = basePay + mealAllowance;

        // Add OT pay for Custom shifts if hasOTPay is true
        if (dateObj.hasOTPay) {
            const otCalculation = calculateOTPay(dateObj, baseRate);
            dailyTotalPay += otCalculation.otPay;
        }
    } else {
        const isHalfDay = dateObj.shift === "Closing Half-Day" || dateObj.shift === "Opening Half-Day";
        const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
        const mealAllowance = isHalfDay ? dailyMealAllowance / 2 : dailyMealAllowance;

        const deductionHours = calculateDeductions(dateObj.timeIn, dateObj.timeOut, dateObj.scheduledIn, dateObj.scheduledOut);
        const standardHours = isHalfDay ? 4 : 8;
        const hourlyRate = dailyRate / standardHours;
        const deductionAmount = deductionHours * hourlyRate;

        dailyTotalPay = (dailyRate * multiplier) + mealAllowance - deductionAmount;

        // Add OT pay for regular shifts
        const otCalculation = calculateOTPay(dateObj, baseRate);
        console.log(`🎯 calculateDailyPay OT check for ${dateObj.date}: hasOTPay=${dateObj.hasOTPay}, otResult=`, otCalculation);
        if (otCalculation.otPay > 0) {
            dailyTotalPay += otCalculation.otPay;
        }
    }

    if (dateObj.transpoAllowance) {
        dailyTotalPay += dateObj.transpoAllowance;
    }

    // Add sales bonus if it exists in the data
    if (dateObj.salesBonus) {
        dailyTotalPay += dateObj.salesBonus;
    }

    return dailyTotalPay;
}

function calculateOTPay(dateEntry, baseRate) {
    console.log('dateEntry in calculateOTPay:', dateEntry);
    if (!dateEntry.hasOTPay || !dateEntry.timeIn || !dateEntry.timeOut) {
        return { otPay: 0, otHours: 0 };
    }

    const actualHours = calculateHours(dateEntry.timeIn, dateEntry.timeOut);
    if (!actualHours || actualHours <= 0) return { otPay: 0, otHours: 0 };

    let workHours = actualHours;
    if (actualHours > 4) {
        workHours = actualHours - 1; // Subtract meal break
    }

    workHours = Math.max(0, workHours);
    const otHours = Math.max(0, workHours - 8); // OT = work hours beyond 8

    if (otHours === 0) {
        return { otPay: 0, otHours: 0 };
    }

    const dateStr = dateEntry.date || dateEntry;
    const hourlyRate = baseRate / 8;
    let otRate;

    if (HOLIDAYS_2025[dateStr]) {
        const holiday = HOLIDAYS_2025[dateStr];
        if (holiday.type === 'regular') {
            otRate = hourlyRate * 2.60;
        } else if (holiday.type === 'special') {
            otRate = hourlyRate * 1.69;
        }
    } else {
        otRate = hourlyRate * 1.25;
    }

    const otPay = otHours * otRate;
    return { otPay, otHours };
}

function calculateDailySalesBonus(dateStr) {
    // Simplified version for staff app
    return 0; // Staff app doesn't have sales data access
}

function calculateTotalPay(daysWorked, baseRate, datesWorked = []) {
    const dailyMealAllowance = 150;
    let totalPay = 0;
    let totalDeductions = 0;

    if (datesWorked.length === 0) {
        // If no dates provided, use the old calculation method
        return (baseRate * daysWorked) + (dailyMealAllowance * daysWorked);
    }

    // Calculate pay for each day based on holiday status
    datesWorked.forEach(dateObj => {
        if (dateObj.timeIn && dateObj.timeOut) {
            const dateStr = dateObj.date;
            const multiplier = getHolidayPayMultiplier(dateStr);

            // Determine if it's a half day based on shift
            const isHalfDay = dateObj.shift === "Closing Half-Day";
            const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
            const mealAllowance = isHalfDay ? dailyMealAllowance / 2 : dailyMealAllowance;

            // Calculate deductions for late/undertime
            const deductionHours = calculateDeductions(
                dateObj.timeIn,
                dateObj.timeOut,
                dateObj.scheduledIn,
                dateObj.scheduledOut
            );

            // Calculate hourly rate (daily rate / 8 hours for full day, / 4 hours for half day)
            const standardHours = isHalfDay ? 4 : 8;
            const hourlyRate = dailyRate / standardHours;

            // Calculate deduction amount
            const deductionAmount = deductionHours * hourlyRate;
            totalDeductions += deductionAmount;

            // Add base pay with holiday multiplier
            totalPay += dailyRate * multiplier;

            // Add meal allowance (not affected by multiplier)
            totalPay += mealAllowance;

            // If it's a holiday, add the holiday name to the date object for display
            if (HOLIDAYS_2025[dateStr]) {
                dateObj.holiday = HOLIDAYS_2025[dateStr].name;
                dateObj.holidayType = HOLIDAYS_2025[dateStr].type;
            }

            // Add deduction info to date object
            dateObj.deductionHours = deductionHours;
            dateObj.deductionAmount = deductionAmount;
        }
    });

    // Return the final pay amount after deductions
    return totalPay - totalDeductions;
}

function formatEmployeeName(fullName) {
    const nameParts = fullName.split(' ');
    
    // If name has only one or two parts, show the full name
    if (nameParts.length > 1) {
        return nameParts.slice(0, -1).join(' ');
    }
}

async function createEmployeeSquaresUI() {
    const loginForm = document.getElementById('loginForm');
    const codeInput = document.getElementById('codeInput');

    if (!loginForm || !codeInput || !isDesktop()) return;
    
    await loadEmployees();

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
        const employeeSquare = document.createElement('div');
        employeeSquare.className = 'employee-square';
        employeeSquare.setAttribute('data-code', code);

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

// Schedule view functionality
let currentScheduleWeek = new Date();

// Initialize schedule week to current week's Monday
function initializeScheduleWeek() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    monday.setDate(today.getDate() - daysToSubtract);
    monday.setHours(0, 0, 0, 0);
    currentScheduleWeek = monday;
    updateScheduleWeekTitle();
}

function updateScheduleWeekTitle() {
    const weekEnd = new Date(currentScheduleWeek);
    weekEnd.setDate(currentScheduleWeek.getDate() + 6);

    const startDay = currentScheduleWeek.getDate();
    const endDay = weekEnd.getDate();
    const startMonth = currentScheduleWeek.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = weekEnd.toLocaleDateString('en-US', { month: 'short' });

    let titleText;
    if (startMonth === endMonth) {
        titleText = `${startMonth} ${startDay} - ${endDay}`;
    } else {
        titleText = `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
    }

    document.getElementById('scheduleWeekTitle').textContent = titleText;
}

function changeScheduleWeek(direction) {
    const newWeek = new Date(currentScheduleWeek);
    newWeek.setDate(currentScheduleWeek.getDate() + (direction * 7));
    currentScheduleWeek = newWeek;
    updateScheduleWeekTitle();

    // Don't show loading state - let cache display instantly
    loadScheduleData();
}

function getScheduleWeekDates() {
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(currentScheduleWeek);
        date.setDate(currentScheduleWeek.getDate() + i);
        date.setHours(0, 0, 0, 0);
        dates.push(date);
    }
    return dates;
}

async function loadScheduleData() {
    const scheduleList = document.getElementById('scheduleList');
    if (!scheduleList) return;

    // Get cache key for current week and mode - DON'T use selectedBranch for "My Schedule"
    const weekKey = formatDate(currentScheduleWeek);
    let cacheKey;
    if (showMyScheduleOnly) {
        cacheKey = `schedule_cache_${currentUser}_${weekKey}`;
    } else {
        cacheKey = `schedule_cache_all_${selectedBranch}_${weekKey}`;
    }

    // Load from cache first for instant display
    const cachedData = localStorage.getItem(cacheKey);
    if (cachedData) {
        const scheduleData = JSON.parse(cachedData);
        renderScheduleCards(scheduleData);

        const cacheAge = Date.now() - (scheduleData._cacheTime || 0);
        const maxCacheAge = 30 * 60 * 1000; // 30 minutes

        if (cacheAge < maxCacheAge && navigator.onLine) {
            return;
        }
    } else {
        scheduleList.innerHTML = '<div style="text-align:center;padding:20px;">Loading schedule...</div>';
    }

    if (navigator.onLine) {
        try {
            console.log("Fetching fresh data for week:", weekKey);

            if (showMyScheduleOnly) {
                // ORIGINAL WORKING LOGIC FOR "MY SCHEDULE" 
                const weekDates = getScheduleWeekDates();
                const scheduleData = {};

                const weeksToCheck = [weekKey];

                // Check previous weeks for recurring shifts (up to 8 weeks back for performance)
                for (let i = 1; i <= 8; i++) {
                    const pastWeek = new Date(currentScheduleWeek);
                    pastWeek.setDate(pastWeek.getDate() - (i * 7));
                    weeksToCheck.push(formatDate(pastWeek));
                }

                for (const checkWeekKey of weeksToCheck) {
                    try {
                        const schedulesRef = collection(db, "schedules", checkWeekKey, "shifts");
                        const q = query(schedulesRef, where("employeeId", "==", currentUser));
                        const snapshot = await getDocs(q);

                        snapshot.forEach(doc => {
                            const shift = doc.data();

                            // Check if this shift applies to our target week
                            if (shift.recurringSeriesId || shift.isRecurringInstance || shift.recurring) {
                                // This is a recurring shift, calculate if it applies to current week
                                const shiftDate = new Date(shift.date + 'T00:00:00');
                                const targetWeekStart = new Date(currentScheduleWeek);
                                const targetWeekEnd = new Date(currentScheduleWeek);
                                targetWeekEnd.setDate(targetWeekEnd.getDate() + 6);

                                // Find the day of week for this shift
                                const shiftDayOfWeek = shiftDate.getDay();

                                // Calculate what date this day of week falls on in our target week
                                const targetDate = new Date(targetWeekStart);
                                const daysToAdd = shiftDayOfWeek === 0 ? 6 : shiftDayOfWeek - 1;
                                targetDate.setDate(targetDate.getDate() + daysToAdd);

                                // Check if this recurring shift should apply to the target date
                                if (targetDate >= targetWeekStart && targetDate <= targetWeekEnd && targetDate >= shiftDate) {
                                    const targetDateStr = formatDate(targetDate);

                                    // Only add if we don't already have a shift for this date
                                    if (!scheduleData[targetDateStr]) {
                                        scheduleData[targetDateStr] = {
                                            ...shift,
                                            date: targetDateStr,
                                            id: `recurring_${shift.id}_${targetDateStr}`
                                        };
                                    }
                                }
                            } else {
                                // Non-recurring shift, only add if it's in our target week
                                const shiftDate = shift.date;
                                const targetWeekStart = formatDate(currentScheduleWeek);
                                const targetWeekEnd = new Date(currentScheduleWeek);
                                targetWeekEnd.setDate(targetWeekEnd.getDate() + 6);
                                const targetWeekEndStr = formatDate(targetWeekEnd);

                                if (shiftDate >= targetWeekStart && shiftDate <= targetWeekEndStr) {
                                    scheduleData[shiftDate] = shift;
                                }
                            }
                        });
                    } catch (error) {
                        console.error("Error fetching schedule for week", checkWeekKey, error);
                    }
                }

                // Add cache timestamp
                scheduleData._cacheTime = Date.now();
                localStorage.setItem(cacheKey, JSON.stringify(scheduleData));
                renderScheduleCards(scheduleData);
            } else {
                // NEW LOGIC FOR "ALL SCHEDULE"
                const scheduleData = {};

                try {
                    const schedulesRef = collection(db, "schedules", weekKey, "shifts");

                    // Map "others" to actual branch values
                    let branchFilter = [];
                    if (selectedBranch === 'others') {
                        branchFilter = ['popup', 'workshop', 'other'];
                    } else {
                        branchFilter = [selectedBranch];
                    }

                    // Get all shifts for the selected branches
                    for (const branch of branchFilter) {
                        const q = query(schedulesRef, where("branch", "==", branch));
                        const snapshot = await getDocs(q);

                        snapshot.forEach(doc => {
                            const shift = doc.data();
                            const dateStr = shift.date;

                            if (!scheduleData[dateStr]) {
                                scheduleData[dateStr] = [];
                            }
                            scheduleData[dateStr].push(shift);
                        });
                    }
                } catch (error) {
                    console.error("Error fetching all schedules:", error);
                }

                scheduleData._cacheTime = Date.now();
                localStorage.setItem(cacheKey, JSON.stringify(scheduleData));
                renderScheduleCards(scheduleData);
            }
        } catch (error) {
            console.error("Error loading schedule:", error);
            if (!cachedData) {
                scheduleList.innerHTML = '<div style="text-align:center;padding:20px;color:#e63946;">Failed to load schedule</div>';
            }
        }
    } else if (!cachedData) {
        scheduleList.innerHTML = '<div style="text-align:center;padding:20px;color:#666;">No schedule data available offline</div>';
    }
}

function renderScheduleCards(scheduleData) {
    const scheduleList = document.getElementById('scheduleList');

    if (showMyScheduleOnly) {
        // Use original card layout for "My Schedule"
        renderMyScheduleCards(scheduleData);
    } else {
        // Use new compact row layout for "All Schedule"
        renderAllScheduleRows(scheduleData);
    }
}

function renderMyScheduleCards(scheduleData) {
    const scheduleList = document.getElementById('scheduleList');
    const weekDates = getScheduleWeekDates();
    const scheduleCards = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const date of weekDates) {
        const dateStr = formatDate(date);
        const isToday = date.getTime() === today.getTime();
        const dayScheduleData = scheduleData[dateStr] || null;
        
        // DON'T filter by branch for "My Schedule" - show all user's shifts
        const card = createScheduleCard(date, dayScheduleData, isToday);
        scheduleCards.push(card);
    }

    scheduleList.innerHTML = scheduleCards.join('');
}

function renderAllScheduleRows(scheduleData) {
    const scheduleList = document.getElementById('scheduleList');
    const weekDates = getScheduleWeekDates();
    const scheduleRows = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const date of weekDates) {
        const dateStr = formatDate(date);
        const isToday = date.getTime() === today.getTime();

        const row = createScheduleRow(date, scheduleData, isToday);
        scheduleRows.push(row);
    }

    scheduleList.innerHTML = scheduleRows.join('');
}

function createScheduleRow(date, allScheduleData, isToday) {
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNum = date.getDate();
    const monthName = date.toLocaleDateString('en-US', { month: 'short' });

    const todayClass = isToday ? 'today' : '';
    const dateStr = formatDate(date);

    // Get all shifts for this date
    const shiftsForDay = allScheduleData[dateStr] || [];

    let shiftsHTML = '';
    if (shiftsForDay.length > 0) {
        shiftsHTML = shiftsForDay.map(shift => createShiftCompact(shift)).join('');
    } else {
        shiftsHTML = '<div class="schedule-no-shifts">No shifts scheduled</div>';
    }

    return `
        <div class="schedule-day-row ${todayClass}">
            <div class="schedule-date-compact">
                <div class="day-name">${dayName}</div>
                <div class="day-date">${monthName} ${dayNum}</div>
            </div>
            <div class="schedule-shifts-compact">
                ${shiftsHTML}
            </div>
        </div>
    `;
}

function createShiftCompact(shift) {
    const shiftTypes = {
        'opening': { name: 'Opening' },
        'openingHalf': { name: 'Opening Half-Day', time: '9:30 AM - 1:30 PM' },
        'midshift': { name: 'Midshift' },
        'closing': { name: 'Closing' },
        'closingHalf': { name: 'Closing Half' },
        'custom': { name: 'Custom' }
    };

    const shiftType = shiftTypes[shift.type] || { name: shift.type };

    // Get employee name with better fallback
    let employeeName = 'Loading...';

    if (employeeNicknames && employeeNicknames[shift.employeeId]) {
        employeeName = employeeNicknames[shift.employeeId];
    } else if (employees && employees[shift.employeeId]) {
        employeeName = employees[shift.employeeId];
    } else if (shift.employeeId) {
        // Trigger loading if we don't have the name
        if (!employees || Object.keys(employees).length === 0) {
            loadEmployees();
        }
        employeeName = shift.employeeId; // Show ID as fallback
    }

    return `
        <div class="shift-compact">
            <div class="shift-name">${employeeName}</div>
            <div class="shift-detail">${shiftType.name}</div>
        </div>
    `;
}

function getWeekStartKey(date) {
    const dayOfWeek = date.getDay();
    const monday = new Date(date);
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    monday.setDate(date.getDate() - daysToSubtract);
    monday.setHours(0, 0, 0, 0);
    return formatDate(monday);
}

function createScheduleCard(date, scheduleData, isToday) {
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNum = date.getDate();
    const monthName = date.toLocaleDateString('en-US', { month: 'short' });

    const todayClass = isToday ? 'today' : '';

    if (!scheduleData) {
        return `
            <div class="schedule-day-card ${todayClass}">
                <div class="schedule-date-section">
                    <div class="schedule-day-name">${dayName}</div>
                    <div class="schedule-day-date">${monthName} ${dayNum}</div>
                </div>
                <div class="schedule-duty-section">
                    <div class="schedule-no-duty">No duty scheduled</div>
                </div>
            </div>
        `;
    }

    const branchNames = {
        'podium': 'Podium',
        'smnorth': 'SM North',
        'popup': 'Pop-up',
        'workshop': 'Workshop',
        'other': 'Other Events'
    };

    const shiftTypes = {
        'opening': { name: 'Opening', time: '9:30 AM - 6:30 PM' },
        'openingHalf': { name: 'Opening Half-Day', time: '9:30 AM - 1:30 PM' },
        'midshift': { name: 'Midshift', time: '11:00 AM - 8:00 PM' },
        'closing': { name: 'Closing', time: '1:00 PM - 10:00 PM' },
        'closingHalf': { name: 'Closing Half-Day', time: '6:00 PM - 10:00 PM' },
        'custom': { name: 'Custom', time: 'Custom Hours' }
    };

    const branch = branchNames[scheduleData.branch] || scheduleData.branch;
    const shift = shiftTypes[scheduleData.type] || { name: scheduleData.type, time: 'Custom' };
    const shiftTime = scheduleData.type === 'custom' && scheduleData.customStart && scheduleData.customEnd
        ? `${formatTimeTo12Hour(scheduleData.customStart)} - ${formatTimeTo12Hour(scheduleData.customEnd)}`
        : shift.time;

    return `
        <div class="schedule-day-card ${todayClass}">
            <div class="schedule-date-section">
                <div class="schedule-day-name">${dayName}</div>
                <div class="schedule-day-date">${monthName} ${dayNum}</div>
            </div>
            <div class="schedule-duty-section">
                <div class="schedule-branch">${branch}</div>
                <div class="schedule-shift-info">
                    <div class="schedule-shift-type">${shift.name}</div>
                    <div class="schedule-shift-time">${shiftTime}</div>
                </div>
            </div>
        </div>
    `;
}

function formatTimeTo12Hour(time24) {
    const [hours, minutes] = time24.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
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
document.addEventListener('DOMContentLoaded', async function () {
    if (isDesktop()) {
        await createEmployeeSquaresUI();

        // Also resize the login form container for better display
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.style.height = 'auto'; // Override the 90vh height
        }
    }

    await loadHolidays();

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

// Add payment confirmation checking function
async function checkPaymentConfirmation(periodId) {
    if (!navigator.onLine || !currentUser) return null;

    try {
        const paymentRef = doc(db, "payment_confirmations", `${currentUser}_${periodId}`);
        const paymentSnap = await getDoc(paymentRef);

        if (paymentSnap.exists()) {
            const paymentData = paymentSnap.data();
            return paymentData.screenshotUrl || null;
        }
        return null;
    } catch (error) {
        console.error("Error checking payment confirmation:", error);
        return null;
    }
}

// Function to show payment confirmation indicator
function showPaymentConfirmationIndicator(screenshotUrl) {
    // Remove existing indicator if present
    clearPaymentIndicator();

    // Create payment confirmation indicator
    const indicator = document.createElement('div');
    indicator.className = 'payment-confirmation-indicator';
    indicator.innerHTML = `
        <div class="payment-sent-badge">
            💸 Payment Sent
        </div>
    `;

    // Add click handler to show modal
    indicator.addEventListener('click', () => {
        openPaymentConfirmationModal(screenshotUrl);
    });

    // Insert above attendance record
    const attendanceHeader = document.querySelector('.attendance-header');
    if (attendanceHeader) {
        attendanceHeader.parentNode.insertBefore(indicator, attendanceHeader);
    }
}

// Function to clear payment indicator
function clearPaymentIndicator() {
    const existingIndicator = document.querySelector('.payment-confirmation-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }
}

// Modal functions
function openPaymentConfirmationModal(screenshotUrl) {
    const modal = document.getElementById('paymentConfirmationModal');
    const image = document.getElementById('paymentModalImage');

    image.src = screenshotUrl;
    modal.style.display = 'flex';

    modal.onclick = closePaymentConfirmationModal;
}

function closePaymentConfirmationModal() {
    const modal = document.getElementById('paymentConfirmationModal');
    const image = document.getElementById('paymentModalImage');

    modal.style.display = 'none';
    image.src = '';
    modal.onclick = null;
}

// Expose functions for HTML onclick events
window.openPaymentConfirmationModal = openPaymentConfirmationModal;
window.closePaymentConfirmationModal = closePaymentConfirmationModal;

// Add this to the end of your script.js file
let deferredPrompt;

// Listen for the beforeinstallprompt event
window.addEventListener('beforeinstallprompt', (e) => {
    console.log('PWA install prompt available');
    e.preventDefault();
    deferredPrompt = e;

    // Show install button if you want (optional)
    showInstallButton();
});

// Listen for app installed event
window.addEventListener('appinstalled', (evt) => {
    console.log('PWA was installed');
    hideInstallButton();
});

function showInstallButton() {
    // Create install button (optional)
    const installBtn = document.createElement('button');
    installBtn.textContent = '📱 Install App';
    installBtn.className = 'install-btn';
    installBtn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #2b9348;
        color: white;
        border: none;
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    installBtn.addEventListener('click', installApp);
    document.body.appendChild(installBtn);
}

function hideInstallButton() {
    const installBtn = document.querySelector('.install-btn');
    if (installBtn) {
        installBtn.remove();
    }
}

async function installApp() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to install prompt: ${outcome}`);
        deferredPrompt = null;
        hideInstallButton();
    }
}