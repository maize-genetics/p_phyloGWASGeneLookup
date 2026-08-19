# Poaceae Gene Lookup

A static dashboard for looking up a maize, rice, sorghum, or wheat gene against the results of
[p_phyloGWAS](https://github.com/maize-genetics/p_phyloGWAS) — a comparative-genomics pipeline
testing which orthogroups (OGs) across 32 representative Poaceae genomes associate with climate
variables, show signatures of selection under those conditions, and have supporting differential
expression evidence.

Paste in a gene ID and see, for its orthogroup:
- whether gene presence/absence is significantly associated with any of three climate PCs (stage 08);
- whether the orthogroup shows relaxed or intensified selection under cold/warm conditions
  genome-wide, or under drought/wet/sand/clay conditions if it was already a climate-association
  candidate (stage 09, RELAX);
- whether it has consistent differential-expression evidence for cold, heat, drought, or
  waterlogging stress across independent studies (stage 10).

No installation needed — this is a plain static site. See it live at:
https://maize-genetics.github.io/p_phyloGWASGeneLookup/

## Supported gene ID formats

| Species | Annotation | Example |
|---|---|---|
| Maize | v5 (Zm00001eb) | `Zm00001eb290590` or `Zm00001eb290590_T001` |
| Rice | IRGSP-1.0 | `Os05t0477600-01` |
| Sorghum | v3 (Phytozome 454 v3.1.1) | `Sobic.001G047200` |
| Wheat | v2 (IWGSC RefSeq v2.1) | `TraesCS2B03G0760300` |

Transcript suffixes are optional — searching with or without them resolves to the same gene.

**Sorghum v5 gene IDs are not supported yet.** No gene-ID-to-orthogroup mapping exists for
sorghum v5 anywhere in the source pipeline (only the v3/Phytozome 454 annotation was cross-mapped
via miniprot) — only v3 IDs (`Sobic.…`) resolve today.

## How results are computed

See [`build/README.md`](build/README.md) for the exact p_phyloGWAS source files, and
p_phyloGWAS's own `WORKFLOW.md`/`DATA.md` for full pipeline methodology. A few things worth
knowing when reading a result:

- All test results are per-**orthogroup**, not per-gene — a search resolves your gene ID to its
  orthogroup, and the result reflects that orthogroup as a whole (across all 32 representative
  genomes), not just the species/gene you searched.
- The four RELAX conditions **drought/wet/sand/clay** are only run on orthogroups that were
  already significant in the stage 08 climate-association test for envPC2/envPC3 — an orthogroup
  with no result there wasn't randomly skipped, it means the climate-association test didn't flag
  it as a candidate for that trait. **cold/warm**, in contrast, are run genome-wide.
- Differential-expression evidence is binary (present/absent per stress category across >2
  independent study/species pairs), not a p-value.
- Significance badges use p < 0.001 as **significant**, 0.001 ≤ p < 0.05 as **marginal**, and
  p ≥ 0.05 as **not significant** — applied consistently to climate association and RELAX
  results. The raw p-value is shown alongside the badge on the single-gene detail view; batch
  search results show only the badge (and, for RELAX, a significant/tested count) to stay
  scannable — click through to an OG for the exact numbers.

## Rebuilding the data

The dashboard's data (`data/geneIndex.json`, `data/ogResults.json`) is a static snapshot built
from a local p_phyloGWAS checkout. See [`build/README.md`](build/README.md) to regenerate it.

## Provenance

This is a companion tool to [p_phyloGWAS](https://github.com/maize-genetics/p_phyloGWAS), which
holds the full analysis pipeline and reproducibility documentation. This repo only vendors a
prebuilt, read-only snapshot of its per-orthogroup results for lookup purposes.
