export const BRAND_VOICE_PRESETS = [
  "adapty",
  "clickbait",
  "founder personal",
  "bold / contrarian",
  "technical breakdown",
  "playful meme tone",
] as const;

export type BrandVoicePreset = (typeof BRAND_VOICE_PRESETS)[number];

export const BRAND_VOICE_PROFILES: Record<
  BrandVoicePreset,
  {
    label: string;
    uiDescription: string;
    promptDirective: string;
  }
> = {
  adapty: {
    label: "Adapty",
    uiDescription:
      "Mirror the proven Adapty LinkedIn voice from your internal library: sharp, practical, data-aware, and actionable.",
    promptDirective:
      "Match the library examples closely: same rhythm, same formatting, same storytelling style. Keep all copy original. Show why Adapty matters through real mechanisms and facts, not hype.",
  },
  clickbait: {
    label: "Clickbait",
    uiDescription:
      "Use curiosity-heavy hooks and tension that invite clicks, while keeping every claim truthful and specific.",
    promptDirective:
      "Lead with hooks that make people stop scrolling. Create real stakes and curiosity. Keep every claim factual and specific. Make people want to read the next line.",
  },
  "founder personal": {
    label: "Founder Personal",
    uiDescription:
      "Write like a founder sharing learned lessons from the field, with first-person insight and concrete examples.",
    promptDirective:
      "Write in first person like a founder sharing what they learned the hard way. Use real observations, trade-offs, and concrete examples from operating experience.",
  },
  "bold / contrarian": {
    label: "Bold / Contrarian",
    uiDescription:
      "Challenge common growth assumptions directly, then back the take with mechanics, caveats, and practical alternatives.",
    promptDirective:
      "Pick a common belief in the space and challenge it directly. Back up the contrarian take with mechanics, caveats, and a better alternative. Critique decisions, not people.",
  },
  "technical breakdown": {
    label: "Technical Breakdown",
    uiDescription:
      "Use a clear, step-by-step analytical style with concrete metrics, framework clarity, and implementation detail.",
    promptDirective:
      "Write like a builder explaining how something actually works. Walk through the mechanism step by step with real numbers and clear language.",
  },
  "playful meme tone": {
    label: "Playful Meme Tone",
    uiDescription:
      "Keep the tone witty and internet-native while staying relevant to mobile app growth and monetization realities.",
    promptDirective:
      "Keep it witty, internet-native, and fun. Use meme energy and humor while staying relevant to real app monetization pain points.",
  },
};

export function isBrandVoicePreset(value: string): value is BrandVoicePreset {
  return (BRAND_VOICE_PRESETS as readonly string[]).includes(value);
}

export const POST_TYPE_OPTIONS = [
  "Product feature launch",
  "Event / webinar promo",
  "Sauce",
  "Meme / shitpost",
  "Industry news reaction",
  "Engagement farming: poll/quiz",
  "Case study / social proof",
  "Hiring / team culture",
  "Milestone / company update",
  "Controversial hot take",
  "Curated roundup",
] as const;

export const POST_TYPE_UI_DESCRIPTIONS: Record<(typeof POST_TYPE_OPTIONS)[number], string> = {
  "Product feature launch": "Announce a new feature or major update with user pain, solution, and concrete impact.",
  "Event / webinar promo": "Promote an upcoming event with clear why-now, logistics, and who should attend.",
  Sauce: "Share tactical insights, data-backed mechanics, and practical steps teams can apply this week.",
  "Meme / shitpost": "Use humorous, relatable takes tied to real B2C app monetization or growth pain points.",
  "Industry news reaction": "Give a sharp take on recent industry news with clear implications and next moves.",
  "Engagement farming: poll/quiz": "Ask high-signal questions that invite comments, votes, and operator viewpoints.",
  "Case study / social proof": "Show before/after outcomes with context, intervention, and measurable result.",
  "Hiring / team culture": "Share role opportunities, team values, and what working style looks like in practice.",
  "Milestone / company update": "Communicate progress milestones and what changed operationally to reach them.",
  "Controversial hot take": "Challenge accepted habits with a strong stance, caveats, and practical alternative.",
  "Curated roundup": "Publish a digest of top resources, examples, or observations with quick takeaways.",
};

export const INPUT_LENGTH_OPTIONS = ["short", "medium", "long", "very long", "mix"] as const;

export type InputLength = (typeof INPUT_LENGTH_OPTIONS)[number];
export type OutputLength = Exclude<InputLength, "mix">;

export const GOAL_OPTIONS = ["virality", "engagement", "traffic", "awareness", "balanced"] as const;
export type ContentGoal = (typeof GOAL_OPTIONS)[number];

export const CHART_TYPE_OPTIONS = ["bar", "line", "doughnut", "pie", "polarArea", "radar"] as const;
export type ChartTypeOption = (typeof CHART_TYPE_OPTIONS)[number];

export const CHART_TYPE_LABELS: Record<ChartTypeOption, string> = {
  bar: "Bar",
  line: "Line",
  doughnut: "Doughnut",
  pie: "Pie",
  polarArea: "Polar Area",
  radar: "Radar",
};

export const MEME_TEMPLATE_OPTIONS = [
  { id: "drake", name: "Drake Hotline Bling" },
  { id: "woman-cat", name: "Woman Yelling at Cat" },
  { id: "spiderman", name: "Spider-Man Pointing at Spider-Man" },
  { id: "both", name: "Why Not Both?" },
  { id: "wonka", name: "Condescending Wonka" },
  { id: "buzz", name: "X Everywhere" },
  { id: "fry", name: "Futurama Fry" },
  { id: "stonks", name: "Stonks" },
] as const;

export type CuratedMemeTemplateId = (typeof MEME_TEMPLATE_OPTIONS)[number]["id"];
export type MemeTemplateId = string;

export const MEME_TEMPLATE_IDS = MEME_TEMPLATE_OPTIONS.map((template) => template.id) as [
  (typeof MEME_TEMPLATE_OPTIONS)[number]["id"],
  ...(typeof MEME_TEMPLATE_OPTIONS)[number]["id"][],
];

export const MEME_TEMPLATE_LABELS: Record<string, string> = MEME_TEMPLATE_OPTIONS.reduce(
  (acc, template) => {
    acc[template.id] = template.name;
    return acc;
  },
  {} as Record<string, string>,
);

export const GOAL_LABELS: Record<ContentGoal, string> = {
  virality: "Virality",
  engagement: "Engagement",
  traffic: "Traffic",
  awareness: "Awareness",
  balanced: "Balanced",
};

export const GOAL_DESCRIPTIONS: Record<ContentGoal, string> = {
  virality: "maximize reach, reposts, and conversation velocity",
  engagement: "maximize quality discussion and comments",
  traffic: "maximize click-throughs and CTR",
  awareness: "maximize impressions and broad visibility",
  balanced: "optimize across reach, engagement, and clicks evenly",
};

export const GOAL_UI_DESCRIPTIONS: Record<ContentGoal, string> = {
  virality:
    "Maximize shareability and repost momentum with bold hooks and high-contrast takes people want to forward.",
  engagement:
    "Optimize for quality comments and debate by using nuanced prompts, opinion triggers, and discussion-friendly framing.",
  traffic:
    "Drive qualified clicks with clear value framing, concrete promise lines, and CTA-first narrative structure.",
  awareness:
    "Maximize broad reach and brand recall with clear positioning, repeated key message, and easy-to-scan structure.",
  balanced:
    "Balance reach, comments, and clicks without over-optimizing one metric; prioritize practical clarity across all.",
};

const LENGTH_SEQUENCE: OutputLength[] = ["short", "medium", "long", "very long"];

export function buildLengthPlan(inputLength: InputLength, count: number): OutputLength[] {
  if (inputLength !== "mix") {
    return Array.from({ length: count }, () => inputLength);
  }

  return Array.from({ length: count }, (_, index) => LENGTH_SEQUENCE[index % LENGTH_SEQUENCE.length]);
}

export function lengthGuide(length: OutputLength): string {
  switch (length) {
    case "short":
      return "2-4 sentences.";
    case "medium":
      return "5-9 sentences.";
    case "long":
      return "18-35 sentences.";
    case "very long":
      return "36-90 sentences.";
    default:
      return "Natural LinkedIn length.";
  }
}
