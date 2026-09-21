import { describe, expect, it } from 'vitest'

import {
  PHASE_ACCRUING,
  StationDay,
  VaultState,
  buildUpdates,
  toMilliKwh
} from '../src/build-updates'

const DAY = 86_400

/** 2023-11-15 00:00 in Sofia, and the two days after it. Real period keys. */
const DAY_1 = 1_699_999_200
const DAY_2 = DAY_1 + DAY
const DAY_3 = DAY_1 + 2 * DAY

const NOW = DAY_3 + DAY

const VAULT_A = '0x1111111111111111111111111111111111111111'
const VAULT_B = '0x2222222222222222222222222222222222222222'

const BG = '0x4247000000000000000000000000000000000000000000000000000000000000'

const accruing = (vault: string, stationId: string, lastRebasedAt: number): VaultState => ({
  vault,
  stationId,
  country: BG,
  maxPeriodMilliKwh: 60_000n,
  phase: PHASE_ACCRUING,
  lastRebasedAt: BigInt(lastRebasedAt)
})

const day = (stationId: string, periodStart: number, kWh: number): StationDay => ({
  stationId,
  periodStart,
  energyMilliKwh: toMilliKwh(kWh)
})

const everythingPriced = () => true

describe('toMilliKwh', () => {
  it('scales a two-decimal reading exactly', () => {
    expect(toMilliKwh(30)).toBe(30_000n)
    expect(toMilliKwh(41.27)).toBe(41_270n)
    expect(toMilliKwh(0)).toBe(0n)
  })

  it('refuses readings that cannot be real', () => {
    expect(() => toMilliKwh(NaN)).toThrow(/not a finite number/)
    expect(() => toMilliKwh(-1)).toThrow(/negative/)
  })
})

describe('buildUpdates', () => {
  /**
   * Ascending matters: a vault rejects a period it has already seen, so a newest-first batch
   * would lose every older period.
   */
  it('reports each unreported period, oldest first', () => {
    const { updates } = buildUpdates(
      [accruing(VAULT_A, 'st-1', DAY_1)],
      [day('st-1', DAY_3, 30), day('st-1', DAY_2, 25)],
      everythingPriced,
      NOW,
      7
    )

    expect(updates.map(u => u.periodStart)).toEqual([DAY_2, DAY_3])
  })

  /** The watermark is the vault's, read from chain, so a failed period still looks missing. */
  it('skips a period the vault has already rebased', () => {
    const { updates } = buildUpdates(
      [accruing(VAULT_A, 'st-1', DAY_3)],
      [day('st-1', DAY_2, 25), day('st-1', DAY_3, 30)],
      everythingPriced,
      NOW,
      7
    )

    expect(updates).toEqual([])
  })

  it('skips vaults that are not accruing', () => {
    const { updates, skipped } = buildUpdates(
      [{ ...accruing(VAULT_A, 'st-1', 0), phase: 0 }],
      [day('st-1', DAY_2, 25)],
      everythingPriced,
      NOW,
      7
    )

    expect(updates).toEqual([])
    expect(skipped.join()).toMatch(/not accruing/)
  })

  it('drops periods older than the staleness window the vault would reject', () => {
    const { updates } = buildUpdates(
      [accruing(VAULT_A, 'st-1', 0)],
      [day('st-1', DAY_1 - 30 * DAY, 25), day('st-1', DAY_2, 30)],
      everythingPriced,
      NOW,
      7
    )

    expect(updates.map(u => u.periodStart)).toEqual([DAY_2])
  })

  it('ignores a period in the future', () => {
    const { updates } = buildUpdates(
      [accruing(VAULT_A, 'st-1', 0)],
      [day('st-1', NOW + DAY, 25)],
      everythingPriced,
      NOW,
      7
    )

    expect(updates).toEqual([])
  })

  it('ignores a reading whose timestamp is not a period start', () => {
    const { updates } = buildUpdates(
      [accruing(VAULT_A, 'st-1', 0)],
      [day('st-1', DAY_2 + 137, 25), day('st-1', DAY_3, 30)],
      everythingPriced,
      NOW,
      7
    )

    expect(updates.map(u => u.periodStart)).toEqual([DAY_3])
  })

  /** An unpublished price costs that one vault-period, never the others. */
  it('waits for a price rather than submitting a period that would be refused', () => {
    const priced = (_country: string, periodStart: number) => periodStart !== DAY_3

    const { updates, skipped } = buildUpdates(
      [accruing(VAULT_A, 'st-1', 0), accruing(VAULT_B, 'st-2', 0)],
      [day('st-1', DAY_2, 25), day('st-1', DAY_3, 30), day('st-2', DAY_2, 40)],
      priced,
      NOW,
      7
    )

    expect(updates.map(u => u.periodStart)).toEqual([DAY_2, DAY_2])
    expect(skipped.join()).toMatch(/no price for 2023-11-17/)
  })

  it('matches each vault to its own station', () => {
    const { updates } = buildUpdates(
      [accruing(VAULT_A, 'st-1', 0), accruing(VAULT_B, 'st-2', 0)],
      [day('st-1', DAY_2, 10), day('st-2', DAY_2, 50)],
      everythingPriced,
      NOW,
      7
    )

    const byVault = new Map(updates.map(u => [u.vault, u.energyMilliKwh]))

    expect(byVault.get(VAULT_A)).toBe(10_000n)
    expect(byVault.get(VAULT_B)).toBe(50_000n)
  })

  /**
   * Submitted rather than dropped, so the adapter's refusal is on chain. A reading above what the
   * installation can physically produce is a data fault worth a record, not something to hide.
   */
  it('still submits a reading above the capacity ceiling, and says so', () => {
    const { updates, skipped } = buildUpdates(
      [accruing(VAULT_A, 'st-1', 0)],
      [day('st-1', DAY_2, 999)],
      everythingPriced,
      NOW,
      7
    )

    expect(updates).toHaveLength(1)
    expect(skipped.join()).toMatch(/above its 60000 ceiling/)
  })

  it('keeps every vault ascending when several are reported together', () => {
    const { updates } = buildUpdates(
      [accruing(VAULT_A, 'st-1', 0), accruing(VAULT_B, 'st-2', 0)],
      [
        day('st-1', DAY_3, 30),
        day('st-1', DAY_2, 25),
        day('st-2', DAY_3, 31),
        day('st-2', DAY_2, 26)
      ],
      everythingPriced,
      NOW,
      7
    )

    for (const vault of [VAULT_A, VAULT_B]) {
      const periods = updates.filter(u => u.vault === vault).map(u => u.periodStart)

      expect(periods).toEqual([...periods].sort((a, b) => a - b))
      expect(periods).toEqual([DAY_2, DAY_3])
    }
  })
})
