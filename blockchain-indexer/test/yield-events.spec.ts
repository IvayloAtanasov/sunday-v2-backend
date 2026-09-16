import { describe, expect, it } from 'vitest'

import { ReceiverEvent, toBulkOps, toYieldRecords } from '../src/yield-events'

const VAULT = '0xAbC0000000000000000000000000000000000001'
const OTHER_VAULT = '0xDeF0000000000000000000000000000000000002'
const DAY = 1_757_970_000 // a Sofia day start, in seconds

const stations = new Map([[VAULT.toLowerCase(), 'SUN-0001']])

const event = (overrides: Partial<ReceiverEvent> = {}): ReceiverEvent => ({
  name: 'Rebased',
  vault: VAULT,
  updatedAt: BigInt(DAY),
  delta: 1_234_567n,
  blockNumber: 500,
  transactionHash: '0xdead',
  logIndex: 0,
  ...overrides,
})

describe('toYieldRecords', () => {
  it('records an applied rebase with its delta and day', () => {
    expect(toYieldRecords([event()], stations)).toEqual([{
      vaultAddress: VAULT,
      stationId: 'SUN-0001',
      timestamp: new Date(DAY * 1000),
      valueDelta: '1234567',
      status: 'applied',
      reason: undefined,
      blockNumber: 500,
      transactionHash: '0xdead',
      logIndex: 0,
    }])
  })

  it('keeps a negative delta signed', () => {
    const [record] = toYieldRecords([event({ delta: -42n })], stations)

    expect(record.valueDelta).toBe('-42')
  })

  it('records a rejected rebase as failed, with the revert data and no delta', () => {
    const [record] = toYieldRecords(
      [event({ name: 'RebaseFailed', delta: undefined, reason: '0x1234abcd' })],
      stations
    )

    expect(record).toMatchObject({ status: 'failed', reason: '0x1234abcd' })
    expect(record.valueDelta).toBeUndefined()
  })

  it('records a skipped vault as unregistered', () => {
    const [record] = toYieldRecords(
      [event({ name: 'UnregisteredVault', delta: undefined })],
      stations
    )

    expect(record.status).toBe('unregistered')
  })

  it('still records a vault the registry does not know, without a station', () => {
    const [record] = toYieldRecords([event({ vault: OTHER_VAULT })], stations)

    expect(record.vaultAddress).toBe(OTHER_VAULT)
    expect(record.stationId).toBeUndefined()
  })

  it('matches the registry whatever case the event address arrives in', () => {
    const [record] = toYieldRecords([event({ vault: VAULT.toLowerCase() })], stations)

    expect(record.stationId).toBe('SUN-0001')
  })

  it('ignores an event it does not index', () => {
    expect(toYieldRecords([event({ name: 'VaultRegistered' })], stations)).toEqual([])
  })

  it('keeps chain order, so a later outcome for a day is written last', () => {
    const records = toYieldRecords([
      event({ name: 'RebaseFailed', delta: undefined, reason: '0xstale', blockNumber: 500 }),
      event({ name: 'Rebased', blockNumber: 900, logIndex: 3 }),
    ], stations)

    expect(records.map(record => record.status)).toEqual(['failed', 'applied'])
  })
})

describe('toBulkOps', () => {
  it('keys the upsert on the vault and the day', () => {
    const [op] = toBulkOps(toYieldRecords([event()], stations))

    expect(op.updateOne.filter).toEqual({
      vaultAddress: VAULT,
      timestamp: new Date(DAY * 1000)
    })
    expect(op.updateOne.upsert).toBe(true)
  })

  it('rewrites one record when the same day is read twice', () => {
    const ops = toBulkOps(toYieldRecords([
      event({ name: 'RebaseFailed', delta: undefined, reason: '0xstale' }),
      event({ blockNumber: 900 }),
    ], stations))

    expect(ops).toHaveLength(2)
    expect(ops[0].updateOne.filter).toEqual(ops[1].updateOne.filter)
  })
})
