$ErrorActionPreference = 'Stop'
$Container = 'footwear-postgres'
$Database = 'footwear_omnichannel_test'
Write-Host '=== QA-02 TEST DATA COVERAGE (READ ONLY) ===' -ForegroundColor Cyan
Write-Host "Container: $Container | Database: $Database"
$sql = @'
BEGIN READ ONLY;
SELECT current_database() AS database_name, current_user AS database_user;
SELECT schemaname, tablename
FROM pg_catalog.pg_tables
WHERE schemaname = 'public'
  AND tablename ~* '(stock|inventory|transfer|location|variant|reservation|movement|integrationevent|posshift|possale)'
ORDER BY tablename;
COMMIT;
'@
$sql | docker exec -i $Container psql -U footwear -d $Database -X -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Database metadata check failed' }
Write-Host "`n=== EXACT COUNTS OF MATCHING TABLES ===" -ForegroundColor Cyan
# psql \gexec executes the generated SELECT statements; each is a read-only count.
$countSql = @'
BEGIN READ ONLY;
SELECT format('SELECT %L AS table_name, count(*) AS row_count FROM %I.%I;', tablename, schemaname, tablename)
FROM pg_catalog.pg_tables
WHERE schemaname = 'public'
  AND tablename ~* '(stock|inventory|transfer|location|variant|reservation|movement|integrationevent|posshift|possale)'
ORDER BY tablename
\gexec
COMMIT;
'@
$countSql | docker exec -i $Container psql -U footwear -d $Database -X -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Table count check failed' }
Write-Host "`nCompleted. No database writes were requested." -ForegroundColor Green
