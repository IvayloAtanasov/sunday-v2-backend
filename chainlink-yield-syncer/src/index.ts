import path from 'path'
import fs from 'fs/promises'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { subDays, addDays, startOfDay, isAfter } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import * as ethers from 'ethers'
import * as ethersV5 from 'ethers-v5'
import {
  ResponseListener,
  FulfillmentCode,
} from './lib/@chainlink/functions-toolkit'

import { getSecrets } from '../../_shared/src/secrets'
import { connectDb } from '../../_shared/src/db'
import { Installation, IInstallation } from '../../_shared/src/models/Installation'
import { PvYield } from './models/PvYield'
import chainlinkYieldAdapterAbi from './contracts/ChainlinkYieldAdapter.json'

const buildTimeframeFrom = (from: Date, timezone: string) => {
  const days = []

  let current = startOfDay(toZonedTime(from, timezone))
  const endDate = subDays(new Date(), 1)

  while (!isAfter(current, endDate)) {
    const currentUtc = fromZonedTime(current, timezone)
    days.push(currentUtc)

    current = addDays(current, 1)
  }

  return days
}

const waitForResponse = async (
  rpcUrl: string,
  chainlinkFunctionsRouterAddress: string,
  txHash: string
): Promise<[string, number, Date] | void> => {
  const coder = ethers.AbiCoder.defaultAbiCoder()
  const resTypes = ['address', 'int256', 'uint64']

  const responseListener = new ResponseListener({
    provider: new ethersV5.providers.JsonRpcProvider(rpcUrl),
    functionsRouterAddress: chainlinkFunctionsRouterAddress,
  })

  try {
    const response: any = await new Promise((resolve, reject) => {
      responseListener
        .listenForResponseFromTransaction(txHash)
        .then((response: any) => {
          resolve(response)
        })
        .catch((error: any) => {
          reject(error)
        })
    })

    const fulfillmentCode = response.fulfillmentCode

    if (fulfillmentCode === FulfillmentCode.FULFILLED) {
      console.log(
        `\n✅ Request ${
          response.requestId
        } successfully fulfilled. Cost is ${ethers.formatEther(
          response.totalCostInJuels
        )} LINK.Complete reponse: `,
        response
      )
    } else if (fulfillmentCode === FulfillmentCode.USER_CALLBACK_ERROR) {
      console.log(
        `\n⚠️ Request ${
          response.requestId
        } fulfilled. However, the consumer contract callback failed. Cost is ${ethers.formatEther(
          response.totalCostInJuels
        )} LINK.Complete reponse: `,
        response
      )
    } else {
      console.log(
        `\n❌ Request ${
          response.requestId
        } not fulfilled. Code: ${fulfillmentCode}. Cost is ${ethers.formatEther(
          response.totalCostInJuels
        )} LINK.Complete reponse: `,
        response
      )
    }

    const errorString = response.errorString
    if (errorString) {
      console.log(`\n❌ Error during the execution: `, errorString)
    } else {
      const responseBytesHexstring = response.responseBytesHexstring
      if (ethers.getBytes(responseBytesHexstring).length === 0) {
        console.log(`\n❌ Error during the execution: empty response`)
        return
      }

      const [vaultAddress, deltaBigInt, timestampRaw] = coder.decode(resTypes, responseBytesHexstring)

      // format individual return values
      const delta = parseInt(deltaBigInt.toString(), 10)
      const timestamp = new Date(Number(timestampRaw))
      return [vaultAddress, delta, timestamp]
    }
  } catch (error) {
    console.error("Error listening for response:", error)
  }
}

/**
 * Call manually in AWS with
 * { "maxProcessing": 1 }
 * event in the test editor in order to process the installations one at a time
 */
export const handler = async (event: any) => {
  console.log('Yield syncer started for installation')

  const isScheduled = event.source === 'aws.events'
  let maxProcessing = null

  if (isScheduled) {
    console.log('Scheduled run')
  } else {
    console.log('Manual run')
    maxProcessing = event.maxProcessing
  }

  const secretsClient = new SecretsManagerClient({ region: 'eu-central-1' })
  const {
    DB_USER,
    DB_PASSWORD,
    DB_NAME,
    DEPLOYER_PRIVATE_KEY,
    RPC_URL,
    EXPLORER_URL,
    CHAINLINK_SUBSCRIPTION_CONSUMER_ADDRESS,
    CHAINLINK_SUBSCRIPTION_ID,
    CHAINLINK_FUNCTIONS_DON_ID,
    CHAINLINK_FUNCTIONS_ROUTER_ADDRESS,
  } = await getSecrets(secretsClient)

  await connectDb(DB_USER, DB_PASSWORD, DB_NAME)

  let installations: IInstallation[] = await Installation.find({ })

  if (maxProcessing !== null) {
    installations = installations.slice(0, maxProcessing)
  }

  console.log(`Syncing yield for ${installations.length} installations`)

  // load signer
  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const wallet = new ethers.Wallet(DEPLOYER_PRIVATE_KEY)
  const signer = wallet.connect(provider)

  // load chainlink fn source
  const source = (
    await fs.readFile(path.resolve(__dirname, 'chainlink-functions', 'calculate-installation-yield.deno.js'))
  ).toString('utf-8')

  // sync installations one at a time
  for (const installation of installations) {
    console.log(`Syncer running for ${installation.stationId}; token id ${installation.tokenId}`)

    // build timeframes
    let syncFrom = startOfDay(toZonedTime(subDays(new Date(), 7), installation.timezone))
    const lastPvYield = await PvYield
      .findOne({ stationId: installation.stationId })
      .sort({ timestamp: -1 })
    if (lastPvYield && isAfter(lastPvYield.timestamp, syncFrom)) {
      // start syncing from the day after last sync date
      syncFrom = addDays(lastPvYield.timestamp, 1)
    }

    const days = buildTimeframeFrom(syncFrom, installation.timezone)

    console.log(`Starts syncing for [${days.map(d => d.toISOString()).join(', ')}]`)

    // sync installation daily yield for the past missing 7 days (max)
    for (const day of days) {
      const args = [
        installation.stationId,
        installation.vaultAddress,
        day.toISOString()
      ]

      console.log(`Syncer request for installation ${args[0]}, date ${args[2]}`)

      // request installation yield through call to adapter contract
      // Note: DON will execute fn script 3 times in order to come up with response consensus
      const chainlinkYieldAdapter = new ethers.Contract(
        CHAINLINK_SUBSCRIPTION_CONSUMER_ADDRESS,
        chainlinkYieldAdapterAbi,
        signer
      )
      const gasLimit = 600_000
      const chainlinkFunctionGasLimit = 300_000 // max
      const transaction = await chainlinkYieldAdapter.sendRequest(
        source, // code to be executed in DON Deno
        '0x', // user hosted secrets urls, none in this case
        0, // don hosted secrets - slot ID - empty in this example
        0, // don hosted secrets - version - empty in this example
        args,
        [], // bytesArgs - arguments can be encoded off-chain to bytes.
        CHAINLINK_SUBSCRIPTION_ID,
        chainlinkFunctionGasLimit,
        ethersV5.utils.formatBytes32String(CHAINLINK_FUNCTIONS_DON_ID), // jobId is bytes32 representation of donId
        { gasLimit }
      )

      console.log(
        `\n✅ Functions request sent! Transaction hash ${transaction.hash}. Waiting for a response...`
      )
      console.log(
        `See your request in the explorer ${EXPLORER_URL}/tx/${transaction.hash}`
      )

      const chainlinkRes = await waitForResponse(RPC_URL, CHAINLINK_FUNCTIONS_ROUTER_ADDRESS, transaction.hash)
      if (chainlinkRes) {
        const [vaultAddress, delta, timestamp] = chainlinkRes
        console.log(`✅ Decoded response - vault: ${vaultAddress}; delta: ${delta}; timestamp: ${timestamp.toISOString()}`)

        await PvYield.findOneAndUpdate(
          {
            stationId: installation.stationId,
            timestamp,
          },
          {
            stationId: installation.stationId,
            vaultAddress,
            valueDelta: delta.toString(),
            timestamp,
          },
          {
            upsert: true,
            new: true
          }
        )

        console.log(`✅ Installation pv yield updated`)
      } else {
        console.log('No response received')
      }
    }
  }
}
