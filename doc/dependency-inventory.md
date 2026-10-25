# 统一依赖清单与遗漏拦截

清单位于 `config/dependency-inventory.json`。它记录依赖入口及实际审计覆盖，不是“整个项目没有安全问题”的证明。

## 当前范围

| 分组 | 覆盖 |
| --- | --- |
| 主计算器、在线人数服务 | 两套 npm 项目自动审计，包含生产、开发、可选和 peer 依赖 |
| Windows 启动器 | 锁定还原、直接及间接 NuGet 漏洞审计、当前受支持运行时补丁与发布版本核验 |
| GitHub Actions | 全 SHA 固定、直接/间接引用核验、已知漏洞查询、工作流权限检查和 Dependabot 更新 PR |
| html-to-image | 两份 1.11.13 脚本及许可证的本地校验、npm 发布包完整性核对、已知漏洞查询 |
| 静态 SVG 与许可证 | 精确 SHA-256、两版资源一致性、XML/CSS 内容安全检查 |
| 仓库内旧启动器二进制 | 已移除过时根目录副本；禁止重新提交二进制，安装包继续从源码构建 |

尚未接入扫描器的类型必须标记 `tracked-only` 并说明缺口，检查输出会始终列出它们。npm、NuGet、GitHub Actions 与 `vendored` 浏览器包不能使用该标记跳过审计。npm 审计本身不覆盖 Node.js 或 .NET 运行时。

## 检查命令

在仓库根目录运行；入口清单检查只使用 Node.js 内置模块，Actions YAML 策略检查另使用锁定的开发依赖 `yaml`：

```sh
npm run check:dependencies
npm run test:dependency-inventory
npm run audit:dependencies
npm run audit:vendored
npm run audit:dotnet
npm run check:actions
npm run test:actions
npm run audit:actions
npm run audit:assets
npm run test:assets
```

- `check:dependencies` 不访问网络。通过 Git 文件清单发现已跟踪文件和未被忽略的新文件，包括新增子目录；不遍历安装生成的 `node_modules`。已经跟踪但后来被忽略的文件仍会检查。
- 未登记的包清单、锁文件、.NET 项目、工作流、新二进制、许可证入口、`vendor` / `third-party` 目录及 `.min.js` 文件会失败。缺失文件、重复归属、路径越界、符号链接、npm 清单与锁文件不同步也会失败。
- Python、Rust、Go、其他包管理器等已知但未接入审计的入口会直接失败，不会当作未知普通文件跳过。npm workspaces 暂不支持，不能冒充独立项目登记。
- `audit:dependencies` 先检查清单，再按清单自动审计全部 npm 项目、内置浏览器库、.NET 项目和 Actions。目录不写死在工作流里。npm 审计显式包含各类依赖，使用锁文件且不运行安装脚本、不执行自动修复；漏洞、网络错误、超时和异常退出均使检查失败。.NET 联网审计需要稳定版 .NET 10 SDK，Actions 联网审计需要已认证的 GitHub CLI，CI 只向审计步骤提供只读 `GH_TOKEN`。
- `audit:vendored` 仅运行内置浏览器库的联网审计，但仍会先检查整个依赖清单。
- 主 Application Checks 在每次 main 推送、PR 和手动执行时运行上述检查。安装依赖之前先检查遗漏。Release 工作流也调用同一审计入口；不会因修改此清单而自动触发打包。

## 新增依赖入口

新增独立 npm 子项目时，先生成同步的 `package.json` 和 `package-lock.json`（或 `npm-shrinkwrap.json`），再登记一个唯一的 `npm` 条目，覆盖为 `npm-audit`。两个文件必须在同一目录。清单通过后，该目录自动进入审计，无需再修改 Actions 目录列表。

新增非 npm 工具链需审查其真实扫描方式；现有 `tracked-only` 条目是明确列出的未完成项，不能当作已有自动防护。手工复制的第三方代码必须主动登记：文件名检测不能可靠区分所有第一方和第三方 JavaScript，也不能发现任意新生态的所有清单格式。新增或修改 Action 引用必须通过下述 Actions 审计。

本地被 `.gitignore` 忽略、未提交的工具不在仓库审计范围。此检查不管理其他项目或机器上安装的 SDK，不关闭 Dependabot 或隐私检查。

## 截图库审计

`html-to-image` 使用 `npm-vendored-audit` 覆盖，不需要添加到应用的运行时依赖中，也不会自动替换网页文件。

1. 离线检查两版脚本和许可证的 SHA-256。只统一 UTF-8 文本的 CRLF/LF 换行，不忽略其他修改；缺失、重复或未覆盖的副本会失败。
2. 联网读取精确版本的 npm 元数据，核对包名、版本、下载地址及清单固定的 SHA-512。再下载发布包并验证其 SHA-512，不能仅信任元数据中的校验值。
3. 使用系统 `tar` 将指定成员读到内存，核对真实 `package.json`、浏览器脚本及许可证。包文件不会解压到项目，也不会执行安装脚本或导入下载的 JavaScript。归档读取设有输出大小和时间上限。
4. 向 [npm Bulk Advisory 接口](https://docs.npmjs.com/cli/v11/commands/npm-audit/#bulk-advisory-endpoint) 发送公开包名和固定版本，查询已知漏洞。任意严重级别的公告都会失败。请求限定 npm 官方 registry，禁止重定向并设置超时、响应大小及结构检查；失败不能降级为“0 漏洞”。

当前扫描器只接收无运行时依赖的固定 npm 浏览器包。元数据或归档中新增生产、可选、peer 或 bundled 依赖时会失败，需先扩展审计覆盖，不能只改版本放行。开发依赖不属于网页运行时审计范围。

## 启动器审计

`nuget-audit` 登记项目、`packages.lock.json` 和独立 `NuGet.Config`。离线检查拒绝降级覆盖和修改已复核的官方源配置（只归一化 CRLF/LF）；任何策略变更都需同时审查配置与指纹。联网步骤使用 .NET 自身的 MSBuild 求值和 NuGet 解析，不用字符串解析项目依赖。

- 强制 `NuGetAudit=true`、`NuGetAuditMode=all`、`NuGetAuditLevel=low`，拒绝 NuGetAuditSuppress、隐藏审计告警及未经扩展支持的项目引用。使用官方包源和显式漏洞源。按锁文件强制重新还原并禁用 HTTP 缓存，告警按错误处理；NU1900 至 NU1905 也会被外层检查拦截。
- 解析 `dotnet list package --vulnerable --include-transitive --format json`，不能仅凭命令退出码判断无漏洞；缺失报告、错误源或漏洞项均阻断。当前无显式 PackageReference，未来加入依赖也须更新锁文件并接受同一审计。
- 内置运行时不冒充普通 NuGet 包审计结果。读取微软 [.NET 10 官方发布元数据](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json)，要求固定的 RuntimeFrameworkVersion 等于当前受支持稳定补丁，并核验实际还原的 Core / Windows Desktop runtime packs。过期、预览、未知结构或网络失败均阻断。补丁变化时人工复核后更新项目并重新打包，不自动改源码。
- `build:launcher` 和 `package:release` 共用构建入口；发布前重新审计，`publish --no-restore` 避免重新解析依赖，发布后核对包含的运行时配置。原生库随单文件启动器打包。此检查不宣称验证旧二进制、系统已安装的 SDK 或所有未知漏洞。

NuGet 行为依据：[微软 NuGet 审计文档](https://learn.microsoft.com/en-us/nuget/concepts/auditing-packages)。当前运行时补丁检查不是逐条 CVE 范围扫描，也不是微软发布者签名认证。

## GitHub Actions 审计

六个工作流的远程 `uses` 均固定为完整 40 位提交 SHA，旁边保留精确版本注释。清单登记七个官方仓库、八个版本引用，包括 `upload-pages-artifact` 内部固定的 `upload-artifact` 版本。升级 Action 不等于升级网页运行时；本轮不修改网页或游戏数据，也不触发打包。

- 离线策略使用 YAML 1.2 解析器，拒绝重复键、别名、未知标签、可移动标签、动态引用及未登记的 Action。仅允许已登记的同提交本地 reusable workflow，检查循环调用；新增本地 Action、Docker 或第三方仓库需要先扩展审计支持，不能跳过。
- 联网通过官方 GitHub API 核对每个版本标签对应的 SHA，读取固定提交的 `action.yml`，递归核验 composite Action 的间接引用。当前只接受 Node 24 和 composite 入口；间接引用不能使用可移动标签，清单多余或缺失的版本均失败。
- 使用 [Global Security Advisories API](https://docs.github.com/en/rest/security-advisories/global-advisories)，按 `ecosystem=actions` 和包名/精确版本查询 reviewed 与 malware 公告，读取全部分页。任何未撤回的匹配公告均阻断，不设置严重级别过滤；认证、限流、网络、结构和分页错误不能当作无漏洞。令牌由 GitHub CLI 管理，不写入项目或错误输出。
- 默认令牌仅 `contents: read`。只有 Pages 的 main 分支部署作业获得 `pages: write` 和 `id-token: write`，并使用 `github-pages` 环境；手动执行也限制在 main。共享浏览器作业先完成 Actions 审计，Pages 等待它通过，不能跳过或替换依赖作业。checkout 均为 `persist-credentials: false`；拒绝 `pull_request_target`、`workflow_run`、秘密继承、忽略失败和将表达式直接插入 shell 脚本。
- Dependabot 每周提出 Action 更新 PR，不自动合并。更新后需同步审查清单中的版本与 SHA，重新核验间接引用及公告；只改 workflow、不更新清单会失败。通过精确版本主动查询公告，不能把 SHA 固定本身当作 Dependabot 漏洞告警的保证。

安装前的清单检查只验证入口登记和 pin 格式；YAML 策略及联网审计在安装开发依赖后执行。这是仓库 CI 门禁，不是 runner 原生执行前的工作流锁文件，也不替代分支保护或人工审查。它不扫描 Action 打包后的全部内部 npm 依赖、运行脚本的所有逻辑、托管 runner 镜像及未知漏洞。

## 静态图标与旧启动器

- 清单登记仓库内全部 75 份 SVG（网页两套各 37 份，加文档头像）及其许可证、来源说明。安装前校验精确字节 SHA-256 和 public/docs 镜像一致性；新增 SVG 未登记、文件被替换或遗漏副本均失败。指纹只表示本次审查的文件，不能冒充上游签名认证。
- `audit:assets` 使用锁定的开发依赖 `saxes` 和 `css-tree` 解析 XML 命名空间与 CSS 语法。只允许现有图标所需的静态元素、属性、绘图属性和本文件片段引用；拒绝脚本、事件属性、foreignObject、动画、外部资源、DTD、处理指令及不支持的 CSS。设置文件大小、元素数量和嵌套深度上限。文档头像只允许内嵌 JPEG，检查规范 Base64 与 JPEG 起止标识，不能混入 SVG/HTML 数据链接。
- 本次没有改写任何图标。金鹰、国旗和图标的来源与版权说明继续保留；检查不是完整的图像解码器审计、上游供应链证明或浏览器漏洞扫描，也不是给任意上传 SVG 使用的通用清洗器。未来新图形语法需先审查并扩展测试，不得仅更新哈希绕过失败。
- 全量 `audit:dependencies`、Application Checks、Release 及 Pages 依赖的浏览器检查均运行内容审计。新审计工具自身在 npm 漏洞审计范围内，只作为开发依赖，不打入正式运行依赖。
- 移除根目录历史 `WarThunderResearchCalculator.exe`：162461 字节，SHA-256 `8a1005d9b210e25a476a3e2c8bdb40310acca12a9afa328b9e98330edfa5da71`，由提交 `4dc4123` 引入。只做静态检查，未执行。外层为无 CLI 目录的 x64 PE；嵌入运行时配置声明 `net6.0` 及 Microsoft.NETCore.App / Microsoft.WindowsDesktop.App 6.0.0。这是框架依赖配置，不代表内置或机器实际加载的运行时版本。
- [.NET 6 已于 2024-11-12 停止支持](https://devblogs.microsoft.com/dotnet/dotnet-6-end-of-support/)。旧文件未签名不等于恶意软件；移除原因是已被替代、依赖过时框架且绕过当前源码构建审计。当前根目录不再分发它，历史 Git 提交及旧 Release 不做重写或删除。最新 v1.0.27 安装包、素材和启动器源码保持不变。
- 仓库入口检查现在拒绝任何已跟踪或未忽略的 EXE/DLL/WASM/JAR，即使登记为 `tracked-only` 也不能放行。生成目录仍按现有 `.gitignore` 排除；正式包只取 `tools/build-launcher.cjs` 当次从源码构建、运行时审计通过的输出。未来确需提交其他二进制，必须先新增可信来源和审计流程。

固定引用和最小权限依据：[GitHub 安全使用参考](https://docs.github.com/en/actions/reference/security/secure-use)。

升级截图库时须同时复核版本、发布包 SHA-512、脚本和许可证 SHA-256，再按网页缓存规则同步资源修订并跑导出回归。不得直接修改校验值来放行来源不明的文件。当前校验不等于发布者签名认证、源代码安全证明或没有未知漏洞；成功结果仅代表检查当时的来源匹配和已知公告状态。
