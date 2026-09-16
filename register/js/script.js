import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
    getFirestore,
    collection,
    getDocs,
    doc,
    getDoc,
    setDoc
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

const IDENTITY_TOOLKIT_BASE_URL = "https://identitytoolkit.googleapis.com/v1";
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[\d+\-\s()]{8,20}$/;
const MAX_CODE_RETRIES = 3;

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const registerForm = document.getElementById("registerForm");
const registerCard = document.getElementById("registerCard");
const successCard = document.getElementById("successCard");
const submitButton = document.getElementById("submitButton");
const submitButtonText = document.getElementById("submitButtonText");
const submitSpinner = document.getElementById("submitSpinner");
const errorMessage = document.getElementById("errorMessage");
const errorText = document.getElementById("errorText");
const successCode = document.getElementById("successCode");
const successUsername = document.getElementById("successUsername");

function showError(message) {
    errorText.textContent = message;
    errorMessage.classList.remove("hidden");
}

function hideError() {
    errorMessage.classList.add("hidden");
}

function setLoading(loading) {
    submitButton.disabled = loading;
    if (loading) {
        submitButtonText.textContent = "Creating account...";
        submitSpinner.classList.remove("hidden");
    } else {
        submitButtonText.textContent = "Create Account";
        submitSpinner.classList.add("hidden");
    }
}

function getFormValues() {
    return {
        fullName: (document.getElementById("fullName").value || "").trim(),
        nickname: (document.getElementById("nickname").value || "").trim(),
        birthday: (document.getElementById("birthday").value || "").trim(),
        email: (document.getElementById("email").value || "").trim(),
        phone: (document.getElementById("phone").value || "").trim(),
        username: (document.getElementById("username").value || "").trim(),
        password: document.getElementById("password").value || "",
        confirmPassword: document.getElementById("confirmPassword").value || ""
    };
}

function validateForm(values) {
    if (!values.fullName) return "Please enter your full name.";
    if (!values.nickname) return "Please enter your nickname.";
    if (!values.birthday) return "Please enter your birthday.";
    if (!values.email || !EMAIL_PATTERN.test(values.email)) {
        return "Please enter a valid email address.";
    }
    if (!values.phone || !PHONE_PATTERN.test(values.phone)) {
        return "Please enter a valid mobile number.";
    }
    if (!values.username) return "Please choose a username.";
    if (!USERNAME_PATTERN.test(values.username)) {
        return "Usernames may only include letters, numbers, underscores, or dashes.";
    }
    if (values.password.length < 6) {
        return "Password must be at least 6 characters.";
    }
    if (values.password !== values.confirmPassword) {
        return "Passwords do not match.";
    }
    return null;
}

async function isUsernameTaken(username) {
    const normalized = username.toLowerCase();
    const snapshot = await getDocs(collection(db, "adminUsers"));
    for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const existingUsername = (data.username || "").toLowerCase().trim();
        const existingCode = (data.employeeCode || "").toLowerCase().trim();
        if (existingUsername === normalized || existingCode === normalized) {
            return true;
        }
    }
    return false;
}

async function getNextAccountCode() {
    const snapshot = await getDocs(collection(db, "employees_v2"));
    let maxNum = 0;
    snapshot.forEach((docSnap) => {
        const n = parseInt(docSnap.id, 10);
        if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    });
    return String(maxNum + 1);
}

async function updateAuthDisplayName(idToken, displayName) {
    try {
        const response = await fetch(
            `${IDENTITY_TOOLKIT_BASE_URL}/accounts:update?key=${firebaseConfig.apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    idToken,
                    displayName,
                    returnSecureToken: false
                })
            }
        );
        return response.ok;
    } catch (error) {
        console.warn("Update display name error:", error);
        return false;
    }
}

async function createAuthAccount(employeeCode, password, displayName) {
    const email = `${employeeCode}@matchanese.local`.toLowerCase();
    const response = await fetch(
        `${IDENTITY_TOOLKIT_BASE_URL}/accounts:signUp?key=${firebaseConfig.apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email,
                password,
                returnSecureToken: true
            })
        }
    );

    const data = await response.json();
    if (!response.ok) {
        const message = data.error?.message || "Unknown error during sign-up.";
        const err = new Error(message);
        err.code = message;
        throw err;
    }

    await updateAuthDisplayName(data.idToken, displayName);
    return data.localId;
}

async function writeEmployeeRecords(employeeCode, localId, values) {
    const employeePayload = {
        name: values.fullName,
        nickname: values.nickname,
        email: values.email,
        phone: values.phone,
        birthday: values.birthday,
        baseRate: 0,
        payType: "hourly",
        monthlySalary: 0,
        periodFixedAmount: 0,
        active: true,
        leaveEligible: false,
        cashAdvanceEligible: false,
        role: "staff",
        photoUrl: null,
        createdAt: new Date(),
        signupSource: "self-register"
    };

    await setDoc(doc(db, "employees_v2", employeeCode), employeePayload, { merge: true });

    await setDoc(
        doc(db, "adminUsers", localId),
        {
            employeeCode,
            name: values.fullName,
            username: values.username,
            role: "staff",
            permissions: {},
            email: `${employeeCode}@matchanese.local`.toLowerCase(),
            createdAt: new Date(),
            updatedAt: new Date()
        },
        { merge: true }
    );
}

async function provisionWithRetry(values) {
    let lastError = null;
    const skipCodes = new Set();
    let candidate = await getNextAccountCode();

    for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
        while (skipCodes.has(candidate)) {
            candidate = String(parseInt(candidate, 10) + 1);
        }

        const existing = await getDoc(doc(db, "employees_v2", candidate));
        if (existing.exists()) {
            skipCodes.add(candidate);
            lastError = new Error(`Account code ${candidate} already exists.`);
            candidate = String(parseInt(candidate, 10) + 1);
            continue;
        }

        try {
            const localId = await createAuthAccount(
                candidate,
                values.password,
                values.fullName
            );
            await writeEmployeeRecords(candidate, localId, values);
            return { employeeCode: candidate, localId };
        } catch (error) {
            if (error.code === "EMAIL_EXISTS") {
                skipCodes.add(candidate);
                lastError = error;
                candidate = String(parseInt(candidate, 10) + 1);
                continue;
            }
            throw error;
        }
    }

    throw lastError || new Error("Could not allocate an account code. Please try again.");
}

function showSuccess(employeeCode, username) {
    successCode.textContent = employeeCode;
    successUsername.textContent = username;
    registerCard.classList.add("hidden");
    successCard.classList.remove("hidden");
}

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError();

    const values = getFormValues();
    const validationError = validateForm(values);
    if (validationError) {
        showError(validationError);
        return;
    }

    setLoading(true);

    try {
        if (await isUsernameTaken(values.username)) {
            showError("That username is already taken. Please choose another.");
            return;
        }

        const result = await provisionWithRetry(values);
        showSuccess(result.employeeCode, values.username);
    } catch (error) {
        console.error("Registration failed:", error);
        const code = error.code || error.message || "";
        if (String(code).includes("WEAK_PASSWORD")) {
            showError("Password is too weak. Please use at least 6 characters.");
        } else if (String(code).includes("TOO_MANY_ATTEMPTS")) {
            showError("Too many attempts. Please wait a few minutes and try again.");
        } else {
            showError("Could not create your account. Please try again.");
        }
    } finally {
        setLoading(false);
    }
});

[
    "fullName",
    "nickname",
    "birthday",
    "email",
    "phone",
    "username",
    "password",
    "confirmPassword"
].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", hideError);
});
