import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

export async function getSecrets(client: SecretsManagerClient) {
  try {
    const command = new GetSecretValueCommand({ SecretId: 'SundaySecretsStore' })
    const response = await client.send(command)

    if (response.SecretString) {
      return JSON.parse(response.SecretString)
    }

    throw new Error('SecretString is undefined')
  } catch (error) {
    console.error('Error retrieving secret:', error)
    throw error
  }
}
