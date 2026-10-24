/**
 * HUD 控制器
 * ------------------------------------------------------------------
 * 负责所有 DOM 界面元素的更新：血条、资源条、提示气泡、结算面板。
 * 和渲染层分开：canvas 里画的是「世界」，这里是「界面」。
 *
 * 【为什么吃 view 而不是吃 battle】
 *   现在有两套玩法，内部数据结构不一样（塔防看塔，决斗看人）。
 *   HUD 只认统一视图模型 view.hud（见 src/modes/README.md），
 *   这样加第三种玩法时 HUD 一行都不用改。
 */

/** 把比例夹在 0~1，防止负血量把血条画到外面 */
function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

export class HUD {
  constructor(doc = document) {
    this.playerHpFill = doc.getElementById('player-hp-fill');
    this.playerHpText = doc.getElementById('player-hp-text');
    this.playerLabel = doc.getElementById('player-hp-label');

    this.enemyHpFill = doc.getElementById('enemy-hp-fill');
    this.enemyHpText = doc.getElementById('enemy-hp-text');
    this.enemyLabel = doc.getElementById('enemy-hp-label');

    this.resourceFill = doc.getElementById('mana-fill');
    this.resourceText = doc.getElementById('mana-text');
    this.resourceLabel = doc.getElementById('mana-label');

    this.toastEl = doc.getElementById('toast');
    this.resultEl = doc.getElementById('result');
    this.resultTitle = doc.getElementById('result-title');
    this.resultDetail = doc.getElementById('result-detail');

    this.toastTimer = null;
    this.resultShown = false;
  }

  /**
   * 每帧同步数值到界面
   * @param {object} view src/modes 产出的统一视图模型
   */
  update(view) {
    const { left, right, resource } = view.hud;

    this.playerHpFill.style.width = `${clamp01(left.ratio) * 100}%`;
    this.playerHpText.textContent = `${Math.ceil(left.hp)} / ${left.maxHp}`;
    if (this.playerLabel) this.playerLabel.textContent = left.label;

    this.enemyHpFill.style.width = `${clamp01(right.ratio) * 100}%`;
    this.enemyHpText.textContent = `${Math.ceil(right.hp)} / ${right.maxHp}`;
    if (this.enemyLabel) this.enemyLabel.textContent = right.label;

    if (resource) {
      this.resourceFill.style.width = `${clamp01(resource.ratio) * 100}%`;
      // 决斗模式的资源是「就绪 / 蓄力中」，没有数字上限
      this.resourceText.textContent = resource.max === '' || resource.max === undefined
        ? String(resource.value)
        : `${resource.value} / ${resource.max}`;
      if (this.resourceLabel) this.resourceLabel.textContent = resource.label;

      // 技能就绪时条变成金色，和法力条区分开
      this.resourceFill.classList.toggle('ready', Boolean(resource.ready));
    }

    // 结算面板只弹一次；选怪阶段不算结束
    if (view.phase !== 'playing' && view.phase !== 'select' && !this.resultShown) {
      this.showResult(view);
    }
  }

  /** 屏幕中上方的短提示 */
  toast(text, type = 'info') {
    const el = this.toastEl;
    if (!el) return;
    el.textContent = text;
    el.className = `toast show ${type}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      el.className = 'toast';
    }, 1300);
  }

  /** @param {object} view 统一视图模型 */
  showResult(view) {
    const win = view.phase === 'win';
    this.resultTitle.textContent = win ? '胜利' : '失败';
    this.resultTitle.className = `result-title ${win ? 'win' : 'lose'}`;
    this.resultDetail.textContent = view.stats?.detail ?? '';
    this.resultEl.classList.add('show');
    this.resultShown = true;
  }

  hideResult() {
    this.resultEl.classList.remove('show');
    this.resultShown = false;
  }
}
