/**
 * When a GPT slot hits 100% on 5h/7d and auto_reset_credit_enabled is on,
 * consume one upstream reset coupon. Concurrent hops share one in-flight
 * attempt per slot. A failed / empty attempt cools down so we do not hammer
 * ChatGPT on every parked request.
 */
import { getVm, patchVmRecord } from '../vm/vm-registry.mjs'
import { isCodexVm } from '../vm/vm-kind.mjs'
import { extraToCodexSnapshot, normalizeCodexLimits, codexQuotaPark } from '../protocol/codex-usage.mjs'
import { openaiAutoResetEnabledOf } from './openai-credits-flags.mjs'

export const AUTO_RESET_RETRY_MS = 5 * 60_000
export const AUTO_RESET_FAIL_RETRY_MS = 60_000

const inflight = new Map()

function extraOf(vm) {
  if (vm?.codex?.extra && typeof vm.codex.extra === 'object') return vm.codex.extra
  if (vm?.codex_extra && typeof vm.codex_extra === 'object') return vm.codex_extra
  return {}
}

export function openaiWindowExhausted(vm, now = Date.now()) {
  if (!vm) return false
  const extra = extraOf(vm)
  if (Object.keys(extra).length) {
    return codexQuotaPark({ ...extra, codex_limited_until: null }, now, { creditsEnabled: false }).limited
  }
  const usage = vm.codex_usage?.quota || vm.codex?.usage?.quota || {}
  const u5 = Number(usage.utilization_5h ?? vm.utilization_5h)
  const u7 = Number(usage.utilization_7d ?? vm.utilization_7d)
  const reset5 = Date.parse(usage.reset_5h || vm.reset_5h || '')
  const reset7 = Date.parse(usage.reset_7d || vm.reset_7d || '')
  const live = (used, resetAt) => Number.isFinite(used) && used >= 1 && (!Number.isFinite(resetAt) || resetAt > now)
  return live(u5, reset5) || live(u7, reset7)
}

function exhaustedUntil(vm, now) {
  const extra = extraOf(vm)
  const limits = normalizeCodexLimits(extraToCodexSnapshot(extra))
  const candidates = [limits.reset_5h_at, limits.reset_7d_at, extra.codex_limited_until]
    .map((value) => Date.parse(value || ''))
    .filter((ms) => Number.isFinite(ms) && ms > now)
  return candidates.length ? Math.min(...candidates) : null
}

function writeAutoResetState(projectRoot, vmId, state) {
  patchVmRecord(projectRoot, vmId, (vm) => {
    vm.codex = { ...(vm.codex || {}), auto_reset_credit_state: { ...state } }
    return vm
  })
}

function clearAutoResetState(projectRoot, vmId) {
  patchVmRecord(projectRoot, vmId, (vm) => {
    if (vm.codex && Object.prototype.hasOwnProperty.call(vm.codex, 'auto_reset_credit_state')) {
      delete vm.codex.auto_reset_credit_state
    }
    return vm
  })
}

function availableResetCount(vm, known) {
  const live = Number(known?.available_count)
  if (Number.isFinite(live) && live >= 0) return Math.trunc(live)
  const cached = Number(vm?.codex?.reset_credits?.available_count ?? vm?.reset_credits?.available_count)
  return Number.isFinite(cached) && cached > 0 ? Math.trunc(cached) : 0
}

async function runAutoReset({
  projectRoot,
  vmId,
  fetchImpl,
  policy = null,
  now = Date.now(),
  skipRefresh = false,
  known = null,
} = {}) {
  const vm = getVm(projectRoot, vmId)
  if (!vm || !isCodexVm(vm) || !openaiAutoResetEnabledOf(vm)) {
    return { ok: true, action: 'skip', reason: 'disabled' }
  }
  const retryAt = Date.parse(vm.codex?.auto_reset_credit_state?.next_retry_at || '')
  if (Number.isFinite(retryAt) && retryAt > now) {
    return { ok: true, action: 'skip', reason: 'cooldown' }
  }
  if (!openaiWindowExhausted(vm, now)) {
    return { ok: true, action: 'skip', reason: 'not_exhausted' }
  }

  const { queryOpenaiQuota, resetOpenaiQuota } = await import('../oauth/openai-quota.mjs')
  let snapshot = known
  if (!skipRefresh || !snapshot) {
    const queried = await queryOpenaiQuota({
      projectRoot,
      vmId,
      fetchImpl,
      rotate: true,
      policy,
      autoReset: false,
    })
    if (!queried.ok) {
      writeAutoResetState(projectRoot, vmId, {
        last_error: queried.error || 'query_failed',
        last_attempt_at: new Date(now).toISOString(),
        next_retry_at: new Date(now + AUTO_RESET_FAIL_RETRY_MS).toISOString(),
      })
      return { ok: false, action: 'query_failed', error: queried.error || 'query_failed' }
    }
    snapshot = queried
  }

  const fresh = getVm(projectRoot, vmId)
  if (!openaiWindowExhausted(fresh, Date.now())) {
    clearAutoResetState(projectRoot, vmId)
    return { ok: true, action: 'skip', reason: 'not_exhausted' }
  }

  const available = availableResetCount(fresh, snapshot?.reset_credits)
  if (available < 1) {
    const until = exhaustedUntil(fresh, now) || now + AUTO_RESET_RETRY_MS
    writeAutoResetState(projectRoot, vmId, {
      reason: 'no_credits',
      last_attempt_at: new Date(now).toISOString(),
      next_retry_at: new Date(Math.min(until, now + AUTO_RESET_RETRY_MS)).toISOString(),
    })
    return { ok: true, action: 'skip', reason: 'no_credits' }
  }

  const reset = await resetOpenaiQuota({
    projectRoot,
    vmId,
    fetchImpl,
    rotate: true,
    policy,
    autoReset: false,
  })
  if (!reset.ok) {
    writeAutoResetState(projectRoot, vmId, {
      last_error: reset.error || 'reset_failed',
      last_attempt_at: new Date(now).toISOString(),
      next_retry_at: new Date(now + AUTO_RESET_FAIL_RETRY_MS).toISOString(),
    })
    return { ok: false, action: 'reset_failed', error: reset.error || 'reset_failed' }
  }
  clearAutoResetState(projectRoot, vmId)
  return {
    ok: true,
    action: 'reset',
    windows_reset: reset.windows_reset || 0,
    refreshed: reset,
  }
}

export function maybeAutoResetOpenaiQuota(opts = {}) {
  const key = `${opts.projectRoot || ''}::${opts.vmId || ''}`
  if (!opts.projectRoot || !opts.vmId) {
    return Promise.resolve({ ok: true, action: 'skip', reason: 'disabled' })
  }
  const pending = inflight.get(key)
  if (pending) return pending
  const task = runAutoReset(opts).finally(() => {
    if (inflight.get(key) === task) inflight.delete(key)
  })
  inflight.set(key, task)
  return task
}
