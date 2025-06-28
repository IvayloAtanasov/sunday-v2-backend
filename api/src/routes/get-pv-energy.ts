import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'

import { getSecrets } from '../../../_shared/src/secrets'
import { connectDb } from '../../../_shared/src/db'
import { PvMetric } from '../../../_shared/src/models/PvMetric'

export const getPvEnergy = async () => {
  const secretsClient = new SecretsManagerClient({ region: 'eu-central-1' })
  const {
    DB_USER,
    DB_PASSWORD,
    DB_NAME,
  } = await getSecrets(secretsClient)

  await connectDb(DB_USER, DB_PASSWORD, DB_NAME)

  const pvMetrics = await PvMetric.find({})

  return pvMetrics
}
