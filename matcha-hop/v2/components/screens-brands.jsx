// Brands grid, Brand detail (branches + posts), Branch detail

const FALLBACK_BRAND = { id: '', name: '…', hue: 120, branches: [] };

/** Gallery tile: logo always wins; place/post photos are fallbacks only. */
function brandGalleryTilePhoto(brand, placePhotoCache = {}, latestPostPhoto = null) {
  if (brand?.logoUrl) return brand.logoUrl;
  const branch = (brand?.branches || []).find((br) => br?.placeId) || (brand?.branches || [])[0] || null;
  return placePhotoCache[brand?.id] || branch?.photoUrl || latestPostPhoto || null;
}

window.brandGalleryTilePhoto = brandGalleryTilePhoto;

function PlaceSearchField({ theme, searchTerm, onSearchChange, onPick, disabled, placeholder = 'Search address or place', dropUp = false, inlineList = false, inlineListFill = false }) {
  const [suggestions, setSuggestions] = React.useState([]);
  const searchTimer = React.useRef(null);
  const latestQuery = React.useRef('');

  const handleChange = (v) => {
    onSearchChange(v);
    latestQuery.current = v;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = String(v || '').trim();
    if (q.length < 2 || !window.V2Live?.searchPlacesForEvents) {
      setSuggestions([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const rows = await window.V2Live.searchPlacesForEvents(q).catch(() => []);
      if (latestQuery.current !== v) return;
      setSuggestions(rows || []);
    }, 320);
  };

  const listStyle = inlineList ? {
    marginTop: 8,
    ...(inlineListFill ? { flex: 1, minHeight: 0, maxHeight: 'none' } : { maxHeight: 'min(40vh, 280px)' }),
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    background: theme.card,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    boxShadow: theme.shadowSm,
  } : {
    position: 'absolute',
    ...(dropUp ? { bottom: '100%', marginBottom: 4 } : { top: '100%', marginTop: 4 }),
    left: 0,
    right: 0,
    zIndex: 10,
    maxHeight: 'min(50vh, 320px)',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    background: theme.card,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    boxShadow: theme.shadowSm,
  };

  const q = String(searchTerm || '').trim();

  return (
    <div style={{
      position: 'relative',
      ...(inlineListFill ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : {}),
    }}>
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`,
          background: theme.surface2, fontFamily: theme.sans, fontSize: 14, outline: 'none', boxSizing: 'border-box',
          opacity: disabled ? 0.55 : 1, flexShrink: 0,
        }}
      />
      {inlineListFill && suggestions.length === 0 && !disabled && (
        <div style={{
          flex: 1, minHeight: 120, marginTop: 8, padding: '12px 10px',
          border: `1px dashed ${theme.border}`, borderRadius: 10,
          fontFamily: theme.sans, fontSize: 12, color: theme.muted,
          display: 'flex', alignItems: 'flex-start',
        }}>
          {q.length >= 2 ? 'No places found — try a different search' : 'Type at least 2 characters to search Google Places'}
        </div>
      )}
      {suggestions.length > 0 && !disabled && (
        <div style={listStyle}>
          {suggestions.map((row) => (
            <button
              key={row.placeId}
              type="button"
              onClick={() => { onPick(row); setSuggestions([]); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none',
                border: 'none', borderBottom: `1px solid ${theme.border}`, cursor: 'pointer',
                fontFamily: theme.sans, fontSize: 13, color: theme.text,
              }}
            >
              <div style={{ fontWeight: 600 }}>{row.name}</div>
              {row.address ? <div style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>{row.address}</div> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddBranchSheet({ open, theme, brandId, onClose, onSaved }) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [placeId, setPlaceId] = React.useState(null);
  const [placeName, setPlaceName] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [coords, setCoords] = React.useState({ lat: null, lng: null });
  const [address, setAddress] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setSearchQuery('');
    setPlaceId(null);
    setPlaceName('');
    setDisplayName('');
    setCoords({ lat: null, lng: null });
    setAddress('');
    setSaving(false);
    setError('');
  }, [open, brandId]);

  if (!open) return null;

  const pickSuggestion = (row) => {
    const name = String(row.name || '').trim();
    const addr = String(row.address || '').trim();
    setPlaceName(name);
    setDisplayName(name);
    setAddress(addr);
    setSearchQuery(addr || name);
    setPlaceId(row.placeId || null);
    setCoords({
      lat: typeof row.lat === 'number' ? row.lat : null,
      lng: typeof row.lng === 'number' ? row.lng : null,
    });
  };

  const submit = async () => {
    if (!placeId) { setError('Pick a location from search'); return; }
    if (!window.V2Live?.addBranchToBrand) { setError('Not available'); return; }
    const resolvedName = displayName.trim() || placeName.trim() || 'Location';
    setSaving(true);
    setError('');
    try {
      await window.V2Live.addBranchToBrand(brandId, {
        placeId,
        name: resolvedName,
        address,
        lat: coords.lat,
        lng: coords.lng,
      });
      onSaved?.();
    } catch (e) {
      setError(e?.message || 'Could not add location');
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 140, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }} onClick={() => { if (!saving) onClose(); }}>
      <div style={{
        width: '100%', maxWidth: 540, margin: '0 auto', background: theme.card,
        borderTopLeftRadius: 18, borderTopRightRadius: 18,
        border: `1px solid ${theme.border}`, borderBottom: 'none',
        height: '92vh', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        padding: '18px 18px max(24px, env(safe-area-inset-bottom))',
        boxSizing: 'border-box',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexShrink: 0 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 700, color: theme.text }}>Add location</div>
          <button type="button" disabled={saving} onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: theme.muted, cursor: saving ? 'not-allowed' : 'pointer', padding: '0 2px', lineHeight: 1, opacity: saving ? 0.35 : 1 }}>&times;</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', opacity: saving ? 0.55 : 1, pointerEvents: saving ? 'none' : 'auto' }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, flexShrink: 0 }}>Search</div>
          <PlaceSearchField
            theme={theme}
            searchTerm={searchQuery}
            onSearchChange={(v) => { setSearchQuery(v); setPlaceId(null); setPlaceName(''); setDisplayName(''); setCoords({ lat: null, lng: null }); setAddress(''); }}
            onPick={pickSuggestion}
            disabled={saving}
            inlineList
            inlineListFill
          />
        </div>

        {placeId && (
          <div style={{ flexShrink: 0, marginTop: 12, opacity: saving ? 0.55 : 1 }}>
            {address && (
              <div style={{ marginBottom: 12, fontFamily: theme.sans, fontSize: 12, color: theme.muted, lineHeight: 1.4 }}>
                {shortAddress(address)}
              </div>
            )}
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Display name</div>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={saving}
                placeholder={placeName || 'Location name'}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface2, fontFamily: theme.sans, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          </div>
        )}

        {error && <div style={{ flexShrink: 0, fontFamily: theme.sans, fontSize: 12, color: '#c44', marginTop: 10 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${theme.border}` }}>
          <button type="button" onClick={onClose} disabled={saving} style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface2, fontFamily: theme.sans, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', color: theme.text, opacity: saving ? 0.5 : 1 }}>Cancel</button>
          <button type="button" onClick={submit} disabled={saving || !placeId} style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: theme.accent, color: theme.onAccent || '#fff', fontFamily: theme.sans, fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', opacity: (saving || !placeId) ? 0.65 : 1 }}>
            {saving ? 'Adding…' : 'Add location'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditBranchModal({ open, theme, branch, brand, onClose, onSaved, onDeleted }) {
  const [name, setName] = React.useState('');
  const [hoursOverride, setHoursOverride] = React.useState('');
  const [tags, setTags] = React.useState([]);
  const [showTagPicker, setShowTagPicker] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState('');
  const busy = saving || deleting;

  React.useEffect(() => {
    if (!open || !branch) return;
    setName(branch.name || '');
    setHoursOverride(branch.hoursOverride || '');
    setTags(Array.isArray(branch.locationTags) ? branch.locationTags : []);
    setShowTagPicker(false);
    setSaving(false);
    setDeleting(false);
    setError('');
  }, [open, branch?.id, branch?.name, branch?.hoursOverride, branch?.locationTags]);

  if (!open || !branch) return null;

  const submit = async () => {
    if (!window.V2Live?.updateBranchDetails) { setError('Not available'); return; }
    setSaving(true);
    setError('');
    try {
      await window.V2Live.updateBranchDetails(branch.id, {
        name: name.trim(),
        hoursOverride: hoursOverride.trim() || null,
        locationTags: tags,
      });
      onSaved?.();
    } catch (e) {
      setError(e?.message || 'Failed to save');
      setSaving(false);
    }
  };

  const removeLocation = async () => {
    if (!brand?.id || !branch?.id) return;
    if (!window.confirm(`Remove "${branch.name}" from ${brand.name}?`)) return;
    if (!window.V2Live?.removeBranchFromBrand) { setError('Not available'); return; }
    setDeleting(true);
    setError('');
    try {
      await window.V2Live.removeBranchFromBrand(brand.id, branch.id);
      if (onDeleted) onDeleted();
      else onSaved?.();
    } catch (e) {
      setError(e?.message || 'Could not remove location');
      setDeleting(false);
    }
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }} onClick={() => { if (!busy) onClose(); }}>
        <div style={{ width: '100%', maxWidth: 540, margin: '0 auto', background: theme.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, border: `1px solid ${theme.border}`, borderBottom: 'none', padding: '18px 18px 24px', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 700, color: theme.text }}>Edit location</div>
            <button type="button" disabled={busy} onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: theme.muted, cursor: busy ? 'not-allowed' : 'pointer', padding: '0 2px', lineHeight: 1, opacity: busy ? 0.35 : 1 }}>&times;</button>
          </div>
          {branch.address && (
            <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginBottom: 14, lineHeight: 1.4 }}>
              {shortAddress(branch.address)}
            </div>
          )}
          <div style={{ marginBottom: 12, opacity: busy ? 0.55 : 1 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Display name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} placeholder="Location name" style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface2, fontFamily: theme.sans, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 12, opacity: busy ? 0.55 : 1 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Hours note</div>
            <input value={hoursOverride} onChange={(e) => setHoursOverride(e.target.value)} disabled={busy} placeholder="e.g. Open until 10 PM on weekends" style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface2, fontFamily: theme.sans, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 14, opacity: busy ? 0.55 : 1 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Location tags</div>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {tags.map((tag) => (
                  <span key={tag} style={{ padding: '4px 10px', borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.surface2, fontFamily: theme.sans, fontSize: 11, color: theme.text }}>{tag}</span>
                ))}
              </div>
            )}
            <button type="button" disabled={busy} onClick={() => setShowTagPicker(true)} style={{ border: `1px dashed ${theme.border}`, borderRadius: 999, padding: '5px 11px', background: 'transparent', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: theme.sans, fontSize: 11.5, color: theme.muted }}>
              Edit tags
            </button>
          </div>
          {error && <div style={{ fontFamily: theme.sans, fontSize: 12, color: '#c44', marginBottom: 10 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={removeLocation} disabled={busy} style={{ padding: '9px 12px', borderRadius: 10, border: 'none', background: 'transparent', fontFamily: theme.sans, fontSize: 13, fontWeight: 600, color: '#c44', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }}>
              {deleting ? 'Removing…' : 'Delete location'}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onClose} disabled={busy} style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface2, fontFamily: theme.sans, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer', color: theme.text, opacity: busy ? 0.5 : 1 }}>Cancel</button>
              <button type="button" onClick={submit} disabled={busy} style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: theme.accent, color: theme.onAccent || '#fff', fontFamily: theme.sans, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.65 : 1 }}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      </div>
      <TagPickerModal
        open={showTagPicker}
        theme={theme}
        selectedTags={tags}
        onClose={() => setShowTagPicker(false)}
        onSave={(next) => { setTags(next); setShowTagPicker(false); }}
      />
    </>
  );
}

function AddOrEditBrandModal({ open, theme, brand = null, onClose, onSaved, onArchived }) {
  const editing = Boolean(brand?.id);
  const [name, setName] = React.useState('');
  const [thumbFile, setThumbFile] = React.useState(null);
  const [thumbPreview, setThumbPreview] = React.useState(null);
  const [logoRemoved, setLogoRemoved] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [branchRows, setBranchRows] = React.useState([]);
  const [showAddBranch, setShowAddBranch] = React.useState(false);
  const [editingBranch, setEditingBranch] = React.useState(null);
  const [branchBusy, setBranchBusy] = React.useState(false);
  const [branchPhotos, setBranchPhotos] = React.useState({});
  const [socialLinks, setSocialLinks] = React.useState({ instagram: '' });
  const fileRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    setName(editing ? (brand?.name || '') : '');
    setThumbFile(null);
    setThumbPreview(editing && brand?.logoUrl ? brand.logoUrl : null);
    setLogoRemoved(false);
    setSocialLinks({
      instagram: brand?.socialLinks?.instagram || '',
    });
    setError('');
    setSaving(false);
    setArchiving(false);
    setShowAddBranch(false);
    setEditingBranch(null);
    setBranchBusy(false);
    setBranchPhotos({});
    if (fileRef.current) fileRef.current.value = '';
  }, [open, editing, brand?.id, brand?.name, brand?.logoUrl, brand?.socialLinks]);

  React.useEffect(() => {
    if (!open || !editing || !brand?.id) return;
    const sync = () => {
      const b = (Array.isArray(window.BRANDS) ? window.BRANDS : []).find((x) => x.id === brand.id);
      setBranchRows(b?.branches || brand?.branches || []);
    };
    sync();
    window.addEventListener('v2:data-updated', sync);
    return () => window.removeEventListener('v2:data-updated', sync);
  }, [open, editing, brand?.id, brand?.branches]);

  React.useEffect(() => {
    if (!open || !editing || !window.V2Live?.getPlacePhoto) return;
    let active = true;
    async function hydrateBranchPhotos() {
      for (const br of branchRows) {
        if (!br?.id || !br?.placeId || br.photoUrl || branchPhotos[br.id]) continue;
        const photo = await window.V2Live.getPlacePhoto(br.placeId, true).catch(() => null);
        if (active && photo) {
          setBranchPhotos((prev) => (prev[br.id] ? prev : { ...prev, [br.id]: photo }));
        }
      }
    }
    hydrateBranchPhotos();
    return () => { active = false; };
  }, [open, editing, branchRows, branchPhotos]);

  if (!open) return null;

  const pickFile = () => { if (!saving) fileRef.current?.click(); };
  const onFileChange = (e) => {
    const f = e.target?.files?.[0] || null;
    if (!f || saving) return;
    setThumbFile(f);
    setThumbPreview(URL.createObjectURL(f));
    setLogoRemoved(false);
  };
  const removeThumb = () => {
    if (saving) return;
    setThumbFile(null);
    setThumbPreview(null);
    setLogoRemoved(true);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeBranch = async (cafeId) => {
    if (!editing || branchBusy || saving) return;
    if (!window.confirm(`Remove this location from ${brand.name}?`)) return;
    setBranchBusy(true);
    setError('');
    try {
      await window.V2Live.removeBranchFromBrand(brand.id, cafeId);
    } catch (e) {
      setError(e?.message || 'Could not remove branch');
    } finally {
      setBranchBusy(false);
    }
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Enter a brand name'); return; }
    if (editing && !window.V2Live?.updateBrand) { setError('Not available'); return; }
    if (!editing && !window.V2Live?.addBrand) { setError('Not available'); return; }
    setSaving(true); setError('');
    try {
      if (editing) {
        await window.V2Live.updateBrand({
          brandId: brand.id,
          name: trimmed,
          logoFile: thumbFile,
          removeLogo: logoRemoved && !thumbFile,
          socialLinks,
        });
        onSaved?.(brand.id);
      } else {
        const newId = await window.V2Live.addBrand({ name: trimmed, logoFile: thumbFile, socialLinks });
        onSaved?.(newId);
      }
    } catch (e) {
      setError(e?.message || (editing ? 'Failed to update brand' : 'Failed to add brand'));
      setSaving(false);
    }
  };

  const archiveBrand = async () => {
    if (!editing || archiving || saving || branchBusy) return;
    if (!window.confirm(`Archive "${brand.name}"?\n\nIt will be hidden from the gallery. Posts and locations stay saved and can be restored later.`)) return;
    if (!window.V2Live?.archiveBrand) { setError('Not available'); return; }
    setArchiving(true);
    setError('');
    try {
      await window.V2Live.archiveBrand(brand.id);
      if (onArchived) onArchived();
      else onClose?.();
    } catch (e) {
      setError(e?.message || 'Could not archive brand');
      setArchiving(false);
    }
  };

  const locked = saving || branchBusy || archiving;

  return (
    <>
    <div style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-end' }} onClick={() => { if (!locked) onClose(); }}>
      <div style={{ width: '100%', maxWidth: 540, margin: '0 auto', background: theme.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, border: `1px solid ${theme.border}`, borderBottom: 'none', padding: '18px 18px 24px', maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 700, color: theme.text }}>{editing ? 'Edit brand' : 'Add brand'}</div>
          <button type="button" disabled={locked} onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: theme.muted, cursor: locked ? 'not-allowed' : 'pointer', padding: '0 2px', lineHeight: 1, opacity: locked ? 0.35 : 1 }}>&times;</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 16, opacity: locked ? 0.55 : 1, pointerEvents: locked ? 'none' : 'auto' }}>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFileChange} />
          <button type="button" onClick={pickFile} style={{
            width: 80, height: 80, borderRadius: 14, border: `2px dashed ${thumbPreview ? 'transparent' : theme.border}`,
            background: theme.surface2, cursor: 'pointer', overflow: 'hidden', position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          }}>
            {thumbPreview ? (
              <img src={thumbPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: theme.muted, fontSize: 10, fontFamily: theme.sans }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                Thumbnail
              </div>
            )}
          </button>
          {thumbPreview && (
            <button type="button" onClick={removeThumb} style={{ background: 'none', border: 'none', color: '#c44', fontSize: 11, fontFamily: theme.sans, cursor: 'pointer', padding: 0 }}>Remove</button>
          )}
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Brand name"
          autoFocus={!editing}
          disabled={locked}
          style={{
            width: '100%', padding: '10px 12px', border: `1px solid ${theme.border}`, borderRadius: 10,
            fontFamily: theme.sans, fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: editing ? 12 : 14,
            opacity: locked ? 0.55 : 1,
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !locked) submit(); }}
        />

        <div style={{ marginBottom: editing ? 12 : 14, opacity: locked ? 0.55 : 1, pointerEvents: locked ? 'none' : 'auto' }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
            Instagram
          </div>
          <input
            value={socialLinks.instagram || ''}
            onChange={(e) => setSocialLinks({ instagram: e.target.value })}
            placeholder="@handle or URL"
            disabled={locked}
            style={{
              width: '100%', padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: 10,
              fontFamily: theme.sans, fontSize: 13, outline: 'none', boxSizing: 'border-box',
              background: theme.surface2, color: theme.text,
            }}
          />
        </div>

        {editing && (
          <div style={{ marginBottom: 14, opacity: locked ? 0.55 : 1, pointerEvents: locked ? 'none' : 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Locations{branchRows.length ? ` (${branchRows.length})` : ''}
              </div>
              <button type="button" disabled={locked} onClick={() => setShowAddBranch(true)} style={{ background: theme.accentLight, border: `1px solid ${theme.border}`, borderRadius: 999, padding: '4px 10px', cursor: locked ? 'not-allowed' : 'pointer', fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.accent }}>
                + Add location
              </button>
            </div>
            <div style={{ maxHeight: 'min(32vh, 220px)', overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingRight: 2 }}>
              {branchRows.length === 0 ? (
                <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, padding: '8px 2px' }}>No locations yet. Search Google to add one.</div>
              ) : (
                branchRows.map((br) => (
                  <div key={br.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    border: `1px solid ${theme.border}`, borderRadius: 12, padding: '9px 10px',
                    background: theme.surface2, marginBottom: 8,
                  }}>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => setEditingBranch(br)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: locked ? 'not-allowed' : 'pointer', textAlign: 'left' }}
                    >
                      <div style={{ width: 40, height: 40, borderRadius: 9, overflow: 'hidden', background: theme.card, flexShrink: 0 }}>
                        {(branchPhotos[br.id] || br.photoUrl) ? (
                          <img src={branchPhotos[br.id] || br.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <Placeholder label="" hue={brand?.hue || 120} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>{br.name}</div>
                        <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {shortAddress(br.address || br.neighborhood || 'No address')}
                        </div>
                      </div>
                    </button>
                    <button type="button" disabled={locked} onClick={() => removeBranch(br.id)} aria-label={`Remove ${br.name}`} style={{ background: 'none', border: 'none', padding: 6, cursor: locked ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
                      <IconClose size={16} stroke={theme.muted} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {error && <div style={{ fontFamily: theme.sans, fontSize: 12, color: '#c44', marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          {editing ? (
            <button type="button" onClick={archiveBrand} disabled={locked} style={{
              padding: '9px 12px', borderRadius: 10, border: 'none', background: 'transparent',
              fontFamily: theme.sans, fontSize: 13, fontWeight: 600, color: '#c44',
              cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.5 : 1,
            }}>
              {archiving ? 'Archiving…' : 'Archive brand'}
            </button>
          ) : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} disabled={locked} style={{
              padding: '9px 16px', borderRadius: 10, border: `1px solid ${theme.border}`,
              background: theme.surface2, fontFamily: theme.sans, fontSize: 13, cursor: locked ? 'not-allowed' : 'pointer', color: theme.text,
              opacity: locked ? 0.5 : 1,
            }}>Cancel</button>
            <button type="button" onClick={submit} disabled={locked} style={{
              padding: '9px 16px', borderRadius: 10, border: 'none',
              background: theme.accent, color: theme.onAccent || '#fff', fontFamily: theme.sans, fontSize: 13, fontWeight: 600,
              cursor: locked ? 'wait' : 'pointer', opacity: locked ? 0.65 : 1,
            }}>{saving ? 'Saving…' : (editing ? 'Save changes' : 'Add brand')}</button>
          </div>
        </div>
      </div>
    </div>
    {editing && showAddBranch ? (
      <AddBranchSheet
        open={showAddBranch}
        theme={theme}
        brandId={brand.id}
        onClose={() => setShowAddBranch(false)}
        onSaved={() => setShowAddBranch(false)}
      />
    ) : null}
    {editing && editingBranch ? (
      <EditBranchModal
        open={Boolean(editingBranch)}
        theme={theme}
        branch={editingBranch}
        brand={brand}
        onClose={() => setEditingBranch(null)}
        onSaved={() => setEditingBranch(null)}
        onDeleted={() => setEditingBranch(null)}
      />
    ) : null}
    </>
  );
}

function BrandsScreen({ theme, onOpenBrand }) {
  const [filter, setFilter] = React.useState('all');
  const [brandPhotos, setBrandPhotos] = React.useState({});
  const [showAddModal, setShowAddModal] = React.useState(false);
  const filtered = BRANDS.filter(b =>
    filter === 'all' ? true :
    filter === 'cafe' ? b.kind === 'cafe' :
    filter === 'popup' ? b.kind === 'popup' :
    b.kind === 'home'
  );
  const sorted = filter === 'all'
    ? [
      ...filtered.filter((b) => b.kind !== 'popup'),
      ...filtered.filter((b) => b.kind === 'popup'),
    ]
    : filtered;

  React.useEffect(() => {
    let active = true;
    async function hydrateBrandPlacePhotos() {
      if (!window.V2Live?.getPlacePhoto) return;
      for (const brand of BRANDS) {
        if (!active) return;
        if (brand.logoUrl) continue;
        const branch = (brand.branches || []).find((br) => br?.placeId) || null;
        if (!branch?.placeId) continue;
        if (branch.photoUrl) {
          setBrandPhotos((prev) => (prev[brand.id] ? prev : { ...prev, [brand.id]: branch.photoUrl }));
          continue;
        }
        const photoUrl = await window.V2Live.getPlacePhoto(branch.placeId, false).catch(() => null);
        if (!active || !photoUrl) continue;
        setBrandPhotos((prev) => (prev[brand.id] ? prev : { ...prev, [brand.id]: photoUrl }));
      }
    }
    hydrateBrandPlacePhotos();
    const onDataUpdated = () => { hydrateBrandPlacePhotos(); };
    window.addEventListener('v2:data-updated', onDataUpdated);
    return () => {
      active = false;
      window.removeEventListener('v2:data-updated', onDataUpdated);
    };
  }, []);

  const Header = window.AppBrandHeader;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      {Header ? <Header theme={theme} /> : null}
      <div style={{ padding: '14px 16px 0', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 24, fontWeight: 600, color: theme.text, letterSpacing: -0.3 }}>Brands</div>
          <button type="button" onClick={() => setShowAddModal(true)} style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
            background: theme.accent, color: '#fff', border: 'none', borderRadius: 999,
            fontFamily: theme.sans, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" fill="none"><path d="M12 5v14M5 12h14"/></svg>
            Add
          </button>
        </div>
        <div style={{ display: 'flex' }}>
          {[['all','All'],['cafe','Cafes'],['popup','Pop-ups'],['home','Home']].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} style={{
              flex: 1, padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: theme.sans, fontSize: 13,
              fontWeight: filter === id ? 600 : 400,
              color: filter === id ? theme.text : theme.muted,
              borderBottom: `2px solid ${filter === id ? theme.accent : 'transparent'}`,
            }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 100px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {sorted.map(b => {
            const brandPosts = POSTS.filter(p => p.brandId === b.id);
            const postCount = brandPosts.length;
            const latestPostPhoto = brandPosts.length > 0
              ? (brandPosts.find(p => p.photos && p.photos.length > 0)?.photos?.[0] || null)
              : null;
            const tilePhoto = brandGalleryTilePhoto(b, brandPhotos, latestPostPhoto);
            return (
              <button
                key={b.id}
                onClick={() => onOpenBrand(b.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'grid',
                  gridTemplateRows: 'auto auto auto',
                  gap: 6,
                  alignContent: 'start',
                }}>
                <div style={{ aspectRatio: '1/1', width: '100%', borderRadius: 14, overflow: 'hidden', position: 'relative' }}>
                  {tilePhoto ? (
                    <img src={tilePhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Placeholder label="" hue={b.hue} style={{ borderRadius: 0 }} />
                  )}
                  {postCount > 0 && (
                    <div style={{ position: 'absolute', bottom: 6, right: 6, width: 20, height: 20, borderRadius: '50%', background: theme.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5 11-12"/></svg>
                    </div>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: theme.text,
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>{b.name}</div>
                <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, fontWeight: 400, lineHeight: 1.2 }}>
                  {postCount > 0 ? `${postCount} post${postCount > 1 ? 's' : ''}` : 'Not visited'}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <AddOrEditBrandModal
        open={showAddModal}
        theme={theme}
        onClose={() => setShowAddModal(false)}
        onSaved={(newId) => {
          setShowAddModal(false);
          if (newId && onOpenBrand) onOpenBrand(newId);
        }}
      />
    </div>
  );
}

// Shared thumbnail card for brand/branch detail pages
function PostThumbCard({ post, brand, theme, onOpen }) {
  return (
    <button onClick={onOpen} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginBottom: 10 }}>
      <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ height: 150 }}>
          {post.photos && post.photos[0] ? (
            <img src={post.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Placeholder label="" hue={brand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
          )}
        </div>
        <div style={{ padding: '11px 13px' }}>
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted }}>{post.location} · {post.date}</div>
          </div>
          {post.caption && (
            <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.text, lineHeight: 1.4, marginBottom: post.drinks.length ? 8 : 0 }}>{post.caption}</div>
          )}
          {post.drinks.length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {post.drinks.map(d => (
                <span key={d.id} style={{ padding: '3px 8px', borderRadius: 999, background: theme.surface2, color: theme.muted, fontFamily: theme.sans, fontSize: 11, fontWeight: 400 }}>{d.name}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function PostHereBtn({ onClick, theme }) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 13px', background: theme.accent, color: '#fff',
      border: 'none', borderRadius: 999, cursor: 'pointer',
      fontFamily: theme.sans, fontSize: 13, fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
    }}>
      <svg width="11" height="11" viewBox="0 0 24 24" stroke="#fff" strokeWidth="2.8" strokeLinecap="round">
        <path d="M12 5v14M5 12h14"/>
      </svg>
      Post
    </button>
  );
}

function EmptyMsg({ label, theme }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', fontFamily: theme.sans, fontSize: 14, color: theme.muted }}>
      {label}
    </div>
  );
}

const SUGGESTED_LOCATION_TAGS = ['WiFi', 'Outlets', 'Parking', 'Pet-friendly', '24/7'];

function todayHoursLine(weekdayText) {
  if (!Array.isArray(weekdayText) || weekdayText.length === 0) return '';
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const day = dayNames[new Date().getDay()];
  const line = weekdayText.find((entry) => String(entry || '').toLowerCase().startsWith(day.toLowerCase()));
  return line || '';
}

function formatHoursSummary(details, hoursOverride) {
  const custom = String(hoursOverride || '').trim();
  if (custom) return custom;
  const today = todayHoursLine(details?.weekdayText);
  if (today) return today;
  return String(details?.openStatus || '').trim();
}

function deriveGoogleLocationTags(details) {
  const tags = [];
  const push = (value) => {
    if (!value) return;
    if (!tags.includes(value)) tags.push(value);
  };
  const weekdayText = Array.isArray(details?.weekdayText) ? details.weekdayText : [];
  if (weekdayText.some((line) => /open 24 hours/i.test(String(line || '')))) push('24/7');
  const types = Array.isArray(details?.placeTypes) ? details.placeTypes.map((t) => String(t || '').toLowerCase()) : [];
  if (types.includes('meal_takeaway')) push('Takeout');
  if (types.includes('meal_delivery')) push('Delivery');
  return tags;
}

function mergedLocationTags(branch, details) {
  const out = [];
  const seen = new Set();
  const append = (value) => {
    const cleaned = String(value || '').trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  };
  (Array.isArray(branch?.locationTags) ? branch.locationTags : []).forEach(append);
  deriveGoogleLocationTags(details).forEach(append);
  return out;
}

function shortAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const plusCodePattern = /^[A-Z0-9]{2,8}\+[A-Z0-9]{2,8}$/i;
  const cleanedParts = (parts.length > 0 && plusCodePattern.test(parts[0])) ? parts.slice(1) : parts;
  if (cleanedParts.length === 0) return '';
  if (cleanedParts.length <= 3) return cleanedParts.join(', ');
  const withoutCountry = cleanedParts.filter((p) => p.toLowerCase() !== 'philippines');
  return withoutCountry.slice(0, 3).join(', ');
}

function brandMetaLabel(brand, branchCount) {
  const kind = brand?.kind === 'home'
    ? 'Home'
    : brand?.kind === 'popup'
      ? 'Pop-up'
      : 'Cafe';
  if (!branchCount) return kind;
  return `${kind} · ${branchCount} ${branchCount === 1 ? 'Location' : 'Locations'}`;
}

function brandActivityLabel(postCount, eventCount) {
  const parts = [];
  const posts = Number(postCount) || 0;
  const events = Number(eventCount) || 0;
  if (posts > 0) parts.push(`${posts} post${posts === 1 ? '' : 's'}`);
  if (events > 0) parts.push(`${events} upcoming event${events === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function BrandFavoriteButton({ theme, hearted, onToggle, ariaLabel }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel || (hearted ? 'Remove from favorites' : 'Favorite brand')}
      onClick={onToggle}
      style={{
        background: 'none',
        border: 'none',
        padding: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <IconHeart size={22} stroke={hearted ? theme.accent : theme.muted} fill={hearted ? theme.accent : 'none'} sw={1.9} />
    </button>
  );
}

function BrandActivityLine({ theme, postCount, eventCount }) {
  const label = brandActivityLabel(postCount, eventCount);
  if (!label) return null;
  return (
    <div style={{ marginTop: 6, fontFamily: theme.sans, fontSize: 12, color: theme.text, fontWeight: 500 }}>
      {label}
    </div>
  );
}

function BrandInstagramLink({ theme, links }) {
  const url = String(links?.instagram || '').trim();
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Instagram"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        padding: 2,
        marginTop: 1,
        textDecoration: 'none',
      }}
    >
      <IconInstagram size={16} stroke={theme.muted} sw={1.7} />
    </a>
  );
}

function TagPickerModal({ open, theme, selectedTags, onClose, onSave }) {
  const [draft, setDraft] = React.useState(selectedTags || []);
  const [customTag, setCustomTag] = React.useState('');

  React.useEffect(() => {
    if (open) setDraft(Array.isArray(selectedTags) ? selectedTags : []);
  }, [open, selectedTags]);

  if (!open) return null;

  const hasTag = (tag) => draft.some((t) => String(t).toLowerCase() === String(tag).toLowerCase());
  const toggleTag = (tag) => {
    if (!tag) return;
    if (hasTag(tag)) {
      setDraft((prev) => prev.filter((t) => String(t).toLowerCase() !== String(tag).toLowerCase()));
      return;
    }
    setDraft((prev) => [...prev, tag]);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', maxWidth: 540, margin: '0 auto', background: theme.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, border: `1px solid ${theme.border}`, borderBottom: 'none', padding: 16 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 700, color: theme.text, marginBottom: 10 }}>Select location tags</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {SUGGESTED_LOCATION_TAGS.map((tag) => {
            const active = hasTag(tag);
            return (
              <button
                key={`modal-${tag}`}
                type="button"
                onClick={() => toggleTag(tag)}
                style={{
                  border: `1px solid ${active ? theme.accent : theme.border}`,
                  borderRadius: 999,
                  padding: '6px 12px',
                  background: active ? theme.accentLight : theme.surface2,
                  color: active ? theme.accent : theme.text,
                  fontFamily: theme.sans,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {tag}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            value={customTag}
            onChange={(e) => setCustomTag(e.target.value)}
            placeholder="Custom tag"
            style={{ flex: 1, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '8px 10px', fontFamily: theme.sans, fontSize: 13, outline: 'none' }}
          />
          <button
            type="button"
            onClick={() => {
              const value = String(customTag || '').trim();
              if (!value) return;
              toggleTag(value);
              setCustomTag('');
            }}
            style={{ border: `1px solid ${theme.border}`, borderRadius: 10, padding: '8px 12px', background: theme.surface2, fontFamily: theme.sans, fontSize: 12, cursor: 'pointer' }}
          >
            Add
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ border: `1px solid ${theme.border}`, borderRadius: 10, padding: '8px 12px', background: theme.surface2, fontFamily: theme.sans, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={() => onSave(draft)} style={{ border: 'none', borderRadius: 10, padding: '8px 12px', background: theme.accent, color: theme.onAccent || '#fff', fontFamily: theme.sans, fontSize: 12, cursor: 'pointer' }}>Save tags</button>
        </div>
      </div>
    </div>
  );
}

// Brand detail — unified profile-style summary
function BrandDetailScreen({ theme, brandId, onBack, onOpenPost, onPost, onViewAllPosts, onOpenBranch, onViewAllEvents, onOpenEvent }) {
  const brand = BRANDS.find(b => b.id === brandId) || BRANDS[0] || FALLBACK_BRAND;
  const brandPosts = POSTS.filter(p => p.brandId === brand.id);
  const branches = brand.branches || [];
  const brandEvents = window.eventsForBrand ? window.eventsForBrand(brand.id) : [];
  const eventBuckets = window.partitionEvents ? window.partitionEvents(brandEvents) : { ongoing: [], upcoming: [], past: [], activeUpcoming: [] };
  const isSingleBranchBrand = branches.length === 1;
  const [showAddEvent, setShowAddEvent] = React.useState(false);
  const [showEditBrand, setShowEditBrand] = React.useState(false);
  const [, refreshTick] = React.useState(0);
  const EventFormModal = window.EventFormModal;
  const [heroPhoto, setHeroPhoto] = React.useState(null);
  const [heroDetails, setHeroDetails] = React.useState(null);
  const [branchDetails, setBranchDetails] = React.useState({});
  const [branchPhotos, setBranchPhotos] = React.useState({});
  const [heartedBrand, setHeartedBrand] = React.useState(false);
  const [singleLocationTags, setSingleLocationTags] = React.useState([]);
  const [showSingleTagModal, setShowSingleTagModal] = React.useState(false);
  const [savingSingleTags, setSavingSingleTags] = React.useState(false);
  const primaryBranch = branches[0] || null;

  React.useEffect(() => {
    const h = () => refreshTick((x) => x + 1);
    window.addEventListener('v2:data-updated', h);
    return () => window.removeEventListener('v2:data-updated', h);
  }, []);

  React.useEffect(() => {
    const syncHeart = () => {
      if (window.V2Live?.isBrandLiked) setHeartedBrand(window.V2Live.isBrandLiked(brand.id));
    };
    syncHeart();
    window.addEventListener('v2:likes-updated', syncHeart);
    window.addEventListener('v2:data-updated', syncHeart);
    return () => {
      window.removeEventListener('v2:likes-updated', syncHeart);
      window.removeEventListener('v2:data-updated', syncHeart);
    };
  }, [brand.id]);

  React.useEffect(() => {
    let active = true;
    async function loadHeroPhoto() {
      const branchWithPhoto = (branches || []).find((br) => br?.photoUrl);
      const branchWithPlace = (branches || []).find((br) => br?.placeId);

      if (branchWithPhoto?.photoUrl) setHeroPhoto(branchWithPhoto.photoUrl);
      else if (primaryBranch?.id && branchPhotos[primaryBranch.id]) setHeroPhoto(branchPhotos[primaryBranch.id]);
      else if (branchWithPlace?.placeId && window.V2Live?.getPlacePhoto) {
        const photo = await window.V2Live.getPlacePhoto(branchWithPlace.placeId, false).catch(() => null);
        if (active && photo) setHeroPhoto(photo);
      } else setHeroPhoto(null);

      // We still load place details for hours/open status/tags.
      if (branchWithPlace?.placeId && window.V2Live?.getPlaceDetails) {
        const details = await window.V2Live.getPlaceDetails(branchWithPlace.placeId, false).catch(() => null);
        if (active && details) setHeroDetails(details);
      }
    }
    setHeroPhoto(null);
    setHeroDetails(null);
    loadHeroPhoto();
    return () => { active = false; };
  }, [brand.id, branches, branchPhotos, primaryBranch?.id, primaryBranch?.photoUrl]);

  React.useEffect(() => {
    let active = true;
    async function hydrateBranchDetails() {
      if (!window.V2Live?.getPlaceDetails) return;
      for (const branch of branches) {
        if (!branch?.id || !branch?.placeId) continue;
        const details = await window.V2Live.getPlaceDetails(branch.placeId, true).catch(() => null);
        if (!active) return;
        if (details) {
          setBranchDetails((prev) => (prev[branch.id] ? prev : { ...prev, [branch.id]: details }));
        }
        if (!branch.photoUrl && !details?.photoUrl && window.V2Live?.getPlacePhoto) {
          const photo = await window.V2Live.getPlacePhoto(branch.placeId, true).catch(() => null);
          if (active && photo) {
            setBranchPhotos((prev) => (prev[branch.id] ? prev : { ...prev, [branch.id]: photo }));
          }
        }
      }
    }
    hydrateBranchDetails();
    return () => { active = false; };
  }, [branches]);

  const heroGoogleRating = Number(heroDetails?.rating) || 0;
  const heroGoogleReviews = Number(heroDetails?.userRatingCount) || 0;
  const heroAddress = (primaryBranch?.address || primaryBranch?.neighborhood || '').trim();
  const heroHoursSummary = formatHoursSummary(heroDetails, primaryBranch?.hoursOverride);
  const heroLocationTags = mergedLocationTags(primaryBranch, heroDetails);

  React.useEffect(() => {
    setSingleLocationTags(Array.isArray(primaryBranch?.locationTags) ? primaryBranch.locationTags : []);
  }, [primaryBranch?.id, primaryBranch?.locationTags]);

  const saveSingleBranchTags = React.useCallback(async (nextTags) => {
    if (!primaryBranch?.id || !window.V2Live?.setLocationTags) return;
    const clean = Array.isArray(nextTags) ? nextTags.map((x) => String(x || '').trim()).filter(Boolean) : [];
    setSingleLocationTags(clean);
    setSavingSingleTags(true);
    try {
      await window.V2Live.setLocationTags(primaryBranch.id, clean);
    } finally {
      setSavingSingleTags(false);
    }
  }, [primaryBranch?.id]);

  const allSingleBranchTags = React.useMemo(() => {
    const merged = [];
    const seen = new Set();
    [...singleLocationTags, ...deriveGoogleLocationTags(heroDetails)].forEach((tag) => {
      const cleaned = String(tag || '').trim();
      if (!cleaned) return;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(cleaned);
    });
    return merged;
  }, [singleLocationTags, heroDetails]);

  const useCoverLayout = isSingleBranchBrand;
  const showLogoBesideDetails = isSingleBranchBrand && Boolean(brand.logoUrl);
  const activeEventCount = (eventBuckets.activeUpcoming || []).length;
  const toggleBrandFavorite = async () => {
    const next = !heartedBrand;
    setHeartedBrand(next);
    try {
      await window.V2Live?.setBrandLike?.(brand.id, next);
    } catch {
      setHeartedBrand(!next);
    }
  };

  const brandCardText = (showKindMeta) => (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: theme.sans, fontSize: 19, fontWeight: 600, color: theme.text }}>{brand.name}</div>
        <BrandInstagramLink theme={theme} links={brand.socialLinks} />
      </div>
      {showKindMeta && (
        <div style={{ marginTop: 3, fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>
          {brandMetaLabel(brand, branches.length)}
        </div>
      )}
      <BrandActivityLine theme={theme} postCount={brandPosts.length} eventCount={activeEventCount} />
    </>
  );

  const singleBranchDetailBlock = (
    <>
      {heroAddress && (
        <div style={{ marginTop: 3, fontFamily: theme.sans, fontSize: 12, color: theme.muted, lineHeight: 1.35 }}>
          {shortAddress(heroAddress)}
        </div>
      )}
      {(heroGoogleRating > 0 && heroGoogleReviews > 0) && (
        <div style={{ marginTop: 4, fontFamily: theme.sans, fontSize: 12, color: theme.text, fontWeight: 600, lineHeight: 1.35 }}>
          {heroGoogleRating.toFixed(1)} · {heroGoogleReviews.toLocaleString()} Google reviews
        </div>
      )}
      {heroHoursSummary && (
        <div style={{ marginTop: 4, fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>
          {heroHoursSummary}
        </div>
      )}
      {heroLocationTags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {allSingleBranchTags.map((tag) => (
            <span key={`hero-tag-${tag}`} style={{ padding: '4px 10px', borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.surface2, fontFamily: theme.sans, fontSize: 11, color: theme.text }}>
              {tag}
            </span>
          ))}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          onClick={() => setShowSingleTagModal(true)}
          style={{ border: `1px dashed ${theme.border}`, borderRadius: 999, padding: '5px 11px', background: 'transparent', cursor: 'pointer', fontFamily: theme.sans, fontSize: 11.5, color: theme.muted }}
        >
          + Add location tags
        </button>
      </div>
    </>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: window.APP_HEADER_SAFE_TOP, paddingBottom: window.APP_BRAND_HEADER_PADDING_BOTTOM, borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
            <IconBack size={20} stroke={theme.text} sw={2} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 20, fontWeight: 600, color: theme.text, letterSpacing: -0.3 }}>{brand.name}</div>
          </div>
          <button
            type="button"
            onClick={() => setShowEditBrand(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.surface2, cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.text }}
          >
            <IconEdit size={13} stroke={theme.text} sw={1.8} />
            Edit
          </button>
          <PostHereBtn onClick={onPost} theme={theme} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 80px' }}>
        <section style={{ marginBottom: 18 }}>
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, overflow: 'hidden', background: theme.card }}>
            {useCoverLayout ? (
              <>
                <div style={{ height: 186 }}>
                  {heroPhoto ? (
                    <img src={heroPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Placeholder label="" hue={brand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                  )}
                </div>
                <div style={{ padding: '12px 14px 14px' }}>
                  {showLogoBesideDetails ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 72, height: 72, borderRadius: 12, flexShrink: 0, overflow: 'hidden' }}>
                        <img src={brand.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {brandCardText(false)}
                        {singleBranchDetailBlock}
                      </div>
                      <BrandFavoriteButton theme={theme} hearted={heartedBrand} onToggle={toggleBrandFavorite} />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {brandCardText(false)}
                        {singleBranchDetailBlock}
                      </div>
                      <BrandFavoriteButton theme={theme} hearted={heartedBrand} onToggle={toggleBrandFavorite} />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 72, height: 72, borderRadius: 12, flexShrink: 0, overflow: 'hidden' }}>
                  {brand.logoUrl ? (
                    <img src={brand.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Placeholder label="" hue={brand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {brandCardText(true)}
                </div>
                <BrandFavoriteButton theme={theme} hearted={heartedBrand} onToggle={toggleBrandFavorite} />
              </div>
            )}
          </div>
        </section>

        {branches.length > 1 && (
          <section style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
              <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Locations
              </div>
            </div>
            {branches.map((br) => {
              const brDetail = branchDetails[br.id] || null;
              const brRating = Number(brDetail?.rating) || 0;
              const brReviews = Number(brDetail?.userRatingCount) || 0;
              const brHoursSummary = formatHoursSummary(brDetail, br?.hoursOverride);
              const brTags = mergedLocationTags(br, brDetail);
              const brPhoto = br?.photoUrl || branchPhotos[br.id] || brDetail?.photoUrl || null;
              return (
                <button
                  key={br.id}
                  type="button"
                  onClick={() => onOpenBranch?.(brand.id, br.id)}
                  style={{ width: '100%', textAlign: 'left', padding: '11px 13px', border: `1px solid ${theme.border}`, borderRadius: 14, display: 'flex', alignItems: 'center', gap: 12, background: theme.card, marginBottom: 8, cursor: 'pointer' }}
                >
                  <div style={{ width: 72, height: 72, borderRadius: 12, flexShrink: 0, overflow: 'hidden', border: `1px solid ${theme.border}` }}>
                    {brPhoto ? (
                      <img src={brPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Placeholder label="" hue={brand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: theme.sans, fontSize: 15, fontWeight: 500, color: theme.text }}>{br.name}</div>
                    <div style={{
                      fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 2,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {shortAddress(br.address || br.neighborhood || 'No address data')}
                    </div>
                    {brRating > 0 && brReviews > 0 && (
                      <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 3 }}>
                        {brRating.toFixed(1)} · {brReviews.toLocaleString()} Google reviews
                      </div>
                    )}
                    {brHoursSummary && (
                      <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 3 }}>
                        {brHoursSummary}
                      </div>
                    )}
                    {brTags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                        {brTags.slice(0, 3).map((tag) => (
                          <span key={`${br.id}-${tag}`} style={{ padding: '2px 8px', borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.surface2, fontFamily: theme.sans, fontSize: 10.5, color: theme.text }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <IconChevron size={14} stroke={theme.muted} />
                  </div>
                </button>
              );
            })}
          </section>
        )}

        <BrandEventsSection
          theme={theme}
          brand={brand}
          buckets={eventBuckets}
          onAddEvent={() => setShowAddEvent(true)}
          onViewAll={() => onViewAllEvents?.(brand.id)}
          onOpenEvent={onOpenEvent}
        />

        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Feed preview
            </div>
            <button
              type="button"
              onClick={() => onViewAllPosts?.(brand.id)}
              style={{ background: theme.accentLight, border: `1px solid ${theme.border}`, borderRadius: 999, padding: '6px 11px', cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.accent }}
            >
              View all posts
            </button>
          </div>
          {brandPosts.length === 0 ? (
            <EmptyMsg label="No posts yet" theme={theme} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {brandPosts.slice(0, 6).map((post) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => onOpenPost(post.id)}
                  style={{ border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', background: theme.card, cursor: 'pointer', padding: 0, aspectRatio: '1 / 1' }}
                >
                  {post.photos && post.photos[0] ? (
                    <img src={post.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Placeholder label="" hue={brand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      {savingSingleTags ? (
        <div style={{ position: 'absolute', right: 16, bottom: 90, zIndex: 90, padding: '6px 10px', borderRadius: 999, background: theme.card, border: `1px solid ${theme.border}`, fontFamily: theme.sans, fontSize: 11, color: theme.muted }}>
          Saving tags…
        </div>
      ) : null}
      <TagPickerModal
        open={showSingleTagModal}
        theme={theme}
        selectedTags={singleLocationTags}
        onClose={() => setShowSingleTagModal(false)}
        onSave={(next) => {
          void saveSingleBranchTags(next);
          setShowSingleTagModal(false);
        }}
      />
      {showAddEvent && EventFormModal ? (
        <EventFormModal
          theme={theme}
          presetBrandId={brand.id}
          defaultType="popup"
          onClose={() => setShowAddEvent(false)}
          onSaved={() => setShowAddEvent(false)}
        />
      ) : null}
      {showEditBrand ? (
        <AddOrEditBrandModal
          open={showEditBrand}
          theme={theme}
          brand={brand}
          onClose={() => setShowEditBrand(false)}
          onSaved={() => setShowEditBrand(false)}
          onArchived={() => { setShowEditBrand(false); onBack?.(); }}
        />
      ) : null}
    </div>
  );
}

// Inline section: shows up to 3 active/upcoming events (or up to 3 past if none active), with View all + Add.
function BrandEventsSection({ theme, brand, buckets, onAddEvent, onViewAll, onOpenEvent }) {
  const EventCardCmp = window.EventCard;
  const totalCount = (buckets?.ongoing?.length || 0) + (buckets?.upcoming?.length || 0) + (buckets?.past?.length || 0);
  const hasActive = (buckets?.activeUpcoming?.length || 0) > 0;
  const visibleList = hasActive
    ? (buckets.activeUpcoming || []).slice(0, 3)
    : (buckets?.past || []).slice(0, 3);
  const headerLabel = hasActive ? 'Upcoming events' : (totalCount > 0 ? 'Previous events' : 'Events');

  return (
    <section style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {headerLabel}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {totalCount > visibleList.length && (
            <button
              type="button"
              onClick={onViewAll}
              style={{ background: theme.accentLight, border: `1px solid ${theme.border}`, borderRadius: 999, padding: '5px 11px', cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.accent }}
            >
              View all
            </button>
          )}
          <button
            type="button"
            onClick={onAddEvent}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '5px 11px',
              background: theme.card, color: theme.text, border: `1px solid ${theme.border}`,
              borderRadius: 999, fontFamily: theme.sans, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" stroke={theme.text} strokeWidth="2.5" strokeLinecap="round" fill="none"><path d="M12 5v14M5 12h14"/></svg>
            Add
          </button>
        </div>
      </div>
      {totalCount === 0 ? (
        <div style={{ padding: '14px 12px', borderRadius: 12, border: `1px dashed ${theme.border}`, fontFamily: theme.sans, fontSize: 12.5, color: theme.muted, textAlign: 'center' }}>
          No events yet. Tap Add to record one.
        </div>
      ) : (
        visibleList.map((ev) => (
          EventCardCmp ? (
            <EventCardCmp
              key={ev.id}
              theme={theme}
              event={ev}
              onOpen={onOpenEvent ? () => onOpenEvent(ev.id) : null}
            />
          ) : null
        ))
      )}
    </section>
  );
}

// Branch detail — posts at this specific location (curated brand branch or standalone Google-backed location)
function BranchDetailScreen({
  theme, brandId, branchId, onBack, onOpenPost, onPost, onOpenBrand,
  standaloneBrand, standaloneBranch, isStandaloneLocation,
}) {
  const curatedBrand = BRANDS.find((b) => b.id === brandId);
  const brand = (isStandaloneLocation && standaloneBrand)
    ? standaloneBrand
    : (curatedBrand || BRANDS[0] || FALLBACK_BRAND);
  const branch = (isStandaloneLocation && standaloneBranch)
    ? standaloneBranch
    : ((brand.branches || []).find((br) => br.id === branchId));
  const branchPosts = POSTS.filter((p) => String(p.branchId) === String(branchId));
  const [heroPhoto, setHeroPhoto] = React.useState(branch?.photoUrl || null);
  const [branchDetails, setBranchDetails] = React.useState(null);
  const [heartedBrand, setHeartedBrand] = React.useState(false);
  const [heartedLoc, setHeartedLoc] = React.useState(false);
  const [locationTags, setLocationTags] = React.useState(Array.isArray(branch?.locationTags) ? branch.locationTags : []);
  const [savingTags, setSavingTags] = React.useState(false);
  const [showTagModal, setShowTagModal] = React.useState(false);
  const [showEditBranch, setShowEditBranch] = React.useState(false);
  const [, refreshTick] = React.useState(0);

  React.useEffect(() => {
    const h = () => refreshTick((x) => x + 1);
    window.addEventListener('v2:data-updated', h);
    return () => window.removeEventListener('v2:data-updated', h);
  }, []);

  React.useEffect(() => {
    if (isStandaloneLocation && branch?.id) {
      const sync = () => {
        if (window.V2Live?.isLocationLiked) setHeartedLoc(window.V2Live.isLocationLiked(branch.id));
      };
      sync();
      window.addEventListener('v2:likes-updated', sync);
      window.addEventListener('v2:data-updated', sync);
      return () => {
        window.removeEventListener('v2:likes-updated', sync);
        window.removeEventListener('v2:data-updated', sync);
      };
    }
    const syncHeart = () => {
      if (window.V2Live?.isBrandLiked) setHeartedBrand(window.V2Live.isBrandLiked(brand.id));
    };
    syncHeart();
    window.addEventListener('v2:likes-updated', syncHeart);
    window.addEventListener('v2:data-updated', syncHeart);
    return () => {
      window.removeEventListener('v2:likes-updated', syncHeart);
      window.removeEventListener('v2:data-updated', syncHeart);
    };
  }, [isStandaloneLocation, branch?.id, brand.id]);

  React.useEffect(() => {
    let active = true;
    async function hydrateBranchHero() {
      if (!branch) return;
      if (branch.photoUrl) setHeroPhoto(branch.photoUrl);
      if (branch.placeId && window.V2Live?.getPlacePhoto && !branch.photoUrl) {
        const photo = await window.V2Live.getPlacePhoto(branch.placeId, false).catch(() => null);
        if (active && photo) setHeroPhoto(photo);
      }
      if (branch.placeId && window.V2Live?.getPlaceDetails) {
        const details = await window.V2Live.getPlaceDetails(branch.placeId, false).catch(() => null);
        if (active && details) setBranchDetails(details);
      }
    }
    setHeroPhoto(branch?.photoUrl || null);
    setBranchDetails(null);
    hydrateBranchHero();
    return () => { active = false; };
  }, [brandId, branchId]);

  React.useEffect(() => {
    setLocationTags(Array.isArray(branch?.locationTags) ? branch.locationTags : []);
  }, [branch?.id, branch?.locationTags]);

  const googleRating = Number(branchDetails?.rating) || 0;
  const googleReviewCount = Number(branchDetails?.userRatingCount) || 0;
  const googleTags = deriveGoogleLocationTags(branchDetails);
  const hoursSummary = formatHoursSummary(branchDetails, branch?.hoursOverride);
  const allTags = React.useMemo(() => {
    const merged = [];
    const seen = new Set();
    [...locationTags, ...googleTags].forEach((tag) => {
      const cleaned = String(tag || '').trim();
      if (!cleaned) return;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(cleaned);
    });
    return merged;
  }, [locationTags, googleTags]);

  const persistLocationTags = React.useCallback(async (nextTags) => {
    if (!branch?.id || !window.V2Live?.setLocationTags) return;
    setSavingTags(true);
    try {
      await window.V2Live.setLocationTags(branch.id, nextTags);
    } finally {
      setSavingTags(false);
    }
  }, [branch?.id]);

  const saveLocationTags = React.useCallback((nextTags) => {
    const clean = Array.isArray(nextTags) ? nextTags.map((x) => String(x || '').trim()).filter(Boolean) : [];
    setLocationTags(clean);
    void persistLocationTags(clean);
  }, [persistLocationTags]);

  const toggleBranchFavorite = async () => {
    if (isStandaloneLocation && branch?.id) {
      const next = !heartedLoc;
      setHeartedLoc(next);
      try {
        await window.V2Live?.setLocationLike?.(branch.id, next);
      } catch {
        setHeartedLoc(!next);
      }
      return;
    }
    const next = !heartedBrand;
    setHeartedBrand(next);
    try {
      await window.V2Live?.setBrandLike?.(brand.id, next);
    } catch {
      setHeartedBrand(!next);
    }
  };

  const branchHearted = isStandaloneLocation ? heartedLoc : heartedBrand;
  const branchHeartAria = isStandaloneLocation
    ? (heartedLoc ? 'Remove location from favorites' : 'Favorite this location')
    : (heartedBrand ? 'Remove from favorites' : 'Favorite brand');

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: window.APP_HEADER_SAFE_TOP, paddingBottom: window.APP_BRAND_HEADER_PADDING_BOTTOM, borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
            <IconBack size={20} stroke={theme.text} sw={2} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 20, fontWeight: 600, color: theme.text, letterSpacing: -0.3 }}>
              {(!isStandaloneLocation && brand?.name) ? brand.name : (branch ? branch.name : 'Branch')}
            </div>
            {!isStandaloneLocation && (
              <button
                type="button"
                onClick={() => onOpenBrand?.(brand.id)}
                style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.accent }}
              >
                View brand profile
              </button>
            )}
          </div>
          {!isStandaloneLocation && branch ? (
            <button
              type="button"
              onClick={() => setShowEditBranch(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.surface2, cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.text, flexShrink: 0 }}
            >
              <IconEdit size={13} stroke={theme.text} sw={1.8} />
              Edit
            </button>
          ) : null}
          <PostHereBtn onClick={onPost} theme={theme} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 80px' }}>
        <section style={{ marginBottom: 18 }}>
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, overflow: 'hidden', background: theme.card }}>
            <div style={{ height: 186 }}>
              {heroPhoto ? (
                <img src={heroPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Placeholder label="" hue={brand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
              )}
            </div>
            <div style={{ padding: '12px 14px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0, fontFamily: theme.sans, fontSize: 19, fontWeight: 600, color: theme.text, lineHeight: 1.2 }}>
                  {branch ? branch.name : 'Branch'}
                </div>
                <BrandFavoriteButton
                  theme={theme}
                  hearted={branchHearted}
                  onToggle={toggleBranchFavorite}
                  ariaLabel={branchHeartAria}
                />
              </div>
              {branch?.address && (
                <div style={{ marginTop: 3, fontFamily: theme.sans, fontSize: 12, color: theme.muted, lineHeight: 1.35 }}>
                  {shortAddress(branch.address)}
                </div>
              )}
              {(googleRating > 0 && googleReviewCount > 0) && (
                <div style={{ marginTop: 4, fontFamily: theme.sans, fontSize: 12, color: theme.text, fontWeight: 600, lineHeight: 1.35 }}>
                  {googleRating.toFixed(1)} · {googleReviewCount.toLocaleString()} Google reviews
                </div>
              )}
              {hoursSummary && (
                <div style={{ marginTop: 4, fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>
                  {hoursSummary}
                </div>
              )}
              {allTags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {allTags.map((tag) => (
                    <span key={`detail-tag-${tag}`} style={{ border: `1px solid ${theme.border}`, borderRadius: 999, padding: '4px 10px', background: theme.surface2, fontFamily: theme.sans, fontSize: 11.5, color: theme.text }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowTagModal(true)}
                  style={{ border: `1px dashed ${theme.border}`, borderRadius: 999, padding: '5px 11px', background: 'transparent', cursor: 'pointer', fontFamily: theme.sans, fontSize: 11.5, color: theme.muted }}
                >
                  + Add location tags
                </button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Posts
            </div>
            <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>
              {branchPosts.length} {branchPosts.length === 1 ? 'post' : 'posts'}
            </div>
          </div>
          {branchPosts.length === 0 ? (
            <EmptyMsg label="No posts at this location yet" theme={theme} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {branchPosts.map((post) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => onOpenPost(post.id)}
                  style={{ border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', background: theme.card, cursor: 'pointer', padding: 0, aspectRatio: '1 / 1' }}
                >
                  {post.photos && post.photos[0] ? (
                    <img src={post.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Placeholder label="" hue={brand.hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      {savingTags ? (
        <div style={{ position: 'absolute', right: 16, bottom: 90, zIndex: 90, padding: '6px 10px', borderRadius: 999, background: theme.card, border: `1px solid ${theme.border}`, fontFamily: theme.sans, fontSize: 11, color: theme.muted }}>
          Saving tags…
        </div>
      ) : null}
      <TagPickerModal
        open={showTagModal}
        theme={theme}
        selectedTags={locationTags}
        onClose={() => setShowTagModal(false)}
        onSave={(next) => {
          saveLocationTags(next);
          setShowTagModal(false);
        }}
      />
      {showEditBranch && branch ? (
        <EditBranchModal
          open={showEditBranch}
          theme={theme}
          branch={branch}
          brand={brand}
          onClose={() => setShowEditBranch(false)}
          onSaved={() => setShowEditBranch(false)}
          onDeleted={() => { setShowEditBranch(false); onBack?.(); }}
        />
      ) : null}
    </div>
  );
}

window.BrandsScreen = BrandsScreen;
window.BrandDetailScreen = BrandDetailScreen;
window.BranchDetailScreen = BranchDetailScreen;
