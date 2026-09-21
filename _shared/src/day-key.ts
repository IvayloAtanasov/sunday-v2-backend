import moment from 'moment-timezone'

/**
 * Every time series in this system is keyed by the **start** of the period it describes, in the
 * installation's local time. The price for 21 September 2026 and the production for 21 September
 * 2026 are both keyed at that day's local midnight, as an epoch second.
 *
 * This matters more than it used to. The contracts join a production reading to its price by
 * equality on that single number, so the two feeds must agree on it exactly. They used to derive
 * it separately, with two different date libraries, which is two chances to drift for no benefit.
 * Both now come through here.
 *
 * A local midnight is not a UTC midnight: Sofia is UTC+2 in winter and UTC+3 in summer, so a key
 * is 22:00 or 21:00 UTC on the previous calendar day. That is correct and intended. The
 * alternative, flooring to the UTC day, is consistent but labels every period as the day before
 * the one it describes.
 *
 * moment-timezone is the one date library in this project, deliberately. The obvious lighter
 * alternative gets the offset wrong on the two days a year the target zone's clocks change,
 * whenever the process timezone is on a different DST schedule — correct under UTC, wrong under
 * Los Angeles, which is the worst shape a bug can have. moment is right under every process
 * timezone tested, and the suite runs under three of them so this cannot quietly regress.
 */
export const STATION_TIMEZONE = 'Europe/Sofia'

/**
 * Every modern UTC offset is a whole number of quarter-hours, so a local midnight in any zone
 * divides by 900 while an arbitrary instant almost never does. The contracts check exactly this
 * and nothing more, since they have no business decomposing a key into a date.
 */
export const PERIOD_KEY_ALIGNMENT = 900

/**
 * The start of a local day, `daysAgo` days back from `instant`.
 *
 * This is the write side: what the collectors bucket to, and therefore what the key *is*. Returned
 * as a moment so that callers already working in moments keep doing so — the point of this module
 * is that the convention lives in one place, not that everything downstream becomes a number.
 */
export const localDayStart = (
  instant: Date | number,
  daysAgo = 0,
  timeZone: string = STATION_TIMEZONE
): moment.Moment => moment(instant).tz(timeZone).subtract(daysAgo, 'd').startOf('day')

/** The same thing as the epoch second the contracts key on. */
export const startOfLocalDay = (
  now: Date,
  daysAgo = 0,
  timeZone: string = STATION_TIMEZONE
): number => localDayStart(now, daysAgo, timeZone).unix()

/**
 * A stored `Date` back to the key the collectors wrote. The read side.
 *
 * Deliberately not a re-bucketing: the stored instant already is the period start, and rounding it
 * again would only be a second chance to disagree with the price feed.
 */
export const dayKeyFromDate = (date: Date): number => Math.floor(date.getTime() / 1000)

/**
 * A period key back to the calendar date it names, as `YYYY-MM-DD` in its own zone.
 *
 * For talking to things that want a date rather than an instant — a price page, a log line. This
 * is the only lossy direction, and the only one that should produce a date string: going the other
 * way, from a date to a key, belongs to `startOfLocalDay`.
 */
export const localDateString = (
  periodStart: number,
  timeZone: string = STATION_TIMEZONE
): string => moment.unix(periodStart).tz(timeZone).format('YYYY-MM-DD')

/** Whether a number is plausibly a period start, by the same rule the contracts apply. */
export const isDayKey = (periodStart: number): boolean =>
  Number.isInteger(periodStart) && periodStart > 0 && periodStart % PERIOD_KEY_ALIGNMENT === 0

/**
 * Throws unless a number is plausibly a period start.
 *
 * For callers where a bad key means stop rather than skip. A caller iterating rows it does not
 * control should use `isDayKey` and drop the row, so that one bad record cannot cost the others.
 */
export const assertDayKey = (periodStart: number, context = 'period key'): void => {
  if (!isDayKey(periodStart)) {
    throw new Error(
      `${context} ${periodStart} is not a period start: expected a positive epoch second ` +
      `aligned to ${PERIOD_KEY_ALIGNMENT}s, which every local midnight is`
    )
  }
}

/** The local-day keys in `[from, to]`, inclusive, oldest first. */
export const localDayKeysBetween = (
  from: number,
  to: number,
  timeZone: string = STATION_TIMEZONE
): number[] => {
  const keys: number[] = []

  const cursor = moment.unix(from).tz(timeZone).startOf('day')
  const last = moment.unix(to).tz(timeZone).startOf('day')

  // Stepping a calendar day at a time rather than adding 86400s, so the days a clock change
  // shortens or lengthens still produce exactly one key each.
  while (cursor.isSameOrBefore(last)) {
    keys.push(cursor.unix())
    cursor.add(1, 'd').startOf('day')
  }

  return keys
}
