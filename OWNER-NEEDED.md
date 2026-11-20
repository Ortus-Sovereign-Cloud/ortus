# Needed from the owner

What only the owner can provide. The work around each item is built and tested with a stand-in.

| Since | What is needed | For | Stand-in used meanwhile |
| --- | --- | --- | --- |
| 2026-11-20 | Native speakers to check the Polish, Ukrainian, German, French and Arabic text | Every screen | Translations written by the build agent |
| 2026-11-20 | DNS for ortus.cc (Cloudflare): A records for `ortus.cc` and `*.ortus.cc` to the demo server, DNS only (not proxied) | The public demo moves to ortus.cc | ortus.rws8.tech |
| 2026-11-20 | Mail DNS for ortus.cc: SPF, DMARC, and the DKIM record the agent generates | Sign-up emails from noreply@ortus.cc | Sign-up mail sent from the demo server without them may land in spam |
