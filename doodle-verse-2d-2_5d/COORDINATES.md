# Doodle Verse 2.5D — world coordinates

Canonical reference for Rapier 3D physics + canvas draw.
Helpers: [`js/coords.js`](js/coords.js).

## Single world space

**Rapier `body.translation()` is the only position.** There is no parallel `groundX` / `groundZ` game state.

| Axis | Meaning |
|------|---------|
| **X** | Horizontal on the map |
| **Y** | Up (height, jump, tip); gravity **−Y**; floor at **y = 0** |
| **Z** | Map depth (into/out of the screen in the top-down view) |

## Canvas projection (orthographic 2.5D)

The game keeps the top-down turf look. World 3D maps to the canvas like this:

```
mapX = worldX
mapY = worldZ − worldY    // +Y lifts upward on screen
```

Then the camera pans/zooms on `(mapX, mapY)`. All drawing uses `worldToCanvas(x, y, z)` from [`coords.js`](js/coords.js).

- Turf tiles: drawn in the map plane (conceptually **y = 0**).
- Ink / sprites: `translate(mapX, mapY)` then `rotate(tip around X)`.
- Hero feet: project `(x, y − heroRadius, z)`; shadow: `(x, 0, z)`.

## Physics

- **Floor:** static XZ collider, top at **y = 0**.
- **Hero:** dynamic ball; **WASD sets velocity on X/Z**; **Space** sets upward **Y** velocity; Rapier integrates all axes.
- **Doodles:** dynamic convex hull (thin in **Z**); tip torque around **X** only when grounded.

## Doodle spawn

| Case | Body translation (approx.) |
|------|----------------------------|
| Gravity off | `(anchorX, 0, planeZ)` fixed |
| Gravity on, stroke on/near floor | `(anchorX, 0, planeZ)` after bottom snap to floor |
| Gravity on, stroke above player | `(anchorX, spawnY, playerZ)` then fall to floor |

`planeZ` = hero **z** while painting (depth slice).

## Do / don't

- **Do** read/write `body.translation()` for position.
- **Do** use `worldToCanvas` / `canvasToWorldOnPlane` for paint and draw.
- **Don't** teleport bodies to a separate script position each frame (except landing snap / bounds clamp).
