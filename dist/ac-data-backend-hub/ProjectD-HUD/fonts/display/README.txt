Display fonts — Google Fonts (SIL Open Font License) + Minecraft Ten

Registry v2 (matches web DISPLAY_NAME_FONT_OPTIONS):
- rajdhani (Touge)
- orbitron (Neon HUD)
- bebas (Poster)
- minecraft_ten (Minecraft) — MinecraftTen.ttf, not on Google Fonts
- medievalsharp (Medieval)
- cinzel (Cinzel)
- permanent_marker (Marker)
- zen_kaku (Zen Kaku)

This folder must ship with the HUD app install (>=12 .ttf files). Without them the HUD falls back to BBH Bogle and will not match web typography.

Refresh:
  ./scripts/download-display-fonts.sh

Minecraft Ten: bundled from ProjectD `src/fonts/MinecraftTen.ttf` (or set PROJECTD_MINECRAFT_TEN_TTF=/path/to/MinecraftTen.ttf)

Removed fonts (legacy ids map to rajdhani): teko, oxanium, chakra, audiowide
