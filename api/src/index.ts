import { getEnergyPrices } from './routes/get-energy-prices'
import { getPvEnergy } from './routes/get-pv-energy'
import { getInstallations } from './routes/get-installations'

exports.handler = async (event: any) => {
  console.log('Incoming event:', JSON.stringify(event))
  const { path } = event

  try {
    if (path === '/energy-prices') {
      const results = await getEnergyPrices()

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

    } else if (path === '/installations') {
      const results = await getInstallations()

      return {
        statusCode: 200,
        body: JSON.stringify(results),
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
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
