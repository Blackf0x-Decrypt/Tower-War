@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Установите Node.js 22.13 или новее с https://nodejs.org/
  echo Затем снова откройте этот файл.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo Нужен Node.js 22.13 или новее.
  pause
  exit /b 1
)
if not exist node_modules\.game-installed (
  echo Устанавливаем зависимости. Нужен интернет, это может занять несколько минут.
  call npm ci
  if errorlevel 1 (
    echo Не удалось установить зависимости. Проверьте интернет и запустите файл снова.
    pause
    exit /b 1
  )
  type nul > node_modules\.game-installed
)
echo Откройте http://localhost:3001 после появления адреса Local.
echo Не закрывайте это окно во время игры. Для остановки нажмите Ctrl+C.
call npm run dev -- --port 3001 --host 127.0.0.1
pause
