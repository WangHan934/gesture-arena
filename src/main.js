/**
 * 游戏主入口
 * ------------------------------------------------------------------
 * 这一层只做「接线」：
 *   创建各个模块 → 把输入接给召唤系统 → 启动主循环
 *
 * 不含任何游戏规则。要改玩法请去 battle/，改数值去 config.js。
 */

import { Battle } from './battle/battle.js';
import { Renderer } from './ui/renderer.js';
import { HUD } from './ui/hud.js';
import { GestureCanvas } from './input/gesture-canvas.js';
import { Summoner } from './summon/summoner.js';

/* ---------- 组装 ---------- */

const battle = new Battle();
const hud = new HUD(document);
const renderer = new Renderer(document.getElementById('battle-canvas'));
const summoner = new Summoner(battle);

const gesture = new GestureCanvas(document.getElementById('gesture-canvas'), {
  onRecognized(result) {
    const out = summoner.cast(result);
    if (out.message) hud.toast(out.message, out.ok ? 'ok' : 'warn');
  },
});

/* ---------- 画板交互细节 ---------- */

const pad = document.getElementById('pad');
pad.addEventListener('pointerdown', () => pad.classList.add('drawing'));
for (const evt of ['pointerup', 'pointercancel', 'pointerleave']) {
  pad.addEventListener(evt, () => pad.classList.remove('drawing'));
}

/* ---------- 重开 ---------- */

document.getElementById('restart-btn').addEventListener('click', () => {
  battle.reset();
  gesture.clear();
  hud.hideResult();
  hud.toast('新的一局开始', 'ok');
});

/* ---------- 主循环 ---------- */

let last = performance.now();

function frame(now) {
  // 限制单帧步长，切标签页回来时不会瞬间跳一大段
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  battle.update(dt);
  gesture.update(dt);

  renderer.render(battle);
  gesture.render();
  hud.update(battle);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
