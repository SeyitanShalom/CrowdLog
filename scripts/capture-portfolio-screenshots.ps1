param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$ApiHealthUrl = "http://localhost:4000/health",
  [string]$OutDir = "docs/screenshots",
  [string]$ProfileDir = ".portfolio-chrome-profile",
  [string]$ChromePath = "",
  [switch]$PrepareProfile,
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ResolvedOutDir = Join-Path $RepoRoot $OutDir
$ResolvedProfileDir = Join-Path $RepoRoot $ProfileDir

function Resolve-ChromePath {
  if ($ChromePath -and (Test-Path $ChromePath)) {
    return $ChromePath
  }

  $Candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )

  foreach ($Candidate in $Candidates) {
    if ($Candidate -and (Test-Path $Candidate)) {
      return $Candidate
    }
  }

  throw "Chrome or Edge was not found. Pass -ChromePath with a browser executable."
}

function Get-CaptureUrl([string]$Hash) {
  $Separator = if ($BaseUrl.Contains("?")) { "&" } else { "?" }

  return "$BaseUrl${Separator}portfolioDemo=1#$Hash"
}

function Test-HttpUrl([string]$Url, [string]$Label) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 10 | Out-Null
  } catch {
    throw "$Label is not reachable at $Url. Start the API and frontend before running this script."
  }
}

$BrowserPath = Resolve-ChromePath

if ($CheckOnly) {
  Write-Host "Browser: $BrowserPath"
  Write-Host "Output: $ResolvedOutDir"
  Write-Host "Profile: $ResolvedProfileDir"
  Write-Host "Frontend: $BaseUrl"
  Write-Host "API health: $ApiHealthUrl"
  exit 0
}

New-Item -ItemType Directory -Force -Path $ResolvedProfileDir | Out-Null
New-Item -ItemType Directory -Force -Path $ResolvedOutDir | Out-Null

Test-HttpUrl $ApiHealthUrl "CrowdLog API"
Test-HttpUrl $BaseUrl "CrowdLog web app"

if ($PrepareProfile) {
  $Url = Get-CaptureUrl "portfolio-review-workspace"

  Write-Host "Opening Chrome profile for portfolio sign-in."
  Write-Host "Sign in as owner.demo@crowdlog.local, confirm the demo event loads, then close Chrome."
  Start-Process -FilePath $BrowserPath -ArgumentList @(
    "--user-data-dir=$ResolvedProfileDir",
    "--no-first-run",
    "--new-window",
    $Url
  )
  exit 0
}

$Shots = @(
  @{ File = "01-template-builder.png"; Hash = "portfolio-template-builder" },
  @{ File = "02-document-extraction.png"; Hash = "portfolio-document-extraction" },
  @{ File = "03-review-workspace.png"; Hash = "portfolio-review-workspace" },
  @{ File = "04-reporting-panels.png"; Hash = "portfolio-reporting-panels" },
  @{ File = "05-export-actions.png"; Hash = "portfolio-export-actions" }
)

foreach ($Shot in $Shots) {
  $OutFile = Join-Path $ResolvedOutDir $Shot.File
  $Url = Get-CaptureUrl $Shot.Hash

  Write-Host "Capturing $($Shot.File)"
  & $BrowserPath @(
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--window-size=1440,1000",
    "--virtual-time-budget=10000",
    "--user-data-dir=$ResolvedProfileDir",
    "--screenshot=$OutFile",
    $Url
  )

  if ($LASTEXITCODE -ne 0) {
    throw "Browser screenshot command failed for $($Shot.File)."
  }

  if (!(Test-Path $OutFile)) {
    throw "Expected screenshot was not created: $OutFile"
  }
}

Write-Host "Portfolio screenshots saved to $ResolvedOutDir"
