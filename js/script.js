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

            // Cache recent attendance data for offline viewing
            await cacheMostRecentAttendance(code);

            showMainInterface(code);
            updateGreetingUI();
            await updateSummaryUI();
        } else {
            alert("❌ Invalid employee code");
        }
    } catch (error) {
        console.error("Login error:", error);

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

async function cacheMostRecentAttendance(userCode) {
    try {
        const last30Days = [];
        let date = new Date();

        // Get last 30 days of dates
        for (let i = 0; i < 30; i++) {
            last30Days.push(formatDate(date));
            date.setDate(date.getDate() - 1);
        }

        // Fetch recent attendance data
        for (const dateKey of last30Days) {
            const subDocRef = doc(db, "attendance", userCode, "dates", dateKey);
            const docSnap = await getDoc(subDocRef);

            if (docSnap.exists()) {
                const key = `attendance_${userCode}_${dateKey}`;
                const data = docSnap.data();
                data.synced = true; // Mark as synced
                localStorage.setItem(key, JSON.stringify(data));
            }
        }

        console.log("✅ Cached recent attendance for offline use");
    } catch (error) {
        console.error("Failed to cache recent attendance:", error);
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
    console.log("📸 Submitting photo...");
    videoContainer.style.display = "none";
    if (stream) stream.getTracks().forEach(t => t.stop());

    if (!selfieData) {
        alert("⚠️ No photo captured. Please retake.");
        return;
    }

    saveAttendance();
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
    const existing = JSON.parse(localStorage.getItem(key)) || {};

    // We'll add a syncQueue for tracking offline changes
    let syncQueue = JSON.parse(localStorage.getItem("syncQueue") || "[]");

    // Create a new attendance entry
    if (dutyStatus === 'in') {
        const branch = document.getElementById("branchSelect")?.value || "Matcha Bar Podium";
        const shift = document.getElementById("shiftSelect")?.value || "Opening";
        existing.clockIn = { time, selfie: selfieData, branch, shift };

        if (navigator.onLine) {
            try {
                const dateKey = formatDate(viewDate);
                const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);
                await setDoc(subDocRef, { clockIn: existing.clockIn }, { merge: true });
                existing.synced = true;
                console.log("✅ Clock-in saved to Firestore");
            } catch (err) {
                console.warn('🔌 Failed to save to Firestore - will sync later', err);
                existing.synced = false;

                // Add to sync queue
                if (!syncQueue.includes(key)) {
                    syncQueue.push(key);
                    localStorage.setItem("syncQueue", JSON.stringify(syncQueue));
                }

                // Register for background sync if available
                if ('serviceWorker' in navigator && 'SyncManager' in window) {
                    const registration = await navigator.serviceWorker.ready;
                    try {
                        await registration.sync.register('sync-attendance');
                        console.log("Background sync registered");
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
            alert("📴 You're offline. Your time will be saved locally and synced when you're back online.");
        }

        dutyStatus = 'out';
    } else {
        // Clock out logic
        existing.clockOut = { time, selfie: selfieData };

        if (navigator.onLine) {
            try {
                const dateKey = formatDate(viewDate);
                const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);
                await setDoc(subDocRef, { clockOut: existing.clockOut }, { merge: true });
                existing.synced = true;
                console.log("✅ Clock-out saved to Firestore");
            } catch (err) {
                console.warn('🔌 Failed to save to Firestore - will sync later', err);
                existing.synced = false;

                // Add to sync queue
                if (!syncQueue.includes(key)) {
                    syncQueue.push(key);
                    localStorage.setItem("syncQueue", JSON.stringify(syncQueue));
                }

                // Register for background sync if available
                if ('serviceWorker' in navigator && 'SyncManager' in window) {
                    const registration = await navigator.serviceWorker.ready;
                    try {
                        await registration.sync.register('sync-attendance');
                        console.log("Background sync registered");
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
            alert("📴 You're offline. Your time will be saved locally and synced when you're back online.");
        }

        dutyStatus = 'in';
    }

    // Store locally for UI speed
    localStorage.setItem(key, JSON.stringify(existing));
    updateCardTimes(existing);
    updateDateUI();

    console.log("🎉 UI updated");
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

    if (type === 'in' && !data.clockIn) startPhotoSequence();

    if (type === 'out' && data.clockIn && !data.clockOut) {
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

window.addEventListener('online', () => {
    console.log('🌐 App is online');
    updateNetworkStatus();

    // Try to sync when coming back online
    syncPendingData();
});

async function syncPendingData() {
    document.getElementById("networkStatus").textContent = "🔄 Syncing...";

    const syncQueue = JSON.parse(localStorage.getItem("syncQueue") || "[]");

    if (syncQueue.length === 0) {
        document.getElementById("networkStatus").textContent = "✅ Online";
        return;
    }

    console.log(`🔄 Syncing ${syncQueue.length} records...`);

    let successCount = 0;
    let failCount = 0;

    for (const key of syncQueue) {
        const data = JSON.parse(localStorage.getItem(key) || "{}");
        if (data.synced) continue; // Skip already synced data

        // Extract user and date from key
        const [, user, date] = key.split('_');
        if (!user || !date) continue;

        const ref = doc(db, "attendance", user, "dates", date);

        try {
            // Create a clean object with only what we need to sync
            const syncData = {};
            if (data.clockIn) syncData.clockIn = data.clockIn;
            if (data.clockOut) syncData.clockOut = data.clockOut;

            await setDoc(ref, syncData, { merge: true });

            // Mark as synced in localStorage
            data.synced = true;
            localStorage.setItem(key, JSON.stringify(data));

            successCount++;
            console.log(`✅ Synced: ${key}`);
        } catch (err) {
            failCount++;
            console.warn(`❌ Failed to sync ${key}:`, err);
        }
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
}

window.addEventListener('offline', () => {
    console.log('📴 App is offline');
    updateNetworkStatus();
});

function updateNetworkStatus() {
    const el = document.getElementById("networkStatus");

    if (navigator.onLine) {
        // Check if there are items to sync
        const syncQueue = JSON.parse(localStorage.getItem("syncQueue") || "[]");

        if (syncQueue.length > 0) {
            el.textContent = `🔄 Online - ${syncQueue.length} items to sync`;
            el.style.color = "#ff9500";

            // Trigger sync
            syncPendingData();
        } else {
            el.textContent = "✅ Online";
            el.style.color = "#2b9348";
        }
    } else {
        el.textContent = "📴 Offline - saving locally";
        el.style.color = "#e63946";
    }
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('✅ Service Worker registered:', registration.scope);
                
                // Listen for messages from service worker
                navigator.serviceWorker.addEventListener('message', event => {
                    if (event.data && event.data.type === 'SYNC_STARTED') {
                        document.getElementById("networkStatus").textContent = 
                            `🔄 Syncing ${event.data.dataCount} items...`;
                    } else if (event.data && event.data.type === 'SYNC_COMPLETED') {
                        updateNetworkStatus();
                    }
                });
            })
            .catch(err => {
                console.error('❌ Service Worker registration failed:', err);
            });
    }
}

// Call this function on page load
registerServiceWorker();

// ✅ Run network status check after definition
updateNetworkStatus();

// document.getElementById("greeting").textContent = getTimeBasedGreeting();


document.addEventListener('DOMContentLoaded', updateNetworkStatus);

// ✅ Expose functions to window for HTML inline events
window.takePhoto = takePhoto;
window.retakePhoto = retakePhoto;
window.submitPhoto = submitPhoto;
window.logoutUser = logoutUser;
window.clearData = clearData;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.handleClock = handleClock;