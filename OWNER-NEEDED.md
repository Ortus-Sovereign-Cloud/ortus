# Needed from the owner

What only the owner can provide. The work around each item is built and tested with a stand-in.

| Since | What is needed | For | Stand-in used meanwhile |
| --- | --- | --- | --- |
| 2026-11-20 | Create the owner account of the demo at ortus.cc: on the VM run `sudo -u ortus ORTUS_CONFIG=/etc/ortus/ortus.toml /usr/local/bin/ortus setup-link` and open the link it prints | Administering the demo | Nobody owns it yet; visitors can sign up |
| 2026-11-20 | Keep a copy of the demo's secrets key somewhere safe: `sudo cat /var/lib/ortus/secrets.key` on the VM (it seals the stored secrets; backups never carry it, so a restore needs it) | Restoring the demo from a backup | The key lives only on the VM |
| 2026-11-20 | Native speakers to check the Polish, Ukrainian, German, French and Arabic text | Every screen | Translations written by the build agent |
| 2026-11-20 | rws to accept HTTP extension methods (RFC 9110 tokens: PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL, MOVE, COPY): today it answers 400 before routing | CalDAV and CardDAV on the web port (`/dav/` there is already wired); until then they run on their own port (8443 with TLS, SRV records) | Ortus serves DAV from a small listener of its own |
| 2026-11-21 | An Apple Developer account (team id, App Store Connect API key) and a Google Play developer account with an upload key | Signing the phone apps for the stores and TestFlight; push notifications (APNs, FCM) | CI builds unsigned apps and tests them in the simulator and emulator; no store builds, no push |
| 2026-11-20 | A SIP trunk (a provider account and a phone number) for joining calls by phone | The "Phone dial-in" tile of the call board | Calls in the browser only; the tile is not shown |

## Done

| Date | What |
| --- | --- |
| 2026-11-20 | DNS for ortus.cc: A records for `ortus.cc` and `*.ortus.cc` to the demo server, DNS only; resolving |
| 2026-11-20 | Mail DNS for ortus.cc: SPF, DKIM (selector `mail`) and DMARC; resolving, DKIM matches the key on the demo server |
