#!/usr/bin/env bash
#
# Arranca, para y consulta el visor sin dejar procesos huérfanos.
#
#   ./scripts/claude-live.sh            # arranca en primer plano (Ctrl+C para parar)
#   ./scripts/claude-live.sh bg         # arranca en segundo plano
#   ./scripts/claude-live.sh status     # ¿está escuchando? ¿cuántas sesiones ve?
#   ./scripts/claude-live.sh stop       # lo para, aunque lo hubiera arrancado otra terminal
#   ./scripts/claude-live.sh restart    # stop + bg
#   ./scripts/claude-live.sh logs       # sigue el registro del modo segundo plano
#
# Variables: CLAUDE_LIVE_PORT (7317), CLAUDE_CONFIG_DIR (~/.claude)

set -uo pipefail

PORT="${CLAUDE_LIVE_PORT:-7317}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/claude-live"
PID_FILE="$STATE_DIR/server-$PORT.pid"
LOG_FILE="$STATE_DIR/server-$PORT.log"
URL="http://127.0.0.1:$PORT"

cd "$ROOT" || exit 1
mkdir -p "$STATE_DIR"

c_ok=$'\033[32m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '%s!%s %s\n' "$c_warn" "$c_off" "$*"; }
die()  { printf '%s✗%s %s\n' "$c_err" "$c_off" "$*" >&2; exit 1; }
dim()  { printf '%s%s%s\n' "$c_dim" "$*" "$c_off"; }

# PID que tiene el puerto abierto, venga de donde venga (otra terminal, un arranque anterior).
listening_pid() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
  elif command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1
  fi
}

responding() { curl -fsS --max-time 2 "$URL/api/health" 2>/dev/null; }

check_node() {
  command -v node >/dev/null 2>&1 || die "hace falta Node.js 20 o superior"
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
  [ "${major:-0}" -ge 20 ] || die "Node.js $major es demasiado antiguo: hacen falta 20 o más"
  [ -d node_modules ] || die "faltan dependencias: ejecuta npm install"
}

# Reconstruye el front solo si hace falta: si no existe, o si hay fuentes más nuevas.
ensure_build() {
  if [ ! -f web-dist/index.html ]; then
    say "compilando el front (primera vez)…"
    npm run build >/dev/null || die "falló la compilación; ejecuta 'npm run build' para ver el detalle"
    return
  fi
  local newer
  newer="$(find web src shared vite.config.ts -newer web-dist/index.html 2>/dev/null | head -1)"
  if [ -n "$newer" ]; then
    say "hay cambios sin compilar, reconstruyendo el front…"
    npm run build >/dev/null || die "falló la compilación; ejecuta 'npm run build' para ver el detalle"
  fi
}

cmd_status() {
  local pid health
  pid="$(listening_pid)"
  health="$(responding)"
  if [ -n "$health" ]; then
    ok "escuchando en $URL${pid:+ (pid $pid)}"
    if command -v python3 >/dev/null 2>&1; then
      printf '%s' "$health" | python3 -m json.tool 2>/dev/null || say "$health"
    else
      say "$health"
    fi
    [ -f "$LOG_FILE" ] && dim "registro: $LOG_FILE"
    return 0
  fi
  if [ -n "$pid" ]; then
    warn "el puerto $PORT está ocupado por el pid $pid, pero no responde como claude-live"
    return 1
  fi
  say "no está arrancado (puerto $PORT libre)"
  return 1
}

cmd_stop() {
  local stopped=0 pid
  # Primero el que arrancamos nosotros: se mata el grupo entero, que es lo que evita dejar
  # procesos hijos sueltos ocupando el puerto.
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE" 2>/dev/null)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
      stopped=1
    fi
    rm -f "$PID_FILE"
  fi
  pid="$(listening_pid)"
  if [ -n "$pid" ]; then
    kill -TERM "$pid" 2>/dev/null && stopped=1
    sleep 1
    pid="$(listening_pid)"
    [ -n "$pid" ] && kill -KILL "$pid" 2>/dev/null
  fi
  [ "$stopped" -eq 1 ] && ok "parado" || say "no había nada que parar en el puerto $PORT"
}

cmd_start() {
  check_node
  if responding >/dev/null; then
    warn "ya está escuchando en $URL — usa 'restart' si quieres reiniciarlo"
    exit 0
  fi
  local busy
  busy="$(listening_pid)"
  [ -n "$busy" ] && die "el puerto $PORT lo ocupa el pid $busy; páralo o usa CLAUDE_LIVE_PORT=otro"
  ensure_build
  ok "arrancando en $URL — Ctrl+C para parar"
  exec npm start
}

cmd_bg() {
  check_node
  if responding >/dev/null; then
    warn "ya está escuchando en $URL"
    exit 0
  fi
  local busy
  busy="$(listening_pid)"
  [ -n "$busy" ] && die "el puerto $PORT lo ocupa el pid $busy; páralo o usa CLAUDE_LIVE_PORT=otro"
  ensure_build
  # setsid le da su propio grupo de procesos, para poder pararlo entero después.
  if command -v setsid >/dev/null 2>&1; then
    setsid npm start >"$LOG_FILE" 2>&1 &
  else
    npm start >"$LOG_FILE" 2>&1 &
  fi
  echo $! >"$PID_FILE"
  for _ in $(seq 1 30); do
    sleep 0.5
    if responding >/dev/null; then
      ok "arrancado en segundo plano en $URL (pid $(cat "$PID_FILE"))"
      dim "registro: $LOG_FILE · para pararlo: $0 stop"
      exit 0
    fi
  done
  warn "no responde todavía; mira el registro: $LOG_FILE"
  exit 1
}

case "${1:-start}" in
  start)   cmd_start ;;
  bg)      cmd_bg ;;
  stop)    cmd_stop ;;
  restart) cmd_stop; cmd_bg ;;
  status)  cmd_status ;;
  logs)    [ -f "$LOG_FILE" ] && tail -f "$LOG_FILE" || die "no hay registro en $LOG_FILE" ;;
  -h|--help|help)
    sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    ;;
  *) die "orden desconocida: $1 (prueba: start, bg, stop, restart, status, logs)" ;;
esac
