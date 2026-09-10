import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import moment from 'moment-timezone'

import { BG_PRICE, pricesPage, pricesPageWithoutData } from './mock/pricesPage'

import { ApiClient } from '../src/api-client'

const day = moment.tz('2026-09-09', 'YYYY-MM-DD', 'Europe/Sofia')

const respondWith = (html: string) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ text: async () => html })))

describe('ApiClient.fetchDayPrice', () => {
  beforeEach(() => {
    respondWith(pricesPage('2026-09-09'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests the day it was given', async () => {
    await new ApiClient().fetchDayPrice(day)

    expect(fetch).toHaveBeenCalledWith('https://euenergy.live/?date=2026-09-09')
  })

  it('returns the Bulgarian price for that day', async () => {
    await expect(new ApiClient().fetchDayPrice(day)).resolves.toBe(BG_PRICE)
  })

  it('throws when the day has no published price', async () => {
    respondWith(pricesPageWithoutData('2026-09-09'))

    await expect(new ApiClient().fetchDayPrice(day)).rejects.toThrow('Unable to parse price')
  })

  it('throws when the page renders a different day than the one requested', async () => {
    respondWith(pricesPage('2026-09-08'))

    await expect(new ApiClient().fetchDayPrice(day)).rejects.toThrow('Unable to parse price')
  })

  it('throws when the price table is missing entirely', async () => {
    respondWith('<html><body><p>Down for maintenance</p></body></html>')

    await expect(new ApiClient().fetchDayPrice(day)).rejects.toThrow('Unable to parse price')
  })

  it('throws rather than returning NaN when the price cell is not a number', async () => {
    respondWith(pricesPage('2026-09-09').replace('€ 153.31', 'n/a'))

    await expect(new ApiClient().fetchDayPrice(day)).rejects.toThrow('Unable to parse price')
  })
})
