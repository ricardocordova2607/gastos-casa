variable "aws_region" {
  description = "Região AWS"
  type        = string
  default     = "sa-east-1"
}

variable "project" {
  description = "Nome base dos recursos (minúsculas e hífen)"
  type        = string
  default     = "gastos-casa"
}

variable "github_repo" {
  description = "Repositório GitHub no formato dono/repositorio (usado na confiança OIDC)"
  type        = string
}

variable "github_branch" {
  description = "Branch que pode fazer deploy"
  type        = string
  default     = "main"
}

variable "create_github_oidc_provider" {
  description = "Crie o provedor OIDC do GitHub (false se já existir na conta)"
  type        = bool
  default     = true
}

variable "admin_email" {
  description = "E-mail do primeiro usuário do sistema"
  type        = string
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_name" {
  type    = string
  default = "gastos"
}

variable "db_username" {
  type    = string
  default = "gastos_app"
}

variable "db_deletion_protection" {
  description = "Impede destruir o banco por engano"
  type        = bool
  default     = true
}

variable "app_cpu" {
  type    = number
  default = 256
}

variable "app_memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "use_fargate_spot" {
  description = "Usa Fargate Spot (até ~70% mais barato, pode ser interrompido)"
  type        = bool
  default     = false
}

variable "certificate_arn" {
  description = "ARN de certificado ACM para HTTPS no ALB (vazio = só HTTP)"
  type        = string
  default     = ""
}
