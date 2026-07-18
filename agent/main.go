package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
)

const version = "0.1.0"

const usage = `csm-agent — agente de Claude Sessions Monitor

Uso:
  csm-agent run                  corre el agente (foreground)
  csm-agent add-hub <url> <tok>  agrega un hub (el agente reporta a todos a la vez)
  csm-agent remove-hub <url>     deja de reportar a un hub
  csm-agent setup-hooks          registra hooks pasivos en ~/.claude/settings.json
  csm-agent service install      instala el servicio (launchd/systemd) y lo arranca
  csm-agent service uninstall    elimina el servicio
  csm-agent version              muestra la versión

Config: ~/.config/csm/agent.json (o env CSM_CONFIG, CSM_HUB_URL, CSM_TOKEN)
`

func main() {
	cmd := "run"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	switch cmd {
	case "run":
		runAgent()
	case "setup-hooks":
		port := 8787
		if cfg, err := loadConfig(); err == nil {
			port = cfg.HookPort
		}
		if err := setupHooks(port); err != nil {
			log.Fatal(err)
		}
	case "add-hub":
		if err := addHubCmd(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
	case "remove-hub":
		if err := removeHubCmd(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
	case "service":
		if err := serviceCmd(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
	case "scan":
		// diagnóstico: imprime lo que el agente detecta ahora mismo
		hs := newHookState()
		data, _ := json.MarshalIndent(scanSessions(hs), "", "  ")
		fmt.Println(string(data))
	case "version", "--version", "-v":
		fmt.Println(version)
	default:
		fmt.Print(usage)
		os.Exit(2)
	}
}
