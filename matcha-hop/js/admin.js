/**
 * Admin: load matcha cafes for Metro Manila, then classify each (Matcha Cafe / Cafe with Specialty Matcha / Regular Cafe / N/A).
 */
import { initMap, getMap, clearCuratedPins, addCuratedPins } from './map.js';
import { searchByBounds } from './search.js';
import {
  initData,
  getCafesForAdmin,
  getCafeById,
  setClassification,
  setStarred,
  saveCafe,
  getBrandsConfig,
  setBrandsConfig,
  getLogs,
  CLASSIFICATIONS,
  METRO_MANILA_SW,
  METRO_MANILA_NE,
} from './data.js';
import { fetchPlaceDetails } from './place-details.js';

function getDefaultBounds() {
  return new google.maps.LatLngBounds(
    new google.maps.LatLng(METRO_MANILA_SW.lat, METRO_MANILA_SW.lng),
    new google.maps.LatLng(METRO_MANILA_NE.lat, METRO_MANILA_NE.lng)
  );
}

const listEl = document.getElementById('admin-list');
const loadingEl = document.getElementById('admin-loading');
const loadBtn = document.getElementById('admin-load-btn');

let currentFilter = 'unclassified';
let showAllUnclassified = false;
let adminMode = 'locations';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function setLoading(loading) {
  if (loadingEl) loadingEl.classList.toggle('hidden', !loading);
  if (loadingEl) loadingEl.hidden = !loading;
  if (listEl) listEl.hidden = loading;
}

/** Always filter list by current map bounds (core behavior). When bounds not ready, show all. */
function cafesInMapBounds(cafes) {
  const map = getMap();
  if (!map) return cafes;
  const bounds = map.getBounds();
  if (!bounds || typeof bounds.contains !== 'function') return cafes;
  return cafes.filter((c) => {
    if (c.lat == null || c.lng == null) return false;
    const latLng = new google.maps.LatLng(c.lat, c.lng);
    return bounds.contains(latLng);
  });
}

function filterCafes(cafes) {
  if (currentFilter === 'all') return cafes;
  if (currentFilter === 'unclassified') {
    return cafes.filter((c) => c.classification == null || c.classification === '');
  }
  return cafes.filter((c) => c.classification === currentFilter);
}

async function renderList() {
  const allCafes = getCafesForAdmin();
  const listSource =
    currentFilter === 'unclassified' && showAllUnclassified
      ? allCafes
      : cafesInMapBounds(allCafes);
  const cafes = filterCafes(listSource);
  listEl.innerHTML = '';
  listEl.hidden = false;
  if (loadingEl) loadingEl.classList.add('hidden');
  updateFilterTabs(listSource);
  cafes.forEach((cafe) => {
    const li = document.createElement('li');
    const currentVal = cafe.classification == null ? '' : cafe.classification;
    const buttonsHtml = Object.entries(CLASSIFICATIONS)
      .map(([value, label]) => {
        const active = value === currentVal ? ' active' : '';
        return `<button type="button" data-class="${escapeAttr(value)}" class="${active}" aria-pressed="${value === currentVal}">${escapeHtml(label)}</button>`;
      })
      .join('');
    const starChar = cafe.starred ? '★' : '☆';
    li.innerHTML = `
      <button type="button" class="admin-star" data-starred="${cafe.starred ? '1' : '0'}" aria-label="${cafe.starred ? 'Unstar' : 'Star'} this cafe" title="${cafe.starred ? 'Unstar (always show label on map)' : 'Star (always show label on map)'}">${starChar}</button>
      <span class="cafe-name">${escapeHtml(cafe.name || 'Unnamed')}</span>
      <span class="cafe-address">${escapeHtml(cafe.address || '')}</span>
      <div class="cafe-classify" role="group" aria-label="Classification">
        ${buttonsHtml}
      </div>
    `;
    const starBtn = li.querySelector('.admin-star');
    if (starBtn) {
      starBtn.addEventListener('click', () => {
        setStarred(cafe.id, !cafe.starred);
        renderList();
      });
    }
    li.querySelectorAll('.cafe-classify button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-class') || null;
        setClassification(cafe.id, val);
        renderList();
      });
    });
    listEl.appendChild(li);
  });
  clearCuratedPins();
  addCuratedPins(cafes, () => {});
}

function updateFilterTabs(allCafes) {
  const unclassifiedCount = allCafes.filter((c) => c.classification == null || c.classification === '').length;
  const counts = { unclassified: unclassifiedCount };
  Object.keys(CLASSIFICATIONS).forEach((key) => {
    counts[key] = allCafes.filter((c) => c.classification === key).length;
  });
  document.querySelectorAll('.admin-tab').forEach((tab) => {
    const filter = tab.getAttribute('data-filter');
    const n = filter === 'all' ? allCafes.length : (counts[filter] ?? 0);
    const label = tab.textContent.replace(/\s*\(\d+\)\s*$/, '');
    tab.textContent = n > 0 ? `${label} (${n})` : label;
    tab.classList.toggle('active', filter === currentFilter);
    tab.setAttribute('aria-selected', filter === currentFilter ? 'true' : 'false');
  });
}

function setFilter(filter) {
  currentFilter = filter;
  renderList();
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

/** True if we should fetch and cache place details (photo, rating, hours) for this classification. Only matcha cafes get details cached. */
function shouldCachePlaceDetails(classification) {
  return classification === 'matcha_cafe' || classification === 'cafe_specialty_matcha';
}

/** Collect placeIds for matcha cafes only (we only update/cache details for matcha cafe and cafe with specialty matcha). */
async function collectAllPlaceIds() {
  const ids = new Set();
  const cafes = getCafesForAdmin();
  cafes.forEach((c) => {
    if (c.placeId && shouldCachePlaceDetails(c.classification)) ids.add(c.placeId);
  });
  const config = await getBrandsConfig();
  (config.brands || []).forEach((b) => {
    (b.cafeIds || []).forEach((cafeId) => {
      const cafe = getCafeById(cafeId);
      if (cafe?.placeId && shouldCachePlaceDetails(cafe.classification)) ids.add(cafe.placeId);
    });
  });
  const logs = getLogs();
  logs.forEach((log) => {
    const cafe = getCafeById(log.cafeId);
    if (cafe?.placeId && shouldCachePlaceDetails(cafe.classification)) ids.add(cafe.placeId);
  });
  return Array.from(ids);
}

async function onUpdatePlaceData() {
  const btn = document.getElementById('admin-update-place-data-btn');
  const statusEl = document.getElementById('admin-update-place-data-status');
  if (!btn || !statusEl) return;
  btn.disabled = true;
  statusEl.textContent = 'Collecting places…';
  try {
    const placeIds = await collectAllPlaceIds();
    if (placeIds.length === 0) {
      statusEl.textContent = 'No places to update.';
      return;
    }
    const total = placeIds.length;
    let failed = 0;
    const timeoutMs = 25000;
    for (let i = 0; i < placeIds.length; i++) {
      const placeId = placeIds[i];
      const cafe = getCafesForAdmin().find((c) => c.placeId === placeId);
      const nameOrPlaceId = cafe?.name ?? placeId;
      const classification = cafe?.classification ?? 'n/a';
      statusEl.textContent = `Updating ${i + 1}/${total}…`;
      console.log(`[Matcha Hop Admin] Updating ${i + 1}/${total}: ${nameOrPlaceId} [${classification}] (${placeId})`);
      try {
        const details = await Promise.race([
          fetchPlaceDetails(placeId, true, true),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Place details timeout')), timeoutMs)),
        ]);
        if (details) {
          const cafesWithPlace = getCafesForAdmin().filter((c) => c.placeId === placeId);
          cafesWithPlace.forEach((cafe) => {
            saveCafe({
              ...cafe,
              photoUrl: details.photoUrl ?? cafe.photoUrl,
              rating: details.rating ?? cafe.rating,
              userRatingCount: details.userRatingCount ?? cafe.userRatingCount,
              openStatus: details.openStatus ?? cafe.openStatus,
            });
          });
          console.log(`[Matcha Hop Admin] OK ${i + 1}/${total}: ${nameOrPlaceId}`);
        } else {
          console.warn(`[Matcha Hop Admin] No details returned ${i + 1}/${total}: ${nameOrPlaceId}`);
        }
      } catch (e) {
        failed += 1;
        console.error('[Matcha Hop Admin] Place update failed:', placeId, nameOrPlaceId, e);
      }
      if (i < placeIds.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    if (failed === 0) {
      statusEl.textContent = `Done. Updated ${total} place(s).`;
    } else {
      statusEl.textContent = `Done. Updated ${total - failed} place(s). ${failed} failed (see console).`;
    }
  } catch (e) {
    console.error('[Matcha Hop Admin] Update place data failed:', e);
    statusEl.textContent = 'Update failed. See console.';
  } finally {
    btn.disabled = false;
  }
}

async function onLoad() {
  if (loadBtn) loadBtn.disabled = true;
  setLoading(true);
  const queryEl = document.getElementById('admin-search-query');
  const query = (queryEl?.value?.trim() || 'matcha cafe');
  try {
    const map = getMap();
    let bounds = null;
    if (map) {
      const b = map.getBounds();
      if (b && typeof b.contains === 'function') bounds = b;
    }
    if (!bounds) bounds = getDefaultBounds();
    const results = await searchByBounds(bounds, query);
    results.forEach((c) => saveCafe(c));
    await renderList();
  } catch (err) {
    console.error('[Matcha Hop Admin] Load failed:', err);
    await renderList();
  } finally {
    setLoading(false);
    if (loadBtn) loadBtn.disabled = false;
  }
}

async function init() {
  initMap('admin-map', { forAdmin: true });
  const map = getMap();
  if (map && typeof google !== 'undefined' && google.maps?.event) {
    setTimeout(() => google.maps.event.trigger(map, 'resize'), 100);
  }
  try {
    await initData();
  } catch (e) {
    console.warn('[Matcha Hop Admin] initData failed:', e?.message || e);
  }
  if (map) {
    const bounds = new google.maps.LatLngBounds(
      new google.maps.LatLng(METRO_MANILA_SW.lat, METRO_MANILA_SW.lng),
      new google.maps.LatLng(METRO_MANILA_NE.lat, METRO_MANILA_NE.lng)
    );
    map.fitBounds(bounds);
  }
  await renderList();
  setLoading(false);
  if (loadBtn) loadBtn.addEventListener('click', onLoad);
  const updatePlaceDataBtn = document.getElementById('admin-update-place-data-btn');
  if (updatePlaceDataBtn) updatePlaceDataBtn.addEventListener('click', onUpdatePlaceData);
  const queryEl = document.getElementById('admin-search-query');
  if (queryEl) queryEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') onLoad(); });
  document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => setFilter(tab.getAttribute('data-filter')));
  });
  const showAllUnclassifiedCheckbox = document.getElementById('admin-show-all-unclassified');
  if (showAllUnclassifiedCheckbox) {
    showAllUnclassifiedCheckbox.addEventListener('change', () => {
      showAllUnclassified = showAllUnclassifiedCheckbox.checked;
      renderList();
    });
  }
  if (map) {
    let mapDebounce;
    map.addListener('idle', () => {
      clearTimeout(mapDebounce);
      mapDebounce = setTimeout(renderList, 200);
    });
  }

  const modeLocations = document.getElementById('admin-mode-locations');
  const modeBrands = document.getElementById('admin-mode-brands');
  const locationsWrap = document.getElementById('admin-locations-wrap');
  const brandsWrap = document.getElementById('admin-brands-wrap');
  if (modeLocations) modeLocations.addEventListener('click', () => setAdminMode('locations'));
  if (modeBrands) modeBrands.addEventListener('click', () => setAdminMode('brands'));

  const brandSaveBtn = document.getElementById('admin-brand-save');
  const brandCancelBtn = document.getElementById('admin-brand-cancel');
  if (brandSaveBtn) brandSaveBtn.addEventListener('click', saveBrandFromForm);
  if (brandCancelBtn) brandCancelBtn.addEventListener('click', resetFormForNewBrand);

  // Load cafes automatically on page open (no button press needed)
  onLoad();
}

function setAdminMode(mode) {
  adminMode = mode;
  const locationsWrap = document.getElementById('admin-locations-wrap');
  const brandsWrap = document.getElementById('admin-brands-wrap');
  const modeLocations = document.getElementById('admin-mode-locations');
  const modeBrands = document.getElementById('admin-mode-brands');
  if (locationsWrap) locationsWrap.classList.toggle('hidden', mode !== 'locations');
  if (brandsWrap) brandsWrap.classList.toggle('hidden', mode !== 'brands');
  if (modeLocations) {
    modeLocations.classList.toggle('active', mode === 'locations');
    modeLocations.setAttribute('aria-selected', mode === 'locations' ? 'true' : 'false');
  }
  if (modeBrands) {
    modeBrands.classList.toggle('active', mode === 'brands');
    modeBrands.setAttribute('aria-selected', mode === 'brands' ? 'true' : 'false');
  }
  if (mode === 'brands') {
    renderBrandsListAdmin();
    resetFormForNewBrand();
  }
}

/** Returns set of cafe IDs that are in any brand's cafeIds. If excludeBrandId is set, IDs from that brand are not counted (so we can show "available" for editing that brand). */
function getAssignedCafeIds(config, excludeBrandId) {
  const assigned = new Set();
  (config.brands || []).forEach((b) => {
    if (b.id === excludeBrandId) return;
    (b.cafeIds || []).forEach((id) => assigned.add(String(id)));
  });
  return assigned;
}

/** Classified cafes that are available for selection: when adding (excludeBrandId null), only unassigned; when editing, current brand's + unassigned. */
function getAvailableCafesForBrand(config, excludeBrandId) {
  const classified = getCafesForAdmin().filter(
    (c) => c.classification === 'matcha_cafe' || c.classification === 'cafe_specialty_matcha'
  );
  const assignedToOther = getAssignedCafeIds(config, excludeBrandId);
  const currentBrand = excludeBrandId ? (config.brands || []).find((b) => b.id === excludeBrandId) : null;
  const currentIds = currentBrand ? new Set((currentBrand.cafeIds || []).map(String)) : new Set();
  return classified.filter((c) => currentIds.has(String(c.id)) || !assignedToOther.has(String(c.id)));
}

let editingBrandId = null;

async function renderBrandsListAdmin() {
  const listEl = document.getElementById('admin-brands-list');
  if (!listEl) return;
  const config = await getBrandsConfig();
  const brands = config.brands || [];
  listEl.innerHTML = '';
  for (let i = 0; i < brands.length; i++) {
    const b = brands[i];
    const cafeIds = Array.isArray(b.cafeIds) ? b.cafeIds : [];
    const locationLabel = cafeIds.length === 0 ? 'No locations' : `${cafeIds.length} location${cafeIds.length !== 1 ? 's' : ''}`;
    const names = cafeIds.map((id) => (getCafeById(id) || {}).name || id).filter(Boolean);
    const li = document.createElement('li');
    li.className = 'admin-brands-item';
    li.innerHTML = `
      <span class="brand-name">${escapeHtml(b.name || 'Unnamed')}</span>
      <span class="brand-branches">${escapeHtml(locationLabel)}${names.length ? ': ' + escapeHtml(names.slice(0, 2).join(', ') + (names.length > 2 ? '…' : '')) : ''}</span>
      <div class="brand-actions">
        <button type="button" data-action="up" ${i === 0 ? 'disabled' : ''}>Up</button>
        <button type="button" data-action="down" ${i === brands.length - 1 ? 'disabled' : ''}>Down</button>
        <button type="button" data-action="edit">Edit</button>
        <button type="button" data-action="remove">Remove</button>
      </div>
    `;
    const upBtn = li.querySelector('[data-action="up"]');
    const downBtn = li.querySelector('[data-action="down"]');
    const editBtn = li.querySelector('[data-action="edit"]');
    const removeBtn = li.querySelector('[data-action="remove"]');
    if (upBtn) upBtn.addEventListener('click', () => moveBrand(i, -1));
    if (downBtn) downBtn.addEventListener('click', () => moveBrand(i, 1));
    if (editBtn) editBtn.addEventListener('click', () => openAddBrandForm(b.id));
    if (removeBtn) removeBtn.addEventListener('click', () => removeBrand(i));
    listEl.appendChild(li);
  }
}

async function moveBrand(index, delta) {
  const config = await getBrandsConfig();
  const brands = [...(config.brands || [])];
  const newIndex = index + delta;
  if (newIndex < 0 || newIndex >= brands.length) return;
  [brands[index], brands[newIndex]] = [brands[newIndex], brands[index]];
  await setBrandsConfig(brands);
  renderBrandsListAdmin();
}

async function removeBrand(index) {
  const config = await getBrandsConfig();
  const brands = (config.brands || []).filter((_, i) => i !== index);
  await setBrandsConfig(brands);
  renderBrandsListAdmin();
}

async function openAddBrandForm(brandId) {
  editingBrandId = brandId;
  const nameInput = document.getElementById('admin-brand-name');
  const cafesList = document.getElementById('admin-brand-cafes-list');
  if (!nameInput || !cafesList) return;
  const config = await getBrandsConfig();
  const available = getAvailableCafesForBrand(config, brandId || null);
  const currentBrand = brandId ? (config.brands || []).find((b) => b.id === brandId) : null;
  nameInput.value = currentBrand ? (currentBrand.name || '') : '';
  renderCafeCheckboxes(cafesList, available, currentBrand ? (currentBrand.cafeIds || []) : []);
}

function renderCafeCheckboxes(container, cafes, selectedIds) {
  const set = new Set((selectedIds || []).map(String));
  container.innerHTML = '';
  cafes.forEach((cafe) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = cafe.id;
    if (set.has(String(cafe.id))) input.checked = true;
    label.appendChild(input);
    label.appendChild(document.createTextNode(cafe.name || cafe.id || 'Unnamed'));
    container.appendChild(label);
  });
}

async function resetFormForNewBrand() {
  editingBrandId = null;
  const nameInput = document.getElementById('admin-brand-name');
  const cafesList = document.getElementById('admin-brand-cafes-list');
  if (nameInput) nameInput.value = '';
  if (cafesList) {
    const config = await getBrandsConfig();
    const available = getAvailableCafesForBrand(config, null);
    renderCafeCheckboxes(cafesList, available, []);
  }
}

async function saveBrandFromForm() {
  const nameInput = document.getElementById('admin-brand-name');
  const cafesList = document.getElementById('admin-brand-cafes-list');
  if (!nameInput || !cafesList) return;
  const name = (nameInput.value || '').trim() || 'Unnamed';
  const checked = Array.from(cafesList.querySelectorAll('input[type="checkbox"]:checked')).map((el) => el.value);
  const config = await getBrandsConfig();
  const brands = [...(config.brands || [])];
  if (editingBrandId) {
    const idx = brands.findIndex((b) => b.id === editingBrandId);
    if (idx >= 0) {
      brands[idx] = { ...brands[idx], name, cafeIds: checked };
    }
  } else {
    brands.push({ id: uid(), name, cafeIds: checked });
  }
  await setBrandsConfig(brands);
  renderBrandsListAdmin();
  await resetFormForNewBrand();
}

init();
