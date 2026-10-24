import { MONSTERS, SPELLS, TURN_MS } from '../pvp/rules.js';

// Visual presentation only. IDs, health and spells always come from the PvP rules.
export const MONSTER_PROFILES = {
  fire: { english: 'INFERNAL HORNBEAST', element: '烈焰', accent: '#ff782f', light: '#ffd08c', rgb: '255,120,47', lore: '炎角战魔踏入竞技场，火焰沿着巨角与肩甲升起。画出你的第一道符号，与另一位召唤师交锋。' },
  shadow: { english: 'CRYSTAL SHADOWFIEND', element: '紫晶', accent: '#a45cff', light: '#dcb9ff', rgb: '164,92,255', lore: '紫晶影魔从幽暗中现身，棱晶勾勒出它的轮廓。每一次攻守，都由你亲手画下的符号决定。' },
  rock: { english: 'CRYSTAL GOLEM', element: '幽晶', accent: '#5ed3d6', light: '#bff5ec', rgb: '94,211,214', lore: '幽晶岩魔站上石台，沉重的岩甲中透出晶光。与对手同等的生命、同样的技能，等待你的选择。' },
};

export class SelectionScreen {
  constructor(onSelect) {
    this.home = document.getElementById('home');
    this.dialog = document.getElementById('entry-dialog');
    this.roster = document.getElementById('home-roster');
    this.onSelect = onSelect;
    this.selected = null;
    this.sound = false;
    this.buttons = [];
    for (const [index, monster] of MONSTERS.entries()) {
      const profile = MONSTER_PROFILES[monster.id];
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'beast';
      button.id = `select-${monster.id}`; button.dataset.monster = monster.id;
      button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'selection-stage');
      button.style.setProperty('--beast-accent', profile.accent);
      const rail = document.createElement('span'); rail.className = 'beast-rail';
      const avatar = document.createElement('span'); avatar.className = 'beast-avatar';
      const img = document.createElement('img'); img.src = `art/renders/monsters/${monster.image}`; img.alt = ''; avatar.append(img);
      const main = document.createElement('span'); main.className = 'beast-main';
      const name = document.createElement('span'); name.className = 'beast-name'; name.textContent = monster.name;
      const sub = document.createElement('span'); sub.className = 'beast-sub'; sub.textContent = `${profile.element} · ${monster.hp} HP · 0${index + 1}`;
      main.append(name, sub); button.append(rail, avatar, main);
      button.addEventListener('click', () => { this.onSelect(monster.id); this.tone(); });
      button.addEventListener('keydown', event => {
        const i = this.buttons.indexOf(button);
        let next;
        if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = (i + 1) % MONSTERS.length;
        if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = (i + MONSTERS.length - 1) % MONSTERS.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = MONSTERS.length - 1;
        if (next !== undefined) { event.preventDefault(); this.buttons[next].focus(); this.onSelect(MONSTERS[next].id); this.tone(); }
      });
      this.buttons.push(button); this.roster.append(button);
    }
    const stats = [['生命', `${MONSTERS[0].hp}`, 100], ['回合', `${TURN_MS / 1000}s`, 75], ['技能', `${SPELLS.length}`, 100]];
    document.getElementById('selection-stats').replaceChildren(...stats.map(([label, value, width]) => {
      const li = document.createElement('li'); li.className = 'stat';
      const key = document.createElement('span'); key.className = 'stat-k'; key.textContent = label;
      const bar = document.createElement('span'); bar.className = 'stat-bar'; bar.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('i'); fill.style.width = `${width}%`; bar.append(fill);
      const amount = document.createElement('span'); amount.className = 'stat-v'; amount.textContent = value;
      li.append(key, bar, amount); return li;
    }));
    document.getElementById('selection-skills').replaceChildren(...SPELLS.slice(0, -1).map(spell => {
      const li = document.createElement('li'); li.className = 'skill';
      const glyph = document.createElement('span'); glyph.className = 'skill-ic'; glyph.textContent = spell.glyph; glyph.setAttribute('aria-hidden', 'true');
      const main = document.createElement('span'); main.className = 'skill-main';
      const name = document.createElement('span'); name.className = 'skill-name'; name.textContent = spell.name;
      const desc = document.createElement('span'); desc.className = 'skill-desc'; desc.textContent = spell.hint;
      const cd = document.createElement('span'); cd.className = 'skill-cd'; cd.textContent = spell.cooldown ? `冷却 ${spell.cooldown} 回合` : '无冷却';
      main.append(name, desc); li.append(glyph, main, cd); return li;
    }));
    const ultimate = SPELLS.at(-1);
    document.getElementById('selection-ultimate-name').textContent = `${ultimate.glyph} ${ultimate.name}`;
    document.getElementById('selection-ultimate-desc').textContent = `${ultimate.hint} · 冷却 ${ultimate.cooldown} 个己方回合`;
    document.getElementById('selection-enter').addEventListener('click', () => this.open());
    document.getElementById('entry-close').addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('click', event => {
      const rect = this.dialog.getBoundingClientRect();
      if (event.target === this.dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) this.dialog.close();
    });
    const soundButton = document.getElementById('selection-sound');
    soundButton.addEventListener('click', () => {
      this.sound = !this.sound; soundButton.setAttribute('aria-pressed', String(this.sound));
      soundButton.setAttribute('aria-label', this.sound ? '关闭界面音效' : '开启界面音效'); this.tone();
    });
    window.addEventListener('keydown', event => {
      if (this.home.hidden || this.dialog.open || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable) return;
      const match = /^(?:Digit|Numpad)([1-3])$/.exec(event.code);
      if (match) { event.preventDefault(); this.onSelect(MONSTERS[Number(match[1]) - 1].id); this.tone(); }
      if (event.key === 'Enter' && (event.target === document.body || this.roster.contains(event.target))) { event.preventDefault(); this.open(); }
    });
    window.addEventListener('pagehide', () => { this.audio?.close().catch(() => {}); this.audio = null; });
  }

  update(id, active) {
    if (!active && this.dialog.open) this.dialog.close();
    if (this.selected === id) return;
    this.selected = id;
    const monster = MONSTERS.find(m => m.id === id), profile = MONSTER_PROFILES[id];
    this.home.dataset.selectedMonster = id;
    for (const [name, value] of Object.entries({accent: profile.accent, 'accent-2': profile.light, rgb: profile.rgb})) this.home.style.setProperty(`--${name}`, value);
    for (const button of this.buttons) { const selected = button.dataset.monster === id; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; }
    for (const [key, value] of Object.entries({name: monster.name, english: profile.english, watermark: profile.english, type: profile.element, element: profile.element, lore: profile.lore})) document.getElementById(`selection-${key}`).textContent = value;
    document.getElementById('entry-monster').textContent = monster.name;
    document.getElementById('battle-canvas').setAttribute('aria-label', `${monster.name}与原始竞技场`);
    document.getElementById('selection-stage').setAttribute('aria-labelledby', `select-${id}`);
  }

  open() { if (!this.home.hidden && !this.dialog.open) { this.dialog.showModal(); document.getElementById('player-name').focus(); this.tone(); } }
  tone() {
    if (!this.sound) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
      this.audio ||= new Audio(); this.audio.resume().catch(() => {});
      const osc = this.audio.createOscillator(), gain = this.audio.createGain(), now = this.audio.currentTime;
      osc.type = 'sine'; osc.frequency.setValueAtTime(380, now); osc.frequency.exponentialRampToValueAtTime(190, now + .11);
      gain.gain.setValueAtTime(.025, now); gain.gain.exponentialRampToValueAtTime(.001, now + .14);
      osc.connect(gain).connect(this.audio.destination); osc.start(now); osc.stop(now + .15);
    } catch { /* Optional UI sound must never interrupt room entry. */ }
  }
}
