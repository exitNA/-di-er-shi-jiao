import { createServer } from 'http';
import next from 'next';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
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

    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
    const databaseSummary = database.configured
      ? database.valid
        ? `${database.protocol}//${database.username}:${database.password}@${database.host}${database.port ? `:${database.port}` : ''}/${database.name}${database.sslMode ? ` (sslmode=${database.sslMode})` : ''}`
        : 'invalid'
      : 'not configured';
    console.info('Startup config:');
    console.info(`  env=${process.env.NODE_ENV ?? 'development'}`);
    console.info(`  coze=${process.env.COZE_PROJECT_ENV ?? 'development'}`);
    console.info(`  agent=${process.env.AGENT_ADAPTER ?? 'fake'}`);
    console.info(`  runtime=${process.env.ANALYSIS_RUNTIME ?? 'in-process'}`);
    console.info(`  database=${databaseSummary}`);
    console.info(`  auth=${Boolean(process.env.AUTH_SECRET)}`);
    console.info(`  llm=${Boolean(process.env.LLM_API_KEY)}`);
    console.info(`  tavily=${Boolean(process.env.TAVILY_API_KEY)}`);
    console.info(`  trigger=${Boolean(process.env.TRIGGER_SECRET_KEY)}`);
    console.info(`  telemetry=${Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)}`);
  });
});
