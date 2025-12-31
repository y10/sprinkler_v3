# WsConsole Logger Fixes

## Overview

Fix bugs and add performance optimization to the WsConsole logger library.

## Issues to Fix

1. **Memory leak** - `logFor()` allocates with `new` but never frees
2. **Typo** - `"worn"` instead of `"warn"`
3. **No clients check** - Broadcast even when no WebSocket clients connected
4. **JSON escaping** - `scope` field not escaped
5. **Null check** - `attach(nullptr)` could crash

## What We're NOT Doing

- Thread safety (would require mutex, adds complexity)
- Buffer size reduction (separate change)
- Async/batched broadcasting (overkill)

## Phase 1: Fix All Issues

### Changes Required:

#### 1. Fix Memory Leak in logFor()
**File**: `arduino/libraries/WsConsole/src/WsConsole.cpp`

Change line 16 from:
```cpp
WsConsole &WsConsole::logFor(const char *scope) {
  if (consoles.find(scope) == consoles.end()) {
    return *new WsConsole(scope);  // LEAK!
  }
  return *consoles[scope];
}
```

To:
```cpp
WsConsole &WsConsole::logFor(const char *scope) {
  if (consoles.find(scope) == consoles.end()) {
    consoles[scope] = new WsConsole(scope);  // Store in map for reuse
  }
  return *consoles[scope];
}
```

#### 2. Fix Typo "worn" → "warn"
**File**: `arduino/libraries/WsConsole/src/WsConsole.h`

Change line 29 from:
```cpp
case logWarn:
  logLevel = "worn";
  break;
```

To:
```cpp
case logWarn:
  logLevel = "warn";
  break;
```

#### 3. Skip Broadcast When No Clients
**File**: `arduino/libraries/WsConsole/src/WsConsole.cpp`

Change the broadcast function (~line 122) from:
```cpp
if (wss) {
  wss->textAll("{ \"event\": " + log.toJson() + " }");
  logIndex++;
}
```

To:
```cpp
if (wss && wss->count() > 0) {
  wss->textAll("{ \"event\": " + log.toJson() + " }");
  logIndex++;
}
```

#### 4. Fix JSON Escaping for Scope
**File**: `arduino/libraries/WsConsole/src/WsConsole.cpp`

In broadcast function (~line 110), add scope escaping:
```cpp
void WsConsole::broadcast(log_t log) {
  log.scope.replace("\"", "\\\"");   // ADD THIS
  log.scope.replace("\r", "");       // ADD THIS
  log.scope.replace("\n", "");       // ADD THIS
  log.entry.replace("\"", "\\\"");
  log.entry.replace("\r", "");
  log.entry.replace("\n", "");
  // ... rest unchanged
}
```

#### 5. Add Null Check to attach()
**File**: `arduino/libraries/WsConsole/src/WsConsole.cpp`

Change attach function (~line 30) from:
```cpp
void WsConsole::attach(AsyncWebSocket *wsp) {
  if (loglevel == logNone)
    return;

  if (!wss)
    wss.reset(wsp);
}
```

To:
```cpp
void WsConsole::attach(AsyncWebSocket *wsp) {
  if (loglevel == logNone || wsp == nullptr)
    return;

  if (!wss)
    wss.reset(wsp);
}
```

#### 6. Fix Serial.* in sprinkler-http.h
**File**: `arduino/sprinkler-http.h`

Change WebSocket event logging (~lines 270-281) from:
```cpp
case WS_EVT_CONNECT:
  Serial.printf("[%u] Connected from %d.%d.%d.%d url: %s\n", id, ip[0], ip[1], ip[2], ip[3], url.c_str());
  ...
case WS_EVT_DISCONNECT:
  Serial.printf("[%u] Disconnected!\n", id);
  break;
case WS_EVT_PONG:
  Serial.printf("[%u] Pong [%u]: %s\n", id, len, (len) ? (char *)data : "");
  break;
case WS_EVT_ERROR:
  Serial.printf("[%u] Error (%u): %s\n", id, *((uint16_t *)arg), (char *)data);
  break;
```

To use console (already defined at top of file):
```cpp
case WS_EVT_CONNECT:
  console.printf("[%u] Connected from %d.%d.%d.%d url: %s\n", id, ip[0], ip[1], ip[2], ip[3], url.c_str());
  ...
case WS_EVT_DISCONNECT:
  console.printf("[%u] Disconnected!\n", id);
  break;
case WS_EVT_PONG:
  console.printf("[%u] Pong [%u]: %s\n", id, len, (len) ? (char *)data : "");
  break;
case WS_EVT_ERROR:
  console.printf("[%u] Error (%u): %s\n", id, *((uint16_t *)arg), (char *)data);
  break;
```

### Success Criteria:

#### Automated Verification:
- [ ] Firmware compiles: `deno task compile`
- [ ] No warnings in WsConsole compilation

#### Manual Verification:
- [ ] Log messages show "warn" not "worn"
- [ ] WebSocket logging works in browser console
- [ ] No crash when calling attach(nullptr)

---

## Testing

1. Build and upload firmware
2. Open web UI, check browser console for log messages
3. Trigger a warning (e.g., invalid schedule)
4. Verify "warn" appears, not "worn"
5. Disconnect all browser tabs, verify no performance impact

## References

- `arduino/libraries/WsConsole/src/WsConsole.h`
- `arduino/libraries/WsConsole/src/WsConsole.cpp`
- `arduino/sprinkler-http.h`
