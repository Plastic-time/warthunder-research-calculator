# v1.0.16 阵风配件前置修正

- 修正阵风 C、阵风 M、阵风 EG 的配件前置，移除机炮翻新 → MICA-EM 等由排列字段误生成的箭头及规划依赖。
- 保留 DAMOCLES / TALIOS → LGBU → AASM 250 (SBU 54) 的真实前置。
- MICA-EM 仍需满足第三级配件数量门槛，但不再强制要求机炮翻新。满足门槛后单选 MICA-EM 的费用为 15,000 RP / 23,000 SL。
- 导入器区分游戏配置中的排列字段和真实前置，不再用 Wiki 前置覆盖游戏数据；新增数据及浏览器回归测试。

本次仅修正三架阵风的配件关系，不调整费用、等级门槛和布局，不是全量游戏数据更新。其他载具及既有 Ka-29、Do 217 J-2、CA-27 修正保留。依据与范围见 [前置核对记录](https://github.com/Plastic-time/warthunder-research-calculator/blob/main/doc/rafale-prerequisites.md)。

## 下载与使用

Windows 用户下载 `WarThunderResearchCalculator-v1.0.16-portable.zip`，解压后运行 `WarThunderResearchCalculator.exe`。启动前请退出旧版，无需另外安装 Node.js。不带 `portable` 的 ZIP 为源码包。

发布账号仍为 Plastic-time。
