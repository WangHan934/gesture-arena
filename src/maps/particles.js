/**
 * 场景粒子：火焰 / 余烬 / 烟雾
 * ==================================================================
 * 三个 Points 系统，合计约 750 个点，3 个 draw call。
 *
 * 为什么不用 Sprite：
 *   一个 Sprite 一个 draw call。12 个火盆 × 每盆 20 个火苗 = 240 次调用，
 *   直接卡死。Points 一次画完。
 *
 * 为什么要避开战斗带（y 0.2~3.5）：
 *   需求第 7 条 —— 特效不能遮挡单位。所以：
 *     火焰只在火盆上方（y 4~6），余烬从地面往上飘但尺寸很小，
 *     烟雾全部在场外（r > 13）。战斗带里不放任何大颗粒。
 *
 * 颜色淡出怎么做：
 *   加色混合下，把顶点色乘到接近黑就等于淡出，不需要逐点 alpha。
 */

import * as THREE from '../../vendor/three/lib/three.module.js';

const FLAME_PER_BRAZIER = 16;
const EMBER_COUNT = 360;
const SMOKE_COUNT = 48;

export class MapParticles {
  /**
   * @param {THREE.Scene} scene
   * @param {{braziers: THREE.Vector3[], radius?: number, textures?: object}} options
   */
  constructor(scene, { braziers = [], radius = 12, textures = null } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'MapParticles';
    scene.add(this.group);

    this.time = 0;
    this._systems = [];

    this._buildFlames(braziers, textures);
    this._buildEmbers(radius, textures);
    this._buildSmoke(radius, textures);
  }

  /* ---------------- 火盆火焰 ---------------- */

  _buildFlames(braziers, tex) {
    const count = Math.max(1, braziers.length) * FLAME_PER_BRAZIER;
    if (!braziers.length) return;

    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 2); // [life, speed]

    for (let i = 0; i < count; i++) {
      const anchor = braziers[Math.floor(i / FLAME_PER_BRAZIER)];
      pos[i * 3] = anchor.x + (Math.random() - 0.5) * 0.34;
      pos[i * 3 + 1] = anchor.y + Math.random() * 0.4;
      pos[i * 3 + 2] = anchor.z + (Math.random() - 0.5) * 0.34;
      seeds[i * 2] = Math.random();      // 生命相位
      seeds[i * 2 + 1] = 0.8 + Math.random() * 0.7;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({
      size: 1.6,
      map: tex?.flame ?? null,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);

    this._systems.push({
      kind: 'flame',
      points,
      pos,
      col,
      seeds,
      anchors: braziers,
      count,
    });
  }

  /* ---------------- 余烬 ---------------- */

  _buildEmbers(radius, tex) {
    const count = EMBER_COUNT;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (radius + 4);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 7;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seeds[i * 2] = 0.6 + Math.random() * 0.8;
      seeds[i * 2 + 1] = 0.5 + Math.random() * 0.9;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.16,
      map: tex?.ember ?? null,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);

    this._systems.push({ kind: 'ember', points, pos, col, seeds, count });
  }

  /* ---------------- 场外烟雾 ---------------- */

  _buildSmoke(radius, tex) {
    const count = SMOKE_COUNT;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius + 3 + Math.random() * 10;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 1 + Math.random() * 9;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seeds[i * 2] = Math.random() * Math.PI * 2;
      seeds[i * 2 + 1] = 0.15 + Math.random() * 0.25;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({
      size: 4.2,
      map: tex?.smoke ?? null,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);

    this._systems.push({ kind: 'smoke', points, pos, col, seeds, count });
  }

  /* ---------------- 每帧推进 ---------------- */

  update(dt) {
    const step = Math.min(dt, 0.05);
    this.time += step;

    for (const sys of this._systems) {
      const { pos, col, seeds, count } = sys;

      if (sys.kind === 'flame') {
        for (let i = 0; i < count; i++) {
          const anchor = sys.anchors[Math.floor(i / FLAME_PER_BRAZIER)];
          const life = (seeds[i * 2] + this.time * seeds[i * 2 + 1]) % 1;

          // 往上窜，同时向内收（火苗是锥形）
          const h = life * 1.5;
          const shrink = 1 - life * 0.55;
          pos[i * 3] = anchor.x + (pos[i * 3] - anchor.x) * 0.94 + Math.sin(this.time * 7 + i) * 0.004;
          pos[i * 3 + 1] = anchor.y + h;
          pos[i * 3 + 2] = anchor.z + (pos[i * 3 + 2] - anchor.z) * 0.94;

          // 加色混合下，颜色越暗越透明
          const fade = (0.35 + 0.65 * (1 - life)) * shrink;
          col[i * 3] = 1.0 * fade;
          col[i * 3 + 1] = 0.55 * fade * fade;
          col[i * 3 + 2] = 0.18 * fade * fade * fade;
        }
        sys.points.geometry.attributes.position.needsUpdate = true;
        sys.points.geometry.attributes.color.needsUpdate = true;
      } else if (sys.kind === 'ember') {
        for (let i = 0; i < count; i++) {
          const speed = seeds[i * 2 + 1] * 0.55;
          pos[i * 3 + 1] += speed * step;
          pos[i * 3] += Math.sin(this.time * 1.6 + i) * 0.006;

          if (pos[i * 3 + 1] > 7.5) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * 14;
            pos[i * 3] = Math.cos(a) * r;
            pos[i * 3 + 1] = 0;
            pos[i * 3 + 2] = Math.sin(a) * r;
          }

          const t = 1 - pos[i * 3 + 1] / 7.5;
          const flick = 0.7 + Math.sin(this.time * 9 + i * 1.7) * 0.3;
          col[i * 3] = 1.0 * t * flick;
          col[i * 3 + 1] = 0.45 * t * flick;
          col[i * 3 + 2] = 0.12 * t * flick;
        }
        sys.points.geometry.attributes.position.needsUpdate = true;
        sys.points.geometry.attributes.color.needsUpdate = true;
      } else {
        for (let i = 0; i < count; i++) {
          const speed = seeds[i * 2 + 1];
          pos[i * 3 + 1] += speed * step;
          pos[i * 3] += Math.sin(this.time * 0.5 + seeds[i * 2]) * 0.01;

          if (pos[i * 3 + 1] > 14) {
            const a = Math.random() * Math.PI * 2;
            const r = 14 + Math.random() * 10;
            pos[i * 3] = Math.cos(a) * r;
            pos[i * 3 + 1] = 1;
            pos[i * 3 + 2] = Math.sin(a) * r;
          }

          const t = 0.28 + Math.sin(this.time * 0.6 + seeds[i * 2]) * 0.1;
          col[i * 3] = 0.42 * t;
          col[i * 3 + 1] = 0.34 * t;
          col[i * 3 + 2] = 0.3 * t;
        }
        sys.points.geometry.attributes.position.needsUpdate = true;
        sys.points.geometry.attributes.color.needsUpdate = true;
      }
    }
  }

  dispose() {
    for (const sys of this._systems) {
      sys.points.geometry.dispose();
      sys.points.material.dispose();
    }
    this._systems.length = 0;
    this.scene.remove(this.group);
  }
}

export default MapParticles;
