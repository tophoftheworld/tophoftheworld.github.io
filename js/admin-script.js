// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc, setDoc, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

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

// Add these to your DOMContentLoaded event listener
closeEditModal.addEventListener('click', closeEditEmployeeModal);
cancelEditBtn.addEventListener('click', closeEditEmployeeModal);
employeeEditForm.addEventListener('submit', saveEmployeeChanges);

// Global data store
let attendanceData = {};
let filteredData = {};
let isInitialLoad = true;

// Cache utility functions
function getCacheKey(periodId, branchId) {
    try {
        console.log("Getting cache key for periodId:", periodId);
        const { startDate, endDate } = getPeriodDates(periodId);
        const formattedStartDate = formatDate(startDate);
        const formattedEndDate = formatDate(endDate);

        const key = `attendance_${formattedStartDate}_${formattedEndDate}_${branchId}`;
        console.log("Generated key:", key);
    } catch (e) {
        // If the period isn't initialized yet, use the ID directly as a fallback
        console.warn("Error generating cache key:", e);
        return `attendance_${periodId}_${branchId}`;
    }
}

function saveToCache(cacheKey, data) {
    const cacheData = {
        timestamp: Date.now(),
        version: '1.0',
        data: data
    };
    try {
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        console.log(`Data cached for ${cacheKey}`);
    } catch (e) {
        console.warn('Cache storage failed, likely quota exceeded', e);
        clearOldCaches();
    }
}

function getFromCache(periodId, branchId) {
    const cacheKey = getCacheKey(periodId, branchId);
    try {
        const cachedData = localStorage.getItem(cacheKey);
        if (!cachedData) return null;
        
        const parsedData = JSON.parse(cachedData);

        // Check if cache is expired (24 hours)
        const cacheAge = Date.now() - parsedData.timestamp;
        if (cacheAge > 24 * 60 * 60 * 1000) {
            console.log('Cache expired, removing');
            localStorage.removeItem(cacheKey);
            return null;
        }

        // Check version
        if (parsedData.version !== '1.0') {
            console.log('Cache version mismatch, removing');
            localStorage.removeItem(cacheKey);
            return null;
        }

        return parsedData.data;
    } catch (e) {
        console.warn('Error reading from cache', e);
        return null;
    }
}

function clearOldCaches() {
    // Remove oldest caches when storage is full
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('attendance_')) {
            keysToRemove.push(key);
        }
    }

    // Sort by age and remove oldest
    if (keysToRemove.length > 5) { // Keep only 5 most recent
        keysToRemove.sort((a, b) => {
            const dataA = JSON.parse(localStorage.getItem(a));
            const dataB = JSON.parse(localStorage.getItem(b));
            return dataA.timestamp - dataB.timestamp;
        });

        // Remove oldest caches
        keysToRemove.slice(0, keysToRemove.length - 5).forEach(key => {
            localStorage.removeItem(key);
            console.log(`Removed old cache: ${key}`);
        });
    }
}

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', async function() {
    // Setup event listeners
    closeModal.addEventListener('click', closePhotoModal);
    periodSelect.addEventListener('change', async function () {
        attendanceData = {};

        localStorage.removeItem(getCacheKey(this.value, branchSelect.value));
        await loadData();
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

// Load attendance data from Firestore or mock data
// Update the loadData function to only fetch minimal data initially
async function loadData() {
    showLoading();

    const periodId = periodSelect.value;
    const branchId = branchSelect.value;

    console.log("Loading data for:", periodId, branchId);

    const cacheKey = getCacheKey(periodId, branchId);
    console.log("Checking cache with key:", cacheKey);

    // Check for cached data
    if (!isInitialLoad && refreshBtn.dataset.forceRefresh !== 'true') {
        const cachedData = getFromCache(periodId, branchId);
        console.log("Cache check result:", cachedData ? "Found in cache" : "Not in cache");
        if (cachedData) {
            console.log('Using cached data');
            attendanceData = cachedData;
            filterData();
            hideLoading();
            return;
        }
    }
    else
    {
        console.log("Skipping cache check:",
            isInitialLoad ? "Initial load" : "Forced refresh");
    }

    // Reset force refresh flag
    refreshBtn.dataset.forceRefresh = 'false';

    try {
        attendanceData = {};

        // 🔍 Step 1: Collect all dates across all employees
        const allDates = new Set();
        const employeeIds = Object.keys(employees);

        for (const employeeId of employeeIds) {
            const attendanceRef = collection(db, "attendance", employeeId, "dates");
            const snapshot = await getDocs(attendanceRef);

            snapshot.forEach(doc => {
                allDates.add(doc.id);
            });
        }
    
        const sortedDates = Array.from(allDates).map(d => new Date(d)).sort((a, b) => a - b);
        const minDate = sortedDates[0];
        const maxDate = sortedDates[sortedDates.length - 1];

        // 📆 Step 2: Generate payroll periods from available data
        window.payrollPeriods = generatePayrollPeriods(minDate, maxDate);

        // Replace the current default period creation code with this
        // If no payroll periods could be generated, create a default one
        if (!window.payrollPeriods || window.payrollPeriods.length === 0) {
            const today = new Date();
            const month = today.getMonth();
            const year = today.getFullYear();

            // Determine current period based on today's date
            let periodStart, periodEnd;

            if (today.getDate() <= 12) {
                // First half of month - period is from 29th of previous month to 12th of current
                const prevMonth = new Date(year, month, 0);
                const daysInPrevMonth = prevMonth.getDate();
                const startDay = Math.min(29, daysInPrevMonth);

                periodStart = new Date(year, month - 1, startDay);
                periodEnd = new Date(year, month, 12);
            } else {
                // Second half of month - period is from 13th to end of month
                periodStart = new Date(year, month, 13);
                periodEnd = new Date(year, month + 1, 0); // Last day of current month
            }

            const id = `${formatDate(periodStart)}_${formatDate(periodEnd)}`;
            const label = `${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

            window.payrollPeriods = [{ id, start: periodStart, end: periodEnd, label }];

            console.log("Created default period:", label);
        }


        // 🧾 Step 3: Populate dropdown (MOVE THIS BEFORE SETTING VALUE)
        if (window.payrollPeriods && window.payrollPeriods.length > 0) {
            periodSelect.innerHTML = window.payrollPeriods.map(p =>
                `<option value="${p.id}">${p.label}</option>`
            ).join('');

            // 🟢 Find the period that includes current date
            const today = new Date();
            let currentPeriodIndex = 0;
            for (let i = 0; i < window.payrollPeriods.length; i++) {
                const period = window.payrollPeriods[i];
                if (today >= period.start && today <= period.end) {
                    currentPeriodIndex = i;
                    break;
                }
            }

            // Select current period by default
            periodSelect.value = window.payrollPeriods[currentPeriodIndex].id;
        } else {
            console.warn("No payroll periods found. Using default period.");
            // Add a default option
            periodSelect.innerHTML = '<option value="default">Current Period</option>';
        }

        // 🔄 Step 4: Now load minimal attendance stats
        const { startDate, endDate } = getPeriodDates(periodSelect.value);
        const formattedStartDate = formatDate(startDate);
        const formattedEndDate = formatDate(endDate);

        for (const employeeId of employeeIds) {
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

            try {
                // Get employee base rate
                const employeeDocRef = doc(db, "employees", employeeId);
                const employeeDoc = await getDoc(employeeDocRef);
                if (employeeDoc.exists()) {
                    const employeeData = employeeDoc.data();
                    attendanceData[employeeId].baseRate = employeeData.baseRate || 0;
                }

                // Only fetch dates within the period range
                const attendanceRef = collection(db, "attendance", employeeId, "dates");

                // Use a where clause to only fetch dates in range
                // Note: You'll need to create a composite index in Firebase for this query
                const snapshot = await getDocs(query(
                    attendanceRef.withConverter(null),
                    where("__name__", ">=", formattedStartDate),
                    where("__name__", "<=", formattedEndDate)
                ));

                let lastClockInDate = null;
                let totalLateHours = 0;
                let daysWorkedCount = 0;

                snapshot.forEach(doc => {
                    const dateStr = doc.id;
                    const dateData = doc.data();

                    // Process the data directly without date range checks since query handles it
                    attendanceData[employeeId].dates.push({
                        date: dateStr,
                        branch: dateData.clockIn?.branch || "N/A",
                        shift: dateData.clockIn?.shift || "N/A",
                        scheduledIn: SHIFT_SCHEDULES[dateData.clockIn?.shift || "Opening"].timeIn,
                        scheduledOut: SHIFT_SCHEDULES[dateData.clockIn?.shift || "Opening"].timeOut,
                        timeIn: dateData.clockIn?.time || null,
                        timeOut: dateData.clockOut?.time || null
                    });

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
                            attendanceData[employeeId].lastClockIn = dateObj;
                            attendanceData[employeeId].lastClockInPhoto = dateData.clockIn.selfie;
                        }
                    }
                });

                attendanceData[employeeId].daysWorked = daysWorkedCount;
                attendanceData[employeeId].lateHours = totalLateHours;
            } catch (error) {
                console.error(`Error loading data for employee ${employeeId}:`, error);
            }
        }

        const saveCacheKey = getCacheKey(periodSelect.value, branchSelect.value);
        saveToCache(saveCacheKey, attendanceData);

        filterData();
    } catch (error) {
        console.error("❌ Error loading data:", error);
        alert("Failed to load data. Please try again.");
    } finally {
        hideLoading();
    }
}


// Filter data based on selected period and branch
// Update the filterData() function around line 212:
// Filter data based on selected period and branch
function filterData() {
    const period = periodSelect.value;
    const branch = branchSelect.value;
    const { startDate, endDate } = getPeriodDates(period);

    // First make a deep copy of original attendance data to avoid modifying it
    filteredData = JSON.parse(JSON.stringify(attendanceData));

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
            if (date.timeIn && date.timeOut) daysWorkedCount++;

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

// Update summary cards with calculated values
function updateSummaryCards() {
    // Calculate summary values
    const totalEmployees = Object.keys(employees).length;

    // Count active employees (those with at least one clock-in for the period)
    let activeEmployees = 0;
    let totalLateHours = 0;
    let totalPayrollAmount = 0;

    Object.values(filteredData).forEach(employee => {
        // Check if employee has at least one clock-in
        const hasAttendance = employee.dates.some(date => date.timeIn);
        if (hasAttendance) {
            activeEmployees++;
            // Calculate pay for this employee and add to total
            const baseRate = employee.baseRate || 0;
            const daysWorked = employee.daysWorked;
            totalPayrollAmount += calculateTotalPay(daysWorked, baseRate);
        }

        // Calculate late hours
        employee.dates.forEach(date => {
            if (date.scheduledIn && date.timeIn) {
                const lateMinutes = compareTimes(date.timeIn, date.scheduledIn);
                if (lateMinutes > 0) {
                    totalLateHours += lateMinutes / 60;
                }
            }
        });
    });

    // Update cards
    document.getElementById('totalEmployees').textContent = totalEmployees;
    document.getElementById('activeEmployees').textContent = activeEmployees;
    document.getElementById('totalLateHours').textContent = totalLateHours.toFixed(1);
    document.getElementById('totalPayroll').textContent = `₱${totalPayrollAmount.toFixed(2)}`;
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
            <td class="base-rate">₱${employee.baseRate || 0}</td>
            <td>₱${calculateTotalPay(daysWorked, employee.baseRate || 0).toFixed(2)}</td>
            <td class="time-cell">
                ${employee.lastClockInPhoto ?
                        `<img src="${employee.lastClockInPhoto}" class="thumb" data-photo="${employee.lastClockInPhoto}" alt="Last clock-in photo">` :
                        ``}
                <span class="date-readable">${lastClockIn}</span>
            </td>
            <td>
                <button class="action-btn view-details-btn">Quick View</button>
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
}

// Add this function at the bottom of your JS file
function calculateTotalPay(daysWorked, baseRate) {
    const dailyMealAllowance = 150;
    return (baseRate * daysWorked) + (dailyMealAllowance * daysWorked);
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
        detailTable.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Branch</th>
                    <th>Shift</th>
                    <th>Time In</th>
                    <th>Time Out</th>
                    <th>Hours</th>
                    <th>Status</th>
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
            detailRowItem.innerHTML = `
                <td class="date-cell">
                    <span class="date-day">${formattedDate}</span>
                    <span class="date-dow">${dayOfWeek}</span>
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
                <td>${hours ? hours.toFixed(1) : 'N/A'}</td>
                <td><span class="status-badge ${statusClass}">${status}</span></td>
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

    } catch (error) {
        console.error("Error loading employee details:", error);
        detailRow.querySelector('.detail-content').innerHTML = '<div class="error-message">Failed to load details. Please try again.</div>';
    }
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

// Show loading overlay
function showLoading() {
    loadingOverlay.style.display = 'flex';
}

// Hide loading overlay
function hideLoading() {
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

function generatePayrollPeriods(minDate, maxDate) {
    const periods = [];

    const today = new Date();
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0); // Last day of current month

    if (maxDate < endOfMonth) {
        maxDate = endOfMonth;
    }

    // Helper to normalize date without time component
    const normalizeDate = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

    minDate = normalizeDate(minDate);
    maxDate = normalizeDate(maxDate);

    // Find the next period end after minDate
    let currentPeriod = new Date(minDate);

    // Find first period
    if (currentPeriod.getDate() <= 12) {
        // We're in the first half of a month
        const nextPeriodEnd = new Date(currentPeriod.getFullYear(), currentPeriod.getMonth(), 12);
        currentPeriod = nextPeriodEnd;
    } else if (currentPeriod.getDate() <= 28) {
        // We're in the second half of a month
        const nextPeriodEnd = new Date(currentPeriod.getFullYear(), currentPeriod.getMonth() + 1, 0); // Last day of month
        currentPeriod = nextPeriodEnd;
    } else {
        // We're in the last days of a month, go to the middle of next month
        const nextPeriodEnd = new Date(currentPeriod.getFullYear(), currentPeriod.getMonth() + 1, 12);
        currentPeriod = nextPeriodEnd;
    }

    // Now generate all periods up to maxDate
    while (currentPeriod <= maxDate) {
        let periodStart, periodEnd;

        if (currentPeriod.getDate() <= 12) {
            // This is a mid-month end date (12th)
            periodEnd = new Date(currentPeriod.getFullYear(), currentPeriod.getMonth(), 12);
            // Start date is 29th of previous month (or last day if February)
            const prevMonth = new Date(currentPeriod.getFullYear(), currentPeriod.getMonth(), 0);
            const daysInPrevMonth = prevMonth.getDate();
            const startDay = Math.min(29, daysInPrevMonth);
            periodStart = new Date(currentPeriod.getFullYear(), currentPeriod.getMonth() - 1, startDay);
        } else {
            // This is an end-of-month date
            periodEnd = new Date(currentPeriod.getFullYear(), currentPeriod.getMonth() + 1, 0);
            // Start date is 13th of current month
            periodStart = new Date(currentPeriod.getFullYear(), currentPeriod.getMonth(), 13);
        }

        if (periodEnd >= minDate && periodStart <= maxDate) {
            const id = `${formatDate(periodStart)}_${formatDate(periodEnd)}`;
            const label = `${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
            periods.push({ id, start: periodStart, end: periodEnd, label });
        }

        // Move to next period end
        if (currentPeriod.getDate() <= 12) {
            // Current end is mid-month, next is end of month
            currentPeriod = new Date(currentPeriod.getFullYear(), currentPeriod.getMonth() + 1, 0);
        } else {
            // Current end is end of month, next is mid-month of next month
            currentPeriod = new Date(currentPeriod.getFullYear(), currentPeriod.getMonth() + 1, 12);
        }
    }

    return periods.reverse(); // Most recent first
}

// Add this event listener after the existing ones in renderEmployeeTable
// At the end of renderEmployeeTable function (around line 280)

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