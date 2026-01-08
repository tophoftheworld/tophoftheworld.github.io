// Package data
const packages = {
    starter: {
        name: 'Starter Package',
        rates: {
            50: 13500,
            100: 22500,
            150: 31500
        }
    },
    signature: {
        name: 'Signature Package',
        rates: {
            50: 14750,
            100: 25750,
            150: 36750
        }
    },
    special: {
        name: 'Special Package',
        rates: {
            50: 16500,
            100: 28500,
            150: 41500
        }
    }
};

// State
let selectedPackage = null;
let selectedCups = null;
let customCups = null;
let hours = 3;
let baristas = 3;
let location = 'metro';

// DOM Elements
const packageTiles = document.querySelectorAll('.package-tile');
const selectPackageBtns = document.querySelectorAll('.select-package-btn');
const cupTiles = document.querySelectorAll('.cup-tile:not(.custom)');
const customCupsInput = document.getElementById('customCups');
const hoursDisplay = document.getElementById('hoursDisplay');
const decrementHoursBtn = document.getElementById('decrementHours');
const incrementHoursBtn = document.getElementById('incrementHours');
const baristasDisplay = document.getElementById('baristasDisplay');
const decrementBaristasBtn = document.getElementById('decrementBaristas');
const incrementBaristasBtn = document.getElementById('incrementBaristas');
const locationTiles = document.querySelectorAll('.location-tile');
const inclusionHours = document.getElementById('inclusion-hours');
const inclusionBaristas = document.getElementById('inclusion-baristas');
const quotePackage = document.getElementById('quote-package');
const quoteCups = document.getElementById('quote-cups');
const quoteHours = document.getElementById('quote-hours');
const quoteBaristas = document.getElementById('quote-baristas');
const quoteLocation = document.getElementById('quote-location');
const quoteTotal = document.getElementById('quote-total');
const generateQuoteBtn = document.getElementById('generateQuoteBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    updateQuote();
    // Set default location
    locationTiles[0].classList.add('selected');
});

// Event Listeners
function setupEventListeners() {
    // Package selection
    selectPackageBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const packageType = e.target.dataset.package;
            selectedPackage = packageType;
            updatePackageSelection();
            updateQuote();
        });
    });

    // Cups selection
    cupTiles.forEach(tile => {
        tile.addEventListener('click', (e) => {
            const cups = parseInt(e.target.dataset.cups);
            cupTiles.forEach(t => t.classList.remove('selected'));
            e.target.classList.add('selected');
            customCupsInput.value = '';
            selectedCups = cups;
            customCups = null;
            updateQuote();
        });
    });

    // Custom cups input
    customCupsInput.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        if (value && value > 0) {
            cupTiles.forEach(t => t.classList.remove('selected'));
            customCups = value;
            selectedCups = null;
        } else {
            customCups = null;
        }
        updateQuote();
    });

    // Hours controls
    decrementHoursBtn.addEventListener('click', () => {
        if (hours > 1) {
            hours--;
            hoursDisplay.textContent = hours;
            updateInclusions();
            updateQuote();
        }
    });

    incrementHoursBtn.addEventListener('click', () => {
        if (hours < 12) {
            hours++;
            hoursDisplay.textContent = hours;
            updateInclusions();
            updateQuote();
        }
    });

    // Baristas controls
    decrementBaristasBtn.addEventListener('click', () => {
        if (baristas > 1) {
            baristas--;
            baristasDisplay.textContent = baristas;
            updateInclusions();
            updateQuote();
        }
    });

    incrementBaristasBtn.addEventListener('click', () => {
        if (baristas < 10) {
            baristas++;
            baristasDisplay.textContent = baristas;
            updateInclusions();
            updateQuote();
        }
    });

    // Location selection
    locationTiles.forEach(tile => {
        tile.addEventListener('click', (e) => {
            locationTiles.forEach(t => t.classList.remove('selected'));
            e.target.classList.add('selected');
            location = e.target.dataset.location;
            updateQuote();
        });
    });

    // Generate quote button
    generateQuoteBtn.addEventListener('click', () => {
        if (selectedPackage && (selectedCups || customCups)) {
            showToast('Quote generation feature coming soon!');
        }
    });
}

// Update package selection UI
function updatePackageSelection() {
    packageTiles.forEach(tile => {
        const packageValue = tile.dataset.package;
        if (packageValue === selectedPackage) {
            tile.classList.add('selected');
        } else {
            tile.classList.remove('selected');
        }
    });
}

// Update inclusions display
function updateInclusions() {
    inclusionHours.innerHTML = `${hours} Hours<br><span class="tile-subtext">Service Duration</span>`;
    inclusionBaristas.innerHTML = `${baristas} Baristas<br><span class="tile-subtext">On Site</span>`;
}

// Update quote display
function updateQuote() {
    // Update package
    if (selectedPackage) {
        quotePackage.textContent = packages[selectedPackage].name;
    } else {
        quotePackage.textContent = 'Not selected';
    }

    // Update cups
    const totalCups = selectedCups || customCups;
    if (totalCups) {
        quoteCups.textContent = totalCups.toLocaleString();
    } else {
        quoteCups.textContent = '-';
    }

    // Update hours
    quoteHours.textContent = hours;

    // Update baristas
    quoteBaristas.textContent = baristas;

    // Update location
    quoteLocation.textContent = location === 'metro' ? 'Metro Manila' : 'Outside Metro Manila';

    // Update total
    if (selectedPackage && totalCups) {
        const packageData = packages[selectedPackage];
        let basePrice = 0;
        
        // Get base price from rates if it's a standard cup count
        if (selectedCups && packageData.rates[selectedCups]) {
            basePrice = packageData.rates[selectedCups];
        } else if (customCups) {
            // For custom cups, we'll use interpolation or default pricing
            // This is a placeholder - actual calculation will be implemented later
            basePrice = packageData.rates[100] || 0;
        }
        
        quoteTotal.textContent = `Php ${basePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        generateQuoteBtn.disabled = false;
    } else {
        quoteTotal.textContent = 'Php 0.00';
        generateQuoteBtn.disabled = true;
    }
}

// Toast notification
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
