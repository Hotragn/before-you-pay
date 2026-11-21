// Firebase web config. These values identify the project; they are not secrets
// (access is protected by App Check, Auth and Firestore rules). Kept in this one
// module so there is a single place to change them.
export const firebaseConfig = {
  apiKey: 'AIzaSyAppHGjn3dng1Z2pbLKKLZN3rxc9wVZctM',
  authDomain: 'before-you-pay-9b8c6.firebaseapp.com',
  projectId: 'before-you-pay-9b8c6',
  storageBucket: 'before-you-pay-9b8c6.firebasestorage.app',
  messagingSenderId: '360655829336',
  appId: '1:360655829336:web:3a6da8a3c13d69c1c2cd2d',
};

// reCAPTCHA Enterprise score-based site key registered with App Check.
// Allowed domain: before-you-pay-9b8c6.web.app
export const recaptchaEnterpriseSiteKey = '6LcCdSouAAAAAAt_UZ7XQ04aIWAqUnQOupHOFPV7';

export const hostedAppUrl = 'https://before-you-pay-9b8c6.web.app';
