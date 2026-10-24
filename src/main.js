/**
 * 游戏主入口
 * ------------------------------------------------------------------
 * 这一层只做「接线」：
 *   选模式 → 创建模式实例 → 把手势接给它 → 启动主循环 → 按模式挑渲染器
 *
 * 不含任何游戏规则。要改玩法去 src/modes/，改数值去 config.js。
 */

import { Renderer } from './ui/renderer.js';
import { HUD } from './ui/hud.js';
import { GestureCanvas } from './input/gesture-canvas.js';
import { CameraInput } from './input/camera-input.js';
import { drawDuelScene } from './modes/duel-scene.js';
import {
  MODES,
  MODE_IDS,
  createMode,
  resolveInitialMode,
  rememberMode,
} from './modes/index.js';

const doc = document;

/* ---------- 组装 ---------- */

const hud = new HUD(doc);
const renderer = new Renderer(doc.getElementById('battle-canvas'));

/** 当前模式实例；null = 还没选玩法 */
let mode = null;
let modeId = null;

/** 选玩法 / 选生物期间冻结推进，但画面继续画 */
let paused = true;

const gesture = new GestureCanvas(doc.getElementById('gesture-canvas'), {
  onRecognized(result) {
    if (!mode || paused) return;
    const out = mode.handleGesture(result);
    if (out?.message) hud.toast(out.message, out.ok ? 'ok' : 'warn');
  },
});

/* ---------- 摄像头手势（默认关闭，点按钮才开） ---------- */

const camera = new CameraInput({
  onPose(pose) {
    if (!mode || paused) return;

    const action = mode.cameraMap?.[pose];
    if (!action) return; // 这个姿态在当前模式没有对应动作，静默忽略

    const out = mode.handleCameraAction(action);
    if (out?.message) hud.toast(out.message, out.ok ? 'ok' : 'warn');

    // 摄像头选了生物 → 关掉选怪浮层、开始对局
    if (out?.started) startDuelBattle();
  },
  onStatus(status) {
    updateCameraUi(status);

    if (status.state === 'requesting') {
      hud.toast('正在请求摄像头…', 'info');
    } else if (status.state === 'ready') {
      hud.toast('摄像头就绪，对着镜头比手势', 'ok');
    } else if (status.state === 'error') {
      // 具体原因（权限被拒 / 被占用 / 没设备）由左下角的摄像头面板显示 + 提供重试，
      // 气泡只放一句短的，否则长文案会撑破气泡宽度
      hud.toast('摄像头没开起来，鼠标照常能玩', 'warn');
    }
  },
});

/* ---------- 小工具 ---------- */

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null; // 隐私模式下 localStorage 会抛错
  }
}

function showOverlay(id) {
  const el = doc.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  el.setAttribute('aria-hidden', 'false');
}

function hideOverlay(id) {
  const el = doc.getElementById(id);
  if (!el) return;
  el.classList.remove('show');
  el.setAttribute('aria-hidden', 'true');
}

/** 按当前模式重画控制条上的手势图例 */
function renderLegend(items) {
  const box = doc.getElementById('legend');
  if (!box) return;
  box.innerHTML = '';

  for (const item of items) {
    const row = doc.createElement('div');
    row.className = 'legend-item';
    row.style.setProperty('--accent', item.color || '#9dc4ff');

    const glyph = doc.createElement('b');
    glyph.textContent = item.glyph;

    row.appendChild(glyph);
    row.appendChild(doc.createTextNode(item.label));
    if (item.cost != null) {
      row.appendChild(doc.createTextNode(` ${item.cost}`));
    }
    box.appendChild(row);
  }
}

/* ---------- 摄像头 UI ---------- */

/**
 * 摄像头开关按钮的状态
 * @param {{state:string, message:string}} status
 */
function updateCameraUi(status) {
  const btn = doc.getElementById('camera-btn');
  if (!btn) return;

  const on = status.state === 'ready' || status.state === 'requesting';
  btn.classList.toggle('on', on);
  // 开启时把游戏整体收窄，给左下角的摄像头画中画让出位置（原因见 style.css 的 --camera-reserve）
  doc.body.classList.toggle('camera-on', on);
  btn.textContent = status.state === 'requesting'
    ? '摄像头…'
    : on ? '摄像头 开' : '摄像头';
  btn.title = status.message || '开启摄像头手势';
}

/**
 * 摄像头开着的时候，在图例下方显示「比什么手势 = 干什么」。
 * 关着就整块隐藏，不占地方。
 */
function renderCameraHint() {
  const box = doc.getElementById('camera-hint');
  if (!box) return;

  const items = camera.active ? (mode?.getCameraHint?.() ?? []) : [];
  box.innerHTML = '';
  box.classList.toggle('show', items.length > 0);

  for (const item of items) {
    const row = doc.createElement('span');
    row.className = 'camera-hint-item';

    const glyph = doc.createElement('b');
    glyph.textContent = item.glyph;

    row.appendChild(glyph);
    row.appendChild(doc.createTextNode(item.label));
    box.appendChild(row);
  }
}

/* ---------- 模式选择界面 ---------- */

function buildModeCards() {
  const grid = doc.getElementById('mode-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (const id of MODE_IDS) {
    const def = MODES[id];
    const card = doc.createElement('button');
    card.type = 'button';
    card.className = 'mode-card';
    card.style.setProperty('--accent', def.accent);
    card.dataset.mode = id;

    const title = doc.createElement('div');
    title.className = 'mode-card-title';
    title.textContent = def.name;

    const tag = doc.createElement('div');
    tag.className = 'mode-card-tag';
    tag.textContent = def.tagline;

    const desc = doc.createElement('div');
    desc.className = 'mode-card-desc';
    desc.textContent = def.desc;

    card.append(title, tag, desc);
    card.addEventListener('click', () => switchMode(id));
    grid.appendChild(card);
  }
}

/* ---------- 决斗：选生物界面 ---------- */

function buildRoster() {
  const grid = doc.getElementById('roster-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const list = mode?.roster ?? [];
  if (!list.length) {
    const empty = doc.createElement('p');
    empty.className = 'overlay-sub';
    empty.textContent = '没读到生物表，请检查 src/summon/creature-data.js';
    grid.appendChild(empty);
    return;
  }

  for (const unit of list) {
    const card = doc.createElement('button');
    card.type = 'button';
    card.className = 'roster-card';
    card.style.setProperty('--accent', unit.color);

    const glyph = doc.createElement('div');
    glyph.className = 'roster-glyph';
    glyph.textContent = unit.glyph;

    const name = doc.createElement('div');
    name.className = 'roster-name';
    name.textContent = unit.name;

    const stats = doc.createElement('div');
    stats.className = 'roster-stats';
    stats.textContent = `血 ${unit.maxHp} · 攻 ${unit.attack} · 速 ${unit.speed}`;

    card.append(glyph, name, stats);
    card.addEventListener('click', () => pickMonster(unit.id));
    grid.appendChild(card);
  }
}

function openDuelSelect() {
  paused = true;
  buildRoster();
  showOverlay('duel-select');
}

function pickMonster(id) {
  if (!mode || typeof mode.selectMonster !== 'function') return;
  const res = mode.selectMonster(id);
  if (!res.ok) {
    hud.toast(res.message ?? '选不了这只生物', 'warn');
    return;
  }
  startDuelBattle();
}

/** 生物选定后：关掉选怪浮层、解冻主循环。鼠标点和摄像头选都走这里 */
function startDuelBattle() {
  hideOverlay('duel-select');
  paused = false;
  hud.hideResult();
  renderCameraHint(); // 决斗开打后对照表从「选怪」切成「普攻 / 技能」
  hud.toast('决斗开始', 'ok');
}

/* ---------- 切换玩法 ---------- */

function switchMode(id) {
  if (!MODES[id]) return;

  modeId = id;
  mode = createMode(id);
  rememberMode(id, safeStorage());

  // 界面按模式调整
  doc.body.dataset.mode = id;
  const tagline = doc.getElementById('tagline');
  if (tagline) tagline.textContent = MODES[id].tagline;

  renderLegend(mode.getLegend());
  renderCameraHint();
  hud.hideResult();
  gesture.clear();
  hideOverlay('mode-select');

  if (id === 'duel') {
    openDuelSelect();
    return;
  }

  hideOverlay('duel-select');
  paused = false;
  hud.toast('塔防制：画手势召唤生物', 'ok');
}

/* ---------- 画板交互细节 ---------- */

const pad = doc.getElementById('pad');
pad.addEventListener('pointerdown', () => pad.classList.add('drawing'));
for (const evt of ['pointerup', 'pointercancel', 'pointerleave']) {
  pad.addEventListener(evt, () => pad.classList.remove('drawing'));
}

/* ---------- 按钮 ---------- */

doc.getElementById('restart-btn').addEventListener('click', () => {
  if (!mode) return;

  hud.hideResult();
  gesture.clear();

  const out = mode.restart();
  if (modeId === 'duel') {
    openDuelSelect();
    return;
  }

  paused = false;
  if (out?.message) hud.toast(out.message, 'ok');
});

doc.getElementById('switch-mode-btn').addEventListener('click', () => {
  paused = true;
  showOverlay('mode-select');
});

doc.getElementById('duel-back-btn').addEventListener('click', () => {
  hideOverlay('duel-select');
  paused = true;
  showOverlay('mode-select');
});

// 摄像头开关：第一次点才请求权限，失败也只提示，不影响鼠标玩法
doc.getElementById('camera-btn').addEventListener('click', async () => {
  const btn = doc.getElementById('camera-btn');
  btn.disabled = true;
  try {
    await camera.toggle();
  } finally {
    btn.disabled = false;
    renderCameraHint();
  }
});

/* ---------- 空视图（还没选玩法时） ---------- */

const EMPTY_VIEW = {
  mode: 'duel',
  phase: 'select',
  result: null,
  time: 0,
  hud: {
    left: { label: '我方', hp: 0, maxHp: 1, ratio: 0 },
    right: { label: '对手', hp: 0, maxHp: 1, ratio: 0 },
    resource: { label: '资源', value: '', max: '', ratio: 0 },
  },
  legend: [],
  world: null,
  stats: { detail: '' },
};

/* ---------- 主循环 ---------- */

let last = performance.now();

function frame(now) {
  // 限制单帧步长，切标签页回来时不会瞬间跳一大段
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (mode && !paused) mode.update(dt);
  gesture.update(dt);

  const view = mode ? mode.getView() : EMPTY_VIEW;

  renderer.clear();
  if (view.mode === 'duel') {
    drawDuelScene(renderer.ctx, view.world, now / 1000, renderer.stars);
  } else {
    renderer.renderTower(view.world);
  }

  gesture.render();
  hud.update(view);

  requestAnimationFrame(frame);
}

/* ---------- 启动 ---------- */

buildModeCards();

const initial = resolveInitialMode(window.location.search, safeStorage());
if (initial) {
  switchMode(initial);
} else {
  showOverlay('mode-select');
}

requestAnimationFrame(frame);
