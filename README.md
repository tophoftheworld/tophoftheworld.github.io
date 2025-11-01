# Matchanese Business Suite

A comprehensive collection of web applications for managing a matcha business, including staff management, POS systems, inventory tracking, and customer loyalty programs.

## 🏗️ Project Structure

### **Admin Dashboard**
- **`admin.html`** - Unified admin dashboard with sidebar navigation
- **`css/admin-dashboard.css`** - Admin dashboard styles
- **`js/admin-dashboard.js`** - Admin dashboard functionality

### **Core Business Applications**

#### **Staff Management**
- **`attendance/`** - Staff time tracking with photo capture
- **`admin-payroll/`** - Payroll management system
- **`admin-scheduling/`** - Staff scheduling and shift management

#### **Business Operations**
- **`pos/`** - Point of sale system with menu management
- **`inventory/`** - Multi-branch inventory tracking
- **`expenses/`** - Expense tracking with receipt photos
- **`mobile-orders/`** - Order management from Shopify imports
- **`sales/`** - Sales analytics and reporting

#### **Customer Applications**
- **`loyalty-app/`** - Customer loyalty program with QR codes
- **`mmf-stamp/`** - Event-specific stamp rally system

#### **Utility Tools**
- **`matcha-pricing/`** - Matcha pricing calculator
- **`others/matchanese-expense-parser/`** - CSV expense processing
- **`others/payslip-generator/`** - Payroll document generation

### **Shared Resources**
- **`shared/`** - Common assets and utilities
  - **`assets/`** - Images, fonts, and icons
  - **`css/common.css`** - Shared styles and design system
  - **`js/firebase-config.js`** - Centralized Firebase configuration
  - **`js/shared-utils.js`** - Common utility functions

## 🚀 Getting Started

### **Admin Dashboard**
1. Open `admin.html` in your browser
2. Use the sidebar to navigate between different modules
3. Each module can be integrated or accessed as standalone apps

### **Individual Applications**
Each app folder contains its own `index.html` and can be run independently:
- **Staff Apps**: `attendance/`, `expenses/`
- **Admin Apps**: `admin-payroll/`, `admin-scheduling/`, `sales/`
- **Business Systems**: `pos/`, `inventory/`, `mobile-orders/`
- **Customer Apps**: `loyalty-app/`, `mmf-stamp/`

## 🎨 Design System

### **Brand Colors**
- **Primary Green**: `#2b9348`
- **Light Green**: `#f0fdf4`
- **Hover Green**: `#16a34a`

### **Typography**
- **Font Family**: Inter, system fonts
- **Consistent sizing**: xs, sm, base, lg, xl, 2xl, 3xl

### **Components**
- Buttons, forms, cards, and utilities are defined in `shared/css/common.css`
- Consistent spacing, shadows, and animations across all apps

## 🔧 Technical Features

### **Firebase Integration**
- Centralized configuration in `shared/js/firebase-config.js`
- Support for multiple Firebase projects
- Common services initialization

### **Shared Utilities**
- Currency formatting (Philippine Peso)
- Date/time formatting
- Phone number validation and formatting
- CSV parsing and generation
- Local storage helpers
- Toast notifications
- Clipboard operations

### **Responsive Design**
- Mobile-first approach
- Consistent breakpoints
- Touch-friendly interfaces

## 📱 Application Categories

| Category | Applications | Target Users |
|----------|-------------|--------------|
| **Admin Dashboard** | Unified management interface | Admin/Manager |
| **Staff Mobile** | Attendance, Expenses | Staff |
| **Admin Desktop** | Payroll, Scheduling, Sales | Admin/HR |
| **Business Systems** | POS, Inventory, Orders | Staff + Admin |
| **Customer Apps** | Loyalty, Stamp Rally | Customers |
| **Utilities** | Pricing, Parsers, Generators | Admin/Manager |

## 🔗 Integration Strategy

### **Admin Dashboard Modules**
- **Core Modules**: Payroll, Scheduling, Sales, Inventory
- **Embedded Views**: Attendance, Expenses, POS Analytics
- **Standalone Access**: All apps remain independently accessible

### **Shared Resources**
- Common Firebase configurations
- Shared UI components and styles
- Utility functions for consistent behavior
- Centralized asset management

## 🚀 Deployment

Each application can be deployed independently or as part of the unified suite:

1. **Standalone Deployment**: Deploy individual app folders
2. **Unified Deployment**: Deploy entire project with admin dashboard
3. **Hybrid Deployment**: Mix of standalone and integrated apps

## 📋 Future Enhancements

- [ ] Staff homepage in root `index.html`
- [ ] Real-time notifications across admin modules
- [ ] Role-based access control
- [ ] Progressive Web App features
- [ ] Automated deployment pipeline
- [ ] API integration for external services

## 🛠️ Development

### **Adding New Apps**
1. Create new folder in root directory
2. Follow existing app structure
3. Use shared resources from `shared/` folder
4. Update admin dashboard navigation if needed

### **Shared Resources**
- Import common styles: `<link rel="stylesheet" href="../shared/css/common.css">`
- Import utilities: `<script type="module" src="../shared/js/shared-utils.js"></script>`
- Use Firebase config: `<script type="module" src="../shared/js/firebase-config.js"></script>`

## 📄 License

This project is proprietary software for Matchanese business operations.
