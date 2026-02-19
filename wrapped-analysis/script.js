// Firebase setup
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// PayCalculator is loaded via script tag in HTML
const PayCalculator = window.PayCalculator;

const firebaseConfig = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.firebasestorage.app",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266",
    measurementId: "G-YEK4GML6SJ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Constants
const YEAR_START = new Date('2025-01-01');
const YEAR_END = new Date('2025-12-31');
const LATE_GRACE_MINUTES = 30;

const SHIFT_SCHEDULES = {
    "Opening": { timeIn: "9:30 AM", timeOut: "6:30 PM" },
    "Opening Half-Day": { timeIn: "9:30 AM", timeOut: "1:30 PM" },
    "Midshift": { timeIn: "11:00 AM", timeOut: "8:00 PM" },
    "Closing": { timeIn: "1:00 PM", timeOut: "10:00 PM" },
    "Closing Half-Day": { timeIn: "6:00 PM", timeOut: "10:00 PM" },
    "Custom": { timeIn: null, timeOut: null }
};

// State
let employees = {};
let holidays = {};
let salesData = {};
let allAttendanceData = {};
let payCalculator = null;
let analysisResults = {
    companyWide: {},
    branchComparison: {}
};
let allEmployeeStats = []; // Store all employee stats for individual view

// DOM elements
const startBtn = document.getElementById('startBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const progressSection = document.getElementById('progressSection');
const overallProgressFill = document.getElementById('overallProgressFill');
const overallProgressText = document.getElementById('overallProgressText');
const companyWideStats = document.getElementById('companyWideStats');
const branchStats = document.getElementById('branchStats');
const employeeSelect = document.getElementById('employeeSelect');
const individualStats = document.getElementById('individualStats');

// Populate employee dropdown
function populateEmployeeDropdown() {
    if (!employeeSelect) return;
    
    employeeSelect.innerHTML = '<option value="">-- Select an employee --</option>';
    
    if (allEmployeeStats.length === 0) {
        // If no stats yet, use employees object
        for (const [employeeId, employee] of Object.entries(employees)) {
            const option = document.createElement('option');
            option.value = employeeId;
            option.textContent = employee.name;
            employeeSelect.appendChild(option);
        }
    } else {
        // Sort by name
        const sorted = [...allEmployeeStats].sort((a, b) => a.name.localeCompare(b.name));
        for (const stat of sorted) {
            const option = document.createElement('option');
            option.value = stat.employeeId;
            option.textContent = stat.name;
            employeeSelect.appendChild(option);
        }
    }
}

// Display individual employee stats
function displayIndividualStats() {
    if (!employeeSelect || !individualStats) return;
    
    const employeeId = employeeSelect.value;
    
    if (!employeeId) {
        individualStats.style.display = 'none';
        return;
    }
    
    // Find employee stats
    const employeeStat = allEmployeeStats.find(e => e.employeeId === employeeId);
    
    if (!employeeStat) {
        individualStats.style.display = 'none';
        return;
    }
    
    individualStats.style.display = 'block';
    
    // Format average late time
    const avgLateTime = employeeStat.averageLateMinutes > 0 
        ? `${Math.floor(employeeStat.averageLateMinutes)} minutes` 
        : 'N/A (no late arrivals)';
    
    // Format earliest in and latest out
    const earliestInTime = minutesToTime(employeeStat.earliestIn);
    const latestOutTime = minutesToTime(employeeStat.latestOut);
    
    // Get photos for individual stats
    const individualPhotos = employeeStat.individualPhotos || {};
    
    // Create HTML
    const html = `
        <div class="individual-stats-grid">
            <div class="individual-stat-card">
                <div class="individual-stat-icon">⏰</div>
                ${individualPhotos.averageLateTime ? `<img src="${individualPhotos.averageLateTime}" alt="Selfie" class="individual-stat-photo" />` : ''}
                <div class="individual-stat-label">Average Late Time</div>
                <div class="individual-stat-value">${avgLateTime}</div>
                <div class="individual-stat-desc">Average time past scheduled time (all late arrivals)</div>
            </div>
            
            <div class="individual-stat-card">
                <div class="individual-stat-icon">🔥</div>
                ${individualPhotos.longestStreak ? `<img src="${individualPhotos.longestStreak}" alt="Selfie" class="individual-stat-photo" />` : ''}
                <div class="individual-stat-label">Longest Streak</div>
                <div class="individual-stat-value">${employeeStat.longestStreak} days</div>
                <div class="individual-stat-desc">Consecutive days worked</div>
            </div>
            
            <div class="individual-stat-card">
                <div class="individual-stat-icon">🐦</div>
                ${individualPhotos.earlyCount ? `<img src="${individualPhotos.earlyCount}" alt="Selfie" class="individual-stat-photo" />` : ''}
                <div class="individual-stat-label">Times Arrived Early</div>
                <div class="individual-stat-value">${employeeStat.earlyCount} times</div>
                <div class="individual-stat-desc">Before scheduled time</div>
            </div>
            
            <div class="individual-stat-card">
                <div class="individual-stat-icon">📅</div>
                ${individualPhotos.daysWorked ? `<img src="${individualPhotos.daysWorked}" alt="Selfie" class="individual-stat-photo" />` : ''}
                <div class="individual-stat-label">Total Days Worked</div>
                <div class="individual-stat-value">${employeeStat.daysWorked} days</div>
                <div class="individual-stat-desc">Total attendance in 2025</div>
            </div>
            
            <div class="individual-stat-card">
                <div class="individual-stat-icon">🎪</div>
                ${individualPhotos.eventCount ? `<img src="${individualPhotos.eventCount}" alt="Selfie" class="individual-stat-photo" />` : ''}
                <div class="individual-stat-label">Events Worked</div>
                <div class="individual-stat-value">${employeeStat.eventCount} events</div>
                <div class="individual-stat-desc">Workshops, pop-ups, custom events</div>
            </div>
            
            <div class="individual-stat-card">
                <div class="individual-stat-icon">🌅</div>
                ${individualPhotos.earliestIn ? `<img src="${individualPhotos.earliestIn}" alt="Selfie" class="individual-stat-photo" />` : ''}
                <div class="individual-stat-label">Earliest Clock-In</div>
                <div class="individual-stat-value">${earliestInTime}</div>
                <div class="individual-stat-desc">Your earliest arrival time</div>
            </div>
            
            <div class="individual-stat-card">
                <div class="individual-stat-icon">🌙</div>
                ${individualPhotos.latestOut ? `<img src="${individualPhotos.latestOut}" alt="Selfie" class="individual-stat-photo" />` : ''}
                <div class="individual-stat-label">Latest Clock-Out</div>
                <div class="individual-stat-value">${latestOutTime}</div>
                <div class="individual-stat-desc">Your latest departure time</div>
            </div>
        </div>
    `;
    
    individualStats.innerHTML = html;
}

// Initialize
startBtn.addEventListener('click', startAnalysis);
const pushToFirebaseBtn = document.getElementById('pushToFirebaseBtn');
pushToFirebaseBtn.addEventListener('click', pushToFirebase);
exportBtn.addEventListener('click', exportResults);
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', importResults);
if (employeeSelect) {
    employeeSelect.addEventListener('change', displayIndividualStats);
}

// Company-wide stat definitions
const COMPANY_WIDE_STATS = [
    { id: 'earlyBird', title: 'Early Bird Award', description: 'Most times arriving early' },
    { id: 'punctualOne', title: 'Most Punctual', description: 'Lowest average late time' },
    { id: 'gracePeriodMaster', title: 'Saktuhan Lang Award', description: 'Most arrivals near Grace Period' },
    { id: 'mostConsistentlyLate', title: 'Pinakalate Award', description: 'Most late arrivals' },
    { id: 'weekendWarrior', title: 'Weekend Warrior', description: 'Most weekend shifts worked' },
    { id: 'holidayHero', title: 'Holiday Hero', description: 'Most holiday shifts worked' },
    { id: 'mostFlexible', title: 'Most Flexible', description: 'Most balanced across shift types' },
    { id: 'eventSpecialist', title: 'Event Specialist', description: 'Most events worked' },
    { id: 'perfectStreak', title: 'Endurance Award', description: 'Longest consecutive days worked' },
    { id: 'otChampion', title: 'OT Lord', description: 'Most OT hours worked' },
    { id: 'mostWorkaholic', title: 'Most Workaholic', description: 'Most days worked' },
    { id: 'earningsChampion', title: 'Paldo Award', description: 'Highest total earnings' }
];

// Branch comparison stat definitions
const BRANCH_STATS = [
    { id: 'punctuality', title: 'Punctuality Battle', description: 'Average late arrivals per branch' },
    { id: 'otBattle', title: 'OT Battle', description: 'Average OT hours per branch' },
    { id: 'workaholicBattle', title: 'Workaholic Battle', description: 'Average days worked per branch' },
    { id: 'earningsBattle', title: 'Earnings Battle', description: 'Average earnings per branch' }
];

// Initialize stat cards
function initializeStatCards() {
    companyWideStats.innerHTML = COMPANY_WIDE_STATS.map(stat => `
        <div class="stat-card" id="stat-${stat.id}">
            <div class="stat-header">
                <div class="stat-title">${stat.title}</div>
                <div class="stat-status pending">Pending</div>
            </div>
            <div class="stat-content">
                <div class="stat-details">${stat.description}</div>
                <div class="stat-result" id="result-${stat.id}">-</div>
            </div>
        </div>
    `).join('');

    branchStats.innerHTML = BRANCH_STATS.map(stat => `
        <div class="stat-card" id="stat-${stat.id}">
            <div class="stat-header">
                <div class="stat-title">${stat.title}</div>
                <div class="stat-status pending">Pending</div>
            </div>
            <div class="stat-content">
                <div class="stat-details">${stat.description}</div>
                <div class="branch-comparison" id="result-${stat.id}">
                    <div class="branch-stat">
                        <div class="branch-name">Podium</div>
                        <div class="branch-value">-</div>
                    </div>
                    <div class="branch-stat">
                        <div class="branch-name">SM North</div>
                        <div class="branch-value">-</div>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

// Update stat card status
function updateStatStatus(statId, status, result = null) {
    const card = document.getElementById(`stat-${statId}`);
    if (!card) {
        console.warn(`Stat card not found: ${statId}`);
        return;
    }
    
    const statusEl = card.querySelector('.stat-status');
    const resultEl = document.getElementById(`result-${statId}`);

    if (statusEl) {
        card.className = `stat-card ${status}`;
        statusEl.className = `stat-status ${status}`;
        statusEl.textContent = status === 'analyzing' ? 'Analyzing...' : 
                              status === 'complete' ? 'Complete' : 
                              status === 'error' ? 'Error' : 'Pending';
    }

    if (result && status === 'complete') {
        // Check if this is a branch comparison stat
        const isBranchStat = BRANCH_STATS.some(s => s.id === statId);
        
        if (isBranchStat && typeof result === 'object') {
            // Branch comparison
            const podiumEl = resultEl.querySelector('.branch-stat:first-child .branch-value');
            const smNorthEl = resultEl.querySelector('.branch-stat:last-child .branch-value');
            if (podiumEl) podiumEl.textContent = result.podium || '-';
            if (smNorthEl) smNorthEl.textContent = result.smNorth || '-';
            
            // Highlight winner
            if (result.winner) {
                const winnerEl = result.winner === 'Podium' ? 
                    resultEl.querySelector('.branch-stat:first-child') :
                    resultEl.querySelector('.branch-stat:last-child');
                if (winnerEl) winnerEl.classList.add('winner');
            }
        } else {
            // Company-wide stat
            resultEl.innerHTML = result;
        }
    }
}

// Update overall progress
function updateProgress(current, total) {
    const percentage = Math.round((current / total) * 100);
    overallProgressFill.style.width = `${percentage}%`;
    overallProgressText.textContent = `${percentage}%`;
}

// Load employees
async function loadEmployees() {
    try {
        const employeesRef = collection(db, "employees");
        const snapshot = await getDocs(employeesRef);
        
        employees = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            // Only include active employees (default to true if not specified)
            if (data.active !== false) {
                employees[doc.id] = {
                    id: doc.id,
                    name: data.name,
                    baseRate: data.baseRate || 750
                };
            }
        });
        
        console.log(`Loaded ${Object.keys(employees).length} active employees`);
        return employees;
    } catch (error) {
        console.error("Error loading employees:", error);
        throw error;
    }
}

// Load holidays
async function loadHolidays() {
    try {
        const holidayDoc = await getDoc(doc(db, "config", "holidays_2025"));
        if (holidayDoc.exists()) {
            holidays = holidayDoc.data();
            console.log("Loaded holidays");
        }
        return holidays;
    } catch (error) {
        console.error("Error loading holidays:", error);
        return {};
    }
}

// Load sales data
async function loadSalesData() {
    try {
        const [smNorthSnapshot, podiumSnapshot] = await Promise.all([
            getDocs(collection(db, 'sales-data', 'sm-north', 'daily')),
            getDocs(collection(db, 'sales-data', 'podium', 'daily'))
        ]);
        
        salesData = {};
        [...smNorthSnapshot.docs, ...podiumSnapshot.docs].forEach(doc => {
            const data = doc.data();
            if (data.totalSales || (data.cash || 0) + (data.gcash || 0) + (data.maya || 0) + (data.card || 0) + (data.grab || 0) > 0) {
                salesData[doc.id] = data;
            }
        });
        
        console.log(`Loaded ${Object.keys(salesData).length} sales records`);
        return salesData;
    } catch (error) {
        console.error("Error loading sales data:", error);
        return {};
    }
}

// Load all attendance data for 2025
async function loadAllAttendanceData() {
    console.log("Loading all attendance data for 2025...");
    allAttendanceData = {};
    
    const employeeIds = Object.keys(employees);
    const startDateStr = formatDate(YEAR_START);
    const endDateStr = formatDate(YEAR_END);
    
    for (let i = 0; i < employeeIds.length; i++) {
        const employeeId = employeeIds[i];
        const employeeName = employees[employeeId].name;
        console.log(`Loading data for ${employeeName} (${i + 1}/${employeeIds.length})...`);
        
        try {
            const attendanceRef = collection(db, "attendance", employeeId, "dates");
            const snapshot = await getDocs(attendanceRef);
            
            allAttendanceData[employeeId] = [];
            snapshot.forEach(doc => {
                const dateStr = doc.id;
                const dateObj = new Date(dateStr);
                
                // Only include 2025 data
                if (dateObj >= YEAR_START && dateObj <= YEAR_END) {
                    const data = doc.data();
                    allAttendanceData[employeeId].push({
                        date: dateStr,
                        ...data
                    });
                }
            });
            
            console.log(`  Loaded ${allAttendanceData[employeeId].length} records for ${employeeName}`);
        } catch (error) {
            console.error(`Error loading data for ${employeeName}:`, error);
            allAttendanceData[employeeId] = [];
        }
    }
    
    console.log("Finished loading all attendance data");
    return allAttendanceData;
}

// Calculate late minutes
function calculateLateMinutes(timeIn, scheduledIn) {
    if (!timeIn || !scheduledIn) return 0;
    
    const timeInMinutes = timeToMinutes(timeIn);
    const scheduledMinutes = timeToMinutes(scheduledIn);
    
    if (timeInMinutes === null || scheduledMinutes === null) return 0;
    
    const late = timeInMinutes - scheduledMinutes;
    return late > LATE_GRACE_MINUTES ? late : 0;
}

// Calculate shift hours from scheduled in and out times
function calculateShiftHours(timeInStr, timeOutStr) {
    if (!timeInStr || !timeOutStr) return null;
    
    try {
        const timeInMinutes = timeToMinutes(timeInStr);
        const timeOutMinutes = timeToMinutes(timeOutStr);
        
        if (timeInMinutes === null || timeOutMinutes === null) return null;
        
        let minutesDiff = timeOutMinutes - timeInMinutes;
        
        // Handle midnight crossover
        if (minutesDiff < 0) {
            minutesDiff += 24 * 60;
        }
        
        const hours = minutesDiff / 60;
        
        // Prevent unreasonably long shifts (over 20 hours)
        if (hours > 20) {
            return null;
        }
        
        return hours;
    } catch (error) {
        console.error("Error calculating shift hours:", error);
        return null;
    }
}

// Convert time string to minutes
function timeToMinutes(timeStr) {
    if (!timeStr) return null;
    
    // Handle formats like "9:30 AM", "09:30 AM", "9:30:00 AM"
    const match = timeStr.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i);
    if (!match) return null;
    
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toUpperCase();
    
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    return hours * 60 + minutes;
}

// Convert minutes to time string (HH:MM AM/PM)
function minutesToTime(minutes) {
    if (minutes === null || minutes === undefined) return 'N/A';
    
    let hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    
    if (hours > 12) hours -= 12;
    if (hours === 0) hours = 12;
    
    return `${hours}:${String(mins).padStart(2, '0')} ${period}`;
}

// Calculate hours between two time strings
function calculateHours(timeInStr, timeOutStr) {
    if (!timeInStr || !timeOutStr) return null;
    
    const timeInMinutes = timeToMinutes(timeInStr);
    const timeOutMinutes = timeToMinutes(timeOutStr);
    
    if (timeInMinutes === null || timeOutMinutes === null) return null;
    
    let diff = timeOutMinutes - timeInMinutes;
    
    // Handle midnight crossover
    if (diff < 0) {
        diff += 24 * 60;
    }
    
    return diff / 60;
}

// Calculate OT hours for a day
function calculateOTHours(dateEntry, employee) {
    if (!dateEntry.hasOTPay) return 0;
    
    const normalized = payCalculator._normalizeAttendanceEntry({
        date: dateEntry.date,
        timeIn: dateEntry.clockIn?.time,
        timeOut: dateEntry.clockOut?.time,
        shift: dateEntry.clockIn?.shift || 'Opening',
        scheduledIn: dateEntry.scheduledIn || dateEntry.clockIn?.shift ? SHIFT_SCHEDULES[dateEntry.clockIn.shift]?.timeIn : null,
        scheduledOut: dateEntry.scheduledOut || dateEntry.clockIn?.shift ? SHIFT_SCHEDULES[dateEntry.clockIn.shift]?.timeOut : null
    });
    
    if (!normalized.timeIn || !normalized.timeOut) return 0;
    
    const timeInMinutes = timeToMinutes(normalized.timeIn);
    const timeOutMinutes = timeToMinutes(normalized.timeOut);
    
    if (timeInMinutes === null || timeOutMinutes === null) return 0;
    
    const workedMinutes = timeOutMinutes - timeInMinutes;
    const scheduledMinutes = normalized.scheduledOut && normalized.scheduledIn ? 
        (timeToMinutes(normalized.scheduledOut) - timeToMinutes(normalized.scheduledIn)) : 
        480; // 8 hours default
    
    const otMinutes = Math.max(0, workedMinutes - scheduledMinutes);
    return otMinutes / 60;
}

// Calculate total earnings for an employee
async function calculateEmployeeEarnings(employeeId) {
    const employee = employees[employeeId];
    const attendanceRecords = allAttendanceData[employeeId] || [];
    
    let totalEarnings = 0;
    
    for (const record of attendanceRecords) {
        const dateEntry = {
            date: record.date,
            timeIn: record.clockIn?.time,
            timeOut: record.clockOut?.time,
            branch: record.clockIn?.branch,
            shift: record.clockIn?.shift || 'Opening',
            scheduledIn: record.scheduledIn,
            scheduledOut: record.scheduledOut,
            hasOTPay: record.hasOTPay || false,
            hasFixedPay: record.hasFixedPay || false,
            fixedPayAmount: record.fixedPayAmount || 0,
            hasDoublePay: record.hasDoublePay || false,
            hasMealAllowance: record.hasMealAllowance !== false,
            transpoAllowance: record.transpoAllowance || 0
        };
        
        const result = payCalculator.calculateTotalPay([dateEntry], employee, 'simple');
        totalEarnings += result;
    }
    
    return totalEarnings;
}

// Check if branch is an event location
function isEventLocation(branch) {
    const eventBranches = ['Workshop', 'Pop-up', 'Other Events'];
    return eventBranches.includes(branch) || branch?.toLowerCase().includes('popup') || branch?.toLowerCase().includes('workshop');
}

// Format date
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Calculate company-wide stats
async function calculateCompanyWideStats() {
    console.log("Calculating company-wide stats...");
    
    const stats = {
        averageLateKing: { first: null, second: null, third: null },
        mostConsistentlyLate: { first: null, second: null, third: null },
        gracePeriodMaster: { first: null, second: null, third: null },
        earlyBird: { first: null, second: null, third: null },
        mostPromptIn: { first: null, second: null, third: null },
        mostOnTimeOut: { first: null, second: null, third: null },
        weekendWarrior: { first: null, second: null, third: null },
        holidayHero: { first: null, second: null, third: null },
        mostFlexible: { first: null, second: null, third: null },
        closingSpecialist: { first: null, second: null, third: null },
        openingSpecialist: { first: null, second: null, third: null },
        perfectStreak: { first: null, second: null, third: null },
        branchHopper: { first: null, second: null, third: null },
        otChampion: { first: null, second: null, third: null },
        mostWorkaholic: { first: null, second: null, third: null },
        punctualOne: { first: null, second: null, third: null },
        eventSpecialist: { first: null, second: null, third: null },
        earningsChampion: { first: null, second: null, third: null }
    };
    
    const employeeIds = Object.keys(employees);
    
    // Calculate all stats in parallel where possible
    const employeeStats = [];
    
    for (const employeeId of employeeIds) {
        const employee = employees[employeeId];
        const records = allAttendanceData[employeeId] || [];
        
        let lateCount = 0;
        let totalLateMinutes = 0;
        let totalLateMinutesForAverage = 0; // All late arrivals (including grace period) for average
        let lateCountForAverage = 0; // Count of all late arrivals (including grace period) for average
        let maxLateMinutes = 0; // Track worst late for late hours champion
        let gracePeriodCount = 0; // Arrivals within 30 min grace period (late but within grace)
        let earlyCount = 0; // Arrivals before scheduled time
        let earliestIn = null; // Earliest clock-in time
        let latestOut = null; // Latest clock-out time
        let earliestInPhoto = null; // Photo from earliest clock-in
        let latestOutPhoto = null; // Photo from latest clock-out
        let promptInCount = 0; // Clock in within 5 minutes of scheduled time
        let onTimeOutCount = 0; // Clock out within 5 minutes of scheduled time
        let weekendCount = 0;
        let holidayCount = 0;
        const shiftTypes = new Set(); // Track different shift types (for unique count)
        const shiftTypeCounts = {}; // Track counts per shift type: { shiftType: count }
        const branchShifts = {}; // Track shifts per branch: { branchName: count }
        let closingCount = 0;
        let openingCount = 0;
        let totalOTHours = 0;
        let daysWorked = 0;
        let eventCount = 0;
        let onTimeCount = 0;
        let totalDaysWithClockIn = 0;
        const datesWorked = []; // For perfect streak calculation
        
        // Photo tracking for first place winners
        const lateSelfies = []; // Random late selfies
        let worstLateDayPhoto = null; // Photo from day with most late minutes
        const gracePeriodSelfies = []; // Grace period selfies
        const earlySelfies = []; // Early arrival selfies
        const promptInSelfies = []; // Prompt in selfies
        const onTimeOutSelfies = []; // On-time out selfies
        const weekendSelfies = []; // Weekend selfies
        const holidaySelfies = []; // Holiday selfies
        const closingSelfies = []; // Closing shift selfies
        const openingSelfies = []; // Opening shift selfies
        const streakSelfies = []; // Selfies from streak period
        const otSelfies = []; // OT day selfies
        const eventSelfies = []; // Event selfies
        const onTimeSelfies = []; // On-time arrival selfies (for punctual one)
        const branchSelfies = []; // Selfies from different branches
        
        for (const record of records) {
            if (!record.clockIn) continue;
            
            const recordDate = new Date(record.date);
            daysWorked++;
            totalDaysWithClockIn++;
            datesWorked.push(record.date);
            
            // Check for late
            const scheduledIn = record.scheduledIn || 
                (record.clockIn.shift && SHIFT_SCHEDULES[record.clockIn.shift]?.timeIn) ||
                '9:30 AM';
            
            const timeInMinutes = timeToMinutes(record.clockIn.time);
            const scheduledMinutes = timeToMinutes(scheduledIn);
            
            // Track earliest clock-in time
            if (timeInMinutes !== null) {
                if (earliestIn === null || timeInMinutes < earliestIn) {
                    earliestIn = timeInMinutes;
                    if (record.clockIn?.selfie) {
                        earliestInPhoto = record.clockIn.selfie;
                    }
                }
            }
            
            if (timeInMinutes !== null && scheduledMinutes !== null) {
                const lateMinutes = timeInMinutes - scheduledMinutes;
                
                // Check for prompt in (within 5 minutes of scheduled time, can be early or late)
                if (Math.abs(lateMinutes) <= 5) {
                    promptInCount++;
                }
                
                // Track ALL late arrivals (including grace period) for average calculation
                if (lateMinutes > 0) {
                    totalLateMinutesForAverage += lateMinutes;
                    lateCountForAverage++;
                }
                
                if (lateMinutes > LATE_GRACE_MINUTES) {
                    lateCount++;
                    totalLateMinutes += lateMinutes;
                    
                    // Track late selfie
                    if (record.clockIn?.selfie) {
                        lateSelfies.push(record.clockIn.selfie);
                    }
                    
                    // Track worst late day photo (for average late king)
                    if (lateMinutes > maxLateMinutes) {
                        maxLateMinutes = lateMinutes;
                        if (record.clockIn?.selfie) {
                            worstLateDayPhoto = record.clockIn.selfie;
                        }
                    }
                } else if (lateMinutes >= 20 && lateMinutes <= LATE_GRACE_MINUTES) {
                    // Grace period: 20-30 minutes late (not including reasonably early or just slightly late)
                    gracePeriodCount++;
                    if (record.clockIn?.selfie) {
                        gracePeriodSelfies.push(record.clockIn.selfie);
                    }
                } else if (lateMinutes < 0) {
                    earlyCount++;
                    if (record.clockIn?.selfie) {
                        earlySelfies.push(record.clockIn.selfie);
                    }
                } else {
                    // On time (exactly on time or very close, within 5 minutes)
                    onTimeCount++;
                    if (record.clockIn?.selfie) {
                        onTimeSelfies.push(record.clockIn.selfie);
                    }
                }
                
                // Track prompt in selfie (within 5 minutes, can be early or late)
                if (Math.abs(lateMinutes) <= 5 && record.clockIn?.selfie) {
                    promptInSelfies.push(record.clockIn.selfie);
                }
            }
            
            // Check for on-time out (within 5 minutes of scheduled out time)
            if (record.clockOut?.time) {
                // Get scheduled out time - use stored value if available, otherwise derive from shift
                const scheduledOut = record.scheduledOut || 
                    (record.clockIn?.shift && SHIFT_SCHEDULES[record.clockIn.shift]?.timeOut) ||
                    null;
                
                if (scheduledOut) {
                    const timeOutMinutes = timeToMinutes(record.clockOut.time);
                    const scheduledOutMinutes = timeToMinutes(scheduledOut);
                    
                    // Track latest clock-out time
                    if (timeOutMinutes !== null) {
                        if (latestOut === null || timeOutMinutes > latestOut) {
                            latestOut = timeOutMinutes;
                            if (record.clockOut?.selfie) {
                                latestOutPhoto = record.clockOut.selfie;
                            }
                        }
                    }
                    
                    if (timeOutMinutes !== null && scheduledOutMinutes !== null) {
                        const diffMinutes = Math.abs(timeOutMinutes - scheduledOutMinutes);
                        if (diffMinutes <= 5) {
                            onTimeOutCount++;
                            if (record.clockOut?.selfie) {
                                onTimeOutSelfies.push(record.clockOut.selfie);
                            }
                        }
                    }
                }
            }
            
            // Check for OT
            const hasOT = calculateOTHours(record, employee) > 0;
            if (hasOT) {
                totalOTHours += calculateOTHours(record, employee);
                if (record.clockIn?.selfie) {
                    otSelfies.push(record.clockIn.selfie);
                }
            }
            
            // Check for weekend
            const dayOfWeek = recordDate.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                weekendCount++;
                if (record.clockIn?.selfie) {
                    weekendSelfies.push(record.clockIn.selfie);
                }
            }
            
            // Check for holiday
            if (holidays[record.date]) {
                holidayCount++;
                if (record.clockIn?.selfie) {
                    holidaySelfies.push(record.clockIn.selfie);
                }
            }
            
            // Track shift types
            const shift = record.clockIn.shift || 'Custom';
            shiftTypes.add(shift);
            // Track shift type counts for most flexible calculation
            if (!shiftTypeCounts[shift]) {
                shiftTypeCounts[shift] = 0;
            }
            shiftTypeCounts[shift]++;
            
            if (shift.includes('Closing')) {
                closingCount++;
                if (record.clockIn?.selfie) {
                    closingSelfies.push(record.clockIn.selfie);
                }
            } else if (shift.includes('Opening')) {
                openingCount++;
                if (record.clockIn?.selfie) {
                    openingSelfies.push(record.clockIn.selfie);
                }
            }
            
            // Track branches (excluding event locations) - count shifts per branch
            const branch = record.clockIn.branch;
            if (branch && !isEventLocation(branch)) {
                // Only count regular branches, not event locations
                if (!branchShifts[branch]) {
                    branchShifts[branch] = 0;
                }
                branchShifts[branch]++;
                if (record.clockIn?.selfie) {
                    branchSelfies.push(record.clockIn.selfie);
                }
            }
            
            // Check for events
            if (isEventLocation(branch)) {
                eventCount++;
                if (record.clockIn?.selfie) {
                    eventSelfies.push(record.clockIn.selfie);
                }
            }
            
            // Track any selfie for general stats
            if (record.clockIn?.selfie) {
                streakSelfies.push(record.clockIn.selfie);
            }
        }
        
        // Calculate perfect streak
        let longestStreak = 0;
        if (datesWorked.length > 0) {
            datesWorked.sort();
            let currentStreak = 1;
            for (let i = 1; i < datesWorked.length; i++) {
                const prevDate = new Date(datesWorked[i - 1]);
                const currDate = new Date(datesWorked[i]);
                const daysDiff = Math.floor((currDate - prevDate) / (1000 * 60 * 60 * 24));
                
                if (daysDiff === 1) {
                    currentStreak++;
                } else {
                    longestStreak = Math.max(longestStreak, currentStreak);
                    currentStreak = 1;
                }
            }
            longestStreak = Math.max(longestStreak, currentStreak);
        }
        
        const onTimeRate = totalDaysWithClockIn > 0 ? (onTimeCount / totalDaysWithClockIn) * 100 : 0;
        
        // Calculate earnings
        const earnings = await calculateEmployeeEarnings(employeeId);
        
        // Calculate average late time (all late arrivals including grace period)
        // Only calculate if employee has at least 20 shifts
        const averageLateMinutes = (lateCountForAverage > 0 && daysWorked >= 20) 
            ? totalLateMinutesForAverage / lateCountForAverage 
            : 0;
        
        // Calculate branch hopper score using formula:
        // balance_distance = abs((sm / total) - 0.5)
        // hopper_score = (1 - balance_distance * 2) * ln(total + 1)
        let branchHopperScore = 0;
        const podiumShifts = branchShifts['Podium'] || 0;
        const smNorthShifts = branchShifts['SM North'] || 0;
        const totalBranchShifts = podiumShifts + smNorthShifts;
        
        // Calculate if worked at both branches
        if (podiumShifts > 0 && smNorthShifts > 0 && totalBranchShifts > 0) {
            // Calculate balance distance from perfect 50/50 split
            const balanceDistance = Math.abs((smNorthShifts / totalBranchShifts) - 0.5);
            // Calculate score: (1 - balance_distance * 2) * ln(total + 1)
            branchHopperScore = (1 - balanceDistance * 2) * Math.log(totalBranchShifts + 1);
        }
        
        // Calculate most flexible score using Shannon entropy formula:
        // total = sum(counts)
        // if total < 10 → skip
        // p_i = c_i / total
        // entropy = - Σ (p_i * ln(p_i))
        // diversity = entropy / ln(6)
        // flexibility_score = diversity * ln(total + 1)
        let mostFlexibleScore = 0;
        const total = daysWorked; // Total shifts worked
        
        // Skip if total < 10
        if (total >= 10 && Object.keys(shiftTypeCounts).length > 0) {
            // Calculate proportions p_i = c_i / total
            const proportions = {};
            for (const [shiftType, count] of Object.entries(shiftTypeCounts)) {
                proportions[shiftType] = count / total;
            }
            
            // Calculate entropy = - Σ (p_i * ln(p_i))
            let entropy = 0;
            for (const p_i of Object.values(proportions)) {
                if (p_i > 0) { // Only calculate if p_i > 0 (ln(0) is undefined)
                    entropy -= p_i * Math.log(p_i);
                }
            }
            
            // Calculate diversity = entropy / ln(6) (normalize by max entropy for 6 shift types)
            const maxEntropy = Math.log(6);
            const diversity = entropy / maxEntropy;
            
            // Final score: diversity * ln(total + 1)
            mostFlexibleScore = diversity * Math.log(total + 1);
        }
        
        // Helper to get multiple random photos (3-5 options)
        function getRandomPhotos(photos, count = 5) {
            if (!photos || photos.length === 0) return [];
            const shuffled = [...photos];
            // Shuffle array
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            // Return 3-5 photos (or all if fewer available)
            return shuffled.slice(0, Math.min(count, shuffled.length));
        }
        
        // Helper to get a single random photo (for default selection)
        function getRandomPhoto(photos) {
            if (!photos || photos.length === 0) return null;
            return photos[Math.floor(Math.random() * photos.length)];
        }
        
        employeeStats.push({
            employeeId,
            name: employee.name,
            lateCount,
            totalLateMinutes,
            totalLateHours: totalLateMinutes / 60,
            gracePeriodCount,
            earlyCount,
            promptInCount,
            onTimeOutCount,
            weekendCount,
            holidayCount,
            shiftTypeCount: shiftTypes.size, // Unique shift types (for display)
            shiftTypeCounts, // Counts per shift type (for reference)
            mostFlexibleScore, // Score for most flexible (evenness × total)
            branchHopperScore, // Score for branch hopper (evenness × total)
            branchShifts, // Shifts per branch for reference
            closingCount,
            openingCount,
            longestStreak,
            totalOTHours,
            daysWorked,
            eventCount,
            onTimeRate,
            earnings,
            averageLateMinutes, // Average late time (all late arrivals)
            earliestIn, // Earliest clock-in time (in minutes)
            latestOut, // Latest clock-out time (in minutes)
            // Photos for individual stats
            individualPhotos: {
                averageLateTime: getRandomPhoto(lateSelfies), // Random late selfie
                longestStreak: getRandomPhoto(streakSelfies), // Random selfie
                earlyCount: getRandomPhoto(earlySelfies), // Random early selfie
                daysWorked: getRandomPhoto(streakSelfies), // Random selfie
                eventCount: getRandomPhoto(eventSelfies), // Random event selfie
                earliestIn: earliestInPhoto, // Actual earliest in selfie
                latestOut: latestOutPhoto // Actual latest out selfie
            },
            // Photos for first place display - store arrays of 3-5 options
            photos: {
                earlyBird: getRandomPhotos(earlySelfies, 5),
                punctualOne: getRandomPhotos(onTimeSelfies, 5),
                gracePeriodMaster: getRandomPhotos(gracePeriodSelfies, 5),
                mostConsistentlyLate: getRandomPhotos(lateSelfies, 5),
                weekendWarrior: getRandomPhotos(weekendSelfies, 5),
                holidayHero: getRandomPhotos(holidaySelfies, 5),
                mostFlexible: getRandomPhotos(streakSelfies, 5), // Any selfie
                eventSpecialist: getRandomPhotos(eventSelfies, 5),
                perfectStreak: getRandomPhotos(streakSelfies, 5),
                otChampion: getRandomPhotos(otSelfies, 5),
                mostWorkaholic: getRandomPhotos(streakSelfies, 5), // Any selfie
                earningsChampion: getRandomPhotos(streakSelfies, 5) // Any selfie
            },
            // Store selected photo index for each stat (defaults to 0)
            selectedPhotoIndex: {
                earlyBird: 0,
                punctualOne: 0,
                gracePeriodMaster: 0,
                mostConsistentlyLate: 0,
                weekendWarrior: 0,
                holidayHero: 0,
                mostFlexible: 0,
                eventSpecialist: 0,
                perfectStreak: 0,
                otChampion: 0,
                mostWorkaholic: 0,
                earningsChampion: 0
            }
        });
    }
    
    // Sort employees for each category to get top 3
    const sortedByAverageLate = [...employeeStats]
        .filter(e => e.averageLateMinutes > 0) // Only those with late arrivals
        .sort((a, b) => b.averageLateMinutes - a.averageLateMinutes);
    const sortedByOT = [...employeeStats].sort((a, b) => b.totalOTHours - a.totalOTHours);
    const sortedByDays = [...employeeStats].sort((a, b) => b.daysWorked - a.daysWorked);
    // Punctual one: lowest average late time (only those with late arrivals, minimum 15 shifts)
    const sortedByPunctual = [...employeeStats]
        .filter(e => e.daysWorked >= 15 && e.averageLateMinutes > 0) // Minimum 15 shifts and has late arrivals
        .sort((a, b) => a.averageLateMinutes - b.averageLateMinutes); // Lower is better
    
    // Pinakalate Award: most late arrivals (count, not rate)
    const sortedByConsistentlyLate = [...employeeStats]
        .filter(e => e.daysWorked >= 15) // Minimum 15 shifts
        .sort((a, b) => b.lateCount - a.lateCount);
    const sortedByEvents = [...employeeStats].sort((a, b) => b.eventCount - a.eventCount);
    const sortedByEarnings = [...employeeStats].sort((a, b) => b.earnings - a.earnings);
    
    // Helper function to handle ties
    function getTop3WithTies(sortedArray, getValue, statId = null) {
        if (!sortedArray || sortedArray.length === 0) return { first: null, second: null, third: null };
        
        // Helper to compare values (handles objects, numbers, etc.)
        function valuesEqual(a, b) {
            if (typeof a === 'object' && typeof b === 'object') {
                return JSON.stringify(a) === JSON.stringify(b);
            }
            return a === b;
        }
        
        // Helper to get selected photo for employee (returns the currently selected photo)
        function getPhoto(emp, statId) {
            if (!statId || !emp.photos) return null;
            const photoOptions = emp.photos[statId];
            if (!photoOptions || !Array.isArray(photoOptions) || photoOptions.length === 0) return null;
            const selectedIndex = emp.selectedPhotoIndex?.[statId] || 0;
            return photoOptions[selectedIndex] || photoOptions[0] || null;
        }
        
        // Helper to get all photo options for employee
        function getPhotoOptions(emp, statId) {
            if (!statId || !emp.photos) return [];
            const photoOptions = emp.photos[statId];
            return Array.isArray(photoOptions) ? photoOptions : [];
        }
        
        // Helper to get additional properties for specific stats
        function getAdditionalProps(emp, statId) {
            const props = {};
            if (statId === 'mostFlexible' && emp.shiftTypeCount !== undefined) {
                props.shiftTypeCount = emp.shiftTypeCount;
            }
            return props;
        }
        
        const first = sortedArray[0];
        const firstValue = getValue(first);
        
        // Find all tied for first
        const firstTied = sortedArray.filter(e => valuesEqual(getValue(e), firstValue));
        
        // Always try to return 3 ranks, even if first place has ties
        // If 3+ people tied for first, they all share first place
        // But we still try to find second and third if there are more people
        if (firstTied.length >= 3 && firstTied.length >= sortedArray.length) {
            // All people tied for first, no second/third possible
            return {
                first: firstTied.map(e => ({ 
                    employeeId: e.employeeId, 
                    name: e.name, 
                    value: getValue(e), 
                    photo: getPhoto(e, statId),
                    photoOptions: getPhotoOptions(e, statId),
                    selectedPhotoIndex: e.selectedPhotoIndex?.[statId] || 0,
                    tied: true,
                    ...getAdditionalProps(e, statId)
                })),
                second: null,
                third: null
            };
        }
        
        // Find second place (skip first place ties)
        const secondStart = firstTied.length;
        if (secondStart >= sortedArray.length) {
            return {
                first: firstTied.length > 1 ? 
                    firstTied.map(e => ({ 
                        employeeId: e.employeeId, 
                        name: e.name, 
                        value: getValue(e), 
                        photo: getPhoto(e, statId),
                        photoOptions: getPhotoOptions(e, statId),
                        selectedPhotoIndex: e.selectedPhotoIndex?.[statId] || 0,
                        tied: true,
                        ...getAdditionalProps(e, statId)
                    })) :
                    { 
                        employeeId: firstTied[0].employeeId, 
                        name: firstTied[0].name, 
                        value: getValue(firstTied[0]), 
                        photo: getPhoto(firstTied[0], statId),
                        photoOptions: getPhotoOptions(firstTied[0], statId),
                        selectedPhotoIndex: firstTied[0].selectedPhotoIndex?.[statId] || 0,
                        tied: false,
                        ...getAdditionalProps(firstTied[0], statId)
                    },
                second: null,
                third: null
            };
        }
        
        const second = sortedArray[secondStart];
        const secondValue = getValue(second);
        const secondTied = sortedArray.slice(secondStart).filter(e => valuesEqual(getValue(e), secondValue));
        
        // Continue to find second and third place
        // We want 3 ranks, not 3 people, so even if first is tied, we still find second and third
        
        // Find third place
        const thirdStart = secondStart + secondTied.length;
        if (thirdStart >= sortedArray.length) {
            return {
                first: firstTied.length > 1 ? 
                    firstTied.map(e => ({ 
                        employeeId: e.employeeId, 
                        name: e.name, 
                        value: getValue(e), 
                        photo: getPhoto(e, statId),
                        photoOptions: getPhotoOptions(e, statId),
                        selectedPhotoIndex: e.selectedPhotoIndex?.[statId] || 0,
                        tied: true,
                        ...getAdditionalProps(e, statId)
                    })) :
                    { 
                        employeeId: firstTied[0].employeeId, 
                        name: firstTied[0].name, 
                        value: getValue(firstTied[0]), 
                        photo: getPhoto(firstTied[0], statId),
                        photoOptions: getPhotoOptions(firstTied[0], statId),
                        selectedPhotoIndex: firstTied[0].selectedPhotoIndex?.[statId] || 0,
                        tied: false,
                        ...getAdditionalProps(firstTied[0], statId)
                    },
                second: secondTied.length > 0 ? (secondTied.length > 1 ? 
                    secondTied.map(e => ({ 
                        employeeId: e.employeeId, 
                        name: e.name, 
                        value: getValue(e), 
                        photo: null,
                        tied: true,
                        ...getAdditionalProps(e, statId)
                    })) :
                    { 
                        employeeId: secondTied[0].employeeId, 
                        name: secondTied[0].name, 
                        value: getValue(secondTied[0]), 
                        photo: null,
                        tied: false,
                        ...getAdditionalProps(secondTied[0], statId)
                    }) : null,
                third: null
            };
        }
        
        const third = sortedArray[thirdStart];
        const thirdValue = getValue(third);
        const thirdTied = sortedArray.slice(thirdStart).filter(e => valuesEqual(getValue(e), thirdValue));
        
        return {
            first: firstTied.length > 1 ? 
                firstTied.map(e => ({ 
                    employeeId: e.employeeId, 
                    name: e.name, 
                    value: getValue(e), 
                    photo: getPhoto(e, statId),
                    photoOptions: getPhotoOptions(e, statId),
                    selectedPhotoIndex: e.selectedPhotoIndex?.[statId] || 0,
                    tied: true,
                    ...getAdditionalProps(e, statId)
                })) :
                { 
                    employeeId: firstTied[0].employeeId, 
                    name: firstTied[0].name, 
                    value: getValue(firstTied[0]), 
                    photo: getPhoto(firstTied[0], statId),
                    photoOptions: getPhotoOptions(firstTied[0], statId),
                    selectedPhotoIndex: firstTied[0].selectedPhotoIndex?.[statId] || 0,
                    tied: false,
                    ...getAdditionalProps(firstTied[0], statId)
                },
            second: secondTied.length > 0 ? (secondTied.length > 1 ? 
                secondTied.map(e => ({ 
                    employeeId: e.employeeId, 
                    name: e.name, 
                    value: getValue(e), 
                    photo: null,
                    tied: true,
                    ...getAdditionalProps(e, statId)
                })) :
                { 
                    employeeId: secondTied[0].employeeId, 
                    name: secondTied[0].name, 
                    value: getValue(secondTied[0]), 
                    photo: null,
                    tied: false,
                    ...getAdditionalProps(secondTied[0], statId)
                }) : null,
            third: thirdTied.length > 0 ? (thirdTied.length > 1 ? 
                thirdTied.map(e => ({ 
                    employeeId: e.employeeId, 
                    name: e.name, 
                    value: getValue(e), 
                    photo: null,
                    tied: true,
                    ...getAdditionalProps(e, statId)
                })) :
                { 
                    employeeId: thirdTied[0].employeeId, 
                    name: thirdTied[0].name, 
                    value: getValue(thirdTied[0]), 
                    photo: null,
                    tied: false,
                    ...getAdditionalProps(thirdTied[0], statId)
                }) : null
        };
    }
    
    // Additional sorting for new stats
    const sortedByGracePeriod = [...employeeStats].sort((a, b) => b.gracePeriodCount - a.gracePeriodCount);
    const sortedByEarlyBird = [...employeeStats].sort((a, b) => b.earlyCount - a.earlyCount);
    const sortedByPromptIn = [...employeeStats].sort((a, b) => b.promptInCount - a.promptInCount);
    const sortedByOnTimeOut = [...employeeStats].sort((a, b) => b.onTimeOutCount - a.onTimeOutCount);
    const sortedByWeekend = [...employeeStats].sort((a, b) => b.weekendCount - a.weekendCount);
    const sortedByHoliday = [...employeeStats].sort((a, b) => b.holidayCount - a.holidayCount);
    // Most Flexible: only include those with at least 10 shifts (handled in calculation, but filter for safety)
    const sortedByFlexible = [...employeeStats]
        .filter(e => e.mostFlexibleScore > 0) // Only those who meet the 10 shift minimum
        .sort((a, b) => b.mostFlexibleScore - a.mostFlexibleScore);
    const sortedByClosing = [...employeeStats].sort((a, b) => b.closingCount - a.closingCount);
    const sortedByOpening = [...employeeStats].sort((a, b) => b.openingCount - a.openingCount);
    const sortedByStreak = [...employeeStats].sort((a, b) => b.longestStreak - a.longestStreak);
    // Branch hopper: most even split between Podium and SM North (using unified formula)
    const sortedByBranches = [...employeeStats]
        .filter(e => e.branchHopperScore > 0) // Only those who worked at both branches
        .sort((a, b) => b.branchHopperScore - a.branchHopperScore); // Higher score = better
    
    // Set top 3 for each category with tie handling (pass statId for photo lookup)
    stats.averageLateKing = getTop3WithTies(sortedByAverageLate, e => e.averageLateMinutes, 'averageLateKing');
    stats.gracePeriodMaster = getTop3WithTies(sortedByGracePeriod, e => e.gracePeriodCount, 'gracePeriodMaster');
    stats.earlyBird = getTop3WithTies(sortedByEarlyBird, e => e.earlyCount, 'earlyBird');
    stats.mostPromptIn = getTop3WithTies(sortedByPromptIn, e => e.promptInCount, 'mostPromptIn');
    stats.mostOnTimeOut = getTop3WithTies(sortedByOnTimeOut, e => e.onTimeOutCount, 'mostOnTimeOut');
    stats.weekendWarrior = getTop3WithTies(sortedByWeekend, e => e.weekendCount, 'weekendWarrior');
    stats.holidayHero = getTop3WithTies(sortedByHoliday, e => e.holidayCount, 'holidayHero');
    stats.mostFlexible = getTop3WithTies(sortedByFlexible, e => e.mostFlexibleScore, 'mostFlexible');
    stats.closingSpecialist = getTop3WithTies(sortedByClosing, e => e.closingCount, 'closingSpecialist');
    stats.openingSpecialist = getTop3WithTies(sortedByOpening, e => e.openingCount, 'openingSpecialist');
    stats.perfectStreak = getTop3WithTies(sortedByStreak, e => e.longestStreak, 'perfectStreak');
    stats.branchHopper = getTop3WithTies(sortedByBranches, e => e.branchHopperScore, 'branchHopper');
    
    stats.otChampion = getTop3WithTies(sortedByOT, e => e.totalOTHours, 'otChampion');
    stats.mostWorkaholic = getTop3WithTies(sortedByDays, e => e.daysWorked, 'mostWorkaholic');
    stats.punctualOne = getTop3WithTies(sortedByPunctual, e => e.averageLateMinutes, 'punctualOne');
    stats.mostConsistentlyLate = getTop3WithTies(sortedByConsistentlyLate, e => e.lateCount, 'mostConsistentlyLate');
    stats.eventSpecialist = getTop3WithTies(sortedByEvents, e => e.eventCount, 'eventSpecialist');
    stats.earningsChampion = getTop3WithTies(sortedByEarnings, e => e.earnings, 'earningsChampion');
    
    // Store employee stats for individual view
    allEmployeeStats = employeeStats;
    
    return stats;
}

// Calculate branch comparison stats
async function calculateBranchStats() {
    console.log("Calculating branch comparison stats...");
    
    const branchData = {
        Podium: { employees: new Set(), lateCounts: [], otHours: [], daysWorked: [], earnings: [] },
        'SM North': { employees: new Set(), lateCounts: [], otHours: [], daysWorked: [], earnings: [] }
    };
    
    const employeeIds = Object.keys(employees);
    
    for (const employeeId of employeeIds) {
        const employee = employees[employeeId];
        const records = allAttendanceData[employeeId] || [];
        
        const employeeStats = {
            'Podium': { lateCount: 0, otHours: 0, daysWorked: 0 },
            'SM North': { lateCount: 0, otHours: 0, daysWorked: 0 }
        };
        
        for (const record of records) {
            if (!record.clockIn) continue;
            
            const branch = record.clockIn.branch;
            if (branch !== 'Podium' && branch !== 'SM North') continue;
            
            employeeStats[branch].daysWorked++;
            branchData[branch].employees.add(employeeId);
            
            // Check for late
            const scheduledIn = record.scheduledIn || 
                (record.clockIn.shift && SHIFT_SCHEDULES[record.clockIn.shift]?.timeIn) ||
                '9:30 AM';
            
            const lateMinutes = calculateLateMinutes(record.clockIn.time, scheduledIn);
            if (lateMinutes > 0) {
                employeeStats[branch].lateCount++;
            }
            
            // Check for OT
            employeeStats[branch].otHours += calculateOTHours(record, employee);
        }
        
        // Calculate earnings per branch
        for (const branch of ['Podium', 'SM North']) {
            const branchRecords = records.filter(r => r.clockIn?.branch === branch);
            let branchEarnings = 0;
            
            for (const record of branchRecords) {
                const dateEntry = {
                    date: record.date,
                    timeIn: record.clockIn?.time,
                    timeOut: record.clockOut?.time,
                    branch: record.clockIn?.branch,
                    shift: record.clockIn?.shift || 'Opening',
                    scheduledIn: record.scheduledIn,
                    scheduledOut: record.scheduledOut,
                    hasOTPay: record.hasOTPay || false,
                    hasFixedPay: record.hasFixedPay || false,
                    fixedPayAmount: record.fixedPayAmount || 0,
                    hasDoublePay: record.hasDoublePay || false,
                    hasMealAllowance: record.hasMealAllowance !== false,
                    transpoAllowance: record.transpoAllowance || 0
                };
                
                const result = payCalculator.calculateTotalPay([dateEntry], employee, 'simple');
                branchEarnings += result;
            }
            
            if (employeeStats[branch].daysWorked > 0) {
                branchData[branch].lateCounts.push(employeeStats[branch].lateCount);
                branchData[branch].otHours.push(employeeStats[branch].otHours);
                branchData[branch].daysWorked.push(employeeStats[branch].daysWorked);
                branchData[branch].earnings.push(branchEarnings);
            }
        }
    }
    
    // Calculate averages
    const stats = {
        punctuality: {
            podium: branchData['Podium'].lateCounts.length > 0 ? 
                (branchData['Podium'].lateCounts.reduce((a, b) => a + b, 0) / branchData['Podium'].lateCounts.length).toFixed(1) : '0',
            smNorth: branchData['SM North'].lateCounts.length > 0 ?
                (branchData['SM North'].lateCounts.reduce((a, b) => a + b, 0) / branchData['SM North'].lateCounts.length).toFixed(1) : '0'
        },
        otBattle: {
            podium: branchData['Podium'].otHours.length > 0 ?
                (branchData['Podium'].otHours.reduce((a, b) => a + b, 0) / branchData['Podium'].otHours.length).toFixed(1) : '0',
            smNorth: branchData['SM North'].otHours.length > 0 ?
                (branchData['SM North'].otHours.reduce((a, b) => a + b, 0) / branchData['SM North'].otHours.length).toFixed(1) : '0'
        },
        workaholicBattle: {
            podium: branchData['Podium'].daysWorked.length > 0 ?
                (branchData['Podium'].daysWorked.reduce((a, b) => a + b, 0) / branchData['Podium'].daysWorked.length).toFixed(1) : '0',
            smNorth: branchData['SM North'].daysWorked.length > 0 ?
                (branchData['SM North'].daysWorked.reduce((a, b) => a + b, 0) / branchData['SM North'].daysWorked.length).toFixed(1) : '0'
        },
        earningsBattle: {
            podium: branchData['Podium'].earnings.length > 0 ?
                (branchData['Podium'].earnings.reduce((a, b) => a + b, 0) / branchData['Podium'].earnings.length).toFixed(2) : '0',
            smNorth: branchData['SM North'].earnings.length > 0 ?
                (branchData['SM North'].earnings.reduce((a, b) => a + b, 0) / branchData['SM North'].earnings.length).toFixed(2) : '0'
        }
    };
    
    // Determine winners
    stats.punctuality.winner = parseFloat(stats.punctuality.podium) < parseFloat(stats.punctuality.smNorth) ? 'Podium' : 'SM North';
    stats.otBattle.winner = parseFloat(stats.otBattle.podium) > parseFloat(stats.otBattle.smNorth) ? 'Podium' : 'SM North';
    stats.workaholicBattle.winner = parseFloat(stats.workaholicBattle.podium) > parseFloat(stats.workaholicBattle.smNorth) ? 'Podium' : 'SM North';
    stats.earningsBattle.winner = parseFloat(stats.earningsBattle.podium) > parseFloat(stats.earningsBattle.smNorth) ? 'Podium' : 'SM North';
    
    return stats;
}

// Format company-wide stat result
function formatCompanyWideResult(statId, data) {
    if (!data || (!data.first && !Array.isArray(data.first))) return 'No data available';
    
    // Helper to format a place entry
    function formatEntry(entry, medal, statId) {
        if (!entry) return '';
        if (Array.isArray(entry)) {
            // Handle ties - show all photos
            const names = entry.map(e => e.name).join(', ');
            const value = entry[0].value;
            const photos = entry.map(e => e.photo).filter(p => p); // Get all photos from tied people
            let valueText = '';
            
            switch(statId) {
                case 'averageLateKing':
                    valueText = `${Math.floor(value)} minutes average`;
                    break;
                case 'mostPromptIn':
                    valueText = `${Math.round(value)} times`;
                    break;
                case 'mostOnTimeOut':
                    valueText = `${Math.round(value)} times`;
                    break;
                case 'gracePeriodMaster':
                    valueText = `${Math.round(value)} times`;
                    break;
                case 'earlyBird':
                    valueText = `${Math.round(value)} times`;
                    break;
                case 'weekendWarrior':
                    valueText = `${Math.round(value)} weekend shifts`;
                    break;
                case 'holidayHero':
                    valueText = `${Math.round(value)} holiday shifts`;
                    break;
                case 'mostFlexible':
                    // Don't show any number, just descriptive text
                    valueText = `Most balanced across shift types`;
                    break;
                case 'closingSpecialist':
                    valueText = `${Math.round(value)} closing shifts`;
                    break;
                case 'openingSpecialist':
                    valueText = `${Math.round(value)} opening shifts`;
                    break;
                case 'perfectStreak':
                    valueText = `${Math.round(value)} consecutive days`;
                    break;
                case 'branchHopper':
                    // Show the score rounded
                    valueText = `Score: ${Math.round(value)}`;
                    break;
                case 'otChampion':
                    valueText = `${value.toFixed(1)} hours of OT`;
                    break;
                case 'mostWorkaholic':
                    valueText = `${Math.round(value)} days worked`;
                    break;
                case 'punctualOne':
                    valueText = `${Math.floor(entry[0].value)} minutes average`;
                    break;
                case 'mostConsistentlyLate':
                    valueText = `${Math.round(value)} late arrivals`;
                    break;
                case 'eventSpecialist':
                    valueText = `${Math.round(value)} events worked`;
                    break;
                case 'earningsChampion':
                    // Format as ₱XXX,XXX (placeholder, not actual value)
                    valueText = `₱XXX,XXX`;
                    break;
            }
            
            // Display photos for all tied people with photo options
            let photosHtml = '';
            // For tied entries, show photos for each person
            const tiedPhotos = entry.map(e => {
                if (e.photoOptions && e.photoOptions.length > 0) {
                    const photoOptions = e.photoOptions || [];
                    const selectedIndex = e.selectedPhotoIndex || 0;
                    return {
                        photo: photoOptions[selectedIndex] || photoOptions[0] || null,
                        employeeId: e.employeeId,
                        photoOptions: photoOptions,
                        selectedIndex: selectedIndex
                    };
                } else if (e.photo) {
                    return {
                        photo: e.photo,
                        employeeId: e.employeeId,
                        photoOptions: null,
                        selectedIndex: 0
                    };
                }
                return null;
            }).filter(p => p && p.photo);
            
            if (tiedPhotos.length > 0) {
                // Show all photos from tied people, each with their own click handler
                photosHtml = `<div class="stat-photos-container">${tiedPhotos.map((p, idx) => {
                    const photoCount = p.photoOptions ? p.photoOptions.length : 1;
                    return `<div class="stat-photo-wrapper" data-stat-id="${statId}" data-employee-id="${p.employeeId}" data-photo-count="${photoCount}">
                        <img src="${p.photo}" alt="Selfie" class="stat-photo stat-photo-selected" data-photo-index="${p.selectedIndex}" />
                    </div>`;
                }).join('')}</div>`;
            } else if (photos.length > 0) {
                // Fallback: show all photos from tied people
                photosHtml = `<div class="stat-photos-container">${photos.map(p => `<img src="${p}" alt="Selfie" class="stat-photo" />`).join('')}</div>`;
            }
            // Only show "Tied:" if there's actually more than one person
            const tiedLabel = entry.length > 1 ? 'Tied: ' : '';
            return `<div class="stat-winner-row">${photosHtml}<div class="stat-winner-info"><strong>${medal} ${tiedLabel}${names}</strong><br>${valueText}</div></div>`;
        } else {
            // Single entry (not tied)
            const photo = entry.photo;
            let valueText = '';
            
            switch(statId) {
                case 'averageLateKing':
                    valueText = `${Math.floor(entry.value)} minutes average`;
                    break;
                case 'mostPromptIn':
                    valueText = `${Math.round(entry.value)} times`;
                    break;
                case 'mostOnTimeOut':
                    valueText = `${Math.round(entry.value)} times`;
                    break;
                case 'gracePeriodMaster':
                    valueText = `${Math.round(entry.value)} times`;
                    break;
                case 'earlyBird':
                    valueText = `${Math.round(entry.value)} times`;
                    break;
                case 'weekendWarrior':
                    valueText = `${Math.round(entry.value)} weekend shifts`;
                    break;
                case 'holidayHero':
                    valueText = `${Math.round(entry.value)} holiday shifts`;
                    break;
                case 'mostFlexible':
                    // Don't show any number, just descriptive text
                    valueText = `Most balanced across shift types`;
                    break;
                case 'closingSpecialist':
                    valueText = `${Math.round(entry.value)} closing shifts`;
                    break;
                case 'openingSpecialist':
                    valueText = `${Math.round(entry.value)} opening shifts`;
                    break;
                case 'perfectStreak':
                    valueText = `${Math.round(entry.value)} consecutive days`;
                    break;
                case 'branchHopper':
                    // Show the score rounded, but make it clear it's a calculated score
                    valueText = `Score: ${Math.round(entry.value)}`;
                    break;
                case 'otChampion':
                    valueText = `${entry.value.toFixed(1)} hours of OT`;
                    break;
                case 'mostWorkaholic':
                    valueText = `${Math.round(entry.value)} days worked`;
                    break;
                case 'punctualOne':
                    valueText = `${Math.floor(entry.value)} minutes average`;
                    break;
                case 'mostConsistentlyLate':
                    valueText = `${Math.round(entry.value)} late arrivals`;
                    break;
                case 'eventSpecialist':
                    valueText = `${Math.round(entry.value)} events worked`;
                    break;
                case 'earningsChampion':
                    // Format as ₱XXX,XXX (placeholder, not actual value)
                    valueText = `₱XXX,XXX`;
                    break;
            }
            
            // Show photo options if available
            let photoHtml = '';
            if (entry.photoOptions && entry.photoOptions.length > 0) {
                const photoOptions = entry.photoOptions;
                const selectedIndex = entry.selectedPhotoIndex || 0;
                const selectedPhoto = photoOptions[selectedIndex] || photoOptions[0] || null;
                
                if (selectedPhoto) {
                    photoHtml = `<div class="stat-photos-container" data-stat-id="${statId}" data-employee-id="${entry.employeeId}" data-photo-count="${photoOptions.length}">
                        <img src="${selectedPhoto}" alt="Selfie" class="stat-photo stat-photo-selected" data-photo-index="${selectedIndex}" />
                    </div>`;
                }
            } else if (photo) {
                // Fallback: show single photo
                photoHtml = `<div class="stat-photos-container"><img src="${photo}" alt="Selfie" class="stat-photo" /></div>`;
            }
            return `<div class="stat-winner-row">${photoHtml}<div class="stat-winner-info"><strong>${medal} ${entry.name}</strong><br>${valueText}</div></div>`;
        }
    }
    
    const firstPlace = formatEntry(data.first, '🥇', statId);
    const secondPlace = formatEntry(data.second, '🥈', statId);
    const thirdPlace = formatEntry(data.third, '🥉', statId);
    
    // Format: First place on its own line, 2nd and 3rd on one line with smaller font
    let result = firstPlace;
    
    if (secondPlace || thirdPlace) {
        const secondThird = [secondPlace, thirdPlace].filter(p => p)
            .map(p => `<span class="place-2nd-3rd">${p}</span>`)
            .join(' <span class="place-separator">•</span> ');
        result += `<br><div class="places-2nd-3rd">${secondThird}</div>`;
    }
    
    return result;
}

// Main analysis function
async function startAnalysis() {
    startBtn.disabled = true;
    progressSection.style.display = 'block';
    companyWideStats.innerHTML = '';
    branchStats.innerHTML = '';
    
    try {
        // Initialize stat cards
        initializeStatCards();
        
        // Load data
        updateProgress(0, 100);
        await loadEmployees();
        updateProgress(10, 100);
        await loadHolidays();
        updateProgress(15, 100);
        await loadSalesData();
        updateProgress(20, 100);
        
        // Initialize PayCalculator
        payCalculator = new PayCalculator(holidays, salesData);
        
        // Load attendance data
        await loadAllAttendanceData();
        updateProgress(40, 100);
        
        // Calculate company-wide stats (all at once for efficiency)
        const totalStats = COMPANY_WIDE_STATS.length + BRANCH_STATS.length;
        let completed = 0;
        
        try {
            // Calculate all company-wide stats in one pass
            const companyStats = await calculateCompanyWideStats();
            
            // Update each stat card
            for (const stat of COMPANY_WIDE_STATS) {
                updateStatStatus(stat.id, 'analyzing');
                await new Promise(resolve => setTimeout(resolve, 50)); // Small delay for UI
                
                const result = formatCompanyWideResult(stat.id, companyStats[stat.id]);
                updateStatStatus(stat.id, 'complete', result);
                analysisResults.companyWide[stat.id] = companyStats[stat.id];
                
                completed++;
                updateProgress(40 + (completed / totalStats) * 50, 100);
            }
        } catch (error) {
            console.error("Error calculating company-wide stats:", error);
            for (const stat of COMPANY_WIDE_STATS) {
                updateStatStatus(stat.id, 'error');
            }
        }
        
        // Calculate branch stats (all at once)
        updateStatStatus('punctuality', 'analyzing');
        
        try {
            const branchComparison = await calculateBranchStats();
            
            // Update each branch stat card
            for (const stat of BRANCH_STATS) {
                updateStatStatus(stat.id, 'analyzing');
                await new Promise(resolve => setTimeout(resolve, 50));
                
                const result = {
                    podium: stat.id === 'earningsBattle' ? 
                        `₱${parseFloat(branchComparison[stat.id].podium).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : 
                        branchComparison[stat.id].podium,
                    smNorth: stat.id === 'earningsBattle' ?
                        `₱${parseFloat(branchComparison[stat.id].smNorth).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` :
                        branchComparison[stat.id].smNorth,
                    winner: branchComparison[stat.id].winner
                };
                updateStatStatus(stat.id, 'complete', result);
                analysisResults.branchComparison[stat.id] = branchComparison[stat.id];
                
                completed++;
                updateProgress(40 + (completed / totalStats) * 50, 100);
            }
        } catch (error) {
            console.error("Error calculating branch stats:", error);
            for (const stat of BRANCH_STATS) {
                updateStatStatus(stat.id, 'error');
            }
        }
        
        updateProgress(100, 100);
        exportBtn.disabled = false;
        pushToFirebaseBtn.disabled = false;
        
        // Populate employee dropdown
        populateEmployeeDropdown();
        
        // Attach photo selection handlers
        attachPhotoSelectionHandlers();
        
        console.log("Analysis complete!", analysisResults);
        
    } catch (error) {
        console.error("Analysis error:", error);
        alert("Error during analysis: " + error.message);
    } finally {
        startBtn.disabled = false;
    }
}

// Attach photo selection handlers
function attachPhotoSelectionHandlers() {
    // Handle clicks on photo wrappers (for tied entries) and containers (for single entries) - cycle through options
    document.querySelectorAll('.stat-photo-wrapper[data-stat-id], .stat-photos-container[data-stat-id]').forEach(container => {
        const statId = container.dataset.statId;
        const employeeId = container.dataset.employeeId;
        const photoCount = parseInt(container.dataset.photoCount) || 1;
        
        if (!statId || !employeeId || photoCount <= 1) return;
        
        const photoEl = container.querySelector('.stat-photo-selected');
        if (!photoEl) return;
        
        photoEl.addEventListener('click', () => {
            // Find the employee in allEmployeeStats
            const employee = allEmployeeStats.find(e => e.employeeId === employeeId);
            if (!employee || !employee.photos || !employee.photos[statId]) return;
            
            const photoOptions = employee.photos[statId];
            if (!Array.isArray(photoOptions) || photoOptions.length <= 1) return;
            
            // Get current index and cycle to next
            if (!employee.selectedPhotoIndex) {
                employee.selectedPhotoIndex = {};
            }
            const currentIndex = employee.selectedPhotoIndex[statId] || 0;
            const nextIndex = (currentIndex + 1) % photoOptions.length;
            employee.selectedPhotoIndex[statId] = nextIndex;
            
            // Update the displayed photo
            const selectedPhoto = photoOptions[nextIndex];
            if (selectedPhoto) {
                // Update the visible photo
                photoEl.src = selectedPhoto;
                photoEl.dataset.photoIndex = nextIndex;
                
                // Update analysisResults to reflect the change
                const statData = analysisResults.companyWide[statId];
                if (statData && statData.first) {
                    if (Array.isArray(statData.first)) {
                        const firstEntry = statData.first.find(e => e.employeeId === employeeId);
                        if (firstEntry) {
                            firstEntry.photo = selectedPhoto;
                            firstEntry.selectedPhotoIndex = nextIndex;
                        }
                    } else if (statData.first.employeeId === employeeId) {
                        statData.first.photo = selectedPhoto;
                        statData.first.selectedPhotoIndex = nextIndex;
                    }
                }
            }
        });
    });
}

// Helper to get selected photo only (for export/push)
function getSelectedPhotoOnly(employee, statId) {
    if (!employee.photos || !employee.photos[statId]) return null;
    const photoOptions = employee.photos[statId];
    if (!Array.isArray(photoOptions) || photoOptions.length === 0) return null;
    const selectedIndex = employee.selectedPhotoIndex?.[statId] || 0;
    return photoOptions[selectedIndex] || photoOptions[0] || null;
}

// Export results
function exportResults() {
    // Create a copy with only selected photos
    const exportResultsCopy = JSON.parse(JSON.stringify(analysisResults));
    
    // Update company-wide stats to only include selected photos
    for (const statId in exportResultsCopy.companyWide) {
        const statData = exportResultsCopy.companyWide[statId];
        if (statData.first) {
            if (Array.isArray(statData.first)) {
                statData.first.forEach(entry => {
                    const employee = allEmployeeStats.find(e => e.employeeId === entry.employeeId);
                    if (employee) {
                        entry.photo = getSelectedPhotoOnly(employee, statId);
                        // Remove photoOptions and selectedPhotoIndex from export
                        delete entry.photoOptions;
                        delete entry.selectedPhotoIndex;
                    }
                });
            } else {
                const employee = allEmployeeStats.find(e => e.employeeId === statData.first.employeeId);
                if (employee) {
                    statData.first.photo = getSelectedPhotoOnly(employee, statId);
                    delete statData.first.photoOptions;
                    delete statData.first.selectedPhotoIndex;
                }
            }
        }
    }
    
    const exportData = {
        ...exportResultsCopy,
        employeeStats: allEmployeeStats.map(stat => {
            // Only include selected photos in export
            const photos = {};
            for (const statId in stat.photos) {
                photos[statId] = getSelectedPhotoOnly(stat, statId);
            }
            return {
                ...stat,
                photos: photos
            };
        }),
        // Include all raw data for complete backup/restore
        rawData: {
            employees: employees,
            holidays: holidays,
            salesData: salesData,
            allAttendanceData: allAttendanceData // Includes all selfie URLs
        }
    };
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wrapped-stats-2025-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

// Push wrapped data to Firebase (split into multiple documents to avoid size limit)
async function pushToFirebase() {
    const pushToFirebaseBtn = document.getElementById('pushToFirebaseBtn');
    let statusEl = document.getElementById('pushStatus');
    if (!statusEl) {
        statusEl = createPushStatusElement();
    }
    
    try {
        pushToFirebaseBtn.disabled = true;
        pushToFirebaseBtn.textContent = 'Pushing...';
        statusEl.style.display = 'block';
        statusEl.innerHTML = '<div class="push-status">Preparing data...</div>';
        
        // Helper to format stat entry for mobile (only selected photos)
        function formatStatEntry(entry, statId) {
            if (!entry) return null;
            
            if (Array.isArray(entry)) {
                // Handle ties - get selected photo for each
                return entry.map(e => {
                    // Always get photo from allEmployeeStats (the source of truth)
                    let selectedPhoto = null;
                    const employee = allEmployeeStats.find(emp => emp.employeeId === e.employeeId);
                    if (employee) {
                        selectedPhoto = getSelectedPhotoOnly(employee, statId);
                        if (!selectedPhoto) {
                            console.warn(`No photo found for ${e.name} (${e.employeeId}) in stat ${statId}. Employee photos:`, employee.photos?.[statId]);
                        }
                    } else {
                        console.warn(`Employee not found: ${e.employeeId}`);
                    }
                    
                    const result = {
                        employeeId: e.employeeId,
                        name: e.name,
                        value: e.value,
                        photo: selectedPhoto || null
                    };
                    // Only include shiftTypeCount if it exists (for most flexible)
                    if (e.shiftTypeCount !== undefined) {
                        result.shiftTypeCount = e.shiftTypeCount;
                    }
                    return result;
                });
            } else {
                // Always get photo from allEmployeeStats (the source of truth)
                let selectedPhoto = null;
                const employee = allEmployeeStats.find(emp => emp.employeeId === entry.employeeId);
                if (employee) {
                    selectedPhoto = getSelectedPhotoOnly(employee, statId);
                    if (!selectedPhoto) {
                        console.warn(`No photo found for ${entry.name} (${entry.employeeId}) in stat ${statId}. Employee photos:`, employee.photos?.[statId]);
                    }
                } else {
                    console.warn(`Employee not found: ${entry.employeeId}`);
                }
                
                const result = {
                    employeeId: entry.employeeId,
                    name: entry.name,
                    value: entry.value,
                    photo: selectedPhoto || null
                };
                // Only include shiftTypeCount if it exists (for most flexible)
                if (entry.shiftTypeCount !== undefined) {
                    result.shiftTypeCount = entry.shiftTypeCount;
                }
                return result;
            }
        }
        
        // 1. Push company-wide stats (separate document)
        statusEl.innerHTML = '<div class="push-status">Pushing company-wide stats...</div>';
        const companyStatsData = {
            year: 2025,
            generatedAt: new Date().toISOString(),
            companyWideStats: {},
            branchStats: {}
        };
        
        for (const stat of COMPANY_WIDE_STATS) {
            const statData = analysisResults.companyWide[stat.id];
            if (statData) {
                companyStatsData.companyWideStats[stat.id] = {
                    title: stat.title,
                    description: stat.description,
                    first: formatStatEntry(statData.first, stat.id),
                    second: formatStatEntry(statData.second, stat.id),
                    third: formatStatEntry(statData.third, stat.id)
                };
            }
        }
        
        // Add branch stats
        console.log('Branch comparison data:', analysisResults.branchComparison);
        for (const stat of BRANCH_STATS) {
            const statData = analysisResults.branchComparison[stat.id];
            console.log(`Processing branch stat ${stat.id}:`, statData);
            if (statData) {
                companyStatsData.branchStats[stat.id] = {
                    title: stat.title,
                    description: stat.description,
                    podium: statData.podium,
                    smNorth: statData.smNorth,
                    winner: statData.winner
                };
            } else {
                console.warn(`Branch stat ${stat.id} is missing from analysisResults.branchComparison`);
            }
        }
        
        console.log('Company stats data to push:', companyStatsData);
        const companyStatsRef = doc(db, 'wrapped', '2025_company');
        await setDoc(companyStatsRef, companyStatsData);
        statusEl.innerHTML = '<div class="push-status">✓ Company stats pushed. Preparing employee stats...</div>';
        
        // 2. Push employee stats in batches (split into multiple documents)
        // Only include selected photos (not all options) and minimal data
        const BATCH_SIZE = 3; // Process 3 employees at a time (photos are large, ~1MB limit per doc)
        const totalEmployees = allEmployeeStats.length;
        const totalBatches = Math.ceil(totalEmployees / BATCH_SIZE);
        
        statusEl.innerHTML = `<div class="push-status">Pushing employee stats (0/${totalBatches} batches)...</div>`;
        
        for (let i = 0; i < totalEmployees; i += BATCH_SIZE) {
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            statusEl.innerHTML = `<div class="push-status">Pushing employee stats (${batchNum}/${totalBatches} batches, ${i + 1}-${Math.min(i + BATCH_SIZE, totalEmployees)}/${totalEmployees} employees)...</div>`;
            
            const batch = allEmployeeStats.slice(i, i + BATCH_SIZE);
            const employeeBatchData = {
                year: 2025,
                generatedAt: new Date().toISOString(),
                batchIndex: batchNum,
                totalBatches: totalBatches,
                employees: batch.map(stat => {
                    // Only include selected photos (not arrays of options)
                    const individualPhotos = {};
                    if (stat.individualPhotos) {
                        if (stat.individualPhotos.averageLateTime) individualPhotos.averageLateTime = stat.individualPhotos.averageLateTime;
                        if (stat.individualPhotos.longestStreak) individualPhotos.longestStreak = stat.individualPhotos.longestStreak;
                        if (stat.individualPhotos.earlyCount) individualPhotos.earlyCount = stat.individualPhotos.earlyCount;
                        if (stat.individualPhotos.daysWorked) individualPhotos.daysWorked = stat.individualPhotos.daysWorked;
                        if (stat.individualPhotos.eventCount) individualPhotos.eventCount = stat.individualPhotos.eventCount;
                        if (stat.individualPhotos.earliestIn) individualPhotos.earliestIn = stat.individualPhotos.earliestIn;
                        if (stat.individualPhotos.latestOut) individualPhotos.latestOut = stat.individualPhotos.latestOut;
                    }
                    
                    // Only include selected photos for company stats (not all options)
                    const selectedPhotos = {};
                    for (const statId in stat.photos) {
                        const selectedPhoto = getSelectedPhotoOnly(stat, statId);
                        if (selectedPhoto) {
                            selectedPhotos[statId] = selectedPhoto;
                        }
                    }
                    
                    // Only include photos that exist and are not null/undefined
                    const cleanIndividualPhotos = {};
                    for (const key in individualPhotos) {
                        if (individualPhotos[key]) {
                            cleanIndividualPhotos[key] = individualPhotos[key];
                        }
                    }
                    
                    const cleanSelectedPhotos = {};
                    for (const key in selectedPhotos) {
                        if (selectedPhotos[key]) {
                            cleanSelectedPhotos[key] = selectedPhotos[key];
                        }
                    }
                    
                    const employeeData = {
                        employeeId: stat.employeeId,
                        name: stat.name,
                        averageLateMinutes: stat.averageLateMinutes,
                        longestStreak: stat.longestStreak,
                        earlyCount: stat.earlyCount,
                        daysWorked: stat.daysWorked,
                        eventCount: stat.eventCount,
                        earliestIn: stat.earliestIn,
                        latestOut: stat.latestOut
                    };
                    
                    // Only include photo objects if they have at least one photo
                    if (Object.keys(cleanIndividualPhotos).length > 0) {
                        employeeData.individualPhotos = cleanIndividualPhotos;
                    }
                    if (Object.keys(cleanSelectedPhotos).length > 0) {
                        employeeData.photos = cleanSelectedPhotos;
                    }
                    
                    return employeeData;
                })
            };
            
            const batchRef = doc(db, 'wrapped', `2025_employees_batch_${batchNum}`);
            await setDoc(batchRef, employeeBatchData);
        }
        
        // 3. Push metadata document
        statusEl.innerHTML = '<div class="push-status">Pushing metadata...</div>';
        const metadataRef = doc(db, 'wrapped', '2025_metadata');
        await setDoc(metadataRef, {
            year: 2025,
            generatedAt: new Date().toISOString(),
            totalBatches: totalBatches,
            totalEmployees: totalEmployees,
            companyStatsDocument: '2025_company',
            employeeStatsPrefix: '2025_employees_batch_'
        });
        
        statusEl.innerHTML = '<div class="push-status success">✓ All data pushed successfully!</div>';
        pushToFirebaseBtn.disabled = false;
        pushToFirebaseBtn.textContent = 'Push to Firebase';
        
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 3000);
        
        alert('Wrapped data pushed to Firebase successfully!');
        console.log('Wrapped data pushed in separate documents');
        
    } catch (error) {
        console.error("Error pushing to Firebase:", error);
        statusEl.innerHTML = `<div class="push-status error">✗ Error: ${error.message}</div>`;
        pushToFirebaseBtn.disabled = false;
        pushToFirebaseBtn.textContent = 'Push to Firebase';
        alert("Failed to push to Firebase: " + error.message);
    }
}

// Create status element if it doesn't exist
function createPushStatusElement() {
    const statusEl = document.createElement('div');
    statusEl.id = 'pushStatus';
    statusEl.style.cssText = 'margin-top: 15px; padding: 15px; background: #f8f9fa; border-radius: 8px; display: none;';
    const controls = document.querySelector('.controls');
    if (controls) {
        controls.parentNode.insertBefore(statusEl, controls.nextSibling);
    }
    return statusEl;
}

// Import results
function importResults(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            analysisResults = {
                companyWide: data.companyWide || {},
                branchComparison: data.branchComparison || {}
            };
            
            // Restore employee stats if available
            if (data.employeeStats) {
                allEmployeeStats = data.employeeStats;
            }
            
            // Restore raw data if available (includes selfies)
            if (data.rawData) {
                if (data.rawData.employees) {
                    employees = data.rawData.employees;
                }
                if (data.rawData.holidays) {
                    holidays = data.rawData.holidays;
                }
                if (data.rawData.salesData) {
                    salesData = data.rawData.salesData;
                }
                if (data.rawData.allAttendanceData) {
                    allAttendanceData = data.rawData.allAttendanceData;
                }
            }
            
            // Re-render stats
            initializeStatCards();
            
            // Display company-wide stats
            for (const stat of COMPANY_WIDE_STATS) {
                if (analysisResults.companyWide[stat.id]) {
                    const result = formatCompanyWideResult(stat.id, analysisResults.companyWide[stat.id]);
                    updateStatStatus(stat.id, 'complete', result);
                }
            }
            
            // Display branch stats
            for (const stat of BRANCH_STATS) {
                if (analysisResults.branchComparison[stat.id]) {
                    const branchData = analysisResults.branchComparison[stat.id];
                    const result = {
                        podium: stat.id === 'earningsBattle' ? 
                            `₱${branchData.podium}` : 
                            branchData.podium,
                        smNorth: stat.id === 'earningsBattle' ?
                            `₱${branchData.smNorth}` :
                            branchData.smNorth,
                        winner: branchData.winner
                    };
                    updateStatStatus(stat.id, 'complete', result);
                }
            }
            
            // Populate employee dropdown
            populateEmployeeDropdown();
            
            exportBtn.disabled = false;
        pushToFirebaseBtn.disabled = false;
            alert("Results loaded successfully!");
        } catch (error) {
            console.error("Error importing:", error);
            alert("Error importing file: " + error.message);
        }
    };
    reader.readAsText(file);
}

// Load existing wrapped data from Firebase on page load (same structure as push)
async function loadWrappedDataFromFirebase() {
    try {
        const metadataRef = doc(db, 'wrapped', '2025_metadata');
        const metadataSnap = await getDoc(metadataRef);
        if (!metadataSnap.exists()) {
            console.log('No wrapped metadata in Firebase');
            return;
        }
        const metadata = metadataSnap.data();
        const totalBatches = metadata.totalBatches;
        if (!totalBatches || totalBatches < 1) {
            console.log('No wrapped batches in Firebase');
            return;
        }

        const companyRef = doc(db, 'wrapped', '2025_company');
        const companySnap = await getDoc(companyRef);
        if (!companySnap.exists()) {
            console.log('No wrapped company stats in Firebase');
            return;
        }
        const companyData = companySnap.data();

        const employeeBatches = [];
        for (let i = 1; i <= totalBatches; i++) {
            const batchRef = doc(db, 'wrapped', `2025_employees_batch_${i}`);
            const batchSnap = await getDoc(batchRef);
            if (batchSnap.exists() && batchSnap.data().employees) {
                employeeBatches.push(...batchSnap.data().employees);
            }
        }

        analysisResults = {
            companyWide: companyData.companyWideStats || {},
            branchComparison: companyData.branchStats || {}
        };
        allEmployeeStats = employeeBatches;

        initializeStatCards();

        for (const stat of COMPANY_WIDE_STATS) {
            if (analysisResults.companyWide[stat.id]) {
                const result = formatCompanyWideResult(stat.id, analysisResults.companyWide[stat.id]);
                updateStatStatus(stat.id, 'complete', result);
            }
        }

        for (const stat of BRANCH_STATS) {
            if (analysisResults.branchComparison[stat.id]) {
                const branchData = analysisResults.branchComparison[stat.id];
                const result = {
                    podium: stat.id === 'earningsBattle'
                        ? `₱${parseFloat(branchData.podium).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : String(branchData.podium),
                    smNorth: stat.id === 'earningsBattle'
                        ? `₱${parseFloat(branchData.smNorth).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : String(branchData.smNorth),
                    winner: branchData.winner
                };
                updateStatStatus(stat.id, 'complete', result);
            }
        }

        populateEmployeeDropdown();
        attachPhotoSelectionHandlers();
        exportBtn.disabled = false;
        pushToFirebaseBtn.disabled = false;
        console.log('Loaded existing wrapped data from Firebase');
    } catch (error) {
        console.warn('Could not load wrapped data from Firebase:', error);
    }
}

// Initialize on load
initializeStatCards();
loadWrappedDataFromFirebase();

