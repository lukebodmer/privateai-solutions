## Notes for parts

A part is what one of our builds is made of and holds the model: a GPU card,
or a whole system bought as one (DGX Station, Mac Studio, an HGX server).

**Identity.** Names collide: "RTX PRO 6000 Blackwell" comes as a
Workstation Edition, a Max-Q and a Server Edition; "Mac Studio" comes with
several chips and memory sizes; "DGX Station" was once an A100 machine.
Every number you claim must be for the exact variant the onboarding notes
describe.

**Class decides the facts.** The table lists only the facts that apply to
this part's `class`.
- `gpu` — specs from the maker's page and TechPowerUp; cross-check
  TechPowerUp against the maker when they disagree, and prefer the maker.
- `system` — the maker's product or spec page. `memory_gb` is the memory a
  model can be loaded into (see its description: unified memory on a Mac,
  coherent memory on a Grace system, all GPUs' memory on an HGX server).
  `gpu_memory_gb` is the GPU memory alone, only when it differs.

**Memory and compute.** `bf16_tflops` is dense tensor BF16 without
sparsity; makers often headline the sparse figure, which is double. Claim
the dense one, with the quote that shows it.

**Prices.** One observed listing, with the listing as `source` and the
price in the quote. Cards: the lowest in-stock new unit at a major retailer.
Systems: the maker's store or an authorized reseller, for the exact
configuration. Many systems are sold only on quote: then claim
`price.new_usd` as `null` with the page that says so.
