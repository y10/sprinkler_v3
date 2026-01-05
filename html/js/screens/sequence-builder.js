import { jQuery } from "../system/jquery";
import { App } from "../system/app";
import { String, Time } from "../system";

const template = (self) => `
<style>
.week {
  position: absolute;
  width: 280px;
  top: 25px;
}

@media screen and (min-height: 666px) {
  .week { top: 10%; }
}

.timer__time {
  color: var(--primary-text-color);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  font-size: 48px;
  position: absolute;
  bottom: 80px;
  width: 100%;
}

@media screen and (min-height: 666px) {
  .timer__time { bottom: 14%; }
}

.timer__time .colon {
  width: 20px;
  text-align: center;
}

.timer__time .spacer {
  width: 15px;
}

select {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--primary-text-color);
  font-size: 48px;
  text-align: center;
  min-width: 60px;
}

select option {
  background: var(--primary-background-color);
}

pattern-connector {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
</style>

<sketch-week id="days" class="week" multi-select="true"></sketch-week>

<pattern-connector id="pattern"></pattern-connector>

<span id="timer-time" class="timer__time">
  <select id="timer-time-hours"></select>
  <span class="colon">:</span>
  <select id="timer-time-minutes"></select>
  <span class="spacer"></span>
  <select id="timer-time-duration"></select>
</span>
`;

export class SequenceBuilder extends HTMLElement {
  connectedCallback() {
    this.jQuery = jQuery(this).attachShadowTemplate(template, ($) => {
      this.pattern = $('#pattern');
      this.weekPicker = $('#days');
      this.hourSelect = $('#timer-time-hours');
      this.minuteSelect = $('#timer-time-minutes');
      this.durationSelect = $('#timer-time-duration');

      this.initSelects();
      this.loadExisting();

      this.pattern.on('change', (e) => this.onPatternChange(e));
      this.weekPicker.on('change', (e) => this.onDaysChange(e));
      this.hourSelect.on('change', (e) => this.onTimeChange());
      this.minuteSelect.on('change', (e) => this.onTimeChange());
      this.durationSelect.on('change', (e) => this.onTimeChange());
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  initSelects() {
    // Hours 0-23
    for (let h = 0; h < 24; h++) {
      this.hourSelect.append(
        `<option value="${h}">${String.format00(h)}</option>`
      );
    }

    // Minutes 0-59
    for (let m = 0; m < 60; m++) {
      this.minuteSelect.append(
        `<option value="${m}">${String.format00(m)}</option>`
      );
    }

    // Duration options matching zone-settings
    [0, 5, 15, 20, 30].forEach(d => {
      this.durationSelect.append(
        `<option value="${d}" ${d === 15 ? 'selected' : ''}>${String.format00(d)}</option>`
      );
    });
  }

  loadExisting() {
    const seq = App.sequence();
    console.log('[SequenceBuilder] loadExisting, seq:', seq, 'isEmpty:', seq.isEmpty);
    if (!seq.isEmpty) {
      // Set time values (stored as local time, display directly)
      this.hourSelect.item().value = seq.startHour;
      this.minuteSelect.item().value = seq.startMinute;
      this.durationSelect.item().value = seq.duration;

      // Wait for child components to be ready
      this.waitForReady(() => {
        console.log('[SequenceBuilder] Components ready, setting order:', seq.order, 'days:', seq.days);
        // Set pattern order
        const patternEl = this.pattern.item();
        if (patternEl && patternEl.zoneDots && Object.keys(patternEl.zoneDots).length > 0) {
          patternEl.order = seq.order;
        }

        // Set selected days
        if (seq.days && seq.days.length > 0) {
          const weekEl = this.weekPicker.item();
          if (weekEl && weekEl.setSelectedDays) {
            weekEl.setSelectedDays(seq.days);
          }
        }
      });
    }
  }

  waitForReady(callback, attempts = 0) {
    const patternEl = this.pattern.item();
    const weekEl = this.weekPicker.item();

    // Check if components are ready
    const patternReady = patternEl && patternEl.zoneDots && Object.keys(patternEl.zoneDots).length > 0;
    const weekReady = weekEl && typeof weekEl.setSelectedDays === 'function';

    if (patternReady && weekReady) {
      callback();
    } else if (attempts < 20) {
      // Retry up to 20 times (2 seconds total)
      if (attempts === 0) {
        console.log('[SequenceBuilder] Waiting for components...', { patternReady, weekReady });
      }
      setTimeout(() => this.waitForReady(callback, attempts + 1), 100);
    } else {
      console.warn('[SequenceBuilder] Timeout waiting for components', { patternReady, weekReady });
    }
  }

  onPatternChange(e) {
    const seq = App.sequence();
    seq.order = e.detail.order;
    this.applyToZones();
  }

  onDaysChange(e) {
    const seq = App.sequence();
    seq.days = e.detail.days;
    this.applyToZones();
  }

  onTimeChange() {
    const seq = App.sequence();
    // Store local time - toJson() adds timezone for backend conversion
    seq.startHour = parseInt(this.hourSelect.item().value);
    seq.startMinute = parseInt(this.minuteSelect.item().value);
    seq.duration = parseInt(this.durationSelect.item().value);
    this.applyToZones();
  }

  applyToZones() {
    // Sequence is updated in App.sequence() - backend calculates zone timers on save
  }

  // Called when navigating away - save sequence
  save() {
    const patternEl = this.pattern.item();
    const order = patternEl ? patternEl.order : [];

    if (order.length === 0) return;

    const seq = App.sequence();
    seq.order = order;
    // Store local time - toJson() adds timezone for backend conversion
    seq.startHour = parseInt(this.hourSelect.item().value);
    seq.startMinute = parseInt(this.minuteSelect.item().value);
    seq.duration = parseInt(this.durationSelect.item().value);

    // Get selected days from week picker
    const weekEl = this.weekPicker.item();
    if (weekEl && weekEl.selectedDays) {
      seq.days = Array.from(weekEl.selectedDays);
    }

    // Backend calculates zone timers when App.save() is called
  }

  activate() {
    // Called when slide becomes visible
    App.zones().current = null;
  }

  deactivate() {
    // Called when leaving this slide - save changes
    this.save();
  }
}
