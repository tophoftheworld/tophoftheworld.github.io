// Log — new post, low friction. Expand per-drink for more detail.

const DRINK_SUGGESTIONS = [
  'Matcha Latte', 'Iced Matcha Latte', 'Hot Matcha Latte',
  'Usucha', 'Koicha', 'Dirty Matcha', 'Matcha Hojicha Split',
  'Strawberry Matcha', 'Yuzu Matcha', 'Pomelo Matcha',
  'Brown Sugar Matcha', 'Ceremonial Usucha', 'Matcha Tonic',
  'Coconut Matcha', 'Matcha Affogato',
];

function emptyDrinkProfile() {
  return {
    sweet: 0, matcha: 0, balance: 0,
    umami: 0, bitterness: 0, astringency: 0, body: 0, texture: 0, finish: 0,
  };
}

function newDrinkRow(id) {
  return {
    id,
    name: '',
    rating: 0,
    notes: '',
    price: '',
    recommended: false,
    expanded: false,
    drinkTierExpanded: true,
    matchaExpanded: false,
    profile: emptyDrinkProfile(),
    flavorNotes: [],
  };
}

function isEventTaggable(event) {
  if (!event) return false;
  const status = event.status
    || (typeof window.effectiveEventStatus === 'function' ? window.effectiveEventStatus(event) : 'past');
  return status === 'ongoing' || status === 'past';
}

function drinkRowFromPost(drink, id) {
  return {
    id,
    name: drink?.name || '',
    rating: Number(drink?.rating) || 0,
    notes: drink?.notes || '',
    price: drink?.price || '',
    recommended: Boolean(drink?.recommended),
    expanded: false,
    drinkTierExpanded: true,
    matchaExpanded: false,
    profile: { ...emptyDrinkProfile(), ...(drink?.profile || {}) },
    flavorNotes: Array.isArray(drink?.flavorNotes) ? [...drink.flavorNotes] : [],
  };
}

function resolveBrandBranchForPost(post, brands) {
  if (!post) return { brand: null, branch: null };
  const brandList = Array.isArray(brands) ? brands : [];
  let brand = brandList.find((b) => String(b.id) === String(post.brandId));
  let branch = brand && post.branchId
    ? (brand.branches || []).find((br) => String(br.id) === String(post.branchId))
    : null;
  if (brand && !branch && post.branchId) {
    branch = {
      id: post.branchId,
      name: post.branchName || post.location || brand.name,
      address: post.address || '',
    };
  }
  if (!brand) {
    const placeId = String(post.brandId || '').startsWith('gplace_')
      ? String(post.brandId).slice('gplace_'.length)
      : null;
    branch = {
      id: post.branchId || (placeId ? window.gpCafeIdFromPlaceId(placeId) : null),
      name: post.branchName || post.brand || 'Location',
      address: post.address || '',
      placeId,
    };
    brand = {
      id: post.brandId || (placeId ? `gplace_${placeId}` : branch.id),
      name: post.brand || branch.name,
      kind: 'cafe',
      hue: 120,
      branches: branch?.id ? [branch] : [],
    };
  }
  return { brand, branch };
}

function LogScreen({ theme, onClose, onSave, onDeleteList, context }) {
  const todayStr = React.useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);
  const ctx = context || {};
  const editPost = ctx.editPostId
    ? (Array.isArray(window.POSTS) ? window.POSTS : []).find((p) => String(p.id) === String(ctx.editPostId) && p.isOwn)
    : null;
  const isPostEdit = Boolean(editPost?.id);
  const rawCtxEventId = ctx.eventId ? String(ctx.eventId) : null;
  const ctxEventRaw = rawCtxEventId
    ? ((window.EVENTS || []).find((e) => String(e.id) === rawCtxEventId) || null)
    : null;
  const ctxEventResolved = ctxEventRaw
    ? { ...ctxEventRaw, status: typeof window.effectiveEventStatus === 'function' ? window.effectiveEventStatus(ctxEventRaw) : ctxEventRaw.status }
    : null;
  const ctxEventTaggable = Boolean(ctxEventResolved && isEventTaggable(ctxEventResolved));
  const ctxEventId = ctxEventTaggable ? rawCtxEventId : null;
  const ctxEvent = ctxEventTaggable ? ctxEventResolved : null;
  const ctxMerchants = ctxEvent
    ? (ctxEvent.merchantIds || []).map((id) => BRANDS.find((b) => String(b.id) === String(id))).filter(Boolean)
    : [];
  const ctxSingleMerchant = ctxEventTaggable && ctxMerchants.length === 1 ? ctxMerchants[0] : null;

  let prefilledBrand = ctx.brandId ? BRANDS.find(b => b.id === ctx.brandId) : null;
  let prefilledBranch = ctx.branchId && prefilledBrand
    ? (prefilledBrand.branches || []).find(br => br.id === ctx.branchId) : null;
  if (ctx.syntheticBrand && ctx.syntheticBranch) {
    prefilledBrand = ctx.syntheticBrand;
    prefilledBranch = ctx.syntheticBranch;
  }
  if (isPostEdit) {
    const resolved = resolveBrandBranchForPost(editPost, BRANDS);
    if (resolved.brand) {
      prefilledBrand = resolved.brand;
      prefilledBranch = resolved.branch;
    }
  }
  if (!prefilledBrand && ctxSingleMerchant) {
    prefilledBrand = ctxSingleMerchant;
  }
  let prefilledEvent = null;
  if (ctxEventTaggable && ctxEvent) {
    prefilledEvent = ctxEvent;
  } else if (ctx.eventId && prefilledBrand) {
    const events = window.eventsForBrand ? window.eventsForBrand(prefilledBrand.id) : [];
    const found = events.find((e) => String(e.id) === String(ctx.eventId))
      || (window.EVENTS || []).find((e) => String(e.id) === String(ctx.eventId))
      || null;
    if (found && isEventTaggable(found)) prefilledEvent = found;
  }
  if (isPostEdit && editPost.eventId) {
    const ev = (window.EVENTS || []).find((e) => String(e.id) === String(editPost.eventId));
    if (ev) prefilledEvent = ev;
  }
  const prefilledHasBranches = Array.isArray(prefilledBrand?.branches) && prefilledBrand.branches.length > 0;

  const [selectedBrand, setSelectedBrand] = React.useState(prefilledBrand || null);
  const [brandQuery, setBrandQuery] = React.useState(prefilledBrand ? prefilledBrand.name : '');
  const [brandSuggs, setBrandSuggs] = React.useState([]);
  const [eventBrandFilter, setEventBrandFilter] = React.useState(Boolean(ctxEventTaggable && ctxMerchants.length > 0));
  const [selectedBranch, setSelectedBranch] = React.useState(prefilledEvent ? null : (prefilledBranch || null));
  const [selectedEvent, setSelectedEvent] = React.useState(prefilledEvent ? { id: prefilledEvent.id } : null);
  const [locationMode, setLocationMode] = React.useState(prefilledEvent ? 'event' : (prefilledHasBranches ? 'branch' : 'event'));
  const [showAddEvent, setShowAddEvent] = React.useState(false);
  const EventFormModal = window.EventFormModal;
  const [branchPhotos, setBranchPhotos] = React.useState({});
  const [caption, setCaption] = React.useState(() => editPost?.caption || '');
  const [photos, setPhotos] = React.useState(() => (
    Array.isArray(editPost?.photos) && editPost.photos.length
      ? editPost.photos.filter(Boolean).map((url, i) => ({
        id: `existing-${editPost.id}-${i}`,
        src: url,
        file: null,
        existingUrl: url,
      }))
      : []
  ));
  const fileInputRef = React.useRef(null);
  const latestBrandQ = React.useRef('');
  const brandSearchTimer = React.useRef(null);
  const initialDrinks = Array.isArray(editPost?.drinks) && editPost.drinks.length
    ? editPost.drinks.map((d, i) => drinkRowFromPost(d, i + 1))
    : [newDrinkRow(1)];
  const [drinks, setDrinks] = React.useState(initialDrinks);
  const counter = React.useRef(initialDrinks.length + 1);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const listBusy = saving || deleting;
  const [submitStatusLines, setSubmitStatusLines] = React.useState([]);
  const [submitError, setSubmitError] = React.useState('');
  const [orderedAt, setOrderedAt] = React.useState(() => {
    if (editPost?.orderedAt) return String(editPost.orderedAt).slice(0, 10);
    return todayStr;
  });
  const [showOrderedAtPicker, setShowOrderedAtPicker] = React.useState(false);
  const [composerMode, setComposerMode] = React.useState(
    ctx.editListId ? 'list' : (isPostEdit ? 'post' : (ctx.mode === 'list' ? 'list' : 'post')),
  );
  const [modeMenuOpen, setModeMenuOpen] = React.useState(false);
  const listComposerRef = React.useRef(null);
  const ListComposerForm = window.ListComposerForm;
  const editList = ctx.editListId
    ? (Array.isArray(window.USER_LISTS) ? window.USER_LISTS : []).find((l) => String(l.id) === String(ctx.editListId))
    : null;
  const isListEdit = Boolean(editList?.id);

  const pushSubmitStatus = React.useCallback((msg) => {
    const line = `${new Date().toLocaleTimeString([], { hour12: false })} ${msg}`;
    setSubmitStatusLines((prev) => [...prev.slice(-5), line]);
    try { window.__V2_DEBUG__?.push?.('INFO', `[post] ${msg}`); } catch (_) {}
  }, []);

  const onBrandType = (v) => {
    latestBrandQ.current = v;
    setBrandQuery(v);
    setSelectedBrand(null);
    setSelectedBranch(null);
    if (!ctxEventId) setSelectedEvent(null);
    setLocationMode('branch');
    const q = String(v || '').trim();
    let curated = [];
    if (eventBrandFilter && ctxMerchants.length > 0) {
      curated = ctxMerchants
        .filter((b) => !q || String(b.name || '').toLowerCase().includes(q.toLowerCase()))
        .slice(0, 8);
    } else if (q.length > 0) {
      curated = BRANDS.filter((b) => b.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
    }
    setBrandSuggs(curated.map((b) => ({ type: 'brand', key: b.id, brand: b })));
    if (brandSearchTimer.current) clearTimeout(brandSearchTimer.current);
    if (eventBrandFilter || q.length < 2) return;
    brandSearchTimer.current = setTimeout(async () => {
      if (latestBrandQ.current !== v) return;
      const g = (await window.V2Live?.searchPlacesForLog?.(q)) || [];
      if (latestBrandQ.current !== v) return;
      setBrandSuggs((prev) => {
        const brandsOnly = (prev || []).filter((x) => x && x.type === 'brand');
        const googleRows = g.map((row) => ({ type: 'google', key: `g-${row.placeId}`, row }));
        return [...brandsOnly, ...googleRows];
      });
    }, 320);
  };

  const clearBrandSelection = () => {
    setSelectedBrand(null);
    setBrandQuery('');
    setSelectedBranch(null);
    setEventBrandFilter(false);
    setBrandSuggs([]);
    if (eventBrandFilter && ctxMerchants.length > 0) {
      setBrandSuggs(ctxMerchants.map((b) => ({ type: 'brand', key: b.id, brand: b })));
    }
  };

  React.useEffect(() => {
    if (!eventBrandFilter || !ctxMerchants.length || selectedBrand || !ctxEventTaggable) return;
    setBrandSuggs(ctxMerchants.map((b) => ({ type: 'brand', key: b.id, brand: b })));
  }, []);

  const selectGoogleRow = (row) => {
    if (!row?.placeId) return;
    const branchId = `gp_${String(row.placeId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`;
    const b = {
      id: `gplace_${row.placeId}`,
      name: row.name,
      kind: 'cafe',
      hue: 120,
      branches: [{
        id: branchId,
        placeId: row.placeId,
        name: row.name,
        address: row.address || '',
        lat: row.lat,
        lng: row.lng,
        neighborhood: '',
      }],
      popUps: [],
    };
    setSelectedBrand(b);
    setBrandQuery(row.name);
    setBrandSuggs([]);
    setSelectedBranch(b.branches[0]);
    setSelectedEvent(null);
    setLocationMode('branch');
  };

  const selectBrand = (b) => {
    setSelectedBrand(b);
    setBrandQuery(b.name);
    setBrandSuggs([]);
    const brs = b.branches || [];
    setSelectedBranch(brs.length === 1 ? brs[0] : null);
    if (!ctxEventId) setSelectedEvent(null);
    setLocationMode(ctxEventId ? 'event' : (brs.length === 0 ? 'event' : 'branch'));
  };

  const addPhoto = () => fileInputRef.current?.click();
  const removePhoto = id => setPhotos((p) => {
    const target = p.find((x) => x.id === id);
    if (target?.src) URL.revokeObjectURL(target.src);
    return p.filter((x) => x.id !== id);
  });
  const addDrink = () => setDrinks((d) => [...d, newDrinkRow(counter.current++)]);
  const removeDrink = id => setDrinks(d => d.filter(x => x.id !== id));
  const updateDrink = (id, k, v) => setDrinks(d => d.map(x => x.id === id ? { ...x, [k]: v } : x));
  const updateProfile = (id, k, v) => setDrinks(d => d.map(x => x.id === id ? { ...x, profile: { ...x.profile, [k]: v } } : x));
  const toggleNote = (id, n) => setDrinks(d => d.map(x => x.id === id
    ? { ...x, flavorNotes: x.flavorNotes.includes(n) ? x.flavorNotes.filter(f => f !== n) : [...x.flavorNotes, n] }
    : x));

  const branches = selectedBrand?.branches || [];
  const brandEvents = window.eventsForBrand && selectedBrand?.id
    ? window.eventsForBrand(selectedBrand.id)
    : [];

  React.useEffect(() => {
    if (!selectedEvent?.id || !selectedBrand) return;
    const ev = brandEvents.find((e) => String(e.id) === String(selectedEvent.id));
    if (ev && !isEventTaggable(ev)) setSelectedEvent(null);
  }, [brandEvents, selectedEvent?.id, selectedBrand]);

  React.useEffect(() => {
    if (!selectedBrand) return;
    const hasBranches = Array.isArray(selectedBrand.branches) && selectedBrand.branches.length > 0;
    if (!hasBranches && locationMode !== 'event') {
      setLocationMode('event');
    }
  }, [selectedBrand, locationMode]);

  React.useEffect(() => {
    let active = true;
    async function hydrateBranchPhotos() {
      if (!selectedBrand || !window.V2Live?.getPlacePhoto) return;
      for (const branch of branches) {
        if (!branch?.id || branchPhotos[branch.id]) continue;
        if (branch.photoUrl) {
          if (!active) return;
          setBranchPhotos((prev) => (prev[branch.id] ? prev : { ...prev, [branch.id]: branch.photoUrl }));
          continue;
        }
        if (!branch.placeId) continue;
        const photo = await window.V2Live.getPlacePhoto(branch.placeId, false).catch(() => null);
        if (!active || !photo) continue;
        setBranchPhotos((prev) => (prev[branch.id] ? prev : { ...prev, [branch.id]: photo }));
      }
    }
    hydrateBranchPhotos();
    return () => { active = false; };
  }, [selectedBrand, branches, branchPhotos]);

  const handleDeleteList = async () => {
    if (!isListEdit || !editList?.id || listBusy || !onDeleteList) return;
    if (!window.confirm(`Delete "${editList.name}"?\n\nThis cannot be undone.`)) return;
    setSubmitError('');
    setDeleting(true);
    try {
      await onDeleteList(editList.id);
    } catch (e) {
      console.warn('[v2 list delete]', e?.message || e);
      setSubmitError(String(e?.message || 'Could not delete list'));
      setDeleting(false);
    }
  };

  const handleSave = async () => {
    if (composerMode === 'list') {
      if (listBusy) return;
      const payload = listComposerRef.current?.getPayload?.();
      if (!payload) return;
      setSubmitError('');
      setSaving(true);
      try {
        await onSave({ kind: 'list', ...payload });
      } catch (e) {
        console.warn('[v2 list]', e?.message || e);
        setSubmitError(String(e?.message || (isListEdit ? 'Failed to update list' : 'Failed to create list')));
      } finally {
        setSaving(false);
      }
      return;
    }
    const normalizedDrinkRows = drinks.map((d) => ({
      name: String(d.name || '').trim(),
      rating: Number(d.rating) || 0,
      notes: String(d.notes || '').trim(),
      price: String(d.price || '').trim(),
      flavorNotes: Array.isArray(d.flavorNotes) ? d.flavorNotes : [],
      profile: {
        sweet: Number(d.profile?.sweet) || 0,
        matcha: Number(d.profile?.matcha) || 0,
        balance: Number(d.profile?.balance) || 0,
        umami: Number(d.profile?.umami) || 0,
        bitterness: Number(d.profile?.bitterness) || 0,
        astringency: Number(d.profile?.astringency) || 0,
        body: Number(d.profile?.body) || 0,
        texture: Number(d.profile?.texture) || 0,
        finish: Number(d.profile?.finish) || 0,
      },
      recommended: Boolean(d.recommended),
    }));
    const hasUnnamedDrinkWithDetails = normalizedDrinkRows.some((d) => {
      if (d.name) return false;
      return Boolean(
        d.rating > 0
        || d.notes
        || d.price
        || (Array.isArray(d.flavorNotes) && d.flavorNotes.length > 0)
        || drinkProfileHasValue(d.profile)
        || d.recommended
      );
    });
    const cleanDrinks = normalizedDrinkRows.filter((d) => d.name);
    if (!selectedBrand) return;
    if (hasUnnamedDrinkWithDetails) {
      setSubmitError('Add a drink name for any drink row with details.');
      pushSubmitStatus('Blocked: drink details require a drink name');
      return;
    }
    if (saving) return;
    setSubmitError('');
    setSubmitStatusLines([]);
    pushSubmitStatus('Post requested');
    const hasBranchOptions = Array.isArray(branches) && branches.length > 0;
    const useEventMode = locationMode === 'event' || !hasBranchOptions;
    const resolvedBranch = useEventMode ? null : (selectedBranch || (branches.length === 1 ? branches[0] : null));
    if (!useEventMode && !resolvedBranch) {
      console.warn('[v2 log] No location selected');
      setSubmitError('Select a location before posting.');
      pushSubmitStatus('Blocked: missing location');
      return;
    }
    let eventPayload = null;
    if (useEventMode) {
      if (selectedEvent?.id) {
        const brandEvts = window.eventsForBrand && selectedBrand?.id
          ? window.eventsForBrand(selectedBrand.id)
          : (Array.isArray(window.EVENTS) ? window.EVENTS : []);
        const tagged = brandEvts.find((e) => String(e.id) === String(selectedEvent.id));
        if (tagged && !isEventTaggable(tagged)) {
          setSubmitError('You can only tag current or past events.');
          pushSubmitStatus('Blocked: future event cannot be tagged');
          return;
        }
        eventPayload = { id: selectedEvent.id };
      } else {
        eventPayload = { generic: true };
      }
    }
    setSaving(true);
    try {
      pushSubmitStatus('Uploading photos and saving post...');
      await onSave({
        postId: isPostEdit ? editPost.id : undefined,
        createdAt: isPostEdit ? editPost.createdAt : undefined,
        brand: selectedBrand,
        branch: resolvedBranch,
        event: eventPayload,
        orderedAt,
        caption,
        rating: 0,
        drinks: cleanDrinks,
        existingPhotoUrls: photos
          .map((p) => p.existingUrl || (!p.file ? p.src : null))
          .filter(Boolean),
        photoFiles: photos.map((p) => p.file).filter(Boolean),
      });
      pushSubmitStatus(isPostEdit ? 'Post updated successfully' : 'Post saved successfully');
    } catch (e) {
      console.warn('[v2 log]', e?.message || e);
      const msg = String(e?.message || 'Failed to post');
      setSubmitError(msg);
      pushSubmitStatus(`Failed: ${msg}`);
      try { window.__V2_DEBUG__?.push?.('ERROR', `[post] ${msg}`); } catch (_) {}
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 100, background: theme.surface, display: 'flex', flexDirection: 'column', animation: 'slideUp 280ms cubic-bezier(.2,.8,.2,1)' }}>
      {/* Header */}
      <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: window.APP_HEADER_SAFE_TOP, paddingBottom: window.APP_BRAND_HEADER_PADDING_BOTTOM, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${theme.border}`, flexShrink: 0, position: 'relative' }}>
        <button type="button" disabled={listBusy} onClick={onClose} style={{ background: 'none', border: 'none', cursor: listBusy ? 'not-allowed' : 'pointer', fontFamily: theme.sans, fontSize: 15, color: listBusy ? theme.border : theme.muted, padding: 0, opacity: listBusy ? 0.5 : 1, minWidth: 52, textAlign: 'left' }}>Cancel</button>
        <div style={{ position: 'relative' }}>
          {isListEdit ? (
            <div style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text, padding: '4px 8px' }}>
              Edit list
            </div>
          ) : isPostEdit ? (
            <div style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text, padding: '4px 8px' }}>
              Edit post
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={listBusy}
                onClick={() => setModeMenuOpen((o) => !o)}
                style={{
                  background: 'none', border: 'none', cursor: listBusy ? 'not-allowed' : 'pointer',
                  fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text,
                  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
                }}
              >
                {composerMode === 'list' ? 'New list' : 'New post'}
                <span style={{ display: 'inline-flex', transform: modeMenuOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}>
                  <IconChevron size={14} stroke={theme.muted} sw={2} />
                </span>
              </button>
              {modeMenuOpen ? (
                <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6, zIndex: 30, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', minWidth: 140, boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
                  {[['post', 'Post'], ['list', 'List']].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => { setComposerMode(id); setModeMenuOpen(false); }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px',
                        background: composerMode === id ? theme.accentLight : 'transparent',
                        border: 'none', borderBottom: `1px solid ${theme.border}`,
                        cursor: 'pointer', fontFamily: theme.sans, fontSize: 14,
                        fontWeight: composerMode === id ? 700 : 500,
                        color: composerMode === id ? theme.accent : theme.text,
                      }}
                    >{label}</button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
        <button
          type="button"
          disabled={listBusy}
          onClick={handleSave}
          style={{
            background: listBusy ? theme.surface2 : theme.accent,
            color: listBusy ? theme.muted : '#fff',
            border: 'none',
            cursor: listBusy ? 'wait' : 'pointer',
            fontFamily: theme.sans,
            fontSize: 14,
            fontWeight: 600,
            padding: '8px 18px',
            borderRadius: 999,
            minWidth: 100,
            flexShrink: 0,
          }}
        >
          {deleting
            ? 'Deleting…'
            : saving
              ? (composerMode === 'list' ? 'Saving…' : (isPostEdit ? 'Saving…' : 'Posting…'))
              : (composerMode === 'list' ? 'Save' : (isPostEdit ? 'Save' : 'Post'))}
        </button>
      </div>

      {saving && (
        <div style={{ padding: '10px 16px', background: theme.accentLight, borderBottom: `1px solid ${theme.border}`, fontFamily: theme.sans, fontSize: 13, color: theme.text, fontWeight: 500, flexShrink: 0 }}>
          {composerMode === 'list'
            ? (isListEdit ? 'Saving changes…' : 'Creating your list…')
            : (isPostEdit ? 'Saving changes…' : 'Uploading photos and publishing your log…')}
        </div>
      )}
      {composerMode === 'post' && (saving || submitError || submitStatusLines.length > 0) && (
        <div style={{ padding: '10px 16px', background: theme.surface2, borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, marginBottom: 5 }}>
            Post debug status
          </div>
          {submitStatusLines.length === 0 ? (
            <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>Waiting to start...</div>
          ) : (
            submitStatusLines.map((line, i) => (
              <div key={`submit-status-${i}`} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace', fontSize: 11, color: theme.text, lineHeight: 1.45 }}>
                {line}
              </div>
            ))
          )}
          {submitError ? (
            <div style={{ fontFamily: theme.sans, fontSize: 12, color: '#b00020', marginTop: 6 }}>
              {submitError}
            </div>
          ) : null}
        </div>
      )}

      {composerMode === 'list' && submitError ? (
        <div style={{ padding: '10px 16px', background: theme.surface2, borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 12, color: '#b00020' }}>{submitError}</div>
        </div>
      ) : null}

      {composerMode === 'list' && ListComposerForm ? (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <ListComposerForm
            key={editList?.id || 'new-list'}
            ref={listComposerRef}
            theme={theme}
            saving={listBusy}
            initialList={editList}
          />
          {isListEdit && onDeleteList ? (
            <div style={{ padding: '4px 16px 120px' }}>
              <button
                type="button"
                disabled={listBusy}
                onClick={handleDeleteList}
                style={{
                  width: '100%',
                  padding: '13px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'transparent',
                  fontFamily: theme.sans,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#c44',
                  cursor: listBusy ? 'not-allowed' : 'pointer',
                  opacity: listBusy ? 0.5 : 1,
                }}
              >
                {deleting ? 'Deleting…' : 'Delete list'}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 48px' }}>

        {/* Photos */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            <button type="button" disabled={saving} onClick={addPhoto} style={{ width: 84, height: 100, flexShrink: 0, borderRadius: 12, border: `1.5px dashed ${theme.border}`, background: theme.surface2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.55 : 1 }}>
              <IconCamera size={22} stroke={theme.muted} sw={1.5} />
              <span style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted }}>Photo</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              disabled={saving}
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (!files.length) return;
                setPhotos((current) => [
                  ...current,
                  ...files.map((file) => ({
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    file,
                    src: URL.createObjectURL(file),
                  })),
                ]);
                e.target.value = '';
              }}
              style={{ display: 'none' }}
            />
            {photos.map(ph => (
              <div key={ph.id} style={{ width: 84, height: 100, flexShrink: 0, borderRadius: 12, overflow: 'hidden', position: 'relative', border: `1px solid ${theme.border}` }}>
                {ph.src ? (
                  <img src={ph.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Placeholder label="" hue={100} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                )}
                <button type="button" disabled={saving} onClick={() => removePhoto(ph.id)} style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: saving ? 0.5 : 1 }}>
                  <IconClose size={8} stroke="#fff" sw={2.5} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Cafe / Brand */}
        <div style={{ marginBottom: 14 }}>
          {ctxEvent ? (
            <div style={{
              marginBottom: 10, padding: '10px 12px', borderRadius: 10,
              border: `1px solid ${theme.accent}`,
              background: theme.accentLight,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{
                  padding: '2px 7px', borderRadius: 999, fontFamily: theme.sans, fontSize: 9, fontWeight: 700,
                  letterSpacing: 0.3, textTransform: 'uppercase',
                  background: theme.accent,
                  color: '#fff',
                }}>
                  Event
                </span>
                <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  Posting at event
                </div>
              </div>
              <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>
                {ctxEvent.title || 'Event'}
              </div>
            </div>
          ) : null}
          <div style={{ minWidth: 0, position: 'relative' }}>
            <FieldLabel theme={theme}>Brand / location</FieldLabel>
            {selectedBrand ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface2 }}>
                <span style={{ flex: 1, fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.text }}>{selectedBrand.name}</span>
                <button type="button" disabled={saving} onClick={clearBrandSelection} style={{ background: 'none', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', padding: 2 }}>
                  <IconClose size={14} stroke={theme.muted} />
                </button>
              </div>
            ) : (
              <>
                <input value={brandQuery} onChange={e => onBrandType(e.target.value)}
                  disabled={saving}
                  placeholder={eventBrandFilter && ctxMerchants.length ? 'Search brands at this event…' : 'Search brand or Google Maps location…'}
                  style={{ ...fInput(theme), opacity: saving ? 0.7 : 1 }} />
                {brandSuggs.length > 0 && !saving && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden', boxShadow: theme.shadow, marginTop: 2 }}>
                    {brandSuggs.map((item) => (
                      item.type === 'google' ? (
                        <button type="button" key={item.key} onClick={() => selectGoogleRow(item.row)}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: theme.sans, fontSize: 14, color: theme.text, borderBottom: `1px solid ${theme.border}` }}>
                          <span style={{ fontWeight: 600 }}>{item.row.name}</span>
                          <span style={{ color: theme.muted, fontSize: 12, marginLeft: 6 }}>Maps</span>
                          {item.row.address ? (
                            <div style={{ fontSize: 12, color: theme.muted, marginTop: 4, fontWeight: 400 }}>{item.row.address}</div>
                          ) : null}
                        </button>
                      ) : (
                        <button type="button" key={item.key} onClick={() => selectBrand(item.brand)}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: theme.sans, fontSize: 14, color: theme.text, borderBottom: `1px solid ${theme.border}` }}>
                          {item.brand.name}
                          <span style={{ color: theme.muted, fontSize: 12, marginLeft: 6 }}>{item.brand.kind}</span>
                        </button>
                      )
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Location selector — branches and/or pop-ups */}
        {(selectedBrand || (ctxEventTaggable && prefilledEvent)) ? (
        <LocationPicker
          theme={theme}
          saving={saving}
          selectedBrand={selectedBrand}
          branches={branches}
          branchPhotos={branchPhotos}
          selectedBranch={selectedBranch}
          setSelectedBranch={(br) => { setSelectedBranch(br); if (!ctxEventId) setSelectedEvent(null); }}
          brandEvents={brandEvents}
          mode={locationMode}
          setMode={setLocationMode}
          selectedEvent={selectedEvent}
          setSelectedEvent={(ev) => { setSelectedEvent(ev); setSelectedBranch(null); }}
          onAddEvent={() => setShowAddEvent(true)}
          lockedEvent={ctxEventTaggable && prefilledEvent ? prefilledEvent : null}
        />
        ) : null}
        {showAddEvent && EventFormModal && selectedBrand?.id ? (
          <EventFormModal
            theme={theme}
            presetBrandId={selectedBrand.id}
            defaultType="popup"
            onClose={() => setShowAddEvent(false)}
            onSaved={(savedId) => {
              setShowAddEvent(false);
              if (savedId) {
                const saved = (window.EVENTS || []).find((e) => String(e.id) === String(savedId));
                if (!saved || isEventTaggable(saved)) {
                  setSelectedEvent({ id: savedId });
                  setSelectedBranch(null);
                  setLocationMode('event');
                }
              }
            }}
          />
        ) : null}

        <OrderedAtField
          theme={theme}
          value={orderedAt}
          onOpen={() => setShowOrderedAtPicker(true)}
        />
        <OrderedAtPickerModal
          open={showOrderedAtPicker}
          theme={theme}
          initialValue={orderedAt}
          onClose={() => setShowOrderedAtPicker(false)}
          onSave={(next) => {
            setOrderedAt(next);
            setShowOrderedAtPicker(false);
          }}
        />

        {/* Caption */}
        <div style={{ marginBottom: 14 }}>
          <FieldLabel theme={theme} optional>Caption</FieldLabel>
          <textarea value={caption} onChange={e => setCaption(e.target.value)}
            disabled={saving}
            placeholder="How was it?" rows={2}
            style={{ ...fInput(theme), resize: 'none', minHeight: 44, opacity: saving ? 0.7 : 1 }} />
        </div>

        {/* Drinks */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <FieldLabel theme={theme} noMargin>Drinks</FieldLabel>
          <button type="button" disabled={saving} onClick={addDrink} style={{ background: 'none', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: theme.sans, fontSize: 13, color: theme.accent, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, padding: 0, opacity: saving ? 0.45 : 1 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" stroke={theme.accent} strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            Add drink
          </button>
        </div>

        {drinks.map((drink, i) => (
          <DrinkEntry key={drink.id} drink={drink} theme={theme}
            locked={saving}
            canRemove={drinks.length > 1}
            onRemove={() => removeDrink(drink.id)}
            onUpdate={(k, v) => updateDrink(drink.id, k, v)}
            onUpdateProfile={(k, v) => updateProfile(drink.id, k, v)}
            onToggleNote={n => toggleNote(drink.id, n)} />
        ))}
      </div>
      )}
    </div>
  );
}

function LocationPicker({
  theme, saving, selectedBrand, branches, branchPhotos,
  selectedBranch, setSelectedBranch, brandEvents, mode, setMode,
  selectedEvent, setSelectedEvent, onAddEvent, lockedEvent = null,
}) {
  if (!selectedBrand && !lockedEvent) return null;
  const hasBranches = branches.length > 0;
  const buckets = window.partitionEvents ? window.partitionEvents(brandEvents || []) : { ongoing: [], upcoming: [], past: [], activeUpcoming: [] };
  const displayedEvents = lockedEvent
    ? [lockedEvent]
    : [
      ...(buckets.ongoing || []),
      ...(buckets.past || []),
      ...(buckets.upcoming || []),
    ];

  const showToggle = hasBranches && !lockedEvent;
  const inEventMode = mode === 'event' || Boolean(lockedEvent);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
        <FieldLabel theme={theme} noMargin optional>Location</FieldLabel>
        {showToggle && (
          <div style={{ display: 'inline-flex', borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.surface2, padding: 2 }}>
            {[['branch', 'Branch'], ['event', 'Event']].map(([id, label]) => {
              const on = mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={saving}
                  onClick={() => setMode(id)}
                  style={{
                    padding: '4px 11px', borderRadius: 999, border: 'none',
                    background: on ? theme.accent : 'transparent',
                    color: on ? (theme.onAccent || '#fff') : theme.muted,
                    fontFamily: theme.sans, fontSize: 11.5, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >{label}</button>
              );
            })}
          </div>
        )}
      </div>

      {!inEventMode && hasBranches && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {branches.map((br) => {
            const on = selectedBranch?.id === br.id;
            const photo = branchPhotos[br.id] || br.photoUrl || null;
            return (
              <button type="button" key={br.id} disabled={saving} onClick={() => setSelectedBranch(on ? null : br)} style={{
                width: 126, flexShrink: 0, padding: 0, borderRadius: 12, cursor: saving ? 'not-allowed' : 'pointer',
                background: theme.card, color: theme.text,
                border: `1.5px solid ${on ? theme.accent : theme.border}`,
                overflow: 'hidden', textAlign: 'left', transition: 'all 130ms', opacity: saving ? 0.65 : 1,
              }}>
                <div style={{ width: '100%', height: 84 }}>
                  {photo ? (
                    <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Placeholder label="" hue={selectedBrand.hue || 120} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                  )}
                </div>
                <div style={{ padding: '8px 8px 9px' }}>
                  <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.text, lineHeight: 1.2 }}>
                    {br.name}
                  </div>
                  <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, marginTop: 2, lineHeight: 1.2 }}>
                    {br.neighborhood || br.address || 'Location'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {inEventMode && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {displayedEvents.map((ev) => (
            <EventTile
              key={ev.id}
              theme={theme}
              event={ev}
              selected={selectedEvent?.id === ev.id}
              locked={saving || Boolean(lockedEvent)}
              taggable={isEventTaggable(ev)}
              onClick={() => {
                if (lockedEvent) return;
                setSelectedEvent(selectedEvent?.id === ev.id ? null : { id: ev.id });
              }}
            />
          ))}
          {!lockedEvent && (
          <PopUpSpecialTile
            theme={theme}
            label="+ Add event"
            sublabel="Record a new pop-up or appearance"
            selected={false}
            disabled={saving}
            onClick={onAddEvent}
          />
          )}
        </div>
      )}
    </div>
  );
}

function EventTile({ theme, event, selected, locked, taggable = true, onClick }) {
  const cannotSelect = locked || !taggable;
  const BRANDS = Array.isArray(window.BRANDS) ? window.BRANDS : [];
  const isPopup = event?.type === 'popup';
  const merchants = (event?.merchantIds || []).map((id) => BRANDS.find((b) => b.id === id)).filter(Boolean);
  const title = isPopup && merchants.length === 1
    ? `${merchants[0].name} @ ${event.subtitle || event.location}`
    : (event?.title || 'Event');
  const dateLabel = window.formatPopUpDates && window.eventDateKeys
    ? window.formatPopUpDates(window.eventDateKeys(event))
    : '';
  const badge = event?.status === 'ongoing' ? 'NOW' : event?.status === 'upcoming' ? 'SOON' : '';
  return (
    <button
      type="button"
      disabled={cannotSelect}
      onClick={onClick}
      style={{
        width: 162, minHeight: 124, flexShrink: 0, padding: '10px 11px', borderRadius: 12,
        cursor: cannotSelect ? 'not-allowed' : 'pointer',
        background: selected ? theme.accentLight : theme.card,
        color: theme.text,
        border: `1.5px solid ${selected ? theme.accent : theme.border}`,
        textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4,
        opacity: locked ? 0.65 : (!taggable ? 0.48 : 1),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: 1, fontFamily: theme.sans, fontSize: 12, fontWeight: 600, color: theme.text, lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {title}
        </span>
        {badge && (
          <span style={{
            fontFamily: theme.sans, fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
            padding: '1px 5px', borderRadius: 999,
            color: event?.status === 'ongoing' ? theme.accent : theme.text,
            border: `1px solid ${event?.status === 'ongoing' ? theme.accent : theme.border}`,
          }}>{badge}</span>
        )}
      </div>
      {dateLabel ? (
        <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.text, lineHeight: 1.3 }}>{dateLabel}</div>
      ) : null}
      {event?.location ? (
        <div style={{ fontFamily: theme.sans, fontSize: 10.5, color: theme.muted, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {event.location}
        </div>
      ) : null}
    </button>
  );
}

function PopUpSpecialTile({ theme, label, sublabel, selected, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 138, minHeight: 124, flexShrink: 0, padding: '10px 11px', borderRadius: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: selected ? theme.accentLight : theme.card,
        color: theme.text,
        border: `1.5px dashed ${selected ? theme.accent : theme.border}`,
        textAlign: 'left', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{ fontFamily: theme.sans, fontSize: 12.5, fontWeight: 600, color: selected ? theme.accent : theme.text }}>{label}</span>
      {sublabel ? (
        <span style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted }}>{sublabel}</span>
      ) : null}
    </button>
  );
}

function formatOrderedAtLabel(value) {
  const raw = typeof value === 'string'
    ? value
    : (value && value.value ? String(value.value) : '');
  if (!raw) return 'Set date';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function OrderedAtField({ theme, value, onOpen }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <FieldLabel theme={theme} optional>Ordered on</FieldLabel>
      <button
        type="button"
        onClick={onOpen}
        style={{
          width: '100%', textAlign: 'left', padding: '11px 13px',
          background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 10,
          fontFamily: theme.sans, fontSize: 14, fontWeight: 400, color: value ? theme.text : theme.muted, cursor: 'pointer',
        }}
      >
        {formatOrderedAtLabel(value)}
      </button>
    </div>
  );
}

function OrderedAtPickerModal({ open, theme, initialValue, onClose, onSave }) {
  const [dayValue, setDayValue] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    const iv = typeof initialValue === 'string'
      ? initialValue
      : (initialValue && initialValue.value ? String(initialValue.value) : '');
    if (iv) {
      setDayValue(iv);
      return;
    }
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    setDayValue(`${y}-${m}-${day}`);
  }, [open, initialValue]);

  if (!open) return null;

  const save = () => {
    onSave?.(dayValue || null);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', maxWidth: 540, margin: '0 auto', background: theme.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, border: `1px solid ${theme.border}`, borderBottom: 'none', padding: '18px 18px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 700, color: theme.text }}>Ordered on</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: theme.muted, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>&times;</button>
        </div>
        <input
          type="date"
          value={dayValue}
          onChange={(e) => setDayValue(e.target.value)}
          style={{ ...fInput(theme), marginBottom: 12, textAlign: 'center', fontSize: 22, fontWeight: 600, minHeight: 58 }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button type="button" onClick={() => onSave?.(null)} style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface2, fontFamily: theme.sans, fontSize: 13, cursor: 'pointer', color: theme.text }}>Clear</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.surface2, fontFamily: theme.sans, fontSize: 13, cursor: 'pointer', color: theme.text }}>Cancel</button>
            <button type="button" onClick={save} style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: theme.accent, color: theme.onAccent || '#fff', fontFamily: theme.sans, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewFieldLabel({ children, theme, style }) {
  return (
    <div style={{
      fontFamily: theme.sans,
      fontSize: 12,
      fontWeight: 600,
      color: theme.text,
      marginBottom: 6,
      ...style,
    }}>{children}</div>
  );
}

function ReviewTierSection({ title, expanded, onToggle, locked, theme, children, style }) {
  const chevron = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
  const chevronWrap = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 0,
    opacity: 0.55,
    transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
    transition: 'transform 180ms ease',
  };
  const titleStyle = {
    fontFamily: theme.sans,
    fontSize: 11,
    fontWeight: 600,
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  };

  return (
    <div style={style}>
      <button
        type="button"
        disabled={locked}
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          padding: expanded ? '6px 0 8px' : '4px 0',
          cursor: locked ? 'not-allowed' : 'pointer',
          opacity: locked ? 0.45 : 1,
        }}
      >
        {expanded ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={titleStyle}>{title}</span>
            <span style={chevronWrap}>{chevron}</span>
          </span>
        ) : (
          <span style={chevronWrap}>{chevron}</span>
        )}
      </button>
      {expanded && children}
    </div>
  );
}

function DrinkEntry({ drink, theme, locked, canRemove, onRemove, onUpdate, onUpdateProfile, onToggleNote }) {
  const [showSuggs, setShowSuggs] = React.useState(false);
  const [nameSuggs, setNameSuggs] = React.useState([]);

  const onNameType = v => {
    onUpdate('name', v);
    const s = v.length > 0 ? DRINK_SUGGESTIONS.filter(x => x.toLowerCase().includes(v.toLowerCase())).slice(0, 4) : [];
    setNameSuggs(s);
    setShowSuggs(s.length > 0);
  };

  const allNotes = ['grassy', 'umami', 'nutty', 'vegetal', 'creamy', 'citrus', 'fruity', 'sweet', 'toasted', 'earthy', 'buttery', 'floral', 'bitter', 'mild'];

  const rowIn = fRowInput(theme);

  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 10, overflow: 'hidden', background: theme.card }}>
      <div style={{ padding: '12px 12px 10px' }}>
        {/* Name + expand + remove — one row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'nowrap' }}>
          <button
            type="button"
            disabled={locked}
            aria-label={drink.recommended ? 'Unmark favorite drink' : 'Mark favorite drink'}
            onClick={() => onUpdate('recommended', !drink.recommended)}
            style={{
              width: 28, height: 28, flexShrink: 0,
              background: 'none', border: 'none', padding: 0,
              cursor: locked ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: locked ? 0.45 : 1,
            }}
          >
            <IconHeart size={18} filled={Boolean(drink.recommended)} stroke={drink.recommended ? theme.accent : theme.muted} />
          </button>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
              <input value={drink.name} onChange={e => onNameType(e.target.value)}
                disabled={locked}
                onBlur={() => setTimeout(() => setShowSuggs(false), 150)}
                placeholder="Drink name"
                style={{ ...rowIn, width: '100%', opacity: locked ? 0.7 : 1 }} />
              {showSuggs && nameSuggs.length > 0 && !locked && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 10, boxShadow: theme.shadow, marginTop: 2, overflow: 'hidden' }}>
                  {nameSuggs.map(s => (
                    <button key={s} type="button" onMouseDown={() => { onUpdate('name', s); setShowSuggs(false); }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: theme.sans, fontSize: 13, color: theme.text, borderBottom: `1px solid ${theme.border}` }}>{s}</button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={locked}
              aria-label={drink.expanded ? 'Hide drink details' : 'Show drink details'}
              aria-expanded={drink.expanded}
              onClick={() => onUpdate('expanded', !drink.expanded)}
              style={{
                width: 24, height: 24, flexShrink: 0,
                background: 'none',
                border: 'none',
                cursor: locked ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: locked ? 0.45 : 0.5,
                padding: 0,
                marginRight: canRemove ? 0 : -2,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: drink.expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 180ms ease' }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
          {canRemove && (
            <button type="button" disabled={locked} onClick={onRemove} style={{ background: 'none', border: 'none', padding: 4, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.45 : 1, flexShrink: 0, alignSelf: 'center' }}>
              <IconClose size={14} stroke={theme.muted} sw={2} />
            </button>
          )}
        </div>
      </div>

      {drink.expanded && (
        <div style={{ borderTop: `1px solid ${theme.border}`, padding: '13px 12px 14px' }}>
          <ReviewFieldLabel theme={theme}>Description</ReviewFieldLabel>
          <textarea value={drink.notes} onChange={e => onUpdate('notes', e.target.value)}
            disabled={locked}
            placeholder="Tasting notes..." rows={2}
            style={{ ...fInput(theme), resize: 'none', marginBottom: 14, opacity: locked ? 0.7 : 1 }} />

          <ReviewTierSection
            title="The Drink"
            expanded={drink.drinkTierExpanded !== false}
            onToggle={() => {
              const isOpen = drink.drinkTierExpanded !== false;
              onUpdate('drinkTierExpanded', !isOpen);
              if (isOpen && drink.matchaExpanded) onUpdate('matchaExpanded', false);
            }}
            locked={locked}
            theme={theme}
            style={{ marginBottom: drink.drinkTierExpanded !== false ? 14 : 0, marginTop: 4 }}
          >
            {DRINK_PROFILE_SCALES.map(({ key, label, low, high }) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <ReviewFieldLabel theme={theme} style={{ marginBottom: 4 }}>{label}</ReviewFieldLabel>
                <FlavorScale
                  value={drink.profile[key]}
                  onChange={(v) => onUpdateProfile(key, v)}
                  lowLabel={low}
                  highLabel={high}
                  theme={theme}
                  disabled={locked}
                />
              </div>
            ))}
          </ReviewTierSection>

          {drink.drinkTierExpanded !== false && (
          <ReviewTierSection
            title="The Matcha"
            expanded={Boolean(drink.matchaExpanded)}
            onToggle={() => onUpdate('matchaExpanded', !drink.matchaExpanded)}
            locked={locked}
            theme={theme}
          >
            <div style={{ marginBottom: 14 }}>
              <ReviewFieldLabel theme={theme} style={{ marginBottom: 8 }}>Flavor notes</ReviewFieldLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {allNotes.map(n => {
                  const on = drink.flavorNotes.includes(n);
                  return (
                    <button type="button" key={n} disabled={locked} onClick={() => onToggleNote(n)} style={{
                      padding: '5px 11px', borderRadius: 999, cursor: locked ? 'not-allowed' : 'pointer',
                      background: on ? theme.accent : theme.surface2,
                      color: on ? '#fff' : theme.text,
                      border: `1px solid ${on ? theme.accent : theme.border}`,
                      fontFamily: theme.sans, fontSize: 12, fontWeight: on ? 600 : 400,
                      transition: 'all 120ms',
                      opacity: locked ? 0.65 : 1,
                    }}>{n}</button>
                  );
                })}
              </div>
            </div>

            {MATCHA_PROFILE_SCALES.map(({ key, label, low, high }) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <ReviewFieldLabel theme={theme} style={{ marginBottom: 4 }}>{label}</ReviewFieldLabel>
                <FlavorScale
                  value={drink.profile[key]}
                  onChange={(v) => onUpdateProfile(key, v)}
                  lowLabel={low}
                  highLabel={high}
                  theme={theme}
                  disabled={locked}
                />
              </div>
            ))}
          </ReviewTierSection>
          )}
        </div>
      )}
    </div>
  );
}

// Compact 1–5 flavor scale — click or drag anywhere on track + numbers
function FlavorScale({ value, onChange, lowLabel, highLabel, theme, disabled }) {
  const v = Number(value) || 0;
  const regionRef = React.useRef(null);
  const activeRef = React.useRef(false);
  const [dragging, setDragging] = React.useState(false);
  const thumbLeft = v > 0 ? `${((v - 1) / 4) * 100}%` : '0%';

  const pickValue = React.useCallback((clientX) => {
    const el = regionRef.current;
    if (!el || disabled) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChange(Math.round(ratio * 4) + 1);
  }, [disabled, onChange]);

  const onPointerDown = (e) => {
    if (disabled) return;
    activeRef.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    pickValue(e.clientX);
  };

  const onPointerMove = (e) => {
    if (disabled || !activeRef.current) return;
    pickValue(e.clientX);
  };

  const endPointer = (e) => {
    activeRef.current = false;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  const motion = dragging ? 'none' : 'left 80ms ease, width 80ms ease';

  return (
    <div style={{ opacity: disabled ? 0.65 : 1 }}>
      <div
        ref={regionRef}
        role="slider"
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={v > 0 ? v : undefined}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        style={{
          position: 'relative',
          padding: '4px 2px 0',
          touchAction: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 10, height: 3, borderRadius: 999,
          background: theme.surface2, border: `1px solid ${theme.border}`, pointerEvents: 'none',
        }} />
        {v > 0 && (
          <div style={{
            position: 'absolute', left: 0, width: thumbLeft, top: 10, height: 3, borderRadius: 999,
            background: theme.accent, pointerEvents: 'none', transition: motion,
          }} />
        )}
        {v > 0 && (
          <div style={{
            position: 'absolute', left: thumbLeft, top: 5, width: 12, height: 12, marginLeft: -6,
            borderRadius: '50%', background: '#fff', border: `2px solid ${theme.accent}`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)', pointerEvents: 'none',
            transition: motion,
          }} />
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 18, pointerEvents: 'none' }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              style={{
                width: 16, textAlign: 'center',
                fontFamily: theme.sans, fontSize: v === n ? 12 : 10, lineHeight: 1,
                fontWeight: v === n ? 700 : 500,
                color: v === n ? theme.accent : theme.muted,
              }}
            >{n}</span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
        <span style={{ fontFamily: theme.sans, fontSize: 10, color: theme.muted, lineHeight: 1.2 }}>{lowLabel}</span>
        <span style={{ fontFamily: theme.sans, fontSize: 10, color: theme.muted, lineHeight: 1.2, textAlign: 'right' }}>{highLabel}</span>
      </div>
    </div>
  );
}

function FieldLabel({ children, theme, noMargin, optional = false }) {
  const labelStyle = { fontFamily: theme.sans, fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4 };
  if (optional) {
    return (
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: noMargin ? 0 : 6 }}>
        <div style={labelStyle}>{children}</div>
        <Opt theme={theme} />
      </div>
    );
  }
  return (
    <div style={{ ...labelStyle, marginBottom: noMargin ? 0 : 6 }}>{children}</div>
  );
}

function Opt({ theme }) {
  return <span style={{ fontFamily: theme.sans, fontWeight: 400, fontSize: 11, color: theme.muted, textTransform: 'none', letterSpacing: 0 }}>optional</span>;
}

function fInput(theme) {
  return {
    width: '100%', padding: '11px 13px',
    background: theme.surface2, border: `1px solid ${theme.border}`,
    borderRadius: 10, outline: 'none',
    fontFamily: theme.sans, fontSize: 14, color: theme.text,
    fontWeight: 400, boxSizing: 'border-box',
  };
}

/** Compact row inputs (~40px row height). */
function fRowInput(theme) {
  return {
    minHeight: 40,
    padding: '10px 12px',
    background: theme.surface2,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    outline: 'none',
    fontFamily: theme.sans,
    fontSize: 14,
    color: theme.text,
    fontWeight: 400,
    boxSizing: 'border-box',
  };
}

window.LogScreen = LogScreen;
