/**
 * 手势稳定器（纯逻辑）
 * ============================================================================
 * 解决两件事，都是"一帧就触发"带来的：
 *
 *   1. 抖动误触：分类器偶尔会在两帧之间跳一下（手指边缘、光照变化）。
 *      要求同一个手势连续保持 stableMs（默认 260ms）才算数，
 *      一帧的毛刺根本熬不到触发点。
 *
 *   2. 按住连发：手一直举着 1 根手指，如果每帧都发 SELECT_MONSTER，
 *      游戏会收到 60 次选择。所以触发一次后"锁住"，
 *      必须先把这只手换成别的手势（离开）保持 releaseMs，
 *      才能再次触发。等于强制"举手一次 = 一条指令"。
 *
 * 时间用调用方传进来的毫秒值，不读 Date.now()，方便单测。
 * ============================================================================
 */

export class PoseStabilizer {
  /**
   * @param {{stableMs?:number, releaseMs?:number, ignore?:string[]}} [opts]
   */
  constructor({ stableMs = 260, releaseMs = 180, ignore = ['none'] } = {}) {
    this.stableMs = stableMs;
    this.releaseMs = releaseMs;
    this.ignore = new Set(ignore);

    this.candidate = null;   // 当前正在计时的候选手势
    this.since = 0;          // 候选开始的时刻
    this.emitted = null;     // 上一次真正触发过的手势
    this.releasedAt = null;  // 手离开上次手势的起始时刻
  }

  /**
   * 喂一帧识别结果。
   * @param {string} pose 手势名，认不出来传 'none'
   * @param {number} t 毫秒时间戳（单调递增）
   * @returns {string|null} 需要触发的手势，不需要就返回 null
   */
  push(pose, t) {
    if (pose !== this.candidate) {
      this.candidate = pose;
      this.since = t;
    }

    // 解锁判定：离开上次触发的手势足够久，才允许再次触发
    if (this.emitted !== null) {
      if (pose === this.emitted) {
        this.releasedAt = null;       // 又回到原手势，重新计时
      } else {
        if (this.releasedAt === null) this.releasedAt = t;
        if (t - this.releasedAt >= this.releaseMs) this.emitted = null;
      }
    }

    if (this.ignore.has(pose)) return null;
    if (t - this.since < this.stableMs) return null;
    if (this.emitted === pose) return null;

    this.emitted = pose;
    this.releasedAt = null;
    return pose;
  }

  /** 手离开画面、切摄像头、重开一局时调用 */
  reset() {
    this.candidate = null;
    this.since = 0;
    this.emitted = null;
    this.releasedAt = null;
  }

  /** 给 UI 用的即时状态（不需要触发也能显示进度） */
  get state() {
    return {
      candidate: this.candidate,
      emitted: this.emitted,
      held: this.candidate === null ? 0 : this.since,
      locked: this.emitted !== null,
    };
  }
}

/**
 * 进度 0..1：手保持当前候选手势多久了（用来画"按住进度条"）。
 * @param {PoseStabilizer} s
 * @param {number} t
 */
export function holdProgress(s, t) {
  if (!s.candidate || s.ignore.has(s.candidate)) return 0;
  if (t <= s.since) return 0;
  return Math.min(1, (t - s.since) / s.stableMs);
}
