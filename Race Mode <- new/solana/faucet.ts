/**
 * faucet.ts — sends $BOOST tokens from the faucet wallet to any address.
 *
 * Usage:
 *   npm run faucet -- <RECIPIENT_WALLET_PUBKEY> [amount]
 *
 * Defaults to 10 $BOOST per recipient. Run mint.ts first.
 */

import * as fs from "fs";
import * as path from "path";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  transfer,
} from "@solana/spl-token";

const RPC_URL  = process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet");
const FAUCET_FILE = path.join(__dirname, "faucet-keypair.json");
const MINT_FILE   = path.join(__dirname, "boost-mint.json");

async function main() {
  const recipient = process.argv[2];
  const amount    = parseInt(process.argv[3] ?? "10", 10);

  if (!recipient) {
    console.error("Usage: npm run faucet -- <RECIPIENT_PUBKEY> [amount=10]");
    process.exit(1);
  }

  const conn    = new Connection(RPC_URL, "confirmed");
  const faucet  = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(FAUCET_FILE, "utf-8"))));
  const mint    = new PublicKey(JSON.parse(fs.readFileSync(MINT_FILE, "utf-8")).mint);
  const recipientKey = new PublicKey(recipient);

  const srcATA = await getOrCreateAssociatedTokenAccount(conn, faucet, mint, faucet.publicKey);
  const dstATA = await getOrCreateAssociatedTokenAccount(conn, faucet, mint, recipientKey);

  console.log(`Sending ${amount} $BOOST → ${recipientKey.toString()}`);
  const sig = await transfer(conn, faucet, srcATA.address, dstATA.address, faucet, amount);
  console.log(`✓ tx: ${sig}`);
  console.log(`  Recipient ATA: ${dstATA.address.toString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
