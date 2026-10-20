# Run in an Administrator PowerShell to allow ESP32 reports from the local LAN.
$ErrorActionPreference = 'Stop'
$ruleName = 'BeamBi backend TCP 4000 (local subnet)'
$nodePath = (Get-Command node.exe).Source
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort 4000 -RemoteAddress LocalSubnet `
        -Program $nodePath -Profile Any | Out-Null
}
# An explicit block overrides an allow. Preserve the existing Node TCP block
# for every other port; permit 4000 only through the local-subnet rule above.
Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True |
    ForEach-Object {
        $rule = $_
        $application = $rule | Get-NetFirewallApplicationFilter
        if ($application.Program -ieq $nodePath) {
            $portFilter = $rule | Get-NetFirewallPortFilter
            if ($portFilter.Protocol -eq 'TCP' -and $portFilter.LocalPort -eq 'Any') {
                $portFilter | Set-NetFirewallPortFilter -LocalPort @('1-3999', '4001-65535') | Out-Null
            }
        }
    }
