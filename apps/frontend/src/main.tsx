import React from 'react'
import {createRoot} from 'react-dom/client'
import './styles.css'

const API=import.meta.env.VITE_API_URL||'http://localhost:3000/api/v1'
const empty={firstName:'',middleName:'',lastName:'',citizenship:'',birthDate:'',phone:'',email:''}

function App(){
  const [token,setToken]=React.useState(localStorage.getItem('token'))
  const [email,setEmail]=React.useState('admin@example.local')
  const [password,setPassword]=React.useState('ChangeMe-123!')
  const [active,setActive]=React.useState('Главная')
  const [q,setQ]=React.useState('')
  const [error,setError]=React.useState('')
  const [foreigners,setForeigners]=React.useState<any[]>([])
  const [selected,setSelected]=React.useState<any>(null)
  const [show,setShow]=React.useState(false)
  const [form,setForm]=React.useState(empty)
  const [doc,setDoc]=React.useState({documentType:'Паспорт',documentNumber:'',issuingCountry:'',issueDate:'',expiryDate:''})
  const [visa,setVisa]=React.useState({visaType:'Рабочая',visaNumber:'',issueDate:'',startDate:'',endDate:'',notes:''})
  const [data,setData]=React.useState<any>({})
  const [saving,setSaving]=React.useState(false)

  async function api(path:string,opts:any={}){
    const headers:any={'Content-Type':'application/json',...(opts.headers||{})}
    if(token)headers.Authorization='Bearer '+token
    const r=await fetch(API+path,{...opts,headers})
    const d=await r.json().catch(()=>({}))
    if(!r.ok)throw new Error(d.message||'Ошибка запроса')
    return d
  }
  async function login(e:any){
    e.preventDefault();setError('')
    try{
      const d=await api('/auth/login',{method:'POST',headers:{},body:JSON.stringify({email,password})})
      localStorage.setItem('token',d.accessToken);setToken(d.accessToken)
    }catch(e:any){setError(e.message)}
  }
  async function loadForeigners(){
    if(!token)return
    try{const d=await api('/foreigners?q='+encodeURIComponent(q));setForeigners(d.data||[])}
    catch(e:any){setError(e.message)}
  }
  async function loadSection(){
    if(!token)return
    setError('')
    try{
      if(active==='Главная'||active==='Отчёты')setData(await api('/dashboard'))
      if(active==='Контроль сроков')setData(await api('/deadlines'))
      if(active==='Документы'){const [d,v]=await Promise.all([api('/documents'),api('/visas')]);setData({documents:d.data||[],visas:v.data||[]})}
      if(active==='История')setData(await api('/history'))
      if(active==='Е-паслуга')setData(await api('/applications'))
    }catch(e:any){setError(e.message)}
  }
  React.useEffect(()=>{loadForeigners()},[token,q])
  React.useEffect(()=>{loadSection()},[token,active])

  async function saveForeigner(e:any){
    e.preventDefault();setSaving(true)
    try{await api('/foreigners',{method:'POST',body:JSON.stringify(form)});setShow(false);setForm(empty);await loadForeigners()}
    catch(e:any){setError(e.message)}finally{setSaving(false)}
  }
  async function openForeigner(x:any){try{setSelected(await api('/foreigners/'+x.id))}catch(e:any){setError(e.message)}}
  async function archive(id:string){
    if(!window.confirm('Архивировать запись?'))return
    try{await api('/foreigners/'+id,{method:'DELETE'});setSelected(null);await loadForeigners()}
    catch(e:any){setError(e.message)}
  }
  async function saveDoc(e:any){
    e.preventDefault()
    try{await api('/documents',{method:'POST',body:JSON.stringify({...doc,foreignerId:selected.foreigner.id})});setDoc({documentType:'Паспорт',documentNumber:'',issuingCountry:'',issueDate:'',expiryDate:''});await openForeigner(selected.foreigner)}
    catch(e:any){setError(e.message)}
  }
  async function saveVisa(e:any){
    e.preventDefault()
    try{await api('/visas',{method:'POST',body:JSON.stringify({...visa,foreignerId:selected.foreigner.id})});setVisa({visaType:'Рабочая',visaNumber:'',issueDate:'',startDate:'',endDate:'',notes:''});await openForeigner(selected.foreigner)}
    catch(e:any){setError(e.message)}
  }

  if(!token)return <div className="login"><form onSubmit={login}><h1>ForeignID</h1><p>Система учета иностранных граждан</p><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email"/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Пароль"/>{error&&<div className="error">{error}</div>}<button className="primary">Войти</button><small>Демо: admin@example.local / ChangeMe-123!</small></form></div>

  const nav=['Главная','Иностранцы','Контроль сроков','Е-паслуга','Документы','Отчёты','История','Настройки']
  const stats=(n:any,l:string)=><div className="stat"><b>{n??0}</b><span>{l}</span></div>

  function Dashboard(){return <><h1>Главная</h1><p className="muted">Единая рабочая панель ForeignID</p><div className="cards">{stats(data.foreigners,'Иностранцев')}{stats(data.documents,'Документов')}{stats(data.visas,'Активных виз')}{stats(data.registrations,'Регистраций')}{stats(data.todayActions,'Операций сегодня')}</div><div className="panel pad"><h2>Что контролируется</h2><p>Паспорта и другие документы, визы и разрешения, регистрации и история изменений.</p></div></>}

  function Foreigners(){
    return <><div className="page-title-row"><div><h1>Иностранцы</h1><p className="muted">Карточка, документы, визы и сроки</p></div><button className="primary" onClick={()=>setShow(true)}>+ Добавить иностранца</button></div>{error&&<div className="error">{error}</div>}<div className="panel"><table><thead><tr><th>ФИО</th><th>Гражданство</th><th>Документ</th><th>Виза до</th><th>Регистрация до</th><th></th></tr></thead><tbody>{foreigners.filter(x=>x.status!=='ARCHIVED').map(x=><tr key={x.id}><td><button className="link" onClick={()=>openForeigner(x)}>{x.last_name} {x.first_name} {x.middle_name||''}</button></td><td>{x.citizenship}</td><td>{x.document?.document_number||'—'}</td><td>{x.visa?.end_date||'—'}</td><td>{x.registration?.end_date||'—'}</td><td><button onClick={()=>openForeigner(x)}>Открыть</button></td></tr>)}</tbody></table></div>
      {show&&<div className="modal-backdrop"><div className="modal"><div className="modal-header"><h2>Добавить иностранца</h2><button onClick={()=>setShow(false)}>×</button></div><form onSubmit={saveForeigner}><div className="form-grid">{[['Имя *','firstName'],['Фамилия *','lastName'],['Отчество','middleName'],['Гражданство *','citizenship'],['Дата рождения','birthDate'],['Телефон','phone'],['Email','email']].map(([label,name]:any)=><label key={name}>{label}<input type={name==='birthDate'?'date':name==='email'?'email':'text'} required={label.includes('*')} value={(form as any)[name]} onChange={e=>setForm({...form,[name]:e.target.value})}/></label>)}</div><div className="modal-actions"><button type="button" onClick={()=>setShow(false)}>Отмена</button><button className="primary" disabled={saving}>{saving?'Сохранение...':'Сохранить'}</button></div></form></div></div>}</>
  }

  function Detail(){
    if(!selected)return null
    const f=selected.foreigner
    return <><button className="back" onClick={()=>setSelected(null)}>← К списку</button><div className="page-title-row"><div><h1>{f.last_name} {f.first_name} {f.middle_name||''}</h1><p className="muted">{f.citizenship} · {f.birth_date||'дата рождения не указана'}</p></div><button className="danger" onClick={()=>archive(f.id)}>Архивировать</button></div>
      <div className="grid2">
        <div className="panel pad"><h2>Персональные данные</h2><p>Телефон: {f.phone||'—'}</p><p>Email: {f.email||'—'}</p></div>
        <div className="panel pad"><h2>Документы</h2>{selected.documents.length?selected.documents.map((d:any)=><div className="record" key={d.id}><b>{d.document_type} №{d.document_number}</b><span>до {d.expiry_date}</span></div>):<p className="muted">Документов нет</p>}</div>
        <div className="panel pad"><h2>Добавить документ</h2><form onSubmit={saveDoc} className="stack"><input placeholder="Тип документа" value={doc.documentType} onChange={e=>setDoc({...doc,documentType:e.target.value})}/><input placeholder="Номер" required value={doc.documentNumber} onChange={e=>setDoc({...doc,documentNumber:e.target.value})}/><input placeholder="Страна выдачи" value={doc.issuingCountry} onChange={e=>setDoc({...doc,issuingCountry:e.target.value})}/><label>Дата выдачи<input type="date" value={doc.issueDate} onChange={e=>setDoc({...doc,issueDate:e.target.value})}/></label><label>Срок действия *<input type="date" required value={doc.expiryDate} onChange={e=>setDoc({...doc,expiryDate:e.target.value})}/></label><button className="primary">Сохранить документ</button></form></div>
        <div className="panel pad"><h2>Визы и разрешения</h2>{selected.visas.length?selected.visas.map((v:any)=><div className="record" key={v.id}><b>{v.visa_type}{v.visa_number?' №'+v.visa_number:''}</b><span>до {v.end_date}</span></div>):<p className="muted">Виз нет</p>}<form onSubmit={saveVisa} className="stack"><h3>Добавить визу / разрешение</h3><input placeholder="Тип визы" required value={visa.visaType} onChange={e=>setVisa({...visa,visaType:e.target.value})}/><input placeholder="Номер" value={visa.visaNumber} onChange={e=>setVisa({...visa,visaNumber:e.target.value})}/><label>Начало<input type="date" value={visa.startDate} onChange={e=>setVisa({...visa,startDate:e.target.value})}/></label><label>Окончание *<input type="date" required value={visa.endDate} onChange={e=>setVisa({...visa,endDate:e.target.value})}/></label><textarea placeholder="Примечание" value={visa.notes} onChange={e=>setVisa({...visa,notes:e.target.value})}/><button className="primary">Сохранить визу</button></form></div>
      </div></>
  }

  function Section(){
    if(active==='Главная')return <Dashboard/>
    if(active==='Иностранцы')return <Foreigners/>
    if(active==='Настройки')return <div className="panel pad"><h1>Настройки</h1><p>Роль: ORG_ADMIN</p><p className="muted">Параметры организации и доступа.</p></div>
    if(active==='Контроль сроков')return <><h1>Контроль сроков</h1><p className="muted">Документы, визы и регистрации с ближайшими сроками.</p><div className="panel"><table><thead><tr><th>ФИО</th><th>Тип</th><th>Запись</th><th>Дата окончания</th><th>Статус</th></tr></thead><tbody>{(data.data||[]).map((x:any)=><tr key={x.item_type+x.item_name+x.end_date}><td>{x.last_name} {x.first_name}</td><td>{x.item_type}</td><td>{x.item_name}</td><td>{x.end_date}</td><td><span className={x.deadline_status==='EXPIRED'?'bad':'warn'}>{x.deadline_status==='EXPIRED'?'ПРОСРОЧЕНО':'СКОРО'}</span></td></tr>)}</tbody></table></div></>
    if(active==='Документы')return <><h1>Документы</h1><p className="muted">Реестр документов и виз.</p><div className="grid2"><div className="panel pad"><h2>Документы</h2>{(data.documents||[]).map((d:any)=><div className="record" key={d.id}><b>{d.last_name} {d.first_name}</b><span>{d.document_type} №{d.document_number} · до {d.expiry_date}</span></div>)}</div><div className="panel pad"><h2>Визы</h2>{(data.visas||[]).map((v:any)=><div className="record" key={v.id}><b>{v.last_name} {v.first_name}</b><span>{v.visa_type} · до {v.end_date}</span></div>)}</div></div></>
    if(active==='История')return <><h1>История</h1><p className="muted">Последние 100 операций.</p><div className="panel">{(data.data||[]).map((x:any)=><div className="history" key={x.id}><b>{x.action} · {x.entity_type}</b><span>{new Date(x.created_at).toLocaleString()} · {x.first_name||'система'}</span></div>)}</div></>
    if(active==='Е-паслуга')return <><h1>Е-паслуга</h1><p className="muted">Заявки, подготовленные для передачи через официальный государственный сервис.</p><div className="panel">{(data.data||[]).length?(data.data||[]).map((x:any)=><div className="history" key={x.id}><b>{x.service_type}</b><span>{x.last_name||''} {x.first_name||''} · {x.status}</span></div>):<div className="pad">Заявок пока нет.</div>}</div></>
    if(active==='Отчёты')return <div className="panel pad"><h1>Отчёты</h1><p>Сводка по организации</p><ul><li>Иностранцев: {data.foreigners}</li><li>Документов: {data.documents}</li><li>Активных виз: {data.visas}</li><li>Регистраций: {data.registrations}</li></ul></div>
    return null
  }

  return <div className="app"><aside><h2>◈ ForeignID</h2>{nav.map(x=><button key={x} className={'nav '+(active===x?'active':'')} onClick={()=>{setActive(x);setSelected(null)}}>{x}</button>)}<button className="logout" onClick={()=>{localStorage.removeItem('token');setToken(null)}}>Выйти</button></aside><main><header><input placeholder="Поиск по ФИО, гражданству..." value={q} onChange={e=>setQ(e.target.value)}/><span>Иванов А.А.</span></header>{selected?<Detail/>:<Section/>}</main></div>
}
createRoot(document.getElementById('root')!).render(<App/>)
