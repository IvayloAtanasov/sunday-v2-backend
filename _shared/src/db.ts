import mongoose from 'mongoose'

export const connectDb = async (
  user: string,
  password: string,
  clusterName: string
): Promise<void> => {
  try {
    const dbName = clusterName
    const uri = `mongodb+srv://${user}:${password}@${clusterName}.eubbggs.mongodb.net/${dbName}/?retryWrites=true&w=majority&appName=${dbName}`
    await mongoose.connect(uri)
    console.log('MongoDB connected')
  } catch (err) {
    console.error('MongoDB connection error:', err)
    throw err
  }
}
