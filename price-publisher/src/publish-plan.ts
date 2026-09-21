import { isDayKey, localDateString } from '../../_shared/src/day-key'

const SECONDS_PER_DAY = 86_400

/**
 * Shortest a calendar day can be: 23 hours, the length of a spring-forward day. A price is only
 * realized once its period has ended, and the contract refuses one that has not, so a candidate
 * that cannot possibly have finished is dropped here rather than reverting the batch.
 */
const MIN_PERIOD_LENGTH = 23 * 3600

/** A row as the price collector stored it. */
export interface StoredPrice {
  timestamp: number
  price: number
}

/** One period to write on chain. */
export interface PricePublication {
  periodStart: number
  microPerMwh: bigint
}

export interface PublishPlan {
  publications: PricePublication[]
  skipped: string[]
}

/**
 * EUR/MWh as the scrape produced it, to the integer the contract stores.
 *
 * The collector writes at most two decimals, so scaling by 1e6 stays exact in a double well
 * inside its 53 bits. Rounded rather than truncated so a value that arrives as 153.309999 is the
 * 153.31 it was meant to be.
 */
export const toMicroPerMwh = (price: number): bigint => {
  if (!Number.isFinite(price)) {
    throw new Error(`price ${price} is not a finite number`)
  }

  return BigInt(Math.round(price * 1_000_000))
}

/**
 * Which stored periods still need writing, oldest first.
 *
 * Publishing is write-once per market-period, so everything already on chain is filtered out here
 * rather than left to revert the batch. The remaining rejections are all "this could never be
 * accepted": a key that is not a period start, a period still running, or one older than the
 * vaults' staleness window, which no vault could use even if it were published.
 */
export const buildPublishPlan = (
  stored: readonly StoredPrice[],
  isPublished: (periodStart: number) => boolean,
  nowTs: number,
  lookbackDays: number
): PublishPlan => {
  const publications: PricePublication[] = []
  const skipped: string[] = []

  const oldestAllowed = nowTs - lookbackDays * SECONDS_PER_DAY

  const seen = new Set<number>()

  for (const row of [...stored].sort((a, b) => a.timestamp - b.timestamp)) {
    const periodStart = row.timestamp

    if (!isDayKey(periodStart)) {
      skipped.push(`${periodStart}: not a period start`)
      continue
    }

    if (seen.has(periodStart)) {
      continue
    }
    seen.add(periodStart)

    if (periodStart + MIN_PERIOD_LENGTH > nowTs) {
      skipped.push(`${localDateString(periodStart)}: period has not ended`)
      continue
    }

    if (periodStart < oldestAllowed) {
      // Past every vault's staleness window, so nothing could consume it.
      continue
    }

    if (isPublished(periodStart)) {
      continue
    }

    publications.push({ periodStart, microPerMwh: toMicroPerMwh(row.price) })
  }

  return { publications, skipped }
}
