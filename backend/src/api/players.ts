import { Request, Response, Router } from 'express'
import { PlayerActionError } from '../core/PlayerActionError'
import { playerService } from '../services/player.service'

const router = Router()

const handlePlayerError = (res: Response, error: unknown, context: string) => {
  if (error instanceof PlayerActionError) {
    return res.status(error.status).json(error.body)
  }
  console.error(context, error)
  return res.status(500).json({ error: 'Unexpected error' })
}

router.get('/:id/players/online', async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const payload = await playerService.getOnlinePlayers(id)
    res.json(payload)
  } catch (error) {
    handlePlayerError(res, error, `Error fetching online players for ${id}`)
  }
})

router.post('/:id/players/kick', async (req: Request, res: Response) => {
  const { id } = req.params
  const name = typeof req.body?.name === 'string' ? req.body.name : ''
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined
  try {
    const payload = await playerService.kick(id, name, reason)
    res.json(payload)
  } catch (error) {
    handlePlayerError(res, error, `Error kicking player on ${id}`)
  }
})

router.post('/:id/players/ban', async (req: Request, res: Response) => {
  const { id } = req.params
  const name = typeof req.body?.name === 'string' ? req.body.name : ''
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined
  try {
    const payload = await playerService.ban(id, name, reason)
    res.json(payload)
  } catch (error) {
    handlePlayerError(res, error, `Error banning player on ${id}`)
  }
})

router.post('/:id/players/unban', async (req: Request, res: Response) => {
  const { id } = req.params
  const name = typeof req.body?.name === 'string' ? req.body.name : ''
  try {
    const payload = await playerService.unban(id, name)
    res.json(payload)
  } catch (error) {
    handlePlayerError(res, error, `Error unbanning player on ${id}`)
  }
})

router.get('/:id/players/bans', async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const payload = await playerService.listBans(id)
    res.json(payload)
  } catch (error) {
    handlePlayerError(res, error, `Error listing bans for ${id}`)
  }
})

router.get('/:id/whitelist', async (req: Request, res: Response) => {
  const { id } = req.params
  try {
    const payload = await playerService.listWhitelist(id)
    res.json(payload)
  } catch (error) {
    handlePlayerError(res, error, `Error reading whitelist for ${id}`)
  }
})

router.post('/:id/whitelist/add', async (req: Request, res: Response) => {
  const { id } = req.params
  const name = typeof req.body?.name === 'string' ? req.body.name : ''
  try {
    const payload = await playerService.addToWhitelist(id, name)
    res.status(201).json(payload)
  } catch (error) {
    handlePlayerError(res, error, `Error adding whitelist entry for ${id}`)
  }
})

router.post('/:id/whitelist/remove', async (req: Request, res: Response) => {
  const { id } = req.params
  const name = typeof req.body?.name === 'string' ? req.body.name : ''
  try {
    const payload = await playerService.removeFromWhitelist(id, name)
    res.json(payload)
  } catch (error) {
    handlePlayerError(res, error, `Error removing whitelist entry for ${id}`)
  }
})

router.post('/:id/op', async (req: Request, res: Response) => {
  const { id } = req.params
  const name = typeof req.body?.name === 'string' ? req.body.name : ''
  try {
    const payload = await playerService.op(id, name)
    res.json(payload)
  } catch (error) {
    handlePlayerError(res, error, `Error granting op for ${id}`)
  }
})

router.post('/:id/deop', async (req: Request, res: Response) => {
  const { id } = req.params
  const name = typeof req.body?.name === 'string' ? req.body.name : ''
  try {
    const payload = await playerService.deop(id, name)
    res.json(payload)
  } catch (error) {
    handlePlayerError(res, error, `Error removing op for ${id}`)
  }
})

export default router
