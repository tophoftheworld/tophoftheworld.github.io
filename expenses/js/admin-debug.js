// TEMPORARY DEBUG VERSION - Check browser console for detailed logs

console.log('=== ADMIN DEBUG SCRIPT LOADING ===');

// Test 1: Check if flatpickr is available
console.log('Test 1: flatpickr available?', typeof flatpickr);

// Test 2: Check if DOM elements exist
document.addEventListener('DOMContentLoaded', () => {
    console.log('Test 2: DOM loaded');
    console.log('  - dateRange input:', document.getElementById('dateRange'));
    console.log('  - dateShortcuts div:', document.getElementById('dateShortcuts'));
    console.log('  - view-btn elements:', document.querySelectorAll('.view-btn[data-view]').length);
    
    // Test 3: Try to initialize flatpickr
    const dateInput = document.getElementById('dateRange');
    if (dateInput) {
        console.log('Test 3: Initializing flatpickr...');
        try {
            const fp = flatpickr("#dateRange", {
                mode: "range",
                dateFormat: "M j, Y",
                defaultDate: [
                    new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
                    new Date()
                ],
                onChange: function (selectedDates) {
                    console.log('Date range changed:', selectedDates);
                }
            });
            console.log('✓ Flatpickr initialized:', fp);
        } catch (e) {
            console.error('✗ Flatpickr failed:', e);
        }
    }
    
    // Test 4: Create test shortcuts
    const shortcutsContainer = document.getElementById('dateShortcuts');
    if (shortcutsContainer) {
        console.log('Test 4: Creating shortcuts...');
        const shortcuts = ["Last 7 days", "Last 30 days", "Month to Date", "Last 3 Months"];
        shortcuts.forEach(label => {
            const btn = document.createElement("button");
            btn.innerText = label;
            btn.className = "date-shortcut-btn";
            btn.onclick = () => console.log('Shortcut clicked:', label);
            shortcutsContainer.appendChild(btn);
        });
        console.log('✓ Created', shortcuts.length, 'shortcuts');
    }
    
    // Test 5: Attach view button listeners
    console.log('Test 5: Attaching view button listeners...');
    document.querySelectorAll('.view-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('✓ View button clicked:', btn.dataset.view);
        });
    });
    console.log('✓ Attached listeners to', document.querySelectorAll('.view-btn[data-view]').length, 'view buttons');
});

