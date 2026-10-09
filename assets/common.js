// Shared helpers for the public site and the admin panel.
const DFS = (() => {
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
    return window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: false } });
  })();

  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  // Reads every table and assembles the same shape as data.json.
  // The admin passes its own schedule query because hidden dates are only readable through staff_schedule.
  async function fetchFromSupabase(scheduleQuery) {
    const [settings, schedule, groups, rows, sponsors] = await Promise.all([
      sb.from("settings").select("*").eq("id", 1).maybeSingle().then(must),
      (scheduleQuery || sb.from("schedule").select("*").order("position")).then(must),
      sb.from("result_groups").select("*").order("position").then(must),
      sb.from("result_rows").select("*").order("position").then(must),
      sb.from("sponsors").select("*").order("position").then(must),
    ]);
    const fmt = (d) => (d ? new Date(d).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" }) : "");
    return {
      tournament: settings?.tournament || {},
      links: settings?.links || {},
      prizes: settings?.prizes || [],
      schedule: schedule.map((m) => ({
        id: m.id, phase: m.phase, group: m.group_name, date: m.date || "", time: m.time || "",
        rooms: m.rooms, status: m.status, visible: m.visible, note: m.note,
      })),
      results: groups.map((g) => ({
        id: g.id, phase: g.phase, title: g.title, kind: g.kind, qualify: g.qualify, updated: fmt(g.updated_at),
        rows: rows.filter((r) => r.group_id === g.id)
          .map((r) => ({ id: r.id, team: r.team, kills: r.kills, placement: r.placement, penalty: r.penalty })),
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

  const PHASES = ["Octavos de final", "Cuartos de final", "Semifinal", "Final"];
  const STATES = {
    abierto: "Inscripciones abiertas",
    cerrado: "Cerrado",
    en_juego: "En juego",
    finalizado: "Finalizado",
  };
  // Times are stored in Mexico time; the poster lists the same slot for these countries.
  const COUNTRIES = [["mx", "México", 0], ["co", "Colombia", 1], ["do", "Rep. Dominicana", 2], ["ar", "Argentina", 3]];
  const localTimes = (time) => {
    const [h, m] = (time || "").split(":").map(Number);
    if (isNaN(h)) return [];
    return COUNTRIES.map(([code, name, off]) => {
      const hh = (h + off) % 24;
      return { code, name, label: `${hh % 12 || 12}:${String(m || 0).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}` };
    });
  };

  // Total = kills + placement points - penalties.
  const total = (r) => (Number(r.kills) || 0) + (Number(r.placement) || 0) - (Number(r.penalty) || 0);
  const sortRows = (rows) =>
    [...rows].sort((a, b) => total(b) - total(a) || (b.placement || 0) - (a.placement || 0) || (b.kills || 0) - (a.kills || 0));
  const hasTeam = (r) => (r.team || "").trim() !== "";

  // A "general" table sums every team across the group tables of the same phase.
  const generalRows = (results, phase) => {
    const map = new Map();
    results.filter((g) => g.phase === phase && g.kind !== "general").forEach((g) => {
      g.rows.filter(hasTeam).forEach((r) => {
        const key = r.team.trim().toLowerCase();
        const acc = map.get(key) || { team: r.team.trim(), group: g.title, kills: 0, placement: 0, penalty: 0 };
        acc.kills += Number(r.kills) || 0;
        acc.placement += Number(r.placement) || 0;
        acc.penalty += Number(r.penalty) || 0;
        map.set(key, acc);
      });
    });
    return sortRows([...map.values()]);
  };

  return { sb, must, fetchFromSupabase, ICONS, esc, safeUrl, safeImg, loadData, total, sortRows, hasTeam, generalRows, PHASES, STATES, localTimes };
})();
