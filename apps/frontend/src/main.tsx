import React from 'react'
import {createRoot} from 'react-dom/client'
import './styles.css'

const API=import.meta.env.VITE_API_URL||'http://localhost:3000/api/v1'
const blank={firstName:'',middleName:'',lastName:'',citizenship:'',birthDate:'',gender:'',phone:'',email:'',entryDate:'',stayBasis:'',stayAddress:'',insuranceCompany:'',insurancePolicyNumber:'',insuranceEndDate:'',photoUrl:''}

function App(){
  const [token,setToken]=React.useState(localStorage.getItem('token'))
  const [email,setEmail]=React.useState('admin@example.local')
  const [password,setPassword]=React.useState('ChangeMe-123!')
  const [active,setActive]=React.useState('Главная')
  const [q,setQ]=React.useState('')
  const [error,setError]=React.useState('')
  const [foreigners,setForeigners]=React.useState<any[]>([])
  const [selected,setSelected]=React.useState<any>(null)
  const [form,setForm]=React.useState<any>(blank)
  const [wizard,setWizard]=React.useState(false)
  const [editing,setEditing]=React.useState(false)
  const [step,setStep]=React.useState(1)
  const [saving,setSaving]=React.useState(false)
  const [data,setData]=React.useState<any>({})
  const [doc,setDoc]=React.useState({documentType:'Паспорт',documentNumber:'',issuingCountry:'',issueDate:'',expiryDate:''})
  const [visa,setVisa]=React.useState({visaType:'Рабочая',visaNumber:'',issueDate:'',startDate:'',endDate:'',notes:''})
  const [registration,setRegistration]=React.useState({registrationType:'TEMPORARY_STAY',registrationNumber:'',startDate:'',endDate:'',governmentReference:''})
  const [editingDocId,setEditingDocId]=React.useState<string|null>(null)
  const [editingVisaId,setEditingVisaId]=React.useState<string|null>(null)
  const [editingRegistrationId,setEditingRegistrationId]=React.useState<string|null>(null)
  const [file,setFile]=React.useState({fileName:'',fileUrl:'',fileType:'',fileSize:''})
  const [savingFile,setSavingFile]=React.useState(false)

  async function api(path:string,opts:any={}){
    const headers:any={'Content-Type':'application/json',...(opts.headers||{})}
    if(token)headers.Authorization='Bearer '+token
    const r=await fetch(API+path,{...opts,headers})
    const d=await r.json().catch(()=>({}))
    if(r.status===401){
      localStorage.removeItem('token')
      setToken('')
      setSelected(null)
      setWizard(false)
      throw new Error('Сессия истекла. Войдите в систему заново.')
    }
    if(!r.ok)throw new Error(d.message||'Ошибка запроса')
    return d
  }
  async function login(e:any){
    e.preventDefault();setError('')
    try{const d=await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});localStorage.setItem('token',d.accessToken);setToken(d.accessToken)}
    catch(e:any){setError(e.message)}
  }
  async function loadForeigners(){
    if(!token)return
    try{const d=await api('/foreigners?q='+encodeURIComponent(q));setForeigners(d.data||[])}
    catch(e:any){setError(e.message)}
  }
  async function loadSection(){
    if(!token)return
    try{
      if(active==='Главная'||active==='Отчёты')setData(await api('/dashboard'))
      else if(active==='Контроль сроков')setData(await api('/deadlines'))
      else if(active==='Документы'){const [d,v]=await Promise.all([api('/documents'),api('/visas')]);setData({documents:d.data||[],visas:v.data||[]})}
      else if(active==='История')setData(await api('/history'))
      else if(active==='Е-паслуга')setData(await api('/applications'))
    }catch(e:any){setError(e.message)}
  }
  React.useEffect(()=>{loadForeigners()},[token,q])
  React.useEffect(()=>{loadSection()},[token,active])

  function startAdd(){setForm({...blank});setDoc({documentType:'Паспорт',documentNumber:'',issuingCountry:'',issueDate:'',expiryDate:''});setVisa({visaType:'Рабочая',visaNumber:'',issueDate:'',startDate:'',endDate:'',notes:''});setRegistration({registrationType:'TEMPORARY_STAY',registrationNumber:'',startDate:'',endDate:'',governmentReference:''});setStep(1);setEditing(false);setEditingDocId(null);setEditingVisaId(null);setEditingRegistrationId(null);setWizard(true);setError('')}
  function startEdit(){if(!selected)return;const f=selected.foreigner;const d=selected.documents?.[0];const v=selected.visas?.[0];const r=selected.registrations?.[0];setForm({...blank,...f,firstName:f.first_name,middleName:f.middle_name||'',lastName:f.last_name,citizenship:f.citizenship,birthDate:f.birth_date||'',gender:f.gender||'',phone:f.phone||'',email:f.email||'',entryDate:f.entry_date||'',stayBasis:f.stay_basis||'',stayAddress:f.stay_address||'',insuranceCompany:f.insurance_company||'',insurancePolicyNumber:f.insurance_policy_number||'',insuranceEndDate:f.insurance_end_date||'',photoUrl:f.photo_url||''});if(d){setDoc({documentType:d.document_type||'Паспорт',documentNumber:d.document_number||'',issuingCountry:d.issuing_country||'',issueDate:d.issue_date||'',expiryDate:d.expiry_date||''});setEditingDocId(d.id)}else setEditingDocId(null);if(v){setVisa({visaType:v.visa_type||'',visaNumber:v.visa_number||'',issueDate:v.issue_date||'',startDate:v.start_date||'',endDate:v.end_date||'',notes:v.notes||''});setEditingVisaId(v.id)}else {setVisa({visaType:'Рабочая',visaNumber:'',issueDate:'',startDate:'',endDate:'',notes:''});setEditingVisaId(null)}if(r){setRegistration({registrationType:r.registration_type||'TEMPORARY_STAY',registrationNumber:r.registration_number||'',startDate:r.start_date||'',endDate:r.end_date||'',governmentReference:r.government_reference||''});setEditingRegistrationId(r.id)}else setEditingRegistrationId(null);setStep(1);setEditing(true);setWizard(true);setError('')}
  async function saveForeigner(e:any){
    e.preventDefault();setSaving(true);setError('')
    try{
      const payload={...form}
      let foreignerId=editing?selected.foreigner.id:''
      if(editing){
        await api('/foreigners/'+selected.foreigner.id,{method:'PATCH',body:JSON.stringify(payload)})
      }else{
        const created=await api('/foreigners',{method:'POST',body:JSON.stringify(payload)})
        foreignerId=created.id
      }
      if(doc.documentNumber&&doc.expiryDate){
        const path=editingDocId?'/documents/'+editingDocId:'/documents'
        const method=editingDocId?'PATCH':'POST'
        await api(path,{method,body:JSON.stringify(editingDocId?doc:{...doc,foreignerId})})
      }
      if(visa.visaType&&visa.endDate){
        const path=editingVisaId?'/visas/'+editingVisaId:'/visas'
        const method=editingVisaId?'PATCH':'POST'
        await api(path,{method,body:JSON.stringify(editingVisaId?visa:{...visa,foreignerId})})
      }
      if(registration.endDate){
        const path=editingRegistrationId?'/registrations/'+editingRegistrationId:'/registrations'
        const method=editingRegistrationId?'PATCH':'POST'
        await api(path,{method,body:JSON.stringify(editingRegistrationId?registration:{...registration,foreignerId})})
      }
      setWizard(false);setEditing(false);setEditingDocId(null);setEditingVisaId(null);setEditingRegistrationId(null);await loadForeigners()
      if(editing)await openForeigner({id:selected.foreigner.id})
      else await openForeigner({id:foreignerId})
    }catch(e:any){setError(e.message)}finally{setSaving(false)}
  }
  async function openForeigner(x:any){try{setSelected(await api('/foreigners/'+x.id))}catch(e:any){setError(e.message)}}
  async function archive(id:string){
    if(!confirm('Архивировать запись?'))return
    try{await api('/foreigners/'+id,{method:'DELETE'});setSelected(null);await loadForeigners()}catch(e:any){setError(e.message)}
  }
  async function saveDoc(e:any){
    e.preventDefault()
    try{
      const path=editingDocId?'/documents/'+editingDocId:'/documents'
      const method=editingDocId?'PATCH':'POST'
      await api(path,{method,body:JSON.stringify(editingDocId?doc:{...doc,foreignerId:selected.foreigner.id})})
      setEditingDocId(null);setDoc({documentType:'Паспорт',documentNumber:'',issuingCountry:'',issueDate:'',expiryDate:''});await openForeigner(selected.foreigner)
    }catch(e:any){setError(e.message)}
  }
  function editDoc(d:any){setEditingDocId(d.id);setDoc({documentType:d.document_type||'Паспорт',documentNumber:d.document_number||'',issuingCountry:d.issuing_country||'',issueDate:d.issue_date||'',expiryDate:d.expiry_date||''});setError('')}
  async function deleteDoc(id:string){if(!confirm('Удалить документ?'))return;try{await api('/documents/'+id,{method:'DELETE'});await openForeigner(selected.foreigner)}catch(e:any){setError(e.message)}}
  async function saveVisa(e:any){
    e.preventDefault()
    try{const path=editingVisaId?'/visas/'+editingVisaId:'/visas';const method=editingVisaId?'PATCH':'POST';await api(path,{method,body:JSON.stringify(editingVisaId?visa:{...visa,foreignerId:selected.foreigner.id})});setEditingVisaId(null);setVisa({visaType:'Рабочая',visaNumber:'',issueDate:'',startDate:'',endDate:'',notes:''});await openForeigner(selected.foreigner)}
    catch(e:any){setError(e.message)}
  }
  async function deleteVisa(id:string){if(!confirm('Удалить визу/разрешение?'))return;try{await api('/visas/'+id,{method:'DELETE'});await openForeigner(selected.foreigner)}catch(e:any){setError(e.message)}}
  async function saveRegistration(e:any){
    e.preventDefault()
    try{
      const path=editingRegistrationId?'/registrations/'+editingRegistrationId:'/registrations'
      const method=editingRegistrationId?'PATCH':'POST'
      await api(path,{method,body:JSON.stringify(editingRegistrationId?registration:{...registration,foreignerId:selected.foreigner.id})})
      setEditingRegistrationId(null);setRegistration({registrationType:'TEMPORARY_STAY',registrationNumber:'',startDate:'',endDate:'',governmentReference:''});await openForeigner(selected.foreigner)
    }catch(e:any){setError(e.message)}
  }
  function editRegistration(r:any){setEditingRegistrationId(r.id);setRegistration({registrationType:r.registration_type||'TEMPORARY_STAY',registrationNumber:r.registration_number||'',startDate:r.start_date||'',endDate:r.end_date||'',governmentReference:r.government_reference||''});setError('')}
  async function deleteRegistration(id:string){if(!confirm('Удалить регистрацию?'))return;try{await api('/registrations/'+id,{method:'DELETE'});await openForeigner(selected.foreigner)}catch(e:any){setError(e.message)}}
  async function saveFile(e:any){
    e.preventDefault(); if(!selected||!file.fileName||!file.fileUrl)return
    setSavingFile(true);setError('')
    try{await api('/files',{method:'POST',body:JSON.stringify({...file,foreignerId:selected.foreigner.id,fileSize:file.fileSize?Number(file.fileSize):null})});setFile({fileName:'',fileUrl:'',fileType:'',fileSize:''});await openForeigner(selected.foreigner)}catch(e:any){setError(e.message)}finally{setSavingFile(false)}
  }
  function readAttachment(e:any){
    const f=e.target.files?.[0];if(!f)return
    if(f.size>1500000){setError('Файл слишком большой. Максимум 1.5 МБ.');return}
    const reader=new FileReader();reader.onload=()=>setFile({fileName:f.name,fileUrl:String(reader.result),fileType:f.type,fileSize:String(f.size)});reader.readAsDataURL(f)
  }
  async function readPhoto(e:any){
    const file=e.target.files?.[0];if(!file)return
    if(file.size>1500000){setError('Фото слишком большое. Максимум 1.5 МБ.');return}
    const reader=new FileReader();reader.onload=()=>setForm((x:any)=>({...x,photoUrl:String(reader.result)}));reader.readAsDataURL(file)
  }

  if(!token)return <div className="login"><form onSubmit={login}><h1>ForeignID</h1><p>Система учета иностранных граждан</p><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email"/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Пароль"/>{error&&<div className="error">{error}</div>}<button className="primary">Войти</button><small>Демо: admin@example.local / ChangeMe-123!</small></form></div>

  const nav=['Главная','Иностранцы','Контроль сроков','Е-паслуга','Документы','Отчёты','История','Настройки']
  const stats=(n:any,l:string)=><div className="stat"><b>{n??0}</b><span>{l}</span></div>

  function Dashboard(){return <><h1>Главная</h1><p className="muted">Общая информация по иностранным гражданам</p><div className="cards">{stats(data.foreigners,'Всего иностранцев')}{stats(data.visas,'Активные')}{stats(0,'Срок заканчивается')}{stats(0,'Просроченные')}{stats(data.registrations,'Регистрации')}</div><div className="grid2"><div className="panel pad"><h2>Что контролируется</h2><p>Документы, визы и разрешения, регистрации, въезд, страхование и история действий.</p></div><div className="panel pad"><h2>Последние действия</h2><p>Откройте раздел «История» для полного журнала операций.</p></div></div></>}

  function Foreigners(){
    return <><div className="page-title-row"><div><h1>Иностранцы</h1><p className="muted">Список всех иностранных граждан</p></div><button className="primary" onClick={startAdd}>+ Добавить</button></div>{error&&<div className="error">{error}</div>}<div className="panel"><table><thead><tr><th>ФИО</th><th>Гражданство</th><th>Документ</th><th>Виза / Разрешение</th><th>Регистрация</th><th>Статус</th><th>Действия</th></tr></thead><tbody>{foreigners.filter(x=>x.status!=='ARCHIVED').map(x=><tr key={x.id}><td><button className="link" onClick={()=>openForeigner(x)}>{x.last_name} {x.first_name} {x.middle_name||''}</button></td><td>{x.citizenship}</td><td>{x.document?.document_number||'—'}</td><td>{x.visa?.end_date||'—'}</td><td>{x.registration?.end_date||'—'}</td><td><span className="ok">Активен</span></td><td><button onClick={()=>openForeigner(x)}>Открыть</button></td></tr>)}</tbody></table></div>{wizard&&Wizard()}</>
  }

  function Wizard(){
    const labels=['Основные данные','Документ','Въезд','Виза / разрешение','Регистрация','Страховка','Документы','Проверка']
    return <div className="modal-backdrop"><div className="modal wizard"><div className="modal-header"><div><h2>{editing?'Редактировать иностранца':'Добавление иностранца'}</h2><div className="steps">{labels.map((x,i)=><button type="button" key={x} className={step===i+1?'step active':'step'} onClick={()=>setStep(i+1)}>{i+1}. {x}</button>)}</div></div><button onClick={()=>setWizard(false)}>×</button></div>
      <form onSubmit={saveForeigner}>
      {step===1&&<div className="wizard-grid"><div className="panel pad"><h3>Личные данные</h3><div className="form-grid">{[['Фамилия *','lastName'],['Имя *','firstName'],['Отчество','middleName'],['Гражданство *','citizenship'],['Дата рождения','birthDate'],['Пол','gender'],['Телефон','phone'],['Email','email']].map(([l,n]:any)=><label key={n}>{l}<input type={n==='birthDate'?'date':n==='email'?'email':'text'} required={l.includes('*')} value={form[n]} onChange={e=>setForm({...form,[n]:e.target.value})}/></label>)}</div></div><div className="panel pad"><h3>Фотография</h3>{form.photoUrl?<img className="photo" src={form.photoUrl} />:<div className="photo-empty">Фото не загружено</div>}<input type="file" accept="image/*" onChange={readPhoto}/></div></div>}
      {step===2&&<div className="panel pad"><h3>Документ удостоверяющий личность</h3><div className="form-grid">{[['Тип документа','documentType'],['Номер','documentNumber'],['Страна выдачи','issuingCountry'],['Дата выдачи','issueDate'],['Срок действия','expiryDate']].map(([l,n]:any)=><label key={n}>{l}<input type={n.includes('Date')?'date':'text'} value={(doc as any)[n==='documentType'?'documentType':n==='documentNumber'?'documentNumber':n==='issuingCountry'?'issuingCountry':n==='issueDate'?'issueDate':'expiryDate']} onChange={e=>setDoc({...doc,[n]:e.target.value})}/></label>)}</div></div>}
      {step===3&&<div className="panel pad"><h3>Въезд и пребывание в Республике Беларусь</h3><div className="form-grid"><label>Дата въезда<input type="date" value={form.entryDate} onChange={e=>setForm({...form,entryDate:e.target.value})}/></label><label>Основание пребывания<input value={form.stayBasis} onChange={e=>setForm({...form,stayBasis:e.target.value})} placeholder="Работа, учеба, частный визит..."/></label><label className="wide">Адрес пребывания<input value={form.stayAddress} onChange={e=>setForm({...form,stayAddress:e.target.value})}/></label></div></div>}
      {step===4&&<div className="panel pad"><h3>Виза / разрешение</h3><div className="form-grid"><label>Тип<input value={visa.visaType} onChange={e=>setVisa({...visa,visaType:e.target.value})}/></label><label>Номер<input value={visa.visaNumber} onChange={e=>setVisa({...visa,visaNumber:e.target.value})}/></label><label>Дата выдачи<input type="date" value={visa.issueDate} onChange={e=>setVisa({...visa,issueDate:e.target.value})}/></label><label>Начало<input type="date" value={visa.startDate} onChange={e=>setVisa({...visa,startDate:e.target.value})}/></label><label>Окончание<input type="date" value={visa.endDate} onChange={e=>setVisa({...visa,endDate:e.target.value})}/></label><label className="wide">Примечание<textarea value={visa.notes} onChange={e=>setVisa({...visa,notes:e.target.value})}/></label></div><p className="muted">Виза сохраняется после создания карточки.</p></div>}
      {step===5&&<div className="panel pad"><h3>Регистрация</h3><div className="form-grid"><label>Тип<input value={registration.registrationType} onChange={e=>setRegistration({...registration,registrationType:e.target.value})}/></label><label>Номер<input value={registration.registrationNumber} onChange={e=>setRegistration({...registration,registrationNumber:e.target.value})}/></label><label>Дата начала<input type="date" value={registration.startDate} onChange={e=>setRegistration({...registration,startDate:e.target.value})}/></label><label>Дата окончания<input type="date" value={registration.endDate} onChange={e=>setRegistration({...registration,endDate:e.target.value})}/></label><label className="wide">Гос. номер / ссылка<input value={registration.governmentReference} onChange={e=>setRegistration({...registration,governmentReference:e.target.value})}/></label></div></div>}
      {step===6&&<div className="panel pad"><h3>Страхование</h3><div className="form-grid"><label>Страховая компания<input value={form.insuranceCompany} onChange={e=>setForm({...form,insuranceCompany:e.target.value})}/></label><label>Номер полиса<input value={form.insurancePolicyNumber} onChange={e=>setForm({...form,insurancePolicyNumber:e.target.value})}/></label><label>Действует до<input type="date" value={form.insuranceEndDate} onChange={e=>setForm({...form,insuranceEndDate:e.target.value})}/></label></div></div>}
      {step===7&&<div className="panel pad"><h3>Прикрепленные документы</h3><p>Файл можно прикрепить после сохранения карточки иностранца.</p></div>}
      {step===8&&<div className="panel pad"><h3>Проверка</h3><div className="review"><b>{form.lastName} {form.firstName} {form.middleName}</b><span>{form.citizenship} · {form.birthDate||'дата рождения не указана'} · {form.gender||'пол не указан'}</span><span>Документ: {doc.documentNumber||'не указан'}</span><span>Въезд: {form.entryDate||'не указан'}</span><span>Виза до: {visa.endDate||'не указана'}</span><span>Регистрация до: {registration.endDate||'не указана'}</span><span>Страховка до: {form.insuranceEndDate||'не указана'}</span></div></div>}
      <div className="modal-actions"><button type="button" onClick={()=>step>1?setStep(step-1):setWizard(false)}>Назад</button>{step<8?<button type="button" className="primary" onClick={()=>setStep(step+1)}>Далее →</button>:<button className="primary" disabled={saving}>{saving?'Сохранение...':editing?'Сохранить изменения':'Создать карточку'}</button>}</div></form></div></div>
  }

  function Detail(){
    if(!selected)return null
    const f=selected.foreigner
    return <><button className="back" onClick={()=>setSelected(null)}>← К списку</button><div className="page-title-row"><div className="person-title">{f.photo_url?<img className="avatar" src={f.photo_url}/>:<div className="avatar placeholder">Фото</div>}<div><h1>{f.last_name} {f.first_name} {f.middle_name||''}</h1><p className="muted">{f.citizenship} · <span className="ok">Активен</span></p></div></div><div><button className="primary" onClick={startEdit}>Редактировать</button> <button onClick={()=>archive(f.id)}>Архивировать</button></div></div>{error&&<div className="error">{error}</div>}
      <div className="tabs"><button className="active">Основная информация</button><button>Документы</button><button>Виза / Разрешение</button><button>Регистрация</button><button>История</button></div>
      <div className="grid3">
        <div className="panel pad"><h3>Личные данные</h3><p><b>ФИО:</b> {f.last_name} {f.first_name} {f.middle_name||''}</p><p><b>Гражданство:</b> {f.citizenship}</p><p><b>Дата рождения:</b> {f.birth_date||'—'}</p><p><b>Пол:</b> {f.gender||'—'}</p><p><b>Телефон:</b> {f.phone||'—'}</p><p><b>Email:</b> {f.email||'—'}</p></div>
        <div className="panel pad"><h3>Документ</h3>{selected.documents[0]?<><p><b>Тип:</b> {selected.documents[0].document_type}</p><p><b>Номер:</b> {selected.documents[0].document_number}</p><p><b>Страна:</b> {selected.documents[0].issuing_country||'—'}</p><p><b>Выдан:</b> {selected.documents[0].issue_date||'—'}</p><p><b>Срок:</b> {selected.documents[0].expiry_date||'—'}</p></>:<p className="muted">Документ не указан</p>}</div>
        <div className="panel pad"><h3>Пребывание в РБ</h3><p><b>Дата въезда:</b> {f.entry_date||'—'}</p><p><b>Основание:</b> {f.stay_basis||'—'}</p><p><b>Адрес:</b> {f.stay_address||'—'}</p></div>
        <div className="panel pad"><h3>Виза / Разрешение</h3>{selected.visas.length?selected.visas.map((v:any)=><div className="record" key={v.id}><b>{v.visa_type} {v.visa_number?'№'+v.visa_number:''}</b><span>до {v.end_date} <button onClick={()=>{setEditingVisaId(v.id);setVisa({visaType:v.visa_type||'',visaNumber:v.visa_number||'',issueDate:v.issue_date||'',startDate:v.start_date||'',endDate:v.end_date||'',notes:v.notes||''});setError('')}}>Редактировать</button> <button onClick={()=>deleteVisa(v.id)}>Удалить</button></span></div>)):<p className="muted">Нет записей</p>}</div>
        <div className="panel pad"><h3>Регистрация</h3>{selected.registrations.length?selected.registrations.map((r:any)=><div className="record" key={r.id}><b>{r.registration_type}</b><span>до {r.end_date} <button onClick={()=>editRegistration(r)}>Редактировать</button> <button onClick={()=>deleteRegistration(r.id)}>Удалить</button></span></div>):<p className="muted">Нет регистрации</p>}</div>
        <div className="panel pad"><h3>Страхование</h3><p><b>Компания:</b> {f.insurance_company||'—'}</p><p><b>Полис:</b> {f.insurance_policy_number||'—'}</p><p><b>Действует до:</b> {f.insurance_end_date||'—'}</p></div>
      </div>
      <div className="panel pad"><h2>Прикрепленные файлы</h2><form onSubmit={saveFile} className="stack"><input type="file" onChange={readAttachment} required/><input placeholder="Имя файла" value={file.fileName} onChange={e=>setFile({...file,fileName:e.target.value})}/><input placeholder="Ссылка на файл" value={file.fileUrl} onChange={e=>setFile({...file,fileUrl:e.target.value})}/><button className="primary" disabled={savingFile}>{savingFile?"Сохранение...":"Прикрепить файл"}</button></form>{selected.files?.length?selected.files.map((x:any)=><div className="record" key={x.id}><span>{x.file_name} {x.file_size?"· "+Math.round(Number(x.file_size)/1024)+" КБ":""}</span><a href={x.file_url} target="_blank" rel="noreferrer">Открыть</a></div>):<p className="muted">Файлов пока нет</p>}</div>
      <div className="grid2">
        <div className="panel pad"><h2>{editingDocId?'Редактировать документ':'Добавить документ'}</h2><form onSubmit={saveDoc} className="stack"><input placeholder="Тип документа" value={doc.documentType} onChange={e=>setDoc({...doc,documentType:e.target.value})}/><input placeholder="Номер" required value={doc.documentNumber} onChange={e=>setDoc({...doc,documentNumber:e.target.value})}/><input placeholder="Страна выдачи" value={doc.issuingCountry} onChange={e=>setDoc({...doc,issuingCountry:e.target.value})}/><input type="date" value={doc.issueDate} onChange={e=>setDoc({...doc,issueDate:e.target.value})}/><input type="date" required value={doc.expiryDate} onChange={e=>setDoc({...doc,expiryDate:e.target.value})}/><button className="primary">{editingDocId?'Сохранить изменения':'Сохранить документ'}</button></form>{selected.documents.map((d:any)=><div className="record" key={d.id}><span>{d.document_type} №{d.document_number}</span><span><button type="button" onClick={()=>editDoc(d)}>Редактировать</button> <button type="button" onClick={()=>deleteDoc(d.id)}>Удалить</button></span></div>)}</div>
        <div className="panel pad"><h2>{editingVisaId?'Редактировать визу':'Добавить визу'} </h2><form onSubmit={saveVisa} className="stack"><input placeholder="Тип визы" required value={visa.visaType} onChange={e=>setVisa({...visa,visaType:e.target.value})}/><input placeholder="Номер" value={visa.visaNumber} onChange={e=>setVisa({...visa,visaNumber:e.target.value})}/><input type="date" value={visa.issueDate} onChange={e=>setVisa({...visa,issueDate:e.target.value})}/><input type="date" value={visa.startDate} onChange={e=>setVisa({...visa,startDate:e.target.value})}/><input type="date" required value={visa.endDate} onChange={e=>setVisa({...visa,endDate:e.target.value})}/><textarea placeholder="Примечание" value={visa.notes} onChange={e=>setVisa({...visa,notes:e.target.value})}/><button className="primary">{editingVisaId?'Сохранить изменения':'Сохранить визу'}</button></form></div>
        <div className="panel pad"><h2>{editingRegistrationId?'Редактировать регистрацию':'Добавить регистрацию'}</h2><form onSubmit={saveRegistration} className="stack"><input placeholder="Тип" value={registration.registrationType} onChange={e=>setRegistration({...registration,registrationType:e.target.value})}/><input placeholder="Номер" value={registration.registrationNumber} onChange={e=>setRegistration({...registration,registrationNumber:e.target.value})}/><input type="date" value={registration.startDate} onChange={e=>setRegistration({...registration,startDate:e.target.value})}/><input type="date" required value={registration.endDate} onChange={e=>setRegistration({...registration,endDate:e.target.value})}/><button className="primary">{editingRegistrationId?'Сохранить изменения':'Сохранить регистрацию'}</button></form></div>
      </div></>
  }

  function Section(){
    if(active==='Главная')return Dashboard()
    if(active==='Иностранцы')return Foreigners()
    if(active==='Настройки')return <div className="panel pad"><h1>Настройки</h1><h3>Система</h3><p>Пользователь: ORG_ADMIN</p><p className="muted">Разделы профиля, организации, роли, правила сроков, уведомления и безопасность готовы к подключению.</p></div>
    if(active==='Контроль сроков')return <><h1>Контроль сроков</h1><p className="muted">Сроки регистрации, виз, документов и страхования.</p><div className="panel"><table><thead><tr><th>ФИО</th><th>Тип</th><th>Запись</th><th>Срок</th><th>Статус</th></tr></thead><tbody>{(data.data||[]).map((x:any)=><tr key={x.item_type+x.item_name+x.end_date}><td>{x.last_name} {x.first_name}</td><td>{x.item_type}</td><td>{x.item_name}</td><td>{x.end_date}</td><td><span className={x.deadline_status==='EXPIRED'?'bad':x.deadline_status==='WARNING'?'warn':'ok'}>{x.deadline_status==='EXPIRED'?'ПРОСРОЧЕНО':x.deadline_status==='WARNING'?'СКОРО':'В НОРМЕ'}</span></td></tr>)}</tbody></table></div></>
    if(active==='Документы')return <><h1>Документы</h1><p className="muted">Хранилище и управление документами.</p><div className="grid2"><div className="panel pad"><h2>Документы</h2>{(data.documents||[]).map((d:any)=><div className="record" key={d.id}><b>{d.last_name} {d.first_name}</b><span>{d.document_type} №{d.document_number} · до {d.expiry_date}</span></div>)}</div><div className="panel pad"><h2>Визы</h2>{(data.visas||[]).map((v:any)=><div className="record" key={v.id}><b>{v.last_name} {v.first_name}</b><span>{v.visa_type} · до {v.end_date}</span></div>)}</div></div></>
    if(active==='История')return <><h1>История действий</h1><p className="muted">Журнал операций пользователей.</p><div className="panel">{(data.data||[]).map((x:any)=><div className="history" key={x.id}><b>{x.action} · {x.entity_type}</b><span>{new Date(x.created_at).toLocaleString()} · {x.first_name||'система'}</span></div>)}</div></>
    if(active==='Е-паслуга')return <><h1>Е-паслуга</h1><p className="muted">Регистрация иностранных граждан на территории Республики Беларусь.</p><div className="panel pad"><h2>Как это работает</h2><ol><li>Проверить право и данные.</li><li>Подготовить данные.</li><li>Перейти в официальный сервис.</li><li>Подтвердить данные и завершить операцию.</li><li>Сохранить номер/статус операции.</li></ol><p className="muted">Автоматическая отправка реализуется только через одобренный официальный API.</p></div><div className="panel">{(data.data||[]).length?(data.data||[]).map((x:any)=><div className="history" key={x.id}><b>{x.service_type}</b><span>{x.last_name||''} {x.first_name||''} · {x.status}</span></div>):<div className="pad">Заявок пока нет.</div>}</div></>
    if(active==='Отчёты')return <><h1>Отчёты</h1><p className="muted">Сводка по организации</p><div className="cards">{stats(Number(data?.foreigners)||0,'Иностранцев')}{stats(Number(data?.documents)||0,'Документов')}{stats(Number(data?.visas)||0,'Активных виз')}{stats(Number(data?.registrations)||0,'Регистраций')}</div><div className="panel pad"><h2>Экспорт</h2><p className="muted">Подготовка отчетов доступна после формирования выгрузки.</p><button type="button">Экспорт Excel</button> <button type="button">Экспорт PDF</button></div></>
    return null
  }

  return <div className="app"><aside><h2>◈ ForeignID</h2>{nav.map(x=><button key={x} className={'nav '+(active===x?'active':'')} onClick={()=>{setActive(x);setSelected(null);setWizard(false)}}>{x}</button>)}<button className="logout" onClick={()=>{localStorage.removeItem('token');setToken(null);setSelected(null);setWizard(false)}}>Выйти</button></aside><main><header><input placeholder="Поиск по ФИО, документу, телефону..." value={q} onChange={e=>setQ(e.target.value)}/><span>Иванов А.А.</span></header>{selected?Detail():Section()}{wizard&&Wizard()}</main></div>
}
createRoot(document.getElementById('root')!).render(<App/>)
