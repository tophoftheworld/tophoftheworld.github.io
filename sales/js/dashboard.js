import { db } from './firebase-setup.js';
import { collection, getDocs, doc, setDoc } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

const tbody = document.getElementById("salesTableBody");
const summaryEl = document.getElementById("summaryCards");
const dateRangeInput = document.getElementById("dateRange");
let salesData = [];
let currentBranch = 'sm-north';
let myChart = null;

function formatDateRange(startDate, endDate) {
    const startMonth = startDate.toLocaleString('en-US', { month: 'short' });
    const startDay = startDate.getDate();
    const startYear = startDate.getFullYear();

    const endMonth = endDate.toLocaleString('en-US', { month: 'short' });
    const endDay = endDate.getDate();
    const endYear = endDate.getFullYear();

    // Same year and month
    if (startYear === endYear && startMonth === endMonth) {
        return `${startMonth} ${startDay} - ${endDay}, ${endYear}`;
    }
    // Same year, different months
    else if (startYear === endYear) {
        return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${endYear}`;
    }
    // Different years
    else {
        return `${startMonth} ${startDay}, ${startYear} - ${endMonth} ${endDay}, ${endYear}`;
    }
}

flatpickr("#dateRange", {
    mode: "range",
    dateFormat: "M j, Y",
    defaultDate: [
        new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
        new Date()
    ],
    onChange: function (selectedDates) {
        // Clear all active shortcut buttons when custom date is selected
        document.querySelectorAll('.date-shortcut-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Add custom range styling and format display
        const dateInput = document.getElementById('dateRange');
        if (selectedDates.length === 2) {
            dateInput.classList.add('custom-range');
            // Override the display with our custom format
            setTimeout(() => {
                dateInput.value = formatDateRange(selectedDates[0], selectedDates[1]);
            }, 10);
        }

        filterAndRender();
    },
    onReady: function (selectedDates) {
        // Format initial display too
        const dateInput = document.getElementById('dateRange');
        if (selectedDates.length === 2) {
            setTimeout(() => {
                dateInput.value = formatDateRange(selectedDates[0], selectedDates[1]);
            }, 10);
        }
    }
});

// Add date range shortcuts
const dateRangeEl = document.getElementById("dateRange");
const controlsEl = document.querySelector(".controls");

// Create context-aware shortcuts
function createDateShortcuts(viewType) {
    const shortcutsContainer = document.getElementById("dateShortcuts");
    shortcutsContainer.innerHTML = "";

    let shortcuts = [];

    switch (viewType) {
        case 'daily':
            shortcuts = ["Last 7 days", "Last 30 days", "Month to Date", "Last 3 Months"];
            break;
        case 'weekly':
            shortcuts = ["Last 4 weeks", "Last 8 weeks", "Last 12 weeks", "This Year"];
            break;
        case 'monthly':
            shortcuts = ["Current Year", "Last 6 months", "Last 12 months", "All Data"];
            break;
    }

    shortcuts.forEach(label => {
        const btn = document.createElement("button");
        btn.innerText = label;
        btn.className = "date-shortcut-btn";
        btn.onclick = () => setDateRangeShortcut(label, viewType);
        shortcutsContainer.appendChild(btn);
    });
}

function setDateRangeShortcut(type, viewType) {
    const now = new Date();
    let start, end;

    switch (type) {
        // Daily view shortcuts
        case "Last 7 days":
            start = new Date(now);
            start.setDate(now.getDate() - 7);
            end = now;
            break;
        case "Last 30 days":
            start = new Date(now);
            start.setDate(now.getDate() - 30);
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59); // End of today
            break;
        case "Month to Date":
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = now;
            break;
        case "Last 3 Months":
            start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
            end = now;
            break;

        // Weekly view shortcuts
        case "Last 4 weeks":
            start = new Date(now);
            start.setDate(now.getDate() - 28);
            end = now;
            break;
        case "Last 8 weeks":
            start = new Date(now);
            start.setDate(now.getDate() - 56);
            end = now;
            break;
        case "Last 12 weeks":
            start = new Date(now);
            start.setDate(now.getDate() - 84);
            end = now;
            break;
        case "This Year":
            start = new Date(now.getFullYear(), 0, 1);
            end = now;
            break;

        // Monthly view shortcuts
        case "Current Year":
            start = new Date(now.getFullYear(), 0, 1);
            end = now;
            break;
        case "Last 6 months":
            start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
            end = now;
            break;
        case "Last 12 months":
            start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
            end = now;
            break;
        case "All Data":
            // Find the earliest date in our actual data
            const earliestDate = findEarliestDataDate();
            start = earliestDate || new Date(now.getFullYear(), 0, 1); // fallback to this year
            end = now;
            break;
    }

    dateRangeInput._flatpickr.setDate([start, end]);

    // Format the display with our custom format
    setTimeout(() => {
        const dateInput = document.getElementById('dateRange');
        dateInput.value = formatDateRange(start, end);
    }, 10);

    // Add active state to clicked shortcut
    document.querySelectorAll('.date-shortcut-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === type);
    });

    // Remove custom range styling when using shortcuts
    document.getElementById('dateRange').classList.remove('custom-range');

    filterAndRender();
}

function findEarliestDataDate() {
    if (salesData.length === 0) return null;

    // Find the earliest date from actual sales data
    const dates = salesData.map(item => {
        const dateParts = item.id.split('-');
        return new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
    });

    return new Date(Math.min(...dates));
}

// Show/hide import section based on branch
function toggleImportSection() {
    const importSection = document.getElementById('importSection');
    const currentBranch = document.getElementById('branchSelector').value;

    if (currentBranch === 'podium') {
        // importSection.style.display = 'flex';
    } else {
        importSection.style.display = 'none';
    }
}

// Initialize CSV import functionality
function initializeCSVImport() {
    const fileInput = document.getElementById('csvFileInput');
    const importBtn = document.getElementById('importBtn');
    const importStatus = document.getElementById('importStatus');

    fileInput.addEventListener('change', function (e) {
        importBtn.disabled = !e.target.files.length;
        importStatus.textContent = '';
        importStatus.className = 'import-status';
    });

    importBtn.addEventListener('click', async function () {
        const file = fileInput.files[0];
        if (!file) return;

        importBtn.disabled = true;
        importBtn.textContent = 'Importing...';
        importStatus.textContent = 'Processing CSV file...';
        importStatus.className = 'import-status';

        try {
            await importCSVData(file);
            importStatus.textContent = 'Import successful!';
            importStatus.className = 'import-status success';

            // Reload data to show imported records
            loadSalesData();
        } catch (error) {
            console.error('Import failed:', error);
            importStatus.textContent = `Import failed: ${error.message}`;
            importStatus.className = 'import-status error';
        } finally {
            importBtn.disabled = false;
            importBtn.textContent = 'Import Data';
        }
    });
}

// Parse and import CSV data
async function importCSVData(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = async function (e) {
            try {
                const csvText = e.target.result;
                // Split by newlines and clean up
                const lines = csvText.split(/\r?\n/).filter(line => line.trim());

                // Parse headers - split by comma and clean quotes
                const headers = lines[0].split(',').map(header => header.replace(/"/g, '').trim());

                console.log('Parsed headers:', headers);

                // Validate CSV format
                if (!validateCSVFormat(headers)) {
                    throw new Error('Invalid CSV format. Please check the file structure.');
                }

                const records = [];

                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    // Parse values - split by comma and clean quotes
                    const values = line.split(',').map(value => value.replace(/"/g, '').trim());
                    const record = parseCSVRow(headers, values);
                    if (record) {
                        records.push(record);
                    }
                }

                console.log(`Parsed ${records.length} records`);

                // Save to Firebase
                await saveRecordsToFirebase(records);
                resolve();

            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

// Validate CSV format
function validateCSVFormat(headers) {
    const requiredHeaders = ['Day', 'Total', 'Cash', 'Card', 'Grab', 'BankTransfer', 'Maya', 'QRPh', 'gcash', 'GiftCard', 'Expense'];
    const missing = requiredHeaders.filter(header => !headers.includes(header));

    if (missing.length > 0) {
        console.log('Missing headers:', missing);
        console.log('Available headers:', headers);
        return false;
    }

    return true;
}

// Parse a single CSV row
function parseCSVRow(headers, values) {
    if (values.length !== headers.length) {
        console.log(`Row length mismatch: ${values.length} values vs ${headers.length} headers`);
        return null;
    }

    const row = {};
    headers.forEach((header, index) => {
        row[header] = values[index];
    });

    // Parse date (format: "29 Jul 25")
    const dateStr = row['Day'];
    if (!dateStr) {
        console.log('Missing Day field');
        return null;
    }

    const dateParts = dateStr.split(' ');
    if (dateParts.length !== 3) {
        console.log('Invalid date format:', dateStr);
        return null;
    }

    const day = parseInt(dateParts[0]);
    const monthStr = dateParts[1];
    const yearNum = parseInt(dateParts[2]);
    const year = yearNum < 100 ? 2000 + yearNum : yearNum;

    const monthMap = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };

    const month = monthMap[monthStr];
    if (month === undefined) {
        console.log('Invalid month:', monthStr);
        return null;
    }

    // Fix timezone issue by using UTC date
    const date = new Date(Date.UTC(year, month, day));
    const dateId = date.toISOString().split('T')[0];

    console.log(`Parsing: ${dateStr} -> ${dateId} -> ${date.toLocaleDateString('en-PH', { weekday: 'long' })}`);

    const totalSales = parseFloat(row['Total']) || 0;
    const grabSales = parseFloat(row['Grab']) || 0;
    const cardSales = parseFloat(row['Card']) || 0;
    const cashSales = parseFloat(row['Cash']) || 0;
    const giftCardSales = parseFloat(row['GiftCard']) || 0;

    // Consolidate QR payments: BankTransfer + Maya + QRPh + gcash
    const qrSales = (parseFloat(row['BankTransfer']) || 0) +
        (parseFloat(row['Maya']) || 0) +
        (parseFloat(row['QRPh']) || 0) +
        (parseFloat(row['gcash']) || 0);

    console.log(`${row['Day']}: BankTransfer=${row['BankTransfer']}, Maya=${row['Maya']}, QRPh=${row['QRPh']}, gcash=${row['gcash']}, Total QR=${qrSales}`);

    // Walk-in = Total - Grab
    const walkInSales = totalSales - grabSales;

    return {
        id: dateId,
        staff: '-',
        totalSales: totalSales, // Use CSV total directly
        walkInSales: walkInSales,
        cash: cashSales,
        card: cardSales, // Add card field
        qr: qrSales,
        grab: grabSales,
        giftCard: giftCardSales,
        expenses: parseFloat(row['Expense']) || 0,
        actualCashLeft: 0,
        csvData: {
            transactions: parseInt(row['No. of Transactions']) || 0,
            items: parseInt(row['No. of Items']) || 0,
            cost: parseFloat(row['Cost']) || 0,
            profit: parseFloat(row['Profit']) || 0
        }
    };
}

async function saveRecordsToFirebase(records) {
    let imported = 0;

    for (const record of records) {
        const docRef = doc(db, 'sales-data', 'podium', 'daily', record.id);
        await setDoc(docRef, record);
        imported++;

        // Log each imported record
        console.log(`Imported ${imported}/${records.length}: ${record.id} - Total: ₱${record.totalSales}`);
    }

    console.log(`Import complete: ${imported} records imported`);
}

async function loadSalesData() {
    let collectionPath;

    if (currentBranch === 'sm-north') {
        // Keep existing structure for SM North
        collectionPath = 'sales';
        const snapshot = await getDocs(collection(db, collectionPath));
        salesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
        // Use new structure for Podium
        collectionPath = 'sales-data/podium/daily';
        const snapshot = await getDocs(collection(db, 'sales-data', 'podium', 'daily'));
        salesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    filterAndRender();
}

// Set default view and shortcuts
let currentView = 'daily';

function changeView(newView) {
    currentView = newView;

    // Update button states
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === newView);
    });

    // Update shortcuts
    createDateShortcuts(newView);

    // Set appropriate default date range
    setTimeout(() => {
        setDefaultDateRange(newView);
    }, 50);

    // Update current graph view to match
    currentGraphView = newView;

    // Update projection toggle availability
    updateProjectionToggle(newView);

    filterAndRender();
}

// Chart display type
let currentChartDisplay = 'total';
let showProjections = false;

// Initialize chart controls
function initializeChartControls() {
    // Chart display options
    document.querySelectorAll('#chartDisplayOptions .option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentChartDisplay = btn.dataset.type;

            // Update button states
            document.querySelectorAll('#chartDisplayOptions .option-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.type === currentChartDisplay);
            });

            filterAndRender();
        });
    });

    // Projection toggle
    const projectionToggle = document.getElementById('projectionToggle');
    projectionToggle.addEventListener('click', () => {
        showProjections = !showProjections;
        projectionToggle.classList.toggle('active', showProjections);
        projectionToggle.textContent = showProjections ? 'Hide Projections' : 'Show Projections';
        filterAndRender();
    });
}

// Update projection toggle based on view
function updateProjectionToggle(viewType) {
    const projectionToggle = document.getElementById('projectionToggle');
    const isMonthly = viewType === 'monthly';

    projectionToggle.disabled = !isMonthly;
    if (!isMonthly) {
        showProjections = false;
        projectionToggle.classList.remove('active');
        projectionToggle.textContent = 'Show Projections';
    }
}

function setDefaultDateRange(viewType) {
    switch (viewType) {
        case 'daily':
            setDateRangeShortcut("Last 30 days", viewType);
            break;
        case 'weekly':
            setDateRangeShortcut("Last 12 weeks", viewType);
            break;
        case 'monthly':
            setDateRangeShortcut("Current Year", viewType);
            break;
    }
}

document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => changeView(btn.dataset.view));
    });

    // Initialize chart controls
    initializeChartControls();

    // Initialize with daily view and proper highlighting
    createDateShortcuts('daily');

    // Initialize CSV import
    initializeCSVImport();

    // Show/hide import section based on branch
    toggleImportSection();

    // Branch selector handler
    document.getElementById('branchSelector').addEventListener('change', function (e) {
        currentBranch = e.target.value;

        toggleImportSection(); // Add this line
        loadSalesData();
    });

    // Set default after a small delay to ensure flatpickr is ready
    setTimeout(() => {
        setDefaultDateRange('daily');
    }, 100);
});

function filterAndRender() {
    const [start, end] = dateRangeInput._flatpickr.selectedDates;
    if (!start || !end) return;

    const days = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        days.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }

    const dataMap = new Map(salesData.map(item => [item.id, item]));
    let monthTotal = 0, weekdayTotal = 0, weekendTotal = 0, weekdayCount = 0, weekendCount = 0;

    // Update table based on current view
    updateTableForView(days, dataMap, currentGraphView);

    // Generate view-specific summary cards
    summaryEl.innerHTML = generateSummaryCards(days, dataMap, currentView);

    // Get the EXACT same data that's shown in the table
    const chartData = getChartDataFromTable(currentGraphView);
    renderChart(chartData.labels, chartData.data, currentGraphView);
}

function getChartDataFromTable(viewType) {
    const tableRows = document.querySelectorAll('#salesTableBody tr');
    const labels = [];
    const data = [];

    tableRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length > 0) {
            // First column is always the date/period label
            labels.push(cells[0].textContent.trim());

            // Get data based on chart display type
            let value = 0;
            if (currentChartDisplay === 'total') {
                const totalSalesIndex = viewType === 'daily' ? 3 : 1;
                const totalSalesText = cells[totalSalesIndex].textContent.replace('₱', '').replace(/,/g, '');
                value = parseFloat(totalSalesText) || 0;
            } else if (currentChartDisplay === 'walkin') {
                const walkInIndex = viewType === 'daily' ? 4 : 2;
                const walkInText = cells[walkInIndex].textContent.replace('₱', '').replace(/,/g, '');
                value = parseFloat(walkInText) || 0;
            } else if (currentChartDisplay === 'grab') {
                const grabIndex = viewType === 'daily' ? 9 : 7;
                const grabText = cells[grabIndex].textContent.replace('₱', '').replace(/,/g, '');
                value = parseFloat(grabText) || 0;
            }

            data.push(value);
        }
    });

    // Reverse both arrays so chart shows chronological order
    labels.reverse();
    data.reverse();

    return { labels, data };
}

function generateSummaryCards(days, dataMap, viewType) {
        let periodTotal = 0;
        let dailySales = [];
        let weekdayTotal = 0, weekendTotal = 0, weekdayCount = 0, weekendCount = 0;

        // Collect all sales data based on current chart display
        days.forEach(date => {
            const id = adjustDateForTimezone(date);
            const data = dataMap.get(id);
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;

            if (data) {
                // Calculate sales based on current chart display type
                let salesValue = 0;
                if (currentChartDisplay === 'total') {
                    salesValue = calculateTotalSales(data);
                } else if (currentChartDisplay === 'walkin') {
                    salesValue = calculateWalkInSales(data);
                } else if (currentChartDisplay === 'grab') {
                    salesValue = data.grab || 0;
                }

                periodTotal += salesValue;
                dailySales.push({ date, sales: salesValue });

                if (isWeekend) {
                    weekendTotal += salesValue;
                    weekendCount++;
                } else {
                    weekdayTotal += salesValue;
                    weekdayCount++;
                }
            }
        });

        switch (viewType) {
            case 'daily':
                return generateDailyCards(periodTotal, weekdayTotal, weekdayCount, weekendTotal, weekendCount, dailySales);
            case 'weekly':
                return generateWeeklyCards(periodTotal, dailySales, days);
            case 'monthly':
                return generateMonthlyCards(periodTotal, dailySales, days);
            default:
                return '';
        }
    }

    function generateDailyCards(periodTotal, weekdayTotal, weekdayCount, weekendTotal, weekendCount, dailySales) {
            const bestDay = dailySales.reduce((best, current) =>
                current.sales > best.sales ? current : best, { sales: 0, date: null });

            const displayType = currentChartDisplay === 'total' ? 'Total' :
                currentChartDisplay === 'walkin' ? 'Walk-In' : 'Grab';

            return `
<div class="summary-card">
    <div class="card-title">Period ${displayType}</div>
    <div class="card-value">${format(periodTotal)}</div>
</div>
<div class="summary-card">
    <div class="card-title">Weekday Average</div>
    <div class="card-value">${format(weekdayCount ? weekdayTotal / weekdayCount : 0)}</div>
</div>
<div class="summary-card">
    <div class="card-title">Weekend Average</div>
    <div class="card-value">${format(weekendCount ? weekendTotal / weekendCount : 0)}</div>
</div>
<div class="summary-card">
    <div class="card-title">Best Day</div>
    <div class="card-value">${bestDay.sales > 0 ? format(bestDay.sales) : '-'}</div>
    ${bestDay.date ? `<div style="font-size: 0.75rem; color: #666; margin-top: 0.25rem;">${bestDay.date.toLocaleDateString("en-PH", { month: 'short', day: 'numeric' })}</div>` : ''}
</div>
`;
        }

    function generateWeeklyCards(periodTotal, dailySales, days) {
            // Use the same rolling 7-day logic as the table
            days.sort((a, b) => b - a); // Latest first

            const weeklyTotals = [];

            for (let i = 0; i < days.length; i += 7) {
                const weekDays = days.slice(i, i + 7);

                if (weekDays.length === 0) continue;

                let weekTotal = 0;
                weekDays.forEach(date => {
                    const salesEntry = dailySales.find(s => s.date.toDateString() === date.toDateString());
                    if (salesEntry) {
                        weekTotal += salesEntry.sales;
                    }
                });

                const newestDate = weekDays[0];
                const oldestDate = weekDays[weekDays.length - 1];
                const range = `${oldestDate.toLocaleDateString("en-PH", { month: 'short', day: 'numeric' })} - ${newestDate.toLocaleDateString("en-PH", { month: 'short', day: 'numeric' })}`;

                weeklyTotals.push({ total: weekTotal, range });
            }

            const bestWeek = weeklyTotals.reduce((best, current) =>
                current.total > best.total ? current : best, { total: 0, range: '' });

            const weeklyAverage = weeklyTotals.length > 0 ?
                weeklyTotals.reduce((sum, week) => sum + week.total, 0) / weeklyTotals.length : 0;

            // Calculate trend (compare last 2 weeks if available)
            let trend = '';
            if (weeklyTotals.length >= 2) {
                const recent = weeklyTotals[0].total;
                const previous = weeklyTotals[1].total;
                trend = recent > previous ? '↗' : recent < previous ? '↘' : '→';
            }

            const displayType = currentChartDisplay === 'total' ? 'Total' :
            currentChartDisplay === 'walkin' ? 'Walk-In' : 'Grab';

        return `
<div class="summary-card">
    <div class="card-title">Period ${displayType}</div>
    <div class="card-value">${format(periodTotal)}</div>
</div>
<div class="summary-card">
    <div class="card-title">Weekly Average</div>
    <div class="card-value">${format(weeklyAverage)}</div>
</div>
<div class="summary-card">
    <div class="card-title">Best Week</div>
    <div class="card-value">${bestWeek.total > 0 ? format(bestWeek.total) : '-'}</div>
    ${bestWeek.range ? `<div style="font-size: 0.75rem; color: #666; margin-top: 0.25rem;">${bestWeek.range}</div>` : ''}
</div>
<div class="summary-card">
    <div class="card-title">Total Weeks</div>
    <div class="card-value">${weeklyTotals.length}</div>
</div>
`;
        }

    function generateMonthlyCards(periodTotal, dailySales, days) {
        // Group data by months
        const monthlyData = groupSalesDataByMonth(dailySales, days);
        const monthlyAverages = monthlyData.map(month => month.total);

        const bestMonth = monthlyData.reduce((best, current) =>
            current.total > best.total ? current : best, { total: 0, month: '' });

        const monthlyAverage = monthlyAverages.length > 0 ?
            monthlyAverages.reduce((sum, val) => sum + val, 0) / monthlyAverages.length : 0;

        const displayType = currentChartDisplay === 'total' ? 'Total' :
            currentChartDisplay === 'walkin' ? 'Walk-In' : 'Grab';

        return `
<div class="summary-card">
    <div class="card-title">Period ${displayType}</div>
    <div class="card-value">${format(periodTotal)}</div>
</div>
<div class="summary-card">
    <div class="card-title">Monthly Average</div>
    <div class="card-value">${format(monthlyAverage)}</div>
</div>
<div class="summary-card">
    <div class="card-title">Best Month</div>
    <div class="card-value">${bestMonth.total > 0 ? format(bestMonth.total) : '-'}</div>
    ${bestMonth.month ? `<div style="font-size: 0.75rem; color: #666; margin-top: 0.25rem;">${bestMonth.month}</div>` : ''}
</div>
<div class="summary-card">
    <div class="card-title">Total Days</div>
    <div class="card-value">${days.length}</div>
</div>
`;
    }

function groupSalesDataByWeek(dailySales, days) {
        const weeks = [];
        const dailyMap = new Map(dailySales.map(item => [item.date.toDateString(), item.sales]));

        for (let i = 0; i < days.length; i += 7) {
            const weekDays = days.slice(i, i + 7);
            let weekTotal = 0;

            weekDays.forEach(day => {
                const sales = dailyMap.get(day.toDateString()) || 0;
                weekTotal += sales;
            });

            if (weekDays.length > 0) {
                const startDate = weekDays[weekDays.length - 1];
                const endDate = weekDays[0];
                const range = `${startDate.toLocaleDateString("en-PH", { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString("en-PH", { month: 'short', day: 'numeric' })}`;

                weeks.push({ total: weekTotal, range });
            }
        }

        return weeks;
    }

    function groupSalesDataByMonth(dailySales, days) {
        const months = {};
        const dailyMap = new Map(dailySales.map(item => [item.date.toDateString(), item.sales]));

        days.forEach(day => {
            const monthKey = day.toLocaleDateString("en-PH", { month: 'short', year: 'numeric' });
            const sales = dailyMap.get(day.toDateString()) || 0;

            if (!months[monthKey]) {
                months[monthKey] = { total: 0, month: monthKey };
            }
            months[monthKey].total += sales;
        });

        return Object.values(months);
    }

function generateTableHeaders(viewType) {
    const headersContainer = document.getElementById('tableHeaders');
    headersContainer.innerHTML = '';

    let headers = [];

    // Branch-specific headers
    if (currentBranch === 'podium') {
        switch (viewType) {
            case 'daily':
                headers = ['Date', 'Day', 'Staff', 'Total Sales', 'Walk-In Sales', 'Cash', 'Card', 'QR', 'Grab', 'Gift Cards', 'Expenses', 'Cash Left'];
                break;
            case 'weekly':
                headers = ['Week Period', 'Total Sales', 'Walk-In Sales', 'Cash', 'QR', 'Grab', 'Gift Cards', 'Expenses'];
                break;
            case 'monthly':
                headers = ['Month', 'Total Sales', 'Walk-In Sales', 'Cash', 'QR', 'Grab', 'Gift Cards', 'Expenses'];
                break;
        }
    } else {
        // SM North headers (existing)
        switch (viewType) {
            case 'daily':
                headers = ['Date', 'Day', 'Staff', 'Total Sales', 'Walk-In Sales', 'Cash', 'GCash', 'Maya', 'Card', 'Grab', 'Expenses', 'Cash Left'];
                break;
            case 'weekly':
                headers = ['Week Period', 'Total Sales', 'Walk-In Sales', 'Cash', 'GCash', 'Maya', 'Card', 'Grab', 'Expenses'];
                break;
            case 'monthly':
                headers = ['Month', 'Total Sales', 'Walk-In Sales', 'Cash', 'GCash', 'Maya', 'Card', 'Grab', 'Expenses'];
                break;
        }
    }

    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header;
        headersContainer.appendChild(th);
    });
}
        
// New function to update table based on view type
function updateTableForView(days, dataMap, viewType) {
    generateTableHeaders(viewType);
    tbody.innerHTML = "";

    if (viewType === 'daily') {
        days.sort((a, b) => b - a);

        days.forEach(date => {
            const id = adjustDateForTimezone(date);
            const data = dataMap.get(id);

            if (data) {
                const walkInSales = calculateWalkInSales(data);
                const totalSales = calculateTotalSales(data);

                const tr = document.createElement("tr");
                let cells = [];

                if (currentBranch === 'podium') {
                    cells = [
                        date.toLocaleDateString("en-PH", { month: 'long', day: 'numeric' }),
                        date.toLocaleDateString("en-PH", { weekday: 'long' }),
                        data?.staff || "-",
                        format(totalSales, true),
                        format(walkInSales, true),
                        format(data?.cash),
                        format(data?.card),
                        format(data?.qr),
                        format(data?.grab),
                        format(data?.giftCard),
                        format(data?.expenses),
                        format(data?.actualCashLeft)
                    ];
                } else {
                    // SM North (existing)
                    cells = [
                        date.toLocaleDateString("en-PH", { month: 'long', day: 'numeric' }),
                        date.toLocaleDateString("en-PH", { weekday: 'long' }),
                        data?.staff || "-",
                        format(totalSales, true),
                        format(walkInSales, true),
                        format(data?.cash),
                        format(data?.gcash),
                        format(data?.maya),
                        format(data?.card),
                        format(data?.grab),
                        format(data?.expenses),
                        format(data?.actualCashLeft)
                    ];
                }

                cells.forEach((text, i) => {
                    const td = document.createElement("td");
                    td.innerHTML = text;
                    if (i === 3) td.classList.add("total"); // Total Sales column
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            }
        });
    }
    else if (viewType === 'weekly') {
        // Group days into rolling 7-day periods (latest first)
        days.sort((a, b) => b - a); // Latest first

        for (let i = 0; i < days.length; i += 7) {
            const weekDays = days.slice(i, i + 7);

            if (weekDays.length === 0) continue;

            // Calculate weekly totals for this 7-day period
            // Calculate weekly totals for this 7-day period
            let weekTotals = {
                walkInSales: 0,
                totalSales: 0,
                cash: 0,
                gcash: 0,
                maya: 0,
                card: 0,
                qr: 0,
                giftCard: 0,
                grab: 0,
                expenses: 0
            };

            weekDays.forEach(date => {
                const id = adjustDateForTimezone(date);
                const data = dataMap.get(id);
                if (data) {
                    weekTotals.walkInSales += calculateWalkInSales(data);
                    weekTotals.totalSales += calculateTotalSales(data);
                    weekTotals.cash += data.cash || 0;
                    weekTotals.grab += data.grab || 0;
                    weekTotals.expenses += data.expenses || 0;

                    if (currentBranch === 'podium') {
                        weekTotals.qr += data.qr || 0;
                        weekTotals.giftCard += data.giftCard || 0;
                    } else {
                        weekTotals.gcash += data.gcash || 0;
                        weekTotals.maya += data.maya || 0;
                        weekTotals.card += data.card || 0;
                    }
                }
            });

            // Create date range label
            const newestDate = weekDays[0];
            const oldestDate = weekDays[weekDays.length - 1];
            const dateRange = `${oldestDate.toLocaleDateString("en-PH", { month: 'short', day: 'numeric' })} - ${newestDate.toLocaleDateString("en-PH", { month: 'short', day: 'numeric' })}`;

            const tr = document.createElement("tr");
            let cells = [];

            if (currentBranch === 'podium') {
                cells = [
                    dateRange,
                    format(weekTotals.totalSales, true),
                    format(weekTotals.walkInSales, true),
                    format(weekTotals.cash),
                    format(weekTotals.qr),
                    format(weekTotals.grab),
                    format(weekTotals.giftCard),
                    format(weekTotals.expenses)
                ];
            } else {
                // SM North (existing)
                cells = [
                    dateRange,
                    format(weekTotals.totalSales, true),
                    format(weekTotals.walkInSales, true),
                    format(weekTotals.cash),
                    format(weekTotals.gcash),
                    format(weekTotals.maya),
                    format(weekTotals.card),
                    format(weekTotals.grab),
                    format(weekTotals.expenses)
                ];
            }

            cells.forEach((text, i) => {
                const td = document.createElement("td");
                td.innerHTML = text;
                if (i === 1) td.classList.add("total");
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        }
    }

    // Updated monthly view in updateTableForView function
    else if (viewType === 'monthly') {
        // Group days by month - include year
        const monthGroups = {};
        days.forEach(date => {
            const monthKey = date.toLocaleDateString("en-PH", { month: 'short', year: 'numeric' });
            if (!monthGroups[monthKey]) {
                monthGroups[monthKey] = [];
            }
            monthGroups[monthKey].push(date);
        });

        const sortedMonthKeys = Object.keys(monthGroups).sort((a, b) => {
            const [monthA, yearA] = a.split(' ');
            const [monthB, yearB] = b.split(' ');
            const dateA = new Date(parseInt(yearA), getMonthNumber(monthA), 1);
            const dateB = new Date(parseInt(yearB), getMonthNumber(monthB), 1);
            return dateB - dateA; // Descending order
        });

        sortedMonthKeys.forEach(monthKey => {
            const monthDays = monthGroups[monthKey];

            // Calculate monthly totals
            let monthTotals = {
                walkInSales: 0,
                totalSales: 0,
                cash: 0,
                gcash: 0,
                maya: 0,
                card: 0,
                qr: 0,
                giftCard: 0,
                grab: 0,
                expenses: 0,
                cashLeft: 0
            };

            monthDays.forEach(date => {
                const id = adjustDateForTimezone(date);
                const data = dataMap.get(id);
                if (data) {
                    // Add to monthly totals using our calculation functions
                    monthTotals.walkInSales += calculateWalkInSales(data);
                    monthTotals.totalSales += calculateTotalSales(data);

                    // Sum payment methods based on branch
                    monthTotals.cash += data.cash || 0;
                    monthTotals.grab += data.grab || 0;
                    monthTotals.expenses += data.expenses || 0;
                    monthTotals.cashLeft += data.actualCashLeft || 0;

                    if (currentBranch === 'podium') {
                        monthTotals.qr += data.qr || 0;
                        monthTotals.giftCard += data.giftCard || 0;
                    } else {
                        monthTotals.gcash += data.gcash || 0;
                        monthTotals.maya += data.maya || 0;
                        monthTotals.card += data.card || 0;
                    }
                }
            });

            const tr = document.createElement("tr");
            let cells = [];

            if (currentBranch === 'podium') {
                cells = [
                    monthKey,
                    format(monthTotals.totalSales, true),
                    format(monthTotals.walkInSales, true),
                    format(monthTotals.cash),
                    format(monthTotals.qr),
                    format(monthTotals.grab),
                    format(monthTotals.giftCard),
                    format(monthTotals.expenses)
                ];
            } else {
                // SM North (existing)
                cells = [
                    monthKey,
                    format(monthTotals.totalSales, true),
                    format(monthTotals.walkInSales, true),
                    format(monthTotals.cash),
                    format(monthTotals.gcash),
                    format(monthTotals.maya),
                    format(monthTotals.card),
                    format(monthTotals.grab),
                    format(monthTotals.expenses)
                ];
            }

            cells.forEach((text, i) => {
                const td = document.createElement("td");
                td.innerHTML = text;
                if (i === 1) td.classList.add("total"); // Total Sales is now column 1
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }
}

function calculateWalkInSales(data) {
    if (currentBranch === 'podium') {
        return (data.cash || 0) + (data.card || 0) + (data.qr || 0) + (data.giftCard || 0);
    } else {
        const hasGrabData = 'grab' in data && data.grab !== undefined;
        if (hasGrabData) {
            return (data.cash || 0) + (data.gcash || 0) + (data.maya || 0) + (data.card || 0);
        } else {
            return data.totalSales || 0;
        }
    }
}

function calculateTotalSales(data) {
    // Use branch-based logic instead of field detection
    if (currentBranch === 'podium') {
        // Podium structure: walkIn + grab
        const walkInSales = calculateWalkInSales(data);
        return walkInSales + (data.grab || 0);
    } else {
        // SM North structure
        const hasGrabData = 'grab' in data && data.grab !== undefined;
        if (hasGrabData) {
            const walkInSales = calculateWalkInSales(data);
            return walkInSales + (data.grab || 0);
        } else {
            return data.totalSales || 0;
        }
    }
}

function format(num, allowEmpty = false) {
    const value = parseFloat(num);
    if (isNaN(value)) return allowEmpty ? "-" : "₱0.00";
    return `₱${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function calculateMonthlyProjection(labels, data) {
    const now = new Date();
    const currentMonth = now.toLocaleDateString("en-PH", { month: 'short', year: 'numeric' });

    // Find the current month in the labels
    const currentMonthIndex = labels.findIndex(label => label === currentMonth);

    if (currentMonthIndex === -1) {
        return { hasProjection: false };
    }

    // Calculate days elapsed and total days in current month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();

    // Don't project if month is almost complete (last 3 days)
    if (daysElapsed >= daysInMonth - 2) {
        return { hasProjection: false };
    }

    // Get smart projection based on weekday/weekend patterns and growth trends
    const smartProjection = calculateSmartProjection(now, daysElapsed, daysInMonth);

    if (!smartProjection) {
        return { hasProjection: false };
    }

    const currentMonthSales = data[currentMonthIndex];
    const projectedTotal = currentMonthSales + smartProjection.remainingProjected;

    // Create projected data array
    const projectedData = data.map((_, index) => {
        if (index === currentMonthIndex) {
            return projectedTotal;
        }
        return null;
    });

    return {
        hasProjection: true,
        projectedData: projectedData,
        projectedTotal: projectedTotal,
        currentTotal: currentMonthSales
    };
}

function calculateSmartProjection(currentDate, daysElapsed, daysInMonth) {
    // Get sales data from last 8 weeks for trend calculation
    const eightWeeksAgo = new Date(currentDate);
    eightWeeksAgo.setDate(currentDate.getDate() - 56);

    // Get sales data from last 2 weeks for baseline
    const twoWeeksAgo = new Date(currentDate);
    twoWeeksAgo.setDate(currentDate.getDate() - 14);

    // Collect weekly data for trend analysis
    const weeklyTotals = getWeeklySalesData(eightWeeksAgo, currentDate);

    if (weeklyTotals.length < 4) {
        return null; // Not enough data
    }

    // Calculate growth trend using linear regression
    const growthTrend = calculateGrowthTrend(weeklyTotals);

    // Get recent weekday/weekend averages (last 2 weeks)
    const recentPatterns = getRecentWeekdayWeekendAverages(twoWeeksAgo, currentDate);

    if (!recentPatterns) {
        return null;
    }

    // Apply growth trend to recent averages
    const projectedWeekdayAvg = recentPatterns.weekdayAvg * (1 + growthTrend);
    const projectedWeekendAvg = recentPatterns.weekendAvg * (1 + growthTrend);

    // Count remaining weekdays and weekends in current month
    const remainingDays = getRemainingDaysInMonth(currentDate, daysElapsed, daysInMonth);

    // Calculate projected remaining sales
    const remainingProjected =
        (remainingDays.weekdays * projectedWeekdayAvg) +
        (remainingDays.weekends * projectedWeekendAvg);

    return {
        remainingProjected: remainingProjected,
        projectedWeekdayAvg: projectedWeekdayAvg,
        projectedWeekendAvg: projectedWeekendAvg
    };
}

function getWeeklySalesData(startDate, endDate) {
    const weeklyTotals = [];
    const dataMap = new Map(salesData.map(item => [item.id, item]));

    // Group by weeks (Monday to Sunday)
    let currentWeekStart = new Date(startDate);

    while (currentWeekStart < endDate) {
        let weekTotal = 0;

        for (let i = 0; i < 7; i++) {
            const currentDay = new Date(currentWeekStart);
            currentDay.setDate(currentWeekStart.getDate() + i);

            if (currentDay > endDate) break;

            const dayId = adjustDateForTimezone(currentDay);
            const dayData = dataMap.get(dayId);

            if (dayData) {
                weekTotal += calculateTotalSales(dayData);
            }
        }

        if (weekTotal > 0) {
            weeklyTotals.push(weekTotal);
        }

        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    }

    return weeklyTotals;
}

function calculateGrowthTrend(weeklyTotals) {
    const n = weeklyTotals.length;
    if (n < 2) return 0;

    // Linear regression to find trend
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (let i = 0; i < n; i++) {
        const x = i; // week number
        const y = weeklyTotals[i]; // sales

        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
    }

    // Calculate slope (rate of change per week)
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgSales = sumY / n;

    // Convert slope to percentage growth per week
    return slope / avgSales;
}

function getRecentWeekdayWeekendAverages(startDate, endDate) {
    const dataMap = new Map(salesData.map(item => [item.id, item]));

    let weekdayTotal = 0, weekendTotal = 0;
    let weekdayCount = 0, weekendCount = 0;

    const currentDay = new Date(startDate);

    while (currentDay <= endDate) {
        const dayId = adjustDateForTimezone(currentDay);
        const dayData = dataMap.get(dayId);

        if (dayData) {
            const sales = calculateTotalSales(dayData);
            const isWeekend = currentDay.getDay() === 0 || currentDay.getDay() === 6;

            if (isWeekend) {
                weekendTotal += sales;
                weekendCount++;
            } else {
                weekdayTotal += sales;
                weekdayCount++;
            }
        }

        currentDay.setDate(currentDay.getDate() + 1);
    }

    if (weekdayCount === 0 && weekendCount === 0) {
        return null;
    }

    return {
        weekdayAvg: weekdayCount > 0 ? weekdayTotal / weekdayCount : 0,
        weekendAvg: weekendCount > 0 ? weekendTotal / weekendCount : 0
    };
}

function getRemainingDaysInMonth(currentDate, daysElapsed, daysInMonth) {
    let weekdays = 0, weekends = 0;

    for (let day = daysElapsed + 1; day <= daysInMonth; day++) {
        const futureDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
        const isWeekend = futureDate.getDay() === 0 || futureDate.getDay() === 6;

        if (isWeekend) {
            weekends++;
        } else {
            weekdays++;
        }
    }

    return { weekdays, weekends };
}

function renderChart(labels, data, viewType) {
    const canvas = document.getElementById('salesChart');
    const ctx = canvas.getContext('2d');

    // Set canvas dimensions
    canvas.style.display = 'block';
    canvas.height = 300;
    canvas.width = document.getElementById('salesChartContainer').offsetWidth - 40;

    // If there's an existing chart, destroy it
    if (myChart !== null) {
        myChart.destroy();
    }

    let datasets = [{
        label: viewType === 'daily' ? 'Daily Sales' :
            viewType === 'weekly' ? 'Weekly Sales' : 'Monthly Sales',
        data: data,
        borderColor: '#2b9348',
        backgroundColor: 'rgba(43, 147, 72, 0.1)',
        tension: 0.3,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: '#2b9348'
    }];

    // Add projection for monthly view - only if enabled
    if (viewType === 'monthly' && showProjections) {
        const allProjections = calculateAllMonthlyProjections(labels, data);
        if (allProjections.length > 0) {
            // Create projection data array
            const projectionData = labels.map((label, index) => {
                const projection = allProjections.find(p => p.monthLabel === label);
                return projection ? projection.projectedTotal : null;
            });

            // Add projected dataset
            datasets.push({
                label: 'Projected',
                data: projectionData,
                borderColor: '#ff6b35',
                backgroundColor: 'rgba(255, 107, 53, 0.1)',
                borderDash: [5, 5],
                tension: 0.3,
                fill: false,
                pointRadius: 4,
                pointBackgroundColor: '#ff6b35',
                pointBorderColor: '#ff6b35',
                pointBorderWidth: 2
            });
        }
    }

    // Create chart
    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false  // Remove the legend entirely
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const label = context.dataset.label || '';
                            const value = format(context.raw);
                            return label ? `${label}: ${value}` : value;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: value => format(value)
                    }
                }
            }
        }
    });
}

function calculateAllMonthlyProjections(labels, data) {
    const projections = [];

    labels.forEach((monthLabel, index) => {
        // Parse the month and year
        const [monthName, year] = monthLabel.split(' ');
        const monthNum = getMonthNumber(monthName);
        const monthDate = new Date(parseInt(year), monthNum, 1);

        // Skip if this is the first month (no historical data to project from)
        if (index === 0) return;

        // For each month, simulate what the projection would have been on day 6
        const simulatedCurrentDate = new Date(parseInt(year), monthNum, 6);
        const daysInMonth = new Date(parseInt(year), monthNum + 1, 0).getDate();

        // Get smart projection as if we were on day 6 of this month
        const smartProjection = calculateSmartProjection(simulatedCurrentDate, 6, daysInMonth);

        if (smartProjection) {
            // Get actual sales for first 6 days of this month
            const actualSalesFirst6Days = getActualSalesForFirstDays(monthDate, 6);
            const projectedTotal = actualSalesFirst6Days + smartProjection.remainingProjected;

            projections.push({
                monthLabel: monthLabel,
                projectedTotal: projectedTotal,
                actualTotal: data[index]
            });
        }
    });

    return projections;
}

function getActualSalesForFirstDays(monthStart, numDays) {
    const dataMap = new Map(salesData.map(item => [item.id, item]));
    let total = 0;

    for (let day = 1; day <= numDays; day++) {
        const currentDay = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
        const dayId = adjustDateForTimezone(currentDay);
        const dayData = dataMap.get(dayId);

        if (dayData) {
            total += calculateTotalSales(dayData);
        }
    }

    return total;
}

function groupDataByRolling7Days(labels, data) {
    const groups = {};
    const groupedData = [];
    const groupedLabels = [];

    // Convert labels back to actual dates for proper grouping
    const dates = labels.map(label => {
        const dateParts = label.split(' ');
        const month = getMonthNumber(dateParts[0]);
        const day = parseInt(dateParts[1]);
        return new Date(2025, month, day);
    });

    // Sort dates in descending order (newest first)
    const sortedIndices = dates
        .map((date, index) => ({ date, index, data: data[index] }))
        .sort((a, b) => b.date - a.date);

    // Group into 7-day periods
    for (let i = 0; i < sortedIndices.length; i += 7) {
        const periodData = sortedIndices.slice(i, i + 7);

        if (periodData.length === 0) continue;

        const newestDate = periodData[0].date;
        const oldestDate = periodData[periodData.length - 1].date;

        // Create label showing date range
        const startLabel = oldestDate.toLocaleDateString("en-PH", { month: 'short', day: 'numeric' });
        const endLabel = newestDate.toLocaleDateString("en-PH", { month: 'short', day: 'numeric' });
        const rangeLabel = `${startLabel} - ${endLabel}`;

        // Sum the data for this 7-day period
        const total = periodData.reduce((sum, item) => sum + item.data, 0);

        groupedLabels.push(rangeLabel);
        groupedData.push(total);

        // Store original data for table view
        groups[`Period ${Math.floor(i / 7) + 1}`] = {
            total: total,
            dates: periodData.map(item => dates[item.index]),
            startDate: oldestDate,
            endDate: newestDate
        };
    }

    // At the end of the function, before the return statement:
    groupedLabels.reverse();
    groupedData.reverse();

    return { labels: groupedLabels, data: groupedData, originalData: groups };
}

// Helper function to group data by week - with date range display
function groupDataByWeek(labels, data) {
    const weeks = {};
    const dateMap = {}; // To track start and end dates of each week

    labels.forEach((label, index) => {
        // Parse date from label
        const dateParts = label.split(' ');
        const month = getMonthNumber(dateParts[0]);
        const day = parseInt(dateParts[1]);

        // Create a date object for 2025
        const date = new Date(2025, month, day);

        // Get ISO week number
        const weekNum = getISOWeek(date);
        const weekKey = `Week ${weekNum}`;

        if (!weeks[weekKey]) {
            weeks[weekKey] = { total: 0, count: 0, dates: [] };
            dateMap[weekKey] = { start: new Date(date), end: new Date(date) };
        } else {
            // Track earliest and latest date in this week
            if (date < dateMap[weekKey].start) dateMap[weekKey].start = new Date(date);
            if (date > dateMap[weekKey].end) dateMap[weekKey].end = new Date(date);
        }

        weeks[weekKey].total += data[index];
        weeks[weekKey].count++;
        weeks[weekKey].dates.push(date);
    });

    // Create readable labels with date ranges
    const weekLabels = Object.keys(weeks);
    const formattedLabels = weekLabels.map(weekKey => {
        const start = dateMap[weekKey].start;
        const end = dateMap[weekKey].end;
        return `${start.toLocaleDateString("en-PH", { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString("en-PH", { month: 'short', day: 'numeric' })}`;
    });

    const weekData = weekLabels.map(week => weeks[week].total);

    return { labels: formattedLabels, data: weekData, originalData: weeks };
}

// Helper function to calculate ISO week number
function getISOWeek(date) {
    const target = new Date(date.valueOf());

    // ISO week date weeks start on Monday, so correct the day number
    const dayNr = (date.getDay() + 6) % 7;

    // ISO 8601 states that week 1 is the week with the first Thursday of that year
    // Set target date to the Thursday in the target week
    target.setDate(target.getDate() - dayNr + 3);

    // Store the timestamp of target date
    const firstThursday = target.valueOf();

    // Set target to first Thursday of the year
    // First, get the first day of the year
    target.setMonth(0, 1);

    // Not a Thursday? Correct the date to the next Thursday
    if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }

    // The week number is the number of weeks between the first Thursday of the year
    // and the Thursday in the target week
    return 1 + Math.ceil((firstThursday - target) / 604800000); // 604800000 = 7 * 24 * 3600 * 1000
}

function groupDataByMonth(labels, data) {
    const months = {};
    const [start] = dateRangeInput._flatpickr.selectedDates;

    // We need to reconstruct the actual dates from labels and date range
    const cursor = new Date(start);
    const dateToDataMap = new Map();

    // Create a mapping of date strings to data values
    labels.forEach((label, index) => {
        dateToDataMap.set(label, data[index]);
    });

    // Go through each date in range and group by month
    while (cursor <= dateRangeInput._flatpickr.selectedDates[1]) {
        const dateLabel = cursor.toLocaleDateString("en-PH", { month: 'short', day: 'numeric' });
        const monthKey = cursor.toLocaleDateString("en-PH", { month: 'short', year: 'numeric' });

        if (dateToDataMap.has(dateLabel)) {
            if (!months[monthKey]) {
                months[monthKey] = { total: 0, count: 0 };
            }
            months[monthKey].total += dateToDataMap.get(dateLabel);
            months[monthKey].count++;
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    // Sort and return
    const sortedEntries = Object.entries(months).sort((a, b) => {
        const [monthA, yearA] = a[0].split(' ');
        const [monthB, yearB] = b[0].split(' ');
        const dateA = new Date(parseInt(yearA), getMonthNumber(monthA), 1);
        const dateB = new Date(parseInt(yearB), getMonthNumber(monthB), 1);
        return dateA - dateB;
    });

    return {
        labels: sortedEntries.map(([key]) => key),
        data: sortedEntries.map(([, value]) => value.total)
    };
}

// Helper function to get month number from abbreviation
function getMonthNumber(monthAbbr) {
    const months = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };
    return months[monthAbbr];
}

function adjustDateForTimezone(date) {
        // Get the date with timezone adjustment
        const adjustedDate = new Date(Date.UTC(
            date.getFullYear(),
            date.getMonth(),
            date.getDate()
        ));
        return adjustedDate.toISOString().split('T')[0];
    }

// Branch selector handler
document.getElementById('branchSelector').addEventListener('change', function (e) {
    currentBranch = e.target.value;
    loadSalesData(); // Reload data for new branch
});

loadSalesData();

// Default view type
let currentGraphView = "daily";
let showGrabInChart = true;

// Function to change graph view
function changeGraphView(type) {
    currentGraphView = type;
    document.querySelectorAll('.graph-type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
    });
    filterAndRender();
}