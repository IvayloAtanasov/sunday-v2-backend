import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

import {
  SpotPriceRepository,
  CountriesEnum,
  ISpotPrice
} from '../../../_shared/src/dynamodb/spot-price-repository'
import { DateRange } from '../date-range'

export const getEnergyPrices = async ({ from, to }: DateRange): Promise<ISpotPrice[]> => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-central-1' }))
  const repository = new SpotPriceRepository(db)

  // One query per partition - cheaper than scanning the table, and there is only
  // a handful of countries.
  const byCountry = await Promise.all(
    Object.values(CountriesEnum).map(country => repository.findBetween(country, from, to))
  )

  return byCountry.flat()
}
