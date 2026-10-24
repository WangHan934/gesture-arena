/**
 * 渲染层
 * ------------------------------------------------------------------
 * 只做「把 battle 的数据画成画面」这一件事。
 * 不修改任何游戏状态，所以可以随时替换成别的美术风格。
 *
 * 坐标说明：canvas 实际像素是 2000x840，构造时 ctx.scale(2,2)，
 * 之后所有绘制都用 1000x420 的逻辑坐标，方便调位置。
 */

import { WORLD } from '../config.js';

/** #rrggbb + 透明度 → rgba() 字符串 */
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = canvas.width / WORLD.width;
    this.ctx.scale(this.scale, this.scale);
    this.stars = this._makeStars();
  }

  _makeStars() {
    const stars = [];
    for (let i = 0; i < 70; i++) {
      stars.push({
        x: Math.random() * WORLD.width,
        y: Math.random() * (WORLD.groundY - 60),
        r: 0.4 + Math.random() * 1.2,
        a: 0.2 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
      });
    }
    return stars;
  }

  /** 清屏。两种玩法共用一块 canvas，切换前统一清一次。 */
  clear() {
    this.ctx.clearRect(0, 0, WORLD.width, WORLD.height);
  }

  /** @param {import('../battle/battle.js').Battle} battle */
  renderTower(battle) {
    const ctx = this.ctx;
    const t = performance.now() / 1000;

    this._drawSky(ctx, t);
    this._drawGround(ctx);
    this._drawTower(ctx, battle.playerTower, WORLD.playerTowerX, '#3d7bff', '#7fa8ff', t);
    this._drawTower(ctx, battle.enemyTower, WORLD.enemyTowerX, '#e04a4a', '#ff8a8a', t);

    // 生物按 y 排序，远的先画，形成前后层次
    const sorted = [...battle.creatures].sort((a, b) => a.y - b.y);
    for (const c of sorted) this._drawCreature(ctx, c, t);

    this._drawParticles(ctx, battle.particles);
    this._drawVignette(ctx);
  }

  /* ---------------- 背景 ---------------- */

  _drawSky(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, 0, WORLD.groundY);
    g.addColorStop(0, '#080c1a');
    g.addColorStop(0.55, '#121a35');
    g.addColorStop(1, '#1b2547');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.width, WORLD.groundY);

    // 星星
    for (const s of this.stars) {
      const twinkle = 0.6 + 0.4 * Math.sin(t * 1.5 + s.phase);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200, 220, 255, ${s.a * twinkle})`;
      ctx.fill();
    }

    // 远处山脊
    ctx.beginPath();
    ctx.moveTo(0, WORLD.groundY);
    ctx.lineTo(0, 250);
    ctx.quadraticCurveTo(120, 190, 250, 235);
    ctx.quadraticCurveTo(380, 280, 500, 220);
    ctx.quadraticCurveTo(640, 165, 760, 235);
    ctx.quadraticCurveTo(880, 285, 1000, 215);
    ctx.lineTo(1000, WORLD.groundY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 15, 32, 0.85)';
    ctx.fill();

    // 地平线光
    const hg = ctx.createLinearGradient(0, WORLD.groundY - 60, 0, WORLD.groundY);
    hg.addColorStop(0, 'rgba(80, 130, 255, 0)');
    hg.addColorStop(1, 'rgba(80, 130, 255, 0.10)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, WORLD.groundY - 60, WORLD.width, 60);
  }

  _drawGround(ctx) {
    const g = ctx.createLinearGradient(0, WORLD.groundY, 0, WORLD.height);
    g.addColorStop(0, '#1d2742');
    g.addColorStop(1, '#0a0f1d');
    ctx.fillStyle = g;
    ctx.fillRect(0, WORLD.groundY, WORLD.width, WORLD.height - WORLD.groundY);

    // 地面高光
    ctx.strokeStyle = 'rgba(110, 160, 255, 0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, WORLD.groundY);
    ctx.lineTo(WORLD.width, WORLD.groundY);
    ctx.stroke();

    // 透视格线
    ctx.strokeStyle = 'rgba(90, 130, 220, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 20; i++) {
      const x = (i / 20) * WORLD.width;
      ctx.beginPath();
      ctx.moveTo(x, WORLD.groundY);
      ctx.lineTo(WORLD.width / 2 + (x - WORLD.width / 2) * 1.35, WORLD.height);
      ctx.stroke();
    }
  }

  /* ---------------- 塔 ---------------- */

  _drawTower(ctx, tower, x, color, glow, t) {
    const baseY = WORLD.groundY + 16;
    const h = 176;
    const w = 66;
    const shake = tower.flash > 0 ? (Math.random() - 0.5) * 5 : 0;

    ctx.save();
    ctx.translate(x + shake, 0);

    // 底座平台
    ctx.beginPath();
    ctx.ellipse(0, baseY, w * 0.78, 11, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 13, 26, 0.85)';
    ctx.fill();
    ctx.strokeStyle = rgba(glow, 0.22);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 塔身
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, '#0e1526');
    g.addColorStop(0.45, color);
    g.addColorStop(1, '#0b111f');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w / 2, baseY);
    ctx.lineTo(-w / 2 + 9, baseY - h);
    ctx.lineTo(w / 2 - 9, baseY - h);
    ctx.lineTo(w / 2, baseY);
    ctx.closePath();
    ctx.fill();

    // 塔身边框
    ctx.strokeStyle = rgba(glow, 0.45);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 横向纹理
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const yy = baseY - (h / 5) * i;
      const shrink = (w / 2) - 2 - (i * 1.6);
      ctx.beginPath();
      ctx.moveTo(-shrink, yy);
      ctx.lineTo(shrink, yy);
      ctx.stroke();
    }

    // 顶部水晶
    const cy = baseY - h - 24;
    const pulse = 1 + Math.sin(t * 2.2) * 0.06;
    ctx.save();
    ctx.translate(0, cy);
    ctx.scale(pulse, pulse);

    const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 48);
    halo.addColorStop(0, rgba(glow, 0.5));
    halo.addColorStop(1, rgba(glow, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(15, 0);
    ctx.lineTo(0, 26);
    ctx.lineTo(-15, 0);
    ctx.closePath();
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // 塔顶血条
    const bw = 76;
    const bx = -bw / 2;
    const by = cy - 48;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 2, by - 2, bw + 4, 10);
    ctx.fillStyle = tower.side === 'player' ? '#4ade80' : '#f87171';
    ctx.fillRect(bx, by, bw * tower.hpRatio, 6);

    ctx.restore();
  }

  /* ---------------- 生物 ---------------- */

  _drawCreature(ctx, c, t) {
    const appear = 0.45 + 0.55 * c.spawnAnim;
    const bob = Math.sin(c.bobPhase) * 1.8;
    const size = c.def.size;
    const cy = c.y - size * 0.42 + bob;
    const pop = 1 + c.attackPulse * 0.9; // 攻击时轻微放大

    // 地面阴影
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + 6, size * 0.36, size * 0.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fill();

    // 阵营光晕
    const haloR = size * 0.95;
    const halo = ctx.createRadialGradient(c.x, cy, 1, c.x, cy, haloR);
    halo.addColorStop(0, rgba(c.def.color, 0.32));
    halo.addColorStop(1, rgba(c.def.color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(c.x, cy, haloR, 0, Math.PI * 2);
    ctx.fill();

    // emoji 本体
    ctx.save();
    ctx.translate(c.x, cy);
    ctx.scale(appear * pop, appear * pop);
    ctx.globalAlpha = c.spawnAnim;
    ctx.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.def.glyph, 0, 0);
    ctx.restore();

    // 受击闪白
    if (c.hitFlash > 0) {
      ctx.beginPath();
      ctx.arc(c.x, cy, size * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${c.hitFlash * 2.2})`;
      ctx.fill();
    }

    // 攻击冲击环
    if (c.attackPulse > 0) {
      const p = 1 - c.attackPulse / 0.15;
      ctx.beginPath();
      ctx.arc(c.x, cy, size * (0.5 + p * 0.5), 0, Math.PI * 2);
      ctx.strokeStyle = rgba(c.def.color, (1 - p) * 0.7);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 血条
    const bw = 32;
    const by = cy - size * 0.72;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(c.x - bw / 2 - 1, by - 1, bw + 2, 5);
    ctx.fillStyle = c.isPlayer ? '#4ade80' : '#f87171';
    ctx.fillRect(c.x - bw / 2, by, bw * c.hpRatio, 3);
  }

  /* ---------------- 特效 ---------------- */

  _drawParticles(ctx, particles) {
    for (const p of particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fillStyle = rgba(p.color.startsWith('#') ? p.color : '#ffffff', a * 0.9);
      ctx.fill();
    }
  }

  _drawVignette(ctx) {
    const g = ctx.createRadialGradient(
      WORLD.width / 2, WORLD.height / 2, WORLD.height * 0.35,
      WORLD.width / 2, WORLD.height / 2, WORLD.width * 0.72
    );
    g.addColorStop(0, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  }
}
