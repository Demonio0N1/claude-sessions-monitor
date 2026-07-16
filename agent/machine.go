package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// performMachineAction ejecuta una acción dirigida a la máquina (no a una sesión).
// Devuelve (ok, mensaje para el usuario, data opcional para la app).
func performMachineAction(action, path string, fresh bool) (bool, string, any) {
	switch action {
	case "list_dir":
		listing, err := listDir(path)
		if err != nil {
			return false, err.Error(), nil
		}
		return true, "", listing
	case "new_session":
		name, err := newSession(path, fresh)
		if err != nil {
			return false, err.Error(), nil
		}
		return true, fmt.Sprintf("sesión '%s' creada en %s", name, path), map[string]any{"session": name}
	}
	return false, "acción desconocida: " + action, nil
}

type dirEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type dirListing struct {
	Path    string     `json:"path"`
	Parent  string     `json:"parent,omitempty"`
	Home    string     `json:"home"`
	Entries []dirEntry `json:"entries"`
}

// listDir devuelve las subcarpetas de path (o de $HOME si path está vacío),
// para el navegador de carpetas de la app. Oculta las que empiezan por punto.
func listDir(path string) (*dirListing, error) {
	home, _ := os.UserHomeDir()
	if path == "" {
		path = home
	}
	path = filepath.Clean(path)
	ents, err := os.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("no puedo leer %s: %v", path, err)
	}
	dirs := []dirEntry{}
	for _, e := range ents {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		isDir := e.IsDir()
		if !isDir && e.Type()&os.ModeSymlink != 0 {
			if st, err := os.Stat(filepath.Join(path, name)); err == nil && st.IsDir() {
				isDir = true
			}
		}
		if isDir {
			dirs = append(dirs, dirEntry{Name: name, Path: filepath.Join(path, name)})
		}
	}
	sort.Slice(dirs, func(i, j int) bool {
		return strings.ToLower(dirs[i].Name) < strings.ToLower(dirs[j].Name)
	})
	parent := filepath.Dir(path)
	if parent == path {
		parent = ""
	}
	return &dirListing{Path: path, Parent: parent, Home: home, Entries: dirs}, nil
}

var (
	claudeOnce sync.Once
	claudeBin  string
)

// claudePath localiza el binario claude aunque el agente corra como servicio
// con PATH mínimo (launchd/systemd no incluyen ~/.local/bin ni homebrew).
func claudePath() string {
	claudeOnce.Do(func() {
		if p, err := exec.LookPath("claude"); err == nil {
			claudeBin = p
			return
		}
		home, _ := os.UserHomeDir()
		for _, p := range []string{
			filepath.Join(home, ".local", "bin", "claude"),
			filepath.Join(home, ".claude", "local", "claude"),
			"/opt/homebrew/bin/claude",
			"/usr/local/bin/claude",
			filepath.Join(home, "bin", "claude"),
			filepath.Join(home, ".npm-global", "bin", "claude"),
		} {
			if _, err := os.Stat(p); err == nil {
				claudeBin = p
				return
			}
		}
	})
	return claudeBin
}

// newSession crea una sesión tmux monitorizada corriendo Claude en dir,
// replicando el lanzador csm: mismo esquema de nombres y mismo wrapper sh -c
// (para que Claude no sea hijo directo de tmux y la pausa SIGSTOP se sostenga).
func newSession(dir string, fresh bool) (string, error) {
	if dir == "" {
		return "", fmt.Errorf("falta la carpeta donde abrir la sesión")
	}
	dir = filepath.Clean(dir)
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		return "", fmt.Errorf("%s no es una carpeta accesible", dir)
	}
	claude := claudePath()
	if claude == "" {
		return "", fmt.Errorf("no encuentro el binario 'claude' en esta máquina")
	}

	base := sessionBase(dir)
	name := base
	for i := 2; ; i++ {
		if tmuxCmd("has-session", "-t", "="+name).Run() != nil {
			break // nombre libre
		}
		out, _ := tmuxCmd("display-message", "-p", "-t", name, "#{pane_current_path}").Output()
		if strings.TrimSpace(string(out)) == dir {
			return "", fmt.Errorf("ya existe la sesión '%s' en esa carpeta", name)
		}
		name = fmt.Sprintf("%s-%d", base, i)
	}

	args := []string{claude}
	if !fresh && hasPreviousConversation(dir) {
		args = append(args, "--continue")
	}
	tmuxArgs := append([]string{"new-session", "-d", "-s", name, "-c", dir,
		"sh", "-c", `"$@"; :`, "csm-wrap"}, args...)
	if out, err := tmuxCmd(tmuxArgs...).CombinedOutput(); err != nil {
		return "", fmt.Errorf("tmux new-session: %v (%s)", err, strings.TrimSpace(string(out)))
	}
	return name, nil
}

// sessionBase replica session_base de csm: "csm-" + basename saneado.
func sessionBase(dir string) string {
	var b strings.Builder
	for _, r := range filepath.Base(dir) {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteRune('-')
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		s = "session"
	}
	return "csm-" + s
}

// hasPreviousConversation replica la detección de csm: ¿hay .jsonl en
// ~/.claude/projects/<cwd codificado>? La codificación reemplaza todo carácter
// no alfanumérico por '-'; probamos la variante por runas y por bytes para
// cubrir rutas con acentos.
func hasPreviousConversation(dir string) bool {
	home, err := os.UserHomeDir()
	if err != nil {
		return false
	}
	variants := map[string]bool{}
	var byRune strings.Builder
	for _, r := range dir {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			byRune.WriteRune(r)
		} else {
			byRune.WriteByte('-')
		}
	}
	variants[byRune.String()] = true
	byByte := make([]byte, len(dir))
	for i := 0; i < len(dir); i++ {
		c := dir[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			byByte[i] = c
		} else {
			byByte[i] = '-'
		}
	}
	variants[string(byByte)] = true
	for enc := range variants {
		matches, _ := filepath.Glob(filepath.Join(home, ".claude", "projects", enc, "*.jsonl"))
		if len(matches) > 0 {
			return true
		}
	}
	return false
}
