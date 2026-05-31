package output

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"text/tabwriter"
	"time"
	"unicode/utf8"

	"jifo/cli/internal/api"
)

func JSON(w io.Writer, value any) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(value)
}

func WriteNotes(w io.Writer, notes []api.Note) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "ID\tCreated\tUpdated\tVersion\tPreview")
	for _, note := range notes {
		fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%s\n", shortID(note.ID), formatTime(note.CreatedAt), formatTime(note.UpdatedAt), note.Version, preview(note.PlainText, 80))
	}
	_ = tw.Flush()
}

func WriteCreatedNote(w io.Writer, note api.Note) {
	fmt.Fprintf(w, "Created note %s at %s\n%s\n", shortID(note.ID), formatTime(note.CreatedAt), preview(note.PlainText, 120))
}

func WriteTags(w io.Writer, tags []api.Tag) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "Path\tNotes")
	for _, tag := range tags {
		path := tag.Path
		if path == "" {
			path = tag.Name
		}
		fmt.Fprintf(tw, "%s\t%d\n", path, tag.NoteCount)
	}
	_ = tw.Flush()
}

func WriteTagTree(w io.Writer, nodes []api.TagNode) {
	for _, node := range nodes {
		writeTagNode(w, node, 0)
	}
}

func writeTagNode(w io.Writer, node api.TagNode, depth int) {
	path := node.Path
	if path == "" {
		path = node.Name
	}
	fmt.Fprintf(w, "%s%s (%d)\n", strings.Repeat("  ", depth), path, node.NoteCount)
	for _, child := range node.Children {
		writeTagNode(w, child, depth+1)
	}
}

func shortID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return "-"
	}
	return t.Local().Format("2006-01-02 15:04")
}

func preview(text string, maxRunes int) string {
	cleaned := strings.Join(strings.Fields(text), " ")
	if utf8.RuneCountInString(cleaned) <= maxRunes {
		return cleaned
	}
	runes := []rune(cleaned)
	return string(runes[:maxRunes]) + "…"
}
