/** Bank brand themes for recognizable account cards */
const THEMES = {
    BDO: {
        key: 'bdo',
        label: 'BDO',
        gradient: 'linear-gradient(135deg, #0033A0 0%, #0057B8 55%, #1a6fd4 100%)',
        accent: '#FFD100',
        text: '#ffffff'
    },
    BPI: {
        key: 'bpi',
        label: 'BPI',
        gradient: 'linear-gradient(135deg, #8B0000 0%, #C8102E 50%, #E31C23 100%)',
        accent: '#F5C518',
        text: '#ffffff'
    },
    GCash: {
        key: 'gcash',
        label: 'GCash',
        gradient: 'linear-gradient(135deg, #0057E7 0%, #007CFF 45%, #00A3FF 100%)',
        accent: '#7DFFB3',
        text: '#ffffff'
    },
    PayPal: {
        key: 'paypal',
        label: 'PayPal',
        gradient: 'linear-gradient(135deg, #001C64 0%, #003087 50%, #009CDE 100%)',
        accent: '#0070BA',
        text: '#ffffff'
    },
    Unionbank: {
        key: 'unionbank',
        label: 'UnionBank',
        gradient: 'linear-gradient(135deg, #D35400 0%, #FF6600 55%, #FF8533 100%)',
        accent: '#FFE0C2',
        text: '#ffffff'
    },
    Wise: {
        key: 'wise',
        label: 'Wise',
        gradient: 'linear-gradient(135deg, #163300 0%, #2D5016 45%, #9FE870 100%)',
        accent: '#9FE870',
        text: '#ffffff'
    }
};

const FALLBACK = {
    key: 'default',
    label: 'Bank',
    gradient: 'linear-gradient(135deg, #374151 0%, #4B5563 50%, #6B7280 100%)',
    accent: '#D1D5DB',
    text: '#ffffff'
};

export function bankTheme(institution) {
    if (!institution) return FALLBACK;
    const key = String(institution).trim();
    if (THEMES[key]) return THEMES[key];
    const lower = key.toLowerCase();
    for (const [name, theme] of Object.entries(THEMES)) {
        if (lower.includes(name.toLowerCase())) return theme;
    }
    return { ...FALLBACK, label: key };
}

export function bankThemeClass(institution) {
    return `bank-${bankTheme(institution).key}`;
}
