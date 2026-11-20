# Needed from the owner

What only the owner can provide. The work around each item is built and tested with a stand-in.

| Since | What is needed | For | Stand-in used meanwhile |
| --- | --- | --- | --- |
| 2026-11-20 | Native speakers to check the Polish, Ukrainian, German, French and Arabic text | Every screen | Translations written by the build agent |
| 2026-11-20 | Mail DNS for ortus.cc: SPF, DKIM (selector `mail`, key already on the demo server in /etc/opendkim/keys/ortus.cc) and DMARC, as TXT records | Sign-up emails from noreply@ortus.cc | Owner asked for the values on 2026-11-20; opendkim must still be told to sign for ortus.cc (KeyTable and SigningTable) |

## Done

| Date | What |
| --- | --- |
| 2026-11-20 | DNS for ortus.cc: A records for `ortus.cc` and `*.ortus.cc` to the demo server, DNS only; resolving |
