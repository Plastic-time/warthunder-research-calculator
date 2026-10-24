# 2026-10-24 游戏数据核对

本轮是现有收录范围的增量核对，只修正 J35A 的购买分类。没有提升全量快照版本，没有修改规划算法、RP/银狮费用、配件前置或等级门槛，不发布安装包。

## 固定来源

- 上次核对：2.59.0.73，`6142de74d1e9a7125f0fd7e6517d4af7411db29e`。
- 本次核对：2.59.0.86，`aa326f10c6ba7d523647572368ead2e4d51ffb4d`。
- 全量基础快照仍为 2.59.0.17，不能把范围检查点理解为全库升级。
- 完整读取固定提交的 [wpcost](https://github.com/gszabi99/War-Thunder-Datamine/blob/aa326f10c6ba7d523647572368ead2e4d51ffb4d/char.vromfs.bin_u/config/wpcost.blkx)、[shop](https://github.com/gszabi99/War-Thunder-Datamine/blob/aa326f10c6ba7d523647572368ead2e4d51ffb4d/char.vromfs.bin_u/config/shop.blkx)、[rank](https://github.com/gszabi99/War-Thunder-Datamine/blob/aa326f10c6ba7d523647572368ead2e4d51ffb4d/char.vromfs.bin_u/config/rank.blkx)，校验 Git blob 与文件 SHA-256，未依赖截断的 compare 列表。
- 六份新旧源文件的地址、长度、校验和及核对字段保存在 `tools/fixtures/game-data-review-2.59.0.86.json`。原文件仅留在忽略目录 `logs/game-data-review-20261024/`。

## 已修正

J35A 的 `showOnlyWhenAvailableForPurchase` 限制已移除。[2026-10-23 官方公告](https://warthunder.com/en/news/10278-shop-the-j35a-returns-with-a-discount-for-the-dragons-first-flight-en)明确确认其恢复金鹰购买，并在活动结束后按常规价格 9,090 GE 保留。网站由“特殊载具”改为“金鹰载具”。

- 4,545 GE 是限时折扣价，不作为常规价格写入。
- `config/acquisition-corrections.json` 保存公告和固定版本来源，收录审计优先采用这一已核实更正，避免旧 Wiki 购买字段覆盖它。
- 两版收录报告同步更正，金鹰分类由 367 增至 368，特殊分类由 312 减至 311；礼包仍为 96，总数不变。提示明确来源为官方公告，不冒称 Wiki 已更新。
- 不改 Wiki 原始字段，不把内部 `reqExp` 当作金币机的研发费用，也不把 GE 计入银狮。

## 核对但不改动

- 两版完整 wpcost 只有 7 处结构差异：J35A 的购买显示标记、F-111A 两个内部配件键的替换、4 个新条目。现有条目没有新增 RP/SL、正式载具前置或可研发配件费用变化。
- F-111A 的 `countermeasures_launcher_chaff` 更名为 `countermeasures_launcher_chaff_large`，均为 tier 0 内部条目，依赖同一个 `countermeasures_belt_pack`。不是新增研究节点。已收录热焰弹/干扰箔仍为 6,500 RP、10,000 SL。[官方 2.59.0.78 更新](https://forum.warthunder.com/t/update-2-59-0-78/359717)也说明其改动为干扰弹口径。
- rank 文件逐字节不变。当前 50 棵树、241 个显式等级字段和载具前置审计没有差异；37 个缺失后续等级字段仍不自动补零。
- shop 中已有条目的等级与所审计显示/获取标记不变，新增 4 个隐藏条目；J35A 的购买可用性变更已单独核对。
- Ka-29、Do 217 J-2、两架 CA-27 的用户确认修正保持不变。上轮记录的缺失 RP、未知费用及 Ka-29 前置冲突没有因本轮检查而获得新的证据，继续保留。

## 未导入的新条目

`bf-109e-3_tl`、`ussr_bt_7_m_816`、`germ_panzerjager_panther_g2`、`germ_s_700_s_706` 均带 `showOnlyWhenBought`。后两者还带 `battlepass_season25`，属于已公布的第 25 赛季奖励，不能称为未发布载具。

本轮不扩展车型收录：新条目的 Wiki 布局、图片及配件覆盖仍需另行核验。它们未加入普通研发树、预算或 NEW 标记。内部价格不能单独证明玩家购买渠道；不将本次核对宣传为已补齐所有新活动载具。

同日后续已完成这四项的[逐辆收录复核](roster-candidate-review-20261024.md)：公告与图片已核实，但四个单车页均为 404；BT-7M 掉宝还未开始，正式收录继续暂缓。

## 复核方式

- `node tools/audit-reviewed-data-delta.cjs logs/game-data-review-20261024`：验证固定源文件长度和哈希，确认现有条目差异清单及新增隐藏条目；只读，不自动应用。
- `node tools/audit-planning-rules.cjs logs/game-data-review-20261024`：核对当前等级门槛和载具前置。
- `node --test tools/test-game-data-review.cjs tools/test-planning-rules.cjs tools/test-datamine-updates.cjs`：分类来源、正常价格、非目标记录保护、部分更新边界、数据检查失败保护及既有人工更正回归。
- 发布前执行完整应用测试、两版浏览器回归、七语言检查、缓存版本及隐私检查。浏览器模拟不能代替游戏实机、Safari 或 Windows 安装包验收。
