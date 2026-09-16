import { describe, expect, it } from 'vitest'

import {
  CONFIRMATIONS,
  MAX_BLOCK_SPAN,
  REORG_BUFFER,
  nextRange,
  startBlock
} from '../src/block-range'

const DEPLOY = 1_000

describe('startBlock', () => {
  it('starts at the deploy block on the first run', () => {
    expect(startBlock(DEPLOY)).toBe(DEPLOY)
  })

  it('re-reads a buffer below the cursor, in case the tip moved', () => {
    expect(startBlock(DEPLOY, DEPLOY + 500)).toBe(DEPLOY + 500 + 1 - REORG_BUFFER)
  })

  it('never reads below the deploy block', () => {
    expect(startBlock(DEPLOY, DEPLOY + 2)).toBe(DEPLOY)
  })
})

describe('nextRange', () => {
  it('reads up to the head', () => {
    expect(nextRange(DEPLOY, DEPLOY + 100))
      .toEqual({ fromBlock: DEPLOY, toBlock: DEPLOY + 100 - CONFIRMATIONS })
  })

  it('leaves the last blocks unread until they are confirmed', () => {
    const { toBlock } = nextRange(DEPLOY, DEPLOY + 100)!

    expect(DEPLOY + 100 - toBlock).toBe(CONFIRMATIONS)
  })

  it('caps one window at the provider limit', () => {
    const range = nextRange(DEPLOY, DEPLOY + 10 * MAX_BLOCK_SPAN)!

    expect(range.toBlock - range.fromBlock + 1).toBe(MAX_BLOCK_SPAN)
  })

  it('returns null once everything confirmed has been read', () => {
    const head = DEPLOY + 100

    expect(nextRange(head + 1, head + CONFIRMATIONS)).toBeNull()
  })

  it('returns null on a chain younger than the deploy block', () => {
    expect(nextRange(DEPLOY, DEPLOY)).toBeNull()
  })

  // The loop in the handler is this loop. A window that stops advancing hangs the run.
  it('terminates when walked to the head in whole windows', () => {
    const latestBlock = DEPLOY + 2 * MAX_BLOCK_SPAN
    let fromBlock = startBlock(DEPLOY)
    let lastToBlock = 0
    let windows = 0

    for (;;) {
      const range = nextRange(fromBlock, latestBlock)
      if (!range) {
        break
      }

      expect(range.toBlock).toBeGreaterThanOrEqual(range.fromBlock)
      lastToBlock = range.toBlock
      fromBlock = range.toBlock + 1
      windows++

      expect(windows).toBeLessThan(10)
    }

    expect(lastToBlock).toBe(latestBlock - CONFIRMATIONS)
    expect(windows).toBe(2) // a full window, then the remainder up to the head
  })
})
