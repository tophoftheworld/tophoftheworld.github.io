const DRAFT_KEY = 'matcha-costing-v5-draft';
const UI_KEY = 'matcha-costing-v5-ui';
const LEGACY_DRAFT_KEYS = ['matcha-costing-v4-draft', 'matcha-costing-v3-draft', 'matcha-costing-v2-draft'];

/** @typedef {import('./model.js').Scenario} Scenario */

/** @param {Scenario} draft */
export function saveDraft(draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch { /* quota */ }
}

/** @returns {Scenario|null} */
export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw);
    for (const key of LEGACY_DRAFT_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) return JSON.parse(legacy);
    }
    return null;
  } catch {
    return null;
  }
}

/** @param {Record<string, unknown>} ui */
export function saveUiState(ui) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch { /* quota */ }
}

/** @returns {Record<string, unknown>} */
export function loadUiState() {
  try {
    const raw = localStorage.getItem(UI_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
