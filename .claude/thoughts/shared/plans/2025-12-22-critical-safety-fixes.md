# Critical Safety Fixes Implementation Plan

## Overview

This plan addresses three critical issues identified in the codebase audit that could cause hardware safety problems (zones staying ON) or firmware crashes (dangling pointers, race conditions).

## Current State Analysis

### Issue 1: Active Watering Lost on Reboot
- **Location**: `arduino/arduino.ino`, `arduino/sprinkler-device.cpp:99-108`
- **Problem**: If device crashes mid-watering, relay state is undefined on reboot
- **Current behavior**: `Device.init()` sets all pins HIGH (off), but no explicit safety check after full initialization

### Issue 2: Ticker Callback Dangling Pointer
- **Location**: `arduino/sprinkler-state.h:18`, `arduino/sprinkler-state.cpp:77-83`
- **Problem**: `SprinklerZoneTimer` destructor calls `timer.detach()`, but callback may already be queued in FreeRTOS timer task
- **Current behavior**: Callback captures `this` pointer which becomes invalid after delete

### Issue 3: Race Condition in Timer Deletion
- **Location**: `arduino/sprinkler-schedule.cpp:128-144, 146-162`
- **Problem**: `fromConfig()`/`fromJSON()` delete timers while `Alarm.serviceAlarms()` may be executing callbacks
- **Current behavior**: No synchronization between HTTP handler (AsyncWebServer task) and main loop alarm servicing

### Key Discoveries:
- `Device.init()` at `sprinkler-device.cpp:103-107` correctly sets pins HIGH (off)
- `SprinklerZoneTimer` destructor at `sprinkler-state.h:26-28` calls `stop()` which detaches timer
- Alarm callbacks are serviced in `handleTicks()` at `sprinkler-time.cpp:44`
- HTTP requests handled by AsyncWebServer run in separate FreeRTOS task
- `SprinklerState::start()` at `sprinkler-state.cpp:77-83` deletes existing timer before creating new one

## Desired End State

After implementation:
1. All zones guaranteed OFF after device boot, with logged confirmation
2. Ticker callbacks safely ignored if timer object is being/has been deleted
3. Alarm servicing paused during schedule configuration updates

### Verification:
- Compile without warnings
- Device boots with "Boot safety: all zones OFF" in log
- Rapid start/stop of zones doesn't crash
- Updating schedules via API while timers are running doesn't crash

## What We're NOT Doing

- Persisting active watering state to EEPROM/RTC (adds complexity, wear issues)
- Using mutexes or critical sections (overkill for this use case)
- Refactoring the entire timer system (invasive, risky)

## Implementation Approach

All three fixes are independent and low-risk. Each adds a simple safety check without changing core logic. We'll implement in order of impact: reboot safety first (hardware safety), then ticker safety, then race condition.

---

## Phase 1: Reboot Safety Check

### Overview
Add explicit stop-all-zones call at end of `setup()` to guarantee safe state after boot.

### Changes Required:

#### 1. Update arduino.ino
**File**: `arduino/arduino.ino`
**Changes**: Add safety stop after all initialization completes

```cpp
void setup() {
  begin();

  setupUnit();
  setupWifi();
  setupDhcp();
  setupTime();
  setupHttp();
  setupOTA();
  setupAlexa();

  // Boot safety: ensure all zones are OFF regardless of prior state
  Sprinkler.stop();
  Console.println("unit", "Boot safety: all zones OFF");

  end();
}
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles: `deno task compile`
- [x] No compiler warnings

#### Manual Verification:
- [x] Upload to ESP32 and observe serial output
- [x] Confirm "Boot safety: all zones OFF" appears in log
- [x] Verify no zones activate during boot sequence

---

## Phase 2: Ticker Callback Safety

### Overview
Add a `stopping` flag to `SprinklerZoneTimer` that prevents callback execution when object is being deleted.

### Changes Required:

#### 1. Update SprinklerZoneTimer class
**File**: `arduino/sprinkler-state.h`
**Changes**: Add stopping flag, check in callback, set in destructor

```cpp
class SprinklerZoneTimer {
 public:
  typedef std::function<void()> OnStopCallback;

  SprinklerZoneTimer(unsigned int zone, unsigned int duration, OnStopCallback onStop)
      : Zone(zone), Duration(duration), StartTime(millis()), PauseTime(0), OnStop(onStop), stopping(false) {
    unsigned long d = (duration ? duration : 5);
    unsigned long ms = d * 1000 * 60;
    timer.once_ms(ms, +[](SprinklerZoneTimer* x) {
      if (!x->stopping) x->OnStop();
    }, this);
  }

  unsigned int Zone;
  unsigned int Duration;
  unsigned long StartTime;
  unsigned long PauseTime;

  ~SprinklerZoneTimer() {
    stopping = true;  // Set BEFORE detach to prevent callback execution
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
    timer.once_ms(ms, +[](SprinklerZoneTimer* x) {
      if (!x->stopping) x->OnStop();
    }, this);
    StartTime = millis() - p;
    PauseTime = 0;
  }

  void stop() {
    stopping = true;  // Also set here for explicit stop
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
  OnStopCallback OnStop;
  Ticker timer;
  volatile bool stopping;  // Prevents callback execution during/after deletion
};
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles: `deno task compile`
- [x] No compiler warnings

#### Manual Verification:
- [x] Upload to ESP32
- [x] Rapidly start/stop same zone multiple times via API
- [x] Verify no crashes occur
- [x] Check serial log for any errors

---

## Phase 3: Alarm Service Race Condition Fix

### Overview
Add a lock flag that prevents `Alarm.serviceAlarms()` from running while schedule configuration is being updated.

### Changes Required:

#### 1. Add lock flag declaration
**File**: `arduino/sprinkler-schedule.h`
**Changes**: Add extern declaration for the lock flag

Add near the top of the file (after includes):
```cpp
// Lock flag to prevent alarm servicing during config updates
extern volatile bool alarmServiceLocked;
```

#### 2. Define lock flag and use in schedule updates
**File**: `arduino/sprinkler-schedule.cpp`
**Changes**: Define the flag and wrap timer deletion in lock

Add at top of file (after includes):
```cpp
volatile bool alarmServiceLocked = false;
```

Update `ScheduleDay::fromConfig()`:
```cpp
void ScheduleDay::fromConfig(SprinklerTimerConfig &config)
{
  alarmServiceLocked = true;  // Prevent alarm servicing during update

  for (auto &t : Timers)
  {
    t->disable();
    delete t;
  }

  Timers.clear();

  if (!config.defined) {
    alarmServiceLocked = false;
    return;
  }

  SprinklerTimer *timer = new SprinklerTimer(Day, onTimerTick);
  timer->fromConfig(config);
  Timers.push_back(timer);

  alarmServiceLocked = false;  // Re-enable alarm servicing
}
```

Update `ScheduleDay::fromJSON()`:
```cpp
void ScheduleDay::fromJSON(JsonArray json)
{
  alarmServiceLocked = true;  // Prevent alarm servicing during update

  for (auto &t : Timers)
  {
    t->disable();
    delete t;
  }

  Timers.clear();

  for (JsonVariant value : json)
  {
    SprinklerTimer *timer = new SprinklerTimer(Day, onTimerTick);
    timer->fromJSON(value.as<JsonObject>());
    Timers.push_back(timer);
  }

  alarmServiceLocked = false;  // Re-enable alarm servicing
}
```

#### 3. Check lock flag before servicing alarms
**File**: `arduino/sprinkler-time.cpp`
**Changes**: Add include and check flag before calling serviceAlarms

Add include at top:
```cpp
#include "sprinkler-schedule.h"
```

Update `handleTicks()`:
```cpp
void handleTicks() {
  // Skip alarm servicing if schedule is being updated
  if (alarmServiceLocked) return;

  time_t t = time(nullptr);
  if (t > builtDateTime) {
    Alarm.serviceAlarms();
  } else if (lastSyncTime == t || (t - lastSyncTime) > 60000) {
    syncTime();
  }
}
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles: `deno task compile`
- [x] No compiler warnings

#### Manual Verification:
- [x] Upload to ESP32
- [x] Start a scheduled timer, then immediately POST new schedule config
- [x] Verify no crashes occur
- [x] Scheduled timers still fire correctly after config update

---

## Testing Strategy

### Unit Tests:
N/A - Arduino environment doesn't have unit test framework set up

### Integration Tests:
N/A - Manual testing required

### Manual Testing Steps:

1. **Reboot Safety Test**:
   - Start a zone watering
   - Press reset button on ESP32
   - Verify zone turns OFF after reboot
   - Check serial log for "Boot safety: all zones OFF"

2. **Ticker Safety Test**:
   - Open two browser tabs to device
   - Rapidly click start/stop on same zone in both tabs
   - Do this 20+ times
   - Verify no crashes (device stays responsive)

3. **Race Condition Test**:
   - Set up a schedule that triggers in 1 minute
   - Wait for it to start triggering
   - While zone is running, POST new schedule via API
   - Verify no crash and schedule updates correctly

---

## Performance Considerations

- `volatile bool` flag checks add negligible overhead (single memory read)
- No loops or delays added
- No heap allocations in hot paths
- Lock flag is only set during config updates (rare operation)

---

## Migration Notes

No data migration needed. Changes are purely code-level safety improvements.

---

## Rollback Plan

If issues arise:
1. Revert the specific phase's changes
2. Each phase is independent, so partial rollback is possible
3. No EEPROM format changes, so old firmware will work with existing config

---

## References

- Codebase audit: `.claude/thoughts/shared/research/2025-12-22-codebase-issues-audit.md`
- ESP32 Ticker documentation: Uses FreeRTOS timers internally
- TimeAlarms library: Callbacks execute synchronously in `serviceAlarms()`
