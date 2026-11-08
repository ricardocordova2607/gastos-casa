-- Dados iniciais: categorias e contas padrão

INSERT INTO categories (name, kind, color) VALUES
    ('Moradia',            'despesa', '#6366f1'),
    ('Mercado',            'despesa', '#16a34a'),
    ('Alimentação fora',   'despesa', '#f97316'),
    ('Contas (luz/água/gás)', 'despesa', '#0ea5e9'),
    ('Internet e telefone','despesa', '#06b6d4'),
    ('Transporte',         'despesa', '#eab308'),
    ('Saúde',              'despesa', '#ef4444'),
    ('Educação',           'despesa', '#8b5cf6'),
    ('Lazer',              'despesa', '#ec4899'),
    ('Vestuário',          'despesa', '#a855f7'),
    ('Pets',               'despesa', '#84cc16'),
    ('Assinaturas',        'despesa', '#14b8a6'),
    ('Impostos e taxas',   'despesa', '#78716c'),
    ('Manutenção da casa', 'despesa', '#d97706'),
    ('Outros',             'despesa', '#64748b'),
    ('Salário',            'receita', '#15803d'),
    ('Freelance / Extra',  'receita', '#0d9488'),
    ('Rendimentos',        'receita', '#2563eb'),
    ('Outros',             'receita', '#64748b')
ON CONFLICT (name, kind) DO NOTHING;

INSERT INTO accounts (name, type, initial_balance) VALUES
    ('Carteira',        'carteira',       0),
    ('Conta corrente',  'corrente',       0),
    ('Cartão de crédito','cartao_credito', 0)
ON CONFLICT (name) DO NOTHING;
