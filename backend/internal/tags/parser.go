package tags

import (
	"strings"
	"unicode"
)

func ExtractTagPaths(text string) []string {
	runes := []rune(text)
	seen := make(map[string]struct{})
	result := make([]string, 0)

	for i := 0; i < len(runes); i++ {
		if runes[i] != '#' {
			continue
		}

		i++
		start := i
		for i < len(runes) {
			r := runes[i]
			if isTagBoundary(r) {
				break
			}
			i++
		}

		raw := strings.TrimSpace(string(runes[start:i]))
		for _, path := range expandPath(raw) {
			if _, ok := seen[path]; ok {
				continue
			}
			seen[path] = struct{}{}
			result = append(result, path)
		}
	}

	return result
}

func expandPath(path string) []string {
	if path == "" {
		return nil
	}

	parts := strings.Split(path, "/")
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		clean = append(clean, part)
	}
	if len(clean) == 0 {
		return nil
	}

	result := make([]string, 0, len(clean))
	for i := range clean {
		result = append(result, strings.Join(clean[:i+1], "/"))
	}
	return result
}

func isTagBoundary(r rune) bool {
	if r == '/' {
		return false
	}

	if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
		return true
	}

	return false
}
