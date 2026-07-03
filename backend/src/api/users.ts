import { Router } from 'express'
import { localUsersService, type UserRole } from '../services/localUsers.service'
import { requireAdmin, requireAuth } from './authz'
const router = Router()
const isRole = (v: unknown): v is UserRole => v === 'admin' || v === 'instance_admin'
router.use(requireAuth, requireAdmin)
router.get('/', async (_req, res) => res.json(await localUsersService.listUsers()))
router.post('/', async (req, res) => { try { const { username, password, role } = req.body ?? {}; if (typeof username !== 'string' || typeof password !== 'string' || !isRole(role)) return res.status(400).json({ error: 'INVALID_USER_INPUT' }); res.status(201).json(await localUsersService.createUser({ username, password, role })) } catch (e: any) { res.status(e?.message === 'USER_EXISTS' ? 409 : 400).json({ error: e?.message ?? 'CREATE_USER_FAILED' }) } })
router.patch('/:id', async (req, res) => { const { username, password, role, disabled } = req.body ?? {}; if (role !== undefined && !isRole(role)) return res.status(400).json({ error: 'INVALID_ROLE' }); const user = await localUsersService.updateUser(req.params.id, { username, password, role, disabled }); return user ? res.json(user) : res.status(404).json({ error: 'USER_NOT_FOUND' }) })
router.delete('/:id', async (req, res) => (await localUsersService.deleteUser(req.params.id)) ? res.status(204).send() : res.status(404).json({ error: 'USER_NOT_FOUND' }))
router.get('/permissions/overview', async (_req, res) => res.json(await localUsersService.listPermissions()))
router.get('/:id/permissions', async (req, res) => res.json((await localUsersService.listPermissions()).filter((p) => p.userId === req.params.id)))
router.put('/:id/permissions', async (req, res) => { const instanceIds = Array.isArray(req.body?.instanceIds) ? req.body.instanceIds.filter((id: unknown) => typeof id === 'string') : []; res.json(await localUsersService.setPermissions(req.params.id, instanceIds)) })
export default router
