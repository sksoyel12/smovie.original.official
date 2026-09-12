/**
 * Home screen category map — single source of truth for all 90 rows.
 *
 * Netflix-Style AI Algorithm (Permanent Architecture):
 *  • ALL content rows filter by Netflix (with_networks=213 for TV, watch_provider=8 for movies)
 *    so only Netflix titles appear in every category.
 *  • Recommendation rows (/recommendations endpoint) and TMDB curated lists cannot be
 *    network-filtered by the API — they remain as-is.
 *  • Gemini AI re-sorts Trending and "Because you liked" rows (see geminiRowId in index.tsx).
 *  • Poster rotation uses 15-hour rotation_key + AsyncStorage locking (see posterAlgorithm.ts).
 *
 * imageMode:
 *  "poster"   → tall portrait 2:3 card (default)
 *  "backdrop" → wide landscape crop (action, thriller, sci-fi, blockbusters)
 */
import { tmdb, type TMDBPage } from "@/lib/tmdb";
import type { ImageMode } from "@/components/MovieRow";

export type HomeCategory =
  | {
      kind:      "movieRow";
      title:     string;
      fetcher:   (page: number) => Promise<TMDBPage>;
      mediaType: "movie" | "tv";
      imageMode: ImageMode;
    }
  | {
      kind:      "top10";
      title:     string;
      fetcher:   (page: number) => Promise<TMDBPage>;
      mediaType: "movie" | "tv";
    }
  | {
      kind: "special";
      key:  "continueWatching" | "myList" | "topPicksForYou";
      title: string;
    };

// ─── 90 permanent rows — all content filtered to Netflix (network 213) ──────────
export const HOME_CATEGORIES: HomeCategory[] = [
  // 1  — Trending: Netflix TV sorted by popularity → backdrop
  { kind: "movieRow", title: "Trending Now",                                       fetcher: tmdb.netflixTV(),                                                                    mediaType: "tv",    imageMode: "backdrop" },
  // 2
  { kind: "movieRow", title: "Meet Your Next Binge",                               fetcher: tmdb.netflixTV({ with_genres: "9648,53" }),                                          mediaType: "tv",    imageMode: "poster"   },
  // 3
  { kind: "movieRow", title: "Your Next Watch",                                    fetcher: tmdb.netflixTV(),                                                                    mediaType: "tv",    imageMode: "poster"   },
  // 4
  { kind: "movieRow", title: "Korean TV Shows",                                    fetcher: tmdb.netflixTV({ with_origin_country: "KR" }),                                       mediaType: "tv",    imageMode: "poster"   },
  // 5
  { kind: "movieRow", title: "Romantic Shows",                                     fetcher: tmdb.netflixTV({ with_genres: 10749 }),                                              mediaType: "tv",    imageMode: "poster"   },
  // 6 — Netflix-only content (already Netflix)
  { kind: "top10",    title: "Top 10 Movies in India Today",                       fetcher: tmdb.top10NetflixIndia,                                                              mediaType: "movie"                        },
  // 7
  { kind: "special",  key:  "continueWatching",                                    title:  "Continue watching"                                                                  },
  // 8
  { kind: "movieRow", title: "We Think You'll Love These",                         fetcher: tmdb.netflixTV({ "vote_average.gte": 7.5, "vote_count.gte": 50 }),                   mediaType: "tv",    imageMode: "poster"   },
  // 9
  { kind: "movieRow", title: "Made in Korea",                                      fetcher: tmdb.netflixTV({ with_origin_country: "KR" }),                                       mediaType: "tv",    imageMode: "poster"   },
  // 10 — recommendations for "It's Okay to Not Be Okay" (TMDB TV 95639)
  { kind: "movieRow", title: "It's Okay to Not Be Okay",                          fetcher: tmdb.tvRecommendations(95639),                                                       mediaType: "tv",    imageMode: "poster"   },
  // 11 — Gemini AI re-sorts this row (see geminiRowId="becauseYouLiked" in index.tsx)
  { kind: "movieRow", title: "Because you liked",                                  fetcher: tmdb.netflixTV({ with_origin_country: "KR", with_genres: "10749,18" }),              mediaType: "tv",    imageMode: "poster"   },
  // 12
  { kind: "movieRow", title: "Romantic East Asian TV Shows",                       fetcher: tmdb.netflixTV({ with_origin_country: "KR|JP|CN" }),                                 mediaType: "tv",    imageMode: "poster"   },
  // 13 — action → backdrop
  { kind: "movieRow", title: "Get in on the action",                               fetcher: tmdb.netflixTV({ with_genres: 10759 }),                                              mediaType: "tv",    imageMode: "backdrop" },
  // 14 — Netflix New Releases movies → backdrop
  { kind: "movieRow", title: "New Releases",                                       fetcher: tmdb.netflixMovie({ sort_by: "primary_release_date.desc" }),                         mediaType: "movie", imageMode: "backdrop" },
  // 15
  { kind: "movieRow", title: "First Love Romance",                                 fetcher: tmdb.netflixTV({ with_genres: "10749,18" }),                                         mediaType: "tv",    imageMode: "poster"   },
  // 16
  { kind: "movieRow", title: "K-Dramas",                                           fetcher: tmdb.netflixTV({ with_origin_country: "KR", with_genres: 18 }),                      mediaType: "tv",    imageMode: "poster"   },
  // 17 — recommendations for "Do You Like Brahms?" (TMDB TV 102922)
  { kind: "movieRow", title: "Do You Like Brahms",                                 fetcher: tmdb.tvRecommendations(102922),                                                      mediaType: "tv",    imageMode: "poster"   },
  // 18
  { kind: "movieRow", title: "Emotional Movie",                                    fetcher: tmdb.netflixMovie({ with_genres: 18, "vote_average.gte": 7 }),                       mediaType: "movie", imageMode: "poster"   },
  // 19
  { kind: "movieRow", title: "Eye Candy",                                          fetcher: tmdb.netflixMovie({ with_genres: "878,14" }),                                        mediaType: "movie", imageMode: "poster"   },
  // 20 — Netflix sorted by recency → backdrop
  { kind: "movieRow", title: "New on Netflix",                                     fetcher: tmdb.netflixTV({ sort_by: "first_air_date.desc" }),                                  mediaType: "tv",    imageMode: "backdrop" },
  // 21
  { kind: "movieRow", title: "US TV Shows",                                        fetcher: tmdb.netflixTV({ with_origin_country: "US" }),                                       mediaType: "tv",    imageMode: "poster"   },
  // 22
  { kind: "movieRow", title: "Critically Acclaimed TV Shows",                      fetcher: tmdb.netflixTV({ "vote_average.gte": 7.5, "vote_count.gte": 50 }),                   mediaType: "tv",    imageMode: "poster"   },
  // 23
  { kind: "movieRow", title: "Love language",                                      fetcher: tmdb.netflixTV({ with_genres: "10749,18" }),                                         mediaType: "tv",    imageMode: "poster"   },
  // 24
  { kind: "special",  key:  "myList",                                              title:  "My List"                                                                            },
  // 25
  { kind: "movieRow", title: "Downloads For You",                                  fetcher: tmdb.netflixTV({ with_original_language: "hi" }),                                    mediaType: "tv",    imageMode: "poster"   },
  // 26 — broad Asian Netflix TV
  { kind: "movieRow", title: "Asian TV Shows",                                     fetcher: tmdb.netflixTV({ with_origin_country: "KR|JP|CN|TH|HK|TW|IN" }),                    mediaType: "tv",    imageMode: "poster"   },
  // 27
  { kind: "movieRow", title: "Can this love be traslated",                         fetcher: tmdb.netflixTV({ with_genres: 10749, with_original_language: "ko|ja|zh|fr|es" }),   mediaType: "tv",    imageMode: "poster"   },
  // 28 — fantasy worlds → backdrop
  { kind: "movieRow", title: "Fantasy TV Shows",                                   fetcher: tmdb.netflixTV({ with_genres: 10765 }),                                              mediaType: "tv",    imageMode: "backdrop" },
  // 29
  { kind: "movieRow", title: "Made in India",                                      fetcher: tmdb.netflixTV({ with_origin_country: "IN" }),                                       mediaType: "tv",    imageMode: "poster"   },
  // 30
  { kind: "top10",    title: "Top 10 Shows in India Today",                        fetcher: tmdb.top10TrendingShowsIndia,                                                        mediaType: "tv"                           },
  // 31
  { kind: "movieRow", title: "Hidden Gems",                                        fetcher: tmdb.netflixMovie({ "vote_average.gte": 7, "vote_count.gte": 20 }),                  mediaType: "movie", imageMode: "poster"   },
  // 32
  { kind: "movieRow", title: "Romantic International Opposites-Attract TV Dramas", fetcher: tmdb.netflixTV({ with_genres: "10749,35" }),                                         mediaType: "tv",    imageMode: "poster"   },
  // 33 — recommendations for "Moving" (2023 Korean superhero, TMDB TV 225543)
  { kind: "movieRow", title: "Because You Watched The East",                       fetcher: tmdb.tvRecommendations(225543),                                                      mediaType: "tv",    imageMode: "poster"   },
  // 34 — mystery/noir → backdrop
  { kind: "movieRow", title: "Mysteries Dramas",                                   fetcher: tmdb.netflixTV({ with_genres: "53,9648" }),                                          mediaType: "tv",    imageMode: "backdrop" },
  // 35
  { kind: "movieRow", title: "US TV Comedies",                                     fetcher: tmdb.netflixTV({ with_origin_country: "US", with_genres: 35 }),                      mediaType: "tv",    imageMode: "poster"   },
  // 36 — recommendations for "Mr. Queen" (2020, TMDB TV 111050) — palace drama
  { kind: "movieRow", title: "Because you watched The Palace",                     fetcher: tmdb.tvRecommendations(111050),                                                      mediaType: "tv",    imageMode: "poster"   },
  // 37 — popular → backdrop
  { kind: "movieRow", title: "Popular on Stream",                                  fetcher: tmdb.netflixMovie(),                                                                 mediaType: "movie", imageMode: "backdrop" },
  // 38 — suspense → backdrop
  { kind: "movieRow", title: "Suspenseful TV Shows",                               fetcher: tmdb.netflixTV({ with_genres: "53,9648" }),                                          mediaType: "tv",    imageMode: "backdrop" },
  // 39
  { kind: "movieRow", title: "Korean TV Dramas",                                   fetcher: tmdb.netflixTV({ with_origin_country: "KR", with_genres: 18 }),                      mediaType: "tv",    imageMode: "poster"   },
  // 40
  { kind: "movieRow", title: "Romantic International TV Comedies",                 fetcher: tmdb.netflixTV({ with_genres: "10749,35" }),                                         mediaType: "tv",    imageMode: "poster"   },
  // 41 — Korean action → backdrop
  { kind: "movieRow", title: "Korean TV Action & Adventure",                       fetcher: tmdb.netflixTV({ with_origin_country: "KR", with_genres: 10759 }),                   mediaType: "tv",    imageMode: "backdrop" },
  // 42 — mind-bending → backdrop
  { kind: "movieRow", title: "Mind-Bending Stories",                               fetcher: tmdb.netflixMovie({ with_genres: "878,9648" }),                                      mediaType: "movie", imageMode: "backdrop" },
  // 43
  { kind: "movieRow", title: "Familiar Favourite Series",                          fetcher: tmdb.netflixTV({ "vote_average.gte": 7.5, "vote_count.gte": 50 }),                   mediaType: "tv",    imageMode: "poster"   },
  // 44
  { kind: "movieRow", title: "Asian Movies & TV",                                  fetcher: tmdb.netflixTV({ with_origin_country: "JP|KR|CN|TH|IN|HK|TW" }),                    mediaType: "tv",    imageMode: "poster"   },
  // 45
  { kind: "movieRow", title: "J-Dramas",                                           fetcher: tmdb.netflixTV({ with_original_language: "ja", with_origin_country: "JP" }),         mediaType: "tv",    imageMode: "poster"   },
  // 46 — psychological thrillers → dark backdrop
  { kind: "movieRow", title: "Psychological Thrillers",                            fetcher: tmdb.netflixMovie({ with_genres: "53,9648" }),                                       mediaType: "movie", imageMode: "backdrop" },
  // 47
  { kind: "movieRow", title: "Anime",                                              fetcher: tmdb.netflixTV({ with_genres: 16, with_origin_country: "JP" }),                      mediaType: "tv",    imageMode: "poster"   },
  // 48
  { kind: "movieRow", title: "Bingeworthy TV Shows",                               fetcher: tmdb.netflixTV({ "vote_average.gte": 7.5 }),                                         mediaType: "tv",    imageMode: "poster"   },
  // 49
  { kind: "movieRow", title: "Dreams to you",                                      fetcher: tmdb.netflixTV({ with_genres: "10749,14" }),                                         mediaType: "tv",    imageMode: "poster"   },
  // 50
  { kind: "movieRow", title: "Critically Acclaimed US TV Dramas",                  fetcher: tmdb.netflixTV({ with_origin_country: "US", with_genres: 18 }),                      mediaType: "tv",    imageMode: "poster"   },
  // 51
  { kind: "movieRow", title: "Coming of Age",                                      fetcher: tmdb.netflixMovie({ with_genres: "18,14" }),                                         mediaType: "movie", imageMode: "poster"   },
  // 52 — Everyone's Watching → Netflix popular movies → backdrop
  { kind: "movieRow", title: "Everyone's Watching",                                fetcher: tmdb.netflixMovie({ sort_by: "popularity.desc" }),                                   mediaType: "movie", imageMode: "backdrop" },
  // 53
  { kind: "movieRow", title: "Movies & TV Shows Dubbed in Telugu",                 fetcher: tmdb.netflixTV({ with_original_language: "te" }),                                    mediaType: "tv",    imageMode: "poster"   },
  // 54 — global picks → wide cinematic
  { kind: "movieRow", title: "Global Top Picks",                                   fetcher: tmdb.netflixMovie(),                                                                 mediaType: "movie", imageMode: "backdrop" },
  // 55
  { kind: "movieRow", title: "Erase My Memory So I Can Watch Again",               fetcher: tmdb.netflixTV({ "vote_average.gte": 7.5, "vote_count.gte": 50 }),                   mediaType: "tv",    imageMode: "poster"   },
  // 56
  { kind: "movieRow", title: "Swoonworthy Romance",                                fetcher: tmdb.netflixTV({ with_genres: "10749,35" }),                                         mediaType: "tv",    imageMode: "poster"   },
  // 57 — sci-fi & horror → backdrop
  { kind: "movieRow", title: "TV Sci-Fi & Horror",                                 fetcher: tmdb.netflixTV({ with_genres: "10765,27" }),                                         mediaType: "tv",    imageMode: "backdrop" },
  // 58 — crowd pleasers → backdrop
  { kind: "movieRow", title: "Crowd Pleasers",                                     fetcher: tmdb.netflixTV({ with_genres: "10759,80,53" }),                                      mediaType: "tv",    imageMode: "backdrop" },
  // 59 — Netflix exclusives → backdrop (already Netflix)
  { kind: "movieRow", title: "Only On Netflix shows",                              fetcher: tmdb.onlyOnNetflix,                                                                  mediaType: "tv",    imageMode: "backdrop" },
  // 60
  { kind: "movieRow", title: "Kids & Family",                                      fetcher: tmdb.netflixMovie({ with_genres: "10751,16" }),                                      mediaType: "movie", imageMode: "poster"   },
  // 61 — action movies → backdrop
  { kind: "movieRow", title: "Get In on the Action",                               fetcher: tmdb.netflixMovie({ with_genres: "28,12" }),                                         mediaType: "movie", imageMode: "backdrop" },
  // 62
  { kind: "top10",    title: "Top 10 Movie India",                                 fetcher: tmdb.top10NetflixIndia,                                                              mediaType: "movie"                        },
  // 63 — blockbusters → wide cinematic
  { kind: "movieRow", title: "Blockbuster Movies",                                 fetcher: tmdb.netflixMovie(),                                                                 mediaType: "movie", imageMode: "backdrop" },
  // 64 — horror/thriller at night → dark backdrop
  { kind: "movieRow", title: "Late Night Watch",                                   fetcher: tmdb.netflixMovie({ with_genres: "27,53" }),                                         mediaType: "movie", imageMode: "backdrop" },
  // 65 — top-rated Netflix movies
  { kind: "movieRow", title: "IMDb Top Rated",                                     fetcher: tmdb.netflixMovie({ sort_by: "vote_average.desc", "vote_count.gte": 50 }),           mediaType: "movie", imageMode: "backdrop" },
  // 66
  { kind: "movieRow", title: "Leaving Soon",                                       fetcher: tmdb.netflixMovie(),                                                                 mediaType: "movie", imageMode: "poster"   },
  // 67
  { kind: "movieRow", title: "Top 5 show by Netflix Korean",                       fetcher: tmdb.top5NetflixKorean,                                                             mediaType: "tv",    imageMode: "poster"   },
  // 68 — S-Movie curated prestige titles (Netflix movies rated 7.5+)
  { kind: "movieRow", title: "Only On S-Movie original",                           fetcher: tmdb.netflixMovie({ sort_by: "vote_average.desc", "vote_average.gte": 7 }),          mediaType: "movie", imageMode: "backdrop" },
  // 69 — Netflix anime
  { kind: "movieRow", title: "Anime Series",                                       fetcher: tmdb.netflixTV({ with_genres: 16, "vote_average.gte": 7 }),                          mediaType: "tv",    imageMode: "poster"   },
  // 70 — ethereal romance Netflix TV
  { kind: "movieRow", title: "Dream to you",                                       fetcher: tmdb.netflixTV({ with_genres: "10749,14" }),                                         mediaType: "tv",    imageMode: "poster"   },
  // 71
  { kind: "movieRow", title: "Indian Movies",                                      fetcher: tmdb.netflixMovie({ with_original_language: "hi" }),                                 mediaType: "movie", imageMode: "poster"   },
  // 72
  { kind: "movieRow", title: "Romantic Indian movies",                             fetcher: tmdb.netflixMovie({ with_genres: 10749, with_original_language: "hi" }),             mediaType: "movie", imageMode: "poster"   },
  // 73
  { kind: "movieRow", title: "Desi & chil",                                        fetcher: tmdb.netflixTV({ with_original_language: "hi" }),                                    mediaType: "tv",    imageMode: "poster"   },
  // 74 — recommendations for "A Piece of Your Mind" (TMDB TV 99024)
  { kind: "movieRow", title: "A Piece of Your Mind",                               fetcher: tmdb.tvRecommendations(99024),                                                       mediaType: "tv",    imageMode: "poster"   },
  // 75 — recommendations for "Goblin / Guardian" (TMDB TV 68865)
  { kind: "movieRow", title: "The Lonely and Great God",                           fetcher: tmdb.tvRecommendations(68865),                                                       mediaType: "tv",    imageMode: "poster"   },
  // 76 — recommendations for "Sweet Home" (TMDB TV 109545)
  { kind: "movieRow", title: "Sweet home",                                         fetcher: tmdb.tvRecommendations(109545),                                                      mediaType: "tv",    imageMode: "poster"   },
  // 77 — recommendations for "Our Beloved Summer" (TMDB TV 123249)
  { kind: "movieRow", title: "Our Beloved Summer",                                 fetcher: tmdb.tvRecommendations(123249),                                                      mediaType: "tv",    imageMode: "poster"   },
  // 78 — recommendations for "When the Weather is Fine" (TMDB TV 96821)
  { kind: "movieRow", title: "When the Weather is Fine",                           fetcher: tmdb.tvRecommendations(96821),                                                       mediaType: "tv",    imageMode: "poster"   },
  // 79 — recommendations for "When Life Gives You Tangerines" (TMDB TV 280648)
  { kind: "movieRow", title: "When Life Gives You Tangerines",                     fetcher: tmdb.tvRecommendations(280648),                                                      mediaType: "tv",    imageMode: "poster"   },
  // 80 — recommendations for "Twenty-Five Twenty-One" (TMDB TV 159155)
  { kind: "movieRow", title: "Twenty-Five Twenty-One",                             fetcher: tmdb.tvRecommendations(159155),                                                      mediaType: "tv",    imageMode: "poster"   },
  // 81 — recommendations for "Lovely Runner" (TMDB TV 237811)
  { kind: "movieRow", title: "Lovely Runner",                                      fetcher: tmdb.tvRecommendations(237811),                                                      mediaType: "tv",    imageMode: "poster"   },
  // 82
  { kind: "movieRow", title: "Romantic Comedies",                                  fetcher: tmdb.netflixMovie({ with_genres: "10749,35" }),                                      mediaType: "movie", imageMode: "poster"   },
  // 83 — Netflix US (English) movies
  { kind: "movieRow", title: "US Movies dubbed in Hindi",                          fetcher: tmdb.netflixMovie({ with_original_language: "en" }),                                 mediaType: "movie", imageMode: "poster"   },
  // 84 — recommendations for "Alice in Borderland" (TMDB TV 108545)
  { kind: "movieRow", title: "Alice in borderland",                                fetcher: tmdb.tvRecommendations(108545),                                                      mediaType: "tv",    imageMode: "poster"   },
  // 85 — TMDB curated list 4729 (Romantic Indian Dramas)
  { kind: "movieRow", title: "Romantic Indian Dramas",                             fetcher: (p) => tmdb.list(4729, p),                                                          mediaType: "tv",    imageMode: "poster"   },
  // 86 — TMDB curated list 31574 (Classics)
  { kind: "movieRow", title: "Classics",                                           fetcher: (p) => tmdb.list(31574, p),                                                         mediaType: "movie", imageMode: "backdrop" },
  // 87 — TMDB curated list 783 (Children & Family Films)
  { kind: "movieRow", title: "Children & Family Films",                            fetcher: (p) => tmdb.list(783, p),                                                           mediaType: "movie", imageMode: "poster"   },
  // 88 — TMDB curated list 1492 (Sci-Fi & Fantasy)
  { kind: "movieRow", title: "Sci-Fi & Fantasy",                                   fetcher: (p) => tmdb.list(1492, p),                                                          mediaType: "movie", imageMode: "backdrop" },
  // 89 — TMDB curated list 8933 (Thrillers)
  { kind: "movieRow", title: "Thrillers",                                          fetcher: (p) => tmdb.list(8933, p),                                                          mediaType: "movie", imageMode: "backdrop" },
  // 90 — Top 10 Netflix Shows globally (already Netflix in tmdb.ts)
  { kind: "top10",    title: "Top 10 Shows in All Country Today",                  fetcher: tmdb.top10ShowsAllCountries,                                                         mediaType: "tv"                           },
];
