import { describe, expect, test } from 'vitest'

import {
  PERIOD_KEY_ALIGNMENT,
  STATION_TIMEZONE,
  assertDayKey,
  dayKeyFromDate,
  isDayKey,
  localDayKeysBetween,
  startOfLocalDay
} from '../src/day-key'

/**
 * Sofia local midnights, one in winter time (UTC+2) and one in summer time (UTC+3). Both are the
 * literal keys the contracts store, so the numbers are spelled out rather than computed.
 */
const WINTER_KEY = 1_699_999_200 // 2023-11-15 00:00 in Sofia = 2023-11-14 22:00Z
const SUMMER_KEY = 1_687_640_400 // 2023-06-25 00:00 in Sofia = 2023-06-24 21:00Z

describe('startOfLocalDay', () => {
  test('buckets to the local midnight, not the UTC one', () => {
    // Mid-afternoon on 2023-11-15 in Sofia.
    expect(startOfLocalDay(new Date('2023-11-15T14:37:11.000Z'))).toBe(WINTER_KEY)

    // The same calendar day, but an instant that is already the previous day in UTC.
    expect(startOfLocalDay(new Date('2023-11-14T23:30:00.000Z'))).toBe(WINTER_KEY)
  })

  test('follows the clock change', () => {
    expect(startOfLocalDay(new Date('2023-06-25T10:00:00.000Z'))).toBe(SUMMER_KEY)

    // Winter is UTC+2 and summer UTC+3, so the two keys sit at different offsets from UTC.
    expect((WINTER_KEY + 86_400) % 86_400).not.toBe((SUMMER_KEY + 86_400) % 86_400)
  })

  test('counts back in calendar days', () => {
    const now = new Date('2023-11-16T09:00:00.000Z')

    expect(startOfLocalDay(now, 1)).toBe(WINTER_KEY)
    expect(startOfLocalDay(now, 0) - startOfLocalDay(now, 1)).toBe(86_400)
  })

  test('honours an explicit timezone', () => {
    const at = new Date('2023-11-15T14:37:11.000Z')

    expect(startOfLocalDay(at, 0, 'UTC')).toBe(1_700_006_400) // 2023-11-15 00:00Z
    expect(startOfLocalDay(at, 0, STATION_TIMEZONE)).toBe(WINTER_KEY)
  })
})

/**
 * The join the whole design rests on. The price feed stores an epoch second and the production
 * feed stores a Date; if those two ever disagree for the same day, every period misses its price
 * and nothing accrues.
 */
describe('both feeds agree on the key', () => {
  test.each([
    ['winter', '2023-11-15T14:37:11.000Z', WINTER_KEY],
    ['summer', '2023-06-25T10:00:00.000Z', SUMMER_KEY],
    ['the day the clocks go forward', '2023-03-26T12:00:00.000Z', 1_679_781_600],
    ['the day the clocks go back', '2023-10-29T12:00:00.000Z', 1_698_526_800]
  ])('%s', (_label, instant, expected) => {
    // What price-collector stores: an epoch second.
    const priceSideKey = startOfLocalDay(new Date(instant))

    // What iot-data-collector stores: a Date, read back by the publisher.
    const productionSideKey = dayKeyFromDate(new Date(priceSideKey * 1000))

    expect(priceSideKey).toBe(expected)
    expect(productionSideKey).toBe(priceSideKey)
    expect(isDayKey(priceSideKey)).toBe(true)
  })
})

describe('isDayKey', () => {
  test('accepts local midnights in either offset', () => {
    expect(isDayKey(WINTER_KEY)).toBe(true)
    expect(isDayKey(SUMMER_KEY)).toBe(true)
  })

  test('rejects anything that is not one', () => {
    expect(isDayKey(WINTER_KEY + 137)).toBe(false)
    expect(isDayKey(0)).toBe(false)
    expect(isDayKey(-WINTER_KEY)).toBe(false)
    expect(isDayKey(WINTER_KEY + 0.5)).toBe(false)
  })

  test('uses the same rule the contracts do', () => {
    expect(WINTER_KEY % PERIOD_KEY_ALIGNMENT).toBe(0)
    expect(SUMMER_KEY % PERIOD_KEY_ALIGNMENT).toBe(0)
  })
})

describe('assertDayKey', () => {
  test('passes a real key and names the bad one', () => {
    expect(() => assertDayKey(WINTER_KEY)).not.toThrow()
    expect(() => assertDayKey(WINTER_KEY + 1, 'price period')).toThrow(/price period 1699999201/)
  })
})

describe('localDayKeysBetween', () => {
  test('is inclusive at both ends and ordered oldest first', () => {
    const keys = localDayKeysBetween(WINTER_KEY, WINTER_KEY + 2 * 86_400)

    expect(keys).toEqual([WINTER_KEY, WINTER_KEY + 86_400, WINTER_KEY + 2 * 86_400])
  })

  test('a single day is one key', () => {
    expect(localDayKeysBetween(WINTER_KEY, WINTER_KEY)).toEqual([WINTER_KEY])
  })

  /**
   * Stepping a calendar day rather than 86400 seconds: the days a clock change shortens or
   * lengthens still produce exactly one key each, and every key is still a local midnight.
   */
  test('produces one key per calendar day across a clock change', () => {
    const before = startOfLocalDay(new Date('2023-10-27T12:00:00.000Z'))
    const after = startOfLocalDay(new Date('2023-10-31T12:00:00.000Z'))

    const keys = localDayKeysBetween(before, after)

    expect(keys).toHaveLength(5)
    expect(keys.every(isDayKey)).toBe(true)
    expect(new Set(keys).size).toBe(5)

    // The long day is 25 hours, so a naive 86400 step would have drifted off midnight here.
    expect(keys).toContain(1_698_526_800) // 2023-10-29 00:00 Sofia, still UTC+3
    expect(keys[keys.length - 1]).toBe(after)
  })
})
