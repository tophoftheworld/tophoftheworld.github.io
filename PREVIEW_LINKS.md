# Gift Certificate System - Preview Links

## 🔗 Quick Access Options

### Option 1: GitHub Raw Preview (Available Now)
View the HTML files directly from GitHub (basic preview without full functionality):

**Landing Page:**
https://raw.githubusercontent.com/tophoftheworld/tophoftheworld.github.io/cursor/gift-certificates-b122/gift-certificates/index.html

**Dashboard:**
https://raw.githubusercontent.com/tophoftheworld/tophoftheworld.github.io/cursor/gift-certificates-b122/gift-certificates/dashboard.html

**Certificate View:**
https://raw.githubusercontent.com/tophoftheworld/tophoftheworld.github.io/cursor/gift-certificates-b122/gift-certificates/certificate.html

**Scanner:**
https://raw.githubusercontent.com/tophoftheworld/tophoftheworld.github.io/cursor/gift-certificates-b122/gift-certificates/scanner.html

### Option 2: GitHub HTML Preview (Better)
Use htmlpreview.github.io for a better preview:

**Landing Page:**
http://htmlpreview.github.io/?https://github.com/tophoftheworld/tophoftheworld.github.io/blob/cursor/gift-certificates-b122/gift-certificates/index.html

**Dashboard:**
http://htmlpreview.github.io/?https://github.com/tophoftheworld/tophoftheworld.github.io/blob/cursor/gift-certificates-b122/gift-certificates/dashboard.html

### Option 3: View on GitHub (Best for Code Review)
View the files directly in GitHub's interface:

**Repository:**
https://github.com/tophoftheworld/tophoftheworld.github.io/tree/cursor/gift-certificates-b122/gift-certificates

**Pull Request:**
https://github.com/tophoftheworld/tophoftheworld.github.io/pull/5

### Option 4: Firebase Deploy (Full Functionality)
Deploy to Firebase Hosting for complete preview with Firebase features:

```bash
# From your local machine, pull the branch:
git fetch origin
git checkout cursor/gift-certificates-b122

# Deploy to Firebase (if you have Firebase CLI installed)
firebase deploy --only hosting

# Or preview locally:
python3 -m http.server 8080
# Then open: http://localhost:8080/gift-certificates/
```

### Option 5: GitHub Pages Branch Preview
If you merge to main or set up branch previews, it will be available at:
https://tophoftheworld.github.io/gift-certificates/

## 📱 Recommended Preview Flow

1. **View Code**: Start with the GitHub repository link to see the files
2. **Test Layout**: Use htmlpreview.github.io to see the visual design
3. **Full Testing**: Deploy to Firebase or run locally for full functionality (camera, Firebase features)

## ⚠️ Notes

- Raw GitHub links and htmlpreview won't have full Firebase functionality
- Camera access requires HTTPS (works on Firebase Hosting or localhost)
- For complete testing with QR scanning, use Firebase deploy or local server

## 🚀 Quick Deploy to Firebase

If you want to deploy right now:

1. Make sure Firebase CLI is installed: `npm install -g firebase-tools`
2. Login: `firebase login`
3. From the workspace: `firebase deploy --only hosting`

This will give you a live preview URL like: `https://your-project.web.app/gift-certificates/`
