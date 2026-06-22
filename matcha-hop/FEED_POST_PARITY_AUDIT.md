# Feed + Post Detail Parity Audit

This audit documents selector and behavior contracts preserved for the feed/post parity pass.

## Must-keep selectors and containers

- Feed containers:
  - `#panel-feed`, `#feed-list`
  - `#panel-mylogs`, `#mylogs-list`
- Post detail containers:
  - `#post-page`, `#post-page-content`
- Reused card/detail hooks:
  - `.photo-feed-card`
  - `.feed-card__like-btn`, `.feed-card__comments-btn`
  - `#post-page-back-btn`, `#post-page-close-btn`

## JS behavior contracts preserved

- `createPhotoFeedCard()` still controls card render + click-to-open-detail.
- `openLogDetail()` still sets `postPageReturnState` and hides location/brand overlays before opening detail.
- `closeLogDetail()` still restores prior context from `postPageReturnState` (location page, brand page, or active tab).
- `renderPhotoFeedList()` and `refreshPhotoFeedsIfVisible()` remain the feed refresh entry points.
- Likes/comments remain UI-local state via `uiPostState`, with rerender through `refreshPhotoFeedsIfVisible()`.

## Scoped styling strategy

- Feed parity is scoped under `.feed-parity-scope` (attached to `#panel-feed`).
- Post parity is scoped under `.post-parity-scope` (attached to `#post-page`).
- This reduces regression risk on map/brand/admin/debug surfaces that share `style.css`.

## Known conflicts and mitigations

- Shared renderer conflict:
  - `createPhotoFeedCard()` is reused by location/brand embedded feeds.
  - Mitigation: parity-heavy selectors scoped to `.feed-parity-scope`; shared structure changes kept minimal.
- Navigation coupling conflict:
  - Detail back behavior depends on hidden/is-active contracts.
  - Mitigation: no structural changes to visibility control flow.
- Data shape mismatch:
  - Prototype assumes cleaner post model; app supports fallback fields.
  - Mitigation: keep `getLogDrinks()` and fallback rendering in place.
- CSS cascade conflict:
  - `style.css` has multiple override layers.
  - Mitigation: parity block placed late and container-scoped.

## Regression checklist (for this pass)

- Feed cards still open post detail on card click.
- Like/comment buttons still stop propagation and do not trigger detail open.
- Post detail back/close still returns to correct prior context.
- My-post feed still renders and refreshes correctly.
- Location/brand feeds still render cards without JS errors.
