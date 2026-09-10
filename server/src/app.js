import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { authenticate, refreshSession, requirePasswordSettled } from './middleware/authenticate.js';
import { errorHandler, notFoundHandler, forbidden } from './middleware/errors.js';
import { authRouter } from './routes/auth.routes.js';
import { meRouter } from './routes/me.routes.js';
import { institutesRouter } from './routes/institutes.routes.js';
import { departmentsRouter } from './routes/departments.routes.js';
import { projectsRouter } from './routes/projects.routes.js';
import { reportsRouter } from './routes/reports.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { rubricsRouter } from './routes/rubrics.routes.js';
import { themesRouter } from './routes/themes.routes.js';
import { gatesRouter } from './routes/gates.routes.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence. The session cookie is SameSite=Lax, which already blocks
 * cross-site form posts; this adds an explicit origin check so any state-changing
 * request must come from the configured web origin.
 */
function checkOrigin(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // same-origin fetch, or a non-browser client with a token
  const allowed = [config.webOrigin, `http://localhost:${config.port}`];
  if (allowed.includes(origin)) return next();
  next(forbidden('Request origin is not allowed.'));
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", config.webOrigin],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: config.webOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(checkOrigin);

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: config.isTest ? 100_000 : 600,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mini-project-portfolio-portal', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);

  // Everything below requires an authenticated session with an evaluated scope.
  const protectedRoutes = express.Router();
  protectedRoutes.use(authenticate, refreshSession);

  protectedRoutes.use('/me', meRouter);
  protectedRoutes.use('/institutes', requirePasswordSettled, institutesRouter);
  protectedRoutes.use('/departments', requirePasswordSettled, departmentsRouter);
  protectedRoutes.use('/projects', requirePasswordSettled, projectsRouter);
  protectedRoutes.use('/reports', requirePasswordSettled, reportsRouter);
  protectedRoutes.use('/admin', requirePasswordSettled, adminRouter);
  protectedRoutes.use('/rubrics', requirePasswordSettled, rubricsRouter);
  protectedRoutes.use('/themes', requirePasswordSettled, themesRouter);
  protectedRoutes.use('/gates', requirePasswordSettled, gatesRouter);

  app.use('/api', protectedRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
