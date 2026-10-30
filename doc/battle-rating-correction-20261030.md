# 2026-10-30 正式服 BR 修正

## 范围与来源

本次仅修正七架已收录飞机的分模式 BR，涉及英国、中国、日本和苏联四棵航空树。费用、配件、载具前置、等级门槛及用户计划不变。不发布安装包，不改旧 Release。

- 前版本 2.59.0.93：`501af3e34af2cb82d65140297e1b994b444c4b88`。
- 正式服 2.59.0.94：`2423f3099e2a5ec3f31efdce87b9f4380ea761ec`。
- [完整游戏配置](https://github.com/gszabi99/War-Thunder-Datamine/blob/2423f3099e2a5ec3f31efdce87b9f4380ea761ec/char.vromfs.bin_u/config/wpcost.blkx)。两版完整配置、长度、SHA-256、Git blob 和旧科技树哈希记录在 `config/battle-rating-correction.json`，写入前验证七辆的完整 BR 差异覆盖。
- [版本记录](https://gist.github.com/gszabi99/c0c98bf03ae996f871b71d614437432b)。不读取移动的 master 作为生产来源，不导入 2.60.0.20 测试服数据。
- 游戏的模式回退规则文件 `ranks_common_shared.nut` 在两版间 SHA-256 相同，沿用已有同难度模式映射。

## 修正内容

| 载具 | 模式 | 原值 | 新值 |
| --- | --- | --- | --- |
| Hawk T. Mk. 1a、Hawk T. Mk. 1a (FRP) | 空战 AB/RB/SB；继承的海战 AB/RB/SB | 7.7 | 7.3 |
| 中系 F-16A-20 | 空战 SB；继承的海战 SB | 14.0 | 13.7 |
| N1K2-J、N1K2-Ja、喷火 Mk XVIIIe、Yak-3U | 陆战 RB | 6.7 | 6.3 |

模式专用字段不存在时沿用游戏的基本字段回退；因此 Hawk 的陆战 AB 也随基本 Arcade 字段变为 7.3，但陆战 RB/SB 的专用字段仍为 7.0。这些映射不代表每个模式组合都实际可用。

主卡片继续显示空战 RB，仅两架 Hawk 的主卡片变为 7.3；中系 F-16A-20 保持 13.7，两架紫电改保持 6.0，喷火和 Yak-3U 保持 5.7。Wiki 历史证据不改写。

网页版本标记和最新核对说明更新为 2.59.0.94；原始全量快照、历史 BR 更新、费用和配件检查点保留，不能把这次局部修正当成全量数据升级。JSON 清单同步新哈希，保留原有缓存校验和用户存储。

## 验证

- Windows、Node.js 24.21.0；未修复基线 `a703a1d`。
- 新增七架飞机的三项模式断言：更新前 0 通过 / 3 失败，数据更新后 3/3 通过。
- `node --test tools/test-battle-ratings.cjs tools/test-battle-rating-correction.cjs tools/test-game-data-review.cjs tools/test-vehicle-cost-update.cjs tools/test-release-version.cjs`：27/27 通过，包括七辆覆盖、仅两辆默认 BR 变化、50 棵树非 BR 字段不变、重复应用与错误旧模式数据拦截。
- 应用工作流中的 45 条 Node/npm 检查全部通过。初次受限运行不能创建测试用目录链接和 Git 仓库；按正式权限审批后重跑通过，没有删减断言。
- `node tools/check-battle-ratings.cjs`：本地版和静态版各覆盖桌面 1440px、手机 390px，4/4 通过；包含前一轮 BR 更新以及本轮 2.59.0.93 旧缓存迁移、七架飞机分模式值、保存的目标/拥有/研发进度、七种语言和实际图片加载。已查看截图；手机为浏览器模拟，非实机验收。
- `npm run test:browser` 首轮前八个脚本通过，费用旧快照因混入后续 BR 与旧哈希不匹配而超时。费用测试现恢复对应时期的 BR，并在启动浏览器前断言旧快照哈希；没有更改生产校验或删除原有费用、进度断言。
- 修正后单独重跑 `node tools/check-vehicle-cost-update.cjs`，4/4 通过；随后执行 `check-modification-update.cjs`、`check-export-controls.cjs`、`check-export-hd.cjs`、`check-plan-backup.cjs`、`check-plan-concurrency.cjs`，全部通过。浏览器套件的 14 个脚本均已完成成功验证。
- `node tools/sync-web-assets.cjs --check`、`git diff --check` 及待提交 29 个文件的隐私扫描通过。
