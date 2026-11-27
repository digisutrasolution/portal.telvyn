<#
  INC-DB-001B — run the guarded E2E lane against an approved LOCAL disposable data plane only.
  Never targets 5432/5433/6379/6380.

  Profiles (explicit; each has fixed targets — there is no host/port/database override):
    local-isolated (default)  Compose project telvyn-ledger-dev:
                              PostgreSQL 127.0.0.1:5434 / telvyn_ledger_e2e, Redis 127.0.0.1:6381 db 0.
                              Credentials: gitignored .env.ledger-dev.roles.
    local-verify              Compose project telvyn-inc-db-001b-verify (docker-compose.local-verify.yml):
                              PostgreSQL 127.0.0.1:5435 / telvyn_safety_verify, Redis 127.0.0.1:6382 db 0.
                              Credentials + test-only app secrets: gitignored .env.inc-db-001b-verify.
    verify-clean              Compose project telvyn-verify-clean (docker-compose.verify-clean.yml), migrated
                              from an empty database (Phase 13-2B S5):
                              PostgreSQL 127.0.0.1:5436 / telvyn_clean_verify, Redis 127.0.0.1:6383 db 0.
                              Credentials + test-only app secrets: gitignored .env.verify-clean.

  Credentials are read from the profile's gitignored file and never printed. The wrapper
  sets TELVYN_E2E_PROFILE and the three target URLs, then runs
  `pnpm --filter @telvyn/api test:e2e`. The two-stage guard (Gate A pre-connection,
  Gate B post-connection identity, exclusive run lease) still decides; this wrapper is
  a convenience. Its exit code is the lane's exit code.

  Usage (from the repository root):
    powershell -File scripts/test/e2e-local.ps1 [-Profile local-verify] -Mark   # (re)apply Redis + DB instance markers
    powershell -File scripts/test/e2e-local.ps1 [-Profile local-verify]         # full guarded E2E lane
    powershell -File scripts/test/e2e-local.ps1 [-Profile local-verify] -Files test/auth.e2e.test.ts,test/authz.e2e.test.ts
#>
param(
  [ValidateSet('local-isolated', 'local-verify', 'verify-clean')][string]$Profile = 'local-isolated',
  [switch]$Mark,
  [string[]]$Files = @()
)
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo

function Read-KeyValueFile([string]$path) {
  if (-not (Test-Path $path)) { throw "ABORT: $path not found (see docs/DEVOPS.md)" }
  $kv = @{}
  Get-Content $path | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $k, $v = $_ -split '=', 2; $kv[$k] = $v.Trim('"') }
  return $kv
}

if ($Profile -eq 'local-isolated') {
  $kv = Read-KeyValueFile '.env.ledger-dev.roles'
  $app = $kv.APP_DATABASE_URL -replace '/telvyn_ledger_dev', '/telvyn_ledger_e2e'
  $fix = $kv.MIGRATOR_DATABASE_URL -replace '/telvyn_ledger_dev', '/telvyn_ledger_e2e'
  $pattern = '@127\.0\.0\.1:5434/telvyn_ledger_e2e(\?|$)'
  $redisUrl = 'redis://127.0.0.1:6381/0'
  $container = 'telvyn-ledger-dev-pg'; $admin = 'telvyn_ledger_admin'
  $dbName = 'telvyn_ledger_e2e'; $marker = 'telvyn-e2e/local-isolated'
} else {
  # Two disposable verification environments with fixed, non-overridable targets.
  if ($Profile -eq 'local-verify') {
    $envFile = '.env.inc-db-001b-verify'; $port = 5435; $dbName = 'telvyn_safety_verify'
    $redisUrl = 'redis://127.0.0.1:6382/0'; $container = 'telvyn-inc-db-001b-verify-pg'
    $marker = 'telvyn-inc-db-001b-local-verify'
  } else {
    $envFile = '.env.verify-clean'; $port = 5436; $dbName = 'telvyn_clean_verify'
    $redisUrl = 'redis://127.0.0.1:6383/0'; $container = 'telvyn-verify-clean-pg'
    $marker = 'telvyn-verify-clean'
  }
  $admin = 'telvyn'
  $kv = Read-KeyValueFile $envFile
  foreach ($k in 'MIGRATOR_PASSWORD', 'APP_PASSWORD') {
    if ($kv[$k] -notmatch '^[0-9a-f]{32,}$') { throw "ABORT: $k in $envFile must be a hex secret of at least 32 characters" }
  }
  $app = "postgresql://telvyn_app:$($kv.APP_PASSWORD)@127.0.0.1:$port/$dbName"
  $fix = "postgresql://telvyn_migrator:$($kv.MIGRATOR_PASSWORD)@127.0.0.1:$port/$dbName"
  $pattern = "@127\.0\.0\.1:$port/$dbName`$"
  # Test-only application secrets for the app under test (the worktree has no apps/api/.env;
  # CI sets fixed test values at job level). Random per environment; never printed.
  if ($kv.JWT_ACCESS_SECRET -notmatch '^[0-9a-f]{32,}$') { throw "ABORT: JWT_ACCESS_SECRET in $envFile must be a hex secret of at least 32 characters" }
  if ($kv.APP_ENCRYPTION_KEY -notmatch '^[A-Za-z0-9+/]{43}=$') { throw "ABORT: APP_ENCRYPTION_KEY in $envFile must be 32 bytes base64" }
  $env:JWT_ACCESS_SECRET = $kv.JWT_ACCESS_SECRET; $env:APP_ENCRYPTION_KEY = $kv.APP_ENCRYPTION_KEY; $env:COOKIE_SECURE = 'false'
}
foreach ($u in $app, $fix) {
  if ($u -notmatch $pattern) { throw "ABORT: derived URL is not the approved $Profile database target" }
}
$env:TELVYN_E2E_PROFILE = $Profile
$env:DATABASE_URL = $app
$env:E2E_FIXTURE_DATABASE_URL = $fix
$env:REDIS_URL = $redisUrl
$code = 1
try {
  if ($Mark) {
    # Gate A runs first (inside e2e:mark-redis) — no marker is written unless the
    # explicit profile and all three target URLs pass the allowlist.
    npx --yes pnpm@9.12.0 --filter @telvyn/api e2e:mark-redis 2>&1
    $redisCode = $LASTEXITCODE
    "redis marker exit: $redisCode"
    if ($redisCode -ne 0) {
      $code = $redisCode
    } else {
      Get-Content scripts/db/e2e-instance-marker.sql |
        docker exec -i $container psql -U $admin -d $dbName -q -v ON_ERROR_STOP=1 `
          -v db_name=$dbName -v marker=$marker -v ci_ephemeral=0 -f - 2>&1
      $code = $LASTEXITCODE
      "db marker exit: $code"
    }
  } else {
    if ($Files.Count -gt 0) { npx --yes pnpm@9.12.0 --filter @telvyn/api test:e2e @Files 2>&1 } else { npx --yes pnpm@9.12.0 --filter @telvyn/api test:e2e 2>&1 }
    $code = $LASTEXITCODE
    "e2e exit: $code"
  }
} finally {
  Remove-Item Env:TELVYN_E2E_PROFILE, Env:DATABASE_URL, Env:E2E_FIXTURE_DATABASE_URL, Env:REDIS_URL, Env:JWT_ACCESS_SECRET, Env:APP_ENCRYPTION_KEY, Env:COOKIE_SECURE -ErrorAction SilentlyContinue
}
# Propagate the lane's real result (a refused or failed run must not exit 0).
exit $code
