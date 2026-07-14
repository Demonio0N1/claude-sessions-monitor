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

### Lanzar sesiones monitorizadas: `csm`

```bash
cd ~/mi-proyecto
csm                 # crea (o reconecta a) la sesión tmux "csm-mi-proyecto" y abre Claude
csm --resume        # los argumentos extra se pasan a claude
csm ls              # lista las sesiones csm
csm attach <nombre> # toma control manual de cualquier sesión
```

Dentro de tmux: `Ctrl-b d` te desconecta dejando a Claude trabajando.

## Seguridad

- Pensado para correr **dentro de una tailnet** (Tailscale): nada expuesto a internet.
- Los agentes se autentican con el token compartido (`hub/data/token.txt`, o env `CSM_TOKEN`).
- El receptor de hooks del agente solo escucha en 127.0.0.1.
- El canal de la app (navegador → hub) no pide login en el MVP: cualquier dispositivo de
  tu tailnet puede ver el panel. Si compartes la tailnet, añade auth antes.

## Limitaciones conocidas (MVP)

- El estado por hooks se correlaciona por **directorio de trabajo**: dos sesiones de
  Claude en el MISMO directorio comparten estado.
- La captura de terminal es un snapshot de pane cada 1 s (solo se envía si cambió).
- Si el agente se reinicia, los estados vuelven a "inactiva" hasta el siguiente evento.
- Sin control remoto todavía (fase 2), sin capturas gráficas (fase 3) ni push (fase 4).

## Roadmap

1. ✅ **MVP**: agentes + vista general + detalle con terminal en vivo.
2. ⬜ **Control**: enviar prompts (`tmux send-keys`), pausar/reanudar (SIGSTOP/SIGCONT),
   terminar — con confirmación.
3. ⬜ **Visualización gráfica**: captura bajo demanda, modo 1–2 fps, túnel de puertos
   para ver web apps generadas en remoto.
4. ⬜ **Notificaciones**: Web Push cuando una sesión termina, espera input o falla.
