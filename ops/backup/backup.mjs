import {spawn} from 'node:child_process'
import {S3Client,PutObjectCommand,ListObjectsV2Command,DeleteObjectsCommand} from '@aws-sdk/client-s3'

const dbUrl=process.env.DATABASE_URL
const endpoint=process.env.S3_ENDPOINT
const bucket=process.env.S3_BUCKET
const region=process.env.S3_REGION||'auto'
const accessKeyId=process.env.S3_ACCESS_KEY_ID
const secretAccessKey=process.env.S3_SECRET_ACCESS_KEY
const retentionDays=Math.max(7,Number(process.env.BACKUP_RETENTION_DAYS)||30)

if(!dbUrl||!endpoint||!bucket||!accessKeyId||!secretAccessKey)throw new Error('Backup configuration is incomplete')

const s3=new S3Client({region,endpoint,forcePathStyle:String(process.env.S3_FORCE_PATH_STYLE||'false')==='true',credentials:{accessKeyId,secretAccessKey}})

function dumpDatabase(){
  return new Promise((resolve,reject)=>{
    const p=spawn('pg_dump',['--dbname',dbUrl,'--format=custom','--no-owner','--no-privileges'],{env:{...process.env}})
    const chunks=[]
    const errors=[]
    p.stdout.on('data',x=>chunks.push(x))
    p.stderr.on('data',x=>errors.push(x))
    p.on('error',reject)
    p.on('close',code=>{
      if(code!==0)return reject(new Error(Buffer.concat(errors).toString('utf8').slice(0,2000)||'pg_dump failed'))
      resolve(Buffer.concat(chunks))
    })
  })
}

const pad=n=>String(n).padStart(2,'0')
const d=new Date()
const stamp=d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate())+'-'+pad(d.getUTCHours())+pad(d.getUTCMinutes())+pad(d.getUTCSeconds())
const key='backups/foreignid-'+stamp+'.dump'
const dump=await dumpDatabase()
await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:dump,ContentType:'application/octet-stream',Metadata:{source:'ForeignID PostgreSQL backup'}}))

const cutoff=Date.now()-retentionDays*86400000
let continuationToken
let removed=0
do{
  const page=await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:'backups/',ContinuationToken:continuationToken}))
  const expired=(page.Contents||[]).filter(x=>x.Key&&x.LastModified&&x.LastModified.getTime()<cutoff)
  if(expired.length){
    await s3.send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Objects:expired.map(x=>({Key:x.Key})),Quiet:true}}))
    removed+=expired.length
  }
  continuationToken=page.NextContinuationToken
}while(continuationToken)

console.log(JSON.stringify({ok:true,key,size:dump.length,retentionDays,removedAtStart:removed}))
