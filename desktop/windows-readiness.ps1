param([switch]$NoIsolatedMachineAvailable)
$ErrorActionPreference = 'Stop'
function Get-SigningCount([string]$Store) {
    try { return @{available=@(Get-ChildItem -LiteralPath $Store -CodeSigningCert -ErrorAction Stop | Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt [DateTime]::Now }).Count;checked=$true} }
    catch { return @{available=$null;checked=$false;errorClass=$_.Exception.GetType().Name} }
}
$craftmineReadiness = [ordered]@{
    format='craftmine.windows-readiness/1'
    checkedAt=[DateTime]::UtcNow.ToString('o')
    windowsVersion=[Environment]::OSVersion.Version.ToString()
    architecture=[Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    windowsSandboxExecutablePresent=(Test-Path -LiteralPath (Join-Path $env:WINDIR 'System32/WindowsSandbox.exe'))
    hyperVServicePresent=($null -ne (Get-Service -Name vmms -ErrorAction SilentlyContinue))
    virtualMachinePlatformServicePresent=($null -ne (Get-Service -Name vmcompute -ErrorAction SilentlyContinue))
    currentUserCodeSigning=Get-SigningCount 'Cert:/CurrentUser/My'
    localMachineCodeSigning=Get-SigningCount 'Cert:/LocalMachine/My'
    signingCredentialConfigured=([bool]$env:CSC_LINK -or [bool]$env:WIN_CSC_LINK)
    userReportsNoIsolatedMachine=$NoIsolatedMachineAvailable.IsPresent
    cleanWindowsVerified=$false
    installationExecuted=$false
    changesMade=@()
    limits=@('Read-only inventory does not prove a VM can boot.','Certificate inventory does not validate an external signing service.','No OS feature, certificate, account or installation was changed.')
}
$craftmineReadiness | ConvertTo-Json -Depth 5
