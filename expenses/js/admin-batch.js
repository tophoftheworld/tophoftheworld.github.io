/**
 * Admin batch receipt album — multi-file upload, serial OCR into drafts,
 * explicit Save in the expense editor to persist to Firebase.
 */
import * as shared from './shared.js?v=1.5.91';

/** @typedef {'queued'|'processing'|'ready'|'failed'|'possible_duplicate'|'saved'} BatchItemStatus */

/**
 * @typedef {object} BatchQueueItem
 * @property {string} localId
 * @property {File} file
 * @property {string} thumbUrl
 * @property {string} expenseId
 * @property {BatchItemStatus} status
 * @property {string} [error]
 * @property {string|null} [duplicateOfId]
 * @property {object|null} [expense]
 * @property {string|null} [dataUrl]
 * @property {boolean} [ocrFailed]
 * @property {boolean} [_persisted]
 * @property {boolean} [thumbPending]
 */

/** @type {BatchQueueItem[]} */
let queue = [];
/** @type {HTMLElement|null} */
let batchOverlayEl = null;
let workerRunning = false;
let workerPaused = false;
let refreshTablesTimer = null;

/** @type {{ openExpenseEditor: Function, refreshTables: Function } | null} */
let deps = null;

const FILE_ACCEPT = shared.RECEIPT_FILE_ACCEPT;

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = String(text ?? '');
    return d.innerHTML;
}

/** Green check only when draft is ready to Save. */
function statusChipHtml(item) {
    const needsSave =
        (item.status === 'ready' || item.status === 'possible_duplicate') &&
        !item._persisted &&
        item.expense;
    if (!needsSave) return '';
    return `<span class="batch-tile-chip" title="Ready to save" aria-label="Ready to save"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></span>`;
}

const TILE_DELETE_SVG =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

const TILE_ADD_SVG =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

async function confirmAsync(title, message, actionText) {
    if (typeof window.confirmAdminAsync === 'function') {
        return window.confirmAdminAsync(title, message, actionText);
    }
    return false;
}

function isDraftStatus(status) {
    return status === 'ready' || status === 'possible_duplicate';
}

function isOpenableStatus(status) {
    return (
        status === 'ready' ||
        status === 'possible_duplicate' ||
        status === 'failed' ||
        status === 'saved'
    );
}

function countByStatus() {
    const totals = {
        queued: 0,
        processing: 0,
        ready: 0,
        failed: 0,
        possible_duplicate: 0,
        saved: 0
    };
    for (const item of queue) {
        if (totals[item.status] != null) totals[item.status]++;
    }
    return totals;
}

function processedCount() {
    return queue.filter((i) =>
        ['ready', 'failed', 'possible_duplicate', 'saved'].includes(i.status)
    ).length;
}

function peerDraftExpenses(excludeLocalId) {
    return queue
        .filter(
            (q) =>
                q.localId !== excludeLocalId &&
                q.expense &&
                (isDraftStatus(q.status) || q.status === 'saved')
        )
        .map((q) => q.expense);
}

function scheduleTableRefresh() {
    if (!deps?.refreshTables) return;
    clearTimeout(refreshTablesTimer);
    refreshTablesTimer = setTimeout(() => {
        deps.refreshTables();
    }, 400);
}

function flushTableRefresh() {
    clearTimeout(refreshTablesTimer);
    refreshTablesTimer = null;
    deps?.refreshTables?.();
}

function revokeThumbUrl(url) {
    if (url && String(url).startsWith('blob:')) {
        try {
            URL.revokeObjectURL(url);
        } catch {
            /* ignore */
        }
    }
}

function setItemThumb(item, nextUrl) {
    if (item.thumbUrl && item.thumbUrl !== nextUrl) {
        revokeThumbUrl(item.thumbUrl);
    }
    item.thumbUrl = nextUrl || '';
}

/**
 * Build a browser-paintable thumb for HEIC/PDF (and normal images).
 * @param {BatchQueueItem} item
 */
async function hydrateItemThumb(item) {
    const stillInQueue = () => queue.some((q) => q.localId === item.localId);
    try {
        if (shared.isHeicLikeFile(item.file) || shared.isPdfFile(item.file)) {
            const decodable = await shared.ensureBrowserDecodableImageFile(item.file);
            if (!stillInQueue()) return;
            const url = URL.createObjectURL(decodable);
            setItemThumb(item, url);
        } else if (!item.thumbUrl) {
            setItemThumb(item, URL.createObjectURL(item.file));
        }
        item.thumbPending = false;
    } catch (err) {
        console.warn('[Batch] Thumb failed:', err);
        item.thumbPending = false;
    }
    if (stillInQueue()) renderBatchBody();
}

/**
 * @param {object|null|undefined} parsed
 * @param {string} expenseId
 * @param {string|null} receiptUrl
 * @param {{ ocrFailed?: boolean, duplicateNote?: string }} extras
 */
function buildExpenseFromOcr(parsed, expenseId, receiptUrl, extras = {}) {
    const p = parsed && typeof parsed === 'object' ? parsed : {};
    const rawItems = Array.isArray(p.items) ? p.items.filter((i) => i && i.name) : [];
    let total = Number(p.totalAmount) || 0;
    if (!total && rawItems.length) {
        total = rawItems.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
    }

    const items =
        rawItems.length > 0
            ? rawItems.map((item) => ({
                  name: String(item.name || '').trim(),
                  quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
                  price: Number(item.price) || 0,
                  total: Number(item.total) || 0
              }))
            : [
                  {
                      name: extras.ocrFailed ? 'Receipt (OCR failed)' : 'Receipt',
                      quantity: 1,
                      price: total,
                      total
                  }
              ];

    const suggested = String(p.suggestedCategory || '').trim();
    const expenseCategory = shared.EXPENSE_CATEGORY_OPTIONS.includes(suggested)
        ? suggested
        : shared.DEFAULT_EXPENSE_CATEGORY;

    let notes = '';
    if (extras.duplicateNote) {
        notes = extras.duplicateNote;
    }

    return {
        id: expenseId,
        date: p.date || shared.getTodayLocal(),
        branch: 'SM North',
        allocation: 'Store',
        eventName: null,
        isPettyCash: false,
        supplierName: String(p.supplierName || '').trim() || 'Unknown supplier',
        businessName: String(p.businessName || '').trim(),
        tin: String(p.tin || '').trim(),
        address: String(p.address || '').trim(),
        invoiceNumber: String(p.invoiceNumber || '').trim(),
        items,
        totalAmount: total,
        vatExemptAmount: Number(p.vatExemptAmount) || 0,
        expenseCategory,
        paidBy: 'Store Cash',
        notes,
        receiptImage: receiptUrl || null,
        vatComputationEnabled:
            (Number(p.vatExemptAmount) || 0) > 0 ||
            (Number(p.printedVat?.vatableSale) || 0) > 0 ||
            (Number(p.printedVat?.vatAmount) || 0) > 0
                ? true
                : undefined
    };
}

function formatDuplicateNote(match) {
    const amt = Number(match.totalAmount) || 0;
    const supplier = match.supplierName || 'expense';
    return `Possible duplicate of ${match.date || '?'} ${supplier} ₱${amt.toLocaleString()}`;
}

/**
 * @param {File[]} files
 */
function addFiles(files) {
    for (const file of files) {
        if (!shared.isSupportedReceiptImageFile(file)) {
            shared.showToast(`Skipped unsupported file: ${file.name || 'file'}`);
            continue;
        }
        const localId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const needsConvert = shared.isHeicLikeFile(file) || shared.isPdfFile(file);
        const thumbUrl = needsConvert ? '' : URL.createObjectURL(file);
        /** @type {BatchQueueItem} */
        const item = {
            localId,
            file,
            thumbUrl,
            expenseId: shared.generateId(),
            status: 'queued',
            error: '',
            duplicateOfId: null,
            expense: null,
            dataUrl: null,
            ocrFailed: false,
            thumbPending: needsConvert || !thumbUrl
        };
        queue.push(item);
        if (needsConvert || !thumbUrl) {
            hydrateItemThumb(item);
        } else {
            item.thumbPending = false;
        }
    }
    renderBatchBody();
    updateBatchFooter();
}

async function processOneItem(item) {
    item.status = 'processing';
    item.error = '';
    renderBatchBody();
    updateBatchFooter();

    let dataUrl = null;
    let parsed = null;
    let ocrFailed = false;

    try {
        const decodable = await shared.ensureBrowserDecodableImageFile(item.file);
        dataUrl = await shared.compressImage(decodable);
        if (!dataUrl) throw new Error('Could not compress image');
        item.dataUrl = dataUrl;
        setItemThumb(item, dataUrl);

        try {
            parsed = await shared.extractExpenseReceiptFromImage(dataUrl);
        } catch (ocrErr) {
            console.warn('[Batch] OCR failed:', ocrErr);
            ocrFailed = true;
            item.ocrFailed = true;
        }

        const peerExpenses = peerDraftExpenses(item.localId);
        const draftPayload = buildExpenseFromOcr(parsed, item.expenseId, dataUrl, { ocrFailed });
        const dupes = shared.findPossibleDuplicateExpenses(draftPayload, {
            excludeIds: [item.expenseId],
            extraCandidates: peerExpenses
        });

        let duplicateNote = '';
        if (dupes.length > 0) {
            item.duplicateOfId = dupes[0].id;
            duplicateNote = formatDuplicateNote(dupes[0]);
        }

        const payload = buildExpenseFromOcr(parsed, item.expenseId, dataUrl, {
            ocrFailed,
            duplicateNote
        });

        const result = shared.createExpenseObject(payload, {
            existingExpense: null,
            isEditing: false,
            calculateTotalFromItems: false,
            autoCalculateVAT: true,
            validate: false,
            recorderContext: 'admin'
        });

        if (!result.success || !result.expense) {
            throw new Error((result.errors && result.errors.join(', ')) || 'Could not build draft');
        }

        // Draft only — not written to Firebase until the user clicks Save in the editor.
        const expense = result.expense;
        expense.createdAt = new Date().toISOString();
        item.expense = expense;
        item.status = dupes.length > 0 ? 'possible_duplicate' : 'ready';
    } catch (err) {
        console.error('[Batch] Process failed:', err);
        item.status = 'failed';
        item.error = err?.message || 'Processing failed';
        if (item.dataUrl && !item.expense) {
            // Still allow opening a minimal draft with the receipt image
            const fallback = buildExpenseFromOcr(null, item.expenseId, item.dataUrl, {
                ocrFailed: true
            });
            const result = shared.createExpenseObject(fallback, {
                validate: false,
                calculateTotalFromItems: false,
                autoCalculateVAT: false,
                recorderContext: 'admin'
            });
            if (result.success && result.expense) {
                item.expense = result.expense;
            }
        }
    }

    renderBatchBody();
    updateBatchFooter();
}

async function runWorker() {
    if (workerRunning) return;
    workerRunning = true;
    workerPaused = false;
    updateBatchFooter();

    try {
        while (!workerPaused) {
            const next = queue.find((i) => i.status === 'queued');
            if (!next) break;
            await processOneItem(next);
        }
    } finally {
        workerRunning = false;
        updateBatchFooter();
    }
}

function startOrResumeWorker() {
    workerPaused = false;
    runWorker();
}

function pauseWorker() {
    workerPaused = true;
    updateBatchFooter();
}

async function deleteQueueItem(localId) {
    const idx = queue.findIndex((i) => i.localId === localId);
    if (idx < 0) return;
    const item = queue[idx];

    if (item.status === 'processing') {
        shared.showToast('Wait for this receipt to finish processing');
        return;
    }

    const inFirebase = shared.getExpenses().find((e) => e.id === item.expenseId);
    if (inFirebase || item._persisted || item.status === 'saved') {
        const ok = await confirmAsync(
            'Delete expense',
            'Permanently delete this expense? This cannot be undone.',
            'Delete'
        );
        if (!ok) return;
        if (inFirebase) {
            await shared.deleteExpense(inFirebase.id);
            scheduleTableRefresh();
        }
    } else if (isDraftStatus(item.status) || item.status === 'failed') {
        const ok = await confirmAsync(
            'Remove draft',
            'Remove this unsaved draft from the batch?',
            'Remove'
        );
        if (!ok) return;
    }

    setItemThumb(item, '');
    queue.splice(idx, 1);
    renderBatchBody();
    updateBatchFooter();
}

function openItemEditor(localId) {
    const item = queue.find((i) => i.localId === localId);
    if (!item) return;

    if (!isOpenableStatus(item.status)) {
        shared.showToast('Process this receipt first');
        return;
    }

    const fromFirebase = shared.getExpenses().find((e) => e.id === item.expenseId);
    const expense = fromFirebase || item.expense || null;
    if (!expense) {
        shared.showToast('Draft not ready — try processing again');
        return;
    }

    // Prefer in-memory receipt data URL for unsaved drafts
    if (!fromFirebase && item.dataUrl) {
        expense.receiptImage = item.dataUrl;
    }

    if (!deps?.openExpenseEditor) return;

    if (batchOverlayEl) batchOverlayEl.style.visibility = 'hidden';

    deps.openExpenseEditor(expense, ({ deleted, saved, expenseId } = {}) => {
        if (batchOverlayEl) batchOverlayEl.style.visibility = '';

        if (deleted) {
            const i = queue.findIndex((q) => q.expenseId === expenseId || q.localId === localId);
            if (i >= 0) {
                setItemThumb(queue[i], '');
                queue.splice(i, 1);
            }
            scheduleTableRefresh();
        } else {
            const updated = shared.getExpenses().find((e) => e.id === item.expenseId);
            if (updated || saved) {
                // Explicit Save put it in Firebase
                item.expense = updated || item.expense;
                item._persisted = true;
                const peers = peerDraftExpenses(item.localId);
                const dupes = shared.findPossibleDuplicateExpenses(item.expense, {
                    excludeIds: [item.expenseId],
                    extraCandidates: peers
                });
                if (dupes.length > 0) {
                    item.status = 'possible_duplicate';
                    item.duplicateOfId = dupes[0].id;
                } else {
                    item.status = 'saved';
                    item.duplicateOfId = null;
                }
                scheduleTableRefresh();
            }
            // Back without save: leave draft as-is (ready / possible_duplicate / failed)
        }
        renderBatchBody();
        updateBatchFooter();
    });
}

function renderEmptyDropzone(mount) {
    mount.innerHTML = `
        <div class="batch-album-dropzone" id="batchAlbumDropzone" tabindex="0" role="button" aria-label="Add receipts">
            <div class="batch-album-dropzone-icon" aria-hidden="true">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <path d="M8 13h8M8 17h5"/>
                </svg>
            </div>
            <p class="batch-album-dropzone-title">Drag &amp; drop receipts</p>
            <p class="batch-album-dropzone-sub">Images, HEIC, or PDF — select multiple files</p>
            <button type="button" class="action-btn primary" id="batchSelectPhotosBtn">Select files</button>
        </div>
        <input type="file" id="batchFileInput" accept="${FILE_ACCEPT}" multiple hidden />
    `;
}

function tileStateClass(item) {
    if (item.status === 'queued') return 'batch-tile--pending';
    if (item.status === 'failed') return 'batch-tile--failed';
    return '';
}

function formatTileDate(iso) {
    const s = String(iso || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    const [y, m, d] = s.split('-');
    return `${m}/${d}/${y.slice(2)}`;
}

function tileMetaHtml(item) {
    const exp = item.expense;
    if (!exp || !isOpenableStatus(item.status)) {
        if (item.status === 'queued') {
            return `<div class="batch-tile-meta batch-tile-meta--muted"><span class="batch-tile-supplier">Waiting…</span></div>`;
        }
        if (item.status === 'processing') {
            return `<div class="batch-tile-meta batch-tile-meta--muted"><span class="batch-tile-supplier">Processing…</span></div>`;
        }
        if (item.status === 'failed') {
            return `<div class="batch-tile-meta batch-tile-meta--failed"><span class="batch-tile-supplier">${escapeHtml(item.error || 'Failed')}</span></div>`;
        }
        return `<div class="batch-tile-meta batch-tile-meta--muted"><span class="batch-tile-supplier">—</span></div>`;
    }

    const supplier = String(exp.supplierName || 'Unknown').trim() || 'Unknown';
    const date = formatTileDate(exp.date) || '—';
    const amount = shared.formatCurrency(exp.totalAmount || 0);
    return `
        <div class="batch-tile-meta">
            <span class="batch-tile-supplier" title="${escapeHtml(supplier)}">${escapeHtml(supplier)}</span>
            <span class="batch-tile-sub">
                <span class="batch-tile-date">${escapeHtml(date)}</span>
                <span class="batch-tile-amount">${escapeHtml(amount)}</span>
            </span>
        </div>`;
}

function renderGrid(mount) {
    const tiles = queue
        .map((item) => {
            const canOpen = isOpenableStatus(item.status);
            const errTitle = item.error ? escapeHtml(item.error) : '';
            const src = item.dataUrl || item.thumbUrl;
            const thumbHtml = src
                ? `<img class="batch-tile-thumb" src="${escapeHtml(src)}" alt="" />`
                : `<div class="batch-tile-thumb--placeholder" aria-hidden="true"></div>`;
            return `
            <div class="batch-tile ${tileStateClass(item)} ${canOpen ? 'is-clickable' : ''}" data-local-id="${escapeHtml(item.localId)}" title="${errTitle}">
                <div class="batch-tile-thumb-wrap">
                    ${thumbHtml}
                    ${item.status === 'processing' ? '<div class="batch-tile-spinner" aria-hidden="true"></div>' : ''}
                    ${statusChipHtml(item)}
                    <button type="button" class="batch-tile-delete" data-delete-local-id="${escapeHtml(item.localId)}" title="Remove" aria-label="Remove">
                        ${TILE_DELETE_SVG}
                    </button>
                </div>
                ${tileMetaHtml(item)}
            </div>`;
        })
        .join('');

    const addTile = `
        <button type="button" class="batch-tile batch-tile-add" id="batchTileAddBtn" title="Add more receipts" aria-label="Add more receipts">
            <span class="batch-tile-add-circle">${TILE_ADD_SVG}</span>
            <span class="batch-tile-add-label">Add more</span>
        </button>`;

    mount.innerHTML = `
        <div class="batch-album-grid" id="batchAlbumGrid">${tiles}${addTile}</div>
        <input type="file" id="batchFileInput" accept="${FILE_ACCEPT}" multiple hidden />
    `;
}

function renderBatchBody() {
    const body = document.getElementById('batchAlbumBody');
    if (!body) return;
    if (queue.length === 0) {
        renderEmptyDropzone(body);
    } else {
        renderGrid(body);
    }
    wireBatchBodyEvents();
}

function wireFileInput(input) {
    if (!input || input.dataset.wired === '1') return;
    input.dataset.wired = '1';
    input.addEventListener('change', () => {
        const files = [...(input.files || [])];
        input.value = '';
        if (files.length) addFiles(files);
    });
}

function openFilePicker() {
    const input = document.getElementById('batchFileInput');
    input?.click();
}

function dataTransferHasFiles(e) {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    return [...types].includes('Files');
}

/**
 * Wire drag/drop on the persistent body so the grid (with tiles already present)
 * still clearly accepts more files.
 */
function wireBatchBodyDragDrop(body) {
    if (!body || body.dataset.dragWired === '1') return;
    body.dataset.dragWired = '1';
    let dragDepth = 0;

    body.addEventListener('dragenter', (e) => {
        if (!dataTransferHasFiles(e)) return;
        e.preventDefault();
        dragDepth += 1;
        body.classList.add('is-dragover');
    });
    body.addEventListener('dragover', (e) => {
        if (!dataTransferHasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        body.classList.add('is-dragover');
    });
    body.addEventListener('dragleave', (e) => {
        if (!dataTransferHasFiles(e)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) body.classList.remove('is-dragover');
    });
    body.addEventListener('drop', (e) => {
        if (!dataTransferHasFiles(e)) return;
        e.preventDefault();
        dragDepth = 0;
        body.classList.remove('is-dragover');
        const files = [...(e.dataTransfer?.files || [])];
        if (files.length) addFiles(files);
    });
}

function wireBatchBodyEvents() {
    const body = document.getElementById('batchAlbumBody');
    if (body) wireBatchBodyDragDrop(body);

    const input = document.getElementById('batchFileInput');
    wireFileInput(input);

    const dropzone = document.getElementById('batchAlbumDropzone');
    if (dropzone && dropzone.dataset.wired !== '1') {
        dropzone.dataset.wired = '1';
        dropzone.addEventListener('click', (e) => {
            if (e.target.closest('#batchSelectPhotosBtn')) return;
            openFilePicker();
        });
        document.getElementById('batchSelectPhotosBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openFilePicker();
        });
    }

    const grid = document.getElementById('batchAlbumGrid');
    if (grid && grid.dataset.wired !== '1') {
        grid.dataset.wired = '1';
        grid.addEventListener('click', (e) => {
            if (e.target.closest('#batchTileAddBtn')) {
                openFilePicker();
                return;
            }
            const delBtn = e.target.closest('[data-delete-local-id]');
            if (delBtn) {
                e.stopPropagation();
                deleteQueueItem(delBtn.dataset.deleteLocalId);
                return;
            }
            const tile = e.target.closest('.batch-tile[data-local-id]');
            if (tile) openItemEditor(tile.dataset.localId);
        });
    }
}

function unsavedReadyCount() {
    return queue.filter((i) => isDraftStatus(i.status) && !i._persisted && i.expense).length;
}

function savedCount() {
    const counts = countByStatus();
    return (
        counts.saved +
        queue.filter((i) => i.status === 'possible_duplicate' && i._persisted).length
    );
}

async function saveAllReadyDrafts() {
    const toSave = queue.filter((i) => isDraftStatus(i.status) && !i._persisted && i.expense);
    if (!toSave.length) {
        shared.showToast('Nothing to save yet');
        return;
    }

    let saved = 0;
    for (const item of toSave) {
        try {
            const expense = { ...item.expense };
            if (item.dataUrl) expense.receiptImage = item.dataUrl;
            shared.addExpense(expense);
            item.expense = expense;
            item._persisted = true;
            const peers = peerDraftExpenses(item.localId);
            const dupes = shared.findPossibleDuplicateExpenses(expense, {
                excludeIds: [item.expenseId],
                extraCandidates: peers
            });
            if (dupes.length > 0) {
                item.status = 'possible_duplicate';
                item.duplicateOfId = dupes[0].id;
            } else {
                item.status = 'saved';
                item.duplicateOfId = null;
            }
            saved++;
        } catch (err) {
            console.error('[Batch] Save failed:', err);
            item.status = 'failed';
            item.error = err?.message || 'Save failed';
        }
    }

    await shared.flushPendingSync();
    flushTableRefresh();
    renderBatchBody();
    updateBatchFooter();
    shared.showToast(
        saved === 1 ? '1 expense saved' : `${saved} expenses saved`
    );
    await closeBatchAlbum({ force: true });
}

function updateBatchFooter() {
    const progressEl = document.getElementById('batchAlbumProgress');
    const processBtn = document.getElementById('batchProcessBtn');
    const saveBtn = document.getElementById('batchSaveBtn');
    if (!progressEl || !processBtn) return;

    const total = queue.length;
    const done = processedCount();
    const counts = countByStatus();
    const needSave = unsavedReadyCount();
    const saved = savedCount();

    let progress = '';
    if (total) {
        progress = `${done} / ${total} processed`;
        if (saved) progress += ` · ${saved} saved`;
        if (needSave) progress += ` · ${needSave} need Save`;
        if (counts.processing) progress += ' · working…';
        if (workerPaused && counts.queued) progress += ' · paused';
    }
    progressEl.textContent = progress;

    const hasQueued = counts.queued > 0;

    if (!total) {
        processBtn.style.display = 'none';
    } else {
        processBtn.style.display = '';
        processBtn.className = 'action-btn secondary';
        if (workerRunning && !workerPaused) {
            processBtn.textContent = 'Pause';
            processBtn.dataset.mode = 'pause';
            processBtn.disabled = false;
        } else if (hasQueued) {
            processBtn.textContent = workerPaused || done > 0 ? 'Resume' : 'Process';
            processBtn.dataset.mode = 'run';
            processBtn.disabled = false;
        } else {
            processBtn.textContent = 'Process';
            processBtn.dataset.mode = 'run';
            processBtn.disabled = true;
        }
    }

    if (saveBtn) {
        const busy = workerRunning && !workerPaused && counts.processing > 0;
        saveBtn.disabled = busy || needSave === 0;
    }
}

async function closeBatchAlbum({ force = false } = {}) {
    if (!force) {
        const counts = countByStatus();
        if (workerRunning && counts.processing > 0) {
            const ok = await confirmAsync(
                'Still processing',
                'A receipt is still processing. Close anyway?',
                'Close'
            );
            if (!ok) return;
        } else if (counts.queued > 0) {
            const ok = await confirmAsync(
                'Unprocessed receipts',
                'You still have unprocessed receipts. Close anyway?',
                'Close'
            );
            if (!ok) return;
        } else {
            const needSave = unsavedReadyCount();
            if (needSave > 0) {
                const ok = await confirmAsync(
                    'Unsaved drafts',
                    `${needSave} receipt(s) were processed but not saved to Firebase. Close and discard them?`,
                    'Discard'
                );
                if (!ok) return;
            }
        }
    }

    workerPaused = true;
    for (const item of queue) {
        setItemThumb(item, '');
    }
    queue = [];
    if (batchOverlayEl?.parentNode) {
        batchOverlayEl.parentNode.removeChild(batchOverlayEl);
    }
    batchOverlayEl = null;
    flushTableRefresh();
    document.body.style.overflow = '';
}

function openBatchAlbum() {
    if (batchOverlayEl) return;

    const overlay = document.createElement('div');
    overlay.className = 'batch-album-overlay';
    overlay.id = 'batchAlbumOverlay';
    overlay.innerHTML = `
        <div class="batch-album-modal" role="dialog" aria-modal="true" aria-labelledby="batchAlbumTitle">
            <div class="batch-album-header">
                <h2 id="batchAlbumTitle" class="batch-album-title">Add batch expenses</h2>
                <button type="button" class="admin-modal-icon-btn" id="batchAlbumCloseBtn" aria-label="Close">${TILE_DELETE_SVG}</button>
            </div>
            <div class="batch-album-body" id="batchAlbumBody"></div>
            <div class="batch-album-footer">
                <span class="batch-album-progress" id="batchAlbumProgress"></span>
                <div class="batch-album-footer-actions">
                    <button type="button" class="action-btn secondary" id="batchCancelBtn">Cancel</button>
                    <button type="button" class="action-btn secondary" id="batchProcessBtn" style="display:none" data-mode="run">Process</button>
                    <button type="button" class="action-btn primary" id="batchSaveBtn" disabled>Save</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    batchOverlayEl = overlay;

    overlay.querySelector('#batchAlbumCloseBtn')?.addEventListener('click', () => closeBatchAlbum());
    overlay.querySelector('#batchCancelBtn')?.addEventListener('click', () => closeBatchAlbum());
    overlay.querySelector('#batchSaveBtn')?.addEventListener('click', () => saveAllReadyDrafts());
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeBatchAlbum();
    });
    overlay.querySelector('#batchProcessBtn')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (btn.dataset.mode === 'pause') {
            pauseWorker();
        } else {
            startOrResumeWorker();
        }
    });

    renderBatchBody();
    updateBatchFooter();
}

/**
 * @param {{ openExpenseEditor: Function, refreshTables: Function }} options
 */
export function initAdminBatch(options) {
    deps = options;
    const btn = document.getElementById('addBatchExpenseBtn');
    if (btn && btn.dataset.wired !== '1') {
        btn.dataset.wired = '1';
        btn.addEventListener('click', () => openBatchAlbum());
    }
}

export function isBatchAlbumOpen() {
    return Boolean(batchOverlayEl);
}
