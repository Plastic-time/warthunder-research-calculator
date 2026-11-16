# v1.0.32 桌面数据与安全更新

- 将 F-15EX、F-15IA、Su-15TM 等九架飞机及配件数据纳入桌面包。
- 纳入 F-5E Switzerland、JAS39A 的配件修正。
- 自带 Node.js 24.22.3 和 .NET 10.0.15 安全更新。打包时核对 Node 的版本与官方 SHA-256。
- 更新检查器结合官方公告识别正式服，避免过时的频道记录造成误判。构建固定选择稳定的 .NET 10 SDK。

保留已有计划、研发进度和计算规则。本次汇总此前已核对的数据修正，不是全量升级到某个游戏版本，也不导入测试服数据。

下载 [Windows 便携包](https://github.com/Plastic-time/warthunder-research-calculator/releases/download/v1.0.32/WarThunderResearchCalculator-v1.0.32-portable.zip)，解压到新目录，运行 `WarThunderResearchCalculator.exe`。另提供源码 ZIP 和 SHA-256 校验文件。

升级前导出计划备份并关闭旧版服务。继续使用原浏览器和 `http://localhost:3000`。不要混合覆盖旧目录；旧版本下载继续保留。

## English

- Includes nine aircraft such as the F-15EX, F-15IA and Su-15TM, with their modifications.
- Includes modification corrections for the F-5E Switzerland and JAS39A.
- Bundles Node.js 24.22.3 and .NET 10.0.15 security updates. Packaging checks the Node version and official SHA-256.
- Cross-checks official announcements when identifying live releases. Builds select a stable .NET 10 SDK.

Saved plans, research progress and calculation rules are retained. These are previously reviewed partial data updates, not a full game snapshot or a development-server import.

Export a plan backup and stop the old server before upgrading. Extract the portable ZIP into a new directory and run `WarThunderResearchCalculator.exe`. Keep the same browser and `http://localhost:3000`. Source and SHA-256 files are also available. Older releases remain available.
