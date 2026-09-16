package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// performMachineAction ejecuta una acción dirigida a la máquina (no a una sesión).
// Devuelve (ok, mensaje para el usuario, data opcional para la app).
func performMachineAction(action, path string, fresh bool, name, data, agentKind string, gateway bool) (bool, string, any) {
	switch action {
	case "list_dir":
		listing, err := listDir(path)
		if err != nil {
			return false, err.Error(), nil
		}
		return true, "", listing
	case "new_session":
		sess, err := newSession(path, fresh, agentKind, gateway)
		if err != nil {
			return false, err.Error(), nil
		}
		return true, fmt.Sprintf("sesión '%s' creada en %s", sess, path), map[string]any{"session": sess}
	case "screenshot":
		img, err := takeScreenshot()
		if err != nil {
			return false, err.Error(), nil
		}
		return true, "", map[string]any{"image": img}
	case "put_file":
		dest, size, err := putFile(path, name, data)
		if err != nil {
			return false, err.Error(), nil
		}
		return true, fmt.Sprintf("%s guardado (%d KB)", filepath.Base(dest), size/1024), map[string]any{"path": dest}
	case "get_file":
		uri, err := getFile(path)
		if err != nil {
			return false, err.Error(), nil
		}
		return true, "", map[string]any{"name": filepath.Base(path), "data": uri}
	case "delete_path":
		if err := deletePath(path); err != nil {
			return false, err.Error(), nil
		}
		return true, fmt.Sprintf("%s eliminado", filepath.Base(path)), nil
	case "rename_path":
		dest, err := renamePath(path, name)
		if err != nil {
			return false, err.Error(), nil
		}
		return true, fmt.Sprintf("renombrado a %s", filepath.Base(dest)), map[string]any{"path": dest}
	case "mkdir":
		dest, err := mkdirIn(path, name)
		if err != nil {
			return false, err.Error(), nil
		}
		return true, fmt.Sprintf("carpeta %s creada", filepath.Base(dest)), map[string]any{"path": dest}
	case "new_terminal":
		sess, err := newTerminal(path)
		if err != nil {
			return false, err.Error(), nil
		}
		return true, fmt.Sprintf("terminal '%s' abierto en %s", sess, path), map[string]any{"session": sess}
	}
	return false, "acción desconocida: " + action, nil
}

const maxDownloadMB = 50

// getFile devuelve el contenido de un archivo como data URI para descargarlo
// en el teléfono.
func getFile(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("falta la ruta del archivo")
	}
	st, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("no puedo leer %s: %v", path, err)
	}
	if st.IsDir() {
		return "", fmt.Errorf("%s es una carpeta", filepath.Base(path))
	}
	if st.Size() > maxDownloadMB*1024*1024 {
		return "", fmt.Errorf("%s pesa %d MB (máximo %d MB)", filepath.Base(path), st.Size()/1024/1024, maxDownloadMB)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return "data:application/octet-stream;base64," + base64.StdEncoding.EncodeToString(b), nil
}

// deletePath elimina un archivo, o una carpeta solo si está vacía (sin rm -rf:
// borrar árboles enteros desde el teléfono es demasiado fácil de lamentar).
func deletePath(path string) error {
	if path == "" {
		return fmt.Errorf("falta la ruta")
	}
	st, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("no existe %s", path)
	}
	if err := os.Remove(path); err != nil {
		if st.IsDir() {
			return fmt.Errorf("la carpeta no está vacía (borra su contenido primero)")
		}
		return err
	}
	return nil
}

func renamePath(path, newName string) (string, error) {
	if path == "" || strings.TrimSpace(newName) == "" {
		return "", fmt.Errorf("faltan la ruta o el nombre nuevo")
	}
	newName = filepath.Base(strings.TrimSpace(newName))
	dest := filepath.Join(filepath.Dir(path), newName)
	if dest == path {
		return dest, nil
	}
	if _, err := os.Lstat(dest); err == nil {
		return "", fmt.Errorf("ya existe %s", newName)
	}
	if err := os.Rename(path, dest); err != nil {
		return "", err
	}
	return dest, nil
}

func mkdirIn(dir, name string) (string, error) {
	if dir == "" || strings.TrimSpace(name) == "" {
		return "", fmt.Errorf("faltan la carpeta o el nombre")
	}
	dest := filepath.Join(dir, filepath.Base(strings.TrimSpace(name)))
	if _, err := os.Lstat(dest); err == nil {
		return "", fmt.Errorf("ya existe %s", filepath.Base(dest))
	}
	if err := os.Mkdir(dest, 0o755); err != nil {
		return "", err
	}
	return dest, nil
}

// putFile escribe en dir un archivo subido desde la app (contenido en base64,
// con o sin prefijo data URI). Si ya existe uno con ese nombre, agrega -2, -3…
// El destino especial "::tmp" guarda en la carpeta temporal de adjuntos: la usa
// el botón 📎 para pasarle capturas a Claude sin ensuciar el proyecto.
func putFile(dir, name, data string) (string, int, error) {
	if dir == "" || data == "" {
		return "", 0, fmt.Errorf("faltan la carpeta o el contenido del archivo")
	}
	if dir == "::tmp" {
		dir = filepath.Join(os.TempDir(), "csm-adjuntos")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", 0, err
		}
	}
	dir = filepath.Clean(dir)
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		return "", 0, fmt.Errorf("%s no es una carpeta accesible", dir)
	}
	// nombre saneado: sin rutas ni caracteres de control
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = "archivo"
	}
	if i := strings.IndexByte(data, ','); i >= 0 && strings.HasPrefix(data, "data:") {
		data = data[i+1:]
	}
	b, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return "", 0, fmt.Errorf("contenido inválido (base64): %v", err)
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	dest := filepath.Join(dir, name)
	for i := 2; ; i++ {
		if _, err := os.Lstat(dest); os.IsNotExist(err) {
			break
		}
		dest = filepath.Join(dir, fmt.Sprintf("%s-%d%s", stem, i, ext))
	}
	if err := os.WriteFile(dest, b, 0o644); err != nil {
		return "", 0, fmt.Errorf("no pude escribir %s: %v", dest, err)
	}
	return dest, len(b), nil
}

// takeScreenshot captura la pantalla principal de la máquina y la devuelve
// como data URI, reescalada para el teléfono. En macOS la primera vez hay que
// autorizar "Grabación de pantalla" a csm-agent en Ajustes del Sistema.
func takeScreenshot() (string, error) {
	tmp, err := os.CreateTemp("", "csm-shot-*")
	if err != nil {
		return "", err
	}
	path := tmp.Name()
	tmp.Close()
	defer os.Remove(path)

	mime := "image/jpeg"
	switch runtime.GOOS {
	case "darwin":
		if out, err := exec.Command("/usr/sbin/screencapture", "-x", "-t", "jpg", path).CombinedOutput(); err != nil {
			return "", fmt.Errorf("screencapture: %v (%s)", err, strings.TrimSpace(string(out)))
		}
		// reescala a 1600px de ancho para que viaje ligera (mejor esfuerzo)
		_ = exec.Command("/usr/bin/sips", "--resampleWidth", "1600", path).Run()
	case "linux":
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return "", fmt.Errorf("esta máquina no tiene entorno gráfico (servidor sin pantalla)")
		}
		mime = "image/png"
		captured := false
		for _, c := range [][]string{
			{"grim", path},                      // wayland
			{"gnome-screenshot", "-f", path},    // gnome
			{"scrot", "-o", path},               // x11
			{"import", "-window", "root", path}, // imagemagick
		} {
			if _, err := exec.LookPath(c[0]); err != nil {
				continue
			}
			if exec.Command(c[0], c[1:]...).Run() == nil {
				captured = true
				break
			}
		}
		if !captured {
			return "", fmt.Errorf("no encontré una herramienta de captura (instala scrot o gnome-screenshot)")
		}
	default:
		return "", fmt.Errorf("captura no soportada en %s", runtime.GOOS)
	}

	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return "", fmt.Errorf("la captura salió vacía")
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(b), nil
}

type dirEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Dir   bool   `json:"dir"`
	Size  int64  `json:"size,omitempty"`
	Mtime int64  `json:"mtime,omitempty"`
}

type dirListing struct {
	Path    string     `json:"path"`
	Parent  string     `json:"parent,omitempty"`
	Home    string     `json:"home"`
	Entries []dirEntry `json:"entries"`
}

// listDir devuelve carpetas y archivos de path (o de $HOME si está vacío) para
// el explorador de la app. Oculta los que empiezan por punto. Carpetas primero.
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
	entries := []dirEntry{}
	for _, e := range ents {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		full := filepath.Join(path, name)
		isDir := e.IsDir()
		var size, mtime int64
		if st, err := os.Stat(full); err == nil { // sigue symlinks
			isDir = st.IsDir()
			if !isDir {
				size = st.Size()
			}
			mtime = st.ModTime().UnixMilli()
		} else if !isDir {
			continue // symlink roto u otro artefacto ilegible
		}
		entries = append(entries, dirEntry{Name: name, Path: full, Dir: isDir, Size: size, Mtime: mtime})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Dir != entries[j].Dir {
			return entries[i].Dir // carpetas primero
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	parent := filepath.Dir(path)
	if parent == path {
		parent = ""
	}
	return &dirListing{Path: path, Parent: parent, Home: home, Entries: entries}, nil
}

// gatewayEnv: variables que apuntan un agente al gateway local de OmniRoute
// (http://localhost:20128, compatible OpenAI + Anthropic en /v1). Se ponen
// ambas porque cada CLI solo lee la que le corresponde; la que no usa se
// ignora. No se valida que OmniRoute esté corriendo: si no lo está, el CLI
// fallará al primer request (responsabilidad del usuario, no un bug de csm).
var gatewayEnv = []string{
	"ANTHROPIC_BASE_URL=http://localhost:20128",
	"OPENAI_BASE_URL=http://localhost:20128/v1",
}

// newSession crea una sesión tmux monitorizada corriendo el agente elegido
// (claude/codex/opencode/cursor-agent, ver agents.go) en dir, replicando el
// lanzador csm: mismo esquema de nombres y mismo wrapper sh -c (para que el
// proceso no sea hijo directo de tmux y la pausa SIGSTOP se sostenga).
func newSession(dir string, fresh bool, agentKind string, gateway bool) (string, error) {
	if dir == "" {
		return "", fmt.Errorf("falta la carpeta donde abrir la sesión")
	}
	dir = filepath.Clean(dir)
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		return "", fmt.Errorf("%s no es una carpeta accesible", dir)
	}
	def, ok := findAgent(agentKind)
	if !ok {
		return "", fmt.Errorf("agente desconocido: %q", agentKind)
	}
	bin := agentBinPath(def)
	if bin == "" {
		return "", fmt.Errorf("no encuentro el binario '%s' en esta máquina", def.Bin)
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

	args := []string{bin}
	if !fresh && def.ContinueFlag != "" {
		// hasPreviousConversation solo sabe leer el almacenamiento de Claude
		// Code (~/.claude/projects/…); para otros agentes con ContinueFlag
		// (hoy: OpenCode) se pasa el flag siempre que no sea "fresh" y que el
		// propio CLI decida si hay algo que retomar.
		if def.Kind != "claude" || hasPreviousConversation(dir) {
			args = append(args, def.ContinueFlag)
		}
	}
	if gateway {
		args = append(append([]string{"env"}, gatewayEnv...), args...)
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
	return "csm-" + sanitizeBase(dir)
}

func sanitizeBase(dir string) string {
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
	return s
}

// newTerminal abre una sesión tmux con el shell del usuario (sin Claude) en
// dir; el prefijo csm-sh- hace que el monitor la publique como sesión de
// terminal con pantalla en vivo.
func newTerminal(dir string) (string, error) {
	if dir == "" {
		return "", fmt.Errorf("falta la carpeta donde abrir el terminal")
	}
	dir = filepath.Clean(dir)
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		return "", fmt.Errorf("%s no es una carpeta accesible", dir)
	}
	base := "csm-sh-" + sanitizeBase(dir)
	name := base
	for i := 2; ; i++ {
		if tmuxCmd("has-session", "-t", "="+name).Run() != nil {
			break
		}
		name = fmt.Sprintf("%s-%d", base, i)
	}
	if out, err := tmuxCmd("new-session", "-d", "-s", name, "-c", dir, userShell()).CombinedOutput(); err != nil {
		return "", fmt.Errorf("tmux new-session: %v (%s)", err, strings.TrimSpace(string(out)))
	}
	return name, nil
}

// userShell localiza el shell de login: como servicio no hay $SHELL en el
// entorno, así que cae a los habituales por sistema.
func userShell() string {
	if s := os.Getenv("SHELL"); s != "" {
		return s
	}
	candidates := []string{"/bin/zsh", "/bin/bash", "/bin/sh"}
	if runtime.GOOS == "linux" {
		candidates = []string{"/bin/bash", "/usr/bin/bash", "/bin/zsh", "/bin/sh"}
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return "sh"
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
