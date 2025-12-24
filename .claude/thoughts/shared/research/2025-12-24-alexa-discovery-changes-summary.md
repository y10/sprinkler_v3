---
date: 2025-12-24T01:00:00-05:00
researcher: Claude Code
git_commit: 2a594c8
branch: master
repository: sprinkler_v3
topic: "Alexa Discovery Debugging - Changes Summary"
tags: [research, alexa, fauxmoesp, ssdp, hue-emulation, debugging]
status: complete
last_updated: 2025-12-24
last_updated_by: Claude Code
---

# Alexa Discovery Debugging - Changes Summary

**Date**: 2025-12-24
**Researcher**: Claude Code
**Repository**: sprinkler_v3

## Summary

This document summarizes all changes made while debugging Alexa device discovery issues with FauxmoESP. Despite matching Tasmota's SSDP implementation exactly, Echo devices do not follow up with HTTP requests to `/description.xml`, suggesting the issue is on Alexa's side (likely Alexa+ Early Access blocking local Hue emulation).

## Problem Statement

Echo devices receive SSDP M-SEARCH responses but do not follow up with HTTP requests to `/description.xml`. Tasmota devices on the same network ARE discovered by Alexa, but our ESP32 with FauxmoESP is not.

## Changes Made to FauxmoESP Library

### 1. templates.h - Description Template (TO REVERT)

**File**: `arduino/libraries/FauxmoESP/src/templates.h`

Changed `FAUXMO_DESCRIPTION_TEMPLATE` to match Tasmota's format exactly:

```cpp
// BEFORE (original FauxmoESP)
PROGMEM const char FAUXMO_DESCRIPTION_TEMPLATE[] =
"<?xml version=\"1.0\" ?>"
"<root xmlns=\"urn:schemas-upnp-org:device-1-0\">"
    "<specVersion><major>1</major><minor>0</minor></specVersion>"
    "<URLBase>http://%d.%d.%d.%d:%d/</URLBase>"
    "<device>"
        "<deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>"
        "<friendlyName>Philips hue (%d.%d.%d.%d:%d)</friendlyName>"
        "<manufacturer>Royal Philips Electronics</manufacturer>"
        "<manufacturerURL>http://www.philips.com</manufacturerURL>"
        "<modelDescription>Philips hue Personal Wireless Lighting</modelDescription>"
        "<modelName>Philips hue bridge 2012</modelName>"
        "<modelNumber>929000226503</modelNumber>"
        "<modelURL>http://www.meethue.com</modelURL>"
        "<serialNumber>%s</serialNumber>"
        "<UDN>uuid:2f402f80-da50-11e1-9b23-%s</UDN>"
        "<presentationURL>index.html</presentationURL>"
    "</device>"
"</root>";

// AFTER (matching Tasmota)
PROGMEM const char FAUXMO_DESCRIPTION_TEMPLATE[] =
"<root xmlns=\"urn:schemas-upnp-org:device-1-0\">"
    "<specVersion><major>1</major><minor>0</minor></specVersion>"
    "<URLBase>http://%d.%d.%d.%d:%d/</URLBase>"
    "<device>"
        "<deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>"
        "<friendlyName>Amazon-Echo-HA-Bridge (%d.%d.%d.%d)</friendlyName>"
        "<manufacturer>Royal Philips Electronics</manufacturer>"
        "<manufacturerURL>http://www.philips.com</manufacturerURL>"
        "<modelDescription>Philips hue Personal Wireless Lighting</modelDescription>"
        "<modelName>Philips hue bridge 2012</modelName>"
        "<modelNumber>929000226503</modelNumber>"
        "<serialNumber>%s</serialNumber>"
        "<UDN>uuid:f6543a06-da50-11ba-8d8f-%s</UDN>"
    "</device>"
"</root>";
```

**Key differences**:
- Removed `<?xml version="1.0" ?>` header
- Changed friendlyName to `Amazon-Echo-HA-Bridge (IP)` without port
- Removed `<modelURL>` tag
- Removed `<presentationURL>` tag
- Changed UDN uuid prefix

### 2. fauxmoESP.h - Header Changes (TO REVERT)

**File**: `arduino/libraries/FauxmoESP/src/fauxmoESP.h`

Added pending response queue structure and methods:

```cpp
// Added struct for pending SSDP responses
#define FAUXMO_MAX_PENDING_RESPONSES 4
typedef struct {
    IPAddress targetIP;
    uint16_t targetPort;
    uint32_t sendTime;  // When to send (millis())
    bool active;
} fauxmo_pending_response_t;

// Added to class private members:
fauxmo_pending_response_t _pendingResponses[FAUXMO_MAX_PENDING_RESPONSES];

// Added methods:
void _sendUDPResponseToTarget(IPAddress targetIP, uint16_t targetPort);
void _processPendingResponses();
```

### 3. fauxmoESP.cpp - Delayed Response System (TO REVERT)

**File**: `arduino/libraries/FauxmoESP/src/fauxmoESP.cpp`

Implemented delayed SSDP response queue (like Tasmota's random delay):

```cpp
// Added: Process pending responses in handle()
void fauxmoESP::_processPendingResponses() {
    uint32_t now = millis();
    for (int i = 0; i < FAUXMO_MAX_PENDING_RESPONSES; i++) {
        if (_pendingResponses[i].active && now >= _pendingResponses[i].sendTime) {
            _sendUDPResponseToTarget(_pendingResponses[i].targetIP,
                                      _pendingResponses[i].targetPort);
            _pendingResponses[i].active = false;
        }
    }
}

// Added: Actual response sending (extracted from _sendUDPResponse)
void fauxmoESP::_sendUDPResponseToTarget(IPAddress targetIP, uint16_t targetPort) {
    // Sends 3 SSDP response packets using WiFiUDP
    // ... (full implementation in source)
}

// Modified: _sendUDPResponse to queue instead of send immediately
void fauxmoESP::_sendUDPResponse(unsigned int mx) {
    // Per-IP debounce check
    for (int i = 0; i < FAUXMO_MAX_PENDING_RESPONSES; i++) {
        if (_pendingResponses[i].active &&
            _pendingResponses[i].targetIP == targetIP) {
            return;  // Already pending
        }
    }

    // Random delay 1500-2200ms (SSDP spec compliance)
    uint32_t delayMs = 1500 + (esp_random() % 700);

    // Queue response in empty slot
    // ... (full implementation in source)
}

// Modified: handle() to process pending responses
void fauxmoESP::handle() {
    if (_enabled) {
        _handleUDP();
#if defined(ESP32)
        _processPendingResponses();
#endif
    }
}
```

### 4. SSDP Response Headers (Modified in _sendUDPResponseToTarget)

Added HOST header and matched Tasmota's header order:

```
HTTP/1.1 200 OK
HOST: 239.255.255.250:1900    <- Added (like Tasmota)
CACHE-CONTROL: max-age=100
EXT:
LOCATION: http://IP:PORT/description.xml
SERVER: Linux/3.14.0 UPnP/1.0 IpBridge/1.24.0
hue-bridgeid: XXXXXXXXXXXX
ST: upnp:rootdevice
USN: uuid:xxx::upnp:rootdevice
```

## Changes Made to Sprinkler Code (TO KEEP)

### 1. sprinkler-alexa.h - Per-Zone Device Registration

**File**: `arduino/sprinkler-alexa.h`

Enhanced Alexa integration with per-zone device support:

- Added header guard
- Added debug logging
- Added device-to-zone mapping array
- Register system device + individual zone devices
- Handle on/off for zones (start/stop watering)
- Handle on/off for system (enable/disable scheduling)
- Added onGet callback for state queries
- External server mode (port 80) configuration

### 2. sprinkler-http.h - Alexa Request Routing

**File**: `arduino/sprinkler-http.h`

Added Alexa request routing to AsyncWebServer:

- Forward declaration of `processAlexaRequest()`
- Handle Alexa requests in `onNotFound` handler
- Handle Alexa POST bodies in `onRequestBody` handler

## Test Tools Created

### 1. tools/ssdp_test.py

Python script to send M-SEARCH and capture multicast SSDP responses.

### 2. tools/ssdp_echo_test.py

Python script that simulates Echo behavior - sends from port 50000 and listens for unicast responses.

## Research Documents Created

1. `.claude/thoughts/shared/research/2025-12-23-alexa-discovery-issues.md` - Initial research on Alexa+ Early Access issues
2. `.claude/thoughts/shared/research/2025-12-23-asyncudp-vs-wifiudp-ssdp.md` - Comparison of AsyncUDP vs WiFiUDP approaches

## Test Results

### What Works

- SSDP responses sent successfully to all Echo devices
- Response byte counts match Tasmota exactly (297, 306, 300 bytes)
- Random 1.5-2.2s delay before responding (SSDP spec compliant)
- Per-IP debounce prevents duplicate responses
- PC can fetch `/description.xml` successfully

### What Doesn't Work

- Echo devices DO NOT follow up with HTTP requests to `/description.xml`
- Alexa says "no new devices found" despite receiving valid SSDP responses

## Root Cause Analysis

Based on research, the issue is likely:

1. **Alexa+ Early Access** - User is enrolled, known to break local smart home discovery
2. **Cached Bridge Data** - Alexa may cache bridge IDs and ignore "new" bridges with same MAC
3. **Alexa-side Filtering** - Amazon may be filtering non-certified Hue bridges

## Recommendations

1. **Opt out of Alexa+ Early Access** - Check Alexa app settings
2. **Clear device cache** - Remove all Hue devices from Alexa app
3. **Consider SinricPro** - Cloud-based integration that bypasses local discovery

## Files to Revert

1. `arduino/libraries/FauxmoESP/src/templates.h` - Restore original description template
2. `arduino/libraries/FauxmoESP/src/fauxmoESP.h` - Remove pending response additions
3. `arduino/libraries/FauxmoESP/src/fauxmoESP.cpp` - Remove delayed response queue system

## Files to Keep

1. `arduino/sprinkler-alexa.h` - Per-zone device registration improvements
2. `arduino/sprinkler-http.h` - Alexa request routing
3. `tools/ssdp_test.py` - Useful debugging tool
4. `tools/ssdp_echo_test.py` - Useful debugging tool
5. Research documents in `.claude/thoughts/shared/research/`
