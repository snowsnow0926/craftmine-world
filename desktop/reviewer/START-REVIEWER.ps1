# SPDX-License-Identifier: AGPL-3.0-only
param([switch]$InitializeOnly)
$ErrorActionPreference = 'Stop'
$script:backend = $null
$script:rpcId = 0
$mutex = $null
$ownsMutex = $false
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
function Assert-OrdinaryPath([string]$Target) {
    $cursor = [IO.Path]::GetFullPath($Target)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REVIEWER_LINK_PATH_DENIED' }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}
function Invoke-LocalRpc([string]$Method, $Params) {
    $script:rpcId++
    $id = $script:rpcId
    $request = @{ jsonrpc='2.0'; id=$id; method=$Method; params=$Params } | ConvertTo-Json -Depth 20 -Compress
    $script:inputWriter.WriteLine($request)
    $script:inputWriter.Flush()
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
        $read = $script:backend.StandardOutput.ReadLineAsync()
        $remaining = [Math]::Max(1, [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        if (!$read.Wait($remaining)) { throw 'REVIEWER_LOCAL_SETUP_TIMEOUT' }
        if ($null -eq $read.Result) { throw 'REVIEWER_LOCAL_SETUP_EXITED' }
        $reply = $read.Result | ConvertFrom-Json
        if ($reply.id -eq $id) {
            if ($reply.error) { throw 'REVIEWER_LOCAL_SETUP_REQUEST_FAILED' }
            return $reply.result
        }
    }
    throw 'REVIEWER_LOCAL_SETUP_TIMEOUT'
}
function Stop-LocalBackend {
    if ($null -eq $script:backend) { return }
    if (!$script:backend.HasExited) {
        $script:backend.StandardInput.Close()
        if (!$script:backend.WaitForExit(3000)) {
            $script:backend.Kill()
            $script:backend.WaitForExit()
            $script:usedHostStopFallback = $true
        }
    }
    if ($script:backend.ExitCode -ne 0 -and !$script:usedHostStopFallback) { throw 'REVIEWER_LOCAL_SETUP_EXIT_FAILED' }
    $script:backend.Dispose()
    $script:backend = $null
}
try {
    if (!$env:LOCALAPPDATA -or ![IO.Path]::IsPathRooted($env:LOCALAPPDATA)) { throw 'REVIEWER_LOCALAPPDATA_REQUIRED' }
    $application = Join-Path $PSScriptRoot 'output\win-unpacked\Craftmine World.exe'
    $hostBinary = Join-Path $PSScriptRoot 'output\win-unpacked\resources\bin\pi-desktop-host-core.exe'
    Assert-OrdinaryPath $application
    Assert-OrdinaryPath $hostBinary
    if (!(Test-Path -LiteralPath $application -PathType Leaf) -or !(Test-Path -LiteralPath $hostBinary -PathType Leaf)) { throw 'REVIEWER_EXTRACT_COMPLETE_ZIP_FIRST' }
    $hashStream = [IO.File]::OpenRead($hostBinary)
    try { $hostHash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($hashStream)).Replace('-', '') } finally { $hashStream.Dispose() }
    if ($hostHash -ne '8E6CD82F1BFBC306FC649463A5D34220A9AC2DE9E44642AEBCE8B606AD800A3F') { throw 'REVIEWER_PREVIEW28_HOST_MISMATCH' }
    $profileRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'CraftmineWorld-Reviewers'))
    $profile = Join-Path $profileRoot 'Tencent-20260915-preview28'
    Assert-OrdinaryPath $profile
    $markerPath = Join-Path $profile 'reviewer-profile.json'
    $mutex = New-Object Threading.Mutex($false, 'Local\CraftmineReviewerSetup20260915Preview28')
    try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (!$ownsMutex) { throw 'REVIEWER_SETUP_ALREADY_RUNNING' }
    # The application owns existing profiles. Never open their database or rewrite their choices.
    if (Test-Path -LiteralPath $profile) {
        Assert-OrdinaryPath $markerPath
        if (!(Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw 'REVIEWER_EXISTING_PROFILE_NOT_OWNED' }
        $marker = [IO.File]::ReadAllText($markerPath) | ConvertFrom-Json
        if ($marker.format -cne 'craftmine.reviewer-profile/1' -or $marker.id -cne 'Tencent-20260915-preview28' -or $marker.setupComplete -ne $true) { throw 'REVIEWER_PROFILE_IDENTITY_MISMATCH' }
        Write-Host 'Reviewer profile found. Existing settings and worlds are preserved.'
    } else {
        $keyPath = Join-Path $PSScriptRoot '评委用apikey.txt'
        Assert-OrdinaryPath $keyPath
        if (!(Test-Path -LiteralPath $keyPath -PathType Leaf)) { throw 'REVIEWER_API_KEY_FILE_MISSING' }
        if ((Get-Item -LiteralPath $keyPath).Length -gt 65536) { throw 'REVIEWER_API_KEY_FILE_INVALID' }
        $keyText = [IO.File]::ReadAllText($keyPath)
        $matches = [regex]::Matches($keyText, '(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]+')
        if ($matches.Count -ne 1 -or $matches[0].Value.Length -lt 12) { throw 'REVIEWER_API_KEY_FILE_INVALID' }
        $secret = $matches[0].Value
        New-Item -ItemType Directory -Force -Path $profileRoot | Out-Null
        $staging = Join-Path $profileRoot ('initializing-' + [Guid]::NewGuid().ToString('D'))
        Assert-OrdinaryPath $staging
        New-Item -ItemType Directory -Path $staging | Out-Null
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = $hostBinary
        $info.WorkingDirectory = $PSScriptRoot
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardInput = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.StandardOutputEncoding = $utf8
        $info.StandardErrorEncoding = $utf8
        foreach ($name in @($info.EnvironmentVariables.Keys)) {
            if ($name -like 'CRAFTMINE_*' -or $name -like 'PI_DESKTOP_*' -or $name -match '^(NODE_OPTIONS|ELECTRON_RUN_AS_NODE|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$') { $info.EnvironmentVariables.Remove($name) }
        }
        $info.EnvironmentVariables['PI_DESKTOP_DATA_DIR'] = $staging
        $script:backend = New-Object Diagnostics.Process
        $script:backend.StartInfo = $info
        if (!$script:backend.Start()) { throw 'REVIEWER_LOCAL_SETUP_START_FAILED' }
        $script:inputWriter = New-Object IO.StreamWriter($script:backend.StandardInput.BaseStream, $utf8)
        # Drain in memory only: neither raw replies nor stderr are printed or persisted.
        $stderrDrain = $script:backend.StandardError.ReadToEndAsync()
        $null = Invoke-LocalRpc 'app.handshake' @{ protocolVersion=11 }
        $protection = Invoke-LocalRpc 'secrets.status' @{}
        if ($protection.status -ne 'protected' -or $protection.backend -ne 'windows_dpapi') { throw 'REVIEWER_WINDOWS_SECRET_PROTECTION_REQUIRED' }
        $binding = @{ id='deepseek-flash'; contextWindow=1000000; maxTokens=384000; thinkingLevels=@('off','low','high','max'); defaultThinkingLevel='max' }
        $created = Invoke-LocalRpc 'providers.create' @{ name='DeepSeek - Tencent Reviewer'; vendorKey='deepseek'; type='openai_compatible'; protocol='openai_compatible'; baseUrl='https://api.deepseek.com'; authKind='api_key_and_base_url'; secretValue=$secret; apiStyle='chat_completions'; defaultModelId='deepseek-flash'; models=@($binding) }
        $providerId = $created.provider.id
        if (!$providerId -or $created.provider.hasSecret -ne $true) { throw 'REVIEWER_PROVIDER_CREATION_FAILED' }
        $null = Invoke-LocalRpc 'settings.set' @{ worldAgentBackend='pi'; defaultProviderId=$providerId; defaultModelId='deepseek-flash'; defaultMode='agent'; language='zh-CN'; theme='dark' }
        $settings = Invoke-LocalRpc 'settings.get' @{}
        $provider = (Invoke-LocalRpc 'providers.get' @{ id=$providerId }).provider
        $storedSecret = (Invoke-LocalRpc 'providers.getSecret' @{ id=$providerId }).value
        if ($storedSecret -cne $secret -or $settings.defaultProviderId -ne $providerId -or $settings.defaultModelId -ne 'deepseek-flash' -or $settings.worldAgentBackend -ne 'pi' -or $provider.models.Count -ne 1 -or $provider.models[0].contextWindow -ne 1000000 -or $provider.models[0].maxTokens -ne 384000 -or $provider.models[0].defaultThinkingLevel -ne 'max' -or $provider.baseUrl -ne 'https://api.deepseek.com') { throw 'REVIEWER_CONFIGURATION_VERIFY_FAILED' }
        Stop-LocalBackend
        # Confirm durability and current-user decryption with a second process before publication.
        $script:usedHostStopFallback = $false
        $script:backend = New-Object Diagnostics.Process
        $script:backend.StartInfo = $info
        if (!$script:backend.Start()) { throw 'REVIEWER_LOCAL_SETUP_START_FAILED' }
        $script:inputWriter = New-Object IO.StreamWriter($script:backend.StandardInput.BaseStream, $utf8)
        $stderrDrain = $script:backend.StandardError.ReadToEndAsync()
        $null = Invoke-LocalRpc 'app.handshake' @{ protocolVersion=11 }
        $coldSettings = Invoke-LocalRpc 'settings.get' @{}
        $coldProvider = (Invoke-LocalRpc 'providers.get' @{ id=$providerId }).provider
        $coldSecret = (Invoke-LocalRpc 'providers.getSecret' @{ id=$providerId }).value
        if ($coldSecret -cne $secret -or $coldSettings.defaultProviderId -ne $providerId -or $coldProvider.models[0].defaultThinkingLevel -ne 'max' -or $coldProvider.models[0].contextWindow -ne 1000000 -or $coldProvider.models[0].maxTokens -ne 384000) { throw 'REVIEWER_CONFIGURATION_COLD_VERIFY_FAILED' }
        $coldSecret = $null
        Stop-LocalBackend
        $marker = @{ format='craftmine.reviewer-profile/1'; id='Tencent-20260915-preview28'; setupComplete=$true; initializedAt=[DateTime]::UtcNow.ToString('o'); providerId=$providerId; modelId='deepseek-flash'; thinkingLevel='max'; contextWindow=1000000; maxTokens=384000; secretBackend='windows_dpapi'; note='Initial configuration receipt; later player edits are preserved.' }
        [IO.File]::WriteAllText((Join-Path $staging 'reviewer-profile.json'), ($marker | ConvertTo-Json -Depth 8), $utf8)
        # Publish only a fully verified, closed database. Failed staging directories are never launched.
        [IO.Directory]::Move($staging, $profile)
        $secret = $null; $storedSecret = $null; $keyText = $null; $matches = $null
        Write-Host 'DeepSeek ready: deepseek-flash / highest / 1M context / 384K output.'
    }
    Write-Host ('Reviewer profile: ' + $profile)
    if (!$InitializeOnly) {
        Get-ChildItem Env: | Where-Object { $_.Name -like 'CRAFTMINE_*' -or $_.Name -like 'PI_DESKTOP_*' } | ForEach-Object { [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process') }
        $env:CRAFTMINE_DATA_DIR = $profile
        $env:NODE_OPTIONS = $null
        $env:ELECTRON_RUN_AS_NODE = $null
        Start-Process -FilePath $application -WorkingDirectory $PSScriptRoot | Out-Null
    }
} catch {
    # Only our fixed codes can reach the terminal; exception text may otherwise contain a request.
    $code = $_.Exception.Message
    if ($code -cnotmatch '^REVIEWER_[A-Z0-9_]+$') { $code = 'REVIEWER_SETUP_FAILED' }
    [Console]::Error.WriteLine($code)
    [Console]::Error.WriteLine('Setup did not launch the app. Check the complete ZIP and key file, then retry. See the reviewer guide for manual setup.')
    exit 1
} finally {
    if ($null -ne $script:backend) { try { Stop-LocalBackend } catch { } }
    if ($ownsMutex -and $null -ne $mutex) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
}
