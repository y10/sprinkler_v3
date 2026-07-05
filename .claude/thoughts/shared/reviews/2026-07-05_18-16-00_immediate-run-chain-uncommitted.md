---
date: 2026-07-05T18:16:07-0400
reviewer: y10
repository: sprinkler_v3
branch: master
commit: afd0942520d26b08b869f33b6ca6a29e272854ff
scope: uncommitted (working tree vs HEAD)
status: needs_changes
verification: 10 verified · 0 weakened · 1 falsified (dropped)
severity: 1 critical · 5 important · 4 suggestions
lenses: quality · security (dependencies n/a — no manifest change)
advisor: inline
---

# Code Review — Immediate-Run Chain (uncommitted)

Review of the ad-hoc "chain" feature (11 hand-written source files: 5 ESP32 firmware, 6 web-UI; generated `arduino/html/*` byte-array headers excluded). Two lenses (Quality, Security) + interaction sweep + verification. Dependencies/CVE skipped (no manifest change).

## Recommendation

**Needs changes — one critical memory-safety defect (`S1`) must be fixed before flashing.** The `chainUpdate()` tail-rewrite writes an unclamped `totalZones`, producing out-of-bounds reads that are (a) serialized into the WebSocket/`/api/chain/state` broadcast and (b) fed as a zone id to relay control — reachable from the unauthenticated `POST /api/chain/update`. The fix is one line (clamp `totalZones` to `min(base + p.count, 6)`), but every downstream guard re-derives safety from `totalZones` rather than `sizeof(order)`, so the single unclamped assignment defeats all four.

The remaining 🟡 findings are concurrency/lifecycle edges inherited from the plan's own risk register (the `SequenceSession`/`Timers` shared-state blast center that three prior commits already had to fix — see Precedents). None block a *first* hardware test, but I2/I3/Q1/Q2 should be closed before this ships.

## 🔴 Critical

### S1 — Unclamped `totalZones` in `chainUpdate()` → 4-site buffer over-read [cascade: buffer-overflow]
`arduino/sprinkler.cpp:223` — `s.totalZones = base + p.count;`

The write loop is clamped to the fixed arrays but the size assignment on the next line is not:
```cpp
for (uint8_t i = 0; i < p.count && (base + i) < 6; i++) {   // :219 — clamped
  s.order[base + i] = p.order[i];
  s.durations[base + i] = p.durations[i];
}
s.totalZones = base + p.count;                              // :223 — NOT clamped
```
`base = currentZoneIndex` (0–5) and `p.count` is validated only `<= SKETCH_MAX_ZONES` (6), so `totalZones` can reach 11 against `uint8_t order[6]` / `durations[6]` (`sprinkler-state.h:58`). Every downstream `i < totalZones` read then runs past the arrays:
- `sprinkler-state.h:89` — `json += String(order[i]);` serializes `order[6..10]` (adjacent struct bytes: `gapMinutes`, padding) into the `/ws` + `GET /api/chain/state` payload — a **memory-disclosure** to any LAN client. Fires immediately via `sprinkler.cpp:224 fireEvent("chain", chainStateJSONLocked())`.
- `sprinkler.cpp:262` — `enqueue(CMD_START, s.order[s.currentZoneIndex], …)` hands a garbage zone id to `start()` → `Device.turnOn(zone)` once `currentZoneIndex` advances past 5.
- `sprinkler.cpp:231` and `sprinkler-state.h:121` (lock-free Ticker) — both read `order[currentZoneIndex]` OOB.

**Verified reproducer:** (1) `POST /api/chain/start {order:[1,2], durations:{1:1,2:1}, gap:1}`; (2) zone-1 Ticker expires → `chainAdvance` sets `currentZoneIndex=1` (head=zone 2); (3) `POST /api/chain/update {order:[2,3,4,5,6,1], …}` — head-check `p.order[0] != s.order[1]` passes (`2==order[1]`), no-dup passes, `base=1 + p.count=6 → totalZones=7`; (4) `fireEvent("chain", …)` serializes `order[6]` OOB into the broadcast. The only length gate (`sprinkler-http.h:177 if (orderArr.size() > SKETCH_MAX_ZONES)`) bounds `count` alone, never `base + count`.

Note: the legitimate client never triggers this (`chain.js._pushTail` sends `_order.slice(_currentIndex)`, so `base + count == totalZones ≤ 6`) — it is a malformed-request path, but on an unauthenticated endpoint.

**Fix:** clamp at the source — `s.totalZones = (base + p.count > 6) ? 6 : base + p.count;` (equivalently only write, and count, the entries the loop actually stored). Optionally also reject `base + orderArr.size() > SKETCH_MAX_ZONES` in the `/api/chain/update` handler.

## 🟡 Important

### I2 — Stale `CMD_CHAIN_ADVANCE` corrupts a freshly-started chain (no epoch token)
`arduino/sprinkler-state.h:122` — `ZoneCommand cmd = { CMD_CHAIN_ADVANCE, (uint8_t)x->Zone, 0 };` + `arduino/sprinkler.cpp:231` — `if (s.currentZoneIndex >= s.totalZones || s.order[s.currentZoneIndex] != zone) {`

The queued advance carries only the expired zone id; `chainAdvance`'s only staleness guard is bare zone-id equality against the *current* session. **Verified interleaving** (defeats the FIFO-ordering-is-safe hypothesis): old chain runs zone X; a direct `POST /api/chain/start` (new `order[0]=X`) enqueues `CMD_CHAIN_START`; before the command task drains, X's Ticker fires against the still-active old chain and enqueues `CMD_CHAIN_ADVANCE(X)`; the task runs `chainStart` (deletes X's timer — but the ADVANCE is already queued) and builds the new session; then `chainAdvance(X)` sees the new chain with `order[0]==X`, passes the guard, and `currentZoneIndex++` — advancing the new chain past its first zone before it starts. **Prevented by** a per-session generation/epoch in the queue message compared inside `chainAdvance`; no epoch exists today.

### I3 — Single `pendingChain` staging slot is not held across stage→consume
`arduino/sprinkler.cpp:158` (`requestChainStart`) + `arduino/sprinkler.cpp:178` (`requestChainUpdate`)

Both `memcpy` into the one shared `Timers.pendingChain` slot (`sprinkler-state.h:197`) and **release `sprinklerStateMutex` before `enqueue`** (`:165`/`:184`); the queue message is payload-free. Two HTTP requests in quick succession each overwrite the slot before the command task dequeues, so both dequeued commands read the **second** writer's payload. The mutex guarantees each `memcpy` is atomic, never that a write pairs with its own dequeue. The plan documented this as "harmless last-writer-wins," but the verified failure is broader: a `start` staged then an `update` staged before `start` drains makes `chainStart` consume the update payload. **Prevented by** a payload-carrying queue message or holding the mutex across stage+enqueue+consume.

### I4 — Silent tail-rewrite drop + client-mirror lag → removed zone keeps running
`html/js/models/chain.js:112` + `arduino/sprinkler.cpp:216` + `arduino/sprinkler-http.h:205`

`_pushTail` slices the tail from the client's `_currentIndex`; between a firmware advance and the arrival of its `chain` broadcast, the mirror lags one step, so `tail[0]` mismatches the live firmware zone and `chainUpdate` silently drops the write (`sprinkler.cpp:216 if (p.order[0] != s.order[s.currentZoneIndex]) return;`). But the handler already returned `ok(request)` (`sprinkler-http.h:205`) and the client optimistically kept its local splice (`chain.js:103`), so a "removed" zone still waters until the next broadcast reconciles. **Prevented by** gating the optimistic splice on an accept/nack, or returning 409 on head-mismatch instead of dropping post-200.

### Q1 — `disconnectedCallback` leaks the dwell timer and per-slot listeners [precedent-weighted]
`html/js/screens/zone-list.js:333` (`this.hoverTimer = setTimeout(…)`) + `:154-155` (per-slot `mousedown`/`touchstart`)

`disconnectedCallback` (`:184-200`) removes only the wrapper listeners; it omits `clearTimeout(this.hoverTimer)` and the per-slot listener removal. A pending dwell fires **post-detach** into `drawConnectors`/`updateTrailingLine` on the torn-down shadow SVG, and the timer closure roots the `slots → slot → listener → this` graph for up to `dwellTime`. This is the exact class the sibling scheduler feature fixed same-day (`2cc61c0`: unremoved bound handlers + stale SVG ref) — hence precedent-weighted from 🔵. **Fix:** in `disconnectedCallback`, `clearTimeout(this.hoverTimer)` and store/remove the per-slot handlers (or accept the leak explicitly given elements are GC'd on re-render, but the post-detach SVG access is a real error path).

### Q2 — Torn lock-free read of `currentZoneIndex` in the Ticker guard
`arduino/sprinkler-state.h:120-121`

The bounds check (`currentZoneIndex < totalZones`, `:120`) and the subscript (`order[currentZoneIndex]`, `:121`) are two separate lock-free loads; the command task's `s.currentZoneIndex++` (`sprinkler.cpp:237`) can land between them, making the subscript exceed the just-checked bound (boundary OOB) **independent of S1's inflation**. The plan's "degrades to a plain CMD_STOP" argument assumes an in-bounds read. **Fix:** snapshot the index into a local before the check-and-subscript (`uint8_t idx = seq->currentZoneIndex; if (idx < seq->totalZones && seq->order[idx] == zone)`).

## 🔵 Suggestions

### Q3 — Idle chain starts from *any* tile, including unchained ones
`html/js/screens/zone-list.js:262` — `if (!chain.isActive()) { … chain.start(); }` under `if (chain.hasItems())` (`:261`). Tapping an unchained tile while an idle chain exists starts the whole chain rather than a solo run — no `chain.isQueued(zoneid)` discrimination on the idle branch. Minor UX ambiguity; decide whether an unchained-tile tap should append, start solo, or be ignored.

### Q4 — `chainUpdate` head-mismatch drops silently with no nack [subsumed-by I4]
`arduino/sprinkler.cpp:216` — constituent of I4; independently actionable as "return an error status instead of dropping."

### Q5 — Dev mock diverges from the firmware chain-JSON contract
`html/js/system/http.mock.js:36` (omits `adhoc`/`paused` keys firmware emits) and `:64` (tail-rewrite concatenates with no `(base+i)<6` clamp / `totalZones` cap). Dev-only, but the mock will not reproduce the S1 boundary or a faithful payload shape.

### G1 — Navigate-away idle-clear matrix is untested
`html/js/screens/index.js:110` — `if (to && to != "main" && to != "menu" && to != "zone" && chain.hasItems() && !chain.isActive()) { chain.clear(); }`. Risk-bearing navigation predicate (clears state) with no automated coverage; verify the screen-name allowlist against the full router table (`html/js/index.js:24-38` — `settings/schedule/update/zones/setup/info/console`).

## Impact

`SprinklerControl` (the `Sprinkler` singleton) and `sprinklerCommandQueue` are hubs with producers in HTTP, Alexa, MQTT, and Ticker contexts, all sharing `sprinklerStateMutex`. S1/I2/I3/Q2 all sit on that shared `SequenceSession`/queue path, so a defect there has device-wide blast radius (false "watering" state, stranded relays, corrupted broadcasts). The `Chain` JS model fans out to `app.js`, `index.js`, `zone-list.js`; I4/Q1/Q3 are contained to the landing screen.

## Precedents

| hash | subject | 30d follow-ups | note |
|---|---|---|---|
| `fda62c9` | Fix concurrency issues with FreeRTOS command queue | delayed (`1188aa3`, +68d) | Establishes the stage+enqueue contract S1/I2/I3 must obey; direct `SequenceSession` writes from async-tcp reintroduce this race. |
| `1c378c9` | Add sequence session tracking | `fda62c9` next day | The `SequenceSession` struct shipped without concurrency protection and needed immediate follow-up; the chain extends the same struct. |
| `1188aa3` | Fix zones reporting watering without driving relays | — | Teardown that doesn't clear Tickers/broadcast leaves false "watering"; validates the A7/B3 teardown design and Q1's post-detach concern. |
| `26886bf` + `2cc61c0` + `1b174fa` | Watering-sequence scheduler + same-day review fixes | same-day (×2) | Sibling drag-to-connect feature; review found (a) unremoved bound handlers + stale SVG ref [→ Q1] and (b) client-only edits reverted by broadcast / merge-vs-replace [→ I4]. |

**Composite lesson:** the shared `SequenceSession`/`Timers`/`relays` state has been the blast center of three consecutive fixes, and the sibling UI feature's cleanup + client-authority bugs recur here verbatim (Q1, I4). Concurrency/teardown defects on this device historically surface *late* (the queue rework's relay fix came 68 days later) — the plan's still-unchecked manual A7/B3/B4/B8 hardware checks are the right instinct.

## Reconciliation Notes

- **Advisor** unavailable in this environment → inline dimension-sweep path.
- **Q6 falsified and dropped:** the claimed `state`-broadcast-keys-on-`active` vs `chain`-keys-on-`adhoc` divergence was misattributed — `SequenceSession::toJSON` (`sprinkler-state.h:79`) is reached *only* via `chainStateJSONLocked` (already `adhoc`-gated at `sprinkler.cpp:274`); the real `state` broadcast uses `SprinklerState::toJSON`, which never reads `Sequence.active`. No divergence exists.
- **Q1 precedent-weighted** 🔵→🟡 (≥2 precedent commits touching this UI cleanup pattern with follow-ups within the window).
- **S1** carries the `[cascade: buffer-overflow]` tag: the interaction sweep (E1) confirmed the single unclamped assignment fans out to four OOB sites as one reproducible chain; the constituents are not listed separately because the root cause and fix are singular.
- **Predicate-Trace (4a) skipped:** the `adhoc`/`active` predicate rows are an internal firmware invariant with all consumers inside `sprinkler.cpp`; no cross-consumer false-promise to trace (and the one candidate divergence was Q6, now falsified).
- **G1** citation corrected `index.js:82-88` → `:110` during verification.
- Scope = working-tree (`InScopeFiles == ChangedFiles`); no back-merge sidecar drops. 0 findings dropped by the in-scope pre-filter.

## Follow-up 2026-07-05T18:40:00-0400 — findings fixed

All verified findings addressed; `deno task build` + `arduino-cli compile` green (80% flash, no warnings).

| ID | Resolution |
|---|---|
| **S1** 🔴 | `chainUpdate` now counts entries actually written (`n`) and sets `s.totalZones = base + n` (≤6) — `sprinkler.cpp`. No path can inflate `totalZones` past `sizeof(order)`. |
| **I2** 🟡 | Added `SequenceSession::epoch`, bumped in `chainStart`. `CMD_CHAIN_ADVANCE`/`CMD_CHAIN_NEXT` carry the epoch (in `cmd.duration`); `chainAdvance`/`chainStartNext` reject on mismatch (and `chainAdvance` returns *without* `stop()` on a stale epoch, so it can't tear down the replacement chain). |
| **I3** 🟡 | `pendingChain` is now a 4-slot ring with a mutex-protected `pendingHead`; each request owns a slot whose index rides in `cmd.zone`, so a second stage can't clobber the first's payload. |
| **I4** 🟡 | `chainUpdate` re-broadcasts the authoritative chain state on head-mismatch (`fireEvent("chain", …)`), so a client whose optimistic splice was rejected reconciles immediately instead of waiting for the next natural broadcast. |
| **Q1** 🟡 | `disconnectedCallback` now `clearTimeout(this.hoverTimer)` and removes the stored per-slot `mousedown`/`touchstart` handlers (`_slotHandlers`) — `zone-list.js`. |
| **Q2** 🟡 | Ticker logic factored into `SprinklerZoneTimer::chainAdvanceOrStop`, which snapshots `currentZoneIndex`/`totalZones`/`epoch` into locals before the bounds-check + subscript — no torn index between the two reads. |
| **Q3** 🔵 | Idle-chain tap now discriminates: chained tile → `start()`, unchained tile → `add()` (extend), instead of any tap starting the chain — `zone-list.js`. |
| **Q4** 🔵 | Resolved by I4 (the re-broadcast is a de-facto nack for a dropped tail rewrite). |
| **Q5** 🔵 | Mock `mockChainState` emits `adhoc`/`paused`; mock tail-rewrite clamps to 6 zones — `http.mock.js`. |
| **G1** 🔵 | Not a code change — test-coverage gap only. The navigate-away predicate is unchanged and correct against the router table; flagged for a future test. |
