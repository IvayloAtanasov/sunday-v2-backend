import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { ethers } from 'ethers'

import { getSecrets } from '../../_shared/src/secrets'
import { connectDb } from '../../_shared/src/db'
import { Installation } from '../../_shared/src/models/Installation'
import { PvMetric } from '../../_shared/src/models/PvMetric'
import { createSigner, sendAndConfirm } from '../../_shared/src/chain/signer'
import { dayKeyFromDate, localDateString, startOfLocalDay } from '../../_shared/src/day-key'
import yieldAdapterAbi from '../../_shared/src/contracts/YieldAdapter.json'
import energyPriceOracleAbi from '../../_shared/src/contracts/EnergyPriceOracle.json'
import { StationDay, VaultState, buildUpdates, toMilliKwh } from './build-updates'

/**
 * How far back to look for unreported periods. The vault rejects anything older than its own
 * staleness window, which this matches.
 */
const LOOKBACK_DAYS = 7

/** All this needs from a vault is which adapter it answers to. */
const VAULT_ABI = ['function rebaseAdapter() view returns (address)']

export const handler = async () => {
  console.log('Triggered yield-publisher')

  const secretsClient = new SecretsManagerClient({ region: 'eu-central-1' })
  const {
    DB_USER,
    DB_PASSWORD,
    DB_NAME,
    RPC_URL,
    ORACLE_PUBLISHER_PRIVATE_KEY,
    EXPLORER_URL
  } = await getSecrets(secretsClient)

  await connectDb(DB_USER, DB_PASSWORD, DB_NAME)

  const signer = createSigner(RPC_URL, ORACLE_PUBLISHER_PRIVATE_KEY)

  const installations = await Installation.find({ vaultAddress: { $nin: [null, ''] } })

  if (installations.length === 0) {
    console.log('No installations with a vault address, nothing to report')
    return
  }

  // Adapters are derived per run rather than configured, so vaults left on an older adapter by a
  // formula change keep being reported after a newer one exists.
  const byAdapter = new Map<string, string[]>()

  for (const installation of installations) {
    const vaultAddress = installation.vaultAddress

    try {
      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, signer)
      const adapter: string = await vault.rebaseAdapter()

      if (adapter === ethers.ZeroAddress) {
        console.warn(`Skipped ${vaultAddress}: no adapter bound`)
        continue
      }

      byAdapter.set(adapter, [...(byAdapter.get(adapter) ?? []), vaultAddress])
    } catch (err) {
      // One unreadable vault must not cost the others their run.
      console.error(`Skipped ${vaultAddress}: could not read its adapter`, err)
    }
  }

  const nowTs = Math.floor(Date.now() / 1000)
  const from = startOfLocalDay(new Date(), LOOKBACK_DAYS)

  const metrics = await PvMetric.find({
    date: { $gte: new Date(from * 1000), $lte: new Date(nowTs * 1000) }
  }).sort({ date: 1 })

  const stationDays: StationDay[] = metrics.map(metric => ({
    stationId: metric.stationId,
    periodStart: dayKeyFromDate(metric.date),
    energyMilliKwh: toMilliKwh(metric.totalProductPower)
  }))

  console.log(
    `Read ${stationDays.length} station-period(s) from ${localDateString(from)} ` +
    `across ${byAdapter.size} adapter(s)`
  )

  for (const [adapterAddress, vaults] of byAdapter) {
    await reportAdapter(adapterAddress, vaults, stationDays, signer, nowTs, EXPLORER_URL)
  }
}

const reportAdapter = async (
  adapterAddress: string,
  vaults: string[],
  stationDays: StationDay[],
  signer: ethers.Wallet,
  nowTs: number,
  explorerUrl?: string
) => {
  const adapter = new ethers.Contract(adapterAddress, yieldAdapterAbi, signer)

  const states: VaultState[] = []

  for (const vault of vaults) {
    const state = await adapter.vaultState(vault)

    if (!state.registered) {
      console.warn(`Skipped ${vault}: not registered with adapter ${adapterAddress}`)
      continue
    }

    states.push({
      vault,
      stationId: state.stationId,
      country: state.country,
      maxPeriodMilliKwh: BigInt(state.maxPeriodMilliKwh),
      phase: Number(state.phase),
      lastRebasedAt: BigInt(state.lastRebasedAt)
    })
  }

  if (states.length === 0) {
    console.log(`Adapter ${adapterAddress}: no registered vaults, nothing to report`)
    return
  }

  // Which prices exist is read from the oracle this adapter actually uses, not from a configured
  // address, for the same reason adapters are derived from vaults.
  const priceOracleAddress: string = await adapter.priceOracle()
  const priceOracle = new ethers.Contract(priceOracleAddress, energyPriceOracleAbi, signer)

  const published = new Set<string>()

  for (const country of new Set(states.map(state => state.country))) {
    for (const periodStart of new Set(stationDays.map(day => day.periodStart))) {
      const [, isPublished] = await priceOracle.priceOf(country, periodStart)

      if (isPublished) {
        published.add(`${country}:${periodStart}`)
      }
    }
  }

  const { updates, skipped } = buildUpdates(
    states,
    stationDays,
    (country, periodStart) => published.has(`${country}:${periodStart}`),
    nowTs,
    LOOKBACK_DAYS
  )

  for (const reason of skipped) {
    console.warn(`Skipped ${reason}`)
  }

  if (updates.length === 0) {
    console.log(`Adapter ${adapterAddress}: nothing to report this run`)
    return
  }

  console.log(`Adapter ${adapterAddress}: reporting ${updates.length} vault-period(s)`)

  await sendAndConfirm(
    `submitProduction(${adapterAddress})`,
    () => adapter.submitProduction(
      updates.map(update => [update.vault, update.periodStart, update.energyMilliKwh])
    ),
    explorerUrl
  )
}
