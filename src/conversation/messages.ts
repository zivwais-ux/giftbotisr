/**
 * Channel-neutral message model. The conversation layer speaks only these types;
 * a channel adapter (WhatsApp, in the next stage) translates them to the provider's API.
 */

export type InboundContent =
  | { type: "text"; text: string }
  /** The user tapped a button or picked a list row; `id` is the option id we sent. */
  | { type: "choice"; id: string; title?: string }
  /** Anything we can't interpret yet (image, voice note, sticker, location...). */
  | { type: "unsupported"; kind: string };

export interface InboundMessage {
  /** Provider's unique message id — used for deduplication. */
  messageId: string;
  /** The sender's WhatsApp id (international phone number, digits only). */
  from: string;
  content: InboundContent;
  receivedAt: Date;
}

export interface ChoiceOption {
  id: string;
  title: string;
  description?: string;
}

export type OutboundMessage =
  | { type: "text"; body: string }
  | { type: "buttons"; body: string; buttons: ChoiceOption[] }
  | { type: "list"; body: string; buttonLabel: string; options: ChoiceOption[] }
  /** One recommended product; sent as an image with caption when an image is available. */
  | { type: "product"; caption: string; imageUrl?: string };

/** WhatsApp Cloud API limits for the message types we use. */
export const LIMITS = {
  textBody: 4096,
  interactiveBody: 1024,
  caption: 1024,
  maxButtons: 3,
  buttonTitle: 20,
  maxListRows: 10,
  listButtonLabel: 20,
  rowTitle: 24,
  rowDescription: 72,
  optionId: 200,
} as const;

/** Returns a list of limit violations (empty if the message is valid). */
export function validateOutbound(message: OutboundMessage): string[] {
  const errors: string[] = [];
  const check = (ok: boolean, msg: string) => {
    if (!ok) errors.push(msg);
  };
  const len = (s: string) => [...s].length;

  switch (message.type) {
    case "text":
      check(len(message.body) > 0 && len(message.body) <= LIMITS.textBody, `text body length ${len(message.body)}`);
      break;
    case "product":
      check(len(message.caption) > 0 && len(message.caption) <= LIMITS.caption, `caption length ${len(message.caption)}`);
      break;
    case "buttons":
      check(len(message.body) <= LIMITS.interactiveBody, `buttons body length ${len(message.body)}`);
      check(message.buttons.length >= 1 && message.buttons.length <= LIMITS.maxButtons, "1-3 buttons required");
      for (const b of message.buttons) {
        check(len(b.title) >= 1 && len(b.title) <= LIMITS.buttonTitle, `button title "${b.title}" too long`);
        check(len(b.id) <= LIMITS.optionId, `button id "${b.id}" too long`);
      }
      check(new Set(message.buttons.map((b) => b.id)).size === message.buttons.length, "duplicate button ids");
      break;
    case "list":
      check(len(message.body) <= LIMITS.interactiveBody, `list body length ${len(message.body)}`);
      check(len(message.buttonLabel) <= LIMITS.listButtonLabel, `list button label "${message.buttonLabel}" too long`);
      check(message.options.length >= 1 && message.options.length <= LIMITS.maxListRows, "1-10 list rows required");
      for (const o of message.options) {
        check(len(o.title) >= 1 && len(o.title) <= LIMITS.rowTitle, `row title "${o.title}" too long`);
        check(!o.description || len(o.description) <= LIMITS.rowDescription, `row description too long`);
        check(len(o.id) <= LIMITS.optionId, `row id "${o.id}" too long`);
      }
      check(new Set(message.options.map((o) => o.id)).size === message.options.length, "duplicate row ids");
      break;
  }
  return errors;
}

/** Truncates to `max` characters (by code point), adding an ellipsis if cut. */
export function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}
