# X Thread-Ansicht

[English](README.md)

Chrome-Erweiterung für x.com. Unter jeder Antwort, die selbst Antworten hat, erscheint ein Button
„▸ Antworten anzeigen (N)“. Ein Klick klappt **alle** Beiträge darunter als verschachtelten Baum auf
(Ebene für Ebene, bis zu 15 Abfragen pro Klick), statt dass man jede Antwort einzeln öffnen muss.
Jede Ebene lässt sich einzeln wieder einklappen. Tiefere Äste, die nicht mehr ins Budget passten,
behalten ihren eigenen Button.

> **Nicht mit X Corp. verbunden.** Dies ist ein unabhängiges, inoffizielles Projekt. „X“ ist eine Marke der X Corp.

## Funktionen

- **Threads aufklappen:** ein Button pro Antwort, funktioniert auch für beim Scrollen nachgeladene Antworten,
  aufgeklappte Threads bleiben beim Scrollen erhalten, nur 16 px Einrückung pro Ebene, damit auch tiefe Threads (9+ Ebenen) lesbar bleiben.
- **Aktionen in der Leseansicht:** Jeder eingeblendete Beitrag hat dieselbe Leiste wie bei X:
  **Antworten** (Eingabefeld direkt darunter) · **Reposten** (Menü: Reposten/rückgängig oder Zitieren) · **Gefällt mir** ·
  **Aufrufe** (Link zur Statistik) · **Lesezeichen** · **Teilen** (Link kopieren). Antworten und Zitate sind reiner Text –
  für Bilder, Umfragen oder Emojis den Beitrag über das Datum auf X öffnen. Name, @-Handle und Profilbild führen zum Profil.
- **Einstellungen** (Klick auf das Erweiterungssymbol, ggf. erst über das Puzzle-Symbol anheften). Beide wirken sofort:

  | Häkchen | Standard | Wirkung |
  |---|---|---|
  | Beim Öffnen eines Beitrags alle Antworten automatisch aufklappen | aus | Klappt beim Öffnen und Runterscrollen alles selbst auf, sichtbare Antworten zuerst. Höchstens 80 Abfragen pro Beitrag; stoppt, solange noch 50 von X' Abfragen für X selbst übrig sind. |
  | Mittelspalte verbreitern | an | Mittelspalte 1000 statt 600 px, Seitenleisten rücken nach außen. Nur bei Fenstern ab 1700 px Breite. |

## Sprachen

29 Sprachen: alle 24 EU-Amtssprachen (bg, cs, da, de, el, en, es, et, fi, fr, ga, hr, hu, it, lt, lv, mt, nl, pl, pt, ro, sk, sl, sv)
sowie Norwegisch, Ukrainisch, Russisch, Türkisch und Katalanisch. Die Texte auf x.com folgen der in X eingestellten Sprache,
das Popup folgt der Browsersprache, sonst Englisch. Alle Texte stehen in `i18n.js`, Name und Beschreibung der Erweiterung
in `_locales/` (Chrome kennt dort kein Irisch und Maltesisch; diese fallen auf Englisch zurück).
Die Übersetzungen wurden mit KI erstellt und nicht von Muttersprachlern geprüft – Korrekturen sind willkommen.

## Installieren

1. Die ZIP-Datei aus dem [neuesten Release](../../releases/latest) herunterladen und entpacken (oder dieses Repository klonen).
2. In Chrome `chrome://extensions` öffnen.
3. Oben rechts den Schalter **Entwicklermodus** einschalten.
4. **Entpackte Erweiterung laden** klicken und den entpackten Ordner auswählen.
5. Offene x.com-Tabs einmal neu laden.

Funktioniert ebenso in anderen Chromium-Browsern wie Vivaldi, Brave oder Edge.

## Datenschutz

- Die Erweiterung läuft nur auf `https://x.com/*` und verlangt eine einzige Berechtigung: `storage`, für ihre zwei Einstellungen
  (über `chrome.storage.sync` mit deinem Browserprofil synchronisiert).
- Sie schickt Anfragen **ausschließlich an x.com**, mit deiner bestehenden X-Anmeldung im Browser – genau wie X' eigene Web-App.
  Bilder kommen von X' eigenen Bildservern.
- Keine Statistik, kein Tracking, keine fremden Server. Nichts, was du liest oder schreibst, wird gespeichert oder anderswohin gesendet.

## Wie es funktioniert

- **Lesen:** Die Erweiterung liest die `TweetDetail`-Anfrage mit, die X' Web-App beim Öffnen eines Beitrags schickt
  (Abfrage-ID, Feature-Flags, Sitzungs-Header), und wiederholt sie mit der ID einer Antwort, um deren Antworten zu laden.
- **Schreiben** (Gefällt mir, Repost, Lesezeichen, Antworten): Dafür verlangt X den Header `x-client-transaction-id`. Die Erweiterung
  erzeugt ihn mit X' eigenem Generator aus dem Webpack-Bundle der Seite; Abfrage-IDs und Feature-Flags liest sie zur Laufzeit aus X' Haupt-Bundle.
- **Abfrage-Limit:** X erlaubt 300 `TweetDetail`-Abfragen pro 15 Minuten. Die Automatik richtet sich nach dem Restwert, den X meldet,
  und lässt immer 50 für X selbst übrig.

## Grenzen

- Nur auf Beitragsseiten (`/…/status/…`), nicht in der Startseiten-Timeline.
- Ist X' Abfrage-Limit erreicht, erscheint „X-Limit erreicht“ – ein paar Minuten warten.
- „Bitte die Seite einmal neu laden (F5)“ heißt: X hat noch keine Anfrage geschickt, die sich mitlesen ließ.
- Die Erweiterung hängt an X' internen Web-Schnittstellen. Ändert X sie, kann sie brechen; dann erscheinen Fehlermeldungen unter den Buttons.
- X' Nutzungsbedingungen schränken den Zugriff über nicht veröffentlichte Schnittstellen ein. Nutzung auf eigenes Risiko.

## Lizenz

[MIT](LICENSE)
