# Alexa Fix Implementation Checklist

**Date**: 2025-12-26
**Status**: Ready to implement
**Based on**: Capture tool comparison with working Node-RED implementation

## Problem Summary

The ESP32 sprinkler at 192.168.0.120:
1. **Does NOT respond to SSDP M-SEARCH** - Not appearing in device discovery
2. **Returns gzipped 404 for `/description.xml`** - FauxmoESP not handling HTTP requests

## Root Cause

`sprinkler-http.h` has the forward declaration for `processAlexaRequest()` but **never calls it**.
The `onNotFound` handler returns a 404 page instead of forwarding to FauxmoESP.

## Current State

| Component | Status | Notes |
|-----------|--------|-------|
| `sprinkler-alexa.h` | ✅ Complete | External server mode, per-zone devices, onSet/onGet handlers |
| `sprinkler-settings.h` | ✅ Complete | Has `forEachZone()` method |
| `sprinkler-http.h` | ❌ Missing routing | Has forward declaration but no actual routing |

---

## Implementation Checklist

### Change 1: Modify `onNotFound` handler in sprinkler-http.h

**Location**: Lines 240-250

**Current code**:
```cpp
http.onNotFound([&](AsyncWebServerRequest *request) {
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

**New code**:
```cpp
http.onNotFound([&](AsyncWebServerRequest *request) {
  // Try Alexa/Hue request first (for GET requests like /description.xml)
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

---

### Change 2: Add `onRequestBody` handler for POST requests

**Location**: Add before `http.begin();` (around line 276)

**New code to add**:
```cpp
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

---

## Verification Steps

### After implementing changes:

1. **Build firmware**:
   ```bash
   deno task build
   arduino-cli compile --config-file arduino/arduino-cli.yaml --fqbn esp32:esp32:esp32wrover --output-dir .bin arduino/arduino.ino
   ```

2. **Flash to device** and reboot

3. **Test SSDP response**:
   ```bash
   python tools/alexa_capture.py --timeout 10
   ```
   - Should see response from 192.168.0.120 with `hue-bridgeid` header

4. **Test description.xml**:
   ```bash
   python tools/alexa_capture.py --fetch 192.168.0.120:80
   ```
   - Should return XML (not gzipped 404)

5. **Test lights API**:
   ```bash
   python tools/alexa_capture.py --lights 192.168.0.120:80
   ```
   - Should return JSON with registered devices

6. **Alexa discovery**:
   - Say "Alexa, discover devices"
   - Check Alexa app for new devices

---

## If Discovery Still Fails

### Phase 2: Enhance FauxmoESP device JSON

Based on comparison with working Node-RED implementation:

| Field | Node-RED (works) | FauxmoESP (current) | Change? |
|-------|------------------|---------------------|---------|
| `certified` | `true` | `false` | Try `true` |
| `modelid` | `LCT007` | `LCT015` | Try `LCT007` |
| `capabilities` | Full | Minimal | Add more |

**File**: `arduino/libraries/FauxmoESP/src/templates.h`

Changes to `FAUXMO_DEVICE_JSON_TEMPLATE`:
1. Change `"certified": false` to `"certified": true`
2. Change `"modelid": "LCT015"` to `"modelid": "LCT007"`

---

## References

- Original plan: `.claude/thoughts/shared/plans/2025-12-22-alexa-per-zone-integration.md`
- Capture tool: `tools/alexa_capture.py`
- Working example: Node-RED at 192.168.0.3:80
