/**
 * Slack product updates types for #product-release channel.
 * Data is synced via Slack Web API and stored in data/slack-product-updates.json.
 */

export type SlackThreadMessage = {
  userId: string;
  userName: string;
  text: string;
  date: string;
  /** Image URLs from attached files (url_private; requires auth to fetch) */
  images: string[];
};

export type SlackProductUpdateEntry = {
  id: string;
  /** Slack message permalink */
  slackUrl: string;
  /** Short title (e.g. "Ads Manager product update") */
  name: string;
  /** Parent message text */
  message: string;
  /** Feature release date (ISO YYYY-MM-DD); parsed from message or post date fallback */
  releaseDate: string;
  /** Full thread: parent + all replies in chronological order */
  thread: SlackThreadMessage[];
  /** Combined content for AI consumption (parent + replies) */
  content: string;
  /** Thread replies that matched filter (product people or team mentions) */
  matchingReplies: SlackThreadMessage[];
  /** Whether thread has @sales-team or @cs-team mention */
  hasTeamMention: boolean;
  /** All image URLs from the thread (parent + replies) */
  images: string[];
};

export type SlackProductUpdatesData = {
  syncedAt: string;
  channel: string;
  entries: SlackProductUpdateEntry[];
};
