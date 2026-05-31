package commands

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"jifo/cli/internal/api"
	"jifo/cli/internal/output"
)

func newNotesCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{Use: "notes", Short: "Work with notes"}
	cmd.AddCommand(newNotesListCommand(opts))
	cmd.AddCommand(newNotesCreateCommand(opts))
	return cmd
}

func newNotesListCommand(opts Options) *cobra.Command {
	var search, tag string
	var trash, asJSON bool
	var limit, offset int
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List notes",
		RunE: func(cmd *cobra.Command, args []string) error {
			hasLimit := cmd.Flags().Changed("limit")
			hasOffset := cmd.Flags().Changed("offset")
			if hasLimit && limit < 0 {
				return fmt.Errorf("--limit must be >= 0")
			}
			if hasOffset && offset < 0 {
				return fmt.Errorf("--offset must be >= 0")
			}
			_, client, err := requireAPI(opts)
			if err != nil {
				return err
			}
			params := api.ListNotesParams{Search: search, TagPath: tag, Trash: trash}
			if hasLimit {
				params.Limit = &limit
			}
			if hasOffset {
				params.Offset = &offset
			}
			resp, err := client.ListNotes(cmd.Context(), params)
			if err != nil {
				return err
			}
			if asJSON {
				return output.JSON(cmd.OutOrStdout(), resp)
			}
			output.WriteNotes(cmd.OutOrStdout(), resp.Items)
			return nil
		},
	}
	cmd.Flags().StringVar(&search, "search", "", "Search note text")
	cmd.Flags().StringVar(&tag, "tag", "", "Filter by tag path")
	cmd.Flags().BoolVar(&trash, "trash", false, "List trashed notes")
	cmd.Flags().IntVar(&limit, "limit", 0, "Maximum notes to return")
	cmd.Flags().IntVar(&offset, "offset", 0, "Number of notes to skip")
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}

func newNotesCreateCommand(opts Options) *cobra.Command {
	var text, file string
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a text note",
		RunE: func(cmd *cobra.Command, args []string) error {
			if (strings.TrimSpace(text) == "") == (strings.TrimSpace(file) == "") {
				return fmt.Errorf("provide exactly one of --text or --file")
			}
			body := text
			if strings.TrimSpace(file) != "" {
				data, err := os.ReadFile(file)
				if err != nil {
					return err
				}
				body = string(data)
			}
			body = strings.TrimSpace(body)
			if body == "" {
				return fmt.Errorf("note text cannot be empty")
			}
			_, client, err := requireAPI(opts)
			if err != nil {
				return err
			}
			resp, err := client.CreateTextNote(cmd.Context(), body)
			if err != nil {
				return err
			}
			if asJSON {
				return output.JSON(cmd.OutOrStdout(), resp)
			}
			output.WriteCreatedNote(cmd.OutOrStdout(), resp.Item)
			return nil
		},
	}
	cmd.Flags().StringVar(&text, "text", "", "Note text")
	cmd.Flags().StringVar(&file, "file", "", "Read note text from file")
	cmd.Flags().BoolVar(&asJSON, "json", false, "Output JSON")
	return cmd
}
