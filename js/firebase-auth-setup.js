// firebase-auth-setup.js - Firebase Authentication setup for admin dashboard
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc,
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.firebasestorage.app",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266",
    measurementId: "G-YEK4GML6SJ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Staff credentials will be loaded from Firebase "employees" collection
let STAFF_CREDENTIALS = {};

// Admin staff codes (these get admin access)
const ADMIN_STAFF_CODES = ["130129", "130229"];

// Function to load employees from Firebase
async function loadEmployeesFromFirebase() {
    try {
        const employeesRef = collection(db, "employees");
        const snapshot = await getDocs(employeesRef);
        
        STAFF_CREDENTIALS = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            const employeeCode = doc.id; // Document ID is the employee code
            const name = data.name || data.fullName || "Unknown";
            
            // Determine role: admin if in ADMIN_STAFF_CODES, otherwise staff
            const role = ADMIN_STAFF_CODES.includes(employeeCode) ? "admin" : "staff";
            
            STAFF_CREDENTIALS[employeeCode] = {
                name: name,
                username: employeeCode,
                password: employeeCode,
                role: role
            };
        });
        
        console.log(`Loaded ${Object.keys(STAFF_CREDENTIALS).length} employees from Firebase`);
        return STAFF_CREDENTIALS;
    } catch (error) {
        console.error("Error loading employees from Firebase:", error);
        return {};
    }
}

// Admin credentials (using same pattern as staff)
const ADMIN_CREDENTIALS = {
    "admin": { name: "Admin", username: "admin", password: "admin" },
    "manager": { name: "Manager", username: "manager", password: "manager" }
};

// Function to create Firebase Auth users (run once to set up accounts)
async function createFirebaseUsers() {
    console.log("Creating Firebase Auth users...");
    
    // Load employees from Firebase first
    await loadEmployeesFromFirebase();
    
    if (Object.keys(STAFF_CREDENTIALS).length === 0) {
        console.error("No employees found in Firebase. Please check the 'employees' collection.");
        return;
    }
    
    // Create staff accounts
    for (const [code, credentials] of Object.entries(STAFF_CREDENTIALS)) {
        try {
            // Firebase requires email format, so we use username@matchanese.local
            const email = `${credentials.username}@matchanese.local`;
            
            const userCredential = await createUserWithEmailAndPassword(
                auth, 
                email, 
                credentials.password
            );
            
            // Update user profile
            await updateProfile(userCredential.user, {
                displayName: credentials.name
            });
            
            // Store additional user data in Firestore
            await setDoc(doc(db, "adminUsers", userCredential.user.uid), {
                employeeCode: code,
                name: credentials.name,
                username: credentials.username,
                email: email,
                role: credentials.role || "staff",
                createdAt: new Date()
            });
            
            console.log(`Created user: ${credentials.name} (${code})`);
        } catch (error) {
            if (error.code === 'auth/email-already-in-use') {
                console.log(`User already exists: ${credentials.name}`);
            } else {
                console.error(`Error creating user ${credentials.name}:`, error);
            }
        }
    }
    
    // Create admin accounts
    for (const [code, credentials] of Object.entries(ADMIN_CREDENTIALS)) {
        try {
            // Firebase requires email format, so we use username@matchanese.local
            const email = `${credentials.username}@matchanese.local`;
            
            const userCredential = await createUserWithEmailAndPassword(
                auth, 
                email, 
                credentials.password
            );
            
            // Update user profile
            await updateProfile(userCredential.user, {
                displayName: credentials.name
            });
            
            // Store additional user data in Firestore
            await setDoc(doc(db, "adminUsers", userCredential.user.uid), {
                employeeCode: code,
                name: credentials.name,
                username: credentials.username,
                email: email,
                role: "admin",
                createdAt: new Date()
            });
            
            console.log(`Created admin user: ${credentials.name}`);
        } catch (error) {
            if (error.code === 'auth/email-already-in-use') {
                console.log(`Admin user already exists: ${credentials.name}`);
            } else {
                console.error(`Error creating admin user ${credentials.name}:`, error);
            }
        }
    }
}

// Helper function to find user by username or employeeCode in adminUsers collection
async function findUserByUsernameOrCode(identifier) {
    try {
        const adminUsersRef = collection(db, "adminUsers");
        const snapshot = await getDocs(adminUsersRef);
        
        // Normalize identifier for comparison (case-insensitive)
        const normalizedIdentifier = identifier.toLowerCase().trim();
        
        for (const docSnap of snapshot.docs) {
            const userData = docSnap.data();
            const username = (userData.username || '').toLowerCase().trim();
            const employeeCode = (userData.employeeCode || '').toLowerCase().trim();
            
            // Check if identifier matches username or employeeCode (case-insensitive)
            if (username === normalizedIdentifier || employeeCode === normalizedIdentifier) {
                return {
                    uid: docSnap.id,
                    employeeCode: userData.employeeCode,
                    username: userData.username,
                    ...userData
                };
            }
        }
        console.log(`User lookup: No match found for identifier "${identifier}"`);
        return null;
    } catch (error) {
        console.error("Error finding user:", error);
        return null;
    }
}

// Authentication functions
async function signInUser(username, password) {
    try {
        // First, try to find the user by username or employeeCode in Firestore
        const userData = await findUserByUsernameOrCode(username);
        
        let email;
        if (userData && userData.employeeCode) {
            // Use the employeeCode for Firebase Auth (permanent identifier)
            // This allows username to be changed without affecting Firebase Auth
            email = `${userData.employeeCode}@matchanese.local`;
            console.log(`Found user: username="${userData.username}", employeeCode="${userData.employeeCode}", using email="${email}"`);
        } else {
            // Fallback: if not found in adminUsers, try direct login with username
            // (for backwards compatibility or if user hasn't been migrated yet)
            email = `${username}@matchanese.local`;
            console.log(`User not found in adminUsers, trying direct login with email="${email}"`);
        }
        
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return { success: true, user: userCredential.user };
    } catch (error) {
        console.error('Login error:', error.code, error.message);
        // Provide more specific error messages
        let errorMessage = error.message;
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
            errorMessage = 'Invalid employee code or password. Please check your credentials.';
        } else if (error.code === 'auth/user-not-found') {
            errorMessage = 'Employee code not found. Please check your credentials.';
        }
        return { success: false, error: errorMessage, code: error.code };
    }
}

async function signOutUser() {
    try {
        await signOut(auth);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Get current user data from Firestore
async function getCurrentUserData(user) {
    try {
        // Look up user data using Firebase UID as document ID
        const userDoc = await getDoc(doc(db, "adminUsers", user.uid));
        if (userDoc.exists()) {
            return userDoc.data();
        }
        return null;
    } catch (error) {
        console.error("Error getting user data:", error);
        return null;
    }
}

// Check if user has admin privileges
function isAdmin(userData) {
    return userData && (userData.role === "admin" || userData.role === "manager");
}

// Export functions and objects
export { 
    auth, 
    db, 
    signInUser, 
    signOutUser, 
    onAuthStateChanged, 
    getCurrentUserData, 
    isAdmin,
    createFirebaseUsers,
    loadEmployeesFromFirebase,
    STAFF_CREDENTIALS,
    ADMIN_CREDENTIALS
};
