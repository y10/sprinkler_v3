/**
 * @callback OnComplete
 * @param {function(state:{})} onComplete to call on success
 */

export class WsClient {
  Events = {};

  /**
   * @param {string} event name
   * @param {OnComplete} onComplete
   * @param {object} context this
   * @returns {WsClient}
   */
  on(event, onComplete, context) {
    if (onComplete) {
      if (!(event in this.Events)) {
        this.Events[event] = [];
      }
      this.Events[event].push({ onComplete, context });
    }

    return this;
  }

  /**
   * @param {string} event name
   * @param {OnComplete} onComplete
   * @returns {WsClient}
   */
  off(event, onComplete) {
    if (onComplete) {
      if (event in this.Events) {
        const events = this.Events[event];
        let index = -1;
        let i = 0;
        for (const reg of events) {
          if (reg.onComplete === onComplete) {
            index = i;
            break;
          }
          i++;
        }
        if (index > -1) {
          events.splice(index, 1);
        }
      }
    }

    return this;
  }

  connect() {
    const self = this;
    const MAX_RECONNECT_ATTEMPTS = 10;

    function reconnect(count = 1) {
      if (count > MAX_RECONNECT_ATTEMPTS) {
        console.error(`WS: max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
        return;
      }
      if (!self.connect()) {
        setTimeout(() => {
          reconnect(count + 1);
        }, Math.min(count * 5000, 30000));
      }
    }

    function fireEvent(name, event) {
      if (name in self.Events) {
        self.Events[name].forEach(({ onComplete, context }) => {
          onComplete.call(context, event);
        });
      }
    }

    try {
      const ws = new WebSocket("ws://" + window.location.hostname + "/ws");
      ws.onopen = function (evt) {
        console.log("WS: open");
        fireEvent("connected");
      };
      ws.onclose = function (evt) {
        console.warn("WS: close");
        fireEvent("disconnect");
        reconnect();
      };
      ws.onerror = function (evt) {
        console.error("WS: error");
        console.error(evt);
      };
      ws.onmessage = function (evt) {
        try {
          const e = evt.data ? JSON.parse(evt.data) : {};
          const type = Object.keys(e)[0];
          console.log(e);
          fireEvent(type, e[type]);
        } catch (error) {
          console.error(error);
          console.log(evt.data);
        }
      };

      return ws;
    } catch (error) {
      console.error("WS: not available");
      console.error(error);
    }

    return null;
  }
}

let wsc = null;

if (window.wsc !== undefined) {
  wsc = window.wsc;
} else {
  window.wsc = wsc = new WsClient();
  if (window.location.hostname) {
    wsc.connect();
  }
}

/**
 * @type {WsClient}
 */
export const Wsc = wsc;