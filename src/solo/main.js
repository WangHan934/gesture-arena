/**
 * 人机对战 · 页面编排
 * ==================================================================
 * 只做三件事：把输入接进来、把引擎推进一步、把结果画出来。
 * 规则全在 engine.js，3D 全在 scene.js，这里不写任何数值。
 */

import { MONSTERS } from '../pvp/rules.js';
import {
  createBattle, tick, cast, drainEvents, cooldownProgress,
  SOLO_SPELLS, SPELL_BY_ID, PLAYER_HP, ENEMY_HP, ENEMY_INTERVAL,
} from './engine.js';
import { SoloScene } from './scene.js';
import { GestureCanvas } from '../input/gesture-canvas.js';
import { recognizeSpell } from '../input/gesture-recognizer.js';
import { CameraInput } from '../input/camera-input.js';
import { AirStroke } from '../input/air-stroke.js';

const $ = id => document.getElementById(id);
const stage = $('stage');

const player = { id: 'fire' };
let battle = null;
let enemy = null;
let started = false;

/* ---------------- 3D 场景 ---------------- */

const scene = new SoloScene(document.createElement('canvas'), (state, message) => {
  $('solo-status').textContent = message;
  const hint = $('preview-hint');
  if (hint) {
    hint.textContent = state === 'ready' ? '' : message;
    hint.hidden = state === 'ready';
  }
  if (state === 'error') tell(message);
});
scene.mount($('select-preview'));
scene.ready.then(() => {
  if (started && battle) scene.showFight(player.id, enemy);
  else scene.showSelect(player.id);
}).catch(error => {
  console.error('[3D] 初始化失败', error);
  tell(`3D 初始化失败：${error.message}`);
});

/* ---------------- 选怪 ---------------- */

function monsterById(id) {
  return MONSTERS.find(m => m.id === id) || MONSTERS[0];
}

function renderRoster() {
  const host = $('solo-roster');
  host.replaceChildren();
  for (const monster of MONSTERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'monster';
    button.dataset.monster = monster.id;
    button.setAttribute('aria-pressed', String(monster.id === player.id));

    const img = document.createElement('img');
    img.src = `art/renders/monsters/${monster.image}`;
    img.alt = `${monster.name}模型预览`;
    const name = document.createElement('b');
    name.textContent = monster.name;
    const sub = document.createElement('small');
    sub.textContent = '外观可选 · 数值一致';

    button.append(img, name, sub);
    button.addEventListener('click', () => selectMonster(monster.id));
    host.append(button);
  }
  markSelected();
}

function markSelected() {
  for (const button of document.querySelectorAll('#solo-roster [data-monster]')) {
    const on = button.dataset.monster === player.id;
    button.classList.toggle('selected', on);
    button.setAttribute('aria-pressed', String(on));
  }
}

function selectMonster(id) {
  if (started) return;
  player.id = id;
  markSelected();
  scene?.showSelect(id);
}

/* ---------------- 开局 / 结算 ---------------- */

function pickEnemy() {
  const pool = MONSTERS.filter(m => m.id !== player.id);
  return pool[Math.floor(Math.random() * pool.length)].id;
}

function startFight() {
  enemy = pickEnemy();
  battle = createBattle(player.id, enemy);
  started = true;

  $('select').hidden = true;
  $('fight').hidden = false;
  $('solo-result').hidden = true;
  $('telegraph').hidden = true;
  $('battle-log').replaceChildren();
  $('fight-clock').textContent = `${ENEMY_INTERVAL.toFixed(1)}s`;

  $('self-name').textContent = `${monsterById(player.id).name}（你）`;
  $('enemy-name').textContent = monsterById(enemy).name;
  $('self-health').max = PLAYER_HP;
  $('enemy-health').max = ENEMY_HP;

  scene.mount($('solo-view'));
  scene?.showFight(player.id, enemy);
  renderHud();
  tell(`对战开始 · 对手是${monsterById(enemy).name}`);
}

function endFight() {
  const win = battle.winner === 'win';
  $('result-title').textContent = win ? '胜利' : '失败';
  $('result-detail').textContent =
    `用时 ${battle.time.toFixed(1)} 秒 · 剩余生命 ${battle.hp.player} / ${PLAYER_HP}`;
  $('solo-result').hidden = false;
  $('telegraph').hidden = true;
  $('pad-label').textContent = win ? '你赢了' : '再来一次';
  renderHud();
}

function backToSelect() {
  started = false;
  battle = null;
  camera.disable();
  gesture.clear();
  air.reset();
  $('fight').hidden = true;
  $('select').hidden = false;
  scene.mount($('select-preview'));
  scene?.showSelect(player.id);
  renderRoster();
}

/* ---------------- 施法 ---------------- */

function canCast() {
  return Boolean(battle) && battle.winner === null && !document.hidden;
}

function doCast(id) {
  if (!canCast()) {
    if (battle?.winner !== null && battle) tell('本局已结束，点「再来一局」');
    return;
  }
  const result = cast(battle, id);
  tell(result.message);
  renderHud();
}

/* ---------------- HUD ---------------- */

function renderHud() {
  if (!battle) return;
  const hp = battle.hp;
  $('self-hp').textContent = `${hp.player} / ${PLAYER_HP}`;
  $('enemy-hp').textContent = `${hp.enemy} / ${ENEMY_HP}`;
  $('self-health').value = hp.player;
  $('enemy-health').value = hp.enemy;

  const buffs = [];
  if (battle.shieldLeft > 0) buffs.push(`护盾 ${battle.shieldLeft.toFixed(1)}s`);
  if (battle.support > 0) buffs.push(`援军 +${battle.support}`);
  $('self-buffs').textContent = buffs.join(' · ');
  $('enemy-buffs').textContent = battle.enemy.phase === 'windup' ? '蓄力中…' : '';

  $('fight-time').textContent = `${battle.time.toFixed(1)} 秒`;
  $('fight-label').textContent = battle.winner === 'win' ? '已获胜' : battle.winner === 'lose' ? '已落败' : '战斗中';
  $('fight-clock').textContent = battle.winner !== null ? '—'
    : battle.enemy.phase === 'windup' ? '蓄力'
    : `${Math.max(0, battle.enemy.timer).toFixed(1)}s`;

  $('telegraph').hidden = battle.winner !== null || battle.enemy.phase !== 'windup';

  $('battle-log').replaceChildren(...battle.log.slice(-5).map(line => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }));

  for (const button of document.querySelectorAll('#spells [data-spell]')) {
    const id = button.dataset.spell;
    const spell = SPELL_BY_ID[id];
    const progress = cooldownProgress(battle, id);
    button.style.setProperty('--cd', String(progress));
    button.classList.toggle('ready', progress === 0);
    button.disabled = !canCast() || progress > 0;
    const hint = button.querySelector('small');
    hint.textContent = progress > 0
      ? `冷却 ${battle.cooldowns[id].toFixed(1)}s`
      : spell.hint;
  }
}

let feedbackTimer;
function tell(message) {
  const el = $('feedback');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------------- 特效 ---------------- */

function floatText(text, kind) {
  const el = document.createElement('span');
  el.className = `float-damage ${kind}`;
  el.textContent = text;
  stage.append(el);
  setTimeout(() => el.remove(), 1000);
}

function flashHurt() {
  stage.classList.remove('hurt');
  void stage.offsetWidth; // 强制重排，让动画能重播
  stage.classList.add('hurt');
  setTimeout(() => stage.classList.remove('hurt'), 460);
}

function handleEvents() {
  for (const event of drainEvents(battle)) {
    switch (event.type) {
      case 'playerHit':
        scene?.play(0, event.spell === 'circle' ? 'Attack' : 'Cast');
        scene?.play(1, 'Hit');
        floatText(`-${event.damage}`, 'to-enemy');
        if (battle.hp.enemy <= 0) scene?.die(1);
        break;
      case 'enemyHit':
        scene?.play(1, 'Attack');
        scene?.play(0, 'Hit');
        floatText(event.blocked ? `-${event.damage} 挡住` : `-${event.damage}`, 'to-player');
        flashHurt();
        if (battle.hp.player <= 0) scene?.die(0);
        break;
      case 'heal':
        scene?.play(0, 'Cast');
        if (event.amount > 0) floatText(`+${event.amount}`, 'heal');
        break;
      case 'shield':
        scene?.play(0, 'Defend');
        break;
      case 'support':
        scene?.play(0, 'Cast');
        break;
      case 'enemyWindup':
        tell(`敌方蓄力重击（${event.damage} 点）· 现在开盾能减半`);
        break;
      default:
        break;
    }
  }
}

/* ---------------- 输入 ---------------- */

const gesture = new GestureCanvas($('gesture-canvas'), {
  recognizer: recognizeSpell,
  onRecognized(result) {
    if (!canCast()) return;
    if (result) doCast(result.id);
    else tell('没认出来，请再画一次');
  },
});

const air = new AirStroke(points => {
  const result = recognizeSpell(points);
  gesture.points = points;
  gesture.opacity = 1;
  gesture.holdTimer = 0.7;
  if (!canCast()) return;
  if (result) doCast(result.id);
  else tell('没认出来，放下手后再试一次');
});

const camera = new CameraInput({
  onStatus(status) {
    $('camera-btn').textContent = camera.active ? '关闭摄像头' : '开启摄像头';
    $('camera-note').textContent = status.state === 'ready'
      ? '只伸食指在空中画符号，停住 1.5 秒提交；放下手后开始下一笔。'
      : status.state === 'error' ? status.message : '鼠标、触屏均可绘制。';
  },
});

for (const spell of SOLO_SPELLS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'spell';
  button.dataset.spell = spell.id;
  button.title = spell.hint;
  button.setAttribute('aria-label', spell.name);

  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.textContent = spell.glyph;
  const name = document.createElement('b');
  name.textContent = spell.name;
  const hint = document.createElement('small');
  hint.textContent = spell.hint;
  const key = document.createElement('kbd');
  key.textContent = spell.key;

  button.append(glyph, name, hint, key);
  button.addEventListener('click', () => doCast(spell.id));
  $('spells').append(button);
}

$('solo-start').addEventListener('click', startFight);
$('again-btn').addEventListener('click', startFight);
$('reselect-btn').addEventListener('click', backToSelect);
$('camera-btn').addEventListener('click', async () => {
  const button = $('camera-btn');
  button.disabled = true;
  try {
    await camera.toggle();
    air.reset();
  } finally {
    button.disabled = false;
  }
});

window.addEventListener('keydown', event => {
  if (event.repeat || event.isComposing || ['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable) return;
  if (!started) {
    const pick = /^(?:Digit|Numpad)([1-3])$/.exec(event.code);
    if (pick) {
      event.preventDefault();
      selectMonster(MONSTERS[Number(pick[1]) - 1].id);
    }
    if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') {
      event.preventDefault();
      startFight();
    }
    return;
  }
  const match = /^(?:Digit|Numpad)([1-6])$/.exec(event.code);
  if (match) {
    event.preventDefault();
    doCast(SOLO_SPELLS[Number(match[1]) - 1].id);
  }
});

window.addEventListener('pagehide', () => camera.disable());
document.addEventListener('visibilitychange', () => {
  // 切走再回来，主循环的 dt 已经截断，这里只负责把画到一半的笔迹丢掉
  if (document.hidden) air.reset();
});

/* ---------------- 3D 与主循环 ---------------- */

let previous = performance.now();
function frame(now) {
  // 上限 0.1 秒：低帧率设备（10fps 以上）时间仍然准确，
  // 切后台回来那种几秒的大跳变会被截断，敌人不会连打。
  const dt = Math.min(0.1, (now - previous) / 1000);
  previous = now;

  if (started && battle) {
    if (battle.winner === null && !document.hidden) {
      tick(battle, dt);
      handleEvents();
      renderHud();
    }
    // 胜负可能是 tick 打出来的，也可能是玩家这一刀直接砍死的，
    // 所以结算必须独立判断，不能塞在「还在打」的分支里。
    if (battle.winner !== null && $('solo-result').hidden) endFight();
  }

  try {
    scene.update(dt);
  } catch (error) {
    console.error('[3D] 渲染帧失败', error);
    tell('3D 渲染失败，刷新页面可恢复；战斗仍可继续。');
  }

  gesture.update(dt);
  air.update(camera.getFrame(now), now, canCast() && camera.active);
  if (air.points.length) {
    gesture.points = air.points.slice();
    gesture.opacity = 1;
    gesture.holdTimer = 0.1;
  }
  gesture.render();

  requestAnimationFrame(frame);
}

// 现场排查用：控制台里 __solo 能看到战斗状态和 3D 对象
window.__solo = { scene, get battle() { return battle; }, get started() { return started; } };

renderRoster();
requestAnimationFrame(frame);
