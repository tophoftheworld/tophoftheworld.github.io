# Mobile Orders App

A web-based mobile order management system for handling Shopify CSV exports with Firebase integration.

## Features

- **CSV Import**: Import Shopify order exports as CSV files
- **Order Groups**: Organize orders into named groups for better management
- **Real-time Sync**: All data is stored in Firebase and accessible from any device
- **Status Management**: Track order status (unfulfilled, packed, shipped, ready for pickup)
- **Filtering & Sorting**: Filter by delivery type and sort by various criteria
- **Copy to Clipboard**: Easy copying of customer information
- **Mobile Optimized**: Responsive design for mobile devices

## Order Status Flow

### For Pickup Orders:
- `unfulfilled` → `ready for pickup` → `unfulfilled`

### For Shipping Orders:
- `unfulfilled` → `packed` → `shipped` → `unfulfilled`

## Firebase Structure

```
orderGroups/
├── {groupId}/
│   ├── name: string
│   ├── description: string
│   ├── orderCount: number
│   ├── createdAt: timestamp
│   └── updatedAt: timestamp
│   └── orders/
│       ├── {orderId}/
│       │   ├── orderNumber: string
│       │   ├── customerName: string
│       │   ├── customerPhone: string
│       │   ├── customerEmail: string
│       │   ├── billingAddress: object
│       │   ├── shippingAddress: object
│       │   ├── itemName: string
│       │   ├── quantity: string
│       │   ├── total: string
│       │   ├── notes: string
│       │   ├── status: string
│       │   ├── createdAt: timestamp
│       │   └── updatedAt: timestamp
```

## Usage

1. **Import Orders**: Click the + button to import a new CSV file
2. **Name Your Group**: Give your order group a name and optional description
3. **View Orders**: Click on a group to view all orders
4. **Manage Status**: Use the action buttons to update order status
5. **Filter & Sort**: Use the controls to filter and sort orders
6. **Copy Info**: Click "Copy" buttons to copy customer information

## CSV Format

The app expects Shopify CSV exports with the following columns:
- `Name` or `Order Number`
- `Billing Name`
- `Billing Phone`
- `Email`
- `Billing Street`
- `Billing City`
- `Billing Province`
- `Shipping Name`
- `Shipping Street`
- `Shipping City`
- `Shipping Province Name` or `Shipping Province`
- `Shipping Method`
- `Pickup Location`
- `Lineitem name`
- `Lineitem quantity`
- `Total`
- `Notes` or `Note`

## Setup

1. Ensure Firebase is configured in `js/firebase-config.js`
2. Deploy to a web server or use Firebase Hosting
3. Access the app from any device with internet connection

## Styling

The app uses the same design system as the expenses app:
- Netflix Sans font family
- Green accent color (#439407)
- Card-based layout
- Mobile-first responsive design
