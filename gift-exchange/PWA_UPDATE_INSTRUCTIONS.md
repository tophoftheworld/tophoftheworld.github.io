# How to Update PWA (App on Home Screen)

If you've installed the site as an app on your home screen, here's how to force an update:

## Method 1: Uninstall and Reinstall (Easiest)
1. **iOS:**
   - Long press the app icon on your home screen
   - Tap the "X" to delete it
   - Open Safari and go to the website
   - Tap Share button > "Add to Home Screen"
   - This installs the latest version

2. **Android:**
   - Long press the app icon
   - Drag to "Uninstall" or tap "Remove"
   - Open Chrome and go to the website
   - Tap menu (3 dots) > "Install app" or "Add to Home screen"
   - This installs the latest version

## Method 2: Force Update Through Browser
1. Open the app (it will open in your browser)
2. Add `?clear=1` to the URL and refresh
3. This clears all caches and forces a fresh download

## Method 3: Clear App Data (Android)
1. Settings > Apps > Find the app
2. Tap "Storage" > "Clear Data" or "Clear Cache"
3. Reopen the app

## Method 4: Update Service Worker Manually
1. Open the app
2. Open browser developer tools (if possible)
3. Go to Application/Storage tab
4. Find "Service Workers"
5. Click "Unregister"
6. Refresh the page

## Automatic Update
The app will automatically check for updates when you open it. If a new version is available, it should update automatically. If not, use one of the methods above.


