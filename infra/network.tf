# VPC com subnets públicas (ALB + tasks ECS) e subnets isoladas (RDS).
# Sem NAT Gateway para economizar (~US$ 35/mês): as tasks recebem IP público
# para baixar a imagem do ECR, mas só aceitam tráfego vindo do ALB.
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.13"

  name = local.name
  cidr = "10.20.0.0/16"
  azs  = local.azs

  public_subnets   = ["10.20.1.0/24", "10.20.2.0/24"]
  database_subnets = ["10.20.21.0/24", "10.20.22.0/24"]

  create_database_subnet_group = true
  enable_nat_gateway           = false
  enable_dns_hostnames         = true
  enable_dns_support           = true
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Entrada HTTP/HTTPS publica"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "app" {
  name        = "${local.name}-app"
  description = "Tasks ECS - aceita apenas o ALB"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "Postgres - aceita apenas as tasks ECS"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}
