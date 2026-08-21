/**
 * Live screen sharing from a student sitting a test to whoever is supervising
 * it.
 *
 * The video itself never touches a server: it's a direct WebRTC connection
 * between the two browsers (or, where the network won't allow that, a relay —
 * see api/ice-servers.ts). Firestore is used only to introduce the two sides
 * to each other: the supervisor writes an offer under the student's
 * participant document, the student writes back an answer, and both add the
 * network candidates they discover. That handshake is the only thing stored,
 * and it's meaningless once the call is up.
 *
 * The direction is deliberate. The supervisor makes the offer, so a student
 * shares once and any number of supervisors can attach to it, each with their
 * own connection, without the student's page having to know who's watching.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './firebase'

const FALLBACK: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
}

/**
 * Asks the backend for relay credentials, falling back to STUN alone. The
 * fallback is not a failure state: on a network where the two browsers can
 * reach each other, STUN is all that's needed. It's school wifi that usually
 * isn't, which is what the relay is for.
 */
export async function loadIceConfig(): Promise<RTCConfiguration> {
  try {
    const response = await fetch('/api/ice-servers')
    if (!response.ok) return FALLBACK
    const data = (await response.json()) as { iceServers?: RTCIceServer[] }
    return data.iceServers?.length ? { iceServers: data.iceServers } : FALLBACK
  } catch {
    return FALLBACK
  }
}

export const screenShareSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

/** Thrown when a student picks a single tab or window instead of their screen. */
export class WholeScreenRequired extends Error {
  constructor() {
    super('whole screen required')
    this.name = 'WholeScreenRequired'
  }
}

/**
 * Starts the capture. Sharing a single tab would defeat the point — the
 * supervisor would see the exam and nothing else — so anything but the whole
 * screen is rejected and the student asked again.
 *
 * A low frame rate is deliberate: this is supervision, not video calling, and
 * a classroom of students all relaying 30fps would swamp both the relay and
 * the school's connection.
 */
export async function captureScreen(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 3, max: 5 } },
    audio: false,
  })
  const surface = (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)
    ?.displaySurface
  // Browsers that don't report the surface get the benefit of the doubt —
  // there's nothing to check against.
  if (surface && surface !== 'monitor') {
    stream.getTracks().forEach((track) => track.stop())
    throw new WholeScreenRequired()
  }
  return stream
}

const viewersRef = (orgId: string, testId: string, studentUid: string) =>
  collection(db, 'organisations', orgId, 'tests', testId, 'participants', studentUid, 'viewers')

/**
 * The student's side: answer anyone who asks to watch, for as long as the
 * test lasts. Returns a teardown that closes every connection it opened.
 */
export function publishScreen({
  orgId,
  testId,
  uid,
  stream,
  iceConfig,
}: {
  orgId: string
  testId: string
  uid: string
  stream: MediaStream
  iceConfig: RTCConfiguration
}): () => void {
  const connections = new Map<string, RTCPeerConnection>()

  const close = (viewerUid: string) => {
    connections.get(viewerUid)?.close()
    connections.delete(viewerUid)
  }

  const unsubscribe = onSnapshot(viewersRef(orgId, testId, uid), (snapshot) => {
    for (const change of snapshot.docChanges()) {
      const viewerUid = change.doc.id
      if (change.type === 'removed') {
        close(viewerUid)
        continue
      }
      const data = change.doc.data()
      // A supervisor who reloads writes a fresh offer to the same document;
      // the old connection is dead either way, so start over.
      if (!data.offer) continue
      if (connections.has(viewerUid) && data.answer) continue
      close(viewerUid)

      const pc = new RTCPeerConnection(iceConfig)
      connections.set(viewerUid, pc)
      stream.getTracks().forEach((track) => pc.addTrack(track, stream))

      const answerCandidates = collection(change.doc.ref, 'answerCandidates')
      pc.onicecandidate = (event) => {
        if (event.candidate) void addDoc(answerCandidates, event.candidate.toJSON()).catch(() => undefined)
      }

      void (async () => {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          await updateDoc(change.doc.ref, { answer: { type: answer.type, sdp: answer.sdp } })
          onSnapshot(collection(change.doc.ref, 'offerCandidates'), (candidates) => {
            for (const candidate of candidates.docChanges()) {
              if (candidate.type === 'added') {
                void pc.addIceCandidate(new RTCIceCandidate(candidate.doc.data())).catch(() => undefined)
              }
            }
          })
        } catch {
          close(viewerUid)
        }
      })()
    }
  })

  return () => {
    unsubscribe()
    connections.forEach((pc) => pc.close())
    connections.clear()
  }
}

/**
 * The supervisor's side: ask one student's page for its screen. `onStream`
 * fires once the video arrives; `onState` follows the connection so the UI can
 * say "connecting" rather than showing a black rectangle.
 */
export function watchScreen({
  orgId,
  testId,
  studentUid,
  viewerUid,
  iceConfig,
  onStream,
  onState,
}: {
  orgId: string
  testId: string
  studentUid: string
  viewerUid: string
  iceConfig: RTCConfiguration
  onStream: (stream: MediaStream) => void
  onState: (state: RTCPeerConnectionState) => void
}): () => void {
  const pc = new RTCPeerConnection(iceConfig)
  const viewerDoc = doc(viewersRef(orgId, testId, studentUid), viewerUid)
  const remote = new MediaStream()
  let unsubscribeAnswer: Unsubscribe | undefined
  let unsubscribeCandidates: Unsubscribe | undefined
  let closed = false

  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.ontrack = (event) => {
    event.streams[0]?.getTracks().forEach((track) => remote.addTrack(track))
    onStream(remote)
  }
  pc.onconnectionstatechange = () => onState(pc.connectionState)

  const offerCandidates = collection(viewerDoc, 'offerCandidates')
  pc.onicecandidate = (event) => {
    if (event.candidate) void addDoc(offerCandidates, event.candidate.toJSON()).catch(() => undefined)
  }

  void (async () => {
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      if (closed) return
      await setDoc(viewerDoc, { offer: { type: offer.type, sdp: offer.sdp }, answer: null })

      unsubscribeAnswer = onSnapshot(viewerDoc, (snapshot) => {
        const answer = snapshot.data()?.answer
        if (answer && !pc.currentRemoteDescription) {
          void pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(() => undefined)
        }
      })
      unsubscribeCandidates = onSnapshot(collection(viewerDoc, 'answerCandidates'), (candidates) => {
        for (const candidate of candidates.docChanges()) {
          if (candidate.type === 'added') {
            void pc.addIceCandidate(new RTCIceCandidate(candidate.doc.data())).catch(() => undefined)
          }
        }
      })
    } catch {
      onState('failed')
    }
  })()

  return () => {
    closed = true
    unsubscribeAnswer?.()
    unsubscribeCandidates?.()
    pc.close()
    // Removing the request tells the student's page to drop its side too.
    void (async () => {
      for (const name of ['offerCandidates', 'answerCandidates']) {
        const stale = await getDocs(collection(viewerDoc, name)).catch(() => null)
        stale?.docs.forEach((d) => void deleteDoc(d.ref).catch(() => undefined))
      }
      await deleteDoc(viewerDoc).catch(() => undefined)
    })()
  }
}
