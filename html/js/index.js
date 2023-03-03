import { Index } from "./screens/index";
import { Main } from "./screens/main";
import { Menu } from "./screens/menu";
import { Zone } from "./screens/zone";
import { ZoneList } from "./screens/zone-list";
import { EmptyZoneList } from "./screens/zone-list-empty";

import { MenuToggle } from "./controls/menu-toggle";
import { MenuBottom } from "./controls/menu-bottom";
import { Checkbox } from "./controls/checkbox";
import { Snackbar } from "./controls/snackbar";
import { Slider } from "./controls/slider";
import { Spinner } from "./controls/spinner";
import { Outlet } from "./controls/outlet";

import { App } from "./system/app";

import "./system/touch";
import "./system/key";
import "./system/log";

App.load({
    'sketch-outlet': Outlet.forRoot({
        './': {
            'main': 'sprinkler-main',
            'menu': 'sprinkler-menu',
            'zone': 'sprinkler-zone'
        },
        './js/setup.js': {
            'settings': 'sprinkler-settings',
            'schedule': 'sprinkler-schedule',
            'update': 'sprinkler-update',
            'zones': 'sprinkler-list-setup',
            'setup': 'sprinkler-setup',
            'info': 'sprinkler-info'
        }
    }),
    'sketch-slider': Slider,
    'sketch-spinner': Spinner,
    'sketch-checkbox': Checkbox,
    'sketch-snackbar': Snackbar,
    'sketch-menu-toggle': MenuToggle,
    'sketch-menu-bottom': MenuBottom,
    'sprinkler-main': Main,
    'sprinkler-menu': Menu,
    'sprinkler-list-empty': EmptyZoneList,
    'sprinkler-list': ZoneList,
    'sprinkler-zone': Zone,
    'sprinkler-app': Index,
});