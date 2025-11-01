# Matchanese Admin Dashboard - Firebase Authentication Setup

This document explains how to set up and use Firebase Authentication for the Matchanese Admin Dashboard.

## Overview

The admin dashboard now uses Firebase Authentication to secure access. The system maintains the same staff credentials from the attendance system but implements them through Firebase Auth instead of simple code-based authentication.

## Files Created/Modified

### New Files:
- `js/firebase-auth-setup.js` - Firebase Authentication configuration and functions
- `admin-login.html` - Login page for admin dashboard
- `setup-firebase-users.html` - Utility to create Firebase Auth users
- `js/admin-auth.js` - Authentication handling for admin dashboard

### Modified Files:
- `admin.html` - Added authentication protection and user info display

## Setup Instructions

### 1. First-Time Setup

1. **Create Firebase Auth Users:**
   - Open `setup-firebase-users.html` in your browser
   - Click "Create Firebase Users" button
   - This will load all current employees from your Firebase "employees" collection
   - Creates Firebase Authentication accounts for all current staff members
   - **Important:** Only run this once!

2. **Access the Admin Dashboard:**
   - Navigate to `admin-login.html`
   - Use the credentials below to log in

### 2. Login Credentials

#### Admin Accounts:
- **Admin:** `admin` / `admin`
- **Manager:** `manager` / `manager`

#### Admin Staff Accounts (Full Admin Access):
- **Beatrice Grace Boldo:** `130129` / `130129`
- **Cristopher David:** `130229` / `130229`

#### Regular Staff Accounts (Login Only, No Admin Access):
Each staff member uses their employee code as both username and password:
- **Username:** `[employee_code]` (e.g., `130329`)
- **Password:** `[employee_code]` (e.g., `130329`)

#### Staff Mapping:
**Note:** The system now pulls all current employees from your Firebase "employees" collection. The table below shows the access levels:

| Employee Code | Access Level | Notes |
|---------------|--------------|-------|
| 130129 | **Admin** | Beatrice Grace Boldo - Full admin access |
| 130229 | **Admin** | Cristopher David - Full admin access |
| All others | Staff Only | All other current employees - Login only |

**Current Employee List:** The system automatically loads all employees from your Firebase "employees" collection, so any new employees added there will be included when you run the setup.

## Features

### Authentication Flow:
1. **Login Page:** Users must authenticate via `admin-login.html`
2. **Session Management:** Firebase handles session persistence
3. **User Info Display:** Shows logged-in user's name and role in sidebar
4. **Logout:** Secure logout with session cleanup
5. **Auto-redirect:** Unauthenticated users are redirected to login

### Security Features:
- **Role-based Access:** Admin and Manager roles have full access
- **Staff Access:** Staff members can access the dashboard
- **Session Protection:** All admin routes are protected
- **Secure Logout:** Clears all session data

### User Experience:
- **Loading States:** Shows loading spinner during authentication
- **Error Handling:** Clear error messages for failed logins
- **Responsive Design:** Works on desktop and mobile
- **User Feedback:** Shows user info and logout option

## Usage

### For Administrators:
1. Go to `admin-login.html`
2. Use admin credentials to log in
3. Access all admin dashboard features
4. Use the "Sign Out" button in the sidebar to logout

### For Staff:
1. Go to `admin-login.html`
2. Use your staff email and password
3. Access the admin dashboard (with appropriate permissions)
4. Use the "Sign Out" button in the sidebar to logout

## Important Notes

### Attendance System:
- **No Changes:** The attendance system (`attendance/`) continues to work exactly as before
- **Separate Auth:** Uses its own authentication system (employee codes)
- **Independent:** No impact on existing attendance functionality

### Firebase Configuration:
- **Same Project:** Uses the existing Firebase project (`matchanese-attendance`)
- **New Collection:** Creates `adminUsers` collection in Firestore
- **Auth Service:** Uses Firebase Authentication service

### Security Considerations:
- **HTTPS Required:** Firebase Auth requires HTTPS in production
- **Password Policy:** Consider implementing stronger password requirements
- **Session Timeout:** Firebase handles session management automatically
- **Access Logs:** Firebase provides authentication logs

## Troubleshooting

### Common Issues:

1. **"User not found" error:**
   - Make sure you ran the setup script (`setup-firebase-users.html`)
   - Check that the email format is correct

2. **"Invalid password" error:**
   - Verify the password format: `matcha[employee_code]`
   - Check for typos in the password

3. **"Access denied" message:**
   - Only admin and manager roles have full access
   - Staff members have limited access

4. **Login page not loading:**
   - Check that Firebase configuration is correct
   - Verify internet connection

### Development:
- Check browser console for error messages
- Verify Firebase project configuration
- Ensure all files are properly linked

## Future Enhancements

Potential improvements for the authentication system:
- Password reset functionality
- Two-factor authentication
- Role-based feature access
- User management interface
- Session timeout configuration
- Audit logging

## Support

For issues with the authentication system:
1. Check the browser console for errors
2. Verify Firebase project status
3. Ensure all setup steps were completed
4. Contact system administrator for assistance
