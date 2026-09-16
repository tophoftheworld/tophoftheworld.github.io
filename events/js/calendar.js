import {
  displayTitle,
  EVENT_STATUSES,
  formatHeadcountLabel,
  isScheduled,
  manilaTodayYmd,
  pipelineLabel
} from '../../shared/js/ops-events.js?v=21';
import { escapeAttr, escapeHtml } from './types.js?v=21';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LANE_HEIGHT_PX = 36;

export function monthLabel(year, monthIndex) {
  return new Date(year, monthIndex, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric'
  });
}

/** Always 6 weeks × 7 days so the grid stays even. */
export function buildMonthCells(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const today = manilaTodayYmd();
  const cells = [];

  for (let i = 0; i < startPad; i++) {
    const d = new Date(year, monthIndex, 1 - (startPad - i));
    cells.push(cellFromDate(d, true, today));
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(cellFromDate(new Date(year, monthIndex, day), false, today));
  }
  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    const [y, m, d] = last.ymd.split('-').map(Number);
    const next = new Date(y, m - 1, d + 1);
    cells.push(cellFromDate(next, true, today));
  }
  return cells;
}

function cellFromDate(date, outside, todayYmd) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return {
    ymd,
    day: d,
    outside,
    today: ymd === todayYmd
  };
}

function eventKind(ev) {
  const isDraft = ev.status === EVENT_STATUSES.draft;
  const isHold = isDraft && !String(ev.title || '').trim();
  return isHold ? 'hold' : isDraft ? 'draft' : 'confirmed';
}

function chipContext(ev) {
  const parts = [];
  const venue = String(ev?.venue || '').trim();
  if (venue) parts.push(venue);
  const hc = formatHeadcountLabel(ev);
  if (hc) parts.push(hc);
  return parts.join(' · ');
}

function passesEventFilter(ev, filter) {
  if (!isScheduled(ev)) return false;
  if (filter === 'leads') return false;
  if (filter === 'drafts' && ev.status !== EVENT_STATUSES.draft) return false;
  if (filter === 'events' && ev.status === EVENT_STATUSES.draft) return false;
  if (ev.status === EVENT_STATUSES.cancelled) return false;
  return true;
}

function segOverlaps(a, b) {
  return !(a.endCol <= b.startCol || a.startCol >= b.endCol);
}

/**
 * Pack non-overlapping segments into the first free lane from the top.
 * @param {{ startCol: number, endCol: number }[]} segments endCol exclusive
 */
function packLanes(segments) {
  const sorted = [...segments].sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    const durA = a.endCol - a.startCol;
    const durB = b.endCol - b.startCol;
    if (durA !== durB) return durB - durA;
    return 0;
  });

  const lanes = [];
  for (const seg of sorted) {
    let placed = false;
    for (const lane of lanes) {
      if (!lane.some((s) => segOverlaps(s, seg))) {
        lane.push(seg);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([seg]);
  }
  return lanes;
}

function weekSpanSegments(weekEvents, weekCells) {
  const weekStart = weekCells[0].ymd;
  const weekEnd = weekCells[6].ymd;
  const ymdToCol = new Map(weekCells.map((c, i) => [c.ymd, i]));
  const segments = [];

  for (const ev of weekEvents) {
    const evStart = ev.startDate;
    const evEnd = ev.endDate || ev.startDate;
    if (evEnd < weekStart || evStart > weekEnd) continue;

    const clipStart = evStart > weekStart ? evStart : weekStart;
    const clipEnd = evEnd < weekEnd ? evEnd : weekEnd;
    const startCol = ymdToCol.get(clipStart);
    const endColInclusive = ymdToCol.get(clipEnd);
    if (startCol == null || endColInclusive == null) continue;

    segments.push({
      ev,
      startCol,
      endCol: endColInclusive + 1,
      continuesLeft: evStart < weekStart,
      continuesRight: evEnd > weekEnd
    });
  }

  return packLanes(segments);
}

function occupiedLaneCount(lanes, col) {
  let depth = 0;
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i].some((s) => s.startCol <= col && col < s.endCol)) {
      depth = i + 1;
    }
  }
  return depth;
}

function spanButtonHtml(seg) {
  const kind = eventKind(seg.ev);
  const title = displayTitle(seg.ev);
  const meta = chipContext(seg.ev);
  const radiusCls = [
    'span-start',
    'span-end',
    seg.continuesLeft ? 'continues-left' : '',
    seg.continuesRight ? 'continues-right' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const tip = meta ? `${title} · ${meta}` : title;
  return `<button type="button" class="cal-span ${kind} ${radiusCls}"
    style="grid-column: ${seg.startCol + 1} / ${seg.endCol + 1}"
    data-event-id="${escapeAttr(seg.ev.id)}"
    draggable="true"
    title="${escapeAttr(tip)}">
    <span class="cal-span__body">
      <span class="cal-span__label">${escapeHtml(title)}</span>
      ${meta ? `<span class="cal-span__meta">${escapeHtml(meta)}</span>` : ''}
    </span>
  </button>`;
}

/**
 * @param {object} opts
 */
export function renderCalendar(opts) {
  const {
    gridEl,
    year,
    monthIndex,
    events,
    leads,
    filter,
    onDayClick,
    onDayMore,
    onEventClick,
    onLeadClick,
    onEventDrop
  } = opts;

  const cells = buildMonthCells(year, monthIndex);
  const byDate = new Map();
  for (const cell of cells) {
    byDate.set(cell.ymd, { leads: [] });
  }

  const scheduledEvents = [];
  for (const ev of events || []) {
    if (!passesEventFilter(ev, filter)) continue;
    scheduledEvents.push(ev);
  }

  if (filter === 'all' || filter === 'leads') {
    for (const lead of leads || []) {
      if (filter === 'leads' && lead.pipelineStatus === 'invoiced' && lead.source === 'invoice') {
        /* show all lead statuses including invoiced */
      }
      const bucket = byDate.get(lead.targetDate);
      if (bucket) bucket.leads.push(lead);
    }
  }

  const weeksHtml = [];
  for (let w = 0; w < 6; w++) {
    const weekCells = cells.slice(w * 7, w * 7 + 7);
    const lanes = weekSpanSegments(scheduledEvents, weekCells);
    const laneStackPx = lanes.length * LANE_HEIGHT_PX;

    const lanesHtml = lanes
      .map((lane) => `<div class="cal-lane">${lane.map(spanButtonHtml).join('')}</div>`)
      .join('');

    const cellsHtml = weekCells
      .map((cell, col) => {
        const bucket = byDate.get(cell.ymd) || { leads: [] };
        const chips = bucket.leads.map((ld) => leadChipHtml(ld)).join('');
        const dayLanePx = occupiedLaneCount(lanes, col) * LANE_HEIGHT_PX;
        const cls = [
          'cal-cell',
          cell.outside ? 'outside' : '',
          cell.today ? 'today' : ''
        ]
          .filter(Boolean)
          .join(' ');

        return `<div class="${cls}" data-date="${escapeAttr(cell.ymd)}" tabindex="0" role="gridcell">
          <div class="cal-cell-day">${cell.day}</div>
          <div class="cal-cell-lane-space" style="height:${dayLanePx}px" aria-hidden="true"></div>
          <div class="cal-chips">${chips}</div>
        </div>`;
      })
      .join('');

    weeksHtml.push(`<div class="cal-week" role="row">
      <div class="cal-week-main">
        <div class="cal-week-cells">${cellsHtml}</div>
        ${
          lanes.length
            ? `<div class="cal-week-lanes" style="height:${laneStackPx}px">${lanesHtml}</div>`
            : ''
        }
      </div>
    </div>`);
  }

  gridEl.innerHTML = weeksHtml.join('');
  fitOverflowChips(gridEl);
  requestAnimationFrame(() => {
    fitOverflowChips(gridEl);
    requestAnimationFrame(() => fitOverflowChips(gridEl));
  });

  if (typeof ResizeObserver !== 'undefined') {
    if (gridEl._overflowRo) gridEl._overflowRo.disconnect();
    gridEl._overflowRo = new ResizeObserver(() => fitOverflowChips(gridEl));
    gridEl._overflowRo.observe(gridEl);
  }

  gridEl.onclick = (e) => {
    const chip = e.target.closest('[data-event-id], [data-lead-id], [data-more]');
    if (chip?.dataset.eventId) {
      e.stopPropagation();
      const ev = events.find((x) => x.id === chip.dataset.eventId);
      if (ev) onEventClick?.(ev);
      return;
    }
    if (chip?.dataset.leadId) {
      e.stopPropagation();
      const ld = (leads || []).find((x) => x.id === chip.dataset.leadId);
      if (ld) onLeadClick?.(ld);
      return;
    }
    if (chip?.dataset.more) {
      e.stopPropagation();
      e.preventDefault();
      onDayMore?.(chip.dataset.more, e);
      return;
    }
    const cell = e.target.closest('[data-date]');
    if (cell) onDayClick?.(cell.dataset.date, e);
  };

  gridEl.ondragstart = (e) => {
    const chip = e.target.closest('[data-event-id][draggable="true"]');
    if (!chip) return;
    e.dataTransfer.setData('text/ops-event-id', chip.dataset.eventId);
    e.dataTransfer.effectAllowed = 'move';
  };

  gridEl.ondragover = (e) => {
    const cell = e.target.closest('[data-date]');
    if (!cell) return;
    e.preventDefault();
    cell.classList.add('drag-over');
  };

  gridEl.ondragleave = (e) => {
    const cell = e.target.closest('[data-date]');
    if (cell) cell.classList.remove('drag-over');
  };

  gridEl.ondrop = (e) => {
    const cell = e.target.closest('[data-date]');
    if (!cell) return;
    e.preventDefault();
    cell.classList.remove('drag-over');
    const eventId = e.dataTransfer.getData('text/ops-event-id');
    if (eventId) onEventDrop?.(eventId, cell.dataset.date);
  };
}

/** Hide chips that would paint past the cell edge; show +N more. */
function fitOverflowChips(gridEl) {
  gridEl.querySelectorAll('.cal-cell[data-date]').forEach((cell) => {
    const wrap = cell.querySelector('.cal-chips');
    if (!wrap) return;
    wrap.querySelectorAll('.cal-more').forEach((el) => el.remove());
    const chips = [...wrap.querySelectorAll('.cal-chip')];
    chips.forEach((chip) => {
      chip.hidden = false;
    });
    if (!chips.length) return;

    const cellBottom = cell.getBoundingClientRect().bottom - 2;
    const MORE_RESERVE_PX = 22;
    let hidden = 0;

    const ensureMore = () => {
      let more = wrap.querySelector('.cal-more');
      if (!more) {
        more = document.createElement('button');
        more.type = 'button';
        more.className = 'cal-more';
        more.dataset.more = cell.dataset.date;
        wrap.appendChild(more);
      }
      more.textContent = `+${hidden} more`;
      return more;
    };

    const overflows = () => {
      const limit = hidden > 0 ? cellBottom - MORE_RESERVE_PX : cellBottom;
      for (const chip of chips) {
        if (chip.hidden) continue;
        if (chip.getBoundingClientRect().bottom > limit) return true;
      }
      if (hidden > 0) {
        const more = ensureMore();
        if (more.getBoundingClientRect().bottom > cellBottom) return true;
      }
      return false;
    };

    // Cap: if cell has almost no room, hide all but keep +N
    let guard = 0;
    while (overflows() && guard < 40) {
      guard += 1;
      let hidOne = false;
      for (let i = chips.length - 1; i >= 0; i--) {
        if (chips[i].hidden) continue;
        chips[i].hidden = true;
        hidden += 1;
        hidOne = true;
        break;
      }
      if (!hidOne) break;
    }

    if (hidden > 0) ensureMore();
    else wrap.querySelectorAll('.cal-more').forEach((el) => el.remove());
  });
}

function leadChipHtml(lead) {
  const label = String(lead.clientName || lead.quoteReference || 'Lead').trim();
  const pip = lead.pipelineStatus || 'inquiry';
  return `<button type="button" class="cal-chip lead" data-lead-id="${escapeAttr(lead.id)}"
    title="${escapeAttr(label)} · ${escapeAttr(pipelineLabel(pip))}">
    <span class="cal-chip__row">
      <span class="lead-pip lead-pipeline-${escapeAttr(pip)}">${escapeHtml(pipelineLabel(pip))}</span>
      <span class="cal-chip__label">${escapeHtml(label)}</span>
    </span>
  </button>`;
}

export function renderUnscheduled(listEl, countEl, events, { onEventClick, filter }) {
  const rows = (events || []).filter((ev) => {
    if (isScheduled(ev)) return false;
    if (ev.status === EVENT_STATUSES.cancelled) return false;
    if (filter === 'leads') return false;
    if (filter === 'drafts' && ev.status !== EVENT_STATUSES.draft) return false;
    if (filter === 'events' && ev.status === EVENT_STATUSES.draft) return false;
    return true;
  });

  if (countEl) countEl.textContent = `(${rows.length})`;
  if (!listEl) return;

  if (!rows.length) {
    listEl.innerHTML = `<p class="subtle" style="margin:0.15rem 0 0">No unscheduled events.</p>`;
    return;
  }

  listEl.innerHTML = rows
    .map((ev) => {
      const confirmed = ev.status === EVENT_STATUSES.confirmed;
      return `<button type="button" class="unscheduled-item${confirmed ? ' is-confirmed' : ''}" data-event-id="${escapeAttr(ev.id)}">
        <span class="unscheduled-dot" aria-hidden="true"></span>
        ${escapeHtml(displayTitle(ev))}
      </button>`;
    })
    .join('');

  listEl.onclick = (e) => {
    const btn = e.target.closest('[data-event-id]');
    if (!btn) return;
    const ev = rows.find((x) => x.id === btn.dataset.eventId);
    if (ev) onEventClick?.(ev);
  };
}

export { WEEKDAYS };
