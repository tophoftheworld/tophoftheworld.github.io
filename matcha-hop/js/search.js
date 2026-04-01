/**
 * Search: Places API (New) – Place.searchByText, with legacy PlacesService fallback on 403.
 * Returns places as { id, name, address, lat, lng, placeId } for pins.
 */

import { getMap, getPlacesService } from './map.js';
import { incrementApiCall } from './debug-api.js';

const PLACE_FIELDS = ['id', 'displayName', 'formattedAddress', 'location'];

/** Blocklist: exclude places whose name/address contain these (case-insensitive). */
const NON_MATCHA_BLOCKLIST = [
  'starbucks',
  'milk tea',
  'bubble tea',
  'boba',
  'pearl tea',
  'tiger sugar',
  'gong cha',
  'chatime',
  'kung fu tea',
  'ding tea',
  'coco',
  'sharetea',
  'yifang',
  'happy lemon',
  'koi',
  'cha for tea',
];

async function getPlaceLibrary() {
  if (typeof google === 'undefined' || !google.maps?.importLibrary) return null;
  return google.maps.importLibrary('places');
}

function placeResultFromPlace(place, i) {
  const loc = place.location;
  const lat = loc ? (typeof loc.lat === 'function' ? loc.lat() : loc.lat) : null;
  const lng = loc ? (typeof loc.lng === 'function' ? loc.lng() : loc.lng) : null;
  if (lat == null || lng == null) return null;
  const name = place.displayName ?? 'Unnamed';
  return {
    id: place.id || `place-${i}-${Date.now()}`,
    name: typeof name === 'string' ? name : (name?.text ?? 'Unnamed'),
    address: place.formattedAddress ?? '',
    lat,
    lng,
    placeId: place.id || null,
  };
}

/** Legacy PlacesService result → same shape as placeResultFromPlace. */
function placeResultFromLegacy(place, i) {
  const loc = place.geometry && place.geometry.location;
  const lat = loc ? (typeof loc.lat === 'function' ? loc.lat() : loc.lat) : null;
  const lng = loc ? (typeof loc.lng === 'function' ? loc.lng() : loc.lng) : null;
  if (lat == null || lng == null) return null;
  return {
    id: place.place_id || `place-${i}-${Date.now()}`,
    name: place.name || 'Unnamed',
    address: place.formatted_address || '',
    lat,
    lng,
    placeId: place.place_id || null,
  };
}

/** Exclude Starbucks, milk tea, bubble tea, etc. */
export function filterMatchaOnly(places) {
  if (!Array.isArray(places)) return [];
  return places.filter((p) => {
    const text = `${p.name || ''} ${p.address || ''}`.toLowerCase();
    const isBlocked = NON_MATCHA_BLOCKLIST.some((term) => text.includes(term));
    return !isBlocked;
  });
}

/** Legacy PlacesService.textSearch (used when new API returns 403). */
function searchByTextLegacy(query, bounds, filterMatcha = true) {
  const service = getPlacesService();
  if (!service) return Promise.resolve([]);
  return new Promise((resolve) => {
    const req = { query: query || 'matcha cafe' };
    if (bounds) req.bounds = bounds;
    incrementApiCall('placesTextSearch');
    service.textSearch(req, (results, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !results) {
        resolve([]);
        return;
      }
      const places = results.map((place, i) => placeResultFromLegacy(place, i)).filter(Boolean);
      resolve(filterMatcha ? filterMatchaOnly(places) : places);
    });
  });
}

const MAX_PAGE_RESULTS = 100;

async function searchByTextNew(request, options = {}) {
  const filterMatcha = options.filterMatcha !== false;
  try {
    const placesLib = await getPlaceLibrary();
    const Place = placesLib?.Place;
    if (!Place?.searchByText) return searchByTextLegacy(request.textQuery, request.locationRestriction || null, filterMatcha);
    const maxTotal = request.maxTotalResults ?? 20;
    const { maxTotalResults: _drop, ...apiRequest } = request;
    const allPlaces = [];
    let pageToken = undefined;
    do {
      const req = { ...apiRequest, fields: PLACE_FIELDS, maxResultCount: 20 };
      if (pageToken) req.pageToken = pageToken;
      const response = await Place.searchByText(req);
      incrementApiCall('placesTextSearch');
      const places = response.places ?? [];
      allPlaces.push(...places);
      pageToken = response.nextPageToken ?? null;
    } while (pageToken && allPlaces.length < maxTotal);
    const results = allPlaces
      .slice(0, maxTotal)
      .map((place, i) => placeResultFromPlace(place, i))
      .filter(Boolean);
    return filterMatcha ? filterMatchaOnly(results) : results;
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[Matcha Hop] Place search failed (using legacy fallback):', e.message || e);
    return searchByTextLegacy(request.textQuery, request.locationRestriction || null, filterMatcha);
  }
}

/** Text search (search bar): "matcha cafe" + user input. */
export async function searchQuery(userInput) {
  const q = `matcha cafe ${(userInput || '').trim()}`.trim();
  if (!q) return [];
  return searchByTextNew({ textQuery: q, maxResultCount: 20 });
}

/** Place search by text only (no matcha prefix/filter). Use for pop-up location picker so any place can be selected. */
export async function searchPlaceByText(text) {
  const q = (text || '').trim();
  if (!q) return [];
  return searchByTextNew({ textQuery: q, maxResultCount: 20 }, { filterMatcha: false });
}

/** Search within map bounds (viewport). Pins update as map moves. Fetches up to MAX_PAGE_RESULTS via pagination. */
export async function searchByBounds(bounds, query = 'matcha cafe') {
  if (!bounds) return [];
  const request = {
    textQuery: query || 'matcha cafe',
    maxResultCount: 20,
    maxTotalResults: MAX_PAGE_RESULTS,
    locationRestriction: bounds,
  };
  return searchByTextNew(request);
}
