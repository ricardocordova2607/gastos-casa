# PostgreSQL gerenciado. A senha mestre é gerada e guardada pelo próprio RDS
# no Secrets Manager (manage_master_user_password). O schema e os dados
# iniciais são aplicados pela aplicação ao subir (pasta app/migrations).
resource "aws_db_instance" "main" {
  identifier     = "${local.name}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 5
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name                     = var.db_name
  username                    = var.db_username
  manage_master_user_password = true

  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period    = 7
  backup_window              = "06:00-07:00" # UTC (03h em Brasília)
  maintenance_window         = "sun:07:30-sun:08:30"
  auto_minor_version_upgrade = true

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-db-final"
  copy_tags_to_snapshot     = true
}
