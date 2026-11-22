import { getFirestore, collection, addDoc, serverTimestamp, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirebaseApp } from './firebase';
import { redact } from './redact';
import type { Finding, PageSnapshot } from './types';

// A "proof of offer": what the page promised, in its own words, with a time
// and a hash, so the user can point to it months later. Only verified quotes
// and the site address are stored. No names, card data or page dumps.
export interface ProofOfOffer {
  site: string;
  capturedAt: string;
  remindOn?: string;
  quotes: { kind: string; quote: string; amount?: string }[];
  sha256: string;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildProof(page: PageSnapshot, findings: Finding[], remindOn?: string): Promise<ProofOfOffer> {
  const quotes = findings
    .filter((f) => f.verification === 'verified' && f.kind !== 'cancel_path')
    .map((f) => ({ kind: f.kind, quote: redact(f.quote).slice(0, 500), ...(f.amount ? { amount: f.amount.slice(0, 20) } : {}) }))
    .filter((q, i, all) => all.findIndex((o) => o.quote === q.quote) === i)
    .slice(0, 10);
  const site = new URL(page.url).hostname;
  const body = JSON.stringify({ site, capturedAt: page.capturedAt, quotes });
  return { site, capturedAt: page.capturedAt, remindOn, quotes, sha256: await sha256(body) };
}

async function currentUid(): Promise<string> {
  const auth = getAuth(getFirebaseApp());
  await auth.authStateReady();
  return (auth.currentUser ?? (await signInAnonymously(auth)).user).uid;
}

function localProofs(): ProofOfOffer[] {
  return JSON.parse(localStorage.getItem('byp.proofs') ?? '[]');
}

// Saved offers from the account plus any that were kept on this device while
// offline, newest first, without duplicates.
export async function listProofs(): Promise<ProofOfOffer[]> {
  let remote: ProofOfOffer[] = [];
  try {
    const uid = await currentUid();
    const snap = await getDocs(query(collection(getFirestore(getFirebaseApp()), 'users', uid, 'proofs'), orderBy('capturedAt', 'desc'), limit(20)));
    remote = snap.docs.map((d) => d.data() as ProofOfOffer);
  } catch (e) {
    console.warn('Could not read saved offers from Firestore', e);
  }
  const seen = new Set(remote.map((p) => p.sha256));
  return [...remote, ...localProofs().filter((p) => !seen.has(p.sha256))].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export async function saveProof(proof: ProofOfOffer): Promise<'firestore' | 'local'> {
  try {
    const uid = await currentUid();
    await addDoc(collection(getFirestore(getFirebaseApp()), 'users', uid, 'proofs'), { ...JSON.parse(JSON.stringify(proof)), savedAt: serverTimestamp() });
    return 'firestore';
  } catch (e) {
    console.warn('Firestore save failed, keeping it on this device', e);
  }
  localStorage.setItem('byp.proofs', JSON.stringify([...localProofs(), proof]));
  return 'local';
}
