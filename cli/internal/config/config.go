package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const DefaultBaseURL = "http://localhost:8080/api"

const (
	TokenSourceNone   = "none"
	TokenSourceConfig = "config"
	TokenSourceEnv    = "env"
)

type Config struct {
	BaseURL     string `json:"baseUrl"`
	AccessToken string `json:"accessToken"`
	TokenSource string `json:"-"`
}

func DefaultPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".jifo", "config.json"), nil
}

func Load(path string) (Config, error) {
	cfg := Config{BaseURL: DefaultBaseURL, TokenSource: TokenSourceNone}
	data, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return Config{}, err
		}
	} else if len(strings.TrimSpace(string(data))) > 0 {
		if err := json.Unmarshal(data, &cfg); err != nil {
			return Config{}, err
		}
	}
	cfg.BaseURL = strings.TrimSpace(cfg.BaseURL)
	cfg.AccessToken = strings.TrimSpace(cfg.AccessToken)
	if cfg.BaseURL == "" {
		cfg.BaseURL = DefaultBaseURL
	}
	if cfg.AccessToken != "" {
		cfg.TokenSource = TokenSourceConfig
	} else {
		cfg.TokenSource = TokenSourceNone
	}
	if envBaseURL := strings.TrimSpace(os.Getenv("JIFO_BASE_URL")); envBaseURL != "" {
		cfg.BaseURL = envBaseURL
	}
	if envToken := strings.TrimSpace(os.Getenv("JIFO_ACCESS_TOKEN")); envToken != "" {
		cfg.AccessToken = envToken
		cfg.TokenSource = TokenSourceEnv
	}
	return cfg, nil
}

func Save(path string, cfg Config) error {
	cfg.BaseURL = strings.TrimSpace(cfg.BaseURL)
	cfg.AccessToken = strings.TrimSpace(cfg.AccessToken)
	if cfg.BaseURL == "" {
		cfg.BaseURL = DefaultBaseURL
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(Config{BaseURL: cfg.BaseURL, AccessToken: cfg.AccessToken}, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o600)
}

func Logout(path string) error {
	cfg, err := Load(path)
	if err != nil {
		return err
	}
	cfg.AccessToken = ""
	cfg.TokenSource = TokenSourceNone
	return Save(path, cfg)
}
