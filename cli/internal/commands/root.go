package commands

import "github.com/spf13/cobra"

type Options struct{}

func NewRootCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "jifo",
		Short: "Jifo command line client",
	}
	cmd.AddCommand(newLoginCommand(opts))
	cmd.AddCommand(newLogoutCommand(opts))
	cmd.AddCommand(newStatusCommand(opts))
	cmd.AddCommand(newNotesCommand(opts))
	cmd.AddCommand(newTagsCommand(opts))
	return cmd
}

func newLoginCommand(opts Options) *cobra.Command {
	return &cobra.Command{Use: "login", Short: "Save Jifo access token"}
}

func newLogoutCommand(opts Options) *cobra.Command {
	return &cobra.Command{Use: "logout", Short: "Remove saved Jifo access token"}
}

func newStatusCommand(opts Options) *cobra.Command {
	return &cobra.Command{Use: "status", Short: "Show Jifo CLI configuration status"}
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
