import { JSDOM } from 'jsdom'
import moment from 'moment'

const BG_ZONE = 'BG'

export class ApiClient {
  private readonly baseUrl = 'https://euenergy.live'

  async fetchDayPrice(day: moment.Moment): Promise<number> {
    const date = day.format('YYYY-MM-DD')

    const res = await fetch(`${this.baseUrl}/?date=${date}`)
      .then(res => res.text())

    const dom = new JSDOM(res)
    const document = dom.window.document

    // The page echoes back the day it rendered. A date it cannot serve still returns
    // a full table, so check this before trusting any number on the page.
    const rendered = document.querySelector('input[name="date"]')?.getAttribute('value')
    if (rendered && rendered !== date) {
      console.error(`html parse error: asked for ${date}, page rendered ${rendered}`)
      throw new Error('Unable to parse price')
    }

    // Row shape: <tr><td><a><span class="zone-pill">BG</span></a></td>…<td class="price">€ 153.31</td></tr>
    const zone = Array.from(document.querySelectorAll('.prices_table .zone-pill'))
      .find(pill => pill.textContent?.trim() === BG_ZONE)

    const priceContent = zone?.closest('tr')?.querySelector('.price')?.textContent?.trim()

    if (!priceContent) {
      console.error(`html parse error: no price cell for zone ${BG_ZONE}`)
      throw new Error('Unable to parse price')
    }

    // "€ 153.31" on a normal day, "—" when the exchanges have not published yet.
    const price = parseFloat(priceContent.replace(/[^\d.-]/g, ''))

    if (!Number.isFinite(price)) {
      console.error(`html parse error: unusable price "${priceContent}" for zone ${BG_ZONE}`)
      throw new Error('Unable to parse price')
    }

    return price
  }
}

export default ApiClient
