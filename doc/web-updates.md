# 网页更新日志

[中文介绍](../README.md) · [English](#english) · [Windows 发布记录](https://github.com/Plastic-time/warthunder-research-calculator/releases)

这里单独记录下载版本之后的网页改动，不代表发布了新的 Windows 包。

## 2026-10-09 · 导航与界面细节优化

- 宽屏桌面将军种切换移到左侧，国家、搜索、语言与计算范围集中在上方；手机保留横向军种切换。
- 保留深色主题和浅金色选中状态，统一筛选控件、菜单、间距与工具图标。
- 使用指南、截图导出和清空操作改为更轻量的图标配文字入口。
- 缩短菜单进出动效，统一悬停与选中反馈；尊重系统的减少动态效果设置。
- 检查桌面与手机尺寸下的七种语言布局，避免控件重叠和长文字截断。手机检查为浏览器模拟，未替代实体手机或 Safari 验收。
- 不修改计算逻辑、游戏数据或版本号；本次仅更新网页，不发布 Windows 包。

## 2026-10-09 · 配件清空撤销与提示修复

- 后续修正：复现按下按钮时提示瞬间竖排的原因，是缩放动效改变了提示框的定位参照。改为只缩放图标；保持普通动效开启，逐帧检查鼠标、触屏、键盘按下及松开。
- 主科技树“清空计划”补充同样的 15 秒撤销，恢复目标、已拥有、途经点、载具 RP 进度及原规划；继续修改或切换科技树后失效，保留其他树和配件记录。
- 配件清空后提供 15 秒撤销，恢复当前载具的目标、已研发标记、RP 进度和原预算。鼠标停留或键盘聚焦提示时暂停计时。
- 新操作、关闭窗口和切换载具会取消待撤销记录，不覆盖后续操作或其他载具。
- 修复清空按钮提示被挤成竖列的问题；桌面提示正常换行，触屏点击不再留下悬浮提示。
- 同步七种语言，不修改计算逻辑、游戏数据或版本号，不打包。

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

### 2026-10-09 · Navigation and UI Polish

- Moved vehicle categories to a left rail on wide screens. Nation, search, language, and calculation scope stay at the top. Mobile keeps horizontal category navigation.
- Kept the dark theme and soft gold selection accents. Aligned filter controls, menus, spacing, and tool icons.
- Gave the guide, image export, and clear actions lighter icon-and-text controls.
- Shortened menu transitions and aligned hover and selection feedback. Reduced-motion preferences are respected.
- Checked all seven languages at desktop and mobile sizes for overlaps and clipped labels. Mobile checks use browser emulation. Physical phones and Safari were not verified.
- Calculation logic, game data, and version numbers are unchanged. This is a web update, with no new Windows package.

### 2026-10-09 · Undo Clear and Tooltip Fix

- Follow-up: reproduced the brief vertical tooltip during button presses. Scaling the button changed the tooltip's containing block. Only the icon now scales. Frame-by-frame checks cover mouse, touch, and keyboard presses with animations enabled.
- Added the same 15-second undo to Clear Plan. It restores targets, owned marks, waypoints, vehicle RP progress, and the original route. Further edits or switching trees dismiss it. Other trees and modification records stay untouched.
- Added a 15-second undo after clearing modifications. It restores targets, researched marks, RP progress, and the previous budget. Hovering or keyboard focus pauses the timer.
- Further actions, closing the window, or switching vehicles dismiss undo. Later edits and other vehicles remain untouched.
- Fixed tooltips wrapping into a narrow vertical column. Desktop hints wrap normally. Touch taps no longer leave a hover hint behind.
- Updated all seven languages. No calculation, game data, or version changes. No new Windows package.

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
