# onevsall king siege MVP

Continuous browser multiplayer siege prototype:
- One player is always the **king**
- Everyone else are **siegers**
- Everyone can shoot
- If the king dies, the killer becomes the new king immediately
- Old king respawns as a regular sieger
- King keeps their kill position when promoted (no king-respawn jump)
- King can place breakable blocks on an internal grid by dragging
- King can place simple auto-target turrets
- Blocks are solid; players cannot walk through them
- King can spawn/remove bots with `+` / `-`
- World size is expanded to 2400x1400 with a player-follow camera
- Minimap shows king marker, buildables, and current viewport window
- Default map loads from `onevsall/maps/default-map.json`
- No block placement cap (temporary tuning)

## Run locally

1. Install server dependencies:
   - `cd onevsall/server`
   - `npm install`
2. Start:
   - `npm start`
3. Open the URL printed in terminal (auto-falls back if 8080 is busy):
   - Example: `http://localhost:8081`

Open multiple tabs/windows to test king takeover flow.

## Controls

- Move: `WASD` or arrow keys
- Aim + shoot: mouse + left click (all players)
- King tool select: `1` weapon, `2` block, `3` turret
- Block tool: hold left mouse and drag to paint grid blocks (`E` places one block at cursor)
- Turret tool: left click to place turret on grid
- King-only bot control: `+` adds bot, `-` removes bot
- Camera continuously tracks your player near-center, only offsetting at arena edges; minimap indicates where you are on the map

## Gameplay notes

- The game is continuous (no round resets).
- Server is authoritative for movement, bullets, damage, deaths, king promotion, and block state.
- King hold time is tracked and shown live.
- Raider/sieger deaths respawn as siegers.
- When king dies, killer becomes king and old king respawns as a sieger.
- Turrets auto-target the nearest non-king player in range and fire server-authoritative shots.
- Turrets require clear line-of-sight and do not shoot through blocking walls.
- Turret projectiles do not damage blocks.
- Turrets never target/damage other turrets.
- Bots are objective-focused siegers that pressure the king.

## Map editor

- Open `onevsall/map-editor/index.html` in browser.
- Paint modes: permanent walls, damageable blocks, erase.
- Supports pan + zoom and drag painting.
- Editor auto-loads from `/api/map` and saves directly back to `onevsall/maps/default-map.json` via `Save Map`.

## Explicitly not in MVP

- Multiple weapons
- Reload/inventory systems
- Classes/abilities/perks
- Resource economy/upgrades
- Matchmaking or persistent progression

## Deploy (simple path)

- Deploy `onevsall/server` as a Node service on Render/Fly/Railway.
- Keep start command: `node index.js`.
- The server also serves the client, so one URL runs both HTTP + WebSocket.
- Production should use `wss://` automatically when served over `https://`.
