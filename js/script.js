const ALLOW_PAST_CLOCKING = true;

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

const scheduledTimeIn = "10:30 PM";
const scheduledTimeOut = "6:30 PM";

setInterval(() => {
    const now = new Date();
    timestamp.textContent = `Current Time: ${now.toLocaleTimeString()}`;
}, 1000);

setInterval(() => {
    if (formatDate(viewDate) !== formatDate(today)) return;

    const key = `attendance_${currentUser}_${formatDate(viewDate)}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    if (!data.clockIn) {
        updateCardTimes(data); // recheck status
    }
}, 10000);

if (currentUser && employees[currentUser]) {
    showMainInterface(currentUser);
    updateGreetingUI();
}

function getAttendanceDates() {
    const keys = Object.keys(localStorage);
    const prefix = `attendance_${currentUser}_`;
    return keys
        .filter(key => key.startsWith(prefix))
        .map(key => key.replace(prefix, ""));
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

function loginUser() {
    const code = document.getElementById("codeInput").value.trim();
    if (employees[code]) {
        currentUser = code;
        localStorage.setItem("loggedInUser", code);
        showMainInterface(code);
        updateGreetingUI();
        
        const key = `attendance_${currentUser}_${formatDate(viewDate)}`;
        const data = JSON.parse(localStorage.getItem(key)) || {};
        updateCardTimes(data);
    } else {
        alert("❌ Invalid code");
    }
}

function logoutUser() {
    localStorage.removeItem("loggedInUser");
    location.reload();
}

function showMainInterface(code) {
    loginForm.style.display = "none";
    mainInterface.style.display = "block";
    viewDate = new Date();
    const key = `attendance_${currentUser}_${formatDate(viewDate)}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    dutyStatus = data.clockIn && !data.clockOut ? 'out' : 'in';
    updateSummaryUI();
}

function updateSummaryUI() {
    const isToday = formatDate(viewDate) === formatDate(today);
    const key = `attendance_${currentUser}_${formatDate(viewDate)}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};

    updateCardTimes(data);

    // ✅ Update visible text date
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = viewDate.toLocaleDateString('en-US', options);
    const [weekday, monthDayYear] = formattedDate.split(', ');
    document.getElementById("dayOfWeek").textContent = weekday;
    document.getElementById("fullDate").textContent = monthDayYear;

    const formatted = formatDate(viewDate);
    datePicker.value = formatted;
    if (datePicker._flatpickr) {
        datePicker._flatpickr.jumpToDate(viewDate);
    }

    // nextBtn.disabled = formatDate(viewDate) >= formatDate(today);

    // summaryContainer.innerHTML = `
    // <div class="summary-row">
    //     <div class="summary-block">
    //     <strong>Clock In:</strong>
    //     <div>${data.clockIn?.time || '--'}</div>
    //     <div>${data.clockIn?.branch || ''}</div>
    //     </div>
    //     <div class="summary-block">
    //     <strong>Clock Out:</strong>
    //     <div>${data.clockOut?.time || '--'}</div>
    //     <div>${data.clockOut?.branch || ''}</div>
    //     </div>
    //   </div>`;

    const isActiveDay = ALLOW_PAST_CLOCKING || isToday;
    dutyStatus = !data.clockIn ? 'in' : (data.clockOut ? 'in' : 'out');

    // startBtn.textContent = dutyStatus === 'in' ? "Clock In" : "Clock Out";
    // startBtn.style.display = isActiveDay && (!data.clockIn || !data.clockOut) ? "block" : "none";

    const branchSelect = document.getElementById("branchSelect");
    branchSelect.style.display = isToday && !data.clockIn ? "block" : "none";
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
    videoContainer.style.display = "none";
    if (stream) stream.getTracks().forEach(t => t.stop());
    saveAttendance();
}

function saveAttendance() {
    const key = `attendance_${currentUser}_${formatDate(viewDate)}`;
    const now = new Date();
    const time = now.toLocaleTimeString();
    const existing = JSON.parse(localStorage.getItem(key)) || {};

    // Prevent double clock in/out
    if (dutyStatus === 'in' && existing.clockIn) return;
    if (dutyStatus === 'out' && existing.clockOut) return;

    if (dutyStatus === 'in') {
        const branch = document.getElementById("branchSelect")?.value || "N/A";
        existing.clockIn = { time, selfie: selfieData, branch };
        dutyStatus = 'out';
    } else {
        existing.clockOut = { time, selfie: selfieData };
        dutyStatus = 'in';
    }

    localStorage.setItem(key, JSON.stringify(existing));
    const updated = JSON.parse(localStorage.getItem(key));
    updateSummaryUI();
    updateCardTimes(updated); // this updates the time + selfie background
}

function clearData() {
    if (confirm("Are you sure you want to clear all local data?")) {
        localStorage.clear();
        location.reload();
    }
}

function updateGreetingUI() {
    const name = employees[currentUser] || "Employee";
    document.getElementById("userName").textContent = name;

    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formatted = now.toLocaleDateString('en-US', options);
    const [weekday, monthDayYear] = formatted.split(', ');

    document.getElementById("dayOfWeek").textContent = weekday;
    document.getElementById("fullDate").textContent = monthDayYear;
}

function handleClock(type) {
    const key = `attendance_${currentUser}_${formatDate(viewDate)}`;
    const data = JSON.parse(localStorage.getItem(key)) || {};
    if (type === 'in' && !data.clockIn) startPhotoSequence();
    if (type === 'out' && data.clockIn && !data.clockOut) startPhotoSequence();
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
    const clockInPhoto = document.getElementById("clockInPhoto");
    const clockInOverlay = document.getElementById("clockInOverlay");
    const statusLabel = document.getElementById("clockInStatusLabel");
    const label = clockInOverlay.querySelector(".panel-label");
    const timeSpan = document.getElementById("clockInTime");

    // Set default
    let timeInToShow = scheduledTimeIn;
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
        clockInPhoto.src = data.clockIn.selfie;
        clockInPhoto.style.display = "block";
        clockInPhoto.onclick = () => openImageModal(data.clockIn.selfie);
        clockInOverlay.classList.add("overlayed");

    }

    // Update panel UI
    const [inTime, inMeridiem] = splitTime(timeInToShow);
    timeSpan.innerHTML = `${inTime}<span class="ampm">${inMeridiem}</span>`;
    statusLabel.textContent = isToday ? statusText : "";

    // Apply color classes
    clockInOverlay.classList.remove("red", "green");
    if (isToday) clockInOverlay.classList.add(overlayColor);

    if (!data.clockIn) {
        clockInPhoto.src = "";
        clockInPhoto.style.display = "none";
        clockInPhoto.onclick = null;
    }

    // Clock Out (left untouched for now)
    const clockOutTime = data.clockOut?.time || scheduledTimeOut;
    const [outTime, outMeridiem] = splitTime(clockOutTime);

    const clockOutPhoto = document.getElementById("clockOutPhoto");
    const clockOutOverlay = document.getElementById("clockOutOverlay");

    document.getElementById("clockOutTime").innerHTML = `${outTime}<span class="ampm">${outMeridiem}</span>`;

    if (data.clockOut?.selfie) {
        clockOutPhoto.src = data.clockOut.selfie;
        clockOutPhoto.style.display = "block";
        clockOutPhoto.onclick = () => openImageModal(data.clockOut.selfie);
        clockOutOverlay.classList.add("green");
    } else {
        clockOutPhoto.src = "";
        clockOutPhoto.style.display = "none";
        clockOutPhoto.onclick = null;
        clockOutOverlay.classList.remove("green");
    }
}



function splitTime(fullTimeStr) {
    if (!fullTimeStr) return ["--:--", ""];

    const match = fullTimeStr.match(/^(\d{1,2}):(\d{2}):\d{2} (\w{2})$/);
    if (!match) return ["--:--", ""];

    let [, hour, minute, ampm] = match;

    return [`${hour}:${minute}`, ampm];
}

const floatingPicker = flatpickr("#datePicker", {
    dateFormat: "Y-m-d",
    defaultDate: today,
    maxDate: today,
    disableMobile: true,
    onChange: function (selectedDates) {
        viewDate = selectedDates[0];
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
