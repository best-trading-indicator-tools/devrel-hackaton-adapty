export const POST_TYPE_OPTIONS = [
  "Product feature launch",
  "Event / webinar promo",
  "Sauce: breakdown / guide",
  "Sauce: data insight",
  "Meme / shitpost",
  "Industry news reaction",
  "Engagement farming: poll/quiz",
  "Case study / social proof",
  "Hiring / team culture",
  "Milestone / company update",
  "Controversial hot take",
  "Curated roundup",
] as const;

export const INPUT_LENGTH_OPTIONS = ["short", "standard", "long", "mix"] as const;

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

export type MemeTemplateId = (typeof MEME_TEMPLATE_OPTIONS)[number]["id"];

export const MEME_TEMPLATE_IDS = MEME_TEMPLATE_OPTIONS.map((template) => template.id) as [
  (typeof MEME_TEMPLATE_OPTIONS)[number]["id"],
  ...(typeof MEME_TEMPLATE_OPTIONS)[number]["id"][],
];

export const MEME_TEMPLATE_LABELS: Record<MemeTemplateId, string> = MEME_TEMPLATE_OPTIONS.reduce(
  (acc, template) => {
    acc[template.id] = template.name;
    return acc;
  },
  {} as Record<MemeTemplateId, string>,
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

const LENGTH_SEQUENCE: OutputLength[] = ["short", "standard", "long"];

export function buildLengthPlan(inputLength: InputLength, count: number): OutputLength[] {
  if (inputLength !== "mix") {
    return Array.from({ length: count }, () => inputLength);
  }

  return Array.from({ length: count }, (_, index) => LENGTH_SEQUENCE[index % LENGTH_SEQUENCE.length]);
}

export function lengthGuide(length: OutputLength): string {
  switch (length) {
    case "short":
      return "2-4 short paragraphs, around 350-550 characters.";
    case "standard":
      return "5-8 paragraphs, around 600-1000 characters.";
    case "long":
      return "8-14 paragraphs, around 1000-1700 characters.";
    default:
      return "Natural LinkedIn length.";
  }
}
