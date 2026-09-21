import { describe, expect, it } from 'vitest'

import { buildPublishPlan, toMicroPerMwh } from '../src/publish-plan'

const DAY = 86_400

/** 2023-11-15 00:00 in Sofia. A real period key. */
const DAY_1 = 1_699_999_200
const DAY_2 = DAY_1 + DAY
const DAY_3 = DAY_1 + 2 * DAY

/** Well after DAY_3 has ended. */
const NOW = DAY_3 + 2 * DAY

const nothingPublished = () => false

const stored = (timestamp: number, price: number) => ({ timestamp, price })

describe('toMicroPerMwh', () => {
  it('scales a two-decimal price exactly', () => {
    expect(toMicroPerMwh(153.31)).toBe(153_310_000n)
    expect(toMicroPerMwh(0)).toBe(0n)
    expect(toMicroPerMwh(42.125)).toBe(42_125_000n)
  })

  /** Markets settle negative often enough that this is an ordinary case, not an edge one. */
  it('carries a negative price', () => {
    expect(toMicroPerMwh(-40.5)).toBe(-40_500_000n)
  })

  it('rounds rather than truncating a float that arrived slightly short', () => {
    expect(toMicroPerMwh(153.309999999)).toBe(153_310_000n)
  })

  it('refuses a non-finite price rather than writing nonsense on chain', () => {
    expect(() => toMicroPerMwh(NaN)).toThrow(/not a finite number/)
    expect(() => toMicroPerMwh(Infinity)).toThrow(/not a finite number/)
  })
})

describe('buildPublishPlan', () => {
  it('publishes every stored period in the window, oldest first', () => {
    const { publications } = buildPublishPlan(
      [stored(DAY_2, 110), stored(DAY_1, 100), stored(DAY_3, 120)],
      nothingPublished,
      NOW,
      7
    )

    expect(publications).toEqual([
      { periodStart: DAY_1, microPerMwh: 100_000_000n },
      { periodStart: DAY_2, microPerMwh: 110_000_000n },
      { periodStart: DAY_3, microPerMwh: 120_000_000n }
    ])
  })

  /**
   * Publishing is write-once, so a period already on chain must be filtered out here. Leaving it
   * to revert would take the whole batch down with it, including periods that were fine.
   */
  it('skips periods already on chain', () => {
    const { publications } = buildPublishPlan(
      [stored(DAY_1, 100), stored(DAY_2, 110)],
      periodStart => periodStart === DAY_1,
      NOW,
      7
    )

    expect(publications).toEqual([{ periodStart: DAY_2, microPerMwh: 110_000_000n }])
  })

  it('produces nothing when the window is fully published', () => {
    const { publications } = buildPublishPlan(
      [stored(DAY_1, 100), stored(DAY_2, 110)],
      () => true,
      NOW,
      7
    )

    expect(publications).toEqual([])
  })

  /** A price is realized only once its period is over, and the contract enforces the same rule. */
  it('drops a period that has not ended yet', () => {
    const today = NOW - (NOW % 900)

    const { publications, skipped } = buildPublishPlan(
      [stored(DAY_1, 100), stored(today, 130)],
      nothingPublished,
      NOW,
      7
    )

    expect(publications.map(p => p.periodStart)).toEqual([DAY_1])
    expect(skipped.join()).toMatch(/has not ended/)
  })

  it('drops a period no vault could still use', () => {
    const tooOld = DAY_1 - 30 * DAY

    const { publications } = buildPublishPlan(
      [stored(tooOld, 90), stored(DAY_1, 100)],
      nothingPublished,
      NOW,
      7
    )

    expect(publications.map(p => p.periodStart)).toEqual([DAY_1])
  })

  /** A misaligned key could never match a production reading, so it is named rather than sent. */
  it('names a row whose timestamp is not a period start', () => {
    const { publications, skipped } = buildPublishPlan(
      [stored(DAY_1 + 137, 100), stored(DAY_2, 110)],
      nothingPublished,
      NOW,
      7
    )

    expect(publications.map(p => p.periodStart)).toEqual([DAY_2])
    expect(skipped.join()).toMatch(/not a period start/)
  })

  it('writes a duplicated row once', () => {
    const { publications } = buildPublishPlan(
      [stored(DAY_1, 100), stored(DAY_1, 100)],
      nothingPublished,
      NOW,
      7
    )

    expect(publications).toHaveLength(1)
  })

  it('carries a zero and a negative settlement through unchanged', () => {
    const { publications } = buildPublishPlan(
      [stored(DAY_1, 0), stored(DAY_2, -40.5)],
      nothingPublished,
      NOW,
      7
    )

    expect(publications).toEqual([
      { periodStart: DAY_1, microPerMwh: 0n },
      { periodStart: DAY_2, microPerMwh: -40_500_000n }
    ])
  })
})
