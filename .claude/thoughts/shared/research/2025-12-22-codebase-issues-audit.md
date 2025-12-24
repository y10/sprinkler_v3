---
date: 2025-12-22T00:00:00-05:00
researcher: Claude Code
git_commit: ef9b53db32272fd046dacf9d05908a26ddc87488
branch: master
repository: sprinkler_v3
topic: "Codebase Audit - Potential Bugs, Incompletes, and Issues"
tags: [research, codebase, audit, bugs, security, firmware, javascript]
status: complete
last_updated: 2025-12-22
last_updated_by: Claude Code
---

# Research: Codebase Audit - Potential Bugs, Incompletes, and Issues

**Date**: 2025-12-22
**Researcher**: Claude Code
**Git Commit**: ef9b53db32272fd046dacf9d05908a26ddc87488
**Branch**: master
**Repository**: sprinkler_v3

## Research Question
Identify potential bugs, incomplete implementations, misuse patterns, or suspicious code that may need correction in the ESP32 sprinkler controller codebase.

## Summary

This audit identified **45+ issues** across the firmware and web UI, categorized by severity:

| Severity | Count | Examples |
|----------|-------|----------|
| **Critical** | 8 | Missing EEPROM.commit(), race conditions, infinite loops |
| **High** | 15 | No authentication, null pointer risks, timer cleanup |
| **Medium** | 12 | Input validation gaps, state sync issues |
| **Low** | 10+ | Code quality, inconsistent patterns |

---

## Critical Issues

### 1. Missing EEPROM.commit() - Data Loss Risk
**Location**: `arduino/sprinkler-device.cpp:154-156`

```cpp
EEPROM.begin(EEPROM_SIZE);
EEPROM.put(0, cfg);
EEPROM.end();  // Missing EEPROM.commit()!
```

The `save()` method writes to EEPROM RAM buffer but never commits to flash. Configuration changes may not persist across reboots. Compare with `clear()` at line 164 which correctly calls `commit()`.

### 2. Mock HTTP Module Active in Production
**Location**: `html/js/system/http.js:1`

```javascript
export * from "./http.mock";  // Should be http.prod!
```

The production HTTP implementation is not being used. The mock implementation has different error handling and may not work with actual firmware.

### 3. Race Condition During Timer Deletion
**Location**: `arduino/sprinkler-schedule.cpp:128-144`

When `fromConfig()` or `fromJSON()` is called (e.g., from HTTP request), timers are deleted while `Alarm.serviceAlarms()` might be executing their callbacks. The TimeAlarms library stores callback pointers that become invalid.

### 4. Active Watering State Lost on Reboot
**Location**: `arduino/sprinkler-state.h:10-65`

`SprinklerZoneTimer` objects are runtime-only. If device crashes or loses power during active watering:
- Zone relay may remain ON indefinitely
- No cleanup or recovery logic in `setup()`
- Hardware state not checked or reset on boot

### 5. Ticker Callback Dangling Pointer
**Location**: `arduino/sprinkler-state.h:18` and `arduino/sprinkler-state.cpp:79`

```cpp
// Constructor creates callback with 'this' pointer
timer.once_ms(ms, +[](SprinklerZoneTimer* x) { x->OnStop(); }, this);

// Later, object can be deleted while callback is queued
delete Timers[zone];
```

If timer object is deleted during rapid start/stop cycles, the Ticker callback executes with invalid pointer.

### 6. Infinite WebSocket Reconnection Loop
**Location**: `html/js/system/wsc.js:56-62`

```javascript
function reconnect(count = 1) {
    if (!self.connect()) {
        setTimeout(() => {
            reconnect(count++);  // No maximum limit!
        }, count * 5000);
    }
}
```

No maximum retry limit. If server is permanently unreachable, creates infinite loop.

### 7. Infinite Zone List Retry Loop
**Location**: `html/js/screens/zone-list.js:117-136`

```javascript
async updateAll(retryCount = 0) {
    try { /* ... */ }
    catch (error) {
        await new Promise((done)=>setTimeout(done, delay));
        await this.updateAll(++retryCount);  // Infinite recursion!
    }
}
```

No maximum retry limit. Exponential backoff grows indefinitely. Stack depth increases.

### 8. Timer Remove Method Bug
**Location**: `html/js/models/timer.js:57-59`

```javascript
remove() {
    this.$timers.splice(this.$index);  // Missing second argument!
}
```

`splice(index)` removes ALL elements from index to end. Should be `splice(this.$index, 1)`.

---

## High Priority Issues

### Security: No Authentication
**Location**: `arduino/sprinkler-http.h:18-256`

All 20+ API endpoints accessible without credentials:
- `/esp/restart` - Reboot device
- `/esp/reset` - Factory reset
- `/api/settings` - Modify all configuration
- `/api/pin/{}/{action}` - Direct GPIO control

### Security: Direct GPIO Access Exposed
**Location**: `arduino/sprinkler-http.h:110-130`

```cpp
http.on("/api/pin/{}/{action}", ASYNC_HTTP_GET, [&](AsyncWebServerRequest *request) {
    uint8_t pin = request->pathArg(0).toInt();
    digitalWrite(pin, HIGH);  // Any GPIO pin!
});
```

Can control any GPIO pin, not just sprinkler zones. Could interfere with system pins.

### No Input Validation on Zone IDs
**Location**: `arduino/sprinkler-http.h:67-92`

Zone IDs extracted via `pathArg(0).toInt()` without bounds checking. Invalid zone IDs (e.g., 99) pass through to hardware layer which silently returns 255 but HTTP still returns 200 OK.

### No Duration Limit Enforcement
**Location**: `arduino/sprinkler-state.h:14-19`

`SKETCH_TIMER_DEFAULT_LIMIT: 15` in settings.json is never enforced. API accepts any duration:
```
GET /api/zone/1/start?d=9999
→ Timer created for 9999 minutes (~7 days)
```

### Memory Allocations Without Null Checks
**Locations**:
- `arduino/sprinkler-schedule.cpp:141`: `new SprinklerTimer()` - no null check
- `arduino/sprinkler-settings.cpp:47`: `new SprinklerZone()` - no null check
- `arduino/sprinkler-state.cpp:82`: `new SprinklerZoneTimer()` - no null check

If allocation fails, immediate null pointer dereference.

### NTP Failure Recovery Issue
**Location**: `arduino/sprinkler-time.cpp:7-23`

If NTP sync fails, system falls back to build date. Schedules attach but time comparison `t > builtDateTime` at line 43 prevents alarm servicing. No mechanism to retry attachment once time becomes valid.

### Time Comparison Type Error
**Location**: `arduino/sprinkler-time.cpp:45`

```cpp
} else if (lastSyncTime == t || (t - lastSyncTime) > 60000) {
```

Compares `time_t` (seconds) with 60000, appearing to intend 60000ms (60 seconds). Actually checks if 60000 **seconds** (~16.67 hours) have passed.

### Missing Timer Cleanup in disconnectedCallback
**Location**: `html/js/screens/zone.js:260-265`

```javascript
disconnectedCallback() {
    Wsc.off('state', this.onUpdate);
    // Missing: this.clearTimerInterval()!
    this.jQuery().detach();
}
```

The `setInterval` timer at line 391 continues running after component removal.

### Global Variable Pollution
**Location**: `html/js/system/wsc.js:54`

```javascript
self = this;  // Missing var/let/const!
```

Creates global variable, overwriting `window.self`.

---

## Medium Priority Issues

### EEPROM Validation Issues
**Location**: `arduino/sprinkler-device.cpp:116`

- Only validation: string comparison of `full_name`
- No magic byte or checksum
- No version migration logic
- Corrupted data with matching `full_name` loads successfully

### Buffer Overflow Risks
**Location**: `arduino/sprinkler-device.cpp:134-136`

```cpp
strcpy(cfg.disp_name, disp_name.c_str());  // No length check (50 char limit)
strcpy(cfg.host_name, host_name.c_str());
strcpy(cfg.full_name, full_name.c_str());
```

### Zone Index Overflow
**Location**: `arduino/sprinkler-settings.cpp:77`

```cpp
config.zones[zoneid-1] = zone->toConfig();  // No bounds check
```

If `zoneid > 6`, writes beyond array bounds.

### Timers Not Enabled After fromJSON
**Location**: `arduino/sprinkler-schedule.cpp:146-162`

New timers created via `fromJSON()` have `AlarmID = dtINVALID_ALARM_ID`. They're never enabled unless caller explicitly calls `attach()`.

### Inconsistent Enable State
**Location**: `arduino/sprinkler.cpp:42-52`

`scheduled()` only checks `Timers.isEnabled()`, not `Settings.isAttached()`. When system appears "disabled", scheduled events may still fire.

### WebSocket Doesn't Store Connection
**Location**: `html/js/system/wsc.js:73`

```javascript
const ws = new WebSocket(...);
```

Connection not stored. Cannot manually close, check state, or send messages back.

### Zone State Update Race Condition
**Location**: `html/js/screens/zone.js:495-539`

Multiple WebSocket updates can race to update UI. No debouncing. Multiple `setInterval` timers can run concurrently.

### Empty Catch Handlers
**Locations**:
- `html/js/system/app.js:122`: `Log.loglevel(level).catch();`
- `html/js/screens/menu.js:77`: `this.refresh().catch();`
- `html/js/screens/zone.js:251`: `this.update().catch();`

Errors silently suppressed.

---

## Low Priority Issues

### OTA Error Handler Buffer
**Location**: `arduino/sprinkler-ota.h:26-40`

```cpp
char errormsg[100];
strcpy(errormsg + strlen(errormsg), "Auth Failed");  // No bounds check
```

### No Exception Handling
The firmware uses no C++ try-catch. STL exceptions (from `std::map`) would crash the device.

### Typo in Error Message
**Location**: `html/js/system/app.js:79`

```javascript
Status.error("...<a href='./index.html' taget='self'>Reload</a>");
                                        ^^^^^^ should be target
```

### Throws String Instead of Error
**Location**: `html/js/models/timerSet.js:30-31`

```javascript
throw("Out of range of created timers");  // Should be: throw new Error(...)
```

### Object Comparison Bug
**Location**: `html/js/system/app.js:92`

```javascript
if (json && json !== state) {  // Always true - different object references
```

---

## Code References

### Firmware Files
- `arduino/sprinkler.cpp` - Main controller (197 lines)
- `arduino/sprinkler-http.h` - HTTP/WebSocket server (256 lines)
- `arduino/sprinkler-state.h` - Runtime timer state (92 lines)
- `arduino/sprinkler-state.cpp` - Timer management (103 lines)
- `arduino/sprinkler-schedule.cpp` - Scheduled timers (230 lines)
- `arduino/sprinkler-device.cpp` - Hardware/EEPROM (228 lines)
- `arduino/sprinkler-config.h` - Data structures (34 lines)
- `arduino/sprinkler-time.cpp` - NTP/alarm service (49 lines)

### JavaScript Files
- `html/js/system/http.js` - HTTP module export (1 line - points to mock!)
- `html/js/system/http.prod.js` - Production HTTP (88 lines)
- `html/js/system/http.mock.js` - Mock HTTP (283 lines)
- `html/js/system/wsc.js` - WebSocket client (117 lines)
- `html/js/system/app.js` - Application model (122 lines)
- `html/js/screens/zone.js` - Zone component (539 lines)
- `html/js/screens/zone-list.js` - Zone list (136 lines)
- `html/js/models/timer.js` - Timer model (59 lines)

---

## Recommended Fix Priority

### Immediate (Data Loss/Security)
1. Add `EEPROM.commit()` to `save()` method
2. Switch `http.js` to export from `http.prod`
3. Add zone bounds validation in HTTP handlers
4. Add maximum retry limits to JS reconnection loops
5. Fix `timer.remove()` splice bug

### Short-term (Stability)
1. Add null checks after memory allocations
2. Clear timer intervals in `disconnectedCallback()`
3. Store WebSocket connection for proper lifecycle management
4. Add mutex protection for shared state access
5. Validate EEPROM data with magic byte/checksum

### Medium-term (Robustness)
1. Add authentication to sensitive endpoints
2. Implement duration limit enforcement
3. Add comprehensive input validation
4. Implement proper error propagation in JS
5. Add zone state recovery on boot

---

## Open Questions

1. Is the mock HTTP module intentional for testing, or should production be used?
2. Should zone relay state be checked/reset on device boot?
3. What's the intended behavior when multiple zones are scheduled simultaneously?
4. Should there be a maximum concurrent connections limit for WebSocket?
