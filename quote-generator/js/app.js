// ============================================
// State Management
// ============================================

const AppState = {
    service: null, // 'workshop' or 'mobile-bar'
    eventDetails: {
        name: '',
        company: '',
        email: '',
        phone: '',
        date: 'tbd',
        dateValue: null,
        location: ''
    },
    workshop: {
        pax: 6,
        format: 'standard', // 'crash-course', 'standard', or 'full'
        sameTime: null,
        addons: [],
        perPaxPrice: 2450 // Default per-pax price
    },
    price: 0
};

// ============================================
// Screen Management
// ============================================

const screens = {
    service: document.getElementById('screen-service'),
    details: document.getElementById('screen-details'),
    'workshop-size': document.getElementById('screen-workshop-size'),
    'workshop-experience': document.getElementById('screen-workshop-experience'),
    'workshop-quote': document.getElementById('screen-workshop-quote')
};

function showScreen(screenId) {
    // Hide all screens
    Object.values(screens).forEach(screen => {
        if (screen) {
            screen.classList.remove('active');
        }
    });
    
    // Show target screen
    if (screens[screenId]) {
        screens[screenId].classList.add('active');
    }
    
    // Update progress indicator
    updateProgress(screenId);
    
    // Update price bar visibility based on current screen
    updatePriceBar(screenId);
}

function updateProgress(screenId) {
    const stepMapping = {
        'service': 'service',
        'details': 'details',
        'workshop-size': 'build',
        'workshop-experience': 'build',
        'workshop-quote': 'quote'
    };
    
    const currentStep = stepMapping[screenId] || 'service';
    const progressDots = document.querySelectorAll('.progress-dot');
    
    progressDots.forEach(dot => {
        dot.classList.remove('active');
        if (dot.dataset.step === currentStep) {
            dot.classList.add('active');
        }
    });
}

// ============================================
// Price Calculation (Placeholder)
// ============================================

function calculatePrice() {
    // Tiered pricing logic for workshops
    if (AppState.service === 'workshop') {
        const pax = AppState.workshop.pax;
        const format = AppState.workshop.format;
        
        // Crash Course pricing (different tier structure)
        if (format === 'crash-course') {
            // Minimum pricing is for 20 pax (crash course minimum)
            const effectivePax = Math.max(pax, 20);
            
            let perPaxPrice;
            if (effectivePax >= 81) {
                perPaxPrice = 650; // 81+ pax: Php 650 per pax
            } else if (effectivePax >= 51) {
                perPaxPrice = 700; // 51-80 pax: Php 700 per pax
            } else {
                perPaxPrice = 750; // 20-50 pax: Php 750 per pax
            }
            
            AppState.price = perPaxPrice * effectivePax;
            AppState.workshop.perPaxPrice = perPaxPrice;
        } else {
            // Standard and Full pricing
            // Minimum pricing is for 6 pax, even if fewer participants
            const effectivePax = Math.max(pax, 6);
            
            // Tiered pricing structure
            let perPaxPrice;
            if (effectivePax >= 15) {
                perPaxPrice = 1950; // 15+ pax: Php 1,950 per pax
            } else if (effectivePax >= 10) {
                perPaxPrice = 2150; // 10-14 pax: Php 2,150 per pax
            } else {
                perPaxPrice = 2450; // 6-9 pax: Php 2,450 per pax
            }
            
            // Apply format multiplier (Full = 1.7x Standard)
            if (format === 'full') {
                perPaxPrice = perPaxPrice * 1.7;
            }
            
            AppState.price = perPaxPrice * effectivePax;
            AppState.workshop.perPaxPrice = perPaxPrice; // Store for display
        }
    } else if (AppState.service === 'mobile-bar') {
        // Placeholder for mobile bar pricing
        AppState.price = 0;
    }
    
    updatePriceDisplay();
}

function updatePriceDisplay() {
    const priceBar = document.getElementById('priceBar');
    const priceBarAmount = document.getElementById('priceBarAmount');
    
    if (priceBarAmount) {
        priceBarAmount.textContent = `Php ${AppState.price.toLocaleString('en-US')}`;
    }
    
    // Update quote summary if on quote screen
    const quoteTotal = document.getElementById('quoteTotal');
    if (quoteTotal) {
        quoteTotal.textContent = `Php ${AppState.price.toLocaleString('en-US')}`;
    }
    
    const quotePerPax = document.getElementById('quotePerPax');
    if (quotePerPax && AppState.service === 'workshop') {
        const perPax = Math.round(AppState.price / AppState.workshop.pax);
        quotePerPax.textContent = `Php ${perPax.toLocaleString('en-US')}`;
    }
}

function updatePriceBar(screenId) {
    const priceBar = document.getElementById('priceBar');
    // Hide price bar on service selection, details, and workshop-size screens
    if (screenId === 'service' || screenId === 'details' || screenId === 'workshop-size') {
        priceBar.style.display = 'none';
    } else if (AppState.service && AppState.price > 0) {
        priceBar.style.display = 'block';
    } else {
        priceBar.style.display = 'none';
    }
}

// ============================================
// Service Selection
// ============================================

function initServiceSelection() {
    const serviceCards = document.querySelectorAll('.service-card');
    
    serviceCards.forEach(card => {
        card.addEventListener('click', () => {
            const service = card.dataset.service;
            AppState.service = service;
            
            // Navigate to details screen
            showScreen('details');
            
            // Calculate initial price
            calculatePrice();
        });
    });
}

// ============================================
// Event Details Screen
// ============================================

function initEventDetails() {
    const backBtn = document.getElementById('backFromDetails');
    const nextBtn = document.getElementById('nextFromDetails');
    const emailInput = document.getElementById('inputEmail');
    const phoneInput = document.getElementById('inputPhone');
    const nameInput = document.getElementById('inputName');
    const companyInput = document.getElementById('inputCompany');
    const dateInput = document.getElementById('inputDate');
    const locationInput = document.getElementById('inputLocation');
    
    // Back button
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            showScreen('service');
        });
    }
    
    // No validation required - always enable next button
    if (nextBtn) {
        nextBtn.disabled = false;
    }
    
    // Input handlers
    if (nameInput) {
        nameInput.addEventListener('input', (e) => {
            AppState.eventDetails.name = e.target.value;
        });
    }
    
    if (companyInput) {
        companyInput.addEventListener('input', (e) => {
            AppState.eventDetails.company = e.target.value;
        });
    }
    
    if (emailInput) {
        emailInput.addEventListener('input', (e) => {
            AppState.eventDetails.email = e.target.value;
        });
    }
    
    if (phoneInput) {
        phoneInput.addEventListener('input', (e) => {
            AppState.eventDetails.phone = e.target.value;
        });
    }
    
    // Date picker initialization
    initDatePicker();
    
    // Location input
    if (locationInput) {
        locationInput.addEventListener('input', (e) => {
            AppState.eventDetails.location = e.target.value;
        });
    }
    
    // Next button
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (AppState.service === 'workshop') {
                showScreen('workshop-size');
            } else if (AppState.service === 'mobile-bar') {
                // Will navigate to mobile bar flow later
                console.log('Mobile bar flow - to be implemented');
            }
        });
    }
}

// ============================================
// Workshop Group Size Screen
// ============================================

// Track if format options have been shown (persists across screen visits)
let formatsShown = false;

function initWorkshopSize() {
    const backBtn = document.getElementById('backFromWorkshopSize');
    const nextBtn = document.getElementById('nextFromWorkshopSize');
    const sizeInput = document.getElementById('workshopSize');
    const decrementBtn = document.getElementById('decrementSize');
    const incrementBtn = document.getElementById('incrementSize');
    const totalTile = document.getElementById('workshopTotalTile');
    const totalAmount = document.getElementById('workshopTotalAmount');
    const perPaxAmount = document.getElementById('workshopPerPaxAmount');
    
    // Back button
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            showScreen('details');
        });
    }
    
    // Update size and UI (only when value is valid)
    function updateSize(value, allowEmpty = false) {
        // Convert to string if it's a number
        const stringValue = typeof value === 'string' ? value : String(value);
        const trimmedValue = stringValue.trim();
        
        // Allow empty input during typing
        if (allowEmpty && trimmedValue === '') {
            return;
        }
        
        const numValue = parseInt(trimmedValue);
        if (isNaN(numValue)) {
            return;
        }
        
        let clampedValue = numValue;
        
        // Clamp between 1 and 200
        if (clampedValue < 1) clampedValue = 1;
        if (clampedValue > 200) clampedValue = 200;
        
        AppState.workshop.pax = clampedValue;
        
        // Update input value only if it changed
        if (sizeInput && sizeInput.value !== clampedValue.toString()) {
            sizeInput.value = clampedValue;
        }
        
        // Update buttons
        if (decrementBtn) {
            decrementBtn.disabled = clampedValue <= 1;
        }
        if (incrementBtn) {
            incrementBtn.disabled = clampedValue >= 200;
        }
        
        // Show/hide workshop format options based on pax
        updateWorkshopFormats(clampedValue);
        
        // Recalculate price and update total tile
        calculatePrice();
        if (totalAmount) {
            totalAmount.textContent = `Php ${AppState.price.toLocaleString('en-US')}`;
        }
        if (perPaxAmount) {
            // Use the stored per-pax price from calculatePrice (includes format multiplier)
            const perPax = AppState.workshop.perPaxPrice || 2450;
            perPaxAmount.textContent = `Php ${Math.round(perPax).toLocaleString('en-US')}`;
        }
    }
    
    // Update workshop format visibility and duration
    function updateWorkshopFormats(pax) {
        const formatRow = document.getElementById('workshopFormatRow'); // Still uses same ID
        const crashCourseTile = document.getElementById('formatCrashCourse');
        const standardDuration = document.getElementById('standardDuration');
        const fullDuration = document.getElementById('fullDuration');
        
        if (!formatRow) return;
        
        // Don't show format column automatically - only when user clicks Next
        // formatRow.style.display = 'flex'; // Removed - will be shown via animation
        
        // Show crash course only for 20+ pax
        if (pax >= 20) {
            crashCourseTile.style.display = 'block';
        } else {
            crashCourseTile.style.display = 'none';
        }
        
        // Update durations based on actual pax (not effective pax for pricing)
        // Use actual pax for duration display
        if (pax >= 6 && pax <= 10) {
            if (standardDuration) standardDuration.textContent = '1 hr';
            if (fullDuration) fullDuration.textContent = '2.5 hr';
        } else if (pax >= 11 && pax <= 15) {
            if (standardDuration) standardDuration.textContent = '1.5 hr';
            if (fullDuration) fullDuration.textContent = '3 hr';
        } else if (pax >= 16 && pax <= 20) {
            if (standardDuration) standardDuration.textContent = '2 hr';
            if (fullDuration) fullDuration.textContent = '3.5 hr';
        } else if (pax < 6) {
            // For less than 6 pax, use 6-10 tier durations
            if (standardDuration) standardDuration.textContent = '1 hr';
            if (fullDuration) fullDuration.textContent = '2.5 hr';
        } else {
            // For 21+ pax, show default or calculate based on structure
            if (standardDuration) standardDuration.textContent = '2 hr';
            if (fullDuration) fullDuration.textContent = '3.5 hr';
        }
    }
    
    // Direct input editing
    if (sizeInput) {
        sizeInput.addEventListener('input', (e) => {
            const value = e.target.value;
            // Allow empty during typing, but validate if there's a value
            if (value === '') {
                // Don't update during typing if empty
                return;
            }
            updateSize(value, true);
        });
        
        sizeInput.addEventListener('blur', (e) => {
            const value = e.target.value.trim();
            // If empty on blur, reset to default (6)
            if (value === '') {
                sizeInput.value = 6;
                updateSize(6, false);
            } else {
                // Validate and clamp the value
                updateSize(value, false);
            }
        });
        
        // Initialize
        updateSize(sizeInput.value || 6, false);
        
        // Initialize format display (but keep hidden initially)
        updateWorkshopFormats(parseInt(sizeInput.value) || 6);
        
        // Set default format selection (Standard)
        const standardTile = document.querySelector('.format-tile[data-format="standard"]');
        if (standardTile) {
            standardTile.classList.add('active');
        }
        
        // Calculate and display initial price
        calculatePrice();
        if (totalAmount) {
            totalAmount.textContent = `Php ${AppState.price.toLocaleString('en-US')}`;
        }
        if (perPaxAmount) {
            const perPax = AppState.workshop.perPaxPrice || 2450;
            perPaxAmount.textContent = `Php ${Math.round(perPax).toLocaleString('en-US')}`;
        }
    }
    
    // Add click handlers for format tiles
    const formatTiles = document.querySelectorAll('.format-tile');
    formatTiles.forEach(tile => {
        tile.addEventListener('click', () => {
            // Remove active class from all tiles
            formatTiles.forEach(t => t.classList.remove('active'));
            // Add active class to clicked tile
            tile.classList.add('active');
            // Store selected format
            AppState.workshop.format = tile.dataset.format;
            // Recalculate price and update displays
            calculatePrice();
            if (totalAmount) {
                totalAmount.textContent = `Php ${AppState.price.toLocaleString('en-US')}`;
            }
            if (perPaxAmount) {
                // Update per-pax display with the calculated price (includes format multiplier)
                const perPax = AppState.workshop.perPaxPrice || 2450;
                perPaxAmount.textContent = `Php ${Math.round(perPax).toLocaleString('en-US')}`;
            }
        });
    });
    
    // Decrement button
    if (decrementBtn) {
        decrementBtn.addEventListener('click', () => {
            const current = parseInt(sizeInput.value) || 1;
            if (current > 1) {
                updateSize(current - 1);
            }
        });
    }
    
    // Increment button
    if (incrementBtn) {
        incrementBtn.addEventListener('click', () => {
            const current = parseInt(sizeInput.value) || 1;
            if (current < 200) {
                updateSize(current + 1);
            }
        });
    }
    
    // Next button
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const formatRow = document.getElementById('workshopFormatRow');
            const workshopSizeContent = document.querySelector('.workshop-size-content');
            
            // First click: Show format options with animation
            if (!formatsShown && formatRow) {
                formatsShown = true;
                // First, trigger pax controls animation by adding class
                // This starts the smooth upward movement
                if (workshopSizeContent) {
                    workshopSizeContent.classList.add('format-options-shown');
                }
                // Force a reflow to ensure the class is applied and animation starts
                if (workshopSizeContent) {
                    workshopSizeContent.offsetHeight;
                }
                // Wait for pax controls to start animating, then show format options
                // This ensures pax controls are already moving before format options affect layout
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        // Set display and trigger format options animation
                        formatRow.style.display = 'flex';
                        // Force reflow
                        formatRow.offsetHeight;
                        // Trigger animation by adding show class
                        requestAnimationFrame(() => {
                            formatRow.classList.add('show');
                        });
                    });
                });
            } else {
                // Second click: Proceed to next screen
                showScreen('workshop-experience');
            }
        });
    }
    
    // Reset formatsShown when screen is shown
    const workshopSizeScreen = screens['workshop-size'];
    if (workshopSizeScreen) {
        // Observe when workshop-size screen becomes active
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    if (workshopSizeScreen.classList.contains('active')) {
                        // Reset when screen becomes active
                        formatsShown = false;
                        const formatRow = document.getElementById('workshopFormatRow');
                        const workshopSizeContent = document.querySelector('.workshop-size-content');
                        if (formatRow) {
                            // Remove show class and hide immediately
                            formatRow.classList.remove('show');
                            formatRow.style.display = 'none';
                        }
                        // Remove class from parent to reset pax controls position
                        if (workshopSizeContent) {
                            workshopSizeContent.classList.remove('format-options-shown');
                        }
                    }
                }
            });
        });
        observer.observe(workshopSizeScreen, { attributes: true });
    }
}

// ============================================
// Workshop Experience Options Screen
// ============================================

function initWorkshopExperience() {
    const backBtn = document.getElementById('backFromWorkshopExperience');
    const nextBtn = document.getElementById('nextFromWorkshopExperience');
    const addonCheckboxes = document.querySelectorAll('.addon-checkbox');
    
    // Back button
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            showScreen('workshop-size');
        });
    }
    
    // Addon checkboxes
    addonCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const addon = e.target.dataset.addon;
            if (e.target.checked) {
                if (!AppState.workshop.addons.includes(addon)) {
                    AppState.workshop.addons.push(addon);
                }
            } else {
                AppState.workshop.addons = AppState.workshop.addons.filter(a => a !== addon);
            }
            // Recalculate price when addons change
            calculatePrice();
        });
    });
    
    // Next button
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            updateWorkshopQuote();
            showScreen('workshop-quote');
        });
    }
}

// ============================================
// Workshop Quote Summary Screen
// ============================================

function updateWorkshopQuote() {
    const quotePax = document.getElementById('quotePax');
    if (quotePax) {
        quotePax.textContent = AppState.workshop.pax;
    }
    
    calculatePrice();
}

function initWorkshopQuote() {
    const backBtn = document.getElementById('backFromWorkshopQuote');
    const detailsToggle = document.getElementById('toggleDetails');
    const detailsContent = document.getElementById('detailsContent');
    const saveBtn = document.getElementById('saveQuote');
    const requestBtn = document.getElementById('requestBooking');
    
    // Back button
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            showScreen('workshop-experience');
        });
    }
    
    // Details toggle
    if (detailsToggle && detailsContent) {
        detailsToggle.addEventListener('click', () => {
            const isVisible = detailsContent.style.display !== 'none';
            detailsContent.style.display = isVisible ? 'none' : 'block';
            detailsToggle.classList.toggle('active');
        });
    }
    
    // Save quote
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            // Save to localStorage for now (Firebase integration later)
            const quoteData = {
                service: AppState.service,
                eventDetails: AppState.eventDetails,
                workshop: AppState.workshop,
                price: AppState.price,
                timestamp: new Date().toISOString()
            };
            
            const savedQuotes = JSON.parse(localStorage.getItem('matchaneseQuotes') || '[]');
            savedQuotes.push(quoteData);
            localStorage.setItem('matchaneseQuotes', JSON.stringify(savedQuotes));
            
            alert('Quote saved!');
        });
    }
    
    // Request booking
    if (requestBtn) {
        requestBtn.addEventListener('click', () => {
            // Booking request logic (Firebase integration later)
            alert('Booking request submitted! We\'ll contact you soon.');
        });
    }
}

// ============================================
// Date Picker
// ============================================

function initDatePicker() {
    const monthBtn = document.getElementById('dateMonth');
    const dayBtn = document.getElementById('dateDay');
    const yearBtn = document.getElementById('dateYear');
    const calendarBtn = document.getElementById('dateCalendar');
    const dateInput = document.getElementById('inputDate');
    const monthValue = document.getElementById('monthValue');
    const dayValue = document.getElementById('dayValue');
    const yearValue = document.getElementById('yearValue');
    
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();
    const currentDay = currentDate.getDate();
    
    let selectedMonth = null;
    let selectedDay = null;
    let selectedYear = currentYear; // Default to current year
    let activeDropdown = null;
    
    const years = [];
    for (let i = 0; i < 10; i++) {
        years.push(currentYear + i);
    }
    
    // Get days in month (considering leap years)
    function getDaysInMonth(month, year) {
        if (month === null || year === null) return 31;
        return new Date(year, month + 1, 0).getDate();
    }
    
    // Update date display
    function updateDisplay() {
        monthValue.textContent = selectedMonth === null ? 'TBD' : months[selectedMonth];
        dayValue.textContent = selectedDay === null ? 'TBD' : selectedDay.toString();
        yearValue.textContent = selectedYear === null ? '-' : selectedYear.toString();
        
        // Update hidden date input - use first day/month when TBD
        if (selectedYear !== null) {
            // Use first month (January = 0) if month is TBD
            const monthToUse = selectedMonth !== null ? selectedMonth : 0;
            // Use first day (1) if day is TBD
            const dayToUse = selectedDay !== null ? selectedDay : 1;
            
            const monthStr = String(monthToUse + 1).padStart(2, '0');
            const dayStr = String(dayToUse).padStart(2, '0');
            dateInput.value = `${selectedYear}-${monthStr}-${dayStr}`;
            
            // Store actual selected values in state
            AppState.eventDetails.dateValue = dateInput.value;
            if (selectedMonth !== null && selectedDay !== null) {
                AppState.eventDetails.date = dateInput.value;
            } else if (selectedMonth !== null) {
                AppState.eventDetails.date = `${months[selectedMonth]} ${selectedYear}`;
            } else {
                AppState.eventDetails.date = selectedYear.toString();
            }
        } else {
            dateInput.value = '';
            AppState.eventDetails.dateValue = null;
            AppState.eventDetails.date = 'tbd';
        }
    }
    
    // Close dropdown
    function closeDropdown() {
        if (activeDropdown) {
            activeDropdown.remove();
            activeDropdown = null;
            [monthBtn, dayBtn, yearBtn].forEach(btn => btn.classList.remove('active'));
        }
    }
    
    // Create dropdown
    function createDropdown(items, selected, onSelect, button) {
        closeDropdown();
        
        const dropdown = document.createElement('div');
        dropdown.className = 'date-dropdown';
        const rect = button.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.top = (rect.bottom + 4) + 'px';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.width = rect.width + 'px';
        
        items.forEach((item, index) => {
            const option = document.createElement('div');
            option.className = 'date-dropdown-item';
            if (selected === item || selected === index) {
                option.classList.add('selected');
            }
            option.textContent = item;
            option.addEventListener('click', () => {
                onSelect(item, index);
                closeDropdown();
            });
            dropdown.appendChild(option);
        });
        
        document.body.appendChild(dropdown);
        activeDropdown = dropdown;
        button.classList.add('active');
        
        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', function closeOnOutside(e) {
                if (!dropdown.contains(e.target) && !button.contains(e.target)) {
                    closeDropdown();
                    document.removeEventListener('click', closeOnOutside);
                }
            });
        }, 0);
    }
    
    // Month button
    monthBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        let availableMonths = months;
        let startIndex = 0;
        
        // If current year, only show future months
        if (selectedYear === currentYear) {
            startIndex = currentMonth;
            availableMonths = months.slice(currentMonth);
        }
        
        const items = ['TBD', ...availableMonths];
        createDropdown(items, selectedMonth === null ? 'TBD' : months[selectedMonth], (item, index) => {
            if (item === 'TBD') {
                selectedMonth = null;
                // If month becomes TBD, day must also become TBD (can't have day without month)
                if (selectedDay !== null) {
                    selectedDay = null;
                }
            } else {
                // Find actual month index
                const monthIndex = months.indexOf(item);
                selectedMonth = monthIndex;
                // Validate day if month changed
                if (selectedDay !== null && selectedYear !== null) {
                    const maxDays = getDaysInMonth(selectedMonth, selectedYear);
                    if (selectedDay > maxDays) {
                        selectedDay = null;
                    }
                    // If current month, validate day is in future
                    if (selectedYear === currentYear && selectedMonth === currentMonth && selectedDay !== null) {
                        if (selectedDay <= currentDay) {
                            selectedDay = null;
                        }
                    }
                }
            }
            updateDisplay();
        }, monthBtn);
    });
    
    // Day button
    dayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedMonth === null || selectedYear === null) {
            // Need month and year first to select a day
            // If month is TBD, day must also be TBD
            return;
        }
        const maxDays = getDaysInMonth(selectedMonth, selectedYear);
        let minDay = 1;
        
        // If current year and month, restrict to future days
        if (selectedYear === currentYear && selectedMonth === currentMonth) {
            minDay = currentDay + 1;
        }
        
        const days = [];
        for (let i = minDay; i <= maxDays; i++) {
            days.push(i);
        }
        
        const items = ['TBD', ...days];
        createDropdown(items, selectedDay === null ? 'TBD' : selectedDay.toString(), (item) => {
            if (item === 'TBD') {
                selectedDay = null;
            } else {
                selectedDay = parseInt(item);
            }
            updateDisplay();
        }, dayBtn);
    });
    
    // Year button
    yearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const items = years.map(y => y.toString());
        createDropdown(items, selectedYear === null ? null : selectedYear.toString(), (item) => {
            const newYear = parseInt(item);
            selectedYear = newYear;
            
            // Validate month if year changed
            if (selectedMonth !== null && newYear === currentYear) {
                if (selectedMonth < currentMonth) {
                    selectedMonth = null;
                }
            }
            
            // Validate day if year changed
            if (selectedDay !== null && selectedMonth !== null) {
                const maxDays = getDaysInMonth(selectedMonth, selectedYear);
                if (selectedDay > maxDays) {
                    selectedDay = null;
                }
                // If current year and month, validate day is in future
                if (selectedYear === currentYear && selectedMonth === currentMonth) {
                    if (selectedDay <= currentDay) {
                        selectedDay = null;
                    }
                }
            }
            updateDisplay();
        }, yearBtn);
    });
    
    // Calendar button
    calendarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDropdown();
        dateInput.showPicker();
    });
    
    // Sync from date input (calendar picker)
    if (dateInput) {
        // Set min date to today
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateInput.min = tomorrow.toISOString().split('T')[0];
        
        dateInput.addEventListener('change', (e) => {
            const date = new Date(e.target.value);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            if (date && !isNaN(date.getTime()) && date > today) {
                selectedYear = date.getFullYear();
                selectedMonth = date.getMonth();
                selectedDay = date.getDate();
                updateDisplay();
            }
        });
    }
    
    // Initialize
    updateDisplay();
}

// ============================================
// Initialize App
// ============================================

function initApp() {
    // Initialize all screens
    initServiceSelection();
    initEventDetails();
    initWorkshopSize();
    initWorkshopExperience();
    initWorkshopQuote();
    
    // Start on service selection screen
    showScreen('service');
}

// Run when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
