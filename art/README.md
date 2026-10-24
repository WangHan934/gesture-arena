# 《空绘兽斗》美术资源（art/）

本目录只包含 3D 美术资源与说明，不包含游戏代码，也不修改仓库其他目录。

## 内容

| 路径 | 说明 |
|---|---|
| `blender/AISummoner_Monsters_Arena_v2_FireAnim.blend` | 三只怪兽 + 远古元素斗兽场 + 炎角战魔绑定与 8 个动作（Blender 5.2.3） |
| `docs/monster_tech_plan_v1.md` | 模型检查、绑定方案、动画清单、技能特效、竞技场调整、Blender→Unity 导出流程 |
| `renders/` | 怪兽三视图、竞技场、动画关键姿势预览图 |

## Blender 对象与游戏角色对应

| Blender 集合 | 游戏角色 | 绑定 / 动画 |
|---|---|---|
| `ShadowMonster` | 紫晶影魔 Amethyst Shadowfiend | 未绑定 |
| `FireMonster` + `InfernalHornbeast_Rig` | 炎角战魔 Infernal Hornbeast | 已绑定；Idle / Walk / Run / Attack / Defend / Hit / Cast / Death |
| `RockMonster` | 幽晶岩魔 Abyssal Crystal Golem | 未绑定 |
| `Arena` | 远古元素斗兽场 | 含出生点 `Arena_Spawn_A_Player` / `Arena_Spawn_B_Enemy`、对战相机 |

## 预览动画

打开 .blend，把场景结束帧改为 399，播放时间轴即可连续看到 8 个动作（两条 NLA 预览轨道）。

## 规范

- 30 fps，原地动作（无根运动），四元数旋转。
- 动作事件以 Pose Marker 记录（如 `VFX_FireBlast_Start`），导出 Unity 时转为 Animation Event，见技术方案第六节。
