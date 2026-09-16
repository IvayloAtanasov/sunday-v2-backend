import mongoose, { Document, Schema } from 'mongoose'

/**
 * How far this indexer has read, per receiver.
 *
 * Losing it costs a re-read of some blocks, not a lost day: the upserts it drives are keyed
 * by vault and day, so reading the same block twice changes nothing. Mongo is no longer the
 * record of what has been reported - the vault's own `lastRebasedAt` is.
 */
export interface IIndexerCursor extends Document {
  receiverAddress: string;
  lastIndexedBlock: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const IndexerCursorSchema = new Schema<IIndexerCursor>(
  {
    receiverAddress: { type: String, required: true, unique: true },
    lastIndexedBlock: { type: Number, required: true },
  },
  {
    timestamps: true,
  }
)

export const IndexerCursor = mongoose.model<IIndexerCursor>('IndexerCursor', IndexerCursorSchema)
