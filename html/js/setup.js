import { Week } from "./controls/week";
import { PatternConnector } from "./controls/pattern-connector";
import { SprinklerIcon } from "./controls/sprinkler-icon";
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
import { SequenceBuilder } from "./screens/sequence-builder";

Module.register({
    'sketch-week': Week,
    'pattern-connector': PatternConnector,
    'sprinkler-icon': SprinklerIcon,
    'sprinkler-info': Info,
    'sprinkler-time': TimeSettings,
    'sprinkler-schedule': Schedule,
    'sprinkler-sequence-builder': SequenceBuilder,
    'sprinkler-update': Firmware,
    'sprinkler-setup': Setup,
    'sprinkler-setup-general': GeneralSettings,
    'sprinkler-setup-wifi': WifiSettings,
    'sprinkler-list-setup': ZonesSettings,
    'sprinkler-settings-zone': ZoneSettings,
});