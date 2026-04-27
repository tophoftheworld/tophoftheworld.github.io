/**
 * Matcha Hop – tabbed app: Map, Brands, Feed, My post.
 */

import { initMap, getMap, onMoveEnd, clearSearchPins, clearCuratedPins, addCuratedPins, setSelectedCafeId, flyTo, fitBounds, DEFAULT_CENTER, DEFAULT_ZOOM } from './map.js';
import { searchQuery, searchPlaceByText } from './search.js';
import { initData, getMyCafes, getLogsByCafeId, getLogsByBrandId, getLogsByPopupId, getLogsForBrand, getLogs, getLogsForCurrentUser, getCafeById, getCafeByPlaceId, saveCafe, deleteLog, getCafesInBounds, getGalleryBrands, getPopUpsByBrandId, addPopUp, updatePopUp, deletePopUp, getBrandTotalLikeCount, getLocationLikeCount, hasUserLikedBrand, hasUserLikedLocation, setBrandLike, setLocationLike } from './data.js';
import { openLogForm } from './log-form.js';
import { fetchPlaceDetails } from './place-details.js';

let currentSearchResults = [];
let selectedCafe = null;
let postPageReturnState = null;
const TAB_IDS = ['tab-map', 'tab-brands', 'tab-feed', 'tab-mylogs'];
const PANEL_IDS = ['panel-map', 'panel-brands', 'panel-feed', 'panel-mylogs'];
const uiPostState = new Map();

const HEART_COLOR = '#1d8a00';
const HEART_PATH = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

/** Return heart SVG HTML string (for initial render, no flash). filled: true = solid, false = outline. */
function getHeartIconSvg(filled) {
  if (filled) {
    return `<svg class="heart-icon heart-icon--filled" viewBox="0 0 24 24" width="24" height="24" fill="${HEART_COLOR}" aria-hidden="true"><path d="${HEART_PATH}"/></svg>`;
  }
  return `<svg class="heart-icon heart-icon--outline" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${HEART_COLOR}" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="${HEART_PATH}"/></svg>`;
}

/** Render green heart SVG into element. filled: true = solid green, false = outline green. */
function renderHeartIcon(element, filled) {
  if (!element) return;
  element.innerHTML = getHeartIconSvg(filled);
}

function recenterMapToCurrentLocation() {
  flyTo(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng, DEFAULT_ZOOM);
}

function updateRecenterButtonVisibility() {
  const map = getMap();
  const btn = document.getElementById('map-recenter-btn');
  const locationPageVisible = !document.getElementById('location-page')?.classList.contains('hidden');
  if (!map || !btn || locationPageVisible) return;
  const center = map.getCenter();
  const zoom = map.getZoom();
  if (!center || zoom == null) return;
  const latDiff = Math.abs(center.lat() - DEFAULT_CENTER.lat);
  const lngDiff = Math.abs(center.lng() - DEFAULT_CENTER.lng);
  const movedAway = latDiff > 0.0008 || lngDiff > 0.0008 || Math.abs(zoom - DEFAULT_ZOOM) > 0.01;
  btn.classList.toggle('hidden', !movedAway);
}

function showBottomSheet(cafe, isMyCafe = false) {
  selectedCafe = cafe;
  setSelectedCafeId(cafe.id);
  const sheet = document.getElementById('bottom-sheet');
  const content = document.getElementById('bottom-sheet-content');
  if (!sheet || !content) return;

  const logs = getLogsByCafeId(cafe.id);
  const previewLogs = logs.slice(0, 8);
  const hasLogs = logs.length > 0;

  content.innerHTML = `
    <div class="place-details place-details-clickable" role="button" tabindex="0" aria-label="View location page">
      <div class="place-details-photo" aria-hidden="true"></div>
      <div class="place-details-meta">
        <div class="place-details-title-row">
          <h2>${escapeHtml(cafe.name)}</h2>
          <button type="button" class="place-details-heart-btn" id="place-details-heart" aria-label="Heart this location">${getHeartIconSvg(false)}</button>
          <span class="place-details-heart-count" id="place-details-heart-count"></span>
        </div>
        <p class="address">${escapeHtml(cafe.address || '')}</p>
        <div class="place-details-google" aria-live="polite"></div>
      </div>
    </div>
    ${hasLogs ? `
      <div class="my-logs-strip">
        <h3>${logs.length} ${logs.length === 1 ? 'post' : 'posts'}</h3>
        <div class="my-logs-strip-row">
          ${previewLogs.map(log => `
            <button type="button" class="log-thumb-btn" data-log-id="${escapeAttr(log.id)}" aria-label="Open post">
              ${(log.photo || (log.photos && log.photos[0])) ? `<img src="${escapeAttr(log.photo || log.photos[0])}" alt="">` : '<div class="log-thumb-placeholder"></div>'}
            </button>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;

  const photoEl = content.querySelector('.place-details-photo');
  const googleEl = content.querySelector('.place-details-google');

  const applyDetails = (details) => {
    if (selectedCafe !== cafe || !content.contains(photoEl)) return;
    if (details?.photoUrl && photoEl) {
      photoEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = details.photoUrl;
      img.alt = '';
      photoEl.appendChild(img);
    }
    if (googleEl) {
      const reviewParts = [];
      if (details?.rating != null) reviewParts.push(`${details.rating}★`);
      if (details?.userRatingCount != null) reviewParts.push(`(${details.userRatingCount} reviews)`);
      const reviewLine = reviewParts.join(' · ');
      googleEl.innerHTML = '';
      if (reviewLine) {
        const reviewSpan = document.createElement('span');
        reviewSpan.className = 'place-details-reviews';
        reviewSpan.textContent = reviewLine;
        googleEl.appendChild(reviewSpan);
      }
      if (details?.openStatus) {
        const openSpan = document.createElement('span');
        openSpan.className = 'place-details-open';
        openSpan.textContent = details.openStatus;
        googleEl.appendChild(openSpan);
      }
    }
  };

  const hasStoredDetails = cafe.photoUrl != null || cafe.rating != null || cafe.openStatus != null;
  if (hasStoredDetails) {
    applyDetails({
      photoUrl: cafe.photoUrl,
      rating: cafe.rating,
      userRatingCount: cafe.userRatingCount,
      openStatus: cafe.openStatus,
    });
  }
  if (cafe.placeId && (photoEl || googleEl) && !hasStoredDetails) {
    const existing = getCafeByPlaceId(cafe.placeId);
    const isMatchaCafe = existing && (existing.classification === 'matcha_cafe' || existing.classification === 'cafe_specialty_matcha');
    const shouldPersist = !!existing && isMatchaCafe;
    fetchPlaceDetails(cafe.placeId, false, shouldPersist).then((details) => {
      applyDetails(details || {});
    }).catch(() => {});
  }

  const placeDetailsClickable = content.querySelector('.place-details-clickable');
  if (placeDetailsClickable) {
    placeDetailsClickable.addEventListener('click', (e) => {
      if (e.target.closest('.place-details-heart-btn')) return;
      hideBottomSheet();
      openLocationPage(cafe);
    });
    placeDetailsClickable.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        hideBottomSheet();
        openLocationPage(cafe);
      }
    });
  }

  const placeLikeBtn = content.querySelector('#place-details-heart');
  const placeLikeCountEl = content.querySelector('#place-details-heart-count');
  async function updatePlaceLikeUI() {
    if (!placeLikeBtn || !placeLikeCountEl || selectedCafe !== cafe) return;
    const hasLiked = hasUserLikedLocation(cafe.id);
    renderHeartIcon(placeLikeBtn, hasLiked);
    placeLikeBtn.classList.toggle('is-hearted', hasLiked);
    placeLikeBtn.setAttribute('aria-label', hasLiked ? 'Unheart this location' : 'Heart this location');
    const count = await getLocationLikeCount(cafe.id);
    placeLikeCountEl.textContent = count > 0 ? count : '';
  }
  if (placeLikeBtn) {
    placeLikeBtn.addEventListener('click', () => {
      const hasLiked = hasUserLikedLocation(cafe.id);
      setLocationLike(cafe.id, !hasLiked);
      updatePlaceLikeUI();
      updateCuratedPins();
    });
  }
  updatePlaceLikeUI();

  content.querySelectorAll('.log-thumb-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const logId = btn.getAttribute('data-log-id');
      const log = getLogs().find((l) => String(l.id) === String(logId));
      if (log) openLogDetail(log);
    });
  });

  sheet.classList.remove('closed');
  sheet.setAttribute('aria-hidden', 'false');
}

function hideBottomSheet() {
  const sheet = document.getElementById('bottom-sheet');
  if (sheet) {
    sheet.classList.add('closed');
    sheet.setAttribute('aria-hidden', 'true');
  }
  selectedCafe = null;
  setSelectedCafeId(null);
}

function showPopUpSheet(pop, brand) {
  const sheet = document.getElementById('bottom-sheet');
  const content = document.getElementById('bottom-sheet-content');
  if (!sheet || !content) return;
  selectedCafe = null;
  setSelectedCafeId(null);

  const logs = getLogsByPopupId(pop.id);
  const label = pop.name || pop.address || 'Pop-up';
  const dateStr = formatPopUpDateRange(pop.startDate, pop.endDate);

  content.innerHTML = `
    <div class="place-details">
      <div class="place-details-meta">
        <h2>${escapeHtml(label)}</h2>
        ${dateStr ? `<p class="popup-dates">${escapeHtml(dateStr)}</p>` : ''}
        ${pop.address ? `<p class="address">${escapeHtml(pop.address)}</p>` : ''}
        <div class="place-details-heart-row">
          <button type="button" class="place-details-heart-btn" id="popup-sheet-heart-brand" aria-label="Heart this brand">${getHeartIconSvg(false)}</button>
          <span class="place-details-heart-count" id="popup-sheet-heart-count"></span>
          <span class="place-details-heart-label">Heart brand</span>
        </div>
      </div>
    </div>
    <section class="popup-sheet-feed">
      <h3 class="popup-sheet-feed-heading">Posts</h3>
      <div id="popup-sheet-feed-list" class="brand-page-feed-list"></div>
    </section>
  `;

  const feedList = content.querySelector('#popup-sheet-feed-list');
  if (feedList) {
    if (logs.length === 0) {
      feedList.innerHTML = '<p class="brand-page-empty-state">No posts yet.</p>';
    } else {
      logs.forEach((log) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'brand-page-feed-item log-item log-item-btn';
        const photo = log.photo || (log.photos && log.photos[0]);
        const thumb = photo ? `<img src="${escapeAttr(photo)}" alt="">` : '<div class="log-item-placeholder"></div>';
        btn.innerHTML = `${thumb}<div class="log-info"><span class="drink">${escapeHtml(getDrinkSummary(log))}</span><span class="meta">${formatDate(log.createdAt)}</span></div>`;
        btn.addEventListener('click', () => {
          const l = getLogs().find((x) => String(x.id) === String(log.id));
          if (l) openLogDetail(l);
        });
        feedList.appendChild(btn);
      });
    }
  }

  const likeBtn = content.querySelector('#popup-sheet-heart-brand');
  const likeCountEl = content.querySelector('#popup-sheet-heart-count');
  async function updatePopupSheetLikeUI() {
    if (!likeBtn || !likeCountEl) return;
    const hasLiked = hasUserLikedBrand(brand.id);
    renderHeartIcon(likeBtn, hasLiked);
    likeBtn.classList.toggle('is-hearted', hasLiked);
    likeBtn.setAttribute('aria-label', hasLiked ? 'Unheart this brand' : 'Heart this brand');
    const total = await getBrandTotalLikeCount(brand);
    likeCountEl.textContent = total > 0 ? total : '';
  }
  if (likeBtn) {
    likeBtn.addEventListener('click', () => {
      const hasLiked = hasUserLikedBrand(brand.id);
      setBrandLike(brand.id, !hasLiked);
      updatePopupSheetLikeUI();
    });
  }
  updatePopupSheetLikeUI();

  sheet.classList.remove('closed');
  sheet.setAttribute('aria-hidden', 'false');
}

function openLogDetail(log) {
  const page = document.getElementById('post-page');
  const content = document.getElementById('post-page-content');
  if (!page || !content) return;

  const locationPage = document.getElementById('location-page');
  const brandPage = document.getElementById('brand-page');
  const locationVisible = locationPage && !locationPage.classList.contains('hidden');
  const brandVisible = brandPage && !brandPage.classList.contains('hidden');
  const activePanel = PANEL_IDS.find((id) => document.getElementById(id)?.classList.contains('is-active')) || 'panel-feed';
  postPageReturnState = {
    locationVisible,
    brandVisible,
    activePanel,
  };

  if (locationVisible) locationPage.classList.add('hidden');
  if (brandVisible) brandPage.classList.add('hidden');

  const drinks = getLogDrinks(log);
  const brand = escapeHtml(log.visit?.brandName || log.brandName || log.cafe?.name || 'Unknown place');
  const place = escapeHtml(log.visit?.location?.address || log.cafe?.address || 'No address');
  const date = escapeHtml(formatDate(log.createdAt));
  const caption = escapeHtml(getPostNotes(log) || 'No notes yet.');
  const photo = log.photo || (log.photos && log.photos[0]) || '';
  const drinksHtml = drinks.length
    ? drinks.map((d, idx) => {
      const details = d.details || {};
      const isRecommended = details.recommended === true || details.recommend === true;
      const hasDeep = details.sweetness || details.bitterness || details.umami || (details.flavorTags && details.flavorTags.length) || details.price || isRecommended || d.notes;
      return `
        <article class="post-page-drink-item">
          <h3 class="post-page-drink-name">${isRecommended ? '♥ ' : ''}${escapeHtml(d.name || `Drink ${idx + 1}`)}</h3>
          ${d.notes ? `<p class="post-page-drink-note">${escapeHtml(d.notes)}</p>` : ''}
          ${hasDeep ? `
            <div class="post-page-drink-meta">
              ${(details.sweetness || details.bitterness || details.umami) ? `<span>S ${Number(details.sweetness) || 0} · B ${Number(details.bitterness) || 0} · U ${Number(details.umami) || 0}</span>` : ''}
              ${(details.flavorTags && details.flavorTags.length) ? `<span>${escapeHtml(details.flavorTags.join(', '))}</span>` : ''}
              ${details.price ? `<span>${escapeHtml(String(details.price))}</span>` : ''}
              ${isRecommended ? `<span>Recommended</span>` : ''}
            </div>
          ` : ''}
        </article>
      `;
    }).join('')
    : '<p class="post-page-empty">No drinks listed.</p>';

  content.innerHTML = `
    <article class="post-page-article">
      <div class="post-page-top-actions">
        <button type="button" class="post-page-round-btn" id="post-page-back-btn" aria-label="Back">‹</button>
        <button type="button" class="post-page-round-btn" id="post-page-close-btn" aria-label="Close">×</button>
      </div>
      <div class="post-page-media-wrap">
        <div class="post-page-media">
          ${photo ? `<img src="${escapeAttr(photo)}" alt="">` : '<div class="photo-feed-card__media photo-feed-card__media--empty"></div>'}
        </div>
      </div>
      <div class="post-page-body">
        <div class="post-page-meta">
          <p class="post-page-date">${date || 'Unknown date'}</p>
          ${place ? `<p class="post-page-address">${place}</p>` : ''}
        </div>
        <h1 class="post-page-title">${brand}</h1>
        <p class="post-page-quote">${caption}</p>
        <div class="post-page-drinks">
          <h2 class="post-page-drinks-title">Drinks</h2>
          ${drinksHtml}
        </div>
      </div>
    </article>
  `;

  document.getElementById('post-page-back-btn')?.addEventListener('click', closeLogDetail);
  document.getElementById('post-page-close-btn')?.addEventListener('click', closeLogDetail);
  page.classList.remove('hidden');
  page.setAttribute('aria-hidden', 'false');
}

function closeLogDetail() {
  const page = document.getElementById('post-page');
  if (page) {
    page.classList.add('hidden');
    page.setAttribute('aria-hidden', 'true');
  }
  if (!postPageReturnState) return;
  if (postPageReturnState.locationVisible) {
    const locationPage = document.getElementById('location-page');
    if (locationPage) locationPage.classList.remove('hidden');
  } else if (postPageReturnState.brandVisible) {
    const brandPage = document.getElementById('brand-page');
    if (brandPage) brandPage.classList.remove('hidden');
  } else if (postPageReturnState.activePanel) {
    setActiveTab(postPageReturnState.activePanel);
  }
  postPageReturnState = null;
}

async function openCafePicker() {
  const overlay = document.getElementById('cafe-picker-overlay');
  const panel = document.getElementById('cafe-picker-panel');
  if (!overlay || !panel) return;
  const myCafes = getMyCafes();
  const brands = await getGalleryBrands();
  const seen = new Set();
  const cafes = [];
  myCafes.forEach((c) => {
    if (c && !seen.has(c.id)) { seen.add(c.id); cafes.push(c); }
  });
  brands.forEach((b) => {
    (b.cafes || []).forEach((c) => {
      if (c && !seen.has(c.id)) { seen.add(c.id); cafes.push(c); }
    });
  });
  if (cafes.length === 0) {
    panel.innerHTML = '<h2>Share your Matcha</h2><p style="color:#666;">No brands yet. Add brands in Admin (Brands), or open a cafe from the map and use "Share your Matcha here".</p>';
  } else {
    panel.innerHTML = `
      <h2>Where did you have matcha?</h2>
      <ul class="cafe-picker-list">
        ${cafes.map((c) => `
          <li><button type="button" class="cafe-picker-item" data-cafe-id="${escapeAttr(c.id)}">
            <span class="item-name">${escapeHtml(c.name || 'Unnamed')}</span>
            ${c.address ? `<span class="item-address">${escapeHtml(c.address)}</span>` : ''}
          </button></li>
        `).join('')}
      </ul>
    `;
    panel.querySelectorAll('.cafe-picker-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-cafe-id');
        const cafe = cafes.find((c) => String(c.id) === String(id));
        if (cafe) {
          closeCafePicker();
          openLogForm(cafe, () => {
            updateCuratedPins();
            refreshPhotoFeedsIfVisible();
          });
        }
      });
    });
  }
  overlay.onclick = (e) => { if (e.target === overlay) closeCafePicker(); };
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeCafePicker() {
  const overlay = document.getElementById('cafe-picker-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

function onSearchResultClick(cafe) {
  flyTo(cafe.lat, cafe.lng);
  const alreadyInDb = getCafeByPlaceId(cafe.placeId) || getCafeById(cafe.id);
  if (alreadyInDb) {
    const saved = saveCafe(cafe);
    showBottomSheet(saved, false);
  } else {
    showBottomSheet(cafe, false);
  }
}

function onMyCafeClick(cafe) {
  flyTo(cafe.lat, cafe.lng);
  showBottomSheet(cafe, true);
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML.replace(/"/g, '&quot;');
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPostTime(ts) {
  if (!ts) return '';
  const delta = Date.now() - Number(ts);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < 7 * day) {
    if (delta < hour) return `${Math.max(1, Math.floor(delta / minute))}m ago`;
    if (delta < day) return `${Math.max(1, Math.floor(delta / hour))}h ago`;
    return `${Math.max(1, Math.floor(delta / day))}d ago`;
  }
  return formatDate(ts);
}

function compactCaption(text, max = 88) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length <= max) return raw;
  return `${raw.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

const PHOTO_FEED_EMPTY_HTML_FEED =
  '<p class="panel-placeholder" style="margin:0;padding:20px;">No posts yet. Tap + to share or open a cafe on the map and tap "Share your Matcha here".</p>';

const PHOTO_FEED_EMPTY_HTML_MY =
  '<p class="panel-placeholder" style="margin:0;padding:20px;">No posts yet. Tap + to share. Only posts you add from this app (with your account) show here—older posts may be missing a saved author.</p>';

function placeLabelFromLog(log) {
  const name = log.visit?.brandName || log.brandName || log.cafe?.name;
  const addr = log.visit?.location?.address || log.cafe?.address;
  if (name && addr) return `${name} · ${addr}`;
  if (name) return name;
  if (log.visit?.brandName || log.brandName) return log.visit?.brandName || log.brandName;
  return 'Unknown place';
}

function getLogDrinks(log) {
  if (Array.isArray(log.drinks) && log.drinks.length > 0) {
    return log.drinks.filter((d) => String(d?.name || '').trim());
  }
  const fallback = String(log.drinkName || '').trim();
  return fallback ? [{ name: fallback, notes: '', details: undefined }] : [];
}

function getPrimaryDrinkName(log) {
  const drinks = getLogDrinks(log);
  return drinks[0]?.name || 'Matcha';
}

function getDrinkSummary(log) {
  const drinks = getLogDrinks(log);
  if (drinks.length <= 1) return getPrimaryDrinkName(log);
  return `${drinks[0].name} +${drinks.length - 1} more`;
}

function getPostNotes(log) {
  return String(log.postNotes || log.notes || '').trim();
}

function placeLineForLocationPage(log, cafe) {
  const line = placeLabelFromLog(log);
  if (line !== 'Unknown place') return line;
  const bits = [cafe.name, cafe.address].filter(Boolean);
  return bits.join(' · ') || cafe.name || 'Unknown place';
}

function feedCardHeadingFromLog(log) {
  const brand = String(log.visit?.brandName || log.brandName || '').trim();
  const cafeName = String(log.visit?.location?.cafeName || log.cafe?.name || '').trim();
  const address = String(log.visit?.location?.address || log.cafe?.address || '').trim();
  const title = brand || cafeName || 'Place not set';
  return { title, subtitle: address || null };
}

function feedCardHeadings(log, options) {
  if (options.placeLabel != null) {
    const raw = String(options.placeLabel).trim();
    const idx = raw.indexOf(' · ');
    if (idx >= 0) {
      const sub = raw.slice(idx + 3).trim();
      return { title: raw.slice(0, idx), subtitle: sub || null };
    }
    return { title: raw || 'Place', subtitle: null };
  }
  return feedCardHeadingFromLog(log);
}

function feedRatingsSnippet(log) {
  const parts = [];
  if (log.orderRating > 0) parts.push(`Drink ${log.orderRating}/5`);
  if (log.cafeRating > 0) parts.push(`Spot ${log.cafeRating}/5`);
  return parts.join(' · ');
}

function getPostUiState(log) {
  const id = String(log.id);
  const existing = uiPostState.get(id);
  if (existing) return existing;
  const comments = [];
  if (getPostNotes(log)) {
    comments.push({ id: `${id}-seed`, author: 'matcha_friend', text: getPostNotes(log) });
  }
  comments.push({ id: `${id}-sample`, author: 'greenwhisk', text: `Looks good at ${log.visit?.brandName || log.brandName || log.cafe?.name || 'this spot'}!` });
  const state = {
    username: (log.userName || 'you').trim() || 'you',
    liked: false,
    likeCount: Math.max(0, Number(log.likeCount) || 0),
    comments,
  };
  uiPostState.set(id, state);
  return state;
}

function commentsPreviewText(state) {
  if (!state.comments.length) return 'No comments yet.';
  const latest = state.comments[state.comments.length - 1];
  return `${latest.author}: ${latest.text}`;
}

function openCommentsDrawer(log) {
  const overlay = document.getElementById('feed-comments-overlay');
  const panel = document.getElementById('feed-comments-panel');
  if (!overlay || !panel) return;
  const state = getPostUiState(log);
  const heading = feedCardHeadingFromLog(log);
  panel.innerHTML = `
    <div class="feed-comments-drawer-handle" aria-hidden="true"></div>
    <div class="feed-comments-drawer-header">
      <h3>${escapeHtml(heading.title)}</h3>
      <button type="button" class="feed-comments-close-btn" aria-label="Close comments">Close</button>
    </div>
    <div class="feed-comments-list">
      ${state.comments.map((c) => `
        <article class="feed-comment-item">
          <div class="feed-comment-item__head">
            <span class="feed-comment-item__author">${escapeHtml(c.author)}</span>
            <button type="button" class="feed-comment-like-btn" aria-label="Like comment">♡</button>
          </div>
          <p class="feed-comment-item__text">${escapeHtml(c.text)}</p>
        </article>
      `).join('')}
    </div>
    <form class="feed-comments-form">
      <input type="text" class="feed-comments-input" placeholder="Add a comment..." autocomplete="off">
      <button type="submit" class="feed-comments-submit">Post</button>
    </form>
  `;

  const closeBtn = panel.querySelector('.feed-comments-close-btn');
  const form = panel.querySelector('.feed-comments-form');
  const input = panel.querySelector('.feed-comments-input');
  if (closeBtn) closeBtn.addEventListener('click', closeCommentsDrawer);
  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val) return;
      state.comments.push({ id: `${log.id}-${Date.now()}`, author: 'you', text: val });
      closeCommentsDrawer();
      refreshPhotoFeedsIfVisible();
      openCommentsDrawer(log);
    });
  }
  overlay.onclick = (e) => { if (e.target === overlay) closeCommentsDrawer(); };
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeCommentsDrawer() {
  const overlay = document.getElementById('feed-comments-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

function calcFeedMediaHeight(width, ratio) {
  if (!width || width <= 0) return 0;
  return Math.round(width * (ratio < 0.8 ? 1.25 : 1));
}

function applyFeedMediaHeight(root, mediaEl, ratioHint = 1) {
  const wrap = root?.querySelector('.photo-feed-card__media-wrap');
  if (!wrap) return;
  const width = wrap.clientWidth || root.clientWidth || 0;
  if (!width) return;
  const height = calcFeedMediaHeight(width, ratioHint);
  if (height > 0) wrap.style.height = `${height}px`;
}

function resizeVisibleFeedMedia() {
  document.querySelectorAll('.photo-feed-card').forEach((card) => {
    const mediaEl = card.querySelector('[data-role="feed-media"]');
    if (mediaEl && mediaEl instanceof HTMLImageElement && mediaEl.naturalWidth && mediaEl.naturalHeight) {
      applyFeedMediaHeight(card, mediaEl, mediaEl.naturalWidth / mediaEl.naturalHeight);
    } else {
      applyFeedMediaHeight(card, mediaEl, 1);
    }
  });
}

/** Instagram-style card: inline social card, no full-post open on card tap. */
function createPhotoFeedCard(log, options = {}) {
  const { title, subtitle } = feedCardHeadings(log, options);
  const disableOpenDetail = options.disableOpenDetail === true;
  const drink = getDrinkSummary(log);
  const photo = log.photo || (log.photos && log.photos[0]);
  const media = photo
    ? `<img class="photo-feed-card__media" src="${escapeAttr(photo)}" alt="" loading="lazy" data-role="feed-media">`
    : '<div class="photo-feed-card__media photo-feed-card__media--empty" aria-hidden="true"></div>';
  const state = getPostUiState(log);
  const username = state.username || 'you';
  const notesRaw = getPostNotes(log);
  const captionText = notesRaw || 'No caption yet';
  const timeText = formatPostTime(log.createdAt);
  const iso = log.createdAt ? new Date(log.createdAt).toISOString() : '';
  const timeHtml = timeText ? `<time class="feed-card__time" datetime="${escapeAttr(iso)}">${escapeHtml(timeText)}</time>` : '';
  const likeIcon = state.liked ? '♥' : '♡';
  const commentsCount = state.comments.length;

  const root = document.createElement('article');
  root.className = 'photo-feed-card';
  root.setAttribute('aria-label', `${title}. ${username}. Ordered ${drink}.`);
  root.innerHTML = `
    <header class="feed-card__header">
      <div class="feed-card__avatar" aria-hidden="true"></div>
      <div class="feed-card__meta-top">
        <span class="feed-card__username">${escapeHtml(username)} <span class="feed-card__at">at</span> <span class="feed-card__place-name">${escapeHtml(title || 'Unknown store')}</span></span>
        ${subtitle ? `<span class="feed-card__address">${escapeHtml(subtitle)}</span>` : ''}
      </div>
      ${timeHtml}
    </header>
    <div class="photo-feed-card__media-wrap">
      ${media}
    </div>
    <div class="feed-card__body">
      <div class="feed-card__actions">
        <button type="button" class="feed-card__action-btn feed-card__like-btn" aria-label="Like post">${likeIcon} <span>${state.likeCount}</span></button>
        <button type="button" class="feed-card__action-btn feed-card__comments-btn" aria-label="View comments">💬 <span>${commentsCount}</span></button>
      </div>
      <p class="feed-card__ordered"><span class="feed-card__label">Ordered:</span> ${escapeHtml(drink)}</p>
      <p class="feed-card__caption-line ${notesRaw ? '' : 'feed-card__caption-line--placeholder'}"><span class="feed-card__caption-user">${escapeHtml(username)}:</span> ${escapeHtml(captionText)}</p>
    </div>
  `;

  const mediaEl = root.querySelector('[data-role="feed-media"]');
  applyFeedMediaHeight(root, mediaEl, 1);
  if (mediaEl && mediaEl instanceof HTMLImageElement) {
    const applyMediaHeight = () => {
      if (!mediaEl.naturalWidth || !mediaEl.naturalHeight) return;
      const ratio = mediaEl.naturalWidth / mediaEl.naturalHeight;
      applyFeedMediaHeight(root, mediaEl, ratio);
    };
    if (mediaEl.complete) applyMediaHeight();
    else mediaEl.addEventListener('load', applyMediaHeight, { once: true });
  }

  const likeBtn = root.querySelector('.feed-card__like-btn');
  const commentsBtn = root.querySelector('.feed-card__comments-btn');
  if (likeBtn) {
    likeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.liked = !state.liked;
      state.likeCount = Math.max(0, state.likeCount + (state.liked ? 1 : -1));
      refreshPhotoFeedsIfVisible();
    });
  }
  if (commentsBtn) commentsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCommentsDrawer(log);
  });
  if (!disableOpenDetail) {
    root.addEventListener('click', () => openLogDetail(log));
  }

  return root;
}

function renderPhotoFeedList(containerId, mode = 'feed') {
  const el = document.getElementById(containerId);
  if (!el) return;
  const logs = mode === 'mylogs'
    ? getLogsForCurrentUser()
    : [...getLogs()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  el.innerHTML = '';
  if (logs.length === 0) {
    el.innerHTML = mode === 'mylogs' ? PHOTO_FEED_EMPTY_HTML_MY : PHOTO_FEED_EMPTY_HTML_FEED;
    return;
  }
  logs.forEach((log) => {
    el.appendChild(createPhotoFeedCard(log));
  });
  requestAnimationFrame(() => resizeVisibleFeedMedia());
}

function refreshPhotoFeedsIfVisible() {
  if (document.getElementById('panel-feed')?.classList.contains('is-active')) {
    renderPhotoFeedList('feed-list', 'feed');
  }
  if (document.getElementById('panel-mylogs')?.classList.contains('is-active')) {
    renderPhotoFeedList('mylogs-list', 'mylogs');
  }
}

function setActiveTab(panelId) {
  const panelIndex = PANEL_IDS.indexOf(panelId);
  if (panelIndex === -1) return;
  if (panelId !== 'panel-map') {
    hideBottomSheet();
    closeLocationPage();
  }
  TAB_IDS.forEach((id, i) => {
    const tab = document.getElementById(id);
    const panel = document.getElementById(PANEL_IDS[i]);
    if (tab) {
      tab.classList.toggle('is-active', i === panelIndex);
      tab.setAttribute('aria-selected', i === panelIndex ? 'true' : 'false');
    }
    if (panel) {
      panel.classList.toggle('is-active', i === panelIndex);
    }
  });
  if (panelId === 'panel-map') {
    setTimeout(() => {
      const map = getMap();
      if (map && typeof google !== 'undefined' && google.maps?.event) google.maps.event.trigger(map, 'resize');
    }, 50);
  }
  if (panelId === 'panel-brands') renderBrandsGallery();
  if (panelId === 'panel-feed' || panelId === 'panel-mylogs') refreshPhotoFeedsIfVisible();
}

let brandsFilter = 'all';

async function renderBrandsGallery() {
  const el = document.getElementById('brands-gallery');
  if (!el) return;
  el.innerHTML = '<p class="panel-placeholder" style="margin:20px;">Loading…</p>';
  let brands = await getGalleryBrands();
  if (brandsFilter === 'cafe') brands = brands.filter((b) => (b.cafes || []).length > 0);
  else if (brandsFilter === 'popup') brands = brands.filter((b) => !(b.cafes || []).length);
  el.innerHTML = '';
  if (brands.length === 0) {
    el.innerHTML = '<p class="panel-placeholder" style="margin:0;padding:20px;">No brands in gallery. Add and order brands in Admin (Brands).</p>';
    return;
  }
  for (const brand of brands) {
    const firstCafe = brand.cafes && brand.cafes[0];
    const hasLocations = firstCafe != null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'brands-gallery-card';
    btn.innerHTML = `
      <div class="card-image-wrap">
        <img class="card-image" alt="" data-place-id="${firstCafe?.placeId ? escapeAttr(firstCafe.placeId) : ''}">
      </div>
      <span class="card-name">${escapeHtml(brand.name || 'Unnamed')}</span>
    `;
    btn.addEventListener('click', () => openBrandPage(brand));
    el.appendChild(btn);
    const img = btn.querySelector('.card-image');
    if (firstCafe?.photoUrl && img) {
      img.src = firstCafe.photoUrl;
    } else if (firstCafe?.placeId) {
      const persistDetails = firstCafe.classification === 'matcha_cafe' || firstCafe.classification === 'cafe_specialty_matcha';
      fetchPlaceDetails(firstCafe.placeId, false, persistDetails).then((details) => {
        if (img && details?.photoUrl) img.src = details.photoUrl;
      }).catch(() => {});
    }
  }
}

function closeBrandPage() {
  const gallery = document.getElementById('brands-gallery');
  const filterBar = document.getElementById('brands-filter-bar');
  const page = document.getElementById('brand-page');
  if (gallery) gallery.classList.remove('hidden');
  if (filterBar) filterBar.classList.remove('hidden');
  if (page) {
    page.classList.add('hidden');
    page.setAttribute('aria-hidden', 'true');
  }
}

let locationPageCafe = null;

function closeLocationPage() {
  const mapPanel = document.getElementById('panel-map');
  const mapEl = document.getElementById('map');
  const searchBar = mapPanel?.querySelector('.search-bar');
  const recenterBtn = document.getElementById('map-recenter-btn');
  const page = document.getElementById('location-page');
  if (mapEl) mapEl.classList.remove('hidden');
  if (searchBar) searchBar.classList.remove('hidden');
  if (recenterBtn) recenterBtn.classList.add('hidden');
  if (page) {
    page.classList.add('hidden');
    page.setAttribute('aria-hidden', 'true');
  }
  locationPageCafe = null;
  updateRecenterButtonVisibility();
}

function openLocationPage(cafe) {
  if (!cafe) return;
  const mapPanel = document.getElementById('panel-map');
  const mapEl = document.getElementById('map');
  const searchBar = mapPanel?.querySelector('.search-bar');
  const recenterBtn = document.getElementById('map-recenter-btn');
  const page = document.getElementById('location-page');
  const backBtn = document.getElementById('location-page-back');
  const nameEl = document.getElementById('location-page-name');
  const imageEl = document.getElementById('location-page-image');
  const heroPlaceholder = document.getElementById('location-page-hero-placeholder');
  const addressEl = document.getElementById('location-page-address');
  const feedEl = document.getElementById('location-page-feed');
  const postBtn = document.getElementById('location-page-post-matcha');
  const likeBtn = document.getElementById('location-page-heart');
  const likeCountEl = document.getElementById('location-page-heart-count');
  if (!page || !nameEl || !feedEl) return;
  locationPageCafe = cafe;
  if (mapEl) mapEl.classList.add('hidden');
  if (searchBar) searchBar.classList.add('hidden');
  if (recenterBtn) recenterBtn.classList.add('hidden');
  page.classList.remove('hidden');
  page.setAttribute('aria-hidden', 'false');
  nameEl.textContent = cafe.name || 'Unnamed';
  if (addressEl) addressEl.textContent = cafe.address || '';
  if (imageEl && heroPlaceholder) {
    if (cafe.photoUrl) {
      imageEl.src = cafe.photoUrl;
      imageEl.alt = '';
      imageEl.classList.remove('hidden');
      heroPlaceholder.classList.add('hidden');
    } else {
      imageEl.removeAttribute('src');
      imageEl.alt = '';
      imageEl.classList.add('hidden');
      heroPlaceholder.classList.remove('hidden');
    }
  }
  if (!cafe.photoUrl && cafe.placeId && imageEl && heroPlaceholder) {
    const existing = getCafeByPlaceId(cafe.placeId);
    const isMatchaCafe = existing && (existing.classification === 'matcha_cafe' || existing.classification === 'cafe_specialty_matcha');
    const shouldPersist = !!existing && isMatchaCafe;
    fetchPlaceDetails(cafe.placeId, false, shouldPersist).then((details) => {
      if (locationPageCafe !== cafe || !details?.photoUrl || !imageEl || !heroPlaceholder) return;
      imageEl.src = details.photoUrl;
      imageEl.alt = '';
      imageEl.classList.remove('hidden');
      heroPlaceholder.classList.add('hidden');
    }).catch(() => {});
  }
  const logs = getLogsByCafeId(cafe.id);
  feedEl.innerHTML = '';
  if (logs.length === 0) {
    feedEl.innerHTML = '<p class="brand-page-empty-state">No posts yet.</p>';
  } else {
    logs.forEach((log) => {
      feedEl.appendChild(createPhotoFeedCard(log, { placeLabel: placeLineForLocationPage(log, cafe) }));
    });
  }
  async function updateLocationPageLikeUI() {
    if (!likeBtn || !likeCountEl || locationPageCafe !== cafe) return;
    const hasLiked = hasUserLikedLocation(cafe.id);
    renderHeartIcon(likeBtn, hasLiked);
    likeBtn.classList.toggle('is-hearted', hasLiked);
    likeBtn.setAttribute('aria-label', hasLiked ? 'Unheart this location' : 'Heart this location');
    const count = await getLocationLikeCount(cafe.id);
    likeCountEl.textContent = count > 0 ? count : '';
  }
  if (likeBtn) {
    likeBtn.onclick = () => {
      const hasLiked = hasUserLikedLocation(cafe.id);
      setLocationLike(cafe.id, !hasLiked);
      updateLocationPageLikeUI();
      updateCuratedPins();
    };
    updateLocationPageLikeUI();
  }
  if (backBtn) backBtn.onclick = () => closeLocationPage();
  if (postBtn) {
    postBtn.onclick = () => {
      getGalleryBrands().then((brands) => {
        const brand = brands.find((b) => (b.cafes || []).some((c) => String(c.id) === String(cafe.id)));
        openLogForm(cafe, () => {
          closeLocationPage();
          updateCuratedPins();
          refreshPhotoFeedsIfVisible();
          const saved = saveCafe(cafe);
          showBottomSheet(saved, false);
        }, brand ? { brand, brandId: brand.id, brandName: brand.name } : {});
      });
    };
  }
}

function formatPopUpDateRange(startDate, endDate) {
  if (!startDate && !endDate) return '';
  const format = (s) => {
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const start = format(startDate);
  const end = format(endDate);
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

/** Sort pop-ups for display: ongoing first (soonest end date higher), then not yet started (soonest start date first), then ended. */
function sortPopUpsByDisplayOrder(popUps) {
  if (!popUps?.length) return popUps || [];
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const ongoing = popUps.filter((p) => {
    const start = p.startDate || '';
    const end = p.endDate || '';
    if (start > todayStr) return false;
    if (end && end < todayStr) return false;
    return true;
  });
  const notStarted = popUps.filter((p) => (p.startDate || '') > todayStr);
  const ended = popUps.filter((p) => {
    const end = p.endDate || '';
    return end && end < todayStr;
  });
  const bySoonestEnd = (a, b) => (a.endDate || '9999-12-31').localeCompare(b.endDate || '9999-12-31');
  const bySoonestStart = (a, b) => (a.startDate || '').localeCompare(b.startDate || '');
  const byEndDateDesc = (a, b) => (b.endDate || '').localeCompare(a.endDate || '');
  return [...ongoing.sort(bySoonestEnd), ...notStarted.sort(bySoonestStart), ...ended.sort(byEndDateDesc)];
}

function renderBrandPagePopUps(popupsEl, popUps, onPopUpClick, onEditClick, onPostMatcha) {
  if (!popupsEl) return;
  popupsEl.innerHTML = '';
  popUps.forEach((pop) => {
    const li = document.createElement('li');
    li.className = 'brand-page-popup-item';
    const wrap = document.createElement('div');
    wrap.className = 'brand-page-popup-item-inner';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'brand-page-popup-item-btn';
    const label = pop.name || pop.address || 'Pop-up';
    const dateStr = formatPopUpDateRange(pop.startDate, pop.endDate);
    btn.innerHTML = dateStr
      ? `<span class="brand-page-popup-label">${escapeHtml(label)}</span><span class="brand-page-popup-dates">${escapeHtml(dateStr)}</span>`
      : escapeHtml(label);
    btn.addEventListener('click', () => onPopUpClick(pop));
    wrap.appendChild(btn);
    if (onEditClick) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'brand-page-popup-edit-btn';
      editBtn.setAttribute('aria-label', 'Edit pop-up');
      editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        onEditClick(pop);
      });
      wrap.appendChild(editBtn);
    }
    if (onPostMatcha) {
      const postBtn = document.createElement('button');
      postBtn.type = 'button';
      postBtn.className = 'brand-page-popup-post-icon-btn';
      postBtn.setAttribute('aria-label', 'Share your Matcha at this pop-up');
      postBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      postBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        onPostMatcha(pop);
      });
      wrap.appendChild(postBtn);
    }
    li.appendChild(wrap);
    popupsEl.appendChild(li);
  });
}

function openBrandPage(brand) {
  const gallery = document.getElementById('brands-gallery');
  const page = document.getElementById('brand-page');
  const backBtn = document.getElementById('brand-page-back');
  const nameEl = document.getElementById('brand-page-name');
  const imageEl = document.getElementById('brand-page-image');
  const noLocationEl = document.getElementById('brand-page-no-location');
  const branchesEl = document.getElementById('brand-page-branches');
  const popupsEl = document.getElementById('brand-page-popups');
  const addPopupBtn = document.getElementById('brand-page-add-popup');
  const postMatchaBtn = document.getElementById('brand-page-post-matcha');
  if (!page || !nameEl || !branchesEl) return;
  const filterBar = document.getElementById('brands-filter-bar');
  if (gallery) gallery.classList.add('hidden');
  if (filterBar) filterBar.classList.add('hidden');
  page.classList.remove('hidden');
  page.setAttribute('aria-hidden', 'false');
  const cafes = brand.cafes || [];
  const hasLocations = cafes.length > 0;
  nameEl.textContent = brand.name || 'Unnamed';
  if (noLocationEl) {
    noLocationEl.classList.toggle('hidden', hasLocations);
  }
  if (imageEl) {
    const firstCafe = cafes[0];
    if (firstCafe?.photoUrl) {
      imageEl.src = firstCafe.photoUrl;
      imageEl.alt = '';
    } else if (firstCafe?.placeId) {
      imageEl.src = '';
      imageEl.alt = '';
      const persistDetails = firstCafe.classification === 'matcha_cafe' || firstCafe.classification === 'cafe_specialty_matcha';
      fetchPlaceDetails(firstCafe.placeId, false, persistDetails).then((d) => {
        if (d?.photoUrl) {
          imageEl.src = d.photoUrl;
          imageEl.alt = '';
        }
      }).catch(() => {});
    } else {
      imageEl.src = '';
      imageEl.alt = '';
    }
    imageEl.classList.toggle('hidden', !hasLocations);
  }
  branchesEl.innerHTML = '';
  const onCloseBrandAndRefresh = () => {
    closeBrandPage();
    updateCuratedPins();
    refreshPhotoFeedsIfVisible();
  };
  if (hasLocations) {
    cafes.forEach((cafe) => {
      const li = document.createElement('li');
      const wrap = document.createElement('div');
      wrap.className = 'brand-page-branch-item-wrap';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'brand-page-branch-item';
      const name = cafe.name || cafe.id || 'Unnamed';
      const address = cafe.address || '';
      btn.innerHTML = address
        ? `<span class="brand-page-branch-name">${escapeHtml(name)}</span><span class="brand-page-branch-address">${escapeHtml(address)}</span>`
        : escapeHtml(name);
      btn.addEventListener('click', () => {
        setActiveTab('panel-map');
        if (cafe.lat != null && cafe.lng != null) flyTo(cafe.lat, cafe.lng);
        const saved = saveCafe(cafe);
        showBottomSheet(saved, false);
        closeBrandPage();
      });
      wrap.appendChild(btn);
      const postBtn = document.createElement('button');
      postBtn.type = 'button';
      postBtn.className = 'brand-page-branch-post-icon-btn';
      postBtn.setAttribute('aria-label', 'Share your Matcha at this location');
      postBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      postBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openLogForm(cafe, onCloseBrandAndRefresh, { brand, brandId: brand.id, brandName: brand.name });
      });
      wrap.appendChild(postBtn);
      li.appendChild(wrap);
      branchesEl.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.className = 'brand-page-empty-state';
    li.textContent = 'No permanent locations';
    branchesEl.appendChild(li);
  }
  const onPopUpClick = (pop) => {
    showPopUpSheet(pop, brand);
  };
  const refreshPopUps = () => getPopUpsByBrandId(brand.id).then((p) => renderBrandPagePopUps(popupsEl, sortPopUpsByDisplayOrder(p), onPopUpClick, (pop) => openEditPopUpModal(pop, brand.id, refreshPopUps), (pop) => {
    openLogForm(null, onCloseBrandAndRefresh, { brand, brandId: brand.id, brandName: brand.name, popUp: pop, popupId: pop.id });
  }));
  getPopUpsByBrandId(brand.id).then((popUps) => renderBrandPagePopUps(popupsEl, sortPopUpsByDisplayOrder(popUps), onPopUpClick, (pop) => openEditPopUpModal(pop, brand.id, refreshPopUps), (pop) => {
    openLogForm(null, onCloseBrandAndRefresh, { brand, brandId: brand.id, brandName: brand.name, popUp: pop, popupId: pop.id });
  }));
  if (addPopupBtn) {
    addPopupBtn.onclick = () => openAddPopUpModal(brand.id, refreshPopUps);
  }
  if (postMatchaBtn) {
    postMatchaBtn.onclick = () => openLogForm(null, onCloseBrandAndRefresh, { brand, brandId: brand.id, brandName: brand.name });
  }
  if (backBtn) {
    backBtn.onclick = () => closeBrandPage();
  }

  const feedEl = document.getElementById('brand-page-feed');
  const likeBtn = document.getElementById('brand-page-heart');
  const likeCountEl = document.getElementById('brand-page-heart-count');
  async function renderBrandFeed() {
    if (!feedEl) return;
    const logs = await getLogsForBrand(brand);
    feedEl.innerHTML = '';
    if (logs.length === 0) {
      feedEl.innerHTML = '<p class="brand-page-empty-state">No posts yet.</p>';
      return;
    }
    logs.forEach((log) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'brand-page-feed-item log-item log-item-btn';
      const photo = log.photo || (log.photos && log.photos[0]);
      const thumb = photo ? `<img src="${escapeAttr(photo)}" alt="">` : '<div class="log-item-placeholder"></div>';
      const drink = escapeHtml(getDrinkSummary(log));
      const meta = formatDate(log.createdAt);
      btn.innerHTML = `${thumb}<div class="log-info"><span class="drink">${drink}</span><span class="meta">${meta}</span></div>`;
      btn.dataset.logId = log.id;
      btn.addEventListener('click', () => {
        const l = getLogs().find((x) => String(x.id) === String(log.id));
        if (l) openLogDetail(l);
      });
      feedEl.appendChild(btn);
    });
  }
  async function updateBrandLikeUI() {
    if (!likeBtn || !likeCountEl) return;
    const hasLiked = hasUserLikedBrand(brand.id);
    renderHeartIcon(likeBtn, hasLiked);
    likeBtn.classList.toggle('is-hearted', hasLiked);
    likeBtn.setAttribute('aria-label', hasLiked ? 'Unheart this brand' : 'Heart this brand');
    const total = await getBrandTotalLikeCount(brand);
    likeCountEl.textContent = total > 0 ? total : '';
  }
  if (likeBtn) {
    likeBtn.addEventListener('click', () => {
      const hasLiked = hasUserLikedBrand(brand.id);
      setBrandLike(brand.id, !hasLiked);
      updateBrandLikeUI();
    });
  }
  renderBrandFeed();
  updateBrandLikeUI();
}

let addPopUpModalBrandId = null;
let addPopUpModalOnSuccess = null;
let addPopUpSelectedPlace = null;
let addPopUpSearchDebounce = null;
let addPopUpStartDateStr = null;
let addPopUpEndDateStr = null;
let addPopUpCalendarYear = new Date().getFullYear();
let addPopUpCalendarMonth = new Date().getMonth();
let editingPopUp = null;

function toDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function renderAddPopUpCalendar(container) {
  if (!container) return;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const year = addPopUpCalendarYear;
  const month = addPopUpCalendarMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  container.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'add-popup-calendar-header';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'add-popup-calendar-nav';
  prevBtn.setAttribute('aria-label', 'Previous month');
  prevBtn.textContent = '←';
  prevBtn.addEventListener('click', () => {
    if (addPopUpCalendarMonth === 0) {
      addPopUpCalendarMonth = 11;
      addPopUpCalendarYear -= 1;
    } else {
      addPopUpCalendarMonth -= 1;
    }
    renderAddPopUpCalendar(container);
  });
  const title = document.createElement('span');
  title.className = 'add-popup-calendar-title';
  title.textContent = `${monthNames[month]} ${year}`;
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'add-popup-calendar-nav';
  nextBtn.setAttribute('aria-label', 'Next month');
  nextBtn.textContent = '→';
  nextBtn.addEventListener('click', () => {
    if (addPopUpCalendarMonth === 11) {
      addPopUpCalendarMonth = 0;
      addPopUpCalendarYear += 1;
    } else {
      addPopUpCalendarMonth += 1;
    }
    renderAddPopUpCalendar(container);
  });
  header.appendChild(prevBtn);
  header.appendChild(title);
  header.appendChild(nextBtn);
  container.appendChild(header);

  const weekRow = document.createElement('div');
  weekRow.className = 'add-popup-calendar-weekdays';
  weekdays.forEach((d) => {
    const cell = document.createElement('span');
    cell.className = 'add-popup-calendar-weekday';
    cell.textContent = d;
    weekRow.appendChild(cell);
  });
  container.appendChild(weekRow);

  const grid = document.createElement('div');
  grid.className = 'add-popup-calendar-grid';
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('span');
    empty.className = 'add-popup-calendar-day add-popup-calendar-day--empty';
    grid.appendChild(empty);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = toDateStr(year, month, day);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'add-popup-calendar-day';
    cell.textContent = day;
    cell.dataset.date = dateStr;
    const isStart = addPopUpStartDateStr === dateStr;
    const isEnd = addPopUpEndDateStr === dateStr;
    const startTs = addPopUpStartDateStr ? new Date(addPopUpStartDateStr).getTime() : null;
    const endTs = addPopUpEndDateStr ? new Date(addPopUpEndDateStr).getTime() : null;
    const thisTs = new Date(year, month, day).getTime();
    const inRange = startTs && endTs && thisTs >= startTs && thisTs <= endTs;
    if (isStart) cell.classList.add('add-popup-calendar-day--start');
    if (isEnd) cell.classList.add('add-popup-calendar-day--end');
    if (inRange && !isStart && !isEnd) cell.classList.add('add-popup-calendar-day--range');
    cell.addEventListener('click', () => {
      if (!addPopUpStartDateStr) {
        addPopUpStartDateStr = dateStr;
      } else if (!addPopUpEndDateStr) {
        if (dateStr < addPopUpStartDateStr) {
          addPopUpEndDateStr = addPopUpStartDateStr;
          addPopUpStartDateStr = dateStr;
        } else {
          addPopUpEndDateStr = dateStr;
        }
      } else {
        addPopUpStartDateStr = dateStr;
        addPopUpEndDateStr = null;
      }
      renderAddPopUpCalendar(container);
    });
    grid.appendChild(cell);
  }
  container.appendChild(grid);

  if (addPopUpStartDateStr || addPopUpEndDateStr) {
    const summary = document.createElement('div');
    summary.className = 'add-popup-calendar-summary';
    summary.textContent = addPopUpEndDateStr
      ? `${addPopUpStartDateStr} – ${addPopUpEndDateStr}`
      : addPopUpStartDateStr;
    container.appendChild(summary);
  }
}

function openAddPopUpModal(brandId, onSuccess) {
  editingPopUp = null;
  addPopUpModalBrandId = brandId;
  addPopUpModalOnSuccess = onSuccess || null;
  addPopUpSelectedPlace = null;
  addPopUpStartDateStr = null;
  addPopUpEndDateStr = null;
  const now = new Date();
  addPopUpCalendarYear = now.getFullYear();
  addPopUpCalendarMonth = now.getMonth();
  const modal = document.getElementById('add-popup-modal');
  const titleEl = document.getElementById('add-popup-modal-title');
  const locationInput = document.getElementById('add-popup-location');
  const resultsEl = document.getElementById('add-popup-results');
  const daterangeEl = document.getElementById('add-popup-daterange');
  const deleteBtn = document.getElementById('add-popup-delete');
  const submitBtn = document.getElementById('add-popup-submit');
  if (titleEl) titleEl.textContent = 'Add pop-up';
  if (deleteBtn) {
    deleteBtn.classList.add('hidden');
    deleteBtn.setAttribute('aria-hidden', 'true');
  }
  if (submitBtn) submitBtn.textContent = 'Submit';
  if (modal) {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }
  if (locationInput) locationInput.value = '';
  if (resultsEl) {
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
  }
  renderAddPopUpCalendar(daterangeEl);
  if (locationInput) locationInput.focus();
}

function openEditPopUpModal(popUp, brandId, onSuccess) {
  editingPopUp = popUp;
  addPopUpModalBrandId = brandId;
  addPopUpModalOnSuccess = onSuccess || null;
  addPopUpSelectedPlace = (popUp.address || popUp.name || popUp.lat != null || popUp.lng != null)
    ? { name: popUp.name || null, address: popUp.address || null, lat: popUp.lat ?? null, lng: popUp.lng ?? null, placeId: popUp.placeId || null }
    : null;
  addPopUpStartDateStr = popUp.startDate || null;
  addPopUpEndDateStr = popUp.endDate || null;
  if (popUp.startDate) {
    const d = new Date(popUp.startDate);
    if (!isNaN(d.getTime())) {
      addPopUpCalendarYear = d.getFullYear();
      addPopUpCalendarMonth = d.getMonth();
    }
  } else {
    const now = new Date();
    addPopUpCalendarYear = now.getFullYear();
    addPopUpCalendarMonth = now.getMonth();
  }
  const modal = document.getElementById('add-popup-modal');
  const titleEl = document.getElementById('add-popup-modal-title');
  const locationInput = document.getElementById('add-popup-location');
  const resultsEl = document.getElementById('add-popup-results');
  const daterangeEl = document.getElementById('add-popup-daterange');
  const deleteBtn = document.getElementById('add-popup-delete');
  const submitBtn = document.getElementById('add-popup-submit');
  if (titleEl) titleEl.textContent = 'Edit pop-up';
  if (deleteBtn) {
    deleteBtn.classList.remove('hidden');
    deleteBtn.setAttribute('aria-hidden', 'false');
  }
  if (submitBtn) submitBtn.textContent = 'Save';
  if (modal) {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }
  if (locationInput) locationInput.value = addPopUpSelectedPlace ? (addPopUpSelectedPlace.address || addPopUpSelectedPlace.name || '') : '';
  if (resultsEl) {
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
  }
  renderAddPopUpCalendar(daterangeEl);
  if (locationInput) locationInput.focus();
}

function closeAddPopUpModal() {
  const modal = document.getElementById('add-popup-modal');
  const modalBox = modal?.querySelector('.add-popup-modal-box');
  const titleEl = document.getElementById('add-popup-modal-title');
  const deleteBtn = document.getElementById('add-popup-delete');
  const submitBtn = document.getElementById('add-popup-submit');
  const deleteConfirmEl = document.getElementById('add-popup-delete-confirm');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
  if (modalBox) modalBox.classList.remove('add-popup-modal-box--delete-confirm');
  if (deleteConfirmEl) {
    deleteConfirmEl.classList.add('hidden');
    deleteConfirmEl.setAttribute('aria-hidden', 'true');
  }
  if (titleEl) titleEl.textContent = 'Add pop-up';
  if (deleteBtn) {
    deleteBtn.classList.add('hidden');
    deleteBtn.setAttribute('aria-hidden', 'true');
  }
  if (submitBtn) submitBtn.textContent = 'Submit';
  addPopUpModalBrandId = null;
  addPopUpModalOnSuccess = null;
  addPopUpSelectedPlace = null;
  addPopUpStartDateStr = null;
  addPopUpEndDateStr = null;
  editingPopUp = null;
}

function initAddPopUpModal() {
  const modal = document.getElementById('add-popup-modal');
  const locationInput = document.getElementById('add-popup-location');
  const resultsEl = document.getElementById('add-popup-results');
  const submitBtn = document.getElementById('add-popup-submit');
  const cancelBtn = document.getElementById('add-popup-cancel');
  const backdrop = modal?.querySelector('.add-popup-modal-backdrop');

  if (locationInput && resultsEl) {
    locationInput.addEventListener('input', () => {
      addPopUpSelectedPlace = null;
      const q = locationInput.value.trim();
      if (addPopUpSearchDebounce) clearTimeout(addPopUpSearchDebounce);
      if (!q) {
        resultsEl.innerHTML = '';
        resultsEl.classList.add('hidden');
        return;
      }
      addPopUpSearchDebounce = setTimeout(async () => {
        try {
          const results = await searchPlaceByText(q);
          resultsEl.innerHTML = '';
          if (results.length === 0) {
            resultsEl.classList.remove('hidden');
            resultsEl.appendChild(document.createTextNode('No results'));
            return;
          }
          results.forEach((place) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'add-popup-result-item';
            btn.textContent = [place.name, place.address].filter(Boolean).join(' · ') || 'Unnamed';
            btn.addEventListener('click', () => {
              addPopUpSelectedPlace = place;
              locationInput.value = place.address || place.name || '';
              resultsEl.innerHTML = '';
              resultsEl.classList.add('hidden');
            });
            resultsEl.appendChild(btn);
          });
          resultsEl.classList.remove('hidden');
        } catch (_) {
          resultsEl.innerHTML = '';
          resultsEl.appendChild(document.createTextNode('Search failed'));
          resultsEl.classList.remove('hidden');
        }
      }, 300);
    });
  }

  function doSubmit() {
    const brandId = addPopUpModalBrandId;
    if (!brandId) return;
    const place = addPopUpSelectedPlace;
    const startVal = addPopUpStartDateStr || null;
    const endVal = addPopUpEndDateStr || null;
    const address = place ? (place.address || place.name || '') : (locationInput?.value?.trim() || '');
    const lat = place?.lat ?? null;
    const lng = place?.lng ?? null;
    const placeId = place?.placeId ?? null;
    const name = place?.name ?? null;
    if (!editingPopUp && !place && !address) {
      alert('Please search and select a location.');
      return;
    }
    if (editingPopUp) {
      updatePopUp(editingPopUp.id, { address: address || editingPopUp.address, placeId: placeId ?? editingPopUp.placeId, lat: lat ?? editingPopUp.lat, lng: lng ?? editingPopUp.lng, startDate: startVal, endDate: endVal, name: name ?? editingPopUp.name })
        .then(() => {
          const cb = addPopUpModalOnSuccess;
          closeAddPopUpModal();
          if (cb) cb();
        })
        .catch((e) => {
          console.error('[Matcha Hop] updatePopUp failed:', e);
          alert('Could not update pop-up. See console.');
        });
    } else {
      addPopUp(brandId, { address, placeId, lat, lng, startDate: startVal, endDate: endVal, name })
        .then(() => {
          const cb = addPopUpModalOnSuccess;
          closeAddPopUpModal();
          if (cb) cb();
        })
        .catch((e) => {
          console.error('[Matcha Hop] addPopUp failed:', e);
          alert('Could not add pop-up. See console.');
        });
    }
  }

  const deleteBtn = document.getElementById('add-popup-delete');
  const modalBox = modal?.querySelector('.add-popup-modal-box');
  const formEl = document.querySelector('.add-popup-form');
  const mainActionsEl = document.querySelector('.add-popup-modal-actions-main');
  const deleteConfirmEl = document.getElementById('add-popup-delete-confirm');
  const deleteConfirmCancelBtn = document.getElementById('add-popup-delete-cancel');
  const deleteConfirmBtn = document.getElementById('add-popup-delete-confirm-btn');

  function showDeleteConfirm() {
    if (modalBox) modalBox.classList.add('add-popup-modal-box--delete-confirm');
    if (deleteConfirmEl) {
      deleteConfirmEl.classList.remove('hidden');
      deleteConfirmEl.setAttribute('aria-hidden', 'false');
    }
  }

  function hideDeleteConfirm() {
    if (modalBox) modalBox.classList.remove('add-popup-modal-box--delete-confirm');
    if (deleteConfirmEl) {
      deleteConfirmEl.classList.add('hidden');
      deleteConfirmEl.setAttribute('aria-hidden', 'true');
    }
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (!editingPopUp) return;
      showDeleteConfirm();
    });
  }
  if (deleteConfirmCancelBtn) {
    deleteConfirmCancelBtn.addEventListener('click', hideDeleteConfirm);
  }
  if (deleteConfirmBtn) {
    deleteConfirmBtn.addEventListener('click', () => {
      if (!editingPopUp) return;
      deletePopUp(editingPopUp.id)
        .then(() => {
          const cb = addPopUpModalOnSuccess;
          closeAddPopUpModal();
          if (cb) cb();
        })
        .catch((e) => {
          console.error('[Matcha Hop] deletePopUp failed:', e);
          alert('Could not delete pop-up. See console.');
        });
    });
  }

  if (submitBtn) submitBtn.addEventListener('click', doSubmit);
  if (cancelBtn) cancelBtn.addEventListener('click', closeAddPopUpModal);
  if (backdrop) backdrop.addEventListener('click', closeAddPopUpModal);
}

function renderMyLogsList() {
  renderPhotoFeedList('mylogs-list', 'mylogs');
}

/** When search is active, do not repopulate Firestore pins; only show them again after clear. */
function updateCuratedPins() {
  if (currentSearchResults.length > 0) return;
  const m = getMap();
  if (!m) return;
  let bounds = m.getBounds();
  let zoom = m.getZoom();
  if (!bounds && typeof google !== 'undefined' && google.maps) {
    bounds = new google.maps.LatLngBounds(METRO_MANILA_SW, METRO_MANILA_NE);
  }
  if (zoom == null) zoom = 13;
  if (!bounds) return;
  const cafes = getCafesInBounds(bounds, zoom);
  const myCafes = getMyCafes();
  const myCafeIds = new Set(myCafes.map((c) => c.id));
  const merged = [];
  const seen = new Set();
  cafes.forEach((c) => {
    const tried = myCafeIds.has(c.id);
    merged.push({ ...c, tried, liked: hasUserLikedLocation(c.id), logged: tried });
    seen.add(c.id);
  });
  myCafes.forEach((c) => {
    if (c.lat == null || c.lng == null) return;
    const latLng = new google.maps.LatLng(c.lat, c.lng);
    if (!bounds.contains(latLng) || seen.has(c.id)) return;
    merged.push({ ...c, tried: true, liked: hasUserLikedLocation(c.id), logged: true });
    seen.add(c.id);
  });
  clearCuratedPins();
  addCuratedPins(merged, (cafe) => {
    flyTo(cafe.lat, cafe.lng);
    const saved = saveCafe(cafe);
    showBottomSheet(saved, false);
  });
}

/** Merge search results with Firestore: if a result matches an existing cafe by placeId, use the existing cafe (one pill, no duplicate). */
function mergeSearchResultsWithFirestore(results) {
  const myCafes = getMyCafes();
  const myCafeIds = new Set(myCafes.map((c) => c.id));
  const merged = [];
  const seen = new Set();
  for (const r of results) {
    const key = r.placeId || r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = getCafeByPlaceId(r.placeId);
    if (existing) {
      const tried = myCafeIds.has(existing.id);
      merged.push({ ...existing, tried, liked: hasUserLikedLocation(existing.id), logged: tried });
    } else {
      const matchedCafe = myCafes.find((c) => c.placeId && c.placeId === r.placeId);
      const tried = !!matchedCafe;
      const liked = matchedCafe ? hasUserLikedLocation(matchedCafe.id) : hasUserLikedLocation(r.id);
      merged.push({ ...r, tried, liked, logged: tried });
    }
  }
  return merged;
}

function updateSearchResultsLabel(visible) {
  const el = document.getElementById('search-results-label');
  if (el) el.classList.toggle('hidden', !visible);
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.classList.toggle('hidden', !visible);
}

/** Clear search state and show Firestore-saved cafes again. */
function clearSearchAndShowCurated() {
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  currentSearchResults = [];
  clearSearchPins();
  clearCuratedPins();
  updateCuratedPins();
  updateSearchResultsLabel(false);
}

/** Text search: show results as white pills; dedupe with Firestore; single/multiple behavior. */
async function doSearch(query) {
  const input = document.getElementById('search-input');
  currentSearchResults = [];
  clearCuratedPins();
  updateSearchResultsLabel(false);
  let results = [];
  if (query && query.trim()) {
    results = await searchQuery(query);
  }
  const merged = mergeSearchResultsWithFirestore(results);
  currentSearchResults = merged;
  if (merged.length > 0) {
    updateSearchResultsLabel(true);
    clearCuratedPins();
    addCuratedPins(merged, onSearchResultClick);
    if (merged.length === 1) {
      flyTo(merged[0].lat, merged[0].lng);
      const alreadyInDb = getCafeByPlaceId(merged[0].placeId) || getCafeById(merged[0].id);
      if (alreadyInDb) {
        const saved = saveCafe(merged[0]);
        showBottomSheet(saved, false);
      } else {
        showBottomSheet(merged[0], false);
      }
    } else {
      fitBounds(merged);
    }
  }
}

async function init() {
  await initMap('map');
  const map = getMap();
  if (map && typeof google !== 'undefined' && google.maps?.event) {
    setTimeout(() => google.maps.event.trigger(map, 'resize'), 100);
  }

  TAB_IDS.forEach((tabId, i) => {
    const tab = document.getElementById(tabId);
    if (tab) tab.addEventListener('click', () => setActiveTab(PANEL_IDS[i]));
  });

  const addBtn = document.getElementById('tab-bar-add');
  if (addBtn) {
    addBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openLogForm(null, () => {
        updateCuratedPins();
        refreshPhotoFeedsIfVisible();
      });
    });
  }

  const recenterBtn = document.getElementById('map-recenter-btn');
  if (recenterBtn) {
    recenterBtn.addEventListener('click', () => {
      recenterMapToCurrentLocation();
      setTimeout(updateRecenterButtonVisibility, 250);
    });
  }

  document.querySelectorAll('.brands-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-filter') || 'all';
      brandsFilter = filter;
      document.querySelectorAll('.brands-filter-btn').forEach((b) => {
        const isActive = b.getAttribute('data-filter') === filter;
        b.classList.toggle('is-active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      renderBrandsGallery();
    });
  });

  initAddPopUpModal();

  if (map) {
    map.addListener('click', () => {
      const sheet = document.getElementById('bottom-sheet');
      if (sheet && !sheet.classList.contains('closed')) hideBottomSheet();
    });
  }

  try {
    await initData();
  } catch (e) {
    console.warn('[Matcha Hop] initData failed:', e?.message || e);
  }
  if (map) {
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    if (bounds && zoom != null) {
      updateCuratedPins();
    } else {
      const onceIdle = () => {
        if (typeof google !== 'undefined' && google.maps?.event) {
          google.maps.event.removeListener(idleListener);
        }
        updateCuratedPins();
      };
      const idleListener = map.addListener('idle', onceIdle);
    }
  }

  let curatedDebounceTimer;
  onMoveEnd(() => {
    clearTimeout(curatedDebounceTimer);
    curatedDebounceTimer = setTimeout(updateCuratedPins, 500);
    updateRecenterButtonVisibility();
  });
  if (map) {
    map.addListener('idle', updateRecenterButtonVisibility);
  }
  updateRecenterButtonVisibility();

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const q = searchInput.value.trim();
        if (q) doSearch(q);
        else clearSearchAndShowCurated();
      }, 400);
    });
    const searchClearBtn = document.getElementById('search-clear');
    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => clearSearchAndShowCurated());
    }
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch(searchInput.value.trim());
      }
    });
  }
  window.addEventListener('resize', resizeVisibleFeedMedia);
}

export { init };
