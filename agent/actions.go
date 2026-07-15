package main

import (
	"fmt"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

// performAction ejecuta una acción de control sobre una sesión.
// Devuelve (ok, mensaje para el usuario).
func performAction(s Session, action, text string) (bool, string) {
	switch action {
	case "send_prompt":
		if s.paneID == "" {
			return false, "esta sesión no corre en tmux; no se le puede escribir"
		}
		if strings.TrimSpace(text) == "" {
			return false, "el prompt está vacío"
		}
		// texto literal primero, Enter después (evita que tmux interprete el texto)
		if err := tmuxCmd("send-keys", "-t", s.paneID, "-l", text).Run(); err != nil {
			return false, "tmux send-keys: " + err.Error()
		}
		time.Sleep(150 * time.Millisecond)
		if err := tmuxCmd("send-keys", "-t", s.paneID, "Enter").Run(); err != nil {
			return false, "tmux send-keys Enter: " + err.Error()
		}
		return true, "prompt enviado"

	case "pause":
		if err := syscall.Kill(s.PID, syscall.SIGSTOP); err != nil {
			return false, fmt.Sprintf("SIGSTOP a %d: %v", s.PID, err)
		}
		// tmux reanuda automáticamente a sus hijos directos: verifica que la
		// pausa se sostiene (las sesiones creadas con csm van envueltas en sh
		// justamente para esto).
		time.Sleep(400 * time.Millisecond)
		if !isStopped(s.PID) {
			return false, "tmux reanudó el proceso; relanza la sesión con la versión nueva de csm para poder pausarla"
		}
		return true, "sesión pausada (SIGSTOP)"

	case "resume":
		if err := syscall.Kill(s.PID, syscall.SIGCONT); err != nil {
			return false, fmt.Sprintf("SIGCONT a %d: %v", s.PID, err)
		}
		return true, "sesión reanudada"

	case "kill":
		// un proceso pausado no procesa SIGTERM: reanúdalo primero
		syscall.Kill(s.PID, syscall.SIGCONT)
		if err := syscall.Kill(s.PID, syscall.SIGTERM); err != nil {
			return false, fmt.Sprintf("SIGTERM a %d: %v", s.PID, err)
		}
		return true, "SIGTERM enviado"

	case "force_kill":
		if err := syscall.Kill(s.PID, syscall.SIGKILL); err != nil {
			return false, fmt.Sprintf("SIGKILL a %d: %v", s.PID, err)
		}
		return true, "SIGKILL enviado"
	}
	return false, "acción desconocida: " + action
}

func isStopped(pid int) bool {
	out, err := exec.Command("ps", "-o", "stat=", "-p", fmt.Sprint(pid)).Output()
	return err == nil && strings.HasPrefix(strings.TrimSpace(string(out)), "T")
}
