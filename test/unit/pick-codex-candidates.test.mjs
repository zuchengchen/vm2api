import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pickCodexCandidates, handleCodexProtocol } from '../../src/lib/protocol/handle-codex.mjs'

function writeGptVm(root, id, patch = {}) {
  const dir = path.join(root, 'vms')
  fs.mkdirSync(path.join(dir, id), { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      name: id,
      platform: 'openai',
      family: 'codex',
      schedulable: true,
      status: 'running',
      has_token: true,
      ...patch,
    }),
  )
  fs.writeFileSync(
    path.join(dir, id, 'codex-credentials.json'),
    JSON.stringify({
      accounts: [{ id: `${id}-acc`, access_token: 'at', refresh_token: 'rt', chatgpt_account_id: id }],
    }),
  )
}

function scopedReq(allowed) {
  return {
    headers: {},
    apiKeyKind: 'managed',
    apiKeyRecord: { group_type: 'openai', allowed_vms: JSON.stringify(allowed) },
  }
}

test('unrestricted inventory with no GPT slot is no_codex_vm', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-codex-pick-empty-'))
  fs.mkdirSync(path.join(root, 'vms'), { recursive: true })
  const picked = pickCodexCandidates(root, { headers: {}, apiKeyKind: 'user' }, { body: { model: 'gpt-6-astra' } })
  assert.equal(picked.error, 'no_codex_vm')
  fs.rmSync(root, { recursive: true, force: true })
})

test('key scoped to a disabled GPT slot is vm_pool_unavailable, not no_codex_vm', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-codex-pick-scoped-'))
  writeGptVm(root, 'vm-old', { schedulable: false, schedule_disabled_reason: 'disabled', schedule_manual: true })
  writeGptVm(root, 'vm-new')
  const picked = pickCodexCandidates(root, scopedReq(['vm-old']), { body: { model: 'gpt-6-astra' } })
  assert.equal(picked.error, 'vm_pool_unavailable')
  assert.match(picked.message, /不可调度/)
  assert.deepEqual(picked.ids || [], [])
  fs.rmSync(root, { recursive: true, force: true })
})

test('key scoped to a missing GPT slot is vm_pool_unavailable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-codex-pick-missing-'))
  writeGptVm(root, 'vm-new')
  const picked = pickCodexCandidates(root, scopedReq(['vm-gone']), { body: { model: 'gpt-6-astra' } })
  assert.equal(picked.error, 'vm_pool_unavailable')
  assert.match(picked.message, /不可调度/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('key scoped to a ready GPT slot admits that slot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-codex-pick-ready-'))
  writeGptVm(root, 'vm-old', { schedulable: false, schedule_disabled_reason: 'disabled', schedule_manual: true })
  writeGptVm(root, 'vm-new')
  const picked = pickCodexCandidates(root, scopedReq(['vm-new']), { body: { model: 'gpt-6-astra' } })
  assert.equal(picked.error, undefined)
  assert.deepEqual(picked.ids, ['vm-new'])
  fs.rmSync(root, { recursive: true, force: true })
})

test('handleCodexProtocol returns 403 when the key allowlist has no schedulable GPT slot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-codex-hop-scoped-'))
  writeGptVm(root, 'vm-old', { schedulable: false, schedule_disabled_reason: 'disabled', schedule_manual: true })
  writeGptVm(root, 'vm-new')
  const res = { statusCode: 0, body: null }
  let hops = 0
  await handleCodexProtocol({
    req: scopedReq(['vm-old']),
    res,
    protocol: 'openai.responses',
    ctx: { body: { model: 'gpt-6-astra', input: 'hi', stream: false } },
    inbound: { stream: false },
    logBag: {},
    stats: { errors: 0, requests: 0, by_route: {} },
    json: (_res, status, body) => {
      res.statusCode = status
      res.body = body
      return body
    },
    writeSSEHeaders() {},
    routing: {},
    projectRoot: root,
    ops: {
      writeCodexKernelConfig() {},
      ensureCodexKernel: async () => ({ ok: true }),
      streamCodexKernel: async () => {
        hops += 1
        return { ok: true, status: 200, terminalState: 'verified', body: { id: 'resp_ok' } }
      },
    },
  })
  assert.equal(hops, 0)
  assert.equal(res.statusCode, 403)
  assert.equal(res.body?.error?.code, 'vm_pool_unavailable')
  assert.match(String(res.body?.error?.message || ''), /不可调度/)
  fs.rmSync(root, { recursive: true, force: true })
})
