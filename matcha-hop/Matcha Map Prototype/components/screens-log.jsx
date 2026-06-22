// Log — new post, low friction

const DRINK_SUGGESTIONS = [
  'Matcha Latte', 'Iced Matcha Latte', 'Hot Matcha Latte',
  'Usucha', 'Koicha', 'Dirty Matcha', 'Matcha Hojicha Split',
  'Strawberry Matcha', 'Yuzu Matcha', 'Pomelo Matcha',
  'Brown Sugar Matcha', 'Ceremonial Usucha', 'Matcha Tonic',
  'Coconut Matcha', 'Matcha Affogato',
];

function LogScreen({ theme, onClose, onSave, context }) {
  const ctx = context || {};
  let prefilledBrand = ctx.brandId ? BRANDS.find(b => b.id === ctx.brandId) : null;
  let prefilledBranch = ctx.branchId && prefilledBrand
    ? (prefilledBrand.branches || []).find(br => br.id === ctx.branchId) : null;

  const [selectedBrand, setSelectedBrand] = React.useState(prefilledBrand || null);
  const [brandQuery, setBrandQuery] = React.useState(prefilledBrand ? prefilledBrand.name : '');
  const [brandSuggs, setBrandSuggs] = React.useState([]);
  const [selectedBranch, setSelectedBranch] = React.useState(prefilledBranch || null);
  const [caption, setCaption] = React.useState('');
  const [photos, setPhotos] = React.useState([]);
  const fileInputRef = React.useRef(null);
  const [drinks, setDrinks] = React.useState([
    { id: 1, name: '', rating: 0, notes: '', price: '', expanded: false, profile: { sweet: 0, bitter: 0, umami: 0 }, flavorNotes: [] }
  ]);
  const counter = React.useRef(2);
  const [saving, setSaving] = React.useState(false);

  const onBrandType = (v) => {
    setBrandQuery(v);
    setSelectedBrand(null);
    setSelectedBranch(null);
    const q = String(v || '').trim();
    const curated = q.length > 0
      ? BRANDS.filter(b => b.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5)
      : [];
    setBrandSuggs(curated);
  };

  const selectBrand = (b) => {
    setSelectedBrand(b);
    setBrandQuery(b.name);
    setBrandSuggs([]);
    const brs = b.branches || [];
    setSelectedBranch(brs.length === 1 ? brs[0] : null);
  };

  const addPhoto = () => fileInputRef.current?.click();
  const removePhoto = id => setPhotos(p => p.filter(x => x.id !== id));
  const addDrink = () => setDrinks(d => [...d, { id: counter.current++, name: '', rating: 0, notes: '', price: '', expanded: false, profile: { sweet: 0, bitter: 0, umami: 0 }, flavorNotes: [] }]);
  const removeDrink = id => setDrinks(d => d.filter(x => x.id !== id));
  const updateDrink = (id, k, v) => setDrinks(d => d.map(x => x.id === id ? { ...x, [k]: v } : x));
  const updateProfile = (id, k, v) => setDrinks(d => d.map(x => x.id === id ? { ...x, profile: { ...x.profile, [k]: v } } : x));
  const toggleNote = (id, n) => setDrinks(d => d.map(x => x.id === id
    ? { ...x, flavorNotes: x.flavorNotes.includes(n) ? x.flavorNotes.filter(f => f !== n) : [...x.flavorNotes, n] }
    : x));

  const branches = selectedBrand?.branches || [];

  const handleSave = async () => {
    const cleanDrinks = drinks.map(d => ({ name: String(d.name || '').trim(), rating: Number(d.rating) || 0, notes: String(d.notes || '').trim(), price: String(d.price || '').trim(), flavorNotes: d.flavorNotes || [], profile: d.profile || {} })).filter(d => d.name);
    if (!selectedBrand || cleanDrinks.length === 0 || saving) return;
    setSaving(true);
    try {
      await onSave({ brand: selectedBrand, branch: selectedBranch || branches[0] || null, caption, drinks: cleanDrinks, photoFiles: photos.map(p => p.file) });
    } catch (e) {
      console.warn('[log]', e?.message || e);
    } finally {
      setSaving(false);
    }
  };

  const fInput = { width: '100%', padding: '11px 13px', background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 10, outline: 'none', fontFamily: theme.sans, fontSize: 14, color: theme.text, fontWeight: 400, boxSizing: 'border-box' };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 100, background: theme.surface, display: 'flex', flexDirection: 'column', animation: 'slideUp 280ms cubic-bezier(.2,.8,.2,1)' }}>
      <div style={{ padding: 'max(12px, env(safe-area-inset-top, 0px)) 16px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <button type="button" disabled={saving} onClick={onClose} style={{ background: 'none', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: theme.sans, fontSize: 15, color: saving ? theme.border : theme.muted, padding: 0, opacity: saving ? 0.5 : 1 }}>Cancel</button>
        <div style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text }}>New post</div>
        <button type="button" disabled={saving} onClick={handleSave} style={{ background: saving ? theme.surface2 : theme.accent, color: saving ? theme.muted : '#fff', border: 'none', cursor: saving ? 'wait' : 'pointer', fontFamily: theme.sans, fontSize: 14, fontWeight: 600, padding: '8px 18px', borderRadius: 999, minWidth: 100 }}>
          {saving ? 'Posting…' : 'Post'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 48px' }}>
        {/* Photos */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            <button type="button" disabled={saving} onClick={addPhoto} style={{ width: 84, height: 100, flexShrink: 0, borderRadius: 12, border: `1.5px dashed ${theme.border}`, background: theme.surface2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}>
              <IconCamera size={22} stroke={theme.muted} sw={1.5} />
              <span style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted }}>Photo</span>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple disabled={saving} onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (!files.length) return;
              setPhotos(cur => [...cur, ...files.map(file => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, src: URL.createObjectURL(file) }))]);
              e.target.value = '';
            }} style={{ display: 'none' }} />
            {photos.map(ph => (
              <div key={ph.id} style={{ width: 84, height: 100, flexShrink: 0, borderRadius: 12, overflow: 'hidden', position: 'relative', border: `1px solid ${theme.border}` }}>
                {ph.src && <img src={ph.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                <button type="button" onClick={() => removePhoto(ph.id)} style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconClose size={8} stroke="#fff" sw={2.5} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Brand */}
        <div style={{ marginBottom: 14, position: 'relative' }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Cafe / Brand</div>
          <input value={brandQuery} onChange={e => onBrandType(e.target.value)} disabled={saving} placeholder="Search brand…" style={fInput} />
          {brandSuggs.length > 0 && !saving && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden', boxShadow: theme.shadow, marginTop: 2 }}>
              {brandSuggs.map(b => (
                <button type="button" key={b.id} onClick={() => selectBrand(b)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: theme.sans, fontSize: 14, color: theme.text, borderBottom: `1px solid ${theme.border}` }}>
                  {b.name}<span style={{ color: theme.muted, fontSize: 12, marginLeft: 6 }}>{b.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Caption */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Caption <span style={{ fontWeight: 400, textTransform: 'none' }}>optional</span></div>
          <textarea value={caption} onChange={e => setCaption(e.target.value)} disabled={saving} placeholder="How was it?" rows={2} style={{ ...fInput, resize: 'none', minHeight: 44 }} />
        </div>

        {/* Branch picker */}
        {selectedBrand && branches.length > 1 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Location <span style={{ fontWeight: 400, textTransform: 'none' }}>optional</span></div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
              {branches.map(br => {
                const on = selectedBranch?.id === br.id;
                return (
                  <button type="button" key={br.id} disabled={saving} onClick={() => setSelectedBranch(on ? null : br)} style={{ width: 126, flexShrink: 0, padding: 0, borderRadius: 12, cursor: 'pointer', background: theme.card, border: `1.5px solid ${on ? theme.accent : theme.border}`, overflow: 'hidden', textAlign: 'left' }}>
                    <div style={{ height: 70 }}>
                      {br.photoUrl ? <img src={br.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={selectedBrand.hue || 120} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                    </div>
                    <div style={{ padding: '7px 8px 9px' }}>
                      <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.text, lineHeight: 1.2 }}>{br.name}</div>
                      <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 2 }}>{br.neighborhood || br.address || 'Location'}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Drinks */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>Drinks</div>
          <button type="button" disabled={saving} onClick={addDrink} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: theme.sans, fontSize: 13, color: theme.accent, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" stroke={theme.accent} strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Add drink
          </button>
        </div>

        {drinks.map((drink, i) => (
          <DrinkEntry key={drink.id} drink={drink} theme={theme} index={i} locked={saving}
            canRemove={drinks.length > 1} onRemove={() => removeDrink(drink.id)}
            onUpdate={(k, v) => updateDrink(drink.id, k, v)}
            onUpdateProfile={(k, v) => updateProfile(drink.id, k, v)}
            onToggleNote={n => toggleNote(drink.id, n)} />
        ))}
      </div>
    </div>
  );
}

function DrinkEntry({ drink, theme, index, locked, canRemove, onRemove, onUpdate, onUpdateProfile, onToggleNote }) {
  const [showSuggs, setShowSuggs] = React.useState(false);
  const [nameSuggs, setNameSuggs] = React.useState([]);
  const onNameType = v => {
    onUpdate('name', v);
    const s = v.length > 0 ? DRINK_SUGGESTIONS.filter(x => x.toLowerCase().includes(v.toLowerCase())).slice(0, 4) : [];
    setNameSuggs(s); setShowSuggs(s.length > 0);
  };
  const allNotes = ['grassy', 'umami', 'nutty', 'vegetal', 'creamy', 'citrus', 'fruity', 'sweet', 'toasted', 'earthy', 'buttery', 'floral', 'bitter', 'mild'];
  const rowIn = { minHeight: 40, padding: '10px 12px', background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 10, outline: 'none', fontFamily: theme.sans, fontSize: 14, color: theme.text, fontWeight: 400, boxSizing: 'border-box' };

  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 10, overflow: 'hidden', background: theme.card }}>
      <div style={{ padding: '12px 12px 10px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: theme.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.accent }}>{index + 1}</div>
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            <input value={drink.name} onChange={e => onNameType(e.target.value)} disabled={locked} onBlur={() => setTimeout(() => setShowSuggs(false), 150)} placeholder="Drink name" style={{ ...rowIn, width: '100%' }} />
            {showSuggs && nameSuggs.length > 0 && !locked && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10, boxShadow: theme.shadow, marginTop: 2, overflow: 'hidden' }}>
                {nameSuggs.map(s => <button key={s} type="button" onMouseDown={() => { onUpdate('name', s); setShowSuggs(false); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: theme.sans, fontSize: 13, color: theme.text, borderBottom: `1px solid ${theme.border}` }}>{s}</button>)}
              </div>
            )}
          </div>
          <div style={{ position: 'relative', width: 104, flexShrink: 0 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.muted, pointerEvents: 'none' }}>PHP</span>
            <input value={drink.price} onChange={e => onUpdate('price', e.target.value.replace(/[^\d.,]/g, ''))} disabled={locked} inputMode="decimal" placeholder="0" style={{ ...rowIn, width: '100%', paddingLeft: 38 }} />
          </div>
          {canRemove && <button type="button" disabled={locked} onClick={onRemove} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', flexShrink: 0 }}><IconClose size={14} stroke={theme.muted} sw={2} /></button>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" disabled={locked} onClick={() => onUpdate('expanded', !drink.expanded)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: theme.sans, fontSize: 12, color: theme.muted, display: 'flex', alignItems: 'center', gap: 3 }}>
            {drink.expanded ? 'Less' : 'Add detail'}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={theme.muted} strokeWidth="2" strokeLinecap="round" style={{ transform: drink.expanded ? 'rotate(270deg)' : 'rotate(90deg)', transition: 'transform 180ms' }}><path d="M9 6l6 6-6 6"/></svg>
          </button>
        </div>
      </div>
      {drink.expanded && (
        <div style={{ borderTop: `1px solid ${theme.border}`, padding: '13px 12px 14px' }}>
          <textarea value={drink.notes} onChange={e => onUpdate('notes', e.target.value)} disabled={locked} placeholder="Tasting notes…" rows={2} style={{ width: '100%', padding: '11px 13px', background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 10, outline: 'none', fontFamily: theme.sans, fontSize: 14, color: theme.text, resize: 'none', marginBottom: 14, boxSizing: 'border-box' }} />
          {[{ key: 'sweet', label: 'Sweetness' }, { key: 'bitter', label: 'Bitterness' }, { key: 'umami', label: 'Umami' }].map(({ key, label }) => (
            <div key={key} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontFamily: theme.sans, fontSize: 12, color: theme.text }}>{label}</span>
                <span style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted }}>{drink.profile[key] > 0 ? `${drink.profile[key]}/5` : '—'}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[1,2,3,4,5].map(v => (
                  <button key={v} type="button" disabled={locked} onClick={() => onUpdateProfile(key, v === drink.profile[key] ? 0 : v)} style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: v <= drink.profile[key] ? theme.accent : theme.surface2, border: `1.5px solid ${v <= drink.profile[key] ? theme.accent : theme.border}`, cursor: 'pointer', padding: 0, transition: 'all 120ms' }} />
                ))}
              </div>
            </div>
          ))}
          <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.text, marginBottom: 8 }}>Flavor notes</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allNotes.map(n => {
              const on = drink.flavorNotes.includes(n);
              return <button type="button" key={n} disabled={locked} onClick={() => onToggleNote(n)} style={{ padding: '5px 11px', borderRadius: 999, cursor: 'pointer', background: on ? theme.accent : theme.surface2, color: on ? '#fff' : theme.text, border: `1px solid ${on ? theme.accent : theme.border}`, fontFamily: theme.sans, fontSize: 12, fontWeight: on ? 600 : 400, transition: 'all 120ms' }}>{n}</button>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

window.LogScreen = LogScreen;
