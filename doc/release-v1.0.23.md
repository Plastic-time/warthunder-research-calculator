# v1.0.23 三辆载具配件数据修正

依据游戏配置 **2.59.0.50**，定向同步以下三辆载具自 2.59.0.38 以来的配件变化。

## 希腊 F-86E(M)

- 新增四级 AIM-9B 配件，费用为 16,000 RP / 25,000 SL。排列字段不作为真实前置，不强制研发炸弹挂架。
- FRC Mk 2、M117、FLBC 挂架分别调整到一、二、三级，并更新费用。
- 维修机身、压缩机和弹链调整为 7,200 RP / 11,000 SL。
- 全配件合计：145,800 RP / 226,000 SL。

## 米格-23M

- S-24 的真实前置改为 B-8M1，自动规划会沿 UB-32 → B-8M1 → S-24 补齐。
- 费用和配件层级不变。

## 416 工程

- 移除火炮支援配件。
- 传动装置、发动机和 3D3 烟雾弹分别调整为 9,900 RP / 16,000 SL。
- 全配件合计：88,600 RP / 147,600 SL。
- 游戏配置第四层字段从 2 改为 1；进入第四层的三级配件数量门槛仍为 3，不误改为 1。

## 范围与下载

仅修正上述三辆载具的相关配件字段；更新涉及的金鹰加速费用、分块哈希与计数同步维护。其他载具数据、既有人工修正和规划算法保持不变，不代表全量数据升级。存档进度不主动清空。

Windows 用户下载 `WarThunderResearchCalculator-v1.0.23-portable.zip`，解压后运行 `WarThunderResearchCalculator.exe`。无需另装 Node.js。

数据来源：[固定游戏配置提交](https://github.com/gszabi99/War-Thunder-Datamine/tree/a5fef60f211c742c48183cf195dab8f603931196)。

## English

- Greek F-86E(M): added the tier-IV AIM-9B modification. Updated rack tiers and costs. The layout field does not create a bomb prerequisite for AIM-9B. All modifications cost 145,800 RP and 226,000 SL.
- MiG-23M: S-24 now requires B-8M1. The planner follows UB-32, B-8M1, then S-24. Costs and tiers are unchanged.
- Object 416: removed Artillery Support. Transmission, Engine, and 3D3 each cost 9,900 RP and 16,000 SL. All modifications cost 88,600 RP and 147,600 SL. Unlocking tier IV still requires three tier-III modifications.
- These are scoped corrections from game configuration 2.59.0.50, not a full data upgrade. Other vehicles and the planning algorithm are unchanged.

Browser checks cover desktop and simulated mobile sizes. Physical phones, Safari, and local Windows package startup have not been verified in this release check.
