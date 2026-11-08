output "app_url" {
  description = "Endereço da aplicação"
  value       = "${local.https ? "https" : "http"}://${aws_lb.app.dns_name}"
}

output "alb_dns_name" {
  description = "Aponte seu domínio (CNAME/alias) para este endereço"
  value       = aws_lb.app.dns_name
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}

output "db_master_secret_arn" {
  description = "Secret com usuário/senha do Postgres"
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "admin_password_secret_arn" {
  description = "Secret com a senha inicial do admin do sistema"
  value       = aws_secretsmanager_secret.admin_password.arn
}

output "admin_password_command" {
  description = "Comando para ver a senha inicial do admin"
  value       = "aws secretsmanager get-secret-value --region ${var.aws_region} --secret-id ${aws_secretsmanager_secret.admin_password.name} --query SecretString --output text"
}

# Copie estes valores para Settings > Secrets and variables > Actions > Variables no GitHub
output "github_actions_variables" {
  value = {
    AWS_REGION      = var.aws_region
    AWS_ROLE_ARN    = aws_iam_role.github_deploy.arn
    ECR_REPOSITORY  = aws_ecr_repository.app.name
    ECS_CLUSTER     = aws_ecs_cluster.main.name
    ECS_SERVICE     = aws_ecs_service.app.name
    ECS_TASK_FAMILY = aws_ecs_task_definition.app.family
  }
}
