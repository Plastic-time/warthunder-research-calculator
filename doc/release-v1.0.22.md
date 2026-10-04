# v1.0.22 科技树卡片与移动端优化

- 调整载具卡片信息层级：名称、BR 与类型、RP/SL 费用、分类和规划状态依次呈现。费用使用两列对齐，卡片宽度保持不变。
- 金鹰载具使用官方金鹰轮廓，礼包使用礼盒图标。标签统一为柔和金色，图文居中对齐，保留 RP 0 / SL 0。
- 普通研发载具不再重复显示“普通 / 非金币”；特殊区域中的非金币分类仍保留。没有重新归类载具。
- 安装包同步近期网页更新：手机等级栏与预算条更紧凑，科技树连线更细，选中路线显示金色高亮。
- 同步已合并的依赖与隐私检查维护更新。

本次不修改计算逻辑、载具费用或配件数据。游戏版本仍为 2.59.0.38。

## 下载

Windows 用户下载 `WarThunderResearchCalculator-v1.0.22-portable.zip`，解压后运行 `WarThunderResearchCalculator.exe`，无需另装 Node.js。不带 `portable` 的 ZIP 为源码包。

## 验证范围

已通过桌面、手机尺寸的浏览器模拟检查和七种语言布局检查。真实手机、Safari 与 Windows 安装包实机启动不在本轮本地验收范围内；构建产物另由 GitHub Actions 检查内容和隐私。

## English

- Vehicle cards now show the name, BR and role, RP/SL costs, then category and planning status. Costs use two aligned columns. Card width is unchanged.
- GE vehicles use the official Golden Eagles silhouette. Pack vehicles use a gift icon. Both badges use muted gold with centered icons and text. Zero costs remain visible.
- Regular research vehicles no longer repeat the standard classification label. Non-premium labels in the special section are retained. Vehicle classifications are unchanged.
- The Windows package includes recent web updates: a more compact mobile rank rail and budget bar, thinner tree links, and gold highlights for selected routes.
- Includes the dependency and privacy-check maintenance updates already merged into the project.

Calculations and game data are unchanged. Mobile checks used browser emulation, not physical devices or Safari. The Windows package was not launched on a local PC in this release check.
