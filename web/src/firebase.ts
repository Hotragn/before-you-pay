import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { firebaseConfig, recaptchaEnterpriseSiteKey } from './config';

export { firebaseConfig };

const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);

let app: FirebaseApp | undefined;
let appCheck: AppCheck | undefined;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  app = initializeApp(firebaseConfig);
  // App Check is enforced for Firebase AI Logic. On localhost the reCAPTCHA key
  // is not allowed, so we switch to the debug provider: the SDK prints a debug
  // token in the console, and you register it in the Firebase console
  // (App Check > Apps > Manage debug tokens). Never commit that token.
  if (isLocalDev) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      localStorage.getItem('byp.appCheckDebugToken') || true;
  }
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return app;
}

export function getAppCheckInstance(): AppCheck | undefined {
  getFirebaseApp();
  return appCheck;
}
