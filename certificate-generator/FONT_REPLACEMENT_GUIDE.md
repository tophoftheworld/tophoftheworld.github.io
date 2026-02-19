# Font Replacement Guide

## Current Fonts Used

1. **Dancing Script** - Used for "Certificate of Participation" title
2. **Open Sans** - Used for all other text (intro, participant name, recognition text, signatures)

## Where to Replace Fonts

### 1. Google Fonts Loading (index.html)

**Location:** `certificate-generator/index.html` - Lines 8-11

```html
<!-- Google Fonts for certificate text -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;600;700&family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
```

**To replace with different Google Fonts:**
- Change the font names in the URL (e.g., replace `Dancing+Script` and `Open+Sans` with your chosen fonts)
- Update the font-family names in CSS (see below)

### 2. Font Usage in CSS (css/style.css)

#### Title Font (Dancing Script)
**Location:** Line 160
```css
.certificate-title {
    font-family: 'Dancing Script', cursive;
    /* ... */
}
```

#### Body Font (Open Sans)
**Locations:** Lines 170, 179, 188, 226, 235, 243
- `.certificate-intro` (line 170)
- `.participant-name` (line 179)
- `.recognition-text` (line 188)
- `.signature-name` (line 226)
- `.signature-title` (line 235)
- `.signature-company` (line 243)

All use: `font-family: 'Open Sans', sans-serif;`

## How to Use Custom Font Files

If you want to use local font files (e.g., `.ttf`, `.otf`, `.woff`, `.woff2`):

1. **Create a fonts folder:**
   ```
   certificate-generator/fonts/
   ```

2. **Add @font-face rules at the top of `css/style.css`:**
   ```css
   @font-face {
       font-family: 'Your Script Font';
       src: url('../fonts/your-script-font.woff2') format('woff2'),
            url('../fonts/your-script-font.woff') format('woff');
       font-weight: 400, 600, 700;
       font-style: normal;
   }
   
   @font-face {
       font-family: 'Your Sans Font';
       src: url('../fonts/your-sans-font.woff2') format('woff2'),
            url('../fonts/your-sans-font.woff') format('woff');
       font-weight: 400, 600, 700;
       font-style: normal;
   }
   ```

3. **Update font-family in CSS:**
   - Replace `'Dancing Script'` with `'Your Script Font'`
   - Replace `'Open Sans'` with `'Your Sans Font'`

4. **Remove or comment out the Google Fonts link** in `index.html` (lines 8-11)

## Quick Font Replacement Examples

### Replace with different Google Fonts

**Example 1: Use "Great Vibes" for title and "Roboto" for body**
1. In `index.html` line 11, change to:
   ```html
   <link href="https://fonts.googleapis.com/css2?family=Great+Vibes&family=Roboto:wght@400;600;700&display=swap" rel="stylesheet">
   ```

2. In `css/style.css`:
   - Line 160: Change to `font-family: 'Great Vibes', cursive;`
   - Lines 170, 179, 188, 226, 235, 243: Change to `font-family: 'Roboto', sans-serif;`

### Replace with system fonts (no external loading needed)

1. **Remove the Google Fonts link** from `index.html` (lines 8-11)

2. **Update CSS:**
   - Line 160: `font-family: 'Brush Script MT', cursive;` (or any system script font)
   - All other lines: `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;`

## Font Files Location

If using local fonts, place them in:
```
certificate-generator/fonts/
```

Then reference them in CSS using relative paths: `url('../fonts/filename.woff2')`


