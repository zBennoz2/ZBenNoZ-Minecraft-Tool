import { EventEmitter } from 'events'

export type InstanceEventName =
  | 'starting'
  | 'started'
  | 'stopping'
  | 'stopped'
  | 'start_failed'
  | 'stop_failed'

export const instanceEvents = new EventEmitter()

export const emitInstanceEvent = (event: InstanceEventName, instanceId: string) => {
  instanceEvents.emit(event, instanceId)
}
