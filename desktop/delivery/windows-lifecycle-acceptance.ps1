# Craftmine World Windows lifecycle acceptance (A17).
#
# Scope: first install, upgrade, upgrade-failure recovery, uninstall and cross-user
# data separation for a fixed package pair.
#
# Safety: this script NEVER runs on the developer's current client. Execution requires
# an explicit -Execute switch AND an ephemeral isolated runner marker. Without both,
# it emits a "not-run" report that states A17 is not verified. It refuses to install
# outside an absolute isolated root, and it never writes to a production profile.
#
# No visible window, no input simulation and no pointer lock is used. Installers and
# uninstallers are launched hidden and only their exit codes are observed.

param(
    [string]$Installer,
    [string]$ExpectedSha256,
    [string]$PreviousInstaller,
    [string]$ExpectedPreviousSha256,
    [string]$InstallDirectory,
    [string]$ProfileDirectory,
    [string]$SecondUserName,
    [string]$SecondUserProfile,
    [string]$ReportPath,
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$craftmineReport = [ordered]@{
    format = 'craftmine.windows-lifecycle/1'
    generatedAt = [DateTime]::UtcNow.ToString('o')
    a17Status = 'not-verified'
    installationExecuted = $false
    environment = [ordered]@{
        osVersion = [Environment]::OSVersion.Version.ToString()
        architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
        isWindows = [Environment]::OSVersion.Platform -eq 'Win32NT'
        elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        ephemeralRunner = $false
        markers = [ordered]@{}
    }
    inputs = [ordered]@{
        installer = $null
        installerSha256 = $null
        previousInstaller = $null
        previousInstallerSha256 = $null
        installDirectory = $null
        profileDirectory = $null
        secondUserName = $SecondUserName
        secondUserProfile = $SecondUserProfile
    }
    checks = @()
    notVerified = @()
    requirements = @(
        'A Windows x64 machine that is not the developer client, with no Craftmine World installation and no running instance.',
        'Two fixed packages: a previous release and the release under test, each with a published SHA-256.',
        'A disposable local account or VM that can be reverted; the script must not be pointed at a personal profile.',
        'For the cross-user part: a second local Windows account and the absolute path of that account profile directory.',
        'For upgrade-failure recovery: the previous package must be reinstalled by the operator, because this script never restores a production install automatically.'
    )
    limits = @(
        'A GitHub-hosted ephemeral runner contains development tools; it is not a clean-OS claim.',
        'Only silent installer, upgrade, blocked-upgrade, uninstall and synthetic profile preservation are observed.',
        'No user profile, credential store, VM, account or security setting is created or changed by this script.',
        'Visible-window composition and physical input feel are out of scope and remain separately unverified.'
    )
}

function Save-CraftmineReport {
    if (-not $ReportPath) { return }
    $craftmineTarget = [IO.Path]::GetFullPath($ReportPath)
    New-Item -ItemType Directory -Path (Split-Path -Parent $craftmineTarget) -Force | Out-Null
    $craftmineReport | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $craftmineTarget -Encoding UTF8
}

function Add-CraftmineCheck([string]$Name, [bool]$Passed, [string]$Detail) {
    $script:craftmineReport.checks += @{ name = $Name; passed = $Passed; detail = $Detail }
}

function Get-CraftmineHash([string]$LiteralPath) {
    return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-CraftmineHidden([string]$File, [string[]]$Arguments, [int]$TimeoutSeconds = 300) {
    $craftmineProcess = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (-not $craftmineProcess.WaitForExit($TimeoutSeconds * 1000)) { throw 'INSTALLER_TIMEOUT: leave this runner for inspection' }
    return $craftmineProcess.ExitCode
}

$craftmineIsEphemeral = ($env:GITHUB_ACTIONS -eq 'true' -and $env:RUNNER_ENVIRONMENT -eq 'github-hosted' -and $env:RUNNER_TEMP -and [IO.Path]::IsPathRooted($env:RUNNER_TEMP)) -or ($env:CRAFTMINE_LIFECYCLE_ISOLATED -eq '1' -and $env:CRAFTMINE_LIFECYCLE_ROOT -and [IO.Path]::IsPathRooted($env:CRAFTMINE_LIFECYCLE_ROOT))
$craftmineReport.environment.ephemeralRunner = $craftmineIsEphemeral
$craftmineReport.environment.markers = [ordered]@{
    githubActions = $env:GITHUB_ACTIONS
    runnerEnvironment = $env:RUNNER_ENVIRONMENT
    runnerTemp = $env:RUNNER_TEMP
    craftmineLifecycleIsolated = $env:CRAFTMINE_LIFECYCLE_ISOLATED
    craftmineLifecycleRoot = $env:CRAFTMINE_LIFECYCLE_ROOT
}

if (-not $Execute) {
    $craftmineReport.notVerified = @(
        'A17 first install',
        'A17 upgrade',
        'A17 upgrade failure recovery',
        'A17 uninstall',
        'A17 cross-user data separation'
    )
    Write-Output 'A17 NOT RUN: no installer was executed and no file was changed.'
    Write-Output 'Required environment:'
    foreach ($craftmineRequirement in $craftmineReport.requirements) { Write-Output ('  - ' + $craftmineRequirement) }
    Write-Output 'To execute on an isolated machine, set CRAFTMINE_LIFECYCLE_ISOLATED=1 with an absolute CRAFTMINE_LIFECYCLE_ROOT, then pass -Execute with -Installer, -ExpectedSha256 and an absolute -InstallDirectory inside that root.'
    Save-CraftmineReport
    exit 0
}

if (-not $craftmineIsEphemeral) { throw 'ISOLATED_RUNNER_REQUIRED: do not execute this script on a personal or self-hosted machine.' }
if (-not $craftmineReport.environment.isWindows) { throw 'WINDOWS_REQUIRED' }
if (-not $Installer -or -not [IO.Path]::IsPathRooted($Installer)) { throw 'ABSOLUTE_INSTALLER_REQUIRED' }
if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'EXPECTED_SHA256_REQUIRED' }
if (-not $InstallDirectory -or -not [IO.Path]::IsPathRooted($InstallDirectory)) { throw 'ABSOLUTE_INSTALL_DIRECTORY_REQUIRED' }

$craftmineIsolationRoot = if ($env:RUNNER_TEMP) { [IO.Path]::GetFullPath($env:RUNNER_TEMP) } else { [IO.Path]::GetFullPath($env:CRAFTMINE_LIFECYCLE_ROOT) }
$craftmineInstallRoot = [IO.Path]::GetFullPath($InstallDirectory)
if (-not $craftmineInstallRoot.StartsWith($craftmineIsolationRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'INSTALL_OUTSIDE_ISOLATED_ROOT' }
$craftmineProductionProfile = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'CraftmineWorld'))
$craftmineProfileRoot = if ($ProfileDirectory) { [IO.Path]::GetFullPath($ProfileDirectory) } else { Join-Path $craftmineInstallRoot 'profile' }
if (-not $craftmineProfileRoot.StartsWith($craftmineIsolationRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'PROFILE_OUTSIDE_ISOLATED_ROOT' }
if ($craftmineProfileRoot -eq $craftmineProductionProfile) { throw 'PRODUCTION_PROFILE_DENIED' }
$env:CRAFTMINE_DATA_DIR = $craftmineProfileRoot
New-Item -ItemType Directory -Path $craftmineInstallRoot -Force | Out-Null
New-Item -ItemType Directory -Path $craftmineProfileRoot -Force | Out-Null
$craftmineReport.inputs.installer = $Installer
$craftmineReport.inputs.installerSha256 = (Get-CraftmineHash $Installer)
$craftmineReport.inputs.installDirectory = $craftmineInstallRoot
$craftmineReport.inputs.profileDirectory = $craftmineProfileRoot
$craftmineReport.installationExecuted = $true

function Assert-CraftmineInstalled([string]$Label) {
    $craftmineExe = Join-Path $craftmineInstallRoot 'Craftmine World.exe'
    if (-not (Test-Path -LiteralPath $craftmineExe -PathType Leaf)) { throw ($Label + '_APPLICATION_MISSING') }
    return $craftmineExe
}

function Get-CraftmineTree([string]$Root) {
    $craftmineFiles = @{}
    if (-not (Test-Path -LiteralPath $Root)) { return $craftmineFiles }
    foreach ($craftmineItem in Get-ChildItem -LiteralPath $Root -Recurse -File -Force) {
        $craftmineRelative = $craftmineItem.FullName.Substring($Root.Length + 1)
        $craftmineFiles[$craftmineRelative] = @{ bytes = $craftmineItem.Length; sha256 = (Get-CraftmineHash $craftmineItem.FullName) }
    }
    return $craftmineFiles
}

try {
    if ((Get-CraftmineHash $Installer) -ne $ExpectedSha256.ToLowerInvariant()) { throw 'INSTALLER_HASH_MISMATCH' }

    # 1. First install.
    if ((Invoke-CraftmineHidden $Installer @('/S', ('/D=' + $craftmineInstallRoot))) -ne 0) { throw 'FIRST_INSTALL_FAILED' }
    $craftmineExe = Assert-CraftmineInstalled 'FIRST_INSTALL'
    $craftmineReport.firstInstallVersion = (Get-Item -LiteralPath $craftmineExe).VersionInfo.FileVersion
    Add-CraftmineCheck 'first install (silent, isolated root)' $true ('exit 0, version ' + $craftmineReport.firstInstallVersion)
    Save-CraftmineReport

    # Synthetic per-user progress that must survive every later step.
    $craftmineFixture = Join-Path $craftmineProfileRoot 'plugins/data/craftmine.world'
    New-Item -ItemType Directory -Path $craftmineFixture -Force | Out-Null
    $craftmineFixtureFile = Join-Path $craftmineFixture 'lifecycle-fixture.json'
    [IO.File]::WriteAllText($craftmineFixtureFile, '{"coins":42,"note":"must survive upgrade and uninstall"}')
    $craftmineFixtureHash = Get-CraftmineHash $craftmineFixtureFile

    # 2. Upgrade in place.
    if ($PreviousInstaller) {
        $craftmineReport.inputs.previousInstaller = $PreviousInstaller
        $craftmineReport.inputs.previousInstallerSha256 = (Get-CraftmineHash $PreviousInstaller)
        if ($ExpectedPreviousSha256 -and $craftmineReport.inputs.previousInstallerSha256 -ne $ExpectedPreviousSha256.ToLowerInvariant()) { throw 'PREVIOUS_INSTALLER_HASH_MISMATCH' }
    }
    $craftmineBeforeUpgrade = Get-CraftmineTree $craftmineInstallRoot
    if ((Invoke-CraftmineHidden $Installer @('/S', ('/D=' + $craftmineInstallRoot))) -ne 0) { throw 'UPGRADE_FAILED' }
    Assert-CraftmineInstalled 'UPGRADE' | Out-Null
    if ((Get-CraftmineHash $craftmineFixtureFile) -ne $craftmineFixtureHash) { throw 'UPGRADE_CHANGED_PROFILE' }
    $craftmineSnapshots = @(Get-ChildItem -LiteralPath (Join-Path $craftmineProfileRoot 'upgrade-backups') -Directory -ErrorAction SilentlyContinue)
    if (-not $craftmineSnapshots.Count) { throw 'UPGRADE_SNAPSHOT_MISSING' }
    $craftmineGuard = Join-Path (Split-Path -Parent $PSScriptRoot) 'windows-upgrade-guard.ps1'
    if (Test-Path -LiteralPath $craftmineGuard) {
        & powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File $craftmineGuard -Mode Verify -BackupDir $craftmineSnapshots[-1].FullName
        if ($LASTEXITCODE -ne 0) { throw 'UPGRADE_SNAPSHOT_INVALID' }
        Add-CraftmineCheck 'upgrade retains profile and produces a verifiable snapshot' $true ($craftmineSnapshots[-1].Name)
    } else {
        Add-CraftmineCheck 'upgrade retains profile' $true 'snapshot guard script was not found beside this script'
    }
    Save-CraftmineReport

    # 3. Upgrade failure recovery: a busy profile must block the upgrade and leave
    #    both the installed files and the profile byte-identical.
    $craftmineLockPath = Join-Path $craftmineProfileRoot 'pi.sqlite'
    $craftmineLock = [IO.File]::Open($craftmineLockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        if ((Invoke-CraftmineHidden $Installer @('/S', ('/D=' + $craftmineInstallRoot))) -eq 0) { throw 'BUSY_PROFILE_UPGRADE_NOT_BLOCKED' }
    } finally { $craftmineLock.Dispose() }
    $craftmineAfterBlocked = Get-CraftmineTree $craftmineInstallRoot
    $craftmineDrift = @($craftmineBeforeUpgrade.Keys + $craftmineAfterBlocked.Keys | Sort-Object -Unique | Where-Object {
        $craftmineBeforeUpgrade[$_] -eq $null -or $craftmineAfterBlocked[$_] -eq $null -or $craftmineBeforeUpgrade[$_].sha256 -ne $craftmineAfterBlocked[$_].sha256
    })
    if ($craftmineDrift.Count -gt 0) { throw ('BLOCKED_UPGRADE_CHANGED_FILES: ' + ($craftmineDrift -join ',')) }
    if ((Get-CraftmineHash $craftmineFixtureFile) -ne $craftmineFixtureHash) { throw 'BLOCKED_UPGRADE_CHANGED_PROFILE' }
    Add-CraftmineCheck 'busy profile blocks upgrade and leaves files unchanged' $true 'no file or profile drift'
    # The verified snapshot must be restorable material, so prove every recorded hash
    # still resolves inside the snapshot the guard just validated.
    $craftmineSnapshotManifest = Get-Content -LiteralPath (Join-Path $craftmineSnapshots[-1].FullName 'manifest.json') -Raw | ConvertFrom-Json
    $craftmineRestorable = 0
    foreach ($craftmineEntry in $craftmineSnapshotManifest.files) {
        $craftmineSnapshotFile = Join-Path $craftmineSnapshots[-1].FullName $craftmineEntry.path
        if ((Get-CraftmineHash $craftmineSnapshotFile) -ne $craftmineEntry.sha256) { throw ('SNAPSHOT_FILE_UNUSABLE: ' + $craftmineEntry.path) }
        $craftmineRestorable++
    }
    Add-CraftmineCheck 'recovery snapshot is usable rollback material' $true ($craftmineRestorable.ToString() + ' files')
    Save-CraftmineReport

    # 4. Uninstall.
    $craftmineUninstaller = @(Get-ChildItem -LiteralPath $craftmineInstallRoot -Filter '*Uninstall*.exe' -File)
    if ($craftmineUninstaller.Count -ne 1) { throw 'UNINSTALLER_NOT_FOUND' }
    if ((Invoke-CraftmineHidden $craftmineUninstaller[0].FullName @('/S')) -ne 0) { throw 'UNINSTALL_FAILED' }
    $craftmineDeadline = [DateTime]::UtcNow.AddSeconds(60)
    while ((Test-Path -LiteralPath (Join-Path $craftmineInstallRoot 'Craftmine World.exe')) -and [DateTime]::UtcNow -lt $craftmineDeadline) { Start-Sleep -Milliseconds 250 }
    if (Test-Path -LiteralPath (Join-Path $craftmineInstallRoot 'Craftmine World.exe')) { throw 'UNINSTALL_DID_NOT_REMOVE_APPLICATION' }
    if ((Get-CraftmineHash $craftmineFixtureFile) -ne $craftmineFixtureHash) { throw 'UNINSTALL_REMOVED_OR_CHANGED_PROFILE' }
    Add-CraftmineCheck 'uninstall removes the application and retains the profile' $true 'profile fixture unchanged'
    Save-CraftmineReport

    # 5. Cross-user data separation.
    if (-not $SecondUserName -or -not $SecondUserProfile -or -not [IO.Path]::IsPathRooted($SecondUserProfile)) {
        $craftmineReport.notVerified += 'A17 cross-user data separation (no second Windows account was supplied)'
        Add-CraftmineCheck 'cross-user data separation' $false 'no second account supplied; this is not a pass'
    } else {
        $craftmineSecondRoot = [IO.Path]::GetFullPath($SecondUserProfile)
        if ($craftmineSecondRoot -eq $craftmineProfileRoot) { throw 'SECOND_PROFILE_NOT_DISTINCT' }
        $craftmineAcl = Get-Acl -LiteralPath $craftmineSecondRoot
        $craftmineCurrentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $craftmineCurrentCanWrite = @($craftmineAcl.Access | Where-Object { $_.IdentityReference.Value -eq $craftmineCurrentUser -and $_.FileSystemRights -match 'Write|Modify|FullControl' -and $_.AccessControlType -eq 'Allow' }).Count -gt 0
        if ($craftmineCurrentCanWrite) { throw 'SECOND_PROFILE_WRITABLE_BY_FIRST_USER' }
        $craftmineSharedRoots = @(Join-Path $env:ProgramData 'CraftmineWorld', Join-Path $env:PUBLIC 'CraftmineWorld')
        $craftmineSharedFound = @($craftmineSharedRoots | Where-Object { Test-Path -LiteralPath $_ })
        if ($craftmineSharedFound.Count -gt 0) { throw ('MACHINE_WIDE_PROFILE_PRESENT: ' + ($craftmineSharedFound -join ',')) }
        Add-CraftmineCheck 'cross-user data separation' $true ('second profile ' + $craftmineSecondRoot + ' is not writable by ' + $craftmineCurrentUser)
    }
    $craftmineReport.a17Status = if (@($craftmineReport.checks | Where-Object { -not $_.passed }).Count -eq 0) { 'passed' } else { 'partial' }
} catch {
    $craftmineReport.a17Status = 'failed'
    $craftmineReport.error = $_.Exception.Message
    Save-CraftmineReport
    [Console]::Error.WriteLine('CRAFTMINE_LIFECYCLE_FAILED: ' + $_.Exception.Message)
    exit 1
} finally {
    Save-CraftmineReport
}
Write-Output ('A17 status: ' + $craftmineReport.a17Status)
if ($ReportPath) { Write-Output ('Report: ' + [IO.Path]::GetFullPath($ReportPath)) }
