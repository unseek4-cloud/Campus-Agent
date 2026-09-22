param([string]$BaseUrl = 'http://localhost:8080')
$ErrorActionPreference = 'Stop'
function Send-GuideQuestion([string]$Path, [string]$Question) {
    $body = [Text.Encoding]::UTF8.GetBytes((@{ query = $Question } | ConvertTo-Json))
    return (Invoke-RestMethod -Method Post -Uri "$BaseUrl$Path" -ContentType 'application/json; charset=utf-8' -Body $body).data
}
foreach ($test in @(
    @{ question = '学生证丢了怎么办？'; code = 'STUDENT_CARD_REISSUE' },
    @{ question = '宿舍灯坏了怎么报修？'; code = 'DORM_REPAIR' },
    @{ question = '学校食堂几点开门？'; code = $null },
    @{ question = '学校心理咨询中心在哪里？'; code = $null }
)) {
    $result = Send-GuideQuestion '/api/services/recognize' $test.question
    if ($result.serviceCode -ne $test.code) { throw "Recognition failed: $($test.question)" }
    Write-Host "PASS recognition: $($test.question)"
}
$guide = Send-GuideQuestion '/api/rag/chat' '我的学生证丢了，应该怎么办？'
if ($guide.type -ne 'SERVICE_GUIDE' -or $guide.service.code -ne 'STUDENT_CARD_REISSUE' -or $guide.steps.Count -eq 0 -or $guide.currentStep -ne 1) {
    throw 'Structured guide response is incomplete. Import the example dataset first.'
}
Write-Host "PASS structured chat: steps=$($guide.steps.Count), aiEnhanced=$($guide.aiEnhanced)"
try {
    Invoke-RestMethod -Uri "$BaseUrl/api/services/9223372036854775807" | Out-Null
    throw 'Missing service unexpectedly exists.'
} catch {
    if (!$_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 404) { throw }
    Write-Host 'PASS missing service: HTTP 404'
}
Write-Host 'Core service guide checks passed. Stop Python and rerun to verify AI-offline fallback.'
