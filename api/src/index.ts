import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { PvMetric } from '../../_shared/src/models/PvMetric'
import { getSecrets } from '../../_shared/src/secrets'
import { connectDb } from '../../_shared/src/db'

exports.handler = async (event: any) => {
  console.log('Incoming event:', JSON.stringify(event))
  const { path } = event

  try {
    if (path === '/energy-prices') {
      const results = await getEnergyprices()

      return {
        statusCode: 200,
        body: JSON.stringify(results),
      }

    } else if (path === '/pv-metrics') {
      const results = await getPvEnergy()

      return {
        statusCode: 200,
        body: JSON.stringify(results),
      }

    } else {
      return { statusCode: 404, body: 'Not Found' }
    }
  } catch (err) {
    console.error('Error handler:', err)
    return {
      statusCode: 500,
      body: 'Internal Server Error',
    }
  }
}

const getEnergyprices = async () => {
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

const getPvEnergy = async () => {
  const secretsClient = new SecretsManagerClient({ region: 'eu-central-1' })
  const {
    DB_USER,
    DB_PASSWORD,
    DB_NAME,
  } = await getSecrets(secretsClient)

  await connectDb(DB_USER, DB_PASSWORD, DB_NAME)

  const pvMetrics = await PvMetric.find({})

  return pvMetrics
}
