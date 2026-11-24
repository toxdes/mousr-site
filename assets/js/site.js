// Shared page behaviour: header border, copy buttons, segmented tabs, docs navigation.
(function () {
  "use strict";

  const header = document.querySelector(".header");
  if (header) {
    const sync = () => header.classList.toggle("scrolled", scrollY > 8);
    addEventListener("scroll", sync, { passive: true });
    sync();
  }

  const root = document.documentElement;
  const toggle = document.querySelector(".theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      root.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("theme", root.dataset.theme); } catch {}
      dispatchEvent(new Event("themechange"));
    });
  }

  // Star count from the GitHub API, cached per tab; hidden until it is worth showing.
  const stars = document.querySelectorAll(".gh-stars");
  if (stars.length) {
    const show = (n) => {
      if (!(n >= 10)) return;
      const text = n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
      stars.forEach((el) => { el.textContent = `★ ${text}`; el.hidden = false; });
    };
    let cached = null;
    try { cached = sessionStorage.getItem("gh-stars"); } catch {}
    if (cached != null) show(Number(cached));
    else fetch("https://api.github.com/repos/toxdes/mousr")
      .then((r) => (r.ok ? r.json() : null))
      .then((repo) => {
        if (!repo) return;
        try { sessionStorage.setItem("gh-stars", repo.stargazers_count); } catch {}
        show(repo.stargazers_count);
      })
      .catch(() => {});
  }

  const COPY_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/></svg>';
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.innerHTML = `${COPY_ICON}<span>Copy</span>`;
    const label = button.querySelector("span");
    button.addEventListener("click", async () => {
      const source = button.dataset.copy ? document.getElementById(button.dataset.copy) : button.closest(".code").querySelector("pre");
      try {
        await navigator.clipboard.writeText(source.innerText.trim());
        label.textContent = "Copied";
        button.classList.add("done");
      } catch {
        label.textContent = "Select to copy";
      }
      setTimeout(() => {
        label.textContent = "Copy";
        button.classList.remove("done");
      }, 1400);
    });
  });

  document.querySelectorAll("[data-tabs]").forEach((list) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const select = (tab, focus) => {
      tabs.forEach((other) => {
        const on = other === tab;
        other.setAttribute("aria-selected", String(on));
        other.tabIndex = on ? 0 : -1;
        document.getElementById(other.getAttribute("aria-controls")).hidden = !on;
      });
      if (focus) tab.focus();
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(tab, false));
      tab.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        select(tabs[(i + step + tabs.length) % tabs.length], true);
      });
    });
    // Ubuntu and Fedora builds of Firefox name the distro in the user agent; otherwise keep the default tab.
    const ua = navigator.userAgent;
    const hinted = tabs.find((tab) => tab.dataset.ua && new RegExp(tab.dataset.ua).test(ua));
    if (hinted) select(hinted, false);
  });

  const sidebar = document.querySelector(".sidebar");
  if (sidebar) {
    const links = [...sidebar.querySelectorAll('a[href^="#"]')];
    const sections = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);

    const select = document.querySelector(".sidebar-select");
    if (select) {
      links.forEach((a) => select.add(new Option(a.textContent, a.hash)));
      select.addEventListener("change", () => (location.hash = select.value));
    }

    // Highlight the last heading that has scrolled past the top band.
    const update = () => {
      const line = 120;
      let current = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) current = section;
        else break;
      }
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) current = sections[sections.length - 1];
      links.forEach((a) => a.classList.toggle("active", a.hash === `#${current.id}`));
      if (select) select.value = `#${current.id}`;
    };
    addEventListener("scroll", update, { passive: true });
    update();
  }
})();
