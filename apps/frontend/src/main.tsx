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
  const [detailTab,setDetailTab]=React.useState('Основная информация')
  const [serviceType,setServiceType]=React.useState('Регистрация иностранного гражданина')
  const [creatingApplication,setCreatingApplication]=React.useState(false)
  const [currentUser,setCurrentUser]=React.useState<any>(null)
  const [applicationForeignerId,setApplicationForeignerId]=React.useState('')
  const [applicationLogs,setApplicationLogs]=React.useState<any>(null)
  const [applicationLogsId,setApplicationLogsId]=React.useState<string|null>(null)
  const [users,setUsers]=React.useState<any[]>([])
  const [notifications,setNotifications]=React.useState<any[]>([])
  const [userForm,setUserForm]=React.useState({email:'',password:'',firstName:'',lastName:'',role:'OPERATOR',isActive:true})
  const [editingUserId,setEditingUserId]=React.useState<string|null>(null)
  const [topDocForeignerId,setTopDocForeignerId]=React.useState('')
  const [topDoc,setTopDoc]=React.useState({documentType:'Паспорт',documentNumber:'',issuingCountry:'',issueDate:'',expiryDate:''})
  const [topEditingDocId,setTopEditingDocId]=React.useState<string|null>(null)
  const [topDocSaving,setTopDocSaving]=React.useState(false)
  const [foreignerTotal,setForeignerTotal]=React.useState(0)
  const [foreignerPage,setForeignerPage]=React.useState(1)
  const foreignerPageSize=25
  const [sectionPage,setSectionPage]=React.useState(1)
  const sectionPageSize=25

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
    try{const d=await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});localStorage.setItem('token',d.accessToken);setToken(d.accessToken);setCurrentUser(d.user)}
    catch(e:any){setError(e.message)}
  }
  async function loadForeigners(){
    if(!token)return
    try{const d=await api('/foreigners?q='+encodeURIComponent(q)+'&page='+foreignerPage+'&pageSize='+foreignerPageSize);setForeigners(d.data||[]);setForeignerTotal(Number(d.total||0))}
    catch(e:any){setError(e.message)}
  }
  async function createApplication(foreignerId:string){
    setCreatingApplication(true);setError('')
    try{await api('/government/applications',{method:'POST',body:JSON.stringify({foreignerId,serviceType})});setApplicationForeignerId('');await loadSection()}
    catch(e:any){setError(e.message)}finally{setCreatingApplication(false)}
  }
  async function loadApplicationLogs(id:string){
    setError('')
    try{const d=await api('/government/applications/'+id+'/logs');setApplicationLogs(d);setApplicationLogsId(id)}
    catch(e:any){setError(e.message)}
  }
  async function prepareApplication(id:string){
    setError('')
    try{await api('/government/applications/'+id+'/prepare',{method:'POST'});await loadSection()}
    catch(e:any){setError(e.message)}
  }
  async function saveTopDocument(e:any){
    e.preventDefault();setTopDocSaving(true);setError('')
    try{
      if(!topDoc.documentType||!topDoc.documentNumber||!topDoc.expiryDate)throw new Error('Для документа укажите тип, номер и срок действия.')
      if(topDoc.issueDate&&topDoc.issueDate>topDoc.expiryDate)throw new Error('Дата выдачи документа не может быть позже даты окончания.')
      if(!topDocForeignerId&&!topEditingDocId)throw new Error('Выберите иностранца.')
      const path=topEditingDocId?'/documents/'+topEditingDocId:'/documents'
      const method=topEditingDocId?'PATCH':'POST'
      const body=topEditingDocId?topDoc:{...topDoc,foreignerId:topDocForeignerId}
      await api(path,{method,body:JSON.stringify(body)})
      setTopDoc({documentType:'Паспорт',documentNumber:'',issuingCountry:'',issueDate:'',expiryDate:''})
      setTopDocForeignerId('');setTopEditingDocId(null)
      await loadSection()
    }catch(e:any){setError(e.message)}finally{setTopDocSaving(false)}
  }
  function editTopDocument(d:any){
    setTopEditingDocId(d.id);setTopDocForeignerId('')
    setTopDoc({documentType:d.document_type||'Паспорт',documentNumber:d.document_number||'',issuingCountry:d.issuing_country||'',issueDate:d.issue_date||'',expiryDate:d.expiry_date||''})
    setError('')
  }
  async function deleteTopDocument(id:string){
    if(!confirm('Удалить документ?'))return
    try{await api('/documents/'+id,{method:'DELETE'});if(topEditingDocId===id){setTopEditingDocId(null);setTopDoc({documentType:'Паспорт',documentNumber:'',issuingCountry:'',issueDate:'',expiryDate:''})}await loadSection()}
    catch(e:any){setError(e.message)}
  }

  function parseCsv(text:string){
    const rows:string[][]=[]; let row:string[]=[],cell='',quoted=false
    for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];if(ch==='"'){if(quoted&&next==='"'){cell+='"';i++}else quoted=!quoted}else if(ch===','&&!quoted){row.push(cell);cell=''}else if((ch==='\\n'||ch==='\\r')&&!quoted){if(ch==='\\r'&&next==='\\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell=''}else cell+=ch}row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows}
  async function importCsv(e:any){const file=e.target.files?.[0];if(!file)return;try{const text=await file.text();const rows=parseCsv(text);if(rows.length<2)throw new Error('CSV пустой');const headers=rows[0].map(x=>x.trim());const map:any={firstName:'firstName',middleName:'middleName',lastName:'lastName',citizenship:'citizenship',birthDate:'birthDate',gender:'gender',phone:'phone',email:'email',entryDate:'entryDate',stayBasis:'stayBasis',stayAddress:'stayAddress',insuranceCompany:'insuranceCompany',insurancePolicyNumber:'insurancePolicyNumber',insuranceEndDate:'insuranceEndDate'};const data=rows.slice(1).map(r=>{const x:any={};headers.forEach((h,j)=>{if(map[h])x[map[h]]=r[j]?.trim()||''});return x});const result=await api('/foreigners/import',{method:'POST',body:JSON.stringify({rows:data})});await loadForeigners();setError(result.errors?.length?\`Импортировано: ${result.imported}. Ошибок: ${result.errors.length}.\`:\`Импортировано: ${result.imported}.\`)}catch(err:any){setError(err.message)}e.target.value=''}
  async function loadNotifications(){try{const d=await api('/notifications');setNotifications(d.data||[])}catch{setNotifications([])}}
  async function loadUsers(){try{const d=await api('/users');setUsers(d.data||[])}catch(e:any){setError(e.message)}}
  async function saveUser(e:any){e.preventDefault();setError('');try{
    if(editingUserId){
      const payload={firstName:userForm.firstName,lastName:userForm.lastName,role:userForm.role,isActive:userForm.isActive}
      if(userForm.password)Object.assign(payload,{password:userForm.password})
      await api('/users/'+editingUserId,{method:'PATCH',body:JSON.stringify(payload)})
    }else{
      await api('/users',{method:'POST',body:JSON.stringify(userForm)})
    }
    setEditingUserId(null);setUserForm({email:'',password:'',firstName:'',lastName:'',role:'OPERATOR',isActive:true});await loadUsers()
  }catch(e:any){setError(e.message)}}
  async function loadSection(){
    if(!token)return
    try{
      if(active==='Главная'){const [d,deadlines]=await Promise.all([api('/dashboard'),api('/deadlines')]);setData({...d,deadlines:deadlines.data||[]})} else if(active==='Отчёты'){const [d,report]=await Promise.all([api('/dashboard'),api('/reports/deadlines')]);setData({...d,deadlines:report.data||[]})}
      else if(active==='Контроль сроков')setData(await api('/deadlines?page='+sectionPage+'&pageSize='+sectionPageSize))
      else if(active==='Документы'){const [d,v]=await Promise.all([api('/documents?page='+sectionPage+'&pageSize='+sectionPageSize),api('/visas?page='+sectionPage+'&pageSize='+sectionPageSize)]);setData({documents:d.data||[],visas:v.data||[],documentsTotal:Number(d.total||0),visasTotal:Number(v.total||0)})}
      else if(active==='История')setData(await api('/history?page='+sectionPage+'&pageSize='+sectionPageSize))
      else if(active==='Е-паслуга')setData(await api('/applications?page='+sectionPage+'&pageSize='+sectionPageSize))
    }catch(e:any){setError(e.message)}
  }
  React.useEffect(()=>{
    if(!token){setCurrentUser(null);return}
    api('/auth/me').then(d=>setCurrentUser(d.user)).catch(()=>{})
  },[token])
  React.useEffect(()=>{setForeignerPage(1)},[q])
  React.useEffect(()=>{loadForeigners()},[token,q,foreignerPage])
  React.useEffect(()=>{setSectionPage(1)},[active])
  React.useEffect(()=>{loadSection()},[token,active,sectionPage])
  React.useEffect(()=>{if(token)loadNotifications()},[token,active])
  React.useEffect(()=>{if(token&&['SUPER_ADMIN','ORG_ADMIN'].includes(currentUser?.role)&&active==='Настройки')loadUsers()},[token,active,currentUser?.role])

  function startAdd(){setDetailTab('Основная информация');setForm({...blank});setDoc({documentType:'Паспорт',documentNumber:'',issuingCountry:'',issueDate:'',expiryDate:''});setVisa({visaType:'Рабочая',visaNumber:'',issueDate:'',startDate:'',endDate:'',notes:''});setRegistration({registrationType:'TEMPORARY_STAY',registrationNumber:'',startDate:'',endDate:'',governmentReference:''});setStep(1);setEditing(false);setEditingDocId(null);setEditingVisaId(null);setEditingRegistrationId(null);setWizard(true);setError('')}
  function selectWizardDoc(id:string){
    if(!selected)return
    if(!id){setEditingDocId(null);setDoc({documentType:'Паспорт',documentNumber:'',issuingCountry:'',issueDate:'',expiryDate:''});return}
    const d=(selected.documents||[]).find((x:any)=>x.id===id)
    if(d)editDoc(d)
  }
  function selectWizardVisa(id:string){
    if(!selected)return
    if(!id){setEditingVisaId(null);setVisa({visaType:'Рабочая',visaNumber:'',issueDate:'',startDate:'',endDate:'',notes:''});return}
    const v=(selected.visas||[]).find((x:any)=>x.id===id)
    if(v){setEditingVisaId(v.id);setVisa({visaType:v.visa_type||'',visaNumber:v.visa_number||'',issueDate:v.issue_date||'',startDate:v.start_date||'',endDate:v.end_date||'',notes:v.notes||''})}
  }
  function selectWizardRegistration(id:string){
    if(!selected)return
    if(!id){setEditingRegistrationId(null);setRegistration({registrationType:'TEMPORARY_STAY',registrationNumber:'',startDate:'',endDate:'',governmentReference:''});return}
    const r=(selected.registrations||[]).find((x:any)=>x.id===id)
    if(r)editRegistration(r)
  }

  function startEdit(){if(!selected)return;setDetailTab('Основная информация');const f=selected.foreigner;const d=selected.documents?.[0];const v=selected.visas?.[0];const r=selected.registrations?.[0];setForm({...blank,...f,firstName:f.first_name,middleName:f.middle_name||'',lastName:f.last_name,citizenship:f.citizenship,birthDate:f.birth_date||'',gender:f.gender||'',phone:f.phone||'',email:f.email||'',entryDate:f.entry_date||'',stayBasis:f.stay_basis||'',stayAddress:f.stay_address||'',insuranceCompany:f.insurance_company||'',insurancePolicyNumber:f.insurance_policy_number||'',insuranceEndDate:f.insurance_end_date||'',photoUrl:f.photo_url||''});if(d){setDoc({documentType:d.document_type||'Паспорт',documentNumber:d.document_number||'',issuingCountry:d.issuing_country||'',issueDate:d.issue_date||'',expiryDate:d.expiry_date||''});setEditingDocId(d.id)}else setEditingDocId(null);if(v){setVisa({visaType:v.visa_type||'',visaNumber:v.visa_number||'',issueDate:v.issue_date||'',startDate:v.start_date||'',endDate:v.end_date||'',notes:v.notes||''});setEditingVisaId(v.id)}else {setVisa({visaType:'Рабочая',visaNumber:'',issueDate:'',startDate:'',endDate:'',notes:''});setEditingVisaId(null)}if(r){setRegistration({registrationType:r.registration_type||'TEMPORARY_STAY',registrationNumber:r.registration_number||'',startDate:r.start_date||'',endDate:r.end_date||'',governmentReference:r.government_reference||''});setEditingRegistrationId(r.id)}else setEditingRegistrationId(null);setStep(1);setEditing(true);setWizard(true);setError('')}
  async function saveForeigner(e:any){
    e.preventDefault();setSaving(true);setError('')
    try{
      const payload={...form}
      const documentStarted=Boolean(doc.documentNumber||doc.issuingCountry||doc.issueDate||doc.expiryDate)
      const visaStarted=Boolean(visa.visaNumber||visa.issueDate||visa.startDate||visa.endDate||visa.notes)
      const registrationStarted=Boolean(registration.registrationNumber||registration.startDate||registration.endDate||registration.governmentReference)
      if(documentStarted&&!doc.documentNumber)throw new Error('Заполните номер документа.')
      if(documentStarted&&!doc.expiryDate)throw new Error('Укажите срок действия документа.')
      if(visaStarted&&(!visa.visaType||!visa.endDate))throw new Error('Для визы укажите тип и дату окончания.')
      if(registrationStarted&&!registration.endDate)throw new Error('Для регистрации укажите дату окончания.')
      let foreignerId=editing?selected.foreigner.id:''
      if(editing){
        await api('/foreigners/'+selected.foreigner.id,{method:'PATCH',body:JSON.stringify(payload)})
      }else{
        const created=await api('/foreigners',{method:'POST',body:JSON.stringify(payload)})
        foreignerId=created.id
      }
      if(documentStarted){
        const path=editingDocId?'/documents/'+editingDocId:'/documents'
        const method=editingDocId?'PATCH':'POST'
        await api(path,{method,body:JSON.stringify(editingDocId?doc:{...doc,foreignerId})})
      }
      if(visaStarted){
        const path=editingVisaId?'/visas/'+editingVisaId:'/visas'
        const method=editingVisaId?'PATCH':'POST'
        await api(path,{method,body:JSON.stringify(editingVisaId?visa:{...visa,foreignerId})})
      }
      if(registrationStarted){
        const path=editingRegistrationId?'/registrations/'+editingRegistrationId:'/registrations'
        const method=editingRegistrationId?'PATCH':'POST'
        await api(path,{method,body:JSON.stringify(editingRegistrationId?registration:{...registration,foreignerId})})
      }
      setWizard(false);setEditing(false);setEditingDocId(null);setEditingVisaId(null);setEditingRegistrationId(null);await loadForeigners()
      if(editing)await openForeigner({id:selected.foreigner.id})
      else await openForeigner({id:foreignerId})
    }catch(e:any){setError(e.message)}finally{setSaving(false)}
  }
  async function openForeigner(x:any){try{const f=await api('/foreigners/'+x.id);const h=await api('/history?foreignerId='+encodeURIComponent(x.id));setSelected(f);setData((d:any)=>({...d,foreignerHistory:h.data||[]}))}catch(e:any){setError(e.message)}}
  async function archive(id:string){
    if(!confirm('Архивировать запись?'))return
    try{await api('/foreigners/'+id,{method:'DELETE'});setSelected(null);await loadForeigners()}catch(e:any){setError(e.message)}
  }
  async function saveDoc(e:any){
    e.preventDefault();setError('')
    try{
      if(!doc.documentType||!doc.documentNumber||!doc.expiryDate)throw new Error('Для документа укажите тип, номер и срок действия.')
      if(doc.issueDate&&doc.issueDate>doc.expiryDate)throw new Error('Дата выдачи документа не может быть позже даты окончания.')
      const path=editingDocId?'/documents/'+editingDocId:'/documents'
      const method=editingDocId?'PATCH':'POST'
      await api(path,{method,body:JSON.stringify(editingDocId?doc:{...doc,foreignerId:selected.foreigner.id})})
      setEditingDocId(null);setDoc({documentType:'Паспорт',documentNumber:'',issuingCountry:'',issueDate:'',expiryDate:''});await openForeigner(selected.foreigner)
    }catch(e:any){setError(e.message)}
  }
  function editDoc(d:any){setEditingDocId(d.id);setDoc({documentType:d.document_type||'Паспорт',documentNumber:d.document_number||'',issuingCountry:d.issuing_country||'',issueDate:d.issue_date||'',expiryDate:d.expiry_date||''});setError('')}
  async function deleteDoc(id:string){if(!confirm('Удалить документ?'))return;try{await api('/documents/'+id,{method:'DELETE'});await openForeigner(selected.foreigner)}catch(e:any){setError(e.message)}}
  async function saveVisa(e:any){
    e.preventDefault();setError('')
    try{
      if(!visa.visaType||!visa.endDate)throw new Error('Для визы укажите тип и дату окончания.')
      if(visa.startDate&&visa.startDate>visa.endDate)throw new Error('Дата начала визы не может быть позже даты окончания.')
      if(visa.issueDate&&visa.issueDate>visa.endDate)throw new Error('Дата выдачи визы не может быть позже даты окончания.')
      const path=editingVisaId?'/visas/'+editingVisaId:'/visas';const method=editingVisaId?'PATCH':'POST'
      await api(path,{method,body:JSON.stringify(editingVisaId?visa:{...visa,foreignerId:selected.foreigner.id})})
      setEditingVisaId(null);setVisa({visaType:'Рабочая',visaNumber:'',issueDate:'',startDate:'',endDate:'',notes:''});await openForeigner(selected.foreigner)
    }catch(e:any){setError(e.message)}
  }
  async function deleteVisa(id:string){if(!confirm('Удалить визу/разрешение?'))return;try{await api('/visas/'+id,{method:'DELETE'});await openForeigner(selected.foreigner)}catch(e:any){setError(e.message)}}
  async function saveRegistration(e:any){
    e.preventDefault();setError('')
    try{
      if(!registration.endDate)throw new Error('Для регистрации укажите дату окончания.')
      if(registration.startDate&&registration.startDate>registration.endDate)throw new Error('Дата начала регистрации не может быть позже даты окончания.')
      const path=editingRegistrationId?'/registrations/'+editingRegistrationId:'/registrations'
      const method=editingRegistrationId?'PATCH':'POST'
      await api(path,{method,body:JSON.stringify(editingRegistrationId?registration:{...registration,foreignerId:selected.foreigner.id})})
      setEditingRegistrationId(null);setRegistration({registrationType:'TEMPORARY_STAY',registrationNumber:'',startDate:'',endDate:'',governmentReference:''});await openForeigner(selected.foreigner)
    }catch(e:any){setError(e.message)}
  }
  function editRegistration(r:any){setEditingRegistrationId(r.id);setRegistration({registrationType:r.registration_type||'TEMPORARY_STAY',registrationNumber:r.registration_number||'',startDate:r.start_date||'',endDate:r.end_date||'',governmentReference:r.government_reference||''});setError('')}
  async function deleteRegistration(id:string){if(!confirm('Удалить регистрацию?'))return;try{await api('/registrations/'+id,{method:'DELETE'});await openForeigner(selected.foreigner)}catch(e:any){setError(e.message)}}
  async function downloadFile(id:string,name:string){try{const res=await fetch(API+'/files/'+id+'/download',{headers:{Authorization:'Bearer '+token}});if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.message||'Не удалось скачать файл')}const blob=await res.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e:any){setError(e.message)}}
  async function saveFile(e:any){
    e.preventDefault(); if(!selected||!file.fileName||!file.fileUrl)return
    setSavingFile(true);setError('')
    try{await api('/files',{method:'POST',body:JSON.stringify({...file,foreignerId:selected.foreigner.id,fileSize:file.fileSize?Number(file.fileSize):null})});setFile({fileName:'',fileUrl:'',fileType:'',fileSize:''});await openForeigner(selected.foreigner)}catch(e:any){setError(e.message)}finally{setSavingFile(false)}
  }
  async function deleteFile(id:string){
    if(!confirm('Удалить прикрепленный файл?'))return
    try{await api('/files/'+id,{method:'DELETE'});await openForeigner(selected.foreigner)}catch(e:any){setError(e.message)}
  }
  async function uploadAttachment(e:any){const f=e.target.files?.[0];if(!f)return;if(f.size>1500000){setError('Файл слишком большой. Максимум 1.5 МБ.');return}const reader=new FileReader();reader.onload=()=>setFile({fileName:f.name,fileUrl:String(reader.result),fileType:f.type,fileSize:String(f.size)});reader.readAsDataURL(f)}
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
  const canWrite=['SUPER_ADMIN','ORG_ADMIN','OPERATOR'].includes(currentUser?.role)
  const canDelete=['SUPER_ADMIN','ORG_ADMIN'].includes(currentUser?.role)
  const stats=(n:any,l:string)=><div className="stat"><b>{n??0}</b><span>{l}</span></div>

  function Dashboard(){const deadlines=data.deadlines||[];const warning=deadlines.filter((x:any)=>x.deadline_status==='WARNING').length;const expired=deadlines.filter((x:any)=>x.deadline_status==='EXPIRED').length;return <><h1>Главная</h1><p className="muted">Общая информация по иностранным гражданам</p><div className="cards">{stats(data.foreigners,'Всего иностранцев')}{stats(data.visas,'Активные')}{stats(warning,'Срок заканчивается')}{stats(expired,'Просроченные')}{stats(data.registrations,'Регистрации')}</div><div className="grid2"><div className="panel pad"><h2>Что контролируется</h2><p>Документы, визы и разрешения, регистрации, въезд, страхование и история действий.</p></div><div className="panel pad"><h2>Ближайшие сроки</h2>{deadlines.filter((x:any)=>x.deadline_status!=='NORMAL').slice(0,5).map((x:any)=><p key={x.foreigner_id+x.item_type+x.end_date}><b>{x.last_name} {x.first_name}</b> · {x.item_type} · {x.end_date}</p>)}{!warning&&!expired&&<p className="muted">Критичных сроков нет.</p>}</div></div></>}

  function Foreigners(){
    return <><div className="page-title-row"><div><h1>Иностранцы</h1>{notifications.length>0&&<div className="panel warning"><b>Контроль сроков:</b> {notifications.length} уведомлений по документам, визам, регистрациям или страховке. <button onClick={()=>setActive('Контроль сроков')}>Открыть</button></div>}<div className="toolbar"><label className="button">Импорт CSV<input type="file" accept=".csv,text/csv" hidden onChange={importCsv}/></label><span>Колонки: firstName,lastName,citizenship,birthDate,gender,phone,email,entryDate,stayBasis,stayAddress,insuranceCompany,insurancePolicyNumber,insuranceEndDate</span></div><p className="muted">Список всех иностранных граждан</p></div>{canWrite&&<button className="primary" onClick={startAdd}>+ Добавить</button>}</div>{error&&<div className="error">{error}</div>}<div className="panel"><table><thead><tr><th>ФИО</th><th>Гражданство</th><th>Документ</th><th>Виза / Разрешение</th><th>Регистрация</th><th>Статус</th><th>Действия</th></tr></thead><tbody>{foreigners.filter(x=>x.status!=='ARCHIVED').map(x=><tr key={x.id}><td><button className="link" onClick={()=>openForeigner(x)}>{x.last_name} {x.first_name} {x.middle_name||''}</button></td><td>{x.citizenship}</td><td>{x.document?.document_number||'—'}</td><td>{x.visa?.end_date||'—'}</td><td>{x.registration?.end_date||'—'}</td><td><span className="ok">Активен</span></td><td><button onClick={()=>openForeigner(x)}>Открыть</button></td></tr>)}</tbody></table><div className="page-title-row"><span className="muted">Всего: {foreignerTotal}</span><div><button type="button" disabled={foreignerPage<=1} onClick={()=>setForeignerPage(p=>p-1)}>← Назад</button> <span>Страница {foreignerPage} из {Math.max(1,Math.ceil(foreignerTotal/foreignerPageSize))}</span> <button type="button" disabled={foreignerPage>=Math.max(1,Math.ceil(foreignerTotal/foreignerPageSize))} onClick={()=>setForeignerPage(p=>p+1)}>Вперёд →</button></div></div></div>{wizard&&Wizard()}</>
  }

  function Wizard(){
    const labels=['Основные данные','Документ','Въезд','Виза / разрешение','Регистрация','Страховка','Документы','Проверка']
    return <div className="modal-backdrop"><div className="modal wizard"><div className="modal-header"><div><h2>{editing?'Редактировать иностранца':'Добавление иностранца'}</h2><div className="steps">{labels.map((x,i)=><button type="button" key={x} className={step===i+1?'step active':'step'} onClick={()=>setStep(i+1)}>{i+1}. {x}</button>)}</div></div><button onClick={()=>setWizard(false)}>×</button></div>
      <form onSubmit={saveForeigner}>
      {step===1&&<div className="wizard-grid"><div className="panel pad"><h3>Личные данные</h3><div className="form-grid">{[['Фамилия *','lastName'],['Имя *','firstName'],['Отчество','middleName'],['Гражданство *','citizenship'],['Дата рождения','birthDate'],['Пол','gender'],['Телефон','phone'],['Email','email']].map(([l,n]:any)=><label key={n}>{l}<input type={n==='birthDate'?'date':n==='email'?'email':'text'} required={l.includes('*')} value={form[n]} onChange={e=>setForm({...form,[n]:e.target.value})}/></label>)}</div></div><div className="panel pad"><h3>Фотография</h3>{form.photoUrl?<img className="photo" src={form.photoUrl} />:<div className="photo-empty">Фото не загружено</div>}<input type="file" accept="image/*" onChange={readPhoto}/></div></div>}
      {step===2&&<div className="panel pad"><h3>Документ удостоверяющий личность</h3>{editing&&<div className="form-grid"><label className="wide">Редактируемый документ<select value={editingDocId||''} onChange={e=>selectWizardDoc(e.target.value)}><option value="">Новый документ</option>{(selected?.documents||[]).map((d:any)=><option key={d.id} value={d.id}>{d.document_type||'Документ'} №{d.document_number} · до {d.expiry_date||'—'}</option>)}</select></label></div>}<div className="form-grid">{[['Тип документа','documentType'],['Номер','documentNumber'],['Страна выдачи','issuingCountry'],['Дата выдачи','issueDate'],['Срок действия','expiryDate']].map(([l,n]:any)=><label key={n}>{l}<input type={n.includes('Date')?'date':'text'} value={(doc as any)[n==='documentType'?'documentType':n==='documentNumber'?'documentNumber':n==='issuingCountry'?'issuingCountry':n==='issueDate'?'issueDate':'expiryDate']} onChange={e=>setDoc({...doc,[n]:e.target.value})}/></label>)}</div></div>}
      {step===3&&<div className="panel pad"><h3>Въезд и пребывание в Республике Беларусь</h3><div className="form-grid"><label>Дата въезда<input type="date" value={form.entryDate} onChange={e=>setForm({...form,entryDate:e.target.value})}/></label><label>Основание пребывания<input value={form.stayBasis} onChange={e=>setForm({...form,stayBasis:e.target.value})} placeholder="Работа, учеба, частный визит..."/></label><label className="wide">Адрес пребывания<input value={form.stayAddress} onChange={e=>setForm({...form,stayAddress:e.target.value})}/></label></div></div>}
      {step===4&&<div className="panel pad"><h3>Виза / разрешение</h3>{editing&&<div className="form-grid"><label className="wide">Редактируемая виза / разрешение<select value={editingVisaId||''} onChange={e=>selectWizardVisa(e.target.value)}><option value="">Новая запись</option>{(selected?.visas||[]).map((v:any)=><option key={v.id} value={v.id}>{v.visa_type||'Виза'} №{v.visa_number||'—'} · до {v.end_date||'—'}</option>)}</select></label></div>}<div className="form-grid"><label>Тип<input value={visa.visaType} onChange={e=>setVisa({...visa,visaType:e.target.value})}/></label><label>Номер<input value={visa.visaNumber} onChange={e=>setVisa({...visa,visaNumber:e.target.value})}/></label><label>Дата выдачи<input type="date" value={visa.issueDate} onChange={e=>setVisa({...visa,issueDate:e.target.value})}/></label><label>Начало<input type="date" value={visa.startDate} onChange={e=>setVisa({...visa,startDate:e.target.value})}/></label><label>Окончание<input type="date" value={visa.endDate} onChange={e=>setVisa({...visa,endDate:e.target.value})}/></label><label className="wide">Примечание<textarea value={visa.notes} onChange={e=>setVisa({...visa,notes:e.target.value})}/></label></div><p className="muted">Виза сохраняется после создания карточки.</p></div>}
      {step===5&&<div className="panel pad"><h3>Регистрация</h3>{editing&&<div className="form-grid"><label className="wide">Редактируемая регистрация<select value={editingRegistrationId||''} onChange={e=>selectWizardRegistration(e.target.value)}><option value="">Новая регистрация</option>{(selected?.registrations||[]).map((r:any)=><option key={r.id} value={r.id}>{r.registration_type||'Регистрация'} №{r.registration_number||'—'} · до {r.end_date||'—'}</option>)}</select></label></div>}<div className="form-grid"><label>Тип<input value={registration.registrationType} onChange={e=>setRegistration({...registration,registrationType:e.target.value})}/></label><label>Номер<input value={registration.registrationNumber} onChange={e=>setRegistration({...registration,registrationNumber:e.target.value})}/></label><label>Дата начала<input type="date" value={registration.startDate} onChange={e=>setRegistration({...registration,startDate:e.target.value})}/></label><label>Дата окончания<input type="date" value={registration.endDate} onChange={e=>setRegistration({...registration,endDate:e.target.value})}/></label><label className="wide">Гос. номер / ссылка<input value={registration.governmentReference} onChange={e=>setRegistration({...registration,governmentReference:e.target.value})}/></label></div></div>}
      {step===6&&<div className="panel pad"><h3>Страхование</h3><div className="form-grid"><label>Страховая компания<input value={form.insuranceCompany} onChange={e=>setForm({...form,insuranceCompany:e.target.value})}/></label><label>Номер полиса<input value={form.insurancePolicyNumber} onChange={e=>setForm({...form,insurancePolicyNumber:e.target.value})}/></label><label>Действует до<input type="date" value={form.insuranceEndDate} onChange={e=>setForm({...form,insuranceEndDate:e.target.value})}/></label></div></div>}
      {step===7&&<div className="panel pad"><h3>Прикрепленные документы</h3><p>Файл можно прикрепить после сохранения карточки иностранца.</p></div>}
      {step===8&&<div className="panel pad"><h3>Проверка</h3><div className="review"><b>{form.lastName} {form.firstName} {form.middleName}</b><span>{form.citizenship} · {form.birthDate||'дата рождения не указана'} · {form.gender||'пол не указан'}</span><span>Документ: {doc.documentNumber||'не указан'}</span><span>Въезд: {form.entryDate||'не указан'}</span><span>Виза до: {visa.endDate||'не указана'}</span><span>Регистрация до: {registration.endDate||'не указана'}</span><span>Страховка до: {form.insuranceEndDate||'не указана'}</span></div></div>}
      <div className="modal-actions"><button type="button" onClick={()=>step>1?setStep(step-1):setWizard(false)}>Назад</button>{step<8?<button type="button" className="primary" onClick={()=>setStep(step+1)}>Далее →</button>:<button className="primary" disabled={saving}>{saving?'Сохранение...':editing?'Сохранить изменения':'Создать карточку'}</button>}</div></form></div></div>
  }

  async function saveInsurance(e:any){
    e.preventDefault()
    if(!selected)return
    try{
      await api('/foreigners/'+selected.foreigner.id,{method:'PATCH',body:JSON.stringify({
        insuranceCompany:form.insuranceCompany||null,
        insurancePolicyNumber:form.insurancePolicyNumber||null,
        insuranceEndDate:form.insuranceEndDate||null
      })})
      await openForeigner(selected.foreigner)
      setError('')
    }catch(e:any){setError(e.message)}
  }

  function Detail(){
    if(!selected)return null
    const f=selected.foreigner
    const docs=selected.documents||[]
    const visas=selected.visas||[]
    const regs=selected.registrations||[]
    const files=selected.files||[]
    const showError=error&&<div className="error">{error}</div>
    return <>
      <button className="back" onClick={()=>setSelected(null)}>← К списку</button>
      <div className="page-title-row">
        <div className="person-title">{f.photo_url?<img className="avatar" src={f.photo_url}/>:<div className="avatar placeholder">Фото</div>}
          <div><h1>{f.last_name} {f.first_name} {f.middle_name||''}</h1><p className="muted">{f.citizenship} · <span className="ok">Активен</span></p></div>
        </div>
        <div>{canWrite&&<button className="primary" onClick={startEdit}>Редактировать</button>} {canDelete&&<button onClick={()=>archive(f.id)}>Архивировать</button>}</div>
      </div>
      {showError}
      <div className="tabs">{['Основная информация','Документы','Виза / Разрешение','Регистрация','Страховка','История'].map(x=><button key={x} className={detailTab===x?'active':''} onClick={()=>setDetailTab(x)}>{x}</button>)}</div>

      {detailTab==='Основная информация'&&<>
        <div className="grid3">
          <div className="panel pad"><h3>Личные данные</h3><p><b>ФИО:</b> {f.last_name} {f.first_name} {f.middle_name||''}</p><p><b>Гражданство:</b> {f.citizenship}</p><p><b>Дата рождения:</b> {f.birth_date||'—'}</p><p><b>Пол:</b> {f.gender||'—'}</p><p><b>Телефон:</b> {f.phone||'—'}</p><p><b>Email:</b> {f.email||'—'}</p></div>
          <div className="panel pad"><h3>Въезд и пребывание</h3><p><b>Дата въезда:</b> {f.entry_date||'—'}</p><p><b>Основание:</b> {f.stay_basis||'—'}</p><p><b>Адрес:</b> {f.stay_address||'—'}</p></div>
          <div className="panel pad"><h3>Страхование</h3><p><b>Компания:</b> {f.insurance_company||'—'}</p><p><b>Полис:</b> {f.insurance_policy_number||'—'}</p><p><b>Действует до:</b> {f.insurance_end_date||'—'}</p></div>
        </div>
        <div className="panel pad"><h2>Сводка</h2><div className="review"><span>Документов: {docs.length}</span><span>Виз/разрешений: {visas.length}</span><span>Регистраций: {regs.length}</span><span>Файлов: {files.length}</span></div></div>
      </>}

      {detailTab==='Документы'&&<div className="grid2">
        <div className="panel pad"><h2>{editingDocId?'Редактировать документ':'Добавить документ'}</h2>
          {canWrite&&<form onSubmit={saveDoc} className="stack"><input placeholder="Тип документа" value={doc.documentType} onChange={e=>setDoc({...doc,documentType:e.target.value})}/><input placeholder="Номер" required value={doc.documentNumber} onChange={e=>setDoc({...doc,documentNumber:e.target.value})}/><input placeholder="Страна выдачи" value={doc.issuingCountry} onChange={e=>setDoc({...doc,issuingCountry:e.target.value})}/><input type="date" value={doc.issueDate} onChange={e=>setDoc({...doc,issueDate:e.target.value})}/><input type="date" required value={doc.expiryDate} onChange={e=>setDoc({...doc,expiryDate:e.target.value})}/><button className="primary">{editingDocId?'Сохранить изменения':'Сохранить документ'}</button></form>}
          {docs.map((d:any)=><div className="record" key={d.id}><span>{d.document_type} №{d.document_number} · до {d.expiry_date||'—'}</span><span>{canWrite&&<button type="button" onClick={()=>editDoc(d)}>Редактировать</button>} {canDelete&&<button type="button" onClick={()=>deleteDoc(d.id)}>Удалить</button>}</span></div>)}
        </div>
        <div className="panel pad"><h2>Прикрепленные файлы</h2>
          {canWrite&&<form onSubmit={saveFile} className="stack"><input type="file" onChange={readAttachment} required/><input placeholder="Имя файла" value={file.fileName} onChange={e=>setFile({...file,fileName:e.target.value})}/><input type="hidden" value={file.fileUrl} readOnly/><button className="primary" disabled={savingFile}>{savingFile?'Сохранение...':'Прикрепить файл'}</button></form>}
          {files.map((x:any)=><div className="record" key={x.id}><span>{x.file_name} {x.file_size?"· "+Math.round(Number(x.file_size)/1024)+" КБ":""}</span><span><button type="button" onClick={()=>downloadFile(x.id,x.file_name)}>Открыть</button> {canDelete&&<button type="button" onClick={()=>deleteFile(x.id)}>Удалить</button>}</span></div>)}
        </div>
      </div>}

      {detailTab==='Виза / Разрешение'&&<div className="panel pad"><h2>{editingVisaId?'Редактировать визу / разрешение':'Добавить визу / разрешение'}</h2>
        {canWrite&&<form onSubmit={saveVisa} className="stack"><input placeholder="Тип визы / разрешения" required value={visa.visaType} onChange={e=>setVisa({...visa,visaType:e.target.value})}/><input placeholder="Номер" value={visa.visaNumber} onChange={e=>setVisa({...visa,visaNumber:e.target.value})}/><label>Дата выдачи<input type="date" value={visa.issueDate} onChange={e=>setVisa({...visa,issueDate:e.target.value})}/></label><label>Начало действия<input type="date" value={visa.startDate} onChange={e=>setVisa({...visa,startDate:e.target.value})}/></label><label>Окончание действия *<input type="date" required value={visa.endDate} onChange={e=>setVisa({...visa,endDate:e.target.value})}/></label><textarea placeholder="Примечание" value={visa.notes} onChange={e=>setVisa({...visa,notes:e.target.value})}/><button className="primary">{editingVisaId?'Сохранить изменения':'Сохранить визу'}</button></form>}
        {visas.map((v:any)=><div className="record" key={v.id}><span>{v.visa_type} {v.visa_number?'№'+v.visa_number:''} · с {v.start_date||'—'} до {v.end_date||'—'}</span><span>{canWrite&&<button onClick={()=>{setEditingVisaId(v.id);setVisa({visaType:v.visa_type||'',visaNumber:v.visa_number||'',issueDate:v.issue_date||'',startDate:v.start_date||'',endDate:v.end_date||'',notes:v.notes||''});setError('')}}>Редактировать</button>} {canDelete&&<button onClick={()=>deleteVisa(v.id)}>Удалить</button>}</span></div>)}
      </div>}

      {detailTab==='Регистрация'&&<div className="panel pad"><h2>{editingRegistrationId?'Редактировать регистрацию':'Добавить регистрацию'}</h2>
        {canWrite&&<form onSubmit={saveRegistration} className="stack"><input placeholder="Тип регистрации" value={registration.registrationType} onChange={e=>setRegistration({...registration,registrationType:e.target.value})}/><input placeholder="Номер" value={registration.registrationNumber} onChange={e=>setRegistration({...registration,registrationNumber:e.target.value})}/><label>Начало<input type="date" value={registration.startDate} onChange={e=>setRegistration({...registration,startDate:e.target.value})}/></label><label>Окончание *<input type="date" required value={registration.endDate} onChange={e=>setRegistration({...registration,endDate:e.target.value})}/></label><input placeholder="Государственный номер / ссылка" value={registration.governmentReference} onChange={e=>setRegistration({...registration,governmentReference:e.target.value})}/><button className="primary">{editingRegistrationId?'Сохранить изменения':'Сохранить регистрацию'}</button></form>}
        {regs.map((r:any)=><div className="record" key={r.id}><span>{r.registration_type} {r.registration_number?'№'+r.registration_number:''} · с {r.start_date||'—'} до {r.end_date||'—'}</span><span>{canWrite&&<button onClick={()=>editRegistration(r)}>Редактировать</button>} {canDelete&&<button onClick={()=>deleteRegistration(r.id)}>Удалить</button>}</span></div>)}
      </div>}

      {detailTab==='Страховка'&&<div className="panel pad"><h2>Страхование</h2>
        {canWrite&&<form onSubmit={saveInsurance} className="stack"><input placeholder="Страховая компания" value={form.insuranceCompany||''} onChange={e=>setForm({...form,insuranceCompany:e.target.value})}/><input placeholder="Номер полиса" value={form.insurancePolicyNumber||''} onChange={e=>setForm({...form,insurancePolicyNumber:e.target.value})}/><label>Действует до<input type="date" value={form.insuranceEndDate||''} onChange={e=>setForm({...form,insuranceEndDate:e.target.value})}/></label><button className="primary">Сохранить страховку</button></form>}
        <div className="review"><span>Компания: {f.insurance_company||'—'}</span><span>Полис: {f.insurance_policy_number||'—'}</span><span>До: {f.insurance_end_date||'—'}</span></div>
      </div>}

      {detailTab==='История'&&<div className="panel pad"><h2>История карточки</h2>{(data.foreignerHistory||[]).map((x:any)=><div className="history" key={x.id}><b>{x.action} · {x.entity_type}</b><span>{new Date(x.created_at).toLocaleString()} · {x.first_name||'система'}</span></div>)}{!(data.foreignerHistory||[]).length&&<p className="muted">История операций пока пуста.</p>}</div>}
    </>
  }

  function exportExcel(){
    const rows=data.deadlines||[]
    const esc=(v:any)=>{const s=String(v??'');return '"'+s.replace(/"/g,'""')+'"'}
    const csv='ФИО,Тип,Запись,Срок,Статус\\n'+rows.map((x:any)=>[x.last_name+' '+x.first_name,x.item_type,x.item_name,x.end_date,x.deadline_status].map(esc).join(',')).join('\\n')
    const blob=new Blob(['\\ufeff',csv],{type:'text/csv;charset=utf-8'})
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='foreignid-report.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  function exportPdf(){
    const rows=data.deadlines||[]
    const w=window.open('','_blank')
    if(!w){setError('Браузер заблокировал окно печати. Разрешите всплывающие окна.');return}
    const esc=(v:any)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    w.document.write('<html><head><title>ForeignID — отчет</title><style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #777;padding:5px;text-align:left}h1{font-size:18px}</style></head><body><h1>ForeignID — отчет по срокам</h1><p>Сформировано: '+esc(new Date().toLocaleString())+'</p><table><tr><th>ФИО</th><th>Тип</th><th>Запись</th><th>Срок</th><th>Статус</th></tr>'+rows.map((x:any)=>'<tr><td>'+esc(x.last_name+' '+x.first_name)+'</td><td>'+esc(x.item_type)+'</td><td>'+esc(x.item_name)+'</td><td>'+esc(x.end_date)+'</td><td>'+esc(x.deadline_status)+'</td></tr>').join('')+'</table></body></html>')
    w.document.close();w.focus();setTimeout(()=>w.print(),200)
  }
  function Section(){
    if(active==='Главная')return Dashboard()
    if(active==='Иностранцы')return Foreigners()
    if(active==='Настройки')return <><div className="panel pad"><h1>Настройки</h1><h3>Профиль</h3><p><b>Пользователь:</b> {currentUser?.first_name||''} {currentUser?.last_name||''}</p><p><b>Email:</b> {currentUser?.email||'—'}</p><p><b>Роль:</b> {currentUser?.role||'—'}</p></div>{['SUPER_ADMIN','ORG_ADMIN'].includes(currentUser?.role)&&<div className="panel pad"><h2>Пользователи</h2><form onSubmit={saveUser} className="stack"><input required={!editingUserId} disabled={!!editingUserId} placeholder="Email" value={userForm.email} onChange={e=>setUserForm({...userForm,email:e.target.value})}/><input required={!editingUserId} type="password" placeholder={editingUserId?'Новый пароль (необязательно)':'Пароль'} value={userForm.password} onChange={e=>setUserForm({...userForm,password:e.target.value})}/><input required placeholder="Имя" value={userForm.firstName} onChange={e=>setUserForm({...userForm,firstName:e.target.value})}/><input required placeholder="Фамилия" value={userForm.lastName} onChange={e=>setUserForm({...userForm,lastName:e.target.value})}/><select value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}><option value="OPERATOR">Оператор</option><option value="VIEWER">Просмотр</option>{currentUser?.role==='SUPER_ADMIN'&&<option value="ORG_ADMIN">Администратор</option>}</select>{editingUserId&&<label><input type="checkbox" checked={userForm.isActive} onChange={e=>setUserForm({...userForm,isActive:e.target.checked})}/> Активен</label>}<button className="primary">{editingUserId?'Сохранить изменения':'Добавить пользователя'}</button>{editingUserId&&<button type="button" onClick={()=>{setEditingUserId(null);setUserForm({email:'',password:'',firstName:'',lastName:'',role:'OPERATOR',isActive:true})}}>Отмена</button>}</form><div>{users.map((u:any)=><div className="record" key={u.id}><div><b>{u.first_name} {u.last_name}</b><span>{u.email} · {u.role} · {u.is_active?'активен':'отключён'}</span></div>{u.id!==currentUser?.id&&<button type="button" onClick={()=>{setEditingUserId(u.id);setUserForm({email:u.email,password:'',firstName:u.first_name||'',lastName:u.last_name||'',role:u.role,isActive:Boolean(u.is_active)})}}>Изменить</button>}</div>)}</div></div>}</>    if(active==='Контроль сроков')return <><h1>Контроль сроков</h1><p className="muted">Сроки регистрации, виз, документов и страхования.</p><div className="panel"><table><thead><tr><th>ФИО</th><th>Тип</th><th>Запись</th><th>Срок</th><th>Статус</th></tr></thead><tbody>{(data.data||[]).map((x:any)=><tr key={x.item_type+x.item_name+x.end_date}><td>{x.last_name} {x.first_name}</td><td>{x.item_type}</td><td>{x.item_name}</td><td>{x.end_date}</td><td><span className={x.deadline_status==='EXPIRED'?'bad':x.deadline_status==='WARNING'?'warn':'ok'}>{x.deadline_status==='EXPIRED'?'ПРОСРОЧЕНО':x.deadline_status==='WARNING'?'СКОРО':'В НОРМЕ'}</span></td></tr>)}</tbody></table></div></><div className="page-title-row"><span className="muted">Всего: {data.total||0}</span><div><button type="button" disabled={sectionPage<=1} onClick={()=>setSectionPage(p=>Math.max(1,p-1))}>← Назад</button> <span>Страница {sectionPage} из {Math.max(1,Math.ceil(Number(data.total||0)/sectionPageSize))}</span> <button type="button" disabled={sectionPage*sectionPageSize>=Number(data.total||0)} onClick={()=>setSectionPage(p=>p+1)}>Вперёд →</button></div></div></>
    if(active==='Документы')return <><h1>Документы</h1><p className="muted">Хранилище и управление документами.</p>{error&&<div className="error">{error}</div>}<div className="grid2"><div className="panel pad"><h2>{topEditingDocId?'Редактировать документ':'Добавить документ'}</h2>{canWrite&&<form onSubmit={saveTopDocument} className="stack">{!topEditingDocId&&<label>Иностранец<select required value={topDocForeignerId} onChange={e=>setTopDocForeignerId(e.target.value)}><option value="">Выберите иностранца</option>{foreigners.filter((x:any)=>x.status!=='ARCHIVED').map((x:any)=><option key={x.id} value={x.id}>{x.last_name} {x.first_name} · {x.citizenship}</option>)}</select></label>}<input placeholder="Тип документа" value={topDoc.documentType} onChange={e=>setTopDoc({...topDoc,documentType:e.target.value})}/><input placeholder="Номер" required value={topDoc.documentNumber} onChange={e=>setTopDoc({...topDoc,documentNumber:e.target.value})}/><input placeholder="Страна выдачи" value={topDoc.issuingCountry} onChange={e=>setTopDoc({...topDoc,issuingCountry:e.target.value})}/><label>Дата выдачи<input type="date" value={topDoc.issueDate} onChange={e=>setTopDoc({...topDoc,issueDate:e.target.value})}/></label><label>Дата окончания *<input type="date" required value={topDoc.expiryDate} onChange={e=>setTopDoc({...topDoc,expiryDate:e.target.value})}/></label><button className="primary" disabled={topDocSaving}>{topDocSaving?'Сохранение...':topEditingDocId?'Сохранить изменения':'Добавить документ'}</button>{topEditingDocId&&<button type="button" onClick={()=>{setTopEditingDocId(null);setTopDoc({documentType:'Паспорт',documentNumber:'',issuingCountry:'',issueDate:'',expiryDate:''})}}>Отмена</button>}</form>}</div><div className="panel pad"><h2>Список документов</h2>{(data.documents||[]).length?(data.documents||[]).map((d:any)=><div className="record" key={d.id}><div><b>{d.last_name} {d.first_name}</b><span>{d.document_type} №{d.document_number} · {d.issuing_country||'страна не указана'} · до {d.expiry_date||'—'}</span></div><span>{canWrite&&<button type="button" onClick={()=>editTopDocument(d)}>Редактировать</button>} {canDelete&&<button type="button" onClick={()=>deleteTopDocument(d.id)}>Удалить</button>}<button type="button" onClick={()=>{setDetailTab('Документы');openForeigner({id:d.foreigner_id})}}>Открыть карточку</button></span></div>):<p className="muted">Документов пока нет.</p>}<div className="page-title-row"><span className="muted">Всего документов: {data.documentsTotal||0}</span><div><button type="button" disabled={sectionPage<=1} onClick={()=>setSectionPage(p=>Math.max(1,p-1))}>← Назад</button> <span>Страница {sectionPage}</span> <button type="button" disabled={sectionPage*sectionPageSize>=Number(data.documentsTotal||0)} onClick={()=>setSectionPage(p=>p+1)}>Вперёд →</button></div></div></div></div><div className="panel pad"><h2>Визы / разрешения</h2>{(data.visas||[]).length?(data.visas||[]).map((v:any)=><div className="record" key={v.id}><div><b>{v.last_name} {v.first_name}</b><span>{v.visa_type}{v.visa_number?' №'+v.visa_number:''} · до {v.end_date||'—'}</span></div><button type="button" onClick={()=>{openForeigner({id:v.foreigner_id});setDetailTab('Виза / Разрешение')}}>Открыть карточку</button></div>):<p className="muted">Виз и разрешений пока нет.</p>}</div><div className="page-title-row"><span className="muted">Документы: {data.documentsTotal||0} · Визы: {data.visasTotal||0}</span><div><button type="button" disabled={sectionPage<=1} onClick={()=>setSectionPage(p=>Math.max(1,p-1))}>← Назад</button> <span>Страница {sectionPage} из {Math.max(1,Math.ceil(Math.max(Number(data.documentsTotal||0),Number(data.visasTotal||0))/sectionPageSize))}</span> <button type="button" disabled={sectionPage*sectionPageSize>=Math.max(Number(data.documentsTotal||0),Number(data.visasTotal||0))} onClick={()=>setSectionPage(p=>p+1)}>Вперёд →</button></div></div></>
    if(active==='История')return <><h1>История действий</h1><p className="muted">Журнал операций пользователей.</p><div className="panel">{(data.data||[]).map((x:any)=><div className="history" key={x.id}><b>{x.action} · {x.entity_type}</b><span>{new Date(x.created_at).toLocaleString()} · {x.first_name||'система'}</span></div>)}</div><div className="page-title-row"><span className="muted">Всего: {data.total||0}</span><div><button type="button" disabled={sectionPage<=1} onClick={()=>setSectionPage(p=>Math.max(1,p-1))}>← Назад</button> <span>Страница {sectionPage}</span> <button type="button" disabled={sectionPage*sectionPageSize>=Number(data.total||0)} onClick={()=>setSectionPage(p=>p+1)}>Вперёд →</button></div></div></>
    if(applicationLogs&&applicationLogsId)return <div className="panel pad"><h2>Журнал обмена</h2><button type="button" onClick={()=>{setApplicationLogs(null);setApplicationLogsId(null)}}>Закрыть</button><h3>Статусы</h3>{(applicationLogs.history||[]).map((h:any)=><div className="history" key={h.id}><b>{h.status}</b><span>{new Date(h.created_at).toLocaleString()} · {h.message||'—'}</span></div>)}<h3>Обмен</h3>{(applicationLogs.logs||[]).map((l:any)=><div className="history" key={l.id}><b>{l.direction}{l.http_status?' · HTTP '+l.http_status:''}</b><span>{new Date(l.created_at).toLocaleString()} · {l.error||'без ошибки'}</span></div>)}</div>
    if(active==='Е-паслуга')return <><h1>Е-паслуга</h1><p className="muted">Подготовка заявки на официальную государственную услугу.</p>{error&&<div className="error">{error}</div>}<div className="panel pad"><h2>Создать заявку</h2><div className="form-grid"><label>Иностранец<select value={applicationForeignerId} onChange={e=>setApplicationForeignerId(e.target.value)}><option value="">Выберите иностранца</option>{foreigners.filter((x:any)=>x.status!=='ARCHIVED').map((x:any)=><option key={x.id} value={x.id}>{x.last_name} {x.first_name} · {x.citizenship}</option>)}</select></label><label>Услуга<input value={serviceType} onChange={e=>setServiceType(e.target.value)} placeholder="Например: Регистрация иностранного гражданина"/></label></div>{canWrite&&<button className="primary" disabled={!applicationForeignerId||creatingApplication} onClick={()=>createApplication(applicationForeignerId)}>Создать заявку</button>}<p className="muted">Заявка получает статус подготовки к официальной отправке. Фактическая отправка выполняется через официальный государственный канал.</p></div><div className="panel"><h2 className="pad">Заявки</h2>{(data.data||[]).length?(data.data||[]).map((x:any)=><div className="history" key={x.id}><div><b>{x.service_type}</b><span>{x.last_name||''} {x.first_name||''} · {x.status}{x.external_reference?' · № '+x.external_reference:''}</span>{x.last_status_message&&<span className="muted">{x.last_status_message}</span>}</div><span>{canWrite&&<button type="button" onClick={()=>prepareApplication(x.id)}>Сформировать запрос</button>}<button type="button" onClick={()=>loadApplicationLogs(x.id)}>Журнал</button></span></div>):<div className="pad">Заявок пока нет.</div>}</div></>
    <div className="page-title-row"><span className="muted">Всего заявок: {data.total||0}</span><div><button type="button" disabled={sectionPage<=1} onClick={()=>setSectionPage(p=>Math.max(1,p-1))}>← Назад</button> <span>Страница {sectionPage}</span> <button type="button" disabled={sectionPage*sectionPageSize>=Number(data.total||0)} onClick={()=>setSectionPage(p=>p+1)}>Вперёд →</button></div></div></>
    if(active==='Отчёты')return <><h1>Отчёты</h1><p className="muted">Сводка по организации</p><div className="cards">{stats(Number(data?.foreigners)||0,'Иностранцев')}{stats(Number(data?.documents)||0,'Документов')}{stats(Number(data?.visas)||0,'Активных виз')}{stats(Number(data?.registrations)||0,'Регистраций')}</div><div className="panel pad"><h2>Экспорт</h2><p className="muted">Отчет по документам, визам и регистрациям с контрольными сроками.</p><button type="button" onClick={exportExcel}>Экспорт Excel</button> <button type="button" onClick={exportPdf}>Экспорт PDF</button></div></>
    return null
  }

  return <div className="app"><aside><h2>◈ ForeignID</h2>{nav.map(x=><button key={x} className={'nav '+(active===x?'active':'')} onClick={()=>{setActive(x);setSelected(null);setWizard(false)}}>{x}</button>)}<button className="logout" onClick={()=>{localStorage.removeItem('token');setToken(null);setSelected(null);setWizard(false)}}>Выйти</button></aside><main><header><input placeholder="Поиск по ФИО, документу, телефону..." value={q} onChange={e=>setQ(e.target.value)}/><span>{currentUser?`${currentUser.first_name||''} ${currentUser.last_name||''} · ${currentUser.role}`:'Пользователь'}</span></header>{selected?Detail():Section()}{wizard&&Wizard()}</main></div>
}
createRoot(document.getElementById('root')!).render(<App/>)
