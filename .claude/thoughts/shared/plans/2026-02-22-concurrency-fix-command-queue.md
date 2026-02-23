# Concurrency Fix: Command Queue Implementation Plan

## Overview

Fix white-screen hangs and ghost watering caused by concurrent access to shared state (`Timers` map, `relays` bitfield) from three FreeRTOS execution contexts (`async_tcp`, `esp_timer`, `loopTask`). The fix moves all state mutations into `loopTask` via a FreeRTOS command queue, eliminating concurrent writes by design, and adds a lightweight mutex to protect reads.

## Current State Analysis

Three execution contexts access shared mutable state with no synchronization:

| Context | Task | Writes State? | Reads State? |
|---|---|---|---|
| `async_tcp` | HTTP handlers, Alexa callbacks | Yes (start/stop/pause/resume) | Yes (toJSON) |
| `esp_timer` | Ticker expiry callbacks | Yes (stop via OnStop) | No |
| `loopTask` | MQTT callbacks, TimeAlarms | Yes (start/stop) | Yes |

**Bugs observed:**
1. **White screen**: `std::map` internal tree corruption from concurrent insert/erase/find across tasks
2. **Ghost watering**: `relays` bitfield lost-update from concurrent non-atomic `bitRead`/`bitWrite`

### Key Discoveries:
- Ticker callbacks run in `esp_timer` FreeRTOS task, NOT an ISR (`Ticker.cpp:38` sets `ESP_TIMER_TASK`)
- `ws.textAll()` has no lock on `_clients` list — not safe from non-`async_tcp` tasks, but works in practice
- `volatile bool stopping` provides no memory ordering on dual-core ESP32 Xtensa
- Previous fix plan (2025-12-22) added `stopping` flag and `alarmServiceLocked` but explicitly skipped mutexes — insufficient for the concurrent write scenarios

## Desired End State

After implementation:
1. All state mutations (start/stop/pause/resume/enable/disable) execute exclusively in `loopTask`
2. HTTP, Alexa, and Ticker callbacks enqueue commands instead of mutating state directly
3. State reads from `async_tcp` (HTTP GET endpoints, Alexa onGet) are protected by a mutex
4. The `SprinklerZoneTimer` Ticker callback no longer calls `OnStop()` directly — it enqueues a stop command
5. `volatile bool stopping` replaced with `std::atomic<bool>` for proper cross-core memory ordering

### Verification:
- Firmware compiles without warnings
- Rapid start/stop clicks (20+ times) do not crash or hang the device
- Starting a zone shows watering on UI and physically activates the valve
- Stopping a zone stops watering on UI and physically deactivates the valve
- Scheduled timers still fire and complete correctly
- MQTT and Alexa control still works
- No white screen after repeated interactions

## What We're NOT Doing

- Refactoring ESPAsyncWebServer's `ws.textAll()` to be fully thread-safe (accepted risk — `_clients` changes rarely)
- Adding a separate worker task (unnecessary — loopTask is sufficient)
- Blocking HTTP handlers to return post-mutation state (WebSocket handles state sync)
- Persisting active watering state to EEPROM
- Frontend changes (existing disabled-class debounce pattern is sufficient)

## Implementation Approach

**Command Queue Pattern**: All write operations (start/stop/pause/resume) are submitted as lightweight structs to a FreeRTOS queue. The `loop()` function drains the queue each iteration and executes commands under a mutex. Read operations from `async_tcp` acquire the same mutex briefly to ensure consistent state during JSON serialization.

This eliminates concurrent writes by design and minimizes mutex contention (only brief reads vs. queue drain).

---

## Phase 1: Command Queue Infrastructure

### Overview
Add the FreeRTOS queue, mutex, command struct, and queue processing to the core firmware.

### Changes Required:

#### 1. Add command types and queue globals to sprinkler-state.h
**File**: `arduino/sprinkler-state.h`
**Changes**: Add command enum, struct, and extern declarations at the top (after includes, before classes). Replace `volatile bool` with `std::atomic<bool>`. Remove `OnStopCallback` from `SprinklerZoneTimer` — the Ticker callback enqueues a stop command directly instead of calling a callback.

Add after the existing includes:

```cpp
#include <atomic>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"

// Command queue for thread-safe state mutations
enum ZoneAction : uint8_t {
  CMD_START = 1,
  CMD_STOP = 2,
  CMD_PAUSE = 3,
  CMD_RESUME = 4,
  CMD_STOP_ALL = 5,
  CMD_ENABLE = 6,
  CMD_DISABLE = 7
};

struct ZoneCommand {
  ZoneAction action;
  uint8_t zone;
  uint8_t duration;
};

extern QueueHandle_t sprinklerCommandQueue;
extern SemaphoreHandle_t sprinklerStateMutex;
```

Update `SprinklerZoneTimer` class:
- Remove `OnStopCallback` typedef and `OnStop` member
- Change constructor to not take a callback — Ticker enqueues CMD_STOP directly
- Replace `volatile bool stopping` with `std::atomic<bool> stopping`
- Update `resume()` to use the same enqueue pattern

```cpp
class SprinklerZoneTimer {
 public:
  SprinklerZoneTimer(unsigned int zone, unsigned int duration)
      : Zone(zone), Duration(duration), StartTime(millis()), PauseTime(0), stopping(false) {
    unsigned long d = (duration ? duration : 5);
    unsigned long ms = d * 1000 * 60;
    timer.once_ms(ms, +[](SprinklerZoneTimer* x) {
      if (!x->stopping.load()) {
        ZoneCommand cmd = { CMD_STOP, (uint8_t)x->Zone, 0 };
        xQueueSend(sprinklerCommandQueue, &cmd, 0);
      }
    }, this);
  }

  unsigned int Zone;
  unsigned int Duration;
  unsigned long StartTime;
  unsigned long PauseTime;

  ~SprinklerZoneTimer() {
    stopping.store(true);
    timer.detach();
  }

  void pause() {
    PauseTime = millis();
    timer.detach();
  }

  void resume() {
    if (!PauseTime)
      return;

    uint32_t d = (uint32_t)Duration * 60 * 1000;
    uint32_t p = PauseTime - StartTime;
    uint32_t ms = d - p;
    stopping.store(false);
    timer.once_ms(ms, +[](SprinklerZoneTimer* x) {
      if (!x->stopping.load()) {
        ZoneCommand cmd = { CMD_STOP, (uint8_t)x->Zone, 0 };
        xQueueSend(sprinklerCommandQueue, &cmd, 0);
      }
    }, this);
    StartTime = millis() - p;
    PauseTime = 0;
  }

  void stop() {
    stopping.store(true);
    PauseTime = 0;
    timer.detach();
  }

  const String toJSON() {
    auto ms = PauseTime ? PauseTime - StartTime : millis() - StartTime;
    auto state = PauseTime ? "paused" : "started";
    return "{ \"state\": \"" + (String)state +
           "\", \"zone\":" + (String)Zone +
           ", \"millis\":" + (String)(ms) +
           ", \"duration\": " + (String)Duration +
           " }";
  }

 private:
  Ticker timer;
  std::atomic<bool> stopping;
};
```

Update `SprinklerState::start()` signature to remove OnStopCallback:

```cpp
class SprinklerState {
 public:
  // ... existing members ...
  void start(unsigned int zone, unsigned int duration);  // removed OnStopCallback
  // ... rest unchanged ...
};
```

#### 2. Update SprinklerState::start() implementation
**File**: `arduino/sprinkler-state.cpp`
**Changes**: Remove OnStopCallback parameter from start()

```cpp
void SprinklerState::start(unsigned int zone, unsigned int duration) {
  if (Timers.find(zone) != Timers.end()) {
    delete Timers[zone];
    Timers.erase(zone);
  }

  SprinklerZoneTimer *timer = new SprinklerZoneTimer(zone, duration);
  if (timer != nullptr) {
    Timers[zone] = timer;
  }
}
```

#### 3. Add queue processing to SprinklerControl
**File**: `arduino/sprinkler.h`
**Changes**: Add `enqueue()` and `processCommands()` methods

```cpp
class SprinklerControl {
 public:
  // ... existing members ...

  void initCommandQueue() {
    sprinklerCommandQueue = xQueueCreate(16, sizeof(ZoneCommand));
    sprinklerStateMutex = xSemaphoreCreateMutex();
  }

  void enqueue(ZoneAction action, uint8_t zone = 0, uint8_t duration = 0) {
    ZoneCommand cmd = { action, zone, duration };
    xQueueSend(sprinklerCommandQueue, &cmd, 0);
  }

  void processCommands();

  // Thread-safe state reads (for async_tcp context)
  String safeStateJSON() {
    xSemaphoreTake(sprinklerStateMutex, portMAX_DELAY);
    String result = Timers.toJSON();
    xSemaphoreGive(sprinklerStateMutex);
    return result;
  }

  String safeStateJSON(unsigned int zone) {
    xSemaphoreTake(sprinklerStateMutex, portMAX_DELAY);
    String result = Timers.toJSON(zone);
    xSemaphoreGive(sprinklerStateMutex);
    return result;
  }

  bool safeIsWatering() {
    xSemaphoreTake(sprinklerStateMutex, portMAX_DELAY);
    bool result = Timers.isWatering();
    xSemaphoreGive(sprinklerStateMutex);
    return result;
  }

  bool safeIsWatering(unsigned int zone) {
    xSemaphoreTake(sprinklerStateMutex, portMAX_DELAY);
    bool result = Timers.isWatering(zone);
    xSemaphoreGive(sprinklerStateMutex);
    return result;
  }

  // ... rest of class ...
};
```

#### 4. Implement processCommands() and define globals
**File**: `arduino/sprinkler.cpp`
**Changes**: Add global queue/mutex definitions and processCommands() implementation. Update `start()` to remove OnStopCallback. Update `scheduled()` to enqueue.

Add at top of file:
```cpp
QueueHandle_t sprinklerCommandQueue = NULL;
SemaphoreHandle_t sprinklerStateMutex = NULL;
```

Add processCommands():
```cpp
void SprinklerControl::processCommands() {
  ZoneCommand cmd;
  while (xQueueReceive(sprinklerCommandQueue, &cmd, 0) == pdTRUE) {
    xSemaphoreTake(sprinklerStateMutex, portMAX_DELAY);
    switch (cmd.action) {
      case CMD_START:  start(cmd.zone, cmd.duration); break;
      case CMD_STOP:   stop(cmd.zone); break;
      case CMD_PAUSE:  pause(cmd.zone); break;
      case CMD_RESUME: resume(cmd.zone); break;
      case CMD_STOP_ALL: stop(); break;
      case CMD_ENABLE:  enable(); break;
      case CMD_DISABLE: disable(); break;
    }
    xSemaphoreGive(sprinklerStateMutex);
  }
}
```

Update `start()`:
```cpp
void SprinklerControl::start(unsigned int zone, unsigned int duration) {
  console.println("Starting timer " + (String)zone);

  Device.turnOn(zone);
  Device.turnOn();
  Device.blink(0.5);

  Timers.start(zone, duration);  // no callback needed
  fireEvent("state", Timers.toJSON(zone));
}
```

Update `scheduled()` to enqueue:
```cpp
void SprinklerControl::scheduled(unsigned int zone, unsigned int duration) {
  if (Timers.isEnabled())
  {
    console.println("Scheduled timer " + (String)zone);

    // Check if this is part of a sequence
    if (isZoneInSequence(zone) && isInSequenceWindow()) {
      uint8_t zoneIndex = getZoneSequenceIndex(zone);

      if (!Timers.Sequence.active) {
        startSequenceSession(zoneIndex);
      } else {
        Timers.Sequence.currentZoneIndex = zoneIndex;
      }
    }

    enqueue(CMD_START, zone, duration);
  }
  else
  {
    console.println("Scheduled timer " + (String)zone + " canceled");
  }
}
```

#### 5. Wire up queue in arduino.ino
**File**: `arduino/arduino.ino`
**Changes**: Initialize queue in setup(), drain queue in loop()

```cpp
void setup() {
  begin();

  Sprinkler.initCommandQueue();  // NEW: before any other setup

  setupUnit();
  setupWifi();
  setupDhcp();
  setupTime();
  setupHttp();
  setupOTA();
  setupAlexa();
  setupMqtt();

  end();
}

void loop() {
  handleWifi();
  handleOTA();
  handleAlexa();
  handleMqtt();
  handleTicks();
  Sprinkler.processCommands();  // NEW: drain command queue
}
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles: `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`
- [x] No compiler warnings related to the changes

#### Manual Verification:
- [x] Device boots normally
- [x] Starting a zone via web UI activates the valve physically
- [x] Stopping a zone via web UI deactivates the valve physically
- [x] Timer countdown works correctly on web UI
- [ ] Scheduled timers still fire at configured times

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Migrate External Callers to Queue

### Overview
Change all callers from `async_tcp` and `esp_timer` contexts to use `enqueue()` instead of calling state-mutating methods directly. Protect state reads with the mutex.

### Changes Required:

#### 1. Update HTTP handlers
**File**: `arduino/sprinkler-http.h`
**Changes**: Write endpoints use `enqueue()` and return 200 immediately. Read endpoints use `safeStateJSON()` / `safeIsWatering()`.

```cpp
// READ endpoints — use mutex-protected reads:
http.on("/api/state", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    json(request, Sprinkler.safeStateJSON());
});

http.on("/api/zone/{}/state", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t rel = request->pathArg(0).toInt();
    if (rel < 1 || rel > SKETCH_MAX_ZONES) {
      request->send(400, "application/json", "{\"error\":\"Invalid zone\"}");
      return;
    }
    json(request, Sprinkler.safeStateJSON(rel));
});

// WRITE endpoints — enqueue and return immediately:
http.on("/api/zone/{}/start", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t rel = request->pathArg(0).toInt();
    if (rel < 1 || rel > SKETCH_MAX_ZONES) {
      request->send(400, "application/json", "{\"error\":\"Invalid zone\"}");
      return;
    }
    uint8_t dur = request->hasArg("d") ? request->arg("d").toInt() : 5;
    if (dur > SKETCH_TIMER_DEFAULT_LIMIT) {
      dur = SKETCH_TIMER_DEFAULT_LIMIT;
    }
    console.println("GET: /api/zone/" + (String)rel + "/start?d=" + (String)dur);
    Sprinkler.enqueue(CMD_START, rel, dur);
    ok(request);
});

http.on("/api/zone/{}/stop", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t rel = request->pathArg(0).toInt();
    if (rel < 1 || rel > SKETCH_MAX_ZONES) {
      request->send(400, "application/json", "{\"error\":\"Invalid zone\"}");
      return;
    }
    Sprinkler.enqueue(CMD_STOP, rel);
    ok(request);
});

http.on("/api/zone/{}/pause", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t rel = request->pathArg(0).toInt();
    if (rel < 1 || rel > SKETCH_MAX_ZONES) {
      request->send(400, "application/json", "{\"error\":\"Invalid zone\"}");
      return;
    }
    Sprinkler.enqueue(CMD_PAUSE, rel);
    ok(request);
});

http.on("/api/zone/{}/resume", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t rel = request->pathArg(0).toInt();
    if (rel < 1 || rel > SKETCH_MAX_ZONES) {
      request->send(400, "application/json", "{\"error\":\"Invalid zone\"}");
      return;
    }
    Sprinkler.enqueue(CMD_RESUME, rel);
    ok(request);
});

// Schedule enable/disable — enqueue:
http.on("/api/schedule/{}", ASYNC_HTTP_POST, [&](AsyncWebServerRequest *request) {
    String command = request->pathArg(0);
    console.println("POST: /api/schedule/" + command);
    if (command == "enable") {
      Sprinkler.enqueue(CMD_ENABLE);
    } else {
      Sprinkler.enqueue(CMD_DISABLE);
    }
    // Return current state (may be stale by one loop cycle — acceptable)
    json(request, (String) "{ \"state\": \"" + String(Sprinkler.isEnabled() ? "enabled" : "disabled") + "\" }");
});
```

#### 2. Update Alexa callbacks
**File**: `arduino/sprinkler-alexa.h`
**Changes**: `onSet` callback uses `enqueue()`. `onGet` uses `safeIsWatering()`.

In `fauxmo->onSet(...)` lambda:

Replace all `Sprinkler.start(zId, SKETCH_TIMER_DEFAULT_LIMIT)` with `Sprinkler.enqueue(CMD_START, zId, SKETCH_TIMER_DEFAULT_LIMIT)`.

Replace `Sprinkler.stop()` (all zones) with `Sprinkler.enqueue(CMD_STOP_ALL)`.

Replace `Sprinkler.stop(zoneId)` with `Sprinkler.enqueue(CMD_STOP, zoneId)`.

In `fauxmo->onGet(...)` lambda:

Replace `Sprinkler.isWatering()` with `Sprinkler.safeIsWatering()`.

Replace `Sprinkler.Timers.isWatering(zoneId)` with `Sprinkler.safeIsWatering(zoneId)`.

#### 3. Update MQTT callback
**File**: `arduino/sprinkler-mqtt.h`
**Changes**: `mqttCallback()` uses `enqueue()` instead of direct calls. Even though MQTT runs in loopTask, using the queue keeps all writes going through one consistent path.

In `mqttCallback()`:

Replace `Sprinkler.start(zone, SKETCH_TIMER_DEFAULT_LIMIT)` with `Sprinkler.enqueue(CMD_START, zone, SKETCH_TIMER_DEFAULT_LIMIT)`.

Replace `Sprinkler.stop(zone)` with `Sprinkler.enqueue(CMD_STOP, zone)`.

Replace `Sprinkler.Timers.isWatering(zone)` reads with `Sprinkler.Timers.isWatering(zone)` (safe — MQTT is in loopTask, writes only happen in processCommands which is also in loopTask, sequentially).

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles: `tools/arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino`
- [x] No compiler warnings

#### Manual Verification:
- [x] Rapid start/stop clicking (20+ times) does NOT cause white screen or hang
- [x] Starting zone from web UI: valve physically activates within ~100ms
- [x] Stopping zone from web UI: valve physically deactivates within ~100ms
- [x] Timer expiry correctly stops the zone (valve deactivates, UI updates)
- [x] Pausing and resuming works correctly
- [x] Starting while already running replaces the timer correctly
- [x] Alexa "turn on [zone]" / "turn off [zone]" works
- [x] MQTT ON/OFF commands work
- [x] Scheduled timers fire and complete correctly
- [x] No ghost watering: when UI shows stopped, valve is physically off

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Verify WebSocket Broadcasts

### Overview
Verify that `ws.textAll()` called from `loopTask` (via `fireEvent` in `processCommands`) works correctly. This is a known theoretical risk since `_clients` list has no lock, but in practice works because client connect/disconnect is rare.

### Changes Required:

No code changes. This phase is verification only.

### Success Criteria:

#### Manual Verification:
- [ ] Open web UI on phone — WebSocket connects
- [ ] Start a zone — UI updates in real-time via WebSocket
- [ ] Open web UI on a second device simultaneously
- [ ] Start/stop zones — both devices update in real-time
- [ ] Disconnect one device, start zone on other — no crash
- [ ] Reconnect first device — state syncs correctly

---

## Testing Strategy

### Integration Tests (Manual):

1. **Rapid Click Test** (primary regression for Bug 1):
   - Open web UI on phone
   - Rapidly tap start/stop on a zone 20+ times in quick succession
   - Verify: no white screen, no hang, device stays responsive
   - Reload page — loads normally

2. **Ghost Watering Test** (primary regression for Bug 2):
   - Start zone 1 from web UI
   - Verify valve physically turns on
   - Stop zone 1
   - Verify valve physically turns off
   - Start zone 1 again
   - Verify valve physically turns on again (not ghost)
   - Repeat 5 times

3. **Timer Expiry Test**:
   - Start zone with 1-minute duration
   - Wait for timer to expire
   - Verify valve turns off automatically
   - Verify UI shows stopped state

4. **Concurrent Access Test**:
   - Open UI on phone and tablet simultaneously
   - Start zone on phone, verify tablet updates
   - Stop zone on tablet, verify phone updates
   - Start via Alexa, verify both UIs update

5. **Schedule Test**:
   - Configure a schedule to fire in 1 minute
   - Wait for it to trigger
   - Verify zone activates on schedule
   - Verify zone stops after duration

6. **Power Cycle Test**:
   - Start a zone
   - Power cycle the device
   - Verify device boots, UI loads (no white screen)
   - Verify all zones are OFF after boot

## Performance Considerations

- FreeRTOS queue operations (`xQueueSend`/`xQueueReceive`) are O(1) and take ~1-2 microseconds
- Mutex take/give adds ~1-2 microseconds per state read
- Command execution latency: one `loop()` iteration (~1-10ms depending on WiFi/MQTT activity)
- Queue depth of 16 is sufficient — at most 6 zones + a few rapid clicks can be queued
- No heap allocations in the hot path (command struct is stack-allocated, copied into queue)

## Migration Notes

- No EEPROM format changes
- No frontend changes required (existing WebSocket sync handles the async response pattern)
- The `OnStopCallback` removal simplifies `SprinklerZoneTimer` — it no longer captures `this` pointer of `SprinklerControl`
- `volatile bool stopping` → `std::atomic<bool> stopping` provides proper cross-core memory ordering

## Rollback Plan

1. Revert the Phase 1 + Phase 2 commits
2. No data migration needed — EEPROM format unchanged
3. Old firmware binary can be flashed via OTA

## References

- Concurrency research: `.claude/thoughts/shared/research/2026-02-22-concurrency-thread-safety-analysis.md`
- Previous safety fixes: `.claude/thoughts/shared/plans/2025-12-22-critical-safety-fixes.md`
- Codebase audit: `.claude/thoughts/shared/research/2025-12-22-codebase-issues-audit.md`
- ESP-IDF esp_timer docs: Ticker callbacks run in `esp_timer` task (NOT ISR), safe for FreeRTOS APIs
- ESPAsyncWebServer: `ws.textAll()` has no lock on `_clients` — accepted risk
