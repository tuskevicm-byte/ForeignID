import 'dotenv/config'
import {query,pool} from './db.js'
import {hashPassword} from './auth.js'

const people=[
['Александр','Иванов','Россия'],['Михаил','Петров','Казахстан'],['Дмитрий','Сидоров','Узбекистан'],
['Иван','Смирнов','Армения'],['Сергей','Кузнецов','Грузия'],['Алексей','Попов','Киргизия'],
['Андрей','Волков','Россия'],['Николай','Соколов','Казахстан'],['Максим','Морозов','Узбекистан'],
['Виктор','Федоров','Армения'],['Роман','Никитин','Грузия'],['Евгений','Орлов','Киргизия'],
['Олег','Алексеев','Россия'],['Павел','Лебедев','Казахстан'],['Артур','Козлов','Узбекистан'],
['Рустам','Новиков','Армения'],['Тимур','Макаров','Грузия'],['Илья','Зайцев','Киргизия'],
['Денис','Белов','Россия'],['Владимир','Комаров','Казахстан'],['Антон','Громов','Узбекистан'],
['Кирилл','Власов','Армения'],['Степан','Тихонов','Грузия'],['Ринат','Фомин','Киргизия'],
['Марат','Королев','Россия'],['Эльдар','Данилов','Казахстан'],['Руслан','Баранов','Узбекистан'],
['Богдан','Ершов','Армения'],['Георгий','Абрамов','Грузия'],['Вадим','Тарасов','Киргизия']
]

const run=async()=>{
  const existing=await query<{id:string}>("SELECT organization_id id FROM users WHERE lower(email)=lower($1)",['admin@example.local'])
  let orgId=existing.rows[0]?.id
  if(!orgId){
    const org=await query<{id:string}>('INSERT INTO organizations(name) VALUES($1) RETURNING id',['Demo Organization'])
    orgId=org.rows[0].id
  }
  const password=await hashPassword('ChangeMe-123!')
  await query(
    'INSERT INTO users(organization_id,email,password_hash,first_name,last_name,role) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO UPDATE SET organization_id=EXCLUDED.organization_id',
    [orgId,'admin@example.local',password,'Иван','Иванов','ORG_ADMIN']
  )

  for(let i=0;i<people.length;i++){
    const [first,last,citizenship]=people[i]
    const email=`demo${i+1}@foreignid.local`
    const f=await query<{id:string}>(
      `INSERT INTO foreigners(organization_id,first_name,last_name,citizenship,birth_date,email,status)
       SELECT $1,$2,$3,$4,(CURRENT_DATE - (($5::int)*365 + 10000)), $6,'ACTIVE'
       WHERE NOT EXISTS (SELECT 1 FROM foreigners WHERE organization_id=$1 AND email=$6)
       RETURNING id`,
      [orgId,first,last,citizenship,i,email]
    )
    let foreignerId=f.rows[0]?.id
    if(!foreignerId){
      const found=await query<{id:string}>('SELECT id FROM foreigners WHERE organization_id=$1 AND email=$2 LIMIT 1',[orgId,email])
      foreignerId=found.rows[0].id
    }

    const endOffset=i<5 ? -(i+1) : i<15 ? 5 : 60
    await query(
      `INSERT INTO visas(foreigner_id,visa_type,visa_number,issue_date,start_date,end_date,status,notes)
       SELECT $1,'WORK', $2, CURRENT_DATE-30, CURRENT_DATE-29, CURRENT_DATE+$3,'ACTIVE','Demo data'
       WHERE NOT EXISTS (SELECT 1 FROM visas WHERE foreigner_id=$1)`,
      [foreignerId,`DEMO-VISA-${i+1}`,endOffset]
    )
    await query(
      `INSERT INTO identity_documents(foreigner_id,document_type,document_number,issuing_country,issue_date,expiry_date)
       SELECT $1,'PASSPORT',$2,$3,CURRENT_DATE-365,CURRENT_DATE+365
       WHERE NOT EXISTS (SELECT 1 FROM identity_documents WHERE foreigner_id=$1)`,
      [foreignerId,`DEMO-PASSPORT-${i+1}`,citizenship]
    )
    await query(
      `INSERT INTO registrations(foreigner_id,registration_type,registration_number,start_date,end_date,status)
       SELECT $1,'TEMPORARY_STAY',$2,CURRENT_DATE-30,CURRENT_DATE+60,'ACTIVE'
       WHERE NOT EXISTS (SELECT 1 FROM registrations WHERE foreigner_id=$1)`,
      [foreignerId,`DEMO-REG-${i+1}`]
    )
  }

  const check=await query(`SELECT count(*)::int foreigners,
    count(*) FILTER (WHERE v.end_date < CURRENT_DATE)::int expired,
    count(*) FILTER (WHERE v.end_date = CURRENT_DATE + 5)::int expiring_in_5_days,
    count(*) FILTER (WHERE v.end_date > CURRENT_DATE + 5)::int normal
    FROM foreigners f LEFT JOIN visas v ON v.foreigner_id=f.id
    WHERE f.organization_id=$1 AND f.email LIKE 'demo%@foreignid.local' AND f.status<>'ARCHIVED'`,[orgId])
  console.log('Seed complete',check.rows[0])
  await pool.end()
}
run().catch(e=>{console.error(e);process.exit(1)})
