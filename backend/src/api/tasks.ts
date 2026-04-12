import { Request, Response, Router } from 'express';
import { InstanceManager } from '../core/InstanceManager';
import { ScheduledTask, TaskAction, TaskEventType, TaskSchedule, TaskTrigger } from '../core/types';
import { computeNextRun, taskScheduler } from '../services/taskScheduler.service';

const router = Router();
const instanceManager = new InstanceManager();

const parseSchedule = (input: any): TaskSchedule | null => {
  if (input && typeof input === 'object') {
    if (input.mode === 'interval') {
      const minutes = Number(input.intervalMinutes);
      if (!Number.isFinite(minutes) || minutes <= 0) return null;
      return { mode: 'interval', intervalMinutes: minutes };
    }
    if (input.mode === 'cron' && typeof input.expression === 'string' && input.expression.trim()) {
      return { mode: 'cron', expression: input.expression.trim() };
    }
  }
  return null;
};

const parseEventType = (value: any): TaskEventType | null => {
  const allowed: TaskEventType[] = [
    'PlayerJoin',
    'PlayerLeave',
    'LastPlayerLeft',
    'FirstPlayerJoined',
    'ServerEmpty',
    'ServerStarted',
    'ServerStopped',
  ];
  if (typeof value !== 'string') return null;
  return allowed.includes(value as TaskEventType) ? (value as TaskEventType) : null;
};

const parseTrigger = (input: any): TaskTrigger | null => {
  if (!input || typeof input !== 'object') {
    const schedule = parseSchedule(input);
    return schedule ? { type: 'schedule', schedule } : null;
  }

  if (input.type === 'schedule') {
    const schedule = parseSchedule(input.schedule);
    return schedule ? { type: 'schedule', schedule } : null;
  }

  if (input.type === 'event') {
    const event = parseEventType(input.event);
    if (!event) return null;
    const delaySeconds = input.delaySeconds === undefined ? 0 : Number(input.delaySeconds);
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0) return null;
    const requireOnlinePlayers = input.requireOnlinePlayers;
    if (
      requireOnlinePlayers !== undefined &&
      !['any', 'non_empty', 'empty'].includes(requireOnlinePlayers)
    ) {
      return null;
    }

    return {
      type: 'event',
      event,
      delaySeconds: Math.floor(delaySeconds),
      requireOnlinePlayers: requireOnlinePlayers ?? 'any',
    };
  }

  return null;
};

const parseAction = (input: any): TaskAction | null => {
  const lifecycleAllowed = ['backup', 'restart', 'stop', 'start', 'sleep'];

  if (!input || typeof input !== 'object') {
    return null;
  }

  if (input.type === 'lifecycle' && lifecycleAllowed.includes(input.operation)) {
    return { type: 'lifecycle', operation: input.operation };
  }

  if (input.type === 'command') {
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    if (!command) return null;
    return { type: 'command', command };
  }

  if (input.type === 'message') {
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    if (!message) return null;
    const format = ['plain', 'legacy', 'json'].includes(input.format) ? input.format : 'plain';
    return { type: 'message', message, format };
  }

  if (input.type === 'message_then_command') {
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    const delaySeconds = Number(input.delaySeconds);
    if (!message || !command || !Number.isFinite(delaySeconds) || delaySeconds < 0) return null;
    const format = ['plain', 'legacy', 'json'].includes(input.format) ? input.format : 'plain';
    return {
      type: 'message_then_command',
      message,
      command,
      delaySeconds: Math.floor(delaySeconds),
      format,
    };
  }

  return null;
};

router.get('/instances/:id/tasks', async (req: Request, res: Response) => {
  const { id } = req.params;
  const instance = await instanceManager.getInstance(id);
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  try {
    const tasks = await taskScheduler.getTasksForInstance(id);
    return res.json({ id, tasks });
  } catch (error) {
    console.error(`Failed to list tasks for ${id}`, error);
    return res.status(500).json({ error: 'Failed to list tasks' });
  }
});

router.post('/instances/:id/tasks', async (req: Request, res: Response) => {
  const { id } = req.params;
  const instance = await instanceManager.getInstance(id);
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' });
  }

  const trigger = parseTrigger(req.body?.trigger ?? req.body?.schedule);
  const action = parseAction(req.body?.action);
  const enabled = req.body?.enabled !== false;

  if (!trigger || !action) {
    return res.status(400).json({ error: 'Invalid trigger or action' });
  }

  try {
    const task = await taskScheduler.createTask(id, {
      instanceId: id,
      enabled,
      trigger,
      action,
    });

    return res.status(201).json({ task });
  } catch (error) {
    console.error(`Failed to create task for ${id}`, error);
    return res.status(500).json({ error: 'Failed to create task' });
  }
});

router.put('/tasks/:taskId', async (req: Request, res: Response) => {
  const { taskId } = req.params;
  const partial: Partial<ScheduledTask> = {};

  if (req.body?.enabled !== undefined) {
    partial.enabled = Boolean(req.body.enabled);
  }

  if (req.body?.trigger !== undefined || req.body?.schedule !== undefined) {
    const trigger = parseTrigger(req.body?.trigger ?? req.body?.schedule);
    if (!trigger) return res.status(400).json({ error: 'Invalid trigger' });
    partial.trigger = trigger;
    partial.nextRunAt = trigger.type === 'schedule' ? computeNextRun(trigger.schedule) : null;
  }

  if (req.body?.action !== undefined) {
    const action = parseAction(req.body.action);
    if (!action) return res.status(400).json({ error: 'Invalid action' });
    partial.action = action;
  }

  try {
    const updated = await taskScheduler.updateTask(taskId, partial);
    if (!updated) {
      return res.status(404).json({ error: 'Task not found' });
    }
    return res.json({ task: updated });
  } catch (error) {
    console.error(`Failed to update task ${taskId}`, error);
    return res.status(500).json({ error: 'Failed to update task' });
  }
});

router.delete('/tasks/:taskId', async (req: Request, res: Response) => {
  const { taskId } = req.params;
  try {
    const deleted = await taskScheduler.deleteTask(taskId);
    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' });
    }
    return res.status(204).end();
  } catch (error) {
    console.error(`Failed to delete task ${taskId}`, error);
    return res.status(500).json({ error: 'Failed to delete task' });
  }
});

export default router;
