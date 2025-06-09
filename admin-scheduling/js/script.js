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

function generateRecurringShiftsForCurrentWeek() {
    // DO NOTHING - disable all automatic recurring generation
    console.log('Recurring generation disabled');
}
// function generateRecurringShiftsForCurrentWeek() {
//     const currentWeekKey = getWeekKey();
//     const currentWeekDates = getWeekDates();

//     // Look for ANY recurring shifts from previous weeks
//     Object.keys(scheduleData).forEach(weekKey => {
//         if (weekKey >= currentWeekKey) return; // Skip current and future weeks

//         Object.keys(scheduleData[weekKey]).forEach(dateStr => {
//             scheduleData[weekKey][dateStr].forEach(shift => {
//                 if (shift.recurring) {
//                     const originalDate = new Date(shift.date + 'T00:00:00');
//                     const dayOfWeek = originalDate.getDay();
//                     const targetDayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
//                     const targetDate = currentWeekDates[targetDayIndex];
//                     const targetDateStr = formatDate(targetDate);

//                     if (targetDate > originalDate) {
//                         if (!scheduleData[currentWeekKey]) scheduleData[currentWeekKey] = {};
//                         if (!scheduleData[currentWeekKey][targetDateStr]) scheduleData[currentWeekKey][targetDateStr] = [];

//                         const exists = scheduleData[currentWeekKey][targetDateStr].some(s =>
//                             s.employeeId === shift.employeeId &&
//                             s.branch === shift.branch &&
//                             s.type === shift.type
//                         );

//                         if (!exists) {
//                             const newShift = {
//                                 ...shift,
//                                 id: generateShiftId(),
//                                 date: targetDateStr
//                             };
//                             scheduleData[currentWeekKey][targetDateStr].push(newShift);
//                         }
//                     }
//                 }
//             });
//         });
//     });

//     saveToLocalStorage();
// }

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
        shift.addEventListener('click', handleShiftClick);
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

        // Only show shift types that have content
        const shiftsToShow = shiftsWithContent.length > 0 ? shiftsWithContent : [];

        shiftsToShow.forEach(shiftType => {
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
                            <div class="shift-employee-block ${shift.type} ${conflict ? 'shift-conflict' : ''} ${isPastDate(dateStr) ? 'completed' : ''} ${shift.employeeId === 'unassigned' ? 'unassigned' : ''}"
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

    // Add empty row for adding new shifts
    gridHTML += `<div class="shift-branch-section">
        <div class="shift-branch-title">Add New Shift</div>
    </div>`;

    gridHTML += `<div class="shift-grid-row">
    <div class="shift-type-header">New Shift</div>`;

    // Add cells for each day
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
        block.addEventListener('click', handleShiftClick);
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

    if (e.target.classList.contains('shift-employee-block')) {
        return; // Let shift click handler handle this
    }

    const cell = e.currentTarget;
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
            <<div class="shift-block ${shift.type} ${conflict ? 'shift-conflict' : ''} ${isPastDate(dateStr) ? 'completed' : ''} ${shift.employeeId === 'unassigned' ? 'unassigned' : ''}"
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
                        <div class="shift-employee-block ${shift.type} ${conflict ? 'shift-conflict' : ''} ${isPastDate(dateStr) ? 'completed' : ''} ${shift.employeeId === 'unassigned' ? 'unassigned' : ''}"
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
        <div class="shift-type-header">New Shift</div>`;

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
        block.addEventListener('click', handleShiftClick);
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

function getAllShiftsForDay(dateStr) {
    const weekKey = getWeekKey();

    if (!scheduleData[weekKey] || !scheduleData[weekKey][dateStr]) {
        return [];
    }

    return scheduleData[weekKey][dateStr];
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

// Conflict detection
function hasConflict(shift, dateStr) {
    const allShifts = getAllShiftsForDay(dateStr);
    const otherShifts = allShifts.filter(s => s.id !== shift.id && s.employeeId === shift.employeeId);

    if (otherShifts.length === 0) return false;

    const shiftStart = getShiftStartTime(shift);
    const shiftEnd = getShiftEndTime(shift);

    for (let otherShift of otherShifts) {
        const otherStart = getShiftStartTime(otherShift);
        const otherEnd = getShiftEndTime(otherShift);

        // Check for overlap
        if ((shiftStart < otherEnd) && (shiftEnd > otherStart)) {
            return true;
        }
    }

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

    const shiftElement = e.currentTarget;
    const shiftId = shiftElement.dataset.shiftId;

    openShiftModal('edit', { shiftId });
}

function handleShiftSubmit(e) {
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
        updateShift(shiftData);
    } else {
        addShift(shiftData);
    }

    closeModal();
    saveToLocalStorage();
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
    console.log('Skip current:', skipCurrent);

    const targetDate = new Date(targetShift.date + 'T00:00:00');

    Object.keys(scheduleData).forEach(weekKey => {
        Object.keys(scheduleData[weekKey]).forEach(dateStr => {
            const shiftDate = new Date(dateStr + 'T00:00:00');
            const shouldDelete = skipCurrent ? shiftDate > targetDate : shiftDate >= targetDate;

            if (shouldDelete) {
                const shifts = scheduleData[weekKey][dateStr];
                for (let i = shifts.length - 1; i >= 0; i--) {
                    const shift = shifts[i];

                    // For recurring series: match by recurringSeriesId OR originalShiftId OR exact ID
                    const isInSameSeries = (
                        shift.id === targetShift.id ||
                        (targetShift.recurringSeriesId && shift.recurringSeriesId === targetShift.recurringSeriesId) ||
                        (targetShift.originalShiftId && shift.originalShiftId === targetShift.originalShiftId) ||
                        (shift.originalShiftId === targetShift.id) ||
                        // Fallback: match by employee, branch, type, and day of week for old shifts without IDs
                        (!shift.recurringSeriesId && !targetShift.recurringSeriesId &&
                            shift.employeeId === targetShift.employeeId &&
                            shift.branch === targetShift.branch &&
                            shift.type === targetShift.type &&
                            shift.recurring === true &&
                            new Date(shift.date + 'T00:00:00').getDay() === new Date(targetShift.date + 'T00:00:00').getDay())
                    );

                    if (isInSameSeries) {
                        console.log('DELETING shift:', shift);
                        shifts.splice(i, 1);
                    }
                }

                if (shifts.length === 0) {
                    delete scheduleData[weekKey][dateStr];
                }
            }
        });
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

function handleShiftDelete() {
    const id = shiftId.value;
    const shift = findShiftById(id);

    if (!id || !shift) return;

    if (shift.recurringSeriesId || shift.isRecurringInstance) {
        showRecurringChoiceModal('delete', null, shift);
    } else {
        if (confirm('Are you sure you want to delete this shift?')) {
            deleteShift(id);
            closeModal();
            saveToLocalStorage();
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
    console.log('Schedule data before action:', JSON.parse(JSON.stringify(scheduleData)));


    if (pendingRecurringAction === 'save') {
        if (choice === 'thisOnly') {
            updateShift(pendingShiftData);
            splitRecurringSeries(pendingOriginalShift, pendingShiftData);
        } else {
            updateThisAndFutureShifts(pendingOriginalShift, pendingShiftData);
        }
    } else if (pendingRecurringAction === 'delete') {
        if (choice === 'thisOnly') {
            deleteShift(pendingOriginalShift.id);
            convertToIndividualShift(pendingOriginalShift);
        } else {
            deleteThisAndFutureShifts(pendingOriginalShift);
        }
    }

    closeRecurringChoiceModal();
    closeModal();
    saveToLocalStorage();
    renderCurrentView();


    console.log('Schedule data after action:', JSON.parse(JSON.stringify(scheduleData)));
    console.log('=== END RECURRING DEBUG ===');
}

function deleteRecurringShifts(targetShift) {
    const targetDate = new Date(targetShift.date + 'T00:00:00');
    const seriesId = targetShift.recurringSeriesId;

    // Find all shifts in the series that are on or after the target date
    Object.keys(scheduleData).forEach(weekKey => {
        Object.keys(scheduleData[weekKey]).forEach(dateStr => {
            const shiftDate = new Date(dateStr + 'T00:00:00');

            if (shiftDate >= targetDate) {
                const shifts = scheduleData[weekKey][dateStr];
                for (let i = shifts.length - 1; i >= 0; i--) {
                    if (shifts[i].recurringSeriesId === seriesId) {
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

    markLocalChanges();
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
        const shift = findShiftById(data.shiftId);
        if (shift) {
            shiftId.value = shift.id;
            originalDate.value = shift.date;
            originalBranch.value = shift.branch;
            shiftDate.value = shift.date;
            shiftBranch.value = shift.branch;
            shiftType.value = shift.type;
            shiftEmployee.value = shift.employeeId;
            recurringWeekly.checked = shift.recurring || false;

            if (shift.type === 'custom') {
                customTimeGroup.style.display = 'block';
                customStartTime.value = shift.customStart;
                customEndTime.value = shift.customEnd;
            }
        }
    }

    shiftModal.style.display = 'flex';
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
    const weekKey = getWeekKey();

    for (let dateStr in scheduleData[weekKey]) {
        const shifts = scheduleData[weekKey][dateStr];
        const index = shifts.findIndex(s => s.id === shiftId);
        if (index !== -1) {
            shifts.splice(index, 1);
            if (shifts.length === 0) {
                delete scheduleData[weekKey][dateStr];
            }
            markLocalChanges();
            break;
        }
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
    // Load from local storage first
    loadFromLocalStorage();

    // Also try to load adjacent weeks from Firebase
    const currentWeekKey = getWeekKey();
    const prevWeek = new Date(currentWeekStart);
    prevWeek.setDate(prevWeek.getDate() - 7);
    const nextWeek = new Date(currentWeekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const weekKeysToLoad = [
        formatDate(getWeekStart(prevWeek)),
        currentWeekKey,
        formatDate(getWeekStart(nextWeek))
    ];

    // If no local data, ensure we have an empty structure
    if (Object.keys(scheduleData).length === 0) {
        scheduleData = {};
    }

    // Debug: Check what data we have
    console.log('Available weeks in data:', Object.keys(scheduleData));

    renderCurrentView();

    setTimeout(() => {
        generateRecurringShiftsForCurrentWeek();
        renderCurrentView();
    }, 100);

    // Only sync from Firebase on initial load, not on every week change
    if (!sessionStorage.getItem('initialSyncDone')) {
        try {
            await syncFromFirebase();
            sessionStorage.setItem('initialSyncDone', 'true');
        } catch (error) {
            console.error('Error syncing from Firebase:', error);
            updateSyncStatus('local');
        }
    } else {
        updateSyncStatus('local');
    }
}

async function syncFromFirebase() {
    try {
        updateSyncStatus('syncing');

        const weekKey = getWeekKey();
        console.log('Syncing from Firebase for week:', weekKey);
        const schedulesRef = collection(db, "schedules", weekKey, "shifts");
        const snapshot = await getDocs(schedulesRef);

        console.log('Firebase snapshot size:', snapshot.size);

        const firebaseData = {};

        snapshot.forEach(doc => {
            const shift = { id: doc.id, ...doc.data() };
            console.log('Found shift in Firebase:', shift);
            const dateStr = shift.date;

            if (!firebaseData[dateStr]) {
                firebaseData[dateStr] = [];
            }

            firebaseData[dateStr].push(shift);
        });

        console.log('Firebase data loaded:', firebaseData);

        // Update local data with Firebase data
        if (!scheduleData[weekKey]) {
            scheduleData[weekKey] = {};
        }
        // Only update if no local changes, or merge carefully
        if (!localChanges) {
            scheduleData[weekKey] = { ...scheduleData[weekKey], ...firebaseData };
        } else {
            // Merge only new data that doesn't conflict with local changes
            Object.keys(firebaseData).forEach(dateStr => {
                if (!scheduleData[weekKey][dateStr]) {
                    scheduleData[weekKey][dateStr] = firebaseData[dateStr];
                }
            });
        }

        // Save to localStorage
        saveToLocalStorage();

        // Re-render with new data
        renderCurrentView();

        updateSyncStatus('synced');

    } catch (error) {
        console.error('Error syncing from Firebase:', error);
        updateSyncStatus('local');
    }
}

async function syncToFirebase() {
    if (!localChanges) {
        console.log('No local changes to sync');
        return;
    }

    try {
        updateSyncStatus('syncing');

        const weekKey = getWeekKey();
        const weekData = scheduleData[weekKey] || {};

        // Upload each shift
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