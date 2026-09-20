/**
 * Calendar-anchored event dashboard: FLIP morph from a chip into
 * 80% of the calendar panel, reverse on close.
 */

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const OPEN_MS = 220;
const FADE_MS = 180;
const WHITE = '#ffffff';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}

function destFromCalendar(calendarEl) {
  const el = typeof calendarEl === 'function' ? calendarEl() : calendarEl;
  const cal = (el || document.querySelector('.cal-panel'))?.getBoundingClientRect();
  if (!cal || cal.width < 8 || cal.height < 8) {
    const w = Math.min(window.innerWidth * 0.8, 960);
    const h = Math.min(window.innerHeight * 0.8, 720);
    return {
      left: (window.innerWidth - w) / 2,
      top: (window.innerHeight - h) / 2,
      width: w,
      height: h
    };
  }
  return {
    left: cal.left + cal.width * 0.1,
    top: cal.top + cal.height * 0.1,
    width: cal.width * 0.8,
    height: cal.height * 0.8
  };
}

function sourceSelector(id) {
  const safe = String(id ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (!safe) return '';
  return `.cal-span[data-event-id="${safe}"], .unscheduled-item[data-event-id="${safe}"]`;
}

function invertTransform(src, dest) {
  const dx = src.left - dest.left;
  const dy = src.top - dest.top;
  const sx = Math.max(0.02, src.width / Math.max(dest.width, 1));
  const sy = Math.max(0.02, src.height / Math.max(dest.height, 1));
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

function sourceFill(el) {
  if (!el) return '#d7efdb';
  const bg = getComputedStyle(el).backgroundColor;
  if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return '#d7efdb';
  return bg;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.modal
 * @param {HTMLElement} opts.backdrop
 * @param {HTMLElement} opts.bodyEl
 * @param {HTMLElement} opts.footerEl
 * @param {() => HTMLElement | null} opts.calendarEl
 * @param {() => void} [opts.onRequestClose]
 */
export function createEventModal(opts) {
  const { modal, backdrop, bodyEl, footerEl, calendarEl, onRequestClose } = opts;
  const wash = modal.querySelector('.event-modal__wash');
  const panel = modal.querySelector('.event-modal__panel');

  let sourceId = null;
  let closing = false;
  let openSeq = 0;

  function applyDest() {
    const d = destFromCalendar(calendarEl);
    modal.style.left = `${d.left}px`;
    modal.style.top = `${d.top}px`;
    modal.style.width = `${d.width}px`;
    modal.style.height = `${d.height}px`;
    return d;
  }

  function liveSource() {
    if (!sourceId) return null;
    const sel = sourceSelector(sourceId);
    return sel ? document.querySelector(sel) : null;
  }

  function setSourceHidden(hidden) {
    document.querySelectorAll('.is-morph-source').forEach((el) => {
      el.classList.remove('is-morph-source');
    });
    if (!hidden) return;
    liveSource()?.classList.add('is-morph-source');
  }

  function resetInlineMotion() {
    modal.style.transition = 'none';
    modal.style.transform = '';
    modal.style.opacity = '';
    modal.style.borderRadius = '';
    modal.style.boxShadow = '';
    modal.style.transformOrigin = '';
    modal.style.backgroundColor = '';
    if (panel) {
      panel.style.transition = 'none';
      panel.style.opacity = '';
    }
    if (wash) {
      wash.style.transition = 'none';
      wash.style.opacity = '';
      wash.style.backgroundColor = '';
    }
  }

  function finishClose() {
    closing = false;
    modal.hidden = true;
    modal.classList.remove('is-open', 'is-animating');
    modal.setAttribute('aria-hidden', 'true');
    backdrop.hidden = true;
    backdrop.classList.remove('open');
    setSourceHidden(false);
    sourceId = null;
    resetInlineMotion();
    modal.style.left = '';
    modal.style.top = '';
    modal.style.width = '';
    modal.style.height = '';
  }

  function isOpen() {
    return !modal.hidden && !closing;
  }

  function rebindSource(eventId) {
    if (eventId) sourceId = eventId;
    if (isOpen()) setSourceHidden(true);
  }

  async function open({ source = null, eventId = null } = {}) {
    const seq = ++openSeq;
    closing = false;
    sourceId = eventId || source?.dataset?.eventId || sourceId;

    backdrop.hidden = false;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    const dest = applyDest();

    const srcEl = source?.isConnected ? source : liveSource();
    const reduced = prefersReducedMotion() || !srcEl;
    const fill = sourceFill(srcEl || source);

    modal.style.transformOrigin = reduced ? 'center center' : 'top left';
    modal.classList.add('is-animating');

    if (reduced) {
      modal.style.transition = 'none';
      modal.style.opacity = '0';
      modal.style.transform = 'scale(0.97)';
      modal.style.backgroundColor = WHITE;
      if (panel) panel.style.opacity = '0';
      if (wash) wash.style.opacity = '0';
      void modal.offsetWidth;
      modal.style.transition = `transform ${FADE_MS}ms ${EASE}, opacity ${FADE_MS}ms ease`;
      if (panel) panel.style.transition = `opacity ${FADE_MS}ms ease`;
      modal.style.opacity = '1';
      modal.style.transform = 'scale(1)';
      if (panel) panel.style.opacity = '1';
      modal.classList.add('is-open');
      backdrop.classList.add('open');
      await wait(FADE_MS);
      if (seq !== openSeq || closing) return;
      modal.classList.remove('is-animating');
      return;
    }

    const src = srcEl.getBoundingClientRect();
    modal.style.transition = 'none';
    modal.style.opacity = '1';
    modal.style.backgroundColor = fill;
    modal.style.transform = invertTransform(src, dest);
    modal.style.borderRadius = '6px';
    modal.style.boxShadow = 'none';
    if (panel) {
      panel.style.transition = 'none';
      panel.style.opacity = '0';
    }
    if (wash) {
      wash.style.transition = 'none';
      wash.style.opacity = '1';
      wash.style.backgroundColor = fill;
    }
    setSourceHidden(true);
    void modal.offsetWidth;

    modal.style.transition = `transform ${OPEN_MS}ms ${EASE}, border-radius ${OPEN_MS}ms ${EASE}, box-shadow ${OPEN_MS}ms ${EASE}, background-color ${OPEN_MS}ms ${EASE}`;
    if (panel) panel.style.transition = `opacity 140ms ease ${Math.round(OPEN_MS * 0.42)}ms`;
    if (wash) {
      wash.style.transition = `background-color ${OPEN_MS}ms ${EASE}`;
      wash.style.backgroundColor = WHITE;
    }
    modal.style.transform = 'translate(0, 0) scale(1)';
    modal.style.borderRadius = '';
    modal.style.boxShadow = '';
    modal.style.backgroundColor = WHITE;
    if (panel) panel.style.opacity = '1';
    modal.classList.add('is-open');
    backdrop.classList.add('open');

    await wait(OPEN_MS);
    if (seq !== openSeq || closing) return;
    if (wash) wash.style.opacity = '0';
    modal.classList.remove('is-animating');
  }

  async function close({ immediate = false } = {}) {
    if (modal.hidden && !closing) return;
    const seq = ++openSeq;
    closing = true;
    backdrop.classList.remove('open');
    modal.classList.add('is-animating');
    modal.classList.remove('is-open');

    if (immediate || prefersReducedMotion()) {
      if (!immediate) {
        modal.style.transition = `transform ${FADE_MS}ms ${EASE}, opacity ${FADE_MS}ms ease`;
        modal.style.transformOrigin = 'center center';
        modal.style.opacity = '0';
        modal.style.transform = 'scale(0.97)';
        if (panel) panel.style.opacity = '0';
        await wait(FADE_MS);
      }
      if (seq !== openSeq) return;
      finishClose();
      return;
    }

    const dest = applyDest();
    const srcEl = liveSource();
    if (!srcEl) {
      modal.style.transition = `transform ${FADE_MS}ms ${EASE}, opacity ${FADE_MS}ms ease`;
      modal.style.opacity = '0';
      modal.style.transform = 'scale(0.97)';
      if (panel) panel.style.opacity = '0';
      await wait(FADE_MS);
      if (seq !== openSeq) return;
      finishClose();
      return;
    }

    const fill = sourceFill(srcEl);
    const src = srcEl.getBoundingClientRect();
    if (panel) {
      panel.style.transition = 'opacity 90ms ease';
      panel.style.opacity = '0';
    }
    if (wash) {
      wash.style.transition = 'none';
      wash.style.backgroundColor = WHITE;
      wash.style.opacity = '1';
      void wash.offsetWidth;
      wash.style.transition = `background-color ${OPEN_MS}ms ${EASE}`;
      wash.style.backgroundColor = fill;
    }
    modal.style.backgroundColor = WHITE;
    modal.style.transformOrigin = 'top left';
    modal.style.transition = `transform ${OPEN_MS}ms ${EASE}, border-radius ${OPEN_MS}ms ${EASE}, box-shadow ${OPEN_MS}ms ${EASE}, background-color ${OPEN_MS}ms ${EASE}`;
    modal.style.borderRadius = '6px';
    modal.style.boxShadow = 'none';
    modal.style.backgroundColor = fill;
    modal.style.transform = invertTransform(src, dest);
    await wait(OPEN_MS);
    if (seq !== openSeq) return;
    finishClose();
  }

  backdrop.addEventListener('click', () => onRequestClose?.());

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modal.hidden || closing) return;
    e.preventDefault();
    onRequestClose?.();
  });

  window.addEventListener('resize', () => {
    if (modal.hidden || closing) return;
    applyDest();
  });

  return {
    open,
    close,
    isOpen,
    rebindSource,
    setBody(html) {
      bodyEl.innerHTML = html;
    },
    setFooter(html) {
      footerEl.innerHTML = html || '';
      footerEl.hidden = !html;
    },
    bodyEl,
    footerEl,
    panelEl: panel
  };
}

export function findEventSourceEl(eventId) {
  const sel = sourceSelector(eventId);
  return sel ? document.querySelector(sel) : null;
}
