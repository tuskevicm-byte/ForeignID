import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {query,pool} from './db.js'

const dir=path.dirname(fileURLToPath(import.meta.url))
const schema=fs.readFileSync(path.join(dir,'schema.sql'),'utf8')
await query(schema)
console.log('Database schema applied')
await pool.end()
