# startGateway.ps1 - Launch a gateway instance on Windows-native Node.js
# This avoids the WSL UDP relay limitation, making CoAP reachable by Docker containers.
#
# Usage:
#   .\startGateway.ps1              -> starts Org1 gateway (default)
#   .\startGateway.ps1 -Org org2    -> starts Org2 gateway
#   .\startGateway.ps1 -Org both    -> starts Org1 and Org2 in separate windows

param(
    [ValidateSet("org1", "org2", "both")]
    [string]$Org = "org1"
)

$config = @{
    org1 = @{
        FABRIC_ORG = "org1"
        FABRIC_MSP_ID = "Org1MSP"
        FABRIC_PEER_ENDPOINT = "localhost:7051"
        FABRIC_PEER_HOST = "peer0.org1.example.com"
        PORT = "3000"
        COAP_PORT = "5683"
    }
    org2 = @{
        FABRIC_ORG = "org2"
        FABRIC_MSP_ID = "Org2MSP"
        FABRIC_PEER_ENDPOINT = "localhost:9051"
        FABRIC_PEER_HOST = "peer0.org2.example.com"
        PORT = "3001"
        COAP_PORT = "5684"
    }
}

function Start-GatewayInstance {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("org1", "org2")]
        [string]$TargetOrg
    )

    $selected = $config[$TargetOrg]

    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  Starting Gateway - $($selected.FABRIC_MSP_ID)" -ForegroundColor Cyan
    Write-Host "  HTTP  :$($selected.PORT)  |  CoAP  :$($selected.COAP_PORT)" -ForegroundColor Cyan
    Write-Host "  Peer  $($selected.FABRIC_PEER_ENDPOINT)" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host ""

    foreach ($key in $selected.Keys) {
        [System.Environment]::SetEnvironmentVariable($key, $selected[$key], "Process")
    }

    Set-Location -Path $PSScriptRoot

    if (-not (Test-Path "node_modules")) {
        Write-Host "[*] Installing dependencies..." -ForegroundColor Yellow
        npm install
    }

    node src/app.js
}

if ($Org -eq "both") {
    $startScript = $PSCommandPath
    Start-Process powershell -WorkingDirectory $PSScriptRoot -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $startScript,
        "-Org", "org2"
    )

    Start-GatewayInstance -TargetOrg "org1"
} else {
    Start-GatewayInstance -TargetOrg $Org
}
