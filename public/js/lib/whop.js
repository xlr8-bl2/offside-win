/**
 * Whop's card form, on our own page.
 *
 * The Worker makes a checkout configuration (price from our plan row, the
 * reader's account id as metadata) and hands back only its id. This mounts
 * Whop's Checkout element with that id inside a sheet over the pricing page.
 * Card numbers go from the element straight to Whop; nothing here sees them.
 *
 * Whop's script is loaded on the tap that opens the sheet and on no other
 * page, for the same reason Google's is: it is a third party, and a reader who
 * is not buying has no reason to fetch it.
 */

const SRC = 'https://cdn.whop.com/elements/amber/elements.js';
let loading = null;

function loadElements() {
  loading ??= new Promise((resolve, reject) => {
    if (window.WhopElements) { resolve(window.WhopElements); return; }
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.setAttribute('data-whop-elements', '');
    s.onload = () => (window.WhopElements ? resolve(window.WhopElements) : reject(new Error('The card form did not start.')));
    s.onerror = () => reject(new Error('The card form could not load.'));
    setTimeout(() => reject(new Error('The card form took too long to load.')), 12000);
    document.head.append(s);
  }).catch((err) => { loading = null; throw err; });
  return loading;
}

/**
 * Open the sheet and mount the checkout. Resolves when it is on screen;
 * rejects if Whop's script cannot load, so the caller can fall back to Whop's
 * own checkout page.
 */
export async function openCheckout({ checkout, returnUrl, title, onPaid }) {
  const sheet = document.createElement('div');
  sheet.className = 'pay-sheet';
  sheet.innerHTML = `
    <div class="pay-panel" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <div class="pay-head">
        <p class="pay-title" id="pay-title"></p>
        <button class="pay-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="pay-body" id="whop-checkout"><p class="pay-wait">Loading the secure card form…</p></div>
      <p class="pay-note">Payment is taken by Whop. Your card details go to Whop and never reach offside.win.</p>
    </div>`;
  sheet.querySelector('.pay-title').textContent = title;
  document.body.append(sheet);
  document.documentElement.classList.add('pay-open');

  let handle = null;
  const close = () => {
    try { handle?.destroy(); } catch { /* already gone */ }
    sheet.remove();
    document.documentElement.classList.remove('pay-open');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  sheet.querySelector('.pay-close').onclick = close;
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  document.addEventListener('keydown', onKey);

  try {
    const WhopElements = await loadElements();
    const whop = WhopElements();
    handle = whop.checkout.create({
      checkoutConfiguration: checkout,
      returnUrl,
      locale: 'en',
      appearance: {
        theme: { appearance: 'dark', accentColor: 'violet', grayColor: 'sand' },
        variables: { '--radius': '10px' },
      },
      onComplete: (result) => {
        if (result?.result !== 'payment') return;
        close();
        onPaid?.(result.paymentId);
      },
    });
    const body = sheet.querySelector('#whop-checkout');
    body.innerHTML = '';
    handle.create('checkout').mount('#whop-checkout');
  } catch (err) {
    close();
    throw err;
  }
  return close;
}
