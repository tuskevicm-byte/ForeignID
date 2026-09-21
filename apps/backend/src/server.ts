import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import {query,pool} from './db.js'
import {requireAuth,allow,signToken,verifyPassword,AuthRequest} from './auth.js'

const app=express()
app.use(cors())
app.use(express.json({limit:'2mb'}))

app.get('/api/v1/health',async(_req,res)=>{
  try{await query('SELECT 1');res.json({ok:true,database:'connected'})}
  catch{res.status(503).json({ok:false,database:'unavailable'})}
})

app.post('/api/v1/auth/login',async(req,res)=>{
  const {email,password}=req.body||{}
  if(!email||!password)return res.status(400).json({message:'Email and password are required'})
  const r=await query('SELECT * FROM users WHERE lower(email)=lower($1) AND is_active=true',[email])
  const user=r.rows[0]
  if(!user || !(await verifyPassword(password,user.password_hash))) return res.status(401).json({message:'Invalid credentials'})
  const token=signToken(user)
  res.json({accessToken:token,user:{id:user.id,email:user.email,firstName:user.first_name,lastName:user.last_name,role:user.role}})
})

app.get('/api/v1/auth/me',requireAuth,(req:AuthRequest,res)=>res.json({user:req.user}))

app.get('/api/v1/foreigners',requireAuth,async(req:AuthRequest,res)=>{
  const q=String(req.query.q||'').trim()
  const params=[req.user.organization_id]
  let sql='SELECT f.*, COALESCE((SELECT json_agg(r ORDER BY r.end_date DESC) FROM registrations r WHERE r.foreigner_id=f.id),\'[]\') registrations FROM foreigners f WHERE f.organization_id=$1'
  if(q){params.push(`%${q}%`);sql+=' AND (f.first_name ILIKE $2 OR f.last_name ILIKE $2 OR f.citizenship ILIKE $2)'}
  sql+=' ORDER BY f.created_at DESC'
  const r=await query(sql,params)
  res.json({data:r.rows,total:r.rowCount})
})

app.post('/api/v1/foreigners',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {firstName,middleName,lastName,citizenship,birthDate,phone,email}=req.body||{}
  if(!firstName||!lastName||!citizenship)return res.status(400).json({message:'firstName, lastName and citizenship are required'})
  const r=await query(
    'INSERT INTO foreigners(organization_id,first_name,middle_name,last_name,citizenship,birth_date,phone,email) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [req.user.organization_id,firstName,middleName||null,lastName,citizenship,birthDate||null,phone||null,email||null]
  )
  await query('INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',[req.user.organization_id,req.user.id,'CREATE','FOREIGNER',r.rows[0].id,{firstName,lastName}])
  res.status(201).json(r.rows[0])
})

app.get('/api/v1/deadlines',requireAuth,async(req:AuthRequest,res)=>{
  const r=await query(`
    SELECT f.id AS foreigner_id, f.first_name, f.last_name, r.id AS registration_id,
           r.end_date,
           CASE WHEN r.end_date < CURRENT_DATE THEN 'EXPIRED'
                WHEN r.end_date <= CURRENT_DATE + 3 THEN 'URGENT'
                WHEN r.end_date <= CURRENT_DATE + 7 THEN 'WARNING'
                ELSE 'NORMAL' END AS deadline_status
    FROM foreigners f
    JOIN registrations r ON r.foreigner_id=f.id
    WHERE f.organization_id=$1
    ORDER BY r.end_date ASC`,[req.user.organization_id])
  res.json({data:r.rows})
})

app.post('/api/v1/government/applications',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  res.status(201).json({
    id:crypto.randomUUID(),
    status:'READY_FOR_OFFICIAL_SUBMISSION',
    mode:'MANUAL_OFFICIAL_SERVICE',
    message:'Заявка подготовлена. Передача выполняется через официальный разрешенный механизм.'
  })
})

app.listen(Number(process.env.PORT||3000),()=>console.log('ForeignID API on :3000'))
process.on('SIGTERM',()=>pool.end())
