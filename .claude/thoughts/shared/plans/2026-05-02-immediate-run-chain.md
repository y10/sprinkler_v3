# Immediate-Run Chain Implementation Plan

## Overview

Add an ad-hoc "chain" feature on the landing page (`html/js/screens/zone-list.js`) that lets the user drag from one zone tile to another to build a connected sequence and run it immediately, with a 5-min gap between zones and a default 15-min duration per zone. Keeps the existing single-zone start/stop/long-press behavior intact when no chain is being built. The mechanic mirrors the drag-to-connect UX from `html/js/controls/pattern-connector.js` already used by the schedule page.

The persisted weekly schedule sequence (`SprinklerSequenceConfig` in EEPROM, `App.sequence()` on the client) is **not** modified — the chain is a separate, ephemeral runtime concept.

## Revision Log — 2026-07-05 review pass

This plan was reviewed against the live sources; the sources' line citations were verified accurate. The firmware gap/advance mechanics were sound; the UI tap-state machine and several firmware lifecycle edges were not. The changes below are folded into the phases (finding IDs referenced inline where the fix lands):

**Blockers fixed**
- **A1** — Tap could never *start* an idle chain: `isQueuedNotStarted()` returned `true` for every tile when `!active`, so every tap routed to `remove()`. Fixed the model predicate and rewrote the Phase 4 `onZoneCheck` state machine so an idle built chain starts on tap; remove-while-running is a distinct mode.
- **A2** — Double-tap-to-clear is unimplementable (`checkbox.js:209-221` collapses double-click and long-press into one bare `pick` with no metadata). **Dropped from the spec.** Clear is via the X (menu toggle) and drag-replace.
- **A3** — Desktop drag-commit synthesizes a phantom `check`/`pick` on the drop/origin tile (`jquery.js:251-284`; only touch is drag-guarded). Added a `suppressClicksUntil` guard on drag-end.
- **A4** — Wrapping tiles in `.zone-slot` breaks `.container sketch-checkbox:nth-child(${zone})` state selectors (`zone-list.js:105,190`). Switched to `[zone-id]`-keyed selectors and made the Phase 4 selector update explicit.
- **A5** — `deactivate()` never fires for ZoneList (only `slider.js` calls it; ZoneList mounts directly in `sprinkler-main`). Moved cleanup + idle-chain clear to `disconnectedCallback` and an outlet `navigate-from` hook.
- **A6** — `chainStateJSON()` was called from `sprinkler-http.h` but never declared in `sprinkler.h` (build break). Added the declaration.
- **A7** — Any chain-unaware stop of the running zone (Alexa/MQTT/other client/ring double-tap) stranded the chain (`adhoc=true` forever). Added chain-awareness to firmware `stop(zone)`/`stop()` and rerouted the zone-ring taps in chain mode.
- **A8** — Mid-run "remove queued zone" was client-only and reverted on the next broadcast. Added `POST /api/chain/update` (rewrites order/durations from `currentIndex+1` onward under the mutex) and routed remove/duration edits through it while running.

**Concerns fixed**
- **B2** — `chainAdvance()`'s `stop(/* zone unavailable */)` compiled as stop-ALL. Now `chainAdvance(uint8_t zone)` → `stop(zone)`.
- **B3/B8** — `stop()`/`disable()`/`startSequenceSession()` could wipe or clobber an adhoc chain with no broadcast and no guard. Added chain-event firing and a scheduled-vs-adhoc guard on the shared `SequenceSession`.
- **B4** — Stop→start via the command queue raced (queued `CMD_STOP_ALL` reset a freshly-written session). `requestChainStart` now stops running zones synchronously under the mutex; the client `stop().then(start())` pattern is removed.
- **B5** — `Status.notify` does not exist → `Status.information`.
- **B6** — `Router` was unimported in `zone.js` → added import.
- **B7** — Finish and stop both sent `null`, so the UI never returned to baseline after a completed chain. Firmware now sends a distinct `{"done":true}` final payload; `applyServerState` clears the order on it.
- **B9** — `chainStateJSON()` for `/api/chain/state` ran unlocked. Now taken under `sprinklerStateMutex`, mirroring `safeStateJSON`.
- **B10/B11** — Listener cleanup lived in dead `deactivate()`, and Index bound its chain listener in `render()` (re-runs on refresh). Cleanup → `disconnectedCallback`; Index binds once in `connectedCallback`.
- **B12** — The X double-meaning (close-menu / clear-chain) is retained by spec but documented as an accepted UX tradeoff (no dead state; verified no menu/chain collision).
- **B13** — Phase 3 mock claims were overstated; `http.mock.js` had no `/api/chain/*` routes. Added mock routes and corrected the verification wording.
- **B14** — Drag-replace didn't stop a running chain. `replace()` now stops the server chain when active.
- **B1** — The expiry Ticker read of `SequenceSession` remains lock-free but is safe: the `order[idx]==Zone` guard plus the `!adhoc` fallback degrade any misread to a plain `CMD_STOP`. The gap-end path was moved onto the command queue (`CMD_CHAIN_NEXT`) so it now runs under the mutex (C3).

**Suggestions applied**: C1 (drop unused `App` import in `chain.js`), C2 (`setDuration` 0-handling), C3 (`CMD_CHAIN_NEXT` for mutex-safe gap-end; `chainStartNext` now used), C4 (add `inGap` to chain JSON), C5 (fix "auto-generated barrel" mislabel — it is the root `Index` component), C6 (mid-run duration edits route through `/api/chain/update`), C7 (delete superseded append-during-run code block and the unresolved self-argument in Testing).

## Current State Analysis

**Firmware:**
- `SprinklerControl::start/stop/pause/resume` all enqueue commands onto a FreeRTOS queue drained by `processCommands()` under `sprinklerStateMutex` (`sprinkler.cpp:501-516`).
- `SprinklerZoneTimer`'s natural-expiry `Ticker` callback always enqueues `CMD_STOP` (`sprinkler-state.h:41-46, 72-77`).
- `SequenceSession` (`sprinkler-state.h:103-127`) tracks scheduled-sequence progress: `active`, `paused`, `currentZoneIndex`, `totalZones`. Today it's only set by `scheduled()` → `startSequenceSession()` when a scheduled timer fires inside `isInSequenceWindow()` (`sprinkler.cpp:81-115`). No code path sets `active=true` for ad-hoc runs yet.
- `SprinklerSequenceConfig` (`sprinkler-config.h:24-45`) is the EEPROM-persisted weekly sequence — defaults `duration=15`, `gap=5`, `enabled=false`. **Untouched by this plan.**
- HTTP route registration at `sprinkler-http.h:51-310`. Pattern for path-arg GETs at `:78-91`; pattern for JSON-body POSTs (with size cap) at `:195-205` using `AsyncCallbackJsonWebHandler`.
- WebSocket broadcast pattern: `Sprinkler.on("state", ...)` at `:54-56` wraps the body in `{"state": <body>}`. The JS client (`wsc.js:97`) takes the first key as the event type, so adding `fireEvent("chain", ...)` will dispatch a separate `chain` listener with no interference.

**UI:**
- `sketch-checkbox` already differentiates click types via the jQuery `onClick` wrapper that injects `e.ticks` and `e.clicks` (`checkbox.js:209-221`): single tap fires `check`, long-press (>800 ms) or double-click fires `pick`.
- `zone-list.js:60-225` wires `check` → `onZoneCheck` (HTTP start/stop) and `pick` → `onZoneClick` (`Router.navigate('zone', { popup, params })`).
- `pattern-connector.js:120-414` is the drag-to-connect reference: mousedown on a tile → `selectedOrder = [zoneId]`, mousemove with 200 ms dwell over a neighbor adds it, drag-end commits the order via `change` event. Also draws SVG quadratic Bezier connectors and order badges via `updateVisuals()`/`drawLines()`.
- `sketch-menu-toggle` (`menu-toggle.js`) has a hamburger↔X morph driven by the `opened` class. Today driven from `index.js:78-88` on `navigate-to`/`navigate-from` events.
- `zone.js` (the duration ring popup) already calls `Http.json('GET', 'api/zone/' + this.zone.id + '/' + action, params)` on minute change (`:319-333, :585-593`). Adding a `chain` mode means swapping the destination of that call.
- Outlet `deactivate()` is a clean hook for "navigate away → clear chain"; `zone-list.js` already implements `activate()`/`deactivate()` (`:149-158`).

**Key constraints:**
- Hardware: only one source pin (pump or utility) can be on at a time; parallel solo runs are physically impossible.
- The 5-min gap between zones must turn the source relay OFF (no dead-heading the pump). On gap-end, the next zone's `CMD_START` re-engages it via the existing `start()` path.
- Mutex-protected state: HTTP context (async-tcp) may take `sprinklerStateMutex` briefly to write the chain config onto `SequenceSession`, mirroring the existing `safeStateJSON` read pattern (`sprinkler.h:92-118`).

## Desired End State

### User experience
- Drag from any zone tile on the landing page to another → builds an ordered chain with SVG connectors and numeric order badges, identical look to the schedule page.
- **Chain built but idle** (not yet running): tap *any* chained tile → runs the whole chain immediately (zone 1 for its duration → 5 min gap → zone 2 → ...). *(A1: this is the single start gesture; every chained tile starts the run when idle.)*
- **Chain running**:
  - Tap the **running** tile → stop chain.
  - Tap a **queued, not-yet-started** tile → remove it from the remaining queue (server-side via `/api/chain/update`, so the removal actually sticks — A8).
  - Tap an **unchained** tile → *not supported while running*; show `Status.information("Stop chain to add zones")`. Append-during-run is out of scope (see What We're NOT Doing). *(B5: `Status.information`, not `notify`.)*
  - Tap a **completed** tile → no-op.
- Long-press on any tile (chained or not) → opens the existing `<sprinkler-zone>` duration ring; in chain mode the ring's start/stop taps are disabled and dropdown changes update the chain slot's duration instead of starting a solo run. For a *queued* slot while running, the duration edit is pushed to the server via `/api/chain/update` (C6). *(A7: ring taps must not issue a solo stop that would strand the chain.)*
- Drag from any tile → replaces the current chain; if a chain is running, the replace first stops it server-side (`replace()` issues `/api/chain/stop` when active — B14).
- Default: 15 min/zone, 5 min gap.
- The hamburger menu icon morphs to X whenever the chain has ≥1 zone; tapping the X clears the chain. *(B12: the X is intentionally overloaded — "close menu" off-main, "clear chain" on-main-with-items; verified there is no dead-X state and the two meanings never collide. Accepted UX tradeoff: a user tapping X expecting "menu" clears the chain instead. Swipe-up still opens the menu.)*
- Navigating away from the landing page clears an *idle* chain. *(A5: implemented in `disconnectedCallback` + the outlet `navigate-from` hook, NOT the dead `deactivate()`.)*

> **Dropped gesture (A2):** double-tap-to-clear. `sketch-checkbox` collapses double-click and long-press into one metadata-less `pick` event, so the two cannot be told apart without editing `checkbox.js`. Clear is available via the X and via drag-replace; that is sufficient.

### Verification
- `deno task build` succeeds; gzipped HTML/JS headers update in `arduino/html/`.
- `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino` succeeds.
- On a deployed device:
  - Drag-built chain on landing runs zones sequentially, with engine cycling off between zones.
  - Page refresh mid-chain re-paints the chain visualization from the WebSocket `chain` event.
  - Stop and clear gestures cancel cleanly without stranded relays or pending Tickers.

### Key Discoveries
- `SprinklerSequenceConfig` defaults already match the chain defaults (15/5) — `sprinkler-config.h:34-37`. We do not need new config defaults.
- `SequenceSession::reset()` (`sprinkler-state.h:112-117`) is the single place to clear runtime sequence state — extend it once for `adhoc`/`order`/`durations`/`gap`.
- The Ticker callback inside `SprinklerZoneTimer` (`sprinkler-state.h:41`) is where a natural zone-end produces a command — it gets the advance-vs-stop branch. (Note: `stop()` itself also needs a chain-aware branch for *external* stops — A7 — so the Ticker is not the *only* place chain lifecycle is decided.)
- **Correction (A5):** `ZoneList.deactivate()` (`zone-list.js:156-158`) does **NOT** fire — it is only called by `slider.js`, and ZoneList has no slider. Navigate-away clearing lives in the root `Index.onNavigateFrom` (Phase 5); listener cleanup lives in `ZoneList.disconnectedCallback` (which does run).
- `index.js:78-88` already drives `sketch-menu-toggle.opened` on outlet navigation events — we extend the same pattern for "chain has zones" (bound once in `connectedCallback`, not `render()` — B11).

## What We're NOT Doing

- **No EEPROM changes.** `SprinklerSequenceConfig` and the rest of `SprinklerConfig` are untouched. Persistent weekly sequence behavior is unaffected.
- **No changes to the schedule page** (`sequence-builder.js`, `pattern-connector.js`). Drag mechanic is referenced/copied, not edited.
- **No persistence of the chain across page reloads or device reboots.** Chain is ephemeral in firmware (`SequenceSession` runtime fields) and ephemeral in the browser. A page refresh during a running chain re-paints from the WebSocket `chain` event; a refresh while chain is *idle* (built but not started) wipes it client-side because we don't broadcast idle chains.
- **No new gestures** beyond what's in the brief. Triple-tap, swipe-to-reorder, etc. are out of scope. **Double-tap-to-clear is also dropped** (A2 — unimplementable without editing `checkbox.js`; the X and drag-replace cover clearing).
- **No append-during-run.** Tapping an unchained tile while the chain runs shows a "Stop chain to add zones" hint and does nothing else. `/api/chain/update` (added for mid-run *remove* and duration edits) only rewrites the *not-yet-started* tail; it deliberately does not grow the queue mid-run. Append is a possible follow-up.
- **No multi-source coordination.** Single source pin assumption is honored.
- **No Alexa/MQTT integration** for chain. (Future work; current voice control still operates on individual zones — and starting a zone via Alexa while a chain runs simply appends it via the existing `requestStart` path because it's not chain-aware. We accept that for now; documented as a known limitation.)
- **No "save chain as schedule" feature.** That's the schedule page's job.

## Implementation Approach

Six incremental phases. Each compiles cleanly and is independently testable on its own. UI phases use the dev mock (`html/js/system/http.mock.js`) where possible to test before flashing.

The chain runtime queue lives **on the firmware** as the source of truth (`SequenceSession.adhoc/order/durations/gap`). During the **build-up phase** (drag, add, remove, slot-duration edits before start) the queue is purely client-side. On `start` the client sends the whole queue; thereafter the firmware is authoritative and the client reads back via the `chain` WebSocket event. **Mutations while running** (remove a queued zone, edit a queued slot's duration) go to the server via `POST /api/chain/update`, which rewrites only the not-yet-started tail under the mutex — client-only edits would be reverted by the next broadcast (A8).

---

## Phase 1: Firmware — extend `SequenceSession` and add `CMD_CHAIN_ADVANCE`

### Overview
Extend the runtime sequence session struct with ad-hoc fields, add the new command, and update the natural-expiry Ticker dispatch to enqueue advance instead of stop when running an ad-hoc chain. No HTTP routes or new behavior wired yet — just the structural plumbing.

### Changes Required

#### 1. `arduino/sprinkler-state.h`
**Changes**:
- Add four commands to `enum ZoneAction` at `:16-24`. All chain lifecycle **mutations** are routed through the command queue so they are serialized with each other and with `CMD_STOP_ALL` in the single-consumer `processCommands()` task — this is what closes the B4 stop→start race (the HTTP task must not write `SequenceSession` directly while a `CMD_STOP_ALL` is still queued):
  - `CMD_CHAIN_START   = 8` — HTTP staged a new chain in `pendingChain`; build the session and kick off zone 1 (serialized).
  - `CMD_CHAIN_UPDATE  = 9` — HTTP staged a not-yet-started tail rewrite for the running chain (A8).
  - `CMD_CHAIN_ADVANCE = 10` — a zone's Ticker expired; advance the chain. `cmd.zone` carries the expired zone (B2).
  - `CMD_CHAIN_NEXT    = 11` — gap timer elapsed; start the next zone. Exists so the gap-end path runs **under the mutex** instead of touching `SequenceSession` from the bare Ticker callback (C3, closes the gap-path half of B1).
  - Chain **stop** reuses the existing `CMD_STOP_ALL` — `stop()` (stop-all) is made chain-aware in Phase 2 (A7/B3), so no separate stop command is needed.
- Add fields to `SequenceSession` (`:103-127`): `bool adhoc`, `uint8_t order[6]`, `uint8_t durations[6]`, `uint8_t gapMinutes`, `bool inGap`. (`inGap` lets `chainStateJSON()` tell the client whether the current index is mid-gap vs actively watering, so a refresh mid-gap renders correctly — C4.)
- Update `SequenceSession::reset()` (`:112-117`) to clear all new fields (`adhoc=false`, `inGap=false`, zero-fill `order`/`durations`, `gapMinutes=0`).
- Update `SequenceSession::toJSON()` (`:119-126`) to include `adhoc`, `order`, `durations`, `gap`, `inGap` when active.
- Add `Ticker chainGapTimer` member to `SprinklerState` (`:129-153`) for scheduling the inter-zone gap.
- Add a `PendingChain` staging struct + member to `SprinklerState` — the HTTP task fills this under the mutex, and the `CMD_CHAIN_START`/`CMD_CHAIN_UPDATE` handlers consume it in the command task:
  ```cpp
  struct PendingChain { uint8_t order[6]; uint8_t durations[6]; uint8_t count; uint8_t gap; };
  PendingChain pendingChain{};
  ```
  One buffer suffices: the command queue serializes consumption; two rapid requests are last-writer-wins on the buffer, which is harmless (both enqueued commands then act on the latest payload).
- Add a global pointer for the Ticker lambda to read sequence state without including `sprinkler.h` (avoids circular header dep): `extern SequenceSession* sprinklerActiveSequence;`.
- Modify the Ticker lambdas at `:41-46` (in constructor) and `:72-77` (in `resume()`) to branch on the global sequence pointer:
  ```cpp
  timer.once_ms(ms, +[](SprinklerZoneTimer* x) {
    if (x->stopping.load()) return;
    if (sprinklerActiveSequence &&
        sprinklerActiveSequence->adhoc &&
        sprinklerActiveSequence->currentZoneIndex < sprinklerActiveSequence->totalZones &&
        sprinklerActiveSequence->order[sprinklerActiveSequence->currentZoneIndex] == x->Zone) {
      ZoneCommand cmd = { CMD_CHAIN_ADVANCE, (uint8_t)x->Zone, 0 };
      xQueueSend(sprinklerCommandQueue, &cmd, 0);
    } else {
      ZoneCommand cmd = { CMD_STOP, (uint8_t)x->Zone, 0 };
      xQueueSend(sprinklerCommandQueue, &cmd, 0);
    }
  }, this);
  ```
  **Concurrency note (B1):** this lambda runs in the esp_timer task and reads `sprinklerActiveSequence->{adhoc,currentZoneIndex,totalZones,order[]}` **without** `sprinklerStateMutex`, while `processCommands()` mutates those fields under the mutex. This is intentional and safe: the read only *chooses which command to enqueue*, and the compound guard (`adhoc && currentZoneIndex < totalZones && order[currentZoneIndex] == x->Zone`) plus the `else` fallback mean any torn/stale read degrades to a plain `CMD_STOP` for the expiring zone — never a wrong-zone start or a queue corruption. The actual sequence mutation happens later, serialized inside `processCommands()`. `xQueueSend` from this context is fine — ESP32 core 2.0.x dispatches Tickers from the esp_timer *task*, not an ISR (matches the existing pattern). The gap-end path does **not** get this treatment: it goes through `CMD_CHAIN_NEXT` so its state mutation is serialized (C3).

#### 2. `arduino/sprinkler-state.cpp`
**Changes**:
- Add definition of the global pointer: `SequenceSession* sprinklerActiveSequence = nullptr;` near the top.

#### 3. `arduino/sprinkler.cpp`
**Changes**:
- In `setupCommands()` (`:520-522`), set the pointer right after `Sprinkler.initCommandQueue()`:
  ```cpp
  sprinklerActiveSequence = &Sprinkler.Timers.Sequence;
  ```

### Success Criteria

#### Automated Verification:
- [x] Web assets build: `deno task build`
- [x] Firmware compiles: `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`
- [x] No new compiler warnings in `sprinkler-state.h/.cpp` or `sprinkler.cpp`.
- [x] Sketch size still under flash budget (currently ~79%, slack ~21%).

#### Manual Verification:
- [x] Existing scheduler-driven sequence still works end-to-end on hardware (regression check — `Sequence.adhoc` defaults `false`, so the new branch is a no-op for non-chain runs).
- [x] Existing single-zone start/stop/pause/resume still works on hardware.
- [x] Boot safety stop (`end()` in `arduino.ino`) still completes without errors.

**Implementation Note**: After Phase 1 passes both automated and manual checks, pause for confirmation before Phase 2.

---

## Phase 2: Firmware — chain HTTP routes, advance handler, WebSocket `chain` event

### Overview
Wire the new command into `processCommands()`, add the chain start/stop public API on `SprinklerControl`, register HTTP routes, and broadcast the chain state over WebSocket whenever it changes.

### Changes Required

#### 1. `arduino/sprinkler.h`
**Changes**:
- Add public methods on `SprinklerControl` after the existing `request*` block (`:120-127`):
  ```cpp
  // HTTP-context enqueuers (async-tcp): stage payload + enqueue, never mutate SequenceSession directly
  void requestChainStart(const uint8_t* order, uint8_t orderCount,
                         const uint8_t* durations, uint8_t gap);
  void requestChainStop();
  void requestChainUpdate(const uint8_t* order, uint8_t orderCount,  // A8: mid-run tail rewrite
                          const uint8_t* durations);
  // command-task workers (run inside processCommands, mutex already held)
  void chainStart();                 // CMD_CHAIN_START  — build session from pendingChain, start zone 1 (B4)
  void chainUpdate();                // CMD_CHAIN_UPDATE  — rewrite not-yet-started tail from pendingChain (A8)
  void chainAdvance(uint8_t zone);   // CMD_CHAIN_ADVANCE — cmd.zone is the expired zone (B2)
  void chainStartNext();             // CMD_CHAIN_NEXT    — gap elapsed, start next zone under mutex (C3)
  String chainStateJSON();           // A6/B9: public, takes the mutex — called from sprinkler-http.h
 private:
  String chainStateJSONLocked();     // B9: assumes caller holds sprinklerStateMutex (used by fireEvent paths)
  ```
  **A6:** the original plan called `Sprinkler.chainStateJSON()` from `sprinkler-http.h` and defined it in `sprinkler.cpp` but never declared it here — that is a compile error. The declaration above fixes it.
- Change the `stop()` overloads' signatures for chain-awareness (A7): `void stop(unsigned int zone, bool fromChain = false);` — the default keeps every existing caller working; only `chainAdvance` passes `true`.
- Add to `processCommands()` switch in `sprinkler.cpp:505-513`:
  ```cpp
  case CMD_CHAIN_START:   chainStart();           break;   // B4: serialized after any pending CMD_STOP_ALL
  case CMD_CHAIN_UPDATE:  chainUpdate();          break;   // A8
  case CMD_CHAIN_ADVANCE: chainAdvance(cmd.zone); break;   // B2: pass the expiring zone
  case CMD_CHAIN_NEXT:    chainStartNext();       break;   // C3: gap elapsed, start next zone under mutex
  ```
  (Chain **stop** needs no new case — `requestChainStop()` enqueues the existing `CMD_STOP_ALL`, whose `stop()` handler is now chain-aware.)

#### 2. `arduino/sprinkler.cpp`
**Changes**:
- Add `requestChainStart` (HTTP context, async-tcp) — **stage the payload and enqueue; do NOT write `SequenceSession` here** (B4). Writing the session from this task while a `CMD_STOP_ALL` is still queued was the race; now the session build happens in `chainStart()` inside the command task, strictly after any pending stop drains:
  ```cpp
  void SprinklerControl::requestChainStart(const uint8_t* order, uint8_t orderCount,
                                           const uint8_t* durations, uint8_t gap) {
    if (orderCount == 0 || orderCount > SKETCH_MAX_ZONES) return;
    xSemaphoreTake(sprinklerStateMutex, portMAX_DELAY);
    auto& p = Timers.pendingChain;
    memset(p.order, 0, sizeof(p.order));
    memset(p.durations, 0, sizeof(p.durations));
    memcpy(p.order, order, orderCount);
    memcpy(p.durations, durations, orderCount);
    p.count = orderCount;
    p.gap = gap;
    xSemaphoreGive(sprinklerStateMutex);
    enqueue(CMD_CHAIN_START, 0, 0);        // built + started in chainStart(), serialized
  }
  ```
- Add `requestChainStop` (HTTP context) — just enqueue the existing stop-all; `stop()` is now chain-aware (A7/B3) and fires the `chain` event itself, so this needs no session writes and no direct `fireEvent`:
  ```cpp
  void SprinklerControl::requestChainStop() {
    enqueue(CMD_STOP_ALL);                 // stop() detaches gap timer, clears adhoc, resets, fires chain:null
  }
  ```
- Add `requestChainUpdate` (HTTP context, A8) — stage the new tail and enqueue:
  ```cpp
  void SprinklerControl::requestChainUpdate(const uint8_t* order, uint8_t orderCount,
                                            const uint8_t* durations) {
    if (orderCount > SKETCH_MAX_ZONES) return;
    xSemaphoreTake(sprinklerStateMutex, portMAX_DELAY);
    auto& p = Timers.pendingChain;
    memset(p.order, 0, sizeof(p.order));
    memset(p.durations, 0, sizeof(p.durations));
    memcpy(p.order, order, orderCount);
    memcpy(p.durations, durations, orderCount);
    p.count = orderCount;
    xSemaphoreGive(sprinklerStateMutex);
    enqueue(CMD_CHAIN_UPDATE, 0, 0);
  }
  ```
- Add `chainStart()` — the command-task worker (mutex held by `processCommands`). Serialized after any pending `CMD_STOP_ALL`, so no torn session (B4). Refuses to hijack an in-progress **scheduled** sequence (B8):
  ```cpp
  void SprinklerControl::chainStart() {
    auto& p = Timers.pendingChain;
    if (p.count == 0) return;
    auto& s = Timers.Sequence;
    if (s.active && !s.adhoc) return;      // B8: a scheduled sequence owns the session — don't clobber it
    stop();                                // sync stop-all: engine off, all tickers off; if replacing a
                                           //   running chain, this fires chain:null and resets the session
    s.adhoc = true;
    s.active = true;
    s.paused = false;
    s.inGap = false;
    s.currentZoneIndex = 0;
    s.totalZones = p.count;
    s.gapMinutes = p.gap;
    memcpy(s.order, p.order, p.count);
    memcpy(s.durations, p.durations, p.count);
    enqueue(CMD_START, s.order[0], s.durations[0]);   // zone 1
    fireEvent("chain", chainStateJSONLocked());
  }
  ```
- Add `chainUpdate()` — rewrites only the **not-yet-started** tail (A8). Already-run and currently-running slots are immutable; the staged payload is `[currentZone, <new tail...>]` from the client so index/progress are preserved:
  ```cpp
  void SprinklerControl::chainUpdate() {
    auto& s = Timers.Sequence;
    auto& p = Timers.pendingChain;
    if (!s.adhoc || !s.active || p.count == 0) return;
    if (p.order[0] != s.order[s.currentZoneIndex]) return;  // head must be the live zone — reject stale updates
    uint8_t base = s.currentZoneIndex;
    for (uint8_t i = 0; i < p.count && base + i < SKETCH_MAX_ZONES; i++) {
      s.order[base + i] = p.order[i];
      s.durations[base + i] = p.durations[i];
    }
    s.totalZones = base + p.count;
    fireEvent("chain", chainStateJSONLocked());
  }
  ```
- Add the sync chain-advance handler (`CMD_CHAIN_ADVANCE`, mutex held). Takes the expired zone (B2), guards against a stale Ticker, sends a distinct finish payload (B7), and arms the gap timer to enqueue `CMD_CHAIN_NEXT` (C3 — the lambda no longer reads `SequenceSession`, killing the gap-path race):
  ```cpp
  void SprinklerControl::chainAdvance(uint8_t zone) {
    auto& s = Timers.Sequence;
    if (!s.adhoc) { stop(zone); return; }          // B2: cancelled between fire and dequeue — just stop the zone
    if (s.currentZoneIndex >= s.totalZones ||
        s.order[s.currentZoneIndex] != zone) {     // stale Ticker for a non-current zone — stop it, don't advance
      stop(zone);
      return;
    }

    stop(zone, /*fromChain=*/true);                // stop current zone (engine off; count→0). fromChain=true so
                                                   //   stop() does NOT run its external-stop teardown (A7)
    s.currentZoneIndex++;

    if (s.currentZoneIndex >= s.totalZones) {      // finished
      s.adhoc = false;
      s.reset();
      fireEvent("chain", "{\"done\":true}");       // B7: finish is distinct from user-stop (which sends null)
      return;
    }

    s.inGap = true;                                // C4: client can render "in gap" vs "watering"
    Timers.chainGapTimer.detach();
    Timers.chainGapTimer.once((float)s.gapMinutes * 60.0f, +[]() {
      ZoneCommand cmd = { CMD_CHAIN_NEXT, 0, 0 };   // C3: start-next runs under the mutex in chainStartNext()
      xQueueSend(sprinklerCommandQueue, &cmd, 0);
    });

    fireEvent("chain", chainStateJSONLocked());
  }
  ```
- Add `chainStartNext()` (`CMD_CHAIN_NEXT`, mutex held) — gap elapsed, start the next zone:
  ```cpp
  void SprinklerControl::chainStartNext() {
    auto& s = Timers.Sequence;
    if (!s.adhoc || s.currentZoneIndex >= s.totalZones) return;   // cancelled during the gap → no-op
    s.inGap = false;
    enqueue(CMD_START, s.order[s.currentZoneIndex], s.durations[s.currentZoneIndex]);
    fireEvent("chain", chainStateJSONLocked());
  }
  ```
- **Make `stop()` chain-aware (A7 / B3)** — this is what keeps a chain from being stranded when the running zone is stopped by *anything other than the chain engine* (Alexa, MQTT, another browser tab, the zone-ring, a raw `/api/zone/N/stop`):
  - **Single-zone `stop(unsigned int zone, bool fromChain = false)`** — after the existing stop-one body, if the stopped zone was the live chain zone and this was **not** an internal chain advance, tear the chain down cleanly and notify clients:
    ```cpp
    if (!fromChain && Timers.Sequence.adhoc &&
        Timers.Sequence.currentZoneIndex < Timers.Sequence.totalZones &&
        Timers.Sequence.order[Timers.Sequence.currentZoneIndex] == zone) {
      Timers.chainGapTimer.detach();
      Timers.Sequence.adhoc = false;
      Timers.Sequence.reset();
      fireEvent("chain", "null");                // A7: external stop of the live zone ends the chain
    }
    ```
  - **Stop-all `stop()`** (`:171-181`, already calls `Sequence.reset()`) — capture `adhoc` before the reset and fire once:
    ```cpp
    bool wasAdhoc = Timers.Sequence.adhoc;
    Timers.chainGapTimer.detach();             // B3: also kills a pending gap advance
    Timers.Sequence.adhoc = false;
    // ...existing stop-all body incl. Sequence.reset()...
    if (wasAdhoc) fireEvent("chain", "null");
    ```
    This covers `disable()` / `/api/schedule/disable` and Alexa `requestStop()`, which route through stop-all — previously they killed the chain firmware-side with no client broadcast (B3).
- Add the `chainStateJSON()` helpers — a public one that takes the mutex for HTTP (`/api/chain/state`, B9) and a private `chainStateJSONLocked()` for the event-fire paths that already hold it:
  ```cpp
  String SprinklerControl::chainStateJSON() {                 // B9: HTTP/async context — lock
    xSemaphoreTake(sprinklerStateMutex, portMAX_DELAY);
    String j = chainStateJSONLocked();
    xSemaphoreGive(sprinklerStateMutex);
    return j;
  }

  String SprinklerControl::chainStateJSONLocked() {           // caller holds sprinklerStateMutex
    auto& s = Timers.Sequence;
    if (!s.adhoc) return "null";
    String j = "{\"active\":true,\"currentIndex\":" + String(s.currentZoneIndex) +
               ",\"totalZones\":" + String(s.totalZones) +
               ",\"gap\":" + String(s.gapMinutes) +
               ",\"inGap\":" + String(s.inGap ? "true" : "false") +
               ",\"order\":[";
    for (uint8_t i = 0; i < s.totalZones; i++) {
      if (i) j += ",";
      j += String(s.order[i]);
    }
    j += "],\"durations\":[";
    for (uint8_t i = 0; i < s.totalZones; i++) {
      if (i) j += ",";
      j += String(s.durations[i]);
    }
    j += "]}";
    return j;
  }
  ```
- **`startSequenceSession()` guard (B8)** — the scheduled-sequence path shares this same `SequenceSession`. Guard it so a scheduled timer firing mid-chain can't clobber an adhoc run: at the top of `startSequenceSession()` (`sprinkler.cpp:81-91`), `if (Timers.Sequence.adhoc) return;`. Conversely, `chainStart()` already refuses to start when a scheduled sequence is active (see above), so the two can't cross-clobber in either direction.

#### 3. `arduino/sprinkler-http.h`
**Changes**:
- Register the WebSocket `chain` event broadcaster alongside the existing `state` one (`:54-56`):
  ```cpp
  Sprinkler.on("chain", [](const char *event) {
    ws.textAll((String) "{ \"chain\": " + (String)(strlen(event) ? event : "null") + "}");
  });
  ```
- After the existing `/api/zone/{}/...` block (post `:118`), add:
  ```cpp
  http.addHandler(new AsyncCallbackJsonWebHandler(
      "/api/chain/start", [&](AsyncWebServerRequest *request, JsonVariant &jsonDoc) {
        JsonObject obj = jsonDoc.as<JsonObject>();
        if (!obj.containsKey("order") || !obj["order"].is<JsonArray>()) {
          request->send(400, "application/json", "{\"error\":\"missing order\"}");
          return;
        }
        JsonArray orderArr = obj["order"].as<JsonArray>();
        if (orderArr.size() == 0 || orderArr.size() > 6) {
          request->send(400, "application/json", "{\"error\":\"invalid order length\"}");
          return;
        }
        uint8_t order[6] = {0};
        uint8_t durations[6] = {0};
        uint8_t i = 0;
        JsonObject durObj = obj["durations"].as<JsonObject>();
        for (JsonVariant v : orderArr) {
          uint8_t z = v.as<uint8_t>();
          if (z < 1 || z > SKETCH_MAX_ZONES) {
            request->send(400, "application/json", "{\"error\":\"invalid zone\"}");
            return;
          }
          order[i] = z;
          uint8_t d = durObj.containsKey(String(z)) ? durObj[String(z)].as<uint8_t>() : 15;
          if (d == 0 || d > SKETCH_TIMER_DEFAULT_LIMIT) d = 15;
          durations[i] = d;
          i++;
        }
        uint8_t gap = obj.containsKey("gap") ? obj["gap"].as<uint8_t>() : 5;
        if (gap > 30) gap = 30;
        console.println("POST: /api/chain/start order=" + String(orderArr.size()));
        Sprinkler.requestChainStart(order, orderArr.size(), durations, gap);
        ok(request);
      },
      512));

  // A8: mid-run tail rewrite (remove a queued zone, or edit a queued slot's duration).
  // Body: { "order": [<currentZone>, <new tail...>], "durations": { "<zone>": <min>, ... } }
  // The client MUST send the currently-running zone as order[0] so the firmware can verify
  // it against s.currentZoneIndex and reject stale updates.
  http.addHandler(new AsyncCallbackJsonWebHandler(
      "/api/chain/update", [&](AsyncWebServerRequest *request, JsonVariant &jsonDoc) {
        JsonObject obj = jsonDoc.as<JsonObject>();
        if (!obj.containsKey("order") || !obj["order"].is<JsonArray>()) {
          request->send(400, "application/json", "{\"error\":\"missing order\"}");
          return;
        }
        JsonArray orderArr = obj["order"].as<JsonArray>();
        if (orderArr.size() > SKETCH_MAX_ZONES) {
          request->send(400, "application/json", "{\"error\":\"invalid order length\"}");
          return;
        }
        uint8_t order[6] = {0};
        uint8_t durations[6] = {0};
        uint8_t i = 0;
        JsonObject durObj = obj["durations"].as<JsonObject>();
        for (JsonVariant v : orderArr) {
          uint8_t z = v.as<uint8_t>();
          if (z < 1 || z > SKETCH_MAX_ZONES) {
            request->send(400, "application/json", "{\"error\":\"invalid zone\"}");
            return;
          }
          order[i] = z;
          uint8_t d = durObj.containsKey(String(z)) ? durObj[String(z)].as<uint8_t>() : 15;
          if (d == 0 || d > SKETCH_TIMER_DEFAULT_LIMIT) d = 15;
          durations[i] = d;
          i++;
        }
        console.println("POST: /api/chain/update order=" + String(orderArr.size()));
        Sprinkler.requestChainUpdate(order, orderArr.size(), durations);
        ok(request);
      },
      512));

  http.on("/api/chain/stop", ASYNC_HTTP_POST, [&](AsyncWebServerRequest *request) {
    console.println("POST: /api/chain/stop");
    Sprinkler.requestChainStop();
    ok(request);
  });

  http.on("/api/chain/state", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    json(request, Sprinkler.chainStateJSON());   // B9: chainStateJSON() takes the mutex internally
  });
  ```
  **Finish vs stop over WebSocket (B7):** the broadcaster wraps the event body verbatim, so a natural finish reaches the browser as `{ "chain": {"done":true} }` and a user-stop as `{ "chain": null }`. The client tells them apart in `applyServerState` (Phase 3): `done` clears the built chain (returns the UI to baseline — happy-path step 7), `null` just marks it inactive.

### Success Criteria

#### Automated Verification:
- [x] Web assets build: `deno task build`
- [x] Firmware compiles: `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`
- [x] `curl -X POST -H "Content-Type: application/json" -d '{"order":[1,2],"durations":{"1":1,"2":1},"gap":1}' http://<device>/api/chain/start` returns `{"ok":true}` (manual `curl` once flashed).
- [x] `curl http://<device>/api/chain/state` returns the chain JSON while the chain is active and `null` when not.

#### Manual Verification:
- [x] On the deployed device, kick off `POST /api/chain/start` with a 2-zone, 1-min duration, 1-min gap chain. Observe: zone 1 relay engages → 1 min later zone 1 stops AND engine cycles off → 1-min gap (no relays on) → zone 2 engages → finishes → all relays off.
- [x] During the gap, `GET /api/chain/state` shows `currentIndex` advanced.
- [x] `POST /api/chain/stop` mid-zone cancels cleanly (zone stops, engine off, no orphan ticker).
- [x] `POST /api/chain/stop` mid-gap cancels the pending advance (no zone starts after stop).
- [x] WebSocket clients receive `{"chain": ...}` messages on start, advance, and stop.
- [x] Existing scheduler-driven sequence still works (no regression in `scheduled()` path).
- [ ] **A7:** stop the *running* chain zone via `GET /api/zone/{current}/stop` (not `/api/chain/stop`) → chain tears down, engine off, and clients receive `{"chain": null}`. Repeat via Alexa/MQTT stop of that zone — same result.
- [ ] **B3:** `POST /api/schedule/disable` while a chain runs → chain stops with a `{"chain": null}` broadcast (not a silent firmware-only teardown).
- [ ] **B7:** let a 2-zone chain finish naturally → clients receive `{"chain": {"done":true}}` (distinct from the `null` a user-stop sends).
- [ ] **A8:** while a 3-zone chain runs zone 1, `POST /api/chain/update` with `{"order":[1,3],"durations":{"1":1,"3":1}}` → `GET /api/chain/state` shows the tail rewritten (zone 2 dropped) and `totalZones` reduced; an update whose `order[0]` ≠ the live zone is rejected (state unchanged).
- [ ] **B8:** arrange a scheduled sequence timer to fire during an adhoc chain (or invoke `scheduled()`) → the adhoc chain is untouched (`startSequenceSession()` early-returns while `adhoc`).
- [ ] **B4:** rapid `POST /api/chain/stop` immediately followed by `POST /api/chain/start` → the new chain starts and advances normally (the start is not degraded into a solo zone-1 run by the queued stop).

**Implementation Note**: Pause after Phase 2 for hardware confirmation before any UI work.

---

## Phase 3: Client model — `Chain` class and `App.chain()`

### Overview
Add an ephemeral chain model to the client. Lives on `App.chain()` as a singleton so `zone-list.js` and `zone.js` can both read/write it without prop drilling.

### Changes Required

#### 1. `html/js/models/chain.js` (new file)
**Changes**: New `Chain` class with the full ad-hoc chain state and behavior.

```js
import { Http } from "../system/http";   // C1: no App import — the model has no dependency on it (avoids a circular app.js↔chain.js import)

const DEFAULT_DURATION = 15;
const DEFAULT_GAP = 5;

export class Chain extends EventTarget {
  constructor() {
    super();
    this._order = [];          // [zoneId, ...]
    this._durations = {};      // { zoneId: minutes }
    this._gap = DEFAULT_GAP;
    this._active = false;
    this._inGap = false;       // C4: mid-gap (source off, between zones)
    this._currentIndex = 0;
  }

  // build state (client-side only until start())
  hasItems() { return this._order.length > 0; }
  isActive() { return this._active; }
  isQueued(id) { return this._order.includes(parseInt(id)); }
  position(id) { return this._order.indexOf(parseInt(id)); }
  order() { return [...this._order]; }
  currentIndex() { return this._currentIndex; }
  currentZone() {
    return this._active && this._currentIndex < this._order.length
      ? this._order[this._currentIndex]
      : null;
  }
  isCurrent(id) { return this.currentZone() === parseInt(id); }
  isQueuedNotStarted(id) {
    // A1 FIX: when idle there is no "queued-not-started" running semantics — an idle chain
    // starts on tap, so this must be false (the original `return true` here routed every idle
    // tap to remove() and made the chain impossible to start).
    if (!this._active) return false;
    if (!this.isQueued(id)) return false;
    return this.position(id) > this._currentIndex;
  }

  add(id, duration = DEFAULT_DURATION) {
    id = parseInt(id);
    if (this.isQueued(id)) return;
    this._order.push(id);
    this._durations[id] = duration;
    this._fire('change');
  }

  // A8: remove a not-yet-started zone from a RUNNING chain. The firmware is the source of truth,
  // so we splice locally AND push the rewritten tail — a purely local splice would be overwritten
  // by the next `chain` broadcast and the "removed" zone would still get watered.
  // (Build-time editing of an idle chain is via drag-replace / clear, not per-tile remove — an
  //  idle tap starts the chain, per A1.)
  removeQueued(id) {
    id = parseInt(id);
    if (!this._active) return;
    if (this.position(id) <= this._currentIndex) return;   // can't remove the running/completed zone
    const i = this._order.indexOf(id);
    if (i === -1) return;
    this._order.splice(i, 1);
    delete this._durations[id];
    this._fire('change');
    this._pushTail();
  }

  // POST the not-yet-started tail (starting with the currently-running zone) to the firmware.
  _pushTail() {
    if (!this._active) return;
    const tail = this._order.slice(this._currentIndex);    // [currentZone, ...remaining]
    const durations = {};
    for (const zid of tail) durations[zid] = this._durations[zid] ?? DEFAULT_DURATION;
    Http.json('POST', 'api/chain/update', { order: tail, durations }).catch((e) => console.error(e));
  }

  replace(orderArr) {
    if (this._active) {
      // B14: drag-replace over a RUNNING chain must stop it server-side, not just locally
      Http.json('POST', 'api/chain/stop').catch((e) => console.error(e));
      this._active = false;
      this._currentIndex = 0;
    }
    this._order = orderArr.map((id) => parseInt(id));
    const next = {};
    for (const id of this._order) {
      next[id] = this._durations[id] ?? DEFAULT_DURATION;
    }
    this._durations = next;
    this._fire('change');
  }

  setDuration(id, minutes) {
    id = parseInt(id);
    if (!this.isQueued(id)) return;
    let m = parseInt(minutes);
    if (!Number.isFinite(m) || m <= 0) m = DEFAULT_DURATION;   // C2: 0/NaN → default, never silently keep 0
    this._durations[id] = m;
    this._fire('change');
    // C6: running chain + not-yet-started slot → persist the edit to the firmware tail
    if (this._active && this.position(id) > this._currentIndex) this._pushTail();
  }

  getDuration(id) {
    id = parseInt(id);
    return this._durations[id] ?? DEFAULT_DURATION;
  }

  clear() {
    const wasActive = this._active;
    this._order = [];
    this._durations = {};
    this._active = false;
    this._currentIndex = 0;
    if (wasActive) {
      Http.json('POST', 'api/chain/stop').catch((e) => console.error(e));
    }
    this._fire('change');
  }

  async start() {
    if (this._order.length === 0) return false;
    const durations = {};
    for (const id of this._order) durations[id] = this._durations[id] ?? DEFAULT_DURATION;
    try {
      await Http.json('POST', 'api/chain/start', {
        order: this._order,
        durations,
        gap: this._gap,
      });
      this._active = true;
      this._currentIndex = 0;
      this._fire('change');
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  async stop() {
    if (!this._active) return;
    try {
      await Http.json('POST', 'api/chain/stop');
    } catch (e) { console.error(e); }
    this._active = false;
    this._fire('change');
  }

  // Sync from WS event payload (or GET /api/chain/state). Three shapes (B7):
  //   null           → user/external stop: revert to an IDLE built chain (keep order so the user
  //                     can re-tap to run again or clear via the X). Matches the cancel-path spec.
  //   {done:true}    → natural finish: CLEAR the chain, UI returns to baseline (happy-path step 7).
  //   {active,...}   → live sync of a running chain.
  applyServerState(payload) {
    if (!payload) {
      this._active = false;
      this._inGap = false;
      this._currentIndex = 0;
      this._fire('change');
      return;
    }
    if (payload.done) {
      this._order = [];
      this._durations = {};
      this._active = false;
      this._inGap = false;
      this._currentIndex = 0;
      this._fire('change');
      return;
    }
    this._order = (payload.order || []).map((id) => parseInt(id));
    const durs = {};
    this._order.forEach((id, i) => {
      durs[id] = (payload.durations || [])[i] ?? DEFAULT_DURATION;
    });
    this._durations = durs;
    this._gap = payload.gap ?? DEFAULT_GAP;
    this._inGap = payload.inGap === true;         // C4
    this._active = payload.active === true;
    this._currentIndex = payload.currentIndex ?? 0;
    this._fire('change');
  }

  isInGap() { return this._active && this._inGap; }   // C4: lets the overlay show a "between zones" state

  _fire(name) {
    this.dispatchEvent(new CustomEvent(name));
  }
}
```

#### 2. `html/js/system/app.js`
**Changes**:
- Add import: `import { Chain } from "../models/chain";`
- Add field `$chain = null;` and accessor:
  ```js
  chain() {
    if (!this.$chain) this.$chain = new Chain();
    return this.$chain;
  }
  ```
- In `load()` (around line 102-125), after Wsc connect (which is implicit — Wsc is wired in `wsc.js`), subscribe to chain events. But because Wsc is module-level, the chain subscription is better wired in the root index component (Phase 5). Skip here.

#### 3. `html/js/system/http.mock.js` (B13 — required for the dev-mock testing this plan relies on)
**Changes**: The dev mock currently returns `{}` for unknown paths and its `postJson` **drops the body**, so the Phase-3 mock verification below cannot actually observe the POST payload or get a truthy/`null` chain state. Add minimal chain routes so the model is testable before flashing:
- A tiny in-memory `mockChain` object (`{ order, durations, gap, active, currentIndex, inGap }`, initially inactive).
- `POST api/chain/start` → capture the posted `order`/`durations`/`gap`, set `active=true, currentIndex=0`, return `{ ok: true }`. (Have `postJson` pass the body through to the handler rather than dropping it.)
- `POST api/chain/update` → apply the tail; return `{ ok: true }`.
- `POST api/chain/stop` → set `active=false`; return `{ ok: true }`.
- `GET api/chain/state` → return the chain JSON when active, else `null` (literal `null`, not `{}`).
- Optionally emit a mock `chain` Wsc event so the repaint path is exercisable in the browser without hardware.

### Success Criteria

#### Automated Verification:
- [x] Web assets build: `deno task build`
- [x] Firmware compiles (no firmware changes in this phase but verify nothing broke): `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`
- [x] `App.chain()` is accessible from the browser console after page load: `window.app.chain()` returns a `Chain` instance.

#### Manual Verification (using the dev mock from change #3):
- [ ] `App.chain().add(1); App.chain().add(2); App.chain().order()` → `[1, 2]`.
- [ ] **A1 regression guard:** with an idle built chain, `App.chain().isQueuedNotStarted(1)` returns **`false`** (not `true`) — this is the bug the fix targets; the idle tap must reach `start()`, not `remove`.
- [ ] `await App.chain().start()` issues `POST api/chain/start` and the mock captures `order:[1,2]`, `durations:{1:15,2:15}`, `gap:5` (verifiable now that the mock passes the body through).
- [ ] `applyServerState({active:true,currentIndex:0,order:[1,2],durations:[15,15]})` → `isActive()===true`, `currentZone()===1`, `position(2)===1`.
- [ ] `applyServerState(null)` keeps `order()` intact but `isActive()===false` (idle built chain); `applyServerState({done:true})` empties `order()` (finish clears — B7).
- [ ] No regressions to existing single-zone start/stop or schedule page.

**Implementation Note**: Pause after Phase 3 to verify the model works in isolation before wiring UI.

---

## Phase 4: Client UI — drag-to-chain on the landing page

### Overview
Add the drag-to-connect overlay to `zone-list.js`, intercept gestures appropriately, and render SVG connectors + order badges on top of the existing `sketch-checkbox` grid. Tap behavior branches based on `App.chain()` state.

### Changes Required

#### 1. `html/js/screens/zone-list.js`
**Changes**: Substantial rewrite. Outline:

- Update template at `:6-59` to:
  - Wrap `.container` in `.chain-wrapper` with a relative position.
  - Add `<svg class="chain-lines">` overlay covering the wrapper.
  - Add `.chain-badge` inside each `sketch-checkbox` slot via host-side absolute positioning (since the badge is outside shadow DOM, it overlays onto the host element via CSS).

  ```html
  <div class="chain-wrapper">
    <svg class="chain-lines"></svg>
    <div class="container">
      ${ /* existing content with extra wrapper div per checkbox so we can position badges */ }
    </div>
  </div>
  ```
  Wrap each defined zone:
  ```html
  <div class="zone-slot" data-zone-id="${x.id}">
    <sketch-checkbox zone-id="${x.id}" ...></sketch-checkbox>
    <span class="chain-badge"></span>
  </div>
  ```
  Add styles for the badge and SVG layer (cribbed from `pattern-connector.js:70-99`).

  - **⚠️ A4 — MUST re-point the existing state selectors.** The current code addresses tiles positionally: `.container sketch-checkbox:nth-child(${zone})` in `update()` (`zone-list.js:105`) and `tickProgress()` (`:190`). Once each `sketch-checkbox` is wrapped in its own `.zone-slot`, **every** checkbox becomes `:nth-child(1)` of its slot — so zone 1's WebSocket updates land on all tiles and zones 2-6 never update. Change both selectors to attribute-keyed lookups that survive the wrapper, e.g. `this.querySelector('sketch-checkbox[zone-id="' + zone + '"]')` (or `.zone-slot[data-zone-id="${zone}"] sketch-checkbox`). Grep for every `:nth-child(` in `zone-list.js` and convert each. This is not optional cosmetic work — the grid is non-functional without it.

- In `connectedCallback()`:
  - Get refs to `.chain-wrapper`, `.chain-lines`, `.zone-slot[data-zone-id]`.
  - Bind drag listeners on the wrapper (mousemove/mouseup/mouseleave/touchmove/touchend/touchcancel) — copied from `pattern-connector.js:140-147`.
  - Bind mousedown/touchstart on each `.zone-slot` — *not* on the inner `sketch-checkbox` (so the existing click events still fire when no drag occurs).
  - Subscribe to `App.chain()` `change` event → `this.renderChainOverlay()`.
  - Subscribe to `Wsc.on('chain', this.onChainState, this)` (sync from server) → `App.chain().applyServerState(payload)`.

- Drag handlers (cribbed from `pattern-connector.js`, adapted):
  - `onPointerDown(zoneId, e)`: record start point; set `this.dragCandidate = { zoneId, x, y }`; do **not** call `e.preventDefault()` yet — we want clicks to pass through if no drag happens.
  - `onPointerMove(e)`: if `this.dragCandidate && !this.isDragging`, check distance; if > 8 px, set `this.isDragging = true` and start the trailing line. From here the logic mirrors `pattern-connector.onDragMove`.
  - `onPointerUp(e)`: if `this.isDragging`, `e.preventDefault()`, finalize drag, call `App.chain().replace(this.selectedOrder)`, **and set `this._suppressClicksUntil = performance.now() + 500` (A3)** so the phantom `check`/`pick` that the desktop click-synthesizer fires on the drop/origin tile is ignored by `onZoneCheck`/`onZoneClick`. If not dragging (just a click), leave `_suppressClicksUntil` unset so the click passes through, and clear `dragCandidate`.
    - **A3 detail:** touch drags are already guarded (`jquery.js` suppresses the synthetic click after a `touchmove`), but mouse drags are not — releasing a drag over tile B fires B's `mouseup`→`check`, and releasing back on the origin tile fires `pick`. The wrapper-level `e.preventDefault()` cannot stop these because the `sketch-checkbox`'s own listener runs first (shadow-DOM target phase) and dispatches on a `setTimeout`. The time-boxed `_suppressClicksUntil` flag is the reliable guard. (A capture-phase `mouseup` with `stopPropagation` while `isDragging` is an alternative; the flag is simpler and covers both the drop and origin tiles.)

- Tap handlers (modify existing `:120-147`):
  ```js
  onZoneCheck(e) {
    const checkbox = e.srcElement;
    const zoneid = parseInt(checkbox.getAttribute('zone-id'));
    if (checkbox.pending) return;

    // A3: swallow the phantom click the desktop drag synthesizer fires on the drop/origin tile
    // right after a drag commits (touch is already drag-guarded in jquery.js; mouse is not).
    if (this._suppressClicksUntil && performance.now() < this._suppressClicksUntil) {
      e.preventDefault();
      return;
    }

    const chain = App.chain();

    if (chain.hasItems()) {
      e.preventDefault();
      if (!chain.isActive()) {
        // A1: idle built chain — a tap on ANY chained tile starts the WHOLE chain.
        chain.start();
      } else if (chain.isCurrent(zoneid)) {
        // running tile → stop the chain
        chain.stop();
      } else if (chain.isQueuedNotStarted(zoneid)) {
        // queued, not yet started → remove it from the remaining queue (server-side — A8)
        chain.removeQueued(zoneid);
      } else if (!chain.isQueued(zoneid)) {
        // unchained tile during a run → append is out of scope; guide the user
        Status.information("Stop chain to add zones");   // B5: .information (Status.notify does not exist)
      }
      // completed tile during a run → no-op
      return;
    }

    // No chain — original solo behavior (unchanged)
    e.preventDefault();
    const checked = !checkbox.checked;
    const command = checked ? (checkbox.style.color ? 'resume' : 'start') : 'stop';
    checkbox.pending = true;
    Http.json('GET', `api/zone/${zoneid}/${command}`).catch(err => {
      console.error(err); checkbox.pending = false;
    });
  }

  onZoneClick(e) {
    // long-press → duration ring. (Double-tap is NOT a separate gesture — checkbox.js collapses
    // double-click and long-press into one metadata-less `pick`, so double-tap-clear was dropped — A2.)
    if (this._suppressClicksUntil && performance.now() < this._suppressClicksUntil) return;  // A3
    const checkbox = e.srcElement;
    const zoneid = checkbox.getAttribute('zone-id');
    const params = { 'zone-id': zoneid };
    if (App.chain().isQueued(zoneid)) params['chain'] = 'true';
    Router.navigate('zone', { popup: true, params });
  }
  ```

  **Tap-state machine (A1) — branch order is load-bearing:** idle built chain → *any* tap starts; running → current stops, queued-not-started removes server-side, unchained shows the "stop to add" hint, completed is a no-op. The original code's `isQueuedNotStarted()` returned `true` for every idle tile, so every idle tap fell into `remove()` and the chain could never be started — that path is now gated by the model fix (Phase 3). The two superseded append-during-run variants (restart-from-zero, and `chain.stop().then(() => chain.start())`) are **removed**: the restart surprised the user, and the stop-then-start pair hit the B4 command-queue race. Append-during-run stays out of scope (What We're NOT Doing).

- `renderChainOverlay()`:
  - Update each `.zone-slot[data-zone-id="N"]`'s badge text and visibility based on `chain.position(N)` and `chain.currentIndex()`.
  - Add classes: `.queued` (position > currentIndex), `.running` (`chain.isCurrent(N)` and not in gap), `.completed` (`chain.isActive() && position(N) < currentIndex()`), and `.gap` on the current tile when `chain.isInGap()` (C4 — shows "waiting, source off" between zones so a refresh mid-gap renders truthfully).
  - Redraw SVG connector path (same Bezier logic as `pattern-connector.js:358-399`).
  - Hide overlay entirely when `chain.hasItems() === false`.

- **⚠️ A5 / B10 — do NOT put cleanup in `deactivate()`; it never runs.** `activate()`/`deactivate()` are called only by `slider.js` on `sketch-slider` slides. `ZoneList` mounts directly in `sprinkler-main` with no slider, so its existing `activate/deactivate` (`:149-158`) are vestigial. The outlet's `navigate()`/`back()` fire `navigate-to`/`navigate-from` events and hide/remove elements — they never call `activate/deactivate`. Put listener cleanup in **`disconnectedCallback`**, which *does* run (it already offs `"state"` at `zone-list.js:78-82`, and `Main.onBack` re-renders `<sprinkler-list>` on every `back`). Extend it:
  ```js
  disconnectedCallback() {
    Wsc.off("state", this.onUpdate);        // existing
    Wsc.off("chain", this.onChainState);    // B10: remove the chain WS listener
    App.chain().removeEventListener('change', this._onChainChange);   // B10: remove model listener
  }
  ```
  Store the bound handlers on `this` in `connectedCallback` (`this.onChainState = (p) => App.chain().applyServerState(p); this._onChainChange = () => this.renderChainOverlay();`) so the exact same references can be removed here — otherwise `Wsc.off`/`removeEventListener` silently no-op and handlers leak on every re-render.
  - **Idle-chain clear on navigate-away (A5):** do NOT clear in `disconnectedCallback` — `Main.onBack` re-renders ZoneList *while staying on main*, which would wipe an idle chain the user is still building. Instead clear it in the root `Index` component's `onNavigateFrom` when the outlet actually leaves `main` (see Phase 5): `if (e.detail.from === "main" && chain.hasItems() && !chain.isActive()) chain.clear();`. `Index` is the right owner because it already owns the chain↔menu-toggle wiring and survives outlet navigation.

#### 2. `html/js/screens/index.js` — no change in Phase 4
**Note (C5):** `html/js/screens/index.js` is the **root `Index` web component**, not an auto-generated barrel. Its chain-related wiring (menu-toggle X, navigate-away clear) is done in Phase 5, not here. The `Chain` model is its own file (`html/js/models/chain.js`, Phase 3) and is imported by `app.js`, so nothing needs exporting from `index.js`.

### Success Criteria

#### Automated Verification:
- [x] Web assets build: `deno task build`
- [x] Firmware compiles: `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`
- [x] Generated headers updated in `arduino/html/index.html.gz.h`.

#### Manual Verification:
- [ ] On device, drag from zone 1 to zone 2 on landing → SVG connector appears with order badges 1/2. **On desktop (mouse):** immediately after the drop, no tile is accidentally removed and the zone popup does not open (A3 suppression works).
- [ ] **A4:** with a chain drawn, trigger a WebSocket state update for zone 3 → only zone 3's tile updates (not all tiles) — confirms the `nth-child`→`[zone-id]` selector fix.
- [ ] **A1:** tap *any* chained tile on the idle chain → chain runs zone 1, gap, zone 2, all visible via WebSocket-driven UI updates (running tile highlighted, gap shown, queued tile shown as queued).
- [ ] Tap the running tile → chain stops, both relays off; badges/lines remain (reverts to idle built chain, per B7 `null` handling).
- [ ] Tap a queued not-yet-started tile during a run → removed from the chain; **refresh the browser → it stays removed** (server-side via `/api/chain/update`, A8) and that zone is not watered.
- [ ] Tap an unchained tile during a run → "Stop chain to add zones" hint shows; nothing else happens (B5 `Status.information`).
- [ ] Drag from a tile while a chain is *running* → chain stops server-side then rebuilds with the new drag (B14); relays off during the swap.
- [ ] Tap an unchained tile while no chain exists → starts that zone solo (regression check).
- [ ] (Dropped gesture A2) confirm there is no double-tap-clear; clearing is via the X / drag-replace only.

**Implementation Note**: Pause after Phase 4 for hardware confirmation.

---

## Phase 5: Client UI — `zone.js` chain-mode + menu-toggle X reuse

### Overview
Wire the long-press duration ring to update the chain slot duration (instead of starting a solo run) when invoked from a chained tile. Wire the hamburger↔X morph to clear the chain on tap when the chain has items.

### Changes Required

#### 1. `html/js/screens/zone.js`
**Changes**:
- **B6 — add the `Router` import.** `zone.js:1-3` imports only `String`/`Http`/`Wsc`/`jQuery`/`App`; the chain-mode branch below calls `Router.goback()`, which would throw `ReferenceError` without it. Add `import { Router } from "../system/router";` (match the path used by `zone-list.js`). Verify the close method name against `router.js` (`goback()` vs `back()`) and use whichever exists.
- After `connectedCallback` reads the `zone-id` attribute (`:225`), also read `chain` attribute:
  ```js
  this.chainMode = this.hasAttribute('chain');
  ```
- Pre-fill the duration dropdown from chain state when in chain mode (in the `update` flow at `:539-583`):
  ```js
  if (this.chainMode) {
    const dur = App.chain().getDuration(this.zone.id);
    this.formatTime(dur * 60);
    this.PnlTimer.removeClass('disabled').removeClass('started').removeClass('stopped');
    return;  // skip Wsc-driven state binding entirely in chain mode
  }
  ```
- In `onMinutesChange` (`:319-333`), branch on chain mode:
  ```js
  async onMinutesChange(e) {
    if (this.updatingDropdown) return;
    const minutes = parseInt(e.srcElement.value);
    if (this.chainMode) {
      App.chain().setDuration(this.zone.id, minutes);   // persists to server if slot is a running tail (C6)
      Router.goback();   // close popup so user sees the chain refresh
      return;
    }
    // existing solo logic...
  }
  ```
- In `connectedCallback`, skip the Wsc subscription and `update()` call when `chainMode` is true; replace with the dropdown pre-fill above.
- **⚠️ A7 — disable the ring's start/stop taps in chain mode.** The duration ring `PnlTimer` has its own click wiring: single-tap → `execute("start"/"resume")`, double-tap → `onDoubleClick` → `clearTimer()` → `execute("stop")` (`zone.js:267-269, 309-317, 344-349`). Rerouting only `onMinutesChange` (above) is **not enough** — if the user long-presses the *running* chain tile and then taps/double-taps the ring, `execute("stop")` fires a solo `GET /api/zone/{current}/stop`, which strands the chain (firmware `stop(zone)` now tears the chain down on that external stop per A7, but the *intent* here is a duration edit, not a chain cancel — the user loses their run unexpectedly). In `chainMode`, gate `execute()` / the `PnlTimer` tap handlers so they no-op (the ring is duration-edit-only). Concretely: early-return from the tap/`onDoubleClick` handlers when `this.chainMode`, or don't bind `PnlTimer.onClick` at all in chain mode.

#### 2. `html/js/screens/index.js` (the root `Index` web component — NOT a barrel; corrects the Phase 4 #2 mislabel, C5)
**Changes**:
- `App` is already imported (`:3`).
- **⚠️ B11 — bind the chain listener ONCE in `connectedCallback`, not in `render()`.** `render()` re-runs on every `refresh` event (`index.js:38-40`, fired by `Main.onSlide` down), so binding there stacks a new duplicate listener each time. Bind once (guarded) and remove in `disconnectedCallback`:
  ```js
  connectedCallback() {
    // ...existing...
    if (!this._onChainChange) {
      this._onChainChange = () => this._syncToggleToChain();
      App.chain().addEventListener('change', this._onChainChange);
    }
  }
  disconnectedCallback() {
    // ...existing...
    if (this._onChainChange) {
      App.chain().removeEventListener('change', this._onChainChange);
      this._onChainChange = null;
    }
  }
  _syncToggleToChain() {
    const onMain = this.$Outlet.item()?.lastElement?.tagName === 'SPRINKLER-MAIN';
    if (!onMain) return;                        // only morph the icon on the landing page
    App.chain().hasItems() ? this.$Toggle.item().open() : this.$Toggle.item().close();
  }
  ```
- **onToggle overload (B12 — accepted tradeoff).** On main with a chain present the X clears the chain; otherwise it toggles the menu. Verified there is no dead-X state and "menu open" vs "chain present" never collide (off-main → X = close-menu; back on main with a chain → X = clear-chain). Documented tradeoff: a user tapping X expecting "menu" clears the chain instead — swipe-up still opens the menu.
  ```js
  onToggle(e) {
    const onMain = this.$Outlet.item()?.lastElement?.tagName === 'SPRINKLER-MAIN';
    if (onMain && App.chain().hasItems()) {
      App.chain().clear();
      return;
    }
    this.$Toggle.item().opened ? this.close() : this.open();
  }
  ```
- **A5 — clear an idle chain when the outlet leaves main.** This is the real home for the "navigate-away clears the chain" behavior the dead `deactivate()` couldn't provide. Fold into the existing navigation handlers (verify the exact event names / `e.detail` shape — `navigate-to`/`navigate-from` with `{from,to}` — against the current `index.js:78-88` wiring; do not add duplicate listeners):
  ```js
  onNavigateFrom(e) {
    const chain = App.chain();
    if (e.detail.from === "main" && chain.hasItems() && !chain.isActive()) {
      chain.clear();                            // A5: idle (built, not running) chain wiped on leaving main
    }
  }
  onNavigateTo(e) {
    if (e.detail.to === "main") this._syncToggleToChain();   // restore X if a running chain persists
  }
  ```
  Note: a *running* chain is intentionally NOT cleared on navigate-away — it keeps running and its X is restored when the user returns to main.

### Success Criteria

#### Automated Verification:
- [x] Web assets build: `deno task build`
- [x] Firmware compiles: `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`

#### Manual Verification:
- [ ] Long-press on a chained tile opens the duration ring; changing minutes updates the chain slot duration (verify by re-opening the ring) and does **not** start the zone.
- [ ] **A7:** long-press the *running* chain tile → the ring's tap/double-tap does **not** stop the zone (ring is duration-edit-only in chain mode); the chain keeps running.
- [ ] Long-press on a non-chained tile (no chain present) still starts the zone solo when the dropdown changes (regression).
- [ ] Hamburger morphs to X when first chained tile is added; tapping X clears the chain and morphs back to hamburger.
- [ ] **B11:** slide the menu down a few times (fires `refresh`/re-render), then add a chain zone → the X still toggles correctly and `clear()` fires exactly once (no duplicate-listener double-clear).
- [ ] Opening menu (swipe up) while chain is built keeps the X visible ("close menu"); coming back to main with chain still present shows X again.
- [ ] **A5:** navigate to the schedule page and back → an *idle* chain is wiped (via `Index.onNavigateFrom`, not the dead `deactivate()`); a *running* chain survives and its X is restored.

**Implementation Note**: Pause after Phase 5 for hardware confirmation.

---

## Phase 6: Polish — page-load resync, validation, edge cases

### Overview
Tie up loose ends: resync UI after page reload during a running chain, validate user input, handle edge cases that surfaced during Phase 4/5 testing.

### Changes Required

#### 1. `html/js/screens/zone-list.js`
**Changes**:
- In `connectedCallback`, after subscribing to Wsc events, kick off a resync fetch so a page reload mid-chain re-paints from the firmware source of truth:
  ```js
  Http.json('GET', 'api/chain/state').then((payload) => {
    App.chain().applyServerState(payload);   // handles null / {done} / live object (B7)
  }).catch(() => {});
  ```
- Status messages use **`Status.information`** (B5 — `Status.notify` does not exist):
  - "Stop chain to add zones" (already wired in Phase 4).
  - Optional "Chain finished" flourish — trigger it when a `chain` payload arrives with `done:true` (now distinguishable from a user-stop `null`, per B7), *before* `applyServerState` clears the order.

#### 2. `html/js/system/wsc.js`
**Changes**: None. The existing `Wsc.on('chain', ...)` mechanism handles arbitrary keys.

#### 3. `arduino/sprinkler.cpp`
**Changes**:
- In `chainAdvance(zone)`, the natural-finish branch already does `s.adhoc=false; s.reset();` and sends `{"done":true}` (Phase 2). Add a defensive `Timers.chainGapTimer.detach()` on that branch too, and confirm `SequenceSession::reset()` zero-fills `order`/`durations`/`inGap` (Phase 1).
- **Duplicate-zone rejection.** `requestChainStart` now only *stages* the payload (validation must not live there). Enforce uniqueness in the HTTP handlers (`sprinkler-http.h`, `/api/chain/start` and `/api/chain/update`): keep a small seen-set (or bitmask) while looping `orderArr`, and `request->send(400, ..., "{\"error\":\"duplicate zone\"}")` on a repeat. The client should never send duplicates, but the firmware enforces it so a bad request can't water a zone twice or corrupt the index math.

#### 4. `arduino/sprinkler-http.h`
**Changes**: Adjust JSON body size cap if Phase 4 testing shows the 512 byte limit is tight (likely fine — 6 zones with id+duration ≪ 512 bytes).

### Success Criteria

#### Automated Verification:
- [x] Web assets build: `deno task build`
- [x] Firmware compiles: `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`
- [x] No new compiler warnings.

#### Manual Verification:
- [ ] Start a chain, refresh the browser mid-run → UI re-paints connectors, badges, and current-running highlight from `GET /api/chain/state`.
- [ ] Stop chain mid-gap → no zone starts after; `GET /api/chain/state` returns `null` immediately.
- [ ] Build a chain on landing, navigate to schedule page, back to landing → idle chain is cleared.
- [ ] Send `POST /api/chain/start` with malformed body → 400 with sensible error JSON; firmware doesn't crash.
- [ ] Confirm sketch size still under 90% of flash (currently ~79%).

**Implementation Note**: After Phase 6, run a final regression pass: scheduled sequence, manual zone start/stop/pause/resume, Alexa, MQTT.

---

## Testing Strategy

### Unit-equivalent verification (no harness):
- Use the dev mock (`html/js/system/http.mock.js`, extended with chain routes per Phase 3 change #3 — B13) to test the `Chain` model in isolation:
  - `add` / `removeQueued` / `replace` / `clear` mutate state correctly.
  - `start()` issues the POST with the expected body shape (now observable because the mock passes the body through).
  - `removeQueued`/`setDuration` on a running chain issue `POST api/chain/update` with the `[currentZone, ...tail]` order.
  - `applyServerState(payload)` reflects in `isActive()` / `currentZone()` / `position()`, and distinguishes `null` (idle) from `{done:true}` (cleared).

### Integration tests (manual on hardware):

**Happy path:**
1. Drag zone 1 → 2 → 3. Order badges 1/2/3 visible. Lines connect.
2. Long-press zone 2's tile, change duration to 20. Re-open: shows 20.
3. Tap zone 1's tile → chain starts. Zone 1 relay on, engine on.
4. After 15 min, zone 1 stops, engine stops, both relays off (gap).
5. After 5 min gap, zone 2 starts (engine + zone 2 relay). Runs 20 min.
6. After zone 2, gap. Then zone 3 (15 min default).
7. Chain completes. UI: connectors and badges cleared, hamburger restored.

**Cancel / teardown paths:**
- Tap running tile: stops zone immediately, engine off. Lines/badges **remain** (reverts to an idle built chain — `null` handling, B7); the X stays visible because the chain still has items. Only `clear()` / drag-replace removes them.
- Tap X on main with a chain: chain cleared (`clear()` POSTs `/api/chain/stop` if it was running).
- Drag from any tile during a run: chain stops server-side then rebuilds from the new drag (B14). Re-verify dwell timing.
- **External stop (A7):** stop the running chain zone via Alexa / MQTT / a second browser / raw `/api/zone/{current}/stop` → chain tears down cleanly, engine off, all clients get `{"chain": null}` (no stranded "running chain" UI).
- **Natural finish vs stop (B7):** a completed chain returns the UI to baseline (badges/lines gone, hamburger restored) via `{"done":true}`; a user-stop leaves the idle built chain intact. These must look different.
- (Removed gesture, A2) there is **no** double-tap-to-clear — do not test for it.

**Edge cases:**
- 6-zone full chain runs all 6. Badge "6" visible.
- Drag start on disabled (zone-placeholder): no drag — placeholder has no event handler.
- **Desktop drag phantom-click (A3):** after a mouse drag commits, neither the drop tile nor the origin tile fires a stray remove/start or opens the zone popup (the `_suppressClicksUntil` guard holds for ~500 ms).
- **Selector regression (A4):** with a chain drawn, a zone-N state update touches only zone N's tile.
- **Pause (not stop) while chain running:** pausing the current zone via the solo `/api/zone/{id}/pause` puts it in paused state, but the chain's duration Ticker keeps counting — resume continues, natural expiry still advances the chain. Documented known limitation: pause/resume are solo-zone features and do not extend chain semantics. (Note this is distinct from *stop*, which now tears the chain down per A7.)
- Browser refresh mid-zone: chain state and current zone re-paint from `GET /api/chain/state`.
- Browser refresh mid-gap: `GET /api/chain/state` returns the advanced index with `inGap:true` (C4); the UI shows the "between zones, source off" state. The gap `Ticker` lives in firmware and survives the browser refresh, so the next zone still starts on schedule.
- **Stop→start race (B4):** rapidly stop then start a chain → the new chain runs and advances (not degraded to a solo zone-1 run).
- **Scheduled-sequence coexistence (B8):** a scheduled sequence firing during an adhoc chain does not clobber it, and starting an adhoc chain while a scheduled sequence runs is refused (no shared-`SequenceSession` corruption).

## Performance Considerations

- The chain-advance Ticker uses one `Ticker` instance on `SprinklerState` — no per-zone allocation.
- WebSocket `chain` events fire only at chain start/advance/next/stop/update/finish — a handful per chain. Bandwidth-irrelevant.
- `chainStateJSONLocked()` is synchronous under the mutex; ~100 byte string allocation. The HTTP `chainStateJSON()` wrapper takes the mutex briefly (B9) — same pattern/cost as `safeStateJSON`. Acceptable.
- SVG redraw on every chain change is small (max 6 connectors + 6 badges). Sub-millisecond.

## Migration Notes

- No EEPROM migration needed (no config-struct changes).
- Existing scheduler-driven sequence path is unchanged; the only behavioral difference is the new branch in the Ticker callback when `Sequence.adhoc` is true.
- No client storage migration (chain is ephemeral).

## References

- Drag-to-connect reference: `html/js/controls/pattern-connector.js`
- Tap/long-press reference: `html/js/controls/checkbox.js:209-221`
- Hamburger↔X morph: `html/js/controls/menu-toggle.js`
- Command queue introduction: commit `fda62c9` (Fix concurrency issues with FreeRTOS command queue)
- Recent relay-driving fix: commit `1188aa3` (Fix zones reporting watering without driving relays)
- Schedule page sequence model: `html/js/models/sequence.js`, `html/js/screens/sequence-builder.js`
- Schedule alarm-vs-Ticker dispatch: `arduino/sprinkler-time.cpp`, `arduino/sprinkler-schedule.cpp`
