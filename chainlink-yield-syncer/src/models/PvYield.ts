import mongoose, { Document, Schema } from 'mongoose'

export interface IPvYield extends Document {
  stationId: string;
  vaultAddress: string,
  valueDelta: string;
  timestamp: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const PvYieldSchema = new Schema<IPvYield>(
  {
    stationId: { type: String },
    vaultAddress: { type: String },
    valueDelta: { type: String }, // must be able to fit int256, thought in reallity it probably won't need to
    timestamp: { type: Date },
  },
  {
    timestamps: true,
  }
)

// Serves both the per-station "last synced day" lookup and the upsert below it,
// which key on the same pair.
PvYieldSchema.index({ stationId: 1, timestamp: -1 })

export const PvYield = mongoose.model<IPvYield>('PvYield', PvYieldSchema)
