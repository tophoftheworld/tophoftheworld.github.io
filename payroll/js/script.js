// Import Firebase setup
import { db } from '../../attendance/js/firebase-setup.js';
import { doc, getDoc, getDocs, collection, collectionGroup, query, where } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

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

// Initialize PayCalculator
function getPayCalculatorPayroll(salesData = null) {
    try {
        if (typeof window === 'undefined' || !window.PayCalculator) return null;
        if (!payCalculatorPayroll) {
            payCalculatorPayroll = new window.PayCalculator(HOLIDAYS_2025 || {}, salesData || {});
        } else {
            if (salesData) payCalculatorPayroll.updateSalesData(salesData);
            if (HOLIDAYS_2025) payCalculatorPayroll.updateHolidays(HOLIDAYS_2025);
        }
        return payCalculatorPayroll;
    } catch (e) {
        console.error('Failed to init PayCalculator for payroll:', e);
        return null;
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

// RESTORED FROM OLD - Calculate daily pay
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
        dates.forEach(dateStr => {
            const data = attendanceMap[dateStr];
            
            // Debug sales bonus loading
            if (data?.salesBonus) {
                console.log(`📊 Sales bonus found for ${dateStr}:`, data.salesBonus);
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

        return payrollData;
    } catch (error) {
        console.error("Failed to fetch payroll data:", error);
        return [];
    }
}

// RESTORED FROM OLD - Update payroll UI
function updatePayrollUI(payrollData) {
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

    const sortedPayrollData = payrollData.sort((a, b) => new Date(b.date) - new Date(a.date));
    const today = new Date();
    const isToday = (date) => formatDate(today) === date;

    sortedPayrollData.forEach(day => {
        if (!day.timeIn && !day.timeOut) return;

        const card = document.createElement('div');
        card.className = 'payroll-card';

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

        card.addEventListener('click', () => openPayrollDetailModal(day, card));
        cardsContainer.appendChild(card);
    });
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

    // RESTORED - Calculate pay breakdown
    const baseRate = dayData.baseRate || 750;
    const isHalfDay = dayData.shift === "Closing Half-Day";
    const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
    const mealAllowance = isHalfDay ? 75 : 150;

    document.getElementById('modalBaseRate').textContent = `₱${dailyRate.toFixed(2)}`;
    document.getElementById('modalMealAllow').textContent = `₱${mealAllowance.toFixed(2)}`;

    // Calculate deductions and show/hide rows
    const lateDeduction = calculateLateDeduction(dayData);
    const undertimeDeduction = calculateUndertimeDeduction(dayData);
    const holidayBonus = calculateHolidayBonus(dayData, dailyRate);

    const lateDeductionRow = document.getElementById('modalLateDeductionRow');
    const undertimeDeductionRow = document.getElementById('modalUndertimeDeductionRow');
    const holidayBonusRow = document.getElementById('modalHolidayBonusRow');

    if (lateDeduction > 0) {
        const lateInfo = formatLateTime(dayData.timeIn, dayData.scheduledIn);
        document.getElementById('modalLateHours').textContent = lateInfo.text;
        document.getElementById('modalLateDeduction').textContent = `-₱${lateDeduction.toFixed(2)}`;
        lateDeductionRow.style.display = 'grid';
    } else {
        lateDeductionRow.style.display = 'none';
    }

    // Check for undertime
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

    if (holidayBonus > 0) {
        const multiplier = getHolidayPayMultiplier(dayData.date);
        const holidayType = multiplier === 2.0 ? 'Regular' : 'Special';
        document.getElementById('modalHolidayType').textContent = holidayType;
        document.getElementById('modalHolidayBonus').textContent = `+₱${holidayBonus.toFixed(2)}`;
        holidayBonusRow.style.display = 'grid';
    } else {
        holidayBonusRow.style.display = 'none';
    }

    // Add OT calculation and display
    const otCalculation = calculateOTPay(dayData, dayData.baseRate || 750);
    const otBonusRow = document.getElementById('modalOTBonusRow');

    if (otCalculation.otPay > 0) {
        document.getElementById('modalOTHours').textContent = `${otCalculation.otHours.toFixed(1)}h`;
        document.getElementById('modalOTBonus').textContent = `+₱${otCalculation.otPay.toFixed(2)}`;
        otBonusRow.style.display = 'grid';
    } else {
        otBonusRow.style.display = 'none';
    }

    // Read sales bonus from data (set by admin app in Firestore)
    const salesBonus = dayData.salesBonus || 0;
    
    const salesBonusRow = document.getElementById('modalSalesBonusRow');
    if (salesBonus > 0) {
        document.getElementById('modalSalesBonus').textContent = `+₱${salesBonus.toFixed(2)}`;
        salesBonusRow.style.display = 'grid';
    } else {
        salesBonusRow.style.display = 'none';
    }

    // Calculate total pay
    const totalPay = calculateDailyPay(dayData, baseRate);
    document.getElementById('modalTotalPay').textContent = `₱${totalPay.toFixed(2)}`;

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
    
    const startDate = new Date(year, getMonthIndex(startMonth), parseInt(startDay));
    const endDate = new Date(year, getMonthIndex(endMonth), parseInt(endDay));
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
    
    const startDate = new Date(year, getMonthIndex(startMonth), parseInt(startDay));
    const endDate = new Date(year, getMonthIndex(endMonth), parseInt(endDay));
    const dates = getDatesInRange(startDate, endDate);

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
                    holidayBonus: 0,
                    salesBonus: 0
                };
            }
            
            const isHalfDay = day.shift === "Closing Half-Day" || day.shift === "Opening Half-Day";
            const dailyRate = isHalfDay ? baseRate / 2 : baseRate;
            const mealAllowance = isHalfDay ? 75 : 150;
            const lateDed = calculateLateDeduction(day);
            const holidayBonus = calculateHolidayBonus(day, dailyRate);
            const salesBonus = day.salesBonus || 0;
            const otCalc = calculateOTPay(day, baseRate);
            const transpoAllowance = day.transpoAllowance || 0;
            
            branchData[branch].days.push(day.date);
            branchData[branch].basicPay += dailyRate;
            branchData[branch].mealAllowance += mealAllowance;
            branchData[branch].transportAllowance += transpoAllowance;
            branchData[branch].overtimePay += otCalc.otPay;
            branchData[branch].lateDeduction += lateDed;
            branchData[branch].holidayBonus += holidayBonus;
            branchData[branch].salesBonus += salesBonus;
        });
        
        // Calculate grand total
        let grandTotal = 0;
        Object.keys(branchData).forEach(branch => {
            const data = branchData[branch];
            const subtotal = data.basicPay + data.mealAllowance + data.transportAllowance + 
                           data.overtimePay + data.holidayBonus + data.salesBonus - data.lateDeduction;
            grandTotal += subtotal;
        });
        
        // Format period for display
        const formatPeriodForDisplay = (periodText) => {
            const [startMonth, startDay, endMonth, endDay, year] = parsePeriod(periodText);
            if (!startMonth || !endMonth) return periodText;
            
            const startDate = new Date(year, getMonthIndex(startMonth), parseInt(startDay));
            const endDate = new Date(year, getMonthIndex(endMonth), parseInt(endDay));
            
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
            
            const subtotal = data.basicPay + data.mealAllowance + data.transportAllowance + 
                           data.overtimePay + data.holidayBonus + data.salesBonus - data.lateDeduction;
            
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
                role: 'Barista',
                transferMode: 'GoTyme'
            };
        }
    } else {
        console.error('❌ No current user found!');
    }

    // Load holidays
    if (!holidaysLoaded) {
        try {
            const holidaysSnap = await getDoc(doc(db, "settings", "holidays"));
            if (holidaysSnap.exists()) {
                HOLIDAYS_2025 = holidaysSnap.data();
                holidaysLoaded = true;
                console.log('✅ Holidays loaded:', Object.keys(HOLIDAYS_2025).length, 'holidays');
            }
        } catch (err) {
            console.error('❌ Error loading holidays:', err);
        }
    }

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
    }, 100);
});

// Make functions global for modal
window.closePayrollDetailModal = closePayrollDetailModal;
window.openImageModal = openImageModal;
window.generatePayslipPDF = generatePayslipPDF;

