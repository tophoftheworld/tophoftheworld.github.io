/**
 * Discord channel → expense defaults (allocation / branch).
 * V1: only General is wired via DISCORD_EXPENSE_CHANNEL_GENERAL.
 */

const STORE_BRANCHES = ['SM North', 'Podium', 'Mall of Asia'];

/**
 * @typedef {{ allocation: string, branch: string|null, label: string }} ChannelDefaults
 */

/** @type {Record<string, ChannelDefaults>} */
const CHANNEL_PRESETS = {
  general: {
    allocation: 'General',
    branch: null,
    label: 'General'
  },
  'sm-north': {
    allocation: 'Store',
    branch: 'SM North',
    label: 'SM North'
  },
  podium: {
    allocation: 'Store',
    branch: 'Podium',
    label: 'Podium'
  },
  moa: {
    allocation: 'Store',
    branch: 'Mall of Asia',
    label: 'Mall of Asia'
  },
  events: {
    allocation: 'Popup',
    branch: null,
    label: 'Events'
  }
};

/**
 * Build allowlist from env. V1 only requires DISCORD_EXPENSE_CHANNEL_GENERAL.
 * Later: DISCORD_EXPENSE_CHANNEL_SM_NORTH, _PODIUM, _MOA, _EVENTS.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Map<string, ChannelDefaults>}
 */
function buildChannelDefaultsMap(env = process.env) {
  /** @type {Map<string, ChannelDefaults>} */
  const map = new Map();

  const pairs = [
    ['DISCORD_EXPENSE_CHANNEL_GENERAL', 'general'],
    ['DISCORD_EXPENSE_CHANNEL_SM_NORTH', 'sm-north'],
    ['DISCORD_EXPENSE_CHANNEL_PODIUM', 'podium'],
    ['DISCORD_EXPENSE_CHANNEL_MOA', 'moa'],
    ['DISCORD_EXPENSE_CHANNEL_EVENTS', 'events']
  ];

  for (const [envKey, presetKey] of pairs) {
    const channelId = String(env[envKey] || '').trim();
    if (!channelId) continue;
    const preset = CHANNEL_PRESETS[presetKey];
    if (!preset) continue;
    map.set(channelId, { ...preset });
  }

  return map;
}

/**
 * @param {string} channelId
 * @param {Map<string, ChannelDefaults>} [map]
 * @returns {ChannelDefaults|null}
 */
function resolveChannelDefaults(channelId, map = buildChannelDefaultsMap()) {
  const id = String(channelId || '').trim();
  if (!id) return null;
  return map.get(id) || null;
}

/**
 * Paid-by default for an allocation (mirrors expenses shared.allocationUsesPaidBy).
 * @param {string} allocation
 */
function defaultPaidBy(allocation) {
  return allocation === 'Store' || allocation === 'Popup' ? 'Store Cash' : 'Company';
}

module.exports = {
  STORE_BRANCHES,
  CHANNEL_PRESETS,
  buildChannelDefaultsMap,
  resolveChannelDefaults,
  defaultPaidBy
};
