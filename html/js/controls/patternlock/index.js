import { jQuery } from "../../system/jquery";
import { Icons } from "../../assets/icons";

import {
  css,
  addClass,
  removeClass,
  noop,
  getLengthAngle,
  remove,
  createDom,
  toArray,
  assign,
} from "./util";

const privateMap = new WeakMap();

class PatternLockInternal {
  constructor() {
    this.holder = null;
    this.option = null;
    this.mapperFunc = noop;
    this.wrapLeft = 0;
    this.wrapTop = 0;
    this.disabled = false;
    this.patternAry = [];
    this.lastPosObj = [];
    this.rightPattern = null;
    this.onSuccess = noop;
    this.onError = noop;
    this.pattCircle = null;
    this.lineX1 = 0;
    this.lineY1 = 0;
    this.line = null;
    this.lastPosObj = null;
  }

  getIdxFromPoint(x, y) {
    const { option } = this;
    const { matrix, margin } = option;

    const xi = x - this.wrapLeft;
    const yi = y - this.wrapTop;

    const plotLn = option.radius * 2 + margin * 2;

    const qsntX = Math.ceil(xi / plotLn);
    const qsntY = Math.ceil(yi / plotLn);

    const remX = xi % plotLn;
    const remY = yi % plotLn;

    let idx = null;

    if (
      qsntX <= matrix[1] &&
      qsntY <= matrix[0] &&
      remX > margin * 2 &&
      remY > margin * 2
    ) {
      idx = (qsntY - 1) * matrix[1] + qsntX;
    }

    return {
      idx,
      i: qsntX,
      j: qsntY,
      x: xi,
      y: yi,
    };
  }

  markPoint(elm, pattId) {
    // add the current element on pattern
    addClass(elm, "hovered");

    // push pattern on array
    this.patternAry.push(pattId);

    console.log(this.patternAry);

    this.lastElm = elm;
  }

  // method to add lines between two element
  addLine(posObj) {
    const { patternAry, option } = this;

    // add start point for line
    const { lineOnMove, margin, radius } = option;

    const newX =
      (posObj.i - 1) * (2 * margin + 2 * radius) + 2 * margin + radius;
    const newY =
      (posObj.j - 1) * (2 * margin + 2 * radius) + 2 * margin + radius;

    if (patternAry.length > 1) {
      // to fix line
      const { length, angle } = getLengthAngle(
        this.lineX1,
        newX,
        this.lineY1,
        newY
      );

      css(this.line, {
        width: `${length + 10}px`,
        transform: `rotate(${angle}deg)`,
      });

      if (!lineOnMove) css(this.line, { display: "block" });
    }

    // to create new line
    const line = createDom(
      `<div class="patt-lines" style="top:${newY - 5}px; left: ${
        newX - 5
      }px;"></div>`
    );

    this.line = line;
    this.lineX1 = newX;
    this.lineY1 = newY;
    // add on dom

    this.holder.appendChild(line);
    if (!lineOnMove) css(this.line, { display: "none" });
  }

  // add direction on point and line
  addDirectionClass(curPos) {
    const { lastElm: point, line, lastPosObj: lastPos } = this;

    let direction = [];

    if (curPos.j - lastPos.j > 0) {
      direction.push("s");
    } else if (curPos.j - lastPos.j < 0) {
      direction.push("n");
    }

    if (curPos.i - lastPos.i > 0) {
      direction.push("e");
    } else if (curPos.i - lastPos.i < 0) {
      direction.push("w");
    }

    direction = direction.join("-");

    if (direction) {
      const className = `${direction} dir`;
      addClass(point, className);
      addClass(line, className);
    }
  }
}

const template = `
<style>
.patt-holder{-ms-touch-action: none;}
.patt-wrap{position:relative; cursor:pointer;}
.patt-wrap ul, .patt-wrap li{
	list-style: none;
	margin:0;
	padding: 0;
}
.patt-circ{
	position:relative;
	float: left;
	box-sizing: border-box;
	-moz-box-sizing: border-box;
 }
.patt-circ.hovered{
	border:3px solid #009900;
}

.patt-error .patt-circ.hovered{
	border:3px solid #BA1B26;
}

.patt-hidden .patt-circ.hovered{border:0;}

.patt-icon{
  margin-top:-20px;
  margin-left:-200%;
}

.patt-text{
  white-space: nowrap;
  margin-left:-200%;
}
.patt-dots{
	background: #FFF;
	width: 10px;height: 10px;
	border-radius:5px;
	position:absolute;
	top:50%;
	left:50%;
	margin-top:-5px;
	margin-left:-5px;
}
.patt-lines{
	border-radius:5px;
	height:10px;
	background:rgba(255,255,255,.7);
	position:absolute;
	transform-origin:5px 5px;
	-ms-transform-origin:5px 5px; /* IE 9 */
	-webkit-transform-origin:5px 5px;
}

.patt-hidden .patt-lines{
	display:none;
}
</style>
<div id="container"></div>`;
export class PatternLock extends HTMLElement {
  connectedCallback() {
    const iObj = new PatternLockInternal();

    this.jQuery = jQuery(this).attachShadowTemplate(template, ($) => {
      const holder = $("#container").item();

      // if holder is not present return
      if (!holder || holder.length === 0) return;

      // optimizing options
      const defaultsFixes = {
        onDraw: noop,
      };

      const option = {};

      if (this.hasAttribute("lineOnMove")) option.lineOnMove = true;
      if (this.hasAttribute("patternVisible")) option.patternVisible = true;
      if (this.hasAttribute("enableSetPattern")) option.enableSetPattern = true;
      if (this.hasAttribute("noRepeat")) option.allowRepeat = false;
      if (this.hasAttribute("radius"))
        option.radius = parseInt(this.getAttribute("radius"));
      if (this.hasAttribute("margin"))
        option.margin = parseInt(this.getAttribute("margin"));
      if (this.hasAttribute("matrix"))
        option.matrix = this.getAttribute("matrix")
          .split("x")
          .map((x) => parseInt(x));
      if (this.hasAttribute("pattern"))
        option.pattern = this.getAttribute("pattern")
          .split(",")
          .map((x) => parseInt(x));

      const { matrix } = option;
      if (matrix && matrix[0] * matrix[1] > 9) defaultsFixes.delimiter = ",";

      iObj.option = assign({}, PatternLock.defaults, defaultsFixes, option);

      // add a mapper function
      const { mapper } = iObj.option;
      if (typeof mapper === "object") {
        iObj.mapperFunc = (idx) => mapper[idx];
      } else if (typeof mapper === "function") {
        iObj.mapperFunc = mapper;
      } else {
        iObj.mapperFunc = noop;
      }

      // delete mapper from option object
      iObj.option.mapper = null;
      iObj.holder = holder;

      //set object to private map
      privateMap.set(this, iObj);

      //render
      this._render();

      // add class on holder
      addClass(holder, "patt-holder");

      // change offset property of holder if it does not have any property
      if (css(holder, "position") === "static")
        css(holder, { position: "relative" });

      // assign event
      holder.addEventListener("touchstart", this._onStart);
      holder.addEventListener("mousedown", this._onStart);

      if (option.pattern) {
        this.setPattern(option.pattern);
      }
    });
  }

  disconnectedCallback() {
    this.jQuery().detach();
  }

  // get drawn pattern as string
  getPattern() {
    const { patternAry, option } = privateMap.get(this);

    return (patternAry || []).join(option.delimiter);
  }

  // method to draw a pattern dynamically
  setPattern(pattern) {
    const iObj = privateMap.get(this);

    const { option } = iObj;

    const { matrix, margin, radius, enableSetPattern, delimiter } = option;

    // allow to set password manually only when enable set pattern option is true
    if (!enableSetPattern) return;

    // check if pattern is string break it with the delimiter
    const patternAry =
      typeof pattern === "string" ? pattern.split(delimiter) : pattern;

    this.reset();
    iObj.wrapLeft = 0;
    iObj.wrapTop = 0;

    for (let i = 0; i < patternAry.length; i += 1) {
      const idx = patternAry[i] - 1;

      const x = idx % matrix[1];
      const y = Math.floor(idx / matrix[1]);

      const clientX = x * (2 * margin + 2 * radius) + 2 * margin + radius;
      const clientY = y * (2 * margin + 2 * radius) + 2 * margin + radius;

      this._onMove.call(
        null,
        {
          clientX,
          clientY,
          preventDefault: noop,
        },
        this
      );
    }
  }

  // to temporary enable disable plugin
  enable() {
    const iObj = privateMap.get(this);

    iObj.disabled = false;
  }

  disable() {
    const iObj = privateMap.get(this);

    iObj.disabled = true;
  }

  // reset pattern lock
  reset() {
    const iObj = privateMap.get(this);

    // to remove lines and class from each points
    toArray(iObj.pattCircle).forEach((el) =>
      removeClass(el, "hovered dir s n w e s-w s-e n-w n-e")
    );
    remove(iObj.holder.querySelectorAll(".patt-lines"));

    // add/reset a array which capture pattern
    iObj.patternAry = [];

    // remove last Obj
    iObj.lastPosObj = null;

    // remove error class if added
    removeClass(iObj.holder, "patt-error");
  }

  // to display error if pattern is not drawn correct
  error() {
    const iObj = privateMap.get(this);

    addClass(iObj.holder, "patt-error");
  }

  // to check the drawn pattern against given pattern
  checkForPattern(pattern, success, error) {
    const iObj = privateMap.get(this);

    iObj.rightPattern = pattern;
    iObj.onSuccess = success || noop;
    iObj.onError = error || noop;
  }

  _onStart = (e) => {
    e.preventDefault();
    const iObj = privateMap.get(this);
    const { holder } = iObj;

    if (iObj.disabled) return;

    // check if pattern is visible or not
    if (!iObj.option.patternVisible) {
      addClass(iObj.holder, "patt-hidden");
    }

    this.moveEvent = e.type === "touchstart" ? "touchmove" : "mousemove";
    this.endEvent = e.type === "touchstart" ? "touchend" : "mouseup";

    // assign events
    holder.addEventListener(this.moveEvent, this._onMove);

    document.addEventListener(this.endEvent, this._onEnd);

    // set pattern offset
    const wrap = iObj.holder.querySelector(".patt-wrap");

    const offset = wrap.getBoundingClientRect();
    iObj.wrapTop = offset.top;
    iObj.wrapLeft = offset.left;

    // reset pattern
    this.reset();
  };

  _onMove = (e) => {
    e.preventDefault();
    const iObj = privateMap.get(this);
    const { option, patternAry } = iObj;

    const x = e.clientX || e.touches[0].clientX;
    const y = e.clientY || e.touches[0].clientY;

    const li = iObj.pattCircle;
    const posObj = iObj.getIdxFromPoint(x, y);
    const { idx } = posObj;
    const pattId = iObj.mapperFunc(idx) || idx;

    if (patternAry.length > 0) {
      const { length, angle } = getLengthAngle(
        iObj.lineX1,
        posObj.x,
        iObj.lineY1,
        posObj.y
      );

      css(iObj.line, {
        width: `${length + 10}px`,
        transform: `rotate(${angle}deg)`,
      });
    }

    if (
      idx &&
      ((option.allowRepeat && patternAry[patternAry.length - 1] !== pattId) ||
        patternAry.indexOf(pattId) === -1)
    ) {
      const elm = li[idx - 1];

      // mark if any points are in middle of previous point and current point, if it does check them
      if (option.pathThrough) {
        if (iObj.lastPosObj) {
          const { lastPosObj } = iObj;

          const xDelta = posObj.i - lastPosObj.i > 0 ? 1 : -1;
          const yDelta = posObj.j - lastPosObj.j > 0 ? 1 : -1;
          let ip = lastPosObj.i;
          let jp = lastPosObj.j;
          let iDiff = Math.abs(posObj.i - ip);
          let jDiff = Math.abs(posObj.j - jp);

          while (
            (iDiff === 0 && jDiff > 1) ||
            (jDiff === 0 && iDiff > 1) ||
            (jDiff === iDiff && jDiff > 1)
          ) {
            ip = iDiff ? ip + xDelta : ip;
            jp = jDiff ? jp + yDelta : jp;
            iDiff = Math.abs(posObj.i - ip);
            jDiff = Math.abs(posObj.j - jp);

            const nextIdx = (jp - 1) * option.matrix[1] + ip;
            const nextPattId = iObj.mapperFunc(nextIdx) || nextIdx;

            if (option.allowRepeat || patternAry.indexOf(nextPattId) === -1) {
              // add direction to previous point and line
              iObj.addDirectionClass({ i: ip, j: jp });

              // mark a point added
              iObj.markPoint(li[nextPattId - 1], nextPattId);

              // add line between the points
              iObj.addLine({ i: ip, j: jp });
            }
          }
        }

        // add direction to last point and line
        if (iObj.lastPosObj) iObj.addDirectionClass(posObj);
      }

      // mark the initial point added
      iObj.markPoint(elm, pattId);

      // add initial line
      iObj.addLine(posObj);

      iObj.lastPosObj = posObj;
    }
  };

  _onEnd = (e) => {
    e.preventDefault();
    const iObj = privateMap.get(this);
    const { option } = iObj;

    const pattern = iObj.patternAry.join(option.delimiter);

    // remove hidden pattern class and remove event
    iObj.holder.removeEventListener(this.moveEvent, this._onMove);
    document.removeEventListener(this.endEvent, this._onEnd);
    removeClass(iObj.holder, "patt-hidden");

    if (!pattern) return;

    // to remove last line
    remove(iObj.line);

    option.onDraw(pattern);

    if (iObj.rightPattern) {
      if (pattern === iObj.rightPattern) {
        iObj.onSuccess();
      } else {
        iObj.onError();
        this.error();
      }
    }
  };

  _renderCircle = (x, i) => {
    const { margin, radius } = privateMap.get(this).option;

    return `<li 
      class="patt-circ"
      style="margin: ${margin}px; width: ${radius * 2}px; height: ${
      radius * 2
    }px; border-radius: ${radius}px;"
    >
      <div class="patt-dots">
        <div class="patt-icon">${Icons.sprinkler}</div>
        <div class="patt-text">Zone ${i + 1}</div>
      </div>
    </li>`;
  };

  _render() {
    const iObj = privateMap.get(this);
    const { option, holder } = iObj;
    const { matrix, margin, radius } = option;

    const html = `<ul class="patt-wrap" style="padding: ${margin}px">
      ${[...Array(matrix[0] * matrix[1])].map(this._renderCircle).join("")}
    </ul>`;

    holder.innerHTML = html;

    css(holder, {
      width: `${matrix[1] * (radius * 2 + margin * 2) + margin * 2}px`,
      height: `${matrix[0] * (radius * 2 + margin * 2) + margin * 2}px`,
    });

    // select pattern circle
    iObj.pattCircle = iObj.holder.querySelectorAll(".patt-circ");
  }

  option(key, val) {
    const { option } = privateMap.get(this);

    // for set methods
    if (val === undefined) {
      return option[key];
    }
    // for setter

    option[key] = val;
    if (key === "margin" || key === "matrix" || key === "radius") {
      this._render();
    }

    return this;
  }
}

PatternLock.defaults = {
  matrix: [3, 3],
  margin: 40,
  radius: 25,
  pathThrough: false,
  patternVisible: true,
  lineOnMove: true,
  delimiter: "", // a delimiter between the pattern
  enableSetPattern: true,
  allowRepeat: true,
};
