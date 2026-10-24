/**
 * 手势分类（纯函数）
 * ============================================================================
 * 只做一件事：把 MediaPipe 的 21 个关键点翻译成一个手势名字。
 *
 * 为什么只数四根手指（食指/中指/无名指/小指）：
 *   「竖起 N 根手指」里的 N 就是这四根，拇指不参与计数。
 *   拇指单独判断，只用来确认「手掌是真的张开」。
 *
 * 不碰 DOM、不碰摄像头，可以直接在 Node 里测。
 * ============================================================================
 */

/** MediaPipe 关键点索引 */
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const TIPS = [8, 12, 16, 20];   // 食 / 中 / 无名 / 小指指尖
const PIPS = [6, 10, 14, 18];   // 对应的近端指间关节

export const POSES = {
  OPEN_PALM: 'open_palm',   // 五指张开 → 确认
  FIST: 'fist',             // 握拳     → 攻击
  ONE: 'one',               // 食指     → 选择 1 号
  TWO: 'two',               // 食指+中指 → 选择 2 号
  THREE: 'three',           // 三指     → 选择 3 号
  NONE: 'none',             // 认不出来
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 四根手指各自是伸直还是弯曲。
 *
 * 判据：指尖离手腕的距离 > 近端指间关节离手腕的距离 × 1.12。
 * 手指伸直时指尖在最远端；弯曲时指尖往掌心收，会落到关节内侧。
 * 12% 的余量是为了容忍关键点抖动，太小会误判、太大会漏判。
 */
export function fingerStates(lm) {
  const wrist = lm[WRIST];
  const scale = Math.max(1e-6, dist(wrist, lm[MIDDLE_MCP]));

  const states = TIPS.map((tip, i) => {
    const dTip = dist(wrist, lm[tip]);
    const dPip = dist(wrist, lm[PIPS[i]]);
    // 后一个条件挡住「手离镜头太远、整体缩成一团」的情况
    return dTip > dPip * 1.12 && dTip > scale * 0.55;
  });

  // 拇指：伸直时指尖离食指根很远，收到掌心时会贴上去
  const thumb = dist(lm[THUMB_TIP], lm[INDEX_MCP]) > scale * 0.55;

  return { states, thumb, scale };
}

/**
 * 关键点 → 手势。
 *
 * @param {Array<{x:number,y:number,z?:number}>} lm 21 个关键点
 * @returns {{pose:string, count:number, fingers:boolean[], thumb:boolean,
 *            scale:number, openness:number, reason:string}}
 */
export function classifyPose(lm) {
  if (!lm || lm.length < 21) {
    return { pose: POSES.NONE, count: 0, fingers: [], thumb: false, scale: 0, openness: 0, reason: 'no-hand' };
  }

  const { states, thumb, scale } = fingerStates(lm);
  const [index, middle, ring] = states;
  const count = states.filter(Boolean).length;

  // 开合度：四个指尖到手腕的平均距离 / 手掌尺度。握拳约 1.4，张开约 2.0
  const openness = TIPS.reduce((sum, tip) => sum + dist(lm[WRIST], lm[tip]), 0) / (TIPS.length * scale);

  let pose = POSES.NONE;
  let reason = '';

  if (scale < 0.035) {
    reason = 'too-small';        // 手离镜头太远
  } else if (count === 4) {
    pose = POSES.OPEN_PALM;
  } else if (count === 3 && index && middle && ring) {
    pose = POSES.THREE;
  } else if (count === 2 && index && middle) {
    pose = POSES.TWO;
  } else if (count === 1 && index) {
    pose = POSES.ONE;
  } else if (count === 0) {
    pose = POSES.FIST;
  } else {
    // 比如只竖起小指、或者食指+无名指：认不出，宁可不动
    reason = 'ambiguous';
  }

  return { pose, count, fingers: states, thumb, scale, openness, reason };
}

/** 给 UI 用的中文名 */
export const POSE_LABEL = {
  [POSES.OPEN_PALM]: '张开手掌',
  [POSES.FIST]: '握拳',
  [POSES.ONE]: '竖起 1 根手指',
  [POSES.TWO]: '竖起 2 根手指',
  [POSES.THREE]: '竖起 3 根手指',
  [POSES.NONE]: '未识别',
};
