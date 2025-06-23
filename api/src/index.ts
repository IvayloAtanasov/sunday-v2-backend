import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { PvMetric } from '../../_shared/src/models/PvMetric'
import { getSecrets } from '../../_shared/src/secrets'
import { connectDb } from '../../_shared/src/db'

// const dynamo = new DocumentClient()
// const mongoUri = process.env.MONGODB_URI
// let mongoClient = null

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

    } else if (path === '/pv-energy') {
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
  // --- DynamoDB path ---
  // const params = {
  //   TableName: process.env.ENERGY_PRICES_TABLE,
  //   // you can use KeyConditionExpression here, e.g.:
  //   // KeyConditionExpression: 'stationId = :sid',
  //   // ExpressionAttributeValues: { ':sid': 'station-123' }
  // }
  // const result = await dynamo.query(params).promise()
  // return result

  const mesg = 'hold your horses'

  return mesg
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
