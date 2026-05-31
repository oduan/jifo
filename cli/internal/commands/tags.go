package commands

import (
	"github.com/spf13/cobra"

	"jifo/cli/internal/output"
)

func newTagsCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{Use: "tags", Short: "Work with tags"}
	cmd.AddCommand(newTagsListCommand(opts))
	cmd.AddCommand(newTagsTreeCommand(opts))
	return cmd
}

func newTagsListCommand(opts Options) *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List tags",
		RunE: func(cmd *cobra.Command, args []string) error {
			_, client, err := requireAPI(opts)
			if err != nil {
				return err
			}
			resp, err := client.ListTags(cmd.Context())
			if err != nil {
				return err
			}
			if asJSON {
				return output.JSON(cmd.OutOrStdout(), resp)
			}
			output.WriteTags(cmd.OutOrStdout(), resp.Items)
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func newTagsTreeCommand(opts Options) *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "tree",
		Short: "Show tag tree",
		RunE: func(cmd *cobra.Command, args []string) error {
			_, client, err := requireAPI(opts)
			if err != nil {
				return err
			}
			resp, err := client.TagTree(cmd.Context())
			if err != nil {
				return err
			}
			if asJSON {
				return output.JSON(cmd.OutOrStdout(), resp)
			}
			output.WriteTagTree(cmd.OutOrStdout(), resp.Items)
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}
