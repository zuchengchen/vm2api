# 本叉补丁清单

相对 `dofastted/vm2api` 的本地分叉点。合入上游前按本表核对冲突与回归。没有条目表示代码与上游 `main` 一致（仅多了本叉文档）。

| 文件 / 区域 | 原因 | 合上游时怎么验 |
|---|---|---|
| `.grok/rules/fork-branches.md` | 本叉三线纪律 | 上游若新增同路径再合并 |
| `CHANGELOG.czc.md` | 本叉变更记录 | 保留；不要并进上游 `CHANGELOG.md` |
| `docs/CZC-PATCHES.md` | 本表 | 保留 |
| `src/lib/protocol/handle-codex.mjs` | 受限密钥无可用 GPT 槽时返回 `vm_pool_unavailable`，避免误报 `no_codex_vm` | `node --test test/unit/pick-codex-candidates.test.mjs`；合上游时核对 `pickCodexCandidates` / `rejectCodexAdmission` |
