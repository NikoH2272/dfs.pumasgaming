(() => {
  const { esc, LOGO_SVG, total, sb, must } = DFS;
  const $ = (s) => document.querySelector(s);
  const SPONSOR_SLOTS = 18;
  const ROLES = [["pendiente", "Pendiente"], ["editor", "Editor"], ["admin", "Admin"]];

  $("#logo").innerHTML = LOGO_SVG;

  let data = null;
  let me = null;      // { id, email, display_name, role }
  let dirty = false;
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
  addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  // Resize an uploaded image to WebP and store it in the "media" bucket.
  const uploadImage = (file, max, folder) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob(async (blob) => {
        const path = `${folder}/${uuid()}.webp`;
        const { error } = await sb.storage.from("media").upload(path, blob, { contentType: "image/webp" });
        if (error) return reject(error);
        resolve(sb.storage.from("media").getPublicUrl(path).data.publicUrl);
      }, "image/webp", 0.85);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });

  const normalize = (d) => {
    d.tournament ??= {}; d.links ??= {};
    d.prizes ??= []; d.schedule ??= []; d.results ??= []; d.sponsors ??= [];
    while (d.sponsors.length < SPONSOR_SLOTS) d.sponsors.push({ id: uuid(), name: "", logo: "", url: "" });
    return d;
  };

  // ---------- auth ----------
  let signupMode = false;
  const showLogin = (msg) => {
    $("#login-view").hidden = false;
    $("#admin-view").hidden = true;
    $("#savebar").hidden = true;
    $("#logout").hidden = !msg;
    $("#who").textContent = "";
    $("#pending-msg").hidden = !msg;
    $("#pending-msg").textContent = msg || "";
  };

  if (!sb) {
    showLogin("Falta configurar Supabase: agrega la clave anon/publishable en assets/config.js.");
    $("#login-btn").disabled = true;
    $("#mode-toggle").disabled = true;
    $("#logout").hidden = true;
    return;
  }

  $("#mode-toggle").addEventListener("click", () => {
    signupMode = !signupMode;
    $("#name-field").hidden = !signupMode;
    $("#login-title").textContent = signupMode ? "Crear cuenta" : "Panel admin";
    $("#login-hint").textContent = signupMode
      ? "Tu cuenta quedará pendiente hasta que un admin te asigne un rol."
      : "Inicia sesión con tu cuenta del staff.";
    $("#login-btn").textContent = signupMode ? "Registrarme" : "Entrar";
    $("#mode-toggle").textContent = signupMode ? "Ya tengo cuenta" : "Crear cuenta";
    $("#pw").autocomplete = signupMode ? "new-password" : "current-password";
  });

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#em").value.trim(), password = $("#pw").value;
    const btn = $("#login-btn");
    btn.disabled = true;
    try {
      if (signupMode) {
        const { data: res, error } = await sb.auth.signUp({
          email, password,
          options: { data: { display_name: $("#dn").value.trim() }, emailRedirectTo: location.href.split("#")[0] },
        });
        if (error) throw error;
        if (!res.session) showLogin("Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.");
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast(err.message === "Invalid login credentials" ? "Correo o contraseña incorrectos" : err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  $("#logout").addEventListener("click", async () => {
    if (dirty && !confirm("Tienes cambios sin guardar. ¿Salir igual?")) return;
    dirty = false;
    await sb.auth.signOut();
    location.reload();
  });

  let booted = false;
  sb.auth.onAuthStateChange((_event, session) => {
    // Defer: calling supabase inside this callback can deadlock the auth lock.
    setTimeout(() => onSession(session), 0);
  });

  async function onSession(session) {
    if (!session) { booted = false; me = null; return showLogin(); }
    if (booted) return;
    const { data: profile, error } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    if (error || !profile) return showLogin("No se encontró tu perfil. ¿Ejecutaste supabase/schema.sql?");
    me = profile;
    if (!["admin", "editor"].includes(me.role)) {
      return showLogin(`Hola ${me.display_name || me.email}: tu cuenta está pendiente de aprobación por un admin.`);
    }
    booted = true;
    await boot();
  }

  async function boot() {
    try {
      data = normalize(await DFS.fetchFromSupabase());
    } catch (err) {
      return toast("No se pudo cargar la base de datos: " + err.message, true);
    }
    $("#login-view").hidden = true;
    $("#admin-view").hidden = false;
    $("#savebar").hidden = false;
    $("#logout").hidden = false;
    $("#who").textContent = `${me.display_name || me.email} · ${me.role}`;
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
  const input = (path, label, opts = {}) => `
    <div class="field"><label>${label}</label>
      ${opts.select
        ? `<select data-bind="${path}">${opts.select.map(([v, l]) => `<option value="${v}" ${get(path) === v ? "selected" : ""}>${l}</option>`).join("")}</select>`
        : `<input data-bind="${path}" type="${opts.type || "text"}" value="${esc(get(path))}" placeholder="${esc(opts.ph || "")}">`}
    </div>`;

  function renderGeneral() {
    $("#general-fields").innerHTML = [
      ["tournament.name", "Nombre del torneo"],
      ["tournament.tagline", "Lema"],
      ["tournament.status", "Estado (badge)", { ph: "Inscripciones abiertas / En curso / Finalizado" }],
      ["tournament.prizePool", "Prize pool"],
      ["tournament.game", "Juego"],
      ["tournament.year", "Año"],
      ["tournament.server", "Servidor"],
      ["tournament.platform", "Plataforma"],
      ["tournament.teams", "Equipos", { type: "number" }],
      ["tournament.groups", "Grupos", { type: "number" }],
    ].map(([p, l, o]) => input(p, l, o)).join("");
    document.querySelector('[data-bind="tournament.intro"]').value = data.tournament.intro || "";
    document.querySelectorAll("#p-links [data-bind]").forEach((el) => { el.value = get(el.dataset.bind) || ""; });
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

  function renderSchedule() {
    $("#sched-list").innerHTML = data.schedule.map((_, i) => `
      <div class="row-card">
        <div class="row-head"><b>Fecha ${i + 1}</b><button class="x" data-del="schedule.${i}" title="Eliminar">✕</button></div>
        <div class="inline-grid sched-grid">
          ${input(`schedule.${i}.date`, "Día", { type: "date" })}
          ${input(`schedule.${i}.time`, "Hora", { type: "time" })}
          ${input(`schedule.${i}.title`, "Título", { ph: "Fase de grupos · Jornada 1" })}
          ${input(`schedule.${i}.detail`, "Detalle", { ph: "Grupos A – E" })}
          ${input(`schedule.${i}.status`, "Estado", { select: [["proximo", "Próximo"], ["envivo", "En vivo"], ["finalizado", "Finalizado"]] })}
        </div>
      </div>`).join("") || `<p class="hint">Sin fechas aún.</p>`;
  }

  function renderResults() {
    $("#results-list").innerHTML = data.results.map((r, i) => `
      <div class="row-card">
        <div class="row-head"><b>${esc(r.title || "Tabla " + (i + 1))}</b>
          <div class="toolbar">
            <button class="btn ghost sm" data-move="${i}:-1" title="Subir">↑</button>
            <button class="btn ghost sm" data-move="${i}:1" title="Bajar">↓</button>
            <button class="x" data-del="results.${i}" title="Eliminar tabla">✕</button>
          </div></div>
        <div class="grid-2">${input(`results.${i}.title`, "Nombre (pestaña)")}${input(`results.${i}.phase`, "Fase")}</div>
        <div class="table-wrap"><table class="edit-table">
          <thead><tr><th>Equipo</th><th>Booyah</th><th>Kills</th><th>Pts. pos.</th><th>Total</th><th></th></tr></thead>
          <tbody>${(r.rows || []).map((row, k) => `<tr>
            <td><input data-bind="results.${i}.rows.${k}.team" value="${esc(row.team)}" placeholder="Nombre del equipo"></td>
            <td><input data-bind="results.${i}.rows.${k}.booyah" type="number" min="0" value="${Number(row.booyah) || 0}"></td>
            <td><input data-bind="results.${i}.rows.${k}.kills" type="number" min="0" value="${Number(row.kills) || 0}"></td>
            <td><input data-bind="results.${i}.rows.${k}.placement" type="number" min="0" value="${Number(row.placement) || 0}"></td>
            <td class="total" data-total="${i}.${k}">${total(row)}</td>
            <td><button class="x" data-del="results.${i}.rows.${k}" title="Quitar">✕</button></td>
          </tr>`).join("")}</tbody>
        </table></div>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn ghost sm" data-addrow="${i}">+ Equipo</button>
          <button class="btn ghost sm" data-paste="${i}">Pegar lista</button>
          <button class="btn ghost sm" data-sort="${i}">Ordenar por total</button>
          <span class="hint" style="margin:0">${r.updated ? "Actualizado: " + esc(r.updated) : ""}</span>
        </div>
        <div data-pastebox="${i}" hidden style="margin-top:10px">
          <textarea placeholder="Un equipo por línea:&#10;Equipo, Booyah, Kills, Pts posición&#10;PUMAS GAMING, 2, 25, 40"></textarea>
          <div class="toolbar" style="margin-top:8px">
            <button class="btn sm" data-pasteok="${i}">Agregar a la tabla</button>
            <label style="display:flex;gap:6px;align-items:center;color:var(--muted)"><input type="checkbox" style="width:auto" data-replace="${i}"> Reemplazar equipos actuales</label>
          </div>
        </div>
      </div>`).join("") || `<p class="hint">Sin tablas. Crea una o usa “Crear grupos A–O”.</p>`;
  }

  function renderSponsors() {
    $("#sp-list").innerHTML = data.sponsors.map((s, i) => `
      <div class="row-card">
        <div class="row-head" style="justify-content:flex-start">
          <div class="sp-preview">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : "Logo"}</div>
          <div><b>#${i + 1}</b>${s.logo ? ` <button class="btn danger sm" data-clearlogo="${i}" style="margin-left:6px">Quitar logo</button>` : ""}</div>
        </div>
        ${input(`sponsors.${i}.name`, "Nombre")}
        ${input(`sponsors.${i}.url`, "Enlace (opcional)", { ph: "https://instagram.com/…" })}
        <div class="field"><label>Subir logo</label><input type="file" accept="image/*" data-logo="${i}"></div>
      </div>`).join("");
  }

  async function renderUsers() {
    const table = $("#users-table");
    table.innerHTML = `<tr><td class="hint">Cargando…</td></tr>`;
    try {
      const users = must(await sb.from("profiles").select("*").order("created_at"));
      table.innerHTML = `<thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Alta</th></tr></thead><tbody>${users.map((u) => `
        <tr>
          <td>${esc(u.display_name || "—")}</td>
          <td>${esc(u.email)}</td>
          <td><select data-role="${u.id}" ${u.id === me.id ? "disabled title='No puedes cambiar tu propio rol'" : ""}>
            ${ROLES.map(([v, l]) => `<option value="${v}" ${u.role === v ? "selected" : ""}>${l}</option>`).join("")}
          </select></td>
          <td>${esc(new Date(u.created_at).toLocaleDateString("es"))}</td>
        </tr>`).join("")}</tbody>`;
    } catch (err) {
      table.innerHTML = `<tr><td class="hint">Error: ${esc(err.message)}</td></tr>`;
    }
  }

  function renderAll() { renderGeneral(); renderPrizes(); renderSchedule(); renderResults(); renderSponsors(); }

  // ---------- events ----------
  document.addEventListener("input", (e) => {
    const p = e.target.dataset.bind;
    if (!p || !data) return;
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
      try {
        must(await sb.from("profiles").update({ role }).eq("id", el.dataset.role).select());
        toast("Rol actualizado");
      } catch (err) { toast("Error: " + err.message, true); renderUsers(); }
      return;
    }
    if (el.dataset.bind && el.tagName === "SELECT") { set(el.dataset.bind, el.value); markDirty(); }
    if ((el.dataset.logo !== undefined || el.id === "hero-file") && el.files[0]) {
      el.disabled = true;
      try {
        if (el.id === "hero-file") {
          data.tournament.heroImage = await uploadImage(el.files[0], 1100, "hero");
          $("#hero-prev").src = data.tournament.heroImage; $("#hero-prev").hidden = false;
        } else {
          data.sponsors[el.dataset.logo].logo = await uploadImage(el.files[0], 320, "sponsors");
          renderSponsors();
        }
        markDirty();
        toast("Imagen subida. Pulsa Guardar cambios.");
      } catch (err) {
        toast("No se pudo subir la imagen: " + (err.message || err), true);
      } finally { el.disabled = false; }
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || !data) return;
    const d = t.dataset;

    if (d.del) {
      const keys = d.del.split(".");
      const idx = +keys.pop();
      const arr = get(keys.join("."));
      const label = keys[0] === "results" && keys.length === 1 ? "esta tabla completa" : "este elemento";
      if (!confirm(`¿Eliminar ${label}?`)) return;
      arr.splice(idx, 1);
      if (keys[0] === "results" && keys.length > 1) touch(keys[1]);
      renderAll(); markDirty();
    } else if (d.move) {
      const [i, dir] = d.move.split(":").map(Number);
      const j = i + dir;
      if (j < 0 || j >= data.results.length) return;
      [data.results[i], data.results[j]] = [data.results[j], data.results[i]];
      renderResults(); markDirty();
    } else if (d.addrow !== undefined) {
      data.results[d.addrow].rows.push({ id: uuid(), team: "", booyah: 0, kills: 0, placement: 0 });
      touch(d.addrow); renderResults(); markDirty();
    } else if (d.sort !== undefined) {
      data.results[d.sort].rows = DFS.sortRows(data.results[d.sort].rows);
      renderResults(); markDirty();
    } else if (d.paste !== undefined) {
      const box = document.querySelector(`[data-pastebox="${d.paste}"]`);
      box.hidden = !box.hidden;
    } else if (d.pasteok !== undefined) {
      const i = d.pasteok;
      const text = document.querySelector(`[data-pastebox="${i}"] textarea`).value;
      const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const p = l.split(/\t|;|,/).map((x) => x.trim());
        return { id: uuid(), team: p[0], booyah: +p[1] || 0, kills: +p[2] || 0, placement: +p[3] || 0 };
      });
      if (!rows.length) return toast("No hay líneas para agregar", true);
      const replace = document.querySelector(`[data-replace="${i}"]`).checked;
      data.results[i].rows = replace ? rows : [...data.results[i].rows, ...rows];
      touch(i); renderResults(); markDirty();
      toast(`${rows.length} equipos agregados`);
    } else if (d.clearlogo !== undefined) {
      data.sponsors[d.clearlogo].logo = "";
      renderSponsors(); markDirty();
    }
  });

  $("#add-prize").addEventListener("click", () => {
    data.prizes.push({ place: `${data.prizes.length + 1}° Lugar`, amount: "" });
    renderPrizes(); markDirty();
  });
  $("#add-match").addEventListener("click", () => {
    data.schedule.push({ id: uuid(), date: new Date().toISOString().slice(0, 10), time: "20:00", title: "", detail: "", status: "proximo" });
    renderSchedule(); markDirty();
  });
  $("#add-table").addEventListener("click", () => {
    data.results.push({ id: uuid(), title: `Tabla ${data.results.length + 1}`, phase: "", updated: "", rows: [] });
    renderResults(); markDirty();
  });
  $("#make-groups").addEventListener("click", () => {
    const existing = new Set(data.results.map((r) => r.title));
    const n = Math.min(26, Number(data.tournament.groups) || 15);
    let added = 0;
    for (let k = 0; k < n; k++) {
      const title = `Grupo ${String.fromCharCode(65 + k)}`;
      if (!existing.has(title)) { data.results.push({ id: uuid(), title, phase: "Fase de grupos", updated: "", rows: [] }); added++; }
    }
    renderResults(); if (added) markDirty();
    toast(added ? `${added} grupos creados` : "Los grupos ya existen");
  });

  // ---------- save ----------
  // Upserts every row we hold and deletes rows that were removed in the editor.
  const syncTable = async (table, rows) => {
    if (rows.length) must(await sb.from(table).upsert(rows).select("id"));
    const ids = rows.map((r) => r.id);
    let del = sb.from(table).delete();
    del = ids.length ? del.not("id", "in", `(${ids.join(",")})`) : del.not("id", "is", null);
    must(await del.select("id"));
  };

  $("#save").addEventListener("click", async () => {
    const btn = $("#save");
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      const t = data.tournament;
      t.teams = Number(t.teams) || 0;
      t.groups = Number(t.groups) || 0;
      must(await sb.from("settings").upsert({ id: 1, tournament: t, links: data.links, prizes: data.prizes, updated_at: new Date().toISOString() }).select("id"));

      await syncTable("schedule", data.schedule.map((m) => ({
        id: m.id ||= uuid(), date: m.date || null, time: m.time || "", title: m.title || "", detail: m.detail || "", status: m.status || "proximo",
      })));

      const groups = data.results.map((g, i) => ({ id: g.id ||= uuid(), title: g.title || "", phase: g.phase || "", position: i }));
      if (groups.length) must(await sb.from("result_groups").upsert(groups).select("id"));
      if (touchedGroups.size) must(await sb.from("result_groups").update({ updated_at: new Date().toISOString() }).in("id", [...touchedGroups]).select("id"));
      await syncTable("result_rows", data.results.flatMap((g) => g.rows.map((r, k) => ({
        id: r.id ||= uuid(), group_id: g.id, team: r.team || "", booyah: Number(r.booyah) || 0, kills: Number(r.kills) || 0, placement: Number(r.placement) || 0, position: k,
      }))));
      await syncTable("result_groups", groups);

      await syncTable("sponsors", data.sponsors.map((s, i) => ({
        id: s.id ||= uuid(), position: i, name: s.name || "", logo_url: s.logo || "", url: s.url || "",
      })));

      dirty = false;
      touchedGroups.clear();
      data = normalize(await DFS.fetchFromSupabase());
      renderAll();
      $("#save-state").textContent = "Guardado ✓ · ya visible en la web";
      $("#save-state").style.color = "var(--teal)";
      toast("¡Cambios guardados!");
    } catch (err) {
      toast("Error al guardar: " + err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = "Guardar cambios";
    }
  });

  $("#discard").addEventListener("click", async () => {
    if (dirty && !confirm("¿Deshacer los cambios sin guardar?")) return;
    await boot();
  });
})();
