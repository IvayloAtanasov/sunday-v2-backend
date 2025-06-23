import mongoose, { Document, Schema } from 'mongoose'

export interface IPvMetric extends Document {
  stationId: string;
  date: Date;
  totalProductPower: number;
  totalUsePower: number;
  totalSelfUsePower: number;
  selfProvide: number;
  totalOnGridPower: number;
  totalBuyPower: number;
}

export const PvMetricSchema = new Schema<IPvMetric>(
  {
    stationId: { type: String },
    date: { type: Date },
    totalProductPower: { type: Number },
    totalUsePower: { type: Number },
    totalSelfUsePower: { type: Number },
    selfProvide: { type: Number },
    totalOnGridPower: { type: Number },
    totalBuyPower: { type: Number },
  }
)

export const PvMetric = mongoose.model<IPvMetric>('PvMetric', PvMetricSchema)
