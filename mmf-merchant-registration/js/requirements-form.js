import {
    COLLECTION_NAME,
    REQUIREMENTS_COLLECTION,
    STORAGE_REQUIREMENTS_PREFIX,
    VISITORS_COLLECTION,
    EVENT,
} from './config.js';
import { initFirebase, makeSubmissionId, safeFilename } from './firebase.js';

const STEPS = 4;
const ENFORCE_VALIDATION = false;
const DRAFT_KEY = 'mmf_merchant_req_draft_v1';
const REMOTE_ID_KEY = 'mmf_merchant_req_remote_id';
const VISITOR_ID_KEY = 'mmf_merchant_req_visitor_id';
const DRAFT_FILE_MAX_BYTES = 2.5 * 1024 * 1024;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let currentPage = 0;
let maxPageReached = 0;
const attemptedSteps = new Set();
let submitting = false;
let registeredMerchants = [];
let selectedRegistration = null;
let saveDraftTimer = null;
let remoteSyncTimer = null;
let remoteSyncGeneration = 0;
let restoringDraft = false;
let alreadySubmitted = false;
let loadingRequirements = false;
let formLocked = false;
let brandLoadGeneration = 0;

const TEXT_FIELD_IDS = [
    'brandVideoLinks',
    'heroDrink',
    'exclusivePromo',
    'exDealItems',
    'preEventShootLocations',
    'ingressEquipmentMaterials',
    'crewNames',
    'boothNotes',
    'sellingOtherText',
];

/** @type {Record<string, File|null>} */
const singleFiles = {
    logoSquareDark: null,
    logoSquareLight: null,
    logoWideDark: null,
    logoWideLight: null,
};

/** @type {Record<string, File[]>} */
const multiFiles = {
    menuPhotos: [],
    productPhotos: [],
    brandVideos: [],
    boothLayout: [],
};

/** @type {Record<string, {url:string,path?:string,name:string}|null>} */
const savedSingleFiles = {
    logoSquareDark: null,
    logoSquareLight: null,
    logoWideDark: null,
    logoWideLight: null,
};

/** @type {Record<string, Array<{url:string,path?:string,name:string}>>} */
const savedMultiFiles = {
    menuPhotos: [],
    productPhotos: [],
    brandVideos: [],
    boothLayout: [],
};

const SINGLE_FILE_MAP = {
    logoSquareDark: { zone: 'logoSquareDarkZone', input: 'logoSquareDark', preview: 'logoSquareDarkPreview', thumb: 'logoSquareDarkThumb', name: 'logoSquareDarkName' },
    logoSquareLight: { zone: 'logoSquareLightZone', input: 'logoSquareLight', preview: 'logoSquareLightPreview', thumb: 'logoSquareLightThumb', name: 'logoSquareLightName' },
    logoWideDark: { zone: 'logoWideDarkZone', input: 'logoWideDark', preview: 'logoWideDarkPreview', thumb: 'logoWideDarkThumb', name: 'logoWideDarkName' },
    logoWideLight: { zone: 'logoWideLightZone', input: 'logoWideLight', preview: 'logoWideLightPreview', thumb: 'logoWideLightThumb', name: 'logoWideLightName' },
};

const MULTI_FILE_MAP = {
    menuPhotos: { zone: 'menuPhotosZone', input: 'menuPhotos', list: 'menuPhotosList' },
    productPhotos: { zone: 'productPhotosZone', input: 'productPhotos', list: 'productPhotosList' },
    brandVideos: { zone: 'brandVideosZone', input: 'brandVideos', list: 'brandVideosList' },
    boothLayout: { zone: 'boothLayoutZone', input: 'boothLayout', list: 'boothLayoutList' },
};

function showScreen(id) {
    $$('.screen').forEach((el) => el.classList.remove('active'));
    $(`#${id}`)?.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showPage(page) {
    if (page < 0 || page >= STEPS) return;
    currentPage = page;
    maxPageReached = Math.max(maxPageReached, page);
    $$('.form-page').forEach((el) => {
        el.classList.toggle('hidden', Number(el.dataset.page) !== page);
    });
    updateStepper();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    scheduleSaveDraft();
}

function canGoToStep(page) {
    if (!ENFORCE_VALIDATION) return true;
    return page <= maxPageReached;
}

function setFieldError(fieldKey, message) {
    const wrap = document.querySelector(`[data-field="${fieldKey}"]`);
    if (!wrap) return;
    const err = wrap.querySelector('.field-error');
    if (message) {
        wrap.classList.add('invalid');
        if (err) {
            err.textContent = message;
            err.classList.add('visible');
        }
    } else {
        wrap.classList.remove('invalid');
        err?.classList.remove('visible');
    }
}

function collectEquipment() {
    return $$('#equipmentList .equipment-row')
        .map((row) => ({
            item: (row.querySelector('[name="equipmentItem"]')?.value || '').trim(),
            watts: (row.querySelector('[name="equipmentWatts"]')?.value || '').trim(),
        }))
        .filter((row) => row.item || row.watts);
}

function hasCompleteEquipment() {
    const rows = collectEquipment();
    return rows.length > 0 && rows.every((row) => row.item && row.watts);
}

function createEquipmentRow(item = '', watts = '', { removable = true } = {}) {
    const row = document.createElement('div');
    row.className = 'equipment-row';
    row.innerHTML = `
        <input class="input" type="text" name="equipmentItem" placeholder="Item">
        <div class="input-with-unit">
            <input class="input" type="text" name="equipmentWatts" inputmode="numeric" placeholder="0" aria-label="Wattage">
            <span class="input-unit">W</span>
        </div>
        ${
            removable
                ? '<button type="button" class="btn-remove-equipment" aria-label="Remove equipment">×</button>'
                : '<span class="equipment-remove-spacer" aria-hidden="true"></span>'
        }
    `;
    const itemInput = row.querySelector('[name="equipmentItem"]');
    const wattsInput = row.querySelector('[name="equipmentWatts"]');
    if (itemInput) itemInput.value = item;
    if (wattsInput) wattsInput.value = watts;
    row.querySelector('.btn-remove-equipment')?.addEventListener('click', () => {
        row.remove();
        updateStepper();
        scheduleSaveDraft();
    });
    return row;
}

function addEquipmentRow(item = '', watts = '', options = { removable: true }) {
    const list = $('#equipmentList');
    if (!list) return;
    list.appendChild(createEquipmentRow(item, watts, options));
    updateStepper();
    scheduleSaveDraft();
}

function wireEquipmentList() {
    const list = $('#equipmentList');
    if (!list) return;
    if (!list.children.length) addEquipmentRow('', '', { removable: false });
    $('#addEquipment')?.addEventListener('click', () => addEquipmentRow('', '', { removable: true }));
    list.addEventListener('input', () => {
        updateStepper();
        scheduleSaveDraft();
    });
}

function collectSellingCategories() {
    return $$('input[name="sellingCategory"]:checked').map((el) => el.value);
}

function syncSellingOtherField() {
    const otherChecked = Boolean($('#sellOther')?.checked);
    const otherInput = $('#sellingOtherText');
    if (!otherInput) return;
    otherInput.hidden = !otherChecked;
    if (!otherChecked) otherInput.value = '';
}

function hasSingleFile(key) {
    return Boolean(singleFiles[key] || savedSingleFiles[key]);
}

function hasAnyLogoFile() {
    return Object.keys(SINGLE_FILE_MAP).some((key) => hasSingleFile(key));
}

function hasMultiFiles(key) {
    return (multiFiles[key]?.length || 0) + (savedMultiFiles[key]?.length || 0) > 0;
}

function normalizeFileMeta(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') return { url: entry, name: 'file', path: '' };
    if (entry.url) {
        return {
            url: entry.url,
            path: entry.path || '',
            name: entry.name || 'file',
        };
    }
    return null;
}

function normalizeFileList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(normalizeFileMeta).filter(Boolean);
    const one = normalizeFileMeta(value);
    return one ? [one] : [];
}

function looksLikeImage(meta) {
    const name = (meta?.name || meta?.url || '').toLowerCase();
    return /\.(png|jpe?g|gif|webp|svg|bmp|heic)(\?|$)/i.test(name);
}

function applySavedFiles(files = {}) {
    for (const key of Object.keys(SINGLE_FILE_MAP)) {
        savedSingleFiles[key] = normalizeFileMeta(files[key]);
        updateSinglePreview(key);
    }
    for (const key of Object.keys(MULTI_FILE_MAP)) {
        savedMultiFiles[key] = normalizeFileList(files[key]);
        renderMultiFileList(key);
    }
}

function clearLocalFileObjects() {
    for (const key of Object.keys(SINGLE_FILE_MAP)) {
        singleFiles[key] = null;
        const input = $(`#${SINGLE_FILE_MAP[key].input}`);
        if (input) input.value = '';
    }
    for (const key of Object.keys(MULTI_FILE_MAP)) {
        multiFiles[key] = [];
        const input = $(`#${MULTI_FILE_MAP[key].input}`);
        if (input) input.value = '';
    }
}

function collectMergedFileUrls(uploaded = {}) {
    const fileUrls = {};
    for (const key of Object.keys(SINGLE_FILE_MAP)) {
        if (uploaded[key]) fileUrls[key] = uploaded[key];
        else if (singleFiles[key]) {
            // Local replacement not uploaded yet — keep prior saved for remote sync
            fileUrls[key] = savedSingleFiles[key] || null;
        } else if (savedSingleFiles[key]) fileUrls[key] = savedSingleFiles[key];
        else fileUrls[key] = null;
    }
    for (const key of Object.keys(MULTI_FILE_MAP)) {
        const kept = savedMultiFiles[key] || [];
        const added = uploaded[key] || [];
        fileUrls[key] = [...kept, ...added];
    }
    return fileUrls;
}

function updateSubmitButtonLabel() {
    const btn = $('#btnSubmit');
    if (!btn || submitting) return;
    btn.textContent = alreadySubmitted ? 'Update' : 'Submit';
}

function isPageComplete(page) {
    if (page === 0) return Boolean(selectedRegistration) && hasAnyLogoFile();
    if (page === 1) {
        if (!collectSellingCategories().length) return false;
        if (!hasMultiFiles('menuPhotos')) return false;
        if (!hasMultiFiles('productPhotos')) return false;
        return true;
    }
    if (page === 2) {
        if (!($('#exDealItems')?.value || '').trim()) return false;
        return true;
    }
    if (page === 3) {
        if (!hasMultiFiles('boothLayout')) return false;
        if (!hasCompleteEquipment()) return false;
        if (!($('#ingressEquipmentMaterials')?.value || '').trim()) return false;
        if (!($('#crewNames')?.value || '').trim()) return false;
        return Boolean($('#confirmRequirements')?.checked);
    }
    return false;
}

function updateStepper() {
    $$('#stepper .step').forEach((step) => {
        const i = Number(step.dataset.step);
        const isCurrent = i === currentPage;
        const attempted = attemptedSteps.has(i);
        const complete = isPageComplete(i);
        step.classList.toggle('active', isCurrent);
        step.classList.toggle('done', attempted && complete && !isCurrent);
        step.classList.toggle('incomplete', attempted && !complete && !isCurrent);
        const clickable = canGoToStep(i);
        step.classList.toggle('step-disabled', !clickable);
        step.setAttribute('aria-disabled', clickable ? 'false' : 'true');
        step.tabIndex = clickable ? 0 : -1;
    });

    const incomplete = [...attemptedSteps]
        .filter((p) => p !== currentPage && !isPageComplete(p))
        .sort((a, b) => a - b);
    if (incomplete.length) showSkipWarning(incomplete);
    else hideSkipWarning();
}

function validatePage(page) {
    let ok = true;
    const clear = (key) => setFieldError(key, '');

    if (page === 0) {
        clear('merchantSelect');
        clear('logoFiles');
        if (!selectedRegistration) {
            setFieldError('merchantSelect', 'Select your brand');
            ok = false;
        }
        if (!hasAnyLogoFile()) {
            setFieldError('logoFiles', 'Upload at least one logo file');
            ok = false;
        }
        return ok;
    }

    if (page === 1) {
        ['sellingCategories', 'menuPhotos', 'productPhotos'].forEach(clear);
        if (!collectSellingCategories().length) {
            setFieldError('sellingCategories', 'Select at least one');
            ok = false;
        }
        if (!hasMultiFiles('menuPhotos')) {
            setFieldError('menuPhotos', 'Upload at least one menu photo');
            ok = false;
        }
        if (!hasMultiFiles('productPhotos')) {
            setFieldError('productPhotos', 'Upload at least one product photo');
            ok = false;
        }
    }

    if (page === 2) {
        clear('exDealItems');
        if (!($('#exDealItems')?.value || '').trim()) {
            setFieldError('exDealItems', 'Field is required');
            ok = false;
        }
    }

    if (page === 3) {
        ['equipmentList', 'ingressEquipmentMaterials', 'crewNames', 'boothLayout'].forEach(clear);
        $('#confirmRequirementsError')?.classList.remove('visible');
        if (!hasMultiFiles('boothLayout')) {
            setFieldError('boothLayout', 'Upload at least one booth photo');
            ok = false;
        }
        if (!hasCompleteEquipment()) {
            setFieldError('equipmentList', 'Add at least one item with wattage');
            ok = false;
        }
        if (!($('#ingressEquipmentMaterials')?.value || '').trim()) {
            setFieldError('ingressEquipmentMaterials', 'Field is required');
            ok = false;
        }
        if (!($('#crewNames')?.value || '').trim()) {
            setFieldError('crewNames', 'Field is required');
            ok = false;
        }
        if (!$('#confirmRequirements')?.checked) {
            $('#confirmRequirementsError')?.classList.add('visible');
            ok = false;
        }
    }

    return ok;
}

const PAGE_LABELS = ['Brand Assets', 'Sales', 'Promotions', 'Logistics'];

function hideSkipWarning() {
    const el = $('#stepSkipWarning');
    if (!el) return;
    el.classList.add('hidden');
    el.textContent = '';
}

function showSkipWarning(incompletePages) {
    const el = $('#stepSkipWarning');
    if (!el) return;
    const labels = incompletePages.map((p) => PAGE_LABELS[p] || `Step ${p + 1}`);
    if (!labels.length) {
        hideSkipWarning();
        return;
    }
    const list =
        labels.length === 1
            ? labels[0]
            : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
    el.textContent = `${list} still ${labels.length === 1 ? 'has' : 'have'} required fields to complete.`;
    el.classList.remove('hidden');
}

function markPageAttempted(page) {
    attemptedSteps.add(page);
    validatePage(page);
}

function incompletePagesBefore(targetPage) {
    const pages = [];
    for (let p = 0; p < targetPage; p++) {
        markPageAttempted(p);
        if (!isPageComplete(p)) pages.push(p);
    }
    return pages;
}

function goToStep(page) {
    if (page < 0 || page >= STEPS || !canGoToStep(page)) return;
    const leaving = currentPage;
    markPageAttempted(leaving);

    if (page > leaving) {
        const incomplete = incompletePagesBefore(page);
        if (!isPageComplete(leaving) && !incomplete.includes(leaving)) incomplete.unshift(leaving);
        showSkipWarning(incomplete);
    } else if (!isPageComplete(leaving)) {
        showSkipWarning([leaving]);
    } else {
        hideSkipWarning();
    }

    showPage(page);
}

function goNext() {
    markPageAttempted(currentPage);
    if (!isPageComplete(currentPage)) {
        showSkipWarning([currentPage]);
    } else {
        hideSkipWarning();
    }
    if (currentPage < STEPS - 1) showPage(currentPage + 1);
    else updateStepper();
}

function updateSinglePreview(key) {
    const cfg = SINGLE_FILE_MAP[key];
    const file = singleFiles[key];
    const saved = savedSingleFiles[key];
    const preview = $(`#${cfg.preview}`);
    const thumb = $(`#${cfg.thumb}`);
    const name = $(`#${cfg.name}`);
    if (!file && !saved) {
        preview?.classList.remove('visible');
        thumb?.removeAttribute('src');
        return;
    }
    name.textContent = file?.name || saved?.name || 'file';
    preview?.classList.add('visible');
    if (file?.type?.startsWith('image/') && thumb) {
        thumb.style.display = '';
        thumb.src = URL.createObjectURL(file);
    } else if (!file && saved && looksLikeImage(saved) && thumb) {
        thumb.style.display = '';
        thumb.src = saved.url;
    } else if (thumb) {
        thumb.style.display = 'none';
    }
    setFieldError(key, '');
    if (Object.keys(SINGLE_FILE_MAP).includes(key) && hasAnyLogoFile()) {
        setFieldError('logoFiles', '');
    }
    updateStepper();
}

function setSingleFile(key, file) {
    singleFiles[key] = file || null;
    if (file) {
        // Keep saved until submit succeeds so refresh mid-edit still has the old file.
        // Local file takes preview priority.
    } else {
        savedSingleFiles[key] = null;
    }
    updateSinglePreview(key);
    scheduleSaveDraft();
}

function wireSingleUpload(key) {
    const cfg = SINGLE_FILE_MAP[key];
    const zone = $(`#${cfg.zone}`);
    const input = $(`#${cfg.input}`);
    if (!zone || !input) return;

    const open = () => input.click();
    zone.addEventListener('click', open);
    zone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
        }
    });
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) setSingleFile(key, file);
    });
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const file = e.dataTransfer?.files?.[0];
        if (file) setSingleFile(key, file);
    });
}

function renderMultiFileList(key) {
    const cfg = MULTI_FILE_MAP[key];
    const list = $(`#${cfg.list}`);
    if (!list) return;
    const saved = savedMultiFiles[key] || [];
    const local = multiFiles[key] || [];
    const items = [
        ...saved.map((file, i) => ({ kind: 'saved', index: i, name: file.name, url: file.url })),
        ...local.map((file, i) => ({ kind: 'local', index: i, name: file.name, url: '' })),
    ];
    list.innerHTML = items
        .map(
            (item) =>
                `<li>
                    ${
                        item.url && looksLikeImage(item)
                            ? `<img class="upload-list-thumb" src="${escapeHtml(item.url)}" alt="">`
                            : ''
                    }
                    <span>${escapeHtml(item.name)}</span>
                    <button type="button" class="remove" data-multi-kind="${item.kind}" data-multi-key="${key}" data-multi-index="${item.index}">Remove</button>
                </li>`
        )
        .join('');
    list.querySelectorAll('[data-multi-index]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.multiIndex);
            const fileKey = btn.dataset.multiKey;
            const kind = btn.dataset.multiKind;
            if (kind === 'saved') savedMultiFiles[fileKey].splice(idx, 1);
            else multiFiles[fileKey].splice(idx, 1);
            renderMultiFileList(fileKey);
            setFieldError(fileKey, hasMultiFiles(fileKey) ? '' : null);
            updateStepper();
            scheduleSaveDraft();
        });
    });
}

function addMultiFiles(key, files) {
    for (const file of files) {
        const isImage = file.type.startsWith('image/');
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        const isVideo =
            file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
        const allowed =
            key === 'brandVideos'
                ? isVideo
                : key === 'productPhotos'
                  ? isImage
                  : isImage || isPdf;
        if (allowed) multiFiles[key].push(file);
    }
    renderMultiFileList(key);
    setFieldError(key, hasMultiFiles(key) ? '' : null);
    updateStepper();
    scheduleSaveDraft();
}

function wireMultiUpload(key) {
    const cfg = MULTI_FILE_MAP[key];
    const zone = $(`#${cfg.zone}`);
    const input = $(`#${cfg.input}`);
    if (!zone || !input) return;

    const open = () => input.click();
    zone.addEventListener('click', open);
    zone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
        }
    });
    input.addEventListener('change', () => {
        if (input.files?.length) addMultiFiles(key, [...input.files]);
        input.value = '';
    });
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer?.files?.length) addMultiFiles(key, [...e.dataTransfer.files]);
    });
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function uploadFile(storage, storageFns, submissionId, folder, file) {
    const path = `${STORAGE_REQUIREMENTS_PREFIX}/${submissionId}/${folder}/${safeFilename(file.name)}`;
    const ref = storageFns.ref(storage, path);
    await storageFns.uploadBytes(ref, file, {
        contentType: file.type || undefined,
    });
    const url = await storageFns.getDownloadURL(ref);
    const out = {
        url,
        path,
        name: file.name,
        type: file.type || '',
    };

    try {
        const bg = /logo(Square|Wide)Dark/i.test(folder) ? 'dark' : 'light';
        const thumbBlob = await createImageThumbnailBlob(file);
        if (thumbBlob) {
            const baseName = safeFilename(file.name).replace(/\.[^.]+$/, '') || 'image';
            const ext = thumbBlob.type === 'image/webp' ? 'webp' : 'png';
            const thumbPath = `${STORAGE_REQUIREMENTS_PREFIX}/${submissionId}/${folder}/thumbs/v4/${bg}-${baseName}.${ext}`;
            const thumbRef = storageFns.ref(storage, thumbPath);
            await storageFns.uploadBytes(thumbRef, thumbBlob, { contentType: thumbBlob.type || 'image/png' });
            out.thumbUrl = await storageFns.getDownloadURL(thumbRef);
            out.thumbPath = thumbPath;
            out.thumbBg = bg;
        }
    } catch (err) {
        console.warn('[MMF Requirements] thumbnail upload skipped', err);
    }

    return out;
}

async function createImageThumbnailBlob(file, { maxEdge = 200, quality = 0.72 } = {}) {
    if (!file?.type?.startsWith('image/') || /image\/(svg|gif)/i.test(file.type)) return null;
    if (typeof createImageBitmap !== 'function') return null;

    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return null;
        // Keep transparency — preview CSS supplies light/dark backgrounds.
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0, width, height);
        const blob = await new Promise((resolve) => {
            const done = (value) => resolve(value);
            if (canvas.toBlob.length >= 2) {
                canvas.toBlob((value) => {
                    if (value) done(value);
                    else canvas.toBlob(done, 'image/png');
                }, 'image/webp', quality);
            } else {
                done(null);
            }
        });
        return blob && blob.size > 0 ? blob : null;
    } finally {
        bitmap.close?.();
    }
}

async function uploadMany(storage, storageFns, submissionId, folder, files) {
    const out = [];
    for (const file of files) {
        out.push(await uploadFile(storage, storageFns, submissionId, folder, file));
    }
    return out;
}

function collectBrandVideoLinks() {
    return ($('#brandVideoLinks')?.value || '')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function setBrandVideoMode(mode) {
    const next = mode === 'upload' ? 'upload' : 'links';
    $$('#brandVideoModeToggle .input-mode-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === next);
    });
    $('#brandVideoLinksPanel')?.classList.toggle('hidden', next !== 'links');
    $('#brandVideoUploadPanel')?.classList.toggle('hidden', next !== 'upload');
    scheduleSaveDraft();
}

function wireBrandVideoModeToggle() {
    $('#brandVideoModeToggle')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.input-mode-btn');
        if (!btn?.dataset.mode) return;
        setBrandVideoMode(btn.dataset.mode);
    });
}

function isSubmittedRegistration(doc) {
    return doc.submissionState === 'submitted' || (!doc.submissionState && doc.status);
}

async function loadRegisteredMerchants() {
    const select = $('#merchantSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Loading brands…</option>';

    try {
        const { db, firestoreFns } = await initFirebase();
        const snap = await firestoreFns.getDocs(firestoreFns.collection(db, COLLECTION_NAME));
        registeredMerchants = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((doc) => isSubmittedRegistration(doc) && !doc.archived)
            .sort((a, b) => (a.brandName || '').localeCompare(b.brandName || '', undefined, { sensitivity: 'base' }));

        const seenBrands = new Set();
        registeredMerchants = registeredMerchants.filter((m) => {
            const key = (m.brandName || '').trim().toLowerCase();
            if (!key || seenBrands.has(key)) return false;
            seenBrands.add(key);
            return true;
        });

        if (!registeredMerchants.length) {
            select.innerHTML = '<option value="">No registered brands yet</option>';
            return;
        }

        select.innerHTML =
            '<option value="">Select your brand…</option>' +
            registeredMerchants
                .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.brandName || 'Untitled brand')}</option>`)
                .join('');
    } catch (err) {
        console.error('[MMF Requirements] load merchants failed', err);
        select.innerHTML = '<option value="">Could not load brands</option>';
    }
}

function countRequirementFiles(files = {}) {
    return Object.values(files).reduce((n, value) => {
        if (!value) return n;
        if (Array.isArray(value)) return n + value.length;
        if (typeof value === 'object' && value.url) return n + 1;
        if (typeof value === 'string') return n + 1;
        return n;
    }, 0);
}

function scoreRequirementsDoc(doc) {
    if (!doc) return -1;
    let score = 0;
    if (doc.submissionState === 'submitted') score += 1000;
    else if (doc.submissionState === 'draft') score += 100;
    else score += 200; // legacy docs without submissionState
    score += countRequirementFiles(doc.files) * 20;
    if (Array.isArray(doc.equipment) && doc.equipment.length) score += 10;
    if ((doc.crewNames || '').trim()) score += 5;
    if ((doc.exDealItems || '').trim()) score += 5;
    if (Array.isArray(doc.sellingCategories) && doc.sellingCategories.length) score += 5;
    if (doc.updatedAt?.seconds) score += Math.min(doc.updatedAt.seconds / 1e12, 1);
    return score;
}

function pickBestRequirementsDoc(docs) {
    if (!docs?.length) return null;
    return [...docs].sort((a, b) => scoreRequirementsDoc(b) - scoreRequirementsDoc(a))[0] || null;
}

async function findRequirementsDoc(registrationId) {
    try {
        const { db, firestoreFns } = await initFirebase();
        const snap = await firestoreFns.getDocs(firestoreFns.collection(db, REQUIREMENTS_COLLECTION));
        const all = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((doc) => !doc.archived);

        let matches = [];
        if (registrationId) {
            matches = all.filter((doc) => doc.registrationId === registrationId);
        }

        // Fallback: same brand name (covers re-registration / mismatched ids)
        if (!matches.length && selectedRegistration?.brandName) {
            const brand = selectedRegistration.brandName.trim().toLowerCase();
            matches = all.filter((doc) => (doc.brandName || '').trim().toLowerCase() === brand);
        }

        if (!matches.length) {
            const remoteId = getRemoteDraftId();
            if (!remoteId) return null;
            const remote = all.find((doc) => doc.id === remoteId);
            if (!remote) return null;
            if (registrationId && remote.registrationId && remote.registrationId !== registrationId) {
                return null;
            }
            return remote;
        }

        const best = pickBestRequirementsDoc(matches);
        const remoteId = getRemoteDraftId();
        // Prefer the richer brand match over a stale empty local draft id
        if (remoteId && best && remoteId !== best.id && scoreRequirementsDoc(best) > 0) {
            setRemoteDraftId(best.id);
        }
        return best;
    } catch (err) {
        console.warn('[MMF Requirements] find requirements failed', err);
        return null;
    }
}

function applyRequirementsFields(doc) {
    if (!doc) return;

    const fieldMap = {
        brandVideoLinks: Array.isArray(doc.brandVideoLinks)
            ? doc.brandVideoLinks.join('\n')
            : doc.brandVideoLinks || '',
        heroDrink: doc.heroDrink || '',
        exclusivePromo: doc.exclusivePromo || '',
        exDealItems: doc.exDealItems || '',
        preEventShootLocations: doc.preEventShootLocations || '',
        ingressEquipmentMaterials: doc.ingressEquipmentMaterials || '',
        crewNames: doc.crewNames || '',
        boothNotes: [doc.boothNotes, doc.logisticsNotes].filter(Boolean).join('\n\n'),
        sellingOtherText: doc.sellingOtherText || '',
    };

    for (const [id, value] of Object.entries(fieldMap)) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    $$('input[name="sellingCategory"]').forEach((el) => {
        el.checked = Array.isArray(doc.sellingCategories) && doc.sellingCategories.includes(el.value);
    });
    syncSellingOtherField();

    if ($('#confirmRequirements')) {
        $('#confirmRequirements').checked = doc.submissionState === 'submitted' || Boolean(doc.confirmRequirements);
    }

    restoreEquipment(doc.equipment);
    setBrandVideoMode(
        Array.isArray(doc.files?.brandVideos) && doc.files.brandVideos.length ? 'upload' : getBrandVideoMode()
    );

    if (doc.draftMeta) {
        if (typeof doc.draftMeta.currentPage === 'number') currentPage = doc.draftMeta.currentPage;
        if (typeof doc.draftMeta.maxPageReached === 'number') maxPageReached = doc.draftMeta.maxPageReached;
    }
}

function setFormLocked(locked, message = 'Loading brand…') {
    formLocked = locked;
    const shell = document.querySelector('#screen-form .form-shell');
    if (shell) {
        shell.classList.toggle('is-brand-loading', locked);
        if (locked) shell.setAttribute('data-loading-message', message);
        else shell.removeAttribute('data-loading-message');
    }

    const welcome = document.querySelector('#screen-welcome .welcome');
    if (welcome) {
        welcome.classList.toggle('is-brand-loading', locked);
        if (locked) welcome.setAttribute('data-loading-message', message);
        else welcome.removeAttribute('data-loading-message');
    }

    const select = $('#merchantSelect');
    if (select) select.disabled = locked;
}

function updateSelectedBrandLabel() {
    const label = $('#selectedBrandName');
    if (label) label.textContent = selectedRegistration?.brandName || '—';
}

function clearFormState() {
    for (const id of TEXT_FIELD_IDS) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    }

    $$('input[name="sellingCategory"]').forEach((el) => {
        el.checked = false;
    });
    syncSellingOtherField();

    if ($('#confirmRequirements')) $('#confirmRequirements').checked = false;

    clearLocalFileObjects();
    applySavedFiles({});
    restoreEquipment([]);
    setBrandVideoMode('links');

    alreadySubmitted = false;
    updateSubmitButtonLabel();
    attemptedSteps.clear();
    hideSkipWarning();
    updateStepper();
}

function hasMeaningfulFormData() {
    for (const id of TEXT_FIELD_IDS) {
        if ((document.getElementById(id)?.value || '').trim()) return true;
    }
    if (collectSellingCategories().length) return true;
    if (collectEquipment().some((row) => row.item || row.watts)) return true;
    if (Object.keys(SINGLE_FILE_MAP).some((key) => hasSingleFile(key))) return true;
    if (Object.keys(MULTI_FILE_MAP).some((key) => hasMultiFiles(key))) return true;
    if ($('#confirmRequirements')?.checked) return true;
    return false;
}

async function loadRequirementsForSelection(registrationId, { preferRemoteFields = true } = {}) {
    if (!registrationId) return;
    loadingRequirements = true;
    const wasRestoring = restoringDraft;
    restoringDraft = true;
    try {
        const doc = await findRequirementsDoc(registrationId);
        if (!doc) {
            localStorage.removeItem(REMOTE_ID_KEY);
            alreadySubmitted = false;
            clearFormState();
            // Keep brand selection after clear
            const select = $('#merchantSelect');
            if (select) select.value = registrationId;
            selectedRegistration = registeredMerchants.find((m) => m.id === registrationId) || selectedRegistration;
            updateSubmitButtonLabel();
            return;
        }

        setRemoteDraftId(doc.id);
        alreadySubmitted =
            doc.submissionState === 'submitted' ||
            (!doc.submissionState && countRequirementFiles(doc.files) > 0);
        updateSubmitButtonLabel();

        clearLocalFileObjects();
        if (preferRemoteFields) applyRequirementsFields(doc);
        applySavedFiles(doc.files || {});
        updateStepper();
    } finally {
        restoringDraft = wasRestoring;
        loadingRequirements = false;
    }
}

async function onMerchantSelect() {
    const nextId = $('#merchantSelect')?.value || '';
    const previous = selectedRegistration;
    const gen = ++brandLoadGeneration;

    cancelRemoteSync();
    clearTimeout(saveDraftTimer);
    setFormLocked(true, previous && previous.id !== nextId ? 'Switching brand…' : 'Loading brand…');

    try {
        // Persist the previous brand before wiping the form, so work isn't lost or copied
        if (previous?.id && previous.id !== nextId && hasMeaningfulFormData()) {
            try {
                await syncRemoteDraft(remoteSyncGeneration, { force: true });
            } catch (err) {
                console.warn('[MMF Requirements] flush previous brand failed', err);
            }
        }

        if (gen !== brandLoadGeneration) return;

        selectedRegistration = registeredMerchants.find((m) => m.id === nextId) || null;
        setFieldError('merchantSelect', selectedRegistration ? '' : null);
        updateSelectedBrandLabel();

        // Detach from previous brand's remote doc before loading the next
        localStorage.removeItem(REMOTE_ID_KEY);
        clearFormState();
        updateSelectedBrandLabel();

        if (selectedRegistration) {
            const select = $('#merchantSelect');
            if (select) select.value = selectedRegistration.id;
            await loadRequirementsForSelection(selectedRegistration.id, { preferRemoteFields: true });
            updateSelectedBrandLabel();
        }

        if (gen !== brandLoadGeneration) return;
        updateStepper();
    } finally {
        if (gen === brandLoadGeneration) {
            setFormLocked(false);
            if (selectedRegistration) scheduleSaveDraft();
        }
    }
}

function collectPendingFiles() {
    const pending = {};
    for (const key of Object.keys(SINGLE_FILE_MAP)) {
        pending[key] = singleFiles[key]?.name || null;
    }
    for (const key of Object.keys(MULTI_FILE_MAP)) {
        pending[key] = multiFiles[key].map((file) => file.name);
    }
    return pending;
}

function collectPayload(fileUrls = null, { asDraft = false } = {}) {
    const categories = collectSellingCategories();
    const payload = {
        formType: 'merchant_requirements',
        registrationId: selectedRegistration?.id || '',
        brandName: selectedRegistration?.brandName || '',
        registrationEmail: selectedRegistration?.email || '',
        equipment: collectEquipment(),
        ingressEquipmentMaterials: ($('#ingressEquipmentMaterials')?.value || '').trim(),
        crewNames: ($('#crewNames')?.value || '').trim(),
        boothNotes: ($('#boothNotes')?.value || '').trim(),
        sellingCategories: categories,
        sellingOtherText: categories.includes('other') ? ($('#sellingOtherText')?.value || '').trim() : '',
        brandVideoLinks: collectBrandVideoLinks(),
        heroDrink: ($('#heroDrink')?.value || '').trim(),
        exclusivePromo: ($('#exclusivePromo')?.value || '').trim(),
        preEventShootLocations: ($('#preEventShootLocations')?.value || '').trim(),
        exDealItems: ($('#exDealItems')?.value || '').trim(),
        eventSnapshot: {
            name: EVENT.name,
            dates: EVENT.dates,
            venue: EVENT.venue,
        },
        submissionState: asDraft ? 'draft' : 'submitted',
        source: 'mmf-merchant-requirements',
    };

    if (fileUrls) payload.files = fileUrls;
    if (asDraft) {
        payload.draftMeta = {
            currentPage,
            maxPageReached,
            screen: getActiveScreenId(),
        };
        payload.pendingFiles = collectPendingFiles();
    } else {
        payload.draftMeta = null;
        payload.pendingFiles = null;
    }

    return payload;
}

function hasAnyFormData() {
    if (selectedRegistration || ($('#merchantSelect')?.value || '').trim()) return true;
    for (const id of TEXT_FIELD_IDS) {
        if ((document.getElementById(id)?.value || '').trim()) return true;
    }
    if (collectSellingCategories().length) return true;
    if (collectEquipment().some((row) => row.item || row.watts)) return true;
    if (Object.keys(SINGLE_FILE_MAP).some((key) => hasSingleFile(key))) return true;
    if (Object.keys(MULTI_FILE_MAP).some((key) => hasMultiFiles(key))) return true;
    if ($('#confirmRequirements')?.checked) return true;
    return false;
}

function getRemoteDraftId() {
    return localStorage.getItem(REMOTE_ID_KEY) || null;
}

function setRemoteDraftId(id) {
    if (id) localStorage.setItem(REMOTE_ID_KEY, id);
}

function getVisitorId() {
    let id = localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
        id = makeSubmissionId();
        localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
}

async function trackPageView() {
    try {
        const { db, firestoreFns } = await initFirebase();
        const visitorId = getVisitorId();
        const docRef = firestoreFns.doc(db, VISITORS_COLLECTION, visitorId);
        const existing = await firestoreFns.getDoc(docRef);
        const payload = {
            id: visitorId,
            lastSeen: firestoreFns.serverTimestamp(),
            path: window.location.pathname || '/requirements',
            source: 'mmf-merchant-requirements',
        };
        if (!existing.exists()) {
            payload.firstSeen = firestoreFns.serverTimestamp();
        }
        await firestoreFns.setDoc(docRef, payload, { merge: true });
    } catch (err) {
        console.warn('[MMF Requirements] page view track failed', err);
    }
}

function scheduleRemoteSync() {
    clearTimeout(remoteSyncTimer);
    const generation = ++remoteSyncGeneration;
    remoteSyncTimer = setTimeout(() => {
        syncRemoteDraft(generation);
    }, 600);
}

function cancelRemoteSync() {
    clearTimeout(remoteSyncTimer);
    remoteSyncTimer = null;
    remoteSyncGeneration += 1;
}

async function syncRemoteDraft(generation = remoteSyncGeneration, { force = false } = {}) {
    if (submitting || (!force && restoringDraft) || (!force && generation !== remoteSyncGeneration)) return;
    if (!force && (formLocked || loadingRequirements)) return;
    if (!force && getActiveScreenId() !== 'screen-form') return;
    if (!selectedRegistration?.id) return;
    if (!hasMeaningfulFormData()) return;

    try {
        const { db, firestoreFns } = await initFirebase();
        if (submitting || (!force && generation !== remoteSyncGeneration)) return;

        let id = getRemoteDraftId();
        if (!id) {
            id = makeSubmissionId();
            setRemoteDraftId(id);
        }

        const docRef = firestoreFns.doc(db, REQUIREMENTS_COLLECTION, id);
        const existing = await firestoreFns.getDoc(docRef);
        if (submitting || (!force && generation !== remoteSyncGeneration)) return;

        const existingData = existing.exists() ? existing.data() : null;
        // Never overwrite another brand's requirements doc
        if (
            existingData?.registrationId &&
            selectedRegistration?.id &&
            existingData.registrationId !== selectedRegistration.id
        ) {
            id = makeSubmissionId();
            setRemoteDraftId(id);
        }

        const targetRef = firestoreFns.doc(db, REQUIREMENTS_COLLECTION, id);
        const targetSnap = id === docRef.id ? existing : await firestoreFns.getDoc(targetRef);
        const targetData = targetSnap.exists() ? targetSnap.data() : null;
        if (
            targetData?.registrationId &&
            selectedRegistration?.id &&
            targetData.registrationId !== selectedRegistration.id
        ) {
            return;
        }

        const keepSubmitted = targetData?.submissionState === 'submitted' || alreadySubmitted;
        const payload = {
            ...collectPayload(collectMergedFileUrls(), { asDraft: !keepSubmitted }),
            id,
            updatedAt: firestoreFns.serverTimestamp(),
        };
        if (keepSubmitted) {
            payload.submissionState = 'submitted';
            payload.draftMeta = null;
            payload.pendingFiles = null;
        }
        if (!targetSnap.exists()) {
            payload.createdAt = firestoreFns.serverTimestamp();
        }

        if (submitting || (!force && generation !== remoteSyncGeneration)) return;
        await firestoreFns.setDoc(targetRef, payload, { merge: true });
    } catch (err) {
        console.warn('[MMF Requirements] remote draft sync failed', err);
    }
}

async function submitForm() {
    if (submitting) return;

    const firstBad = [0, 1, 2, 3].find((p) => !validatePage(p));
    if (firstBad !== undefined) {
        attemptedSteps.add(firstBad);
        showPage(firstBad);
        updateStepper();
        return;
    }

    const banner = $('#submitError');
    banner?.classList.remove('visible');
    const btn = $('#btnSubmit');
    submitting = true;
    cancelRemoteSync();
    if (btn) {
        btn.disabled = true;
        btn.textContent = alreadySubmitted ? 'Updating…' : 'Submitting…';
    }

    try {
        const { db, storage, firestoreFns, storageFns } = await initFirebase();
        const submissionId = getRemoteDraftId() || makeSubmissionId();
        setRemoteDraftId(submissionId);

        const uploaded = {};
        for (const key of Object.keys(SINGLE_FILE_MAP)) {
            if (singleFiles[key]) {
                uploaded[key] = await uploadFile(storage, storageFns, submissionId, key, singleFiles[key]);
            }
        }
        for (const key of Object.keys(MULTI_FILE_MAP)) {
            if (multiFiles[key].length) {
                uploaded[key] = await uploadMany(storage, storageFns, submissionId, key, multiFiles[key]);
            }
        }

        const fileUrls = collectMergedFileUrls(uploaded);

        const docRef = firestoreFns.doc(db, REQUIREMENTS_COLLECTION, submissionId);
        const existing = await firestoreFns.getDoc(docRef);
        await firestoreFns.setDoc(
            docRef,
            {
                ...collectPayload(fileUrls, { asDraft: false }),
                id: submissionId,
                submittedAt: firestoreFns.serverTimestamp(),
                updatedAt: firestoreFns.serverTimestamp(),
                ...(existing.exists() ? {} : { createdAt: firestoreFns.serverTimestamp() }),
            },
            { merge: true }
        );

        applySavedFiles(fileUrls);
        clearLocalFileObjects();
        alreadySubmitted = true;
        try {
            const draft = buildDraftSync();
            draft.screen = 'screen-thanks';
            localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        } catch (err) {
            console.warn('[MMF Requirements] post-submit draft save failed', err);
        }
        updateSubmitButtonLabel();
        showScreen('screen-thanks');
    } catch (err) {
        console.error('[MMF Requirements] submit failed', err);
        if (banner) {
            banner.textContent = err?.message || 'Something went wrong submitting your requirements. Please try again.';
            banner.classList.add('visible');
        }
    } finally {
        submitting = false;
        if (btn) {
            btn.disabled = false;
            updateSubmitButtonLabel();
        }
    }
}

function getActiveScreenId() {
    return document.querySelector('.screen.active')?.id || 'screen-welcome';
}

function getBrandVideoMode() {
    return $('#brandVideoModeToggle .input-mode-btn.active')?.dataset.mode || 'links';
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function fileToDraftEntry(file) {
    if (!file) return null;
    if (file.size > DRAFT_FILE_MAX_BYTES) {
        return { name: file.name, type: file.type, tooLarge: true };
    }
    return {
        name: file.name,
        type: file.type,
        dataUrl: await readFileAsDataUrl(file),
    };
}

async function draftEntryToFile(entry) {
    if (!entry?.dataUrl || entry.tooLarge) return null;
    const res = await fetch(entry.dataUrl);
    const blob = await res.blob();
    return new File([blob], entry.name, { type: entry.type || blob.type });
}

async function filesToDraftEntries(files) {
    const out = [];
    for (const file of files) {
        out.push(await fileToDraftEntry(file));
    }
    return out.filter(Boolean);
}

function buildDraftSync() {
    return {
        version: 2,
        savedAt: Date.now(),
        screen: getActiveScreenId(),
        currentPage,
        maxPageReached,
        attemptedSteps: [...attemptedSteps],
        registrationId: selectedRegistration?.id || $('#merchantSelect')?.value || '',
        brandVideoMode: getBrandVideoMode(),
        alreadySubmitted,
        fields: Object.fromEntries(TEXT_FIELD_IDS.map((id) => [id, document.getElementById(id)?.value ?? ''])),
        sellingCategories: collectSellingCategories(),
        confirmRequirements: Boolean($('#confirmRequirements')?.checked),
        equipment: collectEquipment(),
        savedSingleFiles: { ...savedSingleFiles },
        savedMultiFiles: Object.fromEntries(
            Object.keys(MULTI_FILE_MAP).map((key) => [key, [...(savedMultiFiles[key] || [])]])
        ),
        singleFiles: Object.fromEntries(
            Object.keys(SINGLE_FILE_MAP).map((key) => [
                key,
                singleFiles[key]
                    ? {
                          name: singleFiles[key].name,
                          type: singleFiles[key].type,
                          tooLarge: singleFiles[key].size > DRAFT_FILE_MAX_BYTES,
                      }
                    : null,
            ])
        ),
        multiFiles: Object.fromEntries(
            Object.keys(MULTI_FILE_MAP).map((key) => [
                key,
                multiFiles[key].map((file) => ({
                    name: file.name,
                    type: file.type,
                    tooLarge: file.size > DRAFT_FILE_MAX_BYTES,
                })),
            ])
        ),
    };
}

async function buildDraft() {
    const draft = buildDraftSync();
    const single = {};
    for (const key of Object.keys(SINGLE_FILE_MAP)) {
        single[key] = await fileToDraftEntry(singleFiles[key]);
    }
    const multi = {};
    for (const key of Object.keys(MULTI_FILE_MAP)) {
        multi[key] = await filesToDraftEntries(multiFiles[key]);
    }
    draft.singleFiles = single;
    draft.multiFiles = multi;
    return draft;
}

function saveDraftSync() {
    if (restoringDraft || submitting) return;
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(buildDraftSync()));
    } catch (err) {
        console.warn('[MMF Requirements] draft save failed', err);
    }
}

async function saveDraft() {
    if (restoringDraft || submitting) return;
    try {
        const draft = await buildDraft();
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (err) {
        console.warn('[MMF Requirements] draft save failed', err);
        saveDraftSync();
    }
}

function scheduleSaveDraft() {
    if (restoringDraft || submitting) return;
    clearTimeout(saveDraftTimer);
    saveDraftTimer = setTimeout(() => {
        saveDraft();
    }, 350);
    scheduleRemoteSync();
}

function clearDraft() {
    clearTimeout(saveDraftTimer);
    cancelRemoteSync();
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(REMOTE_ID_KEY);
}

function loadDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function restoreEquipment(rows) {
    const list = $('#equipmentList');
    if (!list) return;
    list.innerHTML = '';
    const items = Array.isArray(rows) && rows.length ? rows : [{ item: '', watts: '' }];
    items.forEach((row, index) => {
        addEquipmentRow(row.item || '', row.watts || '', { removable: index > 0 });
    });
}

function restoreDraftFields(draft) {
    for (const [id, value] of Object.entries(draft.fields || {})) {
        if (id === 'logisticsNotes') continue;
        const el = document.getElementById(id);
        if (el != null && value != null) el.value = value;
    }

    // Merge legacy "Questions or Concerns" into Notes
    const boothNotesEl = $('#boothNotes');
    if (boothNotesEl) {
        const notes = (draft.fields?.boothNotes || boothNotesEl.value || '').trim();
        const legacy = (draft.fields?.logisticsNotes || '').trim();
        if (legacy && !notes.includes(legacy)) {
            boothNotesEl.value = notes ? `${notes}\n\n${legacy}` : legacy;
        }
    }

    $$('input[name="sellingCategory"]').forEach((el) => {
        el.checked = Array.isArray(draft.sellingCategories) && draft.sellingCategories.includes(el.value);
    });
    syncSellingOtherField();

    if ($('#confirmRequirements')) {
        $('#confirmRequirements').checked = Boolean(draft.confirmRequirements);
    }

    if (draft.registrationId) {
        const select = $('#merchantSelect');
        if (select) select.value = draft.registrationId;
        selectedRegistration = registeredMerchants.find((m) => m.id === draft.registrationId) || null;
    }

    setBrandVideoMode(draft.brandVideoMode === 'upload' ? 'upload' : 'links');
    restoreEquipment(draft.equipment);

    if (typeof draft.currentPage === 'number') currentPage = draft.currentPage;
    if (typeof draft.maxPageReached === 'number') maxPageReached = draft.maxPageReached;
    attemptedSteps.clear();
    (draft.attemptedSteps || []).forEach((step) => attemptedSteps.add(step));
}

async function restoreDraftFiles(draft) {
    if (draft.savedSingleFiles || draft.savedMultiFiles) {
        for (const key of Object.keys(SINGLE_FILE_MAP)) {
            savedSingleFiles[key] = normalizeFileMeta(draft.savedSingleFiles?.[key]);
        }
        for (const key of Object.keys(MULTI_FILE_MAP)) {
            savedMultiFiles[key] = normalizeFileList(draft.savedMultiFiles?.[key]);
        }
    }

    for (const key of Object.keys(SINGLE_FILE_MAP)) {
        const entry = draft.singleFiles?.[key];
        if (!entry || entry.tooLarge) continue;
        const file = await draftEntryToFile(entry);
        if (file) singleFiles[key] = file;
    }

    for (const key of Object.keys(MULTI_FILE_MAP)) {
        const entries = Array.isArray(draft.multiFiles?.[key]) ? draft.multiFiles[key] : [];
        multiFiles[key] = [];
        for (const entry of entries) {
            if (!entry || entry.tooLarge) continue;
            const file = await draftEntryToFile(entry);
            if (file) multiFiles[key].push(file);
        }
    }

    // Migrate legacy single boothLayout drafts into the multi-upload list
    if (!multiFiles.boothLayout.length && !savedMultiFiles.boothLayout.length) {
        const legacy = draft.singleFiles?.boothLayout;
        if (legacy && !legacy.tooLarge) {
            const file = await draftEntryToFile(legacy);
            if (file) multiFiles.boothLayout = [file];
        }
    }

    for (const key of Object.keys(SINGLE_FILE_MAP)) updateSinglePreview(key);
    for (const key of Object.keys(MULTI_FILE_MAP)) renderMultiFileList(key);
}

async function restoreDraft() {
    const draft = loadDraft();
    if (draft) {
        restoreDraftFields(draft);
        await restoreDraftFiles(draft);
        alreadySubmitted = Boolean(draft.alreadySubmitted);
        updateSubmitButtonLabel();

        if (draft.screen === 'screen-form' || draft.screen === 'screen-thanks') {
            showScreen(draft.screen === 'screen-thanks' ? 'screen-thanks' : 'screen-form');
            if (draft.screen !== 'screen-thanks') {
                showPage(typeof draft.currentPage === 'number' ? draft.currentPage : 0);
            }
        }
        updateStepper();
    }

    const registrationId = draft?.registrationId || selectedRegistration?.id || $('#merchantSelect')?.value || '';
    if (registrationId) {
        await loadRequirementsForSelection(registrationId, { preferRemoteFields: true });
    } else if (getRemoteDraftId()) {
        const doc = await findRequirementsDoc(null);
        if (doc) {
            setRemoteDraftId(doc.id);
            alreadySubmitted =
                doc.submissionState === 'submitted' ||
                (!doc.submissionState && countRequirementFiles(doc.files) > 0) ||
                alreadySubmitted;
            applyRequirementsFields(doc);
            clearLocalFileObjects();
            applySavedFiles(doc.files || {});
            if (doc.registrationId) {
                const select = $('#merchantSelect');
                if (select) select.value = doc.registrationId;
                selectedRegistration = registeredMerchants.find((m) => m.id === doc.registrationId) || null;
            }
            updateSubmitButtonLabel();
            updateStepper();
        }
    }
}

function wireStepper() {
    $$('#stepper .step').forEach((step) => {
        const i = Number(step.dataset.step);
        step.setAttribute('role', 'button');
        step.addEventListener('click', () => goToStep(i));
        step.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                goToStep(i);
            }
        });
    });
}

function wireRemoveButtons() {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-remove]');
        if (!btn) return;
        const key = btn.dataset.remove;
        if (key && SINGLE_FILE_MAP[key]) {
            setSingleFile(key, null);
            const input = $(`#${SINGLE_FILE_MAP[key].input}`);
            if (input) input.value = '';
        }
    });
}

async function init() {
    restoringDraft = true;
    wireStepper();
    wireRemoveButtons();
    Object.keys(SINGLE_FILE_MAP).forEach(wireSingleUpload);
    Object.keys(MULTI_FILE_MAP).forEach(wireMultiUpload);
    wireEquipmentList();
    syncSellingOtherField();
    wireBrandVideoModeToggle();

    trackPageView();
    await loadRegisteredMerchants();
    const hadDraft = Boolean(loadDraft());
    await restoreDraft();
    updateSelectedBrandLabel();
    if (!hadDraft) setBrandVideoMode('links');
    restoringDraft = false;

    $('#merchantSelect')?.addEventListener('change', onMerchantSelect);
    $('#sellOther')?.addEventListener('change', () => {
        syncSellingOtherField();
        scheduleSaveDraft();
    });

    $('#btnStart')?.addEventListener('click', async () => {
        if (!selectedRegistration) {
            setFieldError('merchantSelect', 'Select your brand to continue');
            $('#merchantSelect')?.focus();
            return;
        }
        setFieldError('merchantSelect', '');
        updateSelectedBrandLabel();

        if (!hasMeaningfulFormData() && getRemoteDraftId()) {
            setFormLocked(true, 'Loading brand…');
            try {
                await loadRequirementsForSelection(selectedRegistration.id, { preferRemoteFields: true });
            } finally {
                setFormLocked(false);
            }
        }

        showScreen('screen-form');
        const draft = loadDraft();
        if (draft && draft.registrationId === selectedRegistration.id && typeof draft.currentPage === 'number') {
            showPage(draft.currentPage);
        } else {
            maxPageReached = Math.max(maxPageReached, 0);
            showPage(0);
        }
        scheduleSaveDraft();
    });

    $('#btnChangeBrand')?.addEventListener('click', () => {
        showScreen('screen-welcome');
        scheduleSaveDraft();
    });

    $('#btnEditSubmission')?.addEventListener('click', () => {
        updateSelectedBrandLabel();
        showScreen('screen-form');
        maxPageReached = Math.max(maxPageReached, STEPS - 1);
        showPage(0);
        updateSubmitButtonLabel();
        scheduleSaveDraft();
    });

    $('#requirementsForm')?.addEventListener('input', () => {
        updateStepper();
        scheduleSaveDraft();
    });
    $('#requirementsForm')?.addEventListener('change', () => {
        updateStepper();
        scheduleSaveDraft();
    });

    $$('[data-next]').forEach((btn) => {
        btn.addEventListener('click', () => goNext());
    });

    $$('[data-back]').forEach((btn) => {
        btn.addEventListener('click', () => {
            attemptedSteps.add(currentPage);
            scheduleSaveDraft();
            if (currentPage === 0) showScreen('screen-welcome');
            else showPage(currentPage - 1);
        });
    });

    $('#requirementsForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        submitForm();
    });

    window.addEventListener('beforeunload', () => {
        saveDraftSync();
        syncRemoteDraft();
    });
}

init();
