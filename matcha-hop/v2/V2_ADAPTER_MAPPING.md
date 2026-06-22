# v2 Adapter Mapping

Prototype data model is mapped to live strict schema writes as follows:

- `post.brandId` <- `visit.brandId`
- `post.branchId` <- `visit.location.cafeId`
- `post.brand` <- `visit.brandName`
- `post.location` <- `visit.location.cafeName` (fallback address)
- `post.rating` <- `post.rating`
- `post.caption` <- `post.caption`
- `post.photoCount` <- `post.photos.length` (minimum 1 for UI placeholder carousel)
- `post.drinks[]` <- `post.drinks[]`
  - `name` <- `name`
  - `rating` <- `rating`
  - `notes` <- `notes`
  - `price` <- `price`
  - `flavorNotes` <- `flavorNotes[]`
  - `profile.sweet|bitter|umami` <- `profile.sweet|bitter|umami`

Write path:

- `v2/components/screens-log.jsx` emits prototype-style payload.
- `v2/bootstrap.js` maps payload to strict `saveLog()` structure (`schemaVersion: 3` via `data.js` normalization).

Read path:

- `v2/bootstrap.js` calls `initData()`, `getGalleryBrands()`, `getLogs()`.
- Results are transformed into prototype-facing `BRANDS/POSTS/PINS` arrays.
