import { String, Status, Http, Wsc, jQuery, Router } from "../system";
import { Icons } from "../assets/icons";
import { App } from "../system/app";
import { MAX_ZONES } from "../config";

const template = (self) => `
<style>
.chain-wrapper {
  position: relative;
  width: 80vw;
  max-width: 1024px;
  margin-left: auto;
  margin-right: auto;
}

.container {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
}

.container > * {
  margin: 0.5rem 0.5rem;
}

h1 {
  position: absolute;
  top: 0;
}

@media screen and (min-height: 730px) {
  h1 { top: 6%; }
  .chain-wrapper {
    max-width: 500px;
  }
}

.chain-lines {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
}

.zone-slot {
  position: relative;
}

.chain-badge {
  display: none;
  position: absolute;
  top: 0;
  right: -5px;
  background: #888888;
  color: white;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  font-size: 12px;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.chain-badge.show {
  display: flex;
}

.zone-slot.running .chain-badge {
  background: var(--info-background-color);
}

.zone-slot.gap .chain-badge {
  background: var(--warn-background-color);
}

.zone-slot.completed .chain-badge {
  background: #494949;
}

.zone-placeholder {
  width: 7rem;
  min-height: 7rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* Hide disabled zones on wide screens where they fit in one row */
@media screen and (min-width: 600px) {
  .zone-placeholder {
    display: none;
  }
}

</style>
<div class="chain-wrapper">
  <svg class="chain-lines"></svg>
  <div class="container">
    ${App.zones().count() > 0 ? String.join(
      [...Array(MAX_ZONES).keys()].map((o, i) => App.zones(i + 1)),
      (x) =>
        x.defined() ?
        `<div class="zone-slot" data-zone-id="${x.id}"><sketch-checkbox zone-id="${x.id}" placeholder="Zone ${x.id}" text="${x.name}" readonly></sketch-checkbox><span class="chain-badge"></span></div>` :
        `<span class="zone-placeholder"><sprinkler-icon size="6rem" disabled></sprinkler-icon><span style="height: 1.5rem;"></span></span>`
    ) : '<sprinkler-list-empty></sprinkler-list-empty>'}
  </div>
</div>`;
export class ZoneList extends HTMLElement {
  connectedCallback() {
    this.activeTimers = {}; // Track running zones: { zone: { startTime, duration } }
    this.progressInterval = null;

    // Drag-to-chain state
    this.slots = {};              // { zoneId: slotElement }
    this.dragCandidate = null;    // { zoneId, x, y }
    this.isDragging = false;
    this.selectedOrder = [];
    this.hoverZone = null;
    this.hoverTimer = null;
    this.trailingLine = null;
    this._suppressClicksUntil = 0;
    this.dwellTime = 200;
    this.dragThreshold = 8;

    // Bound handlers (needed for add/removeEventListener + Wsc/EventTarget cleanup)
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onTouchMove = this.onTouchMove.bind(this);
    this._onChainChange = () => this.renderChainOverlay();
    this.onChainState = (payload) => {
      if (payload && payload.done) Status.information("Chain finished");
      App.chain().applyServerState(payload);
    };

    this.jQuery = jQuery(this).attachShadowTemplate(template, ($) => {
      $("sketch-checkbox")
        .on('pick', this.onZoneClick.bind(this))
        .on('check', this.onZoneChecking.bind(this))
        .forEach(el => el.icon = Icons.sprinkler);

      this.chainWrapper = $('.chain-wrapper').item();
      this.linesEl = $('.chain-lines');

      // Collect slots + bind drag start on the wrapper (not the checkbox, so taps pass through).
      // Store the bound handlers so disconnectedCallback can remove them (avoids the leak class
      // the sibling scheduler feature had to fix — 2cc61c0).
      this._slotHandlers = [];
      $('.zone-slot').forEach((slot) => {
        const zoneId = parseInt(slot.getAttribute('data-zone-id'));
        this.slots[zoneId] = slot;
        const down = (e) => this.onPointerDown(zoneId, e.clientX, e.clientY);
        const start = (e) => this.onTouchStart(zoneId, e);
        slot.addEventListener('mousedown', down);
        slot.addEventListener('touchstart', start, { passive: true });
        this._slotHandlers.push({ slot, down, start });
      });

      if (this.chainWrapper) {
        this.chainWrapper.addEventListener('mousemove', this._onPointerMove);
        this.chainWrapper.addEventListener('mouseup', this._onPointerUp);
        this.chainWrapper.addEventListener('mouseleave', this._onPointerUp);
        this.chainWrapper.addEventListener('touchmove', this._onTouchMove, { passive: false });
        this.chainWrapper.addEventListener('touchend', this._onPointerUp);
        this.chainWrapper.addEventListener('touchcancel', this._onPointerUp);
      }

      Wsc.on("state", this.onUpdate, this);
      Wsc.on("chain", this.onChainState, this);
      App.chain().addEventListener('change', this._onChainChange);

      if ($(this).inViewport()) {
        this.updateAll().catch();
      }

      // Resync the chain from the firmware (repaints after a page reload mid-chain).
      Http.json("GET", "api/chain/state").then((payload) => {
        App.chain().applyServerState(payload);
      }).catch(() => {});

      this.renderChainOverlay();
    });
  }

  disconnectedCallback() {
    this.stopProgressInterval();
    if (this.hoverTimer) { clearTimeout(this.hoverTimer); this.hoverTimer = null; }  // else a pending dwell fires into the torn-down SVG
    Wsc.off("state", this.onUpdate);
    Wsc.off("chain", this.onChainState);
    App.chain().removeEventListener('change', this._onChainChange);

    if (this.chainWrapper) {
      this.chainWrapper.removeEventListener('mousemove', this._onPointerMove);
      this.chainWrapper.removeEventListener('mouseup', this._onPointerUp);
      this.chainWrapper.removeEventListener('mouseleave', this._onPointerUp);
      this.chainWrapper.removeEventListener('touchmove', this._onTouchMove);
      this.chainWrapper.removeEventListener('touchend', this._onPointerUp);
      this.chainWrapper.removeEventListener('touchcancel', this._onPointerUp);
    }

    if (this._slotHandlers) {
      this._slotHandlers.forEach(({ slot, down, start }) => {
        slot.removeEventListener('mousedown', down);
        slot.removeEventListener('touchstart', start);
      });
      this._slotHandlers = [];
    }

    this.jQuery().detach();
  }

  startProgressInterval() {
    if (this.progressInterval) return;
    this.progressInterval = setInterval(() => this.tickProgress(), 1000);
  }

  stopProgressInterval() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  tickProgress() {
    const now = Date.now();
    let hasActive = false;

    for (const [zone, timer] of Object.entries(this.activeTimers)) {
      const elapsed = now - timer.startTime;
      const total = timer.duration * 60 * 1000;
      const progress = Math.min(elapsed / total, 1);

      this.jQuery(`.container sketch-checkbox[zone-id="${zone}"]`).forEach(e => {
        e.progress = progress;
      });
      hasActive = true;
    }

    if (!hasActive) {
      this.stopProgressInterval();
    }
  }

  onUpdate(event) {
    if (!event) return;
    if (event.zone !== undefined) {
      this.update(event);          // single-zone "state" payload (start/stop/pause/resume)
      return;
    }
    // All-zones map payload (fired by stop-all — i.e. a chain stop/clear or schedule disable).
    // Reconcile every tile; a zone absent from the map is stopped. Without this, the tile that
    // was watering stays checked/green because update() ignores a payload with no top-level zone.
    this.jQuery('sketch-checkbox').forEach((x) => {
      const zone = parseInt(x.getAttribute('zone-id'));
      this.update((zone in event) ? event[zone] : { zone, state: 'stopped' });
    });
  }

  // ---- tap handlers -----------------------------------------------------------
  onZoneClick(e) {
    // long-press / double-tap -> duration ring (double-tap is not a distinct gesture)
    if (this._suppressClicksUntil && performance.now() < this._suppressClicksUntil) return;
    const checkbox = e.srcElement;
    const zoneid = checkbox.getAttribute("zone-id");
    const params = { 'zone-id': zoneid };
    if (App.chain().isQueued(zoneid)) params['chain'] = 'true';
    Router.navigate('zone', { popup: true, params });
  }

  onZoneChecking(e) {
    e.preventDefault();
    if (this._suppressClicksUntil && performance.now() < this._suppressClicksUntil) return;
    this.onZoneCheck(e);
  }

  onZoneCheck(e) {
    const checkbox = e.srcElement;
    const zoneid = parseInt(checkbox.getAttribute("zone-id"));
    if (checkbox.pending) return;
    const chain = App.chain();

    if (chain.hasItems()) {
      if (!chain.isActive()) {
        // idle built chain: tap a chained tile -> run the whole chain; tap an unchained tile -> extend it
        chain.isQueued(zoneid) ? chain.start() : chain.add(zoneid);
      } else if (chain.isCurrent(zoneid)) {
        // running tile -> stop the chain
        chain.stop();
      } else if (chain.isQueuedNotStarted(zoneid)) {
        // queued, not yet started -> remove from the remaining queue (server-side)
        chain.removeQueued(zoneid);
      } else if (!chain.isQueued(zoneid)) {
        // unchained tile during a run -> append is out of scope
        Status.information("Stop chain to add zones");
      }
      // completed tile during a run -> no-op
      return;
    }

    // No chain — original solo behavior
    const checked = !checkbox.checked;
    const command = checked
      ? checkbox.style.color
        ? "resume"
        : "start"
      : "stop";
    checkbox.pending = true;
    Http.json("GET", `api/zone/${zoneid}/${command}`).catch(err => {
      console.error(err);
      checkbox.pending = false;
    });
  }

  // ---- drag-to-chain ----------------------------------------------------------
  onPointerDown(zoneId, clientX, clientY) {
    this.dragCandidate = { zoneId, x: clientX, y: clientY };
    this.isDragging = false;
  }

  onTouchStart(zoneId, e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    this.onPointerDown(zoneId, t.clientX, t.clientY);
  }

  onTouchMove(e) {
    if (!this.dragCandidate) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    this.onPointerMove({ clientX: t.clientX, clientY: t.clientY });
    if (this.isDragging) e.preventDefault();  // suppress scroll while dragging
  }

  onPointerMove(e) {
    if (!this.dragCandidate) return;
    const { clientX, clientY } = e;

    if (!this.isDragging) {
      const dx = clientX - this.dragCandidate.x;
      const dy = clientY - this.dragCandidate.y;
      if (Math.sqrt(dx * dx + dy * dy) < this.dragThreshold) return;
      this.isDragging = true;
      this.selectedOrder = [this.dragCandidate.zoneId];
      this.drawConnectors(this.selectedOrder);
    }

    this.updateTrailingLine(clientX, clientY);

    const hovered = this.getZoneAtPoint(clientX, clientY);
    if (hovered !== this.hoverZone) {
      if (this.hoverTimer) { clearTimeout(this.hoverTimer); this.hoverTimer = null; }
      this.hoverZone = hovered;
      if (hovered !== null && !this.selectedOrder.includes(hovered)) {
        this.hoverTimer = setTimeout(() => {
          if (this.isDragging && this.hoverZone === hovered) {
            this.selectedOrder.push(hovered);
            this.drawConnectors(this.selectedOrder);
            this.updateTrailingLine(clientX, clientY);
          }
          this.hoverTimer = null;
        }, this.dwellTime);
      }
    }
  }

  onPointerUp(e) {
    if (this.hoverTimer) { clearTimeout(this.hoverTimer); this.hoverTimer = null; }
    this.hoverZone = null;

    if (this.isDragging) {
      if (e && e.preventDefault) e.preventDefault();
      this.isDragging = false;
      this._suppressClicksUntil = performance.now() + 500;  // swallow the phantom desktop click
      if (this.trailingLine) { this.trailingLine.remove(); this.trailingLine = null; }
      const order = [...this.selectedOrder];
      this.selectedOrder = [];
      if (order.length >= 2) {
        App.chain().replace(order);  // fires change -> renderChainOverlay
      } else {
        this.renderChainOverlay();   // discard a stray 1-zone drag, restore existing overlay
      }
    }
    this.dragCandidate = null;
  }

  getZoneCenter(zoneId) {
    const slot = this.slots[zoneId];
    if (!slot || !this.chainWrapper) return null;
    const wrapperRect = this.chainWrapper.getBoundingClientRect();
    const rect = slot.getBoundingClientRect();
    return {
      x: rect.left - wrapperRect.left + rect.width / 2,
      y: rect.top - wrapperRect.top + rect.height / 2
    };
  }

  getZoneAtPoint(clientX, clientY) {
    const hitRadius = 50;
    for (const [zoneId, slot] of Object.entries(this.slots)) {
      const rect = slot.getBoundingClientRect();
      const zx = rect.left + rect.width / 2;
      const zy = rect.top + rect.height / 2;
      if (Math.sqrt((clientX - zx) ** 2 + (clientY - zy) ** 2) < hitRadius) {
        return parseInt(zoneId);
      }
    }
    return null;
  }

  updateTrailingLine(clientX, clientY) {
    if (this.selectedOrder.length === 0 || !this.chainWrapper) return;
    const wrapperRect = this.chainWrapper.getBoundingClientRect();
    const x = clientX - wrapperRect.left;
    const y = clientY - wrapperRect.top;
    const lastCenter = this.getZoneCenter(this.selectedOrder[this.selectedOrder.length - 1]);
    if (!lastCenter) return;

    if (!this.trailingLine) {
      this.trailingLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      this.trailingLine.setAttribute('stroke', 'rgb(65, 184, 131)');
      this.trailingLine.setAttribute('stroke-width', '3');
      this.trailingLine.setAttribute('stroke-linecap', 'round');
      this.trailingLine.setAttribute('stroke-dasharray', '5,5');
      this.linesEl.item().appendChild(this.trailingLine);
    }
    this.trailingLine.setAttribute('x1', lastCenter.x);
    this.trailingLine.setAttribute('y1', lastCenter.y);
    this.trailingLine.setAttribute('x2', x);
    this.trailingLine.setAttribute('y2', y);
  }

  drawConnectors(order) {
    const svg = this.linesEl.item();
    svg.innerHTML = '';
    this.trailingLine = null;  // cleared by innerHTML reset
    for (let i = 1; i < order.length; i++) {
      const from = this.getZoneCenter(order[i - 1]);
      const to = this.getZoneCenter(order[i]);
      if (!from || !to) continue;

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      const curveAmount = dist * 0.3;
      const direction = (i % 2 === 0) ? 1 : -1;
      const cpX = midX + (dy / dist) * curveAmount * direction;
      const cpY = midY - (dx / dist) * curveAmount * direction;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${from.x} ${from.y} Q ${cpX} ${cpY} ${to.x} ${to.y}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgb(65, 184, 131)');
      path.setAttribute('stroke-width', '3');
      path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);
    }
  }

  renderChainOverlay() {
    if (this.isDragging) return;  // drag owns the overlay while active
    const chain = App.chain();

    for (const [zoneId, slot] of Object.entries(this.slots)) {
      const id = parseInt(zoneId);
      const badge = slot.querySelector('.chain-badge');
      const pos = chain.position(id);
      slot.classList.remove('queued', 'running', 'completed', 'gap');

      if (!chain.hasItems() || pos === -1) {
        if (badge) { badge.classList.remove('show'); badge.textContent = ''; }
        continue;
      }

      if (badge) {
        badge.textContent = pos + 1;
        badge.classList.add('show');
      }

      if (chain.isActive()) {
        if (chain.isCurrent(id)) {
          slot.classList.add(chain.isInGap() ? 'gap' : 'running');
        } else if (chain.isCompleted(id)) {
          slot.classList.add('completed');
        } else {
          slot.classList.add('queued');
        }
      } else {
        slot.classList.add('queued');
      }
    }

    if (chain.hasItems()) {
      this.drawConnectors(chain.order());
    } else {
      const svg = this.linesEl.item();
      svg.innerHTML = '';
      this.trailingLine = null;
    }
  }

  activate() {
    Wsc.off("state", this.onUpdate);
    Wsc.on("state", this.onUpdate, this);
    App.zones().current = null;
    this.updateAll();
  }

  deactivate() {
    Wsc.off("state", this.onUpdate);
  }

  async updateAll(retryCount = 0) {
    const MAX_RETRY_ATTEMPTS = 5;
    try {
      if (retryCount) {
        console.warn(`Attempt #${retryCount + 1}`);
      }
      const timers = await Http.json("GET", `api/state`);
      if (Object.keys(timers).length > 0) {
        this.jQuery(`sketch-checkbox`).forEach((x) => {
          const zone = parseInt(x.getAttribute("zone-id"));
          const state =
            zone in timers ? timers[zone] : { zone, state: "stopped" };
          this.update(state);
        });
      }
    } catch (error) {
      console.error(error);
      if (retryCount >= MAX_RETRY_ATTEMPTS) {
        console.error(`Max retry attempts (${MAX_RETRY_ATTEMPTS}) reached`);
        return;
      }
      const delay = Math.min(Math.pow(2, retryCount) * 1000, 30000);
      await new Promise((done) => setTimeout(done, delay));
      await this.updateAll(retryCount + 1);
    }
  }

  update(timer) {
    const { state, zone, millis, duration } = timer;
    if (zone) {
      this.jQuery(`.container sketch-checkbox[zone-id="${zone}"]`).forEach(
        (e, i) => {
          e.pending = false;
          if (state == "paused") {
            delete this.activeTimers[zone];
            e.style.color = "var(--warn-background-color)";
            e.progressColor = "var(--warn-background-color)";
            e.checked = false;
            if (duration > 0) {
              e.progress = millis / (duration * 60 * 1000);
            }
          } else if (state == "stopped") {
            delete this.activeTimers[zone];
            e.style.color = "";
            e.progressColor = "";
            e.checked = false;
            e.progress = 1; // Fully gray when stopped
          } else {
            // Started - track for real-time updates
            this.activeTimers[zone] = {
              startTime: Date.now() - millis,
              duration: duration
            };
            this.startProgressInterval();
            e.style.color = "";
            e.progressColor = "var(--info-background-color)";
            e.checked = true;
            if (duration > 0) {
              e.progress = millis / (duration * 60 * 1000);
            }
          }
        }
      );
    }
  }
}
