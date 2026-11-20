# Blog post ideas

A running list of possible blog posts for the site.

---

### 1. How I keep track of facts on this site

Walk through the fact tracking system: the JSON files with provenance metadata, the
admin dashboard at `/admin`, the Luke-review workflow, Neuman-powered refresh
prompts. A behind-the-scenes look at what keeps the data honest.

### 2. Who actually owns these models? A licensing guide

A primer on the major AI labs' weight licenses, roughly sorted by openness:

| Bucket | Companies | License |
|--------|-----------|---------|
| open-fully | **DeepSeek**, **Mistral** (Apache-2.0), **Zhipu** (MIT) | Permissive OSI-approved, no AUP |
| open-with-restrictions | **Meta** (LLaMA), **Alibaba/Qwen** (Qwen License), **Stability AI**, **Microsoft/Phi**, **X.AI/Grok** (custom AUP) | Weights downloadable but with acceptable-use or field-of-use restrictions |
| research-only | **Gemini/TensorFlow Research** (CC-BY-NC), some older models | Non-commercial only |
| gated | **LLaMA 2** (originally gated, later relaxed) | Request access on HF |
| closed | **OpenAI**, **Anthropic**, **Google DeepMind** (Gemini), **xAI** | API only |

Discuss what each license actually means for a developer or startup: Can you
fine-tune? Can you deploy commercially? Can you build a derivative product?

### 3. Mixture of Experts (MoE) architecture overview

An accessible explainer on how MoE works in modern LLMs: fine-grained routed experts,
shared experts, routing mechanisms, load balancing, how activation sparsity drives efficiency.
Use examples from DeepSeek, Mixtral, Qwen, etc. — not a company-specific deep-dive, just
how the architecture pattern works.

### 4. Shout out to the tiny models

An appreciation post for all the small models that make the big LLMs work: tokenizers
(BPE, Unigram, SPM), embedding models (text2vec, BERT-style sentence transformers, token
embedding layers in LLMs), classifier heads, reward models, routers/classifiers for MoE,
statistical baselines (TF-IDF, BM25), and all the non-Transformer infrastructure that keeps
the ecosystem running.

### 5. Is it bad to pass the same money back and forth?

Track the circular flow of money in a major AI deal — say NVIDIA and OpenAI — as deeply
as possible. Follow the dollars: investment rounds, cloud credits, compute commitments,
equity stakes, revenue-sharing, hardware purchases. Who is actually paying whom, and is
any "real" value being created, or is it just hot potato?

### 6. What does it mean to quantize a model?

An approachable explainer on model quantization: what it is, why we do it (VRAM,
throughput), the different levels (Q2–Q8, FP4, FP8, FP16), how quantization affects
quality, GGUF naming conventions (Q4_K_M, Q6_K, etc.), and how to read a VRAM table
on a model page to figure out what fits on your hardware.

### 7. The open-source governance layer for enterprise AI

There are great harnesses, great models, but no open-source layer that lets a large
company (1,000+ employees) govern AI usage cheaply without Microsoft/Google cloud lock-in.
What's needed: user token tracking, tool-use whitelisting per user/team, policy
enforcement (which models for which tasks), audit logs, bring-your-own-key inference
providers. A blog post + potential product kickoff.

### 8. Why does Claude say ● Not applicable — one small edit. and weird stuff like that (has to do with TaskCreate)

### 9. Running locally on AMD

### 10. Comparing one-off outcomes when the AI is given different (silly ) personalities (i.e. use a lot of emojis, or talk with an accent) 

### 11. Could local AI be the killer app for linux?
