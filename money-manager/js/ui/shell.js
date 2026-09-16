import { escapeHtml } from '../format.js';

let currentView = 'dashboard';
const viewRenderers = {};

export function registerView(name, renderFn) {
    viewRenderers[name] = renderFn;
}

export function navigate(name) {
    currentView = name;
    document.querySelectorAll('.view').forEach((el) => {
        el.classList.toggle('active', el.dataset.view === name);
    });
    document.querySelectorAll('.nav-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.nav === name);
    });
    const fn = viewRenderers[name];
    if (fn) fn();
}

export function getCurrentView() {
    return currentView;
}

export function rerender() {
    const fn = viewRenderers[currentView];
    if (fn) fn();
}

export function toast(message, type = 'ok') {
    const root = document.getElementById('toastRoot');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
        el.remove();
    }, type === 'warn' || type === 'danger' ? 5000 : 3200);
}

export function showWarnings(warnings) {
    if (!warnings?.length) return;
    for (const w of warnings) toast(w, 'warn');
}

export function openModal({ title, bodyHtml, actions = [] }) {
    const root = document.getElementById('modalRoot');
    root.hidden = false;
    root.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h2>${escapeHtml(title)}</h2>
          <button type="button" class="btn ghost" data-close>×</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-actions" id="modalActions"></div>
      </div>
    `;

    const actionsEl = root.querySelector('#modalActions');
    for (const a of actions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn ${a.className || ''}`;
        btn.textContent = a.label;
        btn.addEventListener('click', async () => {
            if (a.close !== false) closeModal();
            if (a.onClick) await a.onClick();
        });
        actionsEl.appendChild(btn);
    }

    root.querySelector('[data-close]').addEventListener('click', closeModal);
    root.addEventListener('click', (e) => {
        if (e.target === root) closeModal();
    });

    return root.querySelector('.modal');
}

export function closeModal() {
    const root = document.getElementById('modalRoot');
    root.hidden = true;
    root.innerHTML = '';
}

export function bindNav() {
    document.querySelectorAll('.nav-item').forEach((btn) => {
        btn.addEventListener('click', () => navigate(btn.dataset.nav));
    });
}

export function fundSelectOptions(funds, selected = '') {
    return funds
        .filter((f) => !f.archived)
        .map(
            (f) =>
                `<option value="${escapeHtml(f.id)}" ${f.id === selected ? 'selected' : ''}>${escapeHtml(f.name)}</option>`
        )
        .join('');
}

export function accountSelectOptions(accounts, selected = '', { allowNull = false } = {}) {
    const opts = accounts
        .map(
            (a) =>
                `<option value="${escapeHtml(a.id)}" ${a.id === selected ? 'selected' : ''}>${escapeHtml(a.name)}</option>`
        )
        .join('');
    if (allowNull) {
        return `<option value="">—</option>${opts}`;
    }
    return opts;
}

export function moneyClass(n) {
    if (n < 0) return 'danger';
    return '';
}
