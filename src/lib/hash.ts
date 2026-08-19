/**
 * SHA-256 of a file's bytes, hex-encoded. Used to recognise the same paper
 * across devices — or a duplicate upload — without ever sending the file
 * anywhere: the hash travels in Firestore metadata, the bytes never leave
 * the device they were added on.
 */
export async function sha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
