/**
 * HUD 控制器
 * ------------------------------------------------------------------
 * 负责所有 DOM 界面元素的更新：血条、法力条、提示气泡、结算面板。
 * 和渲染层分开：canvas 里画的是「世界」，这里是「界面」。
 */

import { ECONOMY } from '../config.js';

export class HUD {
  constructor(doc = document) {
    this.playerHpFill = doc.getElementById('player-hp-fill');
    this.playerHpText = doc.getElementById('player-hp-text');
    this.enemyHpFill = doc.getElementById('enemy-hp-fill');
    this.enemyHpText = doc.getElementById('enemy-hp-text');
    this.manaFill = doc.getElementById('mana-fill');
    this.manaText = doc.getElementById('mana-text');

    this.toastEl = doc.getElementById('toast');
    this.resultEl = doc.getElementById('result');
    this.resultTitle = doc.getElementById('result-title');
    this.resultDetail = doc.getElementById('result-detail');

    this.toastTimer = null;
    this.resultShown = false;
  }

  /** 每帧同步数值到界面 */
  update(battle) {
    const p = battle.playerTower;
    const e = battle.enemyTower;

    this.playerHpFill.style.width = `${p.hpRatio * 100}%`;
    this.playerHpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;

    this.enemyHpFill.style.width = `${e.hpRatio * 100}%`;
    this.enemyHpText.textContent = `${Math.ceil(e.hp)} / ${e.maxHp}`;

    this.manaFill.style.width = `${(battle.mana / ECONOMY.manaMax) * 100}%`;
    this.manaText.textContent = `${Math.floor(battle.mana)} / ${ECONOMY.manaMax}`;

    // 结算面板只弹一次
    if (battle.state !== 'playing' && !this.resultShown) {
      this.showResult(battle.state, battle);
    }
  }

  /** 屏幕中上方的短提示 */
  toast(text, type = 'info') {
    const el = this.toastEl;
    el.textContent = text;
    el.className = `toast show ${type}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      el.className = 'toast';
    }, 1300);
  }

  showResult(state, battle) {
    const win = state === 'win';
    this.resultTitle.textContent = win ? '胜利' : '失败';
    this.resultTitle.className = `result-title ${win ? 'win' : 'lose'}`;
    this.resultDetail.textContent =
      `用时 ${battle.time.toFixed(1)} 秒 · 召唤 ${battle.summonCount} 次 · 击杀 ${battle.kills} 个`;
    this.resultEl.classList.add('show');
    this.resultShown = true;
  }

  hideResult() {
    this.resultEl.classList.remove('show');
    this.resultShown = false;
  }
}
