import mongoose, { Document, Schema } from 'mongoose'

export interface IInstallation extends Document {
  stationId: string;
  tokenId: number;
  vaultAddress: string;
  timezone: string;
  imageUrl: string;
}

const InstallationSchema = new Schema<IInstallation>(
  {
    stationId: { type: String },
    tokenId: { type: Number },
    vaultAddress: { type: String },
    timezone: { type: String },
    imageUrl: { type: String }
  }
)

export const Installation = mongoose.model<IInstallation>('Installation', InstallationSchema)
