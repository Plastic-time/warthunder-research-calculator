# 2026-10-28 游戏数据增量核对

## 结论与来源

核对到 2.59.0.92，没有发现需要修改的现有收录载具 RP、银狮、前置、配件或等级门槛。本次仅推进四个范围检查点，加入来源证据和回归测试；不改计算算法、科技树、配件快照或安装包。

- 基线：2.59.0.86，`aa326f10c6ba7d523647572368ead2e4d51ffb4d`。
- 本次：2.59.0.92，`af0cce561a73704e30c1df66eff06209bcc3f035`。
- 完整读取两个固定提交的 `wpcost.blkx`、`shop.blkx`、`rank.blkx`，校验 SHA-256 和上游 Git blob，不依赖截断的 compare 列表。
- 六份文件的地址、长度、哈希及差异摘要见 `tools/fixtures/game-data-review-2.59.0.92.json`。完整源文件只保存在忽略目录 `logs/game-data-review-20261028/`。

## 已核对的差异

`wpcost` 有 163 处结构差异，涉及 20 个条目，均不在当前载具和配件目录中：

- `sw_patria_bmp_3` 仅移除购买附赠道具字段 `purchaseTrophyGift`，不是 RP/银狮变动，也不能据此推断购买分类变化。
- `sv_98`、`m249_para`、`m24` 的 146 处变化属于步兵配置。内部 `m24` 不能当成 M24 霞飞。
- 新增 14 个 `exp_human` 条目。本网站目前没有步兵研发树，不导入。
- 新增 `fw_190a_8_mistel`、`ju_88g_1_mistel`，均有 `showOnlyWhenBought` 和 `killStreak` 标记；shop 中也新增这两个条目。既有 shop 单位的等级和所审计标记未变。

Mistel 2 已有[官方开发日志](https://warthunder.com/en/news/10290-development-dreams-come-true-mistel-2-en)和[活动公告](https://warthunder.com/en/news/10282-event-dreams-come-true-mistel-2-en)，不是未公布载具。它由 Fw 190 与 Ju 88 组成，两个内部键不能直接当成两辆独立购买/研发载具。组合展示、持有关系及配件语义留待单独收录核验，不把内部 26,000 RP 或 1,450 GE 当成普通研发费用或已确认的玩家购买价格。

`rank` 只改变美国和苏联的 `needBuyToOpenNextInEraHuman5`，分别由 6 改为 5、6 改为 4，不是飞机或坦克门槛。50 棵已支持树的 241 个显式等级字段与本地一致；37 个缺失后续等级字段不补零，已有载具没有新增前置差异。

## 保留范围

- Ka-29、Do 217 J-2、CA-27 等既有用户确认修正不动，先前缺失费用和前置冲突仍保留。
- 两版载具、配件和收录快照不变，以快照哈希回归保护。
- 全量基础快照仍为 2.59.0.17。网页保留最近一次实际数据补录 2.59.0.86 的显示与说明；2.59.0.92 只登记为增量检查点，不将无数据改动的核对冒充全量更新。
- 不打包，不修改历史提交、标签、旧版发布说明或安装包。

## 验证

本地环境：Windows、Node.js 24.21.0，基线提交 `f97aa48`。

- `node tools/audit-game-data-20261028.cjs logs/game-data-review-20261028`：完整固定源文件、差异摘要与已收录范围交叉核验。
- `node tools/audit-planning-rules.cjs logs/game-data-review-20261028`：50 棵树、241 个显式等级字段，差异为零。
- `node --test tools/test-game-data-review.cjs`：基线 `f97aa48` 的旧检查点在新增断言下为 1 失败 / 6 通过；推进检查点后为 7/7 通过。
- 回归覆盖非目标数据不变、未核对的费用/前置/shop/等级差异拦截，以及原本排除的条目一旦被收录就必须重新审查。
- `node --test tools/test-game-data-review.cjs tools/test-planning-rules.cjs tools/test-datamine-updates.cjs tools/test-event-modifications.cjs tools/test-modification-refresh-guard.cjs`：37/37 通过。首次在沙箱中因本机 HTTP 连接被拒绝而失败，正式审批后同命令通过，没有修改断言。
- 按 `.github/workflows/security.yml` 执行其 40 条 Node/npm 应用检查命令，全部通过；其中包含依赖清单、缓存、计算、配件、多语言及发布隐私检查。此项不包含远端浏览器任务或联网漏洞审计，不冒称完整 CI 结果。

本轮是版本间增量核对，不宣称历史数据缺口已补齐，也不代表游戏实机或新安装包验收。
