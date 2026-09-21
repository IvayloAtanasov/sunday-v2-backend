import { isDayKey, localDateString } from '../../_shared/src/day-key'

const SECONDS_PER_DAY = 86_400

/** `LendingVault.Phase.Accruing`. Only this phase accepts a rebase. */
export const PHASE_ACCRUING = 3

/** One vault's bindings and watermark, as the adapter reports them. */
export interface VaultState {
  vault: string
  stationId: string
  country: string
  maxPeriodMilliKwh: bigint
  phase: number
  lastRebasedAt: bigint
}

/** A production reading, reduced to integers at the edge. */
export interface StationDay {
  stationId: string
  periodStart: number
  energyMilliKwh: bigint
}

/** One vault-period to submit, matching the adapter's `ProductionUpdate`. */
export interface ProductionUpdate {
  vault: string
  periodStart: number
  energyMilliKwh: bigint
}

export interface UpdatePlan {
  updates: ProductionUpdate[]
  skipped: string[]
}

/**
 * kWh as the collector stored it, to the integer the adapter takes.
 *
 * The collector rounds to two decimals, so scaling by 1e3 stays exact in a double. Nothing
 * downstream of here is a float: the adapter does the money in integers, and this is the last
 * point at which a rounding decision is made.
 */
export const toMilliKwh = (kWh: number): bigint => {
  if (!Number.isFinite(kWh)) {
    throw new Error(`production ${kWh} kWh is not a finite number`)
  }

  if (kWh < 0) {
    throw new Error(`production ${kWh} kWh is negative`)
  }

  return BigInt(Math.round(kWh * 1_000))
}

/**
 * Which vault-periods to submit, in the order the adapter must apply them.
 *
 * Ascending `periodStart` per vault is required, not cosmetic: a vault rejects a period it has
 * already seen, so a batch running newest-first would have every older period rejected.
 *
 * The filters below are the vault's own rules, applied here so that a doomed update never costs
 * gas and never muddies the event log. The adapter and the vault re-check all of them — this is
 * an optimisation, not the enforcement.
 */
export const buildUpdates = (
  states: readonly VaultState[],
  stationDays: readonly StationDay[],
  hasPrice: (country: string, periodStart: number) => boolean,
  nowTs: number,
  lookbackDays: number
): UpdatePlan => {
  const updates: ProductionUpdate[] = []
  const skipped: string[] = []

  const oldestAllowed = nowTs - lookbackDays * SECONDS_PER_DAY

  for (const state of states) {
    if (state.phase !== PHASE_ACCRUING) {
      skipped.push(`${state.vault}: phase ${state.phase}, not accruing`)
      continue
    }

    const periods = stationDays
      .filter(day => day.stationId === state.stationId)
      .filter(day => isDayKey(day.periodStart))
      // Already reported. The watermark lives on the vault, never in a database, so a period
      // that failed on chain still looks missing and gets retried.
      .filter(day => BigInt(day.periodStart) > state.lastRebasedAt)
      .filter(day => day.periodStart <= nowTs && day.periodStart >= oldestAllowed)
      .sort((a, b) => a.periodStart - b.periodStart)

    for (const day of periods) {
      if (!hasPrice(state.country, day.periodStart)) {
        // Normally a timing gap rather than a fault: the price has not been published yet. The
        // next run picks it up, while the staleness window lasts.
        skipped.push(`${state.vault}: no price for ${localDateString(day.periodStart)}`)
        continue
      }

      if (day.energyMilliKwh > state.maxPeriodMilliKwh) {
        // Submitted anyway. The adapter refuses it and says so on chain, which is a record worth
        // having: a reading beyond what the installation can physically produce is a data fault,
        // and silently dropping it here would leave nothing to notice.
        skipped.push(
          `${state.vault}: ${localDateString(day.periodStart)} reads ${day.energyMilliKwh} ` +
          `milli-kWh, above its ${state.maxPeriodMilliKwh} ceiling - the adapter will reject it`
        )
      }

      updates.push({
        vault: state.vault,
        periodStart: day.periodStart,
        energyMilliKwh: day.energyMilliKwh
      })
    }
  }

  // Oldest first overall, which keeps each vault's own periods ascending.
  updates.sort((a, b) => a.periodStart - b.periodStart || a.vault.localeCompare(b.vault))

  return { updates, skipped }
}
