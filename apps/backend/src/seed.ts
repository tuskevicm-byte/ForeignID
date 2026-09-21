import 'dotenv/config'
import {query,pool} from './db.js'
import {hashPassword} from './auth.js'

const run=async()=>{
  const org=await query<{id:string}>('INSERT INTO organizations(name) VALUES($1) RETURNING id',['Demo Organization'])
  const password=await hashPassword('ChangeMe-123!')
  await query(
    'INSERT INTO users(organization_id,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO NOTHING',
    [org.rows[0].id,'admin@example.local',password,'Иван','Иванов','ORG_ADMIN']
  )
  console.log('Seed complete. Demo login: admin@example.local / ChangeMe-123!')
  await pool.end()
}
run().catch(e=>{console.error(e);process.exit(1)})
