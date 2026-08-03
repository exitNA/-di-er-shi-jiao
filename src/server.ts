import { createServer } from 'http';
import { getLogger } from '@logtape/logtape';
import next from 'next';
import { loadServerEnv } from './server/config/env';
import { isDevelopmentRuntime, requestPath, shouldLogAccess } from './server/runtime';

loadServerEnv();
const dev = isDevelopmentRuntime(process.env);
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);
const logger = getLogger(['second-perspective', 'server']);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    const startedAt = performance.now();
    const path = requestPath(req.url);
    res.once('finish', () => {
      if (!shouldLogAccess(path)) return;
      logger.info('HTTP {method} {path} {statusCode} in {durationMs}ms', {
        method: req.method ?? 'GET',
        path,
        statusCode: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    try {
      await handle(req, res);
    } catch {
      logger.error('Request handling failed: {method} {path}', {
        method: req.method ?? 'GET',
        path,
      });
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    logger.error('HTTP server failed to start', { error: String(err) });
    process.exit(1);
  });
  server.listen(port, () => {
    const databaseUrl = process.env.DATABASE_URL;
    let database: Record<string, boolean | string | null> = { configured: false };

    if (databaseUrl) {
      try {
        const url = new URL(databaseUrl);
        database = {
          configured: true,
          valid: true,
          protocol: url.protocol,
          host: url.hostname,
          port: url.port || null,
          name: url.pathname.slice(1) || null,
          username: url.username ? '***' : null,
          password: url.password ? '***' : null,
          sslMode: url.searchParams.get('sslmode'),
        };
      } catch {
        database = { configured: true, valid: false };
      }
    }

    logger.info('Server listening', { hostname, port, environment: process.env.NODE_ENV ?? 'development' });
    const databaseSummary = database.configured
      ? database.valid
        ? `${database.protocol}//${database.username}:${database.password}@${database.host}${database.port ? `:${database.port}` : ''}/${database.name}${database.sslMode ? ` (sslmode=${database.sslMode})` : ''}`
        : 'invalid'
      : 'not configured';
    logger.info('Startup config:');
    logger.info('  env={value}', { value: process.env.NODE_ENV ?? 'development' });
    logger.info('  runtime={value}', { value: process.env.ANALYSIS_RUNTIME ?? 'in-process' });
    logger.info('  database={value}', { value: databaseSummary });
    logger.info('  auth={value}', { value: Boolean(process.env.AUTH_SECRET) });
    logger.info('  llm={value}', { value: Boolean(process.env.LLM_API_KEY) });
    logger.info('  tavily={value}', { value: Boolean(process.env.TAVILY_API_KEY) });
    logger.info('  trigger={value}', { value: Boolean(process.env.TRIGGER_SECRET_KEY) });
    logger.info('  langfuse=enabled');
  });
});
