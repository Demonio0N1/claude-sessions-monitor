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
# descarga a un archivo temporal y reemplaza con inode nuevo: sobrescribir en
# sitio un binario en ejecución corrompe su firma en macOS (Killed: 9)
curl -fsSL "$HUB/bin/csm-agent-$OS-$ARCH" -o "$BIN_DIR/csm-agent.new"
chmod +x "$BIN_DIR/csm-agent.new"
rm -f "$BIN_DIR/csm-agent"
mv "$BIN_DIR/csm-agent.new" "$BIN_DIR/csm-agent"

echo "==> Descargando lanzador csm ..."
curl -fsSL "$HUB/bin/csm" -o "$BIN_DIR/csm.new"
chmod +x "$BIN_DIR/csm.new"
rm -f "$BIN_DIR/csm"
mv "$BIN_DIR/csm.new" "$BIN_DIR/csm"

CONF_DIR="$HOME/.config/csm"
mkdir -p "$CONF_DIR"
# Si ya hay config apuntando a este mismo hub, se respeta. Si apunta a OTRO hub
# (p. ej. esta máquina corría su propio hub y ahora quieres un panel central),
# se reescribe hacia este hub conservando el nombre de la máquina.
NAME="$(hostname -s)"
if [ -f "$CONF_DIR/agent.json" ]; then
  if grep -q "\\"hubUrl\\": \\"$HUB\\"" "$CONF_DIR/agent.json" \\
    && grep -q "\\"token\\": \\"$TOKEN\\"" "$CONF_DIR/agent.json"; then
    echo "==> Config existente en $CONF_DIR/agent.json (ya apunta a este hub)"
    NAME=""
  else
    PREV=$(sed -n 's/.*"machineName": *"\\([^"]*\\)".*/\\1/p' "$CONF_DIR/agent.json")
    [ -n "$PREV" ] && NAME="$PREV"
    echo "==> El agente apuntaba a otro hub; ahora apuntará a $HUB"
  fi
fi
if [ -n "$NAME" ]; then
  cat > "$CONF_DIR/agent.json" <<EOF
{
  "hubUrl": "$HUB",
  "token": "$TOKEN",
  "machineName": "$NAME"
}
EOF
  chmod 600 "$CONF_DIR/agent.json"
  echo "==> Config escrita en $CONF_DIR/agent.json"
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
