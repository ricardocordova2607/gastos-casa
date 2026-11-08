terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Recomendado: guardar o state no S3 (crie o bucket antes e descomente)
  # backend "s3" {
  #   bucket       = "meu-bucket-terraform-state"
  #   key          = "gastos-casa/terraform.tfstate"
  #   region       = "sa-east-1"
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

locals {
  name  = var.project
  azs   = slice(data.aws_availability_zones.available.names, 0, 2)
  https = var.certificate_arn != ""
}
