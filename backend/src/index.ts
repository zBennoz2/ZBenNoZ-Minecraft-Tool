import express from 'express';
import fs from 'fs';
import path from 'path';
import catalogRouter from './api/catalog';
import instanceControlRouter from './api/instanceControl';
import instancePrepareRouter from './api/instancePrepare';
import instancesRouter from './api/instances';
import propertiesRouter from './api/properties';
import filesRouter from './api/files';
import metricsRouter from './api/metrics';
import tasksRouter from './api/tasks';
import javaRouter from './api/java';
import rconSettingsRouter from './api/rconSettings';
import { taskScheduler } from './services/taskScheduler.service';
import sleepRouter from './api/sleep';
import { sleepService } from './services/sleep.service';
import backupsRouter from './api/backups';
import { pingWakeService } from './services/pingWake.service';
import playersRouter from './api/players';
import authRouter from './api/auth';
import licenseRouter, { licenseGuardMiddleware } from './api/license';
import systemRouter from './api/system';
import hytaleRouter from './api/hytale';
import jobsRouter from './api/jobs';
import usersRouter from './api/users';
import { requireAdmin, requireAuth, requireInstanceAccess } from './api/authz';
import { localUsersService } from './services/localUsers.service';
import pkg from '../package.json';

const app = express();
// Cloudflare sends X-Forwarded-Proto; trust its first proxy hop so req.secure works.
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3001;

const resolveUiDistPath = () => {
  if (process.env.UI_DIST_PATH) return path.resolve(process.env.UI_DIST_PATH);

  // The compiled server is backend/dist, making this independent of cwd.
  const projectFrontendDist = path.resolve(__dirname, '../../frontend/dist');
  const packagedFrontendDist = path.resolve(__dirname, '../frontend/dist');
  const candidates = [projectFrontendDist, packagedFrontendDist, path.resolve(process.cwd(), 'frontend/dist')];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? projectFrontendDist;
};

const STATIC_DIR = resolveUiDistPath();
const SPA_ENTRYPOINT = path.join(STATIC_DIR, 'index.html');
const backendVersion = pkg.version || '0.0.0';

app.use(express.json());

const uiDistExists = fs.existsSync(STATIC_DIR);
const uiIndexExists = fs.existsSync(SPA_ENTRYPOINT);

console.log(`[UI] Serving from: ${STATIC_DIR}`);
console.log(`[UI] index.html present: ${uiIndexExists}`);

app.get('/health', (_req, res) => {
  res.json({ ok: true, version: backendVersion });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Minecraft Panel Backend Phase 4A' });
});

const apiRouter = express.Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/license', licenseRouter);

apiRouter.use((req, res, next) => {
  const configuredApiKey = process.env.API_KEY;
  if (!configuredApiKey) {
    return next();
  }

  if (req.path.startsWith('/license')) {
    return next();
  }
  if (req.path.startsWith('/auth')) {
    return next();
  }

  const requestApiKey = req.header('X-Api-Key');
  if (requestApiKey === configuredApiKey) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
});

apiRouter.use(licenseGuardMiddleware);

apiRouter.use(requireAuth);
apiRouter.use('/users', usersRouter);
apiRouter.use('/instances/:id', requireInstanceAccess);

apiRouter.use('/catalog', requireAdmin, catalogRouter);
apiRouter.use('/instances', instancesRouter);
apiRouter.use('/instances', instancePrepareRouter);
apiRouter.use('/instances', instanceControlRouter);
apiRouter.use('/instances', propertiesRouter);
apiRouter.use('/instances', filesRouter);
apiRouter.use('/instances', metricsRouter);
apiRouter.use('/instances', playersRouter);
apiRouter.use('/instances', rconSettingsRouter);
apiRouter.use('/', tasksRouter);
apiRouter.use('/', requireAdmin, javaRouter);
apiRouter.use('/', jobsRouter);
apiRouter.use('/instances', sleepRouter);
apiRouter.use('/instances', backupsRouter);
apiRouter.use('/system', requireAdmin, systemRouter);
apiRouter.use('/instances', hytaleRouter);

app.use('/api', apiRouter);

if (uiDistExists) {
  app.use(express.static(STATIC_DIR));
  console.log('[UI] Frontend and API are served from the same origin.');
} else {
  console.warn(`[UI] Frontend build not found at ${STATIC_DIR}. Run npm run build before npm start.`);
}

// An unknown API path is always JSON, never the SPA entrypoint.
app.use('/api', (_req, res) => res.status(404).json({ error: 'API_NOT_FOUND', message: 'API route not found.' }));

// Support client-side routes after a browser refresh and make a missing build actionable.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (!uiIndexExists) {
    return res.status(503).type('text/plain').send(`Frontend build not found at ${STATIC_DIR}. Run npm run build before starting the server.`);
  }
  if (req.path.includes('.')) {
    return res.status(404).type('text/plain').send('Frontend asset not found. Run npm run build to regenerate the frontend.');
  }
  return res.sendFile(SPA_ENTRYPOINT);
});

app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  return next(err);
});

void (async () => {
  if (!(await localUsersService.hasUsers()) && process.env.INITIAL_ADMIN_USERNAME && process.env.INITIAL_ADMIN_PASSWORD) {
    await localUsersService.createUser({ username: process.env.INITIAL_ADMIN_USERNAME, password: process.env.INITIAL_ADMIN_PASSWORD, role: 'admin' });
    console.log('[auth] Initial local admin created from environment.');
  }
})();

console.log('[Security] Protected routes: /api/* (except /api/health, /api/auth). Local login required; API key additionally required when configured.');

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Minecraft Panel Backend listening on port ${PORT}`);
  taskScheduler.start();
  sleepService.start();
  pingWakeService.start();
});

server.setTimeout(0);
