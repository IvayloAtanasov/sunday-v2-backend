import { describe, expect, it } from 'vitest'

import { BadRequestError, MAX_RANGE_DAYS, parseDateRange } from '../src/date-range'

const now = new Date('2026-09-11T08:00:00.000Z')
const days = (n: number) => n * 24 * 60 * 60 * 1000

describe('parseDateRange', () => {
  it('defaults to the last 7 days when nothing is passed', () => {
    expect(parseDateRange(undefined, now)).toEqual({
      from: new Date('2026-09-04T08:00:00.000Z'),
      to: now
    })
  })

  it('defaults the same way for an empty query string', () => {
    expect(parseDateRange({}, now)).toEqual(parseDateRange(null, now))
  })

  it('returns a single instant when from and to are equal', () => {
    const day = '2026-09-09T21:00:00.000Z'

    expect(parseDateRange({ from: day, to: day }, now)).toEqual({
      from: new Date(day),
      to: new Date(day)
    })
  })

  it('honours an explicit range inside the maximum', () => {
    expect(parseDateRange({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' }, now))
      .toEqual({
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-09-03T00:00:00.000Z')
      })
  })

  it('allows a range of exactly the maximum', () => {
    const from = new Date('2026-09-01T00:00:00.000Z')
    const to = new Date(from.valueOf() + days(MAX_RANGE_DAYS))

    expect(parseDateRange({ from: from.toISOString(), to: to.toISOString() }, now))
      .toEqual({ from, to })
  })

  it('rejects a range wider than the maximum', () => {
    const from = new Date('2026-09-01T00:00:00.000Z')
    const to = new Date(from.valueOf() + days(MAX_RANGE_DAYS) + 1)

    expect(() => parseDateRange({ from: from.toISOString(), to: to.toISOString() }, now))
      .toThrow(BadRequestError)
  })

  it('derives to from a lone from, capped at the maximum', () => {
    expect(parseDateRange({ from: '2026-09-01T00:00:00.000Z' }, now)).toEqual({
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-08T00:00:00.000Z')
    })
  })

  it('derives from from a lone to, capped at the maximum', () => {
    expect(parseDateRange({ to: '2026-09-08T00:00:00.000Z' }, now)).toEqual({
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-08T00:00:00.000Z')
    })
  })

  it('rejects from after to', () => {
    expect(() => parseDateRange({ from: '2026-09-09T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z' }, now))
      .toThrow(BadRequestError)
  })

  it.each(['not-a-date', '2026-13-45', ''])('ignores or rejects %o rather than returning NaN bounds', (value) => {
    const result = (() => {
      try {
        return parseDateRange({ from: value }, now)
      } catch (err) {
        return err
      }
    })()

    if (result instanceof Error) {
      expect(result).toBeInstanceOf(BadRequestError)
    } else {
      // empty string falls back to the default window
      expect(Number.isNaN((result as any).from.valueOf())).toBe(false)
      expect(Number.isNaN((result as any).to.valueOf())).toBe(false)
    }
  })

  it('reports which parameter was invalid', () => {
    expect(() => parseDateRange({ to: 'rubbish' }, now)).toThrow(/'to'/)
  })
})
