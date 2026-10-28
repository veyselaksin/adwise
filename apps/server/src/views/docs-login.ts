const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Hotlinked from Unsplash (Unsplash License, attribution optional). */
const HERO_IMAGE = "https://images.unsplash.com/photo-1551288049-bebda4e38f71";
const heroSrc = (width: number) => `${HERO_IMAGE}?auto=format&q=85&w=${width}`;
/** Widths up to the 4810px original, so retina screens never upscale. */
const HERO_WIDTHS = [1200, 1800, 2400, 3200, 4000];
/**
 * The panel is taller than the 3:2 photo, so object-fit: cover scales it by
 * height: rendered width is ~1.5x the panel height, not the panel width.
 */
const HERO_SIZES = "(min-width: 960px) max(52vw, calc((100vh - 24px) * 1.5)), 0px";

/** CSP for the login page: only its own nonce'd style/script and the Unsplash image. */
export const docsLoginCsp = (nonce: string) =>
  [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "img-src https://images.unsplash.com",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

type LoginPageOptions = {
  action: string;
  nonce: string;
  error?: string;
  username?: string;
};

const icons = {
  system: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>`,
  light: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  dark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>`,
};

/** Self-contained sign-in page for the API docs, with light/dark/system themes. */
export function renderDocsLogin({ action, nonce, error, username = "" }: LoginPageOptions): string {
  const themeButton = (theme: keyof typeof icons, label: string) =>
    `<button type="button" data-theme-option="${theme}" aria-label="${label} theme" title="${label}" aria-pressed="false">${icons[theme]}</button>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="color-scheme" content="light dark">
  <title>Sign in · ADWISE API</title>
  <script nonce="${nonce}">
    // Apply the saved theme before first paint to avoid a flash.
    try {
      const t = localStorage.getItem("docs-theme");
      if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    } catch {}
  </script>
  <style nonce="${nonce}">
    :root {
      --bg: #ffffff; --panel: #fafafa; --fg: #0a0a0a; --muted: #737373;
      --border: #e5e5e5; --input: #ffffff; --primary: #171717; --primary-fg: #fafafa;
      --danger: #dc2626; --danger-bg: #fef2f2; --danger-border: #fecaca;
      --ring: #a3a3a3; --pressed: #ffffff; --shadow: 0 1px 2px rgb(0 0 0 / .06);
      --overlay: linear-gradient(180deg, rgb(0 0 0 / 0) 40%, rgb(0 0 0 / .65) 100%);
      color-scheme: light;
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --bg: #0a0a0a; --panel: #111111; --fg: #fafafa; --muted: #a3a3a3;
        --border: #262626; --input: #0a0a0a; --primary: #fafafa; --primary-fg: #171717;
        --danger: #f87171; --danger-bg: #2a1212; --danger-border: #5c1f1f;
        --ring: #525252; --pressed: #262626; --shadow: none;
        --overlay: linear-gradient(180deg, rgb(0 0 0 / .15) 30%, rgb(0 0 0 / .8) 100%);
        color-scheme: dark;
      }
    }
    :root[data-theme="dark"] {
      --bg: #0a0a0a; --panel: #111111; --fg: #fafafa; --muted: #a3a3a3;
      --border: #262626; --input: #0a0a0a; --primary: #fafafa; --primary-fg: #171717;
      --danger: #f87171; --danger-bg: #2a1212; --danger-border: #5c1f1f;
      --ring: #525252; --pressed: #262626; --shadow: none;
      --overlay: linear-gradient(180deg, rgb(0 0 0 / .15) 30%, rgb(0 0 0 / .8) 100%);
      color-scheme: dark;
    }

    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0; background: var(--bg); color: var(--fg);
      font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .layout { display: grid; min-height: 100%; grid-template-columns: 1fr; }
    @media (min-width: 960px) { .layout { grid-template-columns: minmax(420px, 1fr) 1.1fr; } }

    .form-side { display: flex; flex-direction: column; padding: 16px 24px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; height: 40px; }
    .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; letter-spacing: -0.01em; }
    .brand-mark {
      display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px;
      background: var(--primary); color: var(--primary-fg);
    }
    .brand-mark svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.5; }

    .theme { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--border);
      border-radius: 8px; background: var(--panel); }
    .theme button {
      display: grid; place-items: center; width: 28px; height: 24px; padding: 0;
      border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer;
    }
    .theme button:hover { color: var(--fg); }
    .theme button[aria-pressed="true"] { background: var(--pressed); color: var(--fg); box-shadow: var(--shadow); }
    .theme button:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
    .theme svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; }

    main { flex: 1; display: grid; place-items: center; padding: 32px 0; }
    .card { width: 100%; max-width: 360px; }
    h1 { font-size: 24px; line-height: 1.2; margin: 0 0 6px; letter-spacing: -0.02em; }
    p.sub { margin: 0 0 24px; color: var(--muted); }
    label { display: block; font-weight: 500; margin: 0 0 6px; }
    input {
      width: 100%; height: 38px; padding: 0 12px; margin: 0 0 16px;
      border: 1px solid var(--border); border-radius: 8px;
      background: var(--input); color: inherit; font: inherit; box-shadow: var(--shadow);
    }
    input:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
    .submit {
      width: 100%; height: 38px; margin-top: 4px; border: 0; border-radius: 8px;
      background: var(--primary); color: var(--primary-fg); font: inherit; font-weight: 500; cursor: pointer;
    }
    .submit:hover { opacity: .9; }
    .submit:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
    .error {
      margin: 0 0 16px; padding: 8px 12px; border-radius: 8px;
      border: 1px solid var(--danger-border); background: var(--danger-bg); color: var(--danger);
    }
    .note { margin-top: 20px; color: var(--muted); font-size: 12px; text-align: center; }

    .hero { display: none; position: relative; margin: 12px; border-radius: 16px; overflow: hidden;
      background: #0a0a0a; }
    @media (min-width: 960px) { .hero { display: block; } }
    .hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: left center; }
    .hero::after { content: ""; position: absolute; inset: 0; background: var(--overlay); }
    .hero-caption { position: absolute; left: 32px; right: 32px; bottom: 28px; z-index: 1; color: #fafafa; }
    .hero-caption strong { display: block; font-size: 20px; letter-spacing: -0.01em; margin-bottom: 4px; }
    .hero-caption span { color: rgb(250 250 250 / .75); }
    .credit { position: absolute; right: 16px; top: 14px; z-index: 1; font-size: 11px;
      color: rgb(250 250 250 / .8); text-decoration: none; padding: 2px 8px; border-radius: 999px;
      background: rgb(0 0 0 / .35); }
    .credit:hover { color: #fff; }
  </style>
</head>
<body>
  <div class="layout">
    <div class="form-side">
      <div class="topbar">
        <div class="brand">
          <span class="brand-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V10M10 18V6M16 18v-5M22 18H2"/></svg></span>
          ADWISE
        </div>
        <div class="theme" role="group" aria-label="Color theme">
          ${themeButton("system", "System")}${themeButton("light", "Light")}${themeButton("dark", "Dark")}
        </div>
      </div>
      <main>
        <div class="card">
          <h1>API documentation</h1>
          <p class="sub">Sign in with your docs credentials to continue.</p>
          ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
          <form method="post" action="${escapeHtml(action)}">
            <label for="username">Username</label>
            <input id="username" name="username" autocomplete="username" required autofocus
              value="${escapeHtml(username)}">
            <label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required>
            <button class="submit" type="submit">Sign in</button>
          </form>
          <p class="note">Docs access only. Data endpoints use a separate session token.</p>
        </div>
      </main>
    </div>
    <aside class="hero" aria-hidden="true">
      <img src="${heroSrc(2400)}" srcset="${HERO_WIDTHS.map((w) => `${heroSrc(w)} ${w}w`).join(", ")}"
        sizes="${HERO_SIZES}" alt="" decoding="async">
      <a class="credit" href="https://unsplash.com" target="_blank" rel="noopener noreferrer" tabindex="-1">Photo · Unsplash</a>
      <div class="hero-caption">
        <strong>Livensa ad performance</strong>
        <span>Meta &amp; TikTok spend, installs, trials and CAC, one API.</span>
      </div>
    </aside>
  </div>
  <script nonce="${nonce}">
    (() => {
      const root = document.documentElement;
      const buttons = document.querySelectorAll("[data-theme-option]");
      const sync = () => {
        const current = root.dataset.theme || "system";
        buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeOption === current)));
      };
      buttons.forEach((b) =>
        b.addEventListener("click", () => {
          const theme = b.dataset.themeOption;
          if (theme === "system") delete root.dataset.theme;
          else root.dataset.theme = theme;
          try {
            if (theme === "system") localStorage.removeItem("docs-theme");
            else localStorage.setItem("docs-theme", theme);
          } catch {}
          sync();
        }),
      );
      sync();
    })();
  </script>
</body>
</html>`;
}
