(() => {
  const { esc, total, sb, must, PHASES, STATES, generalRows, sortRows } = DFS;
  const $ = (s) => document.querySelector(s);
  const SPONSOR_SLOTS = 18;
  const ROLES = [["editor", "Editor"], ["admin", "Admin"]];
  const STATUS = [["proximo", "Próximo"], ["envivo", "En vivo"], ["finalizado", "Finalizado"]];

  let data = null;
  let me = null;      // { id, username, display_name, role }
  let dirty = false;
  let curPhase = PHASES[0];
  const touchedGroups = new Set(); // result groups whose scores changed

  // ---------- helpers ----------
  const get = (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), data);
  const set = (path, val) => {
    const keys = path.split(".");
    const last = keys.pop();
    keys.reduce((o, k) => (o[k] ??= {}), data)[last] = val;
  };
  const toast = (msg, err = false) => {
    const el = document.createElement("div");
    el.className = `toast ${err ? "err" : ""}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), err ? 6000 : 3200);
  };
  const markDirty = () => {
    dirty = true;
    $("#save-state").textContent = "Cambios sin guardar";
    $("#save-state").style.color = "#ffb547";
  };
  const touch = (gi) => { touchedGroups.add(data.results[gi].id); data.results[gi].updated = "ahora"; };
  const uuid = () => crypto.randomUUID();
  const emptyRows = (n) => Array.from({ length: n }, () => ({ id: uuid(), team: "", kills: 0, placement: 0, penalty: 0 }));
  addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  // Resize an uploaded image to a compact WebP data URL (stored in the database).
  const uploadImage = (file, max) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/webp", 0.82));
    };
    img.onerror = () => reject(new Error("Formato de imagen no soportado"));
    img.src = URL.createObjectURL(file);
  });

  const normalize = (d) => {
    d.tournament ??= {}; d.links ??= {};
    d.prizes ??= []; d.schedule ??= []; d.results ??= []; d.sponsors ??= [];
    d.tournament.state = STATES[d.tournament.state] ? d.tournament.state : "abierto";
    while (d.sponsors.length < SPONSOR_SLOTS) d.sponsors.push({ id: uuid(), name: "", logo: "", url: "" });
    return d;
  };

  // ---------- auth (staff_users table, via staff_* functions) ----------
  const TOKEN_KEY = "dfs_staff_token";
  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (_) {}
  const rpc = async (fn, args = {}) => must(await sb.rpc(fn, { p_token: token, ...args }));

  const showLogin = (msg) => {
    $("#login-view").hidden = false;
    $("#admin-view").hidden = true;
    $("#savebar").hidden = true;
    $("#logout").hidden = true;
    $("#change-pw").hidden = true;
    $("#who").textContent = "";
    $("#pending-msg").hidden = !msg;
    $("#pending-msg").textContent = msg || "";
  };
  const setToken = (t) => {
    token = t;
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (_) {}
  };

  if (!sb) {
    showLogin("Falta configurar Supabase: agrega la clave anon/publishable en assets/config.js.");
    $("#login-btn").disabled = true;
    return;
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#login-btn");
    btn.disabled = true;
    try {
      const res = must(await sb.rpc("staff_login", { p_username: $("#un").value.trim(), p_password: $("#pw").value }));
      setToken(res.token);
      me = res.user;
      $("#pw").value = "";
      await boot();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  $("#change-pw").addEventListener("click", async () => {
    const old = prompt("Clave actual:");
    if (!old) return;
    const pw = prompt("Nueva clave (mínimo 6 caracteres):");
    if (!pw) return;
    if (pw !== prompt("Repite la nueva clave:")) return toast("Las claves no coinciden", true);
    try { await rpc("staff_change_password", { p_old: old, p_new: pw }); toast("Clave actualizada ✓"); }
    catch (err) { toast(err.message, true); }
  });

  $("#logout").addEventListener("click", async () => {
    if (dirty && !confirm("Tienes cambios sin guardar. ¿Salir igual?")) return;
    dirty = false;
    try { await rpc("staff_logout"); } catch (_) {}
    setToken(null);
    location.reload();
  });

  const loadAll = () => DFS.fetchFromSupabase(sb.rpc("staff_schedule", { p_token: token }));
  const expired = (err) => /Sesión vencida/.test(err.message);

  // Resume a saved session.
  (async () => {
    if (!token) return showLogin();
    try {
      me = await rpc("staff_me");
      await boot();
    } catch (_) {
      setToken(null);
      showLogin();
    }
  })();

  async function boot() {
    try {
      data = normalize(await loadAll());
    } catch (err) {
      if (expired(err)) { setToken(null); return showLogin(err.message); }
      return toast("No se pudo cargar la base de datos: " + err.message, true);
    }
    $("#login-view").hidden = true;
    $("#admin-view").hidden = false;
    $("#savebar").hidden = false;
    $("#logout").hidden = false;
    $("#change-pw").hidden = false;
    $("#who").textContent = `${me.display_name || me.username} · ${me.role}`;
    $("#menu-users").hidden = me.role !== "admin";
    dirty = false;
    touchedGroups.clear();
    $("#save-state").textContent = "Todo guardado";
    $("#save-state").style.color = "";
    renderAll();
  }

  // ---------- menu ----------
  $("#menu").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    document.querySelectorAll("#menu button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".admin-pane").forEach((p) => p.classList.toggle("active", p.id === `p-${b.dataset.p}`));
    if (b.dataset.p === "users") renderUsers();
  });

  // ---------- rendering ----------
  const control = (path, opts = {}) => opts.select
    ? `<select data-bind="${path}">${opts.select.map(([v, l]) => `<option value="${v}" ${get(path) === v ? "selected" : ""}>${l}</option>`).join("")}</select>`
    : `<input data-bind="${path}" type="${opts.type || "text"}" value="${esc(get(path))}" placeholder="${esc(opts.ph || "")}" ${opts.type === "number" ? 'min="0"' : ""}>`;
  const input = (path, label, opts = {}) => `<div class="field"><label>${label}</label>${control(path, opts)}</div>`;
  const phasesOf = (list) => [...PHASES, ...list.map((x) => x.phase)].filter((p, i, a) => p && a.indexOf(p) === i);

  function renderGeneral() {
    $("#state-picker").innerHTML = Object.entries(STATES).map(([k, l]) => `
      <label class="${k === "en_juego" ? "live" : ""}"><input type="radio" name="state" value="${k}" data-bind="tournament.state" ${data.tournament.state === k ? "checked" : ""}>${l}</label>`).join("");
    $("#general-fields").innerHTML = [
      ["tournament.name", "Nombre del torneo"],
      ["tournament.tagline", "Lema"],
      ["tournament.prizePool", "Prize pool"],
      ["tournament.game", "Juego"],
      ["tournament.year", "Año"],
      ["tournament.server", "Servidor"],
      ["tournament.platform", "Plataforma"],
      ["tournament.teams", "Equipos", { type: "number" }],
      ["tournament.groups", "Grupos", { type: "number" }],
      ["tournament.teamsPerGroup", "Equipos por grupo", { type: "number" }],
    ].map(([p, l, o]) => input(p, l, o)).join("");
    document.querySelectorAll("#p-general textarea[data-bind], #p-links [data-bind]").forEach((el) => { el.value = get(el.dataset.bind) || ""; });
    $("#hero-prev").hidden = !data.tournament.heroImage;
    if (data.tournament.heroImage) $("#hero-prev").src = data.tournament.heroImage;
  }

  function renderPrizes() {
    $("#prize-list").innerHTML = data.prizes.map((_, i) => `
      <div class="row-card"><div class="inline-grid" style="grid-template-columns:1fr 1fr 32px;align-items:end">
        ${input(`prizes.${i}.place`, "Puesto")}${input(`prizes.${i}.amount`, "Premio")}
        <button class="x" data-del="prizes.${i}" title="Eliminar" style="margin-bottom:14px">✕</button>
      </div></div>`).join("");
  }

  const rosterCount = (phase, group) => {
    const g = data.results.find((r) => r.phase === phase && r.kind !== "general" && r.title.toLowerCase() === (group || "").trim().toLowerCase());
    return g ? g.rows.filter((r) => (r.team || "").trim()).length : 0;
  };

  function renderSchedule() {
    const size = Number(data.tournament.teamsPerGroup) || 12;
    $("#sched-list").innerHTML = phasesOf(data.schedule).map((phase) => {
      const idx = data.schedule.map((m, i) => (m.phase === phase ? i : -1)).filter((i) => i >= 0);
      const on = idx.filter((i) => data.schedule[i].visible).length;
      const rooms = idx.length ? data.schedule[idx[0]].rooms : 1;
      return `
      <div class="row-card">
        <div class="row-head">
          <b>${esc(phase)} <span class="hint" style="margin:0">· ${on}/${idx.length} activas</span></b>
          <div class="toolbar">
            <label class="rooms-field">Salas <input type="number" min="1" value="${rooms}" data-rooms="${esc(phase)}"></label>
            <button class="btn ghost sm" data-showphase="${esc(phase)}" data-on="1">Activar todas</button>
            <button class="btn ghost sm" data-showphase="${esc(phase)}" data-on="0">Ocultar todas</button>
            <button class="btn ghost sm" data-addmatch="${esc(phase)}">+ Grupo</button>
            <button class="btn sm" data-rosterbox="${esc(phase)}">Cargar equipos</button>
          </div>
        </div>
        <div data-roster="${esc(phase)}" hidden style="margin-bottom:12px">
          <textarea rows="8" placeholder="GRUPO A&#10;1. OLIS&#10;2. B17 E-SPORT&#10;…&#10;&#10;GRUPO B&#10;1. …"></textarea>
          <button class="btn sm" data-rosterok="${esc(phase)}" style="margin-top:8px">Cargar en ${esc(phase)}</button>
          <span class="hint" style="margin-left:8px">Reemplaza los nombres de cada grupo pegado; los puntos se mantienen.</span>
        </div>
        <div class="sched-row head"><span>Activa</span><span>Grupo</span><span>Día</span><span>Hora MX</span><span>Estado</span><span>Equipos</span><span></span></div>
        ${idx.map((i) => {
          const m = data.schedule[i];
          return `<div class="sched-row ${m.visible ? "" : "off"}">
            <label class="switch"><input type="checkbox" data-visible="${i}" ${m.visible ? "checked" : ""}><span>${m.visible ? "Sí" : "No"}</span></label>
            ${control(`schedule.${i}.group`, { ph: "Grupo A" })}
            ${control(`schedule.${i}.date`, { type: "date" })}
            ${control(`schedule.${i}.time`, { type: "time" })}
            ${control(`schedule.${i}.status`, { select: STATUS })}
            <span class="roster-count ${rosterCount(phase, m.group) === size ? "full" : ""}">${rosterCount(phase, m.group)}/${size}</span>
            <button class="x" data-del="schedule.${i}" title="Eliminar">✕</button>
          </div>`;
        }).join("") || `<p class="hint">Sin grupos en esta fase.</p>`}
      </div>`;
    }).join("");
  }

  function renderPhaseFilter() {
    $("#phase-filter").innerHTML = phasesOf(data.results).map((p) => {
      const n = data.results.filter((g) => g.phase === p).length;
      return `<button class="tab ${p === curPhase ? "active" : ""}" data-phase="${esc(p)}">${esc(p)} (${n})</button>`;
    }).join("");
  }

  function renderResults() {
    renderPhaseFilter();
    const idx = data.results.map((g, i) => (g.phase === curPhase ? i : -1)).filter((i) => i >= 0);
    $("#results-list").innerHTML = idx.map((i) => {
      const r = data.results[i];
      const q = Number(r.qualify) || 0;
      const head = `
        <div class="row-head"><b>${esc(r.kind === "general" ? "Tabla general · " + r.phase : r.title || "Grupo")}</b>
          <div class="toolbar">
            <button class="btn ghost sm" data-move="${i}:-1" title="Subir">↑</button>
            <button class="btn ghost sm" data-move="${i}:1" title="Bajar">↓</button>
            <button class="x" data-del="results.${i}" title="Eliminar tabla">✕</button>
          </div></div>`;
      if (r.kind === "general") {
        const rows = generalRows(data.results, r.phase);
        return `<div class="row-card">${head}
          <div class="grid-2">${input(`results.${i}.qualify`, "Clasifican (top N)", { type: "number" })}</div>
          <p class="hint">Se calcula sola sumando todos los grupos de ${esc(r.phase)} (${rows.length} equipos con resultados).</p>
          ${rows.length ? `<div class="table-wrap"><table class="edit-table"><thead><tr><th>#</th><th>Equipo</th><th>Grupo</th><th>Total</th></tr></thead><tbody>
            ${rows.slice(0, 15).map((row, k) => `<tr class="${k < q ? "qualified" : ""}"><td>${k + 1}</td><td>${esc(row.team)}</td><td>${esc(row.group)}</td><td class="total">${total(row)}</td></tr>`).join("")}
          </tbody></table></div>${rows.length > 15 ? `<p class="hint">… y ${rows.length - 15} más</p>` : ""}` : ""}
        </div>`;
      }
      const ranked = new Set(sortRows(r.rows.filter((x) => (x.team || "").trim())).slice(0, q));
      return `
      <div class="row-card">${head}
        <div class="grid-2">${input(`results.${i}.title`, "Nombre (pestaña)")}${input(`results.${i}.qualify`, "Clasifican (top N)", { type: "number" })}</div>
        <div class="table-wrap"><table class="edit-table">
          <thead><tr><th>Equipo</th><th>Kills</th><th>P.P</th><th>Sanciones</th><th>Total</th><th></th></tr></thead>
          <tbody>${(r.rows || []).map((row, k) => `<tr class="${ranked.has(row) ? "qualified" : ""}">
            <td><input data-bind="results.${i}.rows.${k}.team" value="${esc(row.team)}" placeholder="Equipo ${k + 1}"></td>
            <td><input data-bind="results.${i}.rows.${k}.kills" type="number" min="0" value="${Number(row.kills) || 0}"></td>
            <td><input data-bind="results.${i}.rows.${k}.placement" type="number" min="0" value="${Number(row.placement) || 0}"></td>
            <td><input data-bind="results.${i}.rows.${k}.penalty" type="number" min="0" value="${Number(row.penalty) || 0}"></td>
            <td class="total" data-total="${i}.${k}">${total(row)}</td>
            <td><button class="x" data-del="results.${i}.rows.${k}" title="Quitar">✕</button></td>
          </tr>`).join("")}</tbody>
        </table></div>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn ghost sm" data-addrow="${i}">+ Equipo</button>
          <button class="btn ghost sm" data-paste="${i}">Pegar equipos</button>
          <button class="btn ghost sm" data-sort="${i}">Ordenar por total</button>
          <span class="hint" style="margin:0">${r.rows.length} equipos${r.updated ? " · Actualizado: " + esc(r.updated) : ""}</span>
        </div>
        <div data-pastebox="${i}" hidden style="margin-top:10px">
          <textarea placeholder="Plantilla de equipos:&#10;1. OLIS&#10;2. B17 E-SPORT&#10;3. SIX NOVA&#10;…&#10;&#10;O con puntos (Equipo, Kills, P.P, Sanciones):&#10;OLIS, 25, 40, 0"></textarea>
          <div class="toolbar" style="margin-top:8px">
            <button class="btn sm" data-pasteok="${i}">Agregar a la tabla</button>
            <label style="display:flex;gap:6px;align-items:center;color:var(--muted)" title="Solo aplica si pegas puntos"><input type="checkbox" style="width:auto" data-replace="${i}" checked> Reemplazar tabla (si pegas puntos)</label>
          </div>
        </div>
      </div>`;
    }).join("") || `<p class="hint">Sin tablas en esta fase.</p>`;
  }

  function renderSponsors() {
    $("#sp-list").innerHTML = data.sponsors.map((s, i) => `
      <div class="row-card">
        <div class="row-head" style="justify-content:flex-start">
          <div class="sp-preview">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : "Logo"}</div>
          <div><b>#${i + 1}</b>${s.logo ? ` <button class="btn danger sm" data-clearlogo="${i}" style="margin-left:6px">Quitar logo</button>` : ""}</div>
        </div>
        ${input(`sponsors.${i}.name`, "Nombre")}
        ${(s.logo || "").startsWith("data:")
          ? `<div class="field"><label>Logo</label><p class="hint" style="margin:0">Imagen subida desde el admin</p></div>`
          : input(`sponsors.${i}.logo`, "Logo (archivo o URL)", { ph: "assets/sponsors/olis.png" })}
        ${input(`sponsors.${i}.url`, "Enlace (opcional)", { ph: "https://instagram.com/…" })}
        <div class="field"><label>…o subir logo</label><input type="file" accept="image/*" data-logo="${i}"></div>
      </div>`).join("");
  }

  async function renderUsers() {
    const table = $("#users-table");
    table.innerHTML = `<tr><td class="hint">Cargando…</td></tr>`;
    try {
      const users = await rpc("staff_list_users");
      table.innerHTML = `<thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Alta</th><th></th></tr></thead><tbody>${users.map((u) => {
        const self = u.id === me.id;
        return `<tr>
          <td><b>${esc(u.username)}</b></td>
          <td>${esc(u.display_name || "—")}</td>
          <td><select data-role="${u.id}" ${self ? "disabled title='No puedes cambiar tu propio rol'" : ""}>
            ${ROLES.map(([v, l]) => `<option value="${v}" ${u.role === v ? "selected" : ""}>${l}</option>`).join("")}
          </select></td>
          <td>${esc(new Date(u.created_at).toLocaleDateString("es"))}</td>
          <td><div class="toolbar">
            <button class="btn ghost sm" data-resetpw="${u.id}" data-name="${esc(u.username)}" data-urole="${u.role}">Nueva clave</button>
            ${self ? "" : `<button class="x" data-deluser="${u.id}" data-name="${esc(u.username)}" title="Eliminar usuario">✕</button>`}
          </div></td>
        </tr>`;
      }).join("")}</tbody>`;
    } catch (err) {
      table.innerHTML = `<tr><td class="hint">Error: ${esc(err.message)}</td></tr>`;
    }
  }

  $("#new-user").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await rpc("staff_create_user", {
        p_username: f.get("username"), p_password: f.get("password"), p_display_name: f.get("display_name"), p_role: f.get("role"),
      });
      toast(`Usuario ${f.get("username").toLowerCase()} creado`);
      e.target.reset();
      renderUsers();
    } catch (err) { toast(err.message, true); }
  });

  function renderAll() { renderGeneral(); renderPrizes(); renderSchedule(); renderResults(); renderSponsors(); }

  // ---------- team templates ----------
  // Accepts "1. OLIS" (numbered list) or "OLIS, kills, p.p, sanciones" (also tab/; separated, e.g. from Excel).
  function parseTeams(text) {
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const clean = l.replace(/^\d{1,3}\s*[.)\-:]\s*/, "");
      const p = clean.split(/\t|;|,/).map((x) => x.trim());
      return {
        id: uuid(), team: p[0], kills: +p[1] || 0, placement: +p[2] || 0, penalty: Math.abs(+p[3] || 0),
        hasScores: p.length > 1,
      };
    }).filter((r) => r.team);
  }
  const stripRow = ({ hasScores, ...r }) => r;
  // Puts names into the table in order, keeping the scores already loaded in each slot.
  function setTeamNames(group, names) {
    names.forEach((name, k) => {
      if (!group.rows[k]) group.rows.push(...emptyRows(1));
      group.rows[k].team = name;
    });
    group.rows.slice(names.length).forEach((r) => { r.team = ""; });
  }

  // Loads "GRUPO A / 1. OLIS / ..." blocks into the result groups of a phase.
  function bulkLoad(phase, text) {
    const blocks = [];
    let cur = null;
    text.split(/\r?\n/).forEach((line) => {
      const l = line.trim();
      if (!l) return;
      const head = l.match(/^(grupo\s+[^\s:]+|final)\s*:?$/i);
      if (head) { cur = { title: head[1].replace(/\s+/g, " "), lines: [] }; blocks.push(cur); }
      else if (cur) cur.lines.push(l);
    });
    if (!blocks.length) { toast("Empieza cada bloque con el nombre del grupo, ej: GRUPO A", true); return false; }
    const size = Number(data.tournament.teamsPerGroup) || 12;
    const report = [];
    blocks.forEach((b) => {
      const isFinal = b.title.toLowerCase() === "final";
      const title = isFinal ? "Final" : "Grupo " + b.title.split(" ")[1].toUpperCase();
      let gi = data.results.findIndex((g) => g.phase === phase && g.kind !== "general" && g.title.toLowerCase() === title.toLowerCase());
      if (gi < 0) {
        const last = data.results.map((g) => g.phase).lastIndexOf(phase);
        gi = last < 0 ? data.results.length : last + 1;
        data.results.splice(gi, 0, { id: uuid(), phase, kind: "grupo", qualify: 0, updated: "", title, rows: emptyRows(size) });
      }
      const names = parseTeams(b.lines.join("\n")).map((r) => r.team);
      setTeamNames(data.results[gi], names);
      touch(gi);
      report.push(`${title}: ${names.length}${names.length !== size ? " ⚠" : ""}`);
    });
    renderResults(); renderSchedule(); markDirty();
    toast(`Cargado → ${report.join(" · ")}. Pulsa Guardar cambios.`);
    return true;
  }

  $("#bulk-load").addEventListener("click", () => bulkLoad(curPhase, $("#bulk-text").value));

  // ---------- events ----------
  document.addEventListener("input", (e) => {
    const p = e.target.dataset.bind;
    if (!p || !data || e.target.type === "radio") return;
    const v = e.target.type === "number" ? (e.target.value === "" ? 0 : Number(e.target.value)) : e.target.value;
    set(p, v);
    const m = p.match(/^results\.(\d+)\.rows\.(\d+)\./);
    if (m) {
      touch(m[1]);
      const cell = document.querySelector(`[data-total="${m[1]}.${m[2]}"]`);
      if (cell) cell.textContent = total(data.results[m[1]].rows[m[2]]);
    }
    markDirty();
  });

  document.addEventListener("change", async (e) => {
    const el = e.target;
    if (el.dataset.role) {
      const role = el.value;
      if (!confirm(`¿Cambiar el rol a "${role}"?`)) return renderUsers();
      try { await rpc("staff_update_user", { p_id: el.dataset.role, p_role: role, p_password: null }); toast("Rol actualizado"); }
      catch (err) { toast(err.message, true); }
      renderUsers();
      return;
    }
    if (!data) return;
    if (el.dataset.bind && (el.tagName === "SELECT" || el.type === "radio")) { set(el.dataset.bind, el.value); markDirty(); }
    if (el.dataset.bind?.endsWith(".qualify")) renderResults();
    if (el.dataset.visible !== undefined) {
      data.schedule[el.dataset.visible].visible = el.checked;
      renderSchedule(); markDirty();
    }
    if (el.dataset.rooms !== undefined) {
      data.schedule.filter((m) => m.phase === el.dataset.rooms).forEach((m) => { m.rooms = Number(el.value) || 1; });
      markDirty();
    }
    if ((el.dataset.logo !== undefined || el.id === "hero-file") && el.files[0]) {
      el.disabled = true;
      try {
        if (el.id === "hero-file") {
          data.tournament.heroImage = await uploadImage(el.files[0], 1000);
          $("#hero-prev").src = data.tournament.heroImage; $("#hero-prev").hidden = false;
        } else {
          data.sponsors[el.dataset.logo].logo = await uploadImage(el.files[0], 320);
          renderSponsors();
        }
        markDirty();
        toast("Imagen lista. Pulsa Guardar cambios.");
      } catch (err) {
        toast("No se pudo leer la imagen: " + (err.message || err), true);
      } finally { el.disabled = false; }
    }
  });

  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.resetpw) {
      const pw = prompt(`Nueva clave para ${d.name} (mínimo 6 caracteres):`);
      if (!pw) return;
      try { await rpc("staff_update_user", { p_id: d.resetpw, p_role: d.urole, p_password: pw }); toast(`Clave de ${d.name} actualizada`); }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (d.deluser) {
      if (!confirm(`¿Eliminar el usuario ${d.name}?`)) return;
      try { await rpc("staff_delete_user", { p_id: d.deluser }); toast("Usuario eliminado"); renderUsers(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (!data) return;

    if (d.phase !== undefined && t.closest("#phase-filter")) {
      curPhase = d.phase; renderResults();
    } else if (d.del) {
      const keys = d.del.split(".");
      const idx = +keys.pop();
      const arr = get(keys.join("."));
      const label = keys[0] === "results" && keys.length === 1 ? "esta tabla completa" : "este elemento";
      if (!confirm(`¿Eliminar ${label}?`)) return;
      arr.splice(idx, 1);
      if (keys[0] === "results" && keys.length > 1) touch(keys[1]);
      renderAll(); markDirty();
    } else if (d.move) {
      // Move within the same phase.
      const [i, dir] = d.move.split(":").map(Number);
      let j = i + dir;
      while (j >= 0 && j < data.results.length && data.results[j].phase !== data.results[i].phase) j += dir;
      if (j < 0 || j >= data.results.length) return;
      [data.results[i], data.results[j]] = [data.results[j], data.results[i]];
      renderResults(); markDirty();
    } else if (d.rosterbox !== undefined) {
      const box = document.querySelector(`[data-roster="${CSS.escape(d.rosterbox)}"]`);
      box.hidden = !box.hidden;
      if (!box.hidden) box.querySelector("textarea").focus();
    } else if (d.rosterok !== undefined) {
      const box = document.querySelector(`[data-roster="${CSS.escape(d.rosterok)}"]`);
      bulkLoad(d.rosterok, box.querySelector("textarea").value);
    } else if (d.showphase !== undefined) {
      data.schedule.filter((m) => m.phase === d.showphase).forEach((m) => { m.visible = d.on === "1"; });
      renderSchedule(); markDirty();
    } else if (d.addmatch !== undefined) {
      const same = data.schedule.filter((m) => m.phase === d.addmatch);
      const last = same[same.length - 1];
      const at = last ? data.schedule.indexOf(last) + 1 : data.schedule.length;
      data.schedule.splice(at, 0, { id: uuid(), phase: d.addmatch, group: "", date: last?.date || "", time: last?.time || "20:00", rooms: last?.rooms || 1, status: "proximo", visible: false, note: "" });
      renderSchedule(); markDirty();
    } else if (d.addrow !== undefined) {
      data.results[d.addrow].rows.push(...emptyRows(1));
      touch(d.addrow); renderResults(); markDirty();
    } else if (d.sort !== undefined) {
      data.results[d.sort].rows = sortRows(data.results[d.sort].rows);
      renderResults(); markDirty();
    } else if (d.paste !== undefined) {
      const box = document.querySelector(`[data-pastebox="${d.paste}"]`);
      box.hidden = !box.hidden;
    } else if (d.pasteok !== undefined) {
      const i = d.pasteok;
      const text = document.querySelector(`[data-pastebox="${i}"] textarea`).value;
      const rows = parseTeams(text);
      if (!rows.length) return toast("No hay líneas para agregar", true);
      const replace = document.querySelector(`[data-replace="${i}"]`).checked;
      if (rows.every((r) => !r.hasScores)) setTeamNames(data.results[i], rows.map((r) => r.team));
      else data.results[i].rows = replace ? rows.map(stripRow) : [...data.results[i].rows.filter((r) => (r.team || "").trim()), ...rows.map(stripRow)];
      touch(i); renderResults(); markDirty();
      toast(`${rows.length} equipos cargados`);
    } else if (d.clearlogo !== undefined) {
      data.sponsors[d.clearlogo].logo = "";
      renderSponsors(); markDirty();
    }
  });

  $("#add-prize").addEventListener("click", () => {
    data.prizes.push({ place: `${data.prizes.length + 1}° Lugar`, amount: "" });
    renderPrizes(); markDirty();
  });
  $("#add-table").addEventListener("click", () => {
    const n = data.results.filter((g) => g.phase === curPhase && g.kind !== "general").length;
    const size = Number(data.tournament.teamsPerGroup) || 12;
    const last = data.results.map((g) => g.phase).lastIndexOf(curPhase);
    data.results.splice(last + 1 || data.results.length, 0, {
      id: uuid(), phase: curPhase, kind: "grupo", qualify: 0, updated: "",
      title: curPhase === "Final" ? "Final" : `Grupo ${String.fromCharCode(65 + n)}`, rows: emptyRows(size),
    });
    renderResults(); markDirty();
  });
  $("#add-general").addEventListener("click", () => {
    if (data.results.some((g) => g.phase === curPhase && g.kind === "general")) return toast("Esta fase ya tiene tabla general", true);
    const first = data.results.findIndex((g) => g.phase === curPhase);
    data.results.splice(first < 0 ? data.results.length : first, 0, {
      id: uuid(), phase: curPhase, kind: "general", title: "Tabla general", qualify: 0, updated: "", rows: [],
    });
    renderResults(); markDirty();
  });

  // ---------- save (single transaction in staff_save) ----------
  $("#save").addEventListener("click", async () => {
    const btn = $("#save");
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      const t = data.tournament;
      ["teams", "groups", "teamsPerGroup"].forEach((k) => { t[k] = Number(t[k]) || 0; });
      data.schedule.forEach((m) => { m.id ||= uuid(); });
      data.results.forEach((g) => { g.id ||= uuid(); g.rows.forEach((r) => { r.id ||= uuid(); }); });
      data.sponsors.forEach((x) => { x.id ||= uuid(); });
      await rpc("staff_save", { p_data: { ...data, touched: [...touchedGroups] } });

      dirty = false;
      touchedGroups.clear();
      data = normalize(await loadAll());
      renderAll();
      $("#save-state").textContent = "Guardado ✓ · ya visible en la web";
      $("#save-state").style.color = "var(--teal)";
      toast("¡Cambios guardados!");
    } catch (err) {
      toast("Error al guardar: " + err.message, true);
      if (expired(err)) { setToken(null); showLogin(err.message); }
    } finally {
      btn.disabled = false; btn.textContent = "Guardar cambios";
    }
  });

  $("#discard").addEventListener("click", async () => {
    if (dirty && !confirm("¿Deshacer los cambios sin guardar?")) return;
    await boot();
  });
})();
