Battle HUD assets (canvas nativo: bg.png 3010×469)

Archivos:
  container.png                                     — marco exterior (opcional, se dibuja ANTES que bg)
  bg.png                                            — fondo / watermark interior
  center_matchmaking.png                          — pairing / sin rival / filler pre-arming y post-cancel
  center_vs.png                                   — armed
  center_countdown.png                            — arming / launching
  center_points.png                               — active
  center_cancelled.png                            — cancelled
  center-result.png                               — winner (avatar + nombre + 1-0 en caja)
  center-draw.png                                 — empate (opcional; si falta, solo texto DRAW)
  searching_rival_text_and_playeravatarUndefine.png — overlay derecho sin oponente (697×442: texto + ?)
  gap_track.png / gap_fill.png                    — barra 3D (opcional; fallback procedural)

Posiciones editables: common/layout.lua → layout.BATTLE_DESIGN
Canvas: layout.BATTLE_NATIVE (debe coincidir con bg.png).

Texto dinámico (scores, countdown, LEAD, eventos) — cx / cy / ty en BATTLE_DESIGN:
  Marco: slot center (1050×469), centrado en la barra. No mueve los PNG center_*.png.
  cx  — px desde el centro del slot (nativo 3010). Negativo = izquierda.
  cy  — fracción 0..1 del alto del slot (0 arriba, 1 abajo).
  ty  — ajuste fino vertical en px nativos (+ bajar, - subir). Opcional.
  Fuentes: score_fs, countdown_fs, role_fs, event_fs, hint_fs.
  Guía completa: comentario sobre center_role en layout.lua.

Debug mock state (consola CSP):
  ac.storage("ProjectD-HUD:battle_mock_state", "matchmaking")
  Valores: matchmaking | vs | countdown | active | cancelled | result | draw
