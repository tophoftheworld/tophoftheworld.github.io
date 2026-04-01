/**
 * Debug: cumulative API call counters in localStorage (for cost tracking).
 * Key: matchaHop_apiCalls = { placesTextSearch: N, mapLoad: N, ... }
 */

const DEBUG_API_KEY = 'matchaHop_apiCalls';

export function incrementApiCall(type) {
  try {
    const raw = localStorage.getItem(DEBUG_API_KEY);
    const counts = raw ? JSON.parse(raw) : {};
    counts[type] = (counts[type] || 0) + 1;
    localStorage.setItem(DEBUG_API_KEY, JSON.stringify(counts));
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[Matcha Hop] API calls (cumulative):', counts);
    }
  } catch (_) {}
}

export function getApiCallCounts() {
  try {
    const raw = localStorage.getItem(DEBUG_API_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}
