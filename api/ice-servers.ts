/**
 * The ICE servers a screen share connects through.
 *
 * STUN alone is enough for two machines that can reach each other directly,
 * which covers a lot of home networks and almost no school ones — school
 * wifi is usually behind a NAT strict enough that the two peers can never
 * meet. That case needs TURN: a relay both sides can reach, which forwards
 * the video between them.
 *
 * A TURN server needs a long-lived shared secret, and a secret shipped in a
 * front-end bundle is not a secret. So the browser asks this function, and it
 * mints a username/credential pair good for twelve hours, using the standard
 * TURN REST scheme that coturn (and every hosted provider built on it)
 * understands. Set TURN_URLS and TURN_SECRET in the Vercel project to turn
 * this on; with them unset the response is STUN-only and screen sharing still
 * works wherever a direct connection is possible.
 */

export const config = { runtime: 'edge' }

/** The shape the browser's RTCPeerConnection expects, spelled out here so
 *  this file needs no DOM types of its own. */
type IceServer = { urls: string | string[]; username?: string; credential?: string }

const STUN: IceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

const TTL_SECONDS = 12 * 60 * 60

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

export default async function handler(): Promise<Response> {
  const urls = (process.env.TURN_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
  const secret = process.env.TURN_SECRET

  const iceServers: IceServer[] = [...STUN]

  if (urls.length > 0 && secret) {
    // The TURN REST convention: the username is the expiry timestamp, and the
    // credential is that timestamp signed with the shared secret. The TURN
    // server verifies it with the same secret, so nothing has to be stored.
    const username = String(Math.floor(Date.now() / 1000) + TTL_SECONDS)
    iceServers.push({ urls, username, credential: await hmacSha1Base64(secret, username) })
  }

  return new Response(JSON.stringify({ iceServers }), {
    headers: {
      'content-type': 'application/json',
      // Short, and private to this viewer — the credential is time-limited
      // and specific to whoever asked for it.
      'cache-control': 'private, max-age=300',
    },
  })
}
