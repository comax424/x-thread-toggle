# X Thread-Ansicht

Chrome-Erweiterung für x.com: Unter jeder Antwort, die selbst Antworten hat, erscheint ein Button
„▸ Antworten anzeigen (N)“. Ein Klick klappt **alle** Beiträge darunter als verschachtelten Baum auf
(bis zu 15 Ladevorgänge pro Klick, Ebene für Ebene). Jede Ebene lässt sich einzeln wieder einklappen.
Tiefere Äste, die nicht mehr ins Budget passten, haben ihren eigenen Button.

## Aktionen in der Leseansicht

Jeder eingeblendete Beitrag hat dieselbe Leiste wie bei X:
**Antworten** (Eingabefeld direkt darunter) · **Reposten** (Menü: Reposten/rückgängig oder Zitieren) ·
**Gefällt mir** · **Aufrufe** (Link zur Statistik) · **Lesezeichen** · **Teilen** (Link kopieren).
Antworten und Zitate sind reiner Text, ohne Bilder, Umfragen oder Emoji-Auswahl. Dafür den Beitrag über das Datum auf X öffnen.

Technisch: Die Erweiterung nutzt X' eigene Aktionen (`FavoriteTweet`, `CreateRetweet`, `CreateBookmark`, `CreateTweet` …).
Kennungen und Feature-Flags liest sie zur Laufzeit aus X' Haupt-Bundle. Die von X verlangte `x-client-transaction-id`
erzeugt X' eigener Generator, den die Erweiterung im Webpack-Bundle der Seite findet.

## Einstellung: alles automatisch aufklappen

Klick auf das Erweiterungssymbol (ggf. erst über das Puzzle-Symbol anheften) → Häkchen
„Beim Öffnen eines Beitrags alle Antworten automatisch aufklappen“. Dann klappt die Erweiterung
beim Öffnen eines Beitrags und beim Runterscrollen alle Antworten selbst auf. Sichtbare Antworten
kommen zuerst dran.

Schutz vor X' Abfrage-Limit (300 Abfragen pro 15 Minuten, gemessen am Header `x-rate-limit-*`):
höchstens 80 automatische Abfragen pro geöffnetem Beitrag, und die Automatik stoppt, sobald nur
noch 50 Abfragen übrig sind. Die braucht X selbst zum Laden. Was nicht mehr automatisch geladen
wurde, behält seinen Button.

## Einstellung: breitere Mittelspalte

Zweites Häkchen im Popup (standardmäßig an): Die Mittelspalte wird 1000 statt 600 px breit, die Seitenleisten
rücken nach außen. Greift nur bei Fenstern ab 1700 px Breite, sonst bleibt X' Layout unverändert.
Verschachtelte Antworten rücken pro Ebene nur 16 px ein, damit auch tiefe Threads lesbar bleiben.

## Sprachen

29 Sprachen: alle 24 EU-Amtssprachen (bg, cs, da, de, el, en, es, et, fi, fr, ga, hr, hu, it, lt, lv, mt, nl, pl, pt, ro, sk, sl, sv)
sowie Norwegisch, Ukrainisch, Russisch, Türkisch und Katalanisch. Die Texte auf x.com folgen der in X eingestellten Sprache,
das Popup folgt der Browsersprache. Fehlt eine Sprache, erscheint Englisch. Alle Texte stehen in `i18n.js`,
Name und Beschreibung der Erweiterung in `_locales/` (Chrome kennt dort kein Irisch und Maltesisch; diese fallen auf Englisch zurück).
Die Übersetzungen wurden mit KI erstellt und nicht von Muttersprachlern geprüft.

## Installieren

1. In Chrome `chrome://extensions` öffnen.
2. Oben rechts den Schalter **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** klicken und diesen Ordner (`x-thread-toggle`) auswählen.
4. Offene x.com-Tabs einmal neu laden.

Funktioniert ebenso in Vivaldi, Brave oder Edge (Chromium-Browser, `vivaldi://extensions` usw.).

## Wie es funktioniert

- Das Script läuft im Seitenkontext von x.com und liest die `TweetDetail`-Anfrage mit, die X beim
  Öffnen eines Beitrags selbst schickt (Abfrage-ID, Feature-Flags, Sitzungs-Header).
- Für eine Antwort schickt es dieselbe Anfrage mit deren ID und zeigt die direkten Antworten an.
- Es sendet keine Daten an fremde Server, nur an x.com selbst, mit deiner bestehenden Anmeldung.

## Grenzen

- Nur auf Beitragsseiten (`/…/status/…`), nicht in der Startseiten-Timeline.
- X hat ein Anfrage-Limit. Wird es erreicht, erscheint „X-Limit erreicht“. Ein paar Minuten warten.
- Erscheint „Bitte die Seite einmal neu laden (F5)“, hat X noch keine eigene Anfrage geschickt, die sich mitlesen ließ.
- Baut X seine interne Schnittstelle um, kann die Erweiterung brechen. Dann tauchen Fehlermeldungen unter dem Button auf.
