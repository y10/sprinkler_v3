#include <WiFi.h>
#include <WsConsole.h>
#include <esp_wifi.h>
#include "sprinkler.h"

WsConsole console("unit");

const String SprinklerControl::wifissid(bool persisted) {
  if (persisted) {
    if (WiFiGenericClass::getMode() & WIFI_MODE_STA) {
      wifi_config_t conf;
      esp_wifi_get_config(WIFI_IF_STA, &conf);
      return String(reinterpret_cast<const char *>(conf.sta.ssid));
    }
    return String();
  }
  return SSID;
}

const String SprinklerControl::wifipass(bool persisted) {
  if (persisted) {
    if (WiFiGenericClass::getMode() & WIFI_MODE_STA) {
      wifi_config_t conf;
      esp_wifi_get_config(WIFI_IF_STA, &conf);
      return String(reinterpret_cast<char *>(conf.sta.password));
    }
    return String();
  }
  return SKEY;
}

void SprinklerControl::fireEvent(const char *eventType, const char *evenDescription) {
  for (auto &event : onEventHandlers[eventType]) {
    event(evenDescription);
  }
}

void SprinklerControl::on(const char *eventType, OnEvent event) {
  onEventHandlers[eventType].push_back(event);
}

bool SprinklerControl::isZoneInSequence(uint8_t zone) {
  auto& seq = Device.sequence();
  for (uint8_t i = 0; i < seq.orderCount(); i++) {
    if (seq.order[i] == zone) return true;
  }
  return false;
}

uint8_t SprinklerControl::getZoneSequenceIndex(uint8_t zone) {
  auto& seq = Device.sequence();
  for (uint8_t i = 0; i < seq.orderCount(); i++) {
    if (seq.order[i] == zone) return i;
  }
  return 255; // Not found
}

bool SprinklerControl::isInSequenceWindow() {
  auto& seq = Device.sequence();
  if (!seq.enabled || seq.orderCount() == 0) return false;

  // Get current time
  time_t now = time(nullptr);
  struct tm* timeinfo = localtime(&now);
  int currentDayBit = 1 << timeinfo->tm_wday; // 0=Sun, 1=Mon, etc.

  // Check if today is a sequence day
  if (!(seq.days & currentDayBit)) return false;

  // Check if current time is close to sequence start (within reasonable window)
  int currentMinutes = timeinfo->tm_hour * 60 + timeinfo->tm_min;
  int seqStartMinutes = seq.hour * 60 + seq.minute;

  // Allow 60 minute window after start time for sequence detection
  return currentMinutes >= seqStartMinutes && currentMinutes <= seqStartMinutes + 60;
}

void SprinklerControl::startSequenceSession(uint8_t zoneIndex) {
  auto& session = Timers.Sequence;
  auto& seq = Device.sequence();

  session.active = true;
  session.paused = false;
  session.currentZoneIndex = zoneIndex;
  session.totalZones = seq.orderCount();

  console.println("Sequence session started, zone index: " + String(zoneIndex));
}

void SprinklerControl::scheduled(unsigned int zone, unsigned int duration = 0) {
  if (Timers.isEnabled())
  {
    console.println("Scheduled timer " + (String)zone);

    // Check if this is part of a sequence
    if (isZoneInSequence(zone) && isInSequenceWindow()) {
      uint8_t zoneIndex = getZoneSequenceIndex(zone);

      if (!Timers.Sequence.active) {
        // First zone of sequence - start session
        startSequenceSession(zoneIndex);
      } else {
        // Subsequent zone - advance session
        Timers.Sequence.currentZoneIndex = zoneIndex;
      }
    }

    start(zone, duration);
  }
  else
  {
    console.println("Scheduled timer " + (String)zone + " canceled");
  }
}

void SprinklerControl::start(unsigned int zone, unsigned int duration = 0) {
  console.println("Starting timer " + (String)zone);

  Device.turnOn(zone);  // zone first
  Device.turnOn();      // engine last
  Device.blink(0.5);

  Timers.start(zone, duration, [this, zone] { stop(zone); });
  fireEvent("state", Timers.toJSON(zone));
}

void SprinklerControl::stop(unsigned int zone) {
  console.println("Stopping timer " + (String)zone);
  if (Timers.isWatering(zone)) {
    if (Timers.count() == 1) {
      Device.turnOff(); 
      Device.blink(0);
    }
    Device.turnOff(zone);  // zone last
    Timers.stop(zone);     // detach and remove timer
    fireEvent("state", Timers.toJSON(zone));
  }
}

void SprinklerControl::stop() {
  console.println("Stopping all");
  Device.turnOff(); 
  Device.blink(0);
  for (size_t zone = 1; zone <= 6; zone++) {
    Device.turnOff(zone); 
  }
}

void SprinklerControl::pause(unsigned int zone) {
  console.println("Pausing timer " + (String)zone);
  if (Timers.isWatering(zone)) {
    if (Timers.count() == 1) {
      Device.turnOff();
      Device.blink(0);
    }
    Timers.pause(zone);
    Device.turnOff(zone);
    fireEvent("state", Timers.toJSON(zone));
  }
}

void SprinklerControl::resume(unsigned int zone) {
  console.println("Resuming timer " + (String)zone);
  if (Timers.isPaused(zone)) {
    Timers.resume(zone);
    Device.turnOn(zone);  // zone first
    Device.turnOn();      // engine last
    Device.blink(0.5);
    fireEvent("state", Timers.toJSON(zone));
  }
}

bool SprinklerControl::fromJSON(JsonObject json) {
  bool dirty = false;

  if (json.containsKey("logLevel")) {
    Device.logLevel(json["logLevel"].as<uint8_t>());
    Console.logLevel((logLevel_t)json["logLevel"].as<uint8_t>());
    dirty = true;
  }

  if (json.containsKey("alexaEnabled")) {
    Device.alexaEnabled(json["alexaEnabled"].as<bool>());
    dirty = true;
  }

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

  if (json.containsKey("name")) {
    Device.dispname(json["name"].as<char *>());
    dirty = true;
  }

  if (json.containsKey("host")) {
    Device.hostname(json["host"].as<char *>());
    dirty = true;
  }

  if (json.containsKey("ssid")) {
    console.print("ssid: ");
    SSID = json["ssid"].as<char *>();
    console.println(SSID);

    if (json.containsKey("skey")) {
      console.print("skey: ");
      SKEY = json["skey"].as<char *>();
      console.println(SKEY);
    }

    // Disconnect from current network to trigger reconnection with new credentials
    console.println("WiFi credentials changed - will reconnect");
    connectedWifi = false;
    WiFi.disconnect();

    dirty = true;
  }

  if (json.containsKey("sequence")) {
    JsonVariant seqVar = json["sequence"];
    SprinklerSequenceConfig& seq = Device.sequence();

    if (seqVar.isNull()) {
      // Clear sequence
      seq.enabled = false;
      memset(seq.order, 0, sizeof(seq.order));
      seq.days = 0;
    } else {
      JsonObject seqJson = seqVar.as<JsonObject>();

      // Parse order array (0-terminated)
      JsonArray orderArr = seqJson["order"].as<JsonArray>();
      memset(seq.order, 0, sizeof(seq.order));
      uint8_t idx = 0;
      for (JsonVariant v : orderArr) {
        if (idx < 6) {
          seq.order[idx++] = v.as<uint8_t>();
        }
      }

      // Parse days array to bitmask
      seq.days = 0;
      JsonArray daysArr = seqJson["days"].as<JsonArray>();
      for (JsonVariant v : daysArr) {
        const char* day = v.as<const char*>();
        if (strcmp(day, "sun") == 0) seq.days |= (1 << 0);
        else if (strcmp(day, "mon") == 0) seq.days |= (1 << 1);
        else if (strcmp(day, "tue") == 0) seq.days |= (1 << 2);
        else if (strcmp(day, "wed") == 0) seq.days |= (1 << 3);
        else if (strcmp(day, "thu") == 0) seq.days |= (1 << 4);
        else if (strcmp(day, "fri") == 0) seq.days |= (1 << 5);
        else if (strcmp(day, "sat") == 0) seq.days |= (1 << 6);
      }

      seq.hour = seqJson["startHour"] | 6;
      seq.minute = seqJson["startMinute"] | 0;
      seq.duration = seqJson["duration"] | 15;
      seq.gap = seqJson["gap"] | 5;
      seq.enabled = (seq.orderCount() > 0 && seq.days > 0);
    }
    dirty = true;
  }

  // Get timezone offset for UTC conversion (sent with request, not stored)
  int8_t timezoneOffset = 0;
  if (json.containsKey("sequence")) {
    JsonObject seqJson = json["sequence"].as<JsonObject>();
    if (!seqJson.isNull() && seqJson.containsKey("timezoneOffset")) {
      timezoneOffset = seqJson["timezoneOffset"].as<int8_t>();
    }
  }

  if (json.containsKey("zones")) {
    JsonObject zonesJson = json["zones"].as<JsonObject>();
    SprinklerSequenceConfig& seq = Device.sequence();

    // If sequence has zones, calculate and override zone timers
    if (seq.orderCount() > 0) {
      const char* dayNames[] = {"sun", "mon", "tue", "wed", "thu", "fri", "sat"};

      // Convert local time to UTC using timezone offset
      // timezoneOffset is hours from UTC (e.g., EST = 5, so local + 5 = UTC)
      int16_t utcMinutes = (seq.hour * 60 + seq.minute) + (timezoneOffset * 60);
      int8_t dayShift = 0;
      if (utcMinutes < 0) {
        utcMinutes += 24 * 60;
        dayShift = -1;  // Previous day in UTC
      } else if (utcMinutes >= 24 * 60) {
        utcMinutes -= 24 * 60;
        dayShift = 1;   // Next day in UTC
      }

      // Calculate start time for each zone in sequence
      uint16_t currentMinutes = utcMinutes;

      for (uint8_t i = 0; i < seq.orderCount(); i++) {
        uint8_t zoneId = seq.order[i];
        String zoneKey = String(zoneId);

        // Get zone's custom duration from incoming JSON before clearing days
        uint8_t zoneDuration = seq.duration;  // Default to template
        if (zonesJson.containsKey(zoneKey)) {
          JsonObject existingZone = zonesJson[zoneKey];
          if (existingZone.containsKey("days")) {
            JsonObject existingDays = existingZone["days"];
            // Check any day for existing duration
            for (JsonPair kv : existingDays) {
              JsonArray timers = kv.value().as<JsonArray>();
              if (timers.size() > 0) {
                JsonObject timerObj = timers[0];
                if (timerObj.containsKey("d") && timerObj["d"].as<uint8_t>() > 0) {
                  zoneDuration = timerObj["d"].as<uint8_t>();
                  break;
                }
              }
            }
          }
        }

        // Ensure zone exists in JSON
        if (!zonesJson.containsKey(zoneKey)) {
          zonesJson.createNestedObject(zoneKey);
        }
        JsonObject zoneObj = zonesJson[zoneKey];

        // Clear existing days for this zone and set sequence days
        JsonObject daysObj = zoneObj.createNestedObject("days");

        // Calculate hour and handle additional day wraparound from zone offset
        uint8_t timerHour = (currentMinutes / 60) % 24;
        uint8_t timerMinute = currentMinutes % 60;
        int8_t zoneDayOffset = currentMinutes / 60 / 24;  // Additional offset from zone position

        // Set timer for each day in sequence (with day shift from timezone + zone offset)
        for (int d = 0; d < 7; d++) {
          if (seq.days & (1 << d)) {
            // Apply total day offset (timezone shift + zone position wraparound)
            int adjustedDay = (d + dayShift + zoneDayOffset + 7) % 7;
            JsonArray dayArr = daysObj.createNestedArray(dayNames[adjustedDay]);
            JsonObject timer = dayArr.createNestedObject();
            timer["h"] = timerHour;
            timer["m"] = timerMinute;
            timer["d"] = zoneDuration;  // Use zone's custom duration (or template if none)
          }
        }

        // Move to next zone's start time using zone's actual duration
        currentMinutes += zoneDuration + seq.gap;
      }
    }

    Settings.fromJSON(zonesJson);
    save();
    dirty = false;
    attach();
  }

  if (dirty) {
    save();
  }

  return true;
}

String SprinklerControl::sequenceToJSON() {
  SprinklerSequenceConfig& seq = Device.sequence();
  uint8_t count = seq.orderCount();

  // Only return null if no zones configured - keep settings even with no days
  if (count == 0) {
    return "null";
  }

  String json = "{\"order\":[";
  for (uint8_t i = 0; i < count; i++) {
    if (i > 0) json += ",";
    json += String(seq.order[i]);
  }
  json += "],\"days\":[";

  // Convert bitmask to day names
  const char* dayNames[] = {"sun", "mon", "tue", "wed", "thu", "fri", "sat"};
  bool first = true;
  for (int i = 0; i < 7; i++) {
    if (seq.days & (1 << i)) {
      if (!first) json += ",";
      json += "\"";
      json += dayNames[i];
      json += "\"";
      first = false;
    }
  }
  json += "],\"startHour\":" + String(seq.hour);
  json += ",\"startMinute\":" + String(seq.minute);
  json += ",\"duration\":" + String(seq.duration);
  json += ",\"gap\":" + String(seq.gap);
  json += "}";

  return json;
}

bool SprinklerControl::isEnabled() {
  return Settings.isAttached() && Timers.isEnabled();
}

void SprinklerControl::enable() {
  Timers.enable();
}

void SprinklerControl::disable() {
  stop();
  Timers.disable();
}

bool SprinklerControl::isAttached() {
  return Settings.isAttached();
}

void SprinklerControl::detach() {
  Settings.detach();
}

void SprinklerControl::attach() {
  Settings.attach();
}

void SprinklerControl::load() {
  SprinklerConfig cfg = Device.load();
  Console.logLevel((logLevel_t)cfg.loglevel);
  Settings.fromConfig(cfg);
  Device.init();
}

void SprinklerControl::save() {
  SprinklerConfig tmp = Settings.toConfig();
  Device.save(tmp);
  console.println(toJSON());
}

void SprinklerControl::reset() {
  Device.reset();
}

void SprinklerControl::restart() {
  Device.restart();
}

SprinklerControl Sprinkler = SprinklerControl();