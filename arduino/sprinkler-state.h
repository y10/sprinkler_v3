#ifndef SprinklerState_H
#define SprinklerState_H

#include <ArduinoJson.h>
#include <Ticker.h>

#include <atomic>
#include <cstring>
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
  CMD_DISABLE = 7,
  CMD_CHAIN_START = 8,     // build session from pendingChain, start zone 1 (serialized)
  CMD_CHAIN_UPDATE = 9,    // rewrite the not-yet-started tail from pendingChain
  CMD_CHAIN_ADVANCE = 10,  // a zone's Ticker expired; advance the chain (cmd.zone = expired zone)
  CMD_CHAIN_NEXT = 11      // gap timer elapsed; start the next zone (runs under mutex)
};

struct ZoneCommand {
  ZoneAction action;
  uint8_t zone;
  uint8_t duration;
};

extern QueueHandle_t sprinklerCommandQueue;
extern SemaphoreHandle_t sprinklerStateMutex;

// Staging buffer for an ad-hoc chain: written by the HTTP task under the mutex,
// consumed by the CMD_CHAIN_START / CMD_CHAIN_UPDATE handlers in the command task.
struct PendingChain {
  uint8_t order[6];
  uint8_t durations[6];
  uint8_t count;
  uint8_t gap;
  PendingChain() : order{0}, durations{0}, count(0), gap(5) {}
};

struct SequenceSession {
  bool active;                      // Is sequence currently running?
  bool paused;                      // Is sequence paused?
  uint8_t currentZoneIndex;         // Current position in order[] (0-based)
  uint8_t totalZones;               // Total zones in sequence
  // Ad-hoc chain fields (adhoc == false for the persisted weekly sequence)
  bool adhoc;                       // Runtime "chain" run, distinct from the scheduled sequence
  bool inGap;                       // Between zones (source off) — for client rendering
  uint8_t order[6];                 // Zone ids in run order
  uint8_t durations[6];             // Per-zone minutes
  uint8_t gapMinutes;               // Gap between zones in minutes
  uint8_t epoch;                    // Bumped each chainStart; stale Ticker/gap commands carry the old epoch

  SequenceSession() : active(false), paused(false),
    currentZoneIndex(0), totalZones(0),
    adhoc(false), inGap(false), order{0}, durations{0}, gapMinutes(5), epoch(0) {}

  void reset() {
    active = false;
    paused = false;
    currentZoneIndex = 0;
    totalZones = 0;
    adhoc = false;
    inGap = false;
    memset(order, 0, sizeof(order));
    memset(durations, 0, sizeof(durations));
    gapMinutes = 5;
  }

  const String toJSON() const {
    if (!active) return "null";
    String json = "{ \"active\": true"
                  ", \"paused\": " + String(paused ? "true" : "false") +
                  ", \"currentIndex\": " + String(currentZoneIndex) +
                  ", \"totalZones\": " + String(totalZones);
    if (adhoc) {
      json += ", \"adhoc\": true, \"inGap\": " + String(inGap ? "true" : "false") +
              ", \"gap\": " + String(gapMinutes) + ", \"order\": [";
      for (uint8_t i = 0; i < totalZones; i++) {
        if (i) json += ",";
        json += String(order[i]);
      }
      json += "], \"durations\": [";
      for (uint8_t i = 0; i < totalZones; i++) {
        if (i) json += ",";
        json += String(durations[i]);
      }
      json += "]";
    }
    json += " }";
    return json;
  }
};

// Global pointer to the live sequence session so the Ticker callbacks (which run
// in the esp_timer task) can decide advance-vs-stop without including sprinkler.h.
extern SequenceSession* sprinklerActiveSequence;

class SprinklerZoneTimer {
 public:
  SprinklerZoneTimer(unsigned int zone, unsigned int duration)
      : Zone(zone), Duration(duration), StartTime(millis()), PauseTime(0), stopping(false) {
    unsigned long d = (duration ? duration : 5);
    unsigned long ms = d * 1000 * 60;
    timer.once_ms(ms, +[](SprinklerZoneTimer* x) {
      if (x->stopping.load()) return;
      chainAdvanceOrStop(x);
    }, this);
  }

  // Shared by the constructor and resume() Tickers. Reads the live sequence lock-free but
  // snapshots each field into a local FIRST (single load), so the bounds check and the
  // subscript can never see a torn/incremented currentZoneIndex. The carried epoch lets the
  // command task reject an advance from a chain that has since been replaced.
  static void chainAdvanceOrStop(SprinklerZoneTimer* x) {
    SequenceSession* seq = sprinklerActiveSequence;
    if (seq && seq->adhoc) {
      uint8_t idx = seq->currentZoneIndex;   // snapshot
      uint8_t tot = seq->totalZones;
      uint8_t ep  = seq->epoch;
      if (idx < tot && seq->order[idx] == (uint8_t)x->Zone) {
        ZoneCommand cmd = { CMD_CHAIN_ADVANCE, (uint8_t)x->Zone, ep };
        xQueueSend(sprinklerCommandQueue, &cmd, 0);
        return;
      }
    }
    ZoneCommand cmd = { CMD_STOP, (uint8_t)x->Zone, 0 };
    xQueueSend(sprinklerCommandQueue, &cmd, 0);
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
      if (x->stopping.load()) return;
      chainAdvanceOrStop(x);
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

class SprinklerState {
 public:
  std::map<unsigned int, SprinklerZoneTimer*> Timers;
  SequenceSession Sequence;
  Ticker chainGapTimer;          // inter-zone gap timer for ad-hoc chains
  PendingChain pendingChain[4];  // ring of staged chain payloads (HTTP task fills a slot, command task consumes by index)
  uint8_t pendingHead = 0;       // next ring slot to fill (mutex-protected)

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
