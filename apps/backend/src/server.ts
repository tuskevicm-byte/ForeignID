import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import {query,pool} from './db.js'
import {requireAuth,allow,signToken,verifyPassword,AuthRequest,createRefreshToken,hashRefreshToken,createTwoFactorSecret,twoFactorUri,verifyTwoFactorCode} from './auth.js'
import crypto from 'node:crypto'
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import {fileURLToPath} from 'node:url'

const app=express()

const storageRoot=path.resolve(process.env.FILE_STORAGE_PATH||'/data/foreignid-storage')
const s3Enabled=String(process.env.FILE_STORAGE_DRIVER||'local').toLowerCase()==='s3'
const s3Client=s3Enabled&&process.env.S3_ENDPOINT&&process.env.S3_BUCKET&&process.env.S3_ACCESS_KEY_ID&&process.env.S3_SECRET_ACCESS_KEY
  ? new S3Client({region:process.env.S3_REGION||'auto',endpoint:process.env.S3_ENDPOINT,forcePathStyle:String(process.env.S3_FORCE_PATH_STYLE||'false')==='true',credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}})
  : null
if(s3Enabled&&!s3Client)throw new Error('S3 storage is enabled but S3 configuration is incomplete')
const allowedFileTypes=new Set(['application/pdf','image/jpeg','image/png','image/webp','text/plain'])
function safeFileName(name:string){return String(name||'file').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,180)}
const extensionForType=(type:string)=>({ 'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp','text/plain':'txt' } as any)[type]||'bin'
function hasValidFileSignature(mime:string,buffer:Buffer){
  if(mime==='application/pdf')return buffer.subarray(0,5).toString()==='%PDF-'
  if(mime==='image/jpeg')return buffer.length>=3&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff
  if(mime==='image/png')return buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  if(mime==='image/webp')return buffer.length>=12&&buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP'
  if(mime==='text/plain')return !buffer.subarray(0,1000).includes(0)
  return false
}
async function scanWithClamAV(buffer:Buffer){
  const host=String(process.env.CLAMAV_HOST||'').trim()
  const port=Number(process.env.CLAMAV_PORT||3310)
  const required=String(process.env.CLAMAV_REQUIRED||'false').toLowerCase()==='true'
  if(!host){
    if(required)throw new Error('Антивирусный сканер не настроен')
    return {clean:true,skipped:true}
  }
  return await new Promise<{clean:boolean,skipped?:boolean}>((resolve,reject)=>{
    const socket=net.createConnection({host,port})
    let response=''
    let settled=false
    const finish=(fn:any,value:any)=>{if(settled)return;settled=true;socket.destroy();fn(value)}
    const timer=setTimeout(()=>finish(reject,new Error('Антивирусный сканер не ответил вовремя')),15000)
    socket.on('connect',()=>{
      socket.write(Buffer.from([122,73,78,83,84,82,69,65,77,0])) // zINSTREAM
      for(let offset=0;offset<buffer.length;offset+=65536){
        const chunk=buffer.subarray(offset,Math.min(buffer.length,offset+65536))
        const size=Buffer.alloc(4);size.writeUInt32BE(chunk.length,0);socket.write(size);socket.write(chunk)
      }
      socket.write(Buffer.alloc(4))
    })
    socket.on('data',data=>{response+=data.toString('utf8');if(response.includes('\n')){clearTimeout(timer);const clean=/stream:\s+OK\s*/.test(response);finish(clean?resolve:reject,clean?{clean:true}:{message:'Файл отклонён антивирусом',response})}})
    socket.on('error',err=>{clearTimeout(timer);finish(reject,new Error('Антивирусный сканер недоступен: '+err.message))})
    socket.on('close',()=>{clearTimeout(timer);if(!settled){if(/OK\s*$/.test(response))finish(resolve,{clean:true});else finish(reject,new Error('Антивирусный сканер не подтвердил чистоту файла'))}})
  })
}
async function storeProtectedFile(organizationId:string,fileUrl:string,fileType:string){
  const match=/^data:([^;]+);base64,(.*)$/.exec(String(fileUrl||''))
  if(!match)throw new Error('Файл должен быть загружен как data URL')
  const mime=match[1], raw=match[2]
  if(!allowedFileTypes.has(mime)||mime!==fileType)throw new Error('Недопустимый тип файла')
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)||raw.length%4!==0)throw new Error('Некорректное содержимое файла')
  const buffer=Buffer.from(raw,'base64')
  if(!buffer.length||buffer.length>1500000)throw new Error('Размер файла должен быть от 1 байта до 1.5 МБ')
  if(!hasValidFileSignature(mime,buffer))throw new Error('Содержимое файла не соответствует заявленному типу')
  await scanWithClamAV(buffer)
  const storedName=crypto.randomUUID()+'.'+extensionForType(mime)
  if(s3Client){
    const key=organizationId+'/'+storedName
    await s3Client.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET!,Key:key,Body:buffer,ContentType:mime}))
    return {storedName:'s3:'+key,size:buffer.length,mime}
  }
  const dir=path.join(storageRoot,organizationId); await fs.promises.mkdir(dir,{recursive:true})
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

function normalizeDate(value:any){
  if(value==null||value==='')return value
  if(value instanceof Date)return value.toISOString().slice(0,10)
  const s=String(value)
  const match=/^(\d{4}-\d{2}-\d{2})/.exec(s)
  return match?match[1]:value
}
function isValidDate(value:any){
  if(value==null||value==='')return true
  const s=String(normalizeDate(value))
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
const allowedOrigins=(process.env.CORS_ORIGIN||'https://frontend-main-ru-production.up.railway.app,http://localhost:3000,http://localhost:5173,http://localhost:4200').split(',').map(x=>x.trim()).filter(Boolean)
app.use(cors({
  origin:(origin,callback)=>{
    if(!origin||allowedOrigins.includes(origin)||/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin))return callback(null,true)
    return callback(new Error('CORS not allowed'))
  },
  credentials:true,
  methods:['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  allowedHeaders:['Content-Type','Authorization']
}))
app.use(express.json({limit:'2mb'}))
app.use((_req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('X-Frame-Options','DENY')
  res.setHeader('Referrer-Policy','no-referrer')
  res.setHeader('Permissions-Policy','camera=(),microphone=(),geolocation=()')
  next()
})

const loginAttempts=new Map<string,{count:number,blockedUntil:number}>()
function checkLoginRateLimit(key:string){
  const now=Date.now(),entry=loginAttempts.get(key)
  if(!entry||entry.blockedUntil<=now)return true
  return false
}
function recordLoginFailure(key:string){
  const now=Date.now(),entry=loginAttempts.get(key)||{count:0,blockedUntil:0}
  entry.count+=1
  if(entry.count>=8){entry.blockedUntil=now+15*60*1000;entry.count=0}
  loginAttempts.set(key,entry)
}
function clearLoginFailures(key:string){loginAttempts.delete(key)}
function refreshDays(){return Math.max(1,Math.min(30,Number(process.env.REFRESH_TOKEN_DAYS)||7))}


async function audit(req:AuthRequest, action:string, entityType:string, entityId:any, details:any={}) {
  await query('INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',
    [req.user.organization_id,req.user.id,action,entityType,entityId,details])
}

app.get('/api/v1/health',async(_req,res)=>{
  try{await query('SELECT 1');res.json({ok:true,database:'connected'})}
  catch{res.status(503).json({ok:false,database:'unavailable'})}
})

app.post('/api/v1/auth/login',async(req,res)=>{
  const {email,password,twoFactorCode}=req.body||{}
  const clientKey=(req.ip||'unknown')+'|'+String(email||'').trim().toLowerCase()
  if(!checkLoginRateLimit(clientKey))return res.status(429).json({message:'Слишком много попыток входа. Повторите позже.'})
  if(!email||!password)return res.status(400).json({message:'Email and password are required'})
  const r=await query('SELECT * FROM users WHERE lower(email)=lower($1) AND is_active=true',[email])
  const user=r.rows[0]
  if(!user || !(await verifyPassword(password,user.password_hash))){
    recordLoginFailure(clientKey)
    return res.status(401).json({message:'Invalid credentials'})
  }
  if(user.two_factor_enabled){
    if(!twoFactorCode)return res.status(401).json({code:'TWO_FACTOR_REQUIRED',message:'Требуется код двухфакторной аутентификации'})
    const currentStep=Math.floor(Date.now()/1000/30)
    if(Number(user.two_factor_last_used_step||-1)===currentStep || !verifyTwoFactorCode(user.two_factor_secret,twoFactorCode)){
      recordLoginFailure(clientKey)
      return res.status(401).json({message:'Неверный или уже использованный код 2FA'})
    }
    await query('UPDATE users SET two_factor_last_used_step=$1 WHERE id=$2',[currentStep,user.id])
  }
  clearLoginFailures(clientKey)
  const refresh=createRefreshToken()
  await query('DELETE FROM refresh_tokens WHERE user_id=$1 AND (expires_at<NOW() OR revoked_at IS NOT NULL)',[user.id])
  await query('INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+($3::int*INTERVAL \'1 day\'))',[user.id,refresh.hash,refreshDays()])
  res.json({accessToken:signToken(user),refreshToken:refresh.raw,user:{id:user.id,email:user.email,firstName:user.first_name,lastName:user.last_name,role:user.role,twoFactorEnabled:Boolean(user.two_factor_enabled)}})
})

app.get('/api/v1/auth/me',requireAuth,(req:AuthRequest,res)=>res.json({user:req.user}))

app.post('/api/v1/auth/refresh',async(req,res)=>{
  const raw=String(req.body?.refreshToken||'')
  if(!raw)return res.status(400).json({message:'Refresh token is required'})
  const hash=hashRefreshToken(raw)
  const r=await query('SELECT rt.*,u.id user_id,u.email,u.first_name,u.last_name,u.organization_id,u.role,u.is_active,u.two_factor_enabled FROM refresh_tokens rt JOIN users u ON u.id=rt.user_id WHERE rt.token_hash=$1 AND rt.revoked_at IS NULL AND rt.expires_at>NOW()',[hash])
  const row=r.rows[0]
  if(!row||!row.is_active)return res.status(401).json({message:'Invalid or expired refresh token'})
  const nextToken=createRefreshToken()
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query('UPDATE refresh_tokens SET revoked_at=NOW(),replaced_by_hash=$1 WHERE token_hash=$2 AND revoked_at IS NULL',[nextToken.hash,hash])
    await client.query('INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+($3::int*INTERVAL \'1 day\'))',[row.user_id,nextToken.hash,refreshDays()])
    await client.query('DELETE FROM refresh_tokens WHERE user_id=$1 AND (expires_at<NOW() OR revoked_at IS NOT NULL)',[row.user_id])
    await client.query('COMMIT')
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  const user={id:row.user_id,email:row.email,first_name:row.first_name,last_name:row.last_name,organization_id:row.organization_id,role:row.role}
  res.json({accessToken:signToken(user),refreshToken:nextToken.raw,user:{id:user.id,email:user.email,firstName:user.first_name,lastName:user.last_name,role:user.role,twoFactorEnabled:Boolean(row.two_factor_enabled)}})
})

app.post('/api/v1/auth/logout',async(req,res)=>{
  const raw=String(req.body?.refreshToken||'')
  if(raw)await query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE token_hash=$1',[hashRefreshToken(raw)])
  res.json({ok:true})
})

app.post('/api/v1/auth/2fa/setup',requireAuth,async(req:AuthRequest,res)=>{
  const secretValue=createTwoFactorSecret()
  await query('UPDATE users SET two_factor_secret=$1,two_factor_enabled=false,two_factor_last_used_step=NULL WHERE id=$2',[secretValue,req.user.id])
  res.json({secret:secretValue,otpauthUri:twoFactorUri(req.user.email,secretValue),message:'Секрет создан. Добавьте его в приложение-аутентификатор и подтвердите кодом.'})
})

app.post('/api/v1/auth/2fa/enable',requireAuth,async(req:AuthRequest,res)=>{
  const code=String(req.body?.code||'')
  const r=await query('SELECT two_factor_secret FROM users WHERE id=$1',[req.user.id])
  const secretValue=r.rows[0]?.two_factor_secret
  const currentStep=Math.floor(Date.now()/1000/30)
  if(!secretValue||!verifyTwoFactorCode(secretValue,code))return res.status(400).json({message:'Неверный код 2FA'})
  await query('UPDATE users SET two_factor_enabled=true,two_factor_last_used_step=$1 WHERE id=$2',[currentStep,req.user.id])
  res.json({ok:true,twoFactorEnabled:true})
})

app.post('/api/v1/auth/2fa/disable',requireAuth,async(req:AuthRequest,res)=>{
  const {password,code}=req.body||{}
  const r=await query('SELECT password_hash,two_factor_secret,two_factor_enabled FROM users WHERE id=$1',[req.user.id])
  const row=r.rows[0]
  if(!row||!(await verifyPassword(String(password||''),row.password_hash)))return res.status(400).json({message:'Неверный пароль'})
  if(row.two_factor_enabled&&!verifyTwoFactorCode(row.two_factor_secret,String(code||'')))return res.status(400).json({message:'Неверный код 2FA'})
  await query('UPDATE users SET two_factor_enabled=false,two_factor_secret=NULL,two_factor_last_used_step=NULL WHERE id=$1',[req.user.id])
  res.json({ok:true,twoFactorEnabled:false})
})

app.post('/api/v1/foreigners/import',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN','OPERATOR'),async(req:AuthRequest,res)=>{
  const rows=Array.isArray(req.body?.rows)?req.body.rows:[]
  if(!rows.length)return res.status(400).json({message:'Нет данных для импорта'})
  if(rows.length>500)return res.status(400).json({message:'За один импорт можно загрузить не более 500 записей'})
  const imported:any[]=[],errors:any[]=[]
  for(let index=0;index<rows.length;index++){
    const x=rows[index]||{}
    if(!x.firstName||!x.lastName){errors.push({row:index+1,message:'Имя и фамилия обязательны'});continue}
    if(hasInvalidDate(x.birthDate,x.entryDate,x.insuranceEndDate)){errors.push({row:index+1,message:'Некорректная дата: используйте ГГГГ-ММ-ДД'});continue}
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
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(email)))return res.status(400).json({message:'Некорректный email'})
  if(String(password).length<12)return res.status(400).json({message:'Пароль должен содержать не менее 12 символов'})
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
  if(role!==undefined && !['ORG_ADMIN','OPERATOR','VIEWER'].includes(role))return res.status(400).json({message:'Недопустимая роль'})
  if(req.user.role==='ORG_ADMIN' && role==='ORG_ADMIN' && own.rows[0].role!=='ORG_ADMIN')return res.status(403).json({message:'ORG_ADMIN не может назначать роль администратора'})
  if(password!==undefined && password!==null && String(password).length<12)return res.status(400).json({message:'Пароль должен содержать не менее 12 символов'})
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
  if(hasInvalidDate(birthDate,entryDate,insuranceEndDate))return res.status(400).json({message:'Некорректный формат даты. Используйте ГГГГ-ММ-ДД'})
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


app.get('/api/v1/registrations',requireAuth,async(req:AuthRequest,res)=>{
  const page=Math.max(1,Number(req.query.page)||1),pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||25)),offset=(page-1)*pageSize
  const base=`FROM registrations r JOIN foreigners f ON f.id=r.foreigner_id WHERE f.organization_id=$1 AND f.status<>'ARCHIVED'`
  const count=await query(`SELECT COUNT(*)::int AS total ${base}`,[req.user.organization_id])
  const r=await query(`SELECT r.*,f.first_name,f.last_name,f.citizenship ${base} ORDER BY r.end_date ASC NULLS LAST LIMIT $2 OFFSET $3`,[req.user.organization_id,pageSize,offset])
  res.json({data:r.rows,total:Number(count.rows[0]?.total||0),page,pageSize})
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
  const startDate=normalizeDate(body.startDate??old.start_date), endDate=normalizeDate(body.endDate??old.end_date), status=body.status??old.status, governmentReference=body.governmentReference??old.government_reference
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
  const issueDate=normalizeDate(body.issueDate??old.issue_date), expiryDate=normalizeDate(body.expiryDate??old.expiry_date)
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
  const visaType=body.visaType??old.visa_type, visaNumber=body.visaNumber??old.visa_number
  const issueDate=normalizeDate(body.issueDate??old.issue_date), startDate=normalizeDate(body.startDate??old.start_date), endDate=normalizeDate(body.endDate??old.end_date)
  const status=body.status??old.status, notes=body.notes??old.notes
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
    const previous=await query("SELECT id,file_url FROM foreigner_files WHERE foreigner_id=$1 AND kind='PHOTO' ORDER BY created_at DESC",[foreignerId])
    const stored=await storeProtectedPhoto(req.user.organization_id,fileUrl)
    const r=await query("INSERT INTO foreigner_files(foreigner_id,file_name,file_url,file_type,file_size,kind) VALUES($1,$2,$3,$4,$5,'PHOTO') RETURNING id,file_name,file_type,file_size,kind",[
      foreignerId,'photo'+extensionForType(stored.mime),stored.storedName,stored.mime,stored.size
    ])
    await query('UPDATE foreigners SET photo_url=$1,updated_at=now() WHERE id=$2 AND organization_id=$3',['/api/v1/files/'+r.rows[0].id+'/download',foreignerId,req.user.organization_id])
    for(const old of previous.rows){
      const oldName=String(old.file_url||'')
      if(old.id!==r.rows[0].id){
        if(oldName.startsWith('s3:')&&s3Client){
          await s3Client.send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET!,Key:oldName.slice(3)})).catch(()=>{})
        }else if(/^[a-f0-9-]{36}\.(pdf|jpg|png|webp|txt)$/.test(oldName)){
          await fs.promises.unlink(path.join(storageRoot,req.user.organization_id,oldName)).catch(()=>{})
        }
        await query('DELETE FROM foreigner_files WHERE id=$1',[old.id])
      }
    }
    await audit(req,'UPDATE','FOREIGNER',foreignerId,{photoFileId:r.rows[0].id,replacedPhotoCount:previous.rows.length})
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
    const r=await query('INSERT INTO foreigner_files(foreigner_id,file_name,file_url,file_type,file_size) VALUES($1,$2,$3,$4,$5) RETURNING *',[foreignerId,safeFileName(fileName),stored.storedName,stored.mime,stored.size])
    await audit(req,'CREATE','FILE',r.rows[0].id,{fileName,fileSize:stored.size})
    res.status(201).json({...r.rows[0],downloadUrl:'/api/v1/files/'+r.rows[0].id+'/download'})
  }catch(e:any){res.status(400).json({message:e?.message||'Не удалось сохранить файл'})}
})
app.get('/api/v1/files/:id/download',requireAuth,async(req:AuthRequest,res)=>{
  const r=await query('SELECT ff.*,f.organization_id FROM foreigner_files ff JOIN foreigners f ON f.id=ff.foreigner_id WHERE ff.id=$1 AND f.organization_id=$2',[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Файл не найден'})
  const file=r.rows[0]
  const storedName=String(file.file_url||'')
  res.type(file.file_type||'application/octet-stream')
  res.setHeader('Content-Disposition','attachment; filename*=UTF-8\'\''+encodeURIComponent(String(file.file_name||'file')))
  try{
    if(storedName.startsWith('s3:')&&s3Client){
      const object=await s3Client.send(new GetObjectCommand({Bucket:process.env.S3_BUCKET!,Key:storedName.slice(3)}))
      const body:any=object.Body
      const chunks:Buffer[]=[]
      for await(const chunk of body)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk))
      return res.send(Buffer.concat(chunks))
    }
    if(!/^[a-f0-9-]{36}\.(pdf|jpg|png|webp|txt)$/.test(storedName))return res.status(404).json({message:'Файл отсутствует в защищённом хранилище'})
    const fullPath=path.join(storageRoot,req.user.organization_id,storedName)
    await fs.promises.access(fullPath)
    return res.sendFile(fullPath)
  }catch{return res.status(404).json({message:'Файл отсутствует в хранилище'})}
})
app.delete('/api/v1/files/:id',requireAuth,allow('SUPER_ADMIN','ORG_ADMIN'),async(req:AuthRequest,res)=>{
  const r=await query('SELECT ff.id,ff.file_url,f.organization_id FROM foreigner_files ff JOIN foreigners f ON f.id=ff.foreigner_id WHERE ff.id=$1 AND f.organization_id=$2',[req.params.id,req.user.organization_id])
  if(!r.rowCount)return res.status(404).json({message:'Файл не найден'})
  const storedName=String(r.rows[0].file_url||'')
  if(storedName.startsWith('s3:')&&s3Client)await s3Client.send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET!,Key:storedName.slice(3)})).catch(()=>{})
  else if(/^[a-f0-9-]{36}\.(pdf|jpg|png|webp|txt)$/.test(storedName)){
    const fullPath=path.join(storageRoot,req.user.organization_id,storedName)
    await fs.promises.unlink(fullPath).catch(()=>{})
  }
  await query('DELETE FROM foreigner_files WHERE id=$1',[req.params.id])
  await audit(req,'DELETE','FILE',req.params.id)
  res.json({ok:true})
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