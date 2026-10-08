import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import {Request,Response,NextFunction} from 'express'
import {query} from './db.js'

const secret=process.env.JWT_SECRET||''
if(secret.length<32) throw new Error('JWT_SECRET must be configured and contain at least 32 characters')

export async function hashPassword(password:string){return bcrypt.hash(password,12)}
export async function verifyPassword(password:string,hash:string){return bcrypt.compare(password,hash)}

export function signToken(user:any){
  return jwt.sign(
    {sub:user.id,organizationId:user.organization_id,role:user.role,email:user.email},
    secret,
    {expiresIn:(process.env.JWT_EXPIRES_IN||'15m') as any}
  )
}

export function createRefreshToken(){
  const raw=crypto.randomBytes(48).toString('base64url')
  return {raw,hash:hashRefreshToken(raw)}
}

export function hashRefreshToken(raw:string){
  return crypto.createHash('sha256').update(String(raw)).digest('hex')
}

function base32Decode(value:string){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const normalized=String(value||'').replace(/=+$/,'').toUpperCase().replace(/[^A-Z2-7]/g,'')
  let bits=0,buffer=0; const out:number[]=[]
  for(const ch of normalized){
    const n=alphabet.indexOf(ch); if(n<0)continue
    buffer=(buffer<<5)|n; bits+=5
    if(bits>=8){bits-=8;out.push((buffer>>bits)&255)}
  }
  return Buffer.from(out)
}

function base32Encode(buffer:Buffer){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits=0,value=0,out=''
  for(const byte of buffer){
    value=(value<<8)|byte;bits+=8
    while(bits>=5){bits-=5;out+=alphabet[(value>>bits)&31]}
  }
  if(bits>0)out+=alphabet[(value<<(5-bits))&31]
  return out
}

export function createTwoFactorSecret(){
  return base32Encode(crypto.randomBytes(20))
}

export function twoFactorUri(email:string,secretValue:string){
  return 'otpauth://totp/ForeignID:'+encodeURIComponent(email)+'?secret='+secretValue+'&issuer=ForeignID&algorithm=SHA1&digits=6&period=30'
}

export function verifyTwoFactorCode(secretValue:string,code:string,window=1){
  const cleaned=String(code||'').replace(/\D/g,'')
  if(cleaned.length!==6)return false
  const key=base32Decode(secretValue)
  const counter=Math.floor(Date.now()/1000/30)
  for(let delta=-window;delta<=window;delta++){
    const buf=Buffer.alloc(8)
    buf.writeBigInt64BE(BigInt(counter+delta),0)
    const h=crypto.createHmac('sha1',key).update(buf).digest()
    const offset=h[h.length-1]&0x0f
    const binary=((h[offset]&0x7f)<<24)|((h[offset+1]&0xff)<<16)|((h[offset+2]&0xff)<<8)|(h[offset+3]&0xff)
    const expected=String(binary%1000000).padStart(6,'0')
    if(crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(cleaned)))return true
  }
  return false
}

export type AuthRequest=Request & {user?:any}

export async function requireAuth(req:AuthRequest,res:Response,next:NextFunction){
  try{
    const raw=req.headers.authorization?.replace('Bearer ','')
    if(!raw) return res.status(401).json({message:'Authentication required'})
    const payload=jwt.verify(raw,secret) as any
    const result=await query('SELECT id,email,first_name,last_name,organization_id,role,is_active,two_factor_enabled FROM users WHERE id=$1',[payload.sub])
    const user=result.rows[0]
    if(!user || !user.is_active) return res.status(401).json({message:'Invalid user'})
    req.user=user
    next()
  }catch{ return res.status(401).json({message:'Invalid or expired token'})}
}

export function allow(...roles:string[]){
  return (req:AuthRequest,res:Response,next:NextFunction)=>{
    if(!req.user || !roles.includes(req.user.role)) return res.status(403).json({message:'Forbidden'})
    next()
  }
}