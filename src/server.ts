import Fastify from 'fastify';
import cors from '@fastify/cors';
import healthRoutes from './routes/health';
import sessionRoutes from './routes/sessions.routes';
import configRoutes from './routes/config.routes';
import { closeOpenCodeServer } from './runtimes/opencode/opencode.runtime';

const server = Fastify({ logger: true });

// CORS liberado em desenvolvimento
// Em produção (NODE_ENV=production) isso fica desligado por completo.
const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
  server.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'PUT'] });
}

server.register(healthRoutes);
server.register(sessionRoutes);
server.register(configRoutes);

const start = async () => {
  try {
    await server.listen({ port: 3000, host: '127.0.0.1' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();

// Sem isso, o processo `opencode serve` que OpenCodeRuntime sobe (ver getDefaultServer) fica
// órfão a cada restart do Adapter em desenvolvimento
async function shutdown() {
  server.log.info('Shutting down: closing OpenCode server, if any...');

  try {
    await closeOpenCodeServer();
  } catch (err) {
    server.log.error(err, 'shutdown: failed to close OpenCode server');
  }

  server.log.info('OpenCode server closed, closing Fastify...');
  await server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
