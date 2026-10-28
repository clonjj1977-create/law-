# 해양경찰 법령정보센터 GitHub 푸시 스크립트 (PowerShell 전용)
$gitPath = "C:\Program Files\Git\cmd\git.exe"
if (-not (Test-Path $gitPath)) {
    $gitPath = "git"
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  [해양경찰 법령정보센터] GitHub 저장소로 업로드합니다." -ForegroundColor Cyan
Write-Host "  - 대상 저장소: https://github.com/clonjj1977-create/law-" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "최초 1회 GitHub 브라우저 로그인 창이 뜨면 [Authorize]를 눌러 승인해 주세요.`n" -ForegroundColor Green

& $gitPath push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host "  [성공] GitHub에 정상적으로 업로드되었습니다!" -ForegroundColor Green
    Write-Host "  이제 Vercel에서 즉시 배포할 수 있습니다." -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green
} else {
    Write-Host "`n========================================================" -ForegroundColor Red
    Write-Host "  [알림] 푸시가 완료되지 않았습니다." -ForegroundColor Red
    Write-Host "========================================================" -ForegroundColor Red
}
