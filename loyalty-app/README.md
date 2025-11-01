# Manila Matcha Fest - Loyalty App

## Apps Overview

### 1. **Customer App** (`index.html`)
- **Purpose**: Customer loyalty app with battle pass system
- **Features**: 
  - View stamps and progress
  - Generate QR code for merchant to scan
  - Edit personal profile (name, phone)
- **Users**: Customers

### 2. **Merchant App** (`merchant.html`)
- **Purpose**: Merchant scans customer QR codes and adds stamps
- **Features**:
  - Scan customer QR codes
  - Enter customer phone numbers manually
  - Add stamps to customer accounts
  - View recent transactions
- **Users**: Merchants/staff

## File Structure

```
├── index.html              # Customer loyalty app
├── merchant.html           # Merchant app for adding stamps
├── phone-input-component.js # Shared phone input component
├── firebase-config.js      # Firebase configuration
├── images/                 # App images and logos
└── archive/               # Old/unused files
```

## How It Works

1. **Customer** opens `index.html`, shows their QR code
2. **Merchant** opens `merchant.html`, scans customer QR code
3. **Merchant** adds stamps, customer gets them instantly

## Firebase Collections

- `customers`: Customer data with stamps
- `transactions`: Stamp addition records
- `qr_codes`: Generated QR code data
