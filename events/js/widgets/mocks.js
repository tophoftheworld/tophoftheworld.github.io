/** Placeholder adapters for non-Schedule widgets (wave 1). */

import { displayTitle } from '../../../shared/js/ops-events.js?v=46';
import { escapeHtml } from '../types.js?v=46';
import { registerWidget } from './registry.js?v=46';

function expensesAllocationLabel(typeId) {
  if (typeId === 'matcha_popup') return 'Popup';
  if (typeId === 'mobile_bar') return 'Bar Service';
  if (typeId === 'matcha_workshop' || typeId === 'mochi_workshop') return 'Workshop';
  return 'Popup';
}

function openLink(href, label = 'Open') {
  if (!href) return '';
  return `<p class="event-widget__more"><a class="event-widget__open" href="${href}" target="_blank" rel="noopener">${escapeHtml(label)}</a></p>`;
}

function hubApp(app) {
  return `../admin.html?app=${encodeURIComponent(app)}`;
}

registerWidget({
  id: 'menu',
  title: 'Menu',
  render() {
    return `
      <div class="event-widget__stat-row">
        <span class="event-widget__sub">Custom Menu · 6 categories</span>
      </div>
      <ul class="event-widget__menu">
        <li><span>Halaya Latte</span><span>₱200</span></li>
        <li><span>Ceremonial Matcha</span><span>₱220</span></li>
        <li><span>Seasalt Cream Cookie</span><span>₱90</span></li>
      </ul>
      <p class="event-widget__more">+14 more · from Pop-ups manage event</p>
      ${openLink(hubApp('Pop-ups'), 'Open Pop-ups')}`;
  }
});

registerWidget({
  id: 'sales',
  title: 'Sales',
  render() {
    return `
      <div class="event-widget__metric-label">Total Sales</div>
      <div class="event-widget__money-lg">₱24,850</div>
      <div class="event-widget__metrics">
        <div><span class="event-widget__metric-label">Cups Sold</span><span class="event-widget__metric-value">186</span></div>
        <div><span class="event-widget__metric-label">Orders</span><span class="event-widget__metric-value">94</span></div>
        <div><span class="event-widget__metric-label">Est. Profit</span><span class="event-widget__metric-value">₱9.1k</span></div>
      </div>
      <p class="event-widget__tenders">Cash ₱11.2k · GCash ₱9.4k · Card ₱4.3k</p>
      <p class="event-widget__more">EOD · Variance +₱120</p>
      ${openLink(hubApp('Pop-ups'), 'Open POS')}`;
  }
});

registerWidget({
  id: 'expenses',
  title: 'Expenses',
  render(event) {
    const allocation = expensesAllocationLabel(event?.typeId);
    return `
      <div class="event-widget__stat-row">
        <strong class="event-widget__money">₱8,420</strong>
        <span class="linked-badge on">${escapeHtml(allocation)}</span>
      </div>
      <ul class="event-widget__list">
        <li><span class="event-widget__list-main"><span class="event-widget__name">SM Hypermarket</span><span class="event-widget__meta">Supplier</span></span><span>₱2,180</span></li>
        <li><span class="event-widget__list-main"><span class="event-widget__name">Lazada</span><span class="event-widget__meta">Supplier</span></span><span>₱960</span></li>
        <li><span class="event-widget__list-main"><span class="event-widget__name">Petty cash</span><span class="event-widget__meta">Pop-up Cash</span></span><span>₱450</span></li>
      </ul>
      <p class="event-widget__more">Allocation · ${escapeHtml(allocation)}</p>
      ${openLink(hubApp('Expenses'), 'Open Expenses')}`;
  }
});

registerWidget({
  id: 'invoice',
  title: 'Invoice',
  render(event) {
    const invoiceId = event?.links?.invoiceId || '';
    const open = invoiceId
      ? openLink(`../invoice-generator/invoices.html?id=${encodeURIComponent(invoiceId)}`, 'Open invoice')
      : openLink('../invoice-generator/invoices.html', 'Open Invoices');
    return `
      <div class="event-widget__stat-row">
        <code class="event-widget__code">INV-2026-1042</code>
        <span class="event-widget__status is-partial">Partial</span>
      </div>
      <div class="event-widget__money-stack">
        <div><span class="event-widget__metric-label">Total</span><span class="event-widget__metric-value">Php 45,000</span></div>
        <div><span class="event-widget__metric-label">Remaining</span><span class="event-widget__metric-value is-due">Php 30,000</span></div>
      </div>
      <p class="event-widget__more">Date Reservation · Payment confirmed</p>
      ${open}`;
  }
});

registerWidget({
  id: 'inbox',
  title: 'Inbox',
  render() {
    return `
      <div class="event-widget__stat-row">
        <span class="lead-pip lead-pipeline-quoted">Quoted</span>
        <span class="event-widget__meta">2h ago</span>
      </div>
      <p class="event-widget__name event-widget__name--lg">Lanson Events</p>
      <p class="event-widget__subline">Private Matcha Workshop · 16 pax · ₱45,000</p>
      <p class="event-widget__preview">Can we confirm the Saturday setup time and send the deposit slip?</p>
      ${openLink(hubApp('Inbox'), 'Open Inbox')}`;
  }
});

registerWidget({
  id: 'purchasing',
  title: 'Purchasing',
  render(event) {
    return `
      <div class="event-widget__stat-row">
        <span class="event-widget__sub">Week of Sep 22–28</span>
        <span class="linked-badge on">Ordering</span>
      </div>
      <p class="event-widget__name event-widget__name--lg">${escapeHtml(displayTitle(event) || 'Event location')}</p>
      <div class="event-widget__metrics">
        <div><span class="event-widget__metric-label">Plan</span><span class="event-widget__metric-value">₱12.4k</span></div>
        <div><span class="event-widget__metric-label">Lines</span><span class="event-widget__metric-value">18</span></div>
        <div><span class="event-widget__metric-label">Status</span><span class="event-widget__metric-value">Open</span></div>
      </div>
      <p class="event-widget__more">Budget · Order · Reconcile</p>
      ${openLink(hubApp('Purchasing'), 'Open Purchasing')}`;
  }
});

registerWidget({
  id: 'workshops',
  title: 'Workshops',
  render() {
    return `
      <div class="event-widget__stat-row">
        <span class="event-widget__sub">Session roster</span>
        <span class="linked-badge on">4 left</span>
      </div>
      <p class="event-widget__seats"><strong>12</strong><span>/16 booked</span></p>
      <ul class="event-widget__people event-widget__people--compact">
        <li><span class="event-widget__name">Priya</span></li>
        <li><span class="event-widget__name">Marco</span></li>
        <li><span class="event-widget__name">Elle</span></li>
      </ul>
      <p class="event-widget__more">+9 participants · open</p>
      ${openLink(hubApp('Workshops'), 'Open Workshops')}`;
  }
});
