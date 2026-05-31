package commands

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"

	"jifo/cli/internal/api"
	"jifo/cli/internal/config"
)

type API interface {
	ListNotes(ctx context.Context, params api.ListNotesParams) (api.NotesResponse, error)
	CreateTextNote(ctx context.Context, text string) (api.NoteResponse, error)
	ListTags(ctx context.Context) (api.TagsResponse, error)
	TagTree(ctx context.Context) (api.TagTreeResponse, error)
}

type Options struct {
	ConfigPath string
	LoadConfig func() (config.Config, error)
	NewAPI     func(config.Config) API
}

func (o Options) configPath() (string, error) {
	if o.ConfigPath != "" {
		return o.ConfigPath, nil
	}
	return config.DefaultPath()
}

func (o Options) loadConfig() (config.Config, error) {
	if o.LoadConfig != nil {
		return o.LoadConfig()
	}
	path, err := o.configPath()
	if err != nil {
		return config.Config{}, err
	}
	return config.Load(path)
}

func (o Options) api(cfg config.Config) API {
	if o.NewAPI != nil {
		return o.NewAPI(cfg)
	}
	return api.NewClient(cfg.BaseURL, cfg.AccessToken, nil)
}

func requireAPI(opts Options) (config.Config, API, error) {
	cfg, err := opts.loadConfig()
	if err != nil {
		return config.Config{}, nil, err
	}
	if cfg.AccessToken == "" {
		return config.Config{}, nil, missingTokenError()
	}
	return cfg, opts.api(cfg), nil
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

func newTagsCommand(opts Options) *cobra.Command {
	cmd := &cobra.Command{Use: "tags", Short: "Work with tags"}
	cmd.AddCommand(&cobra.Command{Use: "list", Short: "List tags"})
	cmd.AddCommand(&cobra.Command{Use: "tree", Short: "Show tag tree"})
	return cmd
}
