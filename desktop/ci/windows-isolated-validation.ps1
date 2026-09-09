param(
    [string]$Installer,
    [string]$ExpectedSha256,
    [switch]$Execute
)
$ErrorActionPreference = 'Stop'
$craftmineCiAllowed = $env:GITHUB_ACTIONS -eq 'true' -and $env:RUNNER_ENVIRONMENT -eq 'github-hosted' -and $env:RUNNER_TEMP -and [IO.Path]::IsPathRooted($env:RUNNER_TEMP)
if (-not $Execute) {
    @{format='craftmine.windows-isolated-validation/1';status='not-run';isolatedRunnerAllowed=[bool]$craftmineCiAllowed;installationExecuted=$false;cleanWindowsVerified=$false;reason='Explicit Execute and an ephemeral GitHub-hosted Windows runner are required.'} | ConvertTo-Json
    exit 0
}
if (-not $craftmineCiAllowed) { throw 'ISOLATED_RUNNER_REQUIRED: Do not execute on a personal or self-hosted machine.' }
if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'WINDOWS_REQUIRED' }
if (-not $Installer -or -not [IO.Path]::IsPathRooted($Installer) -or $ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'EXPLICIT_PACKAGE_AND_HASH_REQUIRED' }
$craftmineInstaller = (Resolve-Path -LiteralPath $Installer).Path
if ((Get-FileHash -LiteralPath $craftmineInstaller -Algorithm SHA256).Hash -ne $ExpectedSha256) { throw 'INSTALLER_HASH_MISMATCH' }
$craftmineRoot = [IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP ('craftmine-ci-'+[Guid]::NewGuid().ToString('N'))))
if (-not $craftmineRoot.StartsWith([IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'CI_PATH_ESCAPE' }
New-Item -ItemType Directory -Path $craftmineRoot | Out-Null
$craftmineInstall = Join-Path $craftmineRoot 'application'
$craftmineProfile = Join-Path $craftmineRoot 'profile'
$env:CRAFTMINE_DATA_DIR = $craftmineProfile
$craftmineReport = [ordered]@{format='craftmine.windows-isolated-validation/1';installerSha256=$ExpectedSha256.ToLower();status='running';checks=@();installationExecuted=$false;cleanWindowsVerified=$false;limits=@('Ephemeral Windows CI contains development tools; this is not a clean OS claim.','Only silent installer/upgrade/uninstall and synthetic profile preservation are tested.','No user profile, VM download, account creation or security setting changes.')}
function Save-Report { $craftmineReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $craftmineRoot 'report.json') -Encoding utf8 }
function Run-Hidden([string]$File,[string[]]$Arguments) {
    $craftmineProcess=Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (-not $craftmineProcess.WaitForExit(120000)) { throw 'CI_INSTALLER_TIMEOUT: Leave this isolated runner for forensic inspection.' }
    return $craftmineProcess.ExitCode
}
try {
    $craftmineReport.installationExecuted=$true
    if ((Run-Hidden $craftmineInstaller @('/S',"/D=$craftmineInstall")) -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $craftmineInstall 'Craftmine World.exe'))) { throw 'FIRST_INSTALL_FAILED' }
    $craftmineReport.checks+=@{name='silent first install';passed=$true};Save-Report
    $craftmineFixture=Join-Path $craftmineProfile 'plugins/data/craftmine.world'
    New-Item -ItemType Directory -Path $craftmineFixture -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $craftmineFixture 'upgrade-fixture.json'),'synthetic retained content')
    if ((Run-Hidden $craftmineInstaller @('/S',"/D=$craftmineInstall")) -ne 0) { throw 'UPGRADE_FAILED' }
    if ([IO.File]::ReadAllText((Join-Path $craftmineFixture 'upgrade-fixture.json')) -ne 'synthetic retained content') { throw 'PROFILE_CHANGED' }
    $craftmineBackups=@(Get-ChildItem -LiteralPath (Join-Path $craftmineProfile 'upgrade-backups') -Directory)
    if ($craftmineBackups.Count -lt 1) { throw 'UPGRADE_SNAPSHOT_MISSING' }
    $craftmineGuard=Join-Path (Split-Path -Parent $PSScriptRoot) 'windows-upgrade-guard.ps1'
    & powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File $craftmineGuard -Mode Verify -BackupDir $craftmineBackups[-1].FullName
    if ($LASTEXITCODE -ne 0) { throw 'UPGRADE_SNAPSHOT_INVALID' }
    $craftmineReport.checks+=@{name='silent upgrade retains synthetic profile and valid snapshot';passed=$true};Save-Report
    $craftmineLockPath=Join-Path $craftmineProfile 'pi.sqlite'
    $craftmineInstalledHash=(Get-FileHash -LiteralPath (Join-Path $craftmineInstall 'Craftmine World.exe') -Algorithm SHA256).Hash
    $craftmineLock=[IO.File]::Open($craftmineLockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try { if ((Run-Hidden $craftmineInstaller @('/S',"/D=$craftmineInstall")) -eq 0) { throw 'BUSY_PROFILE_UPGRADE_NOT_BLOCKED' } }
    finally { $craftmineLock.Dispose() }
    if ((Get-FileHash -LiteralPath (Join-Path $craftmineInstall 'Craftmine World.exe') -Algorithm SHA256).Hash -ne $craftmineInstalledHash -or [IO.File]::ReadAllText((Join-Path $craftmineFixture 'upgrade-fixture.json')) -ne 'synthetic retained content') { throw 'FAILED_UPGRADE_CHANGED_EXISTING_FILES' }
    $craftmineReport.checks+=@{name='busy synthetic profile blocks silent upgrade';passed=$true};Save-Report
    $craftmineUninstaller=@(Get-ChildItem -LiteralPath $craftmineInstall -Filter '*Uninstall*.exe' -File)
    if ($craftmineUninstaller.Count -ne 1) { throw 'UNINSTALLER_NOT_FOUND' }
    if ((Run-Hidden $craftmineUninstaller[0].FullName @('/S')) -ne 0) { throw 'UNINSTALL_FAILED' }
    $craftmineUntil=[DateTime]::UtcNow.AddSeconds(30)
    while ((Test-Path -LiteralPath (Join-Path $craftmineInstall 'Craftmine World.exe')) -and [DateTime]::UtcNow -lt $craftmineUntil) { Start-Sleep -Milliseconds 200 }
    if (Test-Path -LiteralPath (Join-Path $craftmineInstall 'Craftmine World.exe')) { throw 'UNINSTALL_DID_NOT_REMOVE_APPLICATION' }
    if (-not (Test-Path -LiteralPath (Join-Path $craftmineFixture 'upgrade-fixture.json'))) { throw 'UNINSTALL_REMOVED_PROFILE' }
    $craftmineReport.checks+=@{name='silent uninstall retains synthetic profile';passed=$true}
    $craftmineReport.status='passed'
} catch { $craftmineReport.status='failed';$craftmineReport.error=$_.Exception.Message;throw }
finally { Save-Report; Write-Output ('Isolated validation report: '+(Join-Path $craftmineRoot 'report.json')) }
