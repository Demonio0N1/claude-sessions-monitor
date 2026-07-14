package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"time"
)

type hookInfo struct {
	event string
	ts    int64
}

type hookEventMsg struct {
	Cwd    string
	Kind   string
	TS     int64
	Detail string
}

type hookState struct {
	mu     sync.Mutex
	byCwd  map[string]hookInfo
	Events chan hookEventMsg
}

func newHookState() *hookState {
	return &hookState{byCwd: map[string]hookInfo{}, Events: make(chan hookEventMsg, 128)}
}

// payload que Claude Code envía a los hooks por stdin (campos que nos interesan)
type hookPayload struct {
	HookEventName string `json:"hook_event_name"`
	Cwd           string `json:"cwd"`
	Message       string `json:"message"`
	ToolName      string `json:"tool_name"`
	Prompt        string `json:"prompt"`
}

// serve levanta el receptor local de hooks. Solo escucha en 127.0.0.1: los hooks
// de Claude Code hacen un POST con curl y si el agente está apagado fallan en
// silencio sin afectar a Claude.
func (hs *hookState) serve(port int) {
	mux := http.NewServeMux()
	mux.HandleFunc("/ping", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("/hook", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 256*1024))
		var p hookPayload
		if err := json.Unmarshal(body, &p); err != nil || p.HookEventName == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		now := time.Now().UnixMilli()
		hs.mu.Lock()
		hs.byCwd[p.Cwd] = hookInfo{event: p.HookEventName, ts: now}
		hs.mu.Unlock()

		detail := p.Message
		if detail == "" {
			detail = p.ToolName
		}
		if detail == "" && p.Prompt != "" {
			detail = truncate(p.Prompt, 120)
		}
		select {
		case hs.Events <- hookEventMsg{Cwd: p.Cwd, Kind: p.HookEventName, TS: now, Detail: detail}:
		default: // canal lleno: descarta antes que bloquear
		}
		w.Write([]byte("ok"))
	})
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Printf("[hooks] no pude escuchar en %s: %v", addr, err)
	}
}

func (hs *hookState) statusFor(cwd string) (status, lastEvent string, lastEventAt int64) {
	hs.mu.Lock()
	info, ok := hs.byCwd[cwd]
	hs.mu.Unlock()
	if !ok || cwd == "" {
		return "idle", "", 0
	}
	switch info.event {
	case "UserPromptSubmit", "PreToolUse", "PostToolUse", "SessionStart", "PreCompact", "SubagentStop":
		return "active", info.event, info.ts
	case "Stop", "Notification":
		return "waiting_input", info.event, info.ts
	case "SessionEnd":
		return "ended", info.event, info.ts
	}
	return "idle", info.event, info.ts
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
