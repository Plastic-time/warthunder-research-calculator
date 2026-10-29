# v1.0.30 BR、费用与配件数据更新

本次 Windows 便携包纳入已核对的三次网页数据更新，依据游戏配置 2.59.0.93：

- 同步 638 辆载具的分模式 BR，其中 442 辆默认 RB 显示更新。空战、陆战和海战数值分别保存。
- 更新 P1Y1、B7A2 和 Ki-93-I 甲的载具研发及银狮购买费用。
- 更新上述三架飞机、两架 F-102 和挑战者 Mk.2 的配件费用及配件树。F-102 新增机枪升级和 AIM-26B；导弹真实前置为 AIM-4G → AIM-4F → AIM-26B。移除挑战者旧 L23A1 研发节点。
- 保留已有计划和已投入研发，按新费用重算剩余预算。不按上下排列推断配件前置，不改计算规则。此前已确认的手动修正继续保留。
- 自带 Node.js 24 LTS 和 .NET 10.0.14，沿用已有安全修复、依赖审计及 EXE/DLL 隐私检查。打包时逐一校验全部 50 棵科技树和 44 个配件分块，防止旧数据混入。

这是增量数据更新，不是全量 2.59.0.93 快照。详细依据见 [BR](https://github.com/Plastic-time/warthunder-research-calculator/blob/v1.0.30/doc/battle-rating-update-20261029.md)、[载具费用](https://github.com/Plastic-time/warthunder-research-calculator/blob/v1.0.30/doc/vehicle-cost-update-20261029.md)和[配件](https://github.com/Plastic-time/warthunder-research-calculator/blob/v1.0.30/doc/modification-update-20261029.md)。

Windows 用户下载 [便携包](https://github.com/Plastic-time/warthunder-research-calculator/releases/download/v1.0.30/WarThunderResearchCalculator-v1.0.30-portable.zip)，解压到新目录，运行 `WarThunderResearchCalculator.exe`。另提供源码 ZIP 和 SHA-256 校验文件。

升级前建议导出计划备份。关闭旧版正在运行的服务后再启动新版，不要混合覆盖旧目录。继续使用原浏览器和 `http://localhost:3000`，以保持相同的存储来源。旧版本及其安装包保留不动，下载包不会自动获得后续网页更新。

隐私扫描和依赖审计不能保证不存在未知漏洞或所有形式的隐私信息。

## English

This Windows portable release includes three reviewed web data updates from game configuration 2.59.0.93:

- Mode-specific BR data is updated for 638 vehicles. Default RB values change for 442 vehicles. Air, ground and naval ratings remain separate.
- Vehicle research and Silver Lion costs are updated for P1Y1, B7A2 and Ki-93-I Ko.
- Modification costs and trees are updated for those aircraft, both F-102s and Challenger Mk.2. The F-102 gains a gun upgrade and AIM-26B. Its real missile chain is AIM-4G → AIM-4F → AIM-26B. The obsolete Challenger L23A1 research node is removed.
- Saved plans and invested RP are retained. Remaining budgets use the new costs. Vertical placement does not create prerequisites. Calculation rules and earlier manual corrections are preserved.
- Node.js 24 LTS and .NET 10.0.14 are bundled. Existing security fixes, dependency audits and EXE/DLL privacy checks remain enabled. Packaging checks all 50 tech trees and 44 modification chunks against the source files.

This is an incremental update, not a full 2.59.0.93 snapshot.

Download the portable ZIP, extract it into a new folder and run `WarThunderResearchCalculator.exe`. Source files and SHA-256 checksums are also available.

Export a plan backup before upgrading. Stop the old local server first. Do not mix old and new files. Use the same browser and `http://localhost:3000` to retain the storage origin. Older releases and downloads remain available. Later web updates are not installed automatically.

Privacy scans and dependency audits cannot guarantee the absence of unknown vulnerabilities or every kind of private information.
