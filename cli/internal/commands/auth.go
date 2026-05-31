package commands

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"jifo/cli/internal/config"
)

func newLoginCommand(opts Options) *cobra.Command {
	var token string
	var baseURL string
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Save Jifo access token",
		RunE: func(cmd *cobra.Command, args []string) error {
			token = strings.TrimSpace(token)
			if token == "" {
				return fmt.Errorf("--token is required")
			}
			path, err := opts.configPath()
			if err != nil {
				return err
			}
			cfg, err := config.Load(path)
			if err != nil {
				return err
			}
			if strings.TrimSpace(baseURL) != "" {
				cfg.BaseURL = strings.TrimSpace(baseURL)
			}
			cfg.AccessToken = token
			if err := config.Save(path, cfg); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Saved Jifo access token for %s\n", cfg.BaseURL)
			return nil
		},
	}
	cmd.Flags().StringVar(&token, "token", "", "Jifo access key")
	cmd.Flags().StringVar(&baseURL, "base-url", "", "Jifo API base URL")
	return cmd
}

func newLogoutCommand(opts Options) *cobra.Command {
	return &cobra.Command{
		Use:   "logout",
		Short: "Remove saved Jifo access token",
		RunE: func(cmd *cobra.Command, args []string) error {
			path, err := opts.configPath()
			if err != nil {
				return err
			}
			if err := config.Logout(path); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Removed saved Jifo access token")
			return nil
		},
	}
}

func newStatusCommand(opts Options) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show Jifo CLI configuration status",
		RunE: func(cmd *cobra.Command, args []string) error {
			path, err := opts.configPath()
			if err != nil {
				return err
			}
			cfg, err := config.Load(path)
			if err != nil {
				return err
			}
			tokenStatus := "not configured"
			if cfg.AccessToken != "" {
				tokenStatus = "configured"
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Base URL: %s\n", cfg.BaseURL)
			fmt.Fprintf(cmd.OutOrStdout(), "Token: %s\n", tokenStatus)
			fmt.Fprintf(cmd.OutOrStdout(), "Token source: %s\n", cfg.TokenSource)
			return nil
		},
	}
}
