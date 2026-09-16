package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"sync"
)

// agentDef describe un CLI de IA que csm sabe detectar y lanzar. Añadir uno
// nuevo es agregar una entrada aquí (más, si aplica, su binario a knownAgents).
type agentDef struct {
	Kind  string // identificador estable, viaja en Session.Agent y en new_session
	Label string // para mensajes al usuario
	Bin   string // nombre del binario a buscar en PATH y rutas típicas

	// ExtraPaths: rutas fijas donde buscar el binario si no está en PATH
	// (el agente suele correr como servicio con PATH mínimo: launchd/systemd
	// no incluyen ~/.local/bin ni homebrew). {home} se sustituye por $HOME.
	ExtraPaths []string

	// ContinueFlag: flag confirmado para retomar la última conversación.
	// Vacío si no hay uno documentado — newSession no intentará --continue.
	ContinueFlag string
}

var knownAgents = []agentDef{
	{
		Kind: "claude", Label: "Claude Code", Bin: "claude", ContinueFlag: "--continue",
		ExtraPaths: []string{
			"{home}/.local/bin/claude",
			"{home}/.claude/local/claude",
			"/opt/homebrew/bin/claude",
			"/usr/local/bin/claude",
			"{home}/bin/claude",
			"{home}/.npm-global/bin/claude",
		},
	},
	{
		// Sin flag de resume confirmado: se lanza siempre limpio.
		Kind: "codex", Label: "Codex", Bin: "codex",
		ExtraPaths: []string{
			"{home}/.local/bin/codex",
			"/opt/homebrew/bin/codex",
			"/usr/local/bin/codex",
			"{home}/.npm-global/bin/codex",
		},
	},
	{
		Kind: "opencode", Label: "OpenCode", Bin: "opencode", ContinueFlag: "--continue",
		ExtraPaths: []string{
			"{home}/.local/bin/opencode",
			"/opt/homebrew/bin/opencode",
			"/usr/local/bin/opencode",
			"{home}/.npm-global/bin/opencode",
		},
	},
	{
		// Sin flag de resume confirmado: se lanza siempre limpio.
		Kind: "cursor-agent", Label: "Cursor CLI", Bin: "cursor-agent",
		ExtraPaths: []string{
			"{home}/.local/bin/cursor-agent",
			"/opt/homebrew/bin/cursor-agent",
			"/usr/local/bin/cursor-agent",
		},
	},
}

func findAgent(kind string) (agentDef, bool) {
	if kind == "" {
		kind = "claude"
	}
	for _, a := range knownAgents {
		if a.Kind == kind {
			return a, true
		}
	}
	return agentDef{}, false
}

var (
	agentBinMu    sync.Mutex
	agentBinCache = map[string]string{}
)

// agentBinPath localiza el binario de un agente, igual que la vieja
// claudePath() pero parametrizado: exec.LookPath primero, luego rutas fijas.
func agentBinPath(def agentDef) string {
	agentBinMu.Lock()
	if p, ok := agentBinCache[def.Kind]; ok {
		agentBinMu.Unlock()
		return p
	}
	agentBinMu.Unlock()

	bin := ""
	if p, err := exec.LookPath(def.Bin); err == nil {
		bin = p
	} else {
		home, _ := os.UserHomeDir()
		for _, raw := range def.ExtraPaths {
			p := raw
			if home != "" {
				p = replaceHome(raw, home)
			}
			if _, err := os.Stat(p); err == nil {
				bin = p
				break
			}
		}
	}

	agentBinMu.Lock()
	agentBinCache[def.Kind] = bin
	agentBinMu.Unlock()
	return bin
}

func replaceHome(p, home string) string {
	const marker = "{home}"
	if len(p) >= len(marker) && p[:len(marker)] == marker {
		return filepath.Join(home, p[len(marker):])
	}
	return p
}
