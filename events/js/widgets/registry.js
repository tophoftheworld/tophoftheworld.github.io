/** Lightweight event-dashboard widget registry. */

const widgets = new Map();

/**
 * @param {{
 *   id: string,
 *   title: string,
 *   applies?: (event: object) => boolean,
 *   render: (event: object, ctx?: object) => string | Promise<string>,
 *   mount?: (root: HTMLElement, event: object, ctx?: object) => void | Promise<void>,
 *   unmount?: (root: HTMLElement) => void
 * }} widget
 */
export function registerWidget(widget) {
  if (!widget?.id) throw new Error('Widget requires id');
  widgets.set(widget.id, widget);
}

export function getWidget(id) {
  return widgets.get(id) || null;
}

export function listWidgets() {
  return [...widgets.values()];
}

/** Same type filter as the previous DASH_WIDGETS list. */
export function widgetApplies(widget, event) {
  if (typeof widget.applies === 'function') {
    try {
      return !!widget.applies(event);
    } catch (err) {
      console.warn(`[widget:${widget.id}] applies() failed`, err);
      return false;
    }
  }
  const typeId = event?.typeId;
  const isPopup = typeId === 'matcha_popup';
  const isWorkshop = typeId === 'matcha_workshop' || typeId === 'mochi_workshop';
  const isBar = typeId === 'mobile_bar';
  const id = widget.id;
  if (id === 'menu' || id === 'sales') return isPopup;
  if (id === 'purchasing') return isPopup || isWorkshop;
  if (id === 'workshops') return isWorkshop;
  if (id === 'schedule' || id === 'expenses' || id === 'invoice' || id === 'inbox') {
    return isPopup || isWorkshop || isBar || !typeId;
  }
  return true;
}

export function widgetsForEvent(event) {
  return listWidgets().filter((w) => widgetApplies(w, event));
}

/**
 * Fill async widget bodies after the dashboard HTML is in the DOM.
 * Sync render() already painted a shell; async ones replace .event-widget__body.
 */
export async function hydrateWidgets(container, event, ctx = {}) {
  if (!container) return;
  const cards = [...container.querySelectorAll('.event-widget[data-widget]')];
  for (const card of cards) {
    const id = card.getAttribute('data-widget');
    const widget = getWidget(id);
    if (!widget) continue;
    const body = card.querySelector('.event-widget__body');
    if (!body) continue;
    try {
      const html = await Promise.resolve(widget.render(event, ctx));
      if (typeof html === 'string') body.innerHTML = html;
      if (typeof widget.mount === 'function') {
        await widget.mount(body, event, ctx);
      }
    } catch (err) {
      console.warn(`[widget:${id}] hydrate failed`, err);
      body.innerHTML = `<p class="event-widget__empty-state">Couldn’t load this widget.</p>`;
    }
  }
}

export function unmountWidgets(container) {
  if (!container) return;
  const cards = [...container.querySelectorAll('.event-widget[data-widget]')];
  for (const card of cards) {
    const id = card.getAttribute('data-widget');
    const widget = getWidget(id);
    const body = card.querySelector('.event-widget__body');
    if (!widget || !body) continue;
    try {
      widget.unmount?.(body);
    } catch (err) {
      console.warn(`[widget:${id}] unmount failed`, err);
    }
  }
}
