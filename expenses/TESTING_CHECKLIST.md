# Expense Admin Dashboard - Testing Checklist

## How to Test

1. Open the Expense Admin page: `expenses/admin.html`
2. Open your browser's Developer Console (F12 → Console tab)
3. Follow each test below and check the results

---

## Test Results

### ✅ Test 1: Page Loads
**Expected:** Console shows `=== INITIALIZING ADMIN INTERFACE ===`
**Result:** [ ] Pass [ ] Fail
**Notes:**

---

### ✅ Test 2: Flatpickr Initialized
**Expected:** Console shows `[2/8] ✓ Date picker initialized`
**Result:** [ ] Pass [ ] Fail
**Notes:**

---

### ✅ Test 3: Date Shortcuts Created
**Expected:** 
- Console shows `[3/8] ✓ Created date shortcuts`
- You should see 4 buttons: "Last 7 days", "Last 30 days", "Month to Date", "Last 3 Months"

**Result:** [ ] Pass [ ] Fail
**Notes:**

---

### ✅ Test 4: View Buttons Found
**Expected:** Console shows `[EventListeners] Found 3 view buttons: ['daily', 'weekly', 'monthly']`
**Result:** [ ] Pass [ ] Fail
**Notes:**

---

### ✅ Test 5: Date Range Input Clickable
**Action:** Click on the "Select date range" input field
**Expected:** A calendar popup appears
**Result:** [ ] Pass [ ] Fail
**Notes:**

---

### ✅ Test 6: Date Shortcut Button Works
**Action:** Click "Last 30 days" button
**Expected:** 
- Console shows `[Shortcut] Clicked: Last 30 days for view: daily`
- The date range input shows a date range
- Data is filtered

**Result:** [ ] Pass [ ] Fail
**Notes:**

---

### ✅ Test 7: Daily Button Works
**Action:** Click "Daily" button
**Expected:**
- Console shows `[View] Changing to: daily`
- Shortcuts change to: Last 7 days, Last 30 days, Month to Date, Last 3 Months

**Result:** [ ] Pass [ ] Fail
**Notes:**

---

### ✅ Test 8: Weekly Button Works
**Action:** Click "Weekly" button
**Expected:**
- Console shows `[View] Changing to: weekly`
- Shortcuts change to: Last 4 weeks, Last 8 weeks, Last 12 weeks, This Year

**Result:** [ ] Pass [ ] Fail
**Notes:**

---

### ✅ Test 9: Monthly Button Works
**Action:** Click "Monthly" button
**Expected:**
- Console shows `[View] Changing to: monthly`
- Shortcuts change to: Current Year, Last 6 months, Last 12 months, All Data

**Result:** [ ] Pass [ ] Fail
**Notes:**

---

### ✅ Test 10: Initialization Complete
**Expected:** Console shows `=== ✓ INITIALIZATION COMPLETE ===`
**Result:** [ ] Pass [ ] Fail
**Notes:**

---

## Common Issues & Solutions

### Issue: Date shortcuts don't appear
**Solution:** Check console for `[Shortcuts] ERROR: dateShortcuts container not found!`
- Verify the HTML has `<div class="date-shortcuts" id="dateShortcuts"></div>`

### Issue: Calendar doesn't open
**Solution:** Check console for `[DatePicker] ERROR: flatpickr library not loaded!`
- Verify flatpickr script is loaded in HTML: `<script src="https://cdn.jsdelivr.net/npm/flatpickr"></script>`

### Issue: Buttons don't respond
**Solution:** Check console for event listener errors
- Verify buttons have correct data attributes: `data-view="daily"`, `data-view="weekly"`, etc.

---

## Console Commands for Manual Testing

Run these in the browser console to test manually:

```javascript
// Test if flatpickr is available
console.log('flatpickr:', typeof flatpickr);

// Test if date input exists
console.log('dateRange:', document.getElementById('dateRange'));

// Test if shortcuts container exists
console.log('shortcuts:', document.getElementById('dateShortcuts'));

// Test if view buttons exist
console.log('view buttons:', document.querySelectorAll('.view-btn[data-view]'));

// Manually create shortcuts
createDateShortcuts('daily');

// Manually change view
changeView('weekly');
```

