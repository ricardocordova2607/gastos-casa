# 🏠 Gastos da Casa

Sistema web para controle de gastos domésticos, com deploy automático na AWS (ECS Fargate + RDS PostgreSQL) via GitHub Actions.

## Funcionalidades

- **Login** com múltiplas pessoas da casa (todos veem os mesmos dados)
- **Lançamentos** de despesas e receitas, com categoria, conta, status pago/pendente, observações e **parcelamento** (gera N lançamentos mensais)
- **Resumo do mês**: receitas, despesas, saldo, contas a pagar, gastos por categoria × orçamento, gráfico dos últimos 6 meses e saldo de cada conta
- **Orçamento mensal** por categoria, com botão para copiar do mês anterior
- **Categorias** e **contas** (corrente, poupança, carteira, cartão de crédito) editáveis
- Filtros, busca e **exportação CSV** (abre direto no Excel)
- Interface responsiva (funciona no celular) com modo escuro automático

## Estrutura

```
app/                    Aplicação Node.js (Express + pg) com frontend em HTML/JS puro
  migrations/           Schema e dados iniciais do Postgres (aplicados automaticamente)
  src/                  Backend (API REST, autenticação, migrações)
  public/               Frontend
  Dockerfile
infra/                  Terraform: VPC, ALB, ECS Fargate, ECR, RDS Postgres, IAM/OIDC do GitHub
.github/workflows/      Pipeline de CI/CD
docker-compose.yml      Ambiente local
```

## Banco de dados

As tabelas (`users`, `sessions`, `accounts`, `categories`, `transactions`, `budgets`) e a view `vw_monthly_totals` ficam em `app/migrations/001_schema.sql`. O arquivo `002_seed.sql` cria 15 categorias de despesa, 4 de receita e 3 contas padrão.

**Você não precisa rodar SQL na mão**: toda vez que a aplicação sobe, ela aplica as migrações pendentes (controladas pela tabela `schema_migrations`, com lock para evitar conflito entre tasks) e cria o primeiro usuário a partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD` se o banco estiver vazio.

Para alterar o banco no futuro, crie um novo arquivo (`003_algo.sql`). Não edite arquivos já aplicados.

## Rodando localmente

```bash
docker compose up --build
```

Acesse http://localhost:3000 com `admin@casa.local` / `trocar-esta-senha`.

## Deploy na AWS — passo a passo

### Pré-requisitos

- Conta AWS e AWS CLI configurado com um usuário administrador (só para o primeiro `terraform apply`)
- Terraform ≥ 1.5
- Repositório no GitHub com este código

### 1. Criar a infraestrutura

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # edite github_repo e admin_email
terraform init
terraform apply
```

Isso cria (em ~10–15 min, a maior parte é o RDS):

| Recurso | Detalhe |
|---|---|
| VPC | 2 subnets públicas (ALB + ECS) e 2 isoladas (RDS), sem NAT |
| RDS PostgreSQL 16 | `db.t4g.micro`, 20 GB gp3 criptografado, backup de 7 dias, senha no Secrets Manager |
| ECR | Repositório da imagem, com scan e retenção de 20 imagens |
| ECS Fargate | Cluster, task definition (0,25 vCPU / 512 MB) e service com rollback automático |
| ALB | HTTP (ou HTTPS se informar `certificate_arn`) |
| IAM | Roles do ECS e role do GitHub Actions via OIDC (sem chaves de acesso) |
| Secrets Manager | Senha do banco e senha inicial do admin |

> O service do ECS fica tentando subir até a primeira imagem ser publicada — é esperado.

### 2. Configurar o GitHub

Rode `terraform output github_actions_variables` e cadastre cada item em
**Settings → Secrets and variables → Actions → aba Variables**:

`AWS_REGION`, `AWS_ROLE_ARN`, `ECR_REPOSITORY`, `ECS_CLUSTER`, `ECS_SERVICE`, `ECS_TASK_FAMILY`

(São variáveis, não secrets: nenhuma delas é sensível.)

### 3. Fazer o deploy

```bash
git push origin main
```

O workflow `.github/workflows/deploy.yml`:
1. **test** — instala dependências, verifica sintaxe, aplica as migrações num Postgres temporário (duas vezes, garantindo idempotência) e faz o build do Docker. Roda também em Pull Requests.
2. **deploy** — só na `main`: assume a role via OIDC, publica a imagem no ECR (tag = SHA do commit + `latest`), cria nova revisão da task definition e atualiza o service, aguardando ficar estável.

### 4. Acessar

```bash
terraform output app_url
terraform output -raw admin_password_command | bash   # senha inicial do admin
```

Entre com o `admin_email` e essa senha, depois troque em **Configurações**.

## HTTPS e domínio próprio

1. Crie um certificado no **ACM** (mesma região) para seu domínio e valide por DNS.
2. Coloque o ARN em `certificate_arn` no `terraform.tfvars` e rode `terraform apply` (HTTP passa a redirecionar para HTTPS).
3. Aponte o domínio para `terraform output alb_dns_name` (registro alias no Route 53 ou CNAME).

Recomendo fortemente ativar HTTPS antes de usar com dados reais.

## Custos estimados (sa-east-1, valores aproximados)

| Item | ~US$/mês |
|---|---|
| ALB | 22 |
| RDS db.t4g.micro + 20 GB | 17 |
| Fargate 0,25 vCPU / 0,5 GB 24×7 | 11 (≈ 4 com `use_fargate_spot = true`) |
| IPv4 públicos (ALB + task) | 11 |
| Secrets Manager, logs, ECR | 2 |
| **Total** | **≈ 60** |

Contas novas têm free tier de 12 meses para parte do RDS. Confira os preços atuais na calculadora da AWS.

## Operação

- **Logs**: CloudWatch, grupo `/ecs/gastos-casa`
- **Saúde**: `/health` (usado pelo ALB) e `/health/db` (testa o banco)
- **Acessar o container**: `aws ecs execute-command --cluster gastos-casa --task <id> --container app --interactive --command sh`
- **Backup**: snapshots automáticos diários do RDS (7 dias). Um snapshot final é criado se o banco for destruído.
- **Destruir tudo**: altere `db_deletion_protection = false`, rode `terraform apply` e depois `terraform destroy`.

## Observações de segurança

- O banco não tem IP público e só aceita conexões das tasks do ECS; as tasks só aceitam tráfego do ALB.
- Senhas são guardadas com `scrypt`; sessões em cookie `httpOnly`, com limite de tentativas de login.
- A conexão com o RDS usa SSL (`DB_SSL=true`) sem validar a cadeia de certificados. Para validar, inclua o bundle de CA do RDS na imagem e ajuste `app/src/db.js`.
- Para guardar o state do Terraform com segurança, configure o backend S3 em `infra/versions.tf`.
