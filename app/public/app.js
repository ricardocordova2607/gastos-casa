'use strict';

// ---------- utilitários ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v) => BRL.format(Number(v || 0));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
};
const shiftMonth = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const ACCOUNT_TYPES = {
  corrente: 'Conta corrente', poupanca: 'Poupança', carteira: 'Dinheiro / carteira',
  cartao_credito: 'Cartão de crédito', outro: 'Outro',
};

const state = {
  month: today().slice(0, 7),
  tab: 'resumo',
  user: null,
  categories: [],
  accounts: [],
  filters: { kind: '', category_id: '', account_id: '', q: '' },
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2500);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    showLogin();
    throw new Error('Sessão expirada');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status}`);
  return data;
}

// ---------- autenticação ----------
function showLogin() {
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
}
async function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#user-name').textContent = state.user.name;
  $('#month').value = state.month;
  await loadRefs();
  render();
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#login-error').textContent = '';
  try {
    state.user = await api('/auth/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
    e.target.reset();
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});
$('#logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  showLogin();
});

// ---------- navegação ----------
$$('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tab').forEach((s) => s.classList.toggle('hidden', s.id !== `tab-${state.tab}`));
    render();
  })
);
$('#month').addEventListener('change', (e) => {
  if (e.target.value) {
    state.month = e.target.value;
    render();
  }
});
$('#prev-month').addEventListener('click', () => { state.month = shiftMonth(state.month, -1); $('#month').value = state.month; render(); });
$('#next-month').addEventListener('click', () => { state.month = shiftMonth(state.month, 1); $('#month').value = state.month; render(); });
$('#fab').addEventListener('click', () => openTx());

async function loadRefs() {
  [state.categories, state.accounts] = await Promise.all([api('/categories'), api('/accounts')]);
}

async function render() {
  const el = $(`#tab-${state.tab}`);
  try {
    await ({
      resumo: renderSummary,
      lancamentos: renderTransactions,
      orcamentos: renderBudgets,
      categorias: renderCategories,
      contas: renderAccounts,
      config: renderSettings,
    })[state.tab](el);
  } catch (err) {
    el.innerHTML = `<div class="card error">${esc(err.message)}</div>`;
  }
}

// ---------- resumo ----------
async function renderSummary(el) {
  const s = await api(`/summary?month=${state.month}`);
  const maxTrend = Math.max(1, ...s.trend.flatMap((t) => [t.income, t.expense]));
  const totalBudget = s.by_category.reduce((a, c) => a + (c.budget || 0), 0);

  el.innerHTML = `
    <div class="grid">
      <div class="card stat"><div class="label">Receitas</div><div class="value pos">${money(s.income)}</div></div>
      <div class="card stat"><div class="label">Despesas</div><div class="value neg">${money(s.expense)}</div></div>
      <div class="card stat"><div class="label">Saldo do mês</div><div class="value ${s.balance >= 0 ? 'pos' : 'neg'}">${money(s.balance)}</div></div>
      <div class="card stat"><div class="label">Despesas a pagar</div><div class="value" style="color:var(--amber)">${money(s.pending_expense)}</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <h2>Despesas por categoria</h2>
        ${totalBudget ? `<p class="muted">Orçamento total: ${money(totalBudget)}</p>` : ''}
        ${s.by_category.length ? s.by_category.map((c) => {
          const ref = c.budget || s.expense || 1;
          const pct = Math.min(100, (c.spent / ref) * 100);
          const over = c.budget != null && c.spent > c.budget;
          return `<div class="cat-line">
            <div class="top"><span><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</span>
            <span class="${over ? 'neg' : ''}">${money(c.spent)}${c.budget != null ? ` <span class="muted">/ ${money(c.budget)}</span>` : ''}</span></div>
            <div class="bar"><span style="width:${pct}%;background:${over ? 'var(--red)' : esc(c.color)}"></span></div>
          </div>`;
        }).join('') : '<p class="muted">Nenhuma despesa neste mês.</p>'}
      </div>
      <div>
        <div class="card">
          <h2>Últimos 6 meses</h2>
          <div class="trend">
            ${s.trend.map((t) => `<div class="col" title="Receitas ${money(t.income)} · Despesas ${money(t.expense)}">
              <div class="bars">
                <span style="height:${(t.income / maxTrend) * 100}%;background:var(--green)"></span>
                <span style="height:${(t.expense / maxTrend) * 100}%;background:var(--red)"></span>
              </div>
              <div class="lbl">${monthLabel(t.month)}</div></div>`).join('')}
          </div>
          <div class="legend"><span><span class="dot" style="background:var(--green)"></span>Receitas</span>
          <span><span class="dot" style="background:var(--red)"></span>Despesas</span></div>
        </div>
        <div class="card">
          <h2>Saldo das contas (hoje)</h2>
          <table>${s.accounts.map((a) => `<tr><td>${esc(a.name)} <span class="muted">· ${ACCOUNT_TYPES[a.type] || a.type}</span></td>
            <td class="num ${a.balance >= 0 ? 'pos' : 'neg'}">${money(a.balance)}</td></tr>`).join('')}</table>
        </div>
      </div>
    </div>`;
}

// ---------- lançamentos ----------
async function renderTransactions(el) {
  const f = state.filters;
  const qs = new URLSearchParams({ month: state.month, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
  const rows = await api(`/transactions?${qs}`);
  const inc = rows.filter((r) => r.kind === 'receita').reduce((a, r) => a + r.amount, 0);
  const exp = rows.filter((r) => r.kind === 'despesa').reduce((a, r) => a + r.amount, 0);

  el.innerHTML = `
    <div class="card">
      <div class="filters">
        <label>Buscar <input id="f-q" value="${esc(f.q)}" placeholder="Descrição ou observação" /></label>
        <label>Tipo <select id="f-kind"><option value="">Todos</option>
          <option value="despesa" ${f.kind === 'despesa' ? 'selected' : ''}>Despesas</option>
          <option value="receita" ${f.kind === 'receita' ? 'selected' : ''}>Receitas</option></select></label>
        <label>Categoria <select id="f-cat"><option value="">Todas</option>
          ${state.categories.map((c) => `<option value="${c.id}" ${String(f.category_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)} (${c.kind})</option>`).join('')}</select></label>
        <label>Conta <select id="f-acc"><option value="">Todas</option>
          ${state.accounts.map((a) => `<option value="${a.id}" ${String(f.account_id) === String(a.id) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <a class="btn" href="/api/transactions.csv?${qs}">Exportar CSV</a>
      </div>
      <p class="muted">${rows.length} lançamento(s) · Receitas <span class="pos">${money(inc)}</span> · Despesas <span class="neg">${money(exp)}</span></p>
      <div class="table-wrap"><table>
        <thead><tr><th>Data</th><th>Descrição</th><th class="hide-sm">Categoria</th><th class="hide-sm">Conta</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr class="clickable" data-id="${r.id}">
            <td>${fmtDate(r.date)}</td>
            <td>${esc(r.description)}${r.notes ? ` <span class="muted" title="${esc(r.notes)}">📝</span>` : ''}</td>
            <td class="hide-sm"><span class="dot" style="background:${esc(r.category_color)}"></span>${esc(r.category_name)}</td>
            <td class="hide-sm">${esc(r.account_name || '—')}</td>
            <td class="num ${r.kind === 'receita' ? 'pos' : 'neg'}">${r.kind === 'receita' ? '+' : '−'} ${money(r.amount)}</td>
            <td>${r.paid ? '' : `<button class="btn small badge pending" data-pay="${r.id}" title="Marcar como pago">pendente</button>`}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum lançamento encontrado.</td></tr>'}
        </tbody></table></div>
    </div>`;

  const refilter = () => {
    state.filters = { q: $('#f-q').value, kind: $('#f-kind').value, category_id: $('#f-cat').value, account_id: $('#f-acc').value };
    render();
  };
  $('#f-q').addEventListener('change', refilter);
  ['#f-kind', '#f-cat', '#f-acc'].forEach((s) => $(s).addEventListener('change', refilter));
  $$('tr[data-id]', el).forEach((tr) =>
    tr.addEventListener('click', (e) => {
      if (e.target.dataset.pay) return;
      openTx(rows.find((r) => String(r.id) === tr.dataset.id));
    })
  );
  $$('[data-pay]', el).forEach((b) =>
    b.addEventListener('click', async () => {
      await api(`/transactions/${b.dataset.pay}/paid`, { method: 'PATCH', body: { paid: true } });
      toast('Marcado como pago');
      render();
    })
  );
}

// ---------- modal de lançamento ----------
const dlg = $('#tx-dialog');
const txForm = $('#tx-form');
let editing = null;

function fillTxSelects(kind, categoryId, accountId) {
  txForm.category_id.innerHTML = state.categories
    .filter((c) => c.kind === kind && (c.active || c.id === categoryId))
    .map((c) => `<option value="${c.id}" ${c.id === categoryId ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');
  txForm.account_id.innerHTML = '<option value="">—</option>' + state.accounts
    .filter((a) => a.active || a.id === accountId)
    .map((a) => `<option value="${a.id}" ${a.id === accountId ? 'selected' : ''}>${esc(a.name)}</option>`)
    .join('');
}

function openTx(tx = null) {
  editing = tx;
  txForm.reset();
  $('#tx-error').textContent = '';
  $('#tx-title').textContent = tx ? 'Editar lançamento' : 'Novo lançamento';
  $('#tx-delete').classList.toggle('hidden', !tx);
  $('#installments-field').classList.toggle('hidden', !!tx);
  const kind = tx ? tx.kind : 'despesa';
  txForm.querySelector(`input[name=kind][value=${kind}]`).checked = true;
  if (tx) {
    txForm.description.value = tx.description;
    txForm.amount.value = tx.amount;
    txForm.date.value = tx.date;
    txForm.paid.checked = tx.paid;
    txForm.notes.value = tx.notes || '';
  } else {
    // data padrão: hoje se estiver no mês selecionado, senão dia 1 do mês
    txForm.date.value = today().startsWith(state.month) ? today() : `${state.month}-01`;
  }
  fillTxSelects(kind, tx ? tx.category_id : null, tx ? tx.account_id : null);
  dlg.showModal();
  txForm.description.focus();
}

$$('input[name=kind]', txForm).forEach((r) =>
  r.addEventListener('change', () => fillTxSelects(r.value, null, Number(txForm.account_id.value) || null))
);
$('#tx-cancel').addEventListener('click', () => dlg.close());
$('#tx-delete').addEventListener('click', async () => {
  if (!editing || !confirm('Excluir este lançamento?')) return;
  await api(`/transactions/${editing.id}`, { method: 'DELETE' });
  dlg.close();
  toast('Lançamento excluído');
  render();
});
txForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(txForm);
  const body = {
    kind: f.get('kind'),
    description: f.get('description'),
    amount: f.get('amount'),
    date: f.get('date'),
    category_id: f.get('category_id'),
    account_id: f.get('account_id') || null,
    paid: txForm.paid.checked,
    notes: f.get('notes'),
    installments: f.get('installments') || 1,
  };
  try {
    if (editing) await api(`/transactions/${editing.id}`, { method: 'PUT', body });
    else await api('/transactions', { method: 'POST', body });
    dlg.close();
    toast('Lançamento salvo');
    render();
  } catch (err) {
    $('#tx-error').textContent = err.message;
  }
});

// ---------- orçamentos ----------
async function renderBudgets(el) {
  const rows = await api(`/budgets?month=${state.month}`);
  const total = rows.reduce((a, r) => a + (r.budget || 0), 0);
  const spent = rows.reduce((a, r) => a + r.spent, 0);
  el.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div><h2>Orçamento de ${monthLabel(state.month)}</h2>
        <p class="muted">Planejado ${money(total)} · Gasto ${money(spent)}</p></div>
        <button class="btn" id="copy-budget">Copiar do mês anterior</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Categoria</th><th class="num">Gasto</th><th class="num">Orçamento (R$)</th><th style="width:30%">Uso</th></tr></thead>
        <tbody>${rows.map((r) => {
          const pct = r.budget ? Math.min(100, (r.spent / r.budget) * 100) : 0;
          const over = r.budget != null && r.spent > r.budget;
          return `<tr>
            <td><span class="dot" style="background:${esc(r.color)}"></span>${esc(r.name)}</td>
            <td class="num ${over ? 'neg' : ''}">${money(r.spent)}</td>
            <td class="num"><input type="number" step="0.01" min="0" style="max-width:130px;text-align:right"
                 data-cat="${r.category_id}" value="${r.budget ?? ''}" placeholder="—" /></td>
            <td>${r.budget != null ? `<div class="bar"><span style="width:${pct}%;background:${over ? 'var(--red)' : pct > 80 ? 'var(--amber)' : 'var(--green)'}"></span></div>
              <span class="muted" style="font-size:.8rem">${Math.round((r.spent / (r.budget || 1)) * 100)}%</span>` : ''}</td>
          </tr>`;
        }).join('')}</tbody></table></div>
    </div>`;

  $$('input[data-cat]', el).forEach((inp) =>
    inp.addEventListener('change', async () => {
      try {
        await api('/budgets', { method: 'PUT', body: { month: state.month, category_id: inp.dataset.cat, amount: inp.value === '' ? null : inp.value } });
        toast('Orçamento salvo');
        render();
      } catch (err) {
        toast(err.message);
      }
    })
  );
  $('#copy-budget').addEventListener('click', async () => {
    const r = await api('/budgets/copy', { method: 'POST', body: { from: shiftMonth(state.month, -1), to: state.month } });
    toast(`${r.copied} orçamento(s) copiado(s)`);
    render();
  });
}

// ---------- categorias ----------
async function renderCategories(el) {
  await loadRefs();
  const section = (kind, title) => `
    <div class="card"><h2>${title}</h2>
      <table><tbody>${state.categories.filter((c) => c.kind === kind).map((c) => `
        <tr class="${c.active ? '' : 'inactive'}">
          <td style="width:60px"><input type="color" value="${esc(c.color)}" data-color="${c.id}" /></td>
          <td><input value="${esc(c.name)}" data-name="${c.id}" /></td>
          <td class="muted hide-sm">${c.usage} uso(s)</td>
          <td class="num">${c.active
            ? `<button class="btn small" data-del="${c.id}">${c.usage ? 'Desativar' : 'Excluir'}</button>`
            : `<button class="btn small" data-act="${c.id}">Reativar</button>`}</td>
        </tr>`).join('')}</tbody></table>
    </div>`;
  el.innerHTML = `
    <div class="card"><h2>Nova categoria</h2>
      <form class="inline-form" id="cat-form">
        <label>Nome <input name="name" required /></label>
        <label>Tipo <select name="kind"><option value="despesa">Despesa</option><option value="receita">Receita</option></select></label>
        <label style="flex:0">Cor <input type="color" name="color" value="#3b82f6" /></label>
        <button class="btn primary">Adicionar</button>
      </form></div>
    <div class="grid-2">${section('despesa', 'Despesas')}${section('receita', 'Receitas')}</div>`;

  $('#cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/categories', { method: 'POST', body: Object.fromEntries(f) });
      toast('Categoria criada');
      render();
    } catch (err) { toast(err.message); }
  });
  const save = async (id, patch) => {
    const c = state.categories.find((x) => String(x.id) === String(id));
    try {
      await api(`/categories/${id}`, { method: 'PUT', body: { name: c.name, color: c.color, active: c.active, ...patch } });
      toast('Categoria atualizada');
      render();
    } catch (err) { toast(err.message); }
  };
  $$('[data-name]', el).forEach((i) => i.addEventListener('change', () => save(i.dataset.name, { name: i.value })));
  $$('[data-color]', el).forEach((i) => i.addEventListener('change', () => save(i.dataset.color, { color: i.value })));
  $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => save(b.dataset.act, { active: true })));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Confirmar?')) return;
    await api(`/categories/${b.dataset.del}`, { method: 'DELETE' });
    render();
  }));
}

// ---------- contas ----------
async function renderAccounts(el) {
  await loadRefs();
  const typeOpts = (sel) => Object.entries(ACCOUNT_TYPES).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  el.innerHTML = `
    <div class="card"><h2>Nova conta</h2>
      <form class="inline-form" id="acc-form">
        <label>Nome <input name="name" required /></label>
        <label>Tipo <select name="type">${typeOpts('corrente')}</select></label>
        <label>Saldo inicial (R$) <input name="initial_balance" type="number" step="0.01" value="0" /></label>
        <button class="btn primary">Adicionar</button>
      </form></div>
    <div class="card"><h2>Contas</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Nome</th><th>Tipo</th><th class="num">Saldo inicial</th><th class="num">Saldo atual</th><th></th></tr></thead>
        <tbody>${state.accounts.map((a) => `
          <tr class="${a.active ? '' : 'inactive'}" data-acc="${a.id}">
            <td><input name="name" value="${esc(a.name)}" /></td>
            <td><select name="type">${typeOpts(a.type)}</select></td>
            <td class="num"><input name="initial_balance" type="number" step="0.01" value="${a.initial_balance}" style="max-width:130px;text-align:right" /></td>
            <td class="num ${a.balance >= 0 ? 'pos' : 'neg'}">${money(a.balance)}</td>
            <td class="num">${a.active ? `<button class="btn small" data-del>Excluir</button>` : `<button class="btn small" data-act>Reativar</button>`}</td>
          </tr>`).join('')}</tbody></table></div>
      <p class="muted">Contas com lançamentos são desativadas em vez de excluídas.</p>
    </div>`;

  $('#acc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/accounts', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast('Conta criada');
      render();
    } catch (err) { toast(err.message); }
  });
  $$('tr[data-acc]', el).forEach((tr) => {
    const id = tr.dataset.acc;
    const get = (active) => ({
      name: $('[name=name]', tr).value, type: $('[name=type]', tr).value,
      initial_balance: $('[name=initial_balance]', tr).value, active,
    });
    const acc = state.accounts.find((a) => String(a.id) === id);
    $$('input, select', tr).forEach((i) => i.addEventListener('change', async () => {
      try { await api(`/accounts/${id}`, { method: 'PUT', body: get(acc.active) }); toast('Conta atualizada'); render(); }
      catch (err) { toast(err.message); }
    }));
    const del = $('[data-del]', tr);
    if (del) del.addEventListener('click', async () => {
      if (!confirm('Excluir esta conta?')) return;
      await api(`/accounts/${id}`, { method: 'DELETE' });
      render();
    });
    const act = $('[data-act]', tr);
    if (act) act.addEventListener('click', async () => { await api(`/accounts/${id}`, { method: 'PUT', body: get(true) }); render(); });
  });
}

// ---------- configurações ----------
async function renderSettings(el) {
  const users = await api('/users');
  el.innerHTML = `
    <div class="grid-2">
      <div class="card"><h2>Alterar minha senha</h2>
        <form id="pw-form" style="display:flex;flex-direction:column;gap:10px">
          <label>Senha atual <input type="password" name="current" required autocomplete="current-password" /></label>
          <label>Nova senha <input type="password" name="password" minlength="8" required autocomplete="new-password" /></label>
          <button class="btn primary">Salvar</button>
        </form></div>
      <div class="card"><h2>Pessoas da casa</h2>
        <table>${users.map((u) => `<tr><td>${esc(u.name)}</td><td class="muted">${esc(u.email)}</td></tr>`).join('')}</table>
        <h3 style="margin-top:16px">Adicionar pessoa</h3>
        <form id="user-form" style="display:flex;flex-direction:column;gap:10px">
          <label>Nome <input name="name" required /></label>
          <label>E-mail <input type="email" name="email" required /></label>
          <label>Senha inicial <input type="password" name="password" minlength="8" required autocomplete="new-password" /></label>
          <button class="btn primary">Adicionar</button>
        </form></div>
    </div>`;
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/me/password', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      toast('Senha alterada');
    } catch (err) { toast(err.message); }
  });
  $('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast('Pessoa adicionada');
      render();
    } catch (err) { toast(err.message); }
  });
}

// ---------- início ----------
(async () => {
  try {
    state.user = await api('/auth/me');
    showApp();
  } catch {
    showLogin();
  }
})();
