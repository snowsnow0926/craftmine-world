param([string]$ProfileId = '')
$ErrorActionPreference = 'Stop'

# This launcher never migrates, resets, or copies an existing player's data.
function Assert-OrdinaryPath([string]$Target) {
    $cursor = [IO.Path]::GetFullPath($Target)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'NEW_PLAYER_LINK_PATH_DENIED'
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

try {
    if (!$env:LOCALAPPDATA -or ![IO.Path]::IsPathRooted($env:LOCALAPPDATA)) {
        throw 'NEW_PLAYER_LOCALAPPDATA_REQUIRED'
    }
    $application = Join-Path $PSScriptRoot 'output\win-unpacked\Craftmine World.exe'
    Assert-OrdinaryPath $application
    if (!(Test-Path -LiteralPath $application -PathType Leaf)) { throw 'NEW_PLAYER_EXTRACT_COMPLETE_ZIP_FIRST' }
    $profileRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'CraftmineWorld-NewPlayers'))
    Assert-OrdinaryPath $profileRoot
    $fresh = !$ProfileId
    if ($fresh) { $ProfileId = [Guid]::NewGuid().ToString('D') }
    if ($ProfileId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') {
        throw 'NEW_PLAYER_PROFILE_ID_INVALID'
    }
    $profile = Join-Path $profileRoot ('player-' + $ProfileId)
    Assert-OrdinaryPath $profile
    $markerPath = Join-Path $profile 'new-player-profile.json'
    $sessions = Join-Path $PSScriptRoot 'NEW-PLAYER-SESSIONS'
    Assert-OrdinaryPath $sessions
    $resume = Join-Path $sessions ('CONTINUE-' + $ProfileId + '.cmd')
    if ($fresh) {
        if (Test-Path -LiteralPath $profile) { throw 'NEW_PLAYER_PROFILE_ALREADY_EXISTS' }
        New-Item -ItemType Directory -Path $profile -ErrorAction Stop | Out-Null
        $marker = @{ format = 'craftmine.new-player-profile/1'; id = $ProfileId; createdAt = [DateTime]::UtcNow.ToString('o') }
        [IO.File]::WriteAllText($markerPath, ($marker | ConvertTo-Json), [Text.Encoding]::UTF8)
    } else {
        Assert-OrdinaryPath $markerPath
        if (!(Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw 'NEW_PLAYER_PROFILE_NOT_FOUND' }
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ($marker.format -cne 'craftmine.new-player-profile/1' -or $marker.id -cne $ProfileId) {
            throw 'NEW_PLAYER_PROFILE_IDENTITY_MISMATCH'
        }
    }
    if (!(Test-Path -LiteralPath $sessions)) { New-Item -ItemType Directory -Path $sessions | Out-Null }
    Assert-OrdinaryPath $resume
    $resumeText = '@echo off' + "`r`n" + 'setlocal DisableDelayedExpansion' + "`r`n" +
        'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\START-NEW-PLAYER.ps1" -ProfileId "' + $ProfileId + '"' + "`r`n" +
        'if errorlevel 1 pause' + "`r`n"
    if (!(Test-Path -LiteralPath $resume)) {
        $stream = [IO.File]::Open($resume, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
        try { $bytes = [Text.Encoding]::ASCII.GetBytes($resumeText); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    }
    $info = Join-Path $sessions ('PLAYER-' + $ProfileId + '.txt')
    Assert-OrdinaryPath $info
    if (!(Test-Path -LiteralPath $info)) {
        [IO.File]::WriteAllText($info, ('Created: ' + $marker.createdAt + "`r`nProfile: " + $profile +
            "`r`nContinue: CONTINUE-" + $ProfileId + ".cmd`r`nSTART-NEW-PLAYER.cmd creates another empty player.`r`n"), [Text.Encoding]::UTF8)
    }
    Get-ChildItem Env: | Where-Object { $_.Name -like 'CRAFTMINE_*' -or $_.Name -like 'PI_DESKTOP_*' } | ForEach-Object {
        [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process')
    }
    $env:CRAFTMINE_DATA_DIR = $profile
    $env:ELECTRON_RUN_AS_NODE = $null
    $env:NODE_OPTIONS = $null
    Write-Host ('Player profile: ' + $profile)
    Write-Host ('Continue THIS player next time: ' + $resume)
    Write-Host 'START-NEW-PLAYER.cmd always creates ANOTHER empty player.'
    Start-Process -FilePath $application -WorkingDirectory $PSScriptRoot | Out-Null
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
