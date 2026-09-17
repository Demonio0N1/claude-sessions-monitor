package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// machinePerms: permisos de macOS que afectan a lo que la app puede hacer en
// esta máquina. En Linux no aplica (FullDisk nil).
type machinePerms struct {
	// Acceso total al disco (macOS). nil = desconocido / no aplica.
	FullDisk *bool `json:"fullDisk,omitempty"`
	// Binario firmado con la identidad local estable (install.sh): los permisos
	// concedidos sobreviven a las actualizaciones. Sin firma, macOS los liga al
	// hash del binario y hay que volver a darlos tras cada actualización.
	Signed bool `json:"signed"`
}

// fullDiskAccess prueba carpetas protegidas SOLO por "Acceso total al disco":
// esa categoría nunca muestra un aviso (sin permiso, EPERM en silencio), así
// que se puede consultar cada pocos segundos sin molestar al usuario.
func fullDiskAccess() *bool {
	if runtime.GOOS != "darwin" {
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	for _, d := range []string{"Library/Safari", "Library/Messages", "Library/Containers/com.apple.Safari"} {
		_, err := os.ReadDir(filepath.Join(home, d))
		if err == nil {
			t := true
			return &t
		}
		if errors.Is(err, fs.ErrPermission) {
			f := false
			return &f
		}
	}
	return nil
}

var (
	signedOnce sync.Once
	signedVal  bool
)

// signedStable: ¿el requisito designado de este binario es por identificador y
// certificado (firma local de install.sh) y no un cdhash (ad-hoc)?
func signedStable() bool {
	signedOnce.Do(func() {
		if runtime.GOOS != "darwin" {
			return
		}
		exe, err := os.Executable()
		if err != nil {
			return
		}
		out, err := exec.Command("codesign", "-d", "-r-", exe).CombinedOutput()
		if err != nil {
			return
		}
		signedVal = strings.Contains(string(out), `identifier "com.csm.agent"`)
	})
	return signedVal
}

func currentPerms() machinePerms {
	return machinePerms{FullDisk: fullDiskAccess(), Signed: signedStable()}
}

// openPrivacySettings abre en la Mac el panel exacto de Ajustes (Acceso total
// al disco) y muestra el binario en el Finder para arrastrarlo a la lista.
func openPrivacySettings() (string, error) {
	if runtime.GOOS != "darwin" {
		return "", fmt.Errorf("solo aplica en macOS")
	}
	exe, _ := os.Executable()
	if err := exec.Command("open", "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles").Run(); err != nil {
		return "", fmt.Errorf("no pude abrir Ajustes del Sistema: %v", err)
	}
	if exe != "" {
		exec.Command("open", "-R", exe).Run()
	}
	return "Ajustes abiertos en la Mac: activa csm-agent en Acceso total al disco (el binario quedó a la vista en el Finder)", nil
}
