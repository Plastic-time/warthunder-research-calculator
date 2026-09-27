# 阵风配件前置核对

## 依据与范围

- 用户提供的游戏内阵风 C、阵风 EG 配件截图：MICA-EM 与 30 mm 机炮翻新之间没有前置箭头。
- 固定快照：游戏 2.59.0.17，提交 `510a793c2bdb01c51475118199c7b66b72935ff1`。
- 配置：[wpcost.blkx](https://github.com/gszabi99/War-Thunder-Datamine/blob/510a793c2bdb01c51475118199c7b66b72935ff1/char.vromfs.bin_u/config/wpcost.blkx)。
- 游戏 UI：[modstree.nut](https://github.com/gszabi99/War-Thunder-Datamine/blob/510a793c2bdb01c51475118199c7b66b72935ff1/gui.vromfs.bin_u/scripts/weaponry/modstree.nut) 使用 `prevModification` 安排位置，只根据 `reqModification` 绘制前置箭头。
- 解锁检查：[modificationinfo.nut](https://github.com/gszabi99/War-Thunder-Datamine/blob/510a793c2bdb01c51475118199c7b66b72935ff1/gui.vromfs.bin_u/scripts/weaponry/modificationinfo.nut) 的 `isReqModificationsUnlocked` 检查 `reqModification`，不检查 `prevModification`。

## 修正

仅更新 `rafale_c_f3`、`rafale_m_f3r`、`rafale_eg_greece` 三架载具的配件前置：

- 移除机炮翻新到 MICA-EM 等由排列字段误生成的关系。
- 保留 DAMOCLES / TALIOS → LGBU → AASM 250 (SBU 54) 两条真实前置。
- 不改 RP、银狮、等级、等级门槛、配件成员或布局。
- 第三级 MICA-EM 仍需满足配件等级门槛；机炮可能被独立选作等级补足，但不是 MICA-EM 的必经配件。

提取字段保存在 `tools/fixtures/rafale-modification-requirements.json`，修正可通过 `node tools/update-rafale-modifications.cjs` 重现。导入器仅接受游戏配置中的真实前置，缺失配置、未知字段类型或缺失前置成员会中止导入以待核查，不再用 Wiki 前置补入。

这不是全量配件数据更新。其他载具的现有前置数据未重新生成；Ka-29、Do 217 J-2 和 CA-27 的既有修正保持不变。
