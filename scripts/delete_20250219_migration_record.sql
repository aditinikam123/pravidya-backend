-- Remove obsolete 20250219000000_session_lifecycle from migration history.
-- Run: npx prisma db execute --file scripts/delete_20250219_migration_record.sql
DELETE FROM "_prisma_migrations" WHERE migration_name = '20250219000000_session_lifecycle';
