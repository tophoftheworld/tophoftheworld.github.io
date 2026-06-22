// Lists — user lists with tried/not-tried checklist markers

function ListDetailScreen({ theme, listId, onBack, onOpenBrand, onOpenPost }) {
  const list = USER_LISTS.find(l => l.id === listId) || USER_LISTS[0];
  const brands = list.type === 'brands'
    ? (list.items || []).map(id => BRANDS.find(b => b.id === id)).filter(Boolean)
    : [];
  const posts = list.type === 'drinks'
    ? (list.items || []).map(id => POSTS.find(p => p.id === id)).filter(Boolean)
    : [];
  const items = list.type === 'brands' ? brands : posts;
  const triedCount = list.type === 'brands'
    ? brands.filter(b => userTriedBrand(b.id)).length
    : posts.length; // all logged posts are "tried"

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      <div style={{ padding: 'max(12px, env(safe-area-inset-top, 0px)) 16px 12px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
            <IconBack size={20} stroke={theme.text} sw={2} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 19, fontWeight: 700, color: theme.text, letterSpacing: -0.3 }}>{list.name}</div>
            <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 1 }}>
              by @{list.authorHandle} · {items.length} {list.type === 'brands' ? 'brands' : 'drinks'}
            </div>
          </div>
          {list.isOwn && (
            <button type="button" style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
              <IconEdit size={18} stroke={theme.muted} sw={1.8} />
            </button>
          )}
        </div>
        {list.description && (
          <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, marginTop: 6, paddingLeft: 46, lineHeight: 1.45 }}>{list.description}</div>
        )}


      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 90px' }}>
        {list.type === 'brands' ? (
          brands.map((b, i) => {
            const tried = userTriedBrand(b.id);
            const branchPosts = POSTS.filter(p => p.brandId === b.id).length;
            const photo = b.branches?.[0]?.photoUrl;
            const branch = b.branches?.[0];
            return (
              <button key={b.id} type="button" onClick={() => onOpenBrand(b.id)} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: `1px solid ${theme.border}`, borderRadius: 14, padding: '11px 13px', background: theme.card, marginBottom: 8, cursor: 'pointer' }}>
                {/* Rank */}
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: i < 3 ? theme.accentLight : theme.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: i < 3 ? theme.accent : theme.muted }}>{i + 1}</span>
                </div>
                <div style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: theme.surface2 }}>
                  {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={b.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: theme.sans, fontSize: 15, fontWeight: 600, color: theme.accent }}>{b.name}</div>
                  <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 2 }}>{branch?.address || b.area}</div>
                </div>
                {tried && (
                  <div style={{ position: 'absolute', top: 9, right: 11, width: 18, height: 18, borderRadius: '50%', background: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5 11-12"/></svg>
                  </div>
                )}
              </button>
            );
          })
        ) : (
          posts.map((post, i) => {
            const drink = post.drinks?.[0];
            return (
              <button key={post.id} type="button" onClick={() => onOpenPost(post.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: `1px solid ${theme.border}`, borderRadius: 14, padding: '11px 13px', background: theme.card, marginBottom: 8, cursor: 'pointer' }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: i < 3 ? theme.accentLight : theme.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: i < 3 ? theme.accent : theme.muted }}>{i + 1}</span>
                </div>
                <div style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: theme.surface2 }}>
                  {post.photos?.[0] ? <img src={post.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={brandHueForPost(post)} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: theme.sans, fontSize: 15, fontWeight: 600, color: theme.text }}>{drink?.name || 'Drink'}</div>
                  <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.accent, marginTop: 1 }}>{post.brand}</div>
                  {drink?.price && <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 1 }}>{formatPhpPrice(drink.price)}</div>}
                </div>
              </button>
            );
          })
        )}
        {items.length === 0 && <div style={{ textAlign: 'center', padding: '60px 20px', fontFamily: theme.sans, fontSize: 14, color: theme.muted }}>This list is empty.</div>}
      </div>
    </div>
  );
}

// ── Create List Modal ──────────────────────────────────────────────────
function CreateListModal({ theme, onClose, onCreate }) {
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('brands');
  const [description, setDescription] = React.useState('');
  const fInput = { width: '100%', padding: '11px 13px', background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 10, outline: 'none', fontFamily: theme.sans, fontSize: 14, color: theme.text, boxSizing: 'border-box' };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div style={{ width: '100%', borderRadius: '20px 20px 0 0', background: theme.card, border: `1px solid ${theme.border}`, padding: '20px 20px 36px' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 17, fontWeight: 700, color: theme.text }}>New list</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><IconClose size={20} stroke={theme.muted} /></button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>List name</div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Best Matcha in Makati" style={fInput} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>Type</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              ['brands', 'Brands / Locations', 'Cafes, pop-ups, and spots to try'],
              ['drinks',  'Drinks',             'Specific drinks you\'ve logged'],
            ].map(([id, lbl, desc]) => (
              <button key={id} type="button" onClick={() => setType(id)} style={{ padding: '10px 12px', borderRadius: 12, textAlign: 'left', border: `1.5px solid ${type === id ? theme.accent : theme.border}`, background: type === id ? theme.accentLight : theme.surface2, cursor: 'pointer' }}>
                <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 600, color: type === id ? theme.accent : theme.text, marginBottom: 2 }}>{lbl}</div>
                <div style={{ fontFamily: theme.sans, fontSize: 10, color: theme.muted, lineHeight: 1.3 }}>{desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>Description <span style={{ fontWeight: 400, textTransform: 'none' }}>optional</span></div>
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What's this list about?" rows={2} style={{ ...fInput, resize: 'none' }} />
        </div>
        <button type="button" disabled={!name.trim()} onClick={() => { if (name.trim()) { onCreate({ name, type, description }); onClose(); } }} style={{ width: '100%', padding: '14px', borderRadius: 999, border: 'none', background: name.trim() ? theme.accent : theme.border, color: name.trim() ? '#fff' : theme.muted, fontFamily: theme.sans, fontSize: 15, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'not-allowed' }}>
          Create list
        </button>
      </div>
    </div>
  );
}

// ── Lists Section (used in profile) ───────────────────────────────────
function ListsSection({ theme, onOpenList, ownOnly = false }) {
  const [showCreate, setShowCreate] = React.useState(false);
  const [lists, setLists] = React.useState(USER_LISTS);
  const shown = ownOnly ? lists.filter(l => l.isOwn) : lists;

  const handleCreate = ({ name, type, description }) => {
    setLists(prev => [{
      id: `l${Date.now()}`, name, type, description,
      coverHue: 120, createdAt: Date.now(), items: [],
      authorHandle: 'chloe', isOwn: true, likeCount: 0,
    }, ...prev]);
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {ownOnly ? 'My Lists' : 'Lists'}
        </div>
        {ownOnly && (
          <button type="button" onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: theme.accentLight, border: `1px solid ${theme.border}`, borderRadius: 999, padding: '5px 10px', cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.accent }}>
            <IconPlus size={11} stroke={theme.accent} sw={2.5} />
            New list
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: theme.sans, fontSize: 13, color: theme.muted }}>No lists yet.</div>
      ) : shown.map(list => {
        const brandItems = list.type === 'brands' ? (list.items || []).map(id => BRANDS.find(b => b.id === id)).filter(Boolean) : [];
        const postItems  = list.type === 'drinks'  ? (list.items || []).map(id => POSTS.find(p => p.id === id)).filter(Boolean) : [];
        const items = list.type === 'brands' ? brandItems : postItems;
        const triedCount = list.type === 'brands' ? brandItems.filter(b => userTriedBrand(b.id)).length : items.length;

        return (
          <button key={list.id} type="button" onClick={() => onOpenList(list.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: `1px solid ${theme.border}`, borderRadius: 14, padding: '11px 13px', background: theme.card, marginBottom: 8, cursor: 'pointer' }}>
            {/* Stacked thumbnails */}
            <div style={{ position: 'relative', width: 52, height: 52, flexShrink: 0 }}>
              {items.slice(0, 2).map((item, i) => {
                const photo = list.type === 'brands' ? item.branches?.[0]?.photoUrl : item.photos?.[0];
                const hue = list.type === 'brands' ? item.hue : brandHueForPost(item);
                return (
                  <div key={item.id} style={{ position: 'absolute', width: 40, height: 40, borderRadius: 10, overflow: 'hidden', border: `2px solid ${theme.surface}`, top: i * 8, left: i * 8, zIndex: 2 - i, background: theme.surface2 }}>
                    {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                  </div>
                );
              })}
              {items.length === 0 && (
                <div style={{ width: 52, height: 52, borderRadius: 12, background: `oklch(0.90 0.04 ${list.coverHue})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconBookmark size={20} stroke={`oklch(0.45 0.12 ${list.coverHue})`} sw={1.8} />
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: theme.sans, fontSize: 15, fontWeight: 600, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</div>
              <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 2 }}>
                {list.type === 'brands'
                  ? <>{items.length} brand{items.length !== 1 ? 's' : ''}</>
                  : <>{items.length} drink{items.length !== 1 ? 's' : ''}</>
                } · {list.likeCount} likes
              </div>
            </div>
            <IconChevron size={14} stroke={theme.muted} />
          </button>
        );
      })}
      {showCreate && <CreateListModal theme={theme} onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
    </>
  );
}

Object.assign(window, { ListDetailScreen, ListsSection });
