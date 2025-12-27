---
date: 2025-12-27T12:20:24-0500
researcher: Claude
git_commit: 949434949cb7c2b909a02383967556c4b49ad940
branch: master
repository: sprinkler_v3
topic: "FauxmoESP Alexa+ Discovery - Final Fix"
tags: [alexa, fauxmoesp, ssdp, hue-emulation, esp32, async-udp]
status: complete
last_updated: 2025-12-27
last_updated_by: Claude
type: implementation_strategy
---

# Handoff: Alexa+ Discovery Fix for FauxmoESP - Final Solution

## Task(s)
**COMPLETED**: Fix Alexa+ (new Alexa) discovery of ESP32 sprinkler controller's FauxmoESP-based Hue emulation.

### Problem
- Node-RED virtual Alexa devices on the network were being discovered by new Alexa+
- Tasmota Hue emulation devices were being discovered
- FauxmoESP sprinkler devices were NOT being discovered
- Alexa was receiving SSDP responses but never making HTTP follow-up requests

### Final Root Cause
Two issues needed fixing:
1. **Missing SSDP NOTIFY advertisements** - Node-RED broadcasts presence periodically, FauxmoESP only responded to M-SEARCH
2. **Blocking delays in async code** - `delay(50)` blocked the ESP32's async UDP handling, preventing proper response delivery

### Solution Implemented
- Added periodic SSDP NOTIFY advertisement (every 10 seconds for 3 minutes after M-SEARCH received)
- Replaced `delay(50)` with `yield()` for non-blocking async UDP handling
- Added `/api` endpoint returning auth success like Tasmota
- Added HOST header to SSDP responses

**Result**: All 6 sprinkler zones discovered and working in Alexa app.

### What Doesn't Matter (tested and confirmed)
- **UUID format**: Philips format `2f402f80-da50-11e1-9b23-` works fine (no need for Node-RED's format)
- **modelNumber**: Original `929000226503` works fine (no need for `1000000000000`)

## Critical References
- `CLAUDE.md` - Project overview and build commands
- `.claude/thoughts/shared/handoffs/general/2025-12-27_07-42-31_alexa-fauxmoesp-discovery-fix.md` - Earlier handoff with initial debugging

## Recent changes

### arduino/libraries/FauxmoESP/src/fauxmoESP.cpp
- Added `_sendSSDPNotify()` function (lines ~132-223) - broadcasts 3 NOTIFY packets to multicast group
- Modified `handle()` function to call `_sendSSDPNotify()` every 10 seconds for 3 minutes after M-SEARCH
- **Critical fix**: Changed `delay(50)` to `yield()` in `_sendUDPResponse()` for non-blocking async
- Added `/api` endpoint handler returning auth success JSON
- Set `_lastMSearch` timestamp when M-SEARCH received

### arduino/libraries/FauxmoESP/src/fauxmoESP.h
- Added `_sendSSDPNotify()` declaration (line 136)
- Added `_lastNotify` timer variable (line 137)
- Added `_lastMSearch` timer variable (line 138)

### arduino/libraries/FauxmoESP/src/templates.h
- Added 3 SSDP NOTIFY templates: `FAUXMO_NOTIFY_TEMPLATE_ROOT`, `FAUXMO_NOTIFY_TEMPLATE_BASIC`, `FAUXMO_NOTIFY_TEMPLATE_UUID`
- Added HOST header to all SSDP response templates
- Changed SERVER string to match Tasmota: `Linux/3.14.0 UPnP/1.0 IpBridge/1.24.0`

### arduino/sprinkler-http.h
- Added Alexa request routing in `onNotFound` handler
- Added `onRequestBody` handler for POST requests

## Learnings

1. **`yield()` vs `delay()` with AsyncUDP**: When using ESP32's AsyncUDP, using `delay()` between packet sends blocks the async event loop. Using `yield()` allows proper async processing. This was the critical fix.

2. **SSDP NOTIFY timing**: Broadcasting for 3 minutes after M-SEARCH is sufficient. No need for continuous broadcasting.

3. **New Alexa+ is NOT more strict about Hue emulation format**: Initial hypothesis that Alexa+ rejects certain UUID formats or modelNumbers was wrong. The real issue was async blocking.

4. **Debugging approach**: Created `tools/alexa_capture.py` for comparing SSDP responses - useful but the real issue was in async handling, not packet content.

## Artifacts
- `arduino/libraries/FauxmoESP/src/templates.h` - Updated SSDP templates
- `arduino/libraries/FauxmoESP/src/fauxmoESP.cpp` - NOTIFY implementation and yield() fix
- `arduino/libraries/FauxmoESP/src/fauxmoESP.h` - Updated header
- `arduino/sprinkler-http.h` - Alexa HTTP routing
- `tools/alexa_capture.py` - SSDP debugging/comparison tool

## Action Items & Next Steps
1. **Commit changes** - The FauxmoESP library changes are uncommitted
2. **Consider upstreaming** - The `yield()` fix could benefit other FauxmoESP users with ESP32 + new Alexa+
3. **Test voice control** - Verify "Alexa, turn on Sprinkler" and zone commands work correctly

## Other Notes

### Build Commands
```bash
deno task build              # Build web UI
deno task compile            # Compile firmware (or: tools/arduino-cli compile ...)
deno run --allow-read --allow-run upload.ts 192.168.0.120  # Upload to device
```

### Debug Commands
```bash
# Monitor serial output
tools/arduino-cli.exe monitor -p COM6 -c baudrate=115200

# Test SSDP discovery
python tools/alexa_capture.py --timeout 15

# Test lights API
python tools/alexa_capture.py --lights 192.168.0.120:80
```

### Network Devices
- `192.168.0.120` - ESP32 Sprinkler (FauxmoESP)
- `192.168.0.3` - Node-RED (reference implementation)
- `192.168.0.225` - Tasmota (reference implementation)
- `192.168.0.247`, `192.168.0.248` - Alexa Echo devices

### Key Code Pattern (the fix)
```cpp
// In _sendUDPResponse() - WRONG:
delay(50);  // Blocks async event loop

// CORRECT:
yield();    // Allows async processing between packets
```
