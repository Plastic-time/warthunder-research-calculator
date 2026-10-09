<p align="center">
  <img src="doc/assets/research-emblem.png" width="144" alt="研发计算器图标：深绿徽章上的分支路线与金色箭头">
</p>

<h1 align="center">War Thunder 研发计算器</h1>

<p align="center">选好目标，看清路线，算好每一步的研发点与银狮。</p>

<p align="center">
  <a href="https://plastic-time.github.io/warthunder-research-calculator/"><strong>打开网页版</strong></a> &nbsp; · &nbsp;
  <a href="https://github.com/Plastic-time/warthunder-research-calculator/releases/latest"><strong>下载 Windows 版</strong></a> &nbsp; · &nbsp;
  <a href="doc/web-updates.md">更新日志</a>
</p>

<p align="center"><strong>简体中文</strong> &nbsp; / &nbsp; <a href="README.en.md">English</a></p>

<p align="center"><sub>3,235 辆载具 · 3,225 套配件树 · 5 类军种 · 7 种界面语言</sub></p>

## 自动规划研发路线

**不只是把价格相加。** 选定目标、标记已拥有的载具，计算器会结合当前前置关系和等级解锁数量，搜索低 RP 路线，并显示需要准备的银狮。

[![自动规划后的美国陆战科技树，展示 M18 目标和底部研发预算](doc/assets/research-tree-zh.png)](doc/assets/research-tree-zh.png)

- **分清每辆车的用途**：目标、途经点、必经载具和等级补足分别显示，折叠组也能查看已选数量。
- **规划后仍可调整**：单独取消一辆车或标记已拥有，不会清空整条路线；再次规划时再重新计算。
- **按游戏里的剩余值算**：直接填写游戏显示的剩余 RP。例如总计 140,000 RP、还剩 60,000 RP，就填 60,000；预算和自动规划按这个数计算，银狮不变。
- **批量标记已拥有**：按等级标记本级及以下普通载具，确认前可查看列表，操作后可撤销；特殊和隐藏载具不会一并标记。
- **看清完整预算**：底部显示待研发数量、RP 与银狮；可将完整科技树连同预算导出为图片。

> 精确规划为测试功能。搜索达到本机计算上限时，结果是当前找到的最佳路线，不保证全局最优；实际研发前请在游戏内核对。

## 定制配件研发

**只开需要的配件，也能算清楚。** 打开载具的配件窗口，按类别、等级与前置关系选择目标，记录已研发项目，再让计算器补齐必要条件。

[![阵风 C F3 配件窗口，展示 MICA-EM 目标、剩余 RP、空战优先和等级补足](doc/assets/modifications-zh.png)](doc/assets/modifications-zh.png)

- **自由选择**：选择一个或多个配件，RP、银狮和等级数量即时更新。
- **按条件补齐**：点击“计算配件研发”，加入必经配件和等级补足；已研发项目不重复收费。
- **填写剩余 RP**：切换到“剩余 RP”，再点配件，填写游戏显示的剩余数值。填 0 表示不再需要 RP；填回总费用可清除这项进度记录。旧记录会自动换算显示，无需重填。
- **空战优先**：默认开启，可手动关闭。优先考虑干扰装置和空战配件；对空导弹仍按你选择的目标及真实前置计算。
- **一次清空，可撤销**：底部回转箭头按钮同时清除当前载具的配件目标、已研发标记和进度，保留空战优先设置，不影响其他载具。清空后 15 秒内可撤销；继续修改、关闭窗口或切换载具后，撤销入口消失。
- **独立预算**：配件费用不混入载具研发总计；明确为 0 RP、0 SL 的配件直接显示“已解锁”。

<details>
<summary>查看手机配件窗口</summary>

<p align="center"><img src="doc/assets/modifications-mobile-zh.png" width="320" alt="手机配件窗口：模式切换与空战开关在顶部，费用和计算按钮固定在底部"></p>

</details>

## 开始使用

| 操作 | 电脑 | 手机 |
| --- | --- | --- |
| 选择或取消载具目标 | 左键点击 | 轻点 |
| 设置已拥有、途经点等状态 | 右键打开菜单 | 长按约半秒 |
| 填写载具剩余 RP | 右键 → 研发进度 | 长按 → 研发进度 |
| 自动计算路线 | 点击底部“精确规划” | 同左 |
| 查看载具资料 | 点击卡片上的 Wiki 小书签 | 同左 |

手机版的使用指南和导出功能位于顶部“更多”菜单，搜索和筛选有各自的入口。最新网页改动见[独立更新日志](doc/web-updates.md)，使用指南中保留历史版本记录。

网页版直接打开即可，无需游戏账号。Windows 用户下载 [v1.0.26 便携包](https://github.com/Plastic-time/warthunder-research-calculator/releases/download/v1.0.26/WarThunderResearchCalculator-v1.0.26-portable.zip)，解压后运行 `WarThunderResearchCalculator.exe`，不需要另外安装 Node.js。

> 本页说明和截图对应最新版网页。v1.0.26 下载包尚未包含本轮配件窗口、合并清空和“剩余 RP”输入改进，也不会自动获得网页更新。

“全选”可选择或取消当前国家、军种的常规研发载具，包含折叠载具，保留已拥有标记和研发进度。导出截图同时显示科技树原始总额与当前选择还需的 RP、银狮；缺失费用会单独提示。

剩余 RP 填 0 不等于已拥有或已研发，完成状态仍需单独标记。进度不会扣减购买所需的银狮。输入不能为空，且必须是 0 到总费用之间的整数。

主界面的“清空计划”会清除当前国家、军种的选择、状态标记和载具研发进度，15 秒内可撤销并恢复原规划。配件窗口的清空按钮也支持 15 秒撤销。继续修改或切换科技树后，旧的撤销记录失效，不影响其他科技树。

支持陆战、空战、直升机、远洋与近岸舰队；界面及载具名称支持中文、英语、俄语、德语、法语、日语和西班牙语。第三方 Wiki 正文不由本项目翻译。

## 数据与边界

- **固定快照**：整体载具费用基准为游戏 **2.59.0.17**，不是与游戏实时同步。游戏配置是后续费用和前置核对的主要依据，Wiki 用于补充名称、图片和布局；现有导入流程仍有历史数据来源，不能视为全量纯游戏配置。
- **局部修正单独记录**：Ka-29、Do 217 J-2 保留已确认修正；v1.0.11 按 **2.59.0.34** 配置将两架 CA-27 的 GLBC mk.3 调整为 **9,000 RP / 14,000 SL**，不代表整体快照升级。
- **已保留修正**：v1.0.19 按 **2.59.0.38** 更新 F4U-7 配件费用、机炮翻新层级和解锁数量；全配件合计 **47,800 RP / 86,900 SL**。
- **最新数据修正**：v1.0.25 按 **2.59.0.50** 定向更新希腊 F-86E(M)、米格-23M 和 416 工程的配件。具体费用与前置变化见[更新说明](doc/release-v1.0.25.md)，不代表全量数据升级。本轮界面与文档更新不修改游戏数据。
- **未知不是免费**：缺失费用显示“未提供”，不当作 0。等级解锁数量还使用项目独立规则表，规划结果需结合游戏核对。
- **计划留在浏览器**：选择、规划和研发进度保存在当前浏览器，不上传、不跨设备同步；清除浏览器站点数据会删除这些记录。图片、Wiki 和网页版在线人数需要联网；在线人数是浏览器估计值，统计异常不影响计算。

<details>
<summary>开发、维护与更多说明</summary>

- [本地运行与数据维护](doc/development.md)
- [服务器配置与更新权限](doc/server-security.md)
- [在线人数统计规则](doc/online-counter.md)
- [配件图标来源](doc/ammunition-artwork.md)
- [载具快照清单](docs/database/manifest.json) · [配件核对记录](tools/modifications-audit.json)
- [v1.0.26 更新说明](doc/release-v1.0.26.md) · [全部版本](https://github.com/Plastic-time/warthunder-research-calculator/releases)

</details>

---

<p align="center"><sub>由玩家制作的非官方工具，与 Gaijin Entertainment 无隶属关系。游戏名称、载具图片等素材的权利归各自权利人所有。</sub></p>
<p align="center"><a href="https://space.bilibili.com/543495611"><img src="doc/assets/creator-avatar.svg" width="26" height="26" align="absmiddle" alt="扑街的靓仔头像"></a> &nbsp; <sub>bilibili：<a href="https://space.bilibili.com/543495611">扑街的靓仔</a> &nbsp; · &nbsp; 游戏 ID：如日方中</sub></p>
