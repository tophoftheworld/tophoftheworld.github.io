(function () {
    'use strict';

    const STORAGE_KEY = 'matcha-supply-planner-v1';
    const VIEW_MODE_KEY = 'matcha-supply-view-mode';
    const BATCH_SHADE_COUNT = 6;
    const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

    function startOfWeekMonday(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        const day = d.getDay();
        const offset = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + offset);
        return d;
    }

    function addDays(date, n) {
        const d = new Date(date);
        d.setDate(d.getDate() + n);
        return d;
    }

    function formatISODate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function parseISODate(iso) {
        const [y, m, d] = iso.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    function humanDate(d) {
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function humanRange(start, end) {
        const sameYear = start.getFullYear() === end.getFullYear();
        const left = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const right = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
        const year = sameYear ? `, ${start.getFullYear()}` : '';
        return `${left} - ${right}${year}`;
    }

    function isToday(d) {
        const t = new Date();
        t.setHours(0, 0, 0, 0);
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        return t.getTime() === x.getTime();
    }

    function generateId(prefix) {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function loadStore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { weeks: {}, batches: [], rowCatalog: [] };
            const parsed = JSON.parse(raw);
            if (!parsed.weeks || typeof parsed.weeks !== 'object') return { weeks: {}, batches: [], rowCatalog: [] };
            if (!Array.isArray(parsed.batches)) parsed.batches = [];
            if (!Array.isArray(parsed.rowCatalog)) parsed.rowCatalog = [];
            return parsed;
        } catch (_) {
            return { weeks: {}, batches: [], rowCatalog: [] };
        }
    }

    function saveStore() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }

    function emptyWeekDoc() {
        return { rows: [], allocations: [], orderTargetKg: '' };
    }

    function getWeekDoc(key) {
        if (!store.weeks[key]) store.weeks[key] = emptyWeekDoc();
        const doc = store.weeks[key];
        if (!Array.isArray(doc.rows)) doc.rows = [];
        if (!Array.isArray(doc.allocations)) doc.allocations = [];
        return doc;
    }

    function ensureRowInWeek(weekKey, rowId, label) {
        const doc = getWeekDoc(weekKey);
        const exists = doc.rows.some((r) => r.id === rowId);
        if (!exists) doc.rows.push({ id: rowId, label: label || getRowLabelById(rowId) || rowId });
    }

    function syncRowCatalogFromWeeks() {
        if (!Array.isArray(store.rowCatalog)) store.rowCatalog = [];
        const seen = new Set(store.rowCatalog.map((r) => r.id));
        const labelById = {};
        Object.values(store.weeks).forEach((w) => {
            (w.rows || []).forEach((r) => {
                if (!seen.has(r.id)) {
                    store.rowCatalog.push({ id: r.id, label: r.label });
                    seen.add(r.id);
                }
                labelById[r.id] = r.label;
            });
        });
        store.rowCatalog = store.rowCatalog.map((r) => ({ id: r.id, label: labelById[r.id] || r.label }));
    }

    function getRowLabelById(rowId) {
        const row = (store.rowCatalog || []).find((r) => r.id === rowId);
        return row ? row.label : '';
    }

    function upsertRowInCatalog(rowId, label) {
        const idx = store.rowCatalog.findIndex((r) => r.id === rowId);
        if (idx >= 0) store.rowCatalog[idx].label = label;
        else store.rowCatalog.push({ id: rowId, label });
    }

    function removeRowFromCatalog(rowId) {
        store.rowCatalog = store.rowCatalog.filter((r) => r.id !== rowId);
    }

    function getBatches() {
        if (!Array.isArray(store.batches)) store.batches = [];
        return store.batches;
    }

    function getBatchById(batchId) {
        return getBatches().find((b) => b.id === batchId) || null;
    }

    function createBatch(name) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return null;
        const existing = getBatches().find((b) => b.name.toLowerCase() === trimmed.toLowerCase());
        if (existing) return existing;
        const batch = {
            id: generateId('batch'),
            name: trimmed,
            shadeIndex: getBatches().length % BATCH_SHADE_COUNT,
            createdAt: Date.now(),
        };
        store.batches.push(batch);
        return batch;
    }

    function formatGramsDisplay(g) {
        if (g >= 1000) {
            const kg = g / 1000;
            return `${kg % 1 === 0 ? kg : kg.toFixed(1)} kg`;
        }
        return `${g} g`;
    }

    function openModal(el) { el.classList.add('is-open'); }
    function closeModal(el) { el.classList.remove('is-open'); }

    function toast(msg, type) {
        const t = document.createElement('div');
        t.className = `toast ${type ? `toast-${type}` : ''}`.trim();
        t.textContent = msg;
        toastContainer.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    let confirmResolver = null;
    function confirmAction(message, dangerLabel) {
        confirmMessage.textContent = message;
        confirmOkBtn.textContent = dangerLabel || 'Confirm';
        openModal(confirmModal);
        return new Promise((resolve) => { confirmResolver = resolve; });
    }

    function resolveConfirm(value) {
        if (confirmResolver) confirmResolver(value);
        confirmResolver = null;
        closeModal(confirmModal);
    }

    function getVisibleDayCount() {
        return viewMode === '2w' ? 14 : 7;
    }

    function getVisibleDays() {
        const count = getVisibleDayCount();
        return Array.from({ length: count }, (_, i) => addDays(currentWeekStart, i));
    }

    function getWeekKeyForGlobalDay(globalDay) {
        const offsetWeek = Math.floor(globalDay / 7);
        return formatISODate(addDays(currentWeekStart, offsetWeek * 7));
    }

    function toLocalDay(globalDay) {
        return ((globalDay % 7) + 7) % 7;
    }

    function normalizeAllocation(raw) {
        const localDay = Math.max(0, Math.min(6, parseInt(raw.startDayIndex, 10) || 0));
        let span = Math.max(1, parseInt(raw.spanDays, 10) || 1);
        if (localDay + span > 7) span = 7 - localDay;
        const parsedGrams = parseInt(raw.grams, 10);
        const grams = parsedGrams >= 500 && parsedGrams <= 3000 && parsedGrams % 500 === 0 ? parsedGrams : 1000;
        const shipmentRef = (raw.shipmentRef || '').trim();
        const batchId = raw.batchId ? String(raw.batchId) : '';
        return {
            id: raw.id || generateId('alloc'),
            linkId: raw.linkId || null,
            rowId: raw.rowId,
            startDayIndex: localDay,
            spanDays: span,
            grams,
            shipmentRef: shipmentRef || undefined,
            batchId: batchId || undefined,
        };
    }

    function weekHasContent(weekKey) {
        const doc = getWeekDoc(weekKey);
        return doc.rows.length > 0 || doc.allocations.length > 0;
    }

    function periodHasContent() {
        const cur = formatISODate(currentWeekStart);
        if (viewMode === '1w') return weekHasContent(cur);
        const next = formatISODate(addDays(currentWeekStart, 7));
        return weekHasContent(cur) || weekHasContent(next);
    }

    function getDisplayRows() {
        return (store.rowCatalog || []).map((r) => ({ id: r.id, label: r.label }));
    }

    function groupAllocationsForRow(rowId) {
        const visibleCount = getVisibleDayCount();
        const allocs = [];
        const weekOffsets = viewMode === '2w' ? [-1, 0, 1, 2] : [-1, 0, 1];

        weekOffsets.forEach((weekOffset) => {
            const weekKey = formatISODate(addDays(currentWeekStart, weekOffset * 7));
            const doc = getWeekDoc(weekKey);
            doc.allocations.forEach((a) => {
                if (a.rowId !== rowId) return;
                const start = weekOffset * 7 + a.startDayIndex;
                const endEx = start + a.spanDays;
                if (start >= visibleCount || endEx <= 0) return;
                allocs.push({
                    sourceWeekKey: weekKey,
                    sourceAllocId: a.id,
                    linkId: a.linkId || null,
                    rowId: a.rowId,
                    start,
                    endEx,
                    grams: a.grams,
                    shipmentRef: a.shipmentRef || '',
                    batchId: a.batchId || '',
                });
            });
        });

        allocs.sort((a, b) => a.start - b.start);
        const grouped = [];
        const used = new Set();

        allocs.forEach((a, idx) => {
            if (used.has(idx)) return;
            const members = [a];
            used.add(idx);
            if (a.linkId) {
                for (let j = idx + 1; j < allocs.length; j++) {
                    const b = allocs[j];
                    if (used.has(j)) continue;
                    if (
                        b.linkId === a.linkId &&
                        b.rowId === a.rowId &&
                        b.grams === a.grams &&
                        b.shipmentRef === a.shipmentRef &&
                        b.batchId === a.batchId
                    ) {
                        members.push(b);
                        used.add(j);
                    }
                }
            }
            members.sort((x, y) => x.start - y.start);
            const fullStart = members[0].start;
            const fullEndEx = members[members.length - 1].endEx;
            const start = Math.max(0, fullStart);
            const endEx = Math.min(visibleCount, fullEndEx);
            grouped.push({
                id: members.length > 1 ? members[0].linkId : members[0].sourceAllocId,
                rowId,
                start,
                endEx,
                grams: members[0].grams,
                shipmentRef: members[0].shipmentRef,
                batchId: members[0].batchId || '',
                continuesFromPrev: fullStart < 0,
                continuesToNext: fullEndEx > visibleCount,
                members,
            });
        });

        return grouped;
    }

    function buildAllVirtualClipsMap() {
        const rows = getDisplayRows();
        const map = {};
        rows.forEach((r) => { map[r.id] = groupAllocationsForRow(r.id); });
        return map;
    }

    function hasRowConflict(rowId, start, endEx, excludeSourceIds) {
        const clips = buildAllVirtualClipsMap()[rowId] || [];
        return clips.some((c) => {
            const memberIds = c.members.map((m) => m.sourceAllocId);
            const ignored = memberIds.some((id) => excludeSourceIds.has(id));
            if (ignored) return false;
            return !(endEx <= c.start || c.endEx <= start);
        });
    }

    function removeMembers(members) {
        members.forEach((m) => {
            const doc = getWeekDoc(m.sourceWeekKey);
            doc.allocations = doc.allocations.filter((a) => a.id !== m.sourceAllocId);
        });
    }

    function writeSegments(rowId, label, start, endEx, grams, shipmentRef, linkId, batchId) {
        const firstEndEx = Math.min(endEx, 7);
        const secondStart = Math.max(start, 7);
        const curKey = formatISODate(currentWeekStart);
        const nextKey = formatISODate(addDays(currentWeekStart, 7));

        if (start < 7 && firstEndEx > start) {
            ensureRowInWeek(curKey, rowId, label);
            getWeekDoc(curKey).allocations.push(normalizeAllocation({
                id: generateId('alloc'),
                linkId: endEx > 7 ? linkId : null,
                rowId,
                startDayIndex: start,
                spanDays: firstEndEx - start,
                grams,
                shipmentRef,
                batchId,
            }));
        }
        if (endEx > 7 && secondStart < endEx) {
            ensureRowInWeek(nextKey, rowId, label);
            getWeekDoc(nextKey).allocations.push(normalizeAllocation({
                id: generateId('alloc'),
                linkId,
                rowId,
                startDayIndex: secondStart - 7,
                spanDays: endEx - secondStart,
                grams,
                shipmentRef,
                batchId,
            }));
        }
    }

    const weekTitle = document.getElementById('weekTitle');
    const prevWeekBtn = document.getElementById('prevWeekBtn');
    const nextWeekBtn = document.getElementById('nextWeekBtn');
    const oneWeekViewBtn = document.getElementById('oneWeekViewBtn');
    const twoWeekViewBtn = document.getElementById('twoWeekViewBtn');
    const copyPrevBtn = document.getElementById('copyPrevBtn');

    const gridHeader = document.getElementById('gridHeader');
    const gridBody = document.getElementById('gridBody');
    const summaryLabel = document.getElementById('summaryLabel');
    const summaryAllocated = document.getElementById('summaryAllocated');
    const orderTargetKg = document.getElementById('orderTargetKg');
    const targetHint = document.getElementById('targetHint');
    const addRowBtn = document.getElementById('addRowBtn');
    const toastContainer = document.getElementById('toastContainer');

    const allocationModal = document.getElementById('allocationModal');
    const allocationForm = document.getElementById('allocationForm');
    const allocIdInput = document.getElementById('allocId');
    const allocRowIdInput = document.getElementById('allocRowId');
    const allocStartDay = document.getElementById('allocStartDay');
    const allocSpanDays = document.getElementById('allocSpanDays');
    const allocGrams = document.getElementById('allocGrams');
    const allocShipmentRef = document.getElementById('allocShipmentRef');
    const allocBatchId = document.getElementById('allocBatchId');
    const newBatchBtn = document.getElementById('newBatchBtn');
    const batchDetails = document.getElementById('batchDetails');
    const allocationModalTitle = document.getElementById('allocationModalTitle');
    const deleteAllocationBtn = document.getElementById('deleteAllocationBtn');
    const closeAllocationModal = document.getElementById('closeAllocationModal');
    const cancelAllocationBtn = document.getElementById('cancelAllocationBtn');
    const shipmentSuggestions = document.getElementById('shipmentSuggestions');

    const rowModal = document.getElementById('rowModal');
    const rowForm = document.getElementById('rowForm');
    const rowModalTitle = document.getElementById('rowModalTitle');
    const rowEditId = document.getElementById('rowEditId');
    const rowLabelInput = document.getElementById('rowLabelInput');
    const closeRowModal = document.getElementById('closeRowModal');
    const cancelRowBtn = document.getElementById('cancelRowBtn');

    const confirmModal = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const closeConfirmModal = document.getElementById('closeConfirmModal');
    const confirmCancelBtn = document.getElementById('confirmCancelBtn');
    const confirmOkBtn = document.getElementById('confirmOkBtn');

    const copyModeModal = document.getElementById('copyModeModal');
    const closeCopyModeModal = document.getElementById('closeCopyModeModal');
    const copyRowsOnlyBtn = document.getElementById('copyRowsOnlyBtn');
    const copyFullWeekBtn = document.getElementById('copyFullWeekBtn');
    const batchModal = document.getElementById('batchModal');
    const batchForm = document.getElementById('batchForm');
    const batchNameInput = document.getElementById('batchNameInput');
    const closeBatchModal = document.getElementById('closeBatchModal');
    const cancelBatchBtn = document.getElementById('cancelBatchBtn');

    let store = loadStore();
    syncRowCatalogFromWeeks();
    saveStore();
    let currentWeekStart = startOfWeekMonday(new Date());
    let viewMode = localStorage.getItem(VIEW_MODE_KEY) === '2w' ? '2w' : '1w';
    let resizeSession = null;
    let activeRowMenu = null;
    let createDragSession = null;
    let moveDragSession = null;

    function updateWeekTitle() {
        const end = addDays(currentWeekStart, getVisibleDayCount() - 1);
        weekTitle.textContent = humanRange(currentWeekStart, end);
    }

    function collectShipmentOptions() {
        const set = new Set();
        Object.values(store.weeks).forEach((w) => {
            (w.allocations || []).forEach((a) => {
                if (a.shipmentRef) set.add(a.shipmentRef);
            });
        });
        shipmentSuggestions.innerHTML = '';
        [...set].slice(0, 50).forEach((s) => {
            const op = document.createElement('option');
            op.value = s;
            shipmentSuggestions.appendChild(op);
        });
    }

    function renderBatchOptions(selectedBatchId) {
        allocBatchId.innerHTML = '';
        const none = document.createElement('option');
        none.value = '';
        none.textContent = 'Unbatched';
        allocBatchId.appendChild(none);
        getBatches().forEach((b) => {
            const op = document.createElement('option');
            op.value = b.id;
            op.textContent = b.name;
            allocBatchId.appendChild(op);
        });
        allocBatchId.value = selectedBatchId || '';
        updateBatchDetails();
    }

    function updateBatchDetails() {
        const batchId = allocBatchId.value;
        if (!batchId) {
            batchDetails.textContent = 'Unbatched';
            return;
        }
        const batch = getBatchById(batchId);
        if (!batch) {
            batchDetails.textContent = 'Unbatched';
            return;
        }
        const created = batch.createdAt ? new Date(batch.createdAt).toLocaleDateString() : '';
        batchDetails.textContent = created ? `${batch.name} · created ${created}` : batch.name;
    }

    function renderSummary() {
        const curKey = formatISODate(currentWeekStart);
        const curDoc = getWeekDoc(curKey);
        let target = parseFloat(curDoc.orderTargetKg || '');

        // Sum by rendered clip groups so cross-week linked segments
        // count as one allocation in totals.
        const allClips = buildAllVirtualClipsMap();
        let total = 0;
        Object.values(allClips).forEach((clips) => {
            clips.forEach((clip) => {
                total += clip.grams || 0;
            });
        });

        if (viewMode === '2w') {
            const nextKey = formatISODate(addDays(currentWeekStart, 7));
            const nextDoc = getWeekDoc(nextKey);
            summaryLabel.textContent = 'Total allocated for selected period';
            const t2 = parseFloat(nextDoc.orderTargetKg || '');
            if (!Number.isNaN(t2)) target = (Number.isNaN(target) ? 0 : target) + t2;
        } else {
            summaryLabel.textContent = 'Total allocated this week';
        }

        const kg = total / 1000;
        const kgStr = kg % 1 === 0 ? String(kg) : kg.toFixed(2).replace(/\.?0+$/, '');
        summaryAllocated.textContent = total >= 1000 ? `${kgStr} kg (${total.toLocaleString()} g)` : `${total} g`;

        if (viewMode === '1w') {
            orderTargetKg.value = curDoc.orderTargetKg || '';
            orderTargetKg.disabled = false;
        } else {
            const curVal = parseFloat(curDoc.orderTargetKg || '');
            const nextVal = parseFloat(getWeekDoc(formatISODate(addDays(currentWeekStart, 7))).orderTargetKg || '');
            const sum = (Number.isNaN(curVal) ? 0 : curVal) + (Number.isNaN(nextVal) ? 0 : nextVal);
            orderTargetKg.value = sum > 0 ? String(sum) : '';
            orderTargetKg.disabled = true;
        }

        targetHint.textContent = '';
        targetHint.className = 'target-hint';
        if (!Number.isNaN(target) && target > 0) {
            const diff = kg - target;
            if (diff > 0.05) {
                targetHint.textContent = `Over target by ~${diff.toFixed(2)} kg`;
                targetHint.classList.add('over');
            } else if (diff < -0.05) {
                targetHint.textContent = `Under target by ~${Math.abs(diff).toFixed(2)} kg`;
                targetHint.classList.add('under');
            } else {
                targetHint.textContent = 'Near target';
            }
        }
    }

    function buildStartDaySelect(selected) {
        const days = getVisibleDays();
        allocStartDay.innerHTML = '';
        days.forEach((d, i) => {
            const op = document.createElement('option');
            op.value = String(i);
            op.textContent = `${DAY_NAMES[DOW_ORDER.indexOf(d.getDay())]} (${humanDate(d)})`;
            allocStartDay.appendChild(op);
        });
        allocStartDay.value = String(selected);
    }

    function setMaxSpanByStart() {
        const start = parseInt(allocStartDay.value, 10) || 0;
        allocSpanDays.max = String(getVisibleDayCount() - start);
        const span = parseInt(allocSpanDays.value, 10) || 1;
        if (start + span > getVisibleDayCount()) allocSpanDays.value = String(getVisibleDayCount() - start);
    }

    function openAddAllocation(rowId, dayIndex) {
        collectShipmentOptions();
        renderBatchOptions('');
        allocationModalTitle.textContent = 'Add allocation';
        allocIdInput.value = '';
        allocRowIdInput.value = rowId;
        buildStartDaySelect(dayIndex);
        allocSpanDays.value = '1';
        setMaxSpanByStart();
        allocGrams.value = '1000';
        allocShipmentRef.value = '';
        deleteAllocationBtn.style.display = 'none';
        openModal(allocationModal);
    }

    function openEditAllocation(clip) {
        collectShipmentOptions();
        renderBatchOptions(clip.batchId || '');
        allocationModalTitle.textContent = 'Edit allocation';
        allocIdInput.value = clip.id;
        allocRowIdInput.value = clip.rowId;
        buildStartDaySelect(clip.start);
        allocSpanDays.value = String(clip.endEx - clip.start);
        setMaxSpanByStart();
        allocGrams.value = String(clip.grams);
        allocShipmentRef.value = clip.shipmentRef || '';
        deleteAllocationBtn.style.display = 'inline-block';
        openModal(allocationModal);
    }

    function closeAllMenus() {
        if (activeRowMenu) activeRowMenu.classList.remove('is-open');
        activeRowMenu = null;
    }

    function openAddRowModal() {
        rowModalTitle.textContent = 'Add row';
        rowEditId.value = '';
        rowLabelInput.value = '';
        openModal(rowModal);
    }

    function getDayIndexFromPointer(trackWrap, dayCount, clientX) {
        const rect = trackWrap.getBoundingClientRect();
        const x = clientX - rect.left;
        let day = Math.floor((x / rect.width) * dayCount);
        day = Math.max(0, Math.min(dayCount - 1, day));
        return day;
    }

    function updateCreatePreview() {
        if (!createDragSession) return;
        const { previewEl, dayCount, startDay, currentDay } = createDragSession;
        const minDay = Math.min(startDay, currentDay);
        const maxDay = Math.max(startDay, currentDay);
        const inset = 3;
        previewEl.style.left = `calc(${(minDay / dayCount) * 100}% + ${inset}px)`;
        previewEl.style.width = `calc(${(((maxDay - minDay) + 1) / dayCount) * 100}% - ${inset * 2}px)`;
    }

    function renderGrid() {
        const visibleDays = getVisibleDays();
        const dayCount = visibleDays.length;
        const columns = `180px repeat(${dayCount}, 1fr)`;

        gridHeader.style.gridTemplateColumns = columns;
        gridHeader.innerHTML = '';
        const corner = document.createElement('div');
        corner.className = 'grid-header-corner';
        corner.textContent = 'Allocation';
        gridHeader.appendChild(corner);

        visibleDays.forEach((d, i) => {
            const dayIndex = DOW_ORDER.indexOf(d.getDay());
            const h = document.createElement('div');
            h.className = `grid-day-header${isToday(d) ? ' is-today' : ''}`;
            h.innerHTML = `<div class="day-name">${DAY_NAMES[dayIndex]}</div><div class="day-date">${humanDate(d)}</div>`;
            gridHeader.appendChild(h);
        });

        const rows = getDisplayRows();
        gridBody.innerHTML = '';
        if (!rows.length) {
            const empty = document.createElement('div');
            empty.className = 'grid-empty';
            empty.textContent = 'No rows yet. Use the empty row below to add one.';
            gridBody.appendChild(empty);
        }
        const allClips = buildAllVirtualClipsMap();
        rows.forEach((row) => {
            const rowEl = document.createElement('div');
            rowEl.className = 'supply-row';
            rowEl.style.gridTemplateColumns = '180px 1fr';

            const labelCell = document.createElement('div');
            labelCell.className = 'row-label-cell';
            const name = document.createElement('div');
            name.className = 'row-name';
            name.textContent = row.label;
            name.title = row.label;

            const menuWrap = document.createElement('div');
            menuWrap.className = 'row-menu-wrap';
            const menuBtn = document.createElement('button');
            menuBtn.type = 'button';
            menuBtn.className = 'row-menu-btn';
            menuBtn.textContent = '⋯';

            const menu = document.createElement('div');
            menu.className = 'row-menu';
            menu.innerHTML = `
                <button type="button" class="row-menu-item" data-action="rename">Rename</button>
                <button type="button" class="row-menu-item" data-action="up">Move up</button>
                <button type="button" class="row-menu-item" data-action="down">Move down</button>
                <button type="button" class="row-menu-item row-menu-delete" data-action="delete">Delete</button>
            `;

            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activeRowMenu && activeRowMenu !== menu) activeRowMenu.classList.remove('is-open');
                menu.classList.toggle('is-open');
                activeRowMenu = menu.classList.contains('is-open') ? menu : null;
            });

            menu.addEventListener('click', async (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                const action = btn.getAttribute('data-action');
                closeAllMenus();
                if (action === 'rename') {
                    rowModalTitle.textContent = 'Rename allocation row';
                    rowEditId.value = row.id;
                    rowLabelInput.value = row.label;
                    openModal(rowModal);
                } else if (action === 'up') {
                    moveRow(row.id, -1);
                } else if (action === 'down') {
                    moveRow(row.id, 1);
                } else if (action === 'delete') {
                    const ok = await confirmAction(`Delete "${row.label}" and all allocations across all weeks?`, 'Delete row');
                    if (ok) deleteRow(row.id);
                }
            });

            menuWrap.appendChild(menuBtn);
            menuWrap.appendChild(menu);
            labelCell.appendChild(name);
            labelCell.appendChild(menuWrap);

            const trackWrap = document.createElement('div');
            trackWrap.className = 'track-wrap';
            trackWrap.dataset.rowId = row.id;
            const bg = document.createElement('div');
            bg.className = 'track-bg';
            bg.style.gridTemplateColumns = `repeat(${dayCount}, 1fr)`;

            for (let i = 0; i < dayCount; i++) {
                const cell = document.createElement('div');
                cell.className = 'track-cell';
                cell.dataset.dayIndex = String(i);
                bg.appendChild(cell);
            }

            const lane = document.createElement('div');
            lane.className = 'track-lane';
            const rowClips = allClips[row.id] || [];
            rowClips.forEach((clip) => lane.appendChild(buildClipEl(clip, row, dayCount, trackWrap)));

            bg.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                if (e.target.closest('.allocation-clip')) return;
                const startDay = getDayIndexFromPointer(trackWrap, dayCount, e.clientX);
                const previewEl = document.createElement('div');
                previewEl.className = 'track-selection-preview';
                lane.appendChild(previewEl);

                createDragSession = {
                    rowId: row.id,
                    dayCount,
                    trackWrap,
                    lane,
                    pointerId: e.pointerId,
                    captureEl: bg,
                    startDay,
                    currentDay: startDay,
                    moved: false,
                    previewEl,
                };
                bg.setPointerCapture(e.pointerId);
                updateCreatePreview();
                e.preventDefault();
            });

            bg.addEventListener('pointermove', (e) => {
                if (!createDragSession) return;
                if (e.pointerId !== createDragSession.pointerId) return;
                const day = getDayIndexFromPointer(trackWrap, dayCount, e.clientX);
                if (day !== createDragSession.currentDay) {
                    createDragSession.currentDay = day;
                    createDragSession.moved = true;
                    updateCreatePreview();
                }
            });

            const finishCreateDrag = (e, canceled) => {
                if (!createDragSession) return;
                if (e.pointerId !== createDragSession.pointerId) return;
                const session = createDragSession;
                createDragSession = null;
                try { session.captureEl.releasePointerCapture(session.pointerId); } catch (_) {}
                if (session.previewEl && session.previewEl.parentElement) {
                    session.previewEl.parentElement.removeChild(session.previewEl);
                }
                if (canceled) return;
                const minDay = Math.min(session.startDay, session.currentDay);
                const maxDay = Math.max(session.startDay, session.currentDay);
                openAddAllocation(session.rowId, minDay);
                allocSpanDays.value = String((maxDay - minDay) + 1);
                setMaxSpanByStart();
            };

            bg.addEventListener('pointerup', (e) => finishCreateDrag(e, false));
            bg.addEventListener('pointercancel', (e) => finishCreateDrag(e, true));

            trackWrap.appendChild(bg);
            trackWrap.appendChild(lane);
            rowEl.appendChild(labelCell);
            rowEl.appendChild(trackWrap);
            gridBody.appendChild(rowEl);
        });

        const addRowLine = document.createElement('div');
        addRowLine.className = 'add-row-line';
        addRowLine.style.gridTemplateColumns = '180px 1fr';
        addRowLine.innerHTML = `
            <div class="add-row-label-cell">
                <button type="button" class="add-row-inline-btn" id="addRowInlineBtn">+ Add row</button>
            </div>
            <div class="add-row-track-cell"></div>
        `;
        const addRowInlineBtn = addRowLine.querySelector('#addRowInlineBtn');
        addRowInlineBtn.addEventListener('click', openAddRowModal);
        gridBody.appendChild(addRowLine);
    }

    function clipLabel(start, endEx, grams) {
        return `${formatGramsDisplay(grams)}`;
    }

    function buildClipEl(clip, row, dayCount, trackWrap) {
        const inset = 3;
        const el = document.createElement('div');
        el.className = 'allocation-clip';
        if (clip.batchId) {
            const batch = getBatchById(clip.batchId);
            if (batch) el.classList.add(`batch-shade-${(batch.shadeIndex % BATCH_SHADE_COUNT) + 1}`);
        }
        if (clip.continuesFromPrev) el.classList.add('continues-prev');
        if (clip.continuesToNext) el.classList.add('continues-next');
        el.style.left = `calc(${(clip.start / dayCount) * 100}% + ${inset}px)`;
        el.style.width = `calc(${((clip.endEx - clip.start) / dayCount) * 100}% - ${inset * 2}px)`;

        const left = document.createElement('div');
        left.className = 'clip-handle clip-handle-left';
        const body = document.createElement('div');
        body.className = 'clip-body';
        body.textContent = clipLabel(clip.start, clip.endEx, clip.grams);
        const s = getVisibleDays()[clip.start];
        const e = getVisibleDays()[clip.endEx - 1];
        const sName = DAY_NAMES[DOW_ORDER.indexOf(s.getDay())];
        const eName = DAY_NAMES[DOW_ORDER.indexOf(e.getDay())];
        const batchName = clip.batchId ? (getBatchById(clip.batchId)?.name || 'Unbatched') : 'Unbatched';
        el.title = `${formatGramsDisplay(clip.grams)} · ${sName}-${eName} · ${batchName}`;
        const right = document.createElement('div');
        right.className = 'clip-handle clip-handle-right';

        el.appendChild(left);
        el.appendChild(body);
        el.appendChild(right);
        let suppressClickOnce = false;

        body.addEventListener('click', (e) => {
            e.stopPropagation();
            if (resizeSession) return;
            if (suppressClickOnce) {
                suppressClickOnce = false;
                return;
            }
            openEditAllocation(clip);
        });

        function getRowById(rowId) {
            return getDisplayRows().find((r) => r.id === rowId);
        }

        function applyMovePreview(targetRowId, targetStart, targetEndEx, isValid) {
            clip.rowId = targetRowId;
            clip.start = targetStart;
            clip.endEx = targetEndEx;
            el.style.left = `calc(${(clip.start / dayCount) * 100}% + ${inset}px)`;
            el.style.width = `calc(${((clip.endEx - clip.start) / dayCount) * 100}% - ${inset * 2}px)`;
            body.textContent = clipLabel(clip.start, clip.endEx, clip.grams);
            const rowName = getRowById(targetRowId)?.label || '';
            const batchNamePreview = clip.batchId ? (getBatchById(clip.batchId)?.name || 'Unbatched') : 'Unbatched';
            el.title = `${formatGramsDisplay(clip.grams)} · ${rowName} · ${batchNamePreview}`;
            el.classList.toggle('drag-invalid', !isValid);
        }

        function startMoveDrag(ev) {
            if (ev.button !== 0) return;
            ev.preventDefault();
            ev.stopPropagation();
            const dragGhost = el.cloneNode(true);
            dragGhost.classList.add('drag-ghost');
            dragGhost.classList.remove('is-dragging', 'drag-invalid');
            document.body.appendChild(dragGhost);

            const rect = el.getBoundingClientRect();
            const offsetX = ev.clientX - rect.left;
            const offsetY = ev.clientY - rect.top;

            moveDragSession = {
                clip,
                row,
                dayCount,
                pointerId: ev.pointerId,
                captureEl: body,
                startClientX: ev.clientX,
                startClientY: ev.clientY,
                ghostOffsetX: offsetX,
                ghostOffsetY: offsetY,
                dragGhost,
                moved: false,
                originalRowId: clip.rowId,
                originalStart: clip.start,
                originalEndEx: clip.endEx,
                targetRowId: clip.rowId,
                targetStart: clip.start,
                targetEndEx: clip.endEx,
                valid: true,
            };
            el.classList.add('is-dragging');
            dragGhost.style.width = `${rect.width}px`;
            dragGhost.style.height = `${rect.height}px`;
            dragGhost.style.left = `${ev.clientX - offsetX}px`;
            dragGhost.style.top = `${ev.clientY - offsetY}px`;
            body.setPointerCapture(ev.pointerId);
        }

        function onMoveDrag(ev) {
            if (!moveDragSession || moveDragSession.clip.id !== clip.id) return;
            if (ev.pointerId !== moveDragSession.pointerId) return;
            const dx = Math.abs(ev.clientX - moveDragSession.startClientX);
            const dy = Math.abs(ev.clientY - moveDragSession.startClientY);
            if (!moveDragSession.moved && (dx > 3 || dy > 3)) {
                moveDragSession.moved = true;
                suppressClickOnce = true;
            }
            if (moveDragSession.dragGhost) {
                moveDragSession.dragGhost.style.left = `${ev.clientX - moveDragSession.ghostOffsetX}px`;
                moveDragSession.dragGhost.style.top = `${ev.clientY - moveDragSession.ghostOffsetY}px`;
            }
            const hitEl = document.elementFromPoint(ev.clientX, ev.clientY);
            const targetTrack = hitEl ? hitEl.closest('.track-wrap') : null;
            let targetRowId = moveDragSession.targetRowId;
            let targetTrackEl = trackWrap;
            if (targetTrack && targetTrack.dataset.rowId) {
                targetRowId = targetTrack.dataset.rowId;
                targetTrackEl = targetTrack;
            }
            const span = moveDragSession.originalEndEx - moveDragSession.originalStart;
            const day = getDayIndexFromPointer(targetTrackEl, dayCount, ev.clientX);
            const targetStart = Math.max(0, Math.min(dayCount - span, day));
            const targetEndEx = targetStart + span;
            const excludeIds = new Set(clip.members.map((m) => m.sourceAllocId));
            const valid = !hasRowConflict(targetRowId, targetStart, targetEndEx, excludeIds);
            moveDragSession.targetRowId = targetRowId;
            moveDragSession.targetStart = targetStart;
            moveDragSession.targetEndEx = targetEndEx;
            moveDragSession.valid = valid;
            applyMovePreview(targetRowId, targetStart, targetEndEx, valid);
        }

        function finishMoveDrag(ev, canceled) {
            if (!moveDragSession || moveDragSession.clip.id !== clip.id) return;
            if (ev.pointerId !== moveDragSession.pointerId) return;
            try { moveDragSession.captureEl.releasePointerCapture(moveDragSession.pointerId); } catch (_) {}
            el.classList.remove('is-dragging');
            el.classList.remove('drag-invalid');
            const session = moveDragSession;
            moveDragSession = null;
            if (session.dragGhost && session.dragGhost.parentElement) {
                session.dragGhost.parentElement.removeChild(session.dragGhost);
            }

            if (canceled) {
                render();
                return;
            }

            if (!session.moved) {
                openEditAllocation(clip);
                render();
                return;
            }

            if (!session.valid) {
                render();
                return;
            }

            const targetRow = getRowById(session.targetRowId);
            if (!targetRow) {
                render();
                return;
            }

            removeMembers(clip.members);
            const linkId = session.targetEndEx > 7 && session.targetStart < 7 ? generateId('link') : null;
            writeSegments(session.targetRowId, targetRow.label, session.targetStart, session.targetEndEx, clip.grams, clip.shipmentRef, linkId, clip.batchId || '');
            saveStore();
            render();
        }

        function startResize(edge, ev) {
            ev.preventDefault();
            ev.stopPropagation();
            resizeSession = {
                edge,
                clip,
                row,
                dayCount,
                trackEl: trackWrap,
                pointerId: ev.pointerId,
                captureEl: ev.currentTarget,
            };
            el.classList.add('is-resizing');
            resizeSession.captureEl.setPointerCapture(ev.pointerId);
        }

        function onMove(e) {
            if (!resizeSession || resizeSession.clip.id !== clip.id) return;
            const rect = resizeSession.trackEl.getBoundingClientRect();
            const x = e.clientX - rect.left;
            let day = Math.floor((x / rect.width) * dayCount);
            day = Math.max(0, Math.min(dayCount - 1, day));

            let newStart = clip.start;
            let newEndEx = clip.endEx;
            if (resizeSession.edge === 'left') {
                newStart = Math.min(day, clip.endEx - 1);
            } else {
                newEndEx = Math.max(day + 1, clip.start + 1);
            }
            if (newStart < 0) newStart = 0;
            if (newEndEx > dayCount) newEndEx = dayCount;

            const excludeIds = new Set(clip.members.map((m) => m.sourceAllocId));
            if (hasRowConflict(clip.rowId, newStart, newEndEx, excludeIds)) return;

            clip.start = newStart;
            clip.endEx = newEndEx;
            el.style.left = `calc(${(clip.start / dayCount) * 100}% + ${inset}px)`;
            el.style.width = `calc(${((clip.endEx - clip.start) / dayCount) * 100}% - ${inset * 2}px)`;
            body.textContent = clipLabel(clip.start, clip.endEx, clip.grams);
        }

        function onUp(e) {
            if (!resizeSession || resizeSession.clip.id !== clip.id) return;
            if (e.pointerId !== resizeSession.pointerId) return;
            try { resizeSession.captureEl.releasePointerCapture(resizeSession.pointerId); } catch (_) {}
            el.classList.remove('is-resizing');
            resizeSession = null;

            const excludeIds = new Set(clip.members.map((m) => m.sourceAllocId));
            if (hasRowConflict(clip.rowId, clip.start, clip.endEx, excludeIds)) {
                render();
                return;
            }

            removeMembers(clip.members);
            const linkId = clip.endEx > 7 && clip.start < 7 ? generateId('link') : null;
            writeSegments(clip.rowId, row.label, clip.start, clip.endEx, clip.grams, clip.shipmentRef, linkId, clip.batchId || '');
            saveStore();
            render();
        }

        left.addEventListener('pointerdown', (e) => startResize('left', e));
        right.addEventListener('pointerdown', (e) => startResize('right', e));
        body.addEventListener('pointerdown', startMoveDrag);
        body.addEventListener('pointermove', onMoveDrag);
        body.addEventListener('pointerup', (e) => finishMoveDrag(e, false));
        body.addEventListener('pointercancel', (e) => finishMoveDrag(e, true));
        left.addEventListener('pointermove', onMove);
        right.addEventListener('pointermove', onMove);
        left.addEventListener('pointerup', onUp);
        right.addEventListener('pointerup', onUp);
        left.addEventListener('pointercancel', onUp);
        right.addEventListener('pointercancel', onUp);

        return el;
    }

    function updateCopyVisibility() {
        copyPrevBtn.classList.toggle('is-hidden', periodHasContent());
    }

    function render() {
        oneWeekViewBtn.classList.toggle('is-active', viewMode === '1w');
        twoWeekViewBtn.classList.toggle('is-active', viewMode === '2w');
        updateWeekTitle();
        updateCopyVisibility();
        renderSummary();
        renderGrid();
    }

    function moveRow(rowId, delta) {
        const idx = store.rowCatalog.findIndex((r) => r.id === rowId);
        if (idx < 0) return;
        const nidx = idx + delta;
        if (nidx < 0 || nidx >= store.rowCatalog.length) return;
        const tmp = store.rowCatalog[idx];
        store.rowCatalog[idx] = store.rowCatalog[nidx];
        store.rowCatalog[nidx] = tmp;
        saveStore();
        render();
    }

    function deleteRow(rowId) {
        Object.keys(store.weeks).forEach((k) => {
            const doc = getWeekDoc(k);
            doc.rows = doc.rows.filter((r) => r.id !== rowId);
            doc.allocations = doc.allocations.filter((a) => a.rowId !== rowId);
        });
        removeRowFromCatalog(rowId);
        saveStore();
        render();
    }

    function persistOrderTarget() {
        if (viewMode !== '1w') return;
        const doc = getWeekDoc(formatISODate(currentWeekStart));
        doc.orderTargetKg = orderTargetKg.value;
        saveStore();
        renderSummary();
    }

    function copyPreviousWeek(mode) {
        const destKey = formatISODate(currentWeekStart);
        const prevKey = formatISODate(addDays(currentWeekStart, -7));
        const prev = getWeekDoc(prevKey);
        const dest = getWeekDoc(destKey);
        if (!prev.rows.length) {
            toast('No previous week data to copy.', 'error');
            return;
        }

        if (mode === 'rows') {
            dest.rows = prev.rows.map((r) => ({ id: generateId('row'), label: r.label }));
            dest.allocations = [];
        } else {
            const idMap = {};
            dest.rows = prev.rows.map((r) => {
                const id = generateId('row');
                idMap[r.id] = id;
                return { id, label: r.label };
            });
            dest.allocations = prev.allocations
                .filter((a) => idMap[a.rowId])
                .map((a) => normalizeAllocation({
                    id: generateId('alloc'),
                    rowId: idMap[a.rowId],
                    linkId: null,
                    startDayIndex: a.startDayIndex,
                    spanDays: a.spanDays,
                    grams: a.grams,
                    shipmentRef: a.shipmentRef,
                    batchId: a.batchId,
                }));
        }
        dest.rows.forEach((r) => upsertRowInCatalog(r.id, r.label));
        saveStore();
        closeModal(copyModeModal);
        render();
        toast('Copied from previous week.', 'success');
    }

    allocationForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const rowId = allocRowIdInput.value;
        const row = getDisplayRows().find((r) => r.id === rowId);
        if (!row) {
            toast('Row not found.', 'error');
            return;
        }

        const start = parseInt(allocStartDay.value, 10) || 0;
        const span = Math.max(1, parseInt(allocSpanDays.value, 10) || 1);
        const endEx = Math.min(getVisibleDayCount(), start + span);
        const parsedGrams = parseInt(allocGrams.value, 10);
        const grams = parsedGrams >= 500 && parsedGrams <= 3000 && parsedGrams % 500 === 0 ? parsedGrams : 1000;
        const shipmentRef = allocShipmentRef.value.trim();
        const batchId = allocBatchId.value || '';
        const editingId = allocIdInput.value;
        const allClips = buildAllVirtualClipsMap()[rowId] || [];
        const editingClip = allClips.find((c) => c.id === editingId);
        const exclude = new Set(editingClip ? editingClip.members.map((m) => m.sourceAllocId) : []);
        if (hasRowConflict(rowId, start, endEx, exclude)) {
            toast('This allocation overlaps an existing clip in the same row.', 'error');
            return;
        }

        if (editingClip) removeMembers(editingClip.members);

        const linkId = endEx > 7 && start < 7 ? generateId('link') : null;
        writeSegments(rowId, row.label, start, endEx, grams, shipmentRef, linkId, batchId);
        saveStore();
        closeModal(allocationModal);
        render();
    });

    deleteAllocationBtn.addEventListener('click', async () => {
        const id = allocIdInput.value;
        const rowId = allocRowIdInput.value;
        const clip = (buildAllVirtualClipsMap()[rowId] || []).find((c) => c.id === id);
        if (!clip) {
            closeModal(allocationModal);
            return;
        }
        const ok = await confirmAction('Delete this allocation clip?', 'Delete');
        if (!ok) return;
        removeMembers(clip.members);
        saveStore();
        closeModal(allocationModal);
        render();
    });

    rowForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const label = rowLabelInput.value.trim();
        if (!label) {
            toast('Please enter a row label.', 'error');
            return;
        }
        const id = rowEditId.value;
        const key = formatISODate(currentWeekStart);
        const doc = getWeekDoc(key);

        if (id) {
            Object.keys(store.weeks).forEach((wk) => {
                const wdoc = getWeekDoc(wk);
                const row = wdoc.rows.find((r) => r.id === id);
                if (row) row.label = label;
            });
            upsertRowInCatalog(id, label);
        } else {
            const newId = generateId('row');
            doc.rows.push({ id: newId, label });
            upsertRowInCatalog(newId, label);
        }
        saveStore();
        closeModal(rowModal);
        render();
    });

    allocStartDay.addEventListener('change', setMaxSpanByStart);
    allocBatchId.addEventListener('change', updateBatchDetails);
    orderTargetKg.addEventListener('change', persistOrderTarget);
    orderTargetKg.addEventListener('blur', persistOrderTarget);
    newBatchBtn.addEventListener('click', () => {
        batchNameInput.value = '';
        openModal(batchModal);
    });
    batchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const batch = createBatch(batchNameInput.value);
        if (!batch) {
            toast('Please enter a batch name.', 'error');
            return;
        }
        saveStore();
        renderBatchOptions(batch.id);
        closeModal(batchModal);
    });

    if (addRowBtn) addRowBtn.addEventListener('click', openAddRowModal);

    prevWeekBtn.addEventListener('click', () => {
        currentWeekStart = addDays(currentWeekStart, -7);
        render();
    });
    nextWeekBtn.addEventListener('click', () => {
        currentWeekStart = addDays(currentWeekStart, 7);
        render();
    });

    oneWeekViewBtn.addEventListener('click', () => {
        viewMode = '1w';
        localStorage.setItem(VIEW_MODE_KEY, viewMode);
        oneWeekViewBtn.classList.add('is-active');
        twoWeekViewBtn.classList.remove('is-active');
        render();
    });

    twoWeekViewBtn.addEventListener('click', () => {
        viewMode = '2w';
        localStorage.setItem(VIEW_MODE_KEY, viewMode);
        twoWeekViewBtn.classList.add('is-active');
        oneWeekViewBtn.classList.remove('is-active');
        render();
    });

    copyPrevBtn.addEventListener('click', () => {
        if (periodHasContent()) return;
        openModal(copyModeModal);
    });
    copyRowsOnlyBtn.addEventListener('click', () => copyPreviousWeek('rows'));
    copyFullWeekBtn.addEventListener('click', () => copyPreviousWeek('full'));

    closeAllocationModal.addEventListener('click', () => closeModal(allocationModal));
    cancelAllocationBtn.addEventListener('click', () => closeModal(allocationModal));
    allocationModal.addEventListener('click', (e) => { if (e.target === allocationModal) closeModal(allocationModal); });

    closeRowModal.addEventListener('click', () => closeModal(rowModal));
    cancelRowBtn.addEventListener('click', () => closeModal(rowModal));
    rowModal.addEventListener('click', (e) => { if (e.target === rowModal) closeModal(rowModal); });

    closeCopyModeModal.addEventListener('click', () => closeModal(copyModeModal));
    copyModeModal.addEventListener('click', (e) => { if (e.target === copyModeModal) closeModal(copyModeModal); });
    closeBatchModal.addEventListener('click', () => closeModal(batchModal));
    cancelBatchBtn.addEventListener('click', () => closeModal(batchModal));
    batchModal.addEventListener('click', (e) => { if (e.target === batchModal) closeModal(batchModal); });

    closeConfirmModal.addEventListener('click', () => resolveConfirm(false));
    confirmCancelBtn.addEventListener('click', () => resolveConfirm(false));
    confirmOkBtn.addEventListener('click', () => resolveConfirm(true));
    confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) resolveConfirm(false); });

    document.addEventListener('click', () => closeAllMenus());

    render();
})();
