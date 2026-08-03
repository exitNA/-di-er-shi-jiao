import type { SearchClient } from "@/server/search/search-client";

export type SearchTool = Pick<SearchClient, "search">;
