import { YieldStatus } from '../../_shared/src/models/PvYield'

/** A YieldReceiver log, already decoded, with the position that makes it unique on chain. */
export interface ReceiverEvent {
  name: string
  vault: string
  /** Day the report was for, as the vault's `updatedAt` - unix seconds. */
  updatedAt: bigint
  /** Rebased only. EURC minor units, signed. */
  delta?: bigint
  /** RebaseFailed only. Raw revert data. */
  reason?: string
  blockNumber: number
  transactionHash: string
  logIndex: number
}

export interface YieldRecord {
  vaultAddress: string
  stationId?: string
  timestamp: Date
  valueDelta?: string
  status: YieldStatus
  reason?: string
  blockNumber: number
  transactionHash: string
  logIndex: number
}

const STATUS_BY_EVENT: Record<string, YieldStatus> = {
  Rebased: 'applied',
  RebaseFailed: 'failed',
  UnregisteredVault: 'unregistered',
}

/**
 * Events to records, in the order the chain emitted them.
 *
 * A vault-day can appear more than once - failed on one run, applied on a later one - and
 * the caller writes them in this order, so the last word the chain had is the one stored.
 *
 * `stationId` comes from the receiver's registry rather than the event, which carries only
 * the vault. An unknown vault still gets a record: the yield is what matters, and a missing
 * station is a registry question to answer separately.
 */
export const toYieldRecords = (
  events: ReceiverEvent[],
  stationByVault: Map<string, string>
): YieldRecord[] =>
  events
    .filter(event => STATUS_BY_EVENT[event.name] !== undefined)
    .map(event => ({
      vaultAddress: event.vault,
      stationId: stationByVault.get(event.vault.toLowerCase()),
      timestamp: new Date(Number(event.updatedAt) * 1000),
      valueDelta: event.delta === undefined ? undefined : event.delta.toString(),
      status: STATUS_BY_EVENT[event.name],
      reason: event.reason,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      logIndex: event.logIndex,
    }))

/** Upserts keyed on the vault and the day, so re-reading a block rewrites rather than duplicates. */
export const toBulkOps = (records: YieldRecord[]) =>
  records.map(record => ({
    updateOne: {
      filter: { vaultAddress: record.vaultAddress, timestamp: record.timestamp },
      update: { $set: record },
      upsert: true,
    }
  }))
