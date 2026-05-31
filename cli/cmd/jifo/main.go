package main

import (
	"fmt"
	"os"

	"jifo/cli/internal/commands"
)

func main() {
	cmd := commands.NewRootCommand(commands.Options{})
	if err := cmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
