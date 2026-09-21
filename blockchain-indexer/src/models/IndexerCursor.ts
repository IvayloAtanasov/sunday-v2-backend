import mongoose, { Document, Schema } from 'mongoose'

/**
 * How far this indexer has read, per adapter.
 *
 * Losing it costs a re-read of some blocks, not a lost period: the upserts it drives are keyed
 * by vault and period, so reading the same block twice changes nothing. Mongo is not the record
 * of what has been reported - the vault's own `lastRebasedAt` is.
 */
export interface IIndexerCursor extends Document {
  adapterAddress: string;
  lastIndexedBlock: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const IndexerCursorSchema = new Schema<IIndexerCursor>(
  {
    adapterAddress: { type: String, required: true, unique: true },
    lastIndexedBlock: { type: Number, required: true },
  },
  {
    timestamps: true,
  }
)

export const IndexerCursor = mongoose.model<IIndexerCursor>('IndexerCursor', IndexerCursorSchema)
