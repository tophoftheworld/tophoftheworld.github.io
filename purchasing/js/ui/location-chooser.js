import { escapeHtml } from '../format.js?v=96';
import {
  ADD_LOCATION_CHOICES,
  eventLocationKeyFromLabel,
  getLocationMetaCache,
  isNamedEventLocation,
  locationLabel,
  LOCATIONS,
  upsertLocationMetaCache,
} from '../data/catalog.js?v=96';
import { loadActivePopupEvents, getCachedPopupEvents } from '../data/popup-events.js?v=96';
import { persist } from '../store.js?v=96';

/**
 * Pin a location on the week so its panel shows even with no lines yet.
 */
export function pinLocation(week, key, entry = {}) {
  if (!week || !key) return;
  if (!week.locationMeta) week.locationMeta = { ...(getLocationMetaCache() || {}) };
  const fromList = LOCATIONS.find((l) => l.key === key);
  const next = {
    label: entry.label || fromList?.label || locationLabel(key),
    kind:
      entry.kind ||
      (isNamedEventLocation(key)
        ? 'event'
        : key === 'general'
          ? 'general'
          : key === 'events'
            ? 'events'
            : 'store'),
    pinned: true,
    ...entry,
  };
  week.locationMeta[key] = { ...(week.locationMeta[key] || {}), ...next };
  upsertLocationMetaCache(key, week.locationMeta[key]);
  persist();
}

function closeModal() {
  const root = document.getElementById('modalRoot');
  if (!root) return;
  root.hidden = true;
  root.innerHTML = '';
}

/**
 * Step 1: Stores / General / Events.
 * Step 2 (Events): search pop-up dashboard events or type a custom name.
 * Does NOT open the add-line modal \u2014 just pins the location panel.
 */
export function openAddLocationChooser(week, { onPinned } = {}) {
  const root = document.getElementById('modalRoot');
  if (!root || !week) return;

  function finish(locKey) {
    closeModal();
    try {
      localStorage.setItem(
        'purchasing-collapsed-locs',
        JSON.stringify({
          ...JSON.parse(localStorage.getItem('purchasing-collapsed-locs') || '{}'),
          [locKey]: false,
        })
      );
    } catch (_) {
      /* ignore */
    }
    onPinned?.(locKey);
  }

  function showKindStep() {
    root.hidden = false;
    root.innerHTML = `
      <div class="modal-backdrop" data-close></div>
      <div class="modal loc-chooser-modal" role="dialog" aria-modal="true" aria-labelledby="locChooserTitle">
        <div class="modal-header">
          <h2 id="locChooserTitle">Add location</h2>
          <button type="button" class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="loc-chooser-hint">Choose a store, General, or an event.</p>
          <div class="loc-chooser-grid">
            ${ADD_LOCATION_CHOICES.map(
              (c) => `
              <button type="button" class="loc-chooser-opt" data-loc-choice="${escapeHtml(c.key)}">
                <span class="loc-chooser-opt-label">${escapeHtml(c.label)}</span>
                <span class="loc-chooser-opt-kind">${
                  c.key === 'events'
                    ? 'From pop-ups or custom'
                    : c.key === 'general'
                      ? 'Shared / HQ'
                      : 'Store'
                }</span>
              </button>`
            ).join('')}
          </div>
        </div>
      </div>`;

    root.querySelector('[data-close]')?.addEventListener('click', closeModal);
    root.querySelector('.modal-close')?.addEventListener('click', closeModal);
    root.querySelectorAll('[data-loc-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.locChoice;
        if (key === 'events') {
          showEventStep();
          return;
        }
        pinLocation(week, key);
        finish(key);
      });
    });
  }

  async function showEventStep() {
    root.hidden = false;
    root.innerHTML = `
      <div class="modal-backdrop" data-close></div>
      <div class="modal loc-chooser-modal" role="dialog" aria-modal="true" aria-labelledby="eventChooserTitle">
        <div class="modal-header">
          <h2 id="eventChooserTitle">Add event</h2>
          <button type="button" class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <label class="loc-chooser-field">
            <span>Search pop-ups</span>
            <input type="search" data-event-search placeholder="Search events" autocomplete="off" />
          </label>
          <div class="loc-chooser-event-list" data-event-list role="listbox" aria-label="Pop-up events">
            <p class="loc-chooser-loading">Loading events\u2026</p>
          </div>
          <div class="loc-chooser-custom">
            <p class="loc-chooser-existing-label">Or custom name</p>
            <label class="loc-chooser-field">
              <span class="sr-only">Custom event name</span>
              <input type="text" data-event-name placeholder="Event name" autocomplete="off" />
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn secondary" data-back>Back</button>
          <button type="button" class="btn primary" data-event-continue>Add event</button>
        </div>
      </div>`;

    const listEl = root.querySelector('[data-event-list]');
    const searchInput = root.querySelector('[data-event-search]');
    const nameInput = root.querySelector('[data-event-name]');

    root.querySelector('[data-close]')?.addEventListener('click', closeModal);
    root.querySelector('.modal-close')?.addEventListener('click', closeModal);
    root.querySelector('[data-back]')?.addEventListener('click', showKindStep);

    let popupEvents = getCachedPopupEvents();

    function renderList(query = '') {
      const q = query.trim().toLowerCase();
      const filtered = popupEvents.filter((ev) => {
        if (!q) return true;
        return (
          ev.name.toLowerCase().includes(q) ||
          ev.key.toLowerCase().includes(q)
        );
      });
      if (!filtered.length) {
        listEl.innerHTML = `<p class="loc-chooser-empty">${
          popupEvents.length ? 'No matching events' : 'No pop-up events found'
        }</p>`;
        return;
      }
      listEl.innerHTML = filtered
        .slice(0, 40)
        .map((ev) => {
          const kind = ev.serviceType === 'package' ? 'Package' : 'Pop-up';
          return `<button type="button" class="loc-chooser-opt loc-chooser-opt--row" data-popup-key="${escapeHtml(ev.key)}" data-popup-id="${escapeHtml(ev.id)}" data-popup-name="${escapeHtml(ev.name)}" data-popup-type="${escapeHtml(ev.serviceType || 'popup')}">
            <span class="loc-chooser-opt-label">${escapeHtml(ev.name)}</span>
            <span class="loc-chooser-opt-kind">${escapeHtml(kind)}</span>
          </button>`;
        })
        .join('');

      listEl.querySelectorAll('[data-popup-key]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const label = btn.dataset.popupName;
          const existingKeys = [
            ...Object.keys(week.locationMeta || {}),
            ...Object.keys(getLocationMetaCache() || {}),
            ...(week.lines || []).map((l) => l.location),
          ];
          // Prefer stable key tied to pop-up key for linking
          const locKey = eventLocationKeyFromLabel(btn.dataset.popupKey || label, existingKeys);
          pinLocation(week, locKey, {
            label,
            kind: 'event',
            popupKey: btn.dataset.popupKey,
            popupId: btn.dataset.popupId,
            serviceType: btn.dataset.popupType || 'popup',
          });
          finish(locKey);
        });
      });
    }

    renderList();
    loadActivePopupEvents()
      .then((list) => {
        popupEvents = list;
        renderList(searchInput?.value || '');
      })
      .catch(() => {
        if (listEl.querySelector('.loc-chooser-loading')) {
          listEl.innerHTML = `<p class="loc-chooser-empty">Could not load pop-up events</p>`;
        }
      });

    searchInput?.addEventListener('input', () => renderList(searchInput.value));

    function commitCustom() {
      const label = (nameInput?.value || '').trim();
      if (!label) {
        nameInput?.focus();
        return;
      }
      const existingKeys = [
        ...Object.keys(week.locationMeta || {}),
        ...Object.keys(getLocationMetaCache() || {}),
        ...(week.lines || []).map((l) => l.location),
      ];
      const key = eventLocationKeyFromLabel(label, existingKeys);
      pinLocation(week, key, { label, kind: 'event' });
      finish(key);
    }

    root.querySelector('[data-event-continue]')?.addEventListener('click', commitCustom);
    nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitCustom();
      }
    });
    searchInput?.focus();
  }

  showKindStep();
}
