class WsClient {
  constructor() {
    this.listeners = new Map();
    this.socket = null;
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new WebSocket(`${proto}://${location.host}/ws`);
    this.socket.onopen = () => this.emit('__status', 'online');
    this.socket.onclose = () => {
      this.emit('__status', 'offline');
      setTimeout(() => this.connect(), 2000);
    };
    this.socket.onerror = () => {
      /* onclose se dispara despues, ahi se reintenta */
    };
    this.socket.onmessage = (event) => {
      try {
        const { type, payload } = JSON.parse(event.data);
        this.emit(type, payload);
      } catch {
        /* mensaje no-JSON, se ignora */
      }
    };
  }

  on(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    return () => this.listeners.get(type)?.delete(callback);
  }

  emit(type, payload) {
    for (const cb of this.listeners.get(type) || []) cb(payload);
  }
}

export const ws = new WsClient();
