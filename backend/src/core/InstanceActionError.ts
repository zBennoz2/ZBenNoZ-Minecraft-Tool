export class InstanceActionError extends Error {
  status: number
  body: any

  constructor(status: number, body: any) {
    super(typeof body === 'string' ? body : body?.error || '')
    this.status = status
    this.body = body
  }
}
