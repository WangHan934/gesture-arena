/**
 * 受击闪红
 * ==================================================================
 * 模型是 glb 克隆出来的，**材质默认是共享的**（SkeletonUtils.clone 只克隆节点树）。
 * 直接改 emissive 会让「同款怪兽」一起闪，所以这里只改挂在实例上的材质：
 * 调用方在建模型时先把材质 clone 一份（见 solo/scene.js 的 build()）。
 *
 * 用逐帧衰减而不是 setTimeout：
 *   · 连击时不会有一堆定时器互相打断
 *   · 闪红是「亮 → 暗」的曲线，比「开 100ms → 关」更像被打到
 */

import * as THREE from 'three';

const DEFAULTS = { color: 0xff2d3a, duration: 0.18, peak: 0.3 };

export class ModelFlash {
  constructor() {
    /** @type {Map<THREE.Object3D, {t:number, duration:number, color:THREE.Color, peak:number, targets:{material:THREE.Material, emissive:THREE.Color, intensity:number}[]}>} */
    this.active = new Map();
  }

  /**
   * 让一个模型闪一下。
   * @param {THREE.Object3D} root 模型根节点
   * @param {{color?:number, duration?:number, peak?:number}} [options]
   */
  flash(root, options = {}) {
    if (!root) return;
    const { color, duration, peak } = { ...DEFAULTS, ...options };
    const existing = this.active.get(root);
    if (existing) {
      // 已经在闪了：重置计时就行，不用重新收集材质
      existing.t = duration;
      existing.duration = duration;
      return;
    }

    const targets = [];
    root.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material?.emissive) continue;
        targets.push({
          material,
          emissive: material.emissive.clone(),
          intensity: material.emissiveIntensity ?? 1,
        });
      }
    });
    if (!targets.length) return;

    for (const item of targets) {
      item.material.emissive.setHex(color);
      item.material.emissiveIntensity = peak;
    }
    this.active.set(root, { t: duration, duration, peak, targets });
  }

  /** 每帧推进；闪完自动还原成原来的自发光 */
  update(dt) {
    if (!this.active.size) return;
    for (const [root, item] of this.active) {
      item.t -= dt;
      if (item.t <= 0) {
        this._restore(item);
        this.active.delete(root);
        continue;
      }
      // 前 30% 保持最亮，之后二次方衰减
      const k = item.t / item.duration;
      const strength = k > 0.7 ? 1 : (k / 0.7) ** 2;
      for (const target of item.targets) {
        target.material.emissiveIntensity = target.intensity + (item.peak - target.intensity) * strength;
      }
    }
  }

  _restore(item) {
    for (const target of item.targets) {
      target.material.emissive.copy(target.emissive);
      target.material.emissiveIntensity = target.intensity;
    }
  }

  /** 立刻全部还原（换局 / 销毁时用，别把下一局染红） */
  clear() {
    for (const item of this.active.values()) this._restore(item);
    this.active.clear();
  }
}
