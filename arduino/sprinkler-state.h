#ifndef SprinklerState_H
#define SprinklerState_H

#include <ArduinoJson.h>
#include <Ticker.h>

#include <atomic>
#include <functional>
#include <map>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"

// Command queue for thread-safe state mutations
enum ZoneAction : uint8_t {
  CMD_START = 1,
  CMD_STOP = 2,
  CMD_PAUSE = 3,
  CMD_RESUME = 4,
  CMD_STOP_ALL = 5,
  CMD_ENABLE = 6,
  CMD_DISABLE = 7
};

struct ZoneCommand {
  ZoneAction action;
  uint8_t zone;
  uint8_t duration;
};

extern QueueHandle_t sprinklerCommandQueue;
extern SemaphoreHandle_t sprinklerStateMutex;

class SprinklerZoneTimer {
 public:
  SprinklerZoneTimer(unsigned int zone, unsigned int duration)
      : Zone(zone), Duration(duration), StartTime(millis()), PauseTime(0), stopping(false) {
    unsigned long d = (duration ? duration : 5);
    unsigned long ms = d * 1000 * 60;
    timer.once_ms(ms, +[](SprinklerZoneTimer* x) {
      if (!x->stopping.load()) {
        ZoneCommand cmd = { CMD_STOP, (uint8_t)x->Zone, 0 };
        xQueueSend(sprinklerCommandQueue, &cmd, 0);
      }
    }, this);
  }

  unsigned int Zone;
  unsigned int Duration;
  unsigned long StartTime;
  unsigned long PauseTime;

  ~SprinklerZoneTimer() {
    stopping.store(true);
    timer.detach();
  }

  void pause() {
    PauseTime = millis();
    timer.detach();
  }

  void resume() {
    if (!PauseTime)
      return;

    uint32_t d = (uint32_t)Duration * 60 * 1000;
    uint32_t p = PauseTime - StartTime;
    uint32_t ms = d - p;
    stopping.store(false);
    timer.once_ms(ms, +[](SprinklerZoneTimer* x) {
      if (!x->stopping.load()) {
        ZoneCommand cmd = { CMD_STOP, (uint8_t)x->Zone, 0 };
        xQueueSend(sprinklerCommandQueue, &cmd, 0);
      }
    }, this);
    StartTime = millis() - p;
    PauseTime = 0;
  }

  void stop() {
    stopping.store(true);
    PauseTime = 0;
    timer.detach();
  }

  const String toJSON() {
    auto ms = PauseTime ? PauseTime - StartTime : millis() - StartTime;
    auto state = PauseTime ? "paused" : "started";
    return "{ \"state\": \"" + (String)state +
           "\", \"zone\":" + (String)Zone +
           ", \"millis\":" + (String)(ms) +
           ", \"duration\": " + (String)Duration +
           " }";
  }

 private:
  Ticker timer;
  std::atomic<bool> stopping;
};

struct SequenceSession {
  bool active;                      // Is sequence currently running?
  bool paused;                      // Is sequence paused?
  uint8_t currentZoneIndex;         // Current position in order[] (0-based)
  uint8_t totalZones;               // Total zones in sequence

  SequenceSession() : active(false), paused(false),
    currentZoneIndex(0), totalZones(0) {}

  void reset() {
    active = false;
    paused = false;
    currentZoneIndex = 0;
    totalZones = 0;
  }

  const String toJSON() const {
    if (!active) return "null";
    return "{ \"active\": true"
           ", \"paused\": " + String(paused ? "true" : "false") +
           ", \"currentIndex\": " + String(currentZoneIndex) +
           ", \"totalZones\": " + String(totalZones) +
           " }";
  }
};

class SprinklerState {
 public:
  std::map<unsigned int, SprinklerZoneTimer*> Timers;
  SequenceSession Sequence;

  bool isEnabled();
  void enable();
  void disable();

  bool isPaused(unsigned int zone);
  bool isWatering(unsigned int zone);
  bool isWatering();
  size_t count();

  void start(unsigned int zone, unsigned int duration);
  void stop(unsigned int zone);
  void pause(unsigned int zone);
  void resume(unsigned int zone);

  const String toJSON(unsigned int zone);
  const String toJSON();

 private:
  bool enabled = true;
};

#endif