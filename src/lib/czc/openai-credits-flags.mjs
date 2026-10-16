/**
 * GPT 槽点数 / 自动重置券开关与 /wham/usage credits 解析。
 * 无 registry 依赖，供调度闸门和落盘共用。
 */

export function openaiCreditsEnabledOf(vm) {
  return vm?.codex?.openai_credits_enabled === true || vm?.openai_credits_enabled === true
}

export function openaiAutoResetEnabledOf(vm) {
  return vm?.codex?.auto_reset_credit_enabled === true || vm?.auto_reset_credit_enabled === true
}

export function parseOpenaiCredits(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const has = raw.has_credits ?? raw.hasCredits
  const unlimited = raw.unlimited
  if (typeof has !== 'boolean' && typeof unlimited !== 'boolean') return null
  let balance = raw.balance
  if (typeof balance === 'number' && Number.isFinite(balance) && balance >= 0) {
    balance = String(balance)
  } else if (typeof balance === 'string') {
    const text = balance.trim()
    balance = text && Number.isFinite(Number(text)) && Number(text) >= 0 ? text : null
  } else {
    balance = null
  }
  return {
    has_credits: has === true,
    unlimited: unlimited === true,
    balance,
  }
}

export function persistableOpenaiCredits(parsed, fetchedAt = new Date().toISOString()) {
  return {
    has_credits: parsed ? parsed.has_credits : null,
    unlimited: parsed ? parsed.unlimited === true : false,
    balance: parsed?.balance ?? null,
    fetched_at: fetchedAt,
  }
}

export function publicOpenaiQuotaFlags(vm) {
  const credits = vm?.codex?.credits || vm?.credits || null
  return {
    auto_reset_credit_enabled: openaiAutoResetEnabledOf(vm),
    openai_credits_enabled: openaiCreditsEnabledOf(vm),
    credits: credits && typeof credits === 'object' ? credits : null,
  }
}
