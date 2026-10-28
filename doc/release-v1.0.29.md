# v1.0.29 运行库与隐私检查更新

- Windows 便携包升级至 .NET 10.0.14，继续包含此前的启动器、Wiki 请求及构建安全修复。自带 Node.js 24 LTS，无需额外安装运行环境。
- 发布前扫描 EXE/DLL 中的本机编译路径和常见凭据，覆盖大文件、UTF-16 和跨块字符串。运行库公开路径采用逐条核验的哈希，不豁免整个目录或文件。
- 源码包包含隐私扫描及其回归脚本，构建流程校验这些文件没有遗漏或过期。
- 纳入此前网页端的配件载入、超时和重试修复。最后一次选择生效，迟到的请求不会重新打开已关闭的窗口。
- 保留已有计划、研发记录和计算规则。游戏数据本轮没有变化；已完成到 2.59.0.92 的增量核对，但不代表全量数据升级或补齐未收录条目。

Windows 用户下载 `WarThunderResearchCalculator-v1.0.29-portable.zip`，解压到新目录，运行 `WarThunderResearchCalculator.exe`。另提供源码 ZIP 和 SHA-256 校验文件。

升级前建议导出计划备份。关闭旧版正在运行的本地服务后再启动新版，不要混合覆盖旧目录。继续使用原来的浏览器和 `http://localhost:3000`，避免切换浏览器存储来源。旧版发布与安装包保留不动，下载包不会自动获得后续网页更新。

隐私扫描和依赖审计不能保证不存在未知漏洞或所有形式的隐私信息。

## English

- The Windows portable package now bundles .NET 10.0.14. It retains the earlier launcher, Wiki request and build security fixes. Node.js 24 LTS is included. No separate runtime installation is needed.
- Release checks scan EXE and DLL files for local build paths and common credentials. They cover large files, UTF-16 and strings across read boundaries. Public runtime paths use individually reviewed hashes. Entire directories or binaries are not exempted.
- The source ZIP includes the privacy checker and its regression tests. The build verifies their presence and contents.
- This package also includes the web modification loading, timeout and retry fixes. The latest selection wins. Late requests cannot reopen a closed window.
- Saved plans, research records and calculation rules are preserved. Game data is unchanged in this release. The incremental review covers 2.59.0.92; it is not a full data upgrade or a complete vehicle import.

Download the portable ZIP and extract it into a new folder. Run `WarThunderResearchCalculator.exe`. Source files and SHA-256 checksums are also available.

Export a plan backup before upgrading. Stop the old local server first. Do not mix old and new files. Use the same browser and `http://localhost:3000` to retain the storage origin. Older releases remain available. Later web updates are not installed automatically.

Privacy scans and dependency audits cannot guarantee the absence of unknown vulnerabilities or every kind of private information.
