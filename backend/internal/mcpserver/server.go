package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"jifo/backend/internal/notes"
	"jifo/backend/internal/platform/httpx"
	"jifo/backend/internal/tags"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
)

type NotesService interface {
	Create(context.Context, notes.CreateInput) (notes.Note, error)
	List(context.Context, notes.ListFilter) (notes.ListResult, error)
	Update(context.Context, notes.UpdateInput) (notes.Note, error)
}

type TagsService interface {
	List(context.Context, uuid.UUID) ([]tags.Tag, error)
	Tree(context.Context, uuid.UUID) ([]tags.TreeNode, error)
	Rename(context.Context, uuid.UUID, uuid.UUID, string) error
	Delete(context.Context, uuid.UUID, uuid.UUID, bool) error
}

func NewHandler(noteService NotesService, tagService TagsService) http.Handler {
	server := mcp.NewServer(&mcp.Implementation{Name: "jifo", Version: "1.0.0"}, &mcp.ServerOptions{
		Instructions: "Use these tools to search and manage the authenticated user's Jifo notes and tags. Tags are written in note text as #tag or #parent/child.",
		GetSessionID: func() string { return "" },
	})
	registerTools(server, noteService, tagService)
	return mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{
		Stateless:    true,
		JSONResponse: true,
	})
}

func registerTools(server *mcp.Server, noteService NotesService, tagService TagsService) {
	readOnly := &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: boolPointer(false)}
	closedWorldWrite := &mcp.ToolAnnotations{OpenWorldHint: boolPointer(false), DestructiveHint: boolPointer(false)}

	mcp.AddTool(server, &mcp.Tool{
		Name: "search_notes", Description: "Fuzzy-search notes. Text, tag, created/updated time ranges, and pagination filters can be combined. Page size defaults to 50.", Annotations: readOnly,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input searchNotesInput) (*mcp.CallToolResult, searchNotesOutput, error) {
		userID, err := authenticatedUserID(ctx)
		if err != nil {
			return nil, searchNotesOutput{}, err
		}
		filter, page, pageSize, err := input.filter(userID)
		if err != nil {
			return nil, searchNotesOutput{}, err
		}
		result, err := noteService.List(ctx, filter)
		if err != nil {
			return nil, searchNotesOutput{}, fmt.Errorf("search notes: %w", err)
		}
		items := make([]noteOutput, 0, len(result.Items))
		for _, note := range result.Items {
			items = append(items, toNoteOutput(note))
		}
		return nil, searchNotesOutput{Items: items, Page: page, PageSize: pageSize, HasMore: result.HasMore}, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name: "create_note", Description: "Create a Jifo note. Include tags in plain_text with #tag or #parent/child syntax.", Annotations: closedWorldWrite,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input createNoteInput) (*mcp.CallToolResult, noteMutationOutput, error) {
		userID, err := authenticatedUserID(ctx)
		if err != nil {
			return nil, noteMutationOutput{}, err
		}
		clientID := strings.TrimSpace(input.ClientID)
		if clientID == "" {
			clientID = "mcp-" + uuid.NewString()
		}
		note, err := noteService.Create(ctx, notes.CreateInput{UserID: userID, ClientID: clientID, Content: contentForText(input.PlainText), PlainText: input.PlainText})
		if err != nil {
			return nil, noteMutationOutput{}, fmt.Errorf("create note: %w", err)
		}
		return nil, noteMutationOutput{Item: toNoteOutput(note)}, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name: "update_note", Description: "Replace the text of an existing active note. Tags are rebuilt from the new plain_text.", Annotations: closedWorldWrite,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input updateNoteInput) (*mcp.CallToolResult, noteMutationOutput, error) {
		userID, err := authenticatedUserID(ctx)
		if err != nil {
			return nil, noteMutationOutput{}, err
		}
		noteID, err := parseID("note_id", input.NoteID)
		if err != nil {
			return nil, noteMutationOutput{}, err
		}
		note, err := noteService.Update(ctx, notes.UpdateInput{UserID: userID, NoteID: noteID, Content: contentForText(input.PlainText), PlainText: input.PlainText})
		if err != nil {
			if errors.Is(err, notes.ErrNoteNotFound) {
				return nil, noteMutationOutput{}, errors.New("note not found")
			}
			return nil, noteMutationOutput{}, fmt.Errorf("update note: %w", err)
		}
		return nil, noteMutationOutput{Item: toNoteOutput(note)}, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name: "search_tags", Description: "Fuzzy-search tag names and paths and return each tag's note count.", Annotations: readOnly,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input searchTagsInput) (*mcp.CallToolResult, searchTagsOutput, error) {
		userID, err := authenticatedUserID(ctx)
		if err != nil {
			return nil, searchTagsOutput{}, err
		}
		page, pageSize, err := normalizePage(input.Page, input.PageSize)
		if err != nil {
			return nil, searchTagsOutput{}, err
		}
		all, err := tagService.List(ctx, userID)
		if err != nil {
			return nil, searchTagsOutput{}, fmt.Errorf("search tags: %w", err)
		}
		query := strings.ToLower(strings.TrimSpace(input.Query))
		matches := make([]tagOutput, 0)
		for _, tag := range all {
			if query == "" || strings.Contains(strings.ToLower(tag.Name), query) || strings.Contains(strings.ToLower(tag.Path), query) {
				matches = append(matches, toTagOutput(tag))
			}
		}
		start := (page - 1) * pageSize
		if start > len(matches) {
			start = len(matches)
		}
		end := start + pageSize
		if end > len(matches) {
			end = len(matches)
		}
		return nil, searchTagsOutput{Items: matches[start:end], Page: page, PageSize: pageSize, HasMore: end < len(matches)}, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name: "list_tag_tree", Description: "List the complete hierarchical tag tree with the note count for every node.", Annotations: readOnly,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ listTagTreeInput) (*mcp.CallToolResult, map[string]any, error) {
		userID, err := authenticatedUserID(ctx)
		if err != nil {
			return nil, nil, err
		}
		tree, err := tagService.Tree(ctx, userID)
		if err != nil {
			return nil, nil, fmt.Errorf("list tag tree: %w", err)
		}
		return nil, map[string]any{"items": tree}, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name: "rename_tag", Description: "Rename a tag while keeping it under the same parent. Associated note tag text is updated.", Annotations: closedWorldWrite,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input renameTagInput) (*mcp.CallToolResult, tagMutationOutput, error) {
		userID, err := authenticatedUserID(ctx)
		if err != nil {
			return nil, tagMutationOutput{}, err
		}
		tagID, err := parseID("tag_id", input.TagID)
		if err != nil {
			return nil, tagMutationOutput{}, err
		}
		newName := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(input.NewName), "#"))
		if newName == "" || strings.Contains(newName, "/") {
			return nil, tagMutationOutput{}, errors.New("new_name must be a non-empty tag name without '/'")
		}
		all, err := tagService.List(ctx, userID)
		if err != nil {
			return nil, tagMutationOutput{}, fmt.Errorf("load tag: %w", err)
		}
		var current *tags.Tag
		for i := range all {
			if all[i].ID == tagID {
				current = &all[i]
				break
			}
		}
		if current == nil {
			return nil, tagMutationOutput{}, errors.New("tag not found")
		}
		newPath := newName
		if slash := strings.LastIndex(current.Path, "/"); slash >= 0 {
			newPath = current.Path[:slash+1] + newName
		}
		if err := tagService.Rename(ctx, userID, tagID, newPath); err != nil {
			return nil, tagMutationOutput{}, fmt.Errorf("rename tag: %w", err)
		}
		return nil, tagMutationOutput{TagID: tagID.String(), Path: newPath}, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name: "delete_tag", Description: "Delete a tag. With delete_notes=false only tag tokens are removed; with true, every note associated with the tag is moved to trash.",
		Annotations: &mcp.ToolAnnotations{OpenWorldHint: boolPointer(false), DestructiveHint: boolPointer(true)},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input deleteTagInput) (*mcp.CallToolResult, deleteTagOutput, error) {
		userID, err := authenticatedUserID(ctx)
		if err != nil {
			return nil, deleteTagOutput{}, err
		}
		tagID, err := parseID("tag_id", input.TagID)
		if err != nil {
			return nil, deleteTagOutput{}, err
		}
		if err := tagService.Delete(ctx, userID, tagID, input.DeleteNotes); err != nil {
			if errors.Is(err, tags.ErrTagNotFound) {
				return nil, deleteTagOutput{}, errors.New("tag not found")
			}
			return nil, deleteTagOutput{}, fmt.Errorf("delete tag: %w", err)
		}
		return nil, deleteTagOutput{TagID: tagID.String(), DeletedNotes: input.DeleteNotes}, nil
	})
}

type searchNotesInput struct {
	Query       string `json:"query,omitempty" jsonschema:"optional fuzzy text search against note plain text"`
	TagPath     string `json:"tag_path,omitempty" jsonschema:"optional exact tag path; also matches descendant tags"`
	CreatedFrom string `json:"created_from,omitempty" jsonschema:"optional inclusive RFC3339 lower bound for creation time"`
	CreatedTo   string `json:"created_to,omitempty" jsonschema:"optional inclusive RFC3339 upper bound for creation time"`
	UpdatedFrom string `json:"updated_from,omitempty" jsonschema:"optional inclusive RFC3339 lower bound for update time"`
	UpdatedTo   string `json:"updated_to,omitempty" jsonschema:"optional inclusive RFC3339 upper bound for update time"`
	Page        int    `json:"page,omitempty" jsonschema:"1-based page number; defaults to 1"`
	PageSize    int    `json:"page_size,omitempty" jsonschema:"items per page; defaults to 50 and cannot exceed 200"`
}

func (in searchNotesInput) filter(userID uuid.UUID) (notes.ListFilter, int, int, error) {
	page, pageSize, err := normalizePage(in.Page, in.PageSize)
	if err != nil {
		return notes.ListFilter{}, 0, 0, err
	}
	createdFrom, err := parseOptionalTime("created_from", in.CreatedFrom)
	if err != nil {
		return notes.ListFilter{}, 0, 0, err
	}
	createdTo, err := parseOptionalTime("created_to", in.CreatedTo)
	if err != nil {
		return notes.ListFilter{}, 0, 0, err
	}
	updatedFrom, err := parseOptionalTime("updated_from", in.UpdatedFrom)
	if err != nil {
		return notes.ListFilter{}, 0, 0, err
	}
	updatedTo, err := parseOptionalTime("updated_to", in.UpdatedTo)
	if err != nil {
		return notes.ListFilter{}, 0, 0, err
	}
	if createdFrom != nil && createdTo != nil && createdFrom.After(*createdTo) {
		return notes.ListFilter{}, 0, 0, errors.New("created_from must not be after created_to")
	}
	if updatedFrom != nil && updatedTo != nil && updatedFrom.After(*updatedTo) {
		return notes.ListFilter{}, 0, 0, errors.New("updated_from must not be after updated_to")
	}
	return notes.ListFilter{
		UserID: userID, Search: in.Query, TagPath: in.TagPath,
		CreatedFrom: createdFrom, CreatedTo: createdTo, UpdatedFrom: updatedFrom, UpdatedTo: updatedTo,
		Limit: pageSize, Offset: (page - 1) * pageSize,
	}, page, pageSize, nil
}

type createNoteInput struct {
	PlainText string `json:"plain_text" jsonschema:"complete plain text for the note, including any #tags"`
	ClientID  string `json:"client_id,omitempty" jsonschema:"optional caller-defined idempotency identifier; generated when omitted"`
}

type updateNoteInput struct {
	NoteID    string `json:"note_id" jsonschema:"UUID of the note to update"`
	PlainText string `json:"plain_text" jsonschema:"complete replacement plain text, including any #tags"`
}

type searchTagsInput struct {
	Query    string `json:"query,omitempty" jsonschema:"optional fuzzy search against tag name and full path"`
	Page     int    `json:"page,omitempty" jsonschema:"1-based page number; defaults to 1"`
	PageSize int    `json:"page_size,omitempty" jsonschema:"items per page; defaults to 50 and cannot exceed 200"`
}

type listTagTreeInput struct{}

type renameTagInput struct {
	TagID   string `json:"tag_id" jsonschema:"UUID of the tag to rename"`
	NewName string `json:"new_name" jsonschema:"new leaf name without # or slash"`
}

type deleteTagInput struct {
	TagID       string `json:"tag_id" jsonschema:"UUID of the tag to delete"`
	DeleteNotes bool   `json:"delete_notes,omitempty" jsonschema:"false removes only the tag; true also moves associated notes to trash"`
}

type noteOutput struct {
	ID        string        `json:"id"`
	ClientID  string        `json:"client_id"`
	Content   notes.Content `json:"content"`
	PlainText string        `json:"plain_text"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
	Version   int64         `json:"version"`
}

type searchNotesOutput struct {
	Items    []noteOutput `json:"items"`
	Page     int          `json:"page"`
	PageSize int          `json:"page_size"`
	HasMore  bool         `json:"has_more"`
}

type noteMutationOutput struct {
	Item noteOutput `json:"item"`
}

type tagOutput struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	Depth     int    `json:"depth"`
	NoteCount int    `json:"note_count"`
}

type searchTagsOutput struct {
	Items    []tagOutput `json:"items"`
	Page     int         `json:"page"`
	PageSize int         `json:"page_size"`
	HasMore  bool        `json:"has_more"`
}

type tagMutationOutput struct {
	TagID string `json:"tag_id"`
	Path  string `json:"path"`
}

type deleteTagOutput struct {
	TagID        string `json:"tag_id"`
	DeletedNotes bool   `json:"deleted_notes"`
}

func authenticatedUserID(ctx context.Context) (uuid.UUID, error) {
	userID, ok := httpx.UserIDFromContext(ctx)
	if !ok || userID == uuid.Nil {
		return uuid.Nil, errors.New("authenticated user context is missing")
	}
	return userID, nil
}

func normalizePage(page, pageSize int) (int, int, error) {
	if page == 0 {
		page = 1
	}
	if pageSize == 0 {
		pageSize = defaultPageSize
	}
	if page < 1 {
		return 0, 0, errors.New("page must be at least 1")
	}
	if pageSize < 1 || pageSize > maxPageSize {
		return 0, 0, fmt.Errorf("page_size must be between 1 and %d", maxPageSize)
	}
	return page, pageSize, nil
}

func parseOptionalTime(name, value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, fmt.Errorf("%s must be an RFC3339 timestamp", name)
	}
	parsed = parsed.UTC()
	return &parsed, nil
}

func parseID(name, value string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil || id == uuid.Nil {
		return uuid.Nil, fmt.Errorf("%s must be a valid UUID", name)
	}
	return id, nil
}

func contentForText(plainText string) notes.Content {
	return notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: plainText}}}
}

func toNoteOutput(note notes.Note) noteOutput {
	return noteOutput{ID: note.ID.String(), ClientID: note.ClientID, Content: note.Content, PlainText: note.PlainText, CreatedAt: note.CreatedAt, UpdatedAt: note.UpdatedAt, Version: note.Version}
}

func toTagOutput(tag tags.Tag) tagOutput {
	return tagOutput{ID: tag.ID.String(), Name: tag.Name, Path: tag.Path, Depth: tag.Depth, NoteCount: tag.NoteCount}
}

func boolPointer(value bool) *bool { return &value }
