# Doodle Verse 3D — coordinates

## World space (Rapier = Three.js)

| Axis | Meaning |
|------|---------|
| **X** | Walk left/right |
| **Y** | Up (jump, gravity −Y); floor top at **y = 0** |
| **Z** | Depth into the diorama |

**Rule:** `heroBody.translation()` is the capsule **center**. Hero root is at `(x, y - footOffset, z)`.

## Map

- **56 × 56** unit square arena.
- Spawn near `(8, 1.2, 28)`; inner play bounds inset ~2 units.
- Level colliders tagged **FLOOR** (ground) or **MAP** (platforms, walls).

## Camera modes

- **Chicory (default):** orthographic follow in [`js/render/camera.js`](js/render/camera.js). W walks into the map (−Z).
- **Debug fly cam:** perspective WASD + mouse look ([`js/input/fly-camera.js`](js/input/fly-camera.js)). Disables hero move and stroke paint.

## Stroke plane (2.5D parity)

- Paint raycasts to vertical plane **z = strokePlaneZ** (hero Z on pointer down).
- Stroke points are **{ x, y }** on that XY sheet (not the floor).
- Preview ink sits on the same plane at `strokePlaneZ`.
- On release, `computeStrokePlacement` may lift strokes drawn above the hero on screen.
- Rapier collider: ribbon hull in **XY**, extruded ±**Z** (`COLLIDER_HALF_Z`).
- Rotation: **Z** only. Bodies settle with bottom at **y = 0**.
- **Ink anchor** = raster bbox corner (`render.offsetX/Y`). Must match physics after snap.

## Debug overlays (HUD)

| Toggle | Shows |
|--------|--------|
| Show physics | Green hull + XZ AABB (at collider world min Y), cyan hero capsule |
| Show coords | Orange floor→body line, XYZ labels |
| Ink bounds | Magenta quad matching ink mesh |
| Stroke plane | Wire grid at each doodle `planeZ` + live plane while drawing |
| Body axes | RGB axes at hero + doodle bodies |
| Spawn anchors | White = raster origin, yellow = body, cyan = collider bottom |
| Stroke points | Orange dots at raw spawn vertices |

## HUD (next stroke)

- **Gravity** on → collision forced on, dynamic body.
- **Gravity** off → fixed body; collision optional (sensor when off).
