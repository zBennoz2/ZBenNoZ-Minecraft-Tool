export class PlayerActionError extends Error {
  status: number
  body: any

  constructor(status: number, body: any) {
    super(body?.error || 'Player action error')
    this.status = status
    this.body = body
  }
}
