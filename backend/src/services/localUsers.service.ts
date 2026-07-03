import { createHash, randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import bcrypt from 'bcryptjs'
import { getDataDir } from '../config/paths'

export type UserRole = 'admin' | 'instance_admin'
export type InstancePermissionName = 'manage' | 'console' | 'files' | 'backups' | 'settings'
export type LocalUser = { id: string; username: string; passwordHash: string; role: UserRole; disabled?: boolean; createdAt: string; updatedAt: string }
export type SafeUser = Omit<LocalUser, 'passwordHash'>
export type InstancePermission = { userId: string; instanceId: string; permissions: InstancePermissionName[] }
type UsersFile = { users: LocalUser[] }
type PermissionsFile = { permissions: InstancePermission[] }
type Session = { tokenHash: string; userId: string; expiresAt: string; createdAt: string }
type SessionsFile = { sessions: Session[] }
const usersPath = () => path.join(getDataDir(), 'users.json')
const permissionsPath = () => path.join(getDataDir(), 'instance_permissions.json')
const sessionsPath = () => path.join(getDataDir(), 'sessions.json')
let writeQueue: Promise<unknown> = Promise.resolve()
const enqueue = async <T>(fn: () => Promise<T>) => { const next = writeQueue.then(fn, fn); writeQueue = next.catch(() => undefined); return next }
const readJson = async <T>(file: string, fallback: T): Promise<T> => { try { return JSON.parse(await fs.readFile(file, 'utf-8')) as T } catch (e: any) { if (e.code === 'ENOENT') return fallback; throw e } }
const writeJsonAtomic = async (file: string, data: unknown) => { await fs.mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.${Date.now()}.tmp`; await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8'); await fs.rename(tmp, file) }
const now = () => new Date().toISOString()
const safeUser = ({ passwordHash: _passwordHash, ...user }: LocalUser): SafeUser => user
const hashToken = (token: string) => `sha256:${createHash('sha256').update(token).digest('hex')}`
export const hashPassword = async (password: string) => bcrypt.hash(password, 12)
export const verifyPassword = async (password: string, stored: string) => bcrypt.compare(password, stored)
export const localUsersService = {
  async listUsers() { return (await readJson<UsersFile>(usersPath(), { users: [] })).users.map(safeUser) },
  async hasUsers() { return (await readJson<UsersFile>(usersPath(), { users: [] })).users.length > 0 },
  async getUser(id: string) { return (await readJson<UsersFile>(usersPath(), { users: [] })).users.find((u) => u.id === id && !u.disabled) ?? null },
  async findByUsername(username: string) { return (await readJson<UsersFile>(usersPath(), { users: [] })).users.find((u) => u.username.toLowerCase() === username.toLowerCase()) ?? null },
  async createUser(input: { username: string; password: string; role: UserRole }) { return enqueue(async () => { const username = input.username.trim(); if (!username || input.password.length < 8) throw new Error('INVALID_USER_INPUT'); const data = await readJson<UsersFile>(usersPath(), { users: [] }); if (data.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new Error('USER_EXISTS'); const ts = now(); const user: LocalUser = { id: randomBytes(12).toString('hex'), username, passwordHash: await hashPassword(input.password), role: input.role, createdAt: ts, updatedAt: ts }; data.users.push(user); await writeJsonAtomic(usersPath(), data); return safeUser(user) }) },
  async updateUser(id: string, input: { username?: string; password?: string; role?: UserRole; disabled?: boolean }) { return enqueue(async () => { const data = await readJson<UsersFile>(usersPath(), { users: [] }); const user = data.users.find((u) => u.id === id); if (!user) return null; if (input.username) user.username = input.username.trim(); if (input.role) user.role = input.role; if (typeof input.disabled === 'boolean') user.disabled = input.disabled; if (input.password) user.passwordHash = await hashPassword(input.password); user.updatedAt = now(); await writeJsonAtomic(usersPath(), data); return safeUser(user) }) },
  async deleteUser(id: string) { return enqueue(async () => { const data = await readJson<UsersFile>(usersPath(), { users: [] }); const next = data.users.filter((u) => u.id !== id); await writeJsonAtomic(usersPath(), { users: next }); const perms = await readJson<PermissionsFile>(permissionsPath(), { permissions: [] }); await writeJsonAtomic(permissionsPath(), { permissions: perms.permissions.filter((p) => p.userId !== id) }); return next.length !== data.users.length }) },
  async createSession(userId: string, remember?: boolean) { const token = randomBytes(32).toString('hex'); const ttl = remember ? 30*24*60*60*1000 : 12*60*60*1000; const expiresAt = new Date(Date.now()+ttl).toISOString(); await enqueue(async () => { const data = await readJson<SessionsFile>(sessionsPath(), { sessions: [] }); data.sessions.push({ tokenHash: hashToken(token), userId, expiresAt, createdAt: now() }); await writeJsonAtomic(sessionsPath(), { sessions: data.sessions.filter((s) => Date.parse(s.expiresAt) > Date.now()) }) }); return { token, expiresAt } },
  async getUserBySession(token?: string) { if (!token) return null; const data = await readJson<SessionsFile>(sessionsPath(), { sessions: [] }); const session = data.sessions.find((s) => s.tokenHash === hashToken(token) && Date.parse(s.expiresAt) > Date.now()); return session ? this.getUser(session.userId) : null },
  async destroySession(token?: string) { if (!token) return; await enqueue(async () => { const data = await readJson<SessionsFile>(sessionsPath(), { sessions: [] }); await writeJsonAtomic(sessionsPath(), { sessions: data.sessions.filter((s) => s.tokenHash !== hashToken(token)) }) }) },
  async listPermissions() { return (await readJson<PermissionsFile>(permissionsPath(), { permissions: [] })).permissions },
  async setPermissions(userId: string, instanceIds: string[]) { return enqueue(async () => { const data = await readJson<PermissionsFile>(permissionsPath(), { permissions: [] }); const permissions: InstancePermissionName[] = ['manage','console','files','backups','settings']; const next = [...data.permissions.filter((p) => p.userId !== userId), ...Array.from(new Set(instanceIds)).map((instanceId) => ({ userId, instanceId, permissions }))]; await writeJsonAtomic(permissionsPath(), { permissions: next }); return next.filter((p) => p.userId === userId) }) },
  async userInstanceIds(userId: string) { return (await this.listPermissions()).filter((p) => p.userId === userId).map((p) => p.instanceId) },
  async hasInstanceAccess(user: LocalUser, instanceId: string) { return user.role === 'admin' || (await this.userInstanceIds(user.id)).includes(instanceId) },
}
