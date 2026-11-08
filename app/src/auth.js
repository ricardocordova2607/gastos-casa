const crypto = require('crypto');
const express = require('express');
const { pool } = require('./db');

const SESSION_DAYS = 30;
const COOKIE = 'sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Proteção simples contra força bruta (por IP, em memória)
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, first: now };
  if (now - entry.first > 15 * 60 * 1000) {
    entry.count = 0;
    entry.first = now;
  }
  entry.count += 1;
  attempts.set(ip, entry);
  return entry.count > 10;
}

async function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > now()`,
      [token]
    );
    if (!rows.length) return res.status(401).json({ error: 'Sessão expirada' });
    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    if (tooManyAttempts(req.ip)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    }
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }
    attempts.delete(req.ip);
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
      [token, user.id, String(SESSION_DAYS)]
    );
    await pool.query('DELETE FROM sessions WHERE expires_at < now()');
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: SESSION_DAYS * 24 * 3600 * 1000,
    });
    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies[COOKIE];
    if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    res.clearCookie(COOKIE);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => res.json(req.user));

// Cria o primeiro usuário a partir das variáveis de ambiente, se o banco estiver vazio
async function ensureAdmin() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    console.warn('[auth] Nenhum usuário cadastrado. Defina ADMIN_EMAIL e ADMIN_PASSWORD.');
    return;
  }
  await pool.query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)', [
    process.env.ADMIN_NAME || 'Administrador',
    email,
    hashPassword(password),
  ]);
  console.log(`[auth] usuário inicial criado: ${email}`);
}

module.exports = { router, requireAuth, ensureAdmin, hashPassword, verifyPassword };
