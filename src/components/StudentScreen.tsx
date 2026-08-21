import { useEffect, useRef, useState } from 'react'
import { loadIceConfig, watchScreen } from '../lib/screenShare'

/**
 * One student's shared screen, live. The video is a direct connection to
 * their browser — it isn't recorded, and it isn't stored anywhere; when this
 * component unmounts the connection is torn down and the request withdrawn.
 */
export function StudentScreen({
  orgId,
  testId,
  studentUid,
  viewerUid,
  sharing,
  large,
}: {
  orgId: string
  testId: string
  studentUid: string
  viewerUid: string
  sharing: boolean
  large?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<RTCPeerConnectionState>('new')

  useEffect(() => {
    if (!sharing) {
      setState('new')
      return
    }
    let stop: (() => void) | undefined
    let cancelled = false
    void loadIceConfig().then((iceConfig) => {
      if (cancelled) return
      stop = watchScreen({
        orgId,
        testId,
        studentUid,
        viewerUid,
        iceConfig,
        onStream: (stream) => {
          if (videoRef.current) videoRef.current.srcObject = stream
        },
        onState: setState,
      })
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [orgId, testId, studentUid, viewerUid, sharing])

  return (
    <div className={`student-screen ${large ? 'student-screen-large' : ''}`}>
      <video ref={videoRef} autoPlay playsInline muted />
      {(!sharing || state !== 'connected') && (
        <div className="student-screen-state">
          {!sharing
            ? 'Not sharing'
            : state === 'failed' || state === 'disconnected'
              ? "Couldn't connect"
              : 'Connecting…'}
        </div>
      )}
    </div>
  )
}
