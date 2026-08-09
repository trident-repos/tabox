# Tabox Privacy Policy

**Last updated: August 3, 2026**

This Privacy Policy describes what information Tabox collects, how it is used, and the choices you have. The short version: Tabox is local-first. Your collections live in your browser, and if you enable sync they live in your own Google Drive. Optional features — cross-device sync, shared folders, Tabox AI, and Tabox Pro — involve limited additional processing, described in full below. We do not run analytics, we do not show ads, and we never sell your data.

## WHAT TABOX IS

Tabox is a browser extension for Chrome, Edge, and other Chromium-based browsers that lets you save your open tabs and Tab Groups into named collections, organize collections into folders, sync them across devices, share them with others, and tidy them with optional AI tools.

## WHAT INFORMATION DO WE COLLECT?

**Stored locally in your browser (always):**

- Your collections and folders: collection names, colors, timestamps, and the titles, URLs, and Tab Group information of tabs you choose to save
- Your settings and preferences: feature toggles and UI choices
- Local backups of your collections, and limited diagnostic logs (recent entries only, kept in a rolling window)

**Only if you sign in with Google (optional):**

- Basic Google profile information — your name, email address, and profile photo — retrieved from Google and displayed in the extension
- OAuth access and refresh tokens, stored locally in your browser
- If sync is enabled, your collections are stored in a hidden application data folder in **your own Google Drive** (see "Optional sync" below)

**Only if you use shared folders (optional):**

- The contents of collections you place in a shared folder (tab titles, URLs, colors, group metadata), the shared folder's name and settings, your email address, Google account ID, first name, profile photo link, your role and invite status, comments you post, and a history of changes (who added, updated, or removed what, and when). This data is stored on our servers so it can be delivered to the other members of the folder. See "Shared folders and collaboration" below.

**Only if you use Tabox AI (optional):**

- The content needed for the specific action you trigger — typically the titles and URLs of the tabs or collections being organized — is sent to our server and forwarded to an AI provider for processing. We do not store your AI prompts or the AI's responses. See "Tabox AI" below.

**Only if you subscribe to Tabox Pro (optional):**

- A subscription entitlement record (your Google account ID, email address, subscription identifiers, and status). Payments are processed by Paddle; we never see or store your card details. See "Payments and Tabox Pro" below.

Tabox does **not** collect your browsing history. It only ever touches tabs you explicitly save, and it contains no analytics or telemetry.

## OPTIONAL SYNC WITH YOUR GOOGLE ACCOUNT

If you enable sync, Tabox uses Google OAuth 2.0 to store your collections in a hidden application data folder (appDataFolder) in your own Google Drive. What syncs: tab titles, URLs, colors, timestamps, and folder/Tab Group metadata. Tabox requests only the narrow `drive.appdata` and `drive.file` scopes — it cannot read your other Drive files, contacts, or email.

The sign-in flow exchanges your Google authorization code for tokens through the Tabox API server; the server performs this exchange transiently and does not store your tokens — they are kept only in your browser. All communication uses HTTPS, and Google encrypts your Drive data at rest.

You can sign out at any time, revoke Tabox's access at myaccount.google.com/permissions, and delete the synced data from your Google Drive's app data settings.

## SHARED FOLDERS AND COLLABORATION

Shared folders let you collaborate on collections with other people. To make this work, the following is stored on Tabox's servers for as long as the shared folder exists:

- The folder's name, color, and settings, and the full contents of collections placed in it (tab titles, URLs, colors, and group metadata)
- Member information: email address, Google account ID, first name, profile photo link, role (read or write), and invite status
- Comments posted in the folder, and an activity history of changes (with the actor's name and photo)
- Share links you create, so that people you send them to can join

**Who can see this data:** every member of a shared folder can see its collections, comments, activity history, and the names, email addresses, and profile photos of other members. If you create a share link, anyone who receives that link can join the folder (with the role you chose) and see its contents. Only share folders and links with people you trust.

**Your controls:** you can leave a shared folder, delete folders you own (which deletes their server-side data, including members, comments, and activity), delete your own comments, and revoke share links. When you delete a shared folder or leave one you own nothing in, the associated server-side records are removed.

**Invite notifications:** if you grant the optional browser notifications permission, Tabox shows a system notification when someone invites you to a shared folder. To deliver timely updates, Tabox may also register a Web Push subscription for your browser (a push endpoint and its cryptographic keys) on our servers; it is removed when you sign out or disable the feature. Push messages themselves carry no collection content — they only tell your browser to check for updates.

## TABOX AI

Tabox includes optional AI features (such as Smart Tab Grouping, duplicate cleanup, automatic renaming, and folder arrangement). These run **only when you trigger them**.

When you run an AI action, the relevant content — typically the titles and URLs of the tabs or collections involved — is sent over HTTPS to the Tabox API server, which forwards it to OpenRouter, a third-party AI gateway, where it is processed by a large language model. The server authenticates the request with your Google sign-in and applies per-user rate limits, which means your Google account ID is associated with your usage volume (not with the content).

- We do **not** store your AI prompts or the AI's responses on our servers.
- AI processing by OpenRouter and its model providers is subject to their privacy policies.
- AI features require being signed in to Tabox; nothing is ever sent to an AI provider automatically or in the background without an action you initiated.
- Every AI action shows you a preview and supports undo.

## PAYMENTS AND TABOX PRO

Tabox Pro subscriptions are sold through **Paddle**, our merchant of record. When you purchase a subscription, Paddle collects and processes your payment and billing details under its own privacy policy — Tabox never receives or stores your card number.

Paddle notifies our server of the outcome, and we store a minimal entitlement record so the extension knows you're a Pro subscriber: your Google account ID, email address, subscription and transaction identifiers, plan, and status. This record is kept while your subscription is active and for a limited period afterward for support and accounting purposes. You can manage or cancel your subscription at any time; see our Terms of Service and refund policy at https://www.tabox.co/terms.

## NO TRACKING, NO ADS, NO ANALYTICS

Tabox contains no advertising, no behavioral tracking, and no analytics or telemetry SDKs — no Google Analytics, Mixpanel, Segment, Sentry, or similar. We do not build profiles of you and we do not monitor your browsing.

## THIRD-PARTY SERVICES AND SUBPROCESSORS

Tabox relies on the following services, each only for the purpose described:

- **Google (OAuth 2.0, Google Drive API, Google account profile)** — sign-in and optional sync/backup of your collections to your own Drive
- **Cloudflare (Workers, D1, KV)** — hosts the Tabox API server and stores shared-folder data, push subscriptions, and Pro entitlement records
- **OpenRouter** — AI gateway that processes Tabox AI requests you initiate
- **Paddle** — payment processing and subscription billing for Tabox Pro
- **Chrome/Edge platform services** — local extension storage and Web Store updates

Bundled open-source libraries (React, Jotai, dnd-kit, and others) run entirely inside the extension and transmit nothing.

We do not sell your personal information to anyone, and we do not share it with third parties except the processors above, as needed to provide the features you use.

## PERMISSIONS WE REQUEST AND WHY

- **tabs, tabGroups** — read the tabs and groups you choose to save, and restore them
- **storage, unlimitedStorage** — store your collections and settings locally
- **sessions** — restore tabs and windows accurately
- **identity** — Google sign-in for sync, sharing, AI, and Pro
- **contextMenus** — right-click actions
- **system.display, alarms** — window placement and periodic background maintenance
- **notifications (optional)** — system notifications for shared-folder invites; requested only if you enable it

Permissions by themselves transmit nothing; data leaves your device only through the optional features described above.

## HOW LONG DO WE KEEP YOUR INFORMATION?

- **Local data** — kept until you remove it or uninstall the extension; diagnostic logs are kept in a short rolling window
- **Google Drive sync file** — kept in your Drive until you delete it or revoke access
- **OAuth tokens** — stored locally, removed on sign-out; access tokens expire automatically
- **Shared-folder data** — kept while the folder exists; deleted when the owner deletes the folder (member, comment, and activity records are deleted with it)
- **Push subscriptions** — removed when you sign out or disable the feature
- **AI prompts and responses** — not stored
- **Pro entitlement records** — kept while your subscription is active, plus a limited period for support and accounting

## HOW DO WE KEEP YOUR INFORMATION SAFE?

Your collections are stored on-device by default. All network communication — with Google, the Tabox API, OpenRouter, and Paddle — uses HTTPS. Server-side data is stored on Cloudflare's infrastructure with encryption at rest. The API authenticates every request with your Google sign-in, and shared-folder data is only ever served to that folder's members. We request the minimum permissions and scopes needed. No method of transmission or storage is 100% secure, but we design Tabox so that as little of your data as possible ever leaves your device.

## DO WE COLLECT INFORMATION FROM MINORS?

Tabox is not directed at children under 13, and we do not knowingly collect personal information from them. If you believe a child has provided us personal information, contact us and we will delete it.

## WHAT ARE YOUR PRIVACY RIGHTS?

You are in control of your data:

- **Local data** — clear it from the extension or uninstall it
- **Sync** — sign out to stop syncing; revoke Tabox's access at myaccount.google.com/permissions; delete the synced file from your Google Drive app data settings
- **Shared folders** — leave any folder, delete folders you own, delete your comments, and revoke share links from within the extension
- **Push notifications** — disable in the extension's settings or your browser's site settings
- **Tabox Pro** — cancel your subscription at any time; contact us to request deletion of your entitlement record after cancellation
- **Anything else** — email info@tabox.co to request access to or deletion of any server-side data associated with your account (such as shared-folder membership records), and we will act on it promptly

## CONTROLS FOR DO-NOT-TRACK FEATURES

Tabox performs no cross-site tracking, so "Do Not Track" browser signals do not change its behavior — there is nothing to opt out of.

## DO CALIFORNIA RESIDENTS HAVE SPECIFIC PRIVACY RIGHTS?

Yes. If you use Tabox's optional online features, the categories of personal information we may hold are: identifiers (name, email address, Google account ID, profile photo link) and user-provided content (shared collections, comments). We collect them solely to provide the features you enabled. We do not sell or share personal information as defined by the CCPA/CPRA, and we do not use it for cross-context behavioral advertising. California residents may exercise their rights to know, access, correct, and delete by using the in-extension controls above or by emailing info@tabox.co. We do not discriminate against you for exercising your rights.

## DO WE MAKE UPDATES TO THIS POLICY?

We may update this policy as Tabox evolves. Material changes will be reflected in the "Last updated" date above, and continued use of Tabox after an update constitutes acceptance of the revised policy.

## HOW CAN YOU CONTACT US ABOUT THIS POLICY?

- Email: info@tabox.co
- GitHub: github.com/gilgold/tabox/issues
- Website: https://www.tabox.co
