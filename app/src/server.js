const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { pool } = require('./db');
const { migrate } = require('./migrate');
const auth = require('./auth');
const { router: api } = require('./api');

const app = express();
app.set('trust proxy', 1); // atrás do ALB: req.secure / req.ip corretos
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Health check do ALB (não depende do banco, para não derrubar a task por oscilação)
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/health/db', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'db_error' });
  }
});

app.use('/api/auth', auth.router);
app.use('/api', auth.requireAuth, api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erro interno' : err.message });
});

const PORT = parseInt(process.env.PORT || '3000', 10);

async function start() {
  // tenta conectar ao banco algumas vezes (RDS/compose podem demorar a subir)
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (err) {
      if (i >= 15) throw err;
      console.log(`[start] aguardando banco (${i}/15): ${err.message}`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  await migrate();
  await auth.ensureAdmin();
  const server = app.listen(PORT, () => console.log(`[start] ouvindo na porta ${PORT}`));

  const shutdown = () => {
    console.log('[stop] encerrando...');
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('[start] falha ao iniciar', err);
  process.exit(1);
});
