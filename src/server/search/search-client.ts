export type SearchResult = {
  title: string;
  url: string;
  domain: string;
  content: string;
  rawContent?: string;
  publishedAt?: string;
  score: number;
};

export interface SearchClient {
  search(input: {
    query: string;
    topic: "general" | "news";
    maxResults: 5;
    signal?: AbortSignal;
  }): Promise<SearchResult[]>;
}
