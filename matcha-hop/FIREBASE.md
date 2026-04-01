# Firebase setup for Matcha Hop

Cafes (admin classifications, starred) and logs (user matcha logs) are stored in **Firestore** and stay in sync across the admin and user app.

## 1. Create a Firebase project

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a project (or use an existing one).
2. Enable **Firestore Database**: Build → Firestore Database → Create database. Start in **test mode** or set rules (see below).
3. In Project settings (gear) → Your apps → Add app → Web, register the app and copy the config object.

## 2. Add config to the app

Paste your Firebase config into `js/config.js` as `window.FIREBASE_CONFIG`:

```js
window.FIREBASE_CONFIG = {
  apiKey: '...',
  authDomain: '...',
  projectId: '...',
  storageBucket: '...',
  messagingSenderId: '...',
  appId: '...',
};
```

If `FIREBASE_CONFIG` is missing or invalid, the app falls back to **IndexedDB** (local only).

## 3. Firestore rules

Deploy rules so the app can read/write. Example (open for development; restrict with `request.auth != null` when you add Auth):

- Copy `firestore.rules` into your Firebase project, or in the Console go to Firestore → Rules and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /cafes/{cafeId} { allow read, write: if true; }
    match /logs/{logId} { allow read, write: if true; }
  }
}
```

## 4. First run and migration

- On first load with Firebase configured, the app loads data from Firestore.
- If Firestore is empty and you had data in IndexedDB (or legacy localStorage), that data is **migrated** to Firestore once, then the app uses Firestore as the source of truth.
- All writes (save cafe, set classification, star, save log) go to both Firestore and the local cache so the admin and user app stay in sync.
