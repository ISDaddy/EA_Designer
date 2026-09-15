// The confidentiality/non-disclosure agreement every user must accept before using the app during
// the POC phase (see the NdaGate on the frontend). Bump `version` whenever the text changes below
// - a version bump is what makes every existing user get re-prompted to accept the new wording
// (see users.nda_accepted_version and POST /api/legal/accept-nda).
//
// IMPORTANT: this is a starting template, not vetted legal advice. Replace the [bracketed]
// placeholders and have a lawyer review the wording - in particular the confidentiality and
// no-independent-use clauses below - before relying on it to actually protect this project.
module.exports = {
  version: 'v1',
  title: 'Confidentiality & Non-Disclosure Agreement',
  text: `This application and everything accessible through it (the "Materials") - including but
not limited to its source code, design, data model, business logic, and any data you enter or
view - are confidential and proprietary to [Company/Owner Name] ("Discloser") and are made
available to you solely for the purpose of evaluating this proof-of-concept ("Permitted Purpose").

By accepting this agreement, you agree that:

1. Confidentiality. You will keep the Materials confidential, will not disclose them to any third
party, and will use at least the same degree of care to protect them as you use to protect your
own confidential information of similar importance, but no less than reasonable care.

2. No Independent Use. You will not use, copy, reproduce, modify, reverse-engineer, distribute,
sublicense, or create derivative works based on the Materials - in whole or in part - for any
purpose other than the Permitted Purpose. No license, ownership interest, or other right in the
Materials is granted to you by this agreement or by your access to the application, other than the
limited right to view and interact with it for the Permitted Purpose.

3. No Independent Project. You will not use the Materials, or anything derived from your knowledge
of them, to build, commission, or contribute to any other product, service, or project - for
yourself or for any other party - without Discloser's prior written consent.

4. Ownership. All Materials, and all intellectual property rights in them, remain the exclusive
property of Discloser. Nothing in this agreement transfers any such rights to you.

5. Duration. These obligations survive for as long as the Materials remain confidential, and in
any event continue after your access to the application ends.

6. Return or Destruction. On Discloser's request, you will promptly return or destroy any copies
of the Materials in your possession and confirm you have done so.

You should only accept this agreement if you are authorized to do so and intend to comply with it.
If you do not agree, do not proceed - close this page and contact [Company/Owner Name] with any
questions.`,
};
