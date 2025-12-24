---
date: 2025-12-23T19:30:00-05:00
researcher: Claude Code
git_commit: 2a594c8
branch: master
repository: sprinkler_v3
topic: "AsyncUDP vs WiFiUDP for SSDP/Alexa Discovery"
tags: [research, asyncudp, wifiudp, ssdp, alexa, fauxmoesp, tasmota, esp32]
status: complete
last_updated: 2025-12-23
last_updated_by: Claude Code
---

# Research: AsyncUDP vs WiFiUDP for SSDP/Alexa Discovery

**Date**: 2025-12-23
**Researcher**: Claude Code
**Git Commit**: 2a594c8
**Branch**: master
**Repository**: sprinkler_v3

## Research Question

Why does our FauxmoESP implementation fail to be discovered by Alexa despite correct SSDP responses? Is AsyncUDP the problem, and should we switch to synchronous WiFiUDP like Tasmota uses?

## Summary

**Root Cause**: Our hybrid AsyncUDP (receive) + WiFiUDP (send) approach differs fundamentally from Tasmota's pure synchronous WiFiUDP implementation. Additionally, AsyncUDP has documented issues with buffer exhaustion, multicast handling, and reliability.

**Key Findings**:
1. Tasmota uses **synchronous WiFiUDP** (not AsyncUDP) with **synchronous ESP8266WebServer**
2. AsyncUDP has known bugs: buffer exhaustion after ~32 packets, multicast issues
3. Tasmota adds **random 1.5-2.2 second delay** before responding to M-SEARCH
4. Our per-IP debounce differs from Tasmota's global debounce
5. FauxmoESP library conflicts may exist with ESPAsyncWebServer

**Recommendation**: Switch to pure synchronous approach (WiFiUDP + WebServer) like Tasmota, OR consider SinricPro cloud integration.

---

## Detailed Findings

### 1. Tasmota's UDP Implementation

**Source**: [Tasmota GitHub - support_udp.ino](https://github.com/arendst/Tasmota/blob/development/tasmota/tasmota_support/support_udp.ino)

**UDP Library**: WiFiUDP (platform-native, synchronous)
```cpp
#include <WiFiHelper.h>
WiFiUDP PortUdp;  // UDP Syslog and Alexa
```

**Debounce Constants**:
```cpp
#define UDP_BUFFER_SIZE         120      // Max UDP buffer size
#define UDP_MSEARCH_DEBOUNCE    300      // Delay in ms before response

uint32_t udp_last_received = 0;          // Global timestamp
IPAddress udp_remote_ip;                 // Remote IP storage
uint16_t udp_remote_port;                // Remote port storage
```

**How Tasmota Debounce Works**:
```cpp
// In PollUdp() function
if (0 == udp_last_received) {
    udp_last_received = millis();  // Start timer on first M-SEARCH
}
// Response suppressed until 300ms elapses
if (TimeReached(udp_last_received + 300)) {
    udp_last_received = 0;  // Reset timer
    // Call HueRespondToMSearch() or WemoRespondToMSearch()
}
```

**Critical Difference - Random Delay**:
Tasmota adds a randomized delay before responding:
```cpp
UDP_MSEARCH_SEND_DELAY + ((millis() & 0x7) * 100)
// Results in 1500-2200 msec random delay before first response
```

This is **required by SSDP specification** to prevent response collision when multiple devices respond simultaneously.

**Web Server**: Synchronous ESP8266WebServer (NOT AsyncWebServer)
```cpp
ESP8266WebServer *WebServer;
WebServer = new ESP8266WebServer(80);
```

**Sending Responses** (xdrv_20_hue.ino):
```cpp
void HueRespondToMSearch(void) {
  if (PortUdp.beginPacket(udp_remote_ip, udp_remote_port)) {
    // Send 3 packets back-to-back with no delays between them
    PortUdp.write((const uint8_t*)response, strlen(response));
    PortUdp.endPacket();
    // ... repeat for packets 2 and 3
  }
}
```

---

### 2. AsyncUDP Known Issues on ESP32

**Source**: [ESP32 Arduino GitHub Issues](https://github.com/espressif/arduino-esp32/issues)

#### Buffer Exhaustion (Critical)

**Issue**: [#3320 - AsyncUDP doesn't properly release resources](https://github.com/espressif/arduino-esp32/issues/3320)

After receiving ~32 UDP packets (matching `CONFIG_ESP32_WIFI_DYNAMIC_RX_BUFFER_NUM`), the ESP32 stops accepting new packets and never recovers.

**Root Cause**: Improper `pbuf` reference counting when callbacks use reference parameters.

**Workaround**:
```cpp
// Use pass-by-value in callback (not reference)
void onPacket(AsyncUDPPacket packet) {  // NOT AsyncUDPPacket&
    // handler code
}
```

#### writeTo() Returning 0 Bytes

The `writeTo()` function returns 0 in these scenarios:
1. PCB allocation failure (`udp_new()` fails)
2. pbuf allocation failure (`pbuf_alloc()` fails)
3. Send error (`_udp_sendto()` returns error)
4. Null data pointer

#### Multicast Problems

**Issue**: [#10758 - Missing TCPIP Lock](https://github.com/espressif/arduino-esp32/issues/10758)

- v3.1.0: **BROKEN** - crashes on multicast
- v3.0.6, v3.0.7: Works
- **v2.0.17**: Works (our version - safe)

**Issue**: [#7328 - listenMulticast interface binding](https://github.com/espressif/arduino-esp32/issues/7328)

In AP+STA mode, multicast packets received on both interfaces regardless of binding.

**Issue**: [#8652 - Cannot receive multicast](https://github.com/espressif/arduino-esp32/issues/8652)

Server sends but cannot receive multicast responses. Unicast works.

#### WiFi Power Save Delay

**Issue**: [#3816 - Receive delays](https://github.com/espressif/arduino-esp32/issues/3816)

10ms to 500ms delays when receiving packets due to WiFi power-saving mode.

**Solution**:
```cpp
WiFi.setSleep(false);  // Reduces latency to ~1ms
```

---

### 3. Our Current FauxmoESP Implementation

**Location**: `arduino/libraries/FauxmoESP/src/fauxmoESP.cpp`

**Hybrid Approach**:
- **AsyncUDP** for receiving multicast M-SEARCH (callback-based)
- **WiFiUDP** for sending unicast responses (temporary instance)

**Why Hybrid?** Comment at line 89:
> "Use WiFiUDP for sending - more reliable than AsyncUDP for unicast responses"

**Debounce Implementation** (lines 37-54):
```cpp
static IPAddress lastRespondedIP;
static unsigned long lastRespondTime = 0;

if (requesterIP == lastRespondedIP && (millis() - lastRespondTime) < 300) {
    // Skip duplicate
    return;
}
lastRespondedIP = requesterIP;
lastRespondTime = millis();
```

**Problems with Our Approach**:
1. Per-IP debounce, not global like Tasmota
2. **No random delay** before responding (SSDP spec requires this)
3. AsyncUDP buffer exhaustion risk
4. Mixing async/sync stacks may cause issues

---

### 4. Comparison: Tasmota vs Our Implementation

| Aspect | Tasmota | Our Implementation |
|--------|---------|-------------------|
| **UDP Receive** | WiFiUDP (polling) | AsyncUDP (callback) |
| **UDP Send** | WiFiUDP | WiFiUDP |
| **Web Server** | ESP8266WebServer (sync) | ESPAsyncWebServer |
| **Debounce Type** | Global | Per-IP |
| **Response Delay** | Random 1.5-2.2s | None (immediate) |
| **Buffer Management** | Manual, controlled | Automatic, may exhaust |

---

### 5. FauxmoESP Library Issues

**Source**: [vintlabs/fauxmoESP GitHub](https://github.com/vintlabs/fauxmoESP)

#### Echo 2024 Device Compatibility

**Issue**: [#259 - Fix for Amazon Echo Spot 2024](https://github.com/vintlabs/fauxmoESP/issues/259)

Newer Echo devices only use first N digits of uniqueid. Fix:
```cpp
// Original (broken with new Echos):
snprintf(device.uniqueid, ..., "%s:%s-%02X", mac.c_str(), "00:00", device_id);

// Fixed:
snprintf(device.uniqueid, ..., "%02X:%s:%s", device_id, mac.c_str(), "00:00");
```

#### ESPAsyncWebServer Conflicts

**Issue**: [AsyncTCP #94 - Lockup with AsyncUDP](https://github.com/me-no-dev/AsyncTCP/issues/94)

Using ESPAsyncWebServer alongside AsyncUDP for NTP/multicast causes network lockup. Interestingly, blocking WiFiUDP works fine alongside ESPAsyncWebServer.

---

### 6. Alternative: Espalexa Library

**Source**: [Aircoookie/Espalexa](https://github.com/Aircoookie/Espalexa)

- More recommended by community in 2024-2025
- Supports async mode: `#define ESPALEXA_ASYNC`
- Easier API
- Latest: v2.7.0 (March 2021)

**Warning**: "Do not use Espalexa in production! The API utilized is known to not be permanently stable."

---

## Potential Solutions

### Option 1: Switch to Pure Synchronous (Like Tasmota)

Replace ESPAsyncWebServer + AsyncUDP with sync equivalents:
- Use `ESP8266WebServer` for HTTP
- Use `WiFiUDP` for both receive and send
- Implement polling loop in `loop()`
- Add random delay before SSDP response

**Pros**:
- Matches working Tasmota implementation
- No async buffer issues
- Proven reliable

**Cons**:
- Major refactor of web server code
- Loses async benefits (WebSocket handling, concurrent requests)
- Breaks existing sprinkler web UI architecture

### Option 2: Fix AsyncUDP Issues

1. Add random delay (1.5-2.2s) before responding
2. Change debounce from per-IP to global
3. Add `WiFi.setSleep(false)`
4. Use pass-by-value for AsyncUDP callback
5. Monitor buffer exhaustion

**Pros**:
- Minimal code changes
- Keeps async architecture

**Cons**:
- May not fix fundamental AsyncUDP reliability issues
- Still mixing async/sync stacks

### Option 3: Use SinricPro Cloud Integration

Skip local SSDP entirely, use cloud-based Alexa integration.

**Pros**:
- Works with all Alexa versions including Alexa+
- No SSDP/multicast issues
- More reliable long-term

**Cons**:
- Requires internet connection
- Adds latency
- External dependency

### Option 4: External Server Mode

FauxmoESP can work with external AsyncWebServer:
```cpp
fauxmo.createServer(false);
fauxmo.setPort(80);  // Use existing server's port
```

This delegates HTTP handling to our existing server, only using FauxmoESP for SSDP.

**Pros**:
- Reduces conflicts
- Uses existing web server infrastructure

**Cons**:
- Need to manually handle Hue API endpoints
- Still has AsyncUDP issues for SSDP

---

## Recommended Approach

**Immediate Fix** (Try First):
1. Add random 1.5-2.2s delay before SSDP response
2. Change to global debounce (not per-IP)
3. Add `WiFi.setSleep(false)`

**If Still Failing**:
Switch to SinricPro for reliable cloud-based Alexa integration.

**Long-Term**:
Consider Tasmota-style sync approach if Alexa integration is critical and local-only is required.

---

## Code Changes Needed for Immediate Fix

### 1. Add Random Delay (`fauxmoESP.cpp`)

```cpp
void fauxmoESP::_sendUDPResponse(unsigned int mx) {
    // Global debounce (not per-IP)
    static unsigned long lastRespondTime = 0;

    // Check global debounce (300ms)
    if ((millis() - lastRespondTime) < 300) {
        DEBUG_MSG_FAUXMO("[FAUXMO] Skipping response (global debounce)\n");
        return;
    }
    lastRespondTime = millis();

    // Add random delay 1500-2200ms as per SSDP spec
    unsigned int randomDelay = 1500 + (millis() & 0x7) * 100;
    // Note: Can't use delay() with AsyncUDP - need to schedule this differently
    // ... rest of response code
}
```

**Problem**: `delay()` doesn't work in AsyncUDP callbacks. Would need to use `Ticker` or similar to schedule the response.

### 2. Alternative: Use Ticker for Delayed Response

```cpp
#include <Ticker.h>

Ticker ssdpResponseTicker;

void fauxmoESP::_scheduleResponse(IPAddress ip, uint16_t port) {
    // Store target for callback
    _pendingResponseIP = ip;
    _pendingResponsePort = port;

    // Random delay 1.5-2.2 seconds
    float delay = 1.5 + (random(8) * 0.1);
    ssdpResponseTicker.once(delay, [this]() {
        _sendUDPResponse(_pendingResponseIP, _pendingResponsePort);
    });
}
```

---

## References

- [Tasmota GitHub Repository](https://github.com/arendst/Tasmota)
- [Tasmota support_udp.ino](https://github.com/arendst/Tasmota/blob/development/tasmota/tasmota_support/support_udp.ino)
- [Tasmota xdrv_20_hue.ino](https://github.com/arendst/Tasmota/blob/development/tasmota/tasmota_xdrv_driver/xdrv_20_hue.ino)
- [AsyncUDP Resource Bug #3320](https://github.com/espressif/arduino-esp32/issues/3320)
- [AsyncUDP Multicast Bug #10758](https://github.com/espressif/arduino-esp32/issues/10758)
- [FauxmoESP Echo 2024 Fix #259](https://github.com/vintlabs/fauxmoESP/issues/259)
- [AsyncTCP Lockup #94](https://github.com/me-no-dev/AsyncTCP/issues/94)
- [Espalexa Library](https://github.com/Aircoookie/Espalexa)
- [ESP32 Arduino v2.0.17 Release](https://github.com/espressif/arduino-esp32/releases/tag/2.0.17)
