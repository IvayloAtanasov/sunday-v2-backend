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

const parseInstant = (name: string, value: string | undefined): Date => {
  if (value === undefined || value === '') {
    throw new BadRequestError(`Missing '${name}'. Expected an ISO 8601 date.`)
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    throw new BadRequestError(`Invalid '${name}' date: '${value}'. Expected an ISO 8601 date.`)
  }

  return parsed
}

/**
 * Inclusive instant window to read, never wider than MAX_RANGE_DAYS so one request cannot
 * read the whole table. Passing the same value for both reads one point in time.
 *
 * Both bounds are required: a default window relative to now would give each CRE node
 * requesting it a slightly different one, and the workflow run would fail consensus.
 */
export const parseDateRange = (params: QueryStringParameters): DateRange => {
  const from = parseInstant('from', params?.from)
  const to = parseInstant('to', params?.to)

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
