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
import { getStorage, initAuth } from './firebase.js';

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

  // Brand form wiring
  const brandAddBtn = document.getElementById('admin-brand-add-btn');
  const brandSaveBtn = document.getElementById('admin-brand-save');
  const brandCancelBtn = document.getElementById('admin-brand-cancel');
  const brandFormClose = document.getElementById('admin-brand-form-close');
  const logoZone = document.getElementById('admin-brand-logo-zone');
  const logoFileInput = document.getElementById('admin-brand-logo-file');
  const logoRemoveBtn = document.getElementById('admin-brand-logo-remove');

  if (brandAddBtn) brandAddBtn.addEventListener('click', () => openBrandForm(null));
  if (brandSaveBtn) brandSaveBtn.addEventListener('click', saveBrandFromForm);
  if (brandCancelBtn) brandCancelBtn.addEventListener('click', closeBrandForm);
  if (brandFormClose) brandFormClose.addEventListener('click', closeBrandForm);

  if (logoZone && logoFileInput) {
    logoFileInput.addEventListener('click', (e) => e.stopPropagation());
    logoZone.addEventListener('click', () => logoFileInput.click());
    logoZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); logoFileInput.click(); } });
    logoFileInput.addEventListener('change', () => {
      const f = logoFileInput.files?.[0] || null;
      if (!f) return;
      pendingLogoFile = f;
      pendingLogoRemoved = false;
      setLogoPreview(URL.createObjectURL(f));
    });
  }
  if (logoRemoveBtn) {
    logoRemoveBtn.addEventListener('click', () => {
      pendingLogoFile = null;
      pendingLogoRemoved = true;
      if (logoFileInput) logoFileInput.value = '';
      setLogoPreview(null);
    });
  }

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
    closeBrandForm();
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
let pendingLogoFile = null;
let pendingLogoRemoved = false;

const SVG_ARROW_UP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
const SVG_ARROW_DOWN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const SVG_EDIT = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const SVG_TRASH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';

function chooseLogoExt(file) {
  const t = String(file?.type || '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  const m = String(file?.name || '').match(/\.([a-z0-9]+)$/i);
  const ext = m?.[1]?.toLowerCase();
  return (ext && ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) ? ext : 'png';
}

async function uploadBrandLogo(brandId, file) {
  if (!brandId || !file) return null;
  await initAuth().catch(() => null);
  const st = getStorage();
  if (!st) throw new Error('Storage not configured');
  const ext = chooseLogoExt(file);
  const ref = st.ref(`brandLogos/${brandId}.${ext}`);
  await ref.put(file, { contentType: file.type || 'image/png' });
  return ref.getDownloadURL();
}

function showFormPanel(show) {
  const panel = document.getElementById('admin-brand-form-panel');
  if (panel) panel.classList.toggle('hidden', !show);
}

function setLogoPreview(url) {
  const preview = document.getElementById('admin-brand-logo-preview');
  const placeholder = document.getElementById('admin-brand-logo-placeholder');
  const removeBtn = document.getElementById('admin-brand-logo-remove');
  if (!preview || !placeholder) return;
  if (url) {
    preview.src = url;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
    if (removeBtn) removeBtn.classList.remove('hidden');
  } else {
    preview.removeAttribute('src');
    preview.style.display = 'none';
    placeholder.style.display = '';
    if (removeBtn) removeBtn.classList.add('hidden');
  }
}

async function renderBrandsListAdmin() {
  const listEl = document.getElementById('admin-brands-list');
  if (!listEl) return;
  const config = await getBrandsConfig();
  const brands = config.brands || [];
  listEl.innerHTML = '';

  if (brands.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;padding:30px 10px;color:#aaa;font-size:0.85rem;">No brands yet. Click <b>+ Add Brand</b> to create one.</div>';
    return;
  }

  for (let i = 0; i < brands.length; i++) {
    const b = brands[i];
    const cafeIds = Array.isArray(b.cafeIds) ? b.cafeIds : [];
    const names = cafeIds.map((id) => (getCafeById(id) || {}).name || id).filter(Boolean);
    const locText = cafeIds.length === 0
      ? 'Pop-up / no location'
      : names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');

    const card = document.createElement('div');
    card.className = 'ab-card';

    const logoHtml = b.logoUrl
      ? `<img class="ab-card-logo" src="${escapeAttr(b.logoUrl)}" alt="">`
      : `<div class="ab-card-logo-placeholder">
           <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
         </div>`;

    card.innerHTML = `
      ${logoHtml}
      <div class="ab-card-info">
        <div class="ab-card-name">${escapeHtml(b.name || 'Unnamed')}</div>
        <div class="ab-card-meta">${escapeHtml(locText)}</div>
      </div>
      <div class="ab-card-actions">
        <button type="button" data-action="up" title="Move up" ${i === 0 ? 'disabled' : ''}>${SVG_ARROW_UP}</button>
        <button type="button" data-action="down" title="Move down" ${i === brands.length - 1 ? 'disabled' : ''}>${SVG_ARROW_DOWN}</button>
        <button type="button" data-action="edit" title="Edit" class="ab-act-edit">${SVG_EDIT}</button>
        <button type="button" data-action="remove" title="Delete" class="ab-act-delete">${SVG_TRASH}</button>
      </div>
    `;

    card.querySelector('[data-action="up"]').addEventListener('click', () => moveBrand(i, -1));
    card.querySelector('[data-action="down"]').addEventListener('click', () => moveBrand(i, 1));
    card.querySelector('[data-action="edit"]').addEventListener('click', () => openBrandForm(b.id));
    card.querySelector('[data-action="remove"]').addEventListener('click', () => removeBrand(i));
    listEl.appendChild(card);
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

async function openBrandForm(brandId) {
  editingBrandId = brandId || null;
  pendingLogoFile = null;
  pendingLogoRemoved = false;

  const heading = document.getElementById('admin-brand-form-heading');
  const nameInput = document.getElementById('admin-brand-name');
  const cafesList = document.getElementById('admin-brand-cafes-list');
  const fileInput = document.getElementById('admin-brand-logo-file');
  if (!nameInput || !cafesList) return;

  const config = await getBrandsConfig();
  const available = getAvailableCafesForBrand(config, brandId || null);
  const currentBrand = brandId ? (config.brands || []).find((b) => b.id === brandId) : null;

  if (heading) heading.textContent = currentBrand ? `Edit: ${currentBrand.name || 'Unnamed'}` : 'New Brand';
  nameInput.value = currentBrand ? (currentBrand.name || '') : '';
  if (fileInput) fileInput.value = '';
  renderCafeCheckboxes(cafesList, available, currentBrand ? (currentBrand.cafeIds || []) : []);
  setLogoPreview(currentBrand?.logoUrl || null);
  showFormPanel(true);
}

function renderCafeCheckboxes(container, cafes, selectedIds) {
  const set = new Set((selectedIds || []).map(String));
  container.innerHTML = '';
  if (cafes.length === 0) {
    container.innerHTML = '<div style="padding:8px 4px;color:#aaa;font-size:0.8rem;">No available locations. Classify cafes in the Locations tab first.</div>';
    return;
  }
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

function closeBrandForm() {
  editingBrandId = null;
  pendingLogoFile = null;
  pendingLogoRemoved = false;
  showFormPanel(false);
}

function setFormStatus(msg, isError) {
  const el = document.getElementById('admin-brand-form-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#c44' : '#888';
}

async function saveBrandFromForm() {
  const nameInput = document.getElementById('admin-brand-name');
  const cafesList = document.getElementById('admin-brand-cafes-list');
  const saveBtn = document.getElementById('admin-brand-save');
  if (!nameInput || !cafesList) return;

  const name = (nameInput.value || '').trim() || 'Unnamed';
  const checked = Array.from(cafesList.querySelectorAll('input[type="checkbox"]:checked')).map((el) => el.value);
  const config = await getBrandsConfig();
  const brands = [...(config.brands || [])];
  const brandId = editingBrandId || uid();
  const existingBrand = editingBrandId ? brands.find((b) => b.id === editingBrandId) : null;

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  setFormStatus('');

  let nextLogoUrl = existingBrand?.logoUrl || null;
  if (pendingLogoRemoved) nextLogoUrl = null;
  if (pendingLogoFile) {
    setFormStatus('Uploading logo…', false);
    try {
      nextLogoUrl = await uploadBrandLogo(brandId, pendingLogoFile);
    } catch (e) {
      const msg = e?.message || String(e);
      console.error('[Matcha Hop Admin] Brand logo upload failed:', msg);
      setFormStatus('Logo upload failed: ' + msg, true);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Brand'; }
      return;
    }
  }

  setFormStatus('Saving…', false);
  try {
    if (editingBrandId) {
      const idx = brands.findIndex((b) => b.id === editingBrandId);
      if (idx >= 0) brands[idx] = { ...brands[idx], name, cafeIds: checked, logoUrl: nextLogoUrl };
    } else {
      brands.push({ id: brandId, name, cafeIds: checked, logoUrl: nextLogoUrl });
    }
    await setBrandsConfig(brands);
  } catch (e) {
    const msg = e?.message || String(e);
    console.error('[Matcha Hop Admin] Brand save failed:', msg);
    setFormStatus('Save failed: ' + msg, true);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Brand'; }
    return;
  }

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Brand'; }
  closeBrandForm();
  renderBrandsListAdmin();
}

init();
