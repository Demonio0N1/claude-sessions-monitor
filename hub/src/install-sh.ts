export function installScript(baseUrl: string, token: string): string {
  return `#!/bin/sh
# Instalador del agente de Claude Sessions Monitor
set -eu

HUB="${baseUrl}"
TOKEN="${token}"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) echo "Arquitectura no soportada: $ARCH" >&2; exit 1 ;;
esac

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

echo "==> Descargando csm-agent ($OS-$ARCH) desde $HUB ..."
curl -fsSL "$HUB/bin/csm-agent-$OS-$ARCH" -o "$BIN_DIR/csm-agent"
chmod +x "$BIN_DIR/csm-agent"

echo "==> Descargando lanzador csm ..."
curl -fsSL "$HUB/bin/csm" -o "$BIN_DIR/csm"
chmod +x "$BIN_DIR/csm"

CONF_DIR="$HOME/.config/csm"
mkdir -p "$CONF_DIR"
if [ ! -f "$CONF_DIR/agent.json" ]; then
  cat > "$CONF_DIR/agent.json" <<EOF
{
  "hubUrl": "$HUB",
  "token": "$TOKEN",
  "machineName": "$(hostname -s)"
}
EOF
  chmod 600 "$CONF_DIR/agent.json"
  echo "==> Config creada en $CONF_DIR/agent.json"
else
  echo "==> Config existente en $CONF_DIR/agent.json (no se toca)"
fi

echo "==> Registrando hooks pasivos de Claude Code ..."
"$BIN_DIR/csm-agent" setup-hooks

echo "==> Instalando servicio (arranque automático) ..."
if ! "$BIN_DIR/csm-agent" service install; then
  echo "    No se pudo instalar el servicio. Puedes correr el agente a mano:"
  echo "    nohup $BIN_DIR/csm-agent run >> $CONF_DIR/agent.log 2>&1 &"
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo ""
  echo "AVISO: tmux no está instalado. Instálalo para tener visibilidad completa"
  echo "       (macOS: brew install tmux | Debian/Ubuntu: sudo apt install tmux)"
fi

echo ""
echo "Listo ✅  Lanza sesiones monitorizadas con: csm"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "AVISO: agrega $BIN_DIR a tu PATH (export PATH=\\"\\$HOME/.local/bin:\\$PATH\\")" ;;
esac
`;
}
