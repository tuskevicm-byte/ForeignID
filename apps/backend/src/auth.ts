import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import {Request,Response,NextFunction} from 'express'
import {query} from './db.js'

const secret=process.env.JWT_SECRET || 'dev-only-secret-change-me'

export async function hashPassword(password:string){return bcrypt.hash(password,12)}
export async function verifyPassword(password:string,hash:string){return bcrypt.compare(password,hash)}

export function signToken(user:any){
  return jwt.sign({sub:user.id,organizationId:user.organization_id,role:user.role,email:user.email},secret,{expiresIn:(process.env.JWT_EXPIRES_IN||'15m') as any})
}

export type AuthRequest=Request & {user?:any}

export async function requireAuth(req:AuthRequest,res:Response,next:NextFunction){
  try{
    const raw=req.headers.authorization?.replace('Bearer ','')
    if(!raw) return res.status(401).json({message:'Authentication required'})
    const payload=jwt.verify(raw,secret) as any
    const result=await query('SELECT id,email,first_name,last_name,organization_id,role,is_active FROM users WHERE id=$1',[payload.sub])
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
