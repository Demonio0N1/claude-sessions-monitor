package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Session struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"` // "tmux" | "process"
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
	etime     string
	args      []string
}

type tmuxPane struct {
	session string
	paneID  string
}

// scanSessions detecta procesos de Claude Code y los cruza con panes de tmux y
// el estado reportado por los hooks. Es 100% pasivo (solo ps/lsof/tmux de lectura).
func scanSessions(hs *hookState) []Session {
	procs := listProcs()
	claude := map[int]proc{}
	for pid, p := range procs {
		if isClaudeCmd(p.args) {
			claude[pid] = p
		}
	}
	// descarta descendientes de otro proceso claude (helpers, shells hijos)
	roots := []proc{}
	for pid, p := range claude {
		if !hasClaudeAncestor(pid, procs, claude) {
			roots = append(roots, p)
		}
	}

	panes := listTmuxPanes()
	sessions := make([]Session, 0, len(roots))
	for _, p := range roots {
		cwd := procCwd(p.pid)
		s := Session{
			PID:       p.pid,
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
		} else {
			s.Kind = "process"
			s.ID = "pid:" + strconv.Itoa(p.pid)
		}
		s.Status, s.LastEvent, s.LastEventAt = hs.statusFor(cwd)
		sessions = append(sessions, s)
	}
	sort.Slice(sessions, func(i, j int) bool { return sessions[i].ID < sessions[j].ID })
	return sessions
}

func listProcs() map[int]proc {
	out, err := exec.Command("ps", "-axo", "pid=,ppid=,tty=,etime=,args=").Output()
	if err != nil {
		return nil
	}
	procs := map[int]proc{}
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Fields(line)
		if len(f) < 5 {
			continue
		}
		pid, err1 := strconv.Atoi(f[0])
		ppid, err2 := strconv.Atoi(f[1])
		if err1 != nil || err2 != nil {
			continue
		}
		procs[pid] = proc{pid: pid, ppid: ppid, tty: f[2], etime: f[3], args: f[4:]}
	}
	return procs
}

func isClaudeCmd(args []string) bool {
	if len(args) == 0 {
		return false
	}
	full := strings.Join(args, " ")
	if strings.Contains(full, "csm-agent") {
		return false
	}
	base := filepath.Base(args[0])
	if base == "claude" {
		return true
	}
	// instalaciones vía npm: node/bun ejecutando el cli de claude-code
	if base == "node" || base == "bun" {
		limit := len(args)
		if limit > 4 {
			limit = 4
		}
		for _, a := range args[1:limit] {
			if strings.HasSuffix(a, "/claude") || strings.Contains(a, "claude-code") {
				return true
			}
		}
	}
	return false
}

func hasClaudeAncestor(pid int, procs map[int]proc, claude map[int]proc) bool {
	cur := pid
	for i := 0; i < 32; i++ {
		p, ok := procs[cur]
		if !ok || p.ppid <= 1 {
			return false
		}
		if _, isClaude := claude[p.ppid]; isClaude {
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

// listTmuxPanes devuelve pane_tty -> {session, paneID} de todas las sesiones tmux.
func listTmuxPanes() map[string]tmuxPane {
	out, err := exec.Command("tmux", "list-panes", "-a", "-F", "#{session_name}\t#{pane_tty}\t#{pane_id}").Output()
	if err != nil {
		return map[string]tmuxPane{} // tmux ausente o sin servidor: no es un error
	}
	panes := map[string]tmuxPane{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Split(line, "\t")
		if len(f) != 3 {
			continue
		}
		panes[f[1]] = tmuxPane{session: f[0], paneID: f[2]}
	}
	return panes
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
