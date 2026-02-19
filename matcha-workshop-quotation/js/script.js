// Get DOM elements
const numPaxInput = document.getElementById('numPax');
const pricingOptionsContainer = document.getElementById('pricingOptions');
const downloadPNGBtn = document.getElementById('downloadPNG');
const downloadPDFBtn = document.getElementById('downloadPDF');

// Default pricing tiers
const PRICING_TIERS = [
    { pax: 6, pricePerPax: 2450, total: 14700 },
    { pax: 10, pricePerPax: 2150, total: 21500 },
    { pax: 15, pricePerPax: 1950, total: 29250 }
];

// Calculate pricing options based on number of pax
function calculatePricingOptions(numPax) {
    const effectivePax = Math.max(6, numPax); // Minimum 6 pax
    
    // Determine which tier the input falls into
    let baseTierIndex = 0;
    if (effectivePax >= 15) {
        baseTierIndex = 2; // 15 pax tier
    } else if (effectivePax >= 10) {
        baseTierIndex = 1; // 10 pax tier
    } else {
        baseTierIndex = 0; // 6 pax tier
    }
    
    // Generate 3 options around the base tier
    const options = [];
    
    // Option 1: One tier below (if available) or same tier
    if (baseTierIndex > 0) {
        options.push(PRICING_TIERS[baseTierIndex - 1]);
    } else {
        options.push(PRICING_TIERS[baseTierIndex]);
    }
    
    // Option 2: Current tier
    options.push(PRICING_TIERS[baseTierIndex]);
    
    // Option 3: One tier above (if available) or same tier
    if (baseTierIndex < PRICING_TIERS.length - 1) {
        options.push(PRICING_TIERS[baseTierIndex + 1]);
    } else {
        options.push(PRICING_TIERS[baseTierIndex]);
    }
    
    return options;
}

// Format currency
function formatCurrency(amount) {
    return `Php ${amount.toLocaleString('en-US')}`;
}

// Update pricing display
function updatePricing() {
    const numPax = parseInt(numPaxInput.value) || 6;
    const options = calculatePricingOptions(numPax);
    
    pricingOptionsContainer.innerHTML = '';
    
    options.forEach((option, index) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'pricing-option';
        
        optionDiv.innerHTML = `
            <div class="pricing-option-left">
                <div class="pax-count">${option.pax} pax</div>
                <div class="price-per-pax">${formatCurrency(option.pricePerPax)} per pax</div>
            </div>
            <div class="pricing-option-right">
                <div class="duration">1 Hour</div>
                <div class="pricing-option-total">${formatCurrency(option.total)}</div>
            </div>
        `;
        
        pricingOptionsContainer.appendChild(optionDiv);
    });
}

// Event listener for input changes
numPaxInput.addEventListener('input', updatePricing);

// Initialize pricing display
updatePricing();

// Helper function to disable/enable all form controls
function setFormControlsEnabled(enabled) {
    numPaxInput.disabled = !enabled;
    downloadPNGBtn.disabled = !enabled;
    downloadPDFBtn.disabled = !enabled;
}

// Download PNG function
downloadPNGBtn.addEventListener('click', async () => {
    try {
        const proposal = document.getElementById('proposal');
        
        // Show loading state and disable all controls
        downloadPNGBtn.textContent = 'Generating...';
        setFormControlsEnabled(false);
        
        const canvas = await html2canvas(proposal, {
            scale: 3,
            backgroundColor: null,
            useCORS: true,
            allowTaint: true,
            logging: false,
            width: proposal.offsetWidth,
            height: proposal.offsetHeight
        });
        
        // Convert canvas to blob and download
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const numPax = numPaxInput.value || '6';
            link.href = url;
            link.download = `Matcha_Workshop_Quotation_${numPax}pax.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            
            // Reset button and re-enable controls
            downloadPNGBtn.textContent = 'Download PNG';
            setFormControlsEnabled(true);
        }, 'image/png', 1.0);
    } catch (error) {
        console.error('Error generating PNG:', error);
        alert('Error generating PNG. Please try again.');
        downloadPNGBtn.textContent = 'Download PNG';
        setFormControlsEnabled(true);
    }
});

// Download PDF function
downloadPDFBtn.addEventListener('click', async () => {
    try {
        const proposal = document.getElementById('proposal');
        
        // Show loading state and disable all controls
        downloadPDFBtn.textContent = 'Generating...';
        setFormControlsEnabled(false);
        
        const canvas = await html2canvas(proposal, {
            scale: 3,
            backgroundColor: null,
            useCORS: true,
            allowTaint: true,
            logging: false,
            width: proposal.offsetWidth,
            height: proposal.offsetHeight
        });
        
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = 1280; // px
        const imgHeight = 720; // px (16:9 aspect ratio)
        
        // Create PDF using jsPDF
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'px',
            format: [imgWidth, imgHeight]
        });
        
        // Add image to PDF (full page)
        pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight, undefined, 'FAST');
        
        // Download PDF
        const numPax = numPaxInput.value || '6';
        pdf.save(`Matcha_Workshop_Quotation_${numPax}pax.pdf`);
        
        // Reset button and re-enable controls
        downloadPDFBtn.textContent = 'Download PDF';
        setFormControlsEnabled(true);
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Error generating PDF. Please try again.');
        downloadPDFBtn.textContent = 'Download PDF';
        setFormControlsEnabled(true);
    }
});
