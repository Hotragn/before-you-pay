import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, serverTimestamp, updateDoc } from 'firebase/firestore';

let env;
const good = () => ({ site: 'demo.example', capturedAt: '2026-11-21T12:00:00.000Z', remindOn: '2026-12-03',
  quotes: [{ kind: 'fee', quote: 'A one-time activation fee of $1.99', amount: '$1.99' }], sha256: 'a'.repeat(64), savedAt: serverTimestamp() });

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-byp', firestore: { rules: readFileSync('../firestore.rules', 'utf8') } });
});
after(async () => env.cleanup());

test('owner can save and read their own offer', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertSucceeds(setDoc(doc(db, 'users/alice/proofs/p1'), good()));
  await assertSucceeds(getDoc(doc(db, 'users/alice/proofs/p1')));
  await assertSucceeds(getDocs(collection(db, 'users/alice/proofs')));
});
test('another user cannot read, list or write it', async () => {
  const db = env.authenticatedContext('mallory').firestore();
  await assertFails(getDoc(doc(db, 'users/alice/proofs/p1')));
  await assertFails(getDocs(collection(db, 'users/alice/proofs')));
  await assertFails(setDoc(doc(db, 'users/alice/proofs/p2'), good()));
});
test('signed-out visitors get nothing', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'users/alice/proofs/p1')));
  await assertFails(setDoc(doc(db, 'users/alice/proofs/p3'), good()));
});
test('extra fields, bad hashes and edits are rejected', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(db, 'users/alice/proofs/x1'), { ...good(), cardNumber: '4242' }));
  await assertFails(setDoc(doc(db, 'users/alice/proofs/x2'), { ...good(), sha256: 'short' }));
  await assertFails(setDoc(doc(db, 'users/alice/proofs/x3'), { ...good(), quotes: Array(11).fill({ kind: 'fee', quote: 'x' }) }));
  await assertFails(updateDoc(doc(db, 'users/alice/proofs/p1'), { remindOn: '2027-01-01' }));
});
test('quote items must be small maps of strings', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(db, 'users/alice/proofs/q1'), { ...good(), quotes: [{ kind: 'fee', quote: 'x'.repeat(501) }] }));
  await assertFails(setDoc(doc(db, 'users/alice/proofs/q2'), { ...good(), quotes: [{ kind: 'fee', quote: 'ok', name: 'Jordan' }] }));
  await assertFails(setDoc(doc(db, 'users/alice/proofs/q3'), { ...good(), quotes: ['just a string'] }));
  await assertFails(setDoc(doc(db, 'users/alice/proofs/q4'), { ...good(), remindOn: 'tomorrow!!' }));
  await assertSucceeds(setDoc(doc(db, 'users/alice/proofs/q5'), { ...good(), quotes: Array(10).fill({ kind: 'fee', quote: 'ok', amount: '$1.99' }) }));
});
test('everything outside saved offers is closed', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(db, 'anything/else'), { a: 1 }));
  await assertFails(getDoc(doc(db, 'users/alice')));
});
