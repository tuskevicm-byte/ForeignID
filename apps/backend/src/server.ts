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

const storageRoot=path.resolve(process.env.FILE_STORAGE_PATH||'./storage')
const allowedFileTypes=new Set(['application/pdf','image/jpeg','image/png','image/webp','text/plain'])
function safeFileName(name:string){return String(name||'file').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,180)}
const extensionForType=(type:string)=>({ 'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp','text/plain':'txt' } as any)[type]||'bin'
async function storeProtectedFile(organizationId:string,fileUrl:string,fileType:string){
  const match=/^data:([^;]+);base64,(.*)$/.exec(String(fileUrl||''))
  if(!match)throw new Error('Файл должен быть загружен как data URL')
  const mime=match[1], raw=match[2]
  if(!allowedFileTypes.has(mime)||mime!==fileType)throw new Error('Недопустимый тип файла')
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)||raw.length%4!==0)throw new Error('Некорректное содержимое файла')
  const buffer=Buffer.from(raw,'base64')
  if(!buffer.length||buffer.length>1500000)throw new Error('Размер файла должен быть от 1 байта до 1.5 МБ')
  const dir=path.join(storageRoot,organizationId); await fs.promises.mkdir(dir,{recursive:true})
  const storedName=crypto.randomUUID()+'.'+extensionForType(mime)
  const fullPath=path.join(dir,storedName); await fs.promises.writeFile(fullPath,buffer)
  return {storedName,fullPath,size:buffer.length,mime}
}

async function storeProtectedPhoto(organizationId:string,fileUrl:string){
  return storeProtectedFile(organizationId,fileUrl,'image/jpeg').catch(async()=>{
    const match=/^data:([^;]+);base64,(.*)$/.exec(String(fileUrl||''))
    if(!match)throw new Error('Фото должно быть загружено как data URL')
    const mime=match[1]
    if(!['image/jpeg','image/png','image/webp'].includes(mime))throw new Error('Недопустимый тип фото')
    return storeProtectedFile(organizationId,fileUrl,mime)
  })
}

function isValidDate(value:any){
  if(value==null||value==='')return true
  const s=String(value)
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false
  const [y,m,d]=s.split('-').map(Number)
  const dt=new Date(Date.UTC(y,m-1,d))
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d
}
function invalidDateRange(startDate:any,endDate:any){
  return Boolean(startDate&&endDate&&String(startDate)>String(endDate))
}
function hasInvalidDate(...values:any[]){
  return values.some(value=>!isValidDate(value))
}
const allowedOrigins=(process.env.CORS_ORIGIN||'https://frontend-production-d68e.up.railway.app,http://localhost:3000,http://localhost:5173,http://localhost:4200').split(',').map(x=>x.trim()).filter(Boolean)
app.use(cors({
  origin:(origin,callback)=>{
    if(!origin||allowedOrigins.includes(origin))return callback(null,true)
    return callback(new Error('CORS not allowed'))
  },
  credentials:true,
  methods:['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  allowedHeaders:['Content-Type','Authorization']
}))
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

app.post('/api/v1/foreigners/import',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const rows=Array.isArray(req.body?.rows)?req.body.rows:[]
  if(!rows.length)return res.status(400).json({message:'Нет данных для импорта'})
  if(rows.length>500)return res.status(400).json({message:'За один импорт можно загрузить не более 500 записей'})
  const imported:any[]=[],errors:any[]=[]
  for(let index=0;index<rows.length;index++){
    const x=rows[index]||{}
    if(!x.firstName||!x.lastName){errors.push({row:index+1,message:'Имя и фамилия обязательны'});continue}
    try{
      const r=await query(`INSERT INTO foreigners(
        organization_id,first_name,middle_name,last_name,citizenship,birth_date,gender,phone,email,
        entry_date,stay_basis,stay_address,insurance_company,insurance_policy_number,insurance_end_date
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id,first_name,middle_name,last_name`,[
        req.user.organization_id,x.firstName,x.middleName||null,x.lastName,x.citizenship||null,x.birthDate||null,
        x.gender||null,x.phone||null,x.email||null,x.entryDate||null,x.stayBasis||null,x.stayAddress||null,
        x.insuranceCompany||null,x.insurancePolicyNumber||null,x.insuranceEndDate||null
      ])
      imported.push(r.rows[0])
    }catch(e:any){errors.push({row:index+1,message:e?.message||'Ошибка сохранения'})}
  }
  await audit(req,'IMPORT','FOREIGNER',null,{count:imported.length,errors:errors.length})
  res.json({imported:imported.length,errors, data:imported})
})

app.get('/api/v1/users',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const r=await query('SELECT id,email,first_name,last_name,role,is_active,created_at FROM users WHERE organization_id=$1 ORDER BY created_at DESC',[req.user.organization_id])
  res.json({data:r.rows})
})

app.post('/api/v1/users',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const {email,password,firstName,lastName,role='OPERATOR'}=req.body||{}
  if(!email||!password||!firstName||!lastName)return res.status(400).json({message:'Email, пароль, имя и фамилия обязательны'})
  if(!['ORG_ADMIN','OPERATOR','VIEWER'].includes(role))return res.status(400).json({message:'Недопустимая роль'})
  if(req.user.role==='ORG_ADMIN' && role==='ORG_ADMIN')return res.status(403).json({message:'ORG_ADMIN не может создавать другого администратора'})
  const {hashPassword}=await import('./auth.js')
  const hash=await hashPassword(password)
  try{
    const r=await query('INSERT INTO users(organization_id,email,password_hash,first_name,last_name,role) VALUES($1,lower($2),$3,$4,$5,$6) RETURNING id,email,first_name,last_name,role,is_active,created_at',[req.user.organization_id,email,hash,firstName,lastName,role])
    await audit(req,'CREATE','USER',r.rows[0].id,{email,role});res.status(201).json(r.rows[0])
  }catch(e:any){if(e?.code==='23505')return res.status(409).json({message:'Пользователь с таким email уже существует'});throw e}
})

app.patch('/api/v1/users/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const {firstName,lastName,role,isActive,password}=req.body||{}
  const own=await query('SELECT * FROM users WHERE id=$1 AND organization_id=$2',[req.params.id,req.user.organization_id])
  if(!own.rowCount)return res.status(404).json({message:'Пользователь не найден'})
  if(req.params.id===req.user.id && isActive===false)return res.status(400).json({message:'Нельзя деактивировать текущего пользователя'})
  if(req.user.role==='ORG_ADMIN' && role==='ORG_ADMIN' && own.rows[0].role!=='ORG_ADMIN')return res.status(403).json({message:'ORG_ADMIN не может назначать роль администратора'})
  const {hashPassword}=await import('./auth.js')
  const hash=password?await hashPassword(password):null
  const r=await query('UPDATE users SET first_name=COALESCE($1,first_name),last_name=COALESCE($2,last_name),role=COALESCE($3,role),is_active=COALESCE($4,is_active),password_hash=COALESCE($5,password_hash) WHERE id=$6 AND organization_id=$7 RETURNING id,email,first_name,last_name,role,is_active,created_at',[firstName||null,lastName||null,role||null,isActive??null,hash,req.params.id,req.user.organization_id])
  await audit(req,'UPDATE','USER',req.params.id,{role,isActive});res.json(r.rows[0])
})

app.get('/api/v1/dashboard',requireAuth,async(req:AuthRequest,res)=>{
  const [f,d,v,r,a]=await Promise.all([
    query('SELECT count(*)::int count FROM foreigners WHERE organization_id=$1 AND status<>$2',[req.user.organization_id,'ARCHIVED']),
    query("SELECT count(*)::int count FROM identity_documents d JOIN foreigners f ON f.id=d.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'",[req.user.organization_id]),
    query("SELECT count(*)::int count FROM visas v JOIN foreigners f ON f.id=v.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED' AND v.end_date>=CURRENT_DATE",[req.user.organization_id]),
    query("SELECT count(*)::int count FROM registrations r JOIN foreigners f ON f.id=r.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED' AND r.end_date>=CURRENT_DATE",[req.user.organization_id]),
    query('SELECT count(*)::int count FROM audit_logs WHERE organization_id=$1 AND created_at>=CURRENT_DATE',[req.user.organization_id])
  ])
  res.json({foreigners:f.rows[0].count,documents:d.rows[0].count,visas:v.rows[0].count,registrations:r.rows[0].count,todayActions:a.rows[0].count})
})

app.get('/api/v1/foreigners',requireAuth,async(req:AuthRequest,res)=>{
  const q=String(req.query.q||'').trim()
  const page=Math.max(1,Number(req.query.page)||1)
  const pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||25))
  const offset=(page-1)*pageSize
  const params=[req.user.organization_id]
  let sql=`SELECT f.*,
    (SELECT row_to_json(d) FROM identity_documents d WHERE d.foreigner_id=f.id ORDER BY d.expiry_date DESC NULLS LAST LIMIT 1) document,
    (SELECT row_to_json(v) FROM visas v WHERE v.foreigner_id=f.id ORDER BY v.end_date DESC LIMIT 1) visa,
    (SELECT row_to_json(r) FROM registrations r WHERE r.foreigner_id=f.id ORDER BY r.end_date DESC LIMIT 1) registration
    FROM foreigners f WHERE f.organization_id=$1`
  if(q){params.push(`%${q}%`);sql+=' AND (f.first_name ILIKE $2 OR f.last_name ILIKE $2 OR f.middle_name ILIKE $2 OR f.citizenship ILIKE $2 OR f.phone ILIKE $2 OR f.email ILIKE $2 OR EXISTS (SELECT 1 FROM identity_documents sd WHERE sd.foreigner_id=f.id AND sd.document_number ILIKE $2))'}
  sql+=' AND f.status<>\'ARCHIVED\''
  const countSql=sql.replace(/SELECT f\.[\s\S]*?FROM foreigners f WHERE/,'SELECT COUNT(*)::int AS total FROM foreigners f WHERE')
  const count=await query(countSql,params)
  sql+=' ORDER BY f.created_at DESC LIMIT $'+(params.length+1)+' OFFSET $'+(params.length+2)
  const r=await query(sql,[...params,pageSize,offset])
  res.json({data:r.rows,total:Number(count.rows[0]?.total||0),page,pageSize})
})

app.get('/api/v1/foreigners/:id',requireAuth,async(req:AuthRequest,res)=>{
  const f=await query("SELECT * FROM foreigners WHERE id=$1 AND organization_id=$2 AND status<>'ARCHIVED'",[req.params.id,req.user.organization_id])
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
  const {firstName,middleName,lastName,citizenship,birthDate,gender,phone,email,entryDate,stayBasis,stayAddress,insuranceCompany,insurancePolicyNumber,insuranceEndDate,photoUrl}=req.body||{}
  const requestedStatus=req.body?.status
  if(requestedStatus!==undefined && !['SUPER_ADMIN','ORG_ADMIN'].includes(req.user.role))return res.status(403).json({message:'Недостаточно прав для изменения статуса'})
  if(hasInvalidDate(birthDate,entryDate,insuranceEndDate))return res.status(400).json({message:'Некорректный формат даты. Используйте ГГГГ-ММ-ДД'})
  const r=await query(`UPDATE foreigners SET first_name=COALESCE($1,first_name),middle_name=$2,last_name=COALESCE($3,last_name),
    citizenship=COALESCE($4,citizenship),birth_date=$5,gender=$6,phone=$7,email=$8,entry_date=$9,stay_basis=$10,stay_address=$11,
    insurance_company=$12,insurance_policy_number=$13,insurance_end_date=$14,photo_url=$15,status=CASE WHEN $16::text IS NULL THEN status ELSE $16 END,updated_at=now()
    WHERE id=$17 AND organization_id=$18 RETURNING *`,
    [firstName,middleName||null,lastName,citizenship,birthDate||null,gender||null,phone||null,email||null,entryDate||null,stayBasis||null,stayAddress||null,insuranceCompany||null,insurancePolicyNumber||null,insuranceEndDate||null,photoUrl||null,requestedStatus,req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  await audit(req,'UPDATE','FOREIGNER',req.params.id,{firstName,lastName,status:requestedStatus})
  res.json(r.rows[0])
})

app.delete('/api/v1/foreigners/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const r=await query("UPDATE foreigners SET status='ARCHIVED',updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id",[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  await audit(req,'ARCHIVE','FOREIGNER',req.params.id); res.json({ok:true})
})

app.get('/api/v1/documents',requireAuth,async(req:AuthRequest,res)=>{
  const page=Math.max(1,Number(req.query.page)||1),pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||25)),offset=(page-1)*pageSize
  const base=`FROM identity_documents d JOIN foreigners f ON f.id=d.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'`
  const count=await query(`SELECT COUNT(*)::int AS total ${base}`,[req.user.organization_id])
  const r=await query(`SELECT d.*,f.first_name,f.last_name,f.citizenship ${base} ORDER BY d.expiry_date ASC NULLS LAST LIMIT $2 OFFSET $3`,[req.user.organization_id,pageSize,offset])
  res.json({data:r.rows,total:Number(count.rows[0]?.total||0),page,pageSize})
})

app.post('/api/v1/documents',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {foreignerId,documentType,documentNumber,issuingCountry,issueDate,expiryDate}=req.body||{}
  if(!foreignerId||!documentType||!documentNumber||!expiryDate)return res.status(400).json({message:'Иностранец, тип, номер и срок действия обязательны'})
  if(invalidDateRange(issueDate,expiryDate))return res.status(400).json({message:'Дата выдачи документа не может быть позже даты окончания'})
  const own=await query('SELECT id FROM foreigners WHERE id=$1 AND organization_id=$2',[foreignerId,req.user.organization_id])
  if(!own.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  const r=await query('INSERT INTO identity_documents(foreigner_id,document_type,document_number,issuing_country,issue_date,expiry_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [foreignerId,documentType,documentNumber,issuingCountry||null,issueDate||null,expiryDate])
  await audit(req,'CREATE','DOCUMENT',r.rows[0].id,{documentType,documentNumber});res.status(201).json(r.rows[0])
})

app.get('/api/v1/visas',requireAuth,async(req:AuthRequest,res)=>{
  const page=Math.max(1,Number(req.query.page)||1),pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||25)),offset=(page-1)*pageSize
  const base=`FROM visas v JOIN foreigners f ON f.id=v.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'`
  const count=await query(`SELECT COUNT(*)::int AS total ${base}`,[req.user.organization_id])
  const r=await query(`SELECT v.*,f.first_name,f.last_name,f.citizenship ${base} ORDER BY v.end_date ASC LIMIT $2 OFFSET $3`,[req.user.organization_id,pageSize,offset])
  res.json({data:r.rows,total:Number(count.rows[0]?.total||0),page,pageSize})
})

app.post('/api/v1/visas',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {foreignerId,visaType,visaNumber,issueDate,startDate,endDate,status,notes}=req.body||{}
  if(!foreignerId||!visaType||!endDate)return res.status(400).json({message:'Иностранец, тип визы и дата окончания обязательны'})
  if(invalidDateRange(startDate,endDate)||invalidDateRange(issueDate,endDate))return res.status(400).json({message:'Даты визы указаны некорректно'})
  const own=await query('SELECT id FROM foreigners WHERE id=$1 AND organization_id=$2',[foreignerId,req.user.organization_id])
  if(!own.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  const r=await query('INSERT INTO visas(foreigner_id,visa_type,visa_number,issue_date,start_date,end_date,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [foreignerId,visaType,visaNumber||null,issueDate||null,startDate||null,endDate,status||'ACTIVE',notes||null])
  await audit(req,'CREATE','VISA',r.rows[0].id,{visaType,visaNumber});res.status(201).json(r.rows[0])
})


app.post('/api/v1/registrations',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {foreignerId,registrationType,registrationNumber,startDate,endDate,status,governmentReference}=req.body||{}
  if(!foreignerId||!endDate)return res.status(400).json({message:'Иностранец и дата окончания регистрации обязательны'})
  if(invalidDateRange(startDate,endDate))return res.status(400).json({message:'Дата начала регистрации не может быть позже даты окончания'})
  const own=await query('SELECT id FROM foreigners WHERE id=$1 AND organization_id=$2',[foreignerId,req.user.organization_id])
  if(!own.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  const r=await query('INSERT INTO registrations(foreigner_id,registration_type,registration_number,start_date,end_date,status,government_reference) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [foreignerId,registrationType||'TEMPORARY_STAY',registrationNumber||null,startDate||null,endDate,status||'ACTIVE',governmentReference||null])
  await audit(req,'CREATE','REGISTRATION',r.rows[0].id,{registrationType,registrationNumber});res.status(201).json(r.rows[0])
})
app.patch('/api/v1/registrations/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const current=await query('SELECT r.* FROM registrations r JOIN foreigners f ON f.id=r.foreigner_id WHERE r.id=$1 AND f.organization_id=$2',[req.params.id,req.user.organization_id])
  if(!current.rowCount)return res.status(404).json({message:'Регистрация не найдена'})
  const old=current.rows[0], body=req.body||{}
  const registrationType=body.registrationType??old.registration_type, registrationNumber=body.registrationNumber??old.registration_number
  const startDate=body.startDate??old.start_date, endDate=body.endDate??old.end_date, status=body.status??old.status, governmentReference=body.governmentReference??old.government_reference
  if(hasInvalidDate(startDate,endDate))return res.status(400).json({message:'Некорректная дата регистрации. Используйте ГГГГ-ММ-ДД'})
  if(invalidDateRange(startDate,endDate))return res.status(400).json({message:'Дата начала регистрации не может быть позже даты окончания'})
  if(!endDate)return res.status(400).json({message:'Дата окончания регистрации обязательна'})
  const r=await query('UPDATE registrations SET registration_type=$1,registration_number=$2,start_date=$3,end_date=$4,status=$5,government_reference=$6 WHERE id=$7 RETURNING *',[registrationType,registrationNumber||null,startDate||null,endDate,status||null,governmentReference||null,req.params.id])
  await audit(req,'UPDATE','REGISTRATION',req.params.id,{registrationType,registrationNumber});res.json(r.rows[0])
})
app.delete('/api/v1/registrations/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const r=await query('DELETE FROM registrations r USING foreigners f WHERE r.id=$1 AND r.foreigner_id=f.id AND f.organization_id=$2 RETURNING r.id',[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Регистрация не найдена'})
  await audit(req,'DELETE','REGISTRATION',req.params.id);res.json({ok:true})
})
app.patch('/api/v1/documents/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const current=await query('SELECT d.* FROM identity_documents d JOIN foreigners f ON f.id=d.foreigner_id WHERE d.id=$1 AND f.organization_id=$2',[req.params.id,req.user.organization_id])
  if(!current.rowCount)return res.status(404).json({message:'Документ не найден'})
  const old=current.rows[0], body=req.body||{}
  const documentType=body.documentType??old.document_type, documentNumber=body.documentNumber??old.document_number, issuingCountry=body.issuingCountry??old.issuing_country
  const issueDate=body.issueDate??old.issue_date, expiryDate=body.expiryDate??old.expiry_date
  if(hasInvalidDate(issueDate,expiryDate))return res.status(400).json({message:'Некорректная дата документа. Используйте ГГГГ-ММ-ДД'})
  if(invalidDateRange(issueDate,expiryDate))return res.status(400).json({message:'Дата выдачи документа не может быть позже даты окончания'})
  if(!documentType||!documentNumber||!expiryDate)return res.status(400).json({message:'Тип, номер и срок действия документа обязательны'})
  const r=await query('UPDATE identity_documents SET document_type=$1,document_number=$2,issuing_country=$3,issue_date=$4,expiry_date=$5 WHERE id=$6 RETURNING *',[documentType,documentNumber,issuingCountry||null,issueDate||null,expiryDate,req.params.id])
  await audit(req,'UPDATE','DOCUMENT',req.params.id,{documentType,documentNumber});res.json(r.rows[0])
})
app.delete('/api/v1/documents/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const r=await query('DELETE FROM identity_documents d USING foreigners f WHERE d.id=$1 AND d.foreigner_id=f.id AND f.organization_id=$2 RETURNING d.id',[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Документ не найден'})
  await audit(req,'DELETE','DOCUMENT',req.params.id);res.json({ok:true})
})
app.patch('/api/v1/visas/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const current=await query('SELECT v.* FROM visas v JOIN foreigners f ON f.id=v.foreigner_id WHERE v.id=$1 AND f.organization_id=$2',[req.params.id,req.user.organization_id])
  if(!current.rowCount)return res.status(404).json({message:'Виза не найдена'})
  const old=current.rows[0], body=req.body||{}
  const visaType=body.visaType??old.visa_type, visaNumber=body.visaNumber??old.visa_number, issueDate=body.issueDate??old.issue_date
  const startDate=body.startDate??old.start_date, endDate=body.endDate??old.end_date, status=body.status??old.status, notes=body.notes??old.notes
  if(hasInvalidDate(issueDate,startDate,endDate))return res.status(400).json({message:'Некорректная дата визы. Используйте ГГГГ-ММ-ДД'})
  if(invalidDateRange(startDate,endDate)||invalidDateRange(issueDate,endDate))return res.status(400).json({message:'Даты визы указаны некорректно'})
  if(!visaType||!endDate)return res.status(400).json({message:'Тип визы и дата окончания обязательны'})
  const r=await query('UPDATE visas SET visa_type=$1,visa_number=$2,issue_date=$3,start_date=$4,end_date=$5,status=$6,notes=$7 WHERE id=$8 RETURNING *',[visaType,visaNumber||null,issueDate||null,startDate||null,endDate,status||null,notes||null,req.params.id])
  await audit(req,'UPDATE','VISA',req.params.id,{visaType,visaNumber});res.json(r.rows[0])
})
app.delete('/api/v1/visas/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const r=await query('DELETE FROM visas v USING foreigners f WHERE v.id=$1 AND v.foreigner_id=f.id AND f.organization_id=$2 RETURNING v.id',[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Виза не найдена'})
  await audit(req,'DELETE','VISA',req.params.id);res.json({ok:true})
})
app.post('/api/v1/photos',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {foreignerId,fileUrl}=req.body||{}
  if(!foreignerId||!fileUrl)return res.status(400).json({message:'Иностранец и фото обязательны'})
  const own=await query('SELECT id FROM foreigners WHERE id=$1 AND organization_id=$2',[foreignerId,req.user.organization_id])
  if(!own.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  try{
    const stored=await storeProtectedPhoto(req.user.organization_id,fileUrl)
    const r=await query("INSERT INTO foreigner_files(foreigner_id,file_name,file_url,file_type,file_size,kind) VALUES($1,$2,$3,$4,$5,'PHOTO') RETURNING id,file_name,file_type,file_size,kind",[
      foreignerId,'photo'+extensionForType(stored.mime),stored.storedName,stored.mime,stored.size
    ])
    await query('UPDATE foreigners SET photo_url=$1,updated_at=now() WHERE id=$2 AND organization_id=$3',['/api/v1/files/'+r.rows[0].id+'/download',foreignerId,req.user.organization_id])
    await audit(req,'UPDATE','FOREIGNER',foreignerId,{photoFileId:r.rows[0].id})
    res.status(201).json(r.rows[0])
  }catch(e:any){res.status(400).json({message:e?.message||'Не удалось сохранить фото'})}
})

app.post('/api/v1/files',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {foreignerId,fileName,fileUrl,fileType}=req.body||{}
  if(!foreignerId||!fileName||!fileUrl||!fileType)return res.status(400).json({message:'Владелец, имя файла, содержимое и тип обязательны'})
  const own=await query('SELECT id FROM foreigners WHERE id=$1 AND organization_id=$2',[foreignerId,req.user.organization_id])
  if(!own.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  try{
    const stored=await storeProtectedFile(req.user.organization_id,fileUrl,fileType)
    const r=await query('INSERT INTO foreigner_files(foreigner_id,file_name,file_url,file_type,file_size) VALUES($1,$2,$3,$4,$5) RETURNING *',[foreignerId,fileName,stored.storedName,stored.mime,stored.size])
    await audit(req,'CREATE','FILE',r.rows[0].id,{fileName,fileSize:stored.size})
    res.status(201).json({...r.rows[0],downloadUrl:'/api/v1/files/'+r.rows[0].id+'/download'})
  }catch(e:any){res.status(400).json({message:e?.message||'Не удалось сохранить файл'})}
})
app.get('/api/v1/files/:id/download',requireAuth,async(req:AuthRequest,res)=>{
  const r=await query('SELECT ff.*,f.organization_id FROM foreigner_files ff JOIN foreigners f ON f.id=ff.foreigner_id WHERE ff.id=$1 AND f.organization_id=$2',[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Файл не найден'})
  const file=r.rows[0]
  const storedName=String(file.file_url||'')
  if(!/^[a-f0-9-]{36}\.(pdf|jpg|png|webp|txt)$/.test(storedName))return res.status(404).json({message:'Файл отсутствует в защищённом хранилище'})
  const fullPath=path.join(storageRoot,req.user.organization_id,storedName)
  try{
    await fs.promises.access(fullPath)
    res.type(file.file_type||'application/octet-stream')
    res.setHeader('Content-Disposition','attachment; filename*=UTF-8\'\''+encodeURIComponent(String(file.file_name||'file')))
    return res.sendFile(fullPath)
  }catch{return res.status(404).json({message:'Файл отсутствует в хранилище'})}
})
app.delete('/api/v1/files/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const r=await query('SELECT ff.file_url,ff.file_name,ff.kind,f.id AS foreigner_id,f.organization_id FROM foreigner_files ff JOIN foreigners f ON f.id=ff.foreigner_id WHERE ff.id=$1 AND f.organization_id=$2',[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Файл не найден'})
  const file=r.rows[0]
  if(!String(file.file_url).startsWith('data:')){try{await fs.promises.unlink(path.join(storageRoot,req.user.organization_id,file.file_url))}catch{}}
  if(file.kind==='PHOTO') await query('UPDATE foreigners SET photo_url=NULL,updated_at=now() WHERE id=$1 AND organization_id=$2',[file.foreigner_id,req.user.organization_id])
  await query('DELETE FROM foreigner_files WHERE id=$1',[req.params.id])
  await audit(req,'DELETE','FILE',req.params.id,{fileName:file.file_name});res.json({ok:true})
})

app.get('/api/v1/notifications',requireAuth,async(req:AuthRequest,res)=>{
  const sql=`SELECT * FROM (
    SELECT f.id foreigner_id,f.first_name,f.last_name,'Документ' item_type,d.document_type item_name,d.expiry_date end_date
    FROM identity_documents d JOIN foreigners f ON f.id=d.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'
    UNION ALL
    SELECT f.id,f.first_name,f.last_name,'Виза',v.visa_type,v.end_date FROM visas v JOIN foreigners f ON f.id=v.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'
    UNION ALL
    SELECT f.id,f.first_name,f.last_name,'Регистрация',r.registration_type,r.end_date FROM registrations r JOIN foreigners f ON f.id=r.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'
    UNION ALL
    SELECT f.id,f.first_name,f.last_name,'Страховка','Страховой полис',f.insurance_end_date FROM foreigners f WHERE f.organization_id=$1 AND f.status<>'ARCHIVED' AND f.insurance_end_date IS NOT NULL
  ) x WHERE end_date IS NOT NULL AND end_date <= CURRENT_DATE + INTERVAL '30 days' ORDER BY end_date ASC`
  const r=await query(sql,[req.user.organization_id]); const today=new Date()
  const data=r.rows.map((x:any)=>{const days=Math.ceil((new Date(x.end_date).getTime()-today.getTime())/86400000);return {...x,days_left:days,level:days<0?'EXPIRED':'WARNING'}})
  res.json({data,total:data.length})
})

app.get('/api/v1/reports/deadlines',requireAuth,async(req:AuthRequest,res)=>{
  const sql=`SELECT * FROM (
    SELECT f.id foreigner_id,f.first_name,f.last_name,'Документ' item_type,d.document_type item_name,d.expiry_date end_date FROM identity_documents d JOIN foreigners f ON f.id=d.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'
    UNION ALL
    SELECT f.id,f.first_name,f.last_name,'Виза',v.visa_type,v.end_date FROM visas v JOIN foreigners f ON f.id=v.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'
    UNION ALL
    SELECT f.id,f.first_name,f.last_name,'Регистрация',r.registration_type,r.end_date FROM registrations r JOIN foreigners f ON f.id=r.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'
    UNION ALL
    SELECT f.id,f.first_name,f.last_name,'Страховка','Страховой полис',f.insurance_end_date FROM foreigners f WHERE f.organization_id=$1 AND f.status<>'ARCHIVED' AND f.insurance_end_date IS NOT NULL
  ) x WHERE end_date IS NOT NULL ORDER BY end_date ASC`
  const r=await query(sql,[req.user.organization_id])
  const today=new Date(); const data=r.rows.map((x:any)=>{
    const end=new Date(x.end_date); const days=Math.ceil((end.getTime()-today.getTime())/86400000)
    return {...x,deadline_status:days<0?'EXPIRED':days<=30?'WARNING':'NORMAL'}
  })
  res.json({data,total:data.length})
})

app.get('/api/v1/deadlines',requireAuth,async(req:AuthRequest,res)=>{
  const page=Math.max(1,Number(req.query.page)||1),pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||25)),offset=(page-1)*pageSize
  const base=`SELECT * FROM (
    SELECT f.id foreigner_id,f.first_name,f.last_name,'Документ' item_type,d.document_type item_name,d.expiry_date end_date FROM identity_documents d JOIN foreigners f ON f.id=d.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'
    UNION ALL
    SELECT f.id,f.first_name,f.last_name,'Виза',v.visa_type,v.end_date FROM visas v JOIN foreigners f ON f.id=v.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'
    UNION ALL
    SELECT f.id,f.first_name,f.last_name,'Регистрация',r.registration_type,r.end_date FROM registrations r JOIN foreigners f ON f.id=r.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'
    UNION ALL
    SELECT f.id,f.first_name,f.last_name,'Страховка','Страховой полис',f.insurance_end_date FROM foreigners f WHERE f.organization_id=$1 AND f.status<>'ARCHIVED' AND f.insurance_end_date IS NOT NULL
  ) x WHERE end_date IS NOT NULL`
  const count=await query(`SELECT COUNT(*)::int AS total FROM (${base}) x`,[req.user.organization_id])
  const r=await query(base+' ORDER BY end_date ASC LIMIT $2 OFFSET $3',[req.user.organization_id,pageSize,offset])
  const map=(x:any)=>{const daysLeft=Math.ceil((new Date(x.end_date).getTime()-Date.now())/86400000);return {...x,days_left:daysLeft,deadline_status:daysLeft<0?'EXPIRED':daysLeft<=30?'WARNING':'NORMAL',deadline_level:daysLeft<0?'EXPIRED':daysLeft<=1?'1_DAY':daysLeft<=3?'3_DAYS':daysLeft<=7?'7_DAYS':daysLeft<=14?'14_DAYS':daysLeft<=30?'30_DAYS':'NORMAL'}}
  res.json({data:r.rows.map(map),total:Number(count.rows[0]?.total||0),page,pageSize})
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
  const page=Math.max(1,Number(req.query.page)||1),pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||25)),offset=(page-1)*pageSize
  const foreignerId=String(req.query.foreignerId||'').trim()
  const params:any[]=[req.user.organization_id]
  let sql=`SELECT a.*,u.first_name,u.last_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.organization_id=$1`
  if(foreignerId){params.push(foreignerId);sql+=' AND ((a.entity_type=\'FOREIGNER\' AND a.entity_id=$2) OR (a.entity_type IN (\'DOCUMENT\',\'VISA\',\'REGISTRATION\',\'FILE\') AND a.entity_id IN (SELECT id FROM identity_documents WHERE foreigner_id=$2 UNION ALL SELECT id FROM visas WHERE foreigner_id=$2 UNION ALL SELECT id FROM registrations WHERE foreigner_id=$2 UNION ALL SELECT id FROM foreigner_files WHERE foreigner_id=$2)))'}
  const countSql=sql.replace('SELECT a.*,u.first_name,u.last_name','SELECT COUNT(*)::int AS total')
  const count=await query(countSql,params)
  sql+=' ORDER BY a.created_at DESC LIMIT $'+(params.length+1)+' OFFSET $'+(params.length+2)
  const r=await query(sql,[...params,pageSize,offset])
  res.json({data:r.rows,total:Number(count.rows[0]?.total||0),page,pageSize})
})

app.get('/api/v1/applications',requireAuth,async(req:AuthRequest,res)=>{
  const page=Math.max(1,Number(req.query.page)||1),pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||25)),offset=(page-1)*pageSize
  const base=`FROM government_applications a LEFT JOIN foreigners f ON f.id=a.foreigner_id WHERE a.organization_id=$1`
  const count=await query(`SELECT COUNT(*)::int AS total ${base}`,[req.user.organization_id])
  const r=await query(`SELECT a.*,f.first_name,f.last_name,
    (SELECT count(*)::int FROM government_integration_logs l WHERE l.application_id=a.id) integration_attempts,
    (SELECT message FROM government_application_status_history h WHERE h.application_id=a.id ORDER BY h.created_at DESC LIMIT 1) last_status_message
    ${base} ORDER BY a.created_at DESC LIMIT $2 OFFSET $3`,[req.user.organization_id,pageSize,offset])
  res.json({data:r.rows,total:Number(count.rows[0]?.total||0),page,pageSize})
})

app.get('/api/v1/government/applications/:id/logs',requireAuth,async(req:AuthRequest,res)=>{
  const own=await query('SELECT id FROM government_applications WHERE id=$1 AND organization_id=$2',[req.params.id,req.user.organization_id])
  if(!own.rowCount)return res.status(404).json({message:'Заявка не найдена'})
  const [history,logs]=await Promise.all([
    query('SELECT * FROM government_application_status_history WHERE application_id=$1 ORDER BY created_at DESC',[req.params.id]),
    query('SELECT id,direction,http_status,error,created_at FROM government_integration_logs WHERE application_id=$1 ORDER BY created_at DESC',[req.params.id])
  ])
  res.json({history:history.rows,logs:logs.rows})
})

app.post('/api/v1/government/applications',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const {foreignerId,serviceType}=req.body||{}
  if(!foreignerId||!serviceType)return res.status(400).json({message:'Иностранец и услуга обязательны'})
  const own=await query(`SELECT id,first_name,middle_name,last_name,citizenship,birth_date,gender,phone,email,entry_date,stay_basis,stay_address
    FROM foreigners WHERE id=$1 AND organization_id=$2 AND status<>'ARCHIVED'`,[foreignerId,req.user.organization_id])
  if(!own.rowCount)return res.status(404).json({message:'Иностранец не найден'})
  const requestPayload={serviceType,foreigner:own.rows[0]}
  const r=await query('INSERT INTO government_applications(organization_id,foreigner_id,service_type,status,request_payload) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [req.user.organization_id,foreignerId,serviceType,'READY_FOR_OFFICIAL_SUBMISSION',requestPayload])
  await query('INSERT INTO government_application_status_history(application_id,status,message) VALUES($1,$2,$3)',[r.rows[0].id,'READY_FOR_OFFICIAL_SUBMISSION','Заявка подготовлена; реальная отправка в ОАИС ожидает настройки официального канала.'])
  await audit(req,'CREATE','APPLICATION',r.rows[0].id,{serviceType});res.status(201).json(r.rows[0])
})

app.post('/api/v1/government/applications/:id/prepare',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const r=await query(`SELECT a.*,f.first_name,f.middle_name,f.last_name,f.citizenship,f.birth_date,f.gender,f.phone,f.email,f.entry_date,f.stay_basis,f.stay_address
    FROM government_applications a LEFT JOIN foreigners f ON f.id=a.foreigner_id WHERE a.id=$1 AND a.organization_id=$2`,[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Заявка не найдена'})
  const payload={serviceType:r.rows[0].service_type,foreigner:{id:r.rows[0].foreigner_id,firstName:r.rows[0].first_name,middleName:r.rows[0].middle_name,lastName:r.rows[0].last_name,citizenship:r.rows[0].citizenship,birthDate:r.rows[0].birth_date,gender:r.rows[0].gender,phone:r.rows[0].phone,email:r.rows[0].email,entryDate:r.rows[0].entry_date,stayBasis:r.rows[0].stay_basis,stayAddress:r.rows[0].stay_address}}
  await query('UPDATE government_applications SET request_payload=$1,status=$2,updated_at=now() WHERE id=$3',[payload,'READY_FOR_OFFICIAL_SUBMISSION',req.params.id])
  await query('INSERT INTO government_integration_logs(application_id,direction,payload) VALUES($1,$2,$3)',[req.params.id,'OUTBOUND',payload])
  await query('INSERT INTO government_application_status_history(application_id,status,message) VALUES($1,$2,$3)',[req.params.id,'READY_FOR_OFFICIAL_SUBMISSION','Запрос сформирован, но не отправлен: отсутствуют параметры официального канала ОАИС.'])
  res.json({ok:true,status:'READY_FOR_OFFICIAL_SUBMISSION',payload})
})

const schemaPath=path.join(path.dirname(fileURLToPath(import.meta.url)),'schema.sql')
await query(fs.readFileSync(schemaPath,'utf8'))
console.log('Database schema applied')
app.listen(Number(process.env.PORT||3000),()=>console.log('ForeignID API on :3000'))