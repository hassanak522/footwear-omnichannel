param(
    [string]$Root = "G:\footwear-omnichannel"
)

$ErrorActionPreference = "Stop"

$db = "footwear_m115_api_b16z_20261107"
$api = "http://127.0.0.1:3102/api/v1"

$locationId = "0286ddd3-4b83-42ce-8a68-7fa9a5bd5829"
$variantId = "d167b9bb-61bf-4364-aae0-5a7a064310bf"

$sku = "M115-R15-INVENTORY-001"

$credentialsPath = Join-Path $Root `
    "security-checks\M115\fixtures\M115_B16Z_TEST_CREDENTIALS.json"

$reportDir = Join-Path $Root "security-checks\M115\reports"

New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

$results = New-Object System.Collections.Generic.List[object]

function Record-Result {
    param(
        [string]$Test,
        [bool]$Passed,
        [string]$Details
    )

    $status = if ($Passed) { "PASS" } else { "FAIL" }

    Write-Host "$status - $Test"

    $results.Add([pscustomobject]@{
        Test = $Test
        Status = $status
        Details = $Details
    })

    if (-not $Passed) {
        throw "SAFETY STOP: $Test failed."
    }
}

function Query-Database {
    param([string]$Sql)

    $output = @(
        $Sql | docker exec -i footwear-postgres `
            psql -X -U footwear -d $db `
            -At -v ON_ERROR_STOP=1
    )

    if ($LASTEXITCODE -ne 0) {
        throw "Database query failed."
    }

    return $output
}

function Get-FixtureState {
    $sql = @"
BEGIN TRANSACTION READ ONLY;
SELECT
    b."onHand"::text || '|' ||
    b."version"::text || '|' ||
    (
        SELECT COUNT(*)::text
        FROM public."StockMovement" m
        WHERE m."variantId" = '$variantId'
          AND m."locationId" = '$locationId'
    ) || '|' ||
    (
        SELECT COUNT(*)::text
        FROM public."AuditLog" a
        WHERE a."entityType" = 'StockBalance'
          AND a."entityId" = b."id"::text
          AND a."action" = 'STOCK_ADJUST'
    )
FROM public."StockBalance" b
WHERE b."locationId" = '$locationId'
  AND b."variantId" = '$variantId';
ROLLBACK;
"@

    $lines = @(Query-Database $sql)

    $data = @(
        $lines | Where-Object {
            $_ -match '^\d+\|\d+\|\d+\|\d+$'
        }
    )

    if ($data.Count -ne 1) {
        throw "SAFETY STOP: Fixture state is missing or ambiguous."
    }

    $parts = $data[0].Split('|')

    return [pscustomobject]@{
        OnHand = [int]$parts[0]
        Version = [int]$parts[1]
        Movements = [int]$parts[2]
        Audits = [int]$parts[3]
    }
}

function Invoke-Adjustment {
    param(
        [hashtable]$Body,
        [hashtable]$Headers
    )

    try {
        $response = Invoke-WebRequest `
            -Uri "$api/inventory/adjust" `
            -Method Post `
            -Headers $Headers `
            -ContentType "application/json" `
            -Body ($Body | ConvertTo-Json -Compress) `
            -UseBasicParsing `
            -TimeoutSec 30

        return [pscustomobject]@{
            Status = [int]$response.StatusCode
            Body = $response.Content
        }
    }
    catch {
        $status = 0

        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        }

        return [pscustomobject]@{
            Status = $status
            Body = ""
        }
    }
}

try {
    Write-Host "`n=== M115-R15-R3-R6 ===" -ForegroundColor Cyan

    # 1. Verify exact disposable database.
    $identity = @(
        Query-Database "SELECT current_database();"
    )

    Record-Result "Disposable database identity" `
        ($identity.Count -eq 1 -and $identity[0] -ceq $db) `
        "Exact database verified"

    # 2. Verify tagged API connection.
    $tagged = @(
        Query-Database @"
SELECT COUNT(*)
FROM pg_stat_activity
WHERE datname = current_database()
  AND application_name = 'm115_b16z_isolated_api'
  AND client_addr IS NOT NULL;
"@
    )

    Record-Result "Tagged API connection" `
        ($tagged.Count -eq 1 -and $tagged[0] -match '^[1-9]\d*$') `
        "Tagged session present"

    # 3. API health.
    $health = Invoke-WebRequest `
        -Uri "$api/health" `
        -UseBasicParsing `
        -TimeoutSec 10

    Record-Result "Isolated API health" `
        ($health.StatusCode -eq 200) `
        "HTTP 200"

    # 4. Load test credentials without displaying secrets.
    $creds = Get-Content $credentialsPath -Raw |
        ConvertFrom-Json

    $manager = $creds.warehouseManager

    if (
        -not $manager.email -or
        -not $manager.password
    ) {
        throw "SAFETY STOP: Warehouse manager credentials missing."
    }

    # 5. Authenticate.
    $loginBody = @{
        email = $manager.email
        password = $manager.password
    } | ConvertTo-Json

    $login = Invoke-RestMethod `
        -Uri "$api/auth/login" `
        -Method Post `
        -ContentType "application/json" `
        -Body $loginBody `
        -TimeoutSec 15

    $token = $login.accessToken

    if (-not $token) {
        $token = $login.access_token
    }

    Record-Result "Warehouse manager authentication" `
        (-not [string]::IsNullOrWhiteSpace($token)) `
        "JWT received in memory"

    $headers = @{
        Authorization = "Bearer $token"
    }

    # 6. Verify warehouse assignment.
    $locations = @(
        Invoke-RestMethod `
            -Uri "$api/inventory/locations" `
            -Headers $headers `
            -TimeoutSec 15
    )

    $assigned = @(
        $locations | Where-Object {
            $_.id -eq $locationId -and
            $_.code -eq "WH-KHI-01"
        }
    )

    Record-Result "Warehouse assignment" `
        ($assigned.Count -eq 1) `
        "WH-KHI-01 accessible"

    # 7. Verify clean fixture.
    $before = Get-FixtureState

    Record-Result "Fixture baseline" `
        (
            $before.OnHand -eq 0 -and
            $before.Version -eq 0 -and
            $before.Movements -eq 0 -and
            $before.Audits -eq 0
        ) `
        "Stock=0, version=0, movements=0, audits=0"

    # 8. Generate a unique idempotency key.
    $key = "M115-R15-" + [guid]::NewGuid().ToString("N")

    $body = @{
        locationId = $locationId
        variantId = $variantId
        delta = 10
        idempotencyKey = $key
        reason = "M115 controlled integration test"
    }

    # 9. Authorized adjustment.
    Write-Host "`nExecuting controlled +10 adjustment..."

    $first = Invoke-Adjustment -Body $body -Headers $headers

    Record-Result "Authorized adjustment HTTP" `
        ($first.Status -ge 200 -and $first.Status -lt 300) `
        "HTTP $($first.Status)"

    # 10. Verify state.
    $after = Get-FixtureState

    Record-Result "Stock adjustment atomicity" `
        (
            $after.OnHand -eq 10 -and
            $after.Version -eq 1 -and
            $after.Movements -eq 1 -and
            $after.Audits -eq 1
        ) `
        "Stock=$($after.OnHand), version=$($after.Version), movements=$($after.Movements), audits=$($after.Audits)"

    # 11. Repeat identical request.
    $repeat = Invoke-Adjustment -Body $body -Headers $headers

    Record-Result "Idempotent replay HTTP" `
        ($repeat.Status -ge 200 -and $repeat.Status -lt 300) `
        "HTTP $($repeat.Status)"

    $replayState = Get-FixtureState

    Record-Result "Idempotent replay state" `
        (
            $replayState.OnHand -eq 10 -and
            $replayState.Version -eq 1 -and
            $replayState.Movements -eq 1 -and
            $replayState.Audits -eq 1
        ) `
        "No duplicate adjustment"

    # 12. Conflicting idempotency key.
    $conflictBody = $body.Clone()
    $conflictBody.delta = 11

    $conflict = Invoke-Adjustment `
        -Body $conflictBody `
        -Headers $headers

    Record-Result "Conflicting idempotency key" `
        ($conflict.Status -eq 409) `
        "HTTP $($conflict.Status)"

    # 13. Insufficient stock.
    $negativeBody = $body.Clone()
    $negativeBody.delta = -100
    $negativeBody.idempotencyKey = `
        "M115-R15-" + [guid]::NewGuid().ToString("N")

    $negative = Invoke-Adjustment `
        -Body $negativeBody `
        -Headers $headers

    Record-Result "Insufficient stock rejection" `
        ($negative.Status -eq 409) `
        "HTTP $($negative.Status)"

    # 14. Final reconciliation.
    $final = Get-FixtureState

    Record-Result "Final fixture reconciliation" `
        (
            $final.OnHand -eq 10 -and
            $final.Version -eq 1 -and
            $final.Movements -eq 1 -and
            $final.Audits -eq 1
        ) `
        "All inventory assertions satisfied"

    Write-Host "`n=== R15-R3-R6 PASS ===" -ForegroundColor Green
}
catch {
    Write-Host "`n=== R15-R3-R6 STOPPED ===" -ForegroundColor Red
    Write-Host $_.Exception.Message
}
finally {
    $reportPath = Join-Path $reportDir `
        "M115_R15_R3_R6_RESULTS.csv"

    $results | Export-Csv `
        -Path $reportPath `
        -NoTypeInformation

    Write-Host "`nReport: $reportPath"
    Write-Host "Operational database modifications: NONE"
    Write-Host "QA database modifications: NONE"
    Write-Host "Pristine recovery database modifications: NONE"
    Write-Host "Production release: BLOCKED"
}
