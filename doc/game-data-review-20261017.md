# 2026-10-17 游戏数据核对

本次只修正等级解锁数量和后端前置映射。不修改界面、规划算法、载具价格或配件快照，也不将全量数据版本提升到 2.59.0.73。

## 固定来源

- 本次核对：`2.59.0.73`，提交 `6142de74d1e9a7125f0fd7e6517d4af7411db29e`。
- 基础快照：`2.59.0.17`，提交 `510a793c2bdb01c51475118199c7b66b72935ff1`。
- 最近配件修正：`2.59.0.50`，提交 `a5fef60f211c742c48183cf195dab8f603931196`。
- 直接读取固定提交的 [费用与前置](https://github.com/gszabi99/War-Thunder-Datamine/blob/6142de74d1e9a7125f0fd7e6517d4af7411db29e/char.vromfs.bin_u/config/wpcost.blkx)、[科技树](https://github.com/gszabi99/War-Thunder-Datamine/blob/6142de74d1e9a7125f0fd7e6517d4af7411db29e/char.vromfs.bin_u/config/shop.blkx)和[等级门槛](https://github.com/gszabi99/War-Thunder-Datamine/blob/6142de74d1e9a7125f0fd7e6517d4af7411db29e/char.vromfs.bin_u/config/rank.blkx)，未依赖已截断的 GitHub compare 文件列表。
- 提交、源文件 SHA-256 和回归用源字段保存在 `tools/fixtures/planning-rules-2.59.0.73.json`；大体积原始配置与完整临时报告留在被 Git 忽略的 `logs/game-data-review-20261017/`。

## 已修正的等级门槛

下表指当前等级需要购买多少辆载具才能解锁下一等级。旧值是网站原规则，不一定等于 2.59.0.17 的游戏配置。

| 国家 | 科技树 | 当前等级 | 网站旧值 | 核实值 |
| --- | --- | --- | --- | --- |
| 日本 | 空战 | V | 4 | 5 |
| 以色列 | 空战 | IV | 5 | 6 |
| 以色列 | 空战 | V | 3 | 4 |
| 以色列 | 空战 | VII | 4 | 5 |
| 美国 | 远洋 | II | 3 | 5 |
| 德国 | 远洋 | I | 4 | 5 |
| 苏联 | 远洋 | III | 5 | 6 |
| 英国 | 远洋 | II | 5 | 6 |
| 法国 | 远洋 | V | 3 | 4 |
| 德国 | 近岸 | III | 4 | 5 |
| 苏联 | 近岸 | II | 5 | 6 |
| 日本 | 近岸 | II | 5 | 6 |
| 意大利 | 近岸 | I | 3 | 4 |
| 法国 | 近岸 | I | 3 | 4 |

已核对现有 50 棵树对应的 241 个显式等级字段。另有 37 个最高等级没有显式的后续解锁字段，列为缺失字段并保留原行为，没有把缺失字段解释成新获取的零值。未创建当前网站不支持的国家/军种科技树。

## 已核对的载具前置

游戏在这一批更新中将 `futureReqAir` 转为正式 `reqAir`。静态网页已经记录了以下 15 处前置，但后端仍可能被旧字典覆盖。本次修正字典的 15 处旧映射，并补齐原来不存在的 F-101C、英国 M1A2 两条记录，共 17 条；其中包含 M6、IT-1 两个折叠组的入口。

| 目标 ID | 当前前置 ID |
| --- | --- |
| `us_m6a1` | `us_m7` |
| `ussr_it_1` | `ussr_object_416` |
| `uk_m1a2_sep3_abrams` | `uk_arjun_mk1` |
| `cn_hq_11` | `cn_fk_2000` |
| `it_m113a1_tow` | `it_pzh_2000` |
| `il_spyder_aio` | `il_tor_m1` |
| `f_101c` | `f_102a_late` |
| `swift_f1` | `hawk_t1a_early` |
| `harrier_frs1_early` | `ca_27_mk32_raaf` |
| `mig_29n` | `a_4ptm_malaysia` |
| `f-84f_france` | `se_203` |
| `us_destroyer_fletcher` | `us_destroyer_mahan_class` |
| `fr_battleship_bretagne_class_bretagne` | `fr_cruiser_algerie_class` |
| `ussr_skr_groza_1943` | `ussr_fugas_t1_strela` |
| `fr_mtb96_vosper` | `fr_lcm_monitor` |

以上前置均已在对应树内收录。未重新抓取或替换整棵树。一级前置的既有跳过策略未改动：MTB-96 的 LCM(65) 前置记录与游戏一致，但当前规划算法仍跳过对一级前置的追溯；测试明确保留该边界，不能据此声称所有游戏规划规则均已核实。

## 核对但未改动

- 3,235 个载具条目全部匹配到游戏费用配置。其中 2,169 个普通载具有完整可比较 RP/SL，当前值均一致；828 个金币、联队或组成部件条目不按普通费用对比；156 个已有未知费用条目继续保留未知；82 个剩余条目缺少完整源费用字段，未自动补零。
- 检查 3,225 辆载具的 52,424 个已收录配件。游戏中显式的 RP、SL 和层级与当前快照一致；12,473 个配件的游戏配置没有显式 RP，不能据此宣称其费用已全部核实。已识别的配件成员变化均已由既有修正处理。
- 对照 2.59.0.50 与 2.59.0.73 的完整费用配置，变化为上述 15 处前置及对应过渡字段移除，没有新的载具 RP/SL 或配件字段变化。
- Ka-29 保留 5 处既有前置冲突，等待新游戏证据后再决定是否更改：`hp_105_jet`、`automatic_air_extinguisher`、`mi_24_su_9M114`、`ka_29_2a42` 的现有额外前置，以及 `2A42_belt_pack` 的额外 `gunGShG_new_gun` 前置。它们不是本轮新增变化。
- Ka-29、Do 217 J-2、两架 CA-27 的用户确认修正保持不变，测试用内容哈希验证。
- Z20 Karl Galster 的内部 `costGold` 字段较基础快照从 6,090 变为 4,880。未重新验证玩家购买渠道及可用性，本次不更新商品信息或把该值计入银狮。
- 新出现的商店记录 `h_34_killstreak`、`mi_4av_killstreak` 带有隐藏标记，`sw_patria_bmp_3` 带有活动礼包标记。未据此新增公开科技树载具或“新增”标签。

## 验证与复核

- `npm run test:planning-data`：7 项测试，包括固定提交与校验和验证、缺失/冲突字段保护、241 个门槛、全部 50 棵后端与静态科技树、15 个前置、实际规划补足第六架以色列 IV 级飞机、4 辆人工修正载具的内容保护。
- `node tools/audit-planning-rules.cjs logs/game-data-review-20261017`：读取带有 `sources.json` 的固定版本原始配置，验证来源和哈希，生成只读 `logs/planning-rule-audit.json`；不联网、不自动应用。当前已核对范围内差异为零。
- 完成 20 项应用检查和 11 项安全测试，全部通过；包括现有配件、自动规划、Wiki 刷新保护、多语言和备份回归。
- 同步 `dict/unlock_quantity.js` 与 `docs/unlock-quantity.js`。本次不改动 `main.js`、两版 `app.js`、规划器、载具快照、配件快照或完整数据版本记录。
- 本轮是数据与接口回归，不代替新版本游戏实机验收、手机/Safari 视觉验收或 Windows 安装包验收。
