export type OpenaiCreditsSnap = {
  has_credits?: boolean | null
  unlimited?: boolean
  balance?: string | null
  fetched_at?: string
} | null

/** 上游余额是十进制字符串，按字符串四舍五入到整数，避免大数失真。 */
export function roundDecimalString(value: string): string | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim())
  if (!match) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0
      ? String(Math.round(parsed))
      : null
  }
  const integer = match[1].replace(/^0+(?=\d)/, '')
  if (!match[2] || match[2][0] < '5') return integer
  const digits = integer.split('')
  let i = digits.length - 1
  while (i >= 0 && digits[i] === '9') {
    digits[i] = '0'
    i -= 1
  }
  if (i < 0) digits.unshift('1')
  else digits[i] = String(Number(digits[i]) + 1)
  return digits.join('')
}

export function validCreditsBalance(credits: OpenaiCreditsSnap): string | null {
  if (!credits || credits.unlimited || credits.has_credits !== true) return null
  const balance = credits.balance?.trim()
  if (balance && Number.isFinite(Number(balance)) && Number(balance) >= 0)
    return balance
  return null
}

export function formatOpenaiCredits(credits: OpenaiCreditsSnap): string {
  if (!credits || credits.has_credits == null) return '—'
  if (credits.unlimited) return '∞'
  if (!credits.has_credits) return '0'
  const balance = validCreditsBalance(credits)
  if (balance) return roundDecimalString(balance) ?? balance
  return '有'
}
