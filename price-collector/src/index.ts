import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import moment from 'moment-timezone'
import { ApiClient } from './api-client'
import { SpotPriceRepository, CountriesEnum } from '../../_shared/src/dynamodb/spot-price-repository'

const TIMEZONE = 'Europe/Sofia'

// The site is a free scrape target - don't hammer it while backfilling.
const DELAY_BETWEEN_DAYS_MS = 3000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Days still missing between what is stored and the target day, inclusive.
 * Normally a single day; longer only when previous runs have been failing.
 */
export const daysToCollect = (
  lastStored: moment.Moment | undefined,
  target: moment.Moment
): moment.Moment[] => {
  if (!lastStored || !lastStored.isBefore(target)) {
    return [target]
  }

  const days: moment.Moment[] = []
  const cursor = lastStored.clone().add(1, 'd')

  while (cursor.isSameOrBefore(target)) {
    days.push(cursor.clone())
    cursor.add(1, 'd')
  }

  return days
}

export const handler = async () => {
  console.log('Triggered price-collector')

  const target = moment().tz(TIMEZONE).subtract(1, 'd').startOf('day')

  const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-central-1' }))
  const dbClient = new SpotPriceRepository(db)

  const latest = await dbClient.findLatest(CountriesEnum.bg)
  const lastStored = latest
    ? moment.unix(latest.timestamp).tz(TIMEZONE).startOf('day')
    : undefined

  const days = daysToCollect(lastStored, target)

  console.log(
    `Last stored day is ${lastStored?.format('YYYY-MM-DD') ?? 'none'}, ` +
    `target is ${target.format('YYYY-MM-DD')}: ${days.length} day(s) to collect`
  )

  const apiClient = new ApiClient()
  let stored = 0

  for (const [index, day] of days.entries()) {
    if (index > 0) {
      await sleep(DELAY_BETWEEN_DAYS_MS)
    }

    try {
      console.log(`Fetching BG price for ${day.format('YYYY-MM-DD')}`)

      const price = await apiClient.fetchDayPrice(day)

      console.log(`Daily price (EUR/MWh) is`, price)

      await dbClient.upsert({
        country: CountriesEnum.bg,
        timestamp: day.unix(),
        timestampISO: day.toISOString(),
        price
      })

      stored++

      console.log(`Price stored in db for ${day.format('YYYY-MM-DD')}`)
    } catch (err) {
      // Stop rather than work through the remaining days hitting the same failure.
      // Days already stored stay stored, so the next run resumes from there.
      console.error(
        `Failed on ${day.format('YYYY-MM-DD')} after storing ${stored} day(s), stopping`,
        err
      )
      throw err
    }
  }

  console.log(`Collected ${stored} day(s)`)
}
