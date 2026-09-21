import { describe, expect, it } from 'vitest'

import { BadRequestError, MAX_RANGE_DAYS, parseDateRange } from '../src/date-range'

const days = (n: number) => n * 24 * 60 * 60 * 1000

describe('parseDateRange', () => {
  it('returns a single instant when from and to are equal', () => {
    const day = '2026-09-09T21:00:00.000Z'

    expect(parseDateRange({ from: day, to: day })).toEqual({
      from: new Date(day),
      to: new Date(day)
    })
  })

  it('honours an explicit range inside the maximum', () => {
    expect(parseDateRange({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' }))
      .toEqual({
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-09-03T00:00:00.000Z')
      })
  })

  it('allows a range of exactly the maximum', () => {
    const from = new Date('2026-09-01T00:00:00.000Z')
    const to = new Date(from.valueOf() + days(MAX_RANGE_DAYS))

    expect(parseDateRange({ from: from.toISOString(), to: to.toISOString() }))
      .toEqual({ from, to })
  })

  it('rejects a range wider than the maximum', () => {
    const from = new Date('2026-09-01T00:00:00.000Z')
    const to = new Date(from.valueOf() + days(MAX_RANGE_DAYS) + 1)

    expect(() => parseDateRange({ from: from.toISOString(), to: to.toISOString() }))
      .toThrow(BadRequestError)
  })

  it('rejects from after to', () => {
    expect(() => parseDateRange({ from: '2026-09-09T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z' }))
      .toThrow(BadRequestError)
  })

  // A window relative to now makes the same request return different rows depending on when it
  // was asked, so a missing bound has to fail rather than be filled in.
  it.each([
    ['neither bound', undefined],
    ['an empty query string', {}],
    ['a lone from', { from: '2026-09-01T00:00:00.000Z' }],
    ['a lone to', { to: '2026-09-08T00:00:00.000Z' }],
    ['an empty bound', { from: '', to: '2026-09-08T00:00:00.000Z' }]
  ])('rejects %s rather than defaulting the window', (_label, params) => {
    expect(() => parseDateRange(params)).toThrow(BadRequestError)
  })

  it.each(['not-a-date', '2026-13-45'])('rejects %o rather than returning NaN bounds', (value) => {
    expect(() => parseDateRange({ from: value, to: value })).toThrow(BadRequestError)
  })

  it('reports which parameter was invalid', () => {
    expect(() => parseDateRange({ from: '2026-09-01T00:00:00.000Z', to: 'rubbish' })).toThrow(/'to'/)
  })

  it('reports which parameter was missing', () => {
    expect(() => parseDateRange({ from: '2026-09-01T00:00:00.000Z' })).toThrow(/'to'/)
  })
})
