# White-Label & Security Requirements
## POS, Payroll, and Attendance Systems

---

## 🔴 **CRITICAL ISSUES IDENTIFIED**

### **1. Multi-Tenancy (Company Isolation) - CRITICAL**

#### **Current State:**
- ❌ **No company/tenant identification** in data structure
- ❌ All data stored in single shared Firebase project
- ❌ Data organized by employee ID only, not company ID
- ❌ No data isolation between different companies
- ❌ All companies share the same database collections

#### **Data Structure Problems:**

**POS System:**
```
Current: pos-orders/{eventName}/{date}/{orderId}
Problem: No company identifier - all companies' orders mixed together
```

**Payroll System:**
```
Current: attendance/{employeeId}/dates/{date}
Problem: Employee IDs are global - no company isolation
Current: employees/{employeeId}
Problem: All employees from all companies in same collection
```

**Attendance System:**
```
Current: attendance/{employeeId}/dates/{date}
Problem: Same as payroll - no company isolation
```

---

## 🏗️ **REQUIRED ARCHITECTURAL CHANGES**

### **1. Multi-Tenant Data Structure**

#### **Option A: Company ID in Path (Recommended)**
```
companies/{companyId}/
  ├── employees/{employeeId}
  ├── attendance/{employeeId}/dates/{date}
  ├── payroll/{employeeId}/periods/{periodId}
  ├── pos-orders/{eventName}/{date}/{orderId}
  ├── branches/{branchId}
  └── settings/{settingKey}
```

#### **Option B: Company ID in Document Fields**
```
employees/{employeeId}
  - companyId: "company-123"
  - employeeId: "emp-456"
  - ...other fields

attendance/{employeeId}/dates/{date}
  - companyId: "company-123"
  - ...other fields
```

**Recommendation: Use Option A** - Better security, easier to enforce isolation

---

### **2. Company/Organization Management**

#### **Required Collections:**
```javascript
companies/{companyId}
  - name: string
  - domain: string (for white-label)
  - logo: string (URL)
  - primaryColor: string
  - secondaryColor: string
  - subscriptionTier: "starter" | "business" | "enterprise"
  - features: array
  - createdAt: timestamp
  - status: "active" | "suspended" | "cancelled"
  - settings: {
      timezone: string
      currency: string
      dateFormat: string
      // ... other company-specific settings
    }

company_users/{userId}
  - companyId: string
  - userId: string (Firebase Auth UID)
  - role: "owner" | "admin" | "manager" | "staff"
  - email: string
  - permissions: object
  - createdAt: timestamp
```

---

### **3. Authentication & Authorization**

#### **Current Issues:**
- ❌ No company context in authentication
- ❌ Users can access any company's data
- ❌ No role-based access control (RBAC)
- ❌ Employee codes are global (conflicts between companies)

#### **Required Changes:**

**1. Firebase Auth Custom Claims:**
```javascript
// Set custom claims on user token
{
  companyId: "company-123",
  role: "admin",
  permissions: ["read:payroll", "write:attendance"]
}
```

**2. Company Context Middleware:**
```javascript
// Every request must include companyId
function requireCompanyContext(req, res, next) {
  const companyId = req.user.companyId || req.headers['x-company-id'];
  if (!companyId) {
    return res.status(403).json({ error: 'Company context required' });
  }
  req.companyId = companyId;
  next();
}
```

**3. Employee ID Scoping:**
```javascript
// Employee IDs must be unique per company
// Format: {companyId}-{employeeCode}
// Example: "company-123-EMP001"
```

---

## 🔒 **SECURITY REQUIREMENTS**

### **1. Firestore Security Rules (CRITICAL)**

#### **Current State:**
```javascript
// ❌ COMPLETELY OPEN - ANYONE CAN READ/WRITE
match /{document=**} {
  allow read, write: if request.time < timestamp.date(2025, 5, 11);
}
```

#### **Required Security Rules:**

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function getUserCompanyId() {
      return request.auth.token.companyId;
    }
    
    function getUserRole() {
      return request.auth.token.role;
    }
    
    function isCompanyMember(companyId) {
      return isAuthenticated() && 
             getUserCompanyId() == companyId;
    }
    
    function isAdmin() {
      return isAuthenticated() && 
             (getUserRole() == 'admin' || getUserRole() == 'owner');
    }
    
    // Company collection
    match /companies/{companyId} {
      allow read: if isCompanyMember(companyId);
      allow write: if isAdmin() && isCompanyMember(companyId);
      
      // Employees subcollection
      match /employees/{employeeId} {
        allow read: if isCompanyMember(companyId);
        allow create: if isAdmin() && isCompanyMember(companyId);
        allow update: if isAdmin() && isCompanyMember(companyId);
        allow delete: if isAdmin() && isCompanyMember(companyId);
        
        // Attendance subcollection
        match /attendance/{employeeId}/dates/{date} {
          allow read: if isCompanyMember(companyId);
          allow write: if isCompanyMember(companyId) && 
                          (isAdmin() || request.auth.uid == employeeId);
        }
        
        // Payroll subcollection
        match /payroll/{employeeId}/periods/{periodId} {
          allow read: if isCompanyMember(companyId) && 
                         (isAdmin() || request.auth.uid == employeeId);
          allow write: if isAdmin() && isCompanyMember(companyId);
        }
      }
      
      // POS Orders
      match /pos-orders/{eventName}/{date}/{orderId} {
        allow read: if isCompanyMember(companyId);
        allow write: if isCompanyMember(companyId);
      }
      
      // Branches
      match /branches/{branchId} {
        allow read: if isCompanyMember(companyId);
        allow write: if isAdmin() && isCompanyMember(companyId);
      }
      
      // Settings
      match /settings/{settingKey} {
        allow read: if isCompanyMember(companyId);
        allow write: if isAdmin() && isCompanyMember(companyId);
      }
    }
    
    // Company users (for RBAC)
    match /company_users/{userId} {
      allow read: if isAuthenticated() && 
                     (resource.data.companyId == getUserCompanyId() || 
                      request.auth.uid == userId);
      allow write: if isAdmin() && 
                      resource.data.companyId == getUserCompanyId();
    }
  }
}
```

---

### **2. Firebase Storage Security Rules**

#### **Current State:**
```javascript
// ❌ PUBLIC ACCESS ALLOWED
match /staff-photos/{employeeId} {
  allow read, write: if true;
}
```

#### **Required Storage Rules:**

```javascript
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function getUserCompanyId() {
      return request.auth.token.companyId;
    }
    
    // Company-specific storage paths
    match /companies/{companyId}/{allPaths=**} {
      allow read: if isAuthenticated() && 
                     getUserCompanyId() == companyId;
      allow write: if isAuthenticated() && 
                      getUserCompanyId() == companyId;
    }
    
    // Staff photos (scoped by company)
    match /companies/{companyId}/staff-photos/{employeeId} {
      allow read: if isAuthenticated() && 
                     getUserCompanyId() == companyId;
      allow write: if isAuthenticated() && 
                      getUserCompanyId() == companyId;
    }
    
    // Receipt photos (scoped by company)
    match /companies/{companyId}/receipts/{receiptId} {
      allow read: if isAuthenticated() && 
                     getUserCompanyId() == companyId;
      allow write: if isAuthenticated() && 
                      getUserCompanyId() == companyId;
    }
    
    // Deny all other paths
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

---

### **3. API Security**

#### **Required Implementations:**

**1. Company Context Validation:**
```javascript
// Every API endpoint must validate company context
async function validateCompanyAccess(companyId, userId) {
  const userDoc = await db.collection('company_users')
    .doc(userId)
    .get();
  
  if (!userDoc.exists || userDoc.data().companyId !== companyId) {
    throw new Error('Unauthorized: Invalid company access');
  }
  
  return userDoc.data();
}
```

**2. Input Validation:**
```javascript
// Validate all inputs to prevent injection attacks
function sanitizeInput(input) {
  // Remove dangerous characters
  // Validate data types
  // Check for SQL injection patterns
  // Validate file uploads
}
```

**3. Rate Limiting:**
```javascript
// Implement rate limiting per company/user
// Prevent abuse and DoS attacks
```

---

## 🎨 **WHITE-LABEL REQUIREMENTS**

### **1. Branding Configuration**

#### **Required Company Settings:**
```javascript
companies/{companyId}/settings
  - branding: {
      logo: string (URL)
      logoDark: string (URL)
      favicon: string (URL)
      primaryColor: "#2b9348"
      secondaryColor: "#1d6330"
      accentColor: "#16a34a"
      fontFamily: "Inter"
      companyName: "Matchanese"
    }
  - domain: {
      customDomain: "app.companyname.com"
      subdomain: "companyname"
      sslEnabled: boolean
    }
  - features: {
      showPoweredBy: boolean
      customFooter: string
      customEmailTemplates: object
    }
```

### **2. Dynamic Configuration Loading**

#### **Required Implementation:**
```javascript
// Load company config on app initialization
async function loadCompanyConfig(companyId) {
  const companyDoc = await db.collection('companies')
    .doc(companyId)
    .get();
  
  if (!companyDoc.exists) {
    throw new Error('Company not found');
  }
  
  const config = companyDoc.data();
  
  // Apply branding
  applyBranding(config.branding);
  
  // Set company context
  setCompanyContext(companyId, config);
  
  return config;
}
```

### **3. CSS/Theme Customization**

#### **Required Implementation:**
```javascript
// Inject custom CSS based on company settings
function applyBranding(branding) {
  const root = document.documentElement;
  root.style.setProperty('--primary-color', branding.primaryColor);
  root.style.setProperty('--secondary-color', branding.secondaryColor);
  root.style.setProperty('--accent-color', branding.accentColor);
  root.style.setProperty('--font-family', branding.fontFamily);
  
  // Update logo
  const logo = document.querySelector('.logo');
  if (logo) {
    logo.src = branding.logo;
  }
  
  // Update favicon
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) {
    favicon.href = branding.favicon;
  }
}
```

---

## 📋 **IMPLEMENTATION CHECKLIST**

### **Phase 1: Multi-Tenancy Foundation**

- [ ] **1.1 Create Company Management System**
  - [ ] Companies collection structure
  - [ ] Company creation API
  - [ ] Company settings management
  - [ ] Company user management

- [ ] **1.2 Update Data Models**
  - [ ] Add companyId to all collections
  - [ ] Migrate existing data to new structure
  - [ ] Update all queries to include companyId
  - [ ] Update all writes to include companyId

- [ ] **1.3 Employee ID Scoping**
  - [ ] Change employee ID format to include companyId
  - [ ] Update employee creation logic
  - [ ] Update all employee lookups
  - [ ] Migrate existing employee IDs

### **Phase 2: Security Implementation**

- [ ] **2.1 Firestore Security Rules**
  - [ ] Write comprehensive security rules
  - [ ] Test all read/write operations
  - [ ] Implement company isolation
  - [ ] Add role-based access control

- [ ] **2.2 Storage Security Rules**
  - [ ] Update storage rules for company isolation
  - [ ] Test file uploads/downloads
  - [ ] Implement path-based access control

- [ ] **2.3 Authentication Updates**
  - [ ] Add custom claims to Firebase Auth
  - [ ] Implement company context middleware
  - [ ] Update login flow to set company context
  - [ ] Add company switching (if multi-company users)

- [ ] **2.4 API Security**
  - [ ] Add company validation to all endpoints
  - [ ] Implement input sanitization
  - [ ] Add rate limiting
  - [ ] Add request logging/auditing

### **Phase 3: White-Label Implementation**

- [ ] **3.1 Branding System**
  - [ ] Company branding configuration
  - [ ] Logo upload/management
  - [ ] Color scheme customization
  - [ ] Font customization

- [ ] **3.2 Dynamic Configuration**
  - [ ] Company config loading on app init
  - [ ] Theme application system
  - [ ] Custom domain support
  - [ ] Subdomain routing

- [ ] **3.3 UI Customization**
  - [ ] Logo replacement
  - [ ] Color scheme application
  - [ ] Custom footer/header
  - [ ] Email template customization

### **Phase 4: Code Refactoring**

- [ ] **4.1 Firebase Configuration**
  - [ ] Centralize Firebase config
  - [ ] Remove hard-coded configs
  - [ ] Add company-specific config loading
  - [ ] Support multiple Firebase projects (optional)

- [ ] **4.2 Data Access Layer**
  - [ ] Create data access abstraction
  - [ ] Add company context to all queries
  - [ ] Update all collection references
  - [ ] Add data validation layer

- [ ] **4.3 Frontend Updates**
  - [ ] Update POS system for multi-tenancy
  - [ ] Update Payroll system for multi-tenancy
  - [ ] Update Attendance system for multi-tenancy
  - [ ] Add company context to all API calls

---

## 🔧 **SPECIFIC CODE CHANGES REQUIRED**

### **1. POS System (`pos/`)**

#### **Current Code:**
```javascript
// ❌ No company context
const dayRef = doc(db, `pos-orders/${window.currentEvent || 'pop-up'}`);
```

#### **Required Change:**
```javascript
// ✅ With company context
const companyId = getCompanyId(); // From auth token or context
const dayRef = doc(db, `companies/${companyId}/pos-orders/${window.currentEvent || 'pop-up'}`);
```

#### **Files to Update:**
- `pos/js/script.js` - All collection references
- `pos/js/dashboard.js` - All collection references
- `pos/js/firebase-sync.js` - All collection references

---

### **2. Payroll System (`admin-payroll/`, `payroll/`)**

#### **Current Code:**
```javascript
// ❌ No company context
const attendanceRef = collection(db, "attendance", employeeId, "dates");
const employeeDoc = await getDoc(doc(db, "employees", employeeId));
```

#### **Required Change:**
```javascript
// ✅ With company context
const companyId = getCompanyId();
const attendanceRef = collection(db, `companies/${companyId}/attendance/${employeeId}/dates`);
const employeeDoc = await getDoc(doc(db, `companies/${companyId}/employees`, employeeId));
```

#### **Files to Update:**
- `admin-payroll/js/admin-script.js` - All collection references
- `payroll/js/script.js` - All collection references
- `admin-payroll/js/PayCalculator.js` - If it accesses data directly

---

### **3. Attendance System (`employee-attendance/`, `attendance/`)**

#### **Current Code:**
```javascript
// ❌ No company context
const subDocRef = doc(db, "attendance", currentUser, "dates", dateKey);
const employeeDoc = await getDoc(doc(db, "employees", currentUser));
```

#### **Required Change:**
```javascript
// ✅ With company context
const companyId = getCompanyId();
const subDocRef = doc(db, `companies/${companyId}/attendance/${currentUser}/dates/${dateKey}`);
const employeeDoc = await getDoc(doc(db, `companies/${companyId}/employees`, currentUser));
```

#### **Files to Update:**
- `employee-attendance/js/script.js` - All collection references
- `attendance/js/script.js` - All collection references

---

### **4. Firebase Configuration**

#### **Current State:**
- Hard-coded Firebase config in multiple files
- Single Firebase project for all companies

#### **Required Changes:**

**Option A: Single Project with Multi-Tenancy (Recommended)**
```javascript
// shared/js/firebase-config.js
export async function initializeFirebase(companyId) {
  const firebaseConfig = {
    // Single project config
    apiKey: "...",
    projectId: "matchanese-attendance",
    // ...
  };
  
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  
  // Set company context
  setCompanyContext(companyId);
  
  return { app, db };
}
```

**Option B: Multiple Firebase Projects (Advanced)**
```javascript
// Each company gets their own Firebase project
export async function initializeFirebase(companyId) {
  const company = await getCompany(companyId);
  const firebaseConfig = company.firebaseConfig; // Company-specific config
  
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  
  return { app, db };
}
```

---

## 🚨 **SECURITY VULNERABILITIES TO FIX**

### **1. Critical Vulnerabilities**

#### **A. Open Firestore Rules**
- **Risk**: Anyone can read/write all data
- **Impact**: Data breach, data loss, unauthorized access
- **Fix**: Implement company-scoped security rules (see above)

#### **B. Public Storage Access**
- **Risk**: Anyone can access uploaded files
- **Impact**: Privacy breach, unauthorized file access
- **Fix**: Implement company-scoped storage rules (see above)

#### **C. No Company Isolation**
- **Risk**: Companies can access each other's data
- **Impact**: Data breach, privacy violation, legal issues
- **Fix**: Implement multi-tenant data structure (see above)

#### **D. Global Employee IDs**
- **Risk**: Employee ID conflicts between companies
- **Impact**: Data corruption, wrong data access
- **Fix**: Scope employee IDs by company

### **2. High Priority Vulnerabilities**

#### **A. No Input Validation**
- **Risk**: Injection attacks, data corruption
- **Fix**: Add input sanitization and validation

#### **B. No Rate Limiting**
- **Risk**: DoS attacks, abuse
- **Fix**: Implement rate limiting per company/user

#### **C. No Audit Logging**
- **Risk**: Cannot track unauthorized access
- **Fix**: Implement audit logging for all data access

#### **D. Hard-coded Credentials**
- **Risk**: Exposed API keys, configs
- **Fix**: Use environment variables, secure config management

---

## 📊 **MIGRATION STRATEGY**

### **Phase 1: Preparation (Week 1-2)**
1. Create company management system
2. Design new data structure
3. Create migration scripts
4. Set up test environment

### **Phase 2: Data Migration (Week 3-4)**
1. Create default company for existing data
2. Migrate all data to new structure
3. Update all employee IDs
4. Verify data integrity

### **Phase 3: Code Updates (Week 5-8)**
1. Update all collection references
2. Add company context to all queries
3. Implement security rules
4. Update authentication flow

### **Phase 4: Testing (Week 9-10)**
1. Test multi-tenant isolation
2. Test security rules
3. Test white-label functionality
4. Performance testing

### **Phase 5: Deployment (Week 11-12)**
1. Deploy to staging
2. User acceptance testing
3. Production deployment
4. Monitor and fix issues

---

## 🎯 **SUCCESS CRITERIA**

### **Multi-Tenancy:**
- ✅ Companies cannot access each other's data
- ✅ All queries include company context
- ✅ Employee IDs are unique per company
- ✅ Data is properly isolated

### **Security:**
- ✅ Firestore rules enforce company isolation
- ✅ Storage rules enforce company isolation
- ✅ All API endpoints validate company access
- ✅ No unauthorized data access possible

### **White-Label:**
- ✅ Companies can customize branding
- ✅ Companies can use custom domains
- ✅ Logo and colors are applied dynamically
- ✅ No "Matchanese" branding visible to white-label customers

---

## 📝 **ADDITIONAL CONSIDERATIONS**

### **1. Performance**
- Index all companyId fields
- Optimize queries with companyId
- Consider sharding for large companies

### **2. Compliance**
- GDPR compliance (data isolation)
- Data residency requirements
- Audit trails for compliance

### **3. Scalability**
- Support thousands of companies
- Efficient data structure
- Caching strategies

### **4. Backup & Recovery**
- Company-specific backups
- Disaster recovery per company
- Data export per company

---

*This document outlines all critical requirements for white-labeling and securing the POS, Payroll, and Attendance systems. Implementation should be done in phases with thorough testing at each stage.*





