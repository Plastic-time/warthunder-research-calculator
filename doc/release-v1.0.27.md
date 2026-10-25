# v1.0.27 启动器依赖安全检查

- .NET 启动器接入统一依赖审计，检查直接和间接 NuGet 依赖，覆盖所有漏洞等级。漏洞源不可用、锁文件过期或审计被关闭时阻断检查。
- 固定官方 NuGet 包源和漏洞源，禁止隐藏审计告警；当前没有显式第三方 NuGet 包，不将此等同于启动器无需安全维护。
- 自带 .NET 10.0.13。构建时核对微软当前受支持补丁，并核验实际还原和发布的 Core / Windows Desktop 运行时版本。
- 打包前重新审计，发布阶段不再次还原依赖；原生运行时文件包含在单文件启动器中。
- 包含截至本次发布的网页功能与数据。本次不更改规划算法、界面或游戏数据；下载包不会自动同步后续网页更新。

Windows 用户下载 `WarThunderResearchCalculator-v1.0.27-portable.zip`，解压后运行 `WarThunderResearchCalculator.exe`。无需另外安装 Node.js 或 .NET。另提供源码包及 SHA-256 校验文件。

审计通过表示检查时未发现已知 NuGet 漏洞且使用当前运行时补丁，不代表不存在未知漏洞。旧版安装包及仓库内历史启动器不在本次重新构建的证明范围内。

## English

- The launcher now uses the shared dependency audit. It checks direct and transitive NuGet packages at every severity level. Missing advisory data, stale locks and disabled audits block the checks.
- Package and advisory sources are restricted to nuget.org. Audit warnings cannot be suppressed. The launcher currently has no explicit third-party NuGet packages.
- The portable app bundles .NET 10.0.13. Builds check the current supported patch and verify the restored and published Core and Windows Desktop runtimes.
- Packaging audits the launcher again. Publishing uses the restored dependencies and includes native runtime files in the single executable.
- This package includes the web features and data available at release time. This change does not alter the UI, planning rules or game data. Later web updates are not applied automatically.

Download the portable ZIP, extract it and run `WarThunderResearchCalculator.exe`. No separate Node.js or .NET installation is needed. Source files and SHA-256 checksums are also provided.

These checks do not guarantee the absence of unknown vulnerabilities. Historical binaries and older downloads are not covered by this rebuild.
