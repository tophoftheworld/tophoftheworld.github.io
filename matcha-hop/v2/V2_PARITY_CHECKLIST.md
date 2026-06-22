# v2 Parity + Functional Checklist

## Visual parity

- [ ] Map tab layout matches prototype shell and control spacing.
- [ ] Brands grid/detail/branch views preserve prototype typography and card rhythm.
- [ ] Feed and post detail match prototype hierarchy and interaction affordances.
- [ ] New post screen matches prototype structure (header, photo tile, fields, drink cards).
- [ ] Mine screen layout and stats cards match prototype style language.

## Live data wiring

- [ ] `BRANDS` populated from live gallery brands.
- [ ] `POSTS` populated from strict logs collection.
- [ ] `PINS` derived from live branch coordinates.
- [ ] New post writes to live Firebase using strict schema.

## Navigation behavior

- [ ] Tab switching works for map/brands/feed/mine.
- [ ] Brand -> branch -> post drill-down works.
- [ ] Plus button opens log composer.
- [ ] Post save returns to previous screen and refreshes data.
