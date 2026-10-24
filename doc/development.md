# 本地运行与数据维护

[返回项目首页](../README.md) · [English overview](../README.en.md)

## 本地运行

普通用户建议下载 [Windows 便携版](https://github.com/Plastic-time/warthunder-research-calculator/releases/latest)。开发环境使用 **Node.js 24 LTS，版本不低于 24.21.0 且低于 25**，以 `package.json` 的 `engines` 为准。

```powershell
npm ci --ignore-scripts
npm start
```

默认访问 `http://localhost:3000`。Windows 启动器由 .NET 10 构建；便携包自带 Node.js，不要求用户安装开发环境。

## 发布结构

| 路径 | 用途 |
| --- | --- |
| `public/` | 本地和桌面版网页 |
| `docs/` | GitHub Pages 静态网页及发布快照 |
| `database/` | 桌面后端载具数据 |
| `public/database/modifications/`、`docs/database/modifications/` | 配件索引与 44 个按国家、军种划分的数据块 |
| `config/data-version.json` | 载具费用版本与核对范围 |
| `config/vehicle-release.json` | 当前游戏大版本的新增载具标记 |
| `dict/unlock_quantity.js`、`docs/unlock-quantity.js` | 项目独立等级解锁数量规则 |
| `doc/` | 维护说明、版本记录与 README 展示素材 |

静态版在浏览器内计算，不调用第三方规划接口。桌面版使用本地 Express 服务。网页发布和桌面打包是两个步骤；已下载的旧包不会自动获得新网页内容。

### 版本标识的边界

- 页面显示与中英文 README 的“最新核对版本”使用 `config/data-version.json` 的 `latestReview.gameVersion`；`fullSnapshotUpgrade: false` 表示局部核对，不能替代基础快照版本。
- `gameVersion` 和各数据文件的来源版本记录实际基准；`latestCorrection`、`previousCorrections` 及历史更新日志保留当时的版本，不做全文替换。
- `package.json` 的版本属于软件发布。资源 URL 的 `v` 属于软件版本，`r` 按文件内容变化。备份文件的 `version` 是格式版本，均不是游戏数据版本。未打新包时不能改写既有下载包说明或发布标签。
- 核对新数据后同步页面标识、七语范围说明、中英文 README 和 `doc/web-updates.md`，运行 `node tools/test-desktop-snapshot.cjs` 与 `npm run check:web-assets`。浏览器还需检查桌面“更多”、手机页首、使用指南和语言切换。

## 游戏配置核对

先阅读 [项目数据规则](../AGENTS.md)。游戏配置是未来费用、等级、前置和配件成员核对的主要依据，Wiki 仅作补充；现有历史导入器不能视为已经全部完成这一迁移。

```powershell
node tools/check-datamine-updates.cjs
```

这条命令固定上游提交后读取版本，生成 `logs/datamine-update-check.json`，**不导入数据、不自动升级生产快照**。文件变化不等于玩家价格变化，也不证明载具已公开推出。GitHub 对比接口的文件清单可能有数量上限，需查看报告中的截断提示。

更新前逐项检查 RP、银狮、购买货币、公开可用状态、配件成员、前置和等级门槛。缺失费用不当作 0，也不能用游戏内部价格直接填充玩家购买费用。

Ka-29、Do 217 J-2 和两架 CA-27 的已确认修正记录在配件索引中。v1.0.11 的 CA-27 修正仅涉及两项挂架银狮费用；整体载具费用基准仍为 2.59.0.17，不应把局部更新写成全量升级。

## 历史导入工具

以下工具仍用于开发核对，**不要未经差异审查直接运行后发布**：

| 工具 | 行为与注意事项 |
| --- | --- |
| `npm run pull -- usa ground` | 只刷新本地指定科技树的名称、图片和用途说明，保留已有游戏字段 |
| `npm run pull` | 对本地全部科技树执行相同的资料刷新保护 |
| `node tools/refresh-wiki.cjs` | 抓取 Wiki 候选快照，临时资料位于 `logs/wiki-refresh` |
| `node tools/build-wiki-snapshot.cjs` | 构建原始 Wiki 候选快照；完成实时复核后，`--apply` 仅将允许的资料字段合入已有网页快照 |
| `node tools/verify-live-wiki.cjs` | 核对 Wiki，不代表已经核对游戏费用 |
| `npm run build:modifications` | 重建配件快照；必须复核来源及用户确认修正 |

### 科技树刷新保护

“更新当前树”、`POST /api/update/:country/:type`、`npm run pull` 和网页快照的 `--apply` 共用资料字段白名单：仅允许修改已有条目的 `title`、`vehicle_icon`、`main_role`。空资料和不在 Wiki 图片来源范围内的地址不会覆盖旧值。

RP、银狮、BR、前置、等级、解锁数量、载具身份、未知费用、折叠成员、列顺序及已有来源记录全部保留。布局顺序也可能影响前置推导，因此不会随 Wiki 刷新。新出现的载具不会直接加入生产数据，Wiki 缺失的载具也不会被删除。没有本地基线时拒绝用 Wiki 建立新树。

- 本地报告：`logs/wiki-update-review/<country>_<type>.json`。记录候选与结果哈希、保护字段差异及待核对名单；`protectedChangesApplied` 恒为 `false`，不代表资料字段没有刷新。接口响应的 `review` 提供摘要，不暴露本机路径。
- 网页快照报告：`logs/wiki-refresh/presentation-review.json`。原始候选仍放在 `logs/wiki-refresh/staged`，只能用于核对，不能直接复制到发布目录。`--apply` 校验已有快照哈希，保留原游戏版本与来源，仅更新合入后的文件哈希；写入失败时尝试回滚已写文件，回滚失败会明确报错，必须停止发布并检查文件。
- 本地刷新发现数据库在抓取期间被修改时停止写入；无法保存核对报告时也不会替换数据库。

这些入口不是游戏数据升级器，也不会重建配件。`build:modifications` 等独立游戏数据工具仍须单独审查；本轮保护不等于所有历史导入器都已迁移。新增载具、调整费用或前置必须另行核对固定版本的游戏配置。代码审查应将数据变化与 UI、规划算法变化分开。

## 回归检查

```powershell
node tools/test-wiki.cjs
node tools/test-desktop-snapshot.cjs
node tools/test-planner.cjs
node --test tools/test-calculation-consistency.cjs
node tools/test-modifications.cjs
node tools/test-site-locales.cjs
npm run test:security
npm run test:wiki-refresh
```

发布前还需检查实际浏览器页面、下载包及网页数据一致性。配件校验覆盖条目数量、哈希、前置、预算和已确认修正；结构检查通过不等于每一项玩家价格均已实机核对。

### 截图与备份浏览器验收

导出器按阶段报告进度，图片加载阶段显示已完成数。取消会终止图片请求；浏览器画布渲染和 PNG 编码不可中断，须等当前操作结束后丢弃结果并释放占用。取消不下载文件，也不修改计划和进度。跨次导出缓存最多 128 项，按 UTF-16 字符串估算不超过 16 MiB，最近未使用项先淘汰；失败请求不入缓存。这不是整个页面的内存上限。`render()` 返回的画布由调用方释放，`download()` 自行释放画布并返回尺寸及 Blob。

`tools/test-route-export.cjs` 检查缓存数量、字节上限、淘汰顺序、请求合并、失败重试和请求中止。`tools/check-export-controls.cjs` 在两版网页的 1440、390、320 像素宽度检查七种语言，分别取消图片加载、渲染和编码，并在同一页面重试真实 PNG 下载。渲染、编码取消用受控延迟覆盖竞态；真实图片和完整画布由后续高清导出套件验证。

`npm run test:browser` 包含截图导出和计划备份检查；单独运行这部分可用 `npm run test:browser:recovery`。本机默认使用 Chrome，可通过 `CHROME_PATH` 指定路径。CI 使用 Playwright Chromium，并在执行前运行 `npx playwright install --with-deps chromium`。

- 截图：本地版和静态版各检查桌面、手机尺寸。覆盖上下两处预算、剩余 RP、真实图片嵌入、画布尺寸上限、非空画面和实际下载 PNG 的解码；大树另覆盖美国、苏联。模拟一张图片请求失败后，检查不下载残缺截图、不改变计划或滚动位置、解除占用并允许重试。
- 备份：两版各检查 1440、390、320 像素宽度及手机横屏，逐一检查七种语言。验证实际 JSON 下载、两版之间互相恢复、预览与取消不写入、恢复后预算及 RP 进度一致、刷新保留、配件缓存更新和无关记录保留。无效、过大、重复记录和不支持版本的文件不得恢复；过期预览不得覆盖新编辑；存储写入失败须回滚；损坏的旧记录必须先保留，再由明确确认的恢复替换。
- 所有计划和故障均在隔离浏览器上下文中构造，不读取用户浏览器档案。图片失败和存储故障只由测试注入，不修改生产安全校验，也不使用占位图代替导出结果。
- GitHub 的应用检查和 Pages 发布前检查会执行这些测试。附件仅保留截图预览和检查报告 7 天，不上传浏览器档案、原始备份 JSON 或大型完整 PNG。手机测试属于浏览器模拟，不等于实机或 Safari 验收。

### 多页面存档保护

两版网页共用 `plan-write-guard.js` 和 `plan-storage.js`。写入与备份恢复使用同源 Web Lock 排队，IndexedDB 的 `wt-research-save-guard/revisions` 事务保存每条记录的 SHA-256 校验值。它用于识别另一页面已经提交的更新，即使当前页短暂读到旧的 localStorage。校验库不保存计划正文，不上传数据；原有 localStorage 和备份 JSON 格式不变。

普通保存核对读取时的记录与最新校验值。冲突时保留磁盘上的新记录和本页内存草稿，提示先导出备份，再确认重新载入；不自动合并目标或研发进度。备份预览记录当时的校验值，确认恢复时再次核验，过期预览不得覆盖新保存。校验库提交失败时尝试回滚本次 localStorage 写入，并保留草稿。异常中断或回滚失败可能留下不匹配的校验值，此时停止自动保存，使用明确确认的备份恢复重新建立一致状态。

浏览器中的 `write()`、`preview()`、`restore()` 为异步操作；直接核对 localStorage 的测试应先 `await PlanStorage.settled()`。同步核心仍可用于单元测试。缺少或禁止 Web Locks、IndexedDB 等能力时停止写入并显示保存失败，不能静默退回无保护覆盖。部署不能改变尚未刷新的旧版脚本，请刷新已打开的旧页面后使用多页面保护。

`tools/check-plan-concurrency.cjs` 覆盖两版网页、三种宽度、七种语言，以及真实双页面的科技树和配件冲突、草稿下载、重新载入确认、120 次同时写入、校验库故障回滚和过期备份恢复；已纳入浏览器发布检查。测试使用隔离存储，不读取玩家档案，不代表真机或 Safari 验收。

### 加载失败恢复

`loadInitialData()` 负责可重试的首次资料加载，事件只在入口绑定一次。普通科技树失败只重新请求当前选择，不刷新整页、不清除存档。重试中移除按钮并用 `treeSelectionLoading` 阻止连续点击；两版均用请求编号忽略过期响应。静态版仍按已加载清单核验哈希，发布期间清单与文件版本不一致时仍会报错，需要重新载入页面获取新清单，不能跳过完整性校验。

`tools/check-tree-retry.cjs` 已接入 `npm run test:browser`。它在隔离上下文注入资料清单/API 503、科技树 503、请求中断及静态哈希错误，覆盖键盘重试、重复点击、国家切换竞态、空树区分和存档保留。桌面、390px、320px 共两版六场景，七种语言保存 42 张截图；手机尺寸为模拟验收。

## 本地接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/meta` | 国家与军种列表 |
| `GET /api/tree/:country/:type` | 读取本地科技树 |
| `GET /api/tree/:country/:type/flat` | 读取扁平化载具列表 |
| `POST /api/calculate/:country/:type` | 计算载具研发费用 |
| `GET /api/unit/:data_unit_id` | 获取单个载具详情 |
| `POST /api/update/:country/:type` | 有权限校验的资料刷新，保留游戏字段并返回 `review` 摘要 |

不要把更新凭证放入公开前端。服务暴露范围、管理员更新及部署注意事项见 [服务器配置](server-security.md)。

### 计算接口的费用口径

`POST /api/calculate/:country/:type` 接收 JSON 对象。`plannedIds`、`ownedIds` 为可选的载具 ID 数组，`targetId` 为可选的单个目标。`dependencyMode` 可取 `selected`（默认）或 `dependencies`，`folderMode` 保留 `first`、`all` 两种取值。前置计算规则不变。

`progressRp` 是可选的 `{ "载具ID": 已投入RP }` 对象，兼容现有本地存档。网页输入的是剩余 RP，保存时会换算为已投入 RP；接口不能直接把剩余值当作已投入值。进度须为非负安全整数，超出总 RP 时按总 RP 截断。进度适用于目标及纳入计划的前置，但不会改变已拥有状态或银狮费用。

返回字段：

- `total_rp`：扣除已投入进度后的已知 RP 小计。
- `raw_total_rp`：同一份待购买列表在扣除进度前的已知 RP 小计。
- `total_sp`：已知银狮费用小计。
- `unknown_rp_count`、`unknown_sp_count`：待购买列表中对应费用未知的载具数量。数量非零时，小计不能当成完整总费用。
- `missing`：尚未拥有且非初始免费载具的列表。原始 `rp`、`sp` 保留，包括未知值 `null`；研发完成但尚未购买的载具仍在列表中。

只有普通一级载具的 RP 和银狮费用均明确为 0，才视为初始免费载具。费用未知不代表免费。空请求对象返回空计划；字段类型或取值错误返回 `400` 和通用错误消息，不返回服务器路径。ID 只允许 1–160 位字母、数字、下划线或连字符，禁止原型字段名；每个 ID 数组和进度表最多 10,000 项。其他科技树的存档 ID 不会影响当前树的预算。

`tools/test-calculation-consistency.cjs` 对照全部 50 棵树的本地网页、静态网页和接口结果。`npm run test:browser` 另包含两版网页在桌面和手机尺寸下的缺失费用、剩余 RP、刷新保留和接口一致性检查。

## 提交与发布

提交须遵守 [隐私规则](commit-privacy.md) 和 [AGENTS.md](../AGENTS.md)，使用指定的 GitHub noreply 身份，不导入隐私清理前的 Git 历史。

```powershell
node tools/check-commit-privacy.cjs --identity
node tools/check-publish-privacy.cjs
node tools/check-commit-privacy.cjs --all
```

版本说明单独存放在 `doc/release-v*.md`。推送主分支会触发 Pages 部署；发布版本标签会触发 Windows 构建和检查，将 ZIP 与校验文件保存为该次运行的 `release-packages` 附件（保留 7 天），不再由机器人创建 Release。打包命令为 `npm run package:release`，内容与流程见 `.github/workflows/release.yml`。

核对该次运行的标签、提交和校验值后，用已登录的 `Plastic-time` 账号下载构建附件并创建正式 Release，确保发布者显示为作者账号。不要把个人访问令牌写入仓库或前端，也不要为署名恢复私人邮箱。

```powershell
gh api user --jq .login
gh run download <run-id> --name release-packages --dir <download-directory>
gh release create <tag> --verify-tag --latest --title "War Thunder 研发计算器 <tag> 维护更新" --notes-file doc/release-<tag>.md <portable.zip> <source.zip> <SHA256SUMS.txt>
```
