package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type HubEntry struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

type Config struct {
	// Formato viejo (un solo hub); se migra a Hubs con 'csm-agent add-hub'.
	HubURL string `json:"hubUrl,omitempty"`
	Token  string `json:"token,omitempty"`
	// El agente reporta a TODOS estos hubs a la vez (paneles redundantes).
	Hubs        []HubEntry `json:"hubs,omitempty"`
	MachineName string     `json:"machineName"`
	MachineID   string     `json:"machineId,omitempty"`
	HookPort    int        `json:"hookPort,omitempty"`
}

// hubEntries devuelve la lista efectiva de hubs (formato viejo + lista), sin duplicados.
func (c *Config) hubEntries() []HubEntry {
	entries := []HubEntry{}
	if c.HubURL != "" {
		entries = append(entries, HubEntry{URL: c.HubURL, Token: c.Token})
	}
	for _, h := range c.Hubs {
		if h.URL == "" {
			continue
		}
		dup := false
		for _, e := range entries {
			if e.URL == h.URL {
				dup = true
				break
			}
		}
		if !dup {
			entries = append(entries, h)
		}
	}
	return entries
}

func configPath() string {
	if p := os.Getenv("CSM_CONFIG"); p != "" {
		return p
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "csm", "agent.json")
}

func loadConfig() (*Config, error) {
	path := configPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("no pude leer la config %s: %w (¿corriste el install.sh?)", path, err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("config inválida %s: %w", path, err)
	}
	if v := os.Getenv("CSM_HUB_URL"); v != "" {
		cfg.HubURL = v
		cfg.Hubs = nil // el env fuerza modo un-solo-hub (pruebas)
	}
	if v := os.Getenv("CSM_TOKEN"); v != "" {
		cfg.Token = v
	}
	if cfg.MachineName == "" {
		cfg.MachineName, _ = os.Hostname()
	}
	if cfg.HookPort == 0 {
		cfg.HookPort = 8787
	}
	changed := false
	if cfg.MachineID == "" {
		b := make([]byte, 6)
		rand.Read(b)
		cfg.MachineID = cfg.MachineName + "-" + hex.EncodeToString(b)
		changed = true
	}
	if changed {
		saveConfig(path, &cfg)
	}
	return &cfg, nil
}

// addHubCmd agrega (o actualiza el token de) un hub en la config, creándola si
// no existe. Migra el formato viejo de un solo hub a la lista.
func addHubCmd(args []string) error {
	if len(args) < 2 {
		return fmt.Errorf("uso: csm-agent add-hub <url> <token>")
	}
	hubURL := strings.TrimSuffix(args[0], "/")
	token := args[1]
	path := configPath()
	var cfg Config
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &cfg); err != nil {
			return fmt.Errorf("config inválida %s: %w", path, err)
		}
	}
	if cfg.MachineName == "" {
		name, _ := os.Hostname()
		if i := strings.IndexByte(name, '.'); i > 0 {
			name = name[:i]
		}
		cfg.MachineName = name
	}
	if cfg.HubURL != "" {
		cfg.Hubs = upsertHub(cfg.Hubs, HubEntry{URL: strings.TrimSuffix(cfg.HubURL, "/"), Token: cfg.Token})
		cfg.HubURL, cfg.Token = "", ""
	}
	cfg.Hubs = upsertHub(cfg.Hubs, HubEntry{URL: hubURL, Token: token})
	saveConfig(path, &cfg)
	fmt.Printf("Hub agregado: %s (el agente reporta a %d hub(s))\n", hubURL, len(cfg.Hubs))
	return nil
}

func removeHubCmd(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("uso: csm-agent remove-hub <url>")
	}
	hubURL := strings.TrimSuffix(args[0], "/")
	path := configPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("no pude leer la config %s: %w", path, err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return fmt.Errorf("config inválida %s: %w", path, err)
	}
	if strings.TrimSuffix(cfg.HubURL, "/") == hubURL {
		cfg.HubURL, cfg.Token = "", ""
	}
	kept := cfg.Hubs[:0]
	for _, h := range cfg.Hubs {
		if strings.TrimSuffix(h.URL, "/") != hubURL {
			kept = append(kept, h)
		}
	}
	cfg.Hubs = kept
	saveConfig(path, &cfg)
	fmt.Printf("Hub eliminado: %s (quedan %d)\n", hubURL, len(cfg.hubEntries()))
	return nil
}

func upsertHub(hubs []HubEntry, h HubEntry) []HubEntry {
	for i, e := range hubs {
		if strings.TrimSuffix(e.URL, "/") == h.URL {
			hubs[i].Token = h.Token
			return hubs
		}
	}
	return append(hubs, h)
}

func saveConfig(path string, cfg *Config) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	data, _ := json.MarshalIndent(cfg, "", "  ")
	os.WriteFile(path, append(data, '\n'), 0o600)
}
