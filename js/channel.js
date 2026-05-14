const CHANNEL_NAME = 'proj-map-sync';

export class SyncChannel {
  constructor(role) {
    this.role = role; // 'editor' | 'output'
    this.ch = new BroadcastChannel(CHANNEL_NAME);
    this._listeners = [];
    this.ch.onmessage = (e) => {
      for (const fn of this._listeners) fn(e.data);
    };
  }

  send(type, payload) {
    this.ch.postMessage({ type, payload, from: this.role });
  }

  on(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(f => f !== fn); };
  }

  destroy() {
    this.ch.close();
  }
}
