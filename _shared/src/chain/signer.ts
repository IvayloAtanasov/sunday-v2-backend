import { ethers } from 'ethers'

/**
 * The signing wallet the publisher lambdas use.
 *
 * This key can assert two things and nothing else: a realized market price, and a production
 * reading for a registered installation. It cannot state a yield — the premium is computed
 * on-chain from those two inputs — and both are bounded by the contracts. That is the reason a
 * hot key is acceptable here at all, so it is worth keeping true: nothing else should ever be
 * signed with it.
 */
export const createSigner = (rpcUrl: string, privateKey: string): ethers.Wallet => {
  if (!rpcUrl) {
    throw new Error('RPC_URL is not set')
  }

  if (!privateKey) {
    throw new Error('ORACLE_PUBLISHER_PRIVATE_KEY is not set')
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl)

  return new ethers.Wallet(privateKey, provider)
}

/**
 * Sends a transaction and waits for it to be mined, throwing if it reverted.
 *
 * Waiting matters: these lambdas are scheduled, and a run that returns before its transaction
 * lands reports success for something that may still fail. The next run would then see the work
 * as already done off-chain while the chain disagrees.
 */
export const sendAndConfirm = async (
  label: string,
  send: () => Promise<ethers.ContractTransactionResponse>,
  explorerUrl?: string
): Promise<ethers.ContractTransactionReceipt> => {
  const tx = await send()

  console.log(`${label}: sent ${tx.hash}${explorerUrl ? ` ${explorerUrl}/tx/${tx.hash}` : ''}`)

  const receipt = await tx.wait()

  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label}: transaction ${tx.hash} reverted`)
  }

  console.log(`${label}: confirmed in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`)

  return receipt
}
