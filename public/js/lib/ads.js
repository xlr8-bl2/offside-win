/**
 * Adverts: Google AdSense, a few to a page, never over the content.
 *
 * The site is free and paid for by ads (owner, 17 November 2026), on three
 * rules: no bombardment, nothing that moves the page under a reader's thumb,
 * and never a bookmaker. Each place an advert may go is a marker in the page
 * (adSlotHTML), drawn hidden and taking no room. fillAds turns the markers
 * into units only when the Worker's config names an AdSense publisher and a
 * unit (ADSENSE_CLIENT and ADSENSE_SLOT in worker/wrangler.toml); until then
 * nothing loads, nothing is drawn and nothing is asked of Google.
 *
 * The markers sit below the first screen on every page, so a unit that opens
 * up does not push down anything the reader is already looking at. Each one
 * reserves its height (.ad-slot in components.css) before the advert arrives,
 * and is labelled as an advertisement, so it can never be mistaken for a call.
 *
 * Gambling adverts are kept out at the source: the "Gambling & Betting"
 * category stays blocked in AdSense's own blocking controls (the owner's
 * setting there, written down in HANDOFF.md). Consent for EEA and UK readers
 * is Google's certified consent message, switched on in AdSense's Privacy &
 * messaging; the adsbygoogle script shows it itself.
 */

import { siteConfig } from './auth.js';

/** A place an advert may go, by name (for the owner's reports). Hidden until filled. */
export const adSlotHTML = (place) => `<div class="ad-slot" data-ad="${place}" hidden></div>`;

let loading = null;
function loadScript(client) {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
      s.onload = resolve;
      s.onerror = () => { loading = null; reject(new Error('ads script')); };
      document.head.append(s);
    });
  }
  return loading;
}

/** Turn the page's markers into adverts, when adverts are switched on. */
export async function fillAds(root = document) {
  const markers = [...root.querySelectorAll('.ad-slot[hidden]')];
  if (!markers.length) return;
  let ads = null;
  try { ads = (await siteConfig())?.ads ?? null; } catch { return; }
  if (!ads?.client || !ads?.slot) return;
  for (const el of markers) {
    if (!el.isConnected) continue;
    el.hidden = false;
    el.innerHTML = `<span class="ad-label">Advertisement</span>
      <ins class="adsbygoogle" style="display:block" data-ad-client="${ads.client}" data-ad-slot="${ads.slot}"
        data-ad-format="auto" data-full-width-responsive="true"></ins>`;
  }
  try { await loadScript(ads.client); } catch { return; }
  for (const el of markers) {
    if (!el.isConnected || el.dataset.filled) continue;
    el.dataset.filled = '1';
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* one unit failing is not the page failing */ }
  }
}
