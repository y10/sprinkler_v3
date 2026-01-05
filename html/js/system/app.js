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
  $initialSnapshot = null;  // Track initial state for dirty checking

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

  async load(modules) {
    try {
      const { zones, sequence } = await this.settings();
      if (zones && Object.keys(zones).length > 0) {
        this.$zones = new ZoneSet(zones);
      }
      if (sequence) {
        // Use sequence from backend directly - no derivation needed
        this.$sequence = new Sequence(sequence);
        console.log('[Sequence] Loaded from backend:', sequence);
      } else {
        // No sequence configured yet - start with empty
        this.$sequence = new Sequence();
        console.log('[Sequence] No sequence in backend, starting fresh');
      }
      // Capture initial snapshot for dirty checking
      this.$initialSnapshot = this.getSnapshot();
      Module.register(modules);
    } catch(error) {
      console.log(error);
      Module.register(modules);
      Status.error("Failed to load zones from the server. <a href='./index.html' taget='self'>Reload</a>");
    }
  }

  async save() {
    const spinner = Status.wait();
    const logLevel = this.logLevel();
    const chip = this.hostname();
    const name = this.friendlyName();
    const zones = this.$zones.toJson();
    const sequence = this.$sequence ? this.$sequence.toJson() : null;
    const state = { logLevel, name, chip, zones, sequence };
    try {
      const json = await Store.put(state);
      if (json && json !== state) {
        this.$settings = { ...json };
        if ("zones" in json && Object.keys(json.zones).length > 0) {
          this.$zones = new ZoneSet(json.zones);
        }
        if ("sequence" in json && json.sequence) {
          this.$sequence = new Sequence(json.sequence);
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

  getSnapshot() {
    return JSON.stringify({
      zones: this.$zones.toJson(),
      sequence: this.$sequence ? this.$sequence.toJson() : null
    });
  }

  isScheduleDirty() {
    if (!this.$initialSnapshot) return false;
    return this.getSnapshot() !== this.$initialSnapshot;
  }

  resetScheduleSnapshot() {
    this.$initialSnapshot = this.getSnapshot();
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
