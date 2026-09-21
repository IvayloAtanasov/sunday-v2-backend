import mongoose, { Document, Schema } from 'mongoose'

/**
 * `applied` - the vault accepted the rebase and `owed` moved.
 * `failed` - the vault rejected it: stale, replayed, out of bounds, or past its term.
 * `unregistered` - the adapter had no registration for the vault and skipped it.
 * `price-missing` - no price was published for that period yet, so nothing could be computed.
 * `production-rejected` - the reading was above what the installation can physically produce.
 *
 * Only `applied` moved money. The rest are records of a period that did not accrue, and of why.
 */
export type YieldStatus =
  | 'applied'
  | 'failed'
  | 'unregistered'
  | 'price-missing'
  | 'production-rejected'

/**
 * One reported vault-day, as the chain recorded it.
 *
 * Read-only downstream of the chain: it is written by the indexer from YieldAdapter events
 * and never drives a decision about what to report next. That is `lastRebasedAt` on the vault.
 */
export interface IPvYield extends Document {
  stationId?: string;
  vaultAddress: string;
  valueDelta?: string;
  timestamp: Date;
  status: YieldStatus;
  /**
   * The two inputs the premium was computed from, as the adapter saw them. Kept so a rebase can
   * be recomputed from this record without replaying the chain, and so a wrong figure can be
   * traced to whichever input was wrong.
   */
  energyMilliKwh?: string;
  priceMicroPerMwh?: string;
  /** Raw revert data from the vault, for a failed day. */
  reason?: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const PvYieldSchema = new Schema<IPvYield>(
  {
    stationId: { type: String },
    vaultAddress: { type: String, required: true },
    valueDelta: { type: String }, // must fit int256, though in reality it won't come close
    timestamp: { type: Date, required: true },
    status: {
      type: String,
      required: true,
      enum: ['applied', 'failed', 'unregistered', 'price-missing', 'production-rejected']
    },
    energyMilliKwh: { type: String },
    priceMicroPerMwh: { type: String },
    reason: { type: String },
    blockNumber: { type: Number, required: true },
    transactionHash: { type: String, required: true },
    logIndex: { type: Number, required: true },
  },
  {
    timestamps: true,
  }
)

// The vault and the day it reported are what the events carry and what the upsert keys on,
// so a day that failed and is later reported again replaces its own record instead of adding one.
PvYieldSchema.index({ vaultAddress: 1, timestamp: -1 }, { unique: true })
PvYieldSchema.index({ stationId: 1, timestamp: -1 })

export const PvYield = mongoose.model<IPvYield>('PvYield', PvYieldSchema)
