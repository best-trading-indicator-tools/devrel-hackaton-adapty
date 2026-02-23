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
