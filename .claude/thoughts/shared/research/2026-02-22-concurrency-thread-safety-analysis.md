---
date: 2026-02-22T12:00:00-05:00
researcher: Claude Code
git_commit: 94d255463dffbc9ab25710aab47976d904a3630d
branch: master
repository: sprinkler_v3
topic: "Concurrency and Thread Safety Analysis - ESP32 Sprinkler Firmware"
tags: [research, codebase, concurrency, thread-safety, FreeRTOS, race-condition, mutex, ESP32]
status: complete
last_updated: 2026-02-22
last_updated_by: Claude Code
---

# Research: Concurrency and Thread Safety Analysis

**Date**: 2026-02-22
**Researcher**: Claude Code
**Git Commit**: 94d255463dffbc9ab25710aab47976d904a3630d
**Branch**: master
**Repository**: sprinkler_v3

## Research Question
Document all concurrency and thread safety characteristics of the sprinkler firmware, including all shared mutable state, code paths from each execution context, timer lifecycle operations, relay control flow, WebSocket broadcast patterns, and existing synchronization mechanisms.

## Summary

The ESP32 firmware runs three independent FreeRTOS execution contexts that access the same shared mutable state without mutex protection. The `async_tcp` task (HTTP/Alexa handlers), the `esp_timer` task (Ticker callbacks), and the Arduino `loopTask` (MQTT, TimeAlarms, loop) all read and write the `Timers` map, `relays` bitfield, and `SequenceSession` struct. The only synchronization mechanisms present are two `volatile bool` flags (`stopping` and `alarmServiceLocked`) that guard narrow windows but do not protect the shared data structures from concurrent access.

---

## 1. All Shared Mutable State

### 1.1 `SprinklerState::Timers` — `std::map<unsigned int, SprinklerZoneTimer*>`
- **Declared**: `sprinkler-state.h:102`
- **Owner**: `SprinklerControl::Timers` (public member, `sprinkler.h:23`)
- **Nature**: Heap-allocated pointer map. Keys are zone numbers (1-6). Values are raw `SprinklerZoneTimer*` pointers.
- **Operations**: `find()`, `erase()`, `operator[]` (insert), iteration, `size()` — all via `SprinklerState` methods
- **Accessed from**: `async_tcp` task, `esp_timer` task, `loopTask`
- **Thread-safe**: No. `std::map` provides no concurrent access guarantees.

### 1.2 `SprinklerDevice::relays` — `uint8_t`
- **Declared**: `sprinkler-device.h:14` (protected)
- **Nature**: 8-bit bitfield where bit N corresponds to relay index N. Bit 0 = water source, bits 1-6 = zones.
- **Operations**: `bitRead(relays, N)` (read-only), `bitWrite(relays, N, val)` (read-modify-write)
- **Accessed from**: `async_tcp` task (HTTP relay endpoints, Alexa), `esp_timer` task (via Ticker→stop→turnOff), `loopTask` (MQTT, scheduled)
- **Thread-safe**: No. `bitWrite` expands to `relays = (relays & ~(1<<N)) | (val<<N)` — a non-atomic read-modify-write.

### 1.3 `SprinklerState::Sequence` — `SequenceSession`
- **Declared**: `sprinkler-state.h:103`
- **Nature**: Struct with `active`, `paused`, `currentZoneIndex`, `totalZones` fields
- **Accessed from**: `loopTask` (via `scheduled()`), `async_tcp` task (via `toJSON()` during HTTP responses)
- **Thread-safe**: No. Plain struct with no synchronization.

### 1.4 `SprinklerState::enabled` — `bool`
- **Declared**: `sprinkler-state.h:124` (private)
- **Accessed from**: `loopTask` (via `scheduled()` → `isEnabled()`), `async_tcp` task (via HTTP schedule enable/disable endpoints)
- **Thread-safe**: No. Plain bool, though single-byte writes are effectively atomic on ESP32.

### 1.5 `SprinklerControl::onEventHandlers` — `std::map<const char*, std::vector<OnEvent>>`
- **Declared**: `sprinkler.h:118` (private)
- **Nature**: Event handler registry. Populated during `setup()`, read during `fireEvent()`.
- **Accessed from**: All three execution contexts (via `fireEvent` called from `start()`/`stop()`)
- **Thread-safe**: No, but effectively safe since it's only written during `setup()` and only read afterward.

### 1.6 `AsyncWebSocket ws` — WebSocket instance
- **Declared**: `sprinkler-http.h:22`
- **Nature**: ESPAsyncWebServer's WebSocket handler managing connected clients.
- **Accessed from**: `async_tcp` task (client connect/disconnect events), any task calling `ws.textAll()` via `fireEvent`
- **Thread-safe**: Partially — `AsyncWebSocket` has internal locking for some operations, but `textAll()` called from `esp_timer` or `loopTask` context may race with client list modifications in `async_tcp`.

---

## 2. Execution Contexts and Their Code Paths

### 2.1 `loopTask` (Arduino `loop()` — `arduino.ino:35-41`)

The main Arduino task running `setup()` then `loop()` repeatedly.

**Code paths touching shared state:**

| Call Chain | Shared State Touched | Source |
|---|---|---|
| `handleTicks()` → `Alarm.serviceAlarms()` → `scheduled()` → `start()` | `Timers` (map write), `relays` (bitWrite), `Sequence`, `ws.textAll()` | `sprinkler-time.cpp:48` → `sprinkler.cpp:90` → `sprinkler.cpp:116` |
| `handleTicks()` → `Alarm.serviceAlarms()` → `scheduled()` → `start()` → Ticker fires → `stop()` | `Timers` (map delete), `relays` (bitWrite), `ws.textAll()` | Timer expiry callback → `sprinkler.cpp:127` |
| `handleMqtt()` → `mqttClient.loop()` → `mqttCallback()` → `Sprinkler.start()` | `Timers` (map write), `relays` (bitWrite), `ws.textAll()` | `sprinkler-mqtt.h:234` |
| `handleMqtt()` → `mqttClient.loop()` → `mqttCallback()` → `Sprinkler.stop()` | `Timers` (map delete), `relays` (bitWrite), `ws.textAll()` | `sprinkler-mqtt.h:237` |
| `handleMqtt()` → `publishState()` | `Timers` (map read via `isWatering`) | `sprinkler-mqtt.h:202` |
| `handleAlexa()` → `fauxmo->handle()` | None (UDP/SSDP only) | `sprinkler-alexa.h:28` |

### 2.2 `async_tcp` Task (ESPAsyncWebServer — `AsyncTCP.cpp:221`)

Spawned by AsyncTCP as a separate FreeRTOS task with 16KB stack, priority 3, running on any available core.

**Code paths touching shared state:**

| Call Chain | Shared State Touched | Source |
|---|---|---|
| HTTP `/api/zone/{}/start` → `Sprinkler.start()` | `Timers` (map write), `relays` (bitWrite), `ws.textAll()` | `sprinkler-http.h:90` |
| HTTP `/api/zone/{}/stop` → `Sprinkler.stop()` | `Timers` (map delete), `relays` (bitWrite), `ws.textAll()` | `sprinkler-http.h:99` |
| HTTP `/api/zone/{}/pause` → `Sprinkler.pause()` | `Timers` (map read + member write), `relays` (bitWrite), `ws.textAll()` | `sprinkler-http.h:108` |
| HTTP `/api/zone/{}/resume` → `Sprinkler.resume()` | `Timers` (map read + member write + Ticker re-arm), `relays` (bitWrite), `ws.textAll()` | `sprinkler-http.h:117` |
| HTTP `/api/state` → `Sprinkler.Timers.toJSON()` | `Timers` (full map iteration + read all fields) | `sprinkler-http.h:66` |
| HTTP `/api/zone/{}/state` → `Sprinkler.Timers.toJSON(zone)` | `Timers` (map find + read fields) | `sprinkler-http.h:75` |
| HTTP `/api/relay/{}/on` → `Device.turnOn()` | `relays` (bitWrite) | `sprinkler-http.h:127` |
| HTTP `/api/relay/{}/off` → `Device.turnOff()` | `relays` (bitWrite) | `sprinkler-http.h:130` |
| HTTP `/api/relay/{}/toggle` → `Device.toggle()` | `relays` (read + write) | `sprinkler-http.h:125` |
| HTTP `POST /api/settings` → `fromJSON()` → `save()`, `attach()` | `Settings`, `Device` config, EEPROM, alarm table | `sprinkler-http.h:197-205` |
| HTTP `POST /api/schedule/enable` → `Sprinkler.enable()` | `enabled` flag | `sprinkler-http.h:167` |
| HTTP `POST /api/schedule/disable` → `Sprinkler.disable()` → `stop()` | `enabled` flag, `Timers` (implicit), `relays` | `sprinkler-http.h:170` |
| Alexa `onSet` → `Sprinkler.start()` / `Sprinkler.stop()` | `Timers` (map write/delete), `relays` (bitWrite), `ws.textAll()` | `sprinkler-alexa.h:107-120` |
| Alexa `onGet` → `Sprinkler.Timers.isWatering()` | `Timers` (map read/iteration) | `sprinkler-alexa.h:137-142` |

### 2.3 `esp_timer` Task (Ticker / FreeRTOS Timer Daemon)

The ESP32's `esp_timer` callback dispatch task. Ticker callbacks fire in this context.

**Code paths touching shared state:**

| Call Chain | Shared State Touched | Source |
|---|---|---|
| `SprinklerZoneTimer` Ticker fires → `OnStop()` → `SprinklerControl::stop()` | `Timers` (map read + delete), `relays` (bitWrite), `ws.textAll()` | `sprinkler-state.h:18-19` → `sprinkler.cpp:127` |
| LED `blink()` Ticker fires | `LED_PIN` GPIO only (no shared sprinkler state) | `sprinkler-device.cpp:235-238` |

---

## 3. Timer Lifecycle Operations

### 3.1 Create — `SprinklerState::start()` (`sprinkler-state.cpp:77-87`)

```
1. Timers.find(zone)           — map lookup
2. If found:
   a. delete Timers[zone]      — destructor: stopping=true, timer.detach()
   b. Timers.erase(zone)       — map removal
3. new SprinklerZoneTimer(...)  — heap alloc, arms Ticker with this pointer
4. Timers[zone] = timer         — map insert
```

The constructor at `sprinkler-state.h:14-21` arms a `Ticker::once_ms()` with a lambda capturing `this`:
```cpp
timer.once_ms(ms, +[](SprinklerZoneTimer* x) {
  if (!x->stopping) x->OnStop();
}, this);
```

### 3.2 Delete — `SprinklerState::stop()` (`sprinkler-state.cpp:89-95`)

```
1. Timers.find(zone)           — map lookup
2. If found:
   a. Timers[zone]->stop()     — sets stopping=true, PauseTime=0, timer.detach()
   b. delete Timers[zone]      — destructor: stopping=true (again), timer.detach() (again, no-op)
   c. Timers.erase(zone)       — map removal
```

### 3.3 Pause — `SprinklerState::pause()` (`sprinkler-state.cpp:97-101`)

```
1. Timers.find(zone)           — map lookup
2. If found:
   a. Timers[zone]->pause()    — sets PauseTime=millis(), timer.detach()
```

No map structural changes. Object remains in map. Ticker disarmed.

### 3.4 Resume — `SprinklerState::resume()` (`sprinkler-state.cpp:103-107`)

```
1. Timers.find(zone)           — map lookup
2. If found:
   a. Timers[zone]->resume()   — recalculates remaining time, re-arms Ticker, PauseTime=0
```

No map structural changes. Object remains in map. Ticker re-armed with `this` pointer.

### 3.5 Read Operations

| Method | Map Operation | Source |
|---|---|---|
| `isWatering()` | Full iteration, reads `PauseTime` on each entry | `sprinkler-state.cpp:30-38` |
| `isWatering(zone)` | `find(zone)`, reads `PauseTime` | `sprinkler-state.cpp:47-52` |
| `isPaused(zone)` | `find(zone)`, reads `PauseTime` | `sprinkler-state.cpp:40-45` |
| `count()` | Full iteration, reads `PauseTime` on each entry | `sprinkler-state.cpp:7-16` |
| `toJSON()` | Full iteration, reads all fields + calls `millis()` | `sprinkler-state.cpp:54-65` |
| `toJSON(zone)` | `find(zone)`, reads all fields | `sprinkler-state.cpp:67-75` |

---

## 4. Relay Control Flow

### 4.1 `turnOn(relay)` — `sprinkler-device.cpp:208-217`

```cpp
uint8_t SprinklerDevice::turnOn(uint8_t relay) {
  if (relay < sizeof(pins) && !bitRead(relays, relay)) {
    digitalWrite(pins[relay], LOW);    // Active-LOW relay board
    bitWrite(relays, relay, 1);
    return 1;
  }
  return 255;  // Already on or invalid
}
```

- Guard: bounds check + idempotency check via `bitRead`
- GPIO: drives pin LOW (relay activates)
- Shadow: sets bit in `relays`
- Default parameter: `relay=0` (water source)

### 4.2 `turnOff(relay)` — `sprinkler-device.cpp:219-228`

```cpp
uint8_t SprinklerDevice::turnOff(uint8_t relay) {
  if (relay < sizeof(pins) && bitRead(relays, relay)) {
    digitalWrite(pins[relay], HIGH);   // Deactivate relay
    bitWrite(relays, relay, 0);
    return 0;
  }
  return 255;  // Already off or invalid
}
```

- Mirror of `turnOn()` with inverted logic
- Guard: only proceeds if relay IS currently on per `relays` bitfield

### 4.3 `toggle(relay)` — `sprinkler-device.cpp:196-206`

```cpp
uint8_t SprinklerDevice::toggle(uint8_t relay) {
  if (relay < sizeof(pins)) {
    uint8_t val = digitalRead(pins[relay]);
    digitalWrite(pins[relay], !val);
    bitWrite(relays, relay, val);
    return !val;
  }
  return 255;
}
```

- Reads physical GPIO state (not `relays` bitfield)
- Writes inverse to GPIO and stores old value in bitfield

### 4.4 `ICACHE_RAM_ATTR` Attribute

All three relay functions are marked `ICACHE_RAM_ATTR` in their declarations (`sprinkler-device.h:111-115`), placing them in IRAM for execution during flash-busy conditions or from interrupt context.

### 4.5 Zone Activation Sequence

`SprinklerControl::start(zone, duration)` at `sprinkler.cpp:116-125`:
```
1. Device.turnOn(zone)    — zone relay ON (pin LOW, bit set)
2. Device.turnOn()        — source/pump relay ON (pin LOW, bit 0 set)
3. Device.blink(0.5)      — LED toggling at 0.5s
4. Timers.start(...)      — create countdown timer
5. fireEvent("state",...)  — WebSocket broadcast
```

### 4.6 Zone Deactivation Sequence

`SprinklerControl::stop(zone)` at `sprinkler.cpp:127-138`:
```
1. Check: Timers.isWatering(zone)
2. If last active zone (Timers.count() == 1):
   a. Device.turnOff()     — source/pump relay OFF
   b. Device.blink(0)      — LED solid
3. Device.turnOff(zone)    — zone relay OFF
4. Timers.stop(zone)       — destroy countdown timer
5. fireEvent("state",...)   — WebSocket broadcast
```

---

## 5. WebSocket Broadcast Patterns

### 5.1 Event Registration

`setupHttp()` at `sprinkler-http.h:54-56`:
```cpp
Sprinkler.on("state", [](const char *event) {
  ws.textAll((String) "{ \"state\": " + (String)(strlen(event) ? event : "null") + "}");
});
```

### 5.2 MQTT Event Registration

`setupMqtt()` at `sprinkler-mqtt.h:111-115`:
```cpp
Sprinkler.on("state", [](const char *event) {
  if (mqttClient.connected()) {
    publishAllStates();
  }
});
```

### 5.3 Event Fire Points

`fireEvent("state", ...)` is called from:

| Location | Caller | Task Context |
|---|---|---|
| `sprinkler.cpp:124` | `start()` | Any (loopTask, async_tcp, esp_timer) |
| `sprinkler.cpp:136` | `stop()` | Any (loopTask, async_tcp, esp_timer) |
| `sprinkler.cpp:158` | `pause()` | async_tcp (HTTP only) |
| `sprinkler.cpp:169` | `resume()` | async_tcp (HTTP only) |

The `fireEvent()` call is synchronous — it iterates `onEventHandlers["state"]` and calls each lambda inline. Both the WebSocket broadcast (`ws.textAll`) and MQTT publish (`publishAllStates`) execute in whatever task called `fireEvent`.

### 5.4 WebSocket Client Events

`ws.onEvent(...)` at `sprinkler-http.h:269-289` handles connect/disconnect in the `async_tcp` task. Meanwhile, `ws.textAll()` may be called from `loopTask` (scheduled timer) or `esp_timer` (Ticker expiry) simultaneously.

---

## 6. Existing Synchronization Mechanisms

### 6.1 `volatile bool stopping` — `sprinkler-state.h:71`

**Purpose**: Prevents Ticker callback from calling `OnStop()` after the `SprinklerZoneTimer` object is being deleted.

**Set in**:
- `~SprinklerZoneTimer()` at `sprinkler-state.h:29` (before `timer.detach()`)
- `SprinklerZoneTimer::stop()` at `sprinkler-state.h:53` (before `timer.detach()`)

**Checked in**:
- Ticker callback at `sprinkler-state.h:19`: `if (!x->stopping) x->OnStop()`

**Limitations**:
- `volatile` prevents compiler optimization but does NOT provide memory ordering on multi-core ESP32 (Xtensa LX6 dual-core)
- Between `stopping = true` and `timer.detach()`, the callback can fire on the other core, read stale `stopping == false`, and proceed to call `OnStop()` on a half-destroyed object
- After `delete`, the callback holds a dangling pointer regardless of `stopping` — if the Ticker fires after deallocation, it reads freed memory

### 6.2 `volatile bool alarmServiceLocked` — `sprinkler-schedule.cpp:4`

**Purpose**: Prevents `handleTicks()` from calling `Alarm.serviceAlarms()` while `ScheduleDay::fromConfig()`/`fromJSON()` are rebuilding the alarm table.

**Set/cleared in**: `ScheduleDay::fromConfig()` and `ScheduleDay::fromJSON()` (both in `sprinkler-schedule.cpp`)

**Checked in**: `handleTicks()` at `sprinkler-time.cpp:44`: `if (alarmServiceLocked) return;`

**Limitations**:
- Only guards `loopTask` → `serviceAlarms()`. Does not protect the Timers map or relay state.
- The setting code runs in `async_tcp` (via HTTP POST `/api/settings`), the checking code runs in `loopTask` — cross-core `volatile` without memory barriers.

### 6.3 No Mutex or Critical Section

There are zero `xSemaphoreCreateMutex`, `portMUX_TYPE`, `taskENTER_CRITICAL`, or any other FreeRTOS synchronization primitives in the application code.

---

## Code References

### Primary Files
- `arduino/sprinkler-state.h:10-127` — `SprinklerZoneTimer` class, `SequenceSession` struct, `SprinklerState` class
- `arduino/sprinkler-state.cpp:1-107` — `SprinklerState` method implementations
- `arduino/sprinkler.cpp:116-171` — `start()`, `stop()`, `pause()`, `resume()` implementations
- `arduino/sprinkler.h:14-121` — `SprinklerControl` class declaration
- `arduino/sprinkler-device.h:12-129` — `SprinklerDevice` class with `relays` bitfield
- `arduino/sprinkler-device.cpp:196-240` — `toggle()`, `turnOn()`, `turnOff()`, `blink()`
- `arduino/sprinkler-http.h:51-312` — HTTP handlers and WebSocket setup
- `arduino/sprinkler-alexa.h:92-161` — Alexa callbacks (run in `async_tcp` task)
- `arduino/sprinkler-mqtt.h:216-242` — MQTT callback (runs in `loopTask`)
- `arduino/sprinkler-time.cpp:42-52` — `handleTicks()` with `alarmServiceLocked` guard
- `arduino/sprinkler-schedule.cpp:128-180` — `fromConfig()`/`fromJSON()` with lock flag

### GPIO Pin Definitions
- `arduino/sprinkler-device-wrover.h` — `ENG_PIN=13`, `UTL_PIN=4`, `RL1-6_PIN`, `LED_PIN=2`

---

## Architecture Documentation

### Execution Context Map

```
┌─────────────────────────────────────────────────────────────────┐
│                     ESP32 Dual-Core                             │
├────────────────────────────┬────────────────────────────────────┤
│         Core 0             │            Core 1                  │
│                            │                                    │
│  ┌──────────────────┐      │      ┌──────────────────┐         │
│  │   loopTask        │     │      │   async_tcp       │         │
│  │                   │     │      │                   │         │
│  │ handleTicks()     │     │      │ HTTP handlers     │         │
│  │  → serviceAlarms  │     │      │  → start/stop     │         │
│  │  → scheduled()    │     │      │  → pause/resume   │         │
│  │  → start()/stop() │     │      │  → toJSON()       │         │
│  │                   │     │      │                   │         │
│  │ handleMqtt()      │     │      │ Alexa callbacks   │         │
│  │  → mqttCallback   │     │      │  → start/stop     │         │
│  │  → start()/stop() │     │      │  → isWatering()   │         │
│  └────────┬──────────┘     │      └────────┬──────────┘         │
│           │                │               │                    │
│           ▼                │               ▼                    │
│  ┌──────────────────────────────────────────────────────┐      │
│  │              Shared State (NO MUTEX)                  │      │
│  │                                                       │      │
│  │  Timers: std::map<uint, SprinklerZoneTimer*>          │      │
│  │  relays: uint8_t bitfield                             │      │
│  │  Sequence: SequenceSession struct                     │      │
│  │  ws: AsyncWebSocket                                   │      │
│  └──────────────────────────┬────────────────────────────┘      │
│                             │                                    │
│                             ▼                                    │
│                ┌──────────────────────┐                          │
│                │    esp_timer task     │                          │
│                │                      │                          │
│                │ Ticker callback      │                          │
│                │  → OnStop()          │                          │
│                │  → stop()            │                          │
│                │  → Timers map modify │                          │
│                │  → relays bitWrite   │                          │
│                │  → ws.textAll()      │                          │
│                └──────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### Concurrency Conflict Matrix

| Operation A (Context) | Operation B (Context) | Shared Resource | Conflict Type |
|---|---|---|---|
| `start()` (async_tcp) | `stop()` via Ticker (esp_timer) | `Timers` map | Concurrent find/erase/insert on std::map |
| `start()` (async_tcp) | `start()` (async_tcp, 2nd request) | `Timers` map | Sequential in same task, but interleaves with esp_timer |
| `stop()` (async_tcp) | `toJSON()` (async_tcp, another request) | `Timers` map | Erase during iteration (unlikely but possible) |
| `turnOn()` (async_tcp) | `turnOff()` (esp_timer via stop) | `relays` bitfield | Lost update on read-modify-write |
| `start()` (loopTask via MQTT) | `start()` (async_tcp via HTTP) | `Timers` map + `relays` | Cross-core concurrent access |
| `fireEvent` (esp_timer) | `ws.onEvent` (async_tcp) | WebSocket client list | Concurrent broadcast + client add/remove |
| `scheduled()` (loopTask) | `start()` (async_tcp) | `Sequence`, `Timers`, `relays` | Cross-core concurrent access |

---

## Historical Context (from thoughts/)

Previous analysis documents identified these same issues:

- `.claude/thoughts/shared/research/2025-12-22-codebase-issues-audit.md` — Identified ticker callback dangling pointer (Critical #5), race condition during timer deletion (Critical #3), and recommended mutex protection
- `.claude/thoughts/shared/plans/2025-12-22-critical-safety-fixes.md` — Implemented partial fixes:
  - Phase 1: Boot safety (all zones OFF on reboot) — **implemented** (verified in `arduino.ino:50`)
  - Phase 2: `volatile bool stopping` flag — **implemented** (verified in `sprinkler-state.h:71`)
  - Phase 3: `alarmServiceLocked` flag — **implemented** (verified in `sprinkler-schedule.cpp:4`)
  - Explicitly noted "Using mutexes or critical sections (overkill for this use case)" — this decision is now contradicted by the observed bugs
- `.claude/thoughts/shared/plans/2025-12-27-wsconsole-fixes.md` — WsConsole thread safety concerns
- `.claude/thoughts/shared/research/2025-12-23-asyncudp-vs-wifiudp-ssdp.md` — AsyncUDP thread safety analysis

---

## Related Research

- `.claude/thoughts/shared/research/2025-12-22-codebase-issues-audit.md`

---

## Open Questions

1. Should the mutex protect only `Timers` + `relays`, or should it also wrap the full `start()`/`stop()` operation including `fireEvent` and `ws.textAll()`?
2. Should we use `portMUX_TYPE` (spinlock, ISR-safe) or `SemaphoreHandle_t` (FreeRTOS mutex, supports blocking)?
3. Does `AsyncWebSocket::textAll()` need to be called from the `async_tcp` task specifically, or is cross-task usage supported?
4. Should the frontend implement debouncing/throttling on rapid start/stop clicks as a complementary fix?
