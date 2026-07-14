package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Config struct {
	HubURL      string `json:"hubUrl"`
	Token       string `json:"token"`
	MachineName string `json:"machineName"`
	MachineID   string `json:"machineId,omitempty"`
	HookPort    int    `json:"hookPort,omitempty"`
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

func saveConfig(path string, cfg *Config) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	data, _ := json.MarshalIndent(cfg, "", "  ")
	os.WriteFile(path, append(data, '\n'), 0o600)
}
