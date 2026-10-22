// Integração por HTTP em Go, só com a biblioteca padrão (RF-INT-02).
// Envia um lote de leituras canônicas v1.0 para POST /api/v1/ingestao/lote.
// Uso:  TOKEN=dsp_... go run main.go
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

type medida struct {
	Grandeza string  `json:"grandeza"`
	Valor    float64 `json:"valor"`
	Unidade  string  `json:"unidade"`
}

type mensagem struct {
	Versao      string   `json:"versao"`
	IDMensagem  string   `json:"id_mensagem"`
	Dispositivo string   `json:"dispositivo"`
	Tipo        string   `json:"tipo"`
	Timestamp   string   `json:"timestamp"`
	Medidas     []medida `json:"medidas"`
}

// uuidV4 gera um UUID versão 4 com crypto/rand.
func uuidV4() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func env(nome, padrao string) string {
	if v := os.Getenv(nome); v != "" {
		return v
	}
	return padrao
}

func main() {
	api := env("API_URL", "http://localhost:3000") + "/api/v1/ingestao/lote"
	dispositivo := env("DISPOSITIVO", "medidor-centro")

	// Últimos 5 minutos, uma leitura por minuto (como um nó que estava offline).
	var lote []mensagem
	agora := time.Now().UTC()
	for i := 4; i >= 0; i-- {
		lote = append(lote, mensagem{
			Versao: "1.0", IDMensagem: uuidV4(), Dispositivo: dispositivo, Tipo: "telemetria",
			Timestamp: agora.Add(-time.Duration(i) * time.Minute).Format(time.RFC3339),
			Medidas: []medida{
				{"potencia", 11.5 + float64(i)*0.3, "kW"},
				{"tensao", 219 + float64(i), "V"},
			},
		})
	}

	corpo, _ := json.Marshal(map[string]any{"mensagens": lote})
	req, _ := http.NewRequest(http.MethodPost, api, bytes.NewReader(corpo))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+os.Getenv("TOKEN"))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fmt.Println("erro:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	resposta, _ := io.ReadAll(resp.Body)
	fmt.Println(resp.Status)
	fmt.Println(string(resposta))
}
