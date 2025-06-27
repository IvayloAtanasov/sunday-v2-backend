const { ethers } = await import('npm:ethers@6.10.0');
const { isEqual } = await import('npm:date-fns@4.1.0');

// 5% commission for electricity trader, by contract from day ahead market prices
export const BUYER_DISCOUNT_RATE = 0.05;
// 2 EUR commission to cover gas expanses
export const SUNDAY_COMMISSION = 2;
// corporate tax rate (BG)
export const CORPORATE_TAX_RATE = 0.1;
// VAT rate (BG)
export const VAT_RATE = 0.2;

const host = '9xbie8j9f4.execute-api.eu-central-1.amazonaws.com/Stage';

const stationId = args[0];
const vaultAddress = args[1];
const date = new Date(args[2]);

const validateRes = async (res) => {
  if (res.error) {
    console.error(res);
    let messages = [];
    if (res.code) {
      messages.push(res.code);
    }
    if (res.message) {
      messages.push(res.message);
    }
    if (res.response instanceof Response) {
      const body = await res.response.text();
      messages.push(body);
    }
    throw Error(`Request failed: ${messages.join('; ')}`);
  }
};

const fetchEnergyPrices = Functions.makeHttpRequest({
  url: `https://${host}/energy-prices`,
  headers: {
    'Content-Type': 'application/json'
  }
});

const fetchPvMetrics = Functions.makeHttpRequest({
  url: `https://${host}/pv-metrics`,
  headers: {
    'Content-Type': 'application/json'
  }
});

const energyPricesRes = await fetchEnergyPrices;
await validateRes(energyPricesRes);

const pvMetricsRes = await fetchPvMetrics;
await validateRes(pvMetricsRes);

const energyPriceForDate = energyPricesRes.data.find(e => isEqual(date, new Date(e.timestampISO)) && e.country === 'BG');
if (!energyPriceForDate) {
  throw new Error(`No energy price found for ${date.toISOString()}`);
}

const pvMetricsForDate = pvMetricsRes.data.find(m => isEqual(date, new Date(m.date)) && m.stationId === stationId);
if (!pvMetricsForDate) {
  throw new Error(`No energy metrics found for ${date.toISOString()}`);
}

const powerMarketValue = (energyPriceForDate.price / 1000) * pvMetricsForDate.totalProductPower;
const revenue = powerMarketValue * (1 - BUYER_DISCOUNT_RATE);
const taxableRevenue = (revenue / (1 + VAT_RATE)) - SUNDAY_COMMISSION;
let netYield = taxableRevenue;
if (netYield > 0) {
  netYield = taxableRevenue * (1 - CORPORATE_TAX_RATE);
}

// yield is in EUR, convert to wei
netYield = BigInt(Math.round(netYield * 1_000_000));

const abiCoder = ethers.AbiCoder.defaultAbiCoder();
const encoded = abiCoder.encode(
  ['address', 'int256', 'uint64'],
  [vaultAddress, netYield, date.valueOf()]
);

return ethers.getBytes(encoded);
