@echo off
chcp 65001 > nul
cd /d "%~dp0"
title 해양경찰 법령정보센터 서버 종료

echo ========================================================
echo   [해양경찰 법령정보센터] 실행 중인 로컬 서버를 종료합니다...
echo ========================================================

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 "') do (
    if not "%%a"=="0" (
        echo 포트 3001 사용 프로세스(PID: %%a)를 종료합니다.
        taskkill /F /PID %%a > nul 2>&1
    )
)

echo 서버 종료가 완료되었습니다.
timeout /t 2 > nul
