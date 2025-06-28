import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'

export const getEnergyPrices = async () => {
  const dynamoClient = new DynamoDBClient({ region: 'eu-central-1' })

  try {
    let lastKey: Record<string, any> | undefined
    const all = []

    do {
      const res = await dynamoClient.send(new ScanCommand({
        TableName: 'spot-prices',
        ExclusiveStartKey: lastKey,
      }))
      lastKey = res.LastEvaluatedKey
      if (res.Items) {
        all.push(...res.Items.map((i: any) => unmarshall(i)))
      }
    } while (lastKey)

    return all
  } catch (err) {
    console.error('Dynamo scan failed:', err)
    throw err
  }
}
