// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc, setDoc, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { deleteDoc} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Firebase configuration - you'll need to replace this with your actual Firebase config
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

// Employee data
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

const importedNameMap = {
    "Acerr": "Acerr Franco",
    "Avi": "Laville Laborte",
    "Bea": "Beatrice Grace Boldo",
    "Charles": "Charles Francis Tan",
    "Denzel": "Denzel Genesis Fernandez",
    "Gab": "Gabrielle Hannah Catalan",
    "Ja": "Japhet Dizon",
    "Jas": "Jasmine Ferrer",
    "Lester": "John Lester Cal",
    "Liezel": "Liezel Acebedo",
    "Mae": "Sheila Mae Salvajan",
    "Paul": "Paul John Garin",
    "Raniel": "Raniel Buenaventura",
    "Raschel": "Raschel Joy Cruz",
    "Sarah": "Sarah Perpinan",
    "Toph": "Cristopher David", // assumed alias
    "rhobbie": "Rhobbie Ryza Saligumba"
};

// Add this after the SHIFT_SCHEDULES constant
const HOLIDAYS_2025 = {
    // Regular Holidays
    "2025-01-01": { name: "New Year's Day", type: "regular" },
    "2025-04-01": { name: "Eid'l Fitr (Feast of Ramadhan)", type: "regular" },
    "2025-04-09": { name: "Araw ng Kagitingan", type: "regular" },
    "2025-04-17": { name: "Maundy Thursday", type: "regular" },
    "2025-04-18": { name: "Good Friday", type: "regular" },
    "2025-05-01": { name: "Labor Day", type: "regular" },
    "2025-06-12": { name: "Independence Day", type: "regular" },
    "2025-08-25": { name: "National Heroes Day", type: "regular" },
    "2025-11-30": { name: "Bonifacio Day", type: "regular" },
    "2025-12-25": { name: "Christmas Day", type: "regular" },
    "2025-12-30": { name: "Rizal Day", type: "regular" },
    // Special (Non-Working) Holidays
    "2025-01-29": { name: "Chinese New Year", type: "special" },
    "2025-02-25": { name: "EDSA People Power Revolution Anniversary", type: "special" },
    "2025-04-19": { name: "Black Saturday", type: "special" },
    "2025-08-21": { name: "Ninoy Aquino Day", type: "special" },
    "2025-10-31": { name: "All Saints' Day Eve", type: "special" },
    "2025-11-01": { name: "All Saints' Day", type: "special" },
    "2025-12-08": { name: "Feast of the Immaculate Conception", type: "special" },
    "2025-12-24": { name: "Christmas Eve", type: "special" },
    "2025-12-31": { name: "New Year's Eve", type: "special" }
};

function getEmployeeIdFromImportedName(name) {
    const cleanName = name.replace(/^"|"$/g, '').trim().toLowerCase();
    const mappedName = Object.keys(importedNameMap).find(alias => alias.toLowerCase() === cleanName);

    if (!mappedName) return null;
    return Object.keys(employees).find(id => employees[id] === importedNameMap[mappedName]);
}

// document.getElementById('utakImportInput').addEventListener('change', handleUtakImport);

async function handleUtakImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    showLoading();

    const text = await file.text();
    const rows = text.split('\n').map(row => row.split(','));

    const header = rows[0].map(h => h.trim().replace(/^"|"$/g, ''));

    console.log("🪵 CSV Header Detected:", header); // <-- Debug here

    const expectedColumns = [
        "Staff", "In Date", "In Time", "Out Date", "Out time",
        "Total Duration Hours", "Total Duration Mins",
        "Break In Date", "Break In Time", "Break Out Date", "Break Out time",
        "Total Break Duration Hours", "Total Break Duration Mins"
    ];

    // Validate format
    if (!expectedColumns.every((col, i) => header[i]?.trim().toLowerCase() === col.toLowerCase())) {
        hideLoading();
        alert("Invalid CSV format. Please use the Utak export format.");
        return;
    }

    const updates = {};
    for (let i = 1; i < rows.length; i++) {
        console.log(`📄 Row ${i} raw values:`, rows[i]);

        const [rawStaff, rawInDate, rawInTime, rawOutDate, rawOutTime] = rows[i];
        if (!rawStaff || !rawInDate || !rawInTime || !rawOutDate || !rawOutTime) continue;

        const staff = rawStaff.replace(/^"|"$/g, '').trim();
        const inDate = rawInDate.replace(/^"|"$/g, '').trim();
        const inTime = rawInTime.replace(/^"|"$/g, '').trim();
        const outTime = rawOutTime.replace(/^"|"$/g, '').trim();

        const empId = getEmployeeIdFromImportedName(staff);
        if (!empId) {
            console.warn("⚠️ Unknown staff alias:", `"${staff}"`, i);
            continue;
        }

        const parsedDate = new Date(inDate);
        if (isNaN(parsedDate.getTime())) {
            console.warn(`⛔ Skipping row ${i}: Invalid date "${inDate}"`);
            continue;
        }
        const dateKey = formatDate(parsedDate);

        const timeInFormatted = inTime.replace(/\s+/g, ' ').trim();
        const timeOutFormatted = outTime.replace(/\s+/g, ' ').trim();

        if (!updates[empId]) updates[empId] = {};
        updates[empId][dateKey] = {
            clockIn: {
                time: timeInFormatted,
                branch: "Podium",
                shift: "Custom"
            },
            clockOut: {
                time: timeOutFormatted
            }
        };
    }

    if (Object.keys(updates).length === 0) {
        console.warn("⚠️ No valid updates found from CSV. Check name mapping or data range.");
        hideLoading();
        alert("CSV parsed but contains no valid records to import.");
        return;
    }


    // Push to Firebase
    const batch = [];
    for (const [empId, days] of Object.entries(updates)) {
        for (const [dateKey, entry] of Object.entries(days)) {
            const ref = doc(db, "attendance", empId, "dates", dateKey);

            console.log("Writing to:", empId, dateKey, entry);

            if (!empId) {
                console.warn("⚠️ Unknown staff name:", staff);
                continue;
            }

            batch.push(setDoc(ref, entry, { merge: true }));
        }
    }

    try {
        await Promise.all(batch);
        alert("✅ CSV import successful!");
        refreshBtn.dataset.forceRefresh = 'true';
        isInitialLoad = false;
        periodSelect.dispatchEvent(new Event('change'));

        localStorage.removeItem(getCacheKey(periodSelect.value, branchSelect.value));

        await loadData(); // Reload with fresh data
    } catch (error) {
        console.error("CSV import failed:", error);
        alert("❌ Import failed. Check console for details.");
    } finally {
        hideLoading();
    }
}

let currentEmployeeView = null; // null for all employees view, employeeId for single employee view

function convertTo12Hour(timeStr) {
    if (!timeStr) return null;
    const [hourStr, minStr] = timeStr.split(':');
    let hours = parseInt(hourStr, 10);
    const minutes = parseInt(minStr, 10);
    const meridian = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes.toString().padStart(2, '0')} ${meridian}`;
}

// Shift schedules
const SHIFT_SCHEDULES = {
    Opening: { timeIn: "9:30 AM", timeOut: "6:30 PM" },
    Midshift: { timeIn: "11:00 AM", timeOut: "8:00 PM" },
    Closing: { timeIn: "1:00 PM", timeOut: "10:00 PM" },
    Custom: { timeIn: null, timeOut: null }
};

// DOM elements
const loadingOverlay = document.getElementById('loadingOverlay');
const photoModal = document.getElementById('photoModal');
const modalImage = document.getElementById('modalImage');
const closeModal = document.getElementById('closeModal');
const periodSelect = document.getElementById('periodSelect');
const branchSelect = document.getElementById('branchSelect');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const employeeTableBody = document.getElementById('employeeTableBody');
const employeeEditModal = document.getElementById('employeeEditModal');
const closeEditModal = document.getElementById('closeEditModal');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const employeeEditForm = document.getElementById('employeeEditForm');
const editEmployeeName = document.getElementById('editEmployeeName');
const editBaseRate = document.getElementById('editBaseRate');
const editEmployeeId = document.getElementById('editEmployeeId');

const refreshIndicator = document.createElement('div');
refreshIndicator.className = 'refresh-indicator';
refreshIndicator.innerHTML = `
    <div class="refresh-spinner"></div>
    <div class="refresh-text">Refreshing data...</div>
`;
document.body.appendChild(refreshIndicator);

// Add these to your DOMContentLoaded event listener
closeEditModal.addEventListener('click', closeEditEmployeeModal);
cancelEditBtn.addEventListener('click', closeEditEmployeeModal);
employeeEditForm.addEventListener('submit', saveEmployeeChanges);

// Global data store
let attendanceData = {};
let filteredData = {};
let isInitialLoad = true;

async function clearAllTimeLogs() {
    const employeeIds = Object.keys(employees);

    for (const employeeId of employeeIds) {
        const attendanceRef = collection(db, "attendance", employeeId, "dates");
        const snapshot = await getDocs(attendanceRef);

        const deletions = snapshot.docs.map(docSnap =>
            deleteDoc(doc(db, "attendance", employeeId, "dates", docSnap.id))
        );

        await Promise.all(deletions);
        console.log(`🧹 Cleared logs for ${employeeId}`);
    }

    console.log("✅ All attendance logs cleared.");
}

function getCacheKey(periodId, branchId) {
    try {
        let key = `attendance_${periodId}_${branchId}`;
        console.log("Generated key:", key);
        return key;
    } catch (e) {
        console.warn("Error generating cache key:", e);
        return `attendance_fallback_${Date.now()}`;
    }
}

function saveToCache(cacheKey, data) {
    const cacheData = {
        timestamp: Date.now(),
        version: '1.1',
        data: data
    };

    try {
        const serialized = JSON.stringify(cacheData);
        localStorage.setItem(cacheKey, serialized);

        // Add this key to our cache registry
        updateCacheRegistry(cacheKey);

        console.log(`Data cached for ${cacheKey} (${Math.round(serialized.length / 1024)}KB)`);
    } catch (e) {
        console.warn('Cache storage failed, likely quota exceeded', e);
        clearOldCaches();

        // Try again after clearing
        try {
            localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        } catch (retryError) {
            console.error('Cache storage failed even after clearing old caches', retryError);
        }
    }
}

function getFromCache(periodId, branchId) {
    const cacheKey = getCacheKey(periodId, branchId);

    try {
        const cachedData = localStorage.getItem(cacheKey);
        if (!cachedData) {
            console.log(`No cache found for ${cacheKey}`);
            return null;
        }

        const parsedData = JSON.parse(cachedData);

        // Check cache expiration (4 hours for regular use)
        const cacheAge = Date.now() - parsedData.timestamp;
        const expirationTime = 4 * 60 * 60 * 1000; // 4 hours

        if (cacheAge > expirationTime) {
            console.log('Cache expired, removing');
            localStorage.removeItem(cacheKey);
            return null;
        }

        // Check version
        if (parsedData.version !== '1.1') {
            console.log('Cache version mismatch, removing');
            localStorage.removeItem(cacheKey);
            return null;
        }

        console.log(`Using cached data from ${new Date(parsedData.timestamp).toLocaleTimeString()}`);
        return parsedData.data;
    } catch (e) {
        console.warn('Error reading from cache', e);
        return null;
    }
}

function updateCacheRegistry(newKey) {
    try {
        // Get the current registry
        let registry = JSON.parse(localStorage.getItem('cache_registry') || '[]');

        // Add the new key if it doesn't exist
        if (!registry.includes(newKey)) {
            registry.push(newKey);

            // Store timestamp with key for smarter clearing
            const registryWithTimestamps = {};
            registry.forEach(key => {
                try {
                    const item = localStorage.getItem(key);
                    if (item) {
                        const parsed = JSON.parse(item);
                        registryWithTimestamps[key] = parsed.timestamp || Date.now();
                    }
                } catch (e) {
                    // If we can't parse, just use current time
                    registryWithTimestamps[key] = Date.now();
                }
            });

            // Save updated registry
            localStorage.setItem('cache_registry', JSON.stringify(registry));
            localStorage.setItem('cache_timestamps', JSON.stringify(registryWithTimestamps));
        }
    } catch (e) {
        console.warn('Error updating cache registry', e);
    }
}

function clearOldCaches() {
    try {
        // Get registry and timestamps
        const registry = JSON.parse(localStorage.getItem('cache_registry') || '[]');
        const timestamps = JSON.parse(localStorage.getItem('cache_timestamps') || '{}');

        if (registry.length <= 5) {
            console.log('Cache size within limits, no clearing needed');
            return;
        }

        // Convert to array and sort by timestamp (oldest first)
        const keysByAge = Object.entries(timestamps)
            .sort(([, timeA], [, timeB]) => timeA - timeB)
            .map(([key]) => key);

        // Keep last 5 caches (most recent)
        const keysToKeep = keysByAge.slice(-5);
        const keysToRemove = registry.filter(key => !keysToKeep.includes(key));

        // Remove old caches
        keysToRemove.forEach(key => {
            localStorage.removeItem(key);
            console.log(`Removed old cache: ${key}`);
        });

        // Update registry
        localStorage.setItem('cache_registry', JSON.stringify(keysToKeep));

        // Update timestamps
        const newTimestamps = {};
        keysToKeep.forEach(key => {
            newTimestamps[key] = timestamps[key];
        });
        localStorage.setItem('cache_timestamps', JSON.stringify(newTimestamps));

        console.log(`Cleared ${keysToRemove.length} old caches, keeping ${keysToKeep.length}`);
    } catch (e) {
        console.warn('Error clearing old caches', e);

        // Fallback: clear all attendance caches
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('attendance_')) {
                    localStorage.removeItem(key);
                }
            }
        } catch (clearError) {
            console.error('Failed to clear caches', clearError);
        }
    }
}

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', async function() {
    // Setup event listeners
    closeModal.addEventListener('click', closePhotoModal);
    periodSelect.addEventListener('change', async function () {
        attendanceData = {};

        localStorage.removeItem(getCacheKey(this.value, branchSelect.value));
        await loadData(this.value);
    });
    branchSelect.addEventListener('change', filterData);
    refreshBtn.addEventListener('click', function () {
        // Force refresh from server
        refreshBtn.dataset.forceRefresh = 'true';
        loadData();
    });
    exportBtn.addEventListener('click', exportToCSV);

    // Load initial data
    await loadData();

    // After initial load, hide the loading overlay
    isInitialLoad = false;
});

async function initializePayrollPeriods() {
    // If periods are already initialized, just return
    if (window.payrollPeriods && window.payrollPeriods.length > 0) {
        return;
    }

    try {
        console.log("Initializing payroll periods");

        // Check if we have cached periods
        const cachedPeriods = localStorage.getItem('payroll_periods');
        if (cachedPeriods) {
            window.payrollPeriods = JSON.parse(cachedPeriods);
            console.log("Loaded periods from cache:", window.payrollPeriods.length);

            // Restore date objects (they were serialized as strings)
            window.payrollPeriods.forEach(period => {
                period.start = new Date(period.start);
                period.end = new Date(period.end);
            });

            // Update dropdown
            updatePeriodDropdown();
            return;
        }

        // Otherwise, we need to collect all dates
        const allDates = new Set();
        const employeeIds = Object.keys(employees);

        // Use a single employee to get all dates or a small sample
        // This is much faster than querying all employees
        const sampleSize = Math.min(3, employeeIds.length);
        const sampleIds = employeeIds.slice(0, sampleSize);

        for (const employeeId of sampleIds) {
            const attendanceRef = collection(db, "attendance", employeeId, "dates");
            const snapshot = await getDocs(attendanceRef);

            snapshot.forEach(doc => {
                allDates.add(doc.id);
            });
        }

        if (allDates.size === 0) {
            console.warn("No attendance data found — using default period");
            window.payrollPeriods = generateDefaultPeriods();
        } else {
            // Generate periods from the available dates
            const sortedDates = Array.from(allDates).map(d => new Date(d)).sort((a, b) => a - b);
            const minDate = sortedDates[0];
            const maxDate = sortedDates[sortedDates.length - 1];
            window.payrollPeriods = generatePayrollPeriods(minDate, maxDate);
        }

        // Cache the periods
        localStorage.setItem('payroll_periods', JSON.stringify(window.payrollPeriods));

        // Update dropdown
        updatePeriodDropdown();
    } catch (error) {
        console.error("Error initializing payroll periods:", error);
        window.payrollPeriods = generateDefaultPeriods();
        updatePeriodDropdown();
    }
}

function generateDefaultPeriods() {
    const today = new Date();
    const month = today.getMonth();
    const year = today.getFullYear();

    // Generate 3 periods: current, previous, and before previous
    const periods = [];

    // Current period
    if (today.getDate() <= 12) {
        // First half of month
        const prevMonth = new Date(year, month, 0);
        const daysInPrevMonth = prevMonth.getDate();
        const startDay = Math.min(29, daysInPrevMonth);

        const periodStart = new Date(year, month - 1, startDay);
        const periodEnd = new Date(year, month, 12);

        const id = `${formatDate(periodStart)}_${formatDate(periodEnd)}`;
        const label = `${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

        periods.push({ id, start: periodStart, end: periodEnd, label });
    } else {
        // Second half of month
        const periodStart = new Date(year, month, 13);
        const periodEnd = new Date(year, month + 1, 0); // Last day of current month

        const id = `${formatDate(periodStart)}_${formatDate(periodEnd)}`;
        const label = `${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

        periods.push({ id, start: periodStart, end: periodEnd, label });
    }

    // Add previous periods (2 more)
    for (let i = 1; i <= 2; i++) {
        const lastPeriod = periods[periods.length - 1];
        const prevStart = new Date(lastPeriod.start);
        prevStart.setDate(prevStart.getDate() - 15); // Roughly half a month

        const prevEnd = new Date(lastPeriod.start);
        prevEnd.setDate(prevEnd.getDate() - 1); // Day before start of last period

        const id = `${formatDate(prevStart)}_${formatDate(prevEnd)}`;
        const label = `${prevStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${prevEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

        periods.push({ id, start: prevStart, end: prevEnd, label });
    }

    return periods;
}

function updatePeriodDropdown() {
    if (!window.payrollPeriods || window.payrollPeriods.length === 0) {
        periodSelect.innerHTML = '<option value="default">No Data</option>';
        return;
    }

    periodSelect.innerHTML = window.payrollPeriods.map(p =>
        `<option value="${p.id}">${p.label}</option>`
    ).join('');

    // Set to current period if available
    const today = new Date();
    let currentPeriodIndex = 0;

    for (let i = 0; i < window.payrollPeriods.length; i++) {
        const period = window.payrollPeriods[i];
        if (today >= period.start && today <= period.end) {
            currentPeriodIndex = i;
            break;
        }
    }

    periodSelect.value = window.payrollPeriods[currentPeriodIndex].id;
}

// Load attendance data from Firestore or mock data
// Update the loadData function to only fetch minimal data initially
async function loadData(selectedPeriodId = null) {
    const periodId = selectedPeriodId || periodSelect.value;
    const branchId = branchSelect.value;
    const cacheKey = getCacheKey(periodId, branchId);

    console.log("Loading data for:", periodId, branchId);

    // Always show instant data from cache first if available
    const cachedData = getFromCache(periodId, branchId);
    if (cachedData) {
        console.log('Using cached data initially');
        attendanceData = cachedData;
        filterData();
        hideLoading();

        // If not a forced refresh and not initial load, we can return early
        if (!isInitialLoad && refreshBtn.dataset.forceRefresh !== 'true') {
            console.log('Using cached data only (no background refresh)');
            return;
        }

        // Otherwise, we'll continue to fetch updates in the background
        console.log('Continuing with background data refresh');
    } else {
        // No cache available, show loading indicator
        showLoading();
    }

    // Reset force refresh flag
    refreshBtn.dataset.forceRefresh = 'false';

    try {
        // First, get all employee IDs
        const employeeIds = Object.keys(employees);

        // We'll use this to track any changes
        let hasChanges = false;

        // Initialize data structure if not from cache
        if (!cachedData) {
            attendanceData = {};
            employeeIds.forEach(employeeId => {
                attendanceData[employeeId] = {
                    id: employeeId,
                    name: employees[employeeId],
                    dates: [],
                    lastClockIn: null,
                    lastClockInPhoto: null,
                    daysWorked: 0,
                    lateHours: 0,
                    baseRate: 0
                };
            });
        }

        // Initialize or update payroll periods
        await initializePayrollPeriods();

        // Get selected period dates
        const { startDate, endDate } = getPeriodDates(periodId);
        const formattedStartDate = formatDate(startDate);
        const formattedEndDate = formatDate(endDate);

        // Fetch employee data in parallel - this is much faster!
        const employeePromises = employeeIds.map(async (employeeId) => {
            try {
                // Always ensure the employee exists in the data structure
                if (!attendanceData[employeeId]) {
                    attendanceData[employeeId] = {
                        id: employeeId,
                        name: employees[employeeId],
                        dates: [],
                        lastClockIn: null,
                        lastClockInPhoto: null,
                        daysWorked: 0,
                        lateHours: 0,
                        baseRate: 0
                    };
                }

                // Get employee base rate
                const employeeDocRef = doc(db, "employees", employeeId);
                const employeeDoc = await getDoc(employeeDocRef);
                if (employeeDoc.exists()) {
                    const employeeData = employeeDoc.data();
                    const oldBaseRate = attendanceData[employeeId].baseRate || 0;
                    const newBaseRate = employeeData.baseRate || 0;

                    if (oldBaseRate !== newBaseRate) {
                        attendanceData[employeeId].baseRate = newBaseRate;
                        hasChanges = true;
                    }
                }

                // Get attendance data
                const attendanceRef = collection(db, "attendance", employeeId, "dates");

                // Use a where clause to only fetch dates in range
                const snapshot = await getDocs(query(
                    attendanceRef,
                    where("__name__", ">=", formattedStartDate),
                    where("__name__", "<=", formattedEndDate)
                ));

                // Skip if no data and we already have no data
                if (snapshot.empty && attendanceData[employeeId].dates.length === 0) {
                    return;
                }

                let lastClockInDate = attendanceData[employeeId].lastClockIn
                    ? new Date(attendanceData[employeeId].lastClockIn)
                    : null;
                let totalLateHours = 0;
                let daysWorkedCount = 0;
                let datesMap = {};

                // Create a map of existing dates for quick lookup
                if (attendanceData[employeeId].dates) {
                    attendanceData[employeeId].dates.forEach(date => {
                        datesMap[date.date] = date;
                    });
                }

                // Process each date in the snapshot
                snapshot.forEach(doc => {
                    const dateStr = doc.id;
                    const dateData = doc.data();

                    // Create the new entry
                    const newEntry = {
                        date: dateStr,
                        branch: dateData.clockIn?.branch || "N/A",
                        shift: dateData.clockIn?.shift || "N/A",
                        scheduledIn: SHIFT_SCHEDULES[dateData.clockIn?.shift || "Opening"].timeIn,
                        scheduledOut: SHIFT_SCHEDULES[dateData.clockIn?.shift || "Opening"].timeOut,
                        timeIn: dateData.clockIn?.time || null,
                        timeOut: dateData.clockOut?.time || null,
                        timeInPhoto: dateData.clockIn?.selfie || null,
                        timeOutPhoto: dateData.clockOut?.selfie || null
                    };

                    // Check if this is a new or updated entry
                    const existingEntry = datesMap[dateStr];
                    let entryChanged = false;

                    if (!existingEntry) {
                        // Completely new entry
                        entryChanged = true;
                    } else {
                        // Check if any fields changed
                        for (const key of Object.keys(newEntry)) {
                            if (JSON.stringify(newEntry[key]) !== JSON.stringify(existingEntry[key])) {
                                entryChanged = true;
                                break;
                            }
                        }
                    }

                    if (entryChanged) {
                        datesMap[dateStr] = newEntry;
                        hasChanges = true;
                    }

                    // Update stats
                    if (dateData.clockIn && dateData.clockOut) daysWorkedCount++;

                    if (dateData.clockIn?.shift) {
                        const scheduled = SHIFT_SCHEDULES[dateData.clockIn.shift]?.timeIn || "9:30 AM";
                        const lateMinutes = compareTimes(dateData.clockIn.time, scheduled);
                        if (lateMinutes > 0) totalLateHours += lateMinutes / 60;
                    }

                    if (dateData.clockIn) {
                        const dateObj = new Date(dateStr);
                        if (!lastClockInDate || dateObj > lastClockInDate) {
                            lastClockInDate = dateObj;
                        }
                    }
                });

                // Update the employee data if we have changes
                if (hasChanges) {
                    // Convert dates map back to array
                    attendanceData[employeeId].dates = Object.values(datesMap);
                    attendanceData[employeeId].daysWorked = daysWorkedCount;
                    attendanceData[employeeId].lateHours = totalLateHours;
                    attendanceData[employeeId].lastClockIn = lastClockInDate;

                    // Find the selfie for the last clock in
                    if (lastClockInDate) {
                        const lastDateStr = formatDate(lastClockInDate);
                        const lastDateEntry = datesMap[lastDateStr];
                        if (lastDateEntry) {
                            attendanceData[employeeId].lastClockInPhoto = lastDateEntry.timeInPhoto;
                        }
                    }
                }
            } catch (error) {
                console.error(`Error loading data for employee ${employeeId}:`, error);
                // Make sure we have an entry for this employee even if error occurred
                if (!attendanceData[employeeId]) {
                    attendanceData[employeeId] = {
                        id: employeeId,
                        name: employees[employeeId],
                        dates: [],
                        lastClockIn: null,
                        lastClockInPhoto: null,
                        daysWorked: 0,
                        lateHours: 0,
                        baseRate: 0
                    };
                }
            }
        });

        // Wait for all employee data to load
        await Promise.all(employeePromises);

        // If we've made changes, save to cache and update the UI
        if (hasChanges) {
            console.log("Data changed, updating cache and UI");
            saveToCache(cacheKey, attendanceData);
            filterData();
        } else if (!cachedData) {
            // Initial load with no data, still need to update UI
            filterData();
        }
    } catch (error) {
        console.error("❌ Error loading data:", error);
        if (!cachedData) {
            alert("Failed to load data. Please try again.");
        }
    } finally {
        hideLoading();
    }
}

// Filter data based on selected period and branch
// Update the filterData() function around line 212:
// Filter data based on selected period and branch
// Replace the existing filterData function with this updated version
function filterData() {
    const period = periodSelect.value;
    const branch = branchSelect.value;
    const { startDate, endDate } = getPeriodDates(period);

    // First make a deep copy of original attendance data to avoid modifying it
    filteredData = JSON.parse(JSON.stringify(attendanceData));

    // If we're in single employee view, filter to just that employee
    if (currentEmployeeView) {
        const singleEmployeeData = {};
        if (filteredData[currentEmployeeView]) {
            singleEmployeeData[currentEmployeeView] = filteredData[currentEmployeeView];
        }
        filteredData = singleEmployeeData;
    }

    // Apply period filters by recalculating key metrics
    Object.keys(filteredData).forEach(employeeId => {
        let lastClockInDate = null;
        let totalLateHours = 0;
        let daysWorkedCount = 0;

        // Filter dates for selected period
        filteredData[employeeId].dates = filteredData[employeeId].dates.filter(date => {
            const dateObj = new Date(date.date);
            const dateObjNoTime = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
            const startDateNoTime = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endDateNoTime = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

            // Check if date is in the selected period range
            return dateObjNoTime >= startDateNoTime && dateObjNoTime <= endDateNoTime;
        });

        // Apply branch filter if needed
        if (branch !== 'all') {
            const branchName = getBranchName(branch);
            filteredData[employeeId].dates = filteredData[employeeId].dates.filter(date => {
                return date.branch === branchName;
            });
        }

        // Recalculate metrics based on filtered dates
        filteredData[employeeId].dates.forEach(date => {
            if (date.timeIn || date.timeOut) {
                daysWorkedCount++;
            }

            if (date.scheduledIn && date.timeIn) {
                const lateMinutes = compareTimes(date.timeIn, date.scheduledIn);
                if (lateMinutes > 0) totalLateHours += lateMinutes / 60;
            }

            const dateObj = new Date(date.date);
            if (date.timeIn && (!lastClockInDate || dateObj > lastClockInDate)) {
                lastClockInDate = dateObj;
                filteredData[employeeId].lastClockIn = dateObj;
                filteredData[employeeId].lastClockInPhoto = date.timeInPhoto;
            }
        });

        // Update the employee's metrics
        filteredData[employeeId].daysWorked = daysWorkedCount;
        filteredData[employeeId].lateHours = totalLateHours;
        if (!lastClockInDate) {
            filteredData[employeeId].lastClockIn = null;
            filteredData[employeeId].lastClockInPhoto = null;
        }
    });

    // Update summary cards
    updateSummaryCards();

    // Render the filtered data
    renderEmployeeTable();
}

// Replace the updateSummaryCards function
function updateSummaryCards() {
    // Calculate summary values
    const totalEmployees = Object.keys(employees).length;

    // Count active employees (those with at least one clock-in for the period)
    let activeEmployees = 0;
    let totalPayrollAmount = 0;

    // Get period dates
    const period = periodSelect.value;
    const { startDate, endDate } = getPeriodDates(period);

    // Count holidays in the period
    const holidays = countHolidaysInPeriod(startDate, endDate);

    Object.values(filteredData).forEach(employee => {
        // Check if employee has at least one clock-in
        const hasAttendance = employee.dates.some(date => date.timeIn);
        if (hasAttendance) {
            activeEmployees++;
            // Calculate pay for this employee and add to total
            const baseRate = employee.baseRate || 0;
            totalPayrollAmount += calculateTotalPay(0, baseRate, employee.dates);
        }
    });

    // Update cards
    document.getElementById('totalEmployees').textContent = totalEmployees;
    document.getElementById('activeEmployees').textContent = activeEmployees;
    document.getElementById('totalLateHours').textContent = `${holidays.regular} regular, ${holidays.special} special`; // Replace late hours with holidays
    document.getElementById('totalPayroll').textContent = `₱${totalPayrollAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Update the late hours label to say "Holidays"
    // const lateHoursLabel = document.querySelector('label[for="totalLateHours"]');
    // if (lateHoursLabel) {
    //     lateHoursLabel.textContent = "Holidays";
    // }

    const holidaysList = [];
    for (const dateStr in HOLIDAYS_2025) {
        const holiday = HOLIDAYS_2025[dateStr];
        const holidayDate = new Date(dateStr);
        if (holidayDate >= startDate && holidayDate <= endDate) {
            holidaysList.push({
                date: dateStr,
                name: holiday.name,
                type: holiday.type
            });
        }
    }

    const holidayDisplay = document.getElementById('totalLateHours');

    if (holidaysList.length > 0) {
        // Sort holidays by date
        holidaysList.sort((a, b) => new Date(a.date) - new Date(b.date));

        let htmlContent = '';

        // Format each holiday in a compact, elegant format
        holidaysList.forEach(holiday => {
            const date = new Date(holiday.date);
            const formattedDate = date.toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric'
            });

            // Type class for styling (regular or special)
            const typeClass = holiday.type === 'regular' ? 'regular-holiday' : 'special-holiday';

            // Create the holiday entry with name and date on separate lines
            htmlContent += `
                <div class="holiday-entry">
                    <div class="holiday-date">${formattedDate}</div>
                    <div class="holiday-name ${typeClass}">${holiday.name}</div>
                </div>
            `;
        });

        holidayDisplay.innerHTML = `<div class="holidays-container">${htmlContent}</div>`;
    } else {
        holidayDisplay.textContent = "No holidays";
    }
}

function renderEmployeeTable() {
    
    employeeTableBody.innerHTML = '';

    let filteredEmployees = Object.entries(filteredData)
        .filter(([_, employee]) => employee.dates.length > 0);

    if (activeOnlyToggle.checked) {
        filteredEmployees = filteredEmployees.filter(([_, employee]) =>
            employee.dates.some(date => date.timeIn)
        );
    }

    filteredEmployees = filteredEmployees.filter(([_, employee]) =>
        employee.dates.length > 0
    );

    if (filteredEmployees.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="7" class="no-data">No data available for the selected filters</td>`;
        employeeTableBody.appendChild(row);
        return;
    }

    // Continue with the rest of the function using filteredEmployees
    filteredEmployees.forEach(([employeeId, employee]) => {
        const row = document.createElement('tr');
        row.className = 'expandable-row';
        row.dataset.employeeId = employeeId;

        // Use pre-calculated values instead of recalculating
        const daysWorked = employee.daysWorked;
        const lateHours = employee.lateHours;

        // Format the last clock-in date
        let lastClockIn = 'N/A';
        if (employee.lastClockIn) {
            const dateObj = employee.lastClockIn;
            const options = { year: 'numeric', month: 'long', day: 'numeric' };
            lastClockIn = dateObj.toLocaleDateString('en-US', options);
        }

        row.innerHTML = `
            <td>
                <span class="employee-name">${employees[employeeId]}</span>
            </td>
            <td>${daysWorked}</td>
            <td class="${lateHours > 0 ? 'late' : ''}">${lateHours.toFixed(1)}</td>
            <td class="base-rate">₱${(employee.baseRate || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>₱${calculateTotalPay(daysWorked, employee.baseRate || 0, employee.dates).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="time-cell">
                ${employee.lastClockInPhoto ?
                        `<img src="${employee.lastClockInPhoto}" class="thumb" data-photo="${employee.lastClockInPhoto}" alt="Last clock-in photo">` :
                        ``}
                <span class="date-readable">${lastClockIn}</span>
            </td>
            <td>
                <button class="action-btn view-details-btn">View</button>
                <button class="action-btn open-btn">Open</button>
                <button class="action-btn edit-employee-btn">Edit</button>
            </td>
        `;

        employeeTableBody.appendChild(row);

        // Create detail row placeholder - will be populated on demand
        const detailRow = document.createElement('tr');
        detailRow.className = 'detail-row';
        detailRow.dataset.employeeId = employeeId;
        detailRow.dataset.loaded = 'false';

        // Generate placeholder content
        const detailContent = document.createElement('td');
        detailContent.colSpan = 7;
        detailContent.className = 'detail-content';
        detailContent.innerHTML = '<div class="loading-placeholder">Click "View Details" to load attendance details</div>';

        detailRow.appendChild(detailContent);
        employeeTableBody.appendChild(detailRow);
    });

    

    // Add event listeners for view details buttons
    document.querySelectorAll('.view-details-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const row = this.closest('.expandable-row');
            const employeeId = row.dataset.employeeId;
            const detailRow = document.querySelector(`.detail-row[data-employee-id="${employeeId}"]`);

            // Load details on demand
            if (detailRow.dataset.loaded === 'false') {
                loadEmployeeDetails(employeeId, detailRow);
            }

            row.classList.toggle('expanded');
            detailRow.classList.toggle('expanded');
        });
    });

    // Add event listeners for photo thumbnails
    document.querySelectorAll('.thumb').forEach(thumb => {
        thumb.addEventListener('click', function (e) {
            e.stopPropagation();
            const photoUrl = this.dataset.photo;
            openPhotoModal(photoUrl);
        });
    });

    // Add event listeners for edit employee buttons
    document.querySelectorAll('.edit-employee-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const row = this.closest('.expandable-row');
            const employeeId = row.dataset.employeeId;
            openEditEmployeeModal(employeeId);
        });
    });

    // Add this after the other button event listeners in renderEmployeeTable function
    document.querySelectorAll('.open-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const row = this.closest('.expandable-row');
            const employeeId = row.dataset.employeeId;

            // Set the current view to this employee
            currentEmployeeView = employeeId;

            // Update the UI to show we're in single employee view
            updateViewMode();

            // Refilter data to show only this employee
            filterData();
        });
    });

    // Add this at the end of the renderEmployeeTable function, just before the closing brace
    // After setting up all the event listeners

    // If we're in single employee view, automatically load and expand details
    if (currentEmployeeView) {
        const detailRow = document.querySelector(`.detail-row[data-employee-id="${currentEmployeeView}"]`);
        const row = document.querySelector(`.expandable-row[data-employee-id="${currentEmployeeView}"]`);

        if (detailRow && row) {
            // Load details if not loaded
            if (detailRow.dataset.loaded === 'false') {
                loadEmployeeDetails(currentEmployeeView, detailRow);
            }

            // Expand the row
            row.classList.add('expanded');
            detailRow.classList.add('expanded');
        }
    }
}

function getHolidayPayMultiplier(dateStr) {
    if (HOLIDAYS_2025[dateStr]) {
        // Regular holiday: 200% of daily rate
        if (HOLIDAYS_2025[dateStr].type === "regular") {
            return 2.0;
        }
        // Special non-working holiday: 130% of daily rate
        else if (HOLIDAYS_2025[dateStr].type === "special") {
            return 1.3;
        }
    }
    // Regular day: 100% of daily rate
    return 1.0;
}

// Add this function before the updateSummaryCards function
function countHolidaysInPeriod(startDate, endDate) {
    let regularCount = 0;
    let specialCount = 0;

    // Get all dates in the range
    const dates = getDatesInRange(startDate, endDate);

    // Count holidays
    dates.forEach(dateStr => {
        if (HOLIDAYS_2025[dateStr]) {
            if (HOLIDAYS_2025[dateStr].type === 'regular') {
                regularCount++;
            } else if (HOLIDAYS_2025[dateStr].type === 'special') {
                specialCount++;
            }
        }
    });

    return { regular: regularCount, special: specialCount, total: regularCount + specialCount };
}

// Add this function after the getHolidayPayMultiplier function
function calculateDeductions(timeIn, timeOut, scheduledIn, scheduledOut) {
    const LATE_THRESHOLD_MINUTES = 30;
    const UNDERTIME_THRESHOLD_MINUTES = 30;

    let deductions = 0;

    // Calculate late minutes
    if (timeIn && scheduledIn) {
        const lateMinutes = compareTimes(timeIn, scheduledIn);
        console.log("Late minutes:", lateMinutes, "for", timeIn, scheduledIn);
        if (lateMinutes > LATE_THRESHOLD_MINUTES) {
            // Convert minutes to hours and calculate deduction
            const lateHours = lateMinutes / 60;
            deductions += lateHours;
            console.log("Adding late deduction:", lateHours, "hours");
        }
    }

    // Calculate undertime minutes
    if (timeOut && scheduledOut) {
        const undertimeMinutes = compareTimes(scheduledOut, timeOut);
        console.log("Undertime minutes:", undertimeMinutes, "for", timeOut, scheduledOut);
        if (undertimeMinutes > UNDERTIME_THRESHOLD_MINUTES) {
            // Convert minutes to hours and calculate deduction
            const undertimeHours = undertimeMinutes / 60;
            deductions += undertimeHours;
            console.log("Adding undertime deduction:", undertimeHours, "hours");
        }
    }

    return deductions;
}

// Replace the existing calculateTotalPay function with this one
// Replace the existing calculateTotalPay function with this one
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
            const dailyRate = baseRate;

            // Calculate deductions for late/undertime
            const deductionHours = calculateDeductions(
                dateObj.timeIn,
                dateObj.timeOut,
                dateObj.scheduledIn,
                dateObj.scheduledOut
            );

            // Calculate hourly rate (daily rate / 8 hours)
            const hourlyRate = dailyRate / 8;

            // Calculate deduction amount
            const deductionAmount = deductionHours * hourlyRate;
            totalDeductions += deductionAmount;

            // Add base pay with holiday multiplier
            totalPay += dailyRate * multiplier;

            // Add meal allowance (not affected by multiplier)
            totalPay += dailyMealAllowance;

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

// Function to load employee details only when needed
async function loadEmployeeDetails(employeeId, detailRow) {
    // Show loading indicator in the detail row
    detailRow.querySelector('.detail-content').innerHTML = '<div class="spinner"></div>';

    try {
        const period = periodSelect.value;
        const branch = branchSelect.value;
        const { startDate, endDate } = getPeriodDates(period);
        const formattedStartDate = formatDate(startDate);
        const formattedEndDate = formatDate(endDate);

        const dates = [];
        const attendanceRef = collection(db, "attendance", employeeId, "dates");

        // Only fetch dates within the period range
        const querySnapshot = await getDocs(query(
            attendanceRef.withConverter(null),
            where("__name__", ">=", formattedStartDate),
            where("__name__", "<=", formattedEndDate)
        ));

        // Process each date document
        querySnapshot.forEach(doc => {
            const dateData = doc.data();
            const dateStr = doc.id;

            // Add branch filter condition
            const branchName = dateData.clockIn?.branch || "N/A";
            const branchMatches = branch === 'all' || branchName === getBranchName(branch);

            if (branchMatches) {
                // Now we load the full data including photos
                dates.push({
                    date: dateStr,
                    branch: branchName,
                    shift: dateData.clockIn?.shift || "N/A",
                    scheduledIn: SHIFT_SCHEDULES[dateData.clockIn?.shift || "Opening"].timeIn,
                    scheduledOut: SHIFT_SCHEDULES[dateData.clockIn?.shift || "Opening"].timeOut,
                    timeIn: dateData.clockIn?.time || null,
                    timeOut: dateData.clockOut?.time || null,
                    timeInPhoto: dateData.clockIn?.selfie || null,
                    timeOutPhoto: dateData.clockOut?.selfie || null
                });

                // Add this after the push to update the main data store
                if (dateData.clockIn?.selfie || dateData.clockOut?.selfie) {
                    // Make sure attendanceData has this date entry
                    if (!attendanceData[employeeId].dates) {
                        attendanceData[employeeId].dates = [];
                    }

                    // Find or create the date entry
                    let mainDateEntry = attendanceData[employeeId].dates.find(d => d.date === dateStr);
                    if (!mainDateEntry) {
                        mainDateEntry = {
                            date: dateStr,
                            branch: branchName,
                            shift: dateData.clockIn?.shift || "N/A",
                            scheduledIn: SHIFT_SCHEDULES[dateData.clockIn?.shift || "Opening"].timeIn,
                            scheduledOut: SHIFT_SCHEDULES[dateData.clockIn?.shift || "Opening"].timeOut,
                            timeIn: dateData.clockIn?.time || null,
                            timeOut: dateData.clockOut?.time || null
                        };
                        attendanceData[employeeId].dates.push(mainDateEntry);
                    }

                    // Update with photos
                    mainDateEntry.timeInPhoto = dateData.clockIn?.selfie || null;
                    mainDateEntry.timeOutPhoto = dateData.clockOut?.selfie || null;
                }
            }
        });

        // Create detail table
        const detailTable = document.createElement('table');
        detailTable.className = 'detail-table';

        // Add table header
        // In the loadEmployeeDetails function, update the header:
        detailTable.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Branch</th>
                    <th>Shift</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Holiday Pay</th>
                    <th>Deductions</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const detailTableBody = detailTable.querySelector('tbody');

        // Sort dates in descending order
        const sortedDates = [...dates].sort((a, b) => new Date(b.date) - new Date(a.date));

        // Add rows for each date
        sortedDates.forEach(date => {
            const dateObj = new Date(date.date);
            const formattedDate = formatDate(dateObj);
            const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short' });

            const hours = date.timeIn && date.timeOut ? calculateHours(date.timeIn, date.timeOut) : null;

            let status = 'Absent';
            let statusClass = 'absent';

            if (date.timeIn && date.timeOut) {
                if (date.scheduledIn && compareTimes(date.timeIn, date.scheduledIn) > 0) {
                    status = 'Late';
                    statusClass = 'late';
                } else if (date.scheduledOut && compareTimes(date.timeOut, date.scheduledOut) < 0) {
                    status = 'Early Out';
                    statusClass = 'early';
                } else {
                    status = 'Present';
                    statusClass = 'present';
                }
            }

            const detailRowItem = document.createElement('tr');
            // In loadEmployeeDetails function, update the row HTML to place photo above time and remove seconds
            // Update the detailRowItem HTML in loadEmployeeDetails function
            // In the detailRowItem.innerHTML = section, add a holiday column after the status column
            detailRowItem.innerHTML = `
            <td class="date-cell">
                <span class="date-day">${formattedDate}</span>
                <span class="date-dow">${dayOfWeek}</span>
                ${HOLIDAYS_2025[date.date] ?
                            `<span class="holiday-badge ${HOLIDAYS_2025[date.date].type}">${HOLIDAYS_2025[date.date].name}</span>` :
                            ''}
            </td>
            <td>${date.branch || 'N/A'}</td>
            <td>${date.shift || 'N/A'}</td>
            <td class="time-cell">
                ${date.timeInPhoto ?
                            `<img src="${date.timeInPhoto}" class="thumb" data-photo="${date.timeInPhoto}" alt="Clock-in photo">` :
                            `<div style="height: 8px;"></div>`}
                ${date.timeIn ? formatTimeWithoutSeconds(date.timeIn) : 'N/A'}
            </td>
            <td class="time-cell">
                ${date.timeOutPhoto ?
                            `<img src="${date.timeOutPhoto}" class="thumb" data-photo="${date.timeOutPhoto}" alt="Clock-out photo">` :
                            `<div style="height: 8px;"></div>`}
                ${date.timeOut ? formatTimeWithoutSeconds(date.timeOut) : 'N/A'}
            </td>
            <td>${HOLIDAYS_2025[date.date] ?
                            `₱${(filteredData[employeeId].baseRate * (HOLIDAYS_2025[date.date].type === "regular" ? 2.0 : 1.3)).toFixed(2)}` :
                            `₱${filteredData[employeeId].baseRate.toFixed(2)}`}
            </td>
            <td>${date.timeIn && date.timeOut ?
                            (calculateDeductions(date.timeIn, date.timeOut, date.scheduledIn, date.scheduledOut) > 0 ?
                                `₱${((calculateDeductions(date.timeIn, date.timeOut, date.scheduledIn, date.scheduledOut) * (filteredData[employeeId].baseRate / 8))).toFixed(2)}` :
                                '₱0.00') :
                            'N/A'}
            </td>
            <td>
                <button class="action-btn delete-entry-btn" data-date="${date.date}" data-employee="${employeeId}">Delete</button>
            </td>
            `;

            detailTableBody.appendChild(detailRowItem);
        });

        // Replace loading indicator with table
        detailRow.querySelector('.detail-content').innerHTML = '';
        detailRow.querySelector('.detail-content').appendChild(detailTable);

        // Mark as loaded
        detailRow.dataset.loaded = 'true';

        // Add event listeners for new photo thumbnails
        detailRow.querySelectorAll('.thumb').forEach(thumb => {
            thumb.addEventListener('click', function (e) {
                e.stopPropagation();
                const photoUrl = this.dataset.photo;
                openPhotoModal(photoUrl);
            });
        });

        detailRow.querySelectorAll('.delete-entry-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                deleteAttendanceEntry(employeeId, dateStr);
            });
        });

    } catch (error) {
        console.error("Error loading employee details:", error);
        detailRow.querySelector('.detail-content').innerHTML = '<div class="error-message">Failed to load details. Please try again.</div>';
    }
}

// Add this function after the getRandomShift function
function guessShift(timeIn, timeOut) {
    if (!timeIn || !timeOut) return "Custom";

    // Convert times to minutes since midnight for easier comparison
    const [inTime, inMeridian] = timeIn.split(' ');
    const [inHours, inMinutes] = inTime.split(':').map(Number);
    const inTotalMinutes = (inMeridian === 'PM' && inHours !== 12 ? inHours + 12 : inHours % 12) * 60 + inMinutes;

    const [outTime, outMeridian] = timeOut.split(' ');
    const [outHours, outMinutes] = outTime.split(':').map(Number);
    const outTotalMinutes = (outMeridian === 'PM' && outHours !== 12 ? outHours + 12 : outHours % 12) * 60 + outMinutes;

    // Define shift start times in minutes
    const openingStart = 9 * 60 + 30;  // 9:30 AM
    const midshiftStart = 11 * 60;     // 11:00 AM
    const closingStart = 13 * 60;      // 1:00 PM

    // Calculate differences
    const diffFromOpening = Math.abs(inTotalMinutes - openingStart);
    const diffFromMidshift = Math.abs(inTotalMinutes - midshiftStart);
    const diffFromClosing = Math.abs(inTotalMinutes - closingStart);

    // Determine closest shift
    const closestDiff = Math.min(diffFromOpening, diffFromMidshift, diffFromClosing);

    if (closestDiff === diffFromOpening) return "Opening";
    if (closestDiff === diffFromMidshift) return "Midshift";
    if (closestDiff === diffFromClosing) return "Closing";

    return "Custom";
}

// Add this new function to format time without seconds
function formatTimeWithoutSeconds(timeStr) {
    if (!timeStr) return 'N/A';

    // Split time into components
    const [time, meridian] = timeStr.split(' ');
    const [hours, minutes, seconds] = time.split(':');

    // Return without seconds
    return `${hours}:${minutes} ${meridian}`;
}

// Generate mock attendance data for testing
async function generateMockData() {
    const mockData = {};

    // Get period dates range
    const period = periodSelect.value;
    const { startDate, endDate } = getPeriodDates(period);
    const datesInRange = getDatesInRange(startDate, endDate);

    // Generate data for each employee
    Object.keys(employees).forEach(employeeId => {
        mockData[employeeId] = {
            id: employeeId,
            name: employees[employeeId],
            dates: []
        };

        // Add data for each date in the range
        datesInRange.forEach(date => {
            const dateObj = new Date(date);
            const dayOfWeek = dateObj.getDay();

            // Skip weekends (0 = Sunday, 6 = Saturday) or random days off
            if (dayOfWeek === 0 || dayOfWeek === 6 || Math.random() > 0.85) {
                return;
            }

            // Determine branch and shift
            const branch = getRandomBranch();
            const shift = getRandomShift();
            const schedule = SHIFT_SCHEDULES[shift];

            // Generate clock in time (potentially late)
            const isLate = Math.random() > 0.7;
            const lateMinutes = isLate ? Math.floor(Math.random() * 30) : 0;
            const timeIn = addMinutesToTime(schedule.timeIn, lateMinutes);

            // Generate clock out time (potentially early)
            const isEarlyOut = Math.random() > 0.8;
            const earlyMinutes = isEarlyOut ? Math.floor(Math.random() * 25) : 0;
            const timeOut = addMinutesToTime(schedule.timeOut, -earlyMinutes);

            // Add date entry
            mockData[employeeId].dates.push({
                date: date,
                branch: branch,
                shift: shift,
                scheduledIn: schedule.timeIn,
                scheduledOut: schedule.timeOut,
                timeIn: timeIn,
                timeOut: timeOut,
                timeInPhoto: `https://placehold.co/200x200/e0f7e5/333333?text=${employeeId.slice(-3)}+In`,
                timeOutPhoto: `https://placehold.co/200x200/ffe7e7/333333?text=${employeeId.slice(-3)}+Out`
            });
        });
    });

    return mockData;
}

// Helper function to get random branch
function getRandomBranch() {
    const branches = [
        "Podium",
        "SM North",
        "Pop-up",
        "Workshop",
        "Other Events"
    ];
    return branches[Math.floor(Math.random() * branches.length)];
}

// Helper function to get random shift
function getRandomShift() {
    const shifts = ["Opening", "Midshift", "Closing"];
    return shifts[Math.floor(Math.random() * shifts.length)];
}

// Helper function to add minutes to a time string
function addMinutesToTime(timeStr, minutes) {
    const [time, meridian] = timeStr.split(' ');
    let [hours, mins] = time.split(':').map(Number);

    // Convert to 24-hour format
    if (meridian === 'PM' && hours !== 12) hours += 12;
    if (meridian === 'AM' && hours === 12) hours = 0;

    // Add minutes
    const totalMinutes = hours * 60 + mins + minutes;
    let newHours = Math.floor(totalMinutes / 60) % 24;
    const newMins = totalMinutes % 60;

    // Convert back to 12-hour format
    const newMeridian = newHours >= 12 ? 'PM' : 'AM';
    newHours = newHours % 12 || 12;

    return `${newHours}:${newMins.toString().padStart(2, '0')} ${newMeridian}`;
}

// Open photo modal with the given photo URL
function openPhotoModal(photoUrl) {
    modalImage.src = photoUrl;
    photoModal.style.display = 'flex';
}

// Close photo modal
function closePhotoModal() {
    photoModal.style.display = 'none';
}

// Loading state management
let loadingState = 'idle'; // 'idle', 'initial', 'refreshing'

function showLoading(message = 'Loading data...') {
    if (loadingState === 'idle') {
        loadingState = 'initial';
    }

    // Show the loading overlay
    loadingOverlay.style.display = 'flex';

    // Update the loading message if it exists, otherwise create it
    let loadingMessage = loadingOverlay.querySelector('.loading-message');
    if (!loadingMessage) {
        loadingMessage = document.createElement('div');
        loadingMessage.className = 'loading-message';
        loadingOverlay.appendChild(loadingMessage);
    }

    loadingMessage.textContent = message;
}

function hideLoading() {
    loadingState = 'idle';
    loadingOverlay.style.display = 'none';
}

// Helper function to format date as YYYY-MM-DD
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function getPeriodDates(periodId) {
    // Check if payroll periods exists and is an array
    if (!window.payrollPeriods || !Array.isArray(window.payrollPeriods) || window.payrollPeriods.length === 0) {
        console.warn("Payroll periods not initialized. Using default dates.");
        // Fallback in case nothing found
        const today = new Date();
        return {
            startDate: new Date(today.getFullYear(), today.getMonth(), 1),
            endDate: new Date(today.getFullYear(), today.getMonth() + 1, 0)
        };
    }

    const found = window.payrollPeriods.find(p => p.id === periodId);
    if (!found) {
        // Fallback in case nothing found
        const today = new Date();
        return {
            startDate: new Date(today.getFullYear(), today.getMonth(), 1),
            endDate: new Date(today.getFullYear(), today.getMonth(), 12)
        };
    }

    const result = {
        startDate: found ? found.start : fallbackStartDate,
        endDate: found ? found.end : fallbackEndDate
    };
    console.log(`Period ${periodId} dates:`, formatDate(result.startDate), formatDate(result.endDate));
    return result;
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

// Helper function to calculate hours between two time strings
function calculateHours(timeInStr, timeOutStr) {
    try {
        // Parse time strings
        const [timeIn, meridianIn] = timeInStr.split(' ');
        const [hoursIn, minutesIn] = timeIn.split(':').map(Number);

        const [timeOut, meridianOut] = timeOutStr.split(' ');
        const [hoursOut, minutesOut] = timeOut.split(':').map(Number);

        // Convert to 24-hour format
        let hours24In = hoursIn;
        if (meridianIn === 'PM' && hoursIn !== 12) hours24In += 12;
        if (meridianIn === 'AM' && hoursIn === 12) hours24In = 0;

        let hours24Out = hoursOut;
        if (meridianOut === 'PM' && hoursOut !== 12) hours24Out += 12;
        if (meridianOut === 'AM' && hoursOut === 12) hours24Out = 0;

        // Calculate difference in hours
        const totalMinutesIn = hours24In * 60 + minutesIn;
        const totalMinutesOut = hours24Out * 60 + minutesOut;

        // If clock out is earlier than clock in, assume next day
        let minutesDiff = totalMinutesOut - totalMinutesIn;
        if (minutesDiff < 0) minutesDiff += 24 * 60;

        return minutesDiff / 60;
    } catch (error) {
        console.error("Error calculating hours:", error);
        return null;
    }
}

// Helper function to compare times and return difference in minutes
function compareTimes(t1, t2) {
    const [time1, meridian1] = t1.split(' ');
    const [hour1, min1] = time1.split(':').map(Number);
    const minutes1 = (meridian1 === "PM" && hour1 !== 12 ? hour1 + 12 : hour1 % 12) * 60 + min1;

    const [time2, meridian2] = t2.split(' ');
    const [hour2, min2] = time2.split(':').map(Number);
    const minutes2 = (meridian2 === "PM" && hour2 !== 12 ? hour2 + 12 : hour2 % 12) * 60 + min2;

    return minutes1 - minutes2; // > 0 means late
}

// Helper function to get branch name from branch ID
function getBranchName(branchId) {
    const branchMap = {
        'podium': 'Podium',
        'smnorth': 'SM North',
        'popup': 'Pop-up',
        'workshop': 'Workshop',
        'other': 'Other Events'
    };

    return branchMap[branchId] || 'All Branches';
}

// Export data to CSV
function exportToCSV() {
    // Show loading overlay during export
    showLoading();

    // Load JSZip library if not already available
    if (typeof JSZip === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = createZipArchive;
        document.head.appendChild(script);
    } else {
        createZipArchive();
    }
}

function showExportProgress(message) {
    // Check if the progress element already exists
    let progressDiv = document.getElementById('exportProgress');

    if (!progressDiv) {
        progressDiv = document.createElement('div');
        progressDiv.id = 'exportProgress';
        progressDiv.className = 'export-progress';
        progressDiv.innerHTML = `
            <div class="progress-message">Preparing export...</div>
            <div class="progress-spinner"></div>
        `;
        document.body.appendChild(progressDiv);
    }

    if (message) {
        progressDiv.querySelector('.progress-message').textContent = message;
    }

    progressDiv.style.display = 'flex';
}

// Add this function to hide the progress
function hideExportProgress() {
    const progressDiv = document.getElementById('exportProgress');
    if (progressDiv) {
        progressDiv.style.display = 'none';
    }
}

async function createZipArchive() {
    showExportProgress("Preparing export files...");
    try {
        const zip = new JSZip();
        const photoFolder = zip.folder("photos");

        // Get the selected period name for the filename
        const periodText = periodSelect.options[periodSelect.selectedIndex].text;
        const branchText = branchSelect.options[branchSelect.selectedIndex].text;
        const filenameBase = `attendance_${periodText.replace(/\s+/g, '_')}_${branchText.replace(/\s+/g, '_')}`;

        // Build CSV header
        let csv = 'Employee ID,Employee Name,Base Rate,Total Pay,Branch,Date,Shift,Clock In,Clock Out,Hours,Status,Clock In Photo,Clock Out Photo\n';

        // Track photo promises
        const photoPromises = [];
        const photoMap = {};

        // Loop through each employee
        Object.entries(filteredData).forEach(([employeeId, employee]) => {
            const employeeName = employees[employeeId] || `Employee ${employeeId}`;

            // Loop through each date
            employee.dates.forEach((date, index) => {
                const dateObj = new Date(date.date);
                const formattedDate = formatDate(dateObj);

                // Calculate hours
                const hours = date.timeIn && date.timeOut ? calculateHours(date.timeIn, date.timeOut) : 0;

                // Determine status
                let status = 'Absent';
                if (date.timeIn && date.timeOut) {
                    if (date.scheduledIn && compareTimes(date.timeIn, date.scheduledIn) > 0) {
                        status = 'Late';
                    } else if (date.scheduledOut && compareTimes(date.timeOut, date.scheduledOut) < 0) {
                        status = 'Early Out';
                    } else {
                        status = 'Present';
                    }
                }

                // Handle Clock In Photo
                let timeInPhotoFilename = 'N/A';
                if (date.timeInPhoto) {
                    timeInPhotoFilename = `${employeeId}_${formattedDate}_in.jpg`;
                    photoMap[timeInPhotoFilename] = date.timeInPhoto;

                    // Add promise to fetch the photo
                    photoPromises.push(
                        fetch(date.timeInPhoto)
                            .then(response => response.blob())
                            .then(blob => {
                                photoFolder.file(timeInPhotoFilename, blob);
                            })
                            .catch(error => {
                                console.error(`Failed to fetch photo ${date.timeInPhoto}:`, error);
                            })
                    );
                }

                // Handle Clock Out Photo
                let timeOutPhotoFilename = 'N/A';
                if (date.timeOutPhoto) {
                    timeOutPhotoFilename = `${employeeId}_${formattedDate}_out.jpg`;
                    photoMap[timeOutPhotoFilename] = date.timeOutPhoto;

                    // Add promise to fetch the photo
                    photoPromises.push(
                        fetch(date.timeOutPhoto)
                            .then(response => response.blob())
                            .then(blob => {
                                photoFolder.file(timeOutPhotoFilename, blob);
                            })
                            .catch(error => {
                                console.error(`Failed to fetch photo ${date.timeOutPhoto}:`, error);
                            })
                    );
                }

                // Add row to CSV
                csv += `${employeeId},${employeeName},${employee.baseRate || 0},${calculateTotalPay(employee.daysWorked, employee.baseRate || 0).toFixed(2)},${date.branch || 'N/A'},${formattedDate},${date.shift || 'N/A'},${date.timeIn || 'N/A'},${date.timeOut || 'N/A'},${hours ? hours.toFixed(1) : 0},${status},${timeInPhotoFilename},${timeOutPhotoFilename}\n`;
            });
        });

        // Add CSV file to zip
        zip.file(`${filenameBase}.csv`, csv);

        // Add a JSON export with all data
        zip.file(`${filenameBase}.json`, JSON.stringify(filteredData, null, 2));

        showExportProgress(`Downloading ${photoPromises.length} photos...`);

        // Wait for all photo fetches to complete
        await Promise.all(photoPromises);

        showExportProgress("Generating ZIP file...");

        // Generate the zip file
        const content = await zip.generateAsync({ type: 'blob' });

        // Create download link
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${filenameBase}.zip`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        hideExportProgress();
        hideLoading();
    } catch (error) {
        console.error("Error generating export:", error);
        alert("Failed to generate export. Please try again.");

        hideExportProgress();
        hideLoading();
    }
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
        const endOfMonthCutoff = daysInMonth - 3; // 3 days before end of month

        // First cutoff: 13th to 3 days before end of month
        const firstStart = new Date(year, month, 13);
        const firstEnd = new Date(year, month, endOfMonthCutoff);

        if (firstStart <= endDate) {
            periods.push({
                id: `${formatDate(firstStart)}_${formatDate(firstEnd)}`,
                start: firstStart,
                end: firstEnd,
                label: `${firstStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${firstEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            });
        }

        // Second cutoff: 2 days before end of month to 12th of next month
        const secondStart = new Date(year, month, endOfMonthCutoff + 1); // day after first period ends
        const secondEnd = new Date(year, month + 1, 12);

        if (secondStart <= endDate) {
            periods.push({
                id: `${formatDate(secondStart)}_${formatDate(secondEnd)}`,
                start: secondStart,
                end: secondEnd,
                label: `${secondStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${secondEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            });
        }

        current = new Date(year, month + 1, 1); // Move to next month
    }

    // Make sure we have at least 6 periods
    const minPeriods = 6;
    if (periods.length < minPeriods) {
        // Find the earliest period
        const earliestPeriod = periods.reduce((earliest, period) =>
            period.start < earliest.start ? period : earliest, periods[0]);

        // Add more periods by extending backward
        let lastStart = new Date(earliestPeriod.start);

        while (periods.length < minPeriods) {
            // Go back to previous period
            const prevEnd = new Date(lastStart);
            prevEnd.setDate(prevEnd.getDate() - 1);

            // Determine previous period dates based on current cutoff rules
            const prevEndMonth = prevEnd.getMonth();
            const prevEndYear = prevEnd.getFullYear();
            const daysInPrevMonth = new Date(prevEndYear, prevEndMonth + 1, 0).getDate();

            let prevStart;
            if (prevEnd.getDate() <= 12) {
                // If we're in the early month period (1-12), previous period starts at daysInPrevMonth-2
                const prevMonthLastCutoff = daysInPrevMonth - 2;
                prevStart = new Date(prevEndYear, prevEndMonth - 1, prevMonthLastCutoff);
            } else {
                // If we're in the late month period, previous period starts on 13th
                prevStart = new Date(prevEndYear, prevEndMonth, 13);
            }

            const id = `${formatDate(prevStart)}_${formatDate(prevEnd)}`;
            const label = `${prevStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${prevEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

            periods.push({
                id, start: prevStart, end: prevEnd, label
            });

            lastStart = prevStart;
        }
    }

    // Sort periods with most recent first
    return periods.sort((a, b) => b.start - a.start);
}

function updateViewMode() {
    const container = document.querySelector('.container');

    // Clear any existing back button
    const existingBackBtn = document.getElementById('backToAllBtn');
    if (existingBackBtn) {
        existingBackBtn.remove();
    }

    // Get the table container and employee table elements
    const tableContainer = document.querySelector('.data-table-container');
    const employeeTable = document.getElementById('employeeTable');

    if (currentEmployeeView) {
        // Single employee view - restructure the page
        const employeeName = employees[currentEmployeeView] || 'Employee';
        const employee = filteredData[currentEmployeeView];

        // 1. Update page title
        document.querySelector('.app-title').textContent = `${employeeName} - Attendance`;

        // 2. Create back button
        const backBtn = document.createElement('button');
        backBtn.id = 'backToAllBtn';
        backBtn.className = 'back-btn';
        backBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back to All Employees
        `;

        // Add event listener to back button
        backBtn.addEventListener('click', function () {
            // Remove the single employee view
            if (document.getElementById('employee-details-table')) {
                document.getElementById('employee-details-table').remove();
            }

            // Show the original table again
            employeeTable.style.display = 'table';

            currentEmployeeView = null;
            updateViewMode();
            filterData();
        });

        // Add the back button before the table
        container.insertBefore(backBtn, tableContainer);

        // 3. Update summary cards with employee-specific info
        if (employee) {
            // First card: Total Employees → Days worked
            const totalEmpCard = document.getElementById('totalEmployees');
            const totalEmpLabel = totalEmpCard.closest('.summary-card').querySelector('.card-title');
            const totalEmpSubtitle = totalEmpCard.closest('.summary-card').querySelector('.card-subtitle');

            totalEmpLabel.textContent = "Total Employees";
            totalEmpCard.textContent = "18"; // Keep total employees count
            totalEmpSubtitle.textContent = "Days worked";

            // Second card: Active Employees → This employee's days worked
            const activeEmpCard = document.getElementById('activeEmployees');
            const activeEmpLabel = activeEmpCard.closest('.summary-card').querySelector('.card-title');
            const activeEmpSubtitle = activeEmpCard.closest('.summary-card').querySelector('.card-subtitle');

            activeEmpLabel.textContent = "Active Employees";
            activeEmpCard.textContent = employee.daysWorked;
            activeEmpSubtitle.textContent = "This period";

            // Third card: Keep holidays info
            // No changes needed

            // Fourth card: Update to show this employee's pay
            const totalPayCard = document.getElementById('totalPayroll');
            totalPayCard.textContent = `₱${calculateTotalPay(0, employee.baseRate || 0, employee.dates).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }

        // 4. Hide the main employee table
        employeeTable.style.display = 'none';

        // 5. Load the employee details and make them the main table
        // First check if we already have a details table
        let detailsTable = document.getElementById('employee-details-table');
        if (!detailsTable) {
            // Create a container for the employee details
            const detailsContainer = document.createElement('div');
            detailsContainer.id = 'employee-details-table';

            // Add loading indicator
            detailsContainer.innerHTML = '<div class="spinner"></div>';
            tableContainer.appendChild(detailsContainer);

            // Load the employee details
            loadEmployeeDetailsAsMainTable(currentEmployeeView, detailsContainer);
        }
    } else {
        // All employees view - restore original view
        document.querySelector('.app-title').textContent = 'Admin Dashboard';

        // Show the original table
        employeeTable.style.display = 'table';

        // Remove any employee details table
        const detailsTable = document.getElementById('employee-details-table');
        if (detailsTable) {
            detailsTable.remove();
        }

        // Reset the card titles and subtitles to original values
        const totalEmpCard = document.getElementById('totalEmployees');
        const totalEmpLabel = totalEmpCard.closest('.summary-card').querySelector('.card-title');
        const totalEmpSubtitle = totalEmpCard.closest('.summary-card').querySelector('.card-subtitle');

        totalEmpLabel.textContent = "Total Employees";
        totalEmpSubtitle.textContent = "All staff";

        const activeEmpCard = document.getElementById('activeEmployees');
        const activeEmpLabel = activeEmpCard.closest('.summary-card').querySelector('.card-title');
        const activeEmpSubtitle = activeEmpCard.closest('.summary-card').querySelector('.card-subtitle');

        activeEmpLabel.textContent = "Active Employees";
        activeEmpSubtitle.textContent = "For this period";

        // Update summary cards with overall data
        updateSummaryCards();
    }
}

async function loadEmployeeDetailsAsMainTable(employeeId, container) {
    try {
        const period = periodSelect.value;
        const branch = branchSelect.value;
        const { startDate, endDate } = getPeriodDates(period);
        const formattedStartDate = formatDate(startDate);
        const formattedEndDate = formatDate(endDate);

        const dates = [];
        const attendanceRef = collection(db, "attendance", employeeId, "dates");

        // Only fetch dates within the period range
        const querySnapshot = await getDocs(query(
            attendanceRef.withConverter(null),
            where("__name__", ">=", formattedStartDate),
            where("__name__", "<=", formattedEndDate)
        ));

        // Process each date document
        querySnapshot.forEach(doc => {
            const dateData = doc.data();
            const dateStr = doc.id;

            // Add branch filter condition
            const branchName = dateData.clockIn?.branch || "N/A";
            const branchMatches = branch === 'all' || branchName === getBranchName(branch);

            if (branchMatches) {
                // Now we load the full data including photos
                dates.push({
                    date: dateStr,
                    branch: branchName,
                    shift: dateData.clockIn?.shift || "N/A",
                    scheduledIn: SHIFT_SCHEDULES[dateData.clockIn?.shift || "Opening"].timeIn,
                    scheduledOut: SHIFT_SCHEDULES[dateData.clockIn?.shift || "Opening"].timeOut,
                    timeIn: dateData.clockIn?.time || null,
                    timeOut: dateData.clockOut?.time || null,
                    timeInPhoto: dateData.clockIn?.selfie || null,
                    timeOutPhoto: dateData.clockOut?.selfie || null
                });
            }
        });

        // Create the employee details table
        const detailTable = document.createElement('table');
        detailTable.className = 'data-table';
        detailTable.id = 'employeeDetailTable';

        // Add table header with delete column
        detailTable.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Branch</th>
                    <th>Shift</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Holiday Pay</th>
                    <th>Deductions</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const detailTableBody = detailTable.querySelector('tbody');

        // Sort dates in descending order
        const sortedDates = [...dates].sort((a, b) => new Date(b.date) - new Date(a.date));

        // Add rows for each date
        sortedDates.forEach(date => {
            const dateObj = new Date(date.date);
            const formattedDate = formatDate(dateObj);
            const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short' });

            const detailRowItem = document.createElement('tr');
            detailRowItem.dataset.date = date.date;
            detailRowItem.innerHTML = `
                <td class="date-cell">
                    <span class="date-day">${formattedDate}</span>
                    <span class="date-dow">${dayOfWeek}</span>
                    ${HOLIDAYS_2025[date.date] ?
                    `<span class="holiday-badge ${HOLIDAYS_2025[date.date].type}">${HOLIDAYS_2025[date.date].name}</span>` :
                    ''}
                </td>
                <td>${date.branch || 'N/A'}</td>
                <td>${date.shift || 'N/A'}</td>
                <td class="time-cell">
                    ${date.timeInPhoto ?
                    `<img src="${date.timeInPhoto}" class="thumb" data-photo="${date.timeInPhoto}" alt="Clock-in photo">` :
                    `<div style="height: 8px;"></div>`}
                    ${date.timeIn ? formatTimeWithoutSeconds(date.timeIn) : 'N/A'}
                </td>
                <td class="time-cell">
                    ${date.timeOutPhoto ?
                    `<img src="${date.timeOutPhoto}" class="thumb" data-photo="${date.timeOutPhoto}" alt="Clock-out photo">` :
                    `<div style="height: 8px;"></div>`}
                    ${date.timeOut ? formatTimeWithoutSeconds(date.timeOut) : 'N/A'}
                </td>
                <td>${HOLIDAYS_2025[date.date] ?
                    `₱${(filteredData[employeeId].baseRate * (HOLIDAYS_2025[date.date].type === "regular" ? 2.0 : 1.3)).toFixed(2)}` :
                    `₱${filteredData[employeeId].baseRate.toFixed(2)}`}
                </td>
                <td>${date.timeIn && date.timeOut ?
                    (calculateDeductions(date.timeIn, date.timeOut, date.scheduledIn, date.scheduledOut) > 0 ?
                        `₱${((calculateDeductions(date.timeIn, date.timeOut, date.scheduledIn, date.scheduledOut) * (filteredData[employeeId].baseRate / 8))).toFixed(2)}` :
                        '₱0.00') :
                    'N/A'}
                </td>
                <td>
                    <button class="action-btn delete-entry-btn" data-date="${date.date}" data-employee="${employeeId}">Delete</button>
                </td>
            `;

            detailTableBody.appendChild(detailRowItem);
        });

        // Replace loading indicator with the table
        container.innerHTML = '';
        container.appendChild(detailTable);

        // Add event listeners for photo thumbnails
        container.querySelectorAll('.thumb').forEach(thumb => {
            thumb.addEventListener('click', function (e) {
                e.stopPropagation();
                const photoUrl = this.dataset.photo;
                openPhotoModal(photoUrl);
            });
        });

        // Add event listeners for delete buttons
        container.querySelectorAll('.delete-entry-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                deleteAttendanceEntry(employeeId, dateStr);
            });
        });

    } catch (error) {
        console.error("Error loading employee details:", error);
        container.innerHTML = '<div class="error-message">Failed to load details. Please try again.</div>';
    }
}

// 2. Now add a function to handle the deletion of an attendance entry
async function deleteAttendanceEntry(employeeId, dateStr) {
    if (!employeeId || !dateStr) {
        console.error("Missing required parameters for deletion");
        return;
    }

    // Show a confirmation dialog
    if (!confirm(`Are you sure you want to delete the attendance record for ${dateStr}?`)) {
        return; // User cancelled
    }

    showLoading("Deleting attendance entry...");

    try {
        // Reference to the document to delete
        const entryRef = doc(db, "attendance", employeeId, "dates", dateStr);
        
        // Delete from Firestore
        await deleteDoc(entryRef);
        
        console.log(`Deleted attendance entry for ${employeeId} on ${dateStr}`);
        
        // Remove from local data
        if (attendanceData[employeeId]) {
            attendanceData[employeeId].dates = attendanceData[employeeId].dates.filter(date => date.date !== dateStr);
            
            // Recalculate metrics
            let daysWorkedCount = 0;
            let totalLateHours = 0;
            
            attendanceData[employeeId].dates.forEach(date => {
                if (date.timeIn && date.timeOut) {
                    daysWorkedCount++;
                }
                
                if (date.scheduledIn && date.timeIn) {
                    const lateMinutes = compareTimes(date.timeIn, date.scheduledIn);
                    if (lateMinutes > 0) totalLateHours += lateMinutes / 60;
                }
            });
            
            attendanceData[employeeId].daysWorked = daysWorkedCount;
            attendanceData[employeeId].lateHours = totalLateHours;
        }
        
        // Update cache
        const periodId = periodSelect.value;
        const branchId = branchSelect.value;
        const cacheKey = getCacheKey(periodId, branchId);
        saveToCache(cacheKey, attendanceData);
        
        // Reload the view to reflect changes
        if (currentEmployeeView) {
            // If we're in the single employee view, reload just that view
            const container = document.getElementById('employee-details-table');
            if (container) {
                loadEmployeeDetailsAsMainTable(employeeId, container);
            }
            
            // Also update the summary cards
            updateViewMode();
        } else {
            // Otherwise reload all data
            filterData();
        }
        
        alert("Attendance entry deleted successfully");
    } catch (error) {
        console.error("Error deleting attendance entry:", error);
        alert("Failed to delete attendance entry: " + error.message);
    } finally {
        hideLoading();
    }
}



// Add event listeners for base rate inputs
document.querySelectorAll('.base-rate-input').forEach(input => {
    input.addEventListener('change', async function () {
        const employeeId = this.dataset.employeeId;
        const newBaseRate = parseFloat(this.value) || 0;

        try {
            // Update in local data
            attendanceData[employeeId].baseRate = newBaseRate;

            // Update the total pay display
            const daysWorked = attendanceData[employeeId].daysWorked;
            const totalPay = calculateTotalPay(daysWorked, newBaseRate);
            const row = this.closest('tr');
            row.querySelector('td:nth-child(5)').textContent = `₱${totalPay.toFixed(2)}`;

            // Update in Firebase
            const employeeDocRef = doc(db, "employees", employeeId);
            await updateDoc(employeeDocRef, {
                baseRate: newBaseRate
            });

            console.log(`Base rate updated for ${employees[employeeId]} to ${newBaseRate}`);
        } catch (error) {
            console.error(`Error updating base rate for employee ${employeeId}:`, error);
            alert("Failed to update base rate. Please try again.");
            // Revert to previous value
            this.value = attendanceData[employeeId].baseRate || 0;
        }
    });
});

// Open employee edit modal
function openEditEmployeeModal(employeeId) {
    // Get employee data
    const employee = attendanceData[employeeId];

    // Fill form with current data
    editEmployeeName.value = employees[employeeId] || '';
    editBaseRate.value = employee.baseRate || 0;
    editEmployeeId.value = employeeId;

    // Show modal
    employeeEditModal.style.display = 'flex';
}

// Close employee edit modal
function closeEditEmployeeModal() {
    employeeEditModal.style.display = 'none';
}

// Save employee changes
async function saveEmployeeChanges(e) {
    e.preventDefault();

    const employeeId = editEmployeeId.value;
    const newName = editEmployeeName.value.trim();
    const newBaseRate = parseFloat(editBaseRate.value) || 0;

    try {
        // Update in memory
        employees[employeeId] = newName;
        attendanceData[employeeId].baseRate = newBaseRate;

        // Update Firebase - using setDoc instead of updateDoc
        const employeeDocRef = doc(db, "employees", employeeId);
        await setDoc(employeeDocRef, {
            name: newName,
            baseRate: newBaseRate
        }, { merge: true }); // This ensures we only update these fields if the doc exists

        // Update UI
        const row = document.querySelector(`.expandable-row[data-employee-id="${employeeId}"]`);
        row.querySelector('.employee-name').textContent = newName;
        row.querySelector('.base-rate').textContent = `₱${newBaseRate}`;

        // Update total pay
        const daysWorked = attendanceData[employeeId].daysWorked;
        const totalPay = calculateTotalPay(daysWorked, newBaseRate);
        row.querySelector('td:nth-child(5)').textContent = `₱${totalPay.toFixed(2)}`;

        console.log(`Employee ${employeeId} updated: name=${newName}, baseRate=${newBaseRate}`);

        // Close modal
        closeEditEmployeeModal();
    } catch (error) {
        console.error("Error updating employee:", error);
        alert("Failed to update employee details. Please try again.");
    }
}

// Add this to your DOM elements section
const activeOnlyToggle = document.getElementById('activeOnlyToggle');

// Add this to your DOMContentLoaded event listener setup
activeOnlyToggle.addEventListener('change', filterData);
// Background data refresh functionality
let backgroundRefreshInProgress = false;

function showBackgroundRefresh() {
    refreshIndicator.style.display = 'flex';
}

function hideBackgroundRefresh() {
    refreshIndicator.style.display = 'none';
}

async function backgroundRefresh() {
    // Don't start another refresh if one is in progress
    if (backgroundRefreshInProgress) {
        console.log("Background refresh already in progress, skipping");
        return;
    }

    backgroundRefreshInProgress = true;
    showBackgroundRefresh();

    try {
        console.log("Starting background data refresh");

        // Use current period and branch
        const periodId = periodSelect.value;
        const branchId = branchSelect.value;

        // Check when data was last refreshed
        const cacheKey = getCacheKey(periodId, branchId);
        const cachedData = localStorage.getItem(cacheKey);

        // Only refresh if we have cached data that's older than 15 minutes
        if (cachedData) {
            const parsedCache = JSON.parse(cachedData);
            const lastRefresh = parsedCache.timestamp;
            const refreshAge = Date.now() - lastRefresh;
            const minRefreshInterval = 15 * 60 * 1000; // 15 minutes

            if (refreshAge < minRefreshInterval) {
                console.log(`Data is fresh (${Math.round(refreshAge / 60000)}min old), skipping refresh`);
                hideBackgroundRefresh();
                backgroundRefreshInProgress = false;
                return;
            }
        }

        // Force a refresh with the current period and branch
        console.log("Refreshing data in the background");
        await loadData(periodId);
    } catch (error) {
        console.error("Error in background refresh:", error);
        // Failed silently - no need to alert user since this is in the background
    } finally {
        hideBackgroundRefresh();
        backgroundRefreshInProgress = false;
    }
}

// Set up periodic background refresh
function setupBackgroundRefresh() {
    // Check for updates every 5 minutes
    const refreshInterval = 5 * 60 * 1000; // 5 minutes

    // First refresh after 30 seconds (give time for initial load)
    setTimeout(() => {
        backgroundRefresh();

        // Then set up regular interval
        setInterval(backgroundRefresh, refreshInterval);
    }, 30 * 1000);

    // Also refresh when tab becomes visible again
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            // Wait a second after becoming visible
            setTimeout(backgroundRefresh, 1000);
        }
    });
}

// Add this to your DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async function () {
    // Existing setup code...

    // Set up background refresh after initial load
    setupBackgroundRefresh();
});

document.addEventListener('DOMContentLoaded', async function () {
    console.time('app-init');

    // Setup event listeners
    closeModal.addEventListener('click', closePhotoModal);
    periodSelect.addEventListener('change', async function () {
        localStorage.removeItem('last_selected_period');
        localStorage.setItem('last_selected_period', this.value);
        await loadData(this.value);
    });

    branchSelect.addEventListener('change', function () {
        localStorage.removeItem('last_selected_branch');
        localStorage.setItem('last_selected_branch', this.value);
        filterData();
    });

    refreshBtn.addEventListener('click', function () {
        // Force refresh from server
        refreshBtn.dataset.forceRefresh = 'true';
        loadData();
    });

    exportBtn.addEventListener('click', exportToCSV);

    // Check for any previously selected period or branch
    const lastSelectedPeriod = localStorage.getItem('last_selected_period');
    const lastSelectedBranch = localStorage.getItem('last_selected_branch');

    if (lastSelectedBranch) {
        branchSelect.value = lastSelectedBranch;
    }

    // Initialize payroll periods first (this is fast because it uses cache)
    await initializePayrollPeriods();

    // If we have a previous selection and it's still valid, use that
    if (lastSelectedPeriod) {
        const isValidSelection = window.payrollPeriods &&
            window.payrollPeriods.some(p => p.id === lastSelectedPeriod);

        if (isValidSelection) {
            periodSelect.value = lastSelectedPeriod;
        }
    }

    // Load initial data (this will use cache if available)
    await loadData();

    // Set up background refresh after initial load
    setupBackgroundRefresh();

    // After initial load, hide the loading overlay and mark as initialized
    isInitialLoad = false;
    console.timeEnd('app-init');
});