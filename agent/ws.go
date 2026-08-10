package main

import (
	"encoding/json"
	"hash/fnv"
	"log"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type machineInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	OS      string `json:"os"`
	Arch    string `json:"arch"`
	Version string `json:"version"`
}

func runAgent() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	hs := newHookState()
	go hs.serve(cfg.HookPort)
	go hs.broadcastEvents()

	machine := machineInfo{
		ID: cfg.MachineID, Name: cfg.MachineName,
		OS: runtime.GOOS, Arch: runtime.GOARCH, Version: version,
	}

	// Una conexión persistente por cada hub configurado: todos los paneles ven
	// esta máquina, y si un hub se cae los demás siguen funcionando.
	hubs := cfg.hubEntries()
	started := 0
	var wg sync.WaitGroup
	for _, h := range hubs {
		wsURL, err := hubWsURL(h.URL)
		if err != nil {
			log.Printf("hubUrl inválida %q: %v (se ignora)", h.URL, err)
			continue
		}
		started++
		wg.Add(1)
		go func(wsURL, token string) {
			defer wg.Done()
			backoff := time.Second
			for {
				ok := connectOnce(wsURL, token, machine, hs)
				if ok {
					backoff = time.Second // la conexión llegó a autenticarse: reinicia el backoff
				} else {
					backoff *= 2
					if backoff > 30*time.Second {
						backoff = 30 * time.Second
					}
				}
				log.Printf("[ws] %s: reconectando en %s", wsURL, backoff)
				time.Sleep(backoff)
			}
		}(wsURL, h.Token)
	}
	if started == 0 {
		log.Fatal("no hay hubs configurados: corre el install.sh de un hub o 'csm-agent add-hub <url> <token>'")
	}
	wg.Wait()
}

func hubWsURL(hubURL string) (string, error) {
	u, err := url.Parse(hubURL)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	}
	u.Path = strings.TrimSuffix(u.Path, "/") + "/ws/agent"
	return u.String(), nil
}

// wsDialer negocia compresión permessage-deflate: la salida de terminal que el
// agente sube cada segundo comprime ~10x, clave si el hub está lejos.
var wsDialer = &websocket.Dialer{
	Proxy:             http.ProxyFromEnvironment,
	HandshakeTimeout:  45 * time.Second,
	EnableCompression: true,
}

// connectOnce mantiene una conexión con el hub hasta que se corta.
// Devuelve true si llegó a autenticarse (hello_ok).
func connectOnce(wsURL, token string, machine machineInfo, hs *hookState) bool {
	conn, _, err := wsDialer.Dial(wsURL, nil)
	if err != nil {
		log.Printf("[ws] no pude conectar a %s: %v", wsURL, err)
		return false
	}
	defer conn.Close()

	events := hs.subscribe()
	defer hs.unsubscribe(events)

	send := func(v any) bool {
		data, _ := json.Marshal(v)
		return conn.WriteMessage(websocket.TextMessage, data) == nil
	}
	if !send(map[string]any{"type": "hello", "token": token, "machine": machine}) {
		return false
	}

	inbound := make(chan map[string]any, 16)
	go func() {
		defer close(inbound)
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var msg map[string]any
			if json.Unmarshal(data, &msg) == nil {
				inbound <- msg
			}
		}
	}()

	authenticated := false
	subs := map[string]bool{}        // sessionId suscritos por el hub
	sessById := map[string]Session{} // último scan, para captura y acciones
	lastOutHash := map[string]uint64{}
	var lastSessionsJSON string
	lastSessionsSent := time.Time{}

	scanTick := time.NewTicker(3 * time.Second)
	capTick := time.NewTicker(1 * time.Second)
	defer scanTick.Stop()
	defer capTick.Stop()

	doScan := func() bool {
		sessions := scanSessions(hs)
		for id := range sessById {
			delete(sessById, id)
		}
		for _, s := range sessions {
			sessById[s.ID] = s
		}
		js, _ := json.Marshal(sessions)
		if string(js) != lastSessionsJSON || time.Since(lastSessionsSent) > 15*time.Second {
			lastSessionsJSON = string(js)
			lastSessionsSent = time.Now()
			return send(map[string]any{"type": "sessions", "sessions": json.RawMessage(js)})
		}
		return true
	}
	doScan()

	for {
		select {
		case msg, open := <-inbound:
			if !open {
				log.Printf("[ws] %s: conexión cerrada por el hub", wsURL)
				return authenticated
			}
			switch msg["type"] {
			case "hello_ok":
				authenticated = true
				log.Printf("[ws] conectado a %s como %q", wsURL, machine.Name)
			case "error":
				log.Printf("[ws] error del hub: %v", msg["message"])
				return false
			case "ping":
				if !send(map[string]any{"type": "pong"}) {
					return authenticated
				}
			case "subscribe":
				if id, ok := msg["sessionId"].(string); ok {
					subs[id] = true
					delete(lastOutHash, id) // fuerza envío inmediato de la pantalla
				}
			case "unsubscribe":
				if id, ok := msg["sessionId"].(string); ok {
					delete(subs, id)
				}
			case "action":
				requestId, _ := msg["requestId"].(string)
				id, _ := msg["sessionId"].(string)
				action, _ := msg["action"].(string)
				text, _ := msg["text"].(string)
				ok := false
				result := "sesión no encontrada (¿terminó?)"
				if s, found := sessById[id]; found {
					ok, result = performAction(s, action, text)
					log.Printf("[action] %s sobre %s: ok=%v %s", action, id, ok, result)
				}
				if !send(map[string]any{"type": "action_result", "requestId": requestId, "ok": ok, "message": result}) {
					return authenticated
				}
				// refleja el efecto (pausada, terminada…) sin esperar al próximo tick
				time.Sleep(200 * time.Millisecond)
				if !doScan() {
					return authenticated
				}
			case "machine_action":
				requestId, _ := msg["requestId"].(string)
				action, _ := msg["action"].(string)
				path, _ := msg["path"].(string)
				fresh, _ := msg["fresh"].(bool)
				fileName, _ := msg["name"].(string)
				fileData, _ := msg["data"].(string)
				ok, result, data := performMachineAction(action, path, fresh, fileName, fileData)
				if action != "list_dir" {
					log.Printf("[machine_action] %s en %q: ok=%v %s", action, path, ok, result)
				}
				if !send(map[string]any{"type": "action_result", "requestId": requestId, "ok": ok, "message": result, "data": data}) {
					return authenticated
				}
				if ok && action == "new_session" {
					// deja que el proceso claude aparezca en ps y refleja la sesión nueva
					time.Sleep(700 * time.Millisecond)
					if !doScan() {
						return authenticated
					}
				}
			}

		case <-scanTick.C:
			if !doScan() {
				return authenticated
			}

		case <-capTick.C:
			for id := range subs {
				s, found := sessById[id]
				if !found || s.paneID == "" {
					continue
				}
				data, ok := capturePane(s.paneID)
				if !ok {
					continue
				}
				h := fnv.New64a()
				h.Write([]byte(data))
				if sum := h.Sum64(); sum != lastOutHash[id] {
					lastOutHash[id] = sum
					if !send(map[string]any{"type": "output", "sessionId": id, "data": data, "full": true}) {
						return authenticated
					}
				}
			}

		case ev := <-events:
			sessionID := ""
			for id, s := range sessionIDsByCwd(hs, ev.Cwd) {
				_ = s
				sessionID = id
				break
			}
			if !send(map[string]any{
				"type": "event", "sessionId": sessionID, "cwd": ev.Cwd,
				"event": map[string]any{"kind": ev.Kind, "ts": ev.TS, "detail": ev.Detail},
			}) {
				return authenticated
			}
			// un evento suele implicar cambio de estado: refleja rápido
			if !doScan() {
				return authenticated
			}
		}
	}
}

// sessionIDsByCwd resuelve qué sesión corresponde a un cwd reportado por un hook.
func sessionIDsByCwd(hs *hookState, cwd string) map[string]Session {
	res := map[string]Session{}
	if cwd == "" {
		return res
	}
	for _, s := range scanSessions(hs) {
		if s.Cwd == cwd {
			res[s.ID] = s
		}
	}
	return res
}

func capturePane(paneID string) (string, bool) {
	out, err := tmuxCmd("capture-pane", "-p", "-e", "-t", paneID, "-S", "-1000").Output()
	if err != nil {
		return "", false
	}
	return string(out), true
}
