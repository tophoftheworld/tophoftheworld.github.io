// User profile screen — accessed via header avatar button

function UserProfileScreen({ theme, onClose, onOpenPost, onOpenList }) {
  const [activeTab, setActiveTab] = React.useState('posts');

  const myPosts = POSTS.filter(p => p.isOwn || p.authorHandle === 'chloe');

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 80, background: theme.surface, display: 'flex', flexDirection: 'column', animation: 'slideUp 260ms cubic-bezier(.2,.8,.2,1)' }}>
      {/* Header */}
      <div style={{ padding: 'max(12px, env(safe-area-inset-top, 0px)) 16px 12px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
            <IconBack size={20} stroke={theme.text} sw={2} />
          </button>
          <div style={{ flex: 1, fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text }}>Profile</div>
          <button type="button" style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
            <IconMore size={20} stroke={theme.muted} sw={1.8} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 30 }}>
        {/* Avatar + bio */}
        <div style={{ padding: '20px 16px 18px', display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: theme.accentLight, border: `2.5px solid ${theme.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontFamily: theme.sans, fontSize: 28, fontWeight: 800, color: theme.accent }}>C</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 20, fontWeight: 700, color: theme.text, letterSpacing: -0.3 }}>Chloe R.</div>
            <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, marginTop: 1 }}>@chloe</div>
            <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 4 }}>
              {myPosts.length} post{myPosts.length !== 1 ? 's' : ''} · member since Jan 2026
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}`, marginBottom: 14, paddingLeft: 16, paddingRight: 16 }}>
          {[['posts','Posts'],['lists','Lists']].map(([id, lbl]) => (
            <button key={id} type="button" onClick={() => setActiveTab(id)} style={{ flex: 1, padding: '9px 0', background: 'none', border: 'none', cursor: 'pointer', fontFamily: theme.sans, fontSize: 14, fontWeight: activeTab === id ? 700 : 500, color: activeTab === id ? theme.text : theme.muted, borderBottom: `2px solid ${activeTab === id ? theme.accent : 'transparent'}`, marginBottom: -1 }}>
              {lbl}
            </button>
          ))}
        </div>

        <div style={{ padding: '0 16px' }}>
          {activeTab === 'posts' && (
            myPosts.length === 0
              ? <div style={{ textAlign: 'center', padding: '40px 0', fontFamily: theme.sans, fontSize: 14, color: theme.muted }}>No posts yet.</div>
              : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
                  {myPosts.map(p => (
                    <button key={p.id} type="button" onClick={() => onOpenPost(p.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', aspectRatio: '1/1', overflow: 'hidden', position: 'relative', borderRadius: 2 }}>
                      {p.photos?.[0]
                        ? <img src={p.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
                        : <Placeholder label="" hue={brandHueForPost(p)} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                      }
                      {p.photoCount > 1 && (
                        <div style={{ position: 'absolute', top: 5, right: 5 }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1.5">
                            <rect x="2" y="7" width="13" height="13" rx="2"/><path d="M7 5V4a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-1"/>
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
          )}

          {activeTab === 'lists' && (
            <ListsSection theme={theme} onOpenList={onOpenList} ownOnly={true} />
          )}
        </div>
      </div>
    </div>
  );
}

window.UserProfileScreen = UserProfileScreen;
