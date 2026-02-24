export const QUALITY_ISSUES = {
  AI_SLOP_CLICHES: "Avoid generic AI-sounding clichés in hook/body/CTA.",
  CONDESCENDING: "Avoid condescending or insulting phrasing. Treat readers as informed operators.",
  UNSUPPORTED_ADAPTY_SUPERLATIVE:
    "When claiming Adapty is best-in-market, support it with concrete proof, mechanism, or evidence.",
  CORPORATE_JARGON: "Avoid corporate jargon. Use plain, direct language app makers use in real conversations.",
  ROBOTIC_TONE: "Tone sounds robotic or corporate. Rewrite to sound human, direct, and relatable.",
  MISSING_DIRECT_READER: "Add at least one direct reader line using you, your app, or your team.",
  MISSING_OPERATOR_ACTION:
    "Add one practical operator action sentence with a clear verb like test, measure, compare, fix, or ship.",
  UNEXPANDED_SOIS: "Write SOIS as State of In-App Subscriptions (SOIS) on first mention.",
  LABEL_STYLE_OPENER: "Avoid sentence-start label scaffolds using word-plus-colon format.",
  AI_SCAFFOLD_OPENER:
    "Avoid AI-style rhetorical label openers such as Strong stance:, Hard truth:, Hot take:, or Caveat,.",
  ROBOTIC_FILLER: "Avoid robotic filler phrasing like The timing gap is real.",
  SNAPSHOT_JARGON: "Avoid internal dataset phrasing like segment snapshot, rows analyzed, or sample size.",
  DENSE_METRIC_DUMP: "Avoid dense metric dumps in one sentence. Keep data phrasing plain and human.",
  MISSING_PROOF_UNIT: "Add at least one concrete proof unit such as number, metric, or specific mechanism.",
  MISSING_NUMERIC_ANCHOR: "Use at least one real numeric anchor from provided evidence or input context.",
  MISSING_SPECIFICITY:
    "Be more specific. Add concrete anchors like exact event type, named source/entity, date, place, URL, or metric.",
  MISSING_BLANK_LINES: "Add blank lines between subtopics so longer body text is readable.",
  SHORT_LINE_STACK: "Avoid stacking ultra-short lines back-to-back.",
  STACCATO_RHYTHM:
    "Body rhythm is too staccato. Use fuller paragraphs with mostly 2-4 sentences and keep one-line paragraphs occasional.",
  CLICKBAIT_HOOK_ONE_SENTENCE: "For clickbait plus virality, hook must be one sentence.",
  CLICKBAIT_HOOK_DECLARATIVE:
    "For clickbait plus virality, hook should be a declarative statement, not a question.",
  CLICKBAIT_HOOK_NO_IF: "For clickbait plus virality, do not open hook with If ...",
  CLICKBAIT_HOOK_NEEDS_FACT_ANCHOR:
    "For clickbait plus virality, hook must open with one concrete factual anchor (number, named platform, date, metric, or source).",
  CLICKBAIT_HOOK_DIRECT_READER:
    "For clickbait plus virality, prefer direct user framing with you or your when natural.",
  EVENT_MISSING_TIME: "Event post must include the provided event time.",
  EVENT_MISSING_PLACE: "Event post must include the provided event place.",
  EVENT_BODY_THIN: "Event post body is too thin. Add operator context, practical value, and logistics.",
  EVENT_MISSING_FORMAT:
    "Event post should name the concrete event format (for example webinar, roundtable, workshop, or dinner).",
} as const;

export const QUALITY_GATE_PROMPT_LINES = [
  "Read each post as if saying it out loud to a friend. If any sentence sounds unnatural spoken, rewrite it simpler.",
  "Every post needs at least one specific number, name, or real example.",
  "Ground facts in provided evidence only. If you have no data for a claim, phrase it as opinion.",
  "Write SOIS as State of In-App Subscriptions (SOIS) on first mention.",
  "For events: include date, place, and who should come.",
  "Use hyphens, commas, and periods. No em dashes or en dashes.",
  "For clickbait plus virality: hook must be one declarative factual sentence, not a question, not starting with If.",
] as const;

export const QUALITY_REPAIR_REQUIREMENT_LINES = [
  "Write in natural paragraphs (2-4 sentences each) with blank lines between subtopics.",
  "Sound like a sharp friend talking to an app maker. Use plain spoken language.",
  "Talk to the reader directly at least once: you, your app, or your team.",
  "Include one practical action with a clear verb: test, measure, compare, fix, or ship.",
  "Include at least one real numeric anchor from provided evidence when available. Only use grounded numbers.",
  "Use hyphens, commas, and periods only. No em dashes or en dashes.",
  "For events: include logistics and who should attend.",
  "For clickbait plus virality: hook must be one declarative factual sentence using you or your, not starting with If.",
] as const;

