/**
 * 头顶血条
 * ==================================================================
 * 三种玩法（塔防 / 决斗 / 人机 / 联网 PvP）共用的血条层，和 combat-fx 一样
 * 属于「大家都 import」的共享层 —— 血条本身没有玩法语义，只有「一个比例 + 一个阵营色」。
 *
 * 【为什么不用 DOM / 2D 覆盖层】
 *   单机有 floaters 那层 2D 画布可以画，但 PvP 和 solo 没有，
 *   而且 2D 覆盖层要自己算投影、还要跟着相机震动走。用 Sprite 直接放进 3D 场景，
 *   位置就是「单位坐标 + 身高」，投影交给 GPU，三个场景一行代码就能接。
 *
 * 【为什么四条 Sprite】
 *   背板（深色圆角）、残影（受击后慢慢缩的浅色段）、填充（阵营色）、闪光（挨打瞬间白一下）。
 *   四条都是同一张 canvas 贴图换颜色，不额外加载图片资源，也不每帧重画 canvas。
 *
 * 【深度测试关掉】
 *   血条是 HUD 性质的东西，被自己的犄角挡住、或者被前排模型挡住都会很难看。
 *   关掉 depthTest 后它永远画在模型之上，代价是会透过墙 —— 等距俯视下几乎看不出来。
 */

import * as THREE from 'three';
import {
  approachRatio, clampRatio, fillLayout, idleOpacity, isLowHealth, segmentLayout, trailRatio,
} from './health-bar-math.mjs';

/** 血条世界尺寸。跟着单位身高走的话远近会不一致，这里统一 */
const BAR_WIDTH = 1.3;
const BAR_HEIGHT = 0.18;

/** 血条离头顶多高（世界单位） */
export const BAR_GAP = 0.55;

/** 阵营色：自己 / 对手。和塔的水晶、伤害跳字的配色对齐 */
export const SIDE_COLOR = { player: '#2ec2ff', enemy: '#ff5340', neutral: '#ffc94a' };

/** 贴图画布尺寸，横向长一点，圆角才不会被拉糊 */
const TEX_W = 256;
const TEX_H = 48;
const TEX_RADIUS = 16;

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** 填充条贴图：白色圆角块 + 上亮下暗的竖向渐变，乘上阵营色就是彩色条 */
function makeFillTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, 0, TEX_H);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.5, '#f4f8ff');
  gradient.addColorStop(1, '#dbe6f8');
  ctx.fillStyle = gradient;
  roundRect(ctx, 0, 0, TEX_W, TEX_H, TEX_RADIUS);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 背板贴图：深色圆角块 + 一圈半透明亮边，让血条在暗场景里有轮廓 */
function makeBackTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = 'rgba(10,8,18,0.88)';
  roundRect(ctx, 0, 0, TEX_W, TEX_H, TEX_RADIUS);
  ctx.fill();

  ctx.strokeStyle = 'rgba(214,226,255,0.42)';
  ctx.lineWidth = 4;
  roundRect(ctx, 2, 2, TEX_W - 4, TEX_H - 4, TEX_RADIUS - 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class HealthBarLayer {
  /**
   * @param {THREE.Scene} scene 血条直接挂进场景，不进单位节点
   *   （单位节点带缩放，血条跟着缩放会大小不一）
   */
  constructor(scene) {
    this.scene = scene;
    this.bars = new Map();
    this.time = 0;
    this._fillTex = makeFillTexture();
    this._backTex = makeBackTexture();
  }

  /**
   * 登记 / 更新一条血条。调用方每帧调一次即可，位置可以跟着单位移动。
   *
   * @param {string} key 单位 id，同一个 key 复用同一条血条
   * @param {{hp?:number, maxHp?:number, ratio?:number, side?:'player'|'enemy'|'neutral',
   *          x?:number, y?:number, z?:number, width?:number, visible?:boolean}} options
   */
  set(key, options = {}) {
    if (!this._fillTex || !this._backTex) return;
    const {
      hp, maxHp, side = 'neutral', x = 0, y = 0, z = 0,
      width = BAR_WIDTH, visible = true,
    } = options;

    // ratio 直接给比例（solo 引擎只给 hp 差值），否则按 hp / maxHp 算
    const target = options.ratio !== undefined
      ? clampRatio(options.ratio, 1)
      : clampRatio(hp, maxHp);

    let bar = this.bars.get(key);
    if (!bar) bar = this._create(key, side, width);

    // 掉血时闪一下白光，打击感的最后一笔
    if (target < bar.target - 0.001) bar.flashAmount = 1;
    bar.target = target;
    bar.side = side;
    bar.group.position.set(x, y, z);
    bar.group.visible = visible;
    this._layout(bar);
    return bar;
  }

  _create(key, side, width) {
    const group = new THREE.Group();
    group.renderOrder = 20;

    const makeSprite = (texture, color, opacity) => {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.renderOrder = 20;
      group.add(sprite);
      return sprite;
    };

    const back = makeSprite(this._backTex, '#ffffff', 0.9);
    back.scale.set(width + 0.1, BAR_HEIGHT + 0.09, 1);

    const ghost = makeSprite(this._fillTex, '#ffe6b8', 0.85);
    ghost.scale.set(width, BAR_HEIGHT, 1);

    const fill = makeSprite(this._fillTex, SIDE_COLOR[side] ?? SIDE_COLOR.neutral, 1);
    fill.scale.set(width, BAR_HEIGHT, 1);

    const flash = makeSprite(this._fillTex, '#ffffff', 0);
    flash.scale.set(width, BAR_HEIGHT, 1);

    this.scene.add(group);
    const bar = {
      key, group, back, ghost, fill, flash,
      width, side,
      ratio: 1,
      trail: 1,
      target: 1,
      flashAmount: 0,
    };
    this.bars.set(key, bar);
    return bar;
  }

  _layout(bar) {
    const { width } = bar;
    const fill = fillLayout(bar.ratio, width);
    bar.fill.scale.set(Math.max(0.0001, fill.width), BAR_HEIGHT, 1);
    bar.fill.position.x = fill.offsetX;

    // 残影只占「刚掉掉的那一段」，整条半透明画会盖住填充条，把颜色冲成灰板
    const trail = segmentLayout(bar.ratio, bar.trail, width);
    bar.ghost.scale.set(Math.max(0.0001, trail.width), BAR_HEIGHT, 1);
    bar.ghost.position.x = trail.offsetX;
    bar.ghost.position.z = -0.001;

    bar.flash.scale.set(Math.max(0.0001, fill.width), BAR_HEIGHT, 1);
    bar.flash.position.x = fill.offsetX;
    bar.flash.position.z = 0.001;
    bar.flash.material.opacity = bar.flashAmount * 0.85;

    bar.fill.material.color.set(SIDE_COLOR[bar.side] ?? SIDE_COLOR.neutral);
  }

  /** 每帧推进：比例趋近 + 残影追赶 + 闪光衰减 + 残血呼吸 */
  update(dt) {
    if (!this.bars.size) return;
    this.time += dt;
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(this.time * 5.5));

    for (const bar of this.bars.values()) {
      bar.ratio = approachRatio(bar.ratio, bar.target, dt);
      bar.trail = trailRatio(bar.trail, bar.ratio, dt);
      if (bar.flashAmount > 0) bar.flashAmount = Math.max(0, bar.flashAmount - dt * 5);

      const dim = idleOpacity(bar.target);
      bar.back.material.opacity = 0.9 * dim;
      bar.ghost.material.opacity = 0.85 * dim;
      bar.fill.material.opacity = (isLowHealth(bar.target) ? pulse : 1) * dim;

      this._layout(bar);
    }
  }

  remove(key) {
    const bar = this.bars.get(key);
    if (!bar) return;
    this.scene.remove(bar.group);
    for (const sprite of [bar.back, bar.ghost, bar.fill, bar.flash]) sprite.material.dispose();
    this.bars.delete(key);
  }

  clear() {
    for (const key of [...this.bars.keys()]) this.remove(key);
  }

  dispose() {
    this.clear();
    this._fillTex?.dispose();
    this._backTex?.dispose();
    this._fillTex = null;
    this._backTex = null;
  }
}
