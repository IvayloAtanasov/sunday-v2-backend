import { getEnergyPrices } from './routes/get-energy-prices'
import { getPvEnergy } from './routes/get-pv-energy'
import { getInstallations } from './routes/get-installations'
import { BadRequestError, parseDateRange } from './date-range'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const handler = async (event: any) => {
  console.log('Incoming event:', JSON.stringify(event))
  const { path, queryStringParameters } = event

  try {
    if (path === '/energy-prices') {
      const range = parseDateRange(queryStringParameters)
      const results = await getEnergyPrices(range)

      return {
        statusCode: 200,
        body: JSON.stringify(results),
      }

    } else if (path === '/pv-metrics') {
      const range = parseDateRange(queryStringParameters)
      const results = await getPvEnergy(range)

      return {
        statusCode: 200,
        body: JSON.stringify(results),
      }

    } else if (path === '/installations') {
      const results = await getInstallations()

      return {
        statusCode: 200,
        body: JSON.stringify(results),
        headers: corsHeaders,
      }

    } else {
      return { statusCode: 404, body: 'Not Found' }
    }
  } catch (err) {
    if (err instanceof BadRequestError) {
      console.warn('Bad request:', err.message)
      return {
        statusCode: 400,
        body: JSON.stringify({ message: err.message }),
      }
    }

    console.error('Error handler:', err)
    return {
      statusCode: 500,
      body: 'Internal Server Error',
    }
  }
}
