/**
 * Google Maps: full-screen map, markers for search and "my cafes", idle callback.
 */

import { incrementApiCall } from './debug-api.js';

let map = null;
let placesService = null;
let myCafeMarkers = [];
let curatedOverlays = [];
let popUpMarkers = [];
let eventOverlays = [];
let selectedCafeId = null;
let selectedEventId = null;
let mapBackgroundClickHandler = null;
let overlayClickSuppressUntil = 0;

function markOverlayClick() {
  overlayClickSuppressUntil = Date.now() + 80;
}

function bindOverlayClickHandler(el, onClick) {
  if (!el || typeof onClick !== 'function') return;
  el.addEventListener('click', (e) => {
    if (e?.stopPropagation) e.stopPropagation();
    markOverlayClick();
    onClick();
  });
}

export function shouldSkipMapBackgroundClick() {
  return Date.now() < overlayClickSuppressUntil;
}

function ensureMapBackgroundClickListener() {
  if (!map || map._matchaHopBackgroundClickBound) return;
  map._matchaHopBackgroundClickBound = true;
  map.addListener('click', () => {
    if (Date.now() < overlayClickSuppressUntil) return;
    if (mapBackgroundClickHandler) mapBackgroundClickHandler();
  });
}

export function setMapBackgroundClickHandler(fn) {
  mapBackgroundClickHandler = typeof fn === 'function' ? fn : null;
  ensureMapBackgroundClickListener();
}

/** Metro Manila default when geolocation and saved viewport are unavailable (v2 aligns via bootstrap). */
export const DEFAULT_CENTER = { lat: 14.5876, lng: 121.0609 };
export const DEFAULT_ZOOM = 15;

const BASE_STYLES = [
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#eef2ee' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#fafafa' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ebebeb' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#ebebeb' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e2e2e2' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#e2e2e2' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#f0f2f0' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#e8ebe8' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 1 }] },
];

const LABELS_ZOOMED_OUT = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'labels', stylers: [{ visibility: 'on' }] },
  { featureType: 'road.arterial', elementType: 'labels', stylers: [{ visibility: 'on' }] },
];

const LABELS_ZOOMED_IN = [
  { featureType: 'poi', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.business.food_and_drink', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business.food_and_drink', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'on' }] },
];

const LABELS_ZOOM_THRESHOLD = 16;

// Apply last so they override any "labels on" rules. Recolor POI icons to grey so names stay visible.
// If POI icons stay colorful, remove the poi labels.icon rule; JS API may not allow icon-off-text-on.
const OVERRIDE_HIDE = [
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ color: '#9e9e9e' }] },
];

function getMapStylesForZoom(zoom) {
  const labels = zoom >= LABELS_ZOOM_THRESHOLD ? LABELS_ZOOMED_IN : LABELS_ZOOMED_OUT;
  return [...BASE_STYLES, ...labels, ...OVERRIDE_HIDE];
}

export function initMap(containerId, options = {}) {
  const el = document.getElementById(containerId);
  if (!el || typeof google === 'undefined' || !google.maps) return null;

  const ic = options.initialCenter;
  const hasIc = ic && typeof ic.lat === 'number' && typeof ic.lng === 'number';
  const center = hasIc ? { lat: ic.lat, lng: ic.lng } : DEFAULT_CENTER;
  const initialZoom = typeof options.initialZoom === 'number' && Number.isFinite(options.initialZoom)
    ? options.initialZoom
    : DEFAULT_ZOOM;
  const forAdmin = options.forAdmin === true;
  map = new google.maps.Map(el, {
    center,
    zoom: initialZoom,
    styles: getMapStylesForZoom(initialZoom),
    disableDefaultUI: !forAdmin,
    mapTypeControl: false,
    zoomControl: forAdmin,
    fullscreenControl: forAdmin,
    streetViewControl: false,
    clickableIcons: false,
    gestureHandling: forAdmin ? 'greedy' : undefined,
  });
  incrementApiCall('mapLoad');

  map.addListener('zoom_changed', () => {
    const z = map.getZoom();
    if (z != null) map.setOptions({ styles: getMapStylesForZoom(z) });
  });

  if (google.maps.places?.PlacesService) {
    placesService = new google.maps.places.PlacesService(map);
  }
  myCafeMarkers = [];

  ensureMapBackgroundClickListener();

  return map;
}

export function getMap() {
  return map;
}

export function getPlacesService() {
  return placesService;
}

export function onMoveEnd(callback) {
  if (!map || typeof callback !== 'function') return;
  map.addListener('idle', () => {
    const b = map.getBounds();
    if (b) callback(b);
  });
}

export function setCenter(lat, lng, zoom = 16) {
  if (!map) return;
  map.setCenter({ lat, lng });
  map.setZoom(zoom);
}

function removeMarker(m) {
  if (m.setMap) m.setMap(null);
  else if (m.map !== undefined) m.map = null;
}

/** No-op: search results now use white pill overlays via addCuratedPins. Kept for API compatibility. */
export function clearSearchPins() {}

function getMyCafeDotIcon() {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: '#1d8a00',
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
    scale: 10,
  };
}

const OVERLAP_PADDING_PX = 4;
const MARKER_ICON_SIZE = 14.3;
const MARKER_ICON_SVG = {
  check: `<svg viewBox="0 0 24 24" width="${MARKER_ICON_SIZE}" height="${MARKER_ICON_SIZE}" aria-hidden="true" focusable="false"><path d="M9.2 16.2 4.9 11.9l1.4-1.4 2.9 2.9 8.4-8.4 1.4 1.4z" fill="currentColor"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" width="${MARKER_ICON_SIZE}" height="${MARKER_ICON_SIZE}" aria-hidden="true" focusable="false"><path d="M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z" fill="currentColor"/></svg>`,
  star: `<svg viewBox="0 0 24 24" width="${MARKER_ICON_SIZE}" height="${MARKER_ICON_SIZE}" aria-hidden="true" focusable="false"><path d="m12 17.27 6.18 3.73-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" fill="currentColor"/></svg>`,
};

function rectsOverlap(a, b, padding = OVERLAP_PADDING_PX) {
  return !(a.right < b.left - padding || a.left > b.right + padding || a.bottom < b.top - padding || a.top > b.bottom + padding);
}

/**
 * Pill-shaped name tag overlay. Extends google.maps.OverlayView — must be defined lazily so
 * importing this module before the Maps script loads does not throw (google is undefined).
 */
let NameTagOverlayClass = null;

function getNameTagOverlayClass() {
  if (NameTagOverlayClass) return NameTagOverlayClass;
  if (typeof google === 'undefined' || !google.maps?.OverlayView) return null;
  NameTagOverlayClass = class NameTagOverlay extends google.maps.OverlayView {
    constructor(position, label, onClick, options = {}) {
      super();
      this.position = position;
      this.label = label;
      this.onClick = onClick;
      this.cafe = options.cafe ?? null;
      this.starred = options.starred === true;
      this.alwaysDot = options.alwaysDot === true;
      this.tried = options.tried === true || options.logged === true;
      this.liked = options.liked === true;
      this.logoUrl = options.logoUrl || options.cafe?.logoUrl || null;
      this.div = null;
      this.showAsDot = this.starred ? false : true;
    }
    setShowAsDot(show) {
      if (this.starred) show = false;
      if (this.alwaysDot) show = true;
      if (this.showAsDot === show) return;
      this.showAsDot = show;
      this.updateDisplay();
    }
    updateDisplay() {
      if (!this.div) return;
      const classes = ['matcha-hop-name-tag'];
      if (this.showAsDot) classes.push('matcha-hop-dot');
      if (this.tried) classes.push('tried');
      if (this.liked) classes.push('liked');
      if (this.cafe && selectedCafeId === this.cafe.id) classes.push('selected');
      this.div.className = classes.join(' ');
      this.div.innerHTML = '';
      const logoUrl = (this.cafe && this.cafe.logoUrl) || this.logoUrl || null;
      if (!this.showAsDot && logoUrl) {
        const thumbEl = document.createElement('img');
        thumbEl.className = 'matcha-hop-thumb';
        thumbEl.src = logoUrl;
        thumbEl.alt = '';
        thumbEl.setAttribute('aria-hidden', 'true');
        thumbEl.referrerPolicy = 'no-referrer';
        this.div.appendChild(thumbEl);
      }
      if (!this.showAsDot) {
        const labelEl = document.createElement('span');
        labelEl.className = 'matcha-hop-label';
        labelEl.textContent = this.label;
        this.div.appendChild(labelEl);
      }
      let iconEl = null;
      if (this.liked && this.tried) {
        iconEl = document.createElement('span');
        iconEl.className = 'matcha-hop-state-icon matcha-hop-heart';
        iconEl.innerHTML = MARKER_ICON_SVG.heart;
      } else if (this.liked && !this.tried) {
        iconEl = document.createElement('span');
        iconEl.className = 'matcha-hop-state-icon matcha-hop-star';
        iconEl.innerHTML = MARKER_ICON_SVG.star;
      } else if (!this.liked && this.tried) {
        iconEl = document.createElement('span');
        iconEl.className = 'matcha-hop-state-icon matcha-hop-check';
        iconEl.innerHTML = MARKER_ICON_SVG.check;
      }
      if (iconEl) {
        iconEl.setAttribute('aria-hidden', 'true');
        this.div.appendChild(iconEl);
      }
      applyCuratedOverlayZIndex();
    }
    onAdd() {
      this.div = document.createElement('div');
      this.div.style.position = 'absolute';
      this.div.style.cursor = 'pointer';
      bindOverlayClickHandler(this.div, this.onClick);
      this.updateDisplay();
      const panes = this.getPanes();
      if (panes) panes.floatPane.appendChild(this.div);
    }
    draw() {
      if (!this.div || !this.position) return;
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(
        this.position instanceof google.maps.LatLng ? this.position : new google.maps.LatLng(this.position.lat, this.position.lng)
      );
      if (!point) return;
      this.div.style.left = point.x + 'px';
      this.div.style.top = point.y + 'px';
      this.div.style.transform = this.showAsDot ? 'translate(-50%, -50%)' : 'translate(-50%, -100%)';
    }
    onRemove() {
      if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
      this.div = null;
    }
  };
  return NameTagOverlayClass;
}

export function clearCuratedPins() {
  curatedOverlays.forEach((o) => o.setMap(null));
  curatedOverlays = [];
}

function overlayZIndexFor(o) {
  if (!o?.div) return 100;
  const cafe = o.cafe || {};
  let z = 100;
  if (cafe.brandId || cafe.logoUrl || o.logoUrl) z = 200;
  if (o.tried) z = 250;
  if (o.liked) z = 300;
  if (cafe.id && selectedCafeId === cafe.id) z = 450;
  return z;
}

function applyCuratedOverlayZIndex() {
  curatedOverlays.forEach((o) => {
    if (!o.div) return;
    o.div.style.zIndex = String(overlayZIndexFor(o));
  });
}

export function setSelectedCafeId(id) {
  selectedCafeId = id ?? null;
  curatedOverlays.forEach((o) => o.updateDisplay && o.updateDisplay());
  applyCuratedOverlayZIndex();
}

export function addCuratedPins(cafes, onClick) {
  clearCuratedPins();
  if (!map) return;
  const OverlayCtor = getNameTagOverlayClass();
  if (!OverlayCtor) return;
  (cafes || []).forEach((cafe) => {
    const position = new google.maps.LatLng(cafe.lat, cafe.lng);
    const overlay = new OverlayCtor(position, cafe.name || 'Cafe', () => onClick && onClick(cafe), {
      cafe,
      starred: cafe.starred === true,
      alwaysDot: cafe.classification === 'cafe_specialty_matcha',
      tried: cafe.tried === true || cafe.logged === true,
      liked: cafe.liked === true,
      logoUrl: cafe.logoUrl || null,
    });
    overlay.setMap(map);
    curatedOverlays.push(overlay);
  });
  scheduleOverlapDetection();
}

function scheduleOverlapDetection() {
  setTimeout(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        runOverlapDetection();
      });
    });
  }, 0);
}

function runOverlapDetection() {
  if (curatedOverlays.length === 0) return;
  const rects = curatedOverlays.map((o) => {
    if (!o.div) return null;
    return o.div.getBoundingClientRect();
  });
  const overlapping = new Set();
  for (let i = 0; i < rects.length; i++) {
    if (!rects[i]) continue;
    for (let j = i + 1; j < rects.length; j++) {
      if (!rects[j]) continue;
      if (rectsOverlap(rects[i], rects[j])) {
        overlapping.add(i);
        overlapping.add(j);
      }
    }
  }
  overlapping.forEach((i) => {
    if (!curatedOverlays[i].starred && !curatedOverlays[i].alwaysDot) curatedOverlays[i].setShowAsDot(true);
  });
  for (let i = 0; i < curatedOverlays.length; i++) {
    if (!overlapping.has(i) && !curatedOverlays[i].alwaysDot && !curatedOverlays[i].starred) {
      curatedOverlays[i].setShowAsDot(false);
    }
  }
  curatedOverlays.forEach((o) => o.draw());
  applyCuratedOverlayZIndex();
}

/** Pop-up marker icon: transparent fill, thin green ring, small inner dot. */
function getPopUpRingIcon(color = '#239c02') {
  if (typeof google === 'undefined' || !google.maps) return null;
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 0.08,
    strokeColor: color,
    strokeOpacity: 0.95,
    strokeWeight: 1.5,
    scale: 11,
  };
}

export function clearPopUpPins() {
  popUpMarkers.forEach((m) => removeMarker(m));
  popUpMarkers = [];
}

/** Render thin-green-outline markers for active/upcoming pop-ups. `popUps` items must include lat/lng. */
export function addPopUpPins(popUps, onClick) {
  clearPopUpPins();
  if (!map || typeof google === 'undefined' || !google.maps) return;
  const icon = getPopUpRingIcon();
  if (!icon) return;
  (popUps || []).forEach((pop) => {
    const lat = Number(pop?.lat);
    const lng = Number(pop?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const marker = new google.maps.Marker({
      position: { lat, lng },
      map,
      icon,
      title: pop?.name || pop?.address || 'Pop-up',
      zIndex: 220,
    });
    marker.addListener('click', () => onClick && onClick(pop));
    popUpMarkers.push(marker);
  });
}

let EventTagOverlayClass = null;

function getEventTagOverlayClass() {
  if (EventTagOverlayClass) return EventTagOverlayClass;
  if (typeof google === 'undefined' || !google.maps?.OverlayView) return null;
  EventTagOverlayClass = class EventTagOverlay extends google.maps.OverlayView {
    constructor(position, dateLabel, nameLabel, onClick, options = {}) {
      super();
      this.position = position;
      this.dateLabel = dateLabel || '';
      this.nameLabel = nameLabel || 'Event';
      this.onClick = onClick;
      this.eventId = options.eventId ?? null;
      this.div = null;
    }
    updateDisplay() {
      if (!this.div) return;
      const classes = ['matcha-hop-event-tag'];
      if (this.eventId && selectedEventId === this.eventId) classes.push('selected');
      this.div.className = classes.join(' ');
      this.div.innerHTML = '';
      if (this.dateLabel) {
        const dateEl = document.createElement('span');
        dateEl.className = 'matcha-hop-event-date';
        dateEl.textContent = this.dateLabel;
        this.div.appendChild(dateEl);
      }
      const nameEl = document.createElement('span');
      nameEl.className = 'matcha-hop-event-name';
      nameEl.textContent = this.nameLabel;
      this.div.appendChild(nameEl);
    }
    onAdd() {
      this.div = document.createElement('div');
      this.div.style.position = 'absolute';
      this.div.style.cursor = 'pointer';
      this.div.style.zIndex = '320';
      bindOverlayClickHandler(this.div, this.onClick);
      this.updateDisplay();
      const panes = this.getPanes();
      if (panes) panes.floatPane.appendChild(this.div);
    }
    draw() {
      if (!this.div || !this.position) return;
      const projection = this.getProjection();
      if (!projection) return;
      const point = projection.fromLatLngToDivPixel(
        this.position instanceof google.maps.LatLng ? this.position : new google.maps.LatLng(this.position.lat, this.position.lng)
      );
      if (!point) return;
      this.div.style.left = point.x + 'px';
      this.div.style.top = point.y + 'px';
      this.div.style.transform = 'translate(-50%, -100%)';
    }
    onRemove() {
      if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
      this.div = null;
    }
  };
  return EventTagOverlayClass;
}

export function clearEventPins() {
  eventOverlays.forEach((o) => o.setMap(null));
  eventOverlays = [];
}

export function setSelectedEventId(id) {
  selectedEventId = id ?? null;
  eventOverlays.forEach((o) => o.updateDisplay && o.updateDisplay());
}

/** White pill tags for active/upcoming events — date + name on the tag. */
export function addEventPins(events, onClick) {
  clearEventPins();
  if (!map) return;
  const OverlayCtor = getEventTagOverlayClass();
  if (!OverlayCtor) return;
  (events || []).forEach((ev) => {
    const lat = Number(ev?.lat);
    const lng = Number(ev?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const position = new google.maps.LatLng(lat, lng);
    const overlay = new OverlayCtor(
      position,
      ev.dateLabel || ev.dateTag || '',
      ev.title || ev.name || ev.location || 'Event',
      () => onClick && onClick(ev),
      { eventId: ev?.id || null },
    );
    overlay.setMap(map);
    eventOverlays.push(overlay);
  });
}

export function addMyCafePin(cafe, onClick) {
  if (!map || !cafe?.lat || !cafe?.lng) return null;
  const marker = new google.maps.Marker({
    position: { lat: cafe.lat, lng: cafe.lng },
    map,
    icon: getMyCafeDotIcon(),
    title: cafe.name || '',
  });
  marker.addListener('click', () => onClick && onClick(cafe));
  myCafeMarkers.push(marker);
  return marker;
}

/** Clears separate "my cafe" markers only. Tried/liked state is shown on the single name-tag overlay. */
export function refreshMyCafesPins(cafes, onClick) {
  myCafeMarkers.forEach(removeMarker);
  myCafeMarkers = [];
}

const FLY_DURATION_MS = 500;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function flyTo(lat, lng, zoom = 16) {
  if (!map) return;
  const startCenter = map.getCenter();
  const startZoom = map.getZoom();
  if (!startCenter || startZoom == null) {
    map.panTo({ lat, lng });
    map.setZoom(zoom);
    return;
  }
  const startLat = startCenter.lat();
  const startLng = startCenter.lng();
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / FLY_DURATION_MS, 1);
    const k = easeInOutCubic(t);
    const newLat = startLat + (lat - startLat) * k;
    const newLng = startLng + (lng - startLng) * k;
    const newZoom = startZoom + (zoom - startZoom) * k;
    map.setCenter({ lat: newLat, lng: newLng });
    map.setZoom(newZoom);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function fitBounds(places) {
  if (!map || !places || places.length === 0) return;
  const bounds = new google.maps.LatLngBounds();
  places.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
  map.fitBounds(bounds, { padding: 40 });
  const z = map.getZoom();
  if (z > 15) map.setZoom(15);
}
