import { FormEvent, useEffect, useState } from 'react'
import { Instance, listInstances, resolveApiErrorMessage } from '../api'
import { LocalUser, UserRole, createUser, deleteUser, getUserPermissions, listUsers, setUserPermissions, updateUser } from '../api/users'

export default function UsersPage() {
  const [users, setUsers] = useState<LocalUser[]>([])
  const [instances, setInstances] = useState<Instance[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [assigned, setAssigned] = useState<string[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('instance_admin')
  const [message, setMessage] = useState<string | null>(null)
  const reload = async () => { setUsers(await listUsers()); setInstances(await listInstances()) }
  useEffect(() => { void reload().catch((e) => setMessage(resolveApiErrorMessage(e))) }, [])
  useEffect(() => { if (selected) void getUserPermissions(selected).then((p) => setAssigned(p.map((x) => x.instanceId))) }, [selected])
  const submit = async (event: FormEvent) => { event.preventDefault(); setMessage(null); try { await createUser({ username, password, role }); setUsername(''); setPassword(''); await reload() } catch (e) { setMessage(resolveApiErrorMessage(e)) } }
  const savePermissions = async () => { if (!selected) return; await setUserPermissions(selected, assigned); setMessage('Freigaben gespeichert.') }
  return <section className="page"><div className="page__header"><h1>Benutzerverwaltung</h1><p className="page__hint">Lokale Benutzer, Rollen und Instanz-Freigaben.</p></div>{message ? <div className="notice">{message}</div> : null}<form className="card form-grid" onSubmit={submit}><label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} /></label><label>Passwort<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><label>Rolle<select value={role} onChange={(e) => setRole(e.target.value as UserRole)}><option value="instance_admin">Instance Admin</option><option value="admin">Admin</option></select></label><button className="btn btn--primary" type="submit">Benutzer anlegen</button></form><div className="card"><h2>Benutzer</h2>{users.map((user) => <div className="row" key={user.id}><button className="btn btn--ghost" onClick={() => setSelected(user.id)}>{user.username} ({user.role})</button><button className="btn" onClick={() => updateUser(user.id, { disabled: !user.disabled }).then(reload)}>{user.disabled ? 'Aktivieren' : 'Deaktivieren'}</button><button className="btn btn--danger" onClick={() => deleteUser(user.id).then(reload)}>Löschen</button></div>)}</div>{selected ? <div className="card"><h2>Instanz-Freigaben</h2>{instances.map((instance) => <label key={instance.id} className="checkbox-row"><input type="checkbox" checked={assigned.includes(instance.id)} onChange={(e) => setAssigned((old) => e.target.checked ? [...old, instance.id] : old.filter((id) => id !== instance.id))} />{instance.name}</label>)}<button className="btn btn--primary" onClick={savePermissions}>Freigaben speichern</button></div> : null}</section>
}
