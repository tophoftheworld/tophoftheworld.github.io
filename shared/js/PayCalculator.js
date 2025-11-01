/**
 * PayCalculator - Universal Pay Calculation Engine
 * 
 * Provides consistent pay calculations across all applications.
 * Single source of truth for all payroll computations.
 * 
 * Usage:
 *   const calculator = new PayCalculator(holidays, salesData);
 *   const result = calculator.calculateDailyPay(dateEntry, employee);
 *   console.log(result.total); // 1595.31
 *   console.log(result.breakdown); // Detailed breakdown object
 */

class PayCalculator {
    constructor(holidays = {}, salesData = {}) {
        // console.log('PayCalculator constructor called with:', {
        //     holidaysCount: Object.keys(holidays).length,
        //     salesDataCount: Object.keys(salesData).length
        // });

        this.HOLIDAYS = holidays;
        this.salesData = salesData; // Make sure this line exists

        // Configuration constants
        this.DAILY_MEAL_ALLOWANCE = 150;
        this.LATE_THRESHOLD_MINUTES = 30;
        this.UNDERTIME_THRESHOLD_MINUTES = 30;
        this.STANDARD_WORK_HOURS = 8;
        this.HALF_DAY_HOURS = 4;

        // Shift schedules for reference
        this.SHIFT_SCHEDULES = {
            "Opening": { timeIn: "9:30 AM", timeOut: "6:30 PM" },
            "Opening Half-Day": { timeIn: "9:30 AM", timeOut: "1:30 PM" },
            "Midshift": { timeIn: "11:00 AM", timeOut: "8:00 PM" },
            "Closing": { timeIn: "1:00 PM", timeOut: "10:00 PM" },
            "Closing Half-Day": { timeIn: "6:00 PM", timeOut: "10:00 PM" },
            "Custom": { timeIn: null, timeOut: null }
        };

        // Sales bonus configuration
        this.SALES_BONUS_CONFIG = {
            baseQuotaPerStaff: 5000,
            bonusPerTier: 25,
            tierAmount: 2500,
            defaultStaffing: {
                weekday: 2.5,
                weekend: 3.0
            }
        };
    }

    /**
     * Main calculation method - calculates daily pay with detailed breakdown
     * @param {Object} dateEntry - Attendance data for the day
     * @param {Object} employee - Employee data with base rate, etc.
     * @param {string} outputMode - 'simple' | 'detailed' | 'legacy' (default: 'detailed')
     * @returns {Object|number} { total: number, breakdown: object } or just number if simple mode
     */
    calculateDailyPay(dateEntry, employee, outputMode = 'detailed') {
        // Normalize input data - handle different property names and formats
        const normalizedEntry = this._normalizeAttendanceEntry(dateEntry);
        const normalizedEmployee = this._normalizeEmployeeData(employee);

        // Validate required data
        const validation = this._validateInputs(normalizedEntry, normalizedEmployee);
        if (!validation.isValid) {
            if (outputMode === 'simple') return 0;
            return {
                total: 0,
                breakdown: {
                    payType: "Error",
                    error: validation.error
                }
            };
        }

        const baseRate = normalizedEmployee.baseRate;
        const dateStr = normalizedEntry.date;

        // Initialize breakdown object
        const breakdown = {
            payType: "Regular Pay",
            baseRate: baseRate,
            adjustedBaseRate: baseRate,
            mealAllowance: 0,
            deductions: {
                late: { hours: 0, amount: 0 },
                undertime: { hours: 0, amount: 0 }
            },
            bonuses: {
                holiday: 0,
                overtime: 0,
                sales: 0,
                transportation: 0
            },
            components: []
        };

        let result;

        // Check for fixed pay first (highest priority)
        if (normalizedEntry.hasFixedPay && normalizedEntry.fixedPayAmount > 0) {
            result = this._calculateFixedPay(normalizedEntry, normalizedEmployee, breakdown);
        } else {
            // Determine pay type and multiplier
            let multiplier = 1.0;

            if (normalizedEntry.hasDoublePay) {
                multiplier = 2.0;
                breakdown.payType = "Double Pay (2x base rate)";
            } else {
                const holidayMultiplier = this.getHolidayPayMultiplier(dateStr);
                if (holidayMultiplier > 1.0) {
                    multiplier = holidayMultiplier;
                    const holidayInfo = this.HOLIDAYS[dateStr];
                    breakdown.payType = `Holiday Pay (${multiplier}x) - ${holidayInfo?.name || 'Holiday'}`;
                }
            }

            // Calculate based on shift type
            if (normalizedEntry.shift === "Custom") {
                result = this._calculateCustomShiftPay(normalizedEntry, normalizedEmployee, breakdown, multiplier);
            } else {
                result = this._calculateRegularShiftPay(normalizedEntry, normalizedEmployee, breakdown, multiplier);
            }
        }

        // Return based on output mode
        switch (outputMode) {
            case 'simple':
                return result.total;
            case 'legacy':
                // For compatibility with existing admin app
                return result.total;
            default:
                return result;
        }
    }

    /**
     * Calculate total pay for multiple dates (batch processing)
     * @param {Array} dateEntries - Array of attendance entries
     * @param {Object} employee - Employee data
     * @param {string} outputMode - Output format
     * @returns {Object} { total: number, entries: Array, breakdown: Object }
     */
    calculateTotalPay(dateEntries, employee, outputMode = 'detailed') {
        if (!Array.isArray(dateEntries) || dateEntries.length === 0) {
            return outputMode === 'simple' ? 0 : { total: 0, entries: [], breakdown: {} };
        }

        const results = dateEntries.map(entry => {
            const dailyResult = this.calculateDailyPay(entry, employee, 'detailed');
            return {
                date: entry.date,
                total: dailyResult.total,
                breakdown: dailyResult.breakdown
            };
        });

        const total = results.reduce((sum, result) => sum + result.total, 0);

        if (outputMode === 'simple') {
            return total;
        }

        // Calculate summary breakdown
        const summaryBreakdown = {
            totalDays: results.length,
            workingDays: results.filter(r => r.total > 0).length,
            totalBasePay: results.reduce((sum, r) => sum + (r.breakdown.adjustedBaseRate || 0), 0),
            totalMealAllowance: results.reduce((sum, r) => sum + (r.breakdown.mealAllowance || 0), 0),
            totalDeductions: results.reduce((sum, r) => {
                const deductions = r.breakdown.deductions || {};
                return sum + (deductions.late?.amount || 0) + (deductions.undertime?.amount || 0);
            }, 0),
            totalBonuses: results.reduce((sum, r) => {
                const bonuses = r.breakdown.bonuses || {};
                return sum + Object.values(bonuses).reduce((bonusSum, bonus) => bonusSum + (bonus || 0), 0);
            }, 0)
        };

        return {
            total,
            entries: results,
            breakdown: summaryBreakdown
        };
    }

    /**
     * Normalize attendance entry data - handles different property names and formats
     */
    _normalizeAttendanceEntry(entry) {
        if (!entry) return {};

        return {
            date: entry.date || entry.dateStr || null,
            timeIn: entry.timeIn || entry.clockIn?.time || entry.clock_in || null,
            timeOut: entry.timeOut || entry.clockOut?.time || entry.clock_out || null,
            branch: entry.branch || entry.clockIn?.branch || entry.location || 'Unknown',
            shift: entry.shift || entry.clockIn?.shift || entry.shiftType || 'Opening',
            scheduledIn: entry.scheduledIn || entry.scheduled_in || this.SHIFT_SCHEDULES[entry.shift]?.timeIn || null,
            scheduledOut: entry.scheduledOut || entry.scheduled_out || this.SHIFT_SCHEDULES[entry.shift]?.timeOut || null,
            hasOTPay: entry.hasOTPay || entry.has_ot_pay || entry.overtime || false,
            hasFixedPay: entry.hasFixedPay || entry.has_fixed_pay || entry.fixedPay || false,
            fixedPayAmount: entry.fixedPayAmount || entry.fixed_pay_amount || entry.fixedAmount || 0,
            hasDoublePay: entry.hasDoublePay || entry.has_double_pay || entry.doublePay || false,
            hasMealAllowance: entry.hasMealAllowance !== false, // Default to true unless explicitly false
            transpoAllowance: entry.transpoAllowance || entry.transpo_allowance || entry.transportation || 0
        };
    }

    /**
     * Normalize employee data - handles different property names and formats
     */
    _normalizeEmployeeData(employee) {
        if (!employee) return {};

        return {
            id: employee.id || employee.employeeId || employee.employee_id || null,
            name: employee.name || employee.employeeName || employee.employee_name || 'Unknown',
            baseRate: employee.baseRate || employee.base_rate || employee.dailyRate || employee.daily_rate || 0,
            salesBonusEligible: employee.salesBonusEligible || employee.sales_bonus_eligible || employee.salesBonus || false
        };
    }

    /**
     * Validate inputs and return validation result
     */
    _validateInputs(entry, employee) {
        // Check for missing time data
        if (!entry.timeIn || !entry.timeOut) {
            return {
                isValid: false,
                error: "Missing time in or time out data"
            };
        }

        // Check for missing base rate
        if (!employee.baseRate || employee.baseRate <= 0) {
            return {
                isValid: false,
                error: "Missing or invalid employee base rate"
            };
        }

        // Validate time format
        if (!this._isValidTimeFormat(entry.timeIn) || !this._isValidTimeFormat(entry.timeOut)) {
            return {
                isValid: false,
                error: "Invalid time format"
            };
        }

        return { isValid: true };
    }

    /**
     * Check if time string is in valid format
     */
    _isValidTimeFormat(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return false;

        // Check for "HH:MM AM/PM" or "HH:MM:SS AM/PM" format
        const timeRegex = /^(1[0-2]|0?[1-9]):([0-5][0-9])(?::([0-5][0-9]))?\s?(AM|PM)$/i;
        return timeRegex.test(timeStr.trim());
    }

    /**
     * Calculate pay for fixed amount shifts
     */
    _calculateFixedPay(dateEntry, employee, breakdown) {
        breakdown.payType = "Fixed Pay Amount";
        breakdown.adjustedBaseRate = dateEntry.fixedPayAmount;

        let total = dateEntry.fixedPayAmount;
        breakdown.components.push({
            type: 'fixed_pay',
            amount: dateEntry.fixedPayAmount,
            isPositive: true,
            metadata: {}
        });

        // Add meal allowance if enabled (default: true)
        if (dateEntry.hasMealAllowance !== false) {
            const isHalfDay = this._isHalfDayShift(dateEntry.shift);
            const mealAllowance = isHalfDay ? this.DAILY_MEAL_ALLOWANCE / 2 : this.DAILY_MEAL_ALLOWANCE;

            breakdown.mealAllowance = mealAllowance;
            total += mealAllowance;
            breakdown.components.push({
                label: `Meal Allowance${isHalfDay ? ' (Half Day)' : ''}`,
                amount: mealAllowance,
                isPositive: true
            });
        }

        // Add other allowances and bonuses
        total += this._addBonusesAndAllowances(dateEntry, employee, breakdown);

        return { total, breakdown };
    }

    /**
     * Calculate pay for custom shifts
     */
    _calculateCustomShiftPay(dateEntry, employee, breakdown, multiplier) {
        const actualHours = this.calculateHours(dateEntry.timeIn, dateEntry.timeOut);
        if (!actualHours) {
            breakdown.error = "Could not calculate hours worked";
            return { total: 0, breakdown };
        }

        const hourlyRate = employee.baseRate / this.STANDARD_WORK_HOURS;
        const workHours = actualHours > 4 ? actualHours - 1 : actualHours; // Subtract break time

        // Calculate meal allowance
        const mealAllowance = (dateEntry.hasMealAllowance !== false) ?
            (actualHours <= 5 ? this.DAILY_MEAL_ALLOWANCE / 2 : this.DAILY_MEAL_ALLOWANCE) : 0;

        breakdown.mealAllowance = mealAllowance;

        // Calculate base pay (up to 8 hours, then overtime)
        const regularHours = Math.min(workHours, this.STANDARD_WORK_HOURS);
        const basePay = hourlyRate * regularHours * multiplier;

        breakdown.adjustedBaseRate = basePay;
        breakdown.components.push({
            type: 'base_pay',
            amount: hourlyRate * regularHours,
            isPositive: true,
            metadata: { hours: regularHours, hourlyRate }
        });

        if (multiplier > 1.0) {
            const bonusAmount = hourlyRate * regularHours * (multiplier - 1.0);
            breakdown.components.push({
                type: dateEntry.hasDoublePay ? 'double_pay_bonus' : 'holiday_bonus',
                amount: bonusAmount,
                isPositive: true,
                metadata: {
                    multiplier,
                    bonusMultiplier: multiplier - 1.0,
                    hours: regularHours,
                    holidayType: this.HOLIDAYS[dateEntry.date]?.type
                }
            });
        }

        if (mealAllowance > 0) {
            breakdown.components.push({
                type: 'meal_allowance',
                amount: mealAllowance,
                isPositive: true,
                metadata: { isCustomShift: true }
            });
        }

        let total = basePay + mealAllowance;

        // Add overtime pay if applicable
        if (dateEntry.hasOTPay) {
            const otCalculation = this.calculateOvertimePay(dateEntry, employee.baseRate);
            if (otCalculation.otPay > 0) {
                breakdown.bonuses.overtime = otCalculation.otPay;
                total += otCalculation.otPay;
                breakdown.components.push({
                    type: 'overtime_pay',
                    amount: otCalculation.otPay,
                    isPositive: true,
                    metadata: { hours: otCalculation.otHours }
                });
            }
        }

        // Add other bonuses and allowances
        total += this._addBonusesAndAllowances(dateEntry, employee, breakdown);

        return { total, breakdown };
    }

    /**
     * Calculate pay for regular shifts (Opening, Closing, etc.)
     */
    _calculateRegularShiftPay(dateEntry, employee, breakdown, multiplier) {
        const isHalfDay = this._isHalfDayShift(dateEntry.shift);
        const dailyRate = isHalfDay ? employee.baseRate / 2 : employee.baseRate;

        // Calculate meal allowance
        const mealAllowance = (dateEntry.hasMealAllowance !== false) ?
            (isHalfDay ? this.DAILY_MEAL_ALLOWANCE / 2 : this.DAILY_MEAL_ALLOWANCE) : 0;

        breakdown.mealAllowance = mealAllowance;

        // Calculate deductions BEFORE applying multiplier
        const deductions = this.calculateDeductions(
            dateEntry.timeIn,
            dateEntry.timeOut,
            dateEntry.scheduledIn,
            dateEntry.scheduledOut
        );

        const standardHours = isHalfDay ? this.HALF_DAY_HOURS : this.STANDARD_WORK_HOURS;
        const hourlyRate = dailyRate / standardHours;
        const deductionAmount = deductions * hourlyRate;

        // Apply deductions to the base rate BEFORE multiplier
        const baseAfterDeductions = dailyRate - deductionAmount;
        const finalBasePay = baseAfterDeductions * multiplier;

        // Calculate detailed deductions with multiplier applied
        breakdown.deductions = this._calculateDetailedDeductions(dateEntry, hourlyRate, multiplier);
        breakdown.adjustedBaseRate = finalBasePay;

        // Add components with structured data only
        breakdown.components.push({
            type: 'base_rate',
            amount: dailyRate,
            isPositive: true,
            metadata: { isHalfDay }
        });

        if (multiplier > 1.0) {
            const bonusAmount = dailyRate * (multiplier - 1.0);
            breakdown.components.push({
                type: dateEntry.hasDoublePay ? 'double_pay_bonus' : 'holiday_bonus',
                amount: bonusAmount,
                isPositive: true,
                metadata: {
                    multiplier,
                    bonusMultiplier: multiplier - 1.0,
                    holidayType: this.HOLIDAYS[dateEntry.date]?.type
                }
            });
        }

        if (mealAllowance > 0) {
            breakdown.components.push({
                type: 'meal_allowance',
                amount: mealAllowance,
                isPositive: true,
                metadata: { isHalfDay }
            });
        }

        // Add deduction components with structured data
        if (breakdown.deductions.late.amount > 0) {
            breakdown.components.push({
                type: 'late_deduction',
                amount: breakdown.deductions.late.amount,
                isPositive: false,
                metadata: {
                    hours: breakdown.deductions.late.hours,
                    multiplier,
                    baseHourlyRate: hourlyRate
                }
            });
        }

        if (breakdown.deductions.undertime.amount > 0) {
            breakdown.components.push({
                type: 'undertime_deduction',
                amount: breakdown.deductions.undertime.amount,
                isPositive: false,
                metadata: {
                    hours: breakdown.deductions.undertime.hours,
                    multiplier,
                    baseHourlyRate: hourlyRate
                }
            });
        }

        let total = finalBasePay + mealAllowance;

        // Add overtime pay if applicable
        if (dateEntry.hasOTPay || this._shouldCalculateOvertimeForRegularShift(dateEntry)) {
            const otCalculation = this.calculateOvertimePay(dateEntry, employee.baseRate);
            if (otCalculation.otPay > 0) {
                breakdown.bonuses.overtime = otCalculation.otPay;
                total += otCalculation.otPay;
                breakdown.components.push({
                    type: 'overtime_pay',
                    amount: otCalculation.otPay,
                    isPositive: true,
                    metadata: { hours: otCalculation.otHours }
                });
            }
        }

        // Add other bonuses and allowances
        total += this._addBonusesAndAllowances(dateEntry, employee, breakdown);

        return { total, breakdown };
    }

    /**
     * Add bonuses and allowances (transportation, sales bonus)
     */
    _addBonusesAndAllowances(dateEntry, employee, breakdown) {
        let additionalTotal = 0;

        // Transportation allowance
        if (dateEntry.transpoAllowance && dateEntry.transpoAllowance > 0) {
            breakdown.bonuses.transportation = dateEntry.transpoAllowance;
            additionalTotal += dateEntry.transpoAllowance;
            breakdown.components.push({
                type: 'transportation_allowance',
                amount: dateEntry.transpoAllowance,
                isPositive: true,
                metadata: {}
            });
        }

        // Sales bonus (only for SM North and eligible employees)
        if (dateEntry.branch === 'SM North' && employee.salesBonusEligible) {
            const salesBonus = this.calculateSalesBonus(dateEntry.date, employee);
            if (salesBonus > 0) {
                breakdown.bonuses.sales = salesBonus;
                additionalTotal += salesBonus;
                breakdown.components.push({
                    type: 'sales_bonus',
                    amount: salesBonus,
                    isPositive: true,
                    metadata: {}
                });
            }
        }

        return additionalTotal;
    }

    /**
     * Calculate detailed deductions for late and undertime
     */
    _calculateDetailedDeductions(dateEntry, hourlyRate, multiplier = 1.0) {
        const deductions = {
            late: { hours: 0, amount: 0 },
            undertime: { hours: 0, amount: 0 }
        };

        // Late deduction
        if (dateEntry.timeIn && dateEntry.scheduledIn) {
            const lateMinutes = this.compareTimes(dateEntry.timeIn, dateEntry.scheduledIn);
            if (lateMinutes > this.LATE_THRESHOLD_MINUTES) {
                const lateHours = lateMinutes / 60;
                deductions.late.hours = lateHours;
                deductions.late.amount = lateHours * hourlyRate * multiplier;
            }
        }

        // Undertime deduction
        if (dateEntry.timeOut && dateEntry.scheduledOut) {
            const undertimeMinutes = this.compareTimes(dateEntry.scheduledOut, dateEntry.timeOut);
            if (undertimeMinutes > this.UNDERTIME_THRESHOLD_MINUTES) {
                const undertimeHours = undertimeMinutes / 60;
                deductions.undertime.hours = undertimeHours;
                deductions.undertime.amount = undertimeHours * hourlyRate * multiplier;
            }
        }

        return deductions;
    }

    /**
     * Calculate overtime pay
     */
    calculateOvertimePay(dateEntry, baseRate) {
        if (!dateEntry.hasOTPay || !dateEntry.timeIn || !dateEntry.timeOut) {
            return { otPay: 0, otHours: 0 };
        }

        const actualHours = this.calculateHours(dateEntry.timeIn, dateEntry.timeOut);
        if (!actualHours || actualHours <= 0) {
            return { otPay: 0, otHours: 0 };
        }

        // Calculate work hours (subtract break time if > 4 hours)
        let workHours = actualHours;
        if (actualHours > 4) {
            workHours = actualHours - 1;
        }
        workHours = Math.max(0, workHours);

        // OT hours are any hours beyond 8
        const otHours = Math.max(0, workHours - this.STANDARD_WORK_HOURS);
        if (otHours === 0) {
            return { otPay: 0, otHours: 0 };
        }

        // Calculate OT rate based on holiday status
        const dateStr = dateEntry.date;
        const hourlyRate = baseRate / this.STANDARD_WORK_HOURS;
        let otRate;

        if (this.HOLIDAYS[dateStr]) {
            const holiday = this.HOLIDAYS[dateStr];
            if (holiday.type === 'regular') {
                otRate = hourlyRate * 2.60; // Regular holiday OT: 260%
            } else if (holiday.type === 'special') {
                otRate = hourlyRate * 1.69; // Special holiday OT: 169%
            }
        } else {
            otRate = hourlyRate * 1.25; // Regular day OT: 125%
        }

        const otPay = otHours * otRate;
        return { otPay, otHours };
    }

    /**
     * Calculate total deduction hours
     */
    calculateDeductions(timeIn, timeOut, scheduledIn, scheduledOut) {
        let deductions = 0;

        // Late deduction
        if (timeIn && scheduledIn) {
            const lateMinutes = this.compareTimes(timeIn, scheduledIn);
            if (lateMinutes > this.LATE_THRESHOLD_MINUTES) {
                deductions += lateMinutes / 60;
            }
        }

        // Undertime deduction
        if (timeOut && scheduledOut) {
            const undertimeMinutes = this.compareTimes(scheduledOut, timeOut);
            if (undertimeMinutes > this.UNDERTIME_THRESHOLD_MINUTES) {
                deductions += undertimeMinutes / 60;
            }
        }

        return deductions;
    }

    /**
     * Calculate sales bonus for a specific date
     */
    calculateSalesBonus(dateStr, employee) {
        // console.log('🎯 calculateSalesBonus called:', {
        //     dateStr,
        //     employeeName: employee.name,
        //     hasSalesData: !!this.salesData,
        //     salesDataKeys: this.salesData ? Object.keys(this.salesData).length : 0,
        //     hasSalesForDate: !!(this.salesData && this.salesData[dateStr])
        // });

        if (!this.salesData) {
            return 0;
        }

        if (!employee.salesBonusEligible) {
            return 0;
        }

        const salesData = this.salesData[dateStr];
        if (!salesData) {
            return 0; // No sales data = no bonus
        }

        const totalSales = salesData.totalSales ||
            ((salesData.cash || 0) + (salesData.gcash || 0) + (salesData.maya || 0) +
                (salesData.card || 0) + (salesData.grab || 0));

        const date = new Date(dateStr);
        const staffingLevel = this.getStaffingLevel(date, window.attendanceData);
        const quota = this.getQuotaForStaffing(staffingLevel);

        return this.calculateSalesBonusAmount(totalSales, quota);
    }

    /**
     * Get holiday pay multiplier for a date
     */
    getHolidayPayMultiplier(dateStr) {
        if (this.HOLIDAYS[dateStr]) {
            if (this.HOLIDAYS[dateStr].type === "regular") {
                return 2.0;
            } else if (this.HOLIDAYS[dateStr].type === "special") {
                return 1.3;
            }
        }
        return 1.0;
    }

    /**
     * Calculate hours between two time strings
     */
    calculateHours(timeInStr, timeOutStr) {
        try {
            // Parse time strings
            const [timeIn, meridianIn] = timeInStr.split(' ');
            const timeInParts = timeIn.split(':');
            const hoursIn = Number(timeInParts[0]);
            const minutesIn = Number(timeInParts[1]);
            // Ignore seconds if present

            const [timeOut, meridianOut] = timeOutStr.split(' ');
            const timeOutParts = timeOut.split(':');
            const hoursOut = Number(timeOutParts[0]);
            const minutesOut = Number(timeOutParts[1]);
        // Ignore seconds if present

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
                minutesDiff += 24 * 60;
            }

            // Prevent unreasonably long shifts
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

    /**
     * Compare two time strings and return difference in minutes
     */
    compareTimes(t1, t2) {
        if (!t1 || !t2) return 0;

        const [time1, meridian1] = t1.split(' ');
        const time1Parts = time1.split(':');
        const hour1 = Number(time1Parts[0]);
        const min1 = Number(time1Parts[1]);
        // Ignore seconds if present
        const minutes1 = (meridian1 === "PM" && hour1 !== 12 ? hour1 + 12 : hour1 % 12) * 60 + min1;

        const [time2, meridian2] = t2.split(' ');
        const time2Parts = time2.split(':');
        const hour2 = Number(time2Parts[0]);
        const min2 = Number(time2Parts[1]);
        // Ignore seconds if present
        const minutes2 = (meridian2 === "PM" && hour2 !== 12 ? hour2 + 12 : hour2 % 12) * 60 + min2;

        return minutes1 - minutes2; // > 0 means t1 is later than t2
    }

    /**
     * Utility method to check if a shift is half-day
     */
    _isHalfDayShift(shift) {
        return shift === "Closing Half-Day" || shift === "Opening Half-Day";
    }

    /**
     * Check if overtime should be calculated for regular shifts
     */
    _shouldCalculateOvertimeForRegularShift(dateEntry) {
        // Calculate if worked hours exceed standard hours significantly
        const actualHours = this.calculateHours(dateEntry.timeIn, dateEntry.timeOut);
        return actualHours && actualHours > 9; // More than 9 hours (8 + 1 break)
    }

    /**
     * Get staffing level for sales bonus calculation
     */
    getStaffingLevel(date, attendanceData = null) {
        // If no attendance data provided, use defaults
        if (!attendanceData && !window.attendanceData) {
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            return isWeekend ? this.SALES_BONUS_CONFIG.defaultStaffing.weekend :
                this.SALES_BONUS_CONFIG.defaultStaffing.weekday;
        }

        const dateStr = this._formatDate(date);
        const dataToUse = attendanceData || window.attendanceData || {};

        // Count actual SM North staff for this date
        let staffCount = 0;
        const countedEmployees = [];
        const skippedEmployees = [];

        Object.values(dataToUse).forEach(employee => {
            const dateEntry = employee.dates?.find(d => d.date === dateStr);

            const employeeInfo = {
                name: employee.name || 'Unknown',
                hasEntry: !!dateEntry,
                timeIn: dateEntry?.timeIn,
                timeOut: dateEntry?.timeOut,
                branch: dateEntry?.branch,
                shift: dateEntry?.shift
            };

            if (dateEntry && dateEntry.timeIn && dateEntry.timeOut && dateEntry.branch === 'SM North') {
                let staffValue = 0;

                // Count shift values based on hours worked
                if (dateEntry.shift === 'Closing Half-Day' || dateEntry.shift === 'Opening Half-Day') {
                    staffValue = 0.5;
                } else if (dateEntry.shift === 'Custom') {
                    const actualHours = this.calculateHours(dateEntry.timeIn, dateEntry.timeOut);
                    if (actualHours) {
                        const workHours = actualHours > 4 ? actualHours - 1 : actualHours;
                        const staffEquivalent = Math.min(workHours / 8, 1.5);
                        const rounded = Math.round(staffEquivalent * 2) / 2; // nearest 0.5
                        staffValue = rounded;
                    }
                } else if (['Opening', 'Midshift', 'Closing'].includes(dateEntry.shift)) {
                    staffValue = 1.0;
                }

                staffCount += staffValue;
                countedEmployees.push({
                    name: employee.name || 'Unknown',
                    shift: dateEntry.shift,
                    timeIn: dateEntry.timeIn,
                    timeOut: dateEntry.timeOut,
                    staffValue: staffValue
                });
            } else {
                skippedEmployees.push({
                    name: employee.name || 'Unknown',
                    reason: !dateEntry ? 'No attendance entry' :
                        !dateEntry.timeIn ? 'Missing timeIn' :
                            !dateEntry.timeOut ? 'Missing timeOut' :
                                dateEntry.branch !== 'SM North' ? `Wrong branch: ${dateEntry.branch}` :
                                    'Unknown reason',
                    entry: employeeInfo
                });
            }
        });

        // Fall back to defaults if no attendance data found
        if (staffCount === 0) {
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            return isWeekend ? this.SALES_BONUS_CONFIG.defaultStaffing.weekend :
                this.SALES_BONUS_CONFIG.defaultStaffing.weekday;
        }
        return staffCount;
    }

    _formatDate(date) {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Get quota for staffing level
     */
    getQuotaForStaffing(staffingLevel) {
        if (staffingLevel < 2.0) {
            return staffingLevel * 5000;
        } else {
            return 10000 + (staffingLevel - 2.0) * 10000;
        }
    }

    /**
     * Calculate sales bonus amount
     */
    calculateSalesBonusAmount(salesAmount, quota) {
        if (salesAmount <= quota) return 0;
        const excessAmount = salesAmount - quota;
        const bonusTiers = Math.floor(excessAmount / this.SALES_BONUS_CONFIG.tierAmount);
        return bonusTiers * this.SALES_BONUS_CONFIG.bonusPerTier;
    }

    /**
     * Update holidays data
     */
    updateHolidays(holidays) {
        this.HOLIDAYS = holidays;
    }

    /**
     * Update sales data cache
     */
    updateSalesData(salesData) {
        this.salesData = salesData;
    }

    /**
     * Get a formatted breakdown for display
     */
    formatBreakdown(calculation) {
        if (!calculation.breakdown) return null;

        const breakdown = calculation.breakdown;
        const formatted = {
            payType: breakdown.payType,
            total: calculation.total,
            components: breakdown.components || [],
            summary: {
                baseRate: breakdown.baseRate,
                adjustedBaseRate: breakdown.adjustedBaseRate,
                mealAllowance: breakdown.mealAllowance,
                totalDeductions: (breakdown.deductions.late.amount || 0) + (breakdown.deductions.undertime.amount || 0),
                totalBonuses: Object.values(bonuses = breakdown.bonuses || {}).reduce((sum, bonus) => sum + (bonus || 0), 0)
            }
        };

        return formatted;
    }
}

// Export for use in both Node.js and browser environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PayCalculator;
} else if (typeof window !== 'undefined') {
    window.PayCalculator = PayCalculator;
}



