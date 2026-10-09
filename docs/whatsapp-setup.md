# WhatsApp setup (Meta) — one-time, ~15 minutes

Meta's dashboard changes over time; if a label differs, look for the closest equivalent.
**Never paste these values into chat, code or documents** — they go only into the server's environment variables.

## 1. Create the app and a free test number
1. Go to <https://developers.facebook.com> → log in → **My Apps** → **Create App**.
2. Choose the WhatsApp / "Connect with customers through WhatsApp" use case and a business portfolio
   (create one if asked).
3. Open **WhatsApp → API Setup**. Meta provides a free **test phone number**.
4. In the **To** field, add your own WhatsApp number and confirm it with the code Meta sends.
   (A test number can only message numbers added here.)

## 2. Collect four values (keep them private)
| Env variable | Where |
| --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → API Setup → "Phone number ID" (digits) |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp → API Setup → temporary access token (expires in 24h; a permanent token comes later) |
| `WHATSAPP_APP_SECRET` | App settings → Basic → App secret → Show |
| `WHATSAPP_VERIFY_TOKEN` | Any random string of 16+ characters that **you** make up |

## 3. Put the four values into Railway (not into chat or code)
Railway → project **giftbot** → service **giftbot** → **Variables** → add the four variables above.
Railway redeploys automatically; the WhatsApp routes turn on when all four are present.

## 4. Register the webhook in Meta
WhatsApp → Configuration → Webhook → Edit:
- Callback URL: `https://giftbot-staging.up.railway.app/webhooks/whatsapp`
- Verify token: the same `WHATSAPP_VERIFY_TOKEN`
- Click **Verify and save**, then subscribe to the **messages** field.

## 5. Test
Send "היי" from your own WhatsApp (the number added in step 1.4) to the test number.
