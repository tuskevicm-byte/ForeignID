import React from 'react'
import {createRoot} from 'react-dom/client'
import './styles.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'

function el(type:any, props:any, ...children:any[]) {
  return React.createElement(type, props, ...children)
}

function App() {
  // Navigation update: 2026-09-22
  const [token, setToken] = React.useState(localStorage.getItem('token'))
  const [email, setEmail] = React.useState('admin@example.local')
  const [password, setPassword] = React.useState('ChangeMe-123!')
  const [foreigners, setForeigners] = React.useState<any[]>([])
  const [q, setQ] = React.useState('')
  const [error, setError] = React.useState('')
  const [active, setActive] = React.useState('Иностранцы')

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
    try {
      const r = await fetch(API + '/foreigners?q=' + encodeURIComponent(q), {headers:{Authorization:'Bearer ' + token}})
      if (r.ok) { const d = await r.json(); setForeigners(d.data || []) }
    } catch {}
  }

  React.useEffect(() => { if (token) load() }, [token, q])

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
        el('h1',null,'Иностранцы'),
        el('p',{className:'muted'},'Данные загружаются из PostgreSQL через защищенный API'),
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
              el('td',null,el('span',{className:'ok'},x.status))
            )))
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
