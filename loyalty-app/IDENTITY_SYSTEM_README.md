# Customer Identity System

This document describes the new customer identity and account management system implemented to address phone number collision and identity issues.

## Problem Solved

### Original Issues:
1. **Phone as Primary ID**: Phone numbers were used as the primary identifier, causing:
   - Identity collisions when multiple people use the same phone
   - Data loss when phone numbers change
   - Difficulty handling typos or format variations
   - Orphaned records when customers change phone numbers

2. **No Identity Stability**: Changing a phone number would create a new customer record or lose existing data.

## Solution Implemented

### 1. Server-Issued Customer IDs
- **Format**: `MXXXXXX` (e.g., `MA7B9X2`) - M for Matchanese
- **Uniqueness**: Generated with 6 random characters
- **Stability**: Never changes once assigned to a customer
- **Primary Key**: Used as the main identifier for all customer operations

### 2. Phone Number as Contact Field
- **Purpose**: Contact information, not identity
- **Validation**: Proper format validation and normalization
- **Verification**: Required verification when changing phone numbers
- **Uniqueness**: Enforced through business logic (one verified phone per customer)

### 3. Enhanced Data Structure

#### Customer Document Structure:
```javascript
{
  customerId: "MA7B9X2",                  // Primary identifier
  phone: "+63 912 345 6789",               // Contact field
  name: "John Doe",                        // Customer name
  stamps: { 1: true, 2: true, ... },       // Loyalty stamps
  isPhoneVerified: true,                   // Verification status
  phoneVerifiedAt: Date,                   // Verification timestamp
  createdAt: Date,                         // Account creation
  updatedAt: Date                          // Last update
}
```

#### Transaction Document Structure:
```javascript
{
  customerId: "MA7B9X2",                  // Links to customer
  customerPhone: "+63 912 345 6789",       // Contact info (for display)
  customerName: "John Doe",                // Customer name
  quantity: 5,                             // Stamps added
  timestamp: Date,                         // Transaction time
  staffDevice: "user-agent-string"         // Staff device info
}
```

## Key Features

### 1. Customer ID Generation (`js/customer-id-utils.js`)
- Generates unique, time-based customer IDs
- Validates customer ID format
- Normalizes phone numbers to standard format
- Manages customer data persistence

### 2. Phone Verification System (`js/phone-verification.js`)
- Sends verification codes via SMS (simulated)
- Validates verification codes with expiration
- Prevents duplicate phone registrations
- Tracks verification attempts and limits


### 3. Enhanced Customer App (`js/customer-app.js`)
- Uses customer ID as primary identifier
- Handles phone number changes with verification
- Maintains backward compatibility

### 4. Enhanced Merchant App (`js/merchant-app.js`)
- Looks up customers by customer ID or phone
- Creates new customers with proper ID structure
- Records transactions with customer references
- Supports both old and new QR code formats

## MVP Implementation

### For New Customers:
1. **Immediate ID Assignment**: New customers get customer IDs immediately
2. **Simple Structure**: Clean, simple data format
3. **Verification Ready**: Phone verification system is active (demo mode)

## Phone Number Changes

### Process:
1. **Verification Required**: Customer must verify new phone number
2. **Duplicate Check**: System prevents duplicate phone registrations
3. **Identity Preservation**: Customer ID remains unchanged
4. **Data Continuity**: All stamps and history are preserved

### Security:
- Verification codes expire after 10 minutes
- Limited to 3 verification attempts
- Codes are single-use
- Verification status is tracked

## QR Code Updates

### New Format:
```javascript
{
  type: 'customer',
  customerId: 'MA7B9X2',                  // Primary identifier
  phone: '+63 912 345 6789',               // Contact info (backward compatibility)
  timestamp: 1701445022000
}
```

### Backward Compatibility:
- Old QR codes with only phone numbers still work
- Merchant app handles both formats
- Gradual transition as customers update their QR codes

## SMS Verification (MVP Demo Mode)

### How it works:
- Verification codes are logged to browser console
- Codes are displayed in toast messages for easy testing
- No real SMS service integration needed for MVP
- Perfect for testing with 1-2 accounts

## Security Considerations

### Data Protection:
- Customer IDs are not predictable
- Phone numbers are normalized and validated
- Verification codes are time-limited
- Failed attempts are tracked

### Privacy:
- Phone numbers are treated as contact information
- Customer IDs provide anonymity
- Verification status is clearly tracked

## Implementation Benefits

### 1. Identity Stability
- Customer records persist across phone changes
- No data loss when contact info changes
- Reliable customer identification

### 2. Data Integrity
- Prevents duplicate accounts
- Handles phone number collisions
- Maintains data consistency

### 3. User Experience
- Seamless migration for existing users
- Clear verification process
- No disruption to loyalty program

### 4. System Reliability
- Robust error handling
- Comprehensive logging
- Rollback capabilities

## Usage Instructions

### For Customers:
1. Open the app - migration happens automatically
2. To change phone number: Edit profile → Enter new number → Verify with code
3. QR codes are automatically updated with new format

### For Merchants:
1. QR scanning works with both old and new formats
2. Phone number lookup still works for existing customers
3. New customers are created with proper ID structure

### For Testing:
1. Check browser console for verification codes
2. Use toast messages to see SMS codes
3. Test phone number changes with verification flow

## Technical Notes

### Dependencies:
- Firebase Firestore for data storage
- Customer ID utilities for ID management
- Phone verification system for security (demo mode)

### Performance:
- Efficient customer lookups by ID
- Optimized queries with proper indexing
- Minimal impact on existing functionality

### Monitoring:
- Error logging and reporting
- Performance metrics
- User experience monitoring

This MVP system provides a solid foundation for customer identity management with simple, clean customer IDs and phone verification for testing purposes.
