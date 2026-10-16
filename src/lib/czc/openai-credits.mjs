/**
 * GPT 槽点数（ChatGPT credits）与开关落盘。
 *
 * 对齐 sub2api：
 *   openai_credits_enabled      — 额度用尽后是否继续调度、由上游扣点数
 *   auto_reset_credit_enabled   — 额度用尽后自动消费一张重置券
 */
import { isCodexVm } from '../vm/vm-kind.mjs'
import { getVm, patchVmRecord, syncCodexQuotaSchedule } from '../vm/vm-registry.mjs'
import { publicOpenaiQuotaFlags } from './openai-credits-flags.mjs'

export {
  openaiCreditsEnabledOf,
  openaiAutoResetEnabledOf,
  parseOpenaiCredits,
  persistableOpenaiCredits,
  publicOpenaiQuotaFlags,
} from './openai-credits-flags.mjs'

function asBool(value, key) {
  if (typeof value !== 'boolean') {
    throw Object.assign(new TypeError(`${key} must be a boolean`), { status: 400, code: 'invalid_settings' })
  }
  return value
}

/**
 * Persist per-slot GPT quota switches. Enabling credits drops the auto 100%
 * park so the next schedule pass can admit the slot; a live 429 will re-park.
 */
export function applyOpenaiQuotaSettings(projectRoot, vmId, patch = {}, { policy = null, now = Date.now() } = {}) {
  const vm = getVm(projectRoot, vmId)
  if (!vm) return { ok: false, error: 'vm_not_found', message: 'VM not found', status: 404 }
  if (!isCodexVm(vm)) {
    return { ok: false, error: 'not_gpt_slot', message: '只有 GPT 槽支持点数与重置券开关', status: 400 }
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'invalid_settings', message: '需要一个开关对象', status: 400 }
  }

  const next = {}
  try {
    if (Object.prototype.hasOwnProperty.call(patch, 'auto_reset_credit_enabled')) {
      next.auto_reset_credit_enabled = asBool(patch.auto_reset_credit_enabled, 'auto_reset_credit_enabled')
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'openai_credits_enabled')) {
      next.openai_credits_enabled = asBool(patch.openai_credits_enabled, 'openai_credits_enabled')
    }
  } catch (err) {
    return {
      ok: false,
      error: err.code || 'invalid_settings',
      message: err.message || '开关必须是布尔值',
      status: err.status || 400,
    }
  }
  if (!Object.keys(next).length) {
    return { ok: false, error: 'invalid_settings', message: '需要至少一个开关', status: 400 }
  }

  const written = patchVmRecord(projectRoot, vmId, (current) => {
    current.codex = { ...(current.codex || {}), ...next }
    if (next.auto_reset_credit_enabled === true) delete current.codex.auto_reset_credit_state
    if (next.openai_credits_enabled === true && current.codex.extra && typeof current.codex.extra === 'object') {
      const extra = { ...current.codex.extra }
      delete extra.codex_limited_until
      current.codex.extra = extra
    }
    return current
  })
  syncCodexQuotaSchedule(projectRoot, written || getVm(projectRoot, vmId), { now, policy })
  const fresh = getVm(projectRoot, vmId)
  return {
    ok: true,
    vm_id: vmId,
    ...publicOpenaiQuotaFlags(fresh),
    reset_credits: fresh?.codex?.reset_credits || null,
    auto_reset_armed: next.auto_reset_credit_enabled === true,
  }
}
