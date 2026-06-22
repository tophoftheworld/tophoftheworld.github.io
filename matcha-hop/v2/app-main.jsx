const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "variant": "cream"
}/*EDITMODE-END*/;

const THEMES = {
  cream: {
    name: 'Light',
    surface: '#FFFFFF',
    surface2: '#F5F5F5',
    card: '#FFFFFF',
    text: '#0A0A0A',
    muted: '#737373',
    border: '#E8E8E8',
    accent: '#239c02',
    accentLight: '#E8F5E2',
    onAccent: '#FFFFFF',
    shadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.07)',
    shadowSm: '0 1px 2px rgba(0,0,0,0.05)',
    shadowLg: '0 4px 16px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
    sans: "'Geist', system-ui, sans-serif",
    mapBg: '#F0F4F0',
    mapPark: '#c8e0b4',
    mapWater: '#b8d4e8',
    mapRoad: '#FFFFFF',
    mapRoad2: '#E2E8E4',
    mapLabel: '#8A9488',
  },
  ink: {
    name: 'Dark',
    surface: '#0B0F0C',
    surface2: '#141914',
    card: '#181E18',
    text: '#F0F2F0',
    muted: '#7A887A',
    border: '#242A24',
    accent: 'oklch(0.78 0.20 140)',
    accentLight: 'rgba(60,180,40,0.15)',
    onAccent: '#0B0F0C',
    shadow: '0 1px 2px rgba(0,0,0,0.25), 0 2px 10px rgba(0,0,0,0.35)',
    shadowSm: '0 1px 2px rgba(0,0,0,0.3)',
    shadowLg: '0 4px 20px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.3)',
    sans: "'Geist', system-ui, sans-serif",
    mapBg: '#101510',
    mapPark: 'oklch(0.28 0.07 145)',
    mapWater: 'oklch(0.30 0.05 210)',
    mapRoad: '#1C221C',
    mapRoad2: '#161B16',
    mapLabel: '#4A564A',
  },
};

function getInitialBootState() {
  if (window.__V2_FATAL__) return 'error';
  if (window.__V2_BOOTSTRAP_OK__) return 'ready';
  return 'loading';
}

function navFrameKey(screen) {
  const id = screen.postId || screen.brandId || screen.listId || screen.eventId || screen.branchId || '';
  return `${screen.name}-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Map pin / search result without a gallery brand — same screen as a branch, with Post + posts grid. */
function buildStandaloneLocationScreen(pin) {
  const pid = pin?.placeId;
  if (!pid) return null;
  const cafeId = window.V2Live?.resolveCafeIdForPlace?.(pid)
    || `gp_${String(pid).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}`;
  const bid = `gplace_${pid}`;
  const title = pin.name || pin.sub || 'Location';
  const addr = String(pin.sub || pin.address || '').trim();
  const branch = {
    id: cafeId,
    placeId: pid,
    name: title,
    address: addr,
    lat: pin.lat,
    lng: pin.lng,
    neighborhood: '',
  };
  const brand = {
    id: bid,
    name: title,
    kind: 'cafe',
    hue: 120,
    branches: [branch],
  };
  return {
    name: 'branch',
    brandId: bid,
    branchId: cafeId,
    standaloneBrand: brand,
    standaloneBranch: branch,
    isStandaloneLocation: true,
  };
}

function App() {
  const [tweaks] = React.useState(TWEAK_DEFAULTS);
  const [tab, setTab] = React.useState('feed');
  const [, setDataVersion] = React.useState(0);
  const [navStack, setNavStack] = React.useState([]);
  const [bootState, setBootState] = React.useState(getInitialBootState);
  const [showReloadHint, setShowReloadHint] = React.useState(false);
  const [debugLines, setDebugLines] = React.useState(() => {
    try { return window.__V2_DEBUG__?.read?.() || []; } catch (_) { return []; }
  });
  const theme = THEMES[tweaks.variant] || THEMES.cream;
  const tabRef = React.useRef(tab);
  React.useEffect(() => { tabRef.current = tab; }, [tab]);

  React.useEffect(() => {
    const onOk = () => setBootState('ready');
    const onErr = () => setBootState('error');
    window.addEventListener('v2:bootstrap-ok', onOk);
    window.addEventListener('v2:bootstrap-error', onErr);
    if (window.__V2_BOOTSTRAP_OK__) setBootState('ready');
    if (window.__V2_FATAL__) setBootState('error');
    return () => {
      window.removeEventListener('v2:bootstrap-ok', onOk);
      window.removeEventListener('v2:bootstrap-error', onErr);
    };
  }, []);

  React.useEffect(() => {
    if (bootState !== 'loading') {
      setShowReloadHint(false);
      return undefined;
    }
    let cancelled = false;
    const poll = window.setInterval(() => {
      if (cancelled) return;
      if (window.__V2_BOOTSTRAP_OK__) setBootState('ready');
    }, 250);
    const reloadHintTimer = window.setTimeout(() => {
      if (!cancelled && !window.__V2_BOOTSTRAP_OK__) setShowReloadHint(true);
    }, 35000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearTimeout(reloadHintTimer);
    };
  }, [bootState]);

  React.useEffect(() => {
    const handler = () => setDataVersion((v) => v + 1);
    window.addEventListener('v2:data-updated', handler);
    return () => window.removeEventListener('v2:data-updated', handler);
  }, []);

  React.useEffect(() => {
    const syncDebug = () => {
      try { setDebugLines(window.__V2_DEBUG__?.read?.() || []); } catch (_) {}
    };
    const onOk = () => window.__V2_DEBUG__?.push?.('INFO', 'bootstrap ok');
    const onErr = () => {
      const msg = window.__V2_FATAL__?.message || 'bootstrap error';
      window.__V2_DEBUG__?.push?.('ERROR', msg);
      syncDebug();
    };
    syncDebug();
    window.addEventListener('v2:debug-updated', syncDebug);
    window.addEventListener('v2:bootstrap-ok', onOk);
    window.addEventListener('v2:bootstrap-error', onErr);
    return () => {
      window.removeEventListener('v2:debug-updated', syncDebug);
      window.removeEventListener('v2:bootstrap-ok', onOk);
      window.removeEventListener('v2:bootstrap-error', onErr);
    };
  }, []);

  const DebugPanel = ({ lines }) => (
    <div style={{
      marginTop: 14,
      width: '100%',
      maxWidth: 420,
      maxHeight: 190,
      overflowY: 'auto',
      textAlign: 'left',
      padding: '10px 11px',
      borderRadius: 10,
      border: `1px solid ${theme.border}`,
      background: theme.card,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 11,
      lineHeight: 1.45,
      color: theme.text,
      wordBreak: 'break-word',
    }}>
      {(lines && lines.length ? lines : ['[debug] no logs yet']).map((line, i) => (
        <div key={`dbg-${i}`}>{line}</div>
      ))}
    </div>
  );

  const pushScreen = React.useCallback((screen) => {
    setNavStack((s) => {
      const entry = {
        ...screen,
        _key: navFrameKey(screen),
      };
      if (s.length === 0) {
        entry._fromTabs = { tab: tabRef.current };
      }
      return [...s, entry];
    });
  }, []);

  const goBack = React.useCallback(() => {
    setNavStack((s) => {
      if (s.length === 0) return s;
      const popped = s[s.length - 1];
      const next = s.slice(0, -1);
      if (next.length === 0 && popped._fromTabs?.tab) {
        setTab(popped._fromTabs.tab);
      }
      return next;
    });
  }, []);

  const openBrand = React.useCallback((id) => pushScreen({ name: 'brand', brandId: id }), [pushScreen]);
  const openPost = React.useCallback((id) => pushScreen({ name: 'post', postId: id }), [pushScreen]);
  const openLog = React.useCallback((ctx) => pushScreen({ name: 'log', context: ctx || {} }), [pushScreen]);
  const openBrandFeed = React.useCallback((id) => pushScreen({ name: 'brandFeed', brandId: id }), [pushScreen]);
  const openBrandEvents = React.useCallback((id) => pushScreen({ name: 'brandEvents', brandId: id }), [pushScreen]);
  const openList = React.useCallback((id) => pushScreen({ name: 'list', listId: id }), [pushScreen]);
  const openEvent = React.useCallback((id) => pushScreen({ name: 'event', eventId: id }), [pushScreen]);
  const openProfile = React.useCallback(() => pushScreen({ name: 'profile' }), [pushScreen]);

  const openBranchOrBrand = React.useCallback((bId, brId) => {
    const brands = Array.isArray(window.BRANDS) ? window.BRANDS : [];
    const brand = brands.find((b) => b.id === bId);
    const branchCount = Array.isArray(brand?.branches) ? brand.branches.length : 0;
    if (branchCount <= 1) {
      pushScreen({ name: 'brand', brandId: bId });
      return;
    }
    pushScreen({ name: 'branch', brandId: bId, branchId: brId });
  }, [pushScreen]);

  const saveFromLog = React.useCallback(async (payload) => {
    if (payload?.kind === 'list') {
      if (payload.listId && window.V2Live?.updateList) {
        await window.V2Live.updateList(payload.listId, {
          name: payload.name,
          description: payload.description,
          entries: payload.entries,
        });
      } else if (window.V2Live?.createList) {
        await window.V2Live.createList({
          name: payload.name,
          description: payload.description,
          entries: payload.entries,
        });
      }
    } else if (window.V2Live?.savePost) {
      await window.V2Live.savePost(payload || {});
    }
    setDataVersion((v) => v + 1);
    goBack();
  }, [goBack]);

  const deleteListAndNavigate = React.useCallback(async (listId) => {
    const id = String(listId || '').trim();
    if (!id) throw new Error('List id required');
    if (!window.V2Live?.deleteList) throw new Error('Not available');
    await window.V2Live.deleteList(id);
    setDataVersion((v) => v + 1);
    setNavStack((s) => {
      const next = s.filter((f) => !(
        (f.name === 'list' && String(f.listId) === id)
        || (f.name === 'log' && String(f.context?.editListId) === id)
      ));
      if (next.length === 0 && s.length > 0) {
        const from = s.find((f) => f._fromTabs)?._fromTabs;
        if (from?.tab) setTab(from.tab);
      }
      return next;
    });
  }, []);

  const handleTabChange = React.useCallback((id) => {
    if (id === '_fab') return;
    setNavStack((s) => (s.length ? [] : s));
    setTab(id);
  }, []);

  const handlePlus = React.useCallback(() => {
    const top = navStack.length > 0 ? navStack[navStack.length - 1] : null;
    if (top?.name === 'event') {
      const ev = (window.EVENTS || []).find((e) => String(e.id) === String(top.eventId));
      const status = ev && typeof window.effectiveEventStatus === 'function'
        ? window.effectiveEventStatus(ev)
        : ev?.status;
      if (ev && (status === 'ongoing' || status === 'past')) {
        openLog({ eventId: top.eventId });
        return;
      }
    }
    openLog({});
  }, [navStack, openLog]);

  const tabBar = (
    <TabBar current={tab} onChange={handleTabChange} theme={theme} onPlus={handlePlus} />
  );

  const renderNavFrame = (frame) => {
    switch (frame.name) {
      case 'log':
        return (
          <LogScreen
            theme={theme}
            context={frame.context}
            onClose={goBack}
            onSave={saveFromLog}
            onDeleteList={deleteListAndNavigate}
          />
        );
      case 'brand':
        return (
          <BrandDetailScreen
            theme={theme}
            brandId={frame.brandId}
            onBack={goBack}
            onOpenPost={openPost}
            onOpenBranch={openBranchOrBrand}
            onViewAllPosts={openBrandFeed}
            onViewAllEvents={openBrandEvents}
            onPost={() => openLog({ brandId: frame.brandId })}
            onOpenEvent={openEvent}
          />
        );
      case 'brandFeed':
        return (
          <FeedScreen
            theme={theme}
            onOpenPost={openPost}
            onOpenBrand={openBrand}
            brandFilterId={frame.brandId}
            onBack={goBack}
            onOpenList={openList}
          />
        );
      case 'brandEvents':
        return (
          <BrandEventsListScreen
            theme={theme}
            brandId={frame.brandId}
            onBack={goBack}
            onOpenEvent={openEvent}
          />
        );
      case 'branch':
        return (
          <BranchDetailScreen
            theme={theme}
            brandId={frame.brandId}
            branchId={frame.branchId}
            standaloneBrand={frame.standaloneBrand}
            standaloneBranch={frame.standaloneBranch}
            isStandaloneLocation={frame.isStandaloneLocation}
            onBack={goBack}
            onOpenPost={openPost}
            onOpenBrand={openBrand}
            onPost={() => {
              if (frame.isStandaloneLocation && frame.standaloneBrand && frame.standaloneBranch) {
                openLog({ syntheticBrand: frame.standaloneBrand, syntheticBranch: frame.standaloneBranch });
              } else {
                openLog({ brandId: frame.brandId, branchId: frame.branchId });
              }
            }}
          />
        );
      case 'post':
        return (
          <PostDetailScreen
            theme={theme}
            postId={frame.postId}
            onBack={goBack}
            onOpenBrand={openBrand}
            onEditPost={(id) => openLog({ editPostId: id })}
          />
        );
      case 'list':
        return (
          <ListDetailScreen
            theme={theme}
            listId={frame.listId}
            onBack={goBack}
            onOpenBrand={openBrand}
            onOpenPost={openPost}
            onOpenLocation={(row) => {
              const branch = row?.branch || row?.brand?.branches?.[0];
              const pin = {
                placeId: branch?.placeId || row?.entry?.placeId,
                name: row?.label || row?.brand?.name,
                address: branch?.address || row?.entry?.placeAddress || row?.sublabel,
                lat: branch?.lat,
                lng: branch?.lng,
              };
              const next = buildStandaloneLocationScreen(pin);
              if (next) pushScreen(next);
            }}
            onEditList={(id) => openLog({ mode: 'list', editListId: id })}
          />
        );
      case 'event':
        return (
          <>
            <EventDetailScreen theme={theme} eventId={frame.eventId} onBack={goBack} onOpenBrand={openBrand} bottomInset={88} />
            {tabBar}
          </>
        );
      case 'profile':
        return (
          <UserProfileScreen
            theme={theme}
            onClose={goBack}
            onOpenPost={(id) => pushScreen({ name: 'post', postId: id })}
            onOpenList={(id) => pushScreen({ name: 'list', listId: id })}
            onNewList={() => pushScreen({ name: 'log', context: { mode: 'list' } })}
          />
        );
      default:
        return null;
    }
  };

  const renderContent = () => {
    const baseHidden = navStack.length > 0;
    const baseLayerStyle = {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minHeight: 0,
      visibility: baseHidden ? 'hidden' : 'visible',
      pointerEvents: baseHidden ? 'none' : 'auto',
    };
    const navLayerStyle = (index, isTop) => ({
      display: isTop ? 'flex' : 'none',
      flexDirection: 'column',
      position: 'absolute',
      inset: 0,
      zIndex: 10 + index,
      background: theme.surface,
      overflow: 'hidden',
      minHeight: 0,
    });

    return (
      <>
        <div style={baseLayerStyle}>
          {tab === 'map' && (
            <MapScreen
              theme={theme}
              onOpenEvent={openEvent}
              onOpenDetail={(pin) => {
                if (pin?.eventId) return openEvent(pin.eventId);
                if (pin?.brandId && pin?.branchId) return openBranchOrBrand(pin.brandId, pin.branchId);
                if (pin?.brandId) pushScreen({ name: 'brand', brandId: pin.brandId });
              }}
              onOpenBrand={openBrand}
              onOpenStandaloneLocation={(pin) => {
                const next = buildStandaloneLocationScreen(pin);
                if (next) pushScreen(next);
              }}
              onOpenProfile={openProfile}
            />
          )}
          {tab === 'brands' && <BrandsScreen theme={theme} onOpenBrand={openBrand} />}
          {tab === 'feed' && (
            <FeedScreen
              theme={theme}
              onOpenPost={openPost}
              onOpenBrand={openBrand}
              onOpenList={openList}
              onOpenProfile={openProfile}
            />
          )}
          {tab === 'events' && (
            <EventsScreen
              theme={theme}
              onOpenEvent={openEvent}
              onOpenProfile={openProfile}
            />
          )}
          {!baseHidden && tabBar}
        </div>
        {navStack.map((frame, i) => (
          <div key={frame._key} style={navLayerStyle(i, i === navStack.length - 1)}>
            {renderNavFrame(frame)}
          </div>
        ))}
      </>
    );
  };

  if (bootState === 'error') {
    const msg = (window.__V2_FATAL__ && window.__V2_FATAL__.message) || 'Something went wrong.';
    return (
      <div className="stage" style={{ fontFamily: theme.sans, background: theme.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 8 }}>Matcha Map cannot load</div>
          <div style={{ fontSize: 14, color: theme.muted, lineHeight: 1.5 }}>{msg}</div>
          <DebugPanel lines={debugLines} />
        </div>
      </div>
    );
  }

  if (bootState === 'loading') {
    return (
      <div className="stage" style={{ fontFamily: theme.sans, background: theme.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 320, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: theme.muted }}>Loading...</div>
          {showReloadHint ? (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12, color: theme.muted, lineHeight: 1.45, marginBottom: 12 }}>Still loading. Check your connection and try reloading the page.</div>
              <button type="button" onClick={() => window.location.reload()} style={{ padding: '11px 22px', borderRadius: 999, border: 'none', cursor: 'pointer', background: theme.accent, color: theme.onAccent, fontFamily: theme.sans, fontSize: 14, fontWeight: 600 }}>Reload</button>
            </div>
          ) : null}
          <DebugPanel lines={debugLines} />
        </div>
      </div>
    );
  }

  return (
    <div className="stage" style={{ fontFamily: theme.sans, background: theme.surface }}>
      <div className="viewport-shell" style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        {renderContent()}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
