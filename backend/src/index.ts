import express from 'express';
import cors from 'cors';
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
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3001;

const resolveUiDistPath = () => {
  const envPath = process.env.UI_DIST_PATH;
  if (envPath) {
    return path.resolve(envPath);
  }

  const defaultPath = path.resolve(process.cwd(), 'frontend', 'dist');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  const legacyPath = path.resolve(process.cwd(), 'backend', 'frontend', 'dist');
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  return defaultPath;
};

const STATIC_DIR = resolveUiDistPath();
const SPA_ENTRYPOINT = path.join(STATIC_DIR, 'index.html');
const ASSETS_DIR = path.join(STATIC_DIR, 'assets');

const envAllowedOrigins = [process.env.FRONTEND_ORIGIN, process.env.ALLOWED_ORIGINS]
  .filter(Boolean)
  .join(',')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Credentialed CORS must only reflect origins explicitly configured by the operator.
const allowedOrigins = Array.from(new Set(envAllowedOrigins));

const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const allowedHeaders = ['Content-Type', 'Authorization', 'X-Api-Key'];

type CorsCallback = (
  err: Error | null,
  options?: {
    origin?: boolean;
    methods?: string[];
    allowedHeaders?: string[];
    credentials?: boolean;
  },
) => void;

const backendVersion = pkg.version || '0.0.0';

const corsOptionsDelegate = (req: express.Request, callback: CorsCallback) => {
  const origin = req.header('Origin') || undefined;

  if (!origin) {
    return callback(null, {
      origin: true,
      methods: allowedMethods,
      allowedHeaders,
      credentials: true,
    });
  }

  const isWhitelisted = allowedOrigins.includes(origin);

  if (isWhitelisted) {
    return callback(null, {
      origin: true,
      methods: allowedMethods,
      allowedHeaders,
      credentials: true,
    });
  }

  return callback(new Error('Not allowed by CORS'));
};

app.use(express.json());

const uiDistExists = fs.existsSync(STATIC_DIR);
const uiIndexExists = fs.existsSync(SPA_ENTRYPOINT);
const uiAssetsExists = fs.existsSync(ASSETS_DIR);

console.log(`[UI] Serving from: ${STATIC_DIR}`);
console.log(`[UI] index.html present: ${uiIndexExists}`);
console.log(`[UI] assets directory present: ${uiAssetsExists}`);

app.get('/health', (_req, res) => {
  res.json({ ok: true, version: backendVersion });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Minecraft Panel Backend Phase 4A' });
});

if (uiDistExists) {
  app.use('/assets', express.static(ASSETS_DIR));
  app.use(express.static(STATIC_DIR));
  console.log('[Security] Public routes: /health, /api/health, /assets/* and other static files.');
} else {
  console.warn(`Static UI path not found: ${STATIC_DIR}`);
}

const apiRouter = express.Router();

apiRouter.options('*', cors(corsOptionsDelegate));
apiRouter.use(cors(corsOptionsDelegate));

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
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }

    if (req.path.includes('.')) {
      return next();
    }

    if (!fs.existsSync(SPA_ENTRYPOINT)) {
      return res.status(404).send('UI entrypoint not found');
    }

    return res.sendFile(SPA_ENTRYPOINT);
  });
}

app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err?.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

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
