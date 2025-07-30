// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc, setDoc, query, where, deleteDoc, addDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
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

// Employee data - loaded from Firebase
let employees = {};
// Shift types configuration
const SHIFT_TYPES = {
    opening: { name: "Opening", start: "09:30", end: "18:30", display: "9:30 AM - 6:30 PM" },
    midshift: { name: "Midshift", start: "11:00", end: "20:00", display: "11:00 AM - 8:00 PM" },
    closing: { name: "Closing", start: "13:00", end: "22:00", display: "1:00 PM - 10:00 PM" },
    closingHalf: { name: "Closing Half-Day", start: "18:00", end: "22:00", display: "6:00 PM - 10:00 PM" },
    custom: { name: "Custom", start: null, end: null, display: "Custom Hours" }
};

// Branch configuration - will be loaded from Firebase
let BRANCHES = {
    podium: "Podium",
    smnorth: "SM North"
};

let allBranches = []; // Will be loaded from Firebase

// Global state
let currentWeekStart = new Date();
let scheduleData = {};
let currentView = 'shift';
let selectedEmployee = '';
let localChanges = false;
let isDeletingShifts = false;

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

// Modal elements
const shiftModal = document.getElementById('shiftModal');
const closeShiftModal = document.getElementById('closeShiftModal');
const shiftForm = document.getElementById('shiftForm');
const modalTitle = document.getElementById('modalTitle');// Add this with the other DOM elements around line 75
const shiftDate = document.getElementById('shiftDate');
const shiftBranch = document.getElementById('shiftBranch');
const shiftType = document.getElementById('shiftType');
const customTimeGroup = document.getElementById('customTimeGroup');
const customStartTime = document.getElementById('customStartTime');
const customEndTime = document.getElementById('customEndTime');
const shiftEmployee = document.getElementById('shiftEmployee');
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

document.addEventListener('DOMContentLoaded', async function () {
    initSchedulingApp();
    setupEventListeners(); 
    setCurrentWeek();
    await loadBranchesFromFirebase(); // Load branches first
    await loadAllEmployees(); // Load employees
    loadEmployeeNicknames();
    loadScheduleData();
});

function initSchedulingApp() {
    console.log('Scheduling app initialized');
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

    // Past days toggle with immediate feedback
    document.getElementById('actualAttendanceToggle').addEventListener('change', async (e) => {
        console.log('🔄 Toggle changed:', e.target.checked);

        // Show immediate loading feedback
        const gridBody = document.querySelector('.shift-grid-body');
        if (gridBody) {
            gridBody.innerHTML = '<div style="text-align: center; padding: 2rem; color: #666;">Loading...</div>';
        }

        actualAttendanceCache = {}; // Clear cache when switching
        console.log('🗑️ Cache cleared');

        // Small delay to show loading state
        setTimeout(() => {
            renderCurrentView();
        }, 100);
    });
    
    // Sync button
    syncBtn.addEventListener('click', syncToFirebase);

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

    // Branch dropdown change handler
    shiftBranch.addEventListener('change', handleBranchDropdownChange);

    function closeBranchModal() {
        addBranchModal.style.display = 'none';
        branchForm.reset();
    }

    function handleBranchDropdownChange(e) {
        const value = e.target.value;
        if (value === 'add-popup') {
            e.target.value = ''; // Reset selection
            openBranchModal('popup');
        } else if (value === 'add-workshop') {
            e.target.value = ''; // Reset selection  
            openBranchModal('workshop');
        }
    }

    function openBranchModal(type) {
        document.getElementById('branchModalTitle').textContent = `Add New ${type.charAt(0).toUpperCase() + type.slice(1)}`;
        document.getElementById('branchType').value = type;
        document.getElementById('branchType').disabled = true;
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
            alert('Branch already exists');
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

            // Select the new branch in the dropdown
            document.getElementById('shiftBranch').value = branchKey;

            closeBranchModal();
            updateSyncStatus('synced');

        } catch (error) {
            console.error('Error creating branch:', error);
            updateSyncStatus('local');
            alert('Failed to create branch');
        }
    }

    // Form events
    shiftForm.addEventListener('submit', handleShiftSubmit);
    shiftType.addEventListener('change', handleShiftTypeChange);
    deleteShiftBtn.addEventListener('click', handleShiftDelete);

    // Multi-select events  
    document.getElementById('deleteSelectedBtn').addEventListener('click', deleteSelectedShifts);
    document.getElementById('exitSelectionBtn').addEventListener('click', exitMultiSelectMode);
    document.getElementById('copySelectedBtn').addEventListener('click', copySelectedShiftsToNextDay);

    const multiSelectControls = document.getElementById('multiSelectControls');

    // Sync button
    syncBtn.addEventListener('click', syncToFirebase);

    // Delete all data button
    document.getElementById('deleteFutureBtn').addEventListener('click', deleteAllData);

    // Copy previous week button
    document.getElementById('copyPrevWeekBtn').addEventListener('click', copyPreviousWeekSchedule);
}

let currentPastDaysMode = 'scheduled';

function togglePastDaysView(mode) {
    currentPastDaysMode = mode;
    renderCurrentView();
}

let actualAttendanceCache = {};

async function preloadActualAttendanceForWeek() {
    console.log('🔄 preloadActualAttendanceForWeek called, mode:', currentPastDaysMode);

    if (currentPastDaysMode !== 'actual') {
        console.log('❌ Not in actual mode, skipping preload');
        return;
    }

    try {
        const weekDates = getWeekDates();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        console.log('📅 Week dates:', weekDates.map(formatDate));
        console.log('📅 Today:', formatDate(today));

        // Only load for past dates
        const pastDates = weekDates.filter(date => date < today).map(formatDate);
        console.log('📅 Past dates to load:', pastDates);

        if (pastDates.length === 0) {
            console.log('❌ No past dates to load');
            return;
        }

        // Get all employee IDs
        const employeeIds = Object.keys(employees);
        console.log('👥 Employee IDs:', employeeIds);

        // Clear existing cache
        actualAttendanceCache = {};
        console.log('🗑️ Cleared attendance cache');

        // Load all attendance data for the week in parallel
        const attendancePromises = employeeIds.map(async (employeeId) => {
            console.log(`🔍 Loading attendance for employee: ${employeeId} (${employees[employeeId]})`);

            try {
                const attendanceRef = collection(db, "attendance", employeeId, "dates");
                const snapshot = await getDocs(query(
                    attendanceRef,
                    where("__name__", ">=", pastDates[0]),
                    where("__name__", "<=", pastDates[pastDates.length - 1])
                ));

                console.log(`📄 ${employeeId}: Found ${snapshot.size} attendance records`);

                let employeeAttendanceCount = 0;

                snapshot.forEach(doc => {
                    const dateStr = doc.id;
                    const docData = doc.data();

                    console.log(`📝 ${employeeId} on ${dateStr}:`, {
                        hasClockIn: !!docData.clockIn,
                        hasClockOut: !!docData.clockOut,
                        timeIn: docData.clockIn?.time,
                        timeOut: docData.clockOut?.time,
                        branch: docData.clockIn?.branch
                    });

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
                        console.log(`✅ Cached attendance for ${employeeId} on ${dateStr}`);
                    }
                });

                console.log(`📊 ${employeeId}: Cached ${employeeAttendanceCount} attendance records`);

            } catch (error) {
                console.error(`❌ Error loading attendance for ${employeeId}:`, error);
            }
        });

        await Promise.all(attendancePromises);

        console.log('🎉 Preload complete. Final cache:', actualAttendanceCache);
        console.log('📊 Cache summary:', {
            totalDates: Object.keys(actualAttendanceCache).length,
            totalAttendanceRecords: Object.values(actualAttendanceCache).reduce((sum, dateData) => sum + Object.keys(dateData).length, 0)
        });

    } catch (error) {
        console.error('❌ Error preloading actual attendance:', error);
    }
}

function getActualAttendanceForDate(dateStr) {
    const result = actualAttendanceCache[dateStr] || {};
    console.log(`🔍 getActualAttendanceForDate(${dateStr}):`, result);
    return result;
}

// Multi-select state
let multiSelectMode = false;
let selectedShifts = new Set();
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
            // Normal click - open modal
            openShiftModal('edit', { shiftId });
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
        };

        // Initialize data structures if needed
        if (!scheduleData[nextWeekKey]) scheduleData[nextWeekKey] = {};
        if (!scheduleData[nextWeekKey][nextDateStr]) scheduleData[nextWeekKey][nextDateStr] = [];

        // Add the copied shift
        scheduleData[nextWeekKey][nextDateStr].push(newShift);
        console.log('Copied shift to next day:', newShift);
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

    console.log('Today:', today.toDateString());
    console.log('Day of week:', dayOfWeek);
    console.log('Days to subtract:', daysToSubtract);
    console.log('Calculated Monday:', monday.toDateString());
    console.log('Week key will be:', formatDate(monday));

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

function copyPreviousWeekSchedule() {
    const currentWeekKey = getWeekKey();
    const previousWeek = new Date(currentWeekStart);
    previousWeek.setDate(currentWeekStart.getDate() - 7);
    const previousWeekKey = formatDate(previousWeek);

    // Check if current week already has schedules
    const hasCurrentSchedules = scheduleData[currentWeekKey] &&
        Object.keys(scheduleData[currentWeekKey]).length > 0;

    if (hasCurrentSchedules) {
        if (!confirm('Current week already has shifts. Copy previous week anyway? This will add to existing shifts.')) {
            return;
        }
    }

    // Check if previous week has data
    if (!scheduleData[previousWeekKey] || Object.keys(scheduleData[previousWeekKey]).length === 0) {
        alert('No schedule found for previous week to copy.');
        return;
    }

    if (!confirm('Copy all shifts from previous week to current week?')) {
        return;
    }

    // Initialize current week data
    if (!scheduleData[currentWeekKey]) scheduleData[currentWeekKey] = {};

    // Copy shifts from previous week
    const currentWeekDates = getWeekDates();
    Object.keys(scheduleData[previousWeekKey]).forEach(prevDateStr => {
        const prevDate = new Date(prevDateStr + 'T00:00:00');
        const dayOfWeek = prevDate.getDay();
        const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to Monday=0 index

        const currentDate = currentWeekDates[dayIndex];
        const currentDateStr = formatDate(currentDate);

        if (!scheduleData[currentWeekKey][currentDateStr]) {
            scheduleData[currentWeekKey][currentDateStr] = [];
        }

        // Copy each shift
        scheduleData[previousWeekKey][prevDateStr].forEach(shift => {
            const newShift = {
                id: generateShiftId(),
                date: currentDateStr,
                branch: shift.branch,
                type: shift.type,
                employeeId: shift.employeeId,
                customStart: shift.customStart,
                customEnd: shift.customEnd
            };

            scheduleData[currentWeekKey][currentDateStr].push(newShift);
        });
    });

    saveToLocalStorage();
    syncToFirebase();
    renderCurrentView();
    alert('Previous week schedule copied successfully!');
}

function getWeekDatesForDate(weekStart) {
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        date.setHours(0, 0, 0, 0);
        dates.push(date);
    }
    return dates;
}

function updateWeekTitle() {
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(currentWeekStart.getDate() + 6);

    const options = { month: 'long', day: 'numeric' };
    const startStr = currentWeekStart.toLocaleDateString('en-US', options);
    const endStr = weekEnd.toLocaleDateString('en-US', { ...options, year: 'numeric' });

    weekTitle.textContent = `Week of ${startStr} - ${endStr}`;
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
    if (currentView === 'calendar') {
        renderCalendarView();
    } else if (currentView === 'shift') {
        renderShiftView();
    } else {
        renderEmployeeView();
    }
}

// Employee dropdown population
function populateEmployeeDropdowns() {
    const employeeOptions = Object.entries(employees)
        .map(([id, name]) => {
            const displayName = employeeNicknames[id] || name;
            return `<option value="${id}">${displayName}</option>`;
        })
        .join('');

    shiftEmployee.innerHTML = '<option value="">Select employee</option>' + employeeOptions;
}

function updateBranchDropdowns() {
    // Update shift modal branch dropdown
    const shiftBranch = document.getElementById('shiftBranch');
    if (shiftBranch) {
        const currentValue = shiftBranch.value;
        shiftBranch.innerHTML = '<option value="">Select location</option>';

        // Add default branches
        const defaultOptions = [
            { value: 'podium', text: 'Podium' },
            { value: 'smnorth', text: 'SM North' }
        ];

        defaultOptions.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.text;
            shiftBranch.appendChild(optionElement);
        });

        // Add Firebase branches grouped by type
        const popupBranches = allBranches.filter(b => b.type === 'popup').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const workshopBranches = allBranches.filter(b => b.type === 'workshop').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        popupBranches.forEach(branch => {
            const option = document.createElement('option');
            option.value = branch.key;
            option.textContent = `[Popup] ${branch.name}`;
            shiftBranch.appendChild(option);
        });

        workshopBranches.forEach(branch => {
            const option = document.createElement('option');
            option.value = branch.key;
            option.textContent = `[Workshop] ${branch.name}`;
            shiftBranch.appendChild(option);
        });

        // Add "Add New" options
        const addPopupOption = document.createElement('option');
        addPopupOption.value = 'add-popup';
        addPopupOption.textContent = '+ Add Pop-up';
        shiftBranch.appendChild(addPopupOption);

        const addWorkshopOption = document.createElement('option');
        addWorkshopOption.value = 'add-workshop';
        addWorkshopOption.textContent = '+ Add Workshop';
        shiftBranch.appendChild(addWorkshopOption);

        shiftBranch.value = currentValue;
    }

    // Update branch filter dropdown
    const branchFilter = document.getElementById('branchFilter');
    if (branchFilter) {
        const currentValue = branchFilter.value;
        branchFilter.innerHTML = '<option value="all">All Locations</option>';

        Object.entries(BRANCHES).forEach(([key, name]) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = name;
            branchFilter.appendChild(option);
        });

        branchFilter.value = currentValue;
    }
}

async function loadAllEmployees() {
    try {
        const employeesRef = collection(db, "employees");
        const snapshot = await getDocs(employeesRef);

        employees = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            employees[doc.id] = data.name;
        });

        console.log("Loaded employees from Firebase:", employees);
        // Re-populate dropdowns after loading employees
        populateEmployeeDropdowns();
        renderCurrentView();
        return employees;
    } catch (error) {
        console.error("Error loading employees:", error);
        return {};
    }
}

async function loadBranchesFromFirebase() {
    try {
        // console.log('Loading branches from Firebase...');
        const snapshot = await getDocs(collection(db, "branches"));
        const firebaseBranches = [];
        snapshot.forEach(doc => {
            // console.log('Found branch:', doc.id, doc.data());
            firebaseBranches.push({ id: doc.id, ...doc.data() });
        });

        allBranches = firebaseBranches;

        // Update BRANCHES object with loaded branches
        allBranches.forEach(branch => {
            BRANCHES[branch.key] = branch.name;
        });

        localStorage.setItem('branches-cache', JSON.stringify(allBranches));
        console.log('Loaded branches:', allBranches);
        updateBranchDropdowns();

        return allBranches;
    } catch (error) {
        console.error('Error loading branches:', error);
        // Fallback to local cache
        const cached = localStorage.getItem('branches-cache');
        if (cached) {
            allBranches = JSON.parse(cached);
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
        return { id: docRef.id, ...branchData };
    } catch (error) {
        console.error('Error saving branch:', error);
        throw error;
    }
}

function renderCalendarView() {
    console.log('Rendering calendar view...');
    const weekDates = getWeekDates();

    let gridHTML = `
        <div class="calendar-header">
            <div class="time-spacer"></div>
            ${weekDates.map(date => {
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = date.getDate();
        const monthName = date.toLocaleDateString('en-US', { month: 'short' });
        return `<div class="calendar-day-header">
                    <div class="day-name">${dayName}</div>
                    <div class="day-date">${monthName} ${dayNum}</div>
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
    console.log('🎨 renderShiftView started');
    
    // Read mode directly from toggle
    const actualToggle = document.getElementById('actualAttendanceToggle');
    currentPastDaysMode = actualToggle && actualToggle.checked ? 'actual' : 'scheduled';
    console.log('🎯 Current mode check:', currentPastDaysMode);


    const weekDates = getWeekDates();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Preload actual attendance data if needed
    if (currentPastDaysMode === 'actual') {
        console.log('⏳ Preloading actual attendance...');
        await preloadActualAttendanceForWeek();
        console.log('✅ Preload finished');
    }

    // Add this debug section right after preload:
    console.log('🔍 Debug: Checking what data we have');
    weekDates.forEach(date => {
        const dateStr = formatDate(date);
        const isPastDate = date < today;
        console.log(`📅 ${dateStr} (past: ${isPastDate}):`);

        if (isPastDate && currentPastDaysMode === 'actual') {
            const actualData = getActualAttendanceForDate(dateStr);
            console.log(`  📊 Actual attendance:`, actualData);
        } else {
            const scheduledData = getAllShiftsForDay(dateStr);
            console.log(`  📅 Scheduled shifts:`, scheduledData.length, 'shifts');
        }
    });

    // Apply branch filter to determine which branches to show
    const allBranchKeys = Object.keys(BRANCHES);
    const filter = branchFilter.value;
    const shiftViewBranches = filter === 'all' ? allBranchKeys : [filter];

    // Simplified shift categories
    const shiftCategories = ['opening', 'midshift', 'closing'];
    const shiftCategoryNames = {
        'opening': 'Opening',
        'midshift': 'Midshift',
        'closing': 'Closing'
    };

    let gridHTML = `
        <div class="shift-grid-header">
            <div class="shift-branch-column">Location / Shift</div>
            ${weekDates.map(date => {
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = date.getDate();
        const monthName = date.toLocaleDateString('en-US', { month: 'short' });
        return `<div class="shift-day-header">
                    <div class="day-name">${dayName}</div>
                    <div class="day-date">${monthName} ${dayNum}</div>
                </div>`;
    }).join('')}
        </div>
        <div class="shift-grid-body">
    `;

    // Generate rows for each branch + shift combination
    for (const branchKey of shiftViewBranches) {
        const branchName = BRANCHES[branchKey];
        const isDefaultBranch = branchKey === 'podium' || branchKey === 'smnorth';

        // Check if this branch has ANY shifts at all this week
        let hasAnyShifts = false;
        for (const date of weekDates) {
            const dateStr = formatDate(date);
            const isPastDate = date < today;

            let shiftsForDay = [];

            if ((isPastDate || isToday(date)) && currentPastDaysMode === 'actual') {
                // Use cached actual attendance
                const actualAttendance = getActualAttendanceForDate(dateStr);
                shiftsForDay = Object.entries(actualAttendance)
                    .filter(([_, attendance]) => attendance.branch === branchName)
                    .map(([employeeId, attendance]) => ({
                        id: `actual_${employeeId}_${dateStr}`,
                        employeeId: employeeId,
                        branch: branchKey,
                        type: categorizeShiftByTime(attendance.shift, attendance.timeIn),
                        customStart: attendance.timeIn?.split(':').slice(0, 2).join(':') || null,
                        customEnd: attendance.timeOut?.split(':').slice(0, 2).join(':') || null,
                        isActual: true
                    }));
            } else {
                // Use scheduled shifts
                const allShiftsForDay = getAllShiftsForDay(dateStr);
                shiftsForDay = allShiftsForDay.filter(shift => shift.branch === branchKey);
            }

            if (shiftsForDay.length > 0) {
                hasAnyShifts = true;
                break;
            }
        }

        if (!hasAnyShifts && !isDefaultBranch) {
            continue; // Skip this entire branch if no shifts
        }

        // Add branch header
        gridHTML += `<div class="shift-branch-section">
            <div class="shift-branch-title">${branchName}</div>
        </div>`;

        // Check which shift categories have content for this branch
        const categoriesWithContent = [];
        for (const category of shiftCategories) {
            let hasContentThisWeek = false;

            for (const date of weekDates) {
                const dateStr = formatDate(date);
                const isPastDate = date < today;

                let shiftsForCategory = [];

                if ((isPastDate || isToday(date)) && currentPastDaysMode === 'actual') {
                    const actualAttendance = getActualAttendanceForDate(dateStr);
                    shiftsForCategory = Object.entries(actualAttendance)
                        .filter(([_, attendance]) =>
                            attendance.branch === branchName &&
                            categorizeShiftByTime(attendance.shift, attendance.timeIn) === category
                        );
                } else {
                    const allShiftsForDay = getAllShiftsForDay(dateStr);
                    shiftsForCategory = allShiftsForDay.filter(shift =>
                        shift.branch === branchKey &&
                        categorizeShiftByTime(shift.type, getShiftStartTime(shift)) === category
                    );
                }

                if (shiftsForCategory.length > 0) {
                    hasContentThisWeek = true;
                    break;
                }
            }

            if (hasContentThisWeek) {
                categoriesWithContent.push(category);
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
                        <button class="add-shift-btn-small">+</button>
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
                const isPastDate = date < today;

                let shiftsForCell = [];

                if ((isPastDate || isToday(date)) && currentPastDaysMode === 'actual') {
                    // Show actual attendance
                    const actualAttendance = getActualAttendanceForDate(dateStr);
                    shiftsForCell = Object.entries(actualAttendance)
                        .filter(([_, attendance]) =>
                            attendance.branch === branchName &&
                            categorizeShiftByTime(attendance.shift, attendance.timeIn) === category
                        )
                        .map(([employeeId, attendance]) => ({
                            id: `actual_${employeeId}_${dateStr}`,
                            employeeId: employeeId,
                            branch: branchKey,
                            type: 'custom', // Always use custom for actual attendance
                            customStart: attendance.timeIn ? removeSecondsFromTime(attendance.timeIn) : null,
                            customEnd: attendance.timeOut ? removeSecondsFromTime(attendance.timeOut) : null,
                            isActual: true
                        }));
                } else {
                    // Show scheduled shifts
                    const allShiftsForDay = getAllShiftsForDay(dateStr);
                    shiftsForCell = allShiftsForDay.filter(shift =>
                        shift.branch === branchKey &&
                        categorizeShiftByTime(shift.type, getShiftStartTime(shift)) === category
                    );
                }

                gridHTML += `<div class="shift-cell" data-date="${dateStr}" data-branch="${branchKey}" data-shift-type="${category}">`;

                if (shiftsForCell.length > 0) {
                    shiftsForCell.forEach(shift => {
                        const conflict = !shift.isActual && hasConflict(shift, dateStr);

                        gridHTML += `
                            <div class="shift-employee-block ${shift.type} ${conflict ? 'shift-conflict' : ''} ${isPastDate ? 'completed' : ''} ${shift.employeeId === 'unassigned' ? 'unassigned' : ''} ${selectedShifts.has(shift.id) ? 'selected' : ''}"
                                 data-shift-id="${shift.id}">
                                <div class="shift-employee">${shift.employeeId === 'unassigned' ? 'UNASSIGNED' : (employeeNicknames[shift.employeeId] || employees[shift.employeeId])}</div>
                                <div class="shift-branch">${BRANCHES[shift.branch]}</div>
                                <div class="shift-type">${shift.isActual ? '' : (SHIFT_TYPES[shift.type]?.name || 'Custom')}</div>
                                <div class="shift-time">${getShiftTimeDisplay(shift)}</div>
                            </div>
                        `;
                    });
                } else {
                    gridHTML += '<button class="add-shift-btn-small">+</button>';
                }

                gridHTML += '</div>';
            }

            gridHTML += '</div>';
        }
    }

    // Add general "Add New Shift" row for other branches
    gridHTML += `<div class="shift-branch-section">
        <div class="shift-branch-title">Add New Shift</div>
    </div>`;

    gridHTML += `<div class="shift-grid-row">
        <div class="shift-type-header"></div>`;

    weekDates.forEach(date => {
        const dateStr = formatDate(date);
        gridHTML += `<div class="shift-cell" data-date="${dateStr}" data-branch="" data-shift-type="">
            <button class="add-shift-btn-small">+</button>
        </div>`;
    });

    gridHTML += '</div></div>';

    shiftScheduleGrid.innerHTML = gridHTML;

    // Add event listeners
    document.querySelectorAll('.shift-cell').forEach(cell => {
        cell.addEventListener('click', handleShiftCellClick);
    });

    document.querySelectorAll('.shift-employee-block').forEach(block => {
        block.addEventListener('mousedown', handleShiftClick);
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

    const parts = timeStr.split(' ');

    if (parts.length === 2) {
        // Format: "1:52:02 PM" -> "1:52 PM"
        const [time, meridian] = parts;
        const timeParts = time.split(':');
        if (timeParts.length >= 2) {
            return `${timeParts[0]}:${timeParts[1]} ${meridian}`;
        }
    } else if (parts.length === 1 && timeStr.includes(':')) {
        // Format: "18:40:50" -> "6:40 PM" (convert 24-hour to 12-hour)
        const timeParts = timeStr.split(':');
        if (timeParts.length >= 2) {
            const hours = parseInt(timeParts[0]);
            const minutes = timeParts[1];
            const meridian = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12;
            return `${displayHours}:${minutes} ${meridian}`;
        }
    }

    return timeStr;
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
        const matchesBranch = filter === 'all' || shift.branch === filter;
        const matchesShiftParams = shift.branch === branchKey && shift.type === shiftType;
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

    const cell = e.currentTarget;

    // Check if this cell has any shifts
    const hasShifts = cell.querySelector('.shift-employee-block');

    // If there are shifts, only allow clicks on the add button or if no shifts exist
    if (hasShifts && !e.target.classList.contains('add-shift-btn-small')) {
        return; // Don't open modal if clicking background with shifts
    }

    // Only handle if click was on empty area or add button
    const date = cell.dataset.date;
    const branch = cell.dataset.branch;
    const shiftType = cell.dataset.shiftType;

    openShiftModal('add', { date, branch, shiftType });
}

function handleHourSlotClick(e) {
    const slot = e.currentTarget;
    const column = slot.closest('.calendar-day-column');
    const date = column.dataset.date;
    const hour = parseInt(slot.dataset.hour);

    console.log('Clicked date:', date, 'Column element:', column);
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
    console.log('Generating slots for date:', dateStr);
    const shifts = getAllShiftsForDay(dateStr);
    console.log('Found shifts for', dateStr, ':', shifts);
    const filteredShifts = shifts.filter(shift => {
        const filter = branchFilter.value;
        return filter === 'all' || shift.branch === filter;
    });

    let slotsHTML = '';

    // Create hour slots first
    for (let hour = 8; hour <= 22; hour++) {
        slotsHTML += `<div class="hour-slot" data-hour="${hour}">
        <button class="add-shift-btn-calendar">+</button>
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
                <div class="shift-employee">${shift.employeeId === 'unassigned' ? 'UNASSIGNED' : (employeeNicknames[shift.employeeId] || employees[shift.employeeId])}</div>
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

        console.log('Deleting Firebase data for weeks:', Array.from(allWeekKeys));

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
                    console.log(`Deleted ${deletePromises.length} shifts from week ${weekKey}`);
                }
            } catch (weekError) {
                console.log(`No data found for week ${weekKey}:`, weekError);
            }
        }

        console.log('Firebase data deletion completed!');
    } catch (error) {
        console.error('Error deleting Firebase data:', error);
        alert('Error deleting Firebase data: ' + error.message);
    }

    // Nuke local data
    scheduleData = {};
    localStorage.removeItem('matchanese_schedules');
    sessionStorage.clear();

    updateSyncStatus('synced');
    console.log('All data deleted from both Firebase and local storage!');
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
        console.log('Employee nicknames loaded from cache:', employeeNicknames);
        populateEmployeeDropdowns(); // Re-populate dropdown with updated nicknames
        renderCurrentView(); // Render with cached nicknames first
    }

    // Then fetch from Firebase and update
    // Then fetch from Firebase and update
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
            console.log('Employee nicknames updated from Firebase:', employeeNicknames);
            renderCurrentView(); // Re-render with updated nicknames
        }
    } catch (error) {
        console.error('Error loading employee nicknames:', error);
    }
}

function handleColumnClick(e) {
    if (e.target.classList.contains('shift-block')) return;

    const column = e.currentTarget;
    const date = column.dataset.date;

    openShiftModal('add', { date });
}


// Employee view rendering
function renderEmployeeView() {
    console.log('Rendering employee view...');
    const weekDates = getWeekDates();

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
        const monthName = date.toLocaleDateString('en-US', { month: 'short' });
        return `<div class="shift-day-header">
                    <div class="day-name">${dayName}</div>
                    <div class="day-date">${monthName} ${dayNum}</div>
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

            gridHTML += `<div class="shift-cell" data-date="${dateStr}" data-employee="${employeeId}">`;

            if (shiftsForDay.length > 0) {
                shiftsForDay.forEach(shift => {
                    const conflict = hasConflict(shift, dateStr);
                    gridHTML += `
                            <div class="shift-employee-block ${shift.type} ${conflict ? 'shift-conflict' : ''} ${isPastDate(dateStr) ? 'completed' : ''} ${shift.employeeId === 'unassigned' ? 'unassigned' : ''} ${selectedShifts.has(shift.id) ? 'selected' : ''}"
                             data-shift-id="${shift.id}">
                            <div class="shift-branch">${BRANCHES[shift.branch]}</div>
                            <div class="shift-type">${SHIFT_TYPES[shift.type].name}</div>
                            <div class="shift-time">${getShiftTimeDisplay(shift)}</div>
                        </div>
                    `;
                });
            } else {
                gridHTML += '<button class="add-shift-btn-small">+</button>';
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
        gridHTML += `<div class="shift-cell" data-date="${dateStr}" data-employee="">
            <button class="add-shift-btn-small">+</button>
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

    const cell = e.currentTarget;
    const date = cell.dataset.date;
    const employeeId = cell.dataset.employee;

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
    if (filter === 'all') {
        return Object.keys(BRANCHES);
    } else {
        return [filter];
    }
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
    const weekKey = getWeekKey();
    if (!scheduleData[weekKey] || !scheduleData[weekKey][dateStr]) {
        return [];
    }

    return scheduleData[weekKey][dateStr].filter(shift => shift.branch === branchKey);
}

function getEmployeeShiftsForDay(employeeId, dateStr) {
    const weekKey = getWeekKey();
    if (!scheduleData[weekKey] || !scheduleData[weekKey][dateStr]) {
        return [];
    }

    return scheduleData[weekKey][dateStr].filter(shift => shift.employeeId === employeeId);
}

function getWeekKeyForDate(date) {
    const weekStart = getWeekStart(date);
    return formatDate(weekStart);
}

function getAllShiftsForDay(dateStr) {
    const weekKey = getWeekKey();
    return scheduleData[weekKey] && scheduleData[weekKey][dateStr] ? scheduleData[weekKey][dateStr] : [];
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
    console.log('Removing duplicate shifts...');
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
                            console.log('Replaced recurring instance with original:', existing.shift);
                        }
                    } else if (!shift.recurring || shift.isRecurringInstance) {
                        // This is a duplicate instance, remove it
                        duplicatesRemoved++;
                        console.log('Removed duplicate:', shift);
                    } else {
                        // Keep the first one, remove this duplicate
                        duplicatesRemoved++;
                        console.log('Removed duplicate:', shift);
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

    console.log(`Removed ${duplicatesRemoved} duplicate shifts`);
    return duplicatesRemoved;
}

function getShiftTimeDisplay(shift) {
    // Handle actual attendance shifts
    if (shift.isActual || (shift.customStart && shift.customEnd)) {
        const startTime = shift.customStart || 'N/A';
        const endTime = shift.customEnd || 'N/A';
        return `${startTime} - ${endTime}`;
    }

    // Handle regular scheduled shifts
    if (shift.type === 'custom') {
        const startTime = shift.customStart ? formatTimeTo12Hour(shift.customStart) : 'N/A';
        const endTime = shift.customEnd ? formatTimeTo12Hour(shift.customEnd) : 'N/A';
        return `${startTime} - ${endTime}`;
    } else {
        const shiftType = SHIFT_TYPES[shift.type];
        return shiftType ? shiftType.display : 'N/A';
    }
}

function formatTimeTo12Hour(time24) {
    if (!time24) return 'N/A'; // Add this line

    const [hours, minutes] = time24.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
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
            console.log('  → DUPLICATE DETECTED');
            return true;
        }

        // Check for time overlaps with same employee
        if (shift.employeeId === otherShift.employeeId) {
            const otherStart = getShiftStartTime(otherShift);
            const otherEnd = getShiftEndTime(otherShift);

            console.log(`    Same employee overlap check: ${shiftStart} < ${otherEnd} && ${shiftEnd} > ${otherStart}`);

            // Check for overlap
            if ((shiftStart < otherEnd) && (shiftEnd > otherStart)) {
                console.log('  → TIME CONFLICT DETECTED');
                return true;
            }
        }
    }

    // console.log('  → No conflict found');
    return false;
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

    openShiftModal('add', { date, branch });
}

function handleEmployeeDayClick(e) {
    e.stopPropagation();

    if (e.target.classList.contains('employee-shift')) {
        return; // Let shift click handler handle this
    }

    const day = e.currentTarget;
    const date = day.dataset.date;

    openShiftModal('add', { date, employeeId: selectedEmployee });
}

function handleShiftClick(e) {
    e.stopPropagation();
    e.preventDefault();

    const shiftId = e.currentTarget.dataset.shiftId;

    if (multiSelectMode) {
        toggleShiftSelection(shiftId);
        return;
    }

    startSelection(e, shiftId);
}

async function handleShiftSubmit(e) {
    e.preventDefault();

    const isEdit = shiftId.value !== '';

    const shiftData = {
        id: shiftId.value || generateShiftId(),
        date: shiftDate.value,
        branch: shiftBranch.value,
        type: shiftType.value,
        employeeId: shiftEmployee.value || 'unassigned'
    };

    if (shiftType.value === 'custom') {
        shiftData.customStart = customStartTime.value;
        shiftData.customEnd = customEndTime.value;
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
function openShiftModal(mode, data) {
    modalTitle.textContent = mode === 'add' ? 'Add Shift' : 'Edit Shift';
    deleteShiftBtn.style.display = mode === 'edit' ? 'block' : 'none';

    // Reset form
    shiftForm.reset();
    customTimeGroup.style.display = 'none';

    if (mode === 'add') {
        shiftId.value = '';
        originalDate.value = data.date;
        originalBranch.value = data.branch || '';
        shiftDate.value = data.date;

        // Pre-Select location and shift type if provided
        if (data.branch) {
            shiftBranch.value = data.branch;
        }
        if (data.shiftType) {
            shiftType.value = data.shiftType;
        }

        if (data.employeeId) {
            shiftEmployee.value = data.employeeId;
        }
    } else {
        // Edit mode
        let shift = findShiftById(data.shiftId);

        if (shift) {
            console.log('About to populate modal with shift:', shift);
            shiftId.value = shift.id;
            originalDate.value = shift.date;
            originalBranch.value = shift.branch;
            shiftDate.value = shift.date;
            shiftBranch.value = shift.branch;
            shiftType.value = shift.type;
            shiftEmployee.value = shift.employeeId;

            console.log('Populated modal fields:');
            console.log('Date:', shiftDate.value);
            console.log('Branch:', shiftBranch.value);
            console.log('Type:', shiftType.value);
            console.log('Employee:', shiftEmployee.value);

            if (shift.type === 'custom') {
                customTimeGroup.style.display = 'block';
                customStartTime.value = shift.customStart;
                customEndTime.value = shift.customEnd;
            }
        }
    }

    shiftModal.style.display = 'flex';
}

function findAnyShiftById(shiftId) {
    // Search through ALL weeks for a shift with this ID
    for (let weekKey in scheduleData) {
        for (let dateStr in scheduleData[weekKey]) {
            const shift = scheduleData[weekKey][dateStr].find(s => s.id === shiftId);
            if (shift) return shift;
        }
    }
    return null;
}

function closeModal() {
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

    scheduleData[weekKey][dateStr].push(shiftData);

    markLocalChanges();
}

function updateShift(shiftData) {
    console.log('=== UPDATE SHIFT DEBUG ===');
    console.log('Updating shift:', shiftData);
    console.log('Schedule data before update:', JSON.parse(JSON.stringify(scheduleData)));

    const shift = findShiftById(shiftData.id);
    if (shift) {
        Object.assign(shift, shiftData);
        console.log('Updated shift:', shift);
        console.log('Schedule data after update:', JSON.parse(JSON.stringify(scheduleData)));
        markLocalChanges();
    } else {
        console.log('ERROR: Could not find shift to update!');
    }

    console.log('=== END UPDATE DEBUG ===');
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
                console.log(`Deleted shift ${shiftId} from Firebase week ${deletion.weekKey}`);
            } catch (error) {
                console.error(`Error deleting shift ${shiftId} from Firebase:`, error);
            }
        }
    }
    
    // Reset the flag after a short delay
    setTimeout(() => {
        isDeletingShifts = false;
    }, 1000);
}

function findShiftById(shiftId) {
    const weekKey = getWeekKey();

    if (!scheduleData[weekKey]) return null;

    for (let dateStr in scheduleData[weekKey]) {
        const shift = scheduleData[weekKey][dateStr].find(s => s.id === shiftId);
        if (shift) return shift;
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
        console.log('Schedule data saved to local storage');
    } catch (error) {
        console.error('Error saving to local storage:', error);
    }
}

function loadFromLocalStorage() {
    try {
        const stored = localStorage.getItem('matchanese_schedules');
        console.log('Raw localStorage data:', stored);
        if (stored) {
            scheduleData = JSON.parse(stored);
            console.log('Schedule data loaded from local storage:', scheduleData);
            console.log('Available week keys:', Object.keys(scheduleData));
        }
    } catch (error) {
        console.error('Error loading from local storage:', error);
        scheduleData = {};
    }
}

function markLocalChanges() {
    localChanges = true;
    updateSyncStatus('local');
}

function updateSyncStatus(status) {
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

async function loadScheduleData() {
    // Load from local storage first for instant display
    loadFromLocalStorage();
    renderCurrentView();

    // Don't sync from Firebase if we're in the middle of deleting
    if (isDeletingShifts) {
        console.log('Skipping Firebase sync during deletion');
        return;
    }

    // Then sync from Firebase in background and update
    try {
        await syncFromFirebase();
        console.log('Updated with latest data from Firebase');
        renderCurrentView(); // Re-render with updated data
    } catch (error) {
        console.error('Error syncing from Firebase:', error);
        updateSyncStatus('local');
    }
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

        console.log('Syncing weeks from Firebase:', weekKeys);

        for (const weekKey of weekKeys) {
            const schedulesRef = collection(db, "schedules", weekKey, "shifts");
            const snapshot = await getDocs(schedulesRef);

            if (snapshot.size > 0) {
                if (!scheduleData[weekKey]) scheduleData[weekKey] = {};

                snapshot.forEach(doc => {
                    const shift = { id: doc.id, ...doc.data() };
                    const dateStr = shift.date;

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
        console.error('Error syncing from Firebase:', error);
        updateSyncStatus('local');
        throw error;
    }
}

function cleanupAfterSync() {
    removeDuplicateShifts();
    saveToLocalStorage();
}

async function syncToFirebase() {
    if (!localChanges) {
        console.log('No local changes to sync');
        return;
    }

    try {
        updateSyncStatus('syncing');

        // Sync ALL weeks that have local data, not just current week
        const allWeeks = Object.keys(scheduleData);
        console.log('Syncing weeks to Firebase:', allWeeks);

        for (const weekKey of allWeeks) {
            const weekData = scheduleData[weekKey] || {};

            // Upload each shift for this week
            for (let dateStr in weekData) {
                const shifts = weekData[dateStr];

                for (let shift of shifts) {
                    const shiftRef = doc(db, "schedules", weekKey, "shifts", shift.id);
                    await setDoc(shiftRef, {
                        date: shift.date,
                        branch: shift.branch,
                        type: shift.type,
                        employeeId: shift.employeeId,
                        customStart: shift.customStart || null,
                        customEnd: shift.customEnd || null,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                }
            }
        }

        updateSyncStatus('synced');
        console.log('Successfully synced to Firebase');
    } catch (error) {
        console.error('Error syncing to Firebase:', error);
        updateSyncStatus('local');
        alert('Failed to sync to server. Data is saved locally.');
    }
}

// Auto-sync only when navigating away or on manual sync
window.addEventListener('beforeunload', () => {
    if (localChanges) {
        syncToFirebase();
    }
});

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

    console.log('Backup created! Check your downloads folder.');
}