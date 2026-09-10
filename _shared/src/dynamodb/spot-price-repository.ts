import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand
} from '@aws-sdk/lib-dynamodb'
import type { ScanCommandInput, PutCommandOutput } from '@aws-sdk/lib-dynamodb'

export enum CountriesEnum {
  bg = 'BG'
}

export interface ISpotPrice {
  country: CountriesEnum,
  timestamp: number // unix
  timestampISO: string,
  price: number
}

export class SpotPriceRepository {
  private readonly tableName = 'spot-prices'

  constructor(private readonly db: DynamoDBDocumentClient) {}

  async* scan(query: Partial<ScanCommandInput>): AsyncGenerator<ISpotPrice[]> {
    let params: ScanCommandInput = {
      ...query,
      TableName: this.tableName,
      ReturnConsumedCapacity: 'TOTAL'
    }

    try {
      while (true) {
        const result = await this.db.send(new ScanCommand(params))

        console.debug(`Fetched batch of ${result.Count} items`, {
          consumedCapacity: result.ConsumedCapacity,
          lastEvaluatedKey: result.LastEvaluatedKey
        })

        yield (result.Items ?? []) as ISpotPrice[]

        if (!result.LastEvaluatedKey) {
          break
        }

        params = {
          ...params,
          ExclusiveStartKey: result.LastEvaluatedKey
        }
      }
    } catch (err) {
      console.error(`Unable to find spot price items`, err)
      throw new Error('spot price repository find failed')
    }
  }

  async upsert(data: ISpotPrice): Promise<PutCommandOutput['Attributes']> {
    try {
      const result = await this.db.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          ...data
        },
        ReturnValues: 'ALL_OLD',
        ReturnConsumedCapacity: 'TOTAL'
      }))

      return result.Attributes || {}
    } catch (err) {
      console.error(`Unable to save spot price`, err)
      throw new Error('spot price repository upsert failed')
    }
  }
}

export default SpotPriceRepository
