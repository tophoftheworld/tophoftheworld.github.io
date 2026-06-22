// Live data only — filled by bootstrap via setV2Data after Firestore-backed refresh.

const BRANDS = [];
const POSTS = [];
const EVENTS = [];
const USER_LISTS = [];

window.BRANDS = BRANDS;
window.POSTS = POSTS;
window.EVENTS = EVENTS;
window.USER_LISTS = USER_LISTS;

window.setV2Data = function setV2Data(next) {
  if (next?.brands && Array.isArray(next.brands)) {
    BRANDS.splice(0, BRANDS.length, ...next.brands);
  }
  if (next?.posts && Array.isArray(next.posts)) {
    POSTS.splice(0, POSTS.length, ...next.posts);
  }
  if (next?.events && Array.isArray(next.events)) {
    EVENTS.splice(0, EVENTS.length, ...next.events);
  }
  if (next?.lists && Array.isArray(next.lists)) {
    USER_LISTS.splice(0, USER_LISTS.length, ...next.lists);
  }
  window.dispatchEvent(new Event('v2:data-updated'));
};

window.formatPhpPrice = function formatPhpPrice(priceRaw) {
  const raw = String(priceRaw ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d.]/g, '');
  if (!digits) return raw;
  const num = parseFloat(digits);
  if (!Number.isFinite(num)) return raw;
  const formatted = Number.isInteger(num) ? String(Math.round(num)) : digits;
  return `\u20B1${formatted}`;
};

const DRINK_PROFILE_SCALES = [
  { key: 'sweet', label: 'Sweetness', low: 'Not sweet', high: 'Very sweet' },
  { key: 'matcha', label: 'Matcha presence', low: 'Subtle', high: 'Strong' },
  { key: 'balance', label: 'Balance', low: 'Unbalanced', high: 'Balanced' },
];

const MATCHA_PROFILE_SCALES = [
  { key: 'umami', label: 'Umami', low: 'Subtle', high: 'Intense' },
  { key: 'bitterness', label: 'Bitterness', low: 'No bitterness', high: 'Very bitter' },
  { key: 'astringency', label: 'Astringency', low: 'Smooth', high: 'Very astringent' },
  { key: 'body', label: 'Body', low: 'Light', high: 'Full' },
  { key: 'texture', label: 'Texture', low: 'Grainy', high: 'Smooth' },
  { key: 'finish', label: 'Finish', low: 'Short', high: 'Lingering' },
];

function drinkProfileHasValue(profile) {
  return Object.values(profile || {}).some((v) => Number(v) > 0);
}

window.DRINK_PROFILE_SCALES = DRINK_PROFILE_SCALES;
window.MATCHA_PROFILE_SCALES = MATCHA_PROFILE_SCALES;
window.drinkProfileHasValue = drinkProfileHasValue;

window.brandHueForPost = function brandHueForPost(post) {
  const b = BRANDS.find((x) => x.id === post?.brandId) || BRANDS[0];
  return typeof b?.hue === 'number' ? b.hue : 120;
};

window.userTriedBrand = function userTriedBrand(brandId) {
  if (!brandId) return false;
  return POSTS.some((p) => p.isOwn && String(p.brandId) === String(brandId));
};

window.gpCafeIdFromPlaceId = function gpCafeIdFromPlaceId(placeId) {
  return `gp_${String(placeId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`;
};

window.buildGooglePlaceBrand = function buildGooglePlaceBrand(row) {
  if (!row?.placeId) return null;
  const branchId = window.gpCafeIdFromPlaceId(row.placeId);
  return {
    id: `gplace_${row.placeId}`,
    name: row.name || 'Place',
    kind: 'cafe',
    hue: 120,
    isGooglePlace: true,
    branches: [{
      id: branchId,
      placeId: row.placeId,
      name: row.name || 'Place',
      address: row.address || '',
      lat: row.lat,
      lng: row.lng,
      neighborhood: '',
    }],
  };
};

window.resolveListEntryDisplay = function resolveListEntryDisplay(entry, brands) {
  if (!entry) return null;
  const brandList = Array.isArray(brands) ? brands : BRANDS;
  if (entry.brandId) {
    const brand = brandList.find((b) => String(b.id) === String(entry.brandId));
    if (brand) {
      const branches = Array.isArray(brand.branches) ? brand.branches : [];
      const branch = entry.branchId
        ? branches.find((br) => String(br.id) === String(entry.branchId)) || null
        : (branches[0] || null);
      const photo = entry.photoUrl
        || branch?.photoUrl
        || branches[0]?.photoUrl
        || (branch?.placeId ? window.V2Live?.getCachedPlacePhoto?.(branch.placeId) : null)
        || null;
      const address = branch?.address || branch?.neighborhood || brand.area || '';
      return { brand, branch, photo, address, isGooglePlace: false };
    }
  }
  const placeId = entry.placeId
    || (String(entry.brandId || '').startsWith('gplace_') ? String(entry.brandId).slice('gplace_'.length) : null);
  if (!placeId && !entry.placeName) return null;
  const name = entry.placeName || 'Location';
  const branchId = entry.branchId || (placeId ? window.gpCafeIdFromPlaceId(placeId) : `loc_${entry.id}`);
  const syntheticBrand = {
    id: entry.brandId || (placeId ? `gplace_${placeId}` : branchId),
    name,
    hue: 120,
    isGooglePlace: true,
    branches: [{
      id: branchId,
      placeId,
      name,
      address: entry.placeAddress || '',
    }],
  };
  return {
    brand: syntheticBrand,
    branch: syntheticBrand.branches[0],
    photo: entry.photoUrl
      || (placeId ? window.V2Live?.getCachedPlacePhoto?.(placeId) : null)
      || null,
    address: entry.placeAddress || '',
    isGooglePlace: true,
  };
};

window.resolveListDisplays = function resolveListDisplays(list, brands, posts) {
  const brandList = Array.isArray(brands) ? brands : BRANDS;
  const postList = Array.isArray(posts) ? posts : POSTS;
  if (!list) return [];
  if (list.type === 'drinks') {
    return (list.items || []).map((id) => postList.find((p) => p.id === id)).filter(Boolean).map((post) => ({
      kind: 'drink',
      post,
      photo: post.photos?.[0] || null,
      label: post.drinks?.[0]?.name || 'Drink',
      sublabel: post.brand,
    }));
  }
  const entries = Array.isArray(list.entries) && list.entries.length
    ? list.entries
    : (list.items || []).map((brandId, i) => ({
      id: `legacy_${brandId}_${i}`,
      brandId,
      branchId: null,
      photoUrl: null,
    }));
  return entries.map((entry) => {
    const resolved = window.resolveListEntryDisplay(entry, brandList);
    if (!resolved) return null;
    const branchLabel = resolved.branch?.name && resolved.branch.name !== resolved.brand.name
      ? resolved.branch.name
      : null;
    return {
      kind: 'brand',
      entry,
      ...resolved,
      label: resolved.brand.name,
      sublabel: branchLabel || resolved.address,
      isGooglePlace: Boolean(resolved.isGooglePlace),
    };
  }).filter(Boolean);
};
