export type FeedCategory = "platform" | "monetization" | "growth";

export type RssFeed = {
  id: string;
  name: string;
  category: FeedCategory;
  url: string;
  priority: 1 | 2 | 3;
  tags: string[];
  enabled: boolean;
};

export const RSS_FEEDS: RssFeed[] = [
  {
    id: "apple-dev-news",
    name: "Apple Developer News",
    category: "platform",
    url: "https://developer.apple.com/news/rss/news.rss",
    priority: 1,
    tags: ["ios", "app-store", "policy"],
    enabled: true,
  },
  {
    id: "apple-dev-releases",
    name: "Apple Developer Releases",
    category: "platform",
    url: "https://developer.apple.com/news/releases/rss/releases.rss",
    priority: 1,
    tags: ["ios", "sdk", "release-notes"],
    enabled: true,
  },
  {
    id: "android-dev-blog",
    name: "Android Developers Blog",
    category: "platform",
    url: "https://android-developers.googleblog.com/feeds/posts/default?alt=rss",
    priority: 1,
    tags: ["android", "play-store", "policy"],
    enabled: true,
  },
  {
    id: "react-native-blog",
    name: "React Native Blog",
    category: "platform",
    url: "https://reactnative.dev/blog/rss.xml",
    priority: 2,
    tags: ["react-native", "mobile-dev"],
    enabled: true,
  },
  {
    id: "ios-dev-weekly",
    name: "iOS Dev Weekly",
    category: "platform",
    url: "https://iosdevweekly.com/issues.rss",
    priority: 2,
    tags: ["ios", "ecosystem"],
    enabled: true,
  },
  {
    id: "android-weekly",
    name: "Android Weekly",
    category: "platform",
    url: "https://androidweekly.net/rss",
    priority: 2,
    tags: ["android", "ecosystem"],
    enabled: true,
  },
  {
    id: "revenuecat-blog",
    name: "RevenueCat Blog",
    category: "monetization",
    url: "https://revenuecat.com/blog/rss.xml",
    priority: 1,
    tags: ["subscriptions", "paywalls", "retention"],
    enabled: true,
  },
  {
    id: "appfigures-insights",
    name: "Appfigures Insights",
    category: "monetization",
    url: "https://appfigures.com/resources/rss/insights",
    priority: 1,
    tags: ["aso", "store-intelligence", "market-data"],
    enabled: true,
  },
  {
    id: "apptopia-feed",
    name: "Apptopia Blog",
    category: "monetization",
    url: "https://apptopia.com/en/feed/",
    priority: 2,
    tags: ["app-growth", "market-data"],
    enabled: true,
  },
  {
    id: "branch-blog",
    name: "Branch Blog",
    category: "growth",
    url: "https://www.branch.io/feed/",
    priority: 2,
    tags: ["attribution", "deep-linking"],
    enabled: true,
  },
  {
    id: "appsflyer-blog",
    name: "AppsFlyer Blog",
    category: "growth",
    url: "https://www.appsflyer.com/feed/",
    priority: 2,
    tags: ["measurement", "attribution", "ua"],
    enabled: true,
  },
];

