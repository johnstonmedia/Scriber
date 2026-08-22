/**
 * Putting people on the right address without making them think about it.
 *
 * Two rules, and they only ever fire once the account's memberships are
 * known:
 *
 *   - On a school's subdomain but not a member of that school → the plain
 *     app. This is the clarity the subdomains are for: an address that isn't
 *     yours doesn't quietly work anyway.
 *   - On the plain app while belonging to exactly one school → that school.
 *     Somebody in two schools is left alone, because there is no right answer
 *     to pick for them.
 *
 * A site admin is never moved. They legitimately work across every school,
 * and being bounced out of one would make the job impossible.
 */

import { useEffect, useState } from 'react'
import { useAuth } from './auth'
import { getOrganisation } from './org'
import { appUrl, goToOrigin, orgUrl, resolveHostOrg, subdomainsAvailable, type HostOrg } from './hostOrg'

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

    if (org) {
      if (!memberships.some((m) => m.orgId === org.id)) {
        setLeavingFor('Scriber')
        void goToOrigin(appUrl())
      }
      return
    }

    // On the plain app: send a member of exactly one school to it, if that
    // school has claimed a subdomain at all.
    if (memberships.length !== 1) return
    const only = memberships[0]!
    let live = true
    void getOrganisation(only.orgId)
      .then((organisation) => {
        if (!live || !organisation?.slug) return
        setLeavingFor(organisation.name)
        void goToOrigin(orgUrl(organisation.slug))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [user, loading, memberships, siteAdmin, org, leavingFor])

  return { org, leavingFor }
}
