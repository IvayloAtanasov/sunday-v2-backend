import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import moment from 'moment-timezone'

import { BG_PRICE, pricesPage, pricesPageWithoutData } from './mock/pricesPage'

// Hoisted so the vi.mock factory below can close over them - vi.mock calls are lifted
// above the imports.
const { upsert, findLatest } = vi.hoisted(() => ({
  upsert: vi.fn(),
  findLatest: vi.fn()
}))

vi.mock('../../_shared/src/dynamodb/spot-price-repository', async importOriginal => {
  const actual = await importOriginal<
    typeof import('../../_shared/src/dynamodb/spot-price-repository')
  >()

  return {
    ...actual,
    SpotPriceRepository: vi.fn(() => ({ upsert, findLatest }))
  }
})

import { daysToCollect, handler } from '../src/index'

// Sofia midnight for the days used below, as unix seconds.
const SOFIA_MIDNIGHT = {
  '2023-06-20': 1687208400,
  '2023-06-23': 1687467600,
  '2023-06-24': 1687554000
}

const storedOn = (day: keyof typeof SOFIA_MIDNIGHT) => ({
  country: 'BG',
  timestamp: SOFIA_MIDNIGHT[day],
  timestampISO: new Date(SOFIA_MIDNIGHT[day] * 1000).toISOString(),
  price: 50
})

const requestedDate = (url: unknown) => String(url).split('date=')[1]

const fetchedDates = () => vi.mocked(fetch).mock.calls.map(([url]) => requestedDate(url))

const upsertedDates = () => upsert.mock.calls.map(([item]) => item.timestampISO)

/** Drives the handler to completion, releasing the inter-day sleeps. */
const runHandler = async () => {
  const promise = handler()
  await vi.runAllTimersAsync()
  return promise
}

describe('handler', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    // 2023-06-25T00:00Z is 03:00 in Sofia, so the target day is the 24th.
    vi.setSystemTime(new Date('2023-06-25T00:00:00Z'))
  })

  beforeEach(() => {
    // The site echoes the requested day back, and the client checks it.
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => ({
      text: async () => pricesPage(requestedDate(url))
    })))
  })

  afterEach(() => {
    upsert.mockClear()
    findLatest.mockReset()
    vi.unstubAllGlobals()
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  describe('when the previous day is the only one missing', () => {
    it('collects just the target day', async () => {
      findLatest.mockResolvedValue(storedOn('2023-06-23'))

      await runHandler()

      expect(fetchedDates()).toEqual(['2023-06-24'])
      expect(upsert).toHaveBeenCalledTimes(1)
      expect(upsert).toHaveBeenCalledWith({
        country: 'BG',
        price: BG_PRICE,
        timestamp: SOFIA_MIDNIGHT['2023-06-24'],
        timestampISO: '2023-06-23T21:00:00.000Z'
      })
    })

    it('does not sleep before the only request', async () => {
      findLatest.mockResolvedValue(storedOn('2023-06-23'))

      // No timer draining - if the handler slept, this would never resolve.
      await handler()

      expect(upsert).toHaveBeenCalledTimes(1)
    })
  })

  describe('when nothing has been stored yet', () => {
    it('collects the target day only', async () => {
      findLatest.mockResolvedValue(undefined)

      await runHandler()

      expect(fetchedDates()).toEqual(['2023-06-24'])
      expect(upsert).toHaveBeenCalledTimes(1)
    })
  })

  describe('when the target day is already stored', () => {
    it('re-collects that day rather than reaching into the future', async () => {
      findLatest.mockResolvedValue(storedOn('2023-06-24'))

      await runHandler()

      expect(fetchedDates()).toEqual(['2023-06-24'])
      expect(upsert).toHaveBeenCalledTimes(1)
    })
  })

  describe('when several days are missing', () => {
    it('fills them forward, oldest first, up to the target day', async () => {
      findLatest.mockResolvedValue(storedOn('2023-06-20'))

      await runHandler()

      expect(fetchedDates()).toEqual([
        '2023-06-21',
        '2023-06-22',
        '2023-06-23',
        '2023-06-24'
      ])
      expect(upsertedDates()).toEqual([
        '2023-06-20T21:00:00.000Z',
        '2023-06-21T21:00:00.000Z',
        '2023-06-22T21:00:00.000Z',
        '2023-06-23T21:00:00.000Z'
      ])
    })

    it('waits between days so the site is not hammered', async () => {
      findLatest.mockResolvedValue(storedOn('2023-06-20'))

      const promise = handler()

      // First day goes out immediately, the rest are behind sleeps.
      await vi.advanceTimersByTimeAsync(0)
      expect(fetch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(3000)
      expect(fetch).toHaveBeenCalledTimes(2)

      await vi.runAllTimersAsync()
      await promise

      expect(fetch).toHaveBeenCalledTimes(4)
    })
  })

  describe('when a day fails', () => {
    it('stops the run instead of working through the remaining days', async () => {
      findLatest.mockResolvedValue(storedOn('2023-06-20'))
      // Second day of four has no published price.
      vi.mocked(fetch).mockImplementationOnce(async (url: unknown) => ({
        text: async () => pricesPage(requestedDate(url))
      }) as never).mockImplementationOnce(async (url: unknown) => ({
        text: async () => pricesPageWithoutData(requestedDate(url))
      }) as never)

      const promise = handler()
      const assertion = expect(promise).rejects.toThrow('Unable to parse price')
      await vi.runAllTimersAsync()
      await assertion

      expect(fetchedDates()).toEqual(['2023-06-21', '2023-06-22'])
      // The first day survives, so the next run resumes from there.
      expect(upsertedDates()).toEqual(['2023-06-20T21:00:00.000Z'])
    })

    it('propagates a write failure', async () => {
      findLatest.mockResolvedValue(storedOn('2023-06-23'))
      upsert.mockRejectedValueOnce(new Error('spot price repository upsert failed'))

      await expect(handler()).rejects.toThrow('spot price repository upsert failed')
    })

    it('propagates a failure to read the last stored day', async () => {
      findLatest.mockRejectedValue(new Error('spot price repository find latest failed'))

      await expect(handler()).rejects.toThrow('spot price repository find latest failed')
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})

describe('daysToCollect', () => {
  const sofia = (date: string) => moment.tz(date, 'YYYY-MM-DD', 'Europe/Sofia').startOf('day')
  const format = (days: moment.Moment[]) => days.map(d => d.format('YYYY-MM-DD'))

  it('returns the target day when nothing is stored', () => {
    expect(format(daysToCollect(undefined, sofia('2023-06-24')))).toEqual(['2023-06-24'])
  })

  it('returns the target day when the store is already level with it', () => {
    expect(format(daysToCollect(sofia('2023-06-24'), sofia('2023-06-24')))).toEqual(['2023-06-24'])
  })

  it('returns the target day when the store is somehow ahead of it', () => {
    expect(format(daysToCollect(sofia('2023-06-25'), sofia('2023-06-24')))).toEqual(['2023-06-24'])
  })

  it('returns the single missing day in the normal case', () => {
    expect(format(daysToCollect(sofia('2023-06-23'), sofia('2023-06-24')))).toEqual(['2023-06-24'])
  })

  it('returns every missing day, oldest first', () => {
    expect(format(daysToCollect(sofia('2023-06-20'), sofia('2023-06-24')))).toEqual([
      '2023-06-21',
      '2023-06-22',
      '2023-06-23',
      '2023-06-24'
    ])
  })

  it('keeps local midnight across a DST change', () => {
    // Sofia moved to EEST on 2023-03-26.
    const days = daysToCollect(sofia('2023-03-24'), sofia('2023-03-27'))

    expect(format(days)).toEqual(['2023-03-25', '2023-03-26', '2023-03-27'])
    expect(days.every(d => d.format('HH:mm') === '00:00')).toBe(true)
  })
})
