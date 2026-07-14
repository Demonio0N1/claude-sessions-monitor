BIN_DIR := hub/public/bin

.PHONY: agent-build hub-dev web-dev web-build icons fake-agent build

# Compila el agente para todas las plataformas y lo deja donde el hub lo sirve
agent-build:
	mkdir -p $(BIN_DIR)
	cd agent && GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags '-s -w' -o ../$(BIN_DIR)/csm-agent-darwin-arm64 .
	cd agent && GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags '-s -w' -o ../$(BIN_DIR)/csm-agent-darwin-amd64 .
	cd agent && GOOS=linux GOARCH=amd64 go build -trimpath -ldflags '-s -w' -o ../$(BIN_DIR)/csm-agent-linux-amd64 .
	cd agent && GOOS=linux GOARCH=arm64 go build -trimpath -ldflags '-s -w' -o ../$(BIN_DIR)/csm-agent-linux-arm64 .
	cp agent/csm $(BIN_DIR)/csm
	chmod +x $(BIN_DIR)/csm
	@ls -lh $(BIN_DIR)

hub-dev:
	cd hub && npm run dev

web-dev:
	cd web && npm run dev

icons:
	node scripts/gen-icons.mjs

web-build: icons
	cd web && npm run build

fake-agent:
	cd hub && node scripts/fake-agent.mjs

# Build completo de producción: web + binarios del agente
build: web-build agent-build
