param([string]$OutputRoot=(Join-Path $PSScriptRoot '../../test-results/host-installer'))
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../desktop/delivery/lib/windows-host-compatibility.ps1')
Initialize-CmHostNative # Compile only; never call Run.
New-Item -ItemType Directory -Path $OutputRoot -Force|Out-Null
$out=Join-Path ([IO.Path]::GetFullPath($OutputRoot)) ('unit-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $out|Out-Null
$results=[Collections.Generic.List[object]]::new()
function Test([string]$Name,[scriptblock]$Body){try{& $Body;$results.Add(@{name=$Name;passed=$true})}catch{$results.Add(@{name=$Name;passed=$false;error=$_.Exception.Message})}}
function Equal($A,$B){if($A -cne $B){throw "NOT_EQUAL: $A versus $B"}}
function Reject([scriptblock]$Body,[string]$Expected){$errorMessage=$null;try{& $Body|Out-Null}catch{$errorMessage=$_.Exception.Message};if(-not $errorMessage -or $errorMessage -notlike ('*'+$Expected+'*')){throw "EXPECTED $Expected; ACTUAL $errorMessage"}}
function Plan {
    $old=[ordered]@{installer='D:\read-only\old.exe';installerSha256=('a'*64);packageRoot='D:\read-only\old';packageTreeSha256=('b'*64);commit='8276b4540289c0d397c382dff2123edfe1861d42';buildManifestSha256=('c'*64);version='0.14.3'}
    $new=[ordered]@{installer='D:\read-only\new.exe';installerSha256=('d'*64);packageRoot='D:\read-only\new';packageTreeSha256=('e'*64);commit='b6f15172591db71b6016607a811b4679531df63d';buildManifestSha256=('f'*64);version='0.14.4-preview.1'}
    return [ordered]@{format='craftmine.windows-host-compatibility-plan/1';root=('D:\cm-host-unit-'+[Guid]::NewGuid().ToString('N'));previous=$old;next=$new}
}
function Read-Plan($Value){$p=Join-Path $out ('plan-'+[Guid]::NewGuid().ToString('N')+'.json');$Value|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $p -Encoding UTF8;Read-CmHostPlan $p}
function Registry([string]$Install){return @(
    @{hive='CurrentUser';view='Registry64';path="Software\$script:CmHostGuid";values=@{InstallLocation=$Install}},
    @{hive='CurrentUser';view='Registry64';path="Software\Microsoft\Windows\CurrentVersion\Uninstall\$script:CmHostGuid";values=@{UninstallString=('"'+(Join-Path $Install 'Uninstall craftmine world.exe')+'" /currentuser');DisplayVersion='0.14.3'}}
)}
Test 'PowerShell parse and C# compile without launching native helper' {
    foreach($f in @('windows-host-compatibility.ps1','lib/windows-host-compatibility.ps1')){$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot ('../../desktop/delivery/'+$f)),[ref]$tokens,[ref]$errors);Equal $errors.Count 0}
}
Test 'valid old827 distinct new pinned plan' {$p=Read-Plan (Plan);Equal $p.previous.version '0.14.3';Equal $p.next.version '0.14.4-preview.1'}
Test 'same installer refused as upgrade' {$p=Plan;$p.next.installerSha256=$p.previous.installerSha256;Reject {Read-Plan $p} 'DISTINCT_OLD_TO_NEW_REQUIRED'}
Test 'same source commit refused as upgrade' {$p=Plan;$p.next.commit=$p.previous.commit;Reject {Read-Plan $p} 'DISTINCT_OLD_TO_NEW_REQUIRED'}
Test 'same payload refused as upgrade' {$p=Plan;$p.next.packageTreeSha256=$p.previous.packageTreeSha256;Reject {Read-Plan $p} 'DISTINCT_OLD_TO_NEW_REQUIRED'}
Test 'unexpected predecessor refused' {$p=Plan;$p.previous.commit='0'*40;Reject {Read-Plan $p} 'PREVIOUS_827_REQUIRED'}
Test 'C root and quoted argument injection refused' {Reject {Assert-CmPath 'C:\cm-host-private' -DOnly} 'NEW_SHORT_D_ROOT_REQUIRED';Reject {Assert-CmPath 'D:\cm-host-" /allusers' -DOnly} 'ABSOLUTE_NORMAL_PATH_REQUIRED'}
Test 'relative and traversal roots refused' {Reject {Assert-CmPath '..\data'} 'ABSOLUTE_NORMAL_PATH_REQUIRED';Reject {Assert-CmPath 'D:\valid\..\victim'} 'ABSOLUTE_NORMAL_PATH_REQUIRED'}
Test 'unknown fields and hash coercion refused' {$p=Plan;$p.extra=$true;Reject {Read-Plan $p} 'INVALID_PLAN_FIELDS';$p=Plan;$p.next.installerSha256=@('d'*64);Reject {Read-Plan $p} 'EXPECTED_HASH_REQUIRED'}
Test 'existing registry blocks before launch' {Reject {Assert-CmCleanHost (Registry 'D:\cm-host-owned\install') @()} 'EXISTING_CRAFTMINE_REGISTRY'}
Test 'existing named shortcut blocks before launch' {Reject {Assert-CmCleanHost @() @(@{path='fixture.lnk'})} 'EXISTING_CRAFTMINE_SHORTCUT'}
Test 'empty registration and shortcuts accepted' {Assert-CmCleanHost @() @()}
Test 'owned current-user registration accepted' {Assert-CmOwnedRegistration (Registry 'D:\cm-host-owned\install') 'D:\cm-host-owned\install'}
Test 'machine registry and foreign location rejected' {$r=Registry 'D:\foreign';Reject {Assert-CmOwnedRegistration $r 'D:\cm-host-owned\install'} 'REGISTRY_INSTALL_LOCATION_MISMATCH';$r=Registry 'D:\cm-host-owned\install';$r[0].hive='LocalMachine';Reject {Assert-CmOwnedRegistration $r 'D:\cm-host-owned\install'} 'MACHINE_REGISTRATION_COLLISION'}
Test 'uninstaller path and mode exact' {$r=Registry 'D:\cm-host-owned\install';$r[1].values.UninstallString='"D:\foreign\uninstall.exe" /currentuser';Reject {Assert-CmOwnedRegistration $r 'D:\cm-host-owned\install'} 'REGISTRY_UNINSTALL_OWNER_MISMATCH'}
Test 'foreign shortcut is never owned' {Reject {Assert-CmOwnedShortcuts @(@{target='D:\foreign\Craftmine World.exe';arguments=''}) 'D:\cm-host-owned\install'} 'SHORTCUT_OWNER_MISMATCH'}
Test '11 stages old-new-busy-uninstall finite order' {
    $c=@{seen=[Collections.Generic.List[string]]::new()};$a=@{}
    foreach($s in @('preflight','installPrevious','verifyPrevious','seed','upgradeToNext','verifyNextAndBackup','baseline','busyUpgrade','verifyUnchanged','uninstallOwned','verifyRemoved')){$a[$s]={param($c) $c.seen.Add($stage)}}
    Invoke-CmHostSequence $c $a {param($stage,$passed,$detail) if(-not $passed){throw 'UNEXPECTED_STAGE_FAILURE'}}
    Equal ($c.seen -join ',') 'preflight,installPrevious,verifyPrevious,seed,upgradeToNext,verifyNextAndBackup,baseline,busyUpgrade,verifyUnchanged,uninstallOwned,verifyRemoved'
}
Test 'failed busy invariant stops without automatic uninstall' {
    $c=@{seen=[Collections.Generic.List[string]]::new()};$a=@{}
    foreach($s in @('preflight','installPrevious','verifyPrevious','seed','upgradeToNext','verifyNextAndBackup','baseline','busyUpgrade','verifyUnchanged','uninstallOwned','verifyRemoved')){$a[$s]={param($c) $c.seen.Add($stage);if($stage -eq 'verifyUnchanged'){throw 'MUTATION_DETECTED'}}}
    Reject {Invoke-CmHostSequence $c $a {param($stage,$passed,$detail)}} 'MUTATION_DETECTED';Equal ($c.seen -contains 'uninstallOwned') $false
}
Test 'complete tree detects changed bytes and extra files' {
    $dir=Join-Path $out 'tree';New-Item -ItemType Directory -Path $dir|Out-Null;[IO.File]::WriteAllText((Join-Path $dir 'one'),'original')
    $old=Get-CmTree $dir;Equal $old.Count 1;[IO.File]::WriteAllText((Join-Path $dir 'one'),'changed')
    Reject {Assert-CmTreeEqual $old (Get-CmTree $dir) 'CHANGED'} 'CHANGED'
    [IO.File]::WriteAllText((Join-Path $dir 'one'),'original');[IO.File]::WriteAllText((Join-Path $dir 'two'),'extra');Reject {Assert-CmTreeEqual $old (Get-CmTree $dir) 'ADDED'} 'ADDED'
}
Test 'SQLite fixture is actual SQLite not empty lock placeholder' {
    $bytes=[Convert]::FromBase64String((Get-Content (Join-Path $PSScriptRoot '../../desktop/delivery/fixtures/host-synthetic.sqlite.b64') -Raw))
    Equal ([Text.Encoding]::ASCII.GetString($bytes,0,15)) 'SQLite format 3';Equal ($bytes.Length -ge 8192) $true
}
Test 'backup verifies exact manifest plus every copied byte' {
    $profile=Join-Path $out 'backup-profile';$backup=Join-Path $profile 'upgrade-backups/one';New-Item -ItemType Directory -Path $backup -Force|Out-Null
    [IO.File]::WriteAllText((Join-Path $profile 'pi.sqlite'),'unit-synthetic');$seed=@(@{path='pi.sqlite';bytes=14;sha256=(Get-CmHash (Join-Path $profile 'pi.sqlite'))})
    [IO.File]::WriteAllText((Join-Path $backup 'pi.sqlite'),'unit-synthetic')
    @{format='craftmine.offline-upgrade/1';schemaVersion=1;targetBuild='0.14.4-preview.1';credentialStoreIncluded=$false;files=$seed}|ConvertTo-Json -Depth 8|Set-Content (Join-Path $backup 'manifest.json')
    $verified=Assert-CmBackup $profile $seed '0.14.4-preview.1';Equal $verified.files.Count 1
    [IO.File]::WriteAllText((Join-Path $backup 'pi.sqlite'),'corrupt');Reject {Assert-CmBackup $profile $seed '0.14.4-preview.1'} 'BACKUP_BODY_MISMATCH'
}
Test 'default entry NOT_RUN creates no root' {
    $p=Plan;$file=Join-Path $out 'default.json';$p|ConvertTo-Json -Depth 8|Set-Content $file -Encoding UTF8
    $entry=Join-Path $PSScriptRoot '../../desktop/delivery/windows-host-compatibility.ps1'
    $output=& "$env:WINDIR/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -NonInteractive -File $entry -PlanPath $file
    if($LASTEXITCODE -ne 0){throw ('DEFAULT_EXIT_'+$LASTEXITCODE)}
    $report=$output -join "`n"|ConvertFrom-Json;Equal $report.status 'NOT_RUN';Equal $report.installerInvocations 0;Equal (Test-Path -LiteralPath $p.root) $false
}
Test 'any existing cache even empty blocks before first installer' {
    $dir=Join-Path $out 'old-cache';New-Item -ItemType Directory -Path $dir|Out-Null
    Reject {Assert-CmAbsentInstallerCache $dir} 'PREEXISTING_INSTALLER_CACHE_DENIED'
}
Test 'owned cache must match exact setup hash and file set' {
    $dir=Join-Path $out 'owned-cache';New-Item -ItemType Directory -Path $dir|Out-Null
    [IO.File]::WriteAllText((Join-Path $dir 'installer.exe'),'unit fixture; never executed')
    $hash=Get-CmHash (Join-Path $dir 'installer.exe');$tree=Assert-CmOwnedInstallerCache $dir $hash;Equal $tree.Count 1
    Reject {Assert-CmOwnedInstallerCache $dir ('0'*64)} 'INSTALLER_CACHE_OWNER_MISMATCH'
    [IO.File]::WriteAllText((Join-Path $dir 'unknown'),'preserve');Reject {Assert-CmOwnedInstallerCache $dir $hash} 'INSTALLER_CACHE_OWNER_MISMATCH'
}
Test 'empty directory addition cannot hide in profile comparison' {
    $dir=Join-Path $out 'directories';New-Item -ItemType Directory -Path $dir|Out-Null
    $before=Get-CmDirectories $dir;New-Item -ItemType Directory -Path (Join-Path $dir 'unexpected')|Out-Null
    Reject {Assert-CmDirectoriesEqual $before (Get-CmDirectories $dir) 'DIRECTORY_CHANGED'} 'DIRECTORY_CHANGED'
}
$report=@{format='craftmine.host-installer-unit/1';installerInvocations=0;nativeLauncherInvocations=0;tests=@($results.ToArray());passed=(@($results|Where-Object {-not $_.passed}).Count -eq 0)}
$path=Join-Path $out 'report.json';$report|ConvertTo-Json -Depth 12|Set-Content $path -Encoding UTF8
$results|ForEach-Object {[pscustomobject]$_}|Format-Table name,passed,error -Wrap
Write-Output $path
if(-not $report.passed){exit 1}
