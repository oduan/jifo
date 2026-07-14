package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jifo/backend/internal/accesskeys"
	"jifo/backend/internal/auth"
	"jifo/backend/internal/cleanup"
	"jifo/backend/internal/heatmap"
	"jifo/backend/internal/media"
	"jifo/backend/internal/notes"
	"jifo/backend/internal/platform/config"
	"jifo/backend/internal/platform/db"
	"jifo/backend/internal/platform/health"
	"jifo/backend/internal/platform/httpx"
	"jifo/backend/internal/sync"
	"jifo/backend/internal/tags"
	"jifo/backend/internal/users"
)

type AuthService interface {
	Register(ctx context.Context, input auth.RegisterInput) (*auth.AuthResult, error)
	Login(ctx context.Context, input auth.LoginInput) (*auth.AuthResult, error)
	Refresh(ctx context.Context, refreshToken string) (*auth.AuthResult, error)
	ValidateAccessToken(ctx context.Context, tokenString string) (*auth.AccessTokenClaims, error)
	Logout(ctx context.Context, userID, sessionID uuid.UUID) error
}

type UsersService interface {
	ChangePassword(ctx context.Context, userID uuid.UUID, currentPassword, newPassword string) error
}

type AccessKeyService interface {
	List(ctx context.Context, userID uuid.UUID) ([]accesskeys.AccessKey, error)
	Create(ctx context.Context, userID uuid.UUID, label string) (accesskeys.CreateResult, error)
	Revoke(ctx context.Context, userID uuid.UUID, keyID uuid.UUID) error
	Validate(ctx context.Context, rawKey string) (accesskeys.Principal, error)
}

type NotesService interface {
	Create(ctx context.Context, input notes.CreateInput) (notes.Note, error)
	List(ctx context.Context, filter notes.ListFilter) (notes.ListResult, error)
	CountActive(ctx context.Context, userID uuid.UUID) (int64, error)
	Update(ctx context.Context, input notes.UpdateInput) (notes.Note, error)
	MoveToTrash(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (notes.Note, error)
	Restore(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (notes.Note, error)
}

type TagsService interface {
	List(ctx context.Context, userID uuid.UUID) ([]tags.Tag, error)
	Tree(ctx context.Context, userID uuid.UUID) ([]tags.TreeNode, error)
	Rename(ctx context.Context, userID uuid.UUID, tagID uuid.UUID, path string) error
	Delete(ctx context.Context, userID uuid.UUID, tagID uuid.UUID, deleteNotes bool) error
}

type HeatmapService interface {
	Aggregate(ctx context.Context, userID uuid.UUID, from time.Time, to time.Time) ([]heatmap.DayCount, error)
}

type SyncService interface {
	Push(ctx context.Context, userID uuid.UUID, sessionID *uuid.UUID, op sync.Operation) (sync.PushResult, error)
	Pull(ctx context.Context, userID uuid.UUID, cursor sync.Cursor, limit int) (sync.PullResult, error)
}

type MediaService interface {
	media.HandlerService
}

type Dependencies struct {
	Auth       AuthService
	AccessKeys AccessKeyService
	Notes      NotesService
	Tags       TagsService
	Heatmap    HeatmapService
	Sync       SyncService
	Media      MediaService
	Health     *health.Handler
	Users      UsersService
}

func NewRouter(deps Dependencies) http.Handler {
	return NewRouterWithOptions(deps, RouterOptions{})
}

type RouterOptions struct {
	Logger      *slog.Logger
	Proxy       *httpx.ProxyResolver
	AuthLimiter *httpx.RateLimiter
}

func NewRouterWithOptions(deps Dependencies, options RouterOptions) http.Handler {
	r := chi.NewRouter()
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	if options.Proxy == nil {
		options.Proxy, _ = httpx.NewProxyResolver(nil)
	}
	r.Use(httpx.RequestID)
	r.Use(options.Proxy.Middleware)
	r.Use(httpx.AccessLog(options.Logger))
	r.Use(httpx.Recoverer(options.Logger))
	r.Use(httpx.SecurityHeaders)
	r.Use(httpx.RequestBodyLimit(2<<20, media.DefaultMaxSizeBytes+(1<<20)))

	if deps.Health != nil {
		r.Get("/healthz", deps.Health.Live)
		r.Get("/readyz", deps.Health.Ready)
	}

	r.Route("/api", func(api chi.Router) {
		api.NotFound(func(w http.ResponseWriter, req *http.Request) {
			httpx.WriteError(w, req, http.StatusNotFound, "not_found", "route not found")
		})
		api.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) {
			httpx.WriteError(w, req, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		})

		authHandler := auth.NewHandler(deps.Auth)
		if options.AuthLimiter != nil {
			api.With(options.AuthLimiter.Middleware).Post("/auth/register", authHandler.Register)
			api.With(options.AuthLimiter.Middleware).Post("/auth/login", authHandler.Login)
			api.With(options.AuthLimiter.Middleware).Post("/auth/refresh", authHandler.Refresh)
		} else {
			api.Post("/auth/register", authHandler.Register)
			api.Post("/auth/login", authHandler.Login)
			api.Post("/auth/refresh", authHandler.Refresh)
		}

		api.Group(func(protected chi.Router) {
			protected.Use(httpx.RequireAuth(func(ctx context.Context, tokenString string) (uuid.UUID, uuid.UUID, error) {
				if deps.Auth != nil {
					claims, err := deps.Auth.ValidateAccessToken(ctx, tokenString)
					if err == nil {
						return claims.UserID, claims.SessionID, nil
					}
					if !errors.Is(err, auth.ErrInvalidAccessToken) {
						return uuid.Nil, uuid.Nil, err
					}
				}
				if deps.AccessKeys != nil {
					principal, err := deps.AccessKeys.Validate(ctx, tokenString)
					if err == nil {
						return principal.UserID, uuid.Nil, nil
					}
					if !errors.Is(err, accesskeys.ErrInvalidAccessKey) {
						return uuid.Nil, uuid.Nil, err
					}
				}
				return uuid.Nil, uuid.Nil, httpx.ErrUnauthorized
			}))

			notesHandler := notes.NewHandler(deps.Notes)
			protected.Post("/notes", notesHandler.Create)
			protected.Get("/notes", notesHandler.List)
			protected.Get("/notes/stats", notesHandler.Stats)
			protected.Patch("/notes/{noteID}", notesHandler.Update)
			protected.Put("/notes/{noteID}", notesHandler.Update)
			protected.Delete("/notes/{noteID}", notesHandler.Delete)
			protected.Post("/notes/{noteID}/restore", notesHandler.Restore)

			tagsHandler := tags.NewHandler(deps.Tags)
			protected.Get("/tags", tagsHandler.List)
			protected.Get("/tags/tree", tagsHandler.Tree)
			protected.Patch("/tags/{tagID}", tagsHandler.Rename)
			protected.Delete("/tags/{tagID}", tagsHandler.Delete)

			heatmapHandler := heatmap.NewHandler(deps.Heatmap)
			protected.Get("/heatmap", heatmapHandler.Get)

			mediaHandler := media.NewHandler(deps.Media)
			mediaHandler.RegisterRoutes(protected)

			syncHandler := sync.NewHandler(deps.Sync)
			syncHandler.RegisterRoutes(protected)

			accessKeyHandler := accesskeys.NewHandler(deps.AccessKeys)
			protected.With(httpx.RequireUserSession).Get("/settings/access-keys", accessKeyHandler.List)
			protected.With(httpx.RequireUserSession).Post("/settings/access-keys", accessKeyHandler.Create)
			protected.With(httpx.RequireUserSession).Delete("/settings/access-keys/{keyID}", accessKeyHandler.Delete)

			protected.With(httpx.RequireUserSession).Post("/auth/logout", authHandler.Logout)
			usersHandler := users.NewHandler(deps.Users)
			protected.With(httpx.RequireUserSession).Post("/me/password", usersHandler.ChangePassword)
		})
	})

	return r
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("api stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	signalCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancelApp := context.WithCancel(signalCtx)
	defer cancelApp()
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	proxy, err := httpx.NewProxyResolver(cfg.TrustedProxies)
	if err != nil {
		return fmt.Errorf("load trusted proxies: %w", err)
	}

	database, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer database.Close()
	if err := db.RunMigrations(ctx, database); err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}

	tagSvc := tags.NewService(database)
	noteSvc := notes.NewService(database, tagSvc)
	authSvc, err := auth.NewService(database, cfg.JWTSecret, cfg.AccessTokenTTL)
	if err != nil {
		return fmt.Errorf("init auth service: %w", err)
	}
	mediaSvc := media.NewService(database, cfg.MediaRoot)
	syncSvc := sync.NewService(database, noteSvc)
	heatmapSvc := heatmap.NewService(database)
	accessKeySvc := accesskeys.NewService(database)
	usersSvc := users.NewService(database)

	healthHandler := health.NewHandler(database, cfg.MediaRoot)
	router := NewRouterWithOptions(
		Dependencies{Auth: authSvc, AccessKeys: accessKeySvc, Notes: noteSvc, Tags: tagSvc, Heatmap: heatmapSvc, Sync: syncSvc, Media: mediaSvc, Health: healthHandler, Users: usersSvc},
		RouterOptions{Logger: logger, Proxy: proxy, AuthLimiter: httpx.NewRateLimiter(cfg.AuthRateLimit, cfg.AuthRateWindow)},
	)

	cleanupSvc := cleanup.NewService(database, mediaSvc, logger)
	cleanupDone := make(chan struct{})
	go func() {
		defer close(cleanupDone)
		cleanupSvc.Run(ctx, cfg.CleanupInterval, cfg.CleanupTimeout)
	}()

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           router,
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
		MaxHeaderBytes:    1 << 20,
	}

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("api listening", "addr", cfg.Addr, "environment", cfg.Environment)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		cancelApp()
		if !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("listen server: %w", err)
		}
		return nil
	case <-ctx.Done():
		logger.Info("api shutdown started")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown server: %w", err)
	}
	select {
	case <-cleanupDone:
	case <-shutdownCtx.Done():
		return fmt.Errorf("shutdown cleanup worker: %w", shutdownCtx.Err())
	}
	logger.Info("api shutdown completed")
	return nil
}
