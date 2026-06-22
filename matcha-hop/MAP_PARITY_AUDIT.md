# Map Parity Audit (Selector and Structure Contracts)

This file records map-screen DOM/CSS/JS contracts that must remain intact during target-style parity work.

## Must-keep DOM IDs and classes

- Map shell and visibility toggles:
  - `#panel-map` (active panel state)
  - `#map` (Google Maps mount point)
  - `.search-bar` (hidden when location page opens)
  - `#map-recenter-btn` (shown/hidden by map move state)
  - `#location-page` (map detail overlay in same panel)
- Search and clear:
  - `#search-input`
  - `#search-clear`
  - `#search-results-label`
- Bottom sheet:
  - `#bottom-sheet` and `.closed`
  - `#bottom-sheet-content`
  - `.bottom-sheet-handle`
- Injected sheet detail hooks from `showBottomSheet()`:
  - `.place-details-clickable`
  - `.place-details-photo`
  - `.place-details-google`
  - `#place-details-heart`
  - `#place-details-heart-count`
  - `.log-thumb-btn[data-log-id]`

## JS behavior dependencies

- `openLocationPage()` / `closeLocationPage()` toggle `.hidden` on:
  - `#map`, `.search-bar`, `#map-recenter-btn`, `#location-page`
- Recenter visibility (`updateRecenterButtonVisibility()`) assumes:
  - `#map-recenter-btn` exists
  - `#location-page` hidden state controls recenter suppression
- Bottom sheet open/close assumes:
  - `#bottom-sheet` class `closed` controls visibility
  - `#bottom-sheet-content` is replaced by `innerHTML` on each selection
- Search workflow assumes:
  - `#search-input` events call `doSearch()` / `clearSearchAndShowCurated()`
  - `#search-clear` toggles hidden state via `updateSearchResultsLabel()`

## CSS coupling risks

- `css/style.css` is shared by consumer app, admin, and debug pages.
- Global selectors (`.tab-bar`, `.bottom-sheet`, `.search-bar`) can regress non-map surfaces if not scoped.
- Current mitigation for this pilot:
  - map-first overrides are scoped under `.map-parity-scope` where possible
  - bottom sheet overrides are limited to `body.app-with-tabs` context

## Conflicts discovered (for next screens)

- **Structure conflict:** target React component tree does not map 1:1 to current DOM that `app.js` directly queries and mutates.
- **Feature conflict:** target map behavior is custom panning; current app uses Google Maps + live Places/Firestore data.
- **Backend conflict:** target is mock/local data; current app relies on Firebase-backed entities and dynamic content injection.
- **Migration implication:** parity should prioritize visual language and interaction feel, while preserving current data contracts and IDs/classes used by existing JS modules.

## Pilot regression checklist (completed)

- Search input path preserved: `#search-input` still drives `doSearch()` and clear behavior.
- Search clear visibility preserved: `#search-clear` still toggled by `updateSearchResultsLabel()`.
- Recenter behavior preserved: `#map-recenter-btn` still wired to `recenterMapToCurrentLocation()` and movement checks.
- Bottom-sheet open/close preserved: `#bottom-sheet` + `.closed` contract unchanged.
- Location navigation preserved:
  - Existing `.place-details-clickable` open path unchanged.
  - Added explicit `.place-details-view-btn` path to open the same `openLocationPage(cafe)` flow.
- Tab switching safety preserved: moving off map still calls `hideBottomSheet()` and `closeLocationPage()` in `setActiveTab()`.
