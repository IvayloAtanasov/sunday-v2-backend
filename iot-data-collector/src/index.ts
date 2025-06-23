import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { getSecrets } from '../../_shared/src/secrets'
import { connectDb } from '../../_shared/src/db'

const TIMEZONE = 'Europe/Sofia'
const TIMEZONE_OFFSET = '3.0'

export const handler = async () => {
  console.log('IOT data collector started for installation')

  dayjs.extend(utc)
  dayjs.extend(timezone)

  const secretsClient = new SecretsManagerClient({ region: 'eu-central-1' })
  const {
    FUSIONSOLAR_USERNAME,
    FUSIONSOLAR_PASSWORD,
    FUSIONSOLAR_STATION,
    DB_USER,
    DB_PASSWORD,
    DB_NAME,
  } = await getSecrets(secretsClient)

  await connectDb(DB_USER, DB_PASSWORD, DB_NAME)

  const startOfYesterday = dayjs().tz(TIMEZONE).subtract(1, 'day').startOf('day')

  console.log(`Fetching data of ${FUSIONSOLAR_STATION} for ${startOfYesterday.toISOString()}`)

  try {
    const data = await getFusionsolarIOTData(
      FUSIONSOLAR_USERNAME,
      FUSIONSOLAR_PASSWORD,
      FUSIONSOLAR_STATION,
      startOfYesterday
    )
    console.log(JSON.stringify(data, null, 2))
  } catch (err) {
    console.error('Caught error:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    throw err;
  }

}

const getFusionsolarIOTData = async (username: string, password: string, stationCode: string, date: dayjs.Dayjs) => {
  const browser = await puppeteer.launch({
    // args: [
    //   '--start-maximized',
    // ],
    // executablePath: '/usr/bin/google-chrome',
    // defaultViewport: null,
    // headless: false,

    args: chromium.args,
    executablePath: await chromium.executablePath(),
    defaultViewport: chromium.defaultViewport,
    headless: chromium.headless,
  })
  await browser.waitForTarget(t => t.type() === 'page')
  const [page] = await browser.pages()

  await page.goto('https://eu5.fusionsolar.huawei.com', {
    waitUntil: 'networkidle0',
    timeout: 0 // disabled - lambda has it's own timeout
  })
  console.log('Browser page loaded with networkidle0')

  await page.waitForSelector('#username')
  await page.type('#username', username)
  await page.waitForSelector('#value') // password
  await page.type('#value', password)

  await page.waitForSelector('#submitDataverify')

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load' }),
    page.click('#submitDataverify')
  ])

  const response = await page.evaluate(async (stationCode, dateTime, dateStr, timeZoneStr, timeZone) => {
      const params = new URLSearchParams({
        stationDn: stationCode,
        timeDim: '2',
        timeZone,
        timeZoneStr,
        queryTime: dateTime,
        dateStr
      })

      const res = await fetch(`/rest/pvms/web/station/v3/overview/energy-balance?${params.toString()}`)
      return res.json()
    },
    stationCode,
    date.valueOf().toString(),
    date.format('YYYY-MM-DD HH:mm:ss'),
    TIMEZONE,
    TIMEZONE_OFFSET
  )

  return response
}

// TODO: manual trigger
// needed only locally
// handler()
//   .then(() => {
//     console.log('Done')
//   })
//   .catch(err => {
//     console.error(err)
//   })
