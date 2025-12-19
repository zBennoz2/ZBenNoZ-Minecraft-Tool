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
import licenseRouter, { licenseGuardMiddleware } from './api/license';
import systemRouter from './api/system';
import pkg from '../package.json';

const app = express();
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

const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];

const envAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envAllowedOrigins]));

const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const allowedHeaders = ['Content-Type', 'Authorization', 'X-Api-Key'];

type CorsCallback = (
  err: Error | null,
  options?: {
    origin?: boolean;
    methods?: string[];
    allowedHeaders?: string[];
  },
) => void;

const backendVersion = pkg.version || '0.0.0';

const corsOptionsDelegate = (req: express.Request, callback: CorsCallback) => {
  const origin = req.header('Origin') || undefined;
  const host = req.headers.host;

  if (!origin) {
    return callback(null, {
      origin: true,
      methods: allowedMethods,
      allowedHeaders,
    });
  }

  const isWhitelisted = allowedOrigins.includes(origin);

  let isSameHost = false;
  try {
    const parsedOrigin = new URL(origin);
    isSameHost = !!host && parsedOrigin.host === host;
  } catch (error) {
    // Ignore invalid origins and fall through to disallow unless explicitly whitelisted or file protocol
  }

  const isElectron = origin.startsWith('file://');

  if (isWhitelisted || isSameHost || isElectron) {
    return callback(null, {
      origin: true,
      methods: allowedMethods,
      allowedHeaders,
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

apiRouter.use('/license', licenseRouter);

apiRouter.use((req, res, next) => {
  const configuredApiKey = process.env.API_KEY;
  if (!configuredApiKey) {
    return next();
  }

  if (req.path.startsWith('/license')) {
    return next();
  }

  const requestApiKey = req.header('X-Api-Key');
  if (requestApiKey === configuredApiKey) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
});

apiRouter.use(licenseGuardMiddleware);

apiRouter.use('/catalog', catalogRouter);
apiRouter.use('/instances', instancesRouter);
apiRouter.use('/instances', instancePrepareRouter);
apiRouter.use('/instances', instanceControlRouter);
apiRouter.use('/instances', propertiesRouter);
apiRouter.use('/instances', filesRouter);
apiRouter.use('/instances', metricsRouter);
apiRouter.use('/instances', playersRouter);
apiRouter.use('/instances', rconSettingsRouter);
apiRouter.use('/', tasksRouter);
apiRouter.use('/', javaRouter);
apiRouter.use('/instances', sleepRouter);
apiRouter.use('/instances', backupsRouter);
apiRouter.use('/system', systemRouter);

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

console.log('[Security] Protected routes: /api/* (except /api/health). API key required when configured.');

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Minecraft Panel Backend listening on port ${PORT}`);
  taskScheduler.start();
  sleepService.start();
  pingWakeService.start();
});
