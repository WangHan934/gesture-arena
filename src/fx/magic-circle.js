/**
 * 地面魔法阵
 * ==================================================================
 * 竞技场地面原来只有三道同心细环，缺一个「这里是施法场地」的中心。
 * 这里用 canvas 画一张法阵贴图（双环 + 刻度 + 六个符文 + 内三角），
 * 贴在一个加法混合的平面上，再让它缓慢自转 + 呼吸。
 *
 * 【为什么不加更多几何体】
 *   一张 1024 贴图 + 一个 plane 就是全部开销，比用几十个圆环 mesh 拼出来便宜得多，
 *   而且线条的辉光用 canvas 的 shadowBlur 画，比后期 bloom 稳（低端机不会掉帧）。
 *
 * 【为什么两层】
 *   外圈顺时针、内圈逆时针，速度不同，画面会「活」起来，
 *   但两层都是同一张贴图的实例，成本可以忽略。
 */

import * as THREE from 'three';

/** 画一张法阵贴图：外环 / 内环 / 刻度 / 符文 / 内三角 */
function circleTexture({ color = '#a98bff', accent = '#ffd08a', size = 1024 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const c = size / 2;
  const R = size * 0.47;

  const stroke = (radius, width, alpha, tint = color) => {
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.strokeStyle = tint;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.02;

  stroke(R, size * 0.008, 0.95);
  stroke(R * 0.955, size * 0.003, 0.5);
  stroke(R * 0.74, size * 0.005, 0.7);
  stroke(R * 0.42, size * 0.004, 0.55);
  stroke(R * 0.3, size * 0.002, 0.35);

  // 外圈刻度：48 道，长短交替
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const long = i % 4 === 0;
    const r1 = R * 0.955;
    const r2 = R * (long ? 0.88 : 0.915);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
    ctx.strokeStyle = long ? accent : color;
    ctx.globalAlpha = long ? 0.8 : 0.4;
    ctx.lineWidth = long ? size * 0.006 : size * 0.003;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 六个符文：几何小图形，围着内环摆一圈
  const runeR = R * 0.58;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const x = c + Math.cos(a) * runeR;
    const y = c + Math.sin(a) * runeR;
    const s = size * 0.028;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = size * 0.005;
    ctx.beginPath();
    if (i % 3 === 0) {
      ctx.moveTo(0, -s); ctx.lineTo(s * 0.9, s * 0.7); ctx.lineTo(-s * 0.9, s * 0.7); ctx.closePath();
    } else if (i % 3 === 1) {
      ctx.moveTo(-s * 0.8, -s); ctx.lineTo(s * 0.8, -s);
      ctx.moveTo(0, -s); ctx.lineTo(0, s);
    } else {
      ctx.arc(0, 0, s * 0.8, 0, Math.PI * 2);
      ctx.moveTo(0, -s * 0.8); ctx.lineTo(0, s * 0.8);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // 内三角（正反各一个，做出六芒星的感觉）
  const triangle = (rotation) => {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = rotation + (i / 3) * Math.PI * 2;
      const x = c + Math.cos(a) * R * 0.66;
      const y = c + Math.sin(a) * R * 0.66;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = size * 0.003;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  triangle(-Math.PI / 2);
  triangle(Math.PI / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** 中心柔光：把法阵中间提亮一点，别让怪物站在一片死黑上 */
function glowTexture({ size = 512 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(150,120,255,0.55)');
  g.addColorStop(0.45, 'rgba(110,80,220,0.22)');
  g.addColorStop(1, 'rgba(80,50,180,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class MagicCircle {
  /**
   * @param {THREE.Scene} scene
   * @param {{radius?:number, color?:string, accent?:string, glow?:boolean}} options
   */
  constructor(scene, { radius = 6, color = '#a98bff', accent = '#ffd08a', glow = true } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.y = 0.04;
    this.time = 0;

    this.texture = circleTexture({ color, accent });
    this.glowTexture = glow ? glowTexture() : null;

    if (this.glowTexture) {
      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(radius * 2.9, radius * 2.9),
        new THREE.MeshBasicMaterial({
          map: this.glowTexture,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0.9,
        }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = -0.01;
      this.group.add(halo);
      this.halo = halo;
    }

    if (this.texture) {
      const makeLayer = (scale, opacity) => {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(radius * 2, radius * 2),
          new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            opacity,
          }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.scale.setScalar(scale);
        this.group.add(mesh);
        return mesh;
      };
      // 外圈顺时针、内圈逆时针，速度不同
      this.outer = makeLayer(1, 0.5);
      this.inner = makeLayer(0.62, 0.42);
      this.inner.position.y = 0.005;
    }

    scene.add(this.group);
  }

  update(dt, time = 0) {
    this.time += dt;
    const t = time || this.time;
    if (this.outer) this.outer.rotation.z = t * 0.06;
    if (this.inner) this.inner.rotation.z = -t * 0.11;
    if (this.outer) this.outer.material.opacity = 0.42 + Math.sin(t * 1.1) * 0.08;
    if (this.inner) this.inner.material.opacity = 0.34 + Math.sin(t * 1.7 + 1) * 0.07;
    if (this.halo) this.halo.material.opacity = 0.72 + Math.sin(t * 0.9) * 0.12;
  }

  dispose() {
    this.group.traverse((object) => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
    this.scene.remove(this.group);
    this.texture?.dispose();
    this.glowTexture?.dispose();
  }
}
