---
date: 2025-12-23T14:00:00-05:00
researcher: Claude Code
git_commit: 2a594c8
branch: master
repository: sprinkler_v3
topic: "Tasmota vs FauxmoESP Hue Emulation Comparison"
confidence: high
complexity: medium
status: ready
tags: [solutions, alexa, tasmota, fauxmoesp, ssdp, hue-emulation]
last_updated: 2025-12-23
last_updated_by: Claude Code
---

# Solution Analysis: Tasmota vs FauxmoESP Hue Emulation

**Date**: 2025-12-23
**Researcher**: Claude Code
**Git Commit**: 2a594c8
**Branch**: master
**Repository**: sprinkler_v3

## Research Question
Why do Tasmota devices get discovered by Alexa while FauxmoESP doesn't, on the same network?

## Summary
**Problem**: FauxmoESP SSDP responses are ignored by Alexa despite correct format
**Root Cause**: Tasmota sends 3 SSDP response packets, FauxmoESP sends only 1
**Recommended**: Modify FauxmoESP to send multiple SSDP responses like Tasmota
**Confidence**: High (based on Tasmota source code analysis)

## Critical Differences Found

### 1. SSDP Response Structure - MOST CRITICAL

**Tasmota sends 3 separate packets:**
```
Packet 1:
ST: upnp:rootdevice
USN: uuid:{uuid}::upnp:rootdevice

Packet 2:
ST: uuid:{uuid}
USN: uuid:{uuid}

Packet 3:
ST: urn:schemas-upnp-org:device:basic:1
USN: uuid:{uuid}
```

**FauxmoESP sends 1 packet:**
```
ST: upnp:rootdevice
USN: uuid:{uuid}::upnp:rootdevice
```

**Why this matters:** Different Echo generations search for different ST values. Tasmota covers all cases.

### 2. UniqueID Format

**Tasmota:**
```
78:e3:6d:09:1d:a4:00:11-01  (zero-padded: -01, -02, -03)
```

**FauxmoESP (our current fix):**
```
00:17:88:01:00:00:00:01-0b  (Philips OUI prefix)
```

Both should work, but Tasmota's simpler MAC-based format is proven.

### 3. Bridge ID Format

**Tasmota:**
```
5CCF7FFFFE139F3D  (MAC[0:6] + "FFFE" + MAC[6:12])
```

**FauxmoESP:**
```
30aea47af260  (just MAC, lowercase)
```

The `FFFE` insertion mimics real Philips Hue bridges.

### 4. SERVER Header Version

**Tasmota:**
```
SERVER: Linux/3.14.0 UPnP/1.0 IpBridge/1.24.0
```

**FauxmoESP:**
```
SERVER: FreeRTOS/6.0.5, UPnP/1.0, IpBridge/1.17.0
```

Newer IpBridge version (1.24.0) may matter for compatibility.

## Recommended Fix

Modify FauxmoESP to send **3 SSDP response packets** like Tasmota, each with different ST/USN values.

## Implementation

### Modified `_sendUDPResponse()` in fauxmoESP.cpp:

```cpp
void fauxmoESP::_sendUDPResponse(unsigned int mx) {
    // Small random delay
    unsigned int delayMs = random(50, 300);
    delay(delayMs);

    IPAddress ip = WiFi.localIP();
    String mac = WiFi.macAddress();
    mac.replace(":", "");
    mac.toUpperCase();

    // Create bridge ID with FFFE insertion (like Tasmota)
    String bridgeid = mac.substring(0,6) + "FFFE" + mac.substring(6);
    String serial = mac;
    serial.toLowerCase();

    // Send 3 responses like Tasmota does
    const char* st_values[] = {
        "upnp:rootdevice",
        "uuid:2f402f80-da50-11e1-9b23-%s",
        "urn:schemas-upnp-org:device:basic:1"
    };

    for (int i = 0; i < 3; i++) {
        // Build response for each ST type
        // ... send packet
        delay(50);  // Small delay between packets
    }
}
```

## References

- [Tasmota PR #11415 - Fix Alexa Discovery](https://github.com/arendst/Tasmota/pull/11415)
- [Tasmota xdrv_20_hue.ino](https://github.com/arendst/Tasmota/blob/development/tasmota/tasmota_xdrv_driver/xdrv_20_hue.ino)
- [FauxmoESP Issue #259 - Echo Spot 2024](https://github.com/vintlabs/fauxmoESP/issues/259)
