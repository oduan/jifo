package commands

import (
	"bytes"
	"testing"
)

func TestRootCommandShowsHelp(t *testing.T) {
	cmd := NewRootCommand(Options{})
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{"--help"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	got := out.String()
	for _, want := range []string{"jifo", "notes", "tags", "login", "status"} {
		if !bytes.Contains([]byte(got), []byte(want)) {
			t.Fatalf("help output missing %q:\n%s", want, got)
		}
	}
}
