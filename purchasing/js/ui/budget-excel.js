/**
 * Download the open week's on-plan budget as one Excel file (all branches).
 * Cost / qty cells stay numeric — display units via Excel number formats.
 */
import { buildLocationGroups, itemDisplayName } from '../data/catalog.js?v=106';
import { lineAmount, plannedLines } from '../compute.js?v=106';
import { formatDateRange, statusLabel } from '../format.js?v=106';
import { isThisWeek, warmRemainingBranches } from '../store.js?v=106';
import { toast } from './shell.js?v=106';

const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';

/** Excel currency format — peso sign is display-only, value stays a number. */
const PESO_FMT = '"₱"#,##0.00';

function slugDate(iso) {
  return String(iso || '').replace(/-/g, '') || 'week';
}

/** Custom format like `#,##0 "pcs"` so qty stays numeric. */
function qtyNumberFormat(unit, value) {
  const u = String(unit || '').trim();
  const n = Number(value);
  const intish = Number.isFinite(n) && Math.round(n) === n;
  const num = intish ? '#,##0' : '#,##0.##';
  if (!u || /^budget$/i.test(u)) return num;
  const safe = u.replace(/"/g, '""');
  return `${num} "${safe}"`;
}

/**
 * @param {object} week
 */
export async function downloadWeekBudgetExcel(week) {
  if (!week) {
    toast('No week to download');
    return;
  }

  if (isThisWeek(week) && !week.archived) {
    try {
      await warmRemainingBranches();
    } catch (err) {
      console.warn('Could not warm branches before Excel export', err);
    }
  }

  const groups = buildLocationGroups(week);
  /** @type {{ branch: string, item: string, category: string, supplier: string, stock: number|'', need: number|'', order: number|'', cost: number, status: string, unit: string }[]} */
  const rows = [];
  for (const group of groups) {
    const onPlan = (group.lines || []).filter((l) => l.onPlan);
    for (const line of onPlan) {
      const fee = line.kind === 'deliveryFee' || line.kind === 'budget';
      rows.push({
        branch: group.label || group.key,
        item: itemDisplayName(line),
        category: line.category || '',
        supplier:
          !fee && line.supplierName && line.supplierName !== 'Unassigned'
            ? line.supplierName
            : '',
        stock: fee || line.stockQty == null ? '' : Number(line.stockQty),
        need: fee || line.needQty == null ? '' : Number(line.needQty),
        order: fee ? '' : Number(line.qty) || 0,
        cost: lineAmount(line),
        status: statusLabel(line.status, 'line'),
        unit: fee ? '' : line.unit || '',
      });
    }
  }

  if (!rows.length) {
    toast('Nothing on the budget to download');
    return;
  }

  const total = plannedLines(week).reduce((s, l) => s + lineAmount(l), 0);
  rows.push({
    branch: '',
    item: 'TOTAL',
    category: '',
    supplier: '',
    stock: '',
    need: '',
    order: '',
    cost: total,
    status: '',
    unit: '',
  });

  try {
    const mod = await import(XLSX_CDN);
    const XLSX = mod.default || mod;
    const encode = XLSX.utils.encode_cell;

    const headers = [
      'Branch',
      'Item',
      'Category',
      'Supplier',
      'Stock',
      'Need',
      'Order',
      'Cost',
      'Status',
    ];
    const sheet = {};
    const range = { s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } };

    headers.forEach((h, c) => {
      sheet[encode({ r: 0, c })] = { t: 's', v: h };
    });

    rows.forEach((row, i) => {
      const r = i + 1;
      sheet[encode({ r, c: 0 })] = { t: 's', v: row.branch };
      sheet[encode({ r, c: 1 })] = { t: 's', v: row.item };
      sheet[encode({ r, c: 2 })] = { t: 's', v: row.category };
      sheet[encode({ r, c: 3 })] = { t: 's', v: row.supplier };
      if (row.stock !== '') {
        sheet[encode({ r, c: 4 })] = {
          t: 'n',
          v: Number(row.stock),
          z: qtyNumberFormat(row.unit, row.stock),
        };
      }
      if (row.need !== '') {
        sheet[encode({ r, c: 5 })] = {
          t: 'n',
          v: Number(row.need),
          z: qtyNumberFormat(row.unit, row.need),
        };
      }
      if (row.order !== '') {
        sheet[encode({ r, c: 6 })] = {
          t: 'n',
          v: Number(row.order),
          z: qtyNumberFormat(row.unit, row.order),
        };
      }
      sheet[encode({ r, c: 7 })] = { t: 'n', v: Number(row.cost) || 0, z: PESO_FMT };
      sheet[encode({ r, c: 8 })] = { t: 's', v: row.status };
    });

    sheet['!ref'] = XLSX.utils.encode_range(range);
    sheet['!cols'] = [
      { wch: 14 },
      { wch: 32 },
      { wch: 22 },
      { wch: 24 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
    ];

    const workbook = XLSX.utils.book_new();
    const rangeLabel = formatDateRange(week.weekStart, week.weekEnd).replace(/\s+/g, ' ');
    const sheetName = (rangeLabel || 'Budget').slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    const filename = `budget-${slugDate(week.weekStart)}-${slugDate(week.weekEnd)}.xlsx`;
    // cellStyles: true helps some Excel builds keep number formats from `z`
    XLSX.writeFile(workbook, filename, { cellStyles: true });
  } catch (err) {
    console.warn('Excel export failed', err);
    toast('Could not download Excel');
  }
}
