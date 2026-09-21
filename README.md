`sam build --config-env aivo`
`sam deploy --config-file samconfig.toml --no-progressbar --no-fail-on-empty-changeset --no-confirm-changeset --config-env aivo`

## Functions

| Function | Schedule (UTC) | Holds a key | Purpose |
|---|---|---|---|
| `iot-data-collector` | `0 8-10 * * ?` | no | Scrapes FusionSolar into `PvMetric` |
| `price-collector` | `0 8-10 * * ?` | no | Scrapes yesterday's settled price into DynamoDB |
| `price-publisher` | `30 10 * * ?` | **yes** | Writes missing prices to `EnergyPriceOracle` |
| `yield-publisher` | `0 11 * * ?` | **yes** | Submits production to `YieldAdapter`, which prices it on chain |
| `blockchain-indexer` | `0 12 * * ?` | no | Reads `YieldAdapter` events into `PvYield` |
| `api` | — | no | Public reads |

The order across the day is load-bearing: a price has to be on chain before the production for
that period can be priced against it, and the indexer reads back what the publishers did. Running
one early is harmless — it finds nothing to do and the next day catches up, bounded by the vaults'
7 day staleness window.

Only the two publishers sign transactions. That key can assert a realized market price and a
production reading and nothing else: the premium is computed on chain from those two inputs, and
both are bounded there. It cannot state a yield.

## Secrets

All configuration lives in one Secrets Manager entry, `SundaySecretsStore`, as a JSON blob.

| Key | Used by |
|---|---|
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | api, iot-data-collector, blockchain-indexer, yield-publisher |
| `FUSIONSOLAR_USERNAME`, `FUSIONSOLAR_PASSWORD`, `FUSIONSOLAR_STATION` | iot-data-collector |
| `RPC_URL` | blockchain-indexer, both publishers |
| `EXPLORER_URL` | blockchain-indexer, both publishers (log links only) |
| `ORACLE_PUBLISHER_PRIVATE_KEY` | price-publisher, yield-publisher |
| `PRICE_ORACLE_ADDRESS` | price-publisher |
| `FIRST_ADAPTER_DEPLOY_BLOCK` | blockchain-indexer |

`yield-publisher` needs no adapter address: it derives each vault's adapter from
`vault.rebaseAdapter()`, and the price oracle from `adapter.priceOracle()`, so vaults left on an
older adapter by a formula change keep being reported. The indexer derives adapters the same way.

One key currently fills both publisher roles. They are separate roles on chain, so splitting them
into two keys later is a `setPublisher` call on each contract rather than a code change.

## Tests

`npm test` at the root runs every package. `_shared` runs its suite three times, under
`Europe/Sofia`, `UTC` and `America/Los_Angeles`: the period key is the join between the price feed
and the production feed, and a timezone-dependent bug in it would be silent and would cost every
vault the periods it touched.
