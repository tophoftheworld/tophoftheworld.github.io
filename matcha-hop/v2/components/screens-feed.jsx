// Feed — user-centric posts, flat post detail

const DEFAULT_BRAND_HUE = 120;

/** Hue for placeholders/carousel when gallery not loaded yet or brand missing from BRANDS. */
function brandHueForPost(post) {
  const b = BRANDS.find((x) => x.id === post?.brandId) || BRANDS[0];
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
                  <stop offset="50%" stopColor={theme.accent}/>
                  <stop offset="50%" stopColor="transparent"/>
                </linearGradient></defs>
                <path d="M12 2.5l2.9 6.3 6.9.8-5 4.8 1.3 6.9L12 17.8l-6.1 3.5 1.3-6.9-5-4.8 6.9-.8z"
                  fill={`url(#hg${i}${size})`} stroke={theme.accent} strokeWidth="1.5"/>
              </>
            ) : (
              <path d="M12 2.5l2.9 6.3 6.9.8-5 4.8 1.3 6.9L12 17.8l-6.1 3.5 1.3-6.9-5-4.8 6.9-.8z"
                fill={filled ? theme.accent : 'none'} stroke={theme.accent} strokeWidth="1.5"/>
            )}
          </svg>
        );
      })}
    </div>
  );
}

/** Login username for copy — always `authorHandle` (set in bootstrap from `userName`, default `member`). */
function postAuthorUserLabel(post) {
  return String(post?.authorHandle || '').trim() || 'member';
}

/** Header/title line: `username @ Brand` (user = handle-first; separator ` @ `; brand accent). */
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

function resolveBranchNameForPost(post) {
  let s = String(post?.branchName || '').trim();
  if (s) return s;
  const brand = BRANDS.find((b) => b.id === post?.brandId);
  const bid = post?.branchId;
  const br = brand?.branches?.find((x) => String(x?.id) === String(bid));
  return String(br?.name || '').trim();
}

/** Branches listed for this post's brand (gallery data). */
function branchCountForBrandPost(post) {
  const brand = BRANDS.find((b) => b.id === post?.brandId);
  const list = brand?.branches;
  if (!Array.isArray(list)) return 0;
  return list.filter(Boolean).length;
}

/**
 * Second line under "user @ brand": actual street address when the brand has one branch;
 * when multiple branches, prefer Maps place / branch name (not duplicate of brand title).
 */
/** Display price with PHP symbol; larger type in DrinkCard. */
function formatPhpPrice(priceRaw) {
  const raw = String(priceRaw ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d.]/g, '');
  if (!digits) return raw;
  const num = parseFloat(digits);
  if (!Number.isFinite(num)) return raw;
  const formatted = Number.isInteger(num) ? String(Math.round(num)) : digits;
  return `\u20B1${formatted}`;
}

function pickBranchForBrandPhoto(brand, post) {
  const branches = Array.isArray(brand?.branches) ? brand.branches : [];
  if (post?.branchId) {
    const br = branches.find((x) => String(x?.id) === String(post.branchId));
    if (br) return br;
  }
  return branches[0] || null;
}

function brandCardPhotoSync(brand, post) {
  const br = pickBranchForBrandPhoto(brand, post);
  return br?.photoUrl || null;
}

function sanitizeAddressDisplay(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  const plusCodePattern = /^[A-Z0-9]{2,8}\+[A-Z0-9]{2,8}$/i;
  const normalized = plusCodePattern.test(parts[0]) ? parts.slice(1) : parts;
  return normalized.join(', ').trim();
}

function getPostLocationSecondLine(post) {
  const n = branchCountForBrandPost(post);
  const addr = sanitizeAddressDisplay(post?.address);
  const brandTitle = String(post?.brand || '').trim();
  const place = resolveBranchNameForPost(post);

  const brandNorm = brandTitle.toLowerCase();
  const placeDup = place && brandNorm && place.toLowerCase() === brandNorm;

  if (n <= 1) {
    if (addr) return addr;
    if (!placeDup && place) return place;
    return '';
  }
  if (!placeDup && place) return place;
  if (addr) return addr;
  return '';
}

function toRelativeShort(post) {
  const now = Date.now();
  const ts = postTimestamp(post);
  let ageMs = Number.isFinite(ts) && ts > 0 ? (now - ts) : null;
  if (!(ageMs >= 0)) {
    const raw = String(post?.date || '').trim();
    const parsed = Date.parse(`${raw}, ${new Date().getFullYear()}`);
    if (!Number.isNaN(parsed)) ageMs = now - parsed;
  }
  if (!(ageMs >= 0)) return post?.date || '';
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (ageMs < hour) return `${Math.max(1, Math.floor(ageMs / (60 * 1000)))}m ago`;
  if (ageMs < day) return `${Math.floor(ageMs / hour)}h ago`;
  if (ageMs < 7 * day) return `${Math.floor(ageMs / day)}d ago`;
  if (ageMs < 14 * day) return '1w ago';
  if (ageMs < 30 * day) return `${Math.floor(ageMs / (7 * day))}w ago`;
  return post?.date || '';
}

function postTimestamp(post) {
  const raw = post?.createdAt;
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) return num;
  const parsedFromRaw = Date.parse(String(raw || ''));
  if (!Number.isNaN(parsedFromRaw) && parsedFromRaw > 0) return parsedFromRaw;
  const d = String(post?.date || '').trim();
  if (d) {
    const parsedFromDate = Date.parse(`${d}, ${new Date().getFullYear()}`);
    if (!Number.isNaN(parsedFromDate) && parsedFromDate > 0) return parsedFromDate;
  }
  return 0;
}

function toDateKey(input) {
  if (!input) return '';
  const raw = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const n = Number(raw);
  let d;
  if (Number.isFinite(n) && n > 0) d = new Date(n);
  else d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateLabel(input) {
  const key = toDateKey(input);
  if (!key) return '';
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Shared feed header: avatar, user @ brand, location/address, time. */
function PostAuthorRow({ post, theme, onBrand, showLocationSubtitle = true, detailLayout = false }) {
  const relativeDate = toRelativeShort(post);
  const subtitleLine = getPostLocationSecondLine(post);
  const initial = post.avatarInitial || (String(post.authorDisplayName || post.authorHandle || '?')[0] || '?').toUpperCase();

  if (detailLayout) {
    return (
      <div style={{ padding: '12px 16px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: theme.accentLight,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.accent }}>{initial}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontFamily: theme.sans, fontSize: 14, lineHeight: 1.25, fontWeight: 700, color: '#111' }}>
                {postAuthorUserLabel(post)}
              </div>
              <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, flexShrink: 0 }}>{relativeDate}</div>
            </div>
          </div>
        </div>
        <button type="button" onClick={onBrand} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginTop: 8, width: '100%', textAlign: 'left' }}>
          <span style={{ fontFamily: theme.sans, fontSize: 18, lineHeight: 1.2, fontWeight: 700, color: theme.accent }}>
            {post?.brand || 'Unknown'}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 10px' }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: theme.accentLight,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 600, color: theme.accent }}>{initial}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button type="button" onClick={onBrand} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginTop: 1, width: '100%', textAlign: 'left' }}>
          <span style={{ fontFamily: theme.sans, fontSize: 14, lineHeight: 1.25 }}>
            {postUserAtBrand(post, theme)}
          </span>
        </button>
        {showLocationSubtitle ? (
          <div style={{
            fontFamily: theme.sans, fontSize: 12, color: '#A3A3A3', marginTop: 2, lineHeight: 1.35,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {subtitleLine || 'No address'}
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <div style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted }}>{relativeDate}</div>
      </div>
    </div>
  );
}

function PostEngagementRow({ post, theme, onToggleLike, onOpenComments }) {
  const liked = Boolean(post.liked);
  const likeCount = Number(post.likeCount) || 0;
  const commentCount = Number(post.commentCount) || 0;

  return (
    <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: 22, borderTop: `1px solid ${theme.border}` }}>
      <button type="button" onClick={onToggleLike} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="22" height="22" viewBox="0 0 24 24"
          fill={liked ? theme.accent : 'none'}
          stroke={liked ? theme.accent : theme.text}
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6C19 16.5 12 21 12 21z"/>
        </svg>
        <span style={{ fontFamily: theme.sans, fontSize: 13, color: theme.text, fontWeight: 600 }}>Like</span>
        {likeCount > 0 ? (
          <span style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, fontWeight: 600 }}>{likeCount}</span>
        ) : null}
      </button>
      <button type="button" onClick={onOpenComments} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={theme.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.7-.3-3.9-.9L3 21l1.9-5.1a8.5 8.5 0 1 1 16.1-4.4z"/>
        </svg>
        <span style={{ fontFamily: theme.sans, fontSize: 13, color: theme.text, fontWeight: 600 }}>Comment</span>
        {commentCount > 0 ? (
          <span style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, fontWeight: 600 }}>{commentCount}</span>
        ) : null}
      </button>
    </div>
  );
}

function PhotoCarousel({ photos = [], count, hue, height, aspectRatio = '4/5', theme, activeIndex, onActiveIndexChange }) {
  const [internalIdx, setInternalIdx] = React.useState(0);
  const controlled = activeIndex !== undefined && activeIndex !== null;
  const idx = controlled ? activeIndex : internalIdx;
  const setIdx = React.useCallback((next) => {
    const value = typeof next === 'function' ? next(idx) : next;
    if (onActiveIndexChange) onActiveIndexChange(value);
    if (!controlled) setInternalIdx(value);
  }, [controlled, idx, onActiveIndexChange]);
  const safePhotos = Array.isArray(photos) ? photos.filter(Boolean) : [];
  const total = safePhotos.length || count || 1;
  const shellRef = React.useRef(null);
  const startX = React.useRef(null);
  const startY = React.useRef(null);
  const swipeAxis = React.useRef(null);

  React.useEffect(() => {
    const el = shellRef.current;
    if (!el) return undefined;
    const onTouchMove = (e) => {
      if (startX.current == null || startY.current == null || !e.touches[0]) return;
      const cx = e.touches[0].clientX;
      const cy = e.touches[0].clientY;
      const dx = cx - startX.current;
      const dy = cy - startY.current;
      if (swipeAxis.current === 'h') {
        e.preventDefault();
        return;
      }
      if (!swipeAxis.current && (Math.abs(dx) > 14 || Math.abs(dy) > 14)) {
        if (Math.abs(dx) > Math.abs(dy) + 10) {
          swipeAxis.current = 'h';
          e.preventDefault();
        } else {
          swipeAxis.current = 'v';
        }
      }
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  const onTouchStart = (e) => {
    if (!e.touches[0]) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    swipeAxis.current = null;
  };
  const onTouchEnd = (e) => {
    if (startX.current === null || startY.current === null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    if (swipeAxis.current === 'h' || (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy))) {
      if (dx < -40 && idx < total - 1) setIdx(idx + 1);
      if (dx > 40 && idx > 0) setIdx(idx - 1);
    }
    startX.current = null;
    startY.current = null;
    swipeAxis.current = null;
  };
  const frameStyle = {
    position: 'relative',
    overflow: 'hidden',
    background: theme.surface2,
    touchAction: 'pan-y',
    ...(typeof height === 'number' ? { height } : { width: '100%', aspectRatio }),
  };
  return (
    <div ref={shellRef} style={frameStyle}
         onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div style={{
        display: 'flex', width: `${total * 100}%`, height: '100%',
        transform: `translateX(-${(idx / total) * 100}%)`,
        transition: 'transform 280ms cubic-bezier(.4,0,.2,1)',
      }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ width: `${100/total}%`, flexShrink: 0, height: '100%' }}>
            {safePhotos[i] ? (
              <img src={safePhotos[i]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Placeholder label="" hue={hue + i * 15} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
            )}
          </div>
        ))}
      </div>
      {total > 1 && (
        <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 5 }}>
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} style={{
              width: i === idx ? 16 : 6, height: 6, borderRadius: 3,
              background: i === idx ? theme.accent : 'rgba(255,255,255,0.7)',
              transition: 'width 200ms',
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Feed Card ────────────────────────────────────────────────────────────
function FeedCard({ post, theme, onOpen, onBrand }) {
  const onLike = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.V2Live?.setPostLike) {
      await window.V2Live.setPostLike(post.id, !post.liked);
    }
  };

  return (
    <article style={{ marginBottom: 0 }}>
      <PostAuthorRow post={post} theme={theme} onBrand={onBrand} />

      <button type="button" onClick={onOpen} style={{ display: 'block', width: '100%', padding: 0, border: 'none', cursor: 'pointer', background: 'none' }}>
        <PhotoCarousel photos={post.photos} count={post.photoCount} hue={brandHueForPost(post)} theme={theme} />
      </button>

      <PostEngagementRow
        post={post}
        theme={theme}
        onToggleLike={onLike}
        onOpenComments={onOpen}
      />

      <button
        type="button"
        onClick={onOpen}
        style={{
          display: 'block',
          width: '100%',
          padding: '4px 16px 14px',
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontFamily: theme.sans, fontSize: 14, lineHeight: 1.45, color: theme.text, wordBreak: 'break-word' }}>
          <span style={{ fontWeight: 700, color: '#111' }}>{postAuthorUserLabel(post)}</span>
          {post.caption ? (
            <>
              <span style={{ fontWeight: 400 }}>{` ${post.caption}`}</span>
            </>
          ) : null}
        </span>
      </button>

      <div style={{ height: 1, background: theme.border }} />
    </article>
  );
}

function FeedCompactCard({ post, theme, onOpen, onBrand }) {
  const drinkNames = Array.isArray(post.drinks)
    ? post.drinks.map((d) => String(d?.name || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  return (
    <article style={{ borderBottom: `1px solid ${theme.border}` }}>
      <button
        type="button"
        onClick={onOpen}
        style={{ width: '100%', border: 'none', background: 'none', padding: '12px 14px', textAlign: 'left', cursor: 'pointer' }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 12, alignItems: 'start' }}>
          <div style={{ width: 96, height: 96, borderRadius: 12, overflow: 'hidden', border: `1px solid ${theme.border}`, background: theme.surface2 }}>
            {post.photos && post.photos[0] ? (
              <img src={post.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Placeholder label="" hue={brandHueForPost(post)} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
              <span style={{ fontFamily: theme.sans, fontSize: 14, fontWeight: 700, color: '#111', lineHeight: 1.35 }}>
                {postAuthorUserLabel(post)}
              </span>
              <span style={{ fontFamily: theme.sans, fontSize: 11.5, color: theme.muted, flexShrink: 0 }}>
                {toRelativeShort(post) || post.date}
              </span>
            </div>
            <div style={{ fontFamily: theme.sans, fontSize: 14, lineHeight: 1.35, marginBottom: 6 }}>
              <span style={{ color: theme.text }}>@ </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onBrand(); }}
                style={{ border: 'none', background: 'none', padding: 0, margin: 0, cursor: 'pointer', color: theme.accent, fontFamily: theme.sans, fontSize: 14, fontWeight: 700 }}
              >
                {post.brand}
              </button>
            </div>
            {post.caption ? (
              <div style={{
                fontFamily: theme.sans, fontSize: 13, color: theme.text, lineHeight: 1.4, marginBottom: 6,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {post.caption}
              </div>
            ) : null}
            {drinkNames.length > 0 ? (
              <div style={{
                fontFamily: theme.sans, fontSize: 12, color: theme.muted, lineHeight: 1.35, marginBottom: 4,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {drinkNames.join(' · ')}
              </div>
            ) : null}
          </div>
        </div>
      </button>
    </article>
  );
}

function ListFeedCard({ list, theme, onOpen }) {
  const BRANDS = Array.isArray(window.BRANDS) ? window.BRANDS : [];
  const POSTS = Array.isArray(window.POSTS) ? window.POSTS : [];
  const displays = window.resolveListDisplays ? window.resolveListDisplays(list, BRANDS, POSTS) : [];
  const ageMs = Date.now() - (list.createdAt || 0);
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
            {displays.length} {list.type === 'brands' ? 'places' : 'drinks'}
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
            {list.description ? <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, marginTop: 1 }}>{list.description}</div> : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {displays.slice(0, 5).map((row, i) => {
            const photo = row.photo;
            const hue = row.kind === 'brand' ? row.brand?.hue : window.brandHueForPost(row.post);
            const label = row.label;
            const brandId = row.kind === 'brand' ? row.brand?.id : null;
            const showMoreOverlay = displays.length > 5 && i === 4;
            return (
              <div key={row.entry?.id || row.post?.id || i} style={{ width: 88, flexShrink: 0 }}>
                <div style={{ width: 88, height: 88, borderRadius: 10, overflow: 'hidden', border: `1px solid ${theme.border}`, position: 'relative', background: theme.surface2 }}>
                  {row.kind === 'brand' ? (
                    <ListEntryThumbnail photo={photo} placeId={listEntryPlaceId(row)} branch={row.branch} hue={hue} />
                  ) : (
                    photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Placeholder label="" hue={hue} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                  )}
                  {showMoreOverlay ? (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 700, color: '#fff' }}>+{displays.length - 4}</span>
                    </div>
                  ) : null}
                  {brandId && window.userTriedBrand?.(brandId) ? (
                    <div style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', background: theme.accent, border: '1.5px solid rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5 11-12" /></svg>
                    </div>
                  ) : null}
                </div>
                <div style={{
                  fontFamily: theme.sans,
                  fontSize: 11,
                  fontWeight: 600,
                  color: theme.text,
                  lineHeight: 1.25,
                  marginTop: 5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {label}
                </div>
              </div>
            );
          })}
        </div>
      </button>

      <div style={{ padding: '2px 16px 14px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button type="button" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <IconHeart size={18} stroke={theme.text} sw={1.8} />
          <span style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>{list.likeCount || 0}</span>
        </button>
        <button type="button" onClick={onOpen} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>
          View full list →
        </button>
      </div>

      <div style={{ height: 1, background: theme.border }} />
    </article>
  );
}

function FeedScreen({ theme, onOpenPost, onOpenBrand, brandFilterId = null, onBack, onOpenProfile = null, onOpenList = null }) {
  const sourcePosts = brandFilterId ? POSTS.filter((p) => p.brandId === brandFilterId) : POSTS;
  const feedPosts = [...sourcePosts].sort((a, b) => postTimestamp(b) - postTimestamp(a));
  const brand = brandFilterId ? (BRANDS.find((b) => b.id === brandFilterId) || null) : null;
  const [viewMode, setViewMode] = React.useState('photo');
  const Header = window.AppBrandHeader;
  const isCompact = viewMode === 'compact';
  const USER_LISTS = Array.isArray(window.USER_LISTS) ? window.USER_LISTS : [];
  const feedModeButton = (
    <button
      type="button"
      aria-label={isCompact ? 'Switch to photo feed' : 'Switch to review feed'}
      onClick={() => setViewMode((m) => (m === 'photo' ? 'compact' : 'photo'))}
      style={{
        width: 36, height: 36,
        border: 'none', background: 'none',
        color: isCompact ? theme.accent : theme.muted,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', padding: 0,
      }}
    >
      {!isCompact ? (
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <line x1="7" y1="4.5" x2="17" y2="4.5" />
          <rect x="7" y="7" width="10" height="10" rx="2.6" />
          <line x1="7" y1="19.5" x2="17" y2="19.5" />
        </svg>
      ) : (
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4.5" y="3.5" width="15" height="4.5" rx="1.2" />
          <rect x="4.5" y="9.8" width="15" height="4.5" rx="1.2" />
          <rect x="4.5" y="16.1" width="15" height="4.5" rx="1.2" />
        </svg>
      )}
    </button>
  );
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
  const headerRight = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {feedModeButton}
      {profileBtn}
    </div>
  );

  const mixedItems = [];
  if (!brandFilterId && USER_LISTS.length > 0 && onOpenList) {
    feedPosts.forEach((post, i) => {
      mixedItems.push({ kind: 'post', post });
      if ((i + 1) % 2 === 0 && USER_LISTS.length) {
        const listIdx = Math.floor(i / 2) % USER_LISTS.length;
        mixedItems.push({ kind: 'list', list: USER_LISTS[listIdx] });
      }
    });
  } else {
    feedPosts.forEach((post) => mixedItems.push({ kind: 'post', post }));
  }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      {brandFilterId ? (
        <div style={{
          paddingLeft: 16,
          paddingRight: 16,
          paddingBottom: window.APP_BRAND_HEADER_PADDING_BOTTOM,
          paddingTop: window.APP_HEADER_SAFE_TOP,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${theme.border}`, background: theme.surface, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer' }}>
              <IconBack size={18} stroke={theme.text} sw={2} />
            </button>
            <div style={{ fontFamily: theme.sans, fontSize: 18, fontWeight: 600, color: theme.text, letterSpacing: -0.2 }}>
              {brand?.name || 'Brand'} posts
            </div>
          </div>
          <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>
            {feedPosts.length} posts
          </div>
        </div>
      ) : (Header ? <Header theme={theme} rightAction={headerRight} /> : null)}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 90 }}>
        {mixedItems.map((row, idx) => {
          if (row.kind === 'list') {
            return (
              <ListFeedCard
                key={`list-${row.list.id}-${idx}`}
                list={row.list}
                theme={theme}
                onOpen={() => onOpenList && onOpenList(row.list.id)}
              />
            );
          }
          const p = row.post;
          return viewMode === 'compact' ? (
            <FeedCompactCard
              key={p.id}
              post={p}
              theme={theme}
              onOpen={() => onOpenPost(p.id)}
              onBrand={() => onOpenBrand(p.brandId)}
            />
          ) : (
            <FeedCard key={p.id} post={p} theme={theme}
              onOpen={() => onOpenPost(p.id)}
              onBrand={() => onOpenBrand(p.brandId)} />
          );
        })}
        {feedPosts.length === 0 && (
          <div style={{ padding: '24px 16px 56px', fontFamily: theme.sans, fontSize: 14, color: theme.muted, textAlign: 'center' }}>
            {brandFilterId ? 'No posts yet for this brand.' : 'No posts yet.'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Post Detail — everything flat, no expand/collapse ──────────────────────
function FlavorBar({ label, value, color, theme }) {
  if (!value || value === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <span style={{ fontFamily: theme.sans, fontSize: 11, color: theme.muted, width: 88, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: theme.border, borderRadius: 2 }}>
        <div style={{ width: `${(value / 5) * 100}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function DrinkProfileSection({ title, theme, children }) {
  if (!children) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        fontFamily: theme.sans, fontSize: 11, fontWeight: 700, color: theme.muted,
        textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function profileTierHasValues(scales, profile) {
  return scales.some(({ key }) => Number(profile?.[key]) > 0);
}

function DrinkCard({ drink, theme }) {
  const hasDrinkTier = profileTierHasValues(DRINK_PROFILE_SCALES, drink.profile);
  const hasMatchaTier = profileTierHasValues(MATCHA_PROFILE_SCALES, drink.profile);
  const hasNotes = drink.notes && drink.notes.trim();
  const hasTags = drink.flavorNotes && drink.flavorNotes.length > 0;
  const hasMatchaSection = hasTags || hasMatchaTier;
  const hasProfile = hasDrinkTier || hasMatchaSection;

  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 10, padding: '13px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: (hasNotes || hasProfile) ? 8 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: theme.sans, fontSize: 15, fontWeight: 600, color: theme.text }}>{drink.name}</div>
          {drink.recommended ? <IconHeart size={14} filled stroke={theme.accent} /> : null}
        </div>
        {drink.price ? (
          <div style={{ flexShrink: 0, marginLeft: 10 }}>
            <span style={{ fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text }}>
              {formatPhpPrice(drink.price)}
            </span>
          </div>
        ) : null}
      </div>

      {hasNotes && (
        <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.muted, lineHeight: 1.5, marginBottom: hasProfile ? 8 : 0 }}>{drink.notes}</div>
      )}

      {hasDrinkTier ? (
        <DrinkProfileSection title="The Drink" theme={theme}>
          {DRINK_PROFILE_SCALES.map(({ key, label }) => (
            <FlavorBar key={key} label={label} value={Number(drink.profile?.[key]) || 0} color={theme.accent} theme={theme} />
          ))}
        </DrinkProfileSection>
      ) : null}

      {hasMatchaSection ? (
        <DrinkProfileSection title="The Matcha" theme={theme}>
          {hasTags ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: hasMatchaTier ? 10 : 0 }}>
              {drink.flavorNotes.map((n) => (
                <span key={n} style={{ padding: '3px 9px', borderRadius: 999, background: theme.accentLight, color: theme.accent, fontFamily: theme.sans, fontSize: 11, fontWeight: 600 }}>{n}</span>
              ))}
            </div>
          ) : null}
          {MATCHA_PROFILE_SCALES.map(({ key, label }) => (
            <FlavorBar key={key} label={label} value={Number(drink.profile?.[key]) || 0} color={theme.accent} theme={theme} />
          ))}
        </DrinkProfileSection>
      ) : null}
    </div>
  );
}

function commentRowFromFirestore(c) {
  if (!c) return null;
  return {
    id: c.id,
    author: String(c.authorName || c.author || '').replace(/^@/, '') || 'Member',
    text: String(c.text || ''),
    createdAt: c.createdAt,
  };
}

function PostDetailScreen({ theme, postId, onBack, onOpenBrand, onEditPost }) {
  const post = POSTS.find(p => p.id === postId) || POSTS[0];
  const brand = BRANDS.find((b) => b.id === post.brandId) || null;
  const [comments, setComments] = React.useState([]);
  const [loadingComments, setLoadingComments] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const commentsEndRef = React.useRef(null);
  const [brandCardPhotoExtra, setBrandCardPhotoExtra] = React.useState(null);
  const [postMenuOpen, setPostMenuOpen] = React.useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [photoIndex, setPhotoIndex] = React.useState(0);
  const postMenuWrapRef = React.useRef(null);

  const canOpenBrandDetail = Boolean(post?.brandId && BRANDS.some((b) => b.id === post.brandId));

  const openBrand = React.useCallback(() => {
    if (!canOpenBrandDetail || typeof onOpenBrand !== 'function') return;
    onOpenBrand(post.brandId);
  }, [post?.brandId, onOpenBrand, canOpenBrandDetail]);

  const scrollToComments = React.useCallback(() => {
    commentsEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);

  React.useEffect(() => {
    setPhotoIndex(0);
  }, [postId]);

  React.useEffect(() => {
    async function syncEngagement() {
      if (!window.V2Live?.refreshPostEngagement || !postId) return;
      await window.V2Live.refreshPostEngagement(postId);
    }
    syncEngagement();
  }, [postId]);

  React.useEffect(() => {
    const onDoc = (e) => {
      if (!postMenuOpen) return;
      const el = postMenuWrapRef.current;
      if (el && !el.contains(e.target)) setPostMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [postMenuOpen]);

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setPostMenuOpen(false);
        setDeleteConfirmOpen(false);
        setShareOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    setBrandCardPhotoExtra(null);
    const b = BRANDS.find((x) => x.id === post.brandId);
    if (!b) return;
    if (brandCardPhotoSync(b, post)) return;
    const br = pickBranchForBrandPhoto(b, post);
    const placeId = br?.placeId;
    if (!placeId || !window.V2Live?.getPlacePhoto) return;
    let active = true;
    window.V2Live.getPlacePhoto(placeId, false)
      .then((url) => {
        if (active && url) setBrandCardPhotoExtra(url);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [post.id, post.branchId, post.brandId]);

  React.useEffect(() => {
    let active = true;
    async function load() {
      if (!window.V2Live?.comments?.fetch) return;
      setLoadingComments(true);
      try {
        const fetched = await window.V2Live.comments.fetch(postId);
        if (!active) return;
        const list = Array.isArray(fetched) ? fetched : [];
        setComments(list.map(commentRowFromFirestore).filter(Boolean));
      } catch {
        if (!active) return;
        setComments([]);
      } finally {
        if (active) setLoadingComments(false);
      }
    }
    setDraft('');
    load();
    return () => { active = false; };
  }, [postId]);

  const onSubmitComment = async (e) => {
    e?.preventDefault?.();
    const val = String(draft || '').trim();
    if (!val) return;
    const optimistic = { id: `temp-${Date.now()}`, author: 'you', text: val, createdAt: Date.now() };
    setDraft('');
    setComments((prev) => [...prev.filter((c) => !String(c.id || '').startsWith('temp-')), optimistic]);
    try {
      await window.V2Live?.comments?.add?.(postId, val);
      const fetched = await window.V2Live?.comments?.fetch?.(postId);
      const list = Array.isArray(fetched) ? fetched : [];
      setComments(list.map(commentRowFromFirestore).filter(Boolean));
      await window.V2Live?.refreshPostEngagement?.(postId);
    } catch {
      // Keep optimistic row if save failed; user can retry.
    }
  };

  const onLike = async (e) => {
    e.preventDefault();
    if (window.V2Live?.setPostLike) {
      await window.V2Live.setPostLike(post.id, !post.liked);
    }
  };

  const onDeletePost = async () => {
    if (!post?.isOwn) return;
    try {
      if (window.V2Live?.deletePost) await window.V2Live.deletePost(post.id);
      setDeleteConfirmOpen(false);
      onBack();
    } catch {
      // ignore
    }
  };

  const userLine = postAuthorUserLabel(post);
  const locationLine = getPostLocationSecondLine(post);
  const brandCardPhoto = brandCardPhotoSync(brand, post) || brandCardPhotoExtra;
  const orderedKey = toDateKey(post?.orderedAt);
  const postedKey = toDateKey(post?.createdAt);
  const showOrderedDate = Boolean(orderedKey && postedKey && orderedKey !== postedKey);
  const orderedDateLabel = showOrderedDate ? formatDateLabel(post?.orderedAt) : '';

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.surface }}>
      <div style={{
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: window.APP_HEADER_SAFE_TOP,
        paddingBottom: window.APP_BRAND_HEADER_PADDING_BOTTOM,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: `1px solid ${theme.border}`,
        flexShrink: 0,
        background: theme.surface,
      }}>
        <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer' }}>
          <IconBack size={20} stroke={theme.text} sw={2} />
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontFamily: theme.sans, fontSize: 16, fontWeight: 600, color: theme.text }}>
          Post
        </div>
        <div style={{ width: 80, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, position: 'relative' }} ref={postMenuWrapRef}>
          {post?.isOwn ? (
            <>
              <button
                type="button"
                aria-label="Share post"
                onClick={() => setShareOpen(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 6,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconShare size={20} stroke={theme.text} sw={1.8} />
              </button>
              <button
                type="button"
                aria-label="Post options"
                aria-expanded={postMenuOpen}
                onClick={() => setPostMenuOpen((o) => !o)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 6,
                  cursor: 'pointer',
                  color: theme.muted,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconMore size={22} stroke={theme.text} sw={1.8} />
              </button>
              {postMenuOpen ? (
                <div
                  role="menu"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 4,
                    minWidth: 160,
                    borderRadius: 12,
                    border: `1px solid ${theme.border}`,
                    background: theme.card,
                    boxShadow: theme.shadowLg,
                    zIndex: 50,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPostMenuOpen(false);
                      onEditPost?.(post.id);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 14px',
                      border: 'none',
                      borderBottom: `1px solid ${theme.border}`,
                      background: 'none',
                      cursor: 'pointer',
                      fontFamily: theme.sans,
                      fontSize: 14,
                      fontWeight: 500,
                      color: theme.text,
                    }}
                  >
                    Edit post
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPostMenuOpen(false);
                      setDeleteConfirmOpen(true);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 14px',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      fontFamily: theme.sans,
                      fontSize: 14,
                      fontWeight: 500,
                      color: '#b00020',
                    }}
                  >
                    Delete post…
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {deleteConfirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-delete-confirm-title"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 200,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setDeleteConfirmOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 320,
              borderRadius: 16,
              padding: 20,
              background: theme.card,
              border: `1px solid ${theme.border}`,
              boxShadow: theme.shadowLg,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div id="post-delete-confirm-title" style={{ fontFamily: theme.sans, fontSize: 17, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
              Delete this post?
            </div>
            <div style={{ fontFamily: theme.sans, fontSize: 14, color: theme.muted, lineHeight: 1.45, marginBottom: 18 }}>
              This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                style={{
                  padding: '10px 16px',
                  borderRadius: 999,
                  border: `1px solid ${theme.border}`,
                  background: theme.surface,
                  cursor: 'pointer',
                  fontFamily: theme.sans,
                  fontSize: 14,
                  fontWeight: 600,
                  color: theme.text,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void onDeletePost(); }}
                style={{
                  padding: '10px 16px',
                  borderRadius: 999,
                  border: 'none',
                  background: '#b00020',
                  cursor: 'pointer',
                  fontFamily: theme.sans,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#fff',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 30 }}>
        <PostAuthorRow post={post} theme={theme} onBrand={canOpenBrandDetail ? openBrand : undefined} showLocationSubtitle={false} detailLayout />
        {showOrderedDate ? (
          <div style={{ padding: '0 16px 10px', marginTop: -4 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted, lineHeight: 1.4 }}>
              Ordered on {orderedDateLabel}
            </div>
          </div>
        ) : null}

        {post.caption ? (
          <div style={{ padding: '0 18px 10px' }}>
            <div style={{ fontFamily: theme.sans, fontSize: 15, lineHeight: 1.5, color: theme.text, textWrap: 'pretty' }}>
              {post.caption}
            </div>
          </div>
        ) : null}

        <div style={{ width: '100%' }}>
          <PhotoCarousel
            photos={post.photos}
            count={post.photoCount}
            hue={brandHueForPost(post)}
            theme={theme}
            activeIndex={photoIndex}
            onActiveIndexChange={setPhotoIndex}
          />
        </div>

        <div style={{ padding: '12px 18px 0' }}>
          <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            Ordered
          </div>

          {post.drinks.map(d => <DrinkCard key={d.id} drink={d} theme={theme} />)}

          <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 10 }}>
            Location
          </div>

          {canOpenBrandDetail ? (
            <button
              type="button"
              onClick={openBrand}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                border: `1px solid ${theme.border}`,
                borderRadius: 14,
                padding: 12,
                background: theme.card,
                cursor: 'pointer',
                textAlign: 'left',
                marginTop: 0,
                marginBottom: 4,
                boxSizing: 'border-box',
              }}
            >
              <div style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                overflow: 'hidden',
                flexShrink: 0,
                background: theme.surface2,
              }}>
                {brandCardPhoto ? (
                  <img src={brandCardPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Placeholder label="" hue={brandHueForPost(post)} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: theme.sans, fontSize: 17, fontWeight: 600, color: theme.accent, lineHeight: 1.2 }}>
                  {post.brand}
                </div>
                {locationLine ? (
                  <div style={{ fontFamily: theme.sans, fontSize: 13, color: '#A3A3A3', lineHeight: 1.35, marginTop: 4 }}>
                    {locationLine}
                  </div>
                ) : null}
              </div>
            </button>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                border: `1px solid ${theme.border}`,
                borderRadius: 14,
                padding: 12,
                background: theme.card,
                textAlign: 'left',
                marginTop: 0,
                marginBottom: 4,
                boxSizing: 'border-box',
              }}
            >
              <div style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                overflow: 'hidden',
                flexShrink: 0,
                background: theme.surface2,
              }}>
                {brandCardPhoto ? (
                  <img src={brandCardPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Placeholder label="" hue={brandHueForPost(post)} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: theme.sans, fontSize: 17, fontWeight: 600, color: theme.accent, lineHeight: 1.2 }}>
                  {post.brand}
                </div>
                {locationLine ? (
                  <div style={{ fontFamily: theme.sans, fontSize: 13, color: '#A3A3A3', lineHeight: 1.35, marginTop: 4 }}>
                    {locationLine}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <PostEngagementRow post={post} theme={theme} onToggleLike={onLike} onOpenComments={scrollToComments} />

        {/* Inline Comments */}
        <div ref={commentsEndRef} style={{ padding: '8px 16px 26px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontFamily: theme.sans, fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Comments
            </div>
            <div style={{ fontFamily: theme.sans, fontSize: 12, color: theme.muted }}>
              {loadingComments ? '…' : (comments.length > 0 ? String(comments.length) : '')}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {!loadingComments && comments.length === 0 && (
              <div style={{ fontFamily: theme.sans, fontSize: 14, color: theme.muted, padding: '6px 0 10px' }}>
                No comments yet.
              </div>
            )}
            {comments.map((c) => (
              <div key={c.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: '12px 12px', background: theme.card }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 10 }}>
                  <div style={{ fontFamily: theme.sans, fontSize: 13, fontWeight: 700, color: theme.text }}>
                    {c.author}
                  </div>
                </div>
                <div style={{ fontFamily: theme.sans, fontSize: 13, color: theme.text, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                  {c.text}
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={onSubmitComment} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', paddingTop: 2 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a comment…"
              style={{
                flex: 1,
                padding: '11px 13px',
                background: theme.surface2,
                border: `1px solid ${theme.border}`,
                borderRadius: 10,
                outline: 'none',
                fontFamily: theme.sans,
                fontSize: 14,
                color: theme.text,
                boxSizing: 'border-box',
              }}
            />
            <button
              type="submit"
              disabled={!String(draft || '').trim()}
              style={{
                padding: '10px 16px',
                borderRadius: 999,
                border: 'none',
                cursor: String(draft || '').trim() ? 'pointer' : 'not-allowed',
                background: String(draft || '').trim() ? theme.accent : theme.border,
                color: String(draft || '').trim() ? '#fff' : theme.muted,
                fontFamily: theme.sans,
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Post
            </button>
          </form>
        </div>
      </div>

      {shareOpen ? (
        <ShareCardModal
          theme={theme}
          post={post}
          photoIndex={photoIndex}
          onPhotoIndexChange={setPhotoIndex}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </div>
  );
}

window.FeedScreen = FeedScreen;
window.PostDetailScreen = PostDetailScreen;
window.PhotoCarousel = PhotoCarousel;
window.StarRow = StarRow;
