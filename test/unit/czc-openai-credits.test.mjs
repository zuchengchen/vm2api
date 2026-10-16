import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseOpenaiCredits,
  openaiCreditsEnabledOf,
  persistableOpenaiCredits,
} from '../../src/lib/czc/openai-credits-flags.mjs'
import { applyOpenaiQuotaSettings } from '../../src/lib/czc/openai-credits.mjs'
import { maybeAutoResetOpenaiQuota } from '../../src/lib/czc/openai-auto-reset.mjs'
import { evaluateOpenAIQuotaGate } from '../../src/lib/pool/openai-quota-policy.mjs'
import { isCodexSlotParked, evaluateCodexQuotaSchedule } from '../../src/lib/pool/codex-slot-pool.mjs'
import { persistCodexUsage, getVm, summarizeVm } from '../../src/lib/vm/vm-registry.mjs'
import {
  queryOpenaiQuota,
  CHATGPT_USAGE_URL,
  CHATGPT_RESET_CREDITS_URL,
  CHATGPT_RESET_CONSUME_URL,
} from '../../src/lib/oauth/openai-quota.mjs'

function writeGptSlot(root, id = 'vm-codex-01', patch = {}) {
  const dir = path.join(root, 'vms', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(root, 'vms', `${id}.json`),
    JSON.stringify({
      id,
      platform: 'openai',
      family: 'codex',
      proxy: { url: 'socks5h://127.0.0.1:1080' },
      schedulable: true,
      status: 'running',
      codex: { has_access: true, has_refresh: true, chatgpt_account_id: 'acc-1', ...patch },
    }),
  )
  fs.writeFileSync(
    path.join(dir, 'codex-credentials.json'),
    JSON.stringify({
      accounts: [{ id: 'codex', access_token: 'at', refresh_token: 'rt', chatgpt_account_id: 'acc-1' }],
    }),
  )
}

function exhaustedExtra(now) {
  return {
    codex_5h_used_percent: 100,
    codex_5h_window_minutes: 300,
    codex_5h_reset_at: new Date(now + 60_000).toISOString(),
    codex_7d_used_percent: 10,
    codex_7d_window_minutes: 10080,
    codex_7d_reset_at: new Date(now + 86_400_000).toISOString(),
  }
}

function usagePayload({ used = 100, credits = null, coupons = 1 } = {}) {
  return {
    credits,
    rate_limit: {
      primary_window: {
        used_percent: used,
        limit_window_seconds: 18000,
        reset_after_seconds: 60,
        reset_at: 1_800_000_000,
      },
      secondary_window: {
        used_percent: 10,
        limit_window_seconds: 604800,
        reset_after_seconds: 120,
        reset_at: 1_800_100_000,
      },
    },
    rate_limit_reset_credits: {
      available_count: coupons,
      credits: coupons ? [{ expires_at: '2026-07-04T04:05:06Z' }] : [],
    },
  }
}

function fetchUsage(payload, { consume = 0 } = {}) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' })
    if (String(url) === CHATGPT_RESET_CONSUME_URL) {
      consume += 1
      return { status: 200, json: async () => ({ code: 'ok', windows_reset: 2 }) }
    }
    if (String(url).startsWith(CHATGPT_USAGE_URL)) {
      const used = consume > 0 ? 0 : payload.rate_limit.primary_window.used_percent
      const coupons = consume > 0 ? 0 : payload.rate_limit_reset_credits.available_count
      return {
        status: 200,
        json: async () => ({
          ...payload,
          rate_limit: {
            ...payload.rate_limit,
            primary_window: { ...payload.rate_limit.primary_window, used_percent: used },
          },
          rate_limit_reset_credits: {
            available_count: coupons,
            credits: coupons ? payload.rate_limit_reset_credits.credits : [],
          },
        }),
      }
    }
    if (String(url).startsWith(CHATGPT_RESET_CREDITS_URL)) {
      const coupons = consume > 0 ? 0 : payload.rate_limit_reset_credits.available_count
      return {
        status: 200,
        json: async () => (coupons ? payload.rate_limit_reset_credits.credits : []),
      }
    }
    throw new Error(`unexpected ${url}`)
  }
  impl.calls = calls
  return impl
}

test('parseOpenaiCredits keeps decimal strings and treats absent as null', () => {
  assert.deepEqual(parseOpenaiCredits({ has_credits: true, unlimited: false, balance: '12345678901234567890.0123' }), {
    has_credits: true,
    unlimited: false,
    balance: '12345678901234567890.0123',
  })
  assert.equal(parseOpenaiCredits(null), null)
  assert.equal(parseOpenaiCredits({}), null)
  assert.deepEqual(parseOpenaiCredits({ has_credits: false, unlimited: true }), {
    has_credits: false,
    unlimited: true,
    balance: null,
  })
  assert.equal(persistableOpenaiCredits(null, 't').has_credits, null)
})

test('credits enabled skips the 100% hard park and local 1.0 gate', () => {
  const now = Date.parse('2026-10-16T00:00:00.000Z')
  const reset = new Date(now + 60_000).toISOString()
  const vm = {
    openai_credits_enabled: true,
    codex: {
      openai_credits_enabled: true,
      extra: exhaustedExtra(now),
    },
    utilization_5h: 1,
    reset_5h: reset,
    codex_usage: { windows: [{ id: '5h', used_percent: 100, reset_at: reset, window_minutes: 300 }] },
  }
  assert.equal(openaiCreditsEnabledOf(vm), true)
  assert.equal(evaluateOpenAIQuotaGate(vm, { limit_5h: 1, limit_7d: 1 }, now).limited, false)
  assert.equal(isCodexSlotParked(vm, now), false)
  assert.equal(evaluateCodexQuotaSchedule(vm, now).action, 'keep')
})

test('credits enabled still honors a local limit below 100%', () => {
  const now = Date.parse('2026-10-16T00:00:00.000Z')
  const vm = {
    openai_credits_enabled: true,
    codex: {
      openai_credits_enabled: true,
      extra: {
        codex_5h_used_percent: 85,
        codex_5h_reset_at: new Date(now + 60_000).toISOString(),
      },
    },
  }
  assert.equal(evaluateOpenAIQuotaGate(vm, { limit_5h: 0.8, limit_7d: 1 }, now).reason, 'quota_5h_local')
})

test('persistCodexUsage does not stamp limited_until when credits are enabled', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-credits-park-'))
  writeGptSlot(root, 'vm-codex-01', { openai_credits_enabled: true })
  const now = Date.parse('2026-10-16T00:00:00.000Z')
  persistCodexUsage(root, 'vm-codex-01', {
    now,
    headers: {
      'x-codex-primary-used-percent': '100',
      'x-codex-primary-window-minutes': '300',
      'x-codex-primary-reset-after-seconds': '120',
    },
  })
  const vm = getVm(root, 'vm-codex-01')
  assert.equal(vm.codex.extra.codex_limited_until, undefined)
  fs.rmSync(root, { recursive: true, force: true })
})

test('queryOpenaiQuota persists credits snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-credits-query-'))
  writeGptSlot(root)
  const result = await queryOpenaiQuota({
    projectRoot: root,
    vmId: 'vm-codex-01',
    autoReset: false,
    fetchImpl: fetchUsage(
      usagePayload({
        used: 12,
        credits: { has_credits: true, unlimited: false, balance: '1200.50' },
        coupons: 0,
      }),
    ),
  })
  assert.equal(result.ok, true)
  assert.equal(result.credits.balance, '1200.50')
  const vm = getVm(root, 'vm-codex-01')
  assert.equal(vm.codex.credits.balance, '1200.50')
  const summary = summarizeVm(vm, root)
  assert.equal(summary.credits.balance, '1200.50')
  assert.equal(summary.openai_credits_enabled, false)
  fs.rmSync(root, { recursive: true, force: true })
})

test('applyOpenaiQuotaSettings toggles flags and enabling credits clears auto park', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-credits-set-'))
  const now = Date.parse('2026-10-16T00:00:00.000Z')
  writeGptSlot(root, 'vm-codex-01', {
    extra: { ...exhaustedExtra(now), codex_limited_until: new Date(now + 60_000).toISOString() },
  })
  const enabled = applyOpenaiQuotaSettings(root, 'vm-codex-01', { openai_credits_enabled: true }, { now })
  assert.equal(enabled.ok, true)
  assert.equal(enabled.openai_credits_enabled, true)
  const vm = getVm(root, 'vm-codex-01')
  assert.equal(vm.codex.openai_credits_enabled, true)
  assert.equal(vm.codex.extra.codex_limited_until, undefined)
  const off = applyOpenaiQuotaSettings(root, 'vm-codex-01', { auto_reset_credit_enabled: true }, { now })
  assert.equal(off.auto_reset_credit_enabled, true)
  fs.rmSync(root, { recursive: true, force: true })
})

test('maybeAutoResetOpenaiQuota consumes one coupon when the window is spent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-auto-reset-'))
  const now = Date.parse('2026-10-16T00:00:00.000Z')
  writeGptSlot(root, 'vm-codex-01', {
    auto_reset_credit_enabled: true,
    extra: exhaustedExtra(now),
    reset_credits: { available_count: 1, credits: [{ expires_at: '2026-07-04T04:05:06Z' }] },
  })
  const fetchImpl = fetchUsage(usagePayload({ used: 100, coupons: 1 }))
  const result = await maybeAutoResetOpenaiQuota({
    projectRoot: root,
    vmId: 'vm-codex-01',
    fetchImpl,
    now,
  })
  assert.equal(result.action, 'reset')
  assert.equal(result.windows_reset, 2)
  assert.equal(
    fetchImpl.calls.some((c) => c.url === CHATGPT_RESET_CONSUME_URL),
    true,
  )
  const vm = getVm(root, 'vm-codex-01')
  assert.equal(vm.codex.extra.codex_5h_used_percent, 0)
  assert.equal(vm.codex.auto_reset_credit_state, undefined)
  fs.rmSync(root, { recursive: true, force: true })
})

test('maybeAutoResetOpenaiQuota is a no-op when the switch is off', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-auto-reset-off-'))
  const now = Date.parse('2026-10-16T00:00:00.000Z')
  writeGptSlot(root, 'vm-codex-01', { extra: exhaustedExtra(now) })
  const fetchImpl = fetchUsage(usagePayload({ used: 100, coupons: 1 }))
  const result = await maybeAutoResetOpenaiQuota({
    projectRoot: root,
    vmId: 'vm-codex-01',
    fetchImpl,
    now,
  })
  assert.equal(result.action, 'skip')
  assert.equal(result.reason, 'disabled')
  assert.equal(fetchImpl.calls.length, 0)
  fs.rmSync(root, { recursive: true, force: true })
})

test('queryOpenaiQuota with auto-reset on consumes a coupon at 100%', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-query-auto-'))
  writeGptSlot(root, 'vm-codex-01', { auto_reset_credit_enabled: true })
  const fetchImpl = fetchUsage(usagePayload({ used: 100, coupons: 1 }))
  const result = await queryOpenaiQuota({
    projectRoot: root,
    vmId: 'vm-codex-01',
    fetchImpl,
  })
  assert.equal(result.ok, true)
  assert.equal(result.auto_reset?.action, 'reset')
  assert.equal(result.quota.utilization_5h, 0)
  fs.rmSync(root, { recursive: true, force: true })
})
