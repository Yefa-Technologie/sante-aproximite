<#
.SYNOPSIS
  Genere l'APK Android de Sante Aproximite avec EAS Build (serveurs Expo) et le telecharge.

.DESCRIPTION
  - verifie la connexion au compte Expo (eas login si besoin)
  - lance la compilation (profil "production" par defaut : API http://193.168.173.181:8081/api)
  - reessaie automatiquement si l'envoi du projet echoue (erreurs 5xx d'Expo)
  - attend la fin de la compilation puis telecharge l'APK dans le dossier apk/
  - peut installer l'APK sur un appareil Android branche en USB (-Install)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1 -Install
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1 -Profile preview
#>
param(
  [ValidateSet("production", "preview")]
  [string]$Profile = "production",
  [switch]$Install,
  [int]$MaxAttempts = 3,
  [string]$OutDir = ""
)

# "Continue" : les outils (npx, eas) ecrivent des avis sur la sortie d'erreur (ex. "eas-cli x.y is now
# available") que Windows PowerShell 5.1 transformerait en erreurs fatales. On se fie a $LASTEXITCODE.
$ErrorActionPreference = "Continue"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$MobileDir = Join-Path $RepoRoot "mobile"
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot "apk" }

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "ERREUR : $text" -ForegroundColor Red; exit 1 }

if (-not (Test-Path (Join-Path $MobileDir "eas.json"))) { Fail "mobile/eas.json introuvable ($MobileDir)." }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { Fail "Node.js / npx n'est pas installe." }

Push-Location $MobileDir
try {
  # Garantit que "npx eas-cli" utilise la version du projet si elle est installee.
  if (-not (Test-Path "node_modules")) {
    Step "Installation des dependances mobiles (npm ci)"
    npm ci
    if ($LASTEXITCODE -ne 0) { Fail "npm ci a echoue." }
  }

  Step "Verification du compte Expo"
  # Sortie lue en entier avant filtrage : couper le flux (Select -First) fausserait $LASTEXITCODE.
  $whoami = @(npx --yes eas-cli whoami 2>$null)
  $whoamiExit = $LASTEXITCODE
  $account = $whoami | Where-Object { $_ -is [string] -and $_.Trim() } | Select-Object -First 1
  if ($whoamiExit -ne 0 -or -not $account -or $account -match "Not logged in") {
    Write-Host "Aucune session Expo : connexion requise."
    npx --yes eas-cli login
    if ($LASTEXITCODE -ne 0) { Fail "Connexion Expo impossible." }
    $account = @(npx --yes eas-cli whoami 2>$null) | Where-Object { $_ -is [string] -and $_.Trim() } | Select-Object -First 1
  }
  Write-Host "Compte Expo : $account"

  Step "Compilation Android (profil $Profile) sur EAS - cela prend en general 10 a 30 minutes"
  $build = $null
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Write-Host "Tentative $attempt / $MaxAttempts..."
    # --wait : attend la fin ; --json : resultat exploitable (lien de l'APK).
    $raw = npx --yes eas-cli build --platform android --profile $Profile --non-interactive --wait --json 2>&1
    $jsonText = ($raw | Where-Object { $_ -is [string] -or $_ -isnot [System.Management.Automation.ErrorRecord] } | Out-String)
    $start = $jsonText.IndexOf("[")
    if ($LASTEXITCODE -eq 0 -and $start -ge 0) {
      try { $build = ($jsonText.Substring($start) | ConvertFrom-Json)[0] } catch { $build = $null }
    }
    if ($build) { break }

    $errorText = ($raw | Out-String)
    Write-Host ($errorText.Trim().Split("`n") | Select-Object -Last 8 | Out-String) -ForegroundColor Yellow
    if ($errorText -match "(50[0-9]|Bad Gateway|timeout|ECONNRESET|socket hang up)" -and $attempt -lt $MaxAttempts) {
      Write-Host "Erreur reseau/serveur Expo : nouvel essai dans 30 s..." -ForegroundColor Yellow
      Start-Sleep -Seconds 30
      continue
    }
    Fail "La compilation a echoue. Consultez les journaux sur https://expo.dev"
  }
  if (-not $build) { Fail "Aucune compilation n'a abouti apres $MaxAttempts tentatives." }

  if ($build.status -ne "FINISHED") { Fail "Compilation terminee avec le statut $($build.status). Journaux : https://expo.dev" }
  $apkUrl = $build.artifacts.buildUrl
  if (-not $apkUrl) { $apkUrl = $build.artifacts.applicationArchiveUrl }
  if (-not $apkUrl) { Fail "Lien de l'APK introuvable dans la reponse EAS." }

  Step "Telechargement de l'APK"
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $version = $build.appVersion
  $code = $build.appBuildVersion
  $stamp = Get-Date -Format "yyyyMMdd-HHmm"
  $apkPath = Join-Path $OutDir "sante-aproximite-$Profile-v$version-$code-$stamp.apk"
  try {
    Invoke-WebRequest -Uri $apkUrl -OutFile $apkPath -UseBasicParsing -ErrorAction Stop
  } catch {
    Fail "Telechargement impossible : $($_.Exception.Message). Lien : $apkUrl"
  }
  $sizeMb = [math]::Round((Get-Item $apkPath).Length / 1MB, 1)
  Write-Host "APK : $apkPath ($sizeMb Mo)" -ForegroundColor Green
  Write-Host "Lien de telechargement : $apkUrl"

  if ($Install) {
    Step "Installation sur l'appareil USB"
    $adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
    if (-not (Test-Path $adb)) { $adb = (Get-Command adb -ErrorAction SilentlyContinue).Source }
    if (-not $adb) { Fail "adb introuvable (Android SDK platform-tools)." }
    $devices = & $adb devices | Select-String "`tdevice$"
    if (-not $devices) { Fail "Aucun appareil Android autorise n'est branche." }
    & $adb install -r $apkPath
    if ($LASTEXITCODE -ne 0) { Fail "Installation adb echouee (desinstallez l'ancienne version si la signature differe)." }
    Write-Host "Application installee." -ForegroundColor Green
  }

  Step "Termine"
}
finally {
  Pop-Location
}
