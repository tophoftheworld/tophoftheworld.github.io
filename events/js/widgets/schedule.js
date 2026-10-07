/** Live Schedule widget for the event dashboard. */

import { escapeHtml } from '../types.js?v=46';
import {
  deleteEventShift,
  fetchEventSchedulePreview,
  fetchScheduleEmployees,
  saveEventShift,
  SCHEDULE_SHIFT_PRESETS,
  toTimeInputValue
} from '../sync.js?v=47';
import { registerWidget } from './registry.js?v=47';

const SECTION_LABEL = {
  opening: 'Opening',
  mid: 'Mid',
  closing: 'Closing',
  custom: 'Custom'
};

const PHOTO_PH =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iMjAiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0iI0NDQ0NDQyIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxwYXRoIGQ9Ik0yMCAxMkMxNi42ODYzIDEyIDE0IDE0LjY4NjMgMTQgMThDMTQgMjEuMzEzNyAxNi42ODYzIDI0IDIwIDI0QzIzLjMxMzcgMjQgMjYgMjEuMzEzNyAyNiAxOEMyNiAxNC42ODYzIDIzLjMxMzcgMTIgMjAgMTJaIiBmaWxsPSIjQ0NDQ0NDQi8+CjxwYXRoIGQ9Ik0xMCAzNkMxMCAzMS41ODE3IDEzLjU4MTcgMjggMTggMjhIMjJDMjYuNDE4MyAyOCAzMCAzMS41ODE3IDMwIDM2VjM4SDEwVjM2WiIgZmlsbD0iI0NDQ0NDQyIvPgo8L3N2Zz4K';

let nestedEscHandler = null;
let nestedClickHandler = null;

function nestedEls() {
  const modal = document.getElementById('eventNestedModal');
  const body = document.getElementById('eventNestedModalBody');
  return { modal, body };
}

function closeNested() {
  const { modal, body } = nestedEls();
  if (body) body.innerHTML = '';
  if (modal) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }
  if (nestedEscHandler) {
    document.removeEventListener('keydown', nestedEscHandler);
    nestedEscHandler = null;
  }
  if (nestedClickHandler && modal) {
    modal.removeEventListener('click', nestedClickHandler);
    nestedClickHandler = null;
  }
}

function openNested(html, { onAction, employees = [] } = {}) {
  const { modal, body } = nestedEls();
  if (!modal || !body) {
    console.warn('[widget:schedule] nested modal missing from DOM');
    return;
  }
  closeNested();
  body.innerHTML = html;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');

  const typeSelect = body.querySelector('[data-sched-type]');
  const customBlock = body.querySelector('[data-sched-custom]');
  const syncCustomVisibility = () => {
    if (!customBlock) return;
    const isCustom = typeSelect?.value === 'custom';
    customBlock.hidden = !isCustom;
    if (!isCustom) return;
    const startEl = body.querySelector('[data-sched-start]');
    const endEl = body.querySelector('[data-sched-end]');
    const defaults = SCHEDULE_SHIFT_PRESETS.custom;
    if (startEl && !startEl.value) startEl.value = defaults.start || '09:30';
    if (endEl && !endEl.value) endEl.value = defaults.end || '18:30';
  };
  typeSelect?.addEventListener('change', syncCustomVisibility);
  syncCustomVisibility();
  wireEmployeeCombobox(body, employees);

  nestedEscHandler = (e) => {
    if (e.key === 'Escape') {
      const suggest = body.querySelector('[data-sched-employee-suggest]');
      if (suggest && !suggest.hidden) {
        e.stopPropagation();
        suggest.hidden = true;
        return;
      }
      e.stopPropagation();
      onAction?.({ type: 'cancel' });
    }
  };
  document.addEventListener('keydown', nestedEscHandler);

  nestedClickHandler = (e) => {
    if (e.target.closest('[data-nested-dismiss]')) {
      onAction?.({ type: 'cancel' });
      return;
    }
    const t = e.target.closest(
      '[data-sched-cancel],[data-sched-save],[data-sched-delete]'
    );
    if (!t || !modal.contains(t)) return;
    e.preventDefault();
    if (t.hasAttribute('data-sched-cancel')) onAction?.({ type: 'cancel' });
    else if (t.hasAttribute('data-sched-save')) onAction?.({ type: 'save' });
    else if (t.hasAttribute('data-sched-delete')) onAction?.({ type: 'delete' });
  };
  modal.addEventListener('click', nestedClickHandler);
}

function escapeAttr(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDayLabel(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
}

function isPastYmd(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d) < today;
}

function scheduleOpenHref(branchKey, date) {
  const params = new URLSearchParams({ admin: 'true' });
  if (branchKey) params.set('branch', branchKey);
  if (date) params.set('date', date);
  return `../schedule/index.html?${params.toString()}&v=55`;
}

function cardHtml(row) {
  const photo = row.photoUrl || PHOTO_PH;
  const kind = row.kind || 'opening';
  return `<button type="button" class="event-sched-card is-${escapeAttr(kind)}" data-sched-edit="${escapeAttr(row.shiftId)}" title="Edit shift">
    <img class="event-sched-card__photo" src="${escapeAttr(photo)}" alt="" width="36" height="36" loading="lazy" />
    <div class="event-sched-card__details">
      <div class="event-sched-card__name">${escapeHtml(row.name)}</div>
      <div class="event-sched-card__time">${escapeHtml(row.timeIn || '—')}</div>
      <div class="event-sched-card__time">${row.timeOut ? `- ${escapeHtml(row.timeOut)}` : '-'}</div>
    </div>
  </button>`;
}

function sectionHtml(kind, rows) {
  if (!rows.length) return '';
  return `<div class="event-sched-section">
    <div class="event-sched-section__label">${escapeHtml(SECTION_LABEL[kind] || kind)} · ${rows.length}</div>
    <div class="event-sched-list">${rows.map(cardHtml).join('')}</div>
  </div>`;
}

function typeOptionsHtml(selected) {
  return Object.entries(SCHEDULE_SHIFT_PRESETS)
    .map(
      ([key, meta]) =>
        `<option value="${escapeAttr(key)}"${key === selected ? ' selected' : ''}>${escapeHtml(meta.label)}</option>`
    )
    .join('');
}

function findEmployee(employees, id) {
  return (employees || []).find((e) => e.id === id) || null;
}

function filterEmployees(employees, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return [];
  return employees
    .filter((e) => {
      const nick = String(e.nickname || '').toLowerCase();
      const name = String(e.name || '').toLowerCase();
      return nick.includes(q) || name.includes(q) || String(e.id).includes(q);
    })
    .slice(0, 12);
}

function employeeSuggestHtml(employees) {
  if (!employees.length) {
    return `<div class="event-sched-suggest__empty">No matches</div>`;
  }
  return employees
    .map(
      (emp) =>
        `<button type="button" class="event-sched-suggest__item" data-sched-pick="${escapeAttr(emp.id)}" data-sched-pick-label="${escapeAttr(emp.nickname)}">${escapeHtml(emp.nickname)}</button>`
    )
    .join('');
}

function wireEmployeeCombobox(body, employees) {
  const wrap = body.querySelector('[data-sched-employee-wrap]');
  const input = body.querySelector('[data-sched-employee-input]');
  const hidden = body.querySelector('[data-sched-employee-id]');
  const list = body.querySelector('[data-sched-employee-suggest]');
  if (!wrap || !input || !hidden || !list) return;

  let activeIndex = -1;

  const setSelected = (id, label) => {
    hidden.value = id || '';
    if (label != null) input.value = label;
    input.classList.toggle('is-selected', !!id);
  };

  const hideList = () => {
    list.hidden = true;
    activeIndex = -1;
  };

  const renderList = (items) => {
    if (!items.length) {
      hideList();
      return;
    }
    list.innerHTML = employeeSuggestHtml(items);
    list.hidden = false;
    activeIndex = -1;
  };

  const highlight = () => {
    const items = [...list.querySelectorAll('.event-sched-suggest__item')];
    items.forEach((el, i) => el.classList.toggle('is-active', i === activeIndex));
    items[activeIndex]?.scrollIntoView({ block: 'nearest' });
  };

  // Suggestions only while typing — not on empty focus / modal open
  input.addEventListener('input', () => {
    const q = input.value.trim();
    const exact = employees.find((e) => e.nickname.toLowerCase() === q.toLowerCase());
    if (exact) {
      setSelected(exact.id, exact.nickname);
    } else {
      hidden.value = '';
      input.classList.remove('is-selected');
    }
    if (!q) {
      hideList();
      return;
    }
    renderList(filterEmployees(employees, q));
  });

  input.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('.event-sched-suggest__item')];
    if (e.key === 'ArrowDown') {
      if (list.hidden || !items.length) return;
      e.preventDefault();
      activeIndex = Math.min(items.length - 1, activeIndex + 1);
      highlight();
    } else if (e.key === 'ArrowUp') {
      if (list.hidden || !items.length) return;
      e.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      highlight();
    } else if (e.key === 'Enter') {
      const pick = items[activeIndex];
      if (pick && !list.hidden) {
        e.preventDefault();
        setSelected(pick.getAttribute('data-sched-pick'), pick.getAttribute('data-sched-pick-label'));
        hideList();
      }
    } else if (e.key === 'Escape') {
      if (!list.hidden) {
        e.preventDefault();
        e.stopPropagation();
        hideList();
      }
    }
  });

  list.addEventListener('mousedown', (e) => {
    const pick = e.target.closest('[data-sched-pick]');
    if (!pick) return;
    e.preventDefault();
    setSelected(pick.getAttribute('data-sched-pick'), pick.getAttribute('data-sched-pick-label'));
    hideList();
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!wrap.contains(document.activeElement)) hideList();
    }, 120);
  });
}

function shellLoading() {
  return `
    <div class="event-widget__stat-row">
      <strong>Loading schedule…</strong>
    </div>
    <div class="event-sched-list event-sched-list--skeleton" aria-hidden="true">
      <div class="event-sched-card is-opening">
        <span class="event-sched-card__photo event-sched-card__photo--ph"></span>
        <div class="event-sched-card__details">
          <span class="event-sched-card__time" style="width:60%;height:0.55rem;background:rgba(255,255,255,.35);border-radius:3px;"></span>
          <span class="event-sched-card__time" style="width:80%;height:0.45rem;background:rgba(255,255,255,.25);border-radius:3px;margin-top:4px;"></span>
        </div>
      </div>
    </div>`;
}

function renderPreview(preview, { canAdd = false } = {}) {
  if (preview.emptyReason === 'no-branch') {
    return `<p class="event-widget__empty-state">Confirm event to enable Schedule</p>`;
  }
  if (preview.emptyReason === 'no-dates') {
    return `<p class="event-widget__empty-state">Add dates to see who’s scheduled</p>`;
  }
  if (preview.emptyReason === 'load-failed') {
    return `<p class="event-widget__empty-state">Couldn’t load schedule</p>`;
  }

  const date = preview.date;
  const navDates = preview.navDates || [];
  const idx = navDates.indexOf(date);
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < navDates.length - 1;
  const rows = preview.rows || [];
  const opening = rows.filter((r) => r.kind === 'opening');
  const mid = rows.filter((r) => r.kind === 'mid');
  const closing = rows.filter((r) => r.kind === 'closing');
  const custom = rows.filter((r) => r.kind === 'custom');
  const past = isPastYmd(date);
  const openHref = scheduleOpenHref(preview.branchKey, date);

  const dayNav =
    date && navDates.length
      ? `<div class="event-sched-daynav" role="group" aria-label="Schedule day">
          <button type="button" class="event-sched-daynav__btn" data-sched-day="-1" ${hasPrev ? '' : 'disabled'} aria-label="Previous day">‹</button>
          <span class="event-sched-daynav__label">${escapeHtml(formatDayLabel(date))}</span>
          <button type="button" class="event-sched-daynav__btn" data-sched-day="1" ${hasNext ? '' : 'disabled'} aria-label="Next day">›</button>
        </div>`
      : '';

  const body =
    rows.length === 0
      ? `<p class="event-widget__empty-state">No shifts on the schedule for this day</p>`
      : `${sectionHtml('opening', opening)}${sectionHtml('mid', mid)}${sectionHtml('closing', closing)}${sectionHtml('custom', custom)}`;

  return `
    <div class="event-widget__stat-row event-sched-toolbar">
      <strong>${rows.length} scheduled</strong>
      ${dayNav}
    </div>
    ${body}
    <div class="event-sched-actions">
      ${
        canAdd && !past && preview.branchKey
          ? `<button type="button" class="inv-btn inv-btn-secondary inv-btn-sm" data-sched-add>+ Add shift</button>`
          : ''
      }
      <a class="event-widget__open" href="${escapeAttr(openHref)}" target="_blank" rel="noopener">Open in Schedule</a>
    </div>`;
}

function formHtml({ mode, employees, row, date, busy = false }) {
  const title = mode === 'edit' ? 'Edit shift' : 'Add shift';
  const type = row?.type || 'opening';
  const isCustom = type === 'custom';
  const customDefaults = SCHEDULE_SHIFT_PRESETS.custom;
  const startVal =
    toTimeInputValue(row?.customStart) || (isCustom ? customDefaults.start || '09:30' : '');
  const endVal =
    toTimeInputValue(row?.customEnd) || (isCustom ? customDefaults.end || '18:30' : '');
  const selected = findEmployee(employees, row?.employeeId);
  const empLabel = selected?.nickname || '';
  const empId = selected?.id || '';
  return `
    <div class="event-sched-form__panel">
      <div class="event-sched-form__head">
        <strong id="eventNestedModalTitle">${escapeHtml(title)}</strong>
        <button type="button" class="event-sched-form__close" data-sched-cancel aria-label="Close">×</button>
      </div>
      <p class="event-sched-form__meta">${escapeHtml(formatDayLabel(date))}</p>
      <label class="event-sched-form__field">
        <span>Employee</span>
        <div class="event-sched-employee" data-sched-employee-wrap>
          <input
            type="text"
            class="event-sched-employee__input${empId ? ' is-selected' : ''}"
            data-sched-employee-input
            placeholder="Type a name…"
            autocomplete="off"
            spellcheck="false"
            value="${escapeAttr(empLabel)}"
            ${busy ? 'disabled' : ''}
          />
          <input type="hidden" data-sched-employee-id value="${escapeAttr(empId)}" />
          <div class="event-sched-suggest" data-sched-employee-suggest hidden></div>
        </div>
      </label>
      <label class="event-sched-form__field">
        <span>Shift type</span>
        <select data-sched-type ${busy ? 'disabled' : ''}>${typeOptionsHtml(type)}</select>
      </label>
      <div class="event-sched-form__custom" data-sched-custom ${isCustom ? '' : 'hidden'}>
        <label class="event-sched-form__field">
          <span>Start</span>
          <input type="time" data-sched-start value="${escapeAttr(startVal)}" ${busy ? 'disabled' : ''} />
        </label>
        <label class="event-sched-form__field">
          <span>End</span>
          <input type="time" data-sched-end value="${escapeAttr(endVal)}" ${busy ? 'disabled' : ''} />
        </label>
      </div>
      <div class="event-sched-form__actions">
        ${
          mode === 'edit'
            ? `<button type="button" class="inv-btn inv-btn-danger inv-btn-sm" data-sched-delete ${busy ? 'disabled' : ''}>Delete</button>`
            : ''
        }
        <button type="button" class="inv-btn inv-btn-ghost inv-btn-sm" data-sched-cancel ${busy ? 'disabled' : ''}>Cancel</button>
        <button type="button" class="inv-btn inv-btn-primary inv-btn-sm" data-sched-save ${busy ? 'disabled' : ''}>Save</button>
      </div>
    </div>`;
}

registerWidget({
  id: 'schedule',
  title: 'Schedule',
  render() {
    return shellLoading();
  },
  async mount(root, event) {
    unmountSchedule(root);

    const state = {
      event,
      date: null,
      preview: null,
      employees: null,
      formMode: null,
      editing: null,
      busy: false,
      onClick: null
    };
    root._schedState = state;

    async function reload(date, { quiet = false } = {}) {
      state.busy = true;
      if (!quiet) {
        root.innerHTML = shellLoading();
      } else {
        root.classList.add('is-refreshing');
      }
      try {
        const preview = await fetchEventSchedulePreview(event, {
          date: date || state.date || undefined
        });
        state.preview = preview;
        state.date = preview.date;
        root.innerHTML = renderPreview(preview, { canAdd: true });
      } catch (err) {
        console.warn('[widget:schedule] load failed', err);
        if (!quiet) {
          root.innerHTML = `<p class="event-widget__empty-state">Couldn’t load schedule</p>`;
        }
      } finally {
        root.classList.remove('is-refreshing');
        state.busy = false;
      }
    }

    async function ensureEmployees() {
      if (state.employees) return state.employees;
      state.employees = await fetchScheduleEmployees();
      return state.employees;
    }

    function closeForm() {
      state.formMode = null;
      state.editing = null;
      closeNested();
    }

    async function handleFormAction({ type }) {
      if (type === 'cancel') {
        closeForm();
        return;
      }

      const { body } = nestedEls();
      if (!body || state.busy) return;

      if (type === 'save') {
        const emp = body.querySelector('[data-sched-employee-id]')?.value;
        const shiftType = body.querySelector('[data-sched-type]')?.value;
        const customStart = body.querySelector('[data-sched-start]')?.value || '';
        const customEnd = body.querySelector('[data-sched-end]')?.value || '';
        if (!emp) {
          alert('Select an employee from the list');
          body.querySelector('[data-sched-employee-input]')?.focus();
          return;
        }
        if (!shiftType) {
          alert('Select a shift type');
          return;
        }
        if (shiftType === 'custom' && (!customStart || !customEnd)) {
          alert('Enter start and end times for a custom shift');
          return;
        }
        state.busy = true;
        try {
          await saveEventShift({
            shiftId: state.editing?.shiftId || undefined,
            date: state.date,
            branchKey: state.preview.branchKey,
            type: shiftType,
            employeeId: emp,
            customStart: shiftType === 'custom' ? customStart : undefined,
            customEnd: shiftType === 'custom' ? customEnd : undefined
          });
          closeForm();
          await reload(state.date, { quiet: true });
        } catch (err) {
          console.warn('[widget:schedule] save failed', err);
          alert(err?.message || 'Failed to save shift');
          state.busy = false;
        }
        return;
      }

      if (type === 'delete') {
        if (!state.editing?.shiftId) return;
        if (!confirm('Delete this shift?')) return;
        state.busy = true;
        try {
          await deleteEventShift({ shiftId: state.editing.shiftId, date: state.date });
          closeForm();
          await reload(state.date, { quiet: true });
        } catch (err) {
          console.warn('[widget:schedule] delete failed', err);
          alert('Failed to delete shift');
          state.busy = false;
        }
      }
    }

    async function openForm(mode, row = null) {
      if (!state.preview?.branchKey || !state.date) return;
      const employees = await ensureEmployees();
      state.formMode = mode;
      state.editing = row;
      openNested(formHtml({ mode, employees, row, date: state.date }), {
        onAction: handleFormAction,
        employees
      });
    }

    state.onClick = async (e) => {
      const t = e.target.closest('[data-sched-day],[data-sched-add],[data-sched-edit]');
      if (!t || !root.contains(t)) return;
      e.preventDefault();
      if (state.busy) return;

      if (t.hasAttribute('data-sched-day')) {
        const dir = Number(t.getAttribute('data-sched-day'));
        const nav = state.preview?.navDates || [];
        const idx = nav.indexOf(state.date);
        const next = nav[idx + dir];
        if (next) await reload(next, { quiet: true });
        return;
      }

      if (t.hasAttribute('data-sched-add')) {
        await openForm('add');
        return;
      }

      if (t.hasAttribute('data-sched-edit')) {
        const id = t.getAttribute('data-sched-edit');
        const row = (state.preview?.rows || []).find((r) => r.shiftId === id);
        if (row) await openForm('edit', row);
      }
    };

    root.addEventListener('click', state.onClick);
    await reload();
  },
  unmount(root) {
    unmountSchedule(root);
  }
});

function unmountSchedule(root) {
  closeNested();
  const state = root?._schedState;
  if (state?.onClick) {
    root.removeEventListener('click', state.onClick);
  }
  if (root) delete root._schedState;
}
