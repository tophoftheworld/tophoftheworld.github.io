# Certificate Generator App

A web application for generating professional certificates of participation with customizable participant names, dates, and venues.

## Features

- Real-time certificate preview
- Download as PNG (high quality)
- Download as PDF (21cm x 14.8cm - A5 landscape)
- Customizable participant name, date, venue, and workshop name
- Professional design matching Matchanese branding

## Image Placement Instructions

**IMPORTANT**: Replace the placeholder SVG files with your actual images. Place the following images in the `img/` directory:

### 1. Logo (`img/logo.png`)
- **File to replace**: `img/logo.svg` (delete this, add your `logo.png`)
- **Location on certificate**: Bottom center, below the signatures
- **Recommended size**: Height ~50px, width auto (maintain aspect ratio)
- **Format**: PNG with transparent background preferred
- **Description**: Company logo (stylized cat head with "matchanese" text)
- **Current placeholder**: SVG placeholder will show if PNG is missing

### 2. Signature 1 (`img/signature1.png`)
- **File to replace**: `img/signature1.svg` (delete this, add your `signature1.png`)
- **Location on certificate**: Left side of signatures section (for "Bea Boldo")
- **Recommended size**: Width ~150px, Height ~60px
- **Format**: PNG with transparent background
- **Description**: Handwritten signature for "Bea Boldo"
- **Current placeholder**: SVG placeholder will show if PNG is missing

### 3. Signature 2 (`img/signature2.png`)
- **File to replace**: `img/signature2.svg` (delete this, add your `signature2.png`)
- **Location on certificate**: Right side of signatures section (for "Cristopher David")
- **Recommended size**: Width ~150px, Height ~60px
- **Format**: PNG with transparent background
- **Description**: Handwritten signature for "Cristopher David"
- **Current placeholder**: SVG placeholder will show if PNG is missing

### 4. Background Texture (Optional) (`img/background-texture.png`)
- **File to replace**: `img/background-texture.svg` (delete this, add your `background-texture.png`)
- **Location on certificate**: Behind the green border (subtle texture overlay)
- **Recommended size**: Any size (will be tiled/covered automatically)
- **Format**: PNG or JPG
- **Description**: Subtle texture pattern for the green border area (optional - app works without it)
- **Current placeholder**: SVG placeholder will show if PNG is missing

## Fonts Used

The app uses Google Fonts loaded automatically:

1. **Dancing Script** (for "Certificate of Participation" title)
   - Weight: 700 (Bold)
   - Size: 56px
   - Color: Green (#4a7c2a)

2. **Open Sans** (for all other text)
   - Weights: 400 (Regular), 600 (Semi-bold), 700 (Bold)
   - Various sizes:
     - Intro text: 14px
     - Participant name: 42px (Bold)
     - Recognition text: 14px
     - Signature names: 16px (Semi-bold)
     - Signature titles: 12px
     - Company name: 14px (Semi-bold)

## Certificate Dimensions

- **Size**: 21cm x 14.8cm (A5 landscape)
- **Border**: Green gradient (#4a7c2a to #5a9c3a)
- **Content area**: White with rounded corners
- **Padding**: 30px margin from border

## Usage

1. Open `index.html` in a web browser
2. Fill in the form fields:
   - Participant Name
   - Date (e.g., "26th Day of April")
   - Venue
   - Workshop Name
3. Preview updates in real-time
4. Click "Download PNG" or "Download PDF" to save the certificate

## File Structure

```
certificate-generator/
├── index.html          # Main HTML file
├── css/
│   └── style.css       # Certificate styling
├── js/
│   └── script.js       # Download functionality
├── img/
│   ├── logo.png        # Company logo (place here)
│   ├── signature1.png  # First signature (place here)
│   ├── signature2.png  # Second signature (place here)
│   └── background-texture.png  # Optional background texture
└── README.md           # This file
```

## Dependencies

- **html2canvas** (v1.4.1) - For PNG export
- **jsPDF** (v2.5.1) - For PDF export
- **Google Fonts** - Dancing Script & Open Sans

All dependencies are loaded via CDN, so no installation is required.

## Notes

- If images are missing, placeholder boxes will appear
- The certificate maintains its aspect ratio on smaller screens
- For best results, use high-resolution images (at least 300 DPI equivalent)

