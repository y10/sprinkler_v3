// Mock HTTP module for UI testing without hardware

const MOCK_ZONES = [
    { name: "Front Lawn", index: 0 },
    { name: "Back Yard", index: 1 },
    { name: "Side Garden", index: 2 },
    { name: "Flower Beds", index: 3 },
    { name: "Veggie Patch", index: 4 }
];

const MOCK_SETTINGS = {
    logLevel: "info",
    name: "Sprinkler Controller",
    ssid: "MockNetwork",
    host: "sprinkler",
    source: "city",
    enabled: true
};

// Runtime state for active watering sessions
const zoneState = {};

// Runtime state for the ad-hoc chain (mock of the firmware SequenceSession).
const mockChain = {
    order: [],
    durations: {},   // { zoneId: minutes }
    gap: 5,
    active: false,
    inGap: false,
    currentIndex: 0
};

function mockChainState() {
    if (!mockChain.active) return null;
    return {
        active: true,
        adhoc: true,
        paused: false,
        currentIndex: mockChain.currentIndex,
        totalZones: mockChain.order.length,
        gap: mockChain.gap,
        inGap: mockChain.inGap,
        order: [...mockChain.order],
        durations: mockChain.order.map((z) => mockChain.durations[z] ?? 15)
    };
}

function chainStart(body) {
    mockChain.order = (body.order || []).map((z) => parseInt(z));
    mockChain.durations = {};
    mockChain.order.forEach((z) => {
        mockChain.durations[z] = (body.durations && body.durations[z]) || 15;
    });
    mockChain.gap = body.gap ?? 5;
    mockChain.active = true;
    mockChain.inGap = false;
    mockChain.currentIndex = 0;
    return { ok: true };
}

function chainUpdate(body) {
    if (!mockChain.active) return { ok: true };
    const tail = (body.order || []).map((z) => parseInt(z));
    if (tail.length === 0 || tail[0] !== mockChain.order[mockChain.currentIndex]) return { ok: true };
    const head = mockChain.order.slice(0, mockChain.currentIndex);
    mockChain.order = [...head, ...tail].slice(0, 6);  // match firmware's 6-zone clamp
    tail.forEach((z) => {
        mockChain.durations[z] = (body.durations && body.durations[z]) || mockChain.durations[z] || 15;
    });
    return { ok: true };
}

function chainStop() {
    mockChain.active = false;
    mockChain.inGap = false;
    mockChain.currentIndex = 0;
    return { ok: true };
}

function getEmptyTimers() {
    return MOCK_ZONES.map((z, i) => ({
        h: 0, m: 0, d: 0
    }));
}

function createTimer(h, m, d) {
    return { h, m, d };
}

function generateSchedule() {
    const days = ["all", "mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const schedule = {};
    days.forEach(day => {
        schedule[day] = [
            createTimer(6, 30, 10),
            createTimer(0, 0, 0)
        ];
    });
    return schedule;
}

function generateZonesSettings() {
    const zones = {};
    MOCK_ZONES.forEach((zone, index) => {
        zones[index + 1] = {
            name: zone.name,
            days: generateSchedule()
        };
    });
    return zones;
}

function getZoneTimerState(zoneIndex) {
    const state = zoneState[zoneIndex];
    if (!state) {
        return { state: "stopped" };
    }

    const now = Date.now();
    const elapsed = state.pauseTime
        ? state.pauseTime - state.startTime
        : now - state.startTime;

    return {
        state: state.paused ? "paused" : "started",
        zone: zoneIndex,
        millis: elapsed,
        duration: state.duration
    };
}

function getAllZoneStates() {
    const states = [];
    for (let i = 0; i < MOCK_ZONES.length; i++) {
        const state = getZoneTimerState(i);
        if (state.state !== "stopped") {
            states.push(state);
        }
    }
    return states;
}

function startZone(zoneIndex, duration) {
    zoneState[zoneIndex] = {
        startTime: Date.now(),
        duration: duration,
        paused: false,
        pauseTime: null
    };

    // Auto-stop after duration
    setTimeout(() => {
        if (zoneState[zoneIndex]) {
            delete zoneState[zoneIndex];
        }
    }, duration * 60 * 1000);

    return getZoneTimerState(zoneIndex);
}

function stopZone(zoneIndex) {
    delete zoneState[zoneIndex];
    return { state: "stopped" };
}

function pauseZone(zoneIndex) {
    const state = zoneState[zoneIndex];
    if (state && !state.paused) {
        state.paused = true;
        state.pauseTime = Date.now();
    }
    return getZoneTimerState(zoneIndex);
}

function resumeZone(zoneIndex) {
    const state = zoneState[zoneIndex];
    if (state && state.paused) {
        const pausedDuration = state.pauseTime - state.startTime;
        state.startTime = Date.now() - pausedDuration;
        state.paused = false;
        state.pauseTime = null;
    }
    return getZoneTimerState(zoneIndex);
}

function parseUrl(url) {
    let [path, queryString] = url.split('?');
    // Normalize path to always have leading slash
    if (!path.startsWith('/')) {
        path = '/' + path;
    }
    const params = {};
    if (queryString) {
        queryString.split('&').forEach(pair => {
            const [key, value] = pair.split('=');
            params[key] = value;
        });
    }
    return { path, params };
}

function routeRequest(method, url, body) {
    const { path, params } = parseUrl(url);

    // Ad-hoc chain endpoints
    if (path === '/api/chain/start') return chainStart(body || {});
    if (path === '/api/chain/update') return chainUpdate(body || {});
    if (path === '/api/chain/stop') return chainStop();
    if (path === '/api/chain/state') return mockChainState();

    // Zone control endpoints
    const zoneMatch = path.match(/\/api\/zone\/(\d+)\/(\w+)/);
    if (zoneMatch) {
        const zoneIndex = parseInt(zoneMatch[1]);
        const action = zoneMatch[2];

        switch (action) {
            case 'start':
                const duration = parseInt(params.d) || 5;
                return startZone(zoneIndex, duration);
            case 'stop':
                return stopZone(zoneIndex);
            case 'pause':
                return pauseZone(zoneIndex);
            case 'resume':
                return resumeZone(zoneIndex);
            case 'state':
                return getZoneTimerState(zoneIndex);
        }
    }

    // State endpoint
    if (path === '/api/state') {
        return getAllZoneStates();
    }

    // Schedule endpoints
    if (path === '/api/schedule') {
        return { state: MOCK_SETTINGS.enabled ? "enabled" : "disabled" };
    }
    const scheduleMatch = path.match(/\/api\/schedule\/(\w+)/);
    if (scheduleMatch) {
        const action = scheduleMatch[1];
        MOCK_SETTINGS.enabled = (action === 'enable');
        return { state: MOCK_SETTINGS.enabled ? "enabled" : "disabled" };
    }

    // Settings endpoints
    if (path === '/api/settings') {
        return {
            ...MOCK_SETTINGS,
            zones: generateZonesSettings(),
            sequence: null // No sequence by default
        };
    }
    if (path === '/api/settings/zones') {
        return generateZonesSettings();
    }
    if (path === '/api/settings/general') {
        return { name: MOCK_SETTINGS.name, host: MOCK_SETTINGS.host };
    }

    // ESP endpoints
    if (path === '/esp/time') {
        const now = new Date();
        return {
            d: `${now.getDate()} ${now.toLocaleString('en', { month: 'short' })} ${now.getFullYear()}`,
            h: now.getHours().toString(),
            m: now.getMinutes().toString(),
            s: now.getSeconds().toString()
        };
    }
    if (path === '/esp/log') {
        return { logs: ["[mock] System started", "[mock] WiFi connected", "[mock] HTTP server ready"] };
    }

    // Default empty response
    return {};
}

function timeout(options, defaultValue) {
    if (!defaultValue) defaultValue = 500;
    return options ? options["timeout"] || defaultValue : defaultValue;
}

function send(method, service, options, body) {
    return new Promise((done, error) => {
        console.log(`[MOCK] ${method}: ${service}`, body ?? "");
        setTimeout(() => {
            try {
                const result = routeRequest(method, service, body);
                console.log(`[MOCK] Response:`, result);
                done(result);
            } catch (e) {
                console.error(`[MOCK] Error:`, e);
                error(e.message);
            }
        }, Math.random() * 200 + 100); // 100-300ms delay
    });
}

export class Http {
    static get(service, params, options) {
        let url = service;
        if (params) {
            const queryString = Object.entries(params)
                .map(([k, v]) => `${k}=${v}`)
                .join('&');
            url += '?' + queryString;
        }
        return send("GET", url, options);
    }

    static postJson(service, params, options) {
        return send("POST", service, options, params);
    }

    static postForm(service, data, options) {
        return send("POST", service, options);
    }

    static post(service, params, options) {
        if (params instanceof FormData) {
            return this.postForm(service, params, options)
        }
        else {
            return this.postJson(service, params, options)
        }
    }

    static async json(method, service, params, options) {
        return send(method, service, options, method.toUpperCase() === "GET" ? undefined : params);
    }

    static import(file) {
        var scriptTag = document.createElement("script");
        scriptTag.src = file;
        scriptTag.async = true;

        document.body.appendChild(scriptTag);

        return new Promise((done, error) => {
            scriptTag.onload = function () {
                done();
            }
        });
    }
}
