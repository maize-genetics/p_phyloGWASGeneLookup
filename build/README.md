# Rebuilding the dashboard data

`buildData.py` reads directly from a local [p_phyloGWAS](https://github.com/maize-genetics/p_phyloGWAS)
checkout and writes `data/geneIndex.json` and `data/ogResults.json`. Rerun it whenever the
referenced pipeline outputs change.

```
python3 build/buildData.py --phylogwas-root /path/to/p_phyloGWAS
```

Defaults to `../p_phyloGWAS` relative to this repo if `--phylogwas-root` is omitted.

## Source files (all paths relative to the p_phyloGWAS checkout)

| Data | Path | Notes |
|---|---|---|
| Gene ID → orthogroup (OG) mapping, maize v5 | `data/DEG_mappingFiles/OG_mapping_Zea_mays_v5_mrna.txt` | |
| Gene ID → OG mapping, rice IRGSP-1.0 | `data/DEG_mappingFiles/OG_mapping_Oryza_sativa.IRGSP-1.0.cds.all.txt` | |
| Gene ID → OG mapping, sorghum v3 | `data/DEG_mappingFiles/OG_mapping_Sbicolor_454_v3.1.1.cds_primaryTranscriptOnly.txt` | No sorghum v5 mapping exists in the source pipeline yet — see the top-level README. |
| Gene ID → OG mapping, wheat v2 | `data/DEG_mappingFiles/OG_mapping_Triticum_aestivum_refseqv2.IWGSC_RefSeq_v2.1.cds.all.txt` | |
| Climate association results (stage 08) | `output/finalModels_20251002/envPC_{1,2,3}/ASREML_res_empPadded_homologAdded.txt` | Per-OG phylogenetic mixed-model test of gene presence/absence against each climate PC. Only the overall likelihood-ratio test's `p`/`emp_p` are used — the dashboard shows model significance only, not the underlying term coefficients (`partialCoeff_PAV` and its `PAV:x` interaction terms with dN/dS, ESM2, PlantCAD, premature-stop status, all present in the source file but not extracted here). |
| Molecular evolution results (stage 09) | `output/RELAX_resultTable_{cold,warm,drought,wet,sand,clay}_20251117.txt` | `cold`/`warm` are run genome-wide; `drought`/`wet`/`sand`/`clay` are only run on OGs already significant in the stage 08 test for envPC2/envPC3 (see `output/candidateOG_envPC2.txt` / `candidateOG_envPC3.txt`, also read by the build script for gating metadata). |
| Differential expression evidence (stage 10) | `output/candidateGenes/consistentEnvResponsiveGenes.json` | Binary membership only (no p-value): an OG is listed if DE in >2 independent study/species pairs for that stress category. |
| Curated high-confidence candidates | `output/finalCandidateOGs_summary.txt` | The paper's 27 headline OGs — used only to add a badge, not as a primary data source. |

All four gene-ID mapping files share the same OG numbering as p_phyloGWAS's OrthoFinder run
(`output/OrthoFinder/Results_Jun06/Orthogroups/Orthogroups.tsv`), verified by spot-checking that
identical OG IDs line up across all four files for the same rows.
