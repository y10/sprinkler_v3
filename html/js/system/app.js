import { MAX_ZONES } from "../config";
import { Status } from "./status";
import { Time } from "./time";
import { Log } from "./log";
import { Module } from "./module";
import { Store } from "../storage";
import { Zone } from "../models/zone";
import { ZoneSet } from "../models/zoneSet";

class AppModel {
  $settings = {};

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

  async load(modules) {
    try {
      const { zones } = await this.settings();
      if (zones && Object.keys(zones).length > 0) {
        this.$zones = new ZoneSet(zones);
      }
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
    const state = { logLevel, name, chip, zones };
    try {
      const json = await Store.put(state);
      if (json && json !== state) {
        this.$settings = { ...json };
        if ("zones" in json && Object.keys(json.zones).length > 0) {
          this.$zones = new ZoneSet(json.zones);
          return true;
        }
      }
    } catch (error) {
      Status.error(error);
    }

    spinner.close();
    return false;
  }

  /**
   * @param {string} id - zone id to return;
   * @returns {Zone}
   */
  logLevel(level) {
    if (level === undefined) {
      const { logLevel } = this.$settings;
      return logLevel || "none";
    }

    return this.loglevelAsync(level);
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
