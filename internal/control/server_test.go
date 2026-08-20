package control

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestManagementPage(t *testing.T) {
	server := New("127.0.0.1:0", strings.Repeat("0", 64), nil, false)
	response := httptest.NewRecorder()
	server.http.Handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "Codex subscriptions") {
		t.Fatalf("unexpected management page response: status=%d body=%q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("management page has no content security policy")
	}

	notFound := httptest.NewRecorder()
	server.http.Handler.ServeHTTP(notFound, httptest.NewRequest(http.MethodGet, "/unknown", nil))
	if notFound.Code != http.StatusNotFound {
		t.Fatalf("unexpected unknown route status: %d", notFound.Code)
	}
}
