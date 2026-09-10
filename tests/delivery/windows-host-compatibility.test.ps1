param([string]$OutputRoot=(Join-Path $PSScriptRoot '../../test-results/host-installer'),[string]$ShadowModuleRoot='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../desktop/delivery/lib/windows-host-compatibility.ps1')
Initialize-CmHostNative # Compile only; never call Run.
New-Item -ItemType Directory -Path $OutputRoot -Force|Out-Null
$out=Join-Path ([IO.Path]::GetFullPath($OutputRoot)) ('unit-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $out|Out-Null
$results=[Collections.Generic.List[object]]::new()
$skipped=[Collections.Generic.List[object]]::new()
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
Test 'unconfirmed cleanup is rejected even if root exit was zero' {
    $r=@{Completed=$false;JobActiveZero=$false;RootExitCode=0;Failure='query failed';Cleanup='termination-unconfirmed';RootPid=123}
    Reject {Assert-CmHostProcessResult $r} 'OWNED_PROCESS_LIFECYCLE_FAILED'
}
Test 'confirmed timeout cleanup still fails lifecycle and retains PID evidence' {
    $r=@{Completed=$false;JobActiveZero=$true;RootExitCode=125;Failure='timeout';Cleanup='terminated-confirmed';RootPid=123}
    Reject {Assert-CmHostProcessResult $r} 'rootPid=123'
}
Test 'normal job zero does not invent descendant exit codes' {
    $r=@{Completed=$true;JobActiveZero=$true;RootExitSignaled=$true;RootExitCode=0;DescendantExitCodes='NOT_OBSERVED'}
    Assert-CmHostProcessResult $r;Equal $r.DescendantExitCodes 'NOT_OBSERVED'
}
Test 'unrelated PI core is excluded by package identity not PID' {
    $p=@{Name='pi-desktop-host-core.exe';ExecutablePath='D:\unrelated\resources\bin\pi-desktop-host-core.exe';ProcessId=123}
    Equal (Test-CmProcessCollision $p 'D:\cm-owned\install' {param($path) 'other-pi'}) $false
    $p.ProcessId=456;Equal (Test-CmProcessCollision $p 'D:\cm-owned\install' {param($path) 'other-pi'}) $false
}
Test 'unknown core ownership and actual broker name remain blocked' {
    foreach($name in @('pi-desktop-host-core.exe','godot-host-broker.exe')){
        Equal (Test-CmProcessCollision @{Name=$name;ExecutablePath=$null} 'D:\cm-owned\install' {param($path) 'unknown'}) $true
    }
}
Test 'NSIS prefix danger includes install-other even for unrelated executable' {
    Equal (Test-CmProcessCollision @{Name='other.exe';ExecutablePath='D:\cm-owned\install-other\other.exe'} 'D:\cm-owned\install' {param($path) 'other-pi'}) $true
}
Test 'Craftmine executable is blocked regardless of owner lookup' {
    Equal (Test-CmProcessCollision @{Name='Craftmine World.exe';ExecutablePath='D:\elsewhere\Craftmine World.exe'} 'D:\cm-owned\install' {param($path) 'other-pi'}) $true
}
Test 'BOM-less UTF-8 build manifest with non-ASCII product still parses' {
    # Windows PowerShell reads a BOM-less file as ANSI. The real 0.14.3 manifest
    # is UTF-8 without a BOM and carries a Chinese product name, which corrupted
    # the JSON before Get-CmPackage pinned any package.
    $pkg=Join-Path $out 'encoding-package'
    foreach($dir in @('resources/source','resources/bin')){New-Item -ItemType Directory -Path (Join-Path $pkg $dir) -Force|Out-Null}
    foreach($rel in @('Craftmine World.exe','resources/app.asar','resources/bin/craftmine-core.exe','resources/bin/pi-desktop-host-core.exe','resources/source/CraftmineWorld-source.zip')){
        [IO.File]::WriteAllText((Join-Path $pkg $rel),'fixture; never executed')
    }
    $product='craftmine world / '+([string][char]0x6700)+([string][char]0x4E2D)+([string][char]0x5E7B)+([string][char]0x60F3)
    $manifest=[ordered]@{format='craftmine.build/1';commit=('a'*40);appId='world.craftmine.desktop';product=$product;profileDirectory='CraftmineWorld'}
    $manifestPath=Join-Path $pkg 'resources/source/build-manifest.json'
    [IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    $installer=Join-Path $out 'encoding-installer.exe';[IO.File]::WriteAllText($installer,'fixture; never executed')
    $part=[ordered]@{installer=$installer;installerSha256=(Get-CmHash $installer);packageRoot=$pkg;packageTreeSha256=(Get-CmTreeDigest (Get-CmTree $pkg));commit=('a'*40);buildManifestSha256=(Get-CmHash $manifestPath);version='1.0.0'}
    $tree=Get-CmPackage $part
    Equal $tree.Count 6
    $short=Join-Path $out 'encoding-package-short';Copy-Item -LiteralPath $pkg -Destination $short -Recurse
    Remove-Item -LiteralPath (Join-Path $short 'resources/app.asar')
    # OrderedDictionary.Clone() is an explicit interface member, so rebuild it.
    $missing=[ordered]@{installer=$part.installer;installerSha256=$part.installerSha256;packageRoot=$short;packageTreeSha256=(Get-CmTreeDigest (Get-CmTree $short));commit=$part.commit;buildManifestSha256=$part.buildManifestSha256;version=$part.version}
    Reject {Get-CmPackage $missing} 'PACKAGE_REQUIRED_FILE_MISSING'
}
Test 'system Windows PowerShell tooling is required for hashing' {
    Assert-CmHostTooling|Out-Null
    $good=@{}
    foreach($n in $script:CmHostRequiredCommands){$good[$n]=[ordered]@{name=$n;moduleName='Microsoft.PowerShell.Utility';modulePath=(Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')}}
    Assert-CmHostTooling -CommandTable $good|Out-Null
    # A trimmed shadow module that simply lacks Get-FileHash is the real host case.
    $missing=$good.Clone();$missing['Get-FileHash']=$null
    Reject {Assert-CmHostTooling -CommandTable $missing} 'HOST_POWERSHELL_TOOLING_INVALID'
    $foreign=$good.Clone();$foreign['Get-FileHash']=[ordered]@{name='Get-FileHash';moduleName='Microsoft.PowerShell.Utility';modulePath='D:\cm-host-unit\shadow\Microsoft.PowerShell.Utility.psd1'}
    Reject {Assert-CmHostTooling -CommandTable $foreign} 'HOST_POWERSHELL_TOOLING_INVALID'
    Reject {Assert-CmHostTooling -CommandTable $good -PowerShellEdition 'Core'} 'HOST_POWERSHELL_TOOLING_INVALID'
}
$shadowRoots=@()
foreach($candidate in @($ShadowModuleRoot)+@($env:PSModulePath -split ';')){
    if(-not $candidate){continue}
    if($candidate -notmatch '(?i)WindowsPowerShell[\\/]v1\.0[\\/]Modules'){if(Test-Path -LiteralPath (Join-Path $candidate 'Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')){$shadowRoots+=$candidate}}
}
$shadowRoots=@($shadowRoots|Select-Object -Unique)
if(-not $shadowRoots.Count){
    $skipped.Add(@{name='non-system shadow Utility module refuses before creating the owned root';reason='No non-system Microsoft.PowerShell.Utility module path on this host; pass -ShadowModuleRoot to exercise it.'})
}else{
Test 'non-system shadow Utility module refuses before creating the owned root' {
    $ps51=Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $systemModules=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules'
    $poison=$shadowRoots[0]+';'+$systemModules
    $probe=& $ps51 -NoProfile -NonInteractive -Command "`$env:PSModulePath='$($shadowRoots[0])';`$env:PSModulePath=`$env:PSModulePath+';$systemModules';if(Get-Command Get-FileHash -ErrorAction SilentlyContinue){'HAS_FUNCTION'}else{'MISSING_FUNCTION'}"
    if(($probe|Out-String).Trim() -cne 'MISSING_FUNCTION'){
        $skipped.Add(@{name='non-system shadow Utility module refuses before creating the owned root';reason='The detected shadow module still provides Get-FileHash on this host.'})
        return
    }
    $p=Plan;$file=Join-Path $out ('poison-'+[Guid]::NewGuid().ToString('N')+'.json');$p|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $file -Encoding UTF8
    $entry=Join-Path $PSScriptRoot '../../desktop/delivery/windows-host-compatibility.ps1'
    $stderr=Join-Path $out 'poison.stderr.txt';$stdout=Join-Path $out 'poison.stdout.txt'
    $savedPath=$env:PSModulePath;$child=$null
    try{
        $env:PSModulePath=$poison
        # An owned hidden child with redirected streams: PowerShell 5.1 turns a
        # native command's stderr into an error record, which would abort this test.
        $start=[Diagnostics.ProcessStartInfo]::new()
        $start.FileName=$ps51
        $start.Arguments='-NoProfile -NonInteractive -File "'+$entry+'" -PlanPath "'+$file+'" -Execute -HostCompatibilityAuthorized'
        $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
        $fail=$null;$text=$null
        $child=[Diagnostics.Process]::new();$child.StartInfo=$start
        if($child.Start()){
            $fail=$child.StandardError.ReadToEnd();$text=$child.StandardOutput.ReadToEnd();$child.WaitForExit()
            $code=$child.ExitCode
        }else{throw 'POISON_PROBE_START_FAILED'}
    }finally{$env:PSModulePath=$savedPath;if($child){$child.Dispose()}}
    [IO.File]::WriteAllText($stdout,[string]$text);[IO.File]::WriteAllText($stderr,[string]$fail)
    Equal $code 1
    Equal ([string]$fail -match 'HOST_POWERSHELL_TOOLING_INVALID') $true
    # The refusal must happen before the owned root, installer cache or marker exist.
    Equal (Test-Path -LiteralPath $p.root) $false
    Equal (Test-Path -LiteralPath (Join-Path $p.root 'host-compatibility-owner.json')) $false
}
}
$report=@{format='craftmine.host-installer-unit/1';installerInvocations=0;nativeLauncherInvocations=0;tests=@($results.ToArray());skipped=@($skipped.ToArray());passed=(@($results|Where-Object {-not $_.passed}).Count -eq 0)}
$path=Join-Path $out 'report.json';$report|ConvertTo-Json -Depth 12|Set-Content $path -Encoding UTF8
$results|ForEach-Object {[pscustomobject]$_}|Format-Table name,passed,error -Wrap
Write-Output $path
if(-not $report.passed){exit 1}
