import { COLLECTION_NAME, REQUIREMENTS_COLLECTION } from './config.js';
import { initFirebase } from './firebase.js';

const $ = (sel) => document.querySelector(sel);

let brands = [];
let selectedId = null;
let searchQuery = '';
let fileModalKeyHandler = null;

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isDraft(doc) {
    return doc.submissionState === 'draft';
}

function isSubmitted(doc) {
    return doc.submissionState === 'submitted' || (!doc.submissionState && doc.status);
}

function isRequirementsSubmitted(doc) {
    if (!doc) return false;
    if (doc.submissionState === 'submitted') return true;
    if (doc.submissionState === 'draft') return false;
    if (doc.submissionState) return false;
    const files = doc.files && typeof doc.files === 'object' ? Object.keys(doc.files).length : 0;
    return Boolean(files || (Array.isArray(doc.equipment) && doc.equipment.length) || doc.crewNames);
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

function instagramDisplay(value) {
    const raw = String(value || '').trim();
    if (!raw) return '—';
    const handle = normalizeInstagramHandle(raw);
    const href = /^https?:\/\//i.test(raw) ? raw : `https://instagram.com/${handle}`;
    const label = handle ? `@${handle}` : raw;
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function instagramLabel(value) {
    const handle = normalizeInstagramHandle(value);
    return handle ? `@${handle}` : '';
}

function otherLinksHtml(doc) {
    const links = Array.isArray(doc.otherLinks) && doc.otherLinks.length
        ? doc.otherLinks
        : doc.tiktokOther
          ? [doc.tiktokOther]
          : [];
    if (!links.length) return '—';
    return links
        .map((link) => {
            const href = String(link || '').trim();
            if (!href) return '';
            const safe = /^https?:\/\//i.test(href) ? href : `https://${href}`;
            return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(href)}</a>`;
        })
        .filter(Boolean)
        .join('<br>') || '—';
}

function asFileArray(files) {
    if (!files) return [];
    if (Array.isArray(files)) return files.filter((file) => file?.url);
    return files.url ? [files] : [];
}

function thumbFirstUrl(file) {
    if (!file) return '';
    if (typeof file === 'string') return file;
    return file.thumbUrl || file.url || '';
}

function guessFileKind(url = '', name = '', type = '') {
    const haystack = `${type} ${name} ${url}`.toLowerCase();
    if (haystack.includes('application/pdf') || /\.pdf(?:$|[?#])/i.test(haystack)) return 'pdf';
    if (haystack.includes('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)(?:$|[?#])/i.test(haystack)) return 'image';
    if (haystack.includes('video/') || /\.(mp4|mov|webm|m4v)(?:$|[?#])/i.test(haystack)) return 'video';
    return 'other';
}

const LIST_LOGO_CANDIDATES = [
    ['logoSquareLight', 'light'],
    ['logoSquareDark', 'dark'],
    ['logoWideLight', 'light'],
    ['logoWideDark', 'dark'],
];

function listLogoForBrand(brand) {
    const files = brand?.requirements?.files;
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

function isTransparentThumbPreferred(file) {
    const hay = `${file?.type || ''} ${file?.name || ''} ${file?.path || ''} ${file?.url || ''}`.toLowerCase();
    return /image\/png|\.png(?:$|[?#])|image\/webp|\.webp(?:$|[?#])/.test(hay);
}

function fileLink(file) {
    if (!file?.url) return '—';
    const label = file.name || 'Open file';
    const kind = guessFileKind(file.url, file.name, file.type || file.contentType || '');
    return `<button type="button" class="pr-file-link" data-file-url="${escapeHtml(file.url)}" data-file-name="${escapeHtml(label)}" data-file-kind="${escapeHtml(kind)}">${escapeHtml(label)}</button>`;
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
        return `<div class="pr-photo-file">${fileLink(file)}</div>`;
    }
    const resolvedBg = file.thumbBg === 'dark' || bg === 'dark' ? 'dark' : 'light';
    const src = useOriginal || isTransparentThumbPreferred(file) ? file.url : file.thumbUrl || file.url;
    if (!src) {
        return `<button type="button" class="pr-photo-tile bg-${resolvedBg}" data-file-url="${escapeHtml(file.url)}" data-file-name="${escapeHtml(label)}" data-file-kind="image" title="${escapeHtml(label)}"></button>`;
    }
    return `
        <button type="button" class="pr-photo-tile bg-${resolvedBg}" data-file-url="${escapeHtml(file.url)}" data-file-name="${escapeHtml(label)}" data-file-kind="image" title="${escapeHtml(label)}">
            <img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy" decoding="async" onerror="this.closest('.pr-photo-tile')?.remove()">
        </button>
    `;
}

function filePreviews(files, { wide = false, bg = 'light', useOriginal = false } = {}) {
    const list = asFileArray(files);
    if (!list.length) return '—';
    const tiles = list.map((file) => filePreviewTile(file, { bg, useOriginal })).join('');
    if (list.length === 1) {
        const soloClass = wide ? 'pr-photo-solo is-wide' : 'pr-photo-solo';
        return `<div class="${soloClass}">${tiles}</div>`;
    }
    return `<div class="pr-photo-grid">${tiles}</div>`;
}

function detailItem(label, value) {
    const display = value === null || value === undefined || value === '' ? '—' : value;
    return `<div class="detail-item"><dt>${escapeHtml(label)}</dt><dd>${display}</dd></div>`;
}

function section(title, body) {
    if (!body) return '';
    return `<section class="pr-section"><h3>${escapeHtml(title)}</h3>${body}</section>`;
}

function visibleBrands() {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => {
        const hay = [
            b.brandName,
            b.contactPerson,
            b.email,
            instagramLabel(b.instagram),
        ]
            .join(' ')
            .toLowerCase();
        return hay.includes(q);
    });
}

function isMobileDetailMode() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 899px)').matches;
}

function syncDetailModal() {
    const panel = $('#prDetailPanel');
    const backdrop = $('#prDetailBackdrop');
    if (!panel) return;
    const open = Boolean(selectedId) && isMobileDetailMode();
    panel.classList.toggle('is-open', open);
    backdrop?.classList.toggle('is-open', open);
    if (backdrop) {
        if (open) backdrop.removeAttribute('hidden');
        else backdrop.setAttribute('hidden', '');
    }
    panel.setAttribute('aria-modal', open ? 'true' : 'false');
    const fileModal = $('#prFileModal');
    const fileOpen = Boolean(fileModal && !fileModal.classList.contains('hidden'));
    document.body.style.overflow = open || fileOpen ? 'hidden' : '';
}

function closeDetailModal() {
    selectedId = null;
    renderList();
    renderDetail(null);
    syncDetailModal();
}

function openFileModal({ url, name, kind }) {
    const modal = $('#prFileModal');
    const body = $('#prFileModalBody');
    const title = $('#prFileModalTitle');
    if (!modal || !body || !title || !url) return;

    const resolvedKind = kind || guessFileKind(url, name);
    title.textContent = name || 'Preview';

    if (resolvedKind === 'image') {
        body.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(name || '')}">`;
    } else if (resolvedKind === 'video') {
        body.innerHTML = `<video src="${escapeHtml(url)}" controls playsinline preload="metadata"></video>`;
    } else if (resolvedKind === 'pdf') {
        body.innerHTML = `<iframe src="${escapeHtml(url)}#toolbar=1" title="${escapeHtml(name || 'PDF')}" style="width:100%;height:min(78vh,48rem);border:0;background:#fff;"></iframe>`;
    } else {
        body.innerHTML = `
            <div class="pr-file-modal-fallback">
                <p>Preview is not available for this file type.</p>
                <p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open in a new tab</a></p>
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
}

function closeFileModal() {
    const modal = $('#prFileModal');
    const body = $('#prFileModalBody');
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
            });
        });
    });
}

function selectBrand(id) {
    selectedId = id;
    renderList();
    const brand = brands.find((b) => b.id === id) || null;
    renderDetail(brand);
    syncDetailModal();
}

function renderList() {
    const list = $('#prList');
    if (!list) return;

    const rows = visibleBrands();

    if (!rows.length) {
        list.innerHTML = `<div class="pr-empty">${brands.length ? 'No brands match this search.' : 'No brands yet.'}</div>`;
        return;
    }

    list.innerHTML = rows
        .map((doc, index) => {
            const selected = doc.id === selectedId ? ' selected' : '';
            const logo = listLogoForBrand(doc);
            const thumb = logo
                ? `<img class="pr-row-thumb bg-${logo.bg}" src="${escapeHtml(logo.url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
                : `<div class="pr-row-thumb" aria-hidden="true"></div>`;
            const ig = instagramLabel(doc.instagram);
            return `
            <div class="pr-row${selected}" data-id="${escapeHtml(doc.id)}" role="button" tabindex="0">
                <span class="pr-row-num" aria-hidden="true">${index + 1}</span>
                ${thumb}
                <div class="pr-row-main">
                    <p class="pr-row-brand">${escapeHtml(doc.brandName || 'Untitled brand')}</p>
                    ${ig ? `<div class="pr-row-ig">${escapeHtml(ig)}</div>` : ''}
                    <div class="pr-row-meta">${escapeHtml(doc.contactPerson || '')}${doc.contactPerson && doc.email ? ' · ' : ''}${escapeHtml(doc.email || '')}</div>
                </div>
            </div>`;
        })
        .join('');

    list.querySelectorAll('.pr-row').forEach((row) => {
        const open = () => selectBrand(row.dataset.id);
        row.addEventListener('click', open);
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
    });
}

function renderDetail(doc) {
    const panel = $('#prDetail');
    const title = $('#prDetailTitle');
    if (!panel) return;

    if (!doc) {
        panel.className = 'pr-detail empty';
        panel.textContent = 'Select a brand to view PR details.';
        if (title) title.textContent = 'Detail';
        return;
    }

    if (title) title.textContent = doc.brandName || 'Detail';
    const files = doc.requirements?.files || {};
    const videoLinks = Array.isArray(doc.requirements?.brandVideoLinks)
        ? doc.requirements.brandVideoLinks
        : String(doc.requirements?.brandVideoLinks || '')
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

    const infoHtml = `
        <div class="detail-grid">
            ${detailItem('Brand', escapeHtml(doc.brandName))}
            ${detailItem('Contact', escapeHtml(doc.contactPerson))}
            ${detailItem('Role', escapeHtml(doc.role))}
            ${detailItem('Phone', escapeHtml(doc.contactNumber))}
            ${detailItem('Email', escapeHtml(doc.email))}
            ${detailItem('Instagram', instagramDisplay(doc.instagram))}
            ${detailItem('Other links', otherLinksHtml(doc))}
            ${detailItem('Brand description', escapeHtml(doc.brandDescription))}
        </div>`;

    const logosHtml = `
        <div class="detail-grid">
            ${detailItem('Square logo — dark bg', filePreviews(files.logoSquareDark, { bg: 'dark', useOriginal: true }))}
            ${detailItem('Square logo — light bg', filePreviews(files.logoSquareLight, { bg: 'light', useOriginal: true }))}
            ${detailItem('Wide logo — dark bg', filePreviews(files.logoWideDark, { wide: true, bg: 'dark', useOriginal: true }))}
            ${detailItem('Wide logo — light bg', filePreviews(files.logoWideLight, { wide: true, bg: 'light', useOriginal: true }))}
        </div>`;

    const menuHtml = filePreviews(files.menuPhotos || (files.menuFile ? [files.menuFile] : []), { bg: 'light' });
    const productHtml = filePreviews(files.productPhotos, { bg: 'light' });

    const hasVideoLinks = videoLinks.length > 0;
    const hasVideoFiles = asFileArray(files.brandVideos).length > 0;
    let videosHtml;
    if (hasVideoLinks && hasVideoFiles) {
        videosHtml = `
            <div class="detail-grid">
                ${detailItem('Links', videoLinksHtml)}
                ${detailItem('Files', fileLinks(files.brandVideos))}
            </div>`;
    } else if (hasVideoLinks) {
        videosHtml = `<div class="pr-section-body">${videoLinksHtml}</div>`;
    } else if (hasVideoFiles) {
        videosHtml = `<div class="pr-section-body">${fileLinks(files.brandVideos)}</div>`;
    } else {
        videosHtml = `<div class="pr-section-body">—</div>`;
    }

    const hero = String(doc.requirements?.heroDrink || '').trim();
    const promo = String(doc.requirements?.exclusivePromo || '').trim();

    panel.className = 'pr-detail';
    panel.innerHTML = [
        section('Brand info', infoHtml),
        section('Logos', logosHtml),
        section('Menu', `<div class="pr-section-body">${menuHtml}</div>`),
        section('Product photos', `<div class="pr-section-body">${productHtml}</div>`),
        section('Brand videos', videosHtml),
        section(
            'Exclusive hero drink',
            `<div class="pr-section-body">${hero ? escapeHtml(hero).replace(/\n/g, '<br>') : '—'}</div>`
        ),
        section(
            'Exclusive promotion',
            `<div class="pr-section-body">${promo ? escapeHtml(promo).replace(/\n/g, '<br>') : '—'}</div>`
        ),
    ].join('');

    bindFilePreviewTriggers(panel);
}

function pickBestRequirements(matches) {
    return (
        matches.find((doc) => doc.submissionState === 'submitted') ||
        matches.find((doc) => !doc.submissionState && isRequirementsSubmitted(doc)) ||
        matches.find((doc) => doc.submissionState === 'draft') ||
        null
    );
}

async function loadBrands() {
    const list = $('#prList');
    if (list) list.innerHTML = '<div class="pr-loading">Loading brands…</div>';

    try {
        const { db, firestoreFns } = await initFirebase();
        const [subSnap, reqSnap] = await Promise.all([
            firestoreFns.getDocs(firestoreFns.collection(db, COLLECTION_NAME)),
            firestoreFns.getDocs(firestoreFns.collection(db, REQUIREMENTS_COLLECTION)),
        ]);

        const requirements = reqSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const byRegistration = new Map();
        for (const req of requirements) {
            if (req.archived || !req.registrationId) continue;
            const bucket = byRegistration.get(req.registrationId) || [];
            bucket.push(req);
            byRegistration.set(req.registrationId, bucket);
        }

        brands = subSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((doc) => !doc.archived && isSubmitted(doc) && !isDraft(doc))
            .map((doc) => ({
                ...doc,
                requirements: pickBestRequirements(byRegistration.get(doc.id) || []),
            }))
            .sort((a, b) =>
                String(a.brandName || '').localeCompare(String(b.brandName || ''), undefined, {
                    sensitivity: 'base',
                })
            );

        if (selectedId && !brands.some((b) => b.id === selectedId)) {
            selectedId = null;
        }

        renderList();
        renderDetail(brands.find((b) => b.id === selectedId) || null);
        syncDetailModal();
    } catch (err) {
        console.error('[MMF PR] load failed', err);
        if (list) {
            list.innerHTML = `<div class="pr-empty">Failed to load: ${escapeHtml(err?.message || 'Unknown error')}</div>`;
        }
    }
}

const INTRO_FULL =
    "Returning to the SM Mall of Asia Main Atrium for its biggest edition yet, Manila Matcha Fest runs from August 7 to 16, 2026 — ten days bringing together 24 of the country's most talked-about matcha bars and pop-ups under one roof. The event debuted in 2025 as the first-ever matcha event of its kind in the Philippines, and comes back in 2026 as the largest celebration of matcha culture in the country. This year's edition gathers an intentionally curated lineup of matcha brands in a single destination built to champion a collaborative, growing matcha community.";

const INTRO_MOBILE_LINES = 2;

let introExpanded = false;

function isMobileIntroMode() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 899px)').matches;
}

function measureIntroLines(el) {
    const styles = window.getComputedStyle(el);
    const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.55;
    if (!lineHeight) return 1;
    return Math.round(el.scrollHeight / lineHeight);
}

function truncateIntroToLines(el, fullText, maxLines) {
    // Binary-search a prefix that fits in maxLines with an inline "… See more" suffix.
    const suffix = '… ';
    let lo = 0;
    let hi = fullText.length;
    let best = '';

    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        let slice = fullText.slice(0, mid).trimEnd();
        // Prefer breaking near a word boundary.
        if (mid < fullText.length) {
            const sp = slice.lastIndexOf(' ');
            if (sp > Math.floor(mid * 0.6)) slice = slice.slice(0, sp);
        }
        el.textContent = '';
        el.append(document.createTextNode(`${slice}${suffix}`));
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pr-intro-toggle';
        btn.textContent = 'See more';
        el.append(btn);

        if (measureIntroLines(el) <= maxLines) {
            best = slice;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return best;
}

function syncIntro() {
    const el = $('#prIntro');
    if (!el) return;

    const mobile = isMobileIntroMode();

    // Measure whether collapsing is needed.
    el.textContent = INTRO_FULL;
    const needsCollapse = mobile && measureIntroLines(el) > INTRO_MOBILE_LINES;

    el.textContent = '';

    if (!needsCollapse || introExpanded) {
        el.append(document.createTextNode(INTRO_FULL));
        if (needsCollapse) {
            el.append(document.createTextNode(' '));
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pr-intro-toggle';
            btn.textContent = 'See less';
            btn.setAttribute('aria-expanded', 'true');
            btn.addEventListener('click', () => {
                introExpanded = false;
                syncIntro();
            });
            el.append(btn);
        }
        return;
    }

    const truncated = truncateIntroToLines(el, INTRO_FULL, INTRO_MOBILE_LINES);
    el.textContent = '';
    el.append(document.createTextNode(`${truncated}… `));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pr-intro-toggle';
    btn.textContent = 'See more';
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => {
        introExpanded = true;
        syncIntro();
    });
    el.append(btn);
}

function init() {
    syncIntro();
    loadBrands();

    $('#prSearch')?.addEventListener('input', (e) => {
        searchQuery = e.target.value || '';
        renderList();
    });

    $('#prDetailClose')?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDetailModal();
    });
    $('#prDetailBackdrop')?.addEventListener('click', () => closeDetailModal());

    $('#prFileModalClose')?.addEventListener('click', closeFileModal);
    $('#prFileModalBackdrop')?.addEventListener('click', closeFileModal);

    window.addEventListener('resize', () => {
        if (!isMobileIntroMode()) introExpanded = false;
        syncIntro();
        syncDetailModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const fileModal = $('#prFileModal');
        if (fileModal && !fileModal.classList.contains('hidden')) return;
        if ($('#prDetailPanel')?.classList.contains('is-open')) closeDetailModal();
    });
}

init();
