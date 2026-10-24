/**
 * 手势画板
 * ------------------------------------------------------------------
 * 负责三件事：
 *   1. 接收鼠标 / 手指输入，记录轨迹点
 *   2. 实时把轨迹画出来（带发光效果）
 *   3. 抬笔时调用识别器，把结果通过回调抛出去
 *
 * 它不认识生物，也不管战斗——只负责「画」和「认」。
 */

import { GESTURE } from '../config.js';
import { recognize } from './gesture-recognizer.js';

export class GestureCanvas {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onRecognized: (result: {id:string, score:number} | null) => void }} options
   */
  constructor(canvas, { onRecognized }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onRecognized = onRecognized;

    this.points = [];
    this.drawing = false;
    this.holdTimer = 0;   // 识别后停留时间
    this.opacity = 1;     // 轨迹透明度，用于淡出

    this._bind();
  }

  _bind() {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // 某些环境（例如合成事件、元素被移除）会让指针捕获失败，
      // 失败也不该影响画线，所以包一层保护
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* 忽略 */
      }
      this.drawing = true;
      this.points = [];
      this.holdTimer = 0;
      this.opacity = 1;
      this.points.push(this._toLocal(e));
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.drawing) return;
      e.preventDefault();
      const p = this._toLocal(e);
      const last = this.points[this.points.length - 1];
      // 过滤掉过密的点，减少计算量
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
      if (this.points.length >= GESTURE.maxPoints) return;
      this.points.push(p);
    });

    const finish = (e) => {
      if (!this.drawing) return;
      this.drawing = false;
      if (e) e.preventDefault();

      const result = recognize(this.points);
      this.holdTimer = GESTURE.fadeDelay;
      this.onRecognized?.(result);
    };

    c.addEventListener('pointerup', finish);
    c.addEventListener('pointercancel', finish);
    c.addEventListener('pointerleave', (e) => {
      // 鼠标拖出画板也当作抬笔，避免卡住
      if (this.drawing && e.pointerType === 'mouse') finish(e);
    });
  }

  /** 屏幕坐标 → 画板内部坐标 */
  _toLocal(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * this.canvas.width,
      y: (e.clientY - rect.top) / rect.height * this.canvas.height,
    };
  }

  /** 每帧更新淡出状态 */
  update(dt) {
    if (this.drawing) return;
    if (this.holdTimer > 0) {
      this.holdTimer -= dt;
      return;
    }
    if (this.opacity > 0) {
      this.opacity = Math.max(0, this.opacity - dt * 4);
      if (this.opacity === 0) this.points = [];
    }
  }

  /** 每帧重绘画板 */
  render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.points.length < 2 || this.opacity <= 0) return;

    ctx.save();
    ctx.globalAlpha = this.opacity;

    // 发光底色
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(120, 170, 255, 0.18)';
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) ctx.lineTo(this.points[i].x, this.points[i].y);
    ctx.stroke();

    // 主线
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#9dc4ff';
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) ctx.lineTo(this.points[i].x, this.points[i].y);
    ctx.stroke();

    // 起点标记
    const s = this.points[0];
    ctx.beginPath();
    ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(157, 196, 255, 0.85)';
    ctx.fill();

    ctx.restore();
  }

  /** 外部主动清空（比如重开一局） */
  clear() {
    this.points = [];
    this.opacity = 0;
    this.holdTimer = 0;
  }
}
