# MQTT Support Implementation Plan

## Overview

Add MQTT support to the ESP32 sprinkler controller for Home Assistant integration. This includes auto-discovery of zones as switch entities, real-time state publishing, and command handling for zone control.

## Current State Analysis

The sprinkler firmware uses a modular header-based architecture with:
- Event system (`Sprinkler.on("state", callback)`) for state change propagation
- Existing integrations follow setup/handle pattern (HTTP, Alexa)
- EEPROM configuration storage in `SprinklerConfig` struct
- Web UI uses custom components with change-then-save pattern

### Key Discoveries:
- Event subscription pattern at `sprinkler-http.h:54-56` - subscribe to `"state"` events
- Zone iteration via `Settings.forEachZone()` callback at `sprinkler-alexa.h:72-84`
- Config struct at `sprinkler-config.h:24-34` - add MQTT fields here
- Web UI component registration at `html/js/setup.js:16-29`
- Settings slider at `html/js/screens/setup.js:4-10` - add MQTT panel

## Desired End State

After implementation:
1. MQTT broker settings configurable via web UI (host, port, user, password)
2. On connection, 7 switch entities auto-discovered in Home Assistant:
   - "Sprinklers" (all zones)
   - "Sprinkler at Zone 1" through "Sprinkler at Zone 6" (configured zones)
3. Zone state changes published in real-time
4. Commands from Home Assistant control zones
5. Availability status with Last Will Testament

### Verification:
- Devices appear in Home Assistant under MQTT integration
- Turning switch on/off in HA controls sprinkler zones
- Zone state in HA updates when controlled via web UI or Alexa
- Controller shows as unavailable when disconnected

## What We're NOT Doing

- MQTT over TLS (can add later)
- QoS 2 messages (QoS 1 sufficient for this use case)
- Sensor entities for duration/runtime (switches only for now)
- Birth/will messages for individual zones (device-level only)

## Implementation Approach

Use PubSubClient library with blocking reconnect in loop(). Follow existing patterns:
- New `sprinkler-mqtt.h` module following Alexa pattern
- Subscribe to `"state"` events for publishing
- Use `Sprinkler.start()`/`stop()` for command handling
- Store config in EEPROM alongside existing settings

## Phase 1: Add PubSubClient Library and Module Skeleton

### Overview
Set up the MQTT library and create the basic module structure.

### Changes Required:

#### 1. Add PubSubClient Library
**Action**: Download PubSubClient to `arduino/libraries/`

```bash
# Clone or download PubSubClient v2.8
# Place in arduino/libraries/PubSubClient/
```

#### 2. Create MQTT Module Header
**File**: `arduino/sprinkler-mqtt.h`

```cpp
#ifndef SPRINKLER_MQTT_H
#define SPRINKLER_MQTT_H

#include <WiFi.h>
#include <PubSubClient.h>
#include <WsConsole.h>
#include "sprinkler.h"

static WsConsole mqtt_console("mqtt");

// MQTT client
static WiFiClient mqttWiFiClient;
static PubSubClient mqttClient(mqttWiFiClient);

// Connection state
static unsigned long lastReconnectAttempt = 0;
static bool mqttDiscoveryPublished = false;

// Forward declarations
void setupMqtt();
void handleMqtt();
bool mqttConnected();

#endif
```

#### 3. Include in Main Sketch
**File**: `arduino/arduino.ino`

Add after other includes (~line 15):
```cpp
#include "sprinkler-mqtt.h"
```

Add in `setup()` after `setupAlexa()`:
```cpp
setupMqtt();
```

Add in `loop()` after `handleAlexa()`:
```cpp
handleMqtt();
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles: `deno task compile`
- [x] No undefined reference errors for MQTT functions

#### Manual Verification:
- [x] Device boots without crash
- [x] Serial log shows MQTT module loaded

---

## Phase 2: EEPROM Configuration for MQTT Settings

### Overview
Add MQTT broker settings to persistent configuration.

### Changes Required:

#### 1. Update Config Structure
**File**: `arduino/sprinkler-config.h`

Add fields to `SprinklerConfig` struct (after line 31):
```cpp
struct SprinklerConfig
{
  uint8_t version;
  uint8_t loglevel;
  char full_name[50];
  char host_name[50];
  char disp_name[50];
  char source;
  // MQTT configuration
  char mqtt_host[64];
  uint16_t mqtt_port;
  char mqtt_user[32];
  char mqtt_pass[64];
  bool mqtt_enabled;
  // Zones
  SprinklerZoneConfig zones[SKETCH_MAX_ZONES];

  SprinklerConfig(): version(0), full_name({0}), host_name({0}), disp_name({0}),
    source('P'), mqtt_host({0}), mqtt_port(1883), mqtt_user({0}), mqtt_pass({0}),
    mqtt_enabled(false) {}
};
```

#### 2. Add Device Accessors
**File**: `arduino/sprinkler-device.h`

Add accessor methods (after line 60):
```cpp
// MQTT configuration accessors
String mqttHost() { return String(config.mqtt_host); }
void mqttHost(const char* host) { strncpy(config.mqtt_host, host, 63); }

uint16_t mqttPort() { return config.mqtt_port; }
void mqttPort(uint16_t port) { config.mqtt_port = port; }

String mqttUser() { return String(config.mqtt_user); }
void mqttUser(const char* user) { strncpy(config.mqtt_user, user, 31); }

String mqttPass() { return String(config.mqtt_pass); }
void mqttPass(const char* pass) { strncpy(config.mqtt_pass, pass, 63); }

bool mqttEnabled() { return config.mqtt_enabled; }
void mqttEnabled(bool enabled) { config.mqtt_enabled = enabled; }
```

#### 3. Update JSON Serialization
**File**: `arduino/sprinkler.h`

Update `toJSON()` method (~line 52) to include MQTT fields:
```cpp
String toJSON() {
  return (String) "{ \"logLevel\": \"" + (String)Device.logLevel() +
    "\", \"name\": \"" + Device.dispname() +
    "\", \"ssid\": \"" + wifissid() +
    "\", \"host\": \"" + Device.hostname() +
    "\", \"mqttHost\": \"" + Device.mqttHost() +
    "\", \"mqttPort\": " + Device.mqttPort() +
    "\", \"mqttUser\": \"" + Device.mqttUser() +
    "\", \"mqttEnabled\": " + (Device.mqttEnabled() ? "true" : "false") +
    "\", \"zones\": " + Settings.toJSON() +
    ", \"source\": \"" + Device.source() +
    "\", \"enabled\": " + isEnabled() + " }";
}
```

Note: Password intentionally omitted from JSON output for security.

#### 4. Update JSON Parsing
**File**: `arduino/sprinkler.cpp`

Add to `fromJSON()` method (after line 141):
```cpp
if (json.containsKey("mqttHost")) {
  Device.mqttHost(json["mqttHost"].as<const char*>());
  dirty = true;
}

if (json.containsKey("mqttPort")) {
  Device.mqttPort(json["mqttPort"].as<uint16_t>());
  dirty = true;
}

if (json.containsKey("mqttUser")) {
  Device.mqttUser(json["mqttUser"].as<const char*>());
  dirty = true;
}

if (json.containsKey("mqttPass")) {
  Device.mqttPass(json["mqttPass"].as<const char*>());
  dirty = true;
}

if (json.containsKey("mqttEnabled")) {
  Device.mqttEnabled(json["mqttEnabled"].as<bool>());
  dirty = true;
}
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles without errors
- [x] No EEPROM size overflow warnings

#### Manual Verification:
- [x] GET /api/settings returns mqttHost, mqttPort, mqttUser, mqttEnabled fields
- [x] POST /api/settings with MQTT fields persists after reboot

**Implementation Note**: After completing this phase and all automated verification passes, test EEPROM persistence manually before proceeding.

---

## Phase 3: Web UI for MQTT Configuration

### Overview
Add MQTT settings panel to the setup slider in the web UI.

### Changes Required:

#### 1. Create MQTT Settings Component
**File**: `html/js/screens/setup-mqtt.js` (new file)

```javascript
import { jQuery } from "../system/jquery";
import { App } from "../system/app";

const html = `
<div class="container">
    <h1>MQTT</h1>
    <form>
        <input id="mqtt-enabled" type="checkbox" style="width:auto">
        <label for="mqtt-enabled">Enable MQTT</label>
        <br /><br />
        <input id='mqtt-host' name='mqtt-host' length=64 placeholder='Broker Host (e.g., 192.168.0.10)'><br />
        <br />
        <input id='mqtt-port' name='mqtt-port' type='number' placeholder='Port' value='1883'><br />
        <br />
        <input id='mqtt-user' name='mqtt-user' length=32 placeholder='Username (optional)'><br />
        <br />
        <input id='mqtt-pass' name='mqtt-pass' length=64 type='password' placeholder='Password (optional)'><br />
        <br />
        <input id="mqtt-show-pass" type="checkbox" style="width:auto"><label for="mqtt-show-pass">Show password</label>
    </form>
</div>
`;

const style = `
<style>
.container {
  width: 80vw;
  max-width:300px;
}
h1 {
  position: absolute;
  top: 0;
}
@media screen and (min-height: 730px) {
  h1 { top: 6%; }
}
input[type="text"], input[type="password"], input[type="number"] {
    padding: 8px;
    font-size: 1em;
    width: 100%;
}
input[type="checkbox"] {
    width: auto;
}
</style>
`;

export class MqttSettings extends HTMLElement {
  settings = {};

  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(style + html, async ($) => {
      this.chkEnabled = $("#mqtt-enabled");
      this.chkEnabled.item().checked = App.mqttEnabled();
      this.chkEnabled.on("change", () => {
        this.settings["mqttEnabled"] = this.chkEnabled.item().checked;
      });

      this.txtHost = $("#mqtt-host");
      this.txtHost.value(App.mqttHost());
      this.txtHost.on("change", () => {
        this.settings["mqttHost"] = this.txtHost.value();
      });

      this.txtPort = $("#mqtt-port");
      this.txtPort.value(App.mqttPort() || 1883);
      this.txtPort.on("change", () => {
        this.settings["mqttPort"] = parseInt(this.txtPort.value()) || 1883;
      });

      this.txtUser = $("#mqtt-user");
      this.txtUser.value(App.mqttUser());
      this.txtUser.on("change", () => {
        this.settings["mqttUser"] = this.txtUser.value();
      });

      this.txtPass = $("#mqtt-pass");
      // Password not loaded from backend for security
      this.txtPass.on("change", () => {
        this.settings["mqttPass"] = this.txtPass.value();
      });

      this.chkShowPass = $("#mqtt-show-pass");
      this.chkShowPass.on("change", () => {
        const txtPass = this.txtPass.item();
        txtPass.type = txtPass.type == 'text' ? 'password' : 'text';
      });
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  onSave(e) {
    if (Object.keys(this.settings).length > 0) {
      e.settings = { ...e.settings, ...this.settings };
      e.restartRequested = true;
    }
  }
}
```

#### 2. Add App Getters
**File**: `html/js/system/app.js`

Add after line 57 (after `ssid()` getter):
```javascript
mqttHost() {
  const { mqttHost } = this.$settings;
  return mqttHost || "";
}

mqttPort() {
  const { mqttPort } = this.$settings;
  return mqttPort || 1883;
}

mqttUser() {
  const { mqttUser } = this.$settings;
  return mqttUser || "";
}

mqttEnabled() {
  const { mqttEnabled } = this.$settings;
  return mqttEnabled || false;
}
```

#### 3. Register Component
**File**: `html/js/setup.js`

Add import (after line 10):
```javascript
import { MqttSettings } from "./screens/setup-mqtt";
```

Add to component registration (after line 27):
```javascript
'sprinkler-setup-mqtt': MqttSettings,
```

#### 4. Add to Settings Slider
**File**: `html/js/screens/setup.js`

Update HTML template (lines 4-10):
```javascript
const html = `
<sketch-slider>
  <sprinkler-setup-general></sprinkler-setup-general>
  <sprinkler-setup-wifi></sprinkler-setup-wifi>
  <sprinkler-setup-mqtt></sprinkler-setup-mqtt>
  <sprinkler-time></sprinkler-time>
</sketch-slider>
`
```

### Success Criteria:

#### Automated Verification:
- [x] Web UI builds: `deno task build`
- [x] Generated headers updated in `arduino/html/`
- [x] Firmware compiles with new UI

#### Manual Verification:
- [x] MQTT settings panel appears in web UI settings
- [x] Enable checkbox, host, port, user, password fields present
- [x] Settings save and persist after reboot

**Implementation Note**: After completing this phase, manually test the web UI before proceeding.

---

## Phase 4: MQTT Connection and Reconnection

### Overview
Implement MQTT broker connection with automatic reconnection.

### Changes Required:

#### 1. Implement MQTT Module
**File**: `arduino/sprinkler-mqtt.h`

Replace skeleton with full implementation:
```cpp
#ifndef SPRINKLER_MQTT_H
#define SPRINKLER_MQTT_H

#include <WiFi.h>
#define MQTT_MAX_PACKET_SIZE 1024
#include <PubSubClient.h>
#include <WsConsole.h>
#include "sprinkler.h"

static WsConsole mqtt_console("mqtt");

// MQTT client
static WiFiClient mqttWiFiClient;
static PubSubClient mqttClient(mqttWiFiClient);

// Connection state
static unsigned long lastReconnectAttempt = 0;
static bool mqttDiscoveryPublished = false;

// Topic prefix based on hostname
static String mqttTopicPrefix;

// Forward declarations
void mqttCallback(char* topic, byte* payload, unsigned int length);
void publishDiscovery();
void publishState(unsigned int zone);
void publishAllStates();

bool mqttConnect() {
  if (!Sprinkler.Device.mqttEnabled()) {
    return false;
  }

  String host = Sprinkler.Device.mqttHost();
  if (host.length() == 0) {
    return false;
  }

  mqtt_console.printf("Connecting to %s:%d\n", host.c_str(), Sprinkler.Device.mqttPort());

  mqttClient.setServer(host.c_str(), Sprinkler.Device.mqttPort());
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);

  String clientId = "sprinkler_" + WiFi.macAddress();
  clientId.replace(":", "");

  // Last Will Testament
  String availTopic = mqttTopicPrefix + "/status";

  bool connected = false;
  String user = Sprinkler.Device.mqttUser();
  String pass = Sprinkler.Device.mqttPass();

  if (user.length() > 0) {
    connected = mqttClient.connect(
      clientId.c_str(),
      user.c_str(),
      pass.c_str(),
      availTopic.c_str(),
      1,     // QoS
      true,  // retain
      "offline"
    );
  } else {
    connected = mqttClient.connect(
      clientId.c_str(),
      availTopic.c_str(),
      1,
      true,
      "offline"
    );
  }

  if (connected) {
    mqtt_console.println("Connected!");

    // Publish online status
    mqttClient.publish(availTopic.c_str(), "online", true);

    // Subscribe to command topics
    String deviceCmdTopic = mqttTopicPrefix + "/cmd";
    mqttClient.subscribe(deviceCmdTopic.c_str());
    mqtt_console.printf("Subscribed to %s\n", deviceCmdTopic.c_str());

    String zoneCmdTopic = mqttTopicPrefix + "/zone/+/cmd";
    mqttClient.subscribe(zoneCmdTopic.c_str());
    mqtt_console.printf("Subscribed to %s\n", zoneCmdTopic.c_str());

    // Publish discovery and initial states
    if (!mqttDiscoveryPublished) {
      publishDiscovery();
      mqttDiscoveryPublished = true;
    }
    publishAllStates();

    return true;
  } else {
    mqtt_console.printf("Failed, rc=%d\n", mqttClient.state());
    return false;
  }
}

void setupMqtt() {
  if (!(WiFi.getMode() & WIFI_STA)) {
    mqtt_console.println("Skipped (not in STA mode)");
    return;
  }

  // Set topic prefix based on hostname
  mqttTopicPrefix = "sprinkler/" + Sprinkler.Device.hostname();

  // Subscribe to state events to publish changes
  Sprinkler.on("state", [](const char *event) {
    if (mqttClient.connected()) {
      // Parse zone from event JSON and publish
      // Event format: {"zone":1,"watering":true,...}
      // For simplicity, publish all states on any change
      publishAllStates();
    }
  });

  if (Sprinkler.Device.mqttEnabled()) {
    mqtt_console.println("Starting...");
    mqttConnect();
  } else {
    mqtt_console.println("Disabled");
  }
}

void handleMqtt() {
  if (!Sprinkler.Device.mqttEnabled()) {
    return;
  }

  if (!mqttClient.connected()) {
    unsigned long now = millis();
    if (now - lastReconnectAttempt > 5000) {
      lastReconnectAttempt = now;
      if (mqttConnect()) {
        lastReconnectAttempt = 0;
      }
    }
  } else {
    mqttClient.loop();
  }
}

bool mqttConnected() {
  return mqttClient.connected();
}

#endif
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles without errors

#### Manual Verification:
- [x] With MQTT enabled and valid broker, device connects
- [x] Serial log shows "Connected!" message
- [ ] Device reconnects after broker restart
- [x] With MQTT disabled, no connection attempts

**Implementation Note**: Test connection to your MQTT broker before proceeding.

---

## Phase 5: Home Assistant Auto-Discovery

### Overview
Publish discovery messages for automatic entity registration in Home Assistant.

### Changes Required:

#### 1. Add Discovery Function
**File**: `arduino/sprinkler-mqtt.h`

Add after `mqttConnect()` function:
```cpp
void publishDiscovery() {
  mqtt_console.println("Publishing HA discovery...");

  String macAddr = WiFi.macAddress();
  macAddr.replace(":", "");
  String deviceId = "sprinkler_" + macAddr;

  // Device info (shared by all entities)
  String deviceInfo = String("\"dev\":{") +
    "\"ids\":[\"" + deviceId + "\"]," +
    "\"name\":\"" + Sprinkler.Device.dispname() + "\"," +
    "\"mf\":\"Custom\"," +
    "\"mdl\":\"ESP32-WROVER\"," +
    "\"sw\":\"" + SKETCH_VERSION + "\"," +
    "\"cu\":\"http://" + WiFi.localIP().toString() + "\"}";

  String availTopic = mqttTopicPrefix + "/status";

  // Publish "all zones" switch (Sprinklers)
  {
    String name = Sprinkler.Device.dispname();
    // Pluralize
    char lastChar = name.charAt(name.length() - 1);
    if (lastChar == 's' || lastChar == 'x' || lastChar == 'z') {
      name += "es";
    } else {
      name += "s";
    }

    String uniqueId = deviceId + "_all";
    String stateTopic = mqttTopicPrefix + "/state";
    String cmdTopic = mqttTopicPrefix + "/cmd";

    String payload = String("{") +
      "\"name\":\"" + name + "\"," +
      "\"uniq_id\":\"" + uniqueId + "\"," +
      "\"stat_t\":\"" + stateTopic + "\"," +
      "\"cmd_t\":\"" + cmdTopic + "\"," +
      "\"pl_on\":\"ON\"," +
      "\"pl_off\":\"OFF\"," +
      "\"avty_t\":\"" + availTopic + "\"," +
      "\"ic\":\"mdi:sprinkler\"," +
      deviceInfo + "}";

    String discTopic = "homeassistant/switch/" + deviceId + "/config";
    mqttClient.publish(discTopic.c_str(), payload.c_str(), true);
    mqtt_console.printf("Discovery: %s\n", name.c_str());
    delay(100);
  }

  // Publish each zone
  Sprinkler.Settings.forEachZone([&deviceId, &deviceInfo, &availTopic](unsigned int zoneId, SprinklerZone* zone) {
    if (zone->name().length() > 0) {
      String name = Sprinkler.Device.dispname() + " at " + zone->name();
      String uniqueId = deviceId + "_zone" + zoneId;
      String stateTopic = mqttTopicPrefix + "/zone/" + zoneId + "/state";
      String cmdTopic = mqttTopicPrefix + "/zone/" + zoneId + "/cmd";

      String payload = String("{") +
        "\"name\":\"" + name + "\"," +
        "\"uniq_id\":\"" + uniqueId + "\"," +
        "\"stat_t\":\"" + stateTopic + "\"," +
        "\"cmd_t\":\"" + cmdTopic + "\"," +
        "\"pl_on\":\"ON\"," +
        "\"pl_off\":\"OFF\"," +
        "\"avty_t\":\"" + availTopic + "\"," +
        "\"ic\":\"mdi:sprinkler-variant\"," +
        deviceInfo + "}";

      String discTopic = "homeassistant/switch/" + deviceId + "_zone" + zoneId + "/config";
      mqttClient.publish(discTopic.c_str(), payload.c_str(), true);
      mqtt_console.printf("Discovery: %s\n", name.c_str());
      delay(100);
    }
  });

  mqtt_console.println("Discovery complete");
}
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles without errors

#### Manual Verification:
- [x] After MQTT connection, discovery messages published
- [x] Entities appear in Home Assistant: Settings → Devices & Services → MQTT
- [x] All zones grouped under single device
- [x] Device shows manufacturer, model, firmware version

**Implementation Note**: Check Home Assistant MQTT integration for discovered entities.

---

## Phase 6: State Publishing and Command Handling

### Overview
Publish zone states and handle commands from Home Assistant.

### Changes Required:

#### 1. Add State Publishing Functions
**File**: `arduino/sprinkler-mqtt.h`

Add after `publishDiscovery()`:
```cpp
void publishState(unsigned int zone) {
  if (!mqttClient.connected()) return;

  String topic = mqttTopicPrefix + "/zone/" + zone + "/state";
  String state = Sprinkler.Timers.isWatering(zone) ? "ON" : "OFF";
  mqttClient.publish(topic.c_str(), state.c_str(), true);
}

void publishAllStates() {
  if (!mqttClient.connected()) return;

  // Publish device state (ON if any zone watering)
  String allTopic = mqttTopicPrefix + "/state";
  String allState = Sprinkler.isWatering() ? "ON" : "OFF";
  mqttClient.publish(allTopic.c_str(), allState.c_str(), true);

  // Publish each zone state
  Sprinkler.Settings.forEachZone([](unsigned int zoneId, SprinklerZone* zone) {
    if (zone->name().length() > 0) {
      publishState(zoneId);
    }
  });
}
```

#### 2. Add Command Handler
**File**: `arduino/sprinkler-mqtt.h`

Add the callback implementation:
```cpp
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String topicStr = String(topic);
  String message = String((char*)payload).substring(0, length);
  message.toUpperCase();

  mqtt_console.printf("Received: %s = %s\n", topic, message.c_str());

  // Parse topic: sprinkler/<hostname>/cmd or sprinkler/<hostname>/zone/N/cmd

  // Device-level command (all zones): sprinkler/<hostname>/cmd
  if (topicStr.equals(mqttTopicPrefix + "/cmd")) {
    if (message == "ON") {
      mqtt_console.println("Starting all zones");
      Sprinkler.Settings.forEachZone([](unsigned int zId, SprinklerZone* zone) {
        if (zone->name().length() > 0) {
          Sprinkler.start(zId, SKETCH_TIMER_DEFAULT_LIMIT);
        }
      });
    } else if (message == "OFF") {
      mqtt_console.println("Stopping all zones");
      Sprinkler.stop();
    }
    return;
  }

  // Parse zone number from topic: .../zone/N/cmd
  int zoneIdx = topicStr.indexOf("/zone/");
  if (zoneIdx > 0) {
    int cmdIdx = topicStr.indexOf("/cmd");
    if (cmdIdx > zoneIdx) {
      String zoneStr = topicStr.substring(zoneIdx + 6, cmdIdx);
      unsigned int zone = zoneStr.toInt();

      if (zone >= 1 && zone <= SKETCH_MAX_ZONES) {
        if (message == "ON") {
          mqtt_console.printf("Starting zone %d\n", zone);
          Sprinkler.start(zone, SKETCH_TIMER_DEFAULT_LIMIT);
        } else if (message == "OFF") {
          mqtt_console.printf("Stopping zone %d\n", zone);
          Sprinkler.stop(zone);
        }
      }
    }
  }
}
```

### Success Criteria:

#### Automated Verification:
- [x] Firmware compiles without errors

#### Manual Verification:
- [x] Zone states reflect in Home Assistant switches
- [x] Toggling switch in HA turns zone on/off
- [x] "Sprinklers" switch controls all zones
- [x] State updates when zone controlled via web UI or Alexa
- [x] State persists after HA restart (retained messages)

**Implementation Note**: Test bidirectional control between Home Assistant and other interfaces.

---

## Testing Strategy

### Unit Tests:
- Not applicable for this embedded system

### Integration Tests:
- MQTT broker connection/disconnection
- Discovery message format validation
- Command topic parsing
- State synchronization across interfaces

### Manual Testing Steps:
1. Enable MQTT in web UI with broker settings
2. Verify device connects (check serial log)
3. Open Home Assistant → Settings → Devices & Services → MQTT
4. Verify "Sprinkler Controller" device with all zones
5. Toggle zone switch in HA, verify sprinkler responds
6. Turn on zone via web UI, verify HA switch updates
7. Turn on zone via Alexa, verify HA switch updates
8. Restart broker, verify device reconnects
9. Restart Home Assistant, verify states restore

## Performance Considerations

- PubSubClient buffer set to 1024 bytes for discovery payloads
- 100ms delay between discovery publishes to avoid broker overload
- Non-blocking reconnection with 5-second retry interval
- Retained messages for state topics to survive restarts

## Migration Notes

- EEPROM structure changes - existing devices will have uninitialized MQTT fields
- Default values in constructor handle this gracefully (mqtt_enabled = false)
- No data migration needed, users enable MQTT manually after update

## References

- PubSubClient library: https://github.com/knolleary/pubsubclient
- Home Assistant MQTT Switch: https://www.home-assistant.io/integrations/switch.mqtt/
- Home Assistant MQTT Discovery: https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery
- Existing patterns: `arduino/sprinkler-alexa.h`, `arduino/sprinkler-http.h`
