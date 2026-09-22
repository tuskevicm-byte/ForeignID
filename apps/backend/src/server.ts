import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import {query,pool} from './db.js'
import {requireAuth,allow,signToken,verifyPassword,AuthRequest} from './auth.js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const app=express()
app.use(cors())
app.use(express.json({limit:'2mb'}))

async function audit(req:AuthRequest, action:string, entityType:string, entityId:any, details:any={}) {
  await query('INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
    [req.user.organization_id,req.user.id,action,entityType,entityId,details])
}

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
  res.json({accessToken:signToken(user),user:{id:user.id,email:user.email,firstName:user.first_name,lastName:user.last_name,role:user.role}})
})

app.get('/api/v1/auth/me',requireAuth,(req:AuthRequest,res)=>res.json({user:req.user}))

app.get('/api/v1/dashboard',requireAuth,async(req:AuthRequest,res)=>{
  const [f,d,v,r,a]=await Promise.all([
    query('SELECT count(*)::int count FROM foreigners WHERE organization_id=$1 AND status<>$2',[req.user.organization_id,'ARCHIVED']),
    query('SELECT count(*)::int count FROM identity_documents d JOIN foreigners f ON f.id=d.foreigner_id WHERE f.organization_id=$1',[req.user.organization_id]),
    query('SELECT count(*)::int count FROM visas v JOIN foreigners f ON f.id=v.foreigner_id WHERE f.organization_id=$1 AND v.end_date>=CURRENT_DATE',[req.user.organization_id]),
    query('SELECT count(*)::int count FROM registrations r JOIN foreigners f ON f.id=r.foreigner_id WHERE f.organization_id=$1 AND r.end_date>=CURRENT_DATE',[req.user.organization_id]),
    query('SELECT count(*)::int count FROM audit_logs WHERE organization_id=$1 AND created_at>=CURRENT_DATE',[req.user.organization_id])
  ])
  res.json({foreigners:f.rows[0].count,documents:d.rows[0].count,visas:v.rows[0].count,registrations:r.rows[0].count,todayActions:a.rows[0].count})
})

app.get('/api/v1/foreigners',requireAuth,async(req:AuthRequest,res)=>{
  const q=String(req.query.q||'').trim()
  const params=[req.user.organization_id]
  let sql=`SELECT f.*,
    (SELECT row_to_json(d) FROM identity_documents d WHERE d.foreigner_id=f.id ORDER BY d.expiry_date DESC NULLS LAST LIMIT 1) document,
    (SELECT row_to_json(v) FROM visas v WHERE v.foreigner_id=f.id ORDER BY v.end_date DESC LIMIT 1) visa,
    (SELECT row_to_json(r) FROM registrations r WHERE r.foreigner_id=f.id ORDER BY r.end_date DESC LIMIT 1) registration
    FROM foreigners f WHERE f.organization_id=$1`
  if(q){params.push(`%${q}%`);sql+=' AND (f.first_name ILIKE $2 OR f.last_name ILIKE $2 OR f.citizenship ILIKE $2)'}
  sql+=' ORDER BY f.created_at DESC'
  const r=await query(sql,params); res.json({data:r.rows,total:r.rowCount})
})

app.get('/api/v1/foreigners/:id',requireAuth,async(req:AuthRequest,res)=>{
  const f=await query('SELECT * FROM foreigners WHERE id=$1 AND organization_id=$2',[req.params.id,req.user.organization_id])
  if(!f.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  const [documents,visas,registrations,files]=await Promise.all([
    query('SELECT * FROM identity_documents WHERE foreigner_id=$1 ORDER BY expiry_date DESC NULLS LAST',[req.params.id]),
    query('SELECT * FROM visas WHERE foreigner_id=$1 ORDER BY end_date DESC',[req.params.id]),
    query('SELECT * FROM registrations WHERE foreigner_id=$1 ORDER BY end_date DESC',[req.params.id]),
    query('SELECT * FROM foreigner_files WHERE foreigner_id=$1 ORDER BY created_at DESC',[req.params.id])
  ])
  res.json({foreigner:f.rows[0],documents:documents.rows,visas:visas.rows,registrations:registrations.rows,files:files.rows})
})

app.post('/api/v1/foreigners',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {firstName,middleName,lastName,citizenship,birthDate,gender,phone,email,entryDate,stayBasis,stayAddress,insuranceCompany,insurancePolicyNumber,insuranceEndDate,photoUrl}=req.body||{}
  if(!firstName||!lastName||!citizenship)return res.status(400).json({message:'Имя, фамилия и гражданство обязательны'})
  const r=await query(`INSERT INTO foreigners(organization_id,first_name,middle_name,last_name,citizenship,birth_date,gender,phone,email,entry_date,stay_basis,stay_address,insurance_company,insurance_policy_number,insurance_end_date,photo_url)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [req.user.organization_id,firstName,middleName||null,lastName,citizenship,birthDate||null,gender||null,phone||null,email||null,entryDate||null,stayBasis||null,stayAddress||null,insuranceCompany||null,insurancePolicyNumber||null,insuranceEndDate||null,photoUrl||null])
  await audit(req,'CREATE','FOREIGNER',r.rows[0].id,{firstName,lastName})
  res.status(201).json(r.rows[0])
})

app.patch('/api/v1/foreigners/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {firstName,middleName,lastName,citizenship,birthDate,gender,phone,email,entryDate,stayBasis,stayAddress,insuranceCompany,insurancePolicyNumber,insuranceEndDate,photoUrl,status}=req.body||{}
  const r=await query(`UPDATE foreigners SET first_name=COALESCE($1,first_name),middle_name=$2,last_name=COALESCE($3,last_name),
    citizenship=COALESCE($4,citizenship),birth_date=$5,gender=$6,phone=$7,email=$8,entry_date=$9,stay_basis=$10,stay_address=$11,
    insurance_company=$12,insurance_policy_number=$13,insurance_end_date=$14,photo_url=$15,status=COALESCE($16,status),updated_at=now()
    WHERE id=$17 AND organization_id=$18 RETURNING *`,
    [firstName,middleName||null,lastName,citizenship,birthDate||null,gender||null,phone||null,email||null,entryDate||null,stayBasis||null,stayAddress||null,insuranceCompany||null,insurancePolicyNumber||null,insuranceEndDate||null,photoUrl||null,status,req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  await audit(req,'UPDATE','FOREIGNER',req.params.id,{firstName,lastName,status})
  res.json(r.rows[0])
})

app.delete('/api/v1/foreigners/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const r=await query("UPDATE foreigners SET status='ARCHIVED',updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id",[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  await audit(req,'ARCHIVE','FOREIGNER',req.params.id); res.json({ok:true})
})

app.get('/api/v1/documents',requireAuth,async(req:AuthRequest,res)=>{
  const r=await query(`SELECT d.*,f.first_name,f.last_name,f.citizenship FROM identity_documents d JOIN foreigners f ON f.id=d.foreigner_id
    WHERE f.organization_id=$1 ORDER BY d.expiry_date ASC NULLS LAST`,[req.user.organization_id])
  res.json({data:r.rows})
})

app.post('/api/v1/documents',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {foreignerId,documentType,documentNumber,issuingCountry,issueDate,expiryDate}=req.body||{}
  if(!foreignerId||!documentType||!documentNumber||!expiryDate)return res.status(400).json({message:'Иностранец, тип, номер и срок действия обязательны'})
  const own=await query('SELECT id FROM foreigners WHERE id=$1 AND organization_id=$2',[foreignerId,req.user.organization_id])
  if(!own.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  const r=await query('INSERT INTO identity_documents(foreigner_id,document_type,document_number,issuing_country,issue_date,expiry_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [foreignerId,documentType,documentNumber,issuingCountry||null,issueDate||null,expiryDate])
  await audit(req,'CREATE','DOCUMENT',r.rows[0].id,{documentType,documentNumber});res.status(201).json(r.rows[0])
})

app.get('/api/v1/visas',requireAuth,async(req:AuthRequest,res)=>{
  const r=await query(`SELECT v.*,f.first_name,f.last_name,f.citizenship FROM visas v JOIN foreigners f ON f.id=v.foreigner_id
    WHERE f.organization_id=$1 ORDER BY v.end_date ASC`,[req.user.organization_id]);res.json({data:r.rows})
})

app.post('/api/v1/visas',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {foreignerId,visaType,visaNumber,issueDate,startDate,endDate,status,notes}=req.body||{}
  if(!foreignerId||!visaType||!endDate)return res.status(400).json({message:'Иностранец, тип визы и дата окончания обязательны'})
  const own=await query('SELECT id FROM foreigners WHERE id=$1 AND organization_id=$2',[foreignerId,req.user.organization_id])
  if(!own.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  const r=await query('INSERT INTO visas(foreigner_id,visa_type,visa_number,issue_date,start_date,end_date,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [foreignerId,visaType,visaNumber||null,issueDate||null,startDate||null,endDate,status||'ACTIVE',notes||null])
  await audit(req,'CREATE','VISA',r.rows[0].id,{visaType,visaNumber});res.status(201).json(r.rows[0])
})


app.post('/api/v1/registrations',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {foreignerId,registrationType,registrationNumber,startDate,endDate,status,governmentReference}=req.body||{}
  if(!foreignerId||!endDate)return res.status(400).json({message:'Иностранец и дата окончания регистрации обязательны'})
  const own=await query('SELECT id FROM foreigners WHERE id=$1 AND organization_id=$2',[foreignerId,req.user.organization_id])
  if(!own.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  const r=await query('INSERT INTO registrations(foreigner_id,registration_type,registration_number,start_date,end_date,status,government_reference) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [foreignerId,registrationType||'TEMPORARY_STAY',registrationNumber||null,startDate||null,endDate,status||'ACTIVE',governmentReference||null])
  await audit(req,'CREATE','REGISTRATION',r.rows[0].id,{registrationType,registrationNumber});res.status(201).json(r.rows[0])
})
app.patch('/api/v1/registrations/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {registrationType,registrationNumber,startDate,endDate,status,governmentReference}=req.body||{}
  const r=await query(`UPDATE registrations r SET registration_type=COALESCE($1,r.registration_type),registration_number=$2,start_date=$3,end_date=COALESCE($4,r.end_date),status=COALESCE($5,r.status),government_reference=$6
    FROM foreigners f WHERE r.id=$7 AND r.foreigner_id=f.id AND f.organization_id=$8 RETURNING r.*`,
    [registrationType,registrationNumber||null,startDate||null,endDate,status||null,governmentReference||null,req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Регистрация не найдена'})
  await audit(req,'UPDATE','REGISTRATION',req.params.id,{registrationType,registrationNumber});res.json(r.rows[0])
})
app.delete('/api/v1/registrations/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const r=await query('DELETE FROM registrations r USING foreigners f WHERE r.id=$1 AND r.foreigner_id=f.id AND f.organization_id=$2 RETURNING r.id',[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Регистрация не найдена'})
  await audit(req,'DELETE','REGISTRATION',req.params.id);res.json({ok:true})
})
app.patch('/api/v1/documents/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {documentType,documentNumber,issuingCountry,issueDate,expiryDate}=req.body||{}
  const r=await query(`UPDATE identity_documents d SET document_type=COALESCE($1,d.document_type),document_number=COALESCE($2,d.document_number),
    issuing_country=$3,issue_date=$4,expiry_date=COALESCE($5,d.expiry_date)
    FROM foreigners f WHERE d.id=$6 AND d.foreigner_id=f.id AND f.organization_id=$7 RETURNING d.*`,
    [documentType,documentNumber,issuingCountry||null,issueDate||null,expiryDate,req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Документ не найден'})
  await audit(req,'UPDATE','DOCUMENT',req.params.id,{documentType,documentNumber});res.json(r.rows[0])
})
app.delete('/api/v1/documents/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const r=await query('DELETE FROM identity_documents d USING foreigners f WHERE d.id=$1 AND d.foreigner_id=f.id AND f.organization_id=$2 RETURNING d.id',[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Документ не найден'})
  await audit(req,'DELETE','DOCUMENT',req.params.id);res.json({ok:true})
})
app.patch('/api/v1/visas/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {visaType,visaNumber,issueDate,startDate,endDate,status,notes}=req.body||{}
  const r=await query(`UPDATE visas v SET visa_type=COALESCE($1,v.visa_type),visa_number=$2,issue_date=$3,start_date=$4,end_date=COALESCE($5,v.end_date),status=COALESCE($6,v.status),notes=$7
    FROM foreigners f WHERE v.id=$8 AND v.foreigner_id=f.id AND f.organization_id=$9 RETURNING v.*`,
    [visaType,visaNumber||null,issueDate||null,startDate||null,endDate,status||null,notes||null,req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Виза не найдена'})
  await audit(req,'UPDATE','VISA',req.params.id,{visaType,visaNumber});res.json(r.rows[0])
})
app.delete('/api/v1/visas/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const r=await query('DELETE FROM visas v USING foreigners f WHERE v.id=$1 AND v.foreigner_id=f.id AND f.organization_id=$2 RETURNING v.id',[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Виза не найдена'})
  await audit(req,'DELETE','VISA',req.params.id);res.json({ok:true})
})
app.post('/api/v1/files',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {foreignerId,fileName,fileUrl,fileType,fileSize}=req.body||{}
  if(!foreignerId||!fileName||!fileUrl)return res.status(400).json({message:'Владелец, имя файла и ссылка обязательны'})
  const own=await query('SELECT id FROM foreigners WHERE id=$1 AND organization_id=$2',[foreignerId,req.user.organization_id])
  if(!own.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  const r=await query('INSERT INTO foreigner_files(foreigner_id,file_name,file_url,file_type,file_size) VALUES($1,$2,$3,$4,$5) RETURNING *',[foreignerId,fileName,fileUrl,fileType||null,fileSize||null])
  await audit(req,'CREATE','FILE',r.rows[0].id,{fileName});res.status(201).json(r.rows[0])
})
app.delete('/api/v1/files/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const r=await query('DELETE FROM foreigner_files ff USING foreigners f WHERE ff.id=$1 AND ff.foreigner_id=f.id AND f.organization_id=$2 RETURNING ff.id,ff.file_name',[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Файл не найден'})
  await audit(req,'DELETE','FILE',req.params.id,{fileName:r.rows[0].file_name});res.json({ok:true})
})

app.get('/api/v1/deadlines',requireAuth,async(req:AuthRequest,res)=>{
  const r=await query(`SELECT * FROM (
    SELECT f.id foreigner_id,f.first_name,f.last_name,'Документ' item_type,d.document_type item_name,d.expiry_date end_date FROM identity_documents d JOIN foreigners f ON f.id=d.foreigner_id WHERE f.organization_id=$1
    UNION ALL
    SELECT f.id,f.first_name,f.last_name,'Виза',v.visa_type,v.end_date FROM visas v JOIN foreigners f ON f.id=v.foreigner_id WHERE f.organization_id=$1
    UNION ALL
    SELECT f.id,f.first_name,f.last_name,'Регистрация',r.registration_type,r.end_date FROM registrations r JOIN foreigners f ON f.id=r.foreigner_id WHERE f.organization_id=$1
  ) x ORDER BY end_date ASC`,[req.user.organization_id])
  res.json({data:r.rows.map((x:any)=>({...x,deadline_status:new Date(x.end_date)<new Date()?'EXPIRED':Math.ceil((new Date(x.end_date).getTime()-Date.now())/86400000)<=7?'WARNING':'NORMAL'}))})
})

app.get('/api/v1/diagnostics/visa-distribution',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const r=await query(`SELECT
    count(DISTINCT f.id)::int AS foreigners,
    count(v.id)::int AS visas,
    count(*) FILTER (WHERE v.end_date < CURRENT_DATE)::int AS expired,
    count(*) FILTER (WHERE v.end_date = CURRENT_DATE + 5)::int AS expiring_in_5_days,
    count(*) FILTER (WHERE v.end_date > CURRENT_DATE + 5)::int AS normal
    FROM foreigners f
    LEFT JOIN visas v ON v.foreigner_id=f.id
    WHERE f.organization_id=$1
      AND f.status <> 'ARCHIVED'
      AND f.email LIKE 'demo%@foreignid.local'`,[req.user.organization_id])
  const row=r.rows[0]
  res.json({
    ok:true,
    scope:'organization',
    demoPattern:'demo%@foreignid.local',
    distribution:{
      foreigners:Number(row.foreigners)||0,
      visas:Number(row.visas)||0,
      expired:Number(row.expired)||0,
      expiringIn5Days:Number(row.expiring_in_5_days)||0,
      normal:Number(row.normal)||0
    }
  })
})

app.get('/api/v1/history',requireAuth,async(req:AuthRequest,res)=>{
  const r=await query(`SELECT a.*,u.first_name,u.last_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
    WHERE a.organization_id=$1 ORDER BY a.created_at DESC LIMIT 100`,[req.user.organization_id]);res.json({data:r.rows})
})

app.get('/api/v1/applications',requireAuth,async(req:AuthRequest,res)=>{
  const r=await query(`SELECT a.*,f.first_name,f.last_name FROM government_applications a LEFT JOIN foreigners f ON f.id=a.foreigner_id
    WHERE a.organization_id=$1 ORDER BY a.created_at DESC`,[req.user.organization_id]);res.json({data:r.rows})
})

app.post('/api/v1/government/applications',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {foreignerId,serviceType}=req.body||{}
  if(!foreignerId||!serviceType)return res.status(400).json({message:'Иностранец и услуга обязательны'})
  const r=await query('INSERT INTO government_applications(organization_id,foreigner_id,service_type,status) VALUES($1,$2,$3,$4) RETURNING *',
    [req.user.organization_id,foreignerId,serviceType,'READY_FOR_OFFICIAL_SUBMISSION'])
  await audit(req,'CREATE','APPLICATION',r.rows[0].id,{serviceType});res.status(201).json(r.rows[0])
})

const schemaPath=path.join(path.dirname(fileURLToPath(import.meta.url)),'schema.sql')
await query(fs.readFileSync(schemaPath,'utf8'))
console.log('Database schema applied')
app.listen(Number(process.env.PORT||3000),()=>console.log('ForeignID API on :3000'))
process.on('SIGTERM',()=>pool.end())