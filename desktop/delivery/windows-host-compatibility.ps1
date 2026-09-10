[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PlanPath,
    [switch]$Execute,
    [switch]$HostCompatibilityAuthorized
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'lib/windows-host-compatibility.ps1')
$plan=Read-CmHostPlan $PlanPath
if(-not $Execute){
    [ordered]@{format='craftmine.windows-host-compatibility/1';status='NOT_RUN';environment='host-compatibility';a17='NOT_VERIFIED';plan=$plan;requiresExplicitExecute=$true;installerInvocations=0}|ConvertTo-Json -Depth 12
    exit 0
}
if(-not $HostCompatibilityAuthorized){throw 'EXPLICIT_HOST_COMPATIBILITY_AUTHORIZATION_REQUIRED'}
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'WINDOWS_REQUIRED'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
try{if(([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'NON_ELEVATED_CURRENT_USER_REQUIRED'}}finally{$identity.Dispose()}
# Verify the required Windows PowerShell 5.1 cmdlets are the system ones before
# creating the owned root: an inherited PSModulePath can shadow the Utility
# module with a trimmed copy that lacks Get-FileHash. Nothing is created yet.
Assert-CmHostTooling
Assert-CmNoLinks $plan.root
if(Test-Path -LiteralPath $plan.root){throw 'NEW_OWNED_ROOT_REQUIRED'}
# Only a new private D root is created before input/collision checks; even the
# C# compiler uses this root's TEMP. No installer runs until every check passes.
$installerCache=Get-CmInstallerCacheRoot
$rootItem=New-Item -ItemType Directory -Path $plan.root -ErrorAction Stop
$context=@{plan=$plan;root=$rootItem.FullName;install=(Join-Path $plan.root 'install');profile=(Join-Path $plan.root 'profile');temp=(Join-Path $plan.root 'temp');installerCache=$installerCache;token=[Guid]::NewGuid().ToString('N')}
# Leave profile absent through the first installer, so the old guard cannot
# create an empty-profile backup before the controlled synthetic seed exists.
foreach($part in @('temp','evidence')){New-Item -ItemType Directory -Path (Join-Path $context.root $part) -ErrorAction Stop|Out-Null}
$report=[ordered]@{format='craftmine.windows-host-compatibility/1';environment='host-compatibility';a17='NOT_VERIFIED';status='RUNNING';passed=$false;startedAt=[DateTime]::UtcNow.ToString('o');plan=$plan;steps=@();invocations=@();limitations=@('Personal host; not clean-OS, VM, ephemeral or CI acceptance.','No application launch, GUI play, model request, cross-user, reboot, signing or performance validation.','NSIS 26.15.3 has no runtime no-start-menu flag. Only the initially absent current-user Craftmine shortcut may be created and removed by its own uninstaller.','Process prechecks cannot exclude a user concurrently launching an existing client after the check. NSIS CHECK_APP_RUNNING can terminate a matching process. Keep other Craftmine launches stopped during this finite run.','Private non-input desktop prevents installer BringToFront from targeting the current input desktop; owned windowless helpers validated desktop inheritance and bounded cleanup, while installer-specific behavior still requires this actual run.','On failure, preserve partial owned install, registrations and all evidence; no automatic cleanup or retry.')}
$reportPath=Join-Path $context.root 'evidence/report.json'
$report.installerCache=@{path=$installerCache;location='real-current-user-LocalApplicationData';initiallyAbsent=$true;retainedAfterUninstall=$true}
$report.limitations+='NSIS writes its exact current-user installer cache outside D. An existing cache directory is a collision; only this run-created cache may be overwritten by the approved next installer. Remaining owned cache is recorded and retained, never silently deleted.'
function Save-CmHostReport { $report|ConvertTo-Json -Depth 24|Set-Content -LiteralPath $reportPath -Encoding UTF8 }
$marker=[ordered]@{format='craftmine.windows-host-owner/1';root=$context.root;install=$context.install;profile=$context.profile;token=$context.token;previousInstallerSha256=$plan.previous.installerSha256;nextInstallerSha256=$plan.next.installerSha256}
$markerPath=Join-Path $context.root 'host-compatibility-owner.json'
$marker|ConvertTo-Json|Set-Content -LiteralPath $markerPath -Encoding UTF8
function Assert-CmOwnership {
    Assert-CmNoLinks $context.root
    if((Get-CmHash $markerPath) -cne $context.markerHash){throw 'OWNED_ROOT_MARKER_CHANGED'}
    if([IO.Path]::GetFullPath($context.install) -cne (Join-Path $context.root 'install')){throw 'INSTALL_ROOT_CHANGED'}
}
function Invoke-CmOwnedInstaller([string]$File,[string]$ExpectedHash,[string]$Arguments) {
    Assert-CmOwnership
    if((Get-CmHash $File) -cne $ExpectedHash){throw 'LAUNCH_FILE_HASH_CHANGED'}
    Assert-CmNoProcesses $context.install
    # Deny replacement of the approved executable until all its job processes exit.
    # The owned uninstaller must be able to remove its own original executable.
    $share=if($File -ieq (Join-Path $context.install 'Uninstall craftmine world.exe')){[IO.FileShare]::Read -bor [IO.FileShare]::Delete}else{[IO.FileShare]::Read}
    $pin=[IO.File]::Open($File,[IO.FileMode]::Open,[IO.FileAccess]::Read,$share)
    $invocation=@{file=$File;sha256=$ExpectedHash;arguments=$Arguments;startedAt=[DateTime]::UtcNow.ToString('o')}
    $report.invocations+= $invocation;Save-CmHostReport
    try{
        $result=[CraftmineHostProcess]::Run($File,$Arguments,$context.temp,900)
        $invocation.result=$result;Save-CmHostReport
        Assert-CmHostProcessResult $result
        return $result
    }catch{
        $invocation.error=$_.Exception.Message;Save-CmHostReport;throw
    }finally{$pin.Dispose()}
}
function Invoke-CmSetup($Part){return Invoke-CmOwnedInstaller $Part.installer $Part.installerSha256 ('/S /currentuser --no-desktop-shortcut /D='+$context.install)}
function Assert-CmZero($Result){if($null -eq $Result.RootExitCode -or $Result.RootExitCode -ne 0){throw ('INSTALLER_ROOT_EXIT_'+$Result.RootExitCode)}}
function Assert-CmSameRegistration($Before,$After){if(($Before|ConvertTo-Json -Depth 12 -Compress) -cne ($After|ConvertTo-Json -Depth 12 -Compress)){throw 'REGISTRY_OR_SHORTCUT_CHANGED'}}
$actions=@{
    preflight={param($c) Assert-CmOwnership;Assert-CmCleanHost (Get-CmRegistry) (Get-CmShortcuts);Assert-CmAbsentInstallerCache $c.installerCache;Assert-CmNoProcesses $c.install;@{registryAbsent=$true;shortcutsAbsent=$true;installerCacheAbsent=$true;inputDesktopUntouched=$true}}
    installPrevious={param($c) $r=Invoke-CmSetup $c.plan.previous;Assert-CmZero $r;$r}
    verifyPrevious={param($c) $c.oldInstalled=Assert-CmInstalled $c.plan.previous $c.previousPayload $c.install;$c.oldCache=Assert-CmOwnedInstallerCache $c.installerCache $c.plan.previous.installerSha256;@{commit=$c.plan.previous.commit;payloadDigest=(Get-CmTreeDigest $c.oldInstalled);cache=$c.oldCache}}
    seed={param($c)
        $empty=Get-CmTree $c.profile;if($empty.Count){throw 'SYNTHETIC_PROFILE_NOT_EMPTY'}
        if(Test-Path -LiteralPath $c.profile){throw 'FIRST_INSTALL_UNEXPECTEDLY_CREATED_PROFILE'}
        New-Item -ItemType Directory -Path $c.profile -ErrorAction Stop|Out-Null
        $fixture=Join-Path $PSScriptRoot 'fixtures/host-synthetic.sqlite.b64';$bytes=[Convert]::FromBase64String((Get-Content -LiteralPath $fixture -Raw))
        [IO.File]::WriteAllBytes((Join-Path $c.profile 'pi.sqlite'),$bytes)
        $domain=Join-Path $c.profile 'plugins/data/craftmine.world';New-Item -ItemType Directory -Path $domain -Force|Out-Null
        [IO.File]::WriteAllText((Join-Path $domain 'host-compatibility.json'),'{"format":"synthetic-host-compatibility/1","note":"preserve"}',[Text.UTF8Encoding]::new($false))
        $c.seed=Get-CmTree $c.profile;@{fixtureSha256=(Get-CmHash $fixture);files=$c.seed}
    }
    upgradeToNext={param($c)
        Assert-CmTreeEqual $c.oldInstalled (Get-CmTree $c.install) 'OLD_INSTALL_CHANGED'
        Assert-CmTreeEqual $c.oldCache (Get-CmTree $c.installerCache) 'OLD_CACHE_CHANGED'
        Assert-CmOwnedRegistration (Get-CmRegistry) $c.install;Assert-CmOwnedShortcuts (Get-CmShortcuts) $c.install
        $r=Invoke-CmSetup $c.plan.next;Assert-CmZero $r;$r
    }
    verifyNextAndBackup={param($c)
        $c.newInstalled=Assert-CmInstalled $c.plan.next $c.nextPayload $c.install
        $c.newCache=Assert-CmOwnedInstallerCache $c.installerCache $c.plan.next.installerSha256
        $backup=Assert-CmBackup $c.profile $c.seed $c.plan.next.version
        @{previousCommit=$c.plan.previous.commit;nextCommit=$c.plan.next.commit;newPayloadDigest=(Get-CmTreeDigest $c.newInstalled);backup=$backup;cache=$c.newCache}
    }
    baseline={param($c) $c.profileBaseline=Get-CmTree $c.profile;$c.profileDirectories=Get-CmDirectories $c.profile;$c.installDirectories=Get-CmDirectories $c.install;$c.registryBaseline=Get-CmRegistry;$c.shortcutsBaseline=Get-CmShortcuts;@{installed=$c.newInstalled;profile=$c.profileBaseline;profileDirectories=$c.profileDirectories;installDirectories=$c.installDirectories;registry=$c.registryBaseline;shortcuts=$c.shortcutsBaseline}}
    busyUpgrade={param($c)
        Assert-CmOwnedRegistration (Get-CmRegistry) $c.install;Assert-CmOwnedShortcuts (Get-CmShortcuts) $c.install
        $lock=[IO.File]::Open((Join-Path $c.profile 'pi.sqlite'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        try{$r=Invoke-CmSetup $c.plan.next;if($r.RootExitCode -ne 2){throw ('EXPECTED_UPGRADE_GUARD_ROOT_EXIT_2_ACTUAL_'+$r.RootExitCode)};$r}finally{$lock.Dispose()}
    }
    verifyUnchanged={param($c)
        Assert-CmTreeEqual $c.newInstalled (Get-CmTree $c.install) 'BUSY_UPGRADE_CHANGED_NEW_INSTALL'
        Assert-CmTreeEqual $c.profileBaseline (Get-CmTree $c.profile) 'BUSY_UPGRADE_CHANGED_PROFILE'
        Assert-CmDirectoriesEqual $c.profileDirectories (Get-CmDirectories $c.profile) 'BUSY_UPGRADE_CHANGED_PROFILE_DIRECTORIES'
        Assert-CmDirectoriesEqual $c.installDirectories (Get-CmDirectories $c.install) 'BUSY_UPGRADE_CHANGED_INSTALL_DIRECTORIES'
        Assert-CmTreeEqual $c.newCache (Get-CmTree $c.installerCache) 'BUSY_UPGRADE_CHANGED_CACHE'
        Assert-CmSameRegistration $c.registryBaseline (Get-CmRegistry);Assert-CmSameRegistration $c.shortcutsBaseline (Get-CmShortcuts)
        @{installedBytesUnchanged=$true;completeProfileUnchanged=$true;registryAndShortcutsUnchanged=$true}
    }
    uninstallOwned={param($c)
        Assert-CmTreeEqual $c.newInstalled (Get-CmTree $c.install) 'UNINSTALL_OWNER_FILES_CHANGED'
        Assert-CmOwnedRegistration (Get-CmRegistry) $c.install
        Assert-CmSameRegistration $c.shortcutsBaseline (Get-CmShortcuts)
        Assert-CmTreeEqual $c.newCache (Get-CmTree $c.installerCache) 'UNINSTALL_CACHE_OWNER_CHANGED'
        $uninstaller=@($c.newInstalled|Where-Object path -ieq 'Uninstall craftmine world.exe');if($uninstaller.Count -ne 1){throw 'OWN_UNINSTALLER_MISSING'}
        # Normal NSIS self-copy mode; the owned job also waits for its child process.
        $r=Invoke-CmOwnedInstaller (Join-Path $c.install $uninstaller[0].path) $uninstaller[0].sha256 '/S /currentuser';Assert-CmZero $r;$r
    }
    verifyRemoved={param($c)
        Assert-CmCleanHost (Get-CmRegistry) (Get-CmShortcuts);Assert-CmNoProcesses
        $remaining=Get-CmTree $c.install;if($remaining.Count){throw 'OWN_INSTALL_FILES_REMAIN'}
        Assert-CmTreeEqual $c.profileBaseline (Get-CmTree $c.profile) 'UNINSTALL_CHANGED_SYNTHETIC_PROFILE'
        Assert-CmDirectoriesEqual $c.profileDirectories (Get-CmDirectories $c.profile) 'UNINSTALL_CHANGED_SYNTHETIC_DIRECTORIES'
        $retained=Get-CmTree $c.installerCache
        if($retained.Count){Assert-CmTreeEqual $c.newCache $retained 'UNINSTALL_CHANGED_CACHE_UNEXPECTEDLY'}
        $report.installerCache.retainedAfterUninstall=($retained.Count -gt 0);$report.installerCache.files=$retained
        @{ownedApplicationFilesRemoved=$true;ownedRegistrationsRemoved=$true;syntheticDataAndVerifiedBackupPreserved=$true;retainedOwnedInstallerCache=$retained}
    }
}
$savedEnv=@{};foreach($name in @('CRAFTMINE_DATA_DIR','TEMP','TMP')){$savedEnv[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
    [Environment]::SetEnvironmentVariable('CRAFTMINE_DATA_DIR',$context.profile,'Process')
    [Environment]::SetEnvironmentVariable('TEMP',$context.temp,'Process');[Environment]::SetEnvironmentVariable('TMP',$context.temp,'Process')
    Initialize-CmHostNative
    $context.markerHash=Get-CmHash $markerPath
    $context.previousPayload=Get-CmPackage $plan.previous;$context.nextPayload=Get-CmPackage $plan.next
    Save-CmHostReport
    Invoke-CmHostSequence $context $actions {param($stage,$passed,$detail) $report.steps+=@{stage=$stage;passed=$passed;at=[DateTime]::UtcNow.ToString('o');detail=$detail};Save-CmHostReport}
    $report.passed=$true;$report.status='PASSED_HOST_COMPATIBILITY'
}catch{$report.status='FAILED';$report.fatal=$_.Exception.Message}
finally{
    foreach($name in $savedEnv.Keys){[Environment]::SetEnvironmentVariable($name,$savedEnv[$name],'Process')}
    $report.finishedAt=[DateTime]::UtcNow.ToString('o');Save-CmHostReport
}
Write-Output $reportPath
if(-not $report.passed){exit 1}
