---
date: 2025-12-27T07:42:31-05:00
researcher: Claude
git_commit: 949434949cb7c2b909a02383967556c4b49ad940
branch: master
repository: sprinkler_v3
topic: "FauxmoESP Alexa+ Discovery Fix"
tags: [alexa, fauxmoesp, ssdp, hue-emulation, esp32]
status: complete
last_updated: 2025-12-27
last_updated_by: Claude
type: implementation_strategy
---

# Handoff: Alexa+ Discovery Fix for FauxmoESP

## Task(s)
**COMPLETED**: Fix Alexa+ (new Alexa) discovery of ESP32 sprinkler controller's FauxmoESP-based Hue emulation.

### Problem
- Node-RED virtual Alexa devices on the network were being discovered by new Alexa+
- Tasmota Hue emulation devices were being discovered
- FauxmoESP sprinkler devices were NOT being discovered
- Alexa was receiving SSDP responses but never making HTTP follow-up requests

### Root Causes Identified & Fixed
1. **Missing SSDP NOTIFY advertisements** - Node-RED broadcasts presence every ~10 seconds, FauxmoESP only responded to M-SEARCH
2. **UUID format rejection** - New Alexa+ appears to reject the Philips Hue UUID prefix `2f402f80-da50-11e1-9b23-`, but accepts Node-RED's generic prefix `00112233-4455-6677-8899-`

### Solution Implemented
- Added periodic SSDP NOTIFY advertisement (every 10 seconds)
- Changed UUID prefix from Philips Hue pattern to Node-RED pattern
- Added HOST header to SSDP responses
- Sends 3 SSDP response packets like Tasmota (rootdevice, uuid, device:basic:1)

**Result**: All 6 sprinkler zones now appear in Alexa app.

## Critical References
- `CLAUDE.md` - Project overview and build commands
- `.claude/thoughts/shared/plans/2025-12-26-alexa-fix-checklist.md` - Initial debugging checklist

## Recent changes

### arduino/libraries/FauxmoESP/src/templates.h
- Changed UUID prefix from `2f402f80-da50-11e1-9b23-` to `00112233-4455-6677-8899-` (all occurrences)
- Added 3 SSDP NOTIFY templates: `FAUXMO_NOTIFY_TEMPLATE_ROOT`, `FAUXMO_NOTIFY_TEMPLATE_BASIC`, `FAUXMO_NOTIFY_TEMPLATE_UUID`
- Added HOST header to all SSDP response templates
- Changed SERVER string to match Tasmota: `Linux/3.14.0 UPnP/1.0 IpBridge/1.24.0`

### arduino/libraries/FauxmoESP/src/fauxmoESP.cpp
- Added `_sendSSDPNotify()` function (lines 132-223) - broadcasts 3 NOTIFY packets to multicast group
- Modified `handle()` function (lines 610-621) to call `_sendSSDPNotify()` every 10 seconds
- Modified `_sendUDPResponse()` to send 3 packets instead of 1 (lines 36-130)

### arduino/libraries/FauxmoESP/src/fauxmoESP.h
- Added `_sendSSDPNotify()` declaration (line 136)
- Added `_lastNotify` timer variable (line 137)

### arduino/sprinkler-http.h
- Added Alexa request routing in `onNotFound` handler
- Added `onRequestBody` handler for POST requests

## Learnings

1. **New Alexa+ filters fake Hue bridges**: The new Alexa+ appears to recognize and reject devices using the standard Philips Hue UUID prefix `2f402f80-da50-11e1-9b23-`. Using a generic UUID prefix like Node-RED's `00112233-4455-6677-8899-` works.

2. **SSDP NOTIFY is important**: Passive SSDP responses to M-SEARCH alone may not be sufficient. Active NOTIFY advertisements help Alexa discover devices.

3. **Debugging SSDP**: Created `tools/alexa_capture.py` for comparing SSDP responses between working (Node-RED, Tasmota) and non-working (FauxmoESP) implementations.

4. **Key differences between Node-RED and original FauxmoESP**:
   - Node-RED uses generic UUID, FauxmoESP used Philips UUID
   - Node-RED sends NOTIFY advertisements, FauxmoESP didn't
   - Node-RED uses hex string device IDs in lights API, FauxmoESP uses numeric

## Artifacts
- `arduino/libraries/FauxmoESP/src/templates.h` - Updated SSDP templates
- `arduino/libraries/FauxmoESP/src/fauxmoESP.cpp` - NOTIFY advertisement implementation
- `arduino/libraries/FauxmoESP/src/fauxmoESP.h` - Updated header
- `arduino/sprinkler-http.h` - Alexa HTTP routing
- `tools/alexa_capture.py` - SSDP debugging/comparison tool

## Action Items & Next Steps
1. **Test voice control** - Verify "Alexa, turn on Sprinkler" and zone commands work
2. **Commit changes** - The FauxmoESP library changes are uncommitted
3. **Consider upstreaming** - These fixes could benefit other FauxmoESP users having issues with new Alexa+

## Other Notes

### Build Commands
```bash
deno task build              # Build web UI
deno task compile            # Compile firmware
deno run --allow-read --allow-run upload.ts 192.168.0.120  # Upload to device
```

### Useful Debug Commands
```bash
# Monitor serial output
tools/arduino-cli.exe monitor -p COM6 -c baudrate=115200

# Test SSDP discovery
python tools/alexa_capture.py --timeout 15

# Compare description.xml
python tools/alexa_capture.py --compare-xml 192.168.0.3:80 192.168.0.120:80

# Test lights API
python tools/alexa_capture.py --lights 192.168.0.120:80
```

### Network Devices Referenced
- `192.168.0.120` - ESP32 Sprinkler (FauxmoESP)
- `192.168.0.3` - Node-RED (working reference)
- `192.168.0.225` - Tasmota (working reference)
- `192.168.0.247`, `192.168.0.248` - Alexa Echo devices
