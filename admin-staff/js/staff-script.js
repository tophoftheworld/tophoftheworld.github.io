// Staff Management Script
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { 
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    getDocs, 
    doc, 
    getDoc, 
    updateDoc, 
    setDoc, 
    addDoc,
    deleteDoc,
    query, 
    where,
    orderBy
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { 
    getStorage, 
    ref, 
    uploadBytes, 
    getDownloadURL,
    deleteObject
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

// Firebase configuration
// Use the same storage bucket as the rest of the app so CORS / rules are consistent.
// Other modules (e.g. menu-creator, POS) use "matchanese-attendance.firebasestorage.app"
// and have working uploads, so we align with that here.
const firebaseConfig = {
    apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
    authDomain: "matchanese-attendance.firebaseapp.com",
    projectId: "matchanese-attendance",
    storageBucket: "matchanese-attendance.firebasestorage.app",
    messagingSenderId: "339591618451",
    appId: "1:339591618451:web:23f9d95833ee5010bbd266",
    measurementId: "G-YEK4GML6SJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// IMPORTANT: initialize Auth so Storage requests include the user's token.
// Without importing firebase-auth, Storage uploads may be anonymous and get blocked by rules.
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const IDENTITY_TOOLKIT_BASE_URL = 'https://identitytoolkit.googleapis.com/v1';

// Global variables
const HIDE_INACTIVE_KEY = 'staff-hide-inactive';
const STAFF_TABLE_SORT_KEY = 'staff-table-sort';

let employees = {};
let filteredEmployees = {};
let hideInactive = localStorage.getItem(HIDE_INACTIVE_KEY) !== '0';
let staffTableSort = readStaffTableSort();
/** Current signed-in adminUsers record (role / permissions). */
let currentViewer = null;

function isViewerAdmin() {
    return currentViewer?.role === 'admin';
}

function canManageRoles() {
    // Role / permission scope changes are admin-only (admin dashboard Staff Management).
    return isViewerAdmin();
}

const BANK_CONFIG = {
    gotyme: {
        label: 'GoTyme',
        digits: [12],
        hint: 'GoTyme account numbers are exactly 12 digits.'
    },
    bdo: {
        label: 'BDO',
        digits: [10, 11, 12],
        hint: 'BDO account numbers are 10 to 12 digits and usually start with 00.'
    }
};

const BANK_QR_STORAGE = {
    gotyme: 'staff-gotyme-qr',
    bdo: 'staff-bdo-qr'
};

const pendingBankQr = {
    gotyme: { file: null, remove: false },
    bdo: { file: null, remove: false }
};

function emptyBankAccount() {
    return { accountName: '', accountNumber: '', qrUrl: '' };
}

function normalizeBankKey(employee) {
    const raw = String(employee?.preferredBank || employee?.bankName || '').trim().toLowerCase();
    if (BANK_CONFIG[raw]) return raw;
    const mode = String(employee?.transferMode || employee?.modeOfTransfer || '').trim().toLowerCase();
    if (mode.includes('gotyme')) return 'gotyme';
    if (mode.includes('bdo')) return 'bdo';
    return '';
}

function readBankAccounts(employee) {
    const result = { gotyme: emptyBankAccount(), bdo: emptyBankAccount() };
    const stored = employee?.bankAccounts || {};
    for (const key of ['gotyme', 'bdo']) {
        const slot = stored[key];
        if (slot && typeof slot === 'object') {
            result[key] = {
                accountName: String(slot.accountName || '').trim(),
                accountNumber: String(slot.accountNumber || '').replace(/\D/g, ''),
                qrUrl: String(slot.qrUrl || '').trim()
            };
        }
    }
    const legacyKey = String(employee?.bankName || '').trim().toLowerCase();
    if (BANK_CONFIG[legacyKey] && !result[legacyKey].accountNumber) {
        result[legacyKey].accountName = String(employee?.bankAccountName || '').trim();
        result[legacyKey].accountNumber = String(employee?.bankAccountNumber || '').replace(/\D/g, '');
    }
    if (!result.gotyme.qrUrl && employee?.gotymeQrUrl) result.gotyme.qrUrl = String(employee.gotymeQrUrl).trim();
    if (!result.bdo.qrUrl && employee?.bdoQrUrl) result.bdo.qrUrl = String(employee.bdoQrUrl).trim();
    return result;
}

function describeDigitRule(bankKey) {
    const digits = BANK_CONFIG[bankKey]?.digits || [];
    if (digits.length === 1) return `${digits[0]} digits`;
    if (digits.length > 1) return `${Math.min(...digits)}–${Math.max(...digits)} digits`;
    return 'the required length';
}

function isValidBankAccountNumber(bankKey, accountNumber) {
    const config = BANK_CONFIG[bankKey];
    if (!config) return false;
    return config.digits.includes(accountNumber.length);
}

function titleCaseBank(bankKey) {
    return bankKey === 'gotyme' ? 'Gotyme' : 'Bdo';
}

function readEditBankFields() {
    const preferred = (document.getElementById('editPreferredBank')?.value || 'gotyme').trim();
    const accounts = { gotyme: emptyBankAccount(), bdo: emptyBankAccount() };
    for (const key of ['gotyme', 'bdo']) {
        const prefix = titleCaseBank(key);
        accounts[key] = {
            accountName: (document.getElementById(`edit${prefix}AccountName`)?.value || '').trim(),
            accountNumber: (document.getElementById(`edit${prefix}AccountNumber`)?.value || '').replace(/\D/g, ''),
            qrUrl: ''
        };
    }
    return { preferred, accounts };
}

function validateEditBankFields() {
    const { preferred, accounts } = readEditBankFields();
    const saved = { gotyme: null, bdo: null };
    for (const key of ['gotyme', 'bdo']) {
        const acc = accounts[key];
        const pending = pendingBankQr[key];
        const filled = Boolean(acc.accountName || acc.accountNumber || pending.file);
        if (!filled) continue;
        if (!acc.accountName) {
            return { ok: false, message: `Please enter the ${BANK_CONFIG[key].label} account name.` };
        }
        if (!isValidBankAccountNumber(key, acc.accountNumber)) {
            return { ok: false, message: `${BANK_CONFIG[key].label} account numbers must be ${describeDigitRule(key)}.` };
        }
        if (!hasEditBankQr(key)) {
            return { ok: false, message: `Please add a ${BANK_CONFIG[key].label} QR code.` };
        }
        saved[key] = acc;
    }
    const hasAny = Boolean(saved.gotyme || saved.bdo);
    let primary = BANK_CONFIG[preferred] ? preferred : 'gotyme';
    if (!saved[primary]) {
        primary = saved.gotyme ? 'gotyme' : (saved.bdo ? 'bdo' : '');
    }
    if (!hasAny) {
        return {
            ok: true,
            patch: {
                bankAccounts: { gotyme: null, bdo: null },
                preferredBank: null,
                bankName: null,
                bankAccountName: null,
                bankAccountNumber: null,
                transferMode: null
            },
            saved,
            primary: ''
        };
    }
    const primaryAcc = saved[primary];
    return {
        ok: true,
        patch: {
            bankAccounts: {
                gotyme: saved.gotyme,
                bdo: saved.bdo
            },
            preferredBank: primary,
            bankName: primary,
            bankAccountName: primaryAcc.accountName,
            bankAccountNumber: primaryAcc.accountNumber,
            transferMode: BANK_CONFIG[primary].label
        },
        saved,
        primary
    };
}

function normalizeBirthday(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 10);
    if (value && typeof value.toDate === 'function') {
        return value.toDate().toISOString().slice(0, 10);
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    return '';
}

function isPersonalInfoComplete(employee) {
    const email = String(employee?.email || '').trim();
    const phone = String(employee?.phone || '').trim();
    const birthday = normalizeBirthday(employee?.birthday);
    return Boolean(email && phone && birthday && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function isBankAccountComplete(account, bankKey) {
    const acc = account || emptyBankAccount();
    return Boolean(
        acc.accountName &&
        isValidBankAccountNumber(bankKey, acc.accountNumber) &&
        acc.qrUrl
    );
}

function isBankInfoComplete(employee) {
    const accounts = readBankAccounts(employee);
    return ['gotyme', 'bdo'].some((key) => isBankAccountComplete(accounts[key], key));
}

function countEmptyAccountInfo(employee) {
    return (isPersonalInfoComplete(employee) ? 0 : 1) + (isBankInfoComplete(employee) ? 0 : 1);
}

function compareAccountCodes(a, b) {
    return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
        numeric: true,
        sensitivity: 'base'
    });
}

function readStaffTableSort() {
    try {
        const saved = JSON.parse(localStorage.getItem(STAFF_TABLE_SORT_KEY) || 'null');
        if (saved && (saved.column === 'id' || saved.column === 'accountInfo') &&
            (saved.direction === 'asc' || saved.direction === 'desc')) {
            return saved;
        }
    } catch (_) {}
    return { column: 'id', direction: 'asc' };
}

function persistStaffTableSort() {
    localStorage.setItem(STAFF_TABLE_SORT_KEY, JSON.stringify(staffTableSort));
}

function compareStaffTableRows(a, b) {
    const dir = staffTableSort.direction === 'desc' ? -1 : 1;
    if (staffTableSort.column === 'accountInfo') {
        const cmp = countEmptyAccountInfo(a) - countEmptyAccountInfo(b);
        if (cmp !== 0) return cmp * dir;
        return compareAccountCodes(a.id, b.id);
    }
    return compareAccountCodes(a.id, b.id) * dir;
}

function updateStaffTableSortHeaders() {
    document.querySelectorAll('#employeeTable thead th.sortable').forEach((header) => {
        const active = header.dataset.sort === staffTableSort.column;
        header.classList.toggle('sorted-asc', active && staffTableSort.direction === 'asc');
        header.classList.toggle('sorted-desc', active && staffTableSort.direction === 'desc');
        if (!active) {
            header.setAttribute('aria-sort', 'none');
        } else {
            header.setAttribute('aria-sort', staffTableSort.direction === 'desc' ? 'descending' : 'ascending');
        }
    });
}

function setupStaffTableSorting() {
    document.querySelectorAll('#employeeTable thead th.sortable').forEach((header) => {
        header.setAttribute('tabindex', '0');
        const applySort = () => {
            const column = header.dataset.sort;
            if (staffTableSort.column === column) {
                staffTableSort.direction = staffTableSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                staffTableSort.column = column;
                staffTableSort.direction = 'asc';
            }
            persistStaffTableSort();
            updateStaffTableSortHeaders();
            renderEmployeeTable();
        };
        header.addEventListener('click', applySort);
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                applySort();
            }
        });
    });
    updateStaffTableSortHeaders();
}

function formatBirthdayDisplay(value) {
    const iso = normalizeBirthday(value);
    if (!iso) return '';
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return iso;
    return new Date(year, month - 1, day).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function createAccountCheck(label, complete, title, onClick) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `account-check${complete ? ' is-complete' : ''}`;
    row.title = title;
    row.setAttribute('aria-label', `View ${label.toLowerCase()} info. ${title}`);
    row.addEventListener('click', onClick);

    const box = document.createElement('span');
    box.className = 'account-check-box';
    box.setAttribute('aria-hidden', 'true');
    if (complete) {
        box.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    }

    const text = document.createElement('span');
    text.textContent = label;

    row.appendChild(box);
    row.appendChild(text);
    return row;
}

function createAccountInfoCell(employee) {
    const cell = document.createElement('td');
    cell.className = 'account-info-cell';

    const wrap = document.createElement('div');
    wrap.className = 'account-checks';

    const personal = isPersonalInfoComplete(employee);
    const bank = isBankInfoComplete(employee);

    wrap.appendChild(createAccountCheck(
        'Personal',
        personal,
        personal ? 'Email, phone, and birthday are on file' : 'Missing email, phone, or birthday',
        () => viewPersonalInfo(employee.id)
    ));
    wrap.appendChild(createAccountCheck(
        'Bank',
        bank,
        bank ? 'Payroll bank details are on file' : 'Payroll bank details are incomplete',
        () => viewBankInfo(employee.id)
    ));

    cell.appendChild(wrap);
    return cell;
}

const MANAGER_PERMISSION_KEYS = [
    'payroll',
    'requests',
    'staff',
    'schedule',
    'inbox',
    'shopify',
    'workshops',
    'sales',
    'expenses',
    'purchasing',
    'money',
    'inventory',
    'forecast',
    'popups',
    'events'
];

function permissionCheckboxId(key) {
    return 'perm' + key.charAt(0).toUpperCase() + key.slice(1);
}

function setPermissionCheckboxes(permissions) {
    MANAGER_PERMISSION_KEYS.forEach((key) => {
        const el = document.getElementById(permissionCheckboxId(key));
        if (!el) return;
        if (key === 'forecast' && permissions && permissions.forecast == null) {
            el.checked = !!permissions.inventory;
            return;
        }
        el.checked = !!(permissions && permissions[key]);
    });
}

function readPermissionCheckboxes() {
    const permissions = {};
    MANAGER_PERMISSION_KEYS.forEach((key) => {
        const el = document.getElementById(permissionCheckboxId(key));
        permissions[key] = !!(el && el.checked);
    });
    return permissions;
}

// DOM elements
const employeeTableBody = document.getElementById('employeeTableBody');
const addEmployeeBtn = document.getElementById('addEmployeeBtn');
const refreshBtn = document.getElementById('refreshBtn');
const loadingOverlay = document.getElementById('loadingOverlay');

// Modals
const employeeEditModal = document.getElementById('employeeEditModal');
const roleManagementModal = document.getElementById('roleManagementModal');
const addEmployeeModal = document.getElementById('addEmployeeModal');
const personalInfoModal = document.getElementById('personalInfoModal');
const bankInfoModal = document.getElementById('bankInfoModal');

let accountInfoEmployeeId = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    // Ensure all modals are hidden on page load
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.style.display = 'none';
    });
    
    // Ensure we're signed in before doing Storage operations.
    // This page relies on the existing Firebase Auth session created by the admin dashboard/login.
    const user = await waitForAuthReady();
    if (!user) {
        // Redirect to admin login if not authenticated
        window.location.href = '../admin-login.html';
        return;
    }

    currentViewer = await loadCurrentViewer(user);
    if (!currentViewer) {
        console.warn('No adminUsers record for signed-in user');
        alert('Your account is not set up for admin access.');
        window.location.href = '../admin-login.html';
        return;
    }

    await loadEmployees();
    setupEventListeners();
    applyRoleUiRestrictions();
    renderEmployeeTable();
});

async function loadCurrentViewer(user) {
    try {
        const snap = await getDoc(doc(db, 'adminUsers', user.uid));
        if (!snap.exists()) return null;
        return { uid: user.uid, ...snap.data() };
    } catch (err) {
        console.error('Failed to load current viewer:', err);
        return null;
    }
}

function applyRoleUiRestrictions() {
    const addRoleGroup = document.getElementById('addRoleSelect')?.closest('.form-group');
    if (!canManageRoles()) {
        if (addRoleGroup) addRoleGroup.style.display = 'none';
        const addRoleSelect = document.getElementById('addRoleSelect');
        if (addRoleSelect) {
            addRoleSelect.value = 'staff';
            addRoleSelect.disabled = true;
        }
    } else if (addRoleGroup) {
        addRoleGroup.style.display = '';
        const addRoleSelect = document.getElementById('addRoleSelect');
        if (addRoleSelect) addRoleSelect.disabled = false;
    }
}

function waitForAuthReady() {
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user || null);
        });

        // Fallback: don't hang forever if the callback is delayed
        setTimeout(() => {
            try {
                unsubscribe();
            } catch (_) {}
            resolve(auth.currentUser || null);
        }, 2500);
    });
}

// Load employees from Firebase (employees_v2 is the only HR catalog)
async function loadEmployees() {
    try {
        showLoading(true);
        
        employees = {};
        const v2Snapshot = await getDocs(collection(db, "employees_v2"));
        v2Snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            employees[docSnap.id] = {
                id: docSnap.id,
                name: data.name || data.fullName || "Unknown",
                nickname: data.nickname || "",
                email: data.email || "",
                phone: data.phone || "",
                birthday: data.birthday || "",
                bankName: data.bankName || "",
                bankAccountName: data.bankAccountName || "",
                bankAccountNumber: data.bankAccountNumber || "",
                transferMode: data.transferMode || data.modeOfTransfer || "",
                preferredBank: data.preferredBank || data.bankName || "",
                bankAccounts: data.bankAccounts || {},
                gotymeQrUrl: data.gotymeQrUrl || "",
                bdoQrUrl: data.bdoQrUrl || "",
                baseRate: Number(data.baseRate) || 0,
                payType: data.payType || 'hourly',
                monthlySalary: Number(data.monthlySalary) || 0,
                periodFixedAmount: Number(data.periodFixedAmount) || 0,
                payScheme: data.payScheme === 'inclusive' ? 'inclusive' : 'standard',
                active: data.active !== false,
                leaveEligible: data.leaveEligible === true,
                cashAdvanceEligible: data.cashAdvanceEligible === true,
                role: data.role || "staff",
                photoUrl: data.photoUrl || null,
                permissions: data.permissions || {},
                authId: null
            };
        });

        // One-time sanity check: warn if any IDs still exist only in legacy `employees`
        await warnIfLegacyOnlyEmployees(Object.keys(employees));
        
        // Roles / permissions from adminUsers (Auth UID → employeeCode)
        const adminUsersRef = collection(db, "adminUsers");
        const adminSnapshot = await getDocs(adminUsersRef);
        
        console.log('Loading admin users from Firebase...');
        adminSnapshot.forEach((docSnapshot) => {
            const data = docSnapshot.data();
            const employeeId = data.employeeCode || docSnapshot.id;
            
            if (employeeId && employees[employeeId]) {
                employees[employeeId].role = data.role || "staff";
                employees[employeeId].permissions = data.permissions || {};
                employees[employeeId].authId = docSnapshot.id;
            }
        });
        
        renderEmployeeTable();
        console.log(`Loaded ${Object.keys(employees).length} employees`);
        
    } catch (error) {
        console.error("Error loading employees:", error);
        alert("Failed to load employees. Please try again.");
    } finally {
        showLoading(false);
    }
}

async function warnIfLegacyOnlyEmployees(v2Ids) {
    try {
        const legacySnapshot = await getDocs(collection(db, "employees"));
        const v2Set = new Set(v2Ids);
        const legacyOnly = [];
        legacySnapshot.forEach((docSnap) => {
            if (!v2Set.has(docSnap.id)) legacyOnly.push(docSnap.id);
        });
        if (legacyOnly.length) {
            console.warn(
                `Found ${legacyOnly.length} employee(s) only in legacy employees (not shown):`,
                legacyOnly
            );
        } else {
            console.log('No legacy-only employees — safe to treat employees_v2 as sole catalog.');
        }
    } catch (err) {
        console.warn('Could not scan legacy employees collection:', err);
    }
}

// Get next account code: last stored (numeric) code + 1, or 1 if none
function getNextAccountCode() {
    const ids = Object.keys(employees);
    let maxNum = 0;
    for (const id of ids) {
        const n = parseInt(id, 10);
        if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
    return String(maxNum + 1);
}

// Open add employee modal with next account code pre-filled
function openAddEmployeeModal() {
    const nextCode = getNextAccountCode();
    const addEmployeeIdInput = document.getElementById('addEmployeeId');
    if (addEmployeeIdInput) {
        addEmployeeIdInput.value = nextCode;
        addEmployeeIdInput.removeAttribute('readonly'); // ensure editable if they want to override
    }
    // Reset pay type defaults
    const addPayType = document.getElementById('addPayType');
    if (addPayType) addPayType.value = 'hourly';
    const addBaseRate = document.getElementById('addBaseRate');
    if (addBaseRate) addBaseRate.value = '';
    const addMonthly = document.getElementById('addMonthlySalary');
    if (addMonthly) addMonthly.value = '';
    const addFixed = document.getElementById('addPeriodFixedAmount');
    if (addFixed) addFixed.value = '';
    const addPayScheme = document.getElementById('addPayScheme');
    if (addPayScheme) addPayScheme.value = 'inclusive';
    updatePayTypeFieldsVisibility('add');
    openModal(addEmployeeModal);
    // Set again after modal is shown in case anything cleared it
    requestAnimationFrame(() => {
        if (addEmployeeIdInput) addEmployeeIdInput.value = nextCode;
    });
}

// Setup event listeners
function setupEventListeners() {
    // Buttons
    addEmployeeBtn.addEventListener('click', openAddEmployeeModal);
    refreshBtn.addEventListener('click', loadEmployees);

    const hideInactiveToggle = document.getElementById('hideInactiveToggle');
    if (hideInactiveToggle) {
        hideInactiveToggle.checked = hideInactive;
        hideInactiveToggle.addEventListener('change', () => {
            hideInactive = hideInactiveToggle.checked;
            localStorage.setItem(HIDE_INACTIVE_KEY, hideInactive ? '1' : '0');
            renderEmployeeTable();
        });
    }

    setupStaffTableSorting();
    
    // Modal close buttons
    document.getElementById('closeEditModal').addEventListener('click', () => closeModal(employeeEditModal));
    document.getElementById('closeRoleModal').addEventListener('click', () => closeModal(roleManagementModal));
    document.getElementById('closeAddEmployeeModal').addEventListener('click', () => closeModal(addEmployeeModal));
    document.getElementById('closePersonalInfoModal').addEventListener('click', () => closeModal(personalInfoModal));
    document.getElementById('closeBankInfoModal').addEventListener('click', () => closeModal(bankInfoModal));
    
    // Cancel buttons
    document.getElementById('cancelEditBtn').addEventListener('click', () => closeModal(employeeEditModal));
    document.getElementById('cancelRoleBtn').addEventListener('click', () => closeModal(roleManagementModal));
    document.getElementById('cancelAddEmployeeBtn').addEventListener('click', () => closeModal(addEmployeeModal));
    document.getElementById('closePersonalInfoBtn').addEventListener('click', () => closeModal(personalInfoModal));
    document.getElementById('closeBankInfoBtn').addEventListener('click', () => closeModal(bankInfoModal));
    document.getElementById('editPersonalInfoBtn').addEventListener('click', editFromAccountInfo);
    document.getElementById('editBankInfoBtn').addEventListener('click', editFromAccountInfo);
    
    // Form submissions
    document.getElementById('employeeEditForm').addEventListener('submit', handleEditEmployee);
    document.getElementById('roleManagementForm').addEventListener('submit', handleRoleManagement);
    document.getElementById('addEmployeeForm').addEventListener('submit', handleAddEmployee);
    
    // Role selection change
    document.getElementById('roleSelect').addEventListener('change', handleRoleChange);
    
    // Photo input change handlers
    document.getElementById('addPhoto').addEventListener('change', (e) => handlePhotoInputChange(e, 'add'));
    document.getElementById('editPhoto').addEventListener('change', (e) => handlePhotoInputChange(e, 'edit'));

    bindEditBankQrControls('gotyme');
    bindEditBankQrControls('bdo');
    document.querySelectorAll('[data-edit-bank-toggle]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            const bankKey = btn.getAttribute('data-edit-bank-toggle');
            const prefix = titleCaseBank(bankKey);
            const card = document.getElementById(`edit${prefix}BankCard`);
            setEditBankCardOpen(bankKey, !card?.classList.contains('is-open'));
        });
    });
    document.getElementById('editGotymeAccountNumber')?.addEventListener('input', (e) => {
        const cleaned = (e.target.value || '').replace(/\D/g, '');
        if (e.target.value !== cleaned) e.target.value = cleaned;
        refreshEditBankCardState('gotyme');
    });
    document.getElementById('editBdoAccountNumber')?.addEventListener('input', (e) => {
        const cleaned = (e.target.value || '').replace(/\D/g, '');
        if (e.target.value !== cleaned) e.target.value = cleaned;
        refreshEditBankCardState('bdo');
    });
    document.getElementById('editGotymeAccountName')?.addEventListener('input', () => refreshEditBankCardState('gotyme'));
    document.getElementById('editBdoAccountName')?.addEventListener('input', () => refreshEditBankCardState('bdo'));
    document.getElementById('editPayType')?.addEventListener('change', () => updatePayTypeFieldsVisibility('edit'));
    document.getElementById('addPayType')?.addEventListener('change', () => updatePayTypeFieldsVisibility('add'));
    document.getElementById('editPayScheme')?.addEventListener('change', () => updatePaySchemeHint('edit'));
    document.getElementById('addPayScheme')?.addEventListener('change', () => updatePaySchemeHint('add', { fillDefaultRate: true }));
    document.getElementById('editMonthlySalary')?.addEventListener('input', () => updateMonthlyCutoffHint('edit'));
    document.getElementById('addMonthlySalary')?.addEventListener('input', () => updateMonthlyCutoffHint('add'));
}

function formatPeso(amount) {
    return `₱${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function updateMonthlyCutoffHint(prefix) {
    const salary = parseFloat(document.getElementById(`${prefix}MonthlySalary`)?.value) || 0;
    const hint = document.getElementById(`${prefix}MonthlyCutoffHint`);
    if (hint) {
        hint.textContent = `Per cutoff: ${formatPeso(salary / 2)} (monthly ÷ 2)`;
    }
}

function updatePaySchemeHint(prefix, { fillDefaultRate = false } = {}) {
    const payType = document.getElementById(`${prefix}PayType`)?.value || 'hourly';
    const scheme = document.getElementById(`${prefix}PayScheme`)?.value || 'standard';
    const schemeGroup = document.getElementById(`${prefix}PaySchemeGroup`);
    const hint = document.getElementById(`${prefix}PaySchemeHint`);
    const baseInput = document.getElementById(`${prefix}BaseRate`);
    const showScheme = payType === 'hourly' || payType === 'hybrid';

    if (schemeGroup) schemeGroup.style.display = showScheme ? 'block' : 'none';

    if (hint) {
        hint.textContent = scheme === 'inclusive'
            ? 'Meal is already part of the daily rate, so it isn’t added again.'
            : '₱150 is added on top of the daily base (₱75 half day).';
    }

    if (baseInput) {
        baseInput.placeholder = scheme === 'inclusive' ? 'e.g., 750' : 'e.g., 700';
        if (fillDefaultRate && scheme === 'inclusive' && !baseInput.value) {
            baseInput.value = '750';
        }
    }
}

function updatePayTypeFieldsVisibility(prefix) {
    const payType = document.getElementById(`${prefix}PayType`)?.value || 'hourly';
    const baseGroup = document.getElementById(`${prefix}BaseRateGroup`);
    const monthlyGroup = document.getElementById(`${prefix}MonthlySalaryGroup`);
    const fixedGroup = document.getElementById(`${prefix}PeriodFixedGroup`);
    const baseInput = document.getElementById(`${prefix}BaseRate`);
    const monthlyInput = document.getElementById(`${prefix}MonthlySalary`);
    const fixedInput = document.getElementById(`${prefix}PeriodFixedAmount`);

    if (baseGroup) baseGroup.style.display = payType === 'monthly' ? 'none' : 'block';
    if (monthlyGroup) monthlyGroup.style.display = payType === 'monthly' ? 'block' : 'none';
    if (fixedGroup) fixedGroup.style.display = payType === 'hybrid' ? 'block' : 'none';

    if (baseInput) baseInput.required = payType === 'hourly' || payType === 'hybrid';
    if (monthlyInput) monthlyInput.required = payType === 'monthly';
    if (fixedInput) fixedInput.required = payType === 'hybrid';

    if (payType === 'monthly') updateMonthlyCutoffHint(prefix);
    updatePaySchemeHint(prefix, { fillDefaultRate: prefix === 'add' });
}

function buildPayFieldsFromForm(prefix) {
    const payType = document.getElementById(`${prefix}PayType`)?.value || 'hourly';
    const baseRate = parseFloat(document.getElementById(`${prefix}BaseRate`)?.value) || 0;
    const monthlySalary = parseFloat(document.getElementById(`${prefix}MonthlySalary`)?.value) || 0;
    const periodFixedAmount = parseFloat(document.getElementById(`${prefix}PeriodFixedAmount`)?.value) || 0;
    const paySchemeRaw = document.getElementById(`${prefix}PayScheme`)?.value || 'standard';
    const payScheme = (payType === 'hourly' || payType === 'hybrid') && paySchemeRaw === 'inclusive'
        ? 'inclusive'
        : 'standard';

    return {
        payType,
        baseRate: payType === 'monthly' ? 0 : baseRate,
        monthlySalary: payType === 'monthly' ? monthlySalary : 0,
        periodFixedAmount: payType === 'hybrid' ? periodFixedAmount : 0,
        payScheme
    };
}

function getPayTypeBadge(employee) {
    const t = employee?.payType || employee || 'hourly';
    if (t === 'monthly') {
        return '<span class="pay-type-badge monthly">Monthly</span>';
    }
    if (t === 'hybrid') {
        const scheme = employee?.payScheme === 'inclusive'
            ? ' <span class="pay-type-badge inclusive">Meal in rate</span>'
            : '';
        return `<span class="pay-type-badge hybrid">Hybrid</span>${scheme}`;
    }
    if (employee?.payScheme === 'inclusive') {
        return '<span class="pay-type-badge inclusive">Daily (meal in rate)</span>';
    }
    return '<span class="pay-type-badge hourly">Daily + meal</span>';
}


function applyEmployeeFilter() {
    filteredEmployees = {};
    for (const [id, employee] of Object.entries(employees)) {
        if (hideInactive && employee.active === false) continue;
        filteredEmployees[id] = employee;
    }
}

// Render employee table
function renderEmployeeTable() {
    applyEmployeeFilter();
    const employeeList = Object.values(filteredEmployees).sort(compareStaffTableRows);
    
    employeeTableBody.innerHTML = '';
    
    employeeList.forEach(employee => {
        const row = createEmployeeRow(employee);
        employeeTableBody.appendChild(row);
    });
    
    updatePagination(employeeList.length);
}

// Create employee row
function createEmployeeRow(employee) {
    const row = document.createElement('tr');
    
    const roleBadge = getRoleBadge(employee.role);
    const payTypeBadge = getPayTypeBadge(employee);
    const statusBadge = employee.active ? 
        '<span class="status-badge active">Active</span>' : 
        '<span class="status-badge inactive">Inactive</span>';
    
    // Create photo cell with upload functionality
    const photoCell = createPhotoCellElement(employee);
    
    // Create other cells
    const employeeCodeCell = document.createElement('td');
    employeeCodeCell.textContent = employee.id;
    
    const nameCell = document.createElement('td');
    nameCell.textContent = employee.name;

    const accountInfoCell = createAccountInfoCell(employee);

    const payTypeCell = document.createElement('td');
    payTypeCell.innerHTML = payTypeBadge;
    
    const roleCell = document.createElement('td');
    roleCell.innerHTML = roleBadge;
    
    const statusCell = document.createElement('td');
    statusCell.innerHTML = statusBadge;
    
    const actionsCell = document.createElement('td');
    const canEditRoles = canManageRoles();
    actionsCell.innerHTML = `
        <div class="action-buttons">
            <button class="action-btn edit-btn" onclick="editEmployee('${employee.id}')" title="Edit employee">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            ${canEditRoles ? `
            <button class="action-btn role-btn" onclick="manageRole('${employee.id}')" title="Manage role">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
            </button>
            ` : ''}
        </div>
    `;
    
    // Append all cells to row
    row.appendChild(photoCell);
    row.appendChild(employeeCodeCell);
    row.appendChild(nameCell);
    row.appendChild(accountInfoCell);
    row.appendChild(payTypeCell);
    row.appendChild(roleCell);
    row.appendChild(statusCell);
    row.appendChild(actionsCell);
    
    return row;
}

// Create photo cell element with upload functionality
function createPhotoCellElement(employee) {
    const cell = document.createElement('td');
    cell.style.textAlign = 'center';
    cell.style.padding = '8px';
    
    if (employee.photoUrl) {
        cell.innerHTML = `
            <div class="photo-container">
                <img src="${employee.photoUrl}" alt="${employee.name}" class="employee-photo" onclick="viewPhoto('${employee.photoUrl}', '${employee.name}')">
            </div>
        `;
    } else {
        cell.innerHTML = `
            <div class="photo-container">
                <div class="no-photo" onclick="uploadPhoto('${employee.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <line x1="19" x2="19" y1="8" y2="14"></line>
                        <line x1="22" x2="16" y1="11" y2="11"></line>
                    </svg>
                    <span>Add Photo</span>
                </div>
            </div>
        `;
    }
    
    return cell;
}

// Get role badge HTML
function getRoleBadge(role) {
    const badges = {
        'admin': '<span class="role-badge admin">Admin</span>',
        'manager': '<span class="role-badge manager">Manager</span>',
        'staff': '<span class="role-badge staff">Staff</span>',
        'intern': '<span class="role-badge intern">Intern</span>'
    };
    return badges[role] || '<span class="role-badge staff">Staff</span>';
}


// Update pagination
function updatePagination(totalItems) {
    const paginationInfo = document.querySelector('.pagination-info');
    if (!paginationInfo) return;
    const total = Object.keys(employees).length;
    const hidden = Math.max(0, total - totalItems);
    if (hideInactive && hidden > 0) {
        paginationInfo.textContent = `Showing ${totalItems} of ${total} employees`;
    } else {
        paginationInfo.textContent = `Showing all ${totalItems} employees`;
    }
}

function setInfoStatusBadge(el, complete) {
    if (!el) return;
    el.textContent = complete ? 'Complete' : 'Incomplete';
    el.classList.toggle('is-complete', complete);
}

function appendInfoField(container, label, value, options = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'info-field';

    const nameEl = document.createElement('div');
    nameEl.className = 'info-field-label';
    nameEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'info-field-value';
    const text = String(value || '').trim();
    if (!text) {
        valueEl.textContent = 'Not set';
        valueEl.classList.add('is-empty');
    } else if (options.href) {
        const link = document.createElement('a');
        link.href = options.href;
        link.textContent = text;
        valueEl.appendChild(link);
    } else {
        valueEl.textContent = text;
    }

    wrap.appendChild(nameEl);
    wrap.appendChild(valueEl);
    container.appendChild(wrap);
}

function createBankViewCard(bankKey, account, isPreferred, employeeName) {
    const card = document.createElement('div');
    const complete = isBankAccountComplete(account, bankKey);
    const hasAny = Boolean(account.accountName || account.accountNumber || account.qrUrl);
    card.className = `bank-view-card${complete ? ' is-complete' : ''}`;

    const heading = document.createElement('div');
    heading.className = 'bank-view-heading';

    const title = document.createElement('strong');
    title.textContent = BANK_CONFIG[bankKey].label;
    heading.appendChild(title);

    if (isPreferred && hasAny) {
        const payBadge = document.createElement('span');
        payBadge.className = 'bank-pay-badge';
        payBadge.textContent = 'Pay';
        heading.appendChild(payBadge);
    }
    card.appendChild(heading);

    if (!hasAny) {
        const empty = document.createElement('p');
        empty.className = 'info-empty';
        empty.textContent = 'Not set';
        card.appendChild(empty);
        return card;
    }

    const fields = document.createElement('div');
    fields.className = 'info-fields';
    appendInfoField(fields, 'Account name', account.accountName);
    appendInfoField(fields, 'Account number', account.accountNumber);
    card.appendChild(fields);

    if (account.qrUrl) {
        const qrBtn = document.createElement('button');
        qrBtn.type = 'button';
        qrBtn.className = 'bank-view-qr';
        qrBtn.title = `View ${BANK_CONFIG[bankKey].label} QR`;
        const qrImg = document.createElement('img');
        qrImg.src = account.qrUrl;
        qrImg.alt = `${BANK_CONFIG[bankKey].label} QR`;
        qrBtn.appendChild(qrImg);
        qrBtn.addEventListener('click', () => {
            window.viewPhoto(account.qrUrl, `${employeeName} — ${BANK_CONFIG[bankKey].label} QR`);
        });
        card.appendChild(qrBtn);
    } else {
        const missingQr = document.createElement('p');
        missingQr.className = 'info-empty';
        missingQr.textContent = 'No QR uploaded';
        card.appendChild(missingQr);
    }

    return card;
}

function viewPersonalInfo(employeeId) {
    const employee = employees[employeeId];
    if (!employee) return;

    accountInfoEmployeeId = employeeId;
    document.getElementById('personalInfoEmployeeName').textContent = employee.name || employeeId;
    setInfoStatusBadge(document.getElementById('personalInfoStatus'), isPersonalInfoComplete(employee));

    const fields = document.getElementById('personalInfoFields');
    fields.replaceChildren();
    const email = String(employee.email || '').trim();
    appendInfoField(fields, 'Email', email, email ? { href: `mailto:${email}` } : {});
    appendInfoField(fields, 'Mobile phone', employee.phone);
    appendInfoField(fields, 'Birthday', formatBirthdayDisplay(employee.birthday));

    openModal(personalInfoModal);
}

function viewBankInfo(employeeId) {
    const employee = employees[employeeId];
    if (!employee) return;

    accountInfoEmployeeId = employeeId;
    document.getElementById('bankInfoEmployeeName').textContent = employee.name || employeeId;
    setInfoStatusBadge(document.getElementById('bankInfoStatus'), isBankInfoComplete(employee));

    const accounts = readBankAccounts(employee);
    const preferred = normalizeBankKey(employee);
    const preferredEl = document.getElementById('bankInfoPreferred');
    if (preferred && (accounts[preferred].accountNumber || accounts[preferred].qrUrl)) {
        preferredEl.textContent = `Pay salary via ${BANK_CONFIG[preferred].label}`;
        preferredEl.hidden = false;
    } else {
        preferredEl.textContent = '';
        preferredEl.hidden = true;
    }

    const body = document.getElementById('bankInfoBody');
    body.replaceChildren();
    for (const key of ['gotyme', 'bdo']) {
        body.appendChild(createBankViewCard(key, accounts[key], preferred === key, employee.name || employeeId));
    }

    openModal(bankInfoModal);
}

function editFromAccountInfo() {
    const employeeId = accountInfoEmployeeId;
    closeModal(personalInfoModal);
    closeModal(bankInfoModal);
    if (employeeId) window.editEmployee(employeeId);
}

// Edit employee
window.editEmployee = function(employeeId) {
    const employee = employees[employeeId];
    if (!employee) return;
    
    document.getElementById('editEmployeeId').value = employeeId;
    document.getElementById('editEmployeeName').value = employee.name;
    document.getElementById('editNickname').value = employee.nickname || '';
    document.getElementById('editEmail').value = employee.email || '';
    document.getElementById('editPhone').value = employee.phone || '';
    document.getElementById('editBirthday').value = normalizeBirthday(employee.birthday);
    populateEditBankFields(employee);
    document.getElementById('editPayType').value = employee.payType || 'hourly';
    document.getElementById('editPayScheme').value = employee.payScheme === 'inclusive' ? 'inclusive' : 'standard';
    document.getElementById('editBaseRate').value = employee.baseRate || '';
    document.getElementById('editMonthlySalary').value = employee.monthlySalary || '';
    document.getElementById('editPeriodFixedAmount').value = employee.periodFixedAmount || '';
    document.getElementById('editActive').checked = employee.active;
    document.getElementById('editLeaveEligible').checked = employee.leaveEligible === true;
    document.getElementById('editCashAdvanceEligible').checked = employee.cashAdvanceEligible === true;
    updatePayTypeFieldsVisibility('edit');
    
    // Handle current photo display
    const currentPhotoDiv = document.getElementById('editCurrentPhoto');
    const currentPhotoImg = document.getElementById('editCurrentPhotoImg');
    const editPhotoInput = document.getElementById('editPhoto');
    
    if (employee.photoUrl) {
        currentPhotoImg.src = employee.photoUrl;
        currentPhotoDiv.style.display = 'block';
    } else {
        currentPhotoDiv.style.display = 'none';
    }
    
    // Reset photo input and preview
    editPhotoInput.value = '';
    document.getElementById('editPhotoPreview').style.display = 'none';
    
    openModal(employeeEditModal);
};

// Manage role
window.manageRole = function(employeeId) {
    if (!canManageRoles()) {
        alert('Only admins can change roles and access permissions.');
        return;
    }
    const employee = employees[employeeId];
    if (!employee) return;
    
    console.log('Managing role for employee:', employeeId, 'Current role:', employee.role);
    
    document.getElementById('roleEmployeeId').value = employeeId;
    document.getElementById('roleEmployeeName').value = employee.name;
    document.getElementById('roleSelect').value = employee.role;
    
    // Load existing permissions if available
    setPermissionCheckboxes(employee.permissions || {});
    
    // Show/hide manager permissions based on role
    handleRoleChange();
    
    openModal(roleManagementModal);
};

// Handle role change
function handleRoleChange() {
    const roleSelect = document.getElementById('roleSelect');
    const managerPermissionsSection = document.getElementById('managerPermissionsSection');
    
    if (roleSelect.value === 'manager') {
        managerPermissionsSection.style.display = 'block';
    } else {
        managerPermissionsSection.style.display = 'none';
    }
}

// Handle edit employee
async function handleEditEmployee(e) {
    e.preventDefault();
    
    const employeeId = document.getElementById('editEmployeeId').value;
    const name = document.getElementById('editEmployeeName').value;
    const nickname = document.getElementById('editNickname').value;
    const email = (document.getElementById('editEmail').value || '').trim();
    const phone = (document.getElementById('editPhone').value || '').trim();
    const birthday = (document.getElementById('editBirthday').value || '').trim();
    const bankFields = validateEditBankFields();
    if (!bankFields.ok) {
        alert(bankFields.message);
        return;
    }
    const payFields = buildPayFieldsFromForm('edit');
    const active = document.getElementById('editActive').checked;
    const leaveEligible = document.getElementById('editLeaveEligible').checked;
    const cashAdvanceEligible = document.getElementById('editCashAdvanceEligible').checked;
    const photoFile = document.getElementById('editPhoto').files[0];
    
    try {
        showLoading(true);
        
        let photoUrl = employees[employeeId].photoUrl; // Keep existing photo by default
        
        // Upload new photo if provided
        if (photoFile) {
            photoUrl = await uploadEmployeePhoto(employeeId, photoFile);
        }

        const qrUrls = await applyEditBankQrUploads(employeeId, readBankAccounts(employees[employeeId]));
        if (bankFields.patch.bankAccounts?.gotyme) {
            bankFields.patch.bankAccounts.gotyme = { ...bankFields.patch.bankAccounts.gotyme, qrUrl: qrUrls.gotyme };
        }
        if (bankFields.patch.bankAccounts?.bdo) {
            bankFields.patch.bankAccounts.bdo = { ...bankFields.patch.bankAccounts.bdo, qrUrl: qrUrls.bdo };
        }
        
        // Write definitive HR catalog only (employees_v2)
        const employeePatch = {
            name: name,
            nickname: nickname,
            email: email || null,
            phone: phone || null,
            birthday: birthday || null,
            bankAccounts: bankFields.patch.bankAccounts,
            preferredBank: bankFields.patch.preferredBank,
            bankName: bankFields.patch.bankName,
            bankAccountName: bankFields.patch.bankAccountName,
            bankAccountNumber: bankFields.patch.bankAccountNumber,
            transferMode: bankFields.patch.transferMode,
            gotymeQrUrl: qrUrls.gotyme,
            bdoQrUrl: qrUrls.bdo,
            gotymeQrUpdatedAt: new Date(),
            paymentDetailsUpdatedAt: new Date(),
            baseRate: payFields.baseRate,
            payType: payFields.payType,
            monthlySalary: payFields.monthlySalary,
            periodFixedAmount: payFields.periodFixedAmount,
            payScheme: payFields.payScheme,
            active: active,
            leaveEligible: leaveEligible,
            cashAdvanceEligible: cashAdvanceEligible,
            photoUrl: photoUrl
        };
        await setDoc(doc(db, "employees_v2", employeeId), employeePatch, { merge: true });
        
        // Update local data
        employees[employeeId] = {
            ...employees[employeeId],
            name: name,
            nickname: nickname,
            email: email || "",
            phone: phone || "",
            birthday: birthday || "",
            bankName: bankFields.patch.bankName || "",
            bankAccountName: bankFields.patch.bankAccountName || "",
            bankAccountNumber: bankFields.patch.bankAccountNumber || "",
            transferMode: bankFields.patch.transferMode || "",
            preferredBank: bankFields.patch.preferredBank || "",
            bankAccounts: bankFields.patch.bankAccounts || {},
            gotymeQrUrl: qrUrls.gotyme || "",
            bdoQrUrl: qrUrls.bdo || "",
            baseRate: payFields.baseRate,
            payType: payFields.payType,
            monthlySalary: payFields.monthlySalary,
            periodFixedAmount: payFields.periodFixedAmount,
            payScheme: payFields.payScheme,
            active: active,
            leaveEligible: leaveEligible,
            cashAdvanceEligible: cashAdvanceEligible,
            photoUrl: photoUrl
        };
        
        renderEmployeeTable();
        closeModal(employeeEditModal);
        alert('Employee updated successfully!');
        
    } catch (error) {
        console.error("Error updating employee:", error);
        alert("Failed to update employee. Please try again.");
    } finally {
        showLoading(false);
    }
}

// Handle role management
async function handleRoleManagement(e) {
    e.preventDefault();

    if (!canManageRoles()) {
        alert('Only admins can change roles and access permissions.');
        return;
    }
    
    const employeeId = document.getElementById('roleEmployeeId').value;
    const role = document.getElementById('roleSelect').value;
    
    console.log('Saving role for employee:', employeeId, 'Role:', role);
    
    // Get manager permissions if role is manager
    let permissions = {};
    if (role === 'manager') {
        permissions = readPermissionCheckboxes();
        console.log('Manager permissions:', permissions);
    }
    
    try {
        showLoading(true);
        
        const adminDocId = employees[employeeId]?.authId || employeeId;
        console.log('Saving to Firebase:', { employeeId, adminDocId, role, permissions });
        await saveAdminUserRecord(adminDocId, employeeId, employees[employeeId].name, role, permissions);
        
        console.log('Role updated successfully for:', employeeId);
        renderEmployeeTable();
        closeModal(roleManagementModal);
        alert('Employee role updated successfully!');
        
    } catch (error) {
        console.error("Error updating role:", error);
        alert("Failed to update role. Please try again.");
    } finally {
        showLoading(false);
    }
}

// Handle add employee
async function handleAddEmployee(e) {
    e.preventDefault();
    
    const employeeId = document.getElementById('addEmployeeId').value;
    const name = document.getElementById('addEmployeeName').value;
    // Only admins may assign manager/admin; non-admins always create as staff.
    const role = canManageRoles()
        ? (document.getElementById('addRoleSelect').value || 'staff')
        : 'staff';
    const nickname = document.getElementById('addNickname').value;
    const email = (document.getElementById('addEmail').value || '').trim();
    const phone = (document.getElementById('addPhone').value || '').trim();
    const birthday = (document.getElementById('addBirthday').value || '').trim();
    const payFields = buildPayFieldsFromForm('add');
    const leaveEligible = document.getElementById('addLeaveEligible').checked;
    const cashAdvanceEligible = document.getElementById('addCashAdvanceEligible').checked;
    const photoFile = document.getElementById('addPhoto').files[0];
    
    // Check if account code already exists
    if (employees[employeeId]) {
        alert('Account code already exists. Please use a different code.');
        return;
    }
    
    try {
        showLoading(true);
        
        let photoUrl = null;
        
        // Upload photo if provided
        if (photoFile) {
            photoUrl = await uploadEmployeePhoto(employeeId, photoFile);
        }
        
        // Add to definitive HR catalog (employees_v2 only)
        const employeePayload = {
            name: name,
            nickname: nickname,
            email: email || null,
            phone: phone || null,
            birthday: birthday || null,
            baseRate: payFields.baseRate,
            payType: payFields.payType || 'hourly',
            monthlySalary: payFields.monthlySalary || 0,
            periodFixedAmount: payFields.periodFixedAmount || 0,
            payScheme: payFields.payScheme || 'standard',
            active: true,
            leaveEligible: leaveEligible,
            cashAdvanceEligible: cashAdvanceEligible,
            role: role,
            photoUrl: photoUrl,
            createdAt: new Date()
        };
        await setDoc(doc(db, "employees_v2", employeeId), employeePayload, { merge: true });
        
        // Add to local data (manager permissions can be set later via Manage Role)
        employees[employeeId] = {
            id: employeeId,
            name: name,
            nickname: nickname,
            email: email || "",
            phone: phone || "",
            birthday: birthday || "",
            baseRate: payFields.baseRate,
            payType: payFields.payType || 'hourly',
            monthlySalary: payFields.monthlySalary || 0,
            periodFixedAmount: payFields.periodFixedAmount || 0,
            payScheme: payFields.payScheme || 'standard',
            active: true,
            leaveEligible: leaveEligible,
            cashAdvanceEligible: cashAdvanceEligible,
            role: role,
            photoUrl: photoUrl,
            permissions: {},
            authId: null
        };
        
        const provisionResult = await provisionEmployeeAccount(
            employeeId,
            name,
            role,
            employees[employeeId].permissions || {}
        );
        
        if (provisionResult.success) {
            employees[employeeId].authId = provisionResult.localId;
            console.log(`Provisioned Firebase Auth account for ${employeeId} (${provisionResult.status}).`);
        } else {
            console.error(`Failed to provision Firebase Auth account for ${employeeId}:`, provisionResult.error);
        }
        
        renderEmployeeTable();
        closeModal(addEmployeeModal);
        
        // Clear form
        document.getElementById('addEmployeeForm').reset();
        document.getElementById('addPhotoPreview').style.display = 'none';
        
        if (provisionResult.success) {
            alert('Employee added successfully and login account created!');
        } else {
            alert(`Employee added, but the login account could not be created automatically. Reason: ${provisionResult.readableError}`);
        }
        
    } catch (error) {
        console.error("Error adding employee:", error);
        alert("Failed to add employee. Please try again.");
    } finally {
        showLoading(false);
    }
}

// Modal functions
function openModal(modal) {
    console.log('Opening modal:', modal.id);
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
    console.log('Closing modal:', modal.id);
    modal.classList.remove('show');
    document.body.style.overflow = 'auto';
}

// Loading functions
function showLoading(show) {
    if (loadingOverlay) {
        loadingOverlay.style.display = show ? 'flex' : 'none';
    }
}

// Close modals when clicking outside
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        closeModal(e.target);
    }
});

// Function to clean up duplicate admin user entries
async function cleanupDuplicateAdminUsers() {
    try {
        console.log('Starting cleanup of duplicate admin users...');
        const adminUsersRef = collection(db, "adminUsers");
        const adminSnapshot = await getDocs(adminUsersRef);
        
        const employeeMap = new Map();
        const duplicatesToDelete = [];
        
        adminSnapshot.forEach(doc => {
            const data = doc.data();
            const employeeId = data.employeeCode;
            
            if (employeeMap.has(employeeId)) {
                // This is a duplicate - mark for deletion
                console.log('Found duplicate for employee:', employeeId, 'Doc ID:', doc.id);
                duplicatesToDelete.push(doc.id);
            } else {
                // First occurrence - keep it
                employeeMap.set(employeeId, {
                    docId: doc.id,
                    data: data
                });
            }
        });
        
        console.log(`Found ${duplicatesToDelete.length} duplicate entries to delete`);
        
        // Delete duplicates
        for (const docId of duplicatesToDelete) {
            const docRef = doc(db, "adminUsers", docId);
            await deleteDoc(docRef);
            console.log('Deleted duplicate document:', docId);
        }
        
        console.log('Cleanup completed successfully!');
        alert(`Cleanup completed! Deleted ${duplicatesToDelete.length} duplicate entries.`);
        
    } catch (error) {
        console.error('Error during cleanup:', error);
        alert('Error during cleanup. Please try again.');
    }
}

// Make cleanup function available globally for testing
window.cleanupDuplicateAdminUsers = cleanupDuplicateAdminUsers;

async function updateAuthDisplayName(idToken, displayName) {
    if (!idToken || !displayName) {
        return false;
    }
    
    try {
        const response = await fetch(`${IDENTITY_TOOLKIT_BASE_URL}/accounts:update?key=${firebaseConfig.apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                idToken,
                displayName,
                returnSecureToken: false
            })
        });
        
        if (!response.ok) {
            const data = await response.json();
            console.warn('Unable to update display name:', data.error?.message);
            return false;
        }
        
        return true;
    } catch (error) {
        console.warn('Update display name error:', error);
        return false;
    }
}

async function provisionEmployeeAccount(employeeId, employeeName, role = 'staff', existingPermissions = {}) {
    const email = `${employeeId}@matchanese.local`.toLowerCase();
    const password = employeeId;
    const readableErrors = {
        EMAIL_EXISTS: 'An account already exists for this account code.',
        INVALID_PASSWORD: 'The existing account has a different password. Please reset it to the account code in Firebase Console.',
        USER_DISABLED: 'The account is disabled in Firebase Authentication.',
        OPERATION_NOT_ALLOWED: 'Password sign-in is disabled for this project.',
        TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Please wait a few minutes before trying again.'
    };
    
    try {
        const signUpResponse = await fetch(`${IDENTITY_TOOLKIT_BASE_URL}/accounts:signUp?key=${firebaseConfig.apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                password,
                returnSecureToken: true
            })
        });
        
        const signUpData = await signUpResponse.json();
        
        if (signUpResponse.ok) {
            const displayNameUpdated = await updateAuthDisplayName(signUpData.idToken, employeeName);
            await saveAdminUserRecord(signUpData.localId, employeeId, employeeName, role, existingPermissions);
            return {
                success: true,
                localId: signUpData.localId,
                status: 'created',
                displayNameUpdated
            };
        }
        
        const signUpError = signUpData.error?.message;
        if (signUpError === 'EMAIL_EXISTS') {
            const signInResponse = await fetch(`${IDENTITY_TOOLKIT_BASE_URL}/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    password,
                    returnSecureToken: true
                })
            });
            
            const signInData = await signInResponse.json();
            
            if (signInResponse.ok) {
                const displayNameUpdated = await updateAuthDisplayName(signInData.idToken, employeeName);
                await saveAdminUserRecord(signInData.localId, employeeId, employeeName, role, existingPermissions);
                return {
                    success: true,
                    localId: signInData.localId,
                    status: 'existing',
                    displayNameUpdated
                };
            }
            
            const nestedError = signInData.error?.message;
            // Normalize newer Firebase Auth error strings
            const normalized =
                nestedError && String(nestedError).includes('INVALID_LOGIN_CREDENTIALS')
                    ? 'INVALID_PASSWORD'
                    : nestedError;
            return {
                success: false,
                error: nestedError || 'Failed to sign in to existing account.',
                readableError: readableErrors[normalized] || nestedError || 'Unknown error occurred while accessing the existing account.'
            };
        }
        
        return {
            success: false,
            error: signUpError || 'Unknown error during sign-up.',
            readableError: readableErrors[signUpError] || signUpError || 'Unknown error during sign-up.'
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message,
            readableError: error.message
        };
    }
}

async function saveAdminUserRecord(localId, employeeId, employeeName, role = 'staff', permissions = {}) {
    const rolePermissions = role === 'manager' ? permissions : {};
    const adminData = {
        employeeCode: employeeId,
        name: employeeName,
        role: role,
        permissions: rolePermissions,
        updatedAt: new Date()
    };
    
    await setDoc(doc(db, "adminUsers", localId), adminData, { merge: true });
    
    if (employees[employeeId]) {
        employees[employeeId].authId = localId;
        employees[employeeId].role = role;
        employees[employeeId].permissions = rolePermissions;
    }
}

// Compress image before upload (resize + JPEG quality) to avoid failures and save space
function compressImage(file) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            reject(new Error('Not an image'));
            return;
        }
        const maxWidth = 1200;
        const maxHeight = 1200;
        const jpegQuality = 0.82;
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width <= maxWidth && height <= maxHeight && file.size < 500 * 1024) {
                // Already small enough, use original (but ensure we have a blob for upload)
                resolve(file);
                return;
            }
            const scale = Math.min(maxWidth / width, maxHeight / height, 1);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(file);
                return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            try {
                canvas.toBlob(
                    (blob) => {
                        if (blob && blob.size < file.size) {
                            resolve(blob);
                        } else {
                            resolve(file);
                        }
                    },
                    'image/jpeg',
                    jpegQuality
                );
            } catch (err) {
                resolve(file);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(file); // fallback to original
        };
        img.src = url;
    });
}

// Photo upload and management functions
window.uploadPhoto = function(employeeId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            await handlePhotoUpload(employeeId, file);
        }
    };
    input.click();
};

window.viewPhoto = function(photoUrl, employeeName) {
    const modal = document.createElement('div');
    modal.className = 'photo-modal';
    modal.innerHTML = `
        <div class="photo-modal-content">
            <span class="close-modal" onclick="this.parentElement.parentElement.remove()">&times;</span>
            <h3>${employeeName}</h3>
            <img src="${photoUrl}" alt="${employeeName}" class="modal-image">
        </div>
    `;
    document.body.appendChild(modal);
    modal.style.display = 'flex';
};

window.deletePhoto = async function(employeeId) {
    if (!confirm('Are you sure you want to delete this photo?')) {
        return;
    }
    
    try {
        showLoading(true);
        
        const employee = employees[employeeId];
        if (employee.photoUrl) {
            // Delete from Firebase Storage
            const photoRef = ref(storage, `staff-photos/${employeeId}`);
            try {
                await deleteObject(photoRef);
            } catch (error) {
                console.warn('Photo not found in storage:', error);
            }
        }
        
        // Definitive HR catalog only
        await setDoc(doc(db, "employees_v2", employeeId), { photoUrl: null }, { merge: true });
        
        // Update local data
        employees[employeeId].photoUrl = null;
        
        renderEmployeeTable();
        alert('Photo deleted successfully!');
        
    } catch (error) {
        console.error("Error deleting photo:", error);
        alert("Failed to delete photo. Please try again.");
    } finally {
        showLoading(false);
    }
};

async function handlePhotoUpload(employeeId, file) {
    try {
        showLoading(true);
        
        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select a valid image file.');
            return;
        }
        
        // Validate file size (max 10MB before compression)
        if (file.size > 10 * 1024 * 1024) {
            alert('File size must be less than 10MB.');
            return;
        }
        
        // Compress image to reduce size and avoid upload failures
        const data = await compressImage(file);
        const contentType = data.type || 'image/jpeg';
        const metadata = { contentType };
        
        // Create storage reference (use .jpg for compressed uploads so URL is consistent)
        const storageRef = ref(storage, `staff-photos/${employeeId}`);
        
        const snapshot = await uploadBytes(storageRef, data, metadata);
        const photoUrl = await getDownloadURL(snapshot.ref);
        
        const photoPatch = {
            photoUrl: photoUrl,
            photoUpdatedAt: new Date()
        };
        await setDoc(doc(db, "employees_v2", employeeId), photoPatch, { merge: true });
        
        if (employees[employeeId]) {
            employees[employeeId].photoUrl = photoUrl;
        }
        renderEmployeeTable();
        alert('Photo uploaded successfully!');
        
    } catch (error) {
        console.error("Error uploading photo:", error);
        const code = error?.code || '';
        const msg = error?.message || String(error);
        let hint = "Please try again.";
        if (code === 'storage/unauthorized' || msg.includes('permission') || msg.includes('Permission')) {
            hint = "Storage rules may be blocking uploads. In Firebase Console → Storage → Rules, ensure staff-photos allows write. If you use a different origin (e.g. localhost), you may need to set CORS on the bucket (see Firebase Storage CORS docs).";
        } else if (code === 'storage/unknown' || msg.includes('CORS') || msg.includes('fetch')) {
            hint = "This can be a CORS issue. Configure CORS on your Storage bucket for your site's origin (e.g. http://localhost:8080) using gsutil cors set.";
        } else if (msg.includes('quota')) {
            hint = "Storage quota may be exceeded. Check Firebase Console → Usage.";
        }
        alert("Failed to upload photo: " + (msg || code) + "\n\n" + hint);
    } finally {
        showLoading(false);
    }
}

// Upload employee photo (for modal forms)
async function uploadEmployeePhoto(employeeId, file) {
    if (!file.type.startsWith('image/')) {
        throw new Error('Please select a valid image file.');
    }
    if (file.size > 10 * 1024 * 1024) {
        throw new Error('File size must be less than 10MB.');
    }
    
    const data = await compressImage(file);
    const contentType = data.type || 'image/jpeg';
    const metadata = { contentType };
    
    const storageRef = ref(storage, `staff-photos/${employeeId}`);
    const snapshot = await uploadBytes(storageRef, data, metadata);
    const photoUrl = await getDownloadURL(snapshot.ref);
    return photoUrl;
}

function bankQrStoragePath(bankKey, employeeId) {
    return `${BANK_QR_STORAGE[bankKey]}/${employeeId}`;
}

function hasEditBankQr(bankKey) {
    const pending = pendingBankQr[bankKey];
    if (pending?.file) return true;
    if (pending?.remove) return false;
    const employeeId = document.getElementById('editEmployeeId')?.value;
    const existing = employeeId ? readBankAccounts(employees[employeeId])[bankKey]?.qrUrl : '';
    return Boolean(existing);
}

function isEditBankComplete(bankKey) {
    const prefix = titleCaseBank(bankKey);
    const accountName = (document.getElementById(`edit${prefix}AccountName`)?.value || '').trim();
    const accountNumber = (document.getElementById(`edit${prefix}AccountNumber`)?.value || '').replace(/\D/g, '');
    return Boolean(accountName && isValidBankAccountNumber(bankKey, accountNumber) && hasEditBankQr(bankKey));
}

function setEditBankCardOpen(bankKey, isOpen) {
    const prefix = titleCaseBank(bankKey);
    const card = document.getElementById(`edit${prefix}BankCard`);
    const toggle = document.querySelector(`[data-edit-bank-toggle="${bankKey}"]`);
    if (!card) return;
    card.classList.toggle('is-open', isOpen);
    if (toggle) toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function refreshEditBankCardState(bankKey) {
    const prefix = titleCaseBank(bankKey);
    const card = document.getElementById(`edit${prefix}BankCard`);
    if (card) card.classList.toggle('is-complete', isEditBankComplete(bankKey));
    const row = document.getElementById('editPreferredBankRow');
    if (row) row.hidden = !(isEditBankComplete('gotyme') && isEditBankComplete('bdo'));
}

function populateEditBankFields(employee) {
    const accounts = readBankAccounts(employee);
    const preferred = normalizeBankKey(employee) || 'gotyme';
    const preferredSelect = document.getElementById('editPreferredBank');
    if (preferredSelect) preferredSelect.value = BANK_CONFIG[preferred] ? preferred : 'gotyme';

    for (const key of ['gotyme', 'bdo']) {
        pendingBankQr[key] = { file: null, remove: false };
        const prefix = titleCaseBank(key);
        const nameInput = document.getElementById(`edit${prefix}AccountName`);
        const numberInput = document.getElementById(`edit${prefix}AccountNumber`);
        const input = document.getElementById(`edit${prefix}Qr`);
        const preview = document.getElementById(`edit${prefix}QrPreview`);
        const currentWrap = document.getElementById(`editCurrent${prefix}Qr`);
        const currentImg = document.getElementById(`editCurrent${prefix}QrImg`);
        if (nameInput) nameInput.value = accounts[key].accountName;
        if (numberInput) numberInput.value = accounts[key].accountNumber;
        if (input) input.value = '';
        if (preview) preview.style.display = 'none';
        if (accounts[key].qrUrl && currentWrap && currentImg) {
            currentImg.src = accounts[key].qrUrl;
            currentWrap.style.display = 'flex';
        } else if (currentWrap) {
            currentWrap.style.display = 'none';
        }
        refreshEditBankCardState(key);
    }

    const gotymeDone = isEditBankComplete('gotyme');
    const bdoDone = isEditBankComplete('bdo');
    if (!gotymeDone && !bdoDone) {
        setEditBankCardOpen('gotyme', true);
        setEditBankCardOpen('bdo', false);
    } else if (gotymeDone && bdoDone) {
        setEditBankCardOpen('gotyme', preferred === 'gotyme');
        setEditBankCardOpen('bdo', preferred === 'bdo');
    } else {
        setEditBankCardOpen('gotyme', !gotymeDone);
        setEditBankCardOpen('bdo', !bdoDone);
    }
}

function bindEditBankQrControls(bankKey) {
    const prefix = titleCaseBank(bankKey);
    const input = document.getElementById(`edit${prefix}Qr`);
    const removeBtn = document.getElementById(`editRemove${prefix}QrBtn`);
    const clearBtn = document.getElementById(`editClear${prefix}QrPreviewBtn`);
    const currentImg = document.getElementById(`editCurrent${prefix}QrImg`);
    const preview = document.getElementById(`edit${prefix}QrPreview`);
    const previewImg = document.getElementById(`edit${prefix}QrPreviewImg`);
    const currentWrap = document.getElementById(`editCurrent${prefix}Qr`);

    input?.addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            alert(`Please select a valid image of the ${BANK_CONFIG[bankKey].label} QR code.`);
            event.target.value = '';
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            alert('File size must be less than 10MB.');
            event.target.value = '';
            return;
        }
        pendingBankQr[bankKey] = { file, remove: false };
        const reader = new FileReader();
        reader.onload = function(e) {
            if (previewImg) previewImg.src = e.target.result;
            if (preview) preview.style.display = 'block';
            if (currentWrap) currentWrap.style.display = 'none';
        };
        reader.readAsDataURL(file);
        refreshEditBankCardState(bankKey);
    });

    removeBtn?.addEventListener('click', () => {
        pendingBankQr[bankKey] = { file: null, remove: true };
        if (input) input.value = '';
        if (preview) preview.style.display = 'none';
        if (currentWrap) currentWrap.style.display = 'none';
        refreshEditBankCardState(bankKey);
    });

    clearBtn?.addEventListener('click', () => {
        pendingBankQr[bankKey].file = null;
        if (input) input.value = '';
        if (preview) preview.style.display = 'none';
        const employeeId = document.getElementById('editEmployeeId')?.value;
        const existingUrl = readBankAccounts(employees[employeeId])[bankKey]?.qrUrl;
        if (!pendingBankQr[bankKey].remove && existingUrl && currentWrap) {
            currentWrap.style.display = 'flex';
        }
        refreshEditBankCardState(bankKey);
    });

    currentImg?.addEventListener('click', () => {
        const src = currentImg?.src;
        if (src) window.viewPhoto(src, `${BANK_CONFIG[bankKey].label} QR`);
    });
}

async function prepareBankQrFile(file) {
    if (file.size <= 1.5 * 1024 * 1024) return file;
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const maxSize = 1800;
            let { width, height } = img;
            const scale = Math.min(maxSize / width, maxSize / height, 1);
            if (scale === 1 && file.size < 3 * 1024 * 1024) {
                resolve(file);
                return;
            }
            width = Math.round(width * scale);
            height = Math.round(height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(file);
                return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                resolve(blob && blob.size < file.size ? blob : file);
            }, 'image/jpeg', 0.92);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(file);
        };
        img.src = url;
    });
}

async function uploadBankQr(bankKey, employeeId, file) {
    if (!file.type.startsWith('image/')) {
        throw new Error(`Please select a valid image of the ${BANK_CONFIG[bankKey].label} QR code.`);
    }
    if (file.size > 10 * 1024 * 1024) {
        throw new Error('File size must be less than 10MB.');
    }
    const data = await prepareBankQrFile(file);
    const snapshot = await uploadBytes(ref(storage, bankQrStoragePath(bankKey, employeeId)), data, {
        contentType: data.type || 'image/jpeg'
    });
    return getDownloadURL(snapshot.ref);
}

async function deleteBankQr(bankKey, employeeId) {
    try {
        await deleteObject(ref(storage, bankQrStoragePath(bankKey, employeeId)));
    } catch (error) {
        console.warn(`${BANK_CONFIG[bankKey].label} QR not found in storage:`, error);
    }
}

async function applyEditBankQrUploads(employeeId, existingAccounts) {
    const urls = {
        gotyme: existingAccounts.gotyme.qrUrl || null,
        bdo: existingAccounts.bdo.qrUrl || null
    };
    for (const key of ['gotyme', 'bdo']) {
        const pending = pendingBankQr[key];
        const kept = Boolean(readEditBankFields().accounts[key].accountNumber || pending.file);
        if (!kept) {
            if (urls[key]) await deleteBankQr(key, employeeId);
            urls[key] = null;
            continue;
        }
        if (pending.remove && !pending.file) {
            await deleteBankQr(key, employeeId);
            urls[key] = null;
        }
        if (pending.file) {
            urls[key] = await uploadBankQr(key, employeeId, pending.file);
        }
    }
    return urls;
}

// Handle photo input change for previews
function handlePhotoInputChange(event, type) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const previewId = type === 'add' ? 'addPhotoPreview' : 'editPhotoPreview';
            const previewImgId = type === 'add' ? 'addPhotoPreviewImg' : 'editPhotoPreviewImg';
            
            document.getElementById(previewImgId).src = e.target.result;
            document.getElementById(previewId).style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

// Remove photo preview
window.removePhotoPreview = function(type) {
    const previewId = type === 'add' ? 'addPhotoPreview' : 'editPhotoPreview';
    const inputId = type === 'add' ? 'addPhoto' : 'editPhoto';
    
    document.getElementById(previewId).style.display = 'none';
    document.getElementById(inputId).value = '';
}
