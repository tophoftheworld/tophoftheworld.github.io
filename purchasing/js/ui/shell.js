import { escapeHtml } from '../format.js?v=96';

let toastRoot = null;

export function initShell() {
  toastRoot = document.getElementById('toastRoot');
  const embedded = window.self !== window.top;
  document.body.classList.toggle('embedded', embedded);
  const chrome = document.getElementById('appChrome');
  if (chrome) chrome.hidden = embedded;
}

export function toast(msg, ms = 2800) {
  if (!toastRoot) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastRoot.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export function confirmDialog(message, onConfirm) {
  const root = document.getElementById('modalRoot');
  root.hidden = false;
  root.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2>Confirm</h2>
        <button type="button" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body"><p>${escapeHtml(message)}</p></div>
      <div class="modal-footer">
        <button type="button" class="btn secondary" data-cancel>Cancel</button>
        <button type="button" class="btn primary" data-ok>Confirm</button>
      </div>
    </div>`;
  const close = () => {
    root.hidden = true;
    root.innerHTML = '';
  };
  root.querySelector('[data-close]')?.addEventListener('click', close);
  root.querySelector('.modal-close')?.addEventListener('click', close);
  root.querySelector('[data-cancel]')?.addEventListener('click', close);
  root.querySelector('[data-ok]')?.addEventListener('click', () => {
    close();
    onConfirm();
  });
}
