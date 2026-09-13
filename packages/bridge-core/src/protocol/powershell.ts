/**
 * Build the execution wrapper without interpolating raw user PowerShell.
 * Full marker literals are assembled remotely so terminal input echo cannot satisfy output detection.
 * ErrorRecord inspection is used instead of `$?` after `@(...)`, which is unreliable in Windows PowerShell 5.1.
 */
export function buildExecutionCommand(command: string, requestId: string): string {
  const commandB64 = Buffer.from(command, 'utf8').toString('base64');
  return [
    `$__uuCmd=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${commandB64}'))`,
    '$__uuError=$null',
    '$__uuExit=$null',
    '$__uuSuccess=$true',
    '$global:LASTEXITCODE=$null',
    "try { $__uuItems=@(& ([scriptblock]::Create($__uuCmd)) 2>&1); $__uuHadError=@($__uuItems | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }).Count -gt 0; $__uuText=($__uuItems | Out-String); if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { $__uuExit=[int]$LASTEXITCODE; $__uuSuccess=$false } elseif ($__uuHadError) { $__uuExit=1; $__uuSuccess=$false } else { $__uuExit=0; $__uuSuccess=$true } } catch { $__uuText=''; $__uuError=($_ | Out-String); $__uuExit=1; $__uuSuccess=$false }",
    '$__uuPayload=[ordered]@{stdout=$__uuText;success=$__uuSuccess;exitCode=$__uuExit;error=$__uuError} | ConvertTo-Json -Compress -Depth 4',
    '$global:__uuResultB64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($__uuPayload))',
    `$__uuMarker='__UU_META_' + '${requestId}' + '__'`,
    'Clear-Host',
    "Write-Output ($__uuMarker + ':' + $global:__uuResultB64.Length)",
  ].join('; ');
}
