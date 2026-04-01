// Import Firebase setup
import { db } from '../../admin-payroll/js/firebase-setup.js';
import { 
    collection, 
    getDocs, 
    getDoc,
    doc, 
    updateDoc, 
    setDoc, 
    deleteDoc,
    query, 
    orderBy,
    Timestamp 
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

let allRequests = [];
let currentFilter = 'pending';
let currentRequestTypeFilter = 'all';
let currentAdminId = 'admin'; // Will be set from auth
let selectedRequests = new Set(); // Track selected request IDs

// PayCalculator and dependencies for amount preview
let HOLIDAYS_2025 = {};
let holidaysLoaded = false;
let payCalculator = null;
let salesDataCache = null;

async function loadHolidays() {
    if (holidaysLoaded) return HOLIDAYS_2025;
    try {
        const holidayDoc = await getDoc(doc(db, "config", "holidays_2025"));
        if (holidayDoc.exists()) {
            HOLIDAYS_2025 = holidayDoc.data();
            holidaysLoaded = true;
        }
        return HOLIDAYS_2025;
    } catch (error) {
        console.error("Failed to load holidays:", error);
        return {};
    }
}

async function loadSalesData(branch = 'sm-north') {
    if (salesDataCache) return salesDataCache;
    try {
        const snapshot = await getDocs(collection(db, 'sales-data', branch, 'daily'));
        const salesData = {};
        snapshot.docs.forEach(d => {
            const data = d.data();
            if (data.totalSales || (data.cash || 0) + (data.gcash || 0) + (data.maya || 0) + (data.card || 0) + (data.grab || 0) > 0) {
                salesData[d.id] = data;
            }
        });
        salesDataCache = salesData;
        return salesData;
    } catch (error) {
        console.error("Error loading sales data:", error);
        return {};
    }
}

// Format timestamp to relative time
function formatRelativeTime(timestamp) {
    if (!timestamp) return 'Unknown';
    
    const now = new Date();
    const time = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return time.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Get user initials for avatar
function getInitials(name) {
    if (!name) return '?';
    const parts = name.split(' ');
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

// Format date for display
function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format time for display
function formatTime(timeStr) {
    if (!timeStr) return '--';
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

// Normalize time string by removing seconds and normalizing hour for comparison
// Ensures "10:34 AM" matches "10:34:09 AM", "9:45 AM" matches "09:45:02 AM"
function normalizeTimeForComparison(timeStr) {
    if (!timeStr || timeStr === '--' || timeStr === 'null') return '';
    let s = timeStr.trim();
    // Only remove seconds when present (HH:MM:SS AM/PM -> HH:MM AM/PM)
    const withSeconds = /^(\d{1,2}:\d{2}):\d{2}(\s*[AP]M)$/i;
    s = s.replace(withSeconds, '$1$2').trim() || s;
    // Normalize leading zero on hour so "09:45 AM" and "9:45 AM" compare equal
    s = s.replace(/^0(\d):/, '$1:');
    return s;
}

/** Returns a canonical 12h string (e.g. "9:45 AM") for comparison so seconds-only or 24h vs 12h do not count as change. */
function toComparableTimeString(value) {
    if (value == null || value === '' || value === '--') return '';
    let s;
    if (typeof value === 'object' && value && typeof value.toDate === 'function') {
        const d = value.toDate();
        const hours = d.getHours();
        const minutes = d.getMinutes();
        const meridian = hours >= 12 ? 'PM' : 'AM';
        let h12 = hours % 12;
        if (h12 === 0) h12 = 12;
        s = `${h12}:${String(minutes).padStart(2, '0')} ${meridian}`;
    } else if (typeof value === 'string') {
        s = value.trim();
        if (!s) return '';
        const hasMeridian = /[AP]M/i.test(s);
        if (hasMeridian) {
            s = s.replace(/^(\d{1,2}:\d{2}):\d{2}(\s*[AP]M)/i, '$1$2').trim();
            s = s.replace(/^0(\d):/, '$1:');
        } else {
            const match = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
            if (match) {
                const h = parseInt(match[1], 10);
                const m = match[2];
                s = time24to12(`${String(h).padStart(2, '0')}:${m}`);
                s = s.replace(/^0(\d):/, '$1:');
            }
        }
    } else {
        return '';
    }
    return s;
}

// Get payroll period for a given date
function getPayrollPeriodForDate(dateStr) {
    if (!dateStr) return 'N/A';
    
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Period 1: 13th to (end of month - 3)
    // Period 2: (end of prev month - 2) to 12th of next month
    const secondCutoffDay = daysInMonth - 3;
    
    if (day >= 13 && day <= secondCutoffDay) {
        // Late month period
        const periodEnd = new Date(year, month, secondCutoffDay);
        return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else if (day > secondCutoffDay || day <= 12) {
        // Early month period
        let periodStart, periodEnd;
        if (day > secondCutoffDay) {
            // Current month, second half
            periodStart = new Date(year, month, secondCutoffDay + 1);
            periodEnd = new Date(year, month + 1, 12);
        } else {
            // Current month, first half (1-12)
            const prevMonth = month === 0 ? 11 : month - 1;
            const prevYear = month === 0 ? year - 1 : year;
            const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
            const startDay = daysInPrevMonth === 31 ? 29 : 28;
            periodStart = new Date(prevYear, prevMonth, startDay);
            periodEnd = new Date(year, month, 12);
        }
        return `${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    
    return 'N/A';
}

/**
 * Compute current vs requested daily pay for a payroll request (for amount preview).
 * Returns { currentPay, requestedPay, diff } for edit requests, { requestedPay } for new_date, or { error }.
 */
async function getPayPreviewForRequest(request) {
    const isNewDate = request.type === 'new_date';
    const requestedData = request.requestedData || {};
    const currentData = request.currentData || {};

    try {
        const employeeSnap = await getDoc(doc(db, "employees", request.employeeId));
        if (!employeeSnap.exists()) {
            return { error: 'Employee or base rate not found' };
        }
        const empData = employeeSnap.data();
        const baseRate = empData.baseRate ?? empData.base_rate ?? empData.dailyRate ?? empData.daily_rate ?? 0;
        if (!baseRate || baseRate <= 0) {
            return { error: 'Employee or base rate not found' };
        }

        const employee = {
            id: request.employeeId,
            baseRate: baseRate,
            salesBonusEligible: empData.salesBonusEligible ?? empData.sales_bonus_eligible ?? empData.salesBonus ?? false
        };

        await loadHolidays();
        if (employee.salesBonusEligible) {
            await loadSalesData('sm-north');
        }
        if (!payCalculator) {
            payCalculator = new window.PayCalculator(HOLIDAYS_2025, salesDataCache || {});
        }

        const requestedDate = requestedData.date || request.date;
        const requestedEntry = {
            date: requestedDate,
            timeIn: requestedData.timeIn ?? null,
            timeOut: requestedData.timeOut ?? null,
            branch: requestedData.branch ?? 'Podium',
            shift: requestedData.shift ?? 'Opening',
            hasOTPay: !!request.requestOT
        };
        if (!requestedEntry.timeIn || !requestedEntry.timeOut) {
            return { error: 'Amount preview unavailable' };
        }

        const requestedResult = payCalculator.calculateDailyPay(requestedEntry, employee, 'detailed');
        const requestedPay = (requestedResult && typeof requestedResult === 'object' && 'total' in requestedResult)
            ? requestedResult.total : (typeof requestedResult === 'number' ? requestedResult : 0);

        if (isNewDate) {
            return { requestedPay };
        }

        let currentHasOTPay = false;
        const currentDate = currentData.date || request.date;
        try {
            const attendanceRef = doc(db, "attendance", request.employeeId, "dates", currentDate);
            const attendanceSnap = await getDoc(attendanceRef);
            if (attendanceSnap.exists()) {
                currentHasOTPay = !!attendanceSnap.data().hasOTPay;
            }
        } catch (_) {}

        const currentEntry = {
            date: currentDate,
            timeIn: currentData.timeIn ?? null,
            timeOut: currentData.timeOut ?? null,
            branch: currentData.branch ?? 'Podium',
            shift: currentData.shift ?? 'Opening',
            hasOTPay: currentHasOTPay
        };
        if (!currentEntry.timeIn || !currentEntry.timeOut) {
            return { error: 'Amount preview unavailable' };
        }

        const currentResult = payCalculator.calculateDailyPay(currentEntry, employee, 'detailed');
        const currentPay = (currentResult && typeof currentResult === 'object' && 'total' in currentResult)
            ? currentResult.total : (typeof currentResult === 'number' ? currentResult : 0);
        const diff = requestedPay - currentPay;

        return { currentPay, requestedPay, diff };
    } catch (err) {
        console.error('Pay preview error:', err);
        return { error: 'Amount preview unavailable' };
    }
}

// Show confirmation modal
function showConfirmModal(title, message, okText, okClass, onConfirm, hideCancel = false) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    
    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) return Promise.resolve(false);
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = okText;
    okBtn.className = `modal-btn ${okClass || 'modal-btn-approve'}`;
    
    // Hide cancel button for success/error messages
    if (hideCancel) {
        cancelBtn.style.display = 'none';
    } else {
        cancelBtn.style.display = 'block';
    }
    
    modal.classList.add('show');
    
    return new Promise((resolve) => {
        const handleOk = () => {
            cleanup();
            resolve(true);
            if (onConfirm) onConfirm();
        };
        
        const handleCancel = () => {
            cleanup();
            resolve(false);
        };
        
        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            modal.removeEventListener('click', handleOutsideClick);
            modal.classList.remove('show');
            cancelBtn.style.display = 'block'; // Reset for next use
        };
        
        const handleOutsideClick = (e) => {
            if (e.target === modal && !hideCancel) {
                handleCancel();
            }
        };
        
        okBtn.addEventListener('click', handleOk);
        if (!hideCancel) {
            cancelBtn.addEventListener('click', handleCancel);
        }
        modal.addEventListener('click', handleOutsideClick);
    });
}

// Fetch all requests (payroll + substitution)
async function fetchRequests() {
    try {
        const payrollRef = collection(db, "payroll_requests");
        const payrollQ = query(payrollRef, orderBy("requestedAt", "desc"));
        const payrollSnap = await getDocs(payrollQ);

        const substitutionRef = collection(db, "substitution_requests");
        const substitutionSnap = await getDocs(substitutionRef);

        const payroll = [];
        payrollSnap.forEach(d => {
            payroll.push({ id: d.id, ...d.data(), _sourceCollection: "payroll_requests" });
        });
        const substitution = [];
        substitutionSnap.forEach(d => {
            const data = d.data();
            substitution.push({
                id: d.id,
                ...data,
                type: data.type || "substitution",
                _sourceCollection: "substitution_requests"
            });
        });

        allRequests = [...payroll, ...substitution].sort((a, b) => {
            const ta = a.requestedAt?.toMillis?.() ?? (a.requestedAt ? new Date(a.requestedAt).getTime() : 0);
            const tb = b.requestedAt?.toMillis?.() ?? (b.requestedAt ? new Date(b.requestedAt).getTime() : 0);
            return tb - ta;
        });

        renderRequests();
    } catch (error) {
        console.error("Error fetching requests:", error);
        showError("Failed to load requests. Please try again.");
    }
}

/** Returns { label, cssClass } for request type badge (Schedule Reliever, New Date, Overtime, Change Time In/Out). */
function getRequestTypeLabel(request) {
    const isSubstitution = request.type === 'substitution' || request._sourceCollection === 'substitution_requests';
    if (isSubstitution) {
        return { label: 'Schedule Reliever', cssClass: 'request-type-reliever' };
    }
    if (request.type === 'new_date') {
        return {
            label: request.requestOT ? 'New Date + Overtime' : 'New Date',
            cssClass: 'request-type-payroll'
        };
    }
    const hasTimeChange = request.currentData && request.requestedData && (
        toComparableTimeString(request.currentData?.timeIn) !== toComparableTimeString(request.requestedData?.timeIn) ||
        toComparableTimeString(request.currentData?.timeOut) !== toComparableTimeString(request.requestedData?.timeOut)
    );
    const currentDate = request.currentData?.date || request.date;
    const requestedDate = request.requestedData?.date || request.date;
    const hasDateChange = currentDate !== requestedDate;
    const hasBranchChange = (request.currentData?.branch || '') !== (request.requestedData?.branch || '');
    const hasShiftChange = (request.currentData?.shift || '') !== (request.requestedData?.shift || '');
    const hasEdit = hasTimeChange || hasDateChange || hasBranchChange || hasShiftChange;
    if (hasEdit) {
        return { label: 'Change Time In/Out', cssClass: 'request-type-payroll' };
    }
    if (request.requestOT) {
        return { label: 'Overtime', cssClass: 'request-type-payroll' };
    }
    return { label: 'Payroll', cssClass: 'request-type-payroll' };
}

// Render requests based on current filter
function renderRequests() {
    const container = document.getElementById('requestsContainer');
    if (!container) return;

    let filtered = allRequests;
    if (currentRequestTypeFilter === 'payroll') {
        filtered = filtered.filter(r => r._sourceCollection === 'payroll_requests');
    } else if (currentRequestTypeFilter === 'reliever') {
        filtered = filtered.filter(r => r._sourceCollection === 'substitution_requests');
    }
    const filteredRequests = currentFilter === 'all'
        ? filtered
        : filtered.filter(r => r.status === currentFilter);
    
    if (filteredRequests.length === 0) {
        const statusWord = currentFilter === 'all' ? '' : currentFilter;
        const typeWord = currentRequestTypeFilter === 'all' ? '' : currentRequestTypeFilter;
        const parts = [typeWord, statusWord].filter(Boolean);
        const label = parts.length ? parts.join(' ') + ' requests' : 'requests';
        const subtext = (currentFilter !== 'all' || currentRequestTypeFilter !== 'all')
            ? 'Try changing the type or status filter to see other requests.'
            : 'Requests will appear here when employees submit them.';
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-text">No ${label} found</div>
                <div class="empty-state-subtext">${subtext}</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = filteredRequests.map(request => {
        const initials = getInitials(request.employeeName);
        const timeAgo = formatRelativeTime(request.requestedAt);
        const statusClass = `request-status-${request.status}`;
        const typeInfo = getRequestTypeLabel(request);
        const typeBadge = `<span class="request-type-badge ${typeInfo.cssClass}">${typeInfo.label}</span>`;
        const isSubstitution = request.type === 'substitution' || request._sourceCollection === 'substitution_requests';

        // Build preview text - only show fields that actually changed
        let previewText = '';
        let dateDisplay = '';

        if (isSubstitution) {
            dateDisplay = `<div class="request-preview-item"><span class="request-preview-label">Date:</span><span class="request-preview-value">${formatDate(request.date)}</span></div>`;
            const branchLabel = (request.branch || '').charAt(0).toUpperCase() + (request.branch || '').slice(1);
            const shiftLabel = ((request.shiftType || '') + '').replace(/^./, c => c.toUpperCase());
            previewText = `
                <div class="request-preview-item">
                    <span class="request-preview-label">Shift:</span>
                    <span class="request-preview-value">${branchLabel} ${shiftLabel}</span>
                </div>
                <div class="request-preview-item">
                    <span class="request-preview-value">${request.employeeName || 'Unknown'} → ${request.requestedRelieverName || 'Unknown'}</span>
                </div>
            `;
        } else if (request.type === "new_date") {
            previewText = '';
            const requestedTimeIn = formatTime(request.requestedData?.timeIn);
            const requestedTimeOut = formatTime(request.requestedData?.timeOut);
            if (requestedTimeIn !== '--' && requestedTimeOut !== '--') {
                previewText += `
                    <div class="request-preview-item">
                        <span class="request-preview-label">Time:</span>
                        <span class="request-preview-value">${requestedTimeIn} - ${requestedTimeOut}</span>
                    </div>
                `;
            }
            if (request.requestedData?.branch) {
                previewText += `
                    <div class="request-preview-item">
                        <span class="request-preview-label">Branch:</span>
                        <span class="request-preview-value">${request.requestedData.branch}</span>
                    </div>
                `;
            }
            if (request.requestedData?.shift) {
                previewText += `
                    <div class="request-preview-item">
                        <span class="request-preview-label">Shift:</span>
                        <span class="request-preview-value">${request.requestedData.shift}</span>
                    </div>
                `;
            }
        } else {
            // Check for time in change (use comparable strings so seconds/format don't count)
            const currentTimeIn = formatTime(request.currentData?.timeIn);
            const requestedTimeIn = formatTime(request.requestedData?.timeIn);
            const comparableCurrentTimeIn = toComparableTimeString(request.currentData?.timeIn);
            const comparableRequestedTimeIn = toComparableTimeString(request.requestedData?.timeIn);
            if (comparableCurrentTimeIn !== comparableRequestedTimeIn && comparableCurrentTimeIn !== '' && comparableRequestedTimeIn !== '') {
                previewText += `
                    <div class="request-preview-item">
                        <span class="request-preview-label">Time In:</span>
                        <span class="request-preview-value">${currentTimeIn} → ${requestedTimeIn}</span>
                    </div>
                `;
            }
            
            // Check for time out change (use comparable strings so seconds/format don't count)
            const currentTimeOut = formatTime(request.currentData?.timeOut);
            const requestedTimeOut = formatTime(request.requestedData?.timeOut);
            const comparableCurrentTimeOut = toComparableTimeString(request.currentData?.timeOut);
            const comparableRequestedTimeOut = toComparableTimeString(request.requestedData?.timeOut);
            if (comparableCurrentTimeOut !== comparableRequestedTimeOut && comparableCurrentTimeOut !== '' && comparableRequestedTimeOut !== '') {
                previewText += `
                    <div class="request-preview-item">
                        <span class="request-preview-label">Time Out:</span>
                        <span class="request-preview-value">${currentTimeOut} → ${requestedTimeOut}</span>
                    </div>
                `;
            }
            
            // Check for branch change
            const currentBranch = request.currentData?.branch || '--';
            const requestedBranch = request.requestedData?.branch || '--';
            if (currentBranch !== requestedBranch && currentBranch !== '--' && requestedBranch !== '--') {
                previewText += `
                    <div class="request-preview-item">
                        <span class="request-preview-label">Branch:</span>
                        <span class="request-preview-value">${currentBranch} → ${requestedBranch}</span>
                    </div>
                `;
            }
            
            // Check for shift change
            const currentShift = request.currentData?.shift || '--';
            const requestedShift = request.requestedData?.shift || '--';
            if (currentShift !== requestedShift && currentShift !== '--' && requestedShift !== '--') {
                previewText += `
                    <div class="request-preview-item">
                        <span class="request-preview-label">Shift:</span>
                        <span class="request-preview-value">${currentShift} → ${requestedShift}</span>
                    </div>
                `;
            }
        }
        
        // Capitalize status
        const statusText = request.status.charAt(0).toUpperCase() + request.status.slice(1);

        // Build date display (for payroll; substitution already set above)
        if (!isSubstitution) {
            if (request.type === "new_date") {
                dateDisplay = `<div class="request-preview-item"><span class="request-preview-label">Date:</span><span class="request-preview-value">${formatDate(request.date)}</span></div>`;
            } else {
                const currentDate = request.currentData?.date || request.date;
                const requestedDate = request.requestedData?.date || request.date;
                dateDisplay = currentDate !== requestedDate
                    ? `<div class="request-preview-item">
                    <span class="request-preview-label">Date:</span>
                    <span class="request-preview-value">${formatDate(currentDate)} → ${formatDate(requestedDate)}</span>
                   </div>`
                    : `<div class="request-preview-item">
                    <span class="request-preview-label">Date:</span>
                    <span class="request-preview-value">${formatDate(request.date)}</span>
                   </div>`;
            }
        }
        
        // Add quick action buttons for pending requests (desktop - icon only)
        const quickActionsDesktop = request.status === 'pending' ? `
            <div class="quick-actions" onclick="event.stopPropagation(); event.preventDefault();">
                <button class="quick-action-btn quick-action-approve" onclick="event.stopPropagation(); event.preventDefault(); quickApproveRequest('${request.id}'); return false;" title="Approve">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </button>
                <button class="quick-action-btn quick-action-reject" onclick="event.stopPropagation(); event.preventDefault(); quickRejectRequest('${request.id}'); return false;" title="Reject">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        ` : '';
        
        // Add quick action buttons for pending requests (mobile - full buttons)
        const quickActionsMobile = request.status === 'pending' ? `
            <button class="quick-action-btn quick-action-approve" onclick="event.stopPropagation(); event.preventDefault(); quickApproveRequest('${request.id}'); return false;" title="Approve">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>Approve</span>
            </button>
            <button class="quick-action-btn quick-action-reject" onclick="event.stopPropagation(); event.preventDefault(); quickRejectRequest('${request.id}'); return false;" title="Reject">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                <span>Reject</span>
            </button>
        ` : '';
        
        // Add checkbox for pending requests
        const checkboxHtml = request.status === 'pending' ? `
            <label class="request-checkbox" onclick="event.stopPropagation();">
                <input type="checkbox" class="request-select-checkbox" data-request-id="${request.id}" 
                       ${selectedRequests.has(request.id) ? 'checked' : ''} 
                       onclick="event.stopPropagation();"
                       onchange="handleRequestSelect('${request.id}', this.checked)">
            </label>
        ` : '';
        
        return `
            <div class="request-item ${request.status === 'pending' ? 'unread' : ''}" data-request-id="${request.id}">
                <div class="request-item-top">
                    ${checkboxHtml}
                    <div class="request-avatar">${initials}</div>
                    <div class="request-content">
                        <div class="request-header">
                            <div class="request-header-left">
                                <span class="request-name">${request.employeeName || 'Unknown'}</span>
                                <span class="request-date">${timeAgo}</span>
                            </div>
                            ${typeBadge}
                        </div>
                        <div class="request-preview">
                            ${dateDisplay}
                            ${previewText || ''}
                        </div>
                    </div>
                    <div class="request-actions">
                        ${quickActionsDesktop}
                        <span class="request-status ${statusClass}">${statusText}</span>
                    </div>
                </div>
                ${request.status === 'pending' ? `
                <div class="request-actions-bottom">
                    ${quickActionsMobile}
                </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    // Add click handlers
    container.querySelectorAll('.request-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't open modal if clicking on checkbox, quick action buttons or actions area
            if (e.target.closest('.request-checkbox') ||
                e.target.closest('.request-select-checkbox') ||
                e.target.closest('.request-actions-bottom') || 
                e.target.closest('.quick-action-btn') || 
                e.target.closest('.request-status')) {
                return;
            }
            const requestId = item.dataset.requestId;
            const request = allRequests.find(r => r.id === requestId);
            if (request) {
                openRequestDetail(request);
            }
        });
    });
    
    // Show/hide bulk actions header and update UI
    updateBulkActionsUI();
}

// Open request detail modal
async function openRequestDetail(request) {
    const modal = document.getElementById('requestDetailModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    const modalActions = document.getElementById('modalActions');

    if (!modal || !modalTitle || !modalContent || !modalActions) return;

    const isSubstitution = request.type === 'substitution' || request._sourceCollection === 'substitution_requests';
    if (isSubstitution) {
        modalTitle.textContent = `Reliever request from ${request.employeeName}`;
        const branchLabel = ((request.branch || '') + '').replace(/^./, c => c.toUpperCase());
        const shiftLabel = ((request.shiftType || '') + '').replace(/^./, c => c.toUpperCase());
        const statusText = (request.status || '').charAt(0).toUpperCase() + (request.status || '').slice(1);
        const content = `
            <div class="request-detail-section">
                <h3>Shift Details</h3>
                <div class="request-detail-row">
                    <div>
                        <div class="request-detail-label">Date</div>
                        <div class="request-detail-value">${formatDate(request.date)}</div>
                    </div>
                    <div>
                        <div class="request-detail-label">Branch</div>
                        <div class="request-detail-value">${branchLabel || '--'}</div>
                    </div>
                </div>
                <div class="request-detail-row">
                    <div>
                        <div class="request-detail-label">Shift type</div>
                        <div class="request-detail-value">${shiftLabel || '--'}</div>
                    </div>
                    <div>
                        <div class="request-detail-label">Status</div>
                        <div class="request-detail-value">${statusText}</div>
                    </div>
                </div>
                <div class="request-detail-row">
                    <div>
                        <div class="request-detail-label">Requester</div>
                        <div class="request-detail-value">${request.employeeName || 'Unknown'}</div>
                    </div>
                    <div>
                        <div class="request-detail-label">Requested reliever</div>
                        <div class="request-detail-value">${request.requestedRelieverName || 'Unknown'}</div>
                    </div>
                </div>
                <div class="request-detail-row">
                    <div>
                        <div class="request-detail-label">Requested</div>
                        <div class="request-detail-value">${formatRelativeTime(request.requestedAt)}</div>
                    </div>
                </div>
            </div>
        `;
        modalContent.innerHTML = content;
        let actionsHtml = '';
        if (request.status === 'pending') {
            actionsHtml = `
                <button class="modal-btn modal-btn-approve modal-btn-primary" onclick="approveRequest('${request.id}')">Approve</button>
                <div class="modal-actions-row">
                    <button class="modal-btn modal-btn-reject" onclick="rejectRequest('${request.id}')">Reject</button>
                </div>
            `;
        } else {
            actionsHtml = `
                <div class="request-detail-row">
                    <div>
                        <div class="request-detail-label">Reviewed</div>
                        <div class="request-detail-value">${request.reviewedAt ? formatRelativeTime(request.reviewedAt) : 'N/A'}</div>
                    </div>
                    <div>
                        <div class="request-detail-label">Reviewed By</div>
                        <div class="request-detail-value">${request.reviewedBy || 'N/A'}</div>
                    </div>
                </div>
            `;
        }
        modalActions.innerHTML = actionsHtml;
        modal.classList.add('show');
        return;
    }

    modalTitle.textContent = `Request from ${request.employeeName}`;

    // Handle new date requests differently
    const isNewDateRequest = request.type === "new_date";
    
    // Get dates for comparison
    const currentDate = request.currentData?.date || request.date;
    const requestedDate = request.requestedData?.date || request.date;
    const dateChanged = currentDate !== requestedDate;
    
    // For shift details, use requested date for new date requests, otherwise use current date
    const shiftDetailsDate = isNewDateRequest ? requestedDate : currentDate;
    
    // Get payroll period for the CURRENT date (original date)
    const payrollPeriod = getPayrollPeriodForDate(shiftDetailsDate);
    
    // Capitalize status
    const statusText = request.status.charAt(0).toUpperCase() + request.status.slice(1);
    
    // Get branch and shift
    let branch = '--';
    let shift = '--';
    let currentHasOTPay = false;
    
    if (isNewDateRequest) {
        // For new date requests, use requested data
        branch = request.requestedData?.branch || '--';
        shift = request.requestedData?.shift || '--';
    } else {
        // For edit requests, get from currentData or fetch from attendance
        branch = request.currentData?.branch || '--';
        shift = request.currentData?.shift || '--';
        
        // Fetch current attendance data to check if OT is already applied
        try {
            const attendanceRef = doc(db, "attendance", request.employeeId, "dates", currentDate);
            const attendanceSnap = await getDoc(attendanceRef);
            if (attendanceSnap.exists()) {
                const attendanceData = attendanceSnap.data();
                currentHasOTPay = attendanceData.hasOTPay || false;
                // Update branch and shift if not in currentData
                if (!branch || branch === '--') {
                    branch = attendanceData.clockIn?.branch || '--';
                }
                if (!shift || shift === '--') {
                    shift = attendanceData.clockIn?.shift || '--';
                }
            }
        } catch (error) {
            console.error("Error fetching attendance data:", error);
        }
    }
    
    // Build Shift Details section - always show CURRENT date info (omit Employee; title already has name)
    let content = `
        <div class="request-detail-section">
            <h3>Shift Details</h3>
            <div class="request-detail-row">
                <div>
                    <div class="request-detail-label">Date</div>
                    <div class="request-detail-value">${formatDate(shiftDetailsDate)}</div>
                </div>
                <div>
                    <div class="request-detail-label">Payroll Period</div>
                    <div class="request-detail-value">${payrollPeriod}</div>
                </div>
            </div>
            <div class="request-detail-row">
                <div>
                    <div class="request-detail-label">Branch</div>
                    <div class="request-detail-value">${branch}</div>
                </div>
                <div>
                    <div class="request-detail-label">Shift</div>
                    <div class="request-detail-value">${shift}</div>
                </div>
            </div>
            <div class="request-detail-row">
                <div>
                    <div class="request-detail-label">Status</div>
                    <div class="request-detail-value">${statusText}</div>
                </div>
            </div>
        </div>
    `;
    
    // Build Request Details section
    let requestDetailsContent = '<div class="request-detail-section"><h3>Request Details</h3>';
    
    // Add requested timestamp
    requestDetailsContent += `
        <div class="request-detail-row">
            <div>
                <div class="request-detail-label">Requested</div>
                <div class="request-detail-value">${formatRelativeTime(request.requestedAt)}</div>
            </div>
        </div>
    `;
    
    if (isNewDateRequest) {
        // For new date requests, show all requested data
        const requestedTimeIn = formatTime(request.requestedData?.timeIn || '--');
        const requestedTimeOut = formatTime(request.requestedData?.timeOut || '--');
        
        requestDetailsContent += `
            <div class="request-detail-row">
                <div>
                    <div class="request-detail-label">Time In</div>
                    <div class="request-detail-value">${requestedTimeIn}</div>
                </div>
                <div>
                    <div class="request-detail-label">Time Out</div>
                    <div class="request-detail-value">${requestedTimeOut}</div>
                </div>
            </div>
        `;
        
        if (request.requestOT) {
            requestDetailsContent += `
                <div class="request-detail-row">
                    <div>
                        <div class="request-detail-label">Overtime Pay</div>
                        <div class="request-detail-value changed">Requested</div>
                    </div>
                </div>
            `;
        }
        } else {
            // For edit requests, show changes
            const currentTimeIn = formatTime(request.currentData?.timeIn || '--');
            const requestedTimeIn = formatTime(request.requestedData?.timeIn || '--');
            const currentTimeOut = formatTime(request.currentData?.timeOut || '--');
            const requestedTimeOut = formatTime(request.requestedData?.timeOut || '--');
            
            // Use comparable strings so seconds-only or 24h vs 12h format don't count as change
            const comparableCurrentTimeIn = toComparableTimeString(request.currentData?.timeIn);
            const comparableRequestedTimeIn = toComparableTimeString(request.requestedData?.timeIn);
            const comparableCurrentTimeOut = toComparableTimeString(request.currentData?.timeOut);
            const comparableRequestedTimeOut = toComparableTimeString(request.requestedData?.timeOut);
            
            let hasChanges = false;
            
            // Date change
            if (currentDate !== requestedDate) {
                hasChanges = true;
                requestDetailsContent += `
                    <div class="request-detail-row">
                        <div>
                            <div class="request-detail-label">Current Date</div>
                            <div class="request-detail-value">${formatDate(currentDate)}</div>
                        </div>
                        <div>
                            <div class="request-detail-label">Requested Date</div>
                            <div class="request-detail-value changed">${formatDate(requestedDate)}</div>
                        </div>
                    </div>
                `;
            }
            
            // Time In change (only show if times actually differ after canonical comparison)
            if (comparableCurrentTimeIn !== comparableRequestedTimeIn && comparableCurrentTimeIn !== '' && comparableRequestedTimeIn !== '') {
                hasChanges = true;
                requestDetailsContent += `
                    <div class="request-detail-row">
                        <div>
                            <div class="request-detail-label">Current Time In</div>
                            <div class="request-detail-value">${currentTimeIn}</div>
                        </div>
                        <div>
                            <div class="request-detail-label">Requested Time In</div>
                            <div class="request-detail-value changed">${requestedTimeIn}</div>
                        </div>
                    </div>
                `;
            }
            
            // Time Out change (only show if times actually differ after canonical comparison)
            if (comparableCurrentTimeOut !== comparableRequestedTimeOut && comparableCurrentTimeOut !== '' && comparableRequestedTimeOut !== '') {
                hasChanges = true;
                requestDetailsContent += `
                    <div class="request-detail-row">
                        <div>
                            <div class="request-detail-label">Current Time Out</div>
                            <div class="request-detail-value">${currentTimeOut}</div>
                        </div>
                        <div>
                            <div class="request-detail-label">Requested Time Out</div>
                            <div class="request-detail-value changed">${requestedTimeOut}</div>
                        </div>
                    </div>
                `;
            }
        
        // Branch change
        const currentBranch = request.currentData?.branch || '--';
        const requestedBranch = request.requestedData?.branch || '--';
        if (currentBranch !== requestedBranch && currentBranch !== '--' && requestedBranch !== '--') {
            hasChanges = true;
            requestDetailsContent += `
                <div class="request-detail-row">
                    <div>
                        <div class="request-detail-label">Current Branch</div>
                        <div class="request-detail-value">${currentBranch}</div>
                    </div>
                    <div>
                        <div class="request-detail-label">Requested Branch</div>
                        <div class="request-detail-value changed">${requestedBranch}</div>
                    </div>
                </div>
            `;
        }
        
        // Shift change
        const currentShift = request.currentData?.shift || '--';
        const requestedShift = request.requestedData?.shift || '--';
        if (currentShift !== requestedShift && currentShift !== '--' && requestedShift !== '--') {
            hasChanges = true;
            requestDetailsContent += `
                <div class="request-detail-row">
                    <div>
                        <div class="request-detail-label">Current Shift</div>
                        <div class="request-detail-value">${currentShift}</div>
                    </div>
                    <div>
                        <div class="request-detail-label">Requested Shift</div>
                        <div class="request-detail-value changed">${requestedShift}</div>
                    </div>
                </div>
            `;
        }
        
        // OT request - only show if not already applied
        if (request.requestOT && !currentHasOTPay) {
            hasChanges = true;
            requestDetailsContent += `
                <div class="request-detail-row">
                    <div>
                        <div class="request-detail-label">Overtime Pay</div>
                        <div class="request-detail-value changed">Requested</div>
                    </div>
                </div>
            `;
        }
    }
    
    requestDetailsContent += '</div>';
    content += requestDetailsContent;
    
    // Amount preview (payroll requests only) - fill async
    content += `
        <div class="request-detail-section amount-preview-section">
            <h3>Amount preview</h3>
            <div id="amountPreviewContent" class="amount-preview-content">Calculating…</div>
        </div>
    `;
    
    if (request.reason) {
        content += `
            <div class="request-detail-section">
                <h3>Reason</h3>
                <div class="request-detail-value">${request.reason}</div>
            </div>
        `;
    }
    
    modalContent.innerHTML = content;
    
    // Load amount preview async
    (async () => {
        const previewEl = document.getElementById('amountPreviewContent');
        if (!previewEl) return;
        const result = await getPayPreviewForRequest(request);
        if (!previewEl.parentElement) return;
        if (result.error) {
            previewEl.textContent = result.error;
            previewEl.classList.add('amount-preview-unavailable');
            return;
        }
        previewEl.classList.remove('amount-preview-unavailable');
        const fmt = (n) => (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (request.type === 'new_date') {
            previewEl.innerHTML = `After approval: <strong class="amount-preview-value">₱${fmt(result.requestedPay)}</strong>`;
        } else {
            const diff = result.diff ?? 0;
            const diffStr = diff >= 0 ? `+₱${fmt(diff)}` : `-₱${fmt(-diff)}`;
            const diffClass = diff >= 0 ? 'amount-preview-diff-positive' : 'amount-preview-diff-negative';
            previewEl.innerHTML = `Current: <strong>₱${fmt(result.currentPay)}</strong> → After: <strong class="amount-preview-value">₱${fmt(result.requestedPay)}</strong> <span class="amount-preview-diff ${diffClass}">(${diffStr})</span>`;
        }
    })();
    
    // Build action buttons
    let actionsHtml = '';
    if (request.status === 'pending') {
        actionsHtml = `
            <button class="modal-btn modal-btn-approve modal-btn-primary" onclick="approveRequest('${request.id}')">Approve</button>
            <div class="modal-actions-row">
                <button class="modal-btn modal-btn-edit" onclick="openEditModal('${request.id}')">Edit & Approve</button>
                <button class="modal-btn modal-btn-reject" onclick="rejectRequest('${request.id}')">Reject</button>
            </div>
        `;
    } else {
        actionsHtml = `
            <div class="request-detail-row">
                <div>
                    <div class="request-detail-label">Reviewed</div>
                    <div class="request-detail-value">${request.reviewedAt ? formatRelativeTime(request.reviewedAt) : 'N/A'}</div>
                </div>
                <div>
                    <div class="request-detail-label">Reviewed By</div>
                    <div class="request-detail-value">${request.reviewedBy || 'N/A'}</div>
                </div>
            </div>
        `;
    }

    modalActions.innerHTML = actionsHtml;
    
    modal.classList.add('show');
}

// Close modal
function closeModal() {
    const modal = document.getElementById('requestDetailModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

// Internal function to approve request (without confirmation modal)
async function _approveRequest(requestId) {
    try {
        const request = allRequests.find(r => r.id === requestId);
        if (!request) {
            await showConfirmModal(
                'Error',
                'Request not found',
                'OK',
                'modal-btn-approve',
                null,
                true // Hide cancel button
            );
            return false;
        }

        const sourceCollection = request._sourceCollection || 'payroll_requests';
        const requestRef = doc(db, sourceCollection, requestId);

        if (sourceCollection === 'substitution_requests') {
            const shiftRef = doc(db, 'schedules', request.weekKey, 'shifts', request.scheduleShiftId);
            const shiftSnap = await getDoc(shiftRef);
            if (!shiftSnap.exists()) {
                await showConfirmModal(
                    'Error',
                    'Shift no longer exists. It may have been removed.',
                    'OK',
                    'modal-btn-approve',
                    null,
                    true
                );
                return false;
            }
            const shiftData = shiftSnap.data();
            if (shiftData.employeeId !== request.employeeId) {
                await showConfirmModal(
                    'Error',
                    'Shift has already been reassigned. Cannot approve.',
                    'OK',
                    'modal-btn-approve',
                    null,
                    true
                );
                return false;
            }
            await updateDoc(shiftRef, { employeeId: request.requestedRelieverId });
            await updateDoc(requestRef, {
                status: 'approved',
                reviewedAt: Timestamp.now(),
                reviewedBy: currentAdminId
            });
            selectedRequests.delete(requestId);
            const modal = document.getElementById('requestDetailModal');
            if (modal && modal.classList.contains('show')) {
                closeModal();
            }
            await showConfirmModal(
                'Success',
                'Reliever request approved. The shift has been reassigned.',
                'OK',
                'modal-btn-approve',
                null,
                true
            );
            await fetchRequests();
            return true;
        }

        await updateDoc(requestRef, {
            status: 'approved',
            reviewedAt: Timestamp.now(),
            reviewedBy: currentAdminId
        });

        // Get current and requested dates
        const currentDate = request.currentData?.date || request.date;
        const requestedDate = request.requestedData?.date || request.date;
        const dateChanged = currentDate !== requestedDate;

        // Get requested branch and shift
        const requestedBranch = request.requestedData?.branch || request.currentData?.branch || null;
        const requestedShift = request.requestedData?.shift || request.currentData?.shift || null;

        // Handle new date requests (type === "new_date")
        if (request.type === "new_date") {
            // Create new date entry
            const newAttendanceRef = doc(db, "attendance", request.employeeId, "dates", requestedDate);
            const attendanceData = {
                clockIn: {
                    time: request.requestedData.timeIn,
                    branch: requestedBranch,
                    shift: requestedShift
                },
                clockOut: {
                    time: request.requestedData.timeOut
                }
            };
            
            // Add OT if requested
            if (request.requestOT) {
                attendanceData.hasOTPay = true;
            }
            
            await setDoc(newAttendanceRef, attendanceData);
        } else if (dateChanged) {
            // If date changed, delete old date and create new one
            // Get old attendance data to preserve OT if it existed
            // First check currentData.hasOTPay (from request), then check actual attendance data
            let oldHasOTPay = request.currentData?.hasOTPay || false;
            if (!oldHasOTPay) {
                try {
                    const oldAttendanceRef = doc(db, "attendance", request.employeeId, "dates", currentDate);
                    const oldAttendanceSnap = await getDoc(oldAttendanceRef);
                    if (oldAttendanceSnap.exists()) {
                        oldHasOTPay = oldAttendanceSnap.data().hasOTPay || false;
                    }
                } catch (error) {
                    console.error("Error fetching old attendance data:", error);
                }
            }
            
            // Delete old date entry
            const oldAttendanceRef = doc(db, "attendance", request.employeeId, "dates", currentDate);
            await deleteDoc(oldAttendanceRef);
            
            // Create new date entry with requested data
            const newAttendanceRef = doc(db, "attendance", request.employeeId, "dates", requestedDate);
            const attendanceData = {
                clockIn: {
                    time: request.requestedData.timeIn,
                    branch: requestedBranch,
                    shift: requestedShift
                },
                clockOut: {
                    time: request.requestedData.timeOut
                }
            };
            
            // Preserve OT from old date OR add if requested
            if (oldHasOTPay || request.requestOT) {
                attendanceData.hasOTPay = true;
            }
            
            await setDoc(newAttendanceRef, attendanceData);
        } else if (request.requestedData) {
            // Update existing date entry
            const attendanceRef = doc(db, "attendance", request.employeeId, "dates", request.date);
            const attendanceData = {
                clockIn: {
                    time: request.requestedData.timeIn,
                    branch: requestedBranch,
                    shift: requestedShift
                },
                clockOut: {
                    time: request.requestedData.timeOut
                }
            };
            
            // If OT was requested, add it
            if (request.requestOT) {
                attendanceData.hasOTPay = true;
            }
            
            await setDoc(attendanceRef, attendanceData, { merge: true });
        } else if (request.requestOT) {
            // Just add OT pay if no time changes
            const attendanceRef = doc(db, "attendance", request.employeeId, "dates", request.date);
            await setDoc(attendanceRef, { hasOTPay: true }, { merge: true });
        }
        
        // Remove from selection if selected
        selectedRequests.delete(requestId);
        
        // Only close modal if it's open (from detail view)
        const modal = document.getElementById('requestDetailModal');
        if (modal && modal.classList.contains('show')) {
            closeModal();
        }
        
        await showConfirmModal(
            'Success',
            'Request approved and attendance data updated!',
            'OK',
            'modal-btn-approve',
            null,
            true // Hide cancel button
        );
        await fetchRequests();
        return true;
    } catch (error) {
        console.error("Error approving request:", error);
        await showConfirmModal(
            'Error',
            'Failed to approve request. Please try again.',
            'OK',
            'modal-btn-approve',
            null,
            true // Hide cancel button
        );
        return false;
    }
}

// Approve request (with confirmation modal)
async function approveRequest(requestId) {
    const confirmed = await showConfirmModal(
        'Approve Request',
        'Are you sure you want to approve this request? This will update the attendance data.',
        'Approve',
        'modal-btn-approve'
    );
    
    if (!confirmed) return;
    
    await _approveRequest(requestId);
}

// Internal function to reject request (without confirmation modal)
async function _rejectRequest(requestId) {
    try {
        const request = allRequests.find(r => r.id === requestId);
        const sourceCollection = request?._sourceCollection || 'payroll_requests';
        const requestRef = doc(db, sourceCollection, requestId);
        await updateDoc(requestRef, {
            status: 'rejected',
            reviewedAt: Timestamp.now(),
            reviewedBy: currentAdminId
        });
        
        // Remove from selection if selected
        selectedRequests.delete(requestId);
        
        // Only close modal if it's open (from detail view)
        const modal = document.getElementById('requestDetailModal');
        if (modal && modal.classList.contains('show')) {
            closeModal();
        }
        
        await showConfirmModal(
            'Success',
            'Request rejected',
            'OK',
            'modal-btn-approve',
            null,
            true // Hide cancel button
        );
        await fetchRequests();
        return true;
    } catch (error) {
        console.error("Error rejecting request:", error);
        await showConfirmModal(
            'Error',
            'Failed to reject request. Please try again.',
            'OK',
            'modal-btn-approve',
            null,
            true // Hide cancel button
        );
        return false;
    }
}

// Reject request (with confirmation modal)
async function rejectRequest(requestId) {
    const confirmed = await showConfirmModal(
        'Reject Request',
        'Are you sure you want to reject this request?',
        'Reject',
        'modal-btn-reject'
    );
    
    if (!confirmed) return;
    
    await _rejectRequest(requestId);
}

// Open edit modal (for editing before approving)
async function openEditModal(requestId) {
    const request = allRequests.find(r => r.id === requestId);
    if (!request) {
        await showConfirmModal(
            'Error',
            'Request not found',
            'OK',
            'modal-btn-approve',
            null,
            true
        );
        return;
    }
    if (request._sourceCollection === 'substitution_requests' || request.type === 'substitution') {
        return;
    }

    const modal = document.getElementById('editRequestModal');
    if (!modal) return;
    
    // Close detail modal if open
    const detailModal = document.getElementById('requestDetailModal');
    if (detailModal && detailModal.classList.contains('show')) {
        closeModal();
    }
    
    // Populate employee info
    document.getElementById('editEmployeeName').textContent = request.employeeName || 'Unknown';
    
    // Get original date (current date for edit requests, or date for new date requests)
    const originalDate = request.currentData?.date || request.date;
    document.getElementById('editOriginalDate').textContent = formatDate(originalDate);
    
    // Get requested values (or current values if new date request)
    const isNewDateRequest = request.type === "new_date";
    const requestedDate = request.requestedData?.date || request.date;
    const requestedTimeIn = request.requestedData?.timeIn || '--';
    const requestedTimeOut = request.requestedData?.timeOut || '--';
    const requestedBranch = request.requestedData?.branch || request.currentData?.branch || 'Podium';
    const requestedShift = request.requestedData?.shift || request.currentData?.shift || 'Midshift';
    const requestedOT = request.requestOT || false;
    const requestedReason = request.reason || '';
    
    // Populate form with requested values
    document.getElementById('editDate').value = requestedDate;
    
    // Convert times to 24-hour format for time inputs
    const timeIn24 = requestedTimeIn !== '--' ? time12to24(requestedTimeIn) : '09:00';
    const timeOut24 = requestedTimeOut !== '--' ? time12to24(requestedTimeOut) : '18:00';
    document.getElementById('editTimeIn').value = timeIn24;
    document.getElementById('editTimeOut').value = timeOut24;
    
    document.getElementById('editBranch').value = requestedBranch;
    document.getElementById('editShift').value = requestedShift;
    document.getElementById('editOT').checked = requestedOT;
    document.getElementById('editReason').value = requestedReason;
    
    // Update reason field requirement based on OT status
    const editReasonField = document.getElementById('editReason');
    const editReasonLabel = editReasonField?.parentElement?.querySelector('label');
    if (editReasonField) {
        if (requestedOT) {
            editReasonField.required = true;
            editReasonField.placeholder = "Please explain the reason for the overtime request...";
            if (editReasonLabel) {
                let labelText = editReasonLabel.textContent.replace(' (required)', '').trim();
                editReasonLabel.innerHTML = labelText + ' <span style="color: #ef4444;">(required)</span>';
            }
        } else {
            editReasonField.required = false;
            editReasonField.placeholder = "Reason for the request...";
            if (editReasonLabel) {
                let labelText = editReasonLabel.textContent.replace(' (required)', '').trim();
                editReasonLabel.innerHTML = labelText;
            }
        }
    }
    
    // Store request ID for form submission
    modal.dataset.requestId = requestId;
    
    // Show modal
    modal.classList.add('show');
}

// Close edit modal
function closeEditModal() {
    const modal = document.getElementById('editRequestModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

// Approve request with edited values
async function approveWithEdits(requestId, editedData) {
    try {
        const request = allRequests.find(r => r.id === requestId);
        if (!request) {
            await showConfirmModal(
                'Error',
                'Request not found',
                'OK',
                'modal-btn-approve',
                null,
                true
            );
            return false;
        }
        
        // Update request status
        const requestRef = doc(db, "payroll_requests", requestId);
        await updateDoc(requestRef, {
            status: 'approved',
            reviewedAt: Timestamp.now(),
            reviewedBy: currentAdminId,
            // Store edited values for audit trail
            editedData: editedData,
            wasEdited: true
        });
        
        // Get current and edited dates
        const currentDate = request.currentData?.date || request.date;
        const editedDate = editedData.date;
        const dateChanged = currentDate !== editedDate;
        
        // Convert edited times to 12-hour format for storage
        const editedTimeIn12 = time24to12(editedData.timeIn);
        const editedTimeOut12 = time24to12(editedData.timeOut);
        
        // Handle new date requests (type === "new_date")
        if (request.type === "new_date") {
            // Create new date entry with edited data
            const newAttendanceRef = doc(db, "attendance", request.employeeId, "dates", editedDate);
            const attendanceData = {
                clockIn: {
                    time: editedTimeIn12,
                    branch: editedData.branch,
                    shift: editedData.shift
                },
                clockOut: {
                    time: editedTimeOut12
                }
            };
            
            // Add OT if checked
            if (editedData.ot) {
                attendanceData.hasOTPay = true;
            }
            
            await setDoc(newAttendanceRef, attendanceData);
        } else if (dateChanged) {
            // If date changed, delete old date and create new one
            // Get old attendance data to preserve OT if it existed
            let oldHasOTPay = request.currentData?.hasOTPay || false;
            if (!oldHasOTPay) {
                try {
                    const oldAttendanceRef = doc(db, "attendance", request.employeeId, "dates", currentDate);
                    const oldAttendanceSnap = await getDoc(oldAttendanceRef);
                    if (oldAttendanceSnap.exists()) {
                        oldHasOTPay = oldAttendanceSnap.data().hasOTPay || false;
                    }
                } catch (error) {
                    console.error("Error fetching old attendance data:", error);
                }
            }
            
            // Delete old date entry
            const oldAttendanceRef = doc(db, "attendance", request.employeeId, "dates", currentDate);
            await deleteDoc(oldAttendanceRef);
            
            // Create new date entry with edited data
            const newAttendanceRef = doc(db, "attendance", request.employeeId, "dates", editedDate);
            const attendanceData = {
                clockIn: {
                    time: editedTimeIn12,
                    branch: editedData.branch,
                    shift: editedData.shift
                },
                clockOut: {
                    time: editedTimeOut12
                }
            };
            
            // Preserve OT from old date OR add if edited
            if (oldHasOTPay || editedData.ot) {
                attendanceData.hasOTPay = true;
            }
            
            await setDoc(newAttendanceRef, attendanceData);
        } else {
            // Update existing date entry with edited data
            const attendanceRef = doc(db, "attendance", request.employeeId, "dates", currentDate);
            const attendanceData = {
                clockIn: {
                    time: editedTimeIn12,
                    branch: editedData.branch,
                    shift: editedData.shift
                },
                clockOut: {
                    time: editedTimeOut12
                }
            };
            
            // If OT was checked, add it
            if (editedData.ot) {
                attendanceData.hasOTPay = true;
            }
            
            await setDoc(attendanceRef, attendanceData, { merge: true });
        }
        
        // Remove from selection if selected
        selectedRequests.delete(requestId);
        
        // Close edit modal first, then show confirmation
        closeEditModal();
        
        // Wait a moment for the modal to close before showing confirmation
        await new Promise(resolve => setTimeout(resolve, 300));
        
        await showConfirmModal(
            'Success',
            'Request approved with your changes!',
            'OK',
            'modal-btn-approve',
            null,
            true
        );
        await fetchRequests();
        return true;
    } catch (error) {
        console.error("Error approving request with edits:", error);
        await showConfirmModal(
            'Error',
            'Failed to approve request. Please try again.',
            'OK',
            'modal-btn-approve',
            null,
            true
        );
        return false;
    }
}

// Show error message
function showError(message) {
    const container = document.getElementById('requestsContainer');
    if (container) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⚠️</div>
                <div class="empty-state-text">Error</div>
                <div class="empty-state-subtext">${message}</div>
            </div>
        `;
    }
}

// Quick approve request (with confirmation modal, but no detail modal)
async function quickApproveRequest(requestId) {
    const confirmed = await showConfirmModal(
        'Approve Request',
        'Are you sure you want to approve this request? This will update the attendance data.',
        'Approve',
        'modal-btn-approve'
    );
    
    if (!confirmed) return;
    
    // Use the internal approve function directly
    await _approveRequest(requestId);
}

// Quick reject request (with confirmation modal, but no detail modal)
async function quickRejectRequest(requestId) {
    const confirmed = await showConfirmModal(
        'Reject Request',
        'Are you sure you want to reject this request?',
        'Reject',
        'modal-btn-reject'
    );
    
    if (!confirmed) return;
    
    // Use the internal reject function directly
    await _rejectRequest(requestId);
}

// Handle individual request selection
function handleRequestSelect(requestId, checked) {
    if (checked) {
        selectedRequests.add(requestId);
    } else {
        selectedRequests.delete(requestId);
    }
    updateBulkActionsUI();
    updateSelectAllCheckbox();
}

// Toggle select all
function toggleSelectAll(checked) {
    const filteredRequests = currentFilter === 'all' 
        ? allRequests.filter(r => r.status === 'pending')
        : currentFilter === 'pending' 
            ? allRequests.filter(r => r.status === 'pending')
            : [];
    
    if (checked) {
        filteredRequests.forEach(r => selectedRequests.add(r.id));
    } else {
        filteredRequests.forEach(r => selectedRequests.delete(r.id));
    }
    
    // Update all checkboxes
    document.querySelectorAll('.request-select-checkbox').forEach(checkbox => {
        checkbox.checked = checked && filteredRequests.some(r => r.id === checkbox.dataset.requestId);
    });
    
    updateBulkActionsUI();
}

// Update select all checkbox state
function updateSelectAllCheckbox() {
    const filteredRequests = currentFilter === 'all' 
        ? allRequests.filter(r => r.status === 'pending')
        : currentFilter === 'pending' 
            ? allRequests.filter(r => r.status === 'pending')
            : [];
    
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox && filteredRequests.length > 0) {
        const allSelected = filteredRequests.every(r => selectedRequests.has(r.id));
        const someSelected = filteredRequests.some(r => selectedRequests.has(r.id));
        selectAllCheckbox.checked = allSelected;
        selectAllCheckbox.indeterminate = someSelected && !allSelected;
    }
}

// Update bulk actions UI visibility and selected count
function updateBulkActionsUI() {
    const pendingRequests = allRequests.filter(r => r.status === 'pending');
    const hasPending = pendingRequests.length > 0;
    const hasSelection = selectedRequests.size > 0;
    
    // Show/hide requests header (with select all)
    const requestsHeader = document.getElementById('requestsHeader');
    if (requestsHeader) {
        requestsHeader.style.display = (currentFilter === 'pending' || currentFilter === 'all') && hasPending ? 'flex' : 'none';
    }
    
    // Show/hide bulk actions in header
    const bulkActions = document.getElementById('bulkActions');
    const bulkActionsMobile = document.getElementById('bulkActionsMobile');
    if (bulkActions) {
        bulkActions.style.display = hasSelection ? 'flex' : 'none';
    }
    if (bulkActionsMobile) {
        bulkActionsMobile.style.display = hasSelection ? 'flex' : 'none';
    }
    
    // Update selected count
    const selectedCount = document.getElementById('selectedCount');
    if (selectedCount) {
        selectedCount.textContent = `${selectedRequests.size} selected`;
    }
    
    updateSelectAllCheckbox();
}

// Bulk approve selected requests
async function bulkApproveRequests() {
    const selectedIds = Array.from(selectedRequests);
    if (selectedIds.length === 0) return;
    
    const confirmed = await showConfirmModal(
        'Approve Selected Requests',
        `Are you sure you want to approve ${selectedIds.length} request${selectedIds.length > 1 ? 's' : ''}? This will update the attendance data.`,
        'Approve',
        'modal-btn-approve'
    );
    
    if (!confirmed) return;
    
    // Show loading state
    const container = document.getElementById('requestsContainer');
    const originalContent = container.innerHTML;
    container.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Approving ${selectedIds.length} request${selectedIds.length > 1 ? 's' : ''}...</p>
        </div>
    `;
    
    try {
        // Process all approvals
        const results = await Promise.allSettled(
            selectedIds.map(id => _approveRequest(id))
        );
        
        // Check for failures
        const failures = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value));
        const successes = results.filter(r => r.status === 'fulfilled' && r.value);
        
        // Clear selection
        selectedRequests.clear();
        await fetchRequests();
        
        // Show result message
        if (failures.length > 0) {
            await showConfirmModal(
                'Partial Success',
                `Approved ${successes.length} request${successes.length !== 1 ? 's' : ''}, but ${failures.length} failed. Please try again.`,
                'OK',
                'modal-btn-approve',
                null,
                true
            );
        } else {
            await showConfirmModal(
                'Success',
                `Successfully approved ${successes.length} request${successes.length !== 1 ? 's' : ''}!`,
                'OK',
                'modal-btn-approve',
                null,
                true
            );
        }
    } catch (error) {
        console.error("Error in bulk approve:", error);
        await showConfirmModal(
            'Error',
            'Failed to approve requests. Please try again.',
            'OK',
            'modal-btn-approve',
            null,
            true
        );
        await fetchRequests();
    }
}

// Bulk reject selected requests
async function bulkRejectRequests() {
    const selectedIds = Array.from(selectedRequests);
    if (selectedIds.length === 0) return;
    
    const confirmed = await showConfirmModal(
        'Reject Selected Requests',
        `Are you sure you want to reject ${selectedIds.length} request${selectedIds.length > 1 ? 's' : ''}?`,
        'Reject',
        'modal-btn-reject'
    );
    
    if (!confirmed) return;
    
    // Show loading state
    const container = document.getElementById('requestsContainer');
    const originalContent = container.innerHTML;
    container.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Rejecting ${selectedIds.length} request${selectedIds.length > 1 ? 's' : ''}...</p>
        </div>
    `;
    
    try {
        // Process all rejections
        const results = await Promise.allSettled(
            selectedIds.map(id => _rejectRequest(id))
        );
        
        // Check for failures
        const failures = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value));
        const successes = results.filter(r => r.status === 'fulfilled' && r.value);
        
        // Clear selection
        selectedRequests.clear();
        await fetchRequests();
        
        // Show result message
        if (failures.length > 0) {
            await showConfirmModal(
                'Partial Success',
                `Rejected ${successes.length} request${successes.length !== 1 ? 's' : ''}, but ${failures.length} failed. Please try again.`,
                'OK',
                'modal-btn-approve',
                null,
                true
            );
        } else {
            await showConfirmModal(
                'Success',
                `Successfully rejected ${successes.length} request${successes.length !== 1 ? 's' : ''}!`,
                'OK',
                'modal-btn-approve',
                null,
                true
            );
        }
    } catch (error) {
        console.error("Error in bulk reject:", error);
        await showConfirmModal(
            'Error',
            'Failed to reject requests. Please try again.',
            'OK',
            'modal-btn-approve',
            null,
            true
        );
        await fetchRequests();
    }
}

// Make functions global
window.closeModal = closeModal;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.quickApproveRequest = quickApproveRequest;
window.quickRejectRequest = quickRejectRequest;
window.handleRequestSelect = handleRequestSelect;
window.toggleSelectAll = toggleSelectAll;
window.bulkApproveRequests = bulkApproveRequests;
window.bulkRejectRequests = bulkRejectRequests;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const statusFilter = document.getElementById('statusFilter');
    const statusFilterMobile = document.getElementById('statusFilterMobile');
    const requestTypeFilter = document.getElementById('requestTypeFilter');
    const requestTypeFilterMobile = document.getElementById('requestTypeFilterMobile');

    // Set up request type filter (desktop)
    if (requestTypeFilter) {
        requestTypeFilter.value = currentRequestTypeFilter;
        requestTypeFilter.addEventListener('change', (e) => {
            currentRequestTypeFilter = e.target.value;
            selectedRequests.clear();
            if (requestTypeFilterMobile) requestTypeFilterMobile.value = currentRequestTypeFilter;
            renderRequests();
        });
    }
    // Set up request type filter (mobile)
    if (requestTypeFilterMobile) {
        requestTypeFilterMobile.value = currentRequestTypeFilter;
        requestTypeFilterMobile.addEventListener('change', (e) => {
            currentRequestTypeFilter = e.target.value;
            selectedRequests.clear();
            if (requestTypeFilter) requestTypeFilter.value = currentRequestTypeFilter;
            renderRequests();
        });
    }

    // Set up status filter (desktop)
    if (statusFilter) {
        statusFilter.value = currentFilter;
        statusFilter.addEventListener('change', (e) => {
            currentFilter = e.target.value;
            selectedRequests.clear();
            if (statusFilterMobile) statusFilterMobile.value = currentFilter;
            renderRequests();
        });
    }
    // Set up status filter (mobile)
    if (statusFilterMobile) {
        statusFilterMobile.value = currentFilter;
        statusFilterMobile.addEventListener('change', (e) => {
            currentFilter = e.target.value;
            selectedRequests.clear();
            if (statusFilter) statusFilter.value = currentFilter;
            renderRequests();
        });
    }
    
    // Set up refresh button (desktop)
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            fetchRequests();
        });
    }
    
    // Set up refresh button (mobile)
    const refreshBtnMobile = document.getElementById('refreshBtnMobile');
    if (refreshBtnMobile) {
        refreshBtnMobile.addEventListener('click', () => {
            fetchRequests();
        });
    }
    
    // Close modal on outside click
    const modal = document.getElementById('requestDetailModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
    }
    
    const closeBtn = document.getElementById('closeModal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }
    
    // Close edit modal button
    const closeEditBtn = document.getElementById('closeEditModal');
    if (closeEditBtn) {
        closeEditBtn.addEventListener('click', closeEditModal);
    }
    
    // Edit modal outside click
    const editModal = document.getElementById('editRequestModal');
    if (editModal) {
        editModal.addEventListener('click', (e) => {
            if (e.target === editModal) {
                closeEditModal();
            }
        });
    }
    
    // Edit form submission
    const editForm = document.getElementById('editRequestForm');
    if (editForm) {
        // Add OT checkbox listener to update reason field requirement
        const editOTCheckbox = document.getElementById('editOT');
        const editReasonField = document.getElementById('editReason');
        if (editOTCheckbox && editReasonField) {
            editOTCheckbox.addEventListener('change', () => {
                const isOTChecked = editOTCheckbox.checked;
                const reasonLabel = editReasonField.previousElementSibling;
                
                if (isOTChecked) {
                    editReasonField.required = true;
                    editReasonField.placeholder = "Please explain the reason for the overtime request...";
                    if (reasonLabel) {
                        let labelText = reasonLabel.textContent.replace(' (required)', '').trim();
                        reasonLabel.innerHTML = labelText + ' <span style="color: #ef4444;">(required)</span>';
                    }
                } else {
                    editReasonField.required = false;
                    editReasonField.placeholder = "Reason for the request...";
                    if (reasonLabel) {
                        let labelText = reasonLabel.textContent.replace(' (required)', '').trim();
                        reasonLabel.innerHTML = labelText;
                    }
                }
            });
        }
        
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const modal = document.getElementById('editRequestModal');
            const requestId = modal?.dataset.requestId;
            if (!requestId) return;
            
            // Validate: Reason is required if OT is checked
            const editOT = document.getElementById('editOT').checked;
            const editReason = document.getElementById('editReason').value.trim();
            
            if (editOT && !editReason) {
                // Don't close edit modal for validation errors - show error in edit modal
                const errorMsg = document.createElement('div');
                errorMsg.style.cssText = 'color: #ef4444; margin-top: 0.5rem; font-size: 0.9rem;';
                errorMsg.textContent = 'Please provide a reason for the overtime request.';
                
                // Remove any existing error message
                const existingError = editReasonField.parentElement.querySelector('.error-message');
                if (existingError) existingError.remove();
                
                errorMsg.className = 'error-message';
                editReasonField.parentElement.appendChild(errorMsg);
                editReasonField.focus();
                editReasonField.style.borderColor = '#ef4444';
                setTimeout(() => {
                    editReasonField.style.borderColor = '#ddd';
                    if (errorMsg.parentElement) {
                        errorMsg.remove();
                    }
                }, 3000);
                return;
            }
            
            // Get form values
            const editedData = {
                date: document.getElementById('editDate').value,
                timeIn: document.getElementById('editTimeIn').value,
                timeOut: document.getElementById('editTimeOut').value,
                branch: document.getElementById('editBranch').value,
                shift: document.getElementById('editShift').value,
                ot: editOT,
                reason: editReason
            };
            
            // Close edit modal first before showing confirmation
            closeEditModal();
            
            // Wait a moment for the modal to close
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Confirm before approving
            const confirmed = await showConfirmModal(
                'Approve with Changes',
                'Are you sure you want to approve this request with your edits? This will update the attendance data.',
                'Approve',
                'modal-btn-approve'
            );
            
            if (!confirmed) return;
            
            await approveWithEdits(requestId, editedData);
        });
    }
    
    // Set up bulk action buttons
    const bulkApproveBtn = document.getElementById('bulkApproveBtn');
    const bulkRejectBtn = document.getElementById('bulkRejectBtn');
    const bulkApproveBtnMobile = document.getElementById('bulkApproveBtnMobile');
    const bulkRejectBtnMobile = document.getElementById('bulkRejectBtnMobile');
    
    if (bulkApproveBtn) {
        bulkApproveBtn.addEventListener('click', bulkApproveRequests);
    }
    if (bulkRejectBtn) {
        bulkRejectBtn.addEventListener('click', bulkRejectRequests);
    }
    if (bulkApproveBtnMobile) {
        bulkApproveBtnMobile.addEventListener('click', bulkApproveRequests);
    }
    if (bulkRejectBtnMobile) {
        bulkRejectBtnMobile.addEventListener('click', bulkRejectRequests);
    }
    
    // Load requests
    fetchRequests();
    
    // Refresh every 30 seconds
    setInterval(fetchRequests, 30000);
});

