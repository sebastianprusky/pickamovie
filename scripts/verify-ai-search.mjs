import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectTmdbMatch, normalizeResearchGenres, POST } from "../api/ai-movie-search.ts";

const claim = { title: "Black Widow", year: 2021, inclusionReason: "Marvel film released in the 2020s", matchedConstraints: ["Marvel", "2020s"], confidence: .99 };
const results = [
  { id: 1, title: "Black Widow", original_title: "Black Widow", release_date: "2021-07-07", poster_path: "/poster.jpg" },
  { id: 2, title: "Black Widow", original_title: "Black Widow", release_date: "1954-10-28", poster_path: "/old.jpg" },
];
assert.equal(selectTmdbMatch(claim, results)?.id, 1, "title and release year must resolve together");
assert.equal(selectTmdbMatch({ ...claim, year: 2020 }, results), null, "a mismatched year must not silently resolve");
assert.equal(selectTmdbMatch({ ...claim, title: "Invented Marvel Film" }, results), null, "an invented title must never be displayed");
const client = readFileSync(new URL("../src/services/aiMovieSearch.ts", import.meta.url), "utf8");
const requestBody = client.slice(client.indexOf("body: JSON.stringify"), client.indexOf("if (!response.ok)"));
assert(!/ratings|watchlist|interest|preferences|reviews/i.test(requestBody), "private taste history must not be sent to AI search");
const recommendations = readFileSync(new URL("../src/services/recommendations.ts", import.meta.url), "utf8");
assert.match(recommendations, /promptEvidence\?\.(reason|evidence)|promptEvidence\?\.reason/, "recommendations must use verified prompt evidence");
assert.match(recommendations, /personalEvidence/, "recommendations must append concrete local taste evidence");
const endpoint = readFileSync(new URL("../api/ai-movie-search.ts", import.meta.url), "utf8");
assert.match(endpoint, /const searchModel = "gpt-5\.6-luna"/, "normal search must use Luna");
assert.match(endpoint, /reasoning: \{ effort: "none" \}/, "Luna search must disable reasoning tokens");
assert.match(endpoint, /const maxModelOutputTokens = 2_200/, "model output must have a strict cost ceiling");
assert.match(endpoint, /store: false/, "responses must not be stored by OpenAI");
assert(!/gpt-5\.6-sol|type: "web_search"|verificationSchema|movie_search_verification/.test(endpoint), "Sol, web search, and second-pass verification must not remain in normal search");
assert.equal((endpoint.match(/= await callOpenAI\(\{/g) || []).length, 1, "the endpoint must contain one model call");

console.log("Low-cost AI search verification passed");

// Reproduce the production failure: valid seeds were all rejected because
// "psychological thriller" is not a literal TMDB catalog genre.
const research = {
  interpretation: "Older psychological thrillers with recognizable stars",
  resultMode: "curated", includeUnreleased: false,
  hardConstraints: { yearMin: null, yearMax: 2005, genres: ["psychological thriller"], people: [], franchise: null, runtimeMin: null, runtimeMax: null, exclusions: [] },
  softPreferences: { tones: ["tense"], themes: ["manipulation"], pacing: [], familiarity: "high", similarityQualities: [] },
  referenceMovie: null,
  candidates: [
    { title: "The Silence of the Lambs", year: 1991 },
    { title: "Se7en", year: 1995 },
    { title: "The Game", year: 1997 },
    { title: "A recent thriller", year: 2025 },
    { title: "An unrelated comedy", year: 1990 },
  ].map((movie) => ({ ...movie, inclusionReason: "A tense psychological thriller with a recognizable lead", matchedConstraints: ["psychological thriller"], confidence: .95 })),
};
const normalized = normalizeResearchGenres(research);
assert.deepEqual(normalized.hardConstraints.genres, ["Thriller"]);
assert(normalized.softPreferences.themes.includes("psychological thriller"));
assert.deepEqual(research.hardConstraints.genres, ["psychological thriller"], "normalization must not mutate research");
assert.deepEqual(normalizeResearchGenres({ ...research, hardConstraints: { ...research.hardConstraints, genres: ["Sci-Fi", "Science Fiction", "Thriller"] } }).hardConstraints.genres, ["Science Fiction", "Thriller"]);

const originalFetch = globalThis.fetch;
const originalKeys = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, TMDB_API_KEY: process.env.TMDB_API_KEY };
let modelCalls = 0;
try {
  process.env.OPENAI_API_KEY = "test-only-openai-key-not-real";
  process.env.TMDB_API_KEY = "test-only-tmdb-key-not-real";
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname === "api.openai.com") {
      modelCalls++;
      const body = JSON.parse(options.body);
      const genres = body.text.format.schema.properties.hardConstraints.properties.genres.items.enum;
      assert(genres.includes("Thriller") && !genres.includes("psychological thriller"), "schema must constrain genres to TMDB vocabulary");
      return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(research) }] }] });
    }
    if (parsed.pathname === "/3/search/movie") {
      const index = research.candidates.findIndex((movie) => movie.title === parsed.searchParams.get("query"));
      const movie = research.candidates[index];
      return Response.json({ results: [{ id: index + 1, title: movie.title, release_date: `${movie.year}-01-01`, poster_path: "/poster.jpg" }] });
    }
    if (parsed.pathname.startsWith("/3/movie/")) {
      const id = Number(parsed.pathname.split("/").at(-1));
      const movie = research.candidates[id - 1];
      return Response.json({ id, title: movie.title, release_date: `${movie.year}-01-01`, poster_path: "/poster.jpg", overview: "Psychological manipulation", genres: [{ name: id === 5 ? "Comedy" : "Thriller" }], vote_count: 1000, vote_average: 8, runtime: 120 });
    }
    if (parsed.pathname === "/3/discover/movie") {
      assert.equal(parsed.searchParams.get("with_genres"), "53", "discovery and validation must use the same canonical genre");
      return Response.json({ results: [] });
    }
    throw new Error(`Unexpected request to ${parsed.hostname}${parsed.pathname}`);
  };
  const response = await POST(new Request("http://localhost/api/ai-movie-search", { method: "POST", body: JSON.stringify({ query: "Old psychological thriller with A-list actors" }) }));
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.deepEqual(data.movies.map((movie) => movie.title).sort(), ["The Silence of the Lambs", "Se7en", "The Game"].sort(), "valid subgenre matches survive while explicit genre/year mismatches are still excluded");
  assert.equal(modelCalls, 1, "normalization must not add model calls");
  console.log("Psychological-thriller endpoint regression passed");
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalKeys)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
