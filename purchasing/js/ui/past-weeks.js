import { pastWeeks } from '../store.js?v=96';
import { weekTotal } from '../compute.js?v=96';
import { formatDateRange, formatPeso, escapeHtml, statusLabel } from '../format.js?v=96';
import { weekHref } from './week-chrome.js?v=96';

export function renderPastWeeks(root) {
  const weeks = pastWeeks();

  root.innerHTML = `
    <header class="week-head">
      <div class="week-head-row">
        <div>
          <a class="back-link" href="#/">→ This week</a>
          <h1>Past weeks</h1>
        </div>
      </div>
    </header>
    <div class="table-wrap">
      <table class="plan-table">
        <thead>
          <tr>
            <th>Week</th>
            <th>Total</th>
            <th>Spent</th>
            <th>Difference</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${
            weeks.length
              ? weeks
                  .map((w) => {
                    const total = weekTotal(w);
                    const spent = Number(w.spent) || 0;
                    const diff = spent - total;
                    return `<tr class="click-row" data-week="${w.id}">
                      <td>${formatDateRange(w.weekStart, w.weekEnd)}</td>
                      <td>${formatPeso(total)}</td>
                      <td>${formatPeso(spent)}</td>
                      <td class="${diff > 0 ? 'delta-up' : diff < 0 ? 'delta-down' : ''}">${diff > 0 ? '+' : ''}${formatPeso(diff)}</td>
                      <td>${escapeHtml(statusLabel(w.status))}</td>
                    </tr>`;
                  })
                  .join('')
              : '<tr><td colspan="5">No past weeks yet.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;

  root.querySelectorAll('[data-week]').forEach((tr) => {
    tr.addEventListener('click', () => {
      location.hash = weekHref(tr.dataset.week, 'plan');
    });
  });
}
