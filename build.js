#!/usr/bin/env bun
// Builds dist/ from the site sources plus mousr main: VERSION, CLI and configuration docs, CHANGELOG.md, release checksums.
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseChangelog, renderReleases } from "./releases.js";

const root = import.meta.dir;
const source = "https://raw.githubusercontent.com/toxdes/mousr/main";
const repoFiles = "https://github.com/toxdes/mousr/blob/main";
const releases = "https://packages.toxdes.com/releases";
const arches = ["amd64", "arm64"];
// Markdown file -> section id, id prefix for subsections, page anchor for links to it.
const sections = {
  "CLI_REFERENCE.md": { id: "cli", prefix: "cli-", marker: "CLI_REFERENCE" },
  "CONFIGURATION.md": { id: "configuration", prefix: "config-", marker: "CONFIGURATION" },
};

const get = async (url, as = "text") => {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000), cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res[as]();
};

const load = (file, dir) => (dir ? Bun.file(join(dir, file)).text() : get(`${source}/${file}`));

export function parseVersion(text) {
  const v = text.trim();
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(v)) throw new Error(`Invalid VERSION: ${v}`);
  return v;
}

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&\w+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function rewriteLinks(md) {
  return md.replace(/\]\(([^)\s]+)\)/g, (link, target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return link;
    const [path, frag = ""] = target.split("#");
    if (!path) return link;
    const sec = sections[path];
    if (sec) return `](#${frag ? sec.prefix + frag : sec.id})`;
    return `](${repoFiles}/${path}${frag ? "#" + frag : ""})`;
  });
}

// Renders one reference file as a docs section: "#" becomes the h2, "##"/"###" become h3/h4.
export function renderSection(md, { id, prefix }) {
  const nav = [];
  let html = Bun.markdown.html(rewriteLinks(md).replace(/^(#{1,3}) /gm, "#$1 "));
  html = html
    .replace(/<h2[^>]*>(.*?)<\/h2>/, (_, t) => `<h2 id="${id}">${t}<a class="hash" href="#${id}">#</a></h2>`)
    .replace(/<h([34])[^>]*>(.*?)<\/h\1>/g, (_, n, t) => {
      const hid = prefix + slug(t);
      if (n === "3") nav.push(`<a href="#${hid}">${t.replace(/<[^>]+>/g, "")}</a>`);
      return `<h${n} id="${hid}">${t}</h${n}>`;
    })
    // Local in-page anchors from the source refer to headings in the same file.
    .replace(/href="#(?!cli|configuration)([\w-]+)"/g, (m, a) => (a.startsWith(prefix) ? m : `href="#${prefix}${a}"`))
    .replace(/<table>[\s\S]*?<\/table>/g, (t) => `<div class="table">${t}</div>`)
    .replace(/<pre><code(?: class="language-(\w+)")?>/g, (_, lang) =>
      `<div class="code"><div class="code-head">${escape(lang ?? "text")}<button class="copy" type="button" data-copy></button></div><pre>`)
    .replace(/<\/code><\/pre>/g, "</pre></div>");
  return { html, nav };
}

async function checksums(version) {
  const sums = {};
  await Promise.all(arches.map(async (arch) => {
    const data = await get(`${releases}/mousr_${version}_${arch}.tar.gz`, "arrayBuffer");
    sums[arch] = new Bun.CryptoHasher("sha256").update(data).digest("hex");
  }));
  return sums;
}

// Each script is a self-contained IIFE that shares state through window globals, so an IIFE wrapper is safe.
async function minifyScripts(dir) {
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".js")) continue;
    const result = await Bun.build({ entrypoints: [join(dir, name)], minify: true, target: "browser", format: "iife" });
    if (!result.success) throw new Error(`Could not minify ${name}: ${result.logs.join("\n")}`);
    await Bun.write(join(dir, name), await result.outputs[0].text());
  }
}

async function build({ dir }) {
  const version = parseVersion(await load("VERSION", dir));
  const [sums, changelog, ...docs] = await Promise.all([
    checksums(version),
    load("CHANGELOG.md", dir),
    ...Object.keys(sections).map((f) => load(f, dir)),
  ]);
  const fill = (text) => {
    let out = text.replaceAll("@@VERSION@@", version);
    for (const arch of arches) out = out.replaceAll(`@@SHA256_${arch}@@`, sums[arch]);
    return out;
  };
  let docsPage = await Bun.file(join(root, "docs.html")).text();
  Object.values(sections).forEach((sec, i) => {
    const { html, nav } = renderSection(docs[i], sec);
    docsPage = docsPage.replace(`<!-- @@${sec.marker}@@ -->`, html);
    if (sec.id === "configuration") docsPage = docsPage.replace("<!-- @@CONFIG_NAV@@ -->", nav.join("\n      "));
  });

  const releasesPage = (await Bun.file(join(root, "releases.html")).text())
    .replace("<!-- @@RELEASE_NAV@@ -->", parseChangelog(changelog).map(({ version }) => `<a href="#v${version}">v${version}</a>`).join("\n      "))
    .replace("<!-- @@RELEASES@@ -->", renderReleases(changelog));

  const out = join(root, "dist");
  await rm(out, { recursive: true, force: true });
  await mkdir(out);
  await Promise.all([
    cp(join(root, "assets"), join(out, "assets"), { recursive: true }),
    cp(join(root, "demo.html"), join(out, "demo.html")),
    Bun.write(join(out, "docs.html"), fill(docsPage)),
    Bun.write(join(out, "releases.html"), releasesPage),
    Bun.write(join(out, "index.html"), fill(await Bun.file(join(root, "index.html")).text())),
    Bun.write(join(out, "install"), fill(await Bun.file(join(root, "install")).text())),
  ]);
  await minifyScripts(join(out, "assets", "js"));
  const left = (await Promise.all(["docs.html", "index.html", "install", "releases.html"].map((f) => Bun.file(join(out, f)).text())))
    .join("").match(/@@\w+@@/);
  if (left) throw new Error(`Unfilled placeholder: ${left[0]}`);
  console.log(`Built dist/ for mousr ${version}`);
}

if (import.meta.main) {
  const [flag, dir] = Bun.argv.slice(2);
  if (flag && (flag !== "--source" || !dir)) {
    console.error("Usage: bun build.js [--source PATH_TO_MOUSR_CHECKOUT]");
    process.exitCode = 1;
  } else await build({ dir }).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
