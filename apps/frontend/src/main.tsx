import React from 'react'
import {createRoot} from 'react-dom/client'
import './styles.css'

const API=import.meta.env.VITE_API_URL||'http://localhost:3000/api/v1'

function App(){
 const [token,setToken]=React.useState(localStorage.getItem('token'))
 const [email,setEmail]=React.useState('admin@example.local')
 const [password,setPassword]=React.useState('ChangeMe-123!')
 const [foreigners,setForeigners]=React.useState<any[]>([])
 const [q,setQ]=React.useState('')
 const [error,setError]=React.useState('')
 async function login(e:React.FormEvent){e.preventDefault();setError('');const r=await fetch(API+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const d=await r.json();if(!r.ok){setError(d.message||'Ошибка входа');return}localStorage.setItem('token',d.accessToken);setToken(d.accessToken)}
 async function load(){const r=await fetch(API+'/foreigners?q='+encodeURIComponent(q),{headers:{Authorization:'Bearer '+token}});if(r.ok){const d=await r.json();setForeigners(d.data)}}
 React.useEffect(()=>{if(token)load()},[token,q])
 if(!token)return <div className="login"><form onSubmit={login}><h1>ForeignID</h1><p>Система учета иностранных граждан</p><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email"/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Пароль"/>{error&&<div className="error">{error}</div>}<button>Войти</button><small>Демо: admin@example.local / ChangeMe-123!</small></form></div>
 return <div className="app"><aside><h2>◈ ForeignID</h2>{['Главная','Иностранцы','Контроль сроков','Е-паслуга','Документы','Отчёты','История','Настройки'].map(x=><div className="nav" key={x}>{x}</div>)}<button className="logout" onClick={()=>{localStorage.removeItem('token');setToken(null)}}>Выйти</button></aside><main><header><input placeholder="Поиск по ФИО, гражданству..." value={q} onChange={e=>setQ(e.target.value)}/><span>Иванов А.А.</span></header><h1>Иностранцы</h1><p className="muted">Данные загружаются из PostgreSQL через защищенный API</p><div className="cards"><div><b>{foreigners.length}</b><span>Записей</span></div><div><b>Контроль</b><span>Сроков включен</span></div><div><b>RBAC</b><span>Активен</span></div></div><div className="panel"><table><thead><tr><th>ФИО</th><th>Гражданство</th><th>Документ</th><th>Статус</th></tr></thead><tbody>{foreigners.map(x=><tr key={x.id}><td>{x.last_name} {x.first_name} {x.middle_name||''}</td><td>{x.citizenship}</td><td>{x.document_number||'—'}</td><td><span className="ok">{x.status}</span></td></tr>)}</tbody></table></div></main></div>
}
createRoot(document.getElementById('root')!).render(<App/>)
