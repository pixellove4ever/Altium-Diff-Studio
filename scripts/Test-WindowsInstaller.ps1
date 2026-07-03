$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $PSScriptRoot
$installer = Get-ChildItem -LiteralPath (Join-Path $workspace 'release') -Filter '*-unsigned.exe' |
	Sort-Object LastWriteTimeUtc -Descending |
	Select-Object -First 1

if (-not $installer) {
	throw 'No unsigned Windows installer found in release/. Run npm run dist:win first.'
}

$installDirectory = Join-Path $env:LOCALAPPDATA 'Programs\Altium Diff Studio'
$application = Join-Path $installDirectory 'Altium Diff Studio.exe'
$uninstaller = Join-Path $installDirectory 'Uninstall Altium Diff Studio.exe'

Write-Host "Installing $($installer.Name)"
$process = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $application)) {
	throw "Installer smoke test failed with exit code $($process.ExitCode)."
}

Write-Host 'Reinstalling the same package to exercise the update path'
$process = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $application)) {
	throw "Installer update smoke test failed with exit code $($process.ExitCode)."
}

if (-not (Test-Path -LiteralPath $uninstaller)) {
	throw 'The installer did not create its uninstaller.'
}

Write-Host 'Uninstalling'
$process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
if ($process.ExitCode -ne 0) {
	throw "Uninstaller smoke test failed with exit code $($process.ExitCode)."
}

Write-Host 'Windows installer smoke test passed.'
