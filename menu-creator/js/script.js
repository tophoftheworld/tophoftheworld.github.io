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
    const MENU_PAYLOAD_VERSION = 2;

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
            gap: 24
        };
    }

    const state = getDefaultState();
    const photoUploading = {};
    let photoGalleryIntervals = [];
    let liveSessionPollers = [];

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

    function hasActiveLiveOrder(liveData) {
        if (!liveData || typeof liveData !== 'object') return false;
        const items = Array.isArray(liveData.items) ? liveData.items : [];
        const status = (liveData.status || '').toString().toLowerCase();
        return items.length > 0 && status !== 'idle';
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
    const previewWrapEl = $('previewWrap');
    const canvasScalerEl = $('canvasScaler');
    const canvasFitWrapperEl = $('canvasFitWrapper');
    const layoutPanelEl = $('layoutPanel');
    const drinksPanelEl = $('drinksPanel');
    const drinksListEl = $('drinksList');
    const drinksListHintEl = $('drinksListHint');
    const addDrinkBtnEl = $('addDrinkBtn');
    const drinkModalBackdropEl = $('drinkModalBackdrop');
    const drinkModalTitleEl = $('drinkModalTitle');
    const drinkNameEl = $('drinkName');
    const drinkDescEl = $('drinkDesc');
    const drinkPriceEl = $('drinkPrice');
    const drinkCategoryEl = $('drinkCategory');
    const drinkEditIdEl = $('drinkEditId');
    const saveDrinkBtnEl = $('saveDrinkBtn');
    const cancelDrinkBtnEl = $('cancelDrinkBtn');
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
                loadedMenuDrinks = Array.isArray(data.drinksSnapshot) ? data.drinksSnapshot : [];
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
        loadedMenuDrinks = Array.isArray(data.drinksSnapshot) ? data.drinksSnapshot : [];
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
                    state.tileTemplateProps[i][j] = { ...p, category: p.category != null ? p.category : '', categoryTag: (p.categoryTag != null ? p.categoryTag : ''), drinkIds: Array.isArray(p.drinkIds) ? p.drinkIds : [], drinkTags: (p.drinkTags && typeof p.drinkTags === 'object') ? p.drinkTags : {}, drinkTagColors: (p.drinkTagColors && typeof p.drinkTagColors === 'object') ? p.drinkTagColors : {} };
                }
            });
        });
    }

    function getUniqueCategories() {
        const set = new Set();
        drinksCache.forEach(d => { if (d.category) set.add(d.category); });
        loadedMenuDrinks.forEach(d => { if (d && d.category) set.add(d.category); });
        return Array.from(set).sort();
    }

    function applyStateToForm() {
        orientationEl.value = state.orientation;
        unitEl.value = state.unit;
        marginEl.value = state.margin;
        canvasWidthEl.value = state.width;
        canvasHeightEl.value = state.height;
        columnCountEl.value = state.columnCount;
        tileGapEl.value = state.gap;
        updateCanvasHint();
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
        { id: 'pink', label: 'Pink', class: 'menu-props-tag-color-btn--pink' }
    ];

    function getMenuTemplateHtml(props) {
        const category = (props && props.category) ? String(props.category).trim() : '';
        const drinkIds = (props && Array.isArray(props.drinkIds)) ? props.drinkIds : [];
        const drinks = drinkIds.map(id => drinksCache.find(d => d.id === id) || loadedMenuDrinks.find(d => d.id === id)).filter(Boolean);
        const sectionTitle = category || 'Matcha Lattes';
        const icedLabel = 'Iced';
        const categoryTag = (props && props.categoryTag != null) ? String(props.categoryTag).trim() : '';
        let itemsHtml;
        let itemsClass = '';
        if (drinks.length === 0) {
            itemsHtml = '<div class="menu-item menu-item-placeholder">Select category and drinks in the panel.</div>';
        } else {
            const drinkTags = (props && props.drinkTags && typeof props.drinkTags === 'object') ? props.drinkTags : {};
            const drinkTagColors = (props && props.drinkTagColors && typeof props.drinkTagColors === 'object') ? props.drinkTagColors : {};
            const allNoDesc = drinks.every(d => !(d.description || '').trim());
            itemsClass = allNoDesc ? ' menu-items--no-desc' : '';
            itemsHtml = drinks.map(d => {
                const tagText = (drinkTags[d.id] || '').trim();
                const tagColor = drinkTagColors[d.id] === 'pink' ? 'pink' : 'green';
                const tag = tagText ? `<span class="menu-item-tag menu-item-tag--${tagColor}">${escapeHtml(tagText)}</span>` : '';
                return `<div class="menu-item"><div class="menu-item-head"><span class="menu-item-title">${escapeHtml(d.name || '')}</span>${tag}</div><div class="menu-item-desc">${escapeHtml(d.description || '')}</div><div class="menu-item-price">${formatPriceHtml(d.price)}</div></div>`;
            }).join('');
        }
        const cardClass = 'menu-card' + ((sectionTitle || '').toLowerCase().includes('hōjicha') || (sectionTitle || '').toLowerCase().includes('hojicha') ? ' menu-card--hojicha' : '');
        const headerTagHtml = categoryTag ? `<span class="menu-header-tag">${escapeHtml(categoryTag)}</span>` : '';
        const headerRight = categoryTag
            ? `<div class="menu-header-right">${headerTagHtml}</div>`
            : `<div class="menu-header-right"><span class="menu-iced">${escapeHtml(icedLabel)}</span></div>`;
        return `<div class="${cardClass}"><div class="menu-header"><h2 class="menu-title">${escapeHtml(sectionTitle)}</h2>${headerRight}</div><div class="menu-items${itemsClass}">${itemsHtml}</div></div>`;
    }

    function getCustomizationTemplateHtml() {
        return `
<div class="customization-wrap">
  <header class="customization-header">
    <h1 class="customization-title">Make it your Matchanese</h1>
    <p class="customization-subtitle">Customization Options</p>
  </header>
  <div class="customization-card">
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
        <span class="customization-option-price">+ <span class="price-currency">Php</span> 40</span>
      </div>
      <div class="customization-option">
        <span class="customization-option-label">LEVEL</span>
        <span class="customization-option-num">3</span>
        <span class="customization-option-meta">INTENSE</span>
        <span class="customization-option-price">+ <span class="price-currency">Php</span> 80</span>
      </div>
    </div>
  </div>
  <div class="customization-card">
    <h2 class="customization-card-title">Sweetness</h2>
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
  <div class="customization-card customization-card-milk">
    <div class="customization-milk-left">
      <span class="customization-milk-meta">Default</span>
      <span class="customization-milk-name">Dairy Milk</span>
    </div>
    <img src="img/dairy.jpg" alt="Dairy" class="customization-milk-img">
  </div>
  <div class="customization-card customization-card-milk">
    <div class="customization-milk-left">
      <span class="customization-milk-meta">Upgrade to</span>
      <span class="customization-milk-name">Oat Milk</span>
      <span class="customization-option-price">FREE</span>
    </div>
    <img src="img/oat.jpg" alt="Oat" class="customization-milk-img">
  </div>
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
            drinksListHintEl.textContent = 'No drinks yet. Click Add drink to add one.';
            return;
        }
        drinksListHintEl.textContent = drinksCache.length + ' drink(s).';
        drinksListEl.innerHTML = drinksCache.map(d => {
            const meta = [d.category, d.price].filter(Boolean).join(' · ');
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
        drinksListEl.querySelectorAll('.drink-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => startEditDrink(btn.getAttribute('data-id')));
        });
        drinksListEl.querySelectorAll('.drink-duplicate-btn').forEach(btn => {
            btn.addEventListener('click', () => duplicateDrink(btn.getAttribute('data-id')));
        });
    }

    function openDrinkModal(editData) {
        if (editData) {
            drinkNameEl.value = editData.name || '';
            drinkDescEl.value = editData.description || '';
            drinkPriceEl.value = editData.price || '';
            drinkCategoryEl.value = editData.category || '';
            drinkEditIdEl.value = editData.id || '';
            drinkModalTitleEl.textContent = 'Edit drink';
            saveDrinkBtnEl.textContent = 'Update drink';
        } else {
            drinkNameEl.value = '';
            drinkDescEl.value = '';
            drinkPriceEl.value = '';
            drinkCategoryEl.value = '';
            drinkEditIdEl.value = '';
            drinkModalTitleEl.textContent = 'Add drink';
            saveDrinkBtnEl.textContent = 'Save drink';
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
        drinkCategoryEl.value = '';
        drinkEditIdEl.value = '';
        drinkModalTitleEl.textContent = 'Add drink';
        saveDrinkBtnEl.textContent = 'Save drink';
    }

    function startEditDrink(id) {
        const d = drinksCache.find(x => x.id === id);
        if (!d) return;
        openDrinkModal({ id: d.id, name: d.name, description: d.description, price: d.price, category: d.category });
    }

    async function duplicateDrink(id) {
        const d = drinksCache.find(x => x.id === id);
        if (!d) return;
        try {
            const ref = collection(db, DRINKS_COLLECTION);
            await addDoc(ref, {
                name: (d.name || '') + ' (copy)',
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
        try {
            if (editId) {
                const ref = doc(db, DRINKS_COLLECTION, editId);
                await updateDoc(ref, { name, description, price, category });
            } else {
                const ref = collection(db, DRINKS_COLLECTION);
                await addDoc(ref, { name, description, price, category });
            }
            await loadDrinksFromFirebase();
            renderDrinksList();
            closeDrinkModal();
        } catch (e) {
            console.error('Save drink:', e);
            alert('Failed to save: ' + (e.message || e));
        }
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
                        state.tileTemplateProps[colIdx][rowIdx] = { ...p, category: p.category != null ? p.category : '', categoryTag: (p.categoryTag != null ? p.categoryTag : ''), drinkIds: Array.isArray(p.drinkIds) ? p.drinkIds : [], drinkTags: (p.drinkTags && typeof p.drinkTags === 'object') ? p.drinkTags : {}, drinkTagColors: (p.drinkTagColors && typeof p.drinkTagColors === 'object') ? p.drinkTagColors : {} };
                    }
                    if (templateSelect.value === 'photo') {
                        const p = state.tileTemplateProps[colIdx][rowIdx] || {};
                        const { mediaItems, imageUrls, galleryIntervalSeconds } = getGalleryProps(p);
                        state.tileTemplateProps[colIdx][rowIdx] = { ...p, mediaItems, imageUrls, galleryIntervalSeconds };
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
                        const currentColor = currentDrinkTagColors[id] === 'pink' ? 'pink' : 'green';
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
                            openTagColorPicker(tagColorTrigger, id, colIdx, rowIdx, saveState, renderTiles, renderColumnRowsSection);
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
                    const uploadKey = `${colIdx}-${rowIdx}`;
                    const photoProps = (state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][rowIdx]) || {};
                    const { mediaItems, imageUrls, galleryIntervalSeconds } = getGalleryProps(photoProps);
                    if (!Array.isArray(state.tileTemplateProps[colIdx][rowIdx].mediaItems) || typeof state.tileTemplateProps[colIdx][rowIdx].galleryIntervalSeconds !== 'number') {
                        state.tileTemplateProps[colIdx][rowIdx] = { ...state.tileTemplateProps[colIdx][rowIdx], mediaItems: [...mediaItems], imageUrls: [...imageUrls], galleryIntervalSeconds };
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
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = { mediaItems: [], imageUrls: [], galleryIntervalSeconds: 3 };
                        const v = Math.max(1, Math.min(60, Number(intervalInput.value) || 3));
                        state.tileTemplateProps[colIdx][rowIdx].galleryIntervalSeconds = v;
                        saveState();
                        renderTiles();
                    });
                    propsPanel.appendChild(intervalLabel);
                    propsPanel.appendChild(intervalInput);

                    const thumbsWrap = document.createElement('div');
                    thumbsWrap.className = 'tile-photo-thumbs-wrap';

                    function ensurePhotoProps() {
                        const p = state.tileTemplateProps[colIdx][rowIdx] || {};
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = { mediaItems: [], imageUrls: [], galleryIntervalSeconds: 3 };
                        let items = state.tileTemplateProps[colIdx][rowIdx].mediaItems;
                        if (!Array.isArray(items)) {
                            const legacyUrls = Array.isArray(p.imageUrls) ? p.imageUrls : (p.imageUrl ? [p.imageUrl] : []);
                            items = legacyUrls.filter(Boolean).map((url) => ({ type: 'image', url }));
                            state.tileTemplateProps[colIdx][rowIdx].mediaItems = items;
                        }
                        state.tileTemplateProps[colIdx][rowIdx].imageUrls = items.filter((item) => item && item.type !== 'video' && item.url).map((item) => item.url);
                        if (typeof state.tileTemplateProps[colIdx][rowIdx].galleryIntervalSeconds !== 'number') state.tileTemplateProps[colIdx][rowIdx].galleryIntervalSeconds = 3;
                    }

                    function renderThumbs() {
                        thumbsWrap.innerHTML = '';
                        const items = state.tileTemplateProps[colIdx][rowIdx].mediaItems || [];
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
                                ensurePhotoProps();
                                state.tileTemplateProps[colIdx][rowIdx].mediaItems.splice(index, 1);
                                saveState();
                                renderTiles();
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
                        ensurePhotoProps();
                        photoUploading[uploadKey] = true;
                        renderColumnRowsSection();
                        for (const file of files) {
                            try {
                                const mediaType = file.type && file.type.startsWith('video/') ? 'video' : 'image';
                                const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
                                const path = `menu-creator-photos/tile-${colIdx}-${rowIdx}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                                const ref = storageRef(storage, path);
                                await uploadBytes(ref, file);
                                const url = await getDownloadURL(ref);
                                state.tileTemplateProps[colIdx][rowIdx].mediaItems.push({ type: mediaType, url });
                            } catch (err) {
                                console.error('Media upload failed:', err);
                                const url = await new Promise((res) => {
                                    const reader = new FileReader();
                                    reader.onload = () => res(reader.result);
                                    reader.readAsDataURL(file);
                                });
                                const mediaType = file.type && file.type.startsWith('video/') ? 'video' : 'image';
                                state.tileTemplateProps[colIdx][rowIdx].mediaItems.push({ type: mediaType, url });
                            }
                        }
                        saveState();
                        renderTiles();
                        photoUploading[uploadKey] = false;
                        renderColumnRowsSection();
                    });

                    renderThumbs();
                    if (photoUploading[uploadKey]) {
                        const uploadingLabel = document.createElement('span');
                        uploadingLabel.className = 'tile-photo-preview-label';
                        uploadingLabel.textContent = 'Uploading…';
                        uploadingLabel.style.display = 'block';
                        uploadingLabel.style.marginBottom = '0.25rem';
                        propsPanel.appendChild(uploadingLabel);
                    }
                    propsPanel.appendChild(thumbsWrap);
                    propsPanel.appendChild(photoInput);

                    const takeoverWrap = document.createElement('label');
                    takeoverWrap.className = 'menu-save-new-toggle';
                    const takeoverInput = document.createElement('input');
                    takeoverInput.type = 'checkbox';
                    takeoverInput.checked = Boolean(photoProps.useAsCustomerDisplay);
                    const takeoverText = document.createElement('span');
                    takeoverText.textContent = 'Use customer display when active order exists';
                    takeoverInput.addEventListener('change', () => {
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = {};
                        state.tileTemplateProps[colIdx][rowIdx].useAsCustomerDisplay = takeoverInput.checked;
                        saveState();
                        renderColumnRowsSection();
                        renderTiles();
                    });
                    takeoverWrap.appendChild(takeoverInput);
                    takeoverWrap.appendChild(takeoverText);
                    propsPanel.appendChild(takeoverWrap);

                    if (takeoverInput.checked) {
                        const eventLabel = document.createElement('label');
                        eventLabel.textContent = 'Customer display event key';
                        const eventInput = document.createElement('input');
                        eventInput.type = 'text';
                        eventInput.placeholder = 'e.g. bgc-night-market';
                        eventInput.value = photoProps.customerDisplayEventKey || '';
                        eventInput.addEventListener('input', () => {
                            if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = {};
                            state.tileTemplateProps[colIdx][rowIdx].customerDisplayEventKey = eventInput.value.trim();
                            saveState();
                            renderTiles();
                        });
                        const eventHint = document.createElement('span');
                        eventHint.className = 'form-hint';
                        eventHint.textContent = 'Idle shows gallery; active order shows customer display.';
                        propsPanel.appendChild(eventLabel);
                        propsPanel.appendChild(eventInput);
                        propsPanel.appendChild(eventHint);
                    }
                    block.appendChild(propsPanel);
                }
                if (templateVal === 'customer-display') {
                    const propsPanel = document.createElement('div');
                    propsPanel.className = 'tile-template-props';
                    const displayProps = (state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][rowIdx]) || {};

                    const eventLabel = document.createElement('label');
                    eventLabel.textContent = 'Event key (optional)';
                    const eventInput = document.createElement('input');
                    eventInput.type = 'text';
                    eventInput.placeholder = 'e.g. bgc-night-market';
                    eventInput.value = displayProps.eventKey || '';
                    eventInput.addEventListener('input', () => {
                        if (!state.tileTemplateProps[colIdx][rowIdx]) state.tileTemplateProps[colIdx][rowIdx] = {};
                        state.tileTemplateProps[colIdx][rowIdx].eventKey = eventInput.value.trim();
                        saveState();
                        renderTiles();
                    });

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
                    hint.textContent = 'This embeds ../pos/customer-display.html so updates happen in one source only.';

                    propsPanel.appendChild(eventLabel);
                    propsPanel.appendChild(eventInput);
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
        photoGalleryIntervals.forEach((cleanup) => {
            try { cleanup(); } catch (_) { /* ignore */ }
        });
        photoGalleryIntervals = [];
        liveSessionPollers.forEach((cleanup) => {
            try { cleanup(); } catch (_) { /* ignore */ }
        });
        liveSessionPollers = [];
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
                    tile.innerHTML = getCustomizationTemplateHtml();
                } else if (template === 'photo') {
                    const photoProps = (state.tileTemplateProps && state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][r]) || {};
                    const { mediaItems, galleryIntervalSeconds } = getGalleryProps(photoProps);
                    const useAsCustomerDisplay = Boolean(photoProps.useAsCustomerDisplay);
                    const eventKey = (photoProps.customerDisplayEventKey || '').trim();
                    if (mediaItems.length === 0 && !useAsCustomerDisplay) {
                        tile.innerHTML = '<div class="tile-photo-wrap tile-photo-empty"><span class="tile-placeholder">Upload a photo or video</span></div>';
                    } else {
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
                        if (!useAsCustomerDisplay) {
                            tile.innerHTML = galleryHtml;
                        } else {
                            const resolvedEventKey = eventKey || localStorage.getItem('currentEvent') || 'pop-up';
                            const params = new URLSearchParams();
                            params.set('event', resolvedEventKey);
                            params.set('embedded', '1');
                            params.set('hideSettings', '1');
                            const src = '../pos/customer-display.html?' + params.toString();
                            tile.innerHTML = '<div class="tile-photo-display-switch"><div class="tile-photo-layer tile-photo-layer-gallery">' + galleryHtml + '</div><div class="tile-photo-layer tile-photo-layer-display" hidden><iframe class="tile-customer-display-iframe" src="' + escapeHtml(src) + '" loading="lazy" referrerpolicy="no-referrer"></iframe></div></div>';
                            const switchRoot = tile.querySelector('.tile-photo-display-switch');
                            const galleryLayer = switchRoot ? switchRoot.querySelector('.tile-photo-layer-gallery') : null;
                            const displayLayer = switchRoot ? switchRoot.querySelector('.tile-photo-layer-display') : null;
                            const eventForPolling = resolvedEventKey;
                            if (galleryLayer && displayLayer) {
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
                            }
                        }
                    }
                } else if (template === 'customer-display') {
                    const displayProps = (state.tileTemplateProps && state.tileTemplateProps[colIdx] && state.tileTemplateProps[colIdx][r]) || {};
                    const params = new URLSearchParams();
                    if (displayProps.eventKey) params.set('event', displayProps.eventKey);
                    params.set('embedded', '1');
                    if (!displayProps.showSettingsButton) params.set('hideSettings', '1');
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

        tileGridEl.querySelectorAll('.tile-photo-gallery').forEach(el => {
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

        state.columnRows.forEach((_, colIdx) => { syncRowHeightInputs(colIdx); });
        fitCanvasToPreview();
    }

    function fitCanvasToPreview() {
        if (!previewWrapEl || !canvasScalerEl || !canvasFitWrapperEl) return;
        const { w, h } = getCanvasDimensions();
        const wrapW = previewWrapEl.clientWidth;
        const wrapH = previewWrapEl.clientHeight;
        if (wrapW <= 0 || wrapH <= 0 || w <= 0 || h <= 0) return;
        // In fullscreen preview we allow upscaling so the menu maximizes
        // available screen space (important for iPad PWA).
        let scale = Math.min(wrapW / w, wrapH / h);
        if (!fullscreenPreviewActive) scale = Math.min(scale, 1);
        canvasFitWrapperEl.style.width = w * scale + 'px';
        canvasFitWrapperEl.style.height = h * scale + 'px';
        canvasScalerEl.style.width = w + 'px';
        canvasScalerEl.style.height = h + 'px';
        canvasScalerEl.style.transformOrigin = '0 0';
        canvasScalerEl.style.transform = 'scale(' + scale + ')';
    }

    function debounce(fn, ms) {
        let t;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    function init() {
        loadState();
        applyStateToForm();

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
                    loadDrinksFromFirebase().then(() => seedDrinksIfEmpty()).then(() => {
                        renderDrinksList();
                        renderColumnRowsSection();
                        renderTiles();
                    });
                }
            });
        });

        if (addDrinkBtnEl) addDrinkBtnEl.addEventListener('click', () => openDrinkModal());
        if (saveDrinkBtnEl) saveDrinkBtnEl.addEventListener('click', saveDrink);
        if (cancelDrinkBtnEl) cancelDrinkBtnEl.addEventListener('click', closeDrinkModal);
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
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && drinkModalBackdropEl && !drinkModalBackdropEl.hidden) closeDrinkModal();
            if (e.key === 'Escape' && menuSaveModalBackdropEl && !menuSaveModalBackdropEl.hidden) closeSaveMenuModal();
            if (e.key === 'Escape' && menuLoadModalBackdropEl && !menuLoadModalBackdropEl.hidden) closeLoadMenuModal();
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

        loadDrinksFromFirebase().then(() => seedDrinksIfEmpty()).then(() => {
            renderDrinksList();
            renderColumnRowsSection();
            renderTiles();
        });

        window.addEventListener('resize', () => {
            fitCanvasToPreview();
        });
    }

    init();
})();
