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

export const UPDATED = '27 September 2026';

/*
 * The address on the contact page. It is referenced from the privacy policy and
 * the refunds policy as well, so it is a constant rather than three strings.
 */
export const SUPPORT_EMAIL = 'support@offside.win';

/*
 * Who runs the site. UK law (the Electronic Commerce Regulations 2002 and the
 * Consumer Contracts Regulations 2013) requires a trader's name and a postal
 * address, where a complaint or a legal claim can be sent, to be on the site.
 * Offside.win is run by a sole trader. Fill both in and the legal pages say
 * so; a registered-office or virtual-office address is fine. Until they are
 * filled in the pages say only that it is a sole trader in the UK.
 */
export const OPERATOR = {
  name: '',
  address: '',
};
const OPERATOR_HTML = OPERATOR.name && OPERATOR.address
  ? `<p>Offside.win is a trading name of <b>${OPERATOR.name}</b>, a sole trader based in the United
       Kingdom. Postal address: ${OPERATOR.address}.</p>`
  : `<p>Offside.win is run by a sole trader based in the United Kingdom.</p>`;

/* The date this version of the terms took effect, cited at checkout. */
export const TERMS_VERSION = '2026-09-27';

export const LEGAL = {
  privacy: {
    title: 'Privacy policy',
    kicker: 'what we know about you',
    standfirst: `What Offside.win holds about you, why it holds it, who else touches it, how long it
      stays, and how to make us hand it over or delete it. Written to be read, because a privacy
      policy nobody can follow protects nobody.`,
    summary: [
      'You can read every free page without telling us anything.',
      'An account holds your email address and the settings you choose. A membership adds a record of what you bought and when.',
      'Your card never reaches us. Whop takes the payment and keeps the card.',
      'We do not sell your data, share it for advertising, or track you across other sites.',
      'Members’ calls carry a mark tied to the account that sees them, so a leak can be traced. That is covered in full below.',
      'You can download or delete your data from your account page, and you can complain to the Information Commissioner at any time.',
    ],
    sections: [
      {
        id: 'who',
        title: 'Who we are',
        body: `
      <p>Offside.win (“we”, “us”) publishes analysis of football matches and a call on each one. For
         the personal data described in this policy we are the <b>controller</b>: we decide what is
         collected and why, and we answer for it under the UK General Data Protection Regulation
         (UK GDPR), the Data Protection Act 2018 and the Privacy and Electronic Communications
         Regulations 2003 (PECR), as amended by the Data (Use and Access) Act 2025.</p>
      ${OPERATOR_HTML}
      <p>The quickest way to reach us about anything in this policy is
         <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. A person reads every email.</p>
      <p>We are a small business and are not required to appoint a data protection officer. The
         person who runs Offside.win is responsible for data protection.</p>`,
      },
      {
        id: 'collect',
        title: 'What we collect',
        body: `
      <p><b>If you only read the site</b>, we collect nothing that identifies you. Our host,
         Cloudflare, sees each request as any web server does: your IP address, your browser’s
         description of itself, the address asked for and the time. It uses that to deliver the
         page and to block attacks, and keeps it briefly. We do not use it to build a picture of
         anyone.</p>
      <p><b>If you make an account</b>, we hold:</p>
      <ul>
        <li>your <b>email address</b>, because sign-in links are sent to it and it is how a
            membership finds its account;</li>
        <li>if you sign in with Google, the <b>name and profile picture</b> Google shares with us,
            and the fact that you signed in with Google;</li>
        <li>what you choose to add: a <b>username</b>, the name you want to be called, the
            <b>teams and competitions you follow</b>, and how you like odds and times written;</li>
        <li>when the account was made and when it last signed in.</li>
      </ul>
      <p><b>If you buy a membership</b>, we hold which plan, when it started and ends, whether it
         renews, and a record of each payment: amount, currency, date, whether it went through,
         and the reference our payment provider gave it. We may also hold your card’s brand and
         last four digits (“Visa ending 4242”), which the provider passes on so your account page
         can show which card pays. We never hold the full card number, its expiry date or its
         security code.</p>
      <p><b>When you buy</b>, we record what you confirmed at checkout: that you are 18 or over,
         that you agree to these terms (and which version), and that you asked for access to start
         straight away and understood that ends your right to cancel. We keep this so we can show,
         if it is ever questioned, what was agreed and when.</p>
      <p><b>When members read members’ calls</b>, the page carries a faint mark with your username
         or account code, and text copied from those calls carries the same code in characters
         that do not show on screen. The code is the first eight characters of your account’s
         internal ID. It is not your email address and means nothing outside our database. If a
         members’ call turns up somewhere it should not be, we may read the code out of the copy
         and look up the account it belongs to. Section 4 explains why.</p>
      <p><b>When you write to us</b>, we hold the email and our reply, so we can help and so there
         is a record if the question comes back.</p>
      <p><b>If you say yes to visit counting</b>, each page you open adds one to a daily count for
         that kind of page. The count holds the day and the kind of page and nothing else: not the
         match, not your IP address, not your browser. It is not personal data. If you say no,
         nothing is counted.</p>
      <p>We do not collect special category data (such as health, religion or ethnicity), we do
         not buy data about you from anyone, and we do not use data brokers.</p>`,
      },
      {
        id: 'why',
        title: 'Why we use it, and the law that lets us',
        body: `
      <p>Data protection law only allows personal data to be used for a reason it recognises. These
         are ours.</p>
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>What for</th><th>What it uses</th><th>The legal basis</th></tr></thead>
        <tbody>
          <tr><td>Running your account and signing you in</td><td>Email, Google profile, settings</td><td>Contract: you asked for an account</td></tr>
          <tr><td>Providing a membership you paid for</td><td>Account, plan, payment records</td><td>Contract</td></tr>
          <tr><td>Keeping payment records</td><td>Payment records</td><td>Legal obligation: tax and accounting law</td></tr>
          <tr><td>Recording what you confirmed at checkout</td><td>Consent record</td><td>Legal obligation (consumer law) and legitimate interests (being able to prove it)</td></tr>
          <tr><td>Marking members’ calls and tracing leaks</td><td>Account code, username, the leaked copy</td><td>Legitimate interests: protecting what members pay for</td></tr>
          <tr><td>Stopping fraud, abuse and payment disputes</td><td>Account, payment records, request logs</td><td>Legitimate interests</td></tr>
          <tr><td>Answering your emails and complaints</td><td>What you send us</td><td>Legitimate interests, or contract when it is about your membership</td></tr>
          <tr><td>Saved pages and visit counting</td><td>Storage on your device; an anonymous count</td><td>Consent, which you can withdraw</td></tr>
          <tr><td>Defending or bringing a legal claim</td><td>Whatever is relevant to it</td><td>Legitimate interests</td></tr>
        </tbody>
      </table></div>
      <p>We send email only to sign you in and about your membership: that it started, that it is
         due to renew, that a payment failed, or that these terms or this policy have changed in a
         way that affects you. We do not send marketing email, and if that ever changes we will
         ask first.</p>`,
      },
      {
        id: 'interests',
        title: 'Our legitimate interests, and your right to object',
        body: `
      <p>Where we rely on legitimate interests we have weighed our reasons against your privacy.
         Here they are, so you can weigh them too.</p>
      <p><b>Protecting members’ calls.</b> Members pay for the calls. If one member posts them to a
         group or a channel, every other member is paying for something being given away. The
         marks let us find the account a leak came from without watching anyone: nothing is
         tracked while you read, the code is only looked at when a leak is found, and the code
         cannot identify you to anyone outside Offside.win. If a leak traces to your account we
         will tell you before we act, and you can explain.</p>
      <p><b>Security and fraud.</b> We keep enough to spot accounts being shared, payments being
         abused and the site being attacked.</p>
      <p><b>Legal claims.</b> If there is a dispute, a chargeback or a claim, we use the records
         relevant to it.</p>
      <p>You have the right to object to any use based on legitimate interests. Write to us and we
         will stop unless we have a compelling reason to continue that overrides your interests, or
         we need the data to bring or defend a legal claim. We will tell you which, and why.</p>`,
      },
      {
        id: 'share',
        title: 'Who else handles it',
        body: `
      <p>A few companies do part of the work. Those acting as our <b>processors</b> handle data only
         on our instructions and under a written contract, and may not use it for themselves.</p>
      <ul>
        <li><b>Cloudflare</b> (processor) hosts the site, runs its server code, and keeps the request
            logs described above.</li>
        <li><b>Supabase</b> (processor) stores accounts, memberships and payment records, runs
            sign-in, and sends the sign-in emails.</li>
        <li><b>Whop</b> runs checkout and billing and holds your card. For the payment details you
            give it, Whop is a <b>controller in its own right</b>, under its own privacy policy. We receive the result of each payment and the
            email address given to Whop.</li>
        <li><b>Google</b>, only if you choose Google sign-in. Google is a controller for your Google
            account and tells us your email, name and picture. Its sign-in button loads from Google,
            so Google sees that request.</li>
        <li><b>jsDelivr</b> serves the sign-in library to your browser on the sign-in and account
            pages, and sees that request.</li>
        <li>Our <b>football data provider</b> supplies fixtures, results, odds and images. Crests and
            photographs load from its image server, which sees those requests. It receives no
            personal data from us.</li>
        <li><b>Google Gemini</b>, an AI service, helps draft some of the match writing. It is sent
            match data only (teams, form, results, prices) and never anything about you.</li>
      </ul>
      <p>Beyond those, we share personal data only where the law requires it (a court order, or a
         lawful request from the police or a regulator); with professional advisers bound by
         confidentiality, such as an accountant or a solicitor; to bring or defend a legal claim;
         or with whoever takes over Offside.win if the business is sold, in which case this policy
         goes with it and we will tell you first.</p>
      <p><b>We do not sell personal data</b>, and we do not share it for advertising.</p>`,
      },
      {
        id: 'transfers',
        title: 'Data leaving the UK',
        body: `
      <p>Some of the companies above are based in, or use servers in, the United States and other
         countries outside the UK. When personal data goes to a country the UK has not recognised
         as protecting it adequately, the transfer relies on a safeguard UK law accepts: the UK
         Extension to the EU–US Data Privacy Framework where the recipient is certified to it, or
         the International Data Transfer Agreement or the UK Addendum to the EU standard
         contractual clauses. You can ask us for details of the safeguard for any transfer.</p>`,
      },
      {
        id: 'retention',
        title: 'How long we keep it',
        body: `
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>What</th><th>How long</th></tr></thead>
        <tbody>
          <tr><td>Your account and settings</td><td>Until you delete the account</td></tr>
          <tr><td>Payment records</td><td>Six years from the end of the tax year they fall in, as tax law requires. After an account is deleted they are kept without your email attached.</td></tr>
          <tr><td>What you confirmed at checkout</td><td>Six years after the membership ends, the time in which a claim about it can be brought</td></tr>
          <tr><td>A leak investigation</td><td>Until it is resolved, then six years if it led to action against the account; otherwise deleted</td></tr>
          <tr><td>Emails with us</td><td>Two years after the conversation ends, or longer if it is part of a dispute</td></tr>
          <tr><td>Request logs</td><td>Cloudflare’s own short retention; we do not keep copies</td></tr>
          <tr><td>Visit counts</td><td>Kept as running totals; they are not personal data</td></tr>
        </tbody>
      </table></div>
      <p>You can delete your account yourself, straight away, from the Settings tab of your account
         page, or ask us and we will do it within 30 days. Deleting it removes your sign-in,
         username, name, follows and settings, and ends any membership without a refund for time
         left. Backups roll over within 30 days.</p>`,
      },
      {
        id: 'rights',
        title: 'Your rights',
        body: `
      <p>Under UK data protection law you can ask us:</p>
      <ul>
        <li>for a <b>copy</b> of the personal data we hold about you;</li>
        <li>to <b>correct</b> anything that is wrong or incomplete;</li>
        <li>to <b>delete</b> it;</li>
        <li>to <b>restrict</b> how we use it while a question about it is settled;</li>
        <li>to give it to you, or another service, in a <b>portable</b> file;</li>
        <li>to <b>stop</b> using it where we rely on legitimate interests (see section 4);</li>
        <li>to <b>withdraw consent</b> where that is our basis, which only covers saved pages and
            visit counting, from the cookie settings in the footer.</li>
      </ul>
      <p>Much of this you can do yourself: the account page downloads your data as a file, edits
         your profile and settings, and deletes the account. For anything else write to
         <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> from the email address on the
         account. It is free. We answer within one month, or tell you within that month if a
         complicated request needs up to two more. If we cannot tell it is you, we will ask for
         something that proves it, and ask for nothing more than that.</p>
      <p>Some rights have limits the law sets. For example, we cannot delete payment records tax law
         says we must keep, and we will say so if that is the reason.</p>
      <p>We make <b>no decisions about you by automated means</b> that have legal or similarly
         significant effects. The calls are opinions about football matches, not about you.</p>`,
      },
      {
        id: 'complaints',
        title: 'Complaints',
        body: `
      <p>If you are unhappy with how we have handled your data, tell us first at
         <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> with “data protection complaint” in
         the subject. We acknowledge every complaint within 30 days, look into it, and tell you
         what we found and what we are doing about it without undue delay.</p>
      <p>You can also complain to the Information Commissioner’s Office, the UK regulator, at
         <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer">ico.org.uk/make-a-complaint</a>
         or on 0303 123 1113. If you live in the European Economic Area you can complain to the
         data protection authority where you live. You do not have to come to us first, but we
         would rather have the chance to put it right.</p>`,
      },
      {
        id: 'security',
        title: 'Keeping it safe',
        body: `
      <p>Everything travels over encrypted connections. The database refuses every read that is
         not allowed by a rule written for that table, and the public key the site uses cannot
         read accounts, payments or anyone else’s settings at all. Card details never reach our
         systems. Sign-in works by one-time links and Google, so we hold no passwords to lose.
         Access to the data behind the site is limited to the person who runs it.</p>
      <p>No system is perfectly secure. If a breach puts your rights at risk we will tell you and
         the Information Commissioner as the law requires, within 72 hours of learning of it where
         we must.</p>`,
      },
      {
        id: 'children',
        title: 'Under-18s',
        body: `
      <p>Offside.win is for adults. It is about betting prices, and it is not designed for or
         directed at anyone under 18. Buying a membership needs you to confirm you are 18 or over.
         We do not knowingly hold data about anyone under 18; if we learn that we do, we delete it
         and close the account.</p>`,
      },
      {
        id: 'storage',
        title: 'Cookies and storage on your device',
        body: `
      <p>The site sets no cookies of its own. It keeps a few small items in your browser’s storage,
         which PECR treats the same way as cookies. The ones the site needs to work (keeping you
         signed in, remembering your cookie answer) are always on; saved pages and visit counting
         are only on if you say yes. Every item is listed on the
         <a href="#/legal/cookies">cookies and storage page</a>, where you can change your answer.
         If your browser sends the Global Privacy Control signal we treat it as a no.</p>`,
      },
      {
        id: 'elsewhere',
        title: 'If you live outside the UK',
        body: `
      <p><b>In the European Economic Area</b>, the EU GDPR gives you the same rights as section 8,
         and you can complain to your local data protection authority.</p>
      <p><b>In the United States</b>, we do not sell personal information and do not share it for
         cross-context behavioural advertising, we do not use sensitive personal information, and
         we have not done so in the past twelve months. Whatever your state’s law requires of a
         business our size, you can ask us for a copy of your data or for it to be deleted, and we
         will not treat you differently for asking. We do not share personal information with
         anyone for their own direct marketing.</p>`,
      },
      {
        id: 'changes',
        title: 'Changes to this policy',
        body: `
      <p>When this policy changes, the date at the top changes with it and the old version is
         available on request. If a change affects what we hold about members or why, we email
         members before it takes effect.</p>`,
      },
    ],
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
    kicker: 'the rules of the game',
    standfirst: `The agreement between you and Offside.win: what the site is and is not, what a
      membership buys, how paying and cancelling work, what you may do with what you read, and
      what happens when something goes wrong. Nothing here takes away a right the law gives you
      as a consumer.`,
    summary: [
      'You must be 18 or over. Offside.win gives opinions about football matches. It is not a bookmaker, it takes no bets, and nothing here is advice to bet.',
      'No call is a promise. The whole record is public, the losses included, and following the calls can lose you money.',
      'A membership starts the moment you pay. At checkout you ask for that and accept that it ends your 14-day right to cancel. If something of ours fails, you still get a fix or your money back.',
      'Renewing memberships renew until you cancel, and cancelling takes one step. You keep access to the end of the period you paid for.',
      'Members’ calls are for you alone. Posting, selling or passing them on ends the membership without a refund.',
      'We are responsible for what the law says we are responsible for, and never for money you stake or lose.',
    ],
    sections: [
      {
        id: 'about',
        title: 'About these terms',
        body: `
      <p>These terms are a contract between you and Offside.win (“we”, “us”). They apply when you
         use offside.win and when you buy a membership. Together with the
         <a href="#/legal/privacy">privacy policy</a>, the <a href="#/legal/cookies">cookies and
         storage page</a> and the <a href="#/legal/refunds">refunds page</a>, they are the whole
         agreement. By using the site you accept them. If you do not, please do not use it.</p>
      ${OPERATOR_HTML}
      <p>You can reach us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. These terms are
         in English, and you can save or print this page for your records.</p>
      <p>If you are a consumer, nothing in these terms affects your statutory rights, including
         those under the Consumer Rights Act 2015 and the Consumer Contracts (Information,
         Cancellation and Additional Charges) Regulations 2013. Where a term says otherwise, the
         law wins.</p>`,
      },
      {
        id: 'what',
        title: 'What Offside.win is',
        body: `
      <p>Offside.win publishes previews and analysis of football matches and, on many of them, a
         <b>call</b>: the outcome we think is most likely, the best price a bookmaker is offering on
         it where you are, the bookmaker offering it, and our reasons. We publish the result of
         every call afterwards, won or lost.</p>
      <p>Calls are made from match data, team news and bookmakers’ published prices. They are looked
         at again through the day, so a call can change or be withdrawn before kick-off, and each
         closes when its match starts. What a page shows is correct at the time it shows it.</p>
      <p><b>How the writing is made.</b> Some match writing is drafted with the help of AI tools
         working only from match data, and every paragraph passes our own automated checks before
         it is published. The calls themselves are not written by an AI.</p>
      <p><b>Independence.</b> No bookmaker pays us for a call, and our links to bookmakers are not
         paid links. If that ever changes we will label the paid link where it appears.</p>`,
      },
      {
        id: 'not',
        title: 'What it is not',
        body: `
      <p><b>It is not advice.</b> A call is our opinion about a football match. It is not betting,
         financial or investment advice, and it does not take your circumstances into account.</p>
      <p><b>It is not a promise.</b> Football is unpredictable and a likely outcome is not a certain
         one. Past results, including our own record, do not predict future ones. A call can be
         right more often than not and still lose money at the price you took. We do not claim, and
         you should not assume, that following the calls will make you money.</p>
      <p><b>We are not a bookmaker.</b> We do not take bets, hold betting accounts, handle stakes or
         place bets for anyone. Offside.win is not licensed by the Gambling Commission because it
         does not offer gambling, and it is not regulated by the Financial Conduct Authority. Any bet
         you place is a contract between you and the bookmaker, on its terms. Prices change, and a
         bookmaker may offer a different price, limit your stake or refuse your bet. That is between
         you and it.</p>
      <p>Whether you bet, on what and how much, is your decision and your responsibility.</p>`,
      },
      {
        id: 'who',
        title: 'Who can use it',
        body: `
      <p>You must be <b>18 or over</b> to use Offside.win. Buying a membership needs you to confirm it.
         If we have reason to believe an account belongs to someone under 18, we close it and refund
         any payment.</p>
      <p>Betting is restricted or illegal in some countries and some US states. It is your
         responsibility to know and follow the law where you are. We may refuse or end service to
         anyone in a place where offering it would break the law.</p>`,
      },
      {
        id: 'responsible',
        title: 'Gambling responsibly',
        body: `
      <p>Bet only with money you can afford to lose, and never to chase losses or solve money
         problems. If betting stops being fun, stop. Our
         <a href="#/legal/responsible">responsible gambling page</a> lists free, confidential help,
         including <a href="https://www.gamstop.co.uk" target="_blank" rel="noopener noreferrer">GAMSTOP</a>
         and the National Gambling Helpline on 0808 8020 133. If you tell us gambling has become a
         problem for you, we will close your account and refund any unused membership.</p>`,
      },
      {
        id: 'account',
        title: 'Your account',
        body: `
      <p>An account is for <b>one person</b>. Keep access to your email address secure, because a
         sign-in link sent there opens the account. You are responsible for what happens under your
         account unless it was used without your permission and you had taken reasonable care.
         Tell us straight away if you think someone else has got in.</p>
      <p>A <b>username</b> must not pretend to be someone else, suggest you speak for a club,
         league, player or bookmaker, or be offensive, hateful or unlawful. We may ask you to change
         a username that breaks this, or change it ourselves.</p>
      <p>You can close your account at any time from the account page.</p>`,
      },
      {
        id: 'membership',
        title: 'Memberships',
        body: `
      <p>Reading the site is free, and one full call a day is free. A <b>membership</b> shows every
         call the moment it goes up, the legs of the bet slip before its first match starts, and the
         reasons behind every call.</p>
      <ul>
        <li>The <b>matchday pass</b> is one payment for seven days. It does not renew.</li>
        <li>The <b>monthly membership</b> renews every month and the <b>season ticket</b> every year,
            at the end of each period, until you cancel.</li>
      </ul>
      <p>The price, what it covers, how long it lasts and whether it renews are shown on the
         pricing page and again at checkout, before you pay. Prices include any VAT or sales tax we
         must charge, and the checkout shows the final amount in your currency.</p>
      <p><b>Price changes.</b> A renewing membership renews at the price you signed up at. If we
         change it, we tell you at least 30 days before the new price applies, and it applies only
         from your next renewal after that. You can cancel before then and pay nothing more.</p>
      <p><b>Changes to what is included.</b> We keep improving the site and may change features. We
         will not take away the core of what you paid for (every call, the slip’s legs and the
         reasons) during a period you have paid for. If we ever have to, you can cancel and get a
         refund for the time left.</p>`,
      },
      {
        id: 'payment',
        title: 'Paying',
        body: `
      <p>Payments are taken by <b>Whop</b>, in a card form on our checkout page that Whop runs, and
         Whop’s own terms apply to the payment. Card details go to Whop and never reach us. The
         membership goes on the Offside.win account you are signed in with when you pay.</p>
      <p>For a renewing membership you authorise Whop to charge the same payment method at the
         start of each new period until you cancel. If a renewal payment fails, access may pause
         until it is paid.</p>
      <p>Your bank may charge its own fees for payments in another currency. We do not control
         those.</p>
      <p><b>Chargebacks.</b> If you think a charge is wrong, please write to us first: we can
         usually fix it the same day. If you dispute a genuine charge with your bank instead, we may
         suspend the membership while the dispute is open and close it if the dispute is decided in
         your favour.</p>`,
      },
      {
        id: 'cancel',
        title: 'Your right to cancel, and when it ends',
        body: `
      <p>The law normally gives you 14 days after buying digital content to change your mind. For a
         membership that starts straight away, that right ends once access begins, but only if you
         have asked for it to begin and accepted that you lose the right.</p>
      <p>That is how membership works. <b>At checkout you tick two boxes</b>: one confirming you are
         18 or over and agree to these terms, and one asking for the membership to start
         immediately and accepting that you then lose the right to cancel. You cannot pay without
         both. We record your confirmation with the time and the version of these terms, and
         confirm it to you. Once the membership has started, there is no refund for changing your
         mind.</p>
      <p>If for any reason your confirmation was not validly given or confirmed, you keep the full
         14-day right, and we will honour it.</p>
      <p>Memberships bought before 27 September 2026 keep the 14-day refund promised when they were
         bought, for that purchase.</p>
      <p><b>If something of ours goes wrong</b>, your rights are separate and unaffected. Digital
         content must be as described, of satisfactory quality and fit for purpose. If the
         membership did not start, the site was unavailable for a significant part of what you paid
         for, or it did not work as described, we will fix it or refund you in full or in part, as
         the Consumer Rights Act 2015 requires. The <a href="#/legal/refunds">refunds page</a> has
         the detail.</p>`,
      },
      {
        id: 'stop',
        title: 'Stopping a renewing membership',
        body: `
      <p>You can stop a monthly membership or a season ticket <b>at any time, in one step</b>, from
         your account page or your Whop account. No call, no form, no offer to talk you out of it.
         You keep access until the end of the period you have paid for and are not charged again.
         We do not refund part of a period that has already started, except where section 9 or the
         law says we must.</p>`,
      },
      {
        id: 'yours',
        title: 'Members’ calls are for you',
        body: `
      <p>A membership gives you a <b>personal, non-transferable licence</b> to read members’ calls,
         the slip’s legs and the reasons, for your own use, for as long as the membership lasts.</p>
      <p>You may not post, forward, sell, screenshot for others or otherwise pass on members’ calls
         or the slip’s legs, in a group, a channel, a forum, a social network, a tipping service or
         anywhere else, whether or not you charge for it. You may not share your account or sign-in
         links. Today’s free call and settled results are yours to share, and the share buttons
         share only what is free.</p>
      <p>Members’ calls carry marks that identify the account they were shown to, as the
         <a href="#/legal/privacy">privacy policy</a> explains. If a members’ call is found
         elsewhere and traces to your account, we will tell you what we found and give you the
         chance to explain. If we are satisfied it was passed on, we will end the membership
         without a refund, may close the account, and may claim for the loss it caused us,
         including for infringement of our copyright and database right.</p>`,
      },
      {
        id: 'ip',
        title: 'Our content, and other people’s',
        body: `
      <p>The calls, the writing, the record, the design of the site and the database behind it
         belong to us or the people who license them to us, and are protected by copyright and
         database right. Apart from what these terms allow, you may not copy, republish, sell or
         build a product or dataset from them.</p>
      <p>You are welcome to read, talk about and link to anything on the site, and to quote short
         passages with a credit and a link.</p>
      <p>Club names, crests, competition names and marks, and photographs belong to their owners
         and are used only to identify the teams, competitions and people concerned. Offside.win is
         not endorsed by, sponsored by or connected with any club, league, competition, player or
         bookmaker.</p>
      <p>If you believe something on the site infringes your rights, write to
         <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> with what it is, where it is and
         why, and we will look at it promptly and take it down if you are right.</p>`,
      },
      {
        id: 'use',
        title: 'Using the site fairly',
        body: `
      <p>You agree not to:</p>
      <ul>
        <li>use bots, scrapers or other automated tools to collect content, or to copy the site at
            scale, other than ordinary search engine indexing;</li>
        <li>get round the membership wall or the marks on members’ calls, or try to remove them;</li>
        <li>interfere with the site, test its security without our written permission, or attack
            it, overload it or put anything harmful into it;</li>
        <li>open accounts to abuse the free call, a refund or an offer;</li>
        <li>use the site for anything unlawful, including fraud or money laundering;</li>
        <li>present our calls as your own, or use them in a service that competes with ours.</li>
      </ul>
      <p>Doing any of these may break the Computer Misuse Act 1990, copyright law or both, as well
         as these terms.</p>`,
      },
      {
        id: 'accuracy',
        title: 'Accuracy and availability',
        body: `
      <p>Fixtures, kick-off times, line-ups, results and prices come from third-party data and
         bookmakers. We work to get them right and to correct mistakes quickly, but they can be
         wrong or late, and kick-off times and prices change. Always check the price and the market
         with the bookmaker before you bet. If we get a result or a scoreline wrong, tell us and we
         will correct it on the record.</p>
      <p>We aim to keep the site available, but it may be interrupted for maintenance, by
         problems with our suppliers or by events outside our control. If an interruption means you
         did not get a significant part of what you paid for, section 9 applies.</p>`,
      },
      {
        id: 'links',
        title: 'Other websites',
        body: `
      <p>The site links to bookmakers, help organisations and other sites we do not run. We are not
         responsible for their content, their terms or what they do with your data, and a link is
         not a recommendation to use them. Read their terms before you sign up.</p>`,
      },
      {
        id: 'liability',
        title: 'What we are responsible for',
        body: `
      <p><b>We are not responsible for bets.</b> We are not responsible for any money you stake,
         win or lose, or for any decision you make to bet or not, whether or not you followed a
         call. That is a direct consequence of the calls being opinions, which is what section 3
         says they are.</p>
      <p><b>We are responsible for foreseeable loss</b> you suffer because we broke these terms or
         failed to use reasonable care and skill, as consumer law provides. Loss is foreseeable if
         it was an obvious consequence of the breach or was contemplated by both of us when you
         signed up. We are not responsible for loss that was not foreseeable.</p>
      <p>The site is for private use. We are not responsible for loss of profit, business or
         opportunity if you use it for business purposes.</p>
      <p><b>If digital content we supply damages</b> a device or other digital content you own
         because we did not use reasonable care and skill, we will repair the damage or compensate
         you for it.</p>
      <p>Except for the kinds of responsibility in the next paragraph, our total responsibility to
         you for anything connected with the site is limited to the amount you paid us in the 12
         months before the event that caused the loss.</p>
      <p><b>Nothing in these terms limits or excludes</b> our responsibility for death or personal
         injury caused by our negligence, for fraud or fraudulent misrepresentation, for breach of
         your statutory rights as a consumer, or for anything else the law does not allow us to
         limit or exclude.</p>`,
      },
      {
        id: 'ending',
        title: 'Suspending or ending your account',
        body: `
      <p>We may suspend or close an account, or end a membership, if you seriously or repeatedly
         break these terms, if we reasonably suspect fraud, account sharing or a leak of members’
         calls, or if the law requires it. Except where the law or an investigation prevents it, we
         will tell you why and give you the chance to respond.</p>
      <p>If we end a membership because you broke these terms, there is no refund. If we end it for
         any other reason, including closing Offside.win, we refund the time left.</p>
      <p>Sections 3, 11, 12, 16, 19, 21 and 22 continue to apply after an account closes.</p>`,
      },
      {
        id: 'opinion',
        title: 'Opinions about teams and players',
        body: `
      <p>Offside.win writes with opinions. When we say a side is poor, a defence is leaking or a
         manager is out of ideas, that is <b>honest opinion</b> about public sporting performance,
         based on facts we can point to, not a statement of fact about anyone’s character.</p>
      <p>If you believe something we have published about a real person is inaccurate or unfair,
         write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> with the page and the
         words. We will look at it promptly and correct or remove it if you are right.</p>`,
      },
      {
        id: 'complaints',
        title: 'Complaints and disputes',
        body: `
      <p>If you are unhappy, write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> and
         tell us what happened and what you would like us to do. We aim to answer within five
         working days and to resolve complaints within 30 days.</p>
      <p>If we cannot agree, you can take the matter to court. You do not have to use an
         alternative dispute resolution scheme, and we do not currently subscribe to one.</p>`,
      },
      {
        id: 'changes',
        title: 'Changes to these terms',
        body: `
      <p>We may change these terms to reflect changes in the law, in how the site works or in what
         a membership includes. The date at the top shows the current version. If a change affects
         members, we email them at least 30 days before it takes effect for anything that makes
         their position worse, and it applies from their next renewal. If you do not accept a
         change, you can cancel before it applies.</p>`,
      },
      {
        id: 'general',
        title: 'The legal bits that hold the rest together',
        body: `
      <p><b>Events outside our control.</b> We are not responsible for delay or failure caused by
         events outside our reasonable control, such as a failure at a supplier, a network outage or
         a data provider stopping. We will tell you and do what we reasonably can to limit the
         effect.</p>
      <p><b>Transfer.</b> We may transfer this agreement to someone who takes over Offside.win, and
         will tell you if we do; your rights under it will not be reduced. You may not transfer your
         membership to anyone else.</p>
      <p><b>If one part fails.</b> If a court decides part of these terms is unlawful or
         unenforceable, the rest still applies.</p>
      <p><b>Not enforcing is not giving up.</b> If we do not insist on something straight away, we
         can still insist on it later.</p>
      <p><b>No third-party rights.</b> Only you and we have rights under these terms. Nobody else
         can enforce them under the Contracts (Rights of Third Parties) Act 1999.</p>`,
      },
      {
        id: 'law',
        title: 'Which law applies',
        body: `
      <p>These terms are governed by the law of England and Wales, and the courts of England and
         Wales can hear any dispute. If you live in Scotland you can also bring proceedings in
         Scotland, and if you live in Northern Ireland, in Northern Ireland. If you live elsewhere,
         you keep any protection the mandatory law of the country where you live gives you.</p>`,
      },
    ],
  },
  refunds: {
    title: 'Refunds',
    body: `
      <h2>If something of ours did not work</h2>
      <p>If your membership did not start after you paid, the site was down for a real part of the
         time you paid for, or it did not do what we said it would, tell us and we will put it
         right: extra time on your membership to cover what you lost, or your money back, in full or
         in part depending on what went wrong. That is your right under the Consumer Rights Act 2015
         and there is no form to fill in.</p>
      <h2>If you changed your mind</h2>
      <p>A membership starts the moment you pay. At checkout you ask for that and accept that it
         ends the 14-day right to cancel, so once it has started there is no refund for changing
         your mind. If that confirmation was not validly given, you keep the 14 days and we will
         honour them. Memberships bought before 27 September 2026 keep the 14-day refund promised
         when they were bought.</p>
      <h2>If you want to stop</h2>
      <p>A matchday pass ends by itself. A monthly membership or a season ticket stops in one step
         from your account page or your Whop account. You keep access until the end of the period
         you have paid for and are not charged again. We do not refund part of a period that has
         already started.</p>
      <h2>If you are under 18, or gambling has become a problem</h2>
      <p>Tell us. We close the account and refund what is left of the membership.</p>
      <h2>What we never refund</h2>
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

/**
 * A legal page as an article: a kicker, the title, a standfirst, the date it
 * took effect and how long it takes to read, the plain-English summary in a
 * box of its own, then numbered sections with a contents list beside them.
 *
 * The numbers are real references (the terms cite "section 9"), so they are
 * the one decoration that earns its place. Pages still written as a single
 * body (cookies, contact) come out as plain prose under the same head.
 *
 * Shared by the app and scripts/legal-pages.mjs so /terms and #/legal/terms
 * are one page. Contents links carry data-jump: in the app a hash link would
 * be read as a route, so the app scrolls instead; on the static page the
 * plain #anchor works as it is.
 */
export function legalHTML(which) {
  const page = LEGAL[which];
  if (!page) return '';
  const text = page.sections ? page.sections.map((s) => s.body).join(' ') : page.body;
  const words = text.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 230));
  const head = `
  <header class="legal-head">
    ${page.kicker ? `<p class="hand legal-kicker">${page.kicker}</p>` : ''}
    <h1 class="display xl">${page.title}</h1>
    ${page.standfirst ? `<p class="legal-standfirst">${page.standfirst}</p>` : ''}
    <p class="legal-meta"><span>In force from ${UPDATED}</span><span>About ${minutes} minute${minutes === 1 ? '' : 's'} to read</span>${
      page.sections ? `<span>${page.sections.length} sections</span>` : ''}</p>
  </header>`;
  if (!page.sections) return `<article class="legal legal-plain">${head}<div class="prose legal-text">${page.body}</div></article>`;
  return `
<article class="legal">
  ${head}
  ${page.summary ? `
  <aside class="legal-short" aria-labelledby="legal-short-h">
    <h2 id="legal-short-h">In short</h2>
    <ul>${page.summary.map((x) => `<li>${x}</li>`).join('')}</ul>
    <p class="legal-short-note">A guide to finding your way, not a replacement: the full text below is what applies.</p>
  </aside>` : ''}
  <div class="legal-body">
    <details class="legal-toc" open>
      <summary>Contents</summary>
      <ol>${page.sections.map((s, i) => `<li><a href="#s-${s.id}" data-jump="s-${s.id}"><span>${i + 1}</span>${s.title}</a></li>`).join('')}</ol>
    </details>
    <div class="legal-text prose">
      ${page.sections.map((s, i) => `
      <section class="legal-sec" id="s-${s.id}" aria-labelledby="h-${s.id}">
        <h2 id="h-${s.id}"><span class="legal-no" aria-hidden="true">${i + 1}</span><span class="visually-hidden">Section ${i + 1}: </span>${s.title}</h2>
        ${s.body}
      </section>`).join('')}
    </div>
  </div>
</article>`;
}
