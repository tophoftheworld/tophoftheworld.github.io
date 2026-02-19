import { db, collection, doc, getDocs, query, orderBy, addDoc, updateDoc, deleteDoc, setDoc } from './firebase-setup.js';

let currentEvent = 'pop-up';
let selectedDate = new Date();
let allEventsData = {};
let currentChartType = 'daily';
let salesChart = null;
/** 'daily' | 'week' | 'month' */
let dataScope = 'daily';
/** For package service, order.total = cups (not pesos). Used by payment/orders/modal/chart. */
let currentEventIsPackage = false;
/** Cached range data for chart when scope is week/month */
let lastRangeChartData = null;
let lastRangeStart = '';
let lastRangeEnd = '';

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    await loadAvailableEvents();
    setupEventListeners();
    await loadDashboardData();
});

function setupEventListeners() {
    const eventSelector = document.getElementById('eventSelector');
    const dateSelector = document.getElementById('dateSelector');
    const refreshBtn = document.getElementById('refreshBtn');

    if (dateSelector) dateSelector.value = getLocalDateString(selectedDate);

    if (eventSelector) eventSelector.addEventListener('change', async (e) => {
        currentEvent = e.target.value;
        await loadDashboardData();
    });

    if (dateSelector) dateSelector.addEventListener('change', async (e) => {
        selectedDate = new Date(e.target.value + 'T00:00:00');
        await loadDashboardData();
    });

    if (refreshBtn) refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Loading...';
        await loadDashboardData();
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh Data';
    });

    const manageEventsBtn = document.getElementById('manageEventsBtn');
    if (manageEventsBtn) manageEventsBtn.addEventListener('click', showEventManagementModal);

    setupSalesReportDownloadListener();

    // Data scope toggle: Daily vs Week/Month
    document.querySelectorAll('.scope-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const scope = e.target.dataset.scope;
            if (scope === dataScope) return;
            dataScope = scope;
            document.querySelectorAll('.scope-toggle-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.scope === dataScope);
            });
            loadDashboardData();
        });
    });

    // Chart toggle buttons
    document.querySelectorAll('.chart-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const chartType = e.target.dataset.chart;

            document.querySelectorAll('.chart-toggle-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.chart === chartType);
            });

            currentChartType = chartType;

            if (dataScope === 'week' || dataScope === 'month') {
                if (chartType === 'daily' && lastRangeChartData) {
                    updateSalesChartFromRange(lastRangeChartData, lastRangeStart, lastRangeEnd);
                } else {
                    updateHourlySalesChart();
                }
            } else {
                // Daily tab: only selected day. No 60-day load; always show hourly for selected day.
                updateHourlySalesChart();
            }
        });
    });
}

async function loadAvailableEvents() {
    try {
        const firebaseEvents = await loadEventsFromFirebase();

        const eventSelector = document.getElementById('eventSelector');
        eventSelector.innerHTML = '';

        // Filter out archived events for the main dropdown
        const activeEvents = firebaseEvents.filter(event => !event.archived);
        const archivedEvents = firebaseEvents.filter(event => event.archived);

        // Add active events first
        activeEvents.forEach(event => {
            const option = document.createElement('option');
            option.value = event.key;
            option.textContent = `[${event.serviceType === 'package' ? 'Package' : 'Popup'}] ${event.name}`;
            eventSelector.appendChild(option);
        });

        // Add archived section (Legacy Data + any archived Firebase events)
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '--- Archived ---';
        eventSelector.appendChild(separator);

        archivedEvents.forEach(event => {
            const option = document.createElement('option');
            option.value = event.key;
            option.textContent = `[${event.serviceType === 'package' ? 'Package' : 'Popup'}] ${event.name} (Archived)`;
            option.style.color = '#999';
            option.style.fontStyle = 'italic';
            eventSelector.appendChild(option);
        });

        // Always add Legacy Data (pop-up) to archived section
        const legacyOption = document.createElement('option');
        legacyOption.value = 'pop-up';
        legacyOption.textContent = 'Legacy Data (Archived)';
        legacyOption.style.color = '#999';
        legacyOption.style.fontStyle = 'italic';
        eventSelector.appendChild(legacyOption);

        // Set default selection to first active event (not archived)
        if (activeEvents.length > 0) {
            // If current event is archived, switch to first active event
            const currentEventArchived = archivedEvents.some(event => event.key === currentEvent);
            if (currentEventArchived || currentEvent === 'pop-up') {
                currentEvent = activeEvents[0].key;
                eventSelector.value = currentEvent;
                // Trigger reload with new event
                await loadDashboardData();
            } else {
                eventSelector.value = currentEvent;
            }
        } else if (archivedEvents.length > 0) {
            // Only archived events exist, select the first one but warn user
            currentEvent = archivedEvents[0].key;
            eventSelector.value = currentEvent;
            console.warn('Only archived events available');
        } else {
            // No Firebase events - Legacy Data is the only option
            currentEvent = 'pop-up';
            eventSelector.value = 'pop-up';
            await loadDashboardData();
        }

    } catch (error) {
        console.error('Error loading events:', error);
    }
}

async function loadDashboardData() {
    try {
        showLoadingState();

        if (dataScope === 'daily') {
            setScopeSectionTitles('day');
            setChartSectionForScope('daily');
            const dayData = await loadSelectedDayData(currentEvent);
            currentEventIsPackage = (await getCurrentEventServiceType()) === 'package';
            updateStatsFromData(dayData, 'day');
            updatePaymentBreakdown(dayData);
            updateRecentOrders(dayData);
            updateTopItems(dayData);
            updateSalesByItemReport(dayData);
            updateEODSummaryDisplay(dayData);

            // Daily = selected day ONLY. Chart = hourly for this day (one fetch). No 60-day chart.
            setTimeout(() => {
                updateHourlySalesChart();
            }, 0);

            // History = selected day only. Use data we already have; no extra fetch.
            renderSingleDayHistory(dayData);
        } else {
            const isMonth = dataScope === 'month';
            setScopeSectionTitles(isMonth ? 'month' : 'week');
            setChartSectionForScope(isMonth ? 'month' : 'week');
            const { start: startStr, end: endStr } = isMonth ? getMonthRange(selectedDate) : getWeekRange(selectedDate);
            const rangeData = await loadRangeData(currentEvent, startStr, endStr);
            updateStatsFromData(rangeData, 'range');
            updatePaymentBreakdown(rangeData);
            updateRecentOrders(rangeData);
            updateTopItems(rangeData);
            updateSalesByItemReport(rangeData);
            const eodSection = document.getElementById('eodDashboardSection');
            if (eodSection) eodSection.style.display = 'none';

            lastRangeChartData = { dailySales: rangeData.dailySales || {} };
            lastRangeStart = startStr;
            lastRangeEnd = endStr;
            setTimeout(() => {
                updateSalesChartFromRange(lastRangeChartData, startStr, endStr);
            }, 100);

            // Week/Month: load the full history table for the range (or keep 60-day for context)
            setTimeout(() => loadAllEventsData(), 0);
        }

    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showErrorState();
    }
}

async function loadSelectedDayData(eventName) {
    try {
        const selectedDateStr = getLocalDateString(selectedDate);

        const dayRef = collection(db, `pos-orders/${eventName}/${selectedDateStr}`);
        const daySnapshot = await getDocs(dayRef);

        const dayData = {
            orders: [],
            sales: 0,
            cups: 0,
            paymentMethods: { cash: 0, gcash: 0, maya: 0 },
            topItems: {}
        };

        daySnapshot.forEach(orderDoc => {
            const orderData = orderDoc.data();

            // Skip deleted orders
            if (orderData.status === 'deleted') return;

            const order = {
                ...orderData,
                firebaseId: orderDoc.id,
                date: selectedDateStr
            };

            dayData.orders.push(order);
            dayData.sales += orderData.total || 0;

            // Payment methods
            const method = (orderData.paymentMethod || 'cash').toLowerCase();
            if (dayData.paymentMethods[method] !== undefined) {
                dayData.paymentMethods[method] += orderData.total || 0;
            }

            // Top items and cup counting
            if (orderData.items) {
                orderData.items.forEach(item => {
                    const itemName = item.name || 'Unknown Item';
                    if (!dayData.topItems[itemName]) {
                        dayData.topItems[itemName] = { count: 0, total: 0 };
                    }
                    dayData.topItems[itemName].count += item.quantity || 1;
                    dayData.topItems[itemName].total += (item.price || 0) * (item.quantity || 1);

                    // Count cups (exclude desserts)
                    const itemNameLower = itemName.toLowerCase();
                    if (!itemNameLower.includes('cookie') &&
                        !itemNameLower.includes('mochi') &&
                        !itemNameLower.includes('cake') &&
                        !itemNameLower.includes('pastry') &&
                        !itemNameLower.includes('bread') &&
                        !itemNameLower.includes('sandwich')) {
                        if (!dayData.cups) dayData.cups = 0;
                        dayData.cups += item.quantity || 1;
                    }
                });
            }
        });

        // Sort orders by timestamp (newest first)
        dayData.orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return dayData;
    } catch (error) {
        console.error(`Error loading selected day data:`, error);
        return { orders: [], sales: 0, paymentMethods: { cash: 0, gcash: 0, maya: 0 }, topItems: {} };
    }
}

async function loadRangeData(eventName, startStr, endStr) {
    try {
        const rangeData = {
            orders: [],
            sales: 0,
            cups: 0,
            paymentMethods: { cash: 0, gcash: 0, maya: 0 },
            topItems: {},
            dailySales: {}
        };

        const start = new Date(startStr + 'T00:00:00');
        const end = new Date(endStr + 'T00:00:00');

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = getLocalDateString(d);
            try {
                const dayRef = collection(db, `pos-orders/${eventName}/${dateStr}`);
                const daySnapshot = await getDocs(dayRef);
                let dayTotal = 0;

                daySnapshot.forEach(orderDoc => {
                    const orderData = orderDoc.data();
                    if (orderData.status === 'deleted') return;

                    const order = { ...orderData, firebaseId: orderDoc.id, date: dateStr };
                    rangeData.orders.push(order);
                    const total = orderData.total || 0;
                    rangeData.sales += total;
                    dayTotal += total;

                    const method = (orderData.paymentMethod || 'cash').toLowerCase();
                    if (rangeData.paymentMethods[method] !== undefined) {
                        rangeData.paymentMethods[method] += total;
                    }

                    if (orderData.items) {
                        orderData.items.forEach(item => {
                            const itemName = item.name || 'Unknown Item';
                            if (!rangeData.topItems[itemName]) {
                                rangeData.topItems[itemName] = { count: 0, total: 0 };
                            }
                            rangeData.topItems[itemName].count += item.quantity || 1;
                            rangeData.topItems[itemName].total += (item.price || 0) * (item.quantity || 1);
                            const itemNameLower = itemName.toLowerCase();
                            if (!itemNameLower.includes('cookie') && !itemNameLower.includes('mochi') &&
                                !itemNameLower.includes('cake') && !itemNameLower.includes('pastry') &&
                                !itemNameLower.includes('bread') && !itemNameLower.includes('sandwich')) {
                                rangeData.cups += item.quantity || 1;
                            }
                        });
                    }
                });

                rangeData.dailySales[dateStr] = dayTotal;
            } catch (dayError) {
                rangeData.dailySales[getLocalDateString(d)] = 0;
            }
        }

        rangeData.orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return rangeData;
    } catch (error) {
        console.error('Error loading range data:', error);
        return { orders: [], sales: 0, cups: 0, paymentMethods: { cash: 0, gcash: 0, maya: 0 }, topItems: {}, dailySales: {} };
    }
}

async function loadAllDaysChartData(eventName) {
    try {
        const serviceType = await getCurrentEventServiceType();
        const isPackageMode = serviceType === 'package';
        const dailySales = {};

        // Get all available dates for this event (last 60 days max for performance)
        const today = new Date();
        const maxDaysAgo = new Date(today.getTime() - (60 * 24 * 60 * 60 * 1000));

        for (let d = new Date(maxDaysAgo); d <= today; d.setDate(d.getDate() + 1)) {
            const dateStr = getLocalDateString(d);

            try {
                const dayRef = collection(db, `pos-orders/${eventName}/${dateStr}`);
                const daySnapshot = await getDocs(dayRef);

                if (!daySnapshot.empty) {
                    let dailyTotal = 0;
                    daySnapshot.forEach(orderDoc => {
                        const orderData = orderDoc.data();
                        if (orderData.status !== 'deleted') {
                            dailyTotal += orderData.total || 0;
                        }
                    });

                    if (dailyTotal > 0) {
                        dailySales[dateStr] = dailyTotal;
                    }
                }
            } catch (dayError) {
                // Skip days that don't exist
                continue;
            }
        }

        return { dailySales };
    } catch (error) {
        console.error('Error loading chart data:', error);
        return { dailySales: {} };
    }
}

async function loadEventData(eventName) {
    try {
        const eventData = {
            orders: [],
            totalSales: 0,
            dailySales: {},
            paymentMethods: { cash: 0, gcash: 0, maya: 0 },
            topItems: {}
        };

        // Only get the last 7 days instead of 30
        const today = new Date();
        const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));

        for (let d = new Date(sevenDaysAgo); d <= today; d.setDate(d.getDate() + 1)) {
            const dateStr = getLocalDateString(d);

            try {
                const dayRef = collection(db, `pos-orders/${eventName}/${dateStr}`);
                const daySnapshot = await getDocs(dayRef);

                let dailyTotal = 0;

                daySnapshot.forEach(orderDoc => {
                    const orderData = orderDoc.data();

                    // Skip deleted orders
                    if (orderData.status === 'deleted') return;

                    eventData.orders.push({
                        ...orderData,
                        firebaseId: orderDoc.id,
                        date: dateStr
                    });

                    // Add to totals
                    const orderTotal = orderData.total || 0;
                    eventData.totalSales += orderTotal;
                    dailyTotal += orderTotal;

                    // Only track payment methods for selected date
                    if (dateStr === getLocalDateString(selectedDate)) {
                        const method = (orderData.paymentMethod || 'cash').toLowerCase();
                        if (eventData.paymentMethods[method] !== undefined) {
                            eventData.paymentMethods[method] += orderTotal;
                        }

                        // Only track top items for selected date
                        if (orderData.items) {
                            orderData.items.forEach(item => {
                                const itemName = item.name || 'Unknown Item';
                                if (!eventData.topItems[itemName]) {
                                    eventData.topItems[itemName] = { count: 0, total: 0 };
                                }
                                eventData.topItems[itemName].count += item.quantity || 1;
                                eventData.topItems[itemName].total += (item.price || 0) * (item.quantity || 1);
                            });
                        }
                    }
                });

                eventData.dailySales[dateStr] = dailyTotal;

            } catch (dayError) {
                // Day might not exist, that's okay
                eventData.dailySales[dateStr] = 0;
            }
        }

        // Sort orders by timestamp (newest first) - only keep recent ones
        eventData.orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        eventData.orders = eventData.orders.slice(0, 50); // Limit to 50 most recent

        return eventData;
    } catch (error) {
        console.error(`Error loading data for event ${eventName}:`, error);
        return {
            orders: [],
            totalSales: 0,
            dailySales: {},
            paymentMethods: { cash: 0, gcash: 0, maya: 0 },
            topItems: {}
        };
    }
}

async function updateStatsFromData(data, scope) {
    const serviceType = await getCurrentEventServiceType();
    const isPackageMode = serviceType === 'package';
    const isDay = scope === 'day';

    const firstCard = document.querySelector('.stat-card:first-child h3');
    if (firstCard) {
        const firstCardLabel = isDay ? (isPackageMode ? 'Selected Day Cups' : 'Selected Day Sales') : (isPackageMode ? 'Period Cups' : 'Period Sales');
        firstCard.textContent = firstCardLabel;
    }

    const salesEl = document.getElementById('todaySales');
    const ordersEl = document.getElementById('todayOrders');
    const cupsEl = document.getElementById('todayCups');

    if (isPackageMode) {
        const totalCups = data.orders.reduce((total, order) => total + (order.total || 0), 0);
        if (salesEl) salesEl.textContent = `${totalCups} cups`;
        if (cupsEl) cupsEl.textContent = '0';
    } else {
        if (salesEl) salesEl.textContent = formatCurrency(data.sales);
        if (cupsEl) cupsEl.textContent = (data.cups || 0).toString();
    }
    if (ordersEl) ordersEl.textContent = data.orders.length.toString();

    sessionStorage.setItem('currentDayOrders', JSON.stringify(data.orders));
}

function updateEODSummaryDisplay(dayData) {
    const dateStr = getLocalDateString(selectedDate);
    const summaries = JSON.parse(localStorage.getItem('eodSummaries') || '[]');
    const eodSummary = summaries.find(summary =>
        summary.date === dateStr && summary.event === currentEvent
    );

    const eodSection = document.getElementById('eodDashboardSection');
    const eodContent = document.getElementById('eodContent');

    if (eodSummary) {
        eodSection.style.display = 'block';
        eodContent.innerHTML = `
            <div class="eod-dashboard-grid">
                <div class="eod-dashboard-item">
                    <div class="eod-dashboard-label">Starting Cash</div>
                    <div class="eod-dashboard-value">₱${formatCurrency(eodSummary.startingCash).replace('₱', '')}</div>
                </div>
                <div class="eod-dashboard-item">
                    <div class="eod-dashboard-label">Expenses</div>
                    <div class="eod-dashboard-value negative">₱${formatCurrency(eodSummary.expenses).replace('₱', '')}</div>
                </div>
                <div class="eod-dashboard-item">
                    <div class="eod-dashboard-label">Expected Cash</div>
                    <div class="eod-dashboard-value">₱${formatCurrency(eodSummary.expectedCash).replace('₱', '')}</div>
                </div>
                <div class="eod-dashboard-item">
                    <div class="eod-dashboard-label">Actual Cash</div>
                    <div class="eod-dashboard-value">₱${formatCurrency(eodSummary.actualCash).replace('₱', '')}</div>
                </div>
                <div class="eod-dashboard-item">
                    <div class="eod-dashboard-label">Variance</div>
                    <div class="eod-dashboard-value ${eodSummary.variance >= 0 ? 'positive' : 'negative'}">
                        ${eodSummary.variance >= 0 ? '+' : ''}₱${formatCurrency(Math.abs(eodSummary.variance)).replace('₱', '')}
                    </div>
                </div>
            </div>
            <div class="eod-dashboard-timestamp">
                Saved: ${new Date(eodSummary.savedAt).toLocaleString()}
            </div>
        `;
    } else {
        eodSection.style.display = 'block';
        eodContent.innerHTML = `
            <div style="color: #666; font-style: italic; text-align: center; padding: 20px;">
                No end of day summary saved for ${new Date(dateStr).toLocaleDateString()}
            </div>
        `;
    }
}

function updatePaymentBreakdown(dayData) {
    const paymentStats = document.getElementById('paymentStats');
    if (!paymentStats) return;
    const fmt = (v) => currentEventIsPackage ? `${v || 0} cups` : formatCurrency(v || 0);
    paymentStats.innerHTML = `
        <div class="payment-item">
            <span class="payment-method">Cash</span>
            <span class="payment-amount">${fmt(dayData.paymentMethods.cash)}</span>
        </div>
        <div class="payment-item">
            <span class="payment-method">GCash</span>
            <span class="payment-amount">${fmt(dayData.paymentMethods.gcash)}</span>
        </div>
        <div class="payment-item">
            <span class="payment-method">Maya</span>
            <span class="payment-amount">${fmt(dayData.paymentMethods.maya)}</span>
        </div>
    `;
}

function updateRecentOrders(dayData) {
    const recentOrdersList = document.getElementById('recentOrdersList');
    if (!recentOrdersList) return;

    if (dayData.orders.length === 0) {
        recentOrdersList.innerHTML = '<div class="loading">No orders found for selected date</div>';
        return;
    }

    const orderAmount = (order) => currentEventIsPackage ? `${order.total || 0} cups` : formatCurrency(order.total || 0);
    recentOrdersList.innerHTML = dayData.orders.map(order => `
        <div class="order-item" onclick="showOrderDetails('${order.firebaseId}', '${order.id}')">
            <div class="order-info">
                <h4>ORDER-${order.id}</h4>
                <p>${formatDateTime(order.timestamp)} • ${order.paymentMethod || 'Cash'}</p>
                <p>${order.customerName || 'No name'}</p>
            </div>
            <div class="order-amount">${orderAmount(order)}</div>
        </div>
    `).join('');
}

window.showOrderDetails = function (firebaseId, orderId) {
    // Find the order data from the current day's data
    const selectedDayOrders = JSON.parse(sessionStorage.getItem('currentDayOrders') || '[]');
    const order = selectedDayOrders.find(o => o.firebaseId === firebaseId);

    if (!order) {
        alert('Order details not found');
        return;
    }

    // Create modal
    const existingModal = document.querySelector('.order-details-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay order-details-modal';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '500px';

    const header = document.createElement('h2');
    header.textContent = `ORDER-${orderId}`;
    modal.appendChild(header);

    const isPkg = currentEventIsPackage;
    const totalDisplay = isPkg ? `${order.total || 0} cups` : formatCurrency(order.total || 0);
    const itemDisplay = (item) => isPkg ? `${item.quantity || 1} cups` : formatCurrency((item.price || 0) * (item.quantity || 1));
    const content = document.createElement('div');
    content.innerHTML = `
        <div class="order-details-content">
            <div class="order-meta">
                <p><strong>Customer:</strong> ${order.customerName || 'No name'}</p>
                <p><strong>Time:</strong> ${formatDateTime(order.timestamp)}</p>
                <p><strong>Payment:</strong> ${order.paymentMethod || 'Cash'}</p>
            </div>
            <div class="order-items">
                <h3>Items Ordered:</h3>
                <div class="items-list">
                    ${order.items ? order.items.map(item => `
                        <div class="item-row">
                            <div class="item-details">
                                <span class="item-name">${item.name || 'Unknown Item'}</span>
                                <span class="item-quantity">x${item.quantity || 1}</span>
                            </div>
                            <div class="item-price">${itemDisplay(item)}</div>
                        </div>
                    `).join('') : '<p>No items found</p>'}
                </div>
            </div>
            <div class="order-total">
                <strong>Total: ${totalDisplay}</strong>
            </div>
        </div>
    `;
    modal.appendChild(content);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => overlay.remove());
    footer.appendChild(closeBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
};

function updateTopItems(dayData) {
    const topItemsList = document.getElementById('topItemsList');
    if (!topItemsList) return;

    const sortedItems = Object.entries(dayData.topItems)
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 10);

    if (sortedItems.length === 0) {
        topItemsList.innerHTML = '<div class="loading">No items found for selected date</div>';
        return;
    }

    topItemsList.innerHTML = sortedItems.map(([itemName, itemData]) => `
        <div class="item-row">
            <div class="item-info">
                <h4>${itemName}</h4>
                <p>${currentEventIsPackage ? `${itemData.count} cups` : `${itemData.count} sold • ${formatCurrency(itemData.total)} total`}</p>
            </div>
            <div class="item-count">${itemData.count}</div>
        </div>
    `).join('');
}

function updateSalesByItemReport(data) {
    const reportEl = document.getElementById('salesByItemReport');
    if (!reportEl) return;

    const sortedItems = Object.entries(data.topItems || {})
        .sort(([, a], [, b]) => b.count - a.count);

    if (sortedItems.length === 0) {
        reportEl.innerHTML = '<div class="loading">No items sold for selected period</div>';
        return;
    }

    const dateLabel = dataScope === 'daily'
        ? getLocalDateString(selectedDate)
        : dataScope === 'week'
            ? `${getWeekRange(selectedDate).start} to ${getWeekRange(selectedDate).end}`
            : `${getMonthRange(selectedDate).start} to ${getMonthRange(selectedDate).end}`;

    const eventSelector = document.getElementById('eventSelector');
    const eventName = eventSelector ? eventSelector.options[eventSelector.selectedIndex]?.text || currentEvent : currentEvent;

    reportEl.innerHTML = `
        <div class="sales-by-item-meta">
            <div><strong>Event:</strong> ${eventName}</div>
            <div><strong>Period:</strong> ${dateLabel}</div>
        </div>
        <table class="sales-by-item-table">
            <thead>
                <tr>
                    <th>Item</th>
                    <th class="align-right">Qty Sold</th>
                    <th class="align-right">${currentEventIsPackage ? 'Cups' : 'Revenue'}</th>
                </tr>
            </thead>
            <tbody>
                ${sortedItems.map(([itemName, itemData]) => `
                    <tr>
                        <td>${itemName}</td>
                        <td class="align-right">${itemData.count}</td>
                        <td class="align-right">${currentEventIsPackage ? itemData.count + ' cups' : formatCurrency(itemData.total)}</td>
                    </tr>
                `).join('')}
            </tbody>
            <tfoot>
                <tr>
                    <td><strong>Total</strong></td>
                    <td class="align-right"><strong>${sortedItems.reduce((s, [, d]) => s + d.count, 0)}</strong></td>
                    <td class="align-right"><strong>${currentEventIsPackage ? sortedItems.reduce((s, [, d]) => s + d.count, 0) + ' cups' : formatCurrency(sortedItems.reduce((s, [, d]) => s + d.total, 0))}</strong></td>
                </tr>
            </tfoot>
        </table>
    `;
}

async function downloadSalesReportScreenshot() {
    const reportSection = document.getElementById('salesByItemReportSection');
    const btn = document.getElementById('downloadSalesReportBtn');
    if (!reportSection || typeof html2canvas === 'undefined') return;

    const origText = btn?.textContent;
    if (btn) {
        btn.textContent = 'Generating...';
        btn.disabled = true;
    }

    try {
        const canvas = await html2canvas(reportSection, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true
        });
        const link = document.createElement('a');
        const dateStr = getLocalDateString(selectedDate);
        const eventKey = (currentEvent || 'report').replace(/\s+/g, '-');
        link.download = `sales-by-item-${eventKey}-${dateStr}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (err) {
        console.error('Screenshot failed:', err);
        alert('Failed to generate screenshot. Please try again.');
    } finally {
        if (btn) {
            btn.textContent = origText || 'Download Screenshot';
            btn.disabled = false;
        }
    }
}

function setupSalesReportDownloadListener() {
    const btn = document.getElementById('downloadSalesReportBtn');
    if (btn) btn.addEventListener('click', downloadSalesReportScreenshot);
}

function updateSalesChart(eventData) {
    if (currentChartType === 'daily') {
        updateDailySalesChart(eventData);
    } else if (currentChartType === 'hourly') {
        updateHourlySalesChart();
    }
}

function updateDailySalesChart(eventData) {
    const chartContainer = document.querySelector('.chart-container');
    const canvas = document.getElementById('salesChart');
    const simpleChart = document.getElementById('simpleChart');

    // Show canvas, hide simple chart
    canvas.style.display = 'block';
    simpleChart.style.display = 'none';

    // Get last 7 days
    const last7Days = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const date = new Date(today.getTime() - (i * 24 * 60 * 60 * 1000));
        last7Days.push(getLocalDateString(date));
    }

    const salesData = last7Days.map(date => eventData.dailySales[date] || 0);
    const labels = last7Days.map(date => {
        const d = new Date(date);
        return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    });

    const dailyLabel = currentEventIsPackage ? 'Daily Cups' : 'Daily Sales (₱)';
    renderChart(canvas, labels, salesData, dailyLabel, '#2b9348', currentEventIsPackage);
}

function updateSalesChartFromRange(chartData, startStr, endStr) {
    const chartContainer = document.querySelector('.chart-container');
    const canvas = document.getElementById('salesChart');
    const simpleChart = document.getElementById('simpleChart');
    canvas.style.display = 'block';
    simpleChart.style.display = 'none';

    const start = new Date(startStr + 'T00:00:00');
    const end = new Date(endStr + 'T00:00:00');
    const labels = [];
    const salesData = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = getLocalDateString(d);
        labels.push(d.toLocaleDateString('en', { month: 'short', day: 'numeric' }));
        salesData.push(chartData.dailySales[dateStr] || 0);
    }
    const rangeLabel = currentEventIsPackage ? 'Daily Cups' : 'Daily Sales (₱)';
    renderChart(canvas, labels, salesData, rangeLabel, '#2b9348', currentEventIsPackage);
}

async function updateHourlySalesChart() {
    const chartContainer = document.querySelector('.chart-container');
    const canvas = document.getElementById('salesChart');
    const simpleChart = document.getElementById('simpleChart');

    // Show canvas, hide simple chart
    canvas.style.display = 'block';
    simpleChart.style.display = 'none';

    try {
        const hourlyData = await getHourlyData(currentEvent);
        const labels = Array.from({ length: 24 }, (_, i) => {
            const hour = i === 0 ? 12 : i > 12 ? i - 12 : i;
            const ampm = i < 12 ? 'AM' : 'PM';
            return `${hour}${ampm}`;
        });

        const chartLabel = currentEventIsPackage ? 'Hourly Cups' : 'Hourly Sales (₱)';
        renderChart(canvas, labels, hourlyData, chartLabel, '#2b9348', currentEventIsPackage);
    } catch (error) {
        console.error('Error loading hourly data:', error);
        // Fallback to simple chart
        canvas.style.display = 'none';
        simpleChart.style.display = 'block';
        simpleChart.innerHTML = '<div class="loading">Error loading hourly data</div>';
    }
}

function renderChart(canvas, labels, data, label, color, isCups = false) {
    const ctx = canvas.getContext('2d');

    if (salesChart) {
        salesChart.destroy();
    }

    const formatValue = (v) => isCups ? `${v} cups` : formatCurrency(v);

    salesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                borderColor: color,
                backgroundColor: color.replace(')', ', 0.1)').replace('rgb', 'rgba'),
                tension: 0.3,
                fill: true,
                pointRadius: 4,
                pointBackgroundColor: color
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return `${context.dataset.label}: ${formatValue(context.raw)}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: value => formatValue(value)
                    }
                }
            }
        }
    });
}

async function getHourlyData(eventName) {
    try {
        const selectedDateStr = getLocalDateString(selectedDate);
        const dayRef = collection(db, `pos-orders/${eventName}/${selectedDateStr}`);
        const daySnapshot = await getDocs(dayRef);

        // Initialize hourly data (24 hours)
        const hourlyTotals = new Array(24).fill(0);

        daySnapshot.forEach(orderDoc => {
            const orderData = orderDoc.data();

            // Skip deleted orders
            if (orderData.status === 'deleted') return;

            // Extract hour from timestamp
            if (orderData.timestamp) {
                const orderDate = new Date(orderData.timestamp);
                const hour = orderDate.getHours();
                hourlyTotals[hour] += orderData.total || 0;
            }
        });

        return hourlyTotals;
    } catch (error) {
        console.error('Error loading hourly data:', error);
        return new Array(24).fill(0);
    }
}

/** Render Daily Sales History for the selected day only (no extra fetch). */
function renderSingleDayHistory(dayData) {
    const eventsGrid = document.getElementById('eventsGrid');
    if (!eventsGrid) return;

    const dateStr = getLocalDateString(selectedDate);
    const dateObj = new Date(dateStr);
    const dayOfWeek = dateObj.toLocaleDateString('en', { weekday: 'short' });
    const dateDisplay = dateObj.toLocaleDateString('en', { month: 'short', day: 'numeric' });

    getCurrentEventServiceType().then(serviceType => {
        const isPackage = serviceType === 'package';
        const salesCell = isPackage ? `${dayData.orders.reduce((s, o) => s + (o.total || 0), 0)} cups` : formatCurrency(dayData.sales);
        let html = `
            <table class="sales-history-table">
                <thead>
                    <tr>
                        <th>Day</th>
                        <th>Date</th>
                        <th>Sales</th>
                        <th>Orders</th>
                        ${!isPackage ? '<th>Cups</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${dayOfWeek}</td>
                        <td>${dateDisplay}</td>
                        <td>${salesCell}</td>
                        <td>${dayData.orders.length}</td>
                        ${!isPackage ? `<td>${dayData.cups || 0}</td>` : ''}
                    </tr>
                </tbody>
            </table>
        `;
        eventsGrid.innerHTML = dayData.orders.length === 0 && dayData.sales === 0
            ? '<div class="loading">No sales for selected day</div>'
            : html;
    });
}

async function loadAllEventsData() {
    const eventsGrid = document.getElementById('eventsGrid');
    if (!eventsGrid) return;
    eventsGrid.innerHTML = '<div class="loading">Loading sales data...</div>';

    try {
        const salesData = [];

        // Get last 60 days of data for CURRENT EVENT ONLY
        const today = new Date();
        for (let i = 0; i < 60; i++) {
            const date = new Date(today.getTime() - (i * 24 * 60 * 60 * 1000));
            const dateStr = getLocalDateString(date);

            try {
                const dayRef = collection(db, `pos-orders/${currentEvent}/${dateStr}`);
                const daySnapshot = await getDocs(dayRef);

                if (!daySnapshot.empty) {
                    let dailyTotal = 0;
                    let orderCount = 0;
                    let cupCount = 0;

                    daySnapshot.forEach(orderDoc => {
                        const orderData = orderDoc.data();
                        if (orderData.status !== 'deleted') {
                            dailyTotal += orderData.total || 0;
                            orderCount++;

                            // Count cups from drinks (exclude desserts)
                            if (orderData.items) {
                                orderData.items.forEach(item => {
                                    const itemName = (item.name || '').toLowerCase();
                                    // Check if it's NOT a dessert
                                    if (!itemName.includes('cookie') &&
                                        !itemName.includes('mochi') &&
                                        !itemName.includes('cake') &&
                                        !itemName.includes('pastry') &&
                                        !itemName.includes('bread') &&
                                        !itemName.includes('sandwich')) {
                                        cupCount += item.quantity || 1;
                                    }
                                });
                            }
                        }
                    });

                    if (orderCount > 0) {
                        salesData.push({
                            date: dateStr,
                            total: dailyTotal,
                            orders: orderCount,
                            cups: cupCount
                        });
                    }
                }
            } catch (error) {
                continue;
            }
        }

        if (salesData.length === 0) {
            eventsGrid.innerHTML = '<div class="loading">No sales data found</div>';
            return;
        }

        const serviceType = await getCurrentEventServiceType();
        const isPackageMode = serviceType === 'package';

        let html = `
            <table class="sales-history-table">
                <thead>
                    <tr>
                        <th>Day</th>
                        <th>Date</th>
                        <th>Sales</th>
                        <th>Orders</th>
                        ${!isPackageMode ? '<th>Cups</th>' : ''}
                    </tr>
                </thead>
                <tbody>
        `;

        salesData.forEach(record => {
            const dateObj = new Date(record.date);
            const dayOfWeek = dateObj.toLocaleDateString('en', { weekday: 'short' });
            const dateDisplay = dateObj.toLocaleDateString('en', {
                month: 'short',
                day: 'numeric'
            });

            html += `
                <tr>
                    <td>${dayOfWeek}</td>
                    <td>${dateDisplay}</td>
                    <td>${isPackageMode ? record.total + ' cups' : formatCurrency(record.total)}</td>
                    <td>${record.orders}</td>
                    ${!isPackageMode ? `<td>${record.cups}</td>` : ''}
                </tr>
            `;
        });

        html += '</tbody></table>';

        eventsGrid.innerHTML = html;

    } catch (error) {
        console.error('Error loading sales data:', error);
        eventsGrid.innerHTML = '<div class="error">Error loading sales data</div>';
    }
}

// Utility functions
function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getThisWeekRange() {
    const today = new Date();
    const startOfWeek = new Date(today.getTime() - (today.getDay() * 24 * 60 * 60 * 1000));
    const endOfWeek = new Date(startOfWeek.getTime() + (6 * 24 * 60 * 60 * 1000));

    return {
        start: getLocalDateString(startOfWeek),
        end: getLocalDateString(endOfWeek)
    };
}

function getThisMonthRange() {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    return {
        start: getLocalDateString(startOfMonth),
        end: getLocalDateString(endOfMonth)
    };
}

/** Week containing date (Sun–Sat). Start and end as YYYY-MM-DD. */
function getWeekRange(date) {
    const d = new Date(date);
    const day = d.getDay();
    const startOfWeek = new Date(d);
    startOfWeek.setDate(d.getDate() - day);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    return {
        start: getLocalDateString(startOfWeek),
        end: getLocalDateString(endOfWeek)
    };
}

/** Month containing date. Start and end as YYYY-MM-DD. */
function getMonthRange(date) {
    const d = new Date(date);
    const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return {
        start: getLocalDateString(startOfMonth),
        end: getLocalDateString(endOfMonth)
    };
}

function formatCurrency(amount) {
    return `₱${amount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('en', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function setScopeSectionTitles(scope) {
    const suffix = scope === 'day' ? 'Selected Day' : scope === 'week' ? 'Selected Week' : 'Selected Month';
    const paymentTitle = document.getElementById('paymentSectionTitle');
    const ordersTitle = document.getElementById('ordersSectionTitle');
    const topItemsTitle = document.getElementById('topItemsSectionTitle');
    const salesByItemTitle = document.getElementById('salesByItemTitle');
    if (paymentTitle) paymentTitle.textContent = `Payment Methods (${suffix})`;
    if (ordersTitle) ordersTitle.textContent = `Orders (${suffix})`;
    if (topItemsTitle) topItemsTitle.textContent = `Top Items (${suffix})`;
    if (salesByItemTitle) salesByItemTitle.textContent = `Sales by Item Report (${suffix})`;
}

/** On Daily: hide "All Days" / "Peak Hours" toggle and set title to Peak Hours. On Week/Month: show toggle and "Daily Sales". */
function setChartSectionForScope(scope) {
    const wrap = document.getElementById('chartToggleWrap');
    const titleEl = document.getElementById('chartSectionTitle');
    if (scope === 'daily') {
        if (wrap) wrap.style.display = 'none';
        if (titleEl) titleEl.textContent = 'Peak Hours (Selected Day)';
    } else {
        if (wrap) wrap.style.display = '';
        if (titleEl) titleEl.textContent = 'Daily Sales';
    }
}

function showLoadingState() {
    const ids = ['todaySales', 'todayOrders', 'todayCups'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '...';
    });
}

function showErrorState() {
    const ordersEl = document.getElementById('recentOrdersList');
    const itemsEl = document.getElementById('topItemsList');
    const gridEl = document.getElementById('eventsGrid');
    if (ordersEl) ordersEl.innerHTML = '<div class="error">Error loading orders</div>';
    if (itemsEl) itemsEl.innerHTML = '<div class="error">Error loading items</div>';
    if (gridEl) gridEl.innerHTML = '<div class="error">Error loading events data</div>';
}

// Add these functions to dashboard.js

async function loadEventsFromFirebase() {
    try {
        console.log('Loading events from Firebase...');
        const branchesRef = collection(db, 'branches');
        const snapshot = await getDocs(branchesRef);
        const events = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            console.log('Raw document data:', { id: doc.id, data: data });

            if (data.type === 'popup') {
                const event = {
                    id: doc.id,
                    key: data.key,
                    name: data.name,
                    type: data.type,
                    serviceType: data.serviceType || 'popup',
                    archived: data.archived || false,
                    createdAt: data.createdAt
                };
                console.log('Processed event:', event);
                events.push(event);
            }
        });

        console.log('Final events array:', events);
        return events;
    } catch (error) {
        console.error('Error loading events:', error);
        return [];
    }
}

async function saveEventToFirebase(eventData) {
    try {
        const docRef = await addDoc(collection(db, 'branches'), eventData);
        return { id: docRef.id, ...eventData };
    } catch (error) {
        console.error('Error saving event:', error);
        throw error;
    }
}

function showEventManagementModal() {
    const existingModal = document.querySelector('.event-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay event-modal';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '600px';

    const header = document.createElement('h2');
    header.textContent = 'Manage Events';
    modal.appendChild(header);

    const content = document.createElement('div');
    content.innerHTML = `
        <div class="event-management">
            <div class="add-event-section">
                <h3>Add New Event</h3>
                <div class="input-group">
                    <input type="text" id="newEventName" placeholder="Event name" maxlength="30">
                    <select id="serviceTypeSelect" class="service-type-select">
                        <option value="popup">Pop-Up Service</option>
                        <option value="package">Package Service</option>
                    </select>
                    <button id="addEventBtn" class="btn-primary">Add Event</button>
                </div>
            </div>
            <div class="events-list-section">
                <h3>Existing Events</h3>
                <div id="eventsListContainer">Loading...</div>
            </div>
        </div>
    `;
    modal.appendChild(content);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => overlay.remove());
    footer.appendChild(closeBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Setup event listeners
    document.getElementById('addEventBtn').addEventListener('click', handleAddEvent);
    document.getElementById('newEventName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAddEvent();
    });

    loadEventsList();
}

async function loadEventsList() {
    const container = document.getElementById('eventsListContainer');

    try {
        const events = await loadEventsFromFirebase();

        if (events.length === 0) {
            container.innerHTML = '<p>No custom events found</p>';
            return;
        }

        // Separate active and archived events
        const activeEvents = events.filter(event => !event.archived);
        const archivedEvents = events.filter(event => event.archived);

        let html = '';

        // Active events
        if (activeEvents.length > 0) {
            html += '<div class="events-section"><h4>Active Events</h4>';
            html += activeEvents.map(event => `
        <div class="event-item">
            <div class="event-info">
                <strong>${event.name}</strong>
                <small>${event.serviceType === 'package' ? 'Package Service' : 'Pop-Up Service'} • Created: ${new Date(event.createdAt).toLocaleDateString()}</small>
                ${event.customMenu ? '<span class="custom-menu-indicator">Custom Menu</span>' : '<span class="default-menu-indicator">Default Menu</span>'}
            </div>
            <div class="event-actions">
                <button class="btn-menu" onclick="manageEventMenu('${event.id}', '${event.name}')">Menu</button>
                <button class="btn-edit" onclick="editEvent('${event.id}', '${event.name}')">Edit</button>
                <button class="btn-archive" onclick="archiveEvent('${event.id}', '${event.name}', true)">Archive</button>
                <button class="btn-delete" onclick="deleteEvent('${event.id}', '${event.name}')">Delete</button>
            </div>
        </div>
    `).join('');
            html += '</div>';
        }

        // Archived events
        if (archivedEvents.length > 0) {
            html += '<div class="events-section archived-section"><h4>Archived Events</h4>';
            html += archivedEvents.map(event => `
                <div class="event-item archived">
                    <div class="event-info">
                        <strong>${event.name}</strong>
                        <small>${event.serviceType === 'package' ? 'Package Service' : 'Pop-Up Service'} • Archived</small>
                    </div>
                    <div class="event-actions">
                        <button class="btn-unarchive" onclick="archiveEvent('${event.id}', '${event.name}', false)">Unarchive</button>
                        <button class="btn-delete" onclick="deleteEvent('${event.id}', '${event.name}')">Delete</button>
                    </div>
                </div>
            `).join('');
            html += '</div>';
        }

        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = '<p class="error">Error loading events</p>';
    }
}

async function handleAddEvent() {
    const input = document.getElementById('newEventName');
    const serviceTypeSelect = document.getElementById('serviceTypeSelect');
    const eventName = input.value.trim();
    const serviceType = serviceTypeSelect.value;

    if (!eventName || eventName.length < 2) {
        alert('Please enter a valid event name (at least 2 characters)');
        return;
    }

    const eventKey = (serviceType === 'package' ? 'package-' : 'popup-') + eventName.toLowerCase().replace(/[^a-z0-9]/g, '-');

    try {
        const eventData = {
            key: eventKey,
            name: eventName,
            type: 'popup', // Keep for backward compatibility
            serviceType: serviceType, // New field: 'popup' or 'package'
            archived: false, // New field
            createdAt: new Date().toISOString(),
            createdBy: 'dashboard',
            status: 'active'
        };

        await saveEventToFirebase(eventData);
        input.value = '';
        serviceTypeSelect.value = 'popup';
        loadEventsList();
        await loadAvailableEvents();
        alert(`Event "${eventName}" created successfully`);
    } catch (error) {
        alert('Failed to create event');
    }
}

window.editEvent = async function (eventId, currentName) {
    const newName = prompt('Enter new event name:', currentName);
    if (!newName || newName.trim() === currentName) return;

    try {
        const eventRef = doc(db, 'branches', eventId);
        await updateDoc(eventRef, {
            name: newName.trim(),
            lastModified: new Date().toISOString()
        });
        loadEventsList();
        await loadAvailableEvents(); // Refresh dropdown
        alert('Event updated successfully');
    } catch (error) {
        alert('Failed to update event');
    }
};

window.deleteEvent = async function (eventId, eventName) {
    if (!confirm(`Are you sure you want to delete "${eventName}"? This cannot be undone.`)) return;

    try {
        const eventRef = doc(db, 'branches', eventId);
        await deleteDoc(eventRef);
        loadEventsList();
        await loadAvailableEvents(); // Refresh dropdown
        alert('Event deleted successfully');
    } catch (error) {
        alert('Failed to delete event');
    }
};

// Debug function - add to dashboard.js
window.debugTransferSales = async function () {
    console.log('=== DEBUG: Transfer Sales Tool ===');

    // Get available events
    const events = await loadEventsFromFirebase();
    console.log('Available events:', events);

    if (events.length === 0) {
        console.log('No custom events found. Create an event first.');
        return;
    }

    // Show selection modal
    const targetEvent = prompt(`Transfer last 5 days from 'pop-up' to which event?\n\nAvailable events:\n${events.map((e, i) => `${i + 1}. ${e.name} (${e.key})`).join('\n')}\n\nEnter the number:`);

    if (!targetEvent || isNaN(targetEvent)) {
        console.log('Transfer cancelled');
        return;
    }

    const selectedEvent = events[parseInt(targetEvent) - 1];
    if (!selectedEvent) {
        console.log('Invalid selection');
        return;
    }

    console.log(`Transferring to: ${selectedEvent.name} (${selectedEvent.key})`);

    try {
        // Get last 5 days
        const today = new Date();
        const transferredOrders = [];

        for (let i = 0; i < 5; i++) {
            const date = new Date(today.getTime() - (i * 24 * 60 * 60 * 1000));
            const dateStr = getLocalDateString(date);

            console.log(`Processing date: ${dateStr}`);

            // Get orders from pop-up for this date
            const popupRef = collection(db, `pos-orders/pop-up/${dateStr}`);
            const popupSnapshot = await getDocs(popupRef);

            if (popupSnapshot.empty) {
                console.log(`No orders found for ${dateStr}`);
                continue;
            }

            // Copy each order to new event
            for (const orderDoc of popupSnapshot.docs) {
                const orderData = orderDoc.data();

                // Create new order in target event
                const newOrderRef = doc(db, `pos-orders/${selectedEvent.key}/${dateStr}`, orderDoc.id);
                await setDoc(newOrderRef, {
                    ...orderData,
                    event: selectedEvent.key, // Update event field
                    transferredFrom: 'pop-up',
                    transferredAt: new Date().toISOString()
                });

                transferredOrders.push({
                    date: dateStr,
                    orderId: orderDoc.id,
                    total: orderData.total
                });

                console.log(`Transferred order ${orderDoc.id} from ${dateStr}`);
            }
        }

        console.log(`Transfer complete! ${transferredOrders.length} orders transferred.`);
        console.log('Transferred orders:', transferredOrders);

        // Ask if user wants to delete originals
        const deleteOriginals = confirm(`Transfer complete! ${transferredOrders.length} orders transferred to ${selectedEvent.name}.\n\nDo you want to DELETE the original orders from pop-up?`);

        if (deleteOriginals) {
            for (let i = 0; i < 5; i++) {
                const date = new Date(today.getTime() - (i * 24 * 60 * 60 * 1000));
                const dateStr = getLocalDateString(date);

                const popupRef = collection(db, `pos-orders/pop-up/${dateStr}`);
                const popupSnapshot = await getDocs(popupRef);

                for (const orderDoc of popupSnapshot.docs) {
                    await deleteDoc(doc(db, `pos-orders/pop-up/${dateStr}`, orderDoc.id));
                    console.log(`Deleted original order ${orderDoc.id} from ${dateStr}`);
                }
            }
            console.log('Original orders deleted from pop-up');
        }

        alert(`Transfer complete! ${transferredOrders.length} orders moved to ${selectedEvent.name}`);

    } catch (error) {
        console.error('Transfer failed:', error);
        alert('Transfer failed. Check console for details.');
    }
};

window.archiveEvent = async function (eventId, eventName, shouldArchive) {
    const action = shouldArchive ? 'archive' : 'unarchive';
    if (!confirm(`Are you sure you want to ${action} "${eventName}"?`)) return;

    try {
        console.log(`Attempting to ${action} event:`, { eventId, eventName, shouldArchive });

        const eventRef = doc(db, 'branches', eventId);

        await updateDoc(eventRef, {
            archived: shouldArchive,
            lastModified: new Date().toISOString()
        });

        console.log(`Successfully ${action}d event in Firebase`);

        // Force complete reload with delay
        setTimeout(async () => {
            console.log('Forcing reload of events...');
            const events = await loadEventsFromFirebase();
            console.log('Events after reload:', events);
            loadEventsList();
            await loadAvailableEvents();
        }, 1000);

        alert(`Event ${action}d successfully`);
    } catch (error) {
        console.error(`Failed to ${action} event:`, error);
        alert(`Failed to ${action} event: ${error.message}`);
    }
};

// Get service type for current event
async function getCurrentEventServiceType() {
    if (currentEvent === 'pop-up') {
        return 'popup'; // Legacy data
    }

    try {
        const events = await loadEventsFromFirebase();
        const event = events.find(e => e.key === currentEvent);
        return event ? event.serviceType || 'popup' : 'popup';
    } catch (error) {
        return 'popup';
    }
}

window.manageEventMenu = function (eventId, eventName) {
    showMenuManagementModal(eventId, eventName);
};

async function showMenuManagementModal(eventId, eventName) {
    const existingModal = document.querySelector('.menu-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay menu-modal';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '700px';

    const header = document.createElement('h2');
    header.textContent = `Menu Manager - ${eventName}`;
    modal.appendChild(header);

    const content = document.createElement('div');
    content.innerHTML = `
        <div class="menu-management">
            <div class="menu-upload-section">
                <h3>Upload Custom Menu</h3>
                <div class="upload-area">
                    <input type="file" id="menuFileInput" accept=".js,.json" style="display: none;">
                    <button onclick="document.getElementById('menuFileInput').click()" class="btn-upload">
                        Choose Menu File (.js or .json)
                    </button>
                    <div id="uploadStatus" class="upload-status"></div>
                </div>
                <div class="menu-actions">
                    <button id="saveMenuBtn" class="btn-primary" disabled>Save Menu</button>
                    <button id="resetMenuBtn" class="btn-secondary">Reset to Default</button>
                    <button id="downloadTemplateBtn" class="btn-secondary">Download Template (.js)</button>
                </div>
            </div>
            <div class="menu-preview-section">
                <h3>Current Menu Preview</h3>
                <div id="menuPreview">Loading...</div>
            </div>
        </div>
    `;
    modal.appendChild(content);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => overlay.remove());
    footer.appendChild(closeBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const previewEl = content.querySelector('#menuPreview');

    // Load current menu (pass preview element so we update the correct one)
    await loadCurrentEventMenu(eventId, previewEl);

    // Setup event listeners
    setupMenuManagementListeners(eventId, previewEl);
};

async function loadCurrentEventMenu(eventId, previewEl) {
    try {
        const eventRef = doc(db, 'branches', eventId);
        const eventDoc = await getDoc(eventRef);

        const menuData = (eventDoc.exists() && eventDoc.data().customMenu)
            ? eventDoc.data().customMenu
            : getDefaultMenuData();
        displayMenuPreview(menuData, previewEl);
    } catch (error) {
        console.error('Error loading event menu:', error);
        displayMenuPreview(getDefaultMenuData(), previewEl);
    }
}

function setupMenuManagementListeners(eventId, previewEl) {
    const fileInput = document.getElementById('menuFileInput');
    const saveBtn = document.getElementById('saveMenuBtn');
    const resetBtn = document.getElementById('resetMenuBtn');
    const downloadBtn = document.getElementById('downloadTemplateBtn');
    const statusDiv = document.getElementById('uploadStatus');

    let currentMenuData = null;

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const fileName = file.name.toLowerCase();
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                let menuData;

                if (fileName.endsWith('.json')) {
                    // Handle JSON file
                    menuData = JSON.parse(e.target.result);
                } else if (fileName.endsWith('.js')) {
                    // Handle JavaScript file
                    menuData = extractMenuDataFromJS(e.target.result);
                } else {
                    throw new Error('Unsupported file type');
                }

                if (validateMenuData(menuData)) {
                    currentMenuData = menuData;
                    displayMenuPreview(menuData, previewEl);
                    saveBtn.disabled = false;
                    statusDiv.innerHTML = '<span style="color: green;">✓ Valid menu file loaded</span>';
                } else {
                    statusDiv.innerHTML = '<span style="color: red;">✗ Invalid menu format</span>';
                    saveBtn.disabled = true;
                }
            } catch (error) {
                console.error('Error parsing menu file:', error);
                statusDiv.innerHTML = '<span style="color: red;">✗ Error parsing file: ' + error.message + '</span>';
                saveBtn.disabled = true;
            }
        };
        reader.readAsText(file);
    });

    saveBtn.addEventListener('click', async () => {
        if (currentMenuData) {
            await saveCustomMenu(eventId, currentMenuData);
            statusDiv.innerHTML = '<span style="color: green;">✓ Menu saved successfully</span>';
        }
    });

    resetBtn.addEventListener('click', async () => {
        if (confirm('Reset to default menu? This will remove any custom menu.')) {
            await resetToDefaultMenu(eventId);
            displayMenuPreview(getDefaultMenuData(), previewEl);
            statusDiv.innerHTML = '<span style="color: blue;">Reset to default menu</span>';
        }
    });

    downloadBtn.addEventListener('click', () => {
        downloadMenuTemplate();
    });
}
function validateMenuData(menuData) {
    if (!menuData) {
        console.error('Menu data is null or undefined');
        return false;
    }

    if (!menuData.categories || !Array.isArray(menuData.categories)) {
        console.error('Categories missing or not an array');
        return false;
    }

    if (!menuData.items || !Array.isArray(menuData.items)) {
        console.error('Items missing or not an array');
        return false;
    }

    if (menuData.categories.length === 0) {
        console.error('No categories found');
        return false;
    }

    if (menuData.items.length === 0) {
        console.error('No items found');
        return false;
    }

    // Validate category structure
    for (const category of menuData.categories) {
        if (!category.id || !category.name) {
            console.error('Invalid category structure:', category);
            return false;
        }
    }

    // Validate item structure
    for (const item of menuData.items) {
        if (!item.categoryId || !item.name || typeof item.price !== 'number') {
            console.error('Invalid item structure:', item);
            return false;
        }
    }

    return true;
}

function displayMenuPreview(menuData, previewEl) {
    const preview = previewEl || document.getElementById('menuPreview');
    if (!preview) return;

    let html = '<div class="menu-summary">';
    html += `<p><strong>Categories:</strong> ${menuData.categories.length}</p>`;
    html += `<p><strong>Items:</strong> ${menuData.items.length}</p>`;
    html += '</div>';

    html += '<div class="categories-preview">';
    menuData.categories.forEach(category => {
        const categoryItems = menuData.items.filter(item => item.categoryId === category.id);
        html += `
            <div class="category-preview">
                <h4>${category.name} (${categoryItems.length} items)</h4>
                <ul>
                    ${categoryItems.slice(0, 3).map(item =>
            `<li>${item.name.replace(/<[^>]*>/g, '')} - ₱${item.price}</li>`
        ).join('')}
                    ${categoryItems.length > 3 ? `<li><em>...and ${categoryItems.length - 3} more</em></li>` : ''}
                </ul>
            </div>
        `;
    });
    html += '</div>';

    preview.innerHTML = html;
}

async function saveCustomMenu(eventId, menuData) {
    try {
        const eventRef = doc(db, 'branches', eventId);
        await updateDoc(eventRef, {
            customMenu: menuData,
            lastModified: new Date().toISOString()
        });

        // Reload events list to show custom menu indicator
        loadEventsList();
    } catch (error) {
        console.error('Error saving custom menu:', error);
        throw error;
    }
}

async function resetToDefaultMenu(eventId) {
    try {
        const eventRef = doc(db, 'branches', eventId);
        await updateDoc(eventRef, {
            customMenu: null,
            lastModified: new Date().toISOString()
        });

        // Reload events list
        loadEventsList();
    } catch (error) {
        console.error('Error resetting menu:', error);
        throw error;
    }
}

function downloadMenuTemplate() {
    const template = getDefaultMenuData();
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'menu-template.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function getDefaultMenuData() {
    // Import the default menu data
    return {
        categories: [
            { id: "matcha-lattes", name: "Matcha Lattes" },
            { id: "matcha-lite", name: "Matcha Lite" },
            { id: "specials", name: "Specials" },
            { id: "beyond-matcha", name: "Beyond Matcha" },
            { id: "desserts", name: "Desserts" }
        ],
        items: [
            // Add your default items here from menu-data.js
            // This should match your current menu structure
        ]
    };
}

function extractMenuDataFromJS(jsContent) {
    try {
        // Remove the export statement and extract the menuData object
        let cleanedContent = jsContent;

        // Remove import/export statements
        cleanedContent = cleanedContent.replace(/export\s+const\s+menuData\s*=\s*/, 'const menuData = ');
        cleanedContent = cleanedContent.replace(/export\s*{\s*menuData\s*}.*?;?\s*$/m, '');

        // Add return statement at the end
        cleanedContent += '\nreturn menuData;';

        // Create a function and execute it to get the menu data
        const func = new Function(cleanedContent);
        const menuData = func();

        return menuData;
    } catch (error) {
        console.error('Error extracting menu data from JS:', error);
        throw new Error('Invalid JavaScript menu file format');
    }
}