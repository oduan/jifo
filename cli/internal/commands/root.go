package commands

import (
	"fmt"

	"github.com/spf13/cobra"

	"jifo/cli/internal/config"
)

type Options struct {
	ConfigPath string
}

func (o Options) configPath() (string, error) {
	if o.ConfigPath != "" {
		return o.ConfigPath, nil
	}
	return config.DefaultPath()
}

func NewRootCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{
		Use:           "jifo",
		Short:         "Jifo command line client",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	cmd.AddCommand(newLoginCommand(opts))
	cmd.AddCommand(newLogoutCommand(opts))
	cmd.AddCommand(newStatusCommand(opts))
	cmd.AddCommand(newNotesCommand(opts))
	cmd.AddCommand(newTagsCommand(opts))
	return cmd
}

func missingTokenError() error {
	return fmt.Errorf("missing access token: run `jifo login --token <access-key>` or set JIFO_ACCESS_TOKEN")
}

func newNotesCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{Use: "notes", Short: "Work with notes"}
	cmd.AddCommand(&cobra.Command{Use: "list", Short: "List notes"})
	cmd.AddCommand(&cobra.Command{Use: "create", Short: "Create a text note"})
	return cmd
}

func newTagsCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{Use: "tags", Short: "Work with tags"}
	cmd.AddCommand(&cobra.Command{Use: "list", Short: "List tags"})
	cmd.AddCommand(&cobra.Command{Use: "tree", Short: "Show tag tree"})
	return cmd
}
