import { beforeEach, describe, expect, it, vi } from 'vitest'

const getEnergyPrices = vi.fn(async () => [] as any[])
const getPvEnergy = vi.fn(async () => [] as any[])
const getInstallations = vi.fn(async () => [] as any[])

vi.mock('../src/routes/get-energy-prices', () => ({ getEnergyPrices }))
vi.mock('../src/routes/get-pv-energy', () => ({ getPvEnergy }))
vi.mock('../src/routes/get-installations', () => ({ getInstallations }))

const { handler } = await import('../src/index')

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

describe('handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the requested day through to the energy prices route', async () => {
    const day = '2026-09-09T21:00:00.000Z'

    const res = await handler({ path: '/energy-prices', queryStringParameters: { from: day, to: day } })

    expect(res.statusCode).toBe(200)
    expect(getEnergyPrices).toHaveBeenCalledWith({ from: new Date(day), to: new Date(day) })
  })

  it('passes the requested day through to the pv metrics route', async () => {
    const day = '2026-09-09T21:00:00.000Z'

    await handler({ path: '/pv-metrics', queryStringParameters: { from: day, to: day } })

    expect(getPvEnergy).toHaveBeenCalledWith({ from: new Date(day), to: new Date(day) })
  })

  it('falls back to a 7 day window when no params are given', async () => {
    await handler({ path: '/pv-metrics', queryStringParameters: null })

    const { from, to } = getPvEnergy.mock.calls[0][0] as unknown as { from: Date, to: Date }
    expect(to.valueOf() - from.valueOf()).toBe(SEVEN_DAYS_MS)
  })

  it('answers 400 rather than 500 for an unparseable date', async () => {
    const res = await handler({ path: '/energy-prices', queryStringParameters: { from: 'yesterday' } })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).message).toMatch(/'from'/)
    expect(getEnergyPrices).not.toHaveBeenCalled()
  })

  it('answers 400 for a range wider than the maximum', async () => {
    const res = await handler({
      path: '/energy-prices',
      queryStringParameters: { from: '2026-01-01T00:00:00.000Z', to: '2026-06-01T00:00:00.000Z' }
    })

    expect(res.statusCode).toBe(400)
    expect(getEnergyPrices).not.toHaveBeenCalled()
  })

  it('answers 500 when a route fails', async () => {
    getPvEnergy.mockRejectedValueOnce(new Error('mongo is down') as never)

    const res = await handler({ path: '/pv-metrics', queryStringParameters: null })

    expect(res.statusCode).toBe(500)
  })

  it('leaves installations without a range', async () => {
    const res = await handler({ path: '/installations', queryStringParameters: null })

    expect(res.statusCode).toBe(200)
    expect(getInstallations).toHaveBeenCalledWith()
  })

  it('404s an unknown path', async () => {
    await expect(handler({ path: '/nope' })).resolves.toMatchObject({ statusCode: 404 })
  })
})
