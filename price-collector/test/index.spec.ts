import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { june24th as dayResMock } from './mock/apiDayResponse'

// Hoisted so the vi.mock factory below can close over it - vi.mock calls are lifted
// above the imports.
const { upsert } = vi.hoisted(() => ({ upsert: vi.fn() }))

vi.mock('../../_shared/src/dynamodb/spot-price-repository', async importOriginal => {
  const actual = await importOriginal<
    typeof import('../../_shared/src/dynamodb/spot-price-repository')
  >()

  return {
    ...actual,
    SpotPriceRepository: vi.fn(() => ({ upsert }))
  }
})

import { handler } from '../src/index'

describe('handler', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    // 2023-06-25T00:00Z is 03:00 in Sofia, so "yesterday" is the 24th.
    vi.setSystemTime(new Date('2023-06-25T00:00:00Z'))

    vi.stubGlobal('fetch', vi.fn(async () => ({ text: async () => dayResMock })))
  })

  afterEach(() => {
    upsert.mockClear()
    vi.mocked(fetch).mockClear()
  })

  afterAll(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('fetches the previous day from the price site', async () => {
    await handler()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('https://euenergy.live/?date=2023-06-24')
  })

  it('stores the parsed BG price against the start of that day in Sofia', async () => {
    await handler()

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledWith({
      country: 'BG',
      price: 79.09,
      timestamp: 1687554000, // 2023-06-24T00:00+03:00
      timestampISO: '2023-06-23T21:00:00.000Z'
    })
  })

  it('throws when the price cannot be parsed out of the response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ text: async () => '<html></html>' } as never)

    await expect(handler()).rejects.toThrow('Unable to parse price')
    expect(upsert).not.toHaveBeenCalled()
  })
})
