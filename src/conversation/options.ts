import { normalizeTag, type Occasion, type Recipient } from "../domain/types.js";
import type { ChoiceOption } from "./messages.js";

/**
 * Every answer option the bot offers: the id sent with the button/list row, the Hebrew label,
 * and aliases so a user who types the answer instead of tapping is still understood.
 */
export interface AnswerOption<V> {
  id: string;
  value: V;
  title: string;
  aliases?: string[];
}

export const RECIPIENT_OPTIONS: AnswerOption<Recipient>[] = [
  { id: "r:partner", value: "partner", title: "בן/בת זוג", aliases: ["בעל", "אישה", "אשתי", "בעלי", "חבר שלי", "חברה שלי", "בת זוג", "בן זוג"] },
  { id: "r:parent", value: "parent", title: "אמא/אבא", aliases: ["אמא", "אבא", "הורה", "הורים", "אמא שלי", "אבא שלי"] },
  { id: "r:grandparent", value: "grandparent", title: "סבא/סבתא", aliases: ["סבא", "סבתא"] },
  { id: "r:sibling", value: "sibling", title: "אח/אחות", aliases: ["אח", "אחות", "אחי", "אחותי"] },
  { id: "r:child", value: "child", title: "ילד/ה", aliases: ["ילד", "ילדה", "בן", "בת"] },
  { id: "r:teen", value: "teen", title: "נער/ה", aliases: ["נער", "נערה", "מתבגר", "מתבגרת"] },
  { id: "r:baby", value: "baby", title: "תינוק/ת", aliases: ["תינוק", "תינוקת"] },
  { id: "r:friend", value: "friend", title: "חבר/ה", aliases: ["חבר", "חברה", "חברים"] },
  { id: "r:colleague", value: "colleague", title: "עמית/ה לעבודה", aliases: ["עמית", "עמיתה", "קולגה", "בוס", "מנהל", "מנהלת"] },
  { id: "r:other", value: "other", title: "מישהו אחר", aliases: ["אחר"] },
];

export const OCCASION_OPTIONS: AnswerOption<Occasion>[] = [
  { id: "o:birthday", value: "birthday", title: "יום הולדת", aliases: ["יומולדת", "יום הולדת", "יומהולדת"] },
  { id: "o:anniversary", value: "anniversary", title: "יום נישואין", aliases: ["נישואין", "יום נישואים"] },
  { id: "o:wedding", value: "wedding", title: "חתונה", aliases: ["חתונה"] },
  { id: "o:birth", value: "birth", title: "לידה", aliases: ["לידה", "ברית", "בריתה", "הולדת תינוק"] },
  { id: "o:holiday", value: "holiday", title: "חג", aliases: ["חג", "ראש השנה", "פסח", "חנוכה"] },
  { id: "o:housewarming", value: "housewarming", title: "חנוכת בית", aliases: ["חנוכת בית", "בית חדש", "דירה חדשה"] },
  { id: "o:graduation", value: "graduation", title: "סיום לימודים", aliases: ["סיום לימודים", "תואר", "בגרות"] },
  { id: "o:thank_you", value: "thank_you", title: "תודה", aliases: ["תודה", "הוקרה"] },
  { id: "o:other", value: "other", title: "אירוע אחר", aliases: ["אחר"] },
];

/**
 * Interest options. Each maps to ONE canonical catalog tag; products should be tagged with
 * these tags so a pick translates into a precise match.
 */
export const INTEREST_OPTIONS: AnswerOption<string | null>[] = [
  { id: "i:coffee", value: "coffee", title: "קפה", aliases: ["קפה"] },
  { id: "i:cooking", value: "cooking", title: "בישול ואוכל", aliases: ["בישול", "אוכל", "אפייה"] },
  { id: "i:hiking", value: "hiking", title: "טיולים וטבע", aliases: ["טיולים", "טיול", "טבע", "קמפינג"] },
  { id: "i:fitness", value: "fitness", title: "ספורט וכושר", aliases: ["ספורט", "כושר", "ריצה", "חדר כושר"] },
  { id: "i:reading", value: "reading", title: "קריאה וכתיבה", aliases: ["קריאה", "ספרים", "כתיבה"] },
  { id: "i:gaming", value: "gaming", title: "משחקים", aliases: ["משחקים", "גיימינג", "משחקי קופסה"] },
  { id: "i:music", value: "music", title: "מוזיקה", aliases: ["מוזיקה", "מוסיקה"] },
  { id: "i:gardening", value: "gardening", title: "גינון וצמחים", aliases: ["גינון", "צמחים", "גינה"] },
  { id: "i:photography", value: "photography", title: "צילום וזכרונות", aliases: ["צילום", "תמונות", "זכרונות"] },
  { id: "i:none", value: null, title: "בלי תחום מסוים", aliases: ["דלג", "לא משנה", "אין", "לא יודע", "לא יודעת"] },
];

export const AVOID_OPTIONS: AnswerOption<string | null>[] = [
  { id: "a:none", value: null, title: "אין הגבלות", aliases: ["אין", "דלג", "לא", "אין הגבלה"] },
  { id: "a:alcohol", value: "alcohol", title: "בלי אלכוהול", aliases: ["אלכוהול", "יין", "בלי אלכוהול"] },
  { id: "a:food", value: "food & drink", title: "בלי אוכל ושתייה", aliases: ["אוכל", "בלי אוכל"] },
  { id: "a:clothing", value: "clothing", title: "בלי בגדים", aliases: ["בגדים", "בלי בגדים"] },
  { id: "a:fragrance", value: "fragrance", title: "בלי בשמים", aliases: ["בושם", "בשמים", "בלי בשמים"] },
];

export type DeadlineChoice = "within_3_days" | "within_2_weeks" | "no_rush";
export const DEADLINE_OPTIONS: AnswerOption<DeadlineChoice>[] = [
  { id: "d:3", value: "within_3_days", title: "תוך 3 ימים", aliases: ["דחוף", "מחר", "השבוע"] },
  { id: "d:14", value: "within_2_weeks", title: "תוך שבועיים", aliases: ["שבועיים", "שבוע"] },
  { id: "d:none", value: "no_rush", title: "לא דחוף", aliases: ["לא דחוף", "אין לחץ", "דלג"] },
];
export const DEADLINE_DAYS: Record<DeadlineChoice, number | undefined> = {
  within_3_days: 3,
  within_2_weeks: 14,
  no_rush: undefined,
};

export const INTERNATIONAL_OPTIONS: AnswerOption<boolean>[] = [
  { id: "x:yes", value: true, title: "כן, אפשר", aliases: ["כן", "אפשר", "בטח"] },
  { id: "x:no", value: false, title: "רק מישראל", aliases: ["לא", "רק מישראל", "ישראל"] },
];

/** Budget quick picks; any amount can also be typed. Values in ILS. */
export const BUDGET_OPTIONS: AnswerOption<number>[] = [
  { id: "b:150", value: 150, title: "עד 150 ₪" },
  { id: "b:300", value: 300, title: "עד 300 ₪" },
  { id: "b:500", value: 500, title: "עד 500 ₪" },
];

/** Actions offered after results, and commands. */
export const ACTIONS = {
  more: { id: "act:more", title: "עוד אפשרויות" },
  cheaper: { id: "act:cheaper", title: "משהו זול יותר" },
  restart: { id: "act:restart", title: "התחלה מחדש" },
  raiseBudget: { id: "act:raise_budget", title: "להגדיל תקציב" },
  generalIdeas: { id: "act:general", title: "רעיונות כלליים" },
  noDeadline: { id: "act:no_deadline", title: "בלי הגבלת זמן" },
  allowInternational: { id: "act:intl", title: "גם משלוח מחו״ל" },
} as const satisfies Record<string, ChoiceOption>;

export const COMMAND_WORDS = {
  restart: ["התחל מחדש", "התחלה מחדש", "מחדש", "התחל", "restart", "start"],
  help: ["עזרה", "help", "?"],
  stop: ["הסר", "הסרה", "עצור", "stop", "unsubscribe"],
} as const;

export function toChoices<V>(options: AnswerOption<V>[]): ChoiceOption[] {
  return options.map(({ id, title }) => ({ id, title }));
}

/** Finds the option a user meant — by tapped id, exact title, or alias. */
export function matchOption<V>(
  options: AnswerOption<V>[],
  input: { id?: string; text?: string },
): AnswerOption<V> | undefined {
  if (input.id) return options.find((o) => o.id === input.id);
  if (!input.text) return undefined;
  const text = normalizeText(input.text);
  return options.find((o) => normalizeText(o.title) === text || o.aliases?.some((a) => normalizeText(a) === text));
}

/** Lowercases, trims, removes punctuation/emoji and collapses spaces, keeping Hebrew/Latin letters, digits and "/". */
export function normalizeText(text: string): string {
  return normalizeTag(text.replace(/[^\p{L}\p{N}\s/?]/gu, " "));
}

export function labelOf<V>(options: AnswerOption<V>[], value: V): string | undefined {
  return options.find((o) => o.value === value)?.title;
}
