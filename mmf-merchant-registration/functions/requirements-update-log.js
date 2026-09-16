'use strict';

const UPDATE_LOG_COOLDOWN_MS = 30 * 60 * 1000;
const UPDATE_LOG_MAX_ENTRIES = 100;

const IGNORED_KEYS = new Set([
    'updateLog',
    'emailNotification',
    'updatedAt',
    'createdAt',
    'submittedAt',
]);

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (typeof value._seconds === 'number') return value._seconds * 1000;
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    return 0;
}

function normalizeForCompare(value) {
    if (value == null) return null;
    if (Array.isArray(value)) {
        return value.map((item) => normalizeForCompare(item));
    }
    if (typeof value === 'object') {
        if (typeof value.toMillis === 'function' || typeof value.toDate === 'function') {
            return toMillis(value);
        }
        if (typeof value.url === 'string' && Object.keys(value).some((key) => key === 'url' || key === 'name' || key === 'path')) {
            return {
                url: value.url || '',
                name: value.name || '',
                path: value.path || '',
            };
        }
        const out = {};
        Object.keys(value)
            .filter((key) => !IGNORED_KEYS.has(key))
            .sort()
            .forEach((key) => {
                out[key] = normalizeForCompare(value[key]);
            });
        return out;
    }
    if (typeof value === 'string') return value.trim();
    return value;
}

function contentSnapshot(data) {
    return JSON.stringify(normalizeForCompare(data || {}));
}

function hasMeaningfulContentChange(before, after) {
    return contentSnapshot(before) !== contentSnapshot(after);
}

function getUpdateLog(data) {
    return Array.isArray(data?.updateLog) ? data.updateLog : [];
}

function lastLogMillis(data) {
    const log = getUpdateLog(data);
    if (log.length) {
        return toMillis(log[log.length - 1]?.at);
    }
    return toMillis(data?.submittedAt) || toMillis(data?.createdAt) || 0;
}

function buildLogEntry(type, at = new Date()) {
    return {
        type,
        at,
    };
}

function appendUpdateLog(existingLog, entry) {
    const next = [...(Array.isArray(existingLog) ? existingLog : []), entry];
    if (next.length <= UPDATE_LOG_MAX_ENTRIES) return next;
    return next.slice(next.length - UPDATE_LOG_MAX_ENTRIES);
}

/**
 * Decide whether to append an update-log entry for a requirements write.
 * @returns {{ shouldWrite: boolean, updateLog?: Array, reason?: string }}
 */
function planRequirementsUpdateLog({ before, after, now = new Date() }) {
    const afterState = String(after?.submissionState || '').toLowerCase();
    if (afterState !== 'submitted') {
        return { shouldWrite: false, reason: 'not_submitted' };
    }

    const beforeState = String(before?.submissionState || '').toLowerCase();
    const existingLog = getUpdateLog(after);
    const becameSubmitted = beforeState !== 'submitted' && afterState === 'submitted';
    const isCreate = !before;

    if (isCreate || becameSubmitted) {
        const alreadyHasSubmit = existingLog.some((entry) => entry?.type === 'submitted');
        if (alreadyHasSubmit) {
            return { shouldWrite: false, reason: 'already_logged_submit' };
        }
        return {
            shouldWrite: true,
            updateLog: appendUpdateLog(existingLog, buildLogEntry('submitted', now)),
            reason: 'initial_submit',
        };
    }

    if (!hasMeaningfulContentChange(before, after)) {
        return { shouldWrite: false, reason: 'no_content_change' };
    }

    const elapsed = now.getTime() - lastLogMillis(after);
    if (elapsed < UPDATE_LOG_COOLDOWN_MS) {
        return { shouldWrite: false, reason: 'within_cooldown' };
    }

    return {
        shouldWrite: true,
        updateLog: appendUpdateLog(existingLog, buildLogEntry('updated', now)),
        reason: 'throttled_update',
    };
}

module.exports = {
    UPDATE_LOG_COOLDOWN_MS,
    UPDATE_LOG_MAX_ENTRIES,
    planRequirementsUpdateLog,
    hasMeaningfulContentChange,
    contentSnapshot,
};
