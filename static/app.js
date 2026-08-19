const SPECIES_ORDER = ["maize_v5", "rice_IRGSP1.0", "sorghum_v3", "wheat_v2"];
const SPECIES_LABELS = {
  maize_v5: "Maize v5",
  "rice_IRGSP1.0": "Rice IRGSP-1.0",
  sorghum_v3: "Sorghum v3",
  wheat_v2: "Wheat v2",
};
const SPECIES_FORMAT_HINTS = [
  { label: "Maize v5", re: /^zm00001eb\d/i },
  { label: "Rice IRGSP-1.0", re: /^os\d+t\d/i },
  { label: "Sorghum v3", re: /^sobic\./i },
  { label: "Wheat v2", re: /^traescs/i },
];
const ENV_PCS = ["envPC1", "envPC2", "envPC3"];
const RELAX_CONDITIONS = [
  { key: "cold", label: "Cold vs. background", gate: "genomeWide" },
  { key: "warm", label: "Warm vs. background", gate: "genomeWide" },
  { key: "drought", label: "Drought vs. background", gate: "envPC2" },
  { key: "wet", label: "Wet vs. background", gate: "envPC2" },
  { key: "sand", label: "Sandy soil vs. background", gate: "envPC3" },
  { key: "clay", label: "Clay soil vs. background", gate: "envPC3" },
];
const DE_CATEGORIES = ["cold", "heat", "drought", "waterlogging"];

// External gene-page builders, verified directly against real IDs from this dataset:
// - Maize: MaizeGDB's gene_center takes the base gene ID (no transcript suffix).
// - Rice: Gramene/Ensembl Plants resolves our exact Os...t...-NN transcript ID directly.
// - Sorghum: our Phytozome-style Sobic.* IDs aren't recognized by Ensembl's direct gene
//   lookup, only as a synonym via its search — so this links to a search-results page,
//   not a gene page directly.
// - Wheat: Ensembl Plants hosts wheat under a version-specific site — our IWGSC RefSeq v2.1
//   IDs only resolve on "Triticum_aestivum_refseqv2", not the default "Triticum_aestivum"
//   (which is an older annotation and doesn't recognize these IDs at all).
const EXTERNAL_LINK_BUILDERS = {
  maize_v5: (id) => `https://maizegdb.org/gene_center/gene/${encodeURIComponent(id.replace(/_T\d+$/, ""))}`,
  "rice_IRGSP1.0": (id) => `https://ensembl.gramene.org/Oryza_sativa/Gene/Summary?g=${encodeURIComponent(id)}`,
  sorghum_v3: (id) => `https://ensembl.gramene.org/Multi/Search/Results?q=${encodeURIComponent(id.replace(/\.\d+$/, ""))};site=ensembl_all`,
  wheat_v2: (id) => `https://ensembl.gramene.org/Triticum_aestivum_refseqv2/Gene/Summary?g=${encodeURIComponent(id.replace(/\.\d+$/, ""))}`,
};

function geneLinkHtml(species, id, displayText) {
  const label = escapeHtml(displayText === undefined ? id : displayText);
  const build = EXTERNAL_LINK_BUILDERS[species];
  if (!build) return label;
  return `<a href="${build(id)}" target="_blank" rel="noopener">${label}</a>`;
}

let geneIndex = null;
let ogResults = null;
// What "back" returns to from a single OG detail view — null when there's nothing to go
// back to (e.g. arrived via a direct single-gene search).
let backTarget = null;

const resultEl = document.getElementById("result");
const form = document.getElementById("search-form");
const input = document.getElementById("gene-input");
const browseBtn = document.getElementById("browse-candidates-btn");
const batchToggleBtn = document.getElementById("batch-toggle-btn");
const batchPanel = document.getElementById("batch-panel");
const batchInput = document.getElementById("batch-input");
const batchSubmitBtn = document.getElementById("batch-submit-btn");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtP(p) {
  if (p === null || p === undefined) return "—";
  if (p === 0) return "0";
  if (p < 0.0001) return p.toExponential(2);
  return p.toFixed(4);
}

function sigBadge(p) {
  if (p === null || p === undefined) return '<span class="badge notsig">not tested</span>';
  if (p < 0.001) return '<span class="badge sig">significant</span>';
  if (p < 0.05) return '<span class="badge marginal">marginal</span>';
  return '<span class="badge notsig">not significant</span>';
}

function isSignificant(p) {
  return p !== null && p !== undefined && p < 0.001;
}

function directionFromK(k) {
  if (k === null || k === undefined) return '<span class="direction none">—</span>';
  if (k < 1) return '<span class="direction down">&#9660; relaxed</span>';
  if (k > 1) return '<span class="direction up">&#9650; intensified</span>';
  return '<span class="direction none">neutral</span>';
}

function renderGeneIdList(genes) {
  const items = SPECIES_ORDER.map((sp) => {
    const ids = (genes && genes[sp]) || [];
    const value = ids.length ? ids.map((id) => geneLinkHtml(sp, id)).join(", ") : "no ortholog in this orthogroup";
    return `<span>${SPECIES_LABELS[sp]}: <strong>${value}</strong></span>`;
  });
  return `<div class="gene-id-list">${items.join("")}</div>`;
}

function renderEnvAssociation(entry) {
  const env = entry.envAssociation || {};
  const rows = ENV_PCS.map((pc) => {
    const r = env[pc];
    if (!r) {
      return `<div class="envpc-simple"><span class="envpc-label">${pc}</span><span class="gated-note">not tested</span></div>`;
    }
    const displayP = r.emp_p !== null && r.emp_p !== undefined ? r.emp_p : r.p;
    const empPart = r.emp_p === null || r.emp_p === undefined ? "" : `, empirical p = ${fmtP(r.emp_p)}`;
    return `<div class="envpc-simple">
      <span class="envpc-label">${pc}</span>
      ${sigBadge(displayP)}
      <span class="stat-note">p = ${fmtP(r.p)}${empPart}</span>
    </div>`;
  }).join("");
  return `<div class="result-section">
    <h3>Climate association (stage 08)</h3>
    <div class="envpc-list">${rows}</div>
  </div>`;
}

function renderMolecularEvolution(entry) {
  const relax = entry.molecularEvolution || {};
  const gating = entry.relaxGating || { inGenomeWideUniverse: false, envPC2Candidate: false, envPC3Candidate: false };
  const rows = RELAX_CONDITIONS.map(({ key, label, gate }) => {
    const r = relax[key];
    if (r) {
      return `<tr>
        <td>${label}</td>
        <td>${fmtP(r.p)}</td>
        <td>${sigBadge(r.p)}</td>
        <td>${r.k === null || r.k === undefined ? "—" : r.k.toFixed(3)}</td>
        <td>${directionFromK(r.k)}</td>
      </tr>`;
    }
    let note;
    if (gate === "genomeWide") {
      note = gating.inGenomeWideUniverse
        ? "tested but no result recovered"
        : "not in the RELAX-analyzable orthogroup set (e.g. too few taxa for a reliable gene tree)";
    } else {
      const pcLabel = gate === "envPC2" ? "envPC2" : "envPC3";
      const isCandidate = gate === "envPC2" ? gating.envPC2Candidate : gating.envPC3Candidate;
      note = isCandidate
        ? "candidate for this test but no RELAX result recovered"
        : `not tested — this OG wasn't significant in the ${pcLabel} climate-association test`;
    }
    return `<tr><td>${label}</td><td colspan="4" class="gated-note">${note}</td></tr>`;
  }).join("");
  return `<div class="result-section">
    <h3>Molecular evolution — RELAX (stage 09)</h3>
    <table class="test-table">
      <thead><tr><th>Condition</th><th>p</th><th></th><th>k</th><th>selection direction</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderDeEvidence(entry) {
  const de = entry.deEvidence || {};
  const chips = DE_CATEGORIES.map((cat) => {
    const present = !!de[cat];
    return `<span class="chip${present ? " present" : ""}">${cat}${present ? " ✓" : ""}</span>`;
  }).join("");
  return `<div class="result-section">
    <h3>Differential expression evidence (stage 10)</h3>
    <p class="gated-note" style="margin-top:0">Consistent across &gt;2 independent study/species pairs for that stress category.</p>
    <div class="de-chips">${chips}</div>
  </div>`;
}

function renderResultCard(og) {
  const entry = ogResults[og] || {};
  const highconf = entry.highConfidenceCandidate;
  const badge = highconf
    ? `<span class="highconf-badge">High-confidence candidate — ${escapeHtml(highconf.envPC)}</span>`
    : "";
  const backLink = backTarget
    ? `<p class="back-link"><button type="button" class="link-button" id="back-to-list-btn">&larr; Back to results</button></p>`
    : "";
  resultEl.innerHTML = `
    <div class="result-card">
      ${backLink}
      <h2>${og}${badge}</h2>
      ${renderGeneIdList(entry.genes)}
      ${renderEnvAssociation(entry)}
      ${renderMolecularEvolution(entry)}
      ${renderDeEvidence(entry)}
    </div>`;
  if (backTarget) {
    document.getElementById("back-to-list-btn").addEventListener("click", () => backTarget());
  }
}

function renderCandidateList() {
  const rows = Object.entries(ogResults)
    .filter(([, entry]) => entry.highConfidenceCandidate)
    .map(([og, entry]) => ({ og, entry }))
    .sort((a, b) => {
      const pcA = a.entry.highConfidenceCandidate.envPC;
      const pcB = b.entry.highConfidenceCandidate.envPC;
      if (pcA !== pcB) return pcA.localeCompare(pcB);
      const pA = (a.entry.envAssociation && a.entry.envAssociation[pcA] && a.entry.envAssociation[pcA].p);
      const pB = (b.entry.envAssociation && b.entry.envAssociation[pcB] && b.entry.envAssociation[pcB].p);
      return (pA ?? 1) - (pB ?? 1);
    });

  const body = rows.map(({ og, entry }) => {
    const hc = entry.highConfidenceCandidate;
    const env = (entry.envAssociation && entry.envAssociation[hc.envPC]) || {};
    const maizeIds = (entry.genes && entry.genes.maize_v5) || [];
    const riceIds = (entry.genes && entry.genes["rice_IRGSP1.0"]) || [];
    const maize = maizeIds.length ? maizeIds.map((id) => geneLinkHtml("maize_v5", id)).join(", ") : "—";
    const rice = riceIds.length ? riceIds.map((id) => geneLinkHtml("rice_IRGSP1.0", id)).join(", ") : "—";
    const de = hc.aprioriDEConditions.length ? hc.aprioriDEConditions.join(", ") : "—";
    return `<tr>
      <td><button type="button" class="link-button" data-og="${escapeHtml(og)}">${escapeHtml(og)}</button></td>
      <td>${escapeHtml(hc.envPC)}</td>
      <td class="mono">${maize}</td>
      <td class="mono">${rice}</td>
      <td>${fmtP(env.p)}</td>
      <td>${escapeHtml(de)}</td>
    </tr>`;
  }).join("");

  resultEl.innerHTML = `
    <div class="result-card">
      <h2>All high-confidence candidates <span class="highconf-badge">${rows.length}</span></h2>
      <p class="gated-note" style="margin-top:0">The paper's headline orthogroups — significant in the stage 08
        climate-association test, with supporting RELAX and DE evidence. Click an OG for full details.</p>
      <div class="table-scroll">
        <table class="test-table">
          <thead><tr><th>OG</th><th>Trait</th><th>Maize ID</th><th>Rice ID</th><th>phylo-association p-value</th><th>DE evidence</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
  resultEl.querySelectorAll("button[data-og]").forEach((btn) => {
    btn.addEventListener("click", () => {
      backTarget = renderCandidateList;
      renderResultCard(btn.dataset.og);
    });
  });
}

function renderMatchPicker(matches) {
  const items = matches.map(
    (m, i) => `<li><button type="button" data-idx="${i}">${escapeHtml(m.id)} (${SPECIES_LABELS[m.species]}) → ${m.og}</button></li>`
  ).join("");
  resultEl.innerHTML = `
    <div class="state-message">
      This ID matches multiple orthogroup entries (likely different transcripts/paralogs). Pick one:
      <ul class="match-picker">${items}</ul>
    </div>`;
  resultEl.querySelectorAll(".match-picker button").forEach((btn, i) => {
    btn.addEventListener("click", () => renderResultCard(matches[i].og));
  });
}

function showMessage(html, isError) {
  resultEl.innerHTML = `<div class="state-message${isError ? " error" : ""}">${html}</div>`;
}

// Shared by single and batch search: normalizes one raw ID and classifies it as
// empty / unrecognized (doesn't look like any supported species' ID) / not_found
// (plausible format, no match) / found (with its resolved OG(s)).
function resolveGeneId(rawValue) {
  const value = rawValue.trim();
  if (!value) return { status: "empty", value };
  const matches = geneIndex[value.toLowerCase()];
  if (!matches || matches.length === 0) {
    const looksValid = SPECIES_FORMAT_HINTS.some((f) => f.re.test(value));
    return { status: looksValid ? "not_found" : "unrecognized", value };
  }
  return { status: "found", value, matches, uniqueOGs: [...new Set(matches.map((m) => m.og))] };
}

function lookup(rawInput) {
  const r = resolveGeneId(rawInput);
  if (r.status === "empty") {
    showMessage("Enter a gene ID to look it up.");
    return;
  }
  if (r.status === "unrecognized") {
    const examples = SPECIES_FORMAT_HINTS.map((f) => f.label).join(", ");
    showMessage(
      `“${escapeHtml(r.value)}” doesn't look like a maize v5, rice IRGSP-1.0, sorghum v3, or wheat v2 gene ID. Supported formats: ${examples}.`,
      true
    );
    return;
  }
  if (r.status === "not_found") {
    showMessage(
      `No match for “${escapeHtml(r.value)}”. Check the ID and annotation version — this tool doesn't (yet) translate between gene ID versions.`,
      true
    );
    return;
  }
  backTarget = null;
  if (r.uniqueOGs.length === 1) {
    renderResultCard(r.uniqueOGs[0]);
  } else {
    renderMatchPicker(r.matches);
  }
}

function renderBatchResults(rawText) {
  const rawIds = rawText.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!rawIds.length) {
    showMessage("Paste one or more gene IDs (one per line, or separated by commas/spaces).");
    return;
  }

  const envCell = (env, pc) => {
    const e = env[pc];
    if (!e) return '<span class="badge notsig">not tested</span>';
    return sigBadge(e.emp_p !== null && e.emp_p !== undefined ? e.emp_p : e.p);
  };

  const relaxCell = (entry) => {
    const relax = entry.molecularEvolution || {};
    const tested = RELAX_CONDITIONS.filter(({ key }) => relax[key]);
    if (!tested.length) return '<span class="gated-note">not tested</span>';
    const sig = tested.filter(({ key }) => isSignificant(relax[key].p));
    const cls = sig.length ? "sig" : "notsig";
    return `<span class="badge ${cls}">${sig.length}/${tested.length} significant</span>`;
  };

  const deCell = (entry) => {
    const de = entry.deEvidence || {};
    const present = DE_CATEGORIES.filter((cat) => de[cat]);
    return present.length ? escapeHtml(present.join(", ")) : "—";
  };

  const rows = rawIds.map((raw) => {
    const r = resolveGeneId(raw);
    if (r.status !== "found") {
      const note = r.status === "unrecognized" ? "unrecognized format" : "no match";
      return `<tr><td class="mono">${escapeHtml(raw)}</td><td colspan="6" class="gated-note">${note}</td></tr>`;
    }
    return r.uniqueOGs.map((og) => {
      const entry = ogResults[og] || {};
      const env = entry.envAssociation || {};
      const match = r.matches.find((m) => m.og === og);
      const idCell = match ? geneLinkHtml(match.species, match.id, raw) : escapeHtml(raw);
      return `<tr>
        <td class="mono">${idCell}</td>
        <td><button type="button" class="link-button" data-og="${escapeHtml(og)}">${escapeHtml(og)}</button></td>
        <td>${envCell(env, "envPC1")}</td>
        <td>${envCell(env, "envPC2")}</td>
        <td>${envCell(env, "envPC3")}</td>
        <td>${relaxCell(entry)}</td>
        <td>${deCell(entry)}</td>
      </tr>`;
    }).join("");
  }).join("");

  resultEl.innerHTML = `
    <div class="result-card">
      <h2>Batch search results <span class="highconf-badge">${rawIds.length}</span></h2>
      <p class="gated-note" style="margin-top:0">RELAX = significant / tested conditions (out of cold, warm, and any
        gated drought/wet/sand/clay tests this OG qualified for). DE evidence = stress categories with consistent
        differential-expression support. Click an OG for full details.</p>
      <div class="table-scroll">
        <table class="test-table">
          <thead><tr><th>Gene ID (as entered)</th><th>OG</th><th>envPC1</th><th>envPC2</th><th>envPC3</th><th>RELAX</th><th>DE evidence</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  resultEl.querySelectorAll("button[data-og]").forEach((btn) => {
    btn.addEventListener("click", () => {
      backTarget = () => renderBatchResults(rawText);
      renderResultCard(btn.dataset.og);
    });
  });
}

async function loadData() {
  showMessage("Loading gene data…");
  const [idx, res] = await Promise.all([
    fetch("data/geneIndex.json").then((r) => r.json()),
    fetch("data/ogResults.json").then((r) => r.json()),
  ]);
  geneIndex = idx;
  ogResults = res;
  showMessage("Paste a gene ID above to look it up.");
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!geneIndex) {
    showMessage("Still loading gene data — try again in a moment.", true);
    return;
  }
  lookup(input.value);
});

browseBtn.addEventListener("click", () => {
  if (!ogResults) {
    showMessage("Still loading gene data — try again in a moment.", true);
    return;
  }
  renderCandidateList();
});

batchToggleBtn.addEventListener("click", () => {
  batchPanel.hidden = !batchPanel.hidden;
});

batchSubmitBtn.addEventListener("click", () => {
  if (!geneIndex) {
    showMessage("Still loading gene data — try again in a moment.", true);
    return;
  }
  renderBatchResults(batchInput.value);
});

document.querySelectorAll(".example-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    input.value = btn.dataset.example;
    if (!geneIndex) {
      showMessage("Still loading gene data — try again in a moment.", true);
      return;
    }
    lookup(input.value);
  });
});

loadData().catch((err) => {
  showMessage(`Failed to load gene data: ${escapeHtml(err.message)}`, true);
});
