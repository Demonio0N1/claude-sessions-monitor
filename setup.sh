#!/bin/sh
# setup.sh — instalación completa de Claude Sessions Monitor en esta máquina:
# dependencias (Node 20+, Go 1.22+, tmux) + build + hub como servicio + agente local.
#
#   git clone https://github.com/Demonio0N1/claude-sessions-monitor.git
#   cd claude-sessions-monitor && ./setup.sh
#
# Idempotente: puedes re-ejecutarlo tras un git pull para actualizar todo.
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OS=$(uname -s)
ARCH=$(uname -m)
GO_VERSION=1.23.4
HUB_PORT="${CSM_PORT:-4000}"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    AVISO: %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

SUDO=""
[ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  v=$(node -v); v=${v#v}; [ "${v%%.*}" -ge 20 ]
}

go_ok() {
  for g in go /usr/local/go/bin/go /opt/homebrew/bin/go; do
    if command -v "$g" >/dev/null 2>&1 || [ -x "$g" ]; then
      ver=$("$g" version 2>/dev/null | sed 's/.*go1\.\([0-9]*\).*/\1/') || continue
      [ -n "$ver" ] && [ "$ver" -ge 22 ] && GO_BIN=$(command -v "$g" || echo "$g") && return 0
    fi
  done
  return 1
}

# ---------- 1. dependencias ----------
log "Instalando dependencias del sistema"
case "$OS" in
  Darwin)
    command -v brew >/dev/null 2>&1 || die "necesitas Homebrew (https://brew.sh)"
    for pkg in node go tmux; do
      brew list "$pkg" >/dev/null 2>&1 || brew install "$pkg"
    done
    GO_BIN=$(command -v go || echo /opt/homebrew/bin/go)
    ;;
  Linux)
    if command -v apt-get >/dev/null 2>&1; then
      $SUDO apt-get update -qq
      $SUDO apt-get install -y -qq curl ca-certificates tmux git xz-utils >/dev/null
      if ! node_ok; then
        log "Instalando Node 22 (NodeSource)"
        curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash - >/dev/null
        $SUDO apt-get install -y -qq nodejs >/dev/null
      fi
    elif command -v dnf >/dev/null 2>&1; then
      $SUDO dnf install -y curl tmux git nodejs npm >/dev/null
    elif command -v pacman >/dev/null 2>&1; then
      $SUDO pacman -Sy --noconfirm --needed curl tmux git nodejs npm >/dev/null
    else
      warn "gestor de paquetes no reconocido: instala curl/tmux/node20+/go1.22+ a mano"
    fi
    if ! go_ok; then
      log "Instalando Go $GO_VERSION en /usr/local/go"
      case "$ARCH" in
        x86_64) garch=amd64 ;;
        aarch64 | arm64) garch=arm64 ;;
        *) die "arquitectura no soportada: $ARCH" ;;
      esac
      curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${garch}.tar.gz" -o /tmp/go.tgz
      $SUDO rm -rf /usr/local/go && $SUDO tar -C /usr/local -xzf /tmp/go.tgz && rm /tmp/go.tgz
      GO_BIN=/usr/local/go/bin/go
    fi
    ;;
  *) die "SO no soportado: $OS" ;;
esac
node_ok || die "node 20+ no disponible tras la instalación"
go_ok || die "go 1.22+ no disponible tras la instalación"
log "node $(node -v) · $($GO_BIN version | cut -d' ' -f3) · $(tmux -V)"

# ---------- 2. build ----------
log "Instalando dependencias npm y compilando"
(cd "$REPO_DIR/hub" && npm install --no-fund --no-audit --silent)
(cd "$REPO_DIR/web" && npm install --no-fund --no-audit --silent)
node "$REPO_DIR/scripts/gen-icons.mjs" >/dev/null
(cd "$REPO_DIR/web" && npm run build --silent >/dev/null)
log "Compilando binarios del agente (4 plataformas)"
mkdir -p "$REPO_DIR/hub/public/bin"
(
  cd "$REPO_DIR/agent"
  for target in darwin/arm64 darwin/amd64 linux/amd64 linux/arm64; do
    GOOS=${target%/*} GOARCH=${target#*/} "$GO_BIN" build -trimpath -ldflags '-s -w' \
      -o "$REPO_DIR/hub/public/bin/csm-agent-${target%/*}-${target#*/}" .
  done
)
cp "$REPO_DIR/agent/csm" "$REPO_DIR/hub/public/bin/csm"
chmod +x "$REPO_DIR/hub/public/bin/csm"

# ---------- 3. hub como servicio ----------
log "Instalando el hub como servicio (puerto $HUB_PORT)"
NODE_BIN=$(command -v node)
TSX_CLI="$REPO_DIR/hub/node_modules/tsx/dist/cli.mjs"
[ -f "$TSX_CLI" ] || die "no encuentro tsx en $TSX_CLI"
SVC_PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"

if [ "$OS" = "Darwin" ]; then
  case "$REPO_DIR" in
    "$HOME/Desktop"* | "$HOME/Documents"* | "$HOME/Downloads"*)
      # TCC de macOS bloquea a launchd en estas carpetas: arranque alternativo.
      warn "macOS no permite servicios launchd en Escritorio/Documentos/Descargas"
      warn "arranco el hub con nohup (no sobrevive reinicios); para el servicio completo clona el repo en \$HOME"
      mkdir -p "$REPO_DIR/hub/data"
      lsof -ti ":$HUB_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
      sleep 1
      (cd "$REPO_DIR/hub" && nohup "$NODE_BIN" "$TSX_CLI" src/index.ts >> data/hub.log 2>&1 &)
      DARWIN_NOHUP=1
      ;;
  esac
fi

if [ "$OS" = "Darwin" ] && [ -z "${DARWIN_NOHUP:-}" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.csm.hub.plist"
  mkdir -p "$HOME/Library/LaunchAgents" "$REPO_DIR/hub/data"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.csm.hub</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$TSX_CLI</string><string>src/index.ts</string></array>
  <key>WorkingDirectory</key><string>$REPO_DIR/hub</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$SVC_PATH</string><key>CSM_PORT</key><string>$HUB_PORT</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$REPO_DIR/hub/data/hub.log</string>
  <key>StandardErrorPath</key><string>$REPO_DIR/hub/data/hub.log</string>
</dict>
</plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST"
elif [ "$OS" = "Linux" ]; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/csm-hub.service" <<EOF
[Unit]
Description=Claude Sessions Monitor hub

[Service]
Environment=PATH=$SVC_PATH
Environment=CSM_PORT=$HUB_PORT
WorkingDirectory=$REPO_DIR/hub
ExecStart="$NODE_BIN" "$TSX_CLI" src/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now csm-hub
  systemctl --user restart csm-hub
  $SUDO loginctl enable-linger "$USER" 2>/dev/null || warn "corre 'sudo loginctl enable-linger $USER' para que sobreviva al logout"
fi

log "Esperando a que el hub responda"
i=0
until curl -fsS "http://127.0.0.1:$HUB_PORT/api/state" >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -gt 30 ] && die "el hub no arrancó; revisa $REPO_DIR/hub/data/hub.log"
  sleep 1
done

# ---------- 4. agente local ----------
log "Instalando el agente en esta máquina"
curl -fsSL "http://127.0.0.1:$HUB_PORT/install.sh" | sh

# ---------- 5. resumen ----------
TOKEN=$(cat "$REPO_DIR/hub/data/token.txt" 2>/dev/null || echo "?")
TS_IP=$(command -v tailscale >/dev/null 2>&1 && tailscale ip -4 2>/dev/null | head -1 || true)
log "Listo ✅"
echo "  Panel:          http://${TS_IP:-<ip-de-esta-máquina>}:$HUB_PORT  (ábrelo desde el celular vía Tailscale)"
echo "  Token agentes:  $TOKEN"
echo "  Otras máquinas: curl -fsSL http://${TS_IP:-<ip>}:$HUB_PORT/install.sh | sh"
echo "  Sesiones:       cd <proyecto> && csm   (agrega ~/.local/bin a tu PATH si hace falta)"
[ -z "$TS_IP" ] && warn "tailscale no detectado: instala https://tailscale.com para acceder desde el celular"
