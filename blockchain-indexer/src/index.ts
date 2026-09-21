import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import * as ethers from 'ethers'

import { getSecrets } from '../../_shared/src/secrets'
import { connectDb } from '../../_shared/src/db'
import { Installation } from '../../_shared/src/models/Installation'
import { PvYield } from '../../_shared/src/models/PvYield'
import { IndexerCursor } from './models/IndexerCursor'
import { nextRange, startBlock } from './block-range'
import { txLink } from './explorer'
import { AdapterEvent, toBulkOps, toYieldRecords } from './yield-events'
import yieldAdapterAbi from '../../_shared/src/contracts/YieldAdapter.json'

const VAULT_ABI = ['function rebaseAdapter() view returns (address)']

const INDEXED_EVENTS = [
  'Rebased',
  'RebaseFailed',
  'UnregisteredVault',
  'PriceMissing',
  'ProductionRejected',
]

/**
 * Reads YieldAdapter events into Mongo.
 *
 * It holds no key and sends no transaction. The yield-publisher is what moves production on
 * chain; this writes down what the chain already said, so the app has something to read that is
 * not an RPC call. If it stops, vaults keep accruing and the records catch up on the next run.
 *
 * The adapters to read are derived from the installations rather than configured. The formula is
 * frozen per adapter, so changing a rate needs a new adapter, and vaults accumulate across
 * adapter generations with each one naming its own in `rebaseAdapter()` - frozen when its funding
 * closed. A configured address would have indexed one generation and silently dropped the rest.
 */
export const handler = async () => {
  const secretsClient = new SecretsManagerClient({ region: 'eu-central-1' })
  const {
    DB_USER,
    DB_PASSWORD,
    DB_NAME,
    RPC_URL,
    FIRST_ADAPTER_DEPLOY_BLOCK,
    EXPLORER_URL,
  } = await getSecrets(secretsClient)

  await connectDb(DB_USER, DB_PASSWORD, DB_NAME)

  const installations = await Installation.find({ vaultAddress: { $nin: [null, ''] } })

  if (installations.length === 0) {
    console.log('No installations with a vault address, nothing to index')
    return
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const adapterInterface = new ethers.Interface(yieldAdapterAbi)
  const topics = [INDEXED_EVENTS.map(name => adapterInterface.getEvent(name)!.topicHash)]

  const stationByVault = new Map<string, string>(
    installations.map(installation => [installation.vaultAddress.toLowerCase(), installation.stationId])
  )

  // Each vault names the adapter it is bound to. Several vaults normally share one.
  const adapters = new Set<string>()

  for (const installation of installations) {
    try {
      const vault = new ethers.Contract(installation.vaultAddress, VAULT_ABI, provider)
      const adapter = await vault.rebaseAdapter()

      if (adapter === ethers.ZeroAddress) {
        console.warn(`${installation.stationId}: vault has no adapter, skipping`)
        continue
      }

      adapters.add(ethers.getAddress(adapter))
    } catch (err) {
      // One unreachable or non-vault address must not cost the other installations their run.
      console.error(`${installation.stationId}: cannot read rebaseAdapter, skipping`, err)
    }
  }

  const latestBlock = await provider.getBlockNumber()

  // Floor for an adapter with no cursor yet. A later adapter generation re-reads from here
  // too, which costs empty getLogs windows but cannot miss anything.
  const deployBlock = Number(FIRST_ADAPTER_DEPLOY_BLOCK)

  console.log(
    `Indexing ${adapters.size} adapter(s) for ${installations.length} installation(s) ` +
    `up to block ${latestBlock}`
  )

  for (const adapterAddress of adapters) {
    const cursor = await IndexerCursor.findOne({ adapterAddress })
    let fromBlock = startBlock(deployBlock, cursor?.lastIndexedBlock)
    let indexed = 0

    // Chunked, and the cursor is saved per chunk: a run that times out mid-catch-up keeps
    // the ground it covered instead of starting over.
    for (;;) {
      const range = nextRange(fromBlock, latestBlock)
      if (!range) {
        break
      }

      const logs = await provider.getLogs({
        address: adapterAddress,
        topics,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
      })

      const events: AdapterEvent[] = logs.map(log => {
        const parsed = adapterInterface.parseLog(log)!
        const has = (field: string) => parsed.fragment.inputs.some(input => input.name === field)

        return {
          name: parsed.name,
          vault: parsed.args.vault,
          periodStart: parsed.args.periodStart,
          delta: has('delta') ? parsed.args.delta : undefined,
          energyMilliKwh: has('energyMilliKwh') ? parsed.args.energyMilliKwh : undefined,
          priceMicroPerMwh: has('priceMicroPerMwh') ? parsed.args.priceMicroPerMwh : undefined,
          reason: has('reason') ? parsed.args.reason : undefined,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          logIndex: log.index,
        }
      })

      // Every event the adapter emitted, not only the vaults in Mongo: a vault whose
      // installation record is missing is still recorded, just without a station.
      const records = toYieldRecords(events, stationByVault)

      if (records.length > 0) {
        // Ordered, so a day reported twice ends up with its latest outcome.
        await PvYield.bulkWrite(toBulkOps(records), { ordered: true })
        indexed += records.length

        for (const record of records) {
          console.log(
            `${record.status} ${record.vaultAddress} ${record.timestamp.toISOString()} ` +
            `delta=${record.valueDelta ?? '-'} ` +
            `${txLink(EXPLORER_URL, record.transactionHash) ?? record.transactionHash}`
          )
        }
      }

      await IndexerCursor.findOneAndUpdate(
        { adapterAddress },
        { adapterAddress, lastIndexedBlock: range.toBlock },
        { upsert: true }
      )

      fromBlock = range.toBlock + 1
    }

    console.log(`${adapterAddress}: indexed ${indexed} event(s) up to block ${fromBlock - 1}`)
  }
}
