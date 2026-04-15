/** A fetched HTML page with its resolved URL, title, raw HTML, and detail-page flag. */
export interface SourcePage {
  readonly url: string;
  readonly title: string | null;
  readonly html: string;
  readonly isDetail: boolean;
}
