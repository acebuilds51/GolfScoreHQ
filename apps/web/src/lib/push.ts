// Phone notifications in the browser: can this phone get them, and turning
// them on or off. The subscription is saved through the Api (one row per device).

export type PushSupport =
  | 'ok'
  /** iPhone/iPad in Safari: notifications only work from the home-screen app. */
  | 'ios-browser'
  | 'unsupported';

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return 'ios-browser';
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window ? 'ok' : 'unsupported';
}

/** The public key, base64url → bytes (what PushManager.subscribe wants). */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js');
}

/** This phone's current subscription, if notifications are on here. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Ask permission and subscribe. Throws a readable error when the person says no. */
export async function subscribe(publicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in your phone or browser settings, then try again.');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
}

/** What the server needs to send to this device. */
export function subscriptionKeys(s: PushSubscription): { endpoint: string; p256dh: string; auth: string } {
  const j = s.toJSON();
  return { endpoint: s.endpoint, p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' };
}
