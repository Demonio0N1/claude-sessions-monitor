package main

import (
	"fmt"
	"hash/fnv"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	tmuxOnce sync.Once
	tmuxBin  string
)

// tmuxPath localiza tmux aunque el agente corra como servicio con PATH mínimo
// (launchd/systemd no incluyen /opt/homebrew/bin ni /usr/local/bin).
func tmuxPath() string {
	tmuxOnce.Do(func() {
		if p, err := exec.LookPath("tmux"); err == nil {
			tmuxBin = p
			return
		}
		for _, p := range []string{"/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"} {
			if _, err := os.Stat(p); err == nil {
				tmuxBin = p
				return
			}
		}
		tmuxBin = "tmux"
	})
	return tmuxBin
}

// tmuxCmd construye un comando tmux garantizando locale UTF-8: como servicio
// (launchd/systemd) no hay LANG, y en locale C el cliente tmux reemplaza por
// "_" cualquier byte no imprimible de los argumentos — rompía el formato con
// tabs de list-panes y corrompería prompts con acentos en send-keys.
func tmuxCmd(args ...string) *exec.Cmd {
	cmd := exec.Command(tmuxPath(), args...)
	env := os.Environ()
	hasUTF8 := false
	for _, e := range env {
		if (strings.HasPrefix(e, "LANG=") || strings.HasPrefix(e, "LC_ALL=") || strings.HasPrefix(e, "LC_CTYPE=")) &&
			strings.Contains(strings.ToUpper(e), "UTF-8") {
			hasUTF8 = true
			break
		}
	}
	if !hasUTF8 {
		loc := "en_US.UTF-8"
		if runtime.GOOS == "linux" {
			loc = "C.UTF-8"
		}
		env = append(env, "LANG="+loc, "LC_ALL="+loc)
	}
	cmd.Env = env
	return cmd
}

type Session struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"` // "tmux" | "process"
	Agent       string `json:"agent,omitempty"` // "claude" | "codex" | "opencode" | "cursor-agent" (ver agents.go)
	TmuxSession string `json:"tmuxSession,omitempty"`
	PID         int    `json:"pid"`
	Cwd         string `json:"cwd"`
	Project     string `json:"project"`
	StartedAt   int64  `json:"startedAt"` // epoch ms
	Status      string `json:"status"`
	LastEvent   string `json:"lastEvent,omitempty"`
	LastEventAt int64  `json:"lastEventAt,omitempty"`

	paneID string // interno: pane de tmux para capture-pane
}

type proc struct {
	pid, ppid int
	tty       string
	stat      string
	etime     string
	args      []string
}

type tmuxPane struct {
	session string
	paneID  string
	pid     int    // pane_pid: proceso raíz del pane (el shell)
	created int64  // session_created (epoch s)
	path    string // pane_current_path
}

// scanSessions detecta procesos de agentes de IA conocidos (claude, codex,
// opencode, cursor-agent — ver agents.go) y los cruza con panes de tmux y el
// estado reportado por los hooks. Es 100% pasivo (solo ps/lsof/tmux de lectura).
func scanSessions(hs *hookState) []Session {
	procs := listProcs()
	agentProcs := map[int]proc{}
	agentKindByPID := map[int]string{}
	for pid, p := range procs {
		if kind := detectAgentKind(p.args); kind != "" {
			agentProcs[pid] = p
			agentKindByPID[pid] = kind
		}
	}
	// descarta descendientes de otro proceso agente (helpers, shells hijos)
	roots := []proc{}
	for pid, p := range agentProcs {
		if !hasAgentAncestor(pid, procs, agentProcs) {
			roots = append(roots, p)
		}
	}

	panes := listTmuxPanes()
	if os.Getenv("CSM_DEBUG") != "" {
		keys := make([]string, 0, len(panes))
		for k := range panes {
			keys = append(keys, k)
		}
		ttys := []string{}
		for _, p := range roots {
			ttys = append(ttys, p.tty)
		}
		log.Printf("[scan-debug] bin=%q panes=%v agent_ttys=%v", tmuxPath(), keys, ttys)
	}
	sessions := make([]Session, 0, len(roots))
	usedPanes := map[string]bool{}
	for _, p := range roots {
		cwd := procCwd(p.pid)
		s := Session{
			PID:       p.pid,
			Agent:     agentKindByPID[p.pid],
			Cwd:       cwd,
			Project:   filepath.Base(cwd),
			StartedAt: startedFromEtime(p.etime),
		}
		if cwd == "" {
			s.Project = "(desconocido)"
		}
		if pane, ok := panes["/dev/"+p.tty]; ok {
			s.Kind = "tmux"
			s.TmuxSession = pane.session
			s.ID = "tmux:" + pane.paneID
			s.paneID = pane.paneID
			usedPanes[pane.paneID] = true
		} else {
			s.Kind = "process"
			s.ID = "pid:" + strconv.Itoa(p.pid)
		}
		s.Status, s.LastEvent, s.LastEventAt = hs.statusFor(cwd)
		// La pantalla del pane es la fuente más fiable: funciona para cualquier
		// sesión tmux aunque sus hooks sean viejos o el agente se haya reiniciado.
		if s.paneID != "" {
			switch paneActivity(s.paneID) {
			case "dialog":
				s.Status = "waiting_choice"
			case "working":
				s.Status = "active"
			}
		}
		if strings.HasPrefix(p.stat, "T") { // proceso detenido con SIGSTOP
			s.Status = "paused"
		}
		sessions = append(sessions, s)
	}

	// Terminales abiertos desde la app (tmux csm-sh-*): se publican con pantalla
	// en vivo aunque no corran Claude. Si dentro corre Claude, el pane ya quedó
	// reclamado arriba y no se duplica.
	for _, pane := range panes {
		if !strings.HasPrefix(pane.session, "csm-sh-") || usedPanes[pane.paneID] {
			continue
		}
		s := Session{
			ID:          "tmux:" + pane.paneID,
			Kind:        "tmux",
			TmuxSession: pane.session,
			PID:         pane.pid,
			Cwd:         pane.path,
			Project:     "Terminal · " + filepath.Base(pane.path),
			StartedAt:   pane.created * 1000,
			Status:      "idle",
			paneID:      pane.paneID,
		}
		if paneActivity(pane.paneID) == "working" {
			s.Status = "active"
		}
		if p, ok := procs[pane.pid]; ok && strings.HasPrefix(p.stat, "T") {
			s.Status = "paused"
		}
		sessions = append(sessions, s)
	}

	sort.Slice(sessions, func(i, j int) bool { return sessions[i].ID < sessions[j].ID })
	return sessions
}

func listProcs() map[int]proc {
	out, err := exec.Command("ps", "-axo", "pid=,ppid=,tty=,stat=,etime=,args=").Output()
	if err != nil {
		return nil
	}
	procs := map[int]proc{}
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Fields(line)
		if len(f) < 6 {
			continue
		}
		pid, err1 := strconv.Atoi(f[0])
		ppid, err2 := strconv.Atoi(f[1])
		if err1 != nil || err2 != nil {
			continue
		}
		procs[pid] = proc{pid: pid, ppid: ppid, tty: f[2], stat: f[3], etime: f[4], args: f[5:]}
	}
	return procs
}

// detectAgentKind identifica si args corresponde a uno de los agentes
// conocidos (knownAgents, agents.go) y devuelve su Kind, o "" si no es
// ninguno. Preserva exactamente la detección original de Claude Code
// (incluido el caso especial "claude-code" para instalaciones vía npm) y la
// generaliza al resto de binarios registrados.
func detectAgentKind(args []string) string {
	if len(args) == 0 {
		return ""
	}
	full := strings.Join(args, " ")
	if strings.Contains(full, "csm-agent") {
		return ""
	}
	// Un binario empaquetado dentro de una app de escritorio (.app/Contents/…)
	// no es una instalación de CLI real: evita falsos positivos como el
	// "codex" interno que corre ChatGPT.app (servidor MCP, no sesión de
	// terminal — se detectó probando este cambio en una Mac real).
	if strings.Contains(args[0], ".app/Contents/") {
		return ""
	}
	base := filepath.Base(args[0])
	for _, def := range knownAgents {
		if base == def.Bin {
			return def.Kind
		}
	}
	// instalaciones vía npm: node/bun ejecutando el cli directamente
	if base == "node" || base == "bun" {
		limit := len(args)
		if limit > 4 {
			limit = 4
		}
		for _, a := range args[1:limit] {
			for _, def := range knownAgents {
				if strings.HasSuffix(a, "/"+def.Bin) {
					return def.Kind
				}
				if def.Kind == "claude" && strings.Contains(a, "claude-code") {
					return def.Kind
				}
			}
		}
	}
	return ""
}

func hasAgentAncestor(pid int, procs map[int]proc, agentProcs map[int]proc) bool {
	cur := pid
	for i := 0; i < 32; i++ {
		p, ok := procs[cur]
		if !ok || p.ppid <= 1 {
			return false
		}
		if _, isAgent := agentProcs[p.ppid]; isAgent {
			return true
		}
		cur = p.ppid
	}
	return false
}

func procCwd(pid int) string {
	if runtime.GOOS == "linux" {
		link, err := os.Readlink(fmt.Sprintf("/proc/%d/cwd", pid))
		if err == nil {
			return link
		}
		return ""
	}
	// macOS: lsof del descriptor cwd
	out, err := exec.Command("lsof", "-a", "-p", strconv.Itoa(pid), "-d", "cwd", "-Fn").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "n") {
			return decodeLsofPath(line[1:])
		}
	}
	return ""
}

// decodeLsofPath deshace el escape \xHH que lsof aplica a bytes no-ASCII
// (p. ej. "ti\xcc\x81tulo" → "título").
func decodeLsofPath(s string) string {
	if !strings.Contains(s, `\x`) {
		return s
	}
	var b []byte
	for i := 0; i < len(s); {
		if i+3 < len(s) && s[i] == '\\' && s[i+1] == 'x' {
			if v, err := strconv.ParseUint(s[i+2:i+4], 16, 8); err == nil {
				b = append(b, byte(v))
				i += 4
				continue
			}
		}
		b = append(b, s[i])
		i++
	}
	return string(b)
}

var lastTmuxErr string

// listTmuxPanes devuelve pane_tty -> pane de todas las sesiones tmux.
// El nombre de sesión va al final y se parte con SplitN: puede contener "|".
func listTmuxPanes() map[string]tmuxPane {
	out, err := tmuxCmd("list-panes", "-a", "-F",
		"#{pane_tty}|#{pane_id}|#{pane_pid}|#{session_created}|#{pane_current_path}|#{session_name}").CombinedOutput()
	if err != nil {
		// tmux ausente o sin servidor no es un error, pero deja rastro si cambia
		msg := err.Error() + ": " + strings.TrimSpace(string(out))
		if msg != lastTmuxErr {
			lastTmuxErr = msg
			log.Printf("[scan] tmux list-panes falló (bin=%s): %s", tmuxPath(), msg)
		}
		return map[string]tmuxPane{}
	}
	lastTmuxErr = ""
	panes := map[string]tmuxPane{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.SplitN(line, "|", 6)
		if len(f) != 6 {
			continue
		}
		pid, _ := strconv.Atoi(f[2])
		created, _ := strconv.ParseInt(f[3], 10, 64)
		panes[f[0]] = tmuxPane{paneID: f[1], pid: pid, created: created, path: f[4], session: f[5]}
	}
	return panes
}

// paneTailHash guarda el hash del último tail visto por pane para detectar
// salida cambiando entre escaneos (= sesión trabajando); paneLastChange da
// histéresis para que el estado no parpadee entre herramientas lentas.
var (
	paneTailHash   = map[string]uint64{}
	paneLastChange = map[string]time.Time{}
)

// paneActivity clasifica lo que muestra el pane: "dialog" (esperando que el
// usuario elija una opción), "working" (Claude generando/ejecutando) o "".
func paneActivity(paneID string) string {
	out, err := tmuxCmd("capture-pane", "-p", "-t", paneID, "-S", "-25").Output()
	if err != nil {
		return ""
	}
	txt := string(out)

	for _, marker := range []string{
		"Do you want",      // "Do you want to proceed/create/allow…?"
		"Esc to cancel",    // pie de los diálogos (no confundir con "esc to interrupt")
		"❯ 1.",             // selector numerado con cursor
		"Enter to confirm", // diálogos de confianza/confirmación
		"(y/n)",
	} {
		if strings.Contains(txt, marker) {
			return "dialog"
		}
	}

	h := fnv.New64a()
	h.Write([]byte(txt))
	sum := h.Sum64()
	prev := paneTailHash[paneID]
	paneTailHash[paneID] = sum
	if prev != 0 && prev != sum {
		paneLastChange[paneID] = time.Now()
	}

	// "esc to interrupt" aparece en el pie mientras Claude trabaja; salida
	// cambiada hace <12s significa lo mismo (con margen para no parpadear).
	if strings.Contains(txt, "esc to interrupt") ||
		time.Since(paneLastChange[paneID]) < 12*time.Second {
		return "working"
	}
	return ""
}

// startedFromEtime convierte el formato [[dd-]hh:]mm:ss de ps a epoch ms.
func startedFromEtime(etime string) int64 {
	var days, hours, mins, secs int64
	if i := strings.IndexByte(etime, '-'); i >= 0 {
		days, _ = strconv.ParseInt(etime[:i], 10, 64)
		etime = etime[i+1:]
	}
	parts := strings.Split(etime, ":")
	switch len(parts) {
	case 3:
		hours, _ = strconv.ParseInt(parts[0], 10, 64)
		mins, _ = strconv.ParseInt(parts[1], 10, 64)
		secs, _ = strconv.ParseInt(parts[2], 10, 64)
	case 2:
		mins, _ = strconv.ParseInt(parts[0], 10, 64)
		secs, _ = strconv.ParseInt(parts[1], 10, 64)
	}
	elapsed := time.Duration(days*24+hours)*time.Hour + time.Duration(mins)*time.Minute + time.Duration(secs)*time.Second
	return time.Now().Add(-elapsed).UnixMilli()
}
