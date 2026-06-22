/**
 * Post form: visit-first, multi-drink logging with optional per-drink deep dive.
 */

import {
  saveLog,
  saveCafe,
  getGalleryBrands,
  getCafeByPlaceId,
  getPopUpsByBrandId,
  CLASSIFICATIONS,
  hasUserLikedBrand,
  hasUserLikedLocation,
  setBrandLike,
  setLocationLike,
} from './data.js';
import { getCurrentProfile } from './firebase.js';
import { getStorage, initAuth } from './firebase.js';

const FLAVOR_TAGS = ['grassy', 'umami', 'nutty', 'vegetal', 'creamy', 'citrus', 'fruity', 'sweet', 'toasted', 'earthy', 'buttery', 'caramel', 'floral', 'bitter'];

function escapeAttr(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML.replace(/"/g, '&quot;');
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date(dateStr + 'T12:00:00');
  const formatted = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return dateStr === today ? `Today (${formatted})` : formatted;
}

function makeLogId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const parts = dataUrl.split(',');
  if (parts.length < 2) return null;
  const meta = parts[0] || '';
  const b64 = parts[1] || '';
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
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }
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

function uploadErrorMessage(error) {
  const code = error?.code || '';
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return 'Photo upload is blocked by Firebase Storage permissions. Please deploy updated storage rules or enable auth.';
  }
  if (code === 'storage/retry-limit-exceeded' || code === 'storage/network-request-failed') {
    return 'Photo upload failed due to network issues. Please try again.';
  }
  if (code === 'storage/canceled') {
    return 'Photo upload was canceled.';
  }
  if (String(error?.message || '').toLowerCase().includes('invalid')) {
    return 'Photo upload failed due to invalid image data.';
  }
  return 'Photo upload failed. Please try again.';
}

async function uploadLogPhotos(logId, photosBase64) {
  if (!Array.isArray(photosBase64) || photosBase64.length === 0) return [];
  await initAuth().catch(() => null);
  const st = getStorage();
  if (!st) throw new Error('Storage is not configured');
  const out = [];
  for (let i = 0; i < photosBase64.length; i += 1) {
    const sourceBlob = dataUrlToBlob(photosBase64[i]);
    if (!sourceBlob) throw new Error('Invalid photo data');
    const blob = await compressImageBlob(sourceBlob, { maxDimension: 1600, quality: 0.82 });
    const ext = (blob.type || '').includes('png') ? 'png' : 'jpg';
    const ref = st.ref(`logs/${logId}/${i + 1}.${ext}`);
    await ref.put(blob, { contentType: blob.type || 'image/jpeg' });
    const url = await ref.getDownloadURL();
    out.push(url);
  }
  return out;
}

export function openLogForm(cafe, onClose, options = {}) {
  const currentProfile = getCurrentProfile();
  const overlay = document.getElementById('log-form-overlay');
  const panel = document.getElementById('log-form-panel');
  if (!overlay || !panel) return;

  const hasInitialCafe = cafe != null;
  const isNewFromSearch = hasInitialCafe && cafe?.placeId && !getCafeByPlaceId(cafe.placeId);
  const cafeId = cafe?.id || null;
  const cafeName = cafe?.name || 'This cafe';
  const contextBrand = options.brand ?? null;
  const contextPopUp = options.popUp ?? null;
  const contextBrandId = options.brandId ?? contextBrand?.id ?? null;
  const contextBrandName = options.brandName ?? contextBrand?.name ?? null;
  const contextPopupId = options.popupId ?? contextPopUp?.id ?? null;

  const classificationOptions = Object.entries(CLASSIFICATIONS)
    .map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`)
    .join('');
  const classificationSection = isNewFromSearch ? `
    <div class="form-section" id="log-form-classification-section">
      <label for="log-classification">Classification</label>
      <select id="log-classification">
        <option value="">Select type</option>
        ${classificationOptions}
      </select>
      <p class="form-hint">This place will be added to the map. Choose how it appears.</p>
    </div>
  ` : '';

  const todayStr = new Date().toISOString().slice(0, 10);
  panel.classList.add('log-form-panel--prototype');
  panel.innerHTML = `
    <div class="log-compose-topbar">
      <button type="button" class="log-compose-top-btn btn-cancel">Cancel</button>
      <h2 class="log-compose-title">New post</h2>
      <button type="submit" form="log-matcha-form" class="log-compose-post-btn btn-save">Post</button>
    </div>
    <form id="log-matcha-form">
      <div class="log-compose-photo-block">
        <input type="file" id="log-photo-input" accept="image/*" multiple hidden>
        <div class="log-photo-strip" id="log-photo-strip" aria-label="Photo strip"></div>
        <p id="log-upload-status" class="log-upload-status hidden" aria-live="polite"></p>
      </div>
      <input type="date" id="log-date" value="${todayStr}" tabindex="-1" aria-hidden="true" class="hidden">
      <div class="form-section">
        <label for="log-form-brand-input" class="log-compose-label">CAFÉ / BRAND</label>
        <input type="text" id="log-form-brand-input" class="log-form-select-input" list="log-form-brand-suggestions" placeholder="Search brand...">
        <datalist id="log-form-brand-suggestions"></datalist>
      </div>
      <div class="rating-row">
        <label class="log-compose-label">OVERALL <span class="log-compose-optional">optional</span></label>
        <div id="log-overall-stars" class="stars"></div>
      </div>
      <input type="hidden" id="log-form-location-select" value="">
      <div id="log-form-hearts" class="log-form-hearts hidden"></div>
      <label for="log-notes" class="log-compose-label">CAPTION <span class="log-compose-optional">optional</span></label>
      <textarea id="log-notes" placeholder="How was it?"></textarea>
      <div class="form-section">
        <div class="log-drinks-heading">
          <label class="log-compose-label">DRINKS</label>
          <button type="button" id="log-add-drink-btn" class="log-add-drink-btn">+ Add drink</button>
        </div>
        <div id="log-drink-list"></div>
      </div>
      ${classificationSection}
    </form>
  `;

  overlay.classList.remove('hidden');

  let photosBase64 = [];
  let selectedBrand = contextBrand || null;
  let selectedCafe = cafe || null;
  let selectedPopUp = contextPopUp || null;
  let brands = [];
  const drinkRows = [];

  const form = document.getElementById('log-matcha-form');
  const photoInput = document.getElementById('log-photo-input');
  const photoStrip = document.getElementById('log-photo-strip');
  const drinkList = document.getElementById('log-drink-list');
  const addDrinkBtn = document.getElementById('log-add-drink-btn');
  const uploadStatusEl = document.getElementById('log-upload-status');
  const saveBtn = form?.querySelector('.btn-save');
  const MAX_PHOTOS = 10;
  let isSaving = false;
  let overallRating = 0;
  let fileReadQueue = Promise.resolve();

  function renderLikeButtons() {}

  function renderDrinkRows() {
    if (!drinkList) return;
    drinkList.innerHTML = '';
    drinkRows.forEach((row, idx) => {
      const el = document.createElement('div');
      el.className = 'log-drink-row';
      el.innerHTML = `
        <div class="log-drink-row-top">
          <span class="log-drink-index">${idx + 1}</span>
          <input type="text" class="log-drink-name-input" data-idx="${idx}" value="${escapeAttr(row.name)}" placeholder="Drink name (required)">
          <div class="log-drink-stars" data-idx="${idx}">
            ${[1,2,3,4,5].map((n) => `<button type="button" class="log-drink-star ${n <= row.rating ? 'filled' : ''}" data-idx="${idx}" data-rate="${n}" aria-label="Rate ${n} star">★</button>`).join('')}
          </div>
          <button type="button" class="log-drink-expand-btn" data-idx="${idx}">${row.expanded ? 'Hide details' : 'Add details'}</button>
          ${drinkRows.length > 1 ? `<button type="button" class="log-drink-remove-btn" data-idx="${idx}">×</button>` : ''}
        </div>
        ${row.expanded ? `
        <div class="log-drink-details">
          <textarea class="log-drink-notes-input" data-idx="${idx}" placeholder="Drink notes...">${escapeHtml(row.notes)}</textarea>
          <label>Sweetness (${row.details.sweet})</label><input class="log-slider" data-idx="${idx}" data-kind="sweet" type="range" min="0" max="5" value="${row.details.sweet}">
          <label>Bitterness (${row.details.bitter})</label><input class="log-slider" data-idx="${idx}" data-kind="bitter" type="range" min="0" max="5" value="${row.details.bitter}">
          <label>Umami (${row.details.umami})</label><input class="log-slider" data-idx="${idx}" data-kind="umami" type="range" min="0" max="5" value="${row.details.umami}">
          <div class="log-flavor-tags">${FLAVOR_TAGS.map((t) => `<button type="button" class="log-flavor-tag ${row.details.flavorTags.includes(t) ? 'is-active' : ''}" data-idx="${idx}" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</button>`).join('')}</div>
          <input type="text" class="log-price-input" data-idx="${idx}" value="${escapeAttr(String(row.details.price || ''))}" placeholder="Price (optional)">
        </div>` : ''}
      `;
      drinkList.appendChild(el);
    });
    drinkList.querySelectorAll('.log-drink-name-input').forEach((node) => node.addEventListener('input', () => { drinkRows[Number(node.dataset.idx)].name = node.value; }));
    drinkList.querySelectorAll('.log-drink-star').forEach((node) => node.addEventListener('click', () => {
      const idx = Number(node.dataset.idx);
      const rate = Number(node.dataset.rate) || 0;
      drinkRows[idx].rating = drinkRows[idx].rating === rate ? 0 : rate;
      renderDrinkRows();
    }));
    drinkList.querySelectorAll('.log-drink-expand-btn').forEach((node) => node.addEventListener('click', () => { const row = drinkRows[Number(node.dataset.idx)]; row.expanded = !row.expanded; renderDrinkRows(); }));
    drinkList.querySelectorAll('.log-drink-remove-btn').forEach((node) => node.addEventListener('click', () => { drinkRows.splice(Number(node.dataset.idx), 1); if (!drinkRows.length) addDrink(); renderDrinkRows(); }));
    drinkList.querySelectorAll('.log-drink-notes-input').forEach((node) => node.addEventListener('input', () => { drinkRows[Number(node.dataset.idx)].notes = node.value; }));
    drinkList.querySelectorAll('.log-slider').forEach((node) => node.addEventListener('input', () => { const row = drinkRows[Number(node.dataset.idx)]; row.details[node.dataset.kind] = Number(node.value); renderDrinkRows(); }));
    drinkList.querySelectorAll('.log-price-input').forEach((node) => node.addEventListener('input', () => { drinkRows[Number(node.dataset.idx)].details.price = node.value; }));
    drinkList.querySelectorAll('.log-flavor-tag').forEach((node) => node.addEventListener('click', () => {
      const row = drinkRows[Number(node.dataset.idx)];
      const t = node.dataset.tag;
      row.details.flavorTags = row.details.flavorTags.includes(t) ? row.details.flavorTags.filter((x) => x !== t) : [...row.details.flavorTags, t];
      renderDrinkRows();
    }));
  }

  function addDrink() {
    drinkRows.push({
      name: '',
      rating: 0,
      notes: '',
      expanded: false,
      details: { sweet: 0, bitter: 0, umami: 0, flavorTags: [], price: '', recommended: false },
    });
  }

  function renderOverallStars() {
    const starsEl = document.getElementById('log-overall-stars');
    if (!starsEl) return;
    starsEl.innerHTML = '';
    for (let i = 1; i <= 5; i += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = i <= overallRating ? 'filled' : '';
      btn.textContent = '★';
      btn.addEventListener('click', () => {
        overallRating = i === overallRating ? 0 : i;
        renderOverallStars();
      });
      starsEl.appendChild(btn);
    }
  }

  async function initBrandLocation() {
    const brandInput = document.getElementById('log-form-brand-input');
    const brandSuggestions = document.getElementById('log-form-brand-suggestions');
    const locationSelect = document.getElementById('log-form-location-select');
    if (!brandInput || !brandSuggestions || !locationSelect) return;
    brands = await getGalleryBrands();
    if (!selectedBrand && contextBrandId) selectedBrand = brands.find((b) => b.id === contextBrandId) || null;
    if (selectedBrand && contextPopupId) {
      const pops = await getPopUpsByBrandId(selectedBrand.id);
      selectedPopUp = pops.find((p) => p.id === contextPopupId) || null;
    }
    const populateBrandSuggestions = () => {
      brandSuggestions.innerHTML = '';
      brands.forEach((b) => {
        const opt = document.createElement('option');
        opt.value = b.name || '';
        brandSuggestions.appendChild(opt);
      });
    };
    const populateLocationOptions = async () => {
      if (!selectedBrand) {
        if (locationSelect) locationSelect.value = '';
        return;
      }
      const popUps = await getPopUpsByBrandId(selectedBrand.id);
      if (!selectedCafe && !selectedPopUp) {
        const firstCafe = (selectedBrand.cafes || [])[0];
        if (firstCafe) selectedCafe = firstCafe;
        else if (popUps[0]) selectedPopUp = popUps[0];
      }
      if (locationSelect) {
        if (selectedCafe) locationSelect.value = `cafe:${selectedCafe.id}`;
        else if (selectedPopUp) locationSelect.value = `popup:${selectedPopUp.id}`;
        else locationSelect.value = '';
      }
    };
    const syncFromBrandInput = async () => {
      const typed = (brandInput.value || '').trim().toLowerCase();
      selectedBrand = brands.find((b) => (b.name || '').trim().toLowerCase() === typed) || null;
      selectedCafe = null;
      selectedPopUp = null;
      await populateLocationOptions();
      renderLikeButtons();
    };
    populateBrandSuggestions();
    if (selectedBrand?.name) brandInput.value = selectedBrand.name;
    await populateLocationOptions();
    renderLikeButtons();
    brandInput.addEventListener('change', syncFromBrandInput);
    brandInput.addEventListener('blur', syncFromBrandInput);
    if (locationSelect) {
      locationSelect.addEventListener('change', async () => {});
    }
  }

  async function resolveBrandForCafe() {
    if (!hasInitialCafe || !cafeId) return;
    const all = await getGalleryBrands();
    const brand = all.find((b) => (b.cafes || []).some((c) => String(c.id) === String(cafeId)));
    if (brand) {
      selectedBrand = brand;
      selectedCafe = cafe;
      renderLikeButtons();
    }
  }

  function addPhoto(dataUrl) {
    if (photosBase64.length >= MAX_PHOTOS) return;
    photosBase64.push(dataUrl);
    renderPreviewList();
  }

  function renderPreviewList() {
    if (!photoStrip) return;
    photoStrip.innerHTML = '';
    photosBase64.forEach((src, i) => {
      const item = document.createElement('div');
      item.className = 'log-photo-tile log-photo-tile--preview';
      item.innerHTML = `<img src="${escapeAttr(src)}" alt=""><button type="button" class="photo-remove" aria-label="Remove photo">×</button>`;
      item.querySelector('.photo-remove')?.addEventListener('click', () => { photosBase64.splice(i, 1); renderPreviewList(); });
      photoStrip.appendChild(item);
    });
    if (photosBase64.length < MAX_PHOTOS) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'log-photo-tile log-photo-tile--add';
      addBtn.innerHTML = '<span class="log-photo-tile-plus">+</span><span class="log-photo-tile-text">Add</span>';
      addBtn.addEventListener('click', () => photoInput?.click());
      photoStrip.appendChild(addBtn);
    }
  }

  function updateUploadStatus(message = '', visible = false) {
    if (!uploadStatusEl) return;
    uploadStatusEl.textContent = message;
    uploadStatusEl.classList.toggle('hidden', !visible);
  }

  function setSavingState(saving, message = '') {
    isSaving = saving;
    if (saveBtn) {
      saveBtn.disabled = saving;
      saveBtn.textContent = saving ? 'Saving...' : 'Post';
    }
    updateUploadStatus(message, saving || !!message);
  }

  async function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  async function enqueueSelectedFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const remaining = Math.max(0, MAX_PHOTOS - photosBase64.length);
    const picked = files.slice(0, remaining);
    if (!picked.length) return;
    for (const file of picked) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        if (typeof dataUrl === 'string') addPhoto(dataUrl);
      } catch (err) {
        console.warn('[Matcha Hop] Skipped unreadable file:', file?.name, err);
      }
    }
  }

  if (photoInput) {
    photoInput.addEventListener('change', (e) => {
      const files = e.target.files;
      if (!files || !files.length) return;
      fileReadQueue = fileReadQueue.then(() => enqueueSelectedFiles(files)).finally(() => {
        if (photoInput) photoInput.value = '';
      });
    });
  }

  const dateDisplay = document.getElementById('log-date-display');
  const dateInput = document.getElementById('log-date');
  dateDisplay?.addEventListener('click', () => dateInput?.showPicker?.() || dateInput?.click());
  dateInput?.addEventListener('change', () => { if (dateDisplay) dateDisplay.textContent = formatDateDisplay(dateInput.value || ''); });
  form.querySelector('.btn-cancel')?.addEventListener('click', () => {
    overlay.classList.add('hidden');
    onClose?.();
  });

  addDrink();
  renderDrinkRows();
  renderOverallStars();
  addDrinkBtn?.addEventListener('click', () => { addDrink(); renderDrinkRows(); });
  renderPreviewList();
  initBrandLocation();
  resolveBrandForCafe();
  renderLikeButtons();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSaving) return;
    const notes = (document.getElementById('log-notes')?.value || '').trim();
    const drinks = drinkRows.map((row) => ({
      name: String(row.name || '').trim(),
      rating: Number(row.rating) || 0,
      notes: String(row.notes || '').trim(),
      price: row.details.price || '',
      flavorNotes: row.details.flavorTags || [],
      profile: {
        sweet: Number(row.details.sweet) || 0,
        bitter: Number(row.details.bitter) || 0,
        umami: Number(row.details.umami) || 0,
      },
      recommended: !!row.details.recommended,
    })).filter((d) => d.name);
    if (!drinks.length) {
      alert('Please add at least one drink.');
      return;
    }
    const createdAt = dateInput?.value ? new Date(`${dateInput.value}T12:00:00`).getTime() : Date.now();
    let savedCafeId = cafeId;
    let cafeForLog = cafe ? { id: cafeId, name: cafeName, address: cafe.address, lat: cafe.lat, lng: cafe.lng } : null;
    let savedCafeForCallback = null;
    let classification = null;
    if (isNewFromSearch) {
      const classificationEl = document.getElementById('log-classification');
      if (classificationEl?.value) classification = classificationEl.value;
    }
    if (selectedCafe) {
      const saved = saveCafe({ ...selectedCafe, name: selectedCafe.name, address: selectedCafe.address, lat: selectedCafe.lat, lng: selectedCafe.lng });
      savedCafeId = saved.id;
      cafeForLog = { id: saved.id, name: saved.name, address: saved.address, lat: saved.lat, lng: saved.lng };
      savedCafeForCallback = saved;
    } else if (cafe && (!cafeId || !cafe.id)) {
      const saved = saveCafe({ ...cafe, name: cafe.name || cafeName, address: cafe.address, lat: cafe.lat, lng: cafe.lng, classification: classification ?? undefined });
      savedCafeId = saved.id;
      cafeForLog = { id: saved.id, name: saved.name, address: saved.address, lat: saved.lat, lng: saved.lng };
      savedCafeForCallback = saved;
    }
    if (!selectedBrand?.id) {
      alert('Please select a brand before posting.');
      return;
    }
    if (!savedCafeId && !selectedPopUp?.id) {
      alert('Please select a location before posting.');
      return;
    }
    const logId = makeLogId();
    let uploadedPhotoUrls = [];
    setSavingState(true, photosBase64.length ? 'Uploading photos...' : 'Saving post...');
    if (photosBase64.length) {
      try {
        uploadedPhotoUrls = await uploadLogPhotos(logId, photosBase64);
      } catch (uploadErr) {
        console.error(uploadErr);
        setSavingState(false);
        alert(uploadErrorMessage(uploadErr));
        return;
      }
    }
    try {
      await saveLog({
        id: logId,
        userId: currentProfile.ownerId,
        visit: {
          brandId: selectedBrand?.id || null,
          brandName: selectedBrand?.name || null,
          location: {
            cafeId: savedCafeId || null,
            cafeName: cafeForLog?.name || null,
            address: cafeForLog?.address || null,
            popupId: selectedPopUp?.id || null,
          },
        },
        post: {
          rating: overallRating,
          caption: notes,
          photos: uploadedPhotoUrls.length ? uploadedPhotoUrls : [],
          drinks,
        },
        userName: currentProfile.username,
        userDisplayName: currentProfile.name,
        createdAt,
      });
    } catch (err) {
      console.error(err);
      setSavingState(false);
      alert('Failed to save. Try again.');
      return;
    }
    setSavingState(false);
    overlay.classList.add('hidden');
    onClose?.(savedCafeForCallback);
  });
}
