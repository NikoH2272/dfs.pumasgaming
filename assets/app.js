(async () => {
  const { esc, safeUrl, safeImg, ICONS, LOGO_SVG, total, sortRows } = DFS;
  const $ = (s) => document.querySelector(s);

  $("#logo").innerHTML = LOGO_SVG;

  // Mobile nav
  const toggle = $(".nav-toggle"), nav = $(".nav");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open);
  });
  nav.addEventListener("click", (e) => { if (e.target.tagName === "A") nav.classList.remove("open"); });

  let data;
  try {
    data = await DFS.loadData();
  } catch (err) {
    document.querySelector("main").insertAdjacentHTML("afterbegin",
      `<div class="container"><p class="empty">No se pudo cargar la información del torneo. Intenta recargar la página.</p></div>`);
    return;
  }
  const t = data.tournament || {}, L = data.links || {};

  // Simple text bindings
  document.querySelectorAll("[data-k]").forEach((el) => {
    const v = t[el.dataset.k];
    if (v) el.textContent = v;
  });
  if (t.name) document.title = `${t.name} · ${t.game || "Free Fire"}`;
  if (safeImg(t.heroImage)) $("#hero-img").src = t.heroImage;
  $("#intro").textContent = t.intro || "";

  // CTAs
  const cta = [];
  if (safeUrl(L.registration)) cta.push(`<a class="btn" href="${esc(L.registration)}" target="_blank" rel="noopener">${ICONS.form} Inscribir equipo</a>`);
  if (safeUrl(L.infoGroup)) cta.push(`<a class="btn ${cta.length ? "ghost" : ""}" href="${esc(L.infoGroup)}" target="_blank" rel="noopener">${ICONS.whatsapp} Grupo de información</a>`);
  cta.push(`<a class="btn ghost" href="#resultados">Ver resultados</a>`);
  $("#hero-cta").innerHTML = cta.join("");

  // Stats strip
  $("#stats").innerHTML = [
    [t.teams || 180, "Equipos"],
    [t.groups || 15, "Grupos"],
    [t.server || "LATAM", "Servidor"],
    [t.prizePool || "400 USD", "Prize pool"],
  ].map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${l}</span></div>`).join("");

  // Chips
  $("#chips").innerHTML = [
    [ICONS.globe, `Servidor ${t.server || "LATAM"}`],
    [ICONS.phone, t.platform || "Solo móvil"],
    [ICONS.users, `${t.teams || 180} equipos · ${t.groups || 15} grupos`],
    [ICONS.trophy, t.game || "Free Fire"],
  ].map(([i, l]) => `<span class="chip">${i}${esc(l)}</span>`).join("");

  // Prizes
  $("#prizes").innerHTML = (data.prizes || []).length
    ? data.prizes.map((p) => `<div class="prize-row"><span>${esc(p.place)}</span><b>${esc(p.amount)}</b></div>`).join("")
    : `<p class="empty">Distribución por anunciar</p>`;

  // Schedule
  const statusLabel = { proximo: "Próximo", envivo: "En vivo", finalizado: "Finalizado" };
  const fmt = (d, opt) => {
    const date = new Date(`${d}T12:00:00`);
    return isNaN(date) ? "" : date.toLocaleDateString("es", opt);
  };
  const sched = [...(data.schedule || [])].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  $("#schedule").innerHTML = sched.length
    ? sched.map((m) => `
      <article class="panel match ${m.status === "finalizado" ? "done" : ""} reveal">
        <div class="date"><b>${esc(fmt(m.date, { day: "2-digit" }))}</b><span>${esc(fmt(m.date, { month: "short" }).replace(".", ""))}</span></div>
        <div>
          <h4>${esc(m.title)}</h4>
          <p>${esc(fmt(m.date, { weekday: "long" }))}${m.time ? ` · ${esc(m.time)} hrs` : ""}${m.detail ? ` · ${esc(m.detail)}` : ""}</p>
        </div>
        <span class="status ${esc(m.status)}">${statusLabel[m.status] || "Próximo"}</span>
      </article>`).join("")
    : `<div class="panel empty">El calendario se publicará pronto.</div>`;

  // Results
  const results = data.results || [];
  const renderTable = (i) => {
    const r = results[i];
    document.querySelectorAll(".tab").forEach((b, j) => {
      b.classList.toggle("active", j === i);
      b.setAttribute("aria-selected", j === i);
    });
    const rows = sortRows(r.rows || []);
    $("#results").innerHTML = rows.length ? `
      <div class="table-wrap"><table class="standings">
        <thead><tr><th>#</th><th>Equipo</th><th class="num">Booyah</th><th class="num">Kills</th><th class="num">Pts. posición</th><th class="num">Total</th></tr></thead>
        <tbody>${rows.map((row, k) => `
          <tr><td><span class="pos-badge">${k + 1}</span></td><td>${esc(row.team)}</td>
          <td class="num">${Number(row.booyah) || 0}</td><td class="num">${Number(row.kills) || 0}</td>
          <td class="num">${Number(row.placement) || 0}</td><td class="num total">${total(row)}</td></tr>`).join("")}
        </tbody></table></div>
      <div class="results-meta"><span>${esc(r.phase || "")}</span><span>${r.updated ? `Actualizado: ${esc(r.updated)}` : ""}</span></div>`
      : `<p class="empty">Aún no hay resultados para ${esc(r.title)}.</p>`;
  };
  if (results.length) {
    $("#result-tabs").innerHTML = results.map((r, i) => `<button class="tab" role="tab" data-i="${i}">${esc(r.title)}</button>`).join("");
    $("#result-tabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) renderTable(+b.dataset.i); });
    renderTable(0);
  } else {
    $("#results").innerHTML = `<p class="empty">Los resultados se publicarán al iniciar la competencia.</p>`;
  }

  // Community
  const social = [
    { href: L.instagram, icon: ICONS.instagram, title: "Instagram", sub: L.instagramHandle || "Síguenos" },
    { href: L.infoGroup, icon: ICONS.whatsapp, title: L.infoGroupLabel || "Grupo de información", sub: L.infoGroup ? "Únete para recibir avisos" : "Disponible pronto" },
  ];
  if (safeUrl(L.discord)) social.push({ href: L.discord, icon: ICONS.discord, title: "Discord", sub: "Comunidad DFS" });
  if (safeUrl(L.registration)) social.push({ href: L.registration, icon: ICONS.form, title: "Inscripciones", sub: "Registra a tu equipo" });
  $("#community").innerHTML = social.map((s) => {
    const url = safeUrl(s.href);
    return `<a class="panel social-card ${url ? "" : "disabled"} reveal" ${url ? `href="${esc(url)}" target="_blank" rel="noopener"` : ""}>
      <span class="ico">${s.icon}</span><span><b>${esc(s.title)}</b><span>${esc(s.sub)}</span></span></a>`;
  }).join("");
  if (safeUrl(L.instagram)) $("#footer-ig").innerHTML = `<a href="${esc(L.instagram)}" target="_blank" rel="noopener">${esc(L.instagramHandle || "Instagram")}</a>`;

  // Sponsors carousel: slides of 6 on desktop, CSS turns it into a grid on mobile.
  const sponsors = (data.sponsors || []).filter((s) => s.name || s.logo);
  const PER = 6;
  const slides = [];
  for (let i = 0; i < sponsors.length; i += PER) slides.push(sponsors.slice(i, i + PER));
  const item = (s) => {
    const img = safeImg(s.logo), url = safeUrl(s.url);
    const inner = img ? `<img src="${esc(img)}" alt="${esc(s.name)}" loading="lazy">` : esc(s.name);
    return url
      ? `<a class="sp-item" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(s.name)}">${inner}</a>`
      : `<div class="sp-item" title="${esc(s.name)}">${inner}</div>`;
  };
  $("#sp-track").innerHTML = slides.map((g, i) => `<div class="sp-slide" aria-label="Grupo ${i + 1} de ${slides.length}">${g.map(item).join("")}</div>`).join("");
  $("#sp-dots").innerHTML = slides.length > 1 ? slides.map((_, i) => `<button aria-label="Ver grupo ${i + 1}"></button>`).join("") : "";

  let cur = 0, timer;
  const go = (i) => {
    cur = (i + slides.length) % slides.length;
    $("#sp-track").style.transform = `translateX(-${cur * 100}%)`;
    document.querySelectorAll("#sp-dots button").forEach((b, j) => b.classList.toggle("active", j === cur));
  };
  const start = () => { stop(); if (slides.length > 1) timer = setInterval(() => go(cur + 1), 3500); };
  const stop = () => clearInterval(timer);
  $("#sp-dots").addEventListener("click", (e) => {
    const i = [...e.currentTarget.children].indexOf(e.target);
    if (i >= 0) { go(i); start(); }
  });
  const box = $(".sponsors");
  box.addEventListener("mouseenter", stop);
  box.addEventListener("mouseleave", start);
  // Swipe support for touch tablets in carousel mode
  let x0 = null;
  box.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) { go(cur + (dx < 0 ? 1 : -1)); start(); }
    x0 = null;
  });
  if (slides.length) { go(0); start(); }

  // Scroll reveal
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
  }), { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
})();
