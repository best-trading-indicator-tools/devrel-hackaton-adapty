export const BRAND_VOICE_PRESETS = [
  "adapty",
  "clickbait",
  "bold / contrarian",
  // "founder personal",
  // "technical breakdown",
  // "playful meme tone",
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
      "Match the library examples closely: same rhythm, same formatting, same storytelling style. Stack scenario + mechanism + proof. Keep all copy original. Show why Adapty matters through real mechanisms and facts, not hype. Always sound like a sharp friend talking to another app maker. Human, direct, relatable.",
  },
  clickbait: {
    label: "Clickbait",
    uiDescription:
      "Use curiosity-heavy hooks and tension that invite clicks, while keeping every claim truthful and specific.",
    promptDirective:
      "Lead with hooks that make people stop scrolling. Stack curiosity + stakes + payoff. Create real stakes. Keep every claim factual and specific. Make people want to read the next line. Always sound like a sharp friend talking to another app maker. Human, direct, relatable.",
  },
  "bold / contrarian": {
    label: "Bold / Contrarian",
    uiDescription:
      "Challenge common growth assumptions directly, then back the take with mechanics, caveats, and practical alternatives.",
    promptDirective:
      "Pick a common belief and challenge it directly. Stack contrarian claim + mechanism + better alternative. Back with mechanics and caveats. Critique decisions, not people. Always sound like a sharp friend talking to another app maker. Human, direct, relatable.",
  },
  // "founder personal": {
  //   label: "Founder Personal",
  //   uiDescription:
  //     "Write like a founder sharing learned lessons from the field, with first-person insight and concrete examples.",
  //   promptDirective:
  //     "Write in first person like a founder sharing what they learned the hard way. Stack lived moment + trade-off + honest caveat. Use real observations and concrete examples from operating experience. Always sound like a sharp friend talking to another app maker. Human, direct, relatable.",
  // },
  // "technical breakdown": {
  //   label: "Technical Breakdown",
  //   uiDescription:
  //     "Use a clear, step-by-step analytical style with concrete metrics, framework clarity, and implementation detail.",
  //   promptDirective:
  //     "Write like a builder explaining how something actually works. Stack concrete setup + step-by-step mechanism + surprising result. Use real numbers and clear language. Always sound like a sharp friend talking to another app maker. Human, direct, relatable.",
  // },
  // "playful meme tone": {
  //   label: "Playful Meme Tone",
  //   uiDescription:
  //     "Keep the tone witty and internet-native while staying relevant to mobile app growth and monetization realities.",
  //   promptDirective:
  //     "Keep it witty, internet-native, and fun. Stack setup + punchline + relatable pain. Use meme energy while staying relevant to real app monetization pain points. Always sound like a sharp friend talking to another app maker. Human, direct, relatable.",
  // },
};

export function isBrandVoicePreset(value: string): value is BrandVoicePreset {
  return (BRAND_VOICE_PRESETS as readonly string[]).includes(value);
}

export const CONTENT_PROMO_POST_TYPE = "Post-event YouTube promo" as const;

export const POST_TYPE_OPTIONS = [
  "Product feature launch",
  "Event / webinar promo",
  CONTENT_PROMO_POST_TYPE,
  "Sauce",
  "Industry news reaction",
  // "Engagement farming: poll/quiz",
  // "Case study / social proof",
  // "Hiring / team culture",
  // "Milestone / company update",
  // "Controversial hot take",
  // "Curated roundup",
] as const;

export const POST_TYPE_UI_DESCRIPTIONS: Record<(typeof POST_TYPE_OPTIONS)[number], string> = {
  "Product feature launch": "Announce a new feature or major update with user pain, solution, and concrete impact.",
  "Event / webinar promo": "Promote an upcoming event with clear why-now, logistics, and who should attend.",
  [CONTENT_PROMO_POST_TYPE]:
    "Promote the event recording on YouTube: tease one specific takeaway and drive people to watch.",
  Sauce: "Share tactical insights, data-backed mechanics, and practical steps teams can apply this week.",
  "Industry news reaction": "Give a sharp take on recent industry news with clear implications and next moves.",
  // "Engagement farming: poll/quiz": "Ask high-signal questions that invite comments, votes, and operator viewpoints.",
  // "Case study / social proof": "Show before/after outcomes with context, intervention, and measurable result.",
  // "Hiring / team culture": "Share role opportunities, team values, and what working style looks like in practice.",
  // "Milestone / company update": "Communicate progress milestones and what changed operationally to reach them.",
  // "Controversial hot take": "Challenge accepted habits with a strong stance, caveats, and practical alternative.",
  // "Curated roundup": "Publish a digest of top resources, examples, or observations with quick takeaways.",
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

export const MEME_TEMPLATE_LABELS: Record<string, string> = {
  ...MEME_TEMPLATE_OPTIONS.reduce(
    (acc, template) => {
      acc[template.id] = template.name;
      return acc;
    },
    {} as Record<string, string>,
  ),
  disastergirl: "Disaster Girl",
  db: "Distracted Boyfriend",
  dbg: "Expectation vs Reality",
  pigeon: "Is This a Pigeon?",
  spongebob: "Mocking Spongebob",
  same: "They're The Same Picture",
  kombucha: "Kombucha Girl",
  harold: "Hide the Pain Harold",
  rollsafe: "Roll Safe",
};

/** Semantic meaning of each meme template so captions match the image. */
export const MEME_TEMPLATE_MEANINGS: Record<string, string> = {
  drake: "Reject vs choose: top = bad option (rejected), bottom = good option (chosen)",
  "woman-cat": "Person yelling at oblivious listener: top = accusation/frustration, bottom = clueless response",
  spiderman: "Two identical things pointing at each other: top and bottom = the same concept from different angles",
  both: "Why not both?: top = two options presented as either/or, bottom = 'why not both?'",
  wonka: "Condescending sarcasm: top = setup or claim, bottom = sarcastic put-down",
  buzz: "X everywhere: top = the thing, bottom = that thing everywhere",
  fry: "Skeptical squint: top = first possibility, bottom = second possibility (not sure which)",
  stonks: "Bad decision that seems smart: top = the move, bottom = the dumb outcome",
  disastergirl: "Skeptical knowing look: bottom = punchline (obvious truth, just as planned, ironic payoff)",
  db: "Distracted boyfriend: top = what he leaves, middle = what he looks at, bottom = girlfriend",
  dbg: "Expectation vs reality: top = expectation, bottom = disappointing reality",
  pigeon: "Misidentification: top = what it is, bottom = 'is this a pigeon?' style wrong guess",
  spongebob: "Mocking: same phrase, top normal, bottom mocking caps",
  same: "They're the same: three slots for things that are identical",
  kombucha: "Trying then disgusted: top = first try, bottom = second try (disgusted)",
  harold: "Hide the pain: top = situation, bottom = pained but smiling response",
  rollsafe: "Tap head logic: top = problem, bottom = 'can't X if you don't Y' style solution",
};

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
