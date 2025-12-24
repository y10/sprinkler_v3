---
date: 2025-12-22T00:00:00-08:00
researcher: Claude Code
git_commit: 2a594c8
branch: master
repository: sprinkler_v3
topic: "Alexa Per-Zone Integration with Gen3 Compatibility"
confidence: high
complexity: medium
status: ready
tags: [solutions, alexa, fauxmoesp, gen3-compatibility, port-sharing]
last_updated: 2025-12-22
last_updated_by: Claude Code
---

# Solution Analysis: Alexa Per-Zone Integration with Gen3 Compatibility

**Date**: 2025-12-22
**Researcher**: Claude Code
**Git Commit**: 2a594c8
**Branch**: master
**Repository**: sprinkler_v3

## Research Question

How to properly integrate Alexa into the sprinkler project with:
1. Per-zone Alexa control (each configured zone appears as separate Alexa device)
2. Voice commands: "Turn on/off [zone name]", "Is [zone name] on?"
3. Gen3 Echo compatibility (port 80 sharing with web server)
4. Fallback to port 1901 for older Echo devices

## Summary

**Problem**: Current implementation only registers ONE Alexa device for the entire system, doesn't support per-zone control, and may not work with Gen3 Echo devices due to port configuration.

**Recommended**: Option 1 (External Server Mode with Per-Zone Registration) - Best balance of Gen3 compatibility, per-zone control, and minimal code changes.

**Effort**: Medium (1-2 days)

**Confidence**: High

## Problem Statement

**Requirements:**
1. Each configured zone (e.g., "Front Yard", "Back Yard") appears as a separate Alexa device
2. "Alexa, turn on Front Yard" starts watering that zone for 15 minutes (SKETCH_TIMER_DEFAULT_LIMIT)
3. "Alexa, turn off Front Yard" stops watering that zone
4. "Alexa, is Front Yard on?" reports if zone is currently watering
5. Gen3 Echo devices must be supported (requires port 80)
6. Older Echo devices should still work (port 1901 fallback via UDP)

**Constraints:**
- AsyncWebServer already running on port 80 (cannot be changed)
- FauxmoESP library is already in use
- Zone names are stored in private `SprinklerSettings::zones` map
- SKETCH_MAX_ZONES = 6 (hardware limitation)
- Maximum timer duration is 15 minutes (SKETCH_TIMER_DEFAULT_LIMIT)

**Success Criteria:**
- All configured zones discoverable by Alexa
- Voice commands work for start/stop/status on each zone
- Works with both Gen3 and older Echo devices
- Web UI continues to function normally
- State synchronized between Alexa and actual zone status

## Current State

**Existing Implementation** (`sprinkler-alexa.h:16-36`):
```cpp
void setupAlexa() {
  if (WiFi.getMode() & WIFI_STA) {
    fauxmo.reset(new fauxmoESP());

    // Only ONE device registered (system-wide)
    if (Sprinkler.dispname().length() > 0) {
      fauxmo->addDevice(Sprinkler.dispname().c_str());
    }

    fauxmo->onSet([&](...) {
      state ? Sprinkler.enable() : Sprinkler.disable();  // System-wide only
    });

    fauxmo->onGet([&](...) {
      state = Sprinkler.isWatering();  // Any zone watering
    });
  }
}
```

**Problems with Current Implementation:**
1. Only registers device display name, not zone names
2. `Sprinkler.enable()/disable()` controls scheduling, not zone watering
3. No port configuration for Gen3 compatibility
4. No integration with AsyncWebServer on port 80

**Relevant Patterns:**
- Zone iteration: `for (const auto &kv : zones)` - Used in `toConfig()`, `toJSON()`
- Event system: `Sprinkler.on("state", callback)` - Used for WebSocket broadcast
- Zone start/stop: `Sprinkler.start(zone, duration)`, `Sprinkler.stop(zone)`
- State query: `Sprinkler.isWatering(zone)` - Per-zone status

**Integration Points:**
- `sprinkler-alexa.h:16` - setupAlexa() function
- `sprinkler-http.h:48` - setupHttp() function (web server setup)
- `sprinkler-http.h:237-247` - onNotFound handler
- `arduino.ino:28` - setupAlexa() call in initialization
- `arduino.ino:36` - handleAlexa() call in main loop

## Solution Options

### Option 1: External Server Mode with Per-Zone Registration (Recommended)

**How it works:**
Configure FauxmoESP in external server mode to share port 80 with AsyncWebServer. Register each configured zone as a separate Alexa device. Route Alexa requests through `onRequestBody` and `onNotFound` handlers to `fauxmo.process()`.

**Implementation approach:**

1. Add zone iteration method to SprinklerSettings:
```cpp
// In sprinkler-settings.h, add public method:
template<typename F>
void forEachZone(F callback) const {
  for (const auto &kv : zones) {
    callback(kv.first, kv.second);
  }
}
```

2. Modify setupAlexa() to register zones:
```cpp
void setupAlexa() {
  if (WiFi.getMode() & WIFI_STA) {
    fauxmo.reset(new fauxmoESP());

    // External server mode for Gen3 compatibility
    fauxmo->createServer(false);
    fauxmo->setPort(80);

    // Register each zone as separate device
    Sprinkler.Settings.forEachZone([](unsigned int zoneId, SprinklerZone* zone) {
      if (zone->name().length() > 0) {
        unsigned char deviceId = fauxmo->addDevice(zone->name().c_str());
        zoneToDeviceMap[zoneId] = deviceId;
        deviceToZoneMap[deviceId] = zoneId;
      }
    });

    fauxmo->onSet([&](unsigned char device_id, const char* name, bool state, unsigned char value) {
      unsigned int zoneId = deviceToZoneMap[device_id];
      if (state) {
        Sprinkler.start(zoneId, SKETCH_TIMER_DEFAULT_LIMIT);
      } else {
        Sprinkler.stop(zoneId);
      }
    });

    fauxmo->onGet([&](unsigned char device_id, const char* name, bool& state, unsigned char& value) {
      unsigned int zoneId = deviceToZoneMap[device_id];
      state = Sprinkler.Timers.isWatering(zoneId);
      value = state ? 255 : 0;
    });

    fauxmo->enable(true);
  }
}
```

3. Add Alexa request routing in setupHttp():
```cpp
// In setupHttp(), before server.begin():
http.onRequestBody([](AsyncWebServerRequest *request, uint8_t *data,
                      size_t len, size_t index, size_t total) {
  if (fauxmo && fauxmo->process(request->client(),
      request->method() == HTTP_GET, request->url(), String((char *)data))) {
    return;
  }
});

// Modify onNotFound to check Alexa first:
http.onNotFound([&](AsyncWebServerRequest *request) {
  String body = request->hasParam("body", true)
    ? request->getParam("body", true)->value()
    : String();
  if (fauxmo && fauxmo->process(request->client(),
      request->method() == HTTP_GET, request->url(), body)) {
    return;
  }
  // Existing 404 handling...
});
```

**Pros:**
- Full Gen3 compatibility (port 80)
- Per-zone control with meaningful device names
- Minimal changes to existing architecture
- Follows FauxmoESP documented external server pattern
- Web UI continues to work normally
- SSDP on port 1900 still works for older devices

**Cons:**
- Requires adding zone iteration method to SprinklerSettings
- Zone-to-device mapping adds small memory overhead
- Alexa device re-registration needed if zone names change

**Complexity:** Medium (~1-2 days)
- Files to create: 0
- Files to modify: 3 (sprinkler-settings.h, sprinkler-alexa.h, sprinkler-http.h)
- Lines changed: ~60-80 lines
- Risk level: Low (isolated changes)

---

### Option 2: Dual Port Strategy (Port 80 + Port 1901)

**How it works:**
Run two FauxmoESP instances or configure FauxmoESP to respond on both ports. Keep internal server on port 1901 for older devices while also handling port 80 requests through the external server pattern.

**Implementation approach:**
- Keep FauxmoESP internal server on port 1901 (default)
- Add process() calls to AsyncWebServer for port 80 Gen3 devices
- UDP SSDP responses point to port 80 for all devices

**Pros:**
- Maximum compatibility with all Echo generations
- No need to change internal FauxmoESP behavior significantly

**Cons:**
- FauxmoESP's internal SSDP always advertises one port (cannot split)
- Would require modifying FauxmoESP library code
- More complex, harder to maintain
- Gen3 devices ignore port 1901 anyway

**Complexity:** High (~3-4 days)
- Files to create: 0
- Files to modify: 3-4 including FauxmoESP library
- Risk level: Medium-High (library modifications)

**Why not recommended:** The SSDP response includes the TCP port in the LOCATION header. Gen3 devices strictly require port 80, so advertising two ports isn't possible through SSDP. The external server mode already handles both Gen3 and older devices correctly.

---

### Option 3: Custom Hue Bridge Emulation

**How it works:**
Replace FauxmoESP entirely with custom Philips Hue bridge emulation code that directly integrates with AsyncWebServer.

**Implementation approach:**
- Implement SSDP responder manually
- Create /description.xml endpoint
- Create /api/* Hue API endpoints
- Map zones to Hue "lights"

**Pros:**
- Full control over implementation
- No external library dependency
- Can implement advanced features (brightness = duration percentage)

**Cons:**
- Significant development effort
- Need to handle Hue API edge cases
- Maintenance burden for Alexa/Hue protocol changes
- FauxmoESP already handles this well

**Complexity:** High (~5-7 days)
- Files to create: 2-3 (custom Hue emulation modules)
- Files to modify: 2 (sprinkler-http.h, arduino.ino)
- Lines changed: ~400-600 lines
- Risk level: High (complete reimplementation)

**Why not recommended:** FauxmoESP is well-tested and maintained. Reimplementing would be significant effort for no real benefit.

---

### Option 4: Static Zone Device Registration

**How it works:**
Hardcode up to 6 zone devices with generic names ("Zone 1", "Zone 2", etc.) regardless of actual configuration.

**Implementation approach:**
```cpp
for (int i = 1; i <= SKETCH_MAX_ZONES; i++) {
  fauxmo->addDevice(("Zone " + String(i)).c_str());
}
```

**Pros:**
- Simple implementation
- No zone iteration method needed
- Alexa devices always available

**Cons:**
- Poor user experience ("Zone 1" vs "Front Yard")
- All 6 zones appear even if not configured
- No meaningful names for voice control

**Complexity:** Low (~0.5 days)
- Files to modify: 1 (sprinkler-alexa.h)
- Lines changed: ~20 lines
- Risk level: Low

**Why not recommended:** User experience is significantly degraded. Users want to say "Alexa, turn on Front Yard" not "Alexa, turn on Zone 1".

## Comparison

| Criteria | Option 1 (External) | Option 2 (Dual Port) | Option 3 (Custom) | Option 4 (Static) |
|----------|---------------------|---------------------|-------------------|-------------------|
| Complexity | Medium | High | High | Low |
| Gen3 Support | Yes | Yes | Yes | No |
| Per-Zone Names | Yes | Yes | Yes | No |
| Codebase Fit | High | Low | Low | Medium |
| Risk | Low | Medium-High | High | Low |
| Maintenance | Low | High | High | Low |
| User Experience | Excellent | Excellent | Excellent | Poor |

## Recommendation

**Selected:** Option 1 (External Server Mode with Per-Zone Registration)

**Rationale:**
- Follows documented FauxmoESP pattern for external server integration
- Minimal changes to existing codebase (3 files, ~60-80 lines)
- Full Gen3 compatibility proven in FauxmoESP examples
- Per-zone control with user-configured names
- Low risk - isolated changes with clear rollback path
- Web UI continues to work without modification

**Why not alternatives:**
- Option 2: SSDP cannot advertise multiple ports; Gen3 ignores non-80 ports anyway
- Option 3: Unnecessary reimplementation when FauxmoESP works well
- Option 4: Poor user experience defeats the purpose of voice control

**Trade-offs:**
- Accepting small memory overhead for zone-device mapping in exchange for per-zone control
- Adding zone iteration method exposes internal structure but follows existing patterns

**Implementation Approach:**

1. **Phase 1: Add zone iteration** - Add `forEachZone()` template method to SprinklerSettings
2. **Phase 2: Update setupAlexa()** - Configure external server mode, register zones, update callbacks
3. **Phase 3: Add request routing** - Add onRequestBody and modify onNotFound in setupHttp()
4. **Phase 4: Test** - Verify with Echo device, test all voice commands

**Integration Points:**
- `sprinkler-settings.h:~60` - Add forEachZone() method
- `sprinkler-alexa.h:1-37` - Complete rewrite of Alexa setup
- `sprinkler-http.h:237` - Modify onNotFound handler
- `sprinkler-http.h:~270` - Add onRequestBody handler before http.begin()

**Patterns to Follow:**
- Zone iteration: `for (const auto &kv : zones)` from `sprinkler-settings.cpp:79-84`
- Request routing: FauxmoESP External_Server example pattern
- State query: `Sprinkler.Timers.isWatering(zone)` from `sprinkler-state.cpp`

**Risks:**
- **Zone name changes**: Alexa won't automatically update device names. Mitigation: User must re-discover devices after renaming zones in web UI.
- **Memory usage**: Each zone device adds ~50 bytes. Mitigation: Only 6 zones max, well within ESP32 RAM.
- **Request routing order**: Alexa handlers must come after web UI routes. Mitigation: Add onRequestBody after all http.on() calls.

## Scope Boundaries

**In Scope:**
- Per-zone Alexa device registration
- Gen3 Echo compatibility (port 80)
- Voice commands: on/off/status for each zone
- Start duration: 15 minutes (SKETCH_TIMER_DEFAULT_LIMIT)

**Out of Scope:**
- Brightness dimming (duration control via percentage)
- Schedule management via Alexa
- Multi-zone group commands
- Alexa routines integration
- Device re-discovery on zone rename (requires manual "Alexa, discover devices")

## Testing Strategy

**Unit Tests:**
- Zone iteration method returns all configured zones
- Zone-to-device mapping is bidirectional
- Start/stop callbacks target correct zones

**Integration Tests:**
- FauxmoESP discovers all zone devices
- Web UI still functions on port 80
- WebSocket connections work alongside Alexa

**Manual Verification:**
- [ ] "Alexa, discover devices" finds all configured zones by name
- [ ] "Alexa, turn on [zone name]" starts watering for 15 minutes
- [ ] "Alexa, turn off [zone name]" stops watering
- [ ] "Alexa, is [zone name] on?" reports correct status
- [ ] Web UI loads and functions normally
- [ ] Zone status updates in real-time on web UI when controlled via Alexa
- [ ] Works with Gen3 Echo devices
- [ ] Works with Gen2 Echo devices (if available for testing)

## Open Questions

**Resolved during research:**
- Q: Why do Gen3 devices require port 80?
  - A: Amazon changed firmware to strictly follow Philips Hue spec which mandates port 80. The SSDP LOCATION header must point to port 80 for Gen3 devices to query /description.xml.

- Q: Can we support both Gen3 and older devices?
  - A: Yes. SSDP (UDP port 1900) is separate from HTTP (TCP port 80). Using external server mode with port 80 works for all generations.

- Q: How to iterate zones when the map is private?
  - A: Add a public `forEachZone()` template method following the pattern already used internally.

**Requires user input:**
- Q: Should zone devices be prefixed with system name (e.g., "Sprinkler Front Yard")?
  - Default assumption: No prefix - use zone names directly for natural voice commands.

- Q: What happens if a zone has no name configured?
  - Default assumption: Skip registration - only zones with names become Alexa devices.

**Blockers:**
- None identified. All technical questions resolved during research.

## References

- `arduino/libraries/FauxmoESP/examples/fauxmoESP_External_Server/fauxmoESP_External_Server.ino` - Official external server example
- `arduino/libraries/FauxmoESP/src/fauxmoESP.h:106-107` - createServer()/setPort() API
- `arduino/sprinkler-settings.cpp:79-84` - Zone iteration pattern
- `arduino/sprinkler.cpp:54-76` - Zone start/stop implementation
- `arduino/sprinkler-state.cpp:67-75` - Zone state query toJSON()
- [FauxmoESP Issue #66](https://bitbucket.org/xoseperez/fauxmoesp/issues/66/fauxmo-with-echo-dot-3) - Gen3 compatibility discussion
