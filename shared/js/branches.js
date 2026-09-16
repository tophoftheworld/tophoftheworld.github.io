/**
 * Shared branch / event catalog from Firestore `branches`.
 * Attendance & payroll store display names; schedule stores keys.
 */

const CACHE_KEY = 'branches-cache';

const STATIC_DISPLAY = {
    podium: 'Podium',
    smnorth: 'SM North',
    popup: 'Pop-up',
    workshop: 'Workshop',
    other: 'Other Events'
};

/** @type {Record<string, string>} */
let BRANCHES = { ...STATIC_DISPLAY };

/** @type {Array<{ id?: string, key: string, name: string, type?: string, archived?: boolean }>} */
let allBranches = [];

export function getBranchesMap() {
    return BRANCHES;
}

export function getAllBranches() {
    return allBranches;
}

export function getBranchCategoryFromKey(branchKey) {
    if (!branchKey) return 'other';
    if (branchKey === 'podium') return 'podium';
    if (branchKey === 'smnorth') return 'smnorth';
    if (branchKey === 'other') return 'other';
    if (branchKey === 'popup' || String(branchKey).startsWith('popup') || String(branchKey).startsWith('package')) return 'popup';
    if (branchKey === 'workshop' || String(branchKey).startsWith('workshop')) return 'workshop';
    if (branchKey === 'service' || String(branchKey).startsWith('service')) return 'service';
    return 'other';
}

/** Category for an attendance display name or schedule key. */
export function getBranchCategoryFromValue(value) {
    if (!value) return 'other';
    if (STATIC_DISPLAY[value]) return getBranchCategoryFromKey(value);
    if (value === 'Podium') return 'podium';
    if (value === 'SM North') return 'smnorth';
    if (value === 'Pop-up') return 'popup';
    if (value === 'Workshop') return 'workshop';
    if (value === 'Other Events' || value === 'Other') return 'other';

    const byKey = allBranches.find((b) => b.key === value);
    if (byKey) return byKey.type || getBranchCategoryFromKey(byKey.key);

    const byName = allBranches.find((b) => b.name === value);
    if (byName) return byName.type || getBranchCategoryFromKey(byName.key);

    return getBranchCategoryFromKey(value);
}

export function getBranchDisplayName(keyOrName) {
    if (!keyOrName) return '';
    if (BRANCHES[keyOrName]) return BRANCHES[keyOrName];
    if (Object.values(BRANCHES).includes(keyOrName)) return keyOrName;
    return keyOrName;
}

/** Map a schedule branch key to the attendance/payroll select value (display name). */
export function scheduleKeyToAttendanceValue(scheduleKey) {
    if (!scheduleKey) return 'Podium';
    if (STATIC_DISPLAY[scheduleKey]) return STATIC_DISPLAY[scheduleKey];
    return BRANCHES[scheduleKey] || scheduleKey;
}

/** Whether an attendance branch value matches an admin filter key (category or exact). */
export function attendanceMatchesFilter(attendanceBranch, filterKey) {
    if (!filterKey || filterKey === 'all') return true;
    if (!attendanceBranch) return false;

    if (filterKey === 'podium' || filterKey === 'smnorth' || filterKey === 'other') {
        return getBranchCategoryFromValue(attendanceBranch) === filterKey;
    }
    if (filterKey === 'popup' || filterKey === 'workshop' || filterKey === 'service') {
        return getBranchCategoryFromValue(attendanceBranch) === filterKey;
    }
    // Named event key
    return (
        attendanceBranch === filterKey ||
        attendanceBranch === BRANCHES[filterKey]
    );
}

/**
 * Fill a <select> with permanent locations + named events + legacy generics + Other.
 * Option values are display names (attendance/payroll storage format).
 */
export function populateAttendanceBranchSelect(selectEl, options = {}) {
    if (!selectEl) return;

    const {
        includeLegacy = true,
        selectedValue = null,
        emptyLabel = null
    } = options;

    const previous = selectedValue != null ? selectedValue : selectEl.value;

    selectEl.innerHTML = '';

    if (emptyLabel) {
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = emptyLabel;
        selectEl.appendChild(empty);
    }

    const append = (value, label) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        selectEl.appendChild(opt);
    };

    append('Podium', 'Podium');
    append('SM North', 'SM North');

    const events = allBranches
        .filter((b) => (b.type === 'popup' || b.type === 'workshop' || b.type === 'service') && b.name && b.key)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    events.forEach((b) => {
        const prefix =
            b.type === 'workshop'
                ? '[Workshop] '
                : b.type === 'service'
                  ? '[Bar Service] '
                  : '[Pop-up] ';
        append(b.name, prefix + b.name);
    });

    if (includeLegacy) {
        // Keep for historical attendance rows that still say "Pop-up" / "Workshop"
        append('Pop-up', 'Pop-up (generic)');
        append('Workshop', 'Workshop (generic)');
    }

    append('Other Events', 'Other Events');

    if (previous && [...selectEl.options].some((o) => o.value === previous)) {
        selectEl.value = previous;
    } else if (!emptyLabel) {
        selectEl.value = 'Podium';
    }
}

export function populateAttendanceBranchSelects(selectors, options = {}) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    list.forEach((sel) => {
        const el = typeof sel === 'string' ? document.getElementById(sel) : sel;
        populateAttendanceBranchSelect(el, options);
    });
}

function applyBranchList(list) {
    allBranches = (list || []).filter((b) => b && !b.archived && b.key && b.name);
    BRANCHES = { ...STATIC_DISPLAY };
    allBranches.forEach((b) => {
        BRANCHES[b.key] = b.name;
    });
}

export async function loadBranchesFromFirebase(db, firestoreFns) {
    const { getDocs, collection } = firestoreFns;
    try {
        const snapshot = await getDocs(collection(db, 'branches'));
        const firebaseBranches = [];
        snapshot.forEach((docSnap) => {
            firebaseBranches.push({ id: docSnap.id, ...docSnap.data() });
        });
        applyBranchList(firebaseBranches);
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(allBranches));
        } catch (_) { /* ignore quota */ }
        return allBranches;
    } catch (error) {
        console.warn('loadBranchesFromFirebase failed, using cache:', error);
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            try {
                applyBranchList(JSON.parse(cached));
            } catch (_) {
                applyBranchList([]);
            }
        }
        return allBranches;
    }
}
