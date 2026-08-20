package control

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestControlRootIsNotAWebManager(t *testing.T) {
	server := New("127.0.0.1:0", strings.Repeat("0", 64), nil, false)
	response := httptest.NewRecorder()
	server.http.Handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))

	if response.Code != http.StatusNotFound {
		t.Fatalf("unexpected control root status: %d", response.Code)
	}
}
