// staff-profile-cache.js - Instant profile paint + employee code resolution
const CACHE_PREFIX = 'staffProfileCache:';

export function profileCacheKey(uid) {
    return `${CACHE_PREFIX}${uid}`;
}

export function readProfileCache(uid) {
    if (!uid) return null;
    try {
        const raw = localStorage.getItem(profileCacheKey(uid));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

export function writeProfileCache(uid, data) {
    if (!uid || !data) return;
    try {
        const prev = readProfileCache(uid) || {};
        localStorage.setItem(profileCacheKey(uid), JSON.stringify({
            ...prev,
            ...data,
            updatedAt: Date.now()
        }));
    } catch {
        // ignore quota / private mode
    }
}

export function clearProfileCache(uid) {
    if (!uid) return;
    try {
        localStorage.removeItem(profileCacheKey(uid));
    } catch {
        // ignore
    }
}

/**
 * Resolve the employees_v2 document id for a signed-in user.
 * Prefer adminUsers.employeeCode; fall back to Auth email local-part
 * when it looks like {code}@matchanese.local.
 */
export function resolveEmployeeCode(user, userData) {
    const fromDoc = userData?.employeeCode ?? userData?.employeeId ?? null;
    if (fromDoc != null && String(fromDoc).trim() !== '') {
        return String(fromDoc).trim();
    }

    const email = (user?.email || '').trim().toLowerCase();
    const match = email.match(/^([^@]+)@matchanese\.local$/);
    if (match?.[1]) {
        return match[1];
    }

    return null;
}

export function getInitials(name) {
    return String(name || 'Staff')
        .split(/\s+/)
        .filter(Boolean)
        .map(part => part.charAt(0))
        .join('')
        .substring(0, 2)
        .toUpperCase() || 'SM';
}
