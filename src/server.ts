import Fastify from 'fastify';
import cors from '@fastify/cors';
import healthRoutes from './routes/health';
import sessionRoutes from './routes/sessions.routes';

const server = Fastify({ logger: true });

// CORS liberado em desenvolvimento
// Em produção (NODE_ENV=production) isso fica desligado por completo.
const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
  server.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'PUT'] });
}

server.register(healthRoutes);
server.register(sessionRoutes);

const start = async () => {
  try {
    await server.listen({ port: 3000, host: '127.0.0.1' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
