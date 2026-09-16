import {
    db,
    collection,
    addDoc,
    updateDoc,
    setDoc,
    getDoc,
    doc,
    getDocs,
    query,
    orderBy,
    deleteDoc,
    serverTimestamp,
    DRINKS_COLLECTION,
    MENUS_COLLECTION,
    storage,
    storageRef,
    uploadBytes,
    getDownloadURL
} from './firebase-setup.js';

(function () {
    'use strict';

    const CM_TO_PX = 37.7952755906; // 1 cm ≈ 37.8 px at 96 dpi
    const STORAGE_KEY = 'menu-creator-state';
    const CATEGORY_STORAGE_KEY = 'menu-creator-categories';
    const DRINK_DEDUP_RESOLVED_KEY = 'menu-creator-drink-dedup-resolved-v1';
    const VIEW_ROTATION_SESSION_KEY = 'menu-creator-preview-rotation-deg';
    const MENU_PAYLOAD_VERSION = 2;
    const VIEWER_MODE = new URLSearchParams(window.location.search).get('mode') === 'viewer';

    function getDefaultState() {
        return {
            orientation: 'portrait',
            unit: 'px',
            margin: 12,
            width: 1080,
            height: 1920,
            columnCount: 2,
            columnWidths: [50, 50],
            columnWidthLocks: [false, false],
            columnRows: [{ rowCount: 2, rowHeights: [50, 50] }, { rowCount: 2, rowHeights: [50, 50] }],
            columnRowUnits: [['%', '%'], ['%', '%']],
            columnRowLocks: [[false, false], [false, false]],
            tileTemplate: [['white', 'white'], ['white', 'white']],
            tileTemplateProps: [[{ line1: '', line2: '' }, { line1: '', line2: '' }], [{ line1: '', line2: '' }, { line1: '', line2: '' }]],
            gap: 24,
            layoutMode: 'grid',
            overlay: getDefaultOverlayState()
        };
    }

    function getDefaultOverlayState() {
        return {
            imageUrl: '',
            imageNaturalWidth: 0,
            imageNaturalHeight: 0,
            selectedId: '',
            modules: []
        };
    }

    const state = getDefaultState();
    const photoUploading = {};
    let photoGalleryIntervals = [];
    let liveSessionPollers = [];
    const OVERLAY_MIN_PX = 64;
    const OVERLAY_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    let overlayInteract = null;
    let overlayImageUploading = false;
    let overlayStageLayout = { left: 0, top: 0, width: 0, height: 0 };

    function getGalleryProps(props) {
        const p = props || {};
        let urls = Array.isArray(p.imageUrls) ? p.imageUrls : [];
        if (urls.length === 0 && p.imageUrl) urls = [p.imageUrl];
        const mediaItems = Array.isArray(p.mediaItems) && p.mediaItems.length > 0
            ? p.mediaItems.map((item) => ({
                type: item && item.type === 'video' ? 'video' : 'image',
                url: item && item.url ? String(item.url) : ''
            })).filter((item) => item.url)
            : urls.filter(Boolean).map((url) => ({ type: 'image', url }));
        const interval = typeof p.galleryIntervalSeconds === 'number' ? p.galleryIntervalSeconds : 3;
        return {
            mediaItems,
            imageUrls: mediaItems.filter((item) => item.type === 'image').map((item) => item.url),
            galleryIntervalSeconds: interval
        };
    }

    function getPhotoTakeoverDisplaySrc(eventKey, styleMod) {
        const resolvedEventKey = (eventKey || '').trim() || localStorage.getItem('currentEvent') || 'pop-up';
        const params = new URLSearchParams();
        params.set('event', resolvedEventKey);
        params.set('embedded', '1');
        params.set('hideSettings', '1');
        if (styleMod) {
            params.set('radius', String(getOverlayBorderRadius(styleMod)));
            params.set('scale', String(getOverlayContentScale(styleMod)));
        }
        params.set('v', 'greeting-fix-2');
        return {
            src: '../pos/customer-display.html?' + params.toString(),
            eventKey: resolvedEventKey
        };
    }

    function buildPhotoModuleHtml(props, opts) {
        const { mediaItems, galleryIntervalSeconds } = getGalleryProps(props);
        const useAsCustomerDisplay = Boolean(props && props.useAsCustomerDisplay);
        const eventKey = ((props && props.customerDisplayEventKey) || '').trim();
        if (mediaItems.length === 0 && !useAsCustomerDisplay) {
            return '<div class="tile-photo-wrap tile-photo-empty"><span class="tile-placeholder">Upload a photo or video</span></div>';
        }
        const interval = Math.max(1, galleryIntervalSeconds);
        const mediaHtml = mediaItems.map((item, i) => {
            if (item.type === 'video') {
                return '<video src="' + escapeHtml(item.url) + '" class="tile-photo-item tile-photo-video' + (i === 0 ? ' tile-photo-visible' : '') + '" data-index="' + i + '" muted playsinline preload="metadata" loop></video>';
            }
            return '<img src="' + escapeHtml(item.url) + '" alt="" class="tile-photo-item tile-photo-img' + (i === 0 ? ' tile-photo-visible' : '') + '" data-index="' + i + '">';
        }).join('');
        const galleryHtml = mediaItems.length > 0
            ? '<div class="tile-photo-wrap tile-photo-gallery" data-interval="' + interval + '">' + mediaHtml + '</div>'
            : '<div class="tile-photo-wrap tile-photo-empty"><span class="tile-placeholder">No gallery media</span></div>';
        if (!useAsCustomerDisplay) return galleryHtml;
        const display = getPhotoTakeoverDisplaySrc(eventKey, opts && opts.overlayMod);
        return '<div class="tile-photo-display-switch" data-event="' + escapeHtml(display.eventKey) + '"><div class="tile-photo-layer tile-photo-layer-gallery">' + galleryHtml + '</div><div class="tile-photo-layer tile-photo-layer-display" hidden><iframe class="tile-customer-display-iframe" src="' + escapeHtml(display.src) + '" loading="lazy" referrerpolicy="no-referrer"></iframe></div></div>';
    }

    function clearPhotoRuntimes() {
        photoGalleryIntervals.forEach((cleanup) => {
            try { cleanup(); } catch (_) { /* ignore */ }
        });
        photoGalleryIntervals = [];
        liveSessionPollers.forEach((cleanup) => {
            try { cleanup(); } catch (_) { /* ignore */ }
        });
        liveSessionPollers = [];
    }

    function bindPhotoGalleries(root) {
        if (!root) return;
        root.querySelectorAll('.tile-photo-gallery').forEach((el) => {
            const intervalSec = Number(el.dataset.interval) || 3;
            const items = Array.from(el.querySelectorAll('.tile-photo-item'));
            if (items.length === 0) return;

            let idx = 0;
            let timeoutId = null;

            const getItemDurationMs = (item) => {
                if (item && item.tagName === 'VIDEO') {
                    const d = Number(item.duration);
                    if (Number.isFinite(d) && d > 0) return d * 1000;
                }
                return Math.max(1, intervalSec) * 1000;
            };

            const setVisible = (index) => {
                idx = index;
                items.forEach((item, i) => {
                    const isVisible = i === index;
                    item.classList.toggle('tile-photo-visible', isVisible);
                    if (item.tagName === 'VIDEO') {
                        if (isVisible) {
                            item.currentTime = 0;
                            item.play().catch(() => { /* ignore autoplay restrictions */ });
                        } else {
                            item.pause();
                        }
                    }
                });
            };

            const scheduleNext = () => {
                if (items.length <= 1) return;
                if (timeoutId) clearTimeout(timeoutId);
                const current = items[idx];
                const delay = getItemDurationMs(current);
                timeoutId = setTimeout(() => {
                    setVisible((idx + 1) % items.length);
                    scheduleNext();
                }, delay);
            };

            items.forEach((item) => {
                if (item.tagName === 'VIDEO') {
                    item.addEventListener('loadedmetadata', () => {
                        if (item.classList.contains('tile-photo-visible')) scheduleNext();
                    });
                }
            });

            setVisible(0);
            scheduleNext();
            photoGalleryIntervals.push(() => {
                if (timeoutId) clearTimeout(timeoutId);
                items.forEach((item) => {
                    if (item.tagName === 'VIDEO') item.pause();
                });
            });
        });
    }

    function bindPhotoDisplaySwitches(root) {
        if (!root) return;
        root.querySelectorAll('.tile-photo-display-switch').forEach((switchRoot) => {
            const galleryLayer = switchRoot.querySelector('.tile-photo-layer-gallery');
            const displayLayer = switchRoot.querySelector('.tile-photo-layer-display');
            if (!galleryLayer || !displayLayer) return;
            const eventForPolling = (switchRoot.getAttribute('data-event') || '').trim() || localStorage.getItem('currentEvent') || 'pop-up';
            let lastState = null;
            const setActive = (showDisplay) => {
                if (lastState === showDisplay) return;
                lastState = showDisplay;
                galleryLayer.hidden = showDisplay;
                displayLayer.hidden = !showDisplay;
            };
            const poll = async () => {
                try {
                    const snap = await getDoc(doc(db, 'pos-live', eventForPolling, 'session', 'current'));
                    const active = snap.exists() ? hasActiveLiveOrder(snap.data()) : false;
                    setActive(active);
                } catch (err) {
                    console.error('Live session poll failed:', err);
                }
            };
            poll();
            const pollId = setInterval(poll, 1500);
            liveSessionPollers.push(() => clearInterval(pollId));
        });
    }

    function bindPhotoRuntimes(root) {
        bindPhotoGalleries(root);
        bindPhotoDisplaySwitches(root);
    }

    function appendPhotoGalleryEditor(container, options) {
        const uploadKey = options.uploadKey;
        const persistCanvas = () => {
            saveState();
            if (typeof options.onCanvasChanged === 'function') options.onCanvasChanged();
        };
        const refreshControls = () => {
            if (typeof options.onControlsChanged === 'function') options.onControlsChanged();
        };
        function getTarget() {
            return typeof options.getProps === 'function' ? options.getProps() : null;
        }
        function ensurePhotoProps() {
            const p = getTarget();
            if (!p) return { mediaItems: [], imageUrls: [], galleryIntervalSeconds: 3 };
            const g = getGalleryProps(p);
            if (!Array.isArray(p.mediaItems)) p.mediaItems = g.mediaItems.slice();
            p.imageUrls = (p.mediaItems || []).filter((item) => item && item.type !== 'video' && item.url).map((item) => item.url);
            if (typeof p.galleryIntervalSeconds !== 'number') p.galleryIntervalSeconds = g.galleryIntervalSeconds;
            return p;
        }

        const photoProps = ensurePhotoProps();
        const { mediaItems, imageUrls, galleryIntervalSeconds } = getGalleryProps(photoProps);
        if (!Array.isArray(photoProps.mediaItems) || typeof photoProps.galleryIntervalSeconds !== 'number') {
            photoProps.mediaItems = mediaItems.slice();
            photoProps.imageUrls = imageUrls.slice();
            photoProps.galleryIntervalSeconds = galleryIntervalSeconds;
        }

        const intervalLabel = document.createElement('label');
        intervalLabel.textContent = 'Gallery interval (seconds)';
        const intervalInput = document.createElement('input');
        intervalInput.type = 'number';
        intervalInput.min = 1;
        intervalInput.max = 60;
        intervalInput.step = 1;
        intervalInput.className = 'tile-photo-interval';
        intervalInput.value = String(galleryIntervalSeconds);
        intervalInput.addEventListener('change', () => {
            const target = ensurePhotoProps();
            target.galleryIntervalSeconds = Math.max(1, Math.min(60, Number(intervalInput.value) || 3));
            persistCanvas();
        });
        container.appendChild(intervalLabel);
        container.appendChild(intervalInput);

        const thumbsWrap = document.createElement('div');
        thumbsWrap.className = 'tile-photo-thumbs-wrap';

        function renderThumbs() {
            thumbsWrap.innerHTML = '';
            const target = ensurePhotoProps();
            const items = target.mediaItems || [];
            items.forEach((item, index) => {
                const cell = document.createElement('div');
                cell.className = 'tile-photo-thumb-cell';
                if (item.type === 'video') {
                    const video = document.createElement('video');
                    video.src = item.url;
                    video.muted = true;
                    video.playsInline = true;
                    video.preload = 'metadata';
                    video.className = 'tile-photo-thumb-video';
                    cell.appendChild(video);
                    const badge = document.createElement('span');
                    badge.className = 'tile-photo-thumb-badge';
                    badge.textContent = 'Video';
                    cell.appendChild(badge);
                } else {
                    const img = document.createElement('img');
                    img.src = item.url;
                    img.alt = '';
                    img.className = 'tile-photo-thumb-img';
                    cell.appendChild(img);
                }
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'tile-photo-thumb-remove';
                removeBtn.setAttribute('aria-label', 'Remove media');
                removeBtn.textContent = '×';
                removeBtn.addEventListener('click', () => {
                    const t = ensurePhotoProps();
                    if (!Array.isArray(t.mediaItems)) return;
                    t.mediaItems.splice(index, 1);
                    persistCanvas();
                    renderThumbs();
                });
                cell.appendChild(removeBtn);
                thumbsWrap.appendChild(cell);
            });
            const addCell = document.createElement('button');
            addCell.type = 'button';
            addCell.className = 'tile-photo-thumb-add';
            addCell.setAttribute('aria-label', 'Add photo(s) or video(s)');
            addCell.textContent = '+';
            addCell.addEventListener('click', () => photoInput.click());
            thumbsWrap.appendChild(addCell);
        }

        const photoInput = document.createElement('input');
        photoInput.type = 'file';
        photoInput.accept = 'image/*,video/*';
        photoInput.multiple = true;
        photoInput.className = 'tile-photo-upload';
        photoInput.style.display = 'none';
        photoInput.addEventListener('change', async () => {
            const files = photoInput.files ? Array.from(photoInput.files) : [];
            photoInput.value = '';
            if (files.length === 0) return;
            const target = ensurePhotoProps();
            if (!Array.isArray(target.mediaItems)) target.mediaItems = [];
            photoUploading[uploadKey] = true;
            refreshControls();
            for (const file of files) {
                try {
                    const mediaType = file.type && file.type.startsWith('video/') ? 'video' : 'image';
                    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
                    const path = (options.uploadPathPrefix || 'menu-creator-photos/media') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
                    const ref = storageRef(storage, path);
                    await uploadBytes(ref, file);
                    const url = await getDownloadURL(ref);
                    target.mediaItems.push({ type: mediaType, url });
                } catch (err) {
                    console.error('Media upload failed:', err);
                    const url = await new Promise((res) => {
                        const reader = new FileReader();
                        reader.onload = () => res(reader.result);
                        reader.readAsDataURL(file);
                    });
                    const mediaType = file.type && file.type.startsWith('video/') ? 'video' : 'image';
                    target.mediaItems.push({ type: mediaType, url });
                }
            }
            persistCanvas();
            photoUploading[uploadKey] = false;
            refreshControls();
        });

        renderThumbs();
        if (photoUploading[uploadKey]) {
            const uploadingLabel = document.createElement('span');
            uploadingLabel.className = 'tile-photo-preview-label';
            uploadingLabel.textContent = 'Uploading…';
            uploadingLabel.style.display = 'block';
            uploadingLabel.style.marginBottom = '0.25rem';
            container.appendChild(uploadingLabel);
        }
        container.appendChild(thumbsWrap);
        container.appendChild(photoInput);

        const takeoverWrap = document.createElement('label');
        takeoverWrap.className = 'menu-save-new-toggle';
        const takeoverInput = document.createElement('input');
        takeoverInput.type = 'checkbox';
        takeoverInput.checked = Boolean(photoProps.useAsCustomerDisplay);
        const takeoverText = document.createElement('span');
        takeoverText.textContent = 'Use customer display when active order exists';
        takeoverInput.addEventListener('change', () => {
            const target = ensurePhotoProps();
            target.useAsCustomerDisplay = takeoverInput.checked;
            persistCanvas();
            refreshControls();
        });
        takeoverWrap.appendChild(takeoverInput);
        takeoverWrap.appendChild(takeoverText);
        container.appendChild(takeoverWrap);

        if (takeoverInput.checked) {
            const eventLabel = document.createElement('label');
            eventLabel.textContent = 'POS event';
            const eventSelect = document.createElement('select');
            const selectedEvent = (photoProps.customerDisplayEventKey || '').trim();
            eventSelect.innerHTML = buildPosEventDropdownHtml(selectedEvent);
            eventSelect.value = selectedEvent;
            if (!activeEventKeysLoaded) ensureActiveEventKeysLoaded();
            eventSelect.addEventListener('change', () => {
                const target = ensurePhotoProps();
                target.customerDisplayEventKey = eventSelect.value.trim();
                persistCanvas();
            });
            const refreshBtn = document.createElement('button');
            refreshBtn.type = 'button';
            refreshBtn.className = 'btn btn-secondary';
            refreshBtn.textContent = 'Refresh';
            refreshBtn.title = 'Reload POS event list from Firebase';
            refreshBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                activeEventKeysLoaded = false;
                loadActiveEventKeys({ force: true }).then(() => refreshControls());
            });
            const eventRow = document.createElement('div');
            eventRow.style.display = 'flex';
            eventRow.style.gap = '0.5rem';
            eventRow.style.alignItems = 'center';
            eventRow.style.flexWrap = 'wrap';
            eventSelect.style.flex = '1';
            eventSelect.style.minWidth = '8rem';
            eventRow.appendChild(eventSelect);
            eventRow.appendChild(refreshBtn);
            const eventHint = document.createElement('span');
            eventHint.className = 'form-hint';
            const hintExtra = posEventDropdownHint();
            eventHint.textContent = hintExtra
                ? hintExtra
                : 'Idle shows gallery; active order shows customer display.';
            container.appendChild(eventLabel);
            container.appendChild(eventRow);
            container.appendChild(eventHint);
        }
    }

    function hasActiveLiveOrder(liveData) {
        if (!liveData || typeof liveData !== 'object') return false;
        const items = Array.isArray(liveData.items)
            ? liveData.items
            : (liveData.items && typeof liveData.items === 'object' ? Object.values(liveData.items) : []);
        const status = (liveData.status || '').toString().toLowerCase();
        const total = Number(liveData.total);
        const hasItems = items.length > 0;
        const hasPositiveTotal = Number.isFinite(total) && total > 0;
        const hasName = Boolean((liveData.customerName || '').toString().trim());
        const activeStatuses = new Set(['editing', 'reviewing', 'payment', 'checkout', 'pending', 'serving', 'open']);
        if (activeStatuses.has(status)) return true;
        if (hasName) return true;
        if (status === 'idle' || status === 'closed' || status === 'completed' || status === 'voided') {
            return false;
        }
        return hasItems || hasPositiveTotal;
    }

    const $ = (id) => document.getElementById(id);
    const orientationEl = $('orientation');
    const unitEl = $('unit');
    const marginEl = $('margin');
    const canvasWidthEl = $('canvasWidth');
    const canvasHeightEl = $('canvasHeight');
    const canvasHintEl = $('canvasHint');
    const columnCountEl = $('columnCount');
    const columnWidthsContainer = $('columnWidthsContainer');
    const columnRowsContainer = $('columnRowsContainer');
    const tileGapEl = $('tileGap');
    const menuCanvasEl = $('menuCanvas');
    const tileGridEl = $('tileGrid');
    const overlayStageEl = $('overlayStage');
    const overlayEmptyStateEl = $('overlayEmptyState');
    const overlayBgImageEl = $('overlayBgImage');
    const overlayModulesEl = $('overlayModules');
    const overlayBgPickBtnEl = $('overlayBgPickBtn');
    const overlayBgRemoveBtnEl = $('overlayBgRemoveBtn');
    const overlayBgInputEl = $('overlayBgInput');
    const overlayBgThumbEl = $('overlayBgThumb');
    const overlayBgEmptyHintEl = $('overlayBgEmptyHint');
    const overlayBgStatusEl = $('overlayBgStatus');
    const overlayModuleTypeEl = $('overlayModuleType');
    const addOverlayModuleBtnEl = $('addOverlayModuleBtn');
    const overlayModuleListEl = $('overlayModuleList');
    const overlaySelectedPropsEl = $('overlaySelectedProps');
    const previewWrapEl = $('previewWrap');
    const canvasScalerEl = $('canvasScaler');
    const canvasFitWrapperEl = $('canvasFitWrapper');
    const layoutPanelEl = $('layoutPanel');
    const drinksPanelEl = $('drinksPanel');
    const drinksListEl = $('drinksList');
    const drinksListHintEl = $('drinksListHint');
    const addDrinkBtnEl = $('addDrinkBtn');
    const manageCategoriesBtnEl = $('manageCategoriesBtn');
    const drinkModalBackdropEl = $('drinkModalBackdrop');
    const drinkModalTitleEl = $('drinkModalTitle');
    const drinkNameEl = $('drinkName');
    const drinkDescEl = $('drinkDesc');
    const drinkPriceEl = $('drinkPrice');
    const drinkCategoryEl = $('drinkCategory');
    const drinkEditIdEl = $('drinkEditId');
    const saveDrinkBtnEl = $('saveDrinkBtn');
    const cancelDrinkBtnEl = $('cancelDrinkBtn');
    const categoryModalBackdropEl = $('categoryModalBackdrop');
    const newCategoryNameEl = $('newCategoryName');
    const addCategoryBtnEl = $('addCategoryBtn');
    const closeCategoryBtnEl = $('closeCategoryBtn');
    const categoryListEl = $('categoryList');
    const categoryStatusEl = $('categoryStatus');
    const exportPhotoBtnEl = $('exportPhotoBtn');
    const fullscreenPreviewBtnEl = $('fullscreenPreviewBtn');
    const menuSaveModalBackdropEl = $('menuSaveModalBackdrop');
    const menuSaveNameEl = $('menuSaveName');
    const menuSaveSearchInputEl = $('menuSaveSearchInput');
    const menuSaveListEl = $('menuSaveList');
    const menuSaveAsNewEl = $('menuSaveAsNew');
    const menuSaveStatusEl = $('menuSaveStatus');
    const confirmSaveMenuBtnEl = $('confirmSaveMenuBtn');
    const cancelSaveMenuBtnEl = $('cancelSaveMenuBtn');
    const menuLoadModalBackdropEl = $('menuLoadModalBackdrop');
    const menuSearchInputEl = $('menuSearchInput');
    const menuLoadListEl = $('menuLoadList');
    const menuLoadStatusEl = $('menuLoadStatus');
    const confirmLoadMenuBtnEl = $('confirmLoadMenuBtn');
    const deleteMenuBtnEl = $('deleteMenuBtn');
    const cancelLoadMenuBtnEl = $('cancelLoadMenuBtn');
    const exportMenuBtnEl = $('exportMenuBtn');
    const importMenuBtnEl = $('importMenuBtn');

    let drinksCache = [];
    let loadedMenuDrinks = [];
    let fullscreenPreviewActive = false;
    let fullscreenPreviewEscHandler = null;
    let savedMenusCache = [];
    let selectedSavedMenuId = '';
    let selectedSaveTargetMenuId = '';
    let customCategoriesCache = [];
    let previewZoom = 1;
    let previewPanX = 0;
    let previewPanY = 0;
    let previewIsPanning = false;
    let previewPanStartX = 0;
    let previewPanStartY = 0;
    let previewActivePanPointerId = null;
    let previewMiddleClickLastAt = 0;
    let viewRotationDeg = 0;
    let activeEventKeysCache = [];
    let activeEventKeysLoaded = false;
    let activeEventKeysLoading = false;

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) { /* ignore */ }
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const loaded = JSON.parse(raw);
            Object.assign(state, loaded);
            if (!Array.isArray(state.columnWidths) || state.columnWidths.length !== state.columnCount) {
                state.columnWidths = Array.from({ length: state.columnCount }, () => 100 / state.columnCount);
            }
            if (!Array.isArray(state.columnRows) || state.columnRows.length !== state.columnCount) {
                const def = getDefaultState();
                state.columnRows = def.columnRows.slice(0, state.columnCount);
                while (state.columnRows.length < state.columnCount) {
                    state.columnRows.push({ rowCount: 2, rowHeights: [50, 50] });
                }
            }
            ensureLockArrays();
            ensureOverlayState();
            if (state.tileBg && !state.tileTemplate) {
                state.tileTemplate = state.tileBg.map(col => col.map(v => v || 'white'));
            }
        } catch (e) { /* ignore */ }
    }

    function getReferencedDrinkIds() {
        const ids = new Set();
        if (!Array.isArray(state.tileTemplateProps)) return ids;
        state.tileTemplateProps.forEach((col) => {
            if (!Array.isArray(col)) return;
            col.forEach((props) => {
                if (props && Array.isArray(props.drinkIds)) props.drinkIds.forEach((id) => ids.add(id));
            });
        });
        return ids;
    }

    function saveMenuToFile() {
        const stateClone = JSON.parse(JSON.stringify(state));
        const drinkIds = getReferencedDrinkIds();
        const drinksSnapshot = Array.from(drinkIds).map((id) => {
            const d = drinksCache.find((x) => x.id === id);
            return d ? { id: d.id, name: d.name, description: d.description, price: d.price, category: d.category } : null;
        }).filter(Boolean);
        const payload = {
            version: 1,
            savedAt: new Date().toISOString(),
            state: stateClone,
            drinksSnapshot
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'menu-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    function applyLoadedState(loaded) {
        Object.assign(state, loaded);
        if (!Array.isArray(state.columnWidths) || state.columnWidths.length !== state.columnCount) {
            state.columnWidths = Array.from({ length: state.columnCount }, () => 100 / state.columnCount);
        }
        if (!Array.isArray(state.columnRows) || state.columnRows.length !== state.columnCount) {
            const def = getDefaultState();
            state.columnRows = def.columnRows.slice(0, state.columnCount);
            while (state.columnRows.length < state.columnCount) {
                state.columnRows.push({ rowCount: 2, rowHeights: [50, 50] });
            }
        }
        ensureLockArrays();
        ensureOverlayState();
        if (state.tileBg && !state.tileTemplate) {
            state.tileTemplate = state.tileBg.map(col => col.map(v => v || 'white'));
        }
    }

    function loadMenuFromFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = reader.result;
                if (!text || typeof text !== 'string') {
                    alert('Invalid or empty menu file.');
                    return;
                }
                const data = JSON.parse(text);
                if (!data || typeof data.state !== 'object') {
                    alert('Invalid or empty menu file.');
                    return;
                }
                applyLoadedState(data.state);
                loadedMenuDrinks = dedupeDrinkSnapshotByName(Array.isArray(data.drinksSnapshot) ? data.drinksSnapshot : []);
                saveState();
                applyStateToForm();
                renderColumnWidthInputs();
                renderColumnRowsSection();
                renderTiles();
            } catch (e) {
                console.error('Load menu failed:', e);
                alert('Invalid or empty menu file.');
            }
        };
        reader.readAsText(file);
    }

    function buildMenuPayload(menuName) {
        const stateClone = JSON.parse(JSON.stringify(state));
        const drinkIds = getReferencedDrinkIds();
        const drinksSnapshot = Array.from(drinkIds).map((id) => {
            const d = drinksCache.find((x) => x.id === id);
            return d ? { id: d.id, name: d.name, description: d.description, price: d.price, category: d.category } : null;
        }).filter(Boolean);
        const fallbackName = 'Menu ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
        return {
            version: MENU_PAYLOAD_VERSION,
            name: (menuName || '').trim() || fallbackName,
            savedAt: new Date().toISOString(),
            // Firestore does not support nested arrays (e.g. tileTemplate[][]),
            // so persist menu state as JSON.
            stateJson: JSON.stringify(stateClone),
            drinksSnapshot
        };
    }

    function applyLoadedMenuPayload(data) {
        if (!data || typeof data !== 'object') throw new Error('Invalid menu data');
        let loadedState = null;
        if (typeof data.stateJson === 'string' && data.stateJson.trim()) {
            loadedState = JSON.parse(data.stateJson);
        } else if (data.state && typeof data.state === 'object') {
            // Backward compatibility for legacy menu documents/files.
            loadedState = data.state;
        }
        if (!loadedState || typeof loadedState !== 'object') throw new Error('Invalid menu state');
        applyLoadedState(loadedState);
        loadedMenuDrinks = dedupeDrinkSnapshotByName(Array.isArray(data.drinksSnapshot) ? data.drinksSnapshot : []);
        saveState();
        applyStateToForm();
        renderColumnWidthInputs();
        renderColumnRowsSection();
        renderTiles();
    }

    function getMenuUpdatedAtValue(menu) {
        if (!menu || !menu.updatedAt) return 0;
        if (typeof menu.updatedAt.toMillis === 'function') return menu.updatedAt.toMillis();
        if (typeof menu.updatedAt === 'string') return Date.parse(menu.updatedAt) || 0;
        return 0;
    }

    async function loadSavedMenusFromFirebase() {
        const menusRef = collection(db, MENUS_COLLECTION);
        let snap;
        try {
            const q = query(menusRef, orderBy('updatedAt', 'desc'));
            snap = await getDocs(q);
        } catch (err) {
            snap = await getDocs(menusRef);
        }
        savedMenusCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        savedMenusCache.sort((a, b) => getMenuUpdatedAtValue(b) - getMenuUpdatedAtValue(a));
        return savedMenusCache;
    }

    function formatMenuDate(menu) {
        const ts = getMenuUpdatedAtValue(menu) || Date.parse(menu && menu.savedAt ? menu.savedAt : '') || Date.now();
        try {
            return new Date(ts).toLocaleString();
        } catch (_) {
            return 'Unknown date';
        }
    }

    function setMenuSaveStatus(text, isError) {
        if (!menuSaveStatusEl) return;
        menuSaveStatusEl.textContent = text || '';
        menuSaveStatusEl.style.color = isError ? '#b42318' : '';
    }

    function setMenuLoadStatus(text, isError) {
        if (!menuLoadStatusEl) return;
        menuLoadStatusEl.textContent = text || '';
        menuLoadStatusEl.style.color = isError ? '#b42318' : '';
    }

    function closeSaveMenuModal() {
        if (!menuSaveModalBackdropEl) return;
        menuSaveModalBackdropEl.hidden = true;
        menuSaveModalBackdropEl.setAttribute('aria-hidden', 'true');
        setMenuSaveStatus('');
    }

    function closeLoadMenuModal() {
        if (!menuLoadModalBackdropEl) return;
        menuLoadModalBackdropEl.hidden = true;
        menuLoadModalBackdropEl.setAttribute('aria-hidden', 'true');
        setMenuLoadStatus('');
    }

    function renderSaveMenuList(filterText) {
        if (!menuSaveListEl) return;
        const term = (filterText || '').trim().toLowerCase();
        const filtered = term ? savedMenusCache.filter((menu) => (menu.name || '').toLowerCase().includes(term)) : savedMenusCache;
        if (filtered.length === 0) {
            menuSaveListEl.innerHTML = '<div class="menu-load-empty">No menus found.</div>';
            selectedSaveTargetMenuId = '';
            return;
        }
        menuSaveListEl.innerHTML = filtered.map((menu) => {
            const isSelected = menu.id === selectedSaveTargetMenuId;
            return `<button type="button" class="menu-load-item${isSelected ? ' is-selected' : ''}" data-id="${escapeHtml(menu.id)}">
                <span class="menu-load-item-name">${escapeHtml(menu.name || '(unnamed menu)')}</span>
                <span class="menu-load-item-meta">Updated ${escapeHtml(formatMenuDate(menu))}</span>
            </button>`;
        }).join('');
        menuSaveListEl.querySelectorAll('.menu-load-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                selectedSaveTargetMenuId = btn.getAttribute('data-id') || '';
                if (menuSaveAsNewEl) menuSaveAsNewEl.checked = false;
                const selected = savedMenusCache.find((menu) => menu.id === selectedSaveTargetMenuId);
                if (selected && menuSaveNameEl && !menuSaveNameEl.value.trim()) menuSaveNameEl.value = selected.name || '';
                renderSaveMenuList(menuSaveSearchInputEl ? menuSaveSearchInputEl.value : '');
            });
        });
    }

    function renderMenuLoadList(filterText) {
        if (!menuLoadListEl) return;
        const term = (filterText || '').trim().toLowerCase();
        const filtered = term ? savedMenusCache.filter((menu) => (menu.name || '').toLowerCase().includes(term)) : savedMenusCache;
        if (filtered.length === 0) {
            menuLoadListEl.innerHTML = '<div class="menu-load-empty">No menus found.</div>';
            selectedSavedMenuId = '';
            return;
        }
        menuLoadListEl.innerHTML = filtered.map((menu) => {
            const isSelected = menu.id === selectedSavedMenuId;
            return `<button type="button" class="menu-load-item${isSelected ? ' is-selected' : ''}" data-id="${escapeHtml(menu.id)}">
                <span class="menu-load-item-name">${escapeHtml(menu.name || '(unnamed menu)')}</span>
                <span class="menu-load-item-meta">Updated ${escapeHtml(formatMenuDate(menu))}</span>
            </button>`;
        }).join('');
        menuLoadListEl.querySelectorAll('.menu-load-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                selectedSavedMenuId = btn.getAttribute('data-id') || '';
                renderMenuLoadList(menuSearchInputEl ? menuSearchInputEl.value : '');
            });
        });
    }

    async function openSaveMenuModal() {
        if (!menuSaveModalBackdropEl) return;
        setMenuSaveStatus('Loading online menus…');
        menuSaveModalBackdropEl.hidden = false;
        menuSaveModalBackdropEl.setAttribute('aria-hidden', 'false');
        try {
            await loadSavedMenusFromFirebase();
            selectedSaveTargetMenuId = savedMenusCache[0] ? savedMenusCache[0].id : '';
            if (menuSaveSearchInputEl) menuSaveSearchInputEl.value = '';
            if (menuSaveAsNewEl) menuSaveAsNewEl.checked = true;
            renderSaveMenuList('');
            if (menuSaveNameEl) menuSaveNameEl.value = '';
            setMenuSaveStatus('');
        } catch (err) {
            console.error('Load menus for save modal:', err);
            setMenuSaveStatus('Failed to load online menu list.', true);
        }
    }

    async function openLoadMenuModal() {
        if (!menuLoadModalBackdropEl) return;
        setMenuLoadStatus('Loading online menus…');
        menuLoadModalBackdropEl.hidden = false;
        menuLoadModalBackdropEl.setAttribute('aria-hidden', 'false');
        try {
            await loadSavedMenusFromFirebase();
            selectedSavedMenuId = savedMenusCache[0] ? savedMenusCache[0].id : '';
            if (menuSearchInputEl) menuSearchInputEl.value = '';
            renderMenuLoadList('');
            setMenuLoadStatus(savedMenusCache.length ? '' : 'No menus saved online yet.');
        } catch (err) {
            console.error('Load menus for load modal:', err);
            setMenuLoadStatus('Failed to load online menu list.', true);
        }
    }

    async function saveMenuOnline() {
        const menuName = (menuSaveNameEl && menuSaveNameEl.value ? menuSaveNameEl.value : '').trim();
        const overwriteId = (menuSaveAsNewEl && menuSaveAsNewEl.checked) ? '' : (selectedSaveTargetMenuId || '');
        if (!menuName) {
            setMenuSaveStatus('Please enter a menu name.', true);
            return;
        }
        if (!overwriteId && menuSaveAsNewEl && !menuSaveAsNewEl.checked) {
            setMenuSaveStatus('Select a menu to overwrite, or enable "Save as new menu".', true);
            return;
        }
        try {
            setMenuSaveStatus('Saving online…');
            const payload = buildMenuPayload(menuName);
            if (overwriteId) {
                const ref = doc(db, MENUS_COLLECTION, overwriteId);
                await setDoc(ref, { ...payload, updatedAt: serverTimestamp() }, { merge: true });
            } else {
                const ref = doc(collection(db, MENUS_COLLECTION));
                await setDoc(ref, { ...payload, updatedAt: serverTimestamp() });
            }
            await loadSavedMenusFromFirebase();
            renderSaveMenuList(menuSaveSearchInputEl ? menuSaveSearchInputEl.value : '');
            setMenuSaveStatus('Menu saved online.');
            setTimeout(() => closeSaveMenuModal(), 250);
        } catch (err) {
            console.error('Save menu online:', err);
            setMenuSaveStatus('Failed to save menu online.', true);
        }
    }

    async function loadSelectedMenuOnline() {
        if (!selectedSavedMenuId) {
            setMenuLoadStatus('Please select a menu first.', true);
            return;
        }
        try {
            setMenuLoadStatus('Loading selected menu…');
            const ref = doc(db, MENUS_COLLECTION, selectedSavedMenuId);
            const snap = await getDoc(ref);
            if (!snap.exists()) {
                setMenuLoadStatus('Selected menu no longer exists.', true);
                return;
            }
            const data = snap.data();
            applyLoadedMenuPayload(data);
            setMenuLoadStatus('Menu loaded.');
            setTimeout(() => closeLoadMenuModal(), 250);
        } catch (err) {
            console.error('Load selected menu:', err);
            setMenuLoadStatus('Failed to load selected menu.', true);
        }
    }

    async function deleteSelectedMenuOnline() {
        if (!selectedSavedMenuId) {
            setMenuLoadStatus('Select a menu to delete.', true);
            return;
        }
        const menuToDelete = savedMenusCache.find((m) => m.id === selectedSavedMenuId);
        const ok = window.confirm('Delete menu "' + (menuToDelete && menuToDelete.name ? menuToDelete.name : selectedSavedMenuId) + '"?');
        if (!ok) return;
        try {
            setMenuLoadStatus('Deleting menu…');
            await deleteDoc(doc(db, MENUS_COLLECTION, selectedSavedMenuId));
            await loadSavedMenusFromFirebase();
            selectedSavedMenuId = savedMenusCache[0] ? savedMenusCache[0].id : '';
            renderMenuLoadList(menuSearchInputEl ? menuSearchInputEl.value : '');
            setMenuLoadStatus('Menu deleted.');
        } catch (err) {
            console.error('Delete menu:', err);
            setMenuLoadStatus('Failed to delete menu.', true);
        }
    }

    function ensureLockArrays() {
        const n = state.columnCount;
        if (!Array.isArray(state.columnWidthLocks) || state.columnWidthLocks.length !== n) {
            state.columnWidthLocks = Array.from({ length: n }, (_, i) => state.columnWidthLocks && state.columnWidthLocks[i] === true);
        }
        if (!Array.isArray(state.columnRowLocks) || state.columnRowLocks.length !== n) {
            state.columnRowLocks = state.columnRows.map((col, i) => {
                const existing = state.columnRowLocks && state.columnRowLocks[i];
                return Array.from({ length: col.rowHeights.length }, (_, j) => existing && existing[j] === true);
            });
        }
        state.columnRows.forEach((col, i) => {
            const len = col.rowHeights.length;
            while (state.columnRowLocks[i].length < len) state.columnRowLocks[i].push(false);
            state.columnRowLocks[i].length = len;
            if (!Array.isArray(state.columnRowUnits[i])) state.columnRowUnits[i] = [];
            while (state.columnRowUnits[i].length < len) state.columnRowUnits[i].push('%');
            state.columnRowUnits[i].length = len;
        });
        ensureTileTemplates();
        ensureOverlayState();
    }

    function newOverlayId() {
        return 'ov-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    }

    function clampNumber(value, min, max) {
        const n = Number(value);
        const x = Number.isFinite(n) ? n : min;
        return Math.max(min, Math.min(max, x));
    }

    function overlayModuleLabel(type) {
        if (type === 'photo') return 'Photo / video gallery';
        if (type === 'customer-display') return 'Customer display';
        return 'Module';
    }

    function getDefaultOverlayModuleProps(type) {
        if (type === 'photo') {
            return {
                mediaItems: [],
                imageUrls: [],
                galleryIntervalSeconds: 3,
                useAsCustomerDisplay: false,
                customerDisplayEventKey: '',
                borderRadius: 12,
                contentScale: 1.4
            };
        }
        return { eventKey: '', showSettingsButton: false, borderRadius: 12, contentScale: 1.4 };
    }

    function getOverlayBorderRadius(mod) {
        const n = Number(mod && mod.props && mod.props.borderRadius);
        return Number.isFinite(n) ? clampNumber(n, 0, 80) : 12;
    }

    function getOverlayContentScale(mod) {
        const n = Number(mod && mod.props && mod.props.contentScale);
        return Number.isFinite(n) ? clampNumber(n, 0.5, 2.5) : 1;
    }

    function postOverlayDisplayStyle(el, mod) {
        const iframe = el && el.querySelector && el.querySelector('iframe');
        if (!iframe || !iframe.contentWindow) return;
        try {
            iframe.contentWindow.postMessage({
                type: 'menu-creator-display-style',
                radius: getOverlayBorderRadius(mod),
                scale: getOverlayContentScale(mod)
            }, '*');
        } catch (err) { /* ignore */ }
    }

    function normalizeOverlayModule(mod) {
        if (!mod || typeof mod !== 'object') {
            return {
                id: newOverlayId(),
                type: 'customer-display',
                x: 32,
                y: 25,
                w: 36,
                h: 50,
                props: getDefaultOverlayModuleProps('customer-display')
            };
        }
        if (!mod.id) mod.id = newOverlayId();
        mod.type = mod.type === 'photo' ? 'photo' : 'customer-display';
        mod.x = clampNumber(mod.x, 0, 100);
        mod.y = clampNumber(mod.y, 0, 100);
        mod.w = clampNumber(mod.w, 4, 100);
        mod.h = clampNumber(mod.h, 4, 100);
        if (mod.x + mod.w > 100) mod.x = Math.max(0, 100 - mod.w);
        if (mod.y + mod.h > 100) mod.y = Math.max(0, 100 - mod.h);
        if (!mod.props || typeof mod.props !== 'object') mod.props = {};
        if (!Number.isFinite(Number(mod.props.borderRadius))) mod.props.borderRadius = 12;
        else mod.props.borderRadius = clampNumber(mod.props.borderRadius, 0, 80);
        if (!Number.isFinite(Number(mod.props.contentScale))) mod.props.contentScale = 1.4;
        else mod.props.contentScale = clampNumber(mod.props.contentScale, 0.5, 2.5);
        if (mod.type === 'photo') {
            const gallery = getGalleryProps(mod.props);
            mod.props.mediaItems = gallery.mediaItems;
            mod.props.imageUrls = gallery.imageUrls;
            mod.props.galleryIntervalSeconds = gallery.galleryIntervalSeconds;
            mod.props.useAsCustomerDisplay = Boolean(mod.props.useAsCustomerDisplay);
            if (typeof mod.props.customerDisplayEventKey !== 'string') mod.props.customerDisplayEventKey = '';
        } else {
            if (typeof mod.props.eventKey !== 'string') mod.props.eventKey = '';
            mod.props.showSettingsButton = Boolean(mod.props.showSettingsButton);
        }
        return mod;
    }

    function ensureOverlayState() {
        if (state.layoutMode !== 'grid' && state.layoutMode !== 'overlay') state.layoutMode = 'grid';
        if (!state.overlay || typeof state.overlay !== 'object') {
            state.overlay = getDefaultOverlayState();
        }
        if (typeof state.overlay.imageUrl !== 'string') state.overlay.imageUrl = '';
        state.overlay.imageNaturalWidth = Math.max(0, Number(state.overlay.imageNaturalWidth) || 0);
        state.overlay.imageNaturalHeight = Math.max(0, Number(state.overlay.imageNaturalHeight) || 0);
        if (typeof state.overlay.selectedId !== 'string') state.overlay.selectedId = '';
        if (!Array.isArray(state.overlay.modules)) state.overlay.modules = [];
        state.overlay.modules = state.overlay.modules.map(normalizeOverlayModule);
        if (state.overlay.selectedId && !state.overlay.modules.some((m) => m.id === state.overlay.selectedId)) {
            state.overlay.selectedId = '';
        }
    }

    function ensureTileTemplates() {
        const n = state.columnCount;
        if (!Array.isArray(state.tileTemplate)) {
            state.tileTemplate = (state.tileBg && state.tileBg.map(col => col.map(v => v || 'white'))) || [];
        }
        if (state.tileTemplate.length === 0) {
            state.tileTemplate = state.columnRows.map(col => Array.from({ length: col.rowHeights.length }, () => 'white'));
        }
        while (state.tileTemplate.length < n) {
            const col = state.columnRows[state.tileTemplate.length];
            state.tileTemplate.push(Array.from({ length: col ? col.rowHeights.length : 2 }, () => 'white'));
        }
        state.tileTemplate.length = n;
        state.columnRows.forEach((col, i) => {
            const len = col.rowHeights.length;
            while (state.tileTemplate[i].length < len) state.tileTemplate[i].push('white');
            state.tileTemplate[i].length = len;
        });
        if (!Array.isArray(state.tileTemplateProps)) state.tileTemplateProps = [];
        while (state.tileTemplateProps.length < n) {
            const col = state.columnRows[state.tileTemplateProps.length];
            state.tileTemplateProps.push(Array.from({ length: col ? col.rowHeights.length : 2 }, () => ({ line1: '', line2: '' })));
        }
        state.tileTemplateProps.length = n;
        state.columnRows.forEach((col, i) => {
            const len = col.rowHeights.length;
            while (state.tileTemplateProps[i].length < len) state.tileTemplateProps[i].push({ line1: '', line2: '' });
            state.tileTemplateProps[i].length = len;
        });
        state.columnRows.forEach((col, i) => {
            col.rowHeights.forEach((_, j) => {
                if ((state.tileTemplate[i] && state.tileTemplate[i][j]) === 'menu') {
                    const p = state.tileTemplateProps[i][j] || {};
                    state.tileTemplateProps[i][j] = { ...p, category: p.category != null ? p.category : '', categoryTag: (p.categoryTag != null ? p.categoryTag : ''), drinkIds: Array.isArray(p.drinkIds) ? p.drinkIds : [], drinkTags: (p.drinkTags && typeof p.drinkTags === 'object') ? p.drinkTags : {}, drinkTagColors: (p.drinkTagColors && typeof p.drinkTagColors === 'object') ? p.drinkTagColors : {}, hidePrices: Boolean(p.hidePrices) };
                }
            });
        });
    }

    function getUniqueCategories() {
        const set = new Set();
        drinksCache.forEach(d => { if (d.category) set.add(d.category); });
        loadedMenuDrinks.forEach(d => { if (d && d.category) set.add(d.category); });
        customCategoriesCache.forEach((c) => { if (c) set.add(c); });
        return Array.from(set).sort();
    }

    function normalizeDrinkName(name) {
        return String(name || '').trim().toLowerCase();
    }

    function dedupeDrinkSnapshotByName(drinks) {
        if (!Array.isArray(drinks)) return [];
        const map = new Map();
        drinks.forEach((drink) => {
            const nameKey = normalizeDrinkName(drink && drink.name);
            if (!nameKey) return;
            const current = map.get(nameKey);
            if (!current || scoreDrinkCompleteness(drink) > scoreDrinkCompleteness(current)) {
                map.set(nameKey, drink);
            }
        });
        return Array.from(map.values());
    }

    function scoreDrinkCompleteness(drink) {
        if (!drink || typeof drink !== 'object') return 0;
        let score = 0;
        if ((drink.description || '').trim()) score += 1;
        if ((drink.price || '').trim()) score += 1;
        if ((drink.category || '').trim()) score += 1;
        return score;
    }

    function loadCustomCategories() {
        try {
            const raw = localStorage.getItem(CATEGORY_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            customCategoriesCache = Array.isArray(parsed)
                ? parsed.map((c) => String(c || '').trim()).filter(Boolean)
                : [];
        } catch (e) {
            customCategoriesCache = [];
        }
    }

    function saveCustomCategories() {
        const normalized = Array.from(new Set(customCategoriesCache.map((c) => String(c || '').trim()).filter(Boolean)));
        customCategoriesCache = normalized;
        try {
            localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(normalized));
        } catch (e) { /* ignore */ }
    }

    function renderDrinkCategoryOptions(selectedCategory) {
        if (!drinkCategoryEl) return;
        const categories = getUniqueCategories();
        drinkCategoryEl.innerHTML = '<option value="">Uncategorized</option>' +
            categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        if (selectedCategory && categories.includes(selectedCategory)) {
            drinkCategoryEl.value = selectedCategory;
        } else {
            drinkCategoryEl.value = '';
        }
    }

    function setCategoryStatus(message, isError) {
        if (!categoryStatusEl) return;
        categoryStatusEl.textContent = message || '';
        categoryStatusEl.style.color = isError ? '#b91c1c' : '';
    }

    function renderCategoryList() {
        if (!categoryListEl) return;
        const categories = getUniqueCategories();
        if (categories.length === 0) {
            categoryListEl.innerHTML = '<div class="menu-load-empty">No categories yet.</div>';
            return;
        }
        categoryListEl.innerHTML = categories.map((category) => {
            const fromCustom = customCategoriesCache.includes(category);
            return `<div class="category-item" data-name="${escapeHtml(category)}">
                <span>${escapeHtml(category)}</span>
                <button type="button" class="btn btn-secondary category-remove-btn" data-name="${escapeHtml(category)}"${fromCustom ? '' : ' disabled title="Used by drinks. Remove from drinks first."'}>Remove</button>
            </div>`;
        }).join('');
        categoryListEl.querySelectorAll('.category-remove-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const name = (btn.getAttribute('data-name') || '').trim();
                if (!name) return;
                customCategoriesCache = customCategoriesCache.filter((c) => c !== name);
                saveCustomCategories();
                renderCategoryList();
                renderDrinkCategoryOptions(drinkCategoryEl ? drinkCategoryEl.value : '');
                setCategoryStatus('Category removed.');
            });
        });
    }

    function applyStateToForm() {
        orientationEl.value = state.orientation;
        unitEl.value = state.unit;
        marginEl.value = state.margin;
        canvasWidthEl.value = state.width;
        canvasHeightEl.value = state.height;
        columnCountEl.value = state.columnCount;
        tileGapEl.value = state.gap;
        updateLayoutModeUi();
        updateCanvasHint();
        updateOverlayBgThumb();
        renderOverlayPanel();
    }

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    /** Strip leading P/p/Php from price string; return raw amount for display. */
    function normalizePriceAmount(priceStr) {
        if (priceStr == null) return '';
        const s = String(priceStr).trim();
        return s.replace(/^[Pp](?:hp)?\s*/i, '').trim() || s;
    }

    /** Return HTML for a price: "Php" at 2/3 size + amount (no leading P/p). */
    function formatPriceHtml(priceStr) {
        const amount = normalizePriceAmount(priceStr);
        if (!amount) return '';
        return `<span class="price-currency">Php</span> ${escapeHtml(amount)}`;
    }

    /** Same as formatPriceHtml but for add-on display: "+ Php 40". */
    function formatAddOnPriceHtml(amountStr) {
        const amount = String(amountStr || '').trim().replace(/^\s*\+\s*/, '');
        if (!amount) return '';
        return `+ <span class="price-currency">Php</span> ${escapeHtml(amount)}`;
    }

    const MENU_PLACEHOLDER_ITEMS = [
        { title: 'Signature Matchanese Latte', desc: 'Matcha Cold Whisked with Milk', price: 'P220' },
        { title: 'Spanish Matchanese Latte', desc: 'Our Signature Matcha Latte with Sweetened Milk', price: 'P230' },
        { title: 'Matchanese Seasalt Latte', tag: 'Best Seller', desc: 'Our Signature Matcha Latte topped with Seasalt Cream', price: 'P250' },
        { title: 'Strawberry Matchanese Latte', desc: 'Our Signature Matcha Latte with Strawberry Puree and Syrup', price: 'P250' },
        { title: 'Earl Grey Matchanese Latte', tag: 'New!', desc: 'Our Signature Matcha Latte with Homemade Earl Grey Syrup', price: 'P250' }
    ];

    const DRINKS_SEED = [
        { name: 'Signature Matchanese Latte', description: 'Matcha Cold Whisked with Milk', price: 'P220', category: 'Matcha Lattes' },
        { name: 'Spanish Matchanese Latte', description: 'Our Signature Matcha Latte with Sweetened Milk', price: 'P230', category: 'Matcha Lattes' },
        { name: 'Matchanese Seasalt Latte', description: 'Our Signature Matcha Latte topped with Seasalt Cream', price: 'P250', category: 'Matcha Lattes' },
        { name: 'Strawberry Matchanese Latte', description: 'Our Signature Matcha Latte with Strawberry Puree and Syrup', price: 'P250', category: 'Matcha Lattes' },
        { name: 'Earl Grey Matchanese Latte', description: 'Our Signature Matcha Latte with Homemade Earl Grey Syrup', price: 'P250', category: 'Matcha Lattes' },
        { name: 'Hōjicha Latte', description: 'Hōjicha Cold Whisked with Milk', price: 'P190', category: 'Hōjicha Lattes' },
        { name: 'Spanish Hōjicha Latte', description: 'Hōjicha Latte with Sweetened Milk', price: 'P200', category: 'Hōjicha Lattes' },
        { name: 'Hōjicha Seasalt Latte', description: 'Hōjicha Latte topped with Seasalt Cream', price: 'P220', category: 'Hōjicha Lattes' },
        { name: 'Strawberry Hōjicha Latte', description: 'Hōjicha Latte with Strawberry Puree and Syrup', price: 'P220', category: 'Hōjicha Lattes' },
        { name: 'Earl Grey Hōjicha Latte', description: 'Hōjicha Latte with Homemade Earl Grey Syrup', price: 'P220', category: 'Hōjicha Lattes' }
    ];

    const MENU_TAG_COLOR_OPTIONS = [
        { id: 'green', label: 'Green', class: 'menu-props-tag-color-btn--green' },
        { id: 'pink', label: 'Pink', class: 'menu-props-tag-color-btn--pink' },
        { id: 'purple', label: 'Purple', class: 'menu-props-tag-color-btn--purple' }
    ];

    function getDrinkTagColorId(drinkTagColors, drinkId) {
        const raw = drinkTagColors && drinkTagColors[drinkId];
        if (MENU_TAG_COLOR_OPTIONS.some((o) => o.id === raw)) return raw;
        return 'green';
    }

    function openTagColorPicker(drinkId, colIdx, rowIdx, saveState, renderTiles, renderColumnRowsSection) {
        if (!state.tileTemplateProps[colIdx] || !state.tileTemplateProps[colIdx][rowIdx]) return;
        const colors = state.tileTemplateProps[colIdx][rowIdx].drinkTagColors || {};
        const current = getDrinkTagColorId(colors, drinkId);
        const idx = MENU_TAG_COLOR_OPTIONS.findIndex((o) => o.id === current);
        const next = MENU_TAG_COLOR_OPTIONS[(idx + 1) % MENU_TAG_COLOR_OPTIONS.length];
        if (!state.tileTemplateProps[colIdx][rowIdx].drinkTagColors) state.tileTemplateProps[colIdx][rowIdx].drinkTagColors = {};
        state.tileTemplateProps[colIdx][rowIdx].drinkTagColors[drinkId] = next.id;
        saveState();
        renderTiles();
        renderColumnRowsSection();
    }

    function getMenuTemplateHtml(props) {
        const category = (props && props.category) ? String(props.category).trim() : '';
        const drinkIds = (props && Array.isArray(props.drinkIds)) ? props.drinkIds : [];
        const drinks = drinkIds.map(id => drinksCache.find(d => d.id === id) || loadedMenuDrinks.find(d => d.id === id)).filter(Boolean);
        const sectionTitle = category || 'Matcha Lattes';
        const icedLabel = 'Iced';
        const categoryTag = (props && props.categoryTag != null) ? String(props.categoryTag).trim() : '';
        const hidePrices = Boolean(props && props.hidePrices);
        let itemsHtml;
        let itemsClass = hidePrices ? ' menu-items--no-prices' : '';
        if (drinks.length === 0) {
            itemsHtml = '<div class="menu-item menu-item-placeholder">Select category and drinks in the panel.</div>';
        } else {
            const drinkTags = (props && props.drinkTags && typeof props.drinkTags === 'object') ? props.drinkTags : {};
            const drinkTagColors = (props && props.drinkTagColors && typeof props.drinkTagColors === 'object') ? props.drinkTagColors : {};
            const allNoDesc = drinks.every(d => !(d.description || '').trim());
            if (allNoDesc) itemsClass += ' menu-items--no-desc';
            itemsHtml = drinks.map(d => {
                const tagText = (drinkTags[d.id] || '').trim();
                const tagColor = getDrinkTagColorId(drinkTagColors, d.id);
                const tag = tagText ? `<span class="menu-item-tag menu-item-tag--${tagColor}">${escapeHtml(tagText)}</span>` : '';
                const priceHtml = hidePrices ? '' : `<div class="menu-item-price">${formatPriceHtml(d.price)}</div>`;
                return `<div class="menu-item"><div class="menu-item-head"><span class="menu-item-title">${escapeHtml(d.name || '')}</span>${tag}</div><div class="menu-item-desc">${escapeHtml(d.description || '')}</div>${priceHtml}</div>`;
            }).join('');
        }
        const cardClass = 'menu-card' + ((sectionTitle || '').toLowerCase().includes('hōjicha') || (sectionTitle || '').toLowerCase().includes('hojicha') ? ' menu-card--hojicha' : '');
        const headerTagHtml = categoryTag ? `<span class="menu-header-tag">${escapeHtml(categoryTag)}</span>` : '';
        const headerRight = categoryTag
            ? `<div class="menu-header-right">${headerTagHtml}</div>`
            : `<div class="menu-header-right"><span class="menu-iced">${escapeHtml(icedLabel)}</span></div>`;
        return `<div class="${cardClass}"><div class="menu-header"><h2 class="menu-title">${escapeHtml(sectionTitle)}</h2>${headerRight}</div><div class="menu-items${itemsClass}">${itemsHtml}</div></div>`;
    }

    function getCustomizationDefaults() {
        return {
            level2Price: 40,
            level3Price: 80,
            defaultMilk: 'dairy',
            dairyPrice: 0,
            oatPrice: 0,
            strengthPanelHeight: 34,
            sweetnessPanelHeight: 34,
            dairyPanelHeight: 16,
            oatPanelHeight: 16,
            titleFontSize: 44,
            subtitleFontSize: 28
        };
    }

    function getCustomizationProps(rawProps) {
        const defaults = getCustomizationDefaults();
        const p = rawProps && typeof rawProps === 'object' ? rawProps : {};
        const parsePrice = (v, fallback) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return fallback;
            return Math.max(0, Math.round(n));
        };
        const parseHeight = (v, fallback) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return fallback;
            return Math.max(1, n);
        };
        const parseFontSize = (v, fallback) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return fallback;
            return Math.max(8, Math.min(200, n));
        };
        const out = {
            ...defaults,
            level2Price: parsePrice(p.level2Price, defaults.level2Price),
            level3Price: parsePrice(p.level3Price, defaults.level3Price),
            defaultMilk: p.defaultMilk === 'oat' ? 'oat' : 'dairy',
            dairyPrice: parsePrice(p.dairyPrice, defaults.dairyPrice),
            oatPrice: parsePrice(p.oatPrice, defaults.oatPrice),
            strengthPanelHeight: parseHeight(p.strengthPanelHeight, defaults.strengthPanelHeight),
            sweetnessPanelHeight: parseHeight(p.sweetnessPanelHeight, defaults.sweetnessPanelHeight),
            dairyPanelHeight: parseHeight(p.dairyPanelHeight, defaults.dairyPanelHeight),
            oatPanelHeight: parseHeight(p.oatPanelHeight, defaults.oatPanelHeight),
            titleFontSize: parseFontSize(p.titleFontSize, defaults.titleFontSize),
            subtitleFontSize: parseFontSize(p.subtitleFontSize, defaults.subtitleFontSize)
        };
        return out;
    }

    function formatCustomizationPriceText(value) {
        const amount = Math.max(0, Number(value) || 0);
        if (amount <= 0) return 'FREE';
        return `+ <span class="price-currency">Php</span> ${amount}`;
    }

    function getCustomizationTemplateHtml(rawProps) {
        const props = getCustomizationProps(rawProps);
        const hidePrices = Boolean(rawProps && rawProps.hidePrices);
        const panelHeights = [
            props.strengthPanelHeight,
            props.sweetnessPanelHeight,
            props.dairyPanelHeight,
            props.oatPanelHeight
        ];
        const totalHeight = panelHeights.reduce((sum, v) => sum + v, 0) || 1;
        const normalized = panelHeights.map((v) => Math.max(0.1, v / totalHeight));
        const rowStyle = `grid-template-rows:${normalized.map((v) => `${v}fr`).join(' ')};`;
        const dairyIsDefault = props.defaultMilk === 'dairy';
        const dairyCardHtml = `<div class="customization-card customization-card-milk">
    <div class="customization-milk-left">
      <span class="customization-milk-meta">${dairyIsDefault ? 'Default' : 'Alternate Option'}</span>
      <span class="customization-milk-name">Dairy Milk</span>
      ${hidePrices || dairyIsDefault || Number(props.dairyPrice) <= 0 ? '' : `<span class="customization-option-price">${formatCustomizationPriceText(props.dairyPrice)}</span>`}
    </div>
    <img src="img/dairy.jpg" alt="Dairy" class="customization-milk-img">
  </div>`;
        const oatCardHtml = `<div class="customization-card customization-card-milk">
    <div class="customization-milk-left">
      <span class="customization-milk-meta">${dairyIsDefault ? 'Alternate Option' : 'Default'}</span>
      <span class="customization-milk-name">Oat Milk</span>
      ${!hidePrices && dairyIsDefault ? `<span class="customization-option-price">${formatCustomizationPriceText(props.oatPrice)}</span>` : ''}
    </div>
    <img src="img/oat.jpg" alt="Oat" class="customization-milk-img">
  </div>`;
        const milkCardsHtml = dairyIsDefault ? `${dairyCardHtml}${oatCardHtml}` : `${oatCardHtml}${dairyCardHtml}`;
        return `
<div class="customization-wrap" style="${rowStyle}">
  <header class="customization-header">
    <h1 class="customization-title" style="font-size:${props.titleFontSize}px;">Make it your<br>Matchanese</h1>
    <p class="customization-subtitle" style="font-size:${props.subtitleFontSize}px;">Customization Options</p>
  </header>
  <div class="customization-card customization-card-strength">
    <h2 class="customization-card-title">Matcha Strength</h2>
    <div class="customization-options customization-options-three">
      <div class="customization-option">
        <span class="customization-option-label">LEVEL</span>
        <span class="customization-option-num">1</span>
        <span class="customization-option-meta">DEFAULT</span>
      </div>
      <div class="customization-option">
        <span class="customization-option-label">LEVEL</span>
        <span class="customization-option-num">2</span>
        <span class="customization-option-meta customization-option-meta-green">RECOMMENDED</span>
        ${hidePrices ? '' : `<span class="customization-option-price">${formatCustomizationPriceText(props.level2Price)}</span>`}
      </div>
      <div class="customization-option">
        <span class="customization-option-label">LEVEL</span>
        <span class="customization-option-num">3</span>
        <span class="customization-option-meta">INTENSE</span>
        ${hidePrices ? '' : `<span class="customization-option-price">${formatCustomizationPriceText(props.level3Price)}</span>`}
      </div>
    </div>
  </div>
  <div class="customization-card customization-card-sweetness">
    <h2 class="customization-card-title customization-card-title-sweetness">Sweetness</h2>
    <div class="customization-options customization-options-three customization-options-sweetness">
      <div class="customization-option">
        <span class="customization-option-num">0%</span>
        <span class="customization-option-meta">Unsweetened</span>
      </div>
      <div class="customization-option">
        <span class="customization-option-num">50%</span>
        <span class="customization-option-meta">Slightly Sweetened</span>
      </div>
      <div class="customization-option">
        <span class="customization-option-num">100%</span>
        <span class="customization-option-meta">Sweetened</span>
      </div>
    </div>
  </div>
  ${milkCardsHtml}
</div>`;
    }

    async function loadDrinksFromFirebase() {
        try {
            const ref = collection(db, DRINKS_COLLECTION);
            let snap;
            try {
                const q = query(ref, orderBy('category', 'asc'), orderBy('name', 'asc'));
                snap = await getDocs(q);
            } catch (indexErr) {
                const ref2 = collection(db, DRINKS_COLLECTION);
                snap = await getDocs(ref2);
            }
            drinksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            drinksCache.sort((a, b) => {
                const c = (a.category || '').localeCompare(b.category || '');
                return c !== 0 ? c : (a.name || '').localeCompare(b.name || '');
            });
            return drinksCache;
        } catch (e) {
            console.error('Load drinks from Firebase:', e);
            drinksCache = [];
            return [];
        }
    }

    async function resolveDuplicateDrinksByName() {
        const grouped = new Map();
        drinksCache.forEach((drink) => {
            const key = normalizeDrinkName(drink && drink.name);
            if (!key) return;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(drink);
        });
        const duplicateGroups = Array.from(grouped.values()).filter((group) => group.length > 1);
        if (duplicateGroups.length === 0) return 0;
        const idMap = new Map();
        const toDelete = [];
        duplicateGroups.forEach((group) => {
            const sorted = group.slice().sort((a, b) => {
                const scoreDiff = scoreDrinkCompleteness(b) - scoreDrinkCompleteness(a);
                if (scoreDiff !== 0) return scoreDiff;
                return String(a.id || '').localeCompare(String(b.id || ''));
            });
            const keep = sorted[0];
            sorted.slice(1).forEach((dup) => {
                idMap.set(dup.id, keep.id);
                toDelete.push(dup.id);
            });
        });

        if (idMap.size > 0 && Array.isArray(state.tileTemplateProps)) {
            state.tileTemplateProps.forEach((col) => {
                if (!Array.isArray(col)) return;
                col.forEach((props) => {
                    if (!props || !Array.isArray(props.drinkIds)) return;
                    props.drinkIds = props.drinkIds.map((id) => idMap.get(id) || id).filter((id, idx, arr) => arr.indexOf(id) === idx);
                });
            });
            saveState();
        }

        for (const id of toDelete) {
            try {
                await deleteDoc(doc(db, DRINKS_COLLECTION, id));
            } catch (e) {
                console.error('Delete duplicate drink failed:', id, e);
            }
        }
        return toDelete.length;
    }

    async function runOneTimeDrinkDuplicateResolution() {
        let alreadyResolved = false;
        try {
            alreadyResolved = localStorage.getItem(DRINK_DEDUP_RESOLVED_KEY) === '1';
        } catch (e) { /* ignore */ }
        if (alreadyResolved) return;
        const removed = await resolveDuplicateDrinksByName();
        if (removed > 0) {
            await loadDrinksFromFirebase();
        }
        try {
            localStorage.setItem(DRINK_DEDUP_RESOLVED_KEY, '1');
        } catch (e) { /* ignore */ }
    }

    async function seedDrinksIfEmpty() {
        if (drinksCache.length > 0) return;
        try {
            const ref = collection(db, DRINKS_COLLECTION);
            for (const d of DRINKS_SEED) {
                await addDoc(ref, {
                    name: d.name,
                    description: d.description || '',
                    price: d.price || '',
                    category: d.category || ''
                });
            }
            await loadDrinksFromFirebase();
        } catch (e) {
            console.error('Seed drinks:', e);
        }
    }

    function renderDrinksList() {
        if (!drinksListEl || !drinksListHintEl) return;
        if (drinksCache.length === 0) {
            drinksListEl.innerHTML = '';
            drinksListHintEl.textContent = 'No menu items yet. Click Add item to add one.';
            return;
        }
        drinksListHintEl.textContent = drinksCache.length + ' item(s).';
        const grouped = new Map();
        drinksCache.forEach((d) => {
            const category = (d.category || '').trim() || 'Uncategorized';
            if (!grouped.has(category)) grouped.set(category, []);
            grouped.get(category).push(d);
        });
        const categories = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
        drinksListEl.innerHTML = categories.map((category) => {
            const items = grouped.get(category) || [];
            const itemsHtml = items.map(d => {
                const meta = [d.price].filter(Boolean).join(' · ');
                return `<div class="drink-item" data-id="${escapeHtml(d.id)}">
                    <div class="drink-item-name">${escapeHtml(d.name || '')}</div>
                    ${d.description ? `<div class="drink-item-meta">${escapeHtml(d.description)}</div>` : ''}
                    ${meta ? `<div class="drink-item-meta">${escapeHtml(meta)}</div>` : ''}
                    <div class="drink-item-actions">
                        <button type="button" class="btn btn-secondary drink-edit-btn" data-id="${escapeHtml(d.id)}">Edit</button>
                        <button type="button" class="btn btn-secondary drink-duplicate-btn" data-id="${escapeHtml(d.id)}">Duplicate</button>
                    </div>
                </div>`;
            }).join('');
            return `<section class="drink-category-group">
                <h3 class="drink-category-title">${escapeHtml(category)}</h3>
                ${itemsHtml}
            </section>`;
        }).join('');
        drinksListEl.querySelectorAll('.drink-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => startEditDrink(btn.getAttribute('data-id')));
        });
        drinksListEl.querySelectorAll('.drink-duplicate-btn').forEach(btn => {
            btn.addEventListener('click', () => duplicateDrink(btn.getAttribute('data-id')));
        });
    }

    function openDrinkModal(editData) {
        const selectedCategory = editData ? (editData.category || '') : '';
        renderDrinkCategoryOptions(selectedCategory);
        if (editData) {
            drinkNameEl.value = editData.name || '';
            drinkDescEl.value = editData.description || '';
            drinkPriceEl.value = editData.price || '';
            drinkEditIdEl.value = editData.id || '';
            drinkModalTitleEl.textContent = 'Edit item';
            saveDrinkBtnEl.textContent = 'Update item';
        } else {
            drinkNameEl.value = '';
            drinkDescEl.value = '';
            drinkPriceEl.value = '';
            drinkEditIdEl.value = '';
            drinkModalTitleEl.textContent = 'Add item';
            saveDrinkBtnEl.textContent = 'Save item';
        }
        drinkModalBackdropEl.hidden = false;
        drinkModalBackdropEl.setAttribute('aria-hidden', 'false');
    }

    function closeDrinkModal() {
        drinkModalBackdropEl.hidden = true;
        drinkModalBackdropEl.setAttribute('aria-hidden', 'true');
        drinkNameEl.value = '';
        drinkDescEl.value = '';
        drinkPriceEl.value = '';
        renderDrinkCategoryOptions('');
        drinkEditIdEl.value = '';
        drinkModalTitleEl.textContent = 'Add item';
        saveDrinkBtnEl.textContent = 'Save item';
    }

    function openCategoryModal() {
        if (!categoryModalBackdropEl) return;
        setCategoryStatus('');
        if (newCategoryNameEl) newCategoryNameEl.value = '';
        renderCategoryList();
        categoryModalBackdropEl.hidden = false;
        categoryModalBackdropEl.setAttribute('aria-hidden', 'false');
    }

    function closeCategoryModal() {
        if (!categoryModalBackdropEl) return;
        categoryModalBackdropEl.hidden = true;
        categoryModalBackdropEl.setAttribute('aria-hidden', 'true');
        if (newCategoryNameEl) newCategoryNameEl.value = '';
        setCategoryStatus('');
    }

    function isPreviewInteractionEnabled() {
        return !fullscreenPreviewActive;
    }

    function isPreviewZoomEnabled() {
        return !fullscreenPreviewActive;
    }

    function setupPreviewInteractions() {
        if (!previewWrapEl) return;
        previewWrapEl.addEventListener('wheel', (e) => {
            if (!isPreviewZoomEnabled()) return;
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.1 : 0.9;
            previewZoom = Math.max(0.5, Math.min(4, previewZoom * factor));
            fitCanvasToPreview();
        }, { passive: false });

        function endPreviewPan() {
            if (!previewIsPanning) return;
            previewIsPanning = false;
            if (previewActivePanPointerId != null) {
                try {
                    previewWrapEl.releasePointerCapture(previewActivePanPointerId);
                } catch (err) { /* ignore */ }
                previewActivePanPointerId = null;
            }
            previewWrapEl.classList.remove('is-panning');
        }

        const VIEWER_HOLD_MS = 550;
        const VIEWER_MOVE_CANCEL_HOLD_PX = 10;
        let viewerHoldTimer = null;
        let viewerGesturePointerId = null;
        let viewerGestureStartX = 0;
        let viewerGestureStartY = 0;

        function beginPanFromEvent(e) {
            previewIsPanning = true;
            previewActivePanPointerId = e.pointerId;
            previewPanStartX = e.clientX - previewPanX;
            previewPanStartY = e.clientY - previewPanY;
            previewWrapEl.classList.add('is-panning');
            try {
                previewWrapEl.setPointerCapture(e.pointerId);
            } catch (err) { /* ignore */ }
        }

        previewWrapEl.addEventListener('pointerdown', (e) => {
            if (!isPreviewInteractionEnabled()) return;
            if (!e.isPrimary) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (e.target && e.target.closest && e.target.closest('.overlay-module')) return;

            if (VIEWER_MODE) {
                if (viewerHoldTimer) {
                    clearTimeout(viewerHoldTimer);
                    viewerHoldTimer = null;
                }
                const pid = e.pointerId;
                viewerGesturePointerId = pid;
                viewerGestureStartX = e.clientX;
                viewerGestureStartY = e.clientY;
                viewerHoldTimer = setTimeout(() => {
                    viewerHoldTimer = null;
                    if (viewerGesturePointerId !== pid) return;
                    if (previewIsPanning) return;
                    openLoadMenuModal();
                    viewerGesturePointerId = null;
                }, VIEWER_HOLD_MS);
                return;
            }

            beginPanFromEvent(e);
        });

        previewWrapEl.addEventListener('pointermove', (e) => {
            if (VIEWER_MODE) {
                if (!isPreviewInteractionEnabled()) return;
                if (viewerGesturePointerId == null) return;
                if (e.pointerId !== viewerGesturePointerId) return;
                if (previewIsPanning) {
                    previewPanX = e.clientX - previewPanStartX;
                    previewPanY = e.clientY - previewPanStartY;
                    fitCanvasToPreview();
                    return;
                }
                const dx = e.clientX - viewerGestureStartX;
                const dy = e.clientY - viewerGestureStartY;
                if (dx * dx + dy * dy > VIEWER_MOVE_CANCEL_HOLD_PX * VIEWER_MOVE_CANCEL_HOLD_PX) {
                    if (viewerHoldTimer) {
                        clearTimeout(viewerHoldTimer);
                        viewerHoldTimer = null;
                    }
                    beginPanFromEvent(e);
                }
                return;
            }
            if (!previewIsPanning || e.pointerId !== previewActivePanPointerId) return;
            previewPanX = e.clientX - previewPanStartX;
            previewPanY = e.clientY - previewPanStartY;
            fitCanvasToPreview();
        });

        previewWrapEl.addEventListener('pointerup', (e) => {
            if (VIEWER_MODE) {
                if (viewerHoldTimer) {
                    clearTimeout(viewerHoldTimer);
                    viewerHoldTimer = null;
                }
                if (previewIsPanning && e.pointerId === previewActivePanPointerId) {
                    endPreviewPan();
                }
                if (viewerGesturePointerId != null && e.pointerId === viewerGesturePointerId) {
                    viewerGesturePointerId = null;
                }
                return;
            }
            if (e.pointerId !== previewActivePanPointerId) return;
            endPreviewPan();
        });
        previewWrapEl.addEventListener('pointercancel', (e) => {
            if (VIEWER_MODE) {
                if (viewerHoldTimer) {
                    clearTimeout(viewerHoldTimer);
                    viewerHoldTimer = null;
                }
                if (previewIsPanning && e.pointerId === previewActivePanPointerId) {
                    endPreviewPan();
                }
                if (viewerGesturePointerId != null && e.pointerId === viewerGesturePointerId) {
                    viewerGesturePointerId = null;
                }
                return;
            }
            if (e.pointerId !== previewActivePanPointerId) return;
            endPreviewPan();
        });

        /* Mouse left the preview while deciding (no pan yet): cancel hold, same as before. */
        previewWrapEl.addEventListener('pointerleave', (e) => {
            if (!VIEWER_MODE || e.pointerType !== 'mouse') return;
            if (previewIsPanning) return;
            if (viewerGesturePointerId == null || e.pointerId !== viewerGesturePointerId) return;
            if (viewerHoldTimer) {
                clearTimeout(viewerHoldTimer);
                viewerHoldTimer = null;
            }
            viewerGesturePointerId = null;
        });

        previewWrapEl.addEventListener('dblclick', () => {
            if (VIEWER_MODE) {
                cycleViewRotation();
                return;
            }
            if (!isPreviewInteractionEnabled()) return;
            previewZoom = 1;
            previewPanX = 0;
            previewPanY = 0;
            fitCanvasToPreview();
        });

        previewWrapEl.addEventListener('mousedown', (e) => {
            if (!VIEWER_MODE || e.button !== 1) return;
            const now = Date.now();
            if (now - previewMiddleClickLastAt < 400) {
                e.preventDefault();
                previewZoom = 1;
                previewPanX = 0;
                previewPanY = 0;
                fitCanvasToPreview();
            }
            previewMiddleClickLastAt = now;
        });
    }

    function normalizeViewRotationDeg(deg) {
        const n = Math.round(Number(deg) || 0) % 360;
        return n < 0 ? n + 360 : n;
    }

    function loadViewRotation() {
        try {
            const raw = sessionStorage.getItem(VIEW_ROTATION_SESSION_KEY);
            if (raw == null) return;
            const r = normalizeViewRotationDeg(Number(raw));
            if (r === 0 || r === 90 || r === 180 || r === 270) viewRotationDeg = r;
        } catch (e) { /* ignore */ }
    }

    function saveViewRotation() {
        try {
            sessionStorage.setItem(VIEW_ROTATION_SESSION_KEY, String(viewRotationDeg));
        } catch (e) { /* ignore */ }
    }

    function cycleViewRotation() {
        viewRotationDeg = (normalizeViewRotationDeg(viewRotationDeg) + 90) % 360;
        saveViewRotation();
        fitCanvasToPreview();
    }

    function isKeydownInEditableField(target) {
        if (!target) return false;
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        return Boolean(target.isContentEditable);
    }

    function setupViewerModeUi() {
        if (!VIEWER_MODE) return;
        document.body.classList.add('viewer-mode');
    }

    /**
     * Match customer-display exactly:
     * load from `branches`, keep popup events that are not archived.
     * (Same source/filtering used by pos/js/customer-display.js.)
     */
    async function loadActiveEventKeys(opts) {
        const force = opts && opts.force === true;
        if (!force && activeEventKeysLoaded) return activeEventKeysCache;
        if (activeEventKeysLoading && !force) return activeEventKeysCache;
        activeEventKeysLoading = true;
        try {
            const snapshot = await getDocs(collection(db, 'branches'));
            const popupEvents = [];
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                if (data && data.type === 'popup' && data.key && !data.archived) {
                    const key = String(data.key);
                    const nameRaw = data.name != null ? String(data.name).trim() : '';
                    popupEvents.push({ key, name: nameRaw || key });
                }
            });
            activeEventKeysCache = popupEvents.sort((a, b) => a.key.localeCompare(b.key));
            activeEventKeysLoaded = true;
            return activeEventKeysCache;
        } catch (err) {
            console.error('Load POS events for menu creator failed:', err);
            activeEventKeysCache = [];
            activeEventKeysLoaded = true;
            return [];
        } finally {
            activeEventKeysLoading = false;
        }
    }

    function buildPosEventDropdownHtml(selectedKey) {
        const sel = (selectedKey || '').trim();
        let html = '<option value="">— Select POS event —</option>';
        activeEventKeysCache.forEach((row) => {
            const label = `${row.name} — ${row.key}`;
            html += `<option value="${escapeHtml(row.key)}">${escapeHtml(label)}</option>`;
        });
        const hasKey = activeEventKeysCache.some((r) => r.key === sel);
        if (sel && !hasKey) {
            html += `<option value="${escapeHtml(sel)}">${escapeHtml('Saved key: ' + sel)}</option>`;
        }
        return html;
    }

    function posEventDropdownHint() {
        if (!activeEventKeysLoaded) return 'Loading POS events…';
        if (activeEventKeysCache.length === 0) {
            return 'No active popup events found (branches).';
        }
        return '';
    }

    function ensureActiveEventKeysLoaded() {
        if (activeEventKeysLoaded || activeEventKeysLoading) return;
        loadActiveEventKeys().then(() => {
            renderColumnRowsSection();
            renderOverlaySelectedProps();
        });
    }

    function startEditDrink(id) {
        const d = drinksCache.find(x => x.id === id);
        if (!d) return;
        openDrinkModal({ id: d.id, name: d.name, description: d.description, price: d.price, category: d.category });
    }

    async function duplicateDrink(id) {
        const d = drinksCache.find(x => x.id === id);
        if (!d) return;
        const baseName = ((d.name || '').trim() || 'Untitled') + ' (copy)';
        const existing = new Set(drinksCache.map((item) => normalizeDrinkName(item.name)));
        let candidate = baseName;
        let copyIndex = 2;
        while (existing.has(normalizeDrinkName(candidate))) {
            candidate = `${baseName} ${copyIndex}`;
            copyIndex += 1;
        }
        try {
            const ref = collection(db, DRINKS_COLLECTION);
            await addDoc(ref, {
                name: candidate,
                description: d.description || '',
                price: d.price || '',
                category: d.category || ''
            });
            await loadDrinksFromFirebase();
            renderDrinksList();
        } catch (e) {
            console.error('Duplicate drink:', e);
            alert('Failed to duplicate: ' + (e.message || e));
        }
    }

    async function saveDrink() {
        const name = (drinkNameEl.value || '').trim();
        const description = (drinkDescEl.value || '').trim();
        const price = (drinkPriceEl.value || '').trim();
        const category = (drinkCategoryEl.value || '').trim();
        if (!name) {
            alert('Please enter an item name.');
            return;
        }
        const editId = (drinkEditIdEl.value || '').trim();
        const normalizedName = normalizeDrinkName(name);
        const existingWithSameName = drinksCache.find((d) => normalizeDrinkName(d.name) === normalizedName && d.id !== editId);
        try {
            if (existingWithSameName && editId) {
                alert('Another drink already uses this name. Please use a unique name.');
                return;
            }
            if (editId) {
                const ref = doc(db, DRINKS_COLLECTION, editId);
                await updateDoc(ref, { name, description, price, category });
            } else if (existingWithSameName) {
                const ref = doc(db, DRINKS_COLLECTION, existingWithSameName.id);
                await updateDoc(ref, { name, description, price, category });
                alert('A drink with that name already exists. Updated existing item instead.');
            } else {
                const ref = collection(db, DRINKS_COLLECTION);
                await addDoc(ref, { name, description, price, category });
            }
            await loadDrinksFromFirebase();
            renderDrinkCategoryOptions(category);
            renderDrinksList();
            renderColumnRowsSection();
            renderTiles();
            closeDrinkModal();
        } catch (e) {
            console.error('Save drink:', e);
            alert('Failed to save: ' + (e.message || e));
        }
    }

    function addCategory() {
        const categoryName = (newCategoryNameEl && newCategoryNameEl.value ? newCategoryNameEl.value : '').trim();
        if (!categoryName) {
            setCategoryStatus('Enter a category name.', true);
            return;
        }
        const exists = getUniqueCategories().some((c) => c.toLowerCase() === categoryName.toLowerCase());
        if (exists) {
            setCategoryStatus('Category already exists.');
            return;
        }
        customCategoriesCache.push(categoryName);
        saveCustomCategories();
        renderCategoryList();
        renderDrinkCategoryOptions(categoryName);
        if (newCategoryNameEl) newCategoryNameEl.value = '';
        setCategoryStatus('Category added.');
    }

    function toPx(value) {
        return state.unit === 'cm' ? value * CM_TO_PX : value;
    }

    function normalizePercentages(values, changedIndex, newValue) {
        return normalizeToSum(values, changedIndex, newValue, 100);
    }

    function normalizeToSum(values, changedIndex, newValue, targetSum) {
        const arr = [...values];
        const maxVal = targetSum;
        arr[changedIndex] = Math.max(0, Math.min(maxVal, Number(newValue) || 0));
        const rest = arr.filter((_, i) => i !== changedIndex);
        const restSum = rest.reduce((a, b) => a + b, 0);
        const targetRest = targetSum - arr[changedIndex];
        const otherIndices = values.map((_, i) => i).filter(i => i !== changedIndex);
        if (otherIndices.length === 0) return arr;
        if (restSum <= 0) {
            const eq = targetRest / otherIndices.length;
            otherIndices.forEach((idx, i) => {
                arr[idx] = i < otherIndices.length - 1 ? eq : targetRest - eq * (otherIndices.length - 1);
            });
            return arr;
        }
        otherIndices.forEach((idx, i) => {
            arr[idx] = (rest[i] / restSum) * targetRest;
        });
        return arr;
    }

    function clampSumToHundred(values) {
        let sum = values.reduce((a, b) => a + b, 0);
        if (sum <= 0) return values.map(() => 100 / values.length);
        return values.map(v => (v / sum) * 100);
    }

    function roundPct(x) {
        return Math.round(x * 100) / 100;
    }

    function parseUnitValue(str) {
        const s = (str || '').trim().toLowerCase();
        const pxMatch = s.match(/^([\d.]+)\s*px$/);
        if (pxMatch) return { value: Math.max(0, parseFloat(pxMatch[1]) || 0), unit: 'px' };
        const pctMatch = s.match(/^([\d.]+)\s*%?$/);
        if (pctMatch) return { value: Math.max(0, parseFloat(pctMatch[1]) || 0), unit: '%' };
        return null;
    }

    function getColumnTotalWidthPx() {
        const { w, h } = getCanvasDimensions();
        const margin = state.unit === 'cm' ? state.margin * CM_TO_PX : state.margin;
        const innerW = Math.max(0, w - margin * 2);
        const gapPx = toPx(state.gap);
        const totalGapX = gapPx * Math.max(0, state.columnCount - 1);
        return Math.max(0, innerW - totalGapX);
    }

    function getColumnHeightPx(colIdx) {
        const { w, h } = getCanvasDimensions();
        const margin = state.unit === 'cm' ? state.margin * CM_TO_PX : state.margin;
        return Math.max(0, h - margin * 2);
    }

    /** Total row space for a column (height minus gaps between rows). Used so % is always "of total". */
    function getColumnRowSpacePx(colIdx) {
        const col = state.columnRows[colIdx];
        const n = (col && col.rowHeights && col.rowHeights.length) || 0;
        const gapPx = toPx(state.gap);
        const totalGapY = gapPx * Math.max(0, n - 1);
        return Math.max(0, getColumnHeightPx(colIdx) - totalGapY);
    }

    function formatColumnWidthDisplay(i, forEditing) {
        const val = state.columnWidths[i];
        if (forEditing) return String(roundPct(val));
        const totalPx = getColumnTotalWidthPx();
        const px = totalPx > 0 ? Math.round((val / 100) * totalPx) : 0;
        return totalPx > 0 ? roundPct(val) + '% (' + px + 'px)' : roundPct(val) + '%';
    }

    function getColumnWidthDisplayParts(i) {
        const val = state.columnWidths[i];
        const totalPx = getColumnTotalWidthPx();
        const px = totalPx > 0 ? Math.round((val / 100) * totalPx) : 0;
        return { primary: roundPct(val) + '%', alternate: totalPx > 0 ? px + 'px' : '' };
    }

    function formatRowHeightDisplay(colIdx, rowIdx, forEditing) {
        const col = state.columnRows[colIdx];
        const heights = col && col.rowHeights;
        const units = (state.columnRowUnits && state.columnRowUnits[colIdx]) || [];
        const unit = (units[rowIdx] || '%');
        const val = (heights && heights[rowIdx]) != null ? heights[rowIdx] : 50;
        if (forEditing) return String(unit === 'px' ? Math.round(val) : roundPct(val));
        const parts = getRowHeightDisplayParts(colIdx, rowIdx);
        return parts.alternate ? parts.primary + ' (' + parts.alternate + ')' : parts.primary;
    }

    /**
     * Layout: px rows get exact pixels. % rows share the remainder (totalRowSpace minus sum of px rows).
     * 200px means 200 actual pixels. % values are "of remainder" and sum to 100.
     */
    function getRowHeightsPx(columnIndex, totalHeightPx, gapPx) {
        const col = state.columnRows[columnIndex];
        const heights = col && col.rowHeights;
        const units = (state.columnRowUnits && state.columnRowUnits[columnIndex]) || (heights && heights.map(() => '%')) || [];
        const n = (heights && heights.length) || 0;
        if (n === 0) return [];
        const totalGapY = gapPx * Math.max(0, n - 1);
        const totalRowSpace = Math.max(0, totalHeightPx - totalGapY);
        let pxSum = 0;
        let pctSum = 0;
        for (let i = 0; i < n; i++) {
            const u = units[i] || '%';
            const v = Math.max(0, heights[i] != null ? heights[i] : (u === '%' ? 100 / n : 0));
            if (u === 'px') pxSum += v;
            else pctSum += v;
        }
        const remainder = Math.max(0, totalRowSpace - pxSum);
        return heights.map((h, i) => {
            const u = units[i] || '%';
            const v = Math.max(0, heights[i] != null ? heights[i] : (u === '%' ? 100 / n : 0));
            if (u === 'px') return v;
            return pctSum > 0 ? (v / pctSum) * remainder : (remainder / Math.max(1, n - (pxSum > 0 ? 0 : 1)));
        });
    }

    function getRowHeightActualPx(colIdx) {
        const gapPx = toPx(state.gap);
        return getRowHeightsPx(colIdx, getColumnHeightPx(colIdx), gapPx);
    }

    function getRowHeightDisplayParts(colIdx, rowIdx) {
        const col = state.columnRows[colIdx];
        const heights = col && col.rowHeights;
        const units = (state.columnRowUnits && state.columnRowUnits[colIdx]) || [];
        const unit = (units[rowIdx] || '%');
        const val = (heights && heights[rowIdx]) != null ? heights[rowIdx] : 50;
        const actualPxList = getRowHeightActualPx(colIdx);
        const rowSpace = getColumnRowSpacePx(colIdx);
        const actualPx = (actualPxList[rowIdx] != null ? actualPxList[rowIdx] : 0);
        const sharePct = rowSpace > 0 ? roundPct((actualPx / rowSpace) * 100) : 0;
        if (unit === 'px') {
            return { primary: val + 'px', alternate: rowSpace > 0 ? sharePct + '%' : '' };
        }
        return { primary: roundPct(val) + '%', alternate: rowSpace > 0 ? Math.round(actualPx) + 'px' : '' };
    }

    function setColumnWidth(index, valueStr) {
        const parsed = parseUnitValue(String(valueStr));
        let numVal = parsed ? (parsed.unit === 'px' ? (parsed.value / getColumnTotalWidthPx()) * 100 : Math.min(100, Math.max(0, parsed.value))) : (Number(valueStr) || 0);
        const totalPx = getColumnTotalWidthPx();
        if (parsed && parsed.unit === 'px' && totalPx <= 0) numVal = 0;
        else numVal = Math.max(0, Math.min(100, numVal));
        const locks = state.columnWidthLocks || [];
        const lockedSum = state.columnWidths.reduce((s, v, i) => s + (locks[i] ? v : 0), 0);
        const targetUnlocked = Math.max(0, 100 - lockedSum);

        if (locks[index]) {
            const otherLockedSum = state.columnWidths.reduce((s, v, i) => s + (i !== index && locks[i] ? v : 0), 0);
            const maxAllowed = Math.max(0, 100 - otherLockedSum);
            const newVal = Math.max(0, Math.min(maxAllowed, numVal));
            state.columnWidths[index] = newVal;
            const newLockedSum = state.columnWidths.reduce((s, v, i) => s + (locks[i] ? v : 0), 0);
            const newTargetUnlocked = Math.max(0, 100 - newLockedSum);
            const unlockedIndices = state.columnWidths.map((_, i) => i).filter(i => !locks[i]);
            if (unlockedIndices.length > 0 && newTargetUnlocked > 0) {
                const unlockedVals = unlockedIndices.map(i => state.columnWidths[i]);
                const sum = unlockedVals.reduce((a, b) => a + b, 0);
                const scale = sum > 0 ? newTargetUnlocked / sum : 1 / unlockedIndices.length;
                unlockedIndices.forEach((i, j) => {
                    state.columnWidths[i] = sum > 0 ? unlockedVals[j] * scale : newTargetUnlocked / unlockedIndices.length;
                });
            }
        } else {
            const unlockedIndices = state.columnWidths.map((_, i) => i).filter(i => !locks[i]);
            const unlockedVals = unlockedIndices.map(i => state.columnWidths[i]);
            const changedInUnlocked = unlockedIndices.indexOf(index);
            if (changedInUnlocked === -1) return;
            const newUnlocked = normalizeToSum(unlockedVals, changedInUnlocked, numVal, targetUnlocked);
            unlockedIndices.forEach((i, j) => { state.columnWidths[i] = newUnlocked[j]; });
        }
        syncColumnWidthsFromState(index);
        saveState();
        renderTiles();
    }

    /**
     * Set row height. px = actual pixels (that row gets exactly that height). % = share of remainder.
     * Change px row → only that row updates; % rows get new pixel heights because remainder changed.
     * Change % row → that row updates; other unlocked % rows rescale so % rows still sum to 100.
     */
    function setRowHeight(columnIndex, rowIndex, valueStr) {
        const parsed = parseUnitValue(String(valueStr));
        const col = state.columnRows[columnIndex];
        const locks = (state.columnRowLocks && state.columnRowLocks[columnIndex]) || col.rowHeights.map(() => false);
        const units = (state.columnRowUnits && state.columnRowUnits[columnIndex]) || [];
        const rowHeights = [...col.rowHeights];
        const rowUnits = [...(units.length ? units : rowHeights.map(() => '%'))];
        const rowSpace = getColumnRowSpacePx(columnIndex);

        if (parsed && parsed.unit === 'px') {
            rowUnits[rowIndex] = 'px';
            const otherPxSum = rowHeights.reduce((s, v, i) => s + (i !== rowIndex && (rowUnits[i] || '%') === 'px' ? Math.max(0, v) : 0), 0);
            const maxPx = Math.max(0, rowSpace - otherPxSum);
            rowHeights[rowIndex] = Math.max(0, Math.min(maxPx, parsed.value));
            state.columnRows[columnIndex].rowHeights = rowHeights;
            if (!state.columnRowUnits[columnIndex]) state.columnRowUnits[columnIndex] = [];
            state.columnRowUnits[columnIndex][rowIndex] = 'px';
            state.columnRowUnits[columnIndex].length = rowHeights.length;
            syncRowHeightInputs(columnIndex);
            saveState();
            renderTiles();
            return;
        }

        const numVal = parsed && parsed.unit === '%' ? parsed.value : (Number(valueStr) || 0);
        const pctIndices = rowHeights.map((_, i) => i).filter(i => (rowUnits[i] || '%') === '%');
        const lockedPctSum = pctIndices.reduce((s, i) => s + (locks[i] ? (rowHeights[i] || 0) : 0), 0);
        const targetUnlocked = Math.max(0, 100 - lockedPctSum);

        if (locks[rowIndex]) {
            const otherLockedPctSum = pctIndices.reduce((s, i) => s + (i !== rowIndex && locks[i] ? (rowHeights[i] || 0) : 0), 0);
            const maxAllowed = Math.max(0, 100 - otherLockedPctSum);
            const newVal = Math.max(0, Math.min(maxAllowed, numVal));
            rowHeights[rowIndex] = newVal;
            const newLockedSum = pctIndices.reduce((s, i) => s + (locks[i] ? (rowHeights[i] || 0) : 0), 0);
            const newTargetUnlocked = Math.max(0, 100 - newLockedSum);
            const unlockedPct = pctIndices.filter(i => !locks[i]);
            if (unlockedPct.length > 0 && newTargetUnlocked > 0) {
                const unlockedVals = unlockedPct.map(i => rowHeights[i] || 0);
                const sum = unlockedVals.reduce((a, b) => a + b, 0);
                const scale = sum > 0 ? newTargetUnlocked / sum : 1 / unlockedPct.length;
                unlockedPct.forEach((i, j) => { rowHeights[i] = sum > 0 ? unlockedVals[j] * scale : newTargetUnlocked / unlockedPct.length; });
            }
        } else {
            if (!pctIndices.includes(rowIndex)) return;
            const unlockedPct = pctIndices.filter(i => !locks[i]);
            const changedInUnlocked = unlockedPct.indexOf(rowIndex);
            if (changedInUnlocked === -1) return;
            const unlockedVals = unlockedPct.map(i => rowHeights[i] || 0);
            const newVal = Math.max(0, Math.min(targetUnlocked, numVal));
            const newUnlocked = normalizeToSum(unlockedVals, changedInUnlocked, newVal, targetUnlocked);
            unlockedPct.forEach((i, j) => { rowHeights[i] = newUnlocked[j]; });
        }
        rowUnits[rowIndex] = '%';
        state.columnRows[columnIndex].rowHeights = rowHeights;
        state.columnRowUnits[columnIndex] = rowUnits;
        syncRowHeightInputs(columnIndex);
        saveState();
        renderTiles();
    }

    function syncRowHeightInputs(columnIndex, skipRowIndex) {
        const block = columnRowsContainer.querySelector(`[data-column="${columnIndex}"]`);
        if (!block) return;
        block.querySelectorAll('.tile-settings-row .size-input-wrap').forEach((wrap, i) => {
            if (skipRowIndex !== undefined && i === skipRowIndex) return;
            const input = wrap.querySelector('input');
            const altSpan = wrap.querySelector('.size-input-alt');
            if (!input || !altSpan) return;
            const p = getRowHeightDisplayParts(columnIndex, i);
            input.value = p.primary;
            altSpan.textContent = p.alternate ? ' (' + p.alternate + ')' : '';
        });
    }

    function swapDimensions() {
        const w = Number(canvasWidthEl.value) || state.width;
        const h = Number(canvasHeightEl.value) || state.height;
        state.width = h;
        state.height = w;
        canvasWidthEl.value = state.width;
        canvasHeightEl.value = state.height;
        updateCanvasHint();
        renderTiles();
    }

    function updateCanvasHint() {
        const w = state.width;
        const h = state.height;
        const u = state.unit;
        if (state.layoutMode === 'overlay') {
            canvasHintEl.textContent = u === 'px'
                ? `Canvas: ${w}×${h} px. Loading an image sets this to the image size.`
                : `Canvas: ${w}×${h} cm. Loading an image sets this to the image size.`;
            return;
        }
        canvasHintEl.textContent = u === 'px' ? `Current: ${w}×${h} px` : `Current: ${w}×${h} cm`;
    }

    function applyColumnCount() {
        const n = Math.max(1, Math.min(12, parseInt(columnCountEl.value, 10) || 2));
        state.columnCount = n;
        columnCountEl.value = n;
        const equal = 100 / n;
        state.columnWidths = Array.from({ length: n }, () => equal);
        state.columnWidthLocks = Array.from({ length: n }, (_, i) => state.columnWidthLocks && state.columnWidthLocks[i] === true);
        while (state.columnRows.length < n) {
            state.columnRows.push({ rowCount: 2, rowHeights: [50, 50] });
        }
        state.columnRows.length = n;
        ensureLockArrays();
        saveState();
        renderColumnWidthInputs();
        renderColumnRowsSection();
        renderTiles();
    }

    const lockIconSvg = '<svg class="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" ry="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    const unlockIconSvg = '<svg class="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" ry="2"/><path d="M9 11V7a3 3 0 0 1 6 0"/><path d="M9 11h6"/></svg>';

    function setLockButtonIcon(btn, isLocked) {
        btn.innerHTML = isLocked ? lockIconSvg : unlockIconSvg;
    }

    function makeLockButton(isLocked, toggle) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lock-btn';
        btn.setAttribute('aria-label', isLocked ? 'Unlock' : 'Lock');
        btn.title = isLocked ? 'Unlock (value will participate in auto-adjust)' : 'Lock (value stays fixed)';
        setLockButtonIcon(btn, isLocked);
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            toggle();
        });
        return btn;
    }

    function renderColumnWidthInputs() {
        columnWidthsContainer.innerHTML = '';
        const locks = state.columnWidthLocks || state.columnWidths.map(() => false);
        state.columnWidths.forEach((pct, i) => {
            const row = document.createElement('div');
            row.className = 'column-width-row';
            const label = document.createElement('label');
            label.textContent = `Col ${i + 1}`;
            const wrap = document.createElement('div');
            wrap.className = 'size-input-wrap';
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'e.g. 50% or 400px';
            input.dataset.index = String(i);
            const altSpan = document.createElement('span');
            altSpan.className = 'size-input-alt';
            const partsCol = getColumnWidthDisplayParts(i);
            input.value = partsCol.primary;
            altSpan.textContent = partsCol.alternate ? ' (' + partsCol.alternate + ')' : '';
            input.addEventListener('focus', () => { altSpan.textContent = ''; input.value = formatColumnWidthDisplay(i, true); input.select(); });
            input.addEventListener('blur', () => {
                setColumnWidth(i, input.value);
                const p = getColumnWidthDisplayParts(i);
                input.value = p.primary;
                altSpan.textContent = p.alternate ? ' (' + p.alternate + ')' : '';
            });
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
            wrap.appendChild(input);
            wrap.appendChild(altSpan);
            const lockBtn = makeLockButton(locks[i], () => {
                state.columnWidthLocks[i] = !state.columnWidthLocks[i];
                setLockButtonIcon(lockBtn, state.columnWidthLocks[i]);
                lockBtn.setAttribute('aria-label', state.columnWidthLocks[i] ? 'Unlock' : 'Lock');
                lockBtn.title = state.columnWidthLocks[i] ? 'Unlock (value will participate in auto-adjust)' : 'Lock (value stays fixed)';
                saveState();
            });
            row.appendChild(label);
            row.appendChild(wrap);
            row.appendChild(lockBtn);
            columnWidthsContainer.appendChild(row);
        });
    }

    function syncColumnWidthsFromState(skipIndex) {
        const inputs = columnWidthsContainer.querySelectorAll('.column-width-row .size-input-wrap');
        inputs.forEach((wrap, i) => {
            if (i === skipIndex) return;
            const input = wrap.querySelector('input');
            const altSpan = wrap.querySelector('.size-input-alt');
            if (!input || !altSpan) return;
            const p = getColumnWidthDisplayParts(i);
            input.value = p.primary;
            altSpan.textContent = p.alternate ? ' (' + p.alternate + ')' : '';
        });
    }

    function renderColumnRowsSection() {
        columnRowsContainer.innerHTML = '';
        state.columnRows.forEach((col, colIdx) => {
            const block = document.createElement('div');
            block.className = 'column-rows-block';
            block.dataset.column = String(colIdx);
            const title = document.createElement('h3');
            title.textContent = `Column ${colIdx + 1}`;
            block.appendChild(title);
            const rowCountWrap = document.createElement('div');
            rowCountWrap.className = 'row-count-wrap';
            const rowCountLabel = document.createElement('label');
            rowCountLabel.textContent = 'Tiles';
            const rowCountInput = document.createElement('input');
            rowCountInput.type = 'number';
            rowCountInput.min = 1;
            rowCountInput.max = 24;
            rowCountInput.value = col.rowCount;
            rowCountInput.addEventListener('input', () => {
                const c = Math.max(1, Math.min(24, parseInt(rowCountInput.value, 10) || 1));
                state.columnRows[colIdx].rowCount = c;
                const heights = state.columnRows[colIdx].rowHeights;
                const units = state.columnRowUnits[colIdx] || [];
                if (!state.columnRowUnits[colIdx]) state.columnRowUnits[colIdx] = [];
                while (heights.length < c) {
                    const pctIndices = heights.map((_, i) => i).filter(i => (units[i] || '%') === '%');
                    const pctSum = pctIndices.reduce((s, i) => s + (heights[i] || 0), 0);
                    const defaultNew = 100 / (heights.length + 1);
                    const targetExisting = 100 - defaultNew;
                    if (pctIndices.length > 0 && pctSum > 0 && targetExisting > 0) {
                        const scale = targetExisting / pctSum;
                        pctIndices.forEach(i => { heights[i] = (heights[i] || 0) * scale; });
                    }
                    heights.push(defaultNew);
                    state.columnRowUnits[colIdx][heights.length - 1] = '%';
                }
                heights.length = c;
                state.columnRowUnits[colIdx].length = c;
                const pctIdx = heights.map((_, i) => i).filter(i => (state.columnRowUnits[colIdx][i] || '%') === '%');
                const pctSum = pctIdx.reduce((s, i) => s + (heights[i] || 0), 0);
                if (pctIdx.length > 0 && pctSum > 0 && Math.abs(pctSum - 100) > 0.01) {
                    pctIdx.forEach(i => { heights[i] = ((heights[i] || 0) / pctSum) * 100; });
                }
                ensureLockArrays();
                ensureTileTemplates();
                saveState();
                renderColumnRowsSection();
                renderTiles();
            });
            rowCountWrap.appendChild(rowCountLabel);
            rowCountWrap.appendChild(rowCountInput);
            block.appendChild(rowCountWrap);
            const rowLocks = (state.columnRowLocks && state.columnRowLocks[colIdx]) || col.rowHeights.map(() => false);
            col.rowHeights.forEach((h, rowIdx) => {
                const row = document.createElement('div');
                row.className = 'tile-settings-row';
                const label = document.createElement('label');
                label.textContent = `Tile ${rowIdx + 1}`;
                const wrap = document.createElement('div');
                wrap.className = 'size-input-wrap';
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'size-input';
                input.placeholder = 'e.g. 50% or 200px';
                const altSpan = document.createElement('span');
                altSpan.className = 'size-input-alt';
                const partsRow = getRowHeightDisplayParts(colIdx, rowIdx);
                input.value = partsRow.primary;
                altSpan.textContent = partsRow.alternate ? ' (' + partsRow.alternate + ')' : '';
                input.addEventListener('focus', () => { altSpan.textContent = ''; input.value = formatRowHeightDisplay(colIdx, rowIdx, true); input.select(); });
                input.addEventListener('blur', () => {
                    setRowHeight(colIdx, rowIdx, input.value);
                    const p = getRowHeightDisplayParts(colIdx, rowIdx);
                    input.value = p.primary;
                    altSpan.textContent = p.alternate ? ' (' + p.alternate + ')' : '';
                });
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
                wrap.appendChild(input);
                wrap.appendChild(altSpan);
                const lockBtn = makeLockButton(rowLocks[rowIdx], () => {
                    state.columnRowLocks[colIdx][rowIdx] = !state.columnRowLocks[colIdx][rowIdx];
                    setLockButtonIcon(lockBtn, state.columnRowLocks[colIdx][rowIdx]);
                    lockBtn.setAttribute('aria-label', state.columnRowLocks[colIdx][rowIdx] ? 'Unlock' : 'Lock');
                    lockBtn.title = state.columnRowLocks[colIdx][rowIdx] ? 'Unlock (value will participate in auto-adjust)' : 'Lock (value stays fixed)';
                    saveState();
                });
                const templateSelect = document.createElement('select');
                templateSelect.className = 'tile-template-select';
                templateSelect.innerHTML = '<option value="white">White (blank)</option><option value="green">Green (blank)</option><option value="branch-name">Branch name</option><option value="logo">Logo</option><option value="menu">Menu</option><option value="customization">Customization</option><option value="photo">Photo</option><option value="customer-display">Customer display (embed)</option>';
                const templateVal = (state.tileTemplate && state.tileTemplate[colIdx] && state.tileTemplate[colIdx][rowIdx]) || 'white';
                templateSelect.value = templateVal;
                templateSelect.addEventListener('change', () => {
                    if (!state.tileTemplate[colIdx]) state.tileTemplate[colIdx] = [];
                    state.tileTemplate[colIdx][rowIdx] = templateSelect.value;
                    if (templateSelect.value === 'branch-name' && (!state.tileTemplateProps[colIdx][rowIdx] || !('line1' in state.tileTemplateProps[colIdx][rowIdx]))) {
                        state.tileTemplateProps[colIdx][rowIdx] = { line1: '', line2: '', line1FontSize: 32, line2FontSize: 24 };
                    }
                    if (templateSelect.value === 'menu') {
                        const p = state.tileTemplateProps[colIdx][rowIdx] || {};
                        state.tileTemplateProps[colIdx][rowIdx] = { ...p, category: p.category != null ? p.category : '', categoryTag: (p.categoryTag != null ? p.categoryTag : ''), drinkIds: Array.isArray(p.drinkIds) ? p.drinkIds : [], drinkTags: (p.drinkTags && typeof p.drinkTags === 'object') ? p.drinkTags : {}, drinkTagColors: (p.drinkTagColors && typeof p.drinkTagColors === 'object') ? p.drinkTagColors : {}, hidePrices: Boolean(p.hidePrices) };
                    }
                    if (templateSelect.value === 'photo') {
                        const p = state.tileTemplateProps[colIdx][rowIdx] || {};
                        const { mediaItems, imageUrls, galleryIntervalSeconds } = getGalleryProps(p);
                        state.tileTemplateProps[colIdx][rowIdx] = { ...p, mediaItems, imageUrls, galleryIntervalSeconds };
                    }
                    if (templateSelect.value === 'customization') {
                        const p = state.tileTemplateProps[colIdx][rowIdx] || {};
                        state.tileTemplateProps[colIdx][rowIdx] = { ...p, ...getCustomizationProps(p) };
                    }
                    if (templateSelect.value === 'customer-display') {
                        const p = state.tileTemplateProps[colIdx][rowIdx] || {};
                        state.tileTemplateProps[colIdx][rowIdx] = {
                            ...p,
                            eventKey: typeof p.eventKey === 'string' ? p.eventKey : '',
                            showSettingsButton: Boolean(p.showSettingsButton)
                        };
                    }
                    saveState();
                    renderColumnRowsSection();
                    renderTiles();
                });
                row.appendChild(label);
                row.appendChild(wrap);
                row.appendChild(lockBtn);
                row.appendChild(templateSelect);
                block.appendChild(row);

                if (templateVal === 'branch-name') {
                    const propsPanel = document.createElement('div');
                    propsPanel.className = 'tile-template-props';
                    const branchProps = state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][rowIdx] ? state.tileTemplateProps[colIdx][rowIdx] : { line1: '', line2: '', line1FontSize: 32, line2FontSize: 24 };
                    const line1Label = document.createElement('label');
                    line1Label.textContent = 'Line 1 (e.g. MATCHA BAR)';
                    const line1Input = document.createElement('input');
                    line1Input.type = 'text';
                    line1Input.placeholder = 'MATCHA BAR';
                    line1Input.value = branchProps.line1 || '';
                    line1Input.addEventListener('input', () => {
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = { line1: '', line2: '', line1FontSize: 32, line2FontSize: 24 };
                        state.tileTemplateProps[colIdx][rowIdx].line1 = line1Input.value;
                        saveState();
                        renderTiles();
                    });
                    const line1SizeLabel = document.createElement('label');
                    line1SizeLabel.textContent = 'Line 1 font size (px)';
                    const line1SizeInput = document.createElement('input');
                    line1SizeInput.type = 'number';
                    line1SizeInput.min = '8';
                    line1SizeInput.max = '120';
                    line1SizeInput.value = branchProps.line1FontSize != null ? branchProps.line1FontSize : 32;
                    line1SizeInput.addEventListener('input', () => {
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = { line1: '', line2: '', line1FontSize: 32, line2FontSize: 24 };
                        state.tileTemplateProps[colIdx][rowIdx].line1FontSize = Math.max(8, Math.min(120, Number(line1SizeInput.value) || 32));
                        saveState();
                        renderTiles();
                    });
                    const line2Label = document.createElement('label');
                    line2Label.textContent = 'Line 2 (e.g. MALL OF ASIA)';
                    const line2Input = document.createElement('input');
                    line2Input.type = 'text';
                    line2Input.placeholder = 'MALL OF ASIA';
                    line2Input.value = branchProps.line2 || '';
                    line2Input.addEventListener('input', () => {
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = { line1: '', line2: '', line1FontSize: 32, line2FontSize: 24 };
                        state.tileTemplateProps[colIdx][rowIdx].line2 = line2Input.value;
                        saveState();
                        renderTiles();
                    });
                    const line2SizeLabel = document.createElement('label');
                    line2SizeLabel.textContent = 'Line 2 font size (px)';
                    const line2SizeInput = document.createElement('input');
                    line2SizeInput.type = 'number';
                    line2SizeInput.min = '8';
                    line2SizeInput.max = '120';
                    line2SizeInput.value = branchProps.line2FontSize != null ? branchProps.line2FontSize : 24;
                    line2SizeInput.addEventListener('input', () => {
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = { line1: '', line2: '', line1FontSize: 32, line2FontSize: 24 };
                        state.tileTemplateProps[colIdx][rowIdx].line2FontSize = Math.max(8, Math.min(120, Number(line2SizeInput.value) || 24));
                        saveState();
                        renderTiles();
                    });
                    propsPanel.appendChild(line1Label);
                    propsPanel.appendChild(line1Input);
                    propsPanel.appendChild(line1SizeLabel);
                    propsPanel.appendChild(line1SizeInput);
                    propsPanel.appendChild(line2Label);
                    propsPanel.appendChild(line2Input);
                    propsPanel.appendChild(line2SizeLabel);
                    propsPanel.appendChild(line2SizeInput);
                    block.appendChild(propsPanel);
                }
                if (templateVal === 'menu') {
                    const propsPanel = document.createElement('div');
                    propsPanel.className = 'tile-template-props';
                    const catLabel = document.createElement('label');
                    catLabel.textContent = 'Category';
                    const catSelect = document.createElement('select');
                    catSelect.className = 'menu-props-category';
                    const categories = getUniqueCategories();
                    catSelect.innerHTML = '<option value="">— Select category —</option>' + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
                    const menuProps = (state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][rowIdx]) || {};
                    const currentCategory = (menuProps.category != null ? menuProps.category : '').trim();
                    const currentDrinkIds = Array.isArray(menuProps.drinkIds) ? menuProps.drinkIds : [];
                    const currentDrinkTags = (menuProps.drinkTags && typeof menuProps.drinkTags === 'object') ? menuProps.drinkTags : {};
                    const currentDrinkTagColors = (menuProps.drinkTagColors && typeof menuProps.drinkTagColors === 'object') ? menuProps.drinkTagColors : {};
                    catSelect.value = currentCategory;
                    catSelect.addEventListener('change', () => {
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = { category: '', categoryTag: '', drinkIds: [], drinkTags: {}, drinkTagColors: {} };
                        state.tileTemplateProps[colIdx][rowIdx].category = catSelect.value;
                        state.tileTemplateProps[colIdx][rowIdx].drinkIds = [];
                        state.tileTemplateProps[colIdx][rowIdx].drinkTags = {};
                        state.tileTemplateProps[colIdx][rowIdx].drinkTagColors = {};
                        saveState();
                        renderColumnRowsSection();
                        renderTiles();
                    });
                    propsPanel.appendChild(catLabel);
                    propsPanel.appendChild(catSelect);
                    const currentCategoryTag = (menuProps.categoryTag != null ? menuProps.categoryTag : '').trim();
                    const categoryTagLabel = document.createElement('label');
                    categoryTagLabel.textContent = 'Category header tag';
                    const categoryTagInput = document.createElement('input');
                    categoryTagInput.type = 'text';
                    categoryTagInput.className = 'menu-props-category-tag';
                    categoryTagInput.placeholder = 'e.g. 7PM Onwards Only';
                    categoryTagInput.value = currentCategoryTag;
                    categoryTagInput.addEventListener('input', () => {
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = { category: '', categoryTag: '', drinkIds: [], drinkTags: {}, drinkTagColors: {} };
                        state.tileTemplateProps[colIdx][rowIdx].categoryTag = categoryTagInput.value.trim();
                        saveState();
                        renderTiles();
                    });
                    categoryTagLabel.style.display = 'block';
                    categoryTagLabel.style.marginTop = '0.35rem';
                    propsPanel.appendChild(categoryTagLabel);
                    propsPanel.appendChild(categoryTagInput);
                    const hidePricesLabel = document.createElement('label');
                    hidePricesLabel.className = 'menu-props-hide-prices';
                    hidePricesLabel.style.display = 'flex';
                    hidePricesLabel.style.alignItems = 'center';
                    hidePricesLabel.style.gap = '0.5rem';
                    hidePricesLabel.style.marginTop = '0.35rem';
                    const hidePricesCheck = document.createElement('input');
                    hidePricesCheck.type = 'checkbox';
                    hidePricesCheck.checked = Boolean(menuProps.hidePrices);
                    hidePricesCheck.addEventListener('change', () => {
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = { category: '', categoryTag: '', drinkIds: [], drinkTags: {}, drinkTagColors: {} };
                        state.tileTemplateProps[colIdx][rowIdx].hidePrices = hidePricesCheck.checked;
                        saveState();
                        renderTiles();
                    });
                    hidePricesLabel.appendChild(hidePricesCheck);
                    const hidePricesText = document.createElement('span');
                    hidePricesText.textContent = 'Hide prices';
                    hidePricesLabel.appendChild(hidePricesText);
                    propsPanel.appendChild(hidePricesLabel);
                    const fromCache = currentCategory ? drinksCache.filter(d => (d.category || '').trim() === currentCategory) : [];
                    const fromLoaded = currentCategory ? (loadedMenuDrinks || []).filter(d => d && (d.category || '').trim() === currentCategory) : [];
                    const seenIds = new Set(fromCache.map(d => d.id));
                    const drinksInCategory = fromCache.concat(fromLoaded.filter(d => !seenIds.has(d.id)));

                    const onMenuLabel = document.createElement('label');
                    onMenuLabel.textContent = 'On menu (drag to reorder)';
                    onMenuLabel.style.marginTop = '0.5rem';
                    onMenuLabel.className = 'menu-props-section-label';
                    propsPanel.appendChild(onMenuLabel);
                    const onMenuList = document.createElement('div');
                    onMenuList.className = 'menu-props-on-menu';
                    currentDrinkIds.forEach((id) => {
                        const d = drinksCache.find(x => x.id === id) || loadedMenuDrinks.find(x => x.id === id);
                        if (!d) return;
                        const row = document.createElement('div');
                        row.className = 'menu-props-drink-row';
                        row.draggable = true;
                        row.dataset.drinkId = id;
                        row.setAttribute('aria-label', 'Drag to reorder: ' + (d.name || id));
                        const handle = document.createElement('span');
                        handle.className = 'menu-props-drag-handle';
                        handle.setAttribute('aria-hidden', 'true');
                        handle.textContent = '⋮⋮';
                        const nameSpan = document.createElement('span');
                        nameSpan.className = 'menu-props-drink-name';
                        nameSpan.textContent = d.name || id;
                        const tagCell = document.createElement('span');
                        tagCell.className = 'menu-props-tag-cell';
                        const currentColor = getDrinkTagColorId(currentDrinkTagColors, id);
                        const colorOpt = MENU_TAG_COLOR_OPTIONS.find(o => o.id === currentColor) || MENU_TAG_COLOR_OPTIONS[0];
                        const tagColorTrigger = document.createElement('button');
                        tagColorTrigger.type = 'button';
                        tagColorTrigger.className = 'menu-props-tag-color-trigger menu-props-tag-color-btn ' + colorOpt.class;
                        tagColorTrigger.title = 'Tag color: ' + colorOpt.label;
                        tagColorTrigger.setAttribute('aria-label', 'Tag color: ' + colorOpt.label + '. Click to change.');
                        tagColorTrigger.setAttribute('data-drink-id', id);
                        tagColorTrigger.setAttribute('data-col', String(colIdx));
                        tagColorTrigger.setAttribute('data-row', String(rowIdx));
                        tagColorTrigger.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openTagColorPicker(id, colIdx, rowIdx, saveState, renderTiles, renderColumnRowsSection);
                        });
                        const tagBtn = document.createElement('button');
                        tagBtn.type = 'button';
                        tagBtn.className = 'menu-props-tag-btn';
                        tagBtn.title = 'Add or edit tag';
                        tagBtn.setAttribute('aria-label', 'Add or edit tag');
                        tagBtn.textContent = 'T';
                        const tagInput = document.createElement('input');
                        tagInput.type = 'text';
                        tagInput.className = 'menu-props-tag-input';
                        tagInput.placeholder = 'Tag';
                        tagInput.title = 'Tag (e.g. Best Seller, New!)';
                        tagInput.value = (currentDrinkTags[id] != null ? currentDrinkTags[id] : '');
                        tagInput.style.display = 'none';
                        function showTagInput() {
                            tagBtn.style.display = 'none';
                            tagInput.style.display = '';
                            tagInput.focus();
                            tagInput.select();
                        }
                        function hideTagInput() {
                            const v = tagInput.value.trim();
                            if (!state.tileTemplateProps[colIdx][rowIdx].drinkTags) state.tileTemplateProps[colIdx][rowIdx].drinkTags = {};
                            state.tileTemplateProps[colIdx][rowIdx].drinkTags[id] = v;
                            saveState();
                            renderTiles();
                            tagInput.style.display = 'none';
                            tagBtn.style.display = '';
                        }
                        tagBtn.addEventListener('click', (e) => { e.preventDefault(); showTagInput(); });
                        tagInput.addEventListener('blur', hideTagInput);
                        tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tagInput.blur(); } });
                        tagCell.appendChild(tagColorTrigger);
                        tagCell.appendChild(tagBtn);
                        tagCell.appendChild(tagInput);
                        const removeBtn = document.createElement('button');
                        removeBtn.type = 'button';
                        removeBtn.className = 'menu-props-remove-btn';
                        removeBtn.title = 'Remove from menu';
                        removeBtn.setAttribute('aria-label', 'Remove from menu');
                        removeBtn.textContent = '×';
                        removeBtn.addEventListener('click', (e) => {
                            e.preventDefault();
                            const ids = (state.tileTemplateProps[colIdx][rowIdx].drinkIds || []).filter(x => x !== id);
                            state.tileTemplateProps[colIdx][rowIdx].drinkIds = ids;
                            const tags = state.tileTemplateProps[colIdx][rowIdx].drinkTags || {};
                            delete tags[id];
                            const colors = state.tileTemplateProps[colIdx][rowIdx].drinkTagColors || {};
                            delete colors[id];
                            saveState();
                            renderColumnRowsSection();
                            renderTiles();
                        });
                        row.appendChild(handle);
                        row.appendChild(nameSpan);
                        row.appendChild(tagCell);
                        row.appendChild(removeBtn);
                        onMenuList.appendChild(row);
                    });
                    onMenuList.addEventListener('dragstart', (e) => {
                        if (e.target.closest('input, .menu-props-remove-btn, .menu-props-tag-btn, .menu-props-tag-color-btn')) return;
                        const row = e.target.closest('.menu-props-drink-row');
                        if (!row) return;
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', row.dataset.drinkId || '');
                        row.classList.add('menu-props-dragging');
                    });
                    onMenuList.addEventListener('dragend', (e) => {
                        const row = e.target.closest('.menu-props-drink-row');
                        if (row) row.classList.remove('menu-props-dragging');
                        onMenuList.querySelectorAll('.menu-props-drag-over').forEach(el => el.classList.remove('menu-props-drag-over'));
                    });
                    onMenuList.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        const row = e.target.closest('.menu-props-drink-row');
                        onMenuList.querySelectorAll('.menu-props-drink-row').forEach(r => r.classList.remove('menu-props-drag-over'));
                        if (row) row.classList.add('menu-props-drag-over');
                    });
                    onMenuList.addEventListener('drop', (e) => {
                        e.preventDefault();
                        const row = e.target.closest('.menu-props-drink-row');
                        if (!row) return;
                        row.classList.remove('menu-props-drag-over');
                        const draggedId = e.dataTransfer.getData('text/plain');
                        if (!draggedId) return;
                        const ids = state.tileTemplateProps[colIdx][rowIdx].drinkIds || [];
                        const fromIdx = ids.indexOf(draggedId);
                        const toIdx = Array.from(onMenuList.querySelectorAll('.menu-props-drink-row')).indexOf(row);
                        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
                        ids.splice(fromIdx, 1);
                        ids.splice(toIdx, 0, draggedId);
                        state.tileTemplateProps[colIdx][rowIdx].drinkIds = ids;
                        saveState();
                        renderColumnRowsSection();
                        renderTiles();
                    });
                    propsPanel.appendChild(onMenuList);

                    const addLabel = document.createElement('label');
                    addLabel.textContent = 'Add drink';
                    addLabel.className = 'menu-props-section-label';
                    addLabel.style.marginTop = '0.5rem';
                    propsPanel.appendChild(addLabel);
                    const addSelect = document.createElement('select');
                    addSelect.className = 'menu-props-add-select';
                    const notOnMenu = drinksInCategory.filter(d => currentDrinkIds.indexOf(d.id) === -1);
                    addSelect.innerHTML = '<option value="">— Add drink —</option>' + notOnMenu.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name || d.id)}</option>`).join('');
                    addSelect.addEventListener('change', () => {
                        const id = addSelect.value;
                        if (!id) return;
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = { category: '', categoryTag: '', drinkIds: [], drinkTags: {}, drinkTagColors: {} };
                        state.tileTemplateProps[colIdx][rowIdx].drinkIds = (state.tileTemplateProps[colIdx][rowIdx].drinkIds || []).concat(id);
                        saveState();
                        renderColumnRowsSection();
                        renderTiles();
                        addSelect.value = '';
                    });
                    propsPanel.appendChild(addSelect);
                    if (drinksInCategory.length === 0) {
                        const hint = document.createElement('span');
                        hint.className = 'form-hint';
                        hint.textContent = 'Select a category first.';
                        hint.style.marginTop = '0.25rem';
                        propsPanel.appendChild(hint);
                    }
                    block.appendChild(propsPanel);
                }
                if (templateVal === 'photo') {
                    const propsPanel = document.createElement('div');
                    propsPanel.className = 'tile-template-props';
                    if (!state.tileTemplateProps[colIdx][rowIdx]) {
                        state.tileTemplateProps[colIdx][rowIdx] = { mediaItems: [], imageUrls: [], galleryIntervalSeconds: 3 };
                    }
                    appendPhotoGalleryEditor(propsPanel, {
                        uploadKey: `${colIdx}-${rowIdx}`,
                        uploadPathPrefix: `menu-creator-photos/tile-${colIdx}-${rowIdx}`,
                        getProps: () => {
                            if (!state.tileTemplateProps[colIdx][rowIdx]) {
                                state.tileTemplateProps[colIdx][rowIdx] = { mediaItems: [], imageUrls: [], galleryIntervalSeconds: 3 };
                            }
                            return state.tileTemplateProps[colIdx][rowIdx];
                        },
                        onCanvasChanged: () => renderTiles(),
                        onControlsChanged: () => renderColumnRowsSection()
                    });
                    block.appendChild(propsPanel);
                }
                if (templateVal === 'customization') {
                    const propsPanel = document.createElement('div');
                    propsPanel.className = 'tile-template-props';
                    const customProps = getCustomizationProps((state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][rowIdx]) || {});
                    if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = {};
                    const hidePricesOnTile = Boolean((state.tileTemplateProps[colIdx][rowIdx] || {}).hidePrices);
                    state.tileTemplateProps[colIdx][rowIdx] = { ...state.tileTemplateProps[colIdx][rowIdx], ...customProps, hidePrices: hidePricesOnTile };

                    const hidePricesCustomLabel = document.createElement('label');
                    hidePricesCustomLabel.className = 'menu-props-hide-prices';
                    hidePricesCustomLabel.style.display = 'flex';
                    hidePricesCustomLabel.style.alignItems = 'center';
                    hidePricesCustomLabel.style.gap = '0.5rem';
                    hidePricesCustomLabel.style.marginBottom = '0.35rem';
                    const hidePricesCustomCheck = document.createElement('input');
                    hidePricesCustomCheck.type = 'checkbox';
                    hidePricesCustomCheck.checked = hidePricesOnTile;
                    hidePricesCustomCheck.addEventListener('change', () => {
                        state.tileTemplateProps[colIdx][rowIdx].hidePrices = hidePricesCustomCheck.checked;
                        saveState();
                        renderTiles();
                    });
                    hidePricesCustomLabel.appendChild(hidePricesCustomCheck);
                    const hidePricesCustomText = document.createElement('span');
                    hidePricesCustomText.textContent = 'Hide prices';
                    hidePricesCustomLabel.appendChild(hidePricesCustomText);
                    propsPanel.appendChild(hidePricesCustomLabel);

                    const addNumberInput = (labelText, key, min = 0) => {
                        const label = document.createElement('label');
                        label.textContent = labelText;
                        const input = document.createElement('input');
                        input.type = 'number';
                        input.min = String(min);
                        input.step = '1';
                        input.value = String(customProps[key]);
                        input.addEventListener('input', () => {
                            const value = Math.max(min, Number(input.value) || 0);
                            state.tileTemplateProps[colIdx][rowIdx][key] = value;
                            saveState();
                            renderTiles();
                        });
                        propsPanel.appendChild(label);
                        propsPanel.appendChild(input);
                    };

                    addNumberInput('Level 2 price', 'level2Price');
                    addNumberInput('Level 3 price', 'level3Price');
                    addNumberInput('Main header font size (px)', 'titleFontSize', 8);
                    addNumberInput('Subheader font size (px)', 'subtitleFontSize', 8);

                    const defaultMilkLabel = document.createElement('label');
                    defaultMilkLabel.textContent = 'Default milk';
                    const defaultMilkSelect = document.createElement('select');
                    defaultMilkSelect.innerHTML = '<option value="dairy">Dairy</option><option value="oat">Oat</option>';
                    defaultMilkSelect.value = customProps.defaultMilk;
                    defaultMilkSelect.addEventListener('change', () => {
                        state.tileTemplateProps[colIdx][rowIdx].defaultMilk = defaultMilkSelect.value === 'oat' ? 'oat' : 'dairy';
                        saveState();
                        renderTiles();
                    });
                    propsPanel.appendChild(defaultMilkLabel);
                    propsPanel.appendChild(defaultMilkSelect);

                    addNumberInput('Dairy milk price (0 = FREE)', 'dairyPrice');
                    addNumberInput('Oat milk price (0 = FREE)', 'oatPrice');

                    addNumberInput('Strength panel height', 'strengthPanelHeight', 1);
                    addNumberInput('Sweetness panel height', 'sweetnessPanelHeight', 1);
                    addNumberInput('Dairy panel height', 'dairyPanelHeight', 1);
                    addNumberInput('Oat panel height', 'oatPanelHeight', 1);

                    const hint = document.createElement('span');
                    hint.className = 'form-hint';
                    hint.textContent = 'Panel heights are relative weights.';
                    propsPanel.appendChild(hint);
                    block.appendChild(propsPanel);
                }
                if (templateVal === 'customer-display') {
                    const propsPanel = document.createElement('div');
                    propsPanel.className = 'tile-template-props';
                    const displayProps = (state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][rowIdx]) || {};

                    const eventLabel = document.createElement('label');
                    eventLabel.textContent = 'POS event';
                    const eventSelect = document.createElement('select');
                    const selectedEvent = (displayProps.eventKey || '').trim();
                    eventSelect.innerHTML = buildPosEventDropdownHtml(selectedEvent);
                    eventSelect.value = selectedEvent;
                    if (!activeEventKeysLoaded) ensureActiveEventKeysLoaded();
                    eventSelect.addEventListener('change', () => {
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = {};
                        state.tileTemplateProps[colIdx][rowIdx].eventKey = eventSelect.value.trim();
                        saveState();
                        renderTiles();
                    });
                    const refreshEventsBtn = document.createElement('button');
                    refreshEventsBtn.type = 'button';
                    refreshEventsBtn.className = 'btn btn-secondary';
                    refreshEventsBtn.textContent = 'Refresh';
                    refreshEventsBtn.title = 'Reload POS event list from Firebase';
                    refreshEventsBtn.addEventListener('click', (ev) => {
                        ev.preventDefault();
                        activeEventKeysLoaded = false;
                        loadActiveEventKeys({ force: true }).then(() => renderColumnRowsSection());
                    });
                    const eventSelectRow = document.createElement('div');
                    eventSelectRow.style.display = 'flex';
                    eventSelectRow.style.gap = '0.5rem';
                    eventSelectRow.style.alignItems = 'center';
                    eventSelectRow.style.flexWrap = 'wrap';
                    eventSelect.style.flex = '1';
                    eventSelect.style.minWidth = '8rem';
                    eventSelectRow.appendChild(eventSelect);
                    eventSelectRow.appendChild(refreshEventsBtn);

                    const showSettingsWrap = document.createElement('label');
                    showSettingsWrap.className = 'menu-save-new-toggle';
                    const showSettingsInput = document.createElement('input');
                    showSettingsInput.type = 'checkbox';
                    showSettingsInput.checked = Boolean(displayProps.showSettingsButton);
                    showSettingsInput.addEventListener('change', () => {
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = {};
                        state.tileTemplateProps[colIdx][rowIdx].showSettingsButton = showSettingsInput.checked;
                        saveState();
                        renderTiles();
                    });
                    const showSettingsText = document.createElement('span');
                    showSettingsText.textContent = 'Show settings button in embed';
                    showSettingsWrap.appendChild(showSettingsInput);
                    showSettingsWrap.appendChild(showSettingsText);

                    const hint = document.createElement('span');
                    hint.className = 'form-hint';
                    const posHint = posEventDropdownHint();
                    hint.textContent = posHint
                        ? posHint
                        : 'This embeds ../pos/customer-display.html so updates happen in one source only.';

                    propsPanel.appendChild(eventLabel);
                    propsPanel.appendChild(eventSelectRow);
                    propsPanel.appendChild(showSettingsWrap);
                    propsPanel.appendChild(hint);
                    block.appendChild(propsPanel);
                }
            });
            columnRowsContainer.appendChild(block);
        });
    }

    function exitFullscreenPreview() {
        if (!fullscreenPreviewActive) return;
        fullscreenPreviewActive = false;
        document.body.classList.remove('fullscreen-preview');
        if (fullscreenPreviewBtnEl) fullscreenPreviewBtnEl.textContent = 'Full screen preview';
        if (fullscreenPreviewEscHandler) {
            document.removeEventListener('keydown', fullscreenPreviewEscHandler);
            fullscreenPreviewEscHandler = null;
        }
        setTimeout(() => fitCanvasToPreview(), 50);
    }

    function toggleFullscreenPreview() {
        fullscreenPreviewActive = !fullscreenPreviewActive;
        document.body.classList.toggle('fullscreen-preview', fullscreenPreviewActive);
        if (fullscreenPreviewBtnEl) {
            fullscreenPreviewBtnEl.textContent = fullscreenPreviewActive ? 'Exit preview' : 'Full screen preview';
        }
        setTimeout(() => fitCanvasToPreview(), 50);
        if (fullscreenPreviewActive) {
            fullscreenPreviewEscHandler = (e) => {
                if (e.key === 'Escape') exitFullscreenPreview();
            };
            document.addEventListener('keydown', fullscreenPreviewEscHandler);
        } else if (fullscreenPreviewEscHandler) {
            document.removeEventListener('keydown', fullscreenPreviewEscHandler);
            fullscreenPreviewEscHandler = null;
        }
    }

    function isOverlayEditorActive() {
        return state.layoutMode === 'overlay' && !VIEWER_MODE && !fullscreenPreviewActive;
    }

    function getPreviewTotalScale() {
        if (!previewWrapEl) return 1;
        const { w, h } = getCanvasDimensions();
        const wrapW = previewWrapEl.clientWidth;
        const wrapH = previewWrapEl.clientHeight;
        if (wrapW <= 0 || wrapH <= 0 || w <= 0 || h <= 0) return 1;
        const rot = normalizeViewRotationDeg(viewRotationDeg);
        const fitW = (rot === 90 || rot === 270) ? h : w;
        const fitH = (rot === 90 || rot === 270) ? w : h;
        let scale = Math.min(wrapW / fitW, wrapH / fitH);
        if (!fullscreenPreviewActive) scale = Math.min(scale, 1);
        const interactionZoom = isPreviewZoomEnabled() ? previewZoom : 1;
        return scale * interactionZoom;
    }

    function clientToCanvasPoint(clientX, clientY) {
        const { w, h } = getCanvasDimensions();
        const rot = normalizeViewRotationDeg(viewRotationDeg);
        const totalScale = getPreviewTotalScale();
        if (!canvasFitWrapperEl || w <= 0 || h <= 0 || totalScale <= 0) return { x: 0, y: 0 };
        const wrapperRect = canvasFitWrapperEl.getBoundingClientRect();
        const cx = wrapperRect.left + wrapperRect.width / 2;
        const cy = wrapperRect.top + wrapperRect.height / 2;
        const dx = (clientX - cx) / totalScale;
        const dy = (clientY - cy) / totalScale;
        const rad = -rot * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        return {
            x: dx * cos - dy * sin + w / 2,
            y: dx * sin + dy * cos + h / 2
        };
    }

    function clientToOverlayStagePoint(clientX, clientY) {
        const p = clientToCanvasPoint(clientX, clientY);
        return {
            x: p.x - overlayStageLayout.left,
            y: p.y - overlayStageLayout.top
        };
    }

    function getOverlayStageLayout(canvasW, canvasH) {
        const iw = Number(state.overlay && state.overlay.imageNaturalWidth) || 0;
        const ih = Number(state.overlay && state.overlay.imageNaturalHeight) || 0;
        if (!state.overlay || !state.overlay.imageUrl || iw <= 0 || ih <= 0) {
            return { left: 0, top: 0, width: canvasW, height: canvasH };
        }
        const scale = Math.min(canvasW / iw, canvasH / ih);
        const width = iw * scale;
        const height = ih * scale;
        return {
            left: (canvasW - width) / 2,
            top: (canvasH - height) / 2,
            width,
            height
        };
    }

    function applyOverlayStageLayout(layout) {
        overlayStageLayout = layout;
        if (!overlayStageEl) return;
        overlayStageEl.style.left = layout.left + 'px';
        overlayStageEl.style.top = layout.top + 'px';
        overlayStageEl.style.width = layout.width + 'px';
        overlayStageEl.style.height = layout.height + 'px';
    }

    function applyOverlayModuleStyle(el, mod) {
        el.style.left = mod.x + '%';
        el.style.top = mod.y + '%';
        el.style.width = mod.w + '%';
        el.style.height = mod.h + '%';
        el.style.setProperty('--overlay-module-radius', getOverlayBorderRadius(mod) + 'px');
        if (!overlayInteract) postOverlayDisplayStyle(el, mod);
    }

    function overlayModToPx(mod, stageW, stageH) {
        return {
            x: (mod.x / 100) * stageW,
            y: (mod.y / 100) * stageH,
            w: (mod.w / 100) * stageW,
            h: (mod.h / 100) * stageH
        };
    }

    function applyResizeFromStart(startRect, handle, dx, dy, stageW, stageH) {
        let x = startRect.x;
        let y = startRect.y;
        let w = startRect.w;
        let h = startRect.h;
        const minW = OVERLAY_MIN_PX;
        const minH = OVERLAY_MIN_PX;
        const right = startRect.x + startRect.w;
        const bottom = startRect.y + startRect.h;
        if (handle.indexOf('e') !== -1) {
            w = Math.max(minW, Math.min(stageW - startRect.x, startRect.w + dx));
        }
        if (handle.indexOf('s') !== -1) {
            h = Math.max(minH, Math.min(stageH - startRect.y, startRect.h + dy));
        }
        if (handle.indexOf('w') !== -1) {
            x = Math.max(0, Math.min(right - minW, startRect.x + dx));
            w = right - x;
        }
        if (handle.indexOf('n') !== -1) {
            y = Math.max(0, Math.min(bottom - minH, startRect.y + dy));
            h = bottom - y;
        }
        return { x, y, w, h };
    }

    function getOverlayModuleIframeSrc(mod, opts) {
        const props = (mod && mod.props) || {};
        const params = new URLSearchParams();
        if (props.eventKey) params.set('event', props.eventKey);
        params.set('embedded', '1');
        if (!props.showSettingsButton) params.set('hideSettings', '1');
        if (!opts || opts.includeStyle !== false) {
            params.set('radius', String(getOverlayBorderRadius(mod)));
            params.set('scale', String(getOverlayContentScale(mod)));
        }
        // Bust HTML/asset cache when customer-display greeting/UI updates.
        params.set('v', 'greeting-fix-2');
        const query = params.toString();
        return '../pos/customer-display.html' + (query ? '?' + query : '');
    }

    function getOverlayModuleIframeIdentity(mod) {
        return getOverlayModuleIframeSrc(mod, { includeStyle: false });
    }

    function getOverlayModuleContentIdentity(mod) {
        if (mod && mod.type === 'photo') {
            const gallery = getGalleryProps(mod.props);
            return JSON.stringify({
                t: 'photo',
                media: gallery.mediaItems,
                interval: gallery.galleryIntervalSeconds,
                takeover: Boolean(mod.props && mod.props.useAsCustomerDisplay),
                event: ((mod.props && mod.props.customerDisplayEventKey) || '').trim()
            });
        }
        return getOverlayModuleIframeIdentity(mod);
    }

    function fillOverlayModuleContent(el, mod) {
        const content = el.querySelector('.overlay-module-content');
        if (!content) return;
        content.innerHTML = '';
        content.classList.toggle('overlay-module-photo', mod.type === 'photo');
        if (mod.type === 'photo') {
            content.innerHTML = buildPhotoModuleHtml(mod.props || {}, { overlayMod: mod });
            const iframe = content.querySelector('iframe');
            if (iframe) {
                iframe.addEventListener('load', () => {
                    const current = (state.overlay.modules || []).find((m) => m.id === mod.id) || mod;
                    postOverlayDisplayStyle(el, current);
                });
            }
            return;
        }
        const iframe = document.createElement('iframe');
        iframe.className = 'tile-customer-display-iframe';
        iframe.loading = 'lazy';
        iframe.referrerPolicy = 'no-referrer';
        iframe.src = getOverlayModuleIframeSrc(mod);
        iframe.dataset.identitySrc = getOverlayModuleIframeIdentity(mod);
        iframe.addEventListener('load', () => {
            const current = (state.overlay.modules || []).find((m) => m.id === mod.id) || mod;
            postOverlayDisplayStyle(el, current);
        });
        const wrap = document.createElement('div');
        wrap.className = 'tile-customer-display-wrap';
        wrap.appendChild(iframe);
        content.appendChild(wrap);
    }

    function createOverlayModuleElement(mod) {
        const el = document.createElement('div');
        el.className = 'overlay-module';
        el.dataset.id = mod.id;
        applyOverlayModuleStyle(el, mod);
        const content = document.createElement('div');
        content.className = 'overlay-module-content';
        el.appendChild(content);
        fillOverlayModuleContent(el, mod);
        el.dataset.contentIdentity = getOverlayModuleContentIdentity(mod);
        const hit = document.createElement('div');
        hit.className = 'overlay-module-hit';
        const gizmo = document.createElement('div');
        gizmo.className = 'overlay-gizmo';
        OVERLAY_HANDLES.forEach((name) => {
            const handle = document.createElement('span');
            handle.className = 'overlay-handle';
            handle.dataset.handle = name;
            gizmo.appendChild(handle);
        });
        el.appendChild(hit);
        el.appendChild(gizmo);
        return el;
    }

    function updateOverlaySelectionUi() {
        if (!overlayModulesEl) return;
        const selectedId = state.overlay && state.overlay.selectedId;
        const showChrome = isOverlayEditorActive();
        overlayModulesEl.querySelectorAll('.overlay-module').forEach((el) => {
            el.classList.toggle('is-selected', showChrome && el.dataset.id === selectedId);
        });
        if (overlayModuleListEl) {
            overlayModuleListEl.querySelectorAll('.overlay-module-list-item').forEach((el) => {
                el.classList.toggle('is-selected', el.dataset.id === selectedId);
            });
        }
    }

    function syncOverlayModuleElements() {
        if (!overlayModulesEl) return;
        const existing = new Map();
        overlayModulesEl.querySelectorAll('.overlay-module').forEach((el) => {
            existing.set(el.dataset.id, el);
        });
        const keep = new Set();
        (state.overlay.modules || []).forEach((mod) => {
            keep.add(mod.id);
            let el = existing.get(mod.id);
            if (!el) {
                el = createOverlayModuleElement(mod);
                overlayModulesEl.appendChild(el);
            } else {
                applyOverlayModuleStyle(el, mod);
                const identity = getOverlayModuleContentIdentity(mod);
                if (el.dataset.contentIdentity !== identity) {
                    el.dataset.contentIdentity = identity;
                    fillOverlayModuleContent(el, mod);
                } else if (mod.type === 'customer-display') {
                    const iframe = el.querySelector('iframe');
                    const iframeIdentity = getOverlayModuleIframeIdentity(mod);
                    if (iframe && iframe.dataset.identitySrc !== iframeIdentity) {
                        iframe.dataset.identitySrc = iframeIdentity;
                        iframe.src = getOverlayModuleIframeSrc(mod);
                    }
                }
            }
        });
        existing.forEach((el, id) => {
            if (!keep.has(id)) el.remove();
        });
        updateOverlaySelectionUi();
        if (state.layoutMode === 'overlay') {
            clearPhotoRuntimes();
            bindPhotoRuntimes(overlayModulesEl);
        }
    }

    function setOverlayBgStatus(text) {
        if (overlayBgStatusEl) overlayBgStatusEl.textContent = text || '';
    }

    function updateOverlayBgThumb() {
        const url = state.overlay && state.overlay.imageUrl;
        if (overlayBgThumbEl) {
            if (url) {
                overlayBgThumbEl.src = url;
                overlayBgThumbEl.hidden = false;
            } else {
                overlayBgThumbEl.removeAttribute('src');
                overlayBgThumbEl.hidden = true;
            }
        }
        if (overlayBgEmptyHintEl) overlayBgEmptyHintEl.hidden = Boolean(url);
    }

    function applyImageSizeToCanvas(nw, nh) {
        if (!(nw > 0 && nh > 0)) return;
        if (state.unit === 'cm') {
            state.width = Math.round((nw / CM_TO_PX) * 100) / 100;
            state.height = Math.round((nh / CM_TO_PX) * 100) / 100;
        } else {
            state.width = nw;
            state.height = nh;
        }
        state.orientation = nw >= nh ? 'landscape' : 'portrait';
        if (orientationEl) orientationEl.value = state.orientation;
        if (canvasWidthEl) canvasWidthEl.value = state.width;
        if (canvasHeightEl) canvasHeightEl.value = state.height;
        updateCanvasHint();
    }

    function loadImageNaturalSize(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => reject(new Error('Could not read image size'));
            img.src = url;
        });
    }

    async function applyOverlayBackgroundUrl(url) {
        ensureOverlayState();
        let nw = 0;
        let nh = 0;
        try {
            const size = await loadImageNaturalSize(url);
            nw = size.w;
            nh = size.h;
        } catch (e) { /* keep zeros */ }
        state.overlay.imageUrl = url;
        state.overlay.imageNaturalWidth = nw;
        state.overlay.imageNaturalHeight = nh;
        if (nw > 0 && nh > 0) applyImageSizeToCanvas(nw, nh);
        saveState();
        setOverlayBgStatus(nw ? (nw + '×' + nh + ' px') : 'Image loaded.');
        updateOverlayBgThumb();
        renderOverlayCanvas();
    }

    async function uploadOverlayBackground(file) {
        if (!file) return;
        overlayImageUploading = true;
        setOverlayBgStatus('Uploading…');
        if (overlayBgPickBtnEl) overlayBgPickBtnEl.disabled = true;
        try {
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
            const path = `menu-creator-photos/overlay-bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const ref = storageRef(storage, path);
            await uploadBytes(ref, file);
            const url = await getDownloadURL(ref);
            await applyOverlayBackgroundUrl(url);
        } catch (err) {
            console.error('Overlay image upload failed:', err);
            const url = await new Promise((res) => {
                const reader = new FileReader();
                reader.onload = () => res(reader.result);
                reader.readAsDataURL(file);
            });
            await applyOverlayBackgroundUrl(url);
        } finally {
            overlayImageUploading = false;
            if (overlayBgPickBtnEl) overlayBgPickBtnEl.disabled = false;
        }
    }

    function removeOverlayBackground() {
        ensureOverlayState();
        state.overlay.imageUrl = '';
        state.overlay.imageNaturalWidth = 0;
        state.overlay.imageNaturalHeight = 0;
        saveState();
        setOverlayBgStatus('');
        updateOverlayBgThumb();
        renderOverlayCanvas();
    }

    function addOverlayModule(type) {
        ensureOverlayState();
        const resolvedType = type === 'photo' ? 'photo' : 'customer-display';
        const count = state.overlay.modules.length;
        const offset = (count % 5) * 4;
        const mod = normalizeOverlayModule({
            id: newOverlayId(),
            type: resolvedType,
            x: 32 + offset,
            y: 24 + offset,
            w: resolvedType === 'photo' ? 40 : 36,
            h: resolvedType === 'photo' ? 40 : 50,
            props: getDefaultOverlayModuleProps(resolvedType)
        });
        state.overlay.modules.push(mod);
        state.overlay.selectedId = mod.id;
        saveState();
        renderOverlayPanel();
        renderOverlayCanvas();
    }

    function deleteOverlayModule(id) {
        ensureOverlayState();
        state.overlay.modules = state.overlay.modules.filter((m) => m.id !== id);
        if (state.overlay.selectedId === id) state.overlay.selectedId = '';
        saveState();
        renderOverlayPanel();
        renderOverlayCanvas();
    }

    function deleteSelectedOverlayModule() {
        if (!state.overlay || !state.overlay.selectedId) return;
        deleteOverlayModule(state.overlay.selectedId);
    }

    function selectOverlayModule(id, opts) {
        ensureOverlayState();
        const nextId = id || '';
        const skipPanel = opts && opts.skipPanel;
        if (state.overlay.selectedId !== nextId) {
            state.overlay.selectedId = nextId;
            saveState();
            if (!skipPanel) renderOverlaySelectedProps();
            renderOverlayModuleList();
        }
        updateOverlaySelectionUi();
    }

    function getSelectedOverlayModule() {
        ensureOverlayState();
        return state.overlay.modules.find((m) => m.id === state.overlay.selectedId) || null;
    }

    function renderOverlayModuleList() {
        if (!overlayModuleListEl) return;
        ensureOverlayState();
        overlayModuleListEl.innerHTML = '';
        if (state.overlay.modules.length === 0) return;
        const counts = {};
        state.overlay.modules.forEach((mod) => {
            counts[mod.type] = (counts[mod.type] || 0) + 1;
            const n = counts[mod.type];
            const row = document.createElement('div');
            row.className = 'overlay-module-list-item' + (mod.id === state.overlay.selectedId ? ' is-selected' : '');
            row.dataset.id = mod.id;
            const label = document.createElement('span');
            label.textContent = overlayModuleLabel(mod.type) + (n > 1 || state.overlay.modules.length > 1 ? ' ' + n : '');
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn btn-secondary';
            delBtn.textContent = 'Remove';
            delBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                deleteOverlayModule(mod.id);
            });
            row.appendChild(label);
            row.appendChild(delBtn);
            row.addEventListener('click', () => selectOverlayModule(mod.id));
            overlayModuleListEl.appendChild(row);
        });
    }

    function renderOverlaySelectedProps() {
        if (!overlaySelectedPropsEl) return;
        overlaySelectedPropsEl.innerHTML = '';
        if (state.layoutMode !== 'overlay') return;
        const mod = getSelectedOverlayModule();
        if (!mod) {
            const hint = document.createElement('p');
            hint.className = 'form-hint';
            hint.textContent = state.overlay.modules.length
                ? 'Select a module on the image to edit it.'
                : 'Add a gallery or customer display, then drag and resize it on the image.';
            overlaySelectedPropsEl.appendChild(hint);
            return;
        }

        const propsPanel = document.createElement('div');
        propsPanel.className = 'tile-template-props';

        const sizeTitle = document.createElement('label');
        sizeTitle.textContent = 'Position & size (%)';
        propsPanel.appendChild(sizeTitle);
        const sizeGrid = document.createElement('div');
        sizeGrid.className = 'overlay-size-row';
        [
            ['X', 'x'],
            ['Y', 'y'],
            ['Width', 'w'],
            ['Height', 'h']
        ].forEach(([labelText, key]) => {
            const group = document.createElement('div');
            group.className = 'form-group';
            const lab = document.createElement('label');
            lab.textContent = labelText;
            const input = document.createElement('input');
            input.type = 'number';
            input.min = key === 'w' || key === 'h' ? '4' : '0';
            input.max = '100';
            input.step = '0.1';
            input.value = String(Math.round(mod[key] * 10) / 10);
            input.dataset.overlaySizeKey = key;
            input.addEventListener('change', () => {
                const current = getSelectedOverlayModule();
                if (!current) return;
                const raw = Number(input.value);
                if (key === 'w' || key === 'h') current[key] = clampNumber(raw, 4, 100);
                else current[key] = clampNumber(raw, 0, 100);
                if (current.x + current.w > 100) current.x = Math.max(0, 100 - current.w);
                if (current.y + current.h > 100) current.y = Math.max(0, 100 - current.h);
                saveState();
                const el = overlayModulesEl && overlayModulesEl.querySelector('.overlay-module[data-id="' + current.id + '"]');
                if (el) applyOverlayModuleStyle(el, current);
            });
            group.appendChild(lab);
            group.appendChild(input);
            sizeGrid.appendChild(group);
        });
        propsPanel.appendChild(sizeGrid);

        const radiusLabel = document.createElement('label');
        radiusLabel.textContent = 'Corner radius';
        const radiusRow = document.createElement('div');
        radiusRow.className = 'overlay-radius-row';
        const radiusRange = document.createElement('input');
        radiusRange.type = 'range';
        radiusRange.min = '0';
        radiusRange.max = '48';
        radiusRange.step = '1';
        radiusRange.value = String(getOverlayBorderRadius(mod));
        const radiusInput = document.createElement('input');
        radiusInput.type = 'number';
        radiusInput.min = '0';
        radiusInput.max = '80';
        radiusInput.step = '1';
        radiusInput.value = String(getOverlayBorderRadius(mod));
        const radiusUnit = document.createElement('span');
        radiusUnit.className = 'form-hint';
        radiusUnit.textContent = 'px';
        const applyRadius = (raw, persist) => {
            const current = getSelectedOverlayModule();
            if (!current) return;
            current.props.borderRadius = clampNumber(raw, 0, 80);
            radiusRange.value = String(current.props.borderRadius);
            radiusInput.value = String(current.props.borderRadius);
            const el = overlayModulesEl && overlayModulesEl.querySelector('.overlay-module[data-id="' + current.id + '"]');
            if (el) applyOverlayModuleStyle(el, current);
            if (persist) saveState();
        };
        radiusRange.addEventListener('input', () => applyRadius(radiusRange.value, false));
        radiusRange.addEventListener('change', () => applyRadius(radiusRange.value, true));
        radiusInput.addEventListener('input', () => applyRadius(radiusInput.value, false));
        radiusInput.addEventListener('change', () => applyRadius(radiusInput.value, true));
        radiusRow.appendChild(radiusRange);
        radiusRow.appendChild(radiusInput);
        radiusRow.appendChild(radiusUnit);
        propsPanel.appendChild(radiusLabel);
        propsPanel.appendChild(radiusRow);

        const appendContentScaleControls = () => {
            const scaleLabel = document.createElement('label');
            scaleLabel.textContent = 'Content size';
            const scaleRow = document.createElement('div');
            scaleRow.className = 'overlay-radius-row';
            const scalePct = Math.round(getOverlayContentScale(mod) * 100);
            const scaleRange = document.createElement('input');
            scaleRange.type = 'range';
            scaleRange.min = '50';
            scaleRange.max = '250';
            scaleRange.step = '5';
            scaleRange.value = String(scalePct);
            const scaleInput = document.createElement('input');
            scaleInput.type = 'number';
            scaleInput.min = '50';
            scaleInput.max = '250';
            scaleInput.step = '5';
            scaleInput.value = String(scalePct);
            const scaleUnit = document.createElement('span');
            scaleUnit.className = 'form-hint';
            scaleUnit.textContent = '%';
            const applyScale = (raw, persist) => {
                const current = getSelectedOverlayModule();
                if (!current) return;
                const pct = clampNumber(raw, 50, 250);
                current.props.contentScale = Math.round(pct) / 100;
                scaleRange.value = String(Math.round(pct));
                scaleInput.value = String(Math.round(pct));
                const el = overlayModulesEl && overlayModulesEl.querySelector('.overlay-module[data-id="' + current.id + '"]');
                if (el) applyOverlayModuleStyle(el, current);
                if (persist) saveState();
            };
            scaleRange.addEventListener('input', () => applyScale(scaleRange.value, false));
            scaleRange.addEventListener('change', () => applyScale(scaleRange.value, true));
            scaleInput.addEventListener('input', () => applyScale(scaleInput.value, false));
            scaleInput.addEventListener('change', () => applyScale(scaleInput.value, true));
            scaleRow.appendChild(scaleRange);
            scaleRow.appendChild(scaleInput);
            scaleRow.appendChild(scaleUnit);
            propsPanel.appendChild(scaleLabel);
            propsPanel.appendChild(scaleRow);
        };

        if (mod.type === 'photo') {
            appendPhotoGalleryEditor(propsPanel, {
                uploadKey: 'overlay-' + mod.id,
                uploadPathPrefix: 'menu-creator-photos/overlay-' + mod.id,
                getProps: () => {
                    const current = getSelectedOverlayModule();
                    if (!current) return null;
                    if (!current.props) current.props = {};
                    return current.props;
                },
                onCanvasChanged: () => syncOverlayModuleElements(),
                onControlsChanged: () => renderOverlaySelectedProps()
            });
            if (mod.props && mod.props.useAsCustomerDisplay) appendContentScaleControls();
        } else {
            appendContentScaleControls();

            const eventLabel = document.createElement('label');
            eventLabel.textContent = 'POS event';
            const eventSelect = document.createElement('select');
            const selectedEvent = (mod.props.eventKey || '').trim();
            eventSelect.innerHTML = buildPosEventDropdownHtml(selectedEvent);
            eventSelect.value = selectedEvent;
            if (!activeEventKeysLoaded) ensureActiveEventKeysLoaded();
            eventSelect.addEventListener('change', () => {
                const current = getSelectedOverlayModule();
                if (!current) return;
                current.props.eventKey = eventSelect.value.trim();
                saveState();
                syncOverlayModuleElements();
            });
            const refreshEventsBtn = document.createElement('button');
            refreshEventsBtn.type = 'button';
            refreshEventsBtn.className = 'btn btn-secondary';
            refreshEventsBtn.textContent = 'Refresh';
            refreshEventsBtn.title = 'Reload POS event list from Firebase';
            refreshEventsBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                activeEventKeysLoaded = false;
                loadActiveEventKeys({ force: true }).then(() => renderOverlaySelectedProps());
            });
            const eventSelectRow = document.createElement('div');
            eventSelectRow.style.display = 'flex';
            eventSelectRow.style.gap = '0.5rem';
            eventSelectRow.style.alignItems = 'center';
            eventSelectRow.style.flexWrap = 'wrap';
            eventSelect.style.flex = '1';
            eventSelect.style.minWidth = '8rem';
            eventSelectRow.appendChild(eventSelect);
            eventSelectRow.appendChild(refreshEventsBtn);

            const showSettingsWrap = document.createElement('label');
            showSettingsWrap.className = 'menu-save-new-toggle';
            const showSettingsInput = document.createElement('input');
            showSettingsInput.type = 'checkbox';
            showSettingsInput.checked = Boolean(mod.props.showSettingsButton);
            showSettingsInput.addEventListener('change', () => {
                const current = getSelectedOverlayModule();
                if (!current) return;
                current.props.showSettingsButton = showSettingsInput.checked;
                saveState();
                syncOverlayModuleElements();
            });
            const showSettingsText = document.createElement('span');
            showSettingsText.textContent = 'Show settings button in embed';
            showSettingsWrap.appendChild(showSettingsInput);
            showSettingsWrap.appendChild(showSettingsText);

            const hint = document.createElement('span');
            hint.className = 'form-hint';
            const posHint = posEventDropdownHint();
            hint.textContent = posHint
                ? posHint
                : 'The display reflows to the box size. Preview or viewer mode lets you interact with it.';

            propsPanel.appendChild(eventLabel);
            propsPanel.appendChild(eventSelectRow);
            propsPanel.appendChild(showSettingsWrap);
            propsPanel.appendChild(hint);
        }
        overlaySelectedPropsEl.appendChild(propsPanel);
    }

    function renderOverlayPanel() {
        updateOverlayBgThumb();
        renderOverlayModuleList();
        renderOverlaySelectedProps();
    }

    function updateLayoutModeUi() {
        const mode = state.layoutMode === 'overlay' ? 'overlay' : 'grid';
        document.body.classList.toggle('layout-mode-overlay', mode === 'overlay');
        document.body.classList.toggle('layout-mode-grid', mode === 'grid');
        document.querySelectorAll('[data-layout-mode]').forEach((btn) => {
            const active = btn.getAttribute('data-layout-mode') === mode;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if (tileGridEl) tileGridEl.hidden = mode === 'overlay';
        if (overlayStageEl) overlayStageEl.hidden = mode !== 'overlay';
        updateCanvasHint();
    }

    function setLayoutMode(mode) {
        state.layoutMode = mode === 'overlay' ? 'overlay' : 'grid';
        ensureOverlayState();
        saveState();
        updateLayoutModeUi();
        if (state.layoutMode === 'overlay') {
            renderOverlayPanel();
            ensureActiveEventKeysLoaded();
        }
        renderTiles();
    }

    function renderOverlayCanvas() {
        if (overlayInteract) return;
        ensureOverlayState();
        const { w, h } = getCanvasDimensions();
        menuCanvasEl.style.width = w + 'px';
        menuCanvasEl.style.height = h + 'px';
        menuCanvasEl.style.padding = '0px';
        if (tileGridEl) {
            tileGridEl.innerHTML = '';
            tileGridEl.hidden = true;
        }
        if (overlayStageEl) overlayStageEl.hidden = false;
        const layout = getOverlayStageLayout(w, h);
        applyOverlayStageLayout(layout);
        const hasImage = Boolean(state.overlay.imageUrl);
        if (overlayEmptyStateEl) overlayEmptyStateEl.hidden = hasImage;
        if (overlayBgImageEl) {
            if (hasImage) {
                overlayBgImageEl.src = state.overlay.imageUrl;
                overlayBgImageEl.hidden = false;
            } else {
                overlayBgImageEl.removeAttribute('src');
                overlayBgImageEl.hidden = true;
            }
        }
        syncOverlayModuleElements();
        fitCanvasToPreview();
    }

    function setupOverlayInteractions() {
        if (!overlayModulesEl) return;

        overlayModulesEl.addEventListener('pointerdown', (e) => {
            if (!isOverlayEditorActive()) return;
            if (!e.isPrimary) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            const handleEl = e.target.closest('.overlay-handle');
            const moduleEl = e.target.closest('.overlay-module');
            if (!moduleEl) {
                if (state.overlay.selectedId) selectOverlayModule('');
                return;
            }
            e.stopPropagation();
            e.preventDefault();
            const id = moduleEl.dataset.id;
            selectOverlayModule(id);
            const mod = state.overlay.modules.find((m) => m.id === id);
            if (!mod) return;
            const stagePt = clientToOverlayStagePoint(e.clientX, e.clientY);
            overlayInteract = {
                pointerId: e.pointerId,
                mode: handleEl ? 'resize' : 'move',
                handle: handleEl ? handleEl.getAttribute('data-handle') : '',
                id,
                startPt: stagePt,
                startRect: overlayModToPx(mod, overlayStageLayout.width, overlayStageLayout.height)
            };
            try {
                moduleEl.setPointerCapture(e.pointerId);
            } catch (err) { /* ignore */ }
        });

        const onMove = (e) => {
            if (!overlayInteract || e.pointerId !== overlayInteract.pointerId) return;
            e.preventDefault();
            const stageW = overlayStageLayout.width;
            const stageH = overlayStageLayout.height;
            const mod = state.overlay.modules.find((m) => m.id === overlayInteract.id);
            if (!mod || stageW <= 0 || stageH <= 0) return;
            const stagePt = clientToOverlayStagePoint(e.clientX, e.clientY);
            const dx = stagePt.x - overlayInteract.startPt.x;
            const dy = stagePt.y - overlayInteract.startPt.y;
            let next;
            if (overlayInteract.mode === 'move') {
                const w = overlayInteract.startRect.w;
                const h = overlayInteract.startRect.h;
                next = {
                    x: clampNumber(overlayInteract.startRect.x + dx, 0, Math.max(0, stageW - w)),
                    y: clampNumber(overlayInteract.startRect.y + dy, 0, Math.max(0, stageH - h)),
                    w,
                    h
                };
            } else {
                next = applyResizeFromStart(overlayInteract.startRect, overlayInteract.handle, dx, dy, stageW, stageH);
            }
            mod.x = (next.x / stageW) * 100;
            mod.y = (next.y / stageH) * 100;
            mod.w = (next.w / stageW) * 100;
            mod.h = (next.h / stageH) * 100;
            const el = overlayModulesEl.querySelector('.overlay-module[data-id="' + overlayInteract.id + '"]');
            if (el) applyOverlayModuleStyle(el, mod);
        };

        const onUp = (e) => {
            if (!overlayInteract || e.pointerId !== overlayInteract.pointerId) return;
            overlayInteract = null;
            saveState();
            renderOverlaySelectedProps();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    }

    function getCanvasDimensions() {
        const w = Number(canvasWidthEl.value) || state.width;
        const h = Number(canvasHeightEl.value) || state.height;
        return { w: toPx(w), h: toPx(h) };
    }

    function exportAsPng() {
        if (typeof window.html2canvas !== 'function') {
            alert('Export requires html2canvas. Please reload the page.');
            return;
        }
        if (!canvasScalerEl) return;
        const galleries = [];
        canvasScalerEl.querySelectorAll('.tile-photo-gallery').forEach(el => {
            const items = el.querySelectorAll('.tile-photo-item');
            let visibleIdx = 0;
            items.forEach((item, i) => { if (item.classList.contains('tile-photo-visible')) visibleIdx = i; });
            galleries.push({ el, visibleIdx });
            items.forEach((item, i) => item.classList.toggle('tile-photo-visible', i === 0));
        });
        const restore = () => {
            galleries.forEach(({ el, visibleIdx }) => {
                const items = el.querySelectorAll('.tile-photo-item');
                items.forEach((item, i) => item.classList.toggle('tile-photo-visible', i === visibleIdx));
            });
        };
        const btn = exportPhotoBtnEl;
        if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }
        const doCapture = (opts) => {
            return window.html2canvas(canvasScalerEl, { scale: 1, logging: false, ...opts });
        };
        doCapture({ useCORS: true })
            .catch(() => doCapture({ useCORS: false, allowTaint: true }))
            .then(canvas => {
                restore();
                if (!canvas) throw new Error('No canvas');
                canvas.toBlob(blob => {
                    if (btn) { btn.disabled = false; btn.textContent = 'Export as PNG'; }
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'menu-export.png';
                    a.click();
                    URL.revokeObjectURL(url);
                }, 'image/png');
            })
            .catch(err => {
                restore();
                if (btn) { btn.disabled = false; btn.textContent = 'Export as PNG'; }
                console.error('Export failed:', err);
                alert('Export failed. Try using only photos uploaded in this app (not external links), then export again.');
            });
    }

    function renderTiles() {
        ensureOverlayState();
        if (state.layoutMode === 'overlay') {
            renderOverlayCanvas();
            return;
        }
        clearPhotoRuntimes();
        if (overlayStageEl) overlayStageEl.hidden = true;
        if (tileGridEl) tileGridEl.hidden = false;
        const { w, h } = getCanvasDimensions();
        const margin = state.unit === 'cm' ? state.margin * CM_TO_PX : state.margin;
        const innerW = Math.max(0, w - margin * 2);
        const innerH = Math.max(0, h - margin * 2);
        const gapPx = toPx(state.gap);
        const totalGapX = gapPx * Math.max(0, state.columnCount - 1);

        menuCanvasEl.style.width = w + 'px';
        menuCanvasEl.style.height = h + 'px';
        menuCanvasEl.style.padding = margin + 'px';

        tileGridEl.innerHTML = '';
        tileGridEl.style.gap = gapPx + 'px';

        const colWidthsPx = state.columnWidths.map(p => ((p / 100) * (innerW - totalGapX)));

        state.columnRows.forEach((col, colIdx) => {
            const columnDiv = document.createElement('div');
            columnDiv.className = 'tile-column';
            columnDiv.style.width = colWidthsPx[colIdx] + 'px';
            columnDiv.style.height = innerH + 'px';
            columnDiv.style.gap = gapPx + 'px';

            const rowHeightsPx = getRowHeightsPx(colIdx, innerH, gapPx);

            for (let r = 0; r < col.rowCount; r++) {
                const tile = document.createElement('div');
                const template = (state.tileTemplate && state.tileTemplate[colIdx] && state.tileTemplate[colIdx][r]) || 'white';
                tile.className = 'tile tile-template-' + template;
                tile.style.height = rowHeightsPx[r] + 'px';
                if (template === 'branch-name') {
                    const props = (state.tileTemplateProps && state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][r]) || { line1: '', line2: '', line1FontSize: 32, line2FontSize: 24 };
                    const line1 = (props.line1 || '').trim() || 'BRANCH NAME';
                    const line2 = (props.line2 || '').trim() || 'LOCATION';
                    const size1 = Math.max(8, Math.min(120, Number(props.line1FontSize) || 32));
                    const size2 = Math.max(8, Math.min(120, Number(props.line2FontSize) || 24));
                    tile.innerHTML = `<span class="tile-line1" style="font-size:${size1}px">${escapeHtml(line1)}</span><span class="tile-line2" style="font-size:${size2}px">${escapeHtml(line2)}</span>`;
                } else if (template === 'logo') {
                    tile.innerHTML = '<div class="tile-logo-wrap"><img src="img/matchanese-logo.png" alt="Matchanese" class="tile-logo-img"></div>';
                } else if (template === 'menu') {
                    tile.style.setProperty('--menu-tile-height', rowHeightsPx[r] + 'px');
                    const menuProps = (state.tileTemplateProps && state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][r]) || { category: '', drinkIds: [] };
                    tile.innerHTML = getMenuTemplateHtml(menuProps);
                } else if (template === 'customization') {
                    const customProps = (state.tileTemplateProps && state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][r]) || {};
                    tile.innerHTML = getCustomizationTemplateHtml(customProps);
                } else if (template === 'photo') {
                    const photoProps = (state.tileTemplateProps && state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][r]) || {};
                    tile.innerHTML = buildPhotoModuleHtml(photoProps);
                } else if (template === 'customer-display') {
                    const displayProps = (state.tileTemplateProps && state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][r]) || {};
                    const params = new URLSearchParams();
                    if (displayProps.eventKey) params.set('event', displayProps.eventKey);
                    params.set('embedded', '1');
                    if (!displayProps.showSettingsButton) params.set('hideSettings', '1');
                    params.set('v', 'greeting-fix-2');
                    const query = params.toString();
                    const src = '../pos/customer-display.html' + (query ? '?' + query : '');
                    tile.innerHTML = '<div class="tile-customer-display-wrap"><iframe class="tile-customer-display-iframe" src="' + escapeHtml(src) + '" loading="lazy" referrerpolicy="no-referrer"></iframe></div>';
                } else {
                    tile.innerHTML = `<span class="tile-placeholder">Tile ${colIdx + 1}-${r + 1}</span>`;
                }
                columnDiv.appendChild(tile);
            }
            tileGridEl.appendChild(columnDiv);
        });

        bindPhotoRuntimes(tileGridEl);

        state.columnRows.forEach((_, colIdx) => { syncRowHeightInputs(colIdx); });
        fitCanvasToPreview();
    }

    function fitCanvasToPreview() {
        if (!previewWrapEl || !canvasScalerEl || !canvasFitWrapperEl) return;
        const { w, h } = getCanvasDimensions();
        const wrapW = previewWrapEl.clientWidth;
        const wrapH = previewWrapEl.clientHeight;
        if (wrapW <= 0 || wrapH <= 0 || w <= 0 || h <= 0) return;
        const rot = normalizeViewRotationDeg(viewRotationDeg);
        const fitW = (rot === 90 || rot === 270) ? h : w;
        const fitH = (rot === 90 || rot === 270) ? w : h;
        // In fullscreen preview we allow upscaling so the menu maximizes
        // available screen space (important for iPad PWA).
        let scale = Math.min(wrapW / fitW, wrapH / fitH);
        if (!fullscreenPreviewActive) scale = Math.min(scale, 1);
        const interactionZoom = isPreviewZoomEnabled() ? previewZoom : 1;
        const totalScale = scale * interactionZoom;
        const offsetX = isPreviewInteractionEnabled() ? previewPanX : 0;
        const offsetY = isPreviewInteractionEnabled() ? previewPanY : 0;
        const Ws = w * totalScale;
        const Hs = h * totalScale;
        const aw = (rot === 90 || rot === 270) ? Hs : Ws;
        const ah = (rot === 90 || rot === 270) ? Ws : Hs;
        canvasFitWrapperEl.style.display = 'flex';
        canvasFitWrapperEl.style.alignItems = 'center';
        canvasFitWrapperEl.style.justifyContent = 'center';
        canvasFitWrapperEl.style.width = aw + 'px';
        canvasFitWrapperEl.style.height = ah + 'px';
        canvasFitWrapperEl.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        canvasScalerEl.style.width = w + 'px';
        canvasScalerEl.style.height = h + 'px';
        canvasScalerEl.style.transformOrigin = 'center center';
        canvasScalerEl.style.flexShrink = '0';
        canvasScalerEl.style.transform = 'scale(' + totalScale + ') rotate(' + rot + 'deg)';
        if (overlayStageEl) {
            const handleScale = totalScale > 0 ? Math.min(3, Math.max(1, 1 / totalScale)) : 1;
            overlayStageEl.style.setProperty('--overlay-handle-scale', String(handleScale));
        }
    }

    function debounce(fn, ms) {
        let t;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    function init() {
        setupViewerModeUi();
        setupPreviewInteractions();
        setupOverlayInteractions();
        loadViewRotation();
        ensureActiveEventKeysLoaded();
        loadState();
        ensureOverlayState();
        loadCustomCategories();
        applyStateToForm();
        renderDrinkCategoryOptions('');

        document.querySelectorAll('[data-layout-mode]').forEach((btn) => {
            btn.addEventListener('click', () => {
                setLayoutMode(btn.getAttribute('data-layout-mode'));
            });
        });
        if (overlayBgPickBtnEl && overlayBgInputEl) {
            overlayBgPickBtnEl.addEventListener('click', () => overlayBgInputEl.click());
            overlayBgInputEl.addEventListener('change', () => {
                const file = overlayBgInputEl.files && overlayBgInputEl.files[0];
                overlayBgInputEl.value = '';
                if (file && !overlayImageUploading) uploadOverlayBackground(file);
            });
        }
        if (overlayBgRemoveBtnEl) overlayBgRemoveBtnEl.addEventListener('click', removeOverlayBackground);
        if (addOverlayModuleBtnEl) {
            addOverlayModuleBtnEl.addEventListener('click', () => {
                addOverlayModule(overlayModuleTypeEl ? overlayModuleTypeEl.value : 'customer-display');
            });
        }

        orientationEl.addEventListener('change', () => {
            state.orientation = orientationEl.value;
            swapDimensions();
            saveState();
        });

        unitEl.addEventListener('change', () => {
            state.unit = unitEl.value;
            updateCanvasHint();
            saveState();
            renderTiles();
        });

        marginEl.addEventListener('input', () => {
            state.margin = Math.max(0, Number(marginEl.value) || 0);
            saveState();
            renderTiles();
        });

        canvasWidthEl.addEventListener('input', () => {
            state.width = Math.max(1, Number(canvasWidthEl.value) || state.width);
            updateCanvasHint();
            saveState();
            renderColumnWidthInputs();
            renderTiles();
        });
        canvasHeightEl.addEventListener('input', () => {
            state.height = Math.max(1, Number(canvasHeightEl.value) || state.height);
            updateCanvasHint();
            saveState();
            renderColumnRowsSection();
            renderTiles();
        });

        columnCountEl.addEventListener('change', applyColumnCount);
        columnCountEl.addEventListener('input', debounce(applyColumnCount, 300));

        tileGapEl.addEventListener('input', () => {
            state.gap = Math.max(0, Number(tileGapEl.value) || 0);
            saveState();
            renderTiles();
        });

        $('resetBtn').addEventListener('click', () => {
            loadedMenuDrinks = [];
            const def = getDefaultState();
            state.orientation = def.orientation;
            state.unit = def.unit;
            state.margin = def.margin;
            state.width = def.width;
            state.height = def.height;
            state.columnCount = def.columnCount;
            state.columnWidths = def.columnWidths.slice();
            state.columnWidthLocks = def.columnWidthLocks.slice();
            state.columnRows = def.columnRows.map(c => ({ rowCount: c.rowCount, rowHeights: c.rowHeights.slice() }));
            state.columnRowUnits = def.columnRowUnits ? def.columnRowUnits.map(arr => arr.slice()) : [['%', '%'], ['%', '%']];
            state.columnRowLocks = def.columnRowLocks.map(arr => arr.slice());
            state.tileTemplate = def.tileTemplate.map(arr => arr.slice());
            state.tileTemplateProps = def.tileTemplateProps.map(col => col.map(p => ({ line1: p.line1 || '', line2: p.line2 || '' })));
            state.gap = def.gap;
            state.layoutMode = def.layoutMode;
            state.overlay = getDefaultOverlayState();
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
            applyStateToForm();
            renderColumnWidthInputs();
            renderColumnRowsSection();
            renderTiles();
        });

        renderColumnWidthInputs();
        renderColumnRowsSection();
        renderTiles();

        document.querySelectorAll('.panel-tabs [data-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab');
                document.querySelectorAll('.panel-tabs [data-tab]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (tab === 'layout') {
                    layoutPanelEl.classList.add('active');
                    layoutPanelEl.hidden = false;
                    drinksPanelEl.classList.remove('active');
                    drinksPanelEl.hidden = true;
                } else {
                    layoutPanelEl.classList.remove('active');
                    layoutPanelEl.hidden = true;
                    drinksPanelEl.classList.add('active');
                    drinksPanelEl.hidden = false;
                    loadDrinksFromFirebase().then(() => seedDrinksIfEmpty()).then(() => runOneTimeDrinkDuplicateResolution()).then(() => {
                        renderDrinksList();
                        renderDrinkCategoryOptions(drinkCategoryEl ? drinkCategoryEl.value : '');
                        renderColumnRowsSection();
                        renderTiles();
                    });
                }
            });
        });

        if (addDrinkBtnEl) addDrinkBtnEl.addEventListener('click', () => openDrinkModal());
        if (manageCategoriesBtnEl) manageCategoriesBtnEl.addEventListener('click', openCategoryModal);
        if (saveDrinkBtnEl) saveDrinkBtnEl.addEventListener('click', saveDrink);
        if (cancelDrinkBtnEl) cancelDrinkBtnEl.addEventListener('click', closeDrinkModal);
        if (addCategoryBtnEl) addCategoryBtnEl.addEventListener('click', addCategory);
        if (closeCategoryBtnEl) closeCategoryBtnEl.addEventListener('click', closeCategoryModal);
        if (newCategoryNameEl) {
            newCategoryNameEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addCategory();
                }
            });
        }
        if (exportPhotoBtnEl) exportPhotoBtnEl.addEventListener('click', exportAsPng);
        if (fullscreenPreviewBtnEl) fullscreenPreviewBtnEl.addEventListener('click', toggleFullscreenPreview);
        const saveMenuBtnEl = $('saveMenuBtn');
        const loadMenuBtnEl = $('loadMenuBtn');
        const loadMenuInputEl = $('loadMenuInput');
        if (saveMenuBtnEl) saveMenuBtnEl.addEventListener('click', openSaveMenuModal);
        if (loadMenuBtnEl) loadMenuBtnEl.addEventListener('click', openLoadMenuModal);
        if (exportMenuBtnEl) exportMenuBtnEl.addEventListener('click', saveMenuToFile);
        if (importMenuBtnEl) importMenuBtnEl.addEventListener('click', () => loadMenuInputEl && loadMenuInputEl.click());
        if (loadMenuInputEl) loadMenuInputEl.addEventListener('change', () => {
            const file = loadMenuInputEl.files && loadMenuInputEl.files[0];
            loadMenuFromFile(file);
            loadMenuInputEl.value = '';
        });
        if (drinkModalBackdropEl) {
            drinkModalBackdropEl.addEventListener('click', (e) => {
                if (e.target === drinkModalBackdropEl) closeDrinkModal();
            });
        }
        if (categoryModalBackdropEl) {
            categoryModalBackdropEl.addEventListener('click', (e) => {
                if (e.target === categoryModalBackdropEl) closeCategoryModal();
            });
        }
        document.addEventListener('keydown', (e) => {
            if (
                (e.key === 'r' || e.key === 'R') &&
                !e.ctrlKey && !e.metaKey && !e.altKey
            ) {
                if (isKeydownInEditableField(e.target)) return;
                e.preventDefault();
                cycleViewRotation();
                return;
            }
            if (
                VIEWER_MODE &&
                e.key === 'Tab' &&
                (!menuLoadModalBackdropEl || menuLoadModalBackdropEl.hidden) &&
                (!menuSaveModalBackdropEl || menuSaveModalBackdropEl.hidden) &&
                (!drinkModalBackdropEl || drinkModalBackdropEl.hidden) &&
                (!categoryModalBackdropEl || categoryModalBackdropEl.hidden)
            ) {
                e.preventDefault();
                openLoadMenuModal();
                return;
            }
            if (e.key === 'Escape' && drinkModalBackdropEl && !drinkModalBackdropEl.hidden) closeDrinkModal();
            if (e.key === 'Escape' && categoryModalBackdropEl && !categoryModalBackdropEl.hidden) closeCategoryModal();
            if (e.key === 'Escape' && menuSaveModalBackdropEl && !menuSaveModalBackdropEl.hidden) closeSaveMenuModal();
            if (e.key === 'Escape' && menuLoadModalBackdropEl && !menuLoadModalBackdropEl.hidden) closeLoadMenuModal();
            if (
                (e.key === 'Delete' || e.key === 'Backspace') &&
                isOverlayEditorActive() &&
                state.overlay &&
                state.overlay.selectedId &&
                !isKeydownInEditableField(e.target)
            ) {
                e.preventDefault();
                deleteSelectedOverlayModule();
            }
        });
        if (confirmSaveMenuBtnEl) confirmSaveMenuBtnEl.addEventListener('click', saveMenuOnline);
        if (cancelSaveMenuBtnEl) cancelSaveMenuBtnEl.addEventListener('click', closeSaveMenuModal);
        if (menuSaveSearchInputEl) {
            menuSaveSearchInputEl.addEventListener('input', () => {
                renderSaveMenuList(menuSaveSearchInputEl.value || '');
            });
        }
        if (menuSaveAsNewEl) {
            menuSaveAsNewEl.addEventListener('change', () => {
                renderSaveMenuList(menuSaveSearchInputEl ? menuSaveSearchInputEl.value : '');
            });
        }
        if (menuSaveModalBackdropEl) {
            menuSaveModalBackdropEl.addEventListener('click', (e) => {
                if (e.target === menuSaveModalBackdropEl) closeSaveMenuModal();
            });
        }
        if (menuSearchInputEl) {
            menuSearchInputEl.addEventListener('input', () => {
                renderMenuLoadList(menuSearchInputEl.value || '');
            });
        }
        if (confirmLoadMenuBtnEl) confirmLoadMenuBtnEl.addEventListener('click', loadSelectedMenuOnline);
        if (deleteMenuBtnEl) deleteMenuBtnEl.addEventListener('click', deleteSelectedMenuOnline);
        if (cancelLoadMenuBtnEl) cancelLoadMenuBtnEl.addEventListener('click', closeLoadMenuModal);
        if (menuLoadModalBackdropEl) {
            menuLoadModalBackdropEl.addEventListener('click', (e) => {
                if (e.target === menuLoadModalBackdropEl) closeLoadMenuModal();
            });
        }

        loadDrinksFromFirebase().then(() => seedDrinksIfEmpty()).then(() => runOneTimeDrinkDuplicateResolution()).then(() => {
            renderDrinksList();
            renderDrinkCategoryOptions(drinkCategoryEl ? drinkCategoryEl.value : '');
            renderColumnRowsSection();
            renderTiles();
        });

        window.addEventListener('resize', () => {
            fitCanvasToPreview();
        });
    }

    init();
})();
