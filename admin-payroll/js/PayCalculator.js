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
    constructor(holidays = {}, salesDataCache = {}) {
        this.HOLIDAYS = holidays;
        this.salesDataCache = salesDataCache;
        
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
     * @param {Object} options - Additional options
     * @returns {Object} { total: number, breakdown: object }
     */
    calculateDailyPay(dateEntry, employee, options = {}) {
        // Validate required data
        if (!dateEntry || !dateEntry.timeIn || !dateEntry.timeOut) {
            return {
                total: 0,
                breakdown: {
                    payType: "No Attendance",
                    error: "Missing time in or time out data"
                }
            };
        }

        if (!employee || !employee.baseRate) {
            return {
                total: 0,
                breakdown: {
                    payType: "Error",
                    error: "Missing employee base rate"
                }
            };
        }

        const baseRate = employee.baseRate;
        const dateStr = dateEntry.date;
        
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

        // Check for fixed pay first (highest priority)
        if (dateEntry.hasFixedPay && dateEntry.fixedPayAmount > 0) {
            return this._calculateFixedPay(dateEntry, employee, breakdown);
        }

        // Determine pay type and multiplier
        let multiplier = 1.0;
        
        if (dateEntry.hasDoublePay) {
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
        if (dateEntry.shift === "Custom") {
            return this._calculateCustomShiftPay(dateEntry, employee, breakdown, multiplier);
        } else {
            return this._calculateRegularShiftPay(dateEntry, employee, breakdown, multiplier);
        }
    }

    /**
     * Calculate pay for fixed amount shifts
     */
    _calculateFixedPay(dateEntry, employee, breakdown) {
        breakdown.payType = "Fixed Pay Amount";
        breakdown.adjustedBaseRate = dateEntry.fixedPayAmount;
        
        let total = dateEntry.fixedPayAmount;
        breakdown.components.push({
            label: "Fixed Pay Amount",
            amount: dateEntry.fixedPayAmount
        });

        // Add meal allowance if enabled (default: true)
        if (dateEntry.hasMealAllowance !== false) {
            const isHalfDay = this._isHalfDayShift(dateEntry.shift);
            const mealAllowance = isHalfDay ? this.DAILY_MEAL_ALLOWANCE / 2 : this.DAILY_MEAL_ALLOWANCE;
            
            breakdown.mealAllowance = mealAllowance;
            total += mealAllowance;
            breakdown.components.push({
                label: `Meal Allowance${isHalfDay ? ' (Half Day)' : ''}`,
                amount: mealAllowance
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
            (actualHours <= 4 ? this.DAILY_MEAL_ALLOWANCE / 2 : this.DAILY_MEAL_ALLOWANCE) : 0;
        
        breakdown.mealAllowance = mealAllowance;

        // Calculate base pay (up to 8 hours, then overtime)
        const regularHours = Math.min(workHours, this.STANDARD_WORK_HOURS);
        const basePay = hourlyRate * regularHours * multiplier;
        
        breakdown.adjustedBaseRate = basePay;
        breakdown.components.push({
            label: `Base Pay (${regularHours.toFixed(1)} hrs at ${multiplier}x)`,
            amount: basePay
        });

        if (mealAllowance > 0) {
            breakdown.components.push({
                label: "Meal Allowance",
                amount: mealAllowance
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
                    label: `Overtime Pay (${otCalculation.otHours.toFixed(1)} hrs)`,
                    amount: otCalculation.otPay
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

        // Apply multiplier to base rate
        const adjustedDailyRate = dailyRate * multiplier;
        breakdown.adjustedBaseRate = adjustedDailyRate;

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

        breakdown.deductions = this._calculateDetailedDeductions(dateEntry, hourlyRate);
        
        // Add components
        breakdown.components.push({
            label: `Base Rate${isHalfDay ? ' (Half Day)' : ''} (${multiplier}x)`,
            amount: finalBasePay
        });

        if (mealAllowance > 0) {
            breakdown.components.push({
                label: `Meal Allowance${isHalfDay ? ' (Half Day)' : ''}`,
                amount: mealAllowance
            });
        }

        // Add deduction components
        if (breakdown.deductions.late.amount > 0) {
            breakdown.components.push({
                label: `Late Deduction (${breakdown.deductions.late.hours.toFixed(1)} hrs)`,
                amount: -breakdown.deductions.late.amount
            });
        }

        if (breakdown.deductions.undertime.amount > 0) {
            breakdown.components.push({
                label: `Undertime Deduction (${breakdown.deductions.undertime.hours.toFixed(1)} hrs)`,
                amount: -breakdown.deductions.undertime.amount
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
                    label: `Overtime Pay (${otCalculation.otHours.toFixed(1)} hrs)`,
                    amount: otCalculation.otPay
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
                label: "Transportation Allowance",
                amount: dateEntry.transpoAllowance
            });
        }

        // Sales bonus (only for SM North and eligible employees)
        if (dateEntry.branch === 'SM North' && employee.salesBonusEligible) {
            const salesBonus = this.calculateSalesBonus(dateEntry.date, employee);
            if (salesBonus > 0) {
                breakdown.bonuses.sales = salesBonus;
                additionalTotal += salesBonus;
                breakdown.components.push({
                    label: "Sales Bonus",
                    amount: salesBonus
                });
            }
        }

        return additionalTotal;
    }

    /**
     * Calculate detailed deductions for late and undertime
     */
    _calculateDetailedDeductions(dateEntry, hourlyRate) {
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
                deductions.late.amount = lateHours * hourlyRate;
            }
        }

        // Undertime deduction
        if (dateEntry.timeOut && dateEntry.scheduledOut) {
            const undertimeMinutes = this.compareTimes(dateEntry.scheduledOut, dateEntry.timeOut);
            if (undertimeMinutes > this.UNDERTIME_THRESHOLD_MINUTES) {
                const undertimeHours = undertimeMinutes / 60;
                deductions.undertime.hours = undertimeHours;
                deductions.undertime.amount = undertimeHours * hourlyRate;
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
        if (!employee.salesBonusEligible || !this.salesDataCache[dateStr]) {
            return 0;
        }

        const salesData = this.salesDataCache[dateStr];
        const totalSales = salesData.totalSales || 
            ((salesData.cash || 0) + (salesData.gcash || 0) + (salesData.maya || 0) + 
             (salesData.card || 0) + (salesData.grab || 0));

        const date = new Date(dateStr);
        const staffingLevel = this.getStaffingLevel(date);
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
        const [hour1, min1] = time1.split(':').map(Number);
        const minutes1 = (meridian1 === "PM" && hour1 !== 12 ? hour1 + 12 : hour1 % 12) * 60 + min1;

        const [time2, meridian2] = t2.split(' ');
        const [hour2, min2] = time2.split(':').map(Number);
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
    getStaffingLevel(date) {
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        return isWeekend ? this.SALES_BONUS_CONFIG.defaultStaffing.weekend : 
                          this.SALES_BONUS_CONFIG.defaultStaffing.weekday;
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
        this.salesDataCache = salesData;
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
                totalBonuses: Object.values(breakdown.bonuses).reduce((sum, bonus) => sum + (bonus || 0), 0)
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