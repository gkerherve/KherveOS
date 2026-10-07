#!/bin/zsh
# Builds KherveOS.app (KherveOS in its own Mac window) and installs it in
# ~/Applications. Run from anywhere:   tools/macos/build_app.sh
# The app starts the KherveOS server and front end from this project folder.
set -euo pipefail

HERE=${0:A:h}
REPO=${HERE:h:h}
BUILD=$HERE/build
APP=$BUILD/KherveOS.app
DEST=${KHERVEOS_APP_DEST:-$HOME/Applications}

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# The program
swiftc -O -target "$(uname -m)-apple-macos13.0" -o "$APP/Contents/MacOS/KherveOS" "$HERE/KherveOS.swift" -framework Cocoa -framework WebKit

# The icon, from KherveOS's own
ICONSET=$BUILD/KherveOS.iconset
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
SRC=$REPO/public/icons/icon-512.png
for s in 16 32 128 256 512; do
  sips -z $s $s "$SRC" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/KherveOS.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>KherveOS</string>
  <key>CFBundleDisplayName</key><string>KherveOS</string>
  <key>CFBundleIdentifier</key><string>org.ktools.kherveos</string>
  <key>CFBundleExecutable</key><string>KherveOS</string>
  <key>CFBundleIconFile</key><string>KherveOS</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>KherveNote writes down what is said in a talk; the audio stays on this Mac.</string>
  <key>NSHumanReadableCopyright</key><string>Ktools — an OS for the people: free, open source (GPL-3.0)</string>
  <key>KherveOSRepo</key><string>$REPO</string>
</dict>
</plist>
PLIST

# Ad-hoc signature, enough to run on this Mac
codesign --force --deep --sign - "$APP" >/dev/null

mkdir -p "$DEST"
rm -rf "$DEST/KherveOS.app"
cp -R "$APP" "$DEST/"
echo "Installed $DEST/KherveOS.app"
