#!/bin/sh
# setup.sh — instalación completa de Claude Sessions Monitor en esta máquina:
# dependencias (Node 20+, Go 1.22+, tmux) + build + hub como servicio + agente local.
#
#   git clone https://github.com/Demonio0N1/claude-sessions-monitor.git
#   cd claude-sessions-monitor && ./setup.sh
#
# Al arrancar pregunta si esta máquina va a tener su propio panel (hub) o si
# quieres sumarla al panel de OTRA máquina que ya tengas corriendo en tu
# tailnet (para verlas todas juntas en una sola página) — en ese caso se
# salta todo el build y solo instala el agente contra ese hub. Para saltarte
# la pregunta: CSM_JOIN_HUB=http://<ip>:4000 ./setup.sh (o "" para forzar
# instalación de hub nuevo sin preguntar, en modo no interactivo).
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

# macOS: el instalador del agente abre Ajustes si falta "Acceso total al disco";
# aquí (terminal interactiva) esperamos a que lo actives y lo comprobamos de
# nuevo preguntándole al propio servicio (desde la terminal no vale: mediría
# los permisos de la terminal, no los del agente).
mac_permisos() {
  [ "$OS" = "Darwin" ] || return 0
  hookport=$(grep -o '"hookPort": *[0-9]*' "$HOME/.config/csm/agent.json" 2>/dev/null | grep -o '[0-9]*$' || true)
  i=0
  while [ "$i" -lt 3 ]; do
    perms=$(curl -s -m 2 "http://127.0.0.1:${hookport:-8787}/perms" 2>/dev/null || true)
    case "$perms" in
      *'"fullDisk":true'*) log "Acceso total al disco: activado ✅"; return 0 ;;
      *'"fullDisk":false'*) ;;
      *) return 0 ;;
    esac
    [ -t 0 ] || return 0
    i=$((i + 1))
    printf "    Activa csm-agent en Acceso total al disco y presiona Enter para comprobar (s = saltar): "
    read -r ans || return 0
    [ "$ans" = "s" ] && return 0
    sleep 1
  done
  warn "Acceso total al disco sigue desactivado: navegar por archivos desde el teléfono pedirá permiso por carpeta"
}

SUDO=""
[ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"

# ---------- 0. ¿panel nuevo aquí o sumar esta máquina a uno que ya existe? ----------
# Detecta automáticamente paneles ya activos en tu tailnet (vía `tailscale
# status` + una prueba HTTP corta a cada candidato) para que elijas de una
# lista en vez de tener que saber/pegar la IP de memoria.
TS_BIN=""
if command -v tailscale >/dev/null 2>&1; then
  TS_BIN=tailscale
elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
  TS_BIN=/Applications/Tailscale.app/Contents/MacOS/Tailscale
fi

JOIN_HUB="${CSM_JOIN_HUB-}"
if [ -z "${CSM_JOIN_HUB+x}" ] && [ -t 0 ]; then
  FOUND_LIST=$(mktemp)
  if [ -n "$TS_BIN" ]; then
    log "Buscando paneles ya activos en tu tailnet..."
    SELF_IP=$("$TS_BIN" ip -4 2>/dev/null | head -1 || true)
    "$TS_BIN" status 2>/dev/null | awk -v self="$SELF_IP" \
      '$1 ~ /^100\./ && $1 != self && ($4 == "macOS" || $4 == "linux") { print $1"|"$2 }' \
      > /tmp/csm-setup-candidates.$$
    while IFS='|' read -r ip name; do
      [ -z "$ip" ] && continue
      curl -fsS -m 1 "http://$ip:$HUB_PORT/api/ping" >/dev/null 2>&1 \
        && printf '%s|%s\n' "$ip" "$name" >> "$FOUND_LIST"
    done < /tmp/csm-setup-candidates.$$
    rm -f /tmp/csm-setup-candidates.$$
  fi

  if [ -s "$FOUND_LIST" ]; then
    echo ""
    echo "Encontré estos paneles ya activos en tu tailnet:"
    i=0
    while IFS='|' read -r ip name; do
      i=$((i + 1))
      echo "  $i) $name ($ip)"
    done < "$FOUND_LIST"
    echo "  0) No, instalar el panel aquí (esta máquina será el hub)"
    printf "Elige una opción [0]: "
    read -r CHOICE || true
    CHOICE=${CHOICE:-0}
    if [ "$CHOICE" != "0" ]; then
      LINE=$(sed -n "${CHOICE}p" "$FOUND_LIST")
      if [ -n "$LINE" ]; then
        JOIN_HUB="http://${LINE%%|*}:$HUB_PORT"
      else
        warn "opción inválida, instalo el panel aquí"
      fi
    fi
  else
    echo ""
    echo "No encontré ningún panel activo en tu tailnet (o no detecté Tailscale)."
    echo "Si ya tienes uno en otra máquina, pega su URL; si no, déjalo vacío."
    printf "  URL del hub existente (ej. http://100.x.x.x:4000): "
    read -r JOIN_HUB || true
  fi
  rm -f "$FOUND_LIST"
fi

if [ -n "$JOIN_HUB" ]; then
  log "Sumando esta máquina al panel existente: $JOIN_HUB (sin instalar hub aquí)"
  if ! command -v tmux >/dev/null 2>&1; then
    log "Instalando tmux"
    case "$OS" in
      Darwin) command -v brew >/dev/null 2>&1 && brew install tmux ;;
      Linux)
        if command -v apt-get >/dev/null 2>&1; then
          $SUDO apt-get update -qq && $SUDO apt-get install -y -qq curl ca-certificates tmux >/dev/null
        elif command -v dnf >/dev/null 2>&1; then
          $SUDO dnf install -y curl tmux >/dev/null
        elif command -v pacman >/dev/null 2>&1; then
          $SUDO pacman -Sy --noconfirm --needed curl tmux >/dev/null
        else
          warn "gestor de paquetes no reconocido: instala tmux a mano"
        fi
        ;;
    esac
  fi
  # El instalador exige el token de ese hub (lo muestra ./scripts/hub-service.sh
  # status en esa máquina, o va en su enlace del panel como #t=...).
  JOIN_TOKEN="${CSM_JOIN_TOKEN-}"
  if [ -z "$JOIN_TOKEN" ] && [ -t 0 ]; then
    printf "  Token de ese hub (o pega su enlace del panel con #t=...): "
    read -r JOIN_TOKEN || true
  fi
  case "$JOIN_TOKEN" in *t=*) JOIN_TOKEN=$(printf '%s' "$JOIN_TOKEN" | sed 's/.*[#?&]t=\([0-9A-Za-z]*\).*/\1/') ;; esac
  [ -n "$JOIN_TOKEN" ] || die "hace falta el token del hub para instalar el agente"
  curl -fsSL "${JOIN_HUB%/}/install.sh?t=$JOIN_TOKEN" | sh
  mac_permisos
  log "Listo ✅ — esta máquina ya reporta a $JOIN_HUB"
  echo "  Panel:    $JOIN_HUB/#t=$JOIN_TOKEN  (ábrelo una vez desde el celular vía Tailscale)"
  echo "  Sesiones: cd <proyecto> && csm   (agrega ~/.local/bin a tu PATH si hace falta)"
  exit 0
fi

log "Instalando panel (hub) nuevo en esta máquina"

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
# hub-service.sh copia el runtime a ~/.local/share/csm-hub e instala el servicio
# (launchd en macOS, systemd de usuario en Linux) con arranque automático al encender.
CSM_PORT="$HUB_PORT" "$REPO_DIR/scripts/hub-service.sh" install

# ---------- 4. agente local ----------
log "Instalando el agente en esta máquina"
TOKEN=$(cat "$HOME/.local/share/csm-hub/data/token.txt" 2>/dev/null || die "no encuentro el token del hub")
curl -fsSL "http://127.0.0.1:$HUB_PORT/install.sh?t=$TOKEN" | sh
mac_permisos

# ---------- 5. resumen ----------
TS_IP=$([ -n "$TS_BIN" ] && "$TS_BIN" ip -4 2>/dev/null | head -1 || true)
log "Listo ✅"
echo "  Panel:          http://${TS_IP:-<ip-de-esta-máquina>}:$HUB_PORT/#t=$TOKEN"
echo "                  (ábrelo UNA vez en cada dispositivo: el enlace lleva el token y la app lo guarda)"
echo "  Token del hub:  $TOKEN   (agentes y app)"
echo "  Otras máquinas: curl -fsSL \"http://${TS_IP:-<ip>}:$HUB_PORT/install.sh?t=$TOKEN\" | sh"
echo "                  (o ./setup.sh allí y elegir este panel cuando pregunte)"
echo "  Sesiones:       cd <proyecto> && csm   (agrega ~/.local/bin a tu PATH si hace falta)"
echo "  Servidor:       ./scripts/hub-service.sh status|start|stop|logs"
[ -z "$TS_IP" ] && warn "tailscale no detectado: instala https://tailscale.com para acceder desde el celular"
