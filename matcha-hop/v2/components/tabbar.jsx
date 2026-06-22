// Tab bar — clean minimal hairline. Plus Jakarta Sans, no mono.

/** Primary tab chrome (Home reference): same safe-area + bottom padding on every tab. */
window.APP_HEADER_SAFE_TOP = 'max(8px, env(safe-area-inset-top, 0px))';
window.APP_BRAND_HEADER_PADDING_BOTTOM = 10;

function AppBrandHeader({ theme, rightAction = null }) {
  return (
    <div style={{
      paddingLeft: 16,
      paddingRight: 16,
      paddingBottom: window.APP_BRAND_HEADER_PADDING_BOTTOM,
      paddingTop: window.APP_HEADER_SAFE_TOP,
      borderBottom: `1px solid ${theme.border}`,
      background: theme.surface,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 20, fontWeight: 600, color: theme.text, letterSpacing: -0.3 }}>
          cha<span style={{ color: theme.accent }}>kaiki</span>
        </div>
        <div style={{ minWidth: 28, display: 'flex', justifyContent: 'flex-end' }}>
          {rightAction}
        </div>
      </div>
    </div>
  );
}

window.AppBrandHeader = AppBrandHeader;

function TabBar({ current, onChange, theme, onPlus }) {
  const tabs = [
    { id: 'feed', label: 'Home', Icon: IconHome },
    { id: 'map', label: 'Map', Icon: IconMap },
    { id: '_fab', label: '', Icon: null },
    { id: 'brands', label: 'Brands', Icon: IconGrid },
    { id: 'events', label: 'Events', Icon: IconCalendar },
  ];

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 40,
      background: theme.surface,
      borderTop: `1px solid ${theme.border}`,
      paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))', paddingTop: 8,
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
        alignItems: 'center',
      }}>
        {tabs.map(t => {
          if (t.id === '_fab') {
            return (
              <div key="fab" style={{ display: 'flex', justifyContent: 'center' }}>
                <button onClick={onPlus} aria-label="Log matcha" style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: theme.text, color: theme.surface,
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" stroke={theme.surface} strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </button>
              </div>
            );
          }
          const active = current === t.id;
          return (
            <button key={t.id} onClick={() => onChange(t.id)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            }}>
              <t.Icon size={22} stroke={active ? theme.accent : theme.muted} sw={active ? 2 : 1.6} />
              <span style={{
                fontFamily: theme.sans, fontSize: 10, fontWeight: active ? 700 : 500,
                color: active ? theme.text : 'transparent',
                letterSpacing: 0,
              }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

window.TabBar = TabBar;
