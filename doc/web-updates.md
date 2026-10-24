# 网页更新日志

[中文介绍](../README.md) · [English](#english) · [Windows 发布记录](https://github.com/Plastic-time/warthunder-research-calculator/releases)

这里单独记录下载版本之后的网页改动，不代表发布了新的 Windows 包。

## 2026-10-24 · 科技树加载重试

- 科技树加载失败后提供重试按钮，无需刷新整页；首次加载资料失败也可重试，重复点击不会并发发送同一重试请求。
- 两版保留已有目标、拥有标记及研发进度。切换国家后，旧请求的迟到结果不能覆盖当前树；Wiki 没有数据仍使用原空状态，不显示网络重试。
- 保留静态数据哈希校验，重试不绕过核验。新增两版、三种宽度、七种语言的失败恢复与存档保护检查。不修改计算规则或游戏数据，不发布 Windows 包。

## 2026-10-24 · 多页面存档保护

- 修复同时打开多个页面时，旧页面可能覆盖另一页新计划或研发进度的问题，覆盖科技树和配件。
- 冲突时保留新存档和本页未保存修改，提供备份与重新载入入口；重新载入前提示确认。
- 备份恢复也会核对是否已有新保存，防止过期预览覆盖进度。补充同时写入、失败回滚和七种语言窄屏检查。
- 请刷新已打开的旧版页面后使用。本功能仅保护浏览器本地存档，不是云同步；计算规则和游戏数据不变，不发布 Windows 包。

## 2026-10-23 · 截图导出进度与取消

- 导出时显示准备、图片加载数量、高清渲染及保存阶段，并提供取消按钮。
- 取消会中止图片请求；已开始的浏览器渲染或 PNG 编码会等待结束后清理，不下载文件，不修改计划或研发进度。
- 跨次导出的图片缓存最多保留 128 项，数据字符串按 16 MiB 估算上限淘汰旧项；这不是整个页面的内存上限。下载完成后释放画布。
- 新增取消、重复导出、缓存淘汰和多语言窄屏检查，并保留真实高清 PNG 下载检查。计算规则、游戏数据及截图尺寸策略不变，不发布 Windows 包。

## 2026-10-23 · 费用计算一致性修复

- 费用缺失的载具不再显示为 0，也不再被当作初始免费载具；网页版、本地版和计算接口对此的判断一致。
- 本地计算接口按已保存的研发进度扣减 RP，并返回费用未知的载具数量；银狮费用、原始单价和拥有状态不变。
- 计算接口增加请求校验，拒绝格式异常的载具 ID、超长列表和无效的进度数值。
- 新增网页版、本地版与接口之间的一致性回归测试。游戏数据未变，不发布 Windows 包。

## 2026-10-17 · 网页缓存检查

- 修正翻译、研发进度、点击反馈脚本更新后仍可能读取旧版本的问题，补充载具分类数据的缓存重新验证。
- 脚本、样式、本地图标、字体和图片统一按内容生成缓存标记；标记遗漏或失效时阻止网页部署。
- 保留原有科技树和配件数据的哈希校验，不清除已保存计划、拥有标记或研发进度，不改变计算逻辑和界面样式。
- 发布后重新载入页面生效，不强制打断已打开页面的操作。本次不发布 Windows 包。[检查范围与更新流程](web-cache-policy.md)。

## 2026-10-17 · 规划数据核对

- 修正规则文件更新后仍可能读取旧缓存的问题；网页引用现在随规则内容变化，保留已有计划和研发进度。
- 依据固定提交的游戏 2.59.0.73 配置，修正 14 处等级解锁数量，避免自动规划少补载具。
- 修正后端旧前置映射，核对 15 辆载具及两个折叠组入口，使这些记录与静态网页和游戏配置一致。
- 增加全部 50 棵树、241 个显式门槛、前置及自动补足的回归测试。保留人工确认的配件修正。
- 不改变界面、规划算法或载具/配件费用，不宣称全量快照升级，不发布 Windows 包。[核对范围、来源及待确认项](game-data-review-20261017.md)。

## 2026-10-17 · 科技树更新保护

- 本地 Wiki 刷新与离线网页快照合入只更新已有载具的名称、图片和用途说明。
- 保留研发费、银狮、前置、等级、折叠结构和来源记录；新增、缺失及冲突条目写入核对报告，不直接改变现有游戏数据。
- 增加缺失基线、并发修改、写入失败和全部 50 棵科技树的保护回归测试，并接入 GitHub 检查。
- 不改变界面、规划算法或游戏版本，不重建配件，不发布 Windows 包。独立配件构建工具仍需单独审查。

## 2026-10-13 · 界面改版

- 宽屏桌面的标题栏和筛选栏合并为一行，高度从约 184 像素降到 56 像素，科技树多显示约一行载具。使用指南、导出截图、清空计划和备份改为图标按钮，悬停显示名称。
- 计算范围、“自动补位时避开折叠载具”和“全选”移入“筛选”菜单；语言和游戏版本移入“更多”菜单；作者信息点击头像查看。手机布局不变。
- 载具卡片改为紧凑布局，标准卡片从 174 像素降到 109 像素。“配件”入口改为卡片右上角的齿轮，触屏保留 44 像素点击区域。
- 设定目标后，路线之外的载具和连线变暗；必经载具改用偏蓝底色。
- 配件窗口改用与主界面一致的深灰色系，配件格随窗口大小放大，不再留出大片空白。
- 样式中的颜色和字号收拢为一套共用变量，个别颜色和字号有细微变化。
- 不修改计算逻辑、游戏数据或版本号；本次仅更新网页，不发布 Windows 包。浏览器检查覆盖桌面与手机模拟尺寸，未替代实体手机验收。

## 2026-10-11 · 科技树搜索优化

- 载具名称和 ID 搜索兼容空格、连字符、大小写及全角输入，例如 F15、F-15 和 F 15。
- 中文输入法组词时保留当前科技树，确认文字后再筛选；连续输入合并刷新，减少重绘。
- 显示匹配载具数量，包含折叠组内成员；手机点击“查看结果”或按回车可定位首个匹配载具，必要时展开折叠组。
- 新增清除搜索按钮，清除后恢复搜索前的科技树位置，不改动计划、已拥有标记或研发进度。
- 同步七种语言；不修改计算逻辑、游戏数据或版本号，本次仅更新网页，不发布 Windows 包。

## 2026-10-10 · 计划备份与恢复

- 新增备份与恢复入口，支持导出所有科技树的目标、已拥有标记、途经点、RP 进度、规划记录及各载具的配件记录。
- 导入 JSON 文件后先展示摘要和覆盖数量，确认后仅替换备份中包含的记录；其他计划和界面语言保留。
- 拒绝无效、重复记录、未知版本和超过 5 MB 的备份；预览后本地记录发生变化时要求重新确认。
- 加入存储异常保护。读取失败保留原记录并提示；写入失败暂存本次修改，存储仍可读取时可导出备份。恢复中断时尝试回滚，回滚失败会明确警告。
- 文件只在本机处理，不上传服务器。同步七种语言与中英文介绍，不修改计算逻辑或游戏数据，不发布 Windows 包。

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

### 2026-10-24 · Retry Loading a Tech Tree

- Added a retry button for failed tree loads, including startup failures. No page refresh is needed. Repeated clicks do not send duplicate retry requests.
- Both versions preserve saved targets, owned markers, and research progress. Late responses cannot replace a newer country selection. Empty Wiki trees keep their existing empty state.
- Static data still passes the hash check. Added recovery tests at three widths in all seven languages. Calculation rules and game data are unchanged. No Windows package is published.

### 2026-10-24 · Multi-Tab Save Protection

- Fixed stale tabs overwriting newer plans or research progress. This covers tech trees and modifications.
- Conflicts preserve the newer save and the current tab's unsaved edits. You can export a backup before confirming a reload.
- Backup restores also check for newer saves. Added concurrent-write, rollback, and narrow-screen checks in all seven languages.
- Refresh existing tabs to load the protection. Saves remain in your browser; this is not cloud sync. Calculation rules and game data are unchanged. No Windows package is published.

### 2026-10-23 · Screenshot Progress and Cancellation

- Exports show preparation, image counts, rendering and saving stages. A cancel button is available.
- Cancellation stops image requests. Active rendering or PNG encoding finishes before cleanup. No file is downloaded, and saved plans and research progress stay unchanged.
- The image cache retains up to 128 entries with an estimated 16 MiB string budget. This is not a limit on total page memory. Completed downloads release their canvas.
- Added cancellation, repeat-export, cache eviction and narrow-screen language checks. Real high-resolution PNG checks remain in place. Calculation rules, game data and screenshot size limits are unchanged. No Windows package.

### 2026-10-23 · Cost Calculation Consistency Fix

- Vehicles with missing costs are no longer shown as 0 or treated as free starter vehicles. The web version, the local version and the calculation API now agree on this.
- The local calculation API deducts saved research progress from RP and reports how many vehicles have unknown costs. Silver Lions, original prices and ownership stay unchanged.
- The API validates requests and rejects malformed vehicle IDs, oversized lists and invalid progress values.
- Added consistency regression tests across the web version, the local version and the API. No game data changes or Windows package.

### 2026-10-17 · Web Cache Checks

- Fixed stale scripts for translations, research progress and click feedback. Vehicle classification requests now revalidate cached responses.
- Local scripts, styles, icons, fonts and images use content-based cache revisions. Missing or stale revisions block deployment.
- Kept existing data hash checks, saved plans, ownership and research progress. Calculation logic and visual styles are unchanged.
- Reload after deployment to load the update. Open pages are not interrupted. No Windows package was released. [Scope and update steps](web-cache-policy.md).

### 2026-10-17 · Planning Data Review

- Fixed stale rule caching after web updates. The script URL now changes with the rule contents. Saved plans and research progress stay intact.
- Corrected 14 rank unlock counts using pinned game data from 2.59.0.73. Plans now use the reviewed thresholds.
- Updated backend mappings for 15 vehicle prerequisites and two folder entries. These records now match the static site and game configuration.
- Added checks for all 50 trees, 241 explicit thresholds, prerequisite links, and automatic fillers. User-confirmed modification corrections remain intact.
- No UI, planning algorithm, or vehicle/modification cost changes. This is not a full snapshot upgrade or a new Windows release. See the [source review and remaining questions](game-data-review-20261017.md).

### 2026-10-17 · Protected Tech Tree Refreshes

- Local Wiki refreshes and offline web snapshot updates now merge only names, images, and role descriptions for existing entries.
- Research costs, Silver Lions, prerequisites, ranks, folders, and source records stay unchanged. A review report lists new, missing, and conflicting entries.
- Added checks for missing baselines, concurrent edits, write failures, and all 50 shipped trees. GitHub runs the new checks.
- No UI, planning, game-version, or modification-data changes. No Windows package is released. Separate modification build tools still need their own review.

### 2026-10-13 · Interface Redesign

- On wide desktops the title bar and filter bar are now one row, down from about 184 px to 56 px, so roughly one more row of vehicles fits. Guide, Export, Clear Plan, and Backup are icon buttons with tooltips.
- Calculation scope, the foldered-vehicle option, and Select all moved to Filters. Language and game version moved to More. Select the avatar for author details. The mobile layout is unchanged.
- Vehicle cards are more compact: a standard card is 109 px tall instead of 174 px. Modifications open from a gear at the top right of the card, with a 44 px touch target on touchscreens.
- Once a target is set, vehicles and links off the route are dimmed. Required vehicles use a blue-tinted surface.
- The modification window uses the same graphite colors as the main view. Its cells grow with the window instead of leaving it half empty.
- Stylesheet colors and font sizes now come from one shared set of variables. A few colors and sizes changed slightly.
- No changes to calculations, game data, or version numbers. Web update only; no Windows package. Browser checks covered desktop and emulated mobile sizes, not physical phones.

### 2026-10-11 · Tech Tree Search

- Search accepts spaces, hyphens, letter case, and full-width characters. F15, F-15, and F 15 find the same vehicles.
- Chinese IME composition no longer redraws the tree. Rapid typing is grouped into one refresh.
- Show the match count, including foldered vehicles. View results on mobile or press Enter to locate the first match. Its folder opens when needed.
- Clear search restores the previous tree position. Targets, owned marks, and RP progress stay unchanged.
- Updated all seven languages. No changes to calculations, game data, or version numbers. Web update only; no Windows package.

### 2026-10-10 · Plan Backup and Restore

- Added JSON backups for all trees in the current browser. Backups include targets, owned marks, waypoints, RP progress, routes, and vehicle modification records.
- Import shows a summary and the number of existing records to replace. Changes require confirmation. Other plans and the interface language stay unchanged.
- Invalid files, duplicate records, unknown versions, and files over 5 MB are rejected. If local records change after preview, choose the file again before restoring.
- Added storage error handling. Unreadable records are preserved. Failed saves remain in memory and can be exported while storage remains readable. Interrupted restores attempt rollback. Rollback failures show an explicit warning.
- Files stay on your device. Updated all seven languages and both READMEs. Calculation logic and game data are unchanged. No Windows package was released.

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
