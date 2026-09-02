# Lab Publication Impact Widget

Summarises lab's publications by journal-quality tier (top 25% / top 50%)
using **domain-specific quartiles**, so an ageing journal is judged against
ageing journals and can count under a specified judgement criteria. 

Two files:

- `journal-impact-widget.html` — the widget that creates lab's impact
- `build-rankings.mjs` — turns SCImago's public data into `rankings.json`.

## How it works

1. **Papers in.** The widget reads  publications from lab page's DOM, from
   Crossref by ORCID, or from a DOI list.
2. **Journal + ISSN.** Each paper is resolved through the free
   [Crossref API](https://www.crossref.org/) (no key, works from the browser) to
   get its ISSN — the reliable key for matching (journal *names* vary too much).
3. **Quartile.** The ISSN is looked up in `rankings.json`, built from
   [SCImago Journal Rank](https://www.scimagojr.com/) (Scopus data). SCImago
   publishes a **separate quartile per subject category**, so `Q1 = top 25%` and
   `Q1+Q2 = top 50%` *within a field* come straight from the source.
4. **Domain.** You can list the SCImago categories that make up your field. When a
   journal spans several, the widget picks the strongest (or a priority order).

### Why use SCImago, and not "Impact Factor"

The Clarivate Journal Impact Factor is paywalled with no free/legal API, so it
can't drive a self-updating public widget. SCImago is free, reputable (Scopus-
based), downloadable, and — unlike a single IF number — already thresholded
*by domain*.

SCImago, (n.d.). SJR-SCImago Journal Country & Rank [Portal]. Retrieved (2026), from https://www.scimagojr.com

## Setup

### 1. Build the rankings file (needs Node 18+)

```bash
node build-rankings.mjs                 # latest year, neuro/behavioral/aging journals
# node build-rankings.mjs --year 2024   # a specific SCImago year
# node build-rankings.mjs --all         # every journal (larger file)
# node build-rankings.mjs --domain my-categories.json   # custom category list
# node build-rankings.mjs --file scimago-source.csv     # parse a local CSV, no download
```

It prints the domain categories it found (with journal counts) and flags any
configured category name it *didn't* find — use that to fix spelling against
SCImago's category filter. Output: `rankings.json`. Host it next to the widget.

> **SCImago is behind Cloudflare**, which 403s obvious bots and datacenter IPs —
> so the direct download usually fails on GitHub Actions (and sometimes locally).
> When it does: open **scimagojr.com → Journal Rankings → Download data** in a
> browser, save the file as `scimago-source.csv` in the repo root, and commit it.
> `build-rankings.mjs --file scimago-source.csv` then parses that instead, and the
> monthly workflow falls back to it automatically. Refresh the CSV once a year
> when SCImago publishes new data.

### 2. Configure the widget

Open `journal-impact-widget.html` and edit the `CONFIG` block:

| Setting | What to set |
|---|---|
| `source` | `"dom"`, `"crossref-author"`, or `"doi-list"` (leave `"sample"` only for previewing) |
| `domSelector` | for `"dom"`: the CSS selector of your publications container |
| `authorOrcid` | for `"crossref-author"`: the lab's ORCID iD |
| `rankingsUrl` | URL of your `rankings.json`, e.g. `"/rankings.json?v=2025"` |
| `domainCategories` | the SCImago categories that count as your field |
| `quartilePolicy` | `"best"` (recommended) or `"priority"` + `priorityOrder` |
| `thresholds` | the tiers to report (defaults to top 25% and top 50%) |
| `showJournalBadges` | `true` to show SCImago's per-journal SJR trend graph for each matched journal (collapsible, lazy-loaded from scimagojr.com) |

### 3. Embed

Same-origin hosting avoids CORS for `rankings.json`. Either paste the file's
contents into your template, or load it in an iframe:

```html
<iframe src="/widgets/journal-impact-widget.html" style="width:100%;border:0"
        title="Publication impact"></iframe>
```

## Staying current

- **New papers** appear automatically. With `source:"dom"` the widget re-reads
  whatever is on the page each load; with `source:"crossref-author"` it re-queries
  Crossref, so newly indexed papers show up on the next visit. Call
  `LabImpactWidget.reload()` to refresh without a full page reload.
- **Ranking changes** are handled by re-running `build-rankings.mjs` when SCImago
  updates (annually). Automate it, e.g. a yearly cron that rebuilds and redeploys:

  ```cron
  0 3 15 6 *  cd /srv/widgets && node build-rankings.mjs && cp rankings.json /var/www/widgets/
  ```

  Bump the `?v=` on `rankingsUrl` (or set a short cache header) so browsers pick
  up the new file.

## Adjusting the domain mapping

Because SCImago computes quartiles **per subject category**, every paper is judged
within its own field automatically — you do not need one bucket per domain. Just
list *every* category the lab publishes in (neuroscience, neurology, behavioral
neuroscience, immunology, aging, pharmacology, psychology, physiology, …) in
`domainCategories`. A behavioral paper is then scored against behavioral-neuroscience
journals, an immunology paper against immunology journals, and so on. "Top 25%"
always means top 25% of *that paper's* field.

`domainCategories` is also what makes "count ageing under neurology" work: a journal
like *Aging Cell* carries `Aging (Q1)`, `Cellular and Molecular Neuroscience (Q1)`,
`Immunology (Q1)`; listing any of those pulls it in. With `quartilePolicy:"best"`,
the strongest of your matching categories represents the journal. Switch to
`"priority"` to force, say, the clinical-neurology quartile whenever a journal has one.

Journals with no category in your domain either fall back to their overall best
quartile (`fallbackToBestQuartile:true`, shown tagged "overall") or are listed as
"outside domain."

### Breaking it out by domain (optional)

The combined view mixes all fields into one distribution. If you also want the split
by domain, define `CONFIG.domains` — an array of `{ name, categories }`. Each domain
is scored against **its own** categories, so the same neuroinflammation journal can
show as Q1 under "Neuroinflammation & immunology" and Q3 under "Neuroscience &
neurology." A paper whose journal spans several domains counts in each of them, so
per-domain totals can exceed your paper count (the widget notes this). Categories in
`domains` are merged into `domainCategories` automatically — no need to list them twice.
Leave `domains: []` for a single combined rollup.

## Limitations & notes

- **Coverage.** SCImago covers Scopus-indexed journals. Book chapters, most
  preprints, and non-indexed venues won't match and appear under "not ranked."
- **Name matching fallback.** In `dom` mode, papers without a DOI are matched by
  title text via Crossref search — usually right, occasionally wrong for very
  generic titles. DOIs (or ORCID) are far more reliable; prefer them.
- **ISSN edge cases.** A paper may carry the print or electronic ISSN; the build
  script indexes both, so either resolves.
- **Rate.** Crossref calls run at low concurrency, and resolved papers are cached
  in the browser (~30 days) so revisits are cheap.
- **Quartile ≠ paper quality.** This ranks the *journal*, not the article, and
  quartiles shift year to year. Present it as journal-tier context, not a verdict
  on individual work.
- **Attribution.** Keep the SCImago and Crossref credits the widget renders.
- **Journal badges.** With `showJournalBadges: true` the widget embeds SCImago's
  official per-journal trend image (`journal_img.php?id=<Sourceid>`), one per unique
  matched journal, in a collapsed section. Images load lazily straight from
  scimagojr.com and link back to the journal's SCImago page. The `Sourceid` comes
  from the same SCImago table `build-rankings.mjs` already downloads, so no extra
  data source is involved. Set the flag to `false` to keep everything self-hosted.

## How to deploy and use

### 1. Create the repo and push

With the [GitHub CLI](https://cli.github.com/):

```bash
cd lab-impact-widget
gh repo create lab-impact-widget --public --source=. --remote=origin --push
```

Without the CLI — create an empty repo at github.com/new (no README), then:

```bash
cd lab-impact-widget
git init -b main
git add .
git commit -m "Initial commit: lab publication impact widget"
git remote add origin https://github.com/USER/lab-impact-widget.git
git push -u origin main
```

Use `--private` (or a private repo) if you'd rather share by adding collaborators
than publish openly. Everything after this is `git add` / `git commit` / `git push`
as usual, so every change is tracked and diffable.

### 2. Generate the first real rankings.json

The repo ships with the widget's built-in sample data. Create the real file once
(needs network to scimagojr.com), commit it, and the widget goes live:

```bash
npm run build            # == node build-rankings.mjs  -> rankings.json
git add rankings.json && git commit -m "Add SCImago rankings" && git push
```

(Or skip this and trigger the Action in step 4 — it will generate and commit it.)

### 3. Host it free on GitHub Pages

Settings → Pages → Source: **Deploy from a branch** → `main` / `/ (root)`. Your
files are then served at `https://USER.github.io/lab-impact-widget/`.

Point the widget at the co-hosted rankings file — in `CONFIG`, set:

```js
rankingsUrl: "rankings.json",   // relative → same origin as the widget, no CORS
```

You can embed it on lab site with an iframe (keeps the widget and rankings.json on
the same origin, so the fetch just works):

```html
<iframe src="https://USER.github.io/lab-impact-widget/journal-impact-widget.html"
        style="width:100%;max-width:780px;border:0;height:900px" title="Publication impact"></iframe>
```

Prefer to serve from your own web server instead? Copy `journal-impact-widget.html`
and `rankings.json`

### 4. Keep rankings current automatically

`.github/workflows/update-rankings.yml` rebuilds `rankings.json` from SCImago and
commits it back whenever the data changes. It runs monthly (a no-op unless SCImago
updated) and has a **Run workflow** button in the Actions tab for a manual refresh.
Because Pages serves straight from the branch, a new commit is live immediately —
no redeploy step. This replaces the local cron from the earlier section.

> First run: open the **Actions** tab, pick *Update SCImago rankings*, and click
> **Run workflow** to generate `rankings.json` if you skipped step 2. If the push
> fails with a permissions error, enable Settings → Actions → General → Workflow
> permissions → **Read and write permissions**.

### What's tracked in the repo

```
journal-impact-widget.html   the widget
build-rankings.mjs           SCImago -> rankings.json converter
rankings.json                generated data (served + auto-updated)
package.json  .gitignore  LICENSE  README.md
.github/workflows/update-rankings.yml
```

The MIT `LICENSE` covers the code; the SCImago data it fetches has its own
non-commercial + attribution terms (see the note in `LICENSE`).
