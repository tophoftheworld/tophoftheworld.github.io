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
let currentAdminId = 'admin'; // Will be set from auth
let selectedRequests = new Set(); // Track selected request IDs

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

// Normalize time string by removing seconds for comparison
// This ensures "10:34 AM" matches "10:34:09 AM"
function normalizeTimeForComparison(timeStr) {
    if (!timeStr || timeStr === '--' || timeStr === 'null') return '';
    
    // Remove seconds if they exist (format: "HH:MM:SS AM/PM" -> "HH:MM AM/PM")
    // This regex matches a colon followed by two digits before the space and AM/PM
    return timeStr.replace(/:\d{2}(\s[AP]M)/i, '$1');
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

// Fetch all requests
async function fetchRequests() {
    try {
        const requestsRef = collection(db, "payroll_requests");
        const q = query(requestsRef, orderBy("requestedAt", "desc"));
        const snapshot = await getDocs(q);
        
        allRequests = [];
        snapshot.forEach(doc => {
            allRequests.push({ id: doc.id, ...doc.data() });
        });
        
        renderRequests();
    } catch (error) {
        console.error("Error fetching requests:", error);
        showError("Failed to load requests. Please try again.");
    }
}

// Render requests based on current filter
function renderRequests() {
    const container = document.getElementById('requestsContainer');
    if (!container) return;
    
    const filteredRequests = currentFilter === 'all' 
        ? allRequests 
        : allRequests.filter(r => r.status === currentFilter);
    
    if (filteredRequests.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-text">No ${currentFilter === 'all' ? '' : currentFilter} requests found</div>
                <div class="empty-state-subtext">${currentFilter === 'all' ? 'Requests will appear here when employees submit them.' : 'Try changing the filter to see other requests.'}</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = filteredRequests.map(request => {
        const initials = getInitials(request.employeeName);
        const timeAgo = formatRelativeTime(request.requestedAt);
        const statusClass = `request-status-${request.status}`;
        
        // Build preview text - only show fields that actually changed
        let previewText = '';
        
        // Handle new date requests differently
        if (request.type === "new_date") {
            previewText = `<div class="request-preview-item"><span class="request-preview-value">New Date Request</span></div>`;
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
            if (request.requestOT === true) {
                previewText += '<div class="request-preview-item"><span class="request-preview-value">+ Overtime Pay Request</span></div>';
            }
        } else {
            // Check for time in change (normalize to avoid false positives from rounding)
            const currentTimeIn = formatTime(request.currentData?.timeIn);
            const requestedTimeIn = formatTime(request.requestedData?.timeIn);
            const normalizedCurrentTimeIn = normalizeTimeForComparison(currentTimeIn);
            const normalizedRequestedTimeIn = normalizeTimeForComparison(requestedTimeIn);
            if (normalizedCurrentTimeIn !== normalizedRequestedTimeIn && normalizedCurrentTimeIn !== '' && normalizedRequestedTimeIn !== '') {
                previewText += `
                    <div class="request-preview-item">
                        <span class="request-preview-label">Time In:</span>
                        <span class="request-preview-value">${currentTimeIn} → ${requestedTimeIn}</span>
                    </div>
                `;
            }
            
            // Check for time out change (normalize to avoid false positives from rounding)
            const currentTimeOut = formatTime(request.currentData?.timeOut);
            const requestedTimeOut = formatTime(request.requestedData?.timeOut);
            const normalizedCurrentTimeOut = normalizeTimeForComparison(currentTimeOut);
            const normalizedRequestedTimeOut = normalizeTimeForComparison(requestedTimeOut);
            if (normalizedCurrentTimeOut !== normalizedRequestedTimeOut && normalizedCurrentTimeOut !== '' && normalizedRequestedTimeOut !== '') {
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
            
            // Only show OT request in preview if it was actually requested (requestOT is true)
            // Note: This will show even if OT was already applied, but the detail modal will filter it out
            if (request.requestOT === true) {
                previewText += '<div class="request-preview-item"><span class="request-preview-value">+ Overtime Pay Request</span></div>';
            }
        }
        
        // Capitalize status
        const statusText = request.status.charAt(0).toUpperCase() + request.status.slice(1);
        
        // Build date display
        let dateDisplay = '';
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
                            <span class="request-name">${request.employeeName || 'Unknown'}</span>
                            <span class="request-date">${timeAgo}</span>
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
    
    // Build Shift Details section - always show CURRENT date info
    let content = `
        <div class="request-detail-section">
            <h3>Shift Details</h3>
            <div class="request-detail-row">
                <div>
                    <div class="request-detail-label">Employee</div>
                    <div class="request-detail-value">${request.employeeName || 'Unknown'}</div>
                </div>
                <div>
                    <div class="request-detail-label">Date</div>
                    <div class="request-detail-value">${formatDate(shiftDetailsDate)}</div>
                </div>
            </div>
            <div class="request-detail-row">
                <div>
                    <div class="request-detail-label">Payroll Period</div>
                    <div class="request-detail-value">${payrollPeriod}</div>
                </div>
                <div>
                    <div class="request-detail-label">Branch</div>
                    <div class="request-detail-value">${branch}</div>
                </div>
            </div>
            <div class="request-detail-row">
                <div>
                    <div class="request-detail-label">Shift</div>
                    <div class="request-detail-value">${shift}</div>
                </div>
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
        
        if (request.requestedData?.branch) {
            requestDetailsContent += `
                <div class="request-detail-row">
                    <div>
                        <div class="request-detail-label">Branch</div>
                        <div class="request-detail-value">${request.requestedData.branch}</div>
                    </div>
                    <div>
                        <div class="request-detail-label">Shift</div>
                        <div class="request-detail-value">${request.requestedData.shift || '--'}</div>
                    </div>
                </div>
            `;
        }
        
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
            
            // Normalize times for comparison (remove seconds) to avoid false positives
            // when times are the same but one has seconds and the other doesn't
            const normalizedCurrentTimeIn = normalizeTimeForComparison(currentTimeIn);
            const normalizedRequestedTimeIn = normalizeTimeForComparison(requestedTimeIn);
            const normalizedCurrentTimeOut = normalizeTimeForComparison(currentTimeOut);
            const normalizedRequestedTimeOut = normalizeTimeForComparison(requestedTimeOut);
            
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
            
            // Time In change (only show if times actually differ after normalization)
            if (normalizedCurrentTimeIn !== normalizedRequestedTimeIn && normalizedCurrentTimeIn !== '' && normalizedRequestedTimeIn !== '') {
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
            
            // Time Out change (only show if times actually differ after normalization)
            if (normalizedCurrentTimeOut !== normalizedRequestedTimeOut && normalizedCurrentTimeOut !== '' && normalizedRequestedTimeOut !== '') {
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
    
    if (request.reason) {
        content += `
            <div class="request-detail-section">
                <h3>Reason</h3>
                <div class="request-detail-value">${request.reason}</div>
            </div>
        `;
    }
    
    modalContent.innerHTML = content;
    
    // Build action buttons
    let actionsHtml = '';
    if (request.status === 'pending') {
        actionsHtml = `
            <button class="modal-btn modal-btn-edit" onclick="openEditModal('${request.id}')">Edit & Approve</button>
            <button class="modal-btn modal-btn-approve" onclick="approveRequest('${request.id}')">Approve</button>
            <button class="modal-btn modal-btn-reject" onclick="rejectRequest('${request.id}')">Reject</button>
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
    
    modalActions.innerHTML = actionsHtml + '<button class="modal-btn modal-btn-cancel" onclick="closeModal()">Close</button>';
    
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
        
        // Update request status
        const requestRef = doc(db, "payroll_requests", requestId);
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
        const requestRef = doc(db, "payroll_requests", requestId);
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
    // Set up filter (desktop)
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
        // Set default filter to pending
        statusFilter.value = currentFilter;
        statusFilter.addEventListener('change', (e) => {
            currentFilter = e.target.value;
            // Clear selection when filter changes
            selectedRequests.clear();
            // Sync mobile filter
            const mobileFilter = document.getElementById('statusFilterMobile');
            if (mobileFilter) {
                mobileFilter.value = currentFilter;
            }
            renderRequests();
        });
    }
    
    // Set up filter (mobile)
    const statusFilterMobile = document.getElementById('statusFilterMobile');
    if (statusFilterMobile) {
        statusFilterMobile.value = currentFilter;
        statusFilterMobile.addEventListener('change', (e) => {
            currentFilter = e.target.value;
            // Clear selection when filter changes
            selectedRequests.clear();
            // Sync desktop filter
            if (statusFilter) {
                statusFilter.value = currentFilter;
            }
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

