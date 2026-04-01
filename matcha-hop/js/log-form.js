/**
 * Post matcha form: share your matcha — photo-first, optional tag brand/location, description. No ratings.
 */

import { saveLog, saveCafe, getGalleryBrands, getCafeByPlaceId, getPopUpsByBrandId, CLASSIFICATIONS } from './data.js';

function escapeAttr(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML.replace(/"/g, '&quot;');
}

/** Format YYYY-MM-DD for display: "Today (March 9, 2026)" when today, else "March 9, 2026". */
function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date(dateStr + 'T12:00:00');
  const formatted = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return dateStr === today ? `Today (${formatted})` : formatted;
}

export function openLogForm(cafe, onClose, options = {}) {
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
  const isBrandLocked = !!(contextBrandId || contextBrandName);

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

  const formTitle = hasInitialCafe ? `Share your Matcha at ${escapeHtml(cafeName)}` : (contextBrandName ? `Share your Matcha at ${escapeHtml(contextBrandName)}` : 'Share your Matcha');
  const brandLocationSection = hasInitialCafe ? '' : `
    <div class="form-section" id="log-form-brand-section">
      <label for="log-form-location-trigger">Location</label>
      <button type="button" id="log-form-location-trigger" class="log-form-location-trigger" aria-haspopup="dialog" aria-expanded="false">
        <span id="log-form-location-label" class="log-form-location-label ${isBrandLocked && contextBrandName ? '' : 'log-form-location-placeholder'}">${isBrandLocked && contextBrandName ? escapeHtml(contextBrandName) : 'Choose cafe or brand'}</span>
        <span id="log-form-location-change" class="log-form-location-change ${isBrandLocked ? '' : 'hidden'}">Change</span>
      </button>
    </div>
  `;

  const todayStr = new Date().toISOString().slice(0, 10);
  panel.innerHTML = `
    <h2>${formTitle}</h2>
    <form id="log-matcha-form">
      <label>Photos</label>
      <div class="photo-upload">
        <input type="file" id="log-photo-input" accept="image/*" multiple hidden>
        <button type="button" class="photo-upload-zone" id="log-photo-zone" aria-label="Add photo">
          <span class="photo-upload-zone-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span>
          <span class="photo-upload-zone-text">Add photo</span>
        </button>
        <div class="photo-preview-list" id="log-photo-preview-list"></div>
      </div>
      <label for="log-date-display">Date</label>
      <div class="log-form-date-row">
        <button type="button" id="log-date-display" class="log-form-date-display" aria-label="Choose date">${formatDateDisplay(todayStr)}</button>
        <input type="date" id="log-date" value="${todayStr}" tabindex="-1" aria-hidden="true">
      </div>
      <label for="log-drink-name">Drink name</label>
      <input type="text" id="log-drink-name" placeholder="e.g. Matcha Latte">
      ${brandLocationSection}
      <label for="log-notes">Description</label>
      <textarea id="log-notes" placeholder="Vibe, taste, anything..."></textarea>
      ${classificationSection}
      <div class="form-actions">
        <button type="button" class="btn-cancel">Cancel</button>
        <button type="submit" class="btn-save">Save</button>
      </div>
    </form>
  `;

  overlay.classList.remove('hidden');

  let photosBase64 = [];
  let selectedBrand = contextBrand || null;
  let selectedCafe = cafe || null;
  let selectedPopUp = contextPopUp || null;
  let brands = [];

  const form = document.getElementById('log-matcha-form');
  const photoInput = document.getElementById('log-photo-input');
  const previewList = document.getElementById('log-photo-preview-list');

  async function initBrandLocation() {
    if (hasInitialCafe) return;
    const locationTrigger = document.getElementById('log-form-location-trigger');
    const locationLabel = document.getElementById('log-form-location-label');
    const locationChange = document.getElementById('log-form-location-change');
    const brandPickerModal = document.getElementById('log-form-brand-picker-modal');
    const brandPickerSearch = document.getElementById('log-form-brand-picker-search');
    const brandPickerGallery = document.getElementById('log-form-brand-picker-gallery');
    const brandPickerClose = document.getElementById('log-form-brand-picker-close');
    const brandPickerBackdrop = document.getElementById('log-form-brand-picker-backdrop');
    const brandFilterAll = document.getElementById('log-form-brand-filter-all');
    const brandFilterCafe = document.getElementById('log-form-brand-filter-cafe');
    const brandFilterPopup = document.getElementById('log-form-brand-filter-popup');
    const modalStep1 = document.getElementById('log-form-modal-step1');
    const modalStep2 = document.getElementById('log-form-modal-step2');
    const modalStep2Back = document.getElementById('log-form-modal-step2-back');
    const modalStep2Title = document.getElementById('log-form-modal-step2-title');
    const locationPickerGallery = document.getElementById('log-form-location-picker-gallery');
    if (!locationTrigger || !brandPickerModal || !brandPickerGallery) return;

    brands = await getGalleryBrands();
    if (isBrandLocked && !selectedBrand && contextBrandId) {
      selectedBrand = brands.find((b) => b.id === contextBrandId) || null;
    }
    if (isBrandLocked && selectedBrand && contextPopupId) {
      const popUps = await getPopUpsByBrandId(selectedBrand.id);
      selectedPopUp = popUps.find((p) => p.id === contextPopupId) || null;
      selectedCafe = null;
    }

    let modalStep = 1;
    let step2Brand = null;

    function updateFormLocationLabel() {
      if (!locationLabel) return;
      if (!selectedBrand) {
        locationLabel.textContent = 'Choose cafe or brand';
        locationLabel.classList.add('log-form-location-placeholder');
        if (locationChange) locationChange.classList.add('hidden');
        return;
      }
      locationLabel.classList.remove('log-form-location-placeholder');
      if (locationChange) locationChange.classList.remove('hidden');
      if (selectedCafe) {
        locationLabel.textContent = `${selectedBrand.name || 'Unnamed'} – ${selectedCafe.name || selectedCafe.address || 'Location'}`;
      } else if (selectedPopUp) {
        locationLabel.textContent = `${selectedBrand.name || 'Unnamed'} – ${selectedPopUp.name || selectedPopUp.address || 'Pop-up'}`;
      } else {
        locationLabel.textContent = selectedBrand.name || 'Unnamed';
      }
    }

    function showStep1() {
      modalStep = 1;
      step2Brand = null;
      if (modalStep1) modalStep1.classList.remove('hidden');
      if (modalStep2) modalStep2.classList.add('hidden');
    }

    function showStep2(brand) {
      modalStep = 2;
      step2Brand = brand;
      if (modalStep1) modalStep1.classList.add('hidden');
      if (modalStep2) modalStep2.classList.remove('hidden');
      if (modalStep2Title) modalStep2Title.textContent = `${brand.name || 'Unnamed'} – Choose location`;
      if (!locationPickerGallery) return;
      const cafes = brand.cafes || [];
      const popUpsPromise = getPopUpsByBrandId(brand.id);
      popUpsPromise.then((popUps) => {
        locationPickerGallery.innerHTML = '';
        cafes.forEach((c) => {
          const name = c.name || c.address || c.id || 'Unnamed';
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'log-form-brand-card log-form-brand-card--modal log-form-location-card';
          const img = c.photoUrl ? `<img src="${escapeAttr(c.photoUrl)}" alt="" class="card-image">` : '<div class="card-image card-image-placeholder"></div>';
          card.innerHTML = `${img}<span class="card-name">${escapeHtml(name)}</span>`;
          card.addEventListener('click', () => {
            selectedBrand = brand;
            selectedCafe = c;
            selectedPopUp = null;
            updateFormLocationLabel();
            closeBrandPickerModal();
          });
          locationPickerGallery.appendChild(card);
        });
        popUps.forEach((p) => {
          const label = p.name || p.address || 'Pop-up';
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'log-form-brand-card log-form-brand-card--modal log-form-location-card';
          card.innerHTML = `<span class="card-name">${escapeHtml(label)}</span>`;
          card.addEventListener('click', () => {
            selectedBrand = brand;
            selectedCafe = null;
            selectedPopUp = p;
            updateFormLocationLabel();
            closeBrandPickerModal();
          });
          locationPickerGallery.appendChild(card);
        });
      });
    }

    let brandPickerFilter = 'all';

    function getFilteredBrands() {
      let list = brands;
      if (brandPickerFilter === 'cafe') list = list.filter((b) => (b.cafes || []).length > 0);
      else if (brandPickerFilter === 'popup') list = list.filter((b) => (b.cafes || []).length === 0);
      return list;
    }

    function renderBrandGalleryModal(filterQuery = '') {
      const q = (filterQuery || '').trim().toLowerCase();
      let list = getFilteredBrands();
      list = q ? list.filter((b) => (b.name || '').toLowerCase().includes(q)) : list;
      brandPickerGallery.innerHTML = '';
      list.forEach((b) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'log-form-brand-card log-form-brand-card--modal';
        card.dataset.brandId = b.id;
        const firstCafe = b.cafes && b.cafes[0];
        const img = firstCafe?.photoUrl ? `<img src="${escapeAttr(firstCafe.photoUrl)}" alt="" class="card-image">` : '<div class="card-image card-image-placeholder"></div>';
        card.innerHTML = `${img}<span class="card-name">${escapeHtml(b.name || 'Unnamed')}</span>`;
        card.addEventListener('click', () => {
          const cafes = b.cafes || [];
          getPopUpsByBrandId(b.id).then((popUps) => {
            if (cafes.length > 0 || popUps.length > 0) {
              showStep2(b);
            } else {
              selectedBrand = b;
              selectedCafe = null;
              selectedPopUp = null;
              updateFormLocationLabel();
              closeBrandPickerModal();
            }
          });
        });
        brandPickerGallery.appendChild(card);
      });
    }

    function setBrandFilterActive(activeFilter) {
      brandPickerFilter = activeFilter;
      [brandFilterAll, brandFilterCafe, brandFilterPopup].forEach((btn) => {
        if (!btn) return;
        const isActive = (btn.dataset.filter || '') === activeFilter;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      renderBrandGalleryModal(brandPickerSearch ? brandPickerSearch.value.trim() : '');
    }

    function onBrandPickerEscape(e) {
      if (e.key !== 'Escape' || !brandPickerModal || brandPickerModal.classList.contains('hidden')) return;
      if (modalStep === 2) {
        showStep1();
        renderBrandGalleryModal(brandPickerSearch ? brandPickerSearch.value.trim() : '');
      } else {
        closeBrandPickerModal();
      }
    }

    function openBrandPickerModal() {
      brandPickerModal.classList.remove('hidden');
      if (isBrandLocked && selectedBrand) {
        showStep2(selectedBrand);
      } else {
        showStep1();
        if (brandPickerSearch) brandPickerSearch.value = '';
        brandPickerFilter = 'all';
        setBrandFilterActive('all');
        renderBrandGalleryModal('');
        if (brandPickerSearch) brandPickerSearch.focus();
      }
      locationTrigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('keydown', onBrandPickerEscape);
    }

    function closeBrandPickerModal() {
      brandPickerModal.classList.add('hidden');
      showStep1();
      locationTrigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', onBrandPickerEscape);
    }

    locationTrigger.addEventListener('click', () => openBrandPickerModal());

    if (brandPickerSearch) brandPickerSearch.addEventListener('input', () => renderBrandGalleryModal(brandPickerSearch.value.trim()));
    if (brandFilterAll) brandFilterAll.addEventListener('click', () => setBrandFilterActive('all'));
    if (brandFilterCafe) brandFilterCafe.addEventListener('click', () => setBrandFilterActive('cafe'));
    if (brandFilterPopup) brandFilterPopup.addEventListener('click', () => setBrandFilterActive('popup'));
    if (modalStep2Back) modalStep2Back.addEventListener('click', () => { showStep1(); renderBrandGalleryModal(brandPickerSearch ? brandPickerSearch.value.trim() : ''); });
    if (brandPickerClose) brandPickerClose.addEventListener('click', closeBrandPickerModal);
    if (brandPickerBackdrop) brandPickerBackdrop.addEventListener('click', closeBrandPickerModal);

    updateFormLocationLabel();
  }

  async function resolveBrandForCafe() {
    if (!hasInitialCafe || !cafeId) return;
    const all = await getGalleryBrands();
    const brand = all.find((b) => (b.cafes || []).some((c) => String(c.id) === String(cafeId)));
    if (brand) {
      selectedBrand = brand;
      selectedCafe = cafe;
    }
  }

  initBrandLocation();
  resolveBrandForCafe();

  function addPhoto(dataUrl) {
    photosBase64.push(dataUrl);
    renderPreviewList();
  }

  function removePhoto(index) {
    photosBase64.splice(index, 1);
    renderPreviewList();
  }

  function renderPreviewList() {
    previewList.innerHTML = '';
    previewList.className = 'photo-preview-list';
    if (photosBase64.length === 0) return;
    photosBase64.forEach((src, i) => {
      const item = document.createElement('div');
      item.className = 'photo-preview-item';
      item.innerHTML = `<img src="${escapeAttr(src)}" alt=""><button type="button" class="photo-remove" aria-label="Remove photo">×</button>`;
      item.querySelector('.photo-remove').addEventListener('click', () => removePhoto(i));
      previewList.appendChild(item);
    });
  }

  function handleFiles(files) {
    if (!files?.length) return;
    let pending = files.length;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        addPhoto(reader.result);
        if (--pending === 0 && photoInput) photoInput.value = '';
      };
      reader.readAsDataURL(file);
    });
  }

  const photoZone = document.getElementById('log-photo-zone');
  if (photoZone && photoInput) {
    photoZone.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', (e) => handleFiles(e.target.files));
  }

  const dateDisplay = document.getElementById('log-date-display');
  const dateInput = document.getElementById('log-date');
  if (dateDisplay && dateInput) {
    dateDisplay.addEventListener('click', () => dateInput.showPicker?.() || dateInput.click());
    dateInput.addEventListener('change', () => {
      dateDisplay.textContent = formatDateDisplay(dateInput.value || '');
    });
  }

  form.querySelector('.btn-cancel').addEventListener('click', () => {
    document.getElementById('log-form-brand-picker-modal')?.classList.add('hidden');
    overlay.classList.add('hidden');
    onClose?.();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const notes = document.getElementById('log-notes').value.trim();
    const drinkName = (document.getElementById('log-drink-name')?.value || '').trim();
    const dateEl = document.getElementById('log-date');
    const dateValue = dateEl?.value;
    const createdAt = dateValue ? new Date(dateValue + 'T12:00:00').getTime() : Date.now();

    const hasPhoto = photosBase64.length > 0;
    const hasDescription = notes.length > 0;
    if (!hasPhoto && !hasDescription) {
      alert('Add at least one: a photo or a description.');
      return;
    }

    if (hasInitialCafe && !selectedBrand && cafeId) {
      const allBrands = await getGalleryBrands();
      selectedBrand = allBrands.find((b) => (b.cafes || []).some((c) => String(c.id) === String(cafeId))) || null;
    }

    let savedCafeId = cafeId;
    let cafeForLog = cafe ? { id: cafeId, name: cafeName, address: cafe.address, lat: cafe.lat, lng: cafe.lng } : null;
    let savedCafeForCallback = null;
    let classification = null;
    if (isNewFromSearch) {
      const classificationEl = document.getElementById('log-classification');
      if (classificationEl && classificationEl.value) classification = classificationEl.value;
    }
    if (selectedCafe) {
      const saved = saveCafe({ ...selectedCafe, name: selectedCafe.name, address: selectedCafe.address, lat: selectedCafe.lat, lng: selectedCafe.lng });
      savedCafeId = saved.id;
      cafeForLog = { id: saved.id, name: saved.name, address: saved.address, lat: saved.lat, lng: saved.lng };
      savedCafeForCallback = saved;
    } else if (cafe && (!cafeId || !cafe.id)) {
      const saved = saveCafe({
        ...cafe,
        name: cafe.name || cafeName,
        address: cafe.address,
        lat: cafe.lat,
        lng: cafe.lng,
        classification: classification ?? undefined,
      });
      savedCafeId = saved.id;
      cafeForLog = { id: saved.id, name: saved.name, address: saved.address, lat: saved.lat, lng: saved.lng };
      savedCafeForCallback = saved;
    }

    try {
      await saveLog({
        cafeId: savedCafeId || undefined,
        cafe: cafeForLog,
        brandId: selectedBrand ? selectedBrand.id : undefined,
        brandName: selectedBrand ? selectedBrand.name : undefined,
        popupId: selectedPopUp ? selectedPopUp.id : undefined,
        drinkName,
        notes,
        photos: photosBase64.length ? photosBase64 : undefined,
        photo: photosBase64[0] || null,
        createdAt,
      });
    } catch (err) {
      console.error(err);
      alert('Failed to save. Try again.');
      return;
    }

    overlay.classList.add('hidden');
    onClose?.(savedCafeForCallback);
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
