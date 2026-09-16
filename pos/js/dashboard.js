import { db, collection, doc, getDocs, getDoc, query, orderBy, limit, addDoc, updateDoc, deleteDoc, setDoc } from './firebase-setup.js';
import { countCupsInItems } from './cup-count.js';

let currentEvent = 'pop-up';
let selectedDate = new Date();
let allEventsData = {};
let currentChartType = 'daily';
let salesChart = null;
/** 'day' | 'range' */
let dataScope = 'day';
/** For package service, order.total = cups (not pesos). Used by payment/orders/modal/chart. */
let currentEventIsPackage = false;
/** Cached range data for chart when scope is range */
let lastRangeChartData = null;
/** Last successfully loaded day/range payload, reused by CSV exports. */
let lastLoadedDashboardData = null;
/** eventKey -> customMenu (or null). Cup count reads countsAsCup from this menu. */
let eventMenuByKey = {};
/** Peak Hours chart: show only 9 AM through 12 MN (operating hours). */
const PEAK_HOURS_START = 9;  // 9 AM
const PEAK_HOURS_END = 0;    // 12 MN (hour 0)
let lastRangeStart = '';
let lastRangeEnd = '';
/** Invalidates in-flight loads when the user changes scope/dates/event quickly (prevents stale UI). */
let dashboardLoadGeneration = 0;
/** Per-event date bounds from Firebase: { mode, latest?, first?, last? } */
const eventDateBoundsCache = new Map();
/** Max days to scan when finding an event's first/last order date. */
const EVENT_DATE_SCAN_MAX_DAYS = 365;
const EVENT_DATE_SCAN_CHUNK = 25;

const MANUAL_SALES_STORAGE_KEY = 'posDashboardManualSales';

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getManualSalesMap() {
    try {
        return JSON.parse(localStorage.getItem(MANUAL_SALES_STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

/** Optional per-day total override (pesos or cups). `undefined` = use POS sum. */
function getSalesOverride(eventKey, dateStr) {
    const map = getManualSalesMap();
    const n = map[eventKey]?.[dateStr];
    if (typeof n !== 'number' || Number.isNaN(n) || n < 0) return undefined;
    return n;
}

function setSalesOverride(eventKey, dateStr, rawValue) {
    const map = getManualSalesMap();
    if (!map[eventKey]) map[eventKey] = {};
    const num = typeof rawValue === 'string' ? parseFloat(rawValue.trim()) : Number(rawValue);
    if (rawValue === '' || rawValue == null || Number.isNaN(num) || num < 0) {
        delete map[eventKey][dateStr];
        if (Object.keys(map[eventKey]).length === 0) delete map[eventKey];
    } else {
        map[eventKey][dateStr] = num;
    }
    localStorage.setItem(MANUAL_SALES_STORAGE_KEY, JSON.stringify(map));
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    await loadAvailableEvents();
    setupEventListeners();
    await applyEventDateDefaults(currentEvent);
    await loadDashboardData();
});

function setupEventListeners() {
    const eventSelector = document.getElementById('eventSelector');
    const dateSelector = document.getElementById('dateSelector');
    const rangeStartDate = document.getElementById('rangeStartDate');
    const rangeEndDate = document.getElementById('rangeEndDate');
    const refreshBtn = document.getElementById('refreshBtn');

    if (dateSelector) dateSelector.value = getLocalDateString(selectedDate);
    setDefaultRangeDates();
    toggleRangeControls();

    if (eventSelector) eventSelector.addEventListener('change', async (e) => {
        currentEvent = e.target.value;
        await applyEventDateDefaults(currentEvent);
        await loadDashboardData();
    });

    if (dateSelector) dateSelector.addEventListener('change', async (e) => {
        selectedDate = new Date(e.target.value + 'T00:00:00');
        await loadDashboardData();
    });

    if (rangeStartDate) rangeStartDate.addEventListener('change', async () => {
        if (dataScope === 'range') await loadDashboardData();
    });

    if (rangeEndDate) rangeEndDate.addEventListener('change', async () => {
        if (dataScope === 'range') await loadDashboardData();
    });

    if (refreshBtn) refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Loading...';
        eventDateBoundsCache.delete(currentEvent);
        await applyEventDateDefaults(currentEvent);
        await loadDashboardData();
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh Data';
    });

    const manageEventsBtn = document.getElementById('manageEventsBtn');
    if (manageEventsBtn) manageEventsBtn.addEventListener('click', showEventManagementModal);

    setupSalesReportDownloadListener();
    setupHistoryExportListener();
    setupCsvExportListeners();
    setupSalesHistoryEditListener();

    // Data scope toggle: Day vs Range
    document.querySelectorAll('.scope-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const scope = e.target.dataset.scope;
            if (scope === dataScope) return;
            dataScope = scope;
            document.querySelectorAll('.scope-toggle-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.scope === dataScope);
            });
            toggleRangeControls();
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

            if (dataScope === 'range') {
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

function eventOptionLabel(event, archived = false) {
    const kind = event.serviceType === 'package' ? 'Package' : 'Popup';
    const suffix = archived ? ' (Archived)' : '';
    return `[${kind}] ${event.name}${suffix}`;
}

function populateEventSelector(activeEvents, archivedEvents) {
    const eventSelector = document.getElementById('eventSelector');
    if (!eventSelector) return;

    eventSelector.innerHTML = '';

    activeEvents.forEach((event) => {
        const option = document.createElement('option');
        option.value = event.key;
        option.textContent = eventOptionLabel(event);
        option.title = option.textContent;
        eventSelector.appendChild(option);
    });

    const separator = document.createElement('option');
    separator.disabled = true;
    separator.textContent = '--- Archived ---';
    eventSelector.appendChild(separator);

    archivedEvents.forEach((event) => {
        const option = document.createElement('option');
        option.value = event.key;
        option.textContent = eventOptionLabel(event, true);
        option.title = option.textContent;
        option.style.color = '#999';
        option.style.fontStyle = 'italic';
        eventSelector.appendChild(option);
    });

    const legacyOption = document.createElement('option');
    legacyOption.value = 'pop-up';
    legacyOption.textContent = 'Legacy Data (Archived)';
    legacyOption.style.color = '#999';
    legacyOption.style.fontStyle = 'italic';
    eventSelector.appendChild(legacyOption);
}

function applyEventSelectorDefault(activeEvents, archivedEvents) {
    const eventSelector = document.getElementById('eventSelector');
    if (!eventSelector) return;

    if (activeEvents.length > 0) {
        const currentEventArchived = archivedEvents.some((event) => event.key === currentEvent);
        if (currentEventArchived || currentEvent === 'pop-up') {
            currentEvent = activeEvents[0].key;
        }
        eventSelector.value = currentEvent;
    } else if (archivedEvents.length > 0) {
        currentEvent = archivedEvents[0].key;
        eventSelector.value = currentEvent;
        console.warn('Only archived events available');
    } else {
        currentEvent = 'pop-up';
        eventSelector.value = 'pop-up';
    }
}

async function loadAvailableEvents() {
    try {
        const firebaseEvents = await loadEventsFromFirebase();
        const activeEvents = sortEventsByRecency(firebaseEvents.filter((event) => !event.archived));
        const archivedEvents = sortEventsByRecency(firebaseEvents.filter((event) => event.archived));

        populateEventSelector(activeEvents, archivedEvents);
        applyEventSelectorDefault(activeEvents, archivedEvents);
    } catch (error) {
        console.error('Error loading events:', error);
    }
}

async function loadDashboardData() {
    const gen = ++dashboardLoadGeneration;
    try {
        showLoadingState();

        if (dataScope === 'day') {
            updateDailySalesHistoryTitle('day');
            setScopeSectionTitles('day');
            setChartSectionForScope('daily');
            const dayData = await loadSelectedDayData(currentEvent);
            if (gen !== dashboardLoadGeneration) return;
            currentEventIsPackage = (await getCurrentEventServiceType()) === 'package';
            if (gen !== dashboardLoadGeneration) return;
            updateStatsFromData(dayData, 'day');
            updatePaymentBreakdown(dayData);
            updateRecentOrders(dayData);
            updateCustomizationBreakdowns(dayData);
            updateSalesByItemReport(dayData);
            await updateEODSummaryDisplay();
            if (gen !== dashboardLoadGeneration) return;
            lastLoadedDashboardData = { ...dayData, _exportKey: getCsvExportCacheKey() };

            // Daily = selected day ONLY. Chart = hourly for this day (one fetch). No 60-day chart.
            setTimeout(() => {
                updateHourlySalesChart();
            }, 0);

            // Day view: hide 1-row history table.
            hideDayViewHistoryTable();
        } else {
            updateDailySalesHistoryTitle('range');
            setScopeSectionTitles('range');
            setChartSectionForScope('range');
            const { start: startStr, end: endStr } = getSelectedRange();
            const rangeData = await loadRangeData(currentEvent, startStr, endStr);
            if (gen !== dashboardLoadGeneration) return;
            updateStatsFromData(rangeData, 'range');
            updatePaymentBreakdown(rangeData);
            updateRecentOrders(rangeData);
            updateCustomizationBreakdowns(rangeData);
            updateSalesByItemReport(rangeData);
            const eodSection = document.getElementById('eodDashboardSection');
            if (eodSection) eodSection.style.display = 'none';

            lastRangeChartData = { dailySales: rangeData.dailySales || {} };
            lastRangeStart = startStr;
            lastRangeEnd = endStr;
            lastLoadedDashboardData = { ...rangeData, _exportKey: getCsvExportCacheKey() };
            setTimeout(() => {
                updateSalesChartFromRange(lastRangeChartData, startStr, endStr);
            }, 100);

            const eventsGrid = document.getElementById('eventsGrid');
            if (eventsGrid) eventsGrid.style.display = '';
            await renderRangeSalesHistory(startStr, endStr, rangeData);
            if (gen !== dashboardLoadGeneration) return;
        }

    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showErrorState();
    }
}

function emptyCustomizationMaps() {
    return {
        milk: {},
        strength: {},
        matchaOption: {},
        sugar: {},
        discounts: {}
    };
}

function accumulateItemCustomizations(target, item) {
    const qty = item.quantity || 1;
    const c = item.customizations || {};
    if (c.milk) {
        const key = String(c.milk).toLowerCase();
        target.milk[key] = (target.milk[key] || 0) + qty;
    }
    if (c.strengthLevel != null && c.strengthLevel !== '') {
        const key = String(c.strengthLevel).replace(/^Level\s+/i, '');
        target.strength[key] = (target.strength[key] || 0) + qty;
    } else if (c.matchaStrength != null && c.matchaStrength !== '') {
        const key = String(c.matchaStrength).replace(/^Level\s+/i, '');
        target.strength[key] = (target.strength[key] || 0) + qty;
    }
    if (c.matchaOption) {
        const key = String(c.matchaOption).toLowerCase();
        target.matchaOption[key] = (target.matchaOption[key] || 0) + qty;
    }
    if (c.sweetness) {
        const key = String(c.sweetness);
        target.sugar[key] = (target.sugar[key] || 0) + qty;
    }
    if (c.discount && c.discount !== 'none') {
        const key = String(c.discount).toLowerCase();
        target.discounts[key] = (target.discounts[key] || 0) + qty;
    }
}

function getCurrentEventMenu() {
    return eventMenuByKey[currentEvent] || getDefaultMenuData();
}

async function loadSelectedDayData(eventName) {
    try {
        const selectedDateStr = getLocalDateString(selectedDate);

        const dayRef = collection(db, `pos-orders/${eventName}/${selectedDateStr}`);
        const daySnapshot = await getDocs(dayRef);

        const customizations = emptyCustomizationMaps();
        const dayData = {
            orders: [],
            sales: 0,
            cups: 0,
            paymentMethods: { cash: 0, gcash: 0, card: 0 },
            topItems: {},
            customizations
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

            // Top items, cups, and customizations
            if (orderData.items) {
                orderData.items.forEach(item => {
                    const itemName = item.name || 'Unknown Item';
                    if (!dayData.topItems[itemName]) {
                        dayData.topItems[itemName] = { count: 0, total: 0 };
                    }
                    dayData.topItems[itemName].count += item.quantity || 1;
                    dayData.topItems[itemName].total += (item.price || 0) * (item.quantity || 1);
                    accumulateItemCustomizations(customizations, item);
                });
                dayData.cups += countCupsInItems(orderData.items, getCurrentEventMenu());
            }
        });

        // Sort orders by timestamp (newest first)
        dayData.orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return dayData;
    } catch (error) {
        console.error(`Error loading selected day data:`, error);
        return {
            orders: [], sales: 0, paymentMethods: { cash: 0, gcash: 0, card: 0 },
            topItems: {}, customizations: emptyCustomizationMaps()
        };
    }
}

async function loadRangeData(eventName, startStr, endStr) {
    try {
        const customizations = emptyCustomizationMaps();
        const rangeData = {
            orders: [],
            sales: 0,
            cups: 0,
            paymentMethods: { cash: 0, gcash: 0, card: 0 },
            topItems: {},
            customizations,
            dailySales: {},
            orderDailySales: {},
            liveOrderDays: new Set()
        };

        const start = new Date(startStr + 'T00:00:00');
        const end = new Date(endStr + 'T00:00:00');
        const dateStrs = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            dateStrs.push(getLocalDateString(d));
        }

        const liveOrderDays = new Set();

        const snapshotsByDate = await Promise.all(
            dateStrs.map(async (dateStr) => {
                try {
                    const dayRef = collection(db, `pos-orders/${eventName}/${dateStr}`);
                    const daySnapshot = await getDocs(dayRef);
                    return { dateStr, daySnapshot };
                } catch (dayError) {
                    return { dateStr, daySnapshot: null };
                }
            })
        );

        for (const { dateStr, daySnapshot } of snapshotsByDate) {
            let dayTotal = 0;
            if (!daySnapshot) {
                rangeData.dailySales[dateStr] = 0;
                continue;
            }

            daySnapshot.forEach(orderDoc => {
                const orderData = orderDoc.data();
                if (orderData.status === 'deleted') return;

                liveOrderDays.add(dateStr);
                const order = { ...orderData, firebaseId: orderDoc.id, date: dateStr };
                rangeData.orders.push(order);
                const total = orderData.total || 0;
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
                        accumulateItemCustomizations(customizations, item);
                    });
                    rangeData.cups += countCupsInItems(orderData.items, getCurrentEventMenu());
                }
            });

            rangeData.dailySales[dateStr] = dayTotal;
        }

        rangeData.orderDailySales = { ...rangeData.dailySales };
        rangeData.liveOrderDays = liveOrderDays;

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = getLocalDateString(d);
            const orderAmt = rangeData.orderDailySales[dateStr] ?? 0;
            const override = getSalesOverride(eventName, dateStr);
            rangeData.dailySales[dateStr] = override !== undefined ? override : orderAmt;
        }

        rangeData.sales = Object.values(rangeData.dailySales).reduce((a, b) => a + (Number(b) || 0), 0);

        rangeData.orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return rangeData;
    } catch (error) {
        console.error('Error loading range data:', error);
        return {
            orders: [], sales: 0, cups: 0, paymentMethods: { cash: 0, gcash: 0, card: 0 },
            topItems: {}, customizations: emptyCustomizationMaps(),
            dailySales: {}, orderDailySales: {}, liveOrderDays: new Set()
        };
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
            paymentMethods: { cash: 0, gcash: 0, card: 0 },
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
            paymentMethods: { cash: 0, gcash: 0, card: 0 },
            topItems: {}
        };
    }
}

async function updateStatsFromData(data, scope) {
    const serviceType = await getCurrentEventServiceType();
    const isPackageMode = serviceType === 'package';
    const isDay = scope === 'day';

    const salesLabel = document.getElementById('salesStatLabel');
    if (salesLabel) {
        salesLabel.textContent = isDay
            ? (isPackageMode ? 'Selected Day Cups' : 'Selected Day Sales')
            : (isPackageMode ? 'Period Cups' : 'Period Sales');
    }

    const salesEl = document.getElementById('todaySales');
    const ordersEl = document.getElementById('todayOrders');
    const cupsEl = document.getElementById('todayCups');
    const cupsLabel = document.getElementById('cupsStatLabel');
    const cupsNote = document.getElementById('todayCupsNote');
    const profitCard = document.getElementById('profitStatCard');

    let salesAmt = data.sales;
    const orderCount = (data.orders || []).length;

    if (isPackageMode) {
        let totalCups;
        if (!isDay && data.dailySales) {
            totalCups = Object.values(data.dailySales).reduce((a, b) => a + (Number(b) || 0), 0);
        } else {
            const dateStrDay = getLocalDateString(selectedDate);
            const o = getSalesOverride(currentEvent, dateStrDay);
            totalCups = data.orders.reduce((total, order) => total + (order.total || 0), 0);
            if (o !== undefined) totalCups = o;
        }
        salesAmt = totalCups;
        if (salesEl) salesEl.textContent = `${totalCups} cups`;
        if (cupsLabel) cupsLabel.textContent = 'Avg cups / order';
        const avg = orderCount > 0 ? totalCups / orderCount : 0;
        if (cupsEl) cupsEl.textContent = orderCount ? avg.toFixed(1) : '0';
        if (cupsNote) cupsNote.textContent = orderCount ? `${totalCups} cups across ${orderCount} orders` : '';
        if (profitCard) profitCard.style.display = 'none';
    } else {
        if (isDay) {
            const o = getSalesOverride(currentEvent, getLocalDateString(selectedDate));
            if (o !== undefined) salesAmt = o;
        }
        if (salesEl) salesEl.textContent = formatCurrency(salesAmt);
        if (cupsLabel) cupsLabel.textContent = 'Cups Sold';
        if (cupsEl) cupsEl.textContent = (data.cups || 0).toString();
        if (cupsNote) cupsNote.textContent = '';
        if (profitCard) profitCard.style.display = '';
    }
    if (ordersEl) ordersEl.textContent = orderCount.toString();

    sessionStorage.setItem('currentDayOrders', JSON.stringify(data.orders));

    await updateCostProfitDisplay(data, salesAmt, isPackageMode);
}

function emptyCostSettings() {
    return {
        itemCosts: {},
        oatUpgradeCost: 0,
        natsuUpgradeCost: 0,
        strengthLevelCosts: { '1': 0, '2': 0, '3': 0 }
    };
}

function normalizeCostSettings(raw) {
    const base = emptyCostSettings();
    if (!raw || typeof raw !== 'object') return base;
    if (raw.itemCosts && typeof raw.itemCosts === 'object') {
        for (const [name, val] of Object.entries(raw.itemCosts)) {
            const n = Number(val);
            if (Number.isFinite(n) && n >= 0) base.itemCosts[name] = n;
        }
    }
    const oat = Number(raw.oatUpgradeCost);
    if (Number.isFinite(oat) && oat >= 0) base.oatUpgradeCost = oat;
    const natsu = Number(raw.natsuUpgradeCost);
    if (Number.isFinite(natsu) && natsu >= 0) base.natsuUpgradeCost = natsu;
    if (raw.strengthLevelCosts && typeof raw.strengthLevelCosts === 'object') {
        for (const level of ['1', '2', '3']) {
            const n = Number(raw.strengthLevelCosts[level]);
            if (Number.isFinite(n) && n >= 0) base.strengthLevelCosts[level] = n;
        }
    }
    return base;
}

function stripItemNameHtml(name) {
    return String(name || '').replace(/<[^>]*>/g, '').trim();
}

function lineItemUnitCost(item, costSettings) {
    const name = stripItemNameHtml(item?.name);
    let cost = Number(costSettings.itemCosts[name]) || 0;
    const c = item?.customizations || {};
    if (String(c.milk || '').toLowerCase() === 'oat') {
        cost += Number(costSettings.oatUpgradeCost) || 0;
    }
    if (String(c.matchaOption || '').toLowerCase() === 'natsu') {
        cost += Number(costSettings.natsuUpgradeCost) || 0;
    }
    let level = c.strengthLevel != null && c.strengthLevel !== ''
        ? String(c.strengthLevel).replace(/^Level\s+/i, '')
        : (c.matchaStrength != null && c.matchaStrength !== ''
            ? String(c.matchaStrength).replace(/^Level\s+/i, '')
            : '');
    if (level && costSettings.strengthLevelCosts[level] != null) {
        cost += Number(costSettings.strengthLevelCosts[level]) || 0;
    }
    return cost;
}

function computeOrdersCost(orders, costSettings) {
    let total = 0;
    let pricedUnits = 0;
    let unpricedUnits = 0;
    for (const order of orders || []) {
        for (const item of order.items || []) {
            const qty = item.quantity || 1;
            const name = stripItemNameHtml(item.name);
            const known = Object.prototype.hasOwnProperty.call(costSettings.itemCosts, name);
            if (known) {
                total += lineItemUnitCost(item, costSettings) * qty;
                pricedUnits += qty;
            } else {
                unpricedUnits += qty;
            }
        }
    }
    return { total, pricedUnits, unpricedUnits };
}

async function loadCostSettingsForEventKey(eventKey) {
    try {
        const events = await loadEventsFromFirebase();
        const match = events.find((e) => e.key === eventKey);
        if (!match) return emptyCostSettings();
        const snap = await getDoc(doc(db, 'branches', match.id));
        if (!snap.exists()) return emptyCostSettings();
        const data = snap.data();
        const fromSettings = normalizeCostSettings(data.costSettings);
        // Fallback: item.cost on customMenu
        const menu = data.customMenu;
        if (menu?.items && Array.isArray(menu.items)) {
            for (const item of menu.items) {
                const name = stripItemNameHtml(item.name);
                if (!name) continue;
                if (!Object.prototype.hasOwnProperty.call(fromSettings.itemCosts, name)
                    && typeof item.cost === 'number' && item.cost >= 0) {
                    fromSettings.itemCosts[name] = item.cost;
                }
            }
            if (typeof menu.oatUpgradeCost === 'number' && !data.costSettings?.oatUpgradeCost) {
                fromSettings.oatUpgradeCost = menu.oatUpgradeCost;
            }
            if (typeof menu.natsuUpgradeCost === 'number' && !data.costSettings?.natsuUpgradeCost) {
                fromSettings.natsuUpgradeCost = menu.natsuUpgradeCost;
            }
            if (menu.strengthLevelCosts && !data.costSettings?.strengthLevelCosts) {
                for (const level of ['1', '2', '3']) {
                    const n = Number(menu.strengthLevelCosts[level]);
                    if (Number.isFinite(n) && n >= 0) fromSettings.strengthLevelCosts[level] = n;
                }
            }
        }
        return fromSettings;
    } catch (err) {
        console.error('Error loading cost settings:', err);
        return emptyCostSettings();
    }
}

async function updateCostProfitDisplay(data, salesAmt, isPackageMode) {
    const profitEl = document.getElementById('estProfit');
    const profitNote = document.getElementById('estProfitNote');
    const profitCard = document.getElementById('profitStatCard');

    if (isPackageMode) {
        if (profitCard) profitCard.style.display = 'none';
        if (profitEl) profitEl.textContent = '—';
        if (profitNote) profitNote.textContent = '';
        return;
    }

    if (profitCard) profitCard.style.display = '';

    const costSettings = await loadCostSettingsForEventKey(currentEvent);
    const hasAnyDrinkCost = Object.keys(costSettings.itemCosts).length > 0;
    if (!hasAnyDrinkCost) {
        if (profitEl) profitEl.textContent = '—';
        if (profitNote) profitNote.textContent = 'Set costs in Manage Events → Costs';
        return;
    }

    const { total, unpricedUnits } = computeOrdersCost(data.orders || [], costSettings);
    const sales = Number(salesAmt) || 0;
    const profit = sales - total;
    if (profitEl) {
        profitEl.textContent = formatCurrency(profit);
        profitEl.classList.toggle('stat-value-negative', profit < 0);
    }
    if (profitNote) {
        const margin = sales > 0 ? Math.round((profit / sales) * 1000) / 10 : 0;
        const missing = unpricedUnits > 0 ? ` · ${unpricedUnits} missing cost` : '';
        profitNote.textContent = sales > 0 ? `${margin}% margin${missing}` : '';
    }
}

function normalizeEodRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const expenses = Number(raw.expenses) || 0;
    const cash = Number(raw.cash) || 0;
    const gcash = Number(raw.gcash) || 0;
    const card = Number(raw.card) || 0;
    const totalSales = raw.totalSales != null ? Number(raw.totalSales) : (cash + gcash + card);
    const expectedCash = raw.calculatedCashLeft != null
        ? Number(raw.calculatedCashLeft)
        : (raw.expectedCash != null ? Number(raw.expectedCash) : cash - expenses);
    const actualCash = raw.actualCashLeft != null
        ? Number(raw.actualCashLeft)
        : (raw.actualCash != null ? Number(raw.actualCash) : NaN);
    const variance = raw.cashVariance != null
        ? Number(raw.cashVariance)
        : (raw.variance != null
            ? Number(raw.variance)
            : (Number.isFinite(actualCash) && Number.isFinite(expectedCash) ? actualCash - expectedCash : NaN));
    return {
        cash,
        gcash,
        card,
        totalSales,
        expenses,
        expectedCash,
        actualCash,
        variance,
        savedAt: raw.timestamp?.toDate?.() || raw.savedAt || null,
        source: raw.source || 'pos'
    };
}

async function updateEODSummaryDisplay() {
    const dateStr = getLocalDateString(selectedDate);
    const eodSection = document.getElementById('eodDashboardSection');
    const eodContent = document.getElementById('eodContent');
    if (!eodSection || !eodContent) return;

    eodSection.style.display = 'block';
    eodContent.innerHTML = '<div class="loading">Loading end of day summary...</div>';

    let eodSummary = null;
    try {
        const snap = await getDoc(doc(db, 'event-sales', currentEvent, 'daily', dateStr));
        if (snap.exists()) eodSummary = normalizeEodRecord(snap.data());
    } catch (err) {
        console.error('Error loading event-sales EOD:', err);
    }

    if (eodSummary) {
        const varianceClass = !Number.isFinite(eodSummary.variance)
            ? ''
            : (eodSummary.variance >= 0 ? 'positive' : 'negative');
        const varianceText = !Number.isFinite(eodSummary.variance)
            ? '—'
            : `${eodSummary.variance >= 0 ? '+' : ''}₱${formatCurrency(Math.abs(eodSummary.variance)).replace('₱', '')}`;
        const actualText = Number.isFinite(eodSummary.actualCash)
            ? `₱${formatCurrency(eodSummary.actualCash).replace('₱', '')}`
            : '—';
        const savedLabel = eodSummary.savedAt
            ? `Saved: ${new Date(eodSummary.savedAt).toLocaleString()}`
            : 'From POS sales submission';

        eodContent.innerHTML = `
            <div class="eod-dashboard-groups">
                <div class="eod-group">
                    <div class="eod-group-title">Sales Breakdown</div>
                    <div class="eod-dashboard-grid">
                        <div class="eod-dashboard-item">
                            <div class="eod-dashboard-label">Cash</div>
                            <div class="eod-dashboard-value">₱${formatCurrency(eodSummary.cash).replace('₱', '')}</div>
                        </div>
                        <div class="eod-dashboard-item">
                            <div class="eod-dashboard-label">GCash</div>
                            <div class="eod-dashboard-value">₱${formatCurrency(eodSummary.gcash).replace('₱', '')}</div>
                        </div>
                        <div class="eod-dashboard-item">
                            <div class="eod-dashboard-label">Card</div>
                            <div class="eod-dashboard-value">₱${formatCurrency(eodSummary.card).replace('₱', '')}</div>
                        </div>
                        <div class="eod-dashboard-item">
                            <div class="eod-dashboard-label">Total Sales</div>
                            <div class="eod-dashboard-value">₱${formatCurrency(eodSummary.totalSales).replace('₱', '')}</div>
                        </div>
                    </div>
                </div>
                <div class="eod-group">
                    <div class="eod-group-title">Cash Expenses</div>
                    <div class="eod-dashboard-grid">
                        <div class="eod-dashboard-item">
                            <div class="eod-dashboard-label">Expenses</div>
                            <div class="eod-dashboard-value negative">₱${formatCurrency(eodSummary.expenses).replace('₱', '')}</div>
                        </div>
                    </div>
                </div>
                <div class="eod-group">
                    <div class="eod-group-title">Cash Left</div>
                    <div class="eod-dashboard-grid">
                        <div class="eod-dashboard-item">
                            <div class="eod-dashboard-label">Expected Cash</div>
                            <div class="eod-dashboard-value">₱${formatCurrency(eodSummary.expectedCash).replace('₱', '')}</div>
                        </div>
                        <div class="eod-dashboard-item">
                            <div class="eod-dashboard-label">Actual Cash</div>
                            <div class="eod-dashboard-value">${actualText}</div>
                        </div>
                        <div class="eod-dashboard-item">
                            <div class="eod-dashboard-label">Variance</div>
                            <div class="eod-dashboard-value ${varianceClass}">${varianceText}</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="eod-dashboard-timestamp">${savedLabel}</div>
        `;
    } else {
        eodContent.innerHTML = `
            <div style="color: #666; font-style: italic; text-align: center; padding: 20px;">
                No POS sales submission for this day
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
            <span class="payment-method">Card</span>
            <span class="payment-amount">${fmt(dayData.paymentMethods.card)}</span>
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
    content.className = 'order-details-content';

    const meta = document.createElement('div');
    meta.className = 'order-meta';
    meta.innerHTML = `
        <p><strong>Customer:</strong> ${order.customerName || 'No name'}</p>
        <p><strong>Time:</strong> ${formatDateTime(order.timestamp)}</p>
        <p><strong>Payment:</strong> ${order.paymentMethod || 'Cash'}</p>
    `;
    content.appendChild(meta);

    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'order-items';
    const itemsHeading = document.createElement('h3');
    itemsHeading.textContent = 'Items Ordered:';
    itemsWrap.appendChild(itemsHeading);

    const itemsList = document.createElement('div');
    itemsList.className = 'items-list';

    if (order.items && order.items.length) {
        order.items.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'item-row';

            const details = document.createElement('div');
            details.className = 'item-details';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'item-name';
            nameSpan.textContent = item.name || 'Unknown Item';
            details.appendChild(nameSpan);

            const qtySpan = document.createElement('span');
            qtySpan.className = 'item-quantity';
            qtySpan.textContent = `x${item.quantity || 1}`;
            details.appendChild(qtySpan);

            const discount = item.customizations?.discount;
            if (discount && discount !== 'none') {
                const discountLine = document.createElement('div');
                discountLine.className = 'item-discount-line';
                const label = document.createElement('span');
                label.className = 'item-discount-label';
                label.textContent = String(discount).toUpperCase();
                discountLine.appendChild(label);

                const hasId = Boolean(item.customizations?.idPhoto || item.customizations?.idDetails);
                if (hasId) {
                    const viewBtn = document.createElement('button');
                    viewBtn.type = 'button';
                    viewBtn.className = 'view-id-btn';
                    viewBtn.textContent = 'View ID';
                    viewBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showDashboardSavedDiscountId(item);
                    });
                    discountLine.appendChild(viewBtn);
                }
                details.appendChild(discountLine);
            }

            const price = document.createElement('div');
            price.className = 'item-price';
            price.textContent = itemDisplay(item);

            row.appendChild(details);
            row.appendChild(price);
            itemsList.appendChild(row);
        });
    } else {
        itemsList.innerHTML = '<p>No items found</p>';
    }

    itemsWrap.appendChild(itemsList);
    content.appendChild(itemsWrap);

    const totalEl = document.createElement('div');
    totalEl.className = 'order-total';
    totalEl.innerHTML = `<strong>Total: ${totalDisplay}</strong>`;
    content.appendChild(totalEl);

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

const DASHBOARD_SENIOR_ID_FIELDS = [
    { key: 'fullName', label: 'Name' },
    { key: 'idNumber', label: 'ID number' },
    { key: 'dateOfBirth', label: 'Date of birth' },
    { key: 'sex', label: 'Sex' },
    { key: 'address', label: 'Address' },
    { key: 'issuingLgu', label: 'City / LGU' },
    { key: 'dateIssued', label: 'Date issued' }
];

const DASHBOARD_PWD_ID_FIELDS = [
    { key: 'fullName', label: 'Name' },
    { key: 'idNumber', label: 'ID number' },
    { key: 'dateOfBirth', label: 'Date of birth' },
    { key: 'sex', label: 'Sex' },
    { key: 'disabilityType', label: 'Disability' },
    { key: 'address', label: 'Address' },
    { key: 'issuingLgu', label: 'City / LGU' },
    { key: 'dateIssued', label: 'Date issued' }
];

function showDashboardSavedDiscountId(item) {
    const existing = document.querySelector('.id-review-overlay');
    if (existing) existing.remove();

    const customizations = item?.customizations || {};
    const photo = customizations.idPhoto || null;
    const details = customizations.idDetails || null;
    const idType = customizations.discount === 'pwd' || details?.idType === 'pwd' ? 'pwd' : 'senior';
    const fields = idType === 'pwd' ? DASHBOARD_PWD_ID_FIELDS : DASHBOARD_SENIOR_ID_FIELDS;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay id-review-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal id-review-modal';

    const title = document.createElement('h2');
    title.textContent = idType === 'pwd' ? 'PWD ID' : 'Senior ID';
    modal.appendChild(title);

    if (photo) {
        const imgWrap = document.createElement('div');
        imgWrap.className = 'id-review-photo';
        const img = document.createElement('img');
        img.src = photo;
        img.alt = 'Saved ID photo';
        imgWrap.appendChild(img);
        modal.appendChild(imgWrap);
    }

    const list = document.createElement('dl');
    list.className = 'id-review-details';
    fields.forEach(({ key, label }) => {
        const row = document.createElement('div');
        row.className = 'id-review-row';
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = (details && details[key]) ? details[key] : '—';
        row.appendChild(dt);
        row.appendChild(dd);
        list.appendChild(row);
    });
    modal.appendChild(list);

    if (!details && !photo) {
        const empty = document.createElement('p');
        empty.textContent = 'No ID photo or details saved for this item.';
        modal.appendChild(empty);
    }

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => overlay.remove());
    footer.appendChild(closeBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
}

function collectDiscountOrders(discountType) {
    const type = String(discountType || '').toLowerCase();
    const orders = lastLoadedDashboardData?.orders || [];
    return orders
        .map((order) => {
            const items = (order.items || []).filter((item) =>
                String(item.customizations?.discount || '').toLowerCase() === type
            );
            return items.length ? { order, items } : null;
        })
        .filter(Boolean);
}

function discountOrderIdItem(items) {
    return items.find((item) => item.customizations?.idPhoto || item.customizations?.idDetails) || null;
}

function showDiscountOrdersModal(discountType) {
    const existing = document.querySelector('.discount-orders-overlay');
    if (existing) existing.remove();

    const type = String(discountType || '').toLowerCase();
    const label = formatCustomizationLabel('discounts', type);
    const rows = collectDiscountOrders(type);
    const isPkg = currentEventIsPackage;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay discount-orders-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal discount-orders-modal';

    const title = document.createElement('h2');
    title.textContent = `${label} orders`;
    modal.appendChild(title);

    const summary = document.createElement('p');
    summary.className = 'discount-orders-summary';
    const itemCount = rows.reduce((sum, row) => sum + row.items.reduce((s, item) => s + (item.quantity || 1), 0), 0);
    summary.textContent = rows.length
        ? `${itemCount} ${label} item${itemCount === 1 ? '' : 's'} across ${rows.length} order${rows.length === 1 ? '' : 's'}`
        : `No ${label} orders in this period.`;
    modal.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'discount-order-cards';

    rows.forEach(({ order, items }) => {
        const idItem = discountOrderIdItem(items);
        const photo = idItem?.customizations?.idPhoto || null;
        const idName = idItem?.customizations?.idDetails?.fullName || '';
        const idNumber = idItem?.customizations?.idDetails?.idNumber || '';
        const totalDisplay = isPkg
            ? `${order.total || 0} cups`
            : formatCurrency(order.total || 0);

        const card = document.createElement('article');
        card.className = 'discount-order-card';

        const thumbBtn = document.createElement('button');
        thumbBtn.type = 'button';
        thumbBtn.className = 'discount-id-thumb';
        if (photo) {
            const img = document.createElement('img');
            img.src = photo;
            img.alt = `${label} ID`;
            thumbBtn.appendChild(img);
            thumbBtn.title = 'View ID';
            thumbBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showDashboardSavedDiscountId(idItem);
            });
        } else if (idItem) {
            thumbBtn.classList.add('is-placeholder');
            thumbBtn.textContent = 'View ID';
            thumbBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showDashboardSavedDiscountId(idItem);
            });
        } else {
            thumbBtn.classList.add('is-placeholder', 'is-empty');
            thumbBtn.disabled = true;
            thumbBtn.textContent = 'No ID';
        }
        card.appendChild(thumbBtn);

        const body = document.createElement('div');
        body.className = 'discount-order-body';

        const heading = document.createElement('div');
        heading.className = 'discount-order-heading';
        const orderBtn = document.createElement('button');
        orderBtn.type = 'button';
        orderBtn.className = 'discount-order-link';
        orderBtn.textContent = `ORDER-${order.id || order.firebaseId || ''}`;
        orderBtn.addEventListener('click', () => {
            window.showOrderDetails(order.firebaseId, order.id);
        });
        heading.appendChild(orderBtn);

        const amount = document.createElement('span');
        amount.className = 'discount-order-amount';
        amount.textContent = totalDisplay;
        heading.appendChild(amount);
        body.appendChild(heading);

        const meta = document.createElement('p');
        meta.className = 'discount-order-meta';
        meta.textContent = [
            order.customerName || 'No name',
            formatDateTime(order.timestamp),
            order.paymentMethod || 'Cash'
        ].join(' · ');
        body.appendChild(meta);

        if (idName || idNumber) {
            const idLine = document.createElement('p');
            idLine.className = 'discount-order-idinfo';
            idLine.textContent = [idName, idNumber].filter(Boolean).join(' · ');
            body.appendChild(idLine);
        }

        const itemsEl = document.createElement('p');
        itemsEl.className = 'discount-order-items';
        itemsEl.textContent = items
            .map((item) => `${item.name || 'Item'} ×${item.quantity || 1}`)
            .join(', ');
        body.appendChild(itemsEl);

        card.appendChild(body);
        list.appendChild(card);
    });

    modal.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => overlay.remove());
    footer.appendChild(closeBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
}

function formatCustomizationLabel(section, key) {
    if (section === 'milk') {
        if (key === 'dairy') return 'Dairy milk';
        if (key === 'oat') return 'Oat milk';
        return key.charAt(0).toUpperCase() + key.slice(1);
    }
    if (section === 'matchaOption') {
        if (key === 'natsu') return 'Natsu';
        if (key === 'aki') return 'Aki';
        return key.charAt(0).toUpperCase() + key.slice(1);
    }
    if (section === 'strength') return `Level ${key}`;
    if (section === 'discounts') return String(key).toUpperCase();
    return key;
}

function formatPercentShare(count, total) {
    if (!total) return '—';
    const pct = Math.round((count / total) * 1000) / 10;
    return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

function renderCustomizationList(containerId, counts, section, emptyMessage) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const entries = Object.entries(counts || {})
        .filter(([, count]) => count > 0)
        .sort((a, b) => {
            if (section === 'strength') return Number(a[0]) - Number(b[0]);
            if (section === 'sugar') {
                const order = ['0%', '50%', '100%', '150%', '200%'];
                return order.indexOf(a[0]) - order.indexOf(b[0]);
            }
            if (section === 'discounts') {
                const order = ['pwd', 'senior', 'free', 'custom'];
                const ai = order.indexOf(a[0]);
                const bi = order.indexOf(b[0]);
                if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            }
            if (section === 'milk') {
                const order = ['dairy', 'oat'];
                return (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0]))
                    - (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0]));
            }
            if (section === 'matchaOption') {
                const order = ['aki', 'natsu'];
                return (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0]))
                    - (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0]));
            }
            return b[1] - a[1];
        });

    if (entries.length === 0) {
        el.innerHTML = `<div class="loading">${emptyMessage}</div>`;
        return;
    }

    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    const showCups = section === 'milk' || section === 'strength' || section === 'sugar' || section === 'matchaOption';

    if (showCups) {
        el.innerHTML = `
            <div class="breakdown-row breakdown-row-header">
                <span></span>
                <span class="breakdown-col-num">Cups</span>
                <span class="breakdown-col-num">Share</span>
            </div>
            ${entries.map(([key, count]) => `
                <div class="breakdown-row">
                    <span class="breakdown-label">${escapeHtml(formatCustomizationLabel(section, key))}</span>
                    <span class="breakdown-col-num breakdown-cups">${count}</span>
                    <span class="breakdown-col-num breakdown-share">${formatPercentShare(count, total)}</span>
                </div>
            `).join('')}
        `;
        return;
    }

    el.innerHTML = entries.map(([key, count]) => {
        if (section === 'discounts') {
            return `
        <button type="button" class="payment-item discount-filter-btn" data-discount-type="${escapeHtml(key)}">
            <span class="payment-method">${escapeHtml(formatCustomizationLabel(section, key))}</span>
            <span class="payment-amount">${count}</span>
        </button>`;
        }
        return `
        <div class="payment-item">
            <span class="payment-method">${escapeHtml(formatCustomizationLabel(section, key))}</span>
            <span class="payment-amount">${count}</span>
        </div>`;
    }).join('');

    if (section === 'discounts') {
        el.querySelectorAll('[data-discount-type]').forEach((btn) => {
            btn.addEventListener('click', () => showDiscountOrdersModal(btn.dataset.discountType));
        });
    }
}

function updateCustomizationBreakdowns(data) {
    const c = data.customizations || emptyCustomizationMaps();
    renderCustomizationList('milkStats', c.milk, 'milk', 'No milk customizations');
    renderCustomizationList('strengthStats', c.strength, 'strength', 'No strength levels');
    renderCustomizationList('matchaOptionStats', c.matchaOption, 'matchaOption', 'No matcha option customizations');
    renderCustomizationList('sugarStats', c.sugar, 'sugar', 'No sweetness levels');
    renderCustomizationList('discountStats', c.discounts, 'discounts', 'No discounts applied');
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

    const totalQty = sortedItems.reduce((s, [, d]) => s + d.count, 0);
    const totalRevenue = sortedItems.reduce((s, [, d]) => s + d.total, 0);

    reportEl.innerHTML = `
        <table class="sales-by-item-table">
            <thead>
                <tr>
                    <th>Item</th>
                    <th class="align-right">Cups</th>
                    <th class="align-right">Share</th>
                    ${currentEventIsPackage ? '' : '<th class="align-right">Revenue</th>'}
                </tr>
            </thead>
            <tbody>
                ${sortedItems.map(([itemName, itemData]) => `
                    <tr>
                        <td>${escapeHtml(itemName)}</td>
                        <td class="align-right">${itemData.count}</td>
                        <td class="align-right">${formatPercentShare(itemData.count, totalQty)}</td>
                        ${currentEventIsPackage ? '' : `<td class="align-right">${formatCurrency(itemData.total)}</td>`}
                    </tr>
                `).join('')}
            </tbody>
            <tfoot>
                <tr>
                    <td><strong>Total</strong></td>
                    <td class="align-right"><strong>${totalQty}</strong></td>
                    <td class="align-right"><strong>100%</strong></td>
                    ${currentEventIsPackage ? '' : `<td class="align-right"><strong>${formatCurrency(totalRevenue)}</strong></td>`}
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

    const dateLabel = dataScope === 'day'
        ? getLocalDateString(selectedDate)
        : `${getSelectedRange().start} to ${getSelectedRange().end}`;
    const eventName = getSelectedEventLabel();

    const stamp = document.createElement('div');
    stamp.className = 'sales-by-item-meta sales-by-item-meta-capture';
    stamp.innerHTML = `
        <div><strong>Event:</strong> ${escapeHtml(eventName)}</div>
        <div><strong>Period:</strong> ${escapeHtml(dateLabel)}</div>
    `;
    const reportEl = document.getElementById('salesByItemReport');
    if (reportEl) reportEl.insertBefore(stamp, reportEl.firstChild);

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
        stamp.remove();
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
        const previousDate = new Date(selectedDate);
        previousDate.setDate(previousDate.getDate() - 1);
        const [hourlyData, hourlyDataPrev] = await Promise.all([
            getHourlyData(currentEvent, selectedDate),
            getHourlyData(currentEvent, previousDate)
        ]);
        // 9 AM through 12 MN: hours 9,10,...,23,0 (16 slots)
        const operatingHours = [...Array.from({ length: 24 - PEAK_HOURS_START }, (_, i) => PEAK_HOURS_START + i), PEAK_HOURS_END];
        const labels = operatingHours.map((h) => {
            const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
            const ampm = h === 0 ? 'MN' : h < 12 ? 'AM' : 'PM';
            return `${hour} ${ampm}`;
        });
        const chartData = operatingHours.map((h) => hourlyData[h]);
        const previousDayData = operatingHours.map((h) => hourlyDataPrev[h]);
        const cumulative = chartData.reduce((acc, val, i) => {
            acc.push((acc[i - 1] || 0) + val);
            return acc;
        }, []);
        const previousDayCumulative = previousDayData.reduce((acc, val, i) => {
            acc.push((acc[i - 1] || 0) + val);
            return acc;
        }, []);

        const chartLabel = currentEventIsPackage ? 'Hourly Cups' : 'Hourly Sales (₱)';
        const prevDateStr = previousDate.toLocaleDateString('en', { month: 'short', day: 'numeric' });
        const yesterdayLabel = currentEventIsPackage ? `Day before (${prevDateStr})` : `Day before (${prevDateStr})`;
        renderChart(canvas, labels, chartData, chartLabel, '#2b9348', currentEventIsPackage, {
            cumulative,
            previousDayData,
            previousDayCumulative,
            previousDayLabel: yesterdayLabel
        });
    } catch (error) {
        console.error('Error loading hourly data:', error);
        // Fallback to simple chart
        canvas.style.display = 'none';
        simpleChart.style.display = 'block';
        simpleChart.innerHTML = '<div class="loading">Error loading hourly data</div>';
    }
}

function renderChart(canvas, labels, data, label, color, isCups = false, extra = {}) {
    const ctx = canvas.getContext('2d');

    if (salesChart) {
        salesChart.destroy();
    }

    const formatValue = (v) => isCups ? `${v} cups` : formatCurrency(v);
    const cumulative = extra.cumulative || null;
    const previousDayData = extra.previousDayData || null;
    const previousDayCumulative = extra.previousDayCumulative || null;
    const previousDayLabel = extra.previousDayLabel || 'Yesterday';

    const dataset = {
        label: label,
        data: data,
        borderColor: color,
        backgroundColor: color.replace(')', ', 0.1)').replace('rgb', 'rgba'),
        tension: 0.3,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: color
    };
    if (cumulative) dataset.cumulative = cumulative;

    const datasets = [dataset];
    if (previousDayData && previousDayData.length === labels.length) {
        const prevColor = 'rgba(100, 100, 100, 0.8)';
        const prevDataset = {
            label: previousDayLabel,
            data: previousDayData,
            borderColor: prevColor,
            backgroundColor: 'rgba(100, 100, 100, 0.05)',
            borderWidth: 1.5,
            borderDash: [5, 5],
            tension: 0.3,
            fill: false,
            pointRadius: 2,
            pointBackgroundColor: prevColor,
            order: 0  // lower order = drawn last = on top
        };
        if (previousDayCumulative && previousDayCumulative.length === previousDayData.length) {
            prevDataset.cumulative = previousDayCumulative;
            prevDataset.cumulativeLabel = isCups ? 'Cumulative cups (day before)' : 'Cumulative sales (₱) (day before)';
        }
        dataset.order = 1;  // Chart.js: higher order = drawn first (behind)
        datasets.push(prevDataset);
    }

    salesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: datasets.length > 1 },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const lines = [`${context.dataset.label}: ${formatValue(context.raw)}`];
                            if (context.dataset.cumulative != null && context.dataset.cumulative[context.dataIndex] != null) {
                                const cumLabel = context.dataset.cumulativeLabel || (isCups ? 'Cumulative cups' : 'Cumulative sales (₱)');
                                lines.push(`${cumLabel}: ${formatValue(context.dataset.cumulative[context.dataIndex])}`);
                            }
                            return lines;
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

async function getHourlyData(eventName, date) {
    try {
        const useDate = date || selectedDate;
        const dateStr = getLocalDateString(useDate);
        const dayRef = collection(db, `pos-orders/${eventName}/${dateStr}`);
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

function formatHistorySalesText(amount, isPackage) {
    const n = Number(amount) || 0;
    return isPackage ? `${n} cups` : formatCurrency(n);
}

/** Day view: hide the 1-row history table. */
function hideDayViewHistoryTable() {
    const eventsGrid = document.getElementById('eventsGrid');
    if (eventsGrid) {
        eventsGrid.style.display = 'none';
        eventsGrid.innerHTML = '';
    }
}

/** Range history grid: no extra Firestore reads — uses loadRangeData output only. */
async function renderRangeSalesHistory(startDate, endDate, rangeData) {
    const eventsGrid = document.getElementById('eventsGrid');
    if (!eventsGrid) return;

    try {
        const serviceType = await getCurrentEventServiceType();
        const isPackageMode = serviceType === 'package';
        const orderDaily = rangeData.orderDailySales && typeof rangeData.orderDailySales === 'object'
            ? rangeData.orderDailySales
            : {};
        const daily = rangeData.dailySales && typeof rangeData.dailySales === 'object'
            ? rangeData.dailySales
            : {};

        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T00:00:00');
        const salesData = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = getLocalDateString(d);
            const orderTotal = orderDaily[dateStr] ?? 0;
            const effective = daily[dateStr] ?? orderTotal;
            salesData.push({ date: dateStr, orderTotal, effective });
        }

        const pkg = isPackageMode ? '1' : '0';
        let html = `
            <table class="sales-history-table" data-package-mode="${pkg}">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Day</th>
                        <th>Sales</th>
                    </tr>
                </thead>
                <tbody>
        `;

        salesData.forEach(record => {
            const dateObj = new Date(record.date + 'T12:00:00');
            const dayOfWeek = dateObj.toLocaleDateString('en', { weekday: 'long' });
            const dateDisplay = dateObj.toLocaleDateString('en', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            const salesText = formatHistorySalesText(record.effective, isPackageMode);

            html += `
                <tr class="sales-history-row" data-history-date="${record.date}" data-order-total="${record.orderTotal}" data-effective="${record.effective}">
                    <td>${dateDisplay}</td>
                    <td>${dayOfWeek}</td>
                    <td class="sales-history-sales-cell sales-history-sales-text">${salesText}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';

        eventsGrid.innerHTML = html;

    } catch (error) {
        console.error('Error rendering sales history:', error);
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

function setDefaultRangeDates() {
    const startInput = document.getElementById('rangeStartDate');
    const endInput = document.getElementById('rangeEndDate');
    if (!startInput || !endInput) return;
    if (startInput.value && endInput.value) return;

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);
    startInput.value = getLocalDateString(start);
    endInput.value = getLocalDateString(end);
}

/** True if the date collection has at least one non-deleted order. */
async function dayHasOrders(eventKey, dateStr) {
    try {
        const dayRef = collection(db, `pos-orders/${eventKey}/${dateStr}`);
        const snap = await getDocs(query(dayRef, limit(15)));
        if (snap.empty) return false;
        for (const orderDoc of snap.docs) {
            if (orderDoc.data().status !== 'deleted') return true;
        }
        return false;
    } catch {
        return false;
    }
}

function getEventDateScanStart(createdAtIso) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const earliest = new Date(today);
    earliest.setDate(earliest.getDate() - EVENT_DATE_SCAN_MAX_DAYS);

    if (!createdAtIso) return earliest;
    const created = new Date(createdAtIso);
    if (Number.isNaN(created.getTime())) return earliest;

    created.setHours(0, 0, 0, 0);
    // Orders can exist a bit before the branch doc was created (transfers, late setup).
    created.setDate(created.getDate() - 14);
    return created > earliest ? created : earliest;
}

/** Return sorted YYYY-MM-DD strings that have non-deleted orders in [startDate, endDate]. */
async function findDatesWithOrders(eventKey, startDate, endDate) {
    const dateStrs = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        dateStrs.push(getLocalDateString(d));
    }

    const found = [];
    for (let i = 0; i < dateStrs.length; i += EVENT_DATE_SCAN_CHUNK) {
        const chunk = dateStrs.slice(i, i + EVENT_DATE_SCAN_CHUNK);
        const hits = await Promise.all(
            chunk.map(async (dateStr) => (await dayHasOrders(eventKey, dateStr)) ? dateStr : null)
        );
        for (const hit of hits) {
            if (hit) found.push(hit);
        }
    }
    found.sort();
    return found;
}

function eventCreatedAtMs(event) {
    const raw = event?.createdAt;
    if (raw == null || raw === '') return 0;
    if (typeof raw.toDate === 'function') {
        const d = raw.toDate();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
    }
    if (typeof raw.seconds === 'number') return raw.seconds * 1000;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function sortEventsByRecency(events) {
    return [...events].sort((a, b) => {
        const diff = eventCreatedAtMs(b) - eventCreatedAtMs(a);
        if (diff !== 0) return diff;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

/**
 * Detect whether an event is ongoing (orders today/yesterday) or past,
 * and return the Firebase-backed date bounds to show by default.
 */
async function discoverEventDateBounds(eventKey, createdAtIso) {
    if (eventDateBoundsCache.has(eventKey)) {
        return eventDateBoundsCache.get(eventKey);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const todayStr = getLocalDateString(today);
    const yesterdayStr = getLocalDateString(yesterday);

    const [hasToday, hasYesterday] = await Promise.all([
        dayHasOrders(eventKey, todayStr),
        dayHasOrders(eventKey, yesterdayStr)
    ]);

    const scanStart = getEventDateScanStart(createdAtIso);

    if (hasToday || hasYesterday) {
        const latest = hasToday ? todayStr : yesterdayStr;
        const latestDate = new Date(latest + 'T00:00:00');
        const earlier = await findDatesWithOrders(eventKey, scanStart, latestDate);
        const dates = earlier.length ? earlier : [latest];
        if (!dates.includes(latest)) dates.push(latest);
        dates.sort();
        const result = {
            mode: 'ongoing',
            latest,
            first: dates[0],
            last: dates[dates.length - 1]
        };
        eventDateBoundsCache.set(eventKey, result);
        return result;
    }

    const scanEnd = new Date(yesterday);
    scanEnd.setDate(scanEnd.getDate() - 1); // today & yesterday already empty
    const found = scanEnd >= scanStart
        ? await findDatesWithOrders(eventKey, scanStart, scanEnd)
        : [];

    if (found.length === 0) {
        const result = { mode: 'empty' };
        eventDateBoundsCache.set(eventKey, result);
        return result;
    }

    const result = { mode: 'past', first: found[0], last: found[found.length - 1] };
    eventDateBoundsCache.set(eventKey, result);
    return result;
}

function syncScopeToggleUI() {
    document.querySelectorAll('.scope-toggle-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.scope === dataScope);
    });
    toggleRangeControls();
}

/**
 * Pop-ups/packages are not continuous stores:
 * - ongoing (data today or yesterday) → Day view on that latest date
 * - past → Range view from first Firebase day to last Firebase day
 */
async function applyEventDateDefaults(eventKey) {
    if (!eventKey) return;

    try {
        const events = await loadEventsFromFirebase();
        const eventMeta = events.find((e) => e.key === eventKey);
        const bounds = await discoverEventDateBounds(eventKey, eventMeta?.createdAt);

        const dateSelector = document.getElementById('dateSelector');
        const startInput = document.getElementById('rangeStartDate');
        const endInput = document.getElementById('rangeEndDate');

        if (bounds.mode === 'ongoing') {
            dataScope = 'day';
            selectedDate = new Date(bounds.latest + 'T00:00:00');
            if (dateSelector) dateSelector.value = bounds.latest;
            if (startInput) startInput.value = bounds.first || bounds.latest;
            if (endInput) endInput.value = bounds.last || bounds.latest;
        } else if (bounds.mode === 'past') {
            dataScope = 'range';
            selectedDate = new Date(bounds.last + 'T00:00:00');
            if (dateSelector) dateSelector.value = bounds.last;
            if (startInput) startInput.value = bounds.first;
            if (endInput) endInput.value = bounds.last;
        } else {
            dataScope = 'day';
            selectedDate = new Date();
            const todayStr = getLocalDateString(selectedDate);
            if (dateSelector) dateSelector.value = todayStr;
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - 30);
            if (startInput) startInput.value = getLocalDateString(start);
            if (endInput) endInput.value = getLocalDateString(end);
        }

        syncScopeToggleUI();
    } catch (error) {
        console.error('Error applying event date defaults:', error);
    }
}

function getSelectedRange() {
    const startInput = document.getElementById('rangeStartDate');
    const endInput = document.getElementById('rangeEndDate');
    const fallbackEnd = getLocalDateString(new Date());
    const fallbackStartDate = new Date();
    fallbackStartDate.setDate(fallbackStartDate.getDate() - 30);
    const fallbackStart = getLocalDateString(fallbackStartDate);
    let start = startInput?.value || fallbackStart;
    let end = endInput?.value || fallbackEnd;
    if (start > end) [start, end] = [end, start];
    return { start, end };
}

function formatCurrency(amount) {
    return `₱${amount.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** ASCII-only amounts for jsPDF built-in fonts (Helvetica cannot render ₱ / some locale spaces reliably). */
function formatCurrencyPdfSafe(amount) {
    const n = Number(amount);
    const safe = Number.isFinite(n) ? n : 0;
    const neg = safe < 0;
    const abs = Math.abs(safe);
    const [intRaw, frac = '00'] = abs.toFixed(2).split('.');
    const intPart = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const core = `PHP ${intPart}.${frac}`;
    return neg ? `-${core}` : core;
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
    const suffix = scope === 'day' ? 'Selected Day' : 'Selected Range';
    const paymentTitle = document.getElementById('paymentSectionTitle');
    const ordersTitle = document.getElementById('ordersSectionTitle');
    const salesByItemTitle = document.getElementById('salesByItemTitle');
    const milkTitle = document.getElementById('milkSectionTitle');
    const strengthTitle = document.getElementById('strengthSectionTitle');
    const sugarTitle = document.getElementById('sugarSectionTitle');
    const discountTitle = document.getElementById('discountSectionTitle');
    if (paymentTitle) paymentTitle.textContent = `Payment Methods (${suffix})`;
    if (ordersTitle) ordersTitle.textContent = `Orders (${suffix})`;
    if (salesByItemTitle) salesByItemTitle.textContent = 'Sales by Item Report';
    if (milkTitle) milkTitle.textContent = 'Milk';
    if (strengthTitle) strengthTitle.textContent = 'Strength';
    if (sugarTitle) sugarTitle.textContent = 'Sweetness';
    if (discountTitle) discountTitle.textContent = `Discounts (${suffix})`;
}

/** On Daily: hide "All Days" / "Hourly Sales" toggle and set title to Hourly Sales. On Week/Month: show toggle and "Daily Sales". */
function setChartSectionForScope(scope) {
    const wrap = document.getElementById('chartToggleWrap');
    const titleEl = document.getElementById('chartSectionTitle');
    if (scope === 'daily') {
        if (wrap) wrap.style.display = 'none';
        if (titleEl) titleEl.textContent = 'Hourly Sales (Selected Day)';
    } else {
        if (wrap) wrap.style.display = '';
        if (titleEl) titleEl.textContent = 'Daily Sales';
    }
}

function updateDailySalesHistoryTitle(scope) {
    const titleEl = document.getElementById('dailySalesHistoryTitle');
    if (!titleEl) return;
    if (scope === 'range') {
        const { start, end } = getSelectedRange();
        titleEl.textContent = `Daily Sales History (${start} to ${end})`;
        return;
    }
    titleEl.textContent = `Daily Sales History (${getLocalDateString(selectedDate)})`;
}

function toggleRangeControls() {
    const rangeControls = document.getElementById('rangeControls');
    const dateSelector = document.getElementById('dateSelector');
    if (rangeControls) rangeControls.style.display = dataScope === 'range' ? 'inline-flex' : 'none';
    if (dateSelector) dateSelector.style.display = dataScope === 'range' ? 'none' : '';
}

function getHistoryTableCellPdfText(td, isPackageMode) {
    const input = td.querySelector('input.sales-history-edit-input')
        || td.querySelector('input.manual-sales-input');
    if (input) {
        const raw = parseFloat(input.value);
        if (input.value.trim() === '' || Number.isNaN(raw) || raw < 0) {
            return isPackageMode ? '0 cups' : formatCurrencyPdfSafe(0);
        }
        return isPackageMode ? `${raw} cups` : formatCurrencyPdfSafe(raw);
    }
    const fromDom = normalizePdfText(td.textContent.trim());
    if (!isPackageMode && /(PHP|₱)\s*[-\d,.]+/.test(fromDom)) {
        const num = parseFloat(fromDom.replace(/^(PHP|₱)\s*/i, '').replace(/,/g, ''));
        if (!Number.isNaN(num)) return formatCurrencyPdfSafe(num);
    }
    if (isPackageMode && /^\s*\d+(\.\d+)?\s*cups?\s*$/i.test(fromDom)) {
        const num = parseFloat(fromDom.replace(/cups?/gi, ''));
        if (!Number.isNaN(num)) return `${num} cups`;
    }
    return fromDom;
}

async function exportDailySalesHistoryPdf() {
    const btn = document.getElementById('exportHistoryPdfBtn');
    if (!btn || !window.jspdf?.jsPDF) return;

    const table = document.querySelector('#eventsGrid .sales-history-table');
    const serviceType = await getCurrentEventServiceType();
    const isPackageModePdf = serviceType === 'package';

    let headers = ['Date', 'Day', 'Sales'];
    let rows = [];

    if (table) {
        const headerEls = Array.from(table.querySelectorAll('thead th')).filter(
            (th) => !th.classList.contains('sales-history-col-actions')
        );
        headers = headerEls.map((th) => normalizePdfText(th.textContent.trim()));
        rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
            Array.from(tr.querySelectorAll('td'))
                .filter((td) => !td.classList.contains('sales-history-col-actions'))
                .map((td) => getHistoryTableCellPdfText(td, isPackageModePdf))
        );
    } else if (dataScope === 'day' && lastLoadedDashboardData) {
        const dateStr = getLocalDateString(selectedDate);
        const dateObj = new Date(dateStr + 'T12:00:00');
        const dayOfWeek = dateObj.toLocaleDateString('en', { weekday: 'long' });
        const dateDisplay = dateObj.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
        const orderTotal = isPackageModePdf
            ? (lastLoadedDashboardData.orders || []).reduce((s, o) => s + (o.total || 0), 0)
            : (lastLoadedDashboardData.sales || 0);
        const override = getSalesOverride(currentEvent, dateStr);
        const effective = override !== undefined ? override : orderTotal;
        rows = [[
            dateDisplay,
            dayOfWeek,
            isPackageModePdf ? `${effective} cups` : formatCurrencyPdfSafe(effective)
        ]];
    } else {
        alert('No sales history data to export.');
        return;
    }

    const originalText = btn.textContent;
    btn.textContent = 'Generating PDF...';
    btn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 12;
        const contentWidth = pageWidth - (margin * 2);
        const rowHeight = 8;
        const lineHeight = 6;
        let y = margin;

        const logoDataUrl = await loadImageAsDataUrl('../shared/assets/images/matchanese-logo-full.png');
        if (logoDataUrl) {
            const logoSize = await getImageSizeFromDataUrl(logoDataUrl);
            const maxLogoWidth = 56;
            const logoWidth = maxLogoWidth;
            const logoHeight = logoSize ? (logoSize.height / logoSize.width) * logoWidth : 12;
            pdf.addImage(logoDataUrl, 'PNG', margin, y, logoWidth, logoHeight);
            y += logoHeight + 6;
        }

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(16);
        pdf.text('Daily Sales History Report', margin, y);
        y += 8;

        const titleEl = document.getElementById('dailySalesHistoryTitle');
        const titleText = (titleEl?.textContent || '').trim();
        const eventSelector = document.getElementById('eventSelector');
        const eventName = eventSelector?.options?.[eventSelector.selectedIndex]?.textContent?.trim() || currentEvent;
        const periodText = titleText.replace('Daily Sales History', '').replace(/[()]/g, '').trim();

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.text(`Event: ${eventName}`, margin, y);
        y += lineHeight;
        if (periodText) {
            pdf.text(`Period: ${periodText}`, margin, y);
            y += lineHeight;
        }
        pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
        y += 8;

        const colWidths = headers.map((_, index) => {
            if (index === 0) return contentWidth * 0.30;
            if (index === 1) return contentWidth * 0.26;
            return contentWidth * 0.44;
        });

        const drawHeader = () => {
            pdf.setFillColor(43, 147, 72);
            pdf.rect(margin, y, contentWidth, rowHeight, 'F');
            pdf.setTextColor(255, 255, 255);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(10);
            let x = margin + 2;
            headers.forEach((header, i) => {
                pdf.text(header, x, y + 5.3);
                x += colWidths[i];
            });
            pdf.setTextColor(0, 0, 0);
            pdf.setFont('helvetica', 'normal');
            y += rowHeight;
        };

        drawHeader();
        const tableStartY = y - rowHeight;

        rows.forEach((cells, rowIndex) => {
            if (y + rowHeight > pageHeight - margin - 10) {
                pdf.addPage();
                y = margin;
                drawHeader();
            }
            if (rowIndex % 2 === 1) {
                pdf.setFillColor(248, 249, 250);
                pdf.rect(margin, y, contentWidth, rowHeight, 'F');
            }

            let x = margin + 2;
            pdf.setFontSize(9.5);
            cells.forEach((cell, i) => {
                const isNumericColumn = i >= 2;
                const maxWidth = colWidths[i] - 3;
                if (isNumericColumn) {
                    const numericText = cell;
                    const textWidth = pdf.getTextWidth(numericText);
                    const rightX = x + maxWidth - textWidth;
                    pdf.text(numericText, Math.max(x, rightX), y + 5.2);
                } else {
                    const wrapped = pdf.splitTextToSize(cell, maxWidth);
                    pdf.text(wrapped, x, y + 5.2);
                }
                x += colWidths[i];
            });
            y += rowHeight;
        });

        pdf.setDrawColor(220, 220, 220);
        pdf.rect(margin, tableStartY, contentWidth, y - tableStartY);

        const totalPages = pdf.getNumberOfPages();
        for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
            pdf.setPage(pageNum);
            pdf.setFontSize(9);
            pdf.setTextColor(120, 120, 120);
            pdf.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin - 20, pageHeight - 6);
        }

        const range = dataScope === 'range' ? getSelectedRange() : null;
        const periodLabel = range ? `${range.start}_to_${range.end}` : getLocalDateString(selectedDate);
        const eventKey = (currentEvent || 'event').replace(/\s+/g, '-');
        pdf.save(`daily-sales-history-${eventKey}-${periodLabel}.pdf`);
    } catch (error) {
        console.error('Failed to export history PDF:', error);
        alert('Failed to export PDF. Please try again.');
    } finally {
        btn.textContent = originalText || 'Export PDF';
        btn.disabled = false;
    }
}

async function loadImageAsDataUrl(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        return null;
    }
}

async function getImageSizeFromDataUrl(dataUrl) {
    return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

function normalizePdfText(text) {
    if (!text) return '';
    return text
        .replace(/₱/g, 'PHP ')
        .replace(/[\u202f\u00a0]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function beginSalesHistoryRowEdit(tr) {
    if (!tr || tr.classList.contains('is-editing')) return;
    const table = tr.closest('table.sales-history-table');
    const isPackage = table?.dataset.packageMode === '1';
    const dateStr = tr.dataset.historyDate;
    if (!dateStr) return;
    const effective = Number.parseFloat(tr.dataset.effective);
    const val = Number.isFinite(effective) ? effective : 0;
    tr.classList.add('is-editing');
    const salesTd = tr.querySelector('.sales-history-sales-cell');
    const actionsTd = tr.querySelector('.sales-history-col-actions');
    if (!salesTd || !actionsTd) return;
    const step = isPackage ? '1' : '0.01';
    salesTd.innerHTML = `<input type="number" class="sales-history-edit-input" min="0" step="${step}" value="${val}" aria-label="Sales amount">`;
    salesTd.classList.remove('sales-history-sales-text');
    actionsTd.innerHTML = `
        <button type="button" class="sales-history-save-btn" data-save-date="${dateStr}">Save</button>
        <button type="button" class="sales-history-cancel-btn">Cancel</button>
    `;
    const inp = salesTd.querySelector('input');
    inp?.focus();
    inp?.select?.();
}

function finalizeSalesHistorySave(dateStr, rawInput, orderTotalRaw) {
    const orderTotal = Number.parseFloat(orderTotalRaw);
    const trimmed = (rawInput ?? '').toString().trim();
    if (trimmed === '') {
        setSalesOverride(currentEvent, dateStr, '');
        loadDashboardData();
        return;
    }
    const num = parseFloat(trimmed);
    if (Number.isNaN(num) || num < 0) {
        loadDashboardData();
        return;
    }
    const ot = Number.isFinite(orderTotal) ? orderTotal : 0;
    if (Math.abs(num - ot) < 0.0005) {
        setSalesOverride(currentEvent, dateStr, '');
    } else {
        setSalesOverride(currentEvent, dateStr, num);
    }
    loadDashboardData();
}

function setupSalesHistoryEditListener() {
    const grid = document.getElementById('eventsGrid');
    if (!grid || grid.dataset.salesHistoryEditDelegated) return;
    grid.dataset.salesHistoryEditDelegated = '1';
    grid.addEventListener('click', (e) => {
        const editBtn = e.target.closest?.('.sales-history-edit-btn');
        if (editBtn) {
            e.preventDefault();
            const tr = editBtn.closest('tr');
            beginSalesHistoryRowEdit(tr);
            return;
        }
        const saveBtn = e.target.closest?.('.sales-history-save-btn');
        if (saveBtn) {
            e.preventDefault();
            const tr = saveBtn.closest('tr');
            const dateStr = saveBtn.dataset.saveDate || tr?.dataset.historyDate;
            const input = tr?.querySelector('input.sales-history-edit-input');
            if (!dateStr || !input) return;
            finalizeSalesHistorySave(dateStr, input.value, tr.dataset.orderTotal);
            return;
        }
        const cancelBtn = e.target.closest?.('.sales-history-cancel-btn');
        if (cancelBtn) {
            e.preventDefault();
            loadDashboardData();
        }
    });
    grid.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const input = e.target;
        if (!input.matches?.('input.sales-history-edit-input')) return;
        const tr = input.closest('tr');
        const dateStr = tr?.dataset.historyDate;
        if (!dateStr) return;
        e.preventDefault();
        finalizeSalesHistorySave(dateStr, input.value, tr.dataset.orderTotal);
    });
}

function setupHistoryExportListener() {
    const btn = document.getElementById('exportHistoryPdfBtn');
    if (btn) btn.addEventListener('click', exportDailySalesHistoryPdf);
}

function setupCsvExportListeners() {
    const transactionsBtn = document.getElementById('exportTransactionsCsvBtn');
    const breakdownBtn = document.getElementById('exportDailyBreakdownCsvBtn');
    if (transactionsBtn) transactionsBtn.addEventListener('click', () => exportDashboardCsv('transactions'));
    if (breakdownBtn) breakdownBtn.addEventListener('click', () => exportDashboardCsv('daily'));
}

function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function downloadCsv(filename, rows) {
    const csv = `\uFEFF${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function getSelectedEventLabel() {
    const eventSelector = document.getElementById('eventSelector');
    return eventSelector?.options?.[eventSelector.selectedIndex]?.textContent?.trim() || currentEvent;
}

function getExportPeriodLabel() {
    if (dataScope === 'range') {
        const { start, end } = getSelectedRange();
        return `${start}_to_${end}`;
    }
    return getLocalDateString(selectedDate);
}

function getCsvExportCacheKey() {
    return `${currentEvent}|${dataScope}|${getExportPeriodLabel()}`;
}

function getExportDateList() {
    if (dataScope === 'range') {
        const { start, end } = getSelectedRange();
        const dates = [];
        for (let d = new Date(start + 'T00:00:00'); d <= new Date(end + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
            dates.push(getLocalDateString(d));
        }
        return dates;
    }
    return [getLocalDateString(selectedDate)];
}

function roundMoney(amount) {
    const n = Number(amount);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function formatCsvNumber(amount, isPackage) {
    const n = roundMoney(amount);
    return isPackage ? String(n) : n.toFixed(2);
}

function formatCustomizationsForCsv(customizations) {
    if (!customizations || typeof customizations !== 'object') return '';
    const parts = [];
    if (customizations.variant) parts.push(customizations.variant);
    if (customizations.size) parts.push(customizations.size);
    if (customizations.serving) parts.push(customizations.serving);
    if (customizations.milk) parts.push(customizations.milk);
    if (customizations.sweetness) parts.push(customizations.sweetness);
    if (customizations.strengthLevel) parts.push(`Strength ${customizations.strengthLevel}`);
    if (customizations.matchaStrength) {
        parts.push(`Strength ${String(customizations.matchaStrength).replace(/^Level\s+/i, '')}`);
    }
    if (customizations.matchaOption) {
        const opt = String(customizations.matchaOption);
        parts.push(opt === 'natsu' ? 'Natsu' : opt === 'aki' ? 'Aki' : opt);
    }
    if (customizations.discount && customizations.discount !== 'none') {
        if (customizations.discount === 'custom') {
            if (customizations.customDiscountMode === 'amount' && customizations.customDiscountAmount) {
                parts.push(`PHP ${customizations.customDiscountAmount} OFF`);
            } else if (customizations.customDiscountPercent) {
                parts.push(`${customizations.customDiscountPercent}% OFF`);
            } else {
                parts.push('custom discount');
            }
        } else {
            parts.push(String(customizations.discount).toUpperCase());
        }
    }
    return parts.join(', ');
}

function getOrderDateStr(order) {
    if (order?.date) return order.date;
    const ts = order?.timestamp ? new Date(order.timestamp) : null;
    if (ts && !Number.isNaN(ts.getTime())) return getLocalDateString(ts);
    return '';
}

function getOrderTimeStr(order) {
    const ts = order?.timestamp ? new Date(order.timestamp) : null;
    if (!ts || Number.isNaN(ts.getTime())) return '';
    const hours = String(ts.getHours()).padStart(2, '0');
    const minutes = String(ts.getMinutes()).padStart(2, '0');
    const seconds = String(ts.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

function normalizePaymentMethod(method) {
    const raw = String(method || 'cash').trim();
    const key = raw.toLowerCase();
    if (key === 'cash' || key === 'gcash' || key === 'card') return key;
    return raw || 'cash';
}

async function getDataForCsvExport() {
    const cacheKey = getCsvExportCacheKey();
    if (lastLoadedDashboardData && lastLoadedDashboardData._exportKey === cacheKey) {
        return lastLoadedDashboardData;
    }
    if (dataScope === 'day') return await loadSelectedDayData(currentEvent);
    const { start, end } = getSelectedRange();
    return await loadRangeData(currentEvent, start, end);
}

function buildTransactionsCsvRows(data, isPackage) {
    const eventLabel = getSelectedEventLabel();
    const amountHeader = isPackage ? 'Order Total (cups)' : 'Order Total';
    const unitHeader = isPackage ? 'Unit Price (cups)' : 'Unit Price';
    const lineHeader = isPackage ? 'Line Total (cups)' : 'Line Total';
    const rows = [[
        'Event',
        'Date',
        'Time',
        'Order ID',
        'Customer',
        'Payment Method',
        'Status',
        'Item',
        'Quantity',
        unitHeader,
        lineHeader,
        'Customizations',
        amountHeader
    ]];

    const orders = [...(data.orders || [])].sort((a, b) => {
        const dateCmp = getOrderDateStr(a).localeCompare(getOrderDateStr(b));
        if (dateCmp !== 0) return dateCmp;
        return new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
    });

    for (const order of orders) {
        const items = Array.isArray(order.items) && order.items.length ? order.items : [null];
        items.forEach((item, itemIndex) => {
            const qty = item?.quantity || (item ? 1 : '');
            const unitPrice = item ? (item.price || 0) : '';
            const lineTotal = item ? roundMoney((item.price || 0) * (item.quantity || 1)) : '';
            rows.push([
                eventLabel,
                getOrderDateStr(order),
                getOrderTimeStr(order),
                order.id || order.firebaseId || '',
                order.customerName || '',
                normalizePaymentMethod(order.paymentMethod),
                order.status || '',
                item?.name || (item ? 'Unknown Item' : ''),
                qty,
                item ? formatCsvNumber(unitPrice, isPackage) : '',
                item ? formatCsvNumber(lineTotal, isPackage) : '',
                item ? formatCustomizationsForCsv(item.customizations) : '',
                itemIndex === 0 ? formatCsvNumber(order.total || 0, isPackage) : ''
            ]);
        });
    }

    return rows;
}

async function loadEventSalesByDate(eventKey, dates) {
    const map = {};
    if (!eventKey || !Array.isArray(dates) || dates.length === 0) return map;

    const snapshots = await Promise.all(dates.map(async (dateStr) => {
        try {
            const snap = await getDoc(doc(db, 'event-sales', eventKey, 'daily', dateStr));
            return { dateStr, snap };
        } catch {
            return { dateStr, snap: null };
        }
    }));

    for (const { dateStr, snap } of snapshots) {
        if (snap?.exists()) map[dateStr] = snap.data();
    }
    return map;
}

function formatOptionalCsvNumber(value) {
    if (value == null || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return n.toFixed(2);
}

function buildDailyBreakdownCsvRows(data, isPackage, eventSalesByDate = {}) {
    const eventLabel = getSelectedEventLabel();
    const salesHeader = isPackage ? 'POS Sales (cups)' : 'POS Sales';
    const adjustedHeader = isPackage ? 'Adjusted Sales (cups)' : 'Adjusted Sales';
    const cashHeader = isPackage ? 'Cash (cups)' : 'Cash';
    const gcashHeader = isPackage ? 'GCash (cups)' : 'GCash';
    const cardHeader = isPackage ? 'Card (cups)' : 'Card';
    const rows = [[
        'Event',
        'Date',
        'Day',
        'Orders',
        'Cups Sold',
        cashHeader,
        gcashHeader,
        cardHeader,
        salesHeader,
        adjustedHeader,
        'Manual Override',
        'Cash Expenses',
        'Expected Cash Left',
        'Actual Cash Left',
        'Cash Variance'
    ]];

    const dates = getExportDateList();
    const ordersByDate = new Map();
    for (const order of data.orders || []) {
        const dateStr = getOrderDateStr(order);
        if (!ordersByDate.has(dateStr)) ordersByDate.set(dateStr, []);
        ordersByDate.get(dateStr).push(order);
    }

    const orderDaily = data.orderDailySales && typeof data.orderDailySales === 'object'
        ? data.orderDailySales
        : {};
    const daily = data.dailySales && typeof data.dailySales === 'object'
        ? data.dailySales
        : {};

    let totalOrders = 0;
    let totalCups = 0;
    let totalCash = 0;
    let totalGcash = 0;
    let totalCard = 0;
    let totalPos = 0;
    let totalAdjusted = 0;
    let totalExpenses = 0;
    let totalExpectedCash = 0;
    let totalActualCash = 0;
    let totalVariance = 0;
    let eodDayCount = 0;

    for (const dateStr of dates) {
        const dayOrders = ordersByDate.get(dateStr) || [];
        let cash = 0;
        let gcash = 0;
        let card = 0;
        let cups = 0;
        let posSales = orderDaily[dateStr];
        if (posSales === undefined) {
            posSales = dayOrders.reduce((sum, order) => sum + (order.total || 0), 0);
        }
        for (const order of dayOrders) {
            const method = String(order.paymentMethod || 'cash').toLowerCase();
            const total = order.total || 0;
            if (method === 'cash') cash += total;
            else if (method === 'gcash') gcash += total;
            else if (method === 'card') card += total;
            cups += countCupsInItems(order.items, getCurrentEventMenu());
        }

        const override = getSalesOverride(currentEvent, dateStr);
        const adjusted = override !== undefined
            ? override
            : (daily[dateStr] !== undefined ? daily[dateStr] : posSales);
        const dateObj = new Date(dateStr + 'T12:00:00');
        const dayOfWeek = Number.isNaN(dateObj.getTime())
            ? ''
            : dateObj.toLocaleDateString('en', { weekday: 'long' });

        totalOrders += dayOrders.length;
        totalCups += cups;
        totalCash += cash;
        totalGcash += gcash;
        totalCard += card;
        totalPos += Number(posSales) || 0;
        totalAdjusted += Number(adjusted) || 0;

        const eod = eventSalesByDate[dateStr];
        let expensesCell = '';
        let expectedCell = '';
        let actualCell = '';
        let varianceCell = '';
        if (eod) {
            const expenses = Number(eod.expenses) || 0;
            const expected = eod.calculatedCashLeft != null ? Number(eod.calculatedCashLeft) : (eod.expectedCash != null ? Number(eod.expectedCash) : NaN);
            const actual = eod.actualCashLeft != null ? Number(eod.actualCashLeft) : (eod.actualCash != null ? Number(eod.actualCash) : NaN);
            const variance = eod.cashVariance != null
                ? Number(eod.cashVariance)
                : (eod.variance != null ? Number(eod.variance) : (Number.isFinite(actual) && Number.isFinite(expected) ? actual - expected : NaN));
            expensesCell = formatOptionalCsvNumber(expenses);
            expectedCell = Number.isFinite(expected) ? formatOptionalCsvNumber(expected) : '';
            actualCell = Number.isFinite(actual) ? formatOptionalCsvNumber(actual) : '';
            varianceCell = Number.isFinite(variance) ? formatOptionalCsvNumber(variance) : '';
            eodDayCount += 1;
            totalExpenses += expenses;
            if (Number.isFinite(expected)) totalExpectedCash += expected;
            if (Number.isFinite(actual)) totalActualCash += actual;
            if (Number.isFinite(variance)) totalVariance += variance;
        }

        rows.push([
            eventLabel,
            dateStr,
            dayOfWeek,
            dayOrders.length,
            isPackage ? roundMoney(posSales) : cups,
            formatCsvNumber(cash, isPackage),
            formatCsvNumber(gcash, isPackage),
            formatCsvNumber(card, isPackage),
            formatCsvNumber(posSales, isPackage),
            formatCsvNumber(adjusted, isPackage),
            override !== undefined ? 'Yes' : 'No',
            expensesCell,
            expectedCell,
            actualCell,
            varianceCell
        ]);
    }

    rows.push([
        eventLabel,
        'TOTAL',
        '',
        totalOrders,
        isPackage ? roundMoney(totalPos) : totalCups,
        formatCsvNumber(totalCash, isPackage),
        formatCsvNumber(totalGcash, isPackage),
        formatCsvNumber(totalCard, isPackage),
        formatCsvNumber(totalPos, isPackage),
        formatCsvNumber(totalAdjusted, isPackage),
        '',
        eodDayCount ? formatOptionalCsvNumber(totalExpenses) : '',
        eodDayCount ? formatOptionalCsvNumber(totalExpectedCash) : '',
        eodDayCount ? formatOptionalCsvNumber(totalActualCash) : '',
        eodDayCount ? formatOptionalCsvNumber(totalVariance) : ''
    ]);

    return rows;
}

async function exportDashboardCsv(kind) {
    const btnId = kind === 'daily' ? 'exportDailyBreakdownCsvBtn' : 'exportTransactionsCsvBtn';
    const btn = document.getElementById(btnId);
    const originalText = btn?.textContent;
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Exporting...';
    }

    try {
        const data = await getDataForCsvExport();
        const isPackage = (await getCurrentEventServiceType()) === 'package';
        const eventKey = (currentEvent || 'event').replace(/\s+/g, '-');
        const periodLabel = getExportPeriodLabel();

        if (kind === 'daily') {
            const dates = getExportDateList();
            const eventSalesByDate = await loadEventSalesByDate(currentEvent, dates);
            const rows = buildDailyBreakdownCsvRows(data, isPackage, eventSalesByDate);
            downloadCsv(`daily-sales-breakdown-${eventKey}-${periodLabel}.csv`, rows);
        } else {
            const rows = buildTransactionsCsvRows(data, isPackage);
            if (rows.length <= 1) {
                alert('No transactions found for the selected period.');
                return;
            }
            downloadCsv(`sales-transactions-${eventKey}-${periodLabel}.csv`, rows);
        }
    } catch (error) {
        console.error('Failed to export CSV:', error);
        alert('Failed to export CSV. Please try again.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText || (kind === 'daily' ? 'Export Daily Breakdown CSV' : 'Export Transactions CSV');
        }
    }
}

function showLoadingState() {
    const ids = ['todaySales', 'todayOrders', 'todayCups', 'estProfit'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '...';
    });
    ['todayCupsNote', 'estProfitNote'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    });
}

function showErrorState() {
    const ordersEl = document.getElementById('recentOrdersList');
    const gridEl = document.getElementById('eventsGrid');
    const milkEl = document.getElementById('milkStats');
    const strengthEl = document.getElementById('strengthStats');
    const sugarEl = document.getElementById('sugarStats');
    const discountEl = document.getElementById('discountStats');
    const reportEl = document.getElementById('salesByItemReport');
    if (ordersEl) ordersEl.innerHTML = '<div class="error">Error loading orders</div>';
    if (gridEl) gridEl.innerHTML = '<div class="error">Error loading events data</div>';
    if (milkEl) milkEl.innerHTML = '<div class="error">Error loading</div>';
    if (strengthEl) strengthEl.innerHTML = '<div class="error">Error loading</div>';
    if (sugarEl) sugarEl.innerHTML = '<div class="error">Error loading</div>';
    if (discountEl) discountEl.innerHTML = '<div class="error">Error loading</div>';
    if (reportEl) reportEl.innerHTML = '<div class="error">Error loading report</div>';
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
                    createdAt: data.createdAt,
                    customMenu: data.customMenu || null
                };
                eventMenuByKey[data.key] = data.customMenu || null;
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
        const saved = { id: docRef.id, ...eventData };
        try {
            const mod = await import('../../shared/js/ops-events.js');
            const firestoreFns = { getDocs, collection, doc, setDoc, addDoc, updateDoc, deleteDoc };
            await mod.createOpsEventFromBranch(db, firestoreFns, saved, { createdBy: 'pos-dashboard' });
        } catch (err) {
            console.warn('opsEvents dual-write skipped:', err);
        }
        return saved;
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

        const activeEvents = sortEventsByRecency(events.filter(event => !event.archived));
        const archivedEvents = sortEventsByRecency(events.filter(event => event.archived));

        let html = '';

        // Active events
        if (activeEvents.length > 0) {
            html += '<div class="events-section"><h4>Active Events</h4>';
            html += activeEvents.map(event => `
        <div class="event-item">
            <div class="event-info">
                <strong>${escapeHtml(event.name)}</strong>
                <small>${event.serviceType === 'package' ? 'Package Service' : 'Pop-Up Service'} • Created: ${new Date(event.createdAt).toLocaleDateString()}</small>
                ${event.customMenu ? '<span class="custom-menu-indicator">Custom Menu</span>' : '<span class="default-menu-indicator">Default Menu</span>'}
            </div>
            <div class="event-actions">
                <button type="button" class="btn-menu" data-action="menu" data-event-id="${escapeHtml(event.id)}" data-event-name="${escapeHtml(event.name)}">Menu</button>
                <button type="button" class="btn-costs" data-action="costs" data-event-id="${escapeHtml(event.id)}" data-event-name="${escapeHtml(event.name)}">Costs</button>
                <button type="button" class="btn-edit" data-action="edit" data-event-id="${escapeHtml(event.id)}" data-event-name="${escapeHtml(event.name)}">Edit</button>
                <button type="button" class="btn-archive" data-action="archive" data-event-id="${escapeHtml(event.id)}" data-event-name="${escapeHtml(event.name)}">Archive</button>
                <button type="button" class="btn-delete" data-action="delete" data-event-id="${escapeHtml(event.id)}" data-event-name="${escapeHtml(event.name)}">Delete</button>
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
                        <strong>${escapeHtml(event.name)}</strong>
                        <small>${event.serviceType === 'package' ? 'Package Service' : 'Pop-Up Service'} • Archived</small>
                    </div>
                    <div class="event-actions">
                        <button type="button" class="btn-unarchive" data-action="unarchive" data-event-id="${escapeHtml(event.id)}" data-event-name="${escapeHtml(event.name)}">Unarchive</button>
                        <button type="button" class="btn-delete" data-action="delete" data-event-id="${escapeHtml(event.id)}" data-event-name="${escapeHtml(event.name)}">Delete</button>
                    </div>
                </div>
            `).join('');
            html += '</div>';
        }

        container.innerHTML = html;
        container.onclick = (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn || !container.contains(btn)) return;
            const { eventId, eventName } = btn.dataset;
            switch (btn.dataset.action) {
                case 'menu': window.manageEventMenu(eventId, eventName); break;
                case 'costs': window.manageEventCosts(eventId, eventName); break;
                case 'edit': window.editEvent(eventId, eventName); break;
                case 'archive': window.archiveEvent(eventId, eventName, true); break;
                case 'unarchive': window.archiveEvent(eventId, eventName, false); break;
                case 'delete': window.deleteEvent(eventId, eventName); break;
            }
        };
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
        const event = events.find(e => e.key === currentEvent && !e.archived)
            || events.find(e => e.key === currentEvent);
        return event ? event.serviceType || 'popup' : 'popup';
    } catch (error) {
        return 'popup';
    }
}

window.manageEventMenu = function (eventId, eventName) {
    showMenuManagementModal(eventId, eventName);
};

window.manageEventCosts = function (eventId, eventName) {
    showCostSettingsModal(eventId, eventName);
};

async function showCostSettingsModal(eventId, eventName) {
    const existingModal = document.querySelector('.cost-modal');
    if (existingModal) existingModal.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay cost-modal';

    const modal = document.createElement('div');
    modal.className = 'modal cost-settings-modal';
    modal.style.maxWidth = '640px';

    const header = document.createElement('h2');
    header.textContent = `Cost Settings — ${eventName}`;
    modal.appendChild(header);

    const content = document.createElement('div');
    content.innerHTML = '<div class="loading">Loading costs...</div>';
    modal.appendChild(content);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = 'Save Costs';
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let menuItems = [];
    let costSettings = emptyCostSettings();

    try {
        const eventRef = doc(db, 'branches', eventId);
        const eventDoc = await getDoc(eventRef);
        const data = eventDoc.exists() ? eventDoc.data() : {};
        const menuData = data.customMenu || getDefaultMenuData();
        menuItems = (menuData.items || []).map((item) => ({
            name: stripItemNameHtml(item.name),
            price: item.price,
            costFromMenu: typeof item.cost === 'number' ? item.cost : null
        }));
        costSettings = normalizeCostSettings(data.costSettings);
        // Seed from menu item.cost when settings blank
        for (const item of menuItems) {
            if (!Object.prototype.hasOwnProperty.call(costSettings.itemCosts, item.name)
                && item.costFromMenu != null) {
                costSettings.itemCosts[item.name] = item.costFromMenu;
            }
        }
        if (typeof menuData.oatUpgradeCost === 'number' && !data.costSettings?.oatUpgradeCost) {
            costSettings.oatUpgradeCost = menuData.oatUpgradeCost;
        }
        if (typeof menuData.natsuUpgradeCost === 'number' && !data.costSettings?.natsuUpgradeCost) {
            costSettings.natsuUpgradeCost = menuData.natsuUpgradeCost;
        }
        if (menuData.strengthLevelCosts && !data.costSettings?.strengthLevelCosts) {
            for (const level of ['1', '2', '3']) {
                const n = Number(menuData.strengthLevelCosts[level]);
                if (Number.isFinite(n)) costSettings.strengthLevelCosts[level] = n;
            }
        }
    } catch (err) {
        console.error(err);
        content.innerHTML = '<div class="error">Failed to load cost settings</div>';
        saveBtn.disabled = true;
        return;
    }

    content.innerHTML = `
        <p class="cost-settings-intro">Set unit cost (COGS) per drink and add-on. Used for Est. Profit on the dashboard.</p>
        <div class="cost-addons-grid">
            <label class="cost-field">
                <span>Oat milk add-on cost</span>
                <input type="number" id="costOatUpgrade" min="0" step="0.01" value="${costSettings.oatUpgradeCost}">
            </label>
            <label class="cost-field">
                <span>Natsu matcha add-on cost</span>
                <input type="number" id="costNatsuUpgrade" min="0" step="0.01" value="${costSettings.natsuUpgradeCost}">
            </label>
            <label class="cost-field">
                <span>Strength L1 cost</span>
                <input type="number" id="costStrength1" min="0" step="0.01" value="${costSettings.strengthLevelCosts['1'] || 0}">
            </label>
            <label class="cost-field">
                <span>Strength L2 cost</span>
                <input type="number" id="costStrength2" min="0" step="0.01" value="${costSettings.strengthLevelCosts['2'] || 0}">
            </label>
            <label class="cost-field">
                <span>Strength L3 cost</span>
                <input type="number" id="costStrength3" min="0" step="0.01" value="${costSettings.strengthLevelCosts['3'] || 0}">
            </label>
        </div>
        <h3 class="cost-drinks-heading">Drink costs</h3>
        <div class="cost-drinks-table-wrap">
            <table class="cost-drinks-table">
                <thead>
                    <tr>
                        <th>Drink</th>
                        <th class="align-right">Sell price</th>
                        <th class="align-right">Unit cost</th>
                    </tr>
                </thead>
                <tbody>
                    ${menuItems.map((item, idx) => `
                        <tr>
                            <td>${escapeHtml(item.name)}</td>
                            <td class="align-right">₱${Number(item.price || 0).toFixed(2)}</td>
                            <td class="align-right">
                                <input type="number" class="cost-item-input" data-item-index="${idx}"
                                    data-item-name="${escapeHtml(item.name)}"
                                    min="0" step="0.01"
                                    value="${costSettings.itemCosts[item.name] != null ? costSettings.itemCosts[item.name] : ''}"
                                    placeholder="0">
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        <div id="costSaveStatus" class="upload-status"></div>
    `;

    saveBtn.addEventListener('click', async () => {
        const status = document.getElementById('costSaveStatus');
        const next = emptyCostSettings();
        next.oatUpgradeCost = Math.max(0, parseFloat(document.getElementById('costOatUpgrade')?.value) || 0);
        next.natsuUpgradeCost = Math.max(0, parseFloat(document.getElementById('costNatsuUpgrade')?.value) || 0);
        next.strengthLevelCosts = {
            '1': Math.max(0, parseFloat(document.getElementById('costStrength1')?.value) || 0),
            '2': Math.max(0, parseFloat(document.getElementById('costStrength2')?.value) || 0),
            '3': Math.max(0, parseFloat(document.getElementById('costStrength3')?.value) || 0)
        };
        document.querySelectorAll('.cost-item-input').forEach((input) => {
            const name = input.dataset.itemName;
            if (!name) return;
            const raw = input.value.trim();
            if (raw === '') return;
            const n = parseFloat(raw);
            if (Number.isFinite(n) && n >= 0) next.itemCosts[name] = n;
        });

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        try {
            await updateDoc(doc(db, 'branches', eventId), {
                costSettings: next,
                lastModified: new Date().toISOString()
            });
            if (status) status.innerHTML = '<span style="color: green;">✓ Costs saved</span>';
            if (currentEvent) await loadDashboardData();
            setTimeout(() => overlay.remove(), 600);
        } catch (err) {
            console.error(err);
            if (status) status.innerHTML = '<span style="color: red;">✗ Failed to save</span>';
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Costs';
        }
    });
}

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
        const countsAsCup = category.countsAsCup === true;
        html += `
            <div class="category-preview">
                <h4>
                    ${category.name} (${categoryItems.length} items)
                    <label class="cup-tag-toggle">
                        <input type="checkbox" data-category-id="${category.id}" ${countsAsCup ? 'checked' : ''}>
                        Count as cups
                    </label>
                </h4>
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
    preview.querySelectorAll('.cup-tag-toggle input').forEach((input) => {
        input.addEventListener('change', () => {
            const category = menuData.categories.find((c) => c.id === input.dataset.categoryId);
            if (category) category.countsAsCup = input.checked;
        });
    });
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
    // Optional top-level keys for POS: oatUpgradePrice (number), defaultMilk ("oat"|"dairy"),
    // strengthLevelPrices (object "1","2","3" -> price),
    // matchaOptionPrices (object "aki","natsu" -> price).
    // Omit for defaults: oat +50, milk=dairy (or oat when oatUpgradePrice is 0), strength 1=0, 2=40, 3=80, natsu +30.
    return {
        categories: [
            { id: "matcha-lattes", name: "Matcha Lattes", countsAsCup: true },
            { id: "matcha-lite", name: "Matcha Lite", countsAsCup: true },
            { id: "specials", name: "Specials", countsAsCup: true },
            { id: "beyond-matcha", name: "Beyond Matcha", countsAsCup: true },
            { id: "desserts", name: "Desserts", countsAsCup: false }
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