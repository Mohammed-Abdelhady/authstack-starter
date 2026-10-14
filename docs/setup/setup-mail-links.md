# Mail languages and link addresses

Every mail goes out in the recipient's language, and every link in it can point
somewhere other than the web client.

## Languages

- An account stores its language. The request that creates it sets it: the
  `locale` field of the body first, then the `Accept-Language` header, then
  English.
- An administrator who creates an account for someone else sets its language
  with the `locale` field of `POST /api/admin/users`. Without one, or with one
  the project does not carry, the account is English. The administrator's own
  `Accept-Language` is not used.
- Security notices, such as a changed password or an added passkey, go out in
  the account's language.
- A person changes their own with `PATCH /api/user/profile` and a body such
  as `{ "locale": "en" }`. A language the project does not carry is refused.
- Mail to an address with no account yet, such as a sign-up code, uses the
  language of the request the same way.
- A request language the project does not carry falls back to English.

The supported languages are `SUPPORTED_LOCALES` in
`backend/src/common/constants/locales.ts`. Each mail's text lives in
`backend/src/mail/catalog/<language>/`, one file per mail. A catalogue test
fails when a key or an argument exists in one language and not in another.

Arabic mail is written right to left, with `dir="rtl"` and `lang="ar"` on the document root and on the content block. <!-- feature:locale-ar -->

## Link addresses

Two settings hold the link templates, one set per audience:

- `MAIL_LINKS_CUSTOMER`: the links in mail to customers.
- `MAIL_LINKS_STAFF`: the links in mail to staff members.

Both are unset by default. Then every link is `CLIENT_URL` followed by the
mail's fixed path, exactly as before these settings existed.

A setting is a JSON object with one template for every mail that carries a
link. The server refuses to start when the object names a mail that has no
link, or leaves one out, and the message names the setting and the mail.

- `emailChangeCode`: fixed path `/auth/confirm-email-change`.
- `magicLink`: fixed path `/auth/magic-link/verify`. The server adds the
  `token` query value.

A template takes one of two forms:

- A base with no path, such as `https://id.example.com`. The link is the base
  followed by the mail's fixed path, with one slash between them.
- A whole address, such as `https://id.example.com/sign-in/link?app=customer`.
  It is used as written, and the server's query values are added after the
  template's own.

`{locale}` anywhere in a template becomes the recipient's language, or `en`
when the language is unknown. A template must be an `http` or `https` address
with no fragment, and may hold no placeholder other than `{locale}`.

```bash
MAIL_LINKS_CUSTOMER='{"emailChangeCode":"https://id.example.com","magicLink":"https://id.example.com/{locale}/sign-in/link"}'
```

With that setting an English sign-in link is
`https://id.example.com/en/sign-in/link?token=...`, and the email change link
is `https://id.example.com/auth/confirm-email-change`.

### Audiences

Accounts do not carry an audience yet, so every recipient gets the customer
links. `MAIL_LINKS_STAFF` is checked at start-up but no mail uses it until
accounts can be told apart. The choice is made in one function,
`mailAudienceOf` in `backend/src/mail/links/mail-links.ts`.

The sign-in link a native app asks for goes to the callback the app
registered, not to a template.
