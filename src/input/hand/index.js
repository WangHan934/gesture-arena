/**
 * 手势输入模块 · 对外入口
 * ============================================================================
 * 一行接入：
 *
 *   import { createHandInput } from './input/hand/index.js';
 *   const hand = createHandInput();
 *   hand.start();
 *
 * 它自己不碰游戏状态，只往外发事件：
 *
 *   window.addEventListener('gesture', (e) => {
 *     const { type, value } = e.detail;
 *     if (type === 'SELECT_MONSTER') select(value);
 *     else if (type === 'ATTACK') attack();
 *     else if (type === 'CONFIRM') confirm();
 *   });
 *
 * 也可以直接 hand.on('gesture', fn)，两种写法等价。
 *
 * 发出去的事件长这样：
 *   { type: 'SELECT_MONSTER', value: 2, gesture: 'two', hand: 'Right', t: 12345 }
 *   { type: 'ATTACK', gesture: 'fist', hand: 'Right', t: 12600 }
 *   { type: 'CONFIRM', gesture: 'open_palm', hand: 'Right', t: 13000 }
 * ============================================================================
 */

import { CameraTracker } from './tracker.js';
import { classifyPose, POSES, POSE_LABEL } from './poses.js';
import { PoseStabilizer, holdProgress } from './stabilizer.js';
import { HandOverlay } from './overlay.js';

/** 手势 → 指令。改这里就能改键位，不用碰逻辑。 */
export const DEFAULT_MAPPING = {
  [POSES.OPEN_PALM]: { type: 'CONFIRM' },
  [POSES.FIST]: { type: 'ATTACK' },
  [POSES.ONE]: { type: 'SELECT_MONSTER', value: 1 },
  [POSES.TWO]: { type: 'SELECT_MONSTER', value: 2 },
  [POSES.THREE]: { type: 'SELECT_MONSTER', value: 3 },
};

/**
 * 纯函数：手势名 → 事件载荷（不含时间戳）。
 * @returns {{type:string, value?:number}|null}
 */
export function poseToEvent(pose, mapping = DEFAULT_MAPPING) {
  const m = mapping?.[pose];
  if (!m) return null;
  const ev = { type: m.type };
  if (m.value !== undefined) ev.value = m.value;
  return ev;
}

/** 把各种失败翻译成人话 */
function friendlyError(err) {
  const name = err?.name || '';
  const code = err?.code || '';

  if (code === 'insecure') {
    return {
      title: '无法使用摄像头',
      message: '请用 http://localhost:8000 打开，不要直接双击 index.html。摄像头只在 localhost 或 https 下可用。',
    };
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      title: '摄像头权限被拒绝',
      message: '点地址栏左侧的图标 → 摄像头 → 允许，然后点下面的「重试」。',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { title: '没找到摄像头', message: '这台电脑没有可用摄像头，或被系统禁用了。鼠标操作依然可用。' };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return { title: '摄像头被占用了', message: '会议软件 / OBS 等正在使用摄像头，关掉之后再点「重试」。' };
  }
  if (code === 'model') {
    return { title: '手势模型加载失败', message: `${err.message}（检查 vendor/hand/ 是否完整）` };
  }
  return { title: '手势识别启动失败', message: err?.message || String(err) };
}

class HandInput {
  constructor(opts = {}) {
    this.opts = {
      stableMs: 260,
      releaseMs: 180,
      mapping: DEFAULT_MAPPING,
      modelBase: 'auto',   // auto = 先本地 vendor/hand，失败再走 CDN
      numHands: 1,
      mirror: true,
      overlay: true,
      autoTick: true,
      target: typeof window !== 'undefined' ? window : null,
      ...opts,
    };

    this.state = 'idle';
    this.message = '尚未启动';
    this.pose = { pose: POSES.NONE, count: 0, fingers: [], openness: 0 };
    this.lastEvent = null;
    this.hold = 0;
    this.handPresent = false;

    this.stabilizer = new PoseStabilizer({
      stableMs: this.opts.stableMs,
      releaseMs: this.opts.releaseMs,
    });

    this.tracker = new CameraTracker({
      numHands: this.opts.numHands,
      modelBase: this.opts.modelBase,
    });

    this.overlay = this.opts.overlay === true
      ? new HandOverlay()
      : (this.opts.overlay || null);
    if (this.overlay?.mountVideo) this.overlay.mountVideo(this.tracker.video || this._ensureVideo());

    this._listeners = new Map();
    this._raf = 0;
    this._running = false;
    this._lastTick = 0;
    this._noHandSince = 0;

    this._loop = this._loop.bind(this);
  }

  /* ---------------------------------------------------------------- 生命周期 */

  /** @returns {Promise<boolean>} 成功拿到摄像头和模型返回 true；失败不抛错 */
  async start() {
    if (this._running) return true;

    this._setStatus('requesting', '正在请求摄像头…');
    this.overlay?.setStatus('requesting', '正在请求摄像头…');

    try {
      await this.tracker.start();
    } catch (err) {
      const { title, message } = friendlyError(err);
      this._setStatus('error', message);
      this.overlay?.setError(title, message, () => this.start());
      return false;
    }

    this._setStatus('ready', '手势识别就绪');
    this.overlay?.setStatus('ready', '把手放进画面');
    this.stabilizer.reset();
    this._noHandSince = 0;

    if (this.opts.autoTick) {
      this._running = true;
      this._lastTick = 0;
      this._raf = requestAnimationFrame(this._loop);
    }
    return true;
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    this.tracker.stop();
    this.stabilizer.reset();
    this._setStatus('idle', '已停止');
    this.overlay?.setStatus('idle', '');
  }

  destroy() {
    this.stop();
    this.overlay?.destroy();
    this._listeners.clear();
  }

  /* ---------------------------------------------------------------- 每帧 */

  _loop(now) {
    if (!this._running) return;
    this.tick(now);
    this._raf = requestAnimationFrame(this._loop);
  }

  /** 手动驱动时用（autoTick: false） */
  tick(now = performance.now()) {
    if (this.state === 'error' || this.state === 'idle') return;

    // 切标签页回来时时间会跳一大段，别让它把"保持 260ms"直接跳过去
    if (this._lastTick && now - this._lastTick > 500) this.stabilizer.reset();
    this._lastTick = now;

    const det = this.tracker.read(now);
    const lm = det?.landmarks || null;

    this.pose = lm
      ? classifyPose(lm)
      : { pose: POSES.NONE, count: 0, fingers: [], openness: 0, reason: 'no-hand' };

    const progress = holdProgress(this.stabilizer, now);
    this.hold = progress;           // 0..1，UI 画"保持中"进度条用
    this.handPresent = !!lm;
    this.overlay?.render(lm, { mirrored: this.opts.mirror, fps: this.tracker.fps });

    if (lm) {
      this._noHandSince = 0;
      const detail = `${this.pose.count} 指${det.handedness === 'Left' ? ' · 左手' : det.handedness === 'Right' ? ' · 右手' : ''}`;
      this.overlay?.setPose(POSE_LABEL[this.pose.pose] || '—', detail, progress);
    } else {
      if (!this._noHandSince) this._noHandSince = now;
      this.overlay?.setPose('把手放进画面', this.state === 'ready' ? '' : this.message, 0);
    }

    const fire = this.stabilizer.push(this.pose.pose, now);
    if (fire) {
      const ev = {
        ...poseToEvent(fire, this.opts.mapping),
        gesture: fire,
        hand: det?.handedness || '',
        t: now,
      };
      this.lastEvent = ev;
      this.overlay?.flash();
      this._emit('gesture', ev);
      this.opts.target?.dispatchEvent?.(new CustomEvent('gesture', { detail: ev }));
    }
  }

  /* ---------------------------------------------------------------- 事件 */

  /**
   * @param {'gesture'|'status'} type
   * @param {(payload:any)=>void} fn
   * @returns {() => void} 取消订阅
   */
  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }

  _emit(type, payload) {
    for (const fn of this._listeners.get(type) || []) {
      try { fn(payload); } catch (err) { console.error('[hand] listener error', err); }
    }
  }

  _setStatus(state, message) {
    this.state = state;
    this.message = message;
    const detail = { state, message };
    this._emit('status', detail);
    this.opts.target?.dispatchEvent?.(new CustomEvent('hand-status', { detail }));
  }

  _ensureVideo() {
    if (this.tracker.video) return this.tracker.video;
    const v = document.createElement('video');
    v.playsInline = true;
    v.muted = true;
    v.autoplay = true;
    this.tracker.video = v;
    return v;
  }

  get status() {
    return { state: this.state, message: this.message };
  }
}

/**
 * @param {Partial<{stableMs:number, releaseMs:number, mapping:object, modelBase:string|null,
 *   numHands:number, mirror:boolean, overlay:boolean|import('./overlay.js').HandOverlay,
 *   autoTick:boolean, target:EventTarget}>} [options]
 */
export function createHandInput(options = {}) {
  return new HandInput(options);
}

export { POSES, POSE_LABEL };
