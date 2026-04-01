import { RECEIPT_OCR_API_BASE } from './config.js';
import { verifyVatAgainstPrinted } from './vat-verify.js';

const $ = (id) => document.getElementById(id);

const MAX_FILES = 20;
const ENDPOINT = `${RECEIPT_OCR_API_BASE.replace(/\/$/, '')}/scan-documentai`;

let selectedId = null;
let running = false;

const invoices = []; // { id, file, imageUrl, status, error, parsed }

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result;
      const base64 = String(dataUrl).split(',')[1] || '';
      resolve(base64);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function parseMoneyInput(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function fmtNum(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function printedVatSummary(inv) {
  const p = inv?.printed || {};
  return [
    fmtNum(p.vatableSale),
    fmtNum(p.vatAmount),
    fmtNum(p.taxableAmount),
    fmtNum(p.totalAmount),
  ].join(' | ');
}

function computeVatCheck(inv) {
  const totalAmount = parseMoneyInput(inv.totalAmount);
  const vatExemptAmount = parseMoneyInput(inv.vatExemptAmount) || 0;

  const printed = {
    vatableSale: parseMoneyInput(inv.printed?.vatableSale),
    vatAmount: parseMoneyInput(inv.printed?.vatAmount),
    taxableAmount: parseMoneyInput(inv.printed?.taxableAmount),
    totalAmount: parseMoneyInput(inv.printed?.totalAmount),
  };

  // v1: assume VAT registered. You can extend to per-row checkbox later.
  const isVatRegistered = true;

  // If total is missing, verification will be "insufficient".
  if (totalAmount == null) {
    inv.vatCheck = { overall: 'insufficient' };
    return;
  }

  inv.vatCheck = verifyVatAgainstPrinted(
    totalAmount,
    vatExemptAmount,
    isVatRegistered,
    printed
  );
}

function statusPill(status) {
  if (status === 'done') return { text: 'done', cls: 'ok' };
  if (status === 'error') return { text: 'error', cls: 'err' };
  if (status === 'scanning') return { text: 'scanning', cls: '' };
  return { text: 'queued', cls: '' };
}

function setPreview(inv) {
  const img = $('previewImg');
  const empty = $('previewEmpty');

  if (!inv) {
    img.removeAttribute('src');
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  img.src = inv.imageUrl;
}

function updateQueueUi() {
  const count = invoices.filter((x) => x.status === 'queued').length;
  $('queueCountLabel').textContent = String(count);
  $('btnProcessQueue').disabled = running || count === 0;
}

function getSelectedInvoice() {
  if (!selectedId) return null;
  return invoices.find((x) => x.id === selectedId) || null;
}

function renderPrintedSummaryFor(inv) {
  const row = document.querySelector(`tr[data-invoice-id="${inv.id}"]`);
  if (!row) return;
  const cell = row.querySelector('.cell-printed-vat');
  if (!cell) return;
  cell.textContent = printedVatSummary(inv);
}

function syncEditorFromInvoice(inv) {
  if (!inv) return;
  $('selectedEditor').style.display = 'block';

  $('editorPrintedVatable').value =
    inv.printed?.vatableSale != null ? String(inv.printed.vatableSale) : '';
  $('editorPrintedVatAmt').value =
    inv.printed?.vatAmount != null ? String(inv.printed.vatAmount) : '';
  $('editorPrintedTaxable').value =
    inv.printed?.taxableAmount != null ? String(inv.printed.taxableAmount) : '';
  $('editorPrintedTotal').value =
    inv.printed?.totalAmount != null ? String(inv.printed.totalAmount) : '';
}

function renderTableRow(inv) {
  const tr = document.createElement('tr');
  tr.className = 'ocr-row';
  tr.dataset.invoiceId = inv.id;

  const pill = statusPill(inv.status);
  const statusCell = `<span class="ocr-status-pill ${pill.cls}">${escapeHtml(
    pill.text
  )}</span>`;

  // VAT check badge
  const vc = inv.vatCheck?.overall || 'insufficient';
  const vcBadge =
    vc === 'ok'
      ? `<span class="ocr-status-pill ok">ok</span>`
      : vc === 'mismatch'
        ? `<span class="ocr-status-pill err">mismatch</span>`
        : `<span class="ocr-status-pill">—</span>`;

  tr.innerHTML = `
    <td class="cell-status">${statusCell}</td>
    <td><input class="ocr-input" data-field="supplierName" value="${escapeHtml(
      inv.supplierName ?? ''
    )}" placeholder="Supplier" /></td>
    <td><input class="ocr-input" data-field="tin" value="${escapeHtml(inv.tin ?? '')}" placeholder="TIN" /></td>
    <td><input class="ocr-input" data-field="invoiceNumber" value="${escapeHtml(
      inv.invoiceNumber ?? ''
    )}" placeholder="Invoice / OR / SI #" /></td>
    <td><input class="ocr-input" data-field="date" type="date" value="${escapeHtml(
      inv.date ?? ''
    )}" /></td>
    <td><input class="ocr-input" data-field="totalAmount" inputmode="decimal" value="${escapeHtml(
      inv.totalAmount ?? ''
    )}" placeholder="0.00" /></td>
    <td><input class="ocr-input" data-field="vatExemptAmount" inputmode="decimal" value="${escapeHtml(
      inv.vatExemptAmount ?? ''
    )}" placeholder="0" /></td>
    <td class="cell-printed-vat">${printedVatSummary(inv)}</td>
    <td class="cell-vatcheck">${vcBadge}</td>
  `;

  tr.addEventListener('click', () => {
    selectedId = inv.id;
    document.querySelectorAll('tr[data-invoice-id]').forEach((row) => {
      row.classList.toggle('selected', row.dataset.invoiceId === inv.id);
    });
    setPreview(inv);
    syncEditorFromInvoice(inv);
  });

  // Wiring edits
  tr.querySelectorAll('input[data-field]').forEach((input) => {
    input.addEventListener('input', () => {
      const fieldPath = input.dataset.field;
      const newValue = input.type === 'date' ? input.value : input.value;
      const parts = fieldPath.split('.');
      if (parts.length === 2) {
        inv[parts[0]] = inv[parts[0]] || {};
        inv[parts[0]][parts[1]] = newValue;
      } else {
        inv[fieldPath] = newValue;
      }

      // Ensure defaults for numeric inputs
      computeVatCheck(inv);
      // Update status cell UI + badge
      const row = document.querySelector(`tr[data-invoice-id="${inv.id}"]`);
      if (!row) return;

      const vc2 = inv.vatCheck?.overall || 'insufficient';
      const badge =
        vc2 === 'ok'
          ? `<span class="ocr-status-pill ok">ok</span>`
          : vc2 === 'mismatch'
            ? `<span class="ocr-status-pill err">mismatch</span>`
            : `<span class="ocr-status-pill">—</span>`;
      const badgeCell = row.querySelector('.cell-vatcheck');
      if (badgeCell) badgeCell.innerHTML = badge;

      // No need to update printed VAT summary here (editor owns it).
    });
  });

  $('invoiceTbody').appendChild(tr);
}

function ensureVatCheckAndRender(inv) {
  computeVatCheck(inv);
  renderTableRow(inv);
}

function buildInvoiceFromParsed(file, parsed) {
  const pv = parsed?.printedVat || {};

  return {
    supplierName: parsed?.supplierName || '',
    businessName: parsed?.businessName || '',
    tin: parsed?.tin || '',
    address: parsed?.address || '',
    invoiceNumber: parsed?.invoiceNumber || '',
    date: parsed?.date || '',
    totalAmount: parsed?.totalAmount ?? '',
    vatExemptAmount: parsed?.vatExemptAmount ?? 0,
    printed: {
      vatableSale: pv?.vatableSale ?? null,
      vatAmount: pv?.vatAmount ?? null,
      taxableAmount: pv?.taxableAmount ?? null,
      totalAmount: pv?.totalAmount ?? null,
    },
  };
}

async function scanOne(inv) {
  inv.status = 'scanning';
  updateQueueUi();
  renderStatusFor(inv);

  const b64 = await fileToBase64(inv.file);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: b64,
      imageMimeType: inv.file?.type || 'image/jpeg',
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    inv.status = 'error';
    inv.error = data.error || 'Scan failed';
    renderStatusFor(inv);
    return;
  }

  const parsed = data.parsed || {};
  const filled = buildInvoiceFromParsed(inv.file, parsed);

  inv.supplierName = filled.supplierName;
  inv.businessName = filled.businessName;
  inv.tin = filled.tin;
  inv.address = filled.address;
  inv.invoiceNumber = filled.invoiceNumber;
  inv.date = filled.date;
  inv.totalAmount = filled.totalAmount;
  inv.vatExemptAmount = filled.vatExemptAmount;
  inv.printed = filled.printed;

  inv.status = 'done';
  inv.parsed = parsed;
  computeVatCheck(inv);
  renderStatusFor(inv);
  renderVatBadgeFor(inv);
  renderPrintedSummaryFor(inv);
  renderStatusInputsFor(inv);

  if (inv.id === selectedId) {
    syncEditorFromInvoice(inv);
  }
}

function renderStatusFor(inv) {
  const row = document.querySelector(`tr[data-invoice-id="${inv.id}"]`);
  if (!row) return;
  const pill = statusPill(inv.status);
  const cell = row.querySelector('.cell-status');
  if (cell) {
    cell.innerHTML = `<span class="ocr-status-pill ${pill.cls}">${escapeHtml(
      pill.text
    )}</span>`;
  }
}

function renderVatBadgeFor(inv) {
  const row = document.querySelector(`tr[data-invoice-id="${inv.id}"]`);
  if (!row) return;
  const vc = inv.vatCheck?.overall || 'insufficient';
  const badge =
    vc === 'ok'
      ? `<span class="ocr-status-pill ok">ok</span>`
      : vc === 'mismatch'
        ? `<span class="ocr-status-pill err">mismatch</span>`
        : `<span class="ocr-status-pill">—</span>`;
  const cell = row.querySelector('.cell-vatcheck');
  if (cell) cell.innerHTML = badge;
}

function renderStatusInputsFor(inv) {
  // Update input values with parsed results (so user can edit after auto-fill)
  const row = document.querySelector(`tr[data-invoice-id="${inv.id}"]`);
  if (!row) return;
  row.querySelectorAll('input[data-field]').forEach((input) => {
    const fieldPath = input.dataset.field;
    const parts = fieldPath.split('.');
    let v = '';
    if (parts.length === 2) {
      const top = parts[0];
      const key = parts[1];
      if (top === 'printed') v = inv.printed?.[key] ?? '';
    } else {
      v = inv[fieldPath] ?? '';
    }
    input.value = v ?? '';
  });
}

function resetPreviewIfNeeded() {
  if (selectedId == null) setPreview(null);
}

function addFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;

  const remaining = MAX_FILES - invoices.length;
  const accepted = list.slice(0, remaining);
  const rejected = list.length - accepted.length;
  if (rejected > 0) {
    $('batchStatus').textContent = `Added ${accepted.length} receipt(s). Max ${MAX_FILES}; ${rejected} file(s) ignored.`;
  }

  for (const file of accepted) {
    const id = uid();
    const imageUrl = URL.createObjectURL(file);
    const inv = {
      id,
      file,
      imageUrl,
      status: 'queued',
      error: null,
      parsed: null,
      supplierName: '',
      businessName: '',
      tin: '',
      address: '',
      invoiceNumber: '',
      date: '',
      totalAmount: '',
      vatExemptAmount: 0,
      printed: {
        vatableSale: null,
        vatAmount: null,
        taxableAmount: null,
        totalAmount: null,
      },
      vatCheck: { overall: 'insufficient' },
    };

    invoices.push(inv);
    ensureVatCheckAndRender(inv);
  }

  updateQueueUi();
  $('batchStatus').textContent = `Added ${accepted.length} receipt(s). Ready.`;
}

function clearAll() {
  invoices.forEach((inv) => {
    try {
      URL.revokeObjectURL(inv.imageUrl);
    } catch {}
  });
  invoices.length = 0;
  selectedId = null;
  const editor = $('selectedEditor');
  if (editor) editor.style.display = 'none';
  $('invoiceTbody').innerHTML = '';
  setPreview(null);
  $('batchStatus').textContent = 'Ready.';
  updateQueueUi();
}

async function processQueue() {
  if (running) return;
  running = true;
  updateQueueUi();

  try {
    const todo = invoices.filter((x) => x.status === 'queued');
    for (let i = 0; i < todo.length; i++) {
      const inv = todo[i];
      $('batchStatus').textContent = `Processing ${i + 1}/${todo.length}...`;
      // eslint-disable-next-line no-await-in-loop
      await scanOne(inv);
    }
    $('batchStatus').textContent = 'Done.';
  } catch (e) {
    console.error(e);
    $('batchStatus').textContent = 'Error while processing batch.';
  } finally {
    running = false;
    updateQueueUi();
  }
}

function wireEvents() {
  const dropzone = $('dropzone');
  const fileInput = $('fileInput');
  const btnProcess = $('btnProcessQueue');
  const btnClear = $('btnClearQueue');

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  });

  btnProcess.addEventListener('click', processQueue);
  btnClear.addEventListener('click', clearAll);

  // Selected-row printed VAT editor: only edits the selected invoice.
  const editorInputs = [
    { el: $('editorPrintedVatable'), key: 'vatableSale' },
    { el: $('editorPrintedVatAmt'), key: 'vatAmount' },
    { el: $('editorPrintedTaxable'), key: 'taxableAmount' },
    { el: $('editorPrintedTotal'), key: 'totalAmount' },
  ].filter((x) => x.el);

  editorInputs.forEach(({ el, key }) => {
    el.addEventListener('input', () => {
      const inv = getSelectedInvoice();
      if (!inv) return;

      inv.printed = inv.printed || {};
      inv.printed[key] = el.value === '' ? null : el.value;

      computeVatCheck(inv);

      renderVatBadgeFor(inv);
      renderPrintedSummaryFor(inv);
    });
  });
}

wireEvents();
resetPreviewIfNeeded();
updateQueueUi();
