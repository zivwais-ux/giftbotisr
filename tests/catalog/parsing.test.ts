import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { detectFormat, parseDelimited, parseFeed, parseGoogleXml } from "../../src/catalog/feed-parsers.js";
import { inferTags } from "../../src/catalog/tagger.js";

describe("parseDelimited", () => {
  it("parses comma CSV with a BOM, quotes, Hebrew and embedded newlines", () => {
    const csv = '﻿id,Title,Description\n1,"ספל, כחול","שורה ראשונה\nשורה שנייה"\n';
    expect(parseDelimited(csv)).toEqual([{ id: "1", title: "ספל, כחול", description: "שורה ראשונה\nשורה שנייה" }]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseDelimited("id;title\n1;a")).toEqual([{ id: "1", title: "a" }]);
    expect(parseDelimited("id\ttitle\tprice\n1\ta\t10 ILS")).toEqual([{ id: "1", title: "a", price: "10 ILS" }]);
  });

  it("normalizes Google/Shopify column names", () => {
    expect(parseDelimited("g:id,Image Link,Sale-Price\n1,x,y")).toEqual([{ id: "1", image_link: "x", sale_price: "y" }]);
  });

  it("tolerates short rows and skips empty lines", () => {
    expect(parseDelimited("id,title,price\n1,a\n\n2,b,5")).toEqual([
      { id: "1", title: "a" },
      { id: "2", title: "b", price: "5" },
    ]);
  });
});

describe("parseGoogleXml", () => {
  const xml = `<?xml version="1.0"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Store</title>
    <item>
      <g:id>0012</g:id>
      <g:title><![CDATA[ספל & צלוחית]]></g:title>
      <g:price>89.90 ILS</g:price>
      <g:link>https://shop.test/p/12</g:link>
      <g:additional_image_link>https://shop.test/a.jpg</g:additional_image_link>
      <g:additional_image_link>https://shop.test/b.jpg</g:additional_image_link>
      <g:shipping><g:country>IL</g:country></g:shipping>
    </item>
    <item><g:id>13</g:id><g:title>Tom &amp; Jerry mug</g:title></item>
  </channel>
</rss>`;

  it("reads items, keeps ids as text, handles CDATA/entities and repeated tags", () => {
    expect(parseGoogleXml(xml)).toEqual([
      {
        id: "0012",
        title: "ספל & צלוחית",
        price: "89.90 ILS",
        link: "https://shop.test/p/12",
        additional_image_link: "https://shop.test/a.jpg",
      },
      { id: "13", title: "Tom & Jerry mug" },
    ]);
  });

  it("is chosen by file extension or content", () => {
    expect(detectFormat("feed.xml", "")).toBe("google-xml");
    expect(detectFormat("products.csv", "<x>")).toBe("csv");
    expect(detectFormat("export", "  <?xml")).toBe("google-xml");
    expect(parseFeed("feed", xml)).toHaveLength(2);
  });

  it("returns no rows for a feed without items", () => {
    expect(parseGoogleXml('<rss><channel><title>x</title></channel></rss>')).toEqual([]);
  });
});

describe("the bundled template", () => {
  it("parses into the documented columns", async () => {
    const rows = parseFeed("template.csv", await readFile("catalog/template.csv", "utf8"));
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0]!)).toEqual([
      "id", "title", "description", "price", "sale_price", "link", "image_link",
      "availability", "product_type", "interests", "occasions", "recipients",
    ]);
  });
});

describe("inferTags", () => {
  it.each([
    ["ערכת פולי קפה מיוחדים", ["coffee"]],
    ["סט סכין שף למטבח", ["cooking"]],
    ["תרמיל לטיולים", ["hiking"]],
    ["מזרן יוגה", ["fitness"]],
    ["ספר בישול ישראלי", ["cooking", "reading"]],
    ["Wireless headphones", ["music"]],
    ["עציץ קרמיקה לצמחים", ["gardening"]],
    ["הספר החדש", ["reading"]],
  ])("%s → %j", (text, interests) => {
    expect(inferTags(text).interests).toEqual(interests);
  });

  it("does not create false tags from words that merely contain a keyword", () => {
    expect(inferTags("מספר דגם 123").interests).toEqual([]); // מספר (number) ≠ ספר (book)
    expect(inferTags("Coffeehouse-style sign").interests).toEqual([]);
    expect(inferTags("ארנק עור").interests).toEqual([]);
  });

  it("recognizes baby products and sets recipient and occasions", () => {
    expect(inferTags("שמיכה לתינוק")).toEqual({ interests: [], recipients: ["baby"], occasions: ["birth", "birthday"] });
    expect(inferTags("שמיכה זוגית").recipients).toBeUndefined();
  });
});
