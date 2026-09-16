/**
 * Run: node purchasing/js/data/overlay-merge.test.js
 */
import assert from 'node:assert/strict';
import {
  mergeMap3Way,
  mergeOverlays,
  stampOverlayEdits,
  entryUpdatedAt,
} from './overlay-merge.js?v=96';
import {
  overlayKeepsLine,
  shouldIncludeOrderViewRow,
  isManualPlanLine,
} from './overlay-filter.js?v=96';

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`fail  ${name}`);
    console.error(err);
  }
}

test('two clients adding different manual lines both survive', () => {
  const acked = { lines: {}, manualLines: {} };
  const local = {
    lines: {},
    manualLines: {
      'line-a': { id: 'line-a', onPlan: true, itemName: 'A', updatedAt: '2026-09-10T10:00:00.000Z' },
    },
  };
  const remote = {
    lines: {},
    manualLines: {
      'line-b': { id: 'line-b', onPlan: true, itemName: 'B', updatedAt: '2026-09-10T10:00:01.000Z' },
    },
  };
  const merged = mergeOverlays(acked, local, remote);
  assert.ok(merged.manualLines['line-a'], 'keeps local add');
  assert.ok(merged.manualLines['line-b'], 'keeps remote add');
});

test('local delete removes line when remote unchanged', () => {
  const shared = {
    id: 'line-x',
    onPlan: true,
    itemName: 'X',
    updatedAt: '2026-09-10T09:00:00.000Z',
  };
  const acked = { manualLines: { 'line-x': shared }, lines: {} };
  const local = { manualLines: {}, lines: {} };
  const remote = { manualLines: { 'line-x': { ...shared } }, lines: {} };
  const merged = mergeOverlays(acked, local, remote);
  assert.equal(merged.manualLines['line-x'], undefined);
});

test('local delete does not drop remotely-edited line', () => {
  const acked = {
    manualLines: {
      'line-x': { id: 'line-x', onPlan: true, qty: 1, updatedAt: '2026-09-10T09:00:00.000Z' },
    },
    lines: {},
  };
  const local = { manualLines: {}, lines: {} };
  const remote = {
    manualLines: {
      'line-x': { id: 'line-x', onPlan: true, qty: 5, updatedAt: '2026-09-10T10:00:00.000Z' },
    },
    lines: {},
  };
  const merged = mergeOverlays(acked, local, remote);
  assert.equal(merged.manualLines['line-x'].qty, 5);
});

test('newer updatedAt wins on concurrent edit of same key', () => {
  const acked = {
    lines: {
      'matcha|podium': { onPlan: true, qty: 1, updatedAt: '2026-09-10T09:00:00.000Z' },
    },
  };
  const local = {
    lines: {
      'matcha|podium': { onPlan: true, qty: 2, updatedAt: '2026-09-10T10:00:00.000Z' },
    },
  };
  const remote = {
    lines: {
      'matcha|podium': { onPlan: true, qty: 9, updatedAt: '2026-09-10T10:00:01.000Z' },
    },
  };
  const merged = mergeMap3Way(acked.lines, local.lines, remote.lines);
  assert.equal(merged['matcha|podium'].qty, 9);
});

test('stampOverlayEdits bumps updatedAt only for changed entries', () => {
  const acked = {
    manualLines: {
      'line-1': { id: 'line-1', onPlan: true, qty: 1, updatedAt: '2026-09-10T09:00:00.000Z' },
    },
    lines: {},
    offPlanExpenses: [],
  };
  const local = {
    manualLines: {
      'line-1': { id: 'line-1', onPlan: true, qty: 1, updatedAt: '2026-09-10T09:00:00.000Z' },
      'line-2': { id: 'line-2', onPlan: true, qty: 3 },
    },
    lines: {},
    offPlanExpenses: [],
  };
  const stamped = stampOverlayEdits(local, acked, '2026-09-10T11:00:00.000Z');
  assert.equal(entryUpdatedAt(stamped.manualLines['line-1']), '2026-09-10T09:00:00.000Z');
  assert.equal(entryUpdatedAt(stamped.manualLines['line-2']), '2026-09-10T11:00:00.000Z');
});

test('stale cache shaped local must not wipe remote manuals when merged as boot would', () => {
  // Simulates: User A has empty/stale local extract; User B already saved manuals remotely.
  // Boot must NOT persist \u2014 but if a merge write happened, remote manuals must survive.
  const acked = { lines: {}, manualLines: {} }; // stale client's acked
  const local = { lines: {}, manualLines: {} }; // empty extract from cache stub
  const remote = {
    lines: {},
    manualLines: {
      'line-other': {
        id: 'line-other',
        onPlan: true,
        itemName: 'Other user add',
        updatedAt: '2026-09-10T10:00:00.000Z',
      },
    },
  };
  const merged = mergeOverlays(acked, local, remote);
  assert.ok(
    merged.manualLines['line-other'],
    'remote add survives empty local (boot must not replace)'
  );
});

test('catalog manual add should keep Order View row even when suggested is 0', () => {
  const manual = { onPlan: true, source: 'manual', itemId: 'cups', location: 'podium' };
  assert.equal(isManualPlanLine(manual), true);
  assert.equal(overlayKeepsLine(manual), true);
  // Feed row with suggested 0 would normally be excluded without overlay.lines \u2014
  // mapFeedToWeek now also checks manualLines; filter helper still works for lines overlay.
  assert.equal(
    shouldIncludeOrderViewRow({ suggested: 0, needsCount: false }, { onPlan: true }),
    true
  );
});

test('extract retention concept: unloaded branch lines stay when prior has them', () => {
  // Pure structural check mirroring extractOverlayFromWeek retention rule
  const priorLines = {
    'matcha|sm-north': { onPlan: true, qty: 10, updatedAt: '2026-09-10T09:00:00.000Z' },
    'cups|podium': { onPlan: true, qty: 5, updatedAt: '2026-09-10T09:00:00.000Z' },
  };
  const extractedLines = {
    'cups|podium': { onPlan: true, qty: 5, updatedAt: '2026-09-10T09:00:00.000Z' },
  };
  const loadedBranches = new Set(['podium']);
  const CORE = ['sm-north', 'podium', 'moa'];
  const out = { ...extractedLines };
  for (const [key, saved] of Object.entries(priorLines)) {
    if (out[key]) continue;
    const loc = key.split('|')[1];
    if (CORE.includes(loc) && !loadedBranches.has(loc) && overlayKeepsLine(saved)) {
      out[key] = saved;
    }
  }
  assert.ok(out['matcha|sm-north'], 'retains unloaded SM North line');
  assert.ok(out['cups|podium']);
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
