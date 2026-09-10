import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import moment from 'moment-timezone'
import { ApiClient } from './api-client'
import { SpotPriceRepository, CountriesEnum } from '../../_shared/src/dynamodb/spot-price-repository'

export const handler = async () => {
  console.log('Triggered price-collector')

  const day = moment().tz('Europe/Sofia').subtract(1, 'd').startOf('day')

  console.log(`Fetching BG price for ${day.format('YYYY-MM-DD')}`)

  const apiClient = new ApiClient()
  const price = await apiClient.fetchDayPrice(day)

  console.log(`Daily price (EUR/MWh) is`, price)

  const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-central-1' }))
  const dbClient = new SpotPriceRepository(db)

  await dbClient.upsert({
    country: CountriesEnum.bg,
    timestamp: day.unix(),
    timestampISO: day.toISOString(),
    price
  });

  console.log(`Price stored in db`)
}
