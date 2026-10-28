@echo off
chcp 65001 > nul
cd /d "%~dp0"
title 해양경찰 법령정보센터 로컬 서버

echo ========================================================
echo   [해양경찰 법령정보센터] 로컬 웹앱 서버를 시작합니다.
echo   - 홈 화면 주소   : http://localhost:3001
echo   - 관리자 화면 주소: http://localhost:3001/admin.html
echo   - 종료하려면 이 창에서 Ctrl + C 를 누르거나 창을 닫으세요.
echo ========================================================
echo.

REM 서버가 구동된 직후(1초 뒤) 브라우저가 자동으로 열리도록 백그라운드 예약
start /b cmd /c "timeout /t 1 /nobreak > nul && start "" "http://localhost:3001/admin.html""

node --no-warnings src/server.js
pause
