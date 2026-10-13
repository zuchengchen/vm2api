# vm2api fork branch model

This repository is the self-maintained fork `zuchengchen/vm2api` of upstream `dofastted/vm2api`.

| Branch | Role |
|---|---|
| `main` | Upstream mirror only. Never commit local work here. |
| `czc-dev` | Development and integration. Daily work and upstream merges land here. |
| `czc-main` | Stable line. Deploy and tag only from here. |

Remotes: `origin` = `git@github.com:zuchengchen/vm2api.git`; `upstream` = `git@github.com:dofastted/vm2api.git` (fetch-only). GitHub default branch is `czc-main`.

Direction: `upstream/main` → `main` → `czc-dev` → `czc-main`. Never merge `czc-*` into `main`. Never rebase a published `czc-main`.

## Sync

```bash
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main
git checkout czc-dev
git merge main
```

`--ff-only` failure on `main` because of local commits: stop. Because of an upstream history rewrite: reset `main` to `upstream/main`, force-push `origin/main`, merge into `czc-dev`. Never reset `czc-dev` or `czc-main`.

Read `CHANGELOG.md`「已部署机升级」before promoting to `czc-main`. Note the result in `CHANGELOG.czc.md`.

## Local work

- Feature branches: `czc/<topic>` from `czc-dev`, merge back into `czc-dev`.
- Do not edit upstream `VERSION` or `CHANGELOG.md`. Use `CHANGELOG.czc.md` and `docs/CZC-PATCHES.md`.
- Production control plane from `czc-main` or annotated `czc-vYYYY.MM.DD.N`. Do not deploy `ghcr.io/dofastted/vm2api` as this fork.
- Host-only: `.env`, `data/`, `vms/`, production `routing.json`, mounted `bin/` / `share/`.
- SQL migrations: append `1xx_czc_*.sql` only.
- Prefer config overlay, then `src/lib/czc/` / `web/src/features/czc/`.
