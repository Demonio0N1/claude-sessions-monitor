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
CONF_DIR="$HOME/.config/csm"
mkdir -p "$BIN_DIR" "$CONF_DIR"

echo "==> Descargando csm-agent ($OS-$ARCH) desde $HUB ..."
# descarga a un archivo temporal y reemplaza con inode nuevo: sobrescribir en
# sitio un binario en ejecución corrompe su firma en macOS (Killed: 9)
curl -fsSL "$HUB/bin/csm-agent-$OS-$ARCH" -o "$BIN_DIR/csm-agent.new"
chmod +x "$BIN_DIR/csm-agent.new"
rm -f "$BIN_DIR/csm-agent"
mv "$BIN_DIR/csm-agent.new" "$BIN_DIR/csm-agent"

# --- macOS: firma con una identidad local estable ---------------------------
# macOS recuerda los permisos (Acceso total al disco, Grabación de pantalla) por
# la firma del binario: sin firmar, cada actualización cambia su identidad y hay
# que volver a autorizarlo. Firmado con este certificado local (se crea una vez
# en un llavero propio, sin tocar el llavero de inicio de sesión) la identidad
# se mantiene y el permiso se da una sola vez.
if [ "$OS" = "darwin" ] && command -v codesign >/dev/null 2>&1 && [ -x /usr/bin/openssl ]; then
  KC="$CONF_DIR/codesign.keychain-db"
  KCPASS="$CONF_DIR/codesign.pass"
  if (
    set -e
    if [ ! -f "$KC" ] || [ ! -f "$KCPASS" ]; then
      echo "==> Creando identidad de firma local (una sola vez) ..."
      rm -f "$KC" "$KCPASS"
      umask 077
      /usr/bin/openssl rand -hex 16 > "$KCPASS"
      umask 022
      tmp=$(mktemp -d)
      cat > "$tmp/cfg" <<'CFG'
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = csm-agent
[v3]
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
basicConstraints = critical, CA:false
subjectKeyIdentifier = hash
CFG
      /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmp/k.pem" -out "$CONF_DIR/codesign.cer" -days 3650 -config "$tmp/cfg" -extensions v3 >/dev/null 2>&1
      /usr/bin/openssl pkcs12 -export -inkey "$tmp/k.pem" -in "$CONF_DIR/codesign.cer" -out "$tmp/p.p12" -passout pass:csm -name csm-agent
      security create-keychain -p "$(cat "$KCPASS")" "$KC"
      security set-keychain-settings "$KC"
      security import "$tmp/p.p12" -k "$KC" -P csm -T /usr/bin/codesign -T /usr/bin/security >/dev/null
      security set-key-partition-list -S apple-tool:,apple: -s -k "$(cat "$KCPASS")" "$KC" >/dev/null 2>&1 || true
      rm -rf "$tmp"
    fi
    security unlock-keychain -p "$(cat "$KCPASS")" "$KC" 2>/dev/null || true
    codesign --force --sign csm-agent --keychain "$KC" --identifier com.csm.agent "$BIN_DIR/csm-agent" 2>/dev/null
  ); then
    echo "==> csm-agent firmado con identidad local: los permisos de macOS se conservan al actualizar"
  else
    echo "    AVISO: no pude firmar csm-agent; macOS pedirá los permisos de nuevo tras cada actualización"
  fi
fi

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

# --- macOS: ¿tiene el servicio Acceso total al disco? (lo consulta al propio agente) ---
if [ "$OS" = "darwin" ]; then
  sleep 2
  hookport=$(grep -o '"hookPort": *[0-9]*' "$CONF_DIR/agent.json" 2>/dev/null | grep -o '[0-9]*$' || true)
  perms=$(curl -s -m 2 "http://127.0.0.1:\${hookport:-8787}/perms" 2>/dev/null || true)
  case "$perms" in
    *'"fullDisk":true'*) echo "==> Acceso total al disco: activado ✅" ;;
    *'"fullDisk":false'*)
      echo ""
      echo "==> FALTA un permiso de macOS (una sola vez): Acceso total al disco para csm-agent"
      echo "    Sin él, navegar por los archivos de esta Mac desde el teléfono pide permiso"
      echo "    carpeta por carpeta, y los avisos salen aquí, en la Mac."
      echo "    1) Se abre Ajustes → Privacidad y seguridad → Acceso total al disco."
      echo "    2) Pulsa + y elige csm-agent (queda seleccionado en la ventana del Finder que se abre)."
      echo "    3) Activa el interruptor. Gracias a la firma local no habrá que repetirlo al actualizar."
      open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" 2>/dev/null || true
      open -R "$BIN_DIR/csm-agent" 2>/dev/null || true ;;
  esac
fi

echo ""
echo "Listo ✅  Lanza sesiones monitorizadas con: csm"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "AVISO: agrega $BIN_DIR a tu PATH (export PATH=\\"\\$HOME/.local/bin:\\$PATH\\")" ;;
esac
`;
}
