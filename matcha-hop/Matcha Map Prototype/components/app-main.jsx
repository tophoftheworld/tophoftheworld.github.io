// App shell — routing, themes, nav stack

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
  },
};

function App() {
  const [tweaks] = React.useState(TWEAK_DEFAULTS);
  const [tab, setTab] = React.useState('feed');
  const [navStack, setNavStack] = React.useState([]);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const theme = THEMES[tweaks.variant] || THEMES.cream;

  const push = React.useCallback((screen) => setNavStack(s => [...s, screen]), []);
  const pop  = React.useCallback(() => setNavStack(s => s.slice(0, -1)), []);

  const openBrand     = (id)        => push({ name: 'brand',     brandId: id });
  const openPost      = (id)        => push({ name: 'post',      postId: id });
  const openLog       = (ctx)       => push({ name: 'log',       context: ctx || {} });
  const openBrandFeed = (id)        => push({ name: 'brandFeed', brandId: id });
  const openList      = (id)        => push({ name: 'list',      listId: id });
  const openEvent     = (id)        => push({ name: 'event',     eventId: id });

  const openBranchOrBrand = (bId, brId) => {
    const brand = BRANDS.find(b => b.id === bId);
    const branchCount = brand?.branches?.length || 0;
    if (branchCount <= 1) { push({ name: 'brand', brandId: bId }); return; }
    push({ name: 'branch', brandId: bId, branchId: brId });
  };

  const saveFromLog = React.useCallback(async (payload) => {
    // In prototype: just pop back
    pop();
  }, [pop]);

  const view = navStack.length > 0 ? navStack[navStack.length - 1] : { name: 'tabs' };

  const renderContent = () => {
    switch (view.name) {
      case 'log':
        return <LogScreen theme={theme} context={view.context} onClose={pop} onSave={saveFromLog} />;

      case 'brand':
        return <BrandDetailScreen theme={theme} brandId={view.brandId} onBack={pop}
          onOpenPost={openPost} onOpenBranch={openBranchOrBrand}
          onViewAllPosts={openBrandFeed}
          onPost={() => openLog({ brandId: view.brandId })} />;

      case 'brandFeed':
        return <FeedScreen theme={theme} onOpenPost={openPost} onOpenBrand={openBrand}
          onOpenList={openList} brandFilterId={view.brandId} onBack={pop} />;

      case 'branch':
        return <BranchDetailScreen theme={theme} brandId={view.brandId} branchId={view.branchId}
          onBack={pop} onOpenPost={openPost} onOpenBrand={openBrand}
          onPost={() => openLog({ brandId: view.brandId, branchId: view.branchId })} />;

      case 'post':
        return <PostDetailScreen theme={theme} postId={view.postId} onBack={pop} onOpenBrand={openBrand} />;

      case 'list':
        return <ListDetailScreen theme={theme} listId={view.listId} onBack={pop}
          onOpenBrand={openBrand} onOpenPost={openPost} />;

      case 'event':
        return <EventDetailScreen theme={theme} eventId={view.eventId} onBack={pop} onOpenBrand={openBrand} />;

      default:
        return (
          <>
            {/* Map screen */}
            {tab === 'map' && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
                <AppBrandHeader theme={theme} onOpenProfile={() => setProfileOpen(true)} />
                <div style={{ flex: 1, position: 'relative', background: theme.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ textAlign: 'center', padding: 32 }}>
                    <div style={{ width: 56, height: 56, borderRadius: '50%', background: theme.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                      <IconMap size={26} stroke={theme.accent} sw={1.6} />
                    </div>
                    <div style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text, marginBottom: 6 }}>Map View</div>
                    <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, lineHeight: 1.5 }}>Google Maps integration<br/>requires API key configuration.</div>
                  </div>
                </div>
              </div>
            )}

            {/* Feed */}
            {tab === 'feed' && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
                <AppBrandHeader theme={theme} onOpenProfile={() => setProfileOpen(true)} />
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  <FeedScreen theme={theme} onOpenPost={openPost} onOpenBrand={openBrand} onOpenList={openList} />
                </div>
              </div>
            )}

            {/* Brands */}
            {tab === 'brands' && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  <BrandsScreen theme={theme} onOpenBrand={openBrand} />
                </div>
              </div>
            )}

            {/* Events */}
            {tab === 'events' && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                  <EventsScreen theme={theme} onOpenEvent={openEvent} />
                </div>
              </div>
            )}

            <TabBar current={tab} onChange={setTab} theme={theme} onPlus={() => openLog({})} />
          </>
        );
    }
  };

  return (
    <div className="stage" style={{ fontFamily: theme.sans, background: theme.surface }}>
      <div className="viewport-shell">
        {renderContent()}
        {/* Profile overlay */}
        {profileOpen && (
          <UserProfileScreen
            theme={theme}
            onClose={() => setProfileOpen(false)}
            onOpenPost={(id) => { setProfileOpen(false); openPost(id); }}
            onOpenList={(id) => { setProfileOpen(false); openList(id); }}
          />
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
