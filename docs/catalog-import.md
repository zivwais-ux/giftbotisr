# ייבוא מוצרים לבוט

## מה צריך מכל חנות
1. **קובץ מוצרים** — אחד מאלה:
   - קובץ CSV (מאקסל או Google Sheets: "שמירה בשם" → CSV UTF-8) לפי `catalog/template.csv`
   - פיד מוצרים של גוגל (Google Merchant Center) בפורמט XML או CSV — רוב חנויות Shopify ו-WooCommerce מפיקות אותו בתוסף קיים
   - ייצוא מוצרים מ-Shopify / WooCommerce (עמודות נפוצות מזוהות אוטומטית)
2. **קובץ הגדרות חנות** — `catalog/stores/<slug>.json` (לפי `_template.json`): פרטי החנות, תוצאות בדיקת התנאים, תבנית קישור השותפים ומשלוחים.

> חנות מוצגת למשתמשים רק אם `approvalStatus` הוא `approved` — וזה אפשרי רק אחרי שנרשם תאריך בדיקה
> ושהתנאים **מתירים קישורים בהודעות (WhatsApp)**.

## עמודות הקובץ
| עמודה | חובה | דוגמה |
| --- | --- | --- |
| `id` | ✔ | מזהה/מק״ט קבוע של המוצר |
| `title` | ✔ | שם המוצר |
| `price` | ✔ | `149.90 ILS` או `149.90` |
| `link` | ✔ | קישור https לעמוד המוצר |
| `sale_price` | | מחיר מבצע (נבחר אם נמוך יותר) |
| `description` | | תיאור |
| `image_link` | מומלץ | קישור https לתמונה |
| `availability` | מומלץ | `in stock` / `out of stock` |
| `product_type` | מומלץ | `בית > מטבח > ספלים` |
| `interests` | | `coffee|cooking` — אם חסר, מזוהה אוטומטית מהטקסט |
| `occasions` | | `birthday|wedding` — ברירת מחדל: `any` |
| `recipients` | | `partner|parent` — ברירת מחדל: `any` |
| `affiliate_url` | | קישור שותפים ייחודי למוצר (אחרת נבנה מהתבנית בהגדרות החנות) |

תחומי עניין אפשריים: `coffee, cooking, hiking, fitness, reading, gaming, music, gardening, photography`.

## הרצה
```bash
# בדיקה בלבד — לא נכתב כלום
npm run catalog:import -- --store catalog/stores/my-store.json --file products.csv
# ייבוא בפועל
npm run catalog:import -- --store catalog/stores/my-store.json --file products.csv --apply
# הקובץ הוא הקטלוג המלא: מוצרים שלא מופיעים בו יוסתרו
npm run catalog:import -- --store catalog/stores/my-store.json --file products.csv --apply --sync
```
אפשר להריץ שוב את אותו קובץ — מוצרים קיימים מתעדכנים, לא משוכפלים.
