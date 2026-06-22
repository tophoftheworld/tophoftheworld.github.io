// Map screen — pannable, centers on selected café, no filters, minimal chrome.

function MapMerchantThumbs({ merchants, theme }) {
  if (!Array.isArray(merchants) || merchants.length === 0) return null;
  const shown = merchants.slice(0, 5);
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {shown.map((b, i) => (
          <div key={b.id} style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            overflow: 'hidden',
            flexShrink: 0,
            border: `2px solid ${theme.card}`,
            marginLeft: i === 0 ? 0 : -8,
            background: theme.surface2,
            position: 'relative',
            zIndex: shown.length - i,
          }}>
            {b.logoUrl ? (
              <img src={b.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Placeholder label="" hue={b.hue || 120} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
            )}
          </div>
        ))}
        {merchants.length > 5 ? (
          <div style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: theme.surface2,
            border: `2px solid ${theme.card}`,
            marginLeft: -8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            zIndex: 0,
          }}>
            <span style={{ fontFamily: theme.sans, fontSize: 9, fontWeight: 700, color: theme.muted }}>
              +{merchants.length - 5}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MapScreen({ theme, onOpenDetail, onOpenBrand, onOpenStandaloneLocation, onOpenProfile, onOpenEvent }) {
  const [selectedPin, setSelectedPin] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [resolvingPhoto, setResolvingPhoto] = React.useState(false);
  const [recenterBottom, setRecenterBottom] = React.useState(126);
  const mapRef = React.useRef(null);
  const sheetRef = React.useRef(null);

  React.useEffect(() => {
    let listener = null;
    let alive = true;
    const bind = async () => {
      for (let i = 0; i < 30; i += 1) {
        if (!alive) return;
        const gmap = await window.V2Live?.map?.getMap?.();
        if (gmap && window.google?.maps) {
          listener = window.google.maps.event.addListener(gmap, 'click', () => {
            void (async () => {
              const skip = await window.V2Live?.map?.shouldSkipBackgroundClick?.();
              if (skip) return;
              setSelectedPin(null);
              window.V2Live?.map?.deselect?.();
            })();
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    void bind();
    return () => {
      alive = false;
      if (listener && window.google?.maps?.event) {
        window.google.maps.event.removeListener(listener);
      }
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    const mount = async () => {
      if (!window.V2Live?.map?.mount || !mapRef.current) return;
      await window.V2Live.map.mount('v2-live-map', (pin) => {
        if (!active) return;
        if (!pin) {
          setSelectedPin(null);
          return;
        }
        setSelectedPin({
          ...pin,
          kind: pin.kind || null,
          eventId: pin.eventId || null,
          id: pin.id,
          title: pin.title || pin.name || '',
          name: pin.name || pin.title || pin.address || 'Location',
          sub: pin.sub || pin.address || '',
          lat: pin.lat,
          lng: pin.lng,
          visits: pin.visits || 0,
          avgRating: pin.avgRating || 0,
          photo: pin.photo || pin.coverPhoto || null,
          coverPhoto: pin.coverPhoto || pin.photo || null,
          coverHue: pin.coverHue,
          dateLabel: pin.dateLabel || '',
          type: pin.type || '',
          status: pin.status || '',
          location: pin.location || pin.address || '',
          merchantIds: pin.merchantIds || [],
          brandId: pin.brandId || null,
          branchId: pin.branchId || pin.id || null,
          placeId: pin.placeId || null,
          googleRating: Number(pin.googleRating) || 0,
          googleReviewCount: Number(pin.googleReviewCount) || 0,
        });
      });
      const waitForMapIdle = async () => {
        const gmap = await window.V2Live?.map?.getMap?.();
        if (!gmap || typeof window.google === 'undefined' || !window.google.maps) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          return;
        }
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1200);
          window.google.maps.event.addListenerOnce(gmap, 'idle', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      };
      await waitForMapIdle();
      if (!active) return;
      await window.V2Live?.map?.showCurated?.();
    };
    mount();
    const refreshPins = () => {
      if (!active) return;
      window.V2Live?.map?.showCurated?.();
    };
    window.addEventListener('v2:data-updated', refreshPins);
    return () => {
      active = false;
      window.removeEventListener('v2:data-updated', refreshPins);
    };
  }, []);

  React.useEffect(() => {
    const id = setTimeout(async () => {
      if (!window.V2Live?.map?.search) return;
      const q = String(search || '').trim();
      if (!q) setSelectedPin(null);
      await window.V2Live.map.search(q, (pin) => {
        setSelectedPin(pin || null);
      });
    }, 240);
    return () => clearTimeout(id);
  }, [search]);

  React.useEffect(() => {
    let active = true;
    const pin = selectedPin;
    if (!pin || pin.kind === 'event' || pin.photo || !pin.placeId || !window.V2Live?.getPlacePhoto) return undefined;
    setResolvingPhoto(true);
    window.V2Live.getPlacePhoto(pin.placeId, false)
      .then((photoUrl) => {
        if (!active || !photoUrl) return;
        setSelectedPin((prev) => {
          if (!prev || prev.id !== pin.id || prev.photo) return prev;
          return { ...prev, photo: photoUrl };
        });
      })
      .finally(() => {
        if (active) setResolvingPhoto(false);
      });
    return () => { active = false; };
  }, [selectedPin]);

  const isEventPin = selectedPin?.kind === 'event';
  const canOpenLocation = !isEventPin && Boolean(selectedPin?.brandId && selectedPin?.branchId);
  const selectedBrand = (Array.isArray(window.BRANDS) ? window.BRANDS : []).find((b) => b.id === selectedPin?.brandId) || null;
  const selectedBrandBranchCount = Array.isArray(selectedBrand?.branches) ? selectedBrand.branches.length : 0;
  const hasMultipleBrandLocations = selectedBrandBranchCount > 1;
  const canOpenBrand = !isEventPin && Boolean(selectedBrand);
  const eventTypeLabelFn = typeof window.eventTypeLabel === 'function' ? window.eventTypeLabel : (t) => t;
  const eventTypeColorFn = typeof window.eventTypeColor === 'function' ? window.eventTypeColor : () => theme.accent;
  const eventMerchants = isEventPin
    ? (selectedPin?.merchantIds || []).map((id) => (Array.isArray(window.BRANDS) ? window.BRANDS : []).find((b) => b.id === id)).filter(Boolean)
    : [];
  const eventDisplayTitle = isEventPin && selectedPin?.type === 'popup' && eventMerchants.length === 1
    ? `${eventMerchants[0].name} @ ${selectedPin.subtitle || selectedPin.location || selectedPin.sub}`
    : (selectedPin?.title || selectedPin?.name || 'Event');
  const googleRating = Number(selectedPin?.googleRating) || 0;
  const googleReviewCount = Number(selectedPin?.googleReviewCount) || 0;
  const googleReviewLabel = googleRating > 0 && googleReviewCount > 0
    ? `${googleRating.toFixed(1)} · ${googleReviewCount.toLocaleString()} Google reviews`
    : 'Google reviews unavailable';

  React.useLayoutEffect(() => {
    if (!selectedPin || !sheetRef.current) {
      setRecenterBottom(126);
      return;
    }
    const measure = () => {
      const h = sheetRef.current?.offsetHeight || 0;
      setRecenterBottom(h > 0 ? 114 + h + 12 : 126);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && sheetRef.current) ro.observe(sheetRef.current);
    return () => { if (ro) ro.disconnect(); };
  }, [selectedPin, isEventPin, canOpenBrand, hasMultipleBrandLocations, resolvingPhoto]);

  const Header = window.AppBrandHeader;
  const profileBtn = onOpenProfile && window.V2Live?.getProfile ? (() => {
    const prof = window.V2Live.getProfile();
    return (
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label="Open profile"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
      >
        <ProfileAvatar profile={prof} size={32} theme={theme} />
      </button>
    );
  })() : null;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {Header ? <Header theme={theme} rightAction={profileBtn} /> : null}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {/* Live Google map layer */}
        <div
          ref={mapRef}
          style={{
            position: 'absolute', inset: 0,
          }}
        >
          <div id="v2-live-map" style={{ position: 'absolute', inset: 0, touchAction: 'auto' }} />
        </div>

        {/* Top search — no filters */}
        <div style={{
          position: 'absolute', top: 12, left: 16, right: 16, zIndex: 10,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 18px', background: theme.card,
            border: `1px solid ${theme.border}`, borderRadius: 16,
            boxShadow: theme.shadow,
          }}>
            <IconSearch size={18} stroke={theme.muted} />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Find matcha nearby"
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'none',
                fontFamily: theme.sans, fontSize: 15, fontWeight: 500,
                color: theme.text, letterSpacing: -0.1,
              }} />
          </div>
        </div>

        {/* Minimal recenter icon */}
        <button
          type="button"
          aria-label="Recenter map"
          onClick={() => window.V2Live?.map?.recenter?.()}
          style={{
            position: 'absolute', bottom: recenterBottom, right: 18, zIndex: 20,
            background: 'rgba(255,255,255,0.88)', border: `1px solid ${theme.border}`, borderRadius: 999,
            padding: 8, cursor: 'pointer', pointerEvents: 'auto', touchAction: 'manipulation',
            color: theme.text, filter: `drop-shadow(0 2px 6px ${theme.surface})`,
          }}>
          <IconLocate size={24} stroke={theme.text} sw={1.8} />
        </button>

        {/* Bottom sheet */}
        {selectedPin && (
        <div ref={sheetRef} style={{
          position: 'absolute', bottom: 114, left: 16, right: 16, zIndex: 30,
          background: theme.card, borderRadius: 20,
          border: `1px solid ${theme.border}`,
          boxShadow: theme.shadowLg, overflow: 'hidden',
          animation: 'slideUp 280ms cubic-bezier(.2,.8,.2,1)',
        }}>
          {isEventPin ? (
            <>
              <div style={{ display: 'flex', gap: 12, padding: 14 }}>
                <div style={{ width: 68, height: 68, borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
                  {selectedPin.coverPhoto || selectedPin.photo ? (
                    <img src={selectedPin.coverPhoto || selectedPin.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Placeholder label="" hue={selectedPin.coverHue ?? 120} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{
                          padding: '2px 7px', borderRadius: 999,
                          background: eventTypeColorFn(selectedPin.type, theme),
                          fontFamily: theme.sans, fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: 0.4,
                        }}>
                          {eventTypeLabelFn(selectedPin.type).toUpperCase()}
                        </span>
                        {selectedPin.status === 'ongoing' && (
                          <span style={{
                            padding: '2px 7px', borderRadius: 999,
                            background: theme.accentLight, border: `1px solid ${theme.accent}`,
                            fontFamily: theme.sans, fontSize: 9, fontWeight: 700, color: theme.accent, letterSpacing: 0.4,
                          }}>
                            NOW
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontFamily: theme.sans, fontSize: 18, fontWeight: 600,
                        color: theme.text, letterSpacing: -0.3, lineHeight: 1.2,
                      }}>{eventDisplayTitle}</div>
                    </div>
                  </div>
                  {selectedPin.dateLabel && (
                    <div style={{
                      marginTop: 6, display: 'flex', alignItems: 'center', gap: 6,
                      fontFamily: theme.sans, fontSize: 13, color: theme.text, fontWeight: 600,
                    }}>
                      <IconCalendar size={14} stroke={theme.accent} sw={1.8} />
                      <span>{selectedPin.dateLabel}</span>
                    </div>
                  )}
                  {(selectedPin.location || selectedPin.sub) && (
                    <div style={{
                      marginTop: 4, display: 'flex', alignItems: 'center', gap: 6,
                      fontFamily: theme.sans, fontSize: 13, color: theme.muted, fontWeight: 500,
                    }}>
                      <IconPin size={14} stroke={theme.muted} sw={1.6} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedPin.location || selectedPin.sub}
                      </span>
                    </div>
                  )}
                  {eventMerchants.length > 0 && (
                    <MapMerchantThumbs merchants={eventMerchants} theme={theme} />
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const id = selectedPin.eventId || selectedPin.id;
                  if (id && typeof onOpenEvent === 'function') onOpenEvent(id);
                  else if (id && typeof onOpenDetail === 'function') onOpenDetail(selectedPin);
                }}
                style={{
                  width: '100%', padding: '14px', border: 'none',
                  borderTop: `1px solid ${theme.border}`,
                  background: theme.surface2,
                  color: theme.text,
                  cursor: 'pointer',
                  fontFamily: theme.sans, fontSize: 14, fontWeight: 600, letterSpacing: -0.1,
                }}
              >
                View event
              </button>
            </>
          ) : (
          <>
          <div style={{ display: 'flex', gap: 12, padding: 14 }}>
            <div style={{ width: 68, height: 68, borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
              {selectedPin.photo ? (
                <img src={selectedPin.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Placeholder label="photo" hue={120} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{
                  fontFamily: theme.sans, fontSize: 18, fontWeight: 600,
                  color: theme.text, letterSpacing: -0.3, lineHeight: 1.2,
                }}>{selectedPin.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {(selectedPin.brandId || selectedPin.branchId) && (
                    <button
                      type="button"
                      aria-label={selectedPin.liked ? 'Remove from favorites' : 'Favorite this brand'}
                      onClick={async (e) => {
                        e.stopPropagation();
                        const nextLiked = !Boolean(selectedPin.liked);
                        setSelectedPin((prev) => (prev ? { ...prev, liked: nextLiked } : prev));
                        try {
                          if (selectedPin.brandId) {
                            await window.V2Live?.setBrandLike?.(selectedPin.brandId, nextLiked);
                          } else if (selectedPin.branchId) {
                            await window.V2Live?.setLocationLike?.(selectedPin.branchId, nextLiked);
                          }
                          window.V2Live?.map?.showCurated?.();
                        } catch {
                          setSelectedPin((prev) => (prev ? { ...prev, liked: !nextLiked } : prev));
                        }
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 4,
                        cursor: 'pointer',
                        color: selectedPin.liked ? theme.accent : theme.muted,
                      }}
                    >
                      <IconHeart
                        size={15}
                        stroke={selectedPin.liked ? theme.accent : theme.muted}
                        fill={selectedPin.liked ? theme.accent : 'none'}
                        sw={1.9}
                      />
                    </button>
                  )}
                </div>
              </div>
              {selectedPin.sub && (
                <div style={{
                  fontFamily: theme.sans, fontSize: 13, color: theme.muted,
                  marginTop: 2, fontWeight: 500,
                }}>{selectedPin.sub}</div>
              )}
              <div style={{
                marginTop: 8, display: 'flex', gap: 10, alignItems: 'center',
                fontFamily: theme.sans, fontSize: 13, color: theme.muted, fontWeight: 500,
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <IconStar size={14} filled stroke={theme.accent} />
                  <b style={{ color: theme.text, fontWeight: 600 }}>{googleReviewLabel}</b>
                </span>
                {resolvingPhoto && <span>· fetching photo…</span>}
              </div>
            </div>
          </div>
          {!canOpenBrand && selectedPin?.placeId && typeof onOpenStandaloneLocation === 'function' && (
            <button
              type="button"
              onClick={() => onOpenStandaloneLocation(selectedPin)}
              style={{
                width: '100%', padding: '14px', border: 'none',
                borderTop: `1px solid ${theme.border}`,
                background: theme.surface2,
                color: theme.text,
                cursor: 'pointer',
                fontFamily: theme.sans, fontSize: 14, fontWeight: 600, letterSpacing: -0.1,
              }}
            >
              View location
            </button>
          )}
          {!canOpenBrand && !selectedPin?.placeId && (
            <div style={{
              padding: '0 14px 10px',
              fontFamily: theme.sans,
              fontSize: 12,
              color: theme.muted,
            }}>
              Location details unavailable for this place
            </div>
          )}
          {canOpenBrand && (hasMultipleBrandLocations ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${theme.border}` }}>
              <button
                type="button"
                onClick={() => onOpenBrand?.(selectedPin.brandId)}
                style={{
                  width: '100%', padding: '14px', border: 'none', borderRight: `1px solid ${theme.border}`,
                  background: theme.surface2,
                  color: theme.text,
                  cursor: 'pointer',
                  fontFamily: theme.sans, fontSize: 14, fontWeight: 600, letterSpacing: -0.1,
                }}
              >
                View brand
              </button>
              <button
                type="button"
                onClick={() => onOpenDetail(selectedPin)}
                disabled={!canOpenLocation}
                style={{
                  width: '100%', padding: '14px', border: 'none',
                  background: theme.surface2,
                  color: !canOpenLocation ? theme.muted : theme.text,
                  cursor: !canOpenLocation ? 'not-allowed' : 'pointer',
                  fontFamily: theme.sans, fontSize: 14, fontWeight: 600, letterSpacing: -0.1,
                }}
              >
                View location
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onOpenBrand?.(selectedPin.brandId)}
              style={{
                width: '100%', padding: '14px', border: 'none',
                borderTop: `1px solid ${theme.border}`,
                background: theme.surface2,
                color: theme.text,
                cursor: 'pointer',
                fontFamily: theme.sans, fontSize: 14, fontWeight: 600, letterSpacing: -0.1,
              }}
            >
              View brand
            </button>
          ))}
          </>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

function MapPin({ pin, selected, theme }) {
  const { name, sub, fav, visited } = pin;
  let iconNode;
  const sz = 11;
  if (fav && visited) {
    iconNode = <IconHeart size={sz} stroke={selected ? theme.onAccent : theme.accent}
                          fill={selected ? theme.onAccent : theme.accent} sw={0} />;
  } else if (visited) {
    iconNode = <IconCheck size={sz} stroke={selected ? theme.onAccent : theme.accent} sw={2.5} />;
  } else if (fav) {
    iconNode = <IconStar size={sz} filled stroke={selected ? theme.onAccent : theme.accent} />;
  } else {
    iconNode = <div style={{ width: 5, height: 5, borderRadius: '50%', background: selected ? theme.onAccent : theme.muted }} />;
  }

  return (
    <div style={{
      transform: `scale(${selected ? 1 : 0.88})`,
      transition: 'transform 200ms',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <div style={{
        padding: '6px 11px 6px 9px',
        background: selected ? theme.accent : theme.card,
        color: selected ? theme.onAccent : theme.text,
        border: `1px solid ${selected ? theme.accent : theme.border}`,
        borderRadius: 999,
        fontFamily: theme.sans, fontSize: 13, fontWeight: 600,
        letterSpacing: -0.1, whiteSpace: 'nowrap',
        boxShadow: selected ? theme.shadowLg : theme.shadow,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 13 }}>
          {iconNode}
        </span>
        <span>{name}</span>
        {sub && <span style={{
          fontFamily: theme.sans, fontSize: 11, fontWeight: 500,
          opacity: 0.65, paddingLeft: 6,
          borderLeft: `1px solid ${selected ? 'rgba(255,255,255,0.3)' : theme.border}`,
          marginLeft: 2,
        }}>{sub}</span>}
      </div>
      <div style={{
        width: 0, height: 0, marginTop: -1,
        borderLeft: '5px solid transparent',
        borderRight: '5px solid transparent',
        borderTop: `6px solid ${selected ? theme.accent : theme.card}`,
      }} />
    </div>
  );
}

function CircleBtn({ children, theme, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 40, height: 40, borderRadius: '50%',
      background: theme.card, border: `1px solid ${theme.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', boxShadow: theme.shadow,
    }}>{children}</button>
  );
}

window.MapScreen = MapScreen;
window.CircleBtn = CircleBtn;
