const ALLOW_PAST_CLOCKING = true;

const employees = {
    "1010": "Jasmine Cruz",
    "1020": "Ron dela Peña",
    "1030": "Carla Ramos",
    "1040": "EJ Tan",
    "1050": "Miko Santos"
};

let dutyStatus = "in";
let selfieData = "";
let currentUser = localStorage.getItem("loggedInUser") || "";
let today = new Date();
today.setHours(0, 0, 0, 0);
let viewDate = new Date();
let stream = null;

const timestamp = document.getElementById("timestamp");
const summaryDate = document.getElementById("summaryDate");
const welcomeText = document.getElementById("welcomeText");
const mainInterface = document.getElementById("mainInterface");
const loginForm = document.getElementById("loginForm");
const summaryContainer = document.getElementById("summaryContainer");
const startBtn = document.getElementById("startBtn");
const video = document.getElementById("video");
const previewImg = document.getElementById("previewImg");
const canvas = document.getElementById("snapshot");
const videoContainer = document.getElementById("videoContainer");
const nextBtn = document.getElementById("nextBtn");
const captureCircle = document.getElementById("captureCircle");
const cameraControls = document.getElementById("cameraControls");

setInterval(() => {
    const now = new Date();
    timestamp.textContent = `Current Time: ${now.toLocaleTimeString()}`;
}, 1000);

if (currentUser && employees[currentUser]) {
    showMainInterface(currentUser);
}

function getAttendanceDates() {
    const keys = Object.keys(localStorage);
    const prefix = `attendance_${currentUser}_`;
    return keys
        .filter(key => key.startsWith(prefix))
        .map(key => key.replace(prefix, ""));
}

flatpickr("#summaryDate", {
    dateFormat: "Y-m-d",
    defaultDate: today,
    maxDate: today,
    disableMobile: true,
    onChange: function (selectedDates) {
        viewDate = selectedDates[0];
        updateSummaryUI();
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
    welcomeText.textContent = `👋 Welcome, ${employees[code]}`;
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

    const formatted = formatDate(viewDate);
    summaryDate.value = formatted;
    if (summaryDate._flatpickr) {
        summaryDate._flatpickr.jumpToDate(viewDate);
    }

    nextBtn.disabled = formatDate(viewDate) >= formatDate(today);

    summaryContainer.innerHTML = `
      <div class="summary-row">
        <div class="summary-block">
          <strong>Clock In:</strong>
          <div>${data.clockIn?.time || '--'}</div>
          ${data.clockIn?.selfie ? `<img class="summary-photo" src="${data.clockIn.selfie}" />` : ''}
          <div>${data.clockIn?.branch || ''}</div>
        </div>
        <div class="summary-block">
          <strong>Clock Out:</strong>
          <div>${data.clockOut?.time || '--'}</div>
          ${data.clockOut?.selfie ? `<img class="summary-photo" src="${data.clockOut.selfie}" />` : ''}
          <div>${data.clockIn?.branch || ''}</div>
        </div>
      </div>`;

    const isActiveDay = ALLOW_PAST_CLOCKING || isToday;

    if (isActiveDay && (!data.clockIn || !data.clockOut)) {
        dutyStatus = !data.clockIn ? 'in' : 'out';
        startBtn.textContent = dutyStatus === 'in' ? "Clock In" : "Clock Out";
        startBtn.style.display = "block";
    } else {
        startBtn.style.display = "none";
    }

    const branchSelect = document.getElementById("branchSelect");
    if (isToday && !data.clockIn) {
        branchSelect.style.display = "block";
    } else {
        branchSelect.style.display = "none";
    }
}

function changeDay(delta) {
    viewDate.setDate(viewDate.getDate() + delta);

    const formatted = formatDate(viewDate);
    summaryDate.value = formatted;

    if (summaryDate._flatpickr) {
        summaryDate._flatpickr.jumpToDate(viewDate);
    }

    updateSummaryUI();
}

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
    selfieData = canvas.toDataURL("image/png");

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

    if (dutyStatus === 'in') {
        const branch = document.getElementById("branchSelect").value || "N/A";
        existing.clockIn = { time, selfie: selfieData, branch };
        dutyStatus = 'out';
    } else {
        existing.clockOut = { time, selfie: selfieData };
        dutyStatus = 'in';
    }

    localStorage.setItem(key, JSON.stringify(existing));
    updateSummaryUI();
}

function clearData() {
    if (confirm("Are you sure you want to clear all local data?")) {
        localStorage.clear();
        location.reload();
    }
}
