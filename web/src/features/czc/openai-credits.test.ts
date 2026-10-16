import { describe, expect, it } from 'vitest'
import {
  formatOpenaiCredits,
  roundDecimalString,
} from '@/features/czc/openai-credits'

describe('roundDecimalString', () => {
  it('rounds half up', () => {
    expect(roundDecimalString('1200.50')).toBe('1201')
  })
  it('carries through nines', () => {
    expect(roundDecimalString('999.999999')).toBe('1000')
  })
  it('keeps integers', () => {
    expect(roundDecimalString('42')).toBe('42')
  })
})

describe('formatOpenaiCredits', () => {
  it('unknown snapshot is a dash', () => {
    expect(formatOpenaiCredits(null)).toBe('—')
    expect(formatOpenaiCredits({ has_credits: null })).toBe('—')
  })
  it('unlimited takes precedence', () => {
    expect(
      formatOpenaiCredits({
        has_credits: false,
        unlimited: true,
        balance: null,
      })
    ).toBe('∞')
  })
  it('zero balance', () => {
    expect(
      formatOpenaiCredits({
        has_credits: false,
        unlimited: false,
        balance: '0',
      })
    ).toBe('0')
  })
  it('hidden balance', () => {
    expect(
      formatOpenaiCredits({
        has_credits: true,
        unlimited: false,
        balance: null,
      })
    ).toBe('有')
  })
  it('rounds displayed balance', () => {
    expect(
      formatOpenaiCredits({
        has_credits: true,
        unlimited: false,
        balance: '1200.50',
      })
    ).toBe('1201')
  })
})
