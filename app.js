import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders, limiters } from './middleware/security.js';
import { authOpcional } from './middleware/auth.js';
import { HttpError } from './util.js';
import authRoutes from './routes/auth.js';
import publico from './routes/publico.js';
import staff from './routes/staff.js';
import carga from './routes/carga.js';
import admin from './routes/admin.js';
import reportes from './routes/reportes.js';
import { q } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(opts = {}) {
  const app = express();
  const lim = limiters(opts.limits);
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render esta detras de un proxy: limite de tasa por IP real
  app.use(securityHeaders);
  app.use('/api', lim.api, authOpcional);
  app.use('/api', carga()); // tiene su propio parser JSON (archivos hasta 6 MB)
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', async (_req, res) => {
    try { await q('SELECT 1'); res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() }); }
    catch { res.status(503).json({ status: 'error', db: 'down' }); }
  });
  app.use('/api/auth', authRoutes({ loginLimiter: lim.login }));
  app.use('/api', publico());
  app.use('/api', staff());
  app.use('/api', admin());
  app.use('/api', reportes());
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint no encontrado.' }));

  const publicDir = path.resolve(__dirname, '../public');
  app.use(express.static(publicDir));
  app.use((_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  // Manejo central de errores: no se filtran detalles internos al cliente
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El contenido es demasiado grande.' });
    if (err.code === '23505') return res.status(409).json({ error: 'El registro ya existe (duplicado).' });
    if (err.code === '23514' || err.code === '23503' || err.code === '22P02') return res.status(400).json({ error: 'Datos inválidos.' });
    console.error('Error interno:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  });
  return app;
}
