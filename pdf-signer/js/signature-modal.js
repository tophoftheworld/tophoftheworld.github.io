let signaturePad = null;
let uploadDataUrl = null;
let activeTab = 'draw';
let onSaveCallback = null;

export function initSignatureModal(onSave) {
  onSaveCallback = onSave;

  const drawCanvas = document.getElementById('drawCanvas');
  const uploadZone = document.getElementById('uploadZone');
  const imageInput = document.getElementById('imageInput');

  signaturePad = new SignaturePad(drawCanvas, {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    penColor: 'rgb(0, 0, 0)',
  });

  document.getElementById('btnNewSignature').addEventListener('click', openModal);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('btnClearCanvas').addEventListener('click', clearCurrent);
  document.getElementById('btnSaveSignature').addEventListener('click', () => saveCurrent());

  document.getElementById('signatureModal').addEventListener('click', (e) => {
    if (e.target.id === 'signatureModal') closeModal();
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  uploadZone.addEventListener('click', () => imageInput.click());
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    loadImageFile(e.dataTransfer.files[0]);
  });

  imageInput.addEventListener('change', (e) => {
    loadImageFile(e.target.files[0]);
    e.target.value = '';
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('signatureModal').hidden) closeModal();
  });
}

function openModal() {
  document.getElementById('signatureModal').hidden = false;
  document.getElementById('signatureName').value = '';
  clearCurrent();
  switchTab('draw');
  requestAnimationFrame(resizeDrawCanvas);
}

function closeModal() {
  document.getElementById('signatureModal').hidden = true;
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('tabDraw').classList.toggle('active', tab === 'draw');
  document.getElementById('tabDraw').hidden = tab !== 'draw';
  document.getElementById('tabUpload').classList.toggle('active', tab === 'upload');
  document.getElementById('tabUpload').hidden = tab !== 'upload';
}

function resizeDrawCanvas() {
  const canvas = document.getElementById('drawCanvas');
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  signaturePad.clear();
  signaturePad.backgroundColor = 'rgba(0, 0, 0, 0)';
}

function clearCurrent() {
  signaturePad.clear();
  signaturePad.backgroundColor = 'rgba(0, 0, 0, 0)';
  uploadDataUrl = null;
  document.getElementById('uploadPreview').hidden = true;
  document.getElementById('uploadZone').hidden = false;
}

function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    uploadDataUrl = reader.result;
    const preview = document.getElementById('uploadPreview');
    preview.src = uploadDataUrl;
    preview.hidden = false;
    document.getElementById('uploadZone').hidden = true;
  };
  reader.readAsDataURL(file);
}

async function saveCurrent() {
  const { processSignatureDataUrl, exportDrawnSignature } = await import('./image-utils.js');
  let dataUrl = null;

  if (activeTab === 'draw') {
    if (signaturePad.isEmpty()) return;
    dataUrl = await exportDrawnSignature(signaturePad);
  } else {
    if (!uploadDataUrl) return;
    dataUrl = await processSignatureDataUrl(uploadDataUrl);
  }

  if (!dataUrl) return;
  const name = document.getElementById('signatureName').value.trim();
  if (onSaveCallback) onSaveCallback(name, dataUrl);
  closeModal();
}
