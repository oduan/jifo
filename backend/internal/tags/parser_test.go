package tags

import (
	"reflect"
	"testing"
)

func TestNestedAndDedup(t *testing.T) {
	got := ExtractTagPaths("#思考 #电视剧/电视剧1 这个电视剧真的很好看 #思考")
	want := []string{"思考", "电视剧", "电视剧/电视剧1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v want %#v", got, want)
	}
}

func TestStopsAtWhitespace(t *testing.T) {
	got := ExtractTagPaths("hello #工作/项目A 今天继续")
	want := []string{"工作", "工作/项目A"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v want %#v", got, want)
	}
}

func TestStopsAtPunctuation(t *testing.T) {
	got := ExtractTagPaths("#思考…后面文字 #work.project #项目/子项")
	want := []string{"思考", "work", "项目", "项目/子项"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v want %#v", got, want)
	}
}
