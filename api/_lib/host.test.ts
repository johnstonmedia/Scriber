import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { normaliseSlug, slugFromHost } from './host.ts'

test('reads a school slug from its subdomain', () => {
  assert.equal(slugFromHost('stpauls.pracscriber.com'), 'stpauls')
  assert.equal(slugFromHost('St-Pauls.PracScriber.com'), 'st-pauls')
  assert.equal(slugFromHost('stpauls.pracscriber.com:443'), 'stpauls')
})

test('the platform\'s own addresses belong to no school', () => {
  assert.equal(slugFromHost('pracscriber.com'), null)
  assert.equal(slugFromHost('app.pracscriber.com'), null)
  assert.equal(slugFromHost('www.pracscriber.com'), null)
  assert.equal(slugFromHost('localhost'), null)
  assert.equal(slugFromHost('localhost:5173'), null)
  assert.equal(slugFromHost('127.0.0.1'), null)
  assert.equal(slugFromHost('scriber-abc123.vercel.app'), null)
})

// A school that could claim "api" or "admin" would be able to dress itself
// up as the platform, so these must never resolve to an organisation.
test('reserved subdomains cannot be claimed by a school', () => {
  for (const reserved of ['api', 'admin', 'help', 'status', 'staging', 'preview']) {
    assert.equal(slugFromHost(`${reserved}.pracscriber.com`), null, reserved)
    assert.equal(normaliseSlug(reserved), null, reserved)
  }
})

test('rejects hostnames that are not valid labels', () => {
  assert.equal(slugFromHost('-bad.pracscriber.com'), null)
  assert.equal(slugFromHost('a.pracscriber.com'), null)
  assert.equal(slugFromHost('under_score.pracscriber.com'), null)
  assert.equal(slugFromHost(''), null)
})

test('turns a school name into a usable slug', () => {
  assert.equal(normaliseSlug("St Paul's Grammar"), 'st-paul-s-grammar')
  assert.equal(normaliseSlug('  Sydney  Boys  High  '), 'sydney-boys-high')
  assert.equal(normaliseSlug('École'), 'cole')
})

test('refuses a slug that would not survive as a hostname', () => {
  assert.equal(normaliseSlug('!'), null)
  assert.equal(normaliseSlug('a'), null)
  assert.equal(normaliseSlug(''), null)
})

test('a normalised slug always reads back as itself', () => {
  for (const name of ['St Pauls', 'Sydney Boys High', 'kambala-2026']) {
    const slug = normaliseSlug(name)!
    assert.equal(slugFromHost(`${slug}.pracscriber.com`), slug, name)
  }
})
