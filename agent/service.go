package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func serviceCmd(args []string) error {
	sub := "install"
	if len(args) > 0 {
		sub = args[0]
	}
	switch sub {
	case "install":
		if runtime.GOOS == "darwin" {
			return installLaunchd()
		}
		return installSystemd()
	case "uninstall":
		if runtime.GOOS == "darwin" {
			return uninstallLaunchd()
		}
		return uninstallSystemd()
	default:
		return fmt.Errorf("uso: csm-agent service [install|uninstall]")
	}
}

func logPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "csm", "agent.log")
}

// ---- macOS (launchd) ----

func plistPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", "com.csm.agent.plist")
}

func installLaunchd() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.csm.agent</string>
  <key>ProgramArguments</key>
  <array><string>%s</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>%s</string>
  <key>StandardErrorPath</key><string>%s</string>
</dict>
</plist>
`, exe, logPath(), logPath())
	path := plistPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(path, []byte(plist), 0o644); err != nil {
		return err
	}
	exec.Command("launchctl", "unload", path).Run() // por si ya estaba cargado
	if out, err := exec.Command("launchctl", "load", "-w", path).CombinedOutput(); err != nil {
		return fmt.Errorf("launchctl load: %v (%s)", err, out)
	}
	fmt.Println("Servicio launchd instalado y arrancado:", path)
	fmt.Println("Logs en:", logPath())
	return nil
}

func uninstallLaunchd() error {
	path := plistPath()
	exec.Command("launchctl", "unload", path).Run()
	os.Remove(path)
	fmt.Println("Servicio launchd eliminado")
	return nil
}

// ---- Linux (systemd de usuario) ----

func unitPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "systemd", "user", "csm-agent.service")
}

func installSystemd() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	unit := fmt.Sprintf(`[Unit]
Description=Claude Sessions Monitor agent

[Service]
ExecStart=%s run
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`, exe)
	path := unitPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(path, []byte(unit), 0o644); err != nil {
		return err
	}
	cmds := [][]string{
		{"systemctl", "--user", "daemon-reload"},
		{"systemctl", "--user", "enable", "csm-agent"},
		// restart (no --now): si ya corría, debe reiniciarse para tomar
		// el binario y la config nuevos
		{"systemctl", "--user", "restart", "csm-agent"},
	}
	for _, c := range cmds {
		if out, err := exec.Command(c[0], c[1:]...).CombinedOutput(); err != nil {
			return fmt.Errorf("%v: %v (%s)", c, err, out)
		}
	}
	fmt.Println("Servicio systemd (usuario) instalado y arrancado:", path)
	fmt.Println("En servidores, habilita lingering para que sobreviva al logout:")
	fmt.Println("  sudo loginctl enable-linger $USER")
	return nil
}

func uninstallSystemd() error {
	exec.Command("systemctl", "--user", "disable", "--now", "csm-agent").Run()
	os.Remove(unitPath())
	exec.Command("systemctl", "--user", "daemon-reload").Run()
	fmt.Println("Servicio systemd eliminado")
	return nil
}
