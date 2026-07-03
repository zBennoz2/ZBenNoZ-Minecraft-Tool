import { fetchApi } from '../api'
export type UserRole = 'admin' | 'instance_admin'
export type LocalUser = { id: string; username: string; role: UserRole; disabled?: boolean; createdAt: string; updatedAt: string }
export type InstancePermission = { userId: string; instanceId: string; permissions: string[] }
export const listUsers = () => fetchApi<LocalUser[]>('/api/users')
export const createUser = (payload: { username: string; password: string; role: UserRole }) => fetchApi<LocalUser>('/api/users', { method: 'POST', body: JSON.stringify(payload) })
export const updateUser = (id: string, payload: Partial<{ username: string; password: string; role: UserRole; disabled: boolean }>) => fetchApi<LocalUser>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const deleteUser = (id: string) => fetchApi<void>(`/api/users/${id}`, { method: 'DELETE' })
export const getUserPermissions = (id: string) => fetchApi<InstancePermission[]>(`/api/users/${id}/permissions`)
export const setUserPermissions = (id: string, instanceIds: string[]) => fetchApi<InstancePermission[]>(`/api/users/${id}/permissions`, { method: 'PUT', body: JSON.stringify({ instanceIds }) })
