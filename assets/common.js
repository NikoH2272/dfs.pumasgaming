// Shared helpers for the public site and the admin panel.
const DFS = (() => {
  const LOGO_SVG = `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M14 8h40l-10 10H24l-6 6h28l10 10-22 22H10l10-10h20l6-6H18L8 30z" fill="url(#lg)" stroke="#19e3e3" stroke-width="1.5"/>
    <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="64"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#b9c6c9"/><stop offset="1" stop-color="#5d6b6e"/></linearGradient></defs>
  </svg>`;

  const ICONS = {
    instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>`,
    whatsapp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21l1.6-4.6A9 9 0 1 1 8 19.6z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8a4 4 0 0 1-2.1-2.1l.8-1-1-2z" fill="currentColor" stroke="none"/></svg>`,
    discord: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7c3-1.3 7-1.3 10 0l2 9c-1.6 1.4-3.3 2.2-5 2.5l-1-2M11 16.5l-1 2c-1.7-.3-3.4-1.1-5-2.5l2-9"/><circle cx="9.5" cy="12" r="1" fill="currentColor"/><circle cx="14.5" cy="12" r="1" fill="currentColor"/></svg>`,
    trophy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 20h8"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
    phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>`,
    users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>`,
    form: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`,
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Only allow http(s) links and relative/data-image sources coming from data.json.
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  const safeImg = (u) => (/^(https?:\/\/|data:image\/|assets\/)/i.test(u || "") ? u : "");

  // Supabase client (null if not configured, then the site falls back to data.json).
  const sb = (() => {
    const c = window.DFS_CONFIG || {};
    if (!c.supabaseUrl || !c.supabaseAnonKey || !window.supabase) return null;
    try {
      const role = JSON.parse(atob(c.supabaseAnonKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role;
      if (role === "service_role") {
        console.error("config.js tiene la clave service_role. Usa la clave anon/publishable.");
        return null;
      }
    } catch (_) { /* sb_publishable_ keys are not JWTs */ }
    return window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
  })();

  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  // Reads every table and assembles the same shape as data.json.
  async function fetchFromSupabase() {
    const [settings, schedule, groups, rows, sponsors] = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).maybeSingle().then(must),
      sb.from("schedule").select("*").order("date").order("time").then(must),
      sb.from("result_groups").select("*").order("position").then(must),
      sb.from("result_rows").select("*").order("position").then(must),
      sb.from("sponsors").select("*").order("position").then(must),
    ]);
    const fmt = (d) => (d ? new Date(d).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" }) : "");
    return {
      tournament: settings?.tournament || {},
      links: settings?.links || {},
      prizes: settings?.prizes || [],
      schedule: schedule.map((m) => ({ id: m.id, date: m.date || "", time: m.time || "", title: m.title, detail: m.detail, status: m.status })),
      results: groups.map((g) => ({
        id: g.id, title: g.title, phase: g.phase, updated: fmt(g.updated_at),
        rows: rows.filter((r) => r.group_id === g.id).map((r) => ({ id: r.id, team: r.team, booyah: r.booyah, kills: r.kills, placement: r.placement })),
      })),
      sponsors: sponsors.map((s) => ({ id: s.id, name: s.name, logo: s.logo_url, url: s.url })),
    };
  }

  async function loadData() {
    if (sb) return fetchFromSupabase();
    const res = await fetch(`data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo cargar data.json");
    return res.json();
  }

  const total = (r) => (Number(r.kills) || 0) + (Number(r.placement) || 0);
  const sortRows = (rows) =>
    [...rows].sort((a, b) => total(b) - total(a) || (b.booyah || 0) - (a.booyah || 0) || (b.kills || 0) - (a.kills || 0));

  return { sb, must, fetchFromSupabase, LOGO_SVG, ICONS, esc, safeUrl, safeImg, loadData, total, sortRows };
})();
