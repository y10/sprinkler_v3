# Alexa Per-Zone Integration Implementation Plan

## Overview

Implement per-zone Alexa voice control with Gen3 Echo compatibility. Registers two types of Alexa devices:

1. **System device**: `"<system_name>"` (e.g., "Sprinkler") - enables/disables all scheduling
2. **Zone devices**: `"<system_name> at <zone_name>"` (e.g., "Sprinkler at Front Yard") - controls individual zones

Uses FauxmoESP external server mode to share port 80 with the existing AsyncWebServer.

## Current State Analysis

**Existing Implementation** (`sprinkler-alexa.h:16-36`):
- Only ONE Alexa device registered (system display name)
- Uses `Sprinkler.enable()/disable()` which controls scheduling, not zone watering
- No port configuration - defaults to 1901 (incompatible with Gen3 Echo)
- No integration with AsyncWebServer on port 80

**Key Constraints:**
- `SprinklerSettings::zones` is private - need public iterator
- FauxmoESP device IDs are 0-based, zone IDs are 1-6
- Maximum 6 zones (SKETCH_MAX_ZONES)
- Timer duration limit: 15 minutes (SKETCH_TIMER_DEFAULT_LIMIT)

### Key Discoveries:
- `fauxmoESP::process()` at `fauxmoESP.cpp:541` handles external server requests
- `fauxmoESP::createServer(false)` + `setPort(80)` enables external server mode
- Zone iteration pattern: `for (const auto &kv : zones)` used in `sprinkler-settings.cpp:79-84`
- Zone start/stop: `Sprinkler.start(zone, duration)` and `Sprinkler.stop(zone)` at `sprinkler.cpp:54-76`

## Desired End State

After implementation:
- **System device** appears as `"<Sprinkler.dispname()>"` for enable/disable
- **Zone devices** appear as `"<Sprinkler.dispname()> at <zone.name()>"` for each configured zone
- Voice commands work:
  - "Alexa, turn on Sprinkler" → enables scheduling (like menu button)
  - "Alexa, turn off Sprinkler" → disables scheduling and stops all zones
  - "Alexa, is Sprinkler on?" → reports if scheduling is enabled
  - "Alexa, turn on Sprinkler at Front Yard" → starts zone for 15 minutes
  - "Alexa, turn off Sprinkler at Front Yard" → stops zone
  - "Alexa, is Sprinkler at Front Yard on?" → reports watering status
- Works with Gen3 Echo devices (port 80)
- Web UI continues to function normally on port 80
- WebSocket real-time updates still work

### Verification:
- Firmware compiles without errors
- "Alexa, discover devices" finds system device + all named zones
- System device controls enable/disable scheduling
- Zone devices control individual zones
- Web UI loads and functions normally
- Zone state syncs between Alexa commands and web UI

## What We're NOT Doing

- Brightness/percentage control (duration via voice)
- Schedule management via Alexa
- Multi-zone group commands
- Alexa routines integration
- Automatic device re-discovery on zone rename
- Modifying FauxmoESP library source code

## Implementation Approach

Use FauxmoESP's existing external server mode to share port 80 with AsyncWebServer. Add a zone iterator method to SprinklerSettings to register each zone as an Alexa device. Maintain a device-to-zone mapping array to translate FauxmoESP's 0-based device IDs to 1-based zone IDs.

---

## Phase 1: Add Zone Iterator to SprinklerSettings

### Overview
Add a public method to iterate over configured zones without exposing the private `zones` map directly.

### Changes Required:

#### 1. SprinklerSettings class
**File**: `arduino/sprinkler-settings.h`
**Changes**: Add `forEachZone()` template method to public section

```cpp
// Add after line 109 (after attach() method), before "private:":

  // Iterator for external access to zones
  template<typename F>
  void forEachZone(F callback) const {
    for (const auto &kv : zones) {
      callback(kv.first, kv.second);
    }
  }

  // Get zone count
  size_t zoneCount() const {
    return zones.size();
  }
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles: `arduino-cli compile --fqbn esp32:esp32:esp32wrover arduino --output-dir .bin`
- [x] No compiler warnings about new methods

#### Manual Verification:
- [x] None required for this phase

**Implementation Note**: This is a low-risk additive change. Proceed to Phase 2 after automated verification passes.

---

## Phase 2: Rewrite sprinkler-alexa.h

### Overview
Complete rewrite of the Alexa integration module to support:
1. **System device** (device_id 0) - enables/disables scheduling
2. **Zone devices** (device_id 1+) - controls individual zones

### Changes Required:

#### 1. Complete rewrite of sprinkler-alexa.h
**File**: `arduino/sprinkler-alexa.h`
**Changes**: Replace entire file content

```cpp
#ifndef SPRINKLER_ALEXA_H
#define SPRINKLER_ALEXA_H

#include <WsConsole.h>
#include <fauxmoESP.h>

#include "sprinkler.h"
#include "html/settings.json.h"

static WsConsole alexa_console("alxa");

// FauxmoESP instance (unique_ptr for lazy initialization)
std::unique_ptr<fauxmoESP> fauxmo;

// Device ID to Zone ID mapping
// device_id 0 = system device (enable/disable), zone_id = 0
// device_id 1+ = zone devices, zone_id = 1-6
// Index = FauxmoESP device_id, Value = Sprinkler zone_id (0 = system)
static unsigned int deviceToZone[SKETCH_MAX_ZONES + 1];  // +1 for system device
static unsigned int registeredDevices = 0;

// Special zone ID for system device
#define ALEXA_SYSTEM_DEVICE 0

// Forward declaration for HTTP integration
bool processAlexaRequest(AsyncClient *client, bool isGet, String url, String body);

void handleAlexa() {
  if (fauxmo && (WiFi.getMode() & WIFI_STA)) {
    fauxmo->handle();
  }
}

void setupAlexa() {
  if (!(WiFi.getMode() & WIFI_STA)) {
    alexa_console.println("Skipped (not in STA mode)");
    return;
  }

  fauxmo.reset(new fauxmoESP());

  // Configure for external server mode (share port 80 with AsyncWebServer)
  // This MUST be done before enable()
  fauxmo->createServer(false);
  fauxmo->setPort(80);

  // Get system display name for device naming
  String systemName = Sprinkler.dispname();
  if (systemName.length() == 0) {
    systemName = "Sprinkler";
  }

  registeredDevices = 0;

  // Register SYSTEM device first (device_id 0)
  // This controls enable/disable of all scheduling
  {
    unsigned char deviceId = fauxmo->addDevice(systemName.c_str());
    deviceToZone[deviceId] = ALEXA_SYSTEM_DEVICE;
    registeredDevices++;
    alexa_console.printf("Registered: %s (device=%d, SYSTEM)\n",
                         systemName.c_str(), deviceId);
  }

  // Register each configured zone as an Alexa device (device_id 1+)
  Sprinkler.Settings.forEachZone([&systemName](unsigned int zoneId, SprinklerZone* zone) {
    if (zone->name().length() > 0 && registeredDevices < (SKETCH_MAX_ZONES + 1)) {
      // Format: "<system_name> at <zone_name>"
      String deviceName = systemName + " at " + zone->name();

      unsigned char deviceId = fauxmo->addDevice(deviceName.c_str());
      deviceToZone[deviceId] = zoneId;
      registeredDevices++;

      alexa_console.printf("Registered: %s (device=%d, zone=%d)\n",
                           deviceName.c_str(), deviceId, zoneId);
    }
  });

  // Handle Alexa "turn on/off" commands
  fauxmo->onSet([](unsigned char device_id, const char *device_name, bool state, unsigned char value) {
    if (device_id >= registeredDevices) {
      alexa_console.printf("Invalid device_id: %d\n", device_id);
      return;
    }

    unsigned int zoneId = deviceToZone[device_id];

    if (zoneId == ALEXA_SYSTEM_DEVICE) {
      // System device: enable/disable scheduling
      alexa_console.printf("Set: %s (SYSTEM) -> %s\n",
                           device_name, state ? "ENABLED" : "DISABLED");
      if (state) {
        Sprinkler.enable();
      } else {
        Sprinkler.disable();  // This also stops all active zones
      }
    } else {
      // Zone device: start/stop watering
      alexa_console.printf("Set: %s (zone=%d) -> %s\n",
                           device_name, zoneId, state ? "ON" : "OFF");
      if (state) {
        Sprinkler.start(zoneId, SKETCH_TIMER_DEFAULT_LIMIT);
      } else {
        Sprinkler.stop(zoneId);
      }
    }
  });

  // Handle Alexa "is X on?" queries
  fauxmo->onGet([](unsigned char device_id, const char *device_name, bool &state, unsigned char &value) {
    if (device_id >= registeredDevices) {
      state = false;
      value = 0;
      return;
    }

    unsigned int zoneId = deviceToZone[device_id];

    if (zoneId == ALEXA_SYSTEM_DEVICE) {
      // System device: report if scheduling is enabled
      state = Sprinkler.isEnabled();
      value = state ? 255 : 0;
      alexa_console.printf("Get: %s (SYSTEM) -> %s\n",
                           device_name, state ? "ENABLED" : "DISABLED");
    } else {
      // Zone device: report if zone is watering
      state = Sprinkler.Timers.isWatering(zoneId);
      value = state ? 255 : 0;
      alexa_console.printf("Get: %s (zone=%d) -> %s\n",
                           device_name, zoneId, state ? "ON" : "OFF");
    }
  });

  // Enable FauxmoESP (starts UDP listener for SSDP discovery)
  fauxmo->enable(true);

  alexa_console.printf("Started (%d devices: 1 system + %d zones)\n",
                       registeredDevices, registeredDevices - 1);
}

// Process Alexa HTTP requests (called from sprinkler-http.h)
bool processAlexaRequest(AsyncClient *client, bool isGet, String url, String body) {
  if (fauxmo) {
    return fauxmo->process(client, isGet, url, body);
  }
  return false;
}

#endif
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles: `arduino-cli compile --fqbn esp32:esp32:esp32wrover arduino --output-dir .bin`
- [x] No compiler warnings

#### Manual Verification:
- [x] None required for this phase (HTTP integration not yet connected)

**Implementation Note**: The `processAlexaRequest()` function is defined but not yet called. Proceed to Phase 3 to connect it.

---

## Phase 3: Integrate with AsyncWebServer

### Overview
Add HTTP request routing to forward Alexa requests from AsyncWebServer to FauxmoESP.

### Changes Required:

#### 1. Add Alexa request handlers to setupHttp()
**File**: `arduino/sprinkler-http.h`
**Changes**:
- Add forward declaration at top
- Add `onRequestBody` handler
- Modify `onNotFound` handler

**Change 1**: Add forward declaration after includes (around line 17):

```cpp
// After line 16: #include "sprinkler.h"
// Add:
// Forward declaration for Alexa integration
bool processAlexaRequest(AsyncClient *client, bool isGet, String url, String body);
```

**Change 2**: Add `onRequestBody` handler before `http.begin()` (before line 273):

```cpp
// Add before line 273 (before http.begin();):

  // Alexa request routing - handle POST bodies for Hue API
  http.onRequestBody([](AsyncWebServerRequest *request, uint8_t *data,
                        size_t len, size_t index, size_t total) {
    // Try to process as Alexa request
    if (processAlexaRequest(request->client(),
                            request->method() == HTTP_GET,
                            request->url(),
                            String((char *)data))) {
      return;  // Alexa handled it
    }
    // Not an Alexa request - let other handlers process it
  });
```

**Change 3**: Modify `onNotFound` handler (lines 237-247):

Replace the existing `onNotFound` handler:

```cpp
  http.onNotFound([&](AsyncWebServerRequest *request) {
    // First, try to handle as Alexa request (for GET requests like /description.xml)
    String body = request->hasParam("body", true)
                  ? request->getParam("body", true)->value()
                  : String();
    if (processAlexaRequest(request->client(),
                            request->method() == HTTP_GET,
                            request->url(),
                            body)) {
      return;  // Alexa handled it
    }

    // Not an Alexa request - handle as 404
    console.println("(404): " + request->url());
    if (!captivePortal(request)) {
      AsyncResponseStream *response = request->beginResponseStream("text/html");
      response->print("<!DOCTYPE html><html><head><title>URI Not Found</title></head><body>");
      response->printf("<p>You were trying to reach: http://%s%s</p>", request->host().c_str(), request->url().c_str());
      response->printf("<p>Try opening <a href='http://%s'>this link</a> instead</p>", WiFi.softAPIP().toString().c_str());
      response->print("</body></html>");
      request->send(response);
    }
  });
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles: `arduino-cli compile --fqbn esp32:esp32:esp32wrover arduino --output-dir .bin`
- [x] No compiler warnings

#### Manual Verification:
- [ ] Upload firmware to ESP32
- [ ] Web UI loads at device IP address
- [ ] WebSocket connection works (real-time updates)
- [ ] "Alexa, discover devices" finds all configured zones with names
- [ ] Device names appear as "<system_name> at <zone_name>" in Alexa app

**Implementation Note**: After completing this phase and automated verification passes, pause here for manual confirmation that Alexa device discovery works before proceeding to Phase 4.

---

## Phase 4: End-to-End Testing

### Overview
Comprehensive testing of all Alexa voice commands and verification that existing functionality is preserved.

### Test Cases:

#### System Device Tests:
- [ ] "Alexa, turn on <system>" - Enables scheduling
- [ ] "Alexa, turn off <system>" - Disables scheduling and stops all zones
- [ ] "Alexa, is <system> on?" - Reports if scheduling is enabled
- [ ] Verify system device state matches web UI enable/disable button

#### Zone Device Tests:
- [ ] "Alexa, turn on <system> at <zone>" - Zone starts watering for 15 min
- [ ] "Alexa, turn off <system> at <zone>" - Zone stops watering
- [ ] "Alexa, is <system> at <zone> on?" - Reports correct watering status
- [ ] Test with multiple zones simultaneously

#### Web UI Coexistence Tests:
- [ ] Web UI loads normally at device IP
- [ ] Zone control works from web UI
- [ ] Enable/disable button works from web UI
- [ ] WebSocket updates work (zone timer countdown)
- [ ] Settings page loads and saves correctly

#### State Synchronization Tests:
- [ ] Enable via Alexa, verify web UI shows enabled
- [ ] Disable via web UI, verify Alexa reports "off"
- [ ] Start zone via Alexa, verify web UI shows running
- [ ] Stop zone via web UI, verify Alexa reports "off"
- [ ] Start zone via web UI, verify Alexa reports "on"

#### Edge Case Tests:
- [ ] Zone with empty name - should NOT appear in Alexa
- [ ] System with no display name - should use "Sprinkler" as fallback
- [ ] Multiple zones with same name - both should be controllable (different device IDs)
- [ ] Disable system while zone is running - zone should stop

### Success Criteria:

#### Manual Verification:
- [ ] All voice command tests pass
- [ ] All web UI coexistence tests pass
- [ ] All state synchronization tests pass
- [ ] All edge case tests pass
- [ ] No regressions in existing functionality

---

## Testing Strategy

### Unit Tests:
- Zone iterator returns all configured zones
- Device-to-zone mapping is correct for all registered devices
- Empty zone names are skipped during registration

### Integration Tests:
- FauxmoESP discovers all zone devices via SSDP
- Web UI routes take priority over Alexa routes
- WebSocket connections work alongside Alexa HTTP handlers

### Manual Testing Steps:
1. Flash firmware to ESP32
2. Connect to WiFi
3. Open Alexa app → Devices → Add Device → Other
4. Say "Alexa, discover devices"
5. Verify devices appear:
   - System device: `"<system_name>"` (e.g., "Sprinkler")
   - Zone devices: `"<system_name> at <zone_name>"` (e.g., "Sprinkler at Front Yard")
6. Test system device: enable, disable, status query
7. Test each zone: turn on, turn off, status query
8. Open web UI and verify it still works
9. Test cross-control (Alexa enable/disable, web UI button, etc.)

## Performance Considerations

- **Memory**: Device-to-zone mapping uses 28 bytes (7 × 4 bytes: 1 system + 6 zones) - negligible
- **Latency**: Alexa requests processed in existing AsyncWebServer event loop - no additional latency
- **UDP polling**: `fauxmo->handle()` already called in main loop - no change needed

## Migration Notes

- No EEPROM changes required
- No configuration migration needed
- Users must run "Alexa, discover devices" after firmware update
- If zone names change, users must re-discover devices

## References

- Solutions document: `.claude/thoughts/shared/solutions/2025-12-22_alexa-per-zone-integration.md`
- FauxmoESP external server example: `arduino/libraries/FauxmoESP/examples/fauxmoESP_External_Server/fauxmoESP_External_Server.ino`
- Zone iteration pattern: `arduino/sprinkler-settings.cpp:79-84`
- Zone start/stop: `arduino/sprinkler.cpp:54-76`
