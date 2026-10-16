# Changelog (czc fork)

本叉相对上游 `dofastted/vm2api` 的记录。上游原文仍在 `CHANGELOG.md`。`VERSION` 表示当前跟到的上游版本。

## czc — 2026-10-16

- GPT 槽：额度用尽后可自动消费重置券（默认关）；面板展示 Codex 点数，并增加「额度用尽后消耗点数」开关（默认关，对齐 sub2api 点数保护）。
- 已部署机升级：更新 Node 控制面与 `web/dist`，重启一次 Node。无迁移、无新依赖，不必 `wrap-cli/sync`。不要覆盖 `routing.json`、`vms/`、`data/`、`.env`。两个开关默认关闭，现有 GPT 槽调度行为不变。

## czc — 2026-10-15

- GPT 入站：密钥勾了 openai 分组或账号池、但勾选槽全部不可调度（停用、无凭证、不在允许列表）时，返回 `403 vm_pool_unavailable`（「密钥勾选的 GPT 槽位当前不可调度」/「账号池没有可调度的 GPT 槽位」），不再落成 `503 no_codex_vm`「no Codex kernel VM is configured」。机器上确实没有 GPT 槽时，无限制密钥仍是原来的 503。

## 跟到上游 1.3.153 — 2026-10-13

- 建立三线：`main` 为上游镜像，`czc-dev` 为开发集成，`czc-main` 为稳定部署线。
- 远程：`origin` = `zuchengchen/vm2api`，`upstream` = `dofastted/vm2api`（只读）。
- 尚无功能向补丁。分叉清单见 [docs/CZC-PATCHES.md](docs/CZC-PATCHES.md)。
