import pg,{QueryResultRow} from 'pg'
import 'dotenv/config'
const {Pool}=pg
export const pool=new Pool({connectionString:process.env.DATABASE_URL})
export async function query<T extends QueryResultRow=any>(text:string,params:any[]=[]){return pool.query<T>(text,params)}
