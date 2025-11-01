// Customer ID Utilities
// Provides unique customer ID generation and management

/**
 * Generate a unique customer ID for MVP
 * Format: M + 6 random characters (for Matchanese)
 * Example: MA7B9X2
 * Checks for duplicates in database
 */
export async function generateCustomerId() {
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
        const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
        const customerId = `M${randomStr}`;
        
        // Check if this ID already exists
        const customerQuery = query(collection(db, 'customers'), where('customerId', '==', customerId));
        const customerSnapshot = await getDocs(customerQuery);
        
        if (customerSnapshot.empty) {
            return customerId; // ID is unique
        }
        
        attempts++;
    }
    
    // Fallback: if we somehow can't find a unique ID after 10 attempts
    throw new Error('Unable to generate unique customer ID after multiple attempts');
}

/**
 * Validate customer ID format
 */
export function isValidCustomerId(customerId) {
    const pattern = /^M[A-Z0-9]{6}$/;
    return pattern.test(customerId);
}

/**
 * Normalize phone number to standard format
 * Ensures consistent phone number storage
 */
export function normalizePhoneNumber(phone) {
    if (!phone) return null;
    
    // Remove all non-digit characters
    let digits = phone.replace(/\D/g, '');
    
    // Handle different formats
    if (digits.startsWith('63')) {
        // Already has country code
        return '+63 ' + digits.substring(2, 5) + ' ' + digits.substring(5, 8) + ' ' + digits.substring(8);
    } else if (digits.startsWith('0')) {
        // Remove leading 0 and add country code
        digits = digits.substring(1);
        return '+63 ' + digits.substring(0, 3) + ' ' + digits.substring(3, 6) + ' ' + digits.substring(6);
    } else if (digits.length === 10) {
        // Assume it's a 10-digit number without country code
        return '+63 ' + digits.substring(0, 3) + ' ' + digits.substring(3, 6) + ' ' + digits.substring(6);
    } else {
        // Return as is if format is unclear
        return phone;
    }
}

/**
 * Validate phone number format
 */
export function isValidPhoneNumber(phone) {
    const normalized = normalizePhoneNumber(phone);
    if (!normalized) return false;
    
    const digits = normalized.replace(/\D/g, '');
    return digits.length === 13 && digits.startsWith('63');
}

/**
 * Create customer data structure
 */
export async function createCustomerData(phone, name = 'Customer', additionalData = {}) {
    const customerId = await generateCustomerId();
    const normalizedPhone = normalizePhoneNumber(phone);
    
    if (!isValidPhoneNumber(normalizedPhone)) {
        throw new Error('Invalid phone number format');
    }
    
    return {
        customerId,
        phone: normalizedPhone,
        name,
        stamps: {},
        createdAt: new Date(),
        deviceInfo: navigator.userAgent,
        isPhoneVerified: false,
        ...additionalData
    };
}

/**
 * Extract customer ID from localStorage or generate new one
 * Note: This is now async and should be awaited
 */
export async function getOrCreateCustomerId() {
    let customerId = localStorage.getItem('customerId');
    
    if (!customerId || !isValidCustomerId(customerId)) {
        customerId = await generateCustomerId();
        localStorage.setItem('customerId', customerId);
    }
    
    return customerId;
}

/**
 * Clear customer data from localStorage
 */
export function clearCustomerData() {
    localStorage.removeItem('customerId');
    localStorage.removeItem('customerPhone');
    localStorage.removeItem('userProfile');
}

/**
 * Save customer data to localStorage
 */
export function saveCustomerData(customerData) {
    if (customerData.customerId) {
        localStorage.setItem('customerId', customerData.customerId);
    }
    if (customerData.phone) {
        localStorage.setItem('customerPhone', customerData.phone);
    }
    if (customerData.name) {
        const profile = {
            name: customerData.name,
            phone: customerData.phone
        };
        localStorage.setItem('userProfile', JSON.stringify(profile));
    }
}
