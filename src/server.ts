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
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
    console.info(
      JSON.stringify({
        event: 'server_started',
        hostname,
        port,
        nodeEnv: process.env.NODE_ENV ?? 'development',
        cozeProjectEnv: process.env.COZE_PROJECT_ENV ?? 'development',
        agentAdapter: process.env.AGENT_ADAPTER ?? 'fake',
        analysisRuntime: process.env.ANALYSIS_RUNTIME ?? 'in-process',
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        authConfigured: Boolean(process.env.AUTH_SECRET),
        llmConfigured: Boolean(process.env.LLM_API_KEY),
        tavilyConfigured: Boolean(process.env.TAVILY_API_KEY),
        triggerConfigured: Boolean(process.env.TRIGGER_SECRET_KEY),
        telemetryConfigured: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
      }),
    );
  });
});
