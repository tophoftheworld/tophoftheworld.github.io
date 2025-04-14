const APP_VERSION = "0.47"; 

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


setInterval(() => {
    const now = new Date();
    timestamp.textContent = `Current Time: ${now.toLocaleTimeString()}`;
}, 1000);

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

// Optimized cacheMostRecentAttendance function
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

        // Update UI to show background sync is happening
        const networkStatus = document.getElementById("networkStatus");
        const originalText = networkStatus.textContent;
        networkStatus.textContent = "🔄 Caching recent data...";

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

        // Restore network status
        networkStatus.textContent = originalText;
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

function takePhoto() {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.translate(video.videoWidth, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    selfieData = canvas.toDataURL("image/jpeg", 0.6);

    video.style.display = "none";
    previewImg.src = selfieData;
    previewImg.style.display = "block";

    captureCircle.style.display = "none";
    cameraControls.style.display = "flex";
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


    setTimeout(updateSyncStatusDots, 500);
}

document.getElementById("closeCameraBtn").addEventListener("click", () => {
    videoContainer.style.display = "none";
    if (stream) stream.getTracks().forEach(t => t.stop());
});

async function saveAttendanceWithImageCompression() {
    console.log("💾 Running saveAttendance with compression...");
    const key = `attendance_${currentUser}_${formatDate(viewDate)}`;
    const now = new Date();
    const time = now.toLocaleTimeString();
    const existing = JSON.parse(localStorage.getItem(key)) || {};
    
    // Compress image to save storage space
    let compressedSelfie = "";
    if (selfieData) {
        try {
            compressedSelfie = await compressAndStoreImage(selfieData);
            console.log("Image compressed for storage");
        } catch (error) {
            console.warn("Image compression failed, using original", error);
            compressedSelfie = selfieData;
        }
    }
    
    // Add to sync queue (same as before)
    let syncQueue = JSON.parse(localStorage.getItem("syncQueue") || "[]");

    if (dutyStatus === 'in') {
        const branch = document.getElementById("branchSelect")?.value || "Matcha Bar Podium";
        const shift = document.getElementById("shiftSelect")?.value || "Opening";
        
        // Use compressed image for storage
        existing.clockIn = { 
            time, 
            selfie: compressedSelfie, 
            branch, 
            shift,
            timestamp: Date.now() // Add timestamp for sorting
        };
        
        // Online/offline handling as before...
        
    } else {
        // Clock out with compressed image
        existing.clockOut = { 
            time, 
            selfie: compressedSelfie,
            timestamp: Date.now() // Add timestamp for sorting
        };
        
        // Online/offline handling as before...
    }
    
    // Store locally
    localStorage.setItem(key, JSON.stringify(existing));
    updateCardTimes(existing);
    updateDateUI();
}


async function saveAttendance() {
    console.log("💾 Running saveAttendance...");
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
        const branch = document.getElementById("branchSelect")?.value || "Matcha Bar Podium";
        const shift = document.getElementById("shiftSelect")?.value || "Opening";

        // Create new clock in data - don't modify existing.clockOut if it exists
        existing.clockIn = {
            time,
            selfie: selfieData,
            branch,
            shift,
            timestamp: Date.now()
        };

        if (navigator.onLine) {
            try {
                const dateKey = formatDate(viewDate);
                const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);

                // Get existing data first to avoid overwriting clockOut
                const docSnap = await getDoc(subDocRef);
                let dataToSave = { clockIn: existing.clockIn };

                // If there's existing data with clockOut, preserve it
                if (docSnap.exists()) {
                    const existingData = docSnap.data();
                    if (existingData.clockOut) {
                        console.log("Preserving existing clockOut data");
                        existing.clockOut = existingData.clockOut;
                    }
                }

                await setDoc(subDocRef, dataToSave, { merge: true });
                existing.synced = true;
                console.log("✅ Clock-in saved to Firestore");
            } catch (err) {
                console.warn('🔌 Failed to save to Firestore - will sync later', err);
                existing.synced = false;

                if (!syncQueue.includes(key)) {
                    syncQueue.push(key);
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
            existing.synced = false;
            if (!syncQueue.includes(key)) {
                syncQueue.push(key);
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
                    const dateKey = formatDate(viewDate);
                    const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);
                    const docSnap = await getDoc(subDocRef);

                    if (docSnap.exists() && docSnap.data().clockIn) {
                        // Use the Firestore clockIn data
                        existing.clockIn = docSnap.data().clockIn;
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
            timestamp: Date.now()
        };

        if (navigator.onLine) {
            try {
                const dateKey = formatDate(viewDate);
                const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);

                // We're specifically only updating the clockOut field
                await setDoc(subDocRef, { clockOut: existing.clockOut }, { merge: true });
                existing.synced = true;
                console.log("✅ Clock-out saved to Firestore");
            } catch (err) {
                console.warn('🔌 Failed to save to Firestore - will sync later', err);
                existing.synced = false;

                if (!syncQueue.includes(key)) {
                    syncQueue.push(key);
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
            existing.synced = false;
            if (!syncQueue.includes(key)) {
                syncQueue.push(key);
                localStorage.setItem("syncQueue", JSON.stringify(syncQueue));
            }
            alert("📴 You're offline. Your time will be saved locally and synced when back online.");
        }

        dutyStatus = 'in';
    }

    // Store locally
    localStorage.setItem(key, JSON.stringify(existing));
    updateCardTimes(existing);
    updateDateUI();

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

    let data = {};
    try {
        const docSnap = await getDoc(doc(db, "attendance", currentUser, "dates", dateKey));
        if (docSnap.exists()) data = docSnap.data();
    } catch (err) {
        console.warn("⚠️ Offline - using local fallback in handleClock()");
        document.getElementById("networkStatus").textContent = "📴 Offline - using local data";
        const local = localStorage.getItem(`attendance_${currentUser}_${dateKey}`);
        if (local) data = JSON.parse(local);
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

    // If we get here, the action doesn't make sense (already clocked in/out)
    // if (type === 'in' && data.clockIn) {
    //     alert("You're already clocked in for today.");
    // } else if (type === 'out' && !data.clockIn) {
    //     alert("You need to clock in before you can clock out.");
    // } else if (type === 'out' && data.clockOut) {
    //     alert("You've already clocked out for today.");
    // }
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

document.getElementById("toggleHistoryBtn").addEventListener("click", async () => {
    const historyDiv = document.getElementById("historyLog");
    const contentDiv = document.getElementById("historyContent");

    if (historyDiv.style.display === "none") {
        historyDiv.style.display = "block";
        await loadHistoryLogs();
    } else {
        historyDiv.style.display = "none";
    }
});

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
        branchSelect.value = "Matcha Bar Podium";
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

    updateSyncStatusDots();

    for (const key of syncQueue) {
        const localData = JSON.parse(localStorage.getItem(key) || "{}");
        if (localData.synced) continue; // Skip already synced data

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

            // Only sync clockIn if it doesn't exist on server OR local timestamp is newer
            if (localData.clockIn &&
                (!serverData.clockIn ||
                    !serverData.clockIn.timestamp ||
                    localData.clockIn.timestamp > serverData.clockIn.timestamp)) {
                syncData.clockIn = localData.clockIn;
            }

            // Only sync clockOut if it doesn't exist on server OR local timestamp is newer
            if (localData.clockOut &&
                (!serverData.clockOut ||
                    !serverData.clockOut.timestamp ||
                    localData.clockOut.timestamp > serverData.clockOut.timestamp)) {
                syncData.clockOut = localData.clockOut;
            }

            // Only update if we have something to sync
            if (Object.keys(syncData).length > 0) {
                await setDoc(ref, syncData, { merge: true });
                console.log(`Synced fields: ${Object.keys(syncData).join(', ')}`);
            } else {
                console.log("No newer data to sync");
            }

            // Mark as synced in localStorage
            localData.synced = true;
            localStorage.setItem(key, JSON.stringify(localData));

            successCount++;
            console.log(`✅ Synced: ${key}`);

            if (syncQueue.length > 2 && (successCount + failCount) % 2 === 0) {
                const progress = Math.round(((successCount + failCount) / syncQueue.length) * 100);
                showToast(`Syncing: ${progress}% complete`, 'syncing', 1500);
            }
        } catch (err) {
            failCount++;
            console.warn(`❌ Failed to sync ${key}:`, err);
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
    const updatedQueue = syncQueue.filter(key => {
        const data = JSON.parse(localStorage.getItem(key) || "{}");
        return !data.synced;
    });

    localStorage.setItem("syncQueue", JSON.stringify(updatedQueue));

    // Update status message
    if (updatedQueue.length === 0) {
        document.getElementById("networkStatus").textContent = "✅ Online - All data synced";
    } else {
        document.getElementById("networkStatus").textContent =
            `⚠️ Online - ${successCount} synced, ${failCount} pending`;
    }

    console.log(`🔄 Sync complete: ${successCount} successful, ${failCount} failed`);

    // Refresh current view after sync
    updateSummaryUI();
    updateSyncStatusDots();
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
    // Make sure UI elements exist
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
        if (syncQueue.length > 0) {
            // Only show sync toast if we just came online
            if (window._wasOffline) {
                showToast(`Syncing ${syncQueue.length} items...`, 'syncing');
                syncPendingData();
            }
        }
        window._wasOffline = false;
    } else {
        // We're offline
        offlineIndicator.classList.add('show');

        // Show toast only on first detection of offline
        if (!window._wasOffline) {
            showToast('You are offline. Changes will be saved locally.', 'offline');
        }
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

    // Only show badges if we're offline or have unsynced data
    if (!navigator.onLine || localStorage.getItem('syncQueue')) {
        const todayKey = `attendance_${currentUser}_${formatDate(new Date())}`;
        const todayData = JSON.parse(localStorage.getItem(todayKey) || '{}');

        // If there's unsynced data for today, add badges
        if (!todayData.synced) {
            if (todayData.clockIn) {
                addOfflineBadge('clockInCard');
            }

            if (todayData.clockOut) {
                addOfflineBadge('clockOutCard');
            }
        }
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

        // Show update modal and offer refresh
        showUpdateNotification(lastVersion, APP_VERSION);

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
    // First show a toast
    showToast(`New version available: ${oldVersion} → ${newVersion}`, 'online', 5000);

    // Then show the modal
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

    // Ensure it's positioned at the top
    container.style.top = '20px';
    container.style.bottom = 'auto';

    // Add to document
    document.body.appendChild(container);

    return container;
}

function showToast(message, type = '', duration = 3000) {
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

    // For short messages, ensure reasonable width
    if (message.length < 15) {
        toast.style.minWidth = '200px';
    }

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

    return toast; // Return the toast element for potential future reference
}
