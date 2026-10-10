/**
 * Static pages Meta requires before an app can go live: privacy policy and data-deletion instructions.
 * They describe what the bot actually stores (see supabase/migrations). Keep them in sync with the code.
 */
export const PRIVACY_PATH = "/privacy";
export const DATA_DELETION_PATH = "/data-deletion";

const CONTACT_EMAIL = "zivwais@gmail.com";

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#222}h1{font-size:1.6rem}h2{font-size:1.2rem;margin-top:1.6rem}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export const PRIVACY_HTML = page(
  "מדיניות פרטיות — GiftBot",
  `<h1>מדיניות פרטיות — GiftBot</h1>
<p>GiftBot הוא בוט WhatsApp שמציע רעיונות למתנות. הדף מסביר איזה מידע נשמר ומה עושים בו.</p>

<h2>איזה מידע נשמר</h2>
<ul>
<li>מספר הטלפון שממנו נשלחה ההודעה (מזהה WhatsApp), כדי שנוכל להשיב ולהמשיך שיחה.</li>
<li>תשובותיכם לשאלות הבוט (למשל מי מקבל את המתנה, אירוע, תחום עניין ותקציב) ומצב השיחה.</li>
<li>נתוני שימוש כלליים, כמו אילו המלצות הוצגו, ללא תוכן ההודעות וללא מספר טלפון.</li>
</ul>

<h2>למה משתמשים במידע</h2>
<p>רק כדי להציע מתנות מתאימות ולשפר את הבוט. איננו מוכרים מידע אישי ואיננו משתפים אותו לצורכי פרסום.</p>

<h2>קישורי שותפים</h2>
<p>חלק מההמלצות כוללות קישורים לחנויות. ייתכן שנקבל עמלה אם תרכשו דרכם, ללא תוספת מחיר עבורכם. העמלה אינה משפיעה על סדר ההמלצות.</p>

<h2>שירותי צד שלישי</h2>
<p>ההודעות עוברות דרך WhatsApp (Meta). המידע נשמר אצל ספק אחסון ובסיס נתונים שאנו משתמשים בו להפעלת השירות.</p>

<h2>זכויותיכם</h2>
<ul>
<li>להפסקת קבלת הודעות, כתבו בבוט "הסר".</li>
<li>למחיקת המידע שלכם, ראו <a href="${DATA_DELETION_PATH}">הוראות מחיקת מידע</a>.</li>
<li>לשאלות: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></li>
</ul>
`,
);

export const DATA_DELETION_HTML = page(
  "מחיקת מידע — GiftBot",
  `<h1>מחיקת מידע — GiftBot</h1>
<p>כדי למחוק את המידע שלכם:</p>
<ol>
<li>שלחו מייל אל <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> עם הנושא "מחיקת מידע — GiftBot".</li>
<li>ציינו את מספר הטלפון שממנו כתבתם לבוט.</li>
<li>נמחק את המידע המשויך למספר זה ונאשר במייל.</li>
</ol>
<p>להפסקת קבלת הודעות בלבד, כתבו בבוט "הסר".</p>
<p><a href="${PRIVACY_PATH}">מדיניות פרטיות</a></p>
`,
);
