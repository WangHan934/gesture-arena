/**
 * 摄像头画中画 + 关键点骨架 + 识别结果
 * ============================================================================
 * 全部自己注入 DOM 和样式，不改 index.html / style.css，
 * 也不抢游戏的点击（pointer-events: none，只有按钮可点）。
 *
 * 默认贴在左下角，可折叠。
 * ============================================================================
 */

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const CSS = `
.gh {
  position: fixed; left: 18px; bottom: 18px; z-index: 50;
  width: 244px; border-radius: 14px; overflow: hidden;
  background: rgba(10, 14, 20, .92);
  border: 1px solid rgba(120, 150, 190, .28);
  box-shadow: 0 12px 32px rgba(0, 0, 0, .45);
  color: #d7e4f0;
  font: 12px/1.5 "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  pointer-events: none;
  backdrop-filter: blur(10px);
  user-select: none;
}
.gh[data-min="1"] .gh-body,
.gh[data-min="1"] .gh-foot { display: none; }
.gh-head {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 10px; border-bottom: 1px solid rgba(120, 150, 190, .16);
}
.gh-dot { width: 7px; height: 7px; border-radius: 50%; background: #5c6b7a; flex: none; }
.gh[data-state="ready"] .gh-dot { background: #4ade80; box-shadow: 0 0 8px #4ade80; }
.gh[data-state="error"] .gh-dot { background: #f87171; box-shadow: 0 0 8px #f87171; }
.gh[data-state="requesting"] .gh-dot,
.gh[data-state="loading"] .gh-dot { background: #60a5fa; animation: gh-pulse 1s infinite; }
@keyframes gh-pulse { 50% { opacity: .25; } }
.gh-title { font-weight: 600; letter-spacing: .04em; font-size: 12px; }
.gh-fps { margin-left: auto; color: #6b7f93; font-size: 11px; font-variant-numeric: tabular-nums; }
.gh-min {
  pointer-events: auto; cursor: pointer;
  width: 20px; height: 20px; border-radius: 6px; border: 0;
  background: rgba(255, 255, 255, .07); color: #9fb2c4;
  font: 13px/1 monospace; padding: 0;
}
.gh-min:hover { background: rgba(255, 255, 255, .14); }
.gh-body { position: relative; min-height: 132px; background: #05080c; }
.gh-body video { display: block; width: 100%; height: auto; transform: scaleX(-1); }
.gh-body canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.gh-hint {
  position: absolute; inset: 0; display: grid; place-items: center;
  color: #5d7286; font-size: 12px; text-align: center; padding: 0 18px;
}
.gh-body[data-has-hand="1"] .gh-hint { display: none; }
.gh-error {
  position: absolute; inset: 0; display: none;
  flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; padding: 14px; text-align: center;
  background: rgba(8, 11, 16, .96);
}
.gh[data-state="error"] .gh-error { display: flex; }
.gh-error b { color: #fca5a5; font-size: 12.5px; }
.gh-error p { margin: 0; color: #8497a8; font-size: 11.5px; line-height: 1.5; }
.gh-error button {
  pointer-events: auto; margin-top: 4px; cursor: pointer;
  padding: 4px 12px; border-radius: 6px; font-size: 11.5px;
  border: 1px solid rgba(120, 150, 190, .35); background: rgba(255, 255, 255, .06); color: #cfe0ee;
}
.gh-foot { padding: 8px 10px 9px; border-top: 1px solid rgba(120, 150, 190, .16); }
.gh-pose { display: flex; align-items: baseline; gap: 8px; }
.gh-pose b { font-size: 13.5px; font-weight: 600; color: #eaf3fb; }
.gh-pose span { color: #6b7f93; font-size: 11px; margin-left: auto; font-variant-numeric: tabular-nums; }
.gh-bar { height: 3px; margin-top: 6px; border-radius: 99px; background: rgba(255, 255, 255, .09); overflow: hidden; }
.gh-bar i { display: block; height: 100%; width: 0; background: #4ade80; transition: width .06s linear; }
.gh[data-fire="1"] { border-color: rgba(74, 222, 128, .75); }
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const style = document.createElement('style');
  style.id = 'gh-style';
  style.textContent = CSS;
  document.head.appendChild(style);
}

export class HandOverlay {
  /**
   * @param {{mount?:HTMLElement, title?:string}} [opts]
   */
  constructor({ mount = document.body, title = '手势识别' } = {}) {
    injectCss();

    this.root = document.createElement('div');
    this.root.className = 'gh';
    this.root.dataset.state = 'idle';
    this.root.dataset.min = '0';
    this.root.innerHTML = `
      <div class="gh-head">
        <i class="gh-dot"></i>
        <span class="gh-title">${title}</span>
        <span class="gh-fps"></span>
        <button class="gh-min" title="收起 / 展开">–</button>
      </div>
      <div class="gh-body" data-has-hand="0">
        <div class="gh-hint">等待摄像头…</div>
        <canvas class="gh-canvas"></canvas>
        <div class="gh-error"><b class="gh-err-title"></b><p class="gh-err-msg"></p><button class="gh-retry">重试</button></div>
      </div>
      <div class="gh-foot">
        <div class="gh-pose"><b class="gh-label">—</b><span class="gh-detail"></span></div>
        <div class="gh-bar"><i></i></div>
      </div>
    `;
    (mount || document.body).appendChild(this.root);

    this.body = this.root.querySelector('.gh-body');
    this.canvas = this.root.querySelector('.gh-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.labelEl = this.root.querySelector('.gh-label');
    this.detailEl = this.root.querySelector('.gh-detail');
    this.fpsEl = this.root.querySelector('.gh-fps');
    this.barEl = this.root.querySelector('.gh-bar i');
    this.errTitle = this.root.querySelector('.gh-err-title');
    this.errMsg = this.root.querySelector('.gh-err-msg');
    this.retryBtn = this.root.querySelector('.gh-retry');

    this.root.querySelector('.gh-min').addEventListener('click', () => this.toggle());
    this._fireTimer = 0;
  }

  /** 把 tracker 的 video 放进来 */
  mountVideo(video) {
    video.style.width = '100%';
    this.body.insertBefore(video, this.canvas);
    this.video = video;
  }

  setStatus(state, text) {
    this.root.dataset.state = state;
    if (text) this.detailEl.textContent = text;
    if (state === 'ready') this.hideError();
  }

  /** 识别结果 + 保持进度 */
  setPose(label, detail, progress = 0) {
    this.labelEl.textContent = label;
    this.detailEl.textContent = detail;
    this.barEl.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  }

  /** 触发成功时闪一下边框 */
  flash() {
    this.root.dataset.fire = '1';
    clearTimeout(this._fireTimer);
    this._fireTimer = setTimeout(() => { this.root.dataset.fire = '0'; }, 220);
  }

  setFps(fps) {
    this.fpsEl.textContent = fps ? `${fps} fps` : '';
  }

  setError(title, message, onRetry) {
    this.errTitle.textContent = title;
    this.errMsg.textContent = message;
    this.root.dataset.state = 'error';
    this.retryBtn.onclick = onRetry || null;
  }

  hideError() {
    this.root.dataset.state = 'ready';
  }

  /**
   * 画关键点。
   * @param {Array<{x:number,y:number}>|null} landmarks
   * @param {{mirrored?:boolean}} [opts]
   */
  render(landmarks, { mirrored = true, fps = 0 } = {}) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    this.body.dataset.hasHand = landmarks ? '1' : '0';
    this.setFps(fps);

    if (!landmarks) return;

    const pts = landmarks.map((p) => ({
      x: (mirrored ? 1 - p.x : p.x) * w,
      y: p.y * h,
    }));

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(74, 222, 128, .9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
    }
    ctx.stroke();

    for (let i = 0; i < pts.length; i++) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, i === 8 ? 3.4 : 1.9, 0, Math.PI * 2);
      ctx.fillStyle = i === 8 ? '#ffffff' : '#9be8ff';
      ctx.fill();
    }
  }

  toggle() {
    this.root.dataset.min = this.root.dataset.min === '1' ? '0' : '1';
  }

  destroy() {
    clearTimeout(this._fireTimer);
    this.root.remove();
  }
}
