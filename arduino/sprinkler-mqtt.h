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
static bool mqttFirstAttempt = true;
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
      publishAllStates();
    }
  });

  if (Sprinkler.Device.mqttEnabled()) {
    mqtt_console.println("Enabled (connecting after WiFi ready)");
  } else {
    mqtt_console.println("Disabled");
  }
}

void handleMqtt() {
  if (!Sprinkler.Device.mqttEnabled()) {
    return;
  }

  // Wait for WiFi to be connected
  if (!Sprinkler.connectedWifi) {
    return;
  }

  if (!mqttClient.connected()) {
    unsigned long now = millis();
    // Try immediately on first attempt, then every 5 seconds
    if (mqttFirstAttempt || (now - lastReconnectAttempt > 5000)) {
      mqttFirstAttempt = false;
      lastReconnectAttempt = now;
      mqttConnect();
    }
  } else {
    mqttClient.loop();
  }
}

bool mqttConnected() {
  return mqttClient.connected();
}

void publishDiscovery() {
  mqtt_console.println("Publishing HA discovery...");

  String macAddr = WiFi.macAddress();
  macAddr.replace(":", "");
  String deviceId = "sprinkler_" + macAddr;

  // Device info (shared by all entities)
  String deviceInfo = String("\"dev\":{") +
    "\"ids\":[\"" + deviceId + "\"]," +
    "\"name\":\"" + Sprinkler.Device.dispname() + "\"," +
    "\"mf\":\"Serge Voytenko\"," +
    "\"mdl\":\"" + ESP.getChipModel() + "\"," +
    "\"sw\":\"" + SKETCH_VERSION + "\"," +
    "\"cu\":\"http://" + WiFi.localIP().toString() + "\"}";

  String availTopic = mqttTopicPrefix + "/status";

  // Publish "all zones" switch
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
      "\"ic\":\"mdi:sprinkler-variant\"," +
      deviceInfo + "}";

    String discTopic = "homeassistant/switch/" + deviceId + "/config";
    mqttClient.publish(discTopic.c_str(), payload.c_str(), true);
    mqtt_console.printf("Discovery: %s\n", name.c_str());
    delay(100);
  }

  // Publish each zone
  Sprinkler.Settings.forEachZone([&deviceId, &deviceInfo, &availTopic](unsigned int zoneId, SprinklerZone* zone) {
    if (zone->name().length() > 0) {
      String name = zone->name();
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
        "\"ic\":\"mdi:sprinkler\"," +
        deviceInfo + "}";

      String discTopic = "homeassistant/switch/" + deviceId + "_zone" + zoneId + "/config";
      mqttClient.publish(discTopic.c_str(), payload.c_str(), true);
      mqtt_console.printf("Discovery: %s\n", name.c_str());
      delay(100);
    }
  });

  mqtt_console.println("Discovery complete");
}

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

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String topicStr = String(topic);
  String message = String((char*)payload).substring(0, length);
  message.toUpperCase();

  mqtt_console.printf("Received: %s = %s\n", topic, message.c_str());

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
      Sprinkler.Settings.forEachZone([](unsigned int zId, SprinklerZone* zone) {
        if (zone->name().length() > 0) {
          Sprinkler.stop(zId);
        }
      });
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
        if (message == "ON" && !Sprinkler.Timers.isWatering(zone)) {
          mqtt_console.printf("Starting zone %d\n", zone);
          Sprinkler.start(zone, SKETCH_TIMER_DEFAULT_LIMIT);
        } else if (message == "OFF" && Sprinkler.Timers.isWatering(zone)) {
          mqtt_console.printf("Stopping zone %d\n", zone);
          Sprinkler.stop(zone);
        }
      }
    }
  }
}

#endif
