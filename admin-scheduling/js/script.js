// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc, setDoc, query, where, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

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

// Branch configuration
const BRANCHES = {
    podium: "Podium",
    smnorth: "SM North",
    popup: "Pop-up",
    workshop: "Workshop",
    other: "Other Events"
};

// Global state
let currentWeekStart = new Date();
let scheduleData = {};
let currentView = 'shift';
let selectedEmployee = '';
let localChanges = false;

let pendingRecurringAction = null;
let pendingShiftData = null;
let pendingOriginalShift = null;

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
const recurringWeekly = document.getElementById('recurringWeekly');

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
    await loadAllEmployees(); // Load employees first
    loadEmployeeNicknames(); // Add this line
    loadScheduleData();
});

function initSchedulingApp() {
    console.log('Scheduling app initialized');
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
    syncBtn.addEventListener('click', syncToFirebase);

    // Modal events
    closeShiftModal.addEventListener('click', closeModal);
    cancelShiftBtn.addEventListener('click', closeModal);
    shiftModal.addEventListener('click', (e) => {
        if (e.target === shiftModal) closeModal();
    });

    // Form events
    shiftForm.addEventListener('submit', handleShiftSubmit);
    shiftType.addEventListener('change', handleShiftTypeChange);
    deleteShiftBtn.addEventListener('click', handleShiftDelete);

    // Recurring choice modal events
    thisDateOnlyBtn.addEventListener('click', () => handleRecurringChoice('thisOnly'));
    thisAndFutureBtn.addEventListener('click', () => handleRecurringChoice('thisAndFuture'));
    cancelRecurringBtn.addEventListener('click', closeRecurringChoiceModal);
    recurringChoiceModal.addEventListener('click', (e) => {
        if (e.target === recurringChoiceModal) closeRecurringChoiceModal();
    });

    // Multi-select events  
    document.getElementById('deleteSelectedBtn').addEventListener('click', deleteSelectedShifts);
    document.getElementById('exitSelectionBtn').addEventListener('click', exitMultiSelectMode);
    document.getElementById('copySelectedBtn').addEventListener('click', copySelectedShiftsToNextDay);

    const multiSelectControls = document.getElementById('multiSelectControls');

    // Sync button
    syncBtn.addEventListener('click', syncToFirebase);

    // Delete all data button
    document.getElementById('deleteFutureBtn').addEventListener('click', deleteAllData);
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

function deleteSelectedShifts() {
    if (selectedShifts.size === 0) return;

    const count = selectedShifts.size;
    if (!confirm(`Delete ${count} shift${count > 1 ? 's' : ''}?`)) return;

    selectedShifts.forEach(shiftId => deleteShift(shiftId));
    exitMultiSelectMode();
    saveToLocalStorage();
    syncToFirebase(); // Immediately sync to Firebase
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
            recurring: false // Copies are individual shifts
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
    const newWeek = new Date(currentWeekStart);
    newWeek.setDate(currentWeekStart.getDate() + (direction * 7));
    currentWeekStart = newWeek;
    updateWeekTitle();
    loadScheduleData();
    // debugRecurringShifts(); // Add this line
}

function generateRecurringShiftsForMultipleWeeks() {
    const currentWeek = new Date(currentWeekStart);

    // Generate for current week + next 4 weeks (5 weeks total)
    for (let i = 0; i < 5; i++) {
        const targetWeek = new Date(currentWeek);
        targetWeek.setDate(currentWeek.getDate() + (i * 7));

        const weekKey = formatDate(targetWeek);
        const weekDates = getWeekDatesForDate(targetWeek);

        generateRecurringShiftsForWeek(weekKey, weekDates);
    }

    saveToLocalStorage();
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

function generateRecurringShiftsForWeek(weekKey, weekDates) {
    console.log('Generating recurring shifts for week:', weekKey);

    // Look for recurring shifts from all previous weeks
    Object.keys(scheduleData).forEach(sourceWeekKey => {
        if (sourceWeekKey >= weekKey) return; // Skip current and future weeks

        Object.keys(scheduleData[sourceWeekKey]).forEach(dateStr => {
            scheduleData[sourceWeekKey][dateStr].forEach(shift => {
                if (shift.recurring && !shift.isRecurringInstance) {
                    // This is an original recurring shift
                    generateFutureRecurringShift(shift, weekDates, weekKey);
                }
            });
        });
    });
}

function generateRecurringShiftsForCurrentWeek() {
    const currentWeekKey = getWeekKey();
    const currentWeekDates = getWeekDates();

    console.log('Generating recurring shifts for week:', currentWeekKey);

    // Look for recurring shifts from all previous weeks
    Object.keys(scheduleData).forEach(weekKey => {
        if (weekKey >= currentWeekKey) return; // Skip current and future weeks

        Object.keys(scheduleData[weekKey]).forEach(dateStr => {
            scheduleData[weekKey][dateStr].forEach(shift => {
                if (shift.recurring && !shift.isRecurringInstance) {
                    // This is an original recurring shift
                    generateFutureRecurringShift(shift, currentWeekDates, currentWeekKey);
                }
            });
        });
    });

    saveToLocalStorage();
}

function generateFutureRecurringShift(originalShift, targetWeekDates, targetWeekKey) {
    const originalDate = new Date(originalShift.date + 'T00:00:00');
    const dayOfWeek = originalDate.getDay();
    const targetDayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const targetDate = targetWeekDates[targetDayIndex];
    const targetDateStr = formatDate(targetDate);

    // Only generate if target date is after original date
    if (targetDate <= originalDate) return;

    // Initialize data structures
    if (!scheduleData[targetWeekKey]) scheduleData[targetWeekKey] = {};
    if (!scheduleData[targetWeekKey][targetDateStr]) scheduleData[targetWeekKey][targetDateStr] = [];

    // STRICT duplicate check - check for ANY shift with same employee, branch, type on same date
    const exists = scheduleData[targetWeekKey][targetDateStr].some(s =>
        s.employeeId === originalShift.employeeId &&
        s.branch === originalShift.branch &&
        s.type === originalShift.type &&
        ((s.customStart || null) === (originalShift.customStart || null)) &&
        ((s.customEnd || null) === (originalShift.customEnd || null))
    );

    if (!exists) {
        const newShift = {
            id: generateShiftId(),
            date: targetDateStr,
            branch: originalShift.branch,
            type: originalShift.type,
            employeeId: originalShift.employeeId,
            customStart: originalShift.customStart,
            customEnd: originalShift.customEnd,
            recurring: false,
            isRecurringInstance: true,
            originalShiftId: originalShift.id,
            recurringSeriesId: originalShift.id
        };

        scheduleData[targetWeekKey][targetDateStr].push(newShift);
        console.log('Generated recurring shift:', newShift);
    } else {
        console.log('Skipping duplicate recurring shift for', targetDateStr, originalShift.employeeId);
    }
}

function debugRecurringShifts() {
    console.log('=== DEBUGGING RECURRING SHIFTS ===');

    // Check the ORIGINAL week (2025-06-02 from your logs)
    console.log('ORIGINAL WEEK DATA (2025-06-02):');
    if (scheduleData['2025-06-02']) {
        Object.keys(scheduleData['2025-06-02']).forEach(dateStr => {
            console.log(`Original shifts on ${dateStr}:`, scheduleData['2025-06-02'][dateStr]);
            scheduleData['2025-06-02'][dateStr].forEach(shift => {
                console.log('  ORIGINAL Shift details:', {
                    id: shift.id,
                    employee: shift.employeeId,
                    recurring: shift.recurring,
                    recurringSeriesId: shift.recurringSeriesId,
                    isRecurringInstance: shift.isRecurringInstance
                });
            });
        });
    }

    // Check current week
    const currentWeekKey = getWeekKey();
    console.log('CURRENT WEEK DATA:', currentWeekKey);

    if (scheduleData[currentWeekKey]) {
        Object.keys(scheduleData[currentWeekKey]).forEach(dateStr => {
            console.log(`Current shifts on ${dateStr}:`, scheduleData[currentWeekKey][dateStr]);
        });
    }

    console.log('=== END DEBUG ===');
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

function renderShiftView() {
    console.log('Rendering shift view...');
    const weekDates = getWeekDates();

    // Default to SM North and Podium only for shift view
    // Apply branch filter to determine which branches to show
    const allBranches = ['smnorth', 'podium', 'popup', 'workshop', 'other'];
    const filter = branchFilter.value;
    const shiftViewBranches = filter === 'all' ? allBranches : [filter];
    const shiftTypes = ['opening', 'midshift', 'closing', 'closingHalf', 'custom'];

    let gridHTML = `
        <div class="shift-grid-header">
            <div class="shift-branch-column">Branch / Shift</div>
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
    shiftViewBranches.forEach(branchKey => {
        const branchName = BRANCHES[branchKey];

        // Always show Podium and SM North, even if empty
        const isDefaultBranch = branchKey === 'podium' || branchKey === 'smnorth';

        // Quick check if this branch has ANY shifts at all this week
        const hasAnyShifts = weekDates.some(date => {
            const dateStr = formatDate(date);
            const allShiftsForDay = getAllShiftsForDay(dateStr);
            return allShiftsForDay.some(shift => shift.branch === branchKey);
        });

        if (!hasAnyShifts && !isDefaultBranch) {
            return; // Skip this entire branch if no shifts (unless it's podium/smnorth)
        }

        // Check which shift types have content for this branch for the entire week
        const shiftsWithContent = [];
        shiftTypes.forEach(shiftType => {
            const hasContentThisWeek = weekDates.some(date => {
                const dateStr = formatDate(date);
                const shiftsForDay = getShiftsForBranchAndType(dateStr, branchKey, shiftType);
                return shiftsForDay.length > 0;
            });

            if (hasContentThisWeek) {
                shiftsWithContent.push(shiftType);
            }
        });

        // Add branch header
        gridHTML += `<div class="shift-branch-section">
    <div class="shift-branch-title">${branchName}</div>
</div>`;

        // Only show shift types that have content, but always add "New Shift" for default branches
        const shiftsToShow = shiftsWithContent.length > 0 ? shiftsWithContent : [];

        // For default branches (podium/smnorth), always show even if empty and add "New Shift" row
        if (isDefaultBranch) {
            shiftsToShow.push('newshift'); // Add special marker for new shift row
        } else if (shiftsToShow.length === 0) {
            return; // Skip non-default branches if they have no content
        }

        shiftsToShow.forEach(shiftType => {
            if (shiftType === 'newshift') {
                // Special case for "New Shift" row
                gridHTML += `<div class="shift-grid-row">
            <div class="shift-type-header"></div>`;

                // Add cells for each day with branch pre-filled
                weekDates.forEach(date => {
                    const dateStr = formatDate(date);
                    gridHTML += `<div class="shift-cell" data-date="${dateStr}" data-branch="${branchKey}" data-shift-type="">
                <button class="add-shift-btn-small">+</button>
            </div>`;
                });

                gridHTML += '</div>';
                return;
            }

            const shiftName = SHIFT_TYPES[shiftType].name;

            gridHTML += `<div class="shift-grid-row">
        <div class="shift-type-header">${shiftName}</div>`;

            // Add cells for each day
            weekDates.forEach(date => {
                const dateStr = formatDate(date);
                const shiftsForDay = getShiftsForBranchAndType(dateStr, branchKey, shiftType);

                gridHTML += `<div class="shift-cell" data-date="${dateStr}" data-branch="${branchKey}" data-shift-type="${shiftType}">`;

                if (shiftsForDay.length > 0) {
                    shiftsForDay.forEach(shift => {
                        const conflict = hasConflict(shift, dateStr);
                        gridHTML += `
                            <div class="shift-employee-block ${shift.type} ${conflict ? 'shift-conflict' : ''} ${isPastDate(dateStr) ? 'completed' : ''} ${shift.employeeId === 'unassigned' ? 'unassigned' : ''} ${selectedShifts.has(shift.id) ? 'selected' : ''}"
                                 data-shift-id="${shift.id}">
                                <div class="shift-employee">${shift.employeeId === 'unassigned' ? 'UNASSIGNED' : (employeeNicknames[shift.employeeId] || employees[shift.employeeId])}</div>
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
    });

    // Add general "Add New Shift" row for other branches
    gridHTML += `<div class="shift-branch-section">
    <div class="shift-branch-title">Add New Shift</div>
</div>`;

    gridHTML += `<div class="shift-grid-row">
    <div class="shift-type-header"></div>`;

    // Add cells for each day without branch pre-filled
    weekDates.forEach(date => {
        const dateStr = formatDate(date);
        gridHTML += `<div class="shift-cell" data-date="${dateStr}" data-branch="" data-shift-type="">
        <button class="add-shift-btn-small">+</button>
    </div>`;
    });

    gridHTML += '</div>';

    shiftScheduleGrid.innerHTML = gridHTML;

    // Add event listeners
    document.querySelectorAll('.shift-cell').forEach(cell => {
        cell.addEventListener('click', handleShiftCellClick);
    });

    document.querySelectorAll('.shift-employee-block').forEach(block => {
        block.addEventListener('mousedown', handleShiftClick);
    });
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

function getVirtualRecurringShifts(dateStr) {
    const targetDate = new Date(dateStr + 'T00:00:00');
    const targetDayOfWeek = targetDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const virtualShifts = [];

    // Look through all stored weeks for recurring shifts
    Object.keys(scheduleData).forEach(weekKey => {
        Object.keys(scheduleData[weekKey]).forEach(storedDateStr => {
            scheduleData[weekKey][storedDateStr].forEach(shift => {
                if (shift.recurring) {
                    const originalDate = new Date(shift.date + 'T00:00:00');
                    const originalDayOfWeek = originalDate.getDay();

                    // Check if this recurring shift should appear on the target date
                    if (originalDayOfWeek === targetDayOfWeek && targetDate > originalDate) {
                        // Check for exceptions
                        if (shift.recurringExceptions && shift.recurringExceptions.includes(dateStr)) {
                            return; // Skip this date due to exception
                        }

                        // Check if there's already a stored shift for this recurring series on this date
                        const hasStoredInstance = scheduleData[getWeekKeyForDate(targetDate)] &&
                            scheduleData[getWeekKeyForDate(targetDate)][dateStr] &&
                            scheduleData[getWeekKeyForDate(targetDate)][dateStr].some(s =>
                                s.originalShiftId === shift.id || s.recurringSeriesId === shift.id
                            );

                        if (!hasStoredInstance) {
                            // Create virtual shift (not stored anywhere)
                            const virtualShift = {
                                id: `virtual|||${shift.id}|||${dateStr}`, // Virtual ID with different separator
                                date: dateStr,
                                branch: shift.branch,
                                type: shift.type,
                                employeeId: shift.employeeId,
                                customStart: shift.customStart,
                                customEnd: shift.customEnd,
                                recurring: true, // Virtual shifts show as recurring
                                isVirtualRecurring: true, // Flag to identify virtual shifts
                                originalShiftId: shift.id
                            };
                            virtualShifts.push(virtualShift);
                        }
                    }
                }
            });
        });
    });

    return virtualShifts;
}

function getWeekKeyForDate(date) {
    const weekStart = getWeekStart(date);
    return formatDate(weekStart);
}

function getAllShiftsForDay(dateStr) {
    const weekKey = getWeekKey();
    const storedShifts = scheduleData[weekKey] && scheduleData[weekKey][dateStr] ? scheduleData[weekKey][dateStr] : [];
    
    // Get virtual recurring shifts for this date
    const virtualRecurringShifts = getVirtualRecurringShifts(dateStr);
    
    // Combine stored shifts with virtual recurring shifts
    return [...storedShifts, ...virtualRecurringShifts];
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
    if (shift.type === 'custom') {
        return `${formatTimeTo12Hour(shift.customStart)} - ${formatTimeTo12Hour(shift.customEnd)}`;
    } else {
        return SHIFT_TYPES[shift.type].display;
    }
}

function formatTimeTo12Hour(time24) {
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

    console.log(`Checking conflicts for ${shift.employeeId} on ${dateStr}: ${shiftStart}-${shiftEnd} (${shift.isVirtualRecurring ? 'virtual' : 'stored'})`);

    for (let otherShift of otherShifts) {
        console.log(`  Against: ${otherShift.employeeId} ${otherShift.type}: ${getShiftStartTime(otherShift)}-${getShiftEndTime(otherShift)}`);

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

    console.log('  → No conflict found');
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
    const originalShift = isEdit ? findShiftById(shiftId.value) : null;

    const shiftData = {
        id: shiftId.value || generateShiftId(),
        date: shiftDate.value,
        branch: shiftBranch.value,
        type: shiftType.value,
        employeeId: shiftEmployee.value || 'unassigned',
        recurring: recurringWeekly.checked
    };

    if (shiftType.value === 'custom') {
        shiftData.customStart = customStartTime.value;
        shiftData.customEnd = customEndTime.value;
    }

    if (isEdit) {
        const originalShift = findShiftById(shiftId.value);

        // Handle virtual shifts
        let shiftToEdit = originalShift;
        if (!originalShift && shiftId.value.startsWith('virtual|||')) {
            const parts = shiftId.value.split('|||');
            const originalShiftId = parts[1];
            const virtualDate = parts[2];
            const foundOriginal = findAnyShiftById(originalShiftId);

            if (foundOriginal) {
                shiftToEdit = {
                    id: shiftId.value,
                    date: virtualDate,
                    branch: foundOriginal.branch,
                    type: foundOriginal.type,
                    employeeId: foundOriginal.employeeId,
                    customStart: foundOriginal.customStart,
                    customEnd: foundOriginal.customEnd,
                    recurring: true,
                    isVirtualRecurring: true,
                    originalShiftId: originalShiftId
                };
            }
        }

        // Check if this is part of a recurring series
        if (shiftToEdit && (shiftToEdit.recurring || shiftToEdit.recurringSeriesId || shiftToEdit.isRecurringInstance || shiftToEdit.originalShiftId || shiftToEdit.isVirtualRecurring)) {
            showRecurringChoiceModal('save', shiftData, shiftToEdit);
        } else {
            updateShift(shiftData);
        }
    } else {
        addShift(shiftData);
    }

    closeModal();
    saveToLocalStorage();
    syncToFirebase(); // Immediately sync to Firebase
    renderCurrentView();
}

function convertToIndividualShift(shift) {
    delete shift.recurringSeriesId;
    delete shift.isRecurringInstance;
    delete shift.originalShiftId;
    shift.recurring = false;
}

function deleteThisAndFutureShifts(targetShift, skipCurrent = false) {
    console.log('=== DELETE THIS AND FUTURE DEBUG ===');
    console.log('Target shift:', targetShift);

    const targetDate = new Date(targetShift.date + 'T00:00:00');

    Object.keys(scheduleData).forEach(weekKey => {
        Object.keys(scheduleData[weekKey]).forEach(dateStr => {
            const shiftDate = new Date(dateStr + 'T00:00:00');
            const shouldDelete = skipCurrent ? shiftDate > targetDate : shiftDate >= targetDate;

            if (shouldDelete) {
                const shifts = scheduleData[weekKey][dateStr];
                for (let i = shifts.length - 1; i >= 0; i--) {
                    const shift = shifts[i];

                    // Match by any recurring identifier OR exact same shift pattern
                    const isRelated = (
                        shift.id === targetShift.id ||
                        (shift.recurringSeriesId && shift.recurringSeriesId === targetShift.recurringSeriesId) ||
                        (shift.originalShiftId && shift.originalShiftId === targetShift.originalShiftId) ||
                        (shift.originalShiftId === targetShift.id) ||
                        // Pattern match for shifts without proper IDs
                        (shift.employeeId === targetShift.employeeId &&
                            shift.branch === targetShift.branch &&
                            shift.type === targetShift.type &&
                            shift.recurring === true &&
                            shiftDate.getDay() === targetDate.getDay())
                    );

                    if (isRelated) {
                        console.log('DELETING related shift:', shift);
                        shifts.splice(i, 1);
                    }
                }

                if (shifts.length === 0) {
                    delete scheduleData[weekKey][dateStr];
                }
            }
        });
    });

    // Also clean up any empty week objects
    Object.keys(scheduleData).forEach(weekKey => {
        if (Object.keys(scheduleData[weekKey]).length === 0) {
            delete scheduleData[weekKey];
        }
    });

    console.log('=== END DELETE DEBUG ===');
}

function splitRecurringSeries(originalShift, newShiftData) {
    console.log('=== SPLIT RECURRING SERIES DEBUG ===');
    console.log('Original shift:', originalShift);
    console.log('New shift data:', newShiftData);

    // DON'T delete anything when user chooses "This Date Only"
    // Just convert the current shift to individual
    newShiftData.recurring = false;
    convertToIndividualShift(newShiftData);

    console.log('=== END SPLIT DEBUG ===');
}

function updateThisAndFutureShifts(originalShift, newShiftData) {
    const targetDate = new Date(originalShift.date + 'T00:00:00');
    const seriesId = originalShift.recurringSeriesId || originalShift.originalShiftId;

    Object.keys(scheduleData).forEach(weekKey => {
        Object.keys(scheduleData[weekKey]).forEach(dateStr => {
            const shiftDate = new Date(dateStr + 'T00:00:00');

            if (shiftDate >= targetDate) {
                const shifts = scheduleData[weekKey][dateStr];
                for (let i = 0; i < shifts.length; i++) {
                    const shift = shifts[i];
                    if (shift.recurringSeriesId === seriesId || shift.originalShiftId === seriesId || shift.id === originalShift.id) {
                        // Update this shift with new data
                        Object.assign(shift, {
                            branch: newShiftData.branch,
                            type: newShiftData.type,
                            employeeId: newShiftData.employeeId,
                            customStart: newShiftData.customStart,
                            customEnd: newShiftData.customEnd,
                            recurring: newShiftData.recurring
                        });
                    }
                }
            }
        });
    });
}

function handleShiftTypeChange() {
    const isCustom = shiftType.value === 'custom';
    customTimeGroup.style.display = isCustom ? 'block' : 'none';
}

async function handleShiftDelete() {
    const id = shiftId.value;
    let shift = findShiftById(id);

    // Handle virtual shifts
    if (!shift && id.startsWith('virtual|||')) {
        const parts = id.split('|||');
        const originalShiftId = parts[1];
        const virtualDate = parts[2];

        const originalShift = findAnyShiftById(originalShiftId);
        if (originalShift) {
            shift = {
                id: id,
                date: virtualDate,
                branch: originalShift.branch,
                type: originalShift.type,
                employeeId: originalShift.employeeId,
                recurring: true,
                isVirtualRecurring: true,
                originalShiftId: originalShiftId
            };
        }
    }
    if (!id || !shift) return;

    // Check if this is part of a recurring series
    if (shift.recurring || shift.recurringSeriesId || shift.isRecurringInstance || shift.originalShiftId || shift.isVirtualRecurring) {
        showRecurringChoiceModal('delete', null, shift);
    } else {
        if (confirm('Are you sure you want to delete this shift?')) {
            deleteShift(id);
            closeModal();
            saveToLocalStorage();
            syncToFirebase(); // Immediately sync to Firebase
            renderCurrentView();
        }
    }
}

function showRecurringChoiceModal(action, shiftData, originalShift) {
    pendingRecurringAction = action;
    pendingShiftData = shiftData;
    pendingOriginalShift = originalShift;

    if (action === 'save') {
        recurringChoiceTitle.textContent = 'Save Changes';
        recurringChoiceMessage.textContent = 'This is part of a recurring series. How would you like to apply the changes?';
    } else {
        recurringChoiceTitle.textContent = 'Delete Shift';
        recurringChoiceMessage.textContent = 'This is part of a recurring series. Which shifts would you like to delete?';
    }

    recurringChoiceModal.style.display = 'flex';
}

function closeRecurringChoiceModal() {
    recurringChoiceModal.style.display = 'none';
    pendingRecurringAction = null;
    pendingShiftData = null;
    pendingOriginalShift = null;
}

function handleRecurringChoice(choice) {
    console.log('=== RECURRING CHOICE DEBUG ===');
    console.log('Choice:', choice);
    console.log('Pending action:', pendingRecurringAction);

    if (pendingRecurringAction === 'save') {
        if (choice === 'thisOnly') {
            // Split at this date: convert all prior to individual, edit this one as individual, continue original pattern for future
            splitRecurringSeriesForEdit(pendingOriginalShift, pendingShiftData);
        } else {
            // Update this and future: convert all prior to individual, apply edits from this date forward
            updateThisAndFutureForEdit(pendingOriginalShift, pendingShiftData);
        }
    } else if (pendingRecurringAction === 'delete') {
        if (choice === 'thisOnly') {
            // Split at this date: convert all prior instances to individual, delete this one, make next occurrence the new recurring master
            splitRecurringSeriesAtThisDate(pendingOriginalShift);
        } else {
            // Delete this and future: convert all prior instances to individual, delete from this date forward
            convertPriorToIndividualAndDeleteFromHere(pendingOriginalShift);
        }
    }

    closeRecurringChoiceModal();
    closeModal();
    saveToLocalStorage();
    syncToFirebase(); // Immediately sync to Firebase
    renderCurrentView();

    console.log('=== END RECURRING DEBUG ===');
}

function splitRecurringSeriesForEdit(targetShift, newShiftData) {
    console.log('Splitting recurring series for edit at this date only:', targetShift.date);

    const targetDate = new Date(targetShift.date + 'T00:00:00');
    const originalShiftId = targetShift.originalShiftId || targetShift.id;

    // Step 1: Convert ALL prior instances (including original) to individual shifts
    convertAllPriorInstancesToIndividual(targetDate, originalShiftId);

    // Step 2: Apply edits to this date as individual shift
    newShiftData.recurring = false;
    delete newShiftData.isRecurringInstance;
    delete newShiftData.originalShiftId;
    delete newShiftData.recurringSeriesId;

    if (targetShift.isVirtualRecurring) {
        // Create a new individual shift for this date
        addShift(newShiftData);
    } else {
        updateShift(newShiftData);
    }

    // Step 3: Create new recurring master from next occurrence with ORIGINAL properties
    createNewRecurringMasterFromNextOccurrence(targetDate, originalShiftId);

    markLocalChanges();
}

function updateThisAndFutureForEdit(targetShift, newShiftData) {
    console.log('Updating this and future for edit:', targetShift.date);

    const targetDate = new Date(targetShift.date + 'T00:00:00');
    const originalShiftId = targetShift.originalShiftId || targetShift.id;

    // Step 1: Convert ALL prior instances (including original) to individual shifts
    convertAllPriorInstancesToIndividual(targetDate, originalShiftId);

    // Step 2: Apply edits to this date
    if (targetShift.isVirtualRecurring) {
        // Create a new shift for this date
        newShiftData.id = generateShiftId();
        addShift(newShiftData);
    } else {
        updateShift(newShiftData);
    }

    // Step 3: Handle future dates based on recurring checkbox
    if (newShiftData.recurring) {
        // Continue recurring pattern with NEW properties - update all future instances
        updateAllFutureInstances(targetDate, originalShiftId, newShiftData);
    } else {
        // Stop recurring pattern - delete all future occurrences
        deleteAllFutureOccurrences(targetDate, originalShiftId);
    }

    markLocalChanges();
}

function updateAllFutureInstances(targetDate, originalShiftId, newShiftData) {
    console.log('Updating all future instances with new properties from:', targetDate);

    Object.keys(scheduleData).forEach(weekKey => {
        Object.keys(scheduleData[weekKey]).forEach(dateStr => {
            const shiftDate = new Date(dateStr + 'T00:00:00');

            // Update shifts AFTER the target date
            if (shiftDate > targetDate) {
                scheduleData[weekKey][dateStr].forEach(shift => {
                    if (shift.originalShiftId === originalShiftId ||
                        shift.recurringSeriesId === originalShiftId) {

                        // Update with new properties but keep as recurring instances
                        shift.branch = newShiftData.branch;
                        shift.type = newShiftData.type;
                        shift.employeeId = newShiftData.employeeId;
                        shift.customStart = newShiftData.customStart;
                        shift.customEnd = newShiftData.customEnd;
                        shift.originalShiftId = newShiftData.id; // Point to new master

                        console.log('Updated future instance:', shift);
                    }
                });
            }
        });
    });
}

function deleteAllFutureOccurrences(targetDate, originalShiftId) {
    console.log('Deleting all future occurrences after:', targetDate);

    Object.keys(scheduleData).forEach(weekKey => {
        Object.keys(scheduleData[weekKey]).forEach(dateStr => {
            const shiftDate = new Date(dateStr + 'T00:00:00');

            // Delete shifts AFTER the target date
            if (shiftDate > targetDate) {
                const shifts = scheduleData[weekKey][dateStr];
                for (let i = shifts.length - 1; i >= 0; i--) {
                    const shift = shifts[i];
                    if (shift.originalShiftId === originalShiftId ||
                        shift.recurringSeriesId === originalShiftId) {

                        console.log('Deleting future occurrence:', shift);
                        shifts.splice(i, 1);
                    }
                }

                // Clean up empty date arrays
                if (shifts.length === 0) {
                    delete scheduleData[weekKey][dateStr];
                }
            }
        });
    });
}

function splitRecurringSeriesAtThisDate(targetShift) {
    console.log('Splitting recurring series at this date only:', targetShift.date);

    const targetDate = new Date(targetShift.date + 'T00:00:00');
    const originalShiftId = targetShift.originalShiftId || targetShift.id;

    // Step 1: Convert ALL prior instances (including original) to individual shifts
    convertAllPriorInstancesToIndividual(targetDate, originalShiftId);

    // Step 2: Delete this specific instance only
    if (targetShift.isVirtualRecurring) {
        // For virtual shifts, just mark as deleted - it won't appear anymore
        console.log('Virtual shift will be skipped');
    } else {
        deleteShift(targetShift.id);
    }

    // Step 3: Only create new recurring master if the user kept recurring checked
// For delete operations, we don't have newShiftData, so don't create new recurring master
// if (newShiftData.recurring) {
    // User kept it recurring for this individual edit, so continue original pattern for future
    createNewRecurringMasterFromNextOccurrence(targetDate, originalShiftId);
    // For delete operations, always delete future occurrences
    deleteAllFutureOccurrences(targetDate, originalShiftId);

    markLocalChanges();
}

function convertPriorToIndividualAndDeleteFromHere(targetShift) {
    console.log('Converting prior to individual and deleting from here:', targetShift.date);

    const targetDate = new Date(targetShift.date + 'T00:00:00');
    const originalShiftId = targetShift.originalShiftId || targetShift.id;

    // Step 1: Convert ALL prior instances (including original) to individual shifts
    convertAllPriorInstancesToIndividual(targetDate, originalShiftId);

    // Step 2: Delete this date and all future occurrences
    deleteThisAndFutureShifts(targetShift);

    markLocalChanges();
}

function convertAllPriorInstancesToIndividual(targetDate, originalShiftId) {
    console.log('Converting all prior instances to individual before:', targetDate);

    // First, find the original shift to get its properties
    const originalShift = findAnyShiftById(originalShiftId);
    if (!originalShift) return;

    const originalDate = new Date(originalShift.date + 'T00:00:00');
    const dayOfWeek = originalDate.getDay();

    // Generate and store all missing weeks between original and target as individual shifts
    let currentWeek = new Date(originalDate);
    currentWeek.setDate(originalDate.getDate() + 7); // Start from week after original

    while (currentWeek < targetDate) {
        const currentDateStr = formatDate(currentWeek);
        const currentWeekKey = getWeekKeyForDate(currentWeek);

        // Initialize data structures if needed
        if (!scheduleData[currentWeekKey]) scheduleData[currentWeekKey] = {};
        if (!scheduleData[currentWeekKey][currentDateStr]) scheduleData[currentWeekKey][currentDateStr] = [];

        // Check if this date already has a shift for this series
        const existingShift = scheduleData[currentWeekKey][currentDateStr].find(s =>
            s.originalShiftId === originalShiftId ||
            s.recurringSeriesId === originalShiftId ||
            s.id === originalShiftId
        );

        if (existingShift) {
            // Convert existing shift to individual
            existingShift.recurring = false;
            delete existingShift.isRecurringInstance;
            delete existingShift.originalShiftId;
            delete existingShift.recurringSeriesId;
            console.log('Converted existing shift to individual:', existingShift);
        } else {
            // Create new individual shift for this missing week
            const newIndividualShift = {
                id: generateShiftId(),
                date: currentDateStr,
                branch: originalShift.branch,
                type: originalShift.type,
                employeeId: originalShift.employeeId,
                customStart: originalShift.customStart,
                customEnd: originalShift.customEnd,
                recurring: false
            };

            scheduleData[currentWeekKey][currentDateStr].push(newIndividualShift);
            console.log('Created missing individual shift for week:', currentDateStr, newIndividualShift);
        }

        // Move to next week
        currentWeek.setDate(currentWeek.getDate() + 7);
    }

    // Also convert the original master shift to individual
    Object.keys(scheduleData).forEach(weekKey => {
        Object.keys(scheduleData[weekKey]).forEach(dateStr => {
            scheduleData[weekKey][dateStr].forEach(shift => {
                if (shift.id === originalShiftId) {
                    shift.recurring = false;
                    delete shift.isRecurringInstance;
                    delete shift.originalShiftId;
                    delete shift.recurringSeriesId;
                    console.log('Converted original master to individual:', shift);
                }
            });
        });
    });
}

function createNewRecurringMasterFromNextOccurrence(targetDate, originalShiftId) {
    console.log('Creating new recurring master from next occurrence after:', targetDate);

    // Find the original shift to get its properties
    const originalShift = findAnyShiftById(originalShiftId);
    if (!originalShift) return;

    // Calculate the next occurrence date
    const dayOfWeek = targetDate.getDay();
    const nextOccurrence = new Date(targetDate);
    nextOccurrence.setDate(targetDate.getDate() + 7); // Next week same day
    const nextDateStr = formatDate(nextOccurrence);
    const nextWeekKey = getWeekKeyForDate(nextOccurrence);

    // Create the new recurring master shift for next occurrence
    if (!scheduleData[nextWeekKey]) scheduleData[nextWeekKey] = {};
    if (!scheduleData[nextWeekKey][nextDateStr]) scheduleData[nextWeekKey][nextDateStr] = [];

    // Check if there's already a shift on that date for this series
    const existingIndex = scheduleData[nextWeekKey][nextDateStr].findIndex(s =>
        s.originalShiftId === originalShiftId || s.recurringSeriesId === originalShiftId
    );

    if (existingIndex !== -1) {
        // Convert existing instance to new recurring master
        const existingShift = scheduleData[nextWeekKey][nextDateStr][existingIndex];
        existingShift.recurring = true;
        delete existingShift.isRecurringInstance;
        delete existingShift.originalShiftId;
        delete existingShift.recurringSeriesId;
        console.log('Converted existing instance to new recurring master:', existingShift);
    } else {
        // Create new recurring master
        const newRecurringShift = {
            id: generateShiftId(),
            date: nextDateStr,
            branch: originalShift.branch,
            type: originalShift.type,
            employeeId: originalShift.employeeId,
            customStart: originalShift.customStart,
            customEnd: originalShift.customEnd,
            recurring: true
        };

        scheduleData[nextWeekKey][nextDateStr].push(newRecurringShift);
        console.log('Created new recurring master:', newRecurringShift);
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

        // Pre-select branch and shift type if provided
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

        // If not found, it might be a virtual recurring shift
        if (!shift && data.shiftId.startsWith('virtual|||')) {
            console.log('Handling virtual shift:', data.shiftId);
            // Extract the original shift ID and date from virtual ID
            const parts = data.shiftId.split('|||'); // virtual|||originalId|||date
            const originalShiftId = parts[1];
            const virtualDate = parts[2];
            console.log('Original shift ID:', originalShiftId, 'Virtual date:', virtualDate);

            // Find the original recurring shift
            const originalShift = findAnyShiftById(originalShiftId);
            console.log('Found original shift:', originalShift);

            if (originalShift) {
                // Create a virtual shift object for the modal
                shift = {
                    id: data.shiftId,
                    date: virtualDate,
                    branch: originalShift.branch,
                    type: originalShift.type,
                    employeeId: originalShift.employeeId,
                    customStart: originalShift.customStart,
                    customEnd: originalShift.customEnd,
                    recurring: true,
                    isVirtualRecurring: true,
                    originalShiftId: originalShiftId
                };
                console.log('Created virtual shift object:', shift);
            } else {
                console.log('Failed to find original shift for virtual shift');
                return; // Don't open modal if we can't find the data
            }
        }

        if (shift) {
            console.log('About to populate modal with shift:', shift);
            shiftId.value = shift.id;
            originalDate.value = shift.date;
            originalBranch.value = shift.branch;
            shiftDate.value = shift.date;
            shiftBranch.value = shift.branch;
            shiftType.value = shift.type;
            shiftEmployee.value = shift.employeeId;
            recurringWeekly.checked = Boolean(shift.recurring || shift.isVirtualRecurring);

            console.log('Populated modal fields:');
            console.log('Date:', shiftDate.value);
            console.log('Branch:', shiftBranch.value);
            console.log('Type:', shiftType.value);
            console.log('Employee:', shiftEmployee.value);
            console.log('Recurring:', recurringWeekly.checked);

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

function deleteShift(shiftId) {
    let deletedAny = false;

    // Delete from ALL weeks in one loop
    Object.keys(scheduleData).forEach(wKey => {
        Object.keys(scheduleData[wKey]).forEach(dateStr => {
            const shifts = scheduleData[wKey][dateStr];
            for (let i = shifts.length - 1; i >= 0; i--) {
                if (shifts[i].id === shiftId) {
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
    }
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

                    // Replace or add shift
                    const existingIndex = scheduleData[weekKey][dateStr].findIndex(s => s.id === shift.id);
                    if (existingIndex !== -1) {
                        scheduleData[weekKey][dateStr][existingIndex] = shift;
                    } else {
                        scheduleData[weekKey][dateStr].push(shift);
                    }
                });
            }
        }

        // Save to localStorage after syncing from Firebase
        saveToLocalStorage();
        updateSyncStatus('synced');

    } catch (error) {
        console.error('Error syncing from Firebase:', error);
        updateSyncStatus('local');
        throw error;
    }
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
                        recurring: shift.recurring || false,
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