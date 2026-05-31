package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jifo/backend/internal/accesskeys"
	"jifo/backend/internal/auth"
	"jifo/backend/internal/heatmap"
	"jifo/backend/internal/media"
	"jifo/backend/internal/notes"
	"jifo/backend/internal/platform/config"
	"jifo/backend/internal/platform/db"
	"jifo/backend/internal/platform/httpx"
	"jifo/backend/internal/sync"
	"jifo/backend/internal/tags"
)

type AuthService interface {
	Register(ctx context.Context, input auth.RegisterInput) (*auth.AuthResult, error)
	Login(ctx context.Context, input auth.LoginInput) (*auth.AuthResult, error)
	ValidateAccessToken(ctx context.Context, tokenString string) (*auth.AccessTokenClaims, error)
}

type AccessKeyService interface {
	List(ctx context.Context, userID uuid.UUID) ([]accesskeys.AccessKey, error)
	Create(ctx context.Context, userID uuid.UUID, label string) (accesskeys.CreateResult, error)
	Validate(ctx context.Context, rawKey string) (accesskeys.Principal, error)
}

type NotesService interface {
	Create(ctx context.Context, input notes.CreateInput) (notes.Note, error)
	List(ctx context.Context, filter notes.ListFilter) (notes.ListResult, error)
	Update(ctx context.Context, input notes.UpdateInput) (notes.Note, error)
	MoveToTrash(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (notes.Note, error)
	Restore(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (notes.Note, error)
}

type TagsService interface {
	List(ctx context.Context, userID uuid.UUID) ([]tags.Tag, error)
	Tree(ctx context.Context, userID uuid.UUID) ([]tags.TreeNode, error)
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
}

func NewRouter(deps Dependencies) http.Handler {
	r := chi.NewRouter()
	r.Use(httpx.RequestID)

	r.Route("/api", func(api chi.Router) {
		api.NotFound(func(w http.ResponseWriter, req *http.Request) {
			httpx.WriteError(w, req, http.StatusNotFound, "not_found", "route not found")
		})
		api.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) {
			httpx.WriteError(w, req, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		})

		authHandler := auth.NewHandler(deps.Auth)
		api.Post("/auth/register", authHandler.Register)
		api.Post("/auth/login", authHandler.Login)

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
			protected.Patch("/notes/{noteID}", notesHandler.Update)
			protected.Put("/notes/{noteID}", notesHandler.Update)
			protected.Delete("/notes/{noteID}", notesHandler.Delete)
			protected.Post("/notes/{noteID}/restore", notesHandler.Restore)

			tagsHandler := tags.NewHandler(deps.Tags)
			protected.Get("/tags", tagsHandler.List)
			protected.Get("/tags/tree", tagsHandler.Tree)

			heatmapHandler := heatmap.NewHandler(deps.Heatmap)
			protected.Get("/heatmap", heatmapHandler.Get)

			mediaHandler := media.NewHandler(deps.Media)
			mediaHandler.RegisterRoutes(protected)

			syncHandler := sync.NewHandler(deps.Sync)
			syncHandler.RegisterRoutes(protected)

			accessKeyHandler := accesskeys.NewHandler(deps.AccessKeys)
			protected.Get("/settings/access-keys", accessKeyHandler.List)
			protected.Post("/settings/access-keys", accessKeyHandler.Create)
		})
	})

	return r
}

func main() {
	ctx := context.Background()
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	database, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.Close()
	if err := db.RunMigrations(ctx, database); err != nil {
		log.Fatalf("run migrations: %v", err)
	}

	tagSvc := tags.NewService(database)
	noteSvc := notes.NewService(database, tagSvc)
	authSvc, err := auth.NewService(database, cfg.JWTSecret, time.Hour)
	if err != nil {
		log.Fatalf("init auth service: %v", err)
	}
	mediaSvc := media.NewService(database, cfg.MediaRoot)
	syncSvc := sync.NewService(database, noteSvc)
	heatmapSvc := heatmap.NewService(database)
	accessKeySvc := accesskeys.NewService(database)

	router := NewRouter(Dependencies{Auth: authSvc, AccessKeys: accessKeySvc, Notes: noteSvc, Tags: tagSvc, Heatmap: heatmapSvc, Sync: syncSvc, Media: mediaSvc})
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}
	if err := http.ListenAndServe(addr, router); err != nil {
		log.Fatalf("listen server: %v", err)
	}
}
