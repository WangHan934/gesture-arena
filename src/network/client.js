export class RoomClient {
  constructor({ onState, onConnection, onExpired }) {
    Object.assign(this, { onState, onConnection, onExpired });
    this.session = null; this.abort = null; this.retry = null; this.generation = 0;
  }
  async request(path, data) {
    const response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.session ? { Authorization: `Bearer ${this.session.token}` } : {}) },
      body: JSON.stringify(data),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('请用 npm start 启动联网服务'); }
    if (!response.ok) throw new Error(result.message || '请求失败');
    return result;
  }
  async enter(id, data) {
    const result = await this.request(id ? `/api/rooms/${id}/join` : '/api/rooms', data);
    this.session = { roomId: result.roomId, seat: result.seat, token: result.token };
    try { sessionStorage.setItem('ga.pvp', JSON.stringify(this.session)); } catch { /* optional */ }
    this.onState(result.state);
    this.connect();
  }
  restore() {
    try {
      const session = JSON.parse(sessionStorage.getItem('ga.pvp'));
      if (!session || !/^[A-F0-9]{6}$/.test(session.roomId) || !/^[a-f0-9]{48}$/.test(session.token) || ![0,1].includes(session.seat)) return false;
      this.session = session; this.connect(); return true;
    } catch { return false; }
  }
  async action(type, extra = {}) { return this.request(`/api/rooms/${this.session.roomId}/action`, { type, ...extra }); }
  connect() {
    this.stopStream();
    const generation = this.generation;
    const controller = new AbortController(); this.abort = controller;
    this.readStream(generation, controller);
  }
  async readStream(generation, controller) {
    this.onConnection('connecting');
    try {
      const response = await fetch(`/api/rooms/${this.session.roomId}/events`, {
        headers: { Authorization: `Bearer ${this.session.token}` }, signal: controller.signal,
      });
      if (!response.ok) {
        if ([401,404].includes(response.status)) { this.clear(); this.onExpired(); return; }
        throw new Error('连接失败');
      }
      this.onConnection('online');
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) throw new Error('连接已断开');
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const message = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          if (message.startsWith('data: ') && generation === this.generation) this.onState(JSON.parse(message.slice(6)));
        }
      }
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation) return;
      this.onConnection('reconnecting');
      this.retry = setTimeout(() => this.connect(), 1800);
    }
  }
  stopStream() { this.generation++; this.abort?.abort(); clearTimeout(this.retry); }
  clear() { this.stopStream(); this.session = null; try { sessionStorage.removeItem('ga.pvp'); } catch {} }
  async leave() { try { if (this.session) await this.action('leave'); } finally { this.clear(); } }
}
