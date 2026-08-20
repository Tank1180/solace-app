[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$ResourceGroup = "solace-sandbox-rg",
  [string]$WebAppName = "Solice-test",
  [string]$Subscription = "",
  [string]$HealthUrl = "https://solice-test-f5f4gtdcb9f8a6h4.westus2-01.azurewebsites.net/api/health",
  [string]$ZipPath = "",
  [switch]$SkipBuild,
  [switch]$SkipRestart,
  [switch]$SkipHealthCheck
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedZipPath = if ($ZipPath) { $ZipPath } else { Join-Path $projectRoot "solace-deploy.zip" }

Write-Host "Project root: $projectRoot"

if ($Subscription) {
  Write-Host "Setting Azure subscription to $Subscription"
  az account set --subscription $Subscription
}

if (-not $SkipBuild) {
  Write-Host "Building client app..."
  Push-Location $projectRoot
  try {
    npm run build
  } finally {
    Pop-Location
  }
}

if (Test-Path $resolvedZipPath) {
  Remove-Item $resolvedZipPath -Force
}

Write-Host "Creating deployment zip at $resolvedZipPath"
tar.exe -a -c -f $resolvedZipPath `
  --exclude client/node_modules `
  --exclude server/node_modules `
  --exclude server/finance.db `
  --exclude server/finance.db-shm `
  --exclude server/finance.db-wal `
  -C $projectRoot .

if (-not (Test-Path $resolvedZipPath)) {
  throw "Deployment zip was not created: $resolvedZipPath"
}

if ($PSCmdlet.ShouldProcess($WebAppName, "Deploy Azure App Service package")) {
  Write-Host "Deploying to Azure Web App $WebAppName in $ResourceGroup"
  az webapp deploy `
    --resource-group $ResourceGroup `
    --name $WebAppName `
    --src-path $resolvedZipPath `
    --type zip
}

if (-not $SkipRestart) {
  Write-Host "Restarting Azure Web App..."
  az webapp restart `
    --resource-group $ResourceGroup `
    --name $WebAppName
}

if (-not $SkipHealthCheck -and $HealthUrl) {
  Write-Host "Checking health endpoint..."
  Start-Sleep -Seconds 5
  $response = Invoke-WebRequest -UseBasicParsing $HealthUrl
  Write-Host "Health check returned $($response.StatusCode)"
  Write-Output $response.Content
}
