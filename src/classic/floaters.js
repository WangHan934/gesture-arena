/**
 * 3D 战场上的伤害跳字
 * ==================================================================
 * 做法：一块透明的 2D canvas 盖在 WebGL canvas 上，
 * 每帧把「世界坐标」投影成屏幕坐标，再用 2D context 画字。
 *
 * 【为什么不用 Sprite / CSS3D】
 *   Sprite 要贴图，中文和数字得先生成纹理，改字号就要重画；
 *   CSS3D 每跳一个字就多一个 DOM 节点，塔防一秒十几下会抖。
 *   2D 覆盖层是纯绘制，几十条文字的开销可以忽略，描边和透明度也能直接用。
 *
 * 【为什么存世界坐标而不是屏幕坐标】
 *   单位一直在动。存世界坐标、每帧重新投影，字才会跟着怪兽走，
 *   不会出现「怪兽走了字留在原地」。
 */

import * as THREE from 'three';

/** 一条跳字活多久（秒） */
const LIFE = 0.85;

/** 每秒上升多少像素（按 1000px 宽的战场算，实际会按画面宽度缩放） */
const RISE = 62;

const BASE_SIZE = 22;
const BIG_SIZE = 34;

/** 同屏最多留几条，极端情况也不会画出几百条 */
const MAX_ITEMS = 48;

export class FloatingNumbers {
  /**
   * @param {HTMLCanvasElement} canvas 盖在 3D 画布上的透明层
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') ?? null;
    this.items = [];
    this.width = 1;
    this.height = 1;
    this._v = new THREE.Vector3();
    this.resize();
  }

  /** 跟 3D 画布同一个尺寸。窗口变了要重算，否则字会画在错误的位置 */
  resize() {
    if (!this.canvas) return;
    const host = this.canvas.parentElement;
    const width = host?.clientWidth || 1;
    const height = host?.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    // 之后所有绘制都用 CSS 像素坐标，不用自己乘 dpr
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * 弹一条跳字
   * @param {string} text 例如 '-12' / 'MISS'
   * @param {THREE.Vector3} position 世界坐标（一般是怪兽头顶）
   * @param {{color?:string, big?:boolean}} [options]
   */
  spawn(text, position, { color = '#ffe08a', big = false } = {}) {
    if (!this.ctx || !position) return;

    this.items.push({
      text: String(text),
      color,
      big,
      pos: position.clone(),
      life: LIFE,
      maxLife: LIFE,
      // 横向漂一点，连续几段伤害不会精确叠在同一个像素上
      drift: (Math.random() - 0.5) * 34,
      rise: RISE * (big ? 1.12 : 1),
    });

    if (this.items.length > MAX_ITEMS) {
      this.items.splice(0, this.items.length - MAX_ITEMS);
    }
  }

  update(dt) {
    if (!this.items.length || !(dt > 0)) return;
    for (const item of this.items) item.life -= dt;
    this.items = this.items.filter((item) => item.life > 0);
  }

  /**
   * 画到覆盖层上。必须在 renderer.render() 之后调用 ——
   * 那时相机的矩阵才是最新的，投影才对得上。
   * @param {THREE.Camera} camera
   */
  draw(camera) {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.items.length) return;

    // 战场是固定比例的，按实际宽度缩放字号和位移，小窗也不会糊成一团
    const scale = Math.max(0.62, Math.min(1.5, this.width / 1000));

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    for (const item of this.items) {
      this._v.copy(item.pos).project(camera);
      if (this._v.z > 1) continue; // 跑到相机背后了，不画

      const progress = 1 - item.life / item.maxLife;
      const x = (this._v.x * 0.5 + 0.5) * this.width + item.drift * progress;
      const y = (-this._v.y * 0.5 + 0.5) * this.height - item.rise * progress * scale;

      // 冒出来先放大一下再回落到正常大小
      const pop = progress < 0.18 ? 1.3 - progress * 1.6 : 1;
      const size = (item.big ? BIG_SIZE : BASE_SIZE) * scale * pop;

      ctx.globalAlpha = Math.min(1, (item.life / item.maxLife) * 1.6);
      ctx.font = `bold ${Math.round(size)}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.strokeText(item.text, x, y);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, x, y);
    }

    ctx.globalAlpha = 1;
  }

  clear() {
    this.items.length = 0;
    this.ctx?.clearRect(0, 0, this.width, this.height);
  }
}
