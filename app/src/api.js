const express = require('express');
const { pool } = require('./db');
const { hashPassword, verifyPassword } = require('./auth');

const router = express.Router();

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const KINDS = ['despesa', 'receita'];
const ACCOUNT_TYPES = ['corrente', 'poupanca', 'carteira', 'cartao_credito', 'outro'];

function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new HttpError(400, 'Mês inválido (use AAAA-MM)');
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { start, next };
}
function reqText(v, field) {
  const s = String(v ?? '').trim();
  if (!s) throw new HttpError(400, `Campo obrigatório: ${field}`);
  return s.slice(0, 200);
}
function reqAmount(v, field = 'valor', allowZero = false) {
  const n = Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw new HttpError(400, `${field} inválido`);
  return Math.round(n * 100) / 100;
}
function reqDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '') || isNaN(Date.parse(v))) throw new HttpError(400, 'Data inválida');
  return v;
}
function optInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  if (!Number.isInteger(n)) throw new HttpError(400, 'Identificador inválido');
  return n;
}
function oneOf(v, list, field) {
  if (!list.includes(v)) throw new HttpError(400, `${field} inválido`);
  return v;
}
function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// ---------- resumo ----------
router.get('/summary', wrap(async (req, res) => {
  const { start, next } = monthRange(req.query.month);

  const totals = await pool.query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE kind = 'receita'), 0) AS income,
       COALESCE(SUM(amount) FILTER (WHERE kind = 'despesa'), 0) AS expense,
       COALESCE(SUM(amount) FILTER (WHERE kind = 'despesa' AND NOT paid), 0) AS pending_expense
     FROM transactions WHERE date >= $1 AND date < $2`,
    [start, next]
  );

  const byCategory = await pool.query(
    `SELECT c.id, c.name, c.color, COALESCE(t.spent, 0) AS spent, b.amount AS budget
     FROM categories c
     LEFT JOIN (SELECT category_id, SUM(amount) AS spent FROM transactions
                WHERE kind = 'despesa' AND date >= $1 AND date < $2 GROUP BY category_id) t
            ON t.category_id = c.id
     LEFT JOIN budgets b ON b.category_id = c.id AND b.month = $1
     WHERE c.kind = 'despesa' AND (COALESCE(t.spent, 0) > 0 OR b.amount IS NOT NULL)
     ORDER BY spent DESC, c.name`,
    [start, next]
  );

  const accounts = await pool.query(
    `SELECT a.id, a.name, a.type,
            a.initial_balance + COALESCE(SUM(CASE WHEN t.kind = 'receita' THEN t.amount ELSE -t.amount END)
              FILTER (WHERE t.paid AND t.date <= CURRENT_DATE), 0) AS balance
     FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
     WHERE a.active GROUP BY a.id ORDER BY a.name`
  );

  const trend = await pool.query(
    `SELECT to_char(m, 'YYYY-MM') AS month,
            COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'receita'), 0) AS income,
            COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'despesa'), 0) AS expense
     FROM generate_series($1::date - interval '5 months', $1::date, interval '1 month') AS m
     LEFT JOIN transactions t ON t.date >= m AND t.date < m + interval '1 month'
     GROUP BY m ORDER BY m`,
    [start]
  );

  const t = totals.rows[0];
  res.json({
    month: req.query.month,
    income: t.income,
    expense: t.expense,
    balance: Math.round((t.income - t.expense) * 100) / 100,
    pending_expense: t.pending_expense,
    by_category: byCategory.rows,
    accounts: accounts.rows,
    trend: trend.rows,
  });
}));

// ---------- lançamentos ----------
async function listTransactions(q) {
  const where = [];
  const params = [];
  if (q.month) {
    const { start, next } = monthRange(q.month);
    params.push(start, next);
    where.push(`t.date >= $${params.length - 1} AND t.date < $${params.length}`);
  }
  if (q.kind) {
    params.push(oneOf(q.kind, KINDS, 'tipo'));
    where.push(`t.kind = $${params.length}`);
  }
  if (q.category_id) {
    params.push(optInt(q.category_id));
    where.push(`t.category_id = $${params.length}`);
  }
  if (q.account_id) {
    params.push(optInt(q.account_id));
    where.push(`t.account_id = $${params.length}`);
  }
  if (q.q) {
    params.push(`%${String(q.q).trim()}%`);
    where.push(`(t.description ILIKE $${params.length} OR t.notes ILIKE $${params.length})`);
  }
  const { rows } = await pool.query(
    `SELECT t.*, c.name AS category_name, c.color AS category_color, a.name AS account_name, u.name AS created_by_name
     FROM transactions t
     JOIN categories c ON c.id = t.category_id
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN users u ON u.id = t.created_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.date DESC, t.id DESC
     LIMIT 2000`,
    params
  );
  return rows;
}

router.get('/transactions', wrap(async (req, res) => res.json(await listTransactions(req.query))));

router.get('/transactions.csv', wrap(async (req, res) => {
  const rows = await listTransactions(req.query);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['data', 'tipo', 'descricao', 'categoria', 'conta', 'valor', 'pago', 'observacoes'].join(';')];
  for (const r of rows) {
    lines.push([r.date, r.kind, esc(r.description), esc(r.category_name), esc(r.account_name),
      String(r.amount).replace('.', ','), r.paid ? 'sim' : 'nao', esc(r.notes)].join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="lancamentos-${req.query.month || 'todos'}.csv"`);
  res.send('﻿' + lines.join('\n'));
}));

async function validateTransaction(body) {
  const data = {
    kind: oneOf(body.kind, KINDS, 'tipo'),
    description: reqText(body.description, 'descrição'),
    amount: reqAmount(body.amount),
    date: reqDate(body.date),
    category_id: optInt(body.category_id),
    account_id: optInt(body.account_id),
    paid: body.paid === undefined ? true : Boolean(body.paid),
    notes: body.notes ? String(body.notes).slice(0, 1000) : null,
  };
  if (!data.category_id) throw new HttpError(400, 'Informe a categoria');
  const cat = await pool.query('SELECT kind FROM categories WHERE id = $1', [data.category_id]);
  if (!cat.rows.length) throw new HttpError(400, 'Categoria não encontrada');
  if (cat.rows[0].kind !== data.kind) throw new HttpError(400, 'Categoria não corresponde ao tipo do lançamento');
  if (data.account_id) {
    const acc = await pool.query('SELECT 1 FROM accounts WHERE id = $1', [data.account_id]);
    if (!acc.rows.length) throw new HttpError(400, 'Conta não encontrada');
  }
  return data;
}

// POST aceita "installments" (parcelas): gera N lançamentos mensais
router.post('/transactions', wrap(async (req, res) => {
  const d = await validateTransaction(req.body);
  const installments = Math.min(Math.max(parseInt(req.body.installments || '1', 10) || 1, 1), 60);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    // divide o valor total entre as parcelas; a diferença de centavos vai na primeira
    const base = Math.floor((d.amount / installments) * 100) / 100;
    const first = Math.round((d.amount - base * (installments - 1)) * 100) / 100;
    for (let i = 0; i < installments; i++) {
      const desc = installments > 1 ? `${d.description} (${i + 1}/${installments})` : d.description;
      const { rows } = await client.query(
        `INSERT INTO transactions (kind, description, amount, date, category_id, account_id, paid, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [d.kind, desc, i === 0 ? first : base, addMonths(d.date, i), d.category_id, d.account_id,
          i === 0 ? d.paid : false, d.notes, req.user.id]
      );
      created.push(rows[0]);
    }
    await client.query('COMMIT');
    res.status(201).json(created.length === 1 ? created[0] : created);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.put('/transactions/:id', wrap(async (req, res) => {
  const d = await validateTransaction(req.body);
  const { rows } = await pool.query(
    `UPDATE transactions SET kind=$1, description=$2, amount=$3, date=$4, category_id=$5, account_id=$6,
       paid=$7, notes=$8, updated_at=now() WHERE id=$9 RETURNING *`,
    [d.kind, d.description, d.amount, d.date, d.category_id, d.account_id, d.paid, d.notes, optInt(req.params.id)]
  );
  if (!rows.length) throw new HttpError(404, 'Lançamento não encontrado');
  res.json(rows[0]);
}));

router.patch('/transactions/:id/paid', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE transactions SET paid = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [Boolean(req.body.paid), optInt(req.params.id)]
  );
  if (!rows.length) throw new HttpError(404, 'Lançamento não encontrado');
  res.json(rows[0]);
}));

router.delete('/transactions/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM transactions WHERE id = $1', [optInt(req.params.id)]);
  res.status(204).end();
}));

// ---------- categorias ----------
router.get('/categories', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS usage
     FROM categories c ORDER BY c.kind, c.name`
  );
  res.json(rows);
}));

router.post('/categories', wrap(async (req, res) => {
  const name = reqText(req.body.name, 'nome');
  const kind = oneOf(req.body.kind, KINDS, 'tipo');
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : '#64748b';
  const { rows } = await pool.query(
    `INSERT INTO categories (name, kind, color) VALUES ($1,$2,$3)
     ON CONFLICT (name, kind) DO UPDATE SET active = true, color = EXCLUDED.color RETURNING *`,
    [name, kind, color]
  );
  res.status(201).json(rows[0]);
}));

router.put('/categories/:id', wrap(async (req, res) => {
  const name = reqText(req.body.name, 'nome');
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : '#64748b';
  const active = req.body.active === undefined ? true : Boolean(req.body.active);
  const { rows } = await pool.query(
    'UPDATE categories SET name=$1, color=$2, active=$3 WHERE id=$4 RETURNING *',
    [name, color, active, optInt(req.params.id)]
  );
  if (!rows.length) throw new HttpError(404, 'Categoria não encontrada');
  res.json(rows[0]);
}));

// Exclui se não tiver uso; caso contrário apenas desativa
router.delete('/categories/:id', wrap(async (req, res) => {
  const id = optInt(req.params.id);
  const used = await pool.query('SELECT 1 FROM transactions WHERE category_id = $1 LIMIT 1', [id]);
  if (used.rows.length) {
    await pool.query('UPDATE categories SET active = false WHERE id = $1', [id]);
    return res.json({ deactivated: true });
  }
  await pool.query('DELETE FROM categories WHERE id = $1', [id]);
  res.status(204).end();
}));

// ---------- contas ----------
router.get('/accounts', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*,
            a.initial_balance + COALESCE(SUM(CASE WHEN t.kind = 'receita' THEN t.amount ELSE -t.amount END)
              FILTER (WHERE t.paid AND t.date <= CURRENT_DATE), 0) AS balance
     FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
     GROUP BY a.id ORDER BY a.active DESC, a.name`
  );
  res.json(rows);
}));

router.post('/accounts', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'INSERT INTO accounts (name, type, initial_balance) VALUES ($1,$2,$3) RETURNING *',
    [reqText(req.body.name, 'nome'), oneOf(req.body.type, ACCOUNT_TYPES, 'tipo'),
      Number(req.body.initial_balance || 0) || 0]
  );
  res.status(201).json(rows[0]);
}));

router.put('/accounts/:id', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE accounts SET name=$1, type=$2, initial_balance=$3, active=$4 WHERE id=$5 RETURNING *',
    [reqText(req.body.name, 'nome'), oneOf(req.body.type, ACCOUNT_TYPES, 'tipo'),
      Number(req.body.initial_balance || 0) || 0,
      req.body.active === undefined ? true : Boolean(req.body.active), optInt(req.params.id)]
  );
  if (!rows.length) throw new HttpError(404, 'Conta não encontrada');
  res.json(rows[0]);
}));

router.delete('/accounts/:id', wrap(async (req, res) => {
  const id = optInt(req.params.id);
  const used = await pool.query('SELECT 1 FROM transactions WHERE account_id = $1 LIMIT 1', [id]);
  if (used.rows.length) {
    await pool.query('UPDATE accounts SET active = false WHERE id = $1', [id]);
    return res.json({ deactivated: true });
  }
  await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
  res.status(204).end();
}));

// ---------- orçamentos ----------
router.get('/budgets', wrap(async (req, res) => {
  const { start, next } = monthRange(req.query.month);
  const { rows } = await pool.query(
    `SELECT c.id AS category_id, c.name, c.color, b.amount AS budget,
            COALESCE((SELECT SUM(amount) FROM transactions t
                      WHERE t.category_id = c.id AND t.kind = 'despesa' AND t.date >= $1 AND t.date < $2), 0) AS spent
     FROM categories c
     LEFT JOIN budgets b ON b.category_id = c.id AND b.month = $1
     WHERE c.kind = 'despesa' AND c.active
     ORDER BY c.name`,
    [start, next]
  );
  res.json(rows);
}));

router.put('/budgets', wrap(async (req, res) => {
  const { start } = monthRange(req.body.month);
  const categoryId = optInt(req.body.category_id);
  if (req.body.amount === null || req.body.amount === '') {
    await pool.query('DELETE FROM budgets WHERE category_id = $1 AND month = $2', [categoryId, start]);
    return res.status(204).end();
  }
  const { rows } = await pool.query(
    `INSERT INTO budgets (category_id, month, amount) VALUES ($1,$2,$3)
     ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount RETURNING *`,
    [categoryId, start, reqAmount(req.body.amount, 'valor', true)]
  );
  res.json(rows[0]);
}));

router.post('/budgets/copy', wrap(async (req, res) => {
  const from = monthRange(req.body.from).start;
  const to = monthRange(req.body.to).start;
  const { rowCount } = await pool.query(
    `INSERT INTO budgets (category_id, month, amount)
     SELECT category_id, $2, amount FROM budgets WHERE month = $1
     ON CONFLICT (category_id, month) DO NOTHING`,
    [from, to]
  );
  res.json({ copied: rowCount });
}));

// ---------- usuários ----------
router.get('/users', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, email, created_at FROM users ORDER BY name');
  res.json(rows);
}));

router.post('/users', wrap(async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8) throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres');
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id, name, email, created_at',
      [reqText(req.body.name, 'nome'), reqText(req.body.email, 'e-mail').toLowerCase(), hashPassword(password)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'E-mail já cadastrado');
    throw err;
  }
}));

router.put('/me/password', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!verifyPassword(String(req.body.current || ''), rows[0].password_hash)) {
    throw new HttpError(400, 'Senha atual incorreta');
  }
  const pw = String(req.body.password || '');
  if (pw.length < 8) throw new HttpError(400, 'A nova senha deve ter pelo menos 8 caracteres');
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(pw), req.user.id]);
  res.status(204).end();
}));

module.exports = { router, HttpError };
