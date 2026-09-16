import { describe, expect, it } from 'vitest'

import { txLink } from '../src/explorer'

const HASH = '0xabc123'

describe('txLink', () => {
  it('builds a transaction link', () => {
    expect(txLink('https://testnet.arcscan.app', HASH))
      .toBe(`https://testnet.arcscan.app/tx/${HASH}`)
  })

  it('does not double the slash on a trailing one', () => {
    expect(txLink('https://testnet.arcscan.app/', HASH))
      .toBe(`https://testnet.arcscan.app/tx/${HASH}`)
  })

  it.each([undefined, ''])('returns nothing when the explorer is not configured (%o)', value => {
    expect(txLink(value, HASH)).toBeUndefined()
  })
})
