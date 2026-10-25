# v1.0.28 安全修复合集

- 将此前已上传的安全修复纳入 Windows 便携包，不再只停留在源码。
- 启动器只在自身目录寻找应用，优先使用随包 Node.js，不再从当前目录或相对 PATH 误选程序。清除预加载及远程管理配置，固定为本机监听。
- 启动检查只接受计算器的健康响应，不跟随重定向或代理；限制超时和响应大小。浏览器仍打开 `http://localhost:3000`，保留原有计划的存储来源。
- Wiki 请求只允许有限次数的同域 HTTPS 跳转，阻止跨域、降级和带用户信息的地址；整条请求链设有超时与响应大小限制。
- 包含静态 SVG 内容、文件完整性和镜像检查，以及 GitHub Actions 的固定引用与安全审计。历史根目录启动器已移除，正式包从受审计源码重新构建。
- 自带 Node.js 24 LTS 和 .NET 10.0.13，无需另行安装运行环境。不改变界面布局、计算规则或游戏数据。

Windows 用户下载 `WarThunderResearchCalculator-v1.0.28-portable.zip`，解压到新目录后运行 `WarThunderResearchCalculator.exe`。升级前可导出计划备份；关闭旧版正在运行的本地服务后再启动新版，不要将文件混合覆盖到旧目录。另提供源码 ZIP 和 SHA-256 校验文件。

浏览器存储取决于浏览器及地址，请继续使用原来的浏览器和 `http://localhost:3000`。下载包不会自动获得后续网页更新。安全检查不保证不存在未知漏洞，也不替代对安装目录和电脑环境的保护。

## English

- This Windows package includes the security fixes previously available in source only.
- The launcher looks for the app beside itself and prefers the bundled Node.js. It no longer searches the working directory or relative PATH entries. It clears preload and remote administration settings and binds the server to loopback.
- Startup checks require the calculator's health response. They reject redirects and proxies and limit response size and duration. The browser still opens `http://localhost:3000` to preserve the existing storage origin.
- Wiki requests allow only a limited number of same-origin HTTPS redirects. Cross-origin links, protocol downgrades and URL credentials are rejected. The whole chain has a deadline and a response-size limit.
- The release includes SVG content and integrity checks, mirror validation and pinned GitHub Actions audits. Packages are rebuilt from audited source instead of using the retired root executable.
- Node.js 24 LTS and .NET 10.0.13 are included. No separate runtime installation is needed. The UI layout, calculation rules and game data are unchanged.

Download the portable ZIP and extract it into a new folder. Export a plan backup before upgrading. Stop the old local server, then run `WarThunderResearchCalculator.exe` from the new folder. Do not mix old and new files. Source files and SHA-256 checksums are also provided.

Use the same browser and `http://localhost:3000` to retain browser storage. Later web updates are not installed automatically. Security checks do not guarantee the absence of unknown vulnerabilities.
