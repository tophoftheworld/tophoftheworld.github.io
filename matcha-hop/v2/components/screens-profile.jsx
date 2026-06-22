// User profile overlay — Posts / Lists tabs

function EditProfileSheet({ theme, profile, onClose, onSaved }) {
  const [instagram, setInstagram] = React.useState(profile?.instagram || '');
  const [busy, setBusy] = React.useState(false);
  const fInput = {
    width: '100%',
    padding: '11px 13px',
    background: theme.surface2,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    outline: 'none',
    fontFamily: theme.sans,
    fontSize: 14,
    color: theme.text,
    boxSizing: 'border-box',
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await window.V2Live.updateProfile({ instagram: instagram.trim() });
      onSaved?.();
      onClose();
    } catch (e) {
      window.alert(e?.message || 'Could not update profile');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div style={{ width: '100%', borderRadius: '20px 20px 0 0', background: theme.card, border: `1px solid ${theme.border}`, padding: '20px 20px 36px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 17, fontWeight: 700, color: theme.text }}>Edit profile</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><IconClose size={20} stroke={theme.muted} /></button>
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>Instagram handle</div>
          <input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@username" style={fInput} />
        </div>
        <button type="button" disabled={busy} onClick={save} style={{ width: '100%', padding: '14px', borderRadius: 999, border: 'none', background: busy ? theme.border : theme.accent, color: busy ? theme.muted : '#fff', fontFamily: theme.sans, fontSize: 15, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function UserProfileScreen({ theme, onClose, onOpenPost, onOpenList, onNewList }) {
  const [activeTab, setActiveTab] = React.useState('posts');
  const [showEdit, setShowEdit] = React.useState(false);
  const [avatarUploading, setAvatarUploading] = React.useState(false);
  const [avatarError, setAvatarError] = React.useState('');
  const [, setTick] = React.useState(0);
  const avatarInputRef = React.useRef(null);

  React.useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener('v2:profile-updated', h);
    return () => window.removeEventListener('v2:profile-updated', h);
  }, []);

  const profile = window.V2Live?.getProfile?.() || {
    displayName: 'Member',
    handle: 'member',
    avatarInitial: '?',
  };
  const POSTS = Array.isArray(window.POSTS) ? window.POSTS : [];
  const myPosts = POSTS.filter((p) => p.isOwn);
  const memberLine = `${myPosts.length} post${myPosts.length !== 1 ? 's' : ''}`;

  const onAvatarPick = async (file) => {
    if (!file || !window.V2Live?.updateProfile || avatarUploading) return;
    setAvatarError('');
    setAvatarUploading(true);
    try {
      await window.V2Live.updateProfile({ avatarFile: file });
    } catch (e) {
      setAvatarError(e?.message || 'Could not update photo. Please try again.');
    } finally {
      setAvatarUploading(false);
    }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 80, background: theme.surface, display: 'flex', flexDirection: 'column', animation: 'slideUp 260ms cubic-bezier(.2,.8,.2,1)' }}>
      <div style={{ padding: 'max(12px, env(safe-area-inset-top, 0px)) 16px 12px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
            <IconBack size={20} stroke={theme.text} sw={2} />
          </button>
          <div style={{ flex: 1, fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text }}>Profile</div>
          <button type="button" aria-label="Edit profile" onClick={() => setShowEdit(true)} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
            <IconEdit size={18} stroke={theme.muted} sw={1.8} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 30 }}>
        <div style={{ padding: '20px 16px 18px', display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} disabled={avatarUploading} onChange={(e) => { onAvatarPick(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()} aria-label="Change profile photo" aria-busy={avatarUploading} style={{ background: 'none', border: 'none', padding: 0, cursor: avatarUploading ? 'wait' : 'pointer', position: 'relative', opacity: avatarUploading ? 0.75 : 1 }}>
              <ProfileAvatar profile={profile} size={72} theme={theme} style={{ border: `2.5px solid ${theme.accent}` }} />
              {avatarUploading ? (
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: '#fff' }}>…</span>
                </div>
              ) : null}
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: '50%', background: theme.accent, border: `2.5px solid ${theme.surface}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconCamera size={13} stroke="#fff" sw={2} />
              </div>
            </button>
            {avatarError ? (
              <div style={{ position: 'absolute', left: 0, top: '100%', marginTop: 6, width: 160, fontFamily: theme.sans, fontSize: 11, color: '#c0392b', lineHeight: 1.35 }}>{avatarError}</div>
            ) : null}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 20, fontWeight: 700, color: theme.text, letterSpacing: -0.3 }}>{profile.displayName}</div>
            <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, marginTop: 1 }}>@{profile.handle}</div>
            {profile.instagramUrl ? (
              <a href={profile.instagramUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, textDecoration: 'none' }}>
                <IconInstagram size={15} stroke={theme.muted} sw={1.7} />
                <span style={{ fontFamily: theme.sans, fontSize: 13, color: theme.accent, fontWeight: 600 }}>@{profile.instagram}</span>
              </a>
            ) : null}
            <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 4 }}>
              {memberLine}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}`, marginBottom: 14, paddingLeft: 16, paddingRight: 16 }}>
          {[['posts', 'Posts'], ['lists', 'Lists']].map(([id, lbl]) => (
            <button key={id} type="button" onClick={() => setActiveTab(id)} style={{ flex: 1, padding: '9px 0', background: 'none', border: 'none', cursor: 'pointer', fontFamily: theme.sans, fontSize: 14, fontWeight: activeTab === id ? 700 : 500, color: activeTab === id ? theme.text : theme.muted, borderBottom: `2px solid ${activeTab === id ? theme.accent : 'transparent'}`, marginBottom: -1 }}>
              {lbl}
            </button>
          ))}
        </div>

        <div style={{ padding: '0 16px' }}>
          {activeTab === 'posts' && (
            myPosts.length === 0
              ? <div style={{ textAlign: 'center', padding: '40px 0', fontFamily: theme.sans, fontSize: 14, color: theme.muted }}>No posts yet.</div>
              : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
                  {myPosts.map((p) => (
                    <button key={p.id} type="button" onClick={() => onOpenPost(p.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', aspectRatio: '1/1', overflow: 'hidden', position: 'relative', borderRadius: 2 }}>
                      {p.photos?.[0]
                        ? <img src={p.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
                        : <Placeholder label="" hue={window.brandHueForPost(p)} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                      {p.photoCount > 1 ? (
                        <div style={{ position: 'absolute', top: 5, right: 5 }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="1.5">
                            <rect x="2" y="7" width="13" height="13" rx="2" /><path d="M7 5V4a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-1" />
                          </svg>
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              )
          )}

          {activeTab === 'lists' ? <ListsSection theme={theme} onOpenList={onOpenList} ownOnly onNewList={onNewList} /> : null}
        </div>
      </div>

      {showEdit ? (
        <EditProfileSheet
          theme={theme}
          profile={profile}
          onClose={() => setShowEdit(false)}
          onSaved={() => setTick((t) => t + 1)}
        />
      ) : null}
    </div>
  );
}

window.UserProfileScreen = UserProfileScreen;
