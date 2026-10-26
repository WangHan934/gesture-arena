/**
 * 音效
 * ==================================================================
 * 全部用 WebAudio 现场合成，**不带任何音频文件**：
 *   · 项目约定零 npm 依赖、资源只用仓库里已有的东西，塞一堆 mp3 不合适
 *   · 合成音可以随参数变（轻击 / 重击 / 格挡），不用为每种情况存一个文件
 *   · 体积为 0，线上部署和本地分发都不用额外传资源
 *
 * 【浏览器限制】AudioContext 必须在用户手势之后才能出声，
 * 所以调用方要在第一次 pointerdown / keydown 时调 unlock()。
 * 没解锁之前所有播放都是静默 no-op，不会报错。
 *
 * 【为什么每个音效有节流】塔防一秒可能命中十几次，
 * 十几层音效叠在一起就变成噪音了。同类音效设了最小间隔。
 */

const STORAGE_KEY = 'ga.sfx';

/** 主音量。合成音容易偏响，压到 0.32 比较接近视频里的感觉 */
const MASTER_GAIN = 0.32;

function readPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.enabled = readPreference();
    this._last = new Map();
  }

  get ready() {
    return Boolean(this.ctx) && this.ctx.state === 'running';
  }

  /** 第一次用户手势时调用。重复调用安全 */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      try {
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = MASTER_GAIN;
        this.master.connect(this.ctx.destination);
        this.noise = this._makeNoiseBuffer();
      } catch {
        return false;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return true;
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off');
    } catch {
      /* 隐私模式下存不了，不影响本次 */
    }
    if (this.master) this.master.gain.value = this.enabled ? MASTER_GAIN : 0;
    return this.enabled;
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  /* ---------------- 合成原料 ---------------- */

  _makeNoiseBuffer() {
    const length = Math.floor(this.ctx.sampleRate * 1);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** 噪声：用来做「撞击的沙沙声」 */
  _noiseBurst({ duration = 0.16, gain = 0.5, type = 'bandpass', from = 1800, to = 500, q = 0.9 }) {
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 1;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, to), now + duration);
    filter.Q.value = q;

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter).connect(envelope).connect(this.master);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  /** 单音：用来做「闷响 / 低音」 */
  _tone({ type = 'sine', from = 160, to = 50, duration = 0.2, gain = 0.6, delay = 0 }) {
    const ctx = this.ctx;
    const now = ctx.currentTime + delay;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(envelope).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /** 节流：同类音效最小间隔（秒） */
  _allow(kind, gap) {
    const now = this.ctx.currentTime;
    const last = this._last.get(kind) ?? -Infinity;
    if (now - last < gap) return false;
    this._last.set(kind, now);
    return true;
  }

  _guard(kind, gap = 0) {
    if (!this.enabled) return false;
    if (!this.ctx) return false;
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
      return false;
    }
    return gap ? this._allow(kind, gap) : true;
  }

  /* ---------------- 音效 ---------------- */

  /** 命中：短促的「啪」+ 闷响，重击更低沉更长 */
  impact({ heavy = false } = {}) {
    if (!this._guard('impact', heavy ? 0.05 : 0.035)) return;
    if (heavy) {
      this._tone({ from: 120, to: 38, duration: 0.34, gain: 0.85 });
      this._noiseBurst({ duration: 0.3, gain: 0.55, from: 1400, to: 180 });
      this._tone({ type: 'square', from: 320, to: 90, duration: 0.16, gain: 0.16 });
    } else {
      this._tone({ from: 190, to: 70, duration: 0.14, gain: 0.5 });
      this._noiseBurst({ duration: 0.12, gain: 0.32, from: 2600, to: 700 });
    }
  }

  /** 能量束：高频扫下去，带一点电流嘶声 */
  beam() {
    if (!this._guard('beam', 0.08)) return;
    this._tone({ type: 'sawtooth', from: 1500, to: 260, duration: 0.22, gain: 0.24 });
    this._noiseBurst({ duration: 0.2, gain: 0.22, type: 'highpass', from: 2400, to: 900 });
  }

  /** 施法 / 技能起手 */
  cast() {
    if (!this._guard('cast', 0.1)) return;
    this._tone({ type: 'triangle', from: 320, to: 880, duration: 0.18, gain: 0.3 });
  }

  /** 召唤 / 出场 */
  summon() {
    if (!this._guard('summon', 0.12)) return;
    this._tone({ type: 'sine', from: 180, to: 520, duration: 0.26, gain: 0.34 });
    this._noiseBurst({ duration: 0.22, gain: 0.16, type: 'bandpass', from: 600, to: 1800 });
  }

  /** 单位阵亡 */
  death() {
    if (!this._guard('death', 0.12)) return;
    this._tone({ from: 180, to: 42, duration: 0.5, gain: 0.7 });
    this._noiseBurst({ duration: 0.42, gain: 0.3, type: 'lowpass', from: 900, to: 120 });
  }

  /** 打塔：金属味 */
  towerHit() {
    if (!this._guard('tower', 0.07)) return;
    this._tone({ type: 'square', from: 940, to: 620, duration: 0.1, gain: 0.14 });
    this._tone({ type: 'square', from: 1340, to: 900, duration: 0.08, gain: 0.09 });
    this._noiseBurst({ duration: 0.09, gain: 0.2, from: 3200, to: 1600 });
  }

  /** 胜负结算 */
  win() {
    if (!this._guard('result', 1)) return;
    [523, 659, 784, 1047].forEach((freq, i) => {
      this._tone({ type: 'triangle', from: freq, to: freq, duration: 0.22, gain: 0.26, delay: i * 0.11 });
    });
  }

  lose() {
    if (!this._guard('result', 1)) return;
    [392, 330, 262].forEach((freq, i) => {
      this._tone({ type: 'triangle', from: freq, to: freq * 0.98, duration: 0.3, gain: 0.24, delay: i * 0.14 });
    });
  }
}

export const sfx = new Sfx();
