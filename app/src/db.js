const { Pool, types } = require('pg');

// NUMERIC -> number, BIGINT (count) -> number, DATE -> 'YYYY-MM-DD' (sem fuso)
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1082, (v) => v);

const useSsl = String(process.env.DB_SSL || '').toLowerCase() === 'true';

const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'gastos',
      user: process.env.DB_USER || 'gastos_app',
      password: process.env.DB_PASSWORD || 'gastos_app',
    };

// O RDS (Postgres 15+) exige SSL por padrão.
if (useSsl) config.ssl = { rejectUnauthorized: false };

const pool = new Pool({ ...config, max: 10, idleTimeoutMillis: 30000 });

pool.on('error', (err) => console.error('Erro inesperado no pool do Postgres', err));

module.exports = { pool };
