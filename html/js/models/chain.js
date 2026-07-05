import { Http } from "../system/http";

const DEFAULT_DURATION = 15;
const DEFAULT_GAP = 5;

/**
 * Ephemeral ad-hoc "chain" of zones run back-to-back with a gap between them.
 * The firmware is the source of truth once started; this mirrors it for the UI
 * and issues the start/stop/update requests. Fires a `change` event on mutation.
 */
export class Chain extends EventTarget {
  constructor() {
    super();
    this._order = [];          // [zoneId, ...]
    this._durations = {};      // { zoneId: minutes }
    this._gap = DEFAULT_GAP;
    this._active = false;
    this._inGap = false;       // between zones (source off)
    this._currentIndex = 0;
  }

  // ---- build / query state ----------------------------------------------------
  hasItems() { return this._order.length > 0; }
  isActive() { return this._active; }
  isQueued(id) { return this._order.includes(parseInt(id)); }
  position(id) { return this._order.indexOf(parseInt(id)); }
  order() { return [...this._order]; }
  currentIndex() { return this._currentIndex; }
  isInGap() { return this._active && this._inGap; }

  currentZone() {
    return this._active && this._currentIndex < this._order.length
      ? this._order[this._currentIndex]
      : null;
  }

  isCurrent(id) { return this.currentZone() === parseInt(id); }

  isCompleted(id) {
    return this._active && this.isQueued(id) && this.position(id) < this._currentIndex;
  }

  isQueuedNotStarted(id) {
    // When idle there is no "queued-not-started" running semantics — an idle chain
    // starts on tap, so this must be false (else every idle tap would route to remove).
    if (!this._active) return false;
    if (!this.isQueued(id)) return false;
    return this.position(id) > this._currentIndex;
  }

  getDuration(id) {
    id = parseInt(id);
    return this._durations[id] ?? DEFAULT_DURATION;
  }

  // ---- build-phase mutation (idle) --------------------------------------------
  add(id, duration = DEFAULT_DURATION) {
    id = parseInt(id);
    if (this.isQueued(id)) return;
    this._order.push(id);
    this._durations[id] = duration;
    this._fire();
  }

  replace(orderArr) {
    if (this._active) {
      // A drag-replace over a RUNNING chain must stop it server-side, not just locally.
      Http.json("POST", "api/chain/stop").catch((e) => console.error(e));
      this._active = false;
      this._inGap = false;
      this._currentIndex = 0;
    }
    this._order = orderArr.map((id) => parseInt(id));
    const next = {};
    for (const id of this._order) {
      next[id] = this._durations[id] ?? DEFAULT_DURATION;
    }
    this._durations = next;
    this._fire();
  }

  setDuration(id, minutes) {
    id = parseInt(id);
    if (!this.isQueued(id)) return;
    let m = parseInt(minutes);
    if (!Number.isFinite(m) || m <= 0) m = DEFAULT_DURATION;  // 0/NaN -> default, never keep 0
    this._durations[id] = m;
    this._fire();
    // Running chain + not-yet-started slot -> persist the edit to the firmware tail.
    if (this._active && this.position(id) > this._currentIndex) this._pushTail();
  }

  // ---- running-phase mutation -------------------------------------------------
  // Remove a not-yet-started zone from a RUNNING chain. Firmware is the source of
  // truth, so we splice locally AND push the rewritten tail — a local-only splice
  // would be reverted by the next `chain` broadcast and the zone would still run.
  removeQueued(id) {
    id = parseInt(id);
    if (!this._active) return;
    if (this.position(id) <= this._currentIndex) return;  // can't remove running/completed
    const i = this._order.indexOf(id);
    if (i === -1) return;
    this._order.splice(i, 1);
    delete this._durations[id];
    this._fire();
    this._pushTail();
  }

  // POST the not-yet-started tail (starting with the currently-running zone).
  _pushTail() {
    if (!this._active) return;
    const tail = this._order.slice(this._currentIndex);  // [currentZone, ...remaining]
    const durations = {};
    for (const zid of tail) durations[zid] = this._durations[zid] ?? DEFAULT_DURATION;
    Http.json("POST", "api/chain/update", { order: tail, durations }).catch((e) => console.error(e));
  }

  clear() {
    const wasActive = this._active;
    this._order = [];
    this._durations = {};
    this._active = false;
    this._inGap = false;
    this._currentIndex = 0;
    if (wasActive) {
      Http.json("POST", "api/chain/stop").catch((e) => console.error(e));
    }
    this._fire();
  }

  async start() {
    if (this._order.length === 0) return false;
    const durations = {};
    for (const id of this._order) durations[id] = this._durations[id] ?? DEFAULT_DURATION;
    try {
      await Http.json("POST", "api/chain/start", {
        order: this._order,
        durations,
        gap: this._gap,
      });
      this._active = true;
      this._currentIndex = 0;
      this._inGap = false;
      this._fire();
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  async stop() {
    if (!this._active) return;
    try {
      await Http.json("POST", "api/chain/stop");
    } catch (e) {
      console.error(e);
    }
    // Server broadcasts chain:null; applyServerState will flip _active off. Also do it
    // optimistically so the UI reacts immediately.
    this._active = false;
    this._inGap = false;
    this._fire();
  }

  // ---- sync from WS event / GET /api/chain/state ------------------------------
  // Three payload shapes:
  //   null        -> user/external stop: revert to an IDLE built chain (keep order)
  //   {done:true} -> natural finish: CLEAR the chain (UI returns to baseline)
  //   {active,..} -> live sync of a running chain
  applyServerState(payload) {
    if (!payload) {
      this._active = false;
      this._inGap = false;
      this._currentIndex = 0;
      this._fire();
      return;
    }
    if (payload.done) {
      this._order = [];
      this._durations = {};
      this._active = false;
      this._inGap = false;
      this._currentIndex = 0;
      this._fire();
      return;
    }
    this._order = (payload.order || []).map((id) => parseInt(id));
    const durs = {};
    this._order.forEach((id, i) => {
      durs[id] = (payload.durations || [])[i] ?? DEFAULT_DURATION;
    });
    this._durations = durs;
    this._gap = payload.gap ?? DEFAULT_GAP;
    this._inGap = payload.inGap === true;
    this._active = payload.active === true;
    this._currentIndex = payload.currentIndex ?? 0;
    this._fire();
  }

  _fire() {
    this.dispatchEvent(new CustomEvent("change"));
  }
}
