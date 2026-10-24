# 2026-10-24 发布依赖检查

多页面存档修复的远端检查发现既有依赖审计失败。`0417ab0` 与其父提交 `918f9a0` 的 `package-lock.json` 相同；问题不是本次存档代码引入。首次远端审计报告两个高危依赖，本机审计还列出受影响的上层依赖。

仅在现有依赖范围内更新锁文件，不使用 `--force`，不改变直接依赖范围：

| 间接依赖 | 原版本 | 修复版本 |
| --- | --- | --- |
| body-parser | 2.3.0 | 2.4.0 |
| undici | 7.29.1 | 7.30.1 |
| qs（body-parser 要求） | 6.16.0 | 6.16.1 |

来源：[body-parser 公告](https://github.com/advisories/GHSA-27r3-jxmh-p828)、[undici 公告](https://github.com/advisories/GHSA-xjj6-f33q-929c)。

使用 `npm ci --ignore-scripts` 安装后，`npm audit --audit-level=low` 为 0 漏洞，`node --test tools/test-*.cjs` 146 项通过。审计结果是本次检查快照，不保证未来没有新公告。不修改计算规则或游戏数据，不打包。
