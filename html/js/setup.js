import { Week } from "./controls/week";
import { Module } from "./system/module";
import { Info } from "./screens/info";
import { Setup } from "./screens/setup";
import { GeneralSettings } from "./screens/setup-general";
import { ZonesSettings } from "./screens/zone-list-setup";
import { TimeSettings } from "./screens/time";
import { WifiSettings } from "./screens/setup-wifi";
import { Firmware } from "./screens/update";
import { ZoneSettings } from "./screens/zone-settings";
import { Schedule } from "./screens/schedule";

Module.register({
    'sketch-week': Week,
    'sprinkler-info': Info,
    'sprinkler-time': TimeSettings,
    'sprinkler-schedule': Schedule,
    'sprinkler-update': Firmware,
    'sprinkler-setup': Setup,
    'sprinkler-setup-general': GeneralSettings,
    'sprinkler-setup-wifi': WifiSettings,
    'sprinkler-list-setup': ZonesSettings,
    'sprinkler-settings-zone': ZoneSettings,
});