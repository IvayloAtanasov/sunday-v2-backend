/** Blocks below the head that are not read yet, in case the tip reorganises. */
export const CONFIRMATIONS = 5

/** Blocks below the cursor that a run reads again, for the same reason. */
export const REORG_BUFFER = 20

/** Widest window a `getLogs` call asks for. Most providers refuse much more. */
export const MAX_BLOCK_SPAN = 5_000

export interface BlockRange {
  fromBlock: number
  toBlock: number
}

/**
 * Where a run starts reading.
 *
 * Applied once per run, not once per window: stepping back on every window would keep the
 * last one under the head forever and the run would never finish.
 *
 * An event inside the buffer is upserted onto itself. One a reorg took away stops being
 * re-reported and its record lingers - a stale row in a read model, not a missed rebase,
 * since the vault's own state is what the publisher reads to decide what to report next.
 */
export const startBlock = (deployBlock: number, lastIndexedBlock?: number): number =>
  lastIndexedBlock === undefined
    ? deployBlock
    : Math.max(deployBlock, lastIndexedBlock + 1 - REORG_BUFFER)

/** The next window to read from `fromBlock`, or null once nothing confirmed is left. */
export const nextRange = (fromBlock: number, latestBlock: number): BlockRange | null => {
  const head = latestBlock - CONFIRMATIONS

  if (fromBlock > head) {
    return null
  }

  return { fromBlock, toBlock: Math.min(head, fromBlock + MAX_BLOCK_SPAN - 1) }
}
