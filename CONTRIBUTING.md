# 协作指南

给 5 人小团队用。目标只有一个：**同时开工，互不覆盖。**

---

## 一、分工边界

只改自己负责的目录。需要别人目录里的改动，先说一声，不要直接动。

| 角色 | 负责目录 |
|---|---|
| A 手势 | `src/input/` |
| B 生物 | `src/summon/` |
| C 战斗 | `src/battle/` |
| D 界面 | `src/ui/` |
| E 整合 | 根目录 + `main.js` + `config.js` + `index.html` |

**`main.js` 和 `index.html` 只有 E 改。** 这两个文件是所有模块的交汇点，多人同时改必然冲突。

---

## 二、每次开工的标准动作

```bash
# 1. 回到主干并同步
git checkout main
git pull

# 2. 开自己的分支（分支名见下表）
git checkout -b feature/你的任务

# 3. 改代码，中途可以多次提交
git add .
git commit -m "feat: 说明你做了什么"

# 4. 推到远程
git push -u origin feature/你的任务
```

然后在 GitHub 上打开仓库，会看到一个黄色提示条 **Compare & pull request**，点它发起 PR。

### 分支命名

| 前缀 | 用途 | 例子 |
|---|---|---|
| `feature/` | 新功能 | `feature/sound-effect` |
| `fix/` | 修 bug | `fix/creature-stuck` |
| `art/` | 美术资源 | `art/tower-sprite` |
| `docs/` | 文档 | `docs/update-readme` |

### 提交信息

格式：`类型: 说明`

```
feat: 新增巨魔召唤
fix: 修复生物在塔前卡住
art: 替换雷鸟为像素图
docs: 补充 Windows 启动说明
```

一句话说清改了什么，不要写 "update" "修改" 这种看不出内容的信息。

---

## 三、PR 检查清单

发起 PR 前，自己先过一遍：

- [ ] 本地能启动（`start.bat` 或 `bash start.sh`）
- [ ] 画手势能正常召唤
- [ ] 一局能正常分出胜负
- [ ] 没有在控制台看到红色报错（F12 打开开发者工具看 Console）
- [ ] 只改了自己负责的目录
- [ ] 数值改动写在 `config.js` 或 `creature-data.js` 里，没有硬编码在逻辑中

PR 标题写清楚做了什么，描述里贴一张截图更好。

**合并规则**：至少 1 人 review 通过才能合进 `main`。`main` 必须永远处于可运行状态。

---

## 四、代码风格

保持简单，初学者也要能读懂。

```js
// 好的写法：一个函数只做一件事，变量名说人话
function updateMana(battle, dt) {
  if (battle.manaPause > 0) {
    battle.manaPause -= dt;
    return;
  }
  battle.mana = Math.min(ECONOMY.manaMax, battle.mana + ECONOMY.manaRegen * dt);
}

// 避免：所有逻辑塞在一起，变量名是 a、b、tmp
```

几条硬性约定：

1. **魔法数字进 config**。不要在逻辑里写 `if (mana > 45)`，改成 `if (mana > def.cost)`。
2. **模块只导出必要的**。`export` 越少越好，别人能改的地方就少。
3. **不要跨层调用**。`battle/` 不能 import `ui/`，`ui/` 可以读 `battle/` 的数据。
4. **中文注释写"为什么"**，不写"是什么"。代码本身能看出是什么。

---

## 五、出问题了怎么办

| 现象 | 原因 | 解决 |
|---|---|---|
| 打开白屏 | 直接双击了 index.html | 用 `start.bat` / `start.sh` 启动 |
| 端口被占用 | 8000 已有程序 | Windows 改 `start.bat` 里的 `set PORT=8000` 为 8001 |
| 画手势没反应 | 画得太短或形状不对 | 画大一点、标准一点，看画板下方提示 |
| `git push` 被拒绝 | 远程有新提交 | 先 `git pull --rebase`，解决冲突后再推 |
| 改完没生效 | 浏览器缓存 | Ctrl + F5 强制刷新 |

**卡住了不要自己硬扛。** 把报错信息、你改了什么、期望是什么，一起丢给 AI 或队友，比一句"坏了"有用得多。
