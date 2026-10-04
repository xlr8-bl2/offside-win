import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileUrl, withSocials } from '../src/social.ts';

test('a handle or a profile link becomes the profile address', () => {
  assert.equal(profileUrl('x', '@offsidewin'), 'https://x.com/offsidewin');
  assert.equal(profileUrl('x', 'offsidewin'), 'https://x.com/offsidewin');
  assert.equal(profileUrl('x', 'https://twitter.com/offsidewin?s=21'), 'https://x.com/offsidewin');
  assert.equal(profileUrl('x', 'x.com/offsidewin/'), 'https://x.com/offsidewin');
  assert.equal(profileUrl('instagram', 'off.side_win'), 'https://instagram.com/off.side_win');
  assert.equal(profileUrl('instagram', 'https://www.instagram.com/off.side_win/'), 'https://instagram.com/off.side_win');
  assert.equal(profileUrl('telegram', 't.me/offsidewin'), 'https://t.me/offsidewin');
  assert.equal(profileUrl('youtube', 'https://youtube.com/@offsidewin'), 'https://youtube.com/@offsidewin');
  assert.equal(profileUrl('youtube', '@offsidewin'), 'https://youtube.com/@offsidewin');
});

test('an empty box clears it, and anything that is not that network is refused', () => {
  assert.equal(profileUrl('x', ''), null);
  assert.equal(profileUrl('x', '   '), null);
  assert.equal(profileUrl('x', 'https://evil.example/offsidewin'), undefined);
  assert.equal(profileUrl('x', 'javascript:alert(1)'), undefined);
  assert.equal(profileUrl('x', 'a-handle-that-is-far-too-long'), undefined);
  assert.equal(profileUrl('instagram', 'https://x.com/offsidewin'), undefined);
  assert.equal(profileUrl('telegram', 'abc'), undefined, 'Telegram names are five or more');
});

const SHELL = `<script type="application/ld+json">{"@type":"Organization","@id":"https://offside.win/#org","name":"Offside.win","url":"https://offside.win/"}</script>
<div class="foot-follow" data-socials hidden><a data-social="x" href="#" hidden target="_blank">X</a><a data-social="youtube" href="#" hidden target="_blank">YT</a></div>`;

test('the page shows only the saved accounts and names them to search engines', () => {
  const out = withSocials(SHELL, { x: 'https://x.com/offsidewin' });
  assert.match(out, /"sameAs":\["https:\/\/x\.com\/offsidewin"\]/);
  assert.match(out, /<a data-social="x" href="https:\/\/x\.com\/offsidewin" target/);
  assert.match(out, /<a data-social="youtube" href="#" hidden/, 'an unsaved one stays hidden');
  assert.match(out, /<div class="foot-follow" data-socials>/);
});

test('with nothing saved, the page is unchanged', () => {
  assert.equal(withSocials(SHELL, {}), SHELL);
});
