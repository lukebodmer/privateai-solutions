/** Who signed a fact off.
 *   - `luke`   — human-verified in the dashboard.
 *   - `auto`   — written by a trusted API sync (AA / HuggingFace / GitHub).
 *   - `neuman` — claimed by Neuman in a run and passed the checker: the
 *                cited page was fetched and archived by the checker itself,
 *                and the quote and value were found on it.
 *   - `null`   — unverified. */
export type Signer = 'luke' | 'auto' | 'neuman';

export interface FactEntry {
  value: string | number | boolean | null;
  source: string | null;
  fetched: string | null;   // ISO date the value last changed; null for facts that never had a value
  verified_by: Signer | null;
  verified_at: string | null;  // ISO date when verified
  /** N/A ("not applicable") — this fact key doesn't apply to this entity.
   *  Run briefs leave N/A facts out. Entity pages skip them. Roll-up dots
   *  ignore them. Value/source stay preserved underneath so reactivating
   *  restores prior state. Absent = false. */
  na?: boolean;
  /** The passage on the source page that carries the value, as Neuman
   *  quoted it and the checker found it. Shown beside the value so a
   *  reader can see exactly what the page said. Present on `neuman`
   *  facts and on claims Luke accepted from review. */
  quote?: string;
  /** Content-addressed sha256 of the snapshot backing this fact. Points at
   *  `$RESEARCH_ROOT/blobs/<sha[:2]>/<sha>.<ext>[.gz]`. Written by the
   *  sync scripts, by the checker for every claim it fetches, and by
   *  `/apply-patch` when Luke verifies a fact. Missing = no snapshot on
   *  file (e.g. hand-authored `my_take`). Dashboard renders a 📎 when set. */
  snapshot_hash?: string;
  /** Extension of the archived file, without leading dot (`json`, `html`,
   *  `pdf`, ...). Paired with `snapshot_hash` so the admin server can
   *  serve the blob with the right content-type via `GET /snapshot/<sha>.<ext>`.
   *  Absent iff `snapshot_hash` is absent. */
  snapshot_ext?: string;
}
