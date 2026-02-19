// Get DOM elements
const participantNameInput = document.getElementById('participantName');
const certificateDateInput = document.getElementById('certificateDate');
const venueInput = document.getElementById('venue');

const displayParticipantName = document.getElementById('displayParticipantName');
const displayDate = document.getElementById('displayDate');
const displayVenue = document.getElementById('displayVenue');

const downloadPNGBtn = document.getElementById('downloadPNG');
const downloadPDFBtn = document.getElementById('downloadPDF');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const galleryCounter = document.getElementById('galleryCounter');

// State management
let participantNames = [];
let currentIndex = 0;

// Format date to "26th Day of April" format
function formatDate(dateString) {
    if (!dateString) return 'Date';
    
    const date = new Date(dateString + 'T00:00:00'); // Add time to avoid timezone issues
    if (isNaN(date.getTime())) return 'Date';
    
    const day = date.getDate();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const month = monthNames[date.getMonth()];
    
    // Get ordinal suffix (st, nd, rd, th)
    function getOrdinalSuffix(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return s[(v - 20) % 10] || s[v] || s[0];
    }
    
    return `${day}${getOrdinalSuffix(day)} Day of ${month}`;
}

// Parse names from textarea (one per line)
function parseNames() {
    const text = participantNameInput.value;
    if (!text || text.trim().length === 0) {
        // If completely empty, use default
        participantNames = ['Participant Name'];
    } else {
        // Split by newline and keep all lines (empty lines become blank certificates)
        participantNames = text.split('\n')
            .map(line => line.trim());
    }
    return participantNames;
}

// Update certificate display
function updateCertificate() {
    parseNames();
    if (participantNames.length === 0) {
        participantNames = ['Participant Name'];
    }
    
    // Ensure currentIndex is valid
    if (currentIndex >= participantNames.length) {
        currentIndex = participantNames.length - 1;
    }
    if (currentIndex < 0) {
        currentIndex = 0;
    }
    
    // Update display - empty string means blank certificate
    const currentName = participantNames[currentIndex] || '';
    displayParticipantName.textContent = currentName || '';
    displayDate.textContent = formatDate(certificateDateInput.value);
    displayVenue.textContent = venueInput.value || 'Venue';
    
    // Update gallery controls
    updateGalleryControls();
}

// Update gallery navigation controls
function updateGalleryControls() {
    const total = participantNames.length;
    galleryCounter.textContent = `${currentIndex + 1} / ${total}`;
    
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex >= total - 1;
}

// Navigation functions
prevBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
        currentIndex--;
        updateCertificate();
    }
});

nextBtn.addEventListener('click', () => {
    if (currentIndex < participantNames.length - 1) {
        currentIndex++;
        updateCertificate();
    }
});

// Set default date to today
const today = new Date();
certificateDateInput.value = today.toISOString().split('T')[0];

// Event listeners for real-time updates
participantNameInput.addEventListener('input', updateCertificate);
certificateDateInput.addEventListener('change', updateCertificate);
venueInput.addEventListener('input', updateCertificate);

// Initialize certificate display
updateCertificate();

// Helper function to ensure images are loaded and preserve aspect ratios
async function ensureImagesLoaded(certificate) {
    const images = certificate.querySelectorAll('img');
    
    // Wait for all images to load
    await Promise.all(Array.from(images).map(img => {
        if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            // Force reload if already loaded but dimensions not set
            if (img.complete && img.naturalWidth === 0) {
                const src = img.src;
                img.src = '';
                img.src = src;
            }
        });
    }));
    
    // After all images are loaded, set explicit dimensions preserving aspect ratio
    images.forEach(img => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            const aspectRatio = img.naturalWidth / img.naturalHeight;
            if (img.classList.contains('signature-image')) {
                // For signatures, maintain width from CSS (130px), calculate height
                const targetWidth = 130;
                let calculatedHeight = targetWidth / aspectRatio;
                // Cap height at 50px
                if (calculatedHeight > 50) {
                    calculatedHeight = 50;
                    // If capped, recalculate width to maintain aspect ratio
                    const adjustedWidth = calculatedHeight * aspectRatio;
                    img.setAttribute('width', adjustedWidth);
                    img.setAttribute('height', calculatedHeight);
                    img.style.width = `${adjustedWidth}px`;
                    img.style.height = `${calculatedHeight}px`;
                } else {
                    img.setAttribute('width', targetWidth);
                    img.setAttribute('height', calculatedHeight);
                    img.style.width = `${targetWidth}px`;
                    img.style.height = `${calculatedHeight}px`;
                }
                img.style.maxWidth = 'none';
                img.style.maxHeight = 'none';
                img.style.objectFit = 'contain';
                img.style.objectPosition = 'center';
            } else if (img.classList.contains('company-logo')) {
                // For logo, maintain height from CSS (45px), calculate width
                const targetHeight = 45;
                let calculatedWidth = targetHeight * aspectRatio;
                // Cap width at 200px
                if (calculatedWidth > 200) {
                    calculatedWidth = 200;
                    // If capped, recalculate height to maintain aspect ratio
                    const adjustedHeight = calculatedWidth / aspectRatio;
                    img.setAttribute('width', calculatedWidth);
                    img.setAttribute('height', adjustedHeight);
                    img.style.width = `${calculatedWidth}px`;
                    img.style.height = `${adjustedHeight}px`;
                } else {
                    img.setAttribute('width', calculatedWidth);
                    img.setAttribute('height', targetHeight);
                    img.style.width = `${calculatedWidth}px`;
                    img.style.height = `${targetHeight}px`;
                }
                img.style.maxWidth = 'none';
                img.style.maxHeight = 'none';
                img.style.objectFit = 'contain';
                img.style.objectPosition = 'center';
            }
        }
    });
}

// Helper function to capture certificate as canvas
async function captureCertificate(certificate) {
    await ensureImagesLoaded(certificate);
    
    // Store original image dimensions and attributes
    const images = certificate.querySelectorAll('img');
    const imageData = Array.from(images).map(img => ({
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        aspectRatio: img.naturalWidth / img.naturalHeight,
        className: img.className,
        width: img.getAttribute('width'),
        height: img.getAttribute('height'),
        styleWidth: img.style.width,
        styleHeight: img.style.height
    }));
    
    return await html2canvas(certificate, {
        scale: 3, // High quality
        backgroundColor: null,
        useCORS: true,
        allowTaint: true,
        logging: false,
        width: certificate.offsetWidth,
        height: certificate.offsetHeight,
        imageTimeout: 15000,
        removeContainer: true,
        onclone: (clonedDoc, element) => {
            // Find cloned images and ensure aspect ratio preservation
            const clonedImages = clonedDoc.querySelectorAll('img');
            clonedImages.forEach((clonedImg, index) => {
                if (index < imageData.length) {
                    const data = imageData[index];
                    
                    // Set explicit width and height attributes
                    if (data.width) clonedImg.setAttribute('width', data.width);
                    if (data.height) clonedImg.setAttribute('height', data.height);
                    
                    // Set explicit styles
                    clonedImg.style.width = data.styleWidth;
                    clonedImg.style.height = data.styleHeight;
                    clonedImg.style.maxWidth = 'none';
                    clonedImg.style.maxHeight = 'none';
                    clonedImg.style.objectFit = 'contain';
                    clonedImg.style.objectPosition = 'center';
                    clonedImg.style.imageRendering = 'auto';
                    clonedImg.style.boxSizing = 'border-box';
                    
                    // Remove any conflicting CSS that might stretch
                    clonedImg.style.aspectRatio = 'auto';
                }
            });
        }
    });
}

// Helper function to disable/enable all form controls
function setFormControlsEnabled(enabled) {
    participantNameInput.disabled = !enabled;
    certificateDateInput.disabled = !enabled;
    venueInput.disabled = !enabled;
    downloadPNGBtn.disabled = !enabled;
    downloadPDFBtn.disabled = !enabled;
    prevBtn.disabled = !enabled;
    nextBtn.disabled = !enabled;
}

// Download PNG function (current certificate only)
downloadPNGBtn.addEventListener('click', async () => {
    try {
        const certificate = document.getElementById('certificate');
        
        // Show loading state and disable all controls
        downloadPNGBtn.textContent = 'Generating...';
        setFormControlsEnabled(false);
        
        const canvas = await captureCertificate(certificate);
        
        // Convert canvas to blob and download
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const name = participantNames[currentIndex] || '';
            const fileName = name.trim() || 'Blank_Certificate';
            link.href = url;
            link.download = `Certificate_${fileName.replace(/\s+/g, '_')}.png`;
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

// Download PDF function (all certificates, one per page)
downloadPDFBtn.addEventListener('click', async () => {
    try {
        parseNames();
        if (participantNames.length === 0 || participantNames.every(name => name.trim().length === 0)) {
            alert('Please enter at least one participant name or blank line.');
            return;
        }
        
        // Show loading state and disable all controls
        downloadPDFBtn.textContent = 'Generating...';
        setFormControlsEnabled(false);
        
        const certificate = document.getElementById('certificate');
        const originalName = displayParticipantName.textContent;
        const imgWidth = 21; // cm
        const imgHeight = 14.8; // cm
        
        // Create PDF using jsPDF
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'cm',
            format: [imgWidth, imgHeight]
        });
        
        // Generate certificate for each name (including blank lines)
        for (let i = 0; i < participantNames.length; i++) {
            // Update certificate to show current name (empty string for blank certificates)
            const name = participantNames[i] || '';
            displayParticipantName.textContent = name;
            
            // Wait a bit for DOM to update
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Capture certificate
            const canvas = await captureCertificate(certificate);
            const imgData = canvas.toDataURL('image/png');
            
            // Add page if not first
            if (i > 0) {
                pdf.addPage([imgWidth, imgHeight], 'landscape');
            }
            
            // Add image to PDF (full page)
            pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight, undefined, 'FAST');
        }
        
        // Restore original display
        displayParticipantName.textContent = originalName;
        updateCertificate();
        
        // Download PDF
        pdf.save(`Certificates_${participantNames.length}_participants.pdf`);
        
        // Reset button and re-enable controls
        downloadPDFBtn.textContent = 'Download PDF';
        setFormControlsEnabled(true);
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Error generating PDF. Please try again.');
        downloadPDFBtn.textContent = 'Download PDF';
        setFormControlsEnabled(true);
        // Restore display
        updateCertificate();
    }
});

// Handle image loading errors (show placeholder)
document.addEventListener('DOMContentLoaded', () => {
    const images = ['signature1', 'signature2', 'companyLogo'];
    
    images.forEach(imgId => {
        const img = document.getElementById(imgId);
        if (img) {
            img.addEventListener('error', function() {
                // Create a placeholder if image fails to load
                this.style.display = 'none';
                const placeholder = document.createElement('div');
                placeholder.style.cssText = `
                    width: ${imgId === 'companyLogo' ? '150px' : '150px'};
                    height: ${imgId === 'companyLogo' ? '50px' : '60px'};
                    background: #e0e0e0;
                    border: 2px dashed #999;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #666;
                    font-size: 12px;
                    margin: ${imgId === 'companyLogo' ? '0 auto' : '0 auto 10px'};
                `;
                placeholder.textContent = imgId === 'companyLogo' ? 'Logo' : 'Signature';
                img.parentNode.insertBefore(placeholder, img);
            });
        }
    });
});
