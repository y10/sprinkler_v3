import { App } from "../system/app";

export class Sequence {
    constructor(data = {}) {
        this.order = data.order || [];
        this.startHour = data.startHour ?? 6;
        this.startMinute = data.startMinute ?? 0;
        this.duration = data.duration ?? 15;
        this.gap = data.gap ?? 5;
        this._days = data.days || [];
        this._previousDays = [...this._days]; // Track previous state for cleanup
    }

    get isEmpty() {
        return this.order.length === 0;
    }

    get days() {
        return this._days;
    }

    set days(value) {
        // Store previous days before updating (for cleanup of removed days)
        this._previousDays = [...this._days];
        this._days = value;
    }

    // Get days that were removed (in previous but not in current)
    get removedDays() {
        return this._previousDays.filter(d => !this._days.includes(d));
    }

    // Calculate start time for zone at position in sequence
    getZoneStartTime(zoneId, zoneDurations = {}) {
        const position = this.order.indexOf(zoneId);
        if (position === -1) return null;

        let minutes = this.startHour * 60 + this.startMinute;

        for (let i = 0; i < position; i++) {
            const prevZoneId = this.order[i];
            const prevDuration = zoneDurations[prevZoneId] || this.duration;
            minutes += prevDuration + this.gap;
        }

        return {
            h: Math.floor(minutes / 60) % 24,
            m: minutes % 60
        };
    }

    // Recalculate all zone times and return schedule object
    calculateSchedule(zoneDurations = {}) {
        const schedule = {};

        for (const zoneId of this.order) {
            const startTime = this.getZoneStartTime(zoneId, zoneDurations);
            const duration = zoneDurations[zoneId] || this.duration;

            schedule[zoneId] = {
                ...startTime,
                d: duration,
                sequenced: true
            };
        }

        return schedule;
    }

    toJson() {
        // Include current client timezone for UTC conversion (not stored)
        const tz = new Date().getTimezoneOffset() / 60;
        return {
            order: this.order,
            startHour: this.startHour,
            startMinute: this.startMinute,
            duration: this.duration,
            gap: this.gap,
            timezoneOffset: tz,  // Sent for conversion, not persisted
            days: this._days
        };
    }

    // Reset previous days tracking (call after successful save)
    commitDays() {
        this._previousDays = [...this._days];
    }

    // Check if any zone in sequence has a duration different from template
    hasCustomDurations() {
        for (const zoneId of this.order) {
            const zone = App.zones(zoneId);
            if (!zone || !zone.defined()) continue;

            // Get duration from first available day
            const day = this._days.length > 0 ? zone.days(this._days[0]) : zone.days('all');
            const timer = day.timers(0);
            const zoneDuration = timer.d || 0;

            if (zoneDuration > 0 && zoneDuration !== this.duration) {
                return true;
            }
        }
        return false;
    }

    // Get list of zones with custom durations
    getCustomDurationZones() {
        const customZones = [];
        for (const zoneId of this.order) {
            const zone = App.zones(zoneId);
            if (!zone || !zone.defined()) continue;

            const day = this._days.length > 0 ? zone.days(this._days[0]) : zone.days('all');
            const timer = day.timers(0);
            const zoneDuration = timer.d || 0;

            if (zoneDuration > 0 && zoneDuration !== this.duration) {
                customZones.push({ zoneId, duration: zoneDuration });
            }
        }
        return customZones;
    }

    // Reset all zones in sequence to template duration
    resetAllDurations() {
        for (const zoneId of this.order) {
            const zone = App.zones(zoneId);
            if (!zone || !zone.defined()) continue;

            // Set duration on all sequence days
            for (const dayName of this._days) {
                const day = zone.days(dayName);
                const timer = day.timers(0);
                timer.d = this.duration;
            }
        }
    }
}
