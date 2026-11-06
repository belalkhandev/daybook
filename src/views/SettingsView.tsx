import { Select } from "../components/Select";
import { useState } from "react";
import { Icon } from "../components/Icon";
import { Switch } from "../components/Switch";
import { call, errorMessage } from "../lib/ipc";
import { ACCENTS, useUI, type SettingsTab } from "../lib/store";

type Conn = "idle" | "testing" | "ok" | "fail";

const TABS: { key: SettingsTab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "shots", label: "Screenshots" },
  { key: "ai", label: "AI assistant" },
  { key: "sync", label: "Sync & backup" },
  { key: "shortcuts", label: "Shortcuts" },
];

const PROVIDERS = [
  { key: "openai", label: "OpenAI" },
  { key: "compatible", label: "OpenAI-compatible" },
  { key: "local", label: "Local (Ollama)" },
];

const FEATURES = [
  { key: "tasks", title: "Write task details", desc: "Turn a rough sentence into a task with steps and a markdown description." },
  { key: "notes", title: "Format notes", desc: "Clean up messy notes into headings, lists and checklists." },
  { key: "suggest", title: "Suggest project, priority & time target", desc: "Fill in properties from what you wrote. You can change them before saving." },
  { key: "summarize", title: "Summarize long comment threads", desc: "Show a short summary at the top of busy tasks." },
];

const LENGTHS = [
  { key: "brief", label: "Brief" },
  { key: "balanced", label: "Balanced" },
  { key: "detailed", label: "Detailed" },
];

const DEFAULT_FLAGS: Record<string, boolean> = { tasks: true, notes: true, suggest: true, summarize: false };

function parseFlags(raw: string | undefined): Record<string, boolean> {
  try {
    return { ...DEFAULT_FLAGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

const STATUS_STYLE = {
  ok: { bg: "#E8F7F0", color: "#1F6B4F", dot: "#10B981" },
  testing: { bg: "#FFF4E5", color: "#8A4B08", dot: "#F59E0B" },
  empty: { bg: "rgba(22,22,29,0.06)", color: "#4A4A58", dot: "#9CA3AF" },
  fail: { bg: "#FFF1E8", color: "#B4410B", dot: "#EA580C" },
};

function General() {
  const settings = useUI((s) => s.settings);
  const setSetting = useUI((s) => s.setSetting);
  const accent = (settings.accent || ACCENTS[0]).toUpperCase();
  const reduce = settings.reduce_transparency === "1";
  return (
    <section aria-labelledby="gen-h" className="glass settings-card">
      <h2 id="gen-h" style={{ fontSize: 18, fontWeight: 600 }}>
        Appearance
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="mono-label">Accent colour</span>
        <div role="group" aria-label="Accent colour" style={{ display: "flex", gap: 8 }}>
          {ACCENTS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={accent === c}
              className="swatch"
              style={{ background: c, boxShadow: accent === c ? "0 0 0 2px #16161D" : "0 0 0 1px rgba(22,22,29,0.12)" }}
              onClick={() => void setSetting("accent", c)}
            />
          ))}
        </div>
      </div>
      <div className="toggle-row">
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span id="reduce-label" style={{ fontWeight: 500 }}>
            Reduce transparency
          </span>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Use solid cards instead of blurred glass. Helps on slower GPUs.</span>
        </div>
        <Switch on={reduce} onChange={(v) => void setSetting("reduce_transparency", v ? "1" : "0")} labelledBy="reduce-label" />
      </div>
    </section>
  );
}

const DELAYS = [
  { value: "0", label: "No delay" },
  { value: "3", label: "3 seconds" },
  { value: "5", label: "5 seconds" },
  { value: "10", label: "10 seconds" },
];

const SHOT_TOGGLES = [
  { key: "shots.copy", title: "Copy to clipboard", desc: "Put every new screenshot on the clipboard as soon as it is taken.", on: true },
  { key: "shots.edit", title: "Open the editor after capture", desc: "Jump straight into annotating instead of showing the small preview.", on: false },
  { key: "shots.ocr", title: "Read text in screenshots", desc: "Run text recognition in the background so you can search inside images. Needs Tesseract.", on: true },
  { key: "shots.remember", title: "Remember my last area", desc: "Start the next area capture with the area you used last time. Off means the whole screen is selected first.", on: false },
];

function ShotSettings() {
  const settings = useUI((s) => s.settings);
  const setSetting = useUI((s) => s.setSetting);
  const flag = (key: string, def: boolean) => (settings[key] === undefined ? def : settings[key] === "1");
  return (
    <section aria-labelledby="shots-h" className="glass settings-card">
      <h2 id="shots-h" style={{ fontSize: 18, fontWeight: 600 }}>
        Screenshots
      </h2>
      {SHOT_TOGGLES.map((t) => (
        <div key={t.key} className="toggle-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span id={`${t.key}-label`} style={{ fontWeight: 500 }}>
              {t.title}
            </span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>{t.desc}</span>
          </div>
          <Switch on={flag(t.key, t.on)} onChange={(v) => void setSetting(t.key, v ? "1" : "0")} labelledBy={`${t.key}-label`} />
        </div>
      ))}
      <div className="toggle-row">
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span id="shots-delay-label" style={{ fontWeight: 500 }}>
            Capture delay
          </span>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Wait this long after you press Capture, so you can open a menu or tooltip first.</span>
        </div>
        <Select id="shots-delay" label="Capture delay" value={settings["shots.delay"] || "0"} onChange={(v) => void setSetting("shots.delay", v)} options={DELAYS} />
      </div>
    </section>
  );
}

function AiSettings() {
  const settings = useUI((s) => s.settings);
  const hasKey = useUI((s) => s.hasKey);
  const loadSettings = useUI((s) => s.loadSettings);
  const closeSettings = useUI((s) => s.closeSettings);
  const [provider, setProvider] = useState(settings["ai.provider"] || "openai");
  const [baseUrl, setBaseUrl] = useState(settings["ai.base_url"] || "");
  const [apiKey, setApiKey] = useState("");
  const [show, setShow] = useState(false);
  const [model, setModel] = useState(settings["ai.model"] || "");
  const [flags, setFlags] = useState(() => parseFlags(settings["ai.features"]));
  const [length, setLength] = useState(settings["ai.length"] || "balanced");
  const [language, setLanguage] = useState(settings["ai.language"] || "same");
  const [conn, setConn] = useState<Conn>("idle");
  const [failText, setFailText] = useState("");
  const [error, setError] = useState("");

  const persist = async () => {
    const put = (key: string, value: string) => call("set_setting", { key, value });
    await Promise.all([
      put("ai.provider", provider),
      put("ai.base_url", baseUrl.trim()),
      put("ai.model", model.trim()),
      put("ai.features", JSON.stringify(flags)),
      put("ai.length", length),
      put("ai.language", language),
    ]);
    if (apiKey.trim()) {
      await call("set_api_key", { key: apiKey.trim() });
      setApiKey("");
    }
    await loadSettings();
  };

  const test = async () => {
    setError("");
    setConn("testing");
    try {
      await persist();
      await call("ai_test_connection");
      setConn("ok");
    } catch (e) {
      setFailText(errorMessage(e));
      setConn("fail");
    }
  };

  const save = async () => {
    try {
      await persist();
      closeSettings();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const keyReady = provider === "local" || hasKey || apiKey.trim() !== "";
  const status =
    conn === "testing"
      ? { text: "Testing...", ...STATUS_STYLE.testing }
      : conn === "ok"
        ? { text: "Connected", ...STATUS_STYLE.ok }
        : conn === "fail"
          ? { text: failText, ...STATUS_STYLE.fail }
          : keyReady
            ? { text: "Key saved", ...STATUS_STYLE.ok }
            : { text: "No key yet", ...STATUS_STYLE.empty };

  return (
    <>
      <section aria-labelledby="conn-h" className="glass settings-card">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 id="conn-h" style={{ fontSize: 18, fontWeight: 600 }}>
              Connection
            </h2>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Use your own API key. Trove calls the API directly from this computer.</span>
          </div>
          <span className="status-pill" style={{ background: status.bg, color: status.color }}>
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: status.dot }} />
            {status.text}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="mono-label">Provider</span>
          <div role="group" aria-label="Provider" className="seg seg-wide">
            {PROVIDERS.map((p) => (
              <button key={p.key} type="button" className={`seg-btn${provider === p.key ? " is-on" : ""}`} style={{ minHeight: 36, padding: "0 14px", borderRadius: 9 }} aria-pressed={provider === p.key} onClick={() => setProvider(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {provider !== "openai" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="base-url" className="mono-label">
              Base URL
            </label>
            <input id="base-url" className="input" type="text" value={baseUrl} placeholder={provider === "local" ? "http://localhost:11434/v1" : "https://your-endpoint/v1"} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
        )}

        {provider !== "local" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="api-key" className="mono-label">
              API key
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <div className="key-box">
                <input
                  id="api-key"
                  type={show ? "text" : "password"}
                  value={apiKey}
                  placeholder={hasKey ? "Saved in your keyring. Type to replace." : "sk-..."}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setConn("idle");
                  }}
                />
                <button type="button" className="eye" aria-label={show ? "Hide API key" : "Show API key"} onClick={() => setShow(!show)}>
                  <Icon name="eye" size={17} />
                </button>
              </div>
              <button type="button" className="btn-outline" disabled={conn === "testing" || !keyReady} onClick={() => void test()}>
                {conn === "testing" ? "Testing..." : "Test connection"}
              </button>
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-3b)" }}>
              <Icon name="lock" size={14} />
              Stored in your system keyring (GNOME Keyring / KWallet), never in a config file.
            </span>
          </div>
        )}
        {provider === "local" && (
          <button type="button" className="btn-outline" style={{ alignSelf: "flex-start" }} disabled={conn === "testing"} onClick={() => void test()}>
            {conn === "testing" ? "Testing..." : "Test connection"}
          </button>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label htmlFor="model-id" className="mono-label">
            Model
          </label>
          <input id="model-id" className="input" type="text" value={model} placeholder="Model ID from your account" onChange={(e) => setModel(e.target.value)} />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>A small, fast model is enough for tasks and notes.</span>
        </div>
      </section>

      <section aria-labelledby="feat-h" className="glass settings-card" style={{ gap: 6 }}>
        <h2 id="feat-h" style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 600 }}>
          What AI can do
        </h2>
        {FEATURES.map((f) => (
          <div key={f.key} className="feature-row">
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span id={`feat-${f.key}`} style={{ fontSize: 15, fontWeight: 500 }}>
                {f.title}
              </span>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>{f.desc}</span>
            </div>
            <Switch on={!!flags[f.key]} onChange={(v) => setFlags({ ...flags, [f.key]: v })} labelledBy={`feat-${f.key}`} />
          </div>
        ))}
      </section>

      <section aria-labelledby="style-h" className="glass settings-card" style={{ flexDirection: "row", flexWrap: "wrap", gap: 24 }}>
        <h2 id="style-h" style={{ flex: "1 1 100%", fontSize: 18, fontWeight: 600 }}>
          Writing style
        </h2>
        <div style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="mono-label">Default length</span>
          <div role="group" aria-label="Default length" className="seg" style={{ borderRadius: 12 }}>
            {LENGTHS.map((l) => (
              <button key={l.key} type="button" className={`seg-btn${length === l.key ? " is-on" : ""}`} style={{ flex: "1 1 0", minHeight: 36, borderRadius: 9 }} aria-pressed={length === l.key} onClick={() => setLength(l.key)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 8 }}>
          <label htmlFor="out-lang" className="mono-label">
            Output language
          </label>
          <Select
            id="out-lang"
            label="Output language"
            variant="wide"
            value={language}
            onChange={setLanguage}
            options={[
              { value: "same", label: "Same as my input" },
              { value: "english", label: "English" },
              { value: "bangla", label: "বাংলা (Bangla)" },
            ]}
          />
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}
      <div className="settings-foot">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-3)" }}>
          <Icon name="shield" size={16} />
          Only the text you send for a draft leaves your computer. Everything else stays local.
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn-ghost" onClick={closeSettings}>
            Cancel
          </button>
          <button type="button" className="btn-primary" style={{ boxShadow: "none" }} onClick={() => void save()}>
            Save changes
          </button>
        </div>
      </div>
    </>
  );
}

export function SettingsView() {
  const tab = useUI((s) => s.settingsTab);
  const openSettings = useUI((s) => s.openSettings);
  return (
    <div className="settings-wrap">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 className="h1">Settings</h1>
        <nav aria-label="Settings sections" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {TABS.map((t) => (
            <button key={t.key} type="button" className={`tab-pill${tab === t.key ? " is-on" : ""}`} aria-current={tab === t.key ? "page" : undefined} onClick={() => openSettings(t.key)}>
              {t.key === "ai" && <Icon name="sparkles" size={13} sw={2} />}
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {tab === "general" && <General />}
      {tab === "shots" && <ShotSettings />}
      {tab === "ai" && <AiSettings />}
      {(tab === "sync" || tab === "shortcuts") && (
        <section className="glass settings-card">
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Coming soon</h2>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>{tab === "sync" ? "Sync and backup options will appear here." : "Custom keyboard shortcuts will appear here."}</p>
        </section>
      )}
    </div>
  );
}
