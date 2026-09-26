/**
 * The legal pages' text: privacy, cookies, terms, refunds, contact,
 * responsible gambling.
 *
 * Its own module, and pure data, so two things can read it: the app, which
 * renders it at #/legal/<page>, and scripts/legal-pages.mjs, which writes the
 * same text as real pages at /privacy and /terms. Those have to exist as
 * plain HTML because Google's brand verification checks the privacy policy
 * at its URL, and a hash route is invisible to anything that reads the raw
 * page. One source, so the two can never disagree.
 */

export const UPDATED = 'September 2026';

/*
 * The address on the contact page. It is referenced from the privacy policy and
 * the refunds policy as well, so it is a constant rather than three strings.
 */
export const SUPPORT_EMAIL = 'support@offside.win';

export const LEGAL = {
  privacy: {
    title: 'Privacy policy',
    body: `
      <p>This is what offside.win knows about you, why, who else sees it, and how to make us
         delete it. If something here is unclear, write to
         <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> and we will explain it.</p>

      <h2>The short version</h2>
      <p>You can read the whole site without telling us anything. If you make an account we hold
         your email address, and if you buy a membership we hold a record of what you bought and when.
         We never see your card. We do not sell data, show adverts or track you on other sites. Visit
         counting and keeping pages on your device only happen if you say yes to them.</p>

      <h2>Who is responsible</h2>
      <p>offside.win is the controller of the personal data described here, which means we decide
         what is collected and are answerable for it. You can reach us at
         <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>

      <h2>What we hold, and why</h2>
      <p><b>If you only read the site</b>, we hold nothing about you. Our host keeps ordinary request
         logs (your IP address, your browser, the page asked for and the time) to keep the site
         running and to stop abuse. We rely on our legitimate interest in running a secure website for
         that, and we do not use the logs to build a picture of anyone.</p>
      <p><b>If you make an account</b>, we hold your email address, because a sign-in link is sent to
         it and it is how your membership finds you. If you sign in with Google instead, Google tells
         us your email address, your name and your profile picture, and that you signed in. We show the
         name and picture on your own account page and in the header, to you and nobody else. We hold
         this to provide the account you asked for.</p>
      <p><b>What you choose to add to your account</b>: the name you want to be called, the teams and
         competitions you follow, and how you like odds written. We use them to greet you, to put your
         teams' games first on the front page, and to write prices your way. Your odds choice is also
         kept on your device so pages open in it straight away. You can change or remove any of it on
         your account page.</p>
      <p><b>If you buy a membership</b>, we hold which plan you bought, when it started and when it
         ends, and a record of each payment: the amount, the currency, the date, whether it went
         through, and the reference our payment provider gave it. We hold this to provide what you
         paid for, and we keep the payment records because tax law requires it.</p>
      <p><b>Your card never reaches us.</b> It is typed into Whop's checkout, on Whop's site, and
         Whop keeps it. We are told that a payment happened, and to which email address.</p>
      <p><b>If you say yes to visit counting</b>, each page you open adds one to a daily count for that
         kind of page (the front page, a fixture page, the results and so on). The count records the
         day and the kind of page. It does not record which fixture, your IP address, your browser or
         anything that could tell you apart from anyone else, and it sets no cookie. If you say no,
         nothing is counted.</p>
      <p>We send email only to sign you in and about your membership: that it started, that it is
         about to renew, that a payment failed. Never marketing.</p>

      <h2>Who else handles it</h2>
      <p>A few companies do part of the work for us. Each gets only what its job needs and may use it
         for nothing else.</p>
      <ul>
        <li><b>Cloudflare</b> hosts the site and keeps the request logs described above.</li>
        <li><b>Supabase</b> stores accounts, memberships and payment records, and runs sign-in.</li>
        <li><b>Whop</b> runs the checkout and the billing, holds your card, and has its own privacy
            policy for the purchase you make with it.</li>
        <li><b>Google</b>, if you choose to sign in with Google. Its sign-in button is loaded from
            Google when you open the sign-in page, so Google sees that request as any server would.</li>
        <li><b>jsDelivr</b> serves the sign-in library to your browser when you sign in or open your
            account, so it sees that request as any server would.</li>
        <li>Club crests, league marks, player photographs and stadium photographs load from our
            football data provider's image server, which sees those requests. No personal data is
            sent to the provider, and our match and odds data comes from it, not from you.</li>
      </ul>
      <p>Some of these companies process data outside the UK and the European Economic Area. Where
         they do, the transfer has to be covered by safeguards UK law recognises, such as standard
         contractual clauses.</p>

      <h2>How long we keep it</h2>
      <p>Your account and membership details stay while you have an account. You can delete the
         account yourself, straight away, from the Settings tab of your account page; or ask us and we
         will do it within 30 days. Deleting it removes your sign-in, name, follows and settings and
         ends any membership. Payment records are kept for six years after the payment, which is what
         UK tax rules require; after an account is deleted they are kept without your email address
         attached. Visit counts are not personal data and are kept as a running total.</p>

      <h2>Your rights</h2>
      <p>You can ask us for a copy of what we hold about you, ask us to correct it, ask us to delete
         it, ask us to stop or limit using it, and ask for it in a form you can take elsewhere. Most of
         this you can do yourself on your account page: download your data as a file, change your
         name and settings, and delete the account. Where
         we rely on your consent, which is only visit counting and keeping pages on your device, you
         can withdraw it at any time from the cookie settings in the footer. Write to
         <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> from the address on your account and
         we will answer within a month.</p>
      <p>If you are unhappy with how we have handled your data you can complain to the Information
         Commissioner's Office (<a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer">ico.org.uk</a>)
         or to the data protection authority where you live. We would rather hear about it first.</p>

      <h2>Under-18s</h2>
      <p>The site is for adults. We do not knowingly hold data about anyone under 18, and if we learn
         that we do, we delete it.</p>

      <h2>Changes</h2>
      <p>When this policy changes, the date at the top changes with it. If a change affects what we
         hold about members or why, we tell members by email before it takes effect.</p>`,
  },
  cookies: {
    title: 'Cookies and storage',
    body: `
      <p>The site sets no cookies of its own. It does keep a few small items in your browser's
         storage, which the law treats the same way, so here is every one of them.</p>

      <h2>Always on, because the site needs them</h2>
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>Item</th><th>What it does</th><th>How long</th></tr></thead>
        <tbody>
          <tr><td><code>ow.consent</code></td><td>Remembers your answer below, so you are not asked on every visit.</td><td>Until you change it or clear the site's data</td></tr>
          <tr><td><code>sb-…-auth-token</code></td><td>Keeps you signed in. Set only when you sign in.</td><td>Until you sign out</td></tr>
          <tr><td><code>ow.after-signin</code></td><td>Remembers what you were doing when we asked you to sign in, such as buying a membership, so you land back there.</td><td>Removed as soon as it has been used</td></tr>
          <tr><td><code>offside.country</code></td><td>The country you picked for bookmaker prices, if you changed it.</td><td>Until you change it</td></tr>
        </tbody>
      </table></div>

      <h2>Only if you say yes</h2>
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>What</th><th>What it does</th><th>How long</th></tr></thead>
        <tbody>
          <tr><td>Saved pages (<code>ow.c1:…</code>)</td><td>A copy of each page's data, so the site opens instantly on your next visit and then updates.</td><td>Replaced as pages update; deleted if you change your answer to no</td></tr>
          <tr><td>Visit counting</td><td>One anonymous count per page opened, by kind of page. Nothing is stored on your device for this.</td><td>Not stored on your device</td></tr>
        </tbody>
      </table></div>

      <h2>Nothing else</h2>
      <p>No advertising, no tracking pixels, no social media widgets, and no analytics company.
         Fonts are served from this site. If your browser sends the Global Privacy Control signal we
         treat it as a no without asking.</p>`,
  },
  terms: {
    title: 'Terms of use',
    body: `
      <p>These terms cover using offside.win and buying a membership. Using the site means you
         accept them; if you do not, please do not use it. Nothing here takes away rights you have
         under consumer law.</p>

      <h2>What the site is</h2>
      <p>offside.win publishes analysis of football matches and our calls on them: which outcome
         we think is likeliest, the price a bookmaker is offering on it, and our reasons. The
         analysis is built from match data and bookmakers' published prices. Some of the written
         analysis is drafted with the help of an AI language model working from that data, and every
         paragraph passes our own checks before it is shown.</p>

      <h2>What it is not</h2>
      <p>It is not betting advice, and it is not a promise that you will make money. A call is our
         opinion about a football match. Results are published in full, the losing calls included, so
         you can judge the record for yourself. Whether you bet, and how much, is your decision and
         your responsibility.</p>
      <p>Prices move and team news changes. What is on a page is correct as of the time it shows,
         and may have changed by the time you read it.</p>

      <h2>Who can use it</h2>
      <p>You must be 18 or over. Betting is restricted or illegal in some places, and it is up to
         you to know the law where you are.</p>

      <h2>Your account</h2>
      <p>An account is for one person. Keep access to your email address secure, because a sign-in
         link sent there is what lets someone into the account.</p>

      <h2>Membership and payment</h2>
      <p>Reading the site is free, and one full call a day is free. A membership shows every call
         the moment it goes up, the bet slip's legs, and the reasons for every call.</p>
      <p>The <b>matchday pass</b> is one payment for seven days and does not renew. The <b>monthly</b>
         membership and the <b>season ticket</b> renew automatically at the end of each period, at the
         price you bought at, until you cancel. We will tell you before a price changes, and a new
         price only applies from your next renewal after we have told you.</p>
      <p>Payment is taken by Whop on its own checkout. Your membership is linked to the email address
         you pay with, so sign in here with that address. You can cancel a renewing membership at any
         time from your Whop account; you keep access until the end of the period you have paid for
         and are not charged again.</p>
      <p>You have 14 days from your first payment to change your mind and get a full refund, whatever
         you have read in that time. Many sellers of digital content ask you to give that right up at
         checkout; we do not. The refunds page has the detail.</p>

      <h2>Using what you read</h2>
      <p>The analysis, the calls and the way they are presented belong to us. You are welcome to
         read them, talk about them and share links to them. Please do not copy calls to publish or
         sell elsewhere, share your account, or use automated tools to collect content from the site
         or get round the membership wall. If an account is used that way we may end the membership;
         if we end one for any other reason we refund the unused part.</p>

      <h2>If something goes wrong</h2>
      <p>We work to keep the site running and the data right, but we cannot promise it will always
         be available or free of mistakes. If we get a scoreline or a result wrong, tell us and we
         will correct it on the record.</p>
      <p>We are not responsible for money you stake or lose. Beyond that, our total responsibility to
         you for anything connected with the site is limited to what you have paid us in the 12
         months before the problem arose. None of this limits our responsibility for anything the law
         does not allow us to limit, such as fraud, or death or injury caused by negligence.</p>

      <h2>Changes and law</h2>
      <p>We may update these terms. The date at the top shows the latest version; if a change
         affects members, we tell them by email before it takes effect. These terms are governed by
         the law of England and Wales, and if you live elsewhere in the UK or in the EU you keep any
         protection the law where you live gives you.</p>`,
  },
  refunds: {
    title: 'Refunds',
    body: `
      <h2>If it did not work</h2>
      <p>If the site was down or your membership did not start after you paid, tell us and we will
         put it right: either extra time on your membership to cover what you lost, or your money
         back in full. There is no form to fill in.</p>
      <h2>If you changed your mind</h2>
      <p>Write to us within 14 days of your first payment and you get it all back, whatever you have
         read in that time. Your access starts the moment you pay, and we do not ask you to give up
         the 14 days in exchange for that.</p>
      <h2>If you want to stop</h2>
      <p>A matchday pass ends by itself. A monthly membership or a season ticket is cancelled from
         your Whop account, in one step. You keep access until the end of the period you have paid
         for and you are not charged again. We do not refund part of a period that has already
         started.</p>
      <h2>What we do not refund</h2>
      <p>Bets. A call is an opinion about a match, not a promise, and the full record of wins and
         losses is public so you can see how the calls do before you pay anything.</p>
      <h2>How to ask</h2>
      <p>Write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> from the email address on
         the account. Refund requests get an answer within two working days, and the money goes back
         to the card you paid with.</p>`,
  },
  /*
   * A way to reach a person.
   *
   * The privacy and refunds pages both told readers to write to "the address
   * on our contact page", and there was no contact page -- on a site that
   * takes money, from strangers, under a refund policy that asks them to write
   * in. Both of those sentences now point somewhere.
   *
   * SUPPORT_EMAIL is the one thing on this page that has to be real. Change it
   * in one place if the mailbox moves.
   */
  contact: {
    title: 'Contact',
    body: `
      <p>One address, read by a person.</p>
      <h2>Anything at all</h2>
      <p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
      <p>Refunds, a membership that did not start, a scoreline we have got wrong, a question about
         what we hold on you, or a complaint. Write from the email address on your account where
         the question is about your account. It saves us asking you to prove it is you.</p>
      <h2>What to expect</h2>
      <p>We answer every email, including the ones where the answer is no. Refund requests are
         answered within two working days; everything else as soon as we can.</p>
      <h2>What we cannot help with</h2>
      <p>We are not a bookmaker and we hold no betting account. If a bet has been settled in a way
         you disagree with, that is between you and the book that took it. The rules that decided
         it are theirs, not ours. If gambling has stopped being something you can afford, the
         <a href="#/legal/responsible">responsible gambling page</a> lists people who can help, and
         they are better placed than we are.</p>`,
  },
  responsible: {
    title: 'Responsible gambling',
    body: `
      <p>Betting should be entertainment you can afford. If it has stopped being that, the
         information below is more useful than any pick on this site.</p>
      <h2>Signs worth taking seriously</h2>
      <ul>
        <li>Betting more than you planned, or more than you can comfortably lose.</li>
        <li>Chasing losses: staking more to win back what has gone.</li>
        <li>Borrowing money to bet, or hiding betting from people close to you.</li>
        <li>Betting to escape stress or low mood rather than for enjoyment.</li>
      </ul>
      <h2>Practical steps</h2>
      <ul>
        <li>Set a deposit limit with your bookmaker before you need one.</li>
        <li>Use self-exclusion. <a href="https://www.gamstop.co.uk" target="_blank" rel="noopener noreferrer">GAMSTOP</a>
            covers every licensed operator in Great Britain in one step.</li>
        <li>Block gambling sites with software such as Gamban, and turn on your bank's gambling block.</li>
      </ul>
      <h2>Free, confidential help</h2>
      <ul>
        <li><a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer">BeGambleAware</a>: advice and a 24/7 helpline on 0808 8020 133.</li>
        <li><a href="https://www.gamcare.org.uk" target="_blank" rel="noopener noreferrer">GamCare</a>: support for anyone affected by gambling, including family.</li>
        <li><a href="https://www.gamblersanonymous.org" target="_blank" rel="noopener noreferrer">Gamblers Anonymous</a>: meetings worldwide.</li>
      </ul>
      <p><b>A high strike rate is not a safe bet.</b> Everything published here can be right more often
         than not and still lose money at the wrong price. Please treat it accordingly.</p>`,
  },
};
