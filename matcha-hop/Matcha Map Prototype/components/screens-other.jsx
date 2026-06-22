// Mine (stats) and Post Detail helper components

function MineScreen({ theme, onOpenPost }) {
  const stats = [
    { value: '27', label: 'Drinks' },
    { value: '12', label: 'Cafés' },
    { value: '4.3', label: 'Avg rating' },
    { value: '₱6.2k', label: 'Spent' },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      <div style={{ padding: '56px 16px 14px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, fontWeight: 600, marginBottom: 4 }}>MEMBER SINCE JAN 2026</div>
        <div style={{ fontFamily: theme.sans, fontSize: 26, fontWeight: 800, color: theme.text, letterSpacing: -0.5 }}>Your matcha year</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 100px' }}>
        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 24 }}>
          {stats.map(s => (
            <div key={s.label} style={{
              padding: '18px 16px',
              border: `1px solid ${theme.border}`, borderRadius: 16, background: theme.card,
            }}>
              <div style={{ fontFamily: theme.sans, fontSize: 34, fontWeight: 800, color: theme.text, letterSpacing: -1, lineHeight: 1 }}>{s.value}</div>
              <div style={{ marginTop: 6, fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Favorite brand */}
        <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 10 }}>Most visited</div>
        <div style={{
          padding: 14, background: theme.card,
          border: `1px solid ${theme.border}`, borderRadius: 14,
          display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24,
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12, overflow: 'hidden', flexShrink: 0,
            background: theme.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontFamily: theme.sans, fontSize: 22, fontWeight: 800, color: theme.accent }}>M</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 700, color: theme.text, letterSpacing: -0.3 }}>Matchanese</div>
            <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 2, fontWeight: 500 }}>6 visits · avg ★ 4.5</div>
          </div>
          <IconChevron size={16} stroke={theme.muted} />
        </div>

        {/* Recent posts grid */}
        <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 10 }}>Recent logs</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
          {POSTS.map(p => {
            const b = BRANDS.find(x => x.id === p.brandId) || BRANDS[0];
            return (
              <button key={p.id} onClick={() => onOpenPost(p.id)} style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                aspectRatio: '1/1', overflow: 'hidden', position: 'relative',
              }}>
                <Placeholder label="" hue={b.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '12px 6px 4px',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.4), transparent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                }}>
                  {p.photoCount > 1 && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1.5">
                      <rect x="2" y="7" width="13" height="13" rx="2"/><path d="M7 5V4a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-1"/>
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

window.MineScreen = MineScreen;
