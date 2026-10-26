/**
 * 打斗特效
 * ==================================================================
 * 参考用户给的视频做的：近身对撞时接触点有强光爆发 + 火花 + 碎石，
 * 远程攻击是一道带拖尾的能量束，每只怪脚下一圈彩色光圈。
 *
 * 【为什么不用后处理】
 *   Bloom / 体积光要额外的渲染通道和贴图，低端设备上很容易掉帧，
 *   而这个项目是现场演示优先。这里全部用加色混合（AdditiveBlending）
 *   的普通几何体堆出「亮」的感觉：Sprite 闪光 + Points 火花 + 小碎块，
 *   一次绘制几百个粒子对 GPU 来说可以忽略。
 *
 * 【为什么用对象池】
 *   塔防一秒可能命中十几次，每次 new 一堆 BufferGeometry 会一直触发 GC，
 *   表现就是周期性卡顿。所以火花 / 碎片 / 闪光 / 光柱都是预先建好、
 *   循环复用的，只在需要时改属性。
 */

import * as THREE from 'three';

/** 火花池容量 */
const SPARK_CAPACITY = 320;

/** 碎片池容量 */
const DEBRIS_CAPACITY = 28;

/** 闪光池容量 */
const FLASH_CAPACITY = 14;

/** 光柱池容量 */
const BEAM_CAPACITY = 4;

/** 闪光贴图：一次性生成的径向渐变，避免依赖外部图片 */
function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class CombatFX {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.shakeAmp = 0;
    this._shake = new THREE.Vector3();
    this._glow = makeGlowTexture();
    this._rings = new Map();

    this._sparks = this._makeSparks();
    this._debris = this._makeDebris();
    this._flashes = this._makeFlashes();
    this._beams = this._makeBeams();
  }

  /* ---------------- 火花 ---------------- */

  _makeSparks() {
    const positions = new Float32Array(SPARK_CAPACITY * 3);
    const colors = new Float32Array(SPARK_CAPACITY * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.2,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);

    return {
      points,
      positions,
      colors,
      geometry,
      // 每颗粒子的运动状态。用普通数组，避免为每颗建对象
      vel: new Float32Array(SPARK_CAPACITY * 3),
      life: new Float32Array(SPARK_CAPACITY),
      maxLife: new Float32Array(SPARK_CAPACITY),
      base: new Float32Array(SPARK_CAPACITY * 3),
      cursor: 0,
    };
  }

  _spawnSparks(origin, color, count, speed) {
    const pool = this._sparks;
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const index = pool.cursor;
      pool.cursor = (pool.cursor + 1) % SPARK_CAPACITY;

      const i3 = index * 3;
      pool.positions[i3] = origin.x;
      pool.positions[i3 + 1] = origin.y;
      pool.positions[i3 + 2] = origin.z;

      // 半球状喷射，往上的分量多一点，看起来像被崩开
      const theta = Math.random() * Math.PI * 2;
      const up = 0.25 + Math.random() * 0.95;
      const spread = 0.4 + Math.random() * 0.8;
      const v = speed * (0.55 + Math.random() * 0.75);
      pool.vel[i3] = Math.cos(theta) * spread * v;
      pool.vel[i3 + 1] = up * v;
      pool.vel[i3 + 2] = Math.sin(theta) * spread * v;

      const life = 0.28 + Math.random() * 0.42;
      pool.life[index] = life;
      pool.maxLife[index] = life;

      // 颜色留一点随机，避免整团一个色块
      const tint = 0.7 + Math.random() * 0.5;
      pool.base[i3] = c.r * tint;
      pool.base[i3 + 1] = c.g * tint;
      pool.base[i3 + 2] = c.b * tint;
      pool.colors[i3] = c.r * tint;
      pool.colors[i3 + 1] = c.g * tint;
      pool.colors[i3 + 2] = c.b * tint;
    }
    pool.geometry.attributes.position.needsUpdate = true;
    pool.geometry.attributes.color.needsUpdate = true;
  }

  _updateSparks(dt) {
    const pool = this._sparks;
    let dirty = false;

    for (let i = 0; i < SPARK_CAPACITY; i++) {
      if (pool.life[i] <= 0) continue;
      dirty = true;
      pool.life[i] -= dt;

      const i3 = i * 3;
      if (pool.life[i] <= 0) {
        // 熄灭：把颜色压到全黑，加色混合下就是看不见
        pool.colors[i3] = 0;
        pool.colors[i3 + 1] = 0;
        pool.colors[i3 + 2] = 0;
        continue;
      }

      pool.vel[i3 + 1] -= 12 * dt;      // 重力
      pool.positions[i3] += pool.vel[i3] * dt;
      pool.positions[i3 + 1] += pool.vel[i3 + 1] * dt;
      pool.positions[i3 + 2] += pool.vel[i3 + 2] * dt;

      // 越接近熄灭越暗
      const k = Math.min(1, pool.life[i] / pool.maxLife[i]);
      pool.colors[i3] = pool.base[i3] * k;
      pool.colors[i3 + 1] = pool.base[i3 + 1] * k;
      pool.colors[i3 + 2] = pool.base[i3 + 2] * k;
    }

    if (dirty) {
      pool.geometry.attributes.position.needsUpdate = true;
      pool.geometry.attributes.color.needsUpdate = true;
    }
  }

  /* ---------------- 碎石 ---------------- */

  _makeDebris() {
    const geometry = new THREE.TetrahedronGeometry(0.09, 0);
    const items = [];

    for (let i = 0; i < DEBRIS_CAPACITY; i++) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: 0x6b5a4a,
        roughness: 0.85,
        metalness: 0.05,
      }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      items.push({ mesh, life: 0, maxLife: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }

    return { items, cursor: 0 };
  }

  _spawnDebris(origin, count, color) {
    const pool = this._debris;
    for (let i = 0; i < count; i++) {
      const item = pool.items[pool.cursor];
      pool.cursor = (pool.cursor + 1) % DEBRIS_CAPACITY;

      item.mesh.position.copy(origin);
      item.mesh.position.y = Math.max(0.08, origin.y - 0.35);
      item.mesh.material.color.set(color).multiplyScalar(0.55);
      item.mesh.visible = true;

      const theta = Math.random() * Math.PI * 2;
      const v = 1.6 + Math.random() * 2.4;
      item.vel.set(Math.cos(theta) * v * 0.6, 2.2 + Math.random() * 2.2, Math.sin(theta) * v * 0.6);
      item.spin.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);

      const life = 0.5 + Math.random() * 0.35;
      item.life = life;
      item.maxLife = life;
      item.mesh.scale.setScalar(0.6 + Math.random() * 0.9);
    }
  }

  _updateDebris(dt) {
    for (const item of this._debris.items) {
      if (item.life <= 0) continue;
      item.life -= dt;

      if (item.life <= 0) {
        item.mesh.visible = false;
        continue;
      }

      item.vel.y -= 14 * dt;
      item.mesh.position.addScaledVector(item.vel, dt);
      item.mesh.rotation.x += item.spin.x * dt;
      item.mesh.rotation.y += item.spin.y * dt;
      item.mesh.rotation.z += item.spin.z * dt;

      // 落地就停住并缩小，避免碎块堆在地上
      if (item.mesh.position.y < 0.06) {
        item.mesh.position.y = 0.06;
        item.vel.set(0, 0, 0);
        item.spin.set(0, 0, 0);
        item.mesh.scale.multiplyScalar(Math.max(0.6, 1 - dt * 4));
      }
    }
  }

  /* ---------------- 闪光 ---------------- */

  _makeFlashes() {
    const items = [];
    for (let i = 0; i < FLASH_CAPACITY; i++) {
      const material = new THREE.SpriteMaterial({
        map: this._glow,
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.scene.add(sprite);
      items.push({ sprite, life: 0, maxLife: 0, size: 1 });
    }
    return { items, cursor: 0 };
  }

  _spawnFlash(origin, color, size, life = 0.26) {
    const pool = this._flashes;
    const item = pool.items[pool.cursor];
    pool.cursor = (pool.cursor + 1) % FLASH_CAPACITY;

    item.sprite.position.copy(origin);
    item.sprite.material.color.set(color);
    item.sprite.visible = true;
    item.size = size;
    item.life = life;
    item.maxLife = life;
  }

  _updateFlashes(dt) {
    for (const item of this._flashes.items) {
      if (item.life <= 0) continue;
      item.life -= dt;

      if (item.life <= 0) {
        item.sprite.visible = false;
        continue;
      }

      const progress = 1 - item.life / item.maxLife;
      // 先猛地放大，再收住
      const scale = item.size * (0.55 + progress * 1.5);
      item.sprite.scale.setScalar(scale);
      item.sprite.material.opacity = Math.max(0, 1 - progress) ** 1.5;
    }
  }

  /* ---------------- 能量束 ---------------- */

  _makeBeams() {
    // 半径给足，太细的柱子在远景里只有一两个像素，看不见
    const geometry = new THREE.CylinderGeometry(0.16, 0.16, 1, 10, 1, true);
    // 圆柱默认沿 Y 轴，先转成沿 Z 轴，方便用 lookAt 摆方向
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, 0.5);

    const items = [];
    for (let i = 0; i < BEAM_CAPACITY; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      items.push({ mesh, life: 0, maxLife: 0 });
    }
    return { items, cursor: 0 };
  }

  /* ---------------- 光圈 ---------------- */

  /**
   * 给单位脚底加一圈会呼吸的光环，颜色跟着阵营/属性走。
   * @param {THREE.Object3D} anchor 跟随的对象（一般是单位的 root）
   * @param {string|number} color
   * @param {number} radius
   */
  addRing(anchor, color, radius = 1.1) {
    if (!anchor) return null;

    const geometry = new THREE.RingGeometry(radius * 0.72, radius, 40);
    // 光圈用普通混合而不是加色：地面本身很亮，加色会把颜色冲成白色
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.04;
    anchor.add(mesh);

    const ring = { mesh, anchor, phase: Math.random() * Math.PI * 2 };
    this._rings.set(mesh.uuid, ring);
    return ring;
  }

  removeRing(ring) {
    if (!ring) return;
    this._rings.delete(ring.mesh.uuid);
    ring.anchor?.remove(ring.mesh);
    ring.mesh.geometry.dispose();
    ring.mesh.material.dispose();
  }

  clearRings() {
    for (const ring of [...this._rings.values()]) this.removeRing(ring);
  }

  /* ---------------- 对外接口 ---------------- */

  /**
   * 一次命中
   * @param {THREE.Vector3} position 命中点（世界坐标）
   * @param {{color?:string|number, heavy?:boolean, normal?:THREE.Vector3}} options
   *   normal = 攻击方向，用来把火花往被打的一方推
   */
  impact(position, { color = '#ffb45a', heavy = false, normal = null } = {}) {
    if (!position) return;

    const sparks = heavy ? 34 : 16;
    const debris = heavy ? 8 : 4;
    const flashSize = heavy ? 3.4 : 1.9;

    this._spawnFlash(position, color, flashSize, heavy ? 0.34 : 0.22);
    this._spawnSparks(position, color, sparks, heavy ? 7.5 : 4.6);
    this._spawnDebris(position, debris, color);

    // 命中点再补一圈白色核心，视频里接触点是最亮的
    this._spawnFlash(position, '#ffffff', flashSize * 0.45, 0.14);

    if (normal) this._pushSparks(position, normal, heavy);
    if (heavy) this.shake(0.55);
    else this.shake(0.18);
  }

  /** 把刚生成的火花整体往某个方向推一点（顺着攻击方向崩出去） */
  _pushSparks(position, normal, heavy) {
    const pool = this._sparks;
    const amount = heavy ? 3.2 : 1.8;
    const n = heavy ? 26 : 12;
    for (let i = 1; i <= n; i++) {
      const index = (pool.cursor - i + SPARK_CAPACITY) % SPARK_CAPACITY;
      if (pool.life[index] <= 0) continue;
      const i3 = index * 3;
      pool.vel[i3] += normal.x * amount;
      pool.vel[i3 + 1] += normal.y * amount * 0.5;
      pool.vel[i3 + 2] += normal.z * amount;
    }
  }

  /**
   * 一道能量束
   * @param {THREE.Vector3} from 出手点
   * @param {THREE.Vector3} to 命中点
   */
  beam(from, to, { color = '#9fd8ff', life = 0.22, radius = 1.5 } = {}) {
    if (!from || !to) return;

    const pool = this._beams;
    const item = pool.items[pool.cursor];
    pool.cursor = (pool.cursor + 1) % BEAM_CAPACITY;

    const distance = from.distanceTo(to);
    if (distance < 0.01) return;

    item.mesh.position.copy(from);
    item.mesh.lookAt(to);
    item.mesh.scale.set(radius, radius, distance);
    item.mesh.material.color.set(color);
    item.mesh.material.opacity = 1;
    item.mesh.visible = true;
    item.life = life;
    item.maxLife = life;

    // 束口和束尾各闪一下
    this._spawnFlash(to, color, 1.6, 0.2);
    this._spawnFlash(from, color, 0.9, 0.14);
  }

  /** 屏幕震动，0~1，会累加并衰减 */
  shake(amount) {
    this.shakeAmp = Math.min(1, this.shakeAmp + amount);
  }

  /**
   * 每帧取一个抖动偏移，调用方加到相机位置上。
   * 用两个不同频率的正弦叠加，比纯随机更像「撞击」而不是「抖动」。
   */
  shakeOffset(time = 0) {
    if (this.shakeAmp <= 0.001) {
      this._shake.set(0, 0, 0);
      return this._shake;
    }
    const amp = this.shakeAmp * 0.16;
    this._shake.set(
      Math.sin(time * 61) * amp,
      Math.sin(time * 47 + 1.7) * amp * 0.8,
      Math.sin(time * 53 + 0.6) * amp * 0.6,
    );
    return this._shake;
  }

  update(dt, time = 0) {
    this._updateSparks(dt);
    this._updateDebris(dt);
    this._updateFlashes(dt);

    for (const item of this._beams.items) {
      if (item.life <= 0) continue;
      item.life -= dt;
      if (item.life <= 0) {
        item.mesh.visible = false;
        continue;
      }
      const k = item.life / item.maxLife;
      item.mesh.material.opacity = k;
      // 光束从粗变细，像能量散掉
      item.mesh.scale.x = 0.35 + k * 0.65;
      item.mesh.scale.y = 0.35 + k * 0.65;
    }

    // 光圈呼吸
    for (const ring of this._rings.values()) {
      ring.phase += dt * 2.4;
      ring.mesh.material.opacity = 0.36 + Math.sin(ring.phase) * 0.16;
    }

    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 3.4);
  }

  dispose() {
    this.clearRings();
    for (const pool of [this._sparks]) {
      this.scene.remove(pool.points);
      pool.geometry.dispose();
      pool.points.material.dispose();
    }
    for (const item of this._debris.items) {
      this.scene.remove(item.mesh);
      item.mesh.material.dispose();
    }
    for (const item of this._flashes.items) {
      this.scene.remove(item.sprite);
      item.sprite.material.dispose();
    }
    for (const item of this._beams.items) {
      this.scene.remove(item.mesh);
      item.mesh.material.dispose();
    }
    this._glow.dispose();
  }
}
