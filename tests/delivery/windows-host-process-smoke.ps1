[CmdletBinding()]
param([string]$OutputRoot='D:\cm-host-process-smoke-20260910')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../desktop/delivery/lib/windows-host-compatibility.ps1')
$base=Assert-CmPath $OutputRoot -DOnly;Assert-CmNoLinks $base
if(-not(Test-Path -LiteralPath $base)){New-Item -ItemType Directory -Path $base -ErrorAction Stop|Out-Null}
$out=Join-Path $base ([Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $out -ErrorAction Stop|Out-Null
$temp=Join-Path $out 'temp';New-Item -ItemType Directory -Path $temp|Out-Null
$oldTemp=$env:TEMP;$oldTmp=$env:TMP;$env:TEMP=$temp;$env:TMP=$temp
$report=@{format='craftmine.windows-host-process-smoke/1';installerInvocations=0;productInvocations=0;startedAt=[DateTime]::UtcNow.ToString('o');passed=$false;cases=@();limitations=@('Only owned no-window console helpers were run, never an installer.','Normal proof observes root exit code and Job active-zero, not strict descendant exit codes.','No actual QueryInformationJobObject failure was injected; timeout exercises the same bounded cleanup path.','No input/focus API or desktop switch was called.')}
$reportPath=Join-Path $out 'report.json'
function Save-Report {$report|ConvertTo-Json -Depth 16|Set-Content -LiteralPath $reportPath -Encoding UTF8}
function Require($Value,[string]$Code){if(-not $Value){throw $Code}}
try{
    Initialize-CmHostNative
    $source=Join-Path $PSScriptRoot 'fixtures/windows-host-process-smoke.cs';$exe=Join-Path $out 'owned-no-window.exe'
    Add-Type -Path $source -OutputAssembly $exe -OutputType ConsoleApplication -ReferencedAssemblies System.dll,System.Core.dll,System.Web.Extensions.dll
    [void][Reflection.Assembly]::LoadFile($exe)
    $report.launcherSourceSha256=Get-CmHash (Join-Path $PSScriptRoot '../../desktop/delivery/lib/windows-host-process.cs')
    $report.helperSourceSha256=Get-CmHash $source;$report.helperExeSha256=Get-CmHash $exe
    $report.inputDesktopBefore=[CraftmineWindowlessSmoke]::InputDesktopName()
    $report.testThreadDesktop=[CraftmineWindowlessSmoke]::CurrentDesktopName()
    foreach($mode in @('normal','nonzero','timeout')){
        $dir=Join-Path $out $mode;New-Item -ItemType Directory -Path $dir|Out-Null
        $case=@{mode=$mode;passed=$false;directory=$dir};$report.cases+=$case;Save-Report
        $timeout=if($mode -eq 'timeout'){2}else{10}
        $result=[CraftmineHostProcess]::Run($exe,('parent "'+$dir+'" '+$mode),$dir,$timeout)
        $case.processReceipt=$result;Save-Report
        $parent=Get-Content (Join-Path $dir 'parent-start.json') -Raw|ConvertFrom-Json
        $child=Get-Content (Join-Path $dir 'child-start.json') -Raw|ConvertFrom-Json
        $case.parent=$parent;$case.child=$child
        Require ($parent.pid -eq $result.RootPid) 'ROOT_PID_MISMATCH'
        Require ($parent.childPid -eq $child.pid) 'CHILD_PID_MISMATCH'
        Require ($parent.desktop -ceq $result.Desktop -and $child.desktop -ceq $result.Desktop) 'PRIVATE_DESKTOP_NOT_INHERITED'
        Require ($parent.inputDesktop -ceq $report.inputDesktopBefore -and $child.inputDesktop -ceq $report.inputDesktopBefore) 'INPUT_DESKTOP_CHANGED'
        Require ($parent.desktop -cne $parent.inputDesktop) 'HELPER_ON_INPUT_DESKTOP'
        Require ($result.DescendantExitCodes -ceq 'NOT_OBSERVED') 'DESCENDANT_EXIT_OVERCLAIM'
        if($mode -eq 'timeout'){
            Require (-not $result.Completed -and $result.Failure -like '*TimeoutException*') 'TIMEOUT_NOT_REPORTED'
            Require ($result.TerminationRequested -and $result.Cleanup -ceq 'terminated-confirmed' -and $result.JobActiveZero) 'TERMINATION_NOT_CONFIRMED'
            Require ($result.RootExitCode -eq 125 -and $result.DurationMs -lt 9000 -and $result.CleanupDurationMs -le 5100) 'TERMINATION_NOT_BOUNDED'
            Require (-not(Test-Path (Join-Path $dir 'child-finished.json'))) 'TIMEOUT_CHILD_RAN_TO_COMPLETION'
        }else{
            Require ($result.Completed -and $result.JobActiveZero -and $result.RootExitCode -eq 0 -and $result.Cleanup -ceq 'not-needed') 'NORMAL_LIFECYCLE_FAILED'
            Require (Test-Path (Join-Path $dir 'child-finished.json')) 'RETURNED_BEFORE_CHILD_FINISHED'
            $parentDone=Get-Content (Join-Path $dir 'parent-finished.json') -Raw|ConvertFrom-Json
            $childDone=Get-Content (Join-Path $dir 'child-finished.json') -Raw|ConvertFrom-Json
            Require ([DateTime]$childDone.at -gt [DateTime]$parentDone.at) 'FIXTURE_DID_NOT_OUTLIVE_PARENT'
        }
        $case.passed=$true;Save-Report
    }
    $report.inputDesktopAfter=[CraftmineWindowlessSmoke]::InputDesktopName()
    Require ($report.inputDesktopAfter -ceq $report.inputDesktopBefore) 'FINAL_INPUT_DESKTOP_CHANGED'
    $report.passed=$true
}catch{$report.fatal=$_.Exception.Message}
finally{$env:TEMP=$oldTemp;$env:TMP=$oldTmp;$report.finishedAt=[DateTime]::UtcNow.ToString('o');Save-Report}
Write-Output $reportPath
if(-not $report.passed){exit 1}
