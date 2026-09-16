# AI apply verdict (debug)

## Rule (non-negotiable)

**Never invent invoice fields from user-text regex / “intentional apply.”**
Gemini structured JSON is the only write path for cups, guests, venue, date, drinks, milk, etc.
If Gemini’s `invoice` is unchanged, the preview stays unchanged — show that honestly in debug.

## What to show in `[AI DEBUG]`

- `chatClaim` — short assistantMessage
- `structChanges` — only fields that actually changed vs before this turn
- `previewCounts` — live preview cup/guest snapshot
- `verdict` — `STRUCT_CHANGED` | `NO_STRUCT_CHANGE`

## Allowed post-processing (not inventing)

- Sparse merge / overlay (empty Gemini fields do not wipe filled form)
- Cup triad resolve (stale `"100 Cups"` vs `numberOfPax`)
- Contamination scrub (bad addresses / compound client names)
- Dual-milk fee line when options already say dairy and oat
