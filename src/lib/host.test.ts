import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostKind, loginUrl, rootDomain, subdomainsAvailable } from './host'

/**
 * Host routing decides what a visitor is shown before a single request is
 * made, and it is the one part of the app that cannot be exercised locally —
 * localhost has no subdomains, so every end-to-end suite runs down the
 * "marketing" branch and proves nothing about the other two. These are the
 * only checks that see production's shape.
 */

test('the three kinds of address', () => {
  assert.equal(hostKind('pracscriber.com'), 'marketing')
  assert.equal(hostKind('app.pracscriber.com'), 'app')
  assert.equal(hostKind('www.pracscriber.com'), 'app')
  assert.equal(hostKind('stpauls.pracscriber.com'), 'org')
  assert.equal(hostKind('StPauls.PracScriber.com'), 'org')
})

test('local development is the marketing branch, so every route stays reachable', () => {
  for (const host of ['localhost', 'app.localhost', '127.0.0.1', '192.168.1.4']) {
    assert.equal(subdomainsAvailable(host), false, host)
    assert.equal(hostKind(host), 'marketing', host)
  }
})

test('a Vercel preview build is one host, not a school', () => {
  assert.equal(subdomainsAvailable('scriber-git-branch-abc.vercel.app'), false)
  assert.equal(hostKind('scriber-git-branch-abc.vercel.app'), 'marketing')
})

test('the root domain is read from any depth of subdomain', () => {
  assert.equal(rootDomain('pracscriber.com'), 'pracscriber.com')
  assert.equal(rootDomain('app.pracscriber.com'), 'pracscriber.com')
  assert.equal(rootDomain('stpauls.pracscriber.com'), 'pracscriber.com')
})

/**
 * The whole point of the change: a Firebase session belongs to one origin, so
 * a sign-in form served from the marketing domain creates a session the app
 * cannot see. Signing in has to happen where the session will be used.
 */
test('sign-in from the public site goes to the app origin, not to /login here', () => {
  assert.equal(loginUrl('pracscriber.com'), 'https://app.pracscriber.com/login')
  assert.equal(loginUrl('www.pracscriber.com'), 'https://app.pracscriber.com/login')
  assert.equal(loginUrl('stpauls.pracscriber.com'), 'https://app.pracscriber.com/login')
})

test('locally it stays an in-app route, which is what keeps the e2e suites working', () => {
  assert.equal(loginUrl('localhost'), '/login')
  assert.equal(loginUrl('127.0.0.1'), '/login')
})
