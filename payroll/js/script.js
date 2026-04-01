// Import Firebase setup
import { db } from '../../attendance/js/firebase-setup.js';
import { doc, getDoc, getDocs, collection, collectionGroup, query, where, addDoc, setDoc, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Version log for cache busting verification
console.log('✅ Payroll script loaded - Version: 20250117-payslip-fix (Payslip calculation fixed)');

// Current user (will be set from parent portal or localStorage)
let currentUser = "";
let currentUserName = "";

// Try to get user from parent portal first (iframe context)
try {
    if (window.parent && window.parent !== window && window.parent.getCurrentUserData) {
        const parentUserData = window.parent.getCurrentUserData();
        if (parentUserData) {
            currentUser = parentUserData.employeeCode || parentUserData.username;
            currentUserName = parentUserData.name;
            console.log("Payroll: Got user from parent portal:", currentUser, currentUserName);
        }
    }
} catch (e) {
    console.log("Payroll: Could not access parent, using localStorage");
}

// Fallback to localStorage if not in iframe
if (!currentUser) {
    currentUser = localStorage.getItem("loggedInUser") || "";
    currentUserName = localStorage.getItem("userName") || "";
}

let employees = {};
let employeesLoaded = false;

// PayCalculator instance
let payCalculatorPayroll = null;
let payrollSalesDataCache = {};
let payrollEmployeeContext = null;

// Holiday data
let HOLIDAYS_2025 = {};
let holidaysLoaded = false;

const SHIFT_SCHEDULES = {
    "Opening": { timeIn: "9:30 AM", timeOut: "6:30 PM" },
    "Opening Half-Day": { timeIn: "9:30 AM", timeOut: "1:30 PM" },
    "Midshift": { timeIn: "11:00 AM", timeOut: "8:00 PM" },
    "Closing": { timeIn: "1:00 PM", timeOut: "10:00 PM" },
    "Closing Half-Day": { timeIn: "6:00 PM", timeOut: "10:00 PM" },
    "Custom": { timeIn: null, timeOut: null }
};

// Get PayCalculator instance (already initialized in DOMContentLoaded)
function getPayCalculatorPayroll() {
    return payCalculatorPayroll;
}

// Load sales data (matching admin payroll)
async function loadSalesData(branch = null) {
    try {
        let snapshot;
        
        if (branch === 'podium' || branch === 'Podium') {
            snapshot = await getDocs(collection(db, 'sales-data', 'podium', 'daily'));
        } else if (branch === 'smnorth' || branch === 'sm-north' || branch === 'SM North') {
            snapshot = await getDocs(collection(db, 'sales-data', 'sm-north', 'daily'));
        } else {
            // Load all branches for compatibility
            const [smNorthSnapshot, podiumSnapshot] = await Promise.all([
                getDocs(collection(db, 'sales-data', 'sm-north', 'daily')),
                getDocs(collection(db, 'sales-data', 'podium', 'daily'))
            ]);
            
            // Combine both snapshots
            const combinedDocs = [...smNorthSnapshot.docs, ...podiumSnapshot.docs];
            snapshot = { docs: combinedDocs };
        }
        
        const salesData = {};
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            // Only include sales data if it has total sales amount
            if (data.totalSales || (data.cash || 0) + (data.gcash || 0) + (data.maya || 0) + (data.card || 0) + (data.grab || 0) > 0) {
                salesData[doc.id] = data;
            }
        });
        
        console.log(`✅ Sales data loaded: ${Object.keys(salesData).length} days`);
        return salesData;
    } catch (error) {
        console.error("Failed to load sales data:", error);
        return {};
    }
}

// Load employees
async function loadEmployees() {
    if (employeesLoaded) return employees;

    try {
        const employeesRef = collection(db, "employees");
        const snapshot = await getDocs(employeesRef);

        employees = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            employees[doc.id] = data.name;
        });

        employeesLoaded = true;
        console.log(`Loaded ${Object.keys(employees).length} employees from Firebase`);
        return employees;
    } catch (error) {
        console.error("Failed to load employees:", error);
        return {};
    }
}

// Format date helper
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Get dates in range
function getDatesInRange(startDate, endDate) {
    const dates = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
        dates.push(formatDate(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
}

// Parse period text
// RESTORED FROM OLD - Parse period text to extract dates
function parsePeriod(periodText) {
    console.log('🔍 Parsing period:', periodText);
    
    // Try format: "Month DD-DD, YYYY" (same month, compact)
    let match = periodText.match(/([A-Za-z]+)\s+(\d+)-(\d+),\s*(\d{4})/);
    if (match) {
        console.log('✅ Matched compact format:', match);
        return [match[1], match[2], match[1], match[3], match[4]]; // Use same month for both
    }
    
    // Try format: "Month DD - Month DD, YYYY" (cross-month or same month with spaces)
    match = periodText.match(/([A-Za-z]+)\s+(\d+)\s*-\s*([A-Za-z]+)\s+(\d+),\s*(\d{4})/);
    if (match) {
        console.log('✅ Matched cross-month format:', match);
        return [match[1], match[2], match[3], match[4], match[5]];
    }
    
    console.error('❌ Could not parse period:', periodText);
    return [null, null, null, null, null];
}

function getMonthIndex(monthName) {
    if (!monthName) return 0; // Default to January if null
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months.findIndex(m => m.toLowerCase().startsWith(monthName.toLowerCase()));
}

// Helper function to create dates from parsed period, handling year boundaries correctly
// When a period spans across years (e.g., Dec 29 - Jan 12), the start date should use the previous year
function createPeriodDates(startMonth, startDay, endMonth, endDay, year) {
    const startMonthIndex = getMonthIndex(startMonth);
    const endMonthIndex = getMonthIndex(endMonth);
    
    // If start month comes after end month (e.g., Dec=11 > Jan=0), period spans across years
    const spansYearBoundary = startMonthIndex > endMonthIndex;
    const startYear = spansYearBoundary ? year - 1 : year;
    const endYear = year;
    
    const startDate = new Date(startYear, startMonthIndex, parseInt(startDay));
    const endDate = new Date(endYear, endMonthIndex, parseInt(endDay));
    
    if (spansYearBoundary) {
        console.log('🔄 Year boundary detected:', {
            startMonth, startDay, endMonth, endDay, year,
            startYear, endYear,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0]
        });
    }
    
    return { startDate, endDate };
}

// RESTORED FROM OLD - Compare times
function compareTimes(t1, t2) {
    // Handle null or undefined times
    if (!t1 || !t2) return 0;

    const [time1, meridian1] = t1.split(' ');
    const [hour1, min1] = time1.split(':').map(Number);
    const minutes1 = (meridian1 === "PM" && hour1 !== 12 ? hour1 + 12 : hour1 % 12) * 60 + min1;

    const [time2, meridian2] = t2.split(' ');
    const [hour2, min2] = time2.split(':').map(Number);
    const minutes2 = (meridian2 === "PM" && hour2 !== 12 ? hour2 + 12 : hour2 % 12) * 60 + min2;

    return minutes1 - minutes2; // > 0 means late
}

// RESTORED FROM OLD - Format time (remove seconds)
function formatTime(timeStr) {
    if (!timeStr || timeStr === '--' || timeStr === 'null') {
        return '--';
    }

    // Only remove seconds if they actually exist (3 colon-separated parts)
    const parts = timeStr.split(':');
    if (parts.length === 3) {
        // Has seconds: "1:15:30 PM" -> "1:15 PM"
        return timeStr.replace(/:\d{2}(\s[AP]M)/, '$1');
    }
    // No seconds: "1:15 PM" -> "1:15 PM" (no change)
    return timeStr;
}

// Convert 12-hour time to 24-hour format for time inputs
function time12to24(time12) {
    if (!time12 || time12 === '--') return '';
    const [time, meridian] = time12.split(' ');
    const [hours, minutes] = time.split(':');
    let hours24 = parseInt(hours);
    if (meridian === 'PM' && hours24 !== 12) hours24 += 12;
    if (meridian === 'AM' && hours24 === 12) hours24 = 0;
    return `${String(hours24).padStart(2, '0')}:${minutes}`;
}

// Convert 24-hour time to 12-hour format
function time24to12(time24) {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':');
    let hours12 = parseInt(hours);
    const meridian = hours12 >= 12 ? 'PM' : 'AM';
    if (hours12 === 0) hours12 = 12;
    if (hours12 > 12) hours12 -= 12;
    return `${hours12}:${minutes} ${meridian}`;
}

// Normalize time string by removing seconds for comparison
// Handles both "10:34:09 AM" and "10:34 AM" formats
function normalizeTimeForComparison(timeStr) {
    if (!timeStr || timeStr === '--' || timeStr === 'null') return '';
    let s = (timeStr && timeStr.trim()) || '';
    if (!s) return '';
    // Only remove seconds when present (HH:MM:SS AM/PM -> HH:MM AM/PM)
    const withSeconds = /^(\d{1,2}:\d{2}):\d{2}(\s*[AP]M)$/i;
    s = s.replace(withSeconds, '$1$2').trim() || s;
    // Normalize leading zero on hour so "09:45 AM" and "9:45 AM" compare equal
    s = s.replace(/^0(\d):/, '$1:');
    return s;
}

// Cache for request statuses
let requestStatusCache = {};

// Simple toast notification function
function showToast(message, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 24px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        transform: translateX(400px);
        transition: transform 0.3s ease-in-out;
        max-width: 400px;
        word-wrap: break-word;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    toast.style.backgroundColor = colors[type] || colors.success;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
    }, 100);
    
    setTimeout(() => {
        toast.style.transform = 'translateX(400px)';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
}

// Fetch request status for a specific date
// This checks for requests where the date matches OR where currentData.date matches (date change requests)
async function getRequestStatus(date) {
    if (!currentUser || !date) return null;
    
    // Check cache first
    if (requestStatusCache[date]) {
        return requestStatusCache[date];
    }
    
    try {
        const requestsRef = collection(db, "payroll_requests");
        // Get all requests for this employee
        const q = query(
            requestsRef,
            where("employeeId", "==", currentUser)
        );
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            // Find requests that involve this date (either as main date or as currentData.date)
            const requests = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                // Check if this request involves the date we're checking
                const requestDate = data.date;
                const currentDataDate = data.currentData?.date;
                
                // Match if: request date matches OR currentData date matches (date change request)
                if (requestDate === date || currentDataDate === date) {
                    requests.push({ id: doc.id, ...data });
                }
            });
            
            if (requests.length > 0) {
                // Get the most recent request
                requests.sort((a, b) => {
                    const aTime = a.requestedAt?.toMillis() || 0;
                    const bTime = b.requestedAt?.toMillis() || 0;
                    return bTime - aTime;
                });
                requestStatusCache[date] = requests[0];
                return requests[0];
            }
        }
        requestStatusCache[date] = null;
        return null;
    } catch (error) {
        console.error("Error fetching request status:", error);
        return null;
    }
}

// Fetch all request history for a date
async function loadRequestHistory(date) {
    if (!currentUser || !date) return [];
    
    try {
        const requestsRef = collection(db, "payroll_requests");
        const q = query(
            requestsRef,
            where("employeeId", "==", currentUser),
            where("date", "==", date)
        );
        const snapshot = await getDocs(q);
        
        const history = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            history.push({
                id: doc.id,
                status: data.status,
                requestedAt: data.requestedAt,
                reason: data.reason || '',
                reviewedAt: data.reviewedAt
            });
        });
        
        // Sort by requested time (newest first)
        history.sort((a, b) => {
            const aTime = a.requestedAt?.toMillis() || 0;
            const bTime = b.requestedAt?.toMillis() || 0;
            return bTime - aTime;
        });
        
        return history;
    } catch (error) {
        console.error("Error fetching request history:", error);
        return [];
    }
}

// Format relative time for history (simpler version)
function formatRelativeTimeForHistory(timestamp) {
    if (!timestamp) return 'Unknown';
    
    const now = new Date();
    const time = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Submit payroll request
async function submitPayrollRequest(requestData, isNewDate = false) {
    if (!currentUser) {
        showToast("Please log in to submit a request.", 'error');
        return false;
    }
    
    try {
        const requestsRef = collection(db, "payroll_requests");
        const requestDoc = {
            employeeId: currentUser,
            employeeName: currentUserName || "Unknown",
            date: requestData.date,
            type: isNewDate ? "new_date" : (requestData.requestOT ? "ot" : "edit"),
            status: "pending",
            currentData: requestData.currentData || null, // null for new date requests
            requestedData: {
                date: requestData.date,
                timeIn: requestData.timeIn,
                timeOut: requestData.timeOut,
                branch: requestData.branch,
                shift: requestData.shift
            },
            requestOT: requestData.requestOT || false,
            reason: requestData.reason || "",
            requestedAt: Timestamp.now(),
            requestedBy: currentUser
        };
        
        await addDoc(requestsRef, requestDoc);
        
        // Clear cache for this date
        delete requestStatusCache[requestData.date];
        
        console.log("Request submitted successfully");
        return true;
    } catch (error) {
        console.error("Error submitting request:", error);
        showToast("Failed to submit request. Please try again.", 'error');
        return false;
    }
}

// RESTORED FROM OLD - Calculate hours between two times
function calculateHours(timeInStr, timeOutStr) {
    try {
        const [timeIn, meridianIn] = timeInStr.split(' ');
        const [hoursIn, minutesIn] = timeIn.split(':').map(Number);

        const [timeOut, meridianOut] = timeOutStr.split(' ');
        const [hoursOut, minutesOut] = timeOut.split(':').map(Number);

        let hours24In = hoursIn;
        if (meridianIn === 'PM' && hoursIn !== 12) hours24In += 12;
        if (meridianIn === 'AM' && hoursIn === 12) hours24In = 0;

        let hours24Out = hoursOut;
        if (meridianOut === 'PM' && hoursOut !== 12) hours24Out += 12;
        if (meridianOut === 'AM' && hoursOut === 12) hours24Out = 0;

        const totalMinutesIn = hours24In * 60 + minutesIn;
        const totalMinutesOut = hours24Out * 60 + minutesOut;

        let minutesDiff = totalMinutesOut - totalMinutesIn;

        if (minutesDiff < 0) {
            // Always add 24 hours for negative differences (next day scenario)
            minutesDiff += 24 * 60;
        }

        const maxShiftHours = 18;
        const calculatedHours = minutesDiff / 60;

        if (calculatedHours > maxShiftHours) {
            console.warn("Shift duration exceeds maximum:", calculatedHours, "hours");
            return maxShiftHours;
        }

        return calculatedHours;
    } catch (error) {
        console.error("Error calculating hours:", error);
        return null;
    }
}

// RESTORED FROM OLD - Get holiday pay multiplier
function getHolidayPayMultiplier(dateStr) {
    if (HOLIDAYS_2025[dateStr]) {
        if (HOLIDAYS_2025[dateStr].type === "regular") {
            return 2.0;
        } else if (HOLIDAYS_2025[dateStr].type === "special") {
            return 1.3;
        }
    }
    return 1.0;
}

// RESTORED FROM OLD - Calculate deductions
function calculateDeductions(timeIn, timeOut, scheduledIn, scheduledOut) {
    const LATE_THRESHOLD_MINUTES = 30;
    const UNDERTIME_THRESHOLD_MINUTES = 30;
    let deductions = 0;

    if (timeIn && scheduledIn) {
        const lateMinutes = compareTimes(timeIn, scheduledIn);
        if (lateMinutes > LATE_THRESHOLD_MINUTES) {
            const lateHours = lateMinutes / 60;
            deductions += lateHours;
        }
    }

    if (timeOut && scheduledOut) {
        const undertimeMinutes = compareTimes(scheduledOut, timeOut);
        if (undertimeMinutes > UNDERTIME_THRESHOLD_MINUTES) {
            const undertimeHours = undertimeMinutes / 60;
            deductions += undertimeHours;
        }
    }

    return deductions;
}

// RESTORED FROM OLD - Calculate late deduction
function calculateLateDeduction(dayData) {
    if (!dayData.timeIn || !dayData.scheduledIn) return 0;

    const lateMinutes = compareTimes(dayData.timeIn, dayData.scheduledIn);
    if (lateMinutes <= 30) return 0; // Grace period - no deduction

    // Only deduct if late > 30 minutes
    const baseRate = dayData.baseRate || 750;
    const isHalfDay = dayData.shift === "Closing Half-Day";
    const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
    const hourlyRate = dailyRate / (isHalfDay ? 4 : 8);

    return (lateMinutes / 60) * hourlyRate;
}

// RESTORED FROM OLD - Calculate undertime deduction
function calculateUndertimeDeduction(dayData) {
    if (!dayData.timeOut || !dayData.scheduledOut) return 0;

    const undertimeMinutes = compareTimes(dayData.scheduledOut, dayData.timeOut);
    if (undertimeMinutes <= 30) return 0; // Grace period

    const baseRate = dayData.baseRate || 750;
    const isHalfDay = dayData.shift === "Closing Half-Day";
    const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
    const hourlyRate = dailyRate / (isHalfDay ? 4 : 8);

    return (undertimeMinutes / 60) * hourlyRate;
}

// RESTORED FROM OLD - Calculate holiday bonus
function calculateHolidayBonus(dayData, dailyRate) {
    const multiplier = getHolidayPayMultiplier(dayData.date);
    if (multiplier <= 1.0) return 0;

    return dailyRate * (multiplier - 1.0);
}

// RESTORED FROM OLD - Calculate OT pay
function calculateOTPay(dateEntry, baseRate) {
    if (!dateEntry.hasOTPay || !dateEntry.timeIn || !dateEntry.timeOut) {
        return { otPay: 0, otHours: 0 };
    }

    const actualHours = calculateHours(dateEntry.timeIn, dateEntry.timeOut);
    if (!actualHours || actualHours <= 0) return { otPay: 0, otHours: 0 };

    let workHours = actualHours;
    if (actualHours > 4) {
        workHours = actualHours - 1; // Subtract meal break
    }

    workHours = Math.max(0, workHours);
    const otHours = Math.max(0, workHours - 8); // OT = work hours beyond 8

    if (otHours === 0) {
        return { otPay: 0, otHours: 0 };
    }

    const dateStr = dateEntry.date || dateEntry;
    const hourlyRate = baseRate / 8;
    let otRate;

    if (HOLIDAYS_2025[dateStr]) {
        const holiday = HOLIDAYS_2025[dateStr];
        if (holiday.type === 'regular') {
            otRate = hourlyRate * 2.60;
        } else if (holiday.type === 'special') {
            otRate = hourlyRate * 1.69;
        }
    } else {
        otRate = hourlyRate * 1.25;
    }

    const otPay = otHours * otRate;
    return { otPay, otHours };
}

// Calculate daily pay using PayCalculator (includes holiday pay)
function calculateDailyPay(dateObj, baseRate, employee = null) {
    if (!dateObj.timeIn || !dateObj.timeOut) {
        return 0;
    }

    // Get PayCalculator instance
    const calculator = getPayCalculatorPayroll();
    if (!calculator) {
        console.warn('PayCalculator not available, falling back to basic calculation');
        // Fallback to basic calculation if PayCalculator not available
        return calculateDailyPayFallback(dateObj, baseRate);
    }

    // Prepare employee data (matching admin payroll format)
    const employeeData = employee || {
        baseRate: baseRate,
        salesBonusEligible: payrollEmployeeContext?.salesBonusEligible || false
    };

    // Use PayCalculator to calculate pay with detailed breakdown
    const result = calculator.calculateDailyPay(dateObj, employeeData, 'detailed');
    
    // Return total pay (includes holiday pay, deductions, bonuses, etc.)
    return result.total || 0;
}

// Fallback calculation if PayCalculator is not available
function calculateDailyPayFallback(dateObj, baseRate) {
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
        const isHalfDay = dateObj.shift === "Closing Half-Day" || dateObj.shift === "Opening Half-Day";
        const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
        const mealAllowance = isHalfDay ? dailyMealAllowance / 2 : dailyMealAllowance;

        const deductionHours = calculateDeductions(dateObj.timeIn, dateObj.timeOut, dateObj.scheduledIn, dateObj.scheduledOut);
        const standardHours = isHalfDay ? 4 : 8;
        const hourlyRate = dailyRate / standardHours;
        const deductionAmount = deductionHours * hourlyRate;

        dailyTotalPay = (dailyRate * multiplier) + mealAllowance - deductionAmount;

        // Add OT pay for regular shifts
        const otCalculation = calculateOTPay(dateObj, baseRate);
        if (otCalculation.otPay > 0) {
            dailyTotalPay += otCalculation.otPay;
        }
    }

    if (dateObj.transpoAllowance) {
        dailyTotalPay += dateObj.transpoAllowance;
    }

    // Add sales bonus if it exists in the data
    if (dateObj.salesBonus) {
        dailyTotalPay += dateObj.salesBonus;
    }

    return dailyTotalPay;
}

// Fetch payroll data
async function fetchPayrollData(dates) {
    if (!navigator.onLine || !currentUser) {
        return [];
    }

    try {
        const payrollData = [];

        // Get all attendance data for the user
        const attendanceRef = collection(db, "attendance", currentUser, "dates");
        const snapshot = await getDocs(attendanceRef);

        const attendanceMap = {};
        snapshot.forEach(doc => {
            attendanceMap[doc.id] = doc.data();
        });

        // Get employee base rate
        let baseRate = 750;
        try {
            const employeeDoc = await getDoc(doc(db, "employees", currentUser));
            if (employeeDoc.exists()) {
                baseRate = employeeDoc.data().baseRate || 750;
            }
        } catch (error) {
            console.error("Failed to get employee base rate:", error);
        }

        // Filter for only the dates we need
        console.log('🔍 Fetching payroll data for', dates.length, 'dates');
        console.log('📅 Date range:', dates[0], 'to', dates[dates.length - 1]);
        console.log('📊 Available attendance dates:', Object.keys(attendanceMap).length, 'total records');
        
        let foundCount = 0;
        dates.forEach(dateStr => {
            const data = attendanceMap[dateStr];
            
            if (data) {
                foundCount++;
                // Debug sales bonus loading
                if (data?.salesBonus) {
                    console.log(`📊 Sales bonus found for ${dateStr}:`, data.salesBonus);
                }
            } else {
                console.log('⚠️ No attendance data found for date:', dateStr);
            }

            payrollData.push({
                date: dateStr,
                timeIn: data?.clockIn?.time || null,
                timeOut: data?.clockOut?.time || null,
                branch: data?.clockIn?.branch || null,
                shift: data?.clockIn?.shift || null,
                scheduledIn: SHIFT_SCHEDULES[data?.clockIn?.shift || "Opening"].timeIn,
                scheduledOut: SHIFT_SCHEDULES[data?.clockIn?.shift || "Opening"].timeOut,
                hours: data?.clockIn && data?.clockOut ? calculateHours(data.clockIn.time, data.clockOut.time) : null,
                baseRate: baseRate,
                hasOTPay: data?.hasOTPay || false,
                salesBonus: data?.salesBonus || 0,
                transpoAllowance: data?.transpoAllowance || 0,
                photoIn: data?.clockIn?.photoURL || null,
                photoOut: data?.clockOut?.photoURL || null
            });
        });
        
        console.log('✅ Found attendance records for', foundCount, 'out of', dates.length, 'dates in period');

        return payrollData;
    } catch (error) {
        console.error("Failed to fetch payroll data:", error);
        return [];
    }
}

// Fetch pending requests for the current period
async function fetchPendingRequests(dates) {
    if (!currentUser) return [];
    
    try {
        const requestsRef = collection(db, "payroll_requests");
        const q = query(
            requestsRef,
            where("employeeId", "==", currentUser),
            where("status", "==", "pending")
        );
        const snapshot = await getDocs(q);
        
        const pendingRequests = [];
        const dateSet = new Set(dates);
        
        console.log("📋 Fetching pending requests. Period dates:", dates.length, "dates");
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const requestDate = data.requestedData?.date || data.date;
            const currentDataDate = data.currentData?.date;
            
            // Normalize dates to YYYY-MM-DD format for comparison
            // Dates from Firebase are already in YYYY-MM-DD format, but ensure they match
            let normalizedRequestDate = requestDate;
            let normalizedCurrentDate = currentDataDate;
            
            // If date is already in YYYY-MM-DD format, use it directly
            // Otherwise, try to parse and format it
            if (requestDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestDate)) {
                try {
                    const dateObj = new Date(requestDate);
                    if (!isNaN(dateObj.getTime())) {
                        normalizedRequestDate = formatDate(dateObj);
                    }
                } catch (e) {
                    console.error("Error normalizing request date:", requestDate, e);
                }
            }
            
            if (currentDataDate && !/^\d{4}-\d{2}-\d{2}$/.test(currentDataDate)) {
                try {
                    const dateObj = new Date(currentDataDate);
                    if (!isNaN(dateObj.getTime())) {
                        normalizedCurrentDate = formatDate(dateObj);
                    }
                } catch (e) {
                    console.error("Error normalizing current date:", currentDataDate, e);
                }
            }
            
            // For new date requests, check if requested date is in period
            // For edit requests, check if current date is in period
            if (data.type === "new_date") {
                if (normalizedRequestDate && dateSet.has(normalizedRequestDate)) {
                    console.log("✅ Found new date request:", normalizedRequestDate, data);
                    pendingRequests.push({ id: doc.id, ...data, normalizedDate: normalizedRequestDate });
                } else {
                    console.log("❌ New date request not in period:", normalizedRequestDate, "in set?", dateSet.has(normalizedRequestDate));
                }
            } else {
                // Edit request - check if current date is in period
                if (normalizedCurrentDate && dateSet.has(normalizedCurrentDate)) {
                    pendingRequests.push({ id: doc.id, ...data, normalizedDate: normalizedCurrentDate });
                }
            }
        });
        
        console.log("📋 Total pending requests found:", pendingRequests.length);
        return pendingRequests;
    } catch (error) {
        console.error("Error fetching pending requests:", error);
        return [];
    }
}

// RESTORED FROM OLD - Update payroll UI
async function updatePayrollUI(payrollData) {
    const daysWorked = payrollData.filter(day => day.timeIn && day.timeOut).length;

    // RESTORED - Calculate total pay using the restored calculateDailyPay
    const totalPay = payrollData.reduce((sum, day) => {
        if (day.timeIn && day.timeOut) {
            return sum + calculateDailyPay(day, day.baseRate);
        }
        return sum;
    }, 0);

    // Update summary
    document.getElementById('daysWorked').textContent = daysWorked;
    document.getElementById('totalPay').textContent = `₱${totalPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Populate cards
    const cardsContainer = document.getElementById('payrollCardsContainer');
    if (!cardsContainer) return;

    cardsContainer.innerHTML = '';

    // Get the date range from payroll data to fetch pending requests
    // Also need to get the actual period dates for new date requests
    const periodSelect = document.getElementById('payrollPeriod');
    const selectedPeriod = periodSelect?.value;
    let periodDates = payrollData.map(day => day.date);
    
    // If we have a period selected, get all dates in that period
    if (selectedPeriod) {
        try {
            const [startMonth, startDay, endMonth, endDay, year] = parsePeriod(selectedPeriod);
            if (startMonth && endMonth && year) {
                const { startDate, endDate } = createPeriodDates(startMonth, startDay, endMonth, endDay, year);
                periodDates = getDatesInRange(startDate, endDate);
            }
        } catch (error) {
            console.error("Error parsing period:", error);
        }
    }
    
    const pendingRequests = await fetchPendingRequests(periodDates);
    
    // Create a map of dates to pending requests
    const pendingRequestsMap = new Map();
    pendingRequests.forEach(req => {
        const requestDate = req.requestedData?.date || req.date;
        const currentDataDate = req.currentData?.date;
        
        // For new date requests, use requested date
        if (req.type === "new_date") {
            if (!pendingRequestsMap.has(requestDate)) {
                pendingRequestsMap.set(requestDate, req);
            }
        } else {
            // For edit requests, use current date (the date being edited)
            if (currentDataDate && !pendingRequestsMap.has(currentDataDate)) {
                pendingRequestsMap.set(currentDataDate, req);
            }
        }
    });

    const sortedPayrollData = payrollData.sort((a, b) => new Date(b.date) - new Date(a.date));
    const today = new Date();
    const isToday = (date) => formatDate(today) === date;

    sortedPayrollData.forEach(day => {
        if (!day.timeIn && !day.timeOut) return;

        const card = document.createElement('div');
        card.className = 'payroll-card';
        card.dataset.date = day.date;

        if (isToday(day.date)) {
            card.classList.add('today');
        }

        const dateObj = new Date(day.date);
        const month = dateObj.toLocaleDateString('en-US', { month: 'short' });
        const dayNum = dateObj.getDate();
        const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

        // RESTORED - Calculate late minutes
        const formatLateTime = (timeIn, scheduledIn) => {
            if (!timeIn || !scheduledIn) return { text: '0 mins', minutes: 0 };
            const lateMinutes = compareTimes(timeIn, scheduledIn);
            const actualLateMinutes = Math.max(0, lateMinutes); // Don't show negative values

            const hours = Math.floor(actualLateMinutes / 60);
            const minutes = actualLateMinutes % 60;

            let text;
            if (hours >= 1) {
                text = hours === 1 && minutes === 0 ? '1 hr' :
                    minutes === 0 ? `${hours} hrs` :
                        `${hours} hr ${minutes} mins`;
            } else {
                text = `${minutes} mins`;
            }

            return { text, minutes: actualLateMinutes };
        };

        const lateInfo = formatLateTime(day.timeIn, day.scheduledIn);
        const isOngoing = isToday(day.date) && day.timeIn && !day.timeOut;

        card.innerHTML = `
            <div class="payroll-card-main">
                <div class="payroll-date-section">
                    <div class="payroll-date">${month} ${dayNum}</div>
                    <div class="payroll-day">${dayOfWeek}</div>
                </div>
                ${getHolidayPayMultiplier(day.date) > 1.0 ? `
                <div class="payroll-holiday-section">
                    <div class="payroll-holiday">${HOLIDAYS_2025[day.date]?.name || 'Holiday'}</div>
                </div>
                ` : ''}
                <div class="payroll-branch-shift">
                    <div class="payroll-branch">${day.branch || '--'}</div>
                    <div class="payroll-shift">${day.shift || '--'}</div>
                </div>
            </div>
            <div class="payroll-times">
                <div class="payroll-time-group">
                    <div class="payroll-time-label">Time In</div>
                    <div class="payroll-time">${formatTime(day.timeIn)}</div>
                </div>
                <div class="payroll-time-group">
                    <div class="payroll-time-label">Time Out</div>
                    <div class="payroll-time">${formatTime(day.timeOut)}</div>
                </div>
            </div>
            ${!isOngoing ? `
            <div class="payroll-bottom-section">
                <div class="payroll-late-info">
                    <div class="payroll-late-label">Late Hours</div>
                    <div class="payroll-late-value ${lateInfo.minutes > 30 ? 'late-red' : 'late-green'}">${lateInfo.minutes === 0 ? '-' : lateInfo.text}</div>
                </div>
                <div class="payroll-pay-info">
                    <div class="payroll-pay-label">Total Pay</div>
                    <div class="payroll-pay">₱${calculateDailyPay(day, day.baseRate).toFixed(2)}</div>
                </div>
            </div>
            ` : ''}
        `;

        // Check if there's a pending request for this date
        const pendingRequest = pendingRequestsMap.get(day.date);
        if (pendingRequest) {
            card.classList.add('pending-request');
            card.style.opacity = '0.6';
            card.style.cursor = 'default';
            
            // Add pending indicator at the top
            const pendingText = document.createElement('div');
            pendingText.className = 'pending-indicator';
            pendingText.textContent = pendingRequest.type === 'new_date' ? 'Pending Date' : 'Pending Edit';
            pendingText.style.cssText = `
                text-align: center;
                color: #333;
                font-size: 0.9rem;
                font-weight: 600;
                margin-bottom: 1rem;
                padding-bottom: 0.75rem;
                border-bottom: 1px solid #e5e7eb;
            `;
            card.insertBefore(pendingText, card.firstChild);
            
            // Don't make it clickable
        } else {
        card.addEventListener('click', () => openPayrollDetailModal(day, card));
        }
        
        cardsContainer.appendChild(card);
    });
    
    // Add pending request cards for new date requests
    console.log("🔄 Processing new date requests. Total pending:", pendingRequests.length);
    pendingRequests.forEach(req => {
        if (req.type === "new_date") {
            // Use normalized date if available, otherwise use original
            const requestDate = req.normalizedDate || req.requestedData?.date || req.date;
            
            console.log("📅 Checking new date request:", requestDate);
            
            // Always show pending new date requests (they're requests to add a date)
            // Check if date already has payroll data for logging
            const existingData = payrollData.find(day => day.date === requestDate);
            if (existingData) {
                console.log("⚠️ Date already has payroll data, but showing pending request:", requestDate);
            }
            
            console.log("✅ Creating card for new date request:", requestDate);
            const card = createPendingRequestCard(req);
            if (card) {
                cardsContainer.appendChild(card);
            } else {
                console.error("❌ Failed to create card for request:", req);
            }
        }
    });
    
    // Sort all cards by date (newest first)
    const allCards = Array.from(cardsContainer.children);
    allCards.sort((a, b) => {
        const dateA = a.dataset.date || '';
        const dateB = b.dataset.date || '';
        return new Date(dateB) - new Date(dateA);
    });
    
    // Re-append sorted cards
    allCards.forEach(card => cardsContainer.appendChild(card));
}

// Create a payroll card for a pending request
function createPendingRequestCard(request) {
    // Use normalized date if available, otherwise use original
    const requestDate = request.normalizedDate || request.requestedData?.date || request.date;
    
    // Ensure date is in correct format for Date parsing (YYYY-MM-DD)
    const dateStr = requestDate.includes('T') ? requestDate.split('T')[0] : requestDate;
    
    // Parse date - dates are stored as YYYY-MM-DD strings
    const [year, monthNum, day] = dateStr.split('-').map(Number);
    const dateObj = new Date(year, monthNum - 1, day);
    
    if (isNaN(dateObj.getTime())) {
        console.error("Invalid date for pending request:", requestDate, dateStr);
        return null;
    }
    
    const month = dateObj.toLocaleDateString('en-US', { month: 'short' });
    const dayNum = dateObj.getDate();
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    
    const card = document.createElement('div');
    card.className = 'payroll-card pending-request';
    card.dataset.date = dateStr; // Use normalized date string (YYYY-MM-DD)
    card.style.opacity = '0.6';
    card.style.cursor = 'default';
    card.style.position = 'relative';
    
    const requestedData = request.requestedData || {};
    const timeIn = requestedData.timeIn || '--';
    const timeOut = requestedData.timeOut || '--';
    const branch = requestedData.branch || '--';
    const shift = requestedData.shift || '--';
    
    card.innerHTML = `
        <div class="pending-indicator" style="text-align: center; color: #333; font-size: 0.9rem; font-weight: 600; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid #e5e7eb;">Pending Date</div>
        <div class="payroll-card-main">
            <div class="payroll-date-section">
                <div class="payroll-date">${month} ${dayNum}</div>
                <div class="payroll-day">${dayOfWeek}</div>
            </div>
            <div class="payroll-branch-shift">
                <div class="payroll-branch">${branch}</div>
                <div class="payroll-shift">${shift}</div>
            </div>
        </div>
        <div class="payroll-times">
            <div class="payroll-time-group">
                <div class="payroll-time-label">Time In</div>
                <div class="payroll-time">${formatTime(timeIn)}</div>
            </div>
            <div class="payroll-time-group">
                <div class="payroll-time-label">Time Out</div>
                <div class="payroll-time">${formatTime(timeOut)}</div>
            </div>
        </div>
        <div class="payroll-bottom-section">
            <div class="payroll-late-info">
                <div class="payroll-late-label">Late Hours</div>
                <div class="payroll-late-value">-</div>
            </div>
            <div class="payroll-pay-info">
                <div class="payroll-pay-label">Total Pay</div>
                <div class="payroll-pay">-</div>
            </div>
        </div>
    `;
    
    return card;
}

// RESTORED FROM OLD - Open detail modal
function openPayrollDetailModal(dayData, clickedCard) {
    const modal = document.getElementById('payrollDetailModal');
    const dateObj = new Date(dayData.date);
    const month = dateObj.toLocaleDateString('en-US', { month: 'short' });
    const dayNum = dateObj.getDate();
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

    // Set the card data immediately
    document.getElementById('modalPayrollDate').textContent = `${month} ${dayNum}`;
    document.getElementById('modalPayrollDay').textContent = dayOfWeek;
    document.getElementById('modalPayrollBranch').textContent = dayData.branch || '--';
    document.getElementById('modalPayrollShift').textContent = dayData.shift || '--';

    // Set times immediately
    document.getElementById('modalTimeIn').textContent = formatTime(dayData.timeIn);
    document.getElementById('modalTimeOut').textContent = formatTime(dayData.timeOut);

    // Show modal with animation
    modal.style.display = 'flex';

    // Trigger animation after a frame
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });

    // Hide thumbnails initially
    const timeInThumb = document.getElementById('modalTimeInThumb');
    const timeOutThumb = document.getElementById('modalTimeOutThumb');
    timeInThumb.style.display = 'none';
    timeOutThumb.style.display = 'none';

    // Calculate late time using the same logic as updatePayrollUI
    const formatLateTime = (timeIn, scheduledIn) => {
        if (!timeIn || !scheduledIn) return { text: '0 mins', minutes: 0 };
        const lateMinutes = compareTimes(timeIn, scheduledIn);
        const actualLateMinutes = Math.max(0, lateMinutes);

        const hours = Math.floor(actualLateMinutes / 60);
        const minutes = actualLateMinutes % 60;

        let text;
        if (hours >= 1) {
            text = hours === 1 && minutes === 0 ? '1 hr' :
                minutes === 0 ? `${hours} hrs` :
                    `${hours} hr ${minutes} mins`;
        } else {
            text = `${minutes} mins`;
        }

        return { text, minutes: actualLateMinutes };
    };

    // Calculate pay breakdown using PayCalculator
    const baseRate = dayData.baseRate || 750;
    const calculator = getPayCalculatorPayroll();
    
    // Prepare employee data
    const employeeData = {
        baseRate: baseRate,
        salesBonusEligible: payrollEmployeeContext?.salesBonusEligible || false
    };

    let breakdown = null;
    let totalPay = 0;
    let holidayBonus = 0;
    let lateDeduction = 0;
    let undertimeDeduction = 0;
    let otPay = 0;
    let otHours = 0;
    let salesBonus = 0;
    let baseRateDisplay = 0;
    let mealAllowance = 0;

    if (calculator) {
        // Use PayCalculator for accurate breakdown
        const result = calculator.calculateDailyPay(dayData, employeeData, 'detailed');
        breakdown = result.breakdown;
        totalPay = result.total || 0;

        // Extract values from breakdown
        if (breakdown) {
            // Get meal allowance
            mealAllowance = breakdown.mealAllowance || 0;
            
            // Get deductions
            if (breakdown.deductions) {
                lateDeduction = breakdown.deductions.late?.amount || 0;
                undertimeDeduction = breakdown.deductions.undertime?.amount || 0;
            }
            
            // Get values from components array
            if (breakdown.components) {
                // Extract base rate (before multiplier) from components
                const baseRateComponent = breakdown.components.find(c => 
                    c.type === 'base_rate' || c.type === 'base_pay'
                );
                if (baseRateComponent) {
                    baseRateDisplay = baseRateComponent.amount || 0;
                } else {
                    // Fallback: calculate from adjustedBaseRate and multiplier
                    const multiplier = getHolidayPayMultiplier(dayData.date);
                    if (multiplier > 1.0) {
                        baseRateDisplay = (breakdown.adjustedBaseRate || 0) / multiplier;
                    } else {
                        baseRateDisplay = breakdown.adjustedBaseRate || 0;
                    }
                }
                
                // Extract holiday bonus from components
                const holidayComponent = breakdown.components.find(c => 
                    c.type === 'holiday_bonus' || c.type === 'double_pay_bonus'
                );
                if (holidayComponent) {
                    holidayBonus = holidayComponent.amount || 0;
                }
                
                // Extract OT pay and hours
                const otComponent = breakdown.components.find(c => c.type === 'overtime_pay');
                if (otComponent) {
                    otPay = otComponent.amount || 0;
                    if (otComponent.metadata) {
                        otHours = otComponent.metadata.hours || 0;
                    }
                }
                
                // Extract sales bonus
                const salesComponent = breakdown.components.find(c => c.type === 'sales_bonus');
                if (salesComponent) {
                    salesBonus = salesComponent.amount || 0;
                }
            } else {
                // Fallback if no components
                const multiplier = getHolidayPayMultiplier(dayData.date);
                if (multiplier > 1.0) {
                    baseRateDisplay = (breakdown.adjustedBaseRate || 0) / multiplier;
                } else {
                    baseRateDisplay = breakdown.adjustedBaseRate || 0;
                }
            }
            
            // Also check bonuses object as fallback
            if (breakdown.bonuses) {
                if (!otPay) otPay = breakdown.bonuses.overtime || 0;
                if (!salesBonus) salesBonus = breakdown.bonuses.sales || 0;
            }
        }
    } else {
        // Fallback to manual calculation if PayCalculator not available
        const isHalfDay = dayData.shift === "Closing Half-Day" || dayData.shift === "Opening Half-Day";
        const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
        mealAllowance = isHalfDay ? 75 : 150;
        baseRateDisplay = dailyRate;
        lateDeduction = calculateLateDeduction(dayData);
        undertimeDeduction = calculateUndertimeDeduction(dayData);
        holidayBonus = calculateHolidayBonus(dayData, dailyRate);
        const otCalculation = calculateOTPay(dayData, baseRate);
        otPay = otCalculation.otPay;
        otHours = otCalculation.otHours;
        salesBonus = dayData.salesBonus || 0;
        totalPay = calculateDailyPay(dayData, baseRate);
    }

    // Display base rate and meal allowance
    document.getElementById('modalBaseRate').textContent = `₱${baseRateDisplay.toFixed(2)}`;
    document.getElementById('modalMealAllow').textContent = `₱${mealAllowance.toFixed(2)}`;

    // Show/hide rows
    const lateDeductionRow = document.getElementById('modalLateDeductionRow');
    const undertimeDeductionRow = document.getElementById('modalUndertimeDeductionRow');
    const holidayBonusRow = document.getElementById('modalHolidayBonusRow');
    const otBonusRow = document.getElementById('modalOTBonusRow');
    const salesBonusRow = document.getElementById('modalSalesBonusRow');

    // Late deduction
    if (lateDeduction > 0) {
        const lateInfo = formatLateTime(dayData.timeIn, dayData.scheduledIn);
        document.getElementById('modalLateHours').textContent = lateInfo.text;
        document.getElementById('modalLateDeduction').textContent = `-₱${lateDeduction.toFixed(2)}`;
        lateDeductionRow.style.display = 'grid';
    } else {
        lateDeductionRow.style.display = 'none';
    }

    // Undertime deduction
    const undertimeMinutes = dayData.timeOut && dayData.scheduledOut ?
        compareTimes(dayData.scheduledOut, dayData.timeOut) : 0;

    if (undertimeDeduction > 0 && undertimeMinutes > 30) {
        const undertimeHours = Math.floor(undertimeMinutes / 60);
        const undertimeRemainingMins = undertimeMinutes % 60;
        const undertimeText = undertimeHours > 0 ?
            `${undertimeHours}h ${undertimeRemainingMins}m` :
            `${undertimeMinutes} mins`;

        document.getElementById('modalUndertimeHours').textContent = undertimeText;
        document.getElementById('modalUndertimeDeduction').textContent = `-₱${undertimeDeduction.toFixed(2)}`;
        undertimeDeductionRow.style.display = 'grid';
    } else {
        undertimeDeductionRow.style.display = 'none';
    }

    // Holiday bonus (from PayCalculator breakdown)
    if (holidayBonus > 0) {
        const multiplier = getHolidayPayMultiplier(dayData.date);
        const holidayType = multiplier === 2.0 ? 'Regular' : 'Special';
        document.getElementById('modalHolidayType').textContent = holidayType;
        document.getElementById('modalHolidayBonus').textContent = `+₱${holidayBonus.toFixed(2)}`;
        holidayBonusRow.style.display = 'grid';
    } else {
        holidayBonusRow.style.display = 'none';
    }

    // Overtime pay
    if (otPay > 0) {
        document.getElementById('modalOTHours').textContent = `${otHours.toFixed(1)}h`;
        document.getElementById('modalOTBonus').textContent = `+₱${otPay.toFixed(2)}`;
        otBonusRow.style.display = 'grid';
    } else {
        otBonusRow.style.display = 'none';
    }

    // Sales bonus
    if (salesBonus > 0) {
        document.getElementById('modalSalesBonus').textContent = `+₱${salesBonus.toFixed(2)}`;
        salesBonusRow.style.display = 'grid';
    } else {
        salesBonusRow.style.display = 'none';
    }

    // Total pay
    document.getElementById('modalTotalPay').textContent = `₱${totalPay.toFixed(2)}`;

    // Check request status and update button
    const requestBtn = document.getElementById('modalRequestEditBtn');
    const requestBtnText = document.getElementById('modalRequestEditText');
    const historySection = document.getElementById('requestHistorySection');
    const historyList = document.getElementById('requestHistoryList');
    
    if (requestBtn) {
        // Store dayData for button click
        requestBtn.dataset.date = dayData.date;
        requestBtn.dataset.timeIn = dayData.timeIn || '';
        requestBtn.dataset.timeOut = dayData.timeOut || '';
        requestBtn.dataset.branch = dayData.branch || '';
        requestBtn.dataset.shift = dayData.shift || '';
        
        // Hide edit history section (as requested) - force hide and prevent it from showing
        if (historySection) {
            historySection.style.display = 'none';
            historySection.style.visibility = 'hidden';
        }
        
        // Clear cache for this date to ensure fresh data
        delete requestStatusCache[dayData.date];
        
        // Initially disable button while checking
        requestBtn.disabled = true;
        requestBtn.classList.add('request-edit-btn-pending');
        if (requestBtnText) {
            requestBtnText.textContent = 'Checking...';
        }
        
        // Check for pending request
        getRequestStatus(dayData.date).then(requestStatus => {
            if (requestStatus && requestStatus.status === 'pending') {
                requestBtn.disabled = true;
                requestBtn.classList.add('request-edit-btn-pending');
                if (requestBtnText) {
                    requestBtnText.textContent = 'Request Pending';
                }
            } else {
                requestBtn.disabled = false;
                requestBtn.classList.remove('request-edit-btn-pending');
                if (requestBtnText) {
                    requestBtnText.textContent = 'Request Edit';
                }
            }
        }).catch(error => {
            console.error("Error checking request status:", error);
            // On error, enable button (better UX than leaving it disabled)
            requestBtn.disabled = false;
            requestBtn.classList.remove('request-edit-btn-pending');
            if (requestBtnText) {
                requestBtnText.textContent = 'Request Edit';
            }
        });
        
        // Add click handler
        requestBtn.onclick = (e) => {
            e.stopPropagation();
            if (!requestBtn.disabled) {
                openRequestEditModal(
                    dayData.date,
                    dayData.timeIn || '',
                    dayData.timeOut || '',
                    dayData.branch || '',
                    dayData.shift || ''
                );
            }
        };
    }

    // Load photos in background
    if (dayData.photoIn) {
        const img = new Image();
        img.onload = () => {
            timeInThumb.src = dayData.photoIn;
            timeInThumb.style.display = 'block';
        };
        img.src = dayData.photoIn;
    }

    if (dayData.photoOut) {
        const img = new Image();
        img.onload = () => {
            timeOutThumb.src = dayData.photoOut;
            timeOutThumb.style.display = 'block';
        };
        img.src = dayData.photoOut;
    }
}

// Close modal
function closePayrollDetailModal() {
    const modal = document.getElementById('payrollDetailModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

// Open image modal
function openImageModal(src) {
    const modal = document.getElementById('imageModal');
    const img = document.getElementById('modalImage');
    if (modal && img) {
        img.src = src;
        modal.classList.add('show');
        modal.style.display = 'flex';
    }
}

// Close image modal
document.getElementById('imageModal')?.addEventListener('click', function() {
    this.classList.remove('show');
    setTimeout(() => {
        this.style.display = 'none';
    }, 300);
});

// RESTORED FROM OLD - Populate payroll periods
async function populatePayrollPeriods() {
    const selectElement = document.getElementById('payrollPeriod');
    if (!selectElement) return;

    selectElement.innerHTML = '';

    const today = new Date();
    const sixMonthsAgo = new Date(today);
    sixMonthsAgo.setMonth(today.getMonth() - 6);

    const periods = generatePayrollPeriods(sixMonthsAgo, today);

    // Sort by newest first
    periods.sort((a, b) => b.end - a.end);

    // Add all periods to the dropdown
    periods.forEach((period, index) => {
        const option = document.createElement('option');
        option.textContent = period.label;
        selectElement.appendChild(option);
    });

    // Try to restore last selected period from localStorage
    const lastPeriod = localStorage.getItem(`lastSelectedPeriod_${currentUser}`);
    let defaultPeriodIndex = 0;
    
    if (lastPeriod) {
        // Find the index of the last selected period
        const lastIndex = periods.findIndex(p => p.label === lastPeriod);
        if (lastIndex !== -1) {
            defaultPeriodIndex = lastIndex;
        }
    }

    // Set the default selection
    if (periods.length > 0) {
        selectElement.selectedIndex = defaultPeriodIndex;
    }
}

// RESTORED FROM OLD - Generate payroll periods with correct rules
// Cutoffs: 12th of month (3 days before 15th) and (end of month - 3 days)
// Period 1: 13th to (end of month - 3)
// Period 2: (end of prev month - 2) to 12th of next month
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

        // First cutoff: always the 12th of the month (3 days before 15th)
        const firstCutoffDay = 12;

        // Second cutoff: 3 days before end of month
        const secondCutoffDay = daysInMonth - 3;

        // Late month period: (13th to 3 days before end of month)
        const lateStart = new Date(year, month, 13);
        const lateEnd = new Date(year, month, secondCutoffDay);

        // Early month period: (3 days before end of prev month + 1) to 12th
        const earlyStart = new Date(year, month, secondCutoffDay + 1);
        const earlyEnd = new Date(year, month + 1, firstCutoffDay);

        if (lateStart <= endDate) {
            const lateLabel = formatPeriod(lateStart, lateEnd);
            periods.push({
                start: lateStart,
                end: lateEnd,
                label: lateLabel
            });
        }

        if (earlyStart <= endDate) {
            const earlyLabel = formatPeriod(earlyStart, earlyEnd);
            periods.push({
                start: earlyStart,
                end: earlyEnd,
                label: earlyLabel
            });
        }

        // Move to next month
        current = new Date(year, month + 1, 1);
    }

    // Sort periods with most recent first
    return periods.sort((a, b) => b.end - a.end);
}

// RESTORED FROM OLD - Format period label
function formatPeriod(start, end) {
    const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
    const startDay = start.getDate();
    const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
    const endDay = end.getDate();
    const year = end.getFullYear();

    if (startMonth === endMonth) {
        return `${startMonth} ${startDay}-${endDay}, ${year}`;
    } else {
        return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`;
    }
}

// Store current payroll data for payslip generation
let currentPayrollDataForPayslip = [];
let currentPeriodForPayslip = '';

    // Check if a period is the current/ongoing period
function isCurrentPeriod(periodLabel) {
    const [startMonth, startDay, endMonth, endDay, year] = parsePeriod(periodLabel);
    
    if (!startMonth || !endMonth || !year) {
        return false;
    }
    
    const { startDate, endDate } = createPeriodDates(startMonth, startDay, endMonth, endDay, year);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Normalize dates for comparison
    const normalizedStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const normalizedEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    
    // Check if today is within the period range
    return today >= normalizedStart && today <= normalizedEnd;
}

// Load payroll data
async function loadPayrollData() {
    const periodSelect = document.getElementById('payrollPeriod');
    if (!periodSelect) return;

    const selectedPeriod = periodSelect.value;
    if (!selectedPeriod) {
        console.error('No period selected');
        return;
    }
    
    localStorage.setItem(`lastSelectedPeriod_${currentUser}`, selectedPeriod);

    const [startMonth, startDay, endMonth, endDay, year] = parsePeriod(selectedPeriod);
    
    // Check if parsing succeeded
    if (!startMonth || !endMonth || !year) {
        console.error('Failed to parse period:', selectedPeriod);
        return;
    }
    
    const { startDate, endDate } = createPeriodDates(startMonth, startDay, endMonth, endDay, year);
    console.log('📅 Period dates created:', {
        period: selectedPeriod,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        startYear: startDate.getFullYear(),
        endYear: endDate.getFullYear()
    });
    const dates = getDatesInRange(startDate, endDate);
    console.log('📋 Date range:', dates.length, 'dates from', dates[0], 'to', dates[dates.length - 1]);

    const payrollData = await fetchPayrollData(dates);
    updatePayrollUI(payrollData);
    
    // Store data for payslip generation
    currentPayrollDataForPayslip = payrollData;
    currentPeriodForPayslip = selectedPeriod;
    
    // Show/hide download button based on whether this is the current period
    const downloadBtn = document.getElementById('downloadPayslipBtn');
    const downloadContainer = document.querySelector('.download-payslip-container');
    
    if (isCurrentPeriod(selectedPeriod)) {
        // Hide button for current/ongoing period
        if (downloadContainer) {
            downloadContainer.style.display = 'none';
        }
        console.log('📅 Current period detected - hiding download button');
    } else {
        // Show button for past periods
        if (downloadContainer) {
            downloadContainer.style.display = 'block';
        }
        console.log('✅ Past period - showing download button');
    }
}

// Generate and download payslip PDF
async function generatePayslipPDF() {
    console.log('📄 Generate payslip button clicked');
    const btn = document.getElementById('downloadPayslipBtn');
    if (!btn) {
        console.error('❌ Download button not found');
        return;
    }
    
    // Disable button during generation
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Generating...';
    
    try {
        console.log('📊 Current payroll data:', currentPayrollDataForPayslip?.length || 0, 'days');
        
        if (!currentPayrollDataForPayslip || currentPayrollDataForPayslip.length === 0) {
            alert('No payroll data available. Please select a period with attendance records.');
            btn.disabled = false;
            btn.innerHTML = originalText;
            return;
        }
        
        // Check if libraries are loaded
        if (typeof html2canvas === 'undefined') {
            console.error('❌ html2canvas not loaded');
            alert('PDF generation library not loaded. Please refresh the page.');
            btn.disabled = false;
            btn.innerHTML = originalText;
            return;
        }
        
        if (typeof window.jspdf === 'undefined') {
            console.error('❌ jsPDF not loaded');
            alert('PDF generation library not loaded. Please refresh the page.');
            btn.disabled = false;
            btn.innerHTML = originalText;
            return;
        }
        
        // Get employee info
        const employeeName = payrollEmployeeContext?.name || currentUserName || currentUser || 'Employee';
        const baseRate = payrollEmployeeContext?.baseRate || 750;
        const employeeRole = payrollEmployeeContext?.role || 'Barista';
        const transferMode = payrollEmployeeContext?.transferMode || 'GoTyme';
        
        // Group data by branch
        const branchData = {};
        const workedDays = currentPayrollDataForPayslip.filter(day => day.timeIn && day.timeOut);
        
        // Get PayCalculator for accurate calculations
        const calculator = getPayCalculatorPayroll();
        const employeeData = {
            baseRate: baseRate,
            salesBonusEligible: payrollEmployeeContext?.salesBonusEligible || false
        };
        
        workedDays.forEach(day => {
            const branch = day.branch || 'Unknown';
            if (!branchData[branch]) {
                branchData[branch] = {
                    days: [],
                    basicPay: 0,
                    mealAllowance: 0,
                    transportAllowance: 0,
                    overtimePay: 0,
                    lateDeduction: 0,
                    undertimeDeduction: 0,
                    holidayBonus: 0,
                    salesBonus: 0,
                    subtotal: 0
                };
            }
            
            // Breakdown values pulled from PayCalculator to keep parity with portal
            let basePortion = 0;
            let mealAllowance = 0;
            let lateDed = 0;
            let undertimeDed = 0;
            let holidayBonus = 0;
            let salesBonus = 0;
            let otPay = 0;
            let transpoAllowance = 0;
            let dailyTotal = 0;
            
            if (calculator) {
                // Use PayCalculator for accurate breakdown
                const result = calculator.calculateDailyPay(day, employeeData, 'detailed');
                const breakdown = result.breakdown || {};
                dailyTotal = result.total || 0;
                
                mealAllowance = breakdown.mealAllowance || 0;
                lateDed = breakdown.deductions?.late?.amount || 0;
                undertimeDed = breakdown.deductions?.undertime?.amount || 0;
                transpoAllowance = breakdown.bonuses?.transportation || day.transpoAllowance || 0;
                otPay = breakdown.bonuses?.overtime || 0;
                salesBonus = breakdown.bonuses?.sales || 0;

                if (breakdown.components) {
                    const holidayComponent = breakdown.components.find(c =>
                        c.type === 'holiday_bonus' || c.type === 'double_pay_bonus'
                    );
                    if (holidayComponent) {
                        holidayBonus = holidayComponent.amount || 0;
                    }
                }

                // Derive a base portion so the line items sum to the PayCalculator total
                basePortion = dailyTotal
                    - mealAllowance
                    - transpoAllowance
                    - otPay
                    - salesBonus
                    - holidayBonus
                    + lateDed
                    + undertimeDed;
            } else {
                // Fallback to manual calculation
                const isHalfDay = day.shift === "Closing Half-Day" || day.shift === "Opening Half-Day";
                const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
                mealAllowance = isHalfDay ? 75 : 150;
                lateDed = calculateLateDeduction(day);
                undertimeDed = calculateUndertimeDeduction(day);
                holidayBonus = calculateHolidayBonus(day, dailyRate);
                salesBonus = day.salesBonus || 0;
                transpoAllowance = day.transpoAllowance || 0;
                const otCalc = calculateOTPay(day, baseRate);
                otPay = otCalc.otPay;
                dailyTotal = (dailyRate + mealAllowance + transpoAllowance + otPay + holidayBonus + salesBonus) - (lateDed + undertimeDed);
                basePortion = dailyRate;
            }
            
            branchData[branch].days.push(day.date);
            branchData[branch].basicPay += basePortion;
            branchData[branch].mealAllowance += mealAllowance;
            branchData[branch].transportAllowance += transpoAllowance;
            branchData[branch].overtimePay += otPay;
            branchData[branch].lateDeduction += lateDed;
            branchData[branch].undertimeDeduction += undertimeDed;
            branchData[branch].holidayBonus += holidayBonus;
            branchData[branch].salesBonus += salesBonus;
            branchData[branch].subtotal += dailyTotal;
        });
        
        // Calculate grand total
        let grandTotal = 0;
        Object.keys(branchData).forEach(branch => {
            const data = branchData[branch];
            const subtotal = data.subtotal || (
                data.basicPay + data.mealAllowance + data.transportAllowance + 
                data.overtimePay + data.holidayBonus + data.salesBonus - data.lateDeduction - data.undertimeDeduction
            );
            branchData[branch].subtotal = subtotal;
            grandTotal += subtotal;
        });
        
        // Format period for display
        const formatPeriodForDisplay = (periodText) => {
            const [startMonth, startDay, endMonth, endDay, year] = parsePeriod(periodText);
            if (!startMonth || !endMonth) return periodText;
            
            const { startDate, endDate } = createPeriodDates(startMonth, startDay, endMonth, endDay, year);
            
            const startFormatted = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const endFormatted = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            
            if (startMonth === endMonth) {
                // Use the abbreviated month name
                const monthShort = startDate.toLocaleDateString('en-US', { month: 'short' });
                return `${monthShort} ${startDay} – ${endDay}, ${year}`;
            } else {
                return `${startFormatted} – ${endFormatted}, ${year}`;
            }
        };
        
        const formattedPeriod = formatPeriodForDisplay(currentPeriodForPayslip);
        
        // Format date helper
        const formatDateForPayslip = (dateStr) => {
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        };
        
        // Generate breakdown HTML by branch
        let breakdownHTML = '';
        Object.keys(branchData).forEach(branch => {
            const data = branchData[branch];
            const daysCount = data.days.length;
            
            // Sort dates and format them
            const sortedDates = [...new Set(data.days)].sort((a, b) => new Date(a) - new Date(b));
            const datesList = sortedDates.map(dateStr => {
                const date = new Date(dateStr);
                const formatted = formatDateForPayslip(dateStr);
                return `<li>${formatted}</li>`;
            }).join('');
            
            const subtotal = data.subtotal;
            
            breakdownHTML += `
<div style="background: #f1f9f2; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
<h4 style="margin: 0 0 0.5rem 0; color: #2b9348; font-size: 1.1rem; font-weight: 600;">${branch}</h4>
<strong style="display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 0.5rem;">
<span>DAYS WORKED</span>
<span>${daysCount} day${daysCount !== 1 ? "s" : ""}</span>
</strong>
<ul style="margin: 0.5rem 0 1rem 0; padding-left: 1.2rem; list-style-type: disc;">${datesList}</ul>
<p style="margin: 0.5rem 0; color: #333;">Basic Pay <span style="float:right">₱${data.basicPay.toFixed(2)}</span></p>
<p style="margin: 0.5rem 0; color: #333;">Meal Allowance <span style="float:right">₱${data.mealAllowance.toFixed(2)}</span></p>
${data.transportAllowance > 0 ? `<p style="margin: 0.5rem 0; color: #333;">Transport Allowance <span style="float:right">₱${data.transportAllowance.toFixed(2)}</span></p>` : ''}
${data.overtimePay > 0 ? `<p style="margin: 0.5rem 0; color: #333;">Overtime Hours <span style="float:right">₱${data.overtimePay.toFixed(2)}</span></p>` : ''}
${data.lateDeduction > 0 ? `<p style="margin: 0.5rem 0; color: #333;">Late Deduction <span style="float:right">–₱${data.lateDeduction.toFixed(2)}</span></p>` : ''}
${data.undertimeDeduction > 0 ? `<p style="margin: 0.5rem 0; color: #333;">Undertime Deduction <span style="float:right">–₱${data.undertimeDeduction.toFixed(2)}</span></p>` : ''}
${data.salesBonus > 0 ? `<p style="margin: 0.5rem 0; color: #2b9348;"><strong>Sales Bonus</strong> <span style="float:right">₱${data.salesBonus.toFixed(2)}</span></p>` : ''}
${data.holidayBonus > 0 ? `<p style="margin: 0.5rem 0; color: #2b9348;"><strong>Holiday Pay</strong> <span style="float:right">₱${data.holidayBonus.toFixed(2)}</span></p>` : ''}
<hr style="border: none; border-top: 1px solid #ddd; margin: 1rem 0;">
<strong style="display: block; margin-top: 0.5rem; color: #333;">Subtotal <span style="float:right">₱${subtotal.toFixed(2)}</span></strong>
</div>
`;
        });
        
        // Create payslip HTML matching old format
        const payslipHTML = `
<div style="font-family: 'Segoe UI', sans-serif; background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05); max-width: 800px; margin: 0 auto;">
<img src="https://matchanese.com/cdn/shop/files/matchanese-2025-logo_e4944ef8-b626-4206-80c5-cc4fd9ed79ab.png?v=1738086945&width=60" style="max-height: 50px; margin-bottom: 1rem;" />
<h2 style="margin: 0 0 0.5rem 0; font-size: 1.8rem; font-weight: 600; color: #333;">Your Salary Statement</h2>
<p style="margin: 0 0 2rem 0; color: #666; line-height: 1.6;">Hi ${employeeName}! Here's your salary statement for this payroll period. We hope everything looks all good — but if you have any questions, just let us know anytime.</p>
<div style="background: #eef9f0; padding: 1.5rem; border-radius: 10px; margin-bottom: 2rem;">
<div style="display: flex; justify-content: space-between; margin-bottom: 1.5rem; align-items: flex-start;">
<div style="display: flex; flex-direction: column;">
<strong style="font-size: 10px; letter-spacing: 0.05em; color: #555; text-transform: uppercase; margin-bottom: 0.25rem;">EMPLOYEE NAME</strong>
<span style="font-size: 22px; font-weight: 600; color: #000;">${employeeName}</span>
</div>
<div style="display: flex; flex-direction: column; text-align: right;">
<strong style="font-size: 10px; letter-spacing: 0.05em; color: #555; text-transform: uppercase; margin-bottom: 0.25rem;">TOTAL PAYMENT</strong>
<span style="font-size: 22px; font-weight: 600; color: #000;">₱${grandTotal.toFixed(2)}</span>
</div>
</div>
<div style="display: flex; justify-content: space-between;">
<div style="flex: 1; display: flex; flex-direction: column;">
<strong style="font-size: 10px; letter-spacing: 0.05em; color: #555; text-transform: uppercase; margin-bottom: 0.25rem;">ROLE</strong>
<span style="font-size: 17px; font-weight: 500;">${employeeRole}</span>
</div>
<div style="flex: 1; display: flex; flex-direction: column; align-items: center; text-align: center;">
<strong style="font-size: 10px; letter-spacing: 0.05em; color: #555; text-transform: uppercase; margin-bottom: 0.25rem;">PAYROLL PERIOD</strong>
<span style="font-size: 17px; font-weight: 500;">${formattedPeriod}</span>
</div>
<div style="flex: 1; display: flex; flex-direction: column; align-items: flex-end; text-align: right;">
<strong style="font-size: 10px; letter-spacing: 0.05em; color: #555; text-transform: uppercase; margin-bottom: 0.25rem;">MODE OF TRANSFER</strong>
<span style="font-size: 17px; font-weight: 500;">${transferMode}</span>
</div>
</div>
</div>
<div id="breakdown">${breakdownHTML}</div>
<div style="text-align: center; font-size: 0.85rem; color: #777; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e0e0e0;">
Matchanese, Inc.<br />
Unit 4506, Edades Tower, Amorsolo Drive, Rockwell, Makati City, Philippines
</div>
</div>
`;
        
        // Create temporary container for payslip
        const payslipContainer = document.createElement('div');
        payslipContainer.innerHTML = payslipHTML;
        payslipContainer.style.position = 'absolute';
        payslipContainer.style.left = '-9999px';
        payslipContainer.style.top = '0';
        payslipContainer.style.width = '800px';
        payslipContainer.style.background = 'white';
        document.body.appendChild(payslipContainer);
        
        // Wait a bit for rendering
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Generate PDF with optimized settings
        const canvas = await html2canvas(payslipContainer, {
            backgroundColor: '#ffffff',
            scale: 1.5, // Reduced from 2 to decrease file size
            logging: false,
            useCORS: true,
            width: 800,
            height: payslipContainer.scrollHeight
        });
        
        // Remove temporary container
        document.body.removeChild(payslipContainer);
        
        // Convert to PDF
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4',
            compress: true // Enable compression
        });
        
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        
        // Use JPEG with quality setting to reduce file size
        const imgData = canvas.toDataURL('image/jpeg', 0.92); // 92% quality for good balance
        const imgProps = pdf.getImageProperties(imgData);
        const pdfWidth = pageWidth - 20;
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        
        // Check if content fits on one page, otherwise add pages
        let yPosition = 10;
        const maxHeight = pageHeight - 20;
        
        if (pdfHeight > maxHeight) {
            // Content is too tall, split across pages
            let remainingHeight = pdfHeight;
            let sourceY = 0;
            const sourceHeight = canvas.height;
            const sourceWidth = canvas.width;
            
            while (remainingHeight > 0) {
                const pageHeightToUse = Math.min(maxHeight, remainingHeight);
                const sourceHeightToUse = (pageHeightToUse / pdfHeight) * sourceHeight;
                
                // Create a temporary canvas for this page
                const pageCanvas = document.createElement('canvas');
                pageCanvas.width = sourceWidth;
                pageCanvas.height = sourceHeightToUse;
                const pageCtx = pageCanvas.getContext('2d');
                pageCtx.drawImage(canvas, 0, sourceY, sourceWidth, sourceHeightToUse, 0, 0, sourceWidth, sourceHeightToUse);
                
                const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.92);
                pdf.addImage(pageImgData, 'JPEG', 10, yPosition, pdfWidth, pageHeightToUse);
                
                remainingHeight -= pageHeightToUse;
                sourceY += sourceHeightToUse;
                
                if (remainingHeight > 0) {
                    pdf.addPage();
                    yPosition = 10;
                }
            }
        } else {
            // Content fits on one page
            pdf.addImage(imgData, 'JPEG', 10, 10, pdfWidth, pdfHeight);
        }
        
        // Generate filename
        const employeeNameClean = employeeName.replace(/[^a-zA-Z0-9]/g, '_');
        const periodClean = currentPeriodForPayslip.replace(/[\s–,]+/g, '_');
        const filename = `matchanese_payslip_${employeeNameClean}_${periodClean}.pdf`;
        
        pdf.save(filename);
        
        console.log('✅ Payslip generated successfully');
    } catch (error) {
        console.error('❌ Error generating payslip:', error);
        alert('Failed to generate payslip. Please try again.');
    } finally {
        // Re-enable button
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🎬 Payroll module initializing for user:', currentUser);
    
    // No header in payroll view - it's embedded in iframe
    
    // Load employees
    await loadEmployees();
    console.log('👥 Employees loaded:', Object.keys(employees).length, 'employees');

    // Load employee-specific data from Firebase
    if (currentUser) {
        try {
            const employeeDoc = await getDoc(doc(db, "employees", currentUser));
            if (employeeDoc.exists()) {
                const employeeData = employeeDoc.data();
                payrollEmployeeContext = {
                    id: currentUser,
                    name: employeeData.nick || employeeData.name || employees[currentUser] || currentUser,
                    baseRate: employeeData.baseRate || 750,  // Use actual base rate from Firebase
                    salesBonusEligible: employeeData.salesBonusEligible || false,
                    role: employeeData.role || 'Barista',
                    transferMode: employeeData.transferMode || employeeData.modeOfTransfer || 'GoTyme'
                };
                console.log('✅ Employee context set:', payrollEmployeeContext);
            } else {
                console.warn('⚠️ Employee doc not found, using defaults');
                payrollEmployeeContext = {
                    id: currentUser,
                    name: employees[currentUser] || currentUser,
                    baseRate: 750,
                    salesBonusEligible: false,
                    role: 'Barista',
                    transferMode: 'GoTyme'
                };
            }
        } catch (err) {
            console.error('❌ Error loading employee data:', err);
            // Fallback to basic context
            payrollEmployeeContext = {
                id: currentUser,
                name: employees[currentUser] || currentUser,
                baseRate: 750,
                salesBonusEligible: false,
                role: 'Barista',
                transferMode: 'GoTyme'
            };
        }
    } else {
        console.error('❌ No current user found!');
    }

    // Load holidays (matching admin payroll path)
    if (!holidaysLoaded) {
        try {
            const holidaysSnap = await getDoc(doc(db, "config", "holidays_2025"));
            if (holidaysSnap.exists()) {
                HOLIDAYS_2025 = holidaysSnap.data();
                holidaysLoaded = true;
                console.log('✅ Holidays loaded:', Object.keys(HOLIDAYS_2025).length, 'holidays');
            } else {
                console.warn('⚠️ Holidays document not found at config/holidays_2025');
            }
        } catch (err) {
            console.error('❌ Error loading holidays:', err);
        }
    }

    // Load sales data only if employee is eligible (matching admin payroll)
    // IMPORTANT: Sales bonus is only for SM North, so always load SM North sales data
    let salesData = {};
    if (payrollEmployeeContext && payrollEmployeeContext.salesBonusEligible) {
        salesData = await loadSalesData('sm-north');
    }

    // Initialize PayCalculator with holidays and sales data (matching admin payroll)
    payCalculatorPayroll = new window.PayCalculator(HOLIDAYS_2025 || {}, salesData || {});
    console.log('✅ PayCalculator initialized with holidays and sales data');

    // Populate periods
    await populatePayrollPeriods();

    // Load initial data
    await loadPayrollData();

    // Listen for period changes
    document.getElementById('payrollPeriod')?.addEventListener('change', loadPayrollData);
    
    // Listen for payslip download button - use setTimeout to ensure DOM is ready
    setTimeout(() => {
        const downloadBtn = document.getElementById('downloadPayslipBtn');
        if (downloadBtn) {
            console.log('✅ Download button found, attaching event listener');
            // Remove any existing listeners first to prevent duplicates
            const newBtn = downloadBtn.cloneNode(true);
            downloadBtn.parentNode.replaceChild(newBtn, downloadBtn);
            // Attach single event listener
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                generatePayslipPDF();
            });
        } else {
            console.error('❌ Download button not found in DOM');
        }
        
        // Listen for request new date button
        const requestNewDateBtn = document.getElementById('requestNewDateBtn');
        if (requestNewDateBtn) {
            requestNewDateBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openRequestNewDateModal();
            });
        }
    }, 100);
    
    // Handle new date form submission
    const newDateForm = document.getElementById('requestNewDateForm');
    if (newDateForm) {
        newDateForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const date = document.getElementById('newDateDate').value;
            const timeIn24 = document.getElementById('newDateTimeIn').value;
            const timeOut24 = document.getElementById('newDateTimeOut').value;
            const branch = document.getElementById('newDateBranch').value;
            const shift = document.getElementById('newDateShift').value;
            const requestOT = document.getElementById('newDateOT').checked;
            const reason = (document.getElementById('newDateReason').value || '').trim();
            if (!reason) {
                showToast("Please add a reason/note for this request.", 'warning');
                return;
            }
            
            // Check for pending request on this date
            const dateStatus = await getRequestStatus(date);
            if (dateStatus && dateStatus.status === 'pending') {
                showToast("You already have a pending request for this date. Please wait for it to be reviewed.", 'warning');
                return;
            }
            
            // Check if date already exists in attendance
            try {
                const attendanceRef = doc(db, "attendance", currentUser, "dates", date);
                const attendanceSnap = await getDoc(attendanceRef);
                if (attendanceSnap.exists()) {
                    showToast("This date already has attendance data. Please use 'Request Edit' instead.", 'warning');
                    return;
                }
            } catch (error) {
                console.error("Error checking attendance:", error);
            }
            
            // Convert times to 12-hour format
            const timeIn12 = time24to12(timeIn24);
            const timeOut12 = time24to12(timeOut24);
            
            const requestData = {
                date: date,
                timeIn: timeIn12,
                timeOut: timeOut12,
                branch: branch,
                shift: shift,
                requestOT: requestOT,
                reason: reason
            };
            
            const success = await submitPayrollRequest(requestData, true);
            if (success) {
                showToast("Request submitted successfully!", 'success');
                closeRequestNewDateModal();
                await loadPayrollData();
            }
        });
    }
});

// Request Edit Modal Functions
async function openRequestEditModal(date, timeIn, timeOut, branch = '', shift = '') {
    const modal = document.getElementById('requestEditModal');
    if (!modal) return;
    
    // Set current date
    document.getElementById('requestDate').value = date;
    
    // Convert and set times (handle empty/null values)
    const timeIn24 = timeIn ? time12to24(timeIn) : '';
    const timeOut24 = timeOut ? time12to24(timeOut) : '';
    document.getElementById('requestTimeIn').value = timeIn24 || '09:00';
    document.getElementById('requestTimeOut').value = timeOut24 || '18:00';
    
    // Set branch and shift
    const branchSelect = document.getElementById('requestBranch');
    const shiftSelect = document.getElementById('requestShift');
    if (branchSelect && branch) {
        branchSelect.value = branch;
    }
    if (shiftSelect && shift) {
        shiftSelect.value = shift;
    }
    
    // Reset form
    document.getElementById('requestReason').value = '';
    
    // Check if OT is already applied for this date
    const otCheckbox = document.getElementById('requestOT');
    const otLabel = document.getElementById('requestOTLabel');
    const otText = document.getElementById('requestOTText');
    const otAppliedIndicator = document.getElementById('otAppliedIndicator');
    
    // Fetch attendance data to check if OT is already applied
    try {
        const attendanceRef = doc(db, "attendance", currentUser, "dates", date);
        const attendanceSnap = await getDoc(attendanceRef);
        
        if (attendanceSnap.exists()) {
            const data = attendanceSnap.data();
            if (data.hasOTPay) {
                // OT is already applied - grey out checkbox
                otCheckbox.disabled = true;
                otCheckbox.checked = true;
                otLabel.style.opacity = '0.6';
                otLabel.style.cursor = 'not-allowed';
                otText.textContent = 'OT Applied';
                otText.style.color = '#9ca3af';
                otAppliedIndicator.style.display = 'block';
            } else {
                // OT not applied - enable checkbox
                otCheckbox.disabled = false;
                otCheckbox.checked = false;
                otLabel.style.opacity = '1';
                otLabel.style.cursor = 'pointer';
                otText.textContent = 'Request Overtime Pay';
                otText.style.color = '#333';
                otAppliedIndicator.style.display = 'none';
            }
        } else {
            // No attendance data - enable checkbox
            otCheckbox.disabled = false;
            otCheckbox.checked = false;
            otLabel.style.opacity = '1';
            otLabel.style.cursor = 'pointer';
            otText.textContent = 'Request Overtime Pay';
            otText.style.color = '#333';
            otAppliedIndicator.style.display = 'none';
        }
    } catch (error) {
        console.error("Error checking OT status:", error);
        // On error, enable checkbox
        otCheckbox.disabled = false;
        otLabel.style.opacity = '1';
        otText.textContent = 'Request Overtime Pay';
        otAppliedIndicator.style.display = 'none';
    }
    
    // Store current data for comparison
    modal.dataset.currentDate = date;
    modal.dataset.currentTimeIn = timeIn;
    modal.dataset.currentTimeOut = timeOut;
    modal.dataset.currentBranch = branch || '';
    modal.dataset.currentShift = shift || '';
    
    // Check and store if current date has OT pay (for date change requests)
    let currentHasOTPay = false;
    try {
        const attendanceRef = doc(db, "attendance", currentUser, "dates", date);
        const attendanceSnap = await getDoc(attendanceRef);
        if (attendanceSnap.exists()) {
            currentHasOTPay = attendanceSnap.data().hasOTPay || false;
        }
    } catch (error) {
        console.error("Error checking OT status:", error);
    }
    modal.dataset.currentHasOTPay = currentHasOTPay ? 'true' : 'false';
    
    // Check for pending request and disable form if found
    // Need to check BOTH the original current date and the date in the form (in case user changes it)
    const requestForm = document.getElementById('requestEditForm');
    const originalCurrentDate = modal.dataset.currentDate; // This is the ORIGINAL date we're changing from
    
    // Check both the original current date (always) and the date in the form (if different)
    const [originalDateStatus, formDateStatus] = await Promise.all([
        getRequestStatus(originalCurrentDate), // Always check the original date
        date !== originalCurrentDate ? getRequestStatus(date) : Promise.resolve(null)
    ]);
    
    const hasPendingRequest = (originalDateStatus && originalDateStatus.status === 'pending') || 
                             (formDateStatus && formDateStatus.status === 'pending');
    
    const submitBtn = requestForm?.querySelector('button[type="submit"]');
    
    if (hasPendingRequest) {
        // Disable all form inputs
        if (requestForm) {
            const inputs = requestForm.querySelectorAll('input, textarea, button[type="submit"]');
            inputs.forEach(input => {
                input.disabled = true;
            });
        }
        if (submitBtn) {
            submitBtn.textContent = 'Request Pending';
            submitBtn.style.opacity = '0.6';
            submitBtn.style.cursor = 'not-allowed';
        }
    } else {
        // Initially disable submit button - will be enabled when changes are detected
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.6';
            submitBtn.style.cursor = 'not-allowed';
            submitBtn.textContent = 'Submit Request';
        }
        
        // Enable all form inputs (except OT checkbox if it's already applied and submit button)
        if (requestForm) {
            const inputs = requestForm.querySelectorAll('input, textarea, select');
            inputs.forEach(input => {
                if (input.id !== 'requestOT' || !otCheckbox?.disabled) {
                    input.disabled = false;
                }
            });
        }
        
        // Add change detection to enable submit button when changes are made
        const checkForChanges = async () => {
            const currentDate = modal.dataset.currentDate;
            const currentTimeIn = modal.dataset.currentTimeIn;
            const currentTimeOut = modal.dataset.currentTimeOut;
            const currentBranch = modal.dataset.currentBranch || '';
            const currentShift = modal.dataset.currentShift || '';
            
            const formDate = document.getElementById('requestDate')?.value || '';
            const formTimeIn24 = document.getElementById('requestTimeIn')?.value || '';
            const formTimeOut24 = document.getElementById('requestTimeOut')?.value || '';
            const formBranch = document.getElementById('requestBranch')?.value || '';
            const formShift = document.getElementById('requestShift')?.value || '';
            const formOT = document.getElementById('requestOT')?.checked || false;
            
            // Convert times for comparison
            const formTimeIn12 = formTimeIn24 ? time24to12(formTimeIn24) : '';
            const formTimeOut12 = formTimeOut24 ? time24to12(formTimeOut24) : '';
            
            // Normalize times for comparison (remove seconds if present)
            // This ensures "10:34 AM" matches "10:34:09 AM"
            const normalizedFormTimeIn = normalizeTimeForComparison(formTimeIn12);
            const normalizedFormTimeOut = normalizeTimeForComparison(formTimeOut12);
            const normalizedCurrentTimeIn = normalizeTimeForComparison(currentTimeIn || '');
            const normalizedCurrentTimeOut = normalizeTimeForComparison(currentTimeOut || '');
            
            // Check if OT checkbox is enabled (not already applied)
            const otCheckbox = document.getElementById('requestOT');
            const actualRequestOT = otCheckbox && !otCheckbox.disabled && formOT;
            
            const dateChanged = formDate !== currentDate;
            const timeInChanged = normalizedFormTimeIn !== normalizedCurrentTimeIn;
            const timeOutChanged = normalizedFormTimeOut !== normalizedCurrentTimeOut;
            const branchChanged = formBranch !== currentBranch;
            const shiftChanged = formShift !== currentShift;
            
            const hasChanges = dateChanged || timeInChanged || timeOutChanged || branchChanged || shiftChanged || actualRequestOT;
            
            // If date changed, also check for pending requests on both dates
            let hasPendingRequest = false;
            if (dateChanged) {
                const [originalDateStatus, newDateStatus] = await Promise.all([
                    getRequestStatus(currentDate),
                    getRequestStatus(formDate)
                ]);
                hasPendingRequest = (originalDateStatus && originalDateStatus.status === 'pending') || 
                                   (newDateStatus && newDateStatus.status === 'pending');
            }
            
            if (submitBtn) {
                if (hasPendingRequest) {
                    submitBtn.disabled = true;
                    submitBtn.style.opacity = '0.6';
                    submitBtn.style.cursor = 'not-allowed';
                    submitBtn.textContent = 'Request Pending';
                } else if (hasChanges) {
                    submitBtn.disabled = false;
                    submitBtn.style.opacity = '1';
                    submitBtn.style.cursor = 'pointer';
                    submitBtn.textContent = 'Submit Request';
                } else {
                    submitBtn.disabled = true;
                    submitBtn.style.opacity = '0.6';
                    submitBtn.style.cursor = 'not-allowed';
                    submitBtn.textContent = 'Submit Request';
                }
            }
        };
        
        // Add listeners to all form fields
        const formFields = ['requestDate', 'requestTimeIn', 'requestTimeOut', 'requestBranch', 'requestShift', 'requestOT'];
        formFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('change', checkForChanges);
                field.addEventListener('input', checkForChanges);
            }
        });
        
        // Initial check
        checkForChanges();
    }
    
    
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
}

function closeRequestEditModal() {
    const modal = document.getElementById('requestEditModal');
    if (!modal) return;
    
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

// Handle request form submission
document.addEventListener('DOMContentLoaded', () => {
    const requestForm = document.getElementById('requestEditForm');
    if (requestForm) {
        requestForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const modal = document.getElementById('requestEditModal');
            const date = document.getElementById('requestDate').value;
            const currentDate = modal.dataset.currentDate;
            
            // Check for pending request before submitting - check BOTH dates
            const [currentStatus, requestedStatus] = await Promise.all([
                getRequestStatus(currentDate),
                date !== currentDate ? getRequestStatus(date) : Promise.resolve(null)
            ]);
            
            if ((currentStatus && currentStatus.status === 'pending') || 
                (requestedStatus && requestedStatus.status === 'pending')) {
                showToast("You already have a pending request for this date. Please wait for it to be reviewed.", 'warning');
                return;
            }
            
            const timeIn24 = document.getElementById('requestTimeIn').value;
            const timeOut24 = document.getElementById('requestTimeOut').value;
            const requestOT = document.getElementById('requestOT').checked;
            const reason = (document.getElementById('requestReason').value || '').trim();
            if (!reason) {
                showToast("Please add a reason/note for this request.", 'warning');
                return;
            }
            
            // Convert back to 12-hour format for storage
            const timeIn12 = time24to12(timeIn24);
            const timeOut12 = time24to12(timeOut24);
            
            // currentDate is already declared above, just get the other values
            const currentTimeIn = modal.dataset.currentTimeIn;
            const currentTimeOut = modal.dataset.currentTimeOut;
            const currentBranch = modal.dataset.currentBranch || '';
            const currentShift = modal.dataset.currentShift || '';
            
            // Get requested branch and shift from form
            const requestedBranch = document.getElementById('requestBranch')?.value || '';
            const requestedShift = document.getElementById('requestShift')?.value || '';
            
            // Only submit OT request if checkbox is enabled (not already applied)
            const otCheckbox = document.getElementById('requestOT');
            const actualRequestOT = otCheckbox && !otCheckbox.disabled && requestOT;
            
            // Get current OT status (for date change requests - to preserve OT)
            const currentHasOTPay = modal.dataset.currentHasOTPay === 'true';
            
            // Normalize times for comparison (remove seconds if present)
            // This ensures "10:34 AM" matches "10:34:09 AM"
            const normalizedTimeIn12 = normalizeTimeForComparison(timeIn12);
            const normalizedTimeOut12 = normalizeTimeForComparison(timeOut12);
            const normalizedCurrentTimeIn = normalizeTimeForComparison(currentTimeIn || '');
            const normalizedCurrentTimeOut = normalizeTimeForComparison(currentTimeOut || '');
            
            // Validate that at least one field has changed
            const dateChanged = date !== currentDate;
            const timeInChanged = normalizedTimeIn12 !== normalizedCurrentTimeIn;
            const timeOutChanged = normalizedTimeOut12 !== normalizedCurrentTimeOut;
            const branchChanged = requestedBranch !== currentBranch;
            const shiftChanged = requestedShift !== currentShift;
            
            if (!dateChanged && !timeInChanged && !timeOutChanged && !branchChanged && !shiftChanged && !actualRequestOT) {
                showToast("No changes detected. Please modify at least one field before submitting.", 'warning');
                return;
            }
            
            const requestData = {
                date: date,
                timeIn: timeIn12,
                timeOut: timeOut12,
                branch: requestedBranch,
                shift: requestedShift,
                requestOT: actualRequestOT,
                reason: reason,
                currentData: {
                    date: currentDate,
                    timeIn: currentTimeIn,
                    timeOut: currentTimeOut,
                    branch: currentBranch,
                    shift: currentShift,
                    hasOTPay: currentHasOTPay // Include OT status from current date
                }
            };
            
            const success = await submitPayrollRequest(requestData);
            if (success) {
                showToast("Request submitted successfully!", 'success');
                closeRequestEditModal();
                // Close detail modal and reload payroll data
                closePayrollDetailModal();
                await loadPayrollData();
            }
        });
    }
});

// Request New Date Modal Functions
function openRequestNewDateModal() {
    const modal = document.getElementById('requestNewDateModal');
    if (!modal) return;
    
    // Reset form
    document.getElementById('newDateDate').value = '';
    document.getElementById('newDateTimeIn').value = '09:00';
    document.getElementById('newDateTimeOut').value = '18:00';
    document.getElementById('newDateBranch').value = 'Podium';
    document.getElementById('newDateShift').value = 'Midshift';
    document.getElementById('newDateOT').checked = false;
    document.getElementById('newDateReason').value = '';
    
    // Initially disable submit button
    const submitBtn = document.getElementById('newDateSubmitBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.6';
        submitBtn.style.cursor = 'not-allowed';
    }
    
    // Add change detection
    const checkForChanges = () => {
        const date = document.getElementById('newDateDate')?.value || '';
        const timeIn = document.getElementById('newDateTimeIn')?.value || '';
        const timeOut = document.getElementById('newDateTimeOut')?.value || '';
        const hasData = date && timeIn && timeOut;
        
        if (submitBtn) {
            if (hasData) {
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
            } else {
                submitBtn.disabled = true;
                submitBtn.style.opacity = '0.6';
                submitBtn.style.cursor = 'not-allowed';
            }
        }
    };
    
    // Add listeners
    const formFields = ['newDateDate', 'newDateTimeIn', 'newDateTimeOut'];
    formFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('change', checkForChanges);
            field.addEventListener('input', checkForChanges);
        }
    });
    
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.classList.add('show');
    });
}

function closeRequestNewDateModal() {
    const modal = document.getElementById('requestNewDateModal');
    if (!modal) return;
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

// Make functions global for modal
window.closePayrollDetailModal = closePayrollDetailModal;
window.openImageModal = openImageModal;
window.generatePayslipPDF = generatePayslipPDF;
window.openRequestEditModal = openRequestEditModal;
window.closeRequestEditModal = closeRequestEditModal;
window.openRequestNewDateModal = openRequestNewDateModal;
window.closeRequestNewDateModal = closeRequestNewDateModal;

