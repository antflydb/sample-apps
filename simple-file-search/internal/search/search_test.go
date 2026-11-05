package search

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/antflydb/sample-apps/simple-file-search/internal/antfly"
)

// A grouped response in the shape Antfly v0.3.0-rc.9 returns.
const grouped = `{"responses":[{"hits":{"hits":[
 {"_id":"r:report.pdf","_score":0.0164,"_index_scores":{"chunks":0.77,"full_text":3.1},
  "_source":{"title":"Report.pdf","kind":"pdf","source_id":"r","source_kind":"drive","source_name":"Reports","version":"7"},
  "hierarchy":{"level":"source","matches":[
   {"_id":"r:report.pdf","_source":{}},
   {"_id":"c1","_source":{"text":"EVA 3 replaced the Wide Field Planetary Camera with a new one."},"hierarchy":{"parent_unit_id":"page:000047"}},
   {"_id":"c2","_source":{"text":"R- 1"},"hierarchy":{"parent_unit_id":"page:000098"}}]}},
 {"_id":"m:clip.mp3","_score":0.0161,"_index_scores":{"media":0.70,"chunks":0.76},
  "_source":{"title":"clip.mp3","kind":"audio","source_id":"m","source_kind":"s3","source_name":"Media","version":"x"},
  "hierarchy":{"level":"source","matches":[
   {"_id":"c3","_source":{"text":"That's one small step for man. One giant leap for mankind.","_start_time_ms":0,"_end_time_ms":12000},"hierarchy":{"parent_unit_id":"audio:000001"}}]}},
 {"_id":"m:photo.jpg","_score":0.0160,"_index_scores":{"media":0.755},
  "_source":{"title":"photo.jpg","kind":"image","source_id":"m","source_kind":"s3","source_name":"Media","version":"y"},
  "hierarchy":{"level":"source","matches":[{"_id":"m:photo.jpg","_source":{}}]}},
 {"_id":"r:junk.pdf","_score":0.0159,"_index_scores":{"chunks":0.76},
  "_source":{"title":"junk.pdf","kind":"pdf","source_id":"r","version":"1"},
  "hierarchy":{"level":"source","matches":[{"_id":"c4","_source":{"text":"in powered down the"},"hierarchy":{"parent_unit_id":"page:000007"}}]}},
 {"_id":"r:scrap.pdf","_score":0.0158,"_index_scores":{"chunks":0.78},
  "_source":{"title":"scrap.pdf","kind":"pdf","source_id":"r","version":"2"},
  "hierarchy":{"level":"source","matches":[
   {"_id":"c5","_source":{"text":"C-8"},"hierarchy":{"parent_unit_id":"page:000117"}},
   {"_id":"c6","_source":{"text":"Mission rules covered the contingency of an early landing."},"hierarchy":{"parent_unit_id":"page:000031"}}]}},
 {"_id":"m:far.jpg","_score":0.0158,"_index_scores":{"media":0.62},
  "_source":{"title":"far.jpg","kind":"image","source_id":"m","version":"z"},
  "hierarchy":{"level":"source","matches":[]}}
]}}]}`

func TestSearchMapsGroupedHits(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ai/v1/embed":
			var body struct {
				Model string `json:"model"`
				Task  string `json:"task_type"`
				Input []struct {
					Content []antfly.EmbedPart `json:"content"`
				} `json:"input"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Model != "test-embedder" ||
				body.Task != "RETRIEVAL_QUERY" || len(body.Input) != 1 ||
				!reflect.DeepEqual(body.Input[0].Content, []antfly.EmbedPart{{Type: "text", Text: "telescope repair"}}) {
				t.Errorf("unexpected embedding request: %+v (%v)", body, err)
			}
			w.Write([]byte(`{"data":[{"embedding":[0.25,0.75]}]}`))
		case "/db/v1/query":
			var body struct {
				Embeddings map[string][]float64 `json:"embeddings"`
				FullText   struct {
					Query string `json:"query"`
				} `json:"full_text_search"`
			}
			want := map[string][]float64{"chunks": {0.25, 0.75}, "media": {0.25, 0.75}}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
				body.FullText.Query != "telescope repair" || !reflect.DeepEqual(body.Embeddings, want) {
				t.Errorf("unexpected hybrid query: %+v (%v)", body, err)
			}
			w.Write([]byte(grouped))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	s := &Searcher{
		Antfly:   antfly.New(srv.URL, ""),
		Embedder: "test-embedder",
		Table:    "files",
		FileURL:  func(id, v string) string { return "/files/" + id + "?v=" + v },
	}
	resp, err := s.Search(context.Background(), Request{Text: "telescope repair"})
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, r := range resp.Results {
		ids = append(ids, r.ID)
	}
	// report: 0.77 + full-text bonus; photo: 0.755 + media calibration;
	// clip: 0.76; junk.pdf has only scraps of evidence; scrap.pdf scores
	// highest but on a scrap ("C-8"), so its score is noise; far.jpg is
	// outside the relevance window.
	want := []string{"r:report.pdf", "m:photo.jpg", "m:clip.mp3"}
	if len(ids) != len(want) || ids[0] != want[0] || ids[1] != want[1] || ids[2] != want[2] {
		t.Fatalf("results = %v, want %v", ids, want)
	}
	report := resp.Results[0]
	if report.FileURL != "/files/r:report.pdf?v=7" || report.Source.Name != "Reports" {
		t.Errorf("report = %+v", report)
	}
	if len(report.Matches) != 1 || report.Matches[0].Type != "page" || report.Matches[0].Page != 47 {
		t.Errorf("report matches = %+v", report.Matches)
	}
	clip := resp.Results[2]
	if len(clip.Matches) != 1 || clip.Matches[0].Type != "segment" || clip.Matches[0].EndMS != 12000 {
		t.Errorf("clip matches = %+v", clip.Matches)
	}
}

func TestReadable(t *testing.T) {
	for text, want := range map[string]bool{
		"EVA 3 replaced the Wide Field Planetary Camera with a new one.": true,
		"C-8": false,
		"............................... 6 5 ......................":         false,
		"110 100 90 80 70 60 I I I I I 1 I 2.5 3 3.5 4 4.5 Time (hrs) 5 5.5": false,
		"replaceallsixgyroscopes,aguidancesensorandthecomputeronboard":       false,
	} {
		if got := readable(text); got != want {
			t.Errorf("readable(%q) = %v", text, got)
		}
	}
}
