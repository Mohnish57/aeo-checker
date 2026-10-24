import { ImageResponse } from "next/og";

export const alt = "AEO Checker: will AI recommend your business?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ASSISTANTS = ["ChatGPT", "Claude", "Gemini", "Perplexity", "Copilot"];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#F7F8F9",
          color: "#172B4D",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="72" height="72" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#0C66E4" />
            <path
              d="M7.5 17.5l5 5 8.5-9.5"
              stroke="#fff"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M24.5 3.8c.45 2.3 1.6 3.45 3.9 3.9-2.3.45-3.45 1.6-3.9 3.9-.45-2.3-1.6-3.45-3.9-3.9 2.3-.45 3.45-1.6 3.9-3.9z"
              fill="#F5CD47"
            />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 700 }}>AEO Checker</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>
            Will AI recommend your business?
          </div>
          <div style={{ fontSize: 32, color: "#44546F" }}>
            Free score, your score after fixes, and copy-paste fix prompts.
          </div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {ASSISTANTS.map((name) => (
            <div
              key={name}
              style={{
                display: "flex",
                padding: "10px 22px",
                borderRadius: 999,
                border: "2px solid #DCDFE4",
                background: "#FFFFFF",
                fontSize: 26,
                color: "#44546F",
              }}
            >
              {name}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
