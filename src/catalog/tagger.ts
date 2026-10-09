import type { Occasion, Recipient } from "../domain/types.js";

/**
 * Keyword-based tagging for feeds that don't carry our tags. Deliberately conservative:
 * a missing tag only means a product is matched less often; a wrong tag shows it to the wrong person.
 * Interest tags must match the ones offered in the conversation (src/conversation/options.ts).
 */
const INTEREST_KEYWORDS: Record<string, string[]> = {
  coffee: ["קפה", "אספרסו", "קפסולות", "פולי קפה", "מקינטה", "coffee", "espresso"],
  cooking: ["בישול", "מטבח", "אפייה", "סכין שף", "מחבת", "סיר", "ספר בישול", "תבלינים", "cooking", "kitchen", "baking"],
  hiking: ["טיול", "טיולים", "קמפינג", "תרמיל", "ערסל", "hiking", "camping", "outdoor"],
  fitness: ["ספורט", "כושר", "ריצה", "יוגה", "פילאטיס", "משקולות", "fitness", "yoga", "running", "gym"],
  reading: ["ספר", "ספרים", "קריאה", "מחברת", "יומן", "כתיבה", "book", "books", "notebook", "journal"],
  gaming: ["משחק קופסה", "משחקי קופסה", "גיימינג", "קונסולה", "פאזל", "board game", "gaming", "puzzle"],
  music: ["מוזיקה", "מוסיקה", "רמקול", "אוזניות", "תקליט", "גיטרה", "music", "speaker", "headphones", "vinyl"],
  gardening: ["גינון", "צמח", "צמחים", "עציץ", "עציצים", "זרעים", "גינה", "gardening", "plant", "plants"],
  photography: ["צילום", "מצלמה", "אלבום", "מסגרת תמונה", "תמונה מודפסת", "photo", "camera", "album"],
};

const BABY_KEYWORDS = ["תינוק", "תינוקת", "תינוקות", "יילוד", "יילודה", "לידה", "baby", "newborn"];

/**
 * Prefixes stripped before matching: "the", "and", "to/for" ("לתינוק" → "תינוק").
 * Others (מ, ב, ש, כ) are left alone: stripping them creates false tags ("מספר" — number → "ספר" — book).
 */
const HEBREW_PREFIXES = new Set(["ה", "ו", "ל"]);

export interface InferredTags {
  interests: string[];
  /** Set only when the text clearly targets a specific recipient. */
  recipients?: Recipient[];
  occasions?: Occasion[];
}

export function inferTags(text: string): InferredTags {
  const words = tokenize(text);
  const wordSet = new Set(words);
  for (const w of words) if (w.length > 2 && HEBREW_PREFIXES.has(w.charAt(0))) wordSet.add(w.slice(1));
  const joined = ` ${words.join(" ")} `;

  const has = (keyword: string) => {
    const kw = tokenize(keyword);
    return kw.length === 1 ? wordSet.has(kw[0]!) : joined.includes(` ${kw.join(" ")} `);
  };

  const interests = Object.entries(INTEREST_KEYWORDS)
    .filter(([, keywords]) => keywords.some(has))
    .map(([tag]) => tag);

  if (BABY_KEYWORDS.some(has)) return { interests, recipients: ["baby"], occasions: ["birth", "birthday"] };
  return { interests };
}

function tokenize(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}
