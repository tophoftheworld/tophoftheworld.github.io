const STORAGE_KEY = 'pdf-signer-signatures';

export function loadSignatures() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSignatures(signatures) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(signatures));
}

export function addSignature(name, dataUrl) {
  const signatures = loadSignatures();
  const sig = {
    id: crypto.randomUUID(),
    name: name || `Signature ${signatures.length + 1}`,
    dataUrl,
    createdAt: Date.now(),
  };
  signatures.push(sig);
  saveSignatures(signatures);
  return sig;
}

export function removeSignature(id) {
  const signatures = loadSignatures().filter((s) => s.id !== id);
  saveSignatures(signatures);
}

export function getSignature(id) {
  return loadSignatures().find((s) => s.id === id) || null;
}

export function renderSignatureGrid(container, signatures, { onSelect, activePlacementId, selectedSavedId, disabled }) {
  container.innerHTML = '';

  if (!signatures.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'No saved signatures yet';
    container.appendChild(empty);
    return;
  }

  for (const sig of signatures) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'signature-thumb';
    btn.dataset.id = sig.id;
    btn.title = disabled ? 'Load a PDF first' : sig.name;
    btn.disabled = !!disabled;

    if (sig.id === activePlacementId) btn.classList.add('active-placement');
    if (sig.id === selectedSavedId) btn.classList.add('selected-saved');

    const img = document.createElement('img');
    img.src = sig.dataUrl;
    img.alt = sig.name;
    btn.appendChild(img);

    const label = document.createElement('span');
    label.className = 'thumb-label';
    label.textContent = sig.name;
    btn.appendChild(label);

    btn.addEventListener('click', () => onSelect(sig));
    container.appendChild(btn);
  }
}

export async function getImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}
