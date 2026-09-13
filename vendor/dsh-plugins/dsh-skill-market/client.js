/**
 * dsh-skill-market — browser half (hand-written __ModuleLoader__ bundle, no build step).
 * Registers a "技能市场 / Skill Market" section in the settings panel.
 * Data comes from the host's same-origin API (/skill-market/api/*, provided by index.js).
 */
window.__ModuleLoader__.load({
  id: "dsh-skill-market",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const NS = "dsh-skill-market";
    const API = "/skill-market";

    const zh = {
      nav: "技能市场",
      subtitle: "从 GitHub 搜索并安装技能到 ~/.dsh/skills",
      tabSearch: "搜索",
      tabInstalled: "已安装",
      searchPh: "搜索技能，如 reverse、skill、marketing…",
      search: "搜索",
      install: "安装",
      installing: "安装中…",
      uninstall: "卸载",
      loading: "加载中…",
      idle: "输入关键词搜索，或直接点「搜索」浏览热门技能",
      empty: "没有匹配的结果",
      installedEmpty: "还没有安装任何技能",
      installDir: "安装目录",
      stars: "★",
      source: "源码",
      noDesc: "（无描述）",
      confirmInstall: "确认安装",
      confirmWarn: "技能来自 GitHub 第三方仓库。安装即表示你信任该来源。",
      cancel: "取消",
      refresh: "刷新",
      installed: "个技能已安装",
      uninstalled: "已移除",
      failed: "失败",
      viewInRepo: "在 GitHub 查看",
      totalLabel: "共",
      pageLabel: "第",
      urlPh: "粘贴 GitHub 仓库链接，如 https://github.com/microsoft/playwright-cli",
      urlGo: "识别并安装",
      urlLabel: "或直接输入仓库地址",
      urlInspecting: "识别中…",
      urlNoSkills: "该仓库里没有找到 SKILL.md，看起来不是技能仓库",
      urlFound: "识别到以下技能，点击安装：",
      urlSkill: "技能",
    };
    const en = {
      nav: "Skill Market",
      subtitle: "Search GitHub and install skills into ~/.dsh/skills",
      tabSearch: "Search",
      tabInstalled: "Installed",
      searchPh: "Search skills: reverse, skill, marketing…",
      search: "Search",
      install: "Install",
      installing: "Installing…",
      uninstall: "Uninstall",
      loading: "Loading…",
      idle: "Type a keyword, or hit Search to browse popular skills",
      empty: "No results",
      installedEmpty: "No skills installed yet",
      installDir: "Install dir",
      stars: "★",
      source: "Source",
      noDesc: "(no description)",
      confirmInstall: "Confirm install",
      confirmWarn: "Skills come from third-party GitHub repos. Installing means you trust that source.",
      cancel: "Cancel",
      refresh: "Refresh",
      installed: "skill(s) installed",
      uninstalled: "removed",
      failed: "failed",
      viewInRepo: "View on GitHub",
      totalLabel: "Total",
      pageLabel: "Page",
      urlPh: "Paste a GitHub repo link, e.g. https://github.com/microsoft/playwright-cli",
      urlGo: "Inspect & install",
      urlLabel: "Or paste a repo URL directly",
      urlInspecting: "Inspecting…",
      urlNoSkills: "No SKILL.md found in this repo — it does not look like a skill repo",
      urlFound: "Skills detected, click to install:",
      urlSkill: "Skill",
    };

    const css = ""
      + ".sm-wrap{max-width:860px;color:var(--dsw-alias-label-primary,#e6e8ee);display:flex;flex-direction:column;gap:12px;font-size:14px;line-height:1.6}"
      + ".sm-heading{margin:0;font-size:18px;font-weight:600}"
      + ".sm-sub{color:var(--dsw-alias-label-tertiary,#8b90a0);font-size:13px;margin:2px 0 0}"
      + ".sm-row{display:flex;gap:8px}"
      + ".sm-input{flex:1;background:var(--dsw-alias-bg-module-platform,#1a1d24);border:1px solid var(--dsw-alias-border-l2,#2a2e38);color:inherit;border-radius:8px;padding:8px 12px;font-size:14px;outline:none}"
      + ".sm-input:focus{border-color:#4f8cff}"
      + ".sm-btn{background:#4f8cff;border:none;color:#fff;border-radius:8px;padding:8px 18px;cursor:pointer;font-size:13px;flex:none}"
      + ".sm-btn:hover{background:#3d78e6}"
      + ".sm-btn.sm-ghost{background:none;border:1px solid var(--dsw-alias-border-l2,#2a2e38);color:var(--dsw-alias-label-secondary,#b6bcc9)}"
      + ".sm-btn.sm-danger{background:none;border:1px solid #e05c5c;color:#e05c5c}"
      + ".sm-btn.sm-ghost:hover{border-color:#4f8cff;color:#4f8cff}"
      + ".sm-btn.sm-danger:hover{border-color:#e05c5c;background:#45262b}"
      + ".sm-tabs{display:flex;gap:8px;margin-top:4px}"
      + ".sm-tab{background:none;border:1px solid var(--dsw-alias-border-l2,#2a2e38);color:var(--dsw-alias-label-tertiary,#8b90a0);padding:6px 16px;border-radius:20px;cursor:pointer;font-size:13px}"
      + ".sm-tab.sm-on{background:#4f8cff;border-color:#4f8cff;color:#fff}"
      + ".sm-card{background:var(--dsw-alias-bg-module-platform,#1a1d24);border:1px solid var(--dsw-alias-border-l2,#2a2e38);border-radius:12px;padding:14px 18px;display:flex;gap:14px;align-items:flex-start}"
      + ".sm-info{flex:1;min-width:0}"
      + ".sm-name{font-weight:600;font-size:15px;word-break:break-all}"
      + ".sm-desc{color:var(--dsw-alias-label-secondary,#b6bcc9);font-size:13px;margin-top:2px;word-break:break-word}"
      + ".sm-meta{color:var(--dsw-alias-label-tertiary,#8b90a0);font-size:12px;margin-top:6px;display:flex;gap:12px;flex-wrap:wrap}"
      + ".sm-path{color:var(--dsw-alias-label-tertiary,#8b90a0);font-size:11px;word-break:break-all}"
      + ".sm-count{color:var(--dsw-alias-label-tertiary,#8b90a0);font-size:12px;margin:0}"
      + ".sm-err{background:var(--dsw-alias-bg-module-platform,#1a1d24);border:1px solid #e0a13c;border-radius:12px;padding:18px;font-size:13px;color:#e0a13c}"
      + ".sm-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#ffffff;border:2px solid #000000;color:#000000;padding:10px 20px;border-radius:10px;z-index:99;max-width:80%;font-size:14px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.55)}"
      + ".sm-badge{display:inline-block;font-size:11px;padding:1px 8px;border-radius:10px;margin-left:8px;vertical-align:2px;background:#1d4030;color:#7bdca8}"
      + ".sm-link{color:#4f8cff;text-decoration:none;font-size:12px}"
      + ".sm-acts{display:flex;gap:8px;flex:none;align-items:center}"
      + ".sm-pager{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}"
      + ".sm-page{background:none;border:1px solid var(--dsw-alias-border-l2,#2a2e38);color:var(--dsw-alias-label-secondary,#b6bcc9);min-width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:13px;padding:0 8px}"
      + ".sm-page:hover{border-color:#4f8cff;color:#4f8cff}"
      + ".sm-page.sm-on{background:#4f8cff;border-color:#4f8cff;color:#fff}"
      + ".sm-page.sm-off{opacity:.4;cursor:default;pointer-events:none}"
      + ".sm-page.sm-dot{border:none;color:var(--dsw-alias-label-tertiary,#8b90a0);cursor:default}"
      + ".sm-urlbox{margin-top:8px;background:var(--dsw-alias-bg-module-platform,#1a1d24);border:1px solid var(--dsw-alias-border-l2,#2a2e38);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}"
      + ".sm-urllabel{font-size:12px;color:var(--dsw-alias-label-tertiary,#8b90a0)}"
      + ".sm-found{background:var(--dsw-alias-bg-module-platform,#1a1d24);border:1px solid var(--dsw-alias-border-l2,#2a2e38);border-radius:12px;padding:14px 18px;margin-top:8px}"
      + ".sm-skillrow{display:flex;gap:10px;align-items:baseline;padding:4px 0;border-top:1px solid var(--dsw-alias-border-l2,#2a2e38)}"
      + ".sm-skillrow .sm-name{font-size:13px}";

    const tagId = "dsh-skill-market/styles";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-skill-market";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    function RepoCard(props) {
      const r = props.r;
      const busy = props.busy;
      return h("div", { className: "sm-card" },
        h("div", { className: "sm-info" },
          h("div", { className: "sm-name" }, r.fullName,
            r.hasSkill ? h("span", { className: "sm-badge" }, "skill") : null),
          h("div", { className: "sm-desc" }, r.description || props.t("noDesc")),
          h("div", { className: "sm-meta" },
            h("span", null, props.t("stars") + " " + r.stars),
            h("a", { className: "sm-link", href: r.url, target: "_blank", rel: "noreferrer" }, props.t("viewInRepo")))),
        h("div", { className: "sm-acts" },
          h("button", { className: "sm-btn" + (busy ? " sm-ghost" : ""), disabled: busy,
            onClick: function () { props.onInstall(r); } },
            busy ? props.t("installing") : props.t("install"))));
    }

    function InstalledCard(props) {
      const s = props.s;
      return h("div", { className: "sm-card" },
        h("div", { className: "sm-info" },
          h("div", { className: "sm-name" }, s.name),
          h("div", { className: "sm-desc" }, s.description || props.t("noDesc")),
          h("div", { className: "sm-path" }, s.path)),
        h("div", { className: "sm-acts" },
          h("button", { className: "sm-btn sm-danger", onClick: function () { props.onUninstall(s.name); } },
            props.t("uninstall"))));
    }

    function Pager(props) {
      const page = props.page;
      const total = props.totalPages;
      const onGo = props.onGo;
      const MAX_BUTTONS = 7;
      const pages = [];
      if (total <= MAX_BUTTONS) {
        for (let i = 1; i <= total; i++) pages.push(i);
      } else {
        pages.push(1);
        let lo = Math.max(2, page - 1);
        let hi = Math.min(total - 1, page + 1);
        if (page <= 3) { lo = 2; hi = Math.min(total - 1, 5); }
        if (page >= total - 2) { lo = Math.max(2, total - 4); hi = total - 1; }
        if (lo > 2) pages.push("…");
        for (let i = lo; i <= hi; i++) pages.push(i);
        if (hi < total - 1) pages.push("…");
        pages.push(total);
      }
      return h("div", { className: "sm-pager" },
        h("button", { className: "sm-page" + (page <= 1 ? " sm-off" : ""), disabled: page <= 1,
          onClick: function () { if (page > 1) onGo(page - 1); } }, "‹"),
        pages.map(function (p, idx) {
          if (p === "…") return h("span", { key: "e" + idx, className: "sm-page sm-dot" }, "…");
          return h("button", { key: p, className: "sm-page" + (p === page ? " sm-on" : ""),
            onClick: function () { if (p !== page) onGo(p); } }, String(p));
        }),
        h("button", { className: "sm-page" + (page >= total ? " sm-off" : ""), disabled: page >= total,
          onClick: function () { if (page < total) onGo(page + 1); } }, "›"));
    }

    function SkillMarketSection(props) {
      const t = props.t;
      const PER_PAGE = 10;
      const [tab, setTab] = useState("search");
      const [query, setQuery] = useState("");
      const [results, setResults] = useState(null);
      const [searching, setSearching] = useState(false);
      const [installed, setInstalled] = useState(null);
      const [error, setError] = useState(null);
      const [busyName, setBusyName] = useState(null);
      const [toast, setToast] = useState(null);
      const [installDir, setInstallDir] = useState("");
      const [page, setPage] = useState(1);
      const [totalPages, setTotalPages] = useState(1);
      const [totalCount, setTotalCount] = useState(0);
      const [repoUrl, setRepoUrl] = useState("");
      const [inspecting, setInspecting] = useState(false);
      const [repoInfo, setRepoInfo] = useState(null);

      const showToast = useCallback(function (msg) {
        setToast(msg);
        setTimeout(function () { setToast(null); }, 4000);
      }, []);

      const loadInstalled = useCallback(function () {
        fetch(API + "/api/installed")
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok) {
              setInstalled(d.items || []);
              if (d.installDir) setInstallDir(d.installDir);
            }
            else setError((d && d.message) || "load failed");
          })
          .catch(function (e) { setError(String(e)); });
      }, []);

      function doSearch(q, pg) {
        const qs = String(q === undefined ? query : q).trim();
        const target = pg === undefined ? 1 : pg;
        setError(null);
        setSearching(true);
        setResults(null);
        setPage(target);
        fetch(API + "/api/search?q=" + encodeURIComponent(qs) + "&page=" + target + "&perPage=" + PER_PAGE)
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok) {
              setResults(d.items || []);
              setTotalPages(d.totalPages || 1);
              setTotalCount(d.total || 0);
            }
            else setError((d && d.message) || "search failed");
          })
          .catch(function (e) { setError(String(e)); })
          .finally(function () { setSearching(false); });
      }

      // 打开页面即自动加载：已安装列表 + 热门技能（空查询）
      useEffect(function () {
        loadInstalled();
        doSearch("");
      }, [loadInstalled]);

      function confirmInstall(r) {
        if (!window.confirm(t("confirmInstall") + " " + r.fullName + "?\n" + t("confirmWarn"))) return;
        setBusyName(r.fullName);
        setError(null);
        fetch(API + "/api/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner: r.owner, repo: r.repo }),
        })
          .then(function (res) { return res.json(); })
          .then(function (d) {
            if (d && d.ok) {
              const names = (d.installed || []).map(function (x) { return x.name; }).join(", ");
              showToast(names + " " + t("installed"));
              loadInstalled();
            } else {
              setError((d && d.message) || t("failed"));
            }
          })
          .catch(function (e) { setError(String(e)); })
          .finally(function () { setBusyName(null); });
      }

      function doUninstall(name) {
        if (!window.confirm(t("uninstall") + " " + name + "?")) return;
        fetch(API + "/api/uninstall", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name }),
        })
          .then(function (res) { return res.json(); })
          .then(function (d) {
            showToast((d && d.message) || name + " " + t("uninstalled"));
            loadInstalled();
          })
          .catch(function (e) { setError(String(e)); });
      }

      function doInspectUrl() {
        const u = String(repoUrl || "").trim();
        if (!u) { setError(t("urlPh")); return; }
        setError(null);
        setInspecting(true);
        setRepoInfo(null);
        fetch(API + "/api/repo?url=" + encodeURIComponent(u))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok) setRepoInfo(d);
            else setError((d && d.message) || "inspect failed");
          })
          .catch(function (e) { setError(String(e)); })
          .finally(function () { setInspecting(false); });
      }

      function installFromUrl() {
        if (!repoInfo) return;
        const u = String(repoUrl || "").trim();
        if (!window.confirm(t("confirmInstall") + " " + repoInfo.fullName + "?\n" + t("confirmWarn"))) return;
        setBusyName(repoInfo.fullName);
        setError(null);
        fetch(API + "/api/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(u ? { url: u } : { owner: repoInfo.owner, repo: repoInfo.repo }),
        })
          .then(function (res) { return res.json(); })
          .then(function (d) {
            if (d && d.ok) {
              const names = (d.installed || []).map(function (x) { return x.name; }).join(", ");
              showToast(names + " " + t("installed"));
              loadInstalled();
              setRepoInfo(null);
              setRepoUrl("");
            } else {
              setError((d && d.message) || t("failed"));
            }
          })
          .catch(function (e) { setError(String(e)); })
          .finally(function () { setBusyName(null); });
      }

      const children = [];
      children.push(h("h2", { key: "h", className: "sm-heading" }, t("nav")));
      children.push(h("p", { key: "s", className: "sm-sub" }, t("subtitle")));

      children.push(h("div", { key: "tabs", className: "sm-tabs" },
        h("button", { className: "sm-tab" + (tab === "search" ? " sm-on" : ""), onClick: function () { setTab("search"); } }, t("tabSearch")),
        h("button", { className: "sm-tab" + (tab === "installed" ? " sm-on" : ""), onClick: function () { setTab("installed"); } }, t("tabInstalled"))));

      if (tab === "search") {
        children.push(h("div", { key: "q", className: "sm-row" },
          h("input", { className: "sm-input", placeholder: t("searchPh"), value: query,
            onChange: function (e) { setQuery(e.target.value); },
            onKeyDown: function (e) { if (e.key === "Enter") doSearch(); } }),
          h("button", { className: "sm-btn", onClick: function () { doSearch(); } }, t("search"))));
        children.push(h("div", { key: "url", className: "sm-urlbox" },
          h("div", { className: "sm-urllabel" }, t("urlLabel")),
          h("div", { className: "sm-row" },
            h("input", { className: "sm-input", placeholder: t("urlPh"), value: repoUrl,
              onChange: function (e) { setRepoUrl(e.target.value); },
              onKeyDown: function (e) { if (e.key === "Enter") doInspectUrl(); } }),
            h("button", { className: "sm-btn sm-ghost", disabled: inspecting,
              onClick: doInspectUrl },
              inspecting ? t("urlInspecting") : t("urlGo")))));
        if (inspecting) children.push(h("p", { key: "insp", className: "sm-count" }, t("urlInspecting")));
        if (repoInfo) {
          const skills = repoInfo.skills || [];
          children.push(h("div", { key: "found", className: "sm-found" },
            h("div", { className: "sm-name" }, repoInfo.fullName,
              h("span", { className: "sm-badge" }, skills.length + " " + t("urlSkill"))),
            h("div", { className: "sm-desc" }, repoInfo.description || t("noDesc")),
            skills.length === 0
              ? h("p", { className: "sm-count" }, t("urlNoSkills"))
              : h("p", { className: "sm-count" }, t("urlFound")),
            skills.map(function (s) {
              return h("div", { key: s.path, className: "sm-skillrow" },
                h("span", { className: "sm-name" }, s.name),
                h("span", { className: "sm-path" }, s.path));
            }),
            skills.length > 0 && h("div", { className: "sm-acts", style: { marginTop: "8px" } },
              h("button", { className: "sm-btn" + (busyName === repoInfo.fullName ? " sm-ghost" : ""), disabled: busyName === repoInfo.fullName,
                onClick: installFromUrl },
                busyName === repoInfo.fullName ? t("installing") : t("install")))));
        }
        if (error) children.push(h("div", { key: "e", className: "sm-err" }, error));
        if (searching) children.push(h("p", { key: "l", className: "sm-count" }, t("loading")));
        if (!searching && results === null && !error) children.push(h("p", { key: "w", className: "sm-count" }, t("idle")));
        if (!searching && results && results.length === 0) children.push(h("p", { key: "n", className: "sm-count" }, t("empty")));
        (results || []).forEach(function (r) {
          children.push(h(RepoCard, { key: r.fullName, r: r, t: t,
            busy: busyName === r.fullName, onInstall: confirmInstall }));
        });
        if (totalPages > 1) children.push(h(Pager, { key: "pager", page: page, totalPages: totalPages, onGo: function (p) { doSearch(query, p); } }));
        if (results && results.length > 0) children.push(h("p", { key: "cnt", className: "sm-count" },
          t("totalLabel") + " " + totalCount + " · " + t("pageLabel") + " " + page + "/" + totalPages));
      } else {
        if (error) children.push(h("div", { key: "e", className: "sm-err" }, error));
        if (installed === null) children.push(h("p", { key: "l", className: "sm-count" }, t("loading")));
        if (installed && installed.length === 0) children.push(h("p", { key: "n", className: "sm-count" }, t("installedEmpty")));
        (installed || []).forEach(function (s) {
          children.push(h(InstalledCard, { key: s.name, s: s, t: t, onUninstall: doUninstall }));
        });
        if (installed) children.push(h("p", { key: "c", className: "sm-count" },
          t("installDir") + ": " + (installDir || "") + " · " + installed.length));
      }

      if (toast) children.push(h("div", { key: "toast", className: "sm-toast" }, toast));
      return h("div", { className: "sm-wrap" }, children);
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-skill-market: dictionaries");
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "skill-market",
        order: 30,
        label: () => t("nav"),
        locale: NS,
        inject: () => ({ t }),
      }, () => h(SkillMarketSection, { t, locale: ctx.locale })));
    }

    const inject = ["slots", "locale"];
    exports.name = "dsh-skill-market";
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
