import { describe, it, expect } from 'vitest'
import { isPrivateAddress, parsePreview } from './unfurl'

describe('isPrivateAddress', () => {
  it('blocks loopback, private, link-local, metadata and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '151.101.1.69', '2606:4700::6810:84e5']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })
})

describe('parsePreview', () => {
  it('reads Open Graph tags in either attribute order and resolves the image', () => {
    const html = `<head><title>Fallback</title>
      <meta property="og:title" content="Deconstructing the narrative &amp; more">
      <meta content="A long read" property="og:description">
      <meta property="og:image" content="/img/cover.png">
      <meta property="og:site_name" content="Brown History"></head>`
    expect(parsePreview(html, 'https://brownhistory.substack.com/p/x')).toEqual({
      url: 'https://brownhistory.substack.com/p/x',
      title: 'Deconstructing the narrative & more',
      description: 'A long read',
      image: 'https://brownhistory.substack.com/img/cover.png',
      siteName: 'Brown History',
    })
  })
  it('falls back to <title> and the hostname', () => {
    const p = parsePreview('<title>Just a page</title>', 'https://www.example.com/a')
    expect(p.title).toBe('Just a page')
    expect(p.siteName).toBe('example.com')
    expect(p.image).toBeNull()
  })
  it('drops non-http image URLs', () => {
    expect(parsePreview('<meta property="og:image" content="javascript:alert(1)">', 'https://x.dev').image).toBeNull()
  })
})
