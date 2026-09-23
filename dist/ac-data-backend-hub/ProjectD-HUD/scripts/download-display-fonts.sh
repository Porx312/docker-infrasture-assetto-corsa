#!/usr/bin/env bash
# Download display fonts (Google Fonts OFL) into ProjectD-HUD/fonts/display/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/fonts/display"
BASE="https://github.com/google/fonts/raw/main"
OFL_BASE="$BASE/ofl"
APACHE_BASE="$BASE/apache"

mkdir -p "$DEST"

fetch() {
  local url="$1"
  local local_name="$2"
  echo "→ $local_name"
  curl -fsSL "$url" -o "$DEST/$local_name"
}

# Remove retired fonts (old DISPLAY_NAME registry).
rm -f "$DEST"/Teko-Variable.ttf "$DEST"/Oxanium-Variable.ttf \
  "$DEST"/ChakraPetch-*.ttf "$DEST"/Audiowide-Regular.ttf

fetch "$OFL_BASE/rajdhani/Rajdhani-Regular.ttf" Rajdhani-Regular.ttf
fetch "$OFL_BASE/rajdhani/Rajdhani-SemiBold.ttf" Rajdhani-SemiBold.ttf
fetch "$OFL_BASE/rajdhani/Rajdhani-Bold.ttf" Rajdhani-Bold.ttf

fetch "$OFL_BASE/orbitron/Orbitron%5Bwght%5D.ttf" Orbitron-Variable.ttf
fetch "$OFL_BASE/bebasneue/BebasNeue-Regular.ttf" BebasNeue-Regular.ttf

fetch "$OFL_BASE/medievalsharp/MedievalSharp.ttf" MedievalSharp.ttf
fetch "$OFL_BASE/cinzel/Cinzel%5Bwght%5D.ttf" Cinzel-Variable.ttf

fetch "$APACHE_BASE/permanentmarker/PermanentMarker-Regular.ttf" PermanentMarker-Regular.ttf

fetch "$OFL_BASE/zenkakugothicnew/ZenKakuGothicNew-Regular.ttf" ZenKakuGothicNew-Regular.ttf
fetch "$OFL_BASE/zenkakugothicnew/ZenKakuGothicNew-Bold.ttf" ZenKakuGothicNew-Bold.ttf
fetch "$OFL_BASE/zenkakugothicnew/ZenKakuGothicNew-Medium.ttf" ZenKakuGothicNew-Medium.ttf

# Minecraft Ten is not on Google Fonts — copy from ProjectD web assets when available.
MINECRAFT_SRC="${PROJECTD_MINECRAFT_TEN_TTF:-}"
if [[ -z "$MINECRAFT_SRC" && -f "$ROOT/../ProjectD/src/fonts/MinecraftTen.ttf" ]]; then
  MINECRAFT_SRC="$ROOT/../ProjectD/src/fonts/MinecraftTen.ttf"
fi
if [[ -z "$MINECRAFT_SRC" && -f "$ROOT/../ProjectD/public/fonts/MinecraftTen.ttf" ]]; then
  MINECRAFT_SRC="$ROOT/../ProjectD/public/fonts/MinecraftTen.ttf"
fi
if [[ -z "$MINECRAFT_SRC" && -f "$ROOT/../ProjectD/public/fonts/minecraft-ten.ttf" ]]; then
  MINECRAFT_SRC="$ROOT/../ProjectD/public/fonts/minecraft-ten.ttf"
fi
if [[ -n "$MINECRAFT_SRC" && -f "$MINECRAFT_SRC" ]]; then
  cp "$MINECRAFT_SRC" "$DEST/MinecraftTen.ttf"
  echo "→ MinecraftTen.ttf (from $MINECRAFT_SRC)"
else
  echo "SKIP: MinecraftTen.ttf — set PROJECTD_MINECRAFT_TEN_TTF or copy from ProjectD/src/fonts/"
fi

curl -fsSL "$OFL_BASE/rajdhani/OFL.txt" -o "$DEST/OFL.txt"

echo "Done: $(ls -1 "$DEST"/*.ttf 2>/dev/null | wc -l) TTF files in $DEST"
