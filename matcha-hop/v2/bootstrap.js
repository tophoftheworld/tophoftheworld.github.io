import * as DataMod from '../js/data.js?v=20260614g';
import * as FirebaseMod from '../js/firebase.js?v=20260614g';

const getCurrentProfile = FirebaseMod.getCurrentProfile;
const getStorage = FirebaseMod.getStorage;
const initAuth = FirebaseMod.initAuth;
const getDb = FirebaseMod.getDb;
const getCurrentUserId = FirebaseMod.getCurrentUserId;
const USER_PROFILES_COLLECTION = FirebaseMod.USER_PROFILES_COLLECTION || 'userProfiles';
/** Bind data.js exports without static named imports (stale CDN cache must not brick boot). */
function bindDataExport(name, { sync = false, empty = false, noop = false, fallback } = {}) {
  const exp = DataMod[name];
  if (typeof exp === 'function') return exp;
  if (typeof fallback === 'function') return fallback;
  if (noop) return sync ? () => {} : async () => {};
  if (sync && empty) return () => [];
  if (!sync && empty) return async () => [];
  if (sync) {
    return () => {
      console.warn(`[v2] data.js missing export: ${name}`);
      throw new Error(`App data module out of date (${name}). Hard refresh or redeploy.`);
    };
  }
  return async () => {
    console.warn(`[v2] data.js missing export: ${name}`);
    throw new Error(`App data module out of date (${name}). Hard refresh or redeploy.`);
  };
}

const initData = bindDataExport('initData');
const getGalleryBrands = bindDataExport('getGalleryBrands', { empty: true });
const getLogs = bindDataExport('getLogs', { sync: true, empty: true });
const saveLog = bindDataExport('saveLog', { sync: true });
const deleteLog = bindDataExport('deleteLog');
const getCafeById = bindDataExport('getCafeById', { sync: true, fallback: () => null });
const getCafeByPlaceId = bindDataExport('getCafeByPlaceId', { sync: true, fallback: () => null });
const saveCafe = bindDataExport('saveCafe', { sync: true });
const getCafes = bindDataExport('getCafes', { sync: true, empty: true });
const getCafesInBounds = bindDataExport('getCafesInBounds', { sync: true, empty: true });
const getMyCafes = bindDataExport('getMyCafes', { sync: true, empty: true });
const hasUserLikedLocation = bindDataExport('hasUserLikedLocation', { sync: true, fallback: () => false });
const hasUserLikedBrand = bindDataExport('hasUserLikedBrand', { sync: true, fallback: () => false });
const setLocationLike = bindDataExport('setLocationLike', { sync: true, noop: true });
const persistBrandLike = bindDataExport('setBrandLike', { sync: true, noop: true });
const METRO_MANILA_SW = DataMod.METRO_MANILA_SW || { lat: 14.35, lng: 120.95 };
const METRO_MANILA_NE = DataMod.METRO_MANILA_NE || { lat: 14.85, lng: 121.25 };
const getLogComments = bindDataExport('getLogComments', { empty: true });
const addLogComment = bindDataExport('addLogComment');
const getPostLikeDoc = bindDataExport('getPostLikeDoc', { empty: true });
const getLogCommentCount = bindDataExport('getLogCommentCount', { fallback: async () => 0 });
const mergePostLikeFromRemote = bindDataExport('mergePostLikeFromRemote', { sync: true, noop: true });
const hasUserLikedPost = bindDataExport('hasUserLikedPost', { sync: true, fallback: () => false });
const setPostLikeSynced = bindDataExport('setPostLikeSynced');
const getBrandsConfig = bindDataExport('getBrandsConfig', { empty: true });
const setBrandsConfig = bindDataExport('setBrandsConfig');
const normalizeBrandSocialLinks = DataMod.normalizeBrandSocialLinks
  || ((input) => (Array.isArray(input) ? input : []));
const findBrandOwningCafe = bindDataExport('findBrandOwningCafe', { sync: true, fallback: () => null });
const getEvents = bindDataExport('getEvents', { empty: true });
const getAllLists = bindDataExport('getAllLists', { empty: true });
const createEvent = bindDataExport('createEvent');
const persistUpdateEvent = bindDataExport('updateEvent');
const persistDeleteEvent = bindDataExport('deleteEvent');
const persistUpdateEventMerchants = bindDataExport('updateEventMerchants');
const persistCreateList = bindDataExport('createList');
const persistUpdateList = bindDataExport('updateList');
const persistDeleteList = bindDataExport('deleteList');

function parseYmdToLocalDate(s) {
  if (!s) return new Date();
  const part = String(s).slice(0, 10);
  const [y, m, d] = part.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date();
  return new Date(y, m - 1, d);
}

function toV2UiEvent(e) {
  if (!e?.id) return null;
  const date = parseYmdToLocalDate(e.startDate ?? e.date);
  const endRaw = e.endDate ?? e.startDate;
  const endDate = endRaw ? parseYmdToLocalDate(endRaw) : date;
  return {
    ...e,
    date,
    endDate,
    title: e.title || '',
    subtitle: e.subtitle || '',
    type: e.type || 'fest',
    timeLabel: e.timeLabel || '',
    location: e.location || '',
    address: e.address || '',
    organizer: e.organizer || '',
    description: e.description || '',
    merchantIds: Array.isArray(e.merchantIds) ? e.merchantIds : [],
    eventDates: Array.isArray(e.eventDates) ? e.eventDates : [],
    placeId: e.placeId || null,
    lat: typeof e.lat === 'number' ? e.lat : (e.lat != null ? Number(e.lat) : null),
    lng: typeof e.lng === 'number' ? e.lng : (e.lng != null ? Number(e.lng) : null),
    coverPhoto: e.coverPhoto || null,
    coverHue: Number(e.coverHue) || 120,
    status: e.status || 'upcoming',
    submittedBy: e.submittedBy || '',
  };
}

function enrichListForUi(list) {
  const me = String(getCurrentUserId() || '');
  const oid = String(list?.ownerId || '');
  return {
    ...list,
    isOwn: Boolean(me && oid === me),
  };
}

const setCafeLocationMeta = DataMod.setCafeLocationMeta
  || DataMod.setCafeLocatigonmeta
  || (() => null);
const todayDateStr = DataMod.todayDateStr
  || (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
const ORTIGAS_CENTER = { lat: 14.5876, lng: 121.0609 };
const ORTIGAS_ZOOM = 15;
const USER_LOCATION_ZOOM = 16;
const V2_MAP_VIEWPORT_STORAGE_KEY = 'matcha_hop_v2_map_viewport';
const cafeBrandIndexByCafeId = new Map();
const cafeBrandIndexByPlaceId = new Map();
let cachedLiveBrands = [];
let cachedGalleryBrands = [];
/** Do not static-import map/search/place-details: map.js loads before `google` exists and can throw. */
let mapsApiCache = null;

function waitForGoogle(timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const ok = () => typeof window !== 'undefined'
      && typeof window.google !== 'undefined'
      && window.google
      && window.google.maps;
    if (ok()) {
      resolve();
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => {
      if (ok()) {
        clearInterval(id);
        resolve();
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(id);
        reject(new Error('Google Maps API did not load'));
      }
    }, 50);
  });
}

async function ensureMapsApi() {
  if (mapsApiCache) return mapsApiCache;
  await waitForGoogle(60000);
  const [mapMod, searchMod, placeMod] = await Promise.all([
    import('../js/map.js?v=20260613o'),
    import('../js/search.js'),
    import('../js/place-details.js'),
  ]);
  mapsApiCache = {
    ...mapMod,
    searchQuery: searchMod.searchQuery,
    searchPlaceByText: searchMod.searchPlaceByText,
    resolvePlaceLabel: searchMod.resolvePlaceLabel,
    resolvePlaceCoords: searchMod.resolvePlaceCoords,
    fetchPlaceDetails: placeMod.fetchPlaceDetails,
  };
  return mapsApiCache;
}

function fmtDate(ts) {
  const d = new Date(Number(ts) || Date.now());
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function inferKind(brand) {
  if ((brand.cafes || []).length > 0) return 'cafe';
  const name = String(brand.name || '').toLowerCase();
  if (name.includes('home') || name.includes('kamo') || name.includes('kokorobi')) return 'home';
  return 'popup';
}

function deriveNeighborhood(cafe) {
  const address = String(cafe?.address || '');
  if (!address) return '';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] || parts[0] || '';
}

function toV2Brands(brands) {
  return (brands || []).map((b, i) => ({
    id: b.id,
    name: b.name || 'Unnamed',
    logoUrl: b.logoUrl || null,
    socialLinks: normalizeBrandSocialLinks(b.socialLinks),
    kind: inferKind(b),
    hue: 70 + (i * 23) % 140,
    branches: (b.cafes || []).map((c) => ({
      id: c.id,
      name: c.name || c.address || 'Location',
      neighborhood: deriveNeighborhood(c),
      address: c.address || '',
      lat: c.lat,
      lng: c.lng,
      placeId: c.placeId || null,
      photoUrl: c.photoUrl || null,
      classification: c.classification || null,
      locationTags: Array.isArray(c.locationTags) ? c.locationTags : [],
      hoursOverride: c.hoursOverride || null,
    })),
    popUps: [],
  }));
}

function rebuildCafeBrandIndex(v2Brands) {
  cafeBrandIndexByCafeId.clear();
  cafeBrandIndexByPlaceId.clear();
  (v2Brands || []).forEach((brand) => {
    (brand.branches || []).forEach((branch) => {
      if (branch?.id) cafeBrandIndexByCafeId.set(String(branch.id), String(brand.id));
      if (branch?.placeId) cafeBrandIndexByPlaceId.set(String(branch.placeId), String(brand.id));
    });
  });
}

function toV2Posts(logs, v2Brands) {
  const me = getCurrentUserId();
  const brands = Array.isArray(v2Brands) ? v2Brands : [];
  return (logs || []).map((l) => {
    const drinks = Array.isArray(l.post?.drinks) ? l.post.drinks : [];
    const userId = String(l.userId || '');
    const isOwn = Boolean(me && userId && userId === String(me));
    const rawUser = String(l.userName || '').trim();
    const authorHandle = rawUser.replace(/^@/, '') || 'member';
    const rawDisp = String(l.userDisplayName || '').trim();
    const authorDisplayName = rawDisp || authorHandle;
    const avatarInitial = String(authorDisplayName[0] || authorHandle[0] || '?').toUpperCase();
    let branchName = String(l.visit?.location?.cafeName || '').trim();
    if (!branchName && l.visit?.location?.cafeId && brands.length > 0) {
      const bid = l.visit?.brandId;
      const cafeId = l.visit?.location?.cafeId;
      const brandObj = brands.find((b) => String(b?.id) === String(bid));
      const br = brandObj?.branches?.find((x) => String(x?.id) === String(cafeId));
      branchName = String(br?.name || '').trim();
    }
    const popupId = l.visit?.location?.popupId || null;
    const eventId = l.visit?.location?.eventId || null;
    const popupGeneric = Boolean(l.visit?.location?.popupGeneric);
    if (!branchName && eventId) {
      const ev = (Array.isArray(window.EVENTS) ? window.EVENTS : []).find((x) => String(x.id) === String(eventId));
      branchName = String(ev?.title || ev?.location || '').trim() || 'Event';
    } else if (!branchName && popupGeneric) {
      branchName = 'Event';
    }
    return {
      id: l.id,
      userId,
      isOwn,
      authorDisplayName,
      authorHandle,
      avatarInitial,
      brandId: l.visit?.brandId || null,
      branchId: l.visit?.location?.cafeId || null,
      popupId,
      eventId,
      popupGeneric,
      branchName,
      brand: l.visit?.brandName || 'Unknown',
      address: l.visit?.location?.address || '',
      location: l.visit?.location?.cafeName || l.visit?.location?.address || 'Unknown',
      createdAt: Number(l.createdAt) || Date.now(),
      orderedAt: l.visit?.orderedAt || null,
      date: fmtDate(l.createdAt),
      rating: Number(l.post?.rating) || 0,
      liked: hasUserLikedPost(l.id),
      likeCount: 0,
      commentCount: 0,
      photoCount: Math.max(1, (l.post?.photos || []).length || 1),
      photos: Array.isArray(l.post?.photos) ? l.post.photos.filter(Boolean) : [],
      caption: l.post?.caption || '',
      drinks: drinks.map((d, idx) => ({
        id: `${l.id}-d${idx + 1}`,
        name: d.name,
        notes: d.notes || '',
        rating: Number(d.rating) || 0,
        price: d.price || '',
        profile: {
          sweet: Number(d.profile?.sweet) || 0,
          matcha: Number(d.profile?.matcha ?? d.profile?.matchaPresence) || 0,
          balance: Number(d.profile?.balance) || 0,
          umami: Number(d.profile?.umami) || 0,
          bitterness: Number(d.profile?.bitterness ?? d.profile?.bitter) || 0,
          astringency: Number(d.profile?.astringency) || 0,
          body: Number(d.profile?.body) || 0,
          texture: Number(d.profile?.texture) || 0,
          finish: Number(d.profile?.finish) || 0,
        },
        flavorNotes: Array.isArray(d.flavorNotes) ? d.flavorNotes : [],
        recommended: Boolean(d.recommended),
      })),
    };
  });
}

const HYDRATE_ENGAGEMENT_CHUNK = 15;

async function hydratePostsEngagement(posts) {
  const out = [];
  const arr = posts || [];
  for (let i = 0; i < arr.length; i += HYDRATE_ENGAGEMENT_CHUNK) {
    const chunk = arr.slice(i, i + HYDRATE_ENGAGEMENT_CHUNK);
    const hydrated = await Promise.all(
      chunk.map(async (p) => {
        const [likeDoc, commentCount] = await Promise.all([
          getPostLikeDoc(p.id),
          getLogCommentCount(p.id),
        ]);
        mergePostLikeFromRemote(p.id, likeDoc.userIds);
        return {
          ...p,
          likeCount: likeDoc.count,
          commentCount,
          liked: hasUserLikedPost(p.id),
        };
      }),
    );
    out.push(...hydrated);
  }
  return out;
}

function signalBootstrapOkOnce() {
  if (typeof window === 'undefined' || window.__V2_BOOTSTRAP_OK__) return;
  window.__V2_BOOTSTRAP_OK__ = true;
  window.dispatchEvent(new CustomEvent('v2:bootstrap-ok'));
}

function withTimeout(promise, timeoutMs, label) {
  const ms = Number(timeoutMs) || 0;
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label || 'Operation'} timed out after ${ms}ms`));
    }, ms);
    Promise.resolve(promise)
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        window.clearTimeout(timer);
        reject(err);
      });
  });
}

function patchPostEngagementInPlace(logId, partial) {
  const posts = typeof window !== 'undefined' ? window.POSTS : null;
  if (!posts || !Array.isArray(posts)) return;
  const p = posts.find((x) => x.id === logId);
  if (p && partial && typeof partial === 'object') {
    Object.assign(p, partial);
    window.dispatchEvent(new Event('v2:data-updated'));
  }
}

function toMapCafeStats() {
  const logs = getLogs();
  const statsByCafeId = new Map();
  logs.forEach((log) => {
    const cafeId = log.visit?.location?.cafeId;
    if (!cafeId) return;
    const curr = statsByCafeId.get(cafeId) || { visits: 0, ratingSum: 0, ratingCount: 0, photo: null };
    curr.visits += 1;
    const rating = Number(log.post?.rating) || 0;
    if (rating > 0) {
      curr.ratingSum += rating;
      curr.ratingCount += 1;
    }
    if (!curr.photo && Array.isArray(log.post?.photos) && log.post.photos[0]) {
      curr.photo = log.post.photos[0];
    }
    statsByCafeId.set(cafeId, curr);
  });
  return statsByCafeId;
}

function resolveBrandIdForCafe(cafeId) {
  const key = cafeId ? String(cafeId) : '';
  if (key && cafeBrandIndexByCafeId.has(key)) return cafeBrandIndexByCafeId.get(key);
  if (key) {
    const owned = findBrandOwningCafe(key, cachedGalleryBrands);
    if (owned?.id) return String(owned.id);
  }
  if (!key) return null;
  const logMatch = getLogs().find((log) => String(log.visit?.location?.cafeId || '') === key && log.visit?.brandId);
  return logMatch?.visit?.brandId || null;
}

function resolveMapPinLogo(cafe, brandId) {
  const bid = brandId
    || (cafe?.id ? resolveBrandIdForCafe(cafe.id) : null)
    || (cafe?.placeId ? (cafeBrandIndexByPlaceId.get(String(cafe.placeId)) || null) : null);
  if (!bid) return null;
  const brand = cachedLiveBrands.find((b) => String(b.id) === String(bid));
  if (brand?.logoUrl) return brand.logoUrl;
  const galleryBrand = cachedGalleryBrands.find((b) => String(b.id) === String(bid));
  if (galleryBrand?.logoUrl) return galleryBrand.logoUrl;
  return null;
}

function enrichCafeForMap(cafe, options = {}) {
  const myCafeIds = options.myCafeIds || new Set(getMyCafes().map((c) => c.id));
  const statsByCafeId = options.statsByCafeId || toMapCafeStats();
  const stats = statsByCafeId.get(cafe.id) || { visits: 0, ratingSum: 0, ratingCount: 0, photo: null };
  const tried = myCafeIds.has(cafe.id);
  const branchId = cafe.id || null;
  const brandId = cafe.brandId
    || resolveBrandIdForCafe(cafe.id)
    || (cafe.placeId ? (cafeBrandIndexByPlaceId.get(String(cafe.placeId)) || null) : null);
  const liked = brandId ? hasUserLikedBrand(brandId) : hasUserLikedLocation(cafe.id);
  const logoUrl = resolveMapPinLogo(cafe, brandId);
  return {
    ...cafe,
    starred: true,
    tried,
    liked,
    logged: tried,
    branchId,
    brandId,
    placeId: cafe.placeId || null,
    logoUrl,
    visits: stats.visits || 0,
    avgRating: stats.ratingCount > 0 ? Math.round((stats.ratingSum / stats.ratingCount) * 10) / 10 : 0,
    photo: stats.photo || cafe.photoUrl || null,
    googleRating: Number(cafe.rating) || 0,
    googleReviewCount: Number(cafe.userRatingCount) || 0,
    sub: cafe.address || '',
  };
}

function mergeSearchResultsWithSaved(results) {
  const myCafeIds = new Set(getMyCafes().map((c) => c.id));
  const statsByCafeId = toMapCafeStats();
  const merged = [];
  const seen = new Set();
  for (const result of results || []) {
    const key = result.placeId || result.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const existing = getCafeByPlaceId(result.placeId);
    if (existing) {
      merged.push(enrichCafeForMap({
        ...existing,
        brandId: existing.brandId || resolveBrandIdForCafe(existing.id) || (existing.placeId ? (cafeBrandIndexByPlaceId.get(String(existing.placeId)) || null) : null),
      }, { myCafeIds, statsByCafeId }));
    } else {
      const bid = result.brandId || (result.placeId ? (cafeBrandIndexByPlaceId.get(String(result.placeId)) || null) : null);
      const rid = result.id || result.placeId;
      const searchCafe = {
        ...result,
        id: rid,
        photoUrl: result.photoUrl || null,
      };
      merged.push({
        ...searchCafe,
        starred: true,
        branchId: rid || null,
        brandId: bid,
        placeId: result.placeId || null,
        logoUrl: resolveMapPinLogo(searchCafe, bid),
        sub: result.address || '',
        tried: false,
        liked: bid ? hasUserLikedBrand(bid) : hasUserLikedLocation(rid),
        logged: false,
        visits: 0,
        avgRating: 0,
        photo: result.photoUrl || null,
        googleRating: Number(result.rating) || 0,
        googleReviewCount: Number(result.userRatingCount) || 0,
      });
    }
  }
  return merged;
}

function getMetroManilaBounds() {
  if (typeof google === 'undefined' || !google.maps) return null;
  return new google.maps.LatLngBounds(METRO_MANILA_SW, METRO_MANILA_NE);
}

/** Upcoming/ongoing events use metro-wide bounds so pins aren't clipped to the current zoom window. */
function getEventPinBounds(viewportBounds) {
  const metro = getMetroManilaBounds();
  if (!metro) return viewportBounds || null;
  if (!viewportBounds || typeof viewportBounds.union !== 'function') return metro;
  const merged = new google.maps.LatLngBounds(metro.getSouthWest(), metro.getNorthEast());
  merged.union(viewportBounds);
  return merged;
}

function eventStatusForMap(ev) {
  if (typeof window.effectiveEventStatus === 'function') {
    return window.effectiveEventStatus(ev);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  if (Array.isArray(ev?.eventDates) && ev.eventDates.length) {
    const stamps = ev.eventDates.map((d) => {
      const part = String(d).slice(0, 10);
      const [y, m, day] = part.split('-').map((x) => parseInt(x, 10));
      return new Date(y, m - 1, day).getTime();
    }).filter(Number.isFinite);
    if (stamps.includes(todayMs)) return 'ongoing';
    if (stamps.every((t) => t > todayMs)) return 'upcoming';
    if (stamps.every((t) => t < todayMs)) return 'past';
    return stamps.some((t) => t >= todayMs) ? 'upcoming' : 'past';
  }
  const ymdMs = (value) => {
    const part = String(value || '').slice(0, 10);
    const [y, m, day] = part.split('-').map((x) => parseInt(x, 10));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) return NaN;
    return new Date(y, m - 1, day).getTime();
  };
  const startMs = ymdMs(ev?.startDate ?? ev?.date);
  const endMs = ymdMs(ev?.endDate ?? ev?.startDate ?? ev?.date);
  if (!Number.isFinite(startMs)) return 'past';
  if (todayMs < startMs) return 'upcoming';
  if (Number.isFinite(endMs) && todayMs > endMs) return 'past';
  return 'ongoing';
}

function resolveEventMapCoordsSync(ev) {
  const lat = Number(ev?.lat);
  const lng = Number(ev?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  const pid = ev?.placeId ? String(ev.placeId) : '';
  if (!pid) return null;
  const cafe = getCafeByPlaceId(pid);
  if (Number.isFinite(Number(cafe?.lat)) && Number.isFinite(Number(cafe?.lng))) {
    return { lat: Number(cafe.lat), lng: Number(cafe.lng) };
  }
  const brands = Array.isArray(window.BRANDS) ? window.BRANDS : [];
  for (const brand of brands) {
    for (const branch of (brand.branches || [])) {
      if (branch?.placeId && String(branch.placeId) === pid
        && Number.isFinite(Number(branch.lat)) && Number.isFinite(Number(branch.lng))) {
        return { lat: Number(branch.lat), lng: Number(branch.lng) };
      }
    }
  }
  return null;
}

async function resolveEventMapCoords(ev) {
  const direct = resolveEventMapCoordsSync(ev);
  if (direct) return direct;
  const pid = ev?.placeId ? String(ev.placeId) : '';
  if (pid) {
    try {
      const { resolvePlaceCoords } = await ensureMapsApi();
      if (typeof resolvePlaceCoords === 'function') {
        const fromPlace = await resolvePlaceCoords(pid).catch(() => null);
        if (fromPlace) return fromPlace;
      }
    } catch { /* continue */ }
  }
  const query = [ev?.location, ev?.address].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
  if (query.length >= 3) {
    try {
      const { searchPlaceByText } = await ensureMapsApi();
      if (typeof searchPlaceByText === 'function') {
        const rows = await searchPlaceByText(query).catch(() => []);
        const hit = (rows || []).find((r) => Number.isFinite(Number(r?.lat)) && Number.isFinite(Number(r?.lng)));
        if (hit) return { lat: Number(hit.lat), lng: Number(hit.lng) };
      }
    } catch { /* continue */ }
  }
  return null;
}

async function collectActiveUpcomingEventsInBounds(bounds) {
  const eventBounds = getEventPinBounds(bounds);
  const formatDates = typeof window.formatEventDatesLabel === 'function' ? window.formatEventDatesLabel : () => '';
  const BRANDS = Array.isArray(window.BRANDS) ? window.BRANDS : [];
  const candidates = (Array.isArray(window.EVENTS) ? window.EVENTS : []).filter((ev) => {
    const status = eventStatusForMap(ev);
    return status === 'ongoing' || status === 'upcoming';
  });
  const enriched = await Promise.all(candidates.map(async (ev) => {
    const coords = await resolveEventMapCoords(ev);
    if (!coords) return null;
    const { lat, lng } = coords;
    if (eventBounds && typeof eventBounds.contains === 'function' && typeof google !== 'undefined' && google.maps) {
      const ll = new google.maps.LatLng(lat, lng);
      if (!eventBounds.contains(ll)) return null;
    }
    const brandId = (ev.merchantIds || [])[0] || null;
    const brand = brandId ? BRANDS.find((b) => String(b.id) === String(brandId)) : null;
    const status = eventStatusForMap(ev);
    return {
      ...ev,
      lat,
      lng,
      status,
      dateLabel: formatDates(ev),
      brandId: brandId ? String(brandId) : null,
      brandName: brand?.name || '',
      title: ev.title || ev.location || 'Event',
      name: ev.title || ev.location || 'Event',
      address: ev.location || ev.address || '',
    };
  }));
  return enriched.filter(Boolean);
}

function dedupeMapPlaces(places) {
  const seen = new Set();
  const deduped = [];
  (places || []).forEach((place) => {
    const key = [
      place.placeId || '',
      place.id || '',
      Number(place.lat || 0).toFixed(5),
      Number(place.lng || 0).toFixed(5),
      String(place.name || '').toLowerCase(),
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(place);
  });
  return deduped;
}

function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: options.timeout ?? 7000,
      maximumAge: options.maximumAge ?? 30000,
    });
  });
}

function readStoredMapViewport() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(V2_MAP_VIEWPORT_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const lat = Number(v.lat);
    const lng = Number(v.lng);
    const zoom = Number(v.zoom);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const z = Number.isFinite(zoom) ? Math.min(Math.max(zoom, 10), 18) : ORTIGAS_ZOOM;
    return { lat, lng, zoom: z };
  } catch {
    return null;
  }
}

function persistMapViewport(lat, lng, zoom) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const z = Number.isFinite(zoom) ? Math.min(Math.max(zoom, 10), 18) : ORTIGAS_ZOOM;
    localStorage.setItem(V2_MAP_VIEWPORT_STORAGE_KEY, JSON.stringify({ lat, lng, zoom: z }));
  } catch (_) {}
}

/** GPS → last viewed viewport → Ortigas. Used on map mount only. */
async function resolveInitialMapViewport() {
  try {
    const pos = await getCurrentPosition({ timeout: 8000, maximumAge: 120000 });
    const lat = Number(pos?.coords?.latitude);
    const lng = Number(pos?.coords?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng, zoom: USER_LOCATION_ZOOM };
    }
  } catch (_) {}
  const saved = readStoredMapViewport();
  if (saved) return saved;
  return { lat: ORTIGAS_CENTER.lat, lng: ORTIGAS_CENTER.lng, zoom: ORTIGAS_ZOOM };
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const [meta, b64] = dataUrl.split(',');
  if (!meta || !b64) return null;
  const mimeMatch = meta.match(/data:([^;]+);base64/i);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

async function decodeImageFromBlob(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const dataUrl = await blobToDataUrl(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = dataUrl;
  });
}

async function compressImageBlob(blob, options = {}) {
  const maxDimension = options.maxDimension ?? 1600;
  const quality = options.quality ?? 0.82;
  if (!blob) return null;
  let image;
  try {
    image = await decodeImageFromBlob(blob);
  } catch {
    return blob;
  }
  const srcW = image.width || image.naturalWidth || 0;
  const srcH = image.height || image.naturalHeight || 0;
  if (!srcW || !srcH) return blob;
  const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.drawImage(image, 0, 0, targetW, targetH);
  if (typeof image.close === 'function') image.close();
  const outBlob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
  return outBlob || blob;
}

async function cropSquareImageBlob(blob, options = {}) {
  const size = options.size ?? options.maxDimension ?? 512;
  const quality = options.quality ?? 0.85;
  if (!blob) return null;
  let image;
  try {
    image = await decodeImageFromBlob(blob);
  } catch {
    return compressImageBlob(blob, { maxDimension: size, quality });
  }
  const srcW = image.width || image.naturalWidth || 0;
  const srcH = image.height || image.naturalHeight || 0;
  if (!srcW || !srcH) return blob;
  const side = Math.min(srcW, srcH);
  const sx = Math.round((srcW - side) / 2);
  const sy = Math.round((srcH - side) / 2);
  const target = Math.max(1, Math.round(size));
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.drawImage(image, sx, sy, side, side, 0, 0, target, target);
  if (typeof image.close === 'function') image.close();
  const outBlob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
  return outBlob || blob;
}

async function uploadPhotoFiles(logId, files, options = {}) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const maxDimension = options.maxDimension ?? 1600;
  const quality = options.quality ?? 0.82;
  const storageRoot = options.storageRoot ?? 'logs';
  await initAuth();
  const st = getStorage();
  if (!st) throw new Error('Storage is not configured');
  const out = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const sourceBlob = file instanceof Blob ? file : dataUrlToBlob(String(file || ''));
    if (!sourceBlob) continue;
    const blob = options.cropSquare
      ? await cropSquareImageBlob(sourceBlob, { size: maxDimension, quality })
      : await compressImageBlob(sourceBlob, { maxDimension, quality });
    const ext = (blob.type || '').includes('png') ? 'png' : 'jpg';
    const fileName = options.fileName != null ? String(options.fileName) : String(i + 1);
    const ref = st.ref(`${storageRoot}/${logId}/${fileName}.${ext}`);
    await ref.put(blob, { contentType: blob.type || 'image/jpeg' });
    out.push(await ref.getDownloadURL());
  }
  return out;
}

function chooseBrandLogoExt(file) {
  const t = String(file?.type || '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  return 'jpg';
}

async function uploadBrandLogoFile(brandId, logoFile) {
  await initAuth().catch(() => null);
  const st = getStorage();
  if (!st) throw new Error('Storage not configured');
  const ext = chooseBrandLogoExt(logoFile);
  const ref = st.ref(`brandLogos/${brandId}.${ext}`);
  await ref.put(logoFile, { contentType: logoFile.type || 'image/jpeg' });
  return ref.getDownloadURL();
}

function assertV2Firestore() {
  if (!getDb()) {
    const err = new Error('Firestore is required for Matcha Map v2. Configure FIREBASE_CONFIG in js/config.js.');
    window.__V2_FATAL__ = { code: 'firestore_required', message: err.message };
    throw err;
  }
}

async function buildListEntriesForSave(listId, rawEntries) {
  const entries = [];
  for (let i = 0; i < rawEntries.length; i += 1) {
    const row = rawEntries[i] || {};
    const entryId = String(row.id || `entry_${Date.now()}_${i}`);
    let photoUrl = row.photoUrl || null;
    if (row.photoFile) {
      const urls = await uploadPhotoFiles(listId, [row.photoFile], {
        storageRoot: 'lists',
        fileName: entryId,
        maxDimension: 1200,
        quality: 0.82,
      });
      photoUrl = urls[0] || null;
    }
    const placeId = row.placeId ? String(row.placeId) : null;
    const placeName = String(row.placeName || '').trim();
    let brandId = row.brandId ? String(row.brandId) : null;
    let branchId = row.branchId != null && row.branchId !== '' ? String(row.branchId) : null;
    if (placeId && !brandId) brandId = `gplace_${placeId}`;
    if (placeId && !branchId) {
      branchId = `gp_${String(placeId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`;
    }
    if (placeId) {
      saveCafe({
        id: branchId,
        placeId,
        name: placeName || 'Place',
        address: String(row.placeAddress || '').trim(),
        lat: row.lat,
        lng: row.lng,
        starred: true,
      });
    }
    entries.push({
      id: entryId,
      brandId,
      branchId,
      placeId,
      placeName: placeName || null,
      placeAddress: String(row.placeAddress || '').trim() || null,
      photoUrl,
    });
  }
  return entries;
}

let cachedUserProfile = null;

function v2ProfileDocId(ownerId) {
  return String(ownerId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

async function v2GetUserProfile(ownerId) {
  if (typeof DataMod.getUserProfile === 'function') {
    return DataMod.getUserProfile(ownerId);
  }
  const oid = v2ProfileDocId(ownerId);
  if (!oid) return null;
  const db = getDb();
  if (!db) return null;
  try {
    const snap = await db.collection(USER_PROFILES_COLLECTION).doc(oid).get();
    if (!snap.exists) return null;
    return { ownerId: oid, ...snap.data() };
  } catch (e) {
    console.warn('[v2] getUserProfile fallback failed:', e?.message || e);
    return null;
  }
}

async function v2UpsertUserProfile(ownerId, patch) {
  if (typeof DataMod.upsertUserProfile === 'function') {
    return DataMod.upsertUserProfile(ownerId, patch);
  }
  const oid = v2ProfileDocId(ownerId);
  if (!oid) throw new Error('ownerId required');
  const db = getDb();
  if (!db) throw new Error('Firestore not available');
  const clean = { ownerId: oid, updatedAt: Date.now() };
  if (patch?.displayName != null) clean.displayName = String(patch.displayName).trim();
  if (patch?.username != null) clean.username = String(patch.username).trim();
  if (patch?.avatarUrl != null) clean.avatarUrl = patch.avatarUrl ? String(patch.avatarUrl) : null;
  if (patch?.instagram != null) clean.instagram = String(patch.instagram).trim().replace(/^@/, '');
  await db.collection(USER_PROFILES_COLLECTION).doc(oid).set(clean, { merge: true });
  return v2GetUserProfile(oid);
}

async function loadUserProfileDoc() {
  const base = getCurrentProfile();
  const oid = String(base?.ownerId || '').trim();
  if (!oid) return null;
  try {
    return await v2GetUserProfile(oid);
  } catch (e) {
    console.warn('[v2] getUserProfile failed:', e?.message || e);
    return null;
  }
}

function mergeV2Profile(baseProf, extra) {
  const p = baseProf || {};
  const e = extra || {};
  const name = String(e.displayName || p.name || '').trim();
  const uname = String(e.username || p.username || '').trim();
  const handle = uname.replace(/^@/, '') || 'member';
  const initial = String(name || handle || '?').replace(/^@/, '').trim().slice(0, 1).toUpperCase() || '?';
  const instagram = String(e.instagram || '').trim().replace(/^@/, '');
  const instagramUrl = instagram ? `https://instagram.com/${instagram}` : '';
  return {
    ownerId: p.ownerId || '',
    displayName: name || handle,
    username: uname.startsWith('@') ? uname : `@${handle}`,
    handle,
    avatarInitial: initial,
    avatarUrl: e.avatarUrl || null,
    instagram,
    instagramUrl,
  };
}

async function refreshV2Data() {
  await initData();
  assertV2Firestore();

  let liveBrandsRaw = [];
  try {
    liveBrandsRaw = await getGalleryBrands();
  } catch (e) {
    console.warn('[v2] getGalleryBrands failed:', e?.message || e);
  }
  const liveBrands = toV2Brands(liveBrandsRaw);
  cachedGalleryBrands = liveBrandsRaw;
  cachedLiveBrands = liveBrands;
  rebuildCafeBrandIndex(liveBrands);
  const basePosts = toV2Posts(getLogs(), liveBrands);
  if (window.setV2Data) {
    window.setV2Data({ brands: liveBrands, posts: basePosts });
  }
  signalBootstrapOkOnce();

  let livePosts = basePosts;
  try {
    livePosts = await hydratePostsEngagement(basePosts);
  } catch (e) {
    console.warn('[v2] hydratePostsEngagement failed:', e?.message || e);
  }

  let uiEvents = [];
  let uiLists = [];
  try {
    const [fireEvents, fireLists] = await Promise.all([
      getEvents(),
      getAllLists(),
    ]);
    uiEvents = (fireEvents || []).map(toV2UiEvent).filter(Boolean);
    uiLists = (fireLists || []).map(enrichListForUi);
  } catch (e) {
    console.warn('[v2] events/lists fetch failed:', e?.message || e);
  }

  if (window.setV2Data) {
    window.setV2Data({
      brands: liveBrands,
      posts: livePosts,
      events: uiEvents,
      lists: uiLists,
    });
  }

  try {
    cachedUserProfile = await loadUserProfileDoc();
    window.dispatchEvent(new Event('v2:profile-updated'));
  } catch (e) {
    console.warn('[v2] profile load failed:', e?.message || e);
  }
}

window.V2Live = {
  refresh: refreshV2Data,
  getProfile() {
    return mergeV2Profile(getCurrentProfile(), cachedUserProfile);
  },
  async updateProfile(payload) {
    await initData();
    assertV2Firestore();
    const base = getCurrentProfile();
    const oid = String(base?.ownerId || '').trim();
    if (!oid) throw new Error('Profile owner id required');
    const patch = {};
    if (payload?.instagram != null) {
      patch.instagram = String(payload.instagram).trim().replace(/^@/, '');
    }
    if (payload?.avatarFile) {
      const urls = await uploadPhotoFiles(oid, [payload.avatarFile], {
        storageRoot: 'profiles',
        fileName: 'avatar',
        maxDimension: 512,
        quality: 0.85,
        cropSquare: true,
      });
      patch.avatarUrl = urls[0] || null;
    }
    cachedUserProfile = await v2UpsertUserProfile(oid, patch);
    window.dispatchEvent(new Event('v2:profile-updated'));
    return mergeV2Profile(base, cachedUserProfile);
  },
  async submitEvent(payload) {
    const { coverPhotoFile, ...rest } = payload || {};
    await initData();
    assertV2Firestore();
    const eventId = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    let coverPhoto = rest.coverPhoto || null;
    if (coverPhotoFile) {
      const urls = await uploadPhotoFiles(eventId, [coverPhotoFile], {
        storageRoot: 'events',
        maxDimension: 512,
        quality: 0.82,
      });
      coverPhoto = urls[0] || null;
    }
    await createEvent({ ...rest, id: eventId, coverPhoto });
    await refreshV2Data();
    return eventId;
  },
  async updateEvent(eventId, payload) {
    const { coverPhotoFile, keepCoverPhoto, ...rest } = payload || {};
    await initData();
    assertV2Firestore();
    const id = String(eventId || '').trim();
    if (!id) throw new Error('Event id required');
    const updatePayload = { ...rest };
    if (coverPhotoFile) {
      const urls = await uploadPhotoFiles(id, [coverPhotoFile], {
        storageRoot: 'events',
        maxDimension: 512,
        quality: 0.82,
      });
      updatePayload.coverPhoto = urls[0] || null;
    } else if (keepCoverPhoto) {
      updatePayload.coverPhoto = keepCoverPhoto;
    }
    await persistUpdateEvent(id, updatePayload);
    await refreshV2Data();
  },
  async deleteEvent(eventId) {
    await initData();
    assertV2Firestore();
    await persistDeleteEvent(eventId);
    await refreshV2Data();
  },
  async updateEventMerchants(eventId, merchantIds) {
    await initData();
    assertV2Firestore();
    await persistUpdateEventMerchants(eventId, merchantIds);
    await refreshV2Data();
  },
  async createList(payload) {
    await initData();
    assertV2Firestore();
    const oid = getCurrentUserId();
    if (!oid) throw new Error('User id required');
    const { entries: rawEntries = [], ...rest } = payload || {};
    const listId = rest.id || `list_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const entries = await buildListEntriesForSave(listId, rawEntries);
    await persistCreateList(oid, { ...rest, id: listId, type: 'brands', entries });
    await refreshV2Data();
    return listId;
  },
  async updateList(listId, payload) {
    await initData();
    assertV2Firestore();
    const id = String(listId || '').trim();
    if (!id) throw new Error('List id required');
    const { entries: rawEntries, ...rest } = payload || {};
    const patch = { ...rest };
    if (Array.isArray(rawEntries)) {
      patch.entries = await buildListEntriesForSave(id, rawEntries);
    }
    await persistUpdateList(id, patch);
    await refreshV2Data();
  },
  async deleteList(listId) {
    await initData();
    assertV2Firestore();
    await persistDeleteList(listId);
    await refreshV2Data();
  },
  async refreshPostEngagement(logId) {
    await initData();
    assertV2Firestore();
    if (!logId) return;
    const [likeDoc, commentCount] = await Promise.all([
      getPostLikeDoc(logId),
      getLogCommentCount(logId),
    ]);
    mergePostLikeFromRemote(logId, likeDoc.userIds);
    patchPostEngagementInPlace(logId, {
      likeCount: likeDoc.count,
      commentCount,
      liked: hasUserLikedPost(logId),
    });
  },
  async setPostLike(logId, value) {
    await initData();
    assertV2Firestore();
    if (!logId) return;
    try {
      await setPostLikeSynced(logId, !!value);
      const doc = await getPostLikeDoc(logId);
      mergePostLikeFromRemote(logId, doc.userIds);
      patchPostEngagementInPlace(logId, {
        likeCount: doc.count,
        liked: hasUserLikedPost(logId),
      });
    } catch (e) {
      console.warn('[v2] setPostLike failed:', e?.message || e);
    }
  },
  comments: {
    async fetch(logId) {
      await initData();
      assertV2Firestore();
      return getLogComments(logId);
    },
    async add(logId, text) {
      await initData();
      assertV2Firestore();
      await addLogComment(logId, text);
    },
  },
  async getPlacePhoto(placeId, persist = true) {
    await initData();
    assertV2Firestore();
    if (!placeId) return null;
    try {
      const { fetchPlaceDetails } = await ensureMapsApi();
      let details = await fetchPlaceDetails(placeId, false, persist).catch(() => null);
      if (!details?.photoUrl) {
        details = await fetchPlaceDetails(placeId, true, persist).catch(() => null);
      }
      return details?.photoUrl || null;
    } catch {
      return null;
    }
  },
  /** Sync read of a place photo already cached locally (no Maps API call). */
  getCachedPlacePhoto(placeId) {
    if (!placeId) return null;
    const cafe = getCafeByPlaceId(String(placeId));
    return cafe?.photoUrl || null;
  },
  async getPlaceDetails(placeId, persist = true) {
    await initData();
    assertV2Firestore();
    if (!placeId) return null;
    try {
      const { fetchPlaceDetails } = await ensureMapsApi();
      const details = await fetchPlaceDetails(placeId, false, persist).catch(() => null);
      return details || null;
    } catch {
      return null;
    }
  },
  async resolvePlaceLabel(placeId) {
    if (!placeId) return null;
    try {
      const { resolvePlaceLabel } = await ensureMapsApi();
      return resolvePlaceLabel(placeId).catch(() => null);
    } catch {
      return null;
    }
  },
  getPostsForPlace(placeId) {
    if (!placeId) return [];
    const cafe = getCafeByPlaceId(placeId);
    if (!cafe?.id) return [];
    const posts = Array.isArray(window.POSTS) ? window.POSTS : [];
    return posts.filter((p) => String(p.branchId) === String(cafe.id));
  },
  async searchPlacesForLog(query) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    let m;
    try {
      m = await ensureMapsApi();
    } catch {
      return [];
    }
    const searchAny = m.searchPlaceByText || m.searchQuery;
    const fromPlaces = await searchAny(q);
    const branchPlaceIds = new Set();
    (Array.isArray(window.BRANDS) ? window.BRANDS : []).forEach((b) => {
      (b.branches || []).forEach((br) => {
        if (br?.placeId) branchPlaceIds.add(String(br.placeId));
      });
    });
    const out = [];
    const seen = new Set();
    for (const r of fromPlaces || []) {
      const pid = r.placeId || null;
      if (!pid || seen.has(pid)) continue;
      if (branchPlaceIds.has(String(pid))) continue;
      seen.add(pid);
      out.push({
        placeId: pid,
        name: r.name || 'Place',
        address: r.address || '',
        lat: r.lat,
        lng: r.lng,
        rating: r.rating,
      });
      if (out.length >= 8) break;
    }
    return out;
  },
  async searchPlacesForEvents(query) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    let m;
    try {
      m = await ensureMapsApi();
    } catch {
      return [];
    }
    const searchAny = m.searchPlaceByText || m.searchQuery;
    const fromPlaces = await searchAny(q);
    const out = [];
    const seen = new Set();
    for (const r of fromPlaces || []) {
      const pid = r.placeId || null;
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      out.push({
        placeId: pid,
        name: r.name || 'Place',
        address: r.address || '',
        lat: r.lat,
        lng: r.lng,
        rating: r.rating,
      });
      if (out.length >= 8) break;
    }
    return out;
  },
  searchPlacesForPopUps(query) {
    return this.searchPlacesForEvents(query);
  },
  async deletePost(postId) {
    await initData();
    assertV2Firestore();
    if (!postId) return;
    await deleteLog(postId);
    await refreshV2Data();
  },
  async setLocationLike(cafeId, value) {
    await initData();
    assertV2Firestore();
    if (!cafeId) return;
    setLocationLike(cafeId, !!value);
    window.dispatchEvent(new Event('v2:likes-updated'));
  },
  async setLocationTags(cafeId, tags) {
    await initData();
    assertV2Firestore();
    if (!cafeId) return;
    setCafeLocationMeta(cafeId, { locationTags: Array.isArray(tags) ? tags : [] });
    await refreshV2Data();
  },
  async setLocationHoursOverride(cafeId, hoursOverride) {
    await initData();
    assertV2Firestore();
    if (!cafeId) return;
    setCafeLocationMeta(cafeId, { hoursOverride });
    await refreshV2Data();
  },
  /** Stable cafe id for a Google place (matches savePost / gp_ fallback). */
  resolveCafeIdForPlace(placeId) {
    if (!placeId) return null;
    const existing = getCafeByPlaceId(String(placeId));
    return existing?.id || `gp_${String(placeId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`;
  },
  isLocationLiked(cafeId) {
    return Boolean(cafeId && hasUserLikedLocation(String(cafeId)));
  },
  isBrandLiked(brandId) {
    return Boolean(brandId && hasUserLikedBrand(brandId));
  },
  async setBrandLike(brandId, value) {
    await initData();
    assertV2Firestore();
    if (!brandId) return;
    persistBrandLike(brandId, !!value);
    window.dispatchEvent(new Event('v2:likes-updated'));
  },
  async addBrand({ name, logoFile, socialLinks }) {
    await initData();
    assertV2Firestore();
    const brandName = String(name || '').trim();
    if (!brandName) throw new Error('Brand name is required');
    const brandId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    let logoUrl = null;
    if (logoFile) {
      logoUrl = await uploadBrandLogoFile(brandId, logoFile);
    }
    const config = await getBrandsConfig();
    const brands = [...(config.brands || [])];
    brands.push({
      id: brandId,
      name: brandName,
      cafeIds: [],
      logoUrl,
      socialLinks: normalizeBrandSocialLinks(socialLinks),
    });
    await setBrandsConfig(brands);
    await refreshV2Data();
    return brandId;
  },
  async updateBrand({ brandId, name, logoFile, removeLogo, socialLinks }) {
    await initData();
    assertV2Firestore();
    const id = String(brandId || '').trim();
    if (!id) throw new Error('Brand not found');
    const brandName = String(name || '').trim();
    if (!brandName) throw new Error('Brand name is required');
    const config = await getBrandsConfig();
    const brands = [...(config.brands || [])];
    const idx = brands.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error('Brand not found');
    if (brands[idx].archived) throw new Error('Brand not found');
    let logoUrl = brands[idx].logoUrl || null;
    if (removeLogo) logoUrl = null;
    if (logoFile) {
      logoUrl = await uploadBrandLogoFile(id, logoFile);
    }
    brands[idx] = {
      ...brands[idx],
      name: brandName,
      logoUrl,
      socialLinks: normalizeBrandSocialLinks(socialLinks ?? brands[idx].socialLinks),
    };
    await setBrandsConfig(brands);
    await refreshV2Data();
    return id;
  },
  async archiveBrand(brandId) {
    await initData();
    assertV2Firestore();
    const id = String(brandId || '').trim();
    if (!id) throw new Error('Brand not found');
    const config = await getBrandsConfig();
    const brands = [...(config.brands || [])];
    const idx = brands.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error('Brand not found');
    if (brands[idx].archived) throw new Error('Brand is already archived');
    brands[idx] = {
      ...brands[idx],
      archived: true,
      archivedAt: new Date().toISOString(),
    };
    await setBrandsConfig(brands);
    await refreshV2Data();
    return id;
  },
  async addBranchToBrand(brandId, { placeId, name, address, lat, lng }) {
    await initData();
    assertV2Firestore();
    const bid = String(brandId || '').trim();
    if (!bid) throw new Error('Brand not found');
    const pid = String(placeId || '').trim();
    if (!pid) throw new Error('Pick a location from search');

    const config = await getBrandsConfig();
    const brands = [...(config.brands || [])];
    const idx = brands.findIndex((b) => b.id === bid);
    if (idx < 0) throw new Error('Brand not found');
    if (brands[idx].archived) throw new Error('Brand not found');

    const cafeId = this.resolveCafeIdForPlace(pid);
    const currentIds = (brands[idx].cafeIds || []).map(String);
    if (currentIds.includes(String(cafeId))) {
      throw new Error('This location is already linked to this brand');
    }
    const owner = findBrandOwningCafe(cafeId, brands);
    if (owner && owner.id !== bid) {
      throw new Error(`Already linked to ${owner.name || 'another brand'}`);
    }

    const resolvedName = String(name || '').trim();
    let saved = saveCafe({
      id: cafeId,
      placeId: pid,
      name: resolvedName || 'Location',
      address: String(address || '').trim(),
      lat: typeof lat === 'number' ? lat : (lat != null ? Number(lat) : undefined),
      lng: typeof lng === 'number' ? lng : (lng != null ? Number(lng) : undefined),
      classification: 'matcha_cafe',
    });

    try {
      const { fetchPlaceDetails } = await ensureMapsApi();
      const details = await fetchPlaceDetails(pid, true, true);
      if (details && saved) {
        const detailsName = String(details.name || '').trim();
        saved = saveCafe({
          ...saved,
          name: resolvedName || detailsName || saved.name,
          photoUrl: details.photoUrl ?? saved.photoUrl,
          rating: details.rating ?? saved.rating,
          userRatingCount: details.userRatingCount ?? saved.userRatingCount,
          openStatus: details.openStatus ?? saved.openStatus,
        });
      }
      if (saved && !saved.photoUrl) {
        const photoUrl = await this.getPlacePhoto(pid, true);
        if (photoUrl) {
          saved = saveCafe({ ...saved, photoUrl });
        }
      }
    } catch (e) {
      console.warn('[v2] addBranchToBrand place enrichment failed:', e?.message || e);
    }

    brands[idx] = { ...brands[idx], cafeIds: [...currentIds, String(saved.id)] };
    await setBrandsConfig(brands);
    await refreshV2Data();
    return saved.id;
  },
  async removeBranchFromBrand(brandId, cafeId) {
    await initData();
    assertV2Firestore();
    const bid = String(brandId || '').trim();
    const cid = String(cafeId || '').trim();
    if (!bid || !cid) throw new Error('Branch not found');

    const config = await getBrandsConfig();
    const brands = [...(config.brands || [])];
    const idx = brands.findIndex((b) => b.id === bid);
    if (idx < 0) throw new Error('Brand not found');

    const nextIds = (brands[idx].cafeIds || []).map(String).filter((id) => id !== cid);
    brands[idx] = { ...brands[idx], cafeIds: nextIds };
    await setBrandsConfig(brands);
    await refreshV2Data();
  },
  async updateBranchDetails(cafeId, { name, hoursOverride, locationTags }) {
    await initData();
    assertV2Firestore();
    const id = String(cafeId || '').trim();
    if (!id) throw new Error('Branch not found');
    const cafe = getCafeById(id);
    if (!cafe) throw new Error('Branch not found');

    if (name !== undefined) {
      const trimmed = String(name || '').trim();
      saveCafe({ ...cafe, name: trimmed || cafe.name || 'Location' });
    }
    if (hoursOverride !== undefined || locationTags !== undefined) {
      setCafeLocationMeta(id, {
        ...(locationTags !== undefined ? { locationTags } : {}),
        ...(hoursOverride !== undefined ? { hoursOverride } : {}),
      });
    }
    await refreshV2Data();
    return id;
  },
  map: {
    mounted: false,
    selected: null,
    onSelectPin: null,
    currentResults: [],
    activeSearchQuery: '',
    _showCuratedRun: 0,
    async getMap() {
      try {
        const m = await ensureMapsApi();
        return m.getMap();
      } catch {
        return null;
      }
    },
    emitSelect(pin) {
      this.selected = pin;
      void (async () => {
        try {
          const m = await ensureMapsApi();
          if (pin?.kind === 'event') {
            m.setSelectedCafeId(null);
            if (typeof m.setSelectedEventId === 'function') m.setSelectedEventId(pin?.eventId || pin?.id || null);
          } else {
            if (typeof m.setSelectedEventId === 'function') m.setSelectedEventId(null);
            m.setSelectedCafeId(pin?.id || null);
          }
        } catch (_) {}
      })();
      if (typeof this.onSelectPin === 'function') this.onSelectPin(pin);
    },
    deselect() {
      this.emitSelect(null);
    },
    async shouldSkipBackgroundClick() {
      try {
        const m = await ensureMapsApi();
        return typeof m.shouldSkipMapBackgroundClick === 'function' && m.shouldSkipMapBackgroundClick();
      } catch {
        return false;
      }
    },
    async mount(containerId, onSelectPin) {
      await withTimeout(initData(), 12000, 'Map data initialization');
      assertV2Firestore();
      let m;
      try {
        m = await ensureMapsApi();
      } catch (e) {
        return false;
      }
      const vp = await resolveInitialMapViewport();
      const mapInstance = m.initMap(containerId, {
        initialCenter: { lat: vp.lat, lng: vp.lng },
        initialZoom: vp.zoom,
      });
      if (!mapInstance) return false;
      this.onSelectPin = onSelectPin;
      m.clearCuratedPins();
      this.currentResults = [];
      this.activeSearchQuery = '';
      const gmap = m.getMap();
      if (gmap) {
        let viewportSaveTimer = null;
        gmap.addListener('idle', () => {
          if (viewportSaveTimer) clearTimeout(viewportSaveTimer);
          viewportSaveTimer = setTimeout(() => {
            const c = gmap.getCenter();
            const z = gmap.getZoom();
            if (c && z != null) persistMapViewport(c.lat(), c.lng(), z);
          }, 500);
        });
        if (!this._mapClickListener) {
          m.setMapBackgroundClickHandler(() => {
            this.deselect();
          });
          this._mapClickListener = true;
        }
      }
      m.onMoveEnd(() => {
        if (this.activeSearchQuery) return;
        void this.showCurated();
      });
      if (!this._dataListener) {
        this._dataListener = () => {
          if (this.mounted) void this.showCurated();
        };
        window.addEventListener('v2:data-updated', this._dataListener);
      }
      this.mounted = true;
      return true;
    },
    async showCurated() {
      const runId = ++this._showCuratedRun;
      let m;
      try {
        m = await ensureMapsApi();
      } catch (e) {
        return [];
      }
      const {
        getMap, clearCuratedPins, addCuratedPins, flyTo, addEventPins, clearEventPins,
      } = m;
      const map = getMap();
      if (!map) return [];
      let bounds = map.getBounds();
      let zoom = map.getZoom();
      if (!bounds && typeof window.google !== 'undefined' && window.google.maps) {
        bounds = new window.google.maps.LatLngBounds(METRO_MANILA_SW, METRO_MANILA_NE);
      }
      if (zoom == null) zoom = 13;
      if (!bounds) return [];
      const cafes = getCafesInBounds(bounds, zoom)
        .filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number');
      const myCafeIds = new Set(getMyCafes().map((c) => c.id));
      const statsByCafeId = toMapCafeStats();
      const curated = dedupeMapPlaces(cafes.map((cafe) => enrichCafeForMap(cafe, { myCafeIds, statsByCafeId }))).slice(0, 30);
      clearCuratedPins();
      addCuratedPins(curated, (cafe) => {
        flyTo(cafe.lat, cafe.lng, 16);
        const saved = saveCafe(cafe);
        this.emitSelect(saved);
      });

      const eventsForMap = await collectActiveUpcomingEventsInBounds(bounds);
      if (runId !== this._showCuratedRun) return curated;
      if (typeof clearEventPins === 'function') clearEventPins();
      if (typeof addEventPins === 'function') {
        addEventPins(eventsForMap, (ev) => {
          if (Number.isFinite(ev?.lat) && Number.isFinite(ev?.lng)) {
            flyTo(ev.lat, ev.lng, 16);
          }
          this.emitSelect({
            kind: 'event',
            eventId: ev?.id || null,
            id: ev?.id || null,
            title: ev?.title || ev?.name || 'Event',
            name: ev?.title || ev?.name || ev?.location || 'Event',
            location: ev?.location || ev?.address || '',
            address: ev?.location || ev?.address || '',
            sub: ev?.location || '',
            dateLabel: ev?.dateLabel || '',
            type: ev?.type || '',
            status: ev?.status || '',
            coverPhoto: ev?.coverPhoto || null,
            coverHue: ev?.coverHue,
            merchantIds: ev?.merchantIds || [],
            brandId: ev?.brandId || null,
            brandName: ev?.brandName || '',
            lat: ev?.lat,
            lng: ev?.lng,
          });
        });
      }

      this.activeSearchQuery = '';
      this.currentResults = curated;
      return curated;
    },
    recenter() {
      void (async () => {
        let m;
        try {
          m = await ensureMapsApi();
        } catch {
          return;
        }
        const { getMap, flyTo } = m;
        const map = getMap();
        const fallback = () => {
          const saved = readStoredMapViewport();
          if (saved) {
            if (map) {
              map.setCenter({ lat: saved.lat, lng: saved.lng });
              map.setZoom(saved.zoom);
            } else {
              flyTo(saved.lat, saved.lng, saved.zoom);
            }
          } else if (map) {
            map.setCenter(ORTIGAS_CENTER);
            map.setZoom(ORTIGAS_ZOOM);
          } else {
            flyTo(ORTIGAS_CENTER.lat, ORTIGAS_CENTER.lng, ORTIGAS_ZOOM);
          }
          setTimeout(() => void this.showCurated(), 120);
        };
        getCurrentPosition()
          .then((pos) => {
            const lat = Number(pos?.coords?.latitude);
            const lng = Number(pos?.coords?.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
              fallback();
              return;
            }
            if (map) {
              map.setCenter({ lat, lng });
              map.setZoom(USER_LOCATION_ZOOM);
            } else {
              flyTo(lat, lng, USER_LOCATION_ZOOM);
            }
            persistMapViewport(lat, lng, USER_LOCATION_ZOOM);
            setTimeout(() => void this.showCurated(), 120);
          })
          .catch(() => fallback());
      })();
    },
    select(pin) {
      void (async () => {
        if (!pin) return;
        let m;
        try {
          m = await ensureMapsApi();
        } catch {
          return;
        }
        const { flyTo } = m;
        const lat = Number(pin.lat);
        const lng = Number(pin.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) flyTo(lat, lng, 16);
        this.emitSelect(pin);
      })();
    },
    async search(input, onSelectPin) {
      if (typeof onSelectPin === 'function') this.onSelectPin = onSelectPin;
      const q = String(input || '').trim();
      if (!q) return this.showCurated();
      this.activeSearchQuery = q;
      let m;
      try {
        m = await ensureMapsApi();
      } catch (e) {
        return [];
      }
      const {
        searchQuery, clearCuratedPins, addCuratedPins, flyTo, fitBounds,
      } = m;
      const fromPlaces = await searchQuery(q);
      const merged = dedupeMapPlaces(mergeSearchResultsWithSaved(fromPlaces));
      clearCuratedPins();
      addCuratedPins(merged, (cafe) => {
        const lat = Number(cafe.lat);
        const lng = Number(cafe.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) flyTo(lat, lng, 16);
        const existing = getCafeByPlaceId(cafe.placeId) || getCafeById(cafe.id);
        if (existing) {
          const saved = saveCafe(cafe);
          this.emitSelect({
            ...saved,
            ...cafe,
            id: saved?.id || cafe.id,
            branchId: cafe.branchId || saved?.id || cafe.id || null,
            brandId: cafe.brandId || saved?.brandId || resolveBrandIdForCafe(saved?.id || cafe.id),
            placeId: cafe.placeId || saved?.placeId || null,
            photo: cafe.photo || saved?.photoUrl || null,
            googleRating: Number(cafe.googleRating || cafe.rating || saved?.rating) || 0,
            googleReviewCount: Number(cafe.googleReviewCount || cafe.userRatingCount || saved?.userRatingCount) || 0,
          });
          return;
        }
        this.emitSelect(cafe);
      });
      if (merged.length === 1) {
        const one = merged[0];
        if (Number.isFinite(one.lat) && Number.isFinite(one.lng)) {
          flyTo(one.lat, one.lng, 16);
        }
      } else if (merged.length > 1) {
        fitBounds(merged);
      }
      this.currentResults = merged;
      return merged;
    },
  },
  async savePost(payload) {
    await initData();
    assertV2Firestore();
    const profile = getCurrentProfile();
    const existingPostId = payload?.postId ? String(payload.postId).trim() : '';
    const isUpdate = Boolean(existingPostId);
    const logId = isUpdate
      ? existingPostId
      : `v2_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    if (isUpdate) {
      const existing = (getLogs() || []).find((l) => String(l.id) === logId);
      const me = String(profile.ownerId || '');
      if (!existing || String(existing.userId || '') !== me) {
        throw new Error('Not allowed to edit this post');
      }
    }
    const selectedBrand = payload?.brand || null;
    const selectedBranch = payload?.branch || null;
    const eventInput = payload?.event || payload?.popUp || null;
    if (!selectedBrand?.id) throw new Error('Brand is required');
    let cafeId = selectedBranch?.id || null;
    const placeId = selectedBranch?.placeId || null;
    if (!cafeId && placeId) {
      const existing = getCafeByPlaceId(placeId);
      cafeId = existing?.id || `gp_${String(placeId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`;
    }
    if (cafeId) {
      saveCafe({
        id: cafeId,
        placeId: placeId || (getCafeById(cafeId)?.placeId) || null,
        name: selectedBranch?.name || selectedBrand.name,
        address: selectedBranch?.address || '',
        lat: selectedBranch?.lat,
        lng: selectedBranch?.lng,
        starred: true,
      });
    }

    let eventId = null;
    let popupGeneric = false;
    let eventAddress = null;
    let eventName = null;
    if (eventInput && !cafeId) {
      if (eventInput.id) {
        eventId = String(eventInput.id);
        const cached = (Array.isArray(window.EVENTS) ? window.EVENTS : []).find((e) => String(e.id) === eventId);
        eventAddress = cached?.location || eventInput.address || null;
        eventName = cached?.title || eventInput.name || null;
      } else if (eventInput.generic) {
        popupGeneric = true;
      }
    }

    const drinks = (payload?.drinks || []).filter((d) => String(d?.name || '').trim()).map((d) => ({
      name: String(d.name || '').trim(),
      rating: Number(d.rating) || 0,
      notes: String(d.notes || '').trim(),
      price: String(d.price || '').trim(),
      flavorNotes: Array.isArray(d.flavorNotes) ? d.flavorNotes : [],
      profile: {
        sweet: Number(d.profile?.sweet) || 0,
        matcha: Number(d.profile?.matcha ?? d.profile?.matchaPresence) || 0,
        balance: Number(d.profile?.balance) || 0,
        umami: Number(d.profile?.umami) || 0,
        bitterness: Number(d.profile?.bitterness ?? d.profile?.bitter) || 0,
        astringency: Number(d.profile?.astringency) || 0,
        body: Number(d.profile?.body) || 0,
        texture: Number(d.profile?.texture) || 0,
        finish: Number(d.profile?.finish) || 0,
      },
      recommended: Boolean(d.recommended),
    }));
    const existingUrls = Array.isArray(payload?.existingPhotoUrls)
      ? payload.existingPhotoUrls.filter(Boolean)
      : [];
    const uploadedPhotoUrls = await uploadPhotoFiles(logId, payload?.photoFiles || []);
    const allPhotos = [...existingUrls, ...uploadedPhotoUrls].filter(Boolean);
    await saveLog({
      id: logId,
      userId: profile.ownerId,
      userName: profile.username,
      userDisplayName: profile.name,
      createdAt: isUpdate ? (Number(payload.createdAt) || undefined) : Date.now(),
      visit: {
        brandId: selectedBrand.id,
        brandName: selectedBrand.name,
        orderedAt: payload?.orderedAt || null,
        location: {
          cafeId: cafeId || null,
          cafeName: selectedBranch?.name || (eventId || popupGeneric ? (eventName || 'Event') : null),
          address: selectedBranch?.address || eventAddress || null,
          eventId: eventId || null,
          popupGeneric,
        },
      },
      post: {
        rating: Number(payload?.rating) || 0,
        caption: String(payload?.caption || '').trim(),
        photos: allPhotos,
        drinks,
      },
    });
    await refreshV2Data();
  },
};

async function runV2Bootstrap() {
  if (window.__V2_FATAL__) {
    window.dispatchEvent(new CustomEvent('v2:bootstrap-error', { detail: window.__V2_FATAL__ }));
    return;
  }
  if (typeof window.setV2Data === 'function') {
    window.setV2Data({ brands: [], posts: [] });
  }
  signalBootstrapOkOnce();
  void refreshV2Data().catch((e) => {
    if (!window.__V2_FATAL__) {
      window.__V2_FATAL__ = {
        code: 'bootstrap_failed',
        message: String(e?.message || e),
      };
    }
    window.dispatchEvent(new CustomEvent('v2:bootstrap-error', { detail: window.__V2_FATAL__ }));
  });
}

runV2Bootstrap();
