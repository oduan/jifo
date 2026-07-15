[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$androidDirectory = Split-Path -Parent $PSScriptRoot
$keystorePath = Join-Path $androidDirectory "jifo-release.jks"
$propertiesPath = Join-Path $androidDirectory "key.properties"

if (-not (Test-Path -LiteralPath $keystorePath -PathType Leaf)) {
    throw "Keystore not found: $keystorePath"
}

if (-not (Test-Path -LiteralPath $propertiesPath -PathType Leaf)) {
    throw "Signing properties not found: $propertiesPath"
}

$properties = @{}
foreach ($line in Get-Content -LiteralPath $propertiesPath) {
    $trimmedLine = $line.Trim()
    if (-not $trimmedLine -or $trimmedLine.StartsWith("#")) {
        continue
    }

    $parts = $trimmedLine -split "=", 2
    if ($parts.Count -eq 2) {
        $properties[$parts[0].Trim()] = $parts[1].Trim()
    }
}

foreach ($requiredProperty in @("storePassword", "keyAlias", "keyPassword")) {
    if (-not $properties.ContainsKey($requiredProperty) -or
        [string]::IsNullOrWhiteSpace($properties[$requiredProperty])) {
        throw "Missing required property '$requiredProperty' in $propertiesPath"
    }
}

$keystoreBase64 = [Convert]::ToBase64String(
    [IO.File]::ReadAllBytes($keystorePath)
)

Write-Warning "The output below contains release signing secrets. Do not share it or save it in Git."
Write-Output ""
Write-Output "GitHub Actions repository secrets:"
Write-Output "ANDROID_KEYSTORE_BASE64=$keystoreBase64"
Write-Output "ANDROID_KEYSTORE_PASSWORD=$($properties['storePassword'])"
Write-Output "ANDROID_KEY_ALIAS=$($properties['keyAlias'])"
Write-Output "ANDROID_KEY_PASSWORD=$($properties['keyPassword'])"
Write-Output ""
Write-Output "Files that must be backed up:"
Write-Output "- $keystorePath"
Write-Output "- $propertiesPath"
