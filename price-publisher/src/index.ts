import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { ethers } from 'ethers'

import { getSecrets } from '../../_shared/src/secrets'
import { createSigner, sendAndConfirm } from '../../_shared/src/chain/signer'
import { localDateString, startOfLocalDay } from '../../_shared/src/day-key'
import {
  SpotPriceRepository,
  CountriesEnum
} from '../../_shared/src/dynamodb/spot-price-repository'
import energyPriceOracleAbi from '../../_shared/src/contracts/EnergyPriceOracle.json'
import { buildPublishPlan } from './publish-plan'

/**
 * How far back to look for unpublished periods. Matches the vaults' staleness window: a period
 * older than this cannot be rebased against even if its price were published.
 */
const LOOKBACK_DAYS = 7

/** The market key, as the oracle stores it. One market today. */
const COUNTRY = ethers.encodeBytes32String(CountriesEnum.bg)

export const handler = async () => {
  console.log('Triggered price-publisher')

  const secretsClient = new SecretsManagerClient({ region: 'eu-central-1' })
  const {
    RPC_URL,
    ORACLE_PUBLISHER_PRIVATE_KEY,
    PRICE_ORACLE_ADDRESS,
    EXPLORER_URL
  } = await getSecrets(secretsClient)

  if (!PRICE_ORACLE_ADDRESS) {
    throw new Error('PRICE_ORACLE_ADDRESS is not set')
  }

  const signer = createSigner(RPC_URL, ORACLE_PUBLISHER_PRIVATE_KEY)
  const oracle = new ethers.Contract(PRICE_ORACLE_ADDRESS, energyPriceOracleAbi, signer)

  const nowTs = Math.floor(Date.now() / 1000)
  const from = startOfLocalDay(new Date(), LOOKBACK_DAYS)

  const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-central-1' }))
  const prices = await new SpotPriceRepository(db).findBetween(
    CountriesEnum.bg,
    new Date(from * 1000),
    new Date(nowTs * 1000)
  )

  console.log(`Read ${prices.length} stored price(s) from ${localDateString(from)}`)

  // Chain state decides what still needs writing, never a local record: a period that failed to
  // land must not look done on the next run.
  const published = new Set<number>()

  for (const row of prices) {
    const [, isPublished] = await oracle.priceOf(COUNTRY, row.timestamp)

    if (isPublished) {
      published.add(row.timestamp)
    }
  }

  const { publications, skipped } = buildPublishPlan(
    prices,
    periodStart => published.has(periodStart),
    nowTs,
    LOOKBACK_DAYS
  )

  for (const reason of skipped) {
    console.warn(`Skipped ${reason}`)
  }

  if (publications.length === 0) {
    console.log('Every period in the window is already published, nothing to do')
    return
  }

  console.log(
    `Publishing ${publications.length} period(s): ` +
    publications.map(p => `${localDateString(p.periodStart)}=${p.microPerMwh}`).join(', ')
  )

  await sendAndConfirm(
    'publishMany',
    () => oracle.publishMany(
      COUNTRY,
      publications.map(p => p.periodStart),
      publications.map(p => p.microPerMwh)
    ),
    EXPLORER_URL
  )

  console.log(`Published ${publications.length} period(s)`)
}
