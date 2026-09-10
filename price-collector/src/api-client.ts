import { JSDOM } from 'jsdom'
import moment from 'moment'

export class ApiClient {
  private readonly baseUrl = 'https://euenergy.live'

  async fetchDayPrice(day: moment.Moment): Promise<number> {
    const res = await fetch(`${this.baseUrl}/?date=${day.format('YYYY-MM-DD')}`)
      .then(res => res.text())

    const dom = new JSDOM(res)

    let price: number
    try {
      const priceContent = dom.window.document.querySelector('[href="country.php?a2=BG"]').parentNode.parentNode.querySelector('.price').innerHTML
      price = parseFloat(priceContent)
    } catch (err) {
      console.error('html parse error', err)
      throw new Error('Unable to parse price')
    }

    return price
  }
}

export default ApiClient
