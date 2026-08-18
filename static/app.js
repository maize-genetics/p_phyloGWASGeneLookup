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
// The stage 08 model has no independent main effects for these — each only enters as a
// PAV:x interaction term, i.e. a modifier of the presence/absence effect, not a separate
// predictor. A significant interaction means the PAV direction shown above isn't the whole
// story for that OG.
const INTERACTION_TERMS = [
  { key: "dNdS", label: "dN/dS" },
  { key: "ESM2", label: "ESM2" },
  { key: "plantCad", label: "PlantCAD" },
  { key: "PMS", label: "Premature stop" },
];

let geneIndex = null;
let ogResults = null;

const resultEl = document.getElementById("result");
const form = document.getElementById("search-form");
const input = document.getElementById("gene-input");
const browseBtn = document.getElementById("browse-candidates-btn");

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
  return p < 0.05
    ? '<span class="badge sig">significant</span>'
    : '<span class="badge notsig">not significant</span>';
}

function directionFromCoeffSign(direction) {
  if (direction === "+") return '<span class="direction up">&#9650; higher</span>';
  if (direction === "-") return '<span class="direction down">&#9660; lower</span>';
  return '<span class="direction none">—</span>';
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
    const value = ids.length ? ids.map(escapeHtml).join(", ") : "no ortholog in this orthogroup";
    return `<span>${SPECIES_LABELS[sp]}: <strong>${value}</strong></span>`;
  });
  return `<div class="gene-id-list">${items.join("")}</div>`;
}

// Builds a plain-language summary of what this OG's climate-association result actually
// means, since the raw PAV coefficient alone can be misleading (see interpretEnvAssociation
// notes below and the model formula in build/README.md).
function interpretEnvAssociation(pc, r) {
  const displayP = r.emp_p !== null && r.emp_p !== undefined ? r.emp_p : r.p;
  if (displayP === null || displayP === undefined || displayP >= 0.05) {
    return `No significant association with ${pc} detected for this orthogroup.`;
  }

  const dirWord = r.direction === "+" ? "higher" : r.direction === "-" ? "lower" : null;
  const mainSig = r.coeffP !== null && r.coeffP !== undefined && r.coeffP < 0.05;
  const sigInteractions = INTERACTION_TERMS
    .map(({ key, label }) => ({ key, label, ...((r.interactions && r.interactions[key]) || {}) }))
    .filter((t) => t.p !== null && t.p !== undefined && t.p < 0.05 && t.coeff !== null && t.coeff !== undefined);

  const clauseFor = (t) => {
    if (r.coeff === null || r.coeff === undefined) return `${t.label} (p = ${fmtP(t.p)})`;
    const reinforcing = Math.sign(t.coeff) === Math.sign(r.coeff);
    const verb = reinforcing ? "strengthens" : "weakens";
    if (t.key === "PMS") return `a premature stop in the present copy ${verb} that effect`;
    return `a higher-than-average ${t.label} score ${verb} that effect`;
  };

  if (!dirWord) {
    return sigInteractions.length
      ? `The overall model is significant, but the plain presence/absence direction couldn't be estimated for this OG. The significant driver${sigInteractions.length > 1 ? "s are" : " is"} ${sigInteractions.map(clauseFor).join(" and ")}.`
      : `Significant overall association with ${pc}, but no single term reaches significance on its own.`;
  }
  if (mainSig && sigInteractions.length === 0) {
    return `Gene presence is significantly associated with ${dirWord} ${pc} on its own, independent of dN/dS, ESM2, PlantCAD, or premature-stop status.`;
  }
  if (mainSig && sigInteractions.length > 0) {
    return `Gene presence is significantly associated with ${dirWord} ${pc}, and this effect is further modulated: ${sigInteractions.map(clauseFor).join("; ")}.`;
  }
  if (!mainSig && sigInteractions.length > 0) {
    return `Presence/absence alone isn't a significant predictor here (p = ${fmtP(r.coeffP)}) — the significant association with ${pc} comes mainly from how it interacts with sequence-quality features: ${sigInteractions.map(clauseFor).join("; ")}.`;
  }
  return `The overall model is significant, but no single term (presence, dN/dS, ESM2, PlantCAD, or premature-stop) reaches significance on its own — this may reflect a combination of small effects rather than one dominant driver.`;
}

function renderInteractionDetail(pc, interactions) {
  const rows = INTERACTION_TERMS.map(({ key, label }) => {
    const t = (interactions && interactions[key]) || {};
    return `<tr>
      <td>PAV &times; ${label}</td>
      <td>${t.coeff === null || t.coeff === undefined ? "—" : t.coeff.toFixed(4)}</td>
      <td>${fmtP(t.p)}</td>
      <td>${sigBadge(t.p)}</td>
    </tr>`;
  }).join("");
  return `<div class="interaction-detail" id="interaction-detail-${pc}" hidden>
    <table class="test-table nested">
      <thead><tr><th>Interaction term</th><th>coefficient</th><th>p</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderEnvAssociation(entry) {
  const env = entry.envAssociation || {};
  const blocks = ENV_PCS.map((pc) => {
    const r = env[pc];
    if (!r) {
      return `<div class="envpc-row">
        <div class="envpc-head"><strong>${pc}</strong></div>
        <p class="gated-note" style="margin:0.3rem 0 0">not tested — this OG was excluded from the stage 08 association test (e.g. too few informative taxa)</p>
      </div>`;
    }
    const displayP = r.emp_p !== null && r.emp_p !== undefined ? r.emp_p : r.p;
    const empStat = r.emp_p === null || r.emp_p === undefined ? "" : `, empirical p = ${fmtP(r.emp_p)}`;
    return `<div class="envpc-row">
      <div class="envpc-head">
        <strong>${pc}</strong>
        ${sigBadge(displayP)}
        ${directionFromCoeffSign(r.direction)}
        <span class="stat-note">p = ${fmtP(r.p)}${empStat}</span>
      </div>
      <p class="interpretation">${escapeHtml(interpretEnvAssociation(pc, r))}</p>
      <button type="button" class="link-button toggle-btn" data-toggle="interaction-detail-${pc}">Show interaction details</button>
      ${renderInteractionDetail(pc, r.interactions)}
    </div>`;
  }).join("");
  return `<div class="result-section">
    <h3>Climate association (stage 08)</h3>
    ${blocks}
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
  resultEl.innerHTML = `
    <div class="result-card">
      <p class="back-link"><button type="button" class="link-button" id="back-to-list-btn">&larr; All high-confidence candidates</button></p>
      <h2>${og}${badge}</h2>
      ${renderGeneIdList(entry.genes)}
      ${renderEnvAssociation(entry)}
      ${renderMolecularEvolution(entry)}
      ${renderDeEvidence(entry)}
    </div>`;
  document.getElementById("back-to-list-btn").addEventListener("click", renderCandidateList);
  resultEl.querySelectorAll(".toggle-btn[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.toggle);
      if (target) target.hidden = !target.hidden;
    });
  });
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
    const maize = ((entry.genes && entry.genes.maize_v5) || []).join(", ") || "—";
    const rice = ((entry.genes && entry.genes["rice_IRGSP1.0"]) || []).join(", ") || "—";
    const de = hc.aprioriDEConditions.length ? hc.aprioriDEConditions.join(", ") : "—";
    return `<tr>
      <td><button type="button" class="link-button" data-og="${escapeHtml(og)}">${escapeHtml(og)}</button></td>
      <td>${escapeHtml(hc.envPC)}</td>
      <td class="mono">${escapeHtml(maize)}</td>
      <td class="mono">${escapeHtml(rice)}</td>
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
    btn.addEventListener("click", () => renderResultCard(btn.dataset.og));
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

function lookup(rawInput) {
  const value = rawInput.trim();
  if (!value) {
    showMessage("Enter a gene ID to look it up.");
    return;
  }
  const key = value.toLowerCase();
  const matches = geneIndex[key];
  if (!matches || matches.length === 0) {
    const looksValid = SPECIES_FORMAT_HINTS.some((f) => f.re.test(value));
    if (!looksValid) {
      const examples = SPECIES_FORMAT_HINTS.map((f) => f.label).join(", ");
      showMessage(
        `“${escapeHtml(value)}” doesn't look like a maize v5, rice IRGSP-1.0, sorghum v3, or wheat v2 gene ID. Supported formats: ${examples}.`,
        true
      );
    } else {
      showMessage(
        `No match for “${escapeHtml(value)}”. Check the ID and annotation version — this tool doesn't (yet) translate between gene ID versions.`,
        true
      );
    }
    return;
  }
  const uniqueOGs = [...new Set(matches.map((m) => m.og))];
  if (uniqueOGs.length === 1) {
    renderResultCard(uniqueOGs[0]);
  } else {
    renderMatchPicker(matches);
  }
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

loadData().catch((err) => {
  showMessage(`Failed to load gene data: ${escapeHtml(err.message)}`, true);
});
