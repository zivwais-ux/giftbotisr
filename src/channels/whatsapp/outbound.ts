import type { OutboundMessage } from "../../conversation/messages.js";

/** Request body for POST /{phone-number-id}/messages (WhatsApp Cloud API). */
export type CloudApiMessage = Record<string, unknown> & { messaging_product: "whatsapp"; to: string; type: string };

const LIST_SECTION_TITLE = "אפשרויות";

/** Translates a channel-neutral message into a Cloud API request body. */
export function toCloudApiMessage(to: string, message: OutboundMessage): CloudApiMessage {
  const base = { messaging_product: "whatsapp" as const, recipient_type: "individual", to };
  switch (message.type) {
    case "text":
      return { ...base, type: "text", text: { body: message.body, preview_url: false } };
    case "product":
      return message.imageUrl
        ? { ...base, type: "image", image: { link: message.imageUrl, caption: message.caption } }
        : { ...base, type: "text", text: { body: message.caption, preview_url: false } };
    case "buttons":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: message.body },
          action: { buttons: message.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
        },
      };
    case "list":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: message.body },
          action: {
            button: message.buttonLabel,
            sections: [
              {
                title: LIST_SECTION_TITLE,
                rows: message.options.map((o) => ({
                  id: o.id,
                  title: o.title,
                  ...(o.description ? { description: o.description } : {}),
                })),
              },
            ],
          },
        },
      };
  }
}
