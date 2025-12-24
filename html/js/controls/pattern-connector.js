import { jQuery } from "../system/jquery";
import { Icons } from "../assets/icons";
import { App } from "../system/app";
import { MAX_ZONES } from "../config";

const template = (self) => `
<style>
.pattern-wrapper {
  position: relative;
  width: 80vw;
  max-width: 500px;
  margin: 0 auto;
}

.pattern-container {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
}

.pattern-container > * {
  margin: 0.5rem 0.5rem;
}

.zone-dot {
  position: relative;
  width: 7rem;
  min-height: 7rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.2s;
}

.zone-dot svg {
  width: 6rem;
  height: 6rem;
  color: #494949;
  transition: color 0.2s;
}

.zone-dot.selected svg {
  color: var(--info-background-color);
}

.zone-dot.disabled {
  pointer-events: none;
  opacity: 0.15;
}

.zone-dot.disabled svg {
  color: #494949;
}

.zone-dot .order-badge {
  display: none;
  position: absolute;
  top: 0;
  right: -5px;
  background: var(--info-background-color);
  color: white;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  font-size: 12px;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.zone-dot.selected .order-badge {
  display: flex;
}

.pattern-lines {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
}

.zone-label {
  font-size: 1.5rem;
  color: var(--primary-text-color);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 7rem;
  opacity: 0.8;
}
</style>

<div class="pattern-wrapper">
  <svg class="pattern-lines"></svg>
  <div class="pattern-container"></div>
</div>
`;

export class PatternConnector extends HTMLElement {
  connectedCallback() {
    this.selectedOrder = [];
    this.zoneDots = {};
    this.isDragging = false;
    this.trailingLine = null;
    this.hoverZone = null;
    this.hoverTimer = null;
    this.dwellTime = 200; // ms to hover before connecting

    this.jQuery = jQuery(this).attachShadowTemplate(template, ($) => {
      this.wrapper = $('.pattern-wrapper');
      this.container = $('.pattern-container');
      this.linesEl = $('.pattern-lines');
      this.renderZones();

      // Drag event listeners on wrapper for full coverage
      const wrapper = this.wrapper.item();
      wrapper.addEventListener('mousemove', this.onDragMove.bind(this));
      wrapper.addEventListener('mouseup', this.onDragEnd.bind(this));
      wrapper.addEventListener('mouseleave', this.onDragEnd.bind(this));
      wrapper.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
      wrapper.addEventListener('touchend', this.onDragEnd.bind(this));
      wrapper.addEventListener('touchcancel', this.onDragEnd.bind(this));
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  renderZones() {
    const iconHtml = Icons.sprinkler.replace(/width='100' height='100'/, "width='100%' height='100%'");

    for (let i = 0; i < MAX_ZONES; i++) {
      const zoneId = i + 1;
      const zone = App.zones(zoneId);
      const isDefined = zone.defined();

      const dot = document.createElement('div');
      dot.className = isDefined ? 'zone-dot' : 'zone-dot disabled';
      dot.setAttribute('data-zone-id', zoneId);

      dot.innerHTML = `
        <span class="order-badge"></span>
        ${iconHtml}
        <span class="zone-label">${isDefined ? (zone.name || 'Zone ' + zoneId) : ''}</span>
      `;

      if (isDefined) {
        dot.addEventListener('mousedown', (e) => this.onDragStart(zoneId, e));
        dot.addEventListener('touchstart', (e) => this.onTouchStart(zoneId, e), { passive: false });
        this.zoneDots[zoneId] = { element: dot };
      }

      this.container.item().appendChild(dot);
    }
  }

  getZoneCenter(zoneId) {
    const dot = this.zoneDots[zoneId]?.element;
    if (!dot) return null;

    const wrapper = this.wrapper.item();
    const wrapperRect = wrapper.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();

    return {
      x: dotRect.left - wrapperRect.left + dotRect.width / 2,
      y: dotRect.top - wrapperRect.top + dotRect.height / 2
    };
  }

  onTouchStart(zoneId, e) {
    e.preventDefault();
    const touch = e.touches[0];
    this.onDragStart(zoneId, { clientX: touch.clientX, clientY: touch.clientY });
  }

  onDragStart(zoneId, e) {
    // Start new sequence from this zone
    this.selectedOrder = [zoneId];
    this.isDragging = true;
    this.updateVisuals();

    // Create trailing line
    this.updateTrailingLine(e.clientX, e.clientY);
  }

  onTouchMove(e) {
    if (!this.isDragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    this.onDragMove({ clientX: touch.clientX, clientY: touch.clientY });
  }

  onDragMove(e) {
    if (!this.isDragging) return;

    // Update trailing line
    this.updateTrailingLine(e.clientX, e.clientY);

    // Check if hovering over a zone
    const hoveredZone = this.getZoneAtPoint(e.clientX, e.clientY);

    if (hoveredZone !== this.hoverZone) {
      // Zone changed - cancel any pending timer
      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
      }
      this.hoverZone = hoveredZone;

      // Start dwell timer for new zone
      if (hoveredZone !== null && !this.selectedOrder.includes(hoveredZone)) {
        this.hoverTimer = setTimeout(() => {
          if (this.isDragging && this.hoverZone === hoveredZone) {
            this.selectedOrder.push(hoveredZone);
            this.updateVisuals();
            this.updateTrailingLine(e.clientX, e.clientY);
          }
          this.hoverTimer = null;
        }, this.dwellTime);
      }
    }
  }

  onDragEnd() {
    if (!this.isDragging) return;
    this.isDragging = false;

    // Cancel any pending hover timer
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    this.hoverZone = null;

    // Remove trailing line
    if (this.trailingLine) {
      this.trailingLine.remove();
      this.trailingLine = null;
    }

    // Emit change event
    this.dispatchEvent(new CustomEvent('change', {
      detail: { order: [...this.selectedOrder] }
    }));
  }

  updateTrailingLine(clientX, clientY) {
    if (this.selectedOrder.length === 0) return;

    const wrapper = this.wrapper.item();
    const wrapperRect = wrapper.getBoundingClientRect();
    const x = clientX - wrapperRect.left;
    const y = clientY - wrapperRect.top;

    const lastZoneId = this.selectedOrder[this.selectedOrder.length - 1];
    const lastCenter = this.getZoneCenter(lastZoneId);
    if (!lastCenter) return;

    if (!this.trailingLine) {
      this.trailingLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      this.trailingLine.setAttribute('stroke', 'var(--info-background-color)');
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

  getZoneAtPoint(clientX, clientY) {
    const hitRadius = 50; // Zone hit area

    for (const [zoneId, data] of Object.entries(this.zoneDots)) {
      const dotRect = data.element.getBoundingClientRect();
      const zoneX = dotRect.left + dotRect.width / 2;
      const zoneY = dotRect.top + dotRect.height / 2;
      const dist = Math.sqrt((clientX - zoneX) ** 2 + (clientY - zoneY) ** 2);

      if (dist < hitRadius) {
        return parseInt(zoneId);
      }
    }
    return null;
  }

  updateVisuals() {
    // Update dot styles
    for (const [zoneId, data] of Object.entries(this.zoneDots)) {
      const index = this.selectedOrder.indexOf(parseInt(zoneId));
      const badge = data.element.querySelector('.order-badge');
      if (index !== -1) {
        data.element.classList.add('selected');
        badge.textContent = index + 1;
      } else {
        data.element.classList.remove('selected');
        badge.textContent = '';
      }
    }

    // Draw connecting lines
    this.drawLines();
  }

  drawLines() {
    const svg = this.linesEl.item();
    svg.innerHTML = '';

    for (let i = 1; i < this.selectedOrder.length; i++) {
      const fromId = this.selectedOrder[i - 1];
      const toId = this.selectedOrder[i];
      const from = this.getZoneCenter(fromId);
      const to = this.getZoneCenter(toId);

      if (!from || !to) continue;

      const x1 = from.x;
      const y1 = from.y;
      const x2 = to.x;
      const y2 = to.y;

      // Calculate control point for quadratic Bezier curve
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Perpendicular offset for curve (30% of distance)
      const curveAmount = dist * 0.3;
      // Alternate curve direction based on index
      const direction = (i % 2 === 0) ? 1 : -1;
      const cpX = midX + (dy / dist) * curveAmount * direction;
      const cpY = midY - (dx / dist) * curveAmount * direction;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} Q ${cpX} ${cpY} ${x2} ${y2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--info-background-color)');
      path.setAttribute('stroke-width', '3');
      path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path);
    }
  }

  clear() {
    this.selectedOrder = [];
    this.updateVisuals();
  }

  get order() {
    return [...this.selectedOrder];
  }

  set order(value) {
    this.selectedOrder = [...value];
    this.updateVisuals();
  }
}
