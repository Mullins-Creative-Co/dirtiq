# Reproduce the research

Read PROTOCOL.md before running anything. FINDINGS.md is the one-page summary.
Scripts are Python 3.9 compatible and import the existing model package read-only.

The exact local run used Python 3.9.6, numpy 2.0.2, pandas 2.3.3, scipy 1.13.1,
scikit-learn 1.6.1 and pyarrow 21.0.0. Use `requirements.txt` in this directory for
these numerical dependencies. No JavaScript build or app deployment is needed.

The first-run frozen input snapshot and complete aggregate results are retained at
`research/output/` in `/Users/writewise/dirtiq-research`, intentionally ignored by git.
INPUTS.sha256 records their expected bytes; it contains hashes, not source data.
The OOF CSVs came from `/Users/writewise/dirtiq/data/sports`, and cache files from
`/Users/writewise/sports-cache`. The original checkout's eight conflicts were untouched.
The study base is 56349ed and the final evaluation code commit is 0783fac.

To audit the retained snapshot without fitting or looking at new holdout results:

```sh
python3 -m unittest discover -s research -p 'test_study.py'
(cd research/output/inputs && shasum -a 256 -c ../../INPUTS.sha256)
python3 research/report.py
```

`report.py` formats already-computed aggregates; it does not refit models or evaluate
holdout again. `output/results.json` records the code, protocol and input-manifest
hashes. `output/DETAILS.md` has all per-season bet results and intervals, the fixed
development-ranked groups on holdout, probability scores, training cutoffs and source
audits. `output/acceptance.json` records the eight acceptance checks.

To reproduce in a fresh checkout with the same input bytes:

```sh
OPENBLAS_NUM_THREADS=1 python3 research/prepare.py \
  --predictions /path/to/OOF/data/sports --cache /path/to/sports-cache
OPENBLAS_NUM_THREADS=1 python3 research/audit_sources.py
OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 python3 research/study.py --phase development
# Verify/commit the hypotheses and code before releasing held-out results.
OPENBLAS_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1 python3 research/study.py --phase final
python3 research/report.py
```

Existing input/result directories are not overwritten. The original first development
pass is preserved as `output/development-preaudit-invalid.json`; it diagnosed a pooled
FCS rest-identity bug and elapsed-hours versus calendar-day back-to-backs. Corrected
development is `output/development.json`; all corrections precede final evaluation.
No threshold or hyperparameter search followed development or holdout results.

Preparation copies caches, never modifies originals. Adapter calls use the copied
schedules with lines=False and a research-local cached-only download wrapper; they do
not refresh source data or fetch thousands of historical odds. ESPN opening medians
are reconstructed with the production adapter's pure consolidation function. City
coordinates are GeoNames (https://download.geonames.org/export/dump/), fetched once and
hashed. That live download and source release assets can change: new bytes are a new
study, not an exact reproduction. Preserve/share the frozen snapshot separately if
needed; do not commit it or any raw/derived data files.

On this Apple Accelerate/NumPy installation, ordinary finite matrix products trigger
spurious warnings documented at https://github.com/numpy/numpy/issues/28687. The
synthetic scalar-reference check agrees within 1e-12, and the study explicitly rejects
nonfinite filter predictions, standardized features/probabilities and unconverged
optimizers. Warnings are retained in local logs, not hidden by changing the model.

A strict classifier holdout is conditional on supplied rolling OOF base forecasts,
whose later-season fits use earlier completed seasons. It is not an untouched joint
holdout for the entire pre-existing forecasting pipeline. These same seasons had
already been examined by the earlier project analysis, so a genuinely new prospective
sample is still required before claiming a betting edge.

Additional inherited provenance limits: the published headline was chosen from pooled
backtest results, and the source adapters pool minor teams using full-season game
counts/schedules. This study does not independently certify those earlier choices
as point-in-time historical decisions. The proposed meta-model uses no new test
outcomes for preprocessing or classifier fitting in the strict evaluation, but that
cannot retroactively make the supplied base forecasts a virgin holdout.
