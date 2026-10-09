# 网页更新日志

[中文介绍](../README.md) · [English](#english) · [Windows 发布记录](https://github.com/Plastic-time/warthunder-research-calculator/releases)

这里单独记录下载版本之后的网页改动，不代表发布了新的 Windows 包。

## 2026-10-08 · 介绍与截图更新

- 中英文 README 改为说明“剩余 RP”输入和合并后的清空操作。
- 更新中英文科技树、配件窗口截图，补充手机配件窗口展示。
- 明确网页与 v1.0.26 下载包的区别；修正最新数据核对记录的介绍。
- 本次仅更新文档、截图及截图工具，不修改业务逻辑、游戏数据或版本号，不打包。

## 2026-10-07 · 配件窗口与剩余 RP

对应提交：[afbb713](https://github.com/Plastic-time/warthunder-research-calculator/commit/afbb7139cfb9d20418eaa9428b78f4fcaec689aa)。

- 配件窗口重新整理模式切换、空战优先、图例、预算及计算按钮，适配窄屏和横屏。
- 载具与配件直接填写剩余 RP，旧的已投入记录自动换算显示。空白、负数、小数和超过总费用的输入不接受。
- 剩余 RP 为 0 时，不自动设置已拥有或已研发状态；银狮费用不变。
- 配件的两个清空入口合并为一个，同时清除当前载具的目标、已研发标记和进度。保留空战优先设置，不影响其他载具。
- 七种界面语言同步。两版页面、四种屏幕尺寸、七种语言共 56 组控件检查通过；研发进度、预算、保存与导出回归通过。手机检查为浏览器模拟，不代表实体手机或 Safari 验收。
- 未发布新安装包；最新下载包仍为 v1.0.26。

同日修正：载具卡片的规划状态签不再被“新增”边框遮挡，见 [3294104](https://github.com/Plastic-time/warthunder-research-calculator/commit/3294104599fa4ef4cb266fad80574543d942af2e)。

## English

This log covers web updates after the downloadable release. These entries do not announce new Windows packages.

### 2026-10-08 · Documentation and Screenshots

- Updated both READMEs for remaining-RP input and the combined clear button.
- Replaced the Chinese and English tech-tree and modification screenshots. Added mobile modification views.
- Clarified the difference between the web app and the v1.0.26 download. Corrected the summary of the latest data checks.
- This update changes documentation, screenshots, and the capture tool only. It does not change app logic, game data, or version numbers. No package was built.

### 2026-10-07 · Modification Controls and Remaining RP

Commit: [afbb713](https://github.com/Plastic-time/warthunder-research-calculator/commit/afbb7139cfb9d20418eaa9428b78f4fcaec689aa).

- Reorganized mode controls, air combat priority, the legend, costs, and actions. Improved narrow and landscape layouts.
- Vehicles and modifications now accept remaining RP. Existing invested-RP records are converted for display. Blank, negative, fractional, and over-budget values are rejected.
- Zero remaining RP does not set owned or researched status. Silver Lion costs are unchanged.
- One button now clears modification targets, researched marks, and progress for the current vehicle. It keeps the air combat setting. Other vehicles are unchanged.
- Updated all seven UI languages. Control checks passed across both app variants, four screen sizes, and seven languages: 56 combinations. Progress, budgets, persistence, and export checks also passed. Mobile tests used browser emulation. Physical phones and Safari were not verified.
- No new Windows package was released. The latest download remains v1.0.26.

Also fixed that day: the new-vehicle border no longer covers card plan-status labels. See [3294104](https://github.com/Plastic-time/warthunder-research-calculator/commit/3294104599fa4ef4cb266fad80574543d942af2e).
