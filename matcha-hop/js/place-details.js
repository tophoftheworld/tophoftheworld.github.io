/**
 * Fetch place details (photo, rating, review count, opening status) by place ID.
 * Uses Places API (New) Place.fetchFields; falls back to legacy getDetails if needed.
 * Cache-first: reads from Firestore; on API fetch, downloads photo and stores in Firebase Storage, then writes to Firestore.
 */

import { getPlacesService } from './map.js';
import { incrementApiCall } from './debug-api.js';
import { getCachedPlaceDetails, setCachedPlaceDetails, uploadPlacePhoto } from './place-details-cache.js';

const DETAIL_FIELDS = ['photos', 'rating', 'userRatingCount', 'regularOpeningHours', 'currentOpeningHours', 'types'];
const memoryDetailsCache = new Map();
const inflightDetailsRequests = new Map();

async function getPlaceLibrary() {
  if (typeof google === 'undefined' || !google.maps?.importLibrary) return null;
  return google.maps.importLibrary('places');
}

/** Google photo URLs never allow cross-origin fetch from the browser, so we always use a CORS proxy when in a browser. */
const CORS_PROXY_BASE = 'https://corsproxy.io/?';

function getPhotoFetchUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (typeof window !== 'undefined') {
    try {
      const host = new URL(url).host.toLowerCase();
      if (host.includes('google') || host.includes('googleapis')) {
        return CORS_PROXY_BASE + encodeURIComponent(url);
      }
    } catch (_) {}
  }
  return url;
}

/**
 * Copy the place photo into our own storage (never persist Google's URL).
 * Downloads the image from Google's temporary URL (via CORS proxy in the browser), uploads to Firebase Storage at placePhotos/{placeId}.jpg,
 * then saves details to Firestore with photoUrl = our Storage URL.
 */
async function persistPlaceDetails(placeId, details) {
  if (!placeId || !details) return details;
  let photoUrl = details.photoUrl ?? null;
  if (photoUrl && typeof photoUrl === 'string') {
    try {
      const fetchUrl = getPhotoFetchUrl(photoUrl);
      const res = await fetch(fetchUrl);
      if (!res.ok) {
        photoUrl = null;
      } else {
        const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
        if (contentType.startsWith('image/')) {
          const blob = await res.blob();
          const storageUrl = await uploadPlacePhoto(placeId, blob);
          photoUrl = storageUrl; // store our Storage URL only; Google URL is discarded
        } else {
          photoUrl = null;
        }
      }
    } catch (_) {
      photoUrl = null;
    }
  }
  const toCache = {
    photoUrl,
    rating: details.rating ?? null,
    userRatingCount: details.userRatingCount ?? null,
    openStatus: details.openStatus ?? null,
    weekdayText: Array.isArray(details.weekdayText) ? details.weekdayText : null,
    placeTypes: Array.isArray(details.placeTypes) ? details.placeTypes : null,
  };
  await setCachedPlaceDetails(placeId, toCache);
  return { ...details, photoUrl };
}

/**
 * Derive open status string from Place opening hours (e.g. "Open · Closes 12:00 AM").
 */
function formatOpenStatus(place) {
  const hours = place.currentOpeningHours || place.regularOpeningHours;
  if (!hours) return null;
  const openNow = typeof hours.openNow === 'boolean' ? hours.openNow : null;
  let status = openNow === true ? 'Open' : openNow === false ? 'Closed' : null;
  const desc = hours.weekdayDescriptions || hours.weekdayText;
  const today = new Date().getDay();
  const todayDesc = Array.isArray(desc) ? desc[today] : null;
  if (todayDesc && typeof todayDesc === 'string') {
    const match = todayDesc.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[–-]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i) || todayDesc.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)/g);
    const closes = match && (match[2] || (match.length > 1 ? match[match.length - 1] : null));
    if (status && closes) status += ' · Closes ' + closes.trim();
    else if (!status && todayDesc) status = todayDesc;
  }
  return status || null;
}

/**
 * Fetch details for a place by ID. Returns { photoUrl, rating, userRatingCount, openStatus } or null on failure.
 * Cache-first unless forceRefresh: returns Firestore cache if present; otherwise fetches from API.
 * When persist is true, stores photo in Storage and details in Firestore; when false, returns API details only (for search-only places).
 * @param {string} placeId - Google Place ID
 * @param {boolean} [forceRefresh=false] - if true, skip cache and re-fetch from API (e.g. for admin "Update place data")
 * @param {boolean} [persist=true] - if false, do not write to Firebase (use for search-only places); if true, cache to Storage + Firestore
 */
export async function fetchPlaceDetails(placeId, forceRefresh = false, persist = true) {
  if (!placeId || typeof google === 'undefined') return null;
  const cacheKey = String(placeId);

  if (!forceRefresh) {
    const memoryCached = memoryDetailsCache.get(cacheKey);
    if (memoryCached) return memoryCached;
    const cached = await getCachedPlaceDetails(placeId);
    if (cached && (cached.photoUrl != null || cached.rating != null || cached.openStatus != null)) {
      memoryDetailsCache.set(cacheKey, cached);
      return cached;
    }
  }

  if (!forceRefresh && inflightDetailsRequests.has(cacheKey)) {
    return inflightDetailsRequests.get(cacheKey);
  }

  const requestPromise = (async () => {
    try {
      const lib = await getPlaceLibrary();
      const Place = lib?.Place;
      if (Place) {
        const place = new Place({ id: placeId });
        await place.fetchFields({ fields: DETAIL_FIELDS });
        incrementApiCall('placeDetails');
        const photo = place.photos?.[0];
        const getUri = photo?.getUri || photo?.getURI;
        let photoUrl = null;
        if (typeof getUri === 'function') {
          const uri = getUri.call(photo, { maxWidth: 400 });
          photoUrl = (uri && typeof uri.then === 'function') ? await uri : uri;
        }
        const details = {
          photoUrl: photoUrl || null,
          rating: place.rating ?? null,
          userRatingCount: place.userRatingCount ?? null,
          openStatus: formatOpenStatus(place),
          weekdayText: Array.isArray(place.regularOpeningHours?.weekdayDescriptions)
            ? place.regularOpeningHours.weekdayDescriptions
            : (Array.isArray(place.currentOpeningHours?.weekdayDescriptions)
              ? place.currentOpeningHours.weekdayDescriptions
              : null),
          placeTypes: Array.isArray(place.types) ? place.types : null,
        };
        const resolved = persist ? await persistPlaceDetails(placeId, details) : details;
        if (resolved) memoryDetailsCache.set(cacheKey, resolved);
        return resolved;
      }
    } catch (_) {}
    try {
      const service = getPlacesService();
      if (!service) return null;
      const details = await new Promise((resolve) => {
        incrementApiCall('placeDetails');
        service.getDetails({ placeId }, (place, status) => {
          if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
            resolve(null);
            return;
          }
          const photo = place.photos?.[0];
          const photoUrl = photo?.getUrl?.({ maxWidth: 400 }) ?? null;
          const hours = place.opening_hours;
          let openStatus = null;
          if (hours) {
            if (typeof hours.isOpen === 'function') {
              const openNow = hours.isOpen(new Date());
              openStatus = openNow ? 'Open' : 'Closed';
            }
            if (hours.weekday_text && hours.weekday_text.length) {
              const day = new Date().getDay();
              const todayText = hours.weekday_text[day];
              if (todayText) {
                const closesMatch = todayText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[–-]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
                const closes = closesMatch ? closesMatch[2] : null;
                if (openStatus && closes) openStatus += ' · Closes ' + closes.trim();
                else if (!openStatus) openStatus = todayText;
              }
            }
          }
          resolve({
            photoUrl,
            rating: place.rating ?? null,
            userRatingCount: place.user_ratings_total ?? null,
            openStatus,
            weekdayText: Array.isArray(hours?.weekday_text) ? hours.weekday_text : null,
            placeTypes: Array.isArray(place.types) ? place.types : null,
          });
        });
      });
      if (!details) return null;
      const resolved = persist ? await persistPlaceDetails(placeId, details) : details;
      if (resolved) memoryDetailsCache.set(cacheKey, resolved);
      return resolved;
    } catch (e) {
      return null;
    }
  })();

  inflightDetailsRequests.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inflightDetailsRequests.delete(cacheKey);
  }
}
