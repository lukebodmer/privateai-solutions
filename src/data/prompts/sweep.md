# Daily sweep — {{today}}

Run `{{run_id}}`. The API syncs (Artificial Analysis, Arena, OpenRouter,
Hugging Face, GitHub) have already run; the facts they own are not your job.
Three jobs, in order, all into one claims file.

## 1. Part prices

For every part below, claim today's `price.new_usd`, changed or not. A
price is one observed listing, not an estimate.

- **Cards** — the lowest in-stock price for a new unit at a major retailer:
  the maker's own store, Best Buy, Newegg, B&H, Micro Center, or Amazon when
  Amazon itself is the seller. Not marketplace resellers.
- **Systems** — the product the part names, from the seller in its name
  (e.g. Exxact for an Exxact machine), for the configuration it describes.
  Re-read the listing in the table when it is there. A "starting price" is
  right when the part is the product's base configuration, as its name says.
- If a part is sold only on quote, or no longer sold new, claim
  `price.new_usd` as `null` with the page that shows it.
- The exact SKU matters. An RTX PRO 6000 Max-Q is not the Workstation
  Edition; a Mac Studio price is for the memory and chip the part describes.

{{price_table}}

{{not_swept}}

## 2. Facts due for a re-check

These agent facts have reached the review interval their schema sets. Confirm
each against the source in its row and claim it, changed or not. A `judgment`
fact that still says what is on file, from the same source, is re-confirmed;
a changed value or a new source goes to Luke.

{{due_table}}

## 3. What is new

Look for notable releases since {{since}}: open-weight models, hardware for
running them, and agent harnesses. Do not claim anything for them. List them
in `report.md` under **Candidates to onboard**, one line each: the name, why
it matters to someone running AI on their own hardware, and the official
announcement URL. Luke onboards from the dashboard.

{{protocol}}
