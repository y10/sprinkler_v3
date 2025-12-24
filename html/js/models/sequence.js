export class Sequence {
    constructor(data = {}) {
        this.order = data.order || [];
        this.startHour = data.startHour ?? 6;
        this.startMinute = data.startMinute ?? 0;
        this.duration = data.duration ?? 15;
        this.gap = data.gap ?? 5;
        this.days = data.days || [];
    }

    get isEmpty() {
        return this.order.length === 0;
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
        return {
            order: this.order,
            startHour: this.startHour,
            startMinute: this.startMinute,
            duration: this.duration,
            gap: this.gap,
            days: this.days
        };
    }
}
