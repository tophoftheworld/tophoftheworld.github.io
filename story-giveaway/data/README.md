# Story giveaway entry pack

CSV header (exact):

```
filename,username,display_name,notes,story_date,story_time,frame_type,content_type
```

| column | required | notes |
| --- | --- | --- |
| `filename` | yes | Exact basename in `photos/` |
| `username` | no | Shown on winners; else file name |
| `display_name` | no | Optional |
| `notes` | no | Optional |
| `story_date` | no | e.g. `2026-07-21` |
| `story_time` | no | e.g. `8:54 PM` |
| `frame_type` | no | `framed` or `fullscreen` — framed zooms UI crop so the inner repost card fills the cell |
| `content_type` | no | e.g. `drink`, `workshop`, `merch`, `store`, `other` |

Import in admin: Upload photos → Import entries (`entries.csv`).
