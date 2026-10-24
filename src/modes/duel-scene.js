/**
 * 决斗模式的画面绘制
 * ==================================================================
 * 纯函数：给一个已经 scale 好的 2D context，把 world 画出来。
 * 不持有任何状态（星星表由调用方传入），所以可以安全地被反复调用。
 *
 * 逻辑坐标系和塔防一致：1000 × 420。
 *   0 ─────────────── 250 ── 天空 / 地面分界
 *                    350 ── 生物站位（脚底）
 *                    420 ── 画面底边
 */

import { WORLD, DUEL } from '../config.js';

const HORIZON = 250;
const FLOOR_TOP = HORIZON;
const FLOOR_BOTTOM = WORLD.height;

function rgba(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** 冲刺进度 0→1→0，用于「向前冲再弹回」 */
function lungeProgress(remain, total) {
  if (remain <= 0) return 0;
  return Math.sin((1 - remain / total) * Math.PI);
}

/**
 * @param {CanvasRenderingContext2D} ctx 已经做过 ctx.scale 的上下文
 * @param {object} world duel-mode 产出的 world 对象
 * @param {number} t 当前时间（秒）
 * @param {Array} stars 星空数据
 */
export function drawDuelScene(ctx, world, t, stars = []) {
  drawBackdrop(ctx, t, stars);
  drawArena(ctx, t);

  // 还没选玩法：只画擂台当背景板
  if (!world) {
    drawVignette(ctx);
    return;
  }

  // 选了决斗但还没选生物
  if (!world.player || !world.enemy) {
    drawWaitingHint(ctx);
    drawVignette(ctx);
    return;
  }

  drawCenterMark(ctx, t);

  // 后画的在前面，保证冲刺时压住对手
  const playerFirst = !(world.lunge.player > 0);
  const order = playerFirst ? ['player', 'enemy'] : ['enemy', 'player'];

  for (const side of order) {
    drawFighter(ctx, world[side], world, side, t);
  }

  drawEffects(ctx, world.effects ?? []);
  drawVignette(ctx);
}

/* ---------------- 背景 ---------------- */

function drawBackdrop(ctx, t, stars) {
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON);
  g.addColorStop(0, '#070a16');
  g.addColorStop(0.6, '#111a33');
  g.addColorStop(1, '#1c2749');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD.width, HORIZON);

  for (const s of stars) {
    const twinkle = 0.6 + 0.4 * Math.sin(t * 1.5 + s.phase);
    ctx.beginPath();
    ctx.arc(s.x, s.y * 0.6, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200, 220, 255, ${s.a * twinkle * 0.8})`;
    ctx.fill();
  }

  // 两侧的光柱，把视线往中间收
  for (const x of [120, WORLD.width - 120]) {
    const beam = ctx.createLinearGradient(x, 0, x, HORIZON);
    beam.addColorStop(0, 'rgba(90, 140, 255, 0.10)');
    beam.addColorStop(1, 'rgba(90, 140, 255, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x - 26, 0);
    ctx.lineTo(x + 26, 0);
    ctx.lineTo(x + 60, HORIZON);
    ctx.lineTo(x - 60, HORIZON);
    ctx.closePath();
    ctx.fill();
  }
}

function drawArena(ctx, t) {
  // 地面
  const g = ctx.createLinearGradient(0, FLOOR_TOP, 0, FLOOR_BOTTOM);
  g.addColorStop(0, '#1a2340');
  g.addColorStop(1, '#080c18');
  ctx.fillStyle = g;
  ctx.fillRect(0, FLOOR_TOP, WORLD.width, FLOOR_BOTTOM - FLOOR_TOP);

  // 地面中心的圆形擂台光
  const cx = WORLD.width / 2;
  const cy = 356;
  const ring = ctx.createRadialGradient(cx, cy, 20, cx, cy, 340);
  ring.addColorStop(0, 'rgba(90, 140, 255, 0.16)');
  ring.addColorStop(0.55, 'rgba(70, 110, 220, 0.06)');
  ring.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 380, 62, 0, 0, Math.PI * 2);
  ctx.fill();

  // 擂台边线
  ctx.strokeStyle = 'rgba(110, 160, 255, 0.18)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 340, 54, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 地平线
  ctx.strokeStyle = 'rgba(110, 160, 255, 0.30)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, FLOOR_TOP);
  ctx.lineTo(WORLD.width, FLOOR_TOP);
  ctx.stroke();

  // 透视格线
  ctx.strokeStyle = 'rgba(90, 130, 220, 0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 16; i++) {
    const x = (i / 16) * WORLD.width;
    ctx.beginPath();
    ctx.moveTo(x, FLOOR_TOP);
    ctx.lineTo(cx + (x - cx) * 1.5, FLOOR_BOTTOM);
    ctx.stroke();
  }
}

function drawCenterMark(ctx, t) {
  const cx = WORLD.width / 2;

  // 中缝
  ctx.strokeStyle = 'rgba(140, 180, 255, 0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 90);
  ctx.lineTo(cx, FLOOR_BOTTOM);
  ctx.stroke();

  // VS
  const pulse = 0.55 + 0.15 * Math.sin(t * 2);
  ctx.save();
  ctx.globalAlpha = pulse * 0.5;
  ctx.font = 'bold 44px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#9dc4ff';
  ctx.fillText('VS', cx, 150);
  ctx.restore();
}

function drawWaitingHint(ctx) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.font = '22px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#9dc4ff';
  ctx.fillText('选择一只生物开始决斗', WORLD.width / 2, 170);
  ctx.restore();
}

/* ---------------- 战斗单位 ---------------- */

function drawFighter(ctx, unit, world, side, t) {
  const dir = side === 'player' ? 1 : -1;
  const lunge = lungeProgress(world.lunge[side], side === 'player' ? DUEL.lungeTime : DUEL.lungeTime) * DUEL.lungeDistance;
  const bob = Math.sin(t * 2.4 + (side === 'player' ? 0 : 1.7)) * 2.2;

  const feetY = DUEL.fighterY;
  const cx = unit.x + dir * lunge;
  const cy = feetY - unit.size * 0.55 + bob;

  // 脚下阴影
  ctx.beginPath();
  ctx.ellipse(unit.x, feetY + 4, unit.size * 0.40, unit.size * 0.11, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.fill();

  // 阵营光晕
  const haloR = unit.size * 1.15;
  const halo = ctx.createRadialGradient(cx, cy, 2, cx, cy, haloR);
  halo.addColorStop(0, rgba(unit.color, 0.34));
  halo.addColorStop(1, rgba(unit.color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.fill();

  // 技能就绪的蓄力环（只画玩家）
  if (side === 'player') {
    drawSkillRing(ctx, cx, cy, unit, world.skillReady, t);
  }

  // 敌人出手前的预警
  if (side === 'enemy' && world.enemyNextAttackIn !== null && world.enemyNextAttackIn < 0.55) {
    const warn = 1 - world.enemyNextAttackIn / 0.55;
    ctx.beginPath();
    ctx.ellipse(unit.x, feetY + 4, unit.size * (0.5 + warn * 0.35), unit.size * (0.16 + warn * 0.1), 0, 0, Math.PI * 2);
    ctx.strokeStyle = world.enemyHeavyNext
      ? `rgba(255, 120, 90, ${0.25 + warn * 0.5})`
      : `rgba(255, 90, 90, ${0.15 + warn * 0.35})`;
    ctx.lineWidth = world.enemyHeavyNext ? 3 : 2;
    ctx.stroke();
  }

  // emoji 本体（朝向：玩家朝右，敌人朝左）
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(dir, 1);
  ctx.font = `${unit.size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(unit.glyph, 0, 0);
  ctx.restore();

  // 受击闪白
  const flash = world.hit[side];
  if (flash > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, unit.size * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.85, flash * 3.4)})`;
    ctx.fill();
  }

  drawNameplate(ctx, unit, cx, feetY + 20);
}

function drawSkillRing(ctx, cx, cy, unit, ready, t) {
  const r = unit.size * 0.72;
  const start = -Math.PI / 2;

  ctx.save();
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  // 底环
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(120, 160, 255, 0.14)';
  ctx.stroke();

  if (ready) {
    // 就绪：金色呼吸环
    const a = 0.45 + 0.25 * Math.sin(t * 4);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 217, 61, ${a})`;
    ctx.stroke();
  }

  ctx.restore();
}

function drawNameplate(ctx, unit, cx, y) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = rgba(unit.color, 0.95);
  ctx.fillText(unit.name, cx, y);

  // 细血条
  const bw = 96;
  const by = y + 12;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(cx - bw / 2 - 1, by - 1, bw + 2, 7);
  ctx.fillStyle = unit.side === 'player' ? '#4ade80' : '#f87171';
  ctx.fillRect(cx - bw / 2, by, bw * Math.max(0, unit.ratio), 5);

  ctx.restore();
}

/* ---------------- 特效 ---------------- */

function drawEffects(ctx, effects) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const fx of effects) {
    if (fx.kind !== 'damage') continue;

    const a = Math.max(0, fx.life / fx.maxLife);
    // 刚出现时先放大一下，再稳定
    const pop = fx.life > fx.maxLife * 0.78 ? 1.35 : 1;

    ctx.globalAlpha = a;
    ctx.font = `bold ${Math.round((fx.big ? 34 : 24) * pop)}px "Segoe UI", system-ui, sans-serif`;

    // 描边保证在任何背景上都读得清
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.strokeText(`-${fx.value}`, fx.x, fx.y);

    ctx.fillStyle = fx.color;
    ctx.fillText(`-${fx.value}`, fx.x, fx.y);
  }

  ctx.restore();
}

function drawVignette(ctx) {
  const g = ctx.createRadialGradient(
    WORLD.width / 2, WORLD.height / 2, WORLD.height * 0.36,
    WORLD.width / 2, WORLD.height / 2, WORLD.width * 0.72,
  );
  g.addColorStop(0, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
}
