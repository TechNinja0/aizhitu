#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22.22 或更高版本，然后重新启动。'
  exit 1
fi
exec node bin/zhitu.mjs
