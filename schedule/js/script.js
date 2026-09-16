// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc, setDoc, query, where, orderBy, limit, documentId, deleteDoc, addDoc, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Read-only mode detection
// Admin access requires explicit ?admin=true parameter — being in an iframe is not enough,
// because both the admin portal and the employee portal use iframes.
const isReadOnlyMode = () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('admin') === 'true') return false;
    return true;
};

const READ_ONLY_MODE = isReadOnlyMode();

// Function to hide admin controls in read-only mode
function hideAdminControls() {
    if (READ_ONLY_MODE) {
        // Add read-only class to body for CSS styling
        document.body.classList.add('read-only-mode');
        
        // Hide admin buttons
        const adminButtons = [
            'syncBtn',
            'deleteFutureBtn',
            'deleteSelectedBtn',
            'copySelectedBtn',
            'copyPrevWeekBtn'
        ];
        
        adminButtons.forEach(buttonId => {
            const button = document.getElementById(buttonId);
            if (button) {
                button.style.display = 'none';
            }
        });
        
        // Hide multi-select controls
        const multiSelectControls = document.getElementById('multiSelectControls');
        if (multiSelectControls) {
            multiSelectControls.style.display = 'none';
        }
        
        // Read-only mode is active - no visual indicator needed
    }
}

// Firebase configuration

const firebaseConfig = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.appspot.com",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266",
    measurementId: "G-YEK4GML6SJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Employee data - loaded from Firebase (id -> name)
let employees = {};
/** Pending substitution requests for current user (employeeId), used for badges and modal state */
let pendingSubstitutionRequests = [];
// Profile photo URLs (id -> photoUrl)
let employeePhotoUrls = {};
// Most recent clock-in selfie per employee (id -> photoUrl), used for scheduled shift avatars
let employeeLastTimeInPhotos = {};
let employeeLastTimeInPhotoDates = {};
// Employee IDs that are archived - excluded from schedule dropdown only (names still shown on existing shifts)
let archivedEmployeeIds = new Set();
// Inactive employees (active === false in Firestore) — same dropdown exclusion as archived
let inactiveEmployeeIds = new Set();
function employeeShownInShiftDropdown(employeeId) {
    return !archivedEmployeeIds.has(employeeId) && !inactiveEmployeeIds.has(employeeId);
}
function getEmployeeProfilePhotoUrl(employeeId) {
    if (!employeeId || employeeId === 'unassigned') return null;
    return employeePhotoUrls[employeeId] || null;
}
function getEmployeeLastTimeInPhotoUrl(employeeId) {
    if (!employeeId || employeeId === 'unassigned') return null;
    return employeeLastTimeInPhotos[employeeId] || null;
}
function rememberEmployeeTimeInPhoto(employeeId, dateStr, selfie) {
    if (!employeeId || employeeId === 'unassigned' || !selfie || !dateStr) return;
    const previousDate = employeeLastTimeInPhotoDates[employeeId] || '';
    if (dateStr > previousDate) {
        employeeLastTimeInPhotoDates[employeeId] = dateStr;
        employeeLastTimeInPhotos[employeeId] = selfie;
    }
}
async function loadLastTimeInPhotosFromCollection(collectionName, employeeId) {
    let latestDate = employeeLastTimeInPhotoDates[employeeId] || '';
    let latestSelfie = employeeLastTimeInPhotos[employeeId] || null;
    const attendanceRef = collection(db, collectionName, employeeId, "dates");

    const snapshot = await getDocs(query(
        attendanceRef,
        orderBy(documentId(), 'desc'),
        limit(40)
    ));
    snapshot.forEach((docSnap) => {
        const selfie = docSnap.data().clockIn?.selfie;
        if (selfie && docSnap.id > latestDate) {
            latestDate = docSnap.id;
            latestSelfie = selfie;
        }
    });

    if (latestSelfie) {
        employeeLastTimeInPhotoDates[employeeId] = latestDate;
        employeeLastTimeInPhotos[employeeId] = latestSelfie;
    }
}
async function loadEmployeeLastTimeInPhotos(employeeIds = null) {
    const ids = (employeeIds || Object.keys(employees)).filter(id => id && id !== 'unassigned');
    if (ids.length === 0) return;

    await Promise.all(ids.map(async (employeeId) => {
        if (employeeLastTimeInPhotos[employeeId]) return;
        try {
            await loadLastTimeInPhotosFromCollection('attendance_v2', employeeId);
            if (!employeeLastTimeInPhotos[employeeId]) {
                await loadLastTimeInPhotosFromCollection('attendance', employeeId);
            }
        } catch (error) {
            console.warn('Failed to load last time-in photo for', employeeId, error);
        }
    }));
}
function refreshEmployeeLastTimeInPhotosInBackground(employeeIds = null) {
    loadEmployeeLastTimeInPhotos(employeeIds)
        .then(() => renderCurrentView())
        .catch((error) => console.warn('Last time-in photo refresh failed:', error));
}
// Shift types configuration
const SHIFT_TYPES = {
    opening: { name: "Opening", start: "09:30", end: "18:30", display: "9:30 AM - 6:30 PM" },
    adjustedOpening: { name: "Adjusted Opening", start: "10:30", end: "19:30", display: "10:30 AM - 7:30 PM" },
    midshift: { name: "Midshift", start: "11:00", end: "20:00", display: "11:00 AM - 8:00 PM" },
    closing: { name: "Closing", start: "13:00", end: "22:00", display: "1:00 PM - 10:00 PM" },
    closingHalf: { name: "Closing Half-Day", start: "18:00", end: "22:00", display: "6:00 PM - 10:00 PM" },
    custom: { name: "Custom", start: null, end: null, display: "Custom Hours" }
};

// Function to check if time in is late and return severity level
function isLateTimeIn(shiftType, actualTimeIn) {
    if (!actualTimeIn || shiftType === 'custom') return false;
    
    const shiftSchedule = SHIFT_TYPES[shiftType];
    if (!shiftSchedule || !shiftSchedule.start) return false;
    
    // Convert scheduled start time to minutes
    const [scheduledHour, scheduledMinute] = shiftSchedule.start.split(':').map(Number);
    const scheduledMinutes = scheduledHour * 60 + scheduledMinute;
    
    // Convert actual time in to minutes
    let actualMinutes;
    if (actualTimeIn.includes('AM') || actualTimeIn.includes('PM')) {
        // Handle 12-hour format
        const time12Hour = actualTimeIn.replace(/\s*(AM|PM)/i, '');
        const [time, period] = actualTimeIn.split(/\s*(AM|PM)/i);
        const [hour, minute] = time.split(':').map(Number);
        
        let hour24 = hour;
        if (period.toUpperCase() === 'PM' && hour !== 12) {
            hour24 += 12;
        } else if (period.toUpperCase() === 'AM' && hour === 12) {
            hour24 = 0;
        }
        
        actualMinutes = hour24 * 60 + minute;
    } else {
        // Handle 24-hour format
        const [hour, minute] = actualTimeIn.split(':').map(Number);
        actualMinutes = hour * 60 + minute;
    }
    
    const minutesLate = actualMinutes - scheduledMinutes;
    
    // Return severity level: false = on time, 'orange' = 30+ mins late, 'red' = 1+ hour late
    if (minutesLate >= 60) return 'red';      // 1+ hour late
    if (minutesLate >= 30) return 'orange';   // 30+ minutes late
    return false;                             // On time
}

// Branch configuration - will be loaded from Firebase
// Generic keys are seeded here so legacy shifts (branch='popup' etc.) are always matched
let BRANCHES = {
    podium: "Podium",
    smnorth: "SM North",
    popup: "Pop-up",
    workshop: "Workshop",
    other: "Other"
};

let allBranches = []; // Will be loaded from Firebase

// Global state
let currentWeekStart = new Date();
let scheduleData = {}; // Future planned shifts only
let attendanceData = {}; // Actual time in/out records only
let currentView = 'shift';
let selectedEmployee = '';
let localChanges = false;
let isDeletingShifts = false;
let currentMobileDay = new Date(); // For mobile daily view
let currentMobileMode = 'branch'; // 'branch' or 'mySchedule'
let currentMobileBranchKey = 'podium';
let currentMobileEmployeeId = null;
let mobileCalExpanded = false;

// DOM elements
const prevWeekBtn = document.getElementById('prevWeekBtn');
const nextWeekBtn = document.getElementById('nextWeekBtn');
const weekTitle = document.getElementById('weekTitle');
const branchFilter = document.getElementById('branchFilter');
const calendarViewRadio = document.getElementById('calendarView');
const employeeViewRadio = document.getElementById('employeeView');
const shiftViewRadio = document.getElementById('shiftView');
const calendarViewContainer = document.getElementById('calendarViewContainer');
const employeeViewContainer = document.getElementById('employeeViewContainer');
const shiftViewContainer = document.getElementById('shiftViewContainer');
const shiftScheduleGrid = document.getElementById('shiftScheduleGrid');
const scheduleGrid = document.getElementById('scheduleGrid');
const employeeSchedule = document.getElementById('employeeSchedule');
const syncBtn = document.getElementById('syncBtn');
const syncStatus = document.getElementById('syncStatus');

// Mobile DOM element (resolved after DOM ready via initMobileView)
const mobileDailyView = document.getElementById('mobileDailyView');
let mobileWeekStrip, mobileScheduleContent, mobileBranchSelect, mobileEmployeeSelect, mobileEmployeeSelectLabel, mobileMonthTitle, mobileCalChevron, mobileFullCalendar, mobileCalGrid;

// Modal elements
const shiftModal = document.getElementById('shiftModal');
const closeShiftModal = document.getElementById('closeShiftModal');
const shiftForm = document.getElementById('shiftForm');
const modalTitle = document.getElementById('modalTitle');// Add this with the other DOM elements around line 75
const shiftDate = document.getElementById('shiftDate');
const shiftBranch = document.getElementById('shiftBranch');
const shiftEvent = document.getElementById('shiftEvent');
const eventFields = document.getElementById('eventFields');
const LOCATION_EVENT_SENTINEL = '__event__';
const EVENT_ADD_SENTINEL = '__add_event__';
const STATIC_LOCATION_KEYS = new Set(['podium', 'smnorth', 'other']);
const shiftType = document.getElementById('shiftType');
const customTimeGroup = document.getElementById('customTimeGroup');
const customStartTime = document.getElementById('customStartTime');
const customEndTime = document.getElementById('customEndTime');
const shiftEmployee = document.getElementById('shiftEmployee');
const shiftRole = document.getElementById('shiftRole');
const customRoleGroup = document.getElementById('customRoleGroup');
const shiftRoleCustom = document.getElementById('shiftRoleCustom');
const shiftId = document.getElementById('shiftId');
const originalDate = document.getElementById('originalDate');
const originalBranch = document.getElementById('originalBranch');
const cancelShiftBtn = document.getElementById('cancelShiftBtn');
const deleteShiftBtn = document.getElementById('deleteShiftBtn');

// Recurring choice modal elements
const recurringChoiceModal = document.getElementById('recurringChoiceModal');
const recurringChoiceTitle = document.getElementById('recurringChoiceTitle');
const recurringChoiceMessage = document.getElementById('recurringChoiceMessage');
const thisDateOnlyBtn = document.getElementById('thisDateOnlyBtn');
const thisAndFutureBtn = document.getElementById('thisAndFutureBtn');
const cancelRecurringBtn = document.getElementById('cancelRecurringBtn');

// Shift details modal (My Schedule card tap)
const shiftDetailsModal = document.getElementById('shiftDetailsModal');
const closeShiftDetailsModalBtn = document.getElementById('closeShiftDetailsModal');
/** Set when opening shift details for a scheduled shift; used by Submit request handler */
let currentShiftDetailsForRequest = null;

document.addEventListener('DOMContentLoaded', async function () {
    hideAdminControls(); // Hide admin controls in read-only mode
    initSchedulingApp();
    setupEventListeners();
    setCurrentWeek();
    await loadBranchesFromFirebase(); // Load branches first
    await loadAllEmployees(); // Load employees
    loadEmployeeNicknames();
    updateAttendanceModeIndicator(); // Initialize attendance mode indicator
    loadScheduleData();
    initMobileView(); // Initialize new mobile view
});

function initSchedulingApp() {
    loadBranchesFromFirebase(); // Add this line
}

function setupEventListeners() {
    // Week navigation
    prevWeekBtn.addEventListener('click', () => changeWeek(-1));
    nextWeekBtn.addEventListener('click', () => changeWeek(1));
    
    // View toggle
    calendarViewRadio.addEventListener('change', () => toggleView('calendar'));
    employeeViewRadio.addEventListener('change', () => toggleView('employee'));
    shiftViewRadio.addEventListener('change', () => toggleView('shift'));

    // Branch filter
    branchFilter.addEventListener('change', renderCurrentView);

    
    // Sync button
    syncBtn.addEventListener('click', forceSyncToFirebase);

    // Modal events
    closeShiftModal.addEventListener('click', closeModal);
    cancelShiftBtn.addEventListener('click', closeModal);
    shiftModal.addEventListener('click', (e) => {
        if (e.target === shiftModal) closeModal();
    });

    // Branch modal events
    const addBranchModal = document.getElementById('addBranchModal');
    const closeBranchModalBtn = document.getElementById('closeBranchModal');
    const cancelBranchBtn = document.getElementById('cancelBranchBtn');
    const branchForm = document.getElementById('branchForm');

    closeBranchModalBtn.addEventListener('click', closeBranchModal);
    cancelBranchBtn.addEventListener('click', closeBranchModal);
    addBranchModal.addEventListener('click', (e) => {
        if (e.target === addBranchModal) closeBranchModal();
    });

    branchForm.addEventListener('submit', handleBranchSubmit);
    const branchTypeSelect = document.getElementById('branchType');
    if (branchTypeSelect) {
        branchTypeSelect.addEventListener('change', () => {
            if (branchTypeSelect.value) renderBranchList(branchTypeSelect.value);
        });
    }

    if (closeShiftDetailsModalBtn) closeShiftDetailsModalBtn.addEventListener('click', closeShiftDetailsModal);
    if (shiftDetailsModal) shiftDetailsModal.addEventListener('click', (e) => { if (e.target === shiftDetailsModal) closeShiftDetailsModal(); });
    const reqRelieverBtn = document.getElementById('shiftDetailsRequestSubstitutionBtn');
    if (reqRelieverBtn) reqRelieverBtn.addEventListener('click', onRequestRelieverClick);
    const relieverSelect = document.getElementById('shiftDetailsRelieverSelect');
    const submitRequestBtn = document.getElementById('shiftDetailsSubmitRequestBtn');
    if (relieverSelect && submitRequestBtn) {
        relieverSelect.addEventListener('change', () => { submitRequestBtn.disabled = !relieverSelect.value; });
        submitRequestBtn.addEventListener('click', submitSubstitutionRequest);
    }

    // Location / Event dropdown handlers
    shiftBranch.addEventListener('change', handleBranchDropdownChange);
    if (shiftEvent) {
        shiftEvent.addEventListener('change', handleEventDropdownChange);
    }

    function closeBranchModal() {
        addBranchModal.style.display = 'none';
        branchForm.reset();
        const branchTypeEl = document.getElementById('branchType');
        const branchKeyEl = document.getElementById('branchKey');
        if (branchTypeEl) branchTypeEl.disabled = false;
        if (branchKeyEl) branchKeyEl.value = '';
        document.getElementById('branchModalTitle').textContent = 'Add New Event';
        const submitBtn = document.getElementById('branchSubmitBtn');
        if (submitBtn) submitBtn.textContent = 'Add Event';
    }

    function handleBranchDropdownChange() {
        syncEventFieldsVisibility();
    }

    function handleEventDropdownChange(e) {
        const value = e.target.value;
        if (value === EVENT_ADD_SENTINEL) {
            e.target.value = '';
            openBranchModal('popup');
        }
    }

    function escapeHtml(s) {
        if (s == null) return '';
        const t = String(s);
        return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function renderBranchList(type) {
        const section = document.getElementById('branchListSection');
        const listEl = document.getElementById('branchList');
        const titleEl = document.getElementById('branchListTitle');
        if (!section || !listEl || !titleEl) return;
        const typeLabel = type === 'popup' ? 'Pop-ups' : 'Workshops';
        titleEl.textContent = `Existing ${typeLabel}`;
        const branches = allBranches.filter(b => b.type === type).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        listEl.innerHTML = '';
        if (branches.length === 0) {
            listEl.innerHTML = '<li class="branch-list-empty">No locations yet.</li>';
            return;
        }
        branches.forEach(branch => {
            const li = document.createElement('li');
            li.className = 'branch-list-item';
            li.innerHTML = `
                <span class="branch-list-name">${escapeHtml(branch.name)}</span>
                <span class="branch-list-actions">
                    <button type="button" class="branch-archive-btn" data-branch-id="${escapeHtml(branch.id)}" title="Archive (hide from lists)">Archive</button>
                    <button type="button" class="branch-delete-btn" data-branch-id="${escapeHtml(branch.id)}" data-branch-name="${escapeHtml(branch.name)}" title="Permanently delete">Delete</button>
                </span>
            `;
            listEl.appendChild(li);
        });
        listEl.querySelectorAll('.branch-archive-btn').forEach(btn => {
            btn.addEventListener('click', () => handleArchiveBranch(btn.getAttribute('data-branch-id')));
        });
        listEl.querySelectorAll('.branch-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => handleDeleteBranch(btn.getAttribute('data-branch-id'), btn.getAttribute('data-branch-name')));
        });
    }

    async function handleArchiveBranch(branchId) {
        if (!branchId) return;
        try {
            updateSyncStatus('syncing');
            const docRef = doc(db, 'branches', branchId);
            await updateDoc(docRef, { archived: true, archivedAt: new Date().toISOString() });
            await loadBranchesFromFirebase();
            renderBranchList(document.getElementById('branchType').value);
            updateSyncStatus('synced');
        } catch (err) {
            updateSyncStatus('local');
            alert('Failed to archive location.');
        }
    }

    async function handleDeleteBranch(branchId, branchName) {
        if (!branchId) return;
        if (!confirm(`Permanently delete "${branchName || 'this location'}"? This cannot be undone.`)) return;
        try {
            updateSyncStatus('syncing');
            const docRef = doc(db, 'branches', branchId);
            await deleteDoc(docRef);
            await loadBranchesFromFirebase();
            renderBranchList(document.getElementById('branchType').value);
            updateSyncStatus('synced');
        } catch (err) {
            updateSyncStatus('local');
            alert('Failed to delete location.');
        }
    }

    function openBranchModal(type) {
        document.getElementById('branchModalTitle').textContent = `Add New ${type === 'workshop' ? 'Workshop' : 'Pop-up'}`;
        const branchTypeEl = document.getElementById('branchType');
        branchTypeEl.value = type;
        branchTypeEl.disabled = false;
        document.getElementById('branchKey').value = '';
        const submitBtn = document.getElementById('branchSubmitBtn');
        if (submitBtn) submitBtn.textContent = 'Add Event';
        renderBranchList(type);
        const section = document.getElementById('branchListSection');
        if (section) section.style.display = 'block';
        addBranchModal.style.display = 'flex';
        document.getElementById('branchName').focus();
    }

    async function handleBranchSubmit(e) {
        e.preventDefault();

        const branchName = document.getElementById('branchName').value.trim();
        const branchType = document.getElementById('branchType').value;

        if (!branchName || !branchType) return;

        // Create unique key
        const branchKey = `${branchType}-${branchName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

        // Check if already exists
        if (BRANCHES[branchKey]) {
            alert('Event already exists');
            return;
        }

        try {
            updateSyncStatus('syncing');

            const branchData = {
                key: branchKey,
                name: branchName,
                type: branchType,
                createdAt: new Date().toISOString(),
                createdBy: 'scheduling-app',
                status: 'active'
            };

            const newBranch = await saveBranchToFirebase(branchData);
            allBranches.push(newBranch);
            BRANCHES[branchKey] = branchName;

            localStorage.setItem('branches-cache', JSON.stringify(allBranches));
            updateBranchDropdowns();

            // Select Event location + new event
            if (shiftBranch) shiftBranch.value = LOCATION_EVENT_SENTINEL;
            syncEventFieldsVisibility();
            if (shiftEvent) shiftEvent.value = branchKey;

            closeBranchModal();
            updateSyncStatus('synced');

        } catch (error) {

            updateSyncStatus('local');
            alert('Failed to create event');
        }
    }

    // Form events
    shiftForm.addEventListener('submit', handleShiftSubmit);
    shiftType.addEventListener('change', handleShiftTypeChange);
    shiftDate.addEventListener('change', () => {
        if (shiftModal.style.display === 'flex') {
            populateEmployeeDropdownForDate(shiftDate.value);
        }
    });
    if (shiftRole) shiftRole.addEventListener('change', handleShiftRoleChange);
    deleteShiftBtn.addEventListener('click', handleShiftDelete);

    // Multi-select events  
    document.getElementById('deleteSelectedBtn').addEventListener('click', deleteSelectedShifts);
    document.getElementById('exitSelectionBtn').addEventListener('click', exitMultiSelectMode);
    document.getElementById('copySelectedBtn').addEventListener('click', copySelectedShiftsToNextDay);

    const copyPrevWeekBtn = document.getElementById('copyPrevWeekBtn');
    if (copyPrevWeekBtn) {
        copyPrevWeekBtn.addEventListener('click', copyFromPreviousWeek);
    }

    const multiSelectControls = document.getElementById('multiSelectControls');

    // Sync button
    syncBtn.addEventListener('click', forceSyncToFirebase);

    // Delete all data button
    document.getElementById('deleteFutureBtn').addEventListener('click', deleteAllData);

}

let currentPastDaysMode = 'auto'; // New auto mode


let actualAttendanceCache = {};
let loadingDates = new Set(); // Track which dates are currently being loaded

// Separate attendance data loading functions
async function loadAttendanceDataFromFirebase(employeeId, dateStr) {
    try {
        const docRef = doc(db, "attendance_v2", employeeId, "dates", dateStr);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                employeeId: employeeId,
                date: dateStr,
                timeIn: data.clockIn?.time || null,
                timeOut: data.clockOut?.time || null,
                branch: data.clockIn?.branch || 'Unknown',
                shift: data.clockIn?.shift || 'Custom',
                timeInPhoto: data.clockIn?.selfie || null,
                timeOutPhoto: data.clockOut?.selfie || null,
                isActual: true
            };
        }
    } catch (error) {

    }
    
    return null;
}

function storeAttendanceDataLocally(attendanceRecord) {
    if (!attendanceRecord) return;
    
    
    // Fix: Extract date from the record ID if date is missing
    let recordDate = attendanceRecord.date;
    if (!recordDate && attendanceRecord.id && attendanceRecord.id.includes('_')) {
        const idParts = attendanceRecord.id.split('_');
        if (idParts.length >= 3) {
            recordDate = idParts[2]; // Extract date from ID like "actual_131729_2025-09-08"
        }
    }
    
    if (!recordDate) {

        return;
    }
    
    const weekKey = getWeekKeyForDate(new Date(recordDate + 'T00:00:00'));
    
    if (!attendanceData[weekKey]) {
        attendanceData[weekKey] = {};
    }
    if (!attendanceData[weekKey][recordDate]) {
        attendanceData[weekKey][recordDate] = [];
    }
    
    // Remove existing record for this employee/date
    attendanceData[weekKey][recordDate] = attendanceData[weekKey][recordDate]
        .filter(record => record.employeeId !== attendanceRecord.employeeId);
    
    // Add new record with corrected date
    const correctedRecord = { ...attendanceRecord, date: recordDate };
    attendanceData[weekKey][recordDate].push(correctedRecord);
    
}

async function preloadActualAttendanceForWeek() {
    if (currentPastDaysMode !== 'actual') {
        return;
    }

    try {
        const weekDates = getWeekDates();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Only load for past dates
        const pastDates = weekDates.filter(date => date < today).map(formatDate);

        if (pastDates.length === 0) {
            return;
        }

        // Get all employee IDs
        const employeeIds = Object.keys(employees);

        // Clear existing cache
        actualAttendanceCache = {};

        // Load all attendance data for the week in parallel
        const attendancePromises = employeeIds.map(async (employeeId) => {

            try {
                const attendanceRef = collection(db, "attendance_v2", employeeId, "dates");
                const snapshot = await getDocs(query(
                    attendanceRef,
                    where("__name__", ">=", pastDates[0]),
                    where("__name__", "<=", pastDates[pastDates.length - 1])
                ));


                let employeeAttendanceCount = 0;

                snapshot.forEach(doc => {
                    const dateStr = doc.id;
                    const docData = doc.data();


                    if (docData.clockIn?.time) {  // Only require clock-in, not clock-out
                        if (!actualAttendanceCache[dateStr]) {
                            actualAttendanceCache[dateStr] = {};
                        }

                        actualAttendanceCache[dateStr][employeeId] = {
                            timeIn: docData.clockIn?.time || null,
                            timeOut: docData.clockOut?.time || null,
                            branch: docData.clockIn?.branch || 'Unknown',
                            shift: docData.clockIn?.shift || 'Custom'
                        };

                        employeeAttendanceCount++;
                    }
                });


            } catch (error) {
            }
        });

        await Promise.all(attendancePromises);

        

    } catch (error) {
    }
}

function getActualAttendanceForDate(dateStr) {
    return actualAttendanceCache[dateStr] || {};
}

// New function to determine what data to show for a specific date
function getDataForDate(dateStr, branchKey, shiftType) {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const isPastDate = date < today;
    const isToday = date.getTime() === today.getTime();
    
    
    // Always use auto mode - show actual attendance for past dates, scheduled for today and future
    if (isPastDate) {
        // Role-based rows (Deliveries, Custom) only apply to scheduled shifts; past has no role data
        if (shiftType === 'deliveries' || shiftType === 'custom') {
            return { type: 'actual', data: [], loading: false };
        }

        // Check if we have actual attendance data
        const actualData = getActualAttendanceForDate(dateStr);
        const hasActualData = Object.keys(actualData).length > 0;
        
        if (hasActualData) {
            
            // For actual attendance, we need to convert it to shift format
            // Show all employees who worked on this day and branch, regardless of shift type
            const actualShifts = Object.entries(actualData)
                .filter(([employeeId, attendance]) => {
                    const matchesBranch = attendanceBelongsToSection(attendance.branch, branchKey);
                    const shiftCategory = categorizeShiftByTime(attendance.shift, attendance.timeIn);
                    const matchesShiftType = shiftCategory === shiftType;
                    return matchesBranch && matchesShiftType;
                })
                .map(([employeeId, attendance]) => {
                    
                    const customStart = attendance.timeIn ? removeSecondsFromTime(attendance.timeIn) : null;
                    const customEnd = attendance.timeOut ? removeSecondsFromTime(attendance.timeOut) : null;
                    
                    
                    return {
                        id: `actual_${employeeId}_${dateStr}`,
                        employeeId: employeeId,
                        branch: branchKey,
                        type: categorizeShiftByTime(attendance.shift, attendance.timeIn),
                        customStart: customStart,
                        customEnd: customEnd,
                        timeInPhoto: attendance.timeInPhoto,
                        timeOutPhoto: attendance.timeOutPhoto,
                        isActual: true
                    };
                });
            
            // Store attendance data in separate attendanceData structure
            actualShifts.forEach(shift => {
                storeAttendanceDataLocally(shift);
            });

            // Sort actual shifts by time in (earliest first)
            // Note: For past dates, all shifts are actual attendance, so just sort by time
            const sortedActualShifts = actualShifts.sort((a, b) => {
                const timeA = a.customStart || a.timeIn || '00:00';
                const timeB = b.customStart || b.timeIn || '00:00';
                
                // Convert to 24-hour format for comparison
                const minutesA = timeToMinutes(timeA);
                const minutesB = timeToMinutes(timeB);
                
                const diff = minutesA - minutesB;
                if (diff !== 0) return diff;

                // Tie-breaker: createdAt (older first), then employeeId
                const createdA = getCreatedAtTimestamp(a);
                const createdB = getCreatedAtTimestamp(b);
                if (createdA !== createdB) return createdA - createdB;

                return (a.employeeId || '').localeCompare(b.employeeId || '');
            });

            return {
                type: 'actual',
                data: sortedActualShifts,
                loading: false
            };
        } else {
            // No actual data for past date
            // Check if it's already loading
            if (loadingDates.has(dateStr)) {
                return {
                    type: 'actual',
                    data: [],
                    loading: true // Indicate that data is loading
                };
            }

            // If not loading, start loading in background
            if (isPastDate) {
                loadActualAttendanceForDate(dateStr);
            }
            return {
                type: 'actual',
                data: [],
                loading: true // Indicate that data is now loading
            };
        }
    } else if (isToday) {
        // Today's date - show scheduled shifts, but also load attendance data
        const allShiftsForDay = getAllShiftsForDay(dateStr);

        // Role-based rows: show only shifts with that role (scheduled only; no role on actual)
        if (shiftType === 'deliveries') {
            const byRole = allShiftsForDay.filter(shift => shiftBelongsToSection(shift.branch, branchKey) && shift.role === 'deliveries');
            return { type: 'scheduled', data: byRole, loading: false };
        }
        if (shiftType === 'custom') {
            const byRole = allShiftsForDay.filter(shift => shiftBelongsToSection(shift.branch, branchKey) && shift.role === 'custom');
            return { type: 'scheduled', data: byRole, loading: false };
        }

        const scheduledShifts = allShiftsForDay.filter(shift => {
            const shiftStartTime = getShiftStartTime(shift);
            const categorizedType = categorizeShiftByTime(shift.type, shiftStartTime);
            const matchesBranch = shiftBelongsToSection(shift.branch, branchKey);
            const matchesType = categorizedType === shiftType;
            const isBarista = !shift.role || shift.role === 'barista';
            return matchesBranch && matchesType && isBarista;
        });
        
        // Check if we have actual attendance data for today
        const actualData = getActualAttendanceForDate(dateStr);
        const hasActualData = Object.keys(actualData).length > 0;
        
        if (hasActualData) {
            // Get actual attendance for this branch/shift combination
            const actualShifts = Object.entries(actualData)
                .filter(([employeeId, attendance]) => {
                    const matchesBranch = attendanceBelongsToSection(attendance.branch, branchKey);
                    const shiftCategory = categorizeShiftByTime(attendance.shift, attendance.timeIn);
                    const matchesShiftType = shiftCategory === shiftType;
                    return matchesBranch && matchesShiftType;
                })
                .map(([employeeId, attendance]) => ({
                    id: `actual_${employeeId}_${dateStr}`,
                    employeeId: employeeId,
                    branch: branchKey,
                    type: categorizeShiftByTime(attendance.shift, attendance.timeIn),
                    customStart: attendance.timeIn ? removeSecondsFromTime(attendance.timeIn) : null,
                    customEnd: attendance.timeOut ? removeSecondsFromTime(attendance.timeOut) : null,
                    timeInPhoto: attendance.timeInPhoto,
                    timeOutPhoto: attendance.timeOutPhoto,
                    isActual: true
                }));
            
            // Store attendance data in separate attendanceData structure
            actualShifts.forEach(shift => {
                storeAttendanceDataLocally(shift);
            });
            
            // Filter out scheduled shifts for employees who have actual attendance
            const employeesWithActualAttendance = new Set(actualShifts.map(shift => shift.employeeId));
            const remainingScheduledShifts = scheduledShifts.filter(shift => 
                !employeesWithActualAttendance.has(shift.employeeId)
            );
            
            // Combine actual attendance with remaining scheduled shifts
            const combinedShifts = [...actualShifts, ...remainingScheduledShifts];
            
            // Sort combined shifts: actual attendance first, then scheduled shifts
            // Within each group, sort by time in (earliest first)
            const sortedCombinedShifts = combinedShifts.sort((a, b) => {
                // First priority: actual attendance comes before scheduled
                if (a.isActual && !b.isActual) return -1;
                if (!a.isActual && b.isActual) return 1;
                
                // Second priority: within same type, sort by time in (earliest first)
                const timeA = a.customStart || a.timeIn || '00:00';
                const timeB = b.customStart || b.timeIn || '00:00';
                
                // Convert to 24-hour format for comparison
                const minutesA = timeToMinutes(timeA);
                const minutesB = timeToMinutes(timeB);
                
                const diff = minutesA - minutesB;
                if (diff !== 0) return diff;

                // Tie-breaker: createdAt (older first), then employeeId
                const createdA = getCreatedAtTimestamp(a);
                const createdB = getCreatedAtTimestamp(b);
                if (createdA !== createdB) return createdA - createdB;

                return (a.employeeId || '').localeCompare(b.employeeId || '');
            });
            
            return {
                type: 'mixed',
                data: sortedCombinedShifts,
                loading: false
            };
        } else {
            // No actual data yet - check if we need to load it
            const hasBeenChecked = actualAttendanceCache.hasOwnProperty(dateStr);
            const isCurrentlyLoading = loadingDates.has(dateStr);
            
            if (!hasBeenChecked && !isCurrentlyLoading) {
                // Start loading attendance data for today
                loadActualAttendanceForDate(dateStr);
            }
            
            return {
                type: 'scheduled',
                data: scheduledShifts,
                loading: !hasBeenChecked && !isCurrentlyLoading
            };
        }
    } else {
        // Future date - always show scheduled
        const allShiftsForDay = getAllShiftsForDay(dateStr);

        if (shiftType === 'deliveries') {
            const byRole = allShiftsForDay.filter(shift => shiftBelongsToSection(shift.branch, branchKey) && shift.role === 'deliveries');
            return { type: 'scheduled', data: byRole, loading: false };
        }
        if (shiftType === 'custom') {
            const byRole = allShiftsForDay.filter(shift => shiftBelongsToSection(shift.branch, branchKey) && shift.role === 'custom');
            return { type: 'scheduled', data: byRole, loading: false };
        }

        const scheduledShifts = allShiftsForDay.filter(shift => {
            const shiftStartTime = getShiftStartTime(shift);
            const categorizedType = categorizeShiftByTime(shift.type, shiftStartTime);
            const matchesBranch = shiftBelongsToSection(shift.branch, branchKey);
            const matchesType = categorizedType === shiftType;
            const isBarista = !shift.role || shift.role === 'barista';
            return matchesBranch && matchesType && isBarista;
        });
        return {
            type: 'scheduled',
            data: scheduledShifts,
            loading: false
        };
    }
}

// Function to load actual attendance for a specific date
async function loadActualAttendanceForDate(dateStr) {
    if (loadingDates.has(dateStr)) {
        return;
    }
    loadingDates.add(dateStr); // Mark as loading
    
    try {
        const date = new Date(dateStr + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Only load for past dates and today (not future dates)
        if (date > today) {
            return;
        }
        
        // Get all employee IDs
        const employeeIds = Object.keys(employees);
        const docPromises = employeeIds.map(employeeId => {
            const docRef = doc(db, "attendance_v2", employeeId, "dates", dateStr);
            return getDoc(docRef).then(docSnap => ({ employeeId, docSnap }));
        });
        
        const results = await Promise.all(docPromises);
        
        // Filter to only employees who have attendance records
        const employeesWithData = results.filter(({ docSnap }) => 
            docSnap.exists() && docSnap.data().clockIn?.time
        );
        
        if (employeesWithData.length === 0) {
            // Mark this date as checked in cache (even if empty) so we don't try to load it again
            actualAttendanceCache[dateStr] = {};
            // Update cells to remove loading spinners
            updateCellsForDate(dateStr);
            
            // Also update mobile view if it's showing this date
            if (mobileDailyView && formatDate(currentMobileDay) === dateStr) {
                renderMobileView();
            }
            return;
        }
        
        // Load full attendance data only for employees who have records
        for (const { employeeId, docSnap } of employeesWithData) {
            try {
                const docData = docSnap.data();
                if (!actualAttendanceCache[dateStr]) {
                    actualAttendanceCache[dateStr] = {};
                }
                
                const attendanceData = {
                    timeIn: docData.clockIn?.time || null,
                    timeOut: docData.clockOut?.time || null,
                    branch: docData.clockIn?.branch || 'Unknown',
                    shift: docData.clockIn?.shift || 'Custom',
                    timeInPhoto: docData.clockIn?.selfie || null,
                    timeOutPhoto: docData.clockOut?.selfie || null
                };
                
                actualAttendanceCache[dateStr][employeeId] = attendanceData;
                rememberEmployeeTimeInPhoto(employeeId, dateStr, attendanceData.timeInPhoto);
                
            } catch (error) {
            }
        }
        
        // Update the view to show the newly loaded data and remove loading spinners
        updateCellsForDate(dateStr);
        
        // Also update mobile view if it's showing this date
        if (mobileDailyView && formatDate(currentMobileDay) === dateStr) {
            renderMobileView();
        }
        
    } catch (error) {
    } finally {
        // Remove this date from the loading set
        loadingDates.delete(dateStr);
    }
}

// Function to update only the cells for a specific date after attendance data loads
function updateCellsForDate(dateStr) {
    // Find all cells for this date
    const cellsForDate = document.querySelectorAll(`[data-date="${dateStr}"]`);
    
    cellsForDate.forEach(cell => {
        const branchKey = cell.getAttribute('data-branch');
        const shiftType = cell.getAttribute('data-shift-type');
        
        if (!branchKey || !shiftType) {
            return; // Skip cells without proper attributes
        }
        
        // Remove any existing loading spinners
        const existingSpinner = cell.querySelector('.loading-spinner');
        if (existingSpinner) {
            existingSpinner.remove();
        }
        
        // Get the data for this cell
        const dataInfo = getDataForDate(dateStr, branchKey, shiftType);
        const shiftsForCell = dataInfo.data;
        
        // Clear the cell content
        cell.innerHTML = '';
        
        if (shiftsForCell.length > 0) {
            // Add the shift blocks
            shiftsForCell.forEach(shift => {
                const conflict = !shift.isActual && hasConflict(shift, dateStr);
                const isPastDate = new Date(dateStr + 'T00:00:00') < new Date();
                const completedClass = (shift.isActual && isPastDate) ? 'completed' : '';
                
                const shiftBlock = document.createElement('div');
                shiftBlock.className = `shift-employee-block ${shift.type} ${conflict ? 'shift-conflict' : ''} ${completedClass} ${shift.employeeId === 'unassigned' ? 'unassigned' : ''} ${selectedShifts.has(shift.id) ? 'selected' : ''}`;
                shiftBlock.setAttribute('data-shift-id', shift.id);
                
                // Create layout based on whether it's a completed block
                if (completedClass) {
                    // New layout: photo on left, details on right
                    // For attendance records, use attendance-specific time formatting
                    
                    const timeInDisplay = shift.customStart ? 
                        formatAttendanceTime(shift.customStart, shift.type, false) : 'N/A';
                    const timeOutDisplay = shift.customEnd ? 
                        formatAttendanceTime(shift.customEnd, shift.type, true) : '';
                        
                    
                    // Format time out with dash prefix
                    const timeOutWithDash = timeOutDisplay ? `- ${timeOutDisplay}` : '- ';
                    
                    // Check if time in is late and get severity
                    const lateStatus = isLateTimeIn(shift.type, timeInDisplay);
                    const timeInClass = lateStatus === 'red' ? 'late-red' : lateStatus === 'orange' ? 'late-orange' : '';
                    
                    // Always show photo layout for completed shifts, with placeholder if no photo
                    const photoSrc = shift.timeInPhoto || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iMjAiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iI0NDQ0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yMCAxMkMxNi42ODYzIDEyIDE0IDE0LjY4NjMgMTQgMThDMTQgMjEuMzEzNyAxNi42ODYzIDI0IDIwIDI0QzIzLjMxMzcgMjQgMjYgMjEuMzEzNyAyNiAxOEMyNiAxNC42ODYzIDIzLjMxMzcgMTIgMjAgMTJaIiBmaWxsPSIjQ0NDQ0NDIi8+CjxwYXRoIGQ9Ik0xMCAzNkMxMCAzMS41ODE3IDEzLjU4MTcgMjggMTggMjhIMjJDMjYuNDE4MyAyOCAzMCAzMS41ODE3IDMwIDM2VjM4SDEwVjM2WiIgZmlsbD0iI0NDQ0NDQyIvPgo8L3N2Zz4K';
                    
                    shiftBlock.innerHTML = `
                        <img src="${photoSrc}" class="shift-employee-photo" alt="Time In Photo" />
                        <div class="shift-details-container">
                            <div class="shift-employee">${shift.employeeId === 'unassigned' ? 'UNASSIGNED' : (employeeNicknames[shift.employeeId] || employees[shift.employeeId]?.split(' ')[0] || employees[shift.employeeId])}</div>
                            <div class="shift-time ${timeInClass}">${timeInDisplay}</div>
                            <div class="shift-time">${timeOutWithDash}</div>
                        </div>
                    `;
                } else {
                    // Scheduled shifts: last clock-in selfie or placeholder
                    const whitePlaceholderPhoto = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iMjAiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iI0NDQ0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yMCAxMkMxNi42ODYzIDEyIDE0IDE0LjY4NjMgMTQgMThDMTQgMjEuMzEzNyAxNi42ODYzIDI0IDIwIDI0QzIzLjMxMzcgMjQgMjYgMjEuMzEzNyAyNiAxOEMyNiAxNC42ODYzIDIzLjMxMzcgMTIgMjAgMTJaIiBmaWxsPSIjRkZGRkZGIi8+CjxwYXRoIGQ9Ik0xMCAzNkMxMCAzMS41ODE3IDEzLjU4MTcgMjggMTggMjhIMjJDMjYuNDE4MyAyOCAzMCAzMS41ODE3IDMwIDM2VjM4SDEwVjM2WiIgZmlsbD0iI0ZGRkZGRiIvPgo8L3N2Zz4K';
                    const scheduledPhotoSrc = shift.isActual
                        ? (shift.timeInPhoto || whitePlaceholderPhoto)
                        : (getEmployeeLastTimeInPhotoUrl(shift.employeeId) || whitePlaceholderPhoto);
                    const timeDisplay = getShiftTimeDisplayForScheduled(shift);
                    shiftBlock.innerHTML = `
                        <img src="${scheduledPhotoSrc}" class="shift-employee-photo" alt="Last Time In Photo" />
                        <div class="shift-details-container">
                            <div class="shift-employee">${shift.employeeId === 'unassigned' ? 'UNASSIGNED' : (employeeNicknames[shift.employeeId] || employees[shift.employeeId]?.split(' ')[0] || employees[shift.employeeId])}</div>
                            <div class="shift-time">${timeDisplay.startTime}</div>
                            <div class="shift-time">- ${timeDisplay.endTime}</div>
                        </div>
                    `;
                }
                
                // Add event listener
                shiftBlock.addEventListener('mousedown', handleShiftClick);
                
                cell.appendChild(shiftBlock);
            });
        } else {
            // No data - add the add button only for future dates
            // Plus button removed
        }
    });
}

// Multi-select state
let multiSelectMode = false;
let selectedShifts = new Set();
let employeeHighlightTimer = null;
let employeeHighlightEmployeeId = null;
let isSelecting = false;
let selectionStarted = false;

function startSelection(e, shiftId) {
    if (e.button !== 0) return; // Only left mouse button

    isSelecting = true;
    selectionStarted = false;

    const startTime = Date.now();
    const startX = e.clientX;
    const startY = e.clientY;

    const holdTimer = setTimeout(() => {
        // Check if mouse hasn't moved much (within 5px)
        const deltaX = Math.abs(e.clientX - startX);
        const deltaY = Math.abs(e.clientY - startY);

        if (deltaX < 5 && deltaY < 5 && isSelecting) {
            enterMultiSelectMode();
            toggleShiftSelection(shiftId);
            selectionStarted = true;
        }
    }, 500); // 500ms hold

    function onMouseMove(moveE) {
        const deltaX = Math.abs(moveE.clientX - startX);
        const deltaY = Math.abs(moveE.clientY - startY);

        if (deltaX > 5 || deltaY > 5) {
            clearTimeout(holdTimer);
            cleanup();
        }
    }

    function onMouseUp() {
        clearTimeout(holdTimer);

        if (!selectionStarted) {
            // Normal click - check if it's attendance data
            const shift = findAnyShiftById(shiftId);
            
            // Add detailed time data comparison logs
            if (shift && shift.isActual) {
                
                // Show what the card would display
                const cardTimeInDisplay = shift.customStart ? smartFormatTime(shift.customStart, shift.type, false) : 'N/A';
                const cardTimeOutDisplay = shift.customEnd ? smartFormatTime(shift.customEnd, shift.type, true) : '';
                
            }
            
            // Check if this is a past date
            let shiftDateStr = null;
            if (shift && shift.date) {
                shiftDateStr = shift.date;
            } else if (shiftId && shiftId.includes('_')) {
                // Extract date from shift ID (format: actual_131729_2025-09-08)
                const parts = shiftId.split('_');
                if (parts.length >= 3) {
                    shiftDateStr = parts[parts.length - 1]; // Last part should be the date
                }
            }
            
            if (shiftDateStr) {
                const shiftDate = new Date(shiftDateStr + 'T00:00:00');
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                
                // Only block past dates for non-attendance shifts
                // Attendance records should always be viewable
                if (shiftDate < today && !shiftId.startsWith('actual_')) {
                    return; // Don't allow editing past date shifts
                }
            }
            
            if (shift && shift.isActual) {
                // This is attendance data - show in read-only mode
                openShiftModal('attendance', { shiftId, shiftData: shift });
            } else if (shiftId && shiftId.startsWith('actual_')) {
                // This is an actual attendance shift (even if not found in current data)
                openShiftModal('attendance', { shiftId, shiftData: shift });
            } else {
                // This is scheduled shift - show in edit mode or view mode based on access
                if (READ_ONLY_MODE) {
                    openShiftModal('view', { shiftId });
                } else {
                    openShiftModal('edit', { shiftId });
                }
            }
        }

        cleanup();
    }

    function cleanup() {
        isSelecting = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function enterMultiSelectMode() {
    if (multiSelectMode) return;

    multiSelectMode = true;
    multiSelectControls.classList.remove('hidden');
    document.getElementById('selectingHint').classList.remove('hidden');
    updateSelectionCounter();
}

function exitMultiSelectMode() {
    multiSelectMode = false;
    selectedShifts.clear();
    multiSelectControls.classList.add('hidden');
    document.getElementById('selectingHint').classList.add('hidden');
    renderCurrentView();
}

function toggleShiftSelection(shiftId) {
    if (selectedShifts.has(shiftId)) {
        selectedShifts.delete(shiftId);
    } else {
        selectedShifts.add(shiftId);
    }
    updateSelectionCounter();
    renderCurrentView();
}

function updateSelectionCounter() {
    const count = selectedShifts.size;
    document.getElementById('selectionCounter').textContent = `${count} selected`;
    document.getElementById('deleteSelectedBtn').disabled = count === 0;
    document.getElementById('copySelectedBtn').disabled = count === 0;
}

async function deleteSelectedShifts() {
    if (selectedShifts.size === 0) return;

    const count = selectedShifts.size;
    if (!confirm(`Delete ${count} shift${count > 1 ? 's' : ''}?`)) return;

    const deletePromises = [];
    selectedShifts.forEach(shiftId => {
        deletePromises.push(deleteShift(shiftId));
    });

    await Promise.all(deletePromises);

    exitMultiSelectMode();
    saveToLocalStorage();
    // Don't call syncToFirebase() here since deleteShift already handles Firebase
    renderCurrentView();
}

function getScheduledShiftsForWeekStart(weekStartDate) {
    const weekKey = formatDate(weekStartDate);
    const weekData = scheduleData[weekKey] || {};
    const weekStart = new Date(weekStartDate);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const shifts = [];
    for (const dateStr in weekData) {
        const shiftDate = new Date(dateStr + 'T00:00:00');
        if (shiftDate < weekStart || shiftDate > weekEnd) continue;
        for (const shift of weekData[dateStr]) {
            if (shift.id && shift.id.startsWith('actual_')) continue;
            shifts.push(shift);
        }
    }
    return shifts;
}

async function ensureWeekLoadedFromFirebase(weekKey) {
    const weekData = scheduleData[weekKey];
    if (weekData && Object.keys(weekData).length > 0) return;

    const schedulesRef = collection(db, 'schedules', weekKey, 'shifts');
    const snapshot = await getDocs(schedulesRef);
    if (!scheduleData[weekKey]) scheduleData[weekKey] = {};

    snapshot.forEach((docSnap) => {
        const shift = { id: docSnap.id, ...docSnap.data() };
        if (shift.id && shift.id.startsWith('actual_')) return;

        const dateStr = shift.date;
        if (!dateStr) return;
        if (!scheduleData[weekKey][dateStr]) scheduleData[weekKey][dateStr] = [];

        const existingIndex = scheduleData[weekKey][dateStr].findIndex(s => s.id === shift.id);
        if (existingIndex !== -1) {
            scheduleData[weekKey][dateStr][existingIndex] = shift;
        } else {
            scheduleData[weekKey][dateStr].push(shift);
        }
    });
}

function cloneShiftForDate(shift, newDateStr) {
    const newShift = {
        id: generateShiftId(),
        date: newDateStr,
        branch: shift.branch,
        type: shift.type,
        employeeId: shift.employeeId,
        customStart: shift.customStart,
        customEnd: shift.customEnd,
        role: shift.role || 'barista',
        createdAt: new Date().toISOString(),
    };
    if (shift.role === 'custom') {
        newShift.customRole = shift.customRole || '';
    }
    return newShift;
}

async function removeScheduledShiftsForWeekDates(weekKey, dateStrs) {
    const deletePromises = [];

    for (const dateStr of dateStrs) {
        const shifts = [...((scheduleData[weekKey] || {})[dateStr] || [])];
        for (const shift of shifts) {
            if (shift.id && shift.id.startsWith('actual_')) continue;

            const arr = scheduleData[weekKey][dateStr];
            const idx = arr.findIndex(s => s.id === shift.id);
            if (idx !== -1) arr.splice(idx, 1);

            deletePromises.push(
                deleteDoc(doc(db, 'schedules', weekKey, 'shifts', shift.id)).catch(() => {})
            );
        }

        if (scheduleData[weekKey] && scheduleData[weekKey][dateStr]?.length === 0) {
            delete scheduleData[weekKey][dateStr];
        }
    }

    if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
        markLocalChanges();
    }
}

async function copyFromPreviousWeek() {
    if (READ_ONLY_MODE) return;

    const prevWeekStart = new Date(currentWeekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const currentWeekKey = getWeekKey();
    const currentWeekDateStrs = getWeekDates().map(formatDate);

    const copyBtn = document.getElementById('copyPrevWeekBtn');
    if (copyBtn) copyBtn.disabled = true;

    try {
        await ensureWeekLoadedFromFirebase(formatDate(prevWeekStart));

        const shiftsToCopy = getScheduledShiftsForWeekStart(prevWeekStart);
        if (shiftsToCopy.length === 0) {
            alert('No scheduled shifts found in the previous week.');
            return;
        }

        const existingScheduled = getScheduledShiftsForWeekStart(currentWeekStart);
        let message;
        if (existingScheduled.length > 0) {
            message = `Replace ${existingScheduled.length} scheduled shift${existingScheduled.length > 1 ? 's' : ''} in this week with ${shiftsToCopy.length} from the previous week?`;
        } else {
            message = `Copy ${shiftsToCopy.length} scheduled shift${shiftsToCopy.length > 1 ? 's' : ''} from the previous week?`;
        }
        if (!confirm(message)) return;

        if (existingScheduled.length > 0) {
            await removeScheduledShiftsForWeekDates(currentWeekKey, currentWeekDateStrs);
        }

        for (const shift of shiftsToCopy) {
            const prevDate = new Date(shift.date + 'T00:00:00');
            const newDate = new Date(prevDate);
            newDate.setDate(prevDate.getDate() + 7);
            const newDateStr = formatDate(newDate);
            const newWeekKey = getWeekKeyForDate(newDate);
            const newShift = cloneShiftForDate(shift, newDateStr);

            if (!scheduleData[newWeekKey]) scheduleData[newWeekKey] = {};
            if (!scheduleData[newWeekKey][newDateStr]) scheduleData[newWeekKey][newDateStr] = [];
            scheduleData[newWeekKey][newDateStr].push(newShift);
        }

        markLocalChanges();
        saveToLocalStorage();
        await syncToFirebase();
        renderCurrentView();
    } catch (error) {
        console.error('copyFromPreviousWeek:', error);
        alert('Failed to copy shifts from the previous week.');
    } finally {
        if (copyBtn) copyBtn.disabled = false;
    }
}

async function copySelectedShiftsToNextDay() {
    if (selectedShifts.size === 0) return;

    const count = selectedShifts.size;
    if (!confirm(`Copy ${count} shift${count > 1 ? 's' : ''} to the next day?`)) return;

    selectedShifts.forEach(shiftId => {
        const shift = findAnyShiftById(shiftId);
        if (!shift) return;

        // Calculate next day
        const currentDate = new Date(shift.date + 'T00:00:00');
        const nextDay = new Date(currentDate);
        nextDay.setDate(currentDate.getDate() + 1);
        const nextDateStr = formatDate(nextDay);
        const nextWeekKey = getWeekKeyForDate(nextDay);

        // Create copy of shift for next day
        const newShift = {
            id: generateShiftId(),
            date: nextDateStr,
            branch: shift.branch,
            type: shift.type,
            employeeId: shift.employeeId,
            customStart: shift.customStart,
            customEnd: shift.customEnd,
            role: shift.role || 'barista',
            customRole: shift.role === 'custom' ? (shift.customRole || '') : undefined,
        };

        // Initialize data structures if needed
        if (!scheduleData[nextWeekKey]) scheduleData[nextWeekKey] = {};
        if (!scheduleData[nextWeekKey][nextDateStr]) scheduleData[nextWeekKey][nextDateStr] = [];

        // Add the copied shift
        scheduleData[nextWeekKey][nextDateStr].push(newShift);
    });

    exitMultiSelectMode();
    saveToLocalStorage();
    syncToFirebase(); // Sync to Firebase
    renderCurrentView();
}

// Week management functions
function setCurrentWeek() {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const monday = new Date(today);

    // Calculate days to subtract to get to Monday
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    monday.setDate(today.getDate() - daysToSubtract);
    monday.setHours(0, 0, 0, 0);

    currentWeekStart = monday;
    updateWeekTitle();
}

function changeWeek(direction) {
    // Show immediate loading feedback
    const gridBody = document.querySelector('.shift-grid-body');
    if (gridBody) {
        gridBody.innerHTML = '<div style="text-align: center; padding: 2rem; color: #666;">Loading week...</div>';
    }

    const newWeek = new Date(currentWeekStart);
    newWeek.setDate(currentWeekStart.getDate() + (direction * 7));
    currentWeekStart = newWeek;
    updateWeekTitle();

    // Clear cache for immediate response
    actualAttendanceCache = {};

    loadScheduleData();
}

function updateWeekTitle() {
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(currentWeekStart.getDate() + 6);

    const startMonth = currentWeekStart.getMonth();
    const startYear = currentWeekStart.getFullYear();
    const endMonth = weekEnd.getMonth();
    const endYear = weekEnd.getFullYear();

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];

    let title;
    if (startMonth === endMonth && startYear === endYear) {
        // Same month
        title = `${monthNames[startMonth]} ${startYear}`;
    } else {
        // Different months
        title = `${monthNames[startMonth]} - ${monthNames[endMonth]} ${endYear}`;
    }

    weekTitle.textContent = title;
}

// View management
function toggleView(view) {
    currentView = view;
    if (view === 'calendar') {
        calendarViewContainer.style.display = 'block';
        employeeViewContainer.style.display = 'none';
        shiftViewContainer.style.display = 'none';
        renderCalendarView();
    } else if (view === 'shift') {
        calendarViewContainer.style.display = 'none';
        employeeViewContainer.style.display = 'none';
        shiftViewContainer.style.display = 'block';
        renderShiftView();
    } else {
        calendarViewContainer.style.display = 'none';
        employeeViewContainer.style.display = 'block';
        shiftViewContainer.style.display = 'none';
        renderEmployeeView();
    }
}

function renderCurrentView() {
    updateBranchFilterOptions(); // Keep filter in sync with current week's activity

    if (currentView === 'calendar') {
        renderCalendarView();
    } else if (currentView === 'shift') {
        renderShiftView();
    } else {
        renderEmployeeView();
    }
    
    // Also update mobile view if it exists
    renderMobileView();
}

// Employee dropdown population (excludes archived and inactive employees)
function populateEmployeeDropdowns() {
    const employeeOptions = Object.entries(employees)
        .filter(([id]) => employeeShownInShiftDropdown(id))
        .map(([id, name]) => {
            const displayName = employeeNicknames[id] || name?.split(' ')[0] || name;
            return `<option value="${id}">${displayName}</option>`;
        })
        .join('');

    shiftEmployee.innerHTML = '<option value="">Select employee</option>' + employeeOptions;
}

// Employee dropdown with date-aware grouping: "Available" vs "Already scheduled" for the given date
function populateEmployeeDropdownForDate(dateStr) {
    const activeEntries = Object.entries(employees).filter(([id]) => employeeShownInShiftDropdown(id));
    if (activeEntries.length === 0) {
        shiftEmployee.innerHTML = '<option value="">Select employee</option>';
        return;
    }
    const getDisplayName = (id, name) => (employeeNicknames[id] || name?.split(' ')[0] || name || id);

    if (!dateStr || dateStr.length < 10 || isNaN(new Date(dateStr + 'T00:00:00').getTime())) {
        populateEmployeeDropdowns();
        return;
    }

    const shifts = getAllShiftsForDay(dateStr);
    const employeeIdsWithShift = new Set(shifts.map(s => s.employeeId).filter(Boolean));

    const available = activeEntries.filter(([id]) => !employeeIdsWithShift.has(id));
    const alreadyScheduled = activeEntries.filter(([id]) => employeeIdsWithShift.has(id));

    let html = '<option value="">Select employee</option>';
    if (available.length > 0) {
        html += '<optgroup label="Available">';
        available.forEach(([id, name]) => {
            html += `<option value="${id}">${getDisplayName(id, name)}</option>`;
        });
        html += '</optgroup>';
    }
    if (alreadyScheduled.length > 0) {
        html += '<optgroup label="Already scheduled">';
        alreadyScheduled.forEach(([id, name]) => {
            html += `<option value="${id}">${getDisplayName(id, name)}</option>`;
        });
        html += '</optgroup>';
    }

    const previousValue = shiftEmployee.value;
    shiftEmployee.innerHTML = html;
    if (previousValue && [...shiftEmployee.options].some(o => o.value === previousValue)) {
        shiftEmployee.value = previousValue;
    }
}

function syncEventFieldsVisibility() {
    const isEvent = shiftBranch && shiftBranch.value === LOCATION_EVENT_SENTINEL;
    if (eventFields) {
        eventFields.style.display = isEvent ? 'block' : 'none';
    }
    if (shiftEvent) {
        shiftEvent.required = !!isEvent;
        if (!isEvent) {
            shiftEvent.value = '';
        }
    }
}

/** Resolve the branch key to store on the shift from Location + Event UI. */
function resolveShiftBranchKey() {
    const loc = shiftBranch?.value || '';
    if (!loc) return '';
    if (STATIC_LOCATION_KEYS.has(loc)) return loc;
    if (loc === LOCATION_EVENT_SENTINEL) {
        const ev = shiftEvent?.value || '';
        if (!ev || ev === EVENT_ADD_SENTINEL) return '';
        return ev;
    }
    // Legacy: location dropdown somehow holds a named event key
    return loc;
}

/** Map a stored branch key onto Location + Event UI controls. */
function applyLocationFromBranchKey(branchKey) {
    if (!shiftBranch) return;
    updateBranchDropdowns();

    let key = branchKey || '';

    // Attendance sometimes stores display names ("SM North", "Pop-up")
    if (key && !STATIC_LOCATION_KEYS.has(key) && key !== 'popup' && key !== 'workshop' && !allBranches.some((b) => b.key === key)) {
        const fromDisplay = Object.keys(BRANCHES).find((k) => BRANCHES[k] === key);
        if (fromDisplay) key = fromDisplay;
    }

    if (!key) {
        shiftBranch.value = '';
        syncEventFieldsVisibility();
        return;
    }

    if (STATIC_LOCATION_KEYS.has(key)) {
        shiftBranch.value = key;
        syncEventFieldsVisibility();
        return;
    }

    // Named event, or legacy generic popup/workshop
    shiftBranch.value = LOCATION_EVENT_SENTINEL;
    syncEventFieldsVisibility();

    if (shiftEvent) {
        const optionExists = [...shiftEvent.options].some((o) => o.value === key);
        if (optionExists) {
            shiftEvent.value = key;
        } else if (key === 'popup' || key === 'workshop') {
            // Legacy category-only: leave event empty so user must pick a named event
            shiftEvent.value = '';
        } else {
            // Archived / unknown: inject temporary option so edit still shows it
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = BRANCHES[key] || key;
            shiftEvent.insertBefore(opt, shiftEvent.lastElementChild);
            shiftEvent.value = key;
        }
    }
}

function updateBranchDropdowns() {
    // Update shift modal Location dropdown (static sites + Event sentinel)
    if (shiftBranch) {
        const currentValue = shiftBranch.value;
        shiftBranch.innerHTML = '<option value="">Select location</option>';

        const locationOptions = [
            { value: 'podium', text: 'Podium' },
            { value: 'smnorth', text: 'SM North' },
            { value: LOCATION_EVENT_SENTINEL, text: 'Event' },
            { value: 'other', text: 'Other' }
        ];

        locationOptions.forEach((option) => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.text;
            shiftBranch.appendChild(optionElement);
        });

        if ([...shiftBranch.options].some((o) => o.value === currentValue)) {
            shiftBranch.value = currentValue;
        }
    }

    // Update Event dropdown from Firestore pop-ups / workshops
    if (shiftEvent) {
        const currentEvent = shiftEvent.value;
        shiftEvent.innerHTML = '<option value="">Select event</option>';

        const popupBranches = allBranches
            .filter((b) => b.type === 'popup')
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const workshopBranches = allBranches
            .filter((b) => b.type === 'workshop')
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        popupBranches.forEach((branch) => {
            const option = document.createElement('option');
            option.value = branch.key;
            option.textContent = `[Popup] ${branch.name}`;
            shiftEvent.appendChild(option);
        });

        workshopBranches.forEach((branch) => {
            const option = document.createElement('option');
            option.value = branch.key;
            option.textContent = `[Workshop] ${branch.name}`;
            shiftEvent.appendChild(option);
        });

        const addOption = document.createElement('option');
        addOption.value = EVENT_ADD_SENTINEL;
        addOption.textContent = '+ Add new event';
        shiftEvent.appendChild(addOption);

        if (currentEvent && [...shiftEvent.options].some((o) => o.value === currentEvent)) {
            shiftEvent.value = currentEvent;
        }
    }

    syncEventFieldsVisibility();

    // Update branch filter dropdown
    updateBranchFilterOptions();
}

// Attendance-app login categories shown in the location filter
const LOGIN_CATEGORIES = [
    { value: 'podium',   text: 'Podium' },
    { value: 'smnorth',  text: 'SM North' },
    { value: 'popup',    text: 'Pop-up' },
    { value: 'workshop', text: 'Workshop' },
    { value: 'other',    text: 'Other' },
];

function updateBranchFilterOptions() {
    const branchFilterEl = document.getElementById('branchFilter');
    if (!branchFilterEl) return;

    const currentValue = branchFilterEl.value;
    branchFilterEl.innerHTML = '<option value="all">All Locations</option>';

    LOGIN_CATEGORIES.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.value;
        option.textContent = cat.text;
        branchFilterEl.appendChild(option);
    });

    // Restore selection if still available, else fall back to 'all'
    if ([...branchFilterEl.options].some(o => o.value === currentValue)) {
        branchFilterEl.value = currentValue;
    } else {
        branchFilterEl.value = 'all';
    }
}

async function loadAllEmployees() {
    try {
        const employeesRef = collection(db, "employees_v2");
        const snapshot = await getDocs(employeesRef);

        employees = {};
        employeePhotoUrls = {};
        archivedEmployeeIds = new Set();
        inactiveEmployeeIds = new Set();
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            employees[docSnap.id] = data.name;
            if (data.photoUrl) employeePhotoUrls[docSnap.id] = data.photoUrl;
            if (data.archived) archivedEmployeeIds.add(docSnap.id);
            if (data.active === false) inactiveEmployeeIds.add(docSnap.id);
        });

        populateEmployeeDropdowns();
        renderCurrentView();
        refreshEmployeeLastTimeInPhotosInBackground();
        return employees;
    } catch (error) {

        return {};
    }
}

async function loadBranchesFromFirebase() {
    try {
        const snapshot = await getDocs(collection(db, "branches"));
        const firebaseBranches = [];
        snapshot.forEach(doc => {
            firebaseBranches.push({ id: doc.id, ...doc.data() });
        });

        // Filter out archived events - only show active events
        const activeBranches = firebaseBranches.filter(branch => {
            const isArchived = branch.archived;
            return !isArchived;
        });
        
        
        allBranches = activeBranches;

        // Update BRANCHES object with loaded branches
        allBranches.forEach(branch => {
            BRANCHES[branch.key] = branch.name;
        });

        localStorage.setItem('branches-cache', JSON.stringify(allBranches));
        updateBranchDropdowns();

        return allBranches;
    } catch (error) {

        // Fallback to local cache
        const cached = localStorage.getItem('branches-cache');
        if (cached) {

            allBranches = JSON.parse(cached);

            
            // Also filter cached data to remove archived events
            allBranches = allBranches.filter(branch => {
                const isArchived = branch.archived;

                return !isArchived;
            });
            

            
            allBranches.forEach(branch => {
                BRANCHES[branch.key] = branch.name;
            });
            updateBranchDropdowns();
        }
        return allBranches;
    }
}

async function saveBranchToFirebase(branchData) {
    try {
        const docRef = await addDoc(collection(db, "branches"), branchData);
        const saved = { id: docRef.id, ...branchData };
        try {
            const mod = await import("../../shared/js/ops-events.js");
            await mod.createOpsEventFromBranch(
                db,
                {
                    getDocs,
                    collection,
                    doc,
                    addDoc,
                    updateDoc,
                    setDoc,
                    deleteDoc
                },
                saved,
                { createdBy: "scheduling-app" }
            );
        } catch (err) {
            console.warn("opsEvents dual-write skipped:", err);
        }
        return saved;
    } catch (error) {

        throw error;
    }
}

function renderCalendarView() {

    const weekDates = getWeekDates();

    let gridHTML = `
        <div class="calendar-header">
            <div class="time-spacer"></div>
            ${weekDates.map(date => {
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = date.getDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isCurrentDay = date.getTime() === today.getTime();
        return `<div class="calendar-day-header">
                    <div class="day-name${isCurrentDay ? ' current-day' : ''}">${dayName}</div>
                    <div class="day-date${isCurrentDay ? ' current-day' : ''}">${dayNum}</div>
                </div>`;
    }).join('')}
        </div>
        <div class="calendar-body">
            <div class="time-column">
                ${generateTimeSlots()}
            </div>
            <div class="calendar-grid">
                ${weekDates.map(date => {
        const dateStr = formatDate(date);
        return `<div class="calendar-day-column" data-date="${dateStr}">
                        ${generateDaySlots(dateStr)}
                    </div>`;
    }).join('')}
            </div>
        </div>
    `;

    scheduleGrid.innerHTML = gridHTML;

    // Add event listeners
    document.querySelectorAll('.hour-slot').forEach(slot => {
        slot.addEventListener('click', handleHourSlotClick);
    });

    document.querySelectorAll('.shift-block').forEach(shift => {
        shift.addEventListener('mousedown', handleShiftClick);
    });
}

async function renderShiftView() {
    
    // Always use auto mode now
    currentPastDaysMode = 'auto';


    const weekDates = getWeekDates();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Don't preload - let individual dates load as needed


    // Apply branch filter to determine which branches to show
    const shiftViewBranches = getFilteredBranches();

    // Simplified shift categories
    const shiftCategories = ['opening', 'midshift', 'closing'];
    const shiftCategoryNames = {
        'opening': 'Opening',
        'midshift': 'Midshift',
        'closing': 'Closing',
        'deliveries': 'Deliveries',
        'custom': 'Custom'
    };

    let gridHTML = `
        <div class="shift-grid-header">
            <div class="shift-branch-column"></div>
            ${weekDates.map(date => {
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = date.getDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isCurrentDay = date.getTime() === today.getTime();
        return `<div class="shift-day-header">
                    <div class="day-name${isCurrentDay ? ' current-day' : ''}">${dayName}</div>
                    <div class="day-date${isCurrentDay ? ' current-day' : ''}">${dayNum}</div>
                </div>`;
    }).join('')}
        </div>
        <div class="shift-grid-body">
    `;

    // Generate rows for each branch + shift combination
    for (const branchKey of shiftViewBranches) {
        const branchName = BRANCHES[branchKey] || branchKey;
        const isDefaultBranch = branchKey === 'podium' || branchKey === 'smnorth';

        // Check if this branch has ANY visible activity this week:
        // - past dates: only actual logins count (scheduled data on past days is ignored)
        // - today/future dates: scheduled shifts count
        let hasAnyShifts = false;
        for (const date of weekDates) {
            const dateStr = formatDate(date);
            const isPastDate = date < today;

            if (isPastDate) {
                // Only actual logins make a past date count
                const actualAttendance = getActualAttendanceForDate(dateStr);
                const hasLogin = Object.values(actualAttendance).some(a =>
                    attendanceBelongsToSection(a.branch, branchKey)
                );
                if (hasLogin) { hasAnyShifts = true; break; }
            } else {
                // Today and future: scheduled shifts count
                const scheduled = getAllShiftsForDay(dateStr).filter(s => shiftBelongsToSection(s.branch, branchKey));
                if (scheduled.length > 0) { hasAnyShifts = true; break; }
            }
        }

        if (!hasAnyShifts && !isDefaultBranch) {
            continue; // Skip this entire branch if no shifts
        }

        // Collapsible branch block: header + rows wrapper
        gridHTML += `<div class="shift-branch-block" data-branch-key="${branchKey}">
            <div class="shift-branch-section shift-branch-header" role="button" tabindex="0" data-branch-key="${branchKey}" title="Click to collapse/expand">
                <span class="shift-branch-chevron" aria-hidden="true">▼</span>
                <span class="shift-branch-title">${branchName}</span>
            </div>
            <div class="shift-branch-rows">`;

        // Check which shift categories have content for this branch
        const categoriesWithContent = [];
        
        if (currentPastDaysMode === 'actual' || currentPastDaysMode === 'auto') {
            // For actual attendance (or auto mode), we need to show categories that have:
            // 1. Actual attendance data for past dates, OR
            // 2. Scheduled shifts for today/future dates
            
            const categoriesWithActualData = new Set();
            const categoriesWithScheduledData = new Set();
            
            for (const date of weekDates) {
                const dateStr = formatDate(date);
                const isPastDate = date < today;
                
                if (isPastDate) {
                    // Check for actual attendance data
                    const actualData = getActualAttendanceForDate(dateStr);
                    Object.values(actualData).forEach(attendance => {
                        if (attendanceBelongsToSection(attendance.branch, branchKey)) {
                            const category = categorizeShiftByTime(attendance.shift, attendance.timeIn);
                            categoriesWithActualData.add(category);
                        }
                    });
                } else {
                    // Check for scheduled shifts for today and future dates
                    const allShiftsForDay = getAllShiftsForDay(dateStr);
                    allShiftsForDay.forEach(shift => {
                        if (shiftBelongsToSection(shift.branch, branchKey)) {
                            const shiftStartTime = getShiftStartTime(shift);
                            const category = categorizeShiftByTime(shift.type, shiftStartTime);
                            categoriesWithScheduledData.add(category);
                            if (shift.role === 'deliveries') categoriesWithScheduledData.add('deliveries');
                            if (shift.role === 'custom') categoriesWithScheduledData.add('custom');
                        }
                    });
                }
            }
            
            // Combine both actual and scheduled categories
            const allCategories = new Set([...categoriesWithActualData, ...categoriesWithScheduledData]);
            
            if (allCategories.size > 0) {
                // Sort categories: opening, midshift, closing, then deliveries, custom at bottom
                const order = ['opening', 'midshift', 'closing', 'deliveries', 'custom'];
                const sortedCategories = Array.from(allCategories).sort((a, b) => order.indexOf(a) - order.indexOf(b));
                categoriesWithContent.push(...sortedCategories);
            } else {
                // Fallback: show all standard categories for default branches
                if (isDefaultBranch) {
                    categoriesWithContent.push('opening', 'midshift', 'closing');
                }
            }
        } else {
            // For scheduled shifts, use the standard categories
            for (const category of shiftCategories) {
                let hasContentThisWeek = false;

                for (const date of weekDates) {
                    const dateStr = formatDate(date);
                    const allShiftsForDay = getAllShiftsForDay(dateStr);
                    const shiftsForCategory = allShiftsForDay.filter(shift =>
                        shiftBelongsToSection(shift.branch, branchKey) &&
                        categorizeShiftByTime(shift.type, getShiftStartTime(shift)) === category
                    );

                    if (shiftsForCategory.length > 0) {
                        hasContentThisWeek = true;
                        break;
                    }
                }

                if (hasContentThisWeek) {
                    categoriesWithContent.push(category);
                }
            }
            // Role-based rows at bottom: show if any scheduled shift has that role
            for (const roleCategory of ['deliveries', 'custom']) {
                let hasRoleThisWeek = false;
                for (const date of weekDates) {
                    const dateStr = formatDate(date);
                    const allShiftsForDay = getAllShiftsForDay(dateStr);
                    if (allShiftsForDay.some(shift => shiftBelongsToSection(shift.branch, branchKey) && shift.role === roleCategory)) {
                        hasRoleThisWeek = true;
                        break;
                    }
                }
                if (hasRoleThisWeek) categoriesWithContent.push(roleCategory);
            }
        }

        // Show categories that have content, plus "New Shift" for default branches
        const categoriesToShow = categoriesWithContent.length > 0 ? categoriesWithContent : [];
        if (isDefaultBranch) {
            categoriesToShow.push('newshift');
        } else if (categoriesToShow.length === 0) {
            continue;
        }

        for (const category of categoriesToShow) {
            if (category === 'newshift') {
                // Special case for "New Shift" row
                gridHTML += `<div class="shift-grid-row">
                    <div class="shift-type-header"></div>`;

                weekDates.forEach(date => {
                    const dateStr = formatDate(date);
                    gridHTML += `<div class="shift-cell" data-date="${dateStr}" data-branch="${branchKey}" data-shift-type="">
                    </div>`;
                });

                gridHTML += '</div>';
                continue;
            }

            const categoryName = shiftCategoryNames[category];

            gridHTML += `<div class="shift-grid-row">
                <div class="shift-type-header">${categoryName}</div>`;

            // Add cells for each day
            for (const date of weekDates) {
                const dateStr = formatDate(date);
                
                const isPastDate = new Date(dateStr + 'T00:00:00') < new Date();
                const pastDateClass = isPastDate ? 'past-date' : '';
                
                gridHTML += `<div class="shift-cell ${pastDateClass}" data-date="${dateStr}" data-branch="${branchKey}" data-shift-type="${category}">`;

                // Get data for this cell
                const dataInfo = getDataForDate(dateStr, branchKey, category);
                const shiftsForCell = dataInfo.data;

                if (shiftsForCell.length > 0) {
                    // Show the actual data
                    shiftsForCell.forEach(shift => {
                        const conflict = !shift.isActual && hasConflict(shift, dateStr);
                        
                        // Only apply 'completed' class to actual attendance, not scheduled shifts
                        const completedClass = (shift.isActual && isPastDate) ? 'completed' : '';

                        // Create layout based on whether it's a completed block
                        let shiftContent;
                        if (completedClass) {
                           
                            // For attendance records, use attendance-specific time formatting
                            const timeInDisplay = shift.customStart ? formatAttendanceTime(shift.customStart, shift.type, false) : 'N/A';
                            const timeOutDisplay = shift.customEnd ? formatAttendanceTime(shift.customEnd, shift.type, true) : '';
                            
                            // Format time out with dash prefix
                            const timeOutWithDash = timeOutDisplay ? `- ${timeOutDisplay}` : '- ';
                            
                            // Check if time in is late and get severity
                            const lateStatus = isLateTimeIn(shift.type, timeInDisplay);
                            const timeInClass = lateStatus === 'red' ? 'late-red' : lateStatus === 'orange' ? 'late-orange' : '';
                            
                            // Always show photo layout for completed shifts, with placeholder if no photo
                            const photoSrc = shift.timeInPhoto || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iMjAiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iI0NDQ0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yMCAxMkMxNi42ODYzIDEyIDE0IDE0LjY4NjMgMTQgMThDMTQgMjEuMzEzNyAxNi42ODYzIDI0IDIwIDI0QzIzLjMxMzcgMjQgMjYgMjEuMzEzNyAyNiAxOEMyNiAxNC42ODYzIDIzLjMxMzcgMTIgMjAgMTJaIiBmaWxsPSIjQ0NDQ0NDIi8+CjxwYXRoIGQ9Ik0xMCAzNkMxMCAzMS41ODE3IDEzLjU4MTcgMjggMTggMjhIMjJDMjYuNDE4MyAyOCAzMCAzMS41ODE3IDMwIDM2VjM4SDEwVjM2WiIgZmlsbD0iI0NDQ0NDQyIvPgo8L3N2Zz4K';
                            const roleLabel = getShiftRoleDisplay(shift);
                            shiftContent = `
                                <div class="shift-photo-wrap">
                                    <img src="${photoSrc}" class="shift-employee-photo" alt="Time In Photo" onerror="console.error('❌ Photo failed to load (grid):', this.src)" />
                                    <span class="shift-role-tag">${roleLabel}</span>
                                </div>
                                <div class="shift-details-container">
                                    <div class="shift-employee">${shift.employeeId === 'unassigned' ? 'UNASSIGNED' : (employeeNicknames[shift.employeeId] || employees[shift.employeeId]?.split(' ')[0] || employees[shift.employeeId])}</div>
                                    <div class="shift-time ${timeInClass}">${timeInDisplay}</div>
                                    <div class="shift-time">${timeOutWithDash}</div>
                                </div>
                            `;
                        } else {
                            // Scheduled shifts: last clock-in selfie or placeholder
                            const whitePlaceholderPhoto = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iMjAiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iI0NDQ0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yMCAxMkMxNi42ODYzIDEyIDE0IDE0LjY4NjMgMTQgMThDMTQgMjEuMzEzNyAxNi42ODYzIDI0IDIwIDI0QzIzLjMxMzcgMjQgMjYgMjEuMzEzNyAyNiAxOEMyNiAxNC42ODYzIDIzLjMxMzcgMTIgMjAgMTJaIiBmaWxsPSIjRkZGRkZGIi8+CjxwYXRoIGQ9Ik0xMCAzNkMxMCAzMS41ODE3IDEzLjU4MTcgMjggMTggMjhIMjJDMjYuNDE4MyAyOCAzMCAzMS41ODE3IDMwIDM2VjM4SDEwVjM2WiIgZmlsbD0iI0ZGRkZGRiIvPgo8L3N2Zz4K';
                            const scheduledPhotoSrc = shift.isActual
                                ? (shift.timeInPhoto || whitePlaceholderPhoto)
                                : (getEmployeeLastTimeInPhotoUrl(shift.employeeId) || whitePlaceholderPhoto);
                            const timeDisplay = getShiftTimeDisplayForScheduled(shift);
                            const roleLabel = getShiftRoleDisplay(shift);
                            shiftContent = `
                                <div class="shift-photo-wrap">
                                    <img src="${scheduledPhotoSrc}" class="shift-employee-photo" alt="Last Time In Photo" />
                                    <span class="shift-role-tag">${roleLabel}</span>
                                </div>
                                <div class="shift-details-container">
                                    <div class="shift-employee">${shift.employeeId === 'unassigned' ? 'UNASSIGNED' : (employeeNicknames[shift.employeeId] || employees[shift.employeeId]?.split(' ')[0] || employees[shift.employeeId])}</div>
                                    <div class="shift-time">${timeDisplay.startTime}</div>
                                    <div class="shift-time">- ${timeDisplay.endTime}</div>
                                </div>
                            `;
                        }
                        
                        gridHTML += `
                            <div class="shift-employee-block ${shift.type} ${conflict ? 'shift-conflict' : ''} ${completedClass} ${shift.employeeId === 'unassigned' ? 'unassigned' : ''} ${selectedShifts.has(shift.id) ? 'selected' : ''}"
                                 data-shift-id="${shift.id}" data-employee-id="${shift.employeeId || ''}">
                                ${shiftContent}
                            </div>
                        `;
                    });
                } else {
                    // No data - show loading spinner for past dates and today (when loading), add button for future
                    const isToday = new Date(dateStr + 'T00:00:00').getTime() === new Date().setHours(0, 0, 0, 0);
                    
                    if ((isPastDate || isToday) && (currentPastDaysMode === 'actual' || currentPastDaysMode === 'auto')) {
                        // Check if this date has been checked (either has data or was confirmed empty)
                        const actualData = getActualAttendanceForDate(dateStr);
                        const hasBeenChecked = actualAttendanceCache.hasOwnProperty(dateStr);
                        
                        if (!hasBeenChecked) {
                            // Show loading spinner for past/today date cells that haven't been checked yet
                            gridHTML += `
                                <div class="loading-spinner" data-date="${dateStr}" data-branch="${branchKey}" data-shift-type="${category}">
                                    <div class="spinner"></div>
                                </div>
                            `;
                            // Trigger loading for this date if not already loading
                            if (!loadingDates.has(dateStr)) {
                                loadActualAttendanceForDate(dateStr);
                            }
                        } else {
                            // Plus button removed
                        }
                    } else {
                        // Plus button removed
                    }
                }

                gridHTML += '</div>';
            }

            gridHTML += '</div>';
        }
        // Close shift-branch-rows and shift-branch-block
        gridHTML += `</div></div>`;
    }

    // Add general "Add New Shift" row for other branches
    gridHTML += `<div class="shift-branch-section">
        <div class="shift-branch-title">Add New Shift</div>
    </div>`;

    gridHTML += `<div class="shift-grid-row">
        <div class="shift-type-header"></div>`;

    weekDates.forEach(date => {
        const dateStr = formatDate(date);
        const isPastDate = date < today;
        gridHTML += `<div class="shift-cell" data-date="${dateStr}" data-branch="" data-shift-type="">
        </div>`;
    });

    gridHTML += '</div></div>';

    shiftScheduleGrid.innerHTML = gridHTML;

    // Restore collapsed state and add branch header click handlers
    const collapsedKey = 'schedule-collapsed-branches';
    let collapsedBranches = new Set(JSON.parse(sessionStorage.getItem(collapsedKey) || '[]'));
    document.querySelectorAll('.shift-branch-block').forEach(block => {
        const key = block.getAttribute('data-branch-key');
        const rowsEl = block.querySelector('.shift-branch-rows');
        const header = block.querySelector('.shift-branch-header');
        const chevron = block.querySelector('.shift-branch-chevron');
        if (!rowsEl || !header) return;
        const toggle = () => {
            const isCollapsed = block.classList.toggle('shift-branch-collapsed');
            if (chevron) chevron.textContent = isCollapsed ? '▶' : '▼';
            if (isCollapsed) collapsedBranches.add(key);
            else collapsedBranches.delete(key);
            sessionStorage.setItem(collapsedKey, JSON.stringify([...collapsedBranches]));
        };
        if (collapsedBranches.has(key)) {
            block.classList.add('shift-branch-collapsed');
            if (chevron) chevron.textContent = '▶';
        }
        header.addEventListener('click', toggle);
        header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });

    // Add event listeners
    document.querySelectorAll('.shift-cell').forEach(cell => {
        cell.addEventListener('click', handleShiftCellClick);
    });

    document.querySelectorAll('.shift-employee-block').forEach(block => {
        block.addEventListener('mousedown', handleShiftClick);
    });

    setupShiftViewEmployeeHighlight();
}

function clearEmployeeWeekHighlight() {
    if (employeeHighlightTimer !== null) {
        clearTimeout(employeeHighlightTimer);
        employeeHighlightTimer = null;
    }
    employeeHighlightEmployeeId = null;
    if (!shiftScheduleGrid) return;
    shiftScheduleGrid.querySelectorAll('.shift-employee-block.same-employee-highlight').forEach(el => {
        el.classList.remove('same-employee-highlight');
    });
}

function setupShiftViewEmployeeHighlight() {
    if (!shiftScheduleGrid) return;
    shiftScheduleGrid.querySelectorAll('.shift-employee-block').forEach(block => {
        block.addEventListener('mouseenter', function (e) {
            const employeeId = this.getAttribute('data-employee-id') || '';
            clearTimeout(employeeHighlightTimer);
            employeeHighlightTimer = window.setTimeout(() => {
                employeeHighlightTimer = null;
                employeeHighlightEmployeeId = employeeId;
                shiftScheduleGrid.querySelectorAll('.shift-employee-block[data-employee-id="' + CSS.escape(employeeId) + '"]').forEach(el => {
                    el.classList.add('same-employee-highlight');
                });
            }, 2000);
        });
        block.addEventListener('mouseleave', function (e) {
            const employeeId = this.getAttribute('data-employee-id') || '';
            const next = e.relatedTarget;
            const movingToSameEmployee = next && typeof next.closest === 'function' && next.closest('.shift-employee-block[data-employee-id="' + CSS.escape(employeeId) + '"]');
            if (!movingToSameEmployee) {
                clearEmployeeWeekHighlight();
            }
        });
    });
}

function isToday(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate.getTime() === today.getTime();
}

function removeSecondsFromTime(timeStr) {
    if (!timeStr) return null;



    // First, remove seconds if present (e.g., "1:52:02 PM" -> "1:52 PM")
    let cleanTime = timeStr;
    if (timeStr.includes(':') && timeStr.split(':').length === 3) {

        const parts = timeStr.split(' ');
        if (parts.length === 2) {
            // Format: "1:52:02 PM" -> "1:52 PM"
            const [time, meridian] = parts;
            const timeParts = time.split(':');
            cleanTime = `${timeParts[0]}:${timeParts[1]} ${meridian}`;

        } else {
            // Format: "18:40:50" -> "18:40"
            const timeParts = timeStr.split(':');
            cleanTime = `${timeParts[0]}:${timeParts[1]}`;

        }
    } else {

    }

    // Now use the standardized conversion function
    const result = convertTo12HourFormat(cleanTime);

    return result;
}

function getShiftsForBranchAndType(dateStr, branchKey, shiftType) {
    const allShifts = getAllShiftsForDay(dateStr);
    if (shiftType === '') {
        // For empty shift type (new shift row), return empty array
        return [];
    }

    // Apply branch filter
    const filteredShifts = allShifts.filter(shift => {
        const filter = branchFilter.value;
        const matchesBranch = filter === 'all' || getBranchCategory(shift.branch) === filter || shift.branch === filter;
        const matchesShiftParams = shiftBelongsToSection(shift.branch, branchKey) && shift.type === shiftType;
        return matchesBranch && matchesShiftParams;
    });

    return filteredShifts;
}

function handleShiftCellClick(e) {
    e.stopPropagation();

    // Check if click was directly on a shift block
    if (e.target.closest('.shift-employee-block')) {
        return; // Let shift click handler handle this
    }

    // Prevent adding shifts in read-only mode
    if (READ_ONLY_MODE) {
        return;
    }

    const cell = e.currentTarget;

    // Only handle if click was on empty area or add button
    const date = cell.dataset.date;
    const branch = cell.dataset.branch;
    const shiftType = cell.dataset.shiftType;

    // Check if this is a past date
    const cellDate = new Date(date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (cellDate < today) {

        return; // Don't allow adding shifts to past dates
    }

    openShiftModal('add', { date, branch, shiftType });
}

function handleHourSlotClick(e) {
    // Prevent adding shifts in read-only mode
    if (READ_ONLY_MODE) {
        return;
    }

    const slot = e.currentTarget;
    const column = slot.closest('.calendar-day-column');
    const date = column.dataset.date;
    const hour = parseInt(slot.dataset.hour);

    // Check if this is a past date
    const cellDate = new Date(date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (cellDate < today) {

        return; // Don't allow adding shifts to past dates
    }


    openShiftModal('add', { date, hour });
}

function generateTimeSlots() {
    let slotsHTML = '';
    for (let hour = 8; hour <= 22; hour++) {
        const timeLabel = hour > 12 ? `${hour - 12}:00 PM` : `${hour}:00 AM`;
        slotsHTML += `<div class="time-slot">${timeLabel}</div>`;
    }
    return slotsHTML;
}

function generateDaySlots(dateStr) {

    const shifts = getAllShiftsForDay(dateStr);

    const filteredShifts = shifts.filter(shift => {
        const filter = branchFilter.value;
        return filter === 'all' || getBranchCategory(shift.branch) === filter;
    });

    let slotsHTML = '';

    // Create hour slots first
    for (let hour = 8; hour <= 22; hour++) {
        slotsHTML += `<div class="hour-slot" data-hour="${hour}">
    </div>`;
    }

    // Sort shifts by start time to handle overlaps properly
    const sortedShifts = filteredShifts.sort((a, b) => {
        const aStart = getShiftStartTime(a);
        const bStart = getShiftStartTime(b);
        return aStart.localeCompare(bStart);
    });

    // Calculate overlaps and positions
    const shiftPositions = calculateShiftPositions(sortedShifts, dateStr);

    // Add shift blocks with calculated positions
    shiftPositions.forEach(({ shift, left, width, zIndex }) => {
        const startTime = getShiftStartTime(shift);
        const endTime = getShiftEndTime(shift);

        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);

        const startMinutes = (startHour * 60) + startMin;
        const endMinutes = (endHour * 60) + endMin;
        const duration = endMinutes - startMinutes;

        const topOffset = ((startHour - 8) * 60) + (startMin); // 60px per hour
        const height = (duration / 60) * 60; // Convert back to pixels

        const conflict = hasConflict(shift, dateStr);

        slotsHTML += `
            <div class="shift-block ${shift.type} ${conflict ? 'shift-conflict' : ''} ${isPastDate(dateStr) ? 'completed' : ''} ${shift.employeeId === 'unassigned' ? 'unassigned' : ''} ${selectedShifts.has(shift.id) ? 'selected' : ''}"
                style="top: ${topOffset}px; height: ${height}px; left: ${left}%; width: ${width}%; z-index: ${zIndex};"
                data-shift-id="${shift.id}">
                <div class="shift-employee">${shift.employeeId === 'unassigned' ? 'UNASSIGNED' : (employeeNicknames[shift.employeeId] || employees[shift.employeeId]?.split(' ')[0] || employees[shift.employeeId])}</div>
                <div class="shift-branch">${BRANCHES[shift.branch]}</div>
                <div class="shift-type">${SHIFT_TYPES[shift.type].name}</div>
                <div class="shift-time">${getShiftTimeDisplay(shift)}</div>
            </div>
        `;
    });

    return slotsHTML;
}

function calculateShiftPositions(shifts, dateStr) {
    const positions = [];

    // Group shifts by exact time ranges
    const timeGroups = {};
    shifts.forEach(shift => {
        const timeKey = `${getShiftStartTime(shift)}-${getShiftEndTime(shift)}`;
        if (!timeGroups[timeKey]) {
            timeGroups[timeKey] = [];
        }
        timeGroups[timeKey].push(shift);
    });

    shifts.forEach((shift, index) => {
        const startTime = getShiftStartTime(shift);
        const endTime = getShiftEndTime(shift);
        const timeKey = `${startTime}-${endTime}`;
        const sameTimeShifts = timeGroups[timeKey];

        // Calculate z-index based on start time (later shifts on top)
        const [startHour, startMin] = startTime.split(':').map(Number);
        const startMinutes = (startHour * 60) + startMin;
        const baseZIndex = Math.floor(startMinutes / 30); // Every 30 mins = +1 z-index

        if (sameTimeShifts.length > 1) {
            // Multiple shifts with exact same time - split them horizontally
            const shiftIndex = sameTimeShifts.findIndex(s => s.id === shift.id);
            const totalSameTime = sameTimeShifts.length;
            const width = (90 / totalSameTime) - 2;
            const left = (shiftIndex * (90 / totalSameTime)) + 2;

            positions.push({
                shift,
                left,
                width,
                zIndex: baseZIndex + shiftIndex
            });
        } else {
            // Single shift or different times - use stacking logic
            const overlappingBefore = shifts.slice(0, index).filter(otherShift => {
                const otherStart = getShiftStartTime(otherShift);
                const otherEnd = getShiftEndTime(otherShift);
                const otherTimeKey = `${otherStart}-${otherEnd}`;

                if (otherTimeKey === timeKey) return false;
                return (startTime < otherEnd) && (endTime > otherStart);
            }).length;

            const baseWidth = 90;
            const indentPerLevel = 8;
            const width = baseWidth - (overlappingBefore * indentPerLevel);
            const left = overlappingBefore * indentPerLevel + 2;

            positions.push({
                shift,
                left,
                width,
                zIndex: baseZIndex + overlappingBefore // Later start times get higher z-index
            });
        }
    });

    return positions;
}

async function deleteAllData() {
    if (!confirm('DELETE ALL SCHEDULE DATA? This cannot be undone!')) {
        return;
    }

    if (!confirm('Are you REALLY sure? This will delete EVERYTHING!')) {
        return;
    }

    updateSyncStatus('syncing');

    try {
        // Get all week keys from local data and any additional weeks we might have
        const allWeekKeys = new Set(Object.keys(scheduleData));

        // Add some common week ranges in case there's data we don't have locally
        const currentWeek = new Date(currentWeekStart);
        for (let i = -10; i <= 10; i++) { // 20 weeks total
            const targetWeek = new Date(currentWeek);
            targetWeek.setDate(currentWeek.getDate() + (i * 7));
            allWeekKeys.add(formatDate(targetWeek));
        }



        // Delete from Firebase for each week
        for (const weekKey of allWeekKeys) {
            try {
                const weekRef = collection(db, "schedules", weekKey, "shifts");
                const snapshot = await getDocs(weekRef);

                const deletePromises = [];
                snapshot.forEach(doc => {
                    deletePromises.push(deleteDoc(doc.ref));
                });

                if (deletePromises.length > 0) {
                    await Promise.all(deletePromises);

                }
            } catch (weekError) {

            }
        }


    } catch (error) {

        alert('Error deleting Firebase data: ' + error.message);
    }

    // Nuke local data
    scheduleData = {};
    localStorage.removeItem('matchanese_schedules');
    sessionStorage.clear();

    updateSyncStatus('synced');

    alert('All schedule data deleted from both Firebase and local storage!');
    renderCurrentView();
}

// Add nickname storage
let employeeNicknames = {};

async function loadEmployeeNicknames() {
    // First try to load from localStorage
    const cachedNicknames = localStorage.getItem('employee_nicknames');
    if (cachedNicknames) {
        employeeNicknames = JSON.parse(cachedNicknames);
        populateEmployeeDropdowns(); // Re-populate dropdown with updated nicknames
        renderCurrentView(); // Render with cached nicknames first
    }

    // Then fetch from Firebase and update
    // Then fetch from Firebase and update
    try {
        let hasChanges = false;
        for (const employeeId of Object.keys(employees)) {
            const employeeDoc = await getDoc(doc(db, "employees_v2", employeeId));
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

            renderCurrentView(); // Re-render with updated nicknames
        }
    } catch (error) {

    }
}

function handleColumnClick(e) {
    if (e.target.classList.contains('shift-block')) return;

    const column = e.currentTarget;
    const date = column.dataset.date;

    // Check if this is a past date
    const cellDate = new Date(date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (cellDate < today) {

        return; // Don't allow adding shifts to past dates
    }

    openShiftModal('add', { date });
}


// Employee view rendering
function renderEmployeeView() {

    const weekDates = getWeekDates();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all employees who have shifts this week
    const employeesWithShifts = [];
    weekDates.forEach(date => {
        const dateStr = formatDate(date);
        const shiftsForDay = getAllShiftsForDay(dateStr);
        shiftsForDay.forEach(shift => {
            if (!employeesWithShifts.includes(shift.employeeId)) {
                employeesWithShifts.push(shift.employeeId);
            }
        });
    });

    let gridHTML = `
        <div class="shift-grid-header">
            <div class="shift-branch-column">Employee</div>
            ${weekDates.map(date => {
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = date.getDate();
        const isCurrentDay = date.getTime() === today.getTime();
        return `<div class="shift-day-header">
                    <div class="day-name${isCurrentDay ? ' current-day' : ''}">${dayName}</div>
                    <div class="day-date${isCurrentDay ? ' current-day' : ''}">${dayNum}</div>
                </div>`;
    }).join('')}
        </div>
        <div class="shift-grid-body">
    `;

    // Generate rows for each employee
    employeesWithShifts.forEach(employeeId => {
        const employeeName = employeeNicknames[employeeId] || employees[employeeId];

        gridHTML += `<div class="shift-branch-section">
            <div class="shift-branch-title">${employeeName}</div>
        </div>`;

        gridHTML += `<div class="shift-grid-row">
            <div class="shift-type-header">Shifts</div>`;

        // Add cells for each day
        weekDates.forEach(date => {
            const dateStr = formatDate(date);
            const shiftsForDay = getAllShiftsForDay(dateStr).filter(shift => shift.employeeId === employeeId);
            const isPastDate = new Date(dateStr + 'T00:00:00') < new Date();
            const pastDateClass = isPastDate ? 'past-date' : '';

            gridHTML += `<div class="shift-cell ${pastDateClass}" data-date="${dateStr}" data-employee="${employeeId}">`;

            if (shiftsForDay.length > 0) {
                shiftsForDay.forEach(shift => {
                    const conflict = hasConflict(shift, dateStr);
                    const completedClass = isPastDate ? 'completed' : '';
                    // In employee view, show branch in the card (row already shows employee name)
                    const branchDisplay = shift.branch ? (BRANCHES[shift.branch] || shift.branch) : '';
                    
                    // Create layout based on whether it's a completed block
                    let shiftContent;
                    if (completedClass) {
                        // New layout: photo on left, details on right
                        // For attendance records, use attendance-specific time formatting
                        const timeInDisplay = shift.customStart ? 
                            formatAttendanceTime(shift.customStart, shift.type, false) : 'N/A';
                        const timeOutDisplay = shift.customEnd ? 
                            formatAttendanceTime(shift.customEnd, shift.type, true) : '';
                        
                        // Format time out with dash prefix
                        const timeOutWithDash = timeOutDisplay ? `- ${timeOutDisplay}` : '- ';
                        
                        // Check if time in is late and get severity
                        const lateStatus = isLateTimeIn(shift.type, timeInDisplay);
                        const timeInClass = lateStatus === 'red' ? 'late-red' : lateStatus === 'orange' ? 'late-orange' : '';
                        
                        // Always show photo layout for completed shifts, with placeholder if no photo
                        const photoSrc = shift.timeInPhoto || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iMjAiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iI0NDQ0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yMCAxMkMxNi42ODYzIDEyIDE0IDE0LjY4NjMgMTQgMThDMTQgMjEuMzEzNyAxNi42ODYzIDI0IDIwIDI0QzIzLjMxMzcgMjQgMjYgMjEuMzEzNyAyNiAxOEMyNiAxNC42ODYzIDIzLjMxMzcgMTIgMjAgMTJaIiBmaWxsPSIjQ0NDQ0NDIi8+CjxwYXRoIGQ9Ik0xMCAzNkMxMCAzMS41ODE3IDEzLjU4MTcgMjggMTggMjhIMjJDMjYuNDE4MyAyOCAzMCAzMS41ODE3IDMwIDM2VjM4SDEwVjM2WiIgZmlsbD0iI0NDQ0NDQyIvPgo8L3N2Zz4K';
                        const roleLabel = getShiftRoleDisplay(shift);
                        shiftContent = `
                            <div class="shift-photo-wrap">
                                <img src="${photoSrc}" class="shift-employee-photo" alt="Time In Photo" />
                                <span class="shift-role-tag">${roleLabel}</span>
                            </div>
                            <div class="shift-details-container">
                                <div class="shift-employee">${branchDisplay}</div>
                                <div class="shift-time ${timeInClass}">${timeInDisplay}</div>
                                <div class="shift-time">${timeOutWithDash}</div>
                            </div>
                        `;
                    } else {
                        // Scheduled shifts: last clock-in selfie or placeholder
                        const whitePlaceholderPhoto = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iMjAiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iI0NDQ0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yMCAxMkMxNi42ODYzIDEyIDE0IDE0LjY4NjMgMTQgMThDMTQgMjEuMzEzNyAxNi42ODYzIDI0IDIwIDI0QzIzLjMxMzcgMjQgMjYgMjEuMzEzNyAyNiAxOEMyNiAxNC42ODYzIDIzLjMxMzcgMTIgMjAgMTJaIiBmaWxsPSIjRkZGRkZGIi8+CjxwYXRoIGQ9Ik0xMCAzNkMxMCAzMS41ODE3IDEzLjU4MTcgMjggMTggMjhIMjJDMjYuNDE4MyAyOCAzMCAzMS41ODE3IDMwIDM2VjM4SDEwVjM2WiIgZmlsbD0iI0ZGRkZGRiIvPgo8L3N2Zz4K';
                        const scheduledPhotoSrc = shift.isActual
                            ? (shift.timeInPhoto || whitePlaceholderPhoto)
                            : (getEmployeeLastTimeInPhotoUrl(shift.employeeId) || whitePlaceholderPhoto);
                        const timeDisplay = getShiftTimeDisplayForScheduled(shift);
                        const roleLabel = getShiftRoleDisplay(shift);
                        shiftContent = `
                            <div class="shift-photo-wrap">
                                <img src="${scheduledPhotoSrc}" class="shift-employee-photo" alt="Last Time In Photo" />
                                <span class="shift-role-tag">${roleLabel}</span>
                            </div>
                            <div class="shift-details-container">
                                <div class="shift-employee">${branchDisplay}</div>
                                <div class="shift-time">${timeDisplay.startTime}</div>
                                <div class="shift-time">- ${timeDisplay.endTime}</div>
                            </div>
                        `;
                    }
                    
                    gridHTML += `
                            <div class="shift-employee-block ${shift.type} ${conflict ? 'shift-conflict' : ''} ${completedClass} ${shift.employeeId === 'unassigned' ? 'unassigned' : ''} ${selectedShifts.has(shift.id) ? 'selected' : ''}"
                             data-shift-id="${shift.id}">
                                ${shiftContent}
                        </div>
                    `;
                });
            } else {
                // Plus button removed
            }

            gridHTML += '</div>';
        });

        gridHTML += '</div>';
    });

    // Add empty row for adding new shifts
    gridHTML += `<div class="shift-branch-section">
        <div class="shift-branch-title">Add New Shift</div>
    </div>`;

    gridHTML += `<div class="shift-grid-row">
        <div class="shift-type-header"></div>`;

    // Add cells for each day
    weekDates.forEach(date => {
        const dateStr = formatDate(date);
        const isPastDate = date < today;
        gridHTML += `<div class="shift-cell ${isPastDate ? 'past-date' : ''}" data-date="${dateStr}" data-employee="">
        </div>`;
    });

    gridHTML += '</div>';
    gridHTML += '</div>';

    employeeSchedule.innerHTML = gridHTML;

    // Add event listeners
    document.querySelectorAll('.shift-cell').forEach(cell => {
        cell.addEventListener('click', handleEmployeeCellClick);
    });

    document.querySelectorAll('.shift-employee-block').forEach(block => {
        block.addEventListener('mousedown', handleShiftClick);
    });
}

function handleEmployeeCellClick(e) {
    e.stopPropagation();

    if (e.target.classList.contains('shift-employee-block')) {
        return; // Let shift click handler handle this
    }

    // Prevent adding shifts in read-only mode
    if (READ_ONLY_MODE) {
        return;
    }

    const cell = e.currentTarget;
    const date = cell.dataset.date;
    const employeeId = cell.dataset.employee;

    // Check if this is a past date
    const cellDate = new Date(date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (cellDate < today) {

        return; // Don't allow adding shifts to past dates
    }

    openShiftModal('add', { date, employeeId });
}

function isPastDate(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const shiftDate = new Date(dateStr + 'T00:00:00');
    return shiftDate < today;
}

// Data management functions
function getWeekDates() {
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(currentWeekStart);
        date.setDate(currentWeekStart.getDate() + i);
        // Ensure we're working with local midnight, not UTC
        date.setHours(0, 0, 0, 0);
        dates.push(date);
    }
    return dates;
}

function getFilteredBranches() {
    const filter = branchFilter.value;
    const defaults = ['podium', 'smnorth'];

    // Named pop-ups / workshops from Firestore (official event names)
    const eventKeys = allBranches
        .filter((b) => (b.type === 'popup' || b.type === 'workshop') && b.key)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((b) => b.key);

    // Named keys used this week that may not be in allBranches (archived/legacy)
    const weekExtra = [];
    for (const date of getWeekDates()) {
        const dateStr = formatDate(date);
        getAllShiftsForDay(dateStr).forEach((s) => {
            const k = s.branch;
            if (
                k &&
                !defaults.includes(k) &&
                k !== 'other' &&
                !eventKeys.includes(k) &&
                !weekExtra.includes(k)
            ) {
                // Include named events and legacy generic popup/workshop keys still on the schedule
                weekExtra.push(k);
            }
        });
    }

    let keys = [...defaults, ...eventKeys, ...weekExtra, 'other'];
    // Prefer named events over a standalone generic "popup"/"workshop" header when both exist
    keys = keys.filter((k, i) => keys.indexOf(k) === i);

    if (filter === 'all') return keys;
    if (filter === 'podium' || filter === 'smnorth' || filter === 'other') return [filter];
    if (filter === 'popup') {
        return keys.filter((k) => k === 'popup' || getBranchCategory(k) === 'popup');
    }
    if (filter === 'workshop') {
        return keys.filter((k) => k === 'workshop' || getBranchCategory(k) === 'workshop');
    }
    return [filter];
}

// Maps a specific branch key (e.g. 'popup-ayala') to its attendance-app category
function getBranchCategory(branchKey) {
    if (branchKey === 'podium') return 'podium';
    if (branchKey === 'smnorth') return 'smnorth';
    if (branchKey && branchKey.startsWith('popup')) return 'popup';
    if (branchKey && branchKey.startsWith('workshop')) return 'workshop';
    return 'other';
}

/** Whether a scheduled shift belongs in a shift-view section (named event = exact key). */
function shiftBelongsToSection(shiftBranch, sectionKey) {
    if (!sectionKey) return false;
    if (sectionKey === 'podium' || sectionKey === 'smnorth') {
        return shiftBranch === sectionKey;
    }
    if (sectionKey === 'other') {
        return shiftBranch === 'other' || getBranchCategory(shiftBranch) === 'other';
    }
    if (sectionKey === 'popup' || sectionKey === 'workshop') {
        return shiftBranch === sectionKey;
    }
    // Official named event section
    return shiftBranch === sectionKey;
}

/** Whether an attendance record belongs in a shift-view section. */
function attendanceBelongsToSection(attendanceBranch, sectionKey) {
    if (!attendanceBranch || !sectionKey) return false;
    if (sectionKey === 'podium' || sectionKey === 'smnorth' || sectionKey === 'other') {
        return getDisplayNameCategory(attendanceBranch) === sectionKey;
    }
    if (sectionKey === 'popup' || sectionKey === 'workshop') {
        return attendanceBranch === sectionKey;
    }
    const displayName = BRANCHES[sectionKey] || '';
    return (
        attendanceBranch === sectionKey ||
        (displayName && attendanceBranch === displayName)
    );
}

// Maps an attendance display-name (e.g. 'Pop-up') to its category key
function getDisplayNameCategory(displayName) {
    const key = Object.keys(BRANCHES).find(k => BRANCHES[k] === displayName);
    if (key) return getBranchCategory(key);
    const lower = (displayName || '').toLowerCase();
    if (lower === 'podium') return 'podium';
    if (lower === 'sm north' || lower === 'smnorth') return 'smnorth';
    if (lower === 'other' || lower === 'other events') return 'other';
    if (lower.includes('pop-up') || lower.includes('popup')) return 'popup';
    if (lower.includes('workshop')) return 'workshop';
    return 'other';
}

// Returns true if any scheduled shift OR actual login for the week belongs to the given category
function hasBranchCategoryThisWeek(category) {
    const weekDates = getWeekDates();
    for (const date of weekDates) {
        const dateStr = formatDate(date);

        // Check scheduled shifts
        const shifts = getAllShiftsForDay(dateStr);
        if (shifts.some(s => getBranchCategory(s.branch) === category)) return true;

        // Check actual attendance/login records
        const actual = getActualAttendanceForDate(dateStr);
        const hasLogin = Object.values(actual).some(a => a.branch && getDisplayNameCategory(a.branch) === category);
        if (hasLogin) return true;
    }
    return false;
}

function formatDate(date) {
    // Use local timezone instead of UTC to avoid date shifting
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getWeekKey() {
    return formatDate(currentWeekStart);
}

function getShiftsForDay(dateStr, branchKey) {
    const date = new Date(dateStr);
    const weekKey = getWeekKeyForDate(date);
    if (!scheduleData[weekKey] || !scheduleData[weekKey][dateStr]) {
        return [];
    }

    return scheduleData[weekKey][dateStr].filter(shift => shift.branch === branchKey);
}

function getEmployeeShiftsForDay(employeeId, dateStr) {
    const date = new Date(dateStr);
    const weekKey = getWeekKeyForDate(date);
    if (!scheduleData[weekKey] || !scheduleData[weekKey][dateStr]) {
        return [];
    }

    return scheduleData[weekKey][dateStr].filter(shift => shift.employeeId === employeeId);
}

function getWeekKeyForDate(date) {
    const weekStart = getWeekStart(date);
    return formatDate(weekStart);
}

/** Fetch pending substitution requests for current user; updates pendingSubstitutionRequests and returns the array */
async function fetchPendingSubstitutionRequests() {
    if (!currentMobileEmployeeId || !window.db) return [];
    try {
        const ref = collection(db, 'substitution_requests');
        const q = query(ref, where('employeeId', '==', currentMobileEmployeeId), where('status', '==', 'pending'));
        const snap = await getDocs(q);
        pendingSubstitutionRequests = [];
        snap.forEach(d => pendingSubstitutionRequests.push({ id: d.id, ...d.data() }));
        return pendingSubstitutionRequests;
    } catch (e) {
        console.error('fetchPendingSubstitutionRequests:', e);
        return [];
    }
}

/** True if there is a pending substitution request for this shift (same employee, date, scheduleShiftId) */
function hasPendingSubstitutionForShift(dateStr, scheduleShiftId) {
    if (!scheduleShiftId || !currentMobileEmployeeId) return false;
    return pendingSubstitutionRequests.some(
        r => r.date === dateStr && r.scheduleShiftId === scheduleShiftId && r.employeeId === currentMobileEmployeeId
    );
}

function getAllShiftsForDay(dateStr) {
    const date = new Date(dateStr);
    const weekKey = getWeekKeyForDate(date);
    const shifts = scheduleData[weekKey] && scheduleData[weekKey][dateStr] ? scheduleData[weekKey][dateStr] : [];
    
    // Filter out scheduled shifts if employee already has attendance record for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const shiftDate = new Date(dateStr + 'T00:00:00');
    
    const filteredShifts = shifts.filter(shift => {
        // If it's not today, show all shifts
        if (shiftDate.getTime() !== today.getTime()) {
            return true;
        }
        
        // If it's today, check if employee already has attendance record
        return !hasEmployeeAttendanceForDay(shift.employeeId, dateStr);
    });
    
    // Sort shifts by time in (earliest first) for proper ordering
    return filteredShifts.sort((a, b) => {
        const timeA = a.customStart || a.timeIn || '00:00';
        const timeB = b.customStart || b.timeIn || '00:00';
        
        // Convert to 24-hour format for comparison
        const minutesA = timeToMinutes(timeA);
        const minutesB = timeToMinutes(timeB);
        
        const diff = minutesA - minutesB;
        if (diff !== 0) return diff;

        // Tie-breaker: createdAt (older first), then employeeId
        const createdA = getCreatedAtTimestamp(a);
        const createdB = getCreatedAtTimestamp(b);
        if (createdA !== createdB) return createdA - createdB;

        return (a.employeeId || '').localeCompare(b.employeeId || '');
    });
}

// Helper function to check if employee has attendance record for a specific day
function hasEmployeeAttendanceForDay(employeeId, dateStr) {
    const date = new Date(dateStr);
    const weekKey = getWeekKeyForDate(date);
    
    // Check attendanceData
    if (attendanceData[weekKey] && attendanceData[weekKey][dateStr]) {
        const attendanceRecords = attendanceData[weekKey][dateStr];
        return attendanceRecords.some(record => record.employeeId === employeeId);
    }
    
    return false;
}

// Helper function to convert time string to minutes for sorting
function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    
    if (timeStr.includes('AM') || timeStr.includes('PM')) {
        // Handle 12-hour format
        const [time, period] = timeStr.split(/\s*(AM|PM)/i);
        const [hour, minute] = time.split(':').map(Number);
        
        let hour24 = hour;
        if (period.toUpperCase() === 'PM' && hour !== 12) {
            hour24 += 12;
        } else if (period.toUpperCase() === 'AM' && hour === 12) {
            hour24 = 0;
        }
        
        return hour24 * 60 + minute;
    } else {
        // Handle 24-hour format
        const [hour, minute] = timeStr.split(':').map(Number);
        return hour * 60 + minute;
    }
}

// Helper to normalize createdAt into a numeric timestamp for consistent sorting
function getCreatedAtTimestamp(shift) {
    if (!shift || !shift.createdAt) return 0;
    
    const value = shift.createdAt;
    
    try {
        // Firestore Timestamp objects have a toDate() method
        if (typeof value.toDate === 'function') {
            return value.toDate().getTime();
        }
        
        const date = new Date(value);
        const time = date.getTime();
        return Number.isNaN(time) ? 0 : time;
    } catch (e) {
        return 0;
    }
}

function categorizeShiftByTime(shift, timeIn = null) {
    // If it's a custom shift, categorize by actual time-in
    if (shift === 'custom' && timeIn) {
        const [time, meridian] = timeIn.split(' ');
        const [hours, minutes] = time.split(':').map(Number);
        let hour24 = hours;

        if (meridian === 'PM' && hours !== 12) hour24 += 12;
        if (meridian === 'AM' && hours === 12) hour24 = 0;

        const totalMinutes = hour24 * 60 + minutes;

        // Categorize based on start time
        if (totalMinutes < 11 * 60) return 'opening'; // Before 11:00 AM
        if (totalMinutes < 13 * 60) return 'midshift'; // 11:00 AM - 12:59 PM
        return 'closing'; // 1:00 PM and later
    }

    // For non-custom shifts, map to categories
    switch (shift.toLowerCase()) {
        case 'opening':
        case 'opening half-day':
        case 'adjustedopening':
        case 'adjusted opening':
            return 'opening';
        case 'midshift':
            return 'midshift';
        case 'closing':
        case 'closing half-day':
        case 'closinghalf':
            return 'closing';
        default:
            return 'midshift'; // Default fallback
    }
}

function removeDuplicateShifts() {
    let duplicatesRemoved = 0;

    Object.keys(scheduleData).forEach(weekKey => {
        Object.keys(scheduleData[weekKey]).forEach(dateStr => {
            const shifts = scheduleData[weekKey][dateStr];
            const uniqueShifts = [];
            const seen = new Map(); // Use Map to store more detailed info

            shifts.forEach((shift, index) => {
                // Create a unique key based on employee, branch, type, and times
                const shiftKey = `${shift.employeeId}-${shift.branch}-${shift.type}-${shift.customStart || ''}-${shift.customEnd || ''}`;

                if (!seen.has(shiftKey)) {
                    seen.set(shiftKey, { shift, index });
                    uniqueShifts.push(shift);
                } else {
                    const existing = seen.get(shiftKey);

                    // If we have duplicates, prefer the original recurring shift over instances
                    if (shift.recurring && !shift.isRecurringInstance && existing.shift.isRecurringInstance) {
                        // Replace the instance with the original
                        const existingIndex = uniqueShifts.findIndex(s => s.id === existing.shift.id);
                        if (existingIndex !== -1) {
                            uniqueShifts[existingIndex] = shift;
                            seen.set(shiftKey, { shift, index });
                            duplicatesRemoved++;

                        }
                    } else if (!shift.recurring || shift.isRecurringInstance) {
                        // This is a duplicate instance, remove it
                        duplicatesRemoved++;
                    } else {
                        // Keep the first one, remove this duplicate
                        duplicatesRemoved++;
                    }
                }
            });

            scheduleData[weekKey][dateStr] = uniqueShifts;

            // Clean up empty date arrays
            if (uniqueShifts.length === 0) {
                delete scheduleData[weekKey][dateStr];
            }
        });
    });

    return duplicatesRemoved;
}

function getShiftTimeDisplay(shift) {
    const fmt = (t) => (t ? convertTo12HourFormat(t) : 'N/A');
    // Actual attendance or any shift with custom times: always 12-hour
    if (shift.isActual || shift.customStart || shift.customEnd) {
        const startTime = fmt(shift.customStart);
        const endTime = shift.customEnd ? fmt(shift.customEnd) : '';
        return endTime ? `${startTime} - ${endTime}` : startTime;
    }
    // Preset shift type
    const shiftType = SHIFT_TYPES[shift.type];
    return shiftType ? shiftType.display : 'N/A';
}

// New function to get shift time display for scheduled shifts (two lines)
// Always returns 12-hour AM/PM format for consistency across shift view, employee view, calendar, mobile.
function getShiftTimeDisplayForScheduled(shift) {
    const fmt = (t) => (t ? convertTo12HourFormat(t) : 'N/A');

    // Custom shifts: format start/end to 12-hour
    if (shift.customStart && shift.customEnd) {
        return { startTime: fmt(shift.customStart), endTime: fmt(shift.customEnd) };
    }
    if (shift.type === 'custom') {
        return {
            startTime: fmt(shift.customStart),
            endTime: fmt(shift.customEnd)
        };
    }

    // Preset shift types: use display string (already 12-hour) or derive from start/end
    const shiftType = SHIFT_TYPES[shift.type];
    if (shiftType && shiftType.display) {
        const parts = shiftType.display.split(' - ');
        return {
            startTime: parts[0] ? parts[0].trim() : 'N/A',
            endTime: parts[1] ? parts[1].trim() : 'N/A'
        };
    }
    if (shiftType && shiftType.start != null && shiftType.end != null) {
        return { startTime: fmt(shiftType.start), endTime: fmt(shiftType.end) };
    }
    return { startTime: 'N/A', endTime: 'N/A' };
}

function formatTimeTo12Hour(time24) {
    if (!time24) return 'N/A';

    const [hours, minutes] = time24.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
}

// Convert 24-hour format to 12-hour format (same as admin-payroll)
function convertTo12HourFormat(timeStr) {
    if (!timeStr) return 'N/A';



    // Check if the time already has AM/PM - if so, return as is
    if (timeStr.includes('AM') || timeStr.includes('PM')) {

        return timeStr;
    }

    // If no AM/PM, assume it's 24-hour format and convert
    const [hours, minutes] = timeStr.split(':').map(Number);

    
    if (isNaN(hours) || isNaN(minutes)) {

        return 'N/A';
    }
    
    const meridian = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const result = `${displayHours}:${minutes.toString().padStart(2, '0')} ${meridian}`;
    

    return result;
}

// Function specifically for formatting attendance times with correct AM/PM
function formatAttendanceTime(timeStr, shiftType = null, isEndTime = false) {
    if (!timeStr) return 'N/A';
    

    
    // Use the same simple and correct logic as admin-payroll
    return convertTo12HourFormat(timeStr);
}

function smartFormatTime(timeStr, shiftType = null, isEndTime = false) {
    if (!timeStr) return 'N/A';
    

    
    // Use the same simple and correct logic as admin-payroll
    return convertTo12HourFormat(timeStr);
}

function hasConflict(shift, dateStr) {
    const allShifts = getAllShiftsForDay(dateStr);
    const otherShifts = allShifts.filter(s => s.id !== shift.id);

    if (otherShifts.length === 0) return false;

    const shiftStart = getShiftStartTime(shift);
    const shiftEnd = getShiftEndTime(shift);

    // console.log(`Checking conflicts for ${shift.employeeId} on ${dateStr}: ${shiftStart}-${shiftEnd}`);

    for (let otherShift of otherShifts) {
        // console.log(`  Against: ${otherShift.employeeId} ${otherShift.type}: ${getShiftStartTime(otherShift)}-${getShiftEndTime(otherShift)}`);

        // Check for exact duplicates (same employee, branch, type, times)
        if (shift.employeeId === otherShift.employeeId &&
            shift.branch === otherShift.branch &&
            shift.type === otherShift.type &&
            getShiftStartTime(shift) === getShiftStartTime(otherShift) &&
            getShiftEndTime(shift) === getShiftEndTime(otherShift)) {

            return true;
        }

        // Check for time overlaps with same employee
        if (shift.employeeId === otherShift.employeeId) {
            const otherStart = getShiftStartTime(otherShift);
            const otherEnd = getShiftEndTime(otherShift);



            // Check for overlap
            if ((shiftStart < otherEnd) && (shiftEnd > otherStart)) {

                return true;
            }
        }
    }

    // console.log('  → No conflict found');
    return false;
}

function getShiftRoleDisplay(shift) {
    if (!shift) return 'Barista';
    if (shift.role === 'custom') return (shift.customRole && shift.customRole.trim()) ? shift.customRole.trim() : 'Custom';
    if (shift.role === 'deliveries') return 'Deliveries';
    return 'Barista';
}

function getShiftStartTime(shift) {
    if (shift.type === 'custom') {
        return shift.customStart;
    } else {
        return SHIFT_TYPES[shift.type].start;
    }
}

function getShiftEndTime(shift) {
    if (shift.type === 'custom') {
        return shift.customEnd;
    } else {
        return SHIFT_TYPES[shift.type].end;
    }
}

// Event handlers
function handleCellClick(e) {
    e.stopPropagation();

    if (e.target.classList.contains('shift-item')) {
        return; // Let shift click handler handle this
    }

    const cell = e.currentTarget;
    const date = cell.dataset.date;
    const branch = cell.dataset.branch;

    // Check if this is a past date
    const cellDate = new Date(date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (cellDate < today) {

        return; // Don't allow adding shifts to past dates
    }

    openShiftModal('add', { date, branch });
}

function handleEmployeeDayClick(e) {
    e.stopPropagation();

    if (e.target.classList.contains('employee-shift')) {
        return; // Let shift click handler handle this
    }

    const day = e.currentTarget;
    const date = day.dataset.date;

    // Check if this is a past date
    const cellDate = new Date(date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (cellDate < today) {

        return; // Don't allow adding shifts to past dates
    }

    openShiftModal('add', { date, employeeId: selectedEmployee });
}

function handleShiftClick(e) {
    e.stopPropagation();
    e.preventDefault();

    const shiftId = e.currentTarget.dataset.shiftId;


    if (multiSelectMode) {
        // Prevent multi-select in read-only mode
        if (READ_ONLY_MODE) {
            return;
        }
        toggleShiftSelection(shiftId);
        return;
    }

    startSelection(e, shiftId);
}

async function handleShiftSubmit(e) {
    e.preventDefault();

    const isEdit = shiftId.value !== '';

    // Validate required fields before creating shift data
    if (!shiftDate.value) {
        alert('Please select a date for the shift.');
        return;
    }

    const resolvedBranch = resolveShiftBranchKey();
    if (!resolvedBranch) {
        if (shiftBranch?.value === LOCATION_EVENT_SENTINEL) {
            alert('Please select an event (or add a new one).');
        } else {
            alert('Please select a location for the shift.');
        }
        return;
    }
    
    if (!shiftType.value) {
        alert('Please select a shift type.');
        return;
    }

    const shiftData = {
        id: shiftId.value || generateShiftId(),
        date: shiftDate.value,
        branch: resolvedBranch,
        type: shiftType.value,
        employeeId: shiftEmployee.value || 'unassigned',
        role: (shiftRole && shiftRole.value) ? shiftRole.value : 'barista'
    };

    if (shiftType.value === 'custom') {
        shiftData.customStart = customStartTime.value;
        shiftData.customEnd = customEndTime.value;
    }
    if (shiftData.role === 'custom' && shiftRoleCustom) {
        shiftData.customRole = (shiftRoleCustom.value || '').trim() || '';
    }

    if (isEdit) {
        updateShift(shiftData);
    } else {
        addShift(shiftData);
    }

    closeModal();
    saveToLocalStorage();
    syncToFirebase();
    renderCurrentView();
}

function handleShiftTypeChange() {
    const isCustom = shiftType.value === 'custom';
    customTimeGroup.style.display = isCustom ? 'block' : 'none';
}

function handleShiftRoleChange() {
    if (!customRoleGroup) return;
    customRoleGroup.style.display = shiftRole && shiftRole.value === 'custom' ? 'block' : 'none';
}

async function handleShiftDelete() {
    const id = shiftId.value;
    if (!id) return;

    if (confirm('Are you sure you want to delete this shift?')) {
        await deleteShift(id);
        closeModal();
        saveToLocalStorage();
        // Don't call syncToFirebase() here since deleteShift already handles Firebase
        renderCurrentView();
    }
}

// Modal management
async function openShiftModal(mode, data) {

    modalTitle.textContent = mode === 'add' ? 'Add Shift' : mode === 'attendance' ? 'Attendance Record' : mode === 'view' ? 'View Shift Details' : 'Edit Shift';
    deleteShiftBtn.style.display = mode === 'edit' ? 'block' : 'none';

    // Reset form
    shiftForm.reset();
    customTimeGroup.style.display = 'none';
    if (shiftRole) shiftRole.value = 'barista';
    if (shiftRoleCustom) shiftRoleCustom.value = '';
    
    // Handle attendance mode (read-only)
    if (mode === 'attendance') {
        // Disable all form fields for read-only mode
        shiftDate.disabled = true;
        shiftBranch.disabled = true;
        if (shiftEvent) shiftEvent.disabled = true;
        shiftType.disabled = true;
        shiftEmployee.disabled = true;
        customStartTime.disabled = true;
        customEndTime.disabled = true;
        if (shiftRole) shiftRole.disabled = true;
        if (shiftRoleCustom) shiftRoleCustom.disabled = true;
        
        // Make disabled fields more visible
        shiftDate.style.backgroundColor = '#f8f9fa';
        shiftDate.style.color = '#333';
        shiftDate.style.borderColor = '#dee2e6';
        shiftBranch.style.backgroundColor = '#f8f9fa';
        shiftBranch.style.color = '#333';
        shiftBranch.style.borderColor = '#dee2e6';
        if (shiftEvent) {
            shiftEvent.style.backgroundColor = '#f8f9fa';
            shiftEvent.style.color = '#333';
            shiftEvent.style.borderColor = '#dee2e6';
        }
        shiftType.style.backgroundColor = '#f8f9fa';
        shiftType.style.color = '#333';
        shiftType.style.borderColor = '#dee2e6';
        shiftEmployee.style.backgroundColor = '#f8f9fa';
        shiftEmployee.style.color = '#333';
        shiftEmployee.style.borderColor = '#dee2e6';
        if (shiftRole) shiftRole.style.backgroundColor = '#f8f9fa';
        if (shiftRoleCustom) shiftRoleCustom.style.backgroundColor = '#f8f9fa';
        
        // Hide form actions for attendance
        document.querySelector('.form-actions').style.display = 'none';
        
        // Add close button for attendance
        addAttendanceCloseButton();
        
        // Add attendance info display
        await showAttendanceInfo(data);
    } else if (mode === 'view') {
        // Handle view mode (read-only for scheduled shifts)
        // Disable all form fields for read-only mode
        shiftDate.disabled = true;
        shiftBranch.disabled = true;
        if (shiftEvent) shiftEvent.disabled = true;
        shiftType.disabled = true;
        shiftEmployee.disabled = true;
        customStartTime.disabled = true;
        customEndTime.disabled = true;
        if (shiftRole) shiftRole.disabled = true;
        if (shiftRoleCustom) shiftRoleCustom.disabled = true;
        
        // Make disabled fields more visible
        shiftDate.style.backgroundColor = '#f8f9fa';
        shiftDate.style.color = '#333';
        shiftDate.style.borderColor = '#dee2e6';
        shiftBranch.style.backgroundColor = '#f8f9fa';
        shiftBranch.style.color = '#333';
        shiftBranch.style.borderColor = '#dee2e6';
        if (shiftEvent) {
            shiftEvent.style.backgroundColor = '#f8f9fa';
            shiftEvent.style.color = '#333';
            shiftEvent.style.borderColor = '#dee2e6';
        }
        shiftType.style.backgroundColor = '#f8f9fa';
        shiftType.style.color = '#333';
        shiftType.style.borderColor = '#dee2e6';
        shiftEmployee.style.backgroundColor = '#f8f9fa';
        shiftEmployee.style.color = '#333';
        shiftEmployee.style.borderColor = '#dee2e6';
        if (shiftRole) shiftRole.style.backgroundColor = '#f8f9fa';
        if (shiftRoleCustom) shiftRoleCustom.style.backgroundColor = '#f8f9fa';
        
        // Hide form actions for view mode
        document.querySelector('.form-actions').style.display = 'none';
        
        // Add close button for view mode
        addAttendanceCloseButton();
        
        // Load and display shift data
        await loadShiftDataForView(data);
    } else {
        // Enable all form fields for add/edit mode
        shiftDate.disabled = false;
        shiftBranch.disabled = false;
        if (shiftEvent) {
            shiftEvent.disabled = false;
            shiftEvent.style.backgroundColor = '';
            shiftEvent.style.color = '';
            shiftEvent.style.borderColor = '';
        }
        shiftType.disabled = false;
        shiftEmployee.disabled = false;
        customStartTime.disabled = false;
        customEndTime.disabled = false;
        if (shiftRole) shiftRole.disabled = false;
        if (shiftRoleCustom) shiftRoleCustom.disabled = false;
        
        // Show form actions for add/edit
        document.querySelector('.form-actions').style.display = 'flex';
    }

    if (mode === 'add') {
        shiftId.value = '';
        originalDate.value = data.date;
        originalBranch.value = data.branch || '';
        shiftDate.value = data.date;

        // Pre-Select location and shift type if provided
        applyLocationFromBranchKey(data.branch || '');
        if (data.shiftType === 'deliveries' || data.shiftType === 'custom') {
            if (shiftRole) shiftRole.value = data.shiftType;
            handleShiftRoleChange();
        } else if (data.shiftType) {
            shiftType.value = data.shiftType;
        }

        if (data.employeeId) {
            shiftEmployee.value = data.employeeId;
        }
    } else if (mode === 'edit' || mode === 'view') {
        // Edit / view mode — load scheduled shift
        let shift = findShiftById(data.shiftId);

        if (shift) {

            shiftId.value = shift.id;
            originalDate.value = shift.date;
            originalBranch.value = shift.branch;
            shiftDate.value = shift.date;
            applyLocationFromBranchKey(shift.branch);
            shiftType.value = shift.type;
            shiftEmployee.value = shift.employeeId;
            if (shiftRole) shiftRole.value = shift.role || 'barista';
            if (shiftRoleCustom) shiftRoleCustom.value = shift.customRole || '';
            handleShiftRoleChange();




            if (shift.type === 'custom') {
                customTimeGroup.style.display = 'block';
                customStartTime.value = shift.customStart;
                customEndTime.value = shift.customEnd;
            }
        }
    }

    if (mode === 'add' || mode === 'edit') {
        populateEmployeeDropdownForDate(shiftDate.value);
    }

    shiftModal.style.display = 'flex';
}

// Function to load shift data for view mode
async function loadShiftDataForView(data) {
    if (!data.shiftId) return;
    
    try {
        // Find the shift data
        const shift = findShiftById(data.shiftId);
        if (!shift) {

            return;
        }
        
        // Populate form fields with shift data
        shiftDate.value = shift.date;
        applyLocationFromBranchKey(shift.branch);
        shiftType.value = shift.shiftType || shift.type;
        shiftEmployee.value = shift.employeeId;
        if (shiftRole) shiftRole.value = shift.role || 'barista';
        if (shiftRoleCustom) shiftRoleCustom.value = shift.customRole || '';
        handleShiftRoleChange();
        
        // Handle custom time
        if ((shift.shiftType || shift.type) === 'custom') {
            customTimeGroup.style.display = 'block';
            customStartTime.value = shift.startTime || shift.customStart || '';
            customEndTime.value = shift.endTime || shift.customEnd || '';
        }
        
        // Set hidden fields
        shiftId.value = data.shiftId;
        originalDate.value = shift.date;
        originalBranch.value = shift.branch;
        

    } catch (error) {

    }
}

async function showAttendanceInfo(data) {
    // Extract employee ID and date from shift ID
    let shiftDateStr = null;
    let employeeId = null;
    if (data.shiftId && data.shiftId.includes('_')) {
        const parts = data.shiftId.split('_');
        if (parts.length >= 3) {
            employeeId = parts[1]; // Second part is employee ID
            shiftDateStr = parts[parts.length - 1]; // Last part is the date
        }
    }
    
    // Hide the date field for attendance records to avoid duplication
    const dateFieldGroup = document.querySelector('.form-group:has(#shiftDate)');
    if (dateFieldGroup) {
        dateFieldGroup.style.display = 'none';
    }
    
    // Use the shift data that's already available instead of fetching from Firebase
    if (data.shiftData) {







        
        // Populate form with the shift data we already have
        shiftId.value = data.shiftId;
        shiftDate.value = shiftDateStr || data.shiftData.date;
        applyLocationFromBranchKey(data.shiftData.branch || '');
        shiftType.value = data.shiftData.type || data.shiftData.shift || '';
        shiftEmployee.value = employeeId || data.shiftData.employeeId || '';
        
        // Add attendance display with the existing shift data
        addAttendanceTimeDisplay(data.shiftData, shiftDateStr || data.shiftData.date);
    } else {
        // Fallback: try to load from Firebase if no shift data provided
        try {
            const attendanceRecord = await loadAttendanceDataFromFirebase(employeeId, shiftDateStr);
            
            if (attendanceRecord) {
                // Populate form with Firebase data
                shiftId.value = data.shiftId;
                shiftDate.value = shiftDateStr;
                applyLocationFromBranchKey(attendanceRecord.branch || '');
                shiftType.value = attendanceRecord.shift || '';
                shiftEmployee.value = employeeId;
                
                // Add attendance display with Firebase data
                addAttendanceTimeDisplay(attendanceRecord, shiftDateStr);
            } else {
                // Fallback if no Firebase data
                shiftId.value = data.shiftId;
                shiftDate.value = shiftDateStr;
                applyLocationFromBranchKey('');
                shiftType.value = '';
                shiftEmployee.value = employeeId || '';
                
                addBasicAttendanceDisplay(data.shiftId, shiftDateStr);
            }
        } catch (error) {

            // Fallback
            shiftId.value = data.shiftId;
            shiftDate.value = shiftDateStr;
            applyLocationFromBranchKey('');
            shiftType.value = '';
            shiftEmployee.value = employeeId || '';
            
            addBasicAttendanceDisplay(data.shiftId, shiftDateStr);
        }
    }
    
    // Hide custom time fields for attendance records
    customTimeGroup.style.display = 'none';
}

function addBasicAttendanceDisplay(shiftId, dateStr) {
    // Remove any existing attendance info
    const existingInfo = document.getElementById('attendanceInfo');
    if (existingInfo) {
        existingInfo.remove();
    }
    
    // Create basic attendance info display
    const attendanceInfo = document.createElement('div');
    attendanceInfo.id = 'attendanceInfo';
    attendanceInfo.style.cssText = `
        margin-bottom: 1rem;
        text-align: center;
        padding: 1rem;
    `;
    
    attendanceInfo.innerHTML = `
        <div style="color: #2b9348; font-weight: bold; margin-bottom: 0.5rem;">Attendance Record</div>
        <div style="color: #666; font-size: 0.9rem;">Date: ${dateStr || 'Unknown'}</div>
    `;
    
    // Insert before the form (at the top)
    shiftForm.parentNode.insertBefore(attendanceInfo, shiftForm);
}


function addAttendanceTimeDisplay(shift, dateStr) {
    // Remove any existing attendance info
    const existingInfo = document.getElementById('attendanceInfo');
    if (existingInfo) {
        existingInfo.remove();
    }
    
    // Create attendance info display - centered, no card styling
    const attendanceInfo = document.createElement('div');
    attendanceInfo.id = 'attendanceInfo';
    attendanceInfo.style.cssText = `
        margin-bottom: 1rem;
        text-align: center;
        padding: 1rem;
    `;
    
    // Format the date properly
    const formattedDate = dateStr ? new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }) : 'Unknown Date';
    
    // Check if this is current day
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const shiftDate = new Date(dateStr + 'T00:00:00');
    const isCurrentDay = shiftDate.getTime() === today.getTime();
    
    // Use the correct property names from attendance data









    
    const timeInDisplay = (shift.timeIn || shift.customStart) ? formatAttendanceTime(shift.timeIn || shift.customStart, shift.type, false) : 'N/A';
    

    
    // For time out, only show if there's actual data AND it's not current day
    // Current day should not show time out unless there's actual time out data
    const hasTimeOutData = (shift.timeOut || shift.customEnd) && 
                          (shift.timeOut || shift.customEnd).trim() !== '' && 
                          (shift.timeOut || shift.customEnd) !== 'null' &&
                          (shift.timeOut || shift.customEnd) !== 'undefined';
    
    const timeOutDisplay = hasTimeOutData ? formatAttendanceTime(shift.timeOut || shift.customEnd, shift.type, true) : null;
    


    
    // Check if time in is late and get severity
    const lateStatus = isLateTimeIn(shift.type || shift.shift, timeInDisplay);
    const timeInStyle = lateStatus === 'red' ? 'color: #dc3545; font-weight: 600;' : 
                       lateStatus === 'orange' ? 'color: #fd7e14; font-weight: 600;' : '';
    
    // Create photo placeholders




    
    const timeInPhotoSrc = shift.timeInPhoto || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiByeD0iMzAiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iI0NDQ0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0zMCAxOEMyNS4wMjg5IDE4IDIxIDIyLjAyODkgMjEgMjdDMjEgMzEuOTcxMSAyNS4wMjg5IDM2IDMwIDM2QzM0Ljk3MTEgMzYgMzkgMzEuOTcxMSAzOSAyN0MzOSAyMi4wMjg5IDM0Ljk3MTEgMTggMzAgMThaIiBmaWxsPSIjQ0NDQ0NDIi8+CjxwYXRoIGQ9Ik0xNSA1NEMxNSA0Ny4zNzI2IDIwLjM3MjYgNDIgMjcgNDJIMzNDMzkuNjI3NCA0MiA0NSA0Ny4zNzI2IDQ1IDU0VjU3SDE1VjU0WiIgZmlsbD0iI0NDQ0NDQyIvPgo8L3N2Zz4K';
    const timeOutPhotoSrc = shift.timeOutPhoto || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiByeD0iMzAiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iI0NDQ0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0zMCAxOEMyNS4wMjg5IDE4IDIxIDIyLjAyODkgMjEgMjdDMjEgMzEuOTcxMSAyNS4wMjg5IDM2IDMwIDM2QzM0Ljk3MTEgMzYgMzkgMzEuOTcxMSAzOSAyN0MzOSAyMi4wMjg5IDM0Ljk3MTEgMTggMzAgMThaIiBmaWxsPSIjQ0NDQ0NDIi8+CjxwYXRoIGQ9Ik0xNSA1NEMxNSA0Ny4zNzI2IDIwLjM3MjYgNDIgMjcgNDJIMzNDMzkuNjI3NCA0MiA0NSA0Ny4zNzI2IDQ1IDU0VjU3SDE1VjU0WiIgZmlsbD0iI0NDQ0NDQyIvPgo8L3N2Zz4K';
    


    
    // Create the HTML based on whether there's time out data
    let timeOutSection = '';
    if (timeOutDisplay) {
        timeOutSection = `
            <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                <img src="${timeOutPhotoSrc}" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover; border: 2px solid #2b9348; cursor: pointer;" alt="Time Out Photo" onclick="expandPhoto('${timeOutPhotoSrc}', 'Time Out - ${timeOutDisplay}')" />
                <div style="text-align: center;">
                    <div style="font-weight: bold; color: #2b9348;">Time Out</div>
                    <div>${timeOutDisplay}</div>
                </div>
            </div>
        `;
    }
    
    // Determine the layout - center if no time out, side by side if both
    const layoutStyle = timeOutDisplay ? 
        'display: flex; gap: 2rem; align-items: center; justify-content: center;' : 
        'display: flex; align-items: center; justify-content: center;';
    
    attendanceInfo.innerHTML = `
        <div style="color: #666; font-size: 0.9rem; margin-bottom: 1rem;">${formattedDate}</div>
        <div style="${layoutStyle}">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                <img src="${timeInPhotoSrc}" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover; border: 2px solid #2b9348; cursor: pointer;" alt="Time In Photo" onclick="expandPhoto('${timeInPhotoSrc}', 'Time In - ${timeInDisplay}')" />
                <div style="text-align: center;">
                    <div style="font-weight: bold; color: #2b9348;">Time In</div>
                    <div style="${timeInStyle}">${timeInDisplay}</div>
                </div>
            </div>
            ${timeOutSection}
        </div>
    `;
    
    // Insert before the form (at the top)
    shiftForm.parentNode.insertBefore(attendanceInfo, shiftForm);
}

function addAttendanceCloseButton() {
    // Remove any existing close button
    const existingCloseBtn = document.getElementById('attendanceCloseBtn');
    if (existingCloseBtn) {
        existingCloseBtn.remove();
    }
    
    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.id = 'attendanceCloseBtn';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.className = 'cancel-btn';
    closeBtn.style.cssText = 'margin-top: 1rem; width: 100%;';
    closeBtn.addEventListener('click', closeModal);
    
    // Insert after the attendance info
    const attendanceInfo = document.getElementById('attendanceInfo');
    if (attendanceInfo) {
        attendanceInfo.parentNode.insertBefore(closeBtn, attendanceInfo.nextSibling);
    }
}

function findAnyShiftById(shiftId) {

    
    // Debug: Show what data structures we have


    
    // For actual attendance shifts, prioritize attendanceData (has photo data)
    if (shiftId && shiftId.startsWith('actual_')) {

        
        // Search through attendanceData first for actual shifts
        for (let weekKey in attendanceData) {

            for (let dateStr in attendanceData[weekKey]) {
                const shifts = attendanceData[weekKey][dateStr];

                
                // Check if any shift has the exact ID we're looking for
                const shift = shifts.find(s => s.id === shiftId);
                if (shift) {

                    return shift;
                }
            }
        }
    }
    
    // Search through ALL weeks for a shift with this ID in scheduleData
    for (let weekKey in scheduleData) {

        for (let dateStr in scheduleData[weekKey]) {
            const shifts = scheduleData[weekKey][dateStr];

            
            // Check if any shift has the exact ID we're looking for
            const shift = shifts.find(s => s.id === shiftId);
            if (shift) {

                return shift;
            }
        }
    }
    
    // Search through attendanceData as well (fallback for non-actual shifts)
    for (let weekKey in attendanceData) {

        for (let dateStr in attendanceData[weekKey]) {
            const shifts = attendanceData[weekKey][dateStr];

            
            // Check if any shift has the exact ID we're looking for
            const shift = shifts.find(s => s.id === shiftId);
            if (shift) {

                return shift;
            }
        }
    }
    
    // If not found with exact match, try partial matching as fallback

    const shiftIdParts = shiftId.split('_');
    if (shiftIdParts.length >= 3) {
        const employeeId = shiftIdParts[1];
        const dateStr = shiftIdParts[2];
        
        // Search in attendanceData for partial match
        for (let weekKey in attendanceData) {
            for (let dateStrKey in attendanceData[weekKey]) {
                const shifts = attendanceData[weekKey][dateStrKey];
                const partialMatch = shifts.find(s => s.id && s.id.includes(employeeId) && s.id.includes(dateStr));
                if (partialMatch) {

                    return partialMatch;
                }
            }
        }
        
        // Search in scheduleData for partial match
        for (let weekKey in scheduleData) {
            for (let dateStrKey in scheduleData[weekKey]) {
                const shifts = scheduleData[weekKey][dateStrKey];
                const partialMatch = shifts.find(s => s.id && s.id.includes(employeeId) && s.id.includes(dateStr));
                if (partialMatch) {

                    return partialMatch;
                }
            }
        }
        
        // TEMPORARY FIX: Search in the malformed attendanceData structure

        if (attendanceData['NaN-NaN-NaN'] && attendanceData['NaN-NaN-NaN']['undefined']) {
            const shifts = attendanceData['NaN-NaN-NaN']['undefined'];

            
            // First try exact match
            const exactMatch = shifts.find(s => s.id === shiftId);
            if (exactMatch) {

                return exactMatch;
            }
            
            // If no exact match, try to find by employee ID (since dates might be wrong)
            const employeeId = shiftIdParts[1];
            const employeeMatch = shifts.find(s => s.id && s.id.includes(employeeId));
            if (employeeMatch) {

                // Create a corrected version with the right ID
                const correctedShift = { ...employeeMatch, id: shiftId };

                return correctedShift;
            }
        }
    }
    
    // If not found in scheduleData or attendanceData, check if it's in localStorage or other storage
    try {
        const cachedData = localStorage.getItem('schedule-cache');
        if (cachedData) {
            const parsedData = JSON.parse(cachedData);
            // Search through cached data too
            for (let weekKey in parsedData) {
                for (let dateStr in parsedData[weekKey]) {
                    const shifts = parsedData[weekKey][dateStr];
                    const shift = shifts.find(s => s.id === shiftId);
                    if (shift) {

                        return shift;
                    }
                }
            }
        }
    } catch (e) {
    }
    

    return null;
}

// Make expandPhoto globally accessible
window.expandPhoto = function(photoSrc, title) {
    // Create photo modal overlay
    const photoModal = document.createElement('div');
    photoModal.id = 'photoModal';
    photoModal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        cursor: pointer;
    `;
    
    // Create photo container
    const photoContainer = document.createElement('div');
    photoContainer.style.cssText = `
        max-width: 90%;
        max-height: 90%;
        position: relative;
        background: white;
        border-radius: 8px;
        padding: 1rem;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;
    
    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = `
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        background: #dc3545;
        color: white;
        border: none;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        font-size: 18px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    
    // Create title
    const titleElement = document.createElement('div');
    titleElement.textContent = title;
    titleElement.style.cssText = `
        font-weight: bold;
        margin-bottom: 1rem;
        color: #2b9348;
        text-align: center;
    `;
    
    // Create photo
    const photo = document.createElement('img');
    photo.src = photoSrc;
    photo.style.cssText = `
        max-width: 100%;
        max-height: 70vh;
        border-radius: 4px;
        display: block;
        margin: 0 auto;
    `;
    
    // Assemble modal
    photoContainer.appendChild(closeBtn);
    photoContainer.appendChild(titleElement);
    photoContainer.appendChild(photo);
    photoModal.appendChild(photoContainer);
    document.body.appendChild(photoModal);
    
    // Close modal functions
    const closeModal = () => {
        document.body.removeChild(photoModal);
    };
    
    closeBtn.addEventListener('click', closeModal);
    photoModal.addEventListener('click', (e) => {
        if (e.target === photoModal) {
            closeModal();
        }
    });
    
    // Close on escape key
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
};

function closeModal() {
    // Clean up attendance-specific elements
    const attendanceInfo = document.getElementById('attendanceInfo');
    if (attendanceInfo) {
        attendanceInfo.remove();
    }
    
    const attendanceCloseBtn = document.getElementById('attendanceCloseBtn');
    if (attendanceCloseBtn) {
        attendanceCloseBtn.remove();
    }
    
    // Reset form fields to enabled state
    shiftDate.disabled = false;
    shiftBranch.disabled = false;
    shiftType.disabled = false;
    shiftEmployee.disabled = false;
    customStartTime.disabled = false;
    customEndTime.disabled = false;
    if (shiftRole) shiftRole.disabled = false;
    if (shiftRoleCustom) shiftRoleCustom.disabled = false;
    
    // Reset form field styles
    shiftDate.style.backgroundColor = '';
    shiftDate.style.color = '';
    shiftDate.style.borderColor = '';
    shiftBranch.style.backgroundColor = '';
    shiftBranch.style.color = '';
    shiftBranch.style.borderColor = '';
    shiftType.style.backgroundColor = '';
    shiftType.style.color = '';
    shiftType.style.borderColor = '';
    shiftEmployee.style.backgroundColor = '';
    shiftEmployee.style.color = '';
    shiftEmployee.style.borderColor = '';
    if (shiftRole) shiftRole.style.backgroundColor = '';
    if (shiftRoleCustom) shiftRoleCustom.style.backgroundColor = '';
    
    // Show form actions
    document.querySelector('.form-actions').style.display = 'flex';
    
    shiftModal.style.display = 'none';
}

function addShift(shiftData) {
    const weekKey = getWeekKey();
    const dateStr = shiftData.date;

    if (!scheduleData[weekKey]) {
        scheduleData[weekKey] = {};
    }

    if (!scheduleData[weekKey][dateStr]) {
        scheduleData[weekKey][dateStr] = [];
    }

    // Ensure createdAt exists so we can use it for stable manual ordering
    if (!shiftData.createdAt) {
        shiftData.createdAt = new Date().toISOString();
    }

    scheduleData[weekKey][dateStr].push(shiftData);

    markLocalChanges();
}

function updateShift(shiftData) {
    const found = findShiftByIdAndLocation(shiftData.id);
    if (!found) return;

    const { shift, weekKey: oldWeekKey, dateStr: oldDateStr } = found;

    // Preserve createdAt for stable manual ordering
    const existingCreatedAt = shift.createdAt;
    Object.assign(shift, shiftData);
    if (existingCreatedAt && !shift.createdAt) {
        shift.createdAt = existingCreatedAt;
    }

    const newDateStr = shift.date;
    const newWeekKey = getWeekKeyForDate(new Date(newDateStr + 'T00:00:00'));

    // If date changed, move shift from old location to new
    if (oldDateStr !== newDateStr || oldWeekKey !== newWeekKey) {
        const oldArray = scheduleData[oldWeekKey][oldDateStr];
        const idx = oldArray.findIndex(s => s.id === shiftData.id);
        if (idx !== -1) oldArray.splice(idx, 1);
        if (oldArray.length === 0) delete scheduleData[oldWeekKey][oldDateStr];

        if (!scheduleData[newWeekKey]) scheduleData[newWeekKey] = {};
        if (!scheduleData[newWeekKey][newDateStr]) scheduleData[newWeekKey][newDateStr] = [];
        scheduleData[newWeekKey][newDateStr].push(shift);
    }

    markLocalChanges();
}

async function deleteShift(shiftId) {
    isDeletingShifts = true;
    let deletedAny = false;
    let deletedShifts = [];

    // Delete from ALL weeks in local data
    Object.keys(scheduleData).forEach(wKey => {
        Object.keys(scheduleData[wKey]).forEach(dateStr => {
            const shifts = scheduleData[wKey][dateStr];
            for (let i = shifts.length - 1; i >= 0; i--) {
                if (shifts[i].id === shiftId) {
                    deletedShifts.push({ weekKey: wKey, shift: shifts[i] });
                    shifts.splice(i, 1);
                    deletedAny = true;
                }
            }
            if (shifts.length === 0) {
                delete scheduleData[wKey][dateStr];
            }
        });
    });

    if (deletedAny) {
        markLocalChanges();

        // Immediately delete from Firebase
        for (const deletion of deletedShifts) {
            try {
                const shiftRef = doc(db, "schedules", deletion.weekKey, "shifts", shiftId);
                await deleteDoc(shiftRef);

            } catch (error) {

            }
        }
    }
    
    // Reset the flag after a short delay
    setTimeout(() => {
        isDeletingShifts = false;
    }, 1000);
}

function findShiftById(shiftId) {
    const found = findShiftByIdAndLocation(shiftId);
    return found ? found.shift : null;
}

// Find shift by id in any week; returns { shift, weekKey, dateStr } or null
function findShiftByIdAndLocation(shiftId) {
    for (const weekKey of Object.keys(scheduleData)) {
        const weekData = scheduleData[weekKey] || {};
        for (const dateStr of Object.keys(weekData)) {
            const shift = weekData[dateStr].find(s => s.id === shiftId);
            if (shift) return { shift, weekKey, dateStr };
        }
    }
    return null;
}

function getWeekStart(date) {
    const dayOfWeek = date.getDay();
    const monday = new Date(date);
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    monday.setDate(date.getDate() - daysToSubtract);
    monday.setHours(0, 0, 0, 0);
    return monday;
}

function generateShiftId() {
    return 'shift_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Local storage management
function saveToLocalStorage() {
    try {
        localStorage.setItem('matchanese_schedules', JSON.stringify(scheduleData));
    } catch (error) {

    }
}

function loadFromLocalStorage() {
    try {
        const stored = localStorage.getItem('matchanese_schedules');
        if (stored) {
            scheduleData = JSON.parse(stored);
            // Clean up any invalid shifts that might have undefined date fields
            cleanupInvalidShifts();
        }
    } catch (error) {

        scheduleData = {};
    }
}

function markLocalChanges() {
    localChanges = true;
    updateSyncStatus('local');
}

function updateSyncStatus(status) {
    if (!syncStatus) return; // Exit if syncStatus element doesn't exist
    const indicator = syncStatus.querySelector('.sync-indicator');

    switch (status) {
        case 'local':
            indicator.textContent = '💾 Saved locally';
            indicator.className = 'sync-indicator local';
            break;
        case 'syncing':
            indicator.textContent = '🔄 Syncing...';
            indicator.className = 'sync-indicator syncing';
            break;
        case 'synced':
            indicator.textContent = '☁️ Synced';
            indicator.className = 'sync-indicator synced';
            localChanges = false;
            break;
    }
}

function updateAttendanceModeIndicator() {
    const indicator = document.getElementById('attendanceModeIndicator');
    if (!indicator) return;
    
    // Always show auto mode since we removed the toggle
    indicator.textContent = '🔄 Auto Mode';
    indicator.style.backgroundColor = '#e3f2fd';
    indicator.style.color = '#1976d2';
}

async function loadScheduleData() {
    
    // Load from local storage first for instant display
    loadFromLocalStorage();
    renderCurrentView();

    // Don't sync from Firebase if we're in the middle of deleting
    if (isDeletingShifts) {
        return;
    }

    // Then sync from Firebase in background and update
    try {
        await syncFromFirebase();
        renderCurrentView(); // Re-render with updated data
        refreshEmployeeLastTimeInPhotosInBackground(getEmployeeIdsInLoadedSchedule());
    } catch (error) {

        updateSyncStatus('local');
    }
}

function getEmployeeIdsInLoadedSchedule() {
    const ids = new Set();
    Object.values(scheduleData).forEach((week) => {
        Object.values(week).forEach((shifts) => {
            shifts.forEach((shift) => {
                if (shift.employeeId && shift.employeeId !== 'unassigned') {
                    ids.add(shift.employeeId);
                }
            });
        });
    });
    return [...ids];
}

async function syncFromFirebase() {
    try {
        updateSyncStatus('syncing');

        // Get data for multiple weeks, not just current
        const weekKeys = [];
        const currentWeek = new Date(currentWeekStart);

        // Get current week + previous 2 weeks + next 2 weeks
        for (let i = -2; i <= 2; i++) {
            const targetWeek = new Date(currentWeek);
            targetWeek.setDate(currentWeek.getDate() + (i * 7));
            weekKeys.push(formatDate(targetWeek));
        }


        for (const weekKey of weekKeys) {
            const schedulesRef = collection(db, "schedules", weekKey, "shifts");
            const snapshot = await getDocs(schedulesRef);

            if (snapshot.size > 0) {
                if (!scheduleData[weekKey]) scheduleData[weekKey] = {};

                snapshot.forEach(doc => {
                    const shift = { id: doc.id, ...doc.data() };
                    const dateStr = shift.date;

                    // ONLY store scheduled shifts in scheduleData, NOT actual attendance
                    if (shift.id && shift.id.startsWith('actual_')) {

                        return; // Skip actual attendance shifts
                    }

                    if (!scheduleData[weekKey][dateStr]) {
                        scheduleData[weekKey][dateStr] = [];
                    }

                    // Only add if shift doesn't already exist locally
                    const existingIndex = scheduleData[weekKey][dateStr].findIndex(s => s.id === shift.id);
                    if (existingIndex !== -1) {
                        // Update existing shift
                        scheduleData[weekKey][dateStr][existingIndex] = shift;
                    } else {
                        // Add new shift
                        scheduleData[weekKey][dateStr].push(shift);
                    }
                });
            }
        }

        // Save to localStorage after syncing from Firebase
        saveToLocalStorage();

        // Clean up any duplicates and save
        cleanupAfterSync();
        updateSyncStatus('synced');

    } catch (error) {

        updateSyncStatus('local');
        throw error;
    }
}

function cleanupAfterSync() {
    removeDuplicateShifts();
    saveToLocalStorage();
}

function cleanupInvalidShifts() {
    let hasInvalidShifts = false;
    
    // Check all weeks for invalid shifts
    for (const weekKey in scheduleData) {
        const weekData = scheduleData[weekKey];
        for (const dateStr in weekData) {
            const shifts = weekData[dateStr];
            const validShifts = [];
            
            for (const shift of shifts) {
                const validatedShift = validateAndFixShiftData(shift, dateStr);
                if (validatedShift) {
                    validShifts.push(validatedShift);
                } else {
                    hasInvalidShifts = true;

                }
            }
            
            weekData[dateStr] = validShifts;
        }
    }
    
    if (hasInvalidShifts) {

        saveToLocalStorage();
    }
}

function validateAndFixShiftData(shift, fallbackDateStr) {
    // Create a copy of the shift to avoid modifying the original
    const validatedShift = { ...shift };
    
    // Fix missing or undefined date field
    if (!validatedShift.date || validatedShift.date === undefined) {
        if (fallbackDateStr) {
            validatedShift.date = fallbackDateStr;

        } else if (validatedShift.id && validatedShift.id.includes('_')) {
            // Try to extract date from shift ID (format: actual_131129_2025-09-09)
            const parts = validatedShift.id.split('_');
            if (parts.length >= 3) {
                const extractedDate = parts[parts.length - 1];
                if (extractedDate && extractedDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    validatedShift.date = extractedDate;

                }
            }
        }
    }
    
    // Validate required fields
    if (!validatedShift.id || !validatedShift.date || !validatedShift.branch || !validatedShift.type || !validatedShift.employeeId) {
        console.error('Invalid shift data - missing required fields:', {
            id: validatedShift.id,
            date: validatedShift.date,
            branch: validatedShift.branch,
            type: validatedShift.type,
            employeeId: validatedShift.employeeId
        });
        return null;
    }
    
    // Ensure date is in correct format (YYYY-MM-DD)
    if (validatedShift.date && !validatedShift.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        try {
            const date = new Date(validatedShift.date);
            if (!isNaN(date.getTime())) {
                validatedShift.date = formatDate(date);

            }
        } catch (error) {

            return null;
        }
    }

    // Default role to barista if missing (backfill for existing shifts)
    if (!validatedShift.role) validatedShift.role = 'barista';
    if (validatedShift.role === 'custom' && validatedShift.customRole === undefined) validatedShift.customRole = '';

    return validatedShift;
}

async function forceSyncToFirebase() {

    // Force sync regardless of localChanges flag
    await syncToFirebaseInternal(true);
}

async function syncToFirebase() {
    if (!localChanges) {

        return;
    }
    await syncToFirebaseInternal(false);
}

async function syncToFirebaseInternal(forceSync = false) {
    if (!forceSync && !localChanges) {

        return;
    }






    try {
        updateSyncStatus('syncing');

        // Sync ALL weeks that have local data, not just current week
        const allWeeks = Object.keys(scheduleData);


        let totalShiftsSynced = 0;
        let totalShiftsSkipped = 0;

        for (const weekKey of allWeeks) {
            const weekData = scheduleData[weekKey] || {};


            // Upload each shift for this week
            for (let dateStr in weekData) {
                const shifts = weekData[dateStr];


                for (let shift of shifts) {
                    // ONLY sync scheduled shifts to Firebase, NOT actual attendance
                    if (shift.id && shift.id.startsWith('actual_')) {

                        totalShiftsSkipped++;
                        continue;
                    }

                    // Validate and fix shift data before syncing
                    const validatedShift = validateAndFixShiftData(shift, dateStr);
                    
                    if (!validatedShift) {

                        totalShiftsSkipped++;
                        continue;
                    }

                    // Preserve createdAt so manual delete/re-add controls display order.
                    // (Previously this was overwritten on every sync, destroying ordering.)
                    if (!validatedShift.createdAt) {
                        validatedShift.createdAt = new Date().toISOString();
                    }


                    const shiftRef = doc(db, "schedules", weekKey, "shifts", validatedShift.id);
                    await setDoc(shiftRef, {
                        date: validatedShift.date,
                        branch: validatedShift.branch,
                        type: validatedShift.type,
                        employeeId: validatedShift.employeeId,
                        customStart: validatedShift.customStart || null,
                        customEnd: validatedShift.customEnd || null,
                        role: validatedShift.role || 'barista',
                        customRole: validatedShift.role === 'custom' ? (validatedShift.customRole || '') : null,
                        createdAt: validatedShift.createdAt,
                        updatedAt: new Date()
                    });
                    totalShiftsSynced++;
                }
            }
        }


        updateSyncStatus('synced');

    } catch (error) {

        updateSyncStatus('local');
        alert('Failed to sync to server. Data is saved locally.');
        // Don't reset localChanges flag on error so user can retry
    }
}

// Auto-sync only when navigating away or on manual sync
window.addEventListener('beforeunload', () => {
    if (localChanges) {
        syncToFirebase();
    }
});

// Debug functions for console access
window.debugSync = {
    checkStatus: () => {



        console.log('- Total shifts in local storage:', Object.values(scheduleData).reduce((total, week) => {
            return total + Object.values(week).reduce((weekTotal, shifts) => weekTotal + shifts.length, 0);
        }, 0));
        return {
            localChanges,
            weeks: Object.keys(scheduleData),
            totalShifts: Object.values(scheduleData).reduce((total, week) => {
                return total + Object.values(week).reduce((weekTotal, shifts) => weekTotal + shifts.length, 0);
            }, 0)
        };
    },
    forceSync: () => forceSyncToFirebase(),
    checkLocalData: () => {

        return scheduleData;
    }
};

window.backupAllData = function () {
    const backup = {
        scheduleData: scheduleData,
        employeeNicknames: employeeNicknames,
        timestamp: new Date().toISOString()
    };

    const backupStr = JSON.stringify(backup, null, 2);

    // Create download link
    const blob = new Blob([backupStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `matchanese-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);


}

// Debug function to clear cache and reload branches
window.clearBranchesCache = function() {

    localStorage.removeItem('branches-cache');

    
    // Force reload of branches
    loadBranchesFromFirebase().then(() => {

        renderCurrentView();
    });
}

// Debug function to show current branches state
window.debugBranches = function() {




}

// ============================================================
// Mobile View — Calendar + Branch/My Schedule modes
// ============================================================

const MOBILE_ACTUAL_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iMjAiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iI0NDQ0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yMCAxMkMxNi42ODYzIDEyIDE0IDE0LjY4NjMgMTQgMThDMTQgMjEuMzEzNyAxNi42ODYzIDI0IDIwIDI0QzIzLjMxMzcgMjQgMjYgMjEuMzEzNyAyNiAxOEMyNiAxNC42ODYzIDIzLjMxMzcgMTIgMjAgMTJaIiBmaWxsPSIjQ0NDQ0NDIi8+CjxwYXRoIGQ9Ik0xMCAzNkMxMCAzMS41ODE3IDEzLjU4MTcgMjggMTggMjhIMjJDMjYuNDE4MyAyOCAzMCAzMS41ODE3IDMwIDM2VjM4SDEwVjM2WiIgZmlsbD0iI0ZGRkZGRiIvPgo8L3N2Zz4K';
const MOBILE_SCHED_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iMjAiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iI0NDQ0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yMCAxMkMxNi42ODYzIDEyIDE0IDE0LjY4NjMgMTQgMThDMTQgMjEuMzEzNyAxNi42ODYzIDI0IDIwIDI0QzIzLjMxMzcgMjQgMjYgMjEuMzEzNyAyNiAxOEMyNiAxNC42ODYzIDIzLjMxMzcgMTIgMjAgMTJaIiBmaWxsPSIjRkZGRkZGIi8+CjxwYXRoIGQ9Ik0xMCAzNkMxMCAzMS41ODE3IDEzLjU4MTcgMjggMTggMjhIMjJDMjYuNDE4MyAyOCAzMCAzMS41ODE3IDMwIDM2VjM4SDEwVjM2WiIgZmlsbD0iI0ZGRkZGRiIvPgo8L3N2Zz4K';

function getMobileWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun
    const diff = (day === 0) ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function changeMobileWeek(direction) {
    const d = new Date(currentMobileDay);
    d.setDate(d.getDate() + (direction * 7));
    currentMobileDay = d;
    renderMobileHeader();
    renderMobileView();
}

function initMobileView() {
    // Resolve DOM refs
    mobileWeekStrip = document.getElementById('mobileWeekStrip');
    mobileScheduleContent = document.getElementById('mobileScheduleContent');
    mobileBranchSelect = document.getElementById('mobileBranchSelect');
    mobileMonthTitle = document.getElementById('mobileMonthTitle');
    mobileCalChevron = document.getElementById('mobileCalChevron');
    mobileFullCalendar = document.getElementById('mobileFullCalendar');
    mobileCalGrid = document.getElementById('mobileCalGrid');
    mobileEmployeeSelect = document.getElementById('mobileEmployeeSelect');
    mobileEmployeeSelectLabel = document.getElementById('mobileEmployeeSelectLabel');

    // Resolve current employee: URL (debug) > parent portal > localStorage (signed-in user)
    const urlParams = new URLSearchParams(window.location.search);
    let signedInEmployeeId = null;
    try {
        if (window.parent && window.parent !== window && typeof window.parent.getCurrentUserData === 'function') {
            const parentUserData = window.parent.getCurrentUserData();
            if (parentUserData) signedInEmployeeId = parentUserData.employeeCode || parentUserData.username || null;
        }
    } catch (e) {}
    if (!signedInEmployeeId) signedInEmployeeId = localStorage.getItem("loggedInUser") || null;
    currentMobileEmployeeId = urlParams.get('employeeId') || signedInEmployeeId || null;

    // Populate branch dropdown
    if (mobileBranchSelect) {
        LOGIN_CATEGORIES.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.value;
            opt.textContent = cat.text;
            mobileBranchSelect.appendChild(opt);
        });
        currentMobileBranchKey = LOGIN_CATEGORIES[0].value;
        mobileBranchSelect.addEventListener('change', () => {
            currentMobileBranchKey = mobileBranchSelect.value;
            renderMobileView();
        });
    }

    // Populate debug employee dropdown (admin-only, used in My Schedule mode)
    function populateMobileEmployeeSelect() {
        if (!mobileEmployeeSelect) return;
        mobileEmployeeSelect.innerHTML = '';
        const first = document.createElement('option');
        first.value = '';
        first.textContent = currentMobileEmployeeId ? '(Me)' : 'Select employee';
        mobileEmployeeSelect.appendChild(first);
        const ids = Object.keys(employees).filter(id => employeeShownInShiftDropdown(id)).sort();
        ids.forEach(empId => {
            const opt = document.createElement('option');
            opt.value = empId;
            const label = employeeNicknames[empId] || employees[empId] || empId;
            opt.textContent = label;
            if (empId === currentMobileEmployeeId) opt.selected = true;
            mobileEmployeeSelect.appendChild(opt);
        });
    }
    populateMobileEmployeeSelect();
    if (mobileEmployeeSelect) {
        mobileEmployeeSelect.addEventListener('change', () => {
            const v = mobileEmployeeSelect.value;
            currentMobileEmployeeId = v || urlParams.get('employeeId') || null;
            renderMobileView();
        });
    }

    // Month row toggles full calendar
    const mobileMonthRow = document.getElementById('mobileMonthRow');
    if (mobileMonthRow) {
        mobileMonthRow.addEventListener('click', () => {
            mobileCalExpanded = !mobileCalExpanded;
            renderMobileHeader();
        });
    }

    // Swipe left/right on week strip to change week
    if (mobileWeekStrip) {
        let swipeStartX = 0;
        const SWIPE_THRESHOLD = 50;
        mobileWeekStrip.addEventListener('touchstart', (e) => {
            swipeStartX = e.touches[0].clientX;
        }, { passive: true });
        mobileWeekStrip.addEventListener('touchend', (e) => {
            if (!e.changedTouches.length) return;
            const deltaX = e.changedTouches[0].clientX - swipeStartX;
            if (deltaX > SWIPE_THRESHOLD) changeMobileWeek(-1);  // swipe right -> prev week
            else if (deltaX < -SWIPE_THRESHOLD) changeMobileWeek(1);  // swipe left -> next week
        }, { passive: true });
    }

    // Mode toggle buttons
    const branchBtn = document.getElementById('mobileBranchViewBtn');
    const mySchedBtn = document.getElementById('mobileMyScheduleBtn');
    if (branchBtn) {
        branchBtn.addEventListener('click', () => {
            currentMobileMode = 'branch';
            branchBtn.classList.add('active');
            mySchedBtn.classList.remove('active');
            if (mobileBranchSelect) mobileBranchSelect.style.display = '';
            if (mobileEmployeeSelect) mobileEmployeeSelect.style.display = 'none';
            if (mobileEmployeeSelectLabel) mobileEmployeeSelectLabel.style.display = 'none';
            renderMobileView();
        });
    }
    if (mySchedBtn) {
        mySchedBtn.addEventListener('click', () => {
            currentMobileMode = 'mySchedule';
            mySchedBtn.classList.add('active');
            branchBtn.classList.remove('active');
            if (mobileBranchSelect) mobileBranchSelect.style.display = 'none';
            if (READ_ONLY_MODE) {
                if (mobileEmployeeSelectLabel) mobileEmployeeSelectLabel.style.display = 'none';
                if (mobileEmployeeSelect) mobileEmployeeSelect.style.display = 'none';
            } else {
                if (mobileEmployeeSelectLabel) mobileEmployeeSelectLabel.style.display = 'none'; /* debug: show dropdown only, like branch */
                if (mobileEmployeeSelect) {
                    mobileEmployeeSelect.style.display = '';
                    mobileEmployeeSelect.disabled = false;
                    populateMobileEmployeeSelect();
                }
            }
            renderMobileView();
        });
    }

    renderMobileHeader();
    renderMobileView();
}

function renderMobileHeader() {
    if (mobileMonthTitle) {
        mobileMonthTitle.textContent = currentMobileDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (mobileCalChevron) {
        mobileCalChevron.textContent = mobileCalExpanded ? '▲' : '▼';
    }
    if (mobileFullCalendar) {
        if (mobileCalExpanded) {
            renderMobileFullCalendar();
            mobileFullCalendar.classList.add('expanded');
        } else {
            mobileFullCalendar.classList.remove('expanded');
        }
    }
    renderMobileWeekStrip();
}

function renderMobileFullCalendar() {
    if (!mobileCalGrid) return;
    mobileCalGrid.innerHTML = '';

    // Day-of-week headers (Mon–Sun)
    ['M','T','W','T','F','S','S'].forEach(d => {
        const h = document.createElement('div');
        h.className = 'mobile-cal-day-header';
        h.textContent = d;
        mobileCalGrid.appendChild(h);
    });

    const year = currentMobileDay.getFullYear();
    const month = currentMobileDay.getMonth();
    const firstDay = new Date(year, month, 1);
    // Convert Sunday=0 to Mon=0 offset (Monday = 0)
    let offset = firstDay.getDay();
    offset = (offset === 0) ? 6 : offset - 1;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    function addCell(cellDate, isAdjacent) {
        const cell = document.createElement('div');
        cell.className = 'mobile-cal-day-cell';
        if (isAdjacent) cell.classList.add('adjacent');
        cell.textContent = cellDate.getDate();
        if (cellDate.getTime() === today.getTime()) cell.classList.add('today');
        if (cellDate.toDateString() === currentMobileDay.toDateString()) cell.classList.add('selected');
        const d = new Date(cellDate.getTime());
        cell.addEventListener('click', () => {
            currentMobileDay = d;
            mobileCalExpanded = false;
            renderMobileHeader();
            renderMobileView();
        });
        mobileCalGrid.appendChild(cell);
    }

    // First row: last days of previous month
    const prevMonthDate = new Date(year, month, 0);
    const prevYear = prevMonthDate.getFullYear();
    const prevMonth = prevMonthDate.getMonth();
    const daysInPrevMonth = prevMonthDate.getDate();
    for (let i = 0; i < offset; i++) {
        const dayNum = daysInPrevMonth - offset + 1 + i;
        const cellDate = new Date(prevYear, prevMonth, dayNum);
        addCell(cellDate, true);
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
        const cellDate = new Date(year, month, d);
        addCell(cellDate, false);
    }

    // Last row: first days of next month to complete the grid
    const totalCells = offset + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    const nextMonthDate = new Date(year, month + 1, 1);
    const nextYear = nextMonthDate.getFullYear();
    const nextMonth = nextMonthDate.getMonth();
    for (let i = 0; i < trailing; i++) {
        const cellDate = new Date(nextYear, nextMonth, i + 1);
        addCell(cellDate, true);
    }
}

function renderMobileWeekStrip() {
    if (!mobileWeekStrip) return;
    mobileWeekStrip.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = getMobileWeekStart(currentMobileDay);
    const labels = ['M','T','W','T','F','S','S'];

    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + i);

        const cell = document.createElement('div');
        cell.className = 'mobile-week-cell';
        if (dayDate.getTime() === today.getTime()) cell.classList.add('today');
        if (dayDate.toDateString() === currentMobileDay.toDateString()) cell.classList.add('selected');

        cell.innerHTML = `<span class="mobile-week-label">${labels[i]}</span><span class="mobile-week-num">${dayDate.getDate()}</span>`;
        cell.addEventListener('click', () => {
            currentMobileDay = new Date(dayDate);
            renderMobileHeader();
            renderMobileView();
        });
        mobileWeekStrip.appendChild(cell);
    }
}

function renderMobileView() {
    if (!mobileScheduleContent) return;
    if (currentMobileMode === 'branch') {
        renderMobileBranchView();
    } else {
        renderMobileMyScheduleView();
        fetchPendingSubstitutionRequests().then(() => renderMobileMyScheduleView());
    }
}

function renderMobileBranchView() {
    const content = mobileScheduleContent;
    content.innerHTML = '';

    const dateStr = formatDate(currentMobileDay);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (currentMobileDay.getTime() === today.getTime()) {
        loadActualAttendanceForDate(dateStr);
    }

    const dayLabel = currentMobileDay.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    const dateHeader = document.createElement('div');
    dateHeader.className = 'mobile-date-label';
    dateHeader.textContent = dayLabel;
    content.appendChild(dateHeader);

    ['opening', 'midshift', 'closing'].forEach(category => {
        const dataInfo = getDataForDate(dateStr, currentMobileBranchKey, category);
        const shifts = dataInfo.data;

        if (shifts.length === 0) return;

        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'mobile-section-header';

        if (!READ_ONLY_MODE) {
            const plusBtn = document.createElement('span');
            plusBtn.className = 'mobile-section-plus';
            plusBtn.textContent = '+';
            plusBtn.addEventListener('click', () => addShiftForCategory(currentMobileBranchKey, dateStr, category));
            sectionHeader.textContent = category.charAt(0).toUpperCase() + category.slice(1);
            sectionHeader.appendChild(plusBtn);
        } else {
            sectionHeader.textContent = category.charAt(0).toUpperCase() + category.slice(1);
        }
        content.appendChild(sectionHeader);

        shifts.forEach(shift => content.appendChild(buildMobileShiftCard(shift, dateStr)));
    });

    if (!READ_ONLY_MODE) {
        const addBtn = document.createElement('button');
        addBtn.className = 'mobile-add-btn';
        addBtn.textContent = '+ Add Shift';
        addBtn.addEventListener('click', () => openShiftModalForLocation(currentMobileBranchKey, dateStr));
        content.appendChild(addBtn);
    }
}

function renderMobileMyScheduleView() {
    const content = mobileScheduleContent;
    content.innerHTML = '';

    if (!currentMobileEmployeeId) {
        const msg = document.createElement('div');
        msg.className = 'mobile-sign-in-msg';
        msg.textContent = 'Sign in to view your schedule.';
        content.appendChild(msg);
        return;
    }

    const weekStart = getMobileWeekStart(currentMobileDay);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + i);
        const dateStr = formatDate(dayDate);
        const isPastDate = dayDate < today;

        const dayHeader = document.createElement('div');
        dayHeader.className = 'mobile-day-header';
        if (dayDate.toDateString() === today.toDateString()) dayHeader.classList.add('today');
        dayHeader.textContent = dayDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        content.appendChild(dayHeader);

        let rendered = false;

        // Past dates: show only actual attendance record (or "— No shift —"); do not show scheduled shifts
        if (isPastDate) {
            const actualData = getActualAttendanceForDate(dateStr);
            const empAttendance = actualData[currentMobileEmployeeId];
            if (empAttendance) {
                const branchKey = Object.keys(BRANCHES).find(k => BRANCHES[k] === empAttendance.branch)
                    || getDisplayNameCategory(empAttendance.branch)
                    || empAttendance.branch;
                const actualShift = {
                    id: `actual_${currentMobileEmployeeId}_${dateStr}`,
                    employeeId: currentMobileEmployeeId,
                    branch: branchKey,
                    type: categorizeShiftByTime(empAttendance.shift, empAttendance.timeIn),
                    customStart: empAttendance.timeIn ? removeSecondsFromTime(empAttendance.timeIn) : null,
                    customEnd: empAttendance.timeOut ? removeSecondsFromTime(empAttendance.timeOut) : null,
                    timeInPhoto: empAttendance.timeInPhoto,
                    isActual: true
                };
                const card = buildMobileMyScheduleCard(actualShift, dateStr);
                card.addEventListener('click', () => openShiftDetailsModal(actualShift, dateStr));
                content.appendChild(card);
                rendered = true;
            } else {
                const empty = document.createElement('div');
                empty.className = 'mobile-no-shift';
                empty.textContent = '— No shift —';
                content.appendChild(empty);
                rendered = true;
            }
        }

        if (!rendered) {
            const shifts = getEmployeeShiftsForDay(currentMobileEmployeeId, dateStr);
            if (shifts.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'mobile-no-shift';
                empty.textContent = '— No shift —';
                content.appendChild(empty);
            } else {
                shifts.forEach(shift => {
                    const card = buildMobileMyScheduleCard(shift, dateStr);
                    card.addEventListener('click', () => openShiftDetailsModal(shift, dateStr));
                    content.appendChild(card);
                });
            }
        }
    }
}

function buildMobileShiftCard(shift, dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isPastDate = new Date(dateStr + 'T00:00:00') < today;
    /* Match desktop: any actual attendance (today or past) gets the white "logged-in" card style */
    const completedClass = shift.isActual ? 'completed' : '';
    const conflict = !shift.isActual && hasConflict(shift, dateStr);

    const block = document.createElement('div');
    block.className = [
        'shift-employee-block',
        shift.type,
        conflict ? 'shift-conflict' : '',
        completedClass,
        shift.employeeId === 'unassigned' ? 'unassigned' : ''
    ].filter(Boolean).join(' ');
    block.dataset.shiftId = shift.id;

    const empName = shift.employeeId === 'unassigned'
        ? 'UNASSIGNED'
        : (employeeNicknames[shift.employeeId] || employees[shift.employeeId]?.split(' ')[0] || employees[shift.employeeId] || shift.employeeId);

    let shiftContent;
    if (completedClass) {
        const timeInDisplay = shift.customStart ? formatAttendanceTime(shift.customStart, shift.type, false) : 'N/A';
        const timeOutDisplay = shift.customEnd ? formatAttendanceTime(shift.customEnd, shift.type, true) : '';
        const timeOneLine = timeOutDisplay ? `${timeInDisplay} – ${timeOutDisplay}` : `${timeInDisplay} –`;
        const lateStatus = isLateTimeIn(shift.type, timeInDisplay);
        const timeInClass = lateStatus === 'red' ? 'late-red' : lateStatus === 'orange' ? 'late-orange' : '';
        const photoSrc = shift.timeInPhoto || MOBILE_ACTUAL_PLACEHOLDER;
        shiftContent = `
            <div class="shift-photo-wrap">
                <img src="${photoSrc}" class="shift-employee-photo" alt="Time In Photo" onerror="this.src='${MOBILE_ACTUAL_PLACEHOLDER}'" />
            </div>
            <div class="shift-details-container">
                <div class="shift-employee">${empName}</div>
                <div class="shift-time ${timeInClass}">${timeOneLine}</div>
            </div>`;
    } else {
        const photoSrc = shift.isActual
            ? (shift.timeInPhoto || MOBILE_ACTUAL_PLACEHOLDER)
            : (getEmployeeLastTimeInPhotoUrl(shift.employeeId) || MOBILE_SCHED_PLACEHOLDER);
        const timeDisplay = getShiftTimeDisplayForScheduled(shift);
        const timeOneLine = `${timeDisplay.startTime} – ${timeDisplay.endTime}`;
        shiftContent = `
            <div class="shift-photo-wrap">
                <img src="${photoSrc}" class="shift-employee-photo" alt="Last Time In Photo" />
            </div>
            <div class="shift-details-container">
                <div class="shift-employee">${empName}</div>
                <div class="shift-time">${timeOneLine}</div>
            </div>`;
    }
    block.innerHTML = shiftContent;
    block.addEventListener('mousedown', handleShiftClick);
    return block;
}

function buildMobileMyScheduleCard(shift, dateStr) {
    const card = document.createElement('div');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isPastDate = new Date(dateStr + 'T00:00:00') < today;
    const isCompleted = shift.isActual && isPastDate;
    const branchName = BRANCHES[shift.branch] || shift.branch || '';
    const shiftTypeName = SHIFT_TYPES[shift.type]?.name || (shift.type ? shift.type.charAt(0).toUpperCase() + shift.type.slice(1) : '');

    card.className = ['mobile-my-schedule-card', shift.type || '', isCompleted ? 'completed' : ''].filter(Boolean).join(' ');

    if (isCompleted) {
        const timeInDisplay = shift.customStart ? formatAttendanceTime(shift.customStart, shift.type, false) : 'N/A';
        const timeOutDisplay = shift.customEnd ? formatAttendanceTime(shift.customEnd, shift.type, true) : '';
        const lateStatus = isLateTimeIn(shift.type, timeInDisplay);
        const timeInClass = lateStatus === 'red' ? 'late-red' : lateStatus === 'orange' ? 'late-orange' : '';
        card.innerHTML = `
            <div class="mobile-my-card-left">
                <span class="mobile-my-branch">${branchName}</span>
            </div>
            <div class="mobile-my-card-right">
                <span class="mobile-my-type">${shiftTypeName}</span>
                <div class="mobile-card-time ${timeInClass}">${timeInDisplay} – ${timeOutDisplay || '...'}</div>
                <span class="mobile-my-done">✓</span>
            </div>`;
    } else {
        const pendingBadge = hasPendingSubstitutionForShift(dateStr, shift.id)
            ? '<span class="mobile-my-pending-badge">Pending reliever request</span>'
            : '';
        const timeDisplay = getShiftTimeDisplayForScheduled(shift);
        card.innerHTML = `
            <div class="mobile-my-card-left">
                <span class="mobile-my-branch">${branchName}</span>
            </div>
            <div class="mobile-my-card-right">
                <span class="mobile-my-type">${shiftTypeName}</span>
                <div class="mobile-card-time">${timeDisplay.startTime} – ${timeDisplay.endTime}</div>
                ${pendingBadge}
            </div>`;
    }

    return card;
}

function setShiftDetailsRelieverOnlyLayout(enabled) {
    const content = shiftDetailsModal?.querySelector('.shift-details-modal__content');
    if (!content) return;
    content.classList.toggle('shift-details-modal__content--reliever-only', !!enabled);
}

async function openShiftDetailsModal(shift, dateStr) {
    if (!shiftDetailsModal) return;
    setShiftDetailsRelieverOnlyLayout(false);
    const dateEl = document.getElementById('shiftDetailsDate');
    const branchEl = document.getElementById('shiftDetailsBranch');
    const typeEl = document.getElementById('shiftDetailsShiftType');
    const timeEl = document.getElementById('shiftDetailsTime');
    const actualTimeRow = document.getElementById('shiftDetailsActualTimeRow');
    const actualTimeEl = document.getElementById('shiftDetailsActualTime');
    const actionsEl = document.getElementById('shiftDetailsActions');
    const relieverForm = document.getElementById('shiftDetailsRelieverForm');
    const relieverSelect = document.getElementById('shiftDetailsRelieverSelect');
    const pendingMsg = document.getElementById('shiftDetailsPendingMsg');
    const reqRelieverBtn = document.getElementById('shiftDetailsRequestSubstitutionBtn');
    const submitRequestBtn = document.getElementById('shiftDetailsSubmitRequestBtn');

    if (!dateEl || !branchEl || !typeEl || !timeEl) return;

    const dateObj = new Date(dateStr + 'T00:00:00');
    dateEl.textContent = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    branchEl.textContent = BRANCHES[shift.branch] || shift.branch || '—';
    typeEl.textContent = SHIFT_TYPES[shift.type]?.name || (shift.type ? shift.type.charAt(0).toUpperCase() + shift.type.slice(1) : '—');

    let scheduledStr;
    if (shift.isActual && (shift.customStart || shift.customEnd)) {
        const preset = SHIFT_TYPES[shift.type];
        scheduledStr = preset?.display || (preset ? `${getShiftTimeDisplayForScheduled({ type: shift.type }).startTime} – ${getShiftTimeDisplayForScheduled({ type: shift.type }).endTime}` : '—');
        timeEl.textContent = scheduledStr;
        const actualIn = shift.customStart ? formatAttendanceTime(shift.customStart, shift.type, false) : 'N/A';
        const actualOut = shift.customEnd ? formatAttendanceTime(shift.customEnd, shift.type, true) : '...';
        if (actualTimeRow && actualTimeEl) {
            actualTimeRow.style.display = '';
            actualTimeEl.textContent = `${actualIn} – ${actualOut}`;
        }
    } else {
        const timeDisplay = getShiftTimeDisplayForScheduled(shift);
        scheduledStr = `${timeDisplay.startTime} – ${timeDisplay.endTime}`;
        timeEl.textContent = scheduledStr;
        if (actualTimeRow) actualTimeRow.style.display = 'none';
    }

    currentShiftDetailsForRequest = null;
    if (actionsEl) actionsEl.style.display = 'none';
    if (relieverForm) relieverForm.style.display = 'none';
    if (pendingMsg) pendingMsg.style.display = 'none';
    if (reqRelieverBtn) reqRelieverBtn.style.display = 'none';
    const bodyEl = document.querySelector('.shift-details-modal__body');
    const titleEl = document.querySelector('.shift-details-modal__title');
    if (bodyEl) bodyEl.style.display = '';
    if (titleEl) titleEl.textContent = 'Shift details';

    if (!shift.isActual && shift.id && currentMobileEmployeeId) {
        await fetchPendingSubstitutionRequests();
        const pending = hasPendingSubstitutionForShift(dateStr, shift.id);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const shiftDate = new Date(dateStr + 'T00:00:00');
        const daysUntil = Math.ceil((shiftDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
        const canRequest = daysUntil >= 3 && !pending;

        if (actionsEl) actionsEl.style.display = '';
        if (pending) {
            if (pendingMsg) pendingMsg.style.display = 'block';
        } else if (canRequest) {
            currentShiftDetailsForRequest = { shift, dateStr };
            if (reqRelieverBtn) reqRelieverBtn.style.display = 'block';
            if (relieverForm) relieverForm.style.display = 'none';
        }
    }

    shiftDetailsModal.style.display = 'flex';
}

function populateShiftDetailsRelieverDropdown() {
    const relieverSelect = document.getElementById('shiftDetailsRelieverSelect');
    const submitRequestBtn = document.getElementById('shiftDetailsSubmitRequestBtn');
    if (!relieverSelect) return;
    relieverSelect.innerHTML = '<option value="">Select reliever</option>';
    const ids = Object.keys(employees).filter(id => employeeShownInShiftDropdown(id) && id !== currentMobileEmployeeId).sort();
    ids.forEach(id => {
        const name = employeeNicknames[id] || employees[id] || id;
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        relieverSelect.appendChild(opt);
    });
    if (submitRequestBtn) submitRequestBtn.disabled = true;
}

function onRequestRelieverClick() {
    if (!currentShiftDetailsForRequest) return;
    const reqRelieverBtn = document.getElementById('shiftDetailsRequestSubstitutionBtn');
    const relieverForm = document.getElementById('shiftDetailsRelieverForm');
    const bodyEl = document.querySelector('.shift-details-modal__body');
    const titleEl = document.querySelector('.shift-details-modal__title');
    if (reqRelieverBtn) reqRelieverBtn.style.display = 'none';
    if (bodyEl) bodyEl.style.display = 'none';
    if (titleEl) titleEl.textContent = 'Request reliever';
    setShiftDetailsRelieverOnlyLayout(true);
    populateShiftDetailsRelieverDropdown();
    if (relieverForm) relieverForm.style.display = 'block';
}

function closeShiftDetailsModal() {
    setShiftDetailsRelieverOnlyLayout(false);
    if (shiftDetailsModal) shiftDetailsModal.style.display = 'none';
    currentShiftDetailsForRequest = null;
}

function showScheduleToast(message, isError = false) {
    const el = document.getElementById('scheduleToast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(showScheduleToast._tid);
    showScheduleToast._tid = setTimeout(() => {
        el.classList.remove('show');
    }, 3000);
}

async function submitSubstitutionRequest() {
    const { shift, dateStr } = currentShiftDetailsForRequest || {};
    const relieverSelect = document.getElementById('shiftDetailsRelieverSelect');
    const submitBtn = document.getElementById('shiftDetailsSubmitRequestBtn');
    const requestedRelieverId = relieverSelect?.value?.trim();
    if (!shift || !dateStr || !shift.id || !currentMobileEmployeeId || !requestedRelieverId) return;
    if (requestedRelieverId === currentMobileEmployeeId) return;
    const existing = await fetchPendingSubstitutionRequests();
    const alreadyPending = existing.some(r => r.date === dateStr && r.scheduleShiftId === shift.id);
    if (alreadyPending) return;
    const requestedRelieverName = employeeNicknames[requestedRelieverId] || employees[requestedRelieverId] || requestedRelieverId;
    const weekKey = getWeekKeyForDate(new Date(dateStr + 'T00:00:00'));
    const payload = {
        type: 'substitution',
        employeeId: currentMobileEmployeeId,
        employeeName: employees[currentMobileEmployeeId] || currentMobileEmployeeId,
        date: dateStr,
        status: 'pending',
        requestedAt: Timestamp.now(),
        weekKey,
        scheduleShiftId: shift.id,
        branch: shift.branch || '',
        shiftType: shift.type || '',
        requestedRelieverId,
        requestedRelieverName
    };
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');
    }
    try {
        await addDoc(collection(db, 'substitution_requests'), payload);
        closeShiftDetailsModal();
        showScheduleToast('Request submitted.');
        await fetchPendingSubstitutionRequests();
        renderMobileMyScheduleView();
    } catch (e) {
        console.error('submitSubstitutionRequest:', e);
        showScheduleToast('Failed to submit. Please try again.', true);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('is-loading');
        }
    }
}

// Admin shift modal helpers (used by mobile branch view)
function addShiftForCategory(branchKey, dateStr, category) {
    const modal = document.getElementById('shiftModal');
    const shiftBranchEl = document.getElementById('shiftBranch');
    const shiftTypeEl = document.getElementById('shiftType');
    const shiftDateEl = document.getElementById('shiftDate');
    if (modal && shiftBranchEl && shiftTypeEl && shiftDateEl) {
        shiftDateEl.value = dateStr;
        shiftBranchEl.value = branchKey;
        shiftTypeEl.value = category;
        populateEmployeeDropdownForDate(dateStr);
        const titleEl = document.getElementById('modalTitle');
        if (titleEl) titleEl.textContent = `Add ${category.charAt(0).toUpperCase() + category.slice(1)} Shift`;
        modal.style.display = 'flex';
        const empEl = document.getElementById('shiftEmployee');
        if (empEl) setTimeout(() => empEl.focus(), 100);
    }
}

function openShiftModalForLocation(branchKey, dateStr) {
    const modal = document.getElementById('shiftModal');
    const shiftBranchEl = document.getElementById('shiftBranch');
    const shiftTypeEl = document.getElementById('shiftType');
    const shiftDateEl = document.getElementById('shiftDate');
    if (modal && shiftBranchEl && shiftTypeEl && shiftDateEl) {
        shiftDateEl.value = dateStr;
        shiftBranchEl.value = branchKey;
        shiftTypeEl.value = '';
        populateEmployeeDropdownForDate(dateStr);
        const titleEl = document.getElementById('modalTitle');
        if (titleEl) titleEl.textContent = 'Add Shift';
        modal.style.display = 'flex';
        setTimeout(() => shiftTypeEl.focus(), 100);
    }
}
