#!/usr/bin/env bash
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Установите Node.js 22.13 или новее: https://nodejs.org/'
  exit 1
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  echo 'Нужен Node.js 22.13 или новее.'
  exit 1
fi
if [ ! -f node_modules/.game-installed ]; then
  echo 'Устанавливаем зависимости. Нужен интернет.'
  npm ci
  touch node_modules/.game-installed
fi
echo 'После запуска откройте http://localhost:3001. Остановка: Ctrl+C.'
npm run dev -- --port 3001 --host 127.0.0.1
