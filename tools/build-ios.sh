#!/usr/bin/env bash
# 在 macOS 上一键生成可安装到 iPhone 的 .ipa（未签名版）。
# 用法: bash tools/build-ios.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(uname)" != "Darwin" ]; then
  echo "错误：iOS 原生打包必须在 macOS + Xcode 环境执行。" >&2
  echo "Windows / Linux 上可先使用 PWA 方式安装（见 README.md）。" >&2
  exit 1
fi
command -v node >/dev/null 2>&1 || { echo "错误：需要 Node.js 18+。" >&2; exit 1; }
command -v xcodebuild >/dev/null 2>&1 || { echo "错误：需要安装 Xcode 并执行 xcode-select --install。" >&2; exit 1; }

echo "==> 安装依赖"
npm install

if [ ! -d ios/App ]; then
  echo "==> 生成 iOS 原生工程"
  npx cap add ios
fi

echo "==> 同步 Web 资源到原生工程"
npx cap sync ios

echo "==> 替换应用图标为鱼缸图标"
ICONSET=ios/App/App/Assets.xcassets/AppIcon.appiconset
mkdir -p "$ICONSET"
cp www/icons/icon-1024.png "$ICONSET/icon-1024.png"
cat > "$ICONSET/Contents.json" <<'JSON'
{
  "images": [
    { "filename": "icon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024" }
  ],
  "info": { "author": "xcode", "version": 1 }
}
JSON

echo "==> 归档（不签名）"
mkdir -p build
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/App.xcarchive \
  CODE_SIGNING_ALLOWED=NO \
  archive

echo "==> 打包 .ipa"
rm -rf build/Payload
mkdir -p build/Payload
cp -R build/App.xcarchive/Products/Applications/App.app build/Payload/
(cd build && zip -qry CyberAqua-unsigned.ipa Payload)
rm -rf build/Payload

echo ""
echo "完成：build/CyberAqua-unsigned.ipa"
echo "未签名 ipa 可用 AltStore / Sideloadly / Apple Configurator 2 安装到 iPhone；"
echo "如需 TestFlight 或 App Store，请在 Xcode 中配置开发者证书后重新归档签名。"