import { db } from './firebase-setup.js';
import { collection, getDocs, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';

// Global variables
let currentBranch = 'podium';
let currentQuarter = getCurrentQuarter();
let salesData = [];
let expensesData = [];

// Get current quarter based on current date, but limit to Q3 2025
function getCurrentQuarter() {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    
    // For 2025, only show up to Q3
    if (year === 2025) {
        if (month >= 0 && month <= 2) return `Q1-2025`;
        if (month >= 3 && month <= 5) return `Q2-2025`;
        return `Q3-2025`; // Default to Q3 for months 6-11
    }
    
    // For other years, default to Q3 2025
    return `Q3-2025`;
}

// Initialize the report
document.addEventListener('DOMContentLoaded', function() {
    initializeReport();
    setupEventListeners();
});

function initializeReport() {
    console.log('Initializing quarterly report...');
    setupQuarterSelector();
    updateReportPeriod();
    loadReportData();
}

function setupQuarterSelector() {
    const quarterSelector = document.getElementById('quarterSelector');
    if (!quarterSelector) return;

    // Only show Q1 2025 to Q3 2025
    const quarters = ['Q1-2025', 'Q2-2025', 'Q3-2025'];

    quarterSelector.innerHTML = quarters.map(quarter => {
        const isActive = quarter === currentQuarter ? 'active' : '';
        const quarterDisplay = quarter.replace('-', ' ');
        return `<button class="quarter-btn ${isActive}" data-quarter="${quarter}">${quarterDisplay}</button>`;
    }).join('');
}

function setupEventListeners() {
    // Branch selector
    const branchSelector = document.getElementById('branchSelector');
    if (branchSelector) {
        branchSelector.addEventListener('change', function() {
            currentBranch = this.value;
            loadReportData();
        });
    }

    // Quarter selector - use event delegation since buttons are dynamically created
    const quarterSelector = document.getElementById('quarterSelector');
    if (quarterSelector) {
        quarterSelector.addEventListener('click', function(e) {
            if (e.target.classList.contains('quarter-btn')) {
                // Remove active class from all buttons
                const quarterButtons = quarterSelector.querySelectorAll('.quarter-btn');
                quarterButtons.forEach(btn => btn.classList.remove('active'));
                // Add active class to clicked button
                e.target.classList.add('active');
                
                currentQuarter = e.target.dataset.quarter;
                updateReportPeriod();
                loadReportData();
            }
        });
    }
}

function updateReportPeriod() {
    const reportPeriod = document.getElementById('reportPeriod');
    // if (!reportPeriod) return; // Don't return early, we still need to update table headers

    let startMonth, endMonth, year;

    // Parse quarter format (e.g., "Q2-2025")
    const [quarter, quarterYear] = currentQuarter.split('-');
    year = parseInt(quarterYear);

    switch (quarter) {
        case 'Q1':
            startMonth = 0; // January
            endMonth = 2;   // March
            break;
        case 'Q2':
            startMonth = 3; // April
            endMonth = 5;   // June
            break;
        case 'Q3':
            startMonth = 6; // July
            endMonth = 8;   // September
            break;
        case 'Q4':
            startMonth = 9; // October
            endMonth = 11; // December
            break;
        default:
            // Fallback to current quarter
            const now = new Date();
            const currentMonth = now.getMonth();
            if (currentMonth >= 0 && currentMonth <= 2) {
                startMonth = 0; endMonth = 2; year = now.getFullYear();
            } else if (currentMonth >= 3 && currentMonth <= 5) {
                startMonth = 3; endMonth = 5; year = now.getFullYear();
            } else if (currentMonth >= 6 && currentMonth <= 8) {
                startMonth = 6; endMonth = 8; year = now.getFullYear();
            } else {
                startMonth = 9; endMonth = 11; year = now.getFullYear();
            }
            break;
    }

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    
    const startMonthName = monthNames[startMonth];
    const endMonthName = monthNames[endMonth];
    
    // Update report period if element exists
    if (reportPeriod) {
        reportPeriod.textContent = `${startMonthName} ${year} - ${endMonthName} ${year}`;
    }
    
    // Update table headers
    updateTableHeaders(startMonth, endMonth, year);
}

function updateTableHeaders(startMonth, endMonth, year) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    
    const month1Header = document.getElementById('month1Header');
    const month2Header = document.getElementById('month2Header');
    const month3Header = document.getElementById('month3Header');
    
    if (month1Header) month1Header.textContent = `${monthNames[startMonth]} ${year}`;
    if (month2Header) month2Header.textContent = `${monthNames[startMonth + 1]} ${year}`;
    if (month3Header) month3Header.textContent = `${monthNames[startMonth + 2]} ${year}`;
}

async function loadReportData() {
    try {
        console.log(`Loading report data for ${currentBranch} - ${currentQuarter}`);
        
        // Show loading state
        showLoadingState();
        
        // Load sales and expenses data in parallel
        await Promise.all([
            loadSalesData(),
            loadExpensesData()
        ]);
        
        // Process and display the data
        processAndDisplayData();
        
    } catch (error) {
        console.error('Error loading report data:', error);
        showError('Failed to load report data. Please try again.');
    }
}

async function loadSalesData() {
    try {
        console.log(`Loading sales data for branch: ${currentBranch}`);
        console.log('Database object:', db);
        
        if (currentBranch === 'sm-north') {
            console.log('Loading from sales-data/sm-north/daily collection');
            const snapshot = await getDocs(collection(db, 'sales-data', 'sm-north', 'daily'));
            salesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } else {
            // Use new structure for Podium - exactly like sales dashboard
            console.log('Loading from sales-data/podium/daily collection');
            const snapshot = await getDocs(collection(db, 'sales-data', 'podium', 'daily'));
            salesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
        
        console.log(`Loaded ${salesData.length} sales records`);
        if (salesData.length > 0) {
            console.log('Sample sales record:', salesData[0]);
        }
    } catch (error) {
        console.error('Error loading sales data:', error);
        console.error('Error details:', error.message);
        salesData = [];
    }
}

async function loadExpensesData() {
    try {
        console.log(`Loading expenses data for branch: ${currentBranch}`);
        console.log('Database object for expenses:', db);
        
        // Filter expenses by branch
        const branchName = currentBranch === 'sm-north' ? 'SM North' : 'Podium';
        const q = query(
            collection(db, 'expenses'),
            where('branch', '==', branchName)
        );
        
        const snapshot = await getDocs(q);
        expensesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        console.log(`Loaded ${expensesData.length} expense records for ${branchName}`);
    } catch (error) {
        console.error('Error loading expenses data:', error);
        console.error('Error details:', error.message);
        expensesData = [];
    }
}

function processAndDisplayData() {
    console.log('Processing and displaying data...');
    console.log('Sales data length:', salesData.length);
    console.log('Expenses data length:', expensesData.length);
    
    const quarterData = getQuarterData();
    console.log('Quarter data:', quarterData);
    
    updateSummaryCards(quarterData);
    updateQuarterlyTable(quarterData);
    
    // Hide loading state
    hideLoadingState();
}

function getQuarterData() {
    let startMonth, endMonth, year;

    // Parse quarter format (e.g., "Q2-2025")
    const [quarter, quarterYear] = currentQuarter.split('-');
    year = parseInt(quarterYear);

    switch (quarter) {
        case 'Q1':
            startMonth = 0; endMonth = 2; year = year;
            break;
        case 'Q2':
            startMonth = 3; endMonth = 5; year = year;
            break;
        case 'Q3':
            startMonth = 6; endMonth = 8; year = year;
            break;
        case 'Q4':
            startMonth = 9; endMonth = 11; year = year;
            break;
        default:
            // Fallback to current quarter
            const now = new Date();
            const currentMonth = now.getMonth();
            if (currentMonth >= 0 && currentMonth <= 2) {
                startMonth = 0; endMonth = 2; year = now.getFullYear();
            } else if (currentMonth >= 3 && currentMonth <= 5) {
                startMonth = 3; endMonth = 5; year = now.getFullYear();
            } else if (currentMonth >= 6 && currentMonth <= 8) {
                startMonth = 6; endMonth = 8; year = now.getFullYear();
            } else {
                startMonth = 9; endMonth = 11; year = now.getFullYear();
            }
            break;
    }

    const quarterData = {
        months: [
            { month: startMonth, year: year },
            { month: startMonth + 1, year: year },
            { month: startMonth + 2, year: year }
        ],
        sales: [[], [], []],
        expenses: [[], [], []]
    };

    // Process sales data
    console.log(`Processing ${salesData.length} sales records for quarter ${currentQuarter}`);
    console.log('Quarter months:', quarterData.months);
    
    salesData.forEach(sale => {
        const saleDate = new Date(sale.id);
        const saleMonth = saleDate.getMonth();
        const saleYear = saleDate.getFullYear();
        
        quarterData.months.forEach((monthData, index) => {
            if (saleMonth === monthData.month && saleYear === monthData.year) {
                quarterData.sales[index].push(sale);
                console.log(`Added sale to month ${index}: ${sale.id}, amount: ${calculateTotalSales(sale)}`);
            }
        });
    });
    
    console.log('Sales per month:', quarterData.sales.map((sales, index) => `${index}: ${sales.length} records`));

    // Process expenses data
    expensesData.forEach(expense => {
        const expenseDate = new Date(expense.date);
        const expenseMonth = expenseDate.getMonth();
        const expenseYear = expenseDate.getFullYear();
        
        quarterData.months.forEach((monthData, index) => {
            if (expenseMonth === monthData.month && expenseYear === monthData.year) {
                quarterData.expenses[index].push(expense);
            }
        });
    });

    return quarterData;
}

function updateSummaryCards(quarterData) {
    const summaryCards = document.getElementById('summaryCards');
    if (!summaryCards) return;

    // Calculate totals for the quarter
    let totalSales = 0;
    let totalExpenses = 0;
    let totalProfit = 0;

    quarterData.sales.forEach(monthSales => {
        monthSales.forEach(sale => {
            totalSales += calculateTotalSales(sale);
        });
    });

    quarterData.expenses.forEach(monthExpenses => {
        monthExpenses.forEach(expense => {
            totalExpenses += expense.totalAmount || 0;
        });
    });

    totalProfit = totalSales - totalExpenses;

    summaryCards.innerHTML = `
        <div class="summary-card">
            <div class="card-title">Total Sales</div>
            <div class="card-value">₱${totalSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div class="summary-card">
            <div class="card-title">Total Expenses</div>
            <div class="card-value">₱${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div class="summary-card">
            <div class="card-title">Net Profit</div>
            <div class="card-value">₱${totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div class="summary-card">
            <div class="card-title">Profit Margin</div>
            <div class="card-value">${totalSales > 0 ? ((totalProfit / totalSales) * 100).toFixed(1) : 0}%</div>
        </div>
    `;
}

function updateQuarterlyTable(quarterData) {
    // Update sales data
    quarterData.sales.forEach((monthSales, monthIndex) => {
        const monthData = calculateMonthSales(monthSales);
        
        // Update sales cells
        document.getElementById(`totalSales${monthIndex + 1}`).textContent = 
            `₱${monthData.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById(`cashSales${monthIndex + 1}`).textContent = 
            `₱${monthData.cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById(`qrSales${monthIndex + 1}`).textContent = 
            `₱${monthData.qr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById(`cardSales${monthIndex + 1}`).textContent = 
            `₱${monthData.card.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById(`grabSales${monthIndex + 1}`).textContent = 
            `₱${monthData.grab.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    });

    // Update expenses data
    quarterData.expenses.forEach((monthExpenses, monthIndex) => {
        const monthData = calculateMonthExpenses(monthExpenses);
        
        // Update expense cells
        document.getElementById(`totalCosts${monthIndex + 1}`).textContent = 
            `₱${monthData.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById(`generalCosts${monthIndex + 1}`).textContent = 
            `₱${monthData.general.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById(`matchaCosts${monthIndex + 1}`).textContent = 
            `₱${monthData.matcha.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById(`supplierCosts${monthIndex + 1}`).textContent = 
            `₱${monthData.suppliers.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById(`leasingCosts${monthIndex + 1}`).textContent = 
            `₱${monthData.leasing.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById(`salaryCosts${monthIndex + 1}`).textContent = 
            `₱${monthData.salaries.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById(`marketingCosts${monthIndex + 1}`).textContent = 
            `₱${monthData.marketing.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById(`maintenanceCosts${monthIndex + 1}`).textContent = 
            `₱${monthData.maintenance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById(`equipmentCosts${monthIndex + 1}`).textContent = 
            `₱${monthData.equipment.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    });
}

function calculateTotalSales(sale) {
    if (currentBranch === 'podium') {
        return (sale.cash || 0) + (sale.card || 0) + (sale.qr || 0) + (sale.giftCard || 0) + (sale.grab || 0);
    } else {
        return (sale.cash || 0) + (sale.gcash || 0) + (sale.maya || 0) + (sale.card || 0) + (sale.grab || 0);
    }
}

function calculateMonthSales(monthSales) {
    let total = 0, cash = 0, qr = 0, card = 0, grab = 0;
    
    console.log(`Calculating month sales for ${monthSales.length} records`);
    
    monthSales.forEach(sale => {
        const saleTotal = calculateTotalSales(sale);
        total += saleTotal;
        cash += sale.cash || 0;
        qr += sale.qr || 0;
        card += sale.card || 0;
        grab += sale.grab || 0;
    });
    
    console.log(`Month sales calculated: total=${total}, cash=${cash}, qr=${qr}, card=${card}, grab=${grab}`);
    return { total, cash, qr, card, grab };
}

function calculateMonthExpenses(monthExpenses) {
    let total = 0, general = 0, matcha = 0, suppliers = 0, leasing = 0, salaries = 0, marketing = 0, maintenance = 0, equipment = 0;
    
    monthExpenses.forEach(expense => {
        const amount = expense.totalAmount || 0;
        total += amount;
        
        // Use the new expense category field
        const category = expense.expenseCategory || 'General';
        
        switch (category) {
            case 'General':
                general += amount;
                break;
            case 'Matcha':
                matcha += amount;
                break;
            case 'Suppliers':
                suppliers += amount;
                break;
            case 'Leasing':
                leasing += amount;
                break;
            case 'Salaries':
                salaries += amount;
                break;
            case 'Marketing':
                marketing += amount;
                break;
            case 'Maintenance':
                maintenance += amount;
                break;
            case 'Equipment':
                equipment += amount;
                break;
            default:
                general += amount;
                break;
        }
    });
    
    return { total, general, matcha, suppliers, leasing, salaries, marketing, maintenance, equipment };
}

function showLoadingState() {
    const container = document.querySelector('.container');
    if (container) {
        container.classList.add('loading');
    }
}

function hideLoadingState() {
    const container = document.querySelector('.container');
    if (container) {
        container.classList.remove('loading');
    }
}

function showError(message) {
    const container = document.querySelector('.container');
    if (container) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        container.insertBefore(errorDiv, container.firstChild);
        
        // Remove error after 5 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }
}

function showSuccess(message) {
    const container = document.querySelector('.container');
    if (container) {
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = message;
        container.insertBefore(successDiv, container.firstChild);
        
        // Remove success message after 3 seconds
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.parentNode.removeChild(successDiv);
            }
        }, 3000);
    }
}
