#!/usr/bin/env python3
"""
Rebuilds data/geneIndex.json and data/ogResults.json for the gene lookup dashboard
from a local p_phyloGWAS checkout's output/ and data/ directories.

Usage:
    python3 build/buildData.py [--phylogwas-root /path/to/p_phyloGWAS]

Source files are listed in build/README.md. Rerun this whenever the referenced
p_phyloGWAS stage 08/09/10 outputs change.
"""
import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

# species_key -> (mapping file relative to PHYLOGWAS_ROOT, display label, transcript-suffix regex)
SPECIES = {
    "maize_v5": (
        "data/DEG_mappingFiles/OG_mapping_Zea_mays_v5_mrna.txt",
        "Maize v5 (Zm00001eb)",
        re.compile(r"_T\d+$"),
    ),
    "rice_IRGSP1.0": (
        "data/DEG_mappingFiles/OG_mapping_Oryza_sativa.IRGSP-1.0.cds.all.txt",
        "Rice IRGSP-1.0",
        re.compile(r"-\d+$"),
    ),
    "sorghum_v3": (
        "data/DEG_mappingFiles/OG_mapping_Sbicolor_454_v3.1.1.cds_primaryTranscriptOnly.txt",
        "Sorghum v3 (Phytozome 454 v3.1.1)",
        re.compile(r"\.\d+$"),
    ),
    "wheat_v2": (
        "data/DEG_mappingFiles/OG_mapping_Triticum_aestivum_refseqv2.IWGSC_RefSeq_v2.1.cds.all.txt",
        "Wheat v2 (IWGSC RefSeq v2.1)",
        re.compile(r"\.\d+$"),
    ),
}

ENV_PCS = ["envPC1", "envPC2", "envPC3"]
RELAX_CONDITIONS = ["cold", "warm", "drought", "wet", "sand", "clay"]
DE_CATEGORIES = ["cold", "heat", "drought", "waterlogging"]


def read_mapping_file(path):
    """Yields (geneID, OG) pairs from a two-column tab-separated file, no header."""
    with open(path, newline="") as fh:
        for row in csv.reader(fh, delimiter="\t"):
            if len(row) < 2 or not row[0] or not row[1]:
                continue
            yield row[0], row[1]


def parse_float(v):
    if v is None or v == "" or v == "NA":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def build(root: Path, out_dir: Path):
    root = root.resolve()
    genes_by_og = defaultdict(lambda: defaultdict(list))  # OG -> species -> [raw gene IDs]
    gene_index = defaultdict(list)  # normalized key -> [{"species", "og", "id"}]

    print("Reading gene-ID -> OG mapping files...")
    for species_key, (rel_path, _label, suffix_re) in SPECIES.items():
        path = root / rel_path
        count = 0
        for gene_id, og in read_mapping_file(path):
            genes_by_og[og][species_key].append(gene_id)
            entry = {"species": species_key, "og": og, "id": gene_id}
            raw_key = gene_id.lower()
            gene_index[raw_key].append(entry)
            base_id = suffix_re.sub("", gene_id)
            base_key = base_id.lower()
            if base_key != raw_key:
                gene_index[base_key].append(entry)
            count += 1
        print(f"  {species_key}: {count} rows from {rel_path}")

    # de-dup gene lists per OG/species, keep stable order
    for og in genes_by_og:
        for sp in genes_by_og[og]:
            genes_by_og[og][sp] = sorted(set(genes_by_og[og][sp]))

    print("Reading stage 08 envPC association results...")
    og_env = defaultdict(dict)  # OG -> envPCn -> {p, emp_p}
    for i in (1, 2, 3):
        path = root / f"output/finalModels_20251002/envPC_{i}/ASREML_res_empPadded_homologAdded.txt"
        with open(path, newline="") as fh:
            reader = csv.DictReader(fh, delimiter="\t")
            n = 0
            for row in reader:
                og = row["OG"]
                og_env[og][f"envPC{i}"] = {
                    "p": parse_float(row.get("p")),
                    "emp_p": parse_float(row.get("emp_p")),
                }
                n += 1
        print(f"  envPC{i}: {n} OGs from {path.relative_to(root)}")

    print("Reading stage 09 RELAX results...")
    og_relax = defaultdict(dict)  # OG -> condition -> {p, k, logp}
    relax_universe = set()  # OGs tested for cold/warm (the genome-wide RELAX-analyzable set)
    for cond in RELAX_CONDITIONS:
        path = root / f"output/RELAX_resultTable_{cond}_20251117.txt"
        with open(path, newline="") as fh:
            reader = csv.DictReader(fh, delimiter="\t")
            n = 0
            for row in reader:
                og = row["OG"]
                og_relax[og][cond] = {
                    "p": parse_float(row.get("p-value")),
                    "k": parse_float(row.get("k")),
                    "logp": parse_float(row.get("logp")),
                }
                if cond in ("cold", "warm"):
                    relax_universe.add(og)
                n += 1
        print(f"  {cond}: {n} OGs from {path.relative_to(root)}")

    print("Reading envPC2/envPC3 candidate gating lists...")
    envpc2_candidates = set(
        (root / "output/candidateOG_envPC2.txt").read_text().split()
    )
    envpc3_candidates = set(
        (root / "output/candidateOG_envPC3.txt").read_text().split()
    )
    print(f"  envPC2 candidates: {len(envpc2_candidates)}, envPC3 candidates: {len(envpc3_candidates)}")

    print("Reading stage 10 DE evidence...")
    de_path = root / "output/candidateGenes/consistentEnvResponsiveGenes.json"
    de_raw = json.loads(de_path.read_text())
    og_de = defaultdict(dict)  # OG -> category -> bool
    for category in DE_CATEGORIES:
        for og in de_raw.get(category, []):
            og_de[og][category] = True

    print("Reading curated high-confidence candidate summary...")
    highconf_path = root / "output/finalCandidateOGs_summary.txt"
    og_highconf = {}
    with open(highconf_path, newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            og = row["OG"]
            de_conditions = [c for c in row.get("aprioriDE_conditions", "").split(",") if c]
            og_highconf[og] = {"envPC": row["envPC"], "aprioriDEConditions": de_conditions}
    print(f"  {len(og_highconf)} high-confidence candidates")

    all_ogs = set(genes_by_og) | set(og_env) | set(og_relax) | set(og_de) | set(og_highconf)
    print(f"Building ogResults.json for {len(all_ogs)} OGs...")

    og_results = {}
    for og in all_ogs:
        entry = {}
        if genes_by_og.get(og):
            entry["genes"] = dict(genes_by_og[og])
        if og_env.get(og):
            entry["envAssociation"] = og_env[og]
        relax_entry = {}
        if og_relax.get(og):
            relax_entry.update(og_relax[og])
        # gating metadata so the frontend can distinguish "not tested because not a
        # phyloGWAS-significant candidate" from "not tested (outside RELAX universe)"
        relax_meta = {
            "inGenomeWideUniverse": og in relax_universe,
            "envPC2Candidate": og in envpc2_candidates,
            "envPC3Candidate": og in envpc3_candidates,
        }
        if relax_entry or relax_meta["envPC2Candidate"] or relax_meta["envPC3Candidate"] or relax_meta["inGenomeWideUniverse"]:
            entry["molecularEvolution"] = relax_entry
            entry["relaxGating"] = relax_meta
        if og_de.get(og):
            entry["deEvidence"] = og_de[og]
        if og_highconf.get(og):
            entry["highConfidenceCandidate"] = og_highconf[og]
        og_results[og] = entry

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "geneIndex.json").write_text(json.dumps(gene_index, separators=(",", ":")))
    (out_dir / "ogResults.json").write_text(json.dumps(og_results, separators=(",", ":")))
    print(f"Wrote {out_dir / 'geneIndex.json'} ({len(gene_index)} keys)")
    print(f"Wrote {out_dir / 'ogResults.json'} ({len(og_results)} OGs)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--phylogwas-root",
        type=Path,
        default=Path(__file__).resolve().parent.parent.parent / "p_phyloGWAS",
        help="Path to a local p_phyloGWAS checkout (default: ../p_phyloGWAS relative to this repo)",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data",
        help="Directory to write geneIndex.json/ogResults.json into",
    )
    args = parser.parse_args()
    build(args.phylogwas_root, args.out_dir)
