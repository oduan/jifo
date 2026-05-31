package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	baseURL     string
	accessToken string
	httpClient  *http.Client
}

type apiErrorBody struct {
	Error struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"requestId"`
	} `json:"error"`
}

func NewClient(baseURL, accessToken string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), accessToken: strings.TrimSpace(accessToken), httpClient: httpClient}
}

func (c *Client) ListNotes(ctx context.Context, params ListNotesParams) (NotesResponse, error) {
	values := url.Values{}
	if params.Search != "" {
		values.Set("search", params.Search)
	}
	if params.TagPath != "" {
		values.Set("tagPath", params.TagPath)
	}
	if params.Trash {
		values.Set("trash", "true")
	}
	if params.Limit != nil {
		values.Set("limit", strconv.Itoa(*params.Limit))
	}
	if params.Offset != nil {
		values.Set("offset", strconv.Itoa(*params.Offset))
	}
	path := "/notes"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out NotesResponse
	err := c.do(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) CreateTextNote(ctx context.Context, text string) (NoteResponse, error) {
	input := CreateNoteInput{
		ClientID:  "cli-" + randomHex(16),
		PlainText: text,
		Content:   Content{Blocks: []Block{{Type: "paragraph", Text: text}}},
	}
	return c.CreateNote(ctx, input)
}

func (c *Client) CreateNote(ctx context.Context, input CreateNoteInput) (NoteResponse, error) {
	var out NoteResponse
	err := c.do(ctx, http.MethodPost, "/notes", input, &out)
	return out, err
}

func (c *Client) ListTags(ctx context.Context) (TagsResponse, error) {
	var out TagsResponse
	err := c.do(ctx, http.MethodGet, "/tags", nil, &out)
	return out, err
}

func (c *Client) TagTree(ctx context.Context) (TagTreeResponse, error) {
	var out TagTreeResponse
	err := c.do(ctx, http.MethodGet, "/tags/tree", nil, &out)
	return out, err
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	if c.accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.accessToken)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return decodeAPIError(resp.StatusCode, data)
	}
	if out == nil || len(strings.TrimSpace(string(data))) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}

func decodeAPIError(status int, data []byte) error {
	var parsed apiErrorBody
	if err := json.Unmarshal(data, &parsed); err == nil && parsed.Error.Code != "" {
		if parsed.Error.RequestID != "" {
			return fmt.Errorf("jifo api error: status=%d code=%s message=%s requestId=%s", status, parsed.Error.Code, parsed.Error.Message, parsed.Error.RequestID)
		}
		return fmt.Errorf("jifo api error: status=%d code=%s message=%s", status, parsed.Error.Code, parsed.Error.Message)
	}
	body := strings.TrimSpace(string(data))
	if len(body) > 500 {
		body = body[:500]
	}
	return fmt.Errorf("jifo api error: status=%d body=%s", status, body)
}

func randomHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(buf)
}
