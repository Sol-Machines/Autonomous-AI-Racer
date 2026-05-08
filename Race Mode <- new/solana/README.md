# Race Mode — Solana ($BOOST on devnet)

Scripts to mint the $BOOST SPL token and configure the treasury wallet
that receives boost payments. Not implemented yet.

Planned:

- `mint.ts` — one-shot script that creates the $BOOST mint on devnet,
  creates an associated token account for the treasury wallet, and
  optionally airdrops some $BOOST to a demo wallet.
- `README.md` — runbook (devnet airdrop, Phantom setup, env vars to set
  in the backend `.env`).
