import { getFirestore, collection, addDoc, serverTimestamp, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirebaseApp } from './firebase';
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
    .map((f) => ({ kind: f.kind, quote: f.quote, ...(f.amount ? { amount: f.amount } : {}) }));
  const site = new URL(page.url).hostname;
  const body = JSON.stringify({ site, capturedAt: page.capturedAt, quotes });
  return { site, capturedAt: page.capturedAt, remindOn, quotes, sha256: await sha256(body) };
}

async function currentUid(): Promise<string> {
  const auth = getAuth(getFirebaseApp());
  await auth.authStateReady();
  return (auth.currentUser ?? (await signInAnonymously(auth)).user).uid;
}

export async function listProofs(): Promise<ProofOfOffer[]> {
  try {
    const uid = await currentUid();
    const snap = await getDocs(query(collection(getFirestore(getFirebaseApp()), 'users', uid, 'proofs'), orderBy('capturedAt', 'desc'), limit(20)));
    return snap.docs.map((d) => d.data() as ProofOfOffer);
  } catch (e) {
    console.warn('Could not read saved offers from Firestore', e);
    return JSON.parse(localStorage.getItem('byp.proofs') ?? '[]');
  }
}

export async function saveProof(proof: ProofOfOffer): Promise<'firestore' | 'local'> {
  const app = getFirebaseApp();
  if (app) {
    try {
      const uid = await currentUid();
      const user = { uid };
      await addDoc(collection(getFirestore(app), 'users', user.uid, 'proofs'), { ...JSON.parse(JSON.stringify(proof)), savedAt: serverTimestamp() });
      return 'firestore';
    } catch (e) {
      console.warn('Firestore save failed, keeping it on this device', e);
    }
  }
  const all = JSON.parse(localStorage.getItem('byp.proofs') ?? '[]');
  all.push(proof);
  localStorage.setItem('byp.proofs', JSON.stringify(all));
  return 'local';
}
