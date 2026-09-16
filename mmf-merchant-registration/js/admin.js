import {
    ADMIN_PASSWORD,
    BRAND_DESCRIPTION_MAX,
    COLLECTION_NAME,
    EVENT_DAYS,
    FEES,
    KOL_COLLECTION,
    PAYMENT_DETAILS,
    REQUIREMENTS_COLLECTION,
    SALES_COLLECTION,
    VISITORS_COLLECTION,
    formatPeso,
} from './config.js';
import { initFirebase } from './firebase.js';

const SESSION_KEY = 'mmf_merchant_reg_admin';
const MERCHANT_TOTAL = 24;

const $ = (sel) => document.querySelector(sel);

let submissions = [];
let requirementsSubmissions = [];
let salesReports = [];
let kolReports = [];
let selectedId = null;
let showArchived = false;
let uniqueViewCount = 0;
let detailTab = 'registration';
let viewMode = 'split';
let fileModalKeyHandler = null;
let editingPaymentTagId = null;
let editingSettlementId = null;
let editingBrandDescriptionId = null;
let filterEntry = 'submitted';
let filterPayment = 'all';
let sortKey = 'updated';
let sortDir = 'desc';

function guessFileKind(url = '', name = '', type = '') {
    const haystack = `${type} ${name} ${url}`.toLowerCase();
    if (haystack.includes('application/pdf') || /\.pdf(?:$|[?#])/i.test(haystack)) return 'pdf';
    if (
        haystack.includes('image/') ||
        /\.(png|jpe?g|gif|webp|bmp|svg)(?:$|[?#])/i.test(haystack)
    ) {
        return 'image';
    }
    if (
        haystack.includes('video/') ||
        /\.(mp4|mov|webm|m4v)(?:$|[?#])/i.test(haystack)
    ) {
        return 'video';
    }
    return 'other';
}

function fileLink(file) {
    if (!file?.url) return '—';
    const label = file.name || 'Open file';
    const kind = guessFileKind(file.url, file.name, file.type || file.contentType || '');
    const pathAttr = file.path ? ` data-file-path="${escapeHtml(file.path)}"` : '';
    return `<button type="button" class="admin-file-link" data-file-url="${escapeHtml(file.url)}" data-file-name="${escapeHtml(label)}" data-file-kind="${escapeHtml(kind)}"${pathAttr}>${escapeHtml(label)}</button>`;
}

function asFileArray(files) {
    if (!files) return [];
    if (Array.isArray(files)) return files.filter((file) => file?.url);
    return files.url ? [files] : [];
}

function previewUrl(file) {
    if (!file) return '';
    if (typeof file === 'string') return file;
    return file.thumbUrl || file.url || '';
}

function fileLinks(files) {
    const list = asFileArray(files);
    if (!list.length) return '—';
    return list.map((f) => fileLink(f)).join('<br>');
}

function filePreviewTile(file, { bg = 'light', useOriginal = false } = {}) {
    if (!file?.url) return '';
    const label = file.name || 'Open file';
    const kind = guessFileKind(file.url, file.name, file.type || file.contentType || '');
    if (kind !== 'image') {
        return `<div class="req-photo-file">${fileLink(file)}</div>`;
    }
    const resolvedBg = file.thumbBg === 'dark' || bg === 'dark' ? 'dark' : 'light';
    // Logos/PNGs with transparency: use original so CSS light/dark bg shows through.
    // Opaque photo thumbs can stay as generated JPEGs.
    const src = useOriginal || isTransparentThumbPreferred(file) ? file.url : file.thumbUrl || file.url;
    const pathAttr = file.path ? ` data-file-path="${escapeHtml(file.path)}"` : '';
    if (!src) {
        return `
            <button type="button" class="req-photo-tile bg-${resolvedBg} is-pending" data-file-url="${escapeHtml(file.url)}" data-file-name="${escapeHtml(label)}" data-file-kind="image"${pathAttr} title="${escapeHtml(label)}">
                <span class="req-photo-skeleton" aria-hidden="true"></span>
            </button>
        `;
    }
    return `
        <button type="button" class="req-photo-tile bg-${resolvedBg}" data-file-url="${escapeHtml(file.url)}" data-file-name="${escapeHtml(label)}" data-file-kind="image"${pathAttr} title="${escapeHtml(label)}">
            <img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy" decoding="async" onerror="this.closest('.req-photo-tile')?.classList.add('is-broken')">
        </button>
    `;
}

function isTransparentThumbPreferred(file) {
    const hay = `${file?.type || ''} ${file?.name || ''} ${file?.path || ''} ${file?.url || ''}`.toLowerCase();
    return /image\/png|\.png(?:$|[?#])|image\/webp|\.webp(?:$|[?#])/.test(hay);
}

function filePreviews(files, { wide = false, bg = 'light', useOriginal = false } = {}) {
    const list = asFileArray(files);
    if (!list.length) return '—';
    const tiles = list.map((file) => filePreviewTile(file, { bg, useOriginal })).join('');
    const bgClass = bg === 'dark' ? 'bg-dark' : 'bg-light';
    if (list.length === 1) {
        const soloClass = wide ? `req-photo-solo is-wide ${bgClass}` : `req-photo-solo ${bgClass}`;
        return `<div class="${soloClass}">${tiles}</div>`;
    }
    return `<div class="req-photo-grid ${bgClass}">${tiles}</div>`;
}

function mediaPreview(url, name, alt, path = '') {
    if (!url) return '—';
    const label = name || alt || 'Open file';
    const kind = guessFileKind(url, name);
    const pathAttr = path ? ` data-file-path="${escapeHtml(path)}"` : '';
    const link = `<button type="button" class="admin-file-link" data-file-url="${escapeHtml(url)}" data-file-name="${escapeHtml(label)}" data-file-kind="${escapeHtml(kind)}"${pathAttr}>${escapeHtml(label)}</button>`;
    if (kind === 'image') {
        return `${link}<br><img class="proof-thumb" src="${escapeHtml(url)}" alt="${escapeHtml(alt || label)}" data-file-url="${escapeHtml(url)}" data-file-name="${escapeHtml(label)}" data-file-kind="image"${pathAttr} onerror="this.style.display='none'">`;
    }
    if (kind === 'pdf') {
        return `${link}<br><button type="button" class="admin-file-link" data-file-url="${escapeHtml(url)}" data-file-name="${escapeHtml(label)}" data-file-kind="pdf"${pathAttr}>Preview PDF</button>`;
    }
    return link;
}

function openFileModal({ url, name, kind, path = '' }) {
    const modal = $('#adminFileModal');
    const body = $('#adminFileModalBody');
    const title = $('#adminFileModalTitle');
    const downloadBtn = $('#adminFileModalDownload');
    if (!modal || !body || !title || !downloadBtn || !url) return;

    const resolvedKind = kind || guessFileKind(url, name);
    const fileName = name || 'download';
    title.textContent = fileName;
    downloadBtn.dataset.fileUrl = url;
    downloadBtn.dataset.fileName = fileName;
    downloadBtn.dataset.filePath = path || storagePathFromUrl(url) || '';
    downloadBtn.disabled = false;
    downloadBtn.textContent = 'Download';

    if (resolvedKind === 'image') {
        body.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(fileName)}">`;
    } else if (resolvedKind === 'pdf') {
        body.innerHTML = `<iframe src="${escapeHtml(url)}#toolbar=1" title="${escapeHtml(fileName)}"></iframe>`;
    } else if (resolvedKind === 'video') {
        body.innerHTML = `<video src="${escapeHtml(url)}" controls playsinline preload="metadata" style="max-width:100%;max-height:min(78vh,48rem);background:#000;"></video>`;
    } else {
        body.innerHTML = `
            <div class="admin-file-modal-fallback">
                <p>Preview is not available for this file type.</p>
                <p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open file in a new tab</a></p>
            </div>`;
    }

    modal.classList.remove('hidden');
    modal.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';

    if (fileModalKeyHandler) document.removeEventListener('keydown', fileModalKeyHandler);
    fileModalKeyHandler = (e) => {
        if (e.key === 'Escape') closeFileModal();
    };
    document.addEventListener('keydown', fileModalKeyHandler);
    $('#adminFileModalClose')?.focus();
}

function storagePathFromUrl(url) {
    try {
        const parsed = new URL(url);
        const marker = '/o/';
        const idx = parsed.pathname.indexOf(marker);
        if (idx < 0) return '';
        return decodeURIComponent(parsed.pathname.slice(idx + marker.length));
    } catch {
        return '';
    }
}

function triggerBlobDownload(blob, name) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name || 'download';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function downloadFileFromModal() {
    const btn = $('#adminFileModalDownload');
    const url = btn?.dataset?.fileUrl;
    const name = btn?.dataset?.fileName || 'download';
    const path = btn?.dataset?.filePath || storagePathFromUrl(url);
    if (!btn || !url) return;

    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = 'Downloading…';
    try {
        let blob = null;
        if (path) {
            const { storage, storageFns } = await initFirebase();
            if (typeof storageFns.getBlob === 'function') {
                blob = await storageFns.getBlob(storageFns.ref(storage, path));
            }
        }
        if (!blob) {
            const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
            if (!res.ok) throw new Error(`Download failed (${res.status})`);
            blob = await res.blob();
        }
        triggerBlobDownload(blob, name);
    } catch (err) {
        console.error('[MMF Admin] download failed', err);
        alert('Could not download this file. Please try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = prev || 'Download';
    }
}

let downloadGroupSeq = 0;
const downloadGroups = new Map();
let currentRequirementsBrand = '';
let jsZipPromise = null;

const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (jsZipPromise) return jsZipPromise;
    jsZipPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = JSZIP_CDN;
        script.async = true;
        script.onload = () => {
            if (window.JSZip) resolve(window.JSZip);
            else reject(new Error('JSZip failed to load'));
        };
        script.onerror = () => {
            jsZipPromise = null;
            reject(new Error('Could not load the ZIP library.'));
        };
        document.head.appendChild(script);
    });
    return jsZipPromise;
}

function sanitizeFileNamePart(str) {
    return String(str || '')
        .trim()
        .replace(/[^a-z0-9._-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

function groupDownloadName(file, label, index, total) {
    const original = typeof file === 'object' ? String(file?.name || '').trim() : '';
    if (original) return original;
    const base = sanitizeFileNamePart(label) || 'file';
    const url = fileUrl(file) || previewUrl(file);
    const extMatch = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(url || '');
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '';
    return total > 1 ? `${base}-${index + 1}${ext}` : `${base}${ext}`;
}

async function fetchFileBlob(file) {
    const url = fileUrl(file) || previewUrl(file);
    if (!url) return null;
    const path = (typeof file === 'object' && file?.path) ? file.path : storagePathFromUrl(url);
    let blob = null;
    if (path) {
        try {
            const { storage, storageFns } = await initFirebase();
            if (typeof storageFns.getBlob === 'function') {
                blob = await storageFns.getBlob(storageFns.ref(storage, path));
            }
        } catch (err) {
            console.warn('[MMF Admin] storage download failed, falling back to fetch', err);
        }
    }
    if (!blob) {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        blob = await res.blob();
    }
    return blob;
}

function downloadAllControl(files, label) {
    const list = asFileArray(files);
    if (!list.length) return '';
    const groupId = `dlg_${downloadGroupSeq += 1}`;
    downloadGroups.set(groupId, { files: list, label, brand: currentRequirementsBrand });
    const text = list.length > 1 ? `Download all (${list.length})` : 'Download';
    return `<button type="button" class="req-download-all" data-download-group="${escapeHtml(groupId)}" title="Download ${escapeHtml(label)}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span>${escapeHtml(text)}</span>
    </button>`;
}

function fileGroupField(label, files, renderBody) {
    const list = asFileArray(files);
    const action = downloadAllControl(list, label);
    const dt = action
        ? `<div class="detail-label-row"><span>${escapeHtml(label)}</span>${action}</div>`
        : escapeHtml(label);
    const body = typeof renderBody === 'function' ? renderBody(list) : filePreviews(list);
    return `<div class="detail-item"><dt>${dt}</dt><dd>${body}</dd></div>`;
}

function uniqueZipName(name, seen) {
    let candidate = name;
    if (!seen.has(candidate)) {
        seen.add(candidate);
        return candidate;
    }
    const dot = candidate.lastIndexOf('.');
    const base = dot > 0 ? candidate.slice(0, dot) : candidate;
    const ext = dot > 0 ? candidate.slice(dot) : '';
    let n = 2;
    do {
        candidate = `${base}-${n}${ext}`;
        n += 1;
    } while (seen.has(candidate));
    seen.add(candidate);
    return candidate;
}

async function downloadFileGroup(groupId, btn) {
    const group = downloadGroups.get(groupId);
    if (!group || !group.files.length) return;

    const prev = btn ? btn.innerHTML : '';
    const setBusy = (label) => {
        if (btn) btn.innerHTML = `<span>${escapeHtml(label)}</span>`;
    };
    if (btn) {
        btn.disabled = true;
        btn.classList.add('is-busy');
    }
    setBusy('Preparing…');

    try {
        if (group.files.length === 1) {
            const blob = await fetchFileBlob(group.files[0]);
            if (!blob) throw new Error('The file could not be downloaded.');
            triggerBlobDownload(blob, groupDownloadName(group.files[0], group.label, 0, 1));
            return;
        }

        const JSZip = await loadJSZip();
        const zip = new JSZip();
        const seen = new Set();
        let added = 0;
        let failures = 0;

        for (let i = 0; i < group.files.length; i += 1) {
            setBusy(`Zipping ${i + 1}/${group.files.length}…`);
            const file = group.files[i];
            try {
                const blob = await fetchFileBlob(file);
                if (!blob) {
                    failures += 1;
                    continue;
                }
                const name = uniqueZipName(groupDownloadName(file, group.label, i, group.files.length), seen);
                zip.file(name, blob);
                added += 1;
            } catch (err) {
                console.error('[MMF Admin] group download failed', err);
                failures += 1;
            }
        }

        if (!added) {
            alert('None of the files could be downloaded. Please try again.');
            return;
        }

        setBusy('Building ZIP…');
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const brand = sanitizeFileNamePart(group.brand) || 'merchant';
        const field = sanitizeFileNamePart(group.label) || 'files';
        triggerBlobDownload(zipBlob, `${brand}-${field}.zip`);

        if (failures) {
            alert(`${failures} file${failures === 1 ? '' : 's'} could not be added to the ZIP.`);
        }
    } catch (err) {
        console.error('[MMF Admin] zip download failed', err);
        alert(err?.message || 'Failed to build the ZIP file.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('is-busy');
            btn.innerHTML = prev;
        }
    }
}

function bindDownloadGroups(root = document) {
    root.querySelectorAll('[data-download-group]').forEach((btn) => {
        if (btn.dataset.groupBound === '1') return;
        btn.dataset.groupBound = '1';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            downloadFileGroup(btn.dataset.downloadGroup, btn);
        });
    });
}

function closeFileModal() {
    const modal = $('#adminFileModal');
    const body = $('#adminFileModalBody');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('hidden', '');
    if (body) body.innerHTML = '';
    if (fileModalKeyHandler) {
        document.removeEventListener('keydown', fileModalKeyHandler);
        fileModalKeyHandler = null;
    }
    syncDetailModal();
}

function bindFilePreviewTriggers(root = document) {
    root.querySelectorAll('[data-file-url]').forEach((el) => {
        if (el.dataset.fileBound === '1') return;
        el.dataset.fileBound = '1';
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openFileModal({
                url: el.dataset.fileUrl,
                name: el.dataset.fileName,
                kind: el.dataset.fileKind,
                path: el.dataset.filePath || '',
            });
        });
    });
}

function isDraft(doc) {
    return doc.submissionState === 'draft';
}

function isSubmitted(doc) {
    return doc.submissionState === 'submitted' || (!doc.submissionState && doc.status);
}

function isAuthed() {
    return sessionStorage.getItem(SESSION_KEY) === '1';
}

function setAuthed(on) {
    if (on) sessionStorage.setItem(SESSION_KEY, '1');
    else sessionStorage.removeItem(SESSION_KEY);
}

function showApp(authed) {
    $('#adminGate')?.classList.toggle('hidden', authed);
    $('#adminApp')?.classList.toggle('hidden', !authed);
}

function formatTimestamp(value) {
    if (!value) return '—';
    try {
        const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('en-PH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '—';
    }
}

function formatTimestampCompact(value) {
    if (!value) return '—';
    try {
        const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('en-PH', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return '—';
    }
}

function paymentTagOptions() {
    const seen = new Set();
    const options = [];
    for (const account of PAYMENT_DETAILS.accounts || []) {
        const label = String(account.label || '').trim();
        if (!label) continue;
        const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        if (!value || seen.has(value)) continue;
        seen.add(value);
        options.push({ value, label, type: account.type || '' });
    }
    for (const extra of [
        { value: 'paypal', label: 'PayPal', type: 'card' },
        { value: 'cash', label: 'Cash deposit', type: 'bank' },
        { value: 'other', label: 'Other', type: 'other' },
    ]) {
        if (seen.has(extra.value)) continue;
        seen.add(extra.value);
        options.push(extra);
    }
    return options;
}

function paymentTagLabel(tag) {
    if (!tag) return '';
    const match = paymentTagOptions().find((opt) => opt.value === tag);
    return match?.label || String(tag).replace(/_/g, ' ');
}

function displayPaymentMethod(doc) {
    const tagged = String(doc?.paymentTag || '').trim();
    if (tagged) return paymentTagLabel(tagged);
    return '';
}

const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_EDIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

function renderPaymentMethodField(doc) {
    const tagged = String(doc.paymentTag || '').trim();
    const editing = !tagged || editingPaymentTagId === doc.id;
    if (!editing) {
        return detailItem(
            'Payment method',
            `<div class="payment-tag-row">
                <span class="payment-tag-value">${escapeHtml(paymentTagLabel(tagged))}</span>
                <button type="button" class="icon-action" data-payment-tag-edit="${escapeHtml(doc.id)}" title="Edit payment method" aria-label="Edit payment method">${ICON_EDIT}</button>
            </div>`
        );
    }

    const options = paymentTagOptions()
        .map(
            (opt) =>
                `<option value="${escapeHtml(opt.value)}"${opt.value === tagged ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
        )
        .join('');

    return detailItem(
        'Payment method',
        `<div class="payment-tag-row is-editing">
            <select class="payment-tag-select" data-payment-tag-select="${escapeHtml(doc.id)}" aria-label="Payment method">
                <option value="">Select…</option>
                ${options}
            </select>
            <button type="button" class="icon-action icon-confirm" data-payment-tag-confirm="${escapeHtml(doc.id)}" title="Confirm payment method" aria-label="Confirm payment method">${ICON_CHECK}</button>
        </div>`
    );
}

function settlementLabel(type) {
    if (type === 'full') return 'Full payment';
    if (type === 'downpayment') return '50% downpayment';
    return type || '—';
}

function settlementAmount(doc) {
    if (doc?.settlementType === 'downpayment') return Number(FEES.downpaymentAmount) || 0;
    if (doc?.settlementType === 'full') return Number(FEES.totalDue) || 0;
    return 0;
}

function renderSettlementField(doc) {
    const value = doc.settlementType === 'downpayment' || doc.settlementType === 'full' ? doc.settlementType : '';
    const editing = editingSettlementId === doc.id || !value;
    if (!editing) {
        return detailItem(
            'Settlement',
            `<div class="payment-tag-row">
                <span class="payment-tag-value">${escapeHtml(settlementLabel(value))}</span>
                <button type="button" class="icon-action" data-settlement-edit="${escapeHtml(doc.id)}" title="Edit settlement" aria-label="Edit settlement">${ICON_EDIT}</button>
            </div>`
        );
    }

    return detailItem(
        'Settlement',
        `<div class="payment-tag-row is-editing">
            <select class="payment-tag-select" data-settlement-select="${escapeHtml(doc.id)}" aria-label="Settlement">
                <option value="">Select…</option>
                <option value="full"${value === 'full' ? ' selected' : ''}>Full payment</option>
                <option value="downpayment"${value === 'downpayment' ? ' selected' : ''}>50% downpayment</option>
            </select>
            <button type="button" class="icon-action icon-confirm" data-settlement-confirm="${escapeHtml(doc.id)}" title="Confirm settlement" aria-label="Confirm settlement">${ICON_CHECK}</button>
        </div>`
    );
}

function renderBrandDescriptionField(doc) {
    const value = String(doc.brandDescription || '');
    const editing = editingBrandDescriptionId === doc.id;
    if (!editing) {
        return detailItem(
            'Brand description',
            `<div class="payment-tag-row brand-desc-row">
                <span class="payment-tag-value admin-multiline">${value ? escapeHtml(value) : '—'}</span>
                <button type="button" class="icon-action" data-brand-desc-edit="${escapeHtml(doc.id)}" title="Edit brand description" aria-label="Edit brand description">${ICON_EDIT}</button>
            </div>`
        );
    }

    return detailItem(
        'Brand description',
        `<div class="brand-desc-edit">
            <textarea class="brand-desc-textarea" data-brand-desc-input="${escapeHtml(doc.id)}" rows="5" maxlength="${BRAND_DESCRIPTION_MAX}" aria-label="Brand description">${escapeHtml(value)}</textarea>
            <div class="brand-desc-edit-footer">
                <span class="brand-desc-count" data-brand-desc-count="${escapeHtml(doc.id)}">${value.length} / ${BRAND_DESCRIPTION_MAX}</span>
                <button type="button" class="icon-action icon-confirm" data-brand-desc-confirm="${escapeHtml(doc.id)}" title="Save brand description" aria-label="Save brand description">${ICON_CHECK}</button>
            </div>
        </div>`
    );
}

function paymentStatusLabel(doc, { compact = false } = {}) {
    if (isDraft(doc)) return compact ? 'Draft' : 'In progress';
    if (doc.status !== 'verified') return compact ? 'Pending' : 'Payment pending';
    if (doc.settlementType === 'downpayment') return compact ? 'DP paid' : 'Downpayment paid';
    return compact ? 'Paid' : 'Fully paid';
}

function paymentStatusClass(doc) {
    if (isDraft(doc)) return 'admin-status-text--draft';
    if (doc.status !== 'verified') return 'admin-status-text--pending';
    return 'admin-status-text--paid';
}

function hubOpenedLabel(doc, { compact = false } = {}) {
    if (!doc?.hubOpenedAt) return '';
    return compact ? 'Hub' : 'Hub opened';
}

function hubOpenedClass() {
    return 'admin-status-pill admin-status-text--hub';
}

function stepLabel(page) {
    const labels = ['Brand details', 'Terms', 'Payment', 'Support'];
    if (typeof page !== 'number' || page < 0 || page >= labels.length) return '—';
    return labels[page];
}

function paymentRank(doc) {
    if (isDraft(doc)) return 0;
    if (doc.status !== 'verified') return 1;
    return 2;
}

function isPaid(doc) {
    return !isDraft(doc) && doc.status === 'verified';
}

function visibleSubmissions() {
    const rows = submissions.filter((doc) => {
        if (Boolean(doc.archived) !== showArchived) return false;

        if (filterEntry === 'submitted' && !isSubmitted(doc)) return false;
        if (filterEntry === 'draft' && !isDraft(doc)) return false;

        if (filterPayment === 'paid' && !isPaid(doc)) return false;
        if (filterPayment === 'pending' && (isDraft(doc) || isPaid(doc))) return false;

        return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
        let cmp = 0;
        if (sortKey === 'brand') {
            cmp = String(a.brandName || '').localeCompare(String(b.brandName || ''), undefined, { sensitivity: 'base' });
        } else if (sortKey === 'status') {
            cmp = paymentRank(a) - paymentRank(b);
        } else {
            cmp = docSortTime(a) - docSortTime(b);
        }
        if (cmp === 0) cmp = docSortTime(a) - docSortTime(b);
        return cmp * dir;
    });

    return rows;
}

function emptyListMessage() {
    if (showArchived) return 'No archived submissions.';
    if (filterEntry !== 'all' || filterPayment !== 'all') return 'No submissions match these filters.';
    return 'No submissions yet.';
}

function syncFilterControls() {
    const entry = $('#adminFilterEntry');
    const payment = $('#adminFilterPayment');
    const sort = $('#adminSortBy');
    if (entry) entry.value = filterEntry;
    if (payment) payment.value = filterPayment;
    if (sort) sort.value = `${sortKey}:${sortDir}`;

    document.querySelectorAll('.admin-sort-btn').forEach((btn) => {
        const active = btn.dataset.sort === sortKey;
        btn.classList.toggle('active', active);
        btn.dataset.dir = active ? sortDir : '';
        const ind = btn.querySelector('.admin-sort-ind');
        if (ind) ind.textContent = active ? (sortDir === 'asc' ? '↑' : '↓') : '';
    });
}

function setSort(key, { toggle = true } = {}) {
    if (!key) return;
    if (toggle && sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey = key;
        sortDir = key === 'brand' ? 'asc' : 'desc';
    }
    syncFilterControls();
    if (selectedId && !visibleSubmissions().some((s) => s.id === selectedId)) {
        selectedId = null;
        renderCurrentDetail();
    }
    renderSubmissionsList();
}

function applyFiltersFromControls() {
    filterEntry = $('#adminFilterEntry')?.value || 'submitted';
    filterPayment = $('#adminFilterPayment')?.value || 'all';
    const sortValue = $('#adminSortBy')?.value || 'updated:desc';
    const [key, dir] = sortValue.split(':');
    sortKey = key || 'updated';
    sortDir = dir === 'asc' ? 'asc' : 'desc';
    syncFilterControls();

    if (selectedId && !visibleSubmissions().some((s) => s.id === selectedId)) {
        selectedId = null;
        renderCurrentDetail();
    }
    renderSubmissionsList();
}

function instagramDisplay(value) {
    const raw = String(value || '').trim();
    if (!raw) return '—';
    const handle = normalizeInstagramHandle(raw);
    const href = /^https?:\/\//i.test(raw) ? raw : `https://instagram.com/${handle}`;
    const label = handle ? `@${handle}` : raw;
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
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

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isRequirementsSubmitted(doc) {
    if (!doc) return false;
    if (doc.submissionState === 'submitted') return true;
    if (doc.submissionState === 'draft') return false;
    // Legacy docs (no submissionState): only count if they have real content
    if (doc.submissionState) return false;
    const files = doc.files && typeof doc.files === 'object' ? Object.keys(doc.files).length : 0;
    return Boolean(files || (Array.isArray(doc.equipment) && doc.equipment.length) || doc.crewNames);
}

function requirementsForRegistration(registrationId) {
    if (!registrationId) return null;
    const matches = requirementsSubmissions.filter((doc) => doc.registrationId === registrationId && !doc.archived);
    return (
        matches.find((doc) => doc.submissionState === 'submitted') ||
        matches.find((doc) => !doc.submissionState) ||
        matches.find((doc) => doc.submissionState === 'draft') ||
        null
    );
}

// Fallback order for the tiny list avatar: square first, then wide; light bg before dark.
const LIST_LOGO_CANDIDATES = [
    ['logoSquareLight', 'light'],
    ['logoSquareDark', 'dark'],
    ['logoWideLight', 'light'],
    ['logoWideDark', 'dark'],
];

function thumbFirstUrl(file) {
    if (!file) return '';
    if (typeof file === 'string') return file;
    // v4 thumbs are alpha-preserving WebP (~200px) — far smaller than the original logo.
    return file.thumbUrl || file.url || '';
}

function listLogoForRegistration(registrationId) {
    const req = requirementsForRegistration(registrationId);
    const files = req?.files;
    if (!files) return null;
    for (const [key, bg] of LIST_LOGO_CANDIDATES) {
        const raw = files[key];
        const file = Array.isArray(raw) ? raw.find(Boolean) : raw;
        const url = thumbFirstUrl(file);
        if (url) {
            const resolvedBg = (typeof file === 'object' && file?.thumbBg) || bg;
            return { url, bg: resolvedBg === 'dark' ? 'dark' : 'light' };
        }
    }
    return null;
}

function hasRequirementsDraft(registrationId) {
    if (!registrationId) return false;
    return requirementsSubmissions.some(
        (doc) => doc.registrationId === registrationId && !doc.archived && doc.submissionState === 'draft'
    );
}

function requirementsStatusLabel(registrationId, { compact = false } = {}) {
    const submitted = requirementsSubmissions.some(
        (doc) => doc.registrationId === registrationId && !doc.archived && isRequirementsSubmitted(doc)
    );
    if (submitted) return compact ? 'Done' : 'Requirements done';
    if (hasRequirementsDraft(registrationId)) return compact ? 'Incomplete' : 'Requirements incomplete';
    return compact ? 'Empty' : 'Requirements empty';
}

function requirementsStatusClass(registrationId) {
    const submitted = requirementsSubmissions.some(
        (doc) => doc.registrationId === registrationId && !doc.archived && isRequirementsSubmitted(doc)
    );
    if (submitted) return 'admin-status-pill admin-req-pill admin-req-pill--done';
    if (hasRequirementsDraft(registrationId)) return 'admin-status-pill admin-req-pill admin-req-pill--incomplete';
    return 'admin-status-pill admin-req-pill admin-req-pill--empty';
}

function updateDetailTabs() {
    const req = requirementsForRegistration(selectedId);
    const hasReq = isRequirementsSubmitted(req);
    const hasDraft = Boolean(req) && req.submissionState === 'draft';
    const reportCount = selectedId ? merchantReportDayCount(selectedId) : 0;

    $('#adminTabRegistration')?.classList.toggle('active', detailTab === 'registration');
    $('#adminTabRequirements')?.classList.toggle('active', detailTab === 'requirements');
    $('#adminTabReports')?.classList.toggle('active', detailTab === 'reports');
    $('#adminTabRegistration')?.setAttribute('aria-selected', detailTab === 'registration' ? 'true' : 'false');
    $('#adminTabRequirements')?.setAttribute('aria-selected', detailTab === 'requirements' ? 'true' : 'false');
    $('#adminTabReports')?.setAttribute('aria-selected', detailTab === 'reports' ? 'true' : 'false');

    const badge = $('#adminReqBadge');
    if (badge) {
        badge.classList.toggle('hidden', !selectedId || (!hasReq && !hasDraft));
        badge.classList.toggle('admin-req-badge--draft', hasDraft && !hasReq);
        badge.title = hasReq ? 'Requirements submitted' : hasDraft ? 'Requirements in progress' : '';
    }

    const reportsBadge = $('#adminReportsBadge');
    if (reportsBadge) {
        reportsBadge.classList.toggle('hidden', !selectedId || reportCount === 0);
        reportsBadge.title = reportCount ? `${reportCount} day(s) with reports` : '';
    }

    const title = $('#adminDetailTitle');
    if (title) {
        const registration = submissions.find((s) => s.id === selectedId);
        title.textContent = registration?.brandName || 'Detail';
    }
}

function merchantReportDayCount(merchantId) {
    const days = new Set();
    salesReports.forEach((d) => {
        if (d.merchantId === merchantId && d.date) days.add(d.date);
    });
    kolReports.forEach((d) => {
        if (d.merchantId === merchantId && d.date) days.add(d.date);
    });
    return days.size;
}

function salesForMerchantDay(merchantId, date) {
    return salesReports.find((d) => d.merchantId === merchantId && d.date === date) || null;
}

function kolForMerchantDay(merchantId, date) {
    return kolReports.find((d) => d.merchantId === merchantId && d.date === date) || null;
}

function cashFromSalesDoc(doc) {
    if (!doc) return null;
    if (doc.cashSales != null) return Number(doc.cashSales) || 0;
    if (doc.grossSales != null) return Number(doc.grossSales) || 0;
    return null;
}

function drinksFromKolDoc(doc) {
    if (!doc) return null;
    if (doc.drinksClaimed != null) return Math.round(Number(doc.drinksClaimed) || 0);
    if (Array.isArray(doc.claims)) {
        return doc.claims
            .filter((c) => (c.type || 'drink') === 'drink')
            .reduce((s, c) => s + (Number(c.qty) || 0), 0);
    }
    return null;
}

function retailFromKolDoc(doc) {
    if (!doc) return null;
    if (doc.retailClaimed != null) return Math.round(Number(doc.retailClaimed) || 0);
    if (Array.isArray(doc.claims)) {
        return doc.claims
            .filter((c) => c.type === 'retail')
            .reduce((s, c) => s + (Number(c.qty) || 0), 0);
    }
    return null;
}

function renderReportsDetail(registration) {
    const panel = $('#adminDetail');
    if (!panel) return;
    if (!registration) {
        panel.className = 'admin-detail empty';
        panel.textContent = 'Select a submission to view details.';
        return;
    }

    const merchantId = registration.id;
    let totalCash = 0;
    let totalDrinks = 0;
    let totalRetail = 0;
    let daysWithSales = 0;

    const rows = EVENT_DAYS.map((day) => {
        const sales = salesForMerchantDay(merchantId, day.date);
        const kol = kolForMerchantDay(merchantId, day.date);
        const cash = cashFromSalesDoc(sales);
        const drinks = drinksFromKolDoc(kol);
        const retail = retailFromKolDoc(kol);
        const hasAny = cash != null || drinks != null || retail != null;
        if (cash != null) {
            totalCash += cash;
            daysWithSales += 1;
        }
        if (drinks != null) totalDrinks += drinks;
        if (retail != null) totalRetail += retail;

        return `
            <tr class="${hasAny ? '' : 'admin-report-empty-row'}">
                <td>${escapeHtml(day.label)}</td>
                <td class="num">${cash != null ? escapeHtml(formatPeso(cash)) : '—'}</td>
                <td class="num">${drinks != null ? escapeHtml(String(drinks)) : '—'}</td>
                <td class="num">${retail != null ? escapeHtml(String(retail)) : '—'}</td>
            </tr>`;
    }).join('');

    panel.className = 'admin-detail';
    panel.innerHTML = `
        <div class="admin-report-block">
            <div class="admin-report-block-head">
                <h3>Daily tally</h3>
                <a class="admin-report-link" href="/admin-sales">All merchants →</a>
            </div>
            <div class="admin-table-wrap">
                <table class="admin-data-table admin-report-table">
                    <thead>
                        <tr>
                            <th>Day</th>
                            <th class="num">Cash sales</th>
                            <th class="num">Freebie drinks</th>
                            <th class="num">Freebie retail</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
        <div class="admin-report-block" style="margin-top:1.1rem;">
            <h3 class="admin-report-block-title">Event totals</h3>
            <div class="admin-report-summary">
                <div class="admin-report-stat">
                    <span class="label">Cash sales</span>
                    <strong>${escapeHtml(formatPeso(totalCash))}</strong>
                </div>
                <div class="admin-report-stat">
                    <span class="label">Freebie drinks</span>
                    <strong>${escapeHtml(String(totalDrinks))}</strong>
                </div>
                <div class="admin-report-stat">
                    <span class="label">Freebie retail</span>
                    <strong>${escapeHtml(String(totalRetail))}</strong>
                </div>
                <div class="admin-report-stat">
                    <span class="label">Days reported</span>
                    <strong>${escapeHtml(String(daysWithSales))} / ${EVENT_DAYS.length}</strong>
                </div>
            </div>
        </div>
        <p class="muted" style="margin:0.85rem 0 0;font-size:0.8rem;">
            Merchants submit these from the Merchant Hub. Numbers update when you refresh.
        </p>
    `;
}

function updateCount() {
    const count = $('#adminCount');
    if (!count) return;

    const active = submissions.filter((doc) => !doc.archived);
    const archived = submissions.filter((doc) => doc.archived).length;
    const submittedDocs = active.filter((doc) => isSubmitted(doc));
    const submitted = submittedDocs.length;
    const partialPaid = submittedDocs.filter(
        (doc) => doc.status === 'verified' && doc.settlementType === 'downpayment'
    ).length;
    const fullyPaid = submittedDocs.filter(
        (doc) => doc.status === 'verified' && doc.settlementType !== 'downpayment'
    ).length;
    const requirementsDone = submittedDocs.filter((doc) =>
        requirementsSubmissions.some(
            (req) => req.registrationId === doc.id && !req.archived && isRequirementsSubmitted(req)
        )
    ).length;
    const hubOpened = submittedDocs.filter((doc) => Boolean(doc.hubOpenedAt)).length;

    if (showArchived) {
        count.textContent = `${archived} archived`;
        return;
    }

    count.textContent = [
        `Submitted: ${submitted}/${MERCHANT_TOTAL}`,
        `Partial paid: ${partialPaid}/${MERCHANT_TOTAL}`,
        `Fully paid: ${fullyPaid}/${MERCHANT_TOTAL}`,
        `Requirements done: ${requirementsDone}/${MERCHANT_TOTAL}`,
        `Hub opened: ${hubOpened}/${MERCHANT_TOTAL}`,
    ].join(' · ');
}

function updateArchiveToggle() {
    const btn = $('#adminToggleArchived');
    if (!btn) return;
    const archivedCount = submissions.filter((doc) => doc.archived).length;
    const label = showArchived ? 'Show active' : `Show archived (${archivedCount})`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.classList.toggle('hidden', archivedCount === 0 && !showArchived);
    btn.classList.toggle('is-active', showArchived);
}

function fileUrl(file) {
    if (!file) return '';
    if (typeof file === 'string') return file;
    return file.url || '';
}

function wideLogoUrl(req) {
    const files = req?.files || {};
    // Prefer wide logos; fall back to square only if needed
    return (
        fileUrl(files.logoWideLight) ||
        fileUrl(files.logoWideDark) ||
        fileUrl(files.logoSquareLight) ||
        fileUrl(files.logoSquareDark) ||
        ''
    );
}

function resolveRequirementsBrandName(req) {
    const clean = (value) => {
        const name = String(value || '').trim();
        if (!name) return '';
        if (/^untitled(\s+brand)?$/i.test(name)) return '';
        return name;
    };
    const fromReq = clean(req?.brandName);
    if (fromReq) return fromReq;
    if (req?.registrationId) {
        const reg = submissions.find((s) => s.id === req.registrationId && !s.archived);
        return clean(reg?.brandName);
    }
    return '';
}

function submittedRequirementsForDownload(kind) {
    const cfg = downloadConfig(kind);
    const byBrand = new Map();

    for (const req of requirementsSubmissions) {
        if (req.archived) continue;
        if (req.submissionState !== 'submitted') continue;
        if (!req.registrationId) continue;

        const brand = resolveRequirementsBrandName(req);
        if (!brand) continue;

        const lines = cfg.getLines(req);
        if (!lines.length) continue;

        const enriched = { ...req, brandName: brand };
        const key = brand.toLowerCase();
        const existing = byBrand.get(key);
        if (!existing || docSortTime(enriched) >= docSortTime(existing)) {
            byBrand.set(key, enriched);
        }
    }

    return [...byBrand.values()].sort((a, b) =>
        (a.brandName || '').localeCompare(b.brandName || '', undefined, { sensitivity: 'base' })
    );
}

function splitListLines(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function formatPdfLongDate(value = new Date()) {
    try {
        const date =
            typeof value?.toDate === 'function'
                ? value.toDate()
                : value instanceof Date
                  ? value
                  : value?.seconds
                    ? new Date(value.seconds * 1000)
                    : new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    } catch {
        return '—';
    }
}

function latestRequirementsUpdatedAt(brands) {
    let latest = 0;
    for (const req of brands) {
        const t = docSortTime(req);
        if (t > latest) latest = t;
    }
    return latest ? new Date(latest) : new Date();
}

async function urlToDataUrl(url) {
    if (!url) return '';
    try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) return url;
        const blob = await res.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (err) {
        console.warn('[MMF Admin] logo embed failed', err);
        return url;
    }
}

function downloadConfig(kind) {
    if (kind === 'manpower') {
        return {
            title: 'List of Manpower per Merchant',
            filename: 'mmf-manpower-list',
            listLabel: 'List of Personnel',
            getLines: (req) => splitListLines(req.crewNames),
            getNotes: (req) => req.boothNotes || req.specialRequirements || req.logisticsNotes || '',
        };
    }
    if (kind === 'electrical') {
        return {
            title: 'List of Electrical Load Requirements per Merchant',
            filename: 'mmf-electrical-load-requirements',
            listLabel: 'Electrical Load Requirements',
            getLines: (req) => {
                const rows = Array.isArray(req.equipment) ? req.equipment : [];
                return rows
                    .filter((row) => row && (row.item || row.watts))
                    .map((row) => {
                        const item = (row.item || '').trim() || 'Item';
                        const watts = (row.watts || '').trim();
                        return watts ? `${item} — ${watts}W` : item;
                    });
            },
            getNotes: (req) => req.boothNotes || '',
        };
    }
    return {
        title: 'List of Equipment and Materials per Merchant',
        filename: 'mmf-equipments-and-materials',
        listLabel: 'Equipment and Materials',
        getLines: (req) => splitListLines(req.ingressEquipmentMaterials),
        getNotes: (req) => req.boothNotes || '',
    };
}

async function buildRequirementsDownloadHtml(kind) {
    const cfg = downloadConfig(kind);
    const brands = submittedRequirementsForDownload(kind);
    const asOfDate = formatPdfLongDate(latestRequirementsUpdatedAt(brands));
    const mmfLogoUrl = new URL('images/mmf-logo.png', window.location.href).href;
    const mmfLogo = await urlToDataUrl(mmfLogoUrl);
    const merchantCountLabel = `${brands.length} Merchant${brands.length === 1 ? '' : 's'} Total`;

    const sectionParts = await Promise.all(
        brands.map(async (req) => {
            const logoRemote = wideLogoUrl(req);
            const logo = logoRemote ? await urlToDataUrl(logoRemote) : '';
            const lines = cfg.getLines(req);
            const notes = (cfg.getNotes(req) || '').trim();
            const useTwoCols = lines.length > 14;
            const listHtml = lines.length
                ? `<ul class="${useTwoCols ? 'list-cols' : ''}">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
                : `<p class="empty">—</p>`;
            const logoHtml = logo
                ? `<img class="brand-logo" src="${logo}" alt="">`
                : '';
            return `
            <section class="brand-section">
                ${logoHtml}
                <p class="merchant"><strong>Merchant:</strong> ${escapeHtml(req.brandName)}</p>
                <p class="list-label"><strong>${escapeHtml(cfg.listLabel)}:</strong></p>
                ${listHtml}
                <p class="notes-label"><strong>Notes:</strong></p>
                <p class="notes">${notes ? escapeHtml(notes).replace(/\n/g, '<br>') : '—'}</p>
            </section>`;
        })
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(cfg.title)} — Manila Matcha Fest 2026</title>
<style>
  @page { size: letter; margin: 0.7in; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "DM Sans", "Helvetica Neue", Arial, sans-serif;
    color: #111827;
    font-size: 11pt;
    line-height: 1.45;
  }
  .letterhead {
    text-align: center;
    margin: 0 0 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid #d1d5db;
  }
  .mmf-logo {
    display: block;
    margin: 0 auto 0.85rem;
    width: min(200px, 50%);
    height: auto;
  }
  h1 {
    margin: 0 0 0.4rem;
    font-size: 18pt;
    font-weight: 700;
    letter-spacing: -0.02em;
    font-family: "DM Sans", "Helvetica Neue", Arial, sans-serif;
  }
  .subtitle {
    margin: 0;
    color: #6b7280;
    font-size: 10pt;
  }
  .brand-section {
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0 0 1.75rem;
    padding-bottom: 1.25rem;
    border-bottom: 1px solid #e5e7eb;
  }
  .brand-section:last-child {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
  }
  .brand-logo {
    display: block;
    margin: 0 auto 0.85rem;
    max-width: 320px;
    max-height: 84px;
    width: auto;
    height: auto;
    object-fit: contain;
  }
  .merchant,
  .list-label,
  .notes-label,
  .notes {
    text-align: left;
    margin: 0 0 0.4rem;
  }
  ul {
    margin: 0 0 0.75rem;
    padding-left: 1.2rem;
  }
  ul.list-cols {
    columns: 2;
    column-gap: 1.75rem;
  }
  ul.list-cols li {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  li { margin: 0.15rem 0; }
  .empty, .notes { color: #374151; white-space: pre-wrap; }
  .print-hint {
    margin-top: 1.5rem;
    text-align: center;
    color: #9ca3af;
    font-size: 9pt;
  }
  @media print {
    .print-hint { display: none; }
  }
</style>
</head>
<body>
  <header class="letterhead">
    <img class="mmf-logo" src="${mmfLogo}" alt="Manila Matcha Fest">
    <h1>${escapeHtml(cfg.title)}</h1>
    <p class="subtitle">Manila Matcha Fest 2026 · ${escapeHtml(merchantCountLabel)} · Updated ${escapeHtml(asOfDate)}</p>
  </header>
  ${sectionParts.join('') || '<p style="text-align:center;color:#6b7280;">No merchant submissions available for this report.</p>'}
  <p class="print-hint">Use Print → Save as PDF (Letter).</p>
</body>
</html>`;
}

function closeDownloadMenu() {
    const menu = $('#adminDownloadMenu');
    const btn = $('#adminDownload');
    menu?.classList.add('hidden');
    btn?.setAttribute('aria-expanded', 'false');
}

function toggleDownloadMenu() {
    const menu = $('#adminDownloadMenu');
    const btn = $('#adminDownload');
    if (!menu || !btn) return;
    const open = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

async function downloadRequirementsPdf(kind) {
    const cfg = downloadConfig(kind);
    const brands = submittedRequirementsForDownload(kind);
    if (!brands.length) {
        alert('No submitted requirements with this data yet.');
        return;
    }

    const downloadBtn = $('#adminDownload');
    if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.title = 'Preparing…';
    }

    try {
        const html = await buildRequirementsDownloadHtml(kind);
        const win = window.open('', '_blank');
        if (!win) {
            alert('Pop-up blocked. Allow pop-ups to download the PDF.');
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
        win.document.title = `${cfg.filename}.pdf`;
        setTimeout(() => {
            try {
                win.focus();
                win.print();
            } catch (err) {
                console.warn('[MMF Admin] print failed', err);
            }
        }, 150);
    } catch (err) {
        console.error('[MMF Admin] download failed', err);
        alert(err?.message || 'Failed to prepare download.');
    } finally {
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.title = 'Download';
        }
    }
}

function downloadBlobFile(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function excelXmlEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function excelStringCell(value) {
    return `<Cell><Data ss:Type="String">${excelXmlEscape(value)}</Data></Cell>`;
}

function excelNumberCell(value) {
    if (value === '' || value == null || Number.isNaN(Number(value))) {
        return '<Cell/>';
    }
    return `<Cell ss:StyleID="Peso"><Data ss:Type="Number">${Number(value)}</Data></Cell>`;
}

/** SpreadsheetML formulas must use R1C1 notation (A1 gets corrupted to 'G2':'G22'). */
function excelFormulaCell(r1c1Formula) {
    return `<Cell ss:StyleID="Peso" ss:Formula="=${r1c1Formula}"><Data ss:Type="Number">0</Data></Cell>`;
}

function exportPaymentReconciliationExcel() {
    const methods = paymentTagOptions();
    const methodKeys = methods.map((m) => m.value);
    const rows = submissions
        .filter((doc) => isSubmitted(doc) && !doc.archived)
        .sort((a, b) =>
            String(a.brandName || '').localeCompare(String(b.brandName || ''), undefined, { sensitivity: 'base' })
        );

    if (!rows.length) {
        alert('No submitted registrations to export yet.');
        return;
    }

    // 0-based column indexes
    const firstAmountCol = 3; // D
    const lastAmountCol = firstAmountCol + methodKeys.length; // includes Untagged
    const rowTotalCol = lastAmountCol + 1;
    const firstDataRow = 2;
    const lastDataRow = firstDataRow + rows.length - 1;

    const headerCells = [
        excelStringCell('Brand'),
        excelStringCell('Settlement'),
        excelStringCell('Status'),
        ...methods.map((m) => excelStringCell(m.label)),
        excelStringCell('Untagged'),
        excelStringCell('Row total'),
    ].join('');

    const dataRowsXml = rows
        .map((doc, index) => {
            const amount = isPaid(doc) ? settlementAmount(doc) : 0;
            const tag = String(doc.paymentTag || '').trim();
            const amounts = Object.fromEntries([...methodKeys, 'untagged'].map((key) => [key, '']));
            if (amount > 0) {
                const key = tag && methodKeys.includes(tag) ? tag : 'untagged';
                amounts[key] = amount;
            }

            const amountCells = [
                ...methodKeys.map((key) => excelNumberCell(amounts[key])),
                excelNumberCell(amounts.untagged),
                // RC style: same row, amount columns (1-based)
                excelFormulaCell(`SUM(RC${firstAmountCol + 1}:RC${lastAmountCol + 1})`),
            ].join('');

            return `<Row>${[
                excelStringCell(doc.brandName || 'Untitled brand'),
                excelStringCell(settlementLabel(doc.settlementType)),
                excelStringCell(paymentStatusLabel(doc)),
                amountCells,
            ].join('')}</Row>`;
        })
        .join('');

    const totalAmountCells = [];
    for (let col = firstAmountCol; col <= rowTotalCol; col += 1) {
        const c = col + 1; // 1-based
        totalAmountCells.push(excelFormulaCell(`SUM(R${firstDataRow}C${c}:R${lastDataRow}C${c})`));
    }

    const totalRowXml = `<Row>${[
        excelStringCell('TOTAL'),
        excelStringCell(''),
        excelStringCell(''),
        ...totalAmountCells,
    ].join('')}</Row>`;

    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Font ss:FontName="Calibri" ss:Size="11"/>
  </Style>
  <Style ss:ID="Peso">
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Payments">
  <Table>
   <Column ss:Width="160"/>
   <Column ss:Width="110"/>
   <Column ss:Width="120"/>
   ${Array.from({ length: methodKeys.length + 2 }, () => '<Column ss:Width="90"/>').join('')}
   <Row ss:StyleID="Header">${headerCells}</Row>
   ${dataRowsXml}
   ${totalRowXml}
  </Table>
 </Worksheet>
</Workbook>`;

    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlobFile(
        `mmf-payment-reconciliation-${stamp}.xls`,
        new Blob([xml], { type: 'application/vnd.ms-excel' })
    );
}

function setViewMode(mode) {
    viewMode = mode === 'table' ? 'table' : 'split';
    try {
        sessionStorage.setItem('mmf_admin_view', viewMode);
    } catch {
        /* ignore */
    }
    $('#adminMain')?.setAttribute('data-view', viewMode);
    $('#adminList')?.classList.toggle('hidden', viewMode === 'table');
    $('#adminTableWrap')?.classList.toggle('hidden', viewMode !== 'table');
    document.querySelectorAll('.admin-view-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.view === viewMode);
    });
    renderSubmissionsList();
}

function renderSubmissionsList() {
    if (viewMode === 'table') renderTable();
    else renderList();
}

function renderCurrentDetail() {
    updateDetailTabs();
    const registration = submissions.find((s) => s.id === selectedId) || null;
    if (detailTab === 'requirements') {
        renderRequirementsDetail(registration, requirementsForRegistration(selectedId));
    } else if (detailTab === 'reports') {
        renderReportsDetail(registration);
    } else {
        renderDetail(registration);
    }
    syncDetailModal();
}

function isMobileDetailMode() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 899px)').matches;
}

function syncDetailModal() {
    const panel = $('#adminDetailPanel');
    const backdrop = $('#adminDetailBackdrop');
    if (!panel) return;

    const open = Boolean(selectedId) && isMobileDetailMode();
    panel.classList.toggle('is-open', open);
    backdrop?.classList.toggle('is-open', open);
    if (backdrop) {
        if (open) backdrop.removeAttribute('hidden');
        else backdrop.setAttribute('hidden', '');
    }
    panel.setAttribute('aria-modal', open ? 'true' : 'false');

    const fileModal = $('#adminFileModal');
    const fileOpen = Boolean(fileModal && !fileModal.classList.contains('hidden'));
    document.body.style.overflow = open || fileOpen ? 'hidden' : '';
}

function closeDetailModal() {
    if (!selectedId && !$('#adminDetailPanel')?.classList.contains('is-open')) return;
    selectedId = null;
    editingPaymentTagId = null;
    editingSettlementId = null;
    editingBrandDescriptionId = null;
    detailTab = 'registration';
    renderSubmissionsList();
    renderCurrentDetail();
}

function selectSubmission(id) {
    if (selectedId !== id) {
        editingPaymentTagId = null;
        editingSettlementId = null;
        editingBrandDescriptionId = null;
    }
    selectedId = id;
    renderSubmissionsList();
    renderCurrentDetail();
}

function bindSubmissionRow(row) {
    const open = () => selectSubmission(row.dataset.id);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
        }
    });
}

function renderList() {
    const list = $('#adminList');
    if (!list) return;

    const rows = visibleSubmissions();
    updateCount();
    updateArchiveToggle();
    syncFilterControls();

    if (!rows.length) {
        list.innerHTML = `<div class="admin-empty">${escapeHtml(emptyListMessage())}</div>`;
        return;
    }

    list.innerHTML = rows
        .map((doc, index) => {
            const selected = doc.id === selectedId ? ' selected' : '';
            const logo = listLogoForRegistration(doc.id);
            const thumb = logo
                ? `<img class="admin-row-thumb bg-${logo.bg}" src="${escapeHtml(logo.url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
                : '';
            return `
            <div class="admin-row${selected}${logo ? ' has-thumb' : ''}" data-id="${escapeHtml(doc.id)}" role="button" tabindex="0">
                <span class="admin-row-num" aria-hidden="true">${index + 1}</span>
                ${thumb}
                <div class="admin-row-main">
                    <div class="admin-row-title">
                        <span class="brand">${escapeHtml(doc.brandName || 'Untitled brand')}</span>
                    </div>
                    <div class="meta">${escapeHtml(doc.contactPerson || '')} · ${escapeHtml(doc.email || '')}</div>
                    <div class="meta">${escapeHtml(displayPaymentMethod(doc) || 'Payment untagged')}</div>
                    <div class="meta">${escapeHtml(settlementLabel(doc.settlementType))}</div>
                </div>
                <div class="admin-row-side">
                    <span class="${requirementsStatusClass(doc.id)}">${escapeHtml(requirementsStatusLabel(doc.id))}</span>
                    <span class="admin-status-pill ${paymentStatusClass(doc)}">${escapeHtml(paymentStatusLabel(doc))}</span>
                    ${doc.hubOpenedAt ? `<span class="${hubOpenedClass()}">${escapeHtml(hubOpenedLabel(doc))}</span>` : ''}
                    <div class="meta">${escapeHtml(formatTimestamp(doc.updatedAt || doc.createdAt))}</div>
                </div>
            </div>`;
        })
        .join('');

    list.querySelectorAll('.admin-row').forEach(bindSubmissionRow);
}

function renderTable() {
    const tbody = $('#adminTableBody');
    if (!tbody) return;

    const rows = visibleSubmissions();
    updateCount();
    updateArchiveToggle();
    syncFilterControls();

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="admin-table-empty">${escapeHtml(emptyListMessage())}</td></tr>`;
        return;
    }

    tbody.innerHTML = rows
        .map((doc, index) => {
            const selected = doc.id === selectedId ? ' selected' : '';
            return `
            <tr class="admin-table-row${selected}" data-id="${escapeHtml(doc.id)}" tabindex="0" role="button">
                <td class="admin-table-num">${index + 1}</td>
                <td class="admin-table-brand">${escapeHtml(doc.brandName || 'Untitled brand')}</td>
                <td><span class="${requirementsStatusClass(doc.id)}">${escapeHtml(requirementsStatusLabel(doc.id, { compact: true }))}</span></td>
                <td><span class="admin-status-pill ${paymentStatusClass(doc)}">${escapeHtml(paymentStatusLabel(doc, { compact: true }))}</span>${doc.hubOpenedAt ? ` <span class="${hubOpenedClass()}">${escapeHtml(hubOpenedLabel(doc, { compact: true }))}</span>` : ''}</td>
                <td class="admin-table-date">${escapeHtml(formatTimestampCompact(doc.updatedAt || doc.createdAt))}</td>
            </tr>`;
        })
        .join('');

    tbody.querySelectorAll('.admin-table-row').forEach(bindSubmissionRow);
}

function detailItem(label, value) {
    const display = value === null || value === undefined || value === '' ? '—' : value;
    return `<div class="detail-item"><dt>${escapeHtml(label)}</dt><dd>${display}</dd></div>`;
}

function multilineHtml(text) {
    if (text === null || text === undefined || text === '') return '—';
    return `<span class="admin-multiline">${escapeHtml(text)}</span>`;
}

function renderDetail(doc) {
    const panel = $('#adminDetail');
    if (!panel) return;
    if (!doc) {
        panel.className = 'admin-detail empty';
        panel.textContent = 'Select a submission to view details.';
        return;
    }

    const s = doc.supplierInterest || {};
    const isVerified = doc.status === 'verified';
    const draft = isDraft(doc);
    const proof = doc.proofOfPaymentUrl
        ? mediaPreview(doc.proofOfPaymentUrl, doc.proofOfPaymentName, 'Proof of payment', doc.proofOfPaymentPath || '')
        : doc.proofOfPaymentPendingName
            ? escapeHtml(`Selected: ${doc.proofOfPaymentPendingName} (not uploaded yet)`)
            : '—';

    const businessDoc = doc.businessDocUrl
        ? mediaPreview(doc.businessDocUrl, doc.businessDocName, 'Business document', doc.businessDocPath || '')
        : doc.businessDocPendingName
            ? escapeHtml(`Selected: ${doc.businessDocPendingName} (not uploaded yet)`)
            : '—';

    const supplierBits = [];
    if (s.none) supplierBits.push('None — handling themselves');
    if (s.ice) supplierBits.push('Ice');
    if (s.water) supplierBits.push('Water');
    if (s.crewMeals) supplierBits.push('Crew meals');
    if (s.milk) supplierBits.push('Milk');
    if (s.other) supplierBits.push(s.otherText ? `Other: ${s.otherText}` : 'Other');

    panel.className = 'admin-detail';
    panel.innerHTML = `
        <div class="detail-grid">
            ${detailItem('Requirements', `<span class="${requirementsStatusClass(doc.id)}">${escapeHtml(requirementsStatusLabel(doc.id))}</span>`)}
            ${detailItem('Payment status', `<span class="admin-status-pill ${paymentStatusClass(doc)}">${escapeHtml(paymentStatusLabel(doc))}</span>`)}
            ${draft ? detailItem('Form step', escapeHtml(stepLabel(doc.draftMeta?.currentPage))) : ''}
            ${draft ? detailItem('Last updated', escapeHtml(formatTimestamp(doc.updatedAt))) : ''}
            ${detailItem('Brand', escapeHtml(doc.brandName))}
            ${detailItem('Registered business', escapeHtml(doc.registeredBusinessName))}
            ${detailItem('Contact', escapeHtml(doc.contactPerson))}
            ${detailItem('Role', escapeHtml(doc.role))}
            ${detailItem('Phone', escapeHtml(doc.contactNumber))}
            ${detailItem('Email', escapeHtml(doc.email))}
            ${detailItem('Instagram', instagramDisplay(doc.instagram))}
            ${detailItem('Other links', escapeHtml((Array.isArray(doc.otherLinks) && doc.otherLinks.length ? doc.otherLinks : doc.tiktokOther ? [doc.tiktokOther] : []).join(', ') || '—'))}
            ${renderBrandDescriptionField(doc)}
            ${detailItem('Business document', businessDoc)}
            ${renderSettlementField(doc)}
            ${renderPaymentMethodField(doc)}
            ${doc.paymentDetailsEmail?.sentAt ? detailItem('Payment details emailed', escapeHtml(formatTimestamp(doc.paymentDetailsEmail.sentAt))) : ''}
            ${doc.finalPaymentDetailsEmail?.sentAt ? detailItem('Final payment details emailed', escapeHtml(formatTimestamp(doc.finalPaymentDetailsEmail.sentAt))) : ''}
            ${doc.requirementsInviteEmail?.sentAt ? detailItem('Requirements invite emailed', escapeHtml(formatTimestamp(doc.requirementsInviteEmail.sentAt))) : ''}
            ${detailItem('Proof of payment', proof)}
            ${detailItem('Supplier interest', escapeHtml(supplierBits.join(', ') || '—'))}
            ${detailItem('Notes', escapeHtml(doc.notes))}
            ${detailItem('Payment verified at', escapeHtml(formatTimestamp(doc.verifiedAt)))}
            ${detailItem('Hub opened', doc.hubOpenedAt ? escapeHtml(formatTimestamp(doc.hubOpenedAt)) : 'Not yet')}
            ${doc.hubLastOpenedAt ? detailItem('Hub last opened', escapeHtml(formatTimestamp(doc.hubLastOpenedAt))) : ''}
            ${doc.hubOpenCount ? detailItem('Hub opens', escapeHtml(String(doc.hubOpenCount))) : ''}
            ${detailItem('Submitted', escapeHtml(formatTimestamp(doc.submittedAt || doc.createdAt)))}
            ${detailItem('ID', escapeHtml(doc.id))}
        </div>
        <div class="admin-detail-footer">
            ${!draft && !isVerified ? `<button type="button" class="btn" data-verify-id="${escapeHtml(doc.id)}">Verify payment</button>` : ''}
            ${!draft && isVerified && doc.settlementType === 'downpayment'
                ? `<button type="button" class="btn" data-confirm-balance-id="${escapeHtml(doc.id)}">Confirm balance payment</button>`
                : ''}
            ${doc.archived
                ? `<button type="button" class="btn btn-ghost" data-restore-id="${escapeHtml(doc.id)}">Restore</button>`
                : `<button type="button" class="btn btn-ghost" data-archive-id="${escapeHtml(doc.id)}">Archive</button>`}
        </div>
    `;

    bindFilePreviewTriggers(panel);
    bindPaymentTagControls(panel, doc);
    bindSettlementControls(panel, doc);
    bindBrandDescriptionControls(panel, doc);

    panel.querySelector('[data-verify-id]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        verifySubmission(doc.id);
    });
    panel.querySelector('[data-confirm-balance-id]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmBalancePayment(doc.id);
    });
    panel.querySelector('[data-archive-id]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        archiveSubmission(doc.id, true);
    });
    panel.querySelector('[data-restore-id]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        archiveSubmission(doc.id, false);
    });
}

function bindPaymentTagControls(panel, doc) {
    panel.querySelector('[data-payment-tag-edit]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        editingPaymentTagId = doc.id;
        editingSettlementId = null;
        editingBrandDescriptionId = null;
        renderDetail(doc);
    });
    panel.querySelector('[data-payment-tag-confirm]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const select = panel.querySelector(`[data-payment-tag-select="${doc.id}"]`);
        savePaymentTag(doc.id, select?.value || '');
    });
}

function bindSettlementControls(panel, doc) {
    panel.querySelector('[data-settlement-edit]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        editingSettlementId = doc.id;
        editingPaymentTagId = null;
        editingBrandDescriptionId = null;
        renderDetail(doc);
    });
    panel.querySelector('[data-settlement-confirm]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const select = panel.querySelector(`[data-settlement-select="${doc.id}"]`);
        saveSettlement(doc.id, select?.value || '');
    });
}

function bindBrandDescriptionControls(panel, doc) {
    panel.querySelector('[data-brand-desc-edit]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        editingBrandDescriptionId = doc.id;
        editingPaymentTagId = null;
        editingSettlementId = null;
        renderDetail(doc);
        panel.querySelector(`[data-brand-desc-input="${doc.id}"]`)?.focus();
    });
    const input = panel.querySelector(`[data-brand-desc-input="${doc.id}"]`);
    const count = panel.querySelector(`[data-brand-desc-count="${doc.id}"]`);
    input?.addEventListener('input', () => {
        if (!count) return;
        const len = input.value.length;
        count.textContent = `${len} / ${BRAND_DESCRIPTION_MAX}`;
        count.classList.toggle('over', len > BRAND_DESCRIPTION_MAX);
    });
    panel.querySelector('[data-brand-desc-confirm]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        saveBrandDescription(doc.id, input?.value || '');
    });
}

async function saveBrandDescription(id, brandDescription) {
    const value = String(brandDescription || '').trim();
    if (value.length > BRAND_DESCRIPTION_MAX) {
        alert(`Brand description must be ${BRAND_DESCRIPTION_MAX} characters or fewer.`);
        return;
    }

    const confirmBtn = document.querySelector(`[data-brand-desc-confirm="${id}"]`);
    if (confirmBtn) confirmBtn.disabled = true;

    try {
        const { db, firestoreFns } = await initFirebase();
        await firestoreFns.updateDoc(firestoreFns.doc(db, COLLECTION_NAME, id), {
            brandDescription: value,
            brandDescriptionUpdatedAt: firestoreFns.serverTimestamp(),
            updatedAt: firestoreFns.serverTimestamp(),
        });

        const idx = submissions.findIndex((s) => s.id === id);
        if (idx >= 0) {
            submissions[idx] = {
                ...submissions[idx],
                brandDescription: value,
                brandDescriptionUpdatedAt: new Date(),
            };
        }
        editingBrandDescriptionId = null;
        renderSubmissionsList();
        renderCurrentDetail();
    } catch (err) {
        console.error('[MMF Admin] brand description update failed', err);
        alert(err?.message || 'Failed to save brand description.');
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

async function saveSettlement(id, settlementType) {
    const value = String(settlementType || '').trim();
    if (value !== 'full' && value !== 'downpayment') {
        alert('Select a settlement type first.');
        return;
    }

    const confirmBtn = document.querySelector(`[data-settlement-confirm="${id}"]`);
    if (confirmBtn) confirmBtn.disabled = true;

    try {
        const { db, firestoreFns } = await initFirebase();
        await firestoreFns.updateDoc(firestoreFns.doc(db, COLLECTION_NAME, id), {
            settlementType: value,
            settlementUpdatedAt: firestoreFns.serverTimestamp(),
            updatedAt: firestoreFns.serverTimestamp(),
        });

        const idx = submissions.findIndex((s) => s.id === id);
        if (idx >= 0) {
            submissions[idx] = {
                ...submissions[idx],
                settlementType: value,
                settlementUpdatedAt: new Date(),
            };
        }
        editingSettlementId = null;
        renderSubmissionsList();
        renderCurrentDetail();
    } catch (err) {
        console.error('[MMF Admin] settlement update failed', err);
        alert(err?.message || 'Failed to save settlement.');
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

async function savePaymentTag(id, tag) {
    const value = String(tag || '').trim();
    if (!value) {
        alert('Select a payment method first.');
        return;
    }

    const confirmBtn = document.querySelector(`[data-payment-tag-confirm="${id}"]`);
    if (confirmBtn) confirmBtn.disabled = true;

    try {
        const { db, firestoreFns } = await initFirebase();
        await firestoreFns.updateDoc(firestoreFns.doc(db, COLLECTION_NAME, id), {
            paymentTag: value,
            paymentTaggedAt: firestoreFns.serverTimestamp(),
            updatedAt: firestoreFns.serverTimestamp(),
        });

        const idx = submissions.findIndex((s) => s.id === id);
        if (idx >= 0) {
            submissions[idx] = {
                ...submissions[idx],
                paymentTag: value,
                paymentTaggedAt: new Date(),
            };
        }
        editingPaymentTagId = null;
        renderSubmissionsList();
        renderCurrentDetail();
    } catch (err) {
        console.error('[MMF Admin] payment tag failed', err);
        alert(err?.message || 'Failed to save payment tag.');
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

function renderRequirementsDetail(registration, doc) {
    const panel = $('#adminDetail');
    if (!panel) return;
    if (!registration) {
        panel.className = 'admin-detail empty';
        panel.textContent = 'Select a submission to view details.';
        return;
    }
    if (!doc) {
        panel.className = 'admin-detail empty';
        panel.innerHTML = `
            <p>No requirements submitted yet for <strong>${escapeHtml(registration.brandName || 'this merchant')}</strong>.</p>
            <p class="muted" style="margin-top:0.5rem;font-size:0.85rem;">Requirements are linked to the merchant registration and can only be submitted after the first form.</p>
        `;
        return;
    }

    const files = doc.files || {};
    const logoKeys = [
        ['logoSquareDark', 'Square logo — dark bg'],
        ['logoSquareLight', 'Square logo — light bg'],
        ['logoWideDark', 'Wide logo — dark bg'],
        ['logoWideLight', 'Wide logo — light bg'],
    ];
    const equipmentRows = Array.isArray(doc.equipment) ? doc.equipment : [];
    const equipmentHtml = equipmentRows.length
        ? equipmentRows
              .map((row) => escapeHtml(`${row.item || '—'} — ${row.watts || '0'}W`))
              .join('<br>')
        : escapeHtml(doc.equipmentList || '—');
    const selling = Array.isArray(doc.sellingCategories) ? doc.sellingCategories : [];
    const sellingLabels = {
        matcha_drinks: 'Matcha drinks',
        coffee: 'Coffee drinks',
        other_drinks: 'Other drinks',
        desserts: 'Desserts',
        pastries: 'Pastries',
        snacks: 'Snacks',
        other_food: 'Other food',
        drinks: 'Drinks',
        food: 'Food',
        matcha_powder: 'Matcha powder',
        tools: 'Tools',
        merch: 'Merch',
        other: 'Others',
    };
    const sellingHtml = selling.length
        ? escapeHtml(
              selling
                  .map((value) => {
                      if (value === 'other' && doc.sellingOtherText) {
                          return `Others: ${doc.sellingOtherText}`;
                      }
                      return sellingLabels[value] || value;
                  })
                  .join(', ')
          )
        : '—';
    const videoLinks = Array.isArray(doc.brandVideoLinks)
        ? doc.brandVideoLinks
        : String(doc.brandVideoLinks || '')
              .split(/\n+/)
              .map((line) => line.trim())
              .filter(Boolean);
    const videoLinksHtml = videoLinks.length
        ? videoLinks
              .map(
                  (url) =>
                      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
              )
              .join('<br>')
        : '—';

    downloadGroups.clear();
    currentRequirementsBrand = String(doc.brandName || registration?.brandName || '').trim();

    panel.className = 'admin-detail';
    panel.innerHTML = `
        <div class="detail-grid">
            ${detailItem('Brand', escapeHtml(doc.brandName))}
            ${detailItem('Registration ID', escapeHtml(doc.registrationId))}
            ${detailItem('Email', escapeHtml(doc.registrationEmail))}
            ${logoKeys
                .map(([key, label]) =>
                    fileGroupField(label, files[key], (list) =>
                        filePreviews(list, {
                            wide: /wide/i.test(key) || /wide/i.test(label),
                            bg: /dark/i.test(key) || /dark/i.test(label) ? 'dark' : 'light',
                            useOriginal: true,
                        })
                    )
                )
                .join('')}
            ${fileGroupField(
                'Booth photos',
                Array.isArray(files.boothLayout) ? files.boothLayout : files.boothLayout ? [files.boothLayout] : [],
                (list) => filePreviews(list, { bg: 'light' })
            )}
            ${detailItem('Electrical load requirements', equipmentHtml)}
            ${detailItem('Equipment and materials (ingress)', multilineHtml(doc.ingressEquipmentMaterials))}
            ${detailItem('List of personnel', multilineHtml(doc.crewNames))}
            ${detailItem('Notes', multilineHtml([doc.boothNotes || doc.specialRequirements, doc.logisticsNotes].filter(Boolean).join('\n\n')))}
            ${detailItem('Sales', sellingHtml)}
            ${fileGroupField('Menu photos', files.menuPhotos || (files.menuFile ? [files.menuFile] : []), (list) => filePreviews(list, { bg: 'light' }))}
            ${fileGroupField('Product photos', files.productPhotos, (list) => filePreviews(list, { bg: 'light' }))}
            ${detailItem('Brand video links', videoLinksHtml)}
            ${fileGroupField('Brand videos', files.brandVideos, (list) => fileLinks(list))}
            ${detailItem('Exclusive hero drink/s', multilineHtml(doc.heroDrink))}
            ${detailItem('Exclusive promotion', multilineHtml(doc.exclusivePromo))}
            ${detailItem('Upcoming pop-up', multilineHtml(doc.preEventShootLocations))}
            ${detailItem('Ex-deal items', multilineHtml(doc.exDealItems))}
            ${detailItem('Submitted', escapeHtml(formatTimestamp(doc.submittedAt || doc.createdAt)))}
            ${detailItem('ID', escapeHtml(doc.id))}
        </div>
        ${renderRequirementsUpdateLog(doc)}
    `;
    bindFilePreviewTriggers(panel);
    bindDownloadGroups(panel);
}

function requirementsUpdateLogEntries(doc) {
    const log = Array.isArray(doc.updateLog) ? doc.updateLog.filter((entry) => entry && entry.type) : [];
    if (log.length) return log;
    if (doc.submittedAt || doc.createdAt) {
        return [{ type: 'submitted', at: doc.submittedAt || doc.createdAt }];
    }
    return [];
}

function renderRequirementsUpdateLog(doc) {
    const entries = requirementsUpdateLogEntries(doc);
    if (!entries.length) return '';
    const labels = {
        submitted: 'Submitted',
        updated: 'Updated',
    };
    const items = entries
        .map((entry) => {
            const label = labels[entry.type] || String(entry.type || 'Update');
            return `<li><span class="update-log-type">${escapeHtml(label)}</span><time>${escapeHtml(formatTimestamp(entry.at))}</time></li>`;
        })
        .join('');
    return `
        <section class="requirements-update-log" aria-label="Update log">
            <h4>Update log</h4>
            <p class="muted update-log-note">Logged on first submit, then only when something changes and at least 30 minutes have passed since the last log entry.</p>
            <ol>${items}</ol>
        </section>
    `;
}

function switchDetailTab(tab) {
    if (detailTab === tab) return;
    detailTab = tab;
    renderCurrentDetail();
}

async function verifySubmission(id) {
    const btn = document.querySelector(`[data-verify-id="${id}"]`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Verifying…';
    }

    try {
        const { db, firestoreFns } = await initFirebase();
        const docRef = firestoreFns.doc(db, COLLECTION_NAME, id);
        await firestoreFns.updateDoc(docRef, {
            status: 'verified',
            verifiedAt: firestoreFns.serverTimestamp(),
            updatedAt: firestoreFns.serverTimestamp(),
        });

        const idx = submissions.findIndex((s) => s.id === id);
        if (idx >= 0) {
            submissions[idx] = {
                ...submissions[idx],
                status: 'verified',
                verifiedAt: new Date(),
            };
        }
        renderSubmissionsList();
        renderCurrentDetail();
    } catch (err) {
        console.error('[MMF Admin] verify failed', err);
        alert(err?.message || 'Failed to verify payment.');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Verify payment';
        }
    }
}

async function confirmBalancePayment(id) {
    const doc = submissions.find((s) => s.id === id);
    const brand = doc?.brandName || 'this merchant';
    const ok = confirm(
        `Confirm remaining balance paid for ${brand}?\n\nThis marks them as fully paid.`
    );
    if (!ok) return;

    const btn = document.querySelector(`[data-confirm-balance-id="${id}"]`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Confirming…';
    }

    try {
        const { db, firestoreFns } = await initFirebase();
        const docRef = firestoreFns.doc(db, COLLECTION_NAME, id);
        await firestoreFns.updateDoc(docRef, {
            settlementType: 'full',
            balancePaidAt: firestoreFns.serverTimestamp(),
            settlementUpdatedAt: firestoreFns.serverTimestamp(),
            updatedAt: firestoreFns.serverTimestamp(),
        });

        const idx = submissions.findIndex((s) => s.id === id);
        if (idx >= 0) {
            submissions[idx] = {
                ...submissions[idx],
                settlementType: 'full',
                balancePaidAt: new Date(),
                settlementUpdatedAt: new Date(),
            };
        }
        renderSubmissionsList();
        renderCurrentDetail();
    } catch (err) {
        console.error('[MMF Admin] confirm balance failed', err);
        alert(err?.message || 'Failed to confirm balance payment.');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Confirm balance payment';
        }
    }
}

async function sendPaymentDetailsEmail(id) {
    const btn = document.querySelector(`[data-payment-details-email-id="${id}"]`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
    }

    try {
        const { functions, functionsFns } = await initFirebase();
        if (!functionsFns?.httpsCallable || !functions) {
            throw new Error('Firebase Functions is not available');
        }
        const sendFn = functionsFns.httpsCallable(functions, 'sendPaymentDetailsEmail');
        await sendFn({ registrationId: id });

        const idx = submissions.findIndex((s) => s.id === id);
        if (idx >= 0) {
            submissions[idx] = {
                ...submissions[idx],
                paymentDetailsEmail: {
                    sent: true,
                    sentAt: new Date(),
                },
            };
        }
        renderSubmissionsList();
        renderCurrentDetail();
        alert('Payment details emailed to the merchant.');
    } catch (err) {
        console.error('[MMF Admin] payment details email failed', err);
        const message = err?.message || err?.details || 'Failed to send payment details email.';
        alert(message);
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Send payment details';
        }
    }
}

async function sendFinalPaymentDetailsEmail(id) {
    const btn = document.querySelector(`[data-final-payment-email-id="${id}"]`);
    const doc = submissions.find((s) => s.id === id);
    const idleLabel = doc?.finalPaymentDetailsEmail?.sent
        ? 'Resend final payment details'
        : 'Send final payment details';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
    }

    try {
        const { functions, functionsFns } = await initFirebase();
        if (!functionsFns?.httpsCallable || !functions) {
            throw new Error('Firebase Functions is not available');
        }
        const sendFn = functionsFns.httpsCallable(functions, 'sendFinalPaymentDetailsEmail');
        await sendFn({ registrationId: id });

        const idx = submissions.findIndex((s) => s.id === id);
        if (idx >= 0) {
            submissions[idx] = {
                ...submissions[idx],
                finalPaymentDetailsEmail: {
                    sent: true,
                    sentAt: new Date(),
                },
            };
        }
        renderSubmissionsList();
        renderCurrentDetail();
        alert('Final payment details emailed to the merchant.');
    } catch (err) {
        console.error('[MMF Admin] final payment details email failed', err);
        const message = err?.message || err?.details || 'Failed to send final payment details email.';
        alert(message);
        if (btn) {
            btn.disabled = false;
            btn.textContent = idleLabel;
        }
    }
}

async function sendRequirementsInviteEmail(id) {
    const btn = document.querySelector(`[data-requirements-invite-id="${id}"]`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
    }

    try {
        const { functions, functionsFns } = await initFirebase();
        if (!functionsFns?.httpsCallable || !functions) {
            throw new Error('Firebase Functions is not available');
        }
        const sendFn = functionsFns.httpsCallable(functions, 'sendRequirementsInviteEmails');
        await sendFn({
            registrationId: id,
            includeAlreadySent: true,
            includeCompletedRequirements: true,
        });

        const idx = submissions.findIndex((s) => s.id === id);
        if (idx >= 0) {
            submissions[idx] = {
                ...submissions[idx],
                requirementsInviteEmail: {
                    sent: true,
                    sentAt: new Date(),
                },
            };
        }
        renderSubmissionsList();
        renderCurrentDetail();
    } catch (err) {
        console.error('[MMF Admin] requirements invite email failed', err);
        alert(err?.message || err?.details || 'Failed to send requirements invite email.');
        if (btn) {
            btn.disabled = false;
            const doc = submissions.find((s) => s.id === id);
            btn.textContent = doc?.requirementsInviteEmail?.sent
                ? 'Resend requirements email'
                : 'Send requirements email';
        }
    }
}

async function sendMerchantHubAnnouncementEmails() {
    const btn = $('#adminSendHubEmails');
    const submitted = submissions.filter((doc) => !doc.archived && !isDraft(doc));
    const withEmail = submitted.filter((doc) => String(doc.email || '').trim());
    const balanceCount = withEmail.filter((doc) => {
        if (doc.status === 'verified' && doc.settlementType !== 'downpayment') return false;
        return true;
    }).length;
    const paidCount = withEmail.length - balanceCount;
    const alreadySent = withEmail.filter((doc) => doc.hubAnnouncementEmail?.sent).length;

    const ok = confirm(
        `Send Merchant Hub announcement to all submitted merchants?\n\n` +
            `With email: ${withEmail.length}\n` +
            `· Fully paid template: ${paidCount}\n` +
            `· Balance reminder template: ${balanceCount}\n` +
            `Already sent before: ${alreadySent}\n\n` +
            `OK = send to everyone who has an email (including resends).\n` +
            `Cancel = abort.`
    );
    if (!ok) return;

    const idleLabel = btn?.textContent || 'Send Merchant Hub emails';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
    }

    try {
        const { functions, functionsFns } = await initFirebase();
        if (!functionsFns?.httpsCallable || !functions) {
            throw new Error('Firebase Functions is not available');
        }
        const sendFn = functionsFns.httpsCallable(functions, 'sendMerchantHubAnnouncementEmails');
        const result = await sendFn({ includeAlreadySent: true });
        const data = result?.data || {};
        alert(
            `Merchant Hub emails done.\n\n` +
                `Sent: ${data.sent || 0}\n` +
                `Paid template: ${data.paidTemplate || 0}\n` +
                `Balance template: ${data.balanceTemplate || 0}\n` +
                `Skipped: ${data.skipped || 0}\n` +
                `Failed: ${data.failed || 0}`
        );
        await loadSubmissions();
    } catch (err) {
        console.error('[MMF Admin] hub announcement emails failed', err);
        alert(err?.message || err?.details || 'Failed to send Merchant Hub emails.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = idleLabel;
        }
    }
}

async function archiveSubmission(id, archive) {
    const label = archive ? 'Archive' : 'Restore';
    const btn = document.querySelector(`[data-${archive ? 'archive' : 'restore'}-id="${id}"]`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = archive ? 'Archiving…' : 'Restoring…';
    }

    try {
        const { db, firestoreFns } = await initFirebase();
        const docRef = firestoreFns.doc(db, COLLECTION_NAME, id);
        await firestoreFns.updateDoc(docRef, {
            archived: archive,
            archivedAt: archive ? firestoreFns.serverTimestamp() : null,
            updatedAt: firestoreFns.serverTimestamp(),
        });

        const idx = submissions.findIndex((s) => s.id === id);
        if (idx >= 0) {
            submissions[idx] = {
                ...submissions[idx],
                archived: archive,
                archivedAt: archive ? new Date() : null,
            };
        }

        if (archive && !showArchived) {
            selectedId = null;
            renderCurrentDetail();
        }

        renderSubmissionsList();
        if (selectedId) {
            renderCurrentDetail();
        }
    } catch (err) {
        console.error('[MMF Admin] archive failed', err);
        alert(err?.message || `Failed to ${label.toLowerCase()} submission.`);
        if (btn) {
            btn.disabled = false;
            btn.textContent = label;
        }
    }
}

function fileLooksLikeImage(file) {
    if (!file?.url) return false;
    return guessFileKind(file.url, file.name, file.type || file.contentType || '') === 'image';
}

function requirementNeedsThumbs(doc) {
    const files = doc?.files;
    if (!files || typeof files !== 'object') return false;
    for (const value of Object.values(files)) {
        const list = Array.isArray(value) ? value : value ? [value] : [];
        for (const file of list) {
            if (!fileLooksLikeImage(file) || !file.url) continue;
            if (!file.thumbUrl || !file.thumbPath) return true;
            if (!String(file.thumbPath).includes('/thumbs/v4/')) return true;
        }
    }
    return false;
}

const thumbBackfillInFlight = new Set();

async function refreshRequirementDoc(docId) {
    const { db, firestoreFns } = await initFirebase();
    const snap = await firestoreFns.getDoc(firestoreFns.doc(db, REQUIREMENTS_COLLECTION, docId));
    if (!snap.exists()) return null;
    const next = { id: snap.id, ...snap.data() };
    const idx = requirementsSubmissions.findIndex((doc) => doc.id === docId);
    if (idx >= 0) requirementsSubmissions[idx] = next;
    else requirementsSubmissions.unshift(next);
    return next;
}

async function backfillRequirementThumbs(docs) {
    const needing = (docs || []).filter((doc) => doc?.id && requirementNeedsThumbs(doc));
    if (!needing.length) return;

    const { functions, functionsFns } = await initFirebase();
    const ensureThumbs = functionsFns.httpsCallable(functions, 'ensureRequirementThumbs');
    let refreshed = false;

    for (const doc of needing) {
        if (thumbBackfillInFlight.has(doc.id)) continue;
        thumbBackfillInFlight.add(doc.id);
        try {
            const result = await ensureThumbs({ requirementId: doc.id });
            if (result?.data?.updated) {
                await refreshRequirementDoc(doc.id);
                refreshed = true;
            }
        } catch (err) {
            console.warn('[MMF Admin] thumb backfill failed', doc.id, err);
        } finally {
            thumbBackfillInFlight.delete(doc.id);
        }
    }

    if (refreshed) {
        renderSubmissionsList();
        renderCurrentDetail();
    }
}

function docSortTime(doc) {
    const value = doc.updatedAt || doc.createdAt || doc.submittedAt;
    if (!value) return 0;
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

async function loadSubmissions() {
    const list = $('#adminList');
    if (list) list.innerHTML = '<div class="admin-loading">Loading submissions…</div>';
    $('#adminCount').textContent = 'Loading…';

    try {
        const { db, firestoreFns } = await initFirebase();
        const [subSnap, reqSnap, viewSnap, salesSnap, kolSnap] = await Promise.all([
            firestoreFns.getDocs(firestoreFns.collection(db, COLLECTION_NAME)),
            firestoreFns.getDocs(firestoreFns.collection(db, REQUIREMENTS_COLLECTION)),
            firestoreFns.getDocs(firestoreFns.collection(db, VISITORS_COLLECTION)),
            firestoreFns.getDocs(firestoreFns.collection(db, SALES_COLLECTION)),
            firestoreFns.getDocs(firestoreFns.collection(db, KOL_COLLECTION)),
        ]);
        submissions = subSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => docSortTime(b) - docSortTime(a));
        requirementsSubmissions = reqSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => docSortTime(b) - docSortTime(a));
        uniqueViewCount = viewSnap.size;
        salesReports = salesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        kolReports = kolSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        if (selectedId && !visibleSubmissions().some((s) => s.id === selectedId)) {
            selectedId = null;
        }

        renderSubmissionsList();
        renderCurrentDetail();
        backfillRequirementThumbs(requirementsSubmissions);
    } catch (err) {
        console.error('[MMF Admin] load failed', err);
        if (list) {
            list.innerHTML = `<div class="admin-empty">Failed to load: ${escapeHtml(err?.message || 'Unknown error')}</div>`;
        }
        $('#adminCount').textContent = 'Error loading';
    }
}

function init() {
    try {
        const savedView = sessionStorage.getItem('mmf_admin_view');
        if (savedView === 'table' || savedView === 'split') viewMode = savedView;
    } catch {
        /* ignore */
    }

    if (isAuthed()) {
        showApp(true);
        setViewMode(viewMode);
        loadSubmissions();
    } else {
        showApp(false);
        setViewMode(viewMode);
    }

    $('#adminLogin')?.addEventListener('click', () => {
        const val = ($('#adminPassword')?.value || '').trim();
        const err = $('#adminPassError');
        if (val === ADMIN_PASSWORD) {
            err?.classList.remove('visible');
            setAuthed(true);
            showApp(true);
            loadSubmissions();
        } else {
            err?.classList.add('visible');
        }
    });

    $('#adminPassword')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('#adminLogin')?.click();
    });

    $('#adminLogout')?.addEventListener('click', () => {
        setAuthed(false);
        selectedId = null;
        submissions = [];
        requirementsSubmissions = [];
        salesReports = [];
        kolReports = [];
        showArchived = false;
        detailTab = 'registration';
        filterEntry = 'submitted';
        filterPayment = 'all';
        sortKey = 'updated';
        sortDir = 'desc';
        closeFileModal();
        showApp(false);
        syncFilterControls();
        const pass = $('#adminPassword');
        if (pass) pass.value = '';
    });

    $('#adminRefresh')?.addEventListener('click', () => loadSubmissions());

    $('#adminSendHubEmails')?.addEventListener('click', () => {
        sendMerchantHubAnnouncementEmails().catch(console.error);
    });

    $('#adminDownload')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDownloadMenu();
    });

    $('#adminDownloadMenu')?.addEventListener('click', (e) => {
        const item = e.target.closest('[data-download]');
        if (!item?.dataset.download) return;
        e.stopPropagation();
        closeDownloadMenu();
        if (item.dataset.download === 'payments') {
            exportPaymentReconciliationExcel();
            return;
        }
        downloadRequirementsPdf(item.dataset.download);
    });

    document.addEventListener('click', (e) => {
        if (e.target.closest('.admin-download-wrap')) return;
        closeDownloadMenu();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        closeDownloadMenu();
        const fileModal = $('#adminFileModal');
        if (fileModal && !fileModal.classList.contains('hidden')) return;
        if ($('#adminDetailPanel')?.classList.contains('is-open')) {
            closeDetailModal();
        }
    });

    $('#adminTabRegistration')?.addEventListener('click', () => switchDetailTab('registration'));
    $('#adminTabRequirements')?.addEventListener('click', () => switchDetailTab('requirements'));
    $('#adminTabReports')?.addEventListener('click', () => switchDetailTab('reports'));

    $('#adminViewToggle')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.admin-view-btn');
        if (!btn?.dataset.view) return;
        setViewMode(btn.dataset.view);
    });

    $('#adminToggleArchived')?.addEventListener('click', () => {
        showArchived = !showArchived;
        selectedId = null;
        detailTab = 'registration';
        renderCurrentDetail();
        renderSubmissionsList();
    });

    $('#adminFilterEntry')?.addEventListener('change', applyFiltersFromControls);
    $('#adminFilterPayment')?.addEventListener('change', applyFiltersFromControls);
    $('#adminSortBy')?.addEventListener('change', applyFiltersFromControls);

    $('#adminTable')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.admin-sort-btn');
        if (!btn?.dataset.sort) return;
        e.preventDefault();
        e.stopPropagation();
        setSort(btn.dataset.sort);
    });

    $('#adminFileModalClose')?.addEventListener('click', closeFileModal);
    $('#adminFileModalBackdrop')?.addEventListener('click', closeFileModal);
    $('#adminFileModalDownload')?.addEventListener('click', () => {
        downloadFileFromModal();
    });

    $('#adminDetailClose')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDetailModal();
    });
    $('#adminDetailBackdrop')?.addEventListener('click', () => {
        closeDetailModal();
    });

    window.addEventListener('resize', () => {
        syncDetailModal();
    });
}

init();
