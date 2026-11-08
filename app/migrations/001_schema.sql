-- Esquema do sistema de controle de gastos domésticos

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          TEXT        NOT NULL,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT        PRIMARY KEY,
    user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- Contas / carteiras (conta corrente, cartão de crédito, dinheiro...)
CREATE TABLE IF NOT EXISTS accounts (
    id              SERIAL PRIMARY KEY,
    name            TEXT          NOT NULL UNIQUE,
    type            TEXT          NOT NULL CHECK (type IN ('corrente','poupanca','carteira','cartao_credito','outro')),
    initial_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    active          BOOLEAN       NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Categorias de despesa e receita
CREATE TABLE IF NOT EXISTS categories (
    id         SERIAL PRIMARY KEY,
    name       TEXT        NOT NULL,
    kind       TEXT        NOT NULL CHECK (kind IN ('despesa','receita')),
    color      TEXT        NOT NULL DEFAULT '#64748b',
    active     BOOLEAN     NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, kind)
);

-- Lançamentos
CREATE TABLE IF NOT EXISTS transactions (
    id          SERIAL PRIMARY KEY,
    kind        TEXT          NOT NULL CHECK (kind IN ('despesa','receita')),
    description TEXT          NOT NULL,
    amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    date        DATE          NOT NULL,
    category_id INTEGER       NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    account_id  INTEGER       REFERENCES accounts(id) ON DELETE SET NULL,
    paid        BOOLEAN       NOT NULL DEFAULT true,
    notes       TEXT,
    created_by  INTEGER       REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transactions_date     ON transactions (date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_account  ON transactions (account_id, date);

-- Orçamento mensal por categoria (month = primeiro dia do mês)
CREATE TABLE IF NOT EXISTS budgets (
    id          SERIAL PRIMARY KEY,
    category_id INTEGER       NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    month       DATE          NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
    amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    UNIQUE (category_id, month)
);

-- Visão útil para relatórios/BI direto no banco
CREATE OR REPLACE VIEW vw_monthly_totals AS
SELECT date_trunc('month', t.date)::date AS month,
       t.kind,
       c.name AS category,
       SUM(t.amount) AS total,
       COUNT(*)      AS qty
FROM transactions t
JOIN categories c ON c.id = t.category_id
GROUP BY 1, 2, 3;
