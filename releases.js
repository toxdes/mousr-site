const versionPattern = "[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-zA-Z0-9.-]+)?";
const releaseHeading = new RegExp(`^## (${versionPattern}) - (\\d{4}-\\d{2}-\\d{2})$`);

export function parseChangelog(markdown) {
  if (!markdown.replaceAll("\r\n", "\n").startsWith("# Changelog\n")) {
    throw new Error("Changelog must start with # Changelog");
  }
  const releases = [];
  const versions = new Set();
  let current = null;
  let fence = null;
  for (const line of markdown.replaceAll("\r\n", "\n").split("\n").slice(1)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (current) current.lines.push(line);
      if (
        marker && marker[1][0] === fence[0] &&
        marker[1].length >= fence.length && line.trim() === marker[1]
      ) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      if (current) current.lines.push(line);
      continue;
    }
    if (line.startsWith("## ")) {
      if (line === "## Unreleased") {
        current = null;
        continue;
      }
      const match = line.match(releaseHeading);
      if (!match) throw new Error(`Invalid changelog heading: ${line}`);
      const [, version, date] = match;
      const timestamp = new Date(`${date}T00:00:00Z`);
      if (
        !Number.isFinite(timestamp.getTime()) ||
        timestamp.toISOString().slice(0, 10) !== date
      ) {
        throw new Error(`Invalid release date: ${date}`);
      }
      if (versions.has(version)) throw new Error(`Duplicate release: ${version}`);
      versions.add(version);
      current = { version, date, lines: [] };
      releases.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (fence) throw new Error("Unclosed code fence in changelog");
  if (!releases.length) throw new Error("Changelog has no released versions");
  return releases.map(({ lines, ...release }) => {
    const body = lines.join("\n").trim();
    if (!body) throw new Error(`Release ${release.version} has no notes`);
    return { ...release, body };
  });
}

export function renderReleases(markdown) {
  if (markdown === null) return "<p>No release notes published yet.</p>";
  const dates = new Intl.DateTimeFormat("en", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
  return parseChangelog(markdown).map(({ version, date, body }) => `
<section class="release-entry" aria-labelledby="v${version}">
  <h2 id="v${version}"><a href="#v${version}">v${version}</a></h2>
  <time datetime="${date}">${dates.format(new Date(`${date}T00:00:00Z`))}</time>
  ${Bun.markdown.html(body)}
</section>`).join("\n");
}
