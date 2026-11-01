# v1.0.31 安全与稳定性更新

本次将 v1.0.30 之后的五项修复纳入 Windows 便携包：

1. 配件目录重试失败时保留上次成功加载的目录和名称，避免科技树上的配件按钮消失。
2. 纳入正式服 2.59.0.94 的七架飞机分模式 BR 修正。空战与陆战分别处理，保留此前费用、配件和手动修正，不是全量数据升级。
3. 更新检查器区分正式服与测试服，只以已核实的正式服固定提交作为核对来源。
4. 兼容 Part 分篇更新说明，保留渠道声明、来源修订和完整性校验。信息缺失或冲突时停止，不自动导入测试服数据。
5. 修复依赖安全告警：follow-redirects 1.16.2、glob 14.0.2、minimatch 11.0.1。保留现有格式化功能，不放宽审计规则。

自带 Node.js 24 LTS 和 .NET 10.0.14。已有计划、研发进度和计算规则不变。发布流程核对 ZIP 内实际依赖版本、全部科技树和配件分块，并执行 EXE/DLL 隐私扫描。

Windows 用户下载 [v1.0.31 便携包](https://github.com/Plastic-time/warthunder-research-calculator/releases/download/v1.0.31/WarThunderResearchCalculator-v1.0.31-portable.zip)，解压到新目录，运行 `WarThunderResearchCalculator.exe`。另提供源码 ZIP 和 SHA-256 校验文件。

升级前导出计划备份，关闭旧版服务。不要混合覆盖旧目录。继续使用原浏览器和 `http://localhost:3000`，保持相同存储来源。旧版本保留；已下载的旧包不会自动更新。

依据：[BR 修正](https://github.com/Plastic-time/warthunder-research-calculator/blob/v1.0.31/doc/battle-rating-correction-20261030.md)、[更新检查器](https://github.com/Plastic-time/warthunder-research-calculator/blob/v1.0.31/doc/data-update-checks.md)、[依赖安全修复](https://github.com/Plastic-time/warthunder-research-calculator/blob/v1.0.31/doc/dependency-security-20261031.md)。

依赖审计和隐私扫描不能保证不存在未知漏洞或所有形式的隐私信息。

## English

This release includes five fixes made after v1.0.30:

1. Failed modification retries keep the last working catalog and names. Modification buttons no longer disappear after a failed retry.
2. Seven aircraft receive mode-specific BR corrections from live version 2.59.0.94. Air and ground ratings remain separate. Earlier costs and modification corrections are retained. This is not a full data upgrade.
3. The update checker separates live and development channels. Reviews use a verified, pinned live revision.
4. Part-numbered announcements are supported. Source, channel and completeness checks remain in place. Missing or conflicting evidence stops the check.
5. Dependencies include follow-redirects 1.16.2, glob 14.0.2 and minimatch 11.0.1. Formatting behavior and audit rules are preserved.

Node.js 24 LTS and .NET 10.0.14 are bundled. Saved plans, research progress and calculation rules are unchanged.

Download the portable ZIP and extract it into a new folder. Run `WarThunderResearchCalculator.exe`. Source files and SHA-256 checksums are also available.

Export a plan backup before upgrading and stop the old local server. Do not mix old and new files. Keep the same browser and `http://localhost:3000` to preserve the storage origin. Older releases remain available and do not update automatically.

Dependency audits and privacy scans cannot guarantee the absence of unknown vulnerabilities or every kind of private information.
