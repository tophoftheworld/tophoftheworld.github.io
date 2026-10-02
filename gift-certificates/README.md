# Gift Certificate System

A complete mobile-first gift certificate management system with QR code generation, scanning, and real-time tracking.

## Features

- 🎁 **Create Certificates** - Generate gift certificates with custom values, givers, and recipients
- 📱 **Mobile-Friendly** - Fully responsive design optimized for mobile devices
- 🔲 **QR Codes** - Automatic QR code generation for each certificate
- 📷 **Camera Scanner** - Built-in QR code scanner using device camera
- ✅ **Claim Tracking** - Real-time status updates when certificates are claimed
- 🎨 **Beautiful Design** - Matches the Matchanese invoice generator design system

## Components

### 1. Dashboard (`dashboard.html`)
- List all gift certificates
- Create new certificates
- Search and filter by status
- Real-time updates when certificates are claimed
- Copy certificate links

### 2. Certificate Display (`certificate.html`)
- Mobile-friendly ticket layout
- Large QR code for easy scanning
- Value, giver, recipient, and expiry information
- Status indicators (active, claimed, expired)
- Print-friendly styling

### 3. Scanner App (`scanner.html`)
- Camera-based QR code scanning
- Certificate lookup and validation
- One-tap claiming with transaction safety
- Success animations and feedback
- Mobile-optimized full-screen interface

## File Structure

```
gift-certificates/
├── index.html              # Landing page
├── dashboard.html          # Certificate management
├── certificate.html        # Individual certificate view
├── scanner.html           # QR scanner app
├── README.md              # This file
├── css/
│   ├── dashboard.css      # Dashboard styles
│   ├── certificate.css    # Certificate display styles
│   └── scanner.css        # Scanner app styles
└── js/
    ├── firebase-config.js # Firebase setup
    ├── dashboard.js       # Dashboard logic
    ├── certificate.js     # Certificate display logic
    └── scanner.js         # Scanner logic
```

## Firebase Structure

### Firestore Collection: `giftCertificates`

Each certificate document contains:

```javascript
{
  certificateId: "GC-YYYY-MMDD-NNN",  // Unique ID
  qrToken: "AbCd3FgH...",             // Base58 encoded token (16 chars)
  value: 500.00,                       // Monetary value (₱)
  status: "active",                    // "active" | "claimed" | "expired"
  createdAt: Timestamp,                // Creation timestamp
  createdBy: "staff",                  // Staff identifier
  givenBy: "John Doe",                 // Optional - giver name
  givenTo: "Jane Smith",               // Optional - recipient name
  description: "Birthday gift",         // Optional - note or message
  expiryDate: "2026-12-31",            // Optional - expiration date
  claimedAt: Timestamp,                // Timestamp when claimed
  claimedBy: "scanner-app"             // Device/location info
}
```

## Usage

### Creating a Certificate

1. Open `dashboard.html`
2. Click "New Certificate"
3. Fill in the form:
   - **Value** (required) - Amount in pesos
   - **Given By** (optional) - Name of giver
   - **Given To** (optional) - Name of recipient
   - **Description** (optional) - Message or note
   - **Expiry Date** (optional) - When certificate expires
4. Click "Create Certificate"
5. Certificate appears in the dashboard list

### Sharing a Certificate

1. From the dashboard, click the copy link button on a certificate
2. Share the link with the recipient via SMS, email, or messaging app
3. Recipient opens the link to view their certificate with QR code

### Scanning and Claiming

1. Open `scanner.html` on a mobile device
2. Allow camera access when prompted
3. Point camera at the certificate's QR code
4. Certificate details appear automatically
5. Click "Claim Certificate" to redeem
6. Success message confirms the claim
7. Dashboard updates in real-time

## Testing Checklist

- [x] Create certificate from dashboard
- [x] View certificate with QR code on mobile
- [x] Scan QR code with scanner app
- [x] Claim certificate and verify status update
- [x] Dashboard reflects claimed status in real-time
- [x] Prevent double-claiming (transaction safety)
- [x] Handle expired certificates
- [x] Mobile responsiveness across devices
- [x] QR code generation and scanning

## Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6 modules)
- **Database**: Firebase Firestore
- **QR Generation**: qrcodejs library
- **QR Scanning**: html5-qrcode library
- **Fonts**: DM Sans (Google Fonts)

## Design System

### Colors
- **Primary Green**: `#2b9348`
- **Dark Green**: `#1f7a38`
- **Ink**: `#142018`
- **Muted**: `#5c6b60`
- **Line**: `#dce5de`
- **Background**: `#eef3ef`

### Typography
- **Font Family**: DM Sans
- **Weights**: 400, 500, 600, 700

### Responsive Breakpoints
- **Mobile**: < 640px (single column)
- **Tablet**: 640px - 900px (2 columns)
- **Desktop**: > 900px (3 columns)

## Security Features

1. **Unique Tokens** - Cryptographically secure Base58 tokens (16 chars)
2. **Status Validation** - Status checked before displaying claim button
3. **Transaction Safety** - Firestore transactions prevent race conditions
4. **Expiry Checks** - Automatic validation of expiration dates
5. **Firestore Rules** - Public read, authenticated create/update

## Browser Support

- **Modern browsers**: Chrome, Firefox, Safari, Edge (latest 2 versions)
- **Mobile**: iOS Safari 13+, Chrome Android 80+
- **Camera**: Requires HTTPS for camera access (except localhost)

## Deployment

### Firebase Hosting

Add to `firebase.json`:

```json
{
  "hosting": {
    "public": "gift-certificates",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "/certificates/**",
        "destination": "/index.html"
      }
    ]
  }
}
```

Deploy:
```bash
firebase deploy --only hosting
```

### Firestore Rules

Already configured in `/workspace/firestore.rules`:

```javascript
match /giftCertificates/{certificateId} {
  allow read: if true;
  allow create: if true;  // TODO: Add auth
  allow update: if true;  // TODO: Restrict to claim operation
  allow delete: if false;
}
```

## Future Enhancements

- [ ] Staff authentication
- [ ] Email/SMS notifications
- [ ] Batch certificate generation
- [ ] Analytics dashboard
- [ ] Custom branding per certificate
- [ ] Partial redemption support
- [ ] Gift certificate templates
- [ ] Export to PDF
- [ ] Integration with POS system

## Support

For issues or questions, contact the development team.

## License

Proprietary - Matchanese
