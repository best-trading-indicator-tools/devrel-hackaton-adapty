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
  "Silently self-check every output before finalizing.",
  "If any rule fails, rewrite and self-check again before returning.",
  "Reject generic template cadence, staccato short-line stacks, and abstract filler.",
  "Prefer specific details over vague phrasing. Name concrete event format, source, metric, date, place, or example whenever available.",
  "If evidence or numeric inputs are available, include at least one real numeric anchor.",
  "Never invent numbers, percentages, dates, or benchmarks.",
  "Reject outputs without concrete proof units and without caveats.",
  "Reject unexplained acronyms. For SOIS, first mention must be State of In-App Subscriptions (SOIS).",
  "Reject sentence-start label scaffolds using word-plus-colon format.",
  "Reject low-value opener clichés like hard truth, game changer, nobody talks about, or let that sink in.",
  "Reject rhetorical label openers such as Strong stance:, Hard truth:, Hot take:, or Caveat,.",
  "Reject robotic or corporate-lame phrasing and replace it with direct human language.",
  "Require at least one direct reader line using you or your team when natural.",
  "Require one practical next action sentence with an operator verb.",
  "For clickbait plus virality, hook must be one declarative factual sentence and must not start with If ...",
  "Reject robotic phrasing like The timing gap is real. and internal dataset wording such as segment snapshot, rows analyzed, or sample size.",
  "Reject condescending or insulting phrasing toward the reader.",
  "When positioning Adapty, require concrete proof or mechanism-level support instead of empty best-in-market claims.",
  "For event and webinar posts, include explicit logistics and who should attend.",
  "Reject any sentence containing em dash or en dash punctuation.",
  "For factual claims: if web evidence is available, align to it. If evidence is missing, rewrite as opinion or observation and avoid unsupported hard facts.",
] as const;

export const QUALITY_REPAIR_REQUIREMENT_LINES = [
  "Use natural paragraphs with 1 to a few sentences per paragraph.",
  "Keep most paragraphs at 2-4 sentences and avoid one-line paragraph chains.",
  "Add blank lines between subtopics.",
  "Use plain spoken language and sound like a close smart friend to app makers.",
  "Include at least one direct reader line with you, your app, or your team.",
  "Include one practical operator action sentence with a clear verb like test, measure, compare, fix, or ship.",
  "Avoid cliché opener lines.",
  "Avoid rhetorical label openers such as Strong stance:, Hard truth:, Hot take:, or Caveat,.",
  "Avoid sentence-start label scaffolds using word-plus-colon format (for example Uncomfortable truth:).",
  "Keep tone respectful. Do not insult or patronize the reader.",
  "Use at least one real numeric anchor if evidence or numeric context is available.",
  "Never invent numbers. Only use numbers grounded in provided evidence, inputs, or chart data.",
  "For clickbait plus virality, hook must be one declarative factual sentence, should use you or your when natural, and must not start with If ...",
  "Avoid robotic phrasing like The timing gap is real. Avoid internal dataset wording like segment snapshot, rows analyzed, or sample size.",
  "If claiming Adapty is best-in-market, include mechanism-level support or concrete evidence.",
  "Never use em dash or en dash punctuation.",
  "If post type is event or webinar, include explicit logistics and who should attend.",
] as const;

