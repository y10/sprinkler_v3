import { MAX_ZONES } from "../config";
import { Status } from "./status";
import { Time } from "./time";
import { Log } from "./log";
import { Module } from "./module";
import { Store } from "../storage";
import { Zone } from "../models/zone";
import { ZoneSet } from "../models/zoneSet";
import { Sequence } from "../models/sequence";

class AppModel {
  $settings = {};
  $sequence = null;

  $zones = new ZoneSet({
    // Uncoment for test
    // 1: {
    //   name: "Zone 1",
    //   days: {
    //     all: [{ h: Time.toUtcHour(0) }],
    //   },
    // },
  });

  /**
   * @arg value {{ name?:string, host?:string, ssid?:string }?}
   * @returns {Promise<{ name:string, host:string, ssid:string }>}
   */
  async settings(value) {
    if (value) {
      const json = await Store.put(value);
      if (Object.keys(json).length > 0) {
        this.$settings = { ...json };
      }
    } else {
      const json = await Store.get();
      if (Object.keys(json).length > 0) {
        this.$settings = { ...json };
      }
    }
    return { ...this.$settings };
  }

  friendlyName() {
    const { name } = this.$settings;
    return name || "Sprinkler";
  }

  hostname() {
    const { host } = this.$settings;
    return host || "sprinkler-v3";
  }

  ssid() {
    const { ssid } = this.$settings;
    return ssid || "";
  }

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

  /**
   * @param {string} id - zone id to return;
   * @returns {Zone}
   */
  zones(id) {
    if (id === undefined) {
      return this.$zones;
    }

    return this.$zones.zone(id);
  }

  /**
   * @returns {Sequence}
   */
  sequence() {
    if (!this.$sequence) {
      this.$sequence = new Sequence(this.$settings.sequence || {});
    }
    return this.$sequence;
  }

  recalculateSequence() {
    const seq = this.sequence();
    // Only apply if we have BOTH pattern AND days
    if (seq.order.length === 0 || seq.days.length === 0) {
      console.log('[Sequence] Skip recalculate - incomplete:', { order: seq.order.length, days: seq.days.length });
      return;
    }

    try {
      console.log('[Sequence] Recalculating with order:', seq.order, 'days:', seq.days);

      // Clear timers for days that were REMOVED from the sequence
      const removedDays = seq.removedDays;
      if (removedDays.length > 0) {
        console.log('[Sequence] Clearing removed days:', removedDays);
        for (const zoneId of seq.order) {
          const zone = this.zones(zoneId);
          if (!zone.defined()) continue;
          for (const day of removedDays) {
            const timer = zone.days(day).timers(0);
            timer.h = 0;
            timer.m = 0;
            timer.d = 0;
          }
        }
      }

      // FIRST: Gather per-zone duration overrides (before clearing!)
      const durations = {};
      for (const zoneId of seq.order) {
        const zone = this.zones(zoneId);
        if (!zone.defined()) continue;
        // Check if zone has a custom duration set
        for (const day of seq.days) {
          const timer = zone.days(day).timers(0);
          if (timer.d && timer.d !== seq.duration && timer.d > 0) {
            durations[zoneId] = timer.d;
            break;
          }
        }
      }
      console.log('[Sequence] Duration overrides:', durations);

      // Calculate schedule with per-zone durations
      const schedule = seq.calculateSchedule(durations);

      // Clear ONLY sequence days (not all weekdays) to preserve non-sequence timers
      for (const zoneId of seq.order) {
        const zone = this.zones(zoneId);
        if (!zone.defined()) continue;
        for (const day of seq.days) {
          const timer = zone.days(day).timers(0);
          timer.h = 0;
          timer.m = 0;
          timer.d = 0;
        }
      }

      // Apply new schedules to sequence days
      for (const day of seq.days) {
        for (const [zoneId, times] of Object.entries(schedule)) {
          const zone = this.zones(zoneId);
          if (!zone.defined()) continue;
          const timer = zone.days(day).timers(0);
          timer.h = times.h;
          timer.m = times.m;
          timer.d = times.d;
        }
      }

      // Commit the days change now that timers are updated
      seq.commitDays();
      console.log('[Sequence] Applied schedule:', schedule);
    } catch (error) {
      console.error('[Sequence] Recalculation failed:', error);
    }
  }

  async load(modules) {
    try {
      const { zones, sequence } = await this.settings();
      if (zones && Object.keys(zones).length > 0) {
        this.$zones = new ZoneSet(zones);
      }
      if (sequence) {
        this.$sequence = new Sequence(sequence);
      } else if (zones && Object.keys(zones).length > 1) {
        // Try to derive sequence from existing zone schedules
        this.$sequence = this.deriveSequenceFromZones(zones);
        console.log('[Sequence] Derived from zones:', this.$sequence);
      }
      Module.register(modules);
    } catch(error) {
      console.log(error);
      Module.register(modules);
      Status.error("Failed to load zones from the server. <a href='./index.html' taget='self'>Reload</a>");
    }
  }

  deriveSequenceFromZones(zones) {
    console.log('[Derive] Starting with zones:', zones);
    // Find days that have schedules across multiple zones
    const daySchedules = {};
    const allDays = new Set();

    for (const [zoneId, zone] of Object.entries(zones)) {
      if (!zone.days) continue;
      for (const [day, timers] of Object.entries(zone.days)) {
        if (day === 'all' || !timers || timers.length === 0) continue;
        const timer = timers[0];
        if (!timer.d || timer.d === 0) continue; // Skip if no duration

        allDays.add(day);
        if (!daySchedules[day]) daySchedules[day] = [];
        daySchedules[day].push({
          zoneId: parseInt(zoneId),
          minutes: timer.h * 60 + timer.m,
          h: timer.h,
          m: timer.m,
          d: timer.d
        });
      }
    }
    console.log('[Derive] daySchedules:', daySchedules, 'allDays:', Array.from(allDays));

    // Find the day with most zones scheduled
    let bestDay = null;
    let maxZones = 0;
    for (const [day, schedules] of Object.entries(daySchedules)) {
      if (schedules.length > maxZones) {
        maxZones = schedules.length;
        bestDay = day;
      }
    }

    console.log('[Derive] bestDay:', bestDay, 'maxZones:', maxZones);

    if (!bestDay || maxZones < 1) {
      console.log('[Derive] Cannot derive - no valid schedules found');
      return new Sequence(); // Can't derive sequence
    }

    // Sort zones by start time
    const sorted = daySchedules[bestDay].sort((a, b) => a.minutes - b.minutes);

    // Extract sequence data
    const order = sorted.map(s => s.zoneId);
    const first = sorted[0];
    const duration = first.d;

    // Calculate gap from time differences
    let gap = 5; // default
    if (sorted.length > 1) {
      const diff = sorted[1].minutes - sorted[0].minutes;
      gap = diff - duration;
      if (gap < 0) gap = 5;
    }

    // Get all days that have the same zones scheduled
    const days = Array.from(allDays);

    const result = new Sequence({
      order,
      startHour: Time.toLocalHour(first.h),
      startMinute: first.m,
      duration,
      gap,
      days
    });
    console.log('[Derive] Result:', result);
    return result;
  }

  async save() {
    const spinner = Status.wait();
    const logLevel = this.logLevel();
    const chip = this.hostname();
    const name = this.friendlyName();
    const zones = this.$zones.toJson();
    // Note: sequence is derived from zones, not stored separately
    const state = { logLevel, name, chip, zones };
    try {
      const json = await Store.put(state);
      if (json && json !== state) {
        this.$settings = { ...json };
        if ("zones" in json && Object.keys(json.zones).length > 0) {
          this.$zones = new ZoneSet(json.zones);
        }
        return true;
      }
    } catch (error) {
      Status.error(error);
    }

    spinner.close();
    return false;
  }

  /**
   * @param {number} level - log level to set (0=none, 1=error, 2=warn, 3=info)
   * @returns {number}
   */
  logLevel(level) {
    if (level === undefined) {
      const { logLevel } = this.$settings;
      return logLevel ?? 3;  // Default to Info
    }

    return this.loglevelAsync(level);
  }

  /**
   * @returns {boolean}
   */
  alexaEnabled() {
    const { alexaEnabled } = this.$settings;
    return alexaEnabled ?? true;  // Default enabled
  }

  async loglevelAsync(level) {
    Status.wait();
    Log.loglevel(level).catch();
    await App.wait(10000);
    this.reload();
  }

  wait(timeout) {
    return new Promise((done) => {
      setTimeout(done, timeout);
    });
  }

  reload() {
    window.location.reload();
  }
}

let app = null;

if (window.app !== undefined) {
  app = window.app;
} else {
  window.app = app = new AppModel();
}

/**
 * @type {AppModel}
 */
export const App = app;
