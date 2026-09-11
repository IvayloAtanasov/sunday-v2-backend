export const MAX_RANGE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000
export const MAX_RANGE_MS = MAX_RANGE_DAYS * DAY_MS

/** Thrown for caller mistakes the handler turns into a 400 rather than a 500. */
export class BadRequestError extends Error {}

export interface DateRange {
  from: Date
  to: Date
}

export type QueryStringParameters = Record<string, string | undefined> | null | undefined

const parseInstant = (name: string, value: string | undefined): Date | undefined => {
  if (value === undefined || value === '') {
    return undefined
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    throw new BadRequestError(`Invalid '${name}' date: '${value}'. Expected an ISO 8601 date.`)
  }

  return parsed
}

/**
 * Inclusive instant window to read. Both bounds are optional: whichever is missing
 * is derived so the window is never wider than MAX_RANGE_DAYS, which keeps a single
 * request from reading the whole table. Passing the same value for both reads one point
 * in time - what the chainlink function does when it needs a single day.
 */
export const parseDateRange = (params: QueryStringParameters, now: Date = new Date()): DateRange => {
  const from = parseInstant('from', params?.from)
  const to = parseInstant('to', params?.to)

  if (from && to) {
    if (from.valueOf() > to.valueOf()) {
      throw new BadRequestError(
        `'from' (${from.toISOString()}) is after 'to' (${to.toISOString()}).`
      )
    }

    if (to.valueOf() - from.valueOf() > MAX_RANGE_MS) {
      throw new BadRequestError(
        `Requested range is wider than the ${MAX_RANGE_DAYS} day maximum. ` +
        `Request it in ${MAX_RANGE_DAYS} day windows instead.`
      )
    }

    return { from, to }
  }

  if (from) {
    return { from, to: new Date(from.valueOf() + MAX_RANGE_MS) }
  }

  if (to) {
    return { from: new Date(to.valueOf() - MAX_RANGE_MS), to }
  }

  return { from: new Date(now.valueOf() - MAX_RANGE_MS), to: now }
}
