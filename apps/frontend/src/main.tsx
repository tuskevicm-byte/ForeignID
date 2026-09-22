import React from 'react'
import {createRoot} from 'react-dom/client'
import './styles.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'

function el(type:any, props:any, ...children:any[]) {
  return React.createElement(type, props, ...children)
}

function App() {
  const [token, setToken] = React.useState(localStorage.getItem('token'))
  const [email, setEmail] = React.useState('admin@example.local')
  const [password, setPassword] = React.useState('ChangeMe-123!')
  const [foreigners, setForeigners] = React.useState<any[]>([])
  const [q, setQ] = React.useState('')
  const [error, setError] = React.useState('')
  const [active, setActive] = React.useState('Иностранцы')
  const [showCreate, setShowCreate] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({
    firstName:'', middleName:'', lastName:'', citizenship:'', birthDate:'', phone:'', email:''
  })

  async function login(e:any) {
    e.preventDefault()
    setError('')
    try {
      const r = await fetch(API + '/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password})})
      const d = await r.json()
      if (!r.ok) { setError(d.message || 'Ошибка входа'); return }
      localStorage.setItem('token', d.accessToken)
      setToken(d.accessToken)
    } catch {
      setError('Не удалось подключиться к серверу')
    }
  }

  async function load() {
    if (!token) return
    try {
      const r = await fetch(API + '/foreigners?q=' + encodeURIComponent(q), {headers:{Authorization:'Bearer ' + token}})
      const d = await r.json()
      if (r.ok) setForeigners(d.data || [])
      else if (r.status === 401) { localStorage.removeItem('token'); setToken(null) }
    } catch {
      setError('Не удалось загрузить список иностранцев')
    }
  }

  React.useEffect(() => { if (token) load() }, [token, q])

  function setField(name:string, value:string) {
    setForm(prev => ({...prev, [name]:value}))
  }

  async function createForeigner(e:any) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const r = await fetch(API + '/foreigners', {
        method:'POST',
        headers:{'Content-Type':'application/json', Authorization:'Bearer ' + token},
        body:JSON.stringify(form)
      })
      const d = await r.json()
      if (!r.ok) {
        setError(d.message || 'Не удалось создать запись')
        return
      }
      setForm({firstName:'',middleName:'',lastName:'',citizenship:'',birthDate:'',phone:'',email:''})
      setShowCreate(false)
      await load()
    } catch {
      setError('Не удалось подключиться к серверу')
    } finally {
      setSaving(false)
    }
  }

  if (!token) {
    return el('div',{className:'login'},
      el('form',{onSubmit:login},
        el('h1',null,'ForeignID'),
        el('p',null,'Система учета иностранных граждан'),
        el('input',{value:email,onChange:(e:any)=>setEmail(e.target.value),placeholder:'Email'}),
        el('input',{type:'password',value:password,onChange:(e:any)=>setPassword(e.target.value),placeholder:'Пароль'}),
        error && el('div',{className:'error'},error),
        el('button',null,'Войти'),
        el('small',null,'Демо: admin@example.local / ChangeMe-123!')
      )
    )
  }

  const nav = ['Главная','Иностранцы','Контроль сроков','Е-паслуга','Документы','Отчёты','История','Настройки']

  function renderContent() {
    if (active === 'Иностранцы') {
      return el('div',null,
        el('div',{className:'page-title-row'},
          el('div',null,
            el('h1',null,'Иностранцы'),
            el('p',{className:'muted'},'Данные загружаются из PostgreSQL через защищенный API')
          ),
          el('button',{className:'primary',onClick:()=>{setError('');setShowCreate(true)}},'+ Добавить иностранца')
        ),
        error && el('div',{className:'error page-error'},error),
        el('div',{className:'cards'},
          el('div',null,el('b',null,String(foreigners.length)),el('span',null,'Записей')),
          el('div',null,el('b',null,'Контроль'),el('span',null,'Сроков включен')),
          el('div',null,el('b',null,'RBAC'),el('span',null,'Активен'))
        ),
        el('div',{className:'panel'},
          el('table',null,
            el('thead',null,el('tr',null,el('th',null,'ФИО'),el('th',null,'Гражданство'),el('th',null,'Документ'),el('th',null,'Статус'))),
            el('tbody',null,...foreigners.map((x:any)=>el('tr',{key:x.id},
              el('td',null,x.last_name+' '+x.first_name+' '+(x.middle_name||'')),
              el('td',null,x.citizenship),
              el('td',null,x.document_number||'—'),
              el('td',null,el('span',{className:'ok'},x.status||'ACTIVE'))
            )))
          )
        ),
        showCreate && el('div',{className:'modal-backdrop'},
          el('div',{className:'modal'},
            el('div',{className:'modal-header'},
              el('div',null,el('h2',null,'Добавить иностранца'),el('p',{className:'muted'},'Обязательные поля отмечены *')),
              el('button',{className:'modal-close',type:'button',onClick:()=>setShowCreate(false)},'×')
            ),
            el('form',{onSubmit:createForeigner},
              el('div',{className:'form-grid'},
                el('label',null,'Имя *',el('input',{required:true,value:form.firstName,onChange:(e:any)=>setField('firstName',e.target.value),placeholder:'Иван'})),
                el('label',null,'Фамилия *',el('input',{required:true,value:form.lastName,onChange:(e:any)=>setField('lastName',e.target.value),placeholder:'Иванов'})),
                el('label',null,'Отчество',el('input',{value:form.middleName,onChange:(e:any)=>setField('middleName',e.target.value),placeholder:'Иванович'})),
                el('label',null,'Гражданство *',el('input',{required:true,value:form.citizenship,onChange:(e:any)=>setField('citizenship',e.target.value),placeholder:'Украина'})),
                el('label',null,'Дата рождения',el('input',{type:'date',value:form.birthDate,onChange:(e:any)=>setField('birthDate',e.target.value)})),
                el('label',null,'Телефон',el('input',{value:form.phone,onChange:(e:any)=>setField('phone',e.target.value),placeholder:'+1 ...'})),
                el('label',{className:'full'},'Email',el('input',{type:'email',value:form.email,onChange:(e:any)=>setField('email',e.target.value),placeholder:'name@example.com'}))
              ),
              el('div',{className:'modal-actions'},
                el('button',{type:'button',onClick:()=>setShowCreate(false)},'Отмена'),
                el('button',{type:'submit',className:'primary',disabled:saving},saving?'Сохранение...':'Сохранить')
              )
            )
          )
        )
      )
    }

    const descriptions:any = {
      'Главная':'Обзор системы и основные показатели.',
      'Контроль сроков':'Контроль сроков пребывания, документов и уведомлений.',
      'Е-паслуга':'Заявки и взаимодействие с государственными электронными услугами.',
      'Документы':'Документы иностранных граждан и связанные записи.',
      'Отчёты':'Отчёты и аналитика по зарегистрированным иностранцам.',
      'История':'История операций и изменений в системе.',
      'Настройки':'Настройки профиля, доступа и параметров системы.'
    }

    return el('div',{className:'panel page-placeholder'},
      el('h1',null,active),
      el('p',{className:'muted'},descriptions[active]),
      el('p',null,'Раздел открыт. Функционал этого раздела будет подключен к API следующим этапом.')
    )
  }

  return el('div',{className:'app'},
    el('aside',null,
      el('h2',null,'◈ ForeignID'),
      ...nav.map(x=>el('button',{
        className:'nav'+(active===x?' active':''),
        key:x,
        onClick:()=>setActive(x)
      },x)),
      el('button',{className:'logout',onClick:()=>{localStorage.removeItem('token');setToken(null)}},'Выйти')
    ),
    el('main',null,
      el('header',null,
        el('input',{placeholder:'Поиск по ФИО, гражданству...',value:q,onChange:(e:any)=>setQ(e.target.value)}),
        el('span',null,'Иванов А.А.')
      ),
      renderContent()
    )
  )
}

createRoot(document.getElementById('root')!).render(el(App,null))
