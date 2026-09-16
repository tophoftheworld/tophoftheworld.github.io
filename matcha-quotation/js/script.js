// Package data
const packages = {
    starter: {
        name: 'Starter Package',
        choiceSlots: 1,
        totalSlots: 3,
        rates: {
            100: 29500,
            150: 43500
        }
    },
    signature: {
        name: 'Signature Package',
        choiceSlots: 3,
        totalSlots: 5,
        rates: {
            100: 32500,
            150: 46750
        }
    },
    special: {
        name: 'Special Package',
        choiceSlots: 5,
        totalSlots: 7,
        rates: {
            100: 36000,
            150: 52000
        }
    }
};

const MOBILE_BAR_CUP_TIERS = [100, 150];

function computeMobileBarPackagePrice(packageData, cups) {
    const n = parseInt(cups, 10);
    if (!packageData?.rates || !n || n <= 0) return 0;
    if (packageData.rates[n] != null) return packageData.rates[n];

    const rates = packageData.rates;
    const tiers = MOBILE_BAR_CUP_TIERS;
    let lower;
    let upper;

    if (n < tiers[0]) {
        lower = tiers[0];
        upper = tiers[1];
    } else if (n > tiers[tiers.length - 1]) {
        lower = tiers[tiers.length - 2];
        upper = tiers[tiers.length - 1];
    } else {
        for (let i = 0; i < tiers.length - 1; i++) {
            if (n > tiers[i] && n < tiers[i + 1]) {
                lower = tiers[i];
                upper = tiers[i + 1];
                break;
            }
        }
    }

    const slope = (rates[upper] - rates[lower]) / (upper - lower);
    const anchor = n > tiers[tiers.length - 1] ? upper : lower;
    return Math.round(rates[anchor] + (n - anchor) * slope);
}

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
            basePrice = computeMobileBarPackagePrice(packageData, customCups);
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
