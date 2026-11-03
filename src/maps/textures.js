/**
 * 程序化贴图
 * ==================================================================
 * 全部用 canvas 现画，仓库里不放任何图片文件 —— 和项目现有做法一致
 * （combat-fx / health-bar / arena-dressing / magic-circle 都是这样）。
 *
 * 为什么不用图片：
 *   1. 512² 的 PNG 一张 200~600KB，首屏预算早就卡死了
 *   2. 熔岩祭坛需要「砖缝 / 裂纹 / 苔痕」这类高频细节，现画可以按参数调
 *   3. 没有美术依赖，改配色只改代码
 *
 * node 里没有 document，所以 createTextures() 会返回 null，
 * 材质退回纯色 —— 单测照样能跑几何和尺寸。
 */

import * as THREE from '../../vendor/three/lib/three.module.js';

const hasDOM = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

/** 确定性随机：同一张图每次生成结果一致，方便对比调参 */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function toTexture(cv, { repeat = 1, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ================================================================
 * 深色破损石砖
 * ================================================================ */

function stoneBrick() {
  const SIZE = 512;
  const cv = canvas(SIZE);
  const ctx = cv.getContext('2d');
  const rnd = seeded(20261031);

  // 底色：接近玄武岩的黑，留一点紫
  ctx.fillStyle = '#4d4a56';
  ctx.fillRect(0, 0, SIZE, SIZE);

  const ROWS = 8;
  const ROW_H = SIZE / ROWS;
  const BRICK_W = 128;

  for (let r = 0; r < ROWS; r++) {
    const offset = (r % 2) * (BRICK_W / 2);
    for (let x = -BRICK_W; x < SIZE + BRICK_W; x += BRICK_W) {
      const bx = x + offset;
      const by = r * ROW_H;

      // 每块砖的明度不同，砖墙才不会像贴图
      const shade = 86 + Math.floor(rnd() * 34);
      ctx.fillStyle = `rgb(${shade},${shade - 2},${shade + 3})`;
      ctx.fillRect(bx + 2, by + 2, BRICK_W - 4, ROW_H - 4);

      // 上沿高光 / 下沿阴影：给砖一点厚度
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(bx + 2, by + 2, BRICK_W - 4, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(bx + 2, by + ROW_H - 5, BRICK_W - 4, 3);
    }
  }

  // 裂纹
  ctx.strokeStyle = 'rgba(6,5,8,0.85)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    let x = rnd() * SIZE;
    let y = rnd() * SIZE;
    ctx.lineWidth = 1 + rnd() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 3 + Math.floor(rnd() * 4);
    for (let s = 0; s < steps; s++) {
      x += (rnd() - 0.5) * 60;
      y += (rnd() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 颗粒噪声：去掉「纯色渐变」的塑料感
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rnd() - 0.5) * 22;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  return cv;
}

/* ================================================================
 * 中央地面：同心刻痕 + 放射裂纹
 * ================================================================ */

function stoneFloor() {
  const SIZE = 512;
  const cv = canvas(SIZE);
  const ctx = cv.getContext('2d');
  const rnd = seeded(777);
  const c = SIZE / 2;

  ctx.fillStyle = '#484450';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // 同心圆刻痕
  for (let i = 1; i <= 7; i++) {
    ctx.beginPath();
    ctx.arc(c, c, (SIZE / 2) * (i / 7.4), 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.035)';
    ctx.lineWidth = i % 2 ? 5 : 2;
    ctx.stroke();
  }

  // 放射分割线
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * 18, c + Math.sin(a) * 18);
    ctx.lineTo(c + Math.cos(a) * (SIZE / 2), c + Math.sin(a) * (SIZE / 2));
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 裂纹
  ctx.strokeStyle = 'rgba(4,3,6,0.9)';
  for (let i = 0; i < 10; i++) {
    const a = rnd() * Math.PI * 2;
    let r = 30 + rnd() * 100;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    ctx.lineWidth = 1 + rnd() * 2;
    for (let s = 0; s < 4; s++) {
      r += 25 + rnd() * 40;
      const aa = a + (rnd() - 0.5) * 0.5;
      ctx.lineTo(c + Math.cos(aa) * r, c + Math.sin(aa) * r);
    }
    ctx.stroke();
  }

  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rnd() - 0.5) * 18;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  return cv;
}

/* ================================================================
 * 法阵符文（透明底，给 MagicCircle 之外的自发光圆盘用）
 * ================================================================ */

function sigilTexture() {
  const SIZE = 512;
  const cv = canvas(SIZE);
  const ctx = cv.getContext('2d');
  const c = SIZE / 2;
  const R = SIZE / 2 - 8;

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = '#ff6a22';
  ctx.fillStyle = '#ff6a22';
  ctx.lineCap = 'round';

  const ring = (r, w, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  };

  ring(R, 6, 1);
  ring(R * 0.94, 2, 0.6);
  ring(R * 0.72, 4, 0.8);
  ring(R * 0.4, 2, 0.5);

  // 外圈刻度
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const long = i % 4 === 0;
    const r0 = R * 0.94;
    const r1 = R * (long ? 0.86 : 0.9);
    ctx.lineWidth = long ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.stroke();
  }

  // 内圈六芒结构
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 3;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * R * 0.72, c + Math.sin(a) * R * 0.72);
    ctx.lineTo(c + Math.cos(a + Math.PI * 2 / 3) * R * 0.72, c + Math.sin(a + Math.PI * 2 / 3) * R * 0.72);
    ctx.stroke();
  }

  // 中心菱形
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = c + Math.cos(a) * R * 0.22;
    const y = c + Math.sin(a) * R * 0.22;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.globalAlpha = 1;
  return cv;
}

/* ================================================================
 * 粒子贴图
 * ================================================================ */

function flameTexture() {
  const SIZE = 128;
  const cv = canvas(SIZE);
  const ctx = cv.getContext('2d');
  const c = SIZE / 2;

  const g = ctx.createRadialGradient(c, c * 1.15, 2, c, c, c);
  g.addColorStop(0, 'rgba(255,246,214,1)');
  g.addColorStop(0.25, 'rgba(255,196,92,0.95)');
  g.addColorStop(0.55, 'rgba(255,104,26,0.55)');
  g.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);

  return cv;
}

function emberTexture() {
  const SIZE = 64;
  const cv = canvas(SIZE);
  const ctx = cv.getContext('2d');
  const c = SIZE / 2;

  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,226,168,1)');
  g.addColorStop(0.35, 'rgba(255,132,40,0.85)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);

  return cv;
}

function smokeTexture() {
  const SIZE = 128;
  const cv = canvas(SIZE);
  const ctx = cv.getContext('2d');
  const c = SIZE / 2;

  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(120,110,105,0.55)');
  g.addColorStop(0.5, 'rgba(70,64,62,0.28)');
  g.addColorStop(1, 'rgba(40,36,34,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);

  return cv;
}

/* ================================================================
 * 出口
 * ================================================================ */

/**
 * 生成全部贴图。node（无 DOM）返回 null，材质会退回纯色。
 * @returns {{brick: THREE.Texture, floor: THREE.Texture, sigil: THREE.Texture,
 *            flame: THREE.Texture, ember: THREE.Texture, smoke: THREE.Texture} | null}
 */
export function createTextures() {
  if (!hasDOM()) return null;

  return {
    brick: toTexture(stoneBrick()),
    floor: toTexture(stoneFloor()),
    sigil: toTexture(sigilTexture()),
    flame: toTexture(flameTexture(), { srgb: true }),
    ember: toTexture(emberTexture()),
    smoke: toTexture(smokeTexture()),
  };
}

export default createTextures;
