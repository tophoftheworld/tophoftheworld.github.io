// Shared UI components for inventory applications

// Build a table with headers and rows
export function buildTable(headers, rowsHtml, tableId) {
  return `
    <table class="inv-table" id="${tableId}">
      <thead>
        <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rowsHtml || ''}
      </tbody>
    </table>`;
}

// Format number with commas
export function formatNumberWithCommas(num) {
  if (num === null || num === undefined) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Create category header row
export function createCategoryHeader(category, isCollapsed = false, showControls = false) {
  const controls = showControls ? `
    <div class="category-edit-controls">
      <button class="btn btn-secondary btn-small" onclick="editCategory('${category}')">Edit</button>
    </div>
  ` : '';
  
  return `
    <tr class="category-header" data-category="${category}">
      <td colspan="8">
        <div class="category-header-container">
          <div class="category-header-left">
            <button class="category-collapse-btn ${isCollapsed ? 'collapsed' : ''}" data-category="${category}">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <span class="category-name">${category}</span>
          </div>
          <div class="category-edit-controls" onclick="event.stopPropagation()">
            ${controls}
          </div>
        </div>
      </td>
    </tr>`;
}

// Create inventory row for desktop dashboard
export function createInventoryRow(item, openingQuantities = {}, closingQuantities = {}, addedQuantities = {}, isCollapsed = false) {
  console.log('createInventoryRow called with unit:', item.unit);
  const openingQty = openingQuantities[item.id] || 0;
  const closingQty = closingQuantities[item.id] || 0;
  const addedQty = addedQuantities[item.id] || 0;
  const usedQty = openingQty + addedQty - closingQty;
  
  // Determine which column should be bold based on data availability
  // If closing data exists, mark closing as bold; otherwise mark opening as bold
  const hasClosingData = closingQuantities[item.id] !== undefined && closingQuantities[item.id] > 0;
  const openingClass = hasClosingData ? '' : 'most-recent';
  const closingClass = hasClosingData ? 'most-recent' : '';
  
  return `
    <tr class="inventory-row category-item-row" data-category="${item.category}" data-item-id="${item.id}" ${isCollapsed ? 'style="display:none;"' : ''}>
      <td style="width:50px;text-align:center;padding:4px;">
        <div class="photo-container">
          ${item.photo ? 
            `<img src="${item.photo}" alt="" onerror="this.style.display='none'"/>` : 
            `<div class="photo-placeholder"></div>`
          }
        </div>
      </td>
      <td style="width:250px;">${item.name}</td>
      <td style="width:120px;">${item.description || ''}</td>
      <td class="quantity-cell opening ${openingClass}">${formatNumberWithCommas(openingQty)} ${item.unit}</td>
      <td class="quantity-cell added">${addedQty > 0 ? formatNumberWithCommas(addedQty) + ' ' + item.unit : '-'}</td>
      <td class="quantity-cell closing ${closingClass}">${formatNumberWithCommas(closingQty)} ${item.unit}</td>
      <td class="quantity-cell used">${formatNumberWithCommas(usedQty)} ${item.unit}</td>
    </tr>`;
}

// Create date picker component
export function createDatePicker(currentDate, onDateChange) {
  const dateStr = currentDate.toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric' 
  });
  
  return `
    <div class="date-picker">
      <button class="date-nav-btn" onclick="changeDate(-1)">‹</button>
      <div class="date-display" onclick="openDateModal()">${dateStr}</div>
      <button class="date-nav-btn" onclick="changeDate(1)">›</button>
    </div>`;
}

// Create branch selector component
export function createBranchSelector(branches, selectedBranch, onBranchChange) {
  const options = branches.map(branch => 
    `<option value="${branch}">${getBranchDisplayName(branch)}</option>`
  ).join('');
  
  return `
    <select class="branch-select" onchange="onBranchChange(this.value)">
      ${options}
    </select>`;
}

// Create loading indicator
export function createLoadingIndicator(message = 'Loading...') {
  return `
    <div class="loading-indicator">
      <div class="spinner"></div>
      <span>${message}</span>
    </div>`;
}

// Create empty state
export function createEmptyState(message = 'No items found', showButton = false, buttonText = '', buttonAction = '') {
  const button = showButton ? `<div style="margin-top:10px"><button class="btn btn-primary" onclick="${buttonAction}">${buttonText}</button></div>` : '';
  
  return `
    <div class="empty-state">
      ${message}
      ${button}
    </div>`;
}

// Helper function to get branch display name (imported from data module)
function getBranchDisplayName(branch) {
  if (!branch) return '';
  const map = { 'sm-north': 'SM North', 'podium': 'Podium' };
  return map[branch] || branch.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
