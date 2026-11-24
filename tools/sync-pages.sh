#!/usr/bin/env bash
# 把 www/ 的最新内容同步到 pages 分支（GitHub Pages 经典分支部署源）。
# 用法: bash tools/sync-pages.sh   （需已 gh auth login 或配置好 git 凭据）
set -euo pipefail
cd "$(dirname "$0")/.."

TREE=$(git rev-parse HEAD:www)
MSG="pages: 同步 www 快照 $(date +%Y-%m-%d_%H:%M)"
C=$(git commit-tree "$TREE" -m "$MSG")
git push origin "$C":refs/heads/pages
echo "已推送 pages 分支，Pages 约 1 分钟内更新：https://zhouzhenxing745.github.io/cyber-aqua-pet/"