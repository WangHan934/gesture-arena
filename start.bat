@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=8000

where python >nul 2>nul
if not errorlevel 1 (
  echo [Gesture Arena] 用 Python 启动本地服务器...
  echo [Gesture Arena] 浏览器将打开 http://localhost:%PORT%
  start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"
  python -m http.server %PORT%
  goto :end
)

where npx >nul 2>nul
if not errorlevel 1 (
  echo [Gesture Arena] 用 Node 启动本地服务器...
  echo [Gesture Arena] 浏览器将打开 http://localhost:%PORT%
  start "" cmd /c "timeout /t 3 >nul & start http://localhost:%PORT%"
  npx --yes http-server . -p %PORT% -c-1
  goto :end
)

echo [错误] 没有找到 Python 或 Node.js，二者装一个就行：
echo   Python: https://www.python.org/downloads/
echo   Node.js: https://nodejs.org/
pause

:end
