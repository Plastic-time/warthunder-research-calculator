# 统一依赖清单与遗漏拦截

清单位于 `config/dependency-inventory.json`。它记录依赖入口及实际审计覆盖，不是“整个项目没有安全问题”的证明。

## 当前范围

| 分组 | 覆盖 |
| --- | --- |
| 主计算器、在线人数服务 | 两套 npm 项目自动审计，包含生产、开发、可选和 peer 依赖 |
| Windows 启动器 | 登记 .NET 项目；专用 NuGet / 内置运行时检查待补 |
| GitHub Actions | 登记工作流入口；具体 Action 版本维护及 SHA 固定待补 |
| html-to-image | 登记两份 1.11.13 脚本及许可证；持续漏洞 / 上游文件核对待补 |
| 第三方图标 | 登记许可证入口；不是 SVG 安全扫描 |
| 仓库内旧启动器二进制 | 显式登记；不等于验证其来源、内置运行时或最新安装包 |

非 npm 项目必须标记 `tracked-only` 并说明缺口，检查输出会始终列出它们。npm 项目不能使用该标记跳过审计。npm 审计也不覆盖 Node.js 或 .NET 运行时本身。

## 检查命令

在仓库根目录运行，检查脚本只使用 Node.js 内置模块：

```sh
npm run check:dependencies
npm run test:dependency-inventory
npm run audit:dependencies
```

- `check:dependencies` 不访问网络。通过 Git 文件清单发现已跟踪文件和未被忽略的新文件，包括新增子目录；不遍历安装生成的 `node_modules`。已经跟踪但后来被忽略的文件仍会检查。
- 未登记的包清单、锁文件、.NET 项目、工作流、新二进制、许可证入口、`vendor` / `third-party` 目录及 `.min.js` 文件会失败。缺失文件、重复归属、路径越界、符号链接、npm 清单与锁文件不同步也会失败。
- Python、Rust、Go、其他包管理器等已知但未接入审计的入口会直接失败，不会当作未知普通文件跳过。npm workspaces 暂不支持，不能冒充独立项目登记。
- `audit:dependencies` 先检查清单，再按清单自动审计全部 npm 项目。目录不写死在工作流里。命令显式包含各类依赖，使用锁文件且不运行安装脚本、不执行自动修复；漏洞、网络错误、超时和异常退出均使检查失败。
- 主 Application Checks 在每次 main 推送、PR 和手动执行时运行上述检查。安装依赖之前先检查遗漏。Release 工作流也调用同一审计入口；不会因修改此清单而自动触发打包。

## 新增依赖入口

新增独立 npm 子项目时，先生成同步的 `package.json` 和 `package-lock.json`（或 `npm-shrinkwrap.json`），再登记一个唯一的 `npm` 条目，覆盖为 `npm-audit`。两个文件必须在同一目录。清单通过后，该目录自动进入审计，无需再修改 Actions 目录列表。

新增非 npm 工具链需审查其真实扫描方式；现有 `tracked-only` 条目是明确列出的未完成项，不能当作已有自动防护。手工复制的第三方代码必须主动登记：文件名检测不能可靠区分所有第一方和第三方 JavaScript，也不能发现任意新生态的所有清单格式。新增 Action 引用到已有工作流的版本变化同样不属于本阶段扫描范围。

本地被 `.gitignore` 忽略、未提交的工具不在仓库审计范围。此检查不管理其他项目或机器上安装的 SDK，不关闭 Dependabot 或隐私检查。
