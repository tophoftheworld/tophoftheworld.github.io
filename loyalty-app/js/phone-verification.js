// Phone Verification System
// Handles phone number verification for customer accounts

import { db, collection, addDoc, updateDoc, doc, getDocs, query, where } from './firebase-config.js';
import { normalizePhoneNumber, isValidPhoneNumber } from './customer-id-utils.js';

/**
 * Generate a random verification code
 */
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Store verification code in database
 */
async function storeVerificationCode(phone, code, customerId) {
    try {
        const normalizedPhone = normalizePhoneNumber(phone);
        
        const verificationData = {
            phone: normalizedPhone,
            code: code,
            customerId: customerId,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
            verified: false,
            attempts: 0
        };
        
        await addDoc(collection(db, 'phoneVerifications'), verificationData);
        return true;
    } catch (error) {
        console.error('Error storing verification code:', error);
        return false;
    }
}

/**
 * Verify phone number with code
 */
async function verifyPhoneCode(phone, code, customerId) {
    try {
        const normalizedPhone = normalizePhoneNumber(phone);
        
        // Find verification record
        const verificationQuery = query(
            collection(db, 'phoneVerifications'),
            where('phone', '==', normalizedPhone),
            where('customerId', '==', customerId),
            where('verified', '==', false)
        );
        
        const verificationSnapshot = await getDocs(verificationQuery);
        
        if (verificationSnapshot.empty) {
            return { success: false, message: 'No verification code found' };
        }
        
        const verificationDoc = verificationSnapshot.docs[0];
        const verificationData = verificationDoc.data();
        
        // Check if code is expired
        if (new Date() > verificationData.expiresAt.toDate()) {
            return { success: false, message: 'Verification code has expired' };
        }
        
        // Check if too many attempts
        if (verificationData.attempts >= 3) {
            return { success: false, message: 'Too many verification attempts' };
        }
        
        // Check if code matches
        if (verificationData.code !== code) {
            // Increment attempts
            await updateDoc(doc(db, 'phoneVerifications', verificationDoc.id), {
                attempts: verificationData.attempts + 1
            });
            
            return { success: false, message: 'Invalid verification code' };
        }
        
        // Mark as verified
        await updateDoc(doc(db, 'phoneVerifications', verificationDoc.id), {
            verified: true,
            verifiedAt: new Date()
        });
        
        // Update customer record
        const customerQuery = query(collection(db, 'customers'), where('customerId', '==', customerId));
        const customerSnapshot = await getDocs(customerQuery);
        
        if (!customerSnapshot.empty) {
            await updateDoc(doc(db, 'customers', customerSnapshot.docs[0].id), {
                isPhoneVerified: true,
                phoneVerifiedAt: new Date()
            });
        }
        
        return { success: true, message: 'Phone number verified successfully' };
        
    } catch (error) {
        console.error('Error verifying phone code:', error);
        return { success: false, message: 'Error verifying phone number' };
    }
}

/**
 * Send verification code (simulated - in real app, integrate with SMS service)
 */
async function sendVerificationCode(phone, customerId) {
    try {
        const normalizedPhone = normalizePhoneNumber(phone);
        
        if (!isValidPhoneNumber(normalizedPhone)) {
            return { success: false, message: 'Invalid phone number format' };
        }
        
        // Check if phone is already verified for another customer
        const existingCustomerQuery = query(
            collection(db, 'customers'),
            where('phone', '==', normalizedPhone),
            where('isPhoneVerified', '==', true)
        );
        const existingCustomerSnapshot = await getDocs(existingCustomerQuery);
        
        if (!existingCustomerSnapshot.empty) {
            const existingCustomer = existingCustomerSnapshot.docs[0].data();
            if (existingCustomer.customerId !== customerId) {
                return { success: false, message: 'Phone number is already verified for another account' };
            }
        }
        
        const code = generateVerificationCode();
        const stored = await storeVerificationCode(normalizedPhone, code, customerId);
        
        if (!stored) {
            return { success: false, message: 'Failed to store verification code' };
        }
        
        // For MVP: Just log the code and show it in the UI
        console.log(`SMS Code for ${normalizedPhone}: ${code}`);
        
        return { 
            success: true, 
            message: 'Verification code sent',
            demoCode: code  // Always show code for MVP testing
        };
        
    } catch (error) {
        console.error('Error sending verification code:', error);
        return { success: false, message: 'Error sending verification code' };
    }
}

/**
 * Check if phone number is verified for a customer
 */
async function isPhoneVerified(customerId, phone) {
    try {
        const normalizedPhone = normalizePhoneNumber(phone);
        
        const customerQuery = query(
            collection(db, 'customers'),
            where('customerId', '==', customerId),
            where('phone', '==', normalizedPhone)
        );
        
        const customerSnapshot = await getDocs(customerQuery);
        
        if (customerSnapshot.empty) {
            return false;
        }
        
        const customerData = customerSnapshot.docs[0].data();
        return customerData.isPhoneVerified === true;
        
    } catch (error) {
        console.error('Error checking phone verification:', error);
        return false;
    }
}

export {
    sendVerificationCode,
    verifyPhoneCode,
    isPhoneVerified
};
