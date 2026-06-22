// Feed — posts, list cards, post detail with Strava share card

const DEFAULT_BRAND_HUE = 120;

function brandHueForPost(post) {
  const b = BRANDS.find(x => x.id === post?.brandId) || BRANDS[0];
  return typeof b?.hue === 'number' ? b.hue : DEFAULT_BRAND_HUE;
}

function StarRow({ rating, size = 16, theme }) {
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {[1,2,3,4,5].map(i => {
        const filled = i <= Math.floor(rating);
        const half = !filled && i === Math.ceil(rating) && rating % 1 !== 0;
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill="none">
            {half ? (
              <>
                <defs><linearGradient id={`hg${i}${size}`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="50%" stopColor={theme.accent}/><stop offset="50%" stopColor="transparent"/>
                </linearGradient></defs>
                <path d="M12 2.5l2.9 6.3 6.9.8-5 4.8 1.3 6.9L12 17.8l-6.1 3.5 1.3-6.9-5-4.8 6.9-.8z" fill={`url(#hg${i}${size})`} stroke={theme.accent} strokeWidth="1.5"/>
              </>
            ) : (
              <path d="M12 2.5l2.9 6.3 6.9.8-5 4.8 1.3 6.9L12 17.8l-6.1 3.5 1.3-6.9-5-4.8 6.9-.8z" fill={filled ? theme.accent : 'none'} stroke={theme.accent} strokeWidth="1.5"/>
            )}
          </svg>
        );
      })}
    </div>
  );
}

function postAuthorUserLabel(post) {
  return String(post?.authorHandle || '').trim() || 'member';
}

function postUserAtBrand(post, theme) {
  const user = postAuthorUserLabel(post);
  return (
    <>
      <span style={{ color: '#111', fontWeight: 700 }}>{user}</span>
      <span style={{ color: theme.text, fontWeight: 500 }}>{' @ '}</span>
      <span style={{ color: theme.accent, fontWeight: 600 }}>{post?.brand}</span>
    </>
  );
}

function formatPhpPrice(priceRaw) {
  const raw = String(priceRaw ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d.]/g, '');
  if (!digits) return raw;
  const num = parseFloat(digits);
  if (!Number.isFinite(num)) return raw;
  return `\u20B1${Number.isInteger(num) ? String(Math.round(num)) : digits}`;
}

function toRelativeShort(post) {
  const now = Date.now();
  const ts = Number(post?.createdAt);
  let ageMs = Number.isFinite(ts) && ts > 0 ? (now - ts) : null;
  if (!(ageMs >= 0)) {
    const raw = String(post?.date || '').trim();
    const parsed = Date.parse(`${raw}, ${new Date().getFullYear()}`);
    if (!Number.isNaN(parsed)) ageMs = now - parsed;
  }
  if (!(ageMs >= 0)) return post?.date || '';
  const hour = 3600000, day = 86400000;
  if (ageMs < hour) return `${Math.max(1, Math.floor(ageMs / 60000))}m ago`;
  if (ageMs < day) return `${Math.floor(ageMs / hour)}h ago`;
  if (ageMs < 7 * day) return `${Math.floor(ageMs / day)}d ago`;
  if (ageMs < 14 * day) return '1w ago';
  if (ageMs < 30 * day) return `${Math.floor(ageMs / (7 * day))}w ago`;
  return post?.date || '';
}

function getPostLocationLine(post) {
  const brand = BRANDS.find(b => b.id === post?.brandId);
  const br = (brand?.branches || []).find(x => String(x?.id) === String(post?.branchId));
  const name = String(post?.branchName || br?.name || '').trim();
  const addr = String(post?.address || br?.address || '').trim();
  const brandTitle = String(post?.brand || '').trim();
  if (name && name.toLowerCase() !== brandTitle.toLowerCase()) return name;
  if (addr) return addr;
  return '';
}

function PostAuthorRow({ post, theme, onBrand, showLocationSubtitle = true }) {
  const relativeDate = toRelativeShort(post);
  const subtitleLine = getPostLocationLine(post);
  const initial = post.avatarInitial || (String(post.authorDisplayName || post.authorHandle || '?')[0] || '?').toUpperCase();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 10px' }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: theme.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.accent }}>{initial}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button type="button" onClick={onBrand} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', textAlign: 'left' }}>
          <span style={{ fontFamily: theme.sans, fontSize: 14, lineHeight: 1.25 }}>{postUserAtBrand(post, theme)}</span>
        </button>
        {showLocationSubtitle && subtitleLine && (
          <div style={{ fontFamily: theme.sans, fontSize: 12, color: '#A3A3A3', marginTop: 2, lineHeight: 1.35 }}>{subtitleLine}</div>
        )}
      </div>
      <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted }}>{relativeDate}</div>
    </div>
  );
}

function PostEngagementRow({ post, theme, onToggleLike, onOpenComments }) {
  const liked = Boolean(post.liked);
  const likeCount = Number(post.likeCount) || 0;
  const commentCount = Number(post.commentCount) || 0;
  return (
    <div style={{ padding: '10px 16px 6px', display: 'flex', alignItems: 'center', gap: 20 }}>
      <button type="button" onClick={onToggleLike} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill={liked ? theme.accent : 'none'} stroke={liked ? theme.accent : theme.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6C19 16.5 12 21 12 21z"/>
        </svg>
        <span style={{ fontFamily: theme.sans, fontSize: 13, color: theme.text, fontWeight: 600 }}>Like</span>
        {likeCount > 0 && <span style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted }}>{likeCount}</span>}
      </button>
      <button type="button" onClick={onOpenComments} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.7-.3-3.9-.9L3 21l1.9-5.1a8.5 8.5 0 1 1 16.1-4.4z"/>
        </svg>
        <span style={{ fontFamily: theme.sans, fontSize: 13, color: theme.text, fontWeight: 600 }}>Comment</span>
        {commentCount > 0 && <span style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted }}>{commentCount}</span>}
      </button>
    </div>
  );
}

function PhotoCarousel({ photos = [], count, hue, height, aspectRatio = '4/5', theme }) {
  const [idx, setIdx] = React.useState(0);
  const safePhotos = Array.isArray(photos) ? photos.filter(Boolean) : [];
  const total = safePhotos.length || count || 1;
  const shellRef = React.useRef(null);
  const startX = React.useRef(null);
  const startY = React.useRef(null);
  const swipeAxis = React.useRef(null);

  React.useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const onTouchMove = (e) => {
      if (startX.current == null || !e.touches[0]) return;
      const dx = e.touches[0].clientX - startX.current;
      const dy = e.touches[0].clientY - startY.current;
      if (swipeAxis.current === 'h') { e.preventDefault(); return; }
      if (!swipeAxis.current && (Math.abs(dx) > 14 || Math.abs(dy) > 14)) {
        swipeAxis.current = Math.abs(dx) > Math.abs(dy) + 10 ? 'h' : 'v';
        if (swipeAxis.current === 'h') e.preventDefault();
      }
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  const frameStyle = {
    position: 'relative', overflow: 'hidden', background: theme.surface2, touchAction: 'pan-y',
    ...(typeof height === 'number' ? { height } : { width: '100%', aspectRatio }),
  };
  return (
    <div ref={shellRef} style={frameStyle}
      onTouchStart={e => { if (!e.touches[0]) return; startX.current = e.touches[0].clientX; startY.current = e.touches[0].clientY; swipeAxis.current = null; }}
      onTouchEnd={e => {
        if (startX.current === null) return;
        const t = e.changedTouches[0]; if (!t) return;
        const dx = t.clientX - startX.current;
        const dy = t.clientY - startY.current;
        if (swipeAxis.current === 'h' || (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy))) {
          if (dx < -40 && idx < total - 1) setIdx(idx + 1);
          if (dx > 40 && idx > 0) setIdx(idx - 1);
        }
        startX.current = null; startY.current = null; swipeAxis.current = null;
      }}>
      <div style={{ display: 'flex', width: `${total * 100}%`, height: '100%', transform: `translateX(-${(idx / total) * 100}%)`, transition: 'transform 280ms cubic-bezier(.4,0,.2,1)' }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ width: `${100/total}%`, flexShrink: 0, height: '100%' }}>
            {safePhotos[i]
              ? <img src={safePhotos[i]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <Placeholder label="" hue={hue + i * 15} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
            }
          </div>
        ))}
      </div>
      {total > 1 && (
        <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 5 }}>
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} style={{ width: i === idx ? 16 : 6, height: 6, borderRadius: 3, background: i === idx ? theme.accent : 'rgba(255,255,255,0.7)', transition: 'width 200ms' }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Strava-style Share Card ────────────────────────────────────────────
function ShareCardOverlay({ post, theme, onClose }) {
  const drink = post.drinks?.[0];
  const photo = post.photos?.[0];
  const [copied, setCopied] = React.useState(false);
  const hue = brandHueForPost(post);

  const handleShare = () => {
    setCopied(true);
    setTimeout(() => { setCopied(false); onClose(); }, 1200);
  };

  // Star dots for rating
  const ratingDots = Array.from({ length: 5 }, (_, i) => i + 1);

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '20px 24px 24px',
      animation: 'fadeIn 180ms ease',
    }}>
      {/* Top bar */}
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>Share your log</div>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer' }}>
          <IconClose size={20} stroke="rgba(255,255,255,0.6)" sw={2} />
        </button>
      </div>

      {/* Card */}
      <div style={{
        width: '100%',
        maxWidth: 320,
        aspectRatio: '4/5',
        borderRadius: 20,
        overflow: 'hidden',
        position: 'relative',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        {/* Background photo */}
        {photo
          ? <img src={photo} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ position: 'absolute', inset: 0, background: `oklch(0.30 0.10 ${hue})` }} />
        }

        {/* Gradient overlays */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, transparent 35%, transparent 45%, rgba(0,0,0,0.75) 100%)' }} />

        {/* Subtle noise texture */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.04, pointerEvents: 'none' }}>
          <filter id="noise-share"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
          <rect width="100%" height="100%" filter="url(#noise-share)" />
        </svg>

        {/* Top: brand mark + timestamp */}
        <div style={{ position: 'absolute', top: 16, left: 16, right: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 700, letterSpacing: -0.3, color: 'rgba(255,255,255,0.9)' }}>
            cha<span style={{ color: '#6bdf3a' }}>kaiki</span>
          </div>
          <div style={{ fontFamily: theme.sans, fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
            {toRelativeShort(post)}
          </div>
        </div>

        {/* Bottom: info */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '28px 18px 20px' }}>
          {/* User handle */}
          <div style={{ fontFamily: theme.sans, fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 6, letterSpacing: 0.1 }}>
            @{postAuthorUserLabel(post)}
          </div>

          {/* Drink name — big */}
          <div style={{ fontFamily: theme.sans, fontSize: 24, fontWeight: 800, color: '#fff', lineHeight: 1.05, letterSpacing: -0.8, marginBottom: 4 }}>
            {drink?.name || 'Matcha'}
          </div>

          {/* Brand */}
          <div style={{ fontFamily: theme.sans, fontSize: 13, color: 'rgba(255,255,255,0.75)', marginBottom: 10, letterSpacing: 0.1 }}>
            {post.brand}
          </div>

          {/* Rating + review snippet */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: (post.review || post.caption) ? 8 : 0 }}>
            {post.rating > 0 && (
              <div style={{ display: 'flex', gap: 2 }}>
                {ratingDots.map(i => (
                  <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: i <= Math.floor(post.rating) ? '#6bdf3a' : 'rgba(255,255,255,0.25)' }} />
                ))}
              </div>
            )}
            {drink?.price && (
              <div style={{ fontFamily: theme.sans, fontSize: 11, color: 'rgba(255,255,255,0.5)', marginLeft: 4 }}>
                {formatPhpPrice(drink.price)}
              </div>
            )}
          </div>

          {(post.review || post.caption) && (
            <div style={{
              fontFamily: theme.sans, fontSize: 12, color: 'rgba(255,255,255,0.72)',
              lineHeight: 1.55,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              "{post.review || post.caption}"
            </div>
          )}

          {/* Flavor tags */}
          {drink?.flavorNotes?.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
              {drink.flavorNotes.slice(0, 3).map(n => (
                <span key={n} style={{ padding: '2px 7px', borderRadius: 999, background: 'rgba(107,223,58,0.2)', border: '1px solid rgba(107,223,58,0.35)', fontFamily: theme.sans, fontSize: 9, fontWeight: 600, color: '#6bdf3a', letterSpacing: 0.4 }}>
                  {n}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ marginTop: 20, display: 'flex', gap: 10, width: '100%', maxWidth: 320 }}>
        <button type="button" onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)', background: 'none', color: 'rgba(255,255,255,0.7)', fontFamily: theme.sans, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button type="button" onClick={handleShare} style={{ flex: 2, padding: '12px', borderRadius: 999, border: 'none', background: copied ? '#6bdf3a' : '#fff', color: copied ? '#0a2200' : '#0a0a0a', fontFamily: theme.sans, fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 200ms' }}>
          {copied ? (
            <><IconCheck size={15} stroke="#0a2200" sw={2.5} /> Saved to camera roll</>
          ) : (
            <><IconSend size={14} stroke="#0a0a0a" sw={2} /> Share card</>
          )}
        </button>
      </div>

      <div style={{ marginTop: 10, fontFamily: theme.sans, fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
        Tap "Share card" to save or post your log
      </div>
    </div>
  );
}

// ── List Feed Card ────────────────────────────────────────────────────
function ListFeedCard({ list, theme, onOpen }) {
  const brands = list.type === 'brands' ? (list.items || []).map(id => BRANDS.find(b => b.id === id)).filter(Boolean) : [];
  const posts  = list.type === 'drinks' ? (list.items || []).map(id => POSTS.find(p => p.id === id)).filter(Boolean) : [];
  const items = list.type === 'brands' ? brands : posts;
  const ageMs = Date.now() - list.createdAt;
  const relDate = ageMs < 86400000 ? `${Math.floor(ageMs / 3600000)}h ago` : ageMs < 604800000 ? `${Math.floor(ageMs / 86400000)}d ago` : `${Math.floor(ageMs / 604800000)}w ago`;

  return (
    <article style={{ marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 10px' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: theme.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.accent }}>{(list.authorHandle || 'M')[0].toUpperCase()}</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 14 }}>
            <span style={{ fontWeight: 700, color: '#111' }}>{list.authorHandle}</span>
            <span style={{ color: theme.muted }}> made a list</span>
          </div>
          <div style={{ fontFamily: theme.sans, fontSize: 12, color: '#A3A3A3', marginTop: 2 }}>
            {items.length} {list.type === 'brands' ? 'brands' : 'drinks'}
          </div>
        </div>
        <span style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted }}>{relDate}</span>
      </div>

      <button type="button" onClick={onOpen} style={{ display: 'block', width: '100%', border: 'none', background: 'none', cursor: 'pointer', padding: '0 16px 12px', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `oklch(0.90 0.04 ${list.coverHue})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <IconBookmark size={13} stroke={`oklch(0.45 0.12 ${list.coverHue})`} sw={1.8} />
          </div>
          <div>
            <div style={{ fontFamily: theme.sans, fontSize: 15, fontWeight: 700, color: theme.text }}>{list.name}</div>
            {list.description && <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 1 }}>{list.description}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {items.slice(0, 5).map((item, i) => {
            const photo = list.type === 'brands' ? item.branches?.[0]?.photoUrl : item.photos?.[0];
            const hue = list.type === 'brands' ? item.hue : brandHueForPost(item);
            return (
              <div key={item.id} style={{ width: 88, height: 88, borderRadius: 10, overflow: 'hidden', flexShrink: 0, border: `1px solid ${theme.border}`, position: 'relative', background: theme.surface2 }}>
                {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 5px 5px', background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent)' }}>
                  <div style={{ fontFamily: theme.sans, fontSize: 9, fontWeight: 600, color: '#fff', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {list.type === 'brands' ? item.name : item.drinks?.[0]?.name || item.brand}
                  </div>
                </div>
                {items.length > 5 && i === 4 && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 700, color: '#fff' }}>+{items.length - 4}</span>
                  </div>
                )}
                {list.type === 'brands' && userTriedBrand(item.id) && (
                  <div style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', background: theme.accent, border: `1.5px solid rgba(255,255,255,0.8)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5 11-12"/></svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </button>

      <div style={{ padding: '2px 16px 14px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button type="button" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <IconHeart size={18} stroke={theme.text} sw={1.8} />
          <span style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>{list.likeCount}</span>
        </button>
        <button type="button" onClick={onOpen} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>
          View full list →
        </button>
      </div>

      <div style={{ height: 1, background: theme.border }} />
    </article>
  );
}

// ── Feed Card ─────────────────────────────────────────────────────────
function FeedCard({ post, theme, onOpen, onBrand }) {
  const [liked, setLiked] = React.useState(Boolean(post.liked));
  const [likeCount, setLikeCount] = React.useState(Number(post.likeCount) || 0);
  const onLike = (e) => { e.preventDefault(); e.stopPropagation(); setLiked(l => !l); setLikeCount(c => liked ? c - 1 : c + 1); };
  return (
    <article style={{ marginBottom: 0 }}>
      <PostAuthorRow post={post} theme={theme} onBrand={onBrand} />
      <button type="button" onClick={onOpen} style={{ display: 'block', width: '100%', padding: 0, border: 'none', cursor: 'pointer', background: 'none' }}>
        <PhotoCarousel photos={post.photos} count={post.photoCount} hue={brandHueForPost(post)} theme={theme} />
      </button>
      <PostEngagementRow post={{ ...post, liked, likeCount }} theme={theme} onToggleLike={onLike} onOpenComments={onOpen} />
      <button type="button" onClick={onOpen} style={{ display: 'block', width: '100%', padding: '4px 16px 14px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontFamily: theme.sans, fontSize: 14, lineHeight: 1.45, color: theme.text, wordBreak: 'break-word' }}>
          <span style={{ fontWeight: 700, color: '#111' }}>{postAuthorUserLabel(post)}</span>
          {post.caption && <span style={{ fontWeight: 400 }}>{` ${post.caption}`}</span>}
        </span>
      </button>
      <div style={{ height: 1, background: theme.border }} />
    </article>
  );
}

function FeedScreen({ theme, onOpenPost, onOpenBrand, onOpenList, brandFilterId = null, onBack }) {
  const feedPosts = brandFilterId ? POSTS.filter(p => p.brandId === brandFilterId) : POSTS;
  const brand = brandFilterId ? (BRANDS.find(b => b.id === brandFilterId) || null) : null;
  const feedItems = React.useMemo(() => {
    if (brandFilterId) return feedPosts.map(p => ({ kind: 'post', data: p }));
    const items = [];
    feedPosts.forEach((p, i) => {
      items.push({ kind: 'post', data: p });
      if ((i + 1) % 2 === 0) {
        const listIdx = Math.floor(i / 2) % USER_LISTS.length;
        items.push({ kind: 'list', data: USER_LISTS[listIdx] });
      }
    });
    return items;
  }, [feedPosts, brandFilterId]);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      {brandFilterId && (
        <div style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 12, paddingTop: 'max(12px, env(safe-area-inset-top, 0px))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${theme.border}`, background: theme.surface, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer' }}>
              <IconBack size={18} stroke={theme.text} sw={2} />
            </button>
            <div style={{ fontFamily: theme.sans, fontSize: 18, fontWeight: 600, color: theme.text, letterSpacing: -0.2 }}>{brand?.name || 'Brand'} posts</div>
          </div>
          <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>{feedPosts.length} posts</div>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 90 }}>
        {feedItems.map((item, idx) => item.kind === 'list'
          ? <ListFeedCard key={`list-${item.data.id}-${idx}`} list={item.data} theme={theme} onOpen={() => onOpenList && onOpenList(item.data.id)} />
          : <FeedCard key={item.data.id} post={item.data} theme={theme} onOpen={() => onOpenPost(item.data.id)} onBrand={() => onOpenBrand(item.data.brandId)} />
        )}
        {feedPosts.length === 0 && <div style={{ padding: '40px 16px', fontFamily: theme.sans, fontSize: 14, color: theme.muted, textAlign: 'center' }}>No posts yet.</div>}
      </div>
    </div>
  );
}

// ── Flavor bar ────────────────────────────────────────────────────────
function FlavorBar({ label, value, color, theme }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <span style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, width: 66, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: theme.border, borderRadius: 2 }}>
        <div style={{ width: `${(value / 5) * 100}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, width: 10, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function DrinkCard({ drink, theme }) {
  const hasProfile = drink.profile && Object.values(drink.profile).some(v => v > 0);
  const hasNotes = drink.notes?.trim();
  const hasTags = drink.flavorNotes?.length > 0;
  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 10, padding: '13px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: (hasNotes || hasTags || hasProfile) ? 8 : 0 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 15, fontWeight: 600, color: theme.text, flex: 1 }}>{drink.name}</div>
        {drink.price && <span style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text, marginLeft: 10, flexShrink: 0 }}>{formatPhpPrice(drink.price)}</span>}
      </div>
      {hasNotes && <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, lineHeight: 1.5, marginBottom: hasTags || hasProfile ? 8 : 0 }}>{drink.notes}</div>}
      {hasTags && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: hasProfile ? 10 : 0 }}>
          {drink.flavorNotes.map(n => <span key={n} style={{ padding: '3px 9px', borderRadius: 999, background: theme.accentLight, color: theme.accent, fontFamily: theme.sans, fontSize: 11, fontWeight: 600 }}>{n}</span>)}
        </div>
      )}
      {hasProfile && (
        <div style={{ marginTop: 2 }}>
          <FlavorBar label="Sweetness" value={drink.profile.sweet} color={theme.accent} theme={theme} />
          <FlavorBar label="Bitterness" value={drink.profile.bitter} color={theme.accent} theme={theme} />
          <FlavorBar label="Umami" value={drink.profile.umami} color={theme.accent} theme={theme} />
        </div>
      )}
    </div>
  );
}

// ── Post Detail ────────────────────────────────────────────────────────
function PostDetailScreen({ theme, postId, onBack, onOpenBrand }) {
  const post = POSTS.find(p => p.id === postId) || POSTS[0];
  const brand = BRANDS.find(b => b.id === post.brandId) || null;
  const [comments, setComments] = React.useState([
    { id: 'c1', author: 'marco', text: 'So jealous, need to try this!', createdAt: Date.now() - 3600000 },
    { id: 'c2', author: 'yuki', text: 'The usucha here is unmatched.', createdAt: Date.now() - 7200000 },
  ]);
  const [draft, setDraft] = React.useState('');
  const [liked, setLiked] = React.useState(Boolean(post.liked));
  const [likeCount, setLikeCount] = React.useState(Number(post.likeCount) || 0);
  const [showShare, setShowShare] = React.useState(false);
  const commentsRef = React.useRef(null);
  const locationLine = getPostLocationLine(post);
  const canOpenBrand = Boolean(post?.brandId && BRANDS.some(b => b.id === post.brandId));

  const onLike = (e) => { e.preventDefault(); setLiked(l => !l); setLikeCount(c => liked ? c - 1 : c + 1); };
  const submitComment = (e) => {
    e?.preventDefault?.();
    const val = draft.trim(); if (!val) return;
    setComments(prev => [...prev, { id: `c${Date.now()}`, author: 'chloe', text: val, createdAt: Date.now() }]);
    setDraft('');
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      <div style={{ padding: 'max(12px, env(safe-area-inset-top, 0px)) 12px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
        <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
          <IconBack size={20} stroke={theme.text} sw={2} />
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text }}>Post</div>
        {/* Share button — always visible */}
        <button type="button" onClick={() => setShowShare(true)} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconSend size={18} stroke={theme.muted} sw={1.8} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 30 }}>
        <PostAuthorRow post={post} theme={theme} onBrand={canOpenBrand ? () => onOpenBrand(post.brandId) : undefined} showLocationSubtitle={false} />
        <PhotoCarousel photos={post.photos} count={post.photoCount} hue={brandHueForPost(post)} theme={theme} />
        <PostEngagementRow post={{ ...post, liked, likeCount }} theme={theme} onToggleLike={onLike} onOpenComments={() => commentsRef.current && commentsRef.current.parentElement && (commentsRef.current.parentElement.scrollTop = 9999)} />

        {/* ── Review — prominent ── */}
        {(post.review || post.caption) && (
          <div style={{ margin: '6px 16px 16px', padding: '14px 16px', background: theme.surface2, borderRadius: 14, border: `1px solid ${theme.border}` }}>
            <div style={{ fontFamily: theme.sans, fontSize: 10, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Review</div>
            <p style={{ fontFamily: theme.sans, fontSize: 15, lineHeight: 1.65, color: theme.text, margin: 0, textWrap: 'pretty' }}>
              {post.review || post.caption}
            </p>
            {post.rating > 0 && (
              <div style={{ marginTop: 10 }}>
                <StarRow rating={post.rating} size={14} theme={theme} />
              </div>
            )}
          </div>
        )}

        <div style={{ padding: '0 16px' }}>
          <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Ordered</div>
          {post.drinks.map(d => <DrinkCard key={d.id} drink={d} theme={theme} />)}

          {canOpenBrand && (
            <button type="button" onClick={() => onOpenBrand(post.brandId)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, background: theme.card, cursor: 'pointer', textAlign: 'left', marginTop: 16, marginBottom: 4, boxSizing: 'border-box' }}>
              <div style={{ width: 52, height: 52, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: theme.surface2 }}>
                {brand?.branches?.[0]?.photoUrl
                  ? <img src={brand.branches[0].photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Placeholder label="" hue={brandHueForPost(post)} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                }
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.accent }}>{post.brand}</div>
                {locationLine && <div style={{ fontFamily: theme.sans, fontSize: 13, color: '#A3A3A3', marginTop: 4 }}>{locationLine}</div>}
              </div>
              <IconChevron size={15} stroke={theme.muted} />
            </button>
          )}
        </div>

        {/* Comments */}
        <div ref={commentsRef} style={{ padding: '16px 16px 26px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Comments</div>
            {comments.length > 0 && <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>{comments.length}</div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
            {comments.length === 0 && <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted }}>No comments yet.</div>}
            {comments.map(c => (
              <div key={c.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: '11px 12px', background: theme.card }}>
                <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 700, color: theme.text, marginBottom: 4 }}>{c.author}</div>
                <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.text, lineHeight: 1.45 }}>{c.text}</div>
              </div>
            ))}
          </div>
          <form onSubmit={submitComment} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a comment…" style={{ flex: 1, padding: '11px 13px', background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: 10, outline: 'none', fontFamily: theme.sans, fontSize: 14, color: theme.text }} />
            <button type="submit" disabled={!draft.trim()} style={{ padding: '10px 16px', borderRadius: 999, border: 'none', cursor: draft.trim() ? 'pointer' : 'not-allowed', background: draft.trim() ? theme.accent : theme.border, color: draft.trim() ? '#fff' : theme.muted, fontFamily: theme.sans, fontSize: 13, fontWeight: 700 }}>Post</button>
          </form>
        </div>
      </div>

      {/* Share card overlay */}
      {showShare && <ShareCardOverlay post={post} theme={theme} onClose={() => setShowShare(false)} />}
    </div>
  );
}

Object.assign(window, { FeedScreen, PostDetailScreen, PhotoCarousel, StarRow, ListFeedCard, brandHueForPost, postAuthorUserLabel, toRelativeShort, formatPhpPrice });
