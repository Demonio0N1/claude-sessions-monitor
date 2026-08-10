# Claude Sessions Monitor

Centro de control para ver y (próximamente) controlar todas tus sesiones de Claude Code,
estén en tu Mac o en servidores remotos. PWA mobile-first + hub central + agentes ligeros.

```
  celular / laptop (navegador, vía Tailscale)
        │  HTTP + WebSocket
        ▼
┌──────────────────────┐
│      HUB central      │  Node/TS + Fastify + SQLite (puerto 4000)
│  API + WS + PWA       │  Sirve también la web y el instalador del agente
└──────┬───────┬───────┘
       │       │   WebSocket SALIENTE desde cada agente (token)
   ┌───▼───┐ ┌─▼─────┐
   │Agente │ │Agente │   Binario Go único (~6 MB). Detecta sesiones (ps),
   │ Mac   │ │Server │   captura terminal (tmux) y estado semántico
   └───────┘ └───────┘   (hooks de Claude Code). 100% pasivo.
```

## Estructura

| Directorio | Qué es |
|---|---|
| `hub/` | Servidor central: Fastify + WebSocket + SQLite. Sirve la PWA y el instalador. |
| `web/` | PWA React + Vite + Tailwind + xterm.js (mobile-first, tema oscuro). |
| `agent/` | Agente en Go + lanzador `csm` (bash). |
| `scripts/` | Utilidades (generador de iconos PWA). |

## Cómo funciona la detección

- El agente escanea procesos (`ps`) cada 3 s buscando `claude` y obtiene PID, cwd
  (lsof en macOS, `/proc` en Linux) y tiempo activo.
- Si el proceso corre dentro de un pane de tmux (mapeo por TTY), la sesión es de tipo
  **tmux**: su pantalla se captura con `tmux capture-pane -e` (colores incluidos) y se
  transmite en vivo cuando alguien la está viendo. Fuera de tmux → **visibilidad limitada**
  (aparece con proyecto y estado, sin terminal).
- Los **hooks de Claude Code** (`SessionStart`, `UserPromptSubmit`, `Stop`, `Notification`,
  `SessionEnd`) hacen un `curl` al agente local (127.0.0.1:8787). De ahí sale el estado
  semántico: *activa*, *esperando input*, *terminada*. Si el agente está apagado, el curl
  falla en silencio (`|| true`) y Claude Code no se entera.
- El agente se conecta **hacia afuera** al hub por WebSocket con token; reconexión con
  backoff exponencial (1 s → 30 s). Si una máquina se cae, la UI la muestra atenuada con
  "visto hace X".

## Instalación completa en una máquina nueva (hub + agente)

```bash
git clone https://github.com/Demonio0N1/claude-sessions-monitor.git
cd claude-sessions-monitor && ./setup.sh
```

`setup.sh` instala las dependencias (Node 20+, Go 1.22+, tmux), compila la web y los
binarios del agente, deja el hub corriendo como servicio con **arranque automático al
encender la máquina** (launchd en macOS, systemd de usuario en Linux) e instala el
agente local. Al final imprime la URL del panel y el comando para sumar más máquinas
(que solo necesitan el one-liner del agente, no el repo).

El servicio no corre desde el repo: el runtime se copia a `~/.local/share/csm-hub/app`
y los datos (token, base de datos, log) viven en `~/.local/share/csm-hub/data`. Por eso
el repo puede estar donde quieras (incluso en el Escritorio, donde macOS no permite
servicios launchd) y puedes borrarlo o moverlo sin tumbar el servidor.

## Activar / desactivar el servidor (hub)

```bash
./scripts/hub-service.sh status     # ¿está corriendo? + URL del panel
./scripts/hub-service.sh stop      # desactivar: se apaga y deja de arrancar al encender
./scripts/hub-service.sh start     # activar: arranca ahora y en cada encendido
./scripts/hub-service.sh restart   # reiniciar
./scripts/hub-service.sh logs      # ver el log en vivo (Ctrl-C para salir)
./scripts/hub-service.sh install   # instalar o actualizar el servicio tras un git pull
./scripts/hub-service.sh uninstall # eliminar el servicio (conserva datos y token)
```

Los mismos comandos funcionan en macOS y Linux. Para usar otro puerto:
`CSM_PORT=4001 ./scripts/hub-service.sh install`.

## Desarrollo local

Requisitos: Node 20+, Go 1.22+, tmux.

```bash
# 1. Hub (puerto 4000; genera token en hub/data/token.txt al primer arranque)
cd hub && npm install && npm run dev

# 2. Web con hot-reload (puerto 5173, proxy hacia el hub)
cd web && npm install && npm run dev

# 3. Agente falso para poblar la UI sin máquinas reales
cd hub && npm run fake-agent
```

Abre http://localhost:5173 — verás la máquina `servidor-fake` con 3 sesiones, una de
ellas rotando de estado cada 5 s y con salida de terminal simulada.

## Producción (uso real)

La forma recomendada es `./setup.sh` (o `./scripts/hub-service.sh install` si ya
compilaste): deja el hub como servicio con arranque automático. Para correrlo a mano
en primer plano (pruebas, depuración):

```bash
make build          # compila la web y los binarios del agente (4 plataformas)
cd hub && npm start # sirve TODO en el puerto 4000: PWA + API + WS + instalador
```

El hub imprime el token al arrancar. Corre el hub en la máquina más estable de tu
tailnet (idealmente una que esté siempre encendida).

### Instalar el agente en una máquina (un comando)

```bash
curl -fsSL http://<ip-tailscale-del-hub>:4000/install.sh | sh
```

Esto descarga el binario para tu OS/arquitectura, escribe `~/.config/csm/agent.json`,
registra los hooks (con backup `settings.json.csm-backup` la primera vez) e instala el
servicio (launchd en macOS, systemd de usuario en Linux). En servidores Linux, para que
el agente sobreviva al logout: `sudo loginctl enable-linger $USER`.

### Varias máquinas en un solo panel (y paneles redundantes)

Cada agente puede reportar a **varios hubs a la vez**: cada `install.sh` que corras
**agrega** ese hub a la config del agente (`~/.config/csm/agent.json`, lista `hubs`),
sin quitar los anteriores. Todas las máquinas conectadas a un hub aparecen juntas en
su página.

**Modo simple (un panel):** elige la máquina más estable como hub y en todas las
máquinas (incluida ella) corre su instalador:

```bash
curl -fsSL http://<ip-del-hub>:4000/install.sh | sh
```

**Modo redundante (el panel funciona aunque se caiga una máquina):** deja el hub
corriendo en cada máquina y, **en cada máquina, corre el install.sh de cada hub**
que quieras usar como panel. Ejemplo con dos máquinas A y B:

```bash
# en A y también en B:
curl -fsSL http://<ip-de-A>:4000/install.sh | sh
curl -fsSL http://<ip-de-B>:4000/install.sh | sh
```

Resultado: los agentes de A y B reportan a ambos hubs, así que la página de A y la
de B muestran lo mismo. Si A está apagada, abres la de B y sigues viendo y
controlando todo lo que esté encendido.

Para dejar de reportar a un hub: `csm-agent remove-hub http://<ip>:4000`.

### Lanzar sesiones monitorizadas: `csm`

```bash
cd ~/mi-proyecto
csm                 # crea (o reconecta a) la sesión tmux "csm-mi-proyecto" y abre Claude
                    # si hay conversación previa en el directorio, la retoma con --continue
csm --new           # ignora la conversación previa y empieza de cero
csm ls              # lista las sesiones csm
csm attach          # vuelve a tu sesión (si hay varias, las lista para elegir)
csm attach <nombre> # toma control manual de una sesión concreta
```

Dentro de tmux: `Ctrl-b d` te desconecta dejando a Claude trabajando.

**La sesión sobrevive a cortes de conexión.** Si estás por SSH y se cae internet o
se cierra el terminal, Claude sigue corriendo dentro de tmux. Al reconectarte basta
con `csm attach` (o `csm` en la misma carpeta) para volver exactamente donde estabas.
Al reengancharte se expulsan los clientes fantasma del SSH caído (evita la ventana
congelada o encogida). En Linux con systemd, csm arranca el servidor tmux con
`systemd-run --user --scope` para que sobreviva incluso si logind está configurado
para matar procesos al cerrar sesión (`KillUserProcesses=yes`).

Detalle técnico: csm lanza Claude envuelto en `sh -c` para que no sea hijo directo de
tmux — si lo fuera, tmux le enviaría SIGCONT automáticamente y la pausa (SIGSTOP)
desde la app no se sostendría. Sesiones creadas con versiones viejas de csm no se
pueden pausar (la app lo avisa); basta terminarlas y relanzarlas con `csm`.

### Control remoto desde la app (fase 2)

- **+ Nueva sesión** (cabecera de cada máquina online): abre un navegador de
  carpetas de esa máquina, eliges dónde y se lanza una sesión csm ahí (tmux +
  Claude, con `--continue` si esa carpeta ya tenía conversación; la casilla
  "empezar de cero" lo evita). La sesión aparece en el panel en segundos.
- **📸 Captura de pantalla** (cabecera de cada máquina online): pide al agente una
  foto de la pantalla de esa máquina y la muestra en el teléfono (mantén pulsada la
  imagen para guardarla). En macOS hay que autorizar **csm-agent** una vez en
  Ajustes del Sistema → Privacidad y seguridad → **Grabación de pantalla** (y de
  nuevo si se reinstala el agente, porque el binario cambia). En Linux usa
  grim/gnome-screenshot/scrot/import según haya sesión gráfica.
- **📁 Archivos** (cabecera de cada máquina, y 📁 dentro de cada sesión abriendo
  en su carpeta): explorador completo de la máquina — carpetas y archivos con
  tamaño, subir fotos de la galería o archivos (varios, hasta 30 MB c/u, sin
  pisar existentes), descargar al teléfono (hasta 50 MB), renombrar, eliminar
  (carpetas solo vacías) y crear carpetas.
- **🖥 Terminal aquí / ✳️ Claude aquí** (pie del explorador): abre en la carpeta
  actual una sesión de Claude o un **terminal libre** (tmux `csm-sh-*` con tu
  shell). Los terminales aparecen como sesiones "Terminal · carpeta" con
  pantalla en vivo: puedes mandarles comandos desde el campo de texto (p. ej.
  `csm` para lanzar Claude monitorizado, o cualquier comando de consola).

En el detalle de una sesión:

- **Enviar prompts** (solo sesiones tmux): campo de texto al pie de la terminal, con
  historial local de enviados (botón 🕘) y protección contra doble envío. El texto se
  inyecta con `tmux send-keys` y la respuesta se ve en la terminal en vivo.
- **📎 Adjuntar capturas a Claude**: el clip del campo de texto sube fotos de la
  galería a una carpeta temporal de la máquina (`$TMPDIR/csm-adjuntos`) e inserta
  sus rutas en el mensaje; al enviarlo, Claude abre la ruta y ve la imagen.
- **Scroll en la terminal**: desliza hacia arriba para leer el historial (hasta
  ~1000 líneas); mientras lees, la vista no salta con las actualizaciones y el
  botón «⬇ en vivo» te devuelve al presente.
- **⏸ Pausar / ▶ Reanudar**: SIGSTOP/SIGCONT; la sesión queda con el estado azul
  "Pausada". El agente verifica que la pausa se sostuvo antes de confirmar.
- **⏹ Terminar**: confirmación obligatoria mostrando sesión y máquina; envía SIGTERM
  y, si el proceso sigue vivo a los ~6 s, ofrece forzar con SIGKILL.

Las sesiones de visibilidad limitada (fuera de tmux) solo admiten pausar/terminar
(señales al PID); la app muestra cómo migrarlas a csm.

## Seguridad

- Pensado para correr **dentro de una tailnet** (Tailscale): nada expuesto a internet.
- Los agentes se autentican con el token compartido (`hub/data/token.txt`, o env `CSM_TOKEN`).
- El receptor de hooks del agente solo escucha en 127.0.0.1.
- El canal de la app (navegador → hub) no pide login en el MVP: cualquier dispositivo de
  tu tailnet puede ver el panel. Si compartes la tailnet, añade auth antes.

## Limitaciones conocidas

- El estado por hooks se correlaciona por **directorio de trabajo**: dos sesiones de
  Claude en el MISMO directorio comparten estado.
- La captura de terminal es un snapshot de pane cada 1 s (solo se envía si cambió).
- Si el agente se reinicia, los estados vuelven a "inactiva" hasta el siguiente evento.
- Pausar congela el proceso principal de Claude; comandos hijos ya lanzados (tests,
  builds) siguen corriendo hasta terminar.

## Notas de implementación (aprendidas a golpes)

- **Locale y tmux como servicio**: bajo launchd/systemd no hay `LANG`, y en locale C
  el cliente tmux reemplaza por `_` cualquier byte no imprimible de sus argumentos
  (rompía formatos con tab y corrompería prompts con acentos). El agente fuerza un
  locale UTF-8 en cada llamada a tmux (`tmuxCmd`).
- **tmux reanuda a sus hijos directos**: si el proceso del pane recibe SIGSTOP, el
  servidor tmux le manda SIGCONT al instante. Por eso csm envuelve a Claude en `sh -c`.
- **PATH mínimo en servicios**: el agente localiza el binario tmux por sí mismo
  (`/opt/homebrew/bin`, `/usr/local/bin`, …), no confía en el PATH del servicio.
- **lsof escapa no-ASCII**: los cwd con tildes llegan como `\xNN` y se decodifican.

## Roadmap

1. ✅ **MVP**: agentes + vista general + detalle con terminal en vivo.
2. ✅ **Control**: enviar prompts (`tmux send-keys`), pausar/reanudar (SIGSTOP/SIGCONT),
   terminar (SIGTERM→SIGKILL) — con confirmación y toasts.
3. ⬜ **Visualización gráfica**: captura bajo demanda, modo 1–2 fps, túnel de puertos
   para ver web apps generadas en remoto.
4. ⬜ **Notificaciones**: Web Push cuando una sesión termina, espera input o falla.
