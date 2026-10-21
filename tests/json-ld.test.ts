import { describe, expect, it } from "vitest";

import { auditPageSchemas, jsonLdScript } from "@/lib/json-ld";

const PAYLOAD = "</script><script>alert(document.domain)</script>";

describe("jsonLdScript", () => {
  it("escapes < so a value cannot close the script tag", () => {
    const html = jsonLdScript({ name: PAYLOAD });
    expect(html).not.toContain("<");
    expect(html.toLowerCase()).not.toContain("</script");
  });

  it("still parses back to the original value", () => {
    const value = { name: PAYLOAD, nested: ["<!--", "a<b"] };
    expect(JSON.parse(jsonLdScript(value))).toEqual(value);
  });
});

describe("auditPageSchemas", () => {
  const siteUrl = "https://aeo.example";

  it("names the audited host, not the raw route segment", () => {
    const [breadcrumb, report] = auditPageSchemas(
      siteUrl,
      "https://www.acme.com/pricing?x=1",
    );
    expect(breadcrumb.itemListElement[1]).toMatchObject({
      name: "acme.com",
      item: "https://aeo.example/audit/acme.com",
    });
    expect(report).toMatchObject({
      name: "AEO Checker | acme.com",
      about: { url: "https://www.acme.com", name: "acme.com" },
    });
  });

  it("cannot emit </script> even when the audited URL carries a payload", () => {
    const audited = `https://acme.com/${encodeURIComponent(PAYLOAD)}?q=${PAYLOAD}#${PAYLOAD}`;
    for (const schema of auditPageSchemas(siteUrl, audited)) {
      expect(jsonLdScript(schema).toLowerCase()).not.toContain("</script");
    }
  });
});
