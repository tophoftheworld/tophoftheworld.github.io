// Line icons — 1.6 stroke, no fill. Matches editorial/mono aesthetic.

const Icon = ({ d, size = 20, stroke = 'currentColor', sw = 1.6, fill = 'none', children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {d ? <path d={d} /> : children}
  </svg>
);

const IconMap = (p) => <Icon {...p}><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.5 8 12 8 12s8-6.5 8-12a8 8 0 0 0-8-8z"/></Icon>;
const IconGrid = (p) => <Icon {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Icon>;
const IconHeart = (p) => <Icon {...p} d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6C19 16.5 12 21 12 21z"/>;
const IconSearch = (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></Icon>;
const IconClose = (p) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18"/></Icon>;
const IconChevron = (p) => <Icon {...p} d="M9 6l6 6-6 6"/>;
const IconBack = (p) => <Icon {...p} d="M15 6l-6 6 6 6"/>;
const IconLocate = (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></Icon>;
const IconStar = ({ size = 16, filled = false, stroke = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? stroke : 'none'} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round">
    <path d="M12 2.5l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.7l-6.1 3.4 1.4-6.8L2.2 9.6l6.9-.8z"/>
  </svg>
);
const IconCamera = (p) => <Icon {...p}><path d="M3 8a2 2 0 0 1 2-2h3l1.5-2h5L16 6h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></Icon>;
const IconHome = (p) => <Icon {...p}><path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/></Icon>;
const IconPin = (p) => <Icon {...p}><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="2.5"/></Icon>;
const IconCheck = (p) => <Icon {...p}><path d="M4 12l5 5 11-12"/></Icon>;
const IconMore = (p) => <Icon {...p}><circle cx="12" cy="6" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18" r="1.6"/></Icon>;

const IconCalendar = (p) => <Icon {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></Icon>;
const IconBookmark = (p) => <Icon {...p} d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>;
const IconPlus = (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>;
const IconEdit = (p) => <Icon {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></Icon>;
const IconInstagram = (p) => (
  <Icon {...p}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
  </Icon>
);
const IconTrash = (p) => (
  <Icon {...p}>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M7 7l1 12a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9L17 7" />
  </Icon>
);
const IconShare = (p) => (
  <Icon {...p}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22 11 13 2 9 22 2" />
  </Icon>
);
const IconDownload = (p) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Icon>
);

function ProfileAvatar({ profile, size = 32, theme, style = {}, border = true }) {
  const prof = profile || {};
  const sz = size;
  const base = {
    width: sz,
    height: sz,
    borderRadius: '50%',
    flexShrink: 0,
    overflow: 'hidden',
    ...style,
  };
  if (prof.avatarUrl) {
    return <img src={prof.avatarUrl} alt="" style={{ ...base, objectFit: 'cover', display: 'block' }} />;
  }
  return (
    <div style={{
      ...base,
      background: theme.accentLight,
      border: border ? `1.5px solid ${theme.accent}` : 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <span style={{ fontFamily: theme.sans, fontSize: Math.round(sz * 0.4), fontWeight: 700, color: theme.accent }}>
        {prof.avatarInitial || '?'}
      </span>
    </div>
  );
}

Object.assign(window, {
  IconMap, IconGrid, IconHeart, IconSearch, IconClose,
  IconChevron, IconBack, IconLocate, IconStar, IconCamera, IconHome,
  IconPin, IconCheck, IconMore,
  IconCalendar, IconBookmark, IconPlus, IconEdit, IconInstagram, IconTrash,
  IconShare, IconDownload,
  ProfileAvatar,
});
