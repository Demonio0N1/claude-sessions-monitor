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

# Agrega este hub a la config del agente (acumulativo: el agente reporta a
# todos los hubs agregados a la vez, así cada máquina puede tener su panel).
echo "==> Registrando este hub en la config del agente ..."
"$BIN_DIR/csm-agent" add-hub "$HUB" "$TOKEN"

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
