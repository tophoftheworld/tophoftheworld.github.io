// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc, setDoc, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
// Add this to your imports at the top of admin-script.js
import { deleteObject, getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Firebase configuration - you'll need to replace this with your actual Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.firebasestorage.app",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266",
    measurementId: "G-YEK4GML6SJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);  // Add this line

// Employee data - loaded from Firebase
let employees = {};

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

let HOLIDAYS_2025 = {};
let holidaysLoaded = false;

async function loadHolidays() {
    if (holidaysLoaded) return HOLIDAYS_2025;

    try {
        const holidayDoc = await getDoc(doc(db, "config", "holidays_2025"));
        if (holidayDoc.exists()) {
            HOLIDAYS_2025 = holidayDoc.data();
            holidaysLoaded = true;
            console.log("✅ Holidays loaded from Firebase");
        }
        return HOLIDAYS_2025;
    } catch (error) {
        console.error("Failed to load holidays:", error);
        return {};
    }
}

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
    "Opening": { timeIn: "9:30 AM", timeOut: "6:30 PM" },
    "Opening Half-Day": { timeIn: "9:30 AM", timeOut: "1:30 PM" },
    "Midshift": { timeIn: "11:00 AM", timeOut: "8:00 PM" },
    "Closing": { timeIn: "1:00 PM", timeOut: "10:00 PM" },
    "Closing Half-Day": { timeIn: "6:00 PM", timeOut: "10:00 PM" },
    "Custom": { timeIn: null, timeOut: null }
};

// Sales bonus configuration
const SALES_BONUS_CONFIG = {
    baseQuotaPerStaff: 5000, // ₱5,000 per staff member
    bonusPerTier: 25,
    tierAmount: 2500,
    defaultStaffing: {
        weekday: 2.5,
        weekend: 3.0
    }
};

// Sales bonus calculation functions
function getStaffingLevel(date) {
    const dateStr = formatDate(date);

    // Count actual SM North staff for this date
    let staffCount = 0;

    Object.values(attendanceData).forEach(employee => {
        const dateEntry = employee.dates.find(d => d.date === dateStr);
        if (dateEntry && dateEntry.timeIn && dateEntry.timeOut && dateEntry.branch === 'SM North') {
            // Count shift values based on hours worked
            if (dateEntry.shift === 'Closing Half-Day' || dateEntry.shift === 'Opening Half-Day') {
                staffCount += 0.5;
            } else if (dateEntry.shift === 'Custom') {
                const actualHours = calculateHours(dateEntry.timeIn, dateEntry.timeOut);
                if (actualHours) {
                    const workHours = actualHours > 4 ? actualHours - 1 : actualHours;
                    const staffEquivalent = Math.min(workHours / 8, 1.5);
                    staffCount += Math.round(staffEquivalent * 2) / 2; // Round to nearest 0.5
                }
            } else if (['Opening', 'Midshift', 'Closing'].includes(dateEntry.shift)) {
                staffCount += 1.0;
            }
        }
    });

    // Fall back to defaults if no attendance data
    if (staffCount === 0) {
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        return isWeekend ? SALES_BONUS_CONFIG.defaultStaffing.weekend : SALES_BONUS_CONFIG.defaultStaffing.weekday;
    }

    return staffCount;
}

function getQuotaForStaffing(staffingLevel) {
    if (staffingLevel < 2.0) {
        // For 1.0 and 1.5 staff: ₱5,000 per staff
        return staffingLevel * 5000;
    } else {
        // For 2.0+ staff: ₱10k base + ₱10k per additional staff above 2.0
        return 10000 + (staffingLevel - 2.0) * 10000;
    }
}

function calculateSalesBonus(salesAmount, quota) {
    if (salesAmount <= quota) return 0;
    const excessAmount = salesAmount - quota;
    const bonusTiers = Math.floor(excessAmount / SALES_BONUS_CONFIG.tierAmount);
    return bonusTiers * SALES_BONUS_CONFIG.bonusPerTier;
}

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
const editNickname = document.getElementById('editNickname');

const shiftEditModal = document.getElementById('shiftEditModal');
const closeShiftEditModalBtn = document.getElementById('closeShiftEditModal');
const cancelShiftEditBtn = document.getElementById('cancelShiftEditBtn');
const shiftEditForm = document.getElementById('shiftEditForm');
const editShiftBranch = document.getElementById('editShiftBranch');
const editShiftSchedule = document.getElementById('editShiftSchedule');
const editShiftEmployeeId = document.getElementById('editShiftEmployeeId');
const editShiftDate = document.getElementById('editShiftDate');

const batchEditModal = document.getElementById('batchEditModal');
const closeBatchEditModalBtn = document.getElementById('closeBatchEditModal');
const cancelBatchEditBtn = document.getElementById('cancelBatchEditBtn');
const batchEditForm = document.getElementById('batchEditForm');
const batchEditBranch = document.getElementById('batchEditBranch');
const batchEditShift = document.getElementById('batchEditShift');
const batchEditEmployeeId = document.getElementById('batchEditEmployeeId');

const addEmployeeBtn = document.getElementById('addEmployeeBtn');
const addEmployeeModal = document.getElementById('addEmployeeModal');
const closeAddEmployeeModal = document.getElementById('closeAddEmployeeModal');
const cancelAddEmployeeBtn = document.getElementById('cancelAddEmployeeBtn');
const addEmployeeForm = document.getElementById('addEmployeeForm');
const addEmployeeId = document.getElementById('addEmployeeId');
const addEmployeeName = document.getElementById('addEmployeeName');
const addBaseRate = document.getElementById('addBaseRate');
const addNickname = document.getElementById('addNickname');
const editSalesBonus = document.getElementById('editSalesBonus');
const addSalesBonus = document.getElementById('addSalesBonus');

const holidaysModal = document.getElementById('holidaysModal');
const closeHolidaysModal = document.getElementById('closeHolidaysModal');
const closeHolidaysBtn = document.getElementById('closeHolidaysBtn');
const addHolidayForm = document.getElementById('addHolidayForm');
const holidaysTableBody = document.getElementById('holidaysTableBody');

const addShiftModal = document.getElementById('addShiftModal');
const closeAddShiftModal = document.getElementById('closeAddShiftModal');
const cancelAddShiftBtn = document.getElementById('cancelAddShiftBtn');
const addShiftForm = document.getElementById('addShiftForm');
const addShiftDate = document.getElementById('addShiftDate');
const addShiftBranch = document.getElementById('addShiftBranch');
const addShiftSchedule = document.getElementById('addShiftSchedule');
const addShiftTimeIn = document.getElementById('addShiftTimeIn');
const addShiftTimeOut = document.getElementById('addShiftTimeOut');
const addShiftEmployeeId = document.getElementById('addShiftEmployeeId');


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

closeShiftEditModalBtn.addEventListener('click', closeShiftEditModal);
cancelShiftEditBtn.addEventListener('click', closeShiftEditModal);
shiftEditForm.addEventListener('submit', saveShiftChanges);

closeBatchEditModalBtn.addEventListener('click', closeBatchEditModal);
cancelBatchEditBtn.addEventListener('click', closeBatchEditModal);
batchEditForm.addEventListener('submit', saveBatchChanges);

addEmployeeBtn.addEventListener('click', openAddEmployeeModal);
closeAddEmployeeModal.addEventListener('click', closeAddEmployeeModalFunc);
cancelAddEmployeeBtn.addEventListener('click', closeAddEmployeeModalFunc);
addEmployeeForm.addEventListener('submit', saveNewEmployee);

closeAddShiftModal.addEventListener('click', closeAddShiftModalFunc);
cancelAddShiftBtn.addEventListener('click', closeAddShiftModalFunc);
addShiftForm.addEventListener('submit', saveNewShift);

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

function clearAllPeriodCaches() {
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('attendance_')) {
            localStorage.removeItem(key);
        }
    }
    console.log("Cleared all period caches");
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

// Modify the getFromCache function to be more tolerant of old cache data:
function getFromCache(periodId, branchId) {
    const cacheKey = getCacheKey(periodId, branchId);

    try {
        const cachedData = localStorage.getItem(cacheKey);
        if (!cachedData) {
            console.log(`No cache found for ${cacheKey}`);
            return null;
        }

        const parsedData = JSON.parse(cachedData);

        // Increase the cache expiration time (from 4 hours to 24 hours)
        const cacheAge = Date.now() - parsedData.timestamp;
        const expirationTime = 24 * 60 * 60 * 1000; // 24 hours instead of 4 hours

        if (cacheAge > expirationTime) {
            console.log('Cache expired, removing');
            localStorage.removeItem(cacheKey);
            return null;
        }

        // Check version (this remains the same)
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



let oldestRecordFound = false;

async function initializePayrollPeriods() {
    try {
        const currentSelection = periodSelect.value;
        console.log("Preserving period selection:", currentSelection);

        // Don't show loading if it's the initial load
        const oldestDate = await findOldestRecordAcrossEmployees();

        // Get current date for the latest date
        const today = new Date();

        // Generate periods
        if (oldestDate) {
            console.log(`Oldest record found: ${formatDate(oldestDate)}`);

            // We don't need to go back before the oldest record
            // Just use the exact date as the start
            window.payrollPeriods = generatePayrollPeriods(oldestDate, today, false);
            console.log(`Generated ${window.payrollPeriods.length} payroll periods from ${formatDate(oldestDate)} to today`);

            // Log the range of periods for debugging
            if (window.payrollPeriods.length > 0) {
                const earliest = window.payrollPeriods[window.payrollPeriods.length - 1];
                const latest = window.payrollPeriods[0];
                console.log(`Period range: ${earliest.label} to ${latest.label}`);
            }
        } else {
            // Default to 3 periods if no data found
            window.payrollPeriods = generatePayrollPeriods();
            console.log("No records found, using default periods");
        }

        // Update dropdown and preserve selection
        updatePeriodDropdown();

        // Restore selection if it exists
        if (currentSelection && periodSelect.querySelector(`option[value="${currentSelection}"]`)) {
            periodSelect.value = currentSelection;
        }
    } catch (error) {
        console.error("Error initializing payroll periods:", error);
        // Fallback to default periods
        window.payrollPeriods = generatePayrollPeriods();
        updatePeriodDropdown();
    }
}

async function findOldestRecordAcrossEmployees() {
    if (!isInitialLoad) {
        showLoading("Finding oldest attendance record...");
    }

    try {
        // Try each employee until we find one with records
        const employeeIds = Object.keys(employees);
        let oldestDate = null;

        for (let i = 0; i < employeeIds.length; i++) {
            const employeeId = employeeIds[i];
            console.log(`Checking employee ${i + 1}/${employeeIds.length}: ${employees[employeeId]}`);

            const attendanceRef = collection(db, "attendance", employeeId, "dates");
            const snapshot = await getDocs(attendanceRef);

            if (!snapshot.empty) {
                // Found an employee with records
                let allDates = [];
                snapshot.forEach(doc => {
                    allDates.push(doc.id);
                });

                // If we found dates, sort them and get the oldest
                if (allDates.length > 0) {
                    allDates.sort();
                    const employeeOldestDate = new Date(allDates[0]);

                    // Update overall oldest date if needed
                    if (!oldestDate || employeeOldestDate < oldestDate) {
                        oldestDate = employeeOldestDate;
                    }

                    console.log(`Found records for ${employees[employeeId]}, oldest: ${allDates[0]}`);

                    // We found at least one record, so we can continue with other employees
                    // to find the absolute oldest
                }
            }
        }

        if (oldestDate) {
            console.log(`Oldest record found across all employees: ${oldestDate.toISOString().split('T')[0]}`);
            hideLoading();
            return oldestDate;
        } else {
            console.log("No records found across any employees");
            hideLoading();
            return null;
        }
    } catch (error) {
        console.error("Error finding oldest record:", error);
        hideLoading();
        return null;
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
        return employees;
    } catch (error) {
        console.error("Error loading employees:", error);
        return {};
    }
}

async function loadSalesData() {
    try {
        const salesRef = collection(db, "sales");
        const snapshot = await getDocs(salesRef);

        const salesData = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            // Only include sales data if it has total sales amount
            if (data.totalSales || (data.cash || 0) + (data.gcash || 0) + (data.maya || 0) + (data.card || 0) + (data.grab || 0) > 0) {
                salesData[doc.id] = data;
            }
        });

        console.log("Loaded sales data from Firebase:", Object.keys(salesData).length, "records");
        return salesData;
    } catch (error) {
        console.error("Error loading sales data:", error);
        return {};
    }
}

function updatePeriodDropdown() {
    // Store current selection before changing anything
    const currentSelection = periodSelect.value;
    console.log("Current period before dropdown update:", currentSelection);

    if (!window.payrollPeriods || window.payrollPeriods.length === 0) {
        periodSelect.innerHTML = '<option value="default">No Data</option>';
        return;
    }

    periodSelect.innerHTML = window.payrollPeriods.map(p =>
        `<option value="${p.id}">${p.label}</option>`
    ).join('');

    // If we had a selection, try to restore it
    if (currentSelection && periodSelect.querySelector(`option[value="${currentSelection}"]`)) {
        console.log("Restoring previous selection:", currentSelection);
        periodSelect.value = currentSelection;
    } else {
        // Otherwise, set to current period
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
}

async function loadData(selectedPeriodId = null) {
    // Use the selected period or current value
    const forcedPeriodId = selectedPeriodId || periodSelect.value;
    console.log("FORCED LOADING FOR PERIOD:", forcedPeriodId);

    const branchId = branchSelect.value;
    const cacheKey = getCacheKey(forcedPeriodId, branchId);

    await loadHolidays();

    console.log(`Loading data for: ${forcedPeriodId} ${branchId}`);

    // CRITICAL: Lock the period selection to prevent reverting
    if (selectedPeriodId) {
        periodSelect.value = selectedPeriodId;
    }

    const periodId = forcedPeriodId;

    // Rest of your existing loadData function...

    // At the end of the function:
    // CRITICAL: Ensure period is still selected
    if (selectedPeriodId && periodSelect.value !== selectedPeriodId) {
        console.log(`Fixing period selection back to: ${selectedPeriodId}`);
        periodSelect.value = selectedPeriodId;
    }

    // Always show instant data from cache first if available
    const cachedData = getFromCache(periodId, branchId);
    if (cachedData && validateCacheData(cacheKey, cachedData)) {
        console.log('Using valid cached data initially');
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
    } else if (cachedData) {
        console.log('Cache data invalid, invalidating cache');
        localStorage.removeItem(cacheKey);
        showLoading();
    } else {
        // No cache available, show loading indicator
        showLoading();
    }

    // Reset force refresh flag
    refreshBtn.dataset.forceRefresh = 'false';

    try {
        // First, load all employees from Firebase
        await loadAllEmployees();

        // Load sales data for bonus calculations
        const salesData = await loadSalesData();
        window.salesDataCache = salesData;
        
        // Invalidate cache if sales bonus feature wasn't included in cached data
        if (cachedData) {
            const sampleEmployee = Object.values(cachedData)[0];
            if (sampleEmployee && typeof sampleEmployee.salesBonusEligible === 'undefined') {
                console.log("Cache doesn't include sales bonus data, invalidating...");
                localStorage.removeItem(cacheKey);
                // Force a complete reload without cache
                attendanceData = {};
            }
        }

        // Get all employee IDs
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
                    baseRate: 0,
                    salesBonusEligible: false
                };
            });
        }

        // Initialize payroll periods in background if this is initial load
        if (isInitialLoad) {
            // Start payroll period initialization in the background
            setTimeout(() => {
                initializePayrollPeriods().then(() => {
                    console.log("Payroll periods initialized in background");
                }).catch(error => {
                    console.error("Error initializing payroll periods in background:", error);
                });
            }, 100);
        } else if (refreshBtn.dataset.forceRefresh === 'true') {
            // Run synchronously during manual refresh
            await initializePayrollPeriods();
        }

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
                    const oldNickname = attendanceData[employeeId].nickname || '';
                    const newNickname = employeeData.nickname || '';

                    if (oldBaseRate !== newBaseRate) {
                        attendanceData[employeeId].baseRate = newBaseRate;
                        hasChanges = true;
                    }

                    if (oldNickname !== newNickname) {
                        attendanceData[employeeId].nickname = newNickname;
                        hasChanges = true;
                    }

                    const oldSalesBonus = attendanceData[employeeId].salesBonusEligible || false;
                    const newSalesBonus = employeeData.salesBonusEligible || false;

                    if (oldSalesBonus !== newSalesBonus) {
                        attendanceData[employeeId].salesBonusEligible = newSalesBonus;
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
                    const shiftType = dateData.clockIn?.shift || "Custom";
                    const shiftSchedule = SHIFT_SCHEDULES[shiftType] || SHIFT_SCHEDULES["Custom"];

                    const newEntry = {
                        date: dateStr,
                        branch: dateData.clockIn?.branch || "N/A",
                        shift: shiftType,
                        scheduledIn: shiftSchedule.timeIn,
                        scheduledOut: shiftSchedule.timeOut,
                        timeIn: dateData.clockIn?.time || null,
                        timeOut: dateData.clockOut?.time || null,
                        timeInPhoto: dateData.clockIn?.selfie || null,
                        timeOutPhoto: dateData.clockOut?.selfie || null,
                        hasOTPay: dateData.hasOTPay || false,
                        transpoAllowance: dateData.transpoAllowance || 0
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

        // ALWAYS recalculate totals to include sales bonuses
        console.log("Recalculating all employee totals with sales bonuses");
        Object.keys(attendanceData).forEach(employeeId => {
            const employee = attendanceData[employeeId];
            if (employee.dates && employee.dates.length > 0) {
                // Recalculate total pay including sales bonuses
                const totalPayWithBonus = calculateTotalPay(employee.daysWorked, employee.baseRate || 0, employee.dates, employee);
                employee.totalPayWithBonus = totalPayWithBonus; // Store it

                // Also ensure sales bonuses are calculated for each date
                employee.dates.forEach(dateObj => {
                    if (dateObj.timeIn && dateObj.timeOut && dateObj.branch === 'SM North' && employee.salesBonusEligible) {
                        const salesBonus = calculateDailySalesBonus(dateObj.date);
                        if (dateObj.salesBonus !== salesBonus) {
                            dateObj.salesBonus = salesBonus;
                            hasChanges = true;
                        }
                    }
                });
            }
        });

        // Save updated data with bonuses
        saveToCache(cacheKey, attendanceData);
        filterData();
    } catch (error) {
        console.error("❌ Error loading data:", error);
        if (!cachedData) {
            alert("Failed to load data. Please try again.");
        }
    } finally {
        hideLoading();
    }

    if (selectedPeriodId && periodSelect.value !== selectedPeriodId) {
        console.log(`Fixing period selection back to: ${selectedPeriodId}`);
        periodSelect.value = selectedPeriodId;
    }
}

function invalidateAllCaches() {
    // Clear all attendance caches when sales data might have changed
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('attendance_')) {
            localStorage.removeItem(key);
        }
    }
    console.log("All caches invalidated due to potential sales data changes");
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

    // Render the filtered data first
    renderEmployeeTable();

    // Update summary cards after rendering (ensures sales bonuses are calculated)
    updateSummaryCards();
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
        const hasAttendance = employee.dates.some(date => date.timeIn);
        if (hasAttendance) {
            activeEmployees++;
            // Use the pre-calculated total or calculate with proper parameters
            const branchSpecificPay = employee.totalPayWithBonus ||
                calculateTotalPay(employee.daysWorked, employee.baseRate || 0, employee.dates, employee);
            totalPayrollAmount += branchSpecificPay;
        }
    });

    // Update cards
    document.getElementById('totalEmployees').textContent = totalEmployees;
    document.getElementById('activeEmployees').textContent = activeEmployees;
    document.getElementById('totalLateHours').textContent = `${holidays.regular} regular, ${holidays.special} special`; // Replace late hours with holidays
    
    const totalPayrollElement = document.getElementById('totalPayroll');
    totalPayrollElement.textContent = `₱${totalPayrollAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Check if payroll period is over and calculate unpaid amount
    const today = new Date();

    if (today > endDate) {
        // Calculate unpaid amount
        let unpaidAmount = 0;
        const periodId = period;

        // Get payment statuses (we'll need to make this synchronous for the calculation)
        loadAllPaymentConfirmations(periodId).then(paymentStatuses => {
            Object.entries(filteredData).forEach(([employeeId, employee]) => {
                const hasAttendance = employee.dates.some(date => date.timeIn);
                if (hasAttendance && !paymentStatuses[employeeId]) {
                    const branchSpecificPay = calculateTotalPay(0, employee.baseRate || 0, employee.dates, employee);
                    unpaidAmount += branchSpecificPay;
                }
            });

            // Add unpaid amount display if there's any unpaid
            if (unpaidAmount > 0) {
                const existingUnpaid = totalPayrollElement.parentNode.querySelector('.unpaid-amount');
                if (existingUnpaid) {
                    existingUnpaid.remove();
                }

                const unpaidDiv = document.createElement('div');
                unpaidDiv.className = 'unpaid-amount';
                unpaidDiv.style.cssText = `
                color: #e63946;
                font-size: 0.9rem;
                font-weight: 500;
                margin-top: 0.25rem;
            `;
                unpaidDiv.textContent = `₱${unpaidAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} unpaid`;

                totalPayrollElement.parentNode.insertBefore(unpaidDiv, totalPayrollElement.nextSibling);
            }
        });
    } else {
        // Remove any existing unpaid amount display if period is not over
        const existingUnpaid = totalPayrollElement.parentNode.querySelector('.unpaid-amount');
        if (existingUnpaid) {
            existingUnpaid.remove();
        }
    }

    // Update the late hours label to say "Holidays"
    // const lateHoursLabel = document.querySelector('label[for="totalLateHours"]');
    // if (lateHoursLabel) {
    //     lateHoursLabel.textContent = "Holidays";
    // }

    const holidaysList = [];
    for (const dateStr in HOLIDAYS_2025) {
        const holiday = HOLIDAYS_2025[dateStr];
        const holidayDate = new Date(dateStr + 'T00:00:00');
        const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

        if (holidayDate >= startDateOnly && holidayDate <= endDateOnly) {
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

    const holidaysCard = holidayDisplay.closest('.summary-card');

    // Make the holidays card clickable
    if (!holidaysCard.classList.contains('holidays-summary-card')) {
        holidaysCard.classList.add('holidays-summary-card');
        holidaysCard.addEventListener('click', openHolidaysModal);
    }
}

function createEmployeeSpecificSummaryCards(employeeId) {
    const employee = filteredData[employeeId];
    if (!employee) return;

    // Check if employee is sales bonus eligible
    const showSalesBonus = employee.salesBonusEligible;

    // Create new summary card HTML
    const summaryCardsHTML = `
        <div class="summary-cards employee-view-cards">
            <div class="summary-card">
                <div class="card-title">Employee ID</div>
                <div class="card-value">${employeeId}</div>
                <div class="card-subtitle">Staff ID</div>
            </div>
            <div class="summary-card">
                <div class="card-title">Base Rate</div>
                <div class="card-value">₱${(employee.baseRate || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="card-subtitle">Per day</div>
            </div>
            <div class="summary-card">
                <div class="card-title">Days Worked</div>
                <div class="card-value">${employee.daysWorked}</div>
                <div class="card-subtitle">This period</div>
            </div>
            <div class="summary-card">
                <div class="card-title">Average Lateness</div>
                <div class="card-value">${employee.daysWorked > 0 ? (employee.lateHours / employee.daysWorked * 60).toFixed(1) : '0.0'}</div>
                <div class="card-subtitle">Minutes per day</div>
            </div>
            <div class="summary-card">
                <div class="card-title">Total Pay</div>
                <div class="card-value">₱${(employee.totalPayWithBonus || calculateTotalPay(0, employee.baseRate || 0, employee.dates, employee)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="card-subtitle">For this period</div>
            </div>
            ${showSalesBonus ? `
            <div class="summary-card">
                <div class="card-title">Sales Bonus</div>
                <div class="card-value">₱${calculateEmployeeSalesBonus(employee).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="card-subtitle">Total earned</div>
            </div>
            ` : ''}
        </div>
    `;

    return summaryCardsHTML;
}

function validateCacheData(cacheKey, data) {
    // Check if cache includes sales bonus calculations
    const sampleEmployee = Object.values(data)[0];
    if (!sampleEmployee) return false;

    // Check if sales bonus data is properly included
    if (sampleEmployee.salesBonusEligible !== undefined) {
        // Check if sales bonuses are calculated for dates
        const hasValidSalesData = sampleEmployee.dates.some(date =>
            date.salesBonus !== undefined || !sampleEmployee.salesBonusEligible
        );
        return hasValidSalesData;
    }

    return false;
}

function renderEmployeeTable() {
    // Clear the table body first
    employeeTableBody.innerHTML = '';

    let filteredEmployees;

    if (activeOnlyToggle.checked) {
        // If checked, only show employees with clock-in records
        filteredEmployees = Object.entries(filteredData).filter(([_, employee]) =>
            employee.dates && employee.dates.some(date => date.timeIn)
        );
    } else {
        // If unchecked, show ALL employees
        const allEmployees = {};

        // First add all employees from filteredData
        Object.entries(filteredData).forEach(([id, data]) => {
            allEmployees[id] = data;
        });

        // Then add any missing employees from the main employees object
        Object.keys(employees).forEach(id => {
            if (!allEmployees[id]) {
                allEmployees[id] = {
                    id: id,
                    name: employees[id],
                    dates: [],
                    daysWorked: 0,
                    lateHours: 0,
                    baseRate: 0,
                    salesBonusEligible: false
                };
            }
        });

        filteredEmployees = Object.entries(allEmployees);
    }

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

        // Check if we're after payroll period end
        const period = periodSelect.value;
        const { endDate } = getPeriodDates(period);
        const today = new Date();
        const showPaymentButton = today > endDate;

        const paymentButtonHtml = showPaymentButton ? `
        <button class="action-btn payment-btn" data-employee-id="${employeeId}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
            </svg>
            Pay
        </button>
        ` : '';

        row.innerHTML = `
        <td>
            <span class="employee-name">${employee.name || employees[employeeId] || 'Unknown Employee'}</span>
        </td>
        <td>${daysWorked}</td>
        <td class="${getLatnessColorClass(daysWorked > 0 ? (lateHours / daysWorked * 60) : 0)}">${daysWorked > 0 ? (lateHours / daysWorked * 60).toFixed(1) : '0.0'}</td>
        <td class="base-rate">₱${(employee.baseRate || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td>₱${calculateTotalPay(employee.daysWorked, employee.baseRate || 0, employee.dates, employee).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="time-cell">
            ${employee.lastClockInPhoto ?
                        `<img src="${employee.lastClockInPhoto}" class="thumb" data-photo="${employee.lastClockInPhoto}" alt="Last clock-in photo">` :
                        ``}
            <span class="date-readable">${lastClockIn}</span>
        </td>
        <td class="action-cell">
                <div class="action-buttons-container">
                    <button class="action-btn open-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M9 18l6-6-6-6"></path>
                        </svg>
                        Open
                    </button>
                    <button class="action-btn edit-employee-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        Edit
                    </button>
                    ${paymentButtonHtml}
                </div>
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


    // Add event listeners for row clicks to expand details
    document.querySelectorAll('.expandable-row').forEach(row => {
        row.addEventListener('click', function (e) {
            // Don't expand if clicking on a button
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                return;
            }

            const employeeId = this.dataset.employeeId;
            const detailRow = document.querySelector(`.detail-row[data-employee-id="${employeeId}"]`);

            // Load details on demand
            if (detailRow.dataset.loaded === 'false') {
                loadEmployeeDetails(employeeId, detailRow);
            }

            this.classList.toggle('expanded');
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

    // Add event listeners for payment buttons
    document.querySelectorAll('.payment-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const employeeId = this.dataset.employeeId;
            openPaymentModal(employeeId);
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

    setTimeout(updateEmployeePaymentStatus, 500);
}

async function loadAllPaymentConfirmations(periodId) {
    const cacheKey = `payment_confirmations_${periodId}`;

    // Try cache first
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        const parsedCache = JSON.parse(cached);
        const cacheAge = Date.now() - (parsedCache.timestamp || 0);
        if (cacheAge < 5 * 60 * 1000) { // 5 minute cache
            return parsedCache.data;
        }
    }

    if (!navigator.onLine) {
        return cached ? JSON.parse(cached).data : {};
    }

    try {
        // Get all payment confirmations for this period in one query
        const paymentsRef = collection(db, "payment_confirmations");
        const snapshot = await getDocs(paymentsRef);

        const paymentStatus = {};
        snapshot.forEach(doc => {
            const docId = doc.id;
            // Check if this payment is for the current period
            if (docId.endsWith(`_${periodId}`)) {
                const employeeId = docId.replace(`_${periodId}`, '');
                paymentStatus[employeeId] = true;
            }
        });

        // Cache the results
        localStorage.setItem(cacheKey, JSON.stringify({
            data: paymentStatus,
            timestamp: Date.now()
        }));

        return paymentStatus;
    } catch (error) {
        console.error("Error loading payment confirmations:", error);
        return cached ? JSON.parse(cached).data : {};
    }
}

// Replace the updateEmployeePaymentStatus function with this:
async function updateEmployeePaymentStatus() {
    const periodId = periodSelect.value;

    // Check if we're after the payroll period end
    const { endDate } = getPeriodDates(periodId);
    const today = new Date();

    // Only show payment status if we're past the period end date
    if (today <= endDate) {
        // Remove any existing indicators since we're still in the period
        const existingIndicators = document.querySelectorAll('.payment-status-indicator');
        existingIndicators.forEach(indicator => indicator.remove());
        return;
    }

    const employeeRows = document.querySelectorAll('.expandable-row');

    // Get all payment statuses at once
    const paymentStatuses = await loadAllPaymentConfirmations(periodId);

    // Update all rows instantly
    employeeRows.forEach(row => {
        const employeeId = row.dataset.employeeId;
        if (!employeeId) return;

        // Remove existing payment indicators
        const existingIndicator = row.querySelector('.payment-status-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }

        const indicator = document.createElement('span');
        indicator.className = 'payment-status-indicator';

        if (paymentStatuses[employeeId]) {
            // Add payment indicator
            indicator.innerHTML = '💸 Paid';
            indicator.style.cssText = `
                color: #2b9348;
                font-size: 0.8rem;
                font-weight: 600;
                margin-left: 0.5rem;
                background: rgba(43, 147, 72, 0.1);
                padding: 2px 6px;
                border-radius: 12px;
            `;
        } else {
            // Add not paid indicator
            indicator.innerHTML = '⏳ Not yet paid';
            indicator.style.cssText = `
                color: #e63946;
                font-size: 0.8rem;
                font-weight: 600;
                margin-left: 0.5rem;
                background: rgba(230, 57, 70, 0.1);
                padding: 2px 6px;
                border-radius: 12px;
            `;
        }

        const employeeName = row.querySelector('.employee-name');
        if (employeeName) {
            employeeName.appendChild(indicator);
        }
    });
}

function getLatnessColorClass(avgLateness) {
    if (avgLateness >= 30) return 'late-high';
    if (avgLateness >= 15) return 'late-medium';
    if (avgLateness > 0) return 'late-low';
    return '';
}

async function uploadHolidaysToFirebase() {
    try {
        await setDoc(doc(db, "settings", "holidays_2025"), HOLIDAYS_2025);
        console.log("Holidays uploaded to Firebase");
    } catch (error) {
        console.error("Error uploading holidays:", error);
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

function calculateTotalPay(daysWorked, baseRate, datesWorked = [], employee = null) {
    const dailyMealAllowance = 150;
    let totalPay = 0;

    if (!datesWorked || datesWorked.length === 0) {
        // Fallback calculation if no dates provided
        return (baseRate * daysWorked) + (dailyMealAllowance * daysWorked);
    }

    // Calculate using actual date entries for accurate results
    datesWorked.forEach(dateObj => {
        if (dateObj.timeIn && dateObj.timeOut) {
            totalPay += calculateDailyPay(dateObj, baseRate, employee);
        }
    });

    return totalPay;
}

function calculateDailyPay(dateObj, baseRate, employee = null) {
    const dailyMealAllowance = 150;

    if (!dateObj.timeIn || !dateObj.timeOut) {
        return 0;
    }

    const dateStr = dateObj.date;
    const multiplier = getHolidayPayMultiplier(dateStr);
    let dailyTotalPay = 0;

    if (dateObj.shift === "Custom") {
        const actualHours = calculateHours(dateObj.timeIn, dateObj.timeOut);
        if (!actualHours) return 0;

        const hourlyRate = baseRate / 8;
        const workHours = actualHours > 4 ? actualHours - 1 : actualHours;
        const mealAllowance = actualHours <= 4 ? dailyMealAllowance / 2 : dailyMealAllowance;

        // Calculate base pay (up to 8 hours)
        const regularHours = Math.min(workHours, 8);
        const basePay = hourlyRate * regularHours * multiplier;

        dailyTotalPay = basePay + mealAllowance;

        // Add OT pay for Custom shifts if hasOTPay is true
        if (dateObj.hasOTPay) {
            const otCalculation = calculateOTPay(dateObj, baseRate);
            dailyTotalPay += otCalculation.otPay;
        }
    } else {
        // Regular shifts: fixed daily rate with deductions and potential OT
        const isHalfDay = dateObj.shift === "Closing Half-Day" || dateObj.shift === "Opening Half-Day";
        const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
        const mealAllowance = isHalfDay ? dailyMealAllowance / 2 : dailyMealAllowance;

        // Calculate deductions for being late/leaving early
        const deductionHours = calculateDeductions(dateObj.timeIn, dateObj.timeOut, dateObj.scheduledIn, dateObj.scheduledOut);
        const standardHours = isHalfDay ? 4 : 8;
        const hourlyRate = dailyRate / standardHours;
        const deductionAmount = deductionHours * hourlyRate;

        dailyTotalPay = (dailyRate * multiplier) + mealAllowance - deductionAmount;

        // Add OT pay only for regular shifts (if they have hasOTPay flag)
        const otCalculation = calculateOTPay(dateObj, baseRate);
        if (otCalculation.otPay > 0) {
            dailyTotalPay += otCalculation.otPay;
            dateObj.calculatedOTPay = otCalculation.otPay;
            dateObj.calculatedOTHours = otCalculation.otHours;
        }
    }

    // Add transportation allowance (applies to all shifts)
    if (dateObj.transpoAllowance) {
        dailyTotalPay += dateObj.transpoAllowance;
    }

    // Add sales bonus (applies to all shifts at SM North)
    if (dateObj.branch === 'SM North' && employee && employee.salesBonusEligible) {
        const salesBonus = calculateDailySalesBonus(dateObj.date);
        dailyTotalPay += salesBonus;

        if (dateObj.salesBonus !== salesBonus) {
            dateObj.salesBonus = salesBonus;
            const docRef = doc(db, "attendance", employee.id, "dates", dateObj.date);
            setDoc(docRef, { salesBonus }, { merge: true }).catch(error => {
                console.error(`Failed to save sales bonus for ${employee.id} on ${dateObj.date}:`, error);
            });
        }
    }

    return dailyTotalPay;
}

function calculateDailySalesBonus(dateStr, salesDataMap = null) {
    if (!salesDataMap && !window.salesDataCache) return 0;

    const salesData = salesDataMap || window.salesDataCache;
    const dayData = salesData[dateStr];

    if (!dayData) return 0;

    const date = new Date(dateStr);
    const staffingLevel = getStaffingLevel(date);
    const quota = getQuotaForStaffing(staffingLevel);

    // Calculate total sales for the day
    const totalSales = dayData.totalSales ||
        ((dayData.cash || 0) + (dayData.gcash || 0) + (dayData.maya || 0) +
            (dayData.card || 0) + (dayData.grab || 0));

    return calculateSalesBonus(totalSales, quota);
}

function calculateOTPay(dateEntry, baseRate) {
    if (!dateEntry.hasOTPay || !dateEntry.timeIn || !dateEntry.timeOut) {
        return { otPay: 0, otHours: 0 };
    }

    const actualHours = calculateHours(dateEntry.timeIn, dateEntry.timeOut);
    if (!actualHours || actualHours <= 0) return { otPay: 0, otHours: 0 };

    // Calculate work hours (subtract break time if > 4 hours)
    let workHours = actualHours;
    if (actualHours > 4) {
        workHours = actualHours - 1; // Subtract 1 hour for break
    }

    // Ensure we don't have negative work hours
    workHours = Math.max(0, workHours);

    // OT hours are any hours beyond 8
    const otHours = Math.max(0, workHours - 8);

    if (otHours === 0) {
        return { otPay: 0, otHours: 0 };
    }

    // Calculate OT pay based on holiday status
    const dateStr = dateEntry.date;
    const hourlyRate = baseRate / 8; // Base rate is for 8 hours
    let otRate;

    if (HOLIDAYS_2025[dateStr]) {
        const holiday = HOLIDAYS_2025[dateStr];
        if (holiday.type === 'regular') {
            // Regular holiday OT: 260% of hourly rate (160% premium)
            otRate = hourlyRate * 2.60;
        } else if (holiday.type === 'special') {
            // Special holiday OT: 169% of hourly rate (69% premium)
            otRate = hourlyRate * 1.69;
        }
    } else {
        // Regular day OT: 125% of hourly rate (25% premium)
        otRate = hourlyRate * 1.25;
    }

    const otPay = otHours * otRate;
    return { otPay, otHours };
}

function calculateEmployeeSalesBonus(employee) {
    if (!employee.salesBonusEligible) return 0;

    let totalBonus = 0;

    employee.dates.forEach(dateObj => {
        if (dateObj.timeIn && dateObj.timeOut && dateObj.branch === 'SM North') {
            totalBonus += calculateDailySalesBonus(dateObj.date);
        }
    });

    return totalBonus;
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

        // console.log("Period range:", formatDate(startDate), "to", formatDate(endDate));

        const dates = [];
        const attendanceRef = collection(db, "attendance", employeeId, "dates");

        // Only fetch dates within the period range
        const querySnapshot = await getDocs(query(
            attendanceRef.withConverter(null),
            where("__name__", ">=", formattedStartDate),
            where("__name__", "<=", formattedEndDate)
        ));

        querySnapshot.forEach(doc => {
            const dateData = doc.data();
            const dateStr = doc.id;

            // Add this inside your querySnapshot.forEach loop
            console.log(`Checking date: ${dateStr}`);
            console.log(`Date comparison: ${dateStr} >= ${formatDate(startDate)} && ${dateStr} <= ${formatDate(endDate)}`);
            // console.log(`JavaScript comparison result:`, dateObjNoTime >= startDateNoTime && dateObjNoTime <= endDateNoTime);

            // Check if the date is actually in the period range
            const dateObj = new Date(dateStr);
            const dateObjNoTime = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
            const startDateNoTime = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endDateNoTime = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            
            // Only proceed if date is in range
            if (dateObjNoTime >= startDateNoTime && dateObjNoTime <= endDateNoTime) {
                // Add branch filter condition
                const branchName = dateData.clockIn?.branch || "N/A";
                const branchMatches = branch === 'all' || branchName === getBranchName(branch);

                if (branchMatches) {
                    const shiftType = dateData.clockIn?.shift || "Custom";
                    const shiftSchedule = SHIFT_SCHEDULES[shiftType] || SHIFT_SCHEDULES["Custom"];

                    dates.push({
                        date: dateStr,
                        branch: branchName,
                        shift: shiftType,
                        scheduledIn: shiftSchedule.timeIn,
                        scheduledOut: shiftSchedule.timeOut,
                        timeIn: dateData.clockIn?.time || null,
                        timeOut: dateData.clockOut?.time || null,
                        timeInPhoto: dateData.clockIn?.selfie || null,
                        timeOutPhoto: dateData.clockOut?.selfie || null,
                        hasOTPay: dateData.hasOTPay || false,
                        transpoAllowance: dateData.transpoAllowance || 0
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
            }
        });

        // Create detail table
        const detailTable = document.createElement('table');
        detailTable.className = 'detail-table';

        const employeeData = filteredData[employeeId];
        const showSalesBonus = employeeData && employeeData.salesBonusEligible;

        detailTable.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Branch</th>
                    <th>Shift</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Late Hours</th>
                    ${showSalesBonus ? '<th>Sales Bonus</th>' : ''}
                    <th>Total Pay</th>
                    <th>Action</th>
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
            const employeeData = filteredData[employeeId];
            const dailySalesBonus = (date.timeIn && date.timeOut && date.branch === 'SM North' && employeeData.salesBonusEligible) ?
                calculateDailySalesBonus(date.date) : 0;

            detailRowItem.innerHTML = `
            <td class="date-cell">
                <span class="date-day">${formatReadableDate(date.date)}</span>
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
            <td>${date.scheduledIn && date.timeIn ?
                                (compareTimes(date.timeIn, date.scheduledIn) > 0 ?
                                    (compareTimes(date.timeIn, date.scheduledIn) / 60).toFixed(1) :
                                    '0.0') :
                                'N/A'}
            </td>
            ${showSalesBonus ? `<td>₱${dailySalesBonus.toFixed(2)}</td>` : ''}
            <td>₱${date.timeIn && date.timeOut ?
                                calculateDailyPay(date, employeeData.baseRate || 0, employeeData).toFixed(2) :
                                '0.00'}</td>
            <td class="action-cell">
                <div class="action-buttons-container">
                    <button class="action-btn open-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M9 18l6-6-6-6"></path>
                        </svg>
                        Open
                    </button>
                    <button class="action-btn edit-employee-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        Edit
                    </button>
                </div>
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

        detailRow.querySelectorAll('.edit-shift-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                openEditShiftModal(employeeId, dateStr);
            });
        });

        document.querySelectorAll('.payment-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const row = this.closest('.expandable-row');
                const employeeId = row.dataset.employeeId;
                openPaymentModal(employeeId);
            });
        });

    } catch (error) {
        console.error("Error loading employee details:", error);
        detailRow.querySelector('.detail-content').innerHTML = '<div class="error-message">Failed to load details. Please try again.</div>';
    }
}

function guessShift(timeIn, timeOut) {
    if (!timeIn || !timeOut) return "Custom";

    // Convert times to minutes since midnight for easier comparison
    const [inTime, inMeridian] = timeIn.split(' ');
    const [inHours, inMinutes] = inTime.split(':').map(Number);
    const inTotalMinutes = (inMeridian === 'PM' && inHours !== 12 ? inHours + 12 : inHours % 12) * 60 + inMinutes;

    // Define shift start times in minutes
    const shifts = [
        { name: "Opening", start: 9 * 60 + 30 },      // 9:30 AM
        { name: "Midshift", start: 11 * 60 },         // 11:00 AM  
        { name: "Closing", start: 13 * 60 },          // 1:00 PM
        { name: "Closing Half-Day", start: 18 * 60 }  // 6:00 PM
    ];

    // Find the closest shift
    let closestShift = "Custom";
    let smallestDiff = Infinity;

    shifts.forEach(shift => {
        const diff = Math.abs(inTotalMinutes - shift.start);
        if (diff < smallestDiff) {
            smallestDiff = diff;
            closestShift = shift.name;
        }
    });

    // Only return the shift if it's within 60 minutes (reasonable tolerance)
    return smallestDiff <= 60 ? closestShift : "Custom";
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
    const shifts = ["Opening", "Midshift", "Closing", "Closing Half-Day"];
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
    // Use local timezone date components instead of UTC
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatReadableDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
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

    // Find the period with matching ID
    const found = window.payrollPeriods.find(p => p.id === periodId);

    if (!found) {
        console.warn(`Period ${periodId} not found, using first available period`);
        // Fallback to the first period if not found
        const fallback = window.payrollPeriods[0];
        return {
            startDate: fallback.start,
            endDate: fallback.end
        };
    }

    const result = {
        startDate: found.start,
        endDate: found.end
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

        // Calculate difference in minutes
        const totalMinutesIn = hours24In * 60 + minutesIn;
        const totalMinutesOut = hours24Out * 60 + minutesOut;

        let minutesDiff = totalMinutesOut - totalMinutesIn;

        // Handle midnight crossover
        if (minutesDiff < 0) {
            // For your specific case: 12:38 PM to 2:00 AM
            // This is clearly a next-day scenario
            minutesDiff += 24 * 60;
        }

        // Prevent unreasonably long shifts (over 20 hours)
        const calculatedHours = minutesDiff / 60;
        if (calculatedHours > 20) {
            console.warn("Shift duration exceeds 20 hours - possible data error");
            return null;
        }

        return calculatedHours;
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

function generatePayrollPeriods(startDate, endDate, limitCount = false) {
    // If startDate and endDate are not provided, generate default periods
    const isDefault = !startDate || !endDate;
    const periods = [];

    // Start from today's date
    const today = new Date();

    // If we're generating from existing data, use exact startDate
    let minDate;
    if (!isDefault) {
        // Use the exact start date without going back additional months
        minDate = new Date(startDate);

        // Round to the beginning of the period containing this date
        if (minDate.getDate() <= 12) {
            // If date is 1-12, it's in the second half of previous period
            // So round back to the 28th/29th of previous month
            minDate.setDate(1); // First set to first of current month
            minDate.setMonth(minDate.getMonth() - 1); // Go to previous month

            // Get the starting date (28th or 29th depending on month)
            const daysInPrevMonth = new Date(minDate.getFullYear(), minDate.getMonth() + 1, 0).getDate();
            const startDay = daysInPrevMonth === 31 ? 29 : 28;
            minDate.setDate(startDay);
        } else if (minDate.getDate() <= 27) {
            // If date is 13-27, it's in the first half of current period
            // So round back to the 13th
            minDate.setDate(13);
        } else {
            // If date is 28-31, it's in the second half of current period
            // Stay on current month, round to 28th/29th
            const daysInMonth = new Date(minDate.getFullYear(), minDate.getMonth() + 1, 0).getDate();
            const startDay = daysInMonth === 31 ? 29 : 28;
            minDate.setDate(startDay);
        }
    } else {
        // For default, we'll just go back enough for 3 periods
        minDate = new Date(today);
        minDate.setMonth(minDate.getMonth() - 2);
    }

    // Find the current period end date
    let currentPeriodEnd = new Date();

    // If today is after 27th, the current period ends on the 12th of next month
    if (today.getDate() > 27) {
        currentPeriodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 12);
    }
    // If today is after 12th but before or on 27th, current period ends on the 27th
    else if (today.getDate() > 12) {
        currentPeriodEnd = new Date(today.getFullYear(), today.getMonth(), 27);
    }
    // If today is before or on 12th, current period ends on the 12th
    else {
        currentPeriodEnd = new Date(today.getFullYear(), today.getMonth(), 12);
    }

    // Generate periods going backward
    let periodEnd = new Date(currentPeriodEnd);
    let count = 0;

    while ((!isDefault || count < 3) && (isDefault || periodEnd >= minDate)) {
        let periodStart;

        // If period ends on 12th, it starts on 28th or 29th of previous month
        if (periodEnd.getDate() === 12) {
            const prevMonth = periodEnd.getMonth() === 0 ? 11 : periodEnd.getMonth() - 1;
            const prevYear = periodEnd.getMonth() === 0 ? periodEnd.getFullYear() - 1 : periodEnd.getFullYear();
            const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();

            // Starting day depends on days in previous month
            const startDay = daysInPrevMonth === 31 ? 29 : 28;
            periodStart = new Date(prevYear, prevMonth, startDay);

            // STOP if this would go before our oldest data
            if (periodStart < minDate) break;

        }
        // If period ends on 27th, it starts on the 13th of same month
        else {
            periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 13);

            // STOP if this would go before our oldest data
            if (periodStart < minDate) break;
        }

        // Add all periods including the current one (even if it hasn't ended yet)
        periods.push({
            id: `${formatDate(periodStart)}_${formatDate(periodEnd)}`,
            start: periodStart,
            end: periodEnd,
            label: `${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        });
        count++;

        // For default mode, stop after 3 periods
        if (isDefault && count >= 3) break;

        // For non-default, can continue unless limitCount is true
        if (!isDefault && limitCount && count >= 3) break;

        // Move to the previous period
        periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() - 1);

        // Safety check - limit total number of periods to prevent infinite loop
        if (count > 50) break;
    }

    // Sort periods with most recent first
    return periods.sort((a, b) => b.start - a.start);
}

function updateViewMode() {
    const container = document.querySelector('.container');

    // Get the table container and employee table elements
    const tableContainer = document.querySelector('.data-table-container');
    const employeeTable = document.getElementById('employeeTable');

    if (currentEmployeeView) {
        // Single employee view - restructure the page
        const employeeName = employees[currentEmployeeView] || 'Employee';
        const employee = filteredData[currentEmployeeView];

        // Remove any existing employee heading first
        const existingHeading = document.getElementById('employee-view-heading');
        if (existingHeading) {
            existingHeading.remove();
        }

        const employeeNameHeading = document.createElement('h2');
        employeeNameHeading.id = 'employee-view-heading';
        employeeNameHeading.className = 'employee-view-heading';
        employeeNameHeading.textContent = employees[currentEmployeeView] || 'Employee';

        // 1. Update page title
        // document.querySelector('.app-title').textContent = `${employeeName} - Attendance`;

        // Make logo/title clickable in employee view
        const logoSection = document.querySelector('.logo-section');
        logoSection.style.cursor = 'pointer';
        logoSection.addEventListener('click', function () {
            // Just reload the page - that's the simplest fix
            window.location.reload();
        });

        // Create edit button for single employee view
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn';
        editBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Edit Employee
        `;
                editBtn.addEventListener('click', function () {
                    openEditEmployeeModal(currentEmployeeView);
                });

                // Create batch edit button for single employee view
                const batchEditBtn = document.createElement('button');
                batchEditBtn.className = 'edit-btn';
                batchEditBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
            Batch Edit Period
        `;
        batchEditBtn.addEventListener('click', function () {
            openBatchEditModal(currentEmployeeView);
        });

        // Create add shift button for single employee view
        const addShiftBtn = document.createElement('button');
        addShiftBtn.className = 'edit-btn';
        addShiftBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14"></path>
                <path d="M5 12h14"></path>
            </svg>
            Add Shift
        `;
        addShiftBtn.addEventListener('click', function () {
            openAddShiftModal(currentEmployeeView);
        });

        // Hide the main view buttons in employee view
        document.getElementById('addEmployeeBtn').style.display = 'none';
        document.querySelector('.push-holidays-btn').style.display = 'none';

        const paymentBtn = document.createElement('button');
        paymentBtn.className = 'edit-btn payment-period-btn';
        paymentBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
            </svg>
            Upload Payment Confirmation
        `;
        paymentBtn.addEventListener('click', function () {
            openPaymentModal(currentEmployeeView);
        });

        // Add the employee name heading first
        const summaryCards = document.querySelector('.summary-cards');
        container.insertBefore(employeeNameHeading, summaryCards);

        // Add buttons after the heading
        employeeNameHeading.insertAdjacentElement('afterend', editBtn);
        employeeNameHeading.insertAdjacentElement('afterend', batchEditBtn);
        employeeNameHeading.insertAdjacentElement('afterend', addShiftBtn);
        employeeNameHeading.insertAdjacentElement('afterend', paymentBtn);

        // 3. Update summary cards with employee-specific info
        if (employee) {
            // Hide the standard summary cards
            document.querySelector('.summary-cards').style.display = 'none';

            // Create employee-specific cards
            const employeeCards = createEmployeeSpecificSummaryCards(currentEmployeeView);
            if (employeeCards) {
                // Check if we already created employee cards
                let existingCards = document.querySelector('.employee-view-cards');
                if (existingCards) {
                    existingCards.outerHTML = employeeCards;
                } else {
                    // Insert after the employee name heading
                    employeeNameHeading.insertAdjacentHTML('afterend', employeeCards);
                }
            }

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
        // document.querySelector('.app-title').textContent = 'Admin Dashboard';
        // Remove employee heading
        const employeeHeading = document.getElementById('employee-view-heading');
        if (employeeHeading) {
            employeeHeading.remove();
        }

        // Remove all edit and batch edit buttons
        const editBtns = document.querySelectorAll('.edit-btn');
        editBtns.forEach(btn => btn.remove());

        // Show the original table
        employeeTable.style.display = 'table';

        // Remove any employee details table
        const detailsTable = document.getElementById('employee-details-table');
        if (detailsTable) {
            detailsTable.remove();
        }
        
        // Remove any employee-specific cards first
        const employeeCards = document.querySelector('.employee-view-cards');
        if (employeeCards) {
            employeeCards.remove();
        }

        // Show the original summary cards
        const originalCards = document.querySelector('.summary-cards');
        if (originalCards) {
            originalCards.style.display = 'grid';
        }

        // Show the main view buttons
        document.getElementById('addEmployeeBtn').style.display = 'flex';
        document.querySelector('.push-holidays-btn').style.display = 'none'; // Keep hidden

        // Remove click handler from logo in main view
        const logoSection = document.querySelector('.logo-section');
        logoSection.style.cursor = 'default';
        logoSection.removeEventListener('click', arguments.callee);

        // // Reset the card titles and subtitles to original values
        // const totalEmpCard = document.getElementById('totalEmployees');
        // const totalEmpLabel = totalEmpCard.closest('.summary-card').querySelector('.card-title');
        // const totalEmpSubtitle = totalEmpCard.closest('.summary-card').querySelector('.card-subtitle');

        // totalEmpLabel.textContent = "Total Employees";
        // totalEmpSubtitle.textContent = "All staff";

        // const activeEmpCard = document.getElementById('activeEmployees');
        // const activeEmpLabel = activeEmpCard.closest('.summary-card').querySelector('.card-title');
        // const activeEmpSubtitle = activeEmpCard.closest('.summary-card').querySelector('.card-subtitle');

        // activeEmpLabel.textContent = "Active Employees";
        // activeEmpSubtitle.textContent = "For this period";

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

        console.log("Period range:", formatDate(startDate), "to", formatDate(endDate));

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

            // Check if the date is actually in the period range
            const dateObj = new Date(dateStr);
            const dateObjNoTime = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
            const startDateNoTime = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endDateNoTime = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

            // Only proceed if date is in range
            if (dateObjNoTime >= startDateNoTime && dateObjNoTime <= endDateNoTime) {
                // Add branch filter condition
                const branchName = dateData.clockIn?.branch || "N/A";
                const branchMatches = branch === 'all' || branchName === getBranchName(branch);

                if (branchMatches) {
                // Now we load the full data including photos
                const shiftType = dateData.clockIn?.shift || "Custom";
                const shiftSchedule = SHIFT_SCHEDULES[shiftType] || SHIFT_SCHEDULES["Custom"];

                dates.push({
                    date: dateStr,
                    branch: branchName,
                    shift: shiftType,
                    scheduledIn: shiftSchedule.timeIn,
                    scheduledOut: shiftSchedule.timeOut,
                    timeIn: dateData.clockIn?.time || null,
                    timeOut: dateData.clockOut?.time || null,
                    timeInPhoto: dateData.clockIn?.selfie || null,
                    timeOutPhoto: dateData.clockOut?.selfie || null,
                    hasOTPay: dateData.hasOTPay || false,
                    transpoAllowance: dateData.transpoAllowance || 0
                });
                }
            }
        });

        // Create the employee details table
        const detailTable = document.createElement('table');
        detailTable.className = 'data-table';
        detailTable.id = 'employeeDetailTable';

        // Get employee data to check sales bonus eligibility
        const employeeData = filteredData[employeeId];
        const showSalesBonus = employeeData && employeeData.salesBonusEligible;

        detailTable.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Branch</th>
                    <th>Shift</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Late Hours</th>
                    ${showSalesBonus ? '<th>Sales Bonus</th>' : ''}
                    <th>Total Pay</th>
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
            const employeeData = filteredData[employeeId];
            const dailySalesBonus = (date.timeIn && date.timeOut && date.branch === 'SM North' && employeeData.salesBonusEligible) ?
                calculateDailySalesBonus(date.date) : 0;

            detailRowItem.className = 'expandable-row';
            detailRowItem.dataset.employeeId = employeeId;
            detailRowItem.dataset.date = date.date;

            // Replace the detailRowItem.innerHTML section with:
            detailRowItem.innerHTML = `
            <td class="date-cell">
                <span class="date-day">${formatReadableDate(date.date)}</span>
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
            <td>${date.scheduledIn && date.timeIn ?
                                (compareTimes(date.timeIn, date.scheduledIn) > 0 ?
                                    (compareTimes(date.timeIn, date.scheduledIn) / 60).toFixed(1) :
                                    '0.0') :
                                'N/A'}
            </td>
            ${showSalesBonus ? `<td>₱${dailySalesBonus.toFixed(2)}</td>` : ''}
            <td>₱${date.timeIn && date.timeOut ?
                    calculateDailyPay(date, employeeData.baseRate || 0, employeeData).toFixed(2) :
                    '0.00'}</td>
            <td class="action-cell">
                    <div class="action-buttons-container">
                        <button class="action-btn edit-shift-btn" data-date="${date.date}" data-employee="${employeeId}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        Edit
                        </button>
                        <button class="action-btn delete-entry-btn" data-date="${date.date}" data-employee="${employeeId}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" preserveAspectRatio="none">
                        <path d="M3 6h18"></path>
                        <path d="m19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                        <path d="m8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                        <line x1="10" x2="10" y1="11" y2="17"></line>
                        <line x1="14" x2="14" y1="11" y2="17"></line>
                    </svg>
                    Delete
                </button>
                    </div>
                </td>
            `;

            detailTableBody.appendChild(detailRowItem);

            // Create detail row for breakdown
            const breakdownRow = document.createElement('tr');
            breakdownRow.className = 'detail-row';
            breakdownRow.dataset.employeeId = employeeId;
            breakdownRow.dataset.date = date.date;
            breakdownRow.dataset.loaded = 'false';

            const breakdownContent = document.createElement('td');
            breakdownContent.colSpan = showSalesBonus ? 9 : 8;
            breakdownContent.className = 'detail-content';
            breakdownContent.innerHTML = '<div class="loading-placeholder">Click row to load pay breakdown</div>';

            breakdownRow.appendChild(breakdownContent);
            detailTableBody.appendChild(breakdownRow);
        });

        // Add event listeners for expandable rows
        detailTable.querySelectorAll('.expandable-row').forEach(row => {
            row.addEventListener('click', function (e) {
                // Don't expand if clicking on a button
                if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                    return;
                }

                const employeeId = this.dataset.employeeId;
                const dateStr = this.dataset.date;
                const detailRow = detailTable.querySelector(`.detail-row[data-employee-id="${employeeId}"][data-date="${dateStr}"]`);

                // Load breakdown on demand
                if (detailRow.dataset.loaded === 'false') {
                    loadPayBreakdown(employeeId, dateStr, detailRow);
                }

                this.classList.toggle('expanded');
                detailRow.classList.toggle('expanded');
            });
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

        // Add event listeners for edit shift buttons
        container.querySelectorAll('.edit-shift-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                openEditShiftModal(employeeId, dateStr);
            });
        });

    } catch (error) {
        console.error("Error loading employee details:", error);
        container.innerHTML = '<div class="error-message">Failed to load details. Please try again.</div>';
    }
}

function loadPayBreakdown(employeeId, dateStr, detailRow) {
    const employee = filteredData[employeeId];
    const dateEntry = employee.dates.find(d => d.date === dateStr);

    if (!dateEntry || !dateEntry.timeIn || !dateEntry.timeOut) {
        detailRow.querySelector('.detail-content').innerHTML = '<div class="no-data">No attendance data for breakdown</div>';
        detailRow.dataset.loaded = 'true';
        return;
    }

    // Use the SAME calculateDailyPay function - single source of truth
    const totalPay = calculateDailyPay(dateEntry, employee.baseRate || 0, employee);

    // Get all the components for display purposes only
    const date = new Date(dateStr);
    const isHalfDay = dateEntry.shift === "Closing Half-Day" || dateEntry.shift === "Opening Half-Day";
    const baseRate = employee.baseRate || 0;
    const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
    const dailyMealAllowance = 150;
    const mealAllowance = isHalfDay ? dailyMealAllowance / 2 : dailyMealAllowance;
    const holidayMultiplier = getHolidayPayMultiplier(dateStr);
    const holidayPay = dailyRate * (holidayMultiplier - 1);
    const salesBonus = (dateEntry.branch === 'SM North' && employee.salesBonusEligible) ? calculateDailySalesBonus(dateStr) : 0;
    const otCalculation = calculateOTPay(dateEntry, baseRate);
    const transpoAllowance = dateEntry.transpoAllowance || 0;

    // Deductions
    const standardHours = isHalfDay ? 4 : 8;
    const hourlyRate = dailyRate / standardHours;
    const deductionHours = calculateDeductions(dateEntry.timeIn, dateEntry.timeOut, dateEntry.scheduledIn, dateEntry.scheduledOut);
    const deductionAmount = deductionHours * hourlyRate;

    // Create breakdown table
    const breakdownHTML = `
        <div class="pay-breakdown">
            <h4>Pay Breakdown for ${formatReadableDate(dateStr)}</h4>
            <table class="breakdown-table">
                <tr>
                    <td><strong>Base Pay:</strong></td>
                    <td></td>
                </tr>
                <tr>
                    <td>Base Rate (${isHalfDay ? 'Half Day' : 'Full Day'})</td>
                    <td>₱${dailyRate.toFixed(2)}</td>
                </tr>
                ${holidayMultiplier > 1 ? `
                <tr>
                    <td>Holiday Pay Bonus (${holidayMultiplier}x)</td>
                    <td>₱${holidayPay.toFixed(2)}</td>
                </tr>
                ` : ''}
                <tr>
                    <td>Meal Allowance</td>
                    <td>₱${mealAllowance.toFixed(2)}</td>
                </tr>
                <tr>
                    <td>Sales Bonus</td>
                    <td>₱${salesBonus.toFixed(2)}</td>
                </tr>
                ${transpoAllowance > 0 ? `
                <tr>
                    <td>Transportation Allowance</td>
                    <td>₱${transpoAllowance.toFixed(2)}</td>
                </tr>
                ` : ''}
                ${otCalculation.otPay > 0 ? `
                <tr>
                    <td>Overtime Pay (${otCalculation.otHours.toFixed(1)} hrs)</td>
                    <td>₱${otCalculation.otPay.toFixed(2)}</td>
                </tr>
                ` : ''}
                <tr>
                    <td><strong>Deductions:</strong></td>
                    <td></td>
                </tr>
                <tr>
                    <td>Late/Undertime (${deductionHours.toFixed(1)} hrs)</td>
                    <td>-₱${deductionAmount.toFixed(2)}</td>
                </tr>
                <tr class="total-row">
                    <td><strong>Total Pay</strong></td>
                    <td><strong>₱${totalPay.toFixed(2)}</strong></td>
                </tr>
            </table>
            
            ${employee.salesBonusEligible ? `
            <div style="margin-top: 1.5rem;">
                <h4>Sales Bonus Details</h4>
                <table class="breakdown-table">
                    <tr>
                        <td>Daily Sales</td>
                        <td>₱${(window.salesDataCache[dateStr]?.totalSales || 0).toLocaleString()}</td>
                    </tr>
                    <tr>
                        <td>Staff Count</td>
                        <td>${getStaffingLevel(date)}</td>
                    </tr>
                    <tr>
                        <td>Sales Quota</td>
                        <td>₱${getQuotaForStaffing(getStaffingLevel(date)).toLocaleString()}</td>
                    </tr>
                    <tr>
                        <td>Bonus Earned</td>
                        <td>₱${salesBonus.toFixed(2)}</td>
                    </tr>
                </table>
            </div>
            ` : ''}
            
            ${otCalculation.otPay > 0 ? `
            <div style="margin-top: 1.5rem;">
                <h4>Overtime Details</h4>
                <table class="breakdown-table">
                    <tr>
                        <td>Total Hours Worked</td>
                        <td>${calculateHours(dateEntry.timeIn, dateEntry.timeOut).toFixed(1)} hrs</td>
                    </tr>
                    <tr>
                        <td>Regular Hours (max 8)</td>
                        <td>8.0 hrs</td>
                    </tr>
                    <tr>
                        <td>Overtime Hours</td>
                        <td>${otCalculation.otHours.toFixed(1)} hrs</td>
                    </tr>
                    <tr>
                        <td>OT Rate</td>
                        <td>₱${(otCalculation.otPay / otCalculation.otHours).toFixed(2)}/hr</td>
                    </tr>
                    <tr>
                        <td>Total OT Pay</td>
                        <td>₱${otCalculation.otPay.toFixed(2)}</td>
                    </tr>
                </table>
            </div>
            ` : ''}
        </div>
    `;

    detailRow.querySelector('.detail-content').innerHTML = breakdownHTML;
    detailRow.dataset.loaded = 'true';
}

async function cleanupOrphanedPhotos() {
    showLoading("Scanning for orphaned photos...");

    try {
        // Get all employees
        const employeeIds = Object.keys(employees);
        let totalDeleted = 0;

        // Get today's date for reference
        const today = new Date();
        // Look back 7 days by default
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);

        // Build a list of dates to check
        const datesToCheck = [];
        let currentDate = new Date(startDate);
        while (currentDate <= today) {
            datesToCheck.push(formatDate(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        console.log(`Checking orphaned photos for dates: ${datesToCheck.join(', ')}`);

        // For each employee, check recent dates
        for (const employeeId of employeeIds) {
            console.log(`Checking employee: ${employees[employeeId]}`);

            // For each date, check if document exists but photos might be orphaned
            for (const dateStr of datesToCheck) {
                // Check if document exists
                const docRef = doc(db, "attendance", employeeId, "dates", dateStr);
                const docSnap = await getDoc(docRef);

                if (!docSnap.exists()) {
                    // Document doesn't exist - possible orphaned photos
                    console.log(`No attendance record for ${employeeId} on ${dateStr} - checking for orphaned photos`);

                    // Try some common timestamp patterns we might have used in photo filenames
                    const timestamps = [
                        // Common patterns - you might need to adjust based on your app's naming
                        "",  // Try with no timestamp first
                        `_${dateStr.replace(/-/g, "")}`,
                        `_${new Date(dateStr).getTime()}`
                    ];

                    for (const timestamp of timestamps) {
                        try {
                            // Try to find clock-in photo
                            const inPath = `selfies/${employeeId}_${dateStr}_in${timestamp}.jpg`;
                            console.log(`Checking for: ${inPath}`);
                            const inRef = storageRef(storage, inPath);

                            try {
                                await deleteObject(inRef);
                                console.log(`Deleted orphaned clock-in photo: ${inPath}`);
                                totalDeleted++;
                            } catch (inError) {
                                // Not found or other error - that's okay, just continue
                                console.log(`Not found: ${inPath}`);
                            }

                            // Try to find clock-out photo
                            const outPath = `selfies/${employeeId}_${dateStr}_out${timestamp}.jpg`;
                            console.log(`Checking for: ${outPath}`);
                            const outRef = storageRef(storage, outPath);

                            try {
                                await deleteObject(outRef);
                                console.log(`Deleted orphaned clock-out photo: ${outPath}`);
                                totalDeleted++;
                            } catch (outError) {
                                // Not found or other error - that's okay, just continue
                                console.log(`Not found: ${outPath}`);
                            }
                        } catch (pathError) {
                            // Skip any errors for this pattern
                            console.warn(`Error with pattern: ${pathError.message}`);
                        }
                    }
                }
            }
        }

        console.log(`Cleanup complete. Deleted ${totalDeleted} orphaned photos.`);
        alert(`Cleanup complete. Found and deleted ${totalDeleted} orphaned photos.`);
    } catch (error) {
        console.error("Error during orphaned photo cleanup:", error);
        alert("Error during cleanup: " + error.message);
    } finally {
        hideLoading();
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
        // First, fetch the document to get the image URLs before deletion
        const entryRef = doc(db, "attendance", employeeId, "dates", dateStr);
        const docSnap = await getDoc(entryRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const clockInSelfie = data.clockIn?.selfie;
            const clockOutSelfie = data.clockOut?.selfie;

            // Delete photo files from storage if they exist
            if (clockInSelfie && clockInSelfie.includes('firebasestorage.googleapis.com')) {
                try {
                    // Get the storage path from the URL
                    const storageUrl = new URL(clockInSelfie);
                    const pathWithQuery = storageUrl.pathname;
                    // The path typically starts with /v0/b/PROJECT_ID/o/
                    // Extract just the path part after /o/
                    const encodedPath = pathWithQuery.split('/o/')[1];
                    if (encodedPath) {
                        // The path is URL encoded, so decode it
                        const path = decodeURIComponent(encodedPath.split('?')[0]);
                        const photoRef = storageRef(storage, path);
                        await deleteObject(photoRef);
                        console.log("Clock-in photo deleted from storage:", path);
                    }
                } catch (photoError) {
                    console.warn("Could not delete clock-in photo:", photoError);
                }
            }

            if (clockOutSelfie && clockOutSelfie.includes('firebasestorage.googleapis.com')) {
                try {
                    const storageUrl = new URL(clockOutSelfie);
                    const pathWithQuery = storageUrl.pathname;
                    const encodedPath = pathWithQuery.split('/o/')[1];
                    if (encodedPath) {
                        const path = decodeURIComponent(encodedPath.split('?')[0]);
                        const photoRef = storageRef(storage, path);
                        await deleteObject(photoRef);
                        console.log("Clock-out photo deleted from storage:", path);
                    }
                } catch (photoError) {
                    console.warn("Could not delete clock-out photo:", photoError);
                }
            }
        }

        // Delete the document from Firestore
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

    // Set nickname - use stored nickname or generate default
    const storedNickname = employee.nickname;
    const defaultNickname = generateDefaultNickname(employees[employeeId] || '');
    editNickname.value = storedNickname || defaultNickname;
    editNickname.placeholder = `Default: ${defaultNickname}`;
    editSalesBonus.checked = employee.salesBonusEligible || false;

    editEmployeeId.value = employeeId;

    // Show modal
    employeeEditModal.style.display = 'flex';
}

function generateDefaultNickname(fullName) {
    if (!fullName) return '';
    const nameParts = fullName.trim().split(' ');
    return nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : fullName;
}

// Close employee edit modal
function closeEditEmployeeModal() {
    employeeEditModal.style.display = 'none';
}

async function saveEmployeeChanges(e) {
    e.preventDefault();

    const employeeId = editEmployeeId.value;
    const newName = editEmployeeName.value.trim();
    const newBaseRate = parseFloat(editBaseRate.value) || 0;
    const newNickname = editNickname.value.trim();
    const newSalesBonusEligible = editSalesBonus.checked;

    try {
        // Update in memory
        employees[employeeId] = newName;
        attendanceData[employeeId].baseRate = newBaseRate;
        attendanceData[employeeId].nickname = newNickname;
        attendanceData[employeeId].salesBonusEligible = newSalesBonusEligible;

        // Update Firebase - using setDoc instead of updateDoc
        const employeeDocRef = doc(db, "employees", employeeId);
        await setDoc(employeeDocRef, {
            name: newName,
            baseRate: newBaseRate,
            nickname: newNickname,
            salesBonusEligible: newSalesBonusEligible
        }, { merge: true });

        // Update UI
        const row = document.querySelector(`.expandable-row[data-employee-id="${employeeId}"]`);
        if (row) {
            row.querySelector('.employee-name').textContent = newName;
            row.querySelector('.base-rate').textContent = `₱${newBaseRate}`;

            // Update total pay
            const daysWorked = attendanceData[employeeId].daysWorked;
            const totalPay = calculateTotalPay(daysWorked, newBaseRate);
            row.querySelector('td:nth-child(5)').textContent = `₱${totalPay.toFixed(2)}`;
        }

        // Update single employee view heading if we're in that view
        if (currentEmployeeView === employeeId) {
            const heading = document.getElementById('employee-view-heading');
            if (heading) {
                const displayName = newNickname || generateDefaultNickname(newName);
                heading.textContent = displayName;
            }
        }

        console.log(`Employee ${employeeId} updated: name=${newName}, baseRate=${newBaseRate}, nickname=${newNickname}`);

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

function openEditShiftModal(employeeId, dateStr) {
    // Get DOM elements with safety checks
    const editShiftBranch = document.getElementById('editShiftBranch');
    const editShiftSchedule = document.getElementById('editShiftSchedule');
    const editShiftTimeIn = document.getElementById('editShiftTimeIn');
    const editShiftTimeOut = document.getElementById('editShiftTimeOut');
    const editTranspoAllowance = document.getElementById('editTranspoAllowance');
    const editOTPay = document.getElementById('editOTPay');
    const editShiftEmployeeId = document.getElementById('editShiftEmployeeId');
    const editShiftDate = document.getElementById('editShiftDate');

    // Check if all elements exist
    if (!editShiftTimeOut) {
        console.error('editShiftTimeOut element not found');
        console.log('Available elements:', {
            editShiftBranch: !!editShiftBranch,
            editShiftSchedule: !!editShiftSchedule,
            editShiftTimeIn: !!editShiftTimeIn,
            editShiftTimeOut: !!editShiftTimeOut,
            editTranspoAllowance: !!editTranspoAllowance,
            editOTPay: !!editOTPay
        });
        return;
    }

    // Find the date entry in the data
    const employee = filteredData[employeeId];
    const dateEntry = employee.dates.find(d => d.date === dateStr);

    if (dateEntry) {
        editShiftBranch.value = dateEntry.branch || 'Podium';
        editShiftSchedule.value = dateEntry.shift || 'Opening';

        // Convert time format from "9:30 AM" to "09:30" for HTML time input
        editShiftTimeIn.value = convertTo24HourFormat(dateEntry.timeIn) || '';
        editShiftTimeOut.value = convertTo24HourFormat(dateEntry.timeOut) || '';

        // Set transportation allowance and OT pay
        editTranspoAllowance.value = dateEntry.transpoAllowance || 0;
        editOTPay.checked = dateEntry.hasOTPay || false;
    }

    editShiftEmployeeId.value = employeeId;
    editShiftDate.value = dateStr;

    document.getElementById('shiftEditModal').style.display = 'flex';
}

function convertTo24HourFormat(timeStr) {
    if (!timeStr) return '';

    const [time, meridian] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);

    if (meridian === 'PM' && hours !== 12) hours += 12;
    if (meridian === 'AM' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function convertTo12HourFormat(timeStr) {
    if (!timeStr) return null;

    const [hours, minutes] = timeStr.split(':').map(Number);
    const meridian = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;

    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${meridian}`;
}

// Close shift edit modal
function closeShiftEditModal() {
    shiftEditModal.style.display = 'none';
}

// Open add employee modal
function openAddEmployeeModal() {
    // Clear form
    addEmployeeForm.reset();

    // Show modal
    addEmployeeModal.style.display = 'flex';
}

// Close add employee modal
function closeAddEmployeeModalFunc() {
    addEmployeeModal.style.display = 'none';
}

// Save new employee
async function saveNewEmployee(e) {
    e.preventDefault();

    const employeeId = addEmployeeId.value.trim();
    const employeeName = addEmployeeName.value.trim();
    const baseRate = parseFloat(addBaseRate.value) || 0;
    const nickname = addNickname.value.trim() || generateDefaultNickname(employeeName);
    const salesBonusEligible = addSalesBonus.checked;

    // Validate employee ID doesn't already exist
    if (employees[employeeId]) {
        alert('Employee ID already exists. Please use a different ID.');
        return;
    }

    try {
        // Save to Firebase first
        const employeeDocRef = doc(db, "employees", employeeId);
        await setDoc(employeeDocRef, {
            name: employeeName,
            baseRate: baseRate,
            nickname: nickname,
            salesBonusEligible: salesBonusEligible
        });

        // Add to local employees object
        employees[employeeId] = employeeName;

        // Add to attendance data
        attendanceData[employeeId] = {
            id: employeeId,
            name: employeeName,
            dates: [],
            lastClockIn: null,
            lastClockInPhoto: null,
            daysWorked: 0,
            lateHours: 0,
            baseRate: baseRate,
            nickname: nickname,
            salesBonusEligible: salesBonusEligible
        };

        console.log(`New employee added: ${employeeId} - ${employeeName}`);

        // Update cache
        const periodId = periodSelect.value;
        const branchId = branchSelect.value;
        const cacheKey = getCacheKey(periodId, branchId);
        saveToCache(cacheKey, attendanceData);

        // Refresh the view
        filterData();

        // Close modal
        closeAddEmployeeModalFunc();

        alert('Employee added successfully!');
    } catch (error) {
        console.error("Error adding employee:", error);
        alert("Failed to add employee. Please try again.");
    }
}

async function saveShiftChanges(e) {
    e.preventDefault();

    // Get DOM elements
    const editShiftBranch = document.getElementById('editShiftBranch');
    const editShiftSchedule = document.getElementById('editShiftSchedule');
    const editShiftTimeIn = document.getElementById('editShiftTimeIn');
    const editShiftTimeOut = document.getElementById('editShiftTimeOut');
    const editTranspoAllowance = document.getElementById('editTranspoAllowance');
    const editOTPay = document.getElementById('editOTPay');
    const editShiftEmployeeId = document.getElementById('editShiftEmployeeId');
    const editShiftDate = document.getElementById('editShiftDate');

    const employeeId = editShiftEmployeeId.value;
    const dateStr = editShiftDate.value;
    const newBranch = editShiftBranch.value;
    const newShift = editShiftSchedule.value;
    const newTimeIn = editShiftTimeIn.value ? convertTo12HourFormat(editShiftTimeIn.value) : null;
    const newTimeOut = editShiftTimeOut.value ? convertTo12HourFormat(editShiftTimeOut.value) : null;
    const newTranspoAllowance = parseFloat(editTranspoAllowance.value) || 0;
    const newHasOTPay = editOTPay.checked;

    try {
        // Build update object
        const updateData = {
            'clockIn.branch': newBranch,
            'clockIn.shift': newShift,
            'transpoAllowance': newTranspoAllowance,
            'hasOTPay': newHasOTPay
        };

        // Only update times if they were provided
        if (newTimeIn) {
            updateData['clockIn.time'] = newTimeIn;
        }
        if (newTimeOut) {
            updateData['clockOut.time'] = newTimeOut;
        }

        // Update in Firebase
        const docRef = doc(db, "attendance", employeeId, "dates", dateStr);
        await updateDoc(docRef, updateData);

        // Update local data
        const employee = attendanceData[employeeId];
        const dateEntry = employee.dates.find(d => d.date === dateStr);
        if (dateEntry) {
            dateEntry.branch = newBranch;
            dateEntry.shift = newShift;
            dateEntry.transpoAllowance = newTranspoAllowance;
            dateEntry.hasOTPay = newHasOTPay;

            if (newTimeIn) dateEntry.timeIn = newTimeIn;
            if (newTimeOut) dateEntry.timeOut = newTimeOut;

            const shiftSchedule = SHIFT_SCHEDULES[newShift] || SHIFT_SCHEDULES["Custom"];
            dateEntry.scheduledIn = shiftSchedule.timeIn;
            dateEntry.scheduledOut = shiftSchedule.timeOut;
        }

        // Update cache and refresh view
        const periodId = periodSelect.value;
        const branchId = branchSelect.value;
        const cacheKey = getCacheKey(periodId, branchId);
        saveToCache(cacheKey, attendanceData);

        filterData();

        if (currentEmployeeView === employeeId) {
            const container = document.getElementById('employee-details-table');
            if (container) {
                loadEmployeeDetailsAsMainTable(employeeId, container);
            }
        }

        closeShiftEditModal();
        alert('Shift details updated successfully');
    } catch (error) {
        console.error('Error updating shift:', error);
        alert('Failed to update shift details. Please try again.');
    }
}

// Open batch edit modal
function openBatchEditModal(employeeId) {
    batchEditEmployeeId.value = employeeId;
    batchEditBranch.value = '';
    batchEditShift.value = '';
    batchEditModal.style.display = 'flex';
}

// Close batch edit modal
function closeBatchEditModal() {
    batchEditModal.style.display = 'none';
}

// Save batch changes
async function saveBatchChanges(e) {
    e.preventDefault();

    const employeeId = batchEditEmployeeId.value;
    const newBranch = batchEditBranch.value;
    const newShift = batchEditShift.value;

    if (!newBranch && !newShift) {
        alert('Please select at least one field to update.');
        return;
    }

    if (!confirm('This will update all attendance records for this employee in the current period. Continue?')) {
        return;
    }

    showLoading('Updating attendance records...');

    try {
        const employee = filteredData[employeeId];
        const updates = [];

        // Process each date entry
        for (const dateEntry of employee.dates) {
            const docRef = doc(db, "attendance", employeeId, "dates", dateEntry.date);
            const updateData = {};

            if (newBranch) {
                updateData['clockIn.branch'] = newBranch;
                dateEntry.branch = newBranch;
            }

            if (newShift) {
                updateData['clockIn.shift'] = newShift;
                dateEntry.shift = newShift;
                dateEntry.scheduledIn = SHIFT_SCHEDULES[newShift].timeIn;
                dateEntry.scheduledOut = SHIFT_SCHEDULES[newShift].timeOut;
            }

            updates.push(updateDoc(docRef, updateData));
        }

        // Execute all updates
        await Promise.all(updates);

        // Update cache
        const periodId = periodSelect.value;
        const branchId = branchSelect.value;
        const cacheKey = getCacheKey(periodId, branchId);
        saveToCache(cacheKey, attendanceData);

        // Refresh the view
        filterData();

        // Reload single employee view if active
        if (currentEmployeeView === employeeId) {
            const container = document.getElementById('employee-details-table');
            if (container) {
                loadEmployeeDetailsAsMainTable(employeeId, container);
            }
        }

        closeBatchEditModal();
        alert(`Successfully updated ${updates.length} records`);
    } catch (error) {
        console.error('Error in batch update:', error);
        alert('Failed to update records. Please try again.');
    } finally {
        hideLoading();
    }
}

// Add this to your DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async function () {
    // Existing setup code...

    // Set up background refresh after initial load
    setupBackgroundRefresh();
});

document.addEventListener('DOMContentLoaded', async function () {
    // Add this event listener in your DOMContentLoaded function
    // document.getElementById('cleanupPhotosBtn').addEventListener('click', cleanupOrphanedPhotos);
    console.time('app-init');

    // Setup event listeners
    closeModal.addEventListener('click', closePhotoModal);
    photoModal.addEventListener('click', closePhotoModal);
    document.querySelector('.photo-modal-content').addEventListener('click', function (e) { e.stopPropagation(); });

    window.payrollPeriods = generatePayrollPeriods(); 
    updatePeriodDropdown();

    periodSelect.addEventListener('change', async function () {
        // Get the selection right away and store it
        const selectedPeriod = this.value;
        console.log(`Period selected by user: ${selectedPeriod}`);

        // Lock the selection immediately
        this.disabled = true;

        try {
            // Clear existing data and cache
            attendanceData = {};
            localStorage.setItem('last_selected_period', selectedPeriod);
            localStorage.removeItem(getCacheKey(selectedPeriod, branchSelect.value));

            // Pass the explicitly selected period to loadData
            await loadData(selectedPeriod);

            // IMPORTANT: Only update view mode and reload employee details AFTER loadData completes
            // If we're in single employee view, reload that specific view
            if (currentEmployeeView) {
                // First update the view mode to ensure proper structure
                updateViewMode();

                // Then reload the employee details
                const container = document.getElementById('employee-details-table');
                if (container) {
                    container.innerHTML = '<div class="spinner"></div>';
                    await loadEmployeeDetailsAsMainTable(currentEmployeeView, container);
                }
            }
        } catch (error) {
            console.error("Error loading period:", error);
        } finally {
            this.disabled = false;

            // Double-check selection is still correct after loading
            if (this.value !== selectedPeriod) {
                console.log(`Fixing period back to ${selectedPeriod} from ${this.value}`);
                this.value = selectedPeriod;
            }
        }
    });

    branchSelect.addEventListener('change', function () {
        localStorage.removeItem('last_selected_branch');
        localStorage.setItem('last_selected_branch', this.value);
        filterData();
    });

    refreshBtn.addEventListener('click', function () {
        clearAllPeriodCaches();
        refreshBtn.dataset.forceRefresh = 'true';
        loadData();
    });
    
    exportBtn.addEventListener('click', exportToCSV);

    // Holiday modal event listeners
    closeHolidaysModal.addEventListener('click', closeHolidaysModalFunc);
    closeHolidaysBtn.addEventListener('click', closeHolidaysModalFunc);
    addHolidayForm.addEventListener('submit', saveNewHoliday);

    // Check for any previously selected period or branch
    const lastSelectedPeriod = localStorage.getItem('last_selected_period');
    const lastSelectedBranch = localStorage.getItem('last_selected_branch');

    if (lastSelectedBranch) {
        branchSelect.value = lastSelectedBranch;
    }

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

// Holiday management functions
function openHolidaysModal() {
    renderHolidaysTable();
    holidaysModal.style.display = 'flex';
}

function closeHolidaysModalFunc() {
    holidaysModal.style.display = 'none';
}

function renderHolidaysTable() {
    holidaysTableBody.innerHTML = '';

    // Convert HOLIDAYS_2025 object to array and sort by date
    const holidayArray = Object.entries(HOLIDAYS_2025)
        .map(([date, holiday]) => ({ date, ...holiday }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    holidayArray.forEach(holiday => {
        const row = document.createElement('tr');
        const formattedDate = new Date(holiday.date).toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        row.innerHTML = `
            <td>${formattedDate}</td>
            <td>${holiday.name}</td>
            <td>
                <span class="holiday-type-badge ${holiday.type}">
                    ${holiday.type === 'regular' ? 'Regular' : 'Special'}
                </span>
            </td>
            <td>
                <button class="action-btn delete-holiday-btn" data-date="${holiday.date}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18"></path>
                        <path d="m19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                        <path d="m8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                    </svg>
                    Delete
                </button>
            </td>
        `;

        holidaysTableBody.appendChild(row);
    });

    // Add event listeners for delete buttons
    holidaysTableBody.querySelectorAll('.delete-holiday-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const dateStr = this.dataset.date;
            deleteHoliday(dateStr);
        });
    });
}

async function saveNewHoliday(e) {
    e.preventDefault();

    const date = document.getElementById('holidayDate').value;
    const name = document.getElementById('holidayName').value.trim();
    const type = document.getElementById('holidayType').value;

    if (!date || !name) {
        alert('Please fill in all required fields.');
        return;
    }

    // Check if holiday already exists
    if (HOLIDAYS_2025[date]) {
        alert('A holiday already exists on this date.');
        return;
    }

    try {
        // Add to local HOLIDAYS_2025 object
        HOLIDAYS_2025[date] = { name, type };

        // Save to Firebase
        await setDoc(doc(db, "config", "holidays_2025"), HOLIDAYS_2025);

        // Clear form
        addHolidayForm.reset();

        // Refresh the table
        renderHolidaysTable();

        // Update summary cards if needed
        updateSummaryCards();

        console.log(`Holiday added: ${date} - ${name} (${type})`);
    } catch (error) {
        console.error('Error adding holiday:', error);
        alert('Failed to add holiday. Please try again.');
    }
}

async function deleteHoliday(dateStr) {
    const holiday = HOLIDAYS_2025[dateStr];
    if (!holiday) return;

    if (!confirm(`Are you sure you want to delete "${holiday.name}"?`)) {
        return;
    }

    try {
        // Remove from local object
        delete HOLIDAYS_2025[dateStr];

        // Save to Firebase
        await setDoc(doc(db, "config", "holidays_2025"), HOLIDAYS_2025);

        // Refresh the table
        renderHolidaysTable();

        // Update summary cards
        updateSummaryCards();

        console.log(`Holiday deleted: ${dateStr}`);
    } catch (error) {
        console.error('Error deleting holiday:', error);
        alert('Failed to delete holiday. Please try again.');
    }
}

// Open add shift modal
function openAddShiftModal(employeeId) {
    addShiftEmployeeId.value = employeeId;

    // Set default values
    addShiftDate.value = '';
    addShiftBranch.value = 'Podium';
    addShiftSchedule.value = 'Opening';
    addShiftTimeIn.value = '09:30';
    addShiftTimeOut.value = '18:30';

    addShiftModal.style.display = 'flex';
}

// Close add shift modal
function closeAddShiftModalFunc() {
    addShiftModal.style.display = 'none';
}

// Save new shift
async function saveNewShift(e) {
    e.preventDefault();

    const employeeId = addShiftEmployeeId.value;
    const dateStr = addShiftDate.value;
    const branch = addShiftBranch.value;
    const shift = addShiftSchedule.value;
    const timeIn = convertTo12HourFormat(addShiftTimeIn.value);
    const timeOut = convertTo12HourFormat(addShiftTimeOut.value);

    if (!dateStr || !timeIn || !timeOut) {
        alert('Please fill in all required fields.');
        return;
    }

    try {
        // Check if shift already exists for this date
        const docRef = doc(db, "attendance", employeeId, "dates", dateStr);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            if (!confirm('A shift already exists for this date. Do you want to overwrite it?')) {
                return;
            }
        }

        // Create the shift data
        const shiftData = {
            clockIn: {
                time: timeIn,
                branch: branch,
                shift: shift
            },
            clockOut: {
                time: timeOut
            }
        };

        // Save to Firebase
        await setDoc(docRef, shiftData);

        // Update local data
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

        const shiftSchedule = SHIFT_SCHEDULES[shift] || SHIFT_SCHEDULES["Custom"];
        const newEntry = {
            date: dateStr,
            branch: branch,
            shift: shift,
            scheduledIn: shiftSchedule.timeIn,
            scheduledOut: shiftSchedule.timeOut,
            timeIn: timeIn,
            timeOut: timeOut,
            timeInPhoto: null,
            timeOutPhoto: null
        };

        // Remove existing entry if it exists
        attendanceData[employeeId].dates = attendanceData[employeeId].dates.filter(d => d.date !== dateStr);

        // Add new entry
        attendanceData[employeeId].dates.push(newEntry);

        // Update cache
        const periodId = periodSelect.value;
        const branchId = branchSelect.value;
        const cacheKey = getCacheKey(periodId, branchId);
        saveToCache(cacheKey, attendanceData);

        // Refresh the view
        filterData();

        // Reload employee details if in single view
        if (currentEmployeeView === employeeId) {
            const container = document.getElementById('employee-details-table');
            if (container) {
                loadEmployeeDetailsAsMainTable(employeeId, container);
            }
        }

        closeAddShiftModalFunc();
        alert('Shift added successfully!');

    } catch (error) {
        console.error('Error adding shift:', error);
        alert('Failed to add shift. Please try again.');
    }
}

// Add these functions
async function openPaymentModal(employeeId) {
    const employee = employees[employeeId];
    const currentPeriod = periodSelect.options[periodSelect.selectedIndex].text;
    const periodId = periodSelect.value;

    document.getElementById('paymentEmployeeName').value = employee || 'Unknown Employee';
    document.getElementById('paymentPeriod').value = currentPeriod;
    document.getElementById('paymentEmployeeId').value = employeeId;
    document.getElementById('paymentScreenshot').value = '';
    document.getElementById('paymentNote').value = '';
    document.getElementById('paymentMethod').value = ''; // Reset transfer method

    // Check if payment already exists
    try {
        const paymentRef = doc(db, "payment_confirmations", `${employeeId}_${periodId}`);
        const paymentSnap = await getDoc(paymentRef);

        if (paymentSnap.exists()) {
            const paymentData = paymentSnap.data();
            document.getElementById('paymentNote').value = paymentData.note || '';
            document.getElementById('paymentMethod').value = paymentData.transferMethod || '';

            // Only show existing photo view if we actually have a screenshot
            if (paymentData.screenshotUrl) {
                // Show existing payment photo and info
                const existingInfo = document.getElementById('existingPaymentInfo');
                const existingPhoto = document.getElementById('existingPaymentPhoto');
                const paymentForm = document.getElementById('paymentForm');
                const updateScreenshotBtn = document.getElementById('updateScreenshotBtn');

                if (existingInfo && existingPhoto) {
                    existingPhoto.src = paymentData.screenshotUrl;
                    existingPhoto.style.display = 'block';
                    existingPhoto.onclick = () => openPhotoModal(paymentData.screenshotUrl);

                    existingInfo.textContent = paymentData.note || 'No note added';
                    existingInfo.style.display = 'block';

                    // Hide form and show update button
                    paymentForm.style.display = 'none';
                    updateScreenshotBtn.style.display = 'block';
                }

                document.querySelector('#paymentForm .submit-btn').textContent = 'Update Payment';
            } else {
                // No screenshot exists, show form directly
                const existingInfo = document.getElementById('existingPaymentInfo');
                const existingPhoto = document.getElementById('existingPaymentPhoto');
                const paymentForm = document.getElementById('paymentForm');
                const updateScreenshotBtn = document.getElementById('updateScreenshotBtn');

                if (existingInfo) existingInfo.style.display = 'none';
                if (existingPhoto) {
                    existingPhoto.style.display = 'none';
                    existingPhoto.onclick = null;
                }

                paymentForm.style.display = 'block';
                updateScreenshotBtn.style.display = 'none';
                document.querySelector('#paymentForm .submit-btn').textContent = 'Upload Payment';
            }
        } else {
            // No payment record exists, show form directly
            const existingInfo = document.getElementById('existingPaymentInfo');
            const existingPhoto = document.getElementById('existingPaymentPhoto');
            const paymentForm = document.getElementById('paymentForm');
            const updateScreenshotBtn = document.getElementById('updateScreenshotBtn');

            if (existingInfo) existingInfo.style.display = 'none';
            if (existingPhoto) {
                existingPhoto.style.display = 'none';
                existingPhoto.onclick = null;
            }

            paymentForm.style.display = 'block';
            updateScreenshotBtn.style.display = 'none';
            document.querySelector('#paymentForm .submit-btn').textContent = 'Upload Payment';
        }
    } catch (error) {
        console.error('Error checking existing payment:', error);
    }

    document.getElementById('paymentModal').style.display = 'flex';
}

function showUpdateForm() {
    const paymentForm = document.getElementById('paymentForm');
    const updateScreenshotBtn = document.getElementById('updateScreenshotBtn');

    paymentForm.style.display = 'block';
    updateScreenshotBtn.style.display = 'none';
}

// Helper function to get readable transfer method text
function getTransferMethodText(method) {
    const methods = {
        'gotyme': 'GoTyme',
        'bdo': 'BDO',
        'gcash': 'GCash',
        'cash': 'Cash',
        'others': 'Others'
    };
    return methods[method] || method;
}

function closePaymentModal() {
    document.getElementById('paymentModal').style.display = 'none';
}

async function savePaymentConfirmation(e) {
    e.preventDefault();

    const employeeId = document.getElementById('paymentEmployeeId').value;
    const periodId = periodSelect.value;
    const file = document.getElementById('paymentScreenshot').files[0];
    const note = document.getElementById('paymentNote').value.trim();
    const transferMethod = document.getElementById('paymentMethod').value;

    if (!transferMethod) {
        alert('Please select a transfer method');
        return;
    }

    if (!file && !note) {
        alert('Please either upload a screenshot or add a note');
        return;
    }

    showLoading('Uploading payment confirmation...');

    try {
        let downloadURL = null;

        // Only upload file if one was selected
        if (file) {
            // Upload to Firebase Storage
            const filename = `payment_${employeeId}_${periodId}_${Date.now()}.jpg`;
            const fileRef = storageRef(storage, `payment_confirmations/${filename}`);

            // Upload the file directly
            const snapshot = await uploadBytes(fileRef, file);

            // Get the download URL
            downloadURL = await getDownloadURL(snapshot.ref);
        }

        // Save payment data to Firestore
        const paymentData = {
            employeeId: employeeId,
            periodId: periodId,
            screenshotUrl: downloadURL, // Will be null if no file uploaded
            transferMethod: transferMethod,
            note: note,
            uploadedAt: new Date().toISOString(),
            uploadedBy: 'admin'
        };

        const paymentDocRef = doc(db, "payment_confirmations", `${employeeId}_${periodId}`);
        await setDoc(paymentDocRef, paymentData);

        const cacheKey = `payment_confirmations_${periodId}`;
        localStorage.removeItem(cacheKey);

        console.log('Payment confirmation saved successfully');
        hideLoading(); // Add this line
        alert('Payment confirmation uploaded successfully!');
        closePaymentModal();

        // Refresh payment status indicators
        updateEmployeePaymentStatus();

    } catch (error) {
        console.error('Error uploading payment confirmation:', error);
        hideLoading();
        alert('Failed to upload payment confirmation. Please try again.');
    }
}

async function uploadPaymentScreenshot(imageDataUrl, employeeId, periodId) {
    try {
        // Convert base64 data to blob
        const response = await fetch(imageDataUrl);
        const blob = await response.blob();

        // Create a unique filename
        const filename = `payment_${employeeId}_${periodId}_${Date.now()}.jpg`;
        const fileRef = storageRef(storage, `payment_confirmations/${filename}`);

        // Upload to Firebase Storage
        await uploadBytes(fileRef, blob);

        // Get the download URL
        const downloadURL = await getDownloadURL(fileRef);
        return downloadURL;
    } catch (error) {
        console.error("Error uploading payment screenshot:", error);
        throw error;
    }
}

// Add event listeners
document.getElementById('closePaymentModal').addEventListener('click', closePaymentModal);
document.getElementById('cancelPaymentBtn').addEventListener('click', closePaymentModal);
document.getElementById('paymentForm').addEventListener('submit', savePaymentConfirmation);
window.showUpdateForm = showUpdateForm;