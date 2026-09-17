#!/bin/sh
# hub-service.sh — gestiona el hub como servicio del sistema (arranca solo al encender).
#
#   ./scripts/hub-service.sh install     instala o actualiza el servicio y lo activa
#   ./scripts/hub-service.sh start       activa el hub (y su arranque automático)
#   ./scripts/hub-service.sh stop        desactiva el hub (deja de arrancar al encender)
#   ./scripts/hub-service.sh restart     reinicia el hub
#   ./scripts/hub-service.sh status      ¿está corriendo? + URL del panel
#   ./scripts/hub-service.sh logs        sigue el log en vivo (Ctrl-C para salir)
#   ./scripts/hub-service.sh uninstall   elimina el servicio (conserva datos y token)
#
# El runtime se copia a ~/.local/share/csm-hub/app y los datos (token, base de
# datos, log) viven en ~/.local/share/csm-hub/data. Así el servicio corre fuera
# de Escritorio/Documentos/Descargas, carpetas donde macOS no permite servicios
# launchd, y el repo puede vivir donde quieras.
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OS=$(uname -s)
INSTALL_DIR="${CSM_HUB_HOME:-$HOME/.local/share/csm-hub}"
APP_DIR="$INSTALL_DIR/app"
DATA_DIR="$INSTALL_DIR/data"
CONF="$INSTALL_DIR/config.env"
LOG="$DATA_DIR/hub.log"
PLIST="$HOME/Library/LaunchAgents/com.csm.hub.plist"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/csm-hub.service"

# El puerto se fija en el install (CSM_PORT=4001 ./scripts/hub-service.sh install)
# y queda guardado en config.env para el resto de comandos.
[ -f "$CONF" ] && . "$CONF"
HUB_PORT="${CSM_PORT:-4000}"

log() { printf '\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    AVISO: %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

panel_url() {
  ts_ip=$(command -v tailscale >/dev/null 2>&1 && tailscale ip -4 2>/dev/null | head -1 || true)
  [ -z "$ts_ip" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] \
    && ts_ip=$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 2>/dev/null | head -1 || true)
  echo "http://${ts_ip:-<ip-de-esta-máquina>}:$HUB_PORT"
}

hub_responde() { curl -fsS -m 2 "http://127.0.0.1:$HUB_PORT/api/ping" >/dev/null 2>&1; }

# Enlace del panel con el token (#t=): se abre una vez en cada dispositivo y la
# app/PWA lo guarda. El mismo token vale para instalar agentes (?t=).
print_access() {
  tok=$(cat "$DATA_DIR/token.txt" 2>/dev/null || true)
  echo "    Panel:    $(panel_url)/#t=${tok:-<token>}   (abre este enlace una vez en cada dispositivo)"
  echo "    Token:    ${tok:-?}   (agentes y app; archivo: $DATA_DIR/token.txt)"
  echo "    Agentes:  curl -fsSL \"$(panel_url)/install.sh?t=${tok:-<token>}\" | sh"
}

espera_hub() {
  i=0
  until hub_responde; do
    i=$((i + 1)); [ $i -gt 30 ] && die "el hub no responde en el puerto $HUB_PORT; revisa $LOG"
    sleep 1
  done
}

instalado() {
  if [ "$OS" = "Darwin" ]; then [ -f "$PLIST" ]; else [ -f "$UNIT" ]; fi
}

cmd_install() {
  [ -d "$REPO_DIR/hub/node_modules" ] || die "falta hub/node_modules: corre ./setup.sh (o cd hub && npm install)"
  [ -f "$REPO_DIR/web/dist/index.html" ] || die "falta el build de la web: corre ./setup.sh (o make build)"

  log "Instalando el hub como servicio (puerto $HUB_PORT)"
  mkdir -p "$DATA_DIR"
  printf 'CSM_PORT=%s\n' "$HUB_PORT" > "$CONF"

  # Migra token y base de datos de instalaciones viejas que corrían desde el repo,
  # para que los agentes ya registrados sigan autenticando con el mismo token.
  if [ ! -f "$DATA_DIR/token.txt" ] && [ -f "$REPO_DIR/hub/data/token.txt" ]; then
    log "Migrando datos existentes desde $REPO_DIR/hub/data"
    cp "$REPO_DIR/hub/data/token.txt" "$DATA_DIR/"
    for f in "$REPO_DIR/hub/data/csm.db" "$REPO_DIR/hub/data/csm.db-shm" "$REPO_DIR/hub/data/csm.db-wal"; do
      [ -f "$f" ] && cp "$f" "$DATA_DIR/"
    done
  fi

  # Para el servicio anterior (si existe) y cualquier hub suelto en el puerto.
  detener_servicio 2>/dev/null || true
  lsof -ti ":$HUB_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
  sleep 1

  log "Copiando runtime a $APP_DIR"
  rm -rf "$APP_DIR.tmp"
  mkdir -p "$APP_DIR.tmp/hub" "$APP_DIR.tmp/web"
  cp -R "$REPO_DIR/hub/src" "$REPO_DIR/hub/public" "$REPO_DIR/hub/package.json" \
        "$REPO_DIR/hub/node_modules" "$APP_DIR.tmp/hub/"
  cp -R "$REPO_DIR/web/dist" "$APP_DIR.tmp/web/dist"
  rm -rf "$APP_DIR"
  mv "$APP_DIR.tmp" "$APP_DIR"

  NODE_BIN=$(command -v node) || die "node no está en el PATH"
  TSX_CLI="$APP_DIR/hub/node_modules/tsx/dist/cli.mjs"
  [ -f "$TSX_CLI" ] || die "no encuentro tsx en $TSX_CLI"
  SVC_PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"

  if [ "$OS" = "Darwin" ]; then
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.csm.hub</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$TSX_CLI</string><string>src/index.ts</string></array>
  <key>WorkingDirectory</key><string>$APP_DIR/hub</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$SVC_PATH</string>
    <key>CSM_PORT</key><string>$HUB_PORT</string>
    <key>CSM_DATA_DIR</key><string>$DATA_DIR</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load -w "$PLIST"
  else
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT" <<EOF
[Unit]
Description=Claude Sessions Monitor hub

[Service]
Environment=PATH=$SVC_PATH
Environment=CSM_PORT=$HUB_PORT
Environment=CSM_DATA_DIR=$DATA_DIR
WorkingDirectory=$APP_DIR/hub
ExecStart="$NODE_BIN" "$TSX_CLI" src/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now csm-hub
    systemctl --user restart csm-hub
    loginctl enable-linger "$USER" 2>/dev/null \
      || warn "corre 'sudo loginctl enable-linger $USER' para que sobreviva al logout"
  fi

  espera_hub
  log "Hub activo y con arranque automático al encender la máquina"
  print_access
}

detener_servicio() {
  if [ "$OS" = "Darwin" ]; then
    launchctl unload -w "$PLIST" 2>/dev/null
  else
    systemctl --user disable --now csm-hub 2>/dev/null
  fi
}

cmd_start() {
  instalado || die "el servicio no está instalado: corre ./scripts/hub-service.sh install"
  if [ "$OS" = "Darwin" ]; then
    launchctl load -w "$PLIST" 2>/dev/null || true
  else
    systemctl --user enable --now csm-hub
  fi
  espera_hub
  log "Hub activo (arrancará solo al encender la máquina)"
  print_access
}

cmd_stop() {
  instalado || die "el servicio no está instalado"
  detener_servicio || true
  log "Hub desactivado (ya no arranca al encender la máquina)"
  echo "    Para volver a activarlo: ./scripts/hub-service.sh start"
}

cmd_restart() {
  instalado || die "el servicio no está instalado: corre ./scripts/hub-service.sh install"
  if [ "$OS" = "Darwin" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load -w "$PLIST"
  else
    systemctl --user restart csm-hub
  fi
  espera_hub
  log "Hub reiniciado"
}

cmd_status() {
  if ! instalado; then
    echo "servicio: no instalado (corre ./scripts/hub-service.sh install)"
  elif [ "$OS" = "Darwin" ]; then
    if launchctl list 2>/dev/null | grep -q com.csm.hub; then
      echo "servicio: activo (launchd, arranca al encender)"
    else
      echo "servicio: desactivado (./scripts/hub-service.sh start para activarlo)"
    fi
  else
    echo "servicio: $(systemctl --user is-active csm-hub 2>/dev/null || true) ($(systemctl --user is-enabled csm-hub 2>/dev/null || true) al encender)"
  fi
  if hub_responde; then
    echo "hub:      respondiendo en el puerto $HUB_PORT ✅"
    print_access
  else
    echo "hub:      NO responde en el puerto $HUB_PORT ❌  (log: $LOG)"
  fi
}

cmd_logs() {
  [ -f "$LOG" ] || die "aún no hay log en $LOG"
  tail -n 50 -f "$LOG"
}

cmd_uninstall() {
  detener_servicio 2>/dev/null || true
  rm -f "$PLIST" "$UNIT"
  [ "$OS" = "Linux" ] && systemctl --user daemon-reload 2>/dev/null || true
  rm -rf "$APP_DIR"
  log "Servicio eliminado"
  echo "    Se conservan datos y token en $DATA_DIR (bórralo a mano si no lo quieres)"
}

case "${1:-}" in
  install) cmd_install ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  uninstall) cmd_uninstall ;;
  *)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
