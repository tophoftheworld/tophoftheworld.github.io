import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, query, where, setDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Firebase configuration (same as admin-payroll)
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

// State
let employees = {};
let periods2025 = [];
let HOLIDAYS_2025 = {};
let SALES_DATA = {};
let SHOW_TOTALS = false;
let SHOW_RECEIVERS_ONLY = false;
let payCalculator;
const CACHE_KEY = 'thirteenth_rows_2025';

// Elements
const summaryBody = document.getElementById('summaryBody');
const loadingIndicator = document.getElementById('loadingIndicator');
const loadingText = document.getElementById('loadingText');
const toggleTotals = document.getElementById('toggleTotals');
const toggleReceiversOnly = document.getElementById('toggleReceiversOnly');
const overallTotalEl = document.getElementById('overallTotal');

document.getElementById('refreshBtn').addEventListener('click', () => bootstrap(true));
document.getElementById('exportBtn').addEventListener('click', exportCSV);
if (toggleTotals) {
    toggleTotals.addEventListener('change', () => {
        SHOW_TOTALS = toggleTotals.checked;
        renderSummary(window.__thirteenthRows || []);
    });
}
if (toggleReceiversOnly) {
    toggleReceiversOnly.addEventListener('change', () => {
        SHOW_RECEIVERS_ONLY = toggleReceiversOnly.checked;
        renderSummary(window.__thirteenthRows || []);
    });
}

// Utilities
function showLoading(message = '') {
    loadingIndicator.style.display = 'inline-flex';
    loadingText.textContent = message;
}
function hideLoading() {
    loadingIndicator.style.display = 'none';
    loadingText.textContent = '';
}
function formatCurrency(n) {
    const num = Number(n || 0);
    return `₱${num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function parseCurrency(text) {
    if (!text) return 0;
    const cleaned = text.toString().replace(/[₱,\s]/g, '');
    const num = Number(cleaned);
    return isNaN(num) ? 0 : num;
}
function formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Period generation (copied from admin-payroll, trimmed for 2025 scope)
function generatePayrollPeriods(startDate, endDate) {
    const periods = [];
    let periodEnd = new Date(endDate);
    let safety = 0;

    while (periodEnd >= startDate && safety < 60) {
        let periodStart;
        if (periodEnd.getDate() === 12) {
            const prevMonth = periodEnd.getMonth() === 0 ? 11 : periodEnd.getMonth() - 1;
            const prevYear = periodEnd.getMonth() === 0 ? periodEnd.getFullYear() - 1 : periodEnd.getFullYear();
            const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
            const startDay = daysInPrevMonth === 31 ? 29 : 28;
            periodStart = new Date(prevYear, prevMonth, startDay);
        } else {
            periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 13);
        }

        periods.push({
            id: `${formatDate(periodStart)}_${formatDate(periodEnd)}`,
            start: periodStart,
            end: periodEnd,
            label: `${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        });

        periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() - 1);
        safety += 1;
    }

    return periods.sort((a, b) => b.start - a.start);
}

// Core calculation: basic-only per day
function computeBasicOnly(dateEntryRaw, employeeRaw) {
    if (!dateEntryRaw) return 0;
    const entry = payCalculator._normalizeAttendanceEntry(dateEntryRaw);
    const emp = payCalculator._normalizeEmployeeData(employeeRaw);

    if (!entry.timeIn || !entry.timeOut || !emp.baseRate) return 0;

    // Fixed pay days: treat fixed amount as basic for the day
    if (entry.hasFixedPay && entry.fixedPayAmount > 0) {
        return entry.fixedPayAmount;
    }

    const isHalfDay = payCalculator._isHalfDayShift(entry.shift);
    const dailyRate = isHalfDay ? emp.baseRate / 2 : emp.baseRate;
    const standardHours = isHalfDay ? payCalculator.HALF_DAY_HOURS : payCalculator.STANDARD_WORK_HOURS;
    const hourlyRate = dailyRate / standardHours;
    const deductionHours = payCalculator.calculateDeductions(
        entry.timeIn,
        entry.timeOut,
        entry.scheduledIn,
        entry.scheduledOut
    );
    const deductionAmount = deductionHours * hourlyRate;

    // Custom shift handling (no multiplier, no allowances)
    if (entry.shift === "Custom") {
        const actualHours = payCalculator.calculateHours(entry.timeIn, entry.timeOut);
        if (!actualHours) return 0;
        const workHours = actualHours > 4 ? actualHours - 1 : actualHours;
        const regularHours = Math.min(workHours, payCalculator.STANDARD_WORK_HOURS);
        const baseBeforeDeductions = (emp.baseRate / payCalculator.STANDARD_WORK_HOURS) * regularHours;
        return Math.max(0, baseBeforeDeductions - deductionAmount);
    }

    return Math.max(0, dailyRate - deductionAmount);
}

function computeFullPay(dateEntryRaw, employeeRaw) {
    if (!dateEntryRaw) return 0;
    const total = payCalculator.calculateDailyPay(dateEntryRaw, employeeRaw, 'simple');
    return Number(total) || 0;
}

function buildMonthMap(perPeriod) {
    const monthMap = {};
    Object.entries(perPeriod).forEach(([pid, data]) => {
        const period = periods2025.find(p => p.id === pid);
        if (!period) return;
        const end = period.end;
        const endDate = end.getDate();
        const endYear = end.getFullYear();
        const endMonth = end.getMonth();
        let monthKey;
        let isFirstCutoff;
        
        if (endDate === 12) {
            // First cutoff: period ends on 12th - belongs to that month
            monthKey = `${endYear}-${(endMonth + 1).toString().padStart(2, '0')}`;
            isFirstCutoff = true;
        } else if (endDate === 27 || endDate === 28 || endDate === 29) {
            // Second cutoff: period ends on 27th/28th/29th - belongs to that month
            monthKey = `${endYear}-${(endMonth + 1).toString().padStart(2, '0')}`;
            isFirstCutoff = false;
        } else {
            // Shouldn't happen with standard payroll periods, but fallback
            return;
        }
        
        // Only include 2025 months (exclude Dec 2024 and Jan 2026+)
        if (!monthKey.startsWith('2025-')) return;
        
        if (!monthMap[monthKey]) {
            monthMap[monthKey] = {
                cutoff1Basic: 0,
                cutoff2Basic: 0,
                cutoff1Full: 0,
                cutoff2Full: 0,
                cutoff1Period: null,
                cutoff2Period: null
            };
        }
        
        if (isFirstCutoff) {
            monthMap[monthKey].cutoff1Basic += data.basicTotal;
            monthMap[monthKey].cutoff1Full += data.fullTotal;
            monthMap[monthKey].cutoff1Period = period.label;
        } else {
            monthMap[monthKey].cutoff2Basic += data.basicTotal;
            monthMap[monthKey].cutoff2Full += data.fullTotal;
            monthMap[monthKey].cutoff2Period = period.label;
        }
    });
    return monthMap;
}

async function loadFromThirteenthMonthDB(employeeId) {
    const snap = await getDocs(collection(db, 'thirteenth_month', employeeId, 'months'));
    if (snap.empty) return null;
    
    // Need periods to compute period labels
    if (!periods2025 || periods2025.length === 0) {
        const start2025 = new Date(2025, 0, 1);
        const end2025 = new Date(2025, 11, 29); // Dec 29 to ensure we capture period ending Dec 27/28/29
        periods2025 = generatePayrollPeriods(start2025, end2025);
    }
    
    const monthMap = {};
    snap.forEach(docSnap => {
        const data = docSnap.data();
        // Use stored period labels if available, otherwise compute
        let cutoff1Period = data.cutoff1Period;
        let cutoff2Period = data.cutoff2Period;
        
        if (!cutoff1Period || !cutoff2Period) {
            const [year, month] = docSnap.id.split('-').map(Number);
            
            // First cutoff: period ending on 12th of this month
            const cutoff1PeriodObj = periods2025.find(p => {
                const pEnd = new Date(p.end);
                return pEnd.getFullYear() === year && pEnd.getMonth() === month - 1 && pEnd.getDate() === 12;
            });
            
            // Second cutoff: period ending on 27th/28th/29th of this month
            const cutoff2PeriodObj = periods2025.find(p => {
                const pEnd = new Date(p.end);
                return pEnd.getFullYear() === year && pEnd.getMonth() === month - 1 && (pEnd.getDate() === 27 || pEnd.getDate() === 28 || pEnd.getDate() === 29);
            });
            
            cutoff1Period = cutoff1Period || cutoff1PeriodObj?.label || '—';
            cutoff2Period = cutoff2Period || cutoff2PeriodObj?.label || '—';
        }
        
        monthMap[docSnap.id] = {
            cutoff1Basic: data.cutoff1Basic || 0,
            cutoff2Basic: data.cutoff2Basic || 0,
            cutoff1Full: data.cutoff1Full || 0,
            cutoff2Full: data.cutoff2Full || 0,
            cutoff1Period: cutoff1Period,
            cutoff2Period: cutoff2Period
        };
    });
    return monthMap;
}

async function saveToThirteenthMonthDB(employeeId, monthMap) {
    for (const [monthKey, data] of Object.entries(monthMap)) {
        await setDoc(doc(db, 'thirteenth_month', employeeId, 'months', monthKey), {
            cutoff1Basic: data.cutoff1Basic || 0,
            cutoff2Basic: data.cutoff2Basic || 0,
            cutoff1Full: data.cutoff1Full || 0,
            cutoff2Full: data.cutoff2Full || 0,
            cutoff1Period: data.cutoff1Period || null,
            cutoff2Period: data.cutoff2Period || null
        }, { merge: true });
    }
}

async function saveMonthOverride(employeeId, monthKey, data) {
    await setDoc(doc(db, 'thirteenth_month', employeeId, 'months', monthKey), data, { merge: true });
}

function formatMonthLabel(key) {
    const [year, month] = key.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function findPeriodForDate(dateStr) {
    // Use string comparison like admin-payroll does (more reliable for date-only comparisons)
    // Normalize period dates to strings for comparison
    return periods2025.find(p => {
        const periodStartStr = formatDate(p.start);
        const periodEndStr = formatDate(p.end);
        return dateStr >= periodStartStr && dateStr <= periodEndStr;
    });
}

async function loadHolidays() {
    try {
        const holidayDoc = await getDoc(doc(db, "config", "holidays_2025"));
        if (holidayDoc.exists()) {
            HOLIDAYS_2025 = holidayDoc.data();
        }
    } catch (err) {
        console.error("Failed to load holidays", err);
    }
}

// Sales data (to mirror admin-payroll sales bonus handling)
async function loadSalesData() {
    try {
        // Load only SM North sales data (sales bonus is SM North only)
        const smNorthSnapshot = await getDocs(collection(db, 'sales-data', 'sm-north', 'daily'));
        const allDocs = [...smNorthSnapshot.docs];
        const salesData = {};

        allDocs.forEach(docSnap => {
            const data = docSnap.data();
            const hasTotal = data.totalSales;
            const sumPayments = (data.cash || 0) + (data.gcash || 0) + (data.maya || 0) + (data.card || 0) + (data.grab || 0);
            if (hasTotal || sumPayments > 0) {
                salesData[docSnap.id] = data;
            }
        });

        SALES_DATA = salesData;
    } catch (err) {
        console.error("Failed to load sales data", err);
        SALES_DATA = {};
    }
}

async function loadEmployees() {
    const snapshot = await getDocs(collection(db, "employees"));
    const result = {};
    snapshot.forEach(d => {
        result[d.id] = { id: d.id, ...d.data() };
    });
    return result;
}

async function loadAttendanceForEmployee(employeeId, startStr, endStr) {
    const attendanceRef = collection(db, "attendance", employeeId, "dates");
    const q = query(attendanceRef, where("__name__", ">=", startStr), where("__name__", "<=", endStr));
    const snap = await getDocs(q);
    const entries = [];
    snap.forEach(docSnap => {
        entries.push({ date: docSnap.id, ...docSnap.data() });
    });
    return entries;
}

async function loadReceiveFlag(employeeId) {
    try {
        const docSnap = await getDoc(doc(db, 'thirteenth_month', employeeId));
        if (docSnap.exists()) {
            return docSnap.data().receive13th ?? true;
        }
    } catch (e) {
        console.warn('loadReceiveFlag failed', e);
    }
    return true; // default: receives
}

async function saveReceiveFlag(employeeId, value) {
    try {
        await setDoc(doc(db, 'thirteenth_month', employeeId), { receive13th: value }, { merge: true });
    } catch (e) {
        console.error('saveReceiveFlag failed', e);
    }
}

async function bootstrap(forceRefresh = false) {
    if (!forceRefresh) {
        const cached = loadCache();
        if (cached) {
            renderSummary(cached);
        }
    }

    showLoading("Loading employees");
    await loadHolidays();
    await loadSalesData();
    payCalculator = new PayCalculator(HOLIDAYS_2025, SALES_DATA);
    
    // Generate periods for 2025 (Jan 1 - Dec 29, 2025 to capture Dec's second cutoff)
    const start2025 = new Date(2025, 0, 1);
    const end2025 = new Date(2025, 11, 29); // Dec 29 to ensure we capture period ending Dec 27/28/29
    periods2025 = generatePayrollPeriods(start2025, end2025);
    
    employees = await loadEmployees();

    const rows = [];
    let idx = 0;
    for (const [id, emp] of Object.entries(employees)) {
        idx += 1;
        showLoading(`Loading ${emp.name || 'Employee'} (${idx}/${Object.keys(employees).length})`);
        
        let monthMap;
        const receiveFlag = await loadReceiveFlag(id);
        
        // If force refresh, always recompute from main payroll
        if (forceRefresh) {
            showLoading(`Recomputing ${emp.name || 'Employee'} from payroll (${idx}/${Object.keys(employees).length})`);
            const startStr = "2025-01-01";
            const endStr = "2025-12-31"; // End of December 2025
            const attendance = await loadAttendanceForEmployee(id, startStr, endStr);
            const perPeriod = {};
            attendance.forEach(entry => {
                const period = findPeriodForDate(entry.date);
                if (!period) return;
                const basic = computeBasicOnly(entry, emp);
                const full = computeFullPay(entry, emp);
                
                if (!perPeriod[period.id]) {
                    perPeriod[period.id] = {
                        basicTotal: 0,
                        fullTotal: 0,
                        periodStart: period.start,
                        periodLabel: period.label
                    };
                }
                perPeriod[period.id].basicTotal += basic;
                perPeriod[period.id].fullTotal += full;
            });
            
            monthMap = buildMonthMap(perPeriod);
            await saveToThirteenthMonthDB(id, monthMap);
        } else {
            // Try loading from 13th month database first
            monthMap = await loadFromThirteenthMonthDB(id);
            
            // If no data in 13th month DB, fetch from main payroll and save
            if (!monthMap || Object.keys(monthMap).length === 0) {
                showLoading(`Computing ${emp.name || 'Employee'} from payroll (${idx}/${Object.keys(employees).length})`);
                const startStr = "2025-01-01";
                const endStr = "2025-12-31"; // End of December 2025
                const attendance = await loadAttendanceForEmployee(id, startStr, endStr);
                const perPeriod = {};
                attendance.forEach(entry => {
                    const period = findPeriodForDate(entry.date);
                    if (!period) return;
                    const basic = computeBasicOnly(entry, emp);
                    
                    if (!perPeriod[period.id]) {
                        perPeriod[period.id] = {
                            basicTotal: 0,
                            periodStart: period.start,
                            periodLabel: period.label
                        };
                    }
                    perPeriod[period.id].basicTotal += basic;
                });
                
                monthMap = buildMonthMap(perPeriod);
                await saveToThirteenthMonthDB(id, monthMap);
            }
        }

        // Ensure all 12 months of 2025 are present (even with zero values)
        const allMonths2025 = [];
        for (let m = 1; m <= 12; m++) {
            const monthKey = `2025-${m.toString().padStart(2, '0')}`;
            const monthData = monthMap[monthKey] || {
                cutoff1Basic: 0,
                cutoff2Basic: 0,
                cutoff1Full: 0,
                cutoff2Full: 0,
                cutoff1Period: null,
                cutoff2Period: null
            };
            allMonths2025.push({
                key: monthKey,
                label: formatMonthLabel(monthKey),
                cutoff1Basic: monthData.cutoff1Basic || 0,
                cutoff2Basic: monthData.cutoff2Basic || 0,
                cutoff1Full: monthData.cutoff1Full || 0,
                cutoff2Full: monthData.cutoff2Full || 0,
                cutoff1Period: monthData.cutoff1Period || '—',
                cutoff2Period: monthData.cutoff2Period || '—'
            });
        }
        
        const monthsArray = allMonths2025;

        const ytdBasic = monthsArray.reduce((s, m) => s + (m.cutoff1Basic + m.cutoff2Basic), 0);
        const ytdFull = monthsArray.reduce((s, m) => s + (m.cutoff1Full + m.cutoff2Full), 0);
        const periodsCovered = monthsArray.filter(m => (m.cutoff1Basic + m.cutoff2Basic) > 0).length;

        rows.push({
            id,
            name: emp.name || 'Employee',
            months: monthsArray,
            ytdBasic,
            ytdFull,
            periodsCovered,
            receive13th: receiveFlag
        });
    }

    renderSummary(rows);
    saveCache(rows);
    hideLoading();
    window.__thirteenthRows = rows; // for export
}

function saveCache(rows) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ rows, ts: Date.now() }));
    } catch (e) {
        console.warn('Cache save failed', e);
    }
}

function loadCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        window.__thirteenthRows = parsed.rows;
        return parsed.rows;
    } catch {
        return null;
    }
}

function renderSummary(rows) {
    if (!rows.length) {
        summaryBody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No data</td></tr>';
        return;
    }
    const filtered = SHOW_RECEIVERS_ONLY ? rows.filter(r => r.receive13th !== false) : rows;
    summaryBody.innerHTML = '';
    
    // Show/hide checkbox column header
    const receiveHeader = document.getElementById('receiveHeader');
    if (receiveHeader) {
        receiveHeader.style.display = SHOW_RECEIVERS_ONLY ? 'none' : '';
        receiveHeader.textContent = SHOW_RECEIVERS_ONLY ? '' : 'Receives';
    }
    
    filtered.forEach(row => {
        const main = document.createElement('tr');
        main.classList.add('clickable-row');
        main.style.cursor = 'pointer';
        
        const checkboxCell = SHOW_RECEIVERS_ONLY ? '' : `
            <td style="text-align:center;" onclick="event.stopPropagation();">
                <input type="checkbox" data-role="receive-13th" ${row.receive13th !== false ? 'checked' : ''} />
            </td>
        `;
        
        main.innerHTML = `
            ${checkboxCell}
            <td>${row.name}</td>
            <td>${row.periodsCovered}</td>
            <td data-role="ytd-basic">${formatCurrency(row.ytdBasic)}</td>
            <td data-role="ytd-full" style="font-weight:700; color:#111827;">${formatCurrency(row.ytdFull)}</td>
            <td data-role="ytd-13th" style="font-weight:700; color:#111827;">${formatCurrency(row.ytdBasic / 12)}</td>
        `;

        const detail = document.createElement('tr');
        detail.className = 'detail-row';
        detail.style.display = 'none';
        const detailTd = document.createElement('td');
        detailTd.className = 'detail-cell';
        detailTd.colSpan = SHOW_RECEIVERS_ONLY ? 5 : 6;
        detailTd.innerHTML = renderDetail(row);
        detail.appendChild(detailTd);

        main.addEventListener('click', (e) => {
            // Don't trigger row click if clicking on checkbox
            if (e.target.type === 'checkbox') return;
            
            const isOpen = detail.style.display === 'table-row';
            // collapse any other open detail rows
            document.querySelectorAll('.detail-row').forEach(r => r.style.display = 'none');
            document.querySelectorAll('.clickable-row').forEach(r => r.classList.remove('active'));
            if (!isOpen) {
                detail.style.display = 'table-row';
                main.classList.add('active');
            }
        });

        // Handle receive toggle
        const receiveCheckbox = main.querySelector('input[data-role="receive-13th"]');
        if (receiveCheckbox) {
            receiveCheckbox.addEventListener('change', async (e) => {
                e.stopPropagation();
                const val = e.target.checked;
                row.receive13th = val;
                await saveReceiveFlag(row.id, val);
                saveCache(rows);
                updateOverallTotal(rows);
                if (SHOW_RECEIVERS_ONLY && !val) {
                    renderSummary(rows);
                }
            });
        }

        summaryBody.appendChild(main);
        summaryBody.appendChild(detail);

        attachDetailHandlers(detail, main, row, rows);
    });
    updateOverallTotal(rows);
}

function updateOverallTotal(rows) {
    if (!overallTotalEl) return;
    const source = SHOW_RECEIVERS_ONLY ? rows.filter(r => r.receive13th !== false) : rows;
    const total = source.reduce((s, r) => s + (r.ytdBasic / 12), 0);
    overallTotalEl.textContent = `Total 13th to pay: ${formatCurrency(total)}`;
}

function attachDetailHandlers(detail, main, row, rows) {
    detail.addEventListener('blur', async (e) => {
        const cell = e.target;
        if (!cell.dataset || !cell.dataset.field) return;
        const monthKey = cell.dataset.month;
        const field = cell.dataset.field;
        const month = row.months.find(m => m.key === monthKey);
        if (!month) return;

        const newValue = parseCurrency(cell.textContent);
        if (field === 'cutoff1Basic' || field === 'cutoff2Basic') {
            month[field] = newValue;
        }

        const monthBasic = month.cutoff1Basic + month.cutoff2Basic;

        const parentRow = cell.parentElement;
        const totalBasicCell = parentRow.querySelector('[data-role="total-basic"]');
        if (totalBasicCell) totalBasicCell.textContent = formatCurrency(monthBasic);

        // Recompute YTDs
        row.ytdBasic = row.months.reduce((s, m) => s + (m.cutoff1Basic + m.cutoff2Basic), 0);
        row.ytdFull = row.months.reduce((s, m) => s + (m.cutoff1Full + m.cutoff2Full), 0);

        // Update summary row display
        const ytdBasicCell = main.querySelector('[data-role="ytd-basic"]');
        const ytdFullCell = main.querySelector('[data-role="ytd-full"]');
        const ytd13Cell = main.querySelector('[data-role="ytd-13th"]');
        if (ytdBasicCell) ytdBasicCell.textContent = formatCurrency(row.ytdBasic);
        if (ytdFullCell) ytdFullCell.textContent = formatCurrency(row.ytdFull);
        if (ytd13Cell) ytd13Cell.textContent = formatCurrency(row.ytdBasic / 12);

        // Persist to Firestore and cache
        await saveMonthOverride(row.id, monthKey, {
            cutoff1Basic: month.cutoff1Basic,
            cutoff2Basic: month.cutoff2Basic
        });
        saveCache(rows);
        updateOverallTotal(rows);
    }, true);
}

function renderDetail(row) {
    if (!row.months || !row.months.length) {
        return '<div class="small" style="padding:8px 0;">No data</div>';
    }
    const rowsHtml = row.months.map(m => {
        return `
            <tr>
                <td>${m.label}</td>
                <td>${m.cutoff1Period}</td>
                <td contenteditable="true" data-month="${m.key}" data-field="cutoff1Basic" class="editable">${formatCurrency(m.cutoff1Basic)}</td>
                ${SHOW_TOTALS ? `<td>${formatCurrency(m.cutoff1Full)}</td>` : ''}
                <td>${m.cutoff2Period}</td>
                <td contenteditable="true" data-month="${m.key}" data-field="cutoff2Basic" class="editable">${formatCurrency(m.cutoff2Basic)}</td>
                ${SHOW_TOTALS ? `<td>${formatCurrency(m.cutoff2Full)}</td>` : ''}
                <td data-role="total-basic" data-month="${m.key}">${formatCurrency(m.cutoff1Basic + m.cutoff2Basic)}</td>
            </tr>
        `;
    }).join('');

    return `
        <table class="period-table">
            <thead>
                <tr>
                    <th>Month</th>
                    <th>Payroll Period</th>
                    <th>First Cutoff (basic)</th>
                    ${SHOW_TOTALS ? '<th>First Cutoff (total)</th>' : ''}
                    <th>Payroll Period</th>
                    <th>Second Cutoff (basic)</th>
                    ${SHOW_TOTALS ? '<th>Second Cutoff (total)</th>' : ''}
                    <th>Total Basic</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml || `<tr><td colspan="${SHOW_TOTALS ? 8 : 6}">No data</td></tr>`}
            </tbody>
        </table>
    `;
}

function exportCSV() {
    const rows = window.__thirteenthRows || [];
    if (!rows.length) return;
    const lines = [];
    lines.push(['Employee', 'Periods Covered', 'YTD Basic', 'YTD Full', '13th Month (YTD/12)'].join(','));
    rows.forEach(r => {
        lines.push([
            `"${r.name}"`,
            r.periodsCovered,
            r.ytdBasic.toFixed(2),
            r.ytdFull.toFixed(2),
            (r.ytdBasic / 12).toFixed(2)
        ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '13th_month_2025.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Kick off
bootstrap().catch(err => {
    console.error(err);
    hideLoading();
});

