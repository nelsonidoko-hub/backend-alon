import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

// Checks a token from Google or Facebook with the provider itself and returns who it belongs to.
// Nothing the browser says about the person is trusted until the provider confirms it.
async function getJson(url, headers) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  } catch {
    throw new AppError(502, 'Could not reach the sign-in provider. Try again', 'SOCIAL_UNREACHABLE');
  }
  if (!res.ok) throw new AppError(401, 'Sign-in could not be verified', 'SOCIAL_INVALID');
  return res.json();
}

export async function verifyGoogle(accessToken) {
  if (!env.GOOGLE_CLIENT_ID) throw new AppError(503, 'Google sign-in is not set up', 'SOCIAL_DISABLED');
  const info = await getJson(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (info.aud !== env.GOOGLE_CLIENT_ID && info.azp !== env.GOOGLE_CLIENT_ID) {
    throw new AppError(401, 'Sign-in could not be verified', 'SOCIAL_INVALID');
  }
  const me = await getJson('https://www.googleapis.com/oauth2/v3/userinfo', { Authorization: `Bearer ${accessToken}` });
  if (!me.sub) throw new AppError(401, 'Sign-in could not be verified', 'SOCIAL_INVALID');
  return { id: me.sub, name: me.name, email: me.email_verified ? me.email : undefined };
}

export async function verifyFacebook(accessToken) {
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) throw new AppError(503, 'Facebook sign-in is not set up', 'SOCIAL_DISABLED');
  const appToken = `${env.FACEBOOK_APP_ID}|${env.FACEBOOK_APP_SECRET}`;
  const dbg = await getJson(
    `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`
  );
  if (!dbg.data?.is_valid || dbg.data.app_id !== env.FACEBOOK_APP_ID) {
    throw new AppError(401, 'Sign-in could not be verified', 'SOCIAL_INVALID');
  }
  const me = await getJson(`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`);
  if (!me.id) throw new AppError(401, 'Sign-in could not be verified', 'SOCIAL_INVALID');
  return { id: me.id, name: me.name, email: me.email };
}

export const verifyProvider = (provider, token) => (provider === 'google' ? verifyGoogle(token) : verifyFacebook(token));