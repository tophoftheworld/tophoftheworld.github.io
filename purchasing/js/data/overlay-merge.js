/**
 * 3-way merge for the shared purchasing live overlay.
 * Pure functions \u2014 safe to unit test without Firebase.
 */

function emptyOverlay(weekStart, weekEnd) {
  return {
    weekStart: weekStart || null,
    weekEnd: weekEnd || null,
    weekStatus: 'draft',
    released: 0,
    spent: 0,
    returned: 0,
    settledAt: null,
    lines: {},
    manualLines: {},
    branchForecast: {},
    locationMeta: {},
    offPlanExpenses: [],
  };
}

/** ISO timestamp from a line/expense entry (legacy entries count as epoch). */
export function entryUpdatedAt(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const raw = entry.updatedAt;
  if (typeof raw === 'string' && raw) return raw;
  // Firestore Timestamp-like
  if (raw && typeof raw.toDate === 'function') {
    try {
      return raw.toDate().toISOString();
    } catch (_) {
      return '';
    }
  }
  if (raw && typeof raw.seconds === 'number') {
    return new Date(raw.seconds * 1000).toISOString();
  }
  return '';
}

export function stampEntryUpdatedAt(entry, now = new Date().toISOString()) {
  if (!entry || typeof entry !== 'object') return entry;
  return { ...entry, updatedAt: entry.updatedAt || now };
}

function sameEntry(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  // Compare payload ignoring stamp noise when both lack meaningful diffs.
  try {
    const strip = (v) => {
      const { updatedAt: _u, updatedBy: _b, ...rest } = v;
      return JSON.stringify(rest);
    };
    return strip(a) === strip(b);
  } catch (_) {
    return false;
  }
}

/**
 * 3-way merge of object maps keyed by string.
 * - Key only in local (not in acked) → local add (keep unless remote has newer)
 * - Key in acked, missing in local, remote unchanged from acked → local delete
 * - Key in acked, missing in local, remote changed → keep remote (someone else edited)
 * - Both local and remote present → newer updatedAt wins; tie → local
 * - Key only in remote → keep remote
 */
export function mergeMap3Way(acked = {}, local = {}, remote = {}) {
  const keys = new Set([
    ...Object.keys(acked || {}),
    ...Object.keys(local || {}),
    ...Object.keys(remote || {}),
  ]);
  const out = {};
  for (const key of keys) {
    const a = acked?.[key];
    const l = local?.[key];
    const r = remote?.[key];
    const inA = a !== undefined;
    const inL = l !== undefined;
    const inR = r !== undefined;

    if (inL && !inA && !inR) {
      out[key] = l;
      continue;
    }
    if (inL && !inA && inR) {
      // Concurrent add same key \u2014 newer wins
      const lt = entryUpdatedAt(l);
      const rt = entryUpdatedAt(r);
      out[key] = rt > lt ? r : l;
      continue;
    }
    if (!inL && inA && inR) {
      // Local deleted \u2014 only honor delete if remote still matches acked
      if (sameEntry(a, r) || entryUpdatedAt(r) <= entryUpdatedAt(a)) {
        continue; // delete
      }
      out[key] = r; // remote edited after our base \u2014 keep remote
      continue;
    }
    if (!inL && inA && !inR) {
      // Already gone remotely
      continue;
    }
    if (!inL && !inA && inR) {
      out[key] = r;
      continue;
    }
    if (inL && inA && !inR) {
      // Remote deleted \u2014 if local still matches acked, honor remote delete;
      // if local changed, keep local edit.
      if (sameEntry(a, l)) continue;
      out[key] = l;
      continue;
    }
    // inL && inA && inR (or inL && inR with inA)
    if (inL && inR) {
      if (sameEntry(l, r)) {
        out[key] = l;
        continue;
      }
      const lt = entryUpdatedAt(l);
      const rt = entryUpdatedAt(r);
      if (rt > lt) out[key] = r;
      else if (lt > rt) out[key] = l;
      else {
        // Same timestamp or both empty \u2014 prefer local if changed vs acked, else remote
        if (inA && sameEntry(a, l) && !sameEntry(a, r)) out[key] = r;
        else out[key] = l;
      }
      continue;
    }
    if (inL) out[key] = l;
    else if (inR) out[key] = r;
  }
  return out;
}

/**
 * Merge off-plan expense arrays by id using the same 3-way rules.
 */
export function mergeOffPlanExpenses(acked = [], local = [], remote = []) {
  const toMap = (arr) => {
    const m = {};
    for (const e of arr || []) {
      if (e?.id) m[e.id] = e;
    }
    return m;
  };
  const merged = mergeMap3Way(toMap(acked), toMap(local), toMap(remote));
  return Object.values(merged);
}

function scalarNewer(ackedVal, localVal, remoteVal, preferLocalOnTie = true) {
  // Scalars don't have per-field timestamps; if local !== acked, local wins over remote
  // unless remote also differs from acked (conflict → prefer local for UX of current editor).
  if (localVal === remoteVal) return localVal;
  if (localVal !== ackedVal && remoteVal === ackedVal) return localVal;
  if (remoteVal !== ackedVal && localVal === ackedVal) return remoteVal;
  return preferLocalOnTie ? localVal : remoteVal;
}

/**
 * Merge three overlay snapshots into one document-ready overlay.
 * @param {object|null} acked - last server-confirmed overlay this client based edits on
 * @param {object} local - overlay extracted from this client's week
 * @param {object} remote - current Firestore overlay
 */
export function mergeOverlays(acked, local, remote) {
  const base = emptyOverlay(
    local?.weekStart || remote?.weekStart || acked?.weekStart || null,
    local?.weekEnd || remote?.weekEnd || acked?.weekEnd || null
  );
  const a = acked && typeof acked === 'object' ? acked : emptyOverlay();
  const l = local && typeof local === 'object' ? local : emptyOverlay();
  const r = remote && typeof remote === 'object' ? remote : emptyOverlay();

  return {
    ...base,
    weekStart: l.weekStart || r.weekStart || a.weekStart || null,
    weekEnd: l.weekEnd || r.weekEnd || a.weekEnd || null,
    weekStatus: scalarNewer(a.weekStatus, l.weekStatus, r.weekStatus),
    released: scalarNewer(Number(a.released) || 0, Number(l.released) || 0, Number(r.released) || 0),
    spent: scalarNewer(Number(a.spent) || 0, Number(l.spent) || 0, Number(r.spent) || 0),
    returned: scalarNewer(Number(a.returned) || 0, Number(l.returned) || 0, Number(r.returned) || 0),
    settledAt: scalarNewer(a.settledAt, l.settledAt, r.settledAt),
    lines: mergeMap3Way(a.lines || {}, l.lines || {}, r.lines || {}),
    manualLines: mergeMap3Way(a.manualLines || {}, l.manualLines || {}, r.manualLines || {}),
    branchForecast: mergeMap3Way(
      a.branchForecast || {},
      l.branchForecast || {},
      r.branchForecast || {}
    ),
    locationMeta: mergeMap3Way(
      a.locationMeta || {},
      l.locationMeta || {},
      r.locationMeta || {}
    ),
    offPlanExpenses: mergeOffPlanExpenses(
      a.offPlanExpenses || [],
      l.offPlanExpenses || [],
      r.offPlanExpenses || []
    ),
  };
}

/**
 * Stamp updatedAt (+ optional updatedBy) on every line/manualLine/offPlan entry
 * that is new or changed vs acked. Call before writing so concurrent merges can compare.
 * @param {object} local
 * @param {object} acked
 * @param {string} [now]
 * @param {{ uid?: string|null, name?: string }|null} [actor]
 */
export function stampOverlayEdits(
  local,
  acked,
  now = new Date().toISOString(),
  actor = null
) {
  const a = acked && typeof acked === 'object' ? acked : emptyOverlay();
  const l = local && typeof local === 'object' ? { ...local } : emptyOverlay();
  const stampChanged = (entry) => {
    const next = { ...entry, updatedAt: now };
    if (actor) next.updatedBy = actor;
    return next;
  };
  const stampMap = (localMap, ackedMap) => {
    const out = {};
    for (const [key, entry] of Object.entries(localMap || {})) {
      const prev = ackedMap?.[key];
      if (!prev || !sameEntry(prev, entry)) {
        out[key] = stampChanged(entry);
      } else {
        out[key] = entry.updatedAt
          ? entry
          : { ...entry, updatedAt: prev.updatedAt || now };
      }
    }
    return out;
  };
  l.lines = stampMap(l.lines, a.lines);
  l.manualLines = stampMap(l.manualLines, a.manualLines);
  l.branchForecast = stampMap(l.branchForecast, a.branchForecast);
  l.locationMeta = stampMap(l.locationMeta, a.locationMeta);
  l.offPlanExpenses = (l.offPlanExpenses || []).map((e) => {
    const prev = (a.offPlanExpenses || []).find((x) => x.id === e.id);
    if (!prev || !sameEntry(prev, e)) return stampChanged(e);
    return e.updatedAt ? e : { ...e, updatedAt: prev.updatedAt || now };
  });
  if (actor) l.updatedBy = actor;
  return l;
}
