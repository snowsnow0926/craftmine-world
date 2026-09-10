Set-StrictMode -Version Latest
$script:CmHostGuid = 'b6e82c09-fb8e-58e5-a0b3-2d2cd57a1249'
function Initialize-CmHostNative {
    if (-not ('CraftmineHostProcess' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'windows-host-process.cs') }
}
function Assert-CmHostProcessResult($Result) {
    if(-not $Result.Completed -or -not $Result.JobActiveZero -or -not $Result.RootExitSignaled){throw ('OWNED_PROCESS_LIFECYCLE_FAILED: '+$Result.Failure+'; cleanup='+$Result.Cleanup+'; rootPid='+$Result.RootPid)}
}
function Assert-CmKeys($Value, [string[]]$Keys) {
    if ($null -eq $Value -or $Value -is [array] -or $Value -is [string]) { throw 'INVALID_PLAN_OBJECT' }
    $actual = @($Value.PSObject.Properties.Name | Sort-Object)
    if (($actual -join '|') -cne (($Keys | Sort-Object) -join '|')) { throw 'INVALID_PLAN_FIELDS' }
}
function Assert-CmHash([object]$Value) { if ($Value -isnot [string] -or $Value -cnotmatch '^[a-f0-9]{64}$') { throw 'EXPECTED_HASH_REQUIRED' } }
function Assert-CmPath([string]$Value, [switch]$DOnly) {
    if ($Value -notmatch '^[A-Za-z]:[\\/]' -or $Value -match '["\x00-\x1f]' -or $Value.Substring(2).Contains(':') -or $Value -match '(^|[\\/])\.\.?([\\/]|$)') { throw 'ABSOLUTE_NORMAL_PATH_REQUIRED' }
    $full = [IO.Path]::GetFullPath($Value).TrimEnd('\','/')
    if ($DOnly -and ($full -notmatch '^D:\\[A-Za-z0-9_-]{8,70}$')) { throw 'NEW_SHORT_D_ROOT_REQUIRED' }
    return $full
}
function Assert-CmNoLinks([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_PATH_DENIED' }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }; $current = $parent
    }
}
function Get-CmHash([string]$File) {
    Assert-CmNoLinks $File
    $item = Get-Item -LiteralPath $File -Force
    if ($item.PSIsContainer -or [CraftmineHostProcess]::Links($item.FullName) -ne 1) { throw 'ORDINARY_SINGLE_LINK_FILE_REQUIRED' }
    return (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Get-CmTree([string]$Root) {
    Assert-CmNoLinks $Root
    $entries = [Collections.Generic.List[object]]::new()
    if (-not (Test-Path -LiteralPath $Root)) { return ,@() }
    $queue = [Collections.Generic.Queue[string]]::new(); $queue.Enqueue($Root);$visited=0
    while ($queue.Count) {
        foreach ($item in Get-ChildItem -LiteralPath $queue.Dequeue() -Force) {
            $visited++;if($visited -gt 30000){throw 'TREE_LIMIT_EXCEEDED'}
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'TREE_LINK_DENIED' }
            if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) }
            else { $entries.Add([ordered]@{path=$item.FullName.Substring($Root.Length+1).Replace('\','/');bytes=$item.Length;sha256=(Get-CmHash $item.FullName)}) }
            if ($entries.Count + $queue.Count -gt 30000) { throw 'TREE_LIMIT_EXCEEDED' }
        }
    }
    return ,@($entries | Sort-Object -Property path -CaseSensitive)
}
function Get-CmTreeDigest($Entries) {
    # Explicit ordinal ordering and LF; independent of PowerShell JSON formatting.
    $rows = [string[]]@($Entries | ForEach-Object { $_.path + '|' + $_.bytes + '|' + $_.sha256 + "`n" })
    [Array]::Sort($rows,[StringComparer]::Ordinal)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($rows -join '')))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Get-CmDirectories([string]$Root) {
    Assert-CmNoLinks $Root;$paths=[Collections.Generic.List[string]]::new()
    if(-not (Test-Path -LiteralPath $Root)){return ,@()}
    $queue=[Collections.Generic.Queue[string]]::new();$queue.Enqueue($Root);$visited=0
    while($queue.Count){foreach($item in Get-ChildItem -LiteralPath $queue.Dequeue() -Force){
        $visited++;if($visited -gt 30000){throw 'TREE_LIMIT_EXCEEDED'}
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'TREE_LINK_DENIED'}
        if($item.PSIsContainer){$paths.Add($item.FullName.Substring($Root.Length+1).Replace('\','/'));$queue.Enqueue($item.FullName)}
    }}
    $sorted=$paths.ToArray();[Array]::Sort($sorted,[StringComparer]::Ordinal);return ,$sorted
}
function Assert-CmDirectoriesEqual($Before,$After,[string]$Code){if(($Before -join "`n") -cne ($After -join "`n")){throw $Code}}
function Assert-CmTreeEqual($Before,$After,[string]$Code) { if ((Get-CmTreeDigest $Before) -cne (Get-CmTreeDigest $After)) { throw $Code } }
function Read-CmHostPlan([string]$File) {
    Assert-CmNoLinks $File
    if ((Get-Item -LiteralPath $File).Length -gt 65536) { throw 'PLAN_TOO_LARGE' }
    $plan = Get-Content -LiteralPath $File -Raw | ConvertFrom-Json
    Assert-CmKeys $plan @('format','root','previous','next')
    if ($plan.format -isnot [string] -or $plan.format -cne 'craftmine.windows-host-compatibility-plan/1') { throw 'PLAN_FORMAT_INVALID' }
    $plan.root = Assert-CmPath $plan.root -DOnly
    foreach ($part in @($plan.previous,$plan.next)) {
        Assert-CmKeys $part @('installer','installerSha256','packageRoot','packageTreeSha256','commit','buildManifestSha256','version')
        $part.installer = Assert-CmPath $part.installer; $part.packageRoot = Assert-CmPath $part.packageRoot
        foreach ($key in @('installerSha256','packageTreeSha256','buildManifestSha256')) { Assert-CmHash $part.$key }
        if ($part.commit -isnot [string] -or $part.commit -cnotmatch '^[a-f0-9]{40}$' -or $part.version -isnot [string] -or $part.version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$') { throw 'PACKAGE_IDENTITY_INVALID' }
        foreach ($inputPath in @($part.installer,$part.packageRoot)) { if ($inputPath.StartsWith($plan.root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'INPUT_INSIDE_MUTABLE_TEST_ROOT' } }
    }
    if ($plan.previous.commit -cne '8276b4540289c0d397c382dff2123edfe1861d42') { throw 'PREVIOUS_827_REQUIRED' }
    if ($plan.previous.commit -ceq $plan.next.commit -or $plan.previous.installerSha256 -ceq $plan.next.installerSha256 -or $plan.previous.packageTreeSha256 -ceq $plan.next.packageTreeSha256) { throw 'DISTINCT_OLD_TO_NEW_REQUIRED' }
    return $plan
}
function Get-CmRegistry {
    $keys = @("Software\$script:CmHostGuid", "Software\{$script:CmHostGuid}", "Software\Microsoft\Windows\CurrentVersion\Uninstall\$script:CmHostGuid", "Software\Microsoft\Windows\CurrentVersion\Uninstall\{$script:CmHostGuid}", 'Software\Classes\AppUserModelId\world.craftmine.desktop')
    $entries = @()
    foreach ($hive in @('CurrentUser','LocalMachine')) { foreach ($view in @('Registry32','Registry64')) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::$hive,[Microsoft.Win32.RegistryView]::$view)
        try { foreach ($path in $keys) { $key = $base.OpenSubKey($path,$false); if ($key) {
            try { $values=[ordered]@{}; foreach ($name in $key.GetValueNames() | Sort-Object) { $values[$name]=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }; $entries += [ordered]@{hive=$hive;view=$view;path=$path;values=$values} } finally {$key.Dispose()}
        } } } finally { $base.Dispose() }
    } }
    return ,$entries
}
function Get-CmShortcuts {
    $found=@(); $visited=0
    foreach ($folder in @('DesktopDirectory','CommonDesktopDirectory','Programs','CommonPrograms')) {
        $root=[Environment]::GetFolderPath([Environment+SpecialFolder]::$folder);if(-not $root -or -not(Test-Path -LiteralPath $root)){continue};Assert-CmNoLinks $root
        $queue=[Collections.Generic.Queue[string]]::new();$queue.Enqueue($root)
        while($queue.Count){foreach($item in Get-ChildItem -LiteralPath $queue.Dequeue() -Force){
            $visited++;if($visited -gt 15000){throw 'SHORTCUT_PREFLIGHT_LIMIT'}
            if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'SHORTCUT_TREE_LINK_DENIED'}
            if($item.PSIsContainer){if($folder -match 'Programs'){$queue.Enqueue($item.FullName)}}
            elseif($item.Extension -ieq '.lnk'){
                $shell=New-Object -ComObject WScript.Shell;$link=$null
                try{
                    $link=$shell.CreateShortcut($item.FullName)
                    # Read only .lnk metadata. A renamed Craftmine link still
                    # collides; Steam's own target/URL is not classified by title.
                    if($item.Name -match '^craftmine[ -]?world.*\.lnk$' -or [IO.Path]::GetFileName($link.TargetPath) -match '(?i)^craftmine[ -]?world\.exe$'){
                        $found += [ordered]@{path=$item.FullName;target=$link.TargetPath;arguments=$link.Arguments;sha256=(Get-CmHash $item.FullName)}
                    }
                }finally{if($link){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)}
            }
        }}
    }
    return ,@($found|Sort-Object path -Unique)
}
function Get-CmCoreProcessOwner([string]$ExecutablePath) {
    if(-not $ExecutablePath){return 'unknown'}
    try{
        $full=Assert-CmPath $ExecutablePath;Assert-CmNoLinks $full
        if($full -notmatch '(?i)^(.*)\\resources\\bin\\[^\\]+\.exe$'){return 'unknown'}
        $package=$Matches[1]
        if(Test-Path -LiteralPath (Join-Path $package 'Craftmine World.exe')){return 'craftmine'}
        # Recognize the separate PI distribution by layout AND executable product
        # metadata, never by a PID/path exception. No process is opened or stopped.
        $pi=Join-Path $package 'PI-Desktop.exe';Assert-CmNoLinks $pi
        if(Test-Path -LiteralPath $pi){$v=(Get-Item -LiteralPath $pi).VersionInfo;if($v.ProductName -ceq 'PI-Desktop' -and $v.FileDescription -ceq 'PI-Desktop'){return 'other-pi'}}
    }catch{return 'unknown'}
    return 'unknown'
}
function Test-CmProcessCollision($Process,[string]$Install,[scriptblock]$ResolveOwner) {
    # Match the NSIS danger predicate exactly: it has NO trailing separator.
    if($Install -and $Process.ExecutablePath -and $Process.ExecutablePath.StartsWith($Install,[StringComparison]::CurrentCultureIgnoreCase)){return $true}
    if($Process.Name -match '(?i)^(craftmine[ -]?world|Uninstall craftmine world)\.exe$' -or $Process.Name -match '(?i)^Craftmine-World-Setup-.*\.exe$'){return $true}
    if($Process.Name -match '(?i)^(craftmine-core|pi-desktop-host-core|craftmine-godot-broker|godot-host-broker|broker-preflight|Godot_v4\.7\.2-stable_win64)\.exe$'){
        return ((& $ResolveOwner $Process.ExecutablePath) -cne 'other-pi')
    }
    return $false
}
function Assert-CmNoProcesses([string]$Install='') {
    # Only names and executable paths; never inspect command lines or credentials.
    $blocked=@(Get-CimInstance Win32_Process -Property Name,ProcessId,ExecutablePath | Where-Object {
        Test-CmProcessCollision $_ $Install {param($path) Get-CmCoreProcessOwner $path}
    } | Select-Object Name,ProcessId,ExecutablePath)
    if($blocked.Count){throw ('CRAFTMINE_PROCESS_COLLISION: '+($blocked|ConvertTo-Json -Compress))}
    # Match the actual NSIS mutex; opening an existing handle does not create it.
    $mutex=$null
    try{if([Threading.Mutex]::TryOpenExisting($script:CmHostGuid,[ref]$mutex)){throw 'CRAFTMINE_INSTALLER_MUTEX_COLLISION'}}finally{if($mutex){$mutex.Dispose()}}
}
function Get-CmInstallerCacheRoot {
    # NSIS KnownFolder, NOT the overrideable LOCALAPPDATA environment variable.
    $local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if(-not $local){throw 'LOCAL_APPDATA_KNOWN_FOLDER_UNAVAILABLE'}
    return Join-Path $local '@pi-desktopdesktop-updater'
}
function Assert-CmAbsentInstallerCache([string]$Root) {
    Assert-CmNoLinks $Root
    if(Test-Path -LiteralPath $Root){throw 'PREEXISTING_INSTALLER_CACHE_DENIED'}
}
function Assert-CmOwnedInstallerCache([string]$Root,[string]$Hash) {
    $tree=Get-CmTree $Root
    if($tree.Count -ne 1 -or $tree[0].path -cne 'installer.exe' -or $tree[0].sha256 -cne $Hash){throw 'INSTALLER_CACHE_OWNER_MISMATCH'}
    return ,$tree
}
function Assert-CmCleanHost($Registry,$Shortcuts) { if(@($Registry).Count){throw 'EXISTING_CRAFTMINE_REGISTRY'};if(@($Shortcuts).Count){throw 'EXISTING_CRAFTMINE_SHORTCUT'} }
function Assert-CmOwnedRegistration($Registry,[string]$Install) {
    if(-not @($Registry).Count){throw 'OWN_REGISTRATION_MISSING'}
    $installFound=$false;$uninstallFound=$false
    foreach($r in $Registry){
        if($r.hive -ne 'CurrentUser'){throw 'MACHINE_REGISTRATION_COLLISION'}
        if($r.path -eq "Software\$script:CmHostGuid"){
            if($r.values.InstallLocation -isnot [string] -or [IO.Path]::GetFullPath($r.values.InstallLocation).TrimEnd('\') -ine $Install){throw 'REGISTRY_INSTALL_LOCATION_MISMATCH'};$installFound=$true
        }elseif($r.path -eq "Software\Microsoft\Windows\CurrentVersion\Uninstall\$script:CmHostGuid"){
            $expected='"'+(Join-Path $Install 'Uninstall craftmine world.exe')+'" /currentuser'
            if($r.values.UninstallString -ine $expected){throw 'REGISTRY_UNINSTALL_OWNER_MISMATCH'};$uninstallFound=$true
        }elseif($r.path -ne 'Software\Classes\AppUserModelId\world.craftmine.desktop'){throw 'UNEXPECTED_GUID_REGISTRATION'}
    }
    if(-not $installFound -or -not $uninstallFound){throw 'OWN_REGISTRATION_INCOMPLETE'}
}
function Assert-CmOwnedShortcuts($Shortcuts,[string]$Install) {
    foreach($s in $Shortcuts){if($s.target -ine (Join-Path $Install 'Craftmine World.exe') -or $s.arguments){throw 'SHORTCUT_OWNER_MISMATCH'}}
}
function Get-CmPackage($Part) {
    if((Get-CmHash $Part.installer) -cne $Part.installerSha256){throw 'INSTALLER_HASH_MISMATCH'}
    $manifest=Join-Path $Part.packageRoot 'resources/source/build-manifest.json'
    if((Get-CmHash $manifest) -cne $Part.buildManifestSha256){throw 'BUILD_MANIFEST_HASH_MISMATCH'}
    $m=Get-Content -LiteralPath $manifest -Raw|ConvertFrom-Json
    if($m.format -cne 'craftmine.build/1' -or $m.appId -cne 'world.craftmine.desktop' -or $m.commit -cne $Part.commit){throw 'BUILD_IDENTITY_MISMATCH'}
    $tree=Get-CmTree $Part.packageRoot
    if((Get-CmTreeDigest $tree) -cne $Part.packageTreeSha256){throw 'APPROVED_PAYLOAD_TREE_MISMATCH'}
    foreach($required in @('Craftmine World.exe','resources/app.asar','resources/bin/craftmine-core.exe','resources/bin/pi-desktop-host-core.exe','resources/source/CraftmineWorld-source.zip')){if(-not @($tree|Where-Object path -ieq $required).Count){throw 'PACKAGE_REQUIRED_FILE_MISSING'}}
    return ,$tree
}
function Assert-CmInstalled($Part,$Expected,[string]$Install) {
    $tree=Get-CmTree $Install
    foreach($e in $Expected){$a=@($tree|Where-Object path -ceq $e.path);if($a.Count -ne 1 -or $a[0].bytes -ne $e.bytes -or $a[0].sha256 -cne $e.sha256){throw ('INSTALLED_PAYLOAD_MISMATCH: '+$e.path)}}
    foreach($a in $tree){if(-not @($Expected|Where-Object path -ceq $a.path).Count -and $a.path -inotmatch '^(Uninstall craftmine world\.exe|uninstallerIcon\.ico)$'){throw ('UNEXPECTED_INSTALLED_FILE: '+$a.path)}}
    $registry=Get-CmRegistry;Assert-CmOwnedRegistration $registry $Install
    foreach($r in $registry){if($r.path -match '\\Uninstall\\' -and $r.values.DisplayVersion -cne $Part.version){throw 'INSTALLED_VERSION_MISMATCH'}}
    Assert-CmOwnedShortcuts (Get-CmShortcuts) $Install
    return ,$tree
}
function Invoke-CmHostSequence($Context,$Actions,[scriptblock]$Record) {
    # Fixed finite lifecycle. In particular, the FIRST package is Previous.
    foreach($stage in @('preflight','installPrevious','verifyPrevious','seed','upgradeToNext','verifyNextAndBackup','baseline','busyUpgrade','verifyUnchanged','uninstallOwned','verifyRemoved')){
        try{$result=& $Actions[$stage] $Context;& $Record $stage $true $result}
        catch{& $Record $stage $false $_.Exception.Message;throw}
    }
}
function Assert-CmBackup([string]$Profile,$Seed,[string]$Version) {
    $parent=Join-Path $Profile 'upgrade-backups';Assert-CmNoLinks $parent
    $dirs=@(Get-ChildItem -LiteralPath $parent -Force)
    if($dirs.Count -ne 1 -or -not $dirs[0].PSIsContainer){throw 'EXACTLY_ONE_UPGRADE_BACKUP_REQUIRED'}
    $backup=$dirs[0].FullName;$tree=Get-CmTree $backup
    $manifestPath=Join-Path $backup 'manifest.json'
    if((Get-Item -LiteralPath $manifestPath).Length -gt 65536){throw 'BACKUP_MANIFEST_TOO_LARGE'}
    $manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
    if($manifest.format -cne 'craftmine.offline-upgrade/1' -or $manifest.schemaVersion -ne 1 -or $manifest.targetBuild -cne $Version -or $manifest.credentialStoreIncluded -ne $false){throw 'BACKUP_IDENTITY_MISMATCH'}
    Assert-CmTreeEqual $Seed $manifest.files 'BACKUP_MANIFEST_CONTENT_MISMATCH'
    Assert-CmTreeEqual $Seed @($tree|Where-Object path -cne 'manifest.json') 'BACKUP_BODY_MISMATCH'
    $live=Get-CmTree $Profile
    Assert-CmTreeEqual $Seed @($live|Where-Object {$_.path -cnotlike 'upgrade-backups/*'}) 'LIVE_SYNTHETIC_DATA_CHANGED'
    return @{path=$backup;manifestSha256=(Get-CmHash $manifestPath);files=$manifest.files}
}
