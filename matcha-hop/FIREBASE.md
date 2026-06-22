# Firebase setup for Matcha Hop

Cafes and logs are stored in **Firestore** and stay in sync across the app.

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

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /cafes/{cafeId} { allow read, write: if true; }
    match /logs/{logId} { allow read, write: if true; }
    match /settings/{docId} { allow read, write: if true; }
    match /brandPopUps/{popUpId} { allow read, write: if true; }
    match /brandLikes/{brandId} { allow read, write: if true; }
    match /locationLikes/{locationId} { allow read, write: if true; }
    match /placeDetails/{placeId} { allow read, write: if true; }
  }
}
```

## 4. First run and migration

- On first load with Firebase configured, the app loads data from Firestore.
- If Firestore is empty and you had data in IndexedDB (or legacy localStorage), classified cafes and related logs are migrated once.
- The app runs a strict log-schema migration pass and rewrites logs to the canonical schema (`schemaVersion: 3`).
- Migration checkpoint is stored in `settings/migrations` (`strictLogsSchemaVersion`).
- Writes are mirrored to local cache and Firestore for resilience.

## 5. Canonical strict log schema (v3)

`logs/{id}` is normalized to:

- identity: `id`, `schemaVersion`, `userId`, `userName`, `userDisplayName`, `createdAt`, `updatedAt`
- visit: `visit.brandId`, `visit.brandName`, `visit.location.{cafeId,cafeName,address,popupId}`
- content: `post.{rating,caption,photos[],photo,drinks[]}`
- drink item: `name`, `rating`, optional `notes`, `price`, `flavorNotes[]`, `profile.{sweet,bitter,umami}`, `recommended`

Legacy fields are migrated into `post.*` and no longer used for rendering after strict cutover.
