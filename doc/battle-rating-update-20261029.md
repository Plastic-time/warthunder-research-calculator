# 2026-10-29 分模式 BR 更新

## 范围

本次只同步 2.59.0.92 到 2.59.0.93 的已收录载具 BR 变动：638 辆载具，34 棵树，其中 442 辆的默认 RB 显示改变。折叠组的 BR 范围随成员更新。费用、配件、前置、等级门槛、载具数量和已有计划不变。

软件版本保持 v1.0.29，本次不打包、不发布新安装包。网页显示 2.59.0.93 代表本轮 BR 更新，不是全量数据升级；原有费用和配件检查点仍保留，待后续单独核对。

## 固定来源

- 前版本：2.59.0.92，`af0cce561a73704e30c1df66eff06209bcc3f035`。
- 本版本：2.59.0.93，`501af3e34af2cb82d65140297e1b994b444c4b88`。
- 费用配置中的 BR 字段：[wpcost.blkx](https://github.com/gszabi99/War-Thunder-Datamine/blob/501af3e34af2cb82d65140297e1b994b444c4b88/char.vromfs.bin_u/config/wpcost.blkx)。读取完整文件，不依赖 GitHub 省略的大补丁。
- 模式映射及换算：[ranks_common_shared.nut](https://github.com/gszabi99/War-Thunder-Datamine/blob/501af3e34af2cb82d65140297e1b994b444c4b88/gui.vromfs.bin_u/globals/ranks_common_shared.nut)。
- 官方生效公告：[Update 2.59.0.92](https://warthunder.com/en/game/changelog/current/1913)。公告版本与随后数据仓库的小版本分开记录。

`config/battle-rating-update.json` 保存两版完整来源的长度、SHA-256、Git blob、受影响载具原始 BR 字段及旧快照哈希。更新工具验证来源和覆盖范围后才允许写入；默认只预览，必须显式 `--apply`。

## 模式与兼容

- `economicRankHistorical` 是默认 RB 字段，不等于飞机在陆战中的 RB。
- `economicRankTankHistorical` 和 `economicRankShipHistorical` 分别用于陆战、海战。模式专用字段不存在时，按游戏源码回退到同难度的基本字段；存在但无效时拒绝处理，不补零、不使用其他模式的值。
- 主卡片保留默认模式：飞机为空战 RB，坦克和直升机为陆战 RB，舰船为海战 RB。本次不增加模式切换界面。
- `game_battle_ratings` 分开保存对应模式的 AB/RB/SB 值。这是配置中的 BR 映射，不代表所有组合都是实际可参加的模式。
- A-10A 空战 RB 保持 10.3，陆战 RB 更新为 11.0。F-15C 金鹰、苏-30SM2、歼-16 的空战 RB 更新为 15.0。
- 原 Wiki 抓取内容及来源时间保留，不把游戏数据伪装成新抓取的 Wiki 证据。旧数据的历史回归通过撤销**仅 BR 字段**后重算原哈希继续验证。
- 网站 JSON 清单更新哈希，继续使用现有缓存校验。无需清空浏览器存储；不迁移或重置用户目标、拥有标记和研发进度。
- 不提前实现下一大版本的“自选 BR”，不添加预购或未收录载具。

## 验证

环境：Windows，Node.js 24.21.0；修复前提交 `d1c062bb`。

- 新增数据断言在修复前：`node --test tools/test-battle-ratings.cjs`，0 通过 / 2 失败。
- 修复后专项：`node --test tools/test-battle-ratings.cjs tools/test-game-data-review.cjs tools/test-game-roster-additions.cjs`，16/16 通过。
- 应用工作流中的 41 条 Node/npm 检查全部通过，包含依赖清单、刷新保护、计算、配件、翻译及发布隐私检查。
- `node tools/check-battle-ratings.cjs` 四种组合全部通过，覆盖本地服务和静态版、桌面和手机尺寸、缓存更新后 BR、保留目标/拥有标记/进度、七种语言及实际图片加载。已查看桌面和手机截图。手机尺寸属于浏览器模拟，不是手机实机验收。
- `npm run test:browser` 全部通过，包含 12 个浏览器检查脚本：导航、缓存、加载重试、配件、翻译、计算、活动载具、BR、导出控制、高清截图、备份及多标签页保护。

新增浏览器检查纳入现有 CI。无需新依赖，不变更运行时网络权限；更新工具仅从已校验的本地来源生成数据。
