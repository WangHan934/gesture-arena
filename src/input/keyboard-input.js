/**
 * 键盘备用控制
 * ==================================================================
 * 为什么要有：比赛现场摄像头可能挂、投影可能反光、鼠标可能失灵。
 * 只要键盘能走完「选玩法 → 选怪 → 战斗 → 胜负 → 重开」，演示就保得住。
 *
 * 【设计原则：和手势走同一条路】
 *   键盘不直接调战斗引擎，而是合成一个「手势结果」交给模式层的 handleAction()。
 *   这样冷却、射程、法力判断全部复用同一套逻辑，
 *   不会出现「键盘能无限召唤 / 绕过冷却」这种两套逻辑各写一遍的 bug。
 *
 * 【为什么用 event.code 而不是 event.key】
 *   code 是物理键位，不受键盘布局影响。
 *   法语 AZERTY 键盘上按「1」那个键，key 是 '&'，但 code 永远是 'Digit1'。
 */

/**
 * 全局按键：不属于任何模式，由 main.js 直接处理。
 * 这里只作为「文档 + 测试」的单一来源，避免说明和实现各写一份。
 */
export const GLOBAL_KEY_LABELS = {
  Enter: '再来一局',
  Escape: '切换玩法',
  KeyC: '摄像头开关',
};

/**
 * 按键 → 模式动作。
 * 动作词表和摄像头完全一致（见各模式的 cameraMap）：
 *   creature:N / monster:N / attack / skill / toward / away
 *
 * @param {string} code KeyboardEvent.code
 * @param {{keyMap?: Record<string,string>}} mode
 * @returns {string | null}
 */
export function resolveModeAction(code, mode) {
  const map = mode?.keyMap;
  if (!map || typeof map !== 'object') return null;
  const action = map[code];
  return typeof action === 'string' ? action : null;
}

/** 这个键是不是全局键（模式动作不该抢） */
export function isGlobalKey(code) {
  return Object.prototype.hasOwnProperty.call(GLOBAL_KEY_LABELS, code);
}

/**
 * 键盘监听器。只负责把按键冒泡出去，不做任何游戏判断。
 */
export class KeyboardInput {
  /**
   * @param {object} options
   * @param {(code: string, event: KeyboardEvent) => void} options.onKey
   * @param {EventTarget} [options.target]
   */
  constructor({ onKey, target = document } = {}) {
    this.onKey = onKey ?? null;
    this.target = target;
    this._handler = (event) => this._handle(event);
    this.target?.addEventListener('keydown', this._handler);
  }

  _handle(event) {
    // 正在输入框里打字时不要抢键
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
    // 输入法组合中不处理
    if (event.isComposing) return;

    this.onKey?.(event.code, event);
  }

  destroy() {
    this.target?.removeEventListener('keydown', this._handler);
  }
}
