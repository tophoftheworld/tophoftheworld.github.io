import {
    EVENT,
    FEES,
    PAYMENT_DETAILS,
    COLLECTION_NAME,
    MERCHANTS_COLLECTION,
    VISITORS_COLLECTION,
    STORAGE_PREFIX,
    STORAGE_DOCS_PREFIX,
    BRAND_DESCRIPTION_MAX,
    ENFORCE_VALIDATION,
    formatPeso,
    sha256,
} from './config.js';
import { initFirebase, makeSubmissionId, safeFilename } from './firebase.js';

const STEPS = 4;
const DRAFT_KEY = 'mmf_merchant_reg_draft_v1';
const REMOTE_ID_KEY = 'mmf_merchant_reg_remote_id';
const VISITOR_ID_KEY = 'mmf_merchant_visitor_id';
const DRAFT_FILE_MAX_BYTES = 2.5 * 1024 * 1024;
let currentPage = 0;
let maxPageReached = 0;
/** Steps the user has left via Next — these show check or incomplete, not blank. */
const attemptedSteps = new Set();
let proofFile = null;
let businessDocFile = null;
/** Existing uploaded files when editing a submitted registration. */
let existingProof = null;
let existingBusinessDoc = null;
let editingExisting = false;
let hubMerchants = [];
let submitting = false;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function showScreen(id) {
    $$('.screen').forEach((el) => el.classList.remove('active'));
    const screen = document.getElementById(id);
    if (screen) screen.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    scheduleSaveDraft();
}

function canGoToStep(page) {
    if (!ENFORCE_VALIDATION) return true;
    return page <= maxPageReached;
}

function isCardPayment() {
    return $('input[name="paymentMethod"]:checked')?.value === 'card';
}

/** Silent required-field check — does not show errors. */
function isPageComplete(page) {
    if (page === 0) {
        const requiredIds = ['brandName', 'contactPerson', 'contactNumber', 'brandDescription'];
        for (const id of requiredIds) {
            if (!(document.getElementById(id)?.value || '').trim()) return false;
        }
        const email = ($('#email')?.value || '').trim();
        if (!email || !isValidEmail(email)) return false;
        const ig = ($('#instagram')?.value || '').trim();
        if (!isValidInstagram(ig)) return false;
        const desc = ($('#brandDescription')?.value || '').trim();
        if (desc.length > BRAND_DESCRIPTION_MAX) return false;
        return true;
    }

    if (page === 1) {
        const commits = ['commitPromotion', 'commitManpower', 'commitBooth', 'commitCleanliness', 'commitSalesData'];
        if (!commits.every((id) => document.getElementById(id)?.checked)) return false;
        if (!$('#confirmAccuracy')?.checked || !$('#confirmTerms')?.checked) return false;
        return true;
    }

    if (page === 2) {
        if (!$('input[name="settlementType"]:checked')) return false;
        if (!$('input[name="paymentMethod"]:checked')) return false;
        if (!isCardPayment() && !hasProofOfPayment()) return false;
        return true;
    }

    if (page === 3) return true;
    return false;
}

function updateStepper() {
    $$('#stepper .step').forEach((step) => {
        const i = Number(step.dataset.step);
        const isCurrent = i === currentPage;
        const attempted = attemptedSteps.has(i);
        const complete = isPageComplete(i);

        step.classList.toggle('active', isCurrent);
        // Check only if still complete; incomplete marker if attempted but missing fields
        step.classList.toggle('done', attempted && complete && !isCurrent);
        step.classList.toggle('incomplete', attempted && !complete && !isCurrent);

        const clickable = canGoToStep(i);
        step.classList.toggle('step-disabled', !clickable);
        step.setAttribute('aria-disabled', clickable ? 'false' : 'true');
        step.tabIndex = clickable ? 0 : -1;
    });
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

function goToStep(page) {
    if (page < 0 || page >= STEPS || !canGoToStep(page)) return;

    if (ENFORCE_VALIDATION && page > currentPage) {
        for (let p = currentPage; p < page; p++) {
            attemptedSteps.add(p);
            if (!validatePage(p)) {
                showPage(p);
                return;
            }
        }
    } else if (page > currentPage) {
        for (let p = currentPage; p < page; p++) {
            attemptedSteps.add(p);
        }
    } else if (page !== currentPage) {
        attemptedSteps.add(currentPage);
    }

    showPage(page);
}

function setFieldError(fieldName, message) {
    const wrap = document.querySelector(`[data-field="${fieldName}"]`);
    if (!wrap) return;
    const input = wrap.querySelector('.input, .textarea');
    const err = wrap.querySelector('.field-error');
    if (input) input.classList.toggle('error', Boolean(message));
    if (fieldName === 'proofFile') {
        $('#uploadZone')?.classList.toggle('error', Boolean(message));
    }
    if (err) {
        if (message) err.textContent = message;
        err.classList.toggle('visible', Boolean(message));
    }
}

function clearPageErrors(page) {
    const pageEl = document.querySelector(`.form-page[data-page="${page}"]`);
    if (!pageEl) return;
    pageEl.querySelectorAll('.field-error').forEach((el) => el.classList.remove('visible'));
    pageEl.querySelectorAll('.input.error, .textarea.error').forEach((el) => el.classList.remove('error'));
    pageEl.querySelector('#uploadZone')?.classList.remove('error');
    pageEl.querySelector('#commitmentsError')?.classList.remove('visible');
    pageEl.querySelector('#confirmationError')?.classList.remove('visible');
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeInstagramHandle(value) {
    return String(value || '')
        .trim()
        .replace(/^@/, '')
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
        .replace(/^instagram\.com\//i, '')
        .replace(/\/+$/, '')
        .split(/[/?#]/)[0];
}

function isValidInstagram(value) {
    const raw = (value || '').trim();
    if (!raw) return false;
    if (/^https?:\/\//i.test(raw)) return true;
    const handle = normalizeInstagramHandle(raw);
    return /^[a-zA-Z0-9._]{1,30}$/.test(handle);
}

function validatePage(page) {
    clearPageErrors(page);
    let ok = true;

    if (page === 0) {
        const required = [
            ['brandName', 'Field is required'],
            ['contactPerson', 'Field is required'],
            ['contactNumber', 'Field is required'],
            ['brandDescription', 'Field is required'],
        ];
        for (const [id, msg] of required) {
            const el = document.getElementById(id);
            const val = (el?.value || '').trim();
            if (!val) {
                setFieldError(id, msg);
                ok = false;
            }
        }
        const email = ($('#email')?.value || '').trim();
        if (!email || !isValidEmail(email)) {
            setFieldError('email', 'Enter a valid email');
            ok = false;
        }
        const ig = ($('#instagram')?.value || '').trim();
        if (!isValidInstagram(ig)) {
            setFieldError('instagram', 'Enter your Instagram username or link');
            ok = false;
        }
        const desc = ($('#brandDescription')?.value || '').trim();
        if (desc.length > BRAND_DESCRIPTION_MAX) {
            setFieldError('brandDescription', `Max ${BRAND_DESCRIPTION_MAX} characters`);
            ok = false;
        }
    }

    if (page === 1) {
        const commits = ['commitPromotion', 'commitManpower', 'commitBooth', 'commitCleanliness', 'commitSalesData'];
        const allChecked = commits.every((id) => document.getElementById(id)?.checked);
        if (!allChecked) {
            const err = $('#commitmentsError');
            if (err) err.classList.add('visible');
            ok = false;
        }
        if (!$('#confirmAccuracy')?.checked || !$('#confirmTerms')?.checked) {
            const err = $('#confirmationError');
            if (err) err.classList.add('visible');
            ok = false;
        }
    }

    if (page === 2) {
        if (!$('input[name="settlementType"]:checked')) {
            setFieldError('settlementType', 'Select how you would like to settle');
            ok = false;
        }
        if (!$('input[name="paymentMethod"]:checked')) {
            setFieldError('paymentMethod', 'Select a payment method');
            ok = false;
        }
        if (!isCardPayment() && !hasProofOfPayment()) {
            setFieldError('proofFile', 'Upload proof of payment');
            ok = false;
        }
    }

    return ok;
}

function applyConfigToDom() {
    $('#feeExVat').textContent = formatPeso(FEES.participationExVat);
    $('#feeVat').textContent = formatPeso(FEES.vatAmount);
    $('#feeTotal').textContent = formatPeso(FEES.totalDue);
    $('#settleFullAmount').textContent = formatPeso(FEES.totalDue);
    $('#settleDpAmount').textContent = formatPeso(FEES.downpaymentAmount);
    $('#settleDpBalance').textContent = formatPeso(FEES.balanceAmount);
    $('#settleDpDue').textContent = EVENT.finalPaymentDue;

    if (PAYMENT_DETAILS.sectionTitle) {
        $('#payDetailsTitle').textContent = PAYMENT_DETAILS.sectionTitle;
    }

    const card = PAYMENT_DETAILS.card;
    if (card?.enabled) {
        $('#cardPayNote').textContent = card.note;
        if (card.radioLabel) {
            const label = $('#cardRadioLabel');
            if (label) label.textContent = card.radioLabel;
        }
        if (card.radioHint) {
            const hint = $('#cardRadioHint');
            if (hint) hint.textContent = card.radioHint;
        }
    } else {
        $('#payMethodCard')?.closest('.pill-radio')?.classList.add('hidden');
        $('#cardPaySection')?.classList.add('hidden');
    }

    syncPaymentMethodUi();
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function copyIconSvg() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}

function qrIconSvg() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h.01"/><path d="M18 14h.01"/><path d="M14 18h.01"/><path d="M18 18h.01"/><path d="M21 18v3h-3"/><path d="M21 14v1"/></svg>`;
}

async function copyText(text, btn) {
    try {
        await navigator.clipboard.writeText(text);
        if (btn) {
            btn.classList.add('copied');
            setTimeout(() => btn.classList.remove('copied'), 1200);
        }
    } catch {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
}

function openQrModal({ label, src, filename }) {
    const modal = $('#qrModal');
    const img = $('#qrModalImage');
    const download = $('#qrModalDownload');
    if (!modal || !img || !download) return;

    img.src = src;
    img.alt = `${label} payment QR code`;
    download.href = src;
    download.download = filename || `${label.toLowerCase()}-qr.png`;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeQrModal() {
    $('#qrModal')?.classList.add('hidden');
    document.body.style.overflow = '';
}

function wirePayAccountActions() {
    const accountsEl = $('#payAccounts');
    if (!accountsEl || accountsEl.dataset.wired === '1') return;
    accountsEl.dataset.wired = '1';

    accountsEl.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.copy-icon');
        if (copyBtn) {
            e.preventDefault();
            copyText(copyBtn.dataset.copy || '', copyBtn);
            return;
        }
        const qrBtn = e.target.closest('.btn-view-qr');
        if (qrBtn) {
            e.preventDefault();
            openQrModal({
                label: qrBtn.dataset.qrLabel || 'QR',
                src: qrBtn.dataset.qrSrc || '',
                filename: qrBtn.dataset.qrFilename || 'qr.png',
            });
        }
    });
}

function wireQrModal() {
    $('#qrModalClose')?.addEventListener('click', closeQrModal);
    $('#qrModalBackdrop')?.addEventListener('click', closeQrModal);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('#qrModal')?.classList.contains('hidden')) {
            closeQrModal();
        }
    });
}

function renderPayAccounts(method) {
    const accountsEl = $('#payAccounts');
    const hintEl = $('#payDetailsHint');
    if (!accountsEl) return;

    const hints = PAYMENT_DETAILS.hints || {};
    let filterType = null;
    if (method === 'bank') filterType = 'bank';
    if (method === 'ewallet') filterType = 'ewallet';

    if (hintEl) {
        if (method === 'bank') hintEl.textContent = hints.bank || 'For Bank Transfer / Cash Deposit:';
        else if (method === 'ewallet') hintEl.textContent = hints.ewallet || 'For E-wallet:';
        else hintEl.textContent = '';
        hintEl.classList.toggle('hidden', !hintEl.textContent);
    }

    const accounts = (PAYMENT_DETAILS.accounts || []).filter(
        (acct) => filterType && acct.type === filterType
    );

    if (!method || method === 'card' || !filterType) {
        accountsEl.innerHTML = '';
        return;
    }

    accountsEl.innerHTML = accounts
        .map((acct) => {
            const numberLabel = 'Account Number';
            const qrBtn = acct.qrImage
                ? `<button type="button" class="btn-view-qr" data-qr-src="${escapeHtml(acct.qrImage)}" data-qr-label="${escapeHtml(acct.label)}" data-qr-filename="${escapeHtml(acct.label.toLowerCase())}-qr.png">${qrIconSvg()} View QR</button>`
                : '';
            return `<div class="pay-box">
                <div class="pay-box-header">
                    <h4>${escapeHtml(acct.label)}</h4>
                    ${qrBtn}
                </div>
                <div class="pay-detail">
                    <span class="label">Account Name:</span>
                    <span class="pay-inline">
                        <span class="pay-value">${escapeHtml(acct.accountName)}</span>
                        <button type="button" class="copy-icon" data-copy="${escapeHtml(acct.accountName)}" aria-label="Copy account name">${copyIconSvg()}</button>
                    </span>
                </div>
                <div class="pay-detail">
                    <span class="label">${escapeHtml(numberLabel)}:</span>
                    <span class="pay-inline">
                        <span class="pay-value">${escapeHtml(acct.accountNumber)}</span>
                        <button type="button" class="copy-icon" data-copy="${escapeHtml(acct.accountNumber)}" aria-label="Copy ${escapeHtml(numberLabel)}">${copyIconSvg()}</button>
                    </span>
                </div>
            </div>`;
        })
        .join('');
}

function syncPaymentMethodUi() {
    const method = $('input[name="paymentMethod"]:checked')?.value || '';
    const isCard = method === 'card';
    const showTransfer = method === 'bank' || method === 'ewallet';

    $('#transferPaySection')?.classList.toggle('hidden', !showTransfer);
    $('#cardPaySection')?.classList.toggle('hidden', !isCard);
    $('#cardRadioHint')?.classList.toggle('hidden', !isCard);

    if (showTransfer) renderPayAccounts(method);
    else renderPayAccounts('');

    updateStepper();
}

function updateDescCount() {
    const val = $('#brandDescription')?.value || '';
    const el = $('#descCount');
    if (!el) return;
    el.textContent = `${val.length} / ${BRAND_DESCRIPTION_MAX}`;
    el.classList.toggle('over', val.length > BRAND_DESCRIPTION_MAX);
}

function updateFilePreview(file, { previewId, thumbId, nameId }) {
    const preview = $(`#${previewId}`);
    const thumb = $(`#${thumbId}`);
    const name = $(`#${nameId}`);
    if (!file) {
        preview?.classList.remove('visible');
        if (thumb) {
            thumb.removeAttribute('src');
            thumb.style.display = 'none';
        }
        return;
    }
    name.textContent = file.name;
    preview?.classList.add('visible');
    if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        thumb.style.display = '';
        thumb.src = url;
    } else if (thumb) {
        thumb.style.display = 'none';
    }
}

function hasProofOfPayment() {
    return Boolean(proofFile || existingProof?.url);
}

function updateSubmitButtonLabel() {
    const btn = $('#btnSubmit');
    if (!btn || submitting) return;
    btn.textContent = editingExisting ? 'Update' : 'Submit';
}

function updateSelectedBrandBar() {
    const bar = $('#selectedBrandBar');
    const nameEl = $('#selectedBrandName');
    if (!bar) return;
    if (editingExisting) {
        bar.classList.remove('hidden');
        if (nameEl) nameEl.textContent = ($('#brandName')?.value || '').trim() || '—';
    } else {
        bar.classList.add('hidden');
    }
    updateSubmitButtonLabel();
}

function showExistingFilePreview(meta, { previewId, thumbId, nameId }) {
    const preview = $(`#${previewId}`);
    const thumb = $(`#${thumbId}`);
    const name = $(`#${nameId}`);
    if (!meta?.url) {
        preview?.classList.remove('visible');
        return;
    }
    if (name) name.textContent = meta.name || 'Uploaded file';
    preview?.classList.add('visible');
    const looksImage = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(meta.name || meta.url);
    if (thumb && looksImage) {
        thumb.style.display = '';
        thumb.src = meta.url;
    } else if (thumb) {
        thumb.removeAttribute('src');
        thumb.style.display = 'none';
    }
}

function setProofFile(file) {
    proofFile = file || null;
    if (file) existingProof = null;
    if (proofFile) {
        updateFilePreview(proofFile, {
            previewId: 'uploadPreview',
            thumbId: 'uploadThumb',
            nameId: 'uploadName',
        });
        setFieldError('proofFile', '');
    } else if (existingProof?.url) {
        showExistingFilePreview(existingProof, {
            previewId: 'uploadPreview',
            thumbId: 'uploadThumb',
            nameId: 'uploadName',
        });
    } else {
        updateFilePreview(null, {
            previewId: 'uploadPreview',
            thumbId: 'uploadThumb',
            nameId: 'uploadName',
        });
    }
    updateStepper();
    scheduleSaveDraft();
    if (file && file.size <= DRAFT_FILE_MAX_BYTES) saveDraft();
}

function setBusinessDocFile(file) {
    businessDocFile = file || null;
    if (file) existingBusinessDoc = null;
    if (businessDocFile) {
        updateFilePreview(businessDocFile, {
            previewId: 'businessDocPreview',
            thumbId: 'businessDocThumb',
            nameId: 'businessDocName',
        });
    } else if (existingBusinessDoc?.url) {
        showExistingFilePreview(existingBusinessDoc, {
            previewId: 'businessDocPreview',
            thumbId: 'businessDocThumb',
            nameId: 'businessDocName',
        });
    } else {
        updateFilePreview(null, {
            previewId: 'businessDocPreview',
            thumbId: 'businessDocThumb',
            nameId: 'businessDocName',
        });
    }
    updateStepper();
    scheduleSaveDraft();
    if (file && file.size <= DRAFT_FILE_MAX_BYTES) saveDraft();
}

function wireFileUpload({ zoneId, inputId, previewId, thumbId, nameId, removeId, setFile }) {
    const zone = $(`#${zoneId}`);
    const input = $(`#${inputId}`);
    if (!zone || !input) return;

    const openPicker = () => input.click();
    zone.addEventListener('click', openPicker);
    zone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
        }
    });

    input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) setFile(file);
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
        if (file) setFile(file);
    });

    $(`#${removeId}`)?.addEventListener('click', (e) => {
        e.stopPropagation();
        input.value = '';
        if (inputId === 'proofFile') existingProof = null;
        if (inputId === 'businessDoc') existingBusinessDoc = null;
        setFile(null);
    });
}

async function uploadFile(storage, storageFns, prefix, submissionId, file) {
    const storagePath = `${prefix}/${submissionId}/${safeFilename(file.name)}`;
    const fileRef = storageFns.ref(storage, storagePath);
    await storageFns.uploadBytes(fileRef, file, {
        contentType: file.type || 'application/octet-stream',
    });
    const url = await storageFns.getDownloadURL(fileRef);
    return { url, path: storagePath, name: file.name };
}

function collectOtherLinks() {
    return $$('#otherLinksList input[name="otherLinks"]')
        .map((el) => (el.value || '').trim())
        .filter(Boolean);
}

function wireOtherLinks() {
    const list = $('#otherLinksList');
    const addBtn = $('#btnAddOtherLink');
    if (!list || !addBtn) return;

    addBtn.addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'link-row';
        row.innerHTML = `
            <input class="input" type="text" name="otherLinks" placeholder="https://…">
            <button type="button" class="btn-remove-link" aria-label="Remove link">×</button>
        `;
        list.appendChild(row);
        row.querySelector('input')?.focus();
        updateOtherLinkRemoveButtons();
        scheduleSaveDraft();
    });

    list.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-remove-link');
        if (!btn) return;
        btn.closest('.link-row')?.remove();
        updateOtherLinkRemoveButtons();
        scheduleSaveDraft();
    });
}

function updateOtherLinkRemoveButtons() {
    const rows = $$('#otherLinksList .link-row');
    rows.forEach((row, i) => {
        const removeBtn = row.querySelector('.btn-remove-link');
        if (!removeBtn && rows.length > 1) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-remove-link';
            btn.setAttribute('aria-label', 'Remove link');
            btn.textContent = '×';
            row.appendChild(btn);
        } else if (removeBtn) {
            removeBtn.hidden = rows.length <= 1;
        }
    });
}

const TEXT_FIELD_IDS = [
    'brandName',
    'registeredBusinessName',
    'brandDescription',
    'instagram',
    'contactPerson',
    'role',
    'contactNumber',
    'email',
    'supplierOtherText',
    'notes',
];

const CHECKBOX_IDS = [
    'commitPromotion',
    'commitManpower',
    'commitBooth',
    'commitCleanliness',
    'commitSalesData',
    'confirmAccuracy',
    'confirmTerms',
    'supplierIce',
    'supplierWater',
    'supplierCrewMeals',
    'supplierOther',
];

let saveDraftTimer = null;
let remoteSyncTimer = null;
let remoteSyncGeneration = 0;

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

function hasAnyFormData() {
    for (const id of TEXT_FIELD_IDS) {
        if ((document.getElementById(id)?.value || '').trim()) return true;
    }
    for (const id of CHECKBOX_IDS) {
        if (document.getElementById(id)?.checked) return true;
    }
    if ($('input[name="settlementType"]:checked')) return true;
    if ($('input[name="paymentMethod"]:checked')) return true;
    if ($$('#otherLinksList input[name="otherLinks"]').some((el) => el.value.trim())) return true;
    if (proofFile || businessDocFile) return true;
    return false;
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
            path: window.location.pathname || '/',
        };
        if (!existing.exists()) {
            payload.firstSeen = firestoreFns.serverTimestamp();
        }
        await firestoreFns.setDoc(docRef, payload, { merge: true });
    } catch (err) {
        console.warn('[MMF Registration] page view track failed', err);
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

async function syncRemoteDraft(generation = remoteSyncGeneration) {
    if (submitting || generation !== remoteSyncGeneration) return;
    if (getActiveScreenId() !== 'screen-form') return;
    if (!hasAnyFormData()) return;

    try {
        const { db, firestoreFns } = await initFirebase();
        if (submitting || generation !== remoteSyncGeneration) return;

        let id = getRemoteDraftId();
        if (!id) {
            id = makeSubmissionId();
            setRemoteDraftId(id);
        }

        const docRef = firestoreFns.doc(db, COLLECTION_NAME, id);
        const existing = await firestoreFns.getDoc(docRef);
        if (submitting || generation !== remoteSyncGeneration) return;

        const existingData = existing.exists() ? existing.data() : null;
        const alreadySubmitted = existingData?.submissionState === 'submitted';
        if (alreadySubmitted && !editingExisting) return;

        const payload = {
            ...collectPayload(),
            id,
            submissionState: alreadySubmitted || editingExisting ? 'submitted' : 'draft',
            draftMeta: {
                currentPage,
                maxPageReached,
                screen: getActiveScreenId(),
            },
            proofOfPaymentPendingName: proofFile?.name || null,
            businessDocPendingName: businessDocFile?.name || null,
            updatedAt: firestoreFns.serverTimestamp(),
        };

        if (!alreadySubmitted && !editingExisting) {
            payload.status = null;
        } else if (existingData?.status === 'verified') {
            payload.status = 'verified';
        }

        if (!existing.exists()) {
            payload.createdAt = firestoreFns.serverTimestamp();
        }

        // Final guard: an in-flight sync must never overwrite a successful submit.
        if (submitting || generation !== remoteSyncGeneration) return;
        await firestoreFns.setDoc(docRef, payload, { merge: true });
    } catch (err) {
        console.warn('[MMF Registration] remote draft sync failed', err);
    }
}

function getActiveScreenId() {
    return document.querySelector('.screen.active')?.id || 'screen-welcome';
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

async function buildDraft() {
    const fields = {};
    for (const id of TEXT_FIELD_IDS) {
        fields[id] = document.getElementById(id)?.value ?? '';
    }

    const checks = {};
    for (const id of CHECKBOX_IDS) {
        checks[id] = Boolean(document.getElementById(id)?.checked);
    }

    return {
        version: 1,
        savedAt: Date.now(),
        screen: getActiveScreenId(),
        currentPage,
        maxPageReached,
        attemptedSteps: [...attemptedSteps],
        fields,
        checks,
        otherLinks: $$('#otherLinksList input[name="otherLinks"]').map((el) => el.value),
        settlementType: $('input[name="settlementType"]:checked')?.value || '',
        paymentMethod: $('input[name="paymentMethod"]:checked')?.value || '',
        proofFile: await fileToDraftEntry(proofFile),
        businessDocFile: await fileToDraftEntry(businessDocFile),
    };
}

function saveDraftSync() {
    try {
        const draft = {
            version: 1,
            savedAt: Date.now(),
            screen: getActiveScreenId(),
            currentPage,
            maxPageReached,
            attemptedSteps: [...attemptedSteps],
            fields: Object.fromEntries(
                TEXT_FIELD_IDS.map((id) => [id, document.getElementById(id)?.value ?? ''])
            ),
            checks: Object.fromEntries(
                CHECKBOX_IDS.map((id) => [id, Boolean(document.getElementById(id)?.checked)])
            ),
            otherLinks: $$('#otherLinksList input[name="otherLinks"]').map((el) => el.value),
            settlementType: $('input[name="settlementType"]:checked')?.value || '',
            paymentMethod: $('input[name="paymentMethod"]:checked')?.value || '',
            proofFile: proofFile
                ? { name: proofFile.name, type: proofFile.type, tooLarge: proofFile.size > DRAFT_FILE_MAX_BYTES }
                : null,
            businessDocFile: businessDocFile
                ? { name: businessDocFile.name, type: businessDocFile.type, tooLarge: businessDocFile.size > DRAFT_FILE_MAX_BYTES }
                : null,
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (err) {
        console.warn('[MMF Registration] draft save failed', err);
    }
}

async function saveDraft() {
    try {
        const draft = await buildDraft();
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (err) {
        console.warn('[MMF Registration] draft save failed', err);
        saveDraftSync();
    }
}

function scheduleSaveDraft() {
    clearTimeout(saveDraftTimer);
    saveDraftTimer = setTimeout(() => {
        saveDraft();
    }, 350);
    scheduleRemoteSync();
}

function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(REMOTE_ID_KEY);
}

function restoreOtherLinks(links) {
    const list = $('#otherLinksList');
    if (!list) return;
    const values = Array.isArray(links) && links.length ? links : [''];
    list.innerHTML = '';
    values.forEach((value) => {
        const row = document.createElement('div');
        row.className = 'link-row';
        const removeBtn =
            values.length > 1
                ? '<button type="button" class="btn-remove-link" aria-label="Remove link">×</button>'
                : '';
        row.innerHTML = `
            <input class="input" type="text" name="otherLinks" placeholder="https://…">
            ${removeBtn}
        `;
        const input = row.querySelector('input');
        if (input) input.value = value;
        list.appendChild(row);
    });
    updateOtherLinkRemoveButtons();
}

function restoreDraftFields(draft) {
    if (!draft) return;

    for (const [id, value] of Object.entries(draft.fields || {})) {
        const el = document.getElementById(id);
        if (el != null && value != null) el.value = value;
    }

    for (const [id, checked] of Object.entries(draft.checks || {})) {
        const el = document.getElementById(id);
        if (el) el.checked = Boolean(checked);
    }

    restoreOtherLinks(draft.otherLinks);

    if (draft.settlementType) {
        const radio = document.querySelector(`input[name="settlementType"][value="${draft.settlementType}"]`);
        if (radio) radio.checked = true;
    }
    if (draft.paymentMethod) {
        const radio = document.querySelector(`input[name="paymentMethod"][value="${draft.paymentMethod}"]`);
        if (radio) radio.checked = true;
    }

    if (typeof draft.currentPage === 'number') {
        currentPage = draft.currentPage;
        maxPageReached = draft.maxPageReached ?? draft.currentPage;
        attemptedSteps.clear();
        (draft.attemptedSteps || []).forEach((step) => attemptedSteps.add(step));
    }

    updateDescCount();
    syncPaymentMethodUi();
}

async function restoreDraftFiles(draft) {
    if (draft.proofFile && !draft.proofFile.tooLarge) {
        const file = await draftEntryToFile(draft.proofFile);
        if (file) setProofFile(file);
    }
    if (draft.businessDocFile && !draft.businessDocFile.tooLarge) {
        const file = await draftEntryToFile(draft.businessDocFile);
        if (file) setBusinessDocFile(file);
    }
}

function loadDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

async function restoreDraft() {
    const draft = loadDraft();
    if (!draft) return;

    restoreDraftFields(draft);
    await restoreDraftFiles(draft);

    if (draft.screen === 'screen-form') {
        showScreen('screen-form');
        showPage(typeof draft.currentPage === 'number' ? draft.currentPage : 0);
    }

    updateStepper();
}

function collectPayload() {
    const settlementType = $('input[name="settlementType"]:checked')?.value || '';
    const paymentMethod = $('input[name="paymentMethod"]:checked')?.value || '';
    return {
        brandName: ($('#brandName')?.value || '').trim(),
        registeredBusinessName: ($('#registeredBusinessName')?.value || '').trim(),
        contactPerson: ($('#contactPerson')?.value || '').trim(),
        role: ($('#role')?.value || '').trim(),
        contactNumber: ($('#contactNumber')?.value || '').trim(),
        email: ($('#email')?.value || '').trim(),
        instagram: ($('#instagram')?.value || '').trim(),
        otherLinks: collectOtherLinks(),
        tiktokOther: collectOtherLinks().join('\n'),
        brandDescription: ($('#brandDescription')?.value || '').trim(),
        commitments: {
            promotion: Boolean($('#commitPromotion')?.checked),
            manpower: Boolean($('#commitManpower')?.checked),
            boothOps: Boolean($('#commitBooth')?.checked),
            cleanliness: Boolean($('#commitCleanliness')?.checked),
            salesData: Boolean($('#commitSalesData')?.checked),
        },
        confirmation: {
            accuracy: Boolean($('#confirmAccuracy')?.checked),
            terms: Boolean($('#confirmTerms')?.checked),
        },
        settlementType,
        paymentMethod,
        supplierInterest: {
            ice: Boolean($('#supplierIce')?.checked),
            water: Boolean($('#supplierWater')?.checked),
            crewMeals: Boolean($('#supplierCrewMeals')?.checked),
            other: Boolean($('#supplierOther')?.checked),
            otherText: ($('#supplierOtherText')?.value || '').trim(),
        },
        notes: ($('#notes')?.value || '').trim(),
        feeSnapshot: { ...FEES },
        eventSnapshot: {
            name: EVENT.name,
            dates: EVENT.dates,
            venue: EVENT.venue,
            finalPaymentDue: EVENT.finalPaymentDue,
        },
        status: paymentMethod === 'card' ? 'pending_paypal' : 'pending_verification',
        source: 'mmf-merchant-registration',
    };
}

function formatSubmitError(err) {
    const code = err?.code || '';
    const message = err?.message || '';
    if (
        code === 'storage/unauthorized' ||
        code === 'storage/unknown' ||
        /CORS|ERR_FAILED|storage/i.test(message)
    ) {
        return 'File upload failed — Firebase Storage may not be enabled yet on this project. Please contact the organizer.';
    }
    return message || 'Something went wrong submitting your registration. Please try again.';
}

async function submitForm() {
    if (submitting) return;
    if (ENFORCE_VALIDATION) {
        const firstBad = [0, 1, 2].find((p) => !validatePage(p));
        if (firstBad !== undefined) {
            showPage(firstBad);
            return;
        }
    }

    const banner = $('#submitError');
    banner?.classList.remove('visible');

    const btn = $('#btnSubmit');
    submitting = true;
    cancelRemoteSync();
    if (btn) {
        btn.disabled = true;
        btn.textContent = editingExisting ? 'Updating…' : 'Submitting…';
    }

    try {
        const { db, storage, firestoreFns, storageFns } = await initFirebase();
        const submissionId = getRemoteDraftId() || makeSubmissionId();
        const payload = collectPayload();

        const docRef = firestoreFns.doc(db, COLLECTION_NAME, submissionId);
        const existing = await firestoreFns.getDoc(docRef);
        const existingData = existing.exists() ? existing.data() || {} : {};

        let proofOfPaymentUrl = existingProof?.url || existingData.proofOfPaymentUrl || null;
        let proofOfPaymentPath = existingProof?.path || existingData.proofOfPaymentPath || null;
        let proofOfPaymentName = existingProof?.name || existingData.proofOfPaymentName || null;
        let businessDocUrl = existingBusinessDoc?.url || existingData.businessDocUrl || null;
        let businessDocPath = existingBusinessDoc?.path || existingData.businessDocPath || null;
        let businessDocName = existingBusinessDoc?.name || existingData.businessDocName || null;

        if (proofFile) {
            const uploaded = await uploadFile(storage, storageFns, STORAGE_PREFIX, submissionId, proofFile);
            proofOfPaymentUrl = uploaded.url;
            proofOfPaymentPath = uploaded.path;
            proofOfPaymentName = uploaded.name;
        } else if (ENFORCE_VALIDATION && !isCardPayment() && !proofOfPaymentUrl) {
            throw new Error('Proof of payment is required.');
        }

        if (businessDocFile) {
            const uploaded = await uploadFile(storage, storageFns, STORAGE_DOCS_PREFIX, submissionId, businessDocFile);
            businessDocUrl = uploaded.url;
            businessDocPath = uploaded.path;
            businessDocName = uploaded.name;
        }

        // Keep verified status on edits; otherwise refresh pending status from payment method.
        let status = payload.status;
        if (editingExisting && existingData.status === 'verified') {
            status = 'verified';
        }

        await firestoreFns.setDoc(
            docRef,
            {
                ...payload,
                id: submissionId,
                status,
                submissionState: 'submitted',
                proofOfPaymentUrl,
                proofOfPaymentPath,
                proofOfPaymentName,
                businessDocUrl,
                businessDocPath,
                businessDocName,
                proofOfPaymentPendingName: null,
                businessDocPendingName: null,
                draftMeta: null,
                paypalInvoice: firestoreFns.deleteField(),
                submittedAt: existingData.submittedAt || firestoreFns.serverTimestamp(),
                updatedAt: firestoreFns.serverTimestamp(),
                ...(existing.exists() ? {} : { createdAt: firestoreFns.serverTimestamp() }),
            },
            { merge: true }
        );

        existingProof = proofOfPaymentUrl
            ? { url: proofOfPaymentUrl, path: proofOfPaymentPath, name: proofOfPaymentName }
            : null;
        existingBusinessDoc = businessDocUrl
            ? { url: businessDocUrl, path: businessDocPath, name: businessDocName }
            : null;
        proofFile = null;
        businessDocFile = null;
        editingExisting = true;
        setRemoteDraftId(submissionId);
        clearDraft();
        setRemoteDraftId(submissionId);

        if (isCardPayment() && status !== 'verified') {
            if (btn) btn.textContent = 'Opening PayPal…';
            try {
                const { functions, functionsFns } = await initFirebase();
                const createInvoice = functionsFns.httpsCallable(functions, 'createPayPalInvoice');
                const result = await createInvoice({ registrationId: submissionId });
                const href = result?.data?.href;
                if (!href) throw new Error('No PayPal payment link returned');
                window.location.assign(href);
                return;
            } catch (paypalErr) {
                console.error('[MMF Registration] PayPal invoice failed', paypalErr);
                if (banner) {
                    banner.textContent =
                        'Your registration was saved, but we could not open the PayPal payment link. Please try again later or reach out via Viber.';
                    banner.classList.add('visible');
                }
                showThanksScreen();
                return;
            }
        }

        showThanksScreen();
    } catch (err) {
        console.error('[MMF Registration] submit failed', err);
        if (banner) {
            banner.textContent = formatSubmitError(err);
            banner.classList.add('visible');
        }
    } finally {
        submitting = false;
        updateSubmitButtonLabel();
        if (btn) btn.disabled = false;
    }
}

function showThanksScreen() {
    const title = $('#thanksTitle');
    const lead = $('#thanksLead');
    if (editingExisting) {
        if (title) title.textContent = 'Updated!';
        if (lead) lead.textContent = 'Your merchant information has been saved.';
    } else {
        if (title) title.textContent = 'Thank you!';
        if (lead) lead.textContent = "We're so excited to have you at Manila Matcha Fest.";
    }
    showScreen('screen-thanks');
}

function wireUpload() {
    wireFileUpload({
        zoneId: 'uploadZone',
        inputId: 'proofFile',
        previewId: 'uploadPreview',
        thumbId: 'uploadThumb',
        nameId: 'uploadName',
        removeId: 'uploadRemove',
        setFile: setProofFile,
    });
    wireFileUpload({
        zoneId: 'businessDocZone',
        inputId: 'businessDoc',
        previewId: 'businessDocPreview',
        thumbId: 'businessDocThumb',
        nameId: 'businessDocName',
        removeId: 'businessDocRemove',
        setFile: setBusinessDocFile,
    });
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

function setWelcomeError(message) {
    const err = $('#welcomeLoginError');
    if (!err) return;
    if (message) err.textContent = message;
    err.classList.toggle('visible', Boolean(message));
}

function setWelcomeLoading(on, message = 'Loading…') {
    const root = $('#welcomeRoot');
    if (!root) return;
    root.classList.toggle('is-brand-loading', on);
    if (on) root.setAttribute('data-loading-message', message);
    else root.removeAttribute('data-loading-message');
}

async function loadHubMerchants() {
    const select = $('#merchantSelect');
    try {
        const { db, firestoreFns } = await initFirebase();
        const snap = await firestoreFns.getDocs(
            firestoreFns.collection(db, MERCHANTS_COLLECTION)
        );
        hubMerchants = [];
        snap.forEach((docSnap) => {
            const data = docSnap.data() || {};
            hubMerchants.push({
                id: docSnap.id,
                brandName: String(data.brandName || '').trim() || docSnap.id,
                codeHash: String(data.codeHash || ''),
                registrationId: data.registrationId || docSnap.id,
            });
        });
        hubMerchants.sort((a, b) =>
            a.brandName.localeCompare(b.brandName, undefined, { sensitivity: 'base' })
        );
        if (!hubMerchants.length) {
            if (select) select.innerHTML = '<option value="">No brands available yet</option>';
            return;
        }
        if (select) {
            select.innerHTML =
                '<option value="">Select your brand…</option>' +
                hubMerchants
                    .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.brandName)}</option>`)
                    .join('');
        }
    } catch (err) {
        console.error('[MMF Registration] failed to load brands', err);
        if (select) select.innerHTML = '<option value="">Failed to load brands</option>';
    }
}

function resetFormForNew() {
    editingExisting = false;
    existingProof = null;
    existingBusinessDoc = null;
    proofFile = null;
    businessDocFile = null;
    clearDraft();
    localStorage.removeItem(REMOTE_ID_KEY);

    for (const id of TEXT_FIELD_IDS) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    }
    for (const id of CHECKBOX_IDS) {
        const el = document.getElementById(id);
        if (el) el.checked = false;
    }
    restoreOtherLinks(['']);
    $$('input[name="settlementType"]').forEach((el) => {
        el.checked = false;
    });
    $$('input[name="paymentMethod"]').forEach((el) => {
        el.checked = false;
    });
    setProofFile(null);
    setBusinessDocFile(null);
    currentPage = 0;
    maxPageReached = 0;
    attemptedSteps.clear();
    updateDescCount();
    syncPaymentMethodUi();
    updateSelectedBrandBar();
    updateStepper();
}

function applyRegistrationDoc(data) {
    const fields = {
        brandName: data.brandName,
        registeredBusinessName: data.registeredBusinessName,
        brandDescription: data.brandDescription,
        instagram: data.instagram,
        contactPerson: data.contactPerson,
        role: data.role,
        contactNumber: data.contactNumber,
        email: data.email,
        supplierOtherText: data.supplierInterest?.otherText,
        notes: data.notes,
    };
    for (const [id, value] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el != null && value != null) el.value = value;
    }

    const commits = data.commitments || {};
    const setCheck = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = Boolean(val);
    };
    setCheck('commitPromotion', commits.promotion);
    setCheck('commitManpower', commits.manpower);
    setCheck('commitBooth', commits.boothOps);
    setCheck('commitCleanliness', commits.cleanliness);
    setCheck('commitSalesData', commits.salesData);

    const conf = data.confirmation || {};
    setCheck('confirmAccuracy', conf.accuracy);
    setCheck('confirmTerms', conf.terms);

    const suppliers = data.supplierInterest || {};
    setCheck('supplierIce', suppliers.ice);
    setCheck('supplierWater', suppliers.water);
    setCheck('supplierCrewMeals', suppliers.crewMeals);
    setCheck('supplierOther', suppliers.other);

    const links = Array.isArray(data.otherLinks)
        ? data.otherLinks
        : String(data.tiktokOther || '')
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
    restoreOtherLinks(links.length ? links : ['']);

    if (data.settlementType) {
        const radio = document.querySelector(`input[name="settlementType"][value="${data.settlementType}"]`);
        if (radio) radio.checked = true;
    }
    if (data.paymentMethod) {
        const radio = document.querySelector(`input[name="paymentMethod"][value="${data.paymentMethod}"]`);
        if (radio) radio.checked = true;
    }

    existingProof = data.proofOfPaymentUrl
        ? {
              url: data.proofOfPaymentUrl,
              path: data.proofOfPaymentPath || null,
              name: data.proofOfPaymentName || 'Proof of payment',
          }
        : null;
    existingBusinessDoc = data.businessDocUrl
        ? {
              url: data.businessDocUrl,
              path: data.businessDocPath || null,
              name: data.businessDocName || 'Business document',
          }
        : null;
    proofFile = null;
    businessDocFile = null;
    setProofFile(null);
    setBusinessDocFile(null);

    updateDescCount();
    syncPaymentMethodUi();
}

async function loadRegistrationForEdit(registrationId) {
    const { db, firestoreFns } = await initFirebase();
    const snap = await firestoreFns.getDoc(firestoreFns.doc(db, COLLECTION_NAME, registrationId));
    if (!snap.exists()) {
        throw new Error('Registration not found for this brand.');
    }
    clearDraft();
    setRemoteDraftId(registrationId);
    editingExisting = true;
    applyRegistrationDoc(snap.data() || {});
    currentPage = 0;
    maxPageReached = STEPS - 1;
    attemptedSteps.clear();
    for (let i = 0; i < STEPS; i += 1) attemptedSteps.add(i);
    updateSelectedBrandBar();
    updateStepper();
}

async function continueWithBrandLogin() {
    setWelcomeError('');
    const merchantId = $('#merchantSelect')?.value || '';
    const code = $('#accessCode')?.value || '';
    const merchant = hubMerchants.find((m) => m.id === merchantId);
    if (!merchant) {
        setWelcomeError('Select your brand to continue');
        return;
    }
    if (!String(code).trim()) {
        setWelcomeError('Enter your access code');
        return;
    }
    if (!merchant.codeHash) {
        setWelcomeError('This brand has no access code yet. Contact the organizer.');
        return;
    }
    const hash = await sha256(String(code).trim().toUpperCase());
    if (hash !== merchant.codeHash) {
        setWelcomeError('Incorrect access code');
        return;
    }

    setWelcomeLoading(true, 'Loading your registration…');
    try {
        const registrationId = merchant.registrationId || merchant.id;
        await loadRegistrationForEdit(registrationId);
        $('#accessCode').value = '';
        showScreen('screen-form');
        showPage(0);
    } catch (err) {
        console.error(err);
        setWelcomeError(err?.message || 'Could not load registration. Try again.');
    } finally {
        setWelcomeLoading(false);
    }
}

function startNewRegistration() {
    setWelcomeError('');
    resetFormForNew();
    showScreen('screen-form');
    showPage(0);
}

async function init() {
    applyConfigToDom();
    updateDescCount();
    wireOtherLinks();
    wireUpload();
    wireStepper();
    wirePayAccountActions();
    wireQrModal();

    trackPageView();
    await loadHubMerchants();
    await restoreDraft();
    updateSelectedBrandBar();

    $('#btnStart')?.addEventListener('click', () => {
        continueWithBrandLogin();
    });
    $('#btnNewRegistration')?.addEventListener('click', () => {
        startNewRegistration();
    });
    $('#btnChangeBrand')?.addEventListener('click', () => {
        showScreen('screen-welcome');
    });
    $('#btnEditSubmission')?.addEventListener('click', () => {
        if (!getRemoteDraftId()) {
            showScreen('screen-welcome');
            return;
        }
        editingExisting = true;
        updateSelectedBrandBar();
        showScreen('screen-form');
        showPage(0);
    });
    $('#accessCode')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            continueWithBrandLogin();
        }
    });

    $('#brandDescription')?.addEventListener('input', updateDescCount);

    $('#merchantForm')?.addEventListener('input', () => {
        updateStepper();
        updateSelectedBrandBar();
        scheduleSaveDraft();
    });
    $('#merchantForm')?.addEventListener('change', () => {
        updateStepper();
        scheduleSaveDraft();
    });

    $$('[data-next]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (ENFORCE_VALIDATION && !validatePage(currentPage)) {
                attemptedSteps.add(currentPage);
                updateStepper();
                return;
            }
            attemptedSteps.add(currentPage);
            if (currentPage < STEPS - 1) showPage(currentPage + 1);
            else updateStepper();
        });
    });

    $$('[data-back]').forEach((btn) => {
        btn.addEventListener('click', () => {
            attemptedSteps.add(currentPage);
            if (currentPage === 0) {
                showScreen('screen-welcome');
            } else {
                showPage(currentPage - 1);
            }
        });
    });

    $$('input[name="paymentMethod"]').forEach((radio) => {
        radio.addEventListener('change', () => syncPaymentMethodUi());
    });

    window.addEventListener('beforeunload', () => {
        saveDraftSync();
        syncRemoteDraft();
    });

    $('#merchantForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        submitForm();
    });
}

init();
