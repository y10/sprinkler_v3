---
date: 2025-12-23T20:00:00-05:00
researcher: Claude Code
git_commit: 2a594c8
branch: master
repository: sprinkler_v3
topic: "Alexa Hue Emulation Discovery Issues"
tags: [research, alexa, fauxmoesp, ssdp, hue-emulation, alexa-plus]
status: complete
last_updated: 2025-12-23
last_updated_by: Claude Code
---

# Research: Alexa Hue Emulation Discovery Issues

**Date**: 2025-12-23
**Researcher**: Claude Code
**Git Commit**: 2a594c8
**Branch**: master
**Repository**: sprinkler_v3

## Research Question

Why does Alexa not discover our FauxmoESP device despite SSDP responses matching Tasmota exactly?

## Summary

After extensive debugging, our SSDP implementation now matches Tasmota byte-for-byte, but Alexa still doesn't discover the device. Research points to two potential causes:

1. **Alexa+ Early Access** - Known to break smart home device discovery
2. **Device/Bridge ID Caching** - Alexa caches devices by MAC/bridgeid

## Key Findings

### 1. Alexa+ Early Access Problems

**Source**: [Home Assistant Community](https://community.home-assistant.io/t/alexa-early-access-is-a-fail-in-our-smart-home/905809)

- Users report devices that "worked hundreds of times before" getting "I'm sorry, there is no device named..." errors after Alexa+ upgrade
- Commands for existing devices stopped working
- **Solution**: Revert to original Alexa version restored functionality immediately
- Local Hue emulation not specifically discussed, but cloud-based integrations affected

### 2. Device ID/MAC Caching Conflicts

**Source**: [HA-Bridge Issue #1093](https://github.com/bwssytems/ha-bridge/issues/1093)

- Alexa caches device/bridge info based on MAC address and bridge ID
- ID conflicts occur when multiple bridges use same device ID numbering
- Bridge ID is derived from MAC address (`hue-bridgeid` header)
- If ESP32 was used before with different device names, Alexa may be confused
- **Solution**: Change bridge ID to start device IDs at 100+ to avoid conflicts

**Source**: [HA-Bridge Issue #1293](https://github.com/bwssytems/ha-bridge/issues/1293)

- "Its crucial elements are to first clear all devices from Alexa"
- "Enable 9 byte device identity numbers in the very latest version"
- Multiple discovery attempts may be needed
- Some Echo devices keep a "memory or queue of previously discovered devices"

### 3. Recent Hue Emulation Breakage (2024)

**Source**: [Tasmota Discussion #22227](https://github.com/arendst/Tasmota/discussions/22227)

- October 2024: User reported "several Tasmota 'hue' devices dropped by Alexa"
- Also affected: "all of my other devices that I exposed to Alexa via a custom 'hue emulator'"
- Suspected cause: "Amazon changed something in its HUE interface"

**Source**: [Home Assistant Issue #149898](https://github.com/home-assistant/core/issues/149898)

- Reports of emulated hue breaking with latest Alexa update
- Virtual lights used for Alexa-to-HA communication no longer working

### 4. Port and Network Requirements

- All new Alexa devices require `listen_port: 80` (Gen3+)
- Maximum 49 devices across all exposed domains
- SSDP multicast on 239.255.255.250:1900
- Bridge must respond to M-SEARCH with 3 packets (like Tasmota)

## Our Implementation Status

### What We Fixed

1. Added HOST header like Tasmota: `HOST: 239.255.255.250:1900`
2. Matched header order: HOST, CACHE-CONTROL, EXT, LOCATION, SERVER, etc.
3. Send 3 SSDP response packets (upnp:rootdevice, uuid, device:basic:1)
4. Using port 80 for HTTP (Gen3 requirement)
5. Bridge ID with FFFE insertion: `{MAC[0:6]}FFFE{MAC[6:12]}`
6. 300ms debounce like Tasmota to avoid duplicate responses
7. Using AsyncUDP.writeTo() for responses

### Verification

Python test confirms byte-identical responses to Tasmota:
- Response 1: 297 bytes (both)
- Response 2: 306 bytes (both)
- Response 3: 300 bytes (both)

### Current Behavior

- SSDP M-SEARCH received from Echo devices
- 3 SSDP responses sent successfully
- **NO HTTP follow-up** to `/description.xml` from Echo

## Potential Solutions

### Option 1: Change Bridge ID

Generate a completely different bridge ID (not MAC-based) to appear as a "new" bridge:

```cpp
// Instead of MAC-based:
// String bridgeid = macUpper.substring(0,6) + "FFFE" + macUpper.substring(6);

// Use random/fixed different ID:
String bridgeid = "AABBCCDDEEFF1234";  // Or generate unique
```

### Option 2: Clear Alexa Device Cache

1. Open Alexa app
2. Go to Devices -> All Devices
3. Delete ALL Hue/emulated devices
4. Unplug all Echo devices except one
5. Run discovery again

### Option 3: Opt Out of Alexa+ Early Access

If user is enrolled in Alexa+ Early Access:
1. Check Alexa app settings for Early Access options
2. Revert to standard Alexa
3. Retry discovery

### Option 4: Use SinricPro (Cloud-Based)

Skip local SSDP entirely, use cloud-based Alexa integration:
- Works with all Alexa versions including Alexa+
- Requires internet connection
- More reliable but adds latency

## Next Steps

1. Try changing bridge ID to non-MAC-based value
2. Clear all Hue devices from Alexa app
3. Test with single Echo device during discovery
4. If still failing, research SinricPro integration

## References

- [Home Assistant Emulated Hue Docs](https://www.home-assistant.io/integrations/emulated_hue/)
- [Tasmota Alexa Integration](https://tasmota.github.io/docs/Alexa/)
- [HA-Bridge Discovery Guide](http://sigmdel.ca/michel/ha/opi/ha-bridge_03_en.html)
- [DIY Smart Home Hub - Alexa Hue Fixes](https://www.diysmarthomehub.com/alexa-not-discovering-hue/)
