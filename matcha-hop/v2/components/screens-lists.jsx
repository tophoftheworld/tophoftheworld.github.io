// Lists — detail, composer, profile section (uses window.USER_LISTS, window.BRANDS, window.POSTS)

function listEntryPlaceId(row) {
  return row?.entry?.placeId
    || row?.branch?.placeId
    || (String(row?.brand?.id || '').startsWith('gplace_') ? String(row.brand.id).slice('gplace_'.length) : null);
}

function ListEntryThumbnail({ photo, placeId, branch, hue }) {
  const resolveInitial = React.useCallback(() => (
    photo
    || branch?.photoUrl
    || (placeId ? window.V2Live?.getCachedPlacePhoto?.(placeId) : null)
    || null
  ), [photo, placeId, branch?.photoUrl]);

  const [src, setSrc] = React.useState(resolveInitial);

  React.useEffect(() => {
    const initial = resolveInitial();
    setSrc(initial);
    const pid = placeId || branch?.placeId || null;
    if (initial || !pid || !window.V2Live?.getPlacePhoto) return undefined;
    let active = true;
    window.V2Live.getPlacePhoto(pid, false)
      .then((url) => {
        if (active && url) setSrc(url);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [resolveInitial, placeId, branch?.placeId, branch?.photoUrl]);

  if (src) {
    return <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  return <Placeholder label="" hue={hue || 120} style={{ width: '100%', height: '100%', borderRadius: 0 }} />;
}

function composerEntriesFromList(list, brands) {
  if (!list) return [];
  const brandList = Array.isArray(brands) ? brands : [];
  const raw = Array.isArray(list.entries) && list.entries.length
    ? list.entries
    : (list.items || []).map((brandId, i) => ({
      id: `legacy_${brandId}_${i}`,
      brandId,
      branchId: null,
      photoUrl: null,
    }));
  let keyCounter = 1;
  return raw.map((entry) => {
    const resolved = window.resolveListEntryDisplay
      ? window.resolveListEntryDisplay(entry, brandList)
      : null;
    if (!resolved) return null;
    const isGoogle = resolved.isGooglePlace;
    const placeId = entry.placeId
      || (String(entry.brandId || '').startsWith('gplace_') ? String(entry.brandId).slice('gplace_'.length) : null);
    return {
      key: `entry_${keyCounter++}`,
      entryId: entry.id,
      kind: isGoogle ? 'google' : 'brand',
      brand: resolved.brand,
      branch: resolved.branch,
      googleRow: isGoogle ? {
        placeId,
        name: entry.placeName || resolved.brand.name,
        address: entry.placeAddress || resolved.address,
      } : null,
      photoPreview: entry.photoUrl || resolved.photo,
      photoUrl: entry.photoUrl || null,
      photoFile: null,
    };
  }).filter(Boolean);
}

const ListComposerForm = React.forwardRef(function ListComposerForm({ theme, saving, initialList = null }, ref) {
  const BRANDS = Array.isArray(window.BRANDS) ? window.BRANDS : [];
  const [name, setName] = React.useState(() => initialList?.name || '');
  const [description, setDescription] = React.useState(() => initialList?.description || '');
  const [entries, setEntries] = React.useState(() => (
    initialList ? composerEntriesFromList(initialList, BRANDS) : []
  ));
  const [brandQuery, setBrandQuery] = React.useState('');
  const [brandSuggs, setBrandSuggs] = React.useState([]);
  const [pendingBrand, setPendingBrand] = React.useState(null);
  const entryKeyRef = React.useRef(1);
  const latestLocationQ = React.useRef('');
  const locationSearchTimer = React.useRef(null);
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

  const addEntry = (brand, branch) => {
    if (!brand) return;
    const key = `entry_${entryKeyRef.current++}`;
    const defaultPhoto = branch?.photoUrl || brand.branches?.[0]?.photoUrl || null;
    setEntries((prev) => [...prev, {
      key,
      brand,
      branch: branch || null,
      photoPreview: defaultPhoto,
      photoFile: null,
    }]);
    setBrandQuery('');
    setBrandSuggs([]);
    setPendingBrand(null);
  };

  const addGoogleEntry = (row) => {
    if (!row?.placeId) return;
    const brand = window.buildGooglePlaceBrand ? window.buildGooglePlaceBrand(row) : null;
    if (!brand) return;
    const key = `entry_${entryKeyRef.current++}`;
    setEntries((prev) => [...prev, {
      key,
      kind: 'google',
      googleRow: row,
      brand,
      branch: brand.branches[0],
      photoPreview: null,
      photoFile: null,
    }]);
    setBrandQuery('');
    setBrandSuggs([]);
    setPendingBrand(null);
  };

  const onBrandType = (v) => {
    latestLocationQ.current = v;
    setBrandQuery(v);
    const q = String(v || '').trim();
    let curated = [];
    if (q.length > 0) {
      curated = BRANDS
        .filter((b) => String(b.name || '').toLowerCase().includes(q.toLowerCase()))
        .slice(0, 5)
        .map((b) => ({ type: 'brand', key: b.id, brand: b }));
    }
    setBrandSuggs(curated);
    if (locationSearchTimer.current) clearTimeout(locationSearchTimer.current);
    if (q.length < 2) return;
    locationSearchTimer.current = setTimeout(async () => {
      if (latestLocationQ.current !== v) return;
      const g = (await window.V2Live?.searchPlacesForLog?.(q)) || [];
      if (latestLocationQ.current !== v) return;
      setBrandSuggs((prev) => {
        const brandsOnly = (prev || []).filter((x) => x && x.type === 'brand');
        const googleRows = g.map((row) => ({ type: 'google', key: `g-${row.placeId}`, row }));
        return [...brandsOnly, ...googleRows];
      });
    }, 320);
  };

  const pickBrand = (brand) => {
    const branches = Array.isArray(brand?.branches) ? brand.branches : [];
    if (branches.length <= 1) {
      addEntry(brand, branches[0] || null);
    } else {
      setPendingBrand(brand);
      setBrandQuery(brand.name);
      setBrandSuggs([]);
    }
  };

  const removeEntry = (key) => {
    setEntries((prev) => prev.filter((e) => e.key !== key));
  };

  const setEntryPhoto = (key, file) => {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setEntries((prev) => prev.map((e) => (
      e.key === key ? { ...e, photoFile: file, photoPreview: preview } : e
    )));
  };

  React.useImperativeHandle(ref, () => ({
    getPayload() {
      const trimmed = name.trim();
      if (!trimmed) {
        window.alert('List name is required.');
        return null;
      }
      if (!entries.length) {
        window.alert('Add at least one brand or location.');
        return null;
      }
      return {
        listId: initialList?.id || null,
        name: trimmed,
        description: description.trim(),
        entries: entries.map((e) => {
          const common = {
            id: e.entryId || undefined,
            photoUrl: e.photoFile ? undefined : (e.photoUrl || null),
            photoFile: e.photoFile || null,
          };
          if (e.kind === 'google' || e.googleRow?.placeId || String(e.brand?.id || '').startsWith('gplace_')) {
            const row = e.googleRow || {};
            const placeId = row.placeId || e.branch?.placeId;
            return {
              ...common,
              placeId,
              placeName: row.name || e.brand?.name || '',
              placeAddress: row.address || e.branch?.address || '',
              lat: row.lat,
              lng: row.lng,
              branchId: e.branch?.id || (placeId && window.gpCafeIdFromPlaceId ? window.gpCafeIdFromPlaceId(placeId) : null),
              brandId: e.brand?.id || (placeId ? `gplace_${placeId}` : null),
            };
          }
          return {
            ...common,
            brandId: e.brand.id,
            branchId: e.branch?.id || null,
          };
        }),
      };
    },
  }), [name, description, entries, initialList?.id]);

  return (
    <div style={{ padding: '16px 16px 120px' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>List name</div>
        <input value={name} disabled={saving} onChange={(e) => setName(e.target.value)} placeholder="e.g. Best Matcha in Makati" style={fInput} />
      </div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>
          Description <span style={{ fontWeight: 400, textTransform: 'none' }}>optional</span>
        </div>
        <textarea value={description} disabled={saving} onChange={(e) => setDescription(e.target.value)} placeholder="What's this list about?" rows={2} style={{ ...fInput, resize: 'none' }} />
      </div>

      <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Brand / location</div>

      {entries.map((row, i) => {
        const branchLabel = row.branch?.name && row.branch.name !== row.brand.name ? row.branch.name : null;
        const sub = branchLabel || row.branch?.neighborhood || row.branch?.address || row.brand.area || '';
        const isGoogle = row.kind === 'google' || row.brand?.isGooglePlace;
        return (
          <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '10px 12px', borderRadius: 14, border: `1px solid ${theme.border}`, background: theme.card }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: i < 3 ? theme.accentLight : theme.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: i < 3 ? theme.accent : theme.muted }}>{i + 1}</span>
            </div>
            <label style={{ position: 'relative', width: 52, height: 52, flexShrink: 0, cursor: saving ? 'not-allowed' : 'pointer' }}>
              <input type="file" accept="image/*" disabled={saving} style={{ display: 'none' }} onChange={(e) => { setEntryPhoto(row.key, e.target.files?.[0]); e.target.value = ''; }} />
              <div style={{ width: 52, height: 52, borderRadius: 12, overflow: 'hidden', background: theme.surface2, border: `1px solid ${theme.border}` }}>
                {row.photoPreview
                  ? <img src={row.photoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Placeholder label="" hue={row.brand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
              </div>
              <div style={{ position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: '50%', background: theme.accent, border: `2px solid ${theme.card}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconCamera size={10} stroke="#fff" sw={2} />
              </div>
            </label>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.brand.name}
                {isGoogle ? <span style={{ color: theme.muted, fontSize: 11, fontWeight: 500, marginLeft: 6 }}>Maps</span> : null}
              </div>
              {sub ? <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div> : null}
            </div>
            <button type="button" disabled={saving} onClick={() => removeEntry(row.key)} aria-label="Remove" style={{ background: 'none', border: 'none', padding: 6, cursor: saving ? 'not-allowed' : 'pointer' }}>
              <IconTrash size={16} stroke={theme.muted} sw={1.8} />
            </button>
          </div>
        );
      })}

      {pendingBrand ? (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 14, border: `1px solid ${theme.border}`, background: theme.surface2 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
            Pick a branch for {pendingBrand.name}
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {(pendingBrand.branches || []).map((br) => (
              <button key={br.id} type="button" disabled={saving} onClick={() => addEntry(pendingBrand, br)} style={{
                width: 126, flexShrink: 0, padding: 0, borderRadius: 12, cursor: saving ? 'not-allowed' : 'pointer',
                background: theme.card, border: `1.5px solid ${theme.border}`, overflow: 'hidden', textAlign: 'left',
              }}>
                <div style={{ width: '100%', height: 72 }}>
                  {br.photoUrl
                    ? <img src={br.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <Placeholder label="" hue={pendingBrand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                </div>
                <div style={{ padding: '7px 8px 8px' }}>
                  <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.text }}>{br.name}</div>
                  <div style={{ fontFamily: theme.sans, fontSize: 10, color: theme.muted, marginTop: 2 }}>{br.neighborhood || br.address || 'Location'}</div>
                </div>
              </button>
            ))}
          </div>
          <button type="button" disabled={saving} onClick={() => setPendingBrand(null)} style={{ marginTop: 8, background: 'none', border: 'none', fontFamily: theme.sans, fontSize: 12, color: theme.muted, cursor: 'pointer', padding: 0 }}>Cancel</button>
        </div>
      ) : (
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <input
            value={brandQuery}
            disabled={saving}
            onChange={(e) => onBrandType(e.target.value)}
            placeholder="Search brand or Google Maps location…"
            style={fInput}
          />
          {brandSuggs.length > 0 ? (
            <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, zIndex: 20, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
              {brandSuggs.map((item) => (
                item.type === 'google' ? (
                  <button key={item.key} type="button" disabled={saving} onClick={() => addGoogleEntry(item.row)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 13px', background: 'none', border: 'none', borderBottom: `1px solid ${theme.border}`, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: theme.sans, fontSize: 14, color: theme.text }}>
                    <span style={{ fontWeight: 600 }}>{item.row.name}</span>
                    <span style={{ color: theme.muted, fontSize: 12, marginLeft: 6 }}>Maps</span>
                    {item.row.address ? (
                      <div style={{ fontSize: 12, color: theme.muted, marginTop: 4, fontWeight: 400 }}>{item.row.address}</div>
                    ) : null}
                  </button>
                ) : (
                  <button key={item.key} type="button" disabled={saving} onClick={() => pickBrand(item.brand)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 13px', background: 'none', border: 'none', borderBottom: `1px solid ${theme.border}`, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: theme.sans, fontSize: 14, color: theme.text }}>
                    {item.brand.name}
                  </button>
                )
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});

function ListDetailScreen({ theme, listId, onBack, onOpenBrand, onOpenPost, onOpenLocation, onEditList }) {
  const USER_LISTS = Array.isArray(window.USER_LISTS) ? window.USER_LISTS : [];
  const BRANDS = Array.isArray(window.BRANDS) ? window.BRANDS : [];
  const list = USER_LISTS.find((l) => l.id === listId);
  if (!list) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 15, color: theme.muted, marginBottom: 16 }}>List not found.</div>
        <button type="button" onClick={onBack} style={{ padding: '10px 20px', borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.surface2, cursor: 'pointer', fontFamily: theme.sans }}>Back</button>
      </div>
    );
  }
  const displays = window.resolveListDisplays ? window.resolveListDisplays(list, BRANDS, window.POSTS) : [];

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
              by @{list.authorHandle || 'member'} · {displays.length} {list.type === 'brands' ? 'places' : 'drinks'}
            </div>
          </div>
          {list.isOwn && onEditList ? (
            <button type="button" aria-label="Edit list" onClick={() => onEditList(list.id)} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
              <IconEdit size={18} stroke={theme.muted} sw={1.8} />
            </button>
          ) : null}
        </div>
        {list.description ? (
          <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, marginTop: 6, paddingLeft: 46, lineHeight: 1.45 }}>{list.description}</div>
        ) : null}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 90px' }}>
        {displays.map((row, i) => {
          if (row.kind === 'drink') {
            const post = row.post;
            const drink = post.drinks?.[0];
            return (
              <button key={post.id} type="button" onClick={() => onOpenPost(post.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: `1px solid ${theme.border}`, borderRadius: 14, padding: '11px 13px', background: theme.card, marginBottom: 8, cursor: 'pointer' }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: i < 3 ? theme.accentLight : theme.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: i < 3 ? theme.accent : theme.muted }}>{i + 1}</span>
                </div>
                <div style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: theme.surface2 }}>
                  {row.photo ? <img src={row.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={window.brandHueForPost(post)} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: theme.sans, fontSize: 15, fontWeight: 600, color: theme.text }}>{drink?.name || 'Drink'}</div>
                  <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.accent, marginTop: 1 }}>{post.brand}</div>
                  {drink?.price ? <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 1 }}>{window.formatPhpPrice(drink.price)}</div> : null}
                </div>
              </button>
            );
          }
          const { brand, photo, sublabel, isGooglePlace } = row;
          const tried = !isGooglePlace && window.userTriedBrand ? window.userTriedBrand(brand.id) : false;
          const openEntry = () => {
            if (isGooglePlace && onOpenLocation) onOpenLocation(row);
            else if (!isGooglePlace) onOpenBrand(brand.id);
          };
          return (
            <button key={row.entry?.id || brand.id} type="button" onClick={openEntry} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: `1px solid ${theme.border}`, borderRadius: 14, padding: '11px 13px', background: theme.card, marginBottom: 8, cursor: 'pointer' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: i < 3 ? theme.accentLight : theme.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: i < 3 ? theme.accent : theme.muted }}>{i + 1}</span>
              </div>
              <div style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: theme.surface2 }}>
                <ListEntryThumbnail photo={photo} placeId={listEntryPlaceId(row)} branch={row.branch} hue={brand.hue} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: theme.sans, fontSize: 15, fontWeight: 600, color: isGooglePlace ? theme.text : theme.accent }}>
                  {brand.name}
                  {isGooglePlace ? <span style={{ color: theme.muted, fontSize: 11, fontWeight: 500, marginLeft: 6 }}>Maps</span> : null}
                </div>
                <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 2 }}>{sublabel}</div>
              </div>
              {tried ? (
                <div style={{ position: 'absolute', top: 9, right: 11, width: 18, height: 18, borderRadius: '50%', background: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5 11-12" /></svg>
                </div>
              ) : null}
            </button>
          );
        })}
        {displays.length === 0 ? <div style={{ textAlign: 'center', padding: '60px 20px', fontFamily: theme.sans, fontSize: 14, color: theme.muted }}>This list is empty.</div> : null}
      </div>
    </div>
  );
}

function ListsSection({ theme, onOpenList, ownOnly = false, onNewList = null }) {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener('v2:data-updated', h);
    return () => window.removeEventListener('v2:data-updated', h);
  }, []);
  const lists = Array.isArray(window.USER_LISTS) ? window.USER_LISTS : [];
  const BRANDS = Array.isArray(window.BRANDS) ? window.BRANDS : [];
  const shown = ownOnly ? lists.filter((l) => l.isOwn) : lists;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {ownOnly ? 'My Lists' : 'Lists'}
        </div>
        {ownOnly && onNewList ? (
          <button type="button" onClick={onNewList} style={{ display: 'flex', alignItems: 'center', gap: 4, background: theme.accentLight, border: `1px solid ${theme.border}`, borderRadius: 999, padding: '5px 10px', cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.accent }}>
            <IconPlus size={11} stroke={theme.accent} sw={2.5} />
            New list
          </button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: theme.sans, fontSize: 13, color: theme.muted }}>No lists yet.</div>
      ) : shown.map((list) => {
        const displays = window.resolveListDisplays ? window.resolveListDisplays(list, BRANDS, window.POSTS) : [];

        return (
          <button key={list.id} type="button" onClick={() => onOpenList(list.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: `1px solid ${theme.border}`, borderRadius: 14, padding: '11px 13px', background: theme.card, marginBottom: 8, cursor: 'pointer' }}>
            <div style={{ position: 'relative', width: 52, height: 52, flexShrink: 0 }}>
              {displays.slice(0, 2).map((row, i) => {
                const hue = row.kind === 'brand' ? row.brand?.hue : window.brandHueForPost(row.post);
                return (
                  <div key={row.entry?.id || row.post?.id || i} style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', border: `2px solid ${theme.surface}`, top: i * 8, left: i * 8, zIndex: 2 - i, background: theme.surface2, position: 'absolute' }}>
                    {row.kind === 'brand' ? (
                      <ListEntryThumbnail photo={row.photo} placeId={listEntryPlaceId(row)} branch={row.branch} hue={row.brand?.hue} />
                    ) : (
                      row.photo
                        ? <img src={row.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <Placeholder label="" hue={hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                    )}
                  </div>
                );
              })}
              {displays.length === 0 ? (
                <div style={{ width: 52, height: 52, borderRadius: 12, background: `oklch(0.90 0.04 ${list.coverHue})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconBookmark size={20} stroke={`oklch(0.45 0.12 ${list.coverHue})`} sw={1.8} />
                </div>
              ) : null}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: theme.sans, fontSize: 15, fontWeight: 600, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</div>
              <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 2 }}>
                {list.type === 'brands'
                  ? <>{displays.length} place{displays.length !== 1 ? 's' : ''}</>
                  : <>{displays.length} drink{displays.length !== 1 ? 's' : ''}</>}
                {' '}· {list.likeCount || 0} likes
              </div>
            </div>
            <IconChevron size={14} stroke={theme.muted} />
          </button>
        );
      })}
    </>
  );
}

Object.assign(window, { ListDetailScreen, ListsSection, ListComposerForm, ListEntryThumbnail, listEntryPlaceId });
