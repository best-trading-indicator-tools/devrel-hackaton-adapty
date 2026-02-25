/**
 * Slack product updates types for #product-release channel.
 * Data is synced via Slack MCP and stored in data/slack-product-updates.json.
 */

export type SlackProductUpdateEntry = {
  id: string;
  /** Slack message permalink */
  slackUrl: string;
  /** Parent message text */
  message: string;
  /** ISO date of parent message */
  date: string;
  /** Thread replies that matched (product people or team mentions) */
  matchingReplies: {
    userId: string;
    userName: string;
    text: string;
    date: string;
  }[];
  /** Whether thread has @sales-team or @cs-team mention */
  hasTeamMention: boolean;
};

export type SlackProductUpdatesData = {
  syncedAt: string;
  channel: string;
  entries: SlackProductUpdateEntry[];
};
