// Mock data — replace picsum URLs with real photos when available

// Post photos (drink/food shots, 600×600)
const POST_PHOTOS = [
  'https://picsum.photos/seed/ck-post1/600/600',
  'https://picsum.photos/seed/ck-post2/600/600',
  'https://picsum.photos/seed/ck-post3/600/600',
  'https://picsum.photos/seed/ck-post4/600/600',
  'https://picsum.photos/seed/ck-post5/600/600',
  'https://picsum.photos/seed/ck-post6/600/600',
];

// Cafe/brand hero photos (600×400)
const CAFE_PHOTOS = {
  matchaya_bgc:  'https://picsum.photos/seed/ck-br-mbgc/600/400',
  matchaya_pob:  'https://picsum.photos/seed/ck-br-mpob/600/400',
  hoji:          'https://picsum.photos/seed/ck-br-hoji/600/400',
  yabuki_kap:    'https://picsum.photos/seed/ck-br-ykap/600/400',
  yabuki_kat:    'https://picsum.photos/seed/ck-br-ykat/600/400',
  midori:        'https://picsum.photos/seed/ck-br-midr/600/400',
  uji:           'https://picsum.photos/seed/ck-br-ujis/600/400',
  chaen:         'https://picsum.photos/seed/ck-br-chan/600/400',
};

const BRANDS = [
  {
    id: 'b1', name: 'Matchaya', hue: 120, kind: 'cafe', area: 'BGC / Taguig', region: 'Metro Manila',
    branches: [
      { id: 'br1a', name: 'Matchaya BGC', address: '28th St, BGC, Taguig', neighborhood: 'BGC', photoUrl: CAFE_PHOTOS.matchaya_bgc, hours: 'Mon–Sun 9am–9pm', tags: ['wifi', 'outlets', 'pet-friendly'], area: 'BGC / Taguig' },
      { id: 'br1b', name: 'Matchaya Poblacion', address: 'Poblacion, Makati', neighborhood: 'Makati', photoUrl: CAFE_PHOTOS.matchaya_pob, hours: 'Mon–Sun 11am–11pm', tags: ['wifi', 'outdoor-seating'], area: 'Makati' },
    ],
  },
  {
    id: 'b2', name: 'Hoji', hue: 95, kind: 'cafe', area: 'Makati', region: 'Metro Manila',
    branches: [
      { id: 'br2a', name: 'Hoji Salcedo', address: 'Salcedo Village, Makati', neighborhood: 'Makati', photoUrl: CAFE_PHOTOS.hoji, hours: 'Tue–Sun 8am–6pm', tags: ['wifi', 'no-corkage', 'outlets'], area: 'Makati' },
    ],
  },
  {
    id: 'b3', name: 'Yabuki', hue: 140, kind: 'cafe', area: 'Multiple', region: 'Metro Manila',
    branches: [
      { id: 'br3a', name: 'Yabuki Kapitolyo', address: 'Kapitolyo, Pasig', neighborhood: 'Pasig', photoUrl: CAFE_PHOTOS.yabuki_kap, hours: 'Wed–Mon 10am–8pm', tags: ['parking', 'cash-only'], area: 'Pasig' },
      { id: 'br3b', name: 'Yabuki Katipunan', address: 'Katipunan Ave, QC', neighborhood: 'QC', photoUrl: CAFE_PHOTOS.yabuki_kat, hours: 'Wed–Mon 10am–8pm', tags: ['wifi', 'parking', 'study-friendly'], area: 'Quezon City' },
    ],
  },
  {
    id: 'b4', name: 'Midori Cafe', hue: 105, kind: 'cafe', area: 'Quezon City', region: 'Metro Manila',
    branches: [
      { id: 'br4a', name: 'Midori Cafe', address: 'Scout Rallos, QC', neighborhood: 'QC', photoUrl: CAFE_PHOTOS.midori, hours: 'Mon–Sun 8am–9pm', tags: ['wifi', 'outlets', 'parking', 'pet-friendly'], area: 'Quezon City' },
    ],
  },
  {
    id: 'b5', name: 'Uji House', hue: 132, kind: 'popup', area: 'Pop-up / Various', region: 'Metro Manila',
    branches: [
      { id: 'br5a', name: 'Uji House Pop-up', address: 'Various locations', neighborhood: 'Metro Manila', photoUrl: CAFE_PHOTOS.uji, hours: 'Weekends only', tags: ['pop-up', 'limited'], area: 'Pop-up / Various' },
    ],
  },
  {
    id: 'b6', name: 'Chaen', hue: 118, kind: 'cafe', area: 'Makati', region: 'Metro Manila',
    branches: [
      { id: 'br6a', name: 'Chaen Legazpi', address: 'Legazpi Village, Makati', neighborhood: 'Makati', photoUrl: CAFE_PHOTOS.chaen, hours: 'Mon–Sat 9am–7pm', tags: ['wifi', 'quiet', 'specialty'], area: 'Makati' },
    ],
  },
];

const POSTS = [
  {
    id: 'p1', brandId: 'b1', branchId: 'br1a', brand: 'Matchaya', branchName: 'Matchaya BGC',
    address: '28th St, BGC, Taguig',
    authorHandle: 'chloe', authorDisplayName: 'Chloe R.', avatarInitial: 'C',
    caption: 'Incredibly smooth usucha, the bitterness was just right.',
    review: 'The ceremonial grade here is top-tier — vibrant green, no bitterness creep. Service was warm and unhurried. Highly recommend the seasonal usucha set.',
    rating: 4.5, date: 'May 3', createdAt: Date.now() - 1000 * 60 * 60 * 3,
    photos: [POST_PHOTOS[0], POST_PHOTOS[1]], photoCount: 2,
    drinks: [
      { id: 'd1', name: 'Ceremonial Usucha', price: '280', rating: 5, notes: 'Vibrant green, no bitterness creep.', flavorNotes: ['umami', 'grassy', 'vegetal'], profile: { sweet: 1, bitter: 2, umami: 5 } },
      { id: 'd2', name: 'Matcha Latte', price: '195', rating: 4, notes: 'Creamy oat milk base.', flavorNotes: ['creamy', 'mild'], profile: { sweet: 3, bitter: 1, umami: 2 } },
    ],
    likeCount: 18, commentCount: 4, liked: false, isOwn: true,
  },
  {
    id: 'p2', brandId: 'b2', branchId: 'br2a', brand: 'Hoji', branchName: 'Hoji Salcedo',
    address: 'Salcedo Village, Makati',
    authorHandle: 'marco', authorDisplayName: 'Marco L.', avatarInitial: 'M',
    caption: 'Best dirty matcha in the metro. Fight me.',
    review: 'The espresso shot they use here is single-origin and plays so well against the ceremonial matcha. The foam on top is thick and velvety. Not overly sweet.',
    rating: 5, date: 'May 2', createdAt: Date.now() - 1000 * 60 * 60 * 28,
    photos: [POST_PHOTOS[2]], photoCount: 1,
    drinks: [
      { id: 'd3', name: 'Dirty Matcha', price: '220', rating: 5, notes: 'Single-origin espresso shot.', flavorNotes: ['umami', 'toasted', 'bitter'], profile: { sweet: 2, bitter: 4, umami: 4 } },
    ],
    likeCount: 42, commentCount: 11, liked: true, isOwn: false,
  },
  {
    id: 'p3', brandId: 'b3', branchId: 'br3a', brand: 'Yabuki', branchName: 'Yabuki Kapitolyo',
    address: 'Kapitolyo, Pasig',
    authorHandle: 'yuki', authorDisplayName: 'Yuki T.', avatarInitial: 'Y',
    caption: 'Seasonal yuzu matcha is back and I am not okay.',
    review: 'Citrusy and bright — the yuzu cuts through the earthiness really nicely. Limited batch so go now.',
    rating: 4.5, date: 'Apr 28', createdAt: Date.now() - 1000 * 60 * 60 * 96,
    photos: [POST_PHOTOS[3], POST_PHOTOS[4], POST_PHOTOS[5]], photoCount: 3,
    drinks: [
      { id: 'd4', name: 'Yuzu Matcha', price: '260', rating: 5, notes: 'Citrusy, bright, seasonal batch.', flavorNotes: ['citrus', 'fruity', 'grassy'], profile: { sweet: 2, bitter: 2, umami: 3 } },
    ],
    likeCount: 31, commentCount: 6, liked: false, isOwn: false,
  },
  {
    id: 'p4', brandId: 'b4', branchId: 'br4a', brand: 'Midori Cafe', branchName: 'Midori Cafe',
    address: 'Scout Rallos, QC',
    authorHandle: 'chloe', authorDisplayName: 'Chloe R.', avatarInitial: 'C',
    caption: 'Great study spot, reliable matcha latte.',
    review: 'Not the most exciting menu but very consistent. Quiet atmosphere, good wifi, and the latte is always a safe bet.',
    rating: 3.5, date: 'Apr 24', createdAt: Date.now() - 1000 * 60 * 60 * 144,
    photos: [POST_PHOTOS[5]], photoCount: 1,
    drinks: [
      { id: 'd5', name: 'Iced Matcha Latte', price: '175', rating: 3, notes: 'Solid, consistent.', flavorNotes: ['mild', 'creamy'], profile: { sweet: 3, bitter: 1, umami: 2 } },
    ],
    likeCount: 9, commentCount: 2, liked: false, isOwn: true,
  },
  {
    id: 'p5', brandId: 'b1', branchId: 'br1b', brand: 'Matchaya', branchName: 'Matchaya Poblacion',
    address: 'Poblacion, Makati',
    authorHandle: 'marco', authorDisplayName: 'Marco L.', avatarInitial: 'M',
    caption: 'Late night matcha at Poblacion — surprisingly chill vibes.',
    review: 'Open till 11pm which is rare. Good for when you want something sweet after dinner. The koicha is bold and really satisfying.',
    rating: 4, date: 'Apr 20', createdAt: Date.now() - 1000 * 60 * 60 * 200,
    photos: [POST_PHOTOS[1], POST_PHOTOS[0]], photoCount: 2,
    drinks: [
      { id: 'd6', name: 'Koicha', price: '320', rating: 4, notes: 'Thick, bold, earthy.', flavorNotes: ['earthy', 'umami', 'bitter'], profile: { sweet: 1, bitter: 4, umami: 5 } },
    ],
    likeCount: 22, commentCount: 3, liked: false, isOwn: false,
  },
];

// User lists
const USER_LISTS = [
  {
    id: 'l1', name: 'Faves in Makati', type: 'brands',
    description: 'Go-tos when in the CBD.',
    coverHue: 120, createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
    items: ['b2', 'b1', 'b6'],
    authorHandle: 'chloe', isOwn: true, likeCount: 8,
  },
  {
    id: 'l2', name: 'Best Ceremonial Bowls', type: 'drinks',
    description: 'For when I need the real thing.',
    coverHue: 95, createdAt: Date.now() - 1000 * 60 * 60 * 24 * 12,
    items: ['p1', 'p2'],
    authorHandle: 'chloe', isOwn: true, likeCount: 14,
  },
  {
    id: 'l3', name: 'Hidden Gems', type: 'brands',
    description: 'Less crowded, worth the detour.',
    coverHue: 140, createdAt: Date.now() - 1000 * 60 * 60 * 24 * 20,
    items: ['b5', 'b6'],
    authorHandle: 'marco', isOwn: false, likeCount: 31,
  },
  {
    id: 'l4', name: 'Weekend Pop-up Spots', type: 'brands',
    description: 'Seasonal and rotating — keep an eye out.',
    coverHue: 132, createdAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
    items: ['b5'],
    authorHandle: 'yuki', isOwn: false, likeCount: 19,
  },
];

// Events — simplified categories: popup | workshop | fest | crawl
const EVENTS = [
  {
    id: 'ev1',
    title: 'Matcha Fest: Spring Edition',
    type: 'fest',
    date: new Date(2026, 4, 10),
    endDate: new Date(2026, 4, 10),
    timeLabel: '10am – 6pm',
    location: 'Legazpi Sunday Market, Makati',
    address: 'Legazpi Village, Makati City',
    description: 'A curated gathering of Metro Manila\'s top matcha brands. Taste, shop, and connect with the local matcha community.',
    merchantIds: ['b1', 'b2', 'b6'],
    coverHue: 120,
    coverPhoto: CAFE_PHOTOS.matchaya_bgc,
    status: 'upcoming',
    submittedBy: 'chloe',
  },
  {
    id: 'ev2',
    title: 'Uji House',
    subtitle: 'BGC High Street Weekend',
    type: 'popup',
    date: new Date(2026, 4, 17),
    endDate: new Date(2026, 4, 18),
    timeLabel: 'Sat–Sun 11am – 7pm',
    location: 'BGC High Street, Taguig',
    address: 'High Street Central, BGC',
    description: 'Uji House brings their rare single-origin ceremonial grade for a two-day pop-up. Limited allocation per day.',
    merchantIds: ['b5'],
    coverHue: 132,
    coverPhoto: CAFE_PHOTOS.uji,
    status: 'upcoming',
    submittedBy: 'yuki',
  },
  {
    id: 'ev3',
    title: 'Ceremonial Matcha 101',
    type: 'workshop',
    date: new Date(2026, 4, 22),
    endDate: new Date(2026, 4, 22),
    timeLabel: '6pm – 9pm',
    location: 'Yabuki Kapitolyo',
    address: 'Kapitolyo, Pasig',
    description: 'An intimate guided workshop with 5 preparation styles of ceremonial matcha. Limited to 20 seats.',
    merchantIds: ['b3'],
    coverHue: 140,
    coverPhoto: CAFE_PHOTOS.yabuki_kap,
    status: 'upcoming',
    submittedBy: 'marco',
  },
  {
    id: 'ev4',
    title: 'Chakaiki Matcha Crawl',
    type: 'crawl',
    date: new Date(2026, 4, 5),
    endDate: new Date(2026, 4, 5),
    timeLabel: '2pm – 7pm',
    location: 'Makati CBD',
    address: 'Starting at Hoji Salcedo Village',
    description: 'Community matcha crawl across 3 Makati spots. Casual, drop-in, bring your app.',
    merchantIds: ['b2', 'b6', 'b1'],
    coverHue: 95,
    coverPhoto: CAFE_PHOTOS.hoji,
    status: 'ongoing',
    submittedBy: 'chloe',
  },
  {
    id: 'ev5',
    title: 'Hoji',
    subtitle: 'Salcedo Weekend Market',
    type: 'popup',
    date: new Date(2026, 4, 24),
    endDate: new Date(2026, 4, 24),
    timeLabel: 'Sat 8am – 2pm',
    location: 'Salcedo Saturday Market',
    address: 'Salcedo Village, Makati',
    description: 'Hoji sets up at Salcedo Market. Ceremonial usucha and seasonal specials only.',
    merchantIds: ['b2'],
    coverHue: 95,
    coverPhoto: CAFE_PHOTOS.hoji,
    status: 'upcoming',
    submittedBy: 'marco',
  },
  {
    id: 'ev6',
    title: 'Metro Matcha Fest 2026',
    type: 'fest',
    date: new Date(2026, 5, 7),
    endDate: new Date(2026, 5, 8),
    timeLabel: 'Sat–Sun 10am – 8pm',
    location: 'Filinvest Festival Mall, Alabang',
    address: 'Filinvest City, Alabang',
    description: 'The biggest matcha event of the year — 10+ brands, live demos, workshops, and exclusive collabs.',
    merchantIds: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
    coverHue: 118,
    coverPhoto: CAFE_PHOTOS.chaen,
    status: 'upcoming',
    submittedBy: 'marco',
  },
];

// Which brands the current user (chloe) has posted about
function userTriedBrand(brandId) {
  return POSTS.some(p => p.brandId === brandId && (p.isOwn || p.authorHandle === 'chloe'));
}

window.BRANDS = BRANDS;
window.POSTS = POSTS;
window.USER_LISTS = USER_LISTS;
window.EVENTS = EVENTS;
window.POST_PHOTOS = POST_PHOTOS;
window.CAFE_PHOTOS = CAFE_PHOTOS;
window.userTriedBrand = userTriedBrand;
