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

export const UPDATED = '30 September 2026';

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
  ? `<p>Offside.win is a trading name of <b>${OPERATOR.name}</b>, a sole trader established in the
       United Kingdom, whose postal address is ${OPERATOR.address}.</p>`
  : `<p>Offside.win is operated by a sole trader established in the United Kingdom.</p>`;

/* The date this version of the terms took effect, cited at checkout. */
export const TERMS_VERSION = '2026-09-28';

export const LEGAL = {
  privacy: {
    title: 'Privacy Policy',
    version: '2.1',
    standfirst: `This Privacy Policy describes how Offside.win collects, uses, discloses and retains
      personal data in connection with the website at offside.win and the services made available
      through it, the legal bases on which it does so, and the rights available to you. It should be
      read together with our Terms of Use.`,
    summary: [
      'No personal data is required to read the freely available parts of the Site.',
      'Where you register an Account we hold your email address and the preferences you provide; where you purchase a Membership we additionally hold a record of that purchase.',
      'Card details are provided directly to our Payment Provider and are not received or stored by us.',
      'We do not sell personal data, disclose it for advertising purposes or track you across other websites.',
      'Members’ Content carries identifying marks linked to the Account to which it is displayed, for the purpose of detecting unauthorised disclosure. This is described in clauses 2 and 4.',
      'You may access, export or delete your data from your account page, and you may complain to the Information Commissioner’s Office at any time.',
    ],
    sections: [
      {
        id: 'who',
        title: 'Introduction and controller',
        body: `
      <p>Offside.win (“<b>we</b>”, “<b>us</b>” and “<b>our</b>”) is the controller of the personal
         data described in this Privacy Policy, being the person who determines the purposes and means
         of its processing. We process personal data in accordance with the UK General Data Protection
         Regulation (“<b>UK GDPR</b>”), the Data Protection Act 2018 and the Privacy and Electronic
         Communications (EC Directive) Regulations 2003 (“<b>PECR</b>”), each as amended, including by
         the Data (Use and Access) Act 2025.</p>
      ${OPERATOR_HTML}
      <p>Enquiries concerning this Privacy Policy or our processing of personal data should be sent to
         <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
      <p>We are not required to appoint a data protection officer. Responsibility for data protection
         rests with the operator of Offside.win.</p>
      <p>Expressions defined in our <a href="#/legal/terms">Terms of Use</a>, including “Site”,
         “Account”, “Membership”, “Members’ Content” and “Payment Provider”, have the same meanings in
         this Privacy Policy.</p>`,
      },
      {
        id: 'collect',
        title: 'Personal data we collect',
        body: `
      <p><b>Visitors.</b> We do not collect personal data from visitors who do not register an Account.
         Our hosting provider, Cloudflare, processes the technical information transmitted with each
         request, namely the IP address, the browser’s user agent, the address requested and the time
         of the request, for the purposes of delivering the Site and protecting it against attack. This
         information is retained for a short period and is not used by us to profile any individual.</p>
      <p><b>Account holders.</b> Where you register an Account we process:</p>
      <ul>
        <li>your <b>email address</b>, to which sign-in links are sent and by which your Membership is
            associated with your Account;</li>
        <li>where you sign in with Google, the <b>name and profile image</b> made available to us by
            Google and the fact that Google was used to sign in;</li>
        <li>information you choose to provide, namely a <b>username</b>, a display name, the <b>teams and
            competitions you follow</b> and your preferred formats for odds and times; and</li>
        <li>the dates on which the Account was created and last accessed.</li>
      </ul>
      <p><b>Members.</b> Where you purchase a Membership we process the plan purchased, its start and
         expiry dates, whether it renews, and a record of each payment comprising the amount, currency,
         date, status and the reference assigned by the Payment Provider. We may also process the brand
         and last four digits of the payment card, as notified to us by the Payment Provider, for display
         on your account page. We do not receive or store full card numbers, expiry dates or security
         codes.</p>
      <p><b>Checkout confirmations.</b> At checkout we record your confirmation that you are at least
         18 years of age and accept our Terms of Use (including the version in force), and your express
         request that your Membership begin immediately together with your acknowledgement that your
         right to cancel is thereby lost, in each case with the time at which it was given.</p>
      <p><b>Identifying marks.</b> Members’ Content displayed to a Member bears a visible mark showing
         that Member’s username or account code, and text copied from Members’ Content carries the same
         code in characters that are not visible on screen. The account code consists of the first eight
         characters of the internal identifier of the Account; it is not the Member’s email address and
         has no meaning outside our systems. Where Members’ Content is found to have been disclosed, we
         may extract the code from the disclosed material and identify the Account concerned.</p>
      <p><b>Correspondence.</b> Where you contact us, we retain the correspondence for the purposes of
         responding and of maintaining a record.</p>
      <p><b>Visit counting.</b> Where you consent, each page opened increments an aggregate daily count
         for that category of page. The count records only the date and the category of page, contains
         no identifier and does not constitute personal data. Where you do not consent, no count is
         made.</p>
      <p>We do not process special category data, do not acquire personal data from third parties for
         marketing purposes and do not use data brokers.</p>`,
      },
      {
        id: 'why',
        title: 'Purposes and legal bases of processing',
        body: `
      <p>We process personal data only where a legal basis under Article 6 of the UK GDPR applies. The
         purposes of processing and the corresponding legal bases are as follows:</p>
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>Purpose</th><th>Personal data</th><th>Legal basis</th></tr></thead>
        <tbody>
          <tr><td>Providing and administering your Account</td><td>Email address, Google profile, preferences</td><td>Performance of a contract (Art. 6(1)(b))</td></tr>
          <tr><td>Providing a Membership</td><td>Account, plan, payment records</td><td>Performance of a contract (Art. 6(1)(b))</td></tr>
          <tr><td>Retaining payment records</td><td>Payment records</td><td>Legal obligation (Art. 6(1)(c))</td></tr>
          <tr><td>Recording checkout confirmations</td><td>Confirmation record</td><td>Legal obligation (Art. 6(1)(c)) and legitimate interests (Art. 6(1)(f))</td></tr>
          <tr><td>Marking Members’ Content and investigating disclosure</td><td>Account code, username, disclosed material</td><td>Legitimate interests (Art. 6(1)(f))</td></tr>
          <tr><td>Preventing fraud, abuse and payment disputes</td><td>Account, payment records, request logs</td><td>Legitimate interests (Art. 6(1)(f))</td></tr>
          <tr><td>Responding to correspondence and complaints</td><td>Correspondence</td><td>Legitimate interests (Art. 6(1)(f)) or performance of a contract</td></tr>
          <tr><td>Saved pages and visit counting</td><td>Storage on your device; aggregate count</td><td>Consent (Art. 6(1)(a)), which may be withdrawn at any time</td></tr>
          <tr><td>Establishing, exercising or defending legal claims</td><td>Data relevant to the claim</td><td>Legitimate interests (Art. 6(1)(f))</td></tr>
        </tbody>
      </table></div>
      <p>We send email only for the purposes of signing you in and administering your Membership,
         including confirmation of purchase, notice of renewal, notice of failed payment and notice of
         material changes to our terms or to this Privacy Policy. We do not send marketing email and
         will not do so without first obtaining your consent.</p>`,
      },
      {
        id: 'interests',
        title: 'Legitimate interests and the right to object',
        body: `
      <p>Where we rely on legitimate interests, we have assessed those interests against your rights and
         freedoms and concluded that they are not overridden. Those interests are as follows.</p>
      <p><b>Protection of Members’ Content.</b> Members pay for access to Members’ Content. Its
         unauthorised disclosure deprives other Members of the value of their Memberships. The
         identifying marks described in clause 2 permit the Account from which a disclosure originated
         to be identified without monitoring any user: no activity is tracked while Content is read, the
         code is examined only when a disclosure has been found, and the code does not identify any
         person outside our systems. Where a disclosure is traced to an Account, we will notify the
         holder before taking action and afford an opportunity to respond.</p>
      <p><b>Security and fraud prevention.</b> We retain such information as is necessary to detect the
         sharing of Accounts, the misuse of payments and attacks on the Site.</p>
      <p><b>Legal claims.</b> In the event of a dispute, chargeback or claim, we process the records
         relevant to it.</p>
      <p>You have the right to object at any time to processing based on legitimate interests. On
         receipt of an objection we will cease the processing unless we demonstrate compelling
         legitimate grounds that override your interests, rights and freedoms, or the processing is
         required for the establishment, exercise or defence of legal claims, and we will inform you
         of the outcome and our reasons.</p>`,
      },
      {
        id: 'share',
        title: 'Recipients of personal data',
        body: `
      <p>We disclose personal data to the following recipients. Those acting as our <b>processors</b>
         process personal data only on our documented instructions and under a written contract, and may
         not use it for their own purposes.</p>
      <ul>
        <li><b>Cloudflare, Inc.</b> (processor): hosting of the Site, execution of server code and
            request logging;</li>
        <li><b>Supabase, Inc.</b> (processor): storage of Account, Membership and payment records,
            authentication and the sending of sign-in emails;</li>
        <li><b>Brevo SAS</b> (processor), established in the European Union: the sending of emails
            concerning your Membership;</li>
        <li><b>Whop</b>: the operation of checkout and billing and the storage of payment card details.
            In respect of the payment information you provide to it, Whop acts as an independent
            controller under its own privacy policy;</li>
        <li><b>Google LLC</b>, where you elect to sign in with Google: Google acts as an independent
            controller in respect of your Google account and makes your email address, name and profile
            image available to us;</li>
        <li><b>jsDelivr</b>: delivery of the sign-in library to your browser on the sign-in and account
            pages, in the course of which it receives the technical information transmitted with the
            request;</li>
        <li>our <b>football data provider</b>: supply of fixtures, results, prices and images. Images
            are loaded from its servers, which receive the technical information transmitted with each
            request; no personal data is otherwise provided to it; and</li>
        <li><b>Google Gemini</b>: assistance in preparing written match analysis. Only match data is
            provided to it; no personal data is provided.</li>
      </ul>
      <p>We may also disclose personal data where required by law, including in response to a court
         order or a lawful request from a law enforcement or regulatory authority; to professional
         advisers under a duty of confidentiality; where necessary to establish, exercise or defend
         legal claims; and to any person acquiring the business of Offside.win, in which event this
         Privacy Policy will continue to apply and you will be notified in advance.</p>
      <p><b>We do not sell personal data</b> and do not disclose it for advertising purposes.</p>`,
      },
      {
        id: 'transfers',
        title: 'International transfers',
        body: `
      <p>Certain of the recipients identified in clause 5 are located, or process personal data, in the
         United States or elsewhere outside the United Kingdom. Where personal data is transferred to a
         country that is not the subject of adequacy regulations under the UK GDPR, the transfer is made
         subject to an appropriate safeguard, being the UK Extension to the EU–US Data Privacy Framework
         where the recipient is certified to it, or the International Data Transfer Agreement or the
         International Data Transfer Addendum to the European Commission’s standard contractual clauses.
         Details of the safeguard applicable to any transfer are available on request.</p>`,
      },
      {
        id: 'retention',
        title: 'Retention',
        body: `
      <p>Personal data is retained for no longer than is necessary for the purposes for which it is
         processed, as follows:</p>
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>Category</th><th>Retention period</th></tr></thead>
        <tbody>
          <tr><td>Account data and preferences</td><td>Until the Account is deleted</td></tr>
          <tr><td>Payment records</td><td>Six years from the end of the tax year to which they relate, as required by tax law; following deletion of an Account, without the associated email address</td></tr>
          <tr><td>Whether a deleted Account had a Membership</td><td>Six years from deletion, held only as a one-way fingerprint of the email address, so that a free trial is given once per person</td></tr>
          <tr><td>Checkout confirmations</td><td>Six years from the end of the Membership concerned, being the limitation period for claims in contract</td></tr>
          <tr><td>Records of investigations into disclosure of Members’ Content</td><td>Until the investigation is concluded; where action is taken, six years thereafter</td></tr>
          <tr><td>Correspondence</td><td>Two years from the conclusion of the correspondence, or longer where it relates to a dispute</td></tr>
          <tr><td>Request logs</td><td>In accordance with Cloudflare’s retention periods; no copies are retained by us</td></tr>
          <tr><td>Visit counts</td><td>Retained as aggregate totals; not personal data</td></tr>
        </tbody>
      </table></div>
      <p>You may delete your Account at any time from the settings of your account page, with immediate
         effect, or may ask us to do so, in which case we will do so within 30 days. Deletion removes
         your sign-in, username, display name, followed teams and competitions and preferences, and
         terminates any Membership without refund of any unexpired period. Backups are overwritten
         within 30 days.</p>`,
      },
      {
        id: 'rights',
        title: 'Your rights',
        body: `
      <p>Subject to the conditions and exceptions set out in the UK GDPR, you have the following
         rights in respect of your personal data:</p>
      <ul>
        <li>the right of <b>access</b> to the personal data we hold about you;</li>
        <li>the right to <b>rectification</b> of personal data that is inaccurate or incomplete;</li>
        <li>the right to <b>erasure</b> of personal data;</li>
        <li>the right to <b>restriction</b> of processing;</li>
        <li>the right to <b>data portability</b>;</li>
        <li>the right to <b>object</b> to processing based on legitimate interests, as described in
            clause 4; and</li>
        <li>where processing is based on consent, the right to <b>withdraw consent</b> at any time,
            which may be exercised through the cookie settings linked in the footer of the Site.</li>
      </ul>
      <p>Your data may be downloaded, your profile and preferences amended and your Account deleted from
         your account page. Any other request should be sent to
         <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> from the email address associated with
         your Account. No fee is charged. We will respond within one month of receipt, which period may
         be extended by up to two further months where a request is complex, in which case we will
         inform you within the first month. Where necessary to verify your identity, we may request
         information limited to that purpose.</p>
      <p>Where an exception applies, including where we are required by law to retain payment records,
         we will inform you of the reason for which a request cannot be met in full.</p>
      <p>We do not make decisions based solely on automated processing that produce legal or similarly
         significant effects concerning you. Calls are opinions concerning football matches and are not
         decisions concerning any person.</p>`,
      },
      {
        id: 'complaints',
        title: 'Complaints',
        body: `
      <p>Complaints concerning our processing of personal data should be sent to
         <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> with the words “Data protection
         complaint” in the subject line. In accordance with section 164A of the Data Protection Act 2018
         we will acknowledge each complaint within 30 days of receipt, take appropriate steps to
         investigate it, and inform you of the outcome without undue delay.</p>
      <p>You also have the right to lodge a complaint with the Information Commissioner’s Office, the
         supervisory authority in the United Kingdom, at
         <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer">ico.org.uk/make-a-complaint</a>
         or on 0303 123 1113. If you are resident in the European Economic Area you may complain to the
         supervisory authority of your Member State of residence.</p>`,
      },
      {
        id: 'security',
        title: 'Security',
        body: `
      <p>We implement appropriate technical and organisational measures to protect personal data,
         including encryption of data in transit, row-level access controls within our database that
         prevent the publicly available key used by the Site from reading any Account, payment or
         preference data, and restriction of administrative access to the operator of Offside.win.
         Payment card details are not received by our systems. Authentication is by single-use links and
         by Google, and no passwords are held.</p>
      <p>Where a personal data breach is likely to result in a risk to your rights and freedoms, we will
         notify the Information Commissioner’s Office within 72 hours of becoming aware of it and, where
         the risk is high, will notify you without undue delay.</p>`,
      },
      {
        id: 'children',
        title: 'Persons under 18',
        body: `
      <p>The Site is intended for persons aged 18 or over. It concerns betting prices and is neither
         designed for nor directed at persons under 18. The purchase of a Membership requires
         confirmation that the purchaser is at least 18 years of age. We do not knowingly process the
         personal data of persons under 18. Where we become aware that we have done so, we will delete
         that data and close the Account concerned.</p>`,
      },
      {
        id: 'storage',
        title: 'Cookies and device storage',
        body: `
      <p>The Site does not set cookies of its own. It stores a limited number of items in your browser’s
         local storage, which is subject to the same rules as cookies under PECR. Items strictly
         necessary to provide the Site, including those that maintain your session and record your
         choice, are always stored. Saved pages and visit counting are enabled only with your consent.
         Each item is listed in our <a href="#/legal/cookies">Cookies and Storage Notice</a>, where your
         choice may be changed at any time. A Global Privacy Control signal sent by your browser is
         treated as a refusal of consent.</p>`,
      },
      {
        id: 'elsewhere',
        title: 'Residents outside the United Kingdom',
        body: `
      <p><b>European Economic Area.</b> Where the EU General Data Protection Regulation applies to our
         processing of your personal data, you have rights corresponding to those set out in clause 8 and
         may lodge a complaint with the supervisory authority of your Member State of residence.</p>
      <p><b>United States.</b> We do not sell personal information, do not share it for cross-context
         behavioural advertising and do not use or disclose sensitive personal information, and have not
         done so in the preceding twelve months. Irrespective of whether the privacy law of your state
         applies to us, you may request access to or deletion of your personal information, and you will
         not be subject to discrimination for doing so. We do not disclose personal information to third
         parties for their direct marketing purposes.</p>`,
      },
      {
        id: 'changes',
        title: 'Changes to this Privacy Policy',
        body: `
      <p>We may amend this Privacy Policy from time to time. The version and effective date are stated at
         the head of this document, and previous versions are available on request. Where an amendment
         materially affects the personal data we hold concerning Members or the purposes for which it is
         processed, we will notify Members by email before the amendment takes effect.</p>`,
      },
    ],
  },
  terms: {
    title: 'Terms of Use',
    version: '2.0',
    standfirst: `These Terms of Use set out the terms on which Offside.win makes the Site and the
      Services available to you, including the terms on which Memberships are sold. Please read them
      carefully before using the Site or purchasing a Membership. Nothing in these Terms affects your
      statutory rights as a consumer.`,
    summary: [
      'The Site is for persons aged 18 or over. Offside.win publishes opinion on football matches; it is not a bookmaker, does not accept bets and does not provide betting, financial or investment advice.',
      'No Call is a guarantee of any outcome. The full record of Calls, including those that lost, is published, and following Calls may result in financial loss.',
      'A Membership begins immediately on payment. At checkout you expressly request immediate access and acknowledge that your statutory right to cancel is thereby lost. Your rights in respect of faulty digital content are unaffected.',
      'Renewing Memberships continue until cancelled. Cancellation may be made at any time in one step and takes effect at the end of the current billing period.',
      'Members’ Content is licensed for your personal use only. Its disclosure to any third party entitles us to terminate your Membership without refund.',
      'Our liability is limited to the extent permitted by law. We accept no liability for any stake placed or any loss arising from betting.',
    ],
    sections: [
      {
        id: 'about',
        title: 'Introduction and acceptance',
        body: `
      <p>These Terms of Use (the “<b>Terms</b>”) constitute a legally binding agreement between you and
         Offside.win (“<b>we</b>”, “<b>us</b>” and “<b>our</b>”) governing your access to and use of
         the website at offside.win (the “<b>Site</b>”) and the services made available through it (the
         “<b>Services</b>”).</p>
      ${OPERATOR_HTML}
      <p>These Terms should be read together with our <a href="#/legal/privacy">Privacy Policy</a>,
         our <a href="#/legal/cookies">Cookies and Storage Notice</a> and our
         <a href="#/legal/refunds">Refunds Policy</a>, each of which forms part of these Terms. In the
         event of any inconsistency, these Terms prevail.</p>
      <p>By accessing or using the Site you agree to be bound by these Terms. If you do not agree to
         them, you must not use the Site.</p>
      <p>If you are a consumer, nothing in these Terms excludes, restricts or otherwise affects any
         right you have under the Consumer Rights Act 2015, the Consumer Contracts (Information,
         Cancellation and Additional Charges) Regulations 2013 or any other legislation that cannot be
         excluded by agreement. Where any provision of these Terms is inconsistent with such a right,
         the right prevails.</p>
      <p>You may contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. These Terms are
         available in English only. You may save or print them for your records.</p>`,
      },
      {
        id: 'definitions',
        title: 'Definitions and interpretation',
        body: `
      <p>In these Terms the following expressions have the following meanings:</p>
      <ul>
        <li>“<b>Account</b>” means an account registered on the Site in your name;</li>
        <li>“<b>Call</b>” means an opinion published by us as to the outcome of a football match that
            we consider most likely, together with the price offered for it by a bookmaker, the
            bookmaker offering it and our reasons;</li>
        <li>“<b>Content</b>” means all material published on the Site, including Calls, analysis,
            previews, match data, results and the record of Calls;</li>
        <li>“<b>Free Call</b>” means the single Call made available each day without a Membership;</li>
        <li>“<b>Member</b>” means a person who holds a current Membership;</li>
        <li>“<b>Members’ Content</b>” means Content available only to Members, including Calls other
            than the Free Call, the selections in an open bet slip and the reasons for each Call;</li>
        <li>“<b>Membership</b>” means a paid entitlement to access Members’ Content, of the type and for
            the period purchased; and</li>
        <li>“<b>Payment Provider</b>” means Whop, or such other provider as we may appoint from time
            to time to process payments on our behalf.</li>
      </ul>
      <p>Headings are for convenience only and do not affect interpretation. Words in the singular
         include the plural and vice versa. The words “including” and “include” are to be read without
         limitation. A reference to a clause is to a clause of these Terms.</p>`,
      },
      {
        id: 'what',
        title: 'The Services',
        body: `
      <p>Offside.win publishes previews and analysis of football matches and, in respect of certain
         matches, a Call. Following each match we publish the result of each Call, whether it succeeded
         or failed, and we maintain a public record of all settled Calls.</p>
      <p>Calls are formed from match data, team news and the prices published by bookmakers. Calls are
         reviewed periodically before kick-off and may be amended or withdrawn at any time before the
         relevant match begins. Each Call closes at kick-off. Content is accurate as at the time it is
         displayed only.</p>
      <p>Certain written analysis on the Site is prepared with the assistance of artificial
         intelligence tools, operating solely on match data, and is subject to automated review before
         publication. Calls are not generated by artificial intelligence.</p>
      <p>We receive no payment from any bookmaker in respect of any Call, and links to bookmakers on
         the Site are not paid or affiliate links. Should this change, any such link will be clearly
         identified where it appears.</p>`,
      },
      {
        id: 'not',
        title: 'Nature of the Content',
        body: `
      <p><b>No advice.</b> Each Call is an expression of opinion concerning a football match. No Content
         constitutes betting, financial or investment advice, and no Content takes account of your
         personal circumstances.</p>
      <p><b>No guarantee.</b> The outcome of a football match is inherently uncertain. Past results,
         including our own record, are not a reliable indicator of future results. A Call may be
         correct more often than not and nevertheless result in a financial loss at the price obtained.
         We make no representation, and you must not assume, that following any Call will result in a
         profit.</p>
      <p><b>Not a bookmaker.</b> We do not accept bets, operate betting accounts, hold or handle stakes,
         or place bets on behalf of any person. Offside.win does not provide gambling facilities and is
         accordingly not licensed by the Gambling Commission, nor is it authorised or regulated by the
         Financial Conduct Authority. Any bet you place is a contract between you and the relevant
         bookmaker on that bookmaker’s terms. Prices may change, and a bookmaker may offer a different
         price, limit your stake or decline your bet; any such matter is between you and that
         bookmaker.</p>
      <p>Any decision to place a bet, and the amount of any stake, is yours alone and is made at your
         own risk.</p>`,
      },
      {
        id: 'who',
        title: 'Eligibility',
        body: `
      <p>You must be at least <b>18 years of age</b> to use the Site. By purchasing a Membership you
         confirm that you are at least 18 years of age. Where we have reason to believe that an Account
         is held by a person under 18, we will close the Account and refund any payment made.</p>
      <p>Betting is restricted or prohibited in certain jurisdictions. You are solely responsible for
         ensuring that your use of the Site complies with the laws applicable to you. We may refuse or
         withdraw the Services in any jurisdiction in which their provision would be unlawful.</p>`,
      },
      {
        id: 'responsible',
        title: 'Responsible gambling',
        body: `
      <p>You should bet only with money you can afford to lose and should not bet in order to recover
         losses or to address financial difficulty. Our
         <a href="#/legal/responsible">Responsible Gambling</a> page lists sources of free and
         confidential support, including
         <a href="https://www.gamstop.co.uk" target="_blank" rel="noopener noreferrer">GAMSTOP</a> and
         the National Gambling Helpline on 0808 8020 133.</p>
      <p>If you inform us that gambling has become a problem for you, we will close your Account and
         refund any unused portion of your Membership.</p>`,
      },
      {
        id: 'account',
        title: 'Accounts',
        body: `
      <p>An Account is personal to the individual in whose name it is registered and may not be shared
         or transferred. You are responsible for maintaining the security of the email address
         associated with your Account, since a sign-in link sent to that address grants access to the
         Account.</p>
      <p>You are responsible for all activity on your Account save where it results from access without
         your authorisation and you have taken reasonable care to prevent it. You must notify us without
         delay if you believe your Account has been accessed without your authorisation.</p>
      <p>A username must not impersonate any person, suggest an affiliation with any club, league,
         player or bookmaker, or be offensive, discriminatory or unlawful. We may require you to change,
         or may ourselves change, any username that does not comply with this clause.</p>
      <p>You may close your Account at any time from the account page.</p>`,
      },
      {
        id: 'membership',
        title: 'Memberships',
        body: `
      <p>Access to the Site and to the Free Call is available without charge. A Membership provides
         access to Members’ Content for the period purchased.</p>
      <p>The following Memberships are offered, each renewing Membership continuing until cancelled in
         accordance with clause 11:</p>
      <ul>
        <li>the <b>Matchday Pass</b>, a single payment for a period of seven days, which does not renew;</li>
        <li>the <b>Monthly Membership</b>, which renews automatically at the end of each monthly period; and</li>
        <li>the <b>Three-Month Membership</b>, which renews automatically at the end of each three-month period.</li>
      </ul>
      <p><b>Changing Membership.</b> You may move from one renewing Membership to another, or from a
         Matchday Pass to a renewing Membership, at any time. Every day of the period you have already
         paid for is kept: the new Membership begins at once, no payment is taken for it until that
         period ends, and its first payment is taken on that date. The Membership you leave does not
         renew. You are not charged twice for any day and you lose none.</p>
      <p>The price, scope, duration and renewal terms of each Membership are stated on the pricing page
         and again at checkout before payment is taken. Prices include any VAT or sales tax we are
         required to charge. The final amount payable is shown at checkout in your currency.</p>
      <p><b>Changes in price.</b> A renewing Membership renews at the price applicable when it was
         purchased. We will give you not less than 30 days’ notice of any change in price, which will
         take effect only from the first renewal following the expiry of that notice. You may cancel
         before the change takes effect without further charge.</p>
      <p><b>Changes in scope.</b> We may develop and change the features of the Site from time to time.
         We will not, during any period for which you have paid, withdraw the essential elements of a
         Membership, namely access to all Calls, to the selections in the bet slip and to the reasons
         for each Call. Should we be required to do so, you may cancel and receive a refund in respect
         of the unexpired period.</p>`,
      },
      {
        id: 'payment',
        title: 'Price and payment',
        body: `
      <p>Payments are processed by the Payment Provider through a payment form on our checkout page
         operated by the Payment Provider, and the Payment Provider’s own terms apply to each payment.
         Card details are provided directly to the Payment Provider and are not received or stored by
         us. A Membership is attached to the Account with which you are signed in at the time of
         payment.</p>
      <p>By purchasing a renewing Membership you authorise the Payment Provider to charge the same
         payment method at the commencement of each subsequent period until the Membership is
         cancelled. If a renewal payment fails, access to Members’ Content may be suspended until the
         amount due is paid.</p>
      <p>Your card issuer may charge fees, including in respect of payments in a foreign currency. Such
         fees are outside our control.</p>
      <p><b>Chargebacks.</b> If you believe that a charge has been made in error, you should contact
         us in the first instance. If you dispute a valid charge with your card issuer, we may suspend
         your Membership pending resolution of the dispute and may terminate it if the dispute is
         resolved in your favour.</p>`,
      },
      {
        id: 'cancel',
        title: 'Statutory right to cancel',
        body: `
      <p>Under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations
         2013 a consumer purchasing digital content not supplied on a tangible medium ordinarily has a
         right to cancel the contract within 14 days. That right is lost once supply of the digital
         content has begun, provided that the consumer has given express consent to supply beginning
         within the cancellation period and has acknowledged that the right to cancel will thereby be
         lost.</p>
      <p>Before any payment is taken, you will be asked at checkout (a) to confirm that you are at least
         18 years of age and that you accept these Terms, and (b) expressly to request that your
         Membership begin immediately and to acknowledge that you will thereby lose your right to
         cancel. Payment cannot be made unless both confirmations are given. We record each
         confirmation, together with the time at which it was given and the version of these Terms then
         in force, and we confirm it to you in writing.</p>
      <p>Accordingly, once your Membership has begun, no refund is available on the ground that you
         have changed your mind. Where for any reason the consent and acknowledgement described in this
         clause were not validly given or confirmed, your statutory right to cancel is preserved and we
         will honour it.</p>
      <p>Memberships purchased before 27 September 2026 retain, in respect of that purchase, the
         14-day refund offered at the time of purchase.</p>
      <p><b>Faulty digital content.</b> Nothing in this clause affects your rights under the Consumer
         Rights Act 2015. Digital content must be as described, of satisfactory quality and fit for
         purpose. Where a Membership does not begin following payment, where the Site is unavailable for
         a significant part of the period paid for, or where the Services otherwise do not conform to
         the contract, we will remedy the matter or provide a full or partial refund as that Act
         requires. Further detail is set out in our <a href="#/legal/refunds">Refunds Policy</a>.</p>`,
      },
      {
        id: 'stop',
        title: 'Cancellation of renewing Memberships',
        body: `
      <p>You may cancel a Monthly or Three-Month Membership at any time, in a single step, from your
         account page or from your account with the Payment Provider. No reason is required and no
         further step is necessary.</p>
      <p>Cancellation takes effect at the end of the period for which you have paid. You will retain
         access to Members’ Content until that time and will not be charged again. Save as provided in
         clause 10 or as required by law, no refund is made in respect of any part of a period that has
         begun.</p>`,
      },
      {
        id: 'yours',
        title: 'Licence and restrictions in respect of Members’ Content',
        body: `
      <p>Subject to these Terms, we grant each Member a personal, non-exclusive, non-transferable and
         revocable licence to access and view Members’ Content, for that Member’s own private use, for
         the duration of the Membership.</p>
      <p>You must not reproduce, publish, post, forward, sell, distribute, screenshot for the benefit of
         others or otherwise disclose any Members’ Content to any third party, whether in a group,
         channel, forum, social network or tipping service or by any other means, and whether or not
         for payment. You must not share your Account or any sign-in link. The Free Call and settled
         results may be shared freely, and the share functions of the Site share only such material.</p>
      <p>Members’ Content carries marks that identify the Account to which it was displayed, as
         described in our <a href="#/legal/privacy">Privacy Policy</a>. Where Members’ Content is found
         to have been disclosed and is traced to your Account, we will notify you of our findings and
         give you an opportunity to respond. If we are satisfied that this clause has been breached, we
         may terminate your Membership without refund, close your Account and seek recovery of any loss
         caused to us, including in respect of the infringement of our copyright and database right.</p>`,
      },
      {
        id: 'ip',
        title: 'Intellectual property',
        body: `
      <p>All intellectual property rights in the Content, the design of the Site and the underlying
         database are owned by us or by our licensors and are protected by copyright and database right.
         Except as expressly permitted by these Terms, you may not copy, republish, sell, adapt or
         create any product or dataset from any Content.</p>
      <p>You may view, discuss and link to any page of the Site, and may quote short extracts provided
         that the source is acknowledged and linked.</p>
      <p>Names, crests, marks and images of clubs, competitions and players are the property of their
         respective owners and are used solely to identify the teams, competitions and persons
         concerned. Offside.win is not endorsed or sponsored by, or otherwise associated with, any club,
         league, competition, player or bookmaker.</p>
      <p>If you believe that any material on the Site infringes your rights, please write to
         <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> identifying the material, its location
         and the basis of your claim. We will consider any such notice promptly and remove the material
         where the claim is substantiated.</p>`,
      },
      {
        id: 'use',
        title: 'Acceptable use',
        body: `
      <p>You must not:</p>
      <ul>
        <li>use any automated means, including bots, scrapers or crawlers, to access, collect or copy
            Content, other than for ordinary indexing by a search engine;</li>
        <li>circumvent, disable or interfere with the Membership restrictions or the identifying marks
            on Members’ Content;</li>
        <li>interfere with, disrupt or attempt to gain unauthorised access to the Site, test its security
            without our prior written consent, or introduce any harmful code;</li>
        <li>register multiple Accounts in order to abuse the Free Call, any refund or any offer;</li>
        <li>use the Site for any unlawful purpose, including fraud or money laundering; or</li>
        <li>present Content as your own or use it in any service that competes with ours.</li>
      </ul>
      <p>Conduct in breach of this clause may also constitute an offence under the Computer Misuse Act
         1990 or an infringement of copyright.</p>`,
      },
      {
        id: 'accuracy',
        title: 'Accuracy and availability',
        body: `
      <p>Fixtures, kick-off times, team line-ups, results and prices are obtained from third-party data
         providers and bookmakers. While we take reasonable care to ensure their accuracy and to correct
         errors promptly, they may be inaccurate or delayed and are subject to change. You should verify
         the price and the market with the bookmaker before placing any bet. Errors in any result
         recorded by us should be reported to us and will be corrected in the record.</p>
      <p>We endeavour to keep the Site available but do not guarantee uninterrupted access. The Site
         may be suspended for maintenance or affected by failures of our suppliers or other events
         beyond our control. Where such interruption deprives you of a significant part of a period
         for which you have paid, clause 10 applies.</p>`,
      },
      {
        id: 'links',
        title: 'Third-party websites',
        body: `
      <p>The Site contains links to websites operated by third parties, including bookmakers and support
         organisations. We have no control over such websites and accept no responsibility for their
         content, terms or handling of personal data. The inclusion of a link does not constitute an
         endorsement or recommendation.</p>`,
      },
      {
        id: 'liability',
        title: 'Limitation of liability',
        body: `
      <p><b>Betting.</b> We shall have no liability for any stake placed, any winnings or losses, or any
         decision to place or not to place a bet, whether or not made in reliance on any Call. This
         follows from the nature of the Content as described in clause 4.</p>
      <p><b>Foreseeable loss.</b> Subject to the remainder of this clause, we are responsible for loss
         or damage you suffer that is a foreseeable result of our breach of these Terms or our failure
         to use reasonable care and skill. Loss or damage is foreseeable if it is an obvious consequence
         of the breach or was contemplated by you and us at the time the contract was made. We are not
         responsible for loss or damage that is not foreseeable.</p>
      <p><b>Private use.</b> The Site is provided for private use only. We shall have no liability for
         any loss of profit, loss of business, business interruption or loss of business opportunity.</p>
      <p><b>Damage to devices.</b> Where defective digital content supplied by us damages a device or
         other digital content belonging to you, and this is caused by our failure to use reasonable
         care and skill, we will either repair the damage or pay you compensation.</p>
      <p><b>Cap.</b> Save as provided in clause 17.6, our total liability to you arising out of or in
         connection with the Site and the Services shall not exceed the total sums paid by you to us in
         the 12 months preceding the event giving rise to the claim.</p>
      <p><b>Exclusions.</b> Nothing in these Terms limits or excludes our liability for death or personal
         injury caused by our negligence, for fraud or fraudulent misrepresentation, for breach of your
         statutory rights as a consumer, or for any other liability that cannot be limited or excluded
         by law.</p>`,
      },
      {
        id: 'ending',
        title: 'Suspension and termination',
        body: `
      <p>We may suspend or terminate your Account or Membership if you commit a serious or repeated
         breach of these Terms, if we reasonably suspect fraud, sharing of an Account or disclosure of
         Members’ Content, or if we are required to do so by law. Save where the law or the conduct of an
         investigation prevents it, we will inform you of our reasons and give you an opportunity to
         respond.</p>
      <p>Where a Membership is terminated by reason of your breach of these Terms, no refund is payable.
         Where a Membership is terminated for any other reason, including the closure of Offside.win, we
         will refund the unexpired portion of the Membership.</p>
      <p>Clauses 4, 12, 13, 17, 20, 22 and 23 survive the termination of these Terms.</p>`,
      },
      {
        id: 'opinion',
        title: 'Editorial opinion and corrections',
        body: `
      <p>The Content includes commentary and opinion. Statements concerning the performance of teams,
         players, managers and officials are expressions of honest opinion on matters of public sporting
         interest, based on facts that are publicly available, and are not statements of fact concerning
         any person’s character or conduct.</p>
      <p>If you consider that any Content concerning an identifiable person is inaccurate or unfair,
         please write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> identifying the page and
         the words complained of. We will consider the matter promptly and will correct or remove the
         Content where the complaint is justified.</p>`,
      },
      {
        id: 'complaints',
        title: 'Complaints and disputes',
        body: `
      <p>Any complaint should be made in writing to
         <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>, setting out the matter complained of
         and the remedy sought. We aim to acknowledge complaints within five working days and to resolve
         them within 30 days.</p>
      <p>If a complaint cannot be resolved between us, you may bring proceedings in the courts in
         accordance with clause 23. We do not currently subscribe to an alternative dispute resolution
         scheme and you are not required to use one.</p>`,
      },
      {
        id: 'changes',
        title: 'Amendments to these Terms',
        body: `
      <p>We may amend these Terms to reflect changes in the law, in the operation of the Site or in the
         scope of the Services. The version and effective date of these Terms are stated at the head of
         this document.</p>
      <p>Where an amendment is to the detriment of Members, we will notify Members by email not less
         than 30 days before it takes effect, and it will apply to each Member from the next renewal
         of that Member’s Membership. If you do not accept an amendment, you may cancel your Membership
         before it takes effect.</p>`,
      },
      {
        id: 'general',
        title: 'General provisions',
        body: `
      <p><b>Events beyond our control.</b> We shall not be liable for any delay or failure to perform
         caused by events beyond our reasonable control, including failure of a supplier, network outage
         or the withdrawal of a data provider. We will notify you of any such event and take reasonable
         steps to minimise its effect.</p>
      <p><b>Assignment.</b> We may transfer our rights and obligations under these Terms to any person
         who acquires the business of Offside.win, and will notify you if we do so; your rights under
         these Terms will not be reduced as a result. You may not transfer your rights or obligations
         under these Terms, including your Membership, to any other person.</p>
      <p><b>Severance.</b> If any provision of these Terms is held by a court to be unlawful or
         unenforceable, the remaining provisions shall continue in full force and effect.</p>
      <p><b>Waiver.</b> No failure or delay by us in enforcing any provision of these Terms shall
         constitute a waiver of that provision.</p>
      <p><b>Third-party rights.</b> No person other than you and us shall have any right under the
         Contracts (Rights of Third Parties) Act 1999 to enforce any provision of these Terms.</p>`,
      },
      {
        id: 'law',
        title: 'Governing law and jurisdiction',
        body: `
      <p>These Terms and any dispute or claim arising out of or in connection with them are governed by
         the law of England and Wales, and the courts of England and Wales shall have jurisdiction.</p>
      <p>If you are resident in Scotland you may also bring proceedings in Scotland, and if you are
         resident in Northern Ireland you may also bring proceedings in Northern Ireland. If you are
         resident elsewhere, you retain the benefit of any mandatory provision of the law of your
         country of residence.</p>`,
      },
    ],
  },
  cookies: {
    title: 'Cookies and Storage Notice',
    version: '2.1',
    body: `
      <p>This Notice describes the information stored on your device when you use offside.win, as
         required by regulation 6 of the Privacy and Electronic Communications (EC Directive)
         Regulations 2003. The Site does not set cookies of its own. It stores a limited number of items
         in your browser’s local storage, which is subject to the same rules. Each such item is listed
         below.</p>

      <h2>Strictly necessary items</h2>
      <p>The following items are necessary to provide the Site and are stored without consent.</p>
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>Item</th><th>Purpose</th><th>Duration</th></tr></thead>
        <tbody>
          <tr><td><code>ow.consent</code></td><td>Records your choice below, so that you are not asked again on each visit.</td><td>Until changed, or until the site’s data is cleared</td></tr>
          <tr><td><code>sb-…-auth-token</code></td><td>Maintains your signed-in session. Stored only when you sign in.</td><td>Until you sign out</td></tr>
          <tr><td><code>ow.after-signin</code></td><td>Records the action in progress when you were asked to sign in, such as a purchase, so that you are returned to it.</td><td>Deleted once used</td></tr>
          <tr><td><code>offside.country</code></td><td>The country selected for bookmaker prices, where you have changed it.</td><td>Until changed</td></tr>
          <tr><td><code>ow.promo</code></td><td>Which offers you have already been shown or have closed, so that the same one is not shown to you again.</td><td>Until the site’s data is cleared</td></tr>
        </tbody>
      </table></div>

      <h2>Items stored only with consent</h2>
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>Item</th><th>Purpose</th><th>Duration</th></tr></thead>
        <tbody>
          <tr><td>Saved pages (<code>ow.c1:…</code>)</td><td>A copy of each page’s data, so that the Site opens immediately on your next visit and then updates.</td><td>Replaced as pages update; deleted if consent is withdrawn</td></tr>
          <tr><td>Visit counting</td><td>An anonymous count of each page opened, by category of page. Nothing is stored on your device for this purpose.</td><td>Not stored on your device</td></tr>
        </tbody>
      </table></div>

      <h2>Other technologies</h2>
      <p>The Site uses no advertising cookies, tracking pixels, social media plug-ins or third-party
         analytics services. Fonts are served from the Site itself. A Global Privacy Control signal sent
         by your browser is treated as a refusal of consent.</p>
      <p>Further information on our processing of personal data is set out in our
         <a href="#/legal/privacy">Privacy Policy</a>.</p>`,
  },
  refunds: {
    title: 'Refunds Policy',
    version: '2.0',
    body: `
      <p>This Policy sets out the circumstances in which payments for Memberships are refunded. It forms
         part of our <a href="#/legal/terms">Terms of Use</a>, and expressions defined there have the
         same meanings here. Nothing in this Policy affects your statutory rights.</p>
      <h2>Faulty or non-conforming services</h2>
      <p>Where a Membership does not begin following payment, where the Site is unavailable for a
         significant part of the period paid for, or where the Services otherwise do not conform to the
         contract, you are entitled under the Consumer Rights Act 2015 to have the matter remedied or,
         where that is not possible within a reasonable time, to a full or partial refund. On
         notification we will, at your election where the law so provides, extend your Membership to
         cover the period lost or refund the price in full or in part.</p>
      <h2>Change of mind</h2>
      <p>A Membership begins immediately on payment. At checkout you expressly request immediate access
         and acknowledge that your statutory right to cancel is thereby lost. Accordingly, no refund is
         available on the ground that you have changed your mind once a Membership has begun. Where that
         request and acknowledgement were not validly given or confirmed, your right to cancel within
         14 days is preserved and will be honoured. Memberships purchased before 27 September 2026
         retain, in respect of that purchase, the 14-day refund offered at the time of purchase.</p>
      <h2>Cancellation of renewing Memberships</h2>
      <p>A Matchday Pass expires automatically. A Monthly or Three-Month Membership may be cancelled at
         any time, in a single step, from your account page or from your account with the Payment
         Provider. Cancellation takes effect at the end of the period for which you have paid, and no
         further charge is made. No refund is made in respect of any part of a period that has
         begun.</p>
      <h2>Persons under 18 and gambling harm</h2>
      <p>Where an Account is found to be held by a person under 18, or where you inform us that gambling
         has become a problem for you, we will close the Account and refund the unexpired portion of any
         Membership.</p>
      <h2>Exclusions</h2>
      <p>No refund or compensation is payable in respect of any bet, stake or betting loss. Calls are
         expressions of opinion and not guarantees of any outcome, and the full record of Calls is
         published so that it may be reviewed before any purchase.</p>
      <h2>Procedure</h2>
      <p>Requests for a refund should be sent to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
         from the email address associated with the Account. We will respond within two working days.
         Refunds are made to the payment method used for the original purchase.</p>`,
  },
  contact: {
    title: 'Contact',
    body: `
      <p>Offside.win may be contacted at the following address, which is monitored by a person:</p>
      <p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
      <h2>Matters we can assist with</h2>
      <p>Refunds; Memberships that have not begun following payment; errors in any score or result;
         requests concerning personal data; and complaints. Where your enquiry concerns your Account,
         please write from the email address associated with it, so that we are able to verify your
         identity without further enquiry.</p>
      <h2>Response times</h2>
      <p>Every enquiry receives a response. Refund requests are answered within two working days,
         complaints are acknowledged within five working days, and data protection complaints are
         acknowledged within 30 days in accordance with our <a href="#/legal/privacy">Privacy
         Policy</a>.</p>
      <h2>Matters outside our responsibility</h2>
      <p>Offside.win is not a bookmaker and does not operate betting accounts. Any dispute concerning the
         settlement of a bet is a matter between you and the bookmaker concerned, under that bookmaker’s
         rules. If gambling has become difficult to control, the organisations listed on our
         <a href="#/legal/responsible">Responsible Gambling</a> page are able to help.</p>`,
  },
  responsible: {
    title: 'Responsible Gambling',
    body: `
      <p>Betting should be undertaken only for entertainment and only with money you can afford to lose.
         If it has ceased to be so, the information below is of more value than any Call published on
         this Site.</p>
      <h2>Warning signs</h2>
      <ul>
        <li>Staking more than intended, or more than you can comfortably afford to lose.</li>
        <li>Increasing stakes in order to recover losses.</li>
        <li>Borrowing money to bet, or concealing betting from those close to you.</li>
        <li>Betting as a means of escaping stress or low mood rather than for enjoyment.</li>
      </ul>
      <h2>Practical measures</h2>
      <ul>
        <li>Set deposit limits with your bookmaker in advance.</li>
        <li>Self-exclude. <a href="https://www.gamstop.co.uk" target="_blank" rel="noopener noreferrer">GAMSTOP</a>
            excludes you from every operator licensed in Great Britain in a single step.</li>
        <li>Install blocking software such as Gamban, and enable your bank’s gambling block.</li>
      </ul>
      <h2>Free and confidential support</h2>
      <ul>
        <li><a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer">BeGambleAware</a>:
            advice and the National Gambling Helpline, available 24 hours a day on 0808 8020 133.</li>
        <li><a href="https://www.gamcare.org.uk" target="_blank" rel="noopener noreferrer">GamCare</a>:
            support for anyone affected by gambling, including family members.</li>
        <li><a href="https://www.gamblersanonymous.org" target="_blank" rel="noopener noreferrer">Gamblers Anonymous</a>:
            meetings worldwide.</li>
      </ul>
      <h2>Our commitment</h2>
      <p>If you inform us that gambling has become a problem for you, we will close your Account and
         refund the unexpired portion of any Membership. A high rate of successful Calls does not make
         any bet safe: Calls may succeed more often than not and still result in a loss at the price
         obtained.</p>`,
  },
};

/**
 * A legal page, set as a formal document rather than as a web page: a white
 * sheet, serif text, a header with the version and the date it took effect,
 * a plain contents list, numbered clauses (1.1, 1.2) with lettered points
 * ((a), (b)), a summary marked as not forming part of the terms, and an end
 * line. The clause numbers are added by the stylesheet, from the order of
 * the sections and paragraphs, so the text itself stays plain.
 *
 * Shared by the app and scripts/legal-pages.mjs so /terms and #/legal/terms
 * are one document. Contents links carry data-jump: in the app a hash link
 * would be read as a route, so the app scrolls instead; on the static page
 * the plain #anchor works as it is.
 */
export function legalHTML(which) {
  const page = LEGAL[which];
  if (!page) return '';
  const meta = [
    page.version ? ['Version', page.version] : null,
    ['Effective', UPDATED],
    ['Contact', `<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`],
  ].filter(Boolean);
  const head = `
  <header class="doc-head">
    <p class="doc-issuer">Offside.win</p>
    <h1 class="doc-title">${page.title}</h1>
    <dl class="doc-meta">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
  </header>`;
  const end = `<p class="doc-end">End of document. ${page.title}, ${page.version ? `version ${page.version}, ` : ''}effective ${UPDATED}.</p>`;
  if (!page.sections) {
    return `<article class="doc doc-plain">${head}<div class="doc-body doc-free">${page.body}</div>${end}</article>`;
  }
  return `
<article class="doc">
  ${head}
  ${page.standfirst ? `<p class="doc-preamble">${page.standfirst}</p>` : ''}
  ${page.summary ? `
  <section class="doc-summary" aria-labelledby="doc-summary-h">
    <h2 id="doc-summary-h">Summary of key points</h2>
    <p class="doc-note">This summary is provided for convenience only and does not form part of this document. The full text below applies.</p>
    <ul>${page.summary.map((x) => `<li>${x}</li>`).join('')}</ul>
  </section>` : ''}
  <nav class="doc-toc" aria-labelledby="doc-toc-h">
    <h2 id="doc-toc-h">Contents</h2>
    <ol>${page.sections.map((s, i) => `<li><a href="#s-${s.id}" data-jump="s-${s.id}"><span>${i + 1}.</span> ${s.title}</a></li>`).join('')}</ol>
  </nav>
  <div class="doc-body">
    ${page.sections.map((s, i) => `
    <section class="doc-sec" id="s-${s.id}" aria-labelledby="h-${s.id}">
      <h2 id="h-${s.id}"><span class="doc-no">${i + 1}.</span> ${s.title}</h2>
      ${s.body}
    </section>`).join('')}
  </div>
  ${end}
</article>`;
}
