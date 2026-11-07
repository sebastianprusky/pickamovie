import assert from "node:assert/strict";
import { blendPromptRelevance, matchesAskConstraints, parseAskIntent, shouldUseSemanticRanking } from "../src/services/promptIntent.ts";

const anchoredComedy = parseAskIntent("comedy similar to Borat");
assert.equal(anchoredComedy.genre, "Comedy");
assert.equal(anchoredComedy.referenceTitle, "borat");
assert.equal(anchoredComedy.relationship, "similar");
assert(shouldUseSemanticRanking(anchoredComedy), "reference-title prompts must use semantic or relationship ranking");

const likeMovie = parseAskIntent("something like The Grand Budapest Hotel");
assert.equal(likeMovie.referenceTitle, "the grand budapest hotel");
assert(shouldUseSemanticRanking(likeMovie));
assert.equal(parseAskIntent("I'd like a comedy").referenceTitle, undefined, "ordinary preference language must not be mistaken for a reference title");

const constrainedReference = parseAskIntent("movies similar to Alien but newer");
assert.equal(constrainedReference.referenceTitle, "alien");
assert.equal(constrainedReference.sortBy, "primary_release_date.desc");

const mood = parseAskIntent("a cozy funny movie");
assert.deepEqual(mood.semanticTerms.sort(), ["cozy", "funny"]);
assert(shouldUseSemanticRanking(mood));

assert(matchesAskConstraints({ genres: ["Comedy"], year: "2012" }, anchoredComedy));
assert(!matchesAskConstraints({ genres: ["Drama"], year: "2012" }, anchoredComedy));

assert.equal(blendPromptRelevance(0.8), 0.8);
assert(blendPromptRelevance(0.4, 1) > blendPromptRelevance(0.8, 0.1), "strong prompt relevance must outweigh a modest personalization advantage");

console.log("prompt-retrieval verification passed");

const olderThriller = parseAskIntent("Old psychological thriller with A-list actors");
assert.equal(olderThriller.genre, "Thriller");
assert.equal(olderThriller.sortBy, "popularity.desc", "old should prefer recognizable older films, not the earliest shorts");
assert.equal(olderThriller.yearTo, new Date().getFullYear() - 20);
assert.equal(parseAskIntent("old thrillers from the 1990s").yearTo, 1999, "an explicit era wins over the broad old interpretation");
assert.equal(parseAskIntent("oldest thrillers").sortBy, "primary_release_date.asc", "explicit oldest ordering remains available");
