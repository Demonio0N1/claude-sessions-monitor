package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// setupHooks registra hooks 100% pasivos en ~/.claude/settings.json.
// Cada hook hace un POST local con curl; si el agente no está corriendo, el
// curl falla en silencio (|| true) y Claude Code sigue como si nada.
func setupHooks(port int) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, ".claude")
	path := filepath.Join(dir, "settings.json")

	root := map[string]any{}
	existing, err := os.ReadFile(path)
	if err == nil {
		if err := json.Unmarshal(existing, &root); err != nil {
			return fmt.Errorf("%s no es JSON válido, no lo toco: %w", path, err)
		}
	}

	hooks, _ := root["hooks"].(map[string]any)
	if hooks == nil {
		hooks = map[string]any{}
	}

	marker := fmt.Sprintf("127.0.0.1:%d/hook", port)
	cmd := fmt.Sprintf(
		"curl -s --max-time 2 -X POST http://%s --data-binary @- >/dev/null 2>&1 || true",
		marker,
	)
	events := []string{"SessionStart", "UserPromptSubmit", "PreToolUse", "Stop", "Notification", "SessionEnd"}

	changed := false
	for _, ev := range events {
		arr, _ := hooks[ev].([]any)
		if hasMarker(arr, marker) {
			continue
		}
		arr = append(arr, map[string]any{
			"hooks": []any{map[string]any{"type": "command", "command": cmd}},
		})
		hooks[ev] = arr
		changed = true
	}
	if !changed {
		fmt.Println("Hooks ya registrados en", path)
		return nil
	}
	root["hooks"] = hooks

	if len(existing) > 0 {
		backup := path + ".csm-backup"
		if _, err := os.Stat(backup); os.IsNotExist(err) {
			os.WriteFile(backup, existing, 0o600)
		}
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(root, "", "  ")
	if err := os.WriteFile(path, append(data, '\n'), 0o600); err != nil {
		return err
	}
	fmt.Println("Hooks registrados en", path)
	return nil
}

func hasMarker(arr []any, marker string) bool {
	for _, entry := range arr {
		m, _ := entry.(map[string]any)
		inner, _ := m["hooks"].([]any)
		for _, h := range inner {
			hm, _ := h.(map[string]any)
			if cmd, _ := hm["command"].(string); strings.Contains(cmd, marker) {
				return true
			}
		}
	}
	return false
}
