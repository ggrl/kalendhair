import express from 'express'
import { Pool } from 'pg'
import { loadConfig } from './config.js'
import { readDay } from './day.js'
import { migrate } from './migrate.js'
import { isSalonDate, todayIn } from '../src/calendar/salon-date.js'

const config = loadConfig(process.env)
const pool = new Pool({ connectionString: config.databaseUrl })

await migrate(pool, (message) => {
  console.log(`migrate: ${message}`)
})

const app = express()

/**
 * The board, for one day. Without a date it answers today in the salon's timezone, so a
 * client never has to ask the device what day it is before it can ask for anything.
 *
 * ADR-0006: this is the only door to the data. No client talks to Postgres.
 */
app.get('/api/day', async (request, response) => {
  const requested = request.query.date

  if (requested !== undefined && typeof requested !== 'string') {
    response.status(400).json({ error: 'date must be a single YYYY-MM-DD value' })
    return
  }

  const date = requested ?? todayIn(config.salonTimeZone, new Date())

  if (!isSalonDate(date)) {
    response.status(400).json({ error: 'date must be a real calendar date as YYYY-MM-DD' })
    return
  }

  response.json(await readDay(pool, date, config.salonTimeZone, new Date()))
})

app.listen(config.port, config.host, () => {
  console.log(`salon calendar api on http://${config.host}:${config.port}`)
  console.log(`salon timezone: ${config.salonTimeZone}`)
  // Loud on purpose. ADR-0004 is marked to be revisited before authentication is
  // written, so nothing here checks who is asking. Loopback is the only thing keeping
  // this private, and that stops being true the moment HOST is changed.
  console.log('WARNING: no authentication yet - do not expose this beyond localhost')
})
