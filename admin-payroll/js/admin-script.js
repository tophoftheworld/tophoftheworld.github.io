const APP_VERSION = "1.04"; // Bump this to clear cache

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

// Toast Notification Functions
function showToast(message, type = 'success', duration = 3000) {
    const toastContainer = document.getElementById('toastContainer');
    
    // If toast container doesn't exist, just use alert for now
    if (!toastContainer) {
        alert(message);
        return;
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    toastContainer.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Auto remove after duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
}

// Employee data - loaded from Firebase
let employees = {};

// Debounce mechanism for updateViewMode to prevent multiple rapid calls
let updateViewModeTimeout = null;
let isUpdateViewModeRunning = false;

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

// PayCalculator instance
let payCalculator = null;

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
        // CSV import successful - no notification needed
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

const editShiftFixedPay = document.getElementById('editShiftFixedPay');
const editShiftFixedAmount = document.getElementById('editShiftFixedAmount');
const editShiftFixedAmountGroup = document.getElementById('editShiftFixedAmountGroup');

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
const addShiftDoublePay = document.getElementById('addShiftDoublePay');
const addShiftFixedPay = document.getElementById('addShiftFixedPay');
const addShiftFixedAmount = document.getElementById('addShiftFixedAmount');
const addShiftFixedAmountGroup = document.getElementById('addShiftFixedAmountGroup');
const addShiftMealAllowance = document.getElementById('addShiftMealAllowance');
const addShiftTranspoAllowance = document.getElementById('addShiftTranspoAllowance');
const addShiftOTPay = document.getElementById('addShiftOTPay');


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

// Add event listener for schedule changes to update time placeholders
console.log('Adding event listener to addShiftSchedule:', addShiftSchedule);
addShiftSchedule.addEventListener('change', function(e) {
    console.log('Schedule change event fired:', e.target.value);
    updateTimePlaceholders();
});

// Add event listener for fixed pay checkbox in add shift modal
addShiftFixedPay.addEventListener('change', function() {
    if (this.checked) {
        addShiftFixedAmountGroup.style.display = 'block';
        addShiftFixedAmount.required = true;
    } else {
        addShiftFixedAmountGroup.style.display = 'none';
        addShiftFixedAmount.required = false;
        addShiftFixedAmount.value = '';
    }
});


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
        version: APP_VERSION,
        data: data
    };

    try {
        const serialized = JSON.stringify(cacheData);

        // Check if this would be a large cache entry
        const sizeInKB = Math.round(serialized.length / 1024);
        console.log(`Attempting to cache ${cacheKey} (${sizeInKB}KB)`);

        // If the cache is getting large, clear old ones first
        if (sizeInKB > 500) { // If over 500KB
            console.log('Large cache detected, clearing old caches first');
            clearOldPayrollPeriodCaches();
        }

        localStorage.setItem(cacheKey, serialized);

        // Add this key to our cache registry
        updateCacheRegistry(cacheKey);

        console.log(`Data cached for ${cacheKey} (${sizeInKB}KB)`);
    } catch (e) {
        console.warn('Cache storage failed, likely quota exceeded', e);

        // Try clearing old payroll caches first
        const clearedCount = clearOldPayrollPeriodCaches();

        if (clearedCount > 0) {
            // Try again after clearing old payroll caches
            try {
                localStorage.setItem(cacheKey, JSON.stringify(cacheData));
                updateCacheRegistry(cacheKey);
                console.log('Successfully cached after clearing old payroll periods');
            } catch (retryError) {
                console.error('Cache storage failed even after clearing old payroll caches', retryError);
                // Last resort: clear ALL caches
                localStorage.clear();
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
                    updateCacheRegistry(cacheKey);
                } catch (finalError) {
                    console.error('Cache storage failed completely', finalError);
                }
            }
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

        // Check version first - invalidate if version mismatch
        if (parsedData.version !== APP_VERSION) {
            console.log(`Cache version mismatch (cached: ${parsedData.version}, current: ${APP_VERSION}), invalidating`);
            localStorage.removeItem(cacheKey);
            return null;
        }

        // Increase the cache expiration time (from 4 hours to 24 hours)
        const cacheAge = Date.now() - parsedData.timestamp;
        const expirationTime = 24 * 60 * 60 * 1000; // 24 hours instead of 4 hours

        if (cacheAge > expirationTime) {
            console.log('Cache expired, removing');
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

        // More aggressive: keep only 2 most recent caches instead of 5
        if (registry.length <= 2) {
            console.log('Cache size within limits, no clearing needed');
            return;
        }

        // Convert to array and sort by timestamp (oldest first)
        const keysByAge = Object.entries(timestamps)
            .sort(([, timeA], [, timeB]) => timeA - timeB)
            .map(([key]) => key);

        // Keep only last 2 caches (most recent)
        const keysToKeep = keysByAge.slice(-2);
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

        // Fallback: clear ALL attendance caches and start fresh
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key && key.startsWith('attendance_')) {
                    localStorage.removeItem(key);
                    console.log(`Fallback: removed ${key}`);
                }
            }
            // Reset the registry
            localStorage.removeItem('cache_registry');
            localStorage.removeItem('cache_timestamps');
        } catch (clearError) {
            console.error('Failed to clear caches', clearError);
        }
    }
}

function clearOldPayrollPeriodCaches() {
    try {
        const currentPeriodId = periodSelect.value;
        const currentBranchId = branchSelect.value;
        const currentCacheKey = getCacheKey(currentPeriodId, currentBranchId);

        console.log('Clearing old payroll period caches, keeping current:', currentCacheKey);

        let removedCount = 0;

        // Get all localStorage keys
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);

            // Only target attendance cache keys
            if (key && key.startsWith('attendance_')) {
                // Keep the current period's cache
                if (key !== currentCacheKey) {
                    localStorage.removeItem(key);
                    removedCount++;
                    console.log(`Removed old payroll cache: ${key}`);
                }
            }
        }

        // Also clean up the registry
        localStorage.setItem('cache_registry', JSON.stringify([currentCacheKey]));
        localStorage.setItem('cache_timestamps', JSON.stringify({
            [currentCacheKey]: Date.now()
        }));

        console.log(`Cleared ${removedCount} old payroll period caches`);
        return removedCount;
    } catch (error) {
        console.error('Error clearing old payroll caches:', error);
        return 0;
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
            // console.log(`Checking employee ${i + 1}/${employeeIds.length}: ${employees[employeeId]}`);

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

        // console.log("Loaded employees from Firebase:", employees);
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

// Fast single-user loading functions
function getSingleUserCacheKey(employeeId, periodId, branchId) {
    return `single_user_${employeeId}_${periodId}_${branchId}`;
}

function cacheSingleUserData(employeeId, periodId, branchId, data) {
    const cacheKey = getSingleUserCacheKey(employeeId, periodId, branchId);
    localStorage.setItem(cacheKey, JSON.stringify({
        data: data,
        timestamp: Date.now(),
        period: periodId,
        branch: branchId
    }));
}

function getSingleUserFromCache(employeeId, periodId, branchId) {
    const cacheKey = getSingleUserCacheKey(employeeId, periodId, branchId);
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        const parsed = JSON.parse(cached);
        // Validate cache is still valid
        if (parsed.period === periodId && parsed.branch === branchId) {
            return parsed.data;
        }
    }
    return null;
}

async function loadSingleEmployeeData(employeeId, periodId = null) {
    const period = periodId || periodSelect.value;
    const branch = branchSelect.value;
    const { startDate, endDate } = getPeriodDates(period);
    const formattedStartDate = formatDate(startDate);
    const formattedEndDate = formatDate(endDate);
    
    console.log(`🚀 FAST LOADING: Single employee ${employeeId} for period: ${period}`);
    console.log(`📅 Date range: ${formattedStartDate} to ${formattedEndDate}`);
    console.log(`🏢 Branch filter: ${branch}`);
    
        // Check cache first
        const cachedData = getSingleUserFromCache(employeeId, period, branch);
        if (cachedData) {
            console.log('✅ Using cached single user data');
            return cachedData;
        }
        
        console.log('🔄 No cache found, fetching from Firebase...');
    
    try {
        // Only load essential data for this specific employee
        console.log('📡 Fetching employee details and attendance data...');
        const [employeeDoc, attendanceSnapshot] = await Promise.all([
            // Get employee details
            getDoc(doc(db, "employees", employeeId)),
            // Get attendance data for this period only
            getDocs(query(
                collection(db, "attendance", employeeId, "dates"),
                where("__name__", ">=", formattedStartDate),
                where("__name__", "<=", formattedEndDate)
            ))
        ]);
        
        console.log(`✅ Employee doc exists: ${employeeDoc.exists()}`);
        console.log(`✅ Attendance records found: ${attendanceSnapshot.size}`);
        
        // Load holidays (lightweight)
        await loadHolidays();
        
        // Load sales data only if employee is eligible
        let salesData = {};
        if (employeeDoc.exists() && employeeDoc.data().salesBonusEligible) {
            salesData = await loadSalesData();
        }
        
        // Initialize PayCalculator with minimal data
        payCalculator = new PayCalculator(HOLIDAYS_2025, salesData);
        
        // Process attendance data
        const dates = [];
        attendanceSnapshot.forEach(doc => {
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
                        transpoAllowance: dateData.transpoAllowance || 0,
                        hasFixedPay: dateData.hasFixedPay || false,
                        fixedPayAmount: dateData.fixedPayAmount || 0,
                        hasDoublePay: dateData.hasDoublePay || false,
                        hasMealAllowance: dateData.hasMealAllowance !== false // Default to true
                    });
                }
            }
        });
        
        console.log(`📊 Processed ${dates.length} attendance dates`);
        
        const result = {
            employee: employeeDoc.data(),
            dates: dates,
            period: period,
            branch: branch
        };
        
        // Cache the result
        cacheSingleUserData(employeeId, period, branch, result);
        console.log('💾 Data cached for future use');
        
        return result;
        
    } catch (error) {
        console.error("❌ Error loading single employee data:", error);
        throw error;
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
    // Debug: Log every call to loadData
    console.log(`🔍 loadData() called:`, {
        selectedPeriodId,
        currentEmployeeView,
        stack: new Error().stack.split('\n').slice(1, 4).join('\n')
    });
    
    // Prevent loading all data when in single employee view
    if (currentEmployeeView && !selectedPeriodId) {
        console.log(`🚫 BLOCKED: loadData() called while in single employee view (${currentEmployeeView})`);
        console.log(`🚫 Use loadSingleEmployeeData() instead for single employee views`);
        return;
    }
    
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

        // Initialize PayCalculator with current data
        payCalculator = new PayCalculator(HOLIDAYS_2025, salesData);
        
        // Invalidate cache if sales bonus feature wasn't included in cached data
        if (cachedData) {
            const sampleEmployee = Object.values(cachedData)[0];
            if (sampleEmployee && typeof sampleEmployee.salesBonusEligible === 'undefined') {
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
                    const currentLiveRate = employeeData.baseRate || 0;
                    const oldNickname = attendanceData[employeeId].nickname || '';
                    const newNickname = employeeData.nickname || '';

                    // Base rate handling: preserve historical rates for cached data
                    const existingRate = attendanceData[employeeId].baseRate || 0;
                    if (existingRate === 0) {
                        // No cached rate - use current live rate (first time loading this period)
                        attendanceData[employeeId].baseRate = currentLiveRate;
                        hasChanges = true;
                    }
                    // If cached rate exists, keep it (preserves historical data)

                    // Always update other employee fields
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
                        transpoAllowance: dateData.transpoAllowance || 0,
                        hasFixedPay: dateData.hasFixedPay || false,
                        fixedPayAmount: dateData.fixedPayAmount || 0,
                        hasDoublePay: dateData.hasDoublePay || false,
                        hasMealAllowance: dateData.hasMealAllowance !== false
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
                        const lateMinutes = payCalculator.compareTimes(dateData.clockIn.time, scheduled);
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
        // Make attendance data globally available for PayCalculator
        window.attendanceData = attendanceData;

        // ALWAYS recalculate totals to include sales bonuses
        const allBonusUpdates = [];
        
        for (const employeeId of Object.keys(attendanceData)) {
            const employee = attendanceData[employeeId];
            if (employee.dates && employee.dates.length > 0) {
                // Recalculate total pay including sales bonuses
                const totalPayWithBonus = payCalculator.calculateTotalPay(employee.dates, employee, 'simple');
                employee.totalPayWithBonus = totalPayWithBonus; // Store it

                // Also ensure sales bonuses are calculated for each date using PayCalculator
                employee.dates.forEach((dateObj) => {
                    if (dateObj.timeIn && dateObj.timeOut && dateObj.branch === 'SM North' && employee.salesBonusEligible) {
                        const salesBonus = payCalculator.calculateSalesBonus(dateObj.date, employee);
                        
                        if (dateObj.salesBonus !== salesBonus) {
                            dateObj.salesBonus = salesBonus;
                            hasChanges = true;
                            
                            // Queue write to Firestore
                            allBonusUpdates.push((async () => {
                                try {
                                    const attendanceDocRef = doc(db, "attendance", employeeId, "dates", dateObj.date);
                                    await setDoc(attendanceDocRef, { salesBonus: salesBonus }, { merge: true });
                                } catch (error) {
                                    console.error(`Failed to write salesBonus for ${employeeId} on ${dateObj.date}:`, error);
                                }
                            })());
                        }
                    }
                });
            }
        }
        
        // Wait for all bonus updates to complete
        if (allBonusUpdates.length > 0) {
            await Promise.all(allBonusUpdates);
        }

        // Save updated data with bonuses
        saveToCache(cacheKey, attendanceData);
        filterData();
        
        // After data is loaded and filtered, restore employee view if needed
        const employeeId = getEmployeeFromHash();
        if (employeeId && employees[employeeId] && currentEmployeeView !== employeeId) {
            console.log('Restoring employee view after data load:', employeeId);
            currentEmployeeView = employeeId;
            updateViewMode();
            
            // Use fast loading for single employee
            const container = document.getElementById('employee-details-table');
            if (container) {
                container.innerHTML = '<div class="spinner"></div>';
                
                // Load only this employee's data using fast path
                loadSingleEmployeeData(employeeId).then(employeeData => {
                    // Update the view immediately with the fast-loaded data
                    loadEmployeeDetailsAsMainTable(employeeId, container, employeeData);
                }).catch(error => {
                    console.error("Error loading single employee:", error);
                    container.innerHTML = '<div class="error">Error loading employee data</div>';
                });
            }
        }
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

// Clear single user caches
function clearSingleUserCaches() {
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('single_user_')) {
            localStorage.removeItem(key);
        }
    }
    console.log("Single user caches cleared");
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
                const lateMinutes = payCalculator.compareTimes(date.timeIn, date.scheduledIn);
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

    // Load payment data first, then render table
    loadPaymentDataAndRender();
}

// Load payment data and render table
async function loadPaymentDataAndRender() {
    const periodId = periodSelect.value;
    
    try {
        // Load payment confirmations
        const paymentStatuses = await loadAllPaymentConfirmations(periodId);
        
        // Store payment status globally so renderEmployeeTable can access it
        window.paymentStatus = paymentStatuses;
        
        // Render the table with payment data
        renderEmployeeTable();
        
        // Update summary cards after rendering
        updateSummaryCards();
        
        // Clear payment status cache and force update indicators
        const cacheKey = `payment_confirmations_${periodId}`;
        localStorage.removeItem(cacheKey);
        await updateEmployeePaymentStatus(true);
        
    } catch (error) {
        console.error('Error loading payment data:', error);
        // Still render table even if payment data fails
        renderEmployeeTable();
        updateSummaryCards();
    }
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
            const branchSpecificPay = payCalculator.calculateTotalPay(employee.dates, employee, 'simple');
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
                if (hasAttendance) {
                    const branchSpecificPay = payCalculator.calculateTotalPay(employee.dates, employee, 'simple');
                    const paymentData = paymentStatuses[employeeId];
                    
                    if (!paymentData) {
                        // No payment made at all - add full amount
                        unpaidAmount += branchSpecificPay;
                    } else {
                        // Payment made - add remaining amount (could be 0 for fully paid)
                        unpaidAmount += paymentData.remainingAmount || 0;
                    }
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
                <div class="card-title">Total Pay</div>
                <div class="card-value">₱${payCalculator.calculateTotalPay(employee.dates, employee, 'simple').toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="card-subtitle">For this period</div>
            </div>
            ${showSalesBonus ? `
            <div class="summary-card">
                <div class="card-title">Sales Bonus</div>
                <div class="card-value">₱${getEmployeeSalesBonusFromPayCalculator(employee).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div class="card-subtitle">Total earned</div>
            </div>
            ` : ''}
        </div>
    `;

    return summaryCardsHTML;
}

function getEmployeeSalesBonusFromPayCalculator(employee) {
    if (!employee.salesBonusEligible) return 0;

    let totalSalesBonus = 0;

    // Calculate sales bonus for each day individually (since this works)
    employee.dates.forEach(dateEntry => {
        if (dateEntry.timeIn && dateEntry.timeOut && dateEntry.branch === 'SM North') {
            // Use PayCalculator's individual day calculation
            const dailyResult = payCalculator.calculateDailyPay(dateEntry, employee, 'detailed');

            if (dailyResult.breakdown && dailyResult.breakdown.components) {
                dailyResult.breakdown.components.forEach(component => {
                    if (component.type === 'sales_bonus') {
                        totalSalesBonus += component.amount;
                    }
                });
            }
        }
    });

    console.log('Sales bonus calculated day by day:', totalSalesBonus);
    return totalSalesBonus;
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
        row.innerHTML = `<td colspan="8" class="no-data">No data available for the selected filters</td>`;
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


        // Let's see what the first date entry looks like
        if (employee.dates && employee.dates[0]) {
            // console.log('First date entry details:', {
            //     date: employee.dates[0].date,
            //     timeIn: employee.dates[0].timeIn,
            //     timeOut: employee.dates[0].timeOut,
            //     branch: employee.dates[0].branch,
            //     shift: employee.dates[0].shift,
            //     hasFixedPay: employee.dates[0].hasFixedPay,
            //     hasDoublePay: employee.dates[0].hasDoublePay
            // });
        }

        const payResult = payCalculator.calculateTotalPay(employee.dates, employee, 'simple');
        // console.log('PayCalculator result:', payResult);

        const paymentButtonHtml = showPaymentButton ? `
        <button class="action-btn payment-btn" data-employee-id="${employeeId}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
            </svg>
            Pay
        </button>
        ` : '';

        // Calculate payable amount (remaining amount to pay)
        const totalPay = payCalculator.calculateTotalPay(employee.dates || [], {
            id: employeeId,
            baseRate: employee.baseRate || 0,
            salesBonusEligible: employee.salesBonusEligible || false
        }, 'simple');
        
        // Get payment status for this employee
        const paymentStatus = window.paymentStatus || {};
        const employeePayment = paymentStatus[employeeId];
        let payableAmount = totalPay;
        let payableClass = 'payable-amount';
        
        if (employeePayment) {
            payableAmount = employeePayment.remainingAmount || 0;
            // Ensure we don't show negative zero
            payableAmount = Math.max(0, payableAmount);
            
            // Fix rounding issues - round to 2 decimal places and treat very small amounts as 0
            payableAmount = Math.round(payableAmount * 100) / 100;
            if (payableAmount < 0.01) {
                payableAmount = 0;
            }
            
            payableClass = payableAmount <= 0 ? 'paid-amount' : 'payable-amount';
        }

        row.innerHTML = `
        <td>
            <span class="employee-name">${employee.name || employees[employeeId] || 'Unknown Employee'}</span>
        </td>
        <td>${daysWorked}</td>
        <td class="${getLatnessColorClass(daysWorked > 0 ? (lateHours / daysWorked * 60) : 0)}">${daysWorked > 0 ? (lateHours / daysWorked * 60).toFixed(1) : '0.0'}</td>
        <td class="base-rate">₱${(employee.baseRate || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td>₱${totalPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="${payableClass}">₱${payableAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
        detailContent.colSpan = 8;
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

            console.log('Open button clicked for employee:', employeeId);

            // Set the current view to this employee
            currentEmployeeView = employeeId;
            updateURLHash(employeeId);

            // Ensure we have the employee data before proceeding
            if (!filteredData[employeeId]) {
                console.log('Employee data not found in filteredData, waiting for data load...');
                // Wait for data to be available
                setTimeout(() => {
                    if (currentEmployeeView === employeeId) {
                        console.log('Retrying view update after data load');
                        updateViewMode();
                    }
                }, 500);
                return;
            }

            console.log('Employee data available, proceeding with view update');
            // Update the UI to show we're in single employee view
            updateViewMode();

            // Force a complete view update to ensure single employee page loads
            setTimeout(() => {
                if (currentEmployeeView === employeeId) {
                    console.log('Forcing view update for employee:', employeeId);
                    updateViewModeImpl();
                    
                    // Additional fallback: directly load employee details if view mode fails
                    setTimeout(() => {
                        const detailsContainer = document.getElementById('employee-details-table');
                        if (detailsContainer && detailsContainer.innerHTML.includes('spinner')) {
                            console.log('View mode may have failed, directly loading employee details');
                            loadEmployeeDetailsAsMainTable(employeeId, detailsContainer);
                        }
                    }, 1000);
                }
            }, 200);
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
                const paymentData = doc.data();
                paymentStatus[employeeId] = {
                    paid: true,
                    paymentAmount: paymentData.paymentAmount || 0,
                    totalPay: paymentData.totalPay || 0,
                    remainingAmount: paymentData.remainingAmount || 0,
                    paymentType: paymentData.paymentType || 'full',
                    cashAdvanceNote: paymentData.cashAdvanceNote || '',
                    transferMethod: paymentData.transferMethod || '',
                    note: paymentData.note || '',
                    uploadedAt: paymentData.uploadedAt || ''
                };
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
async function updateEmployeePaymentStatus(forceUpdate = false) {
    const periodId = periodSelect.value;

    // Check if we're after the payroll period end
    const { endDate } = getPeriodDates(periodId);
    const today = new Date();

    // Only show payment status if we're past the period end date OR if forced
    if (today <= endDate && !forceUpdate) {
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

        // Calculate payable amount for this employee
        const employeeData = filteredData[employeeId];
        if (!employeeData) return;
        
        const totalPay = payCalculator.calculateTotalPay(employeeData.dates || [], {
            id: employeeId,
            baseRate: employeeData.baseRate || 0,
            salesBonusEligible: employeeData.salesBonusEligible || false
        }, 'simple');
        
        // Get remaining amount from payment data if exists, otherwise use total pay
        const paymentData = paymentStatuses[employeeId];
        let remainingAmount = paymentData ? Math.max(0, paymentData.remainingAmount || 0) : totalPay;
        
        // Fix rounding issues - round to 2 decimal places and treat very small amounts as 0
        remainingAmount = Math.round(remainingAmount * 100) / 100;
        if (remainingAmount < 0.01) {
            remainingAmount = 0;
        }
        
        if (remainingAmount <= 0) {
            // Fully paid
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
        } else if (paymentData && paymentData.paymentAmount > 0) {
            // Partially paid (has payment record but remaining amount > 0)
            indicator.innerHTML = '💰 Partially Paid';
            indicator.style.cssText = `
                color: #3498db;
                font-size: 0.8rem;
                font-weight: 600;
                margin-left: 0.5rem;
                background: rgba(52, 152, 219, 0.1);
                padding: 2px 6px;
                border-radius: 12px;
            `;
        } else {
            // No payment made
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

// Helper function to remove seconds from time strings
function removeSecondsFromTime(timeStr) {
    if (!timeStr) return timeStr;

    // Match format like "1:16:02 PM" and convert to "1:16 PM"
    const timeRegex = /^(\d{1,2}):(\d{2}):\d{2}\s?(AM|PM)$/i;
    const match = timeStr.match(timeRegex);

    if (match) {
        return `${match[1]}:${match[2]} ${match[3]}`;
    }

    // Return as-is if it doesn't match (already in correct format)
    return timeStr;
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
                        transpoAllowance: dateData.transpoAllowance || 0,
                        hasFixedPay: dateData.hasFixedPay || false,
                        fixedPayAmount: dateData.fixedPayAmount || 0,
                        hasDoublePay: dateData.hasDoublePay || false,
                        hasMealAllowance: dateData.hasMealAllowance !== false // Default to true
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

            const hours = date.timeIn && date.timeOut ? payCalculator.calculateHours(date.timeIn, date.timeOut) : null;

            let status = 'Absent';
            let statusClass = 'absent';

            if (date.timeIn && date.timeOut) {
                if (date.scheduledIn && payCalculator.compareTimes(date.timeIn, date.scheduledIn) > 0) {
                    status = 'Late';
                    statusClass = 'late';
                } else if (date.scheduledOut && payCalculator.compareTimes(date.timeOut, date.scheduledOut) < 0) {
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
                payCalculator.calculateSalesBonus(date.date, employeeData) : 0;

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
                    (payCalculator.compareTimes(date.timeIn, date.scheduledIn) > 0 ?
                        (payCalculator.compareTimes(date.timeIn, date.scheduledIn) / 60).toFixed(1) :
                        '0.0') :
                    'N/A'}
                </td>
                ${showSalesBonus ? `<td>₱${dailySalesBonus.toFixed(2)}</td>` : ''}
                <td>₱${date.timeIn && date.timeOut ?
                    payCalculator.calculateDailyPay(date, employeeData, 'simple').toFixed(2) :
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
                        <button class="action-btn duplicate-shift-btn" data-date="${date.date}" data-employee="${employeeId}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                            </svg>
                            Duplicate
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

        // Add event listeners for edit shift buttons in detail rows
        detailRow.querySelectorAll('.edit-shift-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                openEditShiftModal(employeeId, dateStr);
            });
        });

        // Add event listeners for duplicate shift buttons in detail rows
        detailRow.querySelectorAll('.duplicate-shift-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                duplicateShift(employeeId, dateStr);
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

    // console.log(`Period ${periodId} dates:`, formatDate(result.startDate), formatDate(result.endDate));
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

// Payroll CSV Export
function exportPayrollCSV() {
    showLoading('Generating payroll export...');

    try {
        const period = periodSelect.value;
        const { startDate, endDate } = getPeriodDates(period);
        const periodText = periodSelect.options[periodSelect.selectedIndex].text;

        let csv = 'Employee ID,Employee Name,Nickname,Base Rate,Days Worked,Regular Days,Holiday Days,Total Hours,Base Pay,Meal Allowance,Transportation Allowance,Sales Bonus,Gross Pay,Late Deductions (info only),Net Pay,Sales Bonus Eligible\n';
        
        // Get filtered employees (active only if toggle is checked)
        let employeesToExport;
        if (activeOnlyToggle.checked) {
            employeesToExport = Object.entries(filteredData).filter(([_, employee]) =>
                employee.dates && employee.dates.some(date => date.timeIn)
            );
        } else {
            employeesToExport = Object.entries(filteredData);
        }

        // Process each employee
        employeesToExport.forEach(([employeeId, employee]) => {
            const employeeName = employees[employeeId] || 'Unknown Employee';
            const nickname = employee.nickname || generateDefaultNickname(employeeName);
            const baseRate = employee.baseRate || 0;
            const salesBonusEligible = employee.salesBonusEligible ? 'Yes' : 'No';

            // Use PayCalculator for accurate breakdown
            const totalResult = payCalculator.calculateTotalPay(employee.dates, employee, 'detailed');
            const totalPayWithBonus = totalResult.total;

            // Extract components from breakdown
            let totalDays = 0;
            let regularDays = 0;
            let holidayDays = 0;
            let totalHours = 0;
            let mealAllowance = 0;
            let transportationAllowance = 0;
            let lateDeductions = 0;
            let totalSalesBonus = 0;

            employee.dates.forEach(dateObj => {
                if (dateObj.timeIn && dateObj.timeOut) {
                    totalDays++;

                    const dateStr = dateObj.date;
                    const isHoliday = HOLIDAYS_2025[dateStr];

                    if (isHoliday) {
                        holidayDays++;
                    } else {
                        regularDays++;
                    }

                    const actualHours = payCalculator.calculateHours(dateObj.timeIn, dateObj.timeOut);
                    if (actualHours) {
                        totalHours += actualHours;
                    }

                    // Get detailed breakdown for this day
                    const dailyResult = payCalculator.calculateDailyPay(dateObj, employee, 'detailed');

                    // Extract components
                    dailyResult.breakdown.components.forEach(component => {
                        switch (component.type) {
                            case 'meal_allowance':
                                mealAllowance += component.amount;
                                break;
                            case 'transportation_allowance':
                                transportationAllowance += component.amount;
                                break;
                            case 'sales_bonus':
                                totalSalesBonus += component.amount;
                                break;
                            case 'late_deduction':
                            case 'undertime_deduction':
                                if (!component.isPositive) {
                                    lateDeductions += component.amount;
                                }
                                break;
                        }
                    });
                }
            });

            // Calculate base pay (total minus allowances and bonuses)
            const basePay = totalPayWithBonus - mealAllowance - transportationAllowance - totalSalesBonus;
            const grossPay = totalPayWithBonus;
            const netPay = grossPay;

            // Add row to CSV
            csv += `${employeeId},"${employeeName}","${nickname}",${baseRate.toFixed(2)},${totalDays},${regularDays},${holidayDays},${totalHours.toFixed(1)},${basePay.toFixed(2)},${mealAllowance.toFixed(2)},${transportationAllowance.toFixed(2)},${totalSalesBonus.toFixed(2)},${grossPay.toFixed(2)},${lateDeductions.toFixed(2)},${netPay.toFixed(2)},${salesBonusEligible}\n`;
        });

        // Create download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `payroll_summary_${periodText.replace(/\s+/g, '_')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        console.log('Payroll CSV export completed');
    } catch (error) {
        console.error('Error generating payroll export:', error);
        alert('Failed to generate payroll export. Please try again.');
    } finally {
        hideLoading();
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
                const hours = date.timeIn && date.timeOut ? payCalculator.calculateHours(date.timeIn, date.timeOut) : 0;

                // Determine status
                let status = 'Absent';
                if (date.timeIn && date.timeOut) {
                    if (date.scheduledIn && payCalculator.compareTimes(date.timeIn, date.scheduledIn) > 0) {
                        status = 'Late';
                    } else if (date.scheduledOut && payCalculator.compareTimes(date.timeOut, date.scheduledOut) < 0) {
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
                csv += `${employeeId},${employeeName},${employee.baseRate || 0},${payCalculator.calculateTotalPay(employee.dates, employee, 'simple').toFixed(2)},${date.branch || 'N/A'},${formattedDate},${date.shift || 'N/A'},${date.timeIn || 'N/A'},${date.timeOut || 'N/A'},${hours ? hours.toFixed(1) : 0},${status},${timeInPhotoFilename},${timeOutPhotoFilename}\n`;
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

// Export current person's payroll to CSV
function exportPersonPayroll(employeeId) {
    if (!employeeId) {
        alert('No employee selected');
        return;
    }

    try {
        const employee = filteredData[employeeId];
        if (!employee) {
            alert('Employee data not found');
            return;
        }

        const employeeName = employees[employeeId] || 'Unknown Employee';
        const period = periodSelect.value;
        const { startDate, endDate } = getPeriodDates(period);
        const periodText = periodSelect.options[periodSelect.selectedIndex].text;

        // Generate all dates in the period range
        const allDates = getDatesInRange(startDate, endDate);
        
        // Create CSV header - only include fields that can be edited per shift
        let csv = 'Date,Day of Week,Branch,Shift,Time In,Time Out,Hours Worked,OT Pay,Double Pay,Fixed Pay,Fixed Amount,Meal Allowance,Transportation Allowance,Notes\n';
        
        // Process each date in the period
        allDates.forEach(dateStr => {
            const dateObj = new Date(dateStr);
            const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
            
            // Find existing data for this date
            const existingData = employee.dates.find(d => d.date === dateStr);
            
            if (existingData && existingData.timeIn && existingData.timeOut) {
                // Has data - include editable fields
                const hours = payCalculator.calculateHours(existingData.timeIn, existingData.timeOut) || 0;
                
                csv += `${dateStr},${dayOfWeek},${existingData.branch || 'N/A'},${existingData.shift || 'N/A'},${existingData.timeIn || ''},${existingData.timeOut || ''},${hours.toFixed(1)},${existingData.hasOTPay ? 'Yes' : 'No'},${existingData.hasDoublePay ? 'Yes' : 'No'},${existingData.hasFixedPay ? 'Yes' : 'No'},${existingData.fixedPayAmount || 0},${existingData.hasMealAllowance ? 'Yes' : 'No'},${existingData.transpoAllowance || 0},${existingData.notes || ''}\n`;
            } else {
                // No data - include placeholder row with empty values
                csv += `${dateStr},${dayOfWeek},,,,,,No,No,No,0,No,0,No attendance recorded\n`;
            }
        });
        
        // Create download link
        const filename = `${employeeName.replace(/[^a-zA-Z0-9]/g, '_')}_Payroll_${periodText.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        console.log(`Exported payroll for ${employeeName}`);
    } catch (error) {
        console.error("Error exporting person payroll:", error);
        alert("Failed to export payroll. Please try again.");
    }
}

// Open import payroll modal
function openImportPayrollModal(employeeId) {
    if (!employeeId) {
        alert('No employee selected');
        return;
    }

    // Create modal HTML
    const modalHTML = `
        <div class="modal" id="importPayrollModal" style="display: flex;">
            <div class="modal-content">
                <span class="close-modal" id="closeImportPayrollModal">&times;</span>
                <h2>Import Payroll Data for ${employees[employeeId] || 'Employee'}</h2>
                <p>Upload a CSV file with payroll data. The CSV should have columns: Date, Branch, Shift, Time In, Time Out, OT Pay, Double Pay, Fixed Pay, Fixed Amount, Meal Allowance, Transportation Allowance, Notes (optional)</p>
                <p><strong>Date format:</strong> YYYY-MM-DD (e.g., 2025-01-15)</p>
                <p><strong>Time format:</strong> HH:MM AM/PM (e.g., 9:30 AM, 6:30 PM)</p>
                <p><strong>Shift options:</strong> Opening, Opening Half-Day, Midshift, Closing, Closing Half-Day, Custom</p>
                <p><strong>Note:</strong> You can import data for any date - it doesn't need to be within the current payroll period!</p>
                
                <div class="form-group">
                    <button type="button" class="btn btn-info" id="downloadTemplate">Download CSV Template</button>
                </div>
                
                <form id="importPayrollForm">
                    <div class="form-group">
                        <label for="importPayrollFile">Select CSV File</label>
                        <input type="file" id="importPayrollFile" accept=".csv" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="importPayrollOverwrite">
                            <input type="checkbox" id="importPayrollOverwrite">
                            Overwrite existing data for matching dates
                        </label>
                    </div>
                    
                    <div class="form-group">
                        <button type="submit" class="btn btn-primary">Import Payroll Data</button>
                        <button type="button" class="btn btn-secondary" id="cancelImportPayroll">Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
            // Get modal elements
        const modal = document.getElementById('importPayrollModal');
        const closeBtn = document.getElementById('closeImportPayrollModal');
        const cancelBtn = document.getElementById('cancelImportPayrollModal');
        const form = document.getElementById('importPayrollForm');
        
        // Close modal function
        const closeModal = () => {
            modal.remove();
        };
        
        // Event listeners
        closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeModal);
        }
    
    // Template download button
    const templateBtn = document.getElementById('downloadTemplate');
    templateBtn.addEventListener('click', () => downloadCSVTemplate(employeeId));
    
    // Handle form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const file = document.getElementById('importPayrollFile').files[0];
        const overwrite = document.getElementById('importPayrollOverwrite').checked;
        
        if (!file) {
            alert('Please select a CSV file');
            return;
        }
        
        // Check file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('File too large. Please select a file smaller than 5MB.');
            return;
        }
        
        // Check file type
        if (!file.name.toLowerCase().endsWith('.csv')) {
            alert('Please select a valid CSV file.');
            return;
        }
        
        try {
            await importPersonPayroll(employeeId, file, overwrite);
            closeModal();
        } catch (error) {
            console.error('Import failed:', error);
            alert('Import failed: ' + error.message);
        }
    });
}

// Download CSV template for payroll import
function downloadCSVTemplate(employeeId) {
    try {
        const employeeName = employees[employeeId] || 'Employee';
        
        // Create template CSV with sample data
        let csv = 'Date,Branch,Shift,Time In,Time Out,OT Pay,Double Pay,Fixed Pay,Fixed Amount,Meal Allowance,Transportation Allowance,Notes\n';
        csv += '2025-01-15,Podium,Opening,9:30 AM,6:30 PM,No,No,No,0,Yes,100,Regular shift\n';
        csv += '2025-01-16,SM North,Closing,1:00 PM,10:00 PM,Yes,No,No,0,Yes,100,Closing shift with OT\n';
        csv += '2025-01-17,Pop-up,Midshift,11:00 AM,8:00 PM,No,Yes,No,0,Yes,100,Event day with double pay\n';
        csv += '2025-01-18,,,,,No,No,No,0,No,0,\n'; // Empty row to show format
        
        // Create download link
        const filename = `${employeeName.replace(/[^a-zA-Z0-9]/g, '_')}_Payroll_Template.csv`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        console.log(`Template downloaded for ${employeeName}`);
    } catch (error) {
        console.error("Error downloading template:", error);
        alert("Failed to download template. Please try again.");
    }
}

// Import person's payroll from CSV
async function importPersonPayroll(employeeId, file, overwrite = false) {
    try {
        showLoading('Importing payroll data...');
        
        const text = await file.text();
        console.log('Raw CSV text:', text.substring(0, 500) + '...'); // Debug first 500 chars
        
        const rows = text.split('\n').map(row => row.split(',').map(cell => cell.trim().replace(/^"|"$/g, '')));
        console.log('Parsed rows:', rows.slice(0, 3)); // Debug first 3 rows
        
        // Skip header row
        const dataRows = rows.slice(1);
        console.log('Data rows count:', dataRows.length);
        
        let importedCount = 0;
        let skippedCount = 0;
        let errors = [];
        
        // Process each row
        for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            console.log(`Row ${i + 1} has ${row.length} columns:`, row);
            
            if (row.length < 5 || !row[0]) {
                console.log(`Skipping row ${i + 1}: insufficient columns or empty date`);
                continue;
            }
            
            // Show progress every 10 rows
            if (i % 10 === 0) {
                showLoading(`Importing payroll data... ${i}/${dataRows.length} rows processed`);
            }
            
            // Parse all columns including the new fields - handle variable column counts
            const dateStr = row[0] || '';
            const branch = row[1] || '';
            const shift = row[2] || '';
            const timeIn = row[3] || '';
            const timeOut = row[4] || '';
            const otPay = row[5] || '';
            const doublePay = row[6] || '';
            const fixedPay = row[7] || '';
            const fixedAmount = row[8] || '';
            const mealAllowance = row[9] || '';
            const transpoAllowance = row[10] || '';
            const notes = row[11] || '';
            
            console.log(`Processing row ${i + 1}:`, { dateStr, branch, shift, timeIn, timeOut, otPay, doublePay, fixedPay, fixedAmount, mealAllowance, transpoAllowance, notes });
            
            // Validate date
            const dateObj = new Date(dateStr);
            if (isNaN(dateObj.getTime())) {
                errors.push(`Invalid date: ${dateStr}`);
                continue;
            }
            
            // Validate time format (HH:MM AM/PM or HH:MM) - only if time is provided
            const timeRegex = /^(\d{1,2}):(\d{2})\s?(AM|PM)?$/i;
            if (timeIn && !timeRegex.test(timeIn)) {
                errors.push(`Invalid time format for Time In: ${timeIn} (use HH:MM AM/PM format)`);
                continue;
            }
            if (timeOut && !timeRegex.test(timeOut)) {
                errors.push(`Invalid time format for Time Out: ${timeOut} (use HH:MM AM/PM format)`);
                continue;
            }
            
            // Validate shift (optional but if provided, should be valid)
            if (shift && !['Opening', 'Opening Half-Day', 'Midshift', 'Closing', 'Closing Half-Day', 'Custom'].includes(shift)) {
                console.warn(`Unknown shift type: ${shift}, using Custom`);
                shift = 'Custom';
            }
            
            // Check if data already exists for this date
            const existingData = attendanceData[employeeId]?.dates?.find(d => d.date === dateStr);
            if (existingData && !overwrite) {
                skippedCount++;
                continue;
            }
            
            // Prepare data for Firebase
            const firebaseData = {
                clockIn: {
                    time: timeIn || null,
                    branch: branch || 'N/A',
                    shift: shift || 'Custom'
                },
                clockOut: {
                    time: timeOut || null
                }
            };
            
            // Parse boolean fields
            firebaseData.hasOTPay = otPay && otPay.toLowerCase() === 'yes';
            firebaseData.hasDoublePay = doublePay && doublePay.toLowerCase() === 'yes';
            firebaseData.hasFixedPay = fixedPay && fixedPay.toLowerCase() === 'yes';
            firebaseData.hasMealAllowance = mealAllowance && mealAllowance.toLowerCase() === 'yes';
            
            // Parse numeric fields
            if (fixedAmount && !isNaN(parseFloat(fixedAmount))) {
                firebaseData.fixedPayAmount = parseFloat(fixedAmount);
            }
            if (transpoAllowance && !isNaN(parseFloat(transpoAllowance))) {
                firebaseData.transpoAllowance = parseFloat(transpoAllowance);
            }
            
            // Save data even if no time is provided (for updating other fields like OT, allowances, etc.)
            // This allows importing just the configuration without time data
            
            // Add notes if provided
            if (notes) {
                firebaseData.notes = notes;
            }
            
            // Save to Firebase
            const docRef = doc(db, "attendance", employeeId, "dates", dateStr);
            await setDoc(docRef, firebaseData, { merge: true });
            
            console.log(`Successfully saved data for ${dateStr}:`, firebaseData);
            importedCount++;
        }
        
        // Refresh data
        await loadData();
        
        // Show results
        let message = `Import completed!\n\nImported: ${importedCount} records`;
        if (skippedCount > 0) {
            message += `\nSkipped: ${skippedCount} records (already exist)`;
        }
        if (errors.length > 0) {
            message += `\nErrors: ${errors.length}`;
            console.error('Import errors:', errors);
        }
        
        if (importedCount > 0) {
            message += `\n\nData has been saved to Firebase and the view will refresh automatically.`;
        } else {
            message += `\n\nNo records were imported. Check the console for debugging information.`;
        }
        
        console.log('Import summary:', { importedCount, skippedCount, errors: errors.length, totalRows: dataRows.length });
        alert(message);
        
    } catch (error) {
        console.error("Error importing payroll:", error);
        throw new Error('Failed to import payroll data: ' + error.message);
    } finally {
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
    console.log('updateViewMode called, currentEmployeeView:', currentEmployeeView);
    
    // Prevent multiple simultaneous executions
    if (isUpdateViewModeRunning) {
        console.log('updateViewMode already running, skipping...');
        return;
    }
    
    // Debounce multiple rapid calls
    if (updateViewModeTimeout) {
        clearTimeout(updateViewModeTimeout);
    }
    
    updateViewModeTimeout = setTimeout(() => {
        console.log('updateViewMode timeout fired, calling updateViewModeImpl');
        updateViewModeImpl();
    }, 100);
}

function updateViewModeImpl() {
    isUpdateViewModeRunning = true;
    console.log('updateViewModeImpl called, currentEmployeeView:', currentEmployeeView);
    console.log('isUpdateViewModeRunning set to true');
    const container = document.querySelector('.container');

    // Get the table container and employee table elements
    const tableContainer = document.querySelector('.data-table-container');
    const employeeTable = document.getElementById('employeeTable');

    if (currentEmployeeView) {
        console.log('Single employee view logic reached');
        // Single employee view - restructure the page
        const employeeName = employees[currentEmployeeView] || 'Employee';
        const employee = filteredData[currentEmployeeView];
        console.log('Employee data found:', employee);

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
            // Return to main view
            currentEmployeeView = null;
            updateURLHash(null);
            updateViewMode(); // This will properly switch back to main view
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

        // Remove any existing action buttons first to prevent duplication
        const existingActionButtons = document.querySelectorAll('.edit-btn');
        existingActionButtons.forEach(btn => btn.remove());

        // Create a container for all action buttons to prevent duplication
        const actionButtonsContainer = document.createElement('div');
        actionButtonsContainer.className = 'employee-action-buttons';
        actionButtonsContainer.style.cssText = 'margin: 1rem 0; display: flex; gap: 0.5rem; flex-wrap: wrap;';

        // Add all buttons to the container
        actionButtonsContainer.appendChild(editBtn);
        actionButtonsContainer.appendChild(batchEditBtn);
        actionButtonsContainer.appendChild(addShiftBtn);
        actionButtonsContainer.appendChild(paymentBtn);

        // Add the container after the heading
        employeeNameHeading.insertAdjacentElement('afterend', actionButtonsContainer);

        // Add import/export buttons for payroll data
        const importExportContainer = document.createElement('div');
        importExportContainer.className = 'import-export-container';
        importExportContainer.style.cssText = 'margin: 1rem 0; display: flex; gap: 0.5rem; flex-wrap: wrap;';

        // Export current person's payroll button
        const exportPersonBtn = document.createElement('button');
        exportPersonBtn.className = 'edit-btn export-person-btn';
        exportPersonBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7,10 12,15 17,10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Export Payroll
        `;
        exportPersonBtn.addEventListener('click', () => exportPersonPayroll(currentEmployeeView));

        // Import payroll button
        const importPersonBtn = document.createElement('button');
        importPersonBtn.className = 'edit-btn import-person-btn';
        importPersonBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17,8 12,3 7,8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Import Payroll
        `;
        importPersonBtn.addEventListener('click', () => openImportPayrollModal(currentEmployeeView));

        // Add buttons to container
        importExportContainer.appendChild(exportPersonBtn);
        importExportContainer.appendChild(importPersonBtn);

        // Add the import/export container after the action buttons
        actionButtonsContainer.insertAdjacentElement('afterend', importExportContainer);

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
            totalPayCard.textContent = `₱${payCalculator.calculateTotalPay(employee.dates, employee, 'simple').toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;    
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
            console.log('About to call loadEmployeeDetailsAsMainTable for:', currentEmployeeView);
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

        // Remove the action buttons container if it exists
        const actionButtonsContainer = document.querySelector('.employee-action-buttons');
        if (actionButtonsContainer) {
            actionButtonsContainer.remove();
        }

        // Remove the import/export container if it exists
        const importExportContainer = document.querySelector('.import-export-container');
        if (importExportContainer) {
            importExportContainer.remove();
        }

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
    
    // Reset the running flag
    isUpdateViewModeRunning = false;
    console.log('updateViewModeImpl completed, isUpdateViewModeRunning set to false');
}

async function loadEmployeeDetailsAsMainTable(employeeId, container, preloadedData = null) {
    try {
        let dates = [];
        
        // Use preloaded data if available (fast path)
        if (preloadedData && preloadedData.dates) {
            console.log("Using preloaded data for fast display");
            dates = preloadedData.dates;
        } else {
            // Fallback to original Firebase query (slow path)
            console.log("No preloaded data, fetching from Firebase");
            const period = periodSelect.value;
            const branch = branchSelect.value;
            const { startDate, endDate } = getPeriodDates(period);
            const formattedStartDate = formatDate(startDate);
            const formattedEndDate = formatDate(endDate);

            console.log("Period range:", formatDate(startDate), "to", formatDate(endDate));

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
                    transpoAllowance: dateData.transpoAllowance || 0,
                    hasFixedPay: dateData.hasFixedPay || false,
                    fixedPayAmount: dateData.fixedPayAmount || 0,
                    hasDoublePay: dateData.hasDoublePay || false,
                    hasMealAllowance: dateData.hasMealAllowance !== false // Default to true
                });
                }
            }
        });
        } // Close the else block

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
                payCalculator.calculateSalesBonus(date.date, employeeData) : 0;

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
                    (payCalculator.compareTimes(date.timeIn, date.scheduledIn) > 0 ?
                        (payCalculator.compareTimes(date.timeIn, date.scheduledIn) / 60).toFixed(1) :
                        '0.0') :
                    'N/A'}
            </td>
            ${showSalesBonus ? `<td>₱${dailySalesBonus.toFixed(2)}</td>` : ''}
            <td>₱${date.timeIn && date.timeOut ?
                    payCalculator.calculateDailyPay(date, employeeData, 'simple').toFixed(2) :
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
                        <button class="action-btn duplicate-shift-btn" data-date="${date.date}" data-employee="${employeeId}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                        </svg>
                        Duplicate
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

        // Add event listeners for duplicate shift buttons
        container.querySelectorAll('.duplicate-shift-btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const dateStr = this.dataset.date;
                const employeeId = this.dataset.employee;
                duplicateShift(employeeId, dateStr);
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

    // Use PayCalculator for breakdown
    const employeeData = {
        baseRate: employee.baseRate || 0,
        salesBonusEligible: employee.salesBonusEligible || false
    };

    // Clean the dateEntry to remove seconds from times
    const cleanDateObj = { ...dateEntry };
    if (cleanDateObj.timeIn) {
        cleanDateObj.timeIn = removeSecondsFromTime(cleanDateObj.timeIn);
    }
    if (cleanDateObj.timeOut) {
        cleanDateObj.timeOut = removeSecondsFromTime(cleanDateObj.timeOut);
    }
    if (cleanDateObj.scheduledIn) {
        cleanDateObj.scheduledIn = removeSecondsFromTime(cleanDateObj.scheduledIn);
    }
    if (cleanDateObj.scheduledOut) {
        cleanDateObj.scheduledOut = removeSecondsFromTime(cleanDateObj.scheduledOut);
    }

    const result = payCalculator.calculateDailyPay(cleanDateObj, employeeData, 'detailed');

    let breakdownHTML = `
    <div class="pay-breakdown">
        <h4>Pay Breakdown for ${formatReadableDate(dateStr)}</h4>
        <table class="breakdown-table">
            <tr>
                <td><strong>Pay Type:</strong></td>
                <td><strong>${result.breakdown.payType}</strong></td>
            </tr>`;

    // Add each component with admin-specific formatting
    if (result.breakdown && result.breakdown.components) {
        result.breakdown.components.forEach(component => {
            const label = formatComponentLabel(component);
            const colorClass = component.isPositive === false ? 'negative-amount' : 'positive-amount';
            const displayAmount = component.isPositive === false ?
                `-₱${component.amount.toFixed(2)}` :
                `₱${component.amount.toFixed(2)}`;

            breakdownHTML += `
                <tr>
                    <td>${label}</td>
                    <td class="${colorClass}">${displayAmount}</td>
                </tr>`;
        });
    }

    // Total row
    breakdownHTML += `
            <tr class="total-row">
                <td><strong>Total Pay</strong></td>
                <td><strong>₱${result.total.toFixed(2)}</strong></td>
            </tr>
        </table>`;

    // Sales Bonus Details (if applicable)
    if (employee.salesBonusEligible) {
        const salesData = window.salesDataCache[dateStr];
        if (salesData) {
            const totalSales = salesData.totalSales ||
                ((salesData.cash || 0) + (salesData.gcash || 0) + (salesData.maya || 0) +
                    (salesData.card || 0) + (salesData.grab || 0));
            const date = new Date(dateStr);
            const staffCount = payCalculator.getStaffingLevel(date, attendanceData);
            const quota = payCalculator.getQuotaForStaffing(staffCount);
            const salesBonus = payCalculator.calculateSalesBonusAmount(totalSales, quota);

            breakdownHTML += `
            <div style="margin-top: 1.5rem;">
                <h4>Sales Bonus Details</h4>
                <table class="breakdown-table">
                    <tr>
                        <td>Daily Sales</td>
                        <td>₱${totalSales.toLocaleString()}</td>
                    </tr>
                    <tr>
                        <td>Staff Count</td>
                        <td>${staffCount}</td>
                    </tr>
                    <tr>
                        <td>Sales Quota</td>
                        <td>₱${quota.toLocaleString()}</td>
                    </tr>
                    <tr>
                        <td>Bonus Earned</td>
                        <td>₱${salesBonus.toFixed(2)}</td>
                    </tr>
                </table>
            </div>`;
        }
    }

    // Overtime Details (if applicable)
    if (dateEntry.hasOTPay) {
        const totalHours = payCalculator.calculateHours(cleanDateObj.timeIn, cleanDateObj.timeOut);
        if (totalHours) {
            const otCalculation = payCalculator.calculateOvertimePay(cleanDateObj, employeeData.baseRate);
            if (otCalculation.otPay > 0) {
                breakdownHTML += `
                <div style="margin-top: 1.5rem;">
                    <h4>Overtime Details</h4>
                    <table class="breakdown-table">
                        <tr>
                            <td>Total Hours Worked</td>
                            <td>${totalHours.toFixed(1)} hrs</td>
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
                </div>`;
            }
        }
    }

    breakdownHTML += '</div>';

    detailRow.querySelector('.detail-content').innerHTML = breakdownHTML;
    detailRow.dataset.loaded = 'true';
}

// Add this new function to handle component label formatting
function formatComponentLabel(component) {
    const { type, metadata } = component;

    switch (type) {
        case 'base_rate':
            return `Base Rate${metadata.isHalfDay ? ' (Half Day)' : ''}`;

        case 'base_pay':
            return `Base Pay (${metadata.hours.toFixed(1)} hrs)`;

        case 'fixed_pay':
            return 'Fixed Pay Amount';

        case 'double_pay_bonus':
            return `Double Pay Bonus (${metadata.bonusMultiplier}x)`;

        case 'holiday_bonus':
            return `Holiday Bonus (${metadata.bonusMultiplier}x)`;

        case 'meal_allowance':
            if (metadata.isHalfDay) {
                return 'Meal Allowance (Half Day)';
            } else if (metadata.isCustomShift) {
                return 'Meal Allowance';
            } else {
                return 'Meal Allowance';
            }

        case 'late_deduction':
            if (metadata.multiplier > 1.0) {
                return `Late Deduction (${metadata.hours.toFixed(1)} hrs at ${metadata.multiplier}x rate)`;
            } else {
                return `Late Deduction (${metadata.hours.toFixed(1)} hrs)`;
            }

        case 'undertime_deduction':
            if (metadata.multiplier > 1.0) {
                return `Undertime Deduction (${metadata.hours.toFixed(1)} hrs at ${metadata.multiplier}x rate)`;
            } else {
                return `Undertime Deduction (${metadata.hours.toFixed(1)} hrs)`;
            }

        case 'overtime_pay':
            return `Overtime Pay (${metadata.hours.toFixed(1)} hrs)`;

        case 'transportation_allowance':
            return 'Transportation Allowance';

        case 'sales_bonus':
            return 'Sales Bonus';

        default:
            return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
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
            // console.log(`Checking employee: ${employees[employeeId]}`);

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
                    const lateMinutes = payCalculator.compareTimes(date.timeIn, date.scheduledIn);
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
        
        showToast('Attendance entry deleted successfully');
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
            const totalPay = payCalculator.calculateTotalPay(attendanceData[employeeId].dates, attendanceData[employeeId], 'simple');
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
    // Show current live rate, not cached period rate
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

    // Add period context to base rate field
    const baseRateLabel = document.querySelector('label[for="editBaseRate"]');
    const periodText = periodSelect.options[periodSelect.selectedIndex].text;
    if (baseRateLabel) {
        baseRateLabel.textContent = `Base Rate (applies to ${periodText} and future periods)`;
    }
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
        // Only update base rate for current period if we're in the current period
        const today = new Date();
        const { endDate } = getPeriodDates(periodSelect.value);
        if (today <= endDate) {
            // Current period - update the rate
            attendanceData[employeeId].baseRate = newBaseRate;
        } else {
            // Historical period - don't change cached rate
            console.log('Base rate change will apply to future periods only');
        }

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
            const totalPay = payCalculator.calculateTotalPay(attendanceData[employeeId].dates, attendanceData[employeeId], 'simple');
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
        
        // If rate changed, invalidate current period cache to pick up new rate
        if (employee.baseRate !== newBaseRate) {
            const today = new Date();
            const { endDate } = getPeriodDates(periodSelect.value);
            if (today <= endDate) {
                // Clear current period cache so it picks up new rate
                const currentCacheKey = getCacheKey(periodSelect.value, branchSelect.value);
                localStorage.removeItem(currentCacheKey);

                // Trigger a data reload
                await loadData();
            }
        }

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
    // Get DOM elements
    const editShiftBranch = document.getElementById('editShiftBranch');
    const editShiftSchedule = document.getElementById('editShiftSchedule');
    const editShiftTimeIn = document.getElementById('editShiftTimeIn');
    const editShiftTimeOut = document.getElementById('editShiftTimeOut');
    const editTranspoAllowance = document.getElementById('editTranspoAllowance');
    const editOTPay = document.getElementById('editOTPay');
    const editShiftEmployeeId = document.getElementById('editShiftEmployeeId');
    const editShiftDate = document.getElementById('editShiftDate');
    const editShiftFixedPay = document.getElementById('editShiftFixedPay');
    const editShiftDoublePay = document.getElementById('editShiftDoublePay');
    const editShiftFixedAmount = document.getElementById('editShiftFixedAmount');
    const editShiftFixedAmountGroup = document.getElementById('editShiftFixedAmountGroup');
    const editMealAllowance = document.getElementById('editMealAllowance');

    // Find the date entry in the data
    const employee = filteredData[employeeId];
    const dateEntry = employee.dates.find(d => d.date === dateStr);

    if (dateEntry) {
        editShiftBranch.value = dateEntry.branch || 'Podium';
        editShiftSchedule.value = dateEntry.shift || 'Opening';
        editShiftTimeIn.value = convertTo24HourFormat(dateEntry.timeIn) || '';
        editShiftTimeOut.value = convertTo24HourFormat(dateEntry.timeOut) || '';
        editTranspoAllowance.value = dateEntry.transpoAllowance || 0;
        editOTPay.checked = dateEntry.hasOTPay || false;

        // Set pay options
        editShiftFixedPay.checked = dateEntry.hasFixedPay || false;
        editShiftDoublePay.checked = dateEntry.hasDoublePay || false;
        editShiftFixedAmount.value = dateEntry.fixedPayAmount || '';

        // Set meal allowance (default to true if not specified)
        editMealAllowance.checked = dateEntry.hasMealAllowance !== false;

        // Show/hide fixed amount field
        if (editShiftFixedPay.checked) {
            editShiftFixedAmountGroup.style.display = 'block';
            editShiftFixedAmount.required = true;
        } else {
            editShiftFixedAmountGroup.style.display = 'none';
            editShiftFixedAmount.required = false;
        }
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

// Function to update time placeholders based on selected schedule
function updateTimePlaceholders() {
    console.log('updateTimePlaceholders called');
    const selectedSchedule = addShiftSchedule.value;
    console.log('Selected schedule:', selectedSchedule);
    const schedule = SHIFT_SCHEDULES[selectedSchedule];
    console.log('Schedule object:', schedule);
    
    if (schedule) {
        // Convert 12-hour format to 24-hour format for input placeholders
        const timeIn24 = convert12To24Hour(schedule.timeIn);
        const timeOut24 = convert12To24Hour(schedule.timeOut);
        console.log('Time In 24h:', timeIn24, 'Time Out 24h:', timeOut24);
        
        addShiftTimeIn.placeholder = timeIn24;
        addShiftTimeOut.placeholder = timeOut24;
        
        console.log('Placeholders updated - Time In:', addShiftTimeIn.placeholder, 'Time Out:', addShiftTimeOut.placeholder);
    } else {
        console.log('No schedule found for:', selectedSchedule);
    }
}

// Helper function to convert 12-hour format to 24-hour format
function convert12To24Hour(time12) {
    console.log('convert12To24Hour called with:', time12);
    if (!time12) {
        console.log('No time provided, returning empty string');
        return '';
    }
    
    const [time, meridian] = time12.split(' ');
    console.log('Split time:', time, 'meridian:', meridian);
    let [hours, minutes] = time.split(':').map(Number);
    console.log('Hours:', hours, 'Minutes:', minutes);
    
    if (meridian === 'PM' && hours !== 12) hours += 12;
    if (meridian === 'AM' && hours === 12) hours = 0;
    
    const result = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    console.log('Converted result:', result);
    return result;
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
        showToast('Employee ID already exists. Please use a different ID.', 'error');
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

        showToast('Employee added successfully!');
    } catch (error) {
        console.error("Error adding employee:", error);
        showToast("Failed to add employee. Please try again.", 'error');
    }
}

async function saveShiftChanges(e) {
    e.preventDefault();

    const employeeId = document.getElementById('editShiftEmployeeId').value;
    const dateStr = document.getElementById('editShiftDate').value;
    const newBranch = document.getElementById('editShiftBranch').value;
    const newShift = document.getElementById('editShiftSchedule').value;
    const newTimeIn = document.getElementById('editShiftTimeIn').value ? convertTo12HourFormat(document.getElementById('editShiftTimeIn').value) : null;
    const newTimeOut = document.getElementById('editShiftTimeOut').value ? convertTo12HourFormat(document.getElementById('editShiftTimeOut').value) : null;
    const newTranspoAllowance = parseFloat(document.getElementById('editTranspoAllowance').value) || 0;
    const newHasOTPay = document.getElementById('editOTPay').checked;
    const newHasFixedPay = document.getElementById('editShiftFixedPay').checked;
    const newHasDoublePay = document.getElementById('editShiftDoublePay').checked;
    const newFixedPayAmount = newHasFixedPay ? (parseFloat(document.getElementById('editShiftFixedAmount').value) || 0) : 0;
    const newHasMealAllowance = document.getElementById('editMealAllowance').checked;

    try {
        // Build update object
        const updateData = {
            'clockIn.branch': newBranch,
            'clockIn.shift': newShift,
            'transpoAllowance': newTranspoAllowance,
            'hasOTPay': newHasOTPay,
            'hasFixedPay': newHasFixedPay,
            'fixedPayAmount': newFixedPayAmount,
            'hasDoublePay': newHasDoublePay,
            'hasMealAllowance': newHasMealAllowance
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
            dateEntry.hasFixedPay = newHasFixedPay;
            dateEntry.fixedPayAmount = newFixedPayAmount;
            dateEntry.hasDoublePay = newHasDoublePay;
            dateEntry.hasMealAllowance = newHasMealAllowance;

            if (newTimeIn) dateEntry.timeIn = newTimeIn;
            if (newTimeOut) dateEntry.timeOut = newTimeOut;

            const shiftSchedule = SHIFT_SCHEDULES[newShift] || SHIFT_SCHEDULES["Custom"];
            dateEntry.scheduledIn = shiftSchedule.timeIn;
            dateEntry.scheduledOut = shiftSchedule.timeOut;
        }

        // Also update filteredData to ensure UI reflects changes immediately
        const filteredEmployee = filteredData[employeeId];
        if (filteredEmployee) {
            const filteredDateEntry = filteredEmployee.dates.find(d => d.date === dateStr);
            if (filteredDateEntry) {
                filteredDateEntry.branch = newBranch;
                filteredDateEntry.shift = newShift;
                filteredDateEntry.transpoAllowance = newTranspoAllowance;
                filteredDateEntry.hasOTPay = newHasOTPay;
                filteredDateEntry.hasFixedPay = newHasFixedPay;
                filteredDateEntry.fixedPayAmount = newFixedPayAmount;
                filteredDateEntry.hasDoublePay = newHasDoublePay;
                filteredDateEntry.hasMealAllowance = newHasMealAllowance;

                if (newTimeIn) filteredDateEntry.timeIn = newTimeIn;
                if (newTimeOut) filteredDateEntry.timeOut = newTimeOut;

                const shiftSchedule = SHIFT_SCHEDULES[newShift] || SHIFT_SCHEDULES["Custom"];
                filteredDateEntry.scheduledIn = shiftSchedule.timeIn;
                filteredDateEntry.scheduledOut = shiftSchedule.timeOut;
            }
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
                container.innerHTML = '<div class="spinner"></div>';
                await loadEmployeeDetailsAsMainTable(employeeId, container);
            }
        }

        closeShiftEditModal();
        showToast('Shift details updated successfully');
    } catch (error) {
        console.error('Error updating shift:', error);
        showToast('Failed to update shift details. Please try again.', 'error');
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
        showToast('Please select at least one field to update.', 'error');
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
        showToast(`Successfully updated ${updates.length} records`);
    } catch (error) {
        console.error('Error in batch update:', error);
        showToast('Failed to update records. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Add this to your DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async function () {
    // Existing setup code...

    // Set up background refresh after initial load
    setupBackgroundRefresh();
    
    // Restore employee view from URL hash if present
    restoreEmployeeView();
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

    // Fixed pay checkbox handler
    document.getElementById('editShiftFixedPay').addEventListener('change', function () {
        const fixedAmountGroup = document.getElementById('editShiftFixedAmountGroup');
        const fixedAmountInput = document.getElementById('editShiftFixedAmount');
        const doublePayCheckbox = document.getElementById('editShiftDoublePay');

        if (this.checked) {
            fixedAmountGroup.style.display = 'block';
            fixedAmountInput.required = true;
            // Uncheck double pay if fixed pay is selected
            doublePayCheckbox.checked = false;
        } else {
            fixedAmountGroup.style.display = 'none';
            fixedAmountInput.required = false;
            fixedAmountInput.value = '';
        }
    });

    // Double pay checkbox handler
    document.getElementById('editShiftDoublePay').addEventListener('change', function () {
        const fixedPayCheckbox = document.getElementById('editShiftFixedPay');
        const fixedAmountGroup = document.getElementById('editShiftFixedAmountGroup');
        const fixedAmountInput = document.getElementById('editShiftFixedAmount');

        if (this.checked) {
            // Uncheck fixed pay if double pay is selected
            fixedPayCheckbox.checked = false;
            fixedAmountGroup.style.display = 'none';
            fixedAmountInput.required = false;
            fixedAmountInput.value = '';
        }
    });

    branchSelect.addEventListener('change', function () {
        localStorage.removeItem('last_selected_branch');
        localStorage.setItem('last_selected_branch', this.value);
        filterData();
    });

    refreshBtn.addEventListener('click', function () {
        clearAllPeriodCaches();
        clearSingleUserCaches(); // Also clear single user caches
        refreshBtn.dataset.forceRefresh = 'true';
        
        // If we're in single employee view, use fast loading
        if (currentEmployeeView) {
            console.log('🔄 Refresh in single employee view, using fast loading for:', currentEmployeeView);
            const container = document.getElementById('employee-details-table');
            if (container) {
                container.innerHTML = '<div class="spinner"></div>';
                loadSingleEmployeeData(currentEmployeeView).then(employeeData => {
                    loadEmployeeDetailsAsMainTable(currentEmployeeView, container, employeeData);
                }).catch(error => {
                    console.error("Error refreshing single employee:", error);
                    container.innerHTML = '<div class="error">Error refreshing employee data</div>';
                });
            }
        } else {
            // Main view - load all employees
            console.log('🔄 Refresh in main view, loading all employees');
            loadData();
        }
    });
    
    exportBtn.addEventListener('click', exportToCSV);
    document.getElementById('exportPayrollBtn').addEventListener('click', exportPayrollCSV); // Add this line

    // Holiday modal event listeners
    closeHolidaysModal.addEventListener('click', closeHolidaysModalFunc);
    closeHolidaysBtn.addEventListener('click', closeHolidaysModalFunc);
    addHolidayForm.addEventListener('submit', saveNewHoliday);

    // Add event listener for fixed pay checkbox
    editShiftFixedPay.addEventListener('change', function () {
        if (this.checked) {
            editShiftFixedAmountGroup.style.display = 'block';
            editShiftFixedAmount.required = true;
        } else {
            editShiftFixedAmountGroup.style.display = 'none';
            editShiftFixedAmount.required = false;
            editShiftFixedAmount.value = '';
        }
    });

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
    
    // After initial load, restore employee view from URL hash if present
    // This is now handled in loadData() after data is fully loaded

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

        showToast(`Holiday "${name}" added successfully`);
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

        showToast(`Holiday "${holiday.name}" deleted successfully`);
        console.log(`Holiday deleted: ${dateStr}`);
    } catch (error) {
        console.error('Error deleting holiday:', error);
        alert('Failed to delete holiday. Please try again.');
    }
}

// Open add shift modal
function openAddShiftModal(employeeId) {
    addShiftEmployeeId.value = employeeId;

    // Set date picker limits to current payroll period
    const { startDate, endDate } = getPeriodDates(periodSelect.value);
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    addShiftDate.setAttribute('min', startDateStr);
    addShiftDate.setAttribute('max', endDateStr);

    // Find the next available date after the most recent entry
    let nextAvailableDate = startDate;
    
    if (attendanceData[employeeId] && attendanceData[employeeId].dates && attendanceData[employeeId].dates.length > 0) {
        // Get the most recent date in the current period
        const currentPeriodDates = attendanceData[employeeId].dates.filter(d => {
            const entryDate = new Date(d.date);
            return entryDate >= startDate && entryDate <= endDate;
        });
        
        if (currentPeriodDates.length > 0) {
            // Sort by date and get the latest one
            currentPeriodDates.sort((a, b) => new Date(b.date) - new Date(a.date));
            const mostRecentDate = new Date(currentPeriodDates[0].date);
            
            // Calculate next day
            const nextDay = new Date(mostRecentDate);
            nextDay.setDate(mostRecentDate.getDate() + 1);
            
            // Make sure it's within the payroll period
            if (nextDay >= startDate && nextDay <= endDate) {
                nextAvailableDate = nextDay;
            }
        }
    }

    // Set default values
    addShiftDate.value = formatDate(nextAvailableDate);
    addShiftBranch.value = 'Podium';
    addShiftSchedule.value = 'Opening';
    addShiftTimeIn.value = '09:30';
    addShiftTimeOut.value = '18:30';
    
    // Set default values for new fields
    addShiftDoublePay.checked = false;
    addShiftFixedPay.checked = false;
    addShiftFixedAmount.value = '';
    addShiftFixedAmountGroup.style.display = 'none';
    addShiftMealAllowance.checked = true;
    addShiftTranspoAllowance.value = '0';
    addShiftOTPay.checked = false;

    // Update time placeholders based on selected schedule
    updateTimePlaceholders();

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
    const hasDoublePay = addShiftDoublePay.checked;
    const hasFixedPay = addShiftFixedPay.checked;
    const fixedPayAmount = hasFixedPay ? parseFloat(addShiftFixedAmount.value) || 0 : 0;
    const hasMealAllowance = addShiftMealAllowance.checked;
    const transpoAllowance = parseFloat(addShiftTranspoAllowance.value) || 0;
    const hasOTPay = addShiftOTPay.checked;

    if (!dateStr || !timeIn || !timeOut) {
        showToast('Please fill in all required fields.', 'error');
        return;
    }
    
    if (hasFixedPay && fixedPayAmount <= 0) {
        showToast('Please enter a valid fixed pay amount.', 'error');
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
            },
            hasDoublePay: hasDoublePay,
            hasFixedPay: hasFixedPay,
            fixedPayAmount: fixedPayAmount,
            hasMealAllowance: hasMealAllowance,
            transpoAllowance: transpoAllowance,
            hasOTPay: hasOTPay
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
            timeOutPhoto: null,
            hasDoublePay: hasDoublePay,
            hasFixedPay: hasFixedPay,
            fixedPayAmount: fixedPayAmount,
            hasMealAllowance: hasMealAllowance,
            transpoAllowance: transpoAllowance,
            hasOTPay: hasOTPay
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
        showToast('Shift added successfully!');

    } catch (error) {
        console.error('Error adding shift:', error);
        showToast('Failed to add shift. Please try again.', 'error');
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
    document.getElementById('paymentMethod').value = 'gotyme'; // Set default to gotyme
    
    // Calculate total pay for this employee
    const employeeData = filteredData[employeeId];
    const totalPay = employeeData ? payCalculator.calculateTotalPay(employeeData.dates, employeeData, 'simple') : 0;
    document.getElementById('paymentAmount').value = totalPay.toFixed(2);
    document.getElementById('paymentAmountHint').textContent = 'Enter amount to pay (full or partial)';

    // Check if payment already exists
    try {
        const paymentRef = doc(db, "payment_confirmations", `${employeeId}_${periodId}`);
        const paymentSnap = await getDoc(paymentRef);

        if (paymentSnap.exists()) {
            const paymentData = paymentSnap.data();
            document.getElementById('paymentNote').value = paymentData.note || '';
            document.getElementById('paymentMethod').value = paymentData.transferMethod || '';
            
            // Handle existing payment fields - show remaining amount instead of paid amount
            if (paymentData.remainingAmount !== undefined) {
                document.getElementById('paymentAmount').value = paymentData.remainingAmount.toFixed(2);
            }

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
    const paymentAmount = parseFloat(document.getElementById('paymentAmount').value) || 0;

    if (!transferMethod) {
        showToast('Please select a transfer method', 'error');
        return;
    }

    if (paymentAmount <= 0) {
        showToast('Please enter a valid payment amount', 'error');
        return;
    }

    // Note: Screenshot and note are now optional - you can mark as paid without them

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

        // Calculate total pay for comparison
        const employeeData = filteredData[employeeId];
        const totalPay = employeeData ? payCalculator.calculateTotalPay(employeeData.dates, employeeData, 'simple') : 0;
        
        // Check for existing payment to accumulate payments
        let existingPaymentAmount = 0;
        try {
            const existingPaymentRef = doc(db, "payment_confirmations", `${employeeId}_${periodId}`);
            const existingPaymentDoc = await getDoc(existingPaymentRef);
            if (existingPaymentDoc.exists()) {
                existingPaymentAmount = existingPaymentDoc.data().paymentAmount || 0;
            }
        } catch (error) {
            console.log('No existing payment found, starting fresh');
        }
        
        // Calculate accumulated payment and remaining amount
        const accumulatedPaymentAmount = existingPaymentAmount + paymentAmount;
        const remainingAmount = totalPay - accumulatedPaymentAmount;
        const paymentType = accumulatedPaymentAmount >= totalPay ? 'full' : 'partial';

        // Save payment data to Firestore
        const paymentData = {
            employeeId: employeeId,
            periodId: periodId,
            screenshotUrl: downloadURL, // Will be null if no file uploaded
            transferMethod: transferMethod,
            note: note,
            paymentType: paymentType,
            paymentAmount: accumulatedPaymentAmount, // Store accumulated amount
            totalPay: totalPay,
            remainingAmount: remainingAmount,
            uploadedAt: new Date().toISOString(),
            uploadedBy: 'admin'
        };

        const paymentDocRef = doc(db, "payment_confirmations", `${employeeId}_${periodId}`);
        await setDoc(paymentDocRef, paymentData);

        const cacheKey = `payment_confirmations_${periodId}`;
        localStorage.removeItem(cacheKey);

        console.log('Payment confirmation saved successfully');
        hideLoading(); // Add this line
        showToast('Payment confirmation uploaded successfully!');   
        closePaymentModal();

        // Refresh payment status indicators and reload table
        await loadPaymentDataAndRender();

    } catch (error) {
        console.error('Error uploading payment confirmation:', error);
        hideLoading();
        showToast('Failed to upload payment confirmation. Please try again.', 'error');
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

// Payment amount field event listener to update hint
document.getElementById('paymentAmount').addEventListener('input', async function() {
    const employeeId = document.getElementById('paymentEmployeeId').value;
    const employeeData = filteredData[employeeId];
    const totalPay = employeeData ? payCalculator.calculateTotalPay(employeeData.dates, employeeData, 'simple') : 0;
    const newPaymentAmount = parseFloat(this.value) || 0;
    
    // Check for existing payment
    const periodId = periodSelect.value;
    let existingPaymentAmount = 0;
    try {
        const existingPaymentRef = doc(db, "payment_confirmations", `${employeeId}_${periodId}`);
        const existingPaymentDoc = await getDoc(existingPaymentRef);
        if (existingPaymentDoc.exists()) {
            existingPaymentAmount = existingPaymentDoc.data().paymentAmount || 0;
        }
    } catch (error) {
        // No existing payment
    }
    
    const accumulatedPaymentAmount = existingPaymentAmount + newPaymentAmount;
    const remainingAmount = totalPay - accumulatedPaymentAmount;
    
    if (accumulatedPaymentAmount >= totalPay) {
        document.getElementById('paymentAmountHint').textContent = 'Full payment';
    } else {
        document.getElementById('paymentAmountHint').textContent = `Partial payment (₱${remainingAmount.toFixed(2)} remaining)`;
    }
});

// URL hash management for employee view state
function updateURLHash(employeeId = null) {
    if (employeeId) {
        window.location.hash = `employee=${employeeId}`;
        console.log('URL hash updated to:', window.location.hash);
    } else {
        window.location.hash = '';
        console.log('URL hash cleared');
    }
}

function getEmployeeFromHash() {
    const hash = window.location.hash;
    const match = hash.match(/employee=([^&]+)/);
    return match ? match[1] : null;
}

function restoreEmployeeView() {
    console.log('restoreEmployeeView called');
    const employeeId = getEmployeeFromHash();
    console.log('Employee ID from hash:', employeeId);
    console.log('Current employees object:', employees);
    console.log('Current employee view:', currentEmployeeView);
    
    if (employeeId && employees[employeeId]) {
        console.log('Valid employee found, restoring view');
        // Check if we're already on the right view
        if (currentEmployeeView !== employeeId) {
            currentEmployeeView = employeeId;
            updateURLHash(employeeId);
            
            // Make sure we're in the right view mode first
            updateViewMode();
            
            // Then load the employee details using fast path
            const container = document.getElementById('employee-details-table');
            if (container) {
                container.innerHTML = '<div class="spinner"></div>';
                loadSingleEmployeeData(employeeId).then(employeeData => {
                    loadEmployeeDetailsAsMainTable(employeeId, container, employeeData);
                }).catch(error => {
                    console.error("Error restoring employee view:", error);
                    container.innerHTML = '<div class="error">Error loading employee data</div>';
                });
            } else {
                console.log('Employee details container not found, will retry after data load');
            }
        }
    } else if (currentEmployeeView) {
        console.log('No valid employee in hash, clearing view');
        // Clear the view if no valid employee in hash
        currentEmployeeView = null;
        updateURLHash(null);
        loadData();
    } else {
        console.log('No employee to restore, staying on main view');
    }
}

// Listen for hash changes (back/forward buttons)
window.addEventListener('hashchange', restoreEmployeeView);

// Duplicate shift function
async function duplicateShift(employeeId, dateStr) {
    try {
        // Get the original shift data
        const employee = filteredData[employeeId];
        const originalShift = employee.dates.find(d => d.date === dateStr);

        if (!originalShift) {
            alert('Shift not found. Please try again.');
            return;
        }

        // Calculate the next day
        const originalDate = new Date(dateStr);
        const nextDate = new Date(originalDate);
        nextDate.setDate(originalDate.getDate() + 1);
        
        // Format the next date
        const nextDateStr = formatDate(nextDate);

        // Check if shift already exists for the next day
        const existingShift = employee.dates.find(d => d.date === nextDateStr);
        if (existingShift) {
            if (!confirm(`A shift already exists for ${nextDateStr}. Do you want to overwrite it?`)) {
                return;
            }
        }

        // Create the duplicated shift data with the correct structure
        const shiftSchedule = SHIFT_SCHEDULES[originalShift.shift] || SHIFT_SCHEDULES["Custom"];
        const duplicatedShift = {
            date: nextDateStr,
            branch: originalShift.branch,
            shift: originalShift.shift,
            scheduledIn: shiftSchedule.timeIn,
            scheduledOut: shiftSchedule.timeOut,
            timeIn: originalShift.timeIn,
            timeOut: originalShift.timeOut,
            timeInPhoto: originalShift.timeInPhoto,
            timeOutPhoto: originalShift.timeOutPhoto,
            hasDoublePay: originalShift.hasDoublePay,
            hasFixedPay: originalShift.hasFixedPay,
            fixedPayAmount: originalShift.fixedPayAmount,
            hasMealAllowance: originalShift.hasMealAllowance,
            transpoAllowance: originalShift.transpoAllowance,
            hasOTPay: originalShift.hasOTPay
        };

        // Save to Firebase in the correct structure
        const firebaseData = {
            clockIn: {
                time: duplicatedShift.timeIn,
                branch: duplicatedShift.branch,
                shift: duplicatedShift.shift
            },
            clockOut: {
                time: duplicatedShift.timeOut
            },
            hasDoublePay: duplicatedShift.hasDoublePay,
            hasFixedPay: duplicatedShift.hasFixedPay,
            fixedPayAmount: duplicatedShift.fixedPayAmount,
            hasMealAllowance: duplicatedShift.hasMealAllowance,
            transpoAllowance: duplicatedShift.transpoAllowance,
            hasOTPay: duplicatedShift.hasOTPay
        };

        const docRef = doc(db, "attendance", employeeId, "dates", nextDateStr);
        await setDoc(docRef, firebaseData);

        // Update local data
        if (existingShift) {
            // Replace existing shift
            const index = employee.dates.findIndex(d => d.date === nextDateStr);
            employee.dates[index] = duplicatedShift;
        } else {
            // Add new shift
            employee.dates.push(duplicatedShift);
        }

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
                container.innerHTML = '<div class="spinner"></div>';
                await loadEmployeeDetailsAsMainTable(employeeId, container);
            }
        }

        showToast(`Shift duplicated successfully for ${nextDateStr}`);
    } catch (error) {
        console.error('Error duplicating shift:', error);
        alert('Failed to duplicate shift. Please try again.');
    }
}

// Add function to manually refresh payment status indicators
window.refreshPaymentStatus = async function() {
    const periodId = periodSelect.value;
    const cacheKey = `payment_confirmations_${periodId}`;
    localStorage.removeItem(cacheKey);
    await updateEmployeePaymentStatus(true);
    console.log('Payment status indicators refreshed!');
};

// Add function to force refresh payment status immediately
window.forceRefreshPaymentStatus = async function() {
    console.log('🔄 Force refreshing payment status indicators...');
    
    // Clear all payment caches
    const periodId = periodSelect.value;
    const cacheKey = `payment_confirmations_${periodId}`;
    localStorage.removeItem(cacheKey);
    
    // Force reload payment data and render
    await loadPaymentDataAndRender();
    
    console.log('✅ Payment status indicators force refreshed!');
};