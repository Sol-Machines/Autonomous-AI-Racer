/**
 * mint.ts — one-shot script that:
 *   1. Creates the $BOOST SPL token mint on devnet (0 decimals)
 *   2. Creates an Associated Token Account for the treasury wallet
 *   3. Mints INITIAL_SUPPLY $BOOST to the treasury ATA
 *   4. Creates a "faucet" ATA on a separate keypair and mints tokens there too
 *   5. Prints the addresses you need to paste into .env
 *
 * Usage:
 *   cd Race\ Mode/solana
 *   npm install
 *   npm run mint
 *
 * The script generates a fresh treasury keypair on the first run and saves it
 * to treasury-keypair.json. Keep that file safe — it controls the $BOOST mint
 * authority and treasury wallet.
 *
 * Set SOLANA_RPC_URL env var to override (defaults to devnet).
 */

import * as fs from "fs";
import * as path from "path";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} from "@solana/spl-token";

const RPC_URL = process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet");
const KEYPAIR_FILE = path.join(__dirname, "treasury-keypair.json");
const INITIAL_SUPPLY = 1_000_000; // tokens minted to treasury
const FAUCET_SUPPLY  =   100_000; // tokens minted to faucet (give to demo attendees)
const DECIMALS = 0;               // 1 $BOOST = 1 boost, no fractions

async function loadOrCreateKeypair(file: string): Promise<Keypair> {
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`Generated new keypair → ${file}`);
  return kp;
}

async function ensureFunded(conn: Connection, pubkey: PublicKey, label: string) {
  const bal = await conn.getBalance(pubkey);
  if (bal < 0.05 * LAMPORTS_PER_SOL) {
    console.log(`Airdropping SOL to ${label} (${pubkey.toString()})…`);
    const sig = await conn.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`  ✓ airdrop confirmed`);
  } else {
    console.log(`${label} already funded (${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL)`);
  }
}

async function main() {
  console.log(`\nRPC: ${RPC_URL}\n`);
  const conn = new Connection(RPC_URL, "confirmed");

  // Treasury keypair — mints $BOOST and receives spectator payments.
  const treasury = await loadOrCreateKeypair(KEYPAIR_FILE);
  console.log(`Treasury pubkey: ${treasury.publicKey.toString()}`);

  await ensureFunded(conn, treasury.publicKey, "treasury");

  // Faucet keypair — used to airdrop $BOOST to demo attendees.
  const faucetFile = path.join(__dirname, "faucet-keypair.json");
  const faucet = await loadOrCreateKeypair(faucetFile);
  console.log(`Faucet   pubkey: ${faucet.publicKey.toString()}`);
  await ensureFunded(conn, faucet.publicKey, "faucet");

  // Create (or re-use) the $BOOST mint.
  const mintFile = path.join(__dirname, "boost-mint.json");
  let mintPubkey: PublicKey;

  if (fs.existsSync(mintFile)) {
    mintPubkey = new PublicKey(JSON.parse(fs.readFileSync(mintFile, "utf-8")).mint);
    const info = await getMint(conn, mintPubkey);
    console.log(`\nUsing existing $BOOST mint: ${mintPubkey.toString()}`);
    console.log(`  decimals=${info.decimals}  supply=${info.supply}`);
  } else {
    console.log("\nCreating $BOOST mint…");
    mintPubkey = await createMint(
      conn,
      treasury,          // payer
      treasury.publicKey, // mint authority
      null,              // freeze authority (none)
      DECIMALS,
    );
    fs.writeFileSync(mintFile, JSON.stringify({ mint: mintPubkey.toString() }));
    console.log(`  ✓ mint created: ${mintPubkey.toString()}`);
  }

  // Treasury ATA.
  const treasuryATA = await getOrCreateAssociatedTokenAccount(
    conn, treasury, mintPubkey, treasury.publicKey,
  );
  console.log(`\nTreasury ATA: ${treasuryATA.address.toString()}`);

  if (Number(treasuryATA.amount) === 0) {
    console.log(`Minting ${INITIAL_SUPPLY} $BOOST to treasury…`);
    await mintTo(conn, treasury, mintPubkey, treasuryATA.address, treasury, INITIAL_SUPPLY);
    console.log("  ✓ done");
  }

  // Faucet ATA.
  const faucetATA = await getOrCreateAssociatedTokenAccount(
    conn, treasury, mintPubkey, faucet.publicKey,
  );
  console.log(`Faucet   ATA: ${faucetATA.address.toString()}`);

  if (Number(faucetATA.amount) === 0) {
    console.log(`Minting ${FAUCET_SUPPLY} $BOOST to faucet…`);
    await mintTo(conn, treasury, mintPubkey, faucetATA.address, treasury, FAUCET_SUPPLY);
    console.log("  ✓ done");
  }

  // Print .env snippet.
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Add these to Race Mode/.env:

SOLANA_TREASURY_PUBKEY=${treasury.publicKey.toString()}
SOLANA_TREASURY_ATA=${treasuryATA.address.toString()}
BOOST_TOKEN_MINT=${mintPubkey.toString()}
BOOST_TOKEN_DECIMALS=${DECIMALS}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Faucet keypair: ${faucetFile}
Run \`npm run faucet -- <WALLET_PUBKEY>\` to airdrop $BOOST to an attendee.
`);
}

main().catch((e) => { console.error(e); process.exit(1); });
