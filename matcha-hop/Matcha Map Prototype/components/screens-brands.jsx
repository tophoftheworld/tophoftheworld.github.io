// Brands grid — grouped by area, with submit + tag editing

const FALLBACK_BRAND = { id: '', name: '…', hue: 120, branches: [] };

const LOCATION_TAGS = [
  { key: 'wifi',            label: 'WiFi' },
  { key: 'outlets',         label: 'Outlets' },
  { key: 'parking',         label: 'Parking' },
  { key: 'pet-friendly',    label: 'Pet-friendly' },
  { key: 'outdoor-seating', label: 'Outdoor' },
  { key: 'study-friendly',  label: 'Study-friendly' },
  { key: 'cash-only',       label: 'Cash only' },
  { key: 'no-corkage',      label: 'No corkage' },
  { key: 'quiet',           label: 'Quiet' },
  { key: 'specialty',       label: 'Specialty' },
  { key: 'pop-up',          label: 'Pop-up' },
  { key: 'limited',         label: 'Limited runs' },
];

function TagPill({ tagKey, theme, small, onRemove }) {
  const meta = LOCATION_TAGS.find(t => t.key === tagKey) || { label: tagKey };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: small ? '3px 8px' : '4px 10px',
      borderRadius: 999,
      background: onRemove ? theme.accentLight : theme.surface2,
      border: `1px solid ${onRemove ? theme.accent : theme.border}`,
      fontFamily: theme.sans, fontSize: small ? 11 : 12,
      fontWeight: 500, color: onRemove ? theme.accent : theme.text,
    }}>
      {meta.label}
      {onRemove && (
        <button type="button" onClick={onRemove} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <IconClose size={8} stroke={theme.accent} sw={2.5} />
        </button>
      )}
    </span>
  );
}

function PostHereBtn({ onClick, theme }) {
  return (
    <button onClick={onClick} style={{ padding: '7px 13px', background: theme.accent, color: '#fff', border: 'none', borderRadius: 999, cursor: 'pointer', fontFamily: theme.sans, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <svg width="11" height="11" viewBox="0 0 24 24" stroke="#fff" strokeWidth="2.8" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
      Post
    </button>
  );
}

function EmptyMsg({ label, theme }) {
  return <div style={{ textAlign: 'center', padding: '60px 20px', fontFamily: theme.sans, fontSize: 14, color: theme.muted }}>{label}</div>;
}

// ── Submit Brand Modal ─────────────────────────────────────────────────
function SubmitBrandModal({ theme, onClose }) {
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState('cafe');
  const [address, setAddress] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);
  const fInput = { width: '100%', padding: '11px 13px', background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 10, outline: 'none', fontFamily: theme.sans, fontSize: 14, color: theme.text, boxSizing: 'border-box' };

  if (submitted) {
    return (
      <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
        <div style={{ width: '100%', maxWidth: 340, borderRadius: 20, padding: 24, background: theme.card, border: `1px solid ${theme.border}` }} onClick={e => e.stopPropagation()}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: theme.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <IconCheck size={22} stroke={theme.accent} sw={2.5} />
            </div>
            <div style={{ fontFamily: theme.sans, fontSize: 17, fontWeight: 700, color: theme.text, marginBottom: 6 }}>Submitted!</div>
            <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, lineHeight: 1.5 }}>Thanks for contributing. Your brand will appear once approved.</div>
          </div>
          <button type="button" onClick={onClose} style={{ width: '100%', padding: '13px', borderRadius: 999, border: 'none', background: theme.accent, color: '#fff', fontFamily: theme.sans, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div style={{ width: '100%', borderRadius: '20px 20px 0 0', background: theme.card, border: `1px solid ${theme.border}`, padding: '20px 20px 36px' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 17, fontWeight: 700, color: theme.text }}>Submit a brand</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><IconClose size={20} stroke={theme.muted} /></button>
        </div>
        <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, marginBottom: 14, lineHeight: 1.45 }}>Know a matcha brand we're missing? Submit for review.</div>
        {[{ label: 'Brand name', value: name, setter: setName, placeholder: 'e.g. Matchaya' }, { label: 'Address / location', value: address, setter: setAddress, placeholder: 'e.g. BGC, Taguig' }].map(({ label, value, setter, placeholder }) => (
          <div key={label} style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>{label}</div>
            <input value={value} onChange={e => setter(e.target.value)} placeholder={placeholder} style={fInput} />
          </div>
        ))}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>Type</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['cafe','Cafe'],['popup','Pop-up'],['home','Home']].map(([id, lbl]) => (
              <button key={id} type="button" onClick={() => setKind(id)} style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: `1.5px solid ${kind === id ? theme.accent : theme.border}`, background: kind === id ? theme.accentLight : theme.surface2, fontFamily: theme.sans, fontSize: 13, fontWeight: 600, color: kind === id ? theme.accent : theme.text, cursor: 'pointer' }}>{lbl}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>Notes <span style={{ fontWeight: 400, textTransform: 'none' }}>optional</span></div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any info to help verification…" rows={2} style={{ ...fInput, resize: 'none' }} />
        </div>
        <button type="button" disabled={!name.trim()} onClick={() => setSubmitted(true)} style={{ width: '100%', padding: '14px', borderRadius: 999, border: 'none', background: name.trim() ? theme.accent : theme.border, color: name.trim() ? '#fff' : theme.muted, fontFamily: theme.sans, fontSize: 15, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'not-allowed' }}>Submit for review</button>
      </div>
    </div>
  );
}

// ── Brand tile ─────────────────────────────────────────────────────────
function BrandTile({ brand, theme, onOpen }) {
  const tried = userTriedBrand(brand.id);
  const photo = brand.branches?.[0]?.photoUrl;
  return (
    <button onClick={() => onOpen(brand.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', display: 'grid', gridTemplateRows: 'auto auto', gap: 5, alignContent: 'start' }}>
      <div style={{ aspectRatio: '1/1', width: '100%', borderRadius: 12, overflow: 'hidden', position: 'relative', border: `1px solid ${theme.border}` }}>
        {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={brand.hue} style={{ borderRadius: 0 }} />}
        {brand.kind !== 'cafe' && (
          <div style={{ position: 'absolute', top: 5, left: 5, padding: '2px 6px', background: 'rgba(0,0,0,0.55)', borderRadius: 4, fontFamily: theme.sans, fontSize: 8, fontWeight: 700, color: '#fff', letterSpacing: 0.3 }}>
            {brand.kind === 'popup' ? 'POP-UP' : 'HOME'}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.text, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{brand.name}</div>
        {tried && (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.8 }}>
            <path d="M4 12l5 5 11-12"/>
          </svg>
        )}
      </div>
    </button>
  );
}

// ── Brands Screen — grouped by region ───────────────────────────────────
function BrandsScreen({ theme, onOpenBrand }) {
  const [showSubmit, setShowSubmit] = React.useState(false);
  const [collapsedRegions, setCollapsedRegions] = React.useState({});

  const regions = React.useMemo(() => {
    const map = {};
    BRANDS.forEach(b => {
      const region = b.region || 'Other';
      if (!map[region]) map[region] = [];
      map[region].push(b);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, []);

  const toggleRegion = (region) => setCollapsedRegions(prev => ({ ...prev, [region]: !prev[region] }));

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      <div style={{ padding: 'max(8px, env(safe-area-inset-top, 0px)) 16px 0', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 24, fontWeight: 600, color: theme.text, letterSpacing: -0.3 }}>Brands</div>
          <button type="button" onClick={() => setShowSubmit(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: theme.accentLight, border: `1px solid ${theme.border}`, borderRadius: 999, padding: '6px 11px', cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.accent }}>
            <IconPlus size={12} stroke={theme.accent} sw={2.5} />
            Submit
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 100px' }}>
        {regions.map(([region, brands]) => {
          const collapsed = collapsedRegions[region];
          return (
            <div key={region} style={{ marginBottom: 20 }}>
              <button type="button" onClick={() => toggleRegion(region)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 8px', marginBottom: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{region}</div>
                  <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 999, padding: '1px 7px' }}>{brands.length}</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.muted} strokeWidth="2" strokeLinecap="round" style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 180ms' }}>
                  <path d="M9 6l6 6-6 6"/>
                </svg>
              </button>
              {!collapsed && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {brands.map(b => <BrandTile key={b.id} brand={b} theme={theme} onOpen={onOpenBrand} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showSubmit && <SubmitBrandModal theme={theme} onClose={() => setShowSubmit(false)} />}
    </div>
  );
}

// ── Brand Detail ────────────────────────────────────────────────────────
function BrandDetailScreen({ theme, brandId, onBack, onOpenPost, onPost, onViewAllPosts, onOpenBranch }) {
  const brand = BRANDS.find(b => b.id === brandId) || BRANDS[0] || FALLBACK_BRAND;
  const brandPosts = POSTS.filter(p => p.brandId === brand.id);
  const branches = brand.branches || [];
  const isSingle = branches.length === 1;
  const [hearted, setHearted] = React.useState(false);
  const tried = userTriedBrand(brand.id);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      <div style={{ padding: 'max(12px, env(safe-area-inset-top, 0px)) 16px 12px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
            <IconBack size={20} stroke={theme.text} sw={2} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 20, fontWeight: 600, color: theme.text, letterSpacing: -0.3 }}>{brand.name}</div>
            <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 1, textTransform: 'capitalize' }}>
              {brand.kind} · {brand.area}
            </div>
          </div>
          <button type="button" onClick={() => setHearted(h => !h)} style={{ width: 34, height: 34, borderRadius: 999, border: `1px solid ${hearted ? theme.accent : theme.border}`, background: hearted ? theme.accentLight : theme.card, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <IconHeart size={16} stroke={hearted ? theme.accent : theme.muted} fill={hearted ? theme.accent : 'none'} sw={1.9} />
          </button>
          <PostHereBtn onClick={onPost} theme={theme} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 80px' }}>
        <section style={{ marginBottom: 18 }}>
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, overflow: 'hidden', background: theme.card }}>
            <div style={{ height: 175, position: 'relative' }}>
              {branches[0]?.photoUrl
                ? <img src={branches[0].photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <Placeholder label="" hue={brand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
              }
              {/* Tried badge on hero */}
              {tried && (
                <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
                  <IconCheck size={11} stroke={theme.accent} sw={2.5} />
                  <span style={{ fontFamily: theme.sans, fontSize: 10, fontWeight: 700, color: theme.accent }}>Tried</span>
                </div>
              )}
            </div>
            <div style={{ padding: '12px 14px 14px' }}>
              <div style={{ fontFamily: theme.sans, fontSize: 18, fontWeight: 600, color: theme.text }}>{brand.name}</div>
              <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 2, textTransform: 'capitalize' }}>{brand.kind} · {brandPosts.length} community posts</div>
              {isSingle && branches[0] && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {branches[0].address && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <IconPin size={12} stroke={theme.muted} sw={1.6} />
                      <span style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>{branches[0].address}</span>
                    </div>
                  )}
                  {branches[0].hours && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <IconClock size={12} stroke={theme.muted} sw={1.6} />
                      <span style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>{branches[0].hours}</span>
                    </div>
                  )}
                  {branches[0].tags?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                      {branches[0].tags.map(t => <TagPill key={t} tagKey={t} theme={theme} small />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {!isSingle && (
          <section style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Branches</div>
            {branches.map(br => {
              const brPosts = POSTS.filter(p => p.branchId === br.id).length;
              return (
                <button key={br.id} type="button" onClick={() => onOpenBranch?.(brand.id, br.id)} style={{ width: '100%', textAlign: 'left', padding: '11px 13px', border: `1px solid ${theme.border}`, borderRadius: 14, display: 'flex', alignItems: 'flex-start', gap: 12, background: theme.card, marginBottom: 8, cursor: 'pointer' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: theme.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconPin size={16} stroke={theme.accent} sw={1.8} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 500, color: theme.text }}>{br.name}</div>
                    <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 2 }}>{br.address || br.neighborhood || ''}</div>
                    {br.hours && <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 2 }}>{br.hours}</div>}
                    {br.tags?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                        {br.tags.map(t => <TagPill key={t} tagKey={t} theme={theme} small />)}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                    {brPosts > 0 && <span style={{ fontFamily: theme.sans, fontSize: 11, color: theme.accent, fontWeight: 600 }}>{brPosts} posts</span>}
                    <IconChevron size={13} stroke={theme.muted} />
                  </div>
                </button>
              );
            })}
          </section>
        )}

        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Feed preview</div>
            <button type="button" onClick={() => onViewAllPosts?.(brand.id)} style={{ background: theme.accentLight, border: `1px solid ${theme.border}`, borderRadius: 999, padding: '5px 10px', cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.accent }}>View all</button>
          </div>
          {brandPosts.length === 0 ? <EmptyMsg label="No posts yet" theme={theme} /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {brandPosts.slice(0, 6).map(post => (
                <button key={post.id} type="button" onClick={() => onOpenPost(post.id)} style={{ border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden', background: theme.card, cursor: 'pointer', padding: 0, aspectRatio: '1/1' }}>
                  {post.photos?.[0] ? <img src={post.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={brand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Branch Detail ────────────────────────────────────────────────────────
function BranchDetailScreen({ theme, brandId, branchId, onBack, onOpenPost, onPost, onOpenBrand }) {
  const brand = BRANDS.find(b => b.id === brandId) || BRANDS[0] || FALLBACK_BRAND;
  const branch = (brand.branches || []).find(br => br.id === branchId) || brand.branches?.[0];
  const branchPosts = POSTS.filter(p => String(p.branchId) === String(branchId));
  const [hearted, setHearted] = React.useState(false);
  const [localTags, setLocalTags] = React.useState(branch?.tags || []);
  const [showTagPicker, setShowTagPicker] = React.useState(false);
  const available = LOCATION_TAGS.filter(t => !localTags.includes(t.key));

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      <div style={{ padding: 'max(12px, env(safe-area-inset-top, 0px)) 16px 14px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
            <IconBack size={20} stroke={theme.text} sw={2} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 19, fontWeight: 600, color: theme.text, letterSpacing: -0.3 }}>{branch?.name || 'Branch'}</div>
            <button type="button" onClick={() => onOpenBrand?.(brand.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.accent, marginTop: 2 }}>
              {brand.name} ↗
            </button>
          </div>
          <button type="button" onClick={() => setHearted(h => !h)} style={{ width: 34, height: 34, borderRadius: 999, border: `1px solid ${hearted ? theme.accent : theme.border}`, background: hearted ? theme.accentLight : theme.card, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <IconHeart size={16} stroke={hearted ? theme.accent : theme.muted} fill={hearted ? theme.accent : 'none'} sw={1.9} />
          </button>
          <PostHereBtn onClick={onPost} theme={theme} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 80px' }}>
        <section style={{ marginBottom: 18 }}>
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, overflow: 'hidden', background: theme.card }}>
            <div style={{ height: 175 }}>
              {branch?.photoUrl ? <img src={branch.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={brand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
            </div>
            <div style={{ padding: '12px 14px 14px' }}>
              <div style={{ fontFamily: theme.sans, fontSize: 18, fontWeight: 600, color: theme.text }}>{branch?.name}</div>
              <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.accent, marginTop: 2 }}>{brand.name}</div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {branch?.address && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                    <IconPin size={13} stroke={theme.muted} sw={1.6} />
                    <span style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, lineHeight: 1.4 }}>{branch.address}</span>
                  </div>
                )}
                {branch?.hours && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <IconClock size={13} stroke={theme.muted} sw={1.6} />
                    <span style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted }}>{branch.hours}</span>
                  </div>
                )}
              </div>
              <div style={{ marginTop: 12 }}>
                <div style={{ fontFamily: theme.sans, fontSize: 10, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 7 }}>Location tags</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {localTags.map(t => (
                    <TagPill key={t} tagKey={t} theme={theme} small onRemove={() => setLocalTags(prev => prev.filter(x => x !== t))} />
                  ))}
                  <button type="button" onClick={() => setShowTagPicker(v => !v)} style={{ padding: '3px 9px', borderRadius: 999, border: `1px dashed ${theme.border}`, background: 'none', fontFamily: theme.sans, fontSize: 11, color: theme.muted, cursor: 'pointer' }}>+ add tag</button>
                </div>
                {showTagPicker && available.length > 0 && (
                  <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {available.map(t => (
                      <button key={t.key} type="button" onClick={() => { setLocalTags(prev => [...prev, t.key]); if (available.length <= 1) setShowTagPicker(false); }} style={{ padding: '3px 9px', borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.surface2, fontFamily: theme.sans, fontSize: 11, color: theme.text, cursor: 'pointer' }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Posts here</div>
            <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>{branchPosts.length} {branchPosts.length === 1 ? 'post' : 'posts'}</div>
          </div>
          {branchPosts.length === 0 ? <EmptyMsg label="No posts at this location yet" theme={theme} /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {branchPosts.map(post => (
                <button key={post.id} type="button" onClick={() => onOpenPost(post.id)} style={{ border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden', background: theme.card, cursor: 'pointer', padding: 0, aspectRatio: '1/1' }}>
                  {post.photos?.[0] ? <img src={post.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={brand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

Object.assign(window, { BrandsScreen, BrandDetailScreen, BranchDetailScreen });
