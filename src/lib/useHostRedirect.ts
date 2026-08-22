/**
 * Putting people on the right address without making them think about it.
 *
 * One rule underneath all of it: a signed-in person is never left on the
 * public site, and never left on a school's address that isn't theirs. They
 * end up either at their own school, or at the plain app.
 *
 *   in exactly one school   → that school's subdomain
 *   in none, or in several  → app.pracscriber.com
 *
 * Somebody in two schools is sent to the plain app rather than guessed at,
 * because there is no right answer to pick for them and the app lists both.
 *
 * A site admin is never moved. They legitimately work across every school,
 * and being bounced out of one would make the job impossible.
 *
 * Nothing here runs until memberships are known, and nothing runs at all in
 * local development, where there are no subdomains — which is also what keeps
 * the end-to-end suite working against localhost.
 */

import { useEffect, useState } from 'react'
import { useAuth } from './auth'
import { getOrganisation } from './org'
import {
  appUrl,
  goToOrigin,
  hostKind,
  orgUrl,
  resolveHostOrg,
  subdomainsAvailable,
  type HostOrg,
} from './hostOrg'

export type HostState = {
  /** The school this address belongs to, null for the plain app, undefined while resolving. */
  org: HostOrg | null | undefined
  /** Set once we've decided to leave — the caller should render a holding screen. */
  leavingFor: string | null
}

export function useHostRedirect(): HostState {
  const { user, loading, memberships, siteAdmin } = useAuth()
  const [org, setOrg] = useState<HostOrg | null | undefined>(
    subdomainsAvailable() ? undefined : null,
  )
  const [leavingFor, setLeavingFor] = useState<string | null>(null)

  useEffect(() => {
    if (!subdomainsAvailable()) return
    let live = true
    void resolveHostOrg().then((resolved) => {
      if (live) setOrg(resolved)
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!subdomainsAvailable() || loading || org === undefined) return
    if (!user || siteAdmin || leavingFor) return

    const kind = hostKind()
    const leave = (label: string, url: string) => {
      setLeavingFor(label)
      void goToOrigin(url)
    }

    // On a school's address: stay only if it is actually yours. An address
    // that isn't yours quietly working anyway is precisely what the
    // subdomains exist to prevent.
    if (kind === 'org') {
      if (!org || !memberships.some((m) => m.orgId === org.id)) {
        leave('Scriber', appUrl())
      }
      return
    }

    // Already where somebody with no single school belongs.
    if (kind === 'app' && memberships.length !== 1) return

    // On the public site while signed in, or on the app while belonging to
    // exactly one school. Either way, find out where they should be.
    if (memberships.length !== 1) {
      leave('Scriber', appUrl())
      return
    }

    const only = memberships[0]!
    let live = true
    void getOrganisation(only.orgId)
      .then((organisation) => {
        if (!live) return
        // A school that has not claimed a subdomain has nowhere to send them,
        // so the plain app is where they belong — unless they are already on it.
        if (organisation?.slug) leave(organisation.name, orgUrl(organisation.slug))
        else if (kind === 'marketing') leave('Scriber', appUrl())
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [user, loading, memberships, siteAdmin, org, leavingFor])

  return { org, leavingFor }
}
